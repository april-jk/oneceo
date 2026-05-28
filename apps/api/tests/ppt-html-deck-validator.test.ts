import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateHtmlDeckSpec } from '../src/services/ppt-html-deck-validator';

const validSpec = {
  schemaVersion: '1.0',
  taskType: 'ppt_html_deck',
  deck: {
    title: '战略复盘',
    audience: '管理层',
    purpose: '同步核心判断',
    archetype: 'internal_strategy_review',
    slideCount: 2,
    aspectRatio: '16:9',
    language: 'zh-CN',
    outputFileName: 'strategy-review.pptx',
  },
  styleKit: {},
  slides: [
    {
      id: 'slide-1',
      index: 1,
      slideArchetype: 'cover',
      slideGoal: '建立主题',
      htmlFile: 'slides/001-cover.html',
    },
    {
      id: 'slide-2',
      index: 2,
      slideArchetype: 'executive_summary',
      slideGoal: '给出结论',
      htmlFile: 'slides/002-summary.html',
    },
  ],
  sources: [],
  openQuestions: [],
};

test('validateHtmlDeckSpec accepts PPT-only html deck specs', () => {
  const result = validateHtmlDeckSpec(validSpec);

  assert.equal(result.slideCount, 2);
  assert.equal(result.fileName, 'strategy-review.pptx');
  assert.equal(result.aspectRatio, '16:9');
  assert.equal(result.spec.taskType, 'ppt_html_deck');
});

test('validateHtmlDeckSpec preserves supported 4:3 aspect ratio', () => {
  const result = validateHtmlDeckSpec({
    ...validSpec,
    deck: {
      ...validSpec.deck,
      aspectRatio: '4:3',
    },
  });

  assert.equal(result.aspectRatio, '4:3');
  assert.equal((result.spec.deck as any).aspectRatio, '4:3');
});

test('validateHtmlDeckSpec rejects open questions before rendering', () => {
  assert.throws(
    () =>
      validateHtmlDeckSpec({
        ...validSpec,
        openQuestions: ['还需要确认受众'],
      }),
    /openQuestions must be empty/
  );
});

test('validateHtmlDeckSpec rejects non-PPT task type', () => {
  assert.throws(
    () =>
      validateHtmlDeckSpec({
        ...validSpec,
        taskType: 'web_app',
      }),
    /taskType must be ppt_html_deck/
  );
});

test('validateHtmlDeckSpec rejects unsafe slide html paths', () => {
  assert.throws(
    () =>
      validateHtmlDeckSpec({
        ...validSpec,
        slides: [{ ...(validSpec.slides[0] as any), htmlFile: '../index.html' }],
      }),
    /htmlFile must be a safe relative path/
  );
});
