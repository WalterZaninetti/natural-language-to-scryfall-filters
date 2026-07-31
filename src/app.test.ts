import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test, { after, before, describe } from 'node:test';

// config.ts validates required vars at import time, so these must be set before app.ts loads.
//
// Both limits are pinned low so no test can reach the model: the daily ceiling of 0 stops every
// request that gets past the per-IP limit, and the per-IP limit of 1 lets exactly one request
// through per window so the two refusals stay distinguishable.
process.env.ANTHROPIC_API_KEY ??= 'test-anthropic-key';
process.env.API_KEY = 'test-client-key';
process.env.RATE_LIMIT_PER_HOUR = '1';
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

const body = JSON.stringify({ text: 'red creatures' });

function post(headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}/translate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });
}

const errorOf = async (res: Response) => ((await res.json()) as { error: string }).error;

/**
 * POST /translate is public. These run in order and share one per-IP bucket, which is what lets
 * them tell the two 429s apart: `daily_limit` means the request got all the way through, and
 * `rate_limited` means the per-IP bucket stopped it first.
 */
describe('POST /translate is public', () => {
  test('an unauthenticated request is accepted, not rejected with 401', async () => {
    const res = await post();
    assert.notEqual(res.status, 401);
    assert.equal(res.status, 429);
    assert.equal(await errorOf(res), 'daily_limit');
  });

  test('the per-IP limit applies to unauthenticated callers', async () => {
    const res = await post();
    assert.equal(res.status, 429);
    assert.equal(await errorOf(res), 'rate_limited');
  });

  test('a valid key skips the per-IP limit but not the daily ceiling', async () => {
    const res = await post({ 'x-api-key': 'test-client-key' });
    assert.equal(await errorOf(res), 'daily_limit');
  });

  test('a wrong key is treated as anonymous rather than rejected', async () => {
    const res = await post({ 'x-api-key': 'wrong-key' });
    assert.notEqual(res.status, 401);
    assert.equal(await errorOf(res), 'rate_limited');
  });

  test('a key that is a prefix of the real one does not grant the tier', async () => {
    const res = await post({ 'x-api-key': 'test-client' });
    assert.equal(await errorOf(res), 'rate_limited');
  });

  test('an invalid body is rejected before either limit', async () => {
    const res = await fetch(`${baseUrl}/translate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '' }),
    });
    assert.equal(res.status, 400);
    assert.equal(await errorOf(res), 'invalid_request');
  });
});

describe('CORS is gone, because the caller is same-origin', () => {
  test('no Access-Control-Allow-Origin is sent, even for a known origin', async () => {
    const res = await post({ origin: 'https://walterzaninetti.com' });
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  });

  test('OPTIONS is no longer short-circuited with a 204 preflight', async () => {
    const res = await fetch(`${baseUrl}/translate`, { method: 'OPTIONS' });
    assert.notEqual(res.status, 204);
  });
});

test('/health stays open so platform health checks keep working', async () => {
  const res = await fetch(`${baseUrl}/health`);
  assert.equal(res.status, 200);
});
