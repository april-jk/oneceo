import assert from 'node:assert/strict';
import test from 'node:test';

import { AltusManagedDeploymentToolService } from '../src/services/altus-managed-deployment-tool-service';

function createReadyBaseline() {
  return {
    status: 'ready' as const,
    checkedAt: new Date().toISOString(),
    workspaceDetected: true,
    analyticsMode: 'platform_injected' as const,
    manifestGenerated: false,
    manifestPath: '/tmp/workspace/oneceo.manifest.json',
    templateVersion: '1.0.0',
    buildCommand: 'pnpm build',
    startCommand: 'node dist/index.js',
    healthcheckPath: '/api/system/health',
    features: {
      analytics: true,
      userTracking: true,
      database: false,
      auth: 'optional' as const,
      objectStorage: false,
    },
    checks: {
      build: true,
      start: true,
      analytics: true,
      healthcheck: true,
      database: null,
    },
    warnings: [],
    errors: [],
  };
}

test('deploy_application returns repair_required when baseline is not ready', async () => {
  const service = new AltusManagedDeploymentToolService({
    inspectBaseline: async () => ({
      ...createReadyBaseline(),
      status: 'needs_attention',
      checks: {
        build: false,
        start: true,
        analytics: false,
        healthcheck: false,
        database: null,
      },
      errors: ['缺少 package.json scripts.build'],
    }),
    executeCapability: async () => {
      throw new Error('should_not_execute_capability');
    },
    getErrorMessage: (error) => String((error as Error)?.message || error),
  });

  const result = await service.execute({
    action: 'deploy_application',
    sessionId: 'session-1',
    sandboxId: 'sandbox-1',
    workspaceRoot: '/workspace/session-1',
  });

  assert.equal(result.status, 'retryable_repair_required');
  assert.equal(result.phase, 'repair_required');
  assert.deepEqual(result.repair?.checks, [
    'missing_build_script',
    'missing_analytics_entry',
    'missing_healthcheck_route',
  ]);
});

test('redeploy_application republishes current workspace through deploy capability', async () => {
  let capabilityId = '';
  const service = new AltusManagedDeploymentToolService({
    inspectBaseline: async () => createReadyBaseline(),
    executeCapability: async (nextCapabilityId) => {
      capabilityId = nextCapabilityId;
      return {
        capabilityId: nextCapabilityId,
        message: '已触发网站部署。当前部署状态：SUCCESS；访问地址：demo.oneceo.app',
        metadata: {
          latestStatus: 'SUCCESS',
          latestUrl: 'https://demo.oneceo.app',
          deploymentId: 'dep_123',
        },
      };
    },
    getErrorMessage: (error) => String((error as Error)?.message || error),
  });

  const result = await service.execute({
    action: 'redeploy_application',
    sessionId: 'session-1',
    sandboxId: 'sandbox-1',
    workspaceRoot: '/workspace/session-1',
  });

  assert.equal(capabilityId, 'deploy_session_website');
  assert.equal(result.status, 'success');
  assert.equal(result.summary, '重新发布完成，状态 SUCCESS，地址 demo.oneceo.app');
  assert.equal(result.url, 'https://demo.oneceo.app');
});

test('get_application_deployment_status returns structured success payload', async () => {
  const service = new AltusManagedDeploymentToolService({
    inspectBaseline: async () => createReadyBaseline(),
    executeCapability: async (capabilityId) => ({
      capabilityId,
      message: '当前部署状态：SUCCESS；访问地址：demo.oneceo.app',
      metadata: {
        latestStatus: 'SUCCESS',
        latestUrl: 'https://demo.oneceo.app',
        deploymentId: 'dep_123',
      },
    }),
    getErrorMessage: (error) => String((error as Error)?.message || error),
  });

  const result = await service.execute({
    action: 'get_application_deployment_status',
    sessionId: 'session-1',
    sandboxId: 'sandbox-1',
    workspaceRoot: '/workspace/session-1',
  });

  assert.equal(result.status, 'success');
  assert.equal(result.phase, 'completed');
  assert.equal(result.deploymentStatus, 'SUCCESS');
  assert.equal(result.url, 'https://demo.oneceo.app');
});

test('deploy_application returns fatal_error when provider error remains after ready baseline', async () => {
  const service = new AltusManagedDeploymentToolService({
    inspectBaseline: async () => createReadyBaseline(),
    executeCapability: async () => {
      throw new Error('平台部署供应链接入未完成');
    },
    getErrorMessage: (error) => String((error as Error)?.message || error),
  });

  const result = await service.execute({
    action: 'deploy_application',
    sessionId: 'session-1',
    sandboxId: 'sandbox-1',
    workspaceRoot: '/workspace/session-1',
  });

  assert.equal(result.status, 'fatal_error');
  assert.equal(result.phase, 'failed');
  assert.match(result.summary, /发布暂未完成/);
  assert.match(result.debug?.rawError || '', /平台部署供应链接入未完成/);
});
