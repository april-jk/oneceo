import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { __resetLoadApiEnvForTest, loadApiEnv } from '../src/config/load-env';

async function withTempCwd(fn: (cwd: string) => Promise<void>) {
  const original = process.cwd();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oneceo-load-env-'));
  try {
    process.chdir(tempDir);
    await fn(tempDir);
  } finally {
    process.chdir(original);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

test('loadApiEnv keeps process env as highest priority and only fills missing values from .env', async () => {
  await withTempCwd(async (cwd) => {
    const envFile = path.join(cwd, '.env');
    await fs.writeFile(
      envFile,
      [
        'ONECEO_REDIS_ENABLED=false',
        'REDIS_URL=redis://from-dotenv:6379',
        'ONECEO_API_URL=http://dotenv',
      ].join('\n'),
      'utf8'
    );

    __resetLoadApiEnvForTest();
    process.env.ONECEO_REDIS_ENABLED = 'true';
    process.env.REDIS_URL = 'redis://from-process-env:6379';
    delete process.env.ONECEO_API_URL;

    const loaded = loadApiEnv();

    assert.equal(
      await fs.realpath(loaded.loadedPath || ''),
      await fs.realpath(envFile)
    );
    assert.equal(process.env.ONECEO_REDIS_ENABLED, 'true');
    assert.equal(process.env.REDIS_URL, 'redis://from-process-env:6379');
    assert.equal(process.env.ONECEO_API_URL, 'http://dotenv');
    assert.equal(process.env.ONECEO_ENV_SOURCE, 'dotenv');
  });
});

test('loadApiEnv marks process_env when no .env file exists', async () => {
  await withTempCwd(async () => {
    __resetLoadApiEnvForTest();
    const loaded = loadApiEnv();
    assert.equal(loaded.loadedPath, undefined);
    assert.equal(process.env.ONECEO_ENV_SOURCE, 'process_env');
  });
});
