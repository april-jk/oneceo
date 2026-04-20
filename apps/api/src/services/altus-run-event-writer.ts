import { taskCreationSessionDAO, taskSessionRunDAO } from '../db/dao';
import { altusManagedStreamService } from './altus-managed-stream-service';
import { altusRunRedisStateService, AltusRunRedisStateService } from './altus-run-redis-state-service';
import { stripManagedDebugPayload, toIso, type ManagedRunSummary } from './altus-managed-shared';

const MANAGED_TOOL_EVENT_TYPES = new Set([
  'tool_call_started',
  'tool_call_completed',
  'tool_call_failed',
]);

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function shouldProjectManagedToolEvent(eventType: string) {
  return MANAGED_TOOL_EVENT_TYPES.has(asText(eventType).toLowerCase());
}

function buildManagedToolMessageKey(input: {
  runId: string;
  eventType: string;
  sequence: number;
  payload: Record<string, unknown>;
}) {
  const toolCallId = asText(input.payload.toolCallId);
  if (toolCallId) {
    return `managed:${input.runId}:tool:${toolCallId}`;
  }
  return `managed:${input.runId}:${input.eventType}:${Math.max(0, Math.floor(input.sequence || 0))}`;
}

export class AltusRunEventWriter {
  constructor(private readonly redisStateService: AltusRunRedisStateService = altusRunRedisStateService) {}

  async appendRunEvent(
    runId: string,
    sessionId: string,
    userId: string,
    eventType: string,
    payload: Record<string, unknown>
  ) {
    const event = await taskSessionRunDAO.appendRunEvent({
      runId,
      sessionId,
      eventType,
      payloadJson: payload,
    });
    const sequence = Number(event.sequence || 0);
    const normalizedEventType = asText(eventType).toLowerCase() || eventType;
    const envelopePayload: Record<string, unknown> = {
      ...payload,
      runId,
      sessionId,
      userId,
      sequence,
      eventType: normalizedEventType,
    };
    const userVisiblePayload = stripManagedDebugPayload(envelopePayload);
    if (shouldProjectManagedToolEvent(normalizedEventType)) {
      const messageKey = buildManagedToolMessageKey({
        runId,
        eventType: normalizedEventType,
        sequence,
        payload: envelopePayload,
      });
      const content = asText(envelopePayload.content) || normalizedEventType;
      await taskCreationSessionDAO.addMessage({
        sessionId,
        role: 'agent',
        messageType: 'executor_event',
        content,
        metadata: {
          ...userVisiblePayload,
          messageKey,
          eventType: normalizedEventType,
          executor: 'altus',
          executionMode: 'managed',
          runId,
          sessionId,
          userId,
          toolCallId: asText(envelopePayload.toolCallId) || undefined,
          toolName: asText(envelopePayload.toolName) || undefined,
        },
        createdAt: event.createdAt || new Date(),
      });
    }
    await this.redisStateService.appendRunEvent({
      runId,
      sessionId,
      userId,
      eventId: String(event.id),
      eventType: normalizedEventType,
      sequence,
      payload: envelopePayload,
    });
    altusManagedStreamService.publish(runId, {
      sequence,
      eventType: normalizedEventType,
      payload: envelopePayload,
    });
    return { sequence, payload: envelopePayload };
  }

  async toSummary(
    run: Awaited<ReturnType<typeof taskSessionRunDAO.getRun>>
  ): Promise<ManagedRunSummary | null> {
    if (!run) return null;
    return {
      id: run.id,
      sessionId: run.sessionId,
      status: run.status || undefined,
      model: run.model || null,
      stopReason: run.stopReason || null,
      streamUrl: `/api/altus-managed/runs/${encodeURIComponent(run.id)}/stream`,
      startedAt: toIso(run.startedAt),
      completedAt: toIso(run.completedAt),
      updatedAt: toIso(run.updatedAt),
      sequence: await taskSessionRunDAO.getLatestRunEventSequence(run.id),
    };
  }
}

export const altusRunEventWriter = new AltusRunEventWriter();
