import { createHash, timingSafeEqual } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import * as z from 'zod';
import { PROMPT_VERSION } from './claude.ts';
import { config } from './config.ts';
import { getGroundingIndex, groundingStatus } from './grounding/index.ts';
import { LANGUAGES } from './prompt/examples/index.ts';
import { REGISTRY_VERSION } from './registry/operators.ts';
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
 * Browser clients cannot hold a shared secret: anything a public web app sends is readable in
 * its own bundle, so shipping the key there would publish it — and worse, publish a credential
 * that also authorises non-browser callers until it is rotated.
 *
 * So a request is authorised by *either* the key or an allowed Origin. Server-to-server callers
 * still need the key and gain nothing from the Origin path (curl sends no Origin by default).
 * A browser on an allowed origin needs no credential at all, so none ships.
 *
 * Be clear about what this is: an attacker who forges an Origin header gets through. It is a gate
 * against casual misuse, not an authentication boundary. What actually protects the Anthropic
 * spend is the per-IP hourly rate limit below. Upgrading to real attestation means Firebase App
 * Check or Turnstile, which load third-party script into the page — a trade the calling site
 * currently refuses on privacy grounds, and a decision to make deliberately rather than by drift.
 */
function isAllowedOrigin(req: Request): boolean {
  const origin = req.headers.origin;
  return typeof origin === 'string' && config.allowedOrigins.includes(origin);
}

function requireAuthorized(req: Request, res: Response, next: NextFunction): void {
  if (!isAuthorized(req.header('x-api-key')) && !isAllowedOrigin(req)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy !== undefined) app.set('trust proxy', config.trustProxy);
  app.use(express.json({ limit: '32kb' }));

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && config.allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'content-type, x-api-key');
      res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    }
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
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
    });
  });

  app.post('/translate', requireAuthorized, async (req: Request, res: Response) => {
    const parsed = RequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_request', details: z.treeifyError(parsed.error) });
      return;
    }

    const identifier = req.ip ?? 'unknown';
    if (!(await allowRequest(identifier, config.rateLimitPerHour))) {
      res.status(429).json({ error: 'rate_limited', message: 'Hourly request limit reached.' });
      return;
    }

    const result = await translateRequest(parsed.data);
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
