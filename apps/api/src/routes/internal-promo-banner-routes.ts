import { Request, Response, Router } from 'express';
import { uiPromoBannerService } from '../services/ui-promo-banner-service';
import { promoBannerMediaService } from '../services/promo-banner-media-service';
import { createRequireInternalToken } from './internal-auth-middleware';
import { adminAuthMiddleware } from '../middleware/admin-auth-middleware';

const router = Router();

router.use(
  createRequireInternalToken({
    disabledMessage: '宣传条幅内部接口未启用',
  }),
);
router.use(adminAuthMiddleware);

router.post('/upload-media', async (req: Request, res: Response) => {
  try {
    const fileName = typeof req.body?.fileName === 'string' ? req.body.fileName.trim() : '';
    const contentType = typeof req.body?.contentType === 'string' ? req.body.contentType.trim() : '';
    const dataBase64 = typeof req.body?.dataBase64 === 'string' ? req.body.dataBase64.trim() : '';
    if (!fileName || !contentType || !dataBase64) {
      return res.status(400).json({ error: '上传参数不完整' });
    }
    const bytes = Buffer.from(dataBase64, 'base64');
    const uploaded = await promoBannerMediaService.uploadImage({
      fileName,
      contentType,
      bytes,
    });
    res.status(201).json(uploaded);
  } catch (error) {
    console.error('[PromoBanner Admin] 上传素材失败:', error);
    res.status(400).json({ error: error instanceof Error ? error.message : '上传素材失败' });
  }
});

router.get('/', async (req: Request, res: Response) => {
  try {
    const page = parseInt(String(req.query.page || '1'), 10) || 1;
    const pageSize = parseInt(String(req.query.pageSize || '20'), 10) || 20;
    const placement = String(req.query.placement || 'all') as 'all' | 'home_bubble' | 'sidebar_bubble';
    const status = String(req.query.status || 'all') as 'all' | 'draft' | 'published' | 'offline';
    const search = typeof req.query.search === 'string' ? req.query.search : '';
    const result = await uiPromoBannerService.list({ page, pageSize, placement, status, search });
    res.json(result);
  } catch (error) {
    console.error('[PromoBanner Admin] 获取列表失败:', error);
    res.status(500).json({ error: '获取列表失败' });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const result = await uiPromoBannerService.getById(req.params.id);
    res.json(result);
  } catch (error) {
    console.error('[PromoBanner Admin] 获取详情失败:', error);
    res.status(404).json({ error: error instanceof Error ? error.message : '条幅不存在' });
  }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const adminUserId = (req as any).adminUserId || null;
    const created = await uiPromoBannerService.create({
      ...req.body,
      startAt: req.body?.startAt ? new Date(req.body.startAt) : null,
      endAt: req.body?.endAt ? new Date(req.body.endAt) : null,
      createdBy: adminUserId,
    });
    res.status(201).json(created);
  } catch (error) {
    console.error('[PromoBanner Admin] 创建失败:', error);
    res.status(400).json({ error: error instanceof Error ? error.message : '创建失败' });
  }
});

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const adminUserId = (req as any).adminUserId || null;
    const updated = await uiPromoBannerService.update(req.params.id, {
      ...req.body,
      startAt: req.body?.startAt ? new Date(req.body.startAt) : null,
      endAt: req.body?.endAt ? new Date(req.body.endAt) : null,
      updatedBy: adminUserId,
    });
    res.json(updated);
  } catch (error) {
    console.error('[PromoBanner Admin] 更新失败:', error);
    res.status(400).json({ error: error instanceof Error ? error.message : '更新失败' });
  }
});

router.post('/:id/publish', async (req: Request, res: Response) => {
  try {
    const result = await uiPromoBannerService.publish(req.params.id);
    res.json(result);
  } catch (error) {
    console.error('[PromoBanner Admin] 发布失败:', error);
    res.status(400).json({ error: error instanceof Error ? error.message : '发布失败' });
  }
});

router.post('/:id/offline', async (req: Request, res: Response) => {
  try {
    const result = await uiPromoBannerService.offline(req.params.id);
    res.json(result);
  } catch (error) {
    console.error('[PromoBanner Admin] 下线失败:', error);
    res.status(400).json({ error: error instanceof Error ? error.message : '下线失败' });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await uiPromoBannerService.remove(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('[PromoBanner Admin] 删除失败:', error);
    res.status(400).json({ error: error instanceof Error ? error.message : '删除失败' });
  }
});

export default router;
