import assert from 'node:assert/strict';
import type { Socket } from 'node:net';
import { after, beforeEach, test } from 'node:test';
import express from 'express';
import Redis from 'ioredis';
import taskCreationRoutes from '../src/routes/task-creation-routes';
import { mockAuthContextMiddleware } from './helpers/mock-auth-context';
import { closeDatabaseConnection } from '../src/config/database';
import { taskSessionWorkspaceCacheDAO } from '../src/db/dao/task-session-workspace-cache.dao';
import { sandboxExecutionEnvironmentDAO, taskCreationSessionDAO } from '../src/db/dao';
import { taskCreationFileMemoryStore } from '../src/agents/task-creation/file-memory-store';
import { e2bConnector } from '../src/connectors/e2b-connector';
import { redisKeyspace, deriveTenantKeyForRedis, hashRedisKeyPart } from '../src/services/redis-keyspace';
import { redisClientService } from '../src/services/redis-client-service';
import { osacAgentService } from '../src/services/osac-agent-service';
import { opencodeEventStreamService } from '../src/services/opencode-event-stream-service';
import { opencodeRemoteService } from '../src/services/opencode-remote-service';
import { taskSessionRedisCacheService } from '../src/services/task-session-redis-cache-service';

process.env.ONECEO_REDIS_ENABLED = 'true';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379/15';

type TestServer = {
  origin: string;
  close: () => Promise<void>;
};

const inspector = new Redis(process.env.REDIS_URL!);
const sessionDaoAny = taskCreationSessionDAO as any;
const fileStoreAny = taskCreationFileMemoryStore as any;
const sandboxEnvDaoAny = sandboxExecutionEnvironmentDAO as any;
const workspaceCacheDaoAny = taskSessionWorkspaceCacheDAO as any;
const e2bConnectorAny = e2bConnector as any;
const osacAgentAny = osacAgentService as any;
const opencodeEventStreamAny = opencodeEventStreamService as any;
const opencodeRemoteAny = opencodeRemoteService as any;

const originalGetSessionDao = sessionDaoAny.getSession;
const originalGetRecentMessages = sessionDaoAny.getRecentMessages;
const originalGetSessionFile = fileStoreAny.getSession;
const originalGetMessagesFileStore = fileStoreAny.getMessages;
const originalSandboxGetBySessionId = sandboxEnvDaoAny.getBySessionId;
const originalWorkspaceCacheGet = workspaceCacheDaoAny.get;
const originalWorkspaceCacheUpsert = workspaceCacheDaoAny.upsert;
const originalRunCommand = e2bConnectorAny.runCommand;
const originalReadFile = e2bConnectorAny.readFile;
const originalEnsureOpencodeServer = osacAgentAny.ensureOpencodeServer;
const originalBindSession = opencodeEventStreamAny.bindSession;
const originalSubscribeOpencodeEvent = opencodeEventStreamAny.subscribe;
const originalSubscribeRemote = opencodeRemoteAny.subscribe;

function buildScope(sessionId: string, userId = 'owner-user') {
  const hexSeed = Array.from(sessionId)
    .map((char) => char.codePointAt(0)?.toString(16) || '')
    .join('')
    .replace(/[^0-9a-f]/gi, '')
    .padEnd(12, '1')
    .slice(0, 12)
    .toLowerCase();
  const normalizedSessionId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    sessionId
  )
    ? sessionId
    : `11111111-1111-4111-8111-${hexSeed}`;
  return {
    sessionId: normalizedSessionId,
    userId,
    tenantKey: deriveTenantKeyForRedis(userId),
  };
}

function buildWorkspaceDirCacheKey(input: {
  path: string;
  cursor: number;
  limit: number;
  includeIgnored: boolean;
}) {
  return JSON.stringify({
    path: input.path.replace(/\\/g, '/').replace(/^\/+/, ''),
    cursor: input.cursor,
    limit: input.limit,
    includeIgnored: input.includeIgnored,
  });
}

function ownerSession(sessionId: string, userId = 'owner-user') {
  return {
    id: sessionId,
    userId,
    title: 'Owner Session',
    status: 'completed',
    stage: 'completed',
    mode: 'sandbox',
    executor: 'opencode',
    driver: 'altus',
    runtime: {
      orchestratorSessionId: `orch-${sessionId}`,
      opencodeSessionId: `native-${sessionId}`,
      executor: 'altus',
    },
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function startServer(): Promise<TestServer> {
  const app = express();
  app.use(express.json());
  app.use(mockAuthContextMiddleware());
  app.use('/api/task-creation', taskCreationRoutes);
  const sockets = new Set<Socket>();

  const server = await new Promise<import('node:http').Server>((resolve) => {
    const next = app.listen(0, () => resolve(next));
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('failed to resolve test server address');
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}

async function testFetch(input: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set('connection', 'close');
  return fetch(input, {
    ...init,
    headers,
  });
}

beforeEach(async () => {
  await inspector.flushdb();
  sessionDaoAny.getSession = async (sessionId: string) => ({ id: sessionId, userId: 'owner-user' });
  sessionDaoAny.getRecentMessages = async () => [];
  fileStoreAny.getSession = async (sessionId: string) => ownerSession(sessionId);
  fileStoreAny.getMessages = async () => [];
  sandboxEnvDaoAny.getBySessionId = async (sessionId: string) => ({
    sessionId,
    status: 'ready',
    updatedAt: new Date(),
    metadata: {},
  });
  workspaceCacheDaoAny.get = async () => null;
  workspaceCacheDaoAny.upsert = async () => undefined;
  e2bConnectorAny.runCommand = async (_sandboxId: string, command: string) => {
    if (command.includes('sorted(target.iterdir()')) {
      return {
        stdout: JSON.stringify([
          { path: 'src', type: 'directory' },
          { path: 'README.md', type: 'file' },
        ]),
      };
    }
    throw new Error(`unexpected runCommand: ${command}`);
  };
  e2bConnectorAny.readFile = async () => Buffer.from('export const liveRedis = true;\n', 'utf8');
  osacAgentAny.ensureOpencodeServer = async () => undefined;
  opencodeEventStreamAny.bindSession = () => undefined;
  opencodeEventStreamAny.subscribe = () => () => undefined;
  opencodeRemoteAny.subscribe = () => () => undefined;
});

after(async () => {
  sessionDaoAny.getSession = originalGetSessionDao;
  sessionDaoAny.getRecentMessages = originalGetRecentMessages;
  fileStoreAny.getSession = originalGetSessionFile;
  fileStoreAny.getMessages = originalGetMessagesFileStore;
  sandboxEnvDaoAny.getBySessionId = originalSandboxGetBySessionId;
  workspaceCacheDaoAny.get = originalWorkspaceCacheGet;
  workspaceCacheDaoAny.upsert = originalWorkspaceCacheUpsert;
  e2bConnectorAny.runCommand = originalRunCommand;
  e2bConnectorAny.readFile = originalReadFile;
  osacAgentAny.ensureOpencodeServer = originalEnsureOpencodeServer;
  opencodeEventStreamAny.bindSession = originalBindSession;
  opencodeEventStreamAny.subscribe = originalSubscribeOpencodeEvent;
  opencodeRemoteAny.subscribe = originalSubscribeRemote;
  await inspector.flushdb();
  await inspector.quit();
  await redisClientService.disconnect?.();
  await closeDatabaseConnection().catch(() => undefined);
});

test('live route: recent messages route writes redis recent cache', async () => {
  const server = await startServer();
  const scope = buildScope('live-recent');
  fileStoreAny.getSession = async (sessionId: string) => ({
    ...ownerSession(sessionId),
    mode: 'altus',
    executor: 'codex',
    driver: 'codex',
    runtime: {
      orchestratorSessionId: `orch-${sessionId}`,
      executor: 'codex',
    },
  });
  sessionDaoAny.getRecentMessages = async () => [
    {
      id: 'msg-1',
      role: 'user',
      content: 'recent from db',
      messageType: 'user_input',
      metadata: { timestamp: 1712100000000 },
      createdAt: new Date(1712100000000).toISOString(),
    },
  ];

  try {
    const response = await testFetch(`${server.origin}/api/task-creation/sessions/${scope.sessionId}/messages/recent`, {
      headers: { 'x-test-user-id': scope.userId },
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.data.messages[0].content, 'recent from db');

    const raw = await inspector.get(redisKeyspace.messagesRecent(scope));
    assert.ok(raw);
    const stored = JSON.parse(raw!);
    assert.equal(stored.messages[0].content, 'recent from db');
    assert.equal(stored.source, 'recent_cache');
  } finally {
    await server.close();
  }
});

test('live route: history route writes redis cursor snapshot', async () => {
  const server = await startServer();
  const scope = buildScope('live-history');
  fileStoreAny.getSession = async (sessionId: string) => ({
    ...ownerSession(sessionId),
    mode: 'altus',
    executor: 'codex',
    driver: 'codex',
    runtime: {
      orchestratorSessionId: `orch-${sessionId}`,
      executor: 'codex',
    },
  });
  fileStoreAny.getMessages = async () => [
    {
      id: 'hist-1',
      role: 'user',
      content: 'older',
      messageType: 'user_input',
      metadata: { timestamp: 1712100000000, sessionEventSeq: 10 },
      createdAt: new Date(1712100000000).toISOString(),
    },
    {
      id: 'hist-2',
      role: 'agent',
      content: 'newer',
      messageType: 'assistant_response',
      metadata: { timestamp: 1712100001000, sessionEventSeq: 20 },
      createdAt: new Date(1712100001000).toISOString(),
    },
  ];

  try {
    const response = await testFetch(
      `${server.origin}/api/task-creation/sessions/${scope.sessionId}/messages/history?limit=1`,
      {
        headers: { 'x-test-user-id': scope.userId },
      }
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.data.source, 'resolved_history');

    const raw = await inspector.get(redisKeyspace.historyCursor(scope));
    assert.ok(raw);
    const stored = JSON.parse(raw!);
    assert.equal(stored.oldestCursor, 20);
    assert.equal(stored.newestCursor, 20);
  } finally {
    await server.close();
  }
});

test('live route: history route rebuilds cursor snapshot after redis cursor is cleared', async () => {
  const server = await startServer();
  const scope = buildScope('live-history-rebuild');
  fileStoreAny.getSession = async (sessionId: string) => ({
    ...ownerSession(sessionId),
    mode: 'altus',
    executor: 'codex',
    driver: 'codex',
    runtime: {
      orchestratorSessionId: `orch-${sessionId}`,
      executor: 'codex',
    },
  });
  fileStoreAny.getMessages = async () => [
    {
      id: 'hist-r-1',
      role: 'user',
      content: 'older rebuild',
      messageType: 'user_input',
      metadata: { timestamp: 1712100000000, sessionEventSeq: 11 },
      createdAt: new Date(1712100000000).toISOString(),
    },
    {
      id: 'hist-r-2',
      role: 'agent',
      content: 'newer rebuild',
      messageType: 'assistant_response',
      metadata: { timestamp: 1712100001000, sessionEventSeq: 22 },
      createdAt: new Date(1712100001000).toISOString(),
    },
  ];

  try {
    await inspector.set(
      redisKeyspace.historyCursor(scope),
      JSON.stringify({
        beforeCursor: 999,
        oldestCursor: 999,
        newestCursor: 999,
        updatedAt: new Date().toISOString(),
      })
    );
    await inspector.del(redisKeyspace.historyCursor(scope));

    const response = await testFetch(
      `${server.origin}/api/task-creation/sessions/${scope.sessionId}/messages/history?limit=1`,
      {
        headers: { 'x-test-user-id': scope.userId },
      }
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.data.source, 'resolved_history');
    assert.equal(payload.data.messages.length, 1);
    assert.equal(payload.data.messages[0].content, 'newer rebuild');

    const raw = await inspector.get(redisKeyspace.historyCursor(scope));
    assert.ok(raw);
    const stored = JSON.parse(raw!);
    assert.equal(stored.oldestCursor, 22);
    assert.equal(stored.newestCursor, 22);
  } finally {
    await server.close();
  }
});

test('live route: workspace dir route writes redis dir cache', async () => {
  const server = await startServer();
  const scope = buildScope('live-dir');

  try {
    const response = await testFetch(
      `${server.origin}/api/task-creation/sessions/${scope.sessionId}/workspace/dir?path=src`,
      {
        headers: { 'x-test-user-id': scope.userId },
      }
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.data.path, 'src');

    const dirKey = redisKeyspace.workspaceDir({
      ...scope,
      pathHash: hashRedisKeyPart(
        buildWorkspaceDirCacheKey({
          path: 'src',
          cursor: 0,
          limit: 200,
          includeIgnored: true,
        })
      ),
    });
    const raw = await inspector.get(dirKey);
    assert.ok(raw);
    const stored = JSON.parse(raw!);
    assert.equal(stored.path, 'src');
    assert.ok(Array.isArray(stored.items));
  } finally {
    await server.close();
  }
});

test('live route: workspace dir route normalizes workspace-absolute root path input', async () => {
  const server = await startServer();
  const scope = buildScope('live-dir-absolute-root');
  const absoluteStyleRoot = `home/user/opencode/workspaces/${scope.sessionId}`;

  try {
    const response = await testFetch(
      `${server.origin}/api/task-creation/sessions/${scope.sessionId}/workspace/dir?path=${encodeURIComponent(absoluteStyleRoot)}`,
      {
        headers: { 'x-test-user-id': scope.userId },
      }
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.data.path, '');
    assert.ok(Array.isArray(payload.data.items));
    assert.ok(payload.data.items.some((item: { path: string }) => item.path === 'src'));
  } finally {
    await server.close();
  }
});

test('live route: workspace tree route writes redis tree cache', async () => {
  const server = await startServer();
  const scope = buildScope('live-tree');

  try {
    const response = await testFetch(`${server.origin}/api/task-creation/sessions/${scope.sessionId}/workspace/tree`, {
      headers: { 'x-test-user-id': scope.userId },
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.cache.hit, false);

    const raw = await inspector.get(
      redisKeyspace.workspaceTree({
        ...scope,
        pathHash: hashRedisKeyPart('root'),
      })
    );
    assert.ok(raw);
    const stored = JSON.parse(raw!);
    assert.equal(stored.root.endsWith(scope.sessionId), true);
    assert.ok(Array.isArray(stored.items));
    assert.ok(stored.items.some((item: { path: string }) => item.path === 'src'));
  } finally {
    await server.close();
  }
});

test('live route: workspace file route writes redis file cache', async () => {
  const server = await startServer();
  const scope = buildScope('live-file');

  try {
    const response = await testFetch(
      `${server.origin}/api/task-creation/sessions/${scope.sessionId}/workspace/file?path=src/index.ts`,
      {
        headers: { 'x-test-user-id': scope.userId },
      }
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.data.content, 'export const liveRedis = true;\n');

    const raw = await inspector.get(
      redisKeyspace.workspaceFile({
        ...scope,
        pathHash: hashRedisKeyPart('src/index.ts'),
      })
    );
    assert.ok(raw);
    const stored = JSON.parse(raw!);
    assert.equal(stored.path, 'src/index.ts');
    assert.equal(stored.content, 'export const liveRedis = true;\n');
  } finally {
    await server.close();
  }
});

test('live route: workspace file route normalizes workspace-absolute path input', async () => {
  const server = await startServer();
  const scope = buildScope('live-file-absolute');
  const workspaceRoot = `/home/user/opencode/workspaces/${scope.sessionId}`;
  const absoluteStylePath = `home/user/opencode/workspaces/${scope.sessionId}/src/index.ts`;
  let resolvedReadPath = '';
  e2bConnectorAny.readFile = async (_sandboxId: string, filePath: string) => {
    resolvedReadPath = filePath;
    return Buffer.from('export const absolutePath = true;\n', 'utf8');
  };

  try {
    const response = await testFetch(
      `${server.origin}/api/task-creation/sessions/${scope.sessionId}/workspace/file?path=${encodeURIComponent(absoluteStylePath)}`,
      {
        headers: { 'x-test-user-id': scope.userId },
      }
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.data.path, 'src/index.ts');
    assert.equal(payload.data.content, 'export const absolutePath = true;\n');
    assert.equal(resolvedReadPath, `${workspaceRoot}/src/index.ts`);
  } finally {
    await server.close();
  }
});

test('live route: workspace dir fallback normalizes absolute paths from message history', async () => {
  const server = await startServer();
  const scope = buildScope('live-dir-history');
  e2bConnectorAny.runCommand = async (_sandboxId: string, command: string) => {
    if (command.includes('sorted(target.iterdir()')) {
      return {
        stdout: JSON.stringify([]),
      };
    }
    throw new Error(`unexpected runCommand: ${command}`);
  };
  sessionDaoAny.getRecentMessages = async () => [
    {
      id: 'history-msg-1',
      role: 'agent',
      content: '',
      messageType: 'executor_event',
      metadata: {
        filePaths: [`/home/user/opencode/workspaces/${scope.sessionId}/index.html`],
      },
      createdAt: new Date().toISOString(),
    },
  ];
  fileStoreAny.getMessages = async () => [];

  try {
    const response = await testFetch(
      `${server.origin}/api/task-creation/sessions/${scope.sessionId}/workspace/dir`,
      {
        headers: { 'x-test-user-id': scope.userId },
      }
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.cache.source, 'message_history');
    assert.ok(Array.isArray(payload.data.items));
    assert.equal(payload.data.items[0].path, 'index.html');
    assert.equal(payload.data.items[0].type, 'file');
  } finally {
    await server.close();
  }
});

test('live route: workspace file route marks html file as html preview type', async () => {
  const server = await startServer();
  const scope = buildScope('live-file-html');
  e2bConnectorAny.readFile = async () =>
    Buffer.from('<!doctype html><html><body>Hello</body></html>', 'utf8');

  try {
    const response = await testFetch(
      `${server.origin}/api/task-creation/sessions/${scope.sessionId}/workspace/file?path=index.html`,
      {
        headers: { 'x-test-user-id': scope.userId },
      }
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.data.path, 'index.html');
    assert.equal(payload.data.previewType, 'html');
    assert.equal(payload.data.isBinary, false);
  } finally {
    await server.close();
  }
});

test('live route: opencode events route replays redis session-events stream', async () => {
  const server = await startServer();
  const scope = buildScope('live-events');
  await taskSessionRedisCacheService.appendSessionEvent({
    ...scope,
    eventType: 'status_update',
    messageType: 'status_update',
    eventId: 301,
    createdAt: new Date(1712100003000).toISOString(),
    messageKey: 'session-event:301',
    content: 'live redis session event',
    metadata: { sessionEventSeq: 301, opencodeSessionId: `native-${scope.sessionId}` },
  });

  try {
    const rows = await inspector.xrange(redisKeyspace.sessionEventsStream(scope), '-', '+');
    assert.equal(rows.length, 1);

    const response = await testFetch(
      `${server.origin}/api/task-creation/sessions/${scope.sessionId}/opencode/events?since=300`,
      {
        headers: { 'x-test-user-id': scope.userId },
      }
    );
    assert.equal(response.status, 200);
    assert.ok(response.body);

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';

    try {
      for (let i = 0; i < 4; i += 1) {
        const chunk = await reader.read();
        if (chunk.done) break;
        text += decoder.decode(chunk.value, { stream: true });
        if (text.includes('live redis session event') && text.includes('"status":"connected"')) {
          break;
        }
      }
    } finally {
      await response.body?.cancel().catch(() => undefined);
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }

    assert.match(text, /live redis session event/);
  } finally {
    await server.close();
  }
});

test('live route: opencode events route falls back to db replay after redis session-events stream is cleared', async () => {
  const server = await startServer();
  const scope = buildScope('live-events-db-fallback');
  fileStoreAny.getSession = async (sessionId: string) => ({
    ...ownerSession(sessionId),
    mode: 'sandbox',
    executor: 'opencode',
    status: 'completed',
    stage: 'completed',
    runtime: {
      orchestratorSessionId: `orch-${sessionId}`,
      opencodeSessionId: `native-${sessionId}`,
    },
  });
  fileStoreAny.getMessages = async () => [
    {
      id: 'db-replay-live-1',
      role: 'agent',
      content: 'live db fallback event',
      messageType: 'status_update',
      metadata: {
        sessionEventSeq: 401,
        timestamp: 1712100004000,
        opencodeSessionId: `native-${scope.sessionId}`,
      },
      createdAt: new Date(1712100004000).toISOString(),
    },
  ];

  try {
    await taskSessionRedisCacheService.appendSessionEvent({
      ...scope,
      eventType: 'status_update',
      messageType: 'status_update',
      eventId: 301,
      createdAt: new Date(1712100003000).toISOString(),
      messageKey: 'session-event:301',
      content: 'stale redis session event',
      metadata: { sessionEventSeq: 301, opencodeSessionId: `native-${scope.sessionId}` },
    });
    await inspector.del(redisKeyspace.sessionEventsStream(scope));
    const rows = await inspector.xrange(redisKeyspace.sessionEventsStream(scope), '-', '+');
    assert.equal(rows.length, 0);

    const response = await testFetch(
      `${server.origin}/api/task-creation/sessions/${scope.sessionId}/opencode/events?since=300`,
      {
        headers: { 'x-test-user-id': scope.userId },
      }
    );
    assert.equal(response.status, 200);
    assert.ok(response.body);

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';

    try {
      for (let i = 0; i < 4; i += 1) {
        const chunk = await reader.read();
        if (chunk.done) break;
        text += decoder.decode(chunk.value, { stream: true });
        if (text.includes('live db fallback event') && text.includes('"status":"connected"')) {
          break;
        }
      }
    } finally {
      await response.body?.cancel().catch(() => undefined);
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }

    assert.match(text, /live db fallback event/);
    assert.doesNotMatch(text, /stale redis session event/);
  } finally {
    await server.close();
  }
});
