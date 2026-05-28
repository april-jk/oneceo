import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sanitizePptFileName, validatePptRenderInstruction } from '../src/services/ppt-render-instruction-validator';

const validInstruction = {
  deck: {
    title: '职业规划',
    audience: '大学生',
    purpose: '说明三年职业路径',
    slideCount: 2,
    fileName: 'career-plan.pptx',
  },
  theme: {
    canvas: '16:9',
    colorTokens: {
      background: '#ffffff',
      primary: '#0969da',
      text: '#1f2328',
    },
  },
  slides: [
    {
      index: 1,
      pageType: 'cover',
      title: '职业规划',
      coreMessage: '从探索到落地',
      contentBlocks: [],
      imageSlots: [],
      sourceRefs: [],
    },
    {
      index: 2,
      pageType: 'content',
      title: '路径概览',
      coreMessage: '用阶段目标降低不确定性',
      contentBlocks: [{ type: 'bullets', items: ['探索', '验证', '执行'] }],
      imageSlots: [],
      sourceRefs: [],
    },
  ],
  sources: [],
  openQuestions: [],
};

test('validatePptRenderInstruction accepts a complete render instruction', () => {
  const result = validatePptRenderInstruction(validInstruction);

  assert.equal(result.slideCount, 2);
  assert.equal(result.fileName, 'career-plan.pptx');
});

test('validatePptRenderInstruction rejects open questions before rendering', () => {
  assert.throws(
    () =>
      validatePptRenderInstruction({
        ...validInstruction,
        openQuestions: ['还需要确认受众'],
      }),
    /openQuestions must be empty/
  );
});

test('validatePptRenderInstruction normalizes semantic page types from model output', () => {
  const result = validatePptRenderInstruction({
    ...validInstruction,
    deck: { ...validInstruction.deck, slideCount: 3 },
    slides: [
      validInstruction.slides[0],
      { ...(validInstruction.slides[1] as any), pageType: 'overview' },
      {
        index: 3,
        pageType: 'usecase',
        title: '应用场景',
        coreMessage: '从原型到代码审查',
        contentBlocks: [{ type: 'body', text: '• 快速原型\n• 自动化审查' }],
      },
    ],
  });

  assert.equal((result.instruction.slides as any[])[1]?.pageType, 'content');
  assert.equal((result.instruction.slides as any[])[2]?.pageType, 'content');
  assert.equal((result.instruction.slides as any[])[2]?.originalPageType, 'usecase');
});

test('validatePptRenderInstruction aligns shared page type aliases with renderer page types', () => {
  const result = validatePptRenderInstruction({
    ...validInstruction,
    deck: { ...validInstruction.deck, slideCount: 4 },
    slides: [
      validInstruction.slides[0],
      { ...(validInstruction.slides[1] as any), pageType: 'toc', title: '目录' },
      {
        index: 3,
        pageType: 'section_divider',
        title: '第一部分',
        coreMessage: '进入主体',
      },
      {
        index: 4,
        pageType: 'summary',
        title: '总结',
        coreMessage: '下一步行动',
      },
    ],
  });

  const slides = result.instruction.slides as any[];
  assert.equal(slides[1]?.pageType, 'agenda');
  assert.equal(slides[2]?.pageType, 'section-divider');
  assert.equal(slides[3]?.pageType, 'closing');
});

test('validatePptRenderInstruction rejects slide count mismatch', () => {
  assert.throws(
    () =>
      validatePptRenderInstruction({
        ...validInstruction,
        deck: { ...validInstruction.deck, slideCount: 3 },
      }),
    /slideCount must match/
  );
});

test('sanitizePptFileName preserves unicode names for delivered ppt files', () => {
  assert.equal(sanitizePptFileName('沐曦股份-投资价值分析.pptx'), '沐曦股份-投资价值分析.pptx');
});
