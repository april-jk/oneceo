import { expect, test } from '@playwright/test';
import { buildChatItems, buildManagedCompletionCardItem, type ChatItem } from '../pages/Home';
import type { AgentMessage } from '../hooks/useTaskCreationAgent';

function createManagedMessage(input: {
  type: AgentMessage['type'];
  eventType?: string;
  sessionId?: string;
  runId?: string;
  deliverables?: Array<Record<string, unknown>>;
  previewSnapshot?: Record<string, unknown> | null;
}): AgentMessage {
  return {
    type: input.type,
    content: 'managed payload',
    sessionId: input.sessionId || 'session-pw-1',
    metadata: {
      executionMode: 'managed',
      executor: 'altus',
      eventType: input.eventType,
      runId: input.runId || 'run-pw-1',
      deliverables: input.deliverables || [],
      previewSnapshot: input.previewSnapshot || null,
    },
  };
}

test('website deliverable routes to managed_artifact_card', async () => {
  const emittedRuns = new Set<string>();
  const artifactsByRun = new Map();
  const item = buildManagedCompletionCardItem({
    message: createManagedMessage({
      type: 'agent_message',
      runId: 'run-pw-web-1',
      deliverables: [
        {
          id: 'artifact-pw-web-1',
          runId: 'run-pw-web-1',
          name: 'index.html',
          path: 'dist/index.html',
          mimeType: 'text/html',
          sizeBytes: 1024,
        },
      ],
    }),
    managedArtifactsByRun: artifactsByRun,
    emittedManagedCompletionRuns: emittedRuns,
  });

  expect(item?.kind).toBe('managed_artifact_card');
  expect((item as Extract<ChatItem, { kind: 'managed_artifact_card' }>)?.artifacts[0]?.path).toBe(
    'dist/index.html'
  );
  expect(emittedRuns.has('run-pw-web-1')).toBeTruthy();
});

test('website edit run with only a fresh snapshot routes to managed_artifact_card', async () => {
  const emittedRuns = new Set<string>();
  const artifactsByRun = new Map();
  const item = buildManagedCompletionCardItem({
    message: createManagedMessage({
      type: 'agent_message',
      runId: 'run-pw-web-edit-snapshot-1',
      previewSnapshot: {
        kind: 'website_screenshot',
        status: 'captured',
        storageKey: 'sessions/session-pw-1/previews/run-pw-web-edit-snapshot-1/snapshot.png',
        mimeType: 'image/png',
        width: 1280,
        height: 720,
      },
    }),
    managedArtifactsByRun: artifactsByRun,
    emittedManagedCompletionRuns: emittedRuns,
  });

  expect(item?.kind).toBe('managed_artifact_card');
  expect((item as Extract<ChatItem, { kind: 'managed_artifact_card' }>)?.artifacts).toEqual([]);
  expect(
    (item as Extract<ChatItem, { kind: 'managed_artifact_card' }>)?.previewSnapshot?.status,
  ).toBe('captured');
  expect(emittedRuns.has('run-pw-web-edit-snapshot-1')).toBeTruthy();
});

test('non-web deliverable keeps managed_deliverable_card', async () => {
  const emittedRuns = new Set<string>();
  const artifactsByRun = new Map();
  const item = buildManagedCompletionCardItem({
    message: createManagedMessage({
      type: 'agent_message',
      runId: 'run-pw-docx-1',
      deliverables: [
        {
          id: 'artifact-pw-docx-1',
          runId: 'run-pw-docx-1',
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
  expect(emittedRuns.has('run-pw-docx-1')).toBeTruthy();
});

test('run completion text renders before the completion card', async () => {
  const items = buildChatItems([
    createManagedMessage({
      type: 'status_update',
      eventType: 'run_completed',
      runId: 'run-pw-complete-order-1',
      deliverables: [
        {
          id: 'artifact-pw-complete-order-1',
          runId: 'run-pw-complete-order-1',
          name: 'result.docx',
          path: 'outputs/result.docx',
          mimeType:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          sizeBytes: 1024,
        },
      ],
    }),
  ]);

  expect(items[0]?.kind).toBe('capsule');
  expect(items[1]?.kind).toBe('managed_deliverable_card');
});
