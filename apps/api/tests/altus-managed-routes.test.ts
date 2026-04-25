import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import express from 'express';
import altusManagedRoutes from '../src/routes/altus-managed-routes';
import { mockAuthContextMiddleware } from './helpers/mock-auth-context';
import { altusManagedInputService } from '../src/services/altus-managed-input-service';
import { altusManagedRunService } from '../src/services/altus-managed-run-service';
import { taskCreationSessionDAO, taskSessionRunDAO } from '../src/db/dao';

type TestServer = {
  origin: string;
  close: () => Promise<void>;
};

const inputServiceAny = altusManagedInputService as any;
const runServiceAny = altusManagedRunService as any;
const sessionDaoAny = taskCreationSessionDAO as any;
const runDaoAny = taskSessionRunDAO as any;

const originalSubmit = inputServiceAny.submit;
const originalStartRun = runServiceAny.startRun;
const originalGetLatestRun = runServiceAny.getLatestRun;
const originalStreamRun = runServiceAny.streamRun;
const originalStopRun = runServiceAny.stopRun;
const originalGetSession = sessionDaoAny.getSession;
const originalGetMessages = sessionDaoAny.getMessages;
const originalGetRun = runDaoAny.getRun;
const originalListRunEvents = runDaoAny.listRunEvents;
const originalGetMcpToolSnapshot = runDaoAny.getMcpToolSnapshot;

after(() => {
  inputServiceAny.submit = originalSubmit;
  runServiceAny.startRun = originalStartRun;
  runServiceAny.getLatestRun = originalGetLatestRun;
  runServiceAny.streamRun = originalStreamRun;
  runServiceAny.stopRun = originalStopRun;
  sessionDaoAny.getSession = originalGetSession;
  sessionDaoAny.getMessages = originalGetMessages;
  runDaoAny.getRun = originalGetRun;
  runDaoAny.listRunEvents = originalListRunEvents;
  runDaoAny.getMcpToolSnapshot = originalGetMcpToolSnapshot;
});

async function startServer(): Promise<TestServer> {
  const app = express();
  app.use(express.json());
  app.use(mockAuthContextMiddleware());
  app.use('/api/altus-managed', altusManagedRoutes);

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

test('POST /api/altus-managed/inputs rejects anonymous access', async () => {
  const server = await startServer();

  try {
    const response = await fetch(`${server.origin}/api/altus-managed/inputs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'hello' }),
    });
    const payload = await response.json();

    assert.equal(response.status, 401);
    assert.equal(payload.success, false);
  } finally {
    await server.close();
  }
});

test('POST /api/altus-managed/inputs forwards current user to service', async () => {
  const server = await startServer();
  let receivedUserId = '';
  inputServiceAny.submit = async (userId: string, input: any) => {
    receivedUserId = userId;
    assert.equal(input.content, 'hello');
    return {
      sessionId: 'altus-session-1',
      attachments: [],
      run: { id: 'run-1', sessionId: 'altus-session-1', status: 'queued' },
    };
  };

  try {
    const response = await fetch(`${server.origin}/api/altus-managed/inputs`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user-id': 'altus-user-1',
      },
      body: JSON.stringify({ content: 'hello' }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(receivedUserId, 'altus-user-1');
    assert.equal(payload.data.sessionId, 'altus-session-1');
  } finally {
    await server.close();
  }
});

test('POST /api/altus-managed/sessions/:sessionId/runs forwards current user to startRun', async () => {
  const server = await startServer();
  let receivedUserId = '';
  runServiceAny.startRun = async (_sessionId: string, userId: string) => {
    receivedUserId = userId;
    return { id: 'run-2', sessionId: 'altus-session-2', status: 'queued' };
  };

  try {
    const response = await fetch(`${server.origin}/api/altus-managed/sessions/altus-session-2/runs`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user-id': 'altus-user-2',
      },
      body: JSON.stringify({ content: 'run' }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(receivedUserId, 'altus-user-2');
    assert.equal(payload.data.id, 'run-2');
  } finally {
    await server.close();
  }
});

test('GET /api/altus-managed/sessions/:sessionId/runs/latest rejects anonymous access', async () => {
  const server = await startServer();

  try {
    const response = await fetch(`${server.origin}/api/altus-managed/sessions/altus-session-3/runs/latest`);
    const payload = await response.json();

    assert.equal(response.status, 401);
    assert.equal(payload.success, false);
  } finally {
    await server.close();
  }
});

test('GET /api/altus-managed/runs/:runId/stream uses current user instead of query userId', async () => {
  const server = await startServer();
  runDaoAny.getRun = async () => ({ id: 'run-3', sessionId: 'altus-session-3' });
  sessionDaoAny.getSession = async () => ({ id: 'altus-session-3', userId: 'altus-user-3' });
  let streamedContext: Record<string, unknown> | null = null;
  runServiceAny.streamRun = async (input: Record<string, unknown>, res: express.Response) => {
    streamedContext = input;
    res.status(200).json({ success: true, streamed: true });
  };

  try {
    const response = await fetch(`${server.origin}/api/altus-managed/runs/run-3/stream`, {
      headers: { 'x-test-user-id': 'altus-user-3' },
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(streamedContext, {
      runId: 'run-3',
      sessionId: 'altus-session-3',
      userId: 'altus-user-3',
    });
    assert.equal(payload.streamed, true);
  } finally {
    await server.close();
  }
});

test('GET /api/altus-managed/runs/:runId/stream returns 403 for foreign user', async () => {
  const server = await startServer();
  runDaoAny.getRun = async () => ({ id: 'run-4', sessionId: 'altus-session-4' });
  sessionDaoAny.getSession = async () => ({ id: 'altus-session-4', userId: 'owner-user' });

  try {
    const response = await fetch(`${server.origin}/api/altus-managed/runs/run-4/stream`, {
      headers: { 'x-test-user-id': 'other-user' },
    });
    const payload = await response.json();

    assert.equal(response.status, 403);
    assert.equal(payload.error, '当前用户无权订阅该 Altus managed run');
  } finally {
    await server.close();
  }
});

test('POST /api/altus-managed/runs/:runId/stop forwards current user to stopRun', async () => {
  const server = await startServer();
  let receivedUserId = '';
  runServiceAny.stopRun = async (_runId: string, userId: string) => {
    receivedUserId = userId;
    return { id: 'run-5', sessionId: 'altus-session-5', status: 'stopped' };
  };

  try {
    const response = await fetch(`${server.origin}/api/altus-managed/runs/run-5/stop`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user-id': 'altus-user-5',
      },
      body: JSON.stringify({ reason: 'user_interrupt' }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(receivedUserId, 'altus-user-5');
    assert.equal(payload.data.status, 'stopped');
  } finally {
    await server.close();
  }
});

test('GET /api/altus-managed/sessions/:sessionId/context-debug returns recovery and cache diagnostics', async () => {
  const server = await startServer();
  sessionDaoAny.getSession = async () => ({ id: 'altus-session-debug', userId: 'altus-user-debug' });
  sessionDaoAny.getMessages = async () => [
    {
      id: 'message-debug-1',
      sessionId: 'altus-session-debug',
      role: 'user',
      content: '网页应用',
      messageType: 'clarification_answer',
      messageKey: 'message-debug-1',
      timelineCursor: 1,
      metadata: {
        clarificationAnswer: true,
        attachments: [{ externalObjectKey: 'object-debug-1', name: 'brief.png', mimeType: 'image/png' }],
      },
      createdAt: '2026-04-26T03:30:00.000Z',
    },
  ];
  runDaoAny.getRun = async () => ({
    id: 'run-debug-1',
    sessionId: 'altus-session-debug',
    status: 'waiting_user',
    mode: 'managed',
    model: 'test-model',
    mcpToolSnapshotId: 'mcp-debug-1',
  });
  runDaoAny.getMcpToolSnapshot = async () => ({
    id: 'mcp-debug-1',
    snapshotJson: {
      providers: [
        {
          providerId: 'provider-debug',
          connectorKey: 'github',
          tools: [{ toolName: 'search_repositories' }],
        },
      ],
    },
  });
  runDaoAny.listRunEvents = async () => [
    {
      id: 'event-debug-1',
      runId: 'run-debug-1',
      sessionId: 'altus-session-debug',
      eventType: 'tool_call_started',
      sequence: 1,
      payloadJson: {
        toolCallId: 'tool-debug-1',
        toolName: 'ask_user',
        arguments: { question: '网页应用还是完整业务系统？' },
      },
      createdAt: '2026-04-26T03:30:01.000Z',
    },
    {
      id: 'event-debug-2',
      runId: 'run-debug-1',
      sessionId: 'altus-session-debug',
      eventType: 'tool_call_completed',
      sequence: 2,
      payloadJson: {
        toolCallId: 'tool-debug-1',
        toolName: 'ask_user',
        toolResultEnvelope: {
          status: 'ask_user',
          toolUseId: 'tool-debug-1',
          toolName: 'ask_user',
          runId: 'run-debug-1',
          modelRoundId: '1',
          args: {},
          contentForModel: '{"status":"ask_user"}',
          contentForUser: '需要补充信息',
          retryable: false,
          sideEffects: [],
          activatedSkills: [],
        },
      },
      createdAt: '2026-04-26T03:30:02.000Z',
    },
  ];

  try {
    const response = await fetch(
      `${server.origin}/api/altus-managed/sessions/altus-session-debug/context-debug?runId=run-debug-1`,
      {
        headers: { 'x-test-user-id': 'altus-user-debug' },
      }
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.recovery.mode, 'db_backed_read_only');
    assert.equal(payload.data.recovery.factsSource.redis, 'not_fact_source');
    assert.equal(payload.data.recovery.recoveryState, 'recoverable');
    assert.equal(payload.data.roundTrip.equivalent, true);
    assert.equal(payload.data.budgetProjection.replacementCount, 0);
    assert.ok(payload.data.cacheObservation.apiMessageHash);
    assert.ok(payload.data.manifest.includedContext.blocks.some((block: any) => block.type === 'attachment'));
    assert.ok(payload.data.manifest.includedContext.blocks.some((block: any) => block.type === 'mcp'));
  } finally {
    await server.close();
  }
});
