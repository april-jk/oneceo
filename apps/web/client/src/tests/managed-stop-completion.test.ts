import { describe, expect, it } from 'vitest';
import { isManagedRunTerminalStatus } from '@/hooks/useTaskCreationAgent';

describe('managed stop completion', () => {
  it.each(['stopped', 'completed', 'failed', 'cancelled'])(
    'accepts server terminal status %s',
    (status) => {
      expect(isManagedRunTerminalStatus(status)).toBe(true);
    }
  );

  it.each(['queued', 'starting', 'running', 'streaming', 'waiting_tool', 'waiting_user', null])(
    'keeps the composer locked for non-terminal status %s',
    (status) => {
      expect(isManagedRunTerminalStatus(status)).toBe(false);
    }
  );
});
