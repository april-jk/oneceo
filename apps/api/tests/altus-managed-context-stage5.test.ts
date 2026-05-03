import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AltusManagedContextBudgetService } from '../src/services/altus-managed-context-budget-service';
import { AltusManagedContextCacheObserver } from '../src/services/altus-managed-context-cache-observer';
import { AltusManagedContextCompiler } from '../src/services/altus-managed-context-compiler';
import { AltusManagedContextLedgerAdapter } from '../src/services/altus-managed-context-ledger-adapter';
import { AltusManagedContextManifestService } from '../src/services/altus-managed-context-manifest-service';
import { AltusManagedContextRecoveryService } from '../src/services/altus-managed-context-recovery-service';
import { AltusManagedContextRoundTripService } from '../src/services/altus-managed-context-roundtrip-service';
import { AltusManagedDynamicContextBlockService } from '../src/services/altus-managed-dynamic-context-blocks';
import { AltusManagedTurnSnapshotService } from '../src/services/altus-managed-turn-snapshot-service';

test('stage5 cache observer reports stable hashes and unresolved pairing reasons', () => {
  const adapter = new AltusManagedContextLedgerAdapter();
  const manifestService = new AltusManagedContextManifestService();
  const compiler = new AltusManagedContextCompiler();
  const snapshotService = new AltusManagedTurnSnapshotService();
  const blockService = new AltusManagedDynamicContextBlockService();
  const observer = new AltusManagedContextCacheObserver();
  const ledger = adapter.buildFromRecords({
    sessionId: 'session-cache-1',
    runId: 'run-cache-1',
    messages: [
      {
        role: 'user',
        content: '分析附件',
        messageKey: 'message-cache-1',
        metadata: {
          attachments: [{ externalObjectKey: 'object-cache-1', name: 'brief.png', mimeType: 'image/png' }],
        },
      },
    ],
    runEvents: [
      {
        id: 'event-cache-start',
        runId: 'run-cache-1',
        sessionId: 'session-cache-1',
        eventType: 'tool_call_started',
        sequence: 1,
        payloadJson: { toolCallId: 'tool-cache-missing', toolName: 'read_file' },
      },
    ],
  });
  const includedContext = blockService.buildIncludedContextManifest([
    ...blockService.buildAttachmentBlocks([
      {
        messageKey: 'message-cache-1',
        metadata: {
          attachments: [{ externalObjectKey: 'object-cache-1', name: 'brief.png', mimeType: 'image/png' }],
        },
      },
    ]),
    ...blockService.buildMemoryBlocks({ sessionMemory: { summary: { goal: '分析附件' } } }),
  ]);
  const manifest = manifestService.buildManifest(ledger, { includedContext });
  const compiled = compiler.compile(ledger);
  const snapshot = snapshotService.createReadOnlySnapshot({
    sessionId: 'session-cache-1',
    runId: 'run-cache-1',
  });
  const observation = observer.buildObservation({
    ledger,
    manifest,
    snapshot,
    apiMessages: compiled.messages,
  });

  assert.ok(observation.stableSystemHash);
  assert.ok(observation.memorySnapshotHash);
  assert.ok(observation.attachmentContextHash);
  assert.deepEqual(observation.cacheBreakReasons, ['initial_observation', 'unresolved_tool_pairing']);

  const secondObservation = observer.buildObservation({
    ledger,
    manifest,
    snapshot,
    apiMessages: compiled.messages,
    previous: observation,
  });
  assert.deepEqual(secondObservation.cacheBreakReasons, ['unresolved_tool_pairing']);
  assert.equal(secondObservation.apiMessageHash, observation.apiMessageHash);
});

test('stage5 recovery rebuilds from db-backed facts and rejects redis as a fact source', () => {
  const adapter = new AltusManagedContextLedgerAdapter();
  const blockService = new AltusManagedDynamicContextBlockService();
  const recoveryService = new AltusManagedContextRecoveryService();
  const ledger = adapter.buildFromRecords({
    sessionId: 'session-recovery-1',
    runId: 'run-recovery-1',
    messages: [
      {
        role: 'user',
        content: '网页应用',
        messageType: 'clarification_answer',
        messageKey: 'answer-1',
        metadata: { clarificationAnswer: true },
      },
    ],
    runEvents: [
      {
        id: 'event-recovery-start',
        runId: 'run-recovery-1',
        sessionId: 'session-recovery-1',
        eventType: 'tool_call_started',
        sequence: 1,
        payloadJson: { toolCallId: 'tool-recovery-1', toolName: 'ask_user' },
      },
      {
        id: 'event-recovery-complete',
        runId: 'run-recovery-1',
        sessionId: 'session-recovery-1',
        eventType: 'tool_call_completed',
        sequence: 2,
        payloadJson: {
          toolCallId: 'tool-recovery-1',
          toolName: 'ask_user',
          toolResultEnvelope: {
            status: 'ask_user',
            toolUseId: 'tool-recovery-1',
            toolName: 'ask_user',
            runId: 'run-recovery-1',
            modelRoundId: '1',
            args: {},
            contentForModel: '{"status":"ask_user"}',
            contentForUser: '需要补充信息',
            retryable: false,
            sideEffects: [],
            activatedSkills: [],
          },
        },
      },
    ],
  });
  const report = recoveryService.rebuildFromLedger({
    ledger,
    dynamicContextBlocks: blockService.buildMemoryBlocks({ sessionMemory: { goal: '用户管理系统' } }),
  });

  assert.equal(report.mode, 'db_backed_read_only');
  assert.equal(report.factsSource.redis, 'not_fact_source');
  assert.equal(report.factsSource.uiProjection, 'not_fact_source');
  assert.equal(report.recoveryState, 'recoverable');
  assert.equal(report.roundTrip.equivalent, true);
  assert.equal(report.compiled.messages.some((message) => message.role === 'tool'), true);
});

test('stage5 cache observer isolates skill and memory cache break reasons', () => {
  const observer = new AltusManagedContextCacheObserver();
  const snapshotService = new AltusManagedTurnSnapshotService();
  const manifestService = new AltusManagedContextManifestService();
  const blockService = new AltusManagedDynamicContextBlockService();
  const adapter = new AltusManagedContextLedgerAdapter();
  const ledger = adapter.buildFromRecords({
    sessionId: 'session-cache-2',
    runId: 'run-cache-2',
    messages: [{ role: 'user', content: '继续', messageKey: 'message-cache-2' }],
  });
  const baseManifest = manifestService.buildManifest(ledger, {
    includedContext: blockService.buildIncludedContextManifest(
      blockService.buildMemoryBlocks({ sessionMemory: { goal: 'A' } })
    ),
  });
  const baseSnapshot = snapshotService.createReadOnlySnapshot({
    sessionId: 'session-cache-2',
    runId: 'run-cache-2',
    skills: [{ sourceType: 'custom', skillId: 'skill-1', revisionId: 'rev-1', slug: 'alpha', name: 'Alpha' } as any],
  });
  const base = observer.buildObservation({
    ledger,
    manifest: baseManifest,
    snapshot: baseSnapshot,
    apiMessages: [{ role: 'user', content: '继续' }],
  });
  const changedManifest = manifestService.buildManifest(ledger, {
    includedContext: blockService.buildIncludedContextManifest(
      blockService.buildMemoryBlocks({ sessionMemory: { goal: 'B' } })
    ),
  });
  const changedSnapshot = snapshotService.createReadOnlySnapshot({
    sessionId: 'session-cache-2',
    runId: 'run-cache-2',
    skills: [{ sourceType: 'custom', skillId: 'skill-1', revisionId: 'rev-2', slug: 'alpha', name: 'Alpha' } as any],
  });
  const changed = observer.buildObservation({
    ledger,
    manifest: changedManifest,
    snapshot: changedSnapshot,
    apiMessages: [{ role: 'user', content: '继续' }],
    previous: base,
  });

  assert.ok(changed.cacheBreakReasons.includes('skill_snapshot_changed'));
  assert.ok(changed.cacheBreakReasons.includes('memory_snapshot_changed'));
  assert.ok(changed.cacheBreakReasons.includes('volatile_context_changed'));
  assert.equal(changed.apiMessageHash, base.apiMessageHash);
});

test('stage5 round-trip service classifies dynamic changes and missing facts', () => {
  const manifestService = new AltusManagedContextManifestService();
  const roundTrip = new AltusManagedContextRoundTripService();
  const adapter = new AltusManagedContextLedgerAdapter();
  const blockService = new AltusManagedDynamicContextBlockService();
  const beforeLedger = adapter.buildFromRecords({
    sessionId: 'session-roundtrip',
    runId: 'run-roundtrip',
    messages: [{ role: 'user', content: '帮我做方案', messageKey: 'message-before' }],
  });
  const afterLedger = adapter.buildFromRecords({
    sessionId: 'session-roundtrip',
    runId: 'run-roundtrip',
    messages: [],
  });
  const before = manifestService.buildManifest(beforeLedger, {
    includedContext: blockService.buildIncludedContextManifest(
      blockService.buildMemoryBlocks({ sessionMemory: { goal: '做方案' } })
    ),
  });
  const after = manifestService.buildManifest(afterLedger, {
    includedContext: blockService.buildIncludedContextManifest(
      blockService.buildMemoryBlocks({ sessionMemory: { goal: '做原型' } })
    ),
  });
  const report = roundTrip.compareManifests(before, after);

  assert.equal(report.equivalent, false);
  assert.ok(report.diffs.some((diff) => diff.category === 'expected_dynamic_context_change'));
  assert.ok(report.diffs.some((diff) => diff.category === 'missing_fact'));
  assert.ok(report.diffs.some((diff) => diff.path === 'contextHash'));
});

test('stage5 budget projection reports replacements without mutating original messages', () => {
  const budget = new AltusManagedContextBudgetService();
  const largeContent = 'A'.repeat(16000);
  const originalLargeToolContent = JSON.stringify({ path: 'large.txt', content: largeContent });
  const messages = [
    { role: 'user' as const, content: '读文件' },
    {
      role: 'tool' as const,
      name: 'read_file',
      tool_call_id: 'tool-budget-1',
      content: originalLargeToolContent,
    },
    ...Array.from({ length: 6 }).map((_, index) => ({
      role: 'tool' as const,
      name: 'read_file',
      tool_call_id: `tool-budget-recent-${index}`,
      content: `recent raw ${index}`,
    })),
    { role: 'assistant' as const, content: '继续' },
  ];
  const projection = budget.projectMessagesForModelWithReport(messages);

  assert.equal(projection.replacementSummary.replacementCount, 1);
  assert.equal(projection.replacementSummary.replacements[0]?.reason, 'large_tool_result');
  assert.match(String(projection.messages[1]?.content || ''), /\.\.\.\[budgeted\]\.\.\./);
  assert.equal(messages[1]?.content, originalLargeToolContent);
});
