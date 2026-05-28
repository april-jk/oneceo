import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { ConnectorStorageBootstrap } from '../src/services/connector-storage-bootstrap';

afterEach(() => {
  mock.reset();
});

test('ensureReady skips migration when latest schema is already ready', async () => {
  const inspectSchema = mock.fn(async () => ({ ready: true, missing: [] as string[] }));
  const runMigration = mock.fn(async () => true);
  const bootstrap = new ConnectorStorageBootstrap({ inspectSchema, runMigration });

  await bootstrap.ensureReady();
  await bootstrap.ensureReady();

  assert.equal(inspectSchema.mock.callCount(), 1);
  assert.equal(runMigration.mock.callCount(), 0);
});

test('ensureReady runs migration when schema is incomplete', async () => {
  let ready = false;
  const inspectSchema = mock.fn(async () =>
    ready
      ? { ready: true, missing: [] as string[] }
      : { ready: false, missing: ['column:platform_skills.metadata_json'] }
  );
  const runMigration = mock.fn(async () => {
    ready = true;
    return true;
  });
  const bootstrap = new ConnectorStorageBootstrap({ inspectSchema, runMigration });

  await bootstrap.ensureReady();

  assert.equal(inspectSchema.mock.callCount(), 2);
  assert.equal(runMigration.mock.callCount(), 1);
});

test('ensureReady clears failed bootstrap promise so next call can retry', async () => {
  let ready = false;
  const inspectSchema = mock.fn(async () =>
    ready
      ? { ready: true, missing: [] as string[] }
      : { ready: false, missing: ['index:idx_task_session_recent_messages_session_timeline'] }
  );
  let attempt = 0;
  const runMigration = mock.fn(async () => {
    attempt += 1;
    if (attempt === 1) {
      throw new Error('migration failed');
    }
    ready = true;
    return true;
  });
  const bootstrap = new ConnectorStorageBootstrap({ inspectSchema, runMigration });

  await assert.rejects(() => bootstrap.ensureReady(), /migration failed/);
  await bootstrap.ensureReady();

  assert.equal(inspectSchema.mock.callCount(), 3);
  assert.equal(runMigration.mock.callCount(), 2);
});
