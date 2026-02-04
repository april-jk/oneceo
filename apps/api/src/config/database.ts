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

interface RetryOptions {
  retries?: number;
  delayMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pingDatabase(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
  } finally {
    client.release();
  }
}

/**
 * 测试数据库连接
 */
export async function testDatabaseConnection(options: RetryOptions = {}): Promise<boolean> {
  const retries = options.retries ?? 3;
  const delayMs = options.delayMs ?? 1500;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await pingDatabase();
      console.log('✅ 数据库连接成功');
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isLastAttempt = attempt === retries;
      if (isLastAttempt) {
        console.error(`❌ 数据库连接失败（已重试 ${retries} 次）: ${message}`);
        return false;
      }
      console.warn(`⚠️ 数据库连接失败，准备重试 (${attempt}/${retries}): ${message}`);
      await sleep(delayMs);
    }
  }

  return false;
}

/**
 * 确保数据库可用，否则抛出异常
 */
export async function ensureDatabaseConnection(options: RetryOptions = {}): Promise<void> {
  const ok = await testDatabaseConnection(options);
  if (!ok) {
    throw new Error('数据库连接不可用，请稍后重试');
  }
}

/**
 * 关闭数据库连接
 */
export async function closeDatabaseConnection() {
  await pool.end();
  console.log('数据库连接已关闭');
}
