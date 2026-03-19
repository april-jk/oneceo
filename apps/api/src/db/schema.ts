/**
 * 数据库 Schema 定义
 * 
 * 使用 Drizzle ORM 定义数据库表结构
 */

import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, jsonb, uuid, integer, boolean, uniqueIndex, index, bigint } from 'drizzle-orm/pg-core';

/**
 * 任务创建会话表
 * 
 * 记录每次任务创建的会话信息
 */
export const taskCreationSessions = pgTable('task_creation_sessions', {
  id: uuid('id').primaryKey(),
  userId: text('user_id'), // 用户ID（可选，未来可以关联用户系统）
  status: text('status').notNull().default('in_progress'), // in_progress, completed, failed
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  completedAt: timestamp('completed_at'),
});

/**
 * 对话消息表
 * 
 * 记录任务创建过程中的所有对话消息
 */
export const conversationMessages = pgTable('conversation_messages', {
  id: uuid('id').primaryKey(),
  sessionId: uuid('session_id').notNull().references(() => taskCreationSessions.id, { onDelete: 'cascade' }),
  messageKey: text('message_key').notNull(),
  role: text('role').notNull(), // user, agent, system
  content: text('content').notNull(),
  messageType: text('message_type'), // layer1_result, layer2_result, layer3_result, clarification, etc.
  metadata: jsonb('metadata'), // 存储额外的元数据
  timelineCursor: bigint('timeline_cursor', { mode: 'number' })
    .notNull()
    .default(sql`nextval('conversation_message_timeline_cursor_seq')`),
  runtimeGeneration: integer('runtime_generation'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  sessionMessageKeyUnique: uniqueIndex('idx_conversation_messages_session_message_key').on(
    table.sessionId,
    table.messageKey
  ),
  sessionTimelineIdx: index('idx_conversation_messages_session_timeline').on(table.sessionId, table.timelineCursor),
  sessionIdIdx: index('idx_conversation_messages_session_id').on(table.sessionId),
}));

/**
 * 会话最近消息热缓存表
 *
 * 为直通模式提供首屏秒开能力，仅保留每个会话最近可渲染消息窗口。
 */
export const taskSessionRecentMessages = pgTable(
  'task_session_recent_messages',
  {
    id: uuid('id').primaryKey(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => taskCreationSessions.id, { onDelete: 'cascade' }),
    messageId: uuid('message_id').notNull(),
    messageKey: text('message_key').notNull(),
    role: text('role').notNull(),
    content: text('content').notNull(),
    messageType: text('message_type'),
    metadata: jsonb('metadata'),
    timelineCursor: bigint('timeline_cursor', { mode: 'number' }).notNull(),
    runtimeGeneration: integer('runtime_generation'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    sessionMessageKeyUnique: uniqueIndex('idx_task_session_recent_messages_session_message_key').on(
      table.sessionId,
      table.messageKey
    ),
    sessionIdIdx: index('idx_task_session_recent_messages_session_id').on(table.sessionId),
    sessionTimelineIdx: index('idx_task_session_recent_messages_session_timeline').on(
      table.sessionId,
      table.timelineCursor
    ),
    sessionCreatedAtIdx: index('idx_task_session_recent_messages_session_created_at').on(table.sessionId, table.createdAt),
  })
);

export const taskSessionWorkspaceCache = pgTable(
  'task_session_workspace_cache',
  {
    id: uuid('id').primaryKey(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => taskCreationSessions.id, { onDelete: 'cascade' }),
    tenantKey: text('tenant_key').notNull(),
    cacheType: text('cache_type').notNull(),
    cacheKey: text('cache_key').notNull(),
    data: jsonb('data').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    sessionCacheUnique: uniqueIndex('idx_task_session_workspace_cache_session_unique').on(
      table.sessionId,
      table.tenantKey,
      table.cacheType,
      table.cacheKey
    ),
    sessionIdIdx: index('idx_task_session_workspace_cache_session_id').on(table.sessionId),
    sessionTypeIdx: index('idx_task_session_workspace_cache_session_type').on(
      table.sessionId,
      table.cacheType
    ),
    updatedAtIdx: index('idx_task_session_workspace_cache_updated_at').on(table.updatedAt),
  })
);

/**
 * 意图识别结果表
 * 
 * 记录 Layer 1 的意图识别结果
 */
export const intentRecognitionResults = pgTable('intent_recognition_results', {
  id: uuid('id').primaryKey(),
  sessionId: uuid('session_id').notNull().references(() => taskCreationSessions.id, { onDelete: 'cascade' }),
  userInput: text('user_input').notNull(),
  intentType: text('intent_type').notNull(),
  confidence: integer('confidence').notNull(), // 0-100
  keyInfo: jsonb('key_info').notNull(), // { target, scope, constraints, etc. }
  clarificationNeeded: boolean('clarification_needed').notNull().default(false),
  clarificationQuestions: jsonb('clarification_questions'), // 需要澄清的问题列表
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

/**
 * 任务描述表
 * 
 * 记录 Layer 2 生成的任务描述
 */
export const taskDescriptions = pgTable('task_descriptions', {
  id: uuid('id').primaryKey(),
  sessionId: uuid('session_id').notNull().references(() => taskCreationSessions.id, { onDelete: 'cascade' }),
  intentResultId: uuid('intent_result_id').notNull().references(() => intentRecognitionResults.id),
  title: text('title').notNull(),
  objective: text('objective').notNull(),
  scope: text('scope'),
  deliverables: jsonb('deliverables').notNull(), // 交付物列表
  constraints: jsonb('constraints'), // 约束条件
  additionalInfo: jsonb('additional_info'), // 从搜索或用户澄清获得的额外信息
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

/**
 * 执行计划表
 * 
 * 记录 Layer 3 生成的执行计划
 */
export const executionPlans = pgTable('execution_plans', {
  id: uuid('id').primaryKey(),
  sessionId: uuid('session_id').notNull().references(() => taskCreationSessions.id, { onDelete: 'cascade' }),
  taskDescriptionId: uuid('task_description_id').notNull().references(() => taskDescriptions.id),
  projectTitle: text('project_title').notNull(),
  projectDescription: text('project_description'),
  estimatedTotalHours: integer('estimated_total_hours'),
  managers: jsonb('managers').notNull(), // 经理和任务列表
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

/**
 * 搜索记录表
 * 
 * 记录任务创建过程中的搜索查询和结果
 */
export const searchRecords = pgTable('search_records', {
  id: uuid('id').primaryKey(),
  sessionId: uuid('session_id').notNull().references(() => taskCreationSessions.id, { onDelete: 'cascade' }),
  query: text('query').notNull(),
  results: jsonb('results'), // 搜索结果
  source: text('source'), // 搜索来源（google, bing, etc.）
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

/**
 * Sandbox 执行环境表
 *
 * 记录 Session 与 KVM/增量盘映射，以及安全配置快照
 */
export const sandboxExecutionEnvironments = pgTable('sandbox_execution_environments', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: text('session_id').notNull().unique(),
  orchestratorSessionId: text('orchestrator_session_id').notNull(),
  vmName: text('vm_name'),
  baseImage: text('base_image').notNull(),
  incrementalStorageDir: text('incremental_storage_dir').notNull(),
  incrementalFileName: text('incremental_file_name').notNull(),
  incrementalFilePath: text('incremental_file_path').notNull(),
  status: text('status').notNull().default('creating'), // creating, ready, closing, closed, failed
  securityProfile: jsonb('security_profile').notNull(),
  networkPolicy: jsonb('network_policy').notNull(),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  closedAt: timestamp('closed_at'),
});

export const userConnectorAccounts = pgTable(
  'user_connector_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    connectorKey: text('connector_key').notNull(),
    authMode: text('auth_mode').notNull(),
    authStatus: text('auth_status').notNull().default('not_configured'),
    displayName: text('display_name'),
    configJson: jsonb('config_json'),
    secretCiphertext: text('secret_ciphertext'),
    lastAuthAt: timestamp('last_auth_at'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    userConnectorUnique: uniqueIndex('idx_user_connector_accounts_user_connector').on(table.userId, table.connectorKey),
    userConnectorUserIdx: index('idx_user_connector_accounts_user_id').on(table.userId),
  })
);

export const taskSessionConnectorBindings = pgTable(
  'task_session_connector_bindings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskSessionId: text('task_session_id').notNull(),
    connectorKey: text('connector_key').notNull(),
    desiredState: text('desired_state').notNull().default('detached'),
    runtimeStatus: text('runtime_status').notNull().default('unknown'),
    orchestratorSessionId: text('orchestrator_session_id'),
    serverName: text('server_name'),
    lastUsedAt: timestamp('last_used_at'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    taskSessionConnectorUnique: uniqueIndex('idx_task_session_connector_bindings_session_connector').on(
      table.taskSessionId,
      table.connectorKey
    ),
    taskSessionConnectorTaskIdx: index('idx_task_session_connector_bindings_task_session_id').on(table.taskSessionId),
    taskSessionConnectorOrchestratorIdx: index('idx_task_session_connector_bindings_orchestrator_session_id').on(
      table.orchestratorSessionId
    ),
  })
);

export const connectorAuthRequests = pgTable(
  'connector_auth_requests',
  {
    requestId: uuid('request_id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    connectorKey: text('connector_key').notNull(),
    provider: text('provider').notNull(),
    state: text('state').notNull(),
    codeVerifier: text('code_verifier'),
    returnToSessionId: text('return_to_session_id'),
    status: text('status').notNull().default('pending'),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    completedAt: timestamp('completed_at'),
  },
  (table) => ({
    connectorAuthStateUnique: uniqueIndex('idx_connector_auth_requests_state').on(table.state),
    connectorAuthUserIdx: index('idx_connector_auth_requests_user_id').on(table.userId),
  })
);

// 导出类型
export type TaskCreationSession = typeof taskCreationSessions.$inferSelect;
export type NewTaskCreationSession = typeof taskCreationSessions.$inferInsert;

export type ConversationMessage = typeof conversationMessages.$inferSelect;
export type NewConversationMessage = typeof conversationMessages.$inferInsert;

export type TaskSessionRecentMessage = typeof taskSessionRecentMessages.$inferSelect;
export type NewTaskSessionRecentMessage = typeof taskSessionRecentMessages.$inferInsert;
export type TaskSessionWorkspaceCache = typeof taskSessionWorkspaceCache.$inferSelect;
export type NewTaskSessionWorkspaceCache = typeof taskSessionWorkspaceCache.$inferInsert;

export type IntentRecognitionResult = typeof intentRecognitionResults.$inferSelect;
export type NewIntentRecognitionResult = typeof intentRecognitionResults.$inferInsert;

export type TaskDescription = typeof taskDescriptions.$inferSelect;
export type NewTaskDescription = typeof taskDescriptions.$inferInsert;

export type ExecutionPlan = typeof executionPlans.$inferSelect;
export type NewExecutionPlan = typeof executionPlans.$inferInsert;

export type SearchRecord = typeof searchRecords.$inferSelect;
export type NewSearchRecord = typeof searchRecords.$inferInsert;

export type SandboxExecutionEnvironment = typeof sandboxExecutionEnvironments.$inferSelect;
export type NewSandboxExecutionEnvironment = typeof sandboxExecutionEnvironments.$inferInsert;

export type UserConnectorAccount = typeof userConnectorAccounts.$inferSelect;
export type NewUserConnectorAccount = typeof userConnectorAccounts.$inferInsert;

export type TaskSessionConnectorBinding = typeof taskSessionConnectorBindings.$inferSelect;
export type NewTaskSessionConnectorBinding = typeof taskSessionConnectorBindings.$inferInsert;

export type ConnectorAuthRequest = typeof connectorAuthRequests.$inferSelect;
export type NewConnectorAuthRequest = typeof connectorAuthRequests.$inferInsert;
