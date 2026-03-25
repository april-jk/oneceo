import { taskSessionRunDAO } from '../db/dao';
import { altusManagedStreamService } from './altus-managed-stream-service';
import { toIso, type ManagedRunSummary } from './altus-managed-shared';

export class AltusRunEventWriter {
  async appendRunEvent(
    runId: string,
    sessionId: string,
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
    const envelopePayload = {
      ...payload,
      runId,
      sessionId,
      sequence,
      eventType,
    };
    altusManagedStreamService.publish(runId, {
      sequence,
      eventType,
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
