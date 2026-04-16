import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import express from 'express';
import taskCreationRoutes from '../src/routes/task-creation-routes';
import { mockAuthContextMiddleware } from './helpers/mock-auth-context';
import { taskCreationSessionDAO } from '../src/db/dao';
import { taskCreationFileMemoryStore } from '../src/agents/task-creation/file-memory-store';
import { sessionConnectorService } from '../src/services/session-connector-service';
import { userSkillService } from '../src/services/user-skill-service';
import { codexRuntimeConfigService } from '../src/services/codex-runtime-config-service';

type TestServer = {
  origin: string;
  close: () => Promise<void>;
};

const sessionDaoAny = taskCreationSessionDAO as any;
const fileStoreAny = taskCreationFileMemoryStore as any;
const sessionConnectorAny = sessionConnectorService as any;
const userSkillServiceAny = userSkillService as any;
const runtimeConfigServiceAny = codexRuntimeConfigService as any;

const originalGetSession = sessionDaoAny.getSession;
const originalGetIntentResult = sessionDaoAny.getIntentResult;
const originalGetTaskDescription = sessionDaoAny.getTaskDescription;
const originalGetExecutionPlan = sessionDaoAny.getExecutionPlan;
const originalDeleteSession = sessionDaoAny.deleteSession;
const originalDeleteFileSession = fileStoreAny.deleteSession;
const originalAssertSessionOwnership = sessionConnectorAny.assertSessionOwnership;
const originalListAvailableSkills = userSkillServiceAny.listAvailableSkills;
const originalListSettings = userSkillServiceAny.listSettings;
const originalEnablePlatformSkill = userSkillServiceAny.enablePlatformSkill;
const originalDisablePlatformSkill = userSkillServiceAny.disablePlatformSkill;
const originalCreateCustomSkill = userSkillServiceAny.createCustomSkill;
const originalUpdateCustomSkill = userSkillServiceAny.updateCustomSkill;
const originalArchiveCustomSkill = userSkillServiceAny.archiveCustomSkill;
const originalActivateCustomSkill = userSkillServiceAny.activateCustomSkill;
const originalGetRuntimeConfig = runtimeConfigServiceAny.getByUserId;
const originalUpsertRuntimeConfig = runtimeConfigServiceAny.upsertByUserId;

after(() => {
  sessionDaoAny.getSession = originalGetSession;
  sessionDaoAny.getIntentResult = originalGetIntentResult;
  sessionDaoAny.getTaskDescription = originalGetTaskDescription;
  sessionDaoAny.getExecutionPlan = originalGetExecutionPlan;
  sessionDaoAny.deleteSession = originalDeleteSession;
  fileStoreAny.deleteSession = originalDeleteFileSession;
  sessionConnectorAny.assertSessionOwnership = originalAssertSessionOwnership;
  userSkillServiceAny.listAvailableSkills = originalListAvailableSkills;
  userSkillServiceAny.listSettings = originalListSettings;
  userSkillServiceAny.enablePlatformSkill = originalEnablePlatformSkill;
  userSkillServiceAny.disablePlatformSkill = originalDisablePlatformSkill;
  userSkillServiceAny.createCustomSkill = originalCreateCustomSkill;
  userSkillServiceAny.updateCustomSkill = originalUpdateCustomSkill;
  userSkillServiceAny.archiveCustomSkill = originalArchiveCustomSkill;
  userSkillServiceAny.activateCustomSkill = originalActivateCustomSkill;
  runtimeConfigServiceAny.getByUserId = originalGetRuntimeConfig;
  runtimeConfigServiceAny.upsertByUserId = originalUpsertRuntimeConfig;
});

async function startServer(): Promise<TestServer> {
  const app = express();
  app.use(express.json());
  app.use(mockAuthContextMiddleware());
  app.use('/api/task-creation', taskCreationRoutes);

  const server = await new Promise<import('node:http').Server>((resolve) => {
    const next = app.listen(0, () => resolve(next));
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('failed to resolve test server address');
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

test('auth-only task-creation routes reject anonymous access', async () => {
  const server = await startServer();
  const cases: Array<{ method: string; path: string; body?: unknown }> = [
    { method: 'GET', path: '/api/task-creation/skills' },
    { method: 'GET', path: '/api/task-creation/settings/skills' },
    { method: 'POST', path: '/api/task-creation/settings/skills/platform/skill-1/enable' },
    { method: 'POST', path: '/api/task-creation/settings/skills/platform/skill-1/disable' },
    { method: 'POST', path: '/api/task-creation/settings/skills/custom', body: { slug: 'custom-1', name: 'Custom' } },
    { method: 'PUT', path: '/api/task-creation/settings/skills/custom/custom-1', body: { name: 'Custom 2' } },
    { method: 'POST', path: '/api/task-creation/settings/skills/custom/custom-1/archive' },
    { method: 'POST', path: '/api/task-creation/settings/skills/custom/custom-1/activate' },
    { method: 'GET', path: '/api/task-creation/codex/runtime-config' },
    { method: 'PUT', path: '/api/task-creation/codex/runtime-config', body: { model: 'gpt-5.4' } },
    { method: 'POST', path: '/api/task-creation/sessions', body: { title: 'Session' } },
    { method: 'POST', path: '/api/task-creation/sessions/draft', body: { title: 'Draft' } },
    { method: 'GET', path: '/api/task-creation/sessions/s-1/workspace/tree' },
    { method: 'GET', path: '/api/task-creation/sessions/s-1/workspace/file?path=src/index.ts' },
  ];

  try {
    for (const item of cases) {
      const response = await fetch(`${server.origin}${item.path}`, {
        method: item.method,
        headers: item.body ? { 'content-type': 'application/json' } : undefined,
        body: item.body ? JSON.stringify(item.body) : undefined,
      });
      const payload = await response.json();
      assert.equal(response.status, 401, item.path);
      assert.equal(payload.success, false, item.path);
    }
  } finally {
    await server.close();
  }
});

test('skills and codex runtime routes bind requests to current user', async () => {
  const server = await startServer();
  const receivedUserIds: string[] = [];

  userSkillServiceAny.listAvailableSkills = async (userId: string) => {
    receivedUserIds.push(`skills:${userId}`);
    return [{ skillId: 'platform-skill-1' }];
  };
  runtimeConfigServiceAny.getByUserId = async (userId: string) => {
    receivedUserIds.push(`runtime:get:${userId}`);
    return { model: 'gpt-5.4', baseUrl: 'https://example.com', apiKey: '***', configToml: '', authJson: '' };
  };
  runtimeConfigServiceAny.upsertByUserId = async (userId: string, input: Record<string, unknown>) => {
    receivedUserIds.push(`runtime:put:${userId}`);
    assert.equal(input.model, 'gpt-5.4-mini');
    return { model: 'gpt-5.4-mini', baseUrl: 'https://example.com', apiKey: '***', configToml: '', authJson: '' };
  };

  try {
    const skillsResponse = await fetch(`${server.origin}/api/task-creation/skills`, {
      headers: { 'x-test-user-id': 'user-auth-1' },
    });
    assert.equal(skillsResponse.status, 200);

    const getConfigResponse = await fetch(`${server.origin}/api/task-creation/codex/runtime-config`, {
      headers: { 'x-test-user-id': 'user-auth-1' },
    });
    assert.equal(getConfigResponse.status, 200);

    const putConfigResponse = await fetch(`${server.origin}/api/task-creation/codex/runtime-config`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-test-user-id': 'user-auth-1',
      },
      body: JSON.stringify({ model: 'gpt-5.4-mini' }),
    });
    assert.equal(putConfigResponse.status, 200);

    assert.deepEqual(receivedUserIds, ['skills:user-auth-1', 'runtime:get:user-auth-1', 'runtime:put:user-auth-1']);
  } finally {
    await server.close();
  }
});

test('owner-guarded task session routes reject foreign users', async () => {
  const server = await startServer();
  sessionDaoAny.getSession = async (sessionId: string) => ({ id: sessionId, userId: 'owner-user' });

  const cases: Array<{ method: string; path: string; body?: unknown; expectedType?: 'json' | 'text' }> = [
    { method: 'POST', path: '/api/task-creation/sessions/s-1/title/resolve', body: { message: 'rename me' } },
    { method: 'POST', path: '/api/task-creation/sessions/s-1/title/rename', body: { title: 'new title' } },
    { method: 'POST', path: '/api/task-creation/sessions/s-1/favorite', body: { favorite: true } },
    { method: 'GET', path: '/api/task-creation/sessions/s-1/debug' },
    { method: 'POST', path: '/api/task-creation/sessions/s-1/debug/start' },
    { method: 'GET', path: '/api/task-creation/sessions/s-1/workspace/tree' },
    { method: 'GET', path: '/api/task-creation/sessions/s-1/workspace/file?path=src/index.ts' },
    { method: 'GET', path: '/api/task-creation/sessions/s-1/workspace/raw/src/index.ts', expectedType: 'text' },
    { method: 'GET', path: '/api/task-creation/sessions/s-1/opencode/events' },
    { method: 'GET', path: '/api/task-creation/sessions/s-1/intent' },
    { method: 'GET', path: '/api/task-creation/sessions/s-1/task-description' },
    { method: 'GET', path: '/api/task-creation/sessions/s-1/execution-plan' },
    { method: 'DELETE', path: '/api/task-creation/sessions/s-1' },
  ];

  try {
    for (const item of cases) {
      const response = await fetch(`${server.origin}${item.path}`, {
        method: item.method,
        headers: {
          ...(item.body ? { 'content-type': 'application/json' } : {}),
          'x-test-user-id': 'foreign-user',
        },
        body: item.body ? JSON.stringify(item.body) : undefined,
      });

      assert.equal(response.status, 403, item.path);
      if (item.expectedType === 'text') {
        const payload = await response.text();
        assert.match(payload, /当前用户无权访问该会话/, item.path);
      } else {
        const payload = await response.json();
        assert.equal(payload.error, '当前用户无权访问该会话', item.path);
      }
    }
  } finally {
    await server.close();
  }
});

test('intent and delete routes work for the owner', async () => {
  const server = await startServer();
  let deletedSessionId = '';
  let deletedFileSessionId = '';
  sessionDaoAny.getSession = async (sessionId: string) => ({ id: sessionId, userId: 'owner-user' });
  sessionDaoAny.getIntentResult = async (sessionId: string) => ({ sessionId, intent: 'build_app' });
  sessionDaoAny.deleteSession = async (sessionId: string) => {
    deletedSessionId = sessionId;
  };
  fileStoreAny.deleteSession = async (sessionId: string) => {
    deletedFileSessionId = sessionId;
  };

  try {
    const intentResponse = await fetch(`${server.origin}/api/task-creation/sessions/s-2/intent`, {
      headers: { 'x-test-user-id': 'owner-user' },
    });
    const intentPayload = await intentResponse.json();
    assert.equal(intentResponse.status, 200);
    assert.equal(intentPayload.data.intent, 'build_app');

    const deleteResponse = await fetch(`${server.origin}/api/task-creation/sessions/s-2`, {
      method: 'DELETE',
      headers: { 'x-test-user-id': 'owner-user' },
    });
    const deletePayload = await deleteResponse.json();
    assert.equal(deleteResponse.status, 200);
    assert.equal(deletePayload.success, true);
    assert.equal(deletedSessionId, 's-2');
    assert.equal(deletedFileSessionId, 's-2');
  } finally {
    await server.close();
  }
});

test('session-ownership protected attachment, deliverable, and deployment routes reject foreign users', async () => {
  const server = await startServer();
  sessionConnectorAny.assertSessionOwnership = async () => {
    throw new Error('当前用户无权管理该会话连接器');
  };

  const cases: Array<{ method: string; path: string; body?: string; headers?: Record<string, string> }> = [
    {
      method: 'POST',
      path: '/api/task-creation/sessions/s-3/attachments',
      body: 'hello',
      headers: { 'content-type': 'text/plain', 'x-attachment-name': encodeURIComponent('note.txt') },
    },
    { method: 'GET', path: '/api/task-creation/sessions/s-3/deliverables' },
    { method: 'GET', path: '/api/task-creation/sessions/s-3/deliverables/art-1/download' },
    { method: 'GET', path: '/api/task-creation/sessions/s-3/deployment' },
    { method: 'GET', path: '/api/task-creation/sessions/s-3/deployment/template' },
    { method: 'POST', path: '/api/task-creation/sessions/s-3/deployment/deploy' },
    { method: 'POST', path: '/api/task-creation/sessions/s-3/deployment/redeploy', body: JSON.stringify({ deploymentId: 'dep-1' }), headers: { 'content-type': 'application/json' } },
    { method: 'POST', path: '/api/task-creation/sessions/s-3/deployment/rollback', body: JSON.stringify({ deploymentId: 'dep-1' }), headers: { 'content-type': 'application/json' } },
    { method: 'GET', path: '/api/task-creation/sessions/s-3/deployment/database' },
    { method: 'GET', path: '/api/task-creation/sessions/s-3/deployment/database/rows?table=users' },
    { method: 'POST', path: '/api/task-creation/sessions/s-3/deployment/database/rows', body: JSON.stringify({ table: 'users', values: { name: 'A' } }), headers: { 'content-type': 'application/json' } },
    { method: 'PATCH', path: '/api/task-creation/sessions/s-3/deployment/database/rows', body: JSON.stringify({ table: 'users', locator: { id: 1 }, values: { name: 'B' } }), headers: { 'content-type': 'application/json' } },
    { method: 'DELETE', path: '/api/task-creation/sessions/s-3/deployment/database/rows', body: JSON.stringify({ table: 'users', locator: { id: 1 } }), headers: { 'content-type': 'application/json' } },
  ];

  try {
    for (const item of cases) {
      const response = await fetch(`${server.origin}${item.path}`, {
        method: item.method,
        headers: {
          ...(item.headers || {}),
          'x-test-user-id': 'foreign-user',
        },
        body: item.body,
      });
      const payload = await response.json();
      assert.equal(response.status, 403, item.path);
      assert.equal(payload.error, '当前用户无权管理该会话连接器', item.path);
    }
  } finally {
    await server.close();
  }
});
