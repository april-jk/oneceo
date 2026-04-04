import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pickCanonicalTaskSessionEnvironment } from '../src/db/dao/sandbox-execution-environment.dao';

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
