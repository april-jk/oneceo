/**
 * 数据库迁移脚本
 * 
 * 创建所有必要的数据库表
 */

import { sql } from 'drizzle-orm';
import { db, ensureDatabaseConnection } from '../config/database';

/**
 * 创建数据库表的 SQL 语句
 */
const connectorTablesSQL = `
-- 用户级连接器配置表
CREATE TABLE IF NOT EXISTS user_connector_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  connector_key TEXT NOT NULL,
  auth_mode TEXT NOT NULL,
  auth_status TEXT NOT NULL DEFAULT 'not_configured',
  display_name TEXT,
  config_json JSONB,
  secret_ciphertext TEXT,
  last_auth_at TIMESTAMP,
  last_error TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 任务会话连接器绑定表
CREATE TABLE IF NOT EXISTS task_session_connector_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_session_id TEXT NOT NULL,
  connector_key TEXT NOT NULL,
  desired_state TEXT NOT NULL DEFAULT 'detached',
  runtime_status TEXT NOT NULL DEFAULT 'unknown',
  orchestrator_session_id TEXT,
  server_name TEXT,
  last_used_at TIMESTAMP,
  last_error TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- OAuth 请求事务表
CREATE TABLE IF NOT EXISTS connector_auth_requests (
  request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  connector_key TEXT NOT NULL,
  provider TEXT NOT NULL,
  state TEXT NOT NULL,
  code_verifier TEXT,
  return_to_session_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_connector_accounts_user_connector ON user_connector_accounts(user_id, connector_key);
CREATE INDEX IF NOT EXISTS idx_user_connector_accounts_user_id ON user_connector_accounts(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_session_connector_bindings_session_connector
  ON task_session_connector_bindings(task_session_id, connector_key);
CREATE INDEX IF NOT EXISTS idx_task_session_connector_bindings_task_session_id
  ON task_session_connector_bindings(task_session_id);
CREATE INDEX IF NOT EXISTS idx_task_session_connector_bindings_orchestrator_session_id
  ON task_session_connector_bindings(orchestrator_session_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_connector_auth_requests_state ON connector_auth_requests(state);
CREATE INDEX IF NOT EXISTS idx_connector_auth_requests_user_id ON connector_auth_requests(user_id);
`;

const createTablesSQL = `
CREATE SEQUENCE IF NOT EXISTS conversation_message_timeline_cursor_seq;

-- 任务创建会话表
CREATE TABLE IF NOT EXISTS task_creation_sessions (
  id UUID PRIMARY KEY,
  user_id TEXT,
  status TEXT NOT NULL DEFAULT 'in_progress',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP
);

-- 对话消息表
CREATE TABLE IF NOT EXISTS conversation_messages (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES task_creation_sessions(id) ON DELETE CASCADE,
  message_key TEXT,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  message_type TEXT,
  metadata JSONB,
  timeline_cursor BIGINT DEFAULT nextval('conversation_message_timeline_cursor_seq'),
  runtime_generation INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 会话最近消息热缓存表
CREATE TABLE IF NOT EXISTS task_session_recent_messages (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES task_creation_sessions(id) ON DELETE CASCADE,
  message_id UUID,
  message_key TEXT,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  message_type TEXT,
  metadata JSONB,
  timeline_cursor BIGINT,
  runtime_generation INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 意图识别结果表
CREATE TABLE IF NOT EXISTS intent_recognition_results (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES task_creation_sessions(id) ON DELETE CASCADE,
  user_input TEXT NOT NULL,
  intent_type TEXT NOT NULL,
  confidence INTEGER NOT NULL,
  key_info JSONB NOT NULL,
  clarification_needed BOOLEAN NOT NULL DEFAULT FALSE,
  clarification_questions JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 任务描述表
CREATE TABLE IF NOT EXISTS task_descriptions (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES task_creation_sessions(id) ON DELETE CASCADE,
  intent_result_id UUID NOT NULL REFERENCES intent_recognition_results(id),
  title TEXT NOT NULL,
  objective TEXT NOT NULL,
  scope TEXT,
  deliverables JSONB NOT NULL,
  constraints JSONB,
  additional_info JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 执行计划表
CREATE TABLE IF NOT EXISTS execution_plans (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES task_creation_sessions(id) ON DELETE CASCADE,
  task_description_id UUID NOT NULL REFERENCES task_descriptions(id),
  project_title TEXT NOT NULL,
  project_description TEXT,
  estimated_total_hours INTEGER,
  managers JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 搜索记录表
CREATE TABLE IF NOT EXISTS search_records (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES task_creation_sessions(id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  results JSONB,
  source TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Sandbox 执行环境表
CREATE TABLE IF NOT EXISTS sandbox_execution_environments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL UNIQUE,
  orchestrator_session_id TEXT NOT NULL,
  vm_name TEXT,
  base_image TEXT NOT NULL,
  incremental_storage_dir TEXT NOT NULL,
  incremental_file_name TEXT NOT NULL,
  incremental_file_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'creating',
  security_profile JSONB NOT NULL,
  network_policy JSONB NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMP
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_conversation_messages_session_id ON conversation_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_task_session_recent_messages_session_id
  ON task_session_recent_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_task_session_recent_messages_session_created_at
  ON task_session_recent_messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_intent_recognition_results_session_id ON intent_recognition_results(session_id);
CREATE INDEX IF NOT EXISTS idx_task_descriptions_session_id ON task_descriptions(session_id);
CREATE INDEX IF NOT EXISTS idx_execution_plans_session_id ON execution_plans(session_id);
CREATE INDEX IF NOT EXISTS idx_search_records_session_id ON search_records(session_id);
CREATE INDEX IF NOT EXISTS idx_sandbox_execution_environments_session_id ON sandbox_execution_environments(session_id);
CREATE INDEX IF NOT EXISTS idx_sandbox_execution_environments_status ON sandbox_execution_environments(status);
CREATE INDEX IF NOT EXISTS idx_task_creation_sessions_status ON task_creation_sessions(status);
CREATE INDEX IF NOT EXISTS idx_task_creation_sessions_created_at ON task_creation_sessions(created_at);
${connectorTablesSQL}
`;

const backfillMessageStorageSQL = `
CREATE SEQUENCE IF NOT EXISTS conversation_message_timeline_cursor_seq;

ALTER TABLE conversation_messages
  ADD COLUMN IF NOT EXISTS message_key TEXT,
  ADD COLUMN IF NOT EXISTS timeline_cursor BIGINT,
  ADD COLUMN IF NOT EXISTS runtime_generation INTEGER,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

ALTER TABLE task_session_recent_messages
  ADD COLUMN IF NOT EXISTS message_id UUID,
  ADD COLUMN IF NOT EXISTS message_key TEXT,
  ADD COLUMN IF NOT EXISTS timeline_cursor BIGINT,
  ADD COLUMN IF NOT EXISTS runtime_generation INTEGER,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

UPDATE conversation_messages
SET message_key = COALESCE(NULLIF(metadata->>'messageKey', ''), 'db:' || id::text)
WHERE message_key IS NULL;

UPDATE conversation_messages
SET runtime_generation = CASE
  WHEN metadata ? 'runtimeGeneration' AND (metadata->>'runtimeGeneration') ~ '^[0-9]+$'
    THEN (metadata->>'runtimeGeneration')::INTEGER
  ELSE runtime_generation
END
WHERE runtime_generation IS NULL;

WITH ranked_duplicates AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY session_id, message_key
      ORDER BY COALESCE(updated_at, created_at) DESC, created_at DESC, id DESC
    ) AS rn
  FROM conversation_messages
  WHERE message_key IS NOT NULL
)
DELETE FROM conversation_messages cm
USING ranked_duplicates rd
WHERE cm.id = rd.id
  AND rd.rn > 1;

WITH ranked AS (
  SELECT
    id,
    COALESCE(
      CASE WHEN metadata ? 'timelineCursor' AND (metadata->>'timelineCursor') ~ '^[0-9]+$'
        THEN (metadata->>'timelineCursor')::BIGINT END,
      CASE WHEN metadata ? 'sessionEventSeq' AND (metadata->>'sessionEventSeq') ~ '^[0-9]+$'
        THEN (metadata->>'sessionEventSeq')::BIGINT END,
      ((EXTRACT(EPOCH FROM created_at) * 1000000)::BIGINT
        + ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY created_at ASC, id ASC))
    ) AS resolved_cursor
  FROM conversation_messages
)
UPDATE conversation_messages cm
SET timeline_cursor = ranked.resolved_cursor
FROM ranked
WHERE cm.id = ranked.id
  AND cm.timeline_cursor IS NULL;

ALTER TABLE conversation_messages
  ALTER COLUMN message_key SET NOT NULL,
  ALTER COLUMN timeline_cursor SET NOT NULL,
  ALTER COLUMN timeline_cursor SET DEFAULT nextval('conversation_message_timeline_cursor_seq');

SELECT setval(
  'conversation_message_timeline_cursor_seq',
  COALESCE((SELECT MAX(timeline_cursor) FROM conversation_messages), 1),
  true
);

CREATE INDEX IF NOT EXISTS idx_conversation_messages_session_id ON conversation_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_session_timeline
  ON conversation_messages(session_id, timeline_cursor);
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_messages_session_message_key
  ON conversation_messages(session_id, message_key);

DELETE FROM task_session_recent_messages;

INSERT INTO task_session_recent_messages (
  id,
  session_id,
  message_id,
  message_key,
  role,
  content,
  message_type,
  metadata,
  timeline_cursor,
  runtime_generation,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid(),
  ranked.session_id,
  ranked.id,
  ranked.message_key,
  ranked.role,
  ranked.content,
  ranked.message_type,
  ranked.metadata,
  ranked.timeline_cursor,
  ranked.runtime_generation,
  ranked.created_at,
  COALESCE(ranked.updated_at, NOW())
FROM (
  SELECT
    cm.*,
    ROW_NUMBER() OVER (PARTITION BY cm.session_id ORDER BY cm.timeline_cursor DESC, cm.created_at DESC, cm.id DESC) AS rn
  FROM conversation_messages cm
) ranked
WHERE ranked.rn <= 50;

UPDATE task_session_recent_messages
SET
  message_id = COALESCE(message_id, id),
  message_key = COALESCE(message_key, 'db:' || id::text),
  timeline_cursor = COALESCE(
    timeline_cursor,
    CASE WHEN metadata ? 'timelineCursor' AND (metadata->>'timelineCursor') ~ '^[0-9]+$'
      THEN (metadata->>'timelineCursor')::BIGINT END,
    CASE WHEN metadata ? 'sessionEventSeq' AND (metadata->>'sessionEventSeq') ~ '^[0-9]+$'
      THEN (metadata->>'sessionEventSeq')::BIGINT END,
    (EXTRACT(EPOCH FROM created_at) * 1000000)::BIGINT
  );

ALTER TABLE task_session_recent_messages
  ALTER COLUMN message_id SET NOT NULL,
  ALTER COLUMN message_key SET NOT NULL,
  ALTER COLUMN timeline_cursor SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_task_session_recent_messages_session_id
  ON task_session_recent_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_task_session_recent_messages_session_timeline
  ON task_session_recent_messages(session_id, timeline_cursor);
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_session_recent_messages_session_message_key
  ON task_session_recent_messages(session_id, message_key);
CREATE INDEX IF NOT EXISTS idx_task_session_recent_messages_session_created_at
  ON task_session_recent_messages(session_id, created_at);
`;

/**
 * 运行数据库迁移
 */
export async function runMigration() {
  try {
    console.log('🚀 开始数据库迁移...');
    await ensureDatabaseConnection({ retries: 5, delayMs: 1200 });
    
    // 执行创建表的 SQL
    await db.execute(sql.raw(createTablesSQL));
    await db.execute(sql.raw(backfillMessageStorageSQL));
    
    console.log('✅ 数据库迁移完成！');
    console.log('已创建以下表：');
    console.log('  - task_creation_sessions');
    console.log('  - conversation_messages');
    console.log('  - task_session_recent_messages');
    console.log('  - intent_recognition_results');
    console.log('  - task_descriptions');
    console.log('  - execution_plans');
    console.log('  - search_records');
    console.log('  - sandbox_execution_environments');
    console.log('  - user_connector_accounts');
    console.log('  - task_session_connector_bindings');
    console.log('  - connector_auth_requests');
    
    return true;
  } catch (error) {
    console.error('❌ 数据库迁移失败:', error);
    throw error;
  }
}

export async function runConnectorMigration() {
  try {
    await ensureDatabaseConnection({ retries: 5, delayMs: 1200 });
    await db.execute(sql.raw(connectorTablesSQL));
    return true;
  } catch (error) {
    console.error('❌ 连接器表迁移失败:', error);
    throw error;
  }
}

/**
 * 删除所有表（谨慎使用）
 */
export async function dropAllTables() {
  try {
    console.log('⚠️  开始删除所有表...');
    await ensureDatabaseConnection({ retries: 5, delayMs: 1200 });
    
    await db.execute(sql.raw(`
      DROP TABLE IF EXISTS search_records CASCADE;
      DROP TABLE IF EXISTS execution_plans CASCADE;
      DROP TABLE IF EXISTS task_descriptions CASCADE;
      DROP TABLE IF EXISTS intent_recognition_results CASCADE;
      DROP TABLE IF EXISTS conversation_messages CASCADE;
      DROP TABLE IF EXISTS task_session_recent_messages CASCADE;
      DROP TABLE IF EXISTS sandbox_execution_environments CASCADE;
      DROP TABLE IF EXISTS task_session_connector_bindings CASCADE;
      DROP TABLE IF EXISTS connector_auth_requests CASCADE;
      DROP TABLE IF EXISTS user_connector_accounts CASCADE;
      DROP TABLE IF EXISTS task_creation_sessions CASCADE;
    `));
    
    console.log('✅ 所有表已删除');
    return true;
  } catch (error) {
    console.error('❌ 删除表失败:', error);
    throw error;
  }
}

// 如果直接运行此脚本，执行迁移
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigration()
    .then(() => {
      console.log('迁移完成，退出...');
      process.exit(0);
    })
    .catch((error) => {
      console.error('迁移失败:', error);
      process.exit(1);
    });
}
