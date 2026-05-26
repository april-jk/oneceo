import { describe, expect, it } from 'vitest';
import {
  buildBoundSessionRoute,
  resolveChatInputSessionId,
  resolveSessionRouteState,
  shouldDeferPendingSessionRouteSync,
} from '@/hooks/useTaskCreationAgent';

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

  it('parses managed route state from path and search', () => {
    expect(
      resolveSessionRouteState({
        locationPath: '/session/session-path',
        search: '?foo=1',
      })
    ).toEqual({
      querySessionId: '',
      createNewToken: '',
      pathSessionId: 'session-path',
      resolvedSessionId: 'session-path',
    });
  });

  it('defers pending session sync while url still carries new token', () => {
    expect(
      shouldDeferPendingSessionRouteSync({
        pendingSessionId: 'session-1',
        locationPath: '/new-task',
        search: '?new=1',
      })
    ).toBe(true);
  });

  it('defers pending session sync until path settles onto target session without legacy query', () => {
    expect(
      shouldDeferPendingSessionRouteSync({
        pendingSessionId: 'session-1',
        locationPath: '/session/session-1',
        search: '?sessionId=session-1',
      })
    ).toBe(true);
  });

  it('allows pending session sync to clear once path matches target session and query is clean', () => {
    expect(
      shouldDeferPendingSessionRouteSync({
        pendingSessionId: 'session-1',
        locationPath: '/session/session-1',
        search: '',
      })
    ).toBe(false);
  });

  it('builds canonical bound session route and strips creation-only query params', () => {
    expect(
      buildBoundSessionRoute({
        sessionId: 'session 1',
        search: '?new=123&sessionId=old-session&projectId=project-1',
      })
    ).toBe('/session/session%201?projectId=project-1');
  });
});
