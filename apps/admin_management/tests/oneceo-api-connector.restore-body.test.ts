import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

const connectorModuleUrl = new URL('../server/connectors/oneceo-api-connector.ts', import.meta.url);
const ADMIN_ENV_LOADED_KEY = '__oneceo_admin_env_loaded__';

const originalEnv = {
  ONECEO_API_URL: process.env.ONECEO_API_URL,
  ONECEO_INTERNAL_TOKEN: process.env.ONECEO_INTERNAL_TOKEN,
  ONECEO_REQUEST_RETRIES: process.env.ONECEO_REQUEST_RETRIES,
};
const originalFetch = globalThis.fetch;
const originalAdminEnvLoadedState = (globalThis as Record<string, unknown>)[ADMIN_ENV_LOADED_KEY];

afterEach(() => {
  if (originalEnv.ONECEO_API_URL === undefined) delete process.env.ONECEO_API_URL;
  else process.env.ONECEO_API_URL = originalEnv.ONECEO_API_URL;

  if (originalEnv.ONECEO_INTERNAL_TOKEN === undefined) delete process.env.ONECEO_INTERNAL_TOKEN;
  else process.env.ONECEO_INTERNAL_TOKEN = originalEnv.ONECEO_INTERNAL_TOKEN;

  if (originalEnv.ONECEO_REQUEST_RETRIES === undefined) delete process.env.ONECEO_REQUEST_RETRIES;
  else process.env.ONECEO_REQUEST_RETRIES = originalEnv.ONECEO_REQUEST_RETRIES;

  globalThis.fetch = originalFetch;

  if (originalAdminEnvLoadedState === undefined) {
    delete (globalThis as Record<string, unknown>)[ADMIN_ENV_LOADED_KEY];
  } else {
    (globalThis as Record<string, unknown>)[ADMIN_ENV_LOADED_KEY] = originalAdminEnvLoadedState;
  }
});

test('restoreSandboxEnvironment sends a JSON object body once', async () => {
  (globalThis as Record<string, unknown>)[ADMIN_ENV_LOADED_KEY] = 'NO_ENV_FILE';
  process.env.ONECEO_API_URL = 'http://127.0.0.1:4000';
  process.env.ONECEO_INTERNAL_TOKEN = 'internal-token';
  process.env.ONECEO_REQUEST_RETRIES = '0';

  let capturedUrl = '';
  let capturedMethod = '';
  let capturedBody = '';

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedMethod = init?.method || 'GET';
    capturedBody = typeof init?.body === 'string' ? init.body : '';
    return new Response(JSON.stringify({ success: true, data: { ok: true } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  const { OneceoApiConnector } = await import(`${connectorModuleUrl.href}?restore-body=${Date.now()}`);
  const connector = new OneceoApiConnector();

  await connector.restoreSandboxEnvironment('session-1', { snapshotKey: 'snapshot-1' });

  assert.equal(capturedMethod, 'POST');
  assert.match(capturedUrl, /\/api\/sandbox\/environment\/session-1\/restore$/);
  assert.deepEqual(JSON.parse(capturedBody), { snapshotKey: 'snapshot-1' });
});
