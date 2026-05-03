import { eq } from 'drizzle-orm';
import { db } from '../src/config/database';
import { appUsers, userCredits } from '../src/db/schema';

async function initUserCredits() {
  console.log('🌱 开始为现有用户初始化积分...');
  
  const users = await db.select().from(appUsers);
  console.log(`找到 ${users.length} 个用户`);

  for (const user of users) {
    const existing = await db.select().from(userCredits).where(
      eq(userCredits.userId, user.id)
    );
    
    if (existing.length === 0) {
      await db.insert(userCredits).values({
        userId: user.id,
        balance: 500,
        totalEarned: 500,
        totalConsumed: 0,
      });
      console.log(`✅ 已为用户 ${user.email} 初始化 500 积分`);
    } else {
      console.log(`⏭️ 用户 ${user.email} 已有积分记录，跳过`);
    }
  }

  console.log('🎉 用户积分初始化完成！');
  process.exit(0);
}

initUserCredits().catch((error) => {
  console.error('❌ 初始化失败:', error);
  process.exit(1);
});
