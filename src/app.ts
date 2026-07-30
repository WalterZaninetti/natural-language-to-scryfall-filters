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

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && config.allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'content-type');
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

  app.post('/translate', async (req: Request, res: Response) => {
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
