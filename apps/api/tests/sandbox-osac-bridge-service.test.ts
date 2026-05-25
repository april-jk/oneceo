import test from 'node:test';
import assert from 'node:assert/strict';
import { canReuseOsacBridge } from '../src/services/sandbox-osac-bridge-service';

test('canReuseOsacBridge rejects missing or stale OSAC artifact sha', async () => {
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetchCalled = true;
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  try {
    assert.equal(
      await canReuseOsacBridge({
        endpoint: 'ws://sandbox.example/ws',
        authToken: 'token',
        currentSha256: null,
        expectedSha256: 'expected',
      }),
      false
    );
    assert.equal(
      await canReuseOsacBridge({
        endpoint: 'ws://sandbox.example/ws',
        authToken: 'token',
        currentSha256: 'old',
        expectedSha256: 'expected',
      }),
      false
    );
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('canReuseOsacBridge checks status endpoint after artifact sha matches', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; authorization: string | null }> = [];
  globalThis.fetch = (async (url, init) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(url),
      authorization: headers.get('authorization'),
    });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  try {
    assert.equal(
      await canReuseOsacBridge({
        endpoint: 'wss://sandbox.example/ws',
        authToken: 'token',
        currentSha256: 'expected',
        expectedSha256: 'expected',
      }),
      true
    );
    assert.deepEqual(calls, [
      {
        url: 'https://sandbox.example/status',
        authorization: 'Bearer token',
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
