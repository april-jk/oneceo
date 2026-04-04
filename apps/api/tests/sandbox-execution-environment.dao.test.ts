import assert from 'node:assert/strict';
import { test } from 'node:test';
import { db } from '../src/config/database';
import {
  pickCanonicalTaskSessionEnvironment,
  sandboxExecutionEnvironmentDAO,
} from '../src/db/dao/sandbox-execution-environment.dao';

test('pickCanonicalTaskSessionEnvironment prefers active environment over newer deduped closed record', () => {
  const picked = pickCanonicalTaskSessionEnvironment([
    {
      status: 'closed',
      metadata: {
        taskSessionId: 'task-1',
        dedupeReplacementSandboxId: 'sandbox-active',
      },
      createdAt: '2026-04-04T00:00:00.000Z',
      updatedAt: '2026-04-04T00:10:00.000Z',
    },
    {
      status: 'ready',
      metadata: {
        taskSessionId: 'task-1',
      },
      createdAt: '2026-04-04T00:05:00.000Z',
      updatedAt: '2026-04-04T00:06:00.000Z',
    },
  ]);

  assert.ok(picked);
  assert.equal(picked?.status, 'ready');
  assert.equal((picked?.metadata || {}).dedupeReplacementSandboxId, undefined);
});

test('pickCanonicalTaskSessionEnvironment prefers latest active record when multiple active environments exist', () => {
  const picked = pickCanonicalTaskSessionEnvironment([
    {
      status: 'ready',
      metadata: {
        taskSessionId: 'task-1',
      },
      createdAt: '2026-04-04T00:00:00.000Z',
      updatedAt: '2026-04-04T00:02:00.000Z',
    },
    {
      status: 'creating',
      metadata: {
        taskSessionId: 'task-1',
      },
      createdAt: '2026-04-04T00:05:00.000Z',
      updatedAt: '2026-04-04T00:06:00.000Z',
    },
  ]);

  assert.ok(picked);
  assert.equal(picked?.status, 'ready');
});

test('pickCanonicalTaskSessionEnvironment falls back to latest non-deduped closed record when no active environment exists', () => {
  const picked = pickCanonicalTaskSessionEnvironment([
    {
      status: 'closed',
      metadata: {
        taskSessionId: 'task-1',
        dedupeReplacementSandboxId: 'sandbox-next',
      },
      createdAt: '2026-04-04T00:00:00.000Z',
      updatedAt: '2026-04-04T00:10:00.000Z',
    },
    {
      status: 'closed',
      metadata: {
        taskSessionId: 'task-1',
      },
      createdAt: '2026-04-04T00:03:00.000Z',
      updatedAt: '2026-04-04T00:04:00.000Z',
    },
  ]);

  assert.ok(picked);
  assert.equal(picked?.status, 'closed');
  assert.equal((picked?.metadata || {}).dedupeReplacementSandboxId, undefined);
});

test('findCanonicalByTaskSessionId queries canonical row directly instead of truncating a 200-row history list', async () => {
  const dbAny = db as any;
  const daoAny = sandboxExecutionEnvironmentDAO as any;
  const originalSelect = dbAny.select;
  const originalListByTaskSessionId = daoAny.listByTaskSessionId;
  const expectedRow = {
    sessionId: 'sandbox-active',
    status: 'ready',
    metadata: {
      taskSessionId: 'task-1',
    },
  };
  let capturedLimit = 0;
  let orderByCount = 0;

  dbAny.select = () => ({
    from() {
      return this;
    },
    where() {
      return this;
    },
    orderBy(...args: unknown[]) {
      orderByCount = args.length;
      return this;
    },
    limit(limit: number) {
      capturedLimit = limit;
      return Promise.resolve([expectedRow]);
    },
  });
  daoAny.listByTaskSessionId = async () => {
    throw new Error('findCanonicalByTaskSessionId should not call listByTaskSessionId');
  };

  try {
    const row = await sandboxExecutionEnvironmentDAO.findCanonicalByTaskSessionId('task-1');
    assert.deepEqual(row, expectedRow);
    assert.equal(capturedLimit, 1);
    assert.equal(orderByCount, 3);
  } finally {
    dbAny.select = originalSelect;
    daoAny.listByTaskSessionId = originalListByTaskSessionId;
  }
});
