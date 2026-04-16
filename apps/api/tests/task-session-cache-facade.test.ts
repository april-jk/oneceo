import test from 'node:test';
import assert from 'node:assert/strict';

import { TaskSessionCacheFacade } from '../src/services/task-session-cache-facade';

function createMockRedisCache(isEnabled: boolean) {
  const calls: string[] = [];
  return {
    calls,
    service: {
      isEnabled: () => isEnabled,
      async getRecentMessagesPage() {
        calls.push('getRecentMessagesPage');
        return { ok: true };
      },
      async setRecentMessagesPage() {
        calls.push('setRecentMessagesPage');
      },
      async setHistoryCursor() {
        calls.push('setHistoryCursor');
      },
      async getWorkspaceDir() {
        calls.push('getWorkspaceDir');
        return { ok: true };
      },
      async setWorkspaceDir() {
        calls.push('setWorkspaceDir');
      },
      async getWorkspaceTree() {
        calls.push('getWorkspaceTree');
        return { ok: true };
      },
      async setWorkspaceTree() {
        calls.push('setWorkspaceTree');
      },
      async getWorkspaceFile() {
        calls.push('getWorkspaceFile');
        return { ok: true };
      },
      async setWorkspaceFile() {
        calls.push('setWorkspaceFile');
      },
      async invalidateWorkspaceBySessionId() {
        calls.push('invalidateWorkspaceBySessionId');
      },
      async listSessionEvents() {
        calls.push('listSessionEvents');
        return [{ eventId: 1 }];
      },
    },
  };
}

test('TaskSessionCacheFacade skips redis calls in no_redis mode', async () => {
  const mock = createMockRedisCache(false);
  const facade = new TaskSessionCacheFacade(mock.service as any);

  const recent = await facade.getRecentMessagesPage({ userId: 'u', sessionId: 's' });
  assert.equal(recent, null);
  await facade.setRecentMessagesPage({ userId: 'u', sessionId: 's', payload: {} });
  await facade.setHistoryCursor({ userId: 'u', sessionId: 's', newestCursor: 1 });
  await facade.invalidateWorkspaceBySessionId('s');
  const events = await facade.listSessionEvents({ userId: 'u', sessionId: 's', afterEventId: 1 });
  assert.deepEqual(events, []);

  assert.deepEqual(mock.calls, []);
});

test('TaskSessionCacheFacade delegates to redis service when enabled', async () => {
  const mock = createMockRedisCache(true);
  const facade = new TaskSessionCacheFacade(mock.service as any);

  const recent = await facade.getRecentMessagesPage({ userId: 'u', sessionId: 's' });
  assert.deepEqual(recent, { ok: true });
  await facade.setRecentMessagesPage({ userId: 'u', sessionId: 's', payload: {} });
  await facade.setHistoryCursor({ userId: 'u', sessionId: 's', newestCursor: 1 });
  await facade.invalidateWorkspaceBySessionId('s');
  const events = await facade.listSessionEvents({ userId: 'u', sessionId: 's', afterEventId: 1 });
  assert.deepEqual(events, [{ eventId: 1 }]);

  assert.deepEqual(mock.calls, [
    'getRecentMessagesPage',
    'setRecentMessagesPage',
    'setHistoryCursor',
    'invalidateWorkspaceBySessionId',
    'listSessionEvents',
  ]);
});
