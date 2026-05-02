import { Router, Request, Response } from 'express';
import { notificationService } from '../services/notification-service';

const router = Router();

/**
 * GET /api/notifications
 * 获取当前用户的通知列表
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: '未登录' });
    }

    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 20;
    const type = req.query.type as string | undefined;
    const unreadOnly = req.query.unreadOnly === 'true';

    const result = await notificationService.getUserNotifications(userId, {
      page,
      pageSize,
      type,
      unreadOnly,
    });

    res.json(result);
  } catch (error) {
    console.error('[Notification] 获取通知列表失败:', error);
    res.status(500).json({ error: '获取通知列表失败' });
  }
});

/**
 * GET /api/notifications/unread-count
 * 获取未读通知数量
 */
router.get('/unread-count', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: '未登录' });
    }

    const count = await notificationService.getUnreadCount(userId);
    res.json({ count });
  } catch (error) {
    console.error('[Notification] 获取未读数量失败:', error);
    res.status(500).json({ error: '获取未读数量失败' });
  }
});

/**
 * PUT /api/notifications/:id/read
 * 标记单条通知为已读
 */
router.put('/:id/read', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: '未登录' });
    }

    const { id } = req.params;
    await notificationService.markAsRead(userId, id);
    res.json({ success: true });
  } catch (error) {
    console.error('[Notification] 标记已读失败:', error);
    res.status(500).json({ error: '标记已读失败' });
  }
});

/**
 * PUT /api/notifications/read-all
 * 标记所有通知为已读
 */
router.put('/read-all', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: '未登录' });
    }

    await notificationService.markAllAsRead(userId);
    res.json({ success: true });
  } catch (error) {
    console.error('[Notification] 标记全部已读失败:', error);
    res.status(500).json({ error: '标记全部已读失败' });
  }
});

export default router;