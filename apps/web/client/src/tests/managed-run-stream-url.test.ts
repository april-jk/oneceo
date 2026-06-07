import { describe, expect, it } from 'vitest';
import { resolveManagedRunStreamCursor } from '@/hooks/useTaskCreationAgent';
import { getTaskCreationManagedRunStreamUrl } from '@/lib/task-creation-client';

describe('managed run stream url', () => {
  it('includes authenticated user id for EventSource auth parity', () => {
    const url = getTaskCreationManagedRunStreamUrl('run-1', {
      afterSequence: 7,
      clientId: 'client-1',
      userId: 'user-1',
    });

    expect(url).toContain('/api/altus-managed/runs/run-1/stream');
    expect(url).toContain('afterSequence=7');
    expect(url).toContain('clientId=client-1');
    expect(url).toContain('userId=user-1');
  });

  it('omits blank user id', () => {
    const url = getTaskCreationManagedRunStreamUrl('run-2', {
      userId: '   ',
    });

    expect(url).not.toContain('userId=');
  });
});

describe('managed run stream cursor', () => {
  it('reuses the cursor only when reconnecting the same run', () => {
    expect(
      resolveManagedRunStreamCursor({
        cursorRunId: 'run-1',
        targetRunId: 'run-1',
        sequence: 7,
      })
    ).toEqual({
      afterSequence: 7,
      resetSequence: false,
    });
  });

  it('resets a previous run cursor before subscribing to a new run', () => {
    expect(
      resolveManagedRunStreamCursor({
        cursorRunId: 'run-1',
        targetRunId: 'run-2',
        sequence: 7,
      })
    ).toEqual({
      resetSequence: true,
    });
  });

  it('does not treat the server latest sequence as a client-consumed cursor', () => {
    expect(
      resolveManagedRunStreamCursor({
        cursorRunId: null,
        targetRunId: 'recovered-run',
        sequence: 2,
      })
    ).toEqual({
      resetSequence: true,
    });
  });
});
