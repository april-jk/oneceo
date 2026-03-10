import assert from 'node:assert/strict';
import {
  ScenarioContext,
  markScenarioStart,
  markScenarioEnd,
  sendDirectInput,
  settle,
  assertSessionContext,
} from '../_shared/harness';

export default async function runScenario(ctx: ScenarioContext) {
  const name = '05_completion_signal';
  const startedAt = markScenarioStart(name);
  assertSessionContext(ctx);

  const prompt = `DIRECT_SUITE_${ctx.suiteId}_DONE: 仅回复“done-ok”。`;
  ctx.prompts.push(prompt);

  const { beforeSend } = await sendDirectInput(ctx, prompt, { includeSessionId: true });

  const completionEvent = await ctx.ws.waitFor(
    (msg) => {
      if (msg.receivedAt < beforeSend) return false;
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
      return (
        contentText.includes('done-ok') ||
        subtype === 'message.final' ||
        subtype === 'session.idle' ||
        subtype === 'session.status' ||
        subtype === 'session.completed'
      );
    },
    90000,
    '应收到会话完成类事件'
  );

  await settle(1500);

  const completionSubtype =
    completionEvent.type === 'opencode_event'
      ? String((completionEvent.metadata || {}).eventType || '')
      : completionEvent.type;
  const completionContent = String(completionEvent.content || '');
  assert.ok(completionSubtype.length > 0 || completionContent.trim().length > 0, '应捕获可判定完成的事件内容');

  return markScenarioEnd(name, startedAt, {
    completionSubtype,
    completionContent,
  });
}
