import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';

import { userConnectorAccountDAO } from '../src/db/dao';
import {
  PlatformDeploymentAccountService,
  shouldRebindUserRailwayProjectToConfiguredWorkspace,
} from '../src/services/platform-deployment-account-service';
import { connectorStorageBootstrap } from '../src/services/connector-storage-bootstrap';
import { connectorSecretService } from '../src/services/connector-secret-service';

afterEach(() => {
  mock.restoreAll();
});

test('recoverUserProjectFromReusableAccounts recovers reusable project only from configured workspace', async () => {
  const service = new PlatformDeploymentAccountService();

  const reusableRows = [
    {
      userId: 'user-1',
      connectorKey: 'railway_internal:legacy-slot',
      secretCiphertext: 'encrypted',
      updatedAt: new Date('2026-04-19T12:00:00.000Z'),
      configJson: {
        provider: 'platform_managed',
        supplier: 'railway',
        projectKey: 'legacy-slot',
        projectId: 'project-legacy',
        projectName: 'legacy-project',
        environmentId: 'env-1',
        serviceId: 'svc-1',
        createdAt: '2026-04-19T12:00:00.000Z',
      },
    },
  ];

  const fetchRemoteProjectByIdMock = mock.method(
    service as any,
    'fetchRemoteProjectById',
    async (_adminToken: string, projectId: string) => ({
      id: projectId,
      name: projectId === 'project-legacy' ? 'legacy-project' : 'current-project',
      workspaceId: 'workspace-current',
      workspaceName: 'oneceo- deployment',
    })
  );
  const listReusableAccountRowsMock = mock.method(
    service as any,
    'listReusableAccountRows',
    async () => reusableRows
  );
  const persistUserProjectRowMock = mock.method(service as any, 'persistUserProjectRow', async () => undefined);
  const getRailwayWorkspaceIdMock = mock.method(service as any, 'getRailwayWorkspaceId', () => 'workspace-current');

  process.env.RAILWAY_ADMIN_TOKEN = process.env.RAILWAY_ADMIN_TOKEN || 'test-admin-token';

  const result = await (service as any).recoverUserProjectFromReusableAccounts('user-1');

  assert.equal(result.projectId, 'project-legacy');
  assert.equal(result.projectName, 'legacy-project');
  assert.equal(result.workspaceId, 'workspace-current');
  assert.equal(fetchRemoteProjectByIdMock.mock.callCount(), 1);
  assert.equal(listReusableAccountRowsMock.mock.callCount(), 1);
  assert.equal(persistUserProjectRowMock.mock.callCount(), 1);
  assert.equal(getRailwayWorkspaceIdMock.mock.callCount(), 1);
});

test('recoverUserProjectFromReusableAccounts skips reusable project from another workspace', async () => {
  const service = new PlatformDeploymentAccountService();

  mock.method(service as any, 'listReusableAccountRows', async () => [
    {
      userId: 'user-1',
      connectorKey: 'railway_internal:legacy-slot',
      secretCiphertext: 'encrypted',
      updatedAt: new Date('2026-04-19T12:00:00.000Z'),
      configJson: {
        provider: 'platform_managed',
        supplier: 'railway',
        projectKey: 'legacy-slot',
        projectId: 'project-personal',
        projectName: 'legacy-personal-project',
        environmentId: 'env-1',
        serviceId: 'svc-1',
      },
    },
  ]);
  mock.method(service as any, 'fetchRemoteProjectById', async (_adminToken: string, projectId: string) => ({
    id: projectId,
    name: 'legacy-personal-project',
    workspaceId: 'workspace-personal',
    workspaceName: "4pri1's Projects",
  }));
  const persistUserProjectRowMock = mock.method(service as any, 'persistUserProjectRow', async () => undefined);
  mock.method(service as any, 'getRailwayWorkspaceId', () => 'workspace-current');

  process.env.RAILWAY_ADMIN_TOKEN = process.env.RAILWAY_ADMIN_TOKEN || 'test-admin-token';

  const result = await (service as any).recoverUserProjectFromReusableAccounts('user-1');

  assert.equal(result, null);
  assert.equal(persistUserProjectRowMock.mock.callCount(), 0);
});

test('shouldRebindUserRailwayProjectToConfiguredWorkspace returns true when persisted workspace differs', () => {
  assert.equal(
    shouldRebindUserRailwayProjectToConfiguredWorkspace(
      {
        projectId: 'project-old',
        workspaceId: 'workspace-old',
      },
      'workspace-new'
    ),
    true
  );
});

test('shouldRebindUserRailwayProjectToConfiguredWorkspace returns true when persisted workspace is missing', () => {
  assert.equal(
    shouldRebindUserRailwayProjectToConfiguredWorkspace(
      {
        projectId: 'project-old',
      },
      'workspace-new'
    ),
    true
  );
});

test('shouldRebindUserRailwayProjectToConfiguredWorkspace returns false when persisted workspace matches', () => {
  assert.equal(
    shouldRebindUserRailwayProjectToConfiguredWorkspace(
      {
        projectId: 'project-current',
        workspaceId: 'workspace-current',
      },
      'workspace-current'
    ),
    false
  );
});

test('getUserProject migrates legacy deployment account without stamping the current workspace id', async () => {
  mock.method(connectorStorageBootstrap, 'ensureReady', async () => undefined);
  mock.method(connectorSecretService, 'decryptJson', () => ({
    accessToken: 'project-token',
  }));

  let upsertPayload: Record<string, unknown> | null = null;
  mock.method(userConnectorAccountDAO, 'getByUserAndConnectorKey', async (userId, connectorKey) => {
    if (connectorKey === 'railway_internal_project') {
      return null;
    }

    if (connectorKey === 'railway_internal') {
      return {
        userId,
        connectorKey,
        configJson: {
          provider: 'platform_managed',
          supplier: 'railway',
          projectId: 'legacy-project',
          projectName: 'legacy-project-name',
          environmentId: 'env-1',
          serviceId: 'svc-1',
        },
        secretCiphertext: 'ciphertext',
      } as any;
    }

    return null;
  });
  mock.method(userConnectorAccountDAO, 'upsert', async (input) => {
    upsertPayload = input as Record<string, unknown>;
    return input as any;
  });

  const service = new PlatformDeploymentAccountService();
  const result = await service.getUserProject('user-1');

  assert.deepEqual(result, {
    userId: 'user-1',
    projectId: 'legacy-project',
    projectName: 'legacy-project-name',
    workspaceId: undefined,
    createdAt: result?.createdAt,
  });
  assert.ok(result?.createdAt);
  assert.ok(upsertPayload);
  assert.equal((upsertPayload?.configJson as Record<string, unknown>)?.projectId, 'legacy-project');
  assert.equal(
    (upsertPayload?.configJson as Record<string, unknown>)?.workspaceId,
    undefined
  );
});

test('recycleProjectService deletes the current Railway service before repairing the account', async () => {
  const service = new PlatformDeploymentAccountService();

  mock.method(service as any, 'getAccountRow', async () => ({
    userId: 'user-1',
    connectorKey: 'railway_internal:session-1',
    configJson: {
      provider: 'platform_managed',
      supplier: 'railway',
      projectKey: 'session-1',
      projectId: 'project-1',
      environmentId: 'env-1',
      serviceId: 'svc-1',
    },
    secretCiphertext: 'ciphertext',
  }));

  const deleteCalls: Array<{ serviceId: string; environmentId: string }> = [];
  mock.method(service as any, 'deleteProjectServiceBinding', async (serviceId: string, environmentId: string) => {
    deleteCalls.push({ serviceId, environmentId });
  });

  const repairedAccount = {
    userId: 'user-1',
    projectKey: 'session-1',
    projectId: 'project-1',
    environmentId: 'env-2',
    serviceId: 'svc-2',
    accessToken: 'project-token',
    tokenKind: 'project' as const,
  };
  mock.method(service as any, 'repairExistingAccount', async () => repairedAccount);

  const result = await service.recycleProjectService('user-1', 'session-1');

  assert.equal(result, repairedAccount);
  assert.equal(deleteCalls.length, 1);
  assert.deepEqual(deleteCalls[0], {
    serviceId: 'svc-1',
    environmentId: 'env-1',
  });
});

test('recycleProjectService ignores missing Railway bindings and still repairs the account', async () => {
  const service = new PlatformDeploymentAccountService();

  mock.method(service as any, 'getAccountRow', async () => ({
    userId: 'user-1',
    connectorKey: 'railway_internal:session-1',
    configJson: {
      provider: 'platform_managed',
      supplier: 'railway',
      projectKey: 'session-1',
      projectId: 'project-1',
      environmentId: 'env-1',
      serviceId: 'svc-1',
    },
    secretCiphertext: 'ciphertext',
  }));

  mock.method(service as any, 'deleteProjectServiceBinding', async () => {
    throw new Error('Service not found');
  });

  const repairedAccount = {
    userId: 'user-1',
    projectKey: 'session-1',
    projectId: 'project-1',
    environmentId: 'env-2',
    serviceId: 'svc-2',
    accessToken: 'project-token',
    tokenKind: 'project' as const,
  };
  let repaired = false;
  mock.method(service as any, 'repairExistingAccount', async () => {
    repaired = true;
    return repairedAccount;
  });

  const result = await service.recycleProjectService('user-1', 'session-1');

  assert.equal(repaired, true);
  assert.equal(result, repairedAccount);
});

test('cleanupFailedProjectResources removes the current failed deployment account resources', async () => {
  const service = new PlatformDeploymentAccountService();

  const row = {
    userId: 'user-1',
    connectorKey: 'railway_internal:session-failed',
    configJson: {
      provider: 'platform_managed',
      supplier: 'railway',
      projectKey: 'session-failed',
      projectId: 'project-1',
      environmentId: 'env-failed',
      serviceId: 'svc-failed',
    },
    secretCiphertext: 'ciphertext',
  };

  mock.method(service as any, 'getAccountRow', async () => row);

  let purgedRow: unknown = null;
  mock.method(service as any, 'purgeProjectAccountRowResources', async (input: unknown) => {
    purgedRow = input;
  });

  await service.cleanupFailedProjectResources('user-1', 'session-failed');

  assert.equal(purgedRow, row);
});
