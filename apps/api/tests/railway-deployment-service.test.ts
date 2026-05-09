import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildRailwayBindingUnavailablePanel,
  classifyRailwayDeploymentError,
  isRailwayBindingNotFoundError,
  resolveRailwayPanelPublicUrls,
  resolveRailwaySelectedDeploymentId,
  waitForRailwayDeploymentPublicReachability,
  type RailwayDeploymentListItem,
} from '../src/services/railway-deployment-service';

function makeDeployment(id: string): RailwayDeploymentListItem {
  return {
    id,
    status: 'SUCCESS',
    createdAt: '2026-04-17T10:32:00.000Z',
  };
}

test('resolveRailwaySelectedDeploymentId keeps requested deployment when it still exists', () => {
  const deployments = [makeDeployment('dep_latest'), makeDeployment('dep_old')];

  const result = resolveRailwaySelectedDeploymentId({
    requestedDeploymentId: 'dep_old',
    deployments,
    fallbackDeploymentId: 'dep_latest',
  });

  assert.equal(result, 'dep_old');
});

test('resolveRailwaySelectedDeploymentId prefers the newest deployment when requested deployment is stale', () => {
  const deployments = [makeDeployment('dep_latest'), makeDeployment('dep_old')];

  const result = resolveRailwaySelectedDeploymentId({
    requestedDeploymentId: 'dep_missing',
    deployments,
    fallbackDeploymentId: 'dep_old',
  });

  assert.equal(result, 'dep_latest');
});

test('resolveRailwaySelectedDeploymentId ignores stale fallback deployment ids', () => {
  const deployments = [makeDeployment('dep_latest'), makeDeployment('dep_old')];

  const result = resolveRailwaySelectedDeploymentId({
    requestedDeploymentId: 'dep_missing',
    deployments,
    fallbackDeploymentId: 'dep_stale',
  });

  assert.equal(result, 'dep_latest');
});

test('resolveRailwaySelectedDeploymentId ignores old fallback deployment ids when a newer retry exists', () => {
  const deployments: RailwayDeploymentListItem[] = [
    {
      id: 'dep_retry_queued',
      status: 'QUEUED',
      createdAt: '2026-04-18T15:54:31.606Z',
    },
    {
      id: 'dep_failed_old',
      status: 'FAILED',
      createdAt: '2026-04-18T15:54:12.989Z',
    },
  ];

  const result = resolveRailwaySelectedDeploymentId({
    deployments,
    fallbackDeploymentId: 'dep_failed_old',
  });

  assert.equal(result, 'dep_retry_queued');
});

test('isRailwayBindingNotFoundError matches deleted railway resource messages', () => {
  assert.equal(isRailwayBindingNotFoundError('Project not found'), true);
  assert.equal(isRailwayBindingNotFoundError('Environment not found'), true);
  assert.equal(isRailwayBindingNotFoundError('Service not found'), true);
  assert.equal(isRailwayBindingNotFoundError('Deployment not found'), false);
});

test('buildRailwayBindingUnavailablePanel returns recoverable unconfigured panel state', () => {
  const panel = buildRailwayBindingUnavailablePanel({
    binding: {
      token: 'token',
      tokenKind: 'project',
      projectId: 'prj_123',
      environmentId: 'env_123',
      serviceId: 'svc_123',
      projectName: 'Demo Project',
      environmentName: 'production',
      serviceName: 'web',
    },
    providerErrorCode: 'railway_project_not_found',
    reason: '当前部署绑定的 Railway Project 已不存在，请重新发布以重建部署资源。',
  });

  assert.equal(panel.configured, false);
  assert.equal(panel.canDeploy, true);
  assert.equal(panel.bindingState, 'repair_required');
  assert.equal(panel.providerErrorCode, 'railway_project_not_found');
  assert.equal(panel.projectId, 'prj_123');
  assert.equal(panel.environmentId, 'env_123');
  assert.equal(panel.serviceId, 'svc_123');
  assert.equal(panel.message, '当前部署绑定的 Railway Project 已不存在，请重新发布以重建部署资源。');
  assert.deepEqual(panel.deployments, []);
  assert.deepEqual(panel.logs, []);
});

test('classifyRailwayDeploymentError returns repairable classification for missing project', () => {
  const result = classifyRailwayDeploymentError('Project not found');

  assert.equal(result.code, 'railway_project_not_found');
  assert.equal(result.bindingState, 'repair_required');
  assert.match(result.userMessage, /Railway Project 已不存在/);
});

test('classifyRailwayDeploymentError returns repairable classification for repo access denial', () => {
  const result = classifyRailwayDeploymentError('Railway 当前无权访问目标 GitHub 仓库。');

  assert.equal(result.code, 'railway_repo_access_denied');
  assert.equal(result.bindingState, 'repair_required');
});

test('classifyRailwayDeploymentError returns provider_error classification for sandbox capability failures', () => {
  const result = classifyRailwayDeploymentError(
    'deployment_platform_capability_not_ready:Playwright smoke test failed because sandbox Playwright capability is unavailable before Railway deployment.'
  );

  assert.equal(result.code, 'deployment_platform_capability_not_ready');
  assert.equal(result.bindingState, 'provider_error');
  assert.match(result.userMessage, /Playwright capability is unavailable/i);
});

test('resolveRailwayPanelPublicUrls uses provider URL while custom domain certificate is pending', () => {
  const result = resolveRailwayPanelPublicUrls({
    publicDomain: 'app-demo.oneceo.space',
    domainStatus: 'pending_certificate',
    providerLatestUrl: 'app-demo.up.railway.app',
    providerLatestStaticUrl: 'app-demo-static.up.railway.app',
    providerDomains: ['app-demo.up.railway.app'],
  });

  assert.equal(result.latestUrl, 'https://app-demo.up.railway.app');
  assert.equal(result.latestStaticUrl, 'https://app-demo-static.up.railway.app');
  assert.equal(result.publicUrl, undefined);
  assert.deepEqual(result.domains, ['https://app-demo.up.railway.app']);
  assert.equal(result.customDomainActive, false);
});

test('resolveRailwayPanelPublicUrls promotes active custom domain as public URL', () => {
  const result = resolveRailwayPanelPublicUrls({
    publicDomain: 'app-demo.oneceo.space',
    domainStatus: 'active',
    providerLatestUrl: 'app-demo.up.railway.app',
    providerLatestStaticUrl: 'app-demo-static.up.railway.app',
    providerDomains: ['app-demo.up.railway.app'],
  });

  assert.equal(result.latestUrl, 'https://app-demo.up.railway.app');
  assert.equal(result.latestStaticUrl, 'https://app-demo-static.up.railway.app');
  assert.equal(result.publicUrl, 'https://app-demo.oneceo.space');
  assert.deepEqual(result.domains, ['https://app-demo.up.railway.app']);
  assert.equal(result.customDomainActive, true);
});

test('resolveRailwayPanelPublicUrls filters custom domain from provider candidates', () => {
  const result = resolveRailwayPanelPublicUrls({
    publicDomain: 'app-demo.oneceo.space',
    domainStatus: 'active',
    providerLatestUrl: 'app-demo.oneceo.space',
    providerLatestStaticUrl: 'https://app-demo.oneceo.space',
    providerDomains: ['app-demo.oneceo.space', 'app-demo.up.railway.app'],
  });

  assert.equal(result.latestUrl, 'https://app-demo.up.railway.app');
  assert.equal(result.latestStaticUrl, 'https://app-demo.up.railway.app');
  assert.equal(result.publicUrl, 'https://app-demo.oneceo.space');
  assert.deepEqual(result.domains, ['https://app-demo.up.railway.app']);
  assert.equal(result.customDomainActive, true);
});

test('waitForRailwayDeploymentPublicReachability rejects persistent 500 responses', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () =>
      new Response('服务器内部错误', {
        status: 500,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
        },
      })) as typeof fetch;

    await assert.rejects(
      () =>
        waitForRailwayDeploymentPublicReachability(
          {
            baseUrl: 'https://example.com',
          },
          {
            timeoutMs: 5_000,
            pollIntervalMs: 1_000,
          },
        ),
      /公网地址尚未就绪|服务器内部错误/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('waitForRailwayDeploymentPublicReachability rejects 200 error pages with internal error marker', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () =>
      new Response('<html><body>Internal Server Error</body></html>', {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
        },
      })) as typeof fetch;

    await assert.rejects(
      () =>
        waitForRailwayDeploymentPublicReachability(
          {
            baseUrl: 'https://example.com',
          },
          {
            timeoutMs: 5_000,
            pollIntervalMs: 1_000,
          },
        ),
      /公网地址尚未就绪|Internal Server Error/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('waitForRailwayDeploymentPublicReachability requires the public root page to succeed', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url.endsWith('/api/system/health')) {
        return new Response('ok', {
          status: 200,
          headers: {
            'content-type': 'text/plain; charset=utf-8',
          },
        });
      }
      return new Response('Internal Server Error', {
        status: 500,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
        },
      });
    }) as typeof fetch;

    await assert.rejects(
      () =>
        waitForRailwayDeploymentPublicReachability(
          {
            baseUrl: 'https://example.com',
            healthPath: '/api/system/health',
          },
          {
            timeoutMs: 5_000,
            pollIntervalMs: 1_000,
          },
        ),
      /Internal Server Error|公网地址尚未就绪/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
