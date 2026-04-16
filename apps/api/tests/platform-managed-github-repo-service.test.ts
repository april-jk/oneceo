import assert from 'node:assert/strict';
import test from 'node:test';

import { __testing } from '../src/services/platform-managed-github-repo-service';

test('normalizeGithubAppPrivateKey restores newline escapes from one-line env value', () => {
  const normalized = __testing.normalizeGithubAppPrivateKey(
    '-----BEGIN RSA PRIVATE KEY-----\\nline-1\\nline-2\\n-----END RSA PRIVATE KEY-----'
  );

  assert.equal(normalized.includes('\\n'), false);
  assert.equal(normalized.split('\n')[0], '-----BEGIN RSA PRIVATE KEY-----');
  assert.equal(normalized.split('\n').at(-1), '-----END RSA PRIVATE KEY-----');
});

test('hasGithubAppDeploymentConfig only reports ready when inline private key is present', () => {
  const original = {
    appId: process.env.GITHUB_DEPLOYMENT_APP_ID,
    installationId: process.env.GITHUB_DEPLOYMENT_INSTALLATION_ID,
    privateKey: process.env.GITHUB_DEPLOYMENT_APP_PRIVATE_KEY,
  };

  process.env.GITHUB_DEPLOYMENT_APP_ID = '3393800';
  process.env.GITHUB_DEPLOYMENT_INSTALLATION_ID = '124321465';
  delete process.env.GITHUB_DEPLOYMENT_APP_PRIVATE_KEY;
  assert.equal(__testing.hasGithubAppDeploymentConfig(), false);

  process.env.GITHUB_DEPLOYMENT_APP_PRIVATE_KEY =
    '-----BEGIN RSA PRIVATE KEY-----\\nkey\\n-----END RSA PRIVATE KEY-----';
  assert.equal(__testing.hasGithubAppDeploymentConfig(), true);

  if (original.appId === undefined) delete process.env.GITHUB_DEPLOYMENT_APP_ID;
  else process.env.GITHUB_DEPLOYMENT_APP_ID = original.appId;

  if (original.installationId === undefined) delete process.env.GITHUB_DEPLOYMENT_INSTALLATION_ID;
  else process.env.GITHUB_DEPLOYMENT_INSTALLATION_ID = original.installationId;

  if (original.privateKey === undefined) delete process.env.GITHUB_DEPLOYMENT_APP_PRIVATE_KEY;
  else process.env.GITHUB_DEPLOYMENT_APP_PRIVATE_KEY = original.privateKey;
});
