/**
 * 数据库配置
 * 
 * 使用 PostgreSQL 数据库存储任务创建历史、对话记录等数据
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

/**
 * 数据库连接配置
 */
const DATABASE_URL = process.env.DATABASE_URL || 
  'postgresql://postgres:ByEiZNfHGcTGWJtObsvzQypmEuLanLeZ@centerbeam.proxy.rlwy.net:49514/railway';

/**
 * 创建 PostgreSQL 连接池
 */
export const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false, // Railway 需要 SSL 连接
  },
  max: 20, // 最大连接数
  idleTimeoutMillis: 30000, // 空闲连接超时
  connectionTimeoutMillis: 10000, // 连接超时
});

/**
 * 创建 Drizzle ORM 实例
 */
export const db = drizzle(pool);

/**
 * 测试数据库连接
 */
export async function testDatabaseConnection() {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW()');
    client.release();
    console.log('✅ 数据库连接成功:', result.rows[0].now);
    return true;
  } catch (error) {
    console.error('❌ 数据库连接失败:', error);
    return false;
  }
}

/**
 * 关闭数据库连接
 */
export async function closeDatabaseConnection() {
  await pool.end();
  console.log('数据库连接已关闭');
}
