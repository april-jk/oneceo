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
      visualCheck: undefined,
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
        if (command.includes('ONECEO_PREVIEW_SCREENSHOT=')) {
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              ok: true,
              visualCheck: {
                status: 'passed',
                diagnostics: {
                  visibleTextLength: 24,
                  visibleElementCount: 4,
                  uniqueColorCount: 12,
                },
              },
            }),
            stderr: '',
          };
        }
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
  assert.equal(snapshot?.visualCheck?.status, 'passed');
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
      runCommand: async (_sandboxId: string, command: string) => {
        if (command.includes('ONECEO_PREVIEW_SCREENSHOT=')) {
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              ok: true,
              visualCheck: {
                status: 'passed',
                diagnostics: {
                  visibleTextLength: 18,
                  visibleElementCount: 3,
                  uniqueColorCount: 12,
                },
              },
            }),
            stderr: '',
          };
        }
        return { exitCode: 0 };
      },
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
  assert.equal(snapshot?.visualCheck?.status, 'passed');
  assert.ok(readPaths.includes('/workspace/session/index.html'));
});

test('captureManagedRunPreview returns capture_failed when visual check finds blank preview', async () => {
  const service = new TaskSessionWebsitePreviewSnapshotService({
    e2b: {
      readFile: async (_sandboxId: string, filePath: string) => {
        if (filePath.endsWith('oneceo.manifest.json') || filePath.endsWith('package.json')) {
          return Buffer.from('');
        }
        if (filePath.endsWith('index.html')) {
          return Buffer.from('<!doctype html><html><body><div id="root"></div></body></html>');
        }
        if (filePath.endsWith('.png')) {
          return Buffer.from('png-bytes');
        }
        throw new Error(`unexpected read: ${filePath}`);
      },
      runCommand: async (_sandboxId: string, command: string) => {
        if (command.includes('ONECEO_PREVIEW_SCREENSHOT=')) {
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              ok: true,
              visualCheck: {
                status: 'failed',
                reasonCode: 'screenshot_low_entropy',
                message: '截图几乎是单一颜色，疑似白屏或纯色空页面。',
                diagnostics: {
                  visibleTextLength: 0,
                  uniqueColorCount: 1,
                  dominantColorRatio: 1,
                },
              },
            }),
            stderr: '',
          };
        }
        return { exitCode: 0 };
      },
    } as any,
    uploadToR2: async () => {
      throw new Error('blank preview must not be uploaded');
    },
    downloadFromR2: async () => Buffer.from(''),
  });

  const snapshot = await service.captureManagedRunPreview({
    sessionId: 'session-blank',
    runId: 'run-blank',
    sandboxId: 'sandbox-blank',
    workspaceRoot: '/workspace/session',
    deliverables: [{ path: 'index.html' } as any],
    debugOpenPageSucceeded: true,
  });

  assert.equal(snapshot?.status, 'capture_failed');
  assert.equal(snapshot?.reasonCode, 'preview_visual_check_failed');
  assert.equal(snapshot?.visualCheck?.status, 'failed');
  assert.equal(snapshot?.visualCheck?.reasonCode, 'screenshot_low_entropy');
});

test('captureManagedRunPreview preserves app runtime error diagnostics from preview smoke', async () => {
  const service = new TaskSessionWebsitePreviewSnapshotService({
    e2b: {
      readFile: async (_sandboxId: string, filePath: string) => {
        if (filePath.endsWith('oneceo.manifest.json') || filePath.endsWith('package.json')) {
          return Buffer.from('');
        }
        if (filePath.endsWith('index.html')) {
          return Buffer.from('<!doctype html><html><body><div id="root" data-oneceo-app-status="error">页面渲染失败</div></body></html>');
        }
        if (filePath.endsWith('.png')) {
          return Buffer.from('png-bytes');
        }
        throw new Error(`unexpected read: ${filePath}`);
      },
      runCommand: async (_sandboxId: string, command: string) => {
        if (command.includes('ONECEO_PREVIEW_SCREENSHOT=')) {
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              ok: true,
              visualCheck: {
                status: 'failed',
                reasonCode: 'app_runtime_error',
                message: '页面浏览器运行时报错：React is not defined',
                diagnostics: {
                  oneCeoAppStatus: 'error',
                  oneCeoRootStatus: 'error',
                  oneCeoAppErrors: ['React is not defined'],
                  visibleTextLength: 24,
                  uniqueColorCount: 8,
                },
              },
            }),
            stderr: '',
          };
        }
        return { exitCode: 0 };
      },
    } as any,
    uploadToR2: async () => {
      throw new Error('runtime error preview must not be uploaded');
    },
    downloadFromR2: async () => Buffer.from(''),
  });

  const snapshot = await service.captureManagedRunPreview({
    sessionId: 'session-runtime-error',
    runId: 'run-runtime-error',
    sandboxId: 'sandbox-runtime-error',
    workspaceRoot: '/workspace/session',
    deliverables: [{ path: 'index.html' } as any],
    debugOpenPageSucceeded: true,
  });

  assert.equal(snapshot?.status, 'capture_failed');
  assert.equal(snapshot?.reasonCode, 'preview_visual_check_failed');
  assert.equal(snapshot?.visualCheck?.reasonCode, 'app_runtime_error');
  assert.match(snapshot?.visualCheck?.message || '', /React is not defined/);
});
