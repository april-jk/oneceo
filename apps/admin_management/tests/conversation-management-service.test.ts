import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConversationManagementService } from '../server/services/conversation-management-service';

function createService(oneceoApiOverrides: Record<string, unknown> = {}) {
  const oneceoApi = {
    listTaskCreationSessions: async (_limit: number) => [],
    ...oneceoApiOverrides,
  } as any;
  const kvmConnector = {} as any;
  return new ConversationManagementService(oneceoApi, kvmConnector);
}

test('listSessions returns normalized items from oneceo api', async () => {
  const service = createService({
    listTaskCreationSessions: async () => [
      {
        id: 's-1',
        title: '会话1',
        status: 'in_progress',
        stage: 'collecting',
        pendingQuestion: 'q1',
        pendingOptions: ['a', 'b'],
        createdAt: '2026-04-07T00:00:00.000Z',
        updatedAt: '2026-04-07T00:01:00.000Z',
      },
    ],
  });

  const result = await service.listSessions(20);
  assert.equal(result.total, 1);
  assert.equal(result.sessions[0]?.id, 's-1');
  assert.equal(result.sessions[0]?.title, '会话1');
});

test('listSessions throws upstream error instead of falling back to local memory', async () => {
  const service = createService({
    listTaskCreationSessions: async () => {
      throw new Error('upstream unavailable');
    },
  });

  await assert.rejects(async () => {
    await service.listSessions(20);
  }, /upstream unavailable/);
});

