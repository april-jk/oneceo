import { pricingService } from './pricing-service';

/**
 * 兑换比例配置
 * 
 * 基于以下原则：
 * 1. 1 credit = ¥0.1 (1角钱) 作为基准，即 1 RMB = 10 credits
 * 2. 模型定价规则：1元/百万token = 10积分/百万token
 * 3. 允许管理员调整汇率和 margin
 * 
 * 参考价格（每 1k tokens，代码中乘以 1000 换算为 1M tokens 定价）：
 * - GPT-4o: ¥0.18 / ¥0.72 (prompt/completion)
 * - Claude-Haiku-4-5: ¥0.018 / ¥0.09
 * - Qwen3-Max: ¥0.0025 / ¥0.10
 */

// 平台兑换基准：1 credit = X RMB
const DEFAULT_CREDIT_TO_RMB = 0.1; // 1 credit = 1 角钱 (1 RMB = 10 credits)

// 平台利润率（在 API 成本上的加成）
const DEFAULT_PLATFORM_MARGIN = 0.25; // 25%

// API 实际成本（RMB / 1k tokens）——用于计算建议定价（代码中乘以 1000 换算为 per 1M tokens）
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
   * 获取当前计费换算规则（只读展示用）
   */
  getExchangeConfig() {
    return {
      creditToRmb: DEFAULT_CREDIT_TO_RMB,
      rmbPer100Credits: this.creditsToRmb(100),
      platformMargin: DEFAULT_PLATFORM_MARGIN,
    };
  }

  /**
   * 根据 API 成本计算建议定价（credits / 1M tokens）
   * API_COST_RMB 为 per 1k tokens，乘以 1000 后得到 per 1M tokens 的定价
   * 新规则：1 RMB = 10 credits（rate = 0.1）
   */
  calculateSuggestedPricing(
    model: string,
    margin: number = DEFAULT_PLATFORM_MARGIN
  ): { promptPrice: number; completionPrice: number } | null {
    const cost = API_COST_RMB[model];
    if (!cost) return null;

    const rate = 0.1; // 1 RMB = 10 credits
    
    // 成本 + margin，转换为 credits（API_COST_RMB 是 per 1k tokens，定价是 per 1M tokens，需乘 1000）
    const promptPrice = Math.ceil((cost.prompt * (1 + margin)) / rate * 1000);
    const completionPrice = Math.ceil((cost.completion * (1 + margin)) / rate * 1000);

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
    return Object.entries(API_COST_RMB).map(([model, cost]) => {
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
      { credits: 50, rmb: 5, bonus: 0, label: '体验包' },
      { credits: 200, rmb: 20, bonus: 10, label: '基础包' },
      { credits: 500, rmb: 50, bonus: 50, label: '标准包' },
      { credits: 1200, rmb: 120, bonus: 200, label: '进阶包' },
      { credits: 3000, rmb: 300, bonus: 800, label: '专业包' },
    ];
  }

  /**
   * 估算一次调用的成本（RMB）
   */
  async estimateCallCost(
    model: string,
    promptTokens: number,
    completionTokens: number
  ): Promise<{ credits: number; rmb: number } | null> {
    const pricing = await pricingService.getActivePricing(model);
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
