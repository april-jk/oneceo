import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

const originalInternalToken = process.env.ONECEO_INTERNAL_TOKEN;
const configModuleUrl = new URL('../server/config.ts', import.meta.url);

afterEach(() => {
  if (originalInternalToken === undefined) {
    delete process.env.ONECEO_INTERNAL_TOKEN;
    return;
  }
  process.env.ONECEO_INTERNAL_TOKEN = originalInternalToken;
});

test('admin management config rejects blank internal token', async () => {
  process.env.ONECEO_INTERNAL_TOKEN = '';

  await assert.rejects(
    import(`${configModuleUrl.href}?blank-internal-token=${Date.now()}`),
    /ONECEO_INTERNAL_TOKEN is required for admin_management/
  );
});

test('admin management config accepts non-empty internal token', async () => {
  process.env.ONECEO_INTERNAL_TOKEN = 'internal-secret';

  const module = await import(`${configModuleUrl.href}?configured-internal-token=${Date.now()}`);
  assert.equal(module.config.oneceoInternalToken, 'internal-secret');
});
