import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

const ADMIN_ENV_LOADED_KEY = '__oneceo_admin_env_loaded__';
const originalInternalToken = process.env.ONECEO_INTERNAL_TOKEN;
const originalPort = process.env.PORT;
const originalAdminPort = process.env.ADMIN_MANAGEMENT_PORT;
const originalAdminEnvLoadedState = (globalThis as Record<string, unknown>)[ADMIN_ENV_LOADED_KEY];
const configModuleUrl = new URL('../server/config.ts', import.meta.url);

afterEach(() => {
  if (originalInternalToken === undefined) {
    delete process.env.ONECEO_INTERNAL_TOKEN;
  } else {
    process.env.ONECEO_INTERNAL_TOKEN = originalInternalToken;
  }

  if (originalPort === undefined) {
    delete process.env.PORT;
  } else {
    process.env.PORT = originalPort;
  }

  if (originalAdminPort === undefined) {
    delete process.env.ADMIN_MANAGEMENT_PORT;
  } else {
    process.env.ADMIN_MANAGEMENT_PORT = originalAdminPort;
  }

  if (originalAdminEnvLoadedState === undefined) {
    delete (globalThis as Record<string, unknown>)[ADMIN_ENV_LOADED_KEY];
  } else {
    (globalThis as Record<string, unknown>)[ADMIN_ENV_LOADED_KEY] = originalAdminEnvLoadedState;
  }
});

test('admin management config rejects blank internal token', async () => {
  (globalThis as Record<string, unknown>)[ADMIN_ENV_LOADED_KEY] = 'NO_ENV_FILE';
  process.env.ONECEO_INTERNAL_TOKEN = '';

  await assert.rejects(
    import(`${configModuleUrl.href}?blank-internal-token=${Date.now()}`),
    /ONECEO_INTERNAL_TOKEN is required for admin_management/
  );
});

test('admin management config accepts non-empty internal token', async () => {
  (globalThis as Record<string, unknown>)[ADMIN_ENV_LOADED_KEY] = 'NO_ENV_FILE';
  process.env.ONECEO_INTERNAL_TOKEN = 'internal-secret';

  const module = await import(`${configModuleUrl.href}?configured-internal-token=${Date.now()}`);
  assert.equal(module.config.oneceoInternalToken, 'internal-secret');
});

test('admin management config ignores shared PORT when local env file is loaded', async () => {
  process.env.ONECEO_INTERNAL_TOKEN = 'internal-secret';
  delete process.env.ADMIN_MANAGEMENT_PORT;
  process.env.PORT = '4000';
  (globalThis as Record<string, unknown>)[ADMIN_ENV_LOADED_KEY] = '/tmp/apps.env';

  const module = await import(`${configModuleUrl.href}?local-env-port=${Date.now()}`);
  assert.equal(module.config.port, 9310);
});

test('admin management config falls back to PORT when no env file is loaded', async () => {
  process.env.ONECEO_INTERNAL_TOKEN = 'internal-secret';
  delete process.env.ADMIN_MANAGEMENT_PORT;
  process.env.PORT = '4321';
  (globalThis as Record<string, unknown>)[ADMIN_ENV_LOADED_KEY] = 'NO_ENV_FILE';

  const module = await import(`${configModuleUrl.href}?process-env-port=${Date.now()}`);
  assert.equal(module.config.port, 4321);
});
