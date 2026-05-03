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

test('shouldCaptureWebsitePreview captures html outputs with package context or successful debug signal', () => {
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
  assert.equal(
    shouldCaptureWebsitePreview({
      deliverables: [{ path: 'dist/index.html' }],
      packageExists: false,
      debugOpenPageSucceeded: true,
    }),
    true,
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

test('captureManagedRunPreview captures debug-opened html deliverables without a start command', async () => {
  const capturedCommands: string[] = [];
  let uploadedKey = '';
  let uploadedBody: Buffer | null = null;
  const service = new TaskSessionWebsitePreviewSnapshotService({
    e2b: {
      readFile: async (_sandboxId: string, filePath: string) => {
        if (filePath.endsWith('oneceo.manifest.json') || filePath.endsWith('package.json')) {
          return Buffer.from('');
        }
        if (filePath.endsWith('index.html')) {
          return Buffer.from('<!doctype html><html><body>2048</body></html>');
        }
        if (filePath.endsWith('.png')) {
          return Buffer.from('png-bytes');
        }
        throw new Error(`unexpected read: ${filePath}`);
      },
      runCommand: async (_sandboxId: string, command: string) => {
        capturedCommands.push(command);
        return { exitCode: 0 };
      },
    } as any,
    uploadToR2: async (key: string, body: Buffer) => {
      uploadedKey = key;
      uploadedBody = body;
    },
    downloadFromR2: async () => Buffer.from(''),
  });

  const snapshot = await service.captureManagedRunPreview({
    sessionId: 'session-html',
    runId: 'run-html',
    sandboxId: 'sandbox-html',
    workspaceRoot: '/workspace/session html',
    deliverables: [{ path: 'index.html' } as any],
    debugOpenPageSucceeded: true,
  });

  assert.equal(snapshot?.status, 'captured');
  assert.equal(snapshot?.source?.url, 'file:///workspace/session%20html/index.html');
  assert.equal(snapshot?.source?.command, undefined);
  assert.equal(snapshot?.source?.port, undefined);
  assert.match(uploadedKey, /^sessions\/session-html\/previews\/run-html\//);
  assert.deepEqual(uploadedBody, Buffer.from('png-bytes'));
  assert.ok(capturedCommands.some((command) => /file:\/\/\/workspace\/session%20html\/index\.html/.test(command)));
});

test('captureManagedRunPreview falls back to workspace index.html after successful debug open', async () => {
  const readPaths: string[] = [];
  const service = new TaskSessionWebsitePreviewSnapshotService({
    e2b: {
      readFile: async (_sandboxId: string, filePath: string) => {
        readPaths.push(filePath);
        if (filePath.endsWith('oneceo.manifest.json') || filePath.endsWith('package.json')) {
          return Buffer.from('');
        }
        if (filePath.endsWith('index.html')) {
          return Buffer.from('<!doctype html><html><body>fallback</body></html>');
        }
        if (filePath.endsWith('.png')) {
          return Buffer.from('png-bytes');
        }
        throw new Error(`unexpected read: ${filePath}`);
      },
      runCommand: async () => ({ exitCode: 0 }),
    } as any,
    uploadToR2: async () => undefined,
    downloadFromR2: async () => Buffer.from(''),
  });

  const snapshot = await service.captureManagedRunPreview({
    sessionId: 'session-fallback',
    runId: 'run-fallback',
    sandboxId: 'sandbox-fallback',
    workspaceRoot: '/workspace/session',
    debugOpenPageSucceeded: true,
  });

  assert.equal(snapshot?.status, 'captured');
  assert.equal(snapshot?.source?.url, 'file:///workspace/session/index.html');
  assert.ok(readPaths.includes('/workspace/session/index.html'));
});
