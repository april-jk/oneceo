import { db } from '../src/config/database';
import { modelPricing } from '../src/db/schema';

async function seedPricing() {
  console.log('🌱 开始插入测试定价数据...');
  
  const pricingData = [
    {
      model: 'qwen3-max-2026-01-23',
      modelProvider: 'qwen',
      promptPricePer1mTokens: 25,
      completionPricePer1mTokens: 1000,
      isActive: true,
    },
    {
      model: 'qwen3-vl-plus',
      modelProvider: 'qwen',
      promptPricePer1mTokens: 50,
      completionPricePer1mTokens: 2000,
      isActive: true,
    },
    {
      model: 'claude-haiku-4-5-20251001',
      modelProvider: 'anthropic',
      promptPricePer1mTokens: 180,
      completionPricePer1mTokens: 9000,
      isActive: true,
    },
    {
      model: 'gpt-4o',
      modelProvider: 'openai',
      promptPricePer1mTokens: 1800,
      completionPricePer1mTokens: 72000,
      isActive: true,
    },
    {
      model: 'gpt-4o-mini',
      modelProvider: 'openai',
      promptPricePer1mTokens: 180,
      completionPricePer1mTokens: 7200,
      isActive: true,
    },
    {
      model: 'agent.lite',
      modelProvider: 'agent',
      promptPricePer1mTokens: 25,
      completionPricePer1mTokens: 1000,
      isActive: true,
    },
    {
      model: 'agent.pro',
      modelProvider: 'agent',
      promptPricePer1mTokens: 180,
      completionPricePer1mTokens: 9000,
      isActive: true,
    },
    {
      model: 'agent.max',
      modelProvider: 'agent',
      promptPricePer1mTokens: 1800,
      completionPricePer1mTokens: 72000,
      isActive: true,
    },
    {
      model: 'sandbox.opencode',
      modelProvider: 'sandbox',
      promptPricePer1mTokens: 25,
      completionPricePer1mTokens: 1000,
      isActive: true,
    },
    {
      model: 'sandbox.codex',
      modelProvider: 'sandbox',
      promptPricePer1mTokens: 180,
      completionPricePer1mTokens: 9000,
      isActive: true,
    },
  ];

  for (const data of pricingData) {
    await db.insert(modelPricing).values(data);
    console.log(`✅ 已插入定价: ${data.model}`);
  }

  console.log('🎉 定价数据插入完成！');
  process.exit(0);
}

seedPricing().catch((error) => {
  console.error('❌ 插入失败:', error);
  process.exit(1);
});
