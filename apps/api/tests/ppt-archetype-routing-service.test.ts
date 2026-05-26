import assert from 'node:assert/strict';
import test from 'node:test';
import { derivePptGenerationContext } from '../src/services/ppt-archetype-routing-service';

test('PPT archetype routing follows confirmed investor pitch purpose', () => {
  const context = derivePptGenerationContext([
    '帮我分析一下沐曦股份，做个 ppt',
    [
      '已确认需求（结构化澄清选择）',
      '- 演示目的与受众：投资人融资路演',
      '- 内容来源与可信度：官网、公告、权威媒体优先',
      '- 深度与页数：12-15 页标准版',
      '- 视觉与叙事风格：科技投研风',
    ].join('\n'),
  ]);

  assert.equal(context?.archetype, 'investor_pitch');
  assert.ok(context?.slideArchetypes.includes('moat_stack'));
  assert.ok(context?.slideArchetypes.includes('ask_or_use_of_funds'));
  assert.ok(context?.sourceCoverageRules.some((rule) => rule.includes('web_extract')));
  assert.ok(context?.sourceCoverageRules.some((rule) => rule.includes('at least 6 distinct cited sources')));
});

test('PPT archetype routing keeps internal strategy separate from investor pitch', () => {
  const context = derivePptGenerationContext([
    '帮我分析一下沐曦股份，做个 ppt',
    [
      '已确认需求（结构化澄清选择）',
      '- 演示目的与受众：内部高管战略汇报',
      '- 内容来源与可信度：官网、公告、权威媒体优先',
      '- 深度与页数：12-15 页标准版',
      '- 视觉与叙事风格：科技投研风',
    ].join('\n'),
  ]);

  assert.equal(context?.archetype, 'internal_strategy_review');
  assert.ok(context?.slideArchetypes.includes('decision_options'));
  assert.equal(context?.slideArchetypes.includes('ask_or_use_of_funds'), false);
});

test('PPT archetype routing ignores non-PPT tasks', () => {
  const context = derivePptGenerationContext(['请帮我做一个企业官网']);

  assert.equal(context, null);
});

test('PPT archetype routing accepts current confirmed brief without scanning old turns', () => {
  const context = derivePptGenerationContext([
    [
      '已确认需求（结构化澄清选择）',
      '- 演示目的与受众：内部高管战略汇报',
      '- 内容来源与可信度：官网、公告、权威媒体优先',
      '- 深度与页数：12-15 页标准版',
      '- 视觉与叙事风格：科技投研风',
    ].join('\n'),
  ]);

  assert.equal(context?.archetype, 'internal_strategy_review');
});
