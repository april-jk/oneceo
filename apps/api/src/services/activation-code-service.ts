import { eq, and, sql, desc, count, like, gte, lte, isNull, or } from 'drizzle-orm';
import { db } from '../config/database';
import {
  creditActivationCodes,
  creditActivationCodeUses,
  creditTransactions,
  userCredits,
  appUsers,
  adminUsers,
} from '../db/schema';
import type {
  CreditActivationCode,
  NewCreditActivationCode,
  CreditActivationCodeUse,
} from '../db/schema';
import { BillingService } from './billing-service';

const billingService = new BillingService();

/**
 * 生成随机激活码
 */
function generateActivationCode(prefix?: string): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 排除易混淆字符 I, O, 0, 1
  const segments = 4;
  const segmentLength = 4;
  const parts: string[] = [];

  for (let i = 0; i < segments; i++) {
    let segment = '';
    for (let j = 0; j < segmentLength; j++) {
      segment += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    parts.push(segment);
  }

  const code = parts.join('-');
  return prefix ? `${prefix}-${code}` : code;
}

/**
 * 生成批次ID
 */
function generateBatchId(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const time = now.toISOString().slice(11, 19).replace(/:/g, '');
  return `BATCH-${date}-${time}`;
}

export class ActivationCodeService {
  /**
   * 创建激活码
   */
  async createActivationCodes(params: {
    creditsAmount: number;
    quantity?: number;
    maxUses?: number;
    expiresInDays?: number | null;
    description?: string;
    prefix?: string;
    adminUserId?: string;
  }): Promise<{ items: CreditActivationCode[]; batchId?: string }> {
    const {
      creditsAmount,
      quantity = 1,
      maxUses = 1,
      expiresInDays,
      description,
      prefix,
      adminUserId,
    } = params;

    if (creditsAmount <= 0 || !Number.isFinite(creditsAmount)) {
      throw new Error('积分数量必须大于 0');
    }

    if (quantity < 1 || quantity > 100 || !Number.isInteger(quantity)) {
      throw new Error('生成数量必须在 1-100 之间');
    }

    if (maxUses < 1 || !Number.isInteger(maxUses)) {
      throw new Error('最大使用次数必须大于 0');
    }

    const batchId = quantity > 1 ? generateBatchId() : undefined;
    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    const items: CreditActivationCode[] = [];
    const usedCodes = new Set<string>();

    for (let i = 0; i < quantity; i++) {
      let code: string;
      let attempts = 0;

      // 确保生成唯一码
      do {
        code = generateActivationCode(prefix);
        attempts++;
        if (attempts > 10) {
          throw new Error('生成唯一激活码失败，请重试');
        }
      } while (usedCodes.has(code));

      usedCodes.add(code);

      const result = await db
        .insert(creditActivationCodes)
        .values({
          code,
          creditsAmount,
          maxUses,
          expiresAt,
          createdBy: adminUserId as any,
          batchId,
          description,
        })
        .returning();

      items.push(result[0]);
    }

    return { items, batchId };
  }

  /**
   * 获取激活码列表
   */
  async listActivationCodes(params: {
    page?: number;
    limit?: number;
    status?: string;
    batchId?: string;
    search?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }): Promise<{
    items: Array<CreditActivationCode & { creatorName?: string | null; usedByName?: string | null; usedByEmail?: string | null }>;
    total: number;
    page: number;
    limit: number;
  }> {
    const {
      page = 1,
      limit = 20,
      status,
      batchId,
      search,
      sortBy = 'created_at',
      sortOrder = 'desc',
    } = params;

    const offset = (page - 1) * limit;
    const conditions: any[] = [];

    // 状态筛选
    if (status && status !== 'all') {
      if (status === 'expired') {
        // 过期状态：已过期但状态可能还是 active
        conditions.push(
          or(
            eq(creditActivationCodes.status, 'expired'),
            and(
              eq(creditActivationCodes.status, 'active'),
              sql`${creditActivationCodes.expiresAt} IS NOT NULL AND ${creditActivationCodes.expiresAt} < NOW()`
            )
          )
        );
      } else {
        conditions.push(eq(creditActivationCodes.status, status));
      }
    }

    // 批次筛选
    if (batchId) {
      conditions.push(eq(creditActivationCodes.batchId, batchId));
    }

    // 搜索
    if (search) {
      conditions.push(like(creditActivationCodes.code, `%${search}%`));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // 排序
    const sortColumn = (() => {
      switch (sortBy) {
        case 'expires_at':
          return creditActivationCodes.expiresAt;
        case 'credits_amount':
          return creditActivationCodes.creditsAmount;
        case 'created_at':
        default:
          return creditActivationCodes.createdAt;
      }
    })();

    const orderFn = sortOrder === 'asc' ? desc : desc; // 默认降序

    // 查询总数
    const countResult = await db
      .select({ count: count() })
      .from(creditActivationCodes)
      .where(whereClause);

    const total = Number(countResult[0].count);

    // 查询列表（带创建者和使用者信息）
    const items = await db
      .select({
        id: creditActivationCodes.id,
        code: creditActivationCodes.code,
        creditsAmount: creditActivationCodes.creditsAmount,
        status: creditActivationCodes.status,
        maxUses: creditActivationCodes.maxUses,
        currentUses: creditActivationCodes.currentUses,
        expiresAt: creditActivationCodes.expiresAt,
        createdBy: creditActivationCodes.createdBy,
        usedBy: creditActivationCodes.usedBy,
        usedAt: creditActivationCodes.usedAt,
        batchId: creditActivationCodes.batchId,
        description: creditActivationCodes.description,
        metadataJson: creditActivationCodes.metadataJson,
        createdAt: creditActivationCodes.createdAt,
        updatedAt: creditActivationCodes.updatedAt,
        creatorName: adminUsers.displayName,
        usedByName: appUsers.displayName,
        usedByEmail: appUsers.email,
      })
      .from(creditActivationCodes)
      .leftJoin(adminUsers, eq(creditActivationCodes.createdBy, adminUsers.id))
      .leftJoin(appUsers, eq(creditActivationCodes.usedBy, appUsers.id))
      .where(whereClause)
      .orderBy(sortOrder === 'asc' ? sortColumn : desc(sortColumn))
      .limit(limit)
      .offset(offset);

    return { items, total, page, limit };
  }

  /**
   * 获取激活码详情
   */
  async getActivationCodeDetail(id: string): Promise<
    | (CreditActivationCode & {
        creatorName?: string | null;
        usedByName?: string | null;
        usedByEmail?: string | null;
        uses: Array<CreditActivationCodeUse & { userName?: string | null; userEmail?: string | null }>;
      })
    | null
  > {
    const codeResult = await db
      .select({
        id: creditActivationCodes.id,
        code: creditActivationCodes.code,
        creditsAmount: creditActivationCodes.creditsAmount,
        status: creditActivationCodes.status,
        maxUses: creditActivationCodes.maxUses,
        currentUses: creditActivationCodes.currentUses,
        expiresAt: creditActivationCodes.expiresAt,
        createdBy: creditActivationCodes.createdBy,
        usedBy: creditActivationCodes.usedBy,
        usedAt: creditActivationCodes.usedAt,
        batchId: creditActivationCodes.batchId,
        description: creditActivationCodes.description,
        metadataJson: creditActivationCodes.metadataJson,
        createdAt: creditActivationCodes.createdAt,
        updatedAt: creditActivationCodes.updatedAt,
        creatorName: adminUsers.displayName,
        usedByName: appUsers.displayName,
        usedByEmail: appUsers.email,
      })
      .from(creditActivationCodes)
      .leftJoin(adminUsers, eq(creditActivationCodes.createdBy, adminUsers.id))
      .leftJoin(appUsers, eq(creditActivationCodes.usedBy, appUsers.id))
      .where(eq(creditActivationCodes.id, id))
      .limit(1);

    if (codeResult.length === 0) {
      return null;
    }

    // 查询使用记录
    const uses = await db
      .select({
        id: creditActivationCodeUses.id,
        activationCodeId: creditActivationCodeUses.activationCodeId,
        userId: creditActivationCodeUses.userId,
        creditsGranted: creditActivationCodeUses.creditsGranted,
        transactionId: creditActivationCodeUses.transactionId,
        usedAt: creditActivationCodeUses.usedAt,
        metadataJson: creditActivationCodeUses.metadataJson,
        userName: appUsers.displayName,
        userEmail: appUsers.email,
      })
      .from(creditActivationCodeUses)
      .leftJoin(appUsers, eq(creditActivationCodeUses.userId, appUsers.id))
      .where(eq(creditActivationCodeUses.activationCodeId, id))
      .orderBy(desc(creditActivationCodeUses.usedAt));

    return { ...codeResult[0], uses };
  }

  /**
   * 更新激活码状态（启用/禁用）
   */
  async updateActivationCodeStatus(
    id: string,
    status: 'active' | 'disabled'
  ): Promise<CreditActivationCode | null> {
    const result = await db
      .update(creditActivationCodes)
      .set({ status, updatedAt: new Date() })
      .where(
        and(
          eq(creditActivationCodes.id, id),
          // 只允许 active 和 disabled 之间切换
          sql`${creditActivationCodes.status} IN ('active', 'disabled')`
        )
      )
      .returning();

    return result[0] || null;
  }

  /**
   * 删除激活码
   */
  async deleteActivationCode(id: string): Promise<boolean> {
    // 只允许删除未使用的激活码
    const result = await db
      .delete(creditActivationCodes)
      .where(
        and(
          eq(creditActivationCodes.id, id),
          eq(creditActivationCodes.currentUses, 0)
        )
      )
      .returning();

    return result.length > 0;
  }

  /**
   * 获取激活码统计
   */
  async getActivationCodeStats(): Promise<{
    total: number;
    active: number;
    used: number;
    disabled: number;
    expired: number;
    totalCredits: number;
    usedCredits: number;
  }> {
    // 获取所有激活码（动态判断过期状态）
    const allCodes = await db
      .select({
        status: creditActivationCodes.status,
        creditsAmount: creditActivationCodes.creditsAmount,
        currentUses: creditActivationCodes.currentUses,
        expiresAt: creditActivationCodes.expiresAt,
      })
      .from(creditActivationCodes);

    const now = new Date();
    let total = 0;
    let active = 0;
    let used = 0;
    let disabled = 0;
    let expired = 0;
    let totalCredits = 0;
    let usedCredits = 0;

    for (const code of allCodes) {
      total++;
      totalCredits += code.creditsAmount;

      const isExpired = code.expiresAt && code.expiresAt < now;

      if (code.status === 'disabled') {
        disabled++;
      } else if (code.status === 'used' || code.currentUses > 0) {
        used++;
        usedCredits += code.creditsAmount;
      } else if (isExpired || code.status === 'expired') {
        expired++;
      } else if (code.status === 'active') {
        active++;
      }
    }

    return { total, active, used, disabled, expired, totalCredits, usedCredits };
  }

  /**
   * 兑换激活码（用户端）
   */
  async redeemActivationCode(
    code: string,
    userId: string
  ): Promise<{ success: boolean; creditsGranted: number; newBalance: number; message: string }> {
    // 查找激活码
    const activationCode = await db
      .select()
      .from(creditActivationCodes)
      .where(eq(creditActivationCodes.code, code))
      .limit(1);

    if (activationCode.length === 0) {
      return { success: false, creditsGranted: 0, newBalance: 0, message: '激活码不存在' };
    }

    const ac = activationCode[0];

    // 检查状态
    if (ac.status === 'disabled') {
      return { success: false, creditsGranted: 0, newBalance: 0, message: '激活码已被禁用' };
    }

    if (ac.status === 'used' && ac.maxUses === 1) {
      return { success: false, creditsGranted: 0, newBalance: 0, message: '激活码已被使用' };
    }

    // 检查是否过期
    if (ac.expiresAt && ac.expiresAt < new Date()) {
      // 更新状态为过期
      await db
        .update(creditActivationCodes)
        .set({ status: 'expired', updatedAt: new Date() })
        .where(eq(creditActivationCodes.id, ac.id));
      return { success: false, creditsGranted: 0, newBalance: 0, message: '激活码已过期' };
    }

    // 检查使用次数
    if (ac.currentUses >= ac.maxUses) {
      return { success: false, creditsGranted: 0, newBalance: 0, message: '激活码已达到最大使用次数' };
    }

    // 检查用户是否已使用过（单次使用码）
    if (ac.maxUses === 1) {
      const existingUse = await db
        .select()
        .from(creditActivationCodeUses)
        .where(
          and(
            eq(creditActivationCodeUses.activationCodeId, ac.id),
            eq(creditActivationCodeUses.userId, userId)
          )
        )
        .limit(1);

      if (existingUse.length > 0) {
        return { success: false, creditsGranted: 0, newBalance: 0, message: '您已使用过该激活码' };
      }
    }

    // 执行兑换（事务）
    return await db.transaction(async (trx) => {
      // 增加用户积分
      const creditResult = await billingService.addCredits(userId, ac.creditsAmount, 'recharge', {
        sourceType: 'activation_code',
        sourceId: ac.id,
        description: `激活码兑换: ${ac.code}`,
      });

      if (!creditResult.success) {
        return { success: false, creditsGranted: 0, newBalance: 0, message: '积分添加失败' };
      }

      // 更新激活码状态
      const newUses = ac.currentUses + 1;
      const updateData: any = {
        currentUses: newUses,
        updatedAt: new Date(),
      };

      if (ac.maxUses === 1) {
        updateData.status = 'used';
        updateData.usedBy = userId;
        updateData.usedAt = new Date();
      }

      await trx
        .update(creditActivationCodes)
        .set(updateData)
        .where(eq(creditActivationCodes.id, ac.id));

      // 记录使用
      await trx.insert(creditActivationCodeUses).values({
        activationCodeId: ac.id,
        userId,
        creditsGranted: ac.creditsAmount,
        transactionId: creditResult.transactionId as any,
      });

      return {
        success: true,
        creditsGranted: ac.creditsAmount,
        newBalance: creditResult.balanceAfter,
        message: `成功兑换 ${ac.creditsAmount} 积分`,
      };
    });
  }

  /**
   * 批量获取激活码（用于导出）
   */
  async exportActivationCodes(params: {
    status?: string;
    batchId?: string;
  }): Promise<Array<CreditActivationCode & { creatorName?: string | null }>> {
    const conditions: any[] = [];

    if (params.status && params.status !== 'all') {
      conditions.push(eq(creditActivationCodes.status, params.status));
    }

    if (params.batchId) {
      conditions.push(eq(creditActivationCodes.batchId, params.batchId));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    return db
      .select({
        id: creditActivationCodes.id,
        code: creditActivationCodes.code,
        creditsAmount: creditActivationCodes.creditsAmount,
        status: creditActivationCodes.status,
        maxUses: creditActivationCodes.maxUses,
        currentUses: creditActivationCodes.currentUses,
        expiresAt: creditActivationCodes.expiresAt,
        createdBy: creditActivationCodes.createdBy,
        usedBy: creditActivationCodes.usedBy,
        usedAt: creditActivationCodes.usedAt,
        batchId: creditActivationCodes.batchId,
        description: creditActivationCodes.description,
        metadataJson: creditActivationCodes.metadataJson,
        createdAt: creditActivationCodes.createdAt,
        updatedAt: creditActivationCodes.updatedAt,
        creatorName: adminUsers.displayName,
      })
      .from(creditActivationCodes)
      .leftJoin(adminUsers, eq(creditActivationCodes.createdBy, adminUsers.id))
      .where(whereClause)
      .orderBy(desc(creditActivationCodes.createdAt));
  }
}
