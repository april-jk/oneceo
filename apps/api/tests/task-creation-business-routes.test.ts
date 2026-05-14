import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import express from 'express';
import taskCreationRoutes from '../src/routes/task-creation-routes';
import { mockAuthContextMiddleware } from './helpers/mock-auth-context';
import { taskCreationFileMemoryStore } from '../src/agents/task-creation/file-memory-store';
import { appUserLegacyIdMappingDAO, taskCreationSessionDAO } from '../src/db/dao';
import { billingService } from '../src/services/billing-service';

type TestServer = {
  origin: string;
  close: () => Promise<void>;
};

const fileStoreAny = taskCreationFileMemoryStore as any;
const sessionDaoAny = taskCreationSessionDAO as any;
const legacyMappingDaoAny = appUserLegacyIdMappingDAO as any;
const billingServiceAny = billingService as any;

const originalListSessions = fileStoreAny.listSessions;
const originalCreateSession = fileStoreAny.createSession;
const originalGetSession = fileStoreAny.getSession;
const originalUpdateSessionTitle = fileStoreAny.updateSessionTitle;
const originalAddMessage = fileStoreAny.addMessage;
const originalGetRecentSessions = sessionDaoAny.getRecentSessions;
const originalHasForeignOwnedSessions = sessionDaoAny.hasForeignOwnedSessions;
const originalRebindRecentUnownedSessionsToUser = sessionDaoAny.rebindRecentUnownedSessionsToUser;
const originalRebindSessionsFromLegacyUserId = sessionDaoAny.rebindSessionsFromLegacyUserId;
const originalGetSessionDao = sessionDaoAny.getSession;
const originalGetTaskDescriptionDao = sessionDaoAny.getTaskDescription;
const originalGetMessagesDao = sessionDaoAny.getMessages;
const originalCreateSessionDao = sessionDaoAny.createSession;
const originalBindUserIfMissingDao = sessionDaoAny.bindUserIfMissing;
const originalAddMessageDao = sessionDaoAny.addMessage;
const originalLegacyMappingUpsert = legacyMappingDaoAny.upsert;
const originalLegacyMappingListByAppUserId = legacyMappingDaoAny.listLegacyIdsByAppUserId;
const originalLegacyMappingResolveByLegacy = legacyMappingDaoAny.resolveAppUserIdByLegacyUserId;
const originalHasEnoughCredits = billingServiceAny.hasEnoughCredits;
const originalGetUserCredits = billingServiceAny.getUserCredits;

after(() => {
  fileStoreAny.listSessions = originalListSessions;
  fileStoreAny.createSession = originalCreateSession;
  fileStoreAny.getSession = originalGetSession;
  fileStoreAny.updateSessionTitle = originalUpdateSessionTitle;
  fileStoreAny.addMessage = originalAddMessage;
  sessionDaoAny.getRecentSessions = originalGetRecentSessions;
  sessionDaoAny.hasForeignOwnedSessions = originalHasForeignOwnedSessions;
  sessionDaoAny.rebindRecentUnownedSessionsToUser = originalRebindRecentUnownedSessionsToUser;
  sessionDaoAny.rebindSessionsFromLegacyUserId = originalRebindSessionsFromLegacyUserId;
  sessionDaoAny.getSession = originalGetSessionDao;
  sessionDaoAny.getTaskDescription = originalGetTaskDescriptionDao;
  sessionDaoAny.getMessages = originalGetMessagesDao;
  sessionDaoAny.createSession = originalCreateSessionDao;
  sessionDaoAny.bindUserIfMissing = originalBindUserIfMissingDao;
  sessionDaoAny.addMessage = originalAddMessageDao;
  legacyMappingDaoAny.upsert = originalLegacyMappingUpsert;
  legacyMappingDaoAny.listLegacyIdsByAppUserId = originalLegacyMappingListByAppUserId;
  legacyMappingDaoAny.resolveAppUserIdByLegacyUserId = originalLegacyMappingResolveByLegacy;
  billingServiceAny.hasEnoughCredits = originalHasEnoughCredits;
  billingServiceAny.getUserCredits = originalGetUserCredits;
});

async function startServer(): Promise<TestServer> {
  billingServiceAny.hasEnoughCredits = async () => true;
  billingServiceAny.getUserCredits = async () => ({ balance: 1000 });
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

function createMemorySession(id: string, title = `Session ${id}`) {
  return {
    id,
    title,
    status: 'in_progress',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [],
    runtime: {},
  };
}

test('GET /api/task-creation/sessions rejects anonymous access', async () => {
  const server = await startServer();
  fileStoreAny.listSessions = async () => [];
  sessionDaoAny.getRecentSessions = async () => [];
  sessionDaoAny.hasForeignOwnedSessions = async () => false;
  sessionDaoAny.rebindRecentUnownedSessionsToUser = async () => [];
  sessionDaoAny.rebindSessionsFromLegacyUserId = async () => [];
  legacyMappingDaoAny.upsert = async () => null;
  legacyMappingDaoAny.listLegacyIdsByAppUserId = async () => [];
  legacyMappingDaoAny.resolveAppUserIdByLegacyUserId = async () => null;

  try {
    const response = await fetch(`${server.origin}/api/task-creation/sessions`);
    const payload = await response.json();

    assert.equal(response.status, 401);
    assert.equal(payload.success, false);
  } finally {
    await server.close();
  }
});

test('GET /api/task-creation/sessions only returns sessions owned by current user', async () => {
  const server = await startServer();
  fileStoreAny.listSessions = async () => [
    createMemorySession('owned-session', 'Owned Session'),
    createMemorySession('foreign-session', 'Foreign Session'),
  ];
  sessionDaoAny.getRecentSessions = async (_limit: number, userId?: string) => {
    assert.equal(userId, 'user-a');
    return [{ id: 'owned-session' }];
  };
  sessionDaoAny.hasForeignOwnedSessions = async () => false;
  sessionDaoAny.rebindRecentUnownedSessionsToUser = async () => [];
  sessionDaoAny.rebindSessionsFromLegacyUserId = async () => [];
  sessionDaoAny.getTaskDescription = async () => null;
  sessionDaoAny.getMessages = async () => [];
  legacyMappingDaoAny.upsert = async () => null;
  legacyMappingDaoAny.listLegacyIdsByAppUserId = async () => [];
  legacyMappingDaoAny.resolveAppUserIdByLegacyUserId = async () => null;

  try {
    const response = await fetch(`${server.origin}/api/task-creation/sessions`, {
      headers: {
        'x-test-user-id': 'user-a',
      },
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.length, 1);
    assert.equal(payload.data[0].id, 'owned-session');
  } finally {
    await server.close();
  }
});

test('GET /api/task-creation/sessions returns full owned db list when memory only has a partial overlap', async () => {
  const server = await startServer();
  fileStoreAny.listSessions = async () => [createMemorySession('owned-session-2', 'Recovered Session 2')];
  sessionDaoAny.getRecentSessions = async (_limit: number, userId?: string) => {
    assert.equal(userId, 'user-partial-memory');
    return [
      {
        id: 'owned-session-1',
        status: 'completed',
        projectId: null,
        projectName: null,
        createdAt: new Date('2026-04-21T10:00:00.000Z'),
        updatedAt: new Date('2026-04-21T12:00:00.000Z'),
      },
      {
        id: 'owned-session-2',
        status: 'in_progress',
        projectId: null,
        projectName: null,
        createdAt: new Date('2026-04-21T11:00:00.000Z'),
        updatedAt: new Date('2026-04-21T13:00:00.000Z'),
      },
    ];
  };
  sessionDaoAny.hasForeignOwnedSessions = async () => false;
  sessionDaoAny.rebindRecentUnownedSessionsToUser = async () => [];
  sessionDaoAny.rebindSessionsFromLegacyUserId = async () => [];
  sessionDaoAny.getTaskDescription = async () => null;
  sessionDaoAny.getMessages = async (sessionId: string) =>
    sessionId === 'owned-session-1'
      ? [{ role: 'user', content: '请帮我总结部署问题' }]
      : [{ role: 'user', content: '继续处理站点发布' }];
  legacyMappingDaoAny.upsert = async () => null;
  legacyMappingDaoAny.listLegacyIdsByAppUserId = async () => [];
  legacyMappingDaoAny.resolveAppUserIdByLegacyUserId = async () => null;

  try {
    const response = await fetch(`${server.origin}/api/task-creation/sessions?limit=all`, {
      headers: {
        'x-test-user-id': 'user-partial-memory',
      },
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.deepEqual(
      payload.data.map((item: { id: string }) => item.id),
      ['owned-session-1', 'owned-session-2']
    );
  } finally {
    await server.close();
  }
});

test('GET /api/task-creation/sessions uses state fallback title instead of id suffix', async () => {
  const server = await startServer();
  fileStoreAny.listSessions = async () => [];
  sessionDaoAny.getRecentSessions = async (_limit: number, userId?: string) => {
    assert.equal(userId, 'user-title-fallback');
    return [
      {
        id: 'owned-title-1',
        status: 'waiting_user',
        projectId: null,
        projectName: null,
        createdAt: new Date('2026-04-21T10:00:00.000Z'),
        updatedAt: new Date('2026-04-21T12:00:00.000Z'),
      },
    ];
  };
  sessionDaoAny.hasForeignOwnedSessions = async () => false;
  sessionDaoAny.rebindRecentUnownedSessionsToUser = async () => [];
  sessionDaoAny.rebindSessionsFromLegacyUserId = async () => [];
  sessionDaoAny.getTaskDescription = async () => null;
  sessionDaoAny.getMessages = async () => [];
  legacyMappingDaoAny.upsert = async () => null;
  legacyMappingDaoAny.listLegacyIdsByAppUserId = async () => [];
  legacyMappingDaoAny.resolveAppUserIdByLegacyUserId = async () => null;

  try {
    const response = await fetch(`${server.origin}/api/task-creation/sessions?limit=all`, {
      headers: {
        'x-test-user-id': 'user-title-fallback',
      },
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data[0].title, '待补充需求');
    assert.equal(payload.data[0].titleSource, 'placeholder');
  } finally {
    await server.close();
  }
});

test('POST /api/task-creation/sessions/:sessionId/title/resolve derives concise title from explicit input', async () => {
  const server = await startServer();
  const session = {
    id: 'title-session-1',
    title: '待识别任务',
    titleLocked: false,
    titleSource: 'placeholder',
    titleState: 'provisional',
    status: 'in_progress',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [],
  };

  fileStoreAny.getSession = async () => session;
  fileStoreAny.updateSessionTitle = async (
    sessionId: string,
    title: string,
    options?: { lock?: boolean; source?: string; state?: string }
  ) => {
    assert.equal(sessionId, 'title-session-1');
    session.title = title;
    session.titleLocked = Boolean(options?.lock);
    session.titleSource = options?.source;
    session.titleState = options?.state;
  };
  sessionDaoAny.getSession = async () => ({
    id: 'title-session-1',
    userId: 'user-title-resolve',
    status: 'in_progress',
  });
  legacyMappingDaoAny.upsert = async () => null;
  legacyMappingDaoAny.listLegacyIdsByAppUserId = async () => [];
  legacyMappingDaoAny.resolveAppUserIdByLegacyUserId = async () => null;

  try {
    const response = await fetch(`${server.origin}/api/task-creation/sessions/title-session-1/title/resolve`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user-id': 'user-title-resolve',
      },
      body: JSON.stringify({
        message: '你好，做一次v7冷启动排查',
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.title, 'v7 冷启动排查');
    assert.equal(payload.data.titleSource, 'first_explicit_user_input');
    assert.equal(payload.data.titleState, 'provisional');
    assert.equal(payload.data.resolved, true);
  } finally {
    await server.close();
  }
});

test('POST /api/task-creation/sessions/:sessionId/title/resolve composes concise build title from explicit input', async () => {
  const server = await startServer();
  const session = {
    id: 'title-session-2',
    title: '待识别任务',
    titleLocked: false,
    titleSource: 'placeholder',
    titleState: 'provisional',
    status: 'in_progress',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [],
  };

  fileStoreAny.getSession = async () => session;
  fileStoreAny.updateSessionTitle = async (
    _sessionId: string,
    title: string,
    options?: { lock?: boolean; source?: string; state?: string }
  ) => {
    session.title = title;
    session.titleLocked = Boolean(options?.lock);
    session.titleSource = options?.source;
    session.titleState = options?.state;
  };
  sessionDaoAny.getSession = async () => ({
    id: 'title-session-2',
    userId: 'user-title-build',
    status: 'in_progress',
  });
  legacyMappingDaoAny.upsert = async () => null;
  legacyMappingDaoAny.listLegacyIdsByAppUserId = async () => [];
  legacyMappingDaoAny.resolveAppUserIdByLegacyUserId = async () => null;

  try {
    const response = await fetch(`${server.origin}/api/task-creation/sessions/title-session-2/title/resolve`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user-id': 'user-title-build',
      },
      body: JSON.stringify({
        message: '帮我开发2048小游戏，使用html实现',
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.title, 'HTML 2048 小游戏');
    assert.equal(payload.data.resolved, true);
  } finally {
    await server.close();
  }
});

test('GET /api/task-creation/sessions does not reuse a smaller cached list for a larger request', async () => {
  const server = await startServer();
  fileStoreAny.listSessions = async () => [];

  const sessions = [
    {
      id: 'owned-cache-1',
      status: 'completed',
      projectId: null,
      projectName: null,
      createdAt: new Date('2026-04-21T08:00:00.000Z'),
      updatedAt: new Date('2026-04-21T09:00:00.000Z'),
    },
    {
      id: 'owned-cache-2',
      status: 'in_progress',
      projectId: null,
      projectName: null,
      createdAt: new Date('2026-04-21T10:00:00.000Z'),
      updatedAt: new Date('2026-04-21T11:00:00.000Z'),
    },
  ];
  const requestedLimits: number[] = [];
  sessionDaoAny.getRecentSessions = async (limit: number, userId?: string) => {
    assert.equal(userId, 'user-cache-limit');
    requestedLimits.push(limit);
    return limit <= 1 ? sessions.slice(0, 1) : sessions;
  };
  sessionDaoAny.hasForeignOwnedSessions = async () => false;
  sessionDaoAny.rebindRecentUnownedSessionsToUser = async () => [];
  sessionDaoAny.rebindSessionsFromLegacyUserId = async () => [];
  sessionDaoAny.getTaskDescription = async () => null;
  sessionDaoAny.getMessages = async () => [];
  legacyMappingDaoAny.upsert = async () => null;
  legacyMappingDaoAny.listLegacyIdsByAppUserId = async () => [];
  legacyMappingDaoAny.resolveAppUserIdByLegacyUserId = async () => null;

  try {
    const firstResponse = await fetch(`${server.origin}/api/task-creation/sessions?limit=1`, {
      headers: {
        'x-test-user-id': 'user-cache-limit',
      },
    });
    const firstPayload = await firstResponse.json();

    const secondResponse = await fetch(`${server.origin}/api/task-creation/sessions?limit=all`, {
      headers: {
        'x-test-user-id': 'user-cache-limit',
      },
    });
    const secondPayload = await secondResponse.json();

    assert.equal(firstResponse.status, 200);
    assert.equal(firstPayload.data.length, 1);
    assert.equal(secondResponse.status, 200);
    assert.equal(secondPayload.success, true);
    assert.deepEqual(
      secondPayload.data.map((item: { id: string }) => item.id),
      ['owned-cache-1', 'owned-cache-2']
    );
    assert.equal(requestedLimits.length, 2);
  } finally {
    await server.close();
  }
});

test('POST /api/task-creation/sessions binds db session to current user', async () => {
  const server = await startServer();
  const snapshot = createMemorySession('new-session', 'Bound Session');
  let createdUserId = '';

  fileStoreAny.getSession = async () => null;
  fileStoreAny.createSession = async (title: string, sessionId: string) => ({
    ...snapshot,
    id: sessionId,
    title,
  });
  fileStoreAny.addMessage = async () => undefined;
  sessionDaoAny.getSession = async () => null;
  sessionDaoAny.createSession = async (input: { userId: string; id: string; status: string }) => {
    createdUserId = input.userId;
    return { ...input };
  };
  sessionDaoAny.bindUserIfMissing = async () => undefined;
  sessionDaoAny.addMessage = async () => undefined;
  fileStoreAny.getSession = async () => snapshot;
  legacyMappingDaoAny.upsert = async () => null;
  legacyMappingDaoAny.listLegacyIdsByAppUserId = async () => [];
  legacyMappingDaoAny.resolveAppUserIdByLegacyUserId = async () => null;

  try {
    const response = await fetch(`${server.origin}/api/task-creation/sessions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user-id': 'user-bind-1',
      },
      body: JSON.stringify({
        sessionId: 'new-session',
        title: 'Bound Session',
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(createdUserId, 'user-bind-1');
  } finally {
    await server.close();
  }
});

test('GET /api/task-creation/sessions does not rebind unowned sessions when user list is empty', async () => {
  const server = await startServer();
  fileStoreAny.listSessions = async () => [];

  sessionDaoAny.getRecentSessions = async (_limit: number, userId?: string) => {
    assert.equal(userId, 'user-rebind-1');
    return [];
  };
  sessionDaoAny.hasForeignOwnedSessions = async () => false;
  sessionDaoAny.rebindSessionsFromLegacyUserId = async () => [];
  let rebindCalled = false;
  sessionDaoAny.rebindRecentUnownedSessionsToUser = async (userId: string, limit: number) => {
    rebindCalled = true;
    assert.equal(userId, 'user-rebind-1');
    assert.equal(limit, Number.MAX_SAFE_INTEGER);
    return [{ id: 'rebound-session', status: 'in_progress', createdAt: new Date(), updatedAt: new Date() }];
  };
  sessionDaoAny.getTaskDescription = async () => null;
  sessionDaoAny.getMessages = async () => [];
  legacyMappingDaoAny.upsert = async () => null;
  legacyMappingDaoAny.listLegacyIdsByAppUserId = async () => [];
  legacyMappingDaoAny.resolveAppUserIdByLegacyUserId = async () => null;

  try {
    const response = await fetch(`${server.origin}/api/task-creation/sessions?limit=all`, {
      headers: {
        'x-test-user-id': 'user-rebind-1',
      },
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(rebindCalled, false);
    assert.equal(payload.data.length, 0);
  } finally {
    await server.close();
  }
});

test('GET /api/task-creation/sessions does not rebind when foreign owned sessions exist', async () => {
  const server = await startServer();
  fileStoreAny.listSessions = async () => [];
  sessionDaoAny.getRecentSessions = async () => [];
  sessionDaoAny.hasForeignOwnedSessions = async () => true;
  sessionDaoAny.rebindSessionsFromLegacyUserId = async () => [];
  legacyMappingDaoAny.upsert = async () => null;
  legacyMappingDaoAny.listLegacyIdsByAppUserId = async () => [];
  legacyMappingDaoAny.resolveAppUserIdByLegacyUserId = async () => null;

  let rebindCalled = false;
  sessionDaoAny.rebindRecentUnownedSessionsToUser = async () => {
    rebindCalled = true;
    return [];
  };

  try {
    const response = await fetch(`${server.origin}/api/task-creation/sessions`, {
      headers: {
        'x-test-user-id': 'user-safe-1',
      },
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(rebindCalled, false);
    assert.equal(Array.isArray(payload.data), true);
    assert.equal(payload.data.length, 0);
  } finally {
    await server.close();
  }
});

test('GET /api/task-creation/sessions rebinds legacy user sessions before orphan fallback', async () => {
  const server = await startServer();
  fileStoreAny.listSessions = async () => [createMemorySession('legacy-bound-1', 'Legacy Bound')];
  sessionDaoAny.getRecentSessions = async () => [];
  sessionDaoAny.hasForeignOwnedSessions = async () => true;
  sessionDaoAny.getTaskDescription = async () => null;
  sessionDaoAny.getMessages = async () => [];
  legacyMappingDaoAny.upsert = async () => null;
  legacyMappingDaoAny.listLegacyIdsByAppUserId = async (userId: string) => {
    assert.equal(userId, 'user-legacy-1');
    return ['legacy-local-user-1'];
  };
  legacyMappingDaoAny.resolveAppUserIdByLegacyUserId = async () => null;

  let orphanRebindCalled = false;
  sessionDaoAny.rebindRecentUnownedSessionsToUser = async () => {
    orphanRebindCalled = true;
    return [];
  };

  let legacyRebindCalled = false;
  sessionDaoAny.rebindSessionsFromLegacyUserId = async (userId: string, legacyUserId: string, limit: number) => {
    legacyRebindCalled = true;
    assert.equal(userId, 'user-legacy-1');
    assert.equal(legacyUserId, 'legacy-local-user-1');
    assert.equal(limit, 200);
    return [{ id: 'legacy-bound-1', status: 'in_progress', createdAt: new Date(), updatedAt: new Date() }];
  };

  try {
    const response = await fetch(`${server.origin}/api/task-creation/sessions`, {
      headers: {
        'x-test-user-id': 'user-legacy-1',
      },
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(legacyRebindCalled, true);
    assert.equal(orphanRebindCalled, false);
    assert.equal(payload.data.length, 1);
    assert.equal(payload.data[0].id, 'legacy-bound-1');
  } finally {
    await server.close();
  }
});

test('POST /api/task-creation/sessions binds existing orphan db session to current user', async () => {
  const server = await startServer();
  const snapshot = createMemorySession('existing-orphan', 'Recovered Session');

  fileStoreAny.getSession = async () => snapshot;
  fileStoreAny.createSession = async () => snapshot;
  fileStoreAny.addMessage = async () => undefined;

  sessionDaoAny.getSession = async () => ({
    id: 'existing-orphan',
    userId: null,
    status: 'in_progress',
  });
  sessionDaoAny.createSession = async () => {
    throw new Error('should not create new db session');
  };

  let boundSessionId = '';
  let boundUserId = '';
  sessionDaoAny.bindUserIfMissing = async (sessionId: string, userId: string) => {
    boundSessionId = sessionId;
    boundUserId = userId;
    return { id: sessionId, userId, status: 'in_progress' };
  };
  sessionDaoAny.addMessage = async () => undefined;
  legacyMappingDaoAny.upsert = async () => null;
  legacyMappingDaoAny.listLegacyIdsByAppUserId = async () => [];
  legacyMappingDaoAny.resolveAppUserIdByLegacyUserId = async () => null;

  try {
    const response = await fetch(`${server.origin}/api/task-creation/sessions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user-id': 'user-bind-existing',
      },
      body: JSON.stringify({
        sessionId: 'existing-orphan',
        title: 'Recovered Session',
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(boundSessionId, 'existing-orphan');
    assert.equal(boundUserId, 'user-bind-existing');
  } finally {
    await server.close();
  }
});

test('POST /api/task-creation/sessions adopts existing legacy-owned db session via mapping', async () => {
  const server = await startServer();
  const snapshot = createMemorySession('existing-legacy', 'Recovered Legacy Session');
  let adoptedSessionId = '';
  let adoptedUserId = '';
  let adoptedLegacyUserId = '';

  fileStoreAny.getSession = async () => snapshot;
  fileStoreAny.createSession = async () => snapshot;
  fileStoreAny.addMessage = async () => undefined;

  sessionDaoAny.getSession = async () => ({
    id: 'existing-legacy',
    userId: 'legacy-local-user-3',
    status: 'in_progress',
  });
  sessionDaoAny.createSession = async () => {
    throw new Error('should not create new db session');
  };
  legacyMappingDaoAny.resolveAppUserIdByLegacyUserId = async (legacyUserId: string) => {
    assert.equal(legacyUserId, 'legacy-local-user-3');
    return 'user-bind-legacy';
  };
  sessionDaoAny.adoptSessionFromLegacyUserId = async (
    sessionId: string,
    userId: string,
    legacyUserId: string
  ) => {
    adoptedSessionId = sessionId;
    adoptedUserId = userId;
    adoptedLegacyUserId = legacyUserId;
    return { id: sessionId, userId, status: 'in_progress' };
  };
  sessionDaoAny.bindUserIfMissing = async (sessionId: string, userId: string) => ({
    id: sessionId,
    userId,
    status: 'in_progress',
  });
  sessionDaoAny.addMessage = async () => undefined;
  legacyMappingDaoAny.upsert = async () => null;
  legacyMappingDaoAny.listLegacyIdsByAppUserId = async () => [];

  try {
    const response = await fetch(`${server.origin}/api/task-creation/sessions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user-id': 'user-bind-legacy',
      },
      body: JSON.stringify({
        sessionId: 'existing-legacy',
        title: 'Recovered Legacy Session',
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(adoptedSessionId, 'existing-legacy');
    assert.equal(adoptedUserId, 'user-bind-legacy');
    assert.equal(adoptedLegacyUserId, 'legacy-local-user-3');
  } finally {
    await server.close();
  }
});

test('GET /api/task-creation/sessions/:sessionId/workspace/dir blocks foreign user', async () => {
  const server = await startServer();
  sessionDaoAny.getSession = async (sessionId: string) => ({
    id: sessionId,
    userId: 'owner-user',
  });
  legacyMappingDaoAny.upsert = async () => null;
  legacyMappingDaoAny.listLegacyIdsByAppUserId = async () => [];
  legacyMappingDaoAny.resolveAppUserIdByLegacyUserId = async () => null;

  try {
    const response = await fetch(`${server.origin}/api/task-creation/sessions/foreign-1/workspace/dir`, {
      headers: {
        'x-test-user-id': 'visitor-user',
      },
    });
    const payload = await response.json();

    assert.equal(response.status, 403);
    assert.equal(payload.success, false);
    assert.equal(payload.error, '当前用户无权访问该会话');
  } finally {
    await server.close();
  }
});
