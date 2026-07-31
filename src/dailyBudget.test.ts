import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test, { after, before, describe } from 'node:test';

// config.ts validates required vars at import time, so these must be set before app.ts loads.
// A ceiling of 0 means every request is refused before it can reach the model, which is what
// keeps this test free: nothing here should ever make a model call.
process.env.ANTHROPIC_API_KEY ??= 'test-anthropic-key';
process.env.API_KEY = 'test-client-key';
process.env.DAILY_MODEL_CALL_LIMIT = '0';

const { createApp } = await import('./app.ts');

let baseUrl: string;
let server: ReturnType<ReturnType<typeof createApp>['listen']>;

before(async () => {
  await new Promise<void>((resolve) => {
    server = createApp().listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const post = (path: string) =>
  fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'test-client-key' },
    body: JSON.stringify({ text: 'red creatures' }),
  });

describe('daily model-call ceiling', () => {
  test('refuses once the ceiling is reached', async () => {
    const res = await post('/translate');
    assert.equal(res.status, 429);
    assert.equal(((await res.json()) as { error: string }).error, 'daily_limit');
  });

  test('is distinguishable from the per-IP hourly limit', async () => {
    const res = await post('/translate');
    assert.notEqual(((await res.json()) as { error: string }).error, 'rate_limited');
  });

  test('applies to a keyed caller too — the key is not an exemption', async () => {
    // The same request without a key would also be refused, but this asserts the keyed path
    // reaches the ceiling rather than stopping earlier.
    const res = await post('/translate');
    assert.equal(res.status, 429);
  });

  test('rejects an invalid body before charging the ceiling', async () => {
    const res = await fetch(`${baseUrl}/translate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'test-client-key' },
      body: '{}',
    });
    assert.equal(res.status, 400);
  });

  test('reports usage on /health', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    const payload = (await res.json()) as { dailyBudget: { used: number; limit: number } };
    assert.equal(payload.dailyBudget.limit, 0);
    assert.equal(typeof payload.dailyBudget.used, 'number');
  });
});

describe('the /api prefix used by the Hosting rewrite', () => {
  test('reaches the same route', async () => {
    const res = await post('/api/translate');
    assert.equal(res.status, 429);
    assert.equal(((await res.json()) as { error: string }).error, 'daily_limit');
  });

  test('serves /api/health too', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { status: string }).status, 'ok');
  });

  test('an unknown /api path is still a 404', async () => {
    const res = await fetch(`${baseUrl}/api/nope`);
    assert.equal(res.status, 404);
  });
});
