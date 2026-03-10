import assert from 'node:assert/strict';
import {
  ScenarioContext,
  SseHarness,
  markScenarioStart,
  markScenarioEnd,
  sendDirectInput,
  settle,
  assertSessionContext,
} from '../_shared/harness';

export default async function runScenario(ctx: ScenarioContext) {
  const name = '03_sse_realtime_incremental';
  const startedAt = markScenarioStart(name);
  assertSessionContext(ctx);

  let sse: SseHarness | null = null;
  let connectError: unknown;
  for (let i = 0; i < 6; i += 1) {
    try {
      sse = await SseHarness.connect({
        sessionId: ctx.sessionId!,
        opencodeSessionId: ctx.opencodeSessionId,
      });
      break;
    } catch (error) {
      connectError = error;
      await settle(2000);
    }
  }
  if (!sse) {
    throw connectError instanceof Error ? connectError : new Error('SSE connect failed');
  }

  const prompt = `DIRECT_SUITE_${ctx.suiteId}_SSE: 请输出 8 行带编号文本（line-1 到 line-8），每行简短解释。`;
  ctx.prompts.push(prompt);

  const { beforeSend } = await sendDirectInput(ctx, prompt, { includeSessionId: true });

  try {
    const firstSseEvent = await sse.waitFor(
      (event) =>
        event.receivedAt >= beforeSend &&
        (event.type === 'opencode_event' || Boolean(event.eventType)),
      60000,
      '发送后应尽快收到 SSE 事件'
    );

    await settle(5000);
    const allEvents = sse.getEvents().filter((event) => event.receivedAt >= beforeSend);
    const partUpdatedCount = allEvents.filter((event) => {
      const subtype = String(event.eventType || (event.metadata || {}).eventType || '');
      return subtype === 'message.part.updated';
    }).length;

    assert.ok(firstSseEvent.receivedAt - beforeSend < 30000, 'SSE 首事件延迟过高');
    assert.ok(allEvents.length >= 2, 'SSE 事件数量过少，未体现增量流');
    assert.ok(partUpdatedCount >= 1, '未捕获 message.part.updated 增量事件');

    return markScenarioEnd(name, startedAt, {
      firstEventDelayMs: firstSseEvent.receivedAt - beforeSend,
      incrementalEventCount: allEvents.length,
      partUpdatedCount,
    });
  } finally {
    await sse.close();
  }
}
