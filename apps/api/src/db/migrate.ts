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
const createTablesSQL = `
-- 任务创建会话表
CREATE TABLE IF NOT EXISTS task_creation_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT,
  status TEXT NOT NULL DEFAULT 'in_progress',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP
);

-- 对话消息表
CREATE TABLE IF NOT EXISTS conversation_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES task_creation_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  message_type TEXT,
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 意图识别结果表
CREATE TABLE IF NOT EXISTS intent_recognition_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES task_creation_sessions(id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  results JSONB,
  source TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_conversation_messages_session_id ON conversation_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_intent_recognition_results_session_id ON intent_recognition_results(session_id);
CREATE INDEX IF NOT EXISTS idx_task_descriptions_session_id ON task_descriptions(session_id);
CREATE INDEX IF NOT EXISTS idx_execution_plans_session_id ON execution_plans(session_id);
CREATE INDEX IF NOT EXISTS idx_search_records_session_id ON search_records(session_id);
CREATE INDEX IF NOT EXISTS idx_task_creation_sessions_status ON task_creation_sessions(status);
CREATE INDEX IF NOT EXISTS idx_task_creation_sessions_created_at ON task_creation_sessions(created_at);
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
    
    console.log('✅ 数据库迁移完成！');
    console.log('已创建以下表：');
    console.log('  - task_creation_sessions');
    console.log('  - conversation_messages');
    console.log('  - intent_recognition_results');
    console.log('  - task_descriptions');
    console.log('  - execution_plans');
    console.log('  - search_records');
    
    return true;
  } catch (error) {
    console.error('❌ 数据库迁移失败:', error);
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
