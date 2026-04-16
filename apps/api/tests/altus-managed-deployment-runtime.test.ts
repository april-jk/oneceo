import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';

import { AltusManagedToolRuntime } from '../src/services/altus-managed-tool-runtime';
import { altusManagedDeploymentToolService } from '../src/services/altus-managed-deployment-tool-service';

afterEach(() => {
  mock.reset();
});

test('managed tool runtime routes deploy_application through deployment tool service', async () => {
  const executeMock = mock.method(altusManagedDeploymentToolService, 'execute', async () => ({
    action: 'deploy_application',
    phase: 'completed',
    status: 'success',
    summary: '发布完成，状态 SUCCESS，地址 demo.oneceo.app',
    deploymentStatus: 'SUCCESS',
    url: 'https://demo.oneceo.app',
  }));

  const runtime = new AltusManagedToolRuntime({
    sessionId: 'session-1',
    userId: 'user-1',
    sandboxId: 'sandbox-1',
    workspaceRoot: '/workspace/session-1',
    activeSkills: [],
    mcpProviders: [],
  });

  const result = await runtime.execute('deploy_application', {
    notes: '帮我部署当前项目',
  });

  assert.equal(executeMock.mock.callCount(), 1);
  assert.equal(result.type, 'result');
  const payload = JSON.parse(result.content);
  assert.equal(payload.action, 'deploy_application');
  assert.equal(payload.status, 'success');
  assert.equal(payload.url, 'https://demo.oneceo.app');
});
