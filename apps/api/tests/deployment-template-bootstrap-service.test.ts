import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { ensureDeploymentTemplateBootstrap } from '../src/services/deployment-template-bootstrap-service';

async function withTempHtml(
  html: string,
  run: (dir: string, htmlPath: string) => Promise<void>
) {
  const dir = await mkdtemp(join(tmpdir(), 'oneceo-bootstrap-test-'));
  const htmlPath = join(dir, 'index.html');
  try {
    await writeFile(htmlPath, html, 'utf-8');
    await run(dir, htmlPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('ensureDeploymentTemplateBootstrap injects runtime config without vite placeholders', async () => {
  await withTempHtml('<html><body><div id="app"></div></body></html>', async (dir, htmlPath) => {
    const report = await ensureDeploymentTemplateBootstrap(dir, {
      analyticsConfig: {
        enabled: true,
        host: 'https://stats.oneceo.ai',
        websiteId: 'site_123',
        tag: 'production',
        publicDomain: 'demo.oneceo.app',
      },
    });

    const output = await readFile(htmlPath, 'utf-8');
    assert.equal(report.analyticsInjected, true);
    assert.match(output, /https:\/\/stats\.oneceo\.ai/);
    assert.match(output, /site_123/);
    assert.match(output, /demo\.oneceo\.app/);
    assert.doesNotMatch(output, /%VITE_[A-Z0-9_]+%/);
  });
});

test('ensureDeploymentTemplateBootstrap injects disabled default config for inspection flow', async () => {
  await withTempHtml('<html><body><main>demo</main></body></html>', async (dir, htmlPath) => {
    await ensureDeploymentTemplateBootstrap(dir);

    const output = await readFile(htmlPath, 'utf-8');
    assert.match(output, /"enabled":false/);
    assert.doesNotMatch(output, /%VITE_[A-Z0-9_]+%/);
  });
});
