import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { closeDatabaseConnection, db } from '../src/config/database';
import {
  connectorGuidePolicies,
  connectorGuideRevisions,
  taskCreationSessions,
  taskSessionConnectorBindings,
  taskSessionConnectorGuides,
  userConnectorProfiles,
} from '../src/db/schema';
import { connectorSecretService } from '../src/services/connector-secret-service';
import { connectorGuideService } from '../src/services/connector-guide-service';
import { sessionConnectorService } from '../src/services/session-connector-service';
import { sandboxExecutionEnvironmentDAO } from '../src/db/dao';

type SeededUserProfile = {
  userId: string;
  profileId: string;
};

const redisUrl = 'redis://127.0.0.1:6379/15';
let redis: Redis | null = null;
const createdSessionIds = new Set<string>();
const createdProfileIds = new Set<string>();
const originalGetSandboxEnvironment = sandboxExecutionEnvironmentDAO.getBySessionId.bind(
  sandboxExecutionEnvironmentDAO
);
const seededPolicyIds = new Set<string>();
const seededRevisionIds = new Set<string>();

function uniqueId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

async function cleanupSessions() {
  const ids = Array.from(createdSessionIds);
  if (ids.length === 0) return;
  await db
    .delete(taskSessionConnectorGuides)
    .where(inArray(taskSessionConnectorGuides.taskSessionId, ids));
  await db
    .delete(taskSessionConnectorBindings)
    .where(inArray(taskSessionConnectorBindings.taskSessionId, ids));
  await db.delete(taskCreationSessions).where(inArray(taskCreationSessions.id, ids as [string, ...string[]]));
  createdSessionIds.clear();
}

async function cleanupProfiles() {
  const ids = Array.from(createdProfileIds);
  if (ids.length === 0) return;
  await db.delete(userConnectorProfiles).where(inArray(userConnectorProfiles.id, ids as [string, ...string[]]));
  createdProfileIds.clear();
}

async function cleanupGuideSeeds() {
  const revisionIds = Array.from(seededRevisionIds);
  const policyIds = Array.from(seededPolicyIds);
  if (revisionIds.length > 0) {
    await db
      .delete(taskSessionConnectorGuides)
      .where(inArray(taskSessionConnectorGuides.revisionId, revisionIds as [string, ...string[]]));
    await db
      .delete(connectorGuideRevisions)
      .where(inArray(connectorGuideRevisions.id, revisionIds as [string, ...string[]]));
    seededRevisionIds.clear();
  }
  if (policyIds.length > 0) {
    await db
      .delete(connectorGuidePolicies)
      .where(inArray(connectorGuidePolicies.id, policyIds as [string, ...string[]]));
    seededPolicyIds.clear();
  }
}

async function createSession(userId: string) {
  const id = randomUUID();
  createdSessionIds.add(id);
  const [row] = await db
    .insert(taskCreationSessions)
    .values({
      id,
      userId,
      status: 'in_progress',
    })
    .returning();
  return row;
}

async function createSupabaseProfile(userId: string, suffix: string): Promise<SeededUserProfile> {
  const profileId = randomUUID();
  createdProfileIds.add(profileId);
  await db.insert(userConnectorProfiles).values({
    id: profileId,
    userId,
    connectorKey: 'supabase',
    profileName: `supabase-${suffix}`,
    displayName: `supabase-${suffix}`,
    authMode: 'token',
    authStatus: 'authorized',
    configJson: {},
    secretCiphertext: connectorSecretService.encrypt({
      accessToken: `token-${suffix}`,
    }),
    metadataJson: null,
    isDefault: false,
  });
  return {
    userId,
    profileId,
  };
}

async function countRedisKeys() {
  if (!redis) return 0;
  return redis.dbsize();
}

async function seedSupabaseGuide() {
  const policyId = randomUUID();
  const revisionId = randomUUID();
  seededPolicyIds.add(policyId);
  seededRevisionIds.add(revisionId);
  await db.insert(connectorGuidePolicies).values({
    id: policyId,
    connectorKey: 'supabase',
    status: 'active',
    triggerMode: 'on_attach',
    description: 'Supabase connector prompt guide',
    publishedRevisionId: revisionId,
    createdBy: 'test-suite',
  });
  await db.insert(connectorGuideRevisions).values({
    id: revisionId,
    policyId,
    versionNumber: 1,
    status: 'published',
    serverInstructionsMarkdown: 'supabase instructions',
    guideReminderMarkdown: 'supabase reminder',
    blockingRulesMarkdown: 'supabase blocking',
    notes: 'test',
    createdBy: 'test-suite',
    publishedAt: new Date(),
  });
}

async function ensureIsolationTables() {
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS task_creation_sessions (
      id uuid PRIMARY KEY,
      user_id text,
      status text NOT NULL DEFAULT 'in_progress',
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now(),
      completed_at timestamp
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS user_connector_profiles (
      id uuid PRIMARY KEY,
      user_id text NOT NULL,
      connector_key text NOT NULL,
      profile_name text NOT NULL,
      display_name text,
      auth_mode text NOT NULL,
      auth_status text NOT NULL DEFAULT 'not_configured',
      config_json jsonb,
      secret_ciphertext text,
      metadata_json jsonb,
      is_default boolean NOT NULL DEFAULT false,
      last_auth_at timestamp,
      last_error text,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_connector_profiles_user_connector_profile
    ON user_connector_profiles (user_id, connector_key, profile_name)
  `);
  await db.execute(sql`
    ALTER TABLE user_connector_profiles
    ALTER COLUMN id SET DEFAULT gen_random_uuid()
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS task_session_connector_bindings (
      id uuid PRIMARY KEY,
      task_session_id text NOT NULL,
      connector_key text NOT NULL,
      profile_id text,
      desired_state text NOT NULL DEFAULT 'detached',
      runtime_status text NOT NULL DEFAULT 'unknown',
      orchestrator_session_id text,
      server_name text,
      runtime_provider_id text,
      runtime_env_version integer NOT NULL DEFAULT 0,
      runtime_transport text,
      runtime_attached_tools_json jsonb,
      runtime_last_started_at timestamp,
      runtime_last_stopped_at timestamp,
      recovery_queued_at timestamp,
      recovery_started_at timestamp,
      recovery_completed_at timestamp,
      enabled_tools jsonb,
      session_config_json jsonb,
      definition_snapshot_json jsonb,
      last_used_at timestamp,
      last_error text,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_task_session_connector_bindings_session_connector
    ON task_session_connector_bindings (task_session_id, connector_key)
  `);
  await db.execute(sql`
    ALTER TABLE task_session_connector_bindings
    ALTER COLUMN id SET DEFAULT gen_random_uuid()
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS connector_guide_policies (
      id uuid PRIMARY KEY,
      connector_key text NOT NULL,
      status text NOT NULL DEFAULT 'draft',
      trigger_mode text NOT NULL DEFAULT 'on_attach',
      description text NOT NULL DEFAULT '',
      published_revision_id uuid,
      created_by text,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_connector_guide_policies_connector_key
    ON connector_guide_policies (connector_key)
  `);
  await db.execute(sql`
    ALTER TABLE connector_guide_policies
    ALTER COLUMN id SET DEFAULT gen_random_uuid()
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS connector_guide_revisions (
      id uuid PRIMARY KEY,
      policy_id uuid NOT NULL,
      version_number integer NOT NULL,
      status text NOT NULL DEFAULT 'draft',
      server_instructions_markdown text NOT NULL DEFAULT '',
      guide_reminder_markdown text NOT NULL DEFAULT '',
      blocking_rules_markdown text NOT NULL DEFAULT '',
      notes text NOT NULL DEFAULT '',
      created_by text,
      created_at timestamp NOT NULL DEFAULT now(),
      published_at timestamp
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_connector_guide_revisions_policy_version
    ON connector_guide_revisions (policy_id, version_number)
  `);
  await db.execute(sql`
    ALTER TABLE connector_guide_revisions
    ALTER COLUMN id SET DEFAULT gen_random_uuid()
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS task_session_connector_guides (
      id uuid PRIMARY KEY,
      task_session_id text NOT NULL,
      connector_key text NOT NULL,
      policy_id uuid NOT NULL,
      revision_id uuid NOT NULL,
      trigger_mode text NOT NULL,
      resolved_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_task_session_connector_guides_session_connector
    ON task_session_connector_guides (task_session_id, connector_key)
  `);
  await db.execute(sql`
    ALTER TABLE task_session_connector_guides
    ALTER COLUMN id SET DEFAULT gen_random_uuid()
  `);
}

before(async () => {
  redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  await redis.connect();
  await redis.flushdb();
  await ensureIsolationTables();
  await cleanupGuideSeeds();
  await seedSupabaseGuide();
});

after(async () => {
  sandboxExecutionEnvironmentDAO.getBySessionId = originalGetSandboxEnvironment;
  await cleanupSessions();
  await cleanupProfiles();
  await cleanupGuideSeeds();
  if (redis) {
    await redis.flushdb();
    await redis.quit();
    redis = null;
  }
  await closeDatabaseConnection();
});

test('session runtime attach enforces user-scoped profile ownership and leaves Redis untouched', async () => {
  const userA = uniqueId('connector-user-a');
  const userB = uniqueId('connector-user-b');
  const sessionA = await createSession(userA);
  const profileA = await createSupabaseProfile(userA, 'a');
  const profileB = await createSupabaseProfile(userB, 'b');
  const redisBefore = await countRedisKeys();

  const attached = await sessionConnectorService.attachConnector(
    sessionA.id,
    userA,
    'supabase',
    profileA.profileId,
    [],
    {}
  );
  assert.equal(attached?.connectorKey, 'supabase');

  await assert.rejects(
    () =>
      sessionConnectorService.attachConnector(sessionA.id, userA, 'supabase', profileB.profileId, [], {}),
    /连接器 profile 不存在或不属于当前连接器/
  );

  const [binding] = await db
    .select()
    .from(taskSessionConnectorBindings)
    .where(
      and(
        eq(taskSessionConnectorBindings.taskSessionId, sessionA.id),
        eq(taskSessionConnectorBindings.connectorKey, 'supabase')
      )
    );

  assert.ok(binding);
  assert.equal(binding.profileId, profileA.profileId);
  assert.equal(binding.desiredState, 'attached');
  assert.equal(binding.runtimeStatus, 'pending_recover');
  assert.equal(await countRedisKeys(), redisBefore);
});

test('guide projection is isolated per session binding and follows session ownership only', async () => {
  const userA = uniqueId('guide-user-a');
  const userB = uniqueId('guide-user-b');
  const sessionA = await createSession(userA);
  const sessionB = await createSession(userB);
  const profileA = await createSupabaseProfile(userA, 'guide-a');

  await sessionConnectorService.attachConnector(sessionA.id, userA, 'supabase', profileA.profileId, [], {});
  await connectorGuideService.recomputeSessionGuides(sessionA.id);
  await connectorGuideService.recomputeSessionGuides(sessionB.id);

  const guidesA = await connectorGuideService.listSessionGuides(sessionA.id);
  const guidesB = await connectorGuideService.listSessionGuides(sessionB.id);

  assert.equal(guidesA.length, 1);
  assert.equal(guidesA[0]?.sessionGuide.taskSessionId, sessionA.id);
  assert.equal(guidesA[0]?.sessionGuide.connectorKey, 'supabase');
  assert.equal(guidesB.length, 0);
  assert.equal(await countRedisKeys(), 0);
});

test('runtime recovery reconciles by session owner instead of foreign profile owner', async () => {
  const userA = uniqueId('runtime-user-a');
  const userB = uniqueId('runtime-user-b');
  const sessionA = await createSession(userA);
  const foreignProfile = await createSupabaseProfile(userB, 'runtime-b');

  await db.insert(taskSessionConnectorBindings).values({
    taskSessionId: sessionA.id,
    connectorKey: 'supabase',
    profileId: foreignProfile.profileId,
    desiredState: 'attached',
    runtimeStatus: 'pending_recover',
    orchestratorSessionId: 'orch-runtime-a',
    serverName: 'supabase--runtime-a',
    runtimeProviderId: 'provider-runtime-a',
    runtimeEnvVersion: 1,
    runtimeTransport: 'remote_sse',
    runtimeAttachedToolsJson: [],
    enabledTools: [],
    sessionConfigJson: {},
    definitionSnapshotJson: { key: 'supabase' },
    recoveryQueuedAt: new Date(),
  });

  sandboxExecutionEnvironmentDAO.getBySessionId = async (orchestratorSessionId: string) => {
    assert.equal(orchestratorSessionId, 'orch-runtime-a');
    return {
      sessionId: orchestratorSessionId,
      status: 'ready',
      metadata: {
        taskSessionId: sessionA.id,
      },
    } as any;
  };

  await sessionConnectorService.reconcileByOrchestratorSessionId('orch-runtime-a');

  const [binding] = await db
    .select()
    .from(taskSessionConnectorBindings)
    .where(
      and(
        eq(taskSessionConnectorBindings.taskSessionId, sessionA.id),
        eq(taskSessionConnectorBindings.connectorKey, 'supabase')
      )
    );

  assert.ok(binding);
  assert.equal(binding.profileId, foreignProfile.profileId);
  assert.equal(binding.runtimeStatus, 'failed');
  assert.match(String(binding.lastError || ''), /连接器 profile 不存在或不属于当前连接器/);
  assert.equal(await countRedisKeys(), 0);
});
