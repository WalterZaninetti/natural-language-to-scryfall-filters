import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test, { after, before, describe } from 'node:test';

// config.ts validates required vars at import time, so these must be set before app.ts loads.
process.env.ANTHROPIC_API_KEY ??= 'test-anthropic-key';
process.env.API_KEY = 'test-client-key';

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

/** Only the rejection paths are exercised — a valid key falls through to a real model call. */
describe('POST /translate authentication', () => {
  const body = JSON.stringify({ text: 'red creatures' });

  test('rejects a request with no key', async () => {
    const res = await fetch(`${baseUrl}/translate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: 'unauthorized' });
  });

  test('rejects a wrong key', async () => {
    const res = await fetch(`${baseUrl}/translate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'wrong-key' },
      body,
    });
    assert.equal(res.status, 401);
  });

  test('rejects a key that is a prefix of the real one', async () => {
    const res = await fetch(`${baseUrl}/translate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'test-client' },
      body,
    });
    assert.equal(res.status, 401);
  });

  test('rejects before validating the body, so an invalid payload still returns 401', async () => {
    const res = await fetch(`${baseUrl}/translate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '' }),
    });
    assert.equal(res.status, 401);
  });
});

test('/health stays open so platform health checks keep working', async () => {
  const res = await fetch(`${baseUrl}/health`);
  assert.equal(res.status, 200);
});
