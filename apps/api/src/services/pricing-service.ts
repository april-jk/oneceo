import { eq, and, desc, lte, or, gt, isNull } from 'drizzle-orm';
import { db } from '../config/database';
import { modelPricing, cachePricingConfig } from '../db/schema';
import type { ModelPricing } from '../db/schema';

// 硬编码默认值（数据库无配置时的兜底）
const DEFAULT_CACHE_RATIOS = {
  openai: { hit: 0.5, creation: 0 },
  anthropic: { hit: 0.1, creation: 1.25 },
  qwen: { hit: 0.2, creation: 1.25 },
} as const;

export class PricingService {
  /**
   * 获取模型的生效中定价
   */
  async getActivePricing(model: string): Promise<ModelPricing | null> {
    const now = new Date();
    const result = await db
      .select()
      .from(modelPricing)
      .where(and(
        eq(modelPricing.model, model),
        eq(modelPricing.isActive, true),
        lte(modelPricing.effectiveFrom, now),
        or(
          isNull(modelPricing.effectiveUntil),
          gt(modelPricing.effectiveUntil, now)
        )
      ))
      .orderBy(desc(modelPricing.effectiveFrom))
      .limit(1);
    
    return result[0] || null;
  }

  resolveCacheProvider(input: { model: string; modelProvider: string }): string {
    const model = String(input.model || '').toLowerCase();
    const provider = String(input.modelProvider || '').toLowerCase();
    if (model.startsWith('qwen') || model.includes('/qwen')) return 'qwen';
    return provider;
  }

  /**
   * 列出所有生效中的定价
   */
  async listActivePricing(): Promise<ModelPricing[]> {
    const now = new Date();
    return await db
      .select()
      .from(modelPricing)
      .where(and(
        eq(modelPricing.isActive, true),
        lte(modelPricing.effectiveFrom, now),
        or(isNull(modelPricing.effectiveUntil), gt(modelPricing.effectiveUntil, now))
      ))
      .orderBy(modelPricing.model);
  }

  /**
   * 列出所有定价（含历史）
   */
  async listAllPricing(): Promise<ModelPricing[]> {
    return await db
      .select()
      .from(modelPricing)
      .orderBy(desc(modelPricing.createdAt));
  }

  /**
   * 创建或更新模型定价
   * 如果该模型已有生效中定价，自动停用旧记录
   */
  async createPricing(data: {
    model: string;
    modelProvider: string;
    promptPricePer1kTokens: number;
    completionPricePer1kTokens: number;
    effectiveFrom?: Date;
  }): Promise<ModelPricing> {
    return await db.transaction(async (trx) => {
      const effectiveFrom = data.effectiveFrom || new Date();
      const isImmediate = effectiveFrom.getTime() <= Date.now();

      // 当前与未来版本通过 effective_from/effective_until 切换，允许管理员预设生效时间。
      await trx
        .update(modelPricing)
        .set({
          ...(isImmediate ? { isActive: false } : {}),
          effectiveUntil: effectiveFrom,
          updatedAt: new Date(),
        })
        .where(and(
          eq(modelPricing.model, data.model),
          eq(modelPricing.isActive, true),
          or(
            isNull(modelPricing.effectiveUntil),
            gt(modelPricing.effectiveUntil, effectiveFrom)
          )
        ));

      // 创建新定价
      const result = await trx.insert(modelPricing).values({
        model: data.model,
        modelProvider: data.modelProvider,
        promptPricePer1kTokens: data.promptPricePer1kTokens,
        completionPricePer1kTokens: data.completionPricePer1kTokens,
        isActive: true,
        effectiveFrom,
      }).returning();

      return result[0];
    });
  }

  /**
   * 停用定价
   */
  async deactivatePricing(pricingId: string): Promise<void> {
    await db
      .update(modelPricing)
      .set({
        isActive: false,
        effectiveUntil: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(modelPricing.id, pricingId as any));
  }

  /**
   * 计算积分消耗（含缓存）
   */
  calculateCredits(
    usage: {
      promptTokens: number;
      cachedPromptTokens?: number;
      nonCachedPromptTokens?: number;
      cacheCreationTokens?: number;
      completionTokens: number;
    },
    pricing: ModelPricing,
    cacheRatio?: { hit: number; creation: number }
  ): number {
    const ratio = cacheRatio ?? this.getDefaultCacheRatios(this.resolveCacheProvider(pricing)) ?? { hit: 0, creation: 0 };

    const cacheHitPrice = pricing.promptPricePer1kTokens * ratio.hit;
    const cacheCreationPrice = pricing.promptPricePer1kTokens * ratio.creation;

    const nonCachedPromptTokens = usage.nonCachedPromptTokens ?? (usage.promptTokens - (usage.cachedPromptTokens || 0));
    const cachedPromptTokens = usage.cachedPromptTokens || 0;
    const cacheCreationTokens = usage.cacheCreationTokens || 0;

    return Math.ceil(
      (nonCachedPromptTokens * pricing.promptPricePer1kTokens / 1000) +
      (cachedPromptTokens * cacheHitPrice / 1000) +
      (cacheCreationTokens * cacheCreationPrice / 1000) +
      (usage.completionTokens * pricing.completionPricePer1kTokens / 1000)
    );
  }

  /**
   * 获取缓存比例信息（从数据库读取，无记录时回退到默认值）
   */
  async getCacheRatios(provider: string): Promise<{ hit: number; creation: number } | null> {
    const config = await db
      .select()
      .from(cachePricingConfig)
      .where(and(
        eq(cachePricingConfig.provider, provider),
        eq(cachePricingConfig.isActive, true)
      ))
      .limit(1);

    if (config[0]) {
      return {
        hit: config[0].hitRatio / 1000,
        creation: config[0].creationRatio / 1000,
      };
    }

    return DEFAULT_CACHE_RATIOS[provider as keyof typeof DEFAULT_CACHE_RATIOS] || null;
  }

  async getCacheRatiosForPricing(pricing: Pick<ModelPricing, 'model' | 'modelProvider'>): Promise<{ hit: number; creation: number } | null> {
    return this.getCacheRatios(this.resolveCacheProvider(pricing));
  }

  /**
   * 同步获取缓存比例（用于已有同步上下文的场景，如 calculateCredits）
   * 注意：此方法会阻塞执行数据库查询，仅应在必要时使用
   */
  getDefaultCacheRatios(provider: string): { hit: number; creation: number } | null {
    return DEFAULT_CACHE_RATIOS[provider as keyof typeof DEFAULT_CACHE_RATIOS] || null;
  }

  /**
   * 创建/更新缓存比例配置
   * 同一 provider 的已有 active 记录自动停用
   */
  async createCacheConfig(data: {
    provider: string;
    hitRatio: number;
    creationRatio: number;
  }): Promise<{ id: string; provider: string; hitRatio: number; creationRatio: number }> {
    return await db.transaction(async (trx) => {
      // 停用该 provider 的旧配置
      await trx
        .update(cachePricingConfig)
        .set({
          isActive: false,
          effectiveUntil: new Date(),
          updatedAt: new Date(),
        })
        .where(and(
          eq(cachePricingConfig.provider, data.provider),
          eq(cachePricingConfig.isActive, true)
        ));

      // 创建新配置
      const result = await trx.insert(cachePricingConfig).values({
        provider: data.provider,
        hitRatio: data.hitRatio,
        creationRatio: data.creationRatio,
        isActive: true,
        effectiveFrom: new Date(),
      }).returning();

      return {
        id: result[0].id,
        provider: result[0].provider,
        hitRatio: result[0].hitRatio,
        creationRatio: result[0].creationRatio,
      };
    });
  }

  /**
   * 列出所有生效中的缓存配置
   */
  async listActiveCacheConfigs(): Promise<Array<{
    id: string;
    provider: string;
    hitRatio: number;
    creationRatio: number;
    effectiveFrom: Date;
  }>> {
    return await db
      .select({
        id: cachePricingConfig.id,
        provider: cachePricingConfig.provider,
        hitRatio: cachePricingConfig.hitRatio,
        creationRatio: cachePricingConfig.creationRatio,
        effectiveFrom: cachePricingConfig.effectiveFrom,
      })
      .from(cachePricingConfig)
      .where(eq(cachePricingConfig.isActive, true))
      .orderBy(cachePricingConfig.provider);
  }
}

export const pricingService = new PricingService();
