import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

import { PlatformDeploymentAccountService } from '../src/services/platform-deployment-account-service';

test('ensureUserProject recovers legacy reusable project when current project has no reusable service slots', async () => {
  const service = new PlatformDeploymentAccountService();

  const existingProject = {
    userId: 'user-1',
    projectId: 'project-current',
    projectName: 'current-project',
    workspaceId: 'workspace-current',
    createdAt: '2026-04-20T00:00:00.000Z',
  };

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

  const getUserProjectMock = mock.method(service as any, 'getUserProject', async () => existingProject);
  const fetchRemoteProjectByIdMock = mock.method(
    service as any,
    'fetchRemoteProjectById',
    async (_adminToken: string, projectId: string) => ({
      id: projectId,
      name: projectId === 'project-legacy' ? 'legacy-project' : 'current-project',
    })
  );
  const listReusableAccountRowsMock = mock.method(
    service as any,
    'listReusableAccountRows',
    async (_userId: string, options?: { projectId?: string }) =>
      options?.projectId === 'project-current' ? [] : reusableRows
  );
  const persistUserProjectRowMock = mock.method(service as any, 'persistUserProjectRow', async () => undefined);
  const getRailwayWorkspaceIdMock = mock.method(service as any, 'getRailwayWorkspaceId', () => 'workspace-legacy');

  process.env.RAILWAY_ADMIN_TOKEN = process.env.RAILWAY_ADMIN_TOKEN || 'test-admin-token';

  const result = await service.ensureUserProject('user-1');

  assert.equal(result.projectId, 'project-legacy');
  assert.equal(result.projectName, 'legacy-project');
  assert.equal(result.workspaceId, 'workspace-legacy');
  assert.equal(getUserProjectMock.mock.callCount(), 1);
  assert.equal(fetchRemoteProjectByIdMock.mock.calls.length >= 2, true);
  assert.equal(listReusableAccountRowsMock.mock.calls.length >= 2, true);
  assert.equal(persistUserProjectRowMock.mock.callCount(), 1);
  assert.equal(getRailwayWorkspaceIdMock.mock.callCount(), 1);
});
