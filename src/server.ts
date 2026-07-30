import { createApp } from './app.ts';
import { config } from './config.ts';
import { getGroundingIndex, groundingStatus } from './grounding/index.ts';

const app = createApp();

await getGroundingIndex();
console.log('[startup] grounding index:', groundingStatus());

const server = app.listen(config.port, () => {
  console.log(`[startup] listening on :${String(config.port)}`);
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    console.log(`[shutdown] ${signal}`);
    server.close(() => process.exit(0));
  });
}
