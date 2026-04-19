import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { closeDatabaseConnection, db } from '../src/config/database';
import { taskSessionDeploymentSyncJobDAO } from '../src/db/dao';
import { taskSessionDeploymentSyncJobs } from '../src/db/schema';

const syncKeyPrefix = 'test-deployment-sync';

function syncKey(name: string) {
  return `${syncKeyPrefix}:${name}:${randomUUID()}`;
}

async function cleanupJobs() {
  await db.execute(
    sql`DELETE FROM task_session_deployment_sync_jobs WHERE sync_key LIKE ${`${syncKeyPrefix}:%`}`
  );
}

async function ensureDeploymentSyncJobTable() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS task_session_deployment_sync_jobs (
      id UUID PRIMARY KEY,
      task_session_id TEXT NOT NULL,
      orchestrator_session_id TEXT NOT NULL,
      sync_key TEXT NOT NULL,
      job_type TEXT NOT NULL DEFAULT 'deployment_panel_sync',
      status TEXT NOT NULL DEFAULT 'pending',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      payload_json JSONB,
      next_retry_at TIMESTAMP,
      started_at TIMESTAMP,
      completed_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_task_session_deployment_sync_jobs_sync_key
    ON task_session_deployment_sync_jobs(sync_key)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_task_session_deployment_sync_jobs_session_status
    ON task_session_deployment_sync_jobs(task_session_id, status)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_task_session_deployment_sync_jobs_orchestrator_session_id
    ON task_session_deployment_sync_jobs(orchestrator_session_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_task_session_deployment_sync_jobs_next_retry_at
    ON task_session_deployment_sync_jobs(next_retry_at)
  `);
}

before(async () => {
  await ensureDeploymentSyncJobTable();
  await cleanupJobs();
});

after(async () => {
  await cleanupJobs();
  await closeDatabaseConnection();
});

test('task session deployment sync job upsert keeps a single active row per sync key', async () => {
  const key = syncKey('upsert');
  const first = await taskSessionDeploymentSyncJobDAO.upsertPending({
    id: randomUUID(),
    taskSessionId: 'session-upsert',
    orchestratorSessionId: 'orch-1',
    syncKey: key,
    jobType: 'deployment_panel_sync',
    status: 'pending',
    payloadJson: {
      selectedDeploymentId: 'dep-1',
      reason: 'deploy_followup',
    },
    nextRetryAt: new Date(Date.now() + 10_000),
  });

  const second = await taskSessionDeploymentSyncJobDAO.upsertPending({
    id: randomUUID(),
    taskSessionId: 'session-upsert',
    orchestratorSessionId: 'orch-2',
    syncKey: key,
    jobType: 'deployment_panel_sync',
    status: 'pending',
    payloadJson: {
      selectedDeploymentId: 'dep-2',
      reason: 'rollback_followup',
    },
    nextRetryAt: null,
  });

  assert.equal(first.id, second.id);

  const stored = await taskSessionDeploymentSyncJobDAO.getBySyncKey(key);
  assert.ok(stored);
  assert.equal(stored.id, first.id);
  assert.equal(stored.orchestratorSessionId, 'orch-2');
  assert.equal(stored.status, 'pending');
  assert.equal((stored.payloadJson as Record<string, unknown>)?.selectedDeploymentId, 'dep-2');
  assert.equal((stored.payloadJson as Record<string, unknown>)?.reason, 'rollback_followup');
});

test('task session deployment sync job listRunnable respects pending schedule and retry state', async () => {
  const futurePending = await taskSessionDeploymentSyncJobDAO.upsertPending({
    id: randomUUID(),
    taskSessionId: 'session-future',
    orchestratorSessionId: 'orch-future',
    syncKey: syncKey('future'),
    jobType: 'deployment_panel_sync',
    status: 'pending',
    payloadJson: { reason: 'followup_sync' },
    nextRetryAt: new Date(Date.now() + 60_000),
  });

  const duePending = await taskSessionDeploymentSyncJobDAO.upsertPending({
    id: randomUUID(),
    taskSessionId: 'session-due',
    orchestratorSessionId: 'orch-due',
    syncKey: syncKey('due'),
    jobType: 'deployment_panel_sync',
    status: 'pending',
    payloadJson: { reason: 'followup_sync' },
    nextRetryAt: new Date(Date.now() - 1_000),
  });

  const running = await taskSessionDeploymentSyncJobDAO.upsertPending({
    id: randomUUID(),
    taskSessionId: 'session-running',
    orchestratorSessionId: 'orch-running',
    syncKey: syncKey('running'),
    jobType: 'deployment_panel_sync',
    status: 'pending',
    payloadJson: { reason: 'followup_sync' },
    nextRetryAt: null,
  });
  await db
    .update(taskSessionDeploymentSyncJobs)
    .set({
      status: 'running',
      updatedAt: new Date(),
    })
    .where(eq(taskSessionDeploymentSyncJobs.id, running.id));

  const failed = await taskSessionDeploymentSyncJobDAO.upsertPending({
    id: randomUUID(),
    taskSessionId: 'session-failed',
    orchestratorSessionId: 'orch-failed',
    syncKey: syncKey('failed'),
    jobType: 'deployment_panel_sync',
    status: 'pending',
    payloadJson: { reason: 'retry_after_error' },
    nextRetryAt: null,
  });
  await db
    .update(taskSessionDeploymentSyncJobs)
    .set({
      status: 'failed',
      nextRetryAt: new Date(Date.now() - 1_000),
      updatedAt: new Date(),
    })
    .where(eq(taskSessionDeploymentSyncJobs.id, failed.id));

  const runnable = await taskSessionDeploymentSyncJobDAO.listRunnable(20);
  const runnableIds = new Set(runnable.map((item) => item.id));

  assert.equal(runnableIds.has(futurePending.id), false);
  assert.equal(runnableIds.has(duePending.id), true);
  assert.equal(runnableIds.has(running.id), true);
  assert.equal(runnableIds.has(failed.id), true);
});
