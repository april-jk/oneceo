import { eq, and, desc, sql, count, inArray } from 'drizzle-orm';
import { db } from '../config/database';
import { notifications, userNotifications, appUsers } from '../db/schema';
import type { Notification, NewNotification, UserNotification } from '../db/schema';

export type CreateNotificationParams = {
  title: string;
  content: string;
  type?: string;
  priority?: string;
  targetType?: string;
  targetUserIds?: string[];
  expiresAt?: Date;
  createdBy?: string;
};

export type UpdateNotificationParams = {
  title?: string;
  content?: string;
  type?: string;
  priority?: string;
  targetType?: string;
  targetUserIds?: string[];
  expiresAt?: Date;
};

export type ListNotificationsParams = {
  page?: number;
  pageSize?: number;
  status?: string;
  type?: string;
  search?: string;
};

export type NotificationStats = {
  total: number;
  draft: number;
  published: number;
  archived: number;
  totalReads: number;
  totalUsers: number;
};

export type GetUserNotificationsParams = {
  page?: number;
  pageSize?: number;
  type?: string;
  unreadOnly?: boolean;
};

export class NotificationService {
  /**
   * 创建通知
   */
  async createNotification(params: CreateNotificationParams): Promise<Notification> {
    const {
      title,
      content,
      type = 'system',
      priority = 'normal',
      targetType = 'all',
      targetUserIds,
      expiresAt,
      createdBy,
    } = params;

    if (!title || title.trim().length === 0) {
      throw new Error('通知标题不能为空');
    }

    if (!content || content.trim().length === 0) {
      throw new Error('通知内容不能为空');
    }

    // 如果是指定用户，验证用户存在
    if (targetType === 'specific_users' && targetUserIds && targetUserIds.length > 0) {
      const existingUsers = await db
        .select({ id: appUsers.id })
        .from(appUsers)
        .where(inArray(appUsers.id, targetUserIds));

      if (existingUsers.length !== targetUserIds.length) {
        throw new Error('部分指定用户不存在');
      }
    }

    const result = await db.insert(notifications).values({
      title: title.trim(),
      content: content.trim(),
      type,
      priority,
      targetType,
      targetUserIds: targetType === 'specific_users' ? targetUserIds : null,
      expiresAt,
      createdBy: createdBy as any,
    }).returning();

    const notification = result[0];

    // 如果是指定用户，批量创建用户通知关联
    if (targetType === 'specific_users' && targetUserIds && targetUserIds.length > 0) {
      await this.batchCreateUserNotifications(targetUserIds, notification.id);
    }

    return notification;
  }

  /**
   * 更新通知
   */
  async updateNotification(id: string, params: UpdateNotificationParams): Promise<Notification> {
    const existing = await db
      .select()
      .from(notifications)
      .where(eq(notifications.id, id))
      .limit(1);

    if (existing.length === 0) {
      throw new Error('通知不存在');
    }

    if (existing[0].status === 'published') {
      throw new Error('已发布的通知不能编辑');
    }

    const updateData: Record<string, any> = { updatedAt: new Date() };

    if (params.title !== undefined) {
      if (!params.title.trim()) {
        throw new Error('通知标题不能为空');
      }
      updateData.title = params.title.trim();
    }

    if (params.content !== undefined) {
      if (!params.content.trim()) {
        throw new Error('通知内容不能为空');
      }
      updateData.content = params.content.trim();
    }

    if (params.type !== undefined) updateData.type = params.type;
    if (params.priority !== undefined) updateData.priority = params.priority;
    if (params.targetType !== undefined) updateData.targetType = params.targetType;
    if (params.targetUserIds !== undefined) updateData.targetUserIds = params.targetUserIds;
    if (params.expiresAt !== undefined) updateData.expiresAt = params.expiresAt;

    const result = await db
      .update(notifications)
      .set(updateData)
      .where(eq(notifications.id, id))
      .returning();

    return result[0];
  }

  /**
   * 删除通知
   */
  async deleteNotification(id: string): Promise<void> {
    const existing = await db
      .select()
      .from(notifications)
      .where(eq(notifications.id, id))
      .limit(1);

    if (existing.length === 0) {
      throw new Error('通知不存在');
    }

    await db.delete(notifications).where(eq(notifications.id, id));
  }

  /**
   * 发布通知
   */
  async publishNotification(id: string): Promise<Notification> {
    const existing = await db
      .select()
      .from(notifications)
      .where(eq(notifications.id, id))
      .limit(1);

    if (existing.length === 0) {
      throw new Error('通知不存在');
    }

    if (existing[0].status === 'published') {
      throw new Error('通知已发布');
    }

    const result = await db
      .update(notifications)
      .set({
        status: 'published',
        publishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(notifications.id, id))
      .returning();

    return result[0];
  }

  /**
   * 归档通知
   */
  async archiveNotification(id: string): Promise<Notification> {
    const existing = await db
      .select()
      .from(notifications)
      .where(eq(notifications.id, id))
      .limit(1);

    if (existing.length === 0) {
      throw new Error('通知不存在');
    }

    const result = await db
      .update(notifications)
      .set({
        status: 'archived',
        updatedAt: new Date(),
      })
      .where(eq(notifications.id, id))
      .returning();

    return result[0];
  }

  /**
   * 获取通知列表（管理后台）
   */
  async listNotifications(params: ListNotificationsParams = {}): Promise<{
    items: Notification[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const { page = 1, pageSize = 20, status, type, search } = params;

    const conditions: any[] = [];

    if (status && status !== 'all') {
      conditions.push(eq(notifications.status, status));
    }

    if (type && type !== 'all') {
      conditions.push(eq(notifications.type, type));
    }

    if (search) {
      conditions.push(sql`${notifications.title} ILIKE ${'%' + search + '%'}`);
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult, items] = await Promise.all([
      db.select({ count: count() }).from(notifications).where(whereClause),
      db
        .select()
        .from(notifications)
        .where(whereClause)
        .orderBy(desc(notifications.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
    ]);

    return {
      items,
      total: Number(totalResult[0].count),
      page,
      pageSize,
    };
  }

  /**
   * 获取通知统计
   */
  async getNotificationStats(id: string): Promise<NotificationStats> {
    const notification = await db
      .select()
      .from(notifications)
      .where(eq(notifications.id, id))
      .limit(1);

    if (notification.length === 0) {
      throw new Error('通知不存在');
    }

    const [statusCounts, readCount, userCount] = await Promise.all([
      db
        .select({
          status: notifications.status,
          count: count(),
        })
        .from(notifications)
        .groupBy(notifications.status),
      db
        .select({ count: count() })
        .from(userNotifications)
        .where(
          and(
            eq(userNotifications.notificationId, id),
            eq(userNotifications.isRead, true)
          )
        ),
      db
        .select({ count: count() })
        .from(userNotifications)
        .where(eq(userNotifications.notificationId, id)),
    ]);

    const statusMap = statusCounts.reduce((acc, row) => {
      acc[row.status] = Number(row.count);
      return acc;
    }, {} as Record<string, number>);

    return {
      total: statusCounts.reduce((sum, row) => sum + Number(row.count), 0),
      draft: statusMap['draft'] || 0,
      published: statusMap['published'] || 0,
      archived: statusMap['archived'] || 0,
      totalReads: Number(readCount[0].count),
      totalUsers: Number(userCount[0].count),
    };
  }

  /**
   * 获取用户通知列表
   */
  async getUserNotifications(
    userId: string,
    params: GetUserNotificationsParams = {}
  ): Promise<{
    items: Array<UserNotification & { notification: Notification }>;
    total: number;
    unreadCount: number;
    page: number;
    pageSize: number;
  }> {
    const { page = 1, pageSize = 20, type, unreadOnly = false } = params;

    // 先确保用户有所有已发布通知的关联记录
    await this.ensureAllPublishedNotificationsForUser(userId);

    // 构建查询条件
    const conditions: any[] = [
      eq(userNotifications.userId, userId),
    ];

    if (unreadOnly) {
      conditions.push(eq(userNotifications.isRead, false));
    }

    const whereClause = and(...conditions);

    // 获取总数和未读数
    const [totalResult, unreadResult] = await Promise.all([
      db.select({ count: count() }).from(userNotifications).where(whereClause),
      db
        .select({ count: count() })
        .from(userNotifications)
        .where(
          and(
            eq(userNotifications.userId, userId),
            eq(userNotifications.isRead, false)
          )
        ),
    ]);

    // 获取通知列表
    const userNotifs = await db
      .select()
      .from(userNotifications)
      .where(whereClause)
      .orderBy(desc(userNotifications.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    // 获取关联的通知详情
    const notificationIds = userNotifs.map((un) => un.notificationId);
    const notifDetails =
      notificationIds.length > 0
        ? await db
            .select()
            .from(notifications)
            .where(inArray(notifications.id, notificationIds))
        : [];

    const notifMap = new Map(notifDetails.map((n) => [n.id, n]));

    // 过滤过期通知
    const now = new Date();
    const items = userNotifs
      .map((un) => ({
        ...un,
        notification: notifMap.get(un.notificationId)!,
      }))
      .filter((item) => {
        if (!item.notification) return false;
        if (item.notification.expiresAt && item.notification.expiresAt < now) return false;
        if (type && item.notification.type !== type) return false;
        return true;
      });

    return {
      items,
      total: Number(totalResult[0].count),
      unreadCount: Number(unreadResult[0].count),
      page,
      pageSize,
    };
  }

  /**
   * 获取用户未读通知数量
   */
  async getUnreadCount(userId: string): Promise<number> {
    // 先确保用户有所有已发布通知的关联记录
    await this.ensureAllPublishedNotificationsForUser(userId);

    const result = await db
      .select({ count: count() })
      .from(userNotifications)
      .where(
        and(
          eq(userNotifications.userId, userId),
          eq(userNotifications.isRead, false)
        )
      );

    return Number(result[0].count);
  }

  /**
   * 标记单条通知为已读
   */
  async markAsRead(userId: string, notificationId: string): Promise<void> {
    // 确保关联记录存在
    await this.ensureUserNotificationExists(userId, notificationId);

    await db
      .update(userNotifications)
      .set({
        isRead: true,
        readAt: new Date(),
      })
      .where(
        and(
          eq(userNotifications.userId, userId),
          eq(userNotifications.notificationId, notificationId)
        )
      );
  }

  /**
   * 标记所有通知为已读
   */
  async markAllAsRead(userId: string): Promise<void> {
    await db
      .update(userNotifications)
      .set({
        isRead: true,
        readAt: new Date(),
      })
      .where(
        and(
          eq(userNotifications.userId, userId),
          eq(userNotifications.isRead, false)
        )
      );
  }

  /**
   * 确保用户有所有已发布通知的关联记录
   */
  private async ensureAllPublishedNotificationsForUser(userId: string): Promise<void> {
    // 获取所有已发布且未过期的通知
    const publishedNotifications = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.status, 'published'),
          sql`(${notifications.expiresAt} IS NULL OR ${notifications.expiresAt} > NOW())`
        )
      );

    if (publishedNotifications.length === 0) return;

    // 获取用户已有的关联记录
    const existingRelations = await db
      .select({ notificationId: userNotifications.notificationId })
      .from(userNotifications)
      .where(eq(userNotifications.userId, userId));

    const existingSet = new Set(existingRelations.map((r) => r.notificationId));

    // 找出缺失的关联记录
    const missingNotifications = publishedNotifications.filter(
      (n) => !existingSet.has(n.id)
    );

    if (missingNotifications.length === 0) return;

    // 批量创建缺失的关联记录
    await this.batchCreateUserNotifications(
      [userId],
      ...missingNotifications.map((n) => n.id)
    );
  }

  /**
   * 批量创建用户通知关联
   */
  private async batchCreateUserNotifications(
    userIds: string[],
    ...notificationIds: string[]
  ): Promise<void> {
    if (userIds.length === 0 || notificationIds.length === 0) return;

    const values: Array<{ userId: string; notificationId: string }> = [];
    for (const userId of userIds) {
      for (const notificationId of notificationIds) {
        values.push({ userId, notificationId });
      }
    }

    // 使用 ON CONFLICT DO NOTHING 避免重复插入
    await db
      .insert(userNotifications)
      .values(values)
      .onConflictDoNothing();
  }

  /**
   * 确保用户通知关联存在
   */
  private async ensureUserNotificationExists(
    userId: string,
    notificationId: string
  ): Promise<void> {
    await db
      .insert(userNotifications)
      .values({ userId, notificationId })
      .onConflictDoNothing();
  }
}

export const notificationService = new NotificationService();