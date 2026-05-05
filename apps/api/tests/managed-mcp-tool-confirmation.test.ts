import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildManagedMcpToolConfirmationPrompt,
  readManagedMcpToolConfirmationPayload,
} from '../src/services/managed-mcp-tool-confirmation';

test('reads approval payload from managed metadata', () => {
  const payload = readManagedMcpToolConfirmationPayload({
    source: 'mcp_tool_confirmation_approved',
    mcpToolConfirmation: {
      action: 'approve',
      connectorKey: 'google_super',
      confirmationId: 'confirmation-1',
      toolName: 'google_super__GMAIL_SEND_EMAIL',
      confirmationToken: 'token-1',
      confirmationAgentRunId: 'run-1',
      summary: {
        action: 'send_email',
        target: 'user@example.com',
        impact: 'Send one email from the connected Google account.',
        parameterSummary: {
          to: 'user@example.com',
        },
      },
    },
  });

  assert.ok(payload);
  assert.equal(payload?.action, 'approve');
  assert.equal(payload?.connectorKey, 'google_super');
  assert.equal(payload?.confirmationToken, 'token-1');
  assert.equal(payload?.confirmationAgentRunId, 'run-1');
  assert.equal(payload?.summary?.target, 'user@example.com');
});

test('builds approval prompt that forces retry of the same tool call', () => {
  const prompt = buildManagedMcpToolConfirmationPrompt({
    action: 'approve',
    connectorKey: 'google_super',
    confirmationId: 'confirmation-1',
    toolName: 'google_super__GMAIL_SEND_EMAIL',
    confirmationToken: 'token-1',
    confirmationAgentRunId: 'run-1',
    summary: {
      action: 'send_email',
      target: 'user@example.com',
      impact: 'Send one email from the connected Google account.',
      parameterSummary: {
        to: 'user@example.com',
        body: '[redacted]',
      },
    },
  });

  assert.match(prompt, /用户已明确确认本次高风险操作/);
  assert.match(prompt, /必须继续刚才被确认拦截的同一个 MCP tool call/);
  assert.match(prompt, /confirmationToken: token-1/);
  assert.match(prompt, /confirmationAgentRunId: run-1/);
});

test('builds rejection prompt that forbids retry', () => {
  const prompt = buildManagedMcpToolConfirmationPrompt({
    action: 'reject',
    connectorKey: 'google_super',
    confirmationId: 'confirmation-2',
    toolName: 'google_super__GOOGLEDRIVE_CREATE_FILE',
    summary: {
      action: 'create_file',
      target: 'folder-1',
      impact: 'Create one file in Google Drive.',
      parameterSummary: {},
    },
  });

  assert.match(prompt, /用户已拒绝本次高风险操作/);
  assert.match(prompt, /不得重试这个 MCP tool call/);
});
