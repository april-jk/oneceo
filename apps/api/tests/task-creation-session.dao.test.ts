import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { taskCreationSessionDAO } from '../src/db/dao';

afterEach(() => {
  mock.reset();
});

test('sanitizeTimelineMetadataForStorage preserves attachment metadata needed for managed multimodal replay', () => {
  const sanitized = (taskCreationSessionDAO as any).sanitizeTimelineMetadataForStorage({
    messageKey: 'msg-1',
    runId: 'run-1',
    attachments: [
      {
        name: 'screenshot.png',
        path: 'uploads/screenshot.png',
        mimeType: 'image/png',
        externalObjectKey: 'managed-images/session-1/msg-1/screenshot.png',
      },
    ],
    attachmentContext: [
      {
        name: 'notes.md',
        path: 'uploads/notes.md',
        excerpt: '# Hello',
      },
    ],
    attachmentContextIncluded: true,
    originalInput: '这是个什么图片',
    question: '请补充信息',
    options: ['A', 'B'],
    unsafeField: 'drop-me',
  });

  assert.deepEqual(sanitized, {
    messageKey: 'msg-1',
    runId: 'run-1',
    attachments: [
      {
        name: 'screenshot.png',
        path: 'uploads/screenshot.png',
        mimeType: 'image/png',
        externalObjectKey: 'managed-images/session-1/msg-1/screenshot.png',
      },
    ],
    attachmentContext: [
      {
        name: 'notes.md',
        path: 'uploads/notes.md',
        excerpt: '# Hello',
      },
    ],
    attachmentContextIncluded: true,
    originalInput: '这是个什么图片',
    question: '请补充信息',
    options: ['A', 'B'],
  });
});
