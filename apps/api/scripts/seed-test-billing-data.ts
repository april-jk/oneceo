import { eq } from 'drizzle-orm';
import { db } from '../src/config/database';
import { appUsers, creditTransactions, tokenUsageLogs } from '../src/db/schema';

async function seedTestData() {
  console.log('🌱 开始插入测试数据...');
  
  const users = await db.select().from(appUsers).limit(3);
  
  for (const user of users) {
    const userId = user.id;
    
    // 插入消费记录
    for (let i = 0; i < 5; i++) {
      const credits = Math.floor(Math.random() * 100) + 10;
      await db.insert(creditTransactions).values({
        userId,
        type: 'consume',
        amount: -credits,
        balanceAfter: 500 - (i + 1) * 50,
        sourceType: 'session',
        description: `会话调用: gpt-4o`,
      });
    }

    // 插入 token 使用日志
    for (let i = 0; i < 3; i++) {
      const promptTokens = Math.floor(Math.random() * 2000) + 500;
      const completionTokens = Math.floor(Math.random() * 1000) + 200;
      await db.insert(tokenUsageLogs).values({
        userId,
        model: 'gpt-4o',
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        creditsConsumed: Math.ceil((promptTokens * 25 + completionTokens * 50) / 1000),
        pricingSnapshot: {
          model: 'gpt-4o',
          promptPricePer1kTokens: 25,
          completionPricePer1kTokens: 50,
        },
      });
    }

    console.log(`✅ 已为用户 ${user.email} 插入测试数据`);
  }

  console.log('🎉 测试数据插入完成！');
  process.exit(0);
}

seedTestData().catch((error) => {
  console.error('❌ 插入失败:', error);
  process.exit(1);
});
