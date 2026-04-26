import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyPlatformCapabilityIntent } from '../src/services/platform-capability-intent-service';

test('platform capability intent separates deploy action from capability question', () => {
  const action = classifyPlatformCapabilityIntent('帮我部署当前项目');
  assert.equal(action.mode, 'execute');
  assert.equal(action.intentKind, 'explicit_action');
  assert.equal(action.capabilityKind, 'deploy');
  assert.equal(action.shouldExecute, true);

  const question = classifyPlatformCapabilityIntent('你是否具有 Vercel 部署能力？');
  assert.equal(question.mode, 'answer_capability');
  assert.equal(question.topic, 'vercel');
  assert.equal(question.intentKind, 'capability_question');
  assert.equal(question.capabilityKind, null);
  assert.equal(question.shouldExecute, false);
});

test('platform capability intent treats short Vercel capability questions as advisory success state', () => {
  const decision = classifyPlatformCapabilityIntent('能用vercel部署吗');
  assert.equal(decision.mode, 'answer_capability');
  assert.equal(decision.intentKind, 'capability_question');
  assert.equal(decision.topic, 'vercel');
  assert.equal(decision.shouldExecute, false);
});

test('platform capability intent separates advice and concept questions from platform execution', () => {
  const advice = classifyPlatformCapabilityIntent('怎么部署到 Vercel？');
  assert.equal(advice.mode, 'explain_how_to');
  assert.equal(advice.intentKind, 'how_to_advice');
  assert.equal(advice.shouldExecute, false);

  const concept = classifyPlatformCapabilityIntent('部署状态是什么意思？');
  assert.equal(concept.mode, 'explain_concept');
  assert.equal(concept.intentKind, 'concept_question');
  assert.equal(concept.shouldExecute, false);
});

test('platform capability intent allows natural status, redeploy and rollback action wording', () => {
  const status = classifyPlatformCapabilityIntent('看下部署状态');
  assert.equal(status.intentKind, 'explicit_action');
  assert.equal(status.capabilityKind, 'deployment_status');
  assert.equal(status.directModeCapabilityId, 'get_session_deployment_status');

  const redeploy = classifyPlatformCapabilityIntent('重新部署一下');
  assert.equal(redeploy.intentKind, 'explicit_action');
  assert.equal(redeploy.capabilityKind, 'redeploy');
  assert.equal(redeploy.directModeCapabilityId, 'redeploy_session_website');

  const rollback = classifyPlatformCapabilityIntent('回滚到上一个部署');
  assert.equal(rollback.intentKind, 'explicit_action');
  assert.equal(rollback.capabilityKind, 'rollback');
  assert.equal(rollback.directModeCapabilityId, 'rollback_session_deployment');
});

test('platform capability intent does not inherit historical deployment action into a vague current turn', () => {
  const decision = classifyPlatformCapabilityIntent(['帮我部署当前项目', '继续']);
  assert.equal(decision.mode, 'unclear');
  assert.equal(decision.intentKind, 'unclear');
  assert.equal(decision.shouldExecute, false);
});
