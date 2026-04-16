import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ensureDeploymentTemplateBootstrap } from '../src/services/deployment-template-bootstrap-service';

test('deployment template bootstrap injects analytics script into html entry once', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'oneceo-bootstrap-test-'));
  try {
    const clientDir = join(workspace, 'client');
    await mkdir(clientDir, { recursive: true });
    await writeFile(
      join(workspace, 'package.json'),
      JSON.stringify({ name: 'demo', scripts: { build: 'vite build', start: 'node server.js' } }),
      'utf-8'
    );
    await writeFile(
      join(clientDir, 'index.html'),
      '<!doctype html><html><body><div id="root"></div></body></html>',
      'utf-8'
    );

    const first = await ensureDeploymentTemplateBootstrap(workspace);
    assert.equal(first.errors.length, 0);
    assert.equal(first.analyticsInjected, true);
    assert.equal(first.analyticsTargetPath, join(clientDir, 'index.html'));

    const afterFirst = await readFile(join(clientDir, 'index.html'), 'utf-8');
    assert.match(afterFirst, /ONECEO_ANALYTICS:START/);
    assert.match(afterFirst, /window\.__ONECEO_ANALYTICS__/);
    assert.match(afterFirst, /data-oneceo-analytics="runtime"/);
    assert.match(afterFirst, /%VITE_ANALYTICS_HOST%/);

    const second = await ensureDeploymentTemplateBootstrap(workspace);
    assert.equal(second.errors.length, 0);
    assert.equal(second.analyticsInjected, false);

    const afterSecond = await readFile(join(clientDir, 'index.html'), 'utf-8');
    assert.equal(afterSecond.match(/ONECEO_ANALYTICS:START/g)?.length || 0, 1);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
