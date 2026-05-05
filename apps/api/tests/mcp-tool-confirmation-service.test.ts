import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { taskCreationSessionDAO, taskSessionMcpToolConfirmationDAO } from '../src/db/dao';
import { mcpToolConfirmationService } from '../src/services/mcp-tool-confirmation-service';

afterEach(() => {
  mock.reset();
});

test('Google Super read and discovery tools are low risk', () => {
  assert.equal(
    mcpToolConfirmationService.classifyRisk(
      'google_super',
      'google_super__COMPOSIO_SEARCH_TOOLS',
      { queries: [{ use_case: 'find Gmail read tools' }] }
    ),
    'low'
  );
  assert.equal(
    mcpToolConfirmationService.classifyRisk(
      'google_super',
      'google_super__GMAIL_FETCH_EMAILS',
      { query: 'from:user@example.com' }
    ),
    'low'
  );
});

test('Google Super write tools require confirmation and summarize target', () => {
  const args = {
    to: 'user@example.com',
    subject: 'Quarterly plan',
    body: 'private message',
  };
  assert.equal(
    mcpToolConfirmationService.classifyRisk(
      'google_super',
      'google_super__GMAIL_SEND_EMAIL',
      args
    ),
    'high'
  );
  const summary = mcpToolConfirmationService.buildConfirmationSummary({
    appUserId: 'user-1',
    taskSessionId: 'session-1',
    agentRunId: 'run-1',
    connectorKey: 'google_super',
    toolName: 'google_super__GMAIL_SEND_EMAIL',
    argumentsJson: args,
  });
  assert.equal(summary.action, 'send_email');
  assert.equal(summary.target, 'user@example.com');
  assert.equal(summary.parameterSummary.body, '[redacted]');
});

test('Google Super multi execute nested Gmail send arguments summarize recipient target', () => {
  const args = {
    tool_slug: 'GOOGLESUPER_SEND_EMAIL',
    arguments: {
      recipient_email: '3095025109@qq.com',
      subject: '测试确认',
      body: '这是一封测试邮件',
    },
  };

  assert.equal(
    mcpToolConfirmationService.classifyRisk(
      'google_super',
      'google_super__COMPOSIO_MULTI_EXECUTE_TOOL',
      args
    ),
    'high'
  );

  const summary = mcpToolConfirmationService.buildConfirmationSummary({
    appUserId: 'user-1',
    taskSessionId: 'session-1',
    agentRunId: 'run-1',
    connectorKey: 'google_super',
    toolName: 'google_super__COMPOSIO_MULTI_EXECUTE_TOOL',
    argumentsJson: args,
  });

  assert.equal(summary.action, 'send_email');
  assert.equal(summary.target, '3095025109@qq.com');
  assert.equal(summary.parameterSummary['arguments.recipient_email'], '3095025109@qq.com');
  assert.equal(summary.parameterSummary['arguments.subject'], '测试确认');
  assert.equal(summary.parameterSummary['arguments.body'], '[redacted]');
});

test('Google Super multi execute tools array extracts document title target', () => {
  const args = {
    tools: [
      {
        tool_slug: 'GOOGLESUPER_CREATE_DOCUMENT_MARKDOWN',
        arguments: {
          title: '高敏感_测试_#1_[alpha]',
          markdown: '# test',
        },
      },
    ],
  };

  const summary = mcpToolConfirmationService.buildConfirmationSummary({
    appUserId: 'user-1',
    taskSessionId: 'session-1',
    agentRunId: 'run-1',
    connectorKey: 'google_super',
    toolName: 'google_super__COMPOSIO_MULTI_EXECUTE_TOOL',
    argumentsJson: args,
  });

  assert.equal(summary.action, 'create_resource');
  assert.equal(summary.target, '高敏感_测试_#1_[alpha]');
});

test('createPendingConfirmation falls back to synthetic target when explicit target is absent', async () => {
  mock.method(taskSessionMcpToolConfirmationDAO, 'findReusablePending', async () => null as any);
  mock.method(taskSessionMcpToolConfirmationDAO, 'create', async (input: any) => ({
    id: 'confirmation-fallback-target-1',
    ...input,
  }) as any);

  const row = await mcpToolConfirmationService.createPendingConfirmation({
    appUserId: 'user-1',
    taskSessionId: 'session-1',
    agentRunId: 'run-1',
    connectorKey: 'google_super',
    toolName: 'google_super__COMPOSIO_MULTI_EXECUTE_TOOL',
    argumentsJson: {
      tools: [
        {
          tool_slug: 'GOOGLESUPER_CREATE_DOCUMENT_MARKDOWN',
          arguments: {
            markdown: '# Untitled test',
          },
        },
      ],
    },
  });

  const publicSummary = mcpToolConfirmationService.getPublicSummary(row.summaryJson);
  assert.equal(publicSummary.target, 'new Google document');
});

test('createPendingConfirmation stores hidden replay snapshot but public summary stays sanitized', async () => {
  mock.method(taskSessionMcpToolConfirmationDAO, 'findReusablePending', async () => null as any);
  mock.method(taskSessionMcpToolConfirmationDAO, 'create', async (input: any) => ({
    id: 'confirmation-hidden-replay-1',
    ...input,
  }) as any);

  const row = await mcpToolConfirmationService.createPendingConfirmation({
    appUserId: 'user-1',
    taskSessionId: 'session-1',
    agentRunId: 'run-1',
    connectorKey: 'google_super',
    toolName: 'google_super__COMPOSIO_MULTI_EXECUTE_TOOL',
    argumentsJson: {
      tool_slug: 'GOOGLEDOCS_CREATE_DOCUMENT',
      arguments: {
        title: '项目周报',
      },
    },
  });

  assert.equal(
    (row.summaryJson as any)?.__internalReplay?.toolName,
    'google_super__COMPOSIO_MULTI_EXECUTE_TOOL'
  );
  assert.deepEqual((row.summaryJson as any)?.__internalReplay?.argumentsJson, {
    tool_slug: 'GOOGLEDOCS_CREATE_DOCUMENT',
    arguments: {
      title: '项目周报',
    },
  });

  const publicSummary = mcpToolConfirmationService.getPublicSummary(row.summaryJson);
  assert.equal((publicSummary as any).__internalReplay, undefined);
  assert.equal(publicSummary.toolName, 'google_super__COMPOSIO_MULTI_EXECUTE_TOOL');
  assert.equal(publicSummary.target, '项目周报');
});

test('createPendingConfirmation reuses existing pending confirmation for same run and arguments', async () => {
  const reusableRow = {
    id: 'confirmation-reused-1',
    appUserId: 'user-1',
    taskSessionId: 'session-1',
    agentRunId: 'run-1',
    connectorKey: 'google_super',
    toolName: 'google_super__GMAIL_SEND_EMAIL',
    argumentsHash: 'hash-1',
    summaryJson: {
      connectorKey: 'google_super',
      toolName: 'google_super__GMAIL_SEND_EMAIL',
      action: 'send_email',
      target: 'user@example.com',
      impact: 'Send one email from the connected Google account.',
      parameterSummary: {
        to: 'user@example.com',
      },
    },
    status: 'pending',
    expiresAt: new Date(Date.now() + 60_000),
  };
  const findReusableMock = mock.method(
    taskSessionMcpToolConfirmationDAO,
    'findReusablePending',
    async () => reusableRow as any
  );
  const createMock = mock.method(taskSessionMcpToolConfirmationDAO, 'create', async () => {
    throw new Error('create should not be called when reusable confirmation exists');
  });

  const row = await mcpToolConfirmationService.createPendingConfirmation({
    appUserId: 'user-1',
    taskSessionId: 'session-1',
    agentRunId: 'run-1',
    connectorKey: 'google_super',
    toolName: 'google_super__GMAIL_SEND_EMAIL',
    argumentsJson: {
      to: 'user@example.com',
      subject: 'Quarterly plan',
      body: 'private message',
    },
  });

  assert.equal(findReusableMock.mock.callCount(), 1);
  assert.equal(createMock.mock.callCount(), 0);
  assert.equal(row.id, 'confirmation-reused-1');
});

test('confirmation argument hash is stable for object key order', () => {
  assert.equal(
    mcpToolConfirmationService.hashArguments({ b: 2, a: 1 }),
    mcpToolConfirmationService.hashArguments({ a: 1, b: 2 })
  );
});

test('approveConfirmation refreshes token expiry window', async () => {
  const now = Date.now();
  const originalNow = Date.now;
  Date.now = () => now;
  process.env.GOOGLE_SUPER_CONFIRMATION_TOKEN_TTL_SECONDS = '600';

  mock.method(taskCreationSessionDAO, 'getSession', async () => ({
    userId: 'user-1',
  }) as any);
  mock.method(taskSessionMcpToolConfirmationDAO, 'getById', async () => ({
    id: 'confirmation-1',
    appUserId: 'user-1',
    taskSessionId: 'session-1',
    connectorKey: 'google_super',
    toolName: 'google_super__GMAIL_SEND_EMAIL',
    agentRunId: 'run-1',
    status: 'pending',
    expiresAt: new Date(now + 1_000),
  }) as any);
  const updateStatusMock = mock.method(
    taskSessionMcpToolConfirmationDAO,
    'updateStatus',
    async (_id: string, patch: any) => ({
      expiresAt: patch.expiresAt,
    }) as any
  );

  try {
    const result = await mcpToolConfirmationService.approveConfirmation({
      appUserId: 'user-1',
      taskSessionId: 'session-1',
      confirmationId: 'confirmation-1',
    });

    assert.ok(result.confirmationToken);
    assert.equal(updateStatusMock.mock.callCount(), 1);
    const patch = updateStatusMock.mock.calls[0]?.arguments[1] as any;
    assert.equal(patch.status, 'approved');
    assert.ok(patch.expiresAt instanceof Date);
    assert.equal(patch.expiresAt.getTime(), now + 600_000);
    assert.equal(new Date(result.expiresAt).getTime(), now + 600_000);
  } finally {
    Date.now = originalNow;
    delete process.env.GOOGLE_SUPER_CONFIRMATION_TOKEN_TTL_SECONDS;
  }
});

test('approveConfirmation reissues token when confirmation was already approved but not consumed', async () => {
  const now = Date.now();
  const originalNow = Date.now;
  Date.now = () => now;
  process.env.GOOGLE_SUPER_CONFIRMATION_TOKEN_TTL_SECONDS = '600';

  mock.method(taskCreationSessionDAO, 'getSession', async () => ({
    userId: 'user-1',
  }) as any);
  mock.method(taskSessionMcpToolConfirmationDAO, 'getById', async () => ({
    id: 'confirmation-1',
    appUserId: 'user-1',
    taskSessionId: 'session-1',
    connectorKey: 'google_super',
    toolName: 'google_super__GMAIL_SEND_EMAIL',
    agentRunId: 'run-1',
    status: 'approved',
    expiresAt: new Date(now + 1_000),
  }) as any);
  const updateStatusMock = mock.method(
    taskSessionMcpToolConfirmationDAO,
    'updateStatus',
    async (_id: string, patch: any) => ({
      expiresAt: patch.expiresAt,
    }) as any
  );

  try {
    const result = await mcpToolConfirmationService.approveConfirmation({
      appUserId: 'user-1',
      taskSessionId: 'session-1',
      confirmationId: 'confirmation-1',
    });

    assert.ok(result.confirmationToken);
    assert.equal(updateStatusMock.mock.callCount(), 1);
    const patch = updateStatusMock.mock.calls[0]?.arguments[1] as any;
    assert.equal(patch.status, 'approved');
    assert.ok(patch.expiresAt instanceof Date);
    assert.equal(patch.expiresAt.getTime(), now + 600_000);
    assert.equal(new Date(result.expiresAt).getTime(), now + 600_000);
  } finally {
    Date.now = originalNow;
    delete process.env.GOOGLE_SUPER_CONFIRMATION_TOKEN_TTL_SECONDS;
  }
});

test('resolveApprovedReplay returns stored tool snapshot for hidden retry', async () => {
  mock.method(taskSessionMcpToolConfirmationDAO, 'getById', async () => ({
    id: 'confirmation-1',
    appUserId: 'user-1',
    taskSessionId: 'session-1',
    connectorKey: 'google_super',
    toolName: 'google_super__COMPOSIO_MULTI_EXECUTE_TOOL',
    agentRunId: 'run-1',
    status: 'approved',
    summaryJson: {
      connectorKey: 'google_super',
      toolName: 'google_super__COMPOSIO_MULTI_EXECUTE_TOOL',
      action: 'create_resource',
      target: '项目周报',
      impact: 'Create one Google Docs document.',
      parameterSummary: {
        title: '项目周报',
      },
      __internalReplay: {
        toolName: 'google_super__COMPOSIO_MULTI_EXECUTE_TOOL',
        argumentsJson: {
          tool_slug: 'GOOGLEDOCS_CREATE_DOCUMENT',
          arguments: {
            title: '项目周报',
          },
        },
      },
    },
  }) as any);

  const replay = await mcpToolConfirmationService.resolveApprovedReplay({
    appUserId: 'user-1',
    taskSessionId: 'session-1',
    confirmationId: 'confirmation-1',
    connectorKey: 'google_super',
    toolName: 'google_super__COMPOSIO_MULTI_EXECUTE_TOOL',
    confirmationAgentRunId: 'run-1',
  });

  assert.deepEqual(replay, {
    confirmationId: 'confirmation-1',
    agentRunId: 'run-1',
    toolName: 'google_super__COMPOSIO_MULTI_EXECUTE_TOOL',
    argumentsJson: {
      tool_slug: 'GOOGLEDOCS_CREATE_DOCUMENT',
      arguments: {
        title: '项目周报',
      },
    },
  });
});

test('verifyAndConsumeConfirmation atomically consumes approved token', async () => {
  const consumeApprovedTokenMock = mock.method(
    taskSessionMcpToolConfirmationDAO,
    'consumeApprovedToken',
    async () => ({
      id: 'confirmation-1',
    }) as any
  );

  const verified = await mcpToolConfirmationService.verifyAndConsumeConfirmation({
    appUserId: 'user-1',
    taskSessionId: 'session-1',
    agentRunId: 'run-1',
    connectorKey: 'google_super',
    toolName: 'google_super__GMAIL_SEND_EMAIL',
    argumentsJson: {
      to: 'user@example.com',
      subject: 'Quarterly plan',
    },
    confirmationToken: 'token-1',
  });

  assert.equal(verified, true);
  assert.equal(consumeApprovedTokenMock.mock.callCount(), 1);
  assert.equal(
    consumeApprovedTokenMock.mock.calls[0]?.arguments[0]?.agentRunId,
    'run-1'
  );
});

test('verifyAndConsumeConfirmation preserves null agentRunId when replay metadata has no origin run id', async () => {
  const consumeApprovedTokenMock = mock.method(
    taskSessionMcpToolConfirmationDAO,
    'consumeApprovedToken',
    async () => ({
      id: 'confirmation-2',
    }) as any
  );

  const verified = await mcpToolConfirmationService.verifyAndConsumeConfirmation({
    appUserId: 'user-1',
    taskSessionId: 'session-1',
    agentRunId: null,
    connectorKey: 'google_super',
    toolName: 'google_super__COMPOSIO_MULTI_EXECUTE_TOOL',
    argumentsJson: {
      tool_slug: 'GOOGLESUPER_SEND_EMAIL',
      arguments: {
        recipient_email: 'user@example.com',
        subject: 'Quarterly plan',
      },
    },
    confirmationToken: 'token-2',
  });

  assert.equal(verified, true);
  assert.equal(consumeApprovedTokenMock.mock.callCount(), 1);
  assert.equal(
    consumeApprovedTokenMock.mock.calls[0]?.arguments[0]?.agentRunId,
    null
  );
});
