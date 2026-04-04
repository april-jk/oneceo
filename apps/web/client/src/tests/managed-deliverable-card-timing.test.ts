import { describe, expect, it } from 'vitest';
import { buildManagedCompletionCardItem, type ChatItem } from '@/pages/Home';
import type { AgentMessage } from '@/hooks/useTaskCreationAgent';

function createManagedMessage(input: {
  type: AgentMessage['type'];
  eventType?: string;
  sessionId?: string;
  runId?: string;
  deliverables?: Array<Record<string, unknown>>;
}): AgentMessage {
  return {
    type: input.type,
    content: 'managed payload',
    sessionId: input.sessionId || 'session-1',
    metadata: {
      executionMode: 'managed',
      executor: 'altus',
      eventType: input.eventType,
      runId: input.runId || 'run-1',
      deliverables: input.deliverables || [],
    },
  };
}

describe('managed deliverable card timing', () => {
  it('emits deliverable card as soon as assistant message contains deliverables', () => {
    const emittedRuns = new Set<string>();
    const artifactsByRun = new Map();
    const item = buildManagedCompletionCardItem({
      message: createManagedMessage({
        type: 'agent_message',
        deliverables: [
          {
            id: 'artifact-1',
            runId: 'run-1',
            name: 'result.docx',
            path: 'outputs/result.docx',
            mimeType:
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            sizeBytes: 1024,
          },
        ],
      }),
      managedArtifactsByRun: artifactsByRun,
      emittedManagedCompletionRuns: emittedRuns,
    });

    expect(item?.kind).toBe('managed_deliverable_card');
    expect((item as Extract<ChatItem, { kind: 'managed_deliverable_card' }>)?.deliverables[0]?.name).toBe(
      'result.docx'
    );
    expect(emittedRuns.has('run-1')).toBe(true);
  });

  it('still falls back to artifact card on run completed when no deliverables exist', () => {
    const emittedRuns = new Set<string>();
    const artifactsByRun = new Map([
      [
        'run-2',
        [
          {
            path: 'dist/index.html',
            previewType: 'web',
          },
        ],
      ],
    ]);

    const item = buildManagedCompletionCardItem({
      message: createManagedMessage({
        type: 'status_update',
        eventType: 'run_completed',
        runId: 'run-2',
      }),
      managedArtifactsByRun: artifactsByRun,
      emittedManagedCompletionRuns: emittedRuns,
    });

    expect(item?.kind).toBe('managed_artifact_card');
    expect(emittedRuns.has('run-2')).toBe(true);
  });
});
