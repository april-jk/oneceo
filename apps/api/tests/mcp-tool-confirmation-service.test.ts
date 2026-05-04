import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mcpToolConfirmationService } from '../src/services/mcp-tool-confirmation-service';

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

test('confirmation argument hash is stable for object key order', () => {
  assert.equal(
    mcpToolConfirmationService.hashArguments({ b: 2, a: 1 }),
    mcpToolConfirmationService.hashArguments({ a: 1, b: 2 })
  );
});
