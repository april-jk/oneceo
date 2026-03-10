import assert from 'node:assert/strict';
import {
  ScenarioContext,
  markScenarioStart,
  markScenarioEnd,
  sendDirectInput,
  waitForOpencodeEventAfter,
  settle,
} from '../_shared/harness';

export default async function runScenario(ctx: ScenarioContext) {
  const name = '01_session_bootstrap';
  const startedAt = markScenarioStart(name);

  const prompt = `DIRECT_SUITE_${ctx.suiteId}_BOOTSTRAP: 请回复“bootstrap-ok”。`;
  ctx.prompts.push(prompt);

  const { accepted, beforeSend } = await sendDirectInput(ctx, prompt, { includeSessionId: false });

  assert.ok(ctx.sessionId, '首条消息后应生成 sessionId');
  assert.ok(ctx.opencodeSessionId, '首条消息后应绑定 opencodeSessionId');
  assert.ok(ctx.orchestratorSessionId, '首条消息后应绑定 orchestratorSessionId');

  const firstEvent = await waitForOpencodeEventAfter(
    ctx.ws,
    beforeSend,
    60000,
    '首条消息后应收到 opencode_event'
  );

  await settle(2000);

  return markScenarioEnd(name, startedAt, {
    sessionId: ctx.sessionId,
    opencodeSessionId: ctx.opencodeSessionId,
    orchestratorSessionId: ctx.orchestratorSessionId,
    acceptedType: accepted.type,
    firstEventType: firstEvent.type,
    firstEventSubtype: (firstEvent.metadata || {}).eventType || null,
  });
}
