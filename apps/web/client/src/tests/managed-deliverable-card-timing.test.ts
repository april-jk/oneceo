import { describe, expect, it } from 'vitest';
import { buildManagedCompletionCardItem, type ChatItem } from '@/pages/Home';
import type { AgentMessage } from '@/hooks/useTaskCreationAgent';

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
    sessionId: input.sessionId || 'session-1',
    metadata: {
      executionMode: 'managed',
      executor: 'altus',
      eventType: input.eventType,
      runId: input.runId || 'run-1',
      deliverables: input.deliverables || [],
      previewSnapshot: input.previewSnapshot || null,
    },
  };
}

describe('managed deliverable card timing', () => {
  it('emits website preview card when deliverables contain html output', () => {
    const emittedRuns = new Set<string>();
    const artifactsByRun = new Map();
    const item = buildManagedCompletionCardItem({
      message: createManagedMessage({
        type: 'agent_message',
        runId: 'run-web-1',
        deliverables: [
          {
            id: 'artifact-web-1',
            runId: 'run-web-1',
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
    expect(emittedRuns.has('run-web-1')).toBe(true);
  });

  it('passes captured website preview snapshot into website preview card', () => {
    const emittedRuns = new Set<string>();
    const artifactsByRun = new Map();
    const item = buildManagedCompletionCardItem({
      message: createManagedMessage({
        type: 'agent_message',
        runId: 'run-web-snapshot-1',
        deliverables: [
          {
            id: 'artifact-web-snapshot-1',
            runId: 'run-web-snapshot-1',
            name: 'index.html',
            path: 'dist/index.html',
            mimeType: 'text/html',
            sizeBytes: 1024,
          },
        ],
        previewSnapshot: {
          kind: 'website_screenshot',
          status: 'captured',
          storageKey: 'sessions/session-1/previews/run-web-snapshot-1/snapshot.png',
          mimeType: 'image/png',
          width: 1280,
          height: 720,
        },
      }),
      managedArtifactsByRun: artifactsByRun,
      emittedManagedCompletionRuns: emittedRuns,
    });

    expect(item?.kind).toBe('managed_artifact_card');
    expect(
      (item as Extract<ChatItem, { kind: 'managed_artifact_card' }>)?.previewSnapshot?.status,
    ).toBe('captured');
    expect(emittedRuns.has('run-web-snapshot-1')).toBe(true);
  });

  it('emits a fresh website preview card when a modification run only has a new snapshot', () => {
    const emittedRuns = new Set<string>();
    const artifactsByRun = new Map();
    const item = buildManagedCompletionCardItem({
      message: createManagedMessage({
        type: 'agent_message',
        runId: 'run-web-edit-snapshot-1',
        previewSnapshot: {
          kind: 'website_screenshot',
          status: 'captured',
          storageKey: 'sessions/session-1/previews/run-web-edit-snapshot-1/snapshot.png',
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
    expect(emittedRuns.has('run-web-edit-snapshot-1')).toBe(true);
  });

  it('passes failed website preview snapshot into website preview card', () => {
    const emittedRuns = new Set<string>();
    const artifactsByRun = new Map();
    const item = buildManagedCompletionCardItem({
      message: createManagedMessage({
        type: 'agent_message',
        runId: 'run-web-snapshot-failed-1',
        deliverables: [
          {
            id: 'artifact-web-snapshot-failed-1',
            runId: 'run-web-snapshot-failed-1',
            name: 'index.html',
            path: 'dist/index.html',
            mimeType: 'text/html',
            sizeBytes: 1024,
          },
        ],
        previewSnapshot: {
          kind: 'website_screenshot',
          status: 'capture_failed',
          reasonCode: 'preview_port_not_ready',
          message: '网站预览服务端口未在限定时间内就绪',
        },
      }),
      managedArtifactsByRun: artifactsByRun,
      emittedManagedCompletionRuns: emittedRuns,
    });

    expect(item?.kind).toBe('managed_artifact_card');
    expect(
      (item as Extract<ChatItem, { kind: 'managed_artifact_card' }>)?.previewSnapshot?.status,
    ).toBe('capture_failed');
    expect(emittedRuns.has('run-web-snapshot-failed-1')).toBe(true);
  });

  it('passes browser screenshot fallback into website card when snapshot failed after visual pass', () => {
    const emittedRuns = new Set<string>();
    const artifactsByRun = new Map();
    const item = buildManagedCompletionCardItem({
      message: createManagedMessage({
        type: 'agent_message',
        runId: 'run-web-snapshot-fallback-1',
        deliverables: [
          {
            id: 'artifact-web-snapshot-fallback-1',
            runId: 'run-web-snapshot-fallback-1',
            name: 'index.html',
            path: 'dist/index.html',
            mimeType: 'text/html',
            sizeBytes: 1024,
          },
        ],
        previewSnapshot: {
          kind: 'website_screenshot',
          status: 'capture_failed',
          reasonCode: 'preview_visual_check_failed',
          message: 'app_runtime_error: 页面浏览器运行时报错',
        },
      }),
      managedArtifactsByRun: artifactsByRun,
      emittedManagedCompletionRuns: emittedRuns,
      browserScreenshotsByRun: new Map([
        [
          'run-web-snapshot-fallback-1',
          [
            {
              toolCallId: 'tool-debug-open-page-fallback',
              screenshot: {
                type: 'browser_screenshot',
                kind: 'browser_action_screenshot',
                status: 'captured',
                storageKey: 'sessions/session-1/browser-actions/passed.png',
                mimeType: 'image/png',
                width: 1280,
                height: 720,
                visualCheck: {
                  status: 'passed',
                },
              },
            },
          ],
        ],
      ]),
    });

    expect(item?.kind).toBe('managed_artifact_card');
    const card = item as Extract<ChatItem, { kind: 'managed_artifact_card' }>;
    expect(card.previewSnapshot?.status).toBe('capture_failed');
    expect(card.browserScreenshotFallback?.toolCallId).toBe('tool-debug-open-page-fallback');
    expect(card.browserScreenshotFallback?.screenshot.storageKey).toBe(
      'sessions/session-1/browser-actions/passed.png',
    );
  });

  it('keeps deliverable card for non-web deliverables', () => {
    const emittedRuns = new Set<string>();
    const artifactsByRun = new Map();
    const item = buildManagedCompletionCardItem({
      message: createManagedMessage({
        type: 'agent_message',
        runId: 'run-docx-1',
        deliverables: [
          {
            id: 'artifact-docx-1',
            runId: 'run-docx-1',
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
    expect(emittedRuns.has('run-docx-1')).toBe(true);
  });

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

  it('emits deliverable card from deliverables_ready status update before run completion', () => {
    const emittedRuns = new Set<string>();
    const artifactsByRun = new Map();
    const item = buildManagedCompletionCardItem({
      message: createManagedMessage({
        type: 'status_update',
        eventType: 'deliverables_ready',
        runId: 'run-ready-1',
        deliverables: [
          {
            id: 'artifact-ready-1',
            runId: 'run-ready-1',
            name: 'final.pdf',
            path: 'outputs/final.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 2048,
          },
        ],
      }),
      managedArtifactsByRun: artifactsByRun,
      emittedManagedCompletionRuns: emittedRuns,
    });

    expect(item?.kind).toBe('managed_deliverable_card');
    expect((item as Extract<ChatItem, { kind: 'managed_deliverable_card' }>)?.deliverables[0]?.name).toBe(
      'final.pdf'
    );
    expect(emittedRuns.has('run-ready-1')).toBe(true);
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
