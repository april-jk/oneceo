import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { loadApiEnv } from '../../src/config/load-env';

loadApiEnv();

const [
  { platformDeploymentAccountService },
  { projectStorageResourceService },
  { ensureDeploymentTemplateBootstrap },
  { ensureTemplateCompliance },
  { getRailwayDeploymentPanel, waitForRailwayDeploymentPublicReachability },
] = await Promise.all([
  import('../../src/services/platform-deployment-account-service'),
  import('../../src/services/project-storage-resource-service'),
  import('../../src/services/deployment-template-bootstrap-service'),
  import('../../src/services/template-compliance-service'),
  import('../../src/services/railway-deployment-service'),
]);

const execFile = promisify(execFileCallback);

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireEnv(name: string) {
  const value = asText(process.env[name]);
  if (!value) {
    throw new Error(`${name} 未配置`);
  }
  return value;
}

async function createSmokeWorkspace(label: string) {
  const workspace = await mkdtemp(join(tmpdir(), `oneceo-resource-deploy-${label}-`));
  await mkdir(join(workspace, 'dist'), { recursive: true }).catch(() => undefined);
  await writeFile(
    join(workspace, 'package.json'),
    `${JSON.stringify(
      {
        name: `oneceo-resource-deploy-${label}`,
        version: '1.0.0',
        private: true,
        scripts: {
          build: 'mkdir -p dist && cp server.js dist/server.js && cp index.html dist/index.html',
          start: 'node dist/server.js',
        },
      },
      null,
      2
    )}\n`,
    'utf-8'
  );
  await writeFile(
    join(workspace, 'server.js'),
    `const http = require('http');
const fs = require('fs');
const path = require('path');
const port = Number(process.env.PORT || 3000);
const htmlPath = path.join(__dirname, 'index.html');
const server = http.createServer((req, res) => {
  if (!req.url) {
    res.writeHead(400);
    return res.end('bad request');
  }
  if (req.url === '/api/system/health' || req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, app: '${label}' }));
  }
  if (req.url === '/api/resource-check') {
    const databaseUrl = String(process.env.DATABASE_URL || '');
    const bucketName = String(process.env.S3_BUCKET_NAME || '');
    const endpoint = String(process.env.S3_ENDPOINT || '');
    const accessKeyId = String(process.env.S3_ACCESS_KEY_ID || '');
    const storageEnabled = String(process.env.ONECEO_STORAGE_ENABLED || '');
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({
      ok: true,
      databaseConfigured: databaseUrl.length > 0,
      databaseHost: databaseUrl.includes('@') ? databaseUrl.split('@')[1].split('/')[0] : '',
      storageEnabled,
      bucketName,
      endpoint,
      accessKeyIdPrefix: accessKeyId.slice(0, 6),
    }));
  }
  if (req.url === '/' || req.url.startsWith('/?')) {
    const html = fs.readFileSync(htmlPath, 'utf-8');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(html);
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('not found');
});
server.listen(port, '0.0.0.0', () => {
  console.log('listening', port);
});\n`,
    'utf-8'
  );
  await writeFile(
    join(workspace, 'index.html'),
    `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>OneCEO Resource Deployment Smoke ${label}</title>
  </head>
  <body>
    <main>
      <h1>OneCEO Resource Deployment Smoke ${label}</h1>
      <p>database and storage deployment smoke</p>
    </main>
  </body>
</html>
`,
    'utf-8'
  );
  return workspace;
}

async function fetchJson(url: string) {
  const response = await fetch(url, { redirect: 'follow' });
  const text = await response.text();
  return {
    status: response.status,
    json: text ? JSON.parse(text) : null,
    text,
  };
}

async function fetchText(url: string) {
  const response = await fetch(url, { redirect: 'follow' });
  return {
    status: response.status,
    text: await response.text(),
  };
}

async function runRailwayUpFromDirectory(input: {
  sourceDir: string;
  token: string;
  projectId: string;
  environmentId: string;
  serviceId: string;
  message?: string;
}) {
  const railwayBinary = process.env.RAILWAY_CLI_PATH || 'railway';
  const args = [
    'up',
    '-d',
    '--json',
    '-p',
    input.projectId,
    '-e',
    input.environmentId,
    '-s',
    input.serviceId,
    '--path-as-root',
    '.',
  ];
  const message = asText(input.message);
  if (message) {
    args.push('-m', message);
  }

  const { stdout } = await execFile(railwayBinary, args, {
    cwd: input.sourceDir,
    maxBuffer: 16 * 1024 * 1024,
    env: {
      ...process.env,
      CI: 'true',
      RAILWAY_TOKEN: input.token,
    },
  });

  const payload = JSON.parse(stdout || '{}') as {
    deploymentId?: unknown;
  };
  return asText(payload.deploymentId);
}

async function main() {
  const adminToken = requireEnv('RAILWAY_ADMIN_TOKEN');
  const userId = 'oneceo-resource-deploy-user';
  const projectKey = `resource-deploy-${Date.now()}`;
  const workspace = await createSmokeWorkspace(projectKey);
  let account: Awaited<ReturnType<typeof platformDeploymentAccountService.ensureProjectAccount>> | null = null;
  let databaseServiceId = '';
  let bucketName = '';

  console.log(JSON.stringify({ stage: 'init', userId, projectKey, envSource: process.env.ONECEO_ENV_SOURCE || '' }));

  try {
    account = await platformDeploymentAccountService.ensureProjectAccount(userId, projectKey);
    console.log(
      JSON.stringify({
        stage: 'account-ready',
        projectId: account.projectId,
        environmentId: account.environmentId,
        serviceId: account.serviceId,
        repo: account.githubRepoFullName,
      })
    );

    const accountWithDatabase = await platformDeploymentAccountService.ensureProjectDatabaseResources(
      userId,
      projectKey
    );
    databaseServiceId = asText(accountWithDatabase.databaseServiceId);
    assert.ok(databaseServiceId, '数据库服务未创建');
    console.log(JSON.stringify({ stage: 'database-ready', databaseServiceId }));

    const storageStatus = await projectStorageResourceService.ensureRailwayBucket(userId, projectKey, {
      revealSecrets: true,
    });
    assert.equal(storageStatus.status, 'ready');
    bucketName = asText(storageStatus.bucket?.name);
    assert.ok(bucketName, '存储桶未创建');
    console.log(
      JSON.stringify({
        stage: 'storage-ready',
        bucketId: storageStatus.bucket?.id,
        bucketName,
        endpoint: storageStatus.bucket?.endpoint,
      })
    );

    const bootstrap = await ensureDeploymentTemplateBootstrap(workspace);
    assert.equal(bootstrap.errors.length, 0);
    const compliance = await ensureTemplateCompliance(workspace);
    assert.equal(compliance.ok, true);
    console.log(JSON.stringify({ stage: 'workspace-ready', workspace }));

    const deploymentId = await runRailwayUpFromDirectory({
      sourceDir: workspace,
      token: account.accessToken,
      projectId: account.projectId,
      environmentId: account.environmentId,
      serviceId: account.serviceId,
      message: `resource deploy smoke ${projectKey}`,
    });
    assert.ok(deploymentId, 'Railway CLI 未返回 deploymentId');
    console.log(JSON.stringify({ stage: 'railway-upload-done', deploymentId }));

    let panel = await getRailwayDeploymentPanel(
      {},
      {
        deploymentId,
        platformDeployment: {
          adminToken,
          token: account.accessToken,
          projectId: account.projectId,
          projectName: account.projectName,
          environmentId: account.environmentId,
          environmentName: account.environmentName,
          serviceId: account.serviceId,
          serviceName: account.serviceName,
        },
      }
    );

    const deadline = Date.now() + 15 * 60 * 1000;
    while (Date.now() < deadline) {
      const status = asText(panel.latestStatus).toUpperCase();
      console.log(JSON.stringify({ stage: 'railway-deployment-poll', deploymentId: panel.deploymentId, status }));
      if (status === 'SUCCESS') {
        break;
      }
      if (status === 'FAILED' || status === 'CRASHED' || status === 'REMOVED') {
        throw new Error(`Railway 部署失败，状态=${status}，日志=${panel.logs.map((item) => item.message).join(' | ')}`);
      }
      await sleep(10_000);
      panel = await getRailwayDeploymentPanel(
        {},
        {
          deploymentId: panel.deploymentId,
          platformDeployment: {
            adminToken,
            token: account.accessToken,
            projectId: account.projectId,
            projectName: account.projectName,
            environmentId: account.environmentId,
            environmentName: account.environmentName,
            serviceId: account.serviceId,
            serviceName: account.serviceName,
          },
        }
      );
    }

    if (asText(panel.latestStatus).toUpperCase() !== 'SUCCESS') {
      throw new Error(`Railway 部署超时，最终状态=${panel.latestStatus || 'unknown'}`);
    }

    const baseUrl = panel.latestStaticUrl || panel.latestUrl || panel.domains[0] || '';
    assert.ok(baseUrl, '部署成功后未返回访问地址');
    await waitForRailwayDeploymentPublicReachability({
      baseUrl,
      healthPath: '/api/system/health',
    });
    console.log(JSON.stringify({ stage: 'public-url-ready', baseUrl }));

    const page = await fetchText(baseUrl);
    assert.equal(page.status, 200);
    assert.match(page.text, /OneCEO Resource Deployment Smoke/);

    const health = await fetchJson(`${baseUrl.replace(/\/+$/, '')}/api/system/health`);
    assert.equal(health.status, 200);
    assert.equal(Boolean(health.json?.ok), true);

    const resourceCheck = await fetchJson(`${baseUrl.replace(/\/+$/, '')}/api/resource-check`);
    assert.equal(resourceCheck.status, 200);
    assert.equal(Boolean(resourceCheck.json?.ok), true);
    assert.equal(Boolean(resourceCheck.json?.databaseConfigured), true);
    assert.equal(asText(resourceCheck.json?.storageEnabled), 'true');
    assert.equal(asText(resourceCheck.json?.bucketName), bucketName);
    assert.ok(asText(resourceCheck.json?.endpoint), '部署后未注入存储 endpoint');
    assert.ok(asText(resourceCheck.json?.accessKeyIdPrefix), '部署后未注入存储 access key');
    assert.ok(asText(resourceCheck.json?.databaseHost), '部署后未注入数据库连接');

    console.log(
      JSON.stringify(
        {
          ok: true,
          projectKey,
          projectId: account.projectId,
          environmentId: account.environmentId,
          serviceId: account.serviceId,
          databaseServiceId,
          bucketName,
          deploymentId: panel.deploymentId,
          deploymentStatus: panel.latestStatus,
          url: baseUrl,
          resourceCheck: resourceCheck.json,
        },
        null,
        2
      )
    );
  } finally {
    await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
    await platformDeploymentAccountService.cleanupFailedProjectResources(userId, projectKey).catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});
