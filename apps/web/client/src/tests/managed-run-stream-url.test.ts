import { describe, expect, it } from 'vitest';
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
