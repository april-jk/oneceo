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
const originalGetSessionDao = sessionDaoAny.getSession;
const originalCreateSessionDao = sessionDaoAny.createSession;
const originalAddMessageDao = sessionDaoAny.addMessage;

after(() => {
  fileStoreAny.listSessions = originalListSessions;
  fileStoreAny.createSession = originalCreateSession;
  fileStoreAny.getSession = originalGetSession;
  fileStoreAny.addMessage = originalAddMessage;
  sessionDaoAny.getRecentSessions = originalGetRecentSessions;
  sessionDaoAny.getSession = originalGetSessionDao;
  sessionDaoAny.createSession = originalCreateSessionDao;
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
