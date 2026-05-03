import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AltusManagedContextCompiler } from '../src/services/altus-managed-context-compiler';
import { AltusManagedContextLedgerAdapter } from '../src/services/altus-managed-context-ledger-adapter';
import { AltusManagedContextManifestService } from '../src/services/altus-managed-context-manifest-service';
import { AltusManagedContextReconciliationService } from '../src/services/altus-managed-context-reconciliation-service';
import { AltusManagedTurnSnapshotService } from '../src/services/altus-managed-turn-snapshot-service';

test('stage1 ledger normalizes messages, attachments, skills and run tool events', () => {
  const adapter = new AltusManagedContextLedgerAdapter();
  const ledger = adapter.buildFromRecords({
    sessionId: 'session-ctx-1',
    runId: 'run-ctx-1',
    messages: [
      {
        id: 'message-1',
        sessionId: 'session-ctx-1',
        role: 'user',
        content: '帮我做一个管理后台系统',
        messageKey: 'user-message-1',
        timelineCursor: 100,
        metadata: {
          attachments: [{ name: 'brief.md', objectKey: 'object-1' }],
          skills: [{ sourceType: 'custom', skillId: 'skill-1', revisionId: 'rev-1' }],
        },
        createdAt: '2026-04-26T01:00:00.000Z',
      },
      {
        id: 'message-2',
        sessionId: 'session-ctx-1',
        role: 'assistant',
        content: '需要确认目标边界。',
        messageType: 'clarification_request',
        messageKey: 'clarification-1',
        timelineCursor: 200,
        metadata: {},
        createdAt: '2026-04-26T01:01:00.000Z',
      },
    ],
    runEvents: [
      {
        id: 'event-1',
        runId: 'run-ctx-1',
        sessionId: 'session-ctx-1',
        eventType: 'tool_call_started',
        sequence: 1,
        payloadJson: {
          toolCallId: 'tool-1',
          toolName: 'ask_user',
          arguments: { question: '网页应用还是完整系统？' },
        },
        createdAt: '2026-04-26T01:02:00.000Z',
      },
      {
        id: 'event-2',
        runId: 'run-ctx-1',
        sessionId: 'session-ctx-1',
        eventType: 'tool_call_completed',
        sequence: 2,
        payloadJson: {
          toolCallId: 'tool-1',
          toolName: 'ask_user',
          result: { status: 'ask_user' },
        },
        createdAt: '2026-04-26T01:02:01.000Z',
      },
    ],
  });

  assert.equal(ledger.sessionId, 'session-ctx-1');
  assert.equal(ledger.runId, 'run-ctx-1');
  assert.ok(ledger.sourceHash);
  assert.deepEqual(
    ledger.entries.map((entry) => entry.kind),
    ['user_message', 'attachment_ref', 'skill_selection', 'clarification_request', 'assistant_tool_use', 'tool_result']
  );
  assert.equal(ledger.entries.find((entry) => entry.kind === 'assistant_tool_use')?.toolUseId, 'tool-1');
  assert.equal(ledger.entries.find((entry) => entry.kind === 'tool_result')?.status, 'ok');
});

test('stage1 manifest and reconciliation report missing and orphan tool results without writes', () => {
  const adapter = new AltusManagedContextLedgerAdapter();
  const manifestService = new AltusManagedContextManifestService();
  const reconciliationService = new AltusManagedContextReconciliationService();
  const ledger = adapter.buildFromRecords({
    sessionId: 'session-ctx-2',
    runId: 'run-ctx-2',
    runEvents: [
      {
        id: 'event-started',
        runId: 'run-ctx-2',
        sessionId: 'session-ctx-2',
        eventType: 'tool_call_started',
        sequence: 1,
        payloadJson: { toolCallId: 'missing-result', toolName: 'read_file' },
      },
      {
        id: 'event-orphan',
        runId: 'run-ctx-2',
        sessionId: 'session-ctx-2',
        eventType: 'tool_call_completed',
        sequence: 2,
        payloadJson: { toolCallId: 'orphan-result', toolName: 'write_file', result: 'ok' },
      },
      {
        id: 'event-clarification',
        runId: 'run-ctx-2',
        sessionId: 'session-ctx-2',
        eventType: 'clarification_requested',
        sequence: 3,
        payloadJson: { question: '需要确认什么？' },
      },
    ],
  });

  const manifest = manifestService.buildManifest(ledger);
  assert.deepEqual(manifest.pairing.missingToolResults, ['missing-result']);
  assert.deepEqual(manifest.pairing.orphanToolResults, ['orphan-result']);

  const preview = reconciliationService.preview(ledger);
  assert.equal(preview.mode, 'dry_run');
  assert.equal(preview.wouldWrite, false);
  assert.deepEqual(
    preview.issues.map((issue) => issue.code),
    ['missing_tool_result', 'orphan_tool_result', 'pending_clarification_without_user_reply']
  );
});

test('stage3 manifest and reconciliation report duplicate tool results', () => {
  const adapter = new AltusManagedContextLedgerAdapter();
  const manifestService = new AltusManagedContextManifestService();
  const reconciliationService = new AltusManagedContextReconciliationService();
  const ledger = adapter.buildFromRecords({
    sessionId: 'session-ctx-duplicate',
    runId: 'run-ctx-duplicate',
    runEvents: [
      {
        id: 'event-started',
        runId: 'run-ctx-duplicate',
        sessionId: 'session-ctx-duplicate',
        eventType: 'tool_call_started',
        sequence: 1,
        payloadJson: { toolCallId: 'duplicated-result', toolName: 'read_file' },
      },
      {
        id: 'event-completed-1',
        runId: 'run-ctx-duplicate',
        sessionId: 'session-ctx-duplicate',
        eventType: 'tool_call_completed',
        sequence: 2,
        payloadJson: { toolCallId: 'duplicated-result', toolName: 'read_file', result: 'ok' },
      },
      {
        id: 'event-completed-2',
        runId: 'run-ctx-duplicate',
        sessionId: 'session-ctx-duplicate',
        eventType: 'tool_call_completed',
        sequence: 3,
        payloadJson: { toolCallId: 'duplicated-result', toolName: 'read_file', result: 'ok-again' },
      },
    ],
  });

  const manifest = manifestService.buildManifest(ledger);
  assert.deepEqual(manifest.pairing.duplicateToolResults, ['duplicated-result']);
  const preview = reconciliationService.preview(ledger);
  assert.ok(preview.issues.some((issue) => issue.code === 'duplicate_tool_result'));
});

test('stage3 compiler uses envelope contentForModel for tool result messages', () => {
  const adapter = new AltusManagedContextLedgerAdapter();
  const compiler = new AltusManagedContextCompiler();
  const ledger = adapter.buildFromRecords({
    sessionId: 'session-ctx-envelope',
    runId: 'run-ctx-envelope',
    runEvents: [
      {
        id: 'event-started',
        runId: 'run-ctx-envelope',
        sessionId: 'session-ctx-envelope',
        eventType: 'tool_call_started',
        sequence: 1,
        payloadJson: { toolCallId: 'tool-envelope', toolName: 'read_file' },
      },
      {
        id: 'event-completed',
        runId: 'run-ctx-envelope',
        sessionId: 'session-ctx-envelope',
        eventType: 'tool_call_completed',
        sequence: 2,
        payloadJson: {
          toolCallId: 'tool-envelope',
          toolName: 'read_file',
          toolResultEnvelope: {
            status: 'ok',
            toolUseId: 'tool-envelope',
            toolName: 'read_file',
            runId: 'run-ctx-envelope',
            modelRoundId: '1',
            args: {},
            contentForModel: '{"file":"README.md"}',
            contentForUser: '读取完成',
            retryable: false,
            sideEffects: [],
            activatedSkills: [],
          },
        },
      },
    ],
  });

  const compiled = compiler.compile(ledger);
  assert.equal(compiled.messages[1]?.role, 'tool');
  assert.equal(compiled.messages[1]?.content, '{"file":"README.md"}');
});

test('stage1 compiler lowers ledger into OpenAI-compatible chat messages', () => {
  const adapter = new AltusManagedContextLedgerAdapter();
  const compiler = new AltusManagedContextCompiler();
  const ledger = adapter.buildFromRecords({
    sessionId: 'session-ctx-3',
    runId: 'run-ctx-3',
    messages: [
      {
        id: 'message-1',
        role: 'user',
        content: '读取 README',
        messageKey: 'message-1',
        timelineCursor: 1,
      },
    ],
    runEvents: [
      {
        id: 'event-1',
        runId: 'run-ctx-3',
        sessionId: 'session-ctx-3',
        eventType: 'tool_call_started',
        sequence: 1,
        payloadJson: { toolCallId: 'tool-read', toolName: 'read_file', arguments: { path: 'README.md' } },
      },
      {
        id: 'event-2',
        runId: 'run-ctx-3',
        sessionId: 'session-ctx-3',
        eventType: 'tool_call_completed',
        sequence: 2,
        payloadJson: { toolCallId: 'tool-read', toolName: 'read_file', result: { content: 'hello' } },
      },
    ],
  });

  const compiled = compiler.compile(ledger);
  assert.deepEqual(compiled.droppedEntries, []);
  assert.equal(compiled.messages[0]?.role, 'user');
  assert.equal(compiled.messages[1]?.role, 'assistant');
  assert.equal(compiled.messages[1]?.tool_calls?.[0]?.id, 'tool-read');
  assert.equal(compiled.messages[1]?.tool_calls?.[0]?.function.name, 'read_file');
  assert.equal(compiled.messages[1]?.tool_calls?.[0]?.function.arguments, '{"path":"README.md"}');
  assert.equal(compiled.messages[2]?.role, 'tool');
  assert.equal(compiled.messages[2]?.tool_call_id, 'tool-read');
  assert.equal(compiled.messages[2]?.content, '{"content":"hello"}');
});

test('stage1 turn snapshot produces stable hashes for tools, mcp providers and skills', () => {
  const snapshotService = new AltusManagedTurnSnapshotService();
  const snapshot = snapshotService.createReadOnlySnapshot({
    sessionId: 'session-ctx-4',
    runId: 'run-ctx-4',
    model: 'test-model',
    mcpProviders: [
      {
        providerId: 'provider-1',
        connectorKey: 'github',
        tools: [
          {
            providerId: 'provider-1',
            toolName: 'list_issues',
            inputSchema: { type: 'object', properties: {}, additionalProperties: true },
          },
        ],
      },
    ],
    skills: [
      {
        sourceType: 'custom',
        skillId: 'skill-1',
        revisionId: 'rev-1',
        slug: 'context',
        name: 'Context',
        description: '',
        category: 'test',
        renderedMarkdown: '',
        revisionNumber: 1,
      },
    ],
  });

  assert.equal(snapshot.sessionId, 'session-ctx-4');
  assert.equal(snapshot.runId, 'run-ctx-4');
  assert.equal(snapshot.mcpProviders[0]?.toolNames[0], 'list_issues');
  assert.equal(snapshot.skills[0]?.revisionId, 'rev-1');
  assert.match(snapshot.toolDefinitionsHash, /^[a-f0-9]{64}$/);
  assert.match(snapshot.mcpProviderSnapshotHash, /^[a-f0-9]{64}$/);
  assert.match(snapshot.skillSnapshotHash, /^[a-f0-9]{64}$/);
});
