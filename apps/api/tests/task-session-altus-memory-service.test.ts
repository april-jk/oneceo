import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { e2bConnector } from '../src/connectors/e2b-connector';
import { taskCreationSessionDAO } from '../src/db/dao/task-creation-session.dao';
import { taskSessionRedisCacheService } from '../src/services/task-session-redis-cache-service';
import {
  TaskSessionAltusMemoryService,
  readSessionAltusMemory,
} from '../src/services/task-session-altus-memory-service';

afterEach(() => {
  mock.reset();
});

test('getSessionAltusMemory migrates empty metadata to normalized state', async () => {
  const service = new TaskSessionAltusMemoryService();

  mock.method(taskSessionRedisCacheService, 'resolveScopeBySession', async () => null as any);
  mock.method(taskCreationSessionDAO, 'getSessionMetadataJson', async () => ({
    altusSessionMemory: {
      version: 2,
      summary: {
        goal: 'keep the user-level profile stable',
        latestOutcome: 'project memory was added',
        openQuestions: ['should this stay concise?'],
      },
      constraints: ['must not add local file persistence'],
      decisions: ['db remains source of truth'],
      workingNotes: ['next: wire prompt assembly'],
    },
  }));

  const state = await service.getSessionAltusMemory('session-altus-1');
  assert.equal(state.version, 2);
  assert.equal(state.summary.goal, 'keep the user-level profile stable');
  assert.deepEqual(state.constraints, ['must not add local file persistence']);
});

test('saveSandboxFileMemoryToDb updates summary snapshot and increments version', async () => {
  const service = new TaskSessionAltusMemoryService();
  let savedPatch: Record<string, unknown> | null = null;

  mock.method(taskSessionRedisCacheService, 'resolveScopeBySession', async () => null as any);
  mock.method(taskCreationSessionDAO, 'getSessionMetadataJson', async () => ({
    altusSessionMemory: {
      version: 1,
      summary: {
        goal: '',
        latestOutcome: '',
        openQuestions: [],
      },
      constraints: [],
      decisions: [],
      workingNotes: [],
    },
  }));
  mock.method(taskCreationSessionDAO, 'getRecentMessages', async () => [
    {
      role: 'user',
      messageType: 'user_input',
      content: '请继续优化 skills 的多轮记忆逻辑',
    },
    {
      role: 'assistant',
      messageType: 'assistant',
      content: '已完成用户级和项目级记忆设计收口。',
    },
  ] as any);
  mock.method(taskCreationSessionDAO, 'patchSessionMetadataJson', async (_sessionId, patch) => {
    savedPatch = patch;
    return null as any;
  });
  mock.method(e2bConnector, 'readFile', async () =>
    JSON.stringify({
      version: 1,
      sessionId: 'session-altus-2',
      snapshotVersion: 3,
      updatedAt: '2026-04-21T10:30:00.000Z',
      summary: {
        goal: '',
        latestOutcome: '',
        openQuestions: [],
      },
      constraints: ['遵守现有 skills memory 复杂度边界'],
      decisions: ['用户级和项目级采用 DB + Redis'],
      workingNotes: ['待补 e2e'],
      sandboxMaterialization: {
        snapshotVersion: 3,
        lastSandboxId: 'sandbox-2',
        lastSyncedAt: '2026-04-21T10:30:00.000Z',
      },
      lastWriterRunId: 'run-2',
    })
  );

  const state = await service.saveSandboxFileMemoryToDb({
    sessionId: 'session-altus-2',
    sandboxId: 'sandbox-2',
    workspaceRoot: '/workspace/session-altus-2',
    archiveId: 'snapshot-2',
    runId: 'run-2',
    reason: 'completed',
  });

  const normalized = readSessionAltusMemory((savedPatch || {}).altusSessionMemory);
  assert.equal(state.version, 4);
  assert.equal(normalized.summary.goal, '请继续优化 skills 的多轮记忆逻辑');
  assert.equal(normalized.summary.latestOutcome, '已完成用户级和项目级记忆设计收口。');
  assert.deepEqual(normalized.constraints, ['遵守现有 skills memory 复杂度边界']);
  assert.equal(normalized.fileMemorySnapshot.archiveId, 'snapshot-2');
});

test('saveTimelineDerivedMemory increments version without sandbox file and records working notes', async () => {
  const service = new TaskSessionAltusMemoryService();
  let savedPatch: Record<string, unknown> | null = null;

  mock.method(taskSessionRedisCacheService, 'resolveScopeBySession', async () => null as any);
  mock.method(taskCreationSessionDAO, 'getSessionMetadataJson', async () => ({
    altusSessionMemory: {
      version: 0,
      summary: {
        goal: '',
        latestOutcome: '',
        openQuestions: [],
      },
      constraints: [],
      decisions: [],
      workingNotes: [],
    },
  }));
  mock.method(taskCreationSessionDAO, 'getRecentMessages', async () => [
    {
      role: 'user',
      messageType: 'user_input',
      content: '请告诉我当前项目代号，并按用户偏好称呼我',
    },
    {
      role: 'assistant',
      messageType: 'assistant',
      content: 'MemoryUser，你当前项目代号是 MemoryProject-001。',
    },
  ] as any);
  mock.method(taskCreationSessionDAO, 'patchSessionMetadataJson', async (_sessionId, patch) => {
    savedPatch = patch;
    return null as any;
  });

  const state = await service.saveTimelineDerivedMemory({
    sessionId: 'session-altus-3',
    runId: 'run-3',
    reason: 'completed',
  });

  const normalized = readSessionAltusMemory((savedPatch || {}).altusSessionMemory);
  assert.equal(state.version, 1);
  assert.equal(normalized.summary.goal, '请告诉我当前项目代号，并按用户偏好称呼我');
  assert.equal(normalized.summary.latestOutcome, 'MemoryUser，你当前项目代号是 MemoryProject-001。');
  assert.deepEqual(normalized.workingNotes, [
    'user: 请告诉我当前项目代号，并按用户偏好称呼我',
    'assistant: MemoryUser，你当前项目代号是 MemoryProject-001。',
  ]);
});

test('saveSandboxFileMemoryToDb falls back to timeline-derived memory when sandbox file is missing', async () => {
  const service = new TaskSessionAltusMemoryService();
  let savedPatch: Record<string, unknown> | null = null;

  mock.method(taskSessionRedisCacheService, 'resolveScopeBySession', async () => null as any);
  mock.method(taskCreationSessionDAO, 'getSessionMetadataJson', async () => ({
    altusSessionMemory: {
      version: 0,
      summary: {
        goal: '',
        latestOutcome: '',
        openQuestions: [],
      },
      constraints: [],
      decisions: [],
      workingNotes: [],
    },
  }));
  mock.method(taskCreationSessionDAO, 'getRecentMessages', async () => [
    {
      role: 'user',
      messageType: 'user_input',
      content: '请继续保持当前项目记忆',
    },
    {
      role: 'assistant',
      messageType: 'assistant',
      content: '好的，我会继续沿用当前项目记忆。',
    },
  ] as any);
  mock.method(taskCreationSessionDAO, 'patchSessionMetadataJson', async (_sessionId, patch) => {
    savedPatch = patch;
    return null as any;
  });
  mock.method(e2bConnector, 'readFile', async () => {
    throw new Error('not found');
  });

  const state = await service.saveSandboxFileMemoryToDb({
    sessionId: 'session-altus-4',
    sandboxId: 'sandbox-4',
    workspaceRoot: '/workspace/session-altus-4',
    runId: 'run-4',
    reason: 'completed',
  });

  const normalized = readSessionAltusMemory((savedPatch || {}).altusSessionMemory);
  assert.equal(state.version, 1);
  assert.equal(normalized.summary.goal, '请继续保持当前项目记忆');
  assert.equal(normalized.summary.latestOutcome, '好的，我会继续沿用当前项目记忆。');
});
