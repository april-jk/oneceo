import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { taskCreationSessionDAO } from '../src/db/dao';
import { managedImageObjectService } from '../src/services/managed-image-object-service';
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

test('buildConversationMessages converts image attachments into multimodal user content', async () => {
  mock.method(taskCreationSessionDAO, 'getMessages', async () => [
    {
      role: 'user',
      messageType: 'user_input',
      content: '看看这个图讲了什么\n\n[Attached: screenshot.png -> uploads/screenshot.png]',
      metadata: {
        attachments: [
          {
            name: 'screenshot.png',
            path: 'uploads/screenshot.png',
            size: 128,
            mimeType: 'image/png',
            externalObjectKey: 'managed-images/session-1/msg-1/screenshot.png',
          },
        ],
      },
    },
  ] as any);
  mock.method(
    managedImageObjectService,
    'getSignedDownloadUrl',
    async () => 'https://images.example.com/signed/screenshot.png?token=abc'
  );

  const service = new AltusManagedSetupService();
  const messages = await service.buildConversationMessages(
    'session-1',
    '看看这个图讲了什么\n\n[Attached: screenshot.png -> uploads/screenshot.png]',
    'SYSTEM PROMPT'
  );

  const userMessages = messages.filter((item) => item.role === 'user');
  assert.equal(userMessages.length, 1);
  assert.ok(Array.isArray(userMessages[0]?.content));
  const parts = userMessages[0]?.content as Array<any>;
  assert.equal(parts[0]?.type, 'text');
  assert.match(String(parts[0]?.text), /看看这个图讲了什么/);
  assert.equal(parts[1]?.type, 'image_url');
  assert.equal(parts[1]?.image_url?.url, 'https://images.example.com/signed/screenshot.png?token=abc');
});
