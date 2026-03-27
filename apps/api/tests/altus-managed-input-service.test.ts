import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { taskSessionRunDAO } from '../src/db/dao';
import { e2bConnector } from '../src/connectors/e2b-connector';
import { AltusManagedInputService } from '../src/services/altus-managed-input-service';

afterEach(() => {
  mock.reset();
});

test('submit uploads attachments, persists context metadata, and starts managed run', async () => {
  mock.method(taskSessionRunDAO, 'findActiveRun', async () => null);
  const mkdirMock = mock.method(e2bConnector, 'runCommand', async () => ({
    stdout: '',
    stderr: '',
    exitCode: 0,
  }) as any);
  const writeFileMock = mock.method(e2bConnector, 'writeFile', async () => undefined);
  const touchMock = mock.fn(async () => undefined);

  const setupService = {
    ensureSessionOwnership: mock.fn(async () => undefined),
    ensureSandbox: mock.fn(async () => ({
      sandboxId: 'sandbox-1',
      workspaceRoot: '/workspace/session-1',
      reused: false,
    })),
  };
  const runService = {
    startRun: mock.fn(async (_sessionId: string, _userId: string, input: any) => ({
      id: 'run-1',
      sessionId: 'session-1',
      status: 'queued',
      input,
    })),
  };

  const service = new AltusManagedInputService(setupService as any, runService as any, touchMock as any);
  const result = await service.submit('user-1', {
    sessionId: 'session-1',
    content: '请根据附件继续处理',
    messageKey: 'msg-1',
    metadata: { source: 'chat' },
    files: [
      {
        name: 'spec.md',
        mimeType: 'text/markdown',
        size: 16,
        buffer: Buffer.from('# Hello attachment'),
      },
    ],
  });

  assert.equal(result.sessionId, 'session-1');
  assert.equal(setupService.ensureSessionOwnership.mock.callCount(), 1);
  assert.equal(setupService.ensureSandbox.mock.callCount(), 1);
  assert.equal(mkdirMock.mock.callCount(), 1);
  assert.equal(writeFileMock.mock.callCount(), 1);
  assert.equal(touchMock.mock.callCount(), 1);

  const writeCall = writeFileMock.mock.calls[0];
  assert.match(String(writeCall?.arguments[1]), /^\/workspace\/session-1\/uploads\//);

  const startRunCall = runService.startRun.mock.calls[0];
  assert.equal(startRunCall?.arguments[0], 'session-1');
  assert.equal(startRunCall?.arguments[1], 'user-1');
  assert.match(String(startRunCall?.arguments[2]?.content), /\[Attached: spec\.md -> uploads\//);
  assert.equal(startRunCall?.arguments[2]?.metadata?.source, 'chat');
  assert.equal(startRunCall?.arguments[2]?.metadata?.attachments?.length, 1);
  assert.equal(startRunCall?.arguments[2]?.metadata?.attachmentContext?.length, 1);
  assert.match(
    String(startRunCall?.arguments[2]?.metadata?.attachmentContext?.[0]?.excerpt),
    /# Hello attachment/
  );
});
