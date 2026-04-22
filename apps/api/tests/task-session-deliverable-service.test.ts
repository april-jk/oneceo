import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { taskSessionDeliverableArtifactDAO } from '../src/db/dao';
import { e2bConnector } from '../src/connectors/e2b-connector';
import { TaskSessionDeliverableService } from '../src/services/task-session-deliverable-service';

test('persistManagedRunDeliverables archives directory attachments before upload', async () => {
  class TestDeliverableService extends TaskSessionDeliverableService {
    uploaded: Array<{ storageKey: string; bytes: Buffer }> = [];

    protected override async uploadDeliverable(storageKey: string, bytes: Buffer): Promise<void> {
      this.uploaded.push({ storageKey, bytes });
    }
  }

  const service = new TestDeliverableService();
  const commands: string[] = [];
  const previousEnv = {
    R2_BUCKET_NAME: process.env.R2_BUCKET_NAME,
    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
  };

  process.env.R2_BUCKET_NAME = 'test-bucket';
  process.env.R2_ACCOUNT_ID = 'test-account';
  process.env.R2_ACCESS_KEY_ID = 'test-key';
  process.env.R2_SECRET_ACCESS_KEY = 'test-secret';

  mock.method(e2bConnector, 'runCommand', async (_sandboxId: string, command: string) => {
    commands.push(command);
    if (command.includes("printf 'directory'")) {
      return { stdout: 'directory', stderr: '', exitCode: 0 } as any;
    }
    return { stdout: '', stderr: '', exitCode: 0 } as any;
  });
  mock.method(e2bConnector, 'readFile', async (_sandboxId: string, filePath: string) => {
    assert.match(filePath, /oneceo-deliverable-.*\.tar\.gz$/);
    return Uint8Array.from(Buffer.from('archived-directory-bytes'));
  });
  mock.method(taskSessionDeliverableArtifactDAO, 'createMany', async (records: any[]) =>
    records.map((record, index) => ({
      id: `artifact-${index + 1}`,
      ...record,
      createdAt: new Date('2026-04-22T00:00:00.000Z'),
    })),
  );

  try {
    const result = await service.persistManagedRunDeliverables({
      sessionId: 'session-1',
      runId: 'run-1',
      sandboxId: 'sandbox-1',
      workspaceRoot: '/workspace',
      attachments: [
        {
          path: 'acrylic-export-website',
          name: 'acrylic-export-website.zip',
          mimeType: 'application/zip',
        },
      ],
    });

    assert.equal(result.length, 1);
    assert.equal(result[0]?.path, 'acrylic-export-website');
    assert.equal(result[0]?.name, 'acrylic-export-website.tar.gz');
    assert.equal(result[0]?.mimeType, 'application/gzip');
    assert.equal(service.uploaded.length, 1);
    assert.equal(service.uploaded[0]?.bytes.toString('utf8'), 'archived-directory-bytes');
    assert.ok(commands.some((command) => command.includes("tar -czf '")));
    assert.ok(commands.some((command) => command.includes("'acrylic-export-website'")));
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (typeof value === 'string') {
        process.env[key] = value;
      } else {
        delete process.env[key];
      }
    }
    mock.restoreAll();
  }
});
