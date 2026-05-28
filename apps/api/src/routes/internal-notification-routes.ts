import { Router, Request, Response } from 'express';
import { notificationService } from '../services/notification-service';

const router = Router();

/**
 * GET /api/internal/notifications
 * 获取通知列表（分页、筛选）
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 20;
    const status = req.query.status as string | undefined;
    const type = req.query.type as string | undefined;
    const search = req.query.search as string | undefined;

    const result = await notificationService.listNotifications({
      page,
      pageSize,
      status,
      type,
      search,
    });

    res.json(result);
  } catch (error) {
    console.error('[Notification Admin] 获取通知列表失败:', error);
    res.status(500).json({ error: '获取通知列表失败' });
  }
});

/**
 * POST /api/internal/notifications
 * 创建通知
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { title, content, type, priority, targetType, targetUserIds, expiresAt } = req.body;

    if (!title || title.trim().length === 0) {
      return res.status(400).json({ error: '通知标题不能为空' });
    }

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: '通知内容不能为空' });
    }

    const adminUserId = (req as any).adminUserId;

    const notification = await notificationService.createNotification({
      title,
      content,
      type,
      priority,
      targetType,
      targetUserIds,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
      createdBy: adminUserId,
    });

    res.status(201).json(notification);
  } catch (error) {
    console.error('[Notification Admin] 创建通知失败:', error);
    res.status(500).json({ error: '创建通知失败' });
  }
});

/**
 * PUT /api/internal/notifications/:id
 * 更新通知
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { title, content, type, priority, targetType, targetUserIds, expiresAt } = req.body;

    const notification = await notificationService.updateNotification(id, {
      title,
      content,
      type,
      priority,
      targetType,
      targetUserIds,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
    });

    res.json(notification);
  } catch (error) {
    console.error('[Notification Admin] 更新通知失败:', error);
    res.status(500).json({ error: '更新通知失败' });
  }
});

/**
 * DELETE /api/internal/notifications/:id
 * 删除通知
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await notificationService.deleteNotification(id);
    res.json({ success: true });
  } catch (error) {
    console.error('[Notification Admin] 删除通知失败:', error);
    res.status(500).json({ error: '删除通知失败' });
  }
});

/**
 * POST /api/internal/notifications/:id/publish
 * 发布通知
 */
router.post('/:id/publish', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const notification = await notificationService.publishNotification(id);
    res.json(notification);
  } catch (error) {
    console.error('[Notification Admin] 发布通知失败:', error);
    res.status(500).json({ error: '发布通知失败' });
  }
});

/**
 * POST /api/internal/notifications/:id/archive
 * 归档通知
 */
router.post('/:id/archive', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const notification = await notificationService.archiveNotification(id);
    res.json(notification);
  } catch (error) {
    console.error('[Notification Admin] 归档通知失败:', error);
    res.status(500).json({ error: '归档通知失败' });
  }
});

/**
 * GET /api/internal/notifications/:id/stats
 * 获取通知统计
 */
router.get('/:id/stats', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const stats = await notificationService.getNotificationStats(id);
    res.json(stats);
  } catch (error) {
    console.error('[Notification Admin] 获取通知统计失败:', error);
    res.status(500).json({ error: '获取通知统计失败' });
  }
});

export default router;