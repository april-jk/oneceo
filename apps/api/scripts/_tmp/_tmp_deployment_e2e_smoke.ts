import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
dotenv.config({
  path: resolve(currentDir, '../../../.env'),
  override: true,
});

const [{ platformDeploymentAccountService }, { prepareTaskSessionAnalyticsBinding }, { ensureDeploymentTemplateBootstrap }, { ensureTemplateCompliance }, { pushDirectoryToManagedRepository }, { getRailwayDeploymentPanel, waitForRailwayDeploymentAfterSourceSync, waitForRailwayDeploymentPublicReachability }, { requestRailwayGraphql }, { umamiAnalyticsService }] =
  await Promise.all([
    import('../../src/services/platform-deployment-account-service'),
    import('../../src/services/task-session-deployment-analytics-service'),
    import('../../src/services/deployment-template-bootstrap-service'),
    import('../../src/services/template-compliance-service'),
    import('../../src/services/platform-managed-github-repo-service'),
    import('../../src/services/railway-deployment-service'),
    import('../../src/services/railway-graphql-client'),
    import('../../src/services/umami-analytics-service'),
  ]);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function createSmokeWorkspace(label: string) {
  const workspace = await mkdtemp(join(tmpdir(), `oneceo-deploy-smoke-${label}-`));
  await mkdir(join(workspace, 'dist'), { recursive: true }).catch(() => undefined);
  await writeFile(
    join(workspace, 'package.json'),
    `${JSON.stringify(
      {
        name: `oneceo-deploy-smoke-${label}`,
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
    <title>OneCEO Deployment Smoke ${label}</title>
  </head>
  <body>
    <main>
      <h1>OneCEO Deployment Smoke ${label}</h1>
      <p>deployment e2e smoke</p>
    </main>
  </body>
</html>
`,
    'utf-8'
  );
  return workspace;
}

async function fetchText(url: string) {
  const response = await fetch(url, {
    redirect: 'follow',
  });
  const text = await response.text();
  return {
    status: response.status,
    text,
  };
}

async function main() {
  const adminToken = asText(process.env.RAILWAY_ADMIN_TOKEN);
  if (!adminToken) {
    throw new Error('RAILWAY_ADMIN_TOKEN 未配置');
  }

  const userId = 'oneceo-deployment-smoke-user';
  const smokeKey = `smoke-${Date.now()}`;
  const sessionA = `${smokeKey}-a`;
  const sessionB = `${smokeKey}-b`;
  console.log(JSON.stringify({ stage: 'init', userId, sessionA, sessionB }));

  const userProject = await platformDeploymentAccountService.ensureUserProject(userId);
  console.log(JSON.stringify({ stage: 'user-project-ready', projectId: userProject.projectId, projectName: userProject.projectName }));
  const accountA = await platformDeploymentAccountService.ensureProjectAccount(userId, sessionA);
  const accountB = await platformDeploymentAccountService.ensureProjectAccount(userId, sessionB);
  console.log(
    JSON.stringify({
      stage: 'accounts-ready',
      sessionA: {
        projectId: accountA.projectId,
        environmentId: accountA.environmentId,
        serviceId: accountA.serviceId,
        repo: accountA.githubRepoFullName,
      },
      sessionB: {
        projectId: accountB.projectId,
        environmentId: accountB.environmentId,
        serviceId: accountB.serviceId,
        repo: accountB.githubRepoFullName,
      },
    })
  );

  assert.equal(accountA.projectId, userProject.projectId);
  assert.equal(accountB.projectId, userProject.projectId);
  assert.notEqual(accountA.environmentId, accountB.environmentId);
  assert.notEqual(accountA.serviceId, accountB.serviceId);
  assert.notEqual(accountA.githubRepoFullName, accountB.githubRepoFullName);
  assert.notEqual(accountA.accessToken, accountB.accessToken);

  const analyticsBinding = await prepareTaskSessionAnalyticsBinding({
    sessionId: sessionA,
    orchestratorSessionId: '',
    environmentMetadata: {},
    account: accountA,
    domain: accountA.serviceDomain,
    tag: 'smoke',
  });
  assert.equal(analyticsBinding?.status, 'ready');
  assert.ok(analyticsBinding?.websiteId, 'Umami websiteId 未生成');
  console.log(JSON.stringify({ stage: 'analytics-ready', websiteId: analyticsBinding?.websiteId, host: analyticsBinding?.host }));

  const variablesResult = await requestRailwayGraphql<{ variables?: Record<string, unknown> | null }>(
    {
      token: accountA.accessToken,
      kind: 'project',
    },
    `
      query GetSmokeServiceVariables(
        $projectId: String!,
        $environmentId: String!,
        $serviceId: String!
      ) {
        variables(
          projectId: $projectId,
          environmentId: $environmentId,
          serviceId: $serviceId
        )
      }
    `,
    {
      projectId: accountA.projectId,
      environmentId: accountA.environmentId,
      serviceId: accountA.serviceId,
    }
  );
  const variables = variablesResult.variables || {};
  assert.ok(asText(variables.VITE_ANALYTICS_HOST));
  assert.ok(asText(variables.VITE_ANALYTICS_WEBSITE_ID));
  assert.equal(asText(variables.VITE_ANALYTICS_TAG), 'smoke');
  console.log(JSON.stringify({ stage: 'variables-ready', websiteId: asText(variables.VITE_ANALYTICS_WEBSITE_ID) }));

  const workspace = await createSmokeWorkspace(sessionA);
  try {
    const bootstrap = await ensureDeploymentTemplateBootstrap(workspace);
    assert.equal(bootstrap.errors.length, 0);
    const compliance = await ensureTemplateCompliance(workspace);
    assert.equal(compliance.ok, true);
    console.log(JSON.stringify({ stage: 'workspace-ready', workspace }));

    const deploymentRequestedAt = Date.now();
    console.log(JSON.stringify({ stage: 'github-sync-start', repo: accountA.githubRepoFullName }));
    await pushDirectoryToManagedRepository(
      {
        owner: accountA.githubRepoOwner || '',
        name: accountA.githubRepoName || '',
        fullName: accountA.githubRepoFullName || '',
        htmlUrl: accountA.githubRepoUrl,
        defaultBranch: accountA.githubDefaultBranch || 'main',
      },
      workspace,
      {
        commitMessage: `chore: smoke deploy ${sessionA}`,
      }
    );
    console.log(JSON.stringify({ stage: 'github-sync-done', repo: accountA.githubRepoFullName }));

    console.log(JSON.stringify({ stage: 'railway-deployment-wait-start' }));
    const action = await waitForRailwayDeploymentAfterSourceSync(
      {
        platformDeployment: {
          adminToken,
          token: accountA.accessToken,
          projectId: accountA.projectId,
          projectName: accountA.projectName,
          environmentId: accountA.environmentId,
          environmentName: accountA.environmentName,
          serviceId: accountA.serviceId,
          serviceName: accountA.serviceName,
        },
      },
      {
        since: deploymentRequestedAt,
        timeoutMs: 180_000,
        pollIntervalMs: 5_000,
      }
    );
    console.log(JSON.stringify({ stage: 'railway-deployment-detected', deploymentId: action.deploymentId }));

    let panel = await getRailwayDeploymentPanel(
      {},
      {
        deploymentId: action.deploymentId,
        platformDeployment: {
          adminToken,
          token: accountA.accessToken,
          projectId: accountA.projectId,
          projectName: accountA.projectName,
          environmentId: accountA.environmentId,
          environmentName: accountA.environmentName,
          serviceId: accountA.serviceId,
          serviceName: accountA.serviceName,
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
            token: accountA.accessToken,
            projectId: accountA.projectId,
            projectName: accountA.projectName,
            environmentId: accountA.environmentId,
            environmentName: accountA.environmentName,
            serviceId: accountA.serviceId,
            serviceName: accountA.serviceName,
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
    assert.match(page.text, /OneCEO Deployment Smoke/);

    const health = await fetchText(`${baseUrl.replace(/\/+$/, '')}/api/system/health`);
    assert.equal(health.status, 200);
    assert.match(health.text, /ok/i);

    const websiteMetrics = await umamiAnalyticsService.getWebsiteMetrics(analyticsBinding.websiteId || '');
    assert.ok(websiteMetrics, '未能读取 Umami website 指标');

    const indexHtml = await readFile(join(workspace, 'index.html'), 'utf-8');
    console.log(
      JSON.stringify(
        {
          ok: true,
          userProject: {
            projectId: userProject.projectId,
            projectName: userProject.projectName,
          },
          sessionA: {
            projectId: accountA.projectId,
            environmentId: accountA.environmentId,
            serviceId: accountA.serviceId,
            repo: accountA.githubRepoFullName,
            domain: accountA.serviceDomain,
            deploymentId: panel.deploymentId,
            status: panel.latestStatus,
            url: baseUrl,
          },
          sessionB: {
            projectId: accountB.projectId,
            environmentId: accountB.environmentId,
            serviceId: accountB.serviceId,
            repo: accountB.githubRepoFullName,
          },
          analytics: {
            websiteId: asText(variables.VITE_ANALYTICS_WEBSITE_ID),
            host: asText(variables.VITE_ANALYTICS_HOST),
            tag: asText(variables.VITE_ANALYTICS_TAG),
          },
          bootstrapInjected: indexHtml.includes('ONECEO_ANALYTICS:START'),
        },
        null,
        2
      )
    );
  } finally {
    await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
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
