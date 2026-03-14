import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  hasRenderableAssistantReply,
  normalizeOpencodeNativeMessages,
  pickRecoveredOpencodeSessionId,
} from '../src/utils/opencode-history-recovery';

const CONTEXT = {
  taskSessionId: 'task-123',
  orchestratorSessionId: 'orch-123',
  opencodeSessionId: 'ses-123',
  workspacePath: '/home/user/opencode/workspaces/task-123',
} as const;

test('pickRecoveredOpencodeSessionId prefers explicitly bound session when still present', () => {
  const sessionId = pickRecoveredOpencodeSessionId(
    [
      {
        id: 'ses-older',
        directory: '/home/user/opencode/workspaces/task-123',
        createdAt: '2026-03-13T09:00:00.000Z',
      },
      {
        id: 'ses-bound',
        directory: '/home/user/opencode/workspaces/another-task',
        createdAt: '2026-03-13T09:10:00.000Z',
      },
    ],
    CONTEXT.workspacePath,
    'ses-bound'
  );

  assert.equal(sessionId, 'ses-bound');
});

test('pickRecoveredOpencodeSessionId selects latest session under the same workspace', () => {
  const sessionId = pickRecoveredOpencodeSessionId(
    [
      {
        id: 'ses-old',
        directory: '/home/user/opencode/workspaces/task-123',
        createdAt: '2026-03-13T09:00:00.000Z',
      },
      {
        id: 'ses-ignore',
        directory: '/home/user/opencode/workspaces/other-task',
        createdAt: '2026-03-13T11:00:00.000Z',
      },
      {
        id: 'ses-new',
        info: {
          path: {
            cwd: '/home/user/opencode/workspaces/task-123/',
          },
          time: {
            updated: '2026-03-13T10:30:00.000Z',
          },
        },
      },
    ],
    CONTEXT.workspacePath
  );

  assert.equal(sessionId, 'ses-new');
});

test('normalizeOpencodeNativeMessages maps user, tool, and final assistant text', () => {
  const messages = normalizeOpencodeNativeMessages(
    [
      {
        id: 'msg-user',
        info: {
          id: 'msg-user',
          role: 'user',
          time: {
            created: '2026-03-13T09:00:00.000Z',
          },
        },
        parts: [{ type: 'text', text: '请帮我部署这个网站' }],
      },
      {
        id: 'msg-assistant',
        info: {
          id: 'msg-assistant',
          role: 'assistant',
          time: {
            created: '2026-03-13T09:00:05.000Z',
          },
        },
        parts: [
          {
            id: 'tool-1',
            type: 'tool',
            tool: 'deploy',
            state: {
              status: 'completed',
            },
          },
          {
            id: 'text-1',
            type: 'text',
            text: '部署已经完成',
          },
        ],
      },
    ],
    CONTEXT
  );

  assert.equal(messages.length, 3);

  assert.deepEqual(
    messages.map((item) => ({
      role: item.role,
      messageType: item.messageType,
      content: item.content,
    })),
    [
      {
        role: 'user',
        messageType: 'opencode_user_input',
        content: '请帮我部署这个网站',
      },
      {
        role: 'agent',
        messageType: 'opencode_event',
        content: '[Tool] deploy · completed',
      },
      {
        role: 'agent',
        messageType: 'opencode_event',
        content: '部署已经完成',
      },
    ]
  );

  assert.equal(messages[0]?.metadata?.source, 'opencode_native_history');
  assert.equal(messages[1]?.metadata?.eventType, 'message.part.updated');
  assert.equal(messages[2]?.metadata?.eventType, 'message.final');
  assert.ok(String(messages[2]?.id || '').includes('text-1'));
});

test('normalizeOpencodeNativeMessages falls back to content when assistant message has no text parts', () => {
  const messages = normalizeOpencodeNativeMessages(
    [
      {
        id: 'msg-assistant',
        role: 'assistant',
        createdAt: '2026-03-13T09:10:00.000Z',
        content: '这是回放的最终文本',
      },
    ],
    CONTEXT
  );

  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.messageType, 'opencode_event');
  assert.equal(messages[0]?.content, '这是回放的最终文本');
  assert.equal(messages[0]?.metadata?.eventType, 'message.final');
});

test('hasRenderableAssistantReply returns false for native history with only user input', () => {
  assert.equal(
    hasRenderableAssistantReply([
      {
        role: 'user',
        messageType: 'opencode_user_input',
        content: '帮我开发2048小游戏',
      },
    ]),
    false
  );
});

test('hasRenderableAssistantReply returns true when assistant text is present', () => {
  assert.equal(
    hasRenderableAssistantReply([
      {
        role: 'user',
        messageType: 'opencode_user_input',
        content: '帮我开发2048小游戏',
      },
      {
        role: 'agent',
        messageType: 'opencode_event',
        content: '我会先搭建基础 HTML/CSS/JS 文件。',
      },
    ]),
    true
  );
});
