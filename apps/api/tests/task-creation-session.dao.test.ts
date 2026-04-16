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

test('sanitizeTimelineMetadataForStorage normalizes workspace absolute paths to session-relative paths', () => {
  const sessionId = '11111111-1111-4111-8111-111111111111';
  const workspaceRoot = `/home/user/opencode/workspaces/${sessionId}`;
  const sanitized = (taskCreationSessionDAO as any).sanitizeTimelineMetadataForStorage(
    {
      workspacePath: workspaceRoot,
      filePaths: [
        `${workspaceRoot}/src/index.ts`,
        `workspaces/${sessionId}/README.md`,
        'src/index.ts',
        '../unsafe.ts',
      ],
      fileChanges: [
        { kind: 'update', path: `${workspaceRoot}/src/main.ts` },
        { kind: 'create', path: `workspaces/${sessionId}/docs/spec.md` },
        { kind: 'update', path: '../escape.ts' },
        { kind: 'delete' },
      ],
      path: `${workspaceRoot}/docs/guide.md`,
      targetPath: `workspaces/${sessionId}/docs/guide-next.md`,
    },
    sessionId
  );

  assert.deepEqual(sanitized.filePaths, ['src/index.ts', 'README.md']);
  assert.deepEqual(sanitized.fileChanges, [
    { kind: 'update', path: 'src/main.ts' },
    { kind: 'create', path: 'docs/spec.md' },
    { kind: 'update' },
    { kind: 'delete' },
  ]);
  assert.equal(sanitized.path, 'docs/guide.md');
  assert.equal(sanitized.targetPath, 'docs/guide-next.md');
});
