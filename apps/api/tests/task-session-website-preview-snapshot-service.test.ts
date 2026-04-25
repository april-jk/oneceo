import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  readPreviewSnapshot,
  shouldCaptureWebsitePreview,
  TaskSessionWebsitePreviewSnapshotService,
} from '../src/services/task-session-website-preview-snapshot-service';

test('shouldCaptureWebsitePreview detects deployable website tasks', () => {
  assert.equal(
    shouldCaptureWebsitePreview({
      taskIntentProfile: {
        mode: 'deployable_web_app',
        webArtifactRequested: true,
      } as any,
    }),
    true,
  );
});

test('shouldCaptureWebsitePreview detects manifest-backed website outputs', () => {
  assert.equal(
    shouldCaptureWebsitePreview({
      manifestExists: true,
    }),
    true,
  );
});

test('shouldCaptureWebsitePreview requires package context for html-only outputs', () => {
  assert.equal(
    shouldCaptureWebsitePreview({
      deliverables: [{ path: 'dist/index.html' }],
      packageExists: true,
    }),
    true,
  );
  assert.equal(
    shouldCaptureWebsitePreview({
      deliverables: [{ path: 'dist/index.html' }],
      packageExists: false,
    }),
    false,
  );
});

test('shouldCaptureWebsitePreview follows successful debug page signal', () => {
  assert.equal(
    shouldCaptureWebsitePreview({
      debugOpenPageSucceeded: true,
    }),
    true,
  );
});

test('readPreviewSnapshot accepts only website screenshot metadata', () => {
  assert.deepEqual(
    readPreviewSnapshot({
      kind: 'website_screenshot',
      status: 'captured',
      storageKey: 'sessions/session-1/previews/run-1/snapshot.png',
      mimeType: 'image/png',
      width: 1280,
      height: 720,
      source: {
        sandboxId: 'sandbox-1',
        port: 4173,
        url: 'http://127.0.0.1:4173/',
      },
    }),
    {
      kind: 'website_screenshot',
      status: 'captured',
      storageKey: 'sessions/session-1/previews/run-1/snapshot.png',
      mimeType: 'image/png',
      width: 1280,
      height: 720,
      capturedAt: undefined,
      reasonCode: undefined,
      message: undefined,
      source: {
        sandboxId: 'sandbox-1',
        port: 4173,
        url: 'http://127.0.0.1:4173/',
        command: undefined,
        logPath: undefined,
      },
    },
  );
  assert.equal(readPreviewSnapshot({ kind: 'other', status: 'captured' }), null);
  assert.equal(readPreviewSnapshot({ kind: 'website_screenshot', status: 'unknown' }), null);
});

test('resolveCommandCandidate prefers runnable start/dev scripts and Vite ports', () => {
  const service = new TaskSessionWebsitePreviewSnapshotService({
    e2b: {} as any,
    uploadToR2: async () => undefined,
    downloadFromR2: async () => Buffer.from(''),
  });

  assert.deepEqual(
    (service as any).resolveCommandCandidate({
      manifest: null,
      packageJson: {
        packageManager: 'pnpm@10.0.0',
        scripts: {
          preview: 'vite preview',
          dev: 'vite --host 0.0.0.0',
        },
      },
    }),
    {
      command: 'pnpm dev',
      port: 5173,
      reason: 'package_script_dev',
      appendVitePortArgs: true,
    },
  );

  assert.deepEqual(
    (service as any).resolveCommandCandidate({
      manifest: { start: { command: 'npm run start', port: 8080 } },
      packageJson: null,
    }),
    {
      command: 'npm run start',
      port: 8080,
      reason: 'manifest_start',
      appendVitePortArgs: false,
    },
  );
});
