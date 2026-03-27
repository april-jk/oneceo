import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { taskCreationSessionDAO } from '../src/db/dao';
import { AltusManagedSetupService } from '../src/services/altus-managed-setup-service';

afterEach(() => {
  mock.reset();
});

test('buildConversationMessages injects attachment context and avoids duplicating current user input', async () => {
  mock.method(taskCreationSessionDAO, 'getMessages', async () => [
    {
      role: 'user',
      messageType: 'user_input',
      content: '请查看附件',
      metadata: {
        attachmentContext: [
          {
            name: 'notes.md',
            path: 'uploads/notes.md',
            size: 12,
            mimeType: 'text/markdown',
            excerpt: '# Important notes',
            truncated: false,
            extractedAt: '2026-03-27T00:00:00.000Z',
          },
        ],
      },
    },
  ] as any);

  const service = new AltusManagedSetupService();
  const messages = await service.buildConversationMessages('session-1', '请查看附件', 'SYSTEM PROMPT');

  assert.equal(messages[0]?.role, 'system');
  assert.equal(messages[0]?.content, 'SYSTEM PROMPT');
  assert.equal(messages[1]?.role, 'system');
  assert.match(String(messages[1]?.content), /uploads\/notes\.md/);
  assert.match(String(messages[1]?.content), /# Important notes/);

  const userMessages = messages.filter((item) => item.role === 'user');
  assert.equal(userMessages.length, 1);
  assert.equal(userMessages[0]?.content, '请查看附件');
});
