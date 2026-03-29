import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { sanitizeSandboxEnvs } from '../src/services/sandbox-environment-service';

afterEach(() => {
  mock.reset();
});

test('sanitizeSandboxEnvs strips cloudflare and storage credentials before sandbox provisioning', () => {
  const result = sanitizeSandboxEnvs({
    OPENAI_API_KEY: 'openai-key',
    R2_MANAGED_IMAGE_ACCESS_KEY_ID: 'managed-r2-key',
    R2_SECRET_ACCESS_KEY: 'archive-r2-secret',
    CF_API_TOKEN: 'cf-token',
    CLOUDFLARE_ACCOUNT_ID: 'account-id',
    AWS_ACCESS_KEY_ID: 'aws-key',
    SAFE_FLAG: '1',
  });

  assert.deepEqual(result, {
    OPENAI_API_KEY: 'openai-key',
    SAFE_FLAG: '1',
  });
});
