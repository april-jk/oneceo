/**
 * 任务创建会话 DAO
 * 
 * 提供任务创建会话的数据库操作方法
 */

import { db } from '../../config/database';
import {
  taskCreationSessions,
  conversationMessages,
  intentRecognitionResults,
  taskDescriptions,
  executionPlans,
  searchRecords,
  type NewTaskCreationSession,
  type NewConversationMessage,
  type NewIntentRecognitionResult,
  type NewTaskDescription,
  type NewExecutionPlan,
  type NewSearchRecord,
} from '../schema';
import { eq, desc } from 'drizzle-orm';

/**
 * 任务创建会话 DAO 类
 */
export class TaskCreationSessionDAO {
  /**
   * 创建新的任务创建会话
   */
  async createSession(data: Partial<NewTaskCreationSession> = {}) {
    const [session] = await db
      .insert(taskCreationSessions)
      .values({
        userId: data.userId,
        status: data.status || 'in_progress',
      })
      .returning();

    return session;
  }

  /**
   * 获取会话信息
   */
  async getSession(sessionId: string) {
    const [session] = await db
      .select()
      .from(taskCreationSessions)
      .where(eq(taskCreationSessions.id, sessionId));

    return session;
  }

  /**
   * 更新会话状态
   */
  async updateSessionStatus(
    sessionId: string,
    status: 'in_progress' | 'waiting_user' | 'completed' | 'failed'
  ) {
    const [session] = await db
      .update(taskCreationSessions)
      .set({
        status,
        updatedAt: new Date(),
        completedAt: status === 'completed' || status === 'failed' ? new Date() : null,
      })
      .where(eq(taskCreationSessions.id, sessionId))
      .returning();

    return session;
  }

  /**
   * 添加对话消息
   */
  async addMessage(data: NewConversationMessage) {
    const [message] = await db
      .insert(conversationMessages)
      .values(data)
      .returning();

    return message;
  }

  /**
   * 获取会话的所有消息
   */
  async getMessages(sessionId: string) {
    const messages = await db
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.sessionId, sessionId))
      .orderBy(conversationMessages.createdAt);

    return messages;
  }

  /**
   * 保存意图识别结果
   */
  async saveIntentResult(data: NewIntentRecognitionResult) {
    const [result] = await db
      .insert(intentRecognitionResults)
      .values(data)
      .returning();

    return result;
  }

  /**
   * 获取会话的意图识别结果
   */
  async getIntentResult(sessionId: string) {
    const [result] = await db
      .select()
      .from(intentRecognitionResults)
      .where(eq(intentRecognitionResults.sessionId, sessionId))
      .orderBy(desc(intentRecognitionResults.createdAt))
      .limit(1);

    return result;
  }

  /**
   * 保存任务描述
   */
  async saveTaskDescription(data: NewTaskDescription) {
    const [description] = await db
      .insert(taskDescriptions)
      .values(data)
      .returning();

    return description;
  }

  /**
   * 获取会话的任务描述
   */
  async getTaskDescription(sessionId: string) {
    const [description] = await db
      .select()
      .from(taskDescriptions)
      .where(eq(taskDescriptions.sessionId, sessionId))
      .orderBy(desc(taskDescriptions.createdAt))
      .limit(1);

    return description;
  }

  /**
   * 保存执行计划
   */
  async saveExecutionPlan(data: NewExecutionPlan) {
    const [plan] = await db
      .insert(executionPlans)
      .values(data)
      .returning();

    return plan;
  }

  /**
   * 获取会话的执行计划
   */
  async getExecutionPlan(sessionId: string) {
    const [plan] = await db
      .select()
      .from(executionPlans)
      .where(eq(executionPlans.sessionId, sessionId))
      .orderBy(desc(executionPlans.createdAt))
      .limit(1);

    return plan;
  }

  /**
   * 保存搜索记录
   */
  async saveSearchRecord(data: NewSearchRecord) {
    const [record] = await db
      .insert(searchRecords)
      .values(data)
      .returning();

    return record;
  }

  /**
   * 获取会话的搜索记录
   */
  async getSearchRecords(sessionId: string) {
    const records = await db
      .select()
      .from(searchRecords)
      .where(eq(searchRecords.sessionId, sessionId))
      .orderBy(searchRecords.createdAt);

    return records;
  }

  /**
   * 获取会话的完整信息（包括所有关联数据）
   */
  async getSessionWithDetails(sessionId: string) {
    const session = await this.getSession(sessionId);
    if (!session) return null;

    const [messages, intentResult, taskDescription, executionPlan, searchRecordsList] =
      await Promise.all([
        this.getMessages(sessionId),
        this.getIntentResult(sessionId),
        this.getTaskDescription(sessionId),
        this.getExecutionPlan(sessionId),
        this.getSearchRecords(sessionId),
      ]);

    return {
      session,
      messages,
      intentResult,
      taskDescription,
      executionPlan,
      searchRecords: searchRecordsList,
    };
  }

  /**
   * 获取最近的会话列表
   */
  async getRecentSessions(limit: number = 10, userId?: string) {
    const query = db
      .select()
      .from(taskCreationSessions)
      .orderBy(desc(taskCreationSessions.createdAt))
      .limit(limit);

    if (userId) {
      query.where(eq(taskCreationSessions.userId, userId));
    }

    return await query;
  }

  /**
   * 删除会话（级联删除所有关联数据）
   */
  async deleteSession(sessionId: string) {
    await db
      .delete(taskCreationSessions)
      .where(eq(taskCreationSessions.id, sessionId));
  }
}

// 导出单例实例
export const taskCreationSessionDAO = new TaskCreationSessionDAO();
