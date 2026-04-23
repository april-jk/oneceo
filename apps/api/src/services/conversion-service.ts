import { eq, and } from 'drizzle-orm';
import { db } from '../config/database';
import { modelPricing, userCredits } from '../db/schema';
import { pricingService } from './pricing-service';

/**
 * 兑换比例配置
 * 
 * 基于以下原则：
 * 1. 1 credit = ¥0.01 (1分钱) 作为基准
 * 2. 模型定价参考实际 API 成本 + 20-30% 平台 margin
 * 3. 允许管理员调整汇率和 margin
 * 
 * 参考价格（每 1k tokens）：
 * - GPT-4o: ¥0.175 / ¥0.70 (prompt/completion)
 * - Claude-3-Haiku: ¥0.018 / ¥0.09
 * - Qwen3-Max: ¥0.003 / ¥0.006
 */

// 平台兑换基准：1 credit = X RMB
const DEFAULT_CREDIT_TO_RMB = 0.01; // 1 credit = 1 分钱

// 平台利润率（在 API 成本上的加成）
const DEFAULT_PLATFORM_MARGIN = 0.25; // 25%

// API 实际成本（RMB / 1k tokens）——用于计算建议定价
export const API_COST_RMB: Record<string, { prompt: number; completion: number }> = {
  // OpenAI 系列（按 $1=¥7.2 换算）
  'gpt-4o': { prompt: 0.18, completion: 0.72 },
  'gpt-4o-mini': { prompt: 0.018, completion: 0.072 },
  
  // Anthropic 系列
  'claude-3-opus': { prompt: 1.08, completion: 5.40 },
  'claude-3-sonnet': { prompt: 0.24, completion: 0.96 },
  'claude-3-haiku': { prompt: 0.018, completion: 0.09 },
  'claude-haiku-4-5-20251001': { prompt: 0.018, completion: 0.09 },
  
  // 阿里 DashScope 系列（直接 RMB）
  'qwen3-max-2026-01-23': { prompt: 0.003, completion: 0.006 },
  'qwen3-vl-plus': { prompt: 0.005, completion: 0.010 },
};

export class ConversionService {
  /**
   * 将 credits 转换为 RMB
   */
  creditsToRmb(credits: number, exchangeRate: number = DEFAULT_CREDIT_TO_RMB): number {
    return Math.round(credits * exchangeRate * 100) / 100;
  }

  /**
   * 将 RMB 转换为 credits
   */
  rmbToCredits(rmb: number, exchangeRate: number = DEFAULT_CREDIT_TO_RMB): number {
    return Math.ceil(rmb / exchangeRate);
  }

  /**
   * 根据 API 成本计算建议定价（credits / 1k tokens）
   */
  calculateSuggestedPricing(
    model: string,
    margin: number = DEFAULT_PLATFORM_MARGIN
  ): { promptPrice: number; completionPrice: number } | null {
    const cost = API_COST_RMB[model];
    if (!cost) return null;

    const rate = DEFAULT_CREDIT_TO_RMB;
    
    // 成本 + margin，转换为 credits
    const promptPrice = Math.ceil((cost.prompt * (1 + margin)) / rate);
    const completionPrice = Math.ceil((cost.completion * (1 + margin)) / rate);

    return { promptPrice, completionPrice };
  }

  /**
   * 批量计算所有已知模型的建议定价
   */
  getAllSuggestedPricing(margin: number = DEFAULT_PLATFORM_MARGIN): Array<{
    model: string;
    promptPrice: number;
    completionPrice: number;
    costPrompt: number;
    costCompletion: number;
  }> {
    return Object.entries(API_COST_RMB).map(([model, cost]) =&gt; {
      const suggested = this.calculateSuggestedPricing(model, margin)!;
      return {
        model,
        promptPrice: suggested.promptPrice,
        completionPrice: suggested.completionPrice,
        costPrompt: cost.prompt,
        costCompletion: cost.completion,
      };
    });
  }

  /**
   * 计算充值套餐建议
   */
  getRechargePackages(): Array<{ credits: number; rmb: number; bonus: number; label: string }> {
    const rate = DEFAULT_CREDIT_TO_RMB;
    return [
      { credits: 500, rmb: 5, bonus: 0, label: '体验包' },
      { credits: 2000, rmb: 20, bonus: 100, label: '基础包' },
      { credits: 5000, rmb: 50, bonus: 500, label: '标准包' },
      { credits: 12000, rmb: 100, bonus: 2000, label: '进阶包' },
      { credits: 30000, rmb: 200, bonus: 8000, label: '专业包' },
    ];
  }

  /**
   * 估算一次调用的成本（RMB）
   */
  estimateCallCost(
    model: string,
    promptTokens: number,
    completionTokens: number
  ): { credits: number; rmb: number } | null {
    const pricing = pricingService.getActivePricing(model);
    if (!pricing) return null;

    const credits = pricingService.calculateCredits(
      { promptTokens, completionTokens },
      pricing
    );

    return {
      credits,
      rmb: this.creditsToRmb(credits),
    };
  }
}

export const conversionService = new ConversionService();
