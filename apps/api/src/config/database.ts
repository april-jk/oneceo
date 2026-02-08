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
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required. Please configure it in apps/api/.env');
}

const DATABASE_URL = process.env.DATABASE_URL;

interface RetryOptions {
  retries?: number;
  delayMs?: number;
  force?: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class DatabaseManager {
  private readonly poolInstance: Pool;
  private readonly dbInstance: ReturnType<typeof drizzle>;
  private lastCheckAt = 0;
  private lastHealthy = false;
  private isClosed = false;
  private lastErrorMessage: string | null = null;
  private checkingPromise: Promise<boolean> | null = null;
  private readonly minCheckIntervalMs = 15000;

  constructor() {
    const sslDisabled = (
      process.env.DATABASE_SSL === 'disable' ||
      process.env.DATABASE_SSL === 'false' ||
      process.env.PGSSLMODE === 'disable' ||
      DATABASE_URL.includes('sslmode=disable')
    );
    const sslConfig = sslDisabled ? undefined : { rejectUnauthorized: false };

    this.poolInstance = new Pool({
      connectionString: DATABASE_URL,
      ssl: sslConfig, // 默认启用 SSL；可通过环境变量关闭
      max: 20, // 最大连接数
      idleTimeoutMillis: 30000, // 空闲连接超时
      connectionTimeoutMillis: 10000, // 连接超时
    });

    this.dbInstance = drizzle(this.poolInstance);

    this.poolInstance.on('error', (error) => {
      this.lastHealthy = false;
      this.lastCheckAt = Date.now();
      this.lastErrorMessage = error.message;
      console.error('❌ 数据库连接池异常:', error.message);
    });
  }

  get pool(): Pool {
    return this.poolInstance;
  }

  get db() {
    return this.dbInstance;
  }

  private async pingDatabase(): Promise<void> {
    await this.poolInstance.query('SELECT 1');
  }

  getConnectionState() {
    return {
      healthy: this.lastHealthy,
      lastCheckAt: this.lastCheckAt ? new Date(this.lastCheckAt).toISOString() : null,
      totalConnections: this.poolInstance.totalCount,
      idleConnections: this.poolInstance.idleCount,
      waitingClients: this.poolInstance.waitingCount,
      lastErrorMessage: this.lastErrorMessage,
      closed: this.isClosed,
    };
  }

  async checkConnection(options: RetryOptions = {}): Promise<boolean> {
    const retries = options.retries ?? 3;
    const delayMs = options.delayMs ?? 1500;
    const force = options.force ?? false;
    const now = Date.now();

    if (!force && this.lastHealthy && now - this.lastCheckAt < this.minCheckIntervalMs) {
      return true;
    }

    if (this.checkingPromise) {
      return this.checkingPromise;
    }

    this.checkingPromise = (async () => {
      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          await this.pingDatabase();
          this.lastHealthy = true;
          this.lastCheckAt = Date.now();
          this.lastErrorMessage = null;
          console.log('✅ 数据库连接成功');
          return true;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const isLastAttempt = attempt === retries;
          this.lastHealthy = false;
          this.lastCheckAt = Date.now();
          if (isLastAttempt) {
            console.error(`❌ 数据库连接失败（已重试 ${retries} 次）: ${message}`);
            return false;
          }
          console.warn(`⚠️ 数据库连接失败，准备重试 (${attempt}/${retries}): ${message}`);
          await sleep(delayMs);
        }
      }

      return false;
    })();

    try {
      return await this.checkingPromise;
    } finally {
      this.checkingPromise = null;
    }
  }

  async close(): Promise<void> {
    this.isClosed = true;
    await this.poolInstance.end();
  }
}

const GLOBAL_DB_MANAGER_KEY = '__oneceo_db_manager__';
const globalState = globalThis as any;

function getDatabaseManager(): DatabaseManager {
  if (!globalState[GLOBAL_DB_MANAGER_KEY]) {
    globalState[GLOBAL_DB_MANAGER_KEY] = new DatabaseManager();
  }
  return globalState[GLOBAL_DB_MANAGER_KEY] as DatabaseManager;
}

const databaseManager = getDatabaseManager();

/**
 * 共享 Drizzle ORM 实例（单例）
 */
export const db = databaseManager.db;

/**
 * 获取连接池状态（用于诊断）
 */
export function getDatabaseConnectionState() {
  return databaseManager.getConnectionState();
}

/**
 * 测试数据库连接
 */
export async function testDatabaseConnection(options: RetryOptions = {}): Promise<boolean> {
  return databaseManager.checkConnection(options);
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
  await databaseManager.close();
  console.log('数据库连接已关闭');
}
