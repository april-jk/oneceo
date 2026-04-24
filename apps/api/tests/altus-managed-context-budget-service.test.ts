import assert from 'node:assert/strict';
import test from 'node:test';
import { AltusManagedContextBudgetService } from '../src/services/altus-managed-context-budget-service';
import type { ChatMessage } from '../src/services/altus-managed-shared';

test('projectMessagesForModel keeps recent tool messages raw and budgets older large outputs', () => {
  const service = new AltusManagedContextBudgetService();
  const oldReadContent = 'A'.repeat(15000);
  const oldShellStdout = 'B'.repeat(8000);
  const recentToolContent = 'C'.repeat(14000);

  const messages: ChatMessage[] = [
    { role: 'user', content: 'inspect workspace' },
    {
      role: 'tool',
      name: 'read_file',
      tool_call_id: 'tool-1',
      content: JSON.stringify({
        path: 'src/index.ts',
        content: oldReadContent,
      }),
    },
    {
      role: 'tool',
      name: 'shell_execute',
      tool_call_id: 'tool-2',
      content: JSON.stringify({
        cwd: '.',
        exitCode: 0,
        stdout: oldShellStdout,
        stderr: '',
      }),
    },
    {
      role: 'tool',
      name: 'list_directory',
      tool_call_id: 'tool-2a',
      content: '{"path":"src","output":"a"}',
    },
    {
      role: 'tool',
      name: 'list_directory',
      tool_call_id: 'tool-2b',
      content: '{"path":"src","output":"b"}',
    },
    {
      role: 'tool',
      name: 'list_directory',
      tool_call_id: 'tool-2c',
      content: '{"path":"src","output":"c"}',
    },
    {
      role: 'tool',
      name: 'list_directory',
      tool_call_id: 'tool-2d',
      content: '{"path":"src","output":"d"}',
    },
    {
      role: 'tool',
      name: 'list_directory',
      tool_call_id: 'tool-2e',
      content: '{"path":"src","output":"e"}',
    },
    {
      role: 'tool',
      name: 'read_file',
      tool_call_id: 'tool-3',
      content: JSON.stringify({
        path: 'src/recent.ts',
        content: recentToolContent,
      }),
    },
  ];

  const projected = service.projectMessagesForModel(messages);
  const oldReadProjected = JSON.parse(String(projected[1]?.content));
  const oldShellProjected = JSON.parse(String(projected[2]?.content));

  assert.equal(oldReadProjected.budgetApplied, true);
  assert.equal(oldReadProjected.originalChars, oldReadContent.length);
  assert.match(oldReadProjected.contentSummary, /\.\.\.\[budgeted\]\.\.\./);

  assert.equal(oldShellProjected.budgetApplied, true);
  assert.equal(oldShellProjected.stdoutChars, oldShellStdout.length);
  assert.match(oldShellProjected.stdoutSummary, /\.\.\.\[budgeted\]\.\.\./);

  assert.equal(projected[3]?.content, messages[3]?.content);
});

test('projectMessagesForModel budgets opaque mcp tool output without requiring a fine-grained descriptor', () => {
  const service = new AltusManagedContextBudgetService();
  const largePayload = JSON.stringify({
    providerId: 'provider-1',
    toolName: 'search_repositories',
    result: {
      rows: Array.from({ length: 50 }, (_, index) => ({
        name: `repo-${index}`,
        description: 'repository'.repeat(80),
      })),
    },
  });

  const projected = service.projectMessagesForModel([
    {
      role: 'tool',
      name: 'mcp__search_repositories__123456789abc',
      tool_call_id: 'tool-mcp',
      content: largePayload,
    },
    { role: 'tool', name: 'list_directory', tool_call_id: 'tool-x1', content: '{"path":"a"}' },
    { role: 'tool', name: 'list_directory', tool_call_id: 'tool-x2', content: '{"path":"b"}' },
    { role: 'tool', name: 'list_directory', tool_call_id: 'tool-x3', content: '{"path":"c"}' },
    { role: 'tool', name: 'list_directory', tool_call_id: 'tool-x4', content: '{"path":"d"}' },
    { role: 'tool', name: 'list_directory', tool_call_id: 'tool-x5', content: '{"path":"e"}' },
    { role: 'tool', name: 'list_directory', tool_call_id: 'tool-x6', content: '{"path":"f"}' },
  ]);

  const summarized = JSON.parse(String(projected[0]?.content));
  assert.equal(summarized.toolFamily, 'mcp');
  assert.equal(summarized.budgetApplied, true);
  assert.equal(summarized.originalChars, largePayload.length);
});

test('projectMessagesForModel budgets large assistant write_file tool arguments before the next model round', () => {
  const service = new AltusManagedContextBudgetService();
  const largeContent = 'X'.repeat(9000);

  const projected = service.projectMessagesForModel([
    {
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: 'call-1',
          type: 'function',
          function: {
            name: 'write_file',
            arguments: JSON.stringify({
              path: 'index.html',
              content: largeContent,
            }),
          },
        },
      ],
    },
  ]);

  const summarizedArguments = JSON.parse(String(projected[0]?.tool_calls?.[0]?.function?.arguments || '{}'));
  assert.equal(summarizedArguments.path, 'index.html');
  assert.equal(summarizedArguments.budgetApplied, true);
  assert.equal(summarizedArguments.contentChars, largeContent.length);
  assert.match(summarizedArguments.contentSummary, /\.\.\.\[budgeted\]\.\.\./);
});

test('projectMessagesForModel normalizes malformed assistant tool arguments before the next model round', () => {
  const service = new AltusManagedContextBudgetService();

  const projected = service.projectMessagesForModel([
    {
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: 'call-shell-1',
          type: 'function',
          function: {
            name: 'shell_execute',
            arguments: '{"command":"pnpm test"',
          },
        },
        {
          id: 'call-read-1',
          type: 'function',
          function: {
            name: 'read_file',
            arguments: JSON.stringify({ path: 'package.json' }),
          },
        },
      ],
    },
  ]);

  assert.equal(projected[0]?.tool_calls?.[0]?.function.arguments, '{}');
  assert.equal(projected[0]?.tool_calls?.[1]?.function.arguments, '{"path":"package.json"}');
  assert.doesNotThrow(() => JSON.parse(String(projected[0]?.tool_calls?.[0]?.function.arguments)));
});
