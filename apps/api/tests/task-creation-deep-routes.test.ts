import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import express from 'express';
import taskCreationRoutes from '../src/routes/task-creation-routes';
import { taskCreationSessionDAO, taskSessionRunDAO } from '../src/db/dao';
import { taskCreationFileMemoryStore } from '../src/agents/task-creation/file-memory-store';
import { sessionConnectorService } from '../src/services/session-connector-service';
import { taskSessionDeliverableService } from '../src/services/task-session-deliverable-service';

type TestServer = {
  origin: string;
  close: () => Promise<void>;
};

const sessionDaoAny = taskCreationSessionDAO as any;
const runDaoAny = taskSessionRunDAO as any;
const fileStoreAny = taskCreationFileMemoryStore as any;
const sessionConnectorAny = sessionConnectorService as any;
const deliverableServiceAny = taskSessionDeliverableService as any;

const originalGetSessionDao = sessionDaoAny.getSession;
const originalGetRecentMessages = sessionDaoAny.getRecentMessages;
const originalGetMessages = sessionDaoAny.getMessages;
const originalGetRun = runDaoAny.getRun;
const originalGetSessionFile = fileStoreAny.getSession;
const originalAssertOwnership = sessionConnectorAny.assertSessionOwnership;
const originalListSessionConnectors = sessionConnectorAny.listSessionConnectors;
const originalDetachConnector = sessionConnectorAny.detachConnector;
const originalListDeliverables = deliverableServiceAny.listSessionDeliverables;

after(() => {
  sessionDaoAny.getSession = originalGetSessionDao;
  sessionDaoAny.getRecentMessages = originalGetRecentMessages;
  sessionDaoAny.getMessages = originalGetMessages;
  runDaoAny.getRun = originalGetRun;
  fileStoreAny.getSession = originalGetSessionFile;
  sessionConnectorAny.assertSessionOwnership = originalAssertOwnership;
  sessionConnectorAny.listSessionConnectors = originalListSessionConnectors;
  sessionConnectorAny.detachConnector = originalDetachConnector;
  deliverableServiceAny.listSessionDeliverables = originalListDeliverables;
});

async function startServer(): Promise<TestServer> {
  const app = express();
  app.use(express.json());
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

function ownerSession(sessionId: string, userId = 'owner-user') {
  return {
    id: sessionId,
    userId,
    title: 'Owner Session',
    status: 'in_progress',
    mode: 'altus',
    executor: 'opencode',
    runtime: {},
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

test('GET /api/task-creation/sessions/:sessionId returns 403 for foreign user', async () => {
  const server = await startServer();
  sessionDaoAny.getSession = async (sessionId: string) => ({ id: sessionId, userId: 'owner-user' });

  try {
    const response = await fetch(`${server.origin}/api/task-creation/sessions/s-1`, {
      headers: { 'x-user-id': 'other-user' },
    });
    const payload = await response.json();

    assert.equal(response.status, 403);
    assert.equal(payload.error, '当前用户无权访问该会话');
  } finally {
    await server.close();
  }
});

test('GET /api/task-creation/sessions/:sessionId/messages/recent returns 403 for foreign user', async () => {
  const server = await startServer();
  sessionDaoAny.getSession = async (sessionId: string) => ({ id: sessionId, userId: 'owner-user' });

  try {
    const response = await fetch(`${server.origin}/api/task-creation/sessions/s-2/messages/recent`, {
      headers: { 'x-user-id': 'other-user' },
    });
    const payload = await response.json();

    assert.equal(response.status, 403);
    assert.equal(payload.error, '当前用户无权访问该会话');
  } finally {
    await server.close();
  }
});

test('GET /api/task-creation/sessions/:sessionId/messages/recent returns owner messages', async () => {
  const server = await startServer();
  sessionDaoAny.getSession = async (sessionId: string) => ({ id: sessionId, userId: 'owner-user' });
  fileStoreAny.getSession = async (sessionId: string) => ownerSession(sessionId);
  sessionDaoAny.getRecentMessages = async () => [];

  try {
    const response = await fetch(`${server.origin}/api/task-creation/sessions/s-3/messages/recent`, {
      headers: { 'x-user-id': 'owner-user' },
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.ok(Array.isArray(payload.data.messages));
  } finally {
    await server.close();
  }
});

test('GET /api/task-creation/sessions/:sessionId/messages/history returns 403 for foreign user', async () => {
  const server = await startServer();
  sessionDaoAny.getSession = async (sessionId: string) => ({ id: sessionId, userId: 'owner-user' });

  try {
    const response = await fetch(`${server.origin}/api/task-creation/sessions/s-4/messages/history`, {
      headers: { 'x-user-id': 'other-user' },
    });
    const payload = await response.json();

    assert.equal(response.status, 403);
    assert.equal(payload.error, '当前用户无权访问该会话');
  } finally {
    await server.close();
  }
});

test('GET /api/task-creation/sessions/:sessionId/messages returns 403 for foreign user', async () => {
  const server = await startServer();
  sessionDaoAny.getSession = async (sessionId: string) => ({ id: sessionId, userId: 'owner-user' });

  try {
    const response = await fetch(`${server.origin}/api/task-creation/sessions/s-5/messages`, {
      headers: { 'x-user-id': 'other-user' },
    });
    const payload = await response.json();

    assert.equal(response.status, 403);
    assert.equal(payload.error, '当前用户无权访问该会话');
  } finally {
    await server.close();
  }
});

test('POST /api/task-creation/attachments/fetch rejects anonymous access', async () => {
  const server = await startServer();

  try {
    const response = await fetch(`${server.origin}/api/task-creation/attachments/fetch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'website', url: 'https://example.com/file.txt' }),
    });
    const payload = await response.json();

    assert.equal(response.status, 401);
    assert.equal(payload.success, false);
  } finally {
    await server.close();
  }
});

test('GET /api/task-creation/sessions/:sessionId/deliverables returns owner-scoped artifacts', async () => {
  const server = await startServer();
  let assertedUserId = '';
  sessionConnectorAny.assertSessionOwnership = async (_sessionId: string, userId: string) => {
    assertedUserId = userId;
  };
  deliverableServiceAny.listSessionDeliverables = async () => [
    {
      id: 'artifact-1',
      runId: 'run-1',
      path: 'deliverables/output.txt',
      name: 'output.txt',
      mimeType: 'text/plain',
      sizeBytes: 12,
      createdAt: new Date().toISOString(),
    },
  ];

  try {
    const response = await fetch(`${server.origin}/api/task-creation/sessions/s-6/deliverables`, {
      headers: { 'x-user-id': 'owner-user' },
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(assertedUserId, 'owner-user');
    assert.equal(payload.data.length, 1);
    assert.equal(payload.data[0].id, 'artifact-1');
  } finally {
    await server.close();
  }
});

test('POST /api/task-creation/sessions/:sessionId/runtime/start returns 403 for foreign user', async () => {
  const server = await startServer();
  sessionConnectorAny.assertSessionOwnership = async () => {
    throw new Error('当前用户无权管理该会话连接器');
  };

  try {
    const response = await fetch(`${server.origin}/api/task-creation/sessions/s-7/runtime/start`, {
      method: 'POST',
      headers: { 'x-user-id': 'other-user' },
    });
    const payload = await response.json();

    assert.equal(response.status, 403);
    assert.equal(payload.error, '当前用户无权管理该会话连接器');
  } finally {
    await server.close();
  }
});

test('POST /api/task-creation/sessions/:sessionId/runtime/touch returns 403 for foreign user', async () => {
  const server = await startServer();
  sessionConnectorAny.assertSessionOwnership = async () => {
    throw new Error('当前用户无权管理该会话连接器');
  };

  try {
    const response = await fetch(`${server.origin}/api/task-creation/sessions/s-8/runtime/touch`, {
      method: 'POST',
      headers: { 'x-user-id': 'other-user' },
    });
    const payload = await response.json();

    assert.equal(response.status, 403);
    assert.equal(payload.error, '当前用户无权管理该会话连接器');
  } finally {
    await server.close();
  }
});

test('GET /api/task-creation/sessions/:sessionId/connectors returns current user connector status', async () => {
  const server = await startServer();
  sessionConnectorAny.assertSessionOwnership = async () => undefined;
  sessionConnectorAny.listSessionConnectors = async (_sessionId: string, userId: string) => {
    assert.equal(userId, 'owner-user');
    return [{ connectorKey: 'github', attached: true }];
  };

  try {
    const response = await fetch(`${server.origin}/api/task-creation/sessions/s-9/connectors`, {
      headers: { 'x-user-id': 'owner-user' },
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.items.length, 1);
  } finally {
    await server.close();
  }
});

test('POST /api/task-creation/sessions/:sessionId/connectors/:connectorKey/attach returns 403 for foreign user', async () => {
  const server = await startServer();
  sessionConnectorAny.assertSessionOwnership = async () => {
    throw new Error('当前用户无权管理该会话连接器');
  };

  try {
    const response = await fetch(`${server.origin}/api/task-creation/sessions/s-10/connectors/github/attach`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': 'other-user',
      },
      body: JSON.stringify({ profileId: 'profile-1' }),
    });
    const payload = await response.json();

    assert.equal(response.status, 403);
    assert.equal(payload.error, '当前用户无权管理该会话连接器');
  } finally {
    await server.close();
  }
});

test('POST /api/task-creation/sessions/:sessionId/connectors/:connectorKey/detach detaches for owner', async () => {
  const server = await startServer();
  sessionConnectorAny.assertSessionOwnership = async () => undefined;
  fileStoreAny.getSession = async (sessionId: string) => ownerSession(sessionId);
  sessionConnectorAny.detachConnector = async (_sessionId: string, userId: string, connectorKey: string) => {
    assert.equal(userId, 'owner-user');
    return { connectorKey, attached: false };
  };

  try {
    const response = await fetch(`${server.origin}/api/task-creation/sessions/s-11/connectors/github/detach`, {
      method: 'POST',
      headers: { 'x-user-id': 'owner-user' },
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.connector.connectorKey, 'github');
  } finally {
    await server.close();
  }
});

test('POST /api/task-creation/sessions/:sessionId/runtime/interrupt returns 403 for foreign user', async () => {
  const server = await startServer();
  sessionConnectorAny.assertSessionOwnership = async () => {
    throw new Error('当前用户无权管理该会话连接器');
  };

  try {
    const response = await fetch(`${server.origin}/api/task-creation/sessions/s-12/runtime/interrupt`, {
      method: 'POST',
      headers: { 'x-user-id': 'other-user' },
    });
    const payload = await response.json();

    assert.equal(response.status, 403);
    assert.equal(payload.error, '当前用户无权管理该会话连接器');
  } finally {
    await server.close();
  }
});
