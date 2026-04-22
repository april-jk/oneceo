import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import {
  buildTaskSessionDeploymentResponse,
  resolveTaskSessionEnvironment,
  shouldRecycleRailwayServiceForFailedRedeploy,
  validateTaskSessionDeploymentPublicReadiness,
} from '../src/services/task-session-deployment-runtime-service';
import type { RailwayDeploymentPanelData } from '../src/services/railway-deployment-service';
import { sandboxExecutionEnvironmentDAO, taskSessionRunDAO } from '../src/db/dao';
import { platformDeploymentAccountService } from '../src/services/platform-deployment-account-service';

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

test('shouldRecycleRailwayServiceForFailedRedeploy returns true for provider_error bindings with a service id', () => {
  const result = shouldRecycleRailwayServiceForFailedRedeploy({
    state: {
      bindingState: 'provider_error',
      serviceId: 'svc-1',
    },
  });

  assert.equal(result, true);
});

test('shouldRecycleRailwayServiceForFailedRedeploy returns true for provider_error bindings even when the service id has not been snapshotted yet', () => {
  const result = shouldRecycleRailwayServiceForFailedRedeploy({
    state: {
      bindingState: 'provider_error',
      serviceId: '',
    },
  });

  assert.equal(result, true);
});

test('shouldRecycleRailwayServiceForFailedRedeploy returns true when the selected deployment already failed', () => {
  const result = shouldRecycleRailwayServiceForFailedRedeploy({
    panel: createPanel({
      bindingState: 'ready',
      serviceId: 'svc-1',
      deploymentId: 'dep-failed',
      latestStatus: 'SUCCESS',
      deployments: [
        {
          id: 'dep-failed',
          status: 'FAILED',
        },
      ],
    }),
  });

  assert.equal(result, true);
});

test('shouldRecycleRailwayServiceForFailedRedeploy returns false for healthy ready deployments', () => {
  const result = shouldRecycleRailwayServiceForFailedRedeploy({
    panel: createPanel({
      bindingState: 'ready',
      serviceId: 'svc-1',
      latestStatus: 'SUCCESS',
      deployments: [
        {
          id: 'dep-success',
          status: 'SUCCESS',
        },
      ],
    }),
  });

  assert.equal(result, false);
});

test('resolveTaskSessionEnvironment prefers sandbox binding over canonical environment lookup', async () => {
  const getBySessionIdMock = mock.method(
    sandboxExecutionEnvironmentDAO,
    'getBySessionId',
    async (sessionId: string) => {
      if (sessionId === 'bound-sandbox') {
        return {
          sessionId: 'bound-sandbox',
          metadata: {
            taskSessionId: 'task-1',
            deploymentState: {
              bindingState: 'provider_error',
            },
          },
        } as any;
      }
      return null;
    },
  );
  const bindingMock = mock.method(taskSessionRunDAO, 'getSandboxBindingBySession', async () => ({
    sandboxId: 'bound-sandbox',
  }) as any);

  try {
    const result = await resolveTaskSessionEnvironment({
      session: {
        id: 'task-1',
        runtime: {
          orchestratorSessionId: '',
        },
      } as any,
    });

    assert.equal(result.orchestratorSessionId, 'bound-sandbox');
    assert.equal(
      (result.environment?.metadata as Record<string, any>)?.deploymentState?.bindingState,
      'provider_error',
    );
    assert.equal(bindingMock.mock.callCount(), 1);
    assert.equal(getBySessionIdMock.mock.callCount(), 1);
  } finally {
    mock.restoreAll();
  }
});

test('resolveTaskSessionEnvironment prefers sandbox binding over runtime environment lookup', async () => {
  const getBySessionIdMock = mock.method(
    sandboxExecutionEnvironmentDAO,
    'getBySessionId',
    async (sessionId: string) => {
      if (sessionId === 'runtime-sandbox') {
        return {
          sessionId: 'runtime-sandbox',
          metadata: {
            taskSessionId: 'task-2',
            deploymentState: {
              bindingState: 'uninitialized',
            },
          },
        } as any;
      }
      if (sessionId === 'bound-sandbox') {
        return {
          sessionId: 'bound-sandbox',
          metadata: {
            taskSessionId: 'task-2',
            deploymentState: {
              bindingState: 'provider_error',
            },
          },
        } as any;
      }
      return null;
    },
  );
  const bindingMock = mock.method(taskSessionRunDAO, 'getSandboxBindingBySession', async () => ({
    sandboxId: 'bound-sandbox',
  }) as any);

  try {
    const result = await resolveTaskSessionEnvironment({
      session: {
        id: 'task-2',
        runtime: {
          orchestratorSessionId: 'runtime-sandbox',
        },
      } as any,
    });

    assert.equal(result.orchestratorSessionId, 'bound-sandbox');
    assert.equal(
      (result.environment?.metadata as Record<string, any>)?.deploymentState?.bindingState,
      'provider_error',
    );
    assert.equal(bindingMock.mock.callCount(), 1);
    assert.equal(getBySessionIdMock.mock.callCount(), 1);
  } finally {
    mock.restoreAll();
  }
});

test('buildTaskSessionDeploymentResponse falls back to the latest environment with deployment signal', async () => {
  const getBySessionIdMock = mock.method(
    sandboxExecutionEnvironmentDAO,
    'getBySessionId',
    async (sessionId: string) => {
      if (sessionId === 'runtime-sandbox') {
        return {
          sessionId: 'runtime-sandbox',
          metadata: {},
        } as any;
      }
      return null;
    },
  );
  const bindingMock = mock.method(taskSessionRunDAO, 'getSandboxBindingBySession', async () => ({
    sandboxId: 'runtime-sandbox',
  }) as any);
  const listByTaskSessionIdMock = mock.method(
    sandboxExecutionEnvironmentDAO,
    'listByTaskSessionId',
    async () =>
      [
        {
          sessionId: 'runtime-sandbox',
          metadata: {},
        },
        {
          sessionId: 'older-deployment-sandbox',
          metadata: {
            deploymentState: {
              bindingState: 'provider_error',
              providerErrorCode: 'deployment_public_unreachable',
              providerErrorMessage: 'deployment failed',
              message: 'deployment failed',
            },
          },
        },
      ] as any,
  );
  const projectAccountMock = mock.method(
    platformDeploymentAccountService,
    'getProjectAccount',
    async () => null as any,
  );

  try {
    const result = await buildTaskSessionDeploymentResponse({
      userId: 'user-1',
      session: {
        id: 'task-3',
        runtime: {
          orchestratorSessionId: 'runtime-sandbox',
        },
      } as any,
    });

    assert.equal(result.bindingState, 'provider_error');
    assert.equal(result.providerErrorCode, 'deployment_public_unreachable');
    assert.match(result.providerErrorMessage || '', /deployment failed/);
    assert.equal(bindingMock.mock.callCount(), 1);
    assert.equal(listByTaskSessionIdMock.mock.callCount(), 1);
    assert.equal(projectAccountMock.mock.callCount(), 0);
    assert.equal(getBySessionIdMock.mock.callCount(), 1);
  } finally {
    mock.restoreAll();
  }
});
