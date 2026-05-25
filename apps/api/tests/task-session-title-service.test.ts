import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  deriveAutoSessionTitle,
  resolveDisplaySessionTitle,
} from '../src/services/task-session-title-service';

test('uses the first message prefix for non-explicit session titles', () => {
  assert.equal(deriveAutoSessionTitle('你好'), '你好');
  assert.equal(
    deriveAutoSessionTitle('这是一段没有明确动作词但用户希望保留为标题的普通开场描述'),
    '这是一段没有明确动作词但用户希望保留为标题的普通开场描述'
  );
});

test('keeps explicit session title normalization for task-like messages', () => {
  assert.equal(deriveAutoSessionTitle('帮我开发2048小游戏，使用html实现'), 'HTML 2048 小游戏');
  assert.equal(deriveAutoSessionTitle('请分析这个报错的根因'), '报错分析');
});

test('prefers a stored locked title over later first-message inference', () => {
  const resolved = resolveDisplaySessionTitle({
    storedTitle: '登录页双栏布局',
    storedTitleSource: 'first_user_input',
    storedTitleState: 'provisional',
    firstUserMessage: '后续又发了一条很长的消息但不应该改标题',
  });

  assert.equal(resolved.title, '登录页双栏布局');
  assert.equal(resolved.titleSource, 'first_user_input');
});
