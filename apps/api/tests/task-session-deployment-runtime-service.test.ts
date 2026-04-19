import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateTaskSessionDeploymentPublicReadiness } from '../src/services/task-session-deployment-runtime-service';
import type { RailwayDeploymentPanelData } from '../src/services/railway-deployment-service';

function createPanel(overrides: Partial<RailwayDeploymentPanelData> = {}): RailwayDeploymentPanelData {
  return {
    configured: true,
    canDeploy: true,
    activeDeploymentPending: false,
    domains: ['https://example.com'],
    deployments: [],
    logs: [],
    missing: [],
    ...overrides,
  };
}

test('validateTaskSessionDeploymentPublicReadiness marks terminal success with unreachable public url as provider_error', async () => {
  const panel = createPanel({
    bindingState: 'ready',
    latestStatus: 'SUCCESS',
    latestStaticUrl: 'https://example.com',
  });

  const result = await validateTaskSessionDeploymentPublicReadiness({
    panel,
    probe: async () => {
      throw new Error('部署已完成，但公网地址尚未就绪: https://example.com/ -> 404');
    },
  });

  assert.equal(result.bindingState, 'provider_error');
  assert.equal(result.providerErrorCode, 'deployment_public_unreachable');
  assert.match(
    result.providerErrorMessage || '',
    /部署平台已返回成功状态，但公网访问验证失败。部署已完成，但公网地址尚未就绪/
  );
});

test('validateTaskSessionDeploymentPublicReadiness skips public validation while deployment is still provisioning', async () => {
  let probeCalled = false;
  const panel = createPanel({
    bindingState: 'provisioning',
    latestStatus: 'BUILDING',
    latestStaticUrl: 'https://example.com',
    activeDeploymentPending: true,
  });

  const result = await validateTaskSessionDeploymentPublicReadiness({
    panel,
    probe: async () => {
      probeCalled = true;
      return { url: 'https://example.com', status: 200 };
    },
  });

  assert.equal(probeCalled, false);
  assert.equal(result.bindingState, 'provisioning');
  assert.equal(result.latestStatus, 'BUILDING');
});

test('validateTaskSessionDeploymentPublicReadiness promotes a live successful deployment when the selected deployment is still queued', async () => {
  const panel = createPanel({
    bindingState: 'provisioning',
    latestStatus: 'QUEUED',
    latestStaticUrl: 'https://example.com',
    activeDeploymentPending: true,
    deploymentId: 'dep-queued',
    deployments: [
      { id: 'dep-queued', status: 'QUEUED' },
      { id: 'dep-live', status: 'SUCCESS' },
    ],
  });

  const result = await validateTaskSessionDeploymentPublicReadiness({
    panel,
    probe: async () => ({ url: 'https://example.com', status: 200 }),
  });

  assert.equal(result.bindingState, 'ready');
  assert.equal(result.latestStatus, 'SUCCESS');
  assert.equal(result.deploymentId, 'dep-live');
  assert.equal(result.activeDeploymentPending, false);
});
