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

test('template compliance detects the official fixed vite-node shell contract', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'oneceo-baseline-official-template-test-'));
  try {
    await mkdir(join(workspace, 'client', 'src'), { recursive: true });
    await mkdir(join(workspace, 'server'), { recursive: true });
    await mkdir(join(workspace, 'shared'), { recursive: true });
    await writeFile(
      join(workspace, 'package.json'),
      JSON.stringify({
        name: 'oneceo-official-shell',
        scripts: {
          build: 'vite build && esbuild server/index.ts --platform=node --bundle --outfile=dist/index.js',
          start: 'node dist/index.js',
        },
        dependencies: {
          react: '^19.0.0',
          'react-dom': '^19.0.0',
        },
        devDependencies: {
          esbuild: '^0.25.0',
          vite: '^7.0.0',
        },
      }),
      'utf-8'
    );
    await writeFile(
      join(workspace, 'client/index.html'),
      '<!doctype html><html><body><!-- ONECEO_ANALYTICS:START --><div id="root"></div></body></html>',
      'utf-8'
    );
    await writeFile(
      join(workspace, 'server/index.ts'),
      "app.get('/api/system/health', (_req, res) => res.json({ ok: true }));\n",
      'utf-8'
    );

    const compliance = await ensureTemplateCompliance(workspace);

    assert.equal(compliance.ok, true);
    assert.equal(compliance.manifest.stack, 'oneceo_fixed_vite_node_shell');
    assert.equal(compliance.manifest.start.command, 'node dist/index.js');
    assert.equal(compliance.manifest.build.outputDir, 'dist/public');
    assert.equal(compliance.checks.officialTemplateDetected, true);
    assert.match(compliance.warnings.join(' | '), /官方固定模板壳/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('deployment source normalization can adapt a generic frontend project into the official fixed shell', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'oneceo-official-shell-adapt-test-'));
  try {
    await mkdir(join(workspace, 'src'), { recursive: true });
    await mkdir(join(workspace, 'public'), { recursive: true });
    await writeFile(
      join(workspace, 'package.json'),
      JSON.stringify({
        name: 'generic-frontend-app',
        scripts: {
          build: 'vite build',
          start: 'vite preview',
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
    await writeFile(join(workspace, 'src/main.jsx'), 'console.log("app");\n', 'utf-8');

    const normalization = await normalizeDeploymentSourceDirectoryForPublish(workspace);
    const compliance = await ensureTemplateCompliance(workspace);
    const packageJson = JSON.parse(await readFile(join(workspace, 'package.json'), 'utf-8'));
    const manifest = JSON.parse(await readFile(join(workspace, 'oneceo.manifest.json'), 'utf-8'));
    const viteConfig = await readFile(join(workspace, 'vite.config.ts'), 'utf-8');
    const serverSource = await readFile(join(workspace, 'server/index.ts'), 'utf-8');

    assert.equal(normalization.adaptedOfficialFrontendShell, true);
    assert.equal(packageJson.scripts.start, 'node dist/index.js');
    assert.match(packageJson.scripts.build, /esbuild server\/index\.ts/);
    assert.equal(packageJson.dependencies?.express, undefined);
    assert.equal(manifest.stack, 'oneceo_fixed_vite_node_shell');
    assert.equal(manifest.build.command, 'npm run build');
    assert.equal(compliance.checks.officialTemplateDetected, true);
    assert.match(viteConfig, /root: path\.resolve\(__dirname, 'client'\)/);
    assert.match(viteConfig, /dist\/public/);
    assert.match(serverSource, /oneceo-official-web-shell/);
    assert.match(serverSource, /node:http/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('deployment template baseline does not auto-declare railway_postgres from pg dependency alone', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'oneceo-baseline-pg-infer-test-'));
  try {
    await mkdir(join(workspace, 'client'), { recursive: true });
    await mkdir(join(workspace, 'server'), { recursive: true });
    await writeFile(
      join(workspace, 'package.json'),
      JSON.stringify({
        name: 'baseline-pg-demo',
        dependencies: {
          pg: '^8.11.0',
        },
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

    assert.equal(compliance.ok, true);
    assert.equal(compliance.manifest.features.database, false);
    assert.equal(compliance.checks.databaseDependencyDetected, null);
    assert.equal(baseline.status, 'ready');
    assert.equal(baseline.features.database, false);
    assert.equal(baseline.checks.database, null);
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

test('deployment template baseline normalizes PHP built-in server healthcheck to root path', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'oneceo-baseline-php-health-test-'));
  try {
    await writeFile(
      join(workspace, 'index.php'),
      [
        '<?php',
        '$requestUri = $_SERVER[\'REQUEST_URI\'] ?? \'/\';',
        'if ($requestUri === \'/\') {',
        '  echo \'<!doctype html><!-- ONECEO_ANALYTICS:START --><html><body><h1>PHP Site</h1></body></html>\';',
        '  return;',
        '}',
        'http_response_code(404);',
        'echo \'not found\';',
      ].join('\n'),
      'utf-8'
    );
    await writeFile(
      join(workspace, 'oneceo.manifest.json'),
      JSON.stringify(
        {
          templateVersion: '1.0.0',
          appType: 'web_app',
          stack: 'php',
          build: { command: "echo 'PHP app ready'", outputDir: '.' },
          start: { command: 'php -S 0.0.0.0:$PORT', portEnv: 'PORT' },
          healthcheck: { path: '/api/system/health' },
          features: {
            analytics: true,
            userTracking: true,
            database: false,
            auth: 'optional',
            objectStorage: false,
          },
          runtime: { framework: 'php', transport: 'http' },
        },
        null,
        2
      ),
      'utf-8'
    );

    const compliance = await ensureTemplateCompliance(workspace);
    const baseline = buildDeploymentTemplateBaseline({
      workspaceDetected: true,
      compliance,
    });

    assert.equal(compliance.manifest.healthcheck.path, '/');
    assert.equal(compliance.checks.healthcheckRouteDetected, true);
    assert.equal(baseline.healthcheckPath, '/');
    assert.match(
      compliance.warnings.join(' | '),
      /PHP 站点入口且未提供显式健康检查路由，已将 manifest 健康检查标准化为 \//
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('deployment source normalization builds php baseline and inherits umami bootstrap safely', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'oneceo-baseline-php-test-'));
  try {
    await writeFile(
      join(workspace, 'index.php'),
      [
        '<?php $title = "PHP Site"; ?>',
        '<!doctype html>',
        '<html>',
        '<head><title><?= htmlspecialchars($title, ENT_QUOTES) ?></title></head>',
        '<body><main>php app</main></body>',
        '</html>',
      ].join('\n'),
      'utf-8'
    );

    const normalization = await normalizeDeploymentSourceDirectoryForPublish(workspace);
    const bootstrap = await ensureDeploymentTemplateBootstrap(workspace, {
      analyticsConfig: {
        enabled: true,
        host: 'https://analytics.oneceo.ai',
        websiteId: 'test-website-id',
        publicDomain: 'app.example.com',
      },
    });
    const compliance = await ensureTemplateCompliance(workspace);
    const manifest = JSON.parse(await readFile(join(workspace, 'oneceo.manifest.json'), 'utf-8'));
    const railwayConfig = JSON.parse(await readFile(join(workspace, 'railway.json'), 'utf-8'));
    const phpSource = await readFile(join(workspace, 'index.php'), 'utf-8');

    assert.equal(normalization.injectedPhpBaseline, true);
    assert.equal(normalization.injectedPythonBaseline, false);
    assert.equal(bootstrap.analyticsInjected, true);
    assert.equal(compliance.ok, true);
    assert.equal(compliance.manifest.runtime.framework, 'php');
    assert.equal(compliance.manifest.start.command, 'php -S 0.0.0.0:$PORT -t .');
    assert.equal(compliance.manifest.healthcheck.path, '/');
    assert.equal(manifest.features.analytics, true);
    assert.equal(manifest.features.userTracking, true);
    assert.equal(railwayConfig.deploy.startCommand, 'php -S 0.0.0.0:$PORT -t .');
    assert.equal(railwayConfig.deploy.healthcheckPath, '/');
    assert.match(phpSource, /ONECEO_ANALYTICS:START/);
    assert.match(phpSource, /analytics\.oneceo\.ai/);
    assert.match(phpSource, /test-website-id/);
    assert.doesNotMatch(phpSource, /ONECEO_ANALYTICS:START[\s\S]*<\?php/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('deployment source normalization builds java manifest without forcing publish readiness', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'oneceo-baseline-java-test-'));
  try {
    await writeFile(
      join(workspace, 'pom.xml'),
      '<project><modelVersion>4.0.0</modelVersion><artifactId>demo</artifactId></project>',
      'utf-8'
    );

    const normalization = await normalizeDeploymentSourceDirectoryForPublish(workspace);
    await ensureDeploymentTemplateBootstrap(workspace);
    const compliance = await ensureTemplateCompliance(workspace);
    const manifest = JSON.parse(await readFile(join(workspace, 'oneceo.manifest.json'), 'utf-8'));
    const railwayConfig = JSON.parse(await readFile(join(workspace, 'railway.json'), 'utf-8'));

    assert.equal(normalization.injectedJavaBaseline, true);
    assert.equal(manifest.runtime.framework, 'java_maven');
    assert.equal(manifest.build.command, 'mvn package -DskipTests');
    assert.equal(manifest.start.command, "sh -c 'java -jar target/*.jar'");
    assert.equal(railwayConfig.deploy.startCommand, "sh -c 'java -jar target/*.jar'");
    assert.equal(compliance.ok, false);
    assert.equal(compliance.manifest.healthcheck.path, '/');
    assert.equal(compliance.checks.startCommandDetected, true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('deployment bootstrap does not append analytics snippet to php files without html document', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'oneceo-baseline-php-script-test-'));
  try {
    await writeFile(
      join(workspace, 'index.php'),
      [
        '<?php',
        'header("Content-Type: application/json");',
        'echo json_encode(["ok" => true]);',
      ].join('\n'),
      'utf-8'
    );

    const bootstrap = await ensureDeploymentTemplateBootstrap(workspace);
    const phpSource = await readFile(join(workspace, 'index.php'), 'utf-8');

    assert.equal(bootstrap.analyticsInjected, false);
    assert.match(bootstrap.errors.join(' | '), /无法注入 analytics bootstrap/);
    assert.doesNotMatch(phpSource, /ONECEO_ANALYTICS:START/);
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
          'express-ejs-layouts': '^2.5.1',
        },
      }),
      'utf-8'
    );
    await writeFile(
      join(workspace, 'server.js'),
      [
        "const express = require('express');",
        "const expressLayouts = require('express-ejs-layouts');",
        "const app = express();",
        "app.set('view engine', 'ejs');",
        "app.set('views', __dirname + '/views');",
        "app.use(expressLayouts);",
        "app.set('layout', 'layouts/main');",
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

test('deployment template baseline rejects broken EJS body layout without layout engine wiring', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'oneceo-baseline-ejs-body-misuse-test-'));
  try {
    await mkdir(join(workspace, 'views'), { recursive: true });
    await writeFile(
      join(workspace, 'package.json'),
      JSON.stringify({
        name: 'baseline-ejs-broken-demo',
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
      join(workspace, 'views/layout.ejs'),
      '<!DOCTYPE html><html><body><main><%- body %></main></body></html>',
      'utf-8'
    );
    await writeFile(
      join(workspace, 'views/index.ejs'),
      "<% include('layout') -%>\n<section>broken server rendered</section>",
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
    assert.equal(baseline.status, 'needs_attention');
    assert.match(
      compliance.errors.join(' | '),
      /使用 <%- body %>，但项目未检测到 express-ejs-layouts \/ ejs-mate 布局接入/
    );
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

test('deployment source normalization detects analytics in python jinja2 templates', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'oneceo-baseline-python-jinja2-test-'));
  try {
    await writeFile(join(workspace, 'requirements.txt'), 'flask\ngunicorn\n', 'utf-8');
    await writeFile(
      join(workspace, 'app.py'),
      [
        'from flask import Flask, render_template',
        'app = Flask(__name__)',
        "@app.get('/health')",
        'def health():',
        "    return {'ok': True}",
        "@app.get('/')",
        'def index():',
        "    return render_template('base.jinja2')",
        '',
      ].join('\n'),
      'utf-8'
    );
    await mkdir(join(workspace, 'templates'), { recursive: true });
    await writeFile(
      join(workspace, 'templates/base.jinja2'),
      '<!doctype html><html><body><main>python jinja2 app</main></body></html>',
      'utf-8'
    );

    const normalization = await normalizeDeploymentSourceDirectoryForPublish(workspace);
    const bootstrap = await ensureDeploymentTemplateBootstrap(workspace, {
      analyticsConfig: {
        enabled: true,
        host: 'https://analytics.oneceo.ai',
        websiteId: 'site_python_jinja2',
      },
    });
    const compliance = await ensureTemplateCompliance(workspace);
    const templateSource = await readFile(join(workspace, 'templates/base.jinja2'), 'utf-8');

    assert.equal(normalization.injectedPythonBaseline, true);
    assert.equal(bootstrap.analyticsInjected, true);
    assert.equal(compliance.ok, true);
    assert.equal(compliance.manifest.runtime.framework, 'flask');
    assert.equal(compliance.manifest.start.command, 'gunicorn app:app --bind 0.0.0.0:$PORT');
    assert.equal(compliance.checks.analyticsEntryDetected, true);
    assert.match(templateSource, /site_python_jinja2/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('deployment template baseline injects analytics into spring boot resource templates', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'oneceo-baseline-java-test-'));
  try {
    await writeFile(
      join(workspace, 'oneceo.manifest.json'),
      JSON.stringify({
        templateVersion: '1.0.0',
        appType: 'web_app',
        stack: 'java_spring_boot_thymeleaf_dbless',
        build: {
          command: 'mvn clean package -DskipTests',
          outputDir: 'target',
        },
        start: {
          command: 'java -jar target/enterprise-website-1.0.0.jar',
          portEnv: 'PORT',
        },
        healthcheck: {
          path: '/api/system/health',
        },
        features: {
          analytics: true,
          userTracking: true,
          database: false,
          auth: 'optional',
          objectStorage: false,
        },
        runtime: {
          framework: 'spring_boot',
          transport: 'http',
        },
      }),
      'utf-8'
    );
    await mkdir(join(workspace, 'src/main/resources/templates'), { recursive: true });
    await mkdir(join(workspace, 'src/main/java/com/example'), { recursive: true });
    await writeFile(
      join(workspace, 'src/main/resources/templates/index.html'),
      '<!doctype html><html><body><main>java spring boot app</main></body></html>',
      'utf-8'
    );
    await writeFile(
      join(workspace, 'src/main/java/com/example/HealthController.java'),
      '@GetMapping("/api/system/health") String health() { return "ok"; }\n',
      'utf-8'
    );

    const bootstrap = await ensureDeploymentTemplateBootstrap(workspace, {
      analyticsConfig: {
        enabled: true,
        host: 'https://analytics.oneceo.ai',
        websiteId: 'site_java_spring',
      },
    });
    const compliance = await ensureTemplateCompliance(workspace);
    const templateSource = await readFile(
      join(workspace, 'src/main/resources/templates/index.html'),
      'utf-8'
    );

    assert.equal(bootstrap.analyticsInjected, true);
    assert.match(bootstrap.analyticsTargetPath || '', /src\/main\/resources\/templates\/index\.html$/);
    assert.equal(compliance.ok, true);
    assert.equal(compliance.checks.analyticsEntryDetected, true);
    assert.equal(compliance.manifest.healthcheck.path, '/');
    assert.equal(compliance.checks.healthcheckRouteDetected, false);
    assert.match(templateSource, /site_java_spring/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('deployment source normalization converts vite-style frontend into the official fixed shell', async () => {
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
    await writeFile(
      join(workspace, 'src/App.jsx'),
      'export default function App() { return <button onClick={() => React.useState(0)}>Hello</button>; }\n',
      'utf-8'
    );

    const normalization = await normalizeDeploymentSourceDirectoryForPublish(workspace);
    const bootstrap = await ensureDeploymentTemplateBootstrap(workspace);
    const compliance = await ensureTemplateCompliance(workspace);
    const serverSource = await readFile(join(workspace, 'server', 'index.ts'), 'utf-8');
    const viteConfigSource = await readFile(join(workspace, 'vite.config.ts'), 'utf-8');
    const appSource = await readFile(join(workspace, 'client', 'src', 'App.jsx'), 'utf-8');
    const packageJson = JSON.parse(await readFile(join(workspace, 'package.json'), 'utf-8'));

    assert.equal(normalization.adaptedOfficialFrontendShell, true);
    assert.equal(normalization.injectedBuiltFrontendBaseline, false);
    assert.equal(normalization.injectedStaticBaseline, false);
    assert.equal(normalization.injectedNodeScriptBaseline, false);
    assert.equal(packageJson.scripts.start, 'node dist/index.js');
    assert.match(serverSource, /oneceo-official-web-shell/);
    assert.match(serverSource, /node:http/);
    assert.match(serverSource, /VITE_ANALYTICS_WEBSITE_ID/);
    assert.match(serverSource, /injectRuntimeAnalytics/);
    assert.match(viteConfigSource, /'@shared': path\.resolve\(__dirname, 'shared'\)/);
    assert.doesNotMatch(viteConfigSource, /jsxInject/);
    assert.match(appSource, /^import \* as React from 'react';/);
    assert.equal(compliance.ok, true);
    assert.equal(compliance.manifest.start.command, 'node dist/index.js');
    assert.equal(compliance.manifest.build.outputDir, 'dist/public');
    assert.equal(bootstrap.analyticsInjected, true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('deployment source normalization binds React namespace references in JS entries', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'oneceo-baseline-react-js-entry-test-'));
  try {
    await mkdir(join(workspace, 'src'), { recursive: true });
    await writeFile(
      join(workspace, 'package.json'),
      JSON.stringify({
        name: 'baseline-react-js-entry-demo',
        scripts: {
          build: 'vite build',
          start: 'vite preview',
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
    await writeFile(
      join(workspace, 'src/main.jsx'),
      "import ReactDOM from 'react-dom/client';\nimport App from './App.js';\nReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));\n",
      'utf-8'
    );
    await writeFile(
      join(workspace, 'src/App.js'),
      "import { useState } from 'react';\nexport default function App() { const [count] = useState(0); return React.createElement('main', null, count); }\n",
      'utf-8'
    );

    const normalization = await normalizeDeploymentSourceDirectoryForPublish(workspace);
    const mainSource = await readFile(join(workspace, 'client', 'src', 'main.jsx'), 'utf-8');
    const appSource = await readFile(join(workspace, 'client', 'src', 'App.js'), 'utf-8');

    assert.equal(normalization.adaptedOfficialFrontendShell, true);
    assert.match(mainSource, /^import \* as React from 'react';/);
    assert.match(appSource, /^import \* as React from 'react';/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('deployment source normalization rewrites existing frontend manifest and railway config onto the official fixed shell', async () => {
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
    const serverSource = await readFile(join(workspace, 'server', 'index.ts'), 'utf-8');

    assert.equal(normalization.adaptedOfficialFrontendShell, true);
    assert.equal(normalization.injectedBuiltFrontendBaseline, false);
    assert.equal(packageJson.scripts.start, 'node dist/index.js');
    assert.equal(manifest.start.command, 'node dist/index.js');
    assert.equal(manifest.start.portEnv, 'PORT');
    assert.equal(manifest.healthcheck.path, '/api/system/health');
    assert.equal(manifest.build.outputDir, 'dist/public');
    assert.equal(railwayConfig.deploy.startCommand, 'node dist/index.js');
    assert.equal(railwayConfig.deploy.healthcheckPath, '/api/system/health');
    assert.match(serverSource, /oneceo-official-web-shell/);
    assert.match(serverSource, /node:http/);
    assert.match(serverSource, /VITE_ANALYTICS_WEBSITE_ID/);
    assert.match(serverSource, /injectRuntimeAnalytics/);
    assert.equal(bootstrap.analyticsInjected, true);
    assert.equal(compliance.ok, true);
    assert.equal(compliance.manifest.start.command, 'node dist/index.js');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('deployment source normalization replaces commonjs server with the official fixed shell when frontend package uses esm mode', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'oneceo-baseline-frontend-esm-server-test-'));
  try {
    await mkdir(join(workspace, 'src'), { recursive: true });
    await writeFile(
      join(workspace, 'package.json'),
      JSON.stringify({
        name: 'baseline-vite-esm-server-demo',
        type: 'module',
        scripts: {
          build: 'vite build',
          start: 'node server.js',
        },
        dependencies: {
          vue: '^3.4.0',
          express: '^4.18.2',
        },
        devDependencies: {
          vite: '^5.0.0',
        },
      }),
      'utf-8'
    );
    await writeFile(
      join(workspace, 'index.html'),
      '<!doctype html><html><body><div id="app"></div><script type="module" src="/src/main.js"></script></body></html>',
      'utf-8'
    );
    await writeFile(join(workspace, 'src/main.js'), 'console.log("hello");\n', 'utf-8');
    await writeFile(
      join(workspace, 'server.js'),
      "const express = require('express');\nconst app = express();\napp.listen(process.env.PORT || 8080);\n",
      'utf-8'
    );

    const normalization = await normalizeDeploymentSourceDirectoryForPublish(workspace);
    await ensureDeploymentTemplateBootstrap(workspace);
    const compliance = await ensureTemplateCompliance(workspace);
    const packageJson = JSON.parse(await readFile(join(workspace, 'package.json'), 'utf-8'));
    const generatedServer = await readFile(join(workspace, 'server', 'index.ts'), 'utf-8');
    const originalServer = await readFile(join(workspace, 'server.js'), 'utf-8');

    assert.equal(normalization.adaptedOfficialFrontendShell, true);
    assert.equal(normalization.injectedBuiltFrontendBaseline, false);
    assert.equal(packageJson.scripts.start, 'node dist/index.js');
    assert.match(originalServer, /require\('express'\)/);
    assert.match(generatedServer, /oneceo-official-web-shell/);
    assert.match(generatedServer, /node:http/);
    assert.equal(compliance.ok, true);
    assert.equal(compliance.manifest.start.command, 'node dist/index.js');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('deployment source normalization replaces frontend server shell with the official fixed shell when runtime analytics is missing', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'oneceo-baseline-frontend-server-cjs-test-'));
  try {
    await mkdir(join(workspace, 'src'), { recursive: true });
    await writeFile(
      join(workspace, 'package.json'),
      JSON.stringify({
        name: 'baseline-vite-server-cjs-demo',
        type: 'module',
        scripts: {
          build: 'vite build',
          start: 'node server.cjs',
        },
        dependencies: {
          vue: '^3.4.0',
          express: '^4.18.2',
        },
        devDependencies: {
          vite: '^5.0.0',
        },
      }),
      'utf-8'
    );
    await writeFile(
      join(workspace, 'index.html'),
      '<!doctype html><html><body><div id="app"></div><script type="module" src="/src/main.js"></script></body></html>',
      'utf-8'
    );
    await writeFile(join(workspace, 'src/main.js'), 'console.log("hello");\n', 'utf-8');
    await writeFile(
      join(workspace, 'server.cjs'),
      "const express = require('express');\nconst app = express();\napp.use(express.static('dist'));\napp.listen(process.env.PORT || 8080);\n",
      'utf-8'
    );

    const normalization = await normalizeDeploymentSourceDirectoryForPublish(workspace);
    await ensureDeploymentTemplateBootstrap(workspace);
    const compliance = await ensureTemplateCompliance(workspace);
    const packageJson = JSON.parse(await readFile(join(workspace, 'package.json'), 'utf-8'));
    const generatedServer = await readFile(join(workspace, 'server', 'index.ts'), 'utf-8');

    assert.equal(normalization.adaptedOfficialFrontendShell, true);
    assert.equal(normalization.injectedBuiltFrontendBaseline, false);
    assert.equal(packageJson.scripts.start, 'node dist/index.js');
    assert.match(generatedServer, /oneceo-official-web-shell/);
    assert.match(generatedServer, /node:http/);
    assert.equal(compliance.ok, true);
    assert.equal(compliance.manifest.start.command, 'node dist/index.js');
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

test('deployment source normalization converts frontend projects with public/index.html into the official fixed shell', async () => {
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
    const serverSource = await readFile(join(workspace, 'server', 'index.ts'), 'utf-8');
    const rootIndex = await readFile(join(workspace, 'client', 'index.html'), 'utf-8');

    assert.equal(normalization.adaptedOfficialFrontendShell, true);
    assert.equal(normalization.injectedBuiltFrontendBaseline, false);
    assert.equal(packageJson.scripts.start, 'node dist/index.js');
    assert.match(rootIndex, /<div id="root"><\/div>/);
    assert.match(serverSource, /oneceo-official-web-shell/);
    assert.match(serverSource, /node:http/);
    assert.equal(compliance.ok, true);
    assert.equal(compliance.manifest.start.command, 'node dist/index.js');
    assert.equal(compliance.manifest.build.outputDir, 'dist/public');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
