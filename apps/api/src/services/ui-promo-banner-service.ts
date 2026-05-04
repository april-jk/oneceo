import { and, asc, count, desc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';
import { db } from '../config/database';
import { uiPromoBanners, uiPromoBannerEvents, uiPromoBannerItems } from '../db/schema';

type Placement = 'home_bubble' | 'sidebar_bubble';
type DisplayType = 'single' | 'carousel';
type BannerStatus = 'draft' | 'published' | 'offline';
type LinkType = 'internal' | 'external' | 'none';
type EventType = 'impression' | 'click' | 'dismiss';

type BannerItemInput = {
  id?: string;
  sortOrder?: number;
  title: string;
  subtitle?: string | null;
  imageUrl?: string | null;
  ctaText?: string | null;
  linkType?: LinkType;
  linkTarget?: string | null;
  isActive?: boolean;
};

type CreateBannerInput = {
  name: string;
  placement: Placement;
  displayType: DisplayType;
  priority?: number;
  allowDismiss?: boolean;
  dismissResetOnVersion?: boolean;
  startAt?: Date | null;
  endAt?: Date | null;
  items: BannerItemInput[];
  createdBy?: string | null;
};

type UpdateBannerInput = Omit<CreateBannerInput, 'createdBy'> & {
  updatedBy?: string | null;
};

const allowedPlacements = new Set<Placement>(['home_bubble', 'sidebar_bubble']);
const allowedLinkTypes = new Set<LinkType>(['internal', 'external', 'none']);
const allowedEventTypes = new Set<EventType>(['impression', 'click', 'dismiss']);

function normalizeName(name: string) {
  return name.trim();
}

function validateHttpsLink(link: string): boolean {
  return /^https:\/\//i.test(link);
}

function normalizeItem(item: BannerItemInput, index: number) {
  const title = typeof item.title === 'string' ? item.title.trim() : '';
  if (!title) {
    throw new Error(`素材第 ${index + 1} 条标题不能为空`);
  }
  const linkType = (item.linkType || 'none') as LinkType;
  if (!allowedLinkTypes.has(linkType)) {
    throw new Error(`素材第 ${index + 1} 条跳转类型不合法`);
  }
  const linkTarget = typeof item.linkTarget === 'string' ? item.linkTarget.trim() : '';
  if (linkType === 'external' && linkTarget && !validateHttpsLink(linkTarget)) {
    throw new Error(`素材第 ${index + 1} 条外链必须以 https:// 开头`);
  }
  if (linkType !== 'none' && !linkTarget) {
    throw new Error(`素材第 ${index + 1} 条跳转目标不能为空`);
  }
  return {
    sortOrder: Number.isFinite(item.sortOrder) ? Number(item.sortOrder) : index,
    title,
    subtitle: typeof item.subtitle === 'string' ? item.subtitle.trim() : '',
    imageUrl: typeof item.imageUrl === 'string' ? item.imageUrl.trim() : '',
    ctaText: typeof item.ctaText === 'string' ? item.ctaText.trim() : '',
    linkType,
    linkTarget: linkTarget || null,
    isActive: item.isActive !== false,
  };
}

function validateBannerInput(input: CreateBannerInput | UpdateBannerInput) {
  const name = normalizeName(input.name || '');
  if (!name) {
    throw new Error('条幅名称不能为空');
  }
  if (!allowedPlacements.has(input.placement)) {
    throw new Error('展示位置不合法');
  }
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new Error('至少需要一条素材');
  }
  if (input.items.length !== 1) {
    throw new Error('每个条幅只能包含一条素材');
  }
  if (input.startAt && input.endAt && input.startAt.getTime() >= input.endAt.getTime()) {
    throw new Error('开始时间必须早于结束时间');
  }
  const normalizedItems = input.items.map(normalizeItem);
  return { name, normalizedItems };
}

export class UiPromoBannerService {
  async list(params: {
    placement?: Placement | 'all';
    status?: BannerStatus | 'all';
    search?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, Number(params.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(params.pageSize || 20)));
    const conditions: Array<any> = [];
    if (params.placement && params.placement !== 'all') {
      conditions.push(eq(uiPromoBanners.placement, params.placement));
    }
    if (params.status && params.status !== 'all') {
      conditions.push(eq(uiPromoBanners.status, params.status));
    }
    if (params.search && params.search.trim()) {
      conditions.push(sql`${uiPromoBanners.name} ILIKE ${`%${params.search.trim()}%`}`);
    }
    const where = conditions.length ? and(...conditions) : undefined;
    const [totalRows, banners] = await Promise.all([
      db.select({ count: count() }).from(uiPromoBanners).where(where),
      db
        .select()
        .from(uiPromoBanners)
        .where(where)
        .orderBy(desc(uiPromoBanners.priority), desc(uiPromoBanners.updatedAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
    ]);
    const ids = banners.map((banner) => banner.id);
    const items = ids.length
      ? await db
          .select()
          .from(uiPromoBannerItems)
          .where(inArray(uiPromoBannerItems.bannerId, ids))
          .orderBy(asc(uiPromoBannerItems.sortOrder), asc(uiPromoBannerItems.createdAt))
      : [];
    const itemMap = new Map<string, typeof items>();
    for (const item of items) {
      const list = itemMap.get(item.bannerId) || [];
      list.push(item);
      itemMap.set(item.bannerId, list);
    }
    return {
      items: banners.map((banner) => ({ ...banner, items: itemMap.get(banner.id) || [] })),
      total: Number(totalRows[0]?.count || 0),
      page,
      pageSize,
    };
  }

  async create(input: CreateBannerInput) {
    const { name, normalizedItems } = validateBannerInput(input);
    const rows = await db
      .insert(uiPromoBanners)
      .values({
        name,
        placement: input.placement,
        displayType: 'single',
        status: 'draft',
        priority: Number.isFinite(input.priority) ? Number(input.priority) : 0,
        allowDismiss: input.allowDismiss !== false,
        dismissResetOnVersion: input.dismissResetOnVersion !== false,
        startAt: input.startAt || null,
        endAt: input.endAt || null,
        createdBy: input.createdBy || null,
        updatedBy: input.createdBy || null,
      })
      .returning();
    const banner = rows[0];
    await db.insert(uiPromoBannerItems).values(
      normalizedItems.map((item) => ({
        bannerId: banner.id,
        sortOrder: item.sortOrder,
        title: item.title,
        subtitle: item.subtitle || null,
        imageUrl: item.imageUrl || null,
        ctaText: item.ctaText || null,
        linkType: item.linkType,
        linkTarget: item.linkTarget,
        isActive: item.isActive,
      })),
    );
    return this.getById(banner.id);
  }

  async update(id: string, input: UpdateBannerInput) {
    const existing = await this.getBannerOrThrow(id);
    if (existing.status === 'published') {
      throw new Error('已发布条幅请先下线后再编辑');
    }
    const { name, normalizedItems } = validateBannerInput(input);
    const rows = await db
      .update(uiPromoBanners)
      .set({
        name,
        placement: input.placement,
        displayType: 'single',
        priority: Number.isFinite(input.priority) ? Number(input.priority) : 0,
        allowDismiss: input.allowDismiss !== false,
        dismissResetOnVersion: input.dismissResetOnVersion !== false,
        startAt: input.startAt || null,
        endAt: input.endAt || null,
        version: existing.version + 1,
        updatedBy: input.updatedBy || null,
        updatedAt: new Date(),
      })
      .where(eq(uiPromoBanners.id, id))
      .returning();
    await db.delete(uiPromoBannerItems).where(eq(uiPromoBannerItems.bannerId, id));
    await db.insert(uiPromoBannerItems).values(
      normalizedItems.map((item) => ({
        bannerId: id,
        sortOrder: item.sortOrder,
        title: item.title,
        subtitle: item.subtitle || null,
        imageUrl: item.imageUrl || null,
        ctaText: item.ctaText || null,
        linkType: item.linkType,
        linkTarget: item.linkTarget,
        isActive: item.isActive,
      })),
    );
    return this.getById(rows[0].id);
  }

  async publish(id: string) {
    await this.getBannerOrThrow(id);
    const rows = await db
      .update(uiPromoBanners)
      .set({ status: 'published', updatedAt: new Date() })
      .where(eq(uiPromoBanners.id, id))
      .returning();
    return rows[0];
  }

  async offline(id: string) {
    await this.getBannerOrThrow(id);
    const rows = await db
      .update(uiPromoBanners)
      .set({ status: 'offline', updatedAt: new Date() })
      .where(eq(uiPromoBanners.id, id))
      .returning();
    return rows[0];
  }

  async remove(id: string) {
    await this.getBannerOrThrow(id);
    await db.delete(uiPromoBanners).where(eq(uiPromoBanners.id, id));
  }

  async getById(id: string) {
    const banner = await this.getBannerOrThrow(id);
    const items = await db
      .select()
      .from(uiPromoBannerItems)
      .where(eq(uiPromoBannerItems.bannerId, id))
      .orderBy(asc(uiPromoBannerItems.sortOrder), asc(uiPromoBannerItems.createdAt));
    return { ...banner, items };
  }

  async getActiveForPlacement(placement: Placement) {
    const now = new Date();
    const rows = await db
      .select()
      .from(uiPromoBanners)
      .where(
        and(
          eq(uiPromoBanners.placement, placement),
          eq(uiPromoBanners.status, 'published'),
          or(sql`${uiPromoBanners.startAt} IS NULL`, lte(uiPromoBanners.startAt, now)),
          or(sql`${uiPromoBanners.endAt} IS NULL`, gte(uiPromoBanners.endAt, now)),
        ),
      )
      .orderBy(desc(uiPromoBanners.priority), desc(uiPromoBanners.updatedAt))
      .limit(20);
    if (rows.length === 0) return null;
    const bannerIds = rows.map((row) => row.id);
    const allItems = await db
      .select()
      .from(uiPromoBannerItems)
      .where(and(inArray(uiPromoBannerItems.bannerId, bannerIds), eq(uiPromoBannerItems.isActive, true)))
      .orderBy(asc(uiPromoBannerItems.sortOrder), asc(uiPromoBannerItems.createdAt));

    const firstItemByBannerId = new Map<string, (typeof allItems)[number]>();
    for (const item of allItems) {
      if (!firstItemByBannerId.has(item.bannerId)) {
        firstItemByBannerId.set(item.bannerId, item);
      }
    }

    const resolvedItems = rows
      .map((banner) => {
        const item = firstItemByBannerId.get(banner.id);
        if (!item) return null;
        return {
          ...item,
          bannerId: banner.id,
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    if (resolvedItems.length === 0) return null;
    const isCarousel = resolvedItems.length > 1;
    const primaryBanner = rows[0];
    return {
      ...primaryBanner,
      displayType: (isCarousel ? 'carousel' : 'single') as DisplayType,
      items: resolvedItems,
    };
  }

  async recordEvent(input: {
    bannerId: string;
    itemId?: string | null;
    userId?: string | null;
    eventType: EventType;
    metadata?: Record<string, unknown>;
  }) {
    if (!allowedEventTypes.has(input.eventType)) {
      throw new Error('事件类型不合法');
    }
    await this.getBannerOrThrow(input.bannerId);
    await db.insert(uiPromoBannerEvents).values({
      bannerId: input.bannerId,
      itemId: input.itemId || null,
      userId: input.userId || null,
      eventType: input.eventType,
      metadataJson: input.metadata || {},
    });
  }

  private async getBannerOrThrow(id: string) {
    const rows = await db.select().from(uiPromoBanners).where(eq(uiPromoBanners.id, id)).limit(1);
    const banner = rows[0];
    if (!banner) {
      throw new Error('条幅不存在');
    }
    return banner;
  }
}

export const uiPromoBannerService = new UiPromoBannerService();
