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

export const taskSessionRuns = pgTable(
  'task_session_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => taskCreationSessions.id, { onDelete: 'cascade' }),
    mode: text('mode').notNull().default('managed'),
    status: text('status').notNull().default('queued'),
    model: text('model'),
    stopReason: text('stop_reason'),
    sandboxBindingId: uuid('sandbox_binding_id'),
    connectorSnapshotId: uuid('connector_snapshot_id'),
    metadataJson: jsonb('metadata_json'),
    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    sessionIdx: index('idx_task_session_runs_session_id').on(table.sessionId),
    sessionCreatedIdx: index('idx_task_session_runs_session_created_at').on(table.sessionId, table.createdAt),
    statusIdx: index('idx_task_session_runs_status').on(table.status),
  })
);

export const taskSessionRunEvents = pgTable(
  'task_session_run_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => taskSessionRuns.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => taskCreationSessions.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    sequence: integer('sequence').notNull(),
    payloadJson: jsonb('payload_json'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    runSequenceUnique: uniqueIndex('idx_task_session_run_events_run_sequence').on(table.runId, table.sequence),
    runCreatedIdx: index('idx_task_session_run_events_run_created_at').on(table.runId, table.createdAt),
    sessionIdx: index('idx_task_session_run_events_session_id').on(table.sessionId),
  })
);

export const taskSessionDeliverableArtifacts = pgTable(
  'task_session_deliverable_artifacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => taskCreationSessions.id, { onDelete: 'cascade' }),
    runId: uuid('run_id')
      .notNull()
      .references(() => taskSessionRuns.id, { onDelete: 'cascade' }),
    sandboxId: text('sandbox_id').notNull(),
    sourcePath: text('source_path').notNull(),
    displayName: text('display_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: text('sha256').notNull(),
    storageKey: text('storage_key').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    runCreatedIdx: index('idx_task_session_deliverable_artifacts_run_created_at').on(
      table.runId,
      table.createdAt
    ),
    sessionCreatedIdx: index('idx_task_session_deliverable_artifacts_session_created_at').on(
      table.sessionId,
      table.createdAt
    ),
    storageKeyUnique: uniqueIndex('idx_task_session_deliverable_artifacts_storage_key').on(table.storageKey),
  })
);

export const taskSessionSandboxBindings = pgTable(
  'task_session_sandbox_bindings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => taskCreationSessions.id, { onDelete: 'cascade' }),
    sandboxId: text('sandbox_id').notNull(),
    workspaceRoot: text('workspace_root').notNull(),
    status: text('status').notNull().default('ready'),
    metadataJson: jsonb('metadata_json'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    lastActiveAt: timestamp('last_active_at').notNull().defaultNow(),
  },
  (table) => ({
    sessionUnique: uniqueIndex('idx_task_session_sandbox_bindings_session_id').on(table.sessionId),
    sandboxIdx: index('idx_task_session_sandbox_bindings_sandbox_id').on(table.sandboxId),
  })
);

export const taskSessionConnectorSnapshots = pgTable(
  'task_session_connector_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => taskCreationSessions.id, { onDelete: 'cascade' }),
    snapshotJson: jsonb('snapshot_json').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    sessionIdx: index('idx_task_session_connector_snapshots_session_id').on(table.sessionId),
  })
);

export const platformSkills = pgTable(
  'platform_skills',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    category: text('category').notNull().default('general'),
    status: text('status').notNull().default('active'),
    publishedRevisionId: uuid('published_revision_id'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    slugUnique: uniqueIndex('idx_platform_skills_slug').on(table.slug),
    statusIdx: index('idx_platform_skills_status').on(table.status),
    publishedRevisionIdx: index('idx_platform_skills_published_revision_id').on(table.publishedRevisionId),
  })
);

export const platformSkillRevisions = pgTable(
  'platform_skill_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => platformSkills.id, { onDelete: 'cascade' }),
    revisionNumber: integer('revision_number').notNull(),
    slugSnapshot: text('slug_snapshot').notNull(),
    nameSnapshot: text('name_snapshot').notNull(),
    descriptionSnapshot: text('description_snapshot').notNull().default(''),
    categorySnapshot: text('category_snapshot').notNull().default('general'),
    bodyMarkdown: text('body_markdown').notNull(),
    publishedAt: timestamp('published_at'),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    skillRevisionUnique: uniqueIndex('idx_platform_skill_revisions_skill_revision').on(
      table.skillId,
      table.revisionNumber
    ),
    skillCreatedIdx: index('idx_platform_skill_revisions_skill_created_at').on(table.skillId, table.createdAt),
    publishedAtIdx: index('idx_platform_skill_revisions_published_at').on(table.publishedAt),
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

export const userConnectorProfiles = pgTable(
  'user_connector_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    connectorKey: text('connector_key').notNull(),
    profileName: text('profile_name').notNull(),
    displayName: text('display_name'),
    authMode: text('auth_mode').notNull(),
    authStatus: text('auth_status').notNull().default('not_configured'),
    configJson: jsonb('config_json'),
    secretCiphertext: text('secret_ciphertext'),
    metadataJson: jsonb('metadata_json'),
    isDefault: boolean('is_default').notNull().default(false),
    lastAuthAt: timestamp('last_auth_at'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    userConnectorProfileUnique: uniqueIndex('idx_user_connector_profiles_user_connector_profile').on(
      table.userId,
      table.connectorKey,
      table.profileName
    ),
    userConnectorProfileUserIdx: index('idx_user_connector_profiles_user_id').on(table.userId),
    userConnectorProfileConnectorIdx: index('idx_user_connector_profiles_user_connector').on(
      table.userId,
      table.connectorKey
    ),
  })
);

export const userCodexRuntimeConfigs = pgTable(
  'user_codex_runtime_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    configToml: text('config_toml').notNull(),
    authJson: text('auth_json').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    userUnique: uniqueIndex('idx_user_codex_runtime_configs_user_id').on(table.userId),
    updatedAtIdx: index('idx_user_codex_runtime_configs_updated_at').on(table.updatedAt),
  })
);

export const userPlatformSkillBindings = pgTable(
  'user_platform_skill_bindings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    platformSkillId: uuid('platform_skill_id')
      .notNull()
      .references(() => platformSkills.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    userSkillUnique: uniqueIndex('idx_user_platform_skill_bindings_user_skill').on(
      table.userId,
      table.platformSkillId
    ),
    userIdx: index('idx_user_platform_skill_bindings_user_id').on(table.userId),
    platformSkillIdx: index('idx_user_platform_skill_bindings_platform_skill_id').on(table.platformSkillId),
  })
);

export const userCustomSkills = pgTable(
  'user_custom_skills',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    category: text('category').notNull().default('general'),
    status: text('status').notNull().default('active'),
    bodyMarkdown: text('body_markdown').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    userSlugUnique: uniqueIndex('idx_user_custom_skills_user_slug').on(table.userId, table.slug),
    userStatusIdx: index('idx_user_custom_skills_user_status').on(table.userId, table.status),
    updatedAtIdx: index('idx_user_custom_skills_updated_at').on(table.updatedAt),
  })
);

export const taskSessionConnectorBindings = pgTable(
  'task_session_connector_bindings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskSessionId: text('task_session_id').notNull(),
    connectorKey: text('connector_key').notNull(),
    profileId: text('profile_id'),
    desiredState: text('desired_state').notNull().default('detached'),
    runtimeStatus: text('runtime_status').notNull().default('unknown'),
    orchestratorSessionId: text('orchestrator_session_id'),
    serverName: text('server_name'),
    enabledTools: jsonb('enabled_tools'),
    sessionConfigJson: jsonb('session_config_json'),
    definitionSnapshotJson: jsonb('definition_snapshot_json'),
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
    profileId: text('profile_id'),
    provider: text('provider').notNull(),
    state: text('state').notNull(),
    codeVerifier: text('code_verifier'),
    profileDraftJson: jsonb('profile_draft_json'),
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
export type TaskSessionRun = typeof taskSessionRuns.$inferSelect;
export type NewTaskSessionRun = typeof taskSessionRuns.$inferInsert;
export type TaskSessionRunEvent = typeof taskSessionRunEvents.$inferSelect;
export type NewTaskSessionRunEvent = typeof taskSessionRunEvents.$inferInsert;
export type TaskSessionDeliverableArtifact = typeof taskSessionDeliverableArtifacts.$inferSelect;
export type NewTaskSessionDeliverableArtifact = typeof taskSessionDeliverableArtifacts.$inferInsert;
export type TaskSessionSandboxBinding = typeof taskSessionSandboxBindings.$inferSelect;
export type NewTaskSessionSandboxBinding = typeof taskSessionSandboxBindings.$inferInsert;
export type TaskSessionConnectorSnapshot = typeof taskSessionConnectorSnapshots.$inferSelect;
export type NewTaskSessionConnectorSnapshot = typeof taskSessionConnectorSnapshots.$inferInsert;
export type PlatformSkill = typeof platformSkills.$inferSelect;
export type NewPlatformSkill = typeof platformSkills.$inferInsert;
export type PlatformSkillRevision = typeof platformSkillRevisions.$inferSelect;
export type NewPlatformSkillRevision = typeof platformSkillRevisions.$inferInsert;

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
export type UserConnectorProfile = typeof userConnectorProfiles.$inferSelect;
export type NewUserConnectorProfile = typeof userConnectorProfiles.$inferInsert;

export type UserCodexRuntimeConfig = typeof userCodexRuntimeConfigs.$inferSelect;
export type NewUserCodexRuntimeConfig = typeof userCodexRuntimeConfigs.$inferInsert;
export type UserPlatformSkillBinding = typeof userPlatformSkillBindings.$inferSelect;
export type NewUserPlatformSkillBinding = typeof userPlatformSkillBindings.$inferInsert;
export type UserCustomSkill = typeof userCustomSkills.$inferSelect;
export type NewUserCustomSkill = typeof userCustomSkills.$inferInsert;

export type TaskSessionConnectorBinding = typeof taskSessionConnectorBindings.$inferSelect;
export type NewTaskSessionConnectorBinding = typeof taskSessionConnectorBindings.$inferInsert;

export type ConnectorAuthRequest = typeof connectorAuthRequests.$inferSelect;
export type NewConnectorAuthRequest = typeof connectorAuthRequests.$inferInsert;
