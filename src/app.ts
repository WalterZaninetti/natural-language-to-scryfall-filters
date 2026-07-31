import { createHash, timingSafeEqual } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import * as z from 'zod';
import { PROMPT_VERSION } from './claude.ts';
import { config } from './config.ts';
import { getGroundingIndex, groundingStatus } from './grounding/index.ts';
import { LANGUAGES } from './prompt/examples/index.ts';
import { REGISTRY_VERSION } from './registry/operators.ts';
import { dailyBudgetStatus, recordModelCalls, withinDailyBudget } from './store/dailyBudget.ts';
import { storeStatus } from './store/firestore.ts';
import { allowRequest } from './store/rateLimit.ts';
import { translateRequest } from './translate.ts';

const RequestSchema = z.object({
  text: z.string().min(1).max(2000),
  language: z.enum(LANGUAGES).optional(),
  previous: z
    .object({
      text: z.string().min(1).max(2000),
      query: z.string().min(1).max(2000),
    })
    .optional(),
});

/**
 * Both sides are hashed before comparison: timingSafeEqual throws on length mismatch, and
 * branching on length first would leak the key's size through timing.
 */
function isAuthorized(supplied: string | undefined): boolean {
  if (!supplied) return false;
  return timingSafeEqual(
    createHash('sha256').update(supplied).digest(),
    createHash('sha256').update(config.clientApiKey).digest(),
  );
}

/**
 * POST /translate is public, and saying so plainly is the point of this note.
 *
 * The site reaches this service same-origin — Firebase Hosting rewrites walterzaninetti.com/api/**
 * to it, and the Vite dev server proxies the same path — so the browser sends no credential and
 * none is shipped in the bundle. A public page cannot hold a secret; the previous Origin allowlist
 * only looked like a gate, because Origin is set by the caller and forged in one curl flag.
 *
 * So this is not a loosening, it is an honest restatement of what was already true. What bounds
 * abuse is the per-IP hourly limit plus the daily model-call ceiling, and the ceiling is the one
 * that caps the bill: rotating IPs is cheap, so the per-IP limit only shapes ordinary traffic.
 *
 * Real attestation means Firebase App Check or Cloudflare Turnstile, which load third-party script
 * into the page — a trade the calling site refuses on privacy grounds, and one to make
 * deliberately if abuse ever shows up rather than by drift.
 *
 * A valid x-api-key marks a server-to-server caller (the eval suite, scripts) and skips the per-IP
 * limit only. It is a convenience tier, not an access control: the daily ceiling still applies.
 */

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy !== undefined) app.set('trust proxy', config.trustProxy);
  app.use(express.json({ limit: '32kb' }));

  /**
   * The site calls this service same-origin, through a Firebase Hosting rewrite in production and
   * the Vite dev proxy locally. Hosting passes the matched path through unchanged, so `/api/**`
   * arrives here as `/api/translate` — strip the prefix so one set of routes serves the rewrite,
   * the dev proxy, and the direct Cloud Run URL without per-environment configuration.
   */
  app.use((req, _res, next) => {
    if (req.url.startsWith('/api/')) req.url = req.url.slice(4);
    next();
  });

  app.get('/health', async (_req, res) => {
    await getGroundingIndex();
    res.json({
      status: 'ok',
      registryVersion: REGISTRY_VERSION,
      promptVersion: PROMPT_VERSION,
      grounding: groundingStatus(),
      store: storeStatus(),
      dailyBudget: await dailyBudgetStatus(config.dailyModelCallLimit),
    });
  });

  app.post('/translate', async (req: Request, res: Response) => {
    const parsed = RequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_request', details: z.treeifyError(parsed.error) });
      return;
    }

    if (!isAuthorized(req.header('x-api-key'))) {
      const identifier = req.ip ?? 'unknown';
      if (!(await allowRequest(identifier, config.rateLimitPerHour))) {
        res.status(429).json({ error: 'rate_limited', message: 'Hourly request limit reached.' });
        return;
      }
    }

    if (!(await withinDailyBudget(config.dailyModelCallLimit))) {
      res.status(429).json({
        error: 'daily_limit',
        message: 'Daily model-call ceiling reached. Try again tomorrow.',
      });
      return;
    }

    const result = await translateRequest(parsed.data);
    // Cache hits report 0 model calls and cost nothing, so they are not charged against it.
    await recordModelCalls(result.diagnostics.modelCalls);

    res.json(result);
  });

  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[error]', error);
    res.status(500).json({ error: 'internal_error', message: error.message });
  });

  return app;
}
