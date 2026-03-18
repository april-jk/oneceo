import assert from 'node:assert/strict';
import {
  ScenarioContext,
  markScenarioStart,
  markScenarioEnd,
  sendDirectInput,
  waitForOpencodeEventAfter,
  settle,
  assertSessionContext,
} from '../_shared/harness';

export default async function runScenario(ctx: ScenarioContext) {
  const name = '02_session_continuation';
  const startedAt = markScenarioStart(name);
  assertSessionContext(ctx);

  const initialSessionId = ctx.sessionId;
  const initialOpencodeSessionId = ctx.opencodeSessionId;

  await ctx.ws.waitFor(
    (msg) => {
      if (msg.type !== 'opencode_event' && msg.type !== 'status_update' && msg.type !== 'opencode_status') {
        return false;
      }
      const contentText = String(msg.content || '').toLowerCase();
      if (msg.type === 'status_update' || msg.type === 'opencode_status') {
        return (
          contentText.includes('opencode 执行完成') ||
          contentText.includes('opencode 执行已结束') ||
          contentText.includes('opencode 执行失败')
        );
      }
      const subtype = String((msg.metadata || {}).eventType || '').toLowerCase();
      return subtype === 'message.final' || subtype === 'session.idle' || subtype === 'session.status';
    },
    90000,
    '续聊前应先收到上一轮完成信号'
  );

  const prompt = `DIRECT_SUITE_${ctx.suiteId}_CONTINUATION: 继续在同一会话回复“continuation-ok”。`;
  ctx.prompts.push(prompt);

  const { accepted, beforeSend } = await sendDirectInput(ctx, prompt, { includeSessionId: true });

  assert.equal(ctx.sessionId, initialSessionId, '续聊时 sessionId 不应变化');
  if (initialOpencodeSessionId && ctx.opencodeSessionId) {
    assert.equal(ctx.opencodeSessionId, initialOpencodeSessionId, '续聊时 opencodeSessionId 不应变化');
  }

  const nextEvent = await waitForOpencodeEventAfter(
    ctx.ws,
    beforeSend,
    60000,
    '续聊后应继续收到 opencode_event'
  );

  await settle(2000);

  return markScenarioEnd(name, startedAt, {
    sessionId: ctx.sessionId,
    opencodeSessionId: ctx.opencodeSessionId,
    acceptedType: accepted.type,
    nextEventType: nextEvent.type,
    nextEventSubtype: (nextEvent.metadata || {}).eventType || null,
  });
}
