import assert from 'node:assert/strict';
import {
  ScenarioContext,
  markScenarioStart,
  markScenarioEnd,
  getSessionMessages,
  settle,
  assertSessionContext,
} from '../_shared/harness';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export default async function runScenario(ctx: ScenarioContext) {
  const name = '04_persistence_refresh_consistency';
  const startedAt = markScenarioStart(name);
  assertSessionContext(ctx);

  await settle(2000);
  const firstPull = await getSessionMessages(ctx.sessionId!);
  await settle(1500);
  const secondPull = await getSessionMessages(ctx.sessionId!);

  const firstMessages = firstPull.data || [];
  const secondMessages = secondPull.data || [];

  const firstOpencodeEventCount = firstMessages.filter((msg) => msg.messageType === 'opencode_event').length;
  const secondOpencodeEventCount = secondMessages.filter((msg) => msg.messageType === 'opencode_event').length;

  const userInputs = secondMessages.filter((msg) => msg.messageType === 'user_input').map((msg) => normalizeText(msg.content));

  assert.ok(firstMessages.length > 0, '首次拉取消息为空');
  assert.ok(secondMessages.length >= firstMessages.length, '二次拉取消息数量不应减少');
  assert.ok(secondOpencodeEventCount >= firstOpencodeEventCount, 'opencode_event 落盘数量不应倒退');

  for (const prompt of ctx.prompts) {
    assert.ok(userInputs.includes(prompt), `缺少已发送用户消息落盘: ${prompt}`);
  }

  return markScenarioEnd(name, startedAt, {
    firstMessageCount: firstMessages.length,
    secondMessageCount: secondMessages.length,
    firstOpencodeEventCount,
    secondOpencodeEventCount,
    persistedUserInputCount: userInputs.length,
  });
}
