import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildOpencodeQuestionAnswers,
  findPendingOpencodeQuestion,
  type OpencodePendingQuestion,
} from '../src/services/opencode-question-adapter';

test('buildOpencodeQuestionAnswers keeps freeform text for unmatched questions and maps matched options', () => {
  const input = '使用nodejs + sqlite开发，创建/编辑/删除备忘录功能就可以，然后本地存储就行';
  const answers = buildOpencodeQuestionAnswers(
    [
      {
        header: '软件类型',
        question: '你想要什么类型的工程备忘录软件？',
        options: [{ label: 'Web 应用' }, { label: '桌面应用' }],
      },
      {
        header: '核心功能',
        question: '备忘录软件的主要功能有哪些？',
        multiple: true,
        options: [
          { label: '创建和编辑备忘录', description: '基础的笔记功能' },
          { label: '协作功能', description: '多人共享和编辑' },
          { label: '搜索功能', description: '快速查找备忘录' },
        ],
      },
      {
        header: '技术栈',
        question: '你倾向于使用什么技术栈？',
        options: [
          { label: 'JavaScript/TypeScript', description: 'Node.js, React, Vue 等' },
          { label: 'Python', description: 'Flask, Django, FastAPI 等' },
        ],
      },
    ],
    input
  );

  assert.deepEqual(answers, [
    [input],
    ['创建和编辑备忘录'],
    ['JavaScript/TypeScript'],
  ]);
});

test('buildOpencodeQuestionAnswers avoids weak multi-select matches from generic description fragments', () => {
  const input = '先做创建、编辑、删除备忘录，本地存储就行';
  const answers = buildOpencodeQuestionAnswers(
    [
      {
        header: '核心功能',
        question: '备忘录软件的主要功能有哪些？',
        multiple: true,
        options: [
          { label: '创建和编辑备忘录', description: '基础的笔记功能' },
          { label: '协作功能', description: '多人共享和编辑' },
          { label: '搜索功能', description: '快速查找备忘录' },
        ],
      },
    ],
    input
  );

  assert.deepEqual(answers, [['创建和编辑备忘录']]);
});

test('buildOpencodeQuestionAnswers falls back to raw user text when there are no options', () => {
  const input = '本地单机版就行';
  const answers = buildOpencodeQuestionAnswers(
    [
      {
        question: '还有其他补充要求吗？',
      },
    ],
    input
  );

  assert.deepEqual(answers, [[input]]);
});

test('findPendingOpencodeQuestion prefers the latest question for the active opencode session', () => {
  const questions: OpencodePendingQuestion[] = [
    {
      id: 'que_old',
      sessionID: 'ses_old',
    },
    {
      id: 'que_target_1',
      sessionID: 'ses_target',
    },
    {
      id: 'que_target_2',
      sessionID: 'ses_target',
    },
  ];

  const found = findPendingOpencodeQuestion(questions, 'ses_target');

  assert.equal(found?.id, 'que_target_2');
});
