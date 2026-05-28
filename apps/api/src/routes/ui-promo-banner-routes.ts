import { Request, Response, Router } from 'express';
import { uiPromoBannerService } from '../services/ui-promo-banner-service';
import { promoBannerMediaService } from '../services/promo-banner-media-service';

const router = Router();

router.get('/media/:encodedObjectKey', async (req: Request, res: Response) => {
  try {
    const encoded = String(req.params.encodedObjectKey || '').trim();
    if (!encoded) {
      return res.status(400).json({ error: '素材路径不能为空' });
    }
    const objectKey = decodeURIComponent(encoded);
    const media = await promoBannerMediaService.getImage(objectKey);
    res.setHeader('Content-Type', media.contentType);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(media.bytes);
  } catch (error) {
    console.error('[PromoBanner App] 获取素材失败:', error);
    res.status(404).json({ error: '素材不存在' });
  }
});

router.get('/active', async (req: Request, res: Response) => {
  try {
    const placement = String(req.query.placement || 'sidebar_bubble') as 'home_bubble' | 'sidebar_bubble';
    if (placement !== 'home_bubble' && placement !== 'sidebar_bubble') {
      return res.status(400).json({ error: 'placement 不合法' });
    }
    const banner = await uiPromoBannerService.getActiveForPlacement(placement);
    res.json({ banner });
  } catch (error) {
    console.error('[PromoBanner App] 获取活动条幅失败:', error);
    res.status(500).json({ error: '获取活动条幅失败' });
  }
});

router.post('/:id/events', async (req: Request, res: Response) => {
  try {
    const { itemId, eventType, metadata } = req.body || {};
    const userId = (req as any).user?.id || null;
    await uiPromoBannerService.recordEvent({
      bannerId: req.params.id,
      itemId: typeof itemId === 'string' ? itemId : null,
      userId,
      eventType: eventType as 'impression' | 'click' | 'dismiss',
      metadata: metadata && typeof metadata === 'object' ? metadata : {},
    });
    res.json({ success: true });
  } catch (error) {
    console.error('[PromoBanner App] 记录事件失败:', error);
    res.status(400).json({ error: error instanceof Error ? error.message : '记录事件失败' });
  }
});

export default router;
