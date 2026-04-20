import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyTaskIntentShape } from '../src/services/task-intent-shape-service';

test('task intent shape classifier flags broad business systems for clarification', () => {
  const shape = classifyTaskIntentShape('帮我做一个客户管理系统');

  assert.equal(shape.artifactKind, 'business_system');
  assert.equal(shape.suggestedIntentType, 'software_development');
  assert.equal(shape.needsClarification, true);
  assert.match(shape.clarificationQuestion, /主要使用角色/);
  assert.match(shape.clarificationQuestion, /核心模块/);
  assert.match(shape.clarificationQuestion, /源码/);
  assert.match(shape.clarificationQuestion, /部署/);
});

test('task intent shape classifier keeps python csv requests as non-deployable scripts', () => {
  const shape = classifyTaskIntentShape('写一个 Python 脚本分析 CSV 并输出 Markdown 报告，不要部署。');

  assert.equal(shape.artifactKind, 'script_artifact');
  assert.equal(shape.suggestedIntentType, 'software_development');
  assert.equal(shape.explicitNoDeploy, true);
  assert.equal(shape.deliveryMode, 'non_deployable');
  assert.equal(shape.needsClarification, false);
});

test('task intent shape classifier treats negated deployment-status language as no-deploy boundary', () => {
  const shape = classifyTaskIntentShape('帮我整理一份需求文档，不要检查部署状态，也不要重新部署。');

  assert.equal(shape.explicitNoDeploy, true);
  assert.equal(shape.deployRequested, true);
  assert.equal(shape.deliveryMode, 'non_deployable');
});

test('task intent shape classifier treats boundary-only source-code requests as software clarification cases', () => {
  const shape = classifyTaskIntentShape('只生成源码给我，不要部署，也不要假设我已经授权任何外部平台。');

  assert.equal(shape.artifactKind, 'software_artifact');
  assert.equal(shape.suggestedIntentType, 'software_development');
  assert.equal(shape.boundaryOnlySoftwareRequest, true);
  assert.equal(shape.needsClarification, true);
  assert.match(shape.clarificationQuestion, /具体软件交付物/);
  assert.match(shape.clarificationQuestion, /只生成源码/);
  assert.match(shape.clarificationQuestion, /不部署/);
});

test('task intent shape classifier keeps company website requests deployable when deploy is explicit', () => {
  const shape = classifyTaskIntentShape('做一个纯 HTML 企业官网，包含首页和联系我们，并直接部署。');

  assert.equal(shape.artifactKind, 'web_app');
  assert.equal(shape.deliveryMode, 'deployable');
  assert.equal(shape.needsClarification, false);
});
