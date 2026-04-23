import { eq, and, desc } from 'drizzle-orm';
import { db } from '../config/database';
import { modelPricing } from '../db/schema';
import type { ModelPricing } from '../db/schema';

// 系统固定的缓存比例（由模型提供商决定，非管理员配置）
const CACHE_RATIOS = {
  openai: { hit: 0.5, creation: 0 },
  anthropic: { hit: 0.1, creation: 1.25 },
} as const;

export class PricingService {
  /**
   * 获取模型的生效中定价
   */
  async getActivePricing(model: string): Promise<ModelPricing | null> {
    const result = await db
      .select()
      .from(modelPricing)
      .where(and(
        eq(modelPricing.model, model),
        eq(modelPricing.isActive, true)
      ))
      .limit(1);
    
    return result[0] || null;
  }

  /**
   * 列出所有生效中的定价
   */
  async listActivePricing(): Promise<ModelPricing[]> {
    return await db
      .select()
      .from(modelPricing)
      .where(eq(modelPricing.isActive, true))
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
  }): Promise<ModelPricing> {
    return await db.transaction(async (trx) => {
      // 停用该模型的旧定价
      await trx
        .update(modelPricing)
        .set({
          isActive: false,
          effectiveUntil: new Date(),
          updatedAt: new Date(),
        })
        .where(and(
          eq(modelPricing.model, data.model),
          eq(modelPricing.isActive, true)
        ));

      // 创建新定价
      const result = await trx.insert(modelPricing).values({
        model: data.model,
        modelProvider: data.modelProvider,
        promptPricePer1kTokens: data.promptPricePer1kTokens,
        completionPricePer1kTokens: data.completionPricePer1kTokens,
        isActive: true,
        effectiveFrom: new Date(),
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
    pricing: ModelPricing
  ): number {
    const ratio = CACHE_RATIOS[pricing.modelProvider as keyof typeof CACHE_RATIOS] || { hit: 0, creation: 0 };
    
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
   * 获取缓存比例信息（用于展示）
   */
  getCacheRatios(provider: string): { hit: number; creation: number } | null {
    return CACHE_RATIOS[provider as keyof typeof CACHE_RATIOS] || null;
  }
}

export const pricingService = new PricingService();
