import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ensureDeploymentTemplateBootstrap } from '../src/services/deployment-template-bootstrap-service';
import { ensureTemplateCompliance } from '../src/services/template-compliance-service';
import { buildDeploymentTemplateBaseline } from '../src/services/task-creation-deployment-source-service';

test('deployment template baseline marks manifest generation and platform analytics injection', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'oneceo-baseline-test-'));
  try {
    await mkdir(join(workspace, 'client'), { recursive: true });
    await mkdir(join(workspace, 'server'), { recursive: true });
    await writeFile(
      join(workspace, 'package.json'),
      JSON.stringify({
        name: 'baseline-demo',
        scripts: {
          build: 'vite build',
          start: 'node dist/server.js',
        },
      }),
      'utf-8'
    );
    await writeFile(
      join(workspace, 'client/index.html'),
      '<!doctype html><html><body><div id="root"></div></body></html>',
      'utf-8'
    );
    await writeFile(
      join(workspace, 'server/index.ts'),
      "app.get('/api/system/health', (_req, res) => res.json({ ok: true }));\n",
      'utf-8'
    );

    const bootstrap = await ensureDeploymentTemplateBootstrap(workspace);
    const compliance = await ensureTemplateCompliance(workspace);
    const baseline = buildDeploymentTemplateBaseline({
      workspaceDetected: true,
      bootstrap,
      compliance,
    });

    assert.equal(bootstrap.analyticsInjected, true);
    assert.equal(compliance.generatedManifest, true);
    assert.equal(compliance.checks.buildCommandDetected, true);
    assert.equal(compliance.checks.startCommandDetected, true);
    assert.equal(compliance.checks.analyticsEntryDetected, true);
    assert.equal(compliance.checks.healthcheckRouteDetected, true);
    assert.equal(baseline.status, 'ready');
    assert.equal(baseline.analyticsMode, 'platform_injected');
    assert.equal(baseline.manifestGenerated, true);
    assert.equal(baseline.checks.build, true);
    assert.equal(baseline.checks.start, true);
    assert.equal(baseline.checks.analytics, true);
    assert.equal(baseline.checks.healthcheck, true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('deployment template baseline highlights missing railway database dependency', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'oneceo-baseline-db-test-'));
  try {
    await mkdir(join(workspace, 'client'), { recursive: true });
    await mkdir(join(workspace, 'server'), { recursive: true });
    await writeFile(
      join(workspace, 'package.json'),
      JSON.stringify({
        name: 'baseline-db-demo',
        scripts: {
          build: 'vite build',
          start: 'node dist/server.js',
        },
      }),
      'utf-8'
    );
    await writeFile(
      join(workspace, 'client/index.html'),
      '<!doctype html><html><body><div id="root"></div></body></html>',
      'utf-8'
    );
    await writeFile(
      join(workspace, 'server/index.ts'),
      "app.get('/api/system/health', (_req, res) => res.json({ ok: true }));\n",
      'utf-8'
    );
    await writeFile(
      join(workspace, 'oneceo.manifest.json'),
      JSON.stringify({
        templateVersion: '1.0.0',
        appType: 'web_app',
        stack: 'react_vite_http_api_dbless',
        build: { command: 'vite build', outputDir: 'dist' },
        start: { command: 'node dist/server.js', portEnv: 'PORT' },
        healthcheck: { path: '/api/system/health' },
        features: {
          analytics: true,
          userTracking: true,
          database: 'railway_postgres',
          auth: 'optional',
          objectStorage: false,
        },
        runtime: { framework: 'vite', transport: 'http' },
      }),
      'utf-8'
    );

    const bootstrap = await ensureDeploymentTemplateBootstrap(workspace);
    const compliance = await ensureTemplateCompliance(workspace);
    const baseline = buildDeploymentTemplateBaseline({
      workspaceDetected: true,
      bootstrap,
      compliance,
    });

    assert.equal(compliance.ok, false);
    assert.equal(compliance.checks.databaseDependencyDetected, false);
    assert.equal(baseline.status, 'needs_attention');
    assert.equal(baseline.checks.database, false);
    assert.match(
      baseline.errors.join(' | '),
      /database=railway_postgres，但项目未检测到 pg \/ drizzle-orm 依赖/
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
