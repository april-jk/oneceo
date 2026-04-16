import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

const connectorModuleUrl = new URL('../server/connectors/oneceo-api-connector.ts', import.meta.url);
const ADMIN_ENV_LOADED_KEY = '__oneceo_admin_env_loaded__';

const originalEnv = {
  ONECEO_API_URL: process.env.ONECEO_API_URL,
  ONECEO_INTERNAL_TOKEN: process.env.ONECEO_INTERNAL_TOKEN,
  ONECEO_REQUEST_TIMEOUT_MS: process.env.ONECEO_REQUEST_TIMEOUT_MS,
  ONECEO_OSAC_UPLOAD_TIMEOUT_MS: process.env.ONECEO_OSAC_UPLOAD_TIMEOUT_MS,
  ONECEO_REQUEST_RETRIES: process.env.ONECEO_REQUEST_RETRIES,
};
const originalFetch = globalThis.fetch;
const originalAdminEnvLoadedState = (globalThis as Record<string, unknown>)[ADMIN_ENV_LOADED_KEY];

afterEach(() => {
  if (originalEnv.ONECEO_API_URL === undefined) delete process.env.ONECEO_API_URL;
  else process.env.ONECEO_API_URL = originalEnv.ONECEO_API_URL;

  if (originalEnv.ONECEO_INTERNAL_TOKEN === undefined) delete process.env.ONECEO_INTERNAL_TOKEN;
  else process.env.ONECEO_INTERNAL_TOKEN = originalEnv.ONECEO_INTERNAL_TOKEN;

  if (originalEnv.ONECEO_REQUEST_TIMEOUT_MS === undefined) delete process.env.ONECEO_REQUEST_TIMEOUT_MS;
  else process.env.ONECEO_REQUEST_TIMEOUT_MS = originalEnv.ONECEO_REQUEST_TIMEOUT_MS;

  if (originalEnv.ONECEO_OSAC_UPLOAD_TIMEOUT_MS === undefined) delete process.env.ONECEO_OSAC_UPLOAD_TIMEOUT_MS;
  else process.env.ONECEO_OSAC_UPLOAD_TIMEOUT_MS = originalEnv.ONECEO_OSAC_UPLOAD_TIMEOUT_MS;

  if (originalEnv.ONECEO_REQUEST_RETRIES === undefined) delete process.env.ONECEO_REQUEST_RETRIES;
  else process.env.ONECEO_REQUEST_RETRIES = originalEnv.ONECEO_REQUEST_RETRIES;

  globalThis.fetch = originalFetch;

  if (originalAdminEnvLoadedState === undefined) {
    delete (globalThis as Record<string, unknown>)[ADMIN_ENV_LOADED_KEY];
  } else {
    (globalThis as Record<string, unknown>)[ADMIN_ENV_LOADED_KEY] = originalAdminEnvLoadedState;
  }
});

function createDelayedFetch(delayMs: number) {
  return ((_: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      const signal = init?.signal;
      const timer = setTimeout(() => {
        resolve(
          new Response(
            JSON.stringify({
              success: true,
              data: {
                id: 'release-test',
                artifactType: 'osac',
                platform: 'linux',
                arch: 'amd64',
                version: 'v1.0.0',
                channel: 'stable',
                status: 'uploaded',
                bucket: 'test-bucket',
                objectKey: 'osac/linux/amd64/v1.0.0/osac',
                manifestKey: 'osac/linux/amd64/v1.0.0/manifest.json',
                sha256: 'abc',
                sizeBytes: 1,
                releaseNotes: '',
                uploadedAt: new Date().toISOString(),
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            }),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }
          )
        );
      }, delayMs);

      if (!signal) return;
      if (signal.aborted) {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        },
        { once: true }
      );
    })) as typeof fetch;
}

test('uploadOsacRelease uses dedicated timeout and can outlive default request timeout', async () => {
  (globalThis as Record<string, unknown>)[ADMIN_ENV_LOADED_KEY] = 'NO_ENV_FILE';
  process.env.ONECEO_API_URL = 'http://127.0.0.1:4000';
  process.env.ONECEO_INTERNAL_TOKEN = 'internal-token';
  process.env.ONECEO_REQUEST_TIMEOUT_MS = '20';
  process.env.ONECEO_OSAC_UPLOAD_TIMEOUT_MS = '120';
  process.env.ONECEO_REQUEST_RETRIES = '0';
  globalThis.fetch = createDelayedFetch(60);

  const { OneceoApiConnector } = await import(`${connectorModuleUrl.href}?upload-timeout=${Date.now()}`);
  const connector = new OneceoApiConnector();

  const result = await connector.uploadOsacRelease({
    version: 'v1.0.0',
    fileBase64: 'YQ==',
  });

  assert.equal(result.id, 'release-test');
});

test('non-upload request still respects default timeout', async () => {
  (globalThis as Record<string, unknown>)[ADMIN_ENV_LOADED_KEY] = 'NO_ENV_FILE';
  process.env.ONECEO_API_URL = 'http://127.0.0.1:4000';
  process.env.ONECEO_INTERNAL_TOKEN = 'internal-token';
  process.env.ONECEO_REQUEST_TIMEOUT_MS = '20';
  process.env.ONECEO_OSAC_UPLOAD_TIMEOUT_MS = '120';
  process.env.ONECEO_REQUEST_RETRIES = '0';
  globalThis.fetch = createDelayedFetch(60);

  const { OneceoApiConnector } = await import(`${connectorModuleUrl.href}?default-timeout=${Date.now()}`);
  const connector = new OneceoApiConnector();

  await assert.rejects(
    connector.listOsacReleases(),
    /连接 oneceo api 超时/
  );
});
