import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AltusManagedContextCacheObserver } from '../src/services/altus-managed-context-cache-observer';
import { AltusManagedContextDebugSummaryService } from '../src/services/altus-managed-context-debug-summary-service';
import { AltusManagedContextLedgerAdapter } from '../src/services/altus-managed-context-ledger-adapter';
import { AltusManagedContextRecoveryService } from '../src/services/altus-managed-context-recovery-service';
import { AltusManagedDynamicContextBlockService } from '../src/services/altus-managed-dynamic-context-blocks';
import { AltusManagedTurnSnapshotService } from '../src/services/altus-managed-turn-snapshot-service';

test('context debug summary exposes facts source, clarification state, tool pairing and round trip', () => {
  const blockService = new AltusManagedDynamicContextBlockService();
  const ledger = new AltusManagedContextLedgerAdapter().buildFromRecords({
    sessionId: 'session-debug-summary',
    runId: 'run-debug-summary',
    messages: [
      {
        role: 'user',
        content: '帮我做一个管理后台系统',
        messageType: 'user_input',
        messageKey: 'user-1',
        timelineCursor: 1,
      },
      {
        role: 'agent',
        content: '这次要交付的是网页应用、后端 API、本地脚本，还是完整业务系统？',
        messageType: 'clarification_request',
        messageKey: 'clarification-1',
        timelineCursor: 2,
        metadata: { toolCallId: 'tool-ask-summary' },
      },
      {
        role: 'user',
        content: '网页应用',
        messageType: 'clarification_answer',
        messageKey: 'answer-1',
        timelineCursor: 3,
        metadata: {
          clarificationAnswer: true,
          clarificationToolCallId: 'tool-ask-summary',
        },
      },
      {
        role: 'user',
        content: '按你的想法，先帮我做个方案',
        messageType: 'user_input',
        messageKey: 'user-2',
        timelineCursor: 4,
      },
    ],
    runEvents: [
      {
        id: 'tool-start-1',
        runId: 'run-debug-summary',
        sessionId: 'session-debug-summary',
        eventType: 'tool_call_started',
        sequence: 1,
        payloadJson: { toolCallId: 'tool-write-1', toolName: 'write_file' },
      },
      {
        id: 'tool-complete-1',
        runId: 'run-debug-summary',
        sessionId: 'session-debug-summary',
        eventType: 'tool_call_completed',
        sequence: 2,
        payloadJson: {
          toolCallId: 'tool-write-1',
          toolName: 'write_file',
          toolResultEnvelope: {
            status: 'ok',
            toolUseId: 'tool-write-1',
            toolName: 'write_file',
            contentForModel: '{"path":"方案.md"}',
            contentForUser: '方案.md 已写入',
            retryable: false,
            sideEffects: [],
            activatedSkills: [],
          },
        },
      },
    ],
  });
  const recovery = new AltusManagedContextRecoveryService().rebuildFromLedger({
    ledger,
    dynamicContextBlocks: blockService.buildMemoryBlocks({ sessionMemory: { summary: { goal: '管理后台系统' } } }),
  });
  const snapshot = new AltusManagedTurnSnapshotService().createReadOnlySnapshot({
    sessionId: 'session-debug-summary',
    runId: 'run-debug-summary',
  });
  const cacheObservation = new AltusManagedContextCacheObserver().buildObservation({
    ledger: recovery.ledger,
    manifest: recovery.manifest,
    snapshot,
    apiMessages: recovery.compiled.messages,
  });
  const summary = new AltusManagedContextDebugSummaryService().buildSummary({
    recovery,
    cacheObservation,
  });

  assert.equal(summary.recoveryState, 'recoverable');
  assert.equal(summary.factsSource.redis, 'not_fact_source');
  assert.equal(summary.factsSource.uiProjection, 'not_fact_source');
  assert.equal(summary.factsSource.promptCache, 'not_fact_source');
  assert.deepEqual(summary.clarification.pending, []);
  assert.equal(summary.clarification.answered[0]?.answer, '网页应用');
  assert.deepEqual(summary.recentIntent, ['帮我做一个管理后台系统', '网页应用', '按你的想法，先帮我做个方案']);
  assert.deepEqual(summary.toolPairing.missingToolResults, []);
  assert.deepEqual(summary.toolPairing.orphanToolResults, []);
  assert.equal(summary.roundTrip.equivalent, true);
  assert.equal(summary.cache.stableSystemChanged, false);
  assert.equal(summary.cache.dynamicContextChanged, false);
  assert.deepEqual(summary.cache.cacheBreakReasons, ['initial_observation']);
});

test('context debug summary marks dynamic context changes without marking stable system changes', () => {
  const adapter = new AltusManagedContextLedgerAdapter();
  const recoveryService = new AltusManagedContextRecoveryService();
  const blockService = new AltusManagedDynamicContextBlockService();
  const snapshotService = new AltusManagedTurnSnapshotService();
  const cacheObserver = new AltusManagedContextCacheObserver();
  const ledger = adapter.buildFromRecords({
    sessionId: 'session-cache-summary',
    runId: 'run-cache-summary',
    messages: [{ role: 'user', content: '继续', messageKey: 'user-cache-1', timelineCursor: 1 }],
  });
  const firstRecovery = recoveryService.rebuildFromLedger({
    ledger,
    dynamicContextBlocks: blockService.buildMemoryBlocks({ sessionMemory: { summary: { goal: 'A' } } }),
  });
  const secondRecovery = recoveryService.rebuildFromLedger({
    ledger,
    dynamicContextBlocks: blockService.buildMemoryBlocks({ sessionMemory: { summary: { goal: 'B' } } }),
  });
  const snapshot = snapshotService.createReadOnlySnapshot({
    sessionId: 'session-cache-summary',
    runId: 'run-cache-summary',
  });
  const firstCache = cacheObserver.buildObservation({
    ledger,
    manifest: firstRecovery.manifest,
    snapshot,
    apiMessages: firstRecovery.compiled.messages,
  });
  const secondCache = cacheObserver.buildObservation({
    ledger,
    manifest: secondRecovery.manifest,
    snapshot,
    apiMessages: secondRecovery.compiled.messages,
    previous: firstCache,
  });
  const summary = new AltusManagedContextDebugSummaryService().buildSummary({
    recovery: secondRecovery,
    cacheObservation: secondCache,
    previousCacheObservation: firstCache,
  });

  assert.equal(summary.cache.stableSystemChanged, false);
  assert.equal(summary.cache.toolSchemaChanged, false);
  assert.equal(summary.cache.dynamicContextChanged, true);
  assert.equal(summary.cache.apiMessagesChanged, false);
  assert.ok(summary.cache.cacheBreakReasons.includes('memory_snapshot_changed'));
  assert.ok(summary.cache.cacheBreakReasons.includes('volatile_context_changed'));
});
