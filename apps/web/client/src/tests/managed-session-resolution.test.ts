import { describe, expect, it } from 'vitest';
import { resolveChatInputSessionId } from '@/hooks/useTaskCreationAgent';

describe('managed chat session resolution', () => {
  it('prefers explicit requested session id', () => {
    expect(
      resolveChatInputSessionId({
        requestedSessionId: 'session-explicit',
        currentSessionId: 'session-current',
        locationPath: '/session/session-path',
      })
    ).toBe('session-explicit');
  });

  it('uses current session state before path session', () => {
    expect(
      resolveChatInputSessionId({
        currentSessionId: 'session-current',
        locationPath: '/session/session-path',
      })
    ).toBe('session-current');
  });

  it('uses path session when current state is empty', () => {
    expect(
      resolveChatInputSessionId({
        currentSessionId: '',
        locationPath: '/session/session-path?view=history',
      })
    ).toBe('session-path');
  });

  it('does not fall back to a stale local session when creating a new chat', () => {
    expect(
      resolveChatInputSessionId({
        currentSessionId: '',
        locationPath: '/new-task',
      })
    ).toBe('');
  });
});
