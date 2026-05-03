import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AltusManagedContextCacheObserver } from '../src/services/altus-managed-context-cache-observer';
import { AltusManagedContextDebugSummaryService } from '../src/services/altus-managed-context-debug-summary-service';
import { AltusManagedContextLedgerAdapter } from '../src/services/altus-managed-context-ledger-adapter';
import { AltusManagedContextRecoveryService } from '../src/services/altus-managed-context-recovery-service';
import { AltusManagedTurnSnapshotService } from '../src/services/altus-managed-turn-snapshot-service';

const ARTIFACT_QUESTION = '这次要交付的是网页应用、后端 API、本地脚本，还是完整业务系统？';

function buildRecovery(messages: any[], runEvents: any[] = []) {
  const ledger = new AltusManagedContextLedgerAdapter().buildFromRecords({
    sessionId: 'session-context-behavior',
    runId: null,
    messages,
    runEvents,
  });
  return new AltusManagedContextRecoveryService().rebuildFromLedger({ ledger });
}

function buildSummary(messages: any[], runEvents: any[] = []) {
  const recovery = buildRecovery(messages, runEvents);
  const snapshot = new AltusManagedTurnSnapshotService().createReadOnlySnapshot({
    sessionId: recovery.ledger.sessionId,
    runId: recovery.ledger.runId || null,
  });
  const cacheObservation = new AltusManagedContextCacheObserver().buildObservation({
    ledger: recovery.ledger,
    manifest: recovery.manifest,
    snapshot,
    apiMessages: recovery.compiled.messages,
  });
  return {
    recovery,
    summary: new AltusManagedContextDebugSummaryService().buildSummary({
      recovery,
      cacheObservation,
    }),
  };
}

test('context behavior closes answered artifact clarification and keeps it in compiled context once', () => {
  const { recovery, summary } = buildSummary([
    {
      role: 'user',
      content: '帮我做一个管理后台系统',
      messageType: 'user_input',
      messageKey: 'user-1',
      timelineCursor: 1,
    },
    {
      role: 'agent',
      content: ARTIFACT_QUESTION,
      messageType: 'clarification_request',
      messageKey: 'clarification-1',
      timelineCursor: 2,
      metadata: {
        runId: 'run-clarification-1',
        toolCallId: 'tool-ask-1',
        clarificationType: 'artifact_type',
      },
    },
    {
      role: 'user',
      content: '网页应用',
      messageType: 'clarification_answer',
      messageKey: 'answer-1',
      timelineCursor: 3,
      metadata: {
        runId: 'run-answer-1',
        clarificationAnswer: true,
        clarificationToolCallId: 'tool-ask-1',
      },
    },
  ]);

  assert.deepEqual(summary.clarification.pending, []);
  assert.equal(summary.clarification.answered.length, 1);
  assert.equal(summary.clarification.answered[0]?.question, ARTIFACT_QUESTION);
  assert.equal(summary.clarification.answered[0]?.answer, '网页应用');
  assert.equal(summary.clarification.answered[0]?.closed, true);
  assert.deepEqual(summary.clarification.duplicates, []);
  assert.deepEqual(summary.recentIntent, ['帮我做一个管理后台系统', '网页应用']);
  assert.equal(
    recovery.compiled.messages.filter((message) => message.content === ARTIFACT_QUESTION).length,
    1
  );
});

test('context behavior preserves vague follow-up as continuation instead of reopening old clarification', () => {
  const { recovery, summary } = buildSummary([
    {
      role: 'user',
      content: '帮我做一个管理后台系统',
      messageType: 'user_input',
      messageKey: 'user-1',
      timelineCursor: 1,
    },
    {
      role: 'agent',
      content: ARTIFACT_QUESTION,
      messageType: 'clarification_request',
      messageKey: 'clarification-1',
      timelineCursor: 2,
    },
    {
      role: 'user',
      content: '网页应用',
      messageType: 'clarification_answer',
      messageKey: 'answer-1',
      timelineCursor: 3,
      metadata: { clarificationAnswer: true },
    },
    {
      role: 'agent',
      content: 'watson，已为你完成一个基础管理后台系统的网页应用。',
      messageType: 'assistant_message',
      messageKey: 'assistant-final-1',
      timelineCursor: 4,
    },
    {
      role: 'user',
      content: '按你的想法，先帮我做个方案',
      messageType: 'user_input',
      messageKey: 'user-followup-1',
      timelineCursor: 5,
    },
  ]);

  assert.deepEqual(summary.clarification.pending, []);
  assert.deepEqual(summary.recentIntent, ['帮我做一个管理后台系统', '网页应用', '按你的想法，先帮我做个方案']);
  assert.equal(
    recovery.compiled.messages.filter((message) => message.content === ARTIFACT_QUESTION).length,
    1
  );
  assert.equal(
    recovery.compiled.messages.some((message) => message.content === '按你的想法，先帮我做个方案'),
    true
  );
});

test('context behavior surfaces duplicate clarification if the same boundary is asked twice', () => {
  const { summary } = buildSummary([
    {
      role: 'user',
      content: '帮我做一个管理后台系统',
      messageType: 'user_input',
      messageKey: 'user-1',
      timelineCursor: 1,
    },
    {
      role: 'agent',
      content: ARTIFACT_QUESTION,
      messageType: 'clarification_request',
      messageKey: 'clarification-1',
      timelineCursor: 2,
    },
    {
      role: 'user',
      content: '网页应用',
      messageType: 'clarification_answer',
      messageKey: 'answer-1',
      timelineCursor: 3,
      metadata: { clarificationAnswer: true },
    },
    {
      role: 'agent',
      content: ARTIFACT_QUESTION,
      messageType: 'clarification_request',
      messageKey: 'clarification-2',
      timelineCursor: 4,
    },
  ]);

  assert.deepEqual(summary.clarification.duplicates, [{ question: ARTIFACT_QUESTION, count: 2 }]);
  assert.deepEqual(summary.clarification.pending, [
    {
      question: ARTIFACT_QUESTION,
      toolUseId: null,
      runId: null,
    },
  ]);
});

test('context behavior records explicit target override as a later user intent', () => {
  const { summary } = buildSummary([
    {
      role: 'user',
      content: '帮我做一个管理后台系统',
      messageType: 'user_input',
      messageKey: 'user-1',
      timelineCursor: 1,
    },
    {
      role: 'agent',
      content: ARTIFACT_QUESTION,
      messageType: 'clarification_request',
      messageKey: 'clarification-1',
      timelineCursor: 2,
    },
    {
      role: 'user',
      content: '网页应用',
      messageType: 'clarification_answer',
      messageKey: 'answer-1',
      timelineCursor: 3,
      metadata: { clarificationAnswer: true },
    },
    {
      role: 'user',
      content: '不要网页了，改成本地脚本',
      messageType: 'user_input',
      messageKey: 'user-override-1',
      timelineCursor: 4,
    },
  ]);

  assert.deepEqual(summary.clarification.pending, []);
  assert.deepEqual(summary.recentIntent, ['帮我做一个管理后台系统', '网页应用', '不要网页了，改成本地脚本']);
});
