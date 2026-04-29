import { db } from '../src/config/database';
import { modelPricing } from '../src/db/schema';

async function seedPricing() {
  console.log('🌱 开始插入测试定价数据...');
  
  const pricingData = [
    {
      model: 'gpt-4o',
      modelProvider: 'openai',
      promptPricePer1kTokens: 25,
      completionPricePer1kTokens: 50,
      isActive: true,
    },
    {
      model: 'gpt-4o-mini',
      modelProvider: 'openai',
      promptPricePer1kTokens: 5,
      completionPricePer1kTokens: 10,
      isActive: true,
    },
    {
      model: 'claude-3-opus',
      modelProvider: 'anthropic',
      promptPricePer1kTokens: 75,
      completionPricePer1kTokens: 150,
      isActive: true,
    },
    {
      model: 'claude-3-sonnet',
      modelProvider: 'anthropic',
      promptPricePer1kTokens: 15,
      completionPricePer1kTokens: 30,
      isActive: true,
    },
    {
      model: 'claude-3-haiku',
      modelProvider: 'anthropic',
      promptPricePer1kTokens: 5,
      completionPricePer1kTokens: 10,
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
