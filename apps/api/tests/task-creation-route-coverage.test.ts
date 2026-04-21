import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import express from 'express';
import taskCreationRoutes from '../src/routes/task-creation-routes';
import { mockAuthContextMiddleware } from './helpers/mock-auth-context';
import { appUserProjectDAO, taskCreationSessionDAO } from '../src/db/dao';
import { taskCreationFileMemoryStore } from '../src/agents/task-creation/file-memory-store';
import { sessionConnectorService } from '../src/services/session-connector-service';
import { userSkillService } from '../src/services/user-skill-service';
import { codexRuntimeConfigService } from '../src/services/codex-runtime-config-service';

type TestServer = {
  origin: string;
  close: () => Promise<void>;
};

const sessionDaoAny = taskCreationSessionDAO as any;
const projectDaoAny = appUserProjectDAO as any;
const fileStoreAny = taskCreationFileMemoryStore as any;
const sessionConnectorAny = sessionConnectorService as any;
const userSkillServiceAny = userSkillService as any;
const runtimeConfigServiceAny = codexRuntimeConfigService as any;

const originalGetSession = sessionDaoAny.getSession;
const originalListProjects = projectDaoAny.listByUser;
const originalGetOwnedProjectById = projectDaoAny.getOwnedProjectById;
const originalGetOwnedProjectByName = projectDaoAny.getOwnedProjectByName;
const originalCreateProject = projectDaoAny.create;
const originalUpdateProject = projectDaoAny.updateOwnedProject;
const originalDeleteProject = projectDaoAny.deleteOwnedProject;
const originalGetIntentResult = sessionDaoAny.getIntentResult;
const originalGetTaskDescription = sessionDaoAny.getTaskDescription;
const originalGetExecutionPlan = sessionDaoAny.getExecutionPlan;
const originalDeleteSession = sessionDaoAny.deleteSession;
const originalUpdateSessionProject = sessionDaoAny.updateSessionProject;
const originalClearSessionProjectAssignment = sessionDaoAny.clearProjectAssignmentForUser;
const originalListOwnedProjectSessions = sessionDaoAny.listOwnedProjectSessions;
const originalGetFileSession = fileStoreAny.getSession;
const originalDeleteFileSession = fileStoreAny.deleteSession;
const originalUpdateFileSessionProject = fileStoreAny.updateSessionProject;
const originalClearFileProjectAssignment = fileStoreAny.clearProjectAssignment;
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
  projectDaoAny.listByUser = originalListProjects;
  projectDaoAny.getOwnedProjectById = originalGetOwnedProjectById;
  projectDaoAny.getOwnedProjectByName = originalGetOwnedProjectByName;
  projectDaoAny.create = originalCreateProject;
  projectDaoAny.updateOwnedProject = originalUpdateProject;
  projectDaoAny.deleteOwnedProject = originalDeleteProject;
  sessionDaoAny.getIntentResult = originalGetIntentResult;
  sessionDaoAny.getTaskDescription = originalGetTaskDescription;
  sessionDaoAny.getExecutionPlan = originalGetExecutionPlan;
  sessionDaoAny.deleteSession = originalDeleteSession;
  sessionDaoAny.updateSessionProject = originalUpdateSessionProject;
  sessionDaoAny.clearProjectAssignmentForUser = originalClearSessionProjectAssignment;
  sessionDaoAny.listOwnedProjectSessions = originalListOwnedProjectSessions;
  fileStoreAny.getSession = originalGetFileSession;
  fileStoreAny.deleteSession = originalDeleteFileSession;
  fileStoreAny.updateSessionProject = originalUpdateFileSessionProject;
  fileStoreAny.clearProjectAssignment = originalClearFileProjectAssignment;
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
    { method: 'GET', path: '/api/task-creation/projects' },
    { method: 'GET', path: '/api/task-creation/projects/project-1' },
    { method: 'GET', path: '/api/task-creation/projects/project-1/sessions' },
    { method: 'POST', path: '/api/task-creation/projects', body: { name: 'Project A' } },
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

test('project routes bind requests to current user and persist standard projects', async () => {
  const server = await startServer();
  const received: string[] = [];
  projectDaoAny.listByUser = async (userId: string, options: Record<string, unknown>) => {
    received.push(`list:${userId}:${String(options.projectType)}:${String(options.status)}`);
    return [
      {
        id: 'project-1',
        userId,
        name: 'Project A',
        description: 'desc',
        projectType: 'standard',
        status: 'active',
        createdAt: new Date('2026-04-21T00:00:00.000Z'),
        updatedAt: new Date('2026-04-21T00:00:00.000Z'),
      },
    ];
  };
  projectDaoAny.getOwnedProjectByName = async (userId: string, name: string) => {
    received.push(`name:${userId}:${name}`);
    return null;
  };
  projectDaoAny.create = async (input: Record<string, unknown>) => {
    received.push(`create:${String(input.userId)}:${String(input.name)}`);
    return {
      id: 'project-2',
      userId: input.userId,
      name: input.name,
      description: input.description || '',
      projectType: 'standard',
      status: 'active',
      createdAt: new Date('2026-04-21T00:00:00.000Z'),
      updatedAt: new Date('2026-04-21T00:00:00.000Z'),
    };
  };

  try {
    const listResponse = await fetch(`${server.origin}/api/task-creation/projects`, {
      headers: { 'x-test-user-id': 'user-project-1' },
    });
    assert.equal(listResponse.status, 200);
    const listPayload = await listResponse.json();
    assert.equal(listPayload.data?.[0]?.name, 'Project A');

    const createResponse = await fetch(`${server.origin}/api/task-creation/projects`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user-id': 'user-project-1',
      },
      body: JSON.stringify({ name: 'Project B', description: 'hello' }),
    });
    assert.equal(createResponse.status, 201);
    const createPayload = await createResponse.json();
    assert.equal(createPayload.data?.id, 'project-2');
    assert.deepEqual(received, [
      'list:user-project-1:standard:active',
      'name:user-project-1:Project B',
      'create:user-project-1:Project B',
    ]);
  } finally {
    await server.close();
  }
});

test('project detail routes bind requests to current user and return scoped sessions', async () => {
  const server = await startServer();
  const received: string[] = [];
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const userId = `user-project-detail-${uniqueSuffix}`;
  const projectId = `project-${uniqueSuffix}`;

  projectDaoAny.getOwnedProjectById = async (projectId: string, userId: string) => {
    received.push(`project:${userId}:${projectId}`);
    return {
      id: projectId,
      userId,
      name: 'Project Detail',
      description: 'detail',
      projectType: 'standard',
      status: 'active',
      metadataJson: { pinned: true },
      createdAt: new Date('2026-04-21T00:00:00.000Z'),
      updatedAt: new Date('2026-04-21T00:00:00.000Z'),
    };
  };
  sessionDaoAny.listOwnedProjectSessions = async (userId: string, projectId: string) => {
    received.push(`sessions:${userId}:${projectId}`);
    return [
      {
        id: 'session-1',
        title: 'Scoped Session',
        projectId,
        projectName: 'Project Detail',
        status: 'completed',
        createdAt: '2026-04-21T00:00:00.000Z',
        updatedAt: '2026-04-21T00:10:00.000Z',
        messages: [],
      },
    ];
  };

  try {
    const detailResponse = await fetch(`${server.origin}/api/task-creation/projects/${projectId}`, {
      headers: { 'x-test-user-id': userId },
    });
    assert.equal(detailResponse.status, 200);
    const detailPayload = await detailResponse.json();
    assert.equal(detailPayload.data?.id, projectId);
    assert.equal(detailPayload.data?.pinned, true);

    const sessionsResponse = await fetch(`${server.origin}/api/task-creation/projects/${projectId}/sessions`, {
      headers: { 'x-test-user-id': userId },
    });
    assert.equal(sessionsResponse.status, 200);
    const sessionsPayload = await sessionsResponse.json();
    assert.equal(sessionsPayload.data?.[0]?.id, 'session-1');
    assert.equal(sessionsPayload.data?.[0]?.projectId, projectId);

    assert.equal(received.includes(`project:${userId}:${projectId}`), true);
    assert.equal(received.includes(`sessions:${userId}:${projectId}`), true);
  } finally {
    await server.close();
  }
});

test('project update and delete routes persist pinned state and clear session assignments', async () => {
  const server = await startServer();
  const received: string[] = [];
  let clearedDbProjectId = '';
  let clearedFileProjectId = '';
  let deletedProjectId = '';

  projectDaoAny.getOwnedProjectById = async (projectId: string, userId: string) => ({
    id: projectId,
    userId,
    name: 'Project A',
    description: 'desc',
    projectType: 'standard',
    status: 'active',
    metadataJson: { pinned: false },
    createdAt: new Date('2026-04-21T00:00:00.000Z'),
    updatedAt: new Date('2026-04-21T00:00:00.000Z'),
  });
  projectDaoAny.getOwnedProjectByName = async (userId: string, name: string) => {
    received.push(`name:${userId}:${name}`);
    return null;
  };
  projectDaoAny.updateOwnedProject = async (projectId: string, userId: string, patch: Record<string, unknown>) => {
    received.push(`update:${userId}:${projectId}:${String(patch.name)}:${String(patch.pinned)}`);
    return {
      id: projectId,
      userId,
      name: patch.name,
      description: patch.description || '',
      projectType: 'standard',
      status: 'active',
      metadataJson: { pinned: Boolean(patch.pinned) },
      createdAt: new Date('2026-04-21T00:00:00.000Z'),
      updatedAt: new Date('2026-04-21T00:00:00.000Z'),
    };
  };
  projectDaoAny.deleteOwnedProject = async (projectId: string, userId: string) => {
    deletedProjectId = `${userId}:${projectId}`;
    return { id: projectId, userId };
  };
  sessionDaoAny.clearProjectAssignmentForUser = async (userId: string, projectId: string) => {
    clearedDbProjectId = `${userId}:${projectId}`;
    return 2;
  };
  fileStoreAny.clearProjectAssignment = async (projectId: string) => {
    clearedFileProjectId = projectId;
  };

  try {
    const updateResponse = await fetch(`${server.origin}/api/task-creation/projects/project-9`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-test-user-id': 'user-project-9',
      },
      body: JSON.stringify({ name: 'Project Z', description: 'updated', pinned: true }),
    });
    assert.equal(updateResponse.status, 200);
    const updatePayload = await updateResponse.json();
    assert.equal(updatePayload.data?.name, 'Project Z');
    assert.equal(updatePayload.data?.pinned, true);

    const deleteResponse = await fetch(`${server.origin}/api/task-creation/projects/project-9`, {
      method: 'DELETE',
      headers: {
        'x-test-user-id': 'user-project-9',
      },
    });
    assert.equal(deleteResponse.status, 200);
    const deletePayload = await deleteResponse.json();
    assert.equal(deletePayload.success, true);

    assert.deepEqual(received, [
      'name:user-project-9:Project Z',
      'update:user-project-9:project-9:Project Z:true',
    ]);
    assert.equal(clearedDbProjectId, 'user-project-9:project-9');
    assert.equal(clearedFileProjectId, 'project-9');
    assert.equal(deletedProjectId, 'user-project-9:project-9');
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
    { method: 'POST', path: '/api/task-creation/sessions/s-1/project', body: { projectId: '1', projectName: 'oneceo.ai' } },
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

test('project assignment route updates db and file memory for the owner', async () => {
  const server = await startServer();
  const dbUpdates: Array<{ sessionId: string; payload: Record<string, unknown> }> = [];
  const fileUpdates: Array<{ sessionId: string; payload: Record<string, unknown> }> = [];
  const sessionState = {
    projectId: null as string | null,
    projectName: null as string | null,
  };
  projectDaoAny.getOwnedProjectById = async (projectId: string, userId: string) => ({
    id: projectId,
    userId,
    name: 'oneceo.ai',
    description: '',
    projectType: 'standard',
    status: 'active',
    createdAt: new Date('2026-04-21T00:00:00.000Z'),
    updatedAt: new Date('2026-04-21T00:00:00.000Z'),
  });
  sessionDaoAny.getSession = async (sessionId: string) => ({
    id: sessionId,
    userId: 'owner-user',
    status: 'in_progress',
    projectId: sessionState.projectId,
    projectName: sessionState.projectName,
  });
  sessionDaoAny.updateSessionProject = async (sessionId: string, payload: Record<string, unknown>) => {
    dbUpdates.push({ sessionId, payload });
    return {
      id: sessionId,
      userId: 'owner-user',
      status: 'in_progress',
      projectId: payload.projectId ?? null,
      projectName: payload.projectName ?? null,
    };
  };
  fileStoreAny.getSession = async (sessionId: string) => ({
    id: sessionId,
    title: 'Session',
    status: 'in_progress',
    projectId: sessionState.projectId,
    projectName: sessionState.projectName,
    messages: [],
  });
  fileStoreAny.updateSessionProject = async (sessionId: string, payload: Record<string, unknown>) => {
    fileUpdates.push({ sessionId, payload });
    sessionState.projectId = typeof payload.projectId === 'string' ? payload.projectId : null;
    sessionState.projectName = typeof payload.projectName === 'string' ? payload.projectName : null;
  };

  try {
    const response = await fetch(`${server.origin}/api/task-creation/sessions/s-3/project`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user-id': 'owner-user',
      },
      body: JSON.stringify({
        projectId: '1',
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.projectId, '1');
    assert.equal(payload.data.projectName, 'oneceo.ai');
    assert.deepEqual(dbUpdates, [
      {
        sessionId: 's-3',
        payload: {
          projectId: '1',
          projectName: 'oneceo.ai',
        },
      },
    ]);
    assert.deepEqual(fileUpdates, [
      {
        sessionId: 's-3',
        payload: {
          projectId: '1',
          projectName: 'oneceo.ai',
        },
      },
    ]);
  } finally {
    await server.close();
  }
});

test('session detail prefers completed lifecycle from db over stale memory state', async () => {
  const server = await startServer();
  sessionDaoAny.getSession = async (sessionId: string) => ({
    id: sessionId,
    userId: 'owner-user',
    status: 'completed',
    stage: 'completed',
    updatedAt: new Date('2026-04-16T03:14:54.664Z'),
  });
  fileStoreAny.getSession = async (sessionId: string) => ({
    id: sessionId,
    title: 'Demo session',
    status: 'in_progress',
    stage: 'collecting',
    phase: 'analysis',
    mode: 'altus',
    driver: 'altus',
    executor: 'altus',
    runtime: {},
    messages: [],
    createdAt: '2026-04-16T03:13:00.000Z',
    updatedAt: '2026-04-16T03:14:11.865Z',
  });

  try {
    const response = await fetch(`${server.origin}/api/task-creation/sessions/session-stale-status`, {
      headers: { 'x-test-user-id': 'owner-user' },
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.success, true);
    assert.equal(payload.data.status, 'completed');
    assert.equal(payload.data.stage, 'completed');
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
