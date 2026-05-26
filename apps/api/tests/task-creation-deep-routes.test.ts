import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import express from 'express';
import type { Socket } from 'node:net';
import taskCreationRoutes from '../src/routes/task-creation-routes';
import { mockAuthContextMiddleware } from './helpers/mock-auth-context';
import {
  appUserLegacyIdMappingDAO,
  sandboxExecutionEnvironmentDAO,
  taskCreationSessionDAO,
  taskSessionRunDAO,
} from '../src/db/dao';
import { closeDatabaseConnection } from '../src/config/database';
import { taskCreationFileMemoryStore } from '../src/agents/task-creation/file-memory-store';
import { sessionConnectorService } from '../src/services/session-connector-service';
import { taskSessionDeliverableService } from '../src/services/task-session-deliverable-service';
import { taskSessionRedisCacheService } from '../src/services/task-session-redis-cache-service';
import { osacAgentService } from '../src/services/osac-agent-service';
import { opencodeEventStreamService } from '../src/services/opencode-event-stream-service';
import { opencodeRemoteService } from '../src/services/opencode-remote-service';
import { sessionMcpRecoveryService } from '../src/services/session-mcp-recovery-service';
import { redisClientService } from '../src/services/redis-client-service';

type TestServer = {
  origin: string;
  close: () => Promise<void>;
};

const sessionDaoAny = taskCreationSessionDAO as any;
const legacyMappingDaoAny = appUserLegacyIdMappingDAO as any;
const runDaoAny = taskSessionRunDAO as any;
const fileStoreAny = taskCreationFileMemoryStore as any;
const sessionConnectorAny = sessionConnectorService as any;
const deliverableServiceAny = taskSessionDeliverableService as any;
const redisCacheAny = taskSessionRedisCacheService as any;
const sandboxEnvDaoAny = sandboxExecutionEnvironmentDAO as any;
const osacAgentAny = osacAgentService as any;
const opencodeEventStreamAny = opencodeEventStreamService as any;
const opencodeRemoteAny = opencodeRemoteService as any;
const recoveryAny = sessionMcpRecoveryService as any;

const originalGetSessionDao = sessionDaoAny.getSession;
const originalBindUserIfMissing = sessionDaoAny.bindUserIfMissing;
const originalAdoptSessionFromLegacyUserId = sessionDaoAny.adoptSessionFromLegacyUserId;
const originalResolveAppUserIdByLegacyUserId = legacyMappingDaoAny.resolveAppUserIdByLegacyUserId;
const originalGetTaskDescription = sessionDaoAny.getTaskDescription;
const originalGetRecentMessages = sessionDaoAny.getRecentMessages;
const originalGetMessages = sessionDaoAny.getMessages;
const originalGetRun = runDaoAny.getRun;
const originalFindActiveRun = runDaoAny.findActiveRun;
const originalGetSessionFile = fileStoreAny.getSession;
const originalGetMessagesFileStore = fileStoreAny.getMessages;
const originalAssertOwnership = sessionConnectorAny.assertSessionOwnership;
const originalListSessionConnectors = sessionConnectorAny.listSessionConnectors;
const originalAttachConnector = sessionConnectorAny.attachConnector;
const originalDetachConnector = sessionConnectorAny.detachConnector;
const originalListDeliverables = deliverableServiceAny.listSessionDeliverables;
const originalGetRecentMessagesPage = redisCacheAny.getRecentMessagesPage;
const originalSetRecentMessagesPage = redisCacheAny.setRecentMessagesPage;
const originalSetHistoryCursor = redisCacheAny.setHistoryCursor;
const originalGetWorkspaceDir = redisCacheAny.getWorkspaceDir;
const originalGetWorkspaceTree = redisCacheAny.getWorkspaceTree;
const originalGetWorkspaceFile = redisCacheAny.getWorkspaceFile;
const originalListSessionEvents = redisCacheAny.listSessionEvents;
const originalSandboxGetBySessionId = sandboxEnvDaoAny.getBySessionId;
const originalSandboxFindCanonicalByTaskSessionId = sandboxEnvDaoAny.findCanonicalByTaskSessionId;
const originalEnsureOpencodeServer = osacAgentAny.ensureOpencodeServer;
const originalBindSession = opencodeEventStreamAny.bindSession;
const originalSubscribeOpencodeEvent = opencodeEventStreamAny.subscribe;
const originalSubscribeRemote = opencodeRemoteAny.subscribe;
const originalLoadNativeMessageHistory = opencodeRemoteAny.loadNativeMessageHistory;
const originalEnsureSessionRecovered = recoveryAny.ensureSessionRecovered;

after(async () => {
  sessionDaoAny.getSession = originalGetSessionDao;
  sessionDaoAny.bindUserIfMissing = originalBindUserIfMissing;
  sessionDaoAny.adoptSessionFromLegacyUserId = originalAdoptSessionFromLegacyUserId;
  legacyMappingDaoAny.resolveAppUserIdByLegacyUserId = originalResolveAppUserIdByLegacyUserId;
  sessionDaoAny.getTaskDescription = originalGetTaskDescription;
  sessionDaoAny.getRecentMessages = originalGetRecentMessages;
  sessionDaoAny.getMessages = originalGetMessages;
  runDaoAny.getRun = originalGetRun;
  runDaoAny.findActiveRun = originalFindActiveRun;
  fileStoreAny.getSession = originalGetSessionFile;
  fileStoreAny.getMessages = originalGetMessagesFileStore;
  sessionConnectorAny.assertSessionOwnership = originalAssertOwnership;
  sessionConnectorAny.listSessionConnectors = originalListSessionConnectors;
  sessionConnectorAny.attachConnector = originalAttachConnector;
  sessionConnectorAny.detachConnector = originalDetachConnector;
  deliverableServiceAny.listSessionDeliverables = originalListDeliverables;
  redisCacheAny.getRecentMessagesPage = originalGetRecentMessagesPage;
  redisCacheAny.setRecentMessagesPage = originalSetRecentMessagesPage;
  redisCacheAny.setHistoryCursor = originalSetHistoryCursor;
  redisCacheAny.getWorkspaceDir = originalGetWorkspaceDir;
  redisCacheAny.getWorkspaceTree = originalGetWorkspaceTree;
  redisCacheAny.getWorkspaceFile = originalGetWorkspaceFile;
  redisCacheAny.listSessionEvents = originalListSessionEvents;
  sandboxEnvDaoAny.getBySessionId = originalSandboxGetBySessionId;
  sandboxEnvDaoAny.findCanonicalByTaskSessionId = originalSandboxFindCanonicalByTaskSessionId;
  osacAgentAny.ensureOpencodeServer = originalEnsureOpencodeServer;
  opencodeEventStreamAny.bindSession = originalBindSession;
  opencodeEventStreamAny.subscribe = originalSubscribeOpencodeEvent;
  opencodeRemoteAny.subscribe = originalSubscribeRemote;
  opencodeRemoteAny.loadNativeMessageHistory = originalLoadNativeMessageHistory;
  recoveryAny.ensureSessionRecovered = originalEnsureSessionRecovered;
  await redisClientService.disconnect?.();
  await closeDatabaseConnection().catch(() => undefined);
});

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
    socket.on('close', () => {
      sockets.delete(socket);
    });
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
    const response = await testFetch(`${server.origin}/api/task-creation/sessions/s-1`, {
      headers: { 'x-test-user-id': 'other-user' },
    });
    const payload = await response.json();

    assert.equal(response.status, 403);
    assert.equal(payload.error, '当前用户无权访问该会话');
  } finally {
    await server.close();
  }
});

test('GET /api/task-creation/sessions/:sessionId binds orphan session to current user', async () => {
  const server = await startServer();
  sessionDaoAny.getSession = async (sessionId: string) => ({
    id: sessionId,
    userId: null,
    status: 'in_progress',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  let bindSessionId = '';
  let bindUserId = '';
  sessionDaoAny.bindUserIfMissing = async (sessionId: string, userId: string) => {
    bindSessionId = sessionId;
    bindUserId = userId;
    return {
      id: sessionId,
      userId,
      status: 'in_progress',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  };
  fileStoreAny.getSession = async (sessionId: string) => ownerSession(sessionId, 'owner-user');
  sessionConnectorAny.listSessionConnectors = async () => [];

  try {
    const response = await testFetch(`${server.origin}/api/task-creation/sessions/s-orphan-1`, {
      headers: { 'x-test-user-id': 'owner-user' },
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(bindSessionId, 's-orphan-1');
    assert.equal(bindUserId, 'owner-user');
    assert.equal(payload.data.id, 's-orphan-1');
  } finally {
    await server.close();
  }
});

test('GET /api/task-creation/sessions/:sessionId adopts legacy session owner when mapping matches', async () => {
  const server = await startServer();
  sessionDaoAny.getSession = async (sessionId: string) => ({
    id: sessionId,
    userId: 'legacy-local-user-2',
    status: 'in_progress',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  sessionDaoAny.bindUserIfMissing = async () => {
    throw new Error('should not bind missing owner in legacy adopt test');
  };
  let adoptedSessionId = '';
  let adoptedUserId = '';
  let adoptedLegacyUserId = '';
  sessionDaoAny.adoptSessionFromLegacyUserId = async (
    sessionId: string,
    userId: string,
    legacyUserId: string
  ) => {
    adoptedSessionId = sessionId;
    adoptedUserId = userId;
    adoptedLegacyUserId = legacyUserId;
    return {
      id: sessionId,
      userId,
      status: 'in_progress',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  };
  legacyMappingDaoAny.resolveAppUserIdByLegacyUserId = async (legacyUserId: string) => {
    if (legacyUserId === 'legacy-local-user-2') {
      return 'owner-user';
    }
    return null;
  };
  fileStoreAny.getSession = async (sessionId: string) => ownerSession(sessionId, 'owner-user');
  sessionConnectorAny.listSessionConnectors = async () => [];

  try {
    const response = await testFetch(`${server.origin}/api/task-creation/sessions/s-legacy-owner-1`, {
      headers: {
        'x-test-user-id': 'owner-user',
      },
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(adoptedSessionId, 's-legacy-owner-1');
    assert.equal(adoptedUserId, 'owner-user');
    assert.equal(adoptedLegacyUserId, 'legacy-local-user-2');
  } finally {
    await server.close();
  }
});

test('GET /api/task-creation/sessions/:sessionId/messages/recent returns 403 for foreign user', async () => {
  const server = await startServer();
  sessionDaoAny.getSession = async (sessionId: string) => ({ id: sessionId, userId: 'owner-user' });

  try {
    const response = await testFetch(`${server.origin}/api/task-creation/sessions/s-2/messages/recent`, {
      headers: { 'x-test-user-id': 'other-user' },
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
  sessionDaoAny.getRecentMessages = async () => [
    {
      id: 'm-managed-recent',
      role: 'system',
      content: '交付文件已生成',
      messageType: 'status_update',
      metadata: {
        timestamp: 1712100000000,
        runId: 'run-managed-1',
        sessionId: 's-3',
        executionMode: 'managed',
        eventType: 'deliverables_ready',
        executor: 'altus',
        deliverables: [
          {
            id: 'artifact-1',
            runId: 'run-managed-1',
            path: 'deliverable.md',
            name: 'deliverable.md',
            mimeType: 'text/markdown',
            size: 128,
          },
        ],
      },
      createdAt: new Date(1712100000000).toISOString(),
    },
  ];

  try {
    const response = await testFetch(`${server.origin}/api/task-creation/sessions/s-3/messages/recent`, {
      headers: { 'x-test-user-id': 'owner-user' },
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.ok(Array.isArray(payload.data.messages));
    assert.equal(payload.data.messages[0]?.metadata?.runId, 'run-managed-1');
    assert.equal(payload.data.messages[0]?.metadata?.executionMode, 'managed');
    assert.equal(payload.data.messages[0]?.metadata?.deliverables?.[0]?.name, 'deliverable.md');
  } finally {
    await server.close();
  }
});

test('GET /api/task-creation/sessions/:sessionId/messages/recent preserves managed tool metadata fields', async () => {
  const server = await startServer();
  sessionDaoAny.getSession = async (sessionId: string) => ({ id: sessionId, userId: 'owner-user' });
  fileStoreAny.getSession = async (sessionId: string) => ownerSession(sessionId);
  sessionDaoAny.getRecentMessages = async () => [
    {
      id: 'm-managed-tool-recent',
      role: 'agent',
      content: '工具 read_file 已完成',
      messageType: 'executor_event',
      metadata: {
        timestamp: 1712101000000,
        runId: 'run-managed-tool-1',
        sessionId: 's-tool-meta',
        executionMode: 'managed',
        eventType: 'tool_call_completed',
        executor: 'altus',
        toolName: 'read_file',
        toolCallId: 'tool-call-1',
        arguments: {
          path: '/workspace/README.md',
        },
        error: '',
      },
      createdAt: new Date(1712101000000).toISOString(),
    },
  ];

  try {
    const response = await testFetch(`${server.origin}/api/task-creation/sessions/s-tool-meta/messages/recent`, {
      headers: { 'x-test-user-id': 'owner-user' },
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.ok(Array.isArray(payload.data.messages));
    assert.equal(payload.data.messages[0]?.messageType, 'executor_event');
    assert.equal(payload.data.messages[0]?.metadata?.executionMode, 'managed');
    assert.equal(payload.data.messages[0]?.metadata?.toolCallId, 'tool-call-1');
    assert.equal(payload.data.messages[0]?.metadata?.arguments?.path, '/workspace/README.md');
    assert.equal(payload.data.messages[0]?.metadata?.eventType, 'tool_call_completed');
  } finally {
    await server.close();
  }
});

test('GET /api/task-creation/sessions/:sessionId/messages/recent prefers redis cache for non-opencode session', async () => {
  const server = await startServer();
  sessionDaoAny.getSession = async (sessionId: string) => ({ id: sessionId, userId: 'owner-user' });
  fileStoreAny.getSession = async (sessionId: string) => ({
    ...ownerSession(sessionId),
    mode: 'altus',
    executor: 'codex',
  });
  redisCacheAny.getRecentMessagesPage = async () => ({
    messages: [
      {
        id: 'redis-message-1',
        messageKey: 'db:redis-message-1',
        role: 'user',
        messageType: 'user_input',
        content: 'from redis recent',
        metadata: { timelineCursor: 1, messageKey: 'db:redis-message-1' },
      },
    ],
    source: 'redis_recent',
    oldestCursor: 1,
    newestCursor: 1,
    hasOlderHistory: false,
  });
  sessionDaoAny.getRecentMessages = async () => [
    {
      id: 'redis-message-1',
      role: 'user',
      content: 'from redis recent',
      messageType: 'user_input',
      metadata: { timelineCursor: 1, messageKey: 'db:redis-message-1' },
      timelineCursor: 1,
      createdAt: new Date(1712100000000).toISOString(),
    },
  ];

  try {
    const response = await testFetch(`${server.origin}/api/task-creation/sessions/s-redis-recent/messages/recent`, {
      headers: { 'x-test-user-id': 'owner-user' },
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.data.source, 'redis_recent');
    assert.equal(payload.data.messages[0].content, 'from redis recent');
  } finally {
    await server.close();
  }
});

test('GET /api/task-creation/sessions/:sessionId/messages/recent rejects stale redis clarification metadata', async () => {
  const server = await startServer();
  const structuredClarification = {
    kind: 'structured_clarification',
    taskType: 'ppt',
    title: '沐曦股份 PPT 制作前确认关键决策',
    maxCards: 4,
    cards: [
      {
        id: 'purpose_audience',
        title: '演示目的与受众',
        question: '沐曦股份 PPT 主要给谁看？',
        selectionMode: 'single',
        required: true,
        allowOther: true,
        allowNote: false,
        options: [
          { id: 'investor_pitch', label: '投资人融资路演' },
          { id: 'executive_strategy', label: '内部高管战略汇报' },
          { id: 'brand_business_intro', label: '企业品牌与业务推介' },
        ],
      },
    ],
    briefFields: ['purpose_audience'],
  };
  let cachedPayload: Record<string, unknown> | null = null;
  sessionDaoAny.getSession = async (sessionId: string) => ({ id: sessionId, userId: 'owner-user' });
  fileStoreAny.getSession = async (sessionId: string) => ({
    ...ownerSession(sessionId),
    mode: 'altus',
    executor: 'altus',
    runtime: { executionMode: 'managed', executor: 'altus' },
  });
  redisCacheAny.getRecentMessagesPage = async () => ({
    messages: [
      {
        id: 'message-clarification',
        messageKey: 'managed:run-ppt:clarification',
        role: 'agent',
        messageType: 'clarification_request',
        content: '这份 PPT 开始制作前，先确认 4 个关键决策。',
        metadata: {
          timelineCursor: 10,
          messageKey: 'managed:run-ppt:clarification',
          clarificationType: 'presentation_brief',
        },
      },
    ],
    source: 'redis_recent_stale',
    oldestCursor: 10,
    newestCursor: 10,
    hasOlderHistory: false,
  });
  redisCacheAny.setRecentMessagesPage = async (input: { payload: Record<string, unknown> }) => {
    cachedPayload = input.payload;
  };
  sessionDaoAny.getRecentMessages = async () => [
    {
      id: 'message-clarification',
      role: 'agent',
      messageType: 'clarification_request',
      content: '这份 PPT 开始制作前，先确认 4 个关键决策。',
      metadata: {
        timelineCursor: 10,
        messageKey: 'managed:run-ppt:clarification',
        question: '这份 PPT 开始制作前，先确认 4 个关键决策。',
        clarificationType: 'presentation_brief',
        structuredClarification,
        eventType: 'clarification_requested',
      },
      timelineCursor: 10,
      createdAt: new Date(1712100000000).toISOString(),
    },
  ];

  try {
    const response = await testFetch(`${server.origin}/api/task-creation/sessions/s-redis-stale-ppt/messages/recent`, {
      headers: { 'x-test-user-id': 'owner-user' },
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.notEqual(payload.data.source, 'redis_recent_stale');
    assert.equal(
      payload.data.messages[0]?.metadata?.structuredClarification?.kind,
      'structured_clarification'
    );
    assert.equal(
      (cachedPayload?.messages as any[])?.[0]?.metadata?.structuredClarification?.kind,
      'structured_clarification'
    );
  } finally {
    await server.close();
  }
});

test('GET /api/task-creation/sessions/:sessionId/messages/recent writes redis cache after db recent load', async () => {
  const server = await startServer();
  let cachedPayload: Record<string, unknown> | null = null;
  sessionDaoAny.getSession = async (sessionId: string) => ({ id: sessionId, userId: 'owner-user' });
  fileStoreAny.getSession = async (sessionId: string) => ({
    ...ownerSession(sessionId),
    mode: 'altus',
    executor: 'codex',
  });
  redisCacheAny.getRecentMessagesPage = async () => null;
  redisCacheAny.setRecentMessagesPage = async (input: { payload: Record<string, unknown> }) => {
    cachedPayload = input.payload;
  };
  sessionDaoAny.getRecentMessages = async () => [
    {
      id: 'm-db-1',
      role: 'user',
      content: 'from db recent',
      messageType: 'user_input',
      metadata: { timestamp: 1712100000000 },
      createdAt: new Date(1712100000000).toISOString(),
    },
  ];

  try {
    const response = await testFetch(`${server.origin}/api/task-creation/sessions/s-recent-write/messages/recent`, {
      headers: { 'x-test-user-id': 'owner-user' },
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.data.source, 'recent_cache');
    assert.ok(cachedPayload);
    assert.equal(cachedPayload?.source, 'recent_cache');
    assert.equal((cachedPayload?.messages as Array<{ content: string }>)?.[0]?.content, 'from db recent');
  } finally {
    await server.close();
  }
});

test('GET /api/task-creation/sessions/:sessionId/messages/history returns 403 for foreign user', async () => {
  const server = await startServer();
  sessionDaoAny.getSession = async (sessionId: string) => ({ id: sessionId, userId: 'owner-user' });

  try {
    const response = await testFetch(`${server.origin}/api/task-creation/sessions/s-4/messages/history`, {
      headers: { 'x-test-user-id': 'other-user' },
    });
    const payload = await response.json();

    assert.equal(response.status, 403);
    assert.equal(payload.error, '当前用户无权访问该会话');
  } finally {
    await server.close();
  }
});

test('GET /api/task-creation/sessions/:sessionId/messages/history refreshes redis cursor snapshot', async () => {
  const server = await startServer();
  let cursorPayload: Record<string, unknown> | null = null;
  let dbMessageReads = 0;
  sessionDaoAny.getSession = async (sessionId: string) => ({ id: sessionId, userId: 'owner-user' });
  fileStoreAny.getSession = async (sessionId: string) => ({
    ...ownerSession(sessionId),
    mode: 'altus',
    executor: 'codex',
  });
  sessionDaoAny.getMessages = async () => {
    dbMessageReads += 1;
    return [
      {
        id: 'm-h-db-1',
        role: 'user',
        content: 'db older',
        messageType: 'user_input',
        metadata: { timestamp: 1712100000000, sessionEventSeq: 1 },
        createdAt: new Date(1712100000000).toISOString(),
      },
      {
        id: 'm-h-db-2',
        role: 'agent',
        content: 'db newer',
        messageType: 'assistant_response',
        metadata: { timestamp: 1712100001000, sessionEventSeq: 2 },
        createdAt: new Date(1712100001000).toISOString(),
      },
    ];
  };
  fileStoreAny.getMessages = async () => [
    {
      id: 'm-h-1',
      role: 'user',
      content: 'file older',
      messageType: 'user_input',
      metadata: { timestamp: 1712100000000, sessionEventSeq: 1 },
      createdAt: new Date(1712100000000).toISOString(),
    },
    {
      id: 'm-h-2',
      role: 'agent',
      content: 'file newer',
      messageType: 'assistant_response',
      metadata: { timestamp: 1712100001000, sessionEventSeq: 2 },
      createdAt: new Date(1712100001000).toISOString(),
    },
  ];
  redisCacheAny.setHistoryCursor = async (input: Record<string, unknown>) => {
    cursorPayload = input;
  };

  try {
    const response = await testFetch(`${server.origin}/api/task-creation/sessions/s-history-cursor/messages/history?limit=1`, {
      headers: { 'x-test-user-id': 'owner-user' },
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.data.source, 'resolved_history');
    assert.equal(payload.data.messages[0]?.content, 'db newer');
    assert.equal(dbMessageReads, 1);
    assert.ok(cursorPayload);
    assert.equal(cursorPayload?.sessionId, 's-history-cursor');
    assert.ok(typeof cursorPayload?.oldestCursor === 'number' || cursorPayload?.oldestCursor === null);
    assert.ok(typeof cursorPayload?.newestCursor === 'number' || cursorPayload?.newestCursor === null);
  } finally {
    sessionDaoAny.getMessages = originalGetMessages;
    await server.close();
  }
});

test('GET /api/task-creation/sessions/:sessionId/messages/history preserves managed deliverable metadata', async () => {
  const server = await startServer();
  sessionDaoAny.getSession = async (sessionId: string) => ({ id: sessionId, userId: 'owner-user' });
  fileStoreAny.getSession = async (sessionId: string) => ({
    ...ownerSession(sessionId),
    mode: 'altus',
    executor: 'altus',
  });
  sessionDaoAny.getMessages = async () => [
    {
      id: 'm-h-managed-db-1',
      role: 'system',
      content: '交付文件已生成',
      messageType: 'status_update',
      metadata: {
        timestamp: 1712100000000,
        sessionEventSeq: 1,
        runId: 'run-managed-history-1',
        sessionId: 's-history-managed',
        executionMode: 'managed',
        eventType: 'deliverables_ready',
        executor: 'altus',
        deliverables: [
          {
            id: 'artifact-history-1',
            runId: 'run-managed-history-1',
            path: 'deliverable-history-db.md',
            name: 'deliverable-history-db.md',
            mimeType: 'text/markdown',
            size: 256,
          },
        ],
      },
      createdAt: new Date(1712100000000).toISOString(),
    },
  ];
  fileStoreAny.getMessages = async () => [
    {
      id: 'm-h-managed-1',
      role: 'system',
      content: '交付文件已生成',
      messageType: 'status_update',
      metadata: {
        timestamp: 1712100000000,
        sessionEventSeq: 1,
        runId: 'run-managed-history-1',
        sessionId: 's-history-managed',
        executionMode: 'managed',
        eventType: 'deliverables_ready',
        executor: 'altus',
        deliverables: [
          {
            id: 'artifact-history-1',
            runId: 'run-managed-history-1',
            path: 'deliverable-history-file.md',
            name: 'deliverable-history-file.md',
            mimeType: 'text/markdown',
            size: 256,
          },
        ],
      },
      createdAt: new Date(1712100000000).toISOString(),
    },
  ];

  try {
    const response = await testFetch(`${server.origin}/api/task-creation/sessions/s-history-managed/messages/history?limit=20`, {
      headers: { 'x-test-user-id': 'owner-user' },
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.data.source, 'resolved_history');
    assert.equal(payload.data.messages[0]?.metadata?.runId, 'run-managed-history-1');
    assert.equal(payload.data.messages[0]?.metadata?.executionMode, 'managed');
    assert.equal(
      payload.data.messages[0]?.metadata?.deliverables?.[0]?.name,
      'deliverable-history-db.md'
    );
  } finally {
    sessionDaoAny.getMessages = originalGetMessages;
    await server.close();
  }
});

test('GET /api/task-creation/sessions/:sessionId/workspace/dir prefers redis cache', async () => {
  const server = await startServer();
  sessionDaoAny.getSession = async (sessionId: string) => ({ id: sessionId, userId: 'owner-user' });
  fileStoreAny.getSession = async (sessionId: string) => ({
    ...ownerSession(sessionId),
    runtime: {
      orchestratorSessionId: 'orch-dir-1',
      executor: 'altus',
    },
  });
  redisCacheAny.getWorkspaceDir = async () => ({
    root: '/workspace',
    path: 'src',
    items: [{ path: 'src/lib', type: 'dir' }],
    cursor: 0,
    total: 1,
    returned: 1,
    limit: 200,
    hasMore: false,
    nextCursor: null,
  });

  try {
    const response = await testFetch(`${server.origin}/api/task-creation/sessions/s-dir-redis/workspace/dir?path=src`, {
      headers: { 'x-test-user-id': 'owner-user' },
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.cache.source, 'redis_workspace_cache');
    assert.equal(payload.data.path, 'src');
    assert.equal(payload.data.items[0].path, 'src/lib');
  } finally {
    await server.close();
  }
});

test('GET /api/task-creation/sessions/:sessionId/workspace/tree prefers redis cache', async () => {
  const server = await startServer();
  sessionDaoAny.getSession = async (sessionId: string) => ({ id: sessionId, userId: 'owner-user' });
  fileStoreAny.getSession = async (sessionId: string) => ({
    ...ownerSession(sessionId),
    runtime: {
      orchestratorSessionId: 'orch-tree-1',
      executor: 'altus',
    },
  });
  redisCacheAny.getWorkspaceTree = async () => ({
    root: '/workspace',
    items: [{ path: 'src', type: 'dir' }],
  });

  try {
    const response = await testFetch(`${server.origin}/api/task-creation/sessions/s-tree-redis/workspace/tree`, {
      headers: { 'x-test-user-id': 'owner-user' },
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.cache.source, 'redis_workspace_cache');
    assert.equal(payload.data.root, '/workspace');
    assert.equal(payload.data.items[0].path, 'src');
  } finally {
    await server.close();
  }
});

test('GET /api/task-creation/sessions/:sessionId/workspace/file prefers redis cache', async () => {
  const server = await startServer();
  sessionDaoAny.getSession = async (sessionId: string) => ({ id: sessionId, userId: 'owner-user' });
  fileStoreAny.getSession = async (sessionId: string) => ({
    ...ownerSession(sessionId),
    runtime: {
      orchestratorSessionId: 'orch-file-1',
      executor: 'altus',
    },
  });
  redisCacheAny.getWorkspaceFile = async () => ({
    path: 'src/index.ts',
    content: 'export const redis = true;',
    isBinary: false,
    encoding: 'utf8',
    mimeType: 'text/plain',
    previewType: 'text',
    previewAvailable: true,
    truncated: false,
    size: 26,
  });

  try {
    const response = await testFetch(
      `${server.origin}/api/task-creation/sessions/s-file-redis/workspace/file?path=src/index.ts`,
      {
        headers: { 'x-test-user-id': 'owner-user' },
      }
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.cache.source, 'redis_workspace_cache');
    assert.equal(payload.data.content, 'export const redis = true;');
  } finally {
    await server.close();
  }
});

test('GET /api/task-creation/sessions/:sessionId/messages returns 403 for foreign user', async () => {
  const server = await startServer();
  sessionDaoAny.getSession = async (sessionId: string) => ({ id: sessionId, userId: 'owner-user' });

  try {
    const response = await testFetch(`${server.origin}/api/task-creation/sessions/s-5/messages`, {
      headers: { 'x-test-user-id': 'other-user' },
    });
    const payload = await response.json();

    assert.equal(response.status, 403);
    assert.equal(payload.error, '当前用户无权访问该会话');
  } finally {
    await server.close();
  }
});

test('GET /api/task-creation/sessions/:sessionId/messages merges missing persisted user inputs into native history timeline', async () => {
  const server = await startServer();
  const createdAt1 = new Date('2026-04-20T16:27:04.385Z').toISOString();
  const createdAt2 = new Date('2026-04-20T16:27:07.771Z').toISOString();
  sessionDaoAny.getSession = async (sessionId: string) => ({
    id: sessionId,
    userId: 'owner-user',
    status: 'in_progress',
    mode: 'sandbox',
    executor: 'opencode',
    runtime: {
      orchestratorSessionId: 'orch-merge-1',
      opencodeSessionId: 'native-opencode-merge-1',
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  fileStoreAny.getSession = async (sessionId: string) => ({
    ...ownerSession(sessionId),
    mode: 'sandbox',
    executor: 'opencode',
    runtime: {
      orchestratorSessionId: 'orch-merge-1',
      opencodeSessionId: 'native-opencode-merge-1',
    },
  });
  fileStoreAny.getMessages = async () => [
    {
      id: 'persisted-user-1',
      role: 'user',
      messageType: 'opencode_user_input',
      content: '继续在同一会话回复“continuation-ok”。',
      metadata: {
        originalInput: '继续在同一会话回复“continuation-ok”。',
        opencodeSessionId: 'native-opencode-merge-1',
      },
      createdAt: createdAt1,
    },
    {
      id: 'persisted-user-2',
      role: 'user',
      messageType: 'opencode_user_input',
      content: '请输出 8 行带编号文本（line-1 到 line-8），每行简短解释。',
      metadata: {
        originalInput: '请输出 8 行带编号文本（line-1 到 line-8），每行简短解释。',
        opencodeSessionId: 'native-opencode-merge-1',
      },
      createdAt: createdAt2,
    },
  ];
  opencodeRemoteAny.loadNativeMessageHistory = async () => [
    {
      id: 'native-user-1',
      role: 'user',
      messageType: 'opencode_user_input',
      content: '继续在同一会话回复“continuation-ok”。',
      metadata: {
        source: 'opencode_native_history',
        opencodeSessionId: 'native-opencode-merge-1',
      },
      createdAt: createdAt1,
    },
    {
      id: 'native-agent-1',
      role: 'agent',
      messageType: 'opencode_event',
      content: 'continuation-ok',
      metadata: {
        eventType: 'message.final',
        source: 'opencode_native_history',
        opencodeSessionId: 'native-opencode-merge-1',
      },
      createdAt: new Date('2026-04-20T16:27:05.000Z').toISOString(),
    },
  ];

  try {
    const response = await testFetch(`${server.origin}/api/task-creation/sessions/s-merge-1/messages`, {
      headers: { 'x-test-user-id': 'owner-user' },
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    const userMessages = payload.data.filter((message: any) => message.role === 'user');
    assert.deepEqual(
      userMessages.map((message: any) => message.content),
      [
        '继续在同一会话回复“continuation-ok”。',
        '请输出 8 行带编号文本（line-1 到 line-8），每行简短解释。',
      ]
    );
  } finally {
    opencodeRemoteAny.loadNativeMessageHistory = originalLoadNativeMessageHistory;
    await server.close();
  }
});

test('GET /api/task-creation/sessions/:sessionId/opencode/events replays redis session-events before db fallback', async () => {
  const server = await startServer();
  sessionDaoAny.getSession = async (sessionId: string) => ({ id: sessionId, userId: 'owner-user' });
  sessionDaoAny.getTaskDescription = async () => null;
  sessionDaoAny.getRecentMessages = async () => [];
  fileStoreAny.getSession = async (sessionId: string) => ({
    ...ownerSession(sessionId),
    mode: 'sandbox',
    executor: 'opencode',
    status: 'completed',
    stage: 'completed',
    runtime: {
      orchestratorSessionId: 'orch-opencode-1',
      opencodeSessionId: 'native-opencode-1',
    },
  });
  fileStoreAny.getMessages = async () => {
    throw new Error('db replay should not be used when redis session-events hit');
  };
  sandboxEnvDaoAny.getBySessionId = async () => ({
    sessionId: 'orch-opencode-1',
    status: 'ready',
    updatedAt: new Date(),
    metadata: {},
  });
  osacAgentAny.ensureOpencodeServer = async () => undefined;
  opencodeEventStreamAny.bindSession = () => undefined;
  opencodeEventStreamAny.subscribe = () => () => undefined;
  opencodeRemoteAny.subscribe = () => () => undefined;
  redisCacheAny.listSessionEvents = async () => [
    {
      eventId: 101,
      eventType: 'status_update',
      messageType: 'status_update',
      createdAt: new Date().toISOString(),
      messageKey: 'session-event:101',
      content: 'from redis replay',
      metadata: { sessionEventSeq: 101 },
    },
  ];

  const controller = new AbortController();

  try {
    const response = await testFetch(
      `${server.origin}/api/task-creation/sessions/sse-redis-1/opencode/events?since=100`,
      {
        headers: { 'x-test-user-id': 'owner-user' },
        signal: controller.signal,
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
        if (chunk.done) {
          break;
        }
        text += decoder.decode(chunk.value, { stream: true });
        if (text.includes('from redis replay') && text.includes('"status":"connected"')) {
          break;
        }
      }
    } finally {
      controller.abort();
      await response.body?.cancel().catch(() => undefined);
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }

    assert.match(text, /from redis replay/);
    assert.match(text, /"status":"connected"/);
  } finally {
    await server.close();
  }
});

test('GET /api/task-creation/sessions/:sessionId/opencode/events falls back to db replay when redis stream is empty', async () => {
  const server = await startServer();
  sessionDaoAny.getSession = async (sessionId: string) => ({ id: sessionId, userId: 'owner-user' });
  sessionDaoAny.getTaskDescription = async () => null;
  sessionDaoAny.getRecentMessages = async () => [];
  fileStoreAny.getSession = async (sessionId: string) => ({
    ...ownerSession(sessionId),
    mode: 'sandbox',
    executor: 'opencode',
    status: 'completed',
    stage: 'completed',
    runtime: {
      orchestratorSessionId: 'orch-opencode-2',
      opencodeSessionId: 'native-opencode-2',
    },
  });
  fileStoreAny.getMessages = async () => [
    {
      id: 'db-replay-1',
      role: 'agent',
      content: 'from db replay',
      messageType: 'status_update',
      metadata: {
        sessionEventSeq: 201,
        timestamp: 1712100002000,
        opencodeSessionId: 'native-opencode-2',
      },
      createdAt: new Date(1712100002000).toISOString(),
    },
  ];
  sandboxEnvDaoAny.getBySessionId = async () => ({
    sessionId: 'orch-opencode-2',
    status: 'ready',
    updatedAt: new Date(),
    metadata: {},
  });
  osacAgentAny.ensureOpencodeServer = async () => undefined;
  opencodeEventStreamAny.bindSession = () => undefined;
  opencodeEventStreamAny.subscribe = () => () => undefined;
  opencodeRemoteAny.subscribe = () => () => undefined;
  redisCacheAny.listSessionEvents = async () => [];

  const controller = new AbortController();

  try {
    const response = await testFetch(
      `${server.origin}/api/task-creation/sessions/sse-db-fallback/opencode/events?since=200`,
      {
        headers: { 'x-test-user-id': 'owner-user' },
        signal: controller.signal,
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
        if (text.includes('from db replay') && text.includes('"status":"connected"')) {
          break;
        }
      }
    } finally {
      controller.abort();
      await response.body?.cancel().catch(() => undefined);
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }

    assert.match(text, /from db replay/);
    assert.match(text, /"status":"connected"/);
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
    const response = await testFetch(`${server.origin}/api/task-creation/sessions/s-6/deliverables`, {
      headers: { 'x-test-user-id': 'owner-user' },
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
    const response = await testFetch(`${server.origin}/api/task-creation/sessions/s-7/runtime/start`, {
      method: 'POST',
      headers: { 'x-test-user-id': 'other-user' },
    });
    const payload = await response.json();

    assert.equal(response.status, 403);
    assert.equal(payload.error, '当前用户无权管理该会话连接器');
  } finally {
    await server.close();
  }
});

test('POST /api/task-creation/sessions/:sessionId/runtime/start returns 409 when managed run is active', async () => {
  const server = await startServer();
  sessionConnectorAny.assertSessionOwnership = async () => undefined;
  sessionDaoAny.getSession = async (sessionId: string) => ({
    id: sessionId,
    userId: 'owner-user',
    status: 'in_progress',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  fileStoreAny.getSession = async (sessionId: string) => ownerSession(sessionId);
  runDaoAny.findActiveRun = async () => ({
    id: 'run-active-1',
    sessionId: 's-7',
    mode: 'managed',
    status: 'running',
  });

  try {
    const response = await testFetch(`${server.origin}/api/task-creation/sessions/s-7/runtime/start`, {
      method: 'POST',
      headers: { 'x-test-user-id': 'owner-user' },
    });
    const payload = await response.json();

    assert.equal(response.status, 409);
    assert.equal(payload.success, false);
    assert.equal(payload.error, '当前存在进行中的开发任务，暂不允许切换执行环境');
  } finally {
    await server.close();
  }
});

test('GET /api/task-creation/sessions/:sessionId/deployment/template stays pure-read when runtime is missing', async () => {
  const server = await startServer();
  sessionConnectorAny.assertSessionOwnership = async () => undefined;
  sessionDaoAny.getSession = async (sessionId: string) => ({
    id: sessionId,
    userId: 'owner-user',
    status: 'in_progress',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  fileStoreAny.getSession = async (sessionId: string) => ownerSession(sessionId);
  sandboxEnvDaoAny.findCanonicalByTaskSessionId = async () => null;
  sandboxEnvDaoAny.getBySessionId = async () => null;

  try {
    const response = await testFetch(`${server.origin}/api/task-creation/sessions/s-7/deployment/template`, {
      headers: { 'x-test-user-id': 'owner-user' },
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.workspaceDetected, false);
  } finally {
    await server.close();
  }
});

test('POST /api/task-creation/sessions/:sessionId/deployment/deploy does not provision runtime when binding is missing', async () => {
  const server = await startServer();
  sessionConnectorAny.assertSessionOwnership = async () => undefined;
  sessionDaoAny.getSession = async (sessionId: string) => ({
    id: sessionId,
    userId: 'owner-user',
    status: 'in_progress',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  fileStoreAny.getSession = async (sessionId: string) => ownerSession(sessionId);
  sandboxEnvDaoAny.findCanonicalByTaskSessionId = async () => null;
  sandboxEnvDaoAny.getBySessionId = async () => null;

  try {
    const response = await testFetch(`${server.origin}/api/task-creation/sessions/s-7/deployment/deploy`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user-id': 'owner-user',
      },
      body: JSON.stringify({}),
    });
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.equal(payload.success, false);
    assert.equal(payload.error, '未找到可部署的工作区，请先生成项目文件');
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
    const response = await testFetch(`${server.origin}/api/task-creation/sessions/s-8/runtime/touch`, {
      method: 'POST',
      headers: { 'x-test-user-id': 'other-user' },
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
    const response = await testFetch(`${server.origin}/api/task-creation/sessions/s-9/connectors`, {
      headers: { 'x-test-user-id': 'owner-user' },
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
    const response = await testFetch(`${server.origin}/api/task-creation/sessions/s-10/connectors/github/attach`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user-id': 'other-user',
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

test('POST /api/task-creation/sessions/:sessionId/connectors/:connectorKey/attach returns 504 on osac timeout', async () => {
  const server = await startServer();
  sessionConnectorAny.assertSessionOwnership = async () => {
    throw new Error('OSAC 请求超时');
  };

  try {
    const response = await testFetch(`${server.origin}/api/task-creation/sessions/s-10-timeout/connectors/supabase/attach`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user-id': 'owner-user',
      },
      body: JSON.stringify({ profileId: 'profile-timeout' }),
    });
    const payload = await response.json();

    assert.equal(response.status, 504);
    assert.equal(payload.error, 'OSAC 请求超时');
  } finally {
    await server.close();
  }
});

test('POST /api/task-creation/sessions/:sessionId/connectors/:connectorKey/attach triggers recovery when attach lands in pending_recover', async () => {
  const server = await startServer();
  sessionConnectorAny.assertSessionOwnership = async () => undefined;
  sessionDaoAny.getTaskDescription = async () => null;
  sessionDaoAny.getRecentMessages = async () => [];
  fileStoreAny.getSession = async (sessionId: string) => ({
    ...ownerSession(sessionId),
    runtime: {
      orchestratorSessionId: 'orch-attach-1',
    },
  });
  sessionConnectorAny.attachConnector = async () => ({
    connectorKey: 'vercel',
    runtimeStatus: 'pending_recover',
    attached: true,
  });
  let listed = false;
  sessionConnectorAny.listSessionConnectors = async () => {
    listed = true;
    return [
      {
        connectorKey: 'vercel',
        runtimeStatus: 'connected',
        attached: true,
      },
    ];
  };
  let recoveredArgs: unknown[] | null = null;
  recoveryAny.ensureSessionRecovered = async (...args: unknown[]) => {
    recoveredArgs = args;
    return true;
  };

  try {
    const response = await testFetch(`${server.origin}/api/task-creation/sessions/s-attach/connectors/vercel/attach`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user-id': 'owner-user',
      },
      body: JSON.stringify({ profileId: 'profile-vercel-1' }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.deepEqual(recoveredArgs, ['s-attach', 'orch-attach-1']);
    assert.equal(listed, true);
    assert.equal(payload.data.connector.runtimeStatus, 'connected');
  } finally {
    await server.close();
  }
});

test('POST /api/task-creation/sessions/:sessionId/connectors/:connectorKey/detach detaches for owner', async () => {
  const server = await startServer();
  sessionConnectorAny.assertSessionOwnership = async () => undefined;
  sessionDaoAny.getTaskDescription = async () => null;
  sessionDaoAny.getRecentMessages = async () => [];
  fileStoreAny.getSession = async (sessionId: string) => ownerSession(sessionId);
  sessionConnectorAny.detachConnector = async (_sessionId: string, userId: string, connectorKey: string) => {
    assert.equal(userId, 'owner-user');
    return { connectorKey, attached: false };
  };

  try {
    const response = await testFetch(`${server.origin}/api/task-creation/sessions/s-11/connectors/github/detach`, {
      method: 'POST',
      headers: { 'x-test-user-id': 'owner-user' },
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
    const response = await testFetch(`${server.origin}/api/task-creation/sessions/s-12/runtime/interrupt`, {
      method: 'POST',
      headers: { 'x-test-user-id': 'other-user' },
    });
    const payload = await response.json();

    assert.equal(response.status, 403);
    assert.equal(payload.error, '当前用户无权管理该会话连接器');
  } finally {
    await server.close();
  }
});
