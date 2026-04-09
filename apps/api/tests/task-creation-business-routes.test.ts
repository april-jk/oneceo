import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import express from 'express';
import taskCreationRoutes from '../src/routes/task-creation-routes';
import { mockAuthContextMiddleware } from './helpers/mock-auth-context';
import { taskCreationFileMemoryStore } from '../src/agents/task-creation/file-memory-store';
import { taskCreationSessionDAO } from '../src/db/dao';

type TestServer = {
  origin: string;
  close: () => Promise<void>;
};

const fileStoreAny = taskCreationFileMemoryStore as any;
const sessionDaoAny = taskCreationSessionDAO as any;

const originalListSessions = fileStoreAny.listSessions;
const originalCreateSession = fileStoreAny.createSession;
const originalGetSession = fileStoreAny.getSession;
const originalAddMessage = fileStoreAny.addMessage;
const originalGetRecentSessions = sessionDaoAny.getRecentSessions;
const originalHasForeignOwnedSessions = sessionDaoAny.hasForeignOwnedSessions;
const originalRebindRecentUnownedSessionsToUser = sessionDaoAny.rebindRecentUnownedSessionsToUser;
const originalRebindSessionsFromLegacyUserId = sessionDaoAny.rebindSessionsFromLegacyUserId;
const originalGetSessionDao = sessionDaoAny.getSession;
const originalCreateSessionDao = sessionDaoAny.createSession;
const originalBindUserIfMissingDao = sessionDaoAny.bindUserIfMissing;
const originalAddMessageDao = sessionDaoAny.addMessage;

after(() => {
  fileStoreAny.listSessions = originalListSessions;
  fileStoreAny.createSession = originalCreateSession;
  fileStoreAny.getSession = originalGetSession;
  fileStoreAny.addMessage = originalAddMessage;
  sessionDaoAny.getRecentSessions = originalGetRecentSessions;
  sessionDaoAny.hasForeignOwnedSessions = originalHasForeignOwnedSessions;
  sessionDaoAny.rebindRecentUnownedSessionsToUser = originalRebindRecentUnownedSessionsToUser;
  sessionDaoAny.rebindSessionsFromLegacyUserId = originalRebindSessionsFromLegacyUserId;
  sessionDaoAny.getSession = originalGetSessionDao;
  sessionDaoAny.createSession = originalCreateSessionDao;
  sessionDaoAny.bindUserIfMissing = originalBindUserIfMissingDao;
  sessionDaoAny.addMessage = originalAddMessageDao;
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

test('GET /api/task-creation/sessions rebinds unowned sessions when user list is empty', async () => {
  const server = await startServer();
  fileStoreAny.listSessions = async () => [];

  let getRecentCount = 0;
  sessionDaoAny.getRecentSessions = async (_limit: number, userId?: string) => {
    getRecentCount += 1;
    if (getRecentCount === 1) {
      assert.equal(userId, 'user-rebind-1');
      return [];
    }
    return [{ id: 'rebound-session', status: 'in_progress', createdAt: new Date(), updatedAt: new Date() }];
  };
  sessionDaoAny.hasForeignOwnedSessions = async (userId: string) => {
    assert.equal(userId, 'user-rebind-1');
    return false;
  };
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

  try {
    const response = await fetch(`${server.origin}/api/task-creation/sessions?limit=all`, {
      headers: {
        'x-test-user-id': 'user-rebind-1',
      },
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(rebindCalled, true);
    assert.equal(payload.data.length, 1);
    assert.equal(payload.data[0].id, 'rebound-session');
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
        'x-legacy-user-id': 'legacy-local-user-1',
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

test('GET /api/task-creation/sessions/:sessionId/workspace/dir blocks foreign user', async () => {
  const server = await startServer();
  sessionDaoAny.getSession = async (sessionId: string) => ({
    id: sessionId,
    userId: 'owner-user',
  });

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
