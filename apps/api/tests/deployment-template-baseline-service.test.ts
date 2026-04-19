import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { ensureDeploymentTemplateBootstrap } from '../src/services/deployment-template-bootstrap-service';
import { ensureTemplateCompliance } from '../src/services/template-compliance-service';
import {
  buildDeploymentTemplateBaseline,
  normalizeDeploymentSourceDirectoryForPublish,
} from '../src/services/task-creation-deployment-source-service';

const execFile = promisify(execFileCallback);

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

test('deployment source normalization promotes single nested static app into deployable root baseline', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'oneceo-baseline-static-test-'));
  try {
    const nestedAppDir = join(workspace, '2048-game');
    await mkdir(nestedAppDir, { recursive: true });
    await writeFile(join(workspace, 'server.log'), 'placeholder', 'utf-8');
    await writeFile(
      join(nestedAppDir, 'index.html'),
      '<!doctype html><html><body><div class="game">2048</div></body></html>',
      'utf-8'
    );

    const normalization = await normalizeDeploymentSourceDirectoryForPublish(workspace);
    const bootstrap = await ensureDeploymentTemplateBootstrap(workspace);
    const compliance = await ensureTemplateCompliance(workspace);
    const baseline = buildDeploymentTemplateBaseline({
      workspaceDetected: true,
      bootstrap,
      compliance,
    });

    assert.equal(normalization.promotedNestedApp, true);
    assert.equal(normalization.injectedStaticBaseline, true);
    assert.equal(normalization.injectedNodeScriptBaseline, false);
    assert.equal(normalization.injectedPythonBaseline, false);
    assert.equal(compliance.ok, true);
    assert.equal(compliance.manifest.start.command, 'node server.js');
    assert.equal(compliance.manifest.healthcheck.path, '/api/system/health');
    assert.equal(compliance.checks.buildCommandDetected, true);
    assert.equal(compliance.checks.startCommandDetected, true);
    assert.equal(compliance.checks.analyticsEntryDetected, true);
    assert.equal(compliance.checks.healthcheckRouteDetected, true);
    assert.equal(baseline.status, 'ready');
    const railwayConfig = await readFile(join(workspace, 'railway.json'), 'utf-8');
    assert.match(railwayConfig, /"startCommand": "node server\.js"/);
    assert.match(railwayConfig, /"healthcheckPath": "\/api\/system\/health"/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('deployment source normalization builds node script baseline without package.json', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'oneceo-baseline-node-script-test-'));
  try {
    await writeFile(
      join(workspace, 'server.js'),
      "require('node:http').createServer((_, res) => res.end('ok')).listen(process.env.PORT || 3000);\n",
      'utf-8'
    );
    await mkdir(join(workspace, 'templates'), { recursive: true });
    await writeFile(
      join(workspace, 'templates/index.html'),
      '<!doctype html><html><body><div id="app">node script</div></body></html>',
      'utf-8'
    );

    const normalization = await normalizeDeploymentSourceDirectoryForPublish(workspace);
    const bootstrap = await ensureDeploymentTemplateBootstrap(workspace);
    const compliance = await ensureTemplateCompliance(workspace);

    assert.equal(normalization.injectedStaticBaseline, false);
    assert.equal(normalization.injectedNodeScriptBaseline, true);
    assert.equal(compliance.ok, true);
    assert.equal(compliance.manifest.runtime.framework, 'node_script');
    assert.equal(compliance.manifest.start.command, 'node server.js');
    assert.equal(compliance.checks.startCommandDetected, true);
    assert.equal(bootstrap.analyticsInjected, true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('deployment template baseline accepts analytics injected into server-rendered EJS layout', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'oneceo-baseline-ejs-layout-test-'));
  try {
    await mkdir(join(workspace, 'views/layouts'), { recursive: true });
    await writeFile(
      join(workspace, 'package.json'),
      JSON.stringify({
        name: 'baseline-ejs-demo',
        scripts: {
          build: 'echo "ready"',
          start: 'node server.js',
        },
        dependencies: {
          express: '^4.18.2',
          ejs: '^3.1.9',
        },
      }),
      'utf-8'
    );
    await writeFile(
      join(workspace, 'server.js'),
      [
        "const express = require('express');",
        "const app = express();",
        "app.set('view engine', 'ejs');",
        "app.set('views', __dirname + '/views');",
        "app.get('/', (_req, res) => res.render('index'));",
        "app.get('/api/system/health', (_req, res) => res.json({ ok: true }));",
        "app.listen(process.env.PORT || 8080);",
      ].join('\n'),
      'utf-8'
    );
    await writeFile(
      join(workspace, 'views/layouts/main.ejs'),
      '<!DOCTYPE html><html><head><title><%= title || "Demo" %></title></head><body><%- body %></body></html>',
      'utf-8'
    );
    await writeFile(
      join(workspace, 'views/index.ejs'),
      '<section>server rendered</section>',
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
    assert.equal(compliance.checks.analyticsEntryDetected, true);
    assert.equal(compliance.ok, true);
    assert.equal(baseline.status, 'ready');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('deployment source normalization builds python fastapi baseline without package.json', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'oneceo-baseline-python-test-'));
  try {
    await writeFile(
      join(workspace, 'requirements.txt'),
      'fastapi\nuvicorn\n',
      'utf-8'
    );
    await writeFile(
      join(workspace, 'main.py'),
      "from fastapi import FastAPI\napp = FastAPI()\n@app.get('/health')\ndef health():\n    return {'ok': True}\n",
      'utf-8'
    );
    await mkdir(join(workspace, 'templates'), { recursive: true });
    await writeFile(
      join(workspace, 'templates/index.html'),
      '<!doctype html><html><body><main>python app</main></body></html>',
      'utf-8'
    );

    const normalization = await normalizeDeploymentSourceDirectoryForPublish(workspace);
    const bootstrap = await ensureDeploymentTemplateBootstrap(workspace);
    const compliance = await ensureTemplateCompliance(workspace);
    const railwayConfig = await readFile(join(workspace, 'railway.json'), 'utf-8');

    assert.equal(normalization.injectedPythonBaseline, true);
    assert.equal(compliance.ok, true);
    assert.equal(compliance.manifest.runtime.framework, 'fastapi');
    assert.match(compliance.manifest.start.command, /^uvicorn main:app --host 0\.0\.0\.0 --port \$PORT$/);
    assert.equal(compliance.checks.startCommandDetected, true);
    assert.equal(bootstrap.analyticsInjected, true);
    assert.match(railwayConfig, /uvicorn main:app --host 0\.0\.0\.0 --port \$PORT/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('deployment source normalization converts vite-style frontend into dist-serving deployment baseline', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'oneceo-baseline-built-frontend-test-'));
  try {
    await mkdir(join(workspace, 'src'), { recursive: true });
    await writeFile(
      join(workspace, 'package.json'),
      JSON.stringify({
        name: 'baseline-vite-demo',
        scripts: {
          build: 'vite build',
          start: 'vite preview',
          preview: 'vite preview',
        },
        dependencies: {
          react: '^19.0.0',
          'react-dom': '^19.0.0',
        },
        devDependencies: {
          vite: '^7.0.0',
        },
      }),
      'utf-8'
    );
    await writeFile(
      join(workspace, 'index.html'),
      '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>',
      'utf-8'
    );
    await writeFile(join(workspace, 'src/main.jsx'), 'console.log("hello");\n', 'utf-8');

    const normalization = await normalizeDeploymentSourceDirectoryForPublish(workspace);
    const bootstrap = await ensureDeploymentTemplateBootstrap(workspace);
    const compliance = await ensureTemplateCompliance(workspace);
    const serverSource = await readFile(join(workspace, 'server.js'), 'utf-8');
    const packageJson = JSON.parse(await readFile(join(workspace, 'package.json'), 'utf-8'));

    assert.equal(normalization.injectedBuiltFrontendBaseline, true);
    assert.equal(normalization.injectedStaticBaseline, false);
    assert.equal(normalization.injectedNodeScriptBaseline, false);
    assert.equal(packageJson.scripts.start, 'node server.js');
    assert.match(serverSource, /rootDir = path\.join\(__dirname, 'dist'\)/);
    assert.match(serverSource, /ONECEO_ANALYTICS:START/);
    assert.match(serverSource, /data-oneceo-analytics/);
    assert.equal(compliance.ok, true);
    assert.equal(compliance.manifest.start.command, 'node server.js');
    assert.equal(compliance.manifest.build.outputDir, 'dist');
    assert.equal(bootstrap.analyticsInjected, true);
    await execFile('node', ['--check', join(workspace, 'server.js')]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('deployment source normalization rewrites existing frontend manifest and railway config away from preview mode', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'oneceo-baseline-frontend-manifest-test-'));
  try {
    await mkdir(join(workspace, 'src'), { recursive: true });
    await writeFile(
      join(workspace, 'package.json'),
      JSON.stringify({
        name: 'baseline-vite-manifest-demo',
        scripts: {
          build: 'vite build',
          preview: 'vite preview',
        },
        dependencies: {
          react: '^19.0.0',
          'react-dom': '^19.0.0',
        },
        devDependencies: {
          vite: '^7.0.0',
        },
      }),
      'utf-8'
    );
    await writeFile(
      join(workspace, 'index.html'),
      '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>',
      'utf-8'
    );
    await writeFile(join(workspace, 'src/main.jsx'), 'console.log("hello");\n', 'utf-8');
    await writeFile(
      join(workspace, 'oneceo.manifest.json'),
      JSON.stringify({
        templateVersion: '1.0.0',
        appType: 'web_app',
        stack: 'vite-react',
        build: { command: 'npm run build', outputDir: 'dist' },
        start: { command: 'npm run preview', portEnv: 'PORT' },
        healthcheck: { path: '/' },
        features: {
          frontend: true,
          routing: true,
          responsive: true,
        },
        runtime: { node: '18.x' },
      }),
      'utf-8'
    );
    await writeFile(
      join(workspace, 'railway.json'),
      JSON.stringify({
        deploy: { startCommand: 'npm run preview', healthcheckPath: '/' },
        build: { buildCommand: 'npm run build' },
      }),
      'utf-8'
    );

    const normalization = await normalizeDeploymentSourceDirectoryForPublish(workspace);
    const bootstrap = await ensureDeploymentTemplateBootstrap(workspace);
    const compliance = await ensureTemplateCompliance(workspace);
    const packageJson = JSON.parse(await readFile(join(workspace, 'package.json'), 'utf-8'));
    const manifest = JSON.parse(await readFile(join(workspace, 'oneceo.manifest.json'), 'utf-8'));
    const railwayConfig = JSON.parse(await readFile(join(workspace, 'railway.json'), 'utf-8'));
    const serverSource = await readFile(join(workspace, 'server.js'), 'utf-8');

    assert.equal(normalization.injectedBuiltFrontendBaseline, true);
    assert.equal(packageJson.scripts.start, 'node server.js');
    assert.equal(manifest.start.command, 'node server.js');
    assert.equal(manifest.start.portEnv, 'PORT');
    assert.equal(manifest.healthcheck.path, '/api/system/health');
    assert.equal(manifest.build.outputDir, 'dist');
    assert.equal(railwayConfig.deploy.startCommand, 'node server.js');
    assert.equal(railwayConfig.deploy.healthcheckPath, '/api/system/health');
    assert.match(serverSource, /ONECEO_ANALYTICS:START/);
    assert.match(serverSource, /data-oneceo-analytics/);
    assert.equal(bootstrap.analyticsInjected, true);
    assert.equal(compliance.ok, true);
    assert.equal(compliance.manifest.start.command, 'node server.js');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('deployment template baseline accepts analytics injected into public/index.html', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'oneceo-baseline-public-html-test-'));
  try {
    await mkdir(join(workspace, 'public'), { recursive: true });
    await writeFile(
      join(workspace, 'package.json'),
      JSON.stringify({
        name: 'baseline-public-html-demo',
        scripts: {
          build: 'node -e "console.log(\'ready\')"',
          start: 'node server.js',
        },
      }),
      'utf-8'
    );
    await writeFile(
      join(workspace, 'server.js'),
      [
        "const http = require('node:http');",
        "http.createServer((req, res) => {",
        "  if (req.url === '/api/system/health') {",
        "    res.setHeader('Content-Type', 'application/json');",
        "    res.end(JSON.stringify({ ok: true }));",
        '    return;',
        '  }',
        "  res.end('ok');",
        "}).listen(process.env.PORT || 8080);",
      ].join('\n'),
      'utf-8'
    );
    await writeFile(
      join(workspace, 'oneceo.manifest.json'),
      JSON.stringify({
        templateVersion: '1.0.0',
        appType: 'web_app',
        stack: 'static_node_http_api_dbless',
        build: { command: 'npm run build', outputDir: '.' },
        start: { command: 'node server.js', portEnv: 'PORT' },
        healthcheck: { path: '/api/system/health' },
        features: {
          analytics: true,
          userTracking: true,
          database: false,
          auth: false,
          objectStorage: false,
        },
        runtime: { framework: 'static', transport: 'http' },
      }),
      'utf-8'
    );
    await writeFile(
      join(workspace, 'public/index.html'),
      '<!doctype html><html><body><main>public html app</main></body></html>',
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
    assert.equal(compliance.checks.analyticsEntryDetected, true);
    assert.equal(compliance.ok, true);
    assert.equal(baseline.status, 'ready');
    assert.equal(baseline.checks.analytics, true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('deployment source normalization converts frontend projects with public/index.html into dist-serving deployment baseline', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'oneceo-baseline-public-frontend-test-'));
  try {
    await mkdir(join(workspace, 'public'), { recursive: true });
    await mkdir(join(workspace, 'src'), { recursive: true });
    await writeFile(
      join(workspace, 'package.json'),
      JSON.stringify({
        name: 'baseline-public-frontend-demo',
        scripts: {
          build: 'vite build',
        },
        dependencies: {
          react: '^19.0.0',
          'react-dom': '^19.0.0',
        },
        devDependencies: {
          vite: '^7.0.0',
        },
      }),
      'utf-8'
    );
    await writeFile(
      join(workspace, 'public/index.html'),
      '<!doctype html><html><body><div id="root"></div></body></html>',
      'utf-8'
    );
    await writeFile(join(workspace, 'src/main.jsx'), 'console.log(\"hello\");\n', 'utf-8');

    const normalization = await normalizeDeploymentSourceDirectoryForPublish(workspace);
    await ensureDeploymentTemplateBootstrap(workspace);
    const compliance = await ensureTemplateCompliance(workspace);
    const packageJson = JSON.parse(await readFile(join(workspace, 'package.json'), 'utf-8'));
    const serverSource = await readFile(join(workspace, 'server.js'), 'utf-8');
    const rootIndex = await readFile(join(workspace, 'index.html'), 'utf-8');

    assert.equal(normalization.injectedBuiltFrontendBaseline, true);
    assert.equal(packageJson.scripts.start, 'node server.js');
    assert.match(rootIndex, /<div id="root"><\/div>/);
    assert.match(serverSource, /rootDir = path\.join\(__dirname, 'dist'\)/);
    assert.match(serverSource, /ONECEO_ANALYTICS:START/);
    assert.equal(compliance.ok, true);
    assert.equal(compliance.manifest.start.command, 'node server.js');
    assert.equal(compliance.manifest.build.outputDir, 'dist');
    await execFile('node', ['--check', join(workspace, 'server.js')]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
