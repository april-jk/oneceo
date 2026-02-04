/**
 * 数据库 Schema 定义
 * 
 * 使用 Drizzle ORM 定义数据库表结构
 */

import { pgTable, text, timestamp, jsonb, uuid, integer, boolean } from 'drizzle-orm/pg-core';

/**
 * 任务创建会话表
 * 
 * 记录每次任务创建的会话信息
 */
export const taskCreationSessions = pgTable('task_creation_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
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
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => taskCreationSessions.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), // user, agent, system
  content: text('content').notNull(),
  messageType: text('message_type'), // layer1_result, layer2_result, layer3_result, clarification, etc.
  metadata: jsonb('metadata'), // 存储额外的元数据
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

/**
 * 意图识别结果表
 * 
 * 记录 Layer 1 的意图识别结果
 */
export const intentRecognitionResults = pgTable('intent_recognition_results', {
  id: uuid('id').primaryKey().defaultRandom(),
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
  id: uuid('id').primaryKey().defaultRandom(),
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
  id: uuid('id').primaryKey().defaultRandom(),
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
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => taskCreationSessions.id, { onDelete: 'cascade' }),
  query: text('query').notNull(),
  results: jsonb('results'), // 搜索结果
  source: text('source'), // 搜索来源（google, bing, etc.）
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// 导出类型
export type TaskCreationSession = typeof taskCreationSessions.$inferSelect;
export type NewTaskCreationSession = typeof taskCreationSessions.$inferInsert;

export type ConversationMessage = typeof conversationMessages.$inferSelect;
export type NewConversationMessage = typeof conversationMessages.$inferInsert;

export type IntentRecognitionResult = typeof intentRecognitionResults.$inferSelect;
export type NewIntentRecognitionResult = typeof intentRecognitionResults.$inferInsert;

export type TaskDescription = typeof taskDescriptions.$inferSelect;
export type NewTaskDescription = typeof taskDescriptions.$inferInsert;

export type ExecutionPlan = typeof executionPlans.$inferSelect;
export type NewExecutionPlan = typeof executionPlans.$inferInsert;

export type SearchRecord = typeof searchRecords.$inferSelect;
export type NewSearchRecord = typeof searchRecords.$inferInsert;
