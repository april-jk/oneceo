import express from 'express';
import { eq, and, sql, desc, count, gte, lte } from 'drizzle-orm';
import { db } from '../config/database';
import { userCredits, creditTransactions, tokenUsageLogs, modelPricing, appUsers } from '../db/schema';
import { billingService } from '../services/billing-service';
import { pricingService } from '../services/pricing-service';
import { conversionService } from '../services/conversion-service';
import { adminAuthMiddleware } from '../middleware/admin-auth-middleware';
import { billingRuntimeConfigService } from '../services/billing-runtime-config-service';
import { normalizeAgentModelTier, type AgentModelTier } from '../services/agent-runtime-profile-service';
import { ActivationCodeService } from '../services/activation-code-service';

const router = express.Router();
const POSTGRES_INTEGER_MAX = 2147483647;
const CACHE_HIT_RATIO_MAX = 1000; // 100%，存储单位为千分比
const CACHE_CREATION_RATIO_MAX = 10000; // 1000%，允许缓存创建倍率高于 100%
const BILLING_DEBUG_MAX_PROMPT_CHARS = 24000;
const BILLING_DEBUG_MAX_TOKENS = 512;
const UUID_LIKE_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type BillingDebugMode = 'request_only' | 'dry_run';

function isUuidLike(value: unknown): value is string {
  return typeof value === 'string' && UUID_LIKE_REGEX.test(value.trim());
}

function normalizeSandboxEngine(value: unknown): 'opencode' | 'codex' | null {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (text === 'opencode' || text === 'codex') return text;
  return null;
}

function readNumericField(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function pickNumericField(warnings: string[], label: string, candidates: Array<[string, unknown]>) {
  const values = candidates
    .map(([path, value]) => ({ path, value: readNumericField(value), raw: value }))
    .filter((item) => item.value !== undefined) as Array<{ path: string; value: number; raw: unknown }>;
  if (values.length === 0) return 0;
  const first = values[0];
  const conflicts = values.filter((item) => item.value !== first.value);
  if (conflicts.length > 0) {
    warnings.push(`${label} 等价字段不一致：${values.map((item) => `${item.path}=${item.value}`).join(', ')}`);
  }
  for (const item of values) {
    if (typeof item.raw === 'string') warnings.push(`${item.path} 为字符串，已转换为数字`);
    if (item.value < 0) warnings.push(`${item.path} 为负数`);
  }
  return Math.max(0, first.value);
}

function normalizeBillingDebugUsage(rawUsage: any) {
  const warnings: string[] = [];
  const usage = rawUsage && typeof rawUsage === 'object' ? rawUsage : {};
  const details = usage.prompt_tokens_details && typeof usage.prompt_tokens_details === 'object'
    ? usage.prompt_tokens_details
    : {};
  const cacheCreation = details.cache_creation && typeof details.cache_creation === 'object'
    ? details.cache_creation
    : {};

  const promptTokens = pickNumericField(warnings, 'prompt tokens', [
    ['usage.prompt_tokens', usage.prompt_tokens],
    ['usage.input_tokens', usage.input_tokens],
  ]);
  const completionTokens = pickNumericField(warnings, 'completion tokens', [
    ['usage.completion_tokens', usage.completion_tokens],
    ['usage.output_tokens', usage.output_tokens],
  ]);
  const totalTokensFromUsage = pickNumericField(warnings, 'total tokens', [
    ['usage.total_tokens', usage.total_tokens],
  ]);
  const cachedPromptTokens = pickNumericField(warnings, 'cached prompt tokens', [
    ['usage.prompt_tokens_details.cached_tokens', details.cached_tokens],
    ['usage.cached_tokens', usage.cached_tokens],
    ['usage.cache_read_input_tokens', usage.cache_read_input_tokens],
  ]);
  const cacheCreationTokens = pickNumericField(warnings, 'cache creation tokens', [
    ['usage.prompt_tokens_details.cache_creation_input_tokens', details.cache_creation_input_tokens],
    ['usage.prompt_tokens_details.cache_creation.cache_creation_input_tokens', cacheCreation.cache_creation_input_tokens],
    ['usage.prompt_tokens_details.cache_creation.ephemeral_5m_input_tokens', cacheCreation.ephemeral_5m_input_tokens],
    ['usage.cache_creation_input_tokens', usage.cache_creation_input_tokens],
  ]);

  if (!rawUsage || typeof rawUsage !== 'object') warnings.push('上游未返回 usage，不能计算真实扣费');
  if (promptTokens <= 0) warnings.push('缺少有效 prompt/input tokens');
  if (completionTokens < 0) warnings.push('completion/output tokens 异常');
  if (cachedPromptTokens + cacheCreationTokens > promptTokens) {
    warnings.push('cached tokens + cache creation tokens 超过 prompt tokens');
  }

  const nonCachedPromptTokens = Math.max(0, promptTokens - cachedPromptTokens - cacheCreationTokens);
  return {
    normalizedUsage: {
      promptTokens,
      cachedPromptTokens,
      cacheCreationTokens,
      nonCachedPromptTokens,
      completionTokens,
      totalTokens: totalTokensFromUsage || promptTokens + completionTokens,
    },
    warnings,
  };
}

function buildBillingDebugMessages(input: { cacheMode: string; systemPrompt: string; userPrompt: string }) {
  if (input.cacheMode === 'explicit') {
    return [
      {
        role: 'system',
        content: [
          {
            type: 'text',
            text: input.systemPrompt,
            cache_control: { type: 'ephemeral' },
          },
        ],
      },
      { role: 'user', content: input.userPrompt },
    ];
  }
  return [
    { role: 'system', content: input.systemPrompt },
    { role: 'user', content: input.userPrompt },
  ];
}

function calculateBillingDebugBreakdown(input: {
  promptPricePer1mTokens: number;
  completionPricePer1mTokens: number;
  cacheHitRatio: number;
  cacheCreationRatio: number;
  normalizedUsage: {
    nonCachedPromptTokens: number;
    cachedPromptTokens: number;
    cacheCreationTokens: number;
    completionTokens: number;
  };
  totalCredits: number;
  creditToRmb: number;
}) {
  const regularPromptCredits = input.normalizedUsage.nonCachedPromptTokens * input.promptPricePer1mTokens / 1000000;
  const cachedPromptCredits = input.normalizedUsage.cachedPromptTokens * input.promptPricePer1mTokens * input.cacheHitRatio / 1000000;
  const cacheCreationCredits = input.normalizedUsage.cacheCreationTokens * input.promptPricePer1mTokens * input.cacheCreationRatio / 1000000;
  const completionCredits = input.normalizedUsage.completionTokens * input.completionPricePer1mTokens / 1000000;
  const totalCreditsBeforeCeil = regularPromptCredits + cachedPromptCredits + cacheCreationCredits + completionCredits;
  return {
    regularPromptCredits,
    cachedPromptCredits,
    cacheCreationCredits,
    completionCredits,
    totalCreditsBeforeCeil,
    totalCredits: input.totalCredits,
    rmbEquivalent: conversionService.creditsToRmb(input.totalCredits, input.creditToRmb),
  };
}

function isPositivePostgresInteger(value: unknown) {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= POSTGRES_INTEGER_MAX
  );
}

function isNonNegativePostgresInteger(value: unknown) {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= POSTGRES_INTEGER_MAX
  );
}

router.use(adminAuthMiddleware);

/**
 * GET /api/internal/billing/meta
 * 计费规则只读元信息
 */
router.get('/meta', async (_req, res) => {
  try {
    const exchange = conversionService.getExchangeConfig();
    const [openaiRatios, anthropicRatios, qwenRatios] = await Promise.all([
      pricingService.getCacheRatios('openai'),
      pricingService.getCacheRatios('anthropic'),
      pricingService.getCacheRatios('qwen'),
    ]);
    res.json({
      ...exchange,
      cacheRatios: {
        openai: openaiRatios,
        anthropic: anthropicRatios,
        qwen: qwenRatios,
      },
    });
  } catch (error) {
    console.error('[Billing Admin] 获取计费元信息失败:', error);
    res.status(500).json({ error: '获取计费元信息失败' });
  }
});

/**
 * GET /api/internal/billing/users
 * 用户积分列表（分页+搜索）
 */
router.get('/users', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const query = req.query.query as string | undefined;
    const sortBy = req.query.sortBy as string || 'balance';
    const sortOrder = req.query.sortOrder as string || 'desc';

    const offset = (page - 1) * limit;

    // 构建查询（LEFT JOIN 确保显示所有用户，包括 balance 为 0 或尚未创建积分记录的用户）
    let baseQuery = db
      .select({
        userId: appUsers.id,
        email: appUsers.email,
        displayName: appUsers.displayName,
        balance: sql<number>`COALESCE(${userCredits.balance}, 0)`,
        totalEarned: sql<number>`COALESCE(${userCredits.totalEarned}, 0)`,
        totalConsumed: sql<number>`COALESCE(${userCredits.totalConsumed}, 0)`,
        lastRechargeAt: userCredits.lastRechargeAt,
      })
      .from(appUsers)
      .leftJoin(userCredits, eq(appUsers.id, userCredits.userId));

    if (query) {
      baseQuery = baseQuery.where(
        sql`${appUsers.email} ILIKE ${`%${query}%`} OR ${appUsers.displayName} ILIKE ${`%${query}%`}`
      ) as any;
    }

    // 排序
    const orderColumn = {
      balance: userCredits.balance,
      totalConsumed: userCredits.totalConsumed,
      createdAt: userCredits.createdAt,
    }[sortBy] || userCredits.balance;

    const items = await baseQuery
      .orderBy(sortOrder === 'asc' ? sql`${orderColumn}` : desc(orderColumn))
      .limit(limit)
      .offset(offset);

    // 总数（基于 appUsers，确保统计全部用户）
    let countQuery = db
      .select({ count: count() })
      .from(appUsers)
      .leftJoin(userCredits, eq(appUsers.id, userCredits.userId));

    if (query) {
      countQuery = countQuery.where(
        sql`${appUsers.email} ILIKE ${`%${query}%`} OR ${appUsers.displayName} ILIKE ${`%${query}%`}`
      ) as any;
    }

    const countResult = await countQuery;

    res.json({
      items,
      total: Number(countResult[0].count),
      page,
      limit,
    });
  } catch (error) {
    console.error('[Billing Admin] 获取用户积分列表失败:', error);
    res.status(500).json({ error: '获取用户积分列表失败' });
  }
});

/**
 * GET /api/internal/billing/users/:userId/billing-detail
 * 用户详情页计费信息：余额、使用明细、获取历史
 */
router.get('/users/:userId/billing-detail', async (req, res) => {
  try {
    const { userId } = req.params;
    const [credits, usageRecords, acquisitionHistory] = await Promise.all([
      billingService.getUserCredits(userId),
      billingService.getSessionConsumptionRecords(userId, { page: 1, limit: 20 }),
      billingService.getCreditAcquisitionHistory(userId, { page: 1, limit: 20 }),
    ]);

    res.json({
      credits: credits
        ? {
            balance: credits.balance,
            totalEarned: credits.totalEarned,
            totalConsumed: credits.totalConsumed,
            lastRechargeAt: credits.lastRechargeAt,
          }
        : { balance: 0, totalEarned: 0, totalConsumed: 0, lastRechargeAt: null },
      usageRecords,
      acquisitionHistory,
    });
  } catch (error) {
    console.error('[Billing Admin] 获取用户计费详情失败:', error);
    res.status(500).json({ error: '获取用户计费详情失败' });
  }
});

/**
 * POST /api/internal/billing/users/:userId/adjust
 * 手动调整用户积分
 */
router.post('/users/:userId/adjust', async (req, res) => {
  try {
    const { userId } = req.params;
    const { amount, reason } = req.body;

    if (!isPositivePostgresInteger(amount)) {
      return res.status(400).json({ error: '调整金额必须是大于 0 的整数' });
    }

    const result = await billingService.addCredits(userId, amount, 'adjust', {
      description: reason || '人工调整',
      adminId: (req as any).adminUser?.id,
    });

    if (!result.success) {
      return res.status(500).json({ error: '调整积分失败' });
    }

    res.json({
      transactionId: result.transactionId,
      balanceAfter: result.balanceAfter,
      amount,
    });
  } catch (error) {
    console.error('[Billing Admin] 调整积分失败:', error);
    res.status(500).json({ error: '调整积分失败' });
  }
});

/**
 * GET /api/internal/billing/users/:userId/transactions
 * 获取指定用户的交易记录（管理后台用）
 */
router.get('/users/:userId/transactions', async (req, res) => {
  try {
    const { userId } = req.params;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));

    const result = await billingService.getTransactions(userId, { page, limit });

    res.json({
      items: result.items,
      total: result.total,
      page,
      limit,
    });
  } catch (error) {
    console.error('[Billing Admin] 获取用户交易记录失败:', error);
    res.status(500).json({ error: '获取用户交易记录失败' });
  }
});

/**
 * GET /api/internal/billing/cache-config
 * 缓存比例配置列表
 */
router.get('/cache-config', async (_req, res) => {
  try {
    const configs = await pricingService.listActiveCacheConfigs();
    res.json({ items: configs });
  } catch (error) {
    console.error('[Billing Admin] 获取缓存配置失败:', error);
    res.status(500).json({ error: '获取缓存配置失败' });
  }
});

/**
 * POST /api/internal/billing/cache-config
 * 新增/更新缓存比例配置
 */
router.post('/cache-config', async (req, res) => {
  try {
    const { provider, hitRatio, creationRatio } = req.body;

    if (!provider || typeof provider !== 'string') {
      return res.status(400).json({ error: '缺少 provider 参数' });
    }
    if (
      typeof hitRatio !== 'number' ||
      !Number.isInteger(hitRatio) ||
      hitRatio < 0 ||
      hitRatio > CACHE_HIT_RATIO_MAX
    ) {
      return res.status(400).json({ error: 'hitRatio 必须是 0 到 1000 之间的整数' });
    }
    if (
      typeof creationRatio !== 'number' ||
      !Number.isInteger(creationRatio) ||
      creationRatio < 0 ||
      creationRatio > CACHE_CREATION_RATIO_MAX
    ) {
      return res.status(400).json({ error: 'creationRatio 必须是 0 到 10000 之间的整数' });
    }

    const result = await pricingService.createCacheConfig({
      provider,
      hitRatio,
      creationRatio,
    });

    res.json(result);
  } catch (error) {
    console.error('[Billing Admin] 创建缓存配置失败:', error);
    res.status(500).json({ error: '创建缓存配置失败' });
  }
});

/**
 * POST /api/internal/billing/debug/llm-request
 * 管理端计费调试：发起真实上游请求，返回 usage 归一化与 dry-run 积分计算；不扣用户积分。
 */
router.post('/debug/llm-request', async (req, res) => {
  try {
    const {
      model,
      cacheMode = 'implicit',
      systemPrompt,
      userPrompt,
      maxTokens = 64,
      temperature = 0,
      mode = 'request_only',
    } = req.body || {};

    if (!model || typeof model !== 'string') {
      return res.status(400).json({ error: '缺少模型名称' });
    }
    if (!['none', 'implicit', 'explicit'].includes(String(cacheMode))) {
      return res.status(400).json({ error: 'cacheMode 必须是 none、implicit 或 explicit' });
    }
    if (!['request_only', 'dry_run'].includes(String(mode))) {
      return res.status(400).json({ error: 'mode 首版仅支持 request_only 或 dry_run' });
    }

    const safeSystemPrompt = String(systemPrompt || '').trim();
    const safeUserPrompt = String(userPrompt || '').trim();
    if (!safeSystemPrompt || !safeUserPrompt) {
      return res.status(400).json({ error: 'systemPrompt 和 userPrompt 不能为空' });
    }
    if (safeSystemPrompt.length + safeUserPrompt.length > BILLING_DEBUG_MAX_PROMPT_CHARS) {
      return res.status(400).json({ error: `调试 prompt 总长度不能超过 ${BILLING_DEBUG_MAX_PROMPT_CHARS} 字符` });
    }

    const parsedMaxTokens = Math.min(
      BILLING_DEBUG_MAX_TOKENS,
      Math.max(1, Math.floor(Number(maxTokens) || 64))
    );
    const parsedTemperature = Math.min(2, Math.max(0, Number(temperature) || 0));
    const messages = buildBillingDebugMessages({
      cacheMode: String(cacheMode),
      systemPrompt: safeSystemPrompt,
      userPrompt: safeUserPrompt,
    });
    const startedAt = Date.now();
    const localProxyUrl = `http://127.0.0.1:${process.env.PORT || '4000'}/api/llm-proxy/v1/chat/completions`;

    const upstreamResponse = await fetch(localProxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model.trim(),
        messages,
        max_tokens: parsedMaxTokens,
        temperature: parsedTemperature,
        stream: false,
      }),
    });
    const responseText = await upstreamResponse.text();
    let responseJson: any = null;
    try {
      responseJson = responseText ? JSON.parse(responseText) : null;
    } catch {
      responseJson = null;
    }

    const rawUsage = responseJson?.usage || null;
    const { normalizedUsage, warnings } = normalizeBillingDebugUsage(rawUsage);
    const exchange = conversionService.getExchangeConfig();
    const pricing = await pricingService.getActivePricing(model.trim());
    const provider = pricing
      ? pricingService.resolveCacheProvider(pricing)
      : pricingService.resolveCacheProvider({ model: model.trim(), modelProvider: 'openai' });
    const cacheRatios = pricing ? await pricingService.getCacheRatiosForPricing(pricing) : await pricingService.getCacheRatios(provider);

    let calculation: any = null;
    let pricingSnapshot: any = null;
    if (!pricing) {
      warnings.push(`模型 ${model.trim()} 没有生效定价，无法计算积分`);
    } else if (normalizedUsage.promptTokens <= 0) {
      warnings.push('缺少有效 usage，无法计算积分');
    } else if (normalizedUsage.cachedPromptTokens + normalizedUsage.cacheCreationTokens > normalizedUsage.promptTokens) {
      warnings.push('usage 字段不可信，已阻断积分计算');
    } else {
      const totalCredits = pricingService.calculateCredits(
        {
          promptTokens: normalizedUsage.promptTokens,
          cachedPromptTokens: normalizedUsage.cachedPromptTokens,
          nonCachedPromptTokens: normalizedUsage.nonCachedPromptTokens,
          cacheCreationTokens: normalizedUsage.cacheCreationTokens,
          completionTokens: normalizedUsage.completionTokens,
        },
        pricing,
        cacheRatios || undefined
      );
      pricingSnapshot = {
        model: pricing.model,
        modelProvider: provider,
        originalModelProvider: pricing.modelProvider,
        resolvedCacheProvider: provider,
        promptPricePer1mTokens: pricing.promptPricePer1mTokens,
        completionPricePer1mTokens: pricing.completionPricePer1mTokens,
        cacheHitRatio: cacheRatios?.hit || 0,
        cacheCreationRatio: cacheRatios?.creation || 0,
        creditToRmb: exchange.creditToRmb,
      };
      calculation = calculateBillingDebugBreakdown({
        promptPricePer1mTokens: pricing.promptPricePer1mTokens,
        completionPricePer1mTokens: pricing.completionPricePer1mTokens,
        cacheHitRatio: cacheRatios?.hit || 0,
        cacheCreationRatio: cacheRatios?.creation || 0,
        normalizedUsage,
        totalCredits,
        creditToRmb: exchange.creditToRmb,
      });
    }

    res.status(upstreamResponse.ok ? 200 : upstreamResponse.status).json({
      mode: mode as BillingDebugMode,
      dryRun: mode === 'dry_run',
      charged: false,
      upstream: {
        provider: 'dashscope-compatible',
        baseUrlName: 'dashscope-compatible',
        model: model.trim(),
        requestId: responseJson?.id || responseJson?.request_id || null,
        status: upstreamResponse.status,
        latencyMs: Date.now() - startedAt,
      },
      request: {
        cacheMode: String(cacheMode),
        stream: false,
        maxTokens: parsedMaxTokens,
        temperature: parsedTemperature,
        promptChars: safeSystemPrompt.length + safeUserPrompt.length,
      },
      rawUsage,
      normalizedUsage,
      pricing: pricingSnapshot,
      exchange,
      calculation,
      userVisiblePreview: calculation ? `本次消耗 ${calculation.totalCredits} 积分` : null,
      warnings,
      error: upstreamResponse.ok ? null : (responseJson?.error?.message || responseJson?.message || responseText.slice(0, 500)),
    });
  } catch (error) {
    console.error('[Billing Admin] 调试 LLM 请求失败:', error);
    res.status(500).json({ error: '调试 LLM 请求失败' });
  }
});

/**
 * GET /api/internal/billing/runtime-config
 * Agent/Sandbox 运行配置摘要（Token 不回显）
 */
router.get('/runtime-config', async (_req, res) => {
  try {
    res.json(billingRuntimeConfigService.listAllConfigs());
  } catch (error) {
    console.error('[Billing Admin] 获取运行配置失败:', error);
    res.status(500).json({ error: '获取运行配置失败' });
  }
});

router.put('/runtime-config/agent/:tier', async (req, res) => {
  try {
    const rawTier = String(req.params.tier || '').trim().toLowerCase();
    if (!['lite', 'pro', 'max'].includes(rawTier)) {
      return res.status(400).json({ error: 'Agent 档位不合法' });
    }
    const data = await billingRuntimeConfigService.updateAgentConfig(normalizeAgentModelTier(rawTier) as AgentModelTier, req.body || {});
    return res.json({ data });
  } catch (error: any) {
    console.error('[Billing Admin] 保存 Agent 运行配置失败:', error);
    return res.status(400).json({ error: error?.message || '保存 Agent 运行配置失败' });
  }
});

router.put('/runtime-config/sandbox/:engine', async (req, res) => {
  try {
    const engine = normalizeSandboxEngine(req.params.engine);
    if (!engine) {
      return res.status(400).json({ error: 'Sandbox 引擎不合法' });
    }
    const data = await billingRuntimeConfigService.updateSandboxConfig(engine, req.body || {});
    return res.json({ data });
  } catch (error: any) {
    console.error('[Billing Admin] 保存 Sandbox 运行配置失败:', error);
    return res.status(400).json({ error: error?.message || '保存 Sandbox 运行配置失败' });
  }
});

router.post('/runtime-config/test', async (req, res) => {
  try {
    const allowedKeys = new Set(['key']);
    const bodyKeys = Object.keys(req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});
    const extraKeys = bodyKeys.filter((key) => !allowedKeys.has(key));
    if (extraKeys.length > 0) {
      return res.status(400).json({ error: '测试接口仅允许提交 key' });
    }
    const key = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
    if (!key) {
      return res.status(400).json({ error: '缺少运行配置 key' });
    }
    const data = await billingRuntimeConfigService.testRuntimeConfig(key);
    return res.json({ success: true, data });
  } catch (error: any) {
    console.error('[Billing Admin] 测试运行配置失败:', error);
    return res.status(500).json({ error: error?.message || '测试运行配置失败' });
  }
});

router.post('/runtime-config/models', async (req, res) => {
  try {
    const allowedKeys = new Set(['key', 'modelsUrl']);
    const bodyKeys = Object.keys(req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});
    const extraKeys = bodyKeys.filter((key) => !allowedKeys.has(key));
    if (extraKeys.length > 0) {
      return res.status(400).json({ error: '获取模型列表接口仅允许提交 key 和 modelsUrl' });
    }
    const key = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
    if (!key) {
      return res.status(400).json({ error: '缺少运行配置 key' });
    }
    const customModelsUrl = typeof req.body?.modelsUrl === 'string' ? req.body.modelsUrl.trim() : undefined;
    const data = await billingRuntimeConfigService.fetchAvailableModels(key, customModelsUrl);
    return res.json({ success: true, data });
  } catch (error: any) {
    console.error('[Billing Admin] 获取可用模型列表失败:', error);
    return res.status(500).json({ error: error?.message || '获取可用模型列表失败' });
  }
});

/**
 * GET /api/internal/billing/pricing
 * 模型定价列表
 */
router.get('/pricing', async (req, res) => {
  try {
    const pricingList = await pricingService.listActivePricing();
    const runtimeTargets = billingRuntimeConfigService.listBillingTargets();
    const runtimeTargetKeys = new Set(runtimeTargets.map((item) => item.key));

    const pricingWithCache = await Promise.all(
      pricingList
        .filter((p) => runtimeTargetKeys.has(p.model))
        .map(async (p) => {
        const ratios = await pricingService.getCacheRatiosForPricing(p);
        const runtime = runtimeTargets.find((item) => item.key === p.model);
        return {
          ...p,
          displayName: runtime?.displayName || p.model,
          billingTargetKey: p.model,
          actualModel: runtime?.model || null,
          baseUrlHost: runtime?.baseUrlHost || null,
          apiType: runtime?.apiType || null,
          tokenState: runtime?.tokenState || 'missing',
          runtimeConfigAnchor: runtime?.runtimeConfigAnchor || null,
          cacheHitRatio: ratios?.hit || 0,
          cacheCreationRatio: ratios?.creation || 0,
          multiplier: p.multiplier !== undefined ? Number(parseFloat(String(p.multiplier)).toFixed(4)) : 1.0,
        };
      })
    );

    const configuredKeys = new Set(pricingWithCache.map((item) => item.model));
    for (const runtime of runtimeTargets) {
      if (configuredKeys.has(runtime.key)) continue;
      pricingWithCache.push({
        id: `missing:${runtime.key}`,
        model: runtime.key,
        modelProvider: runtime.kind,
        promptPricePer1mTokens: 0,
        completionPricePer1mTokens: 0,
        multiplier: 1.0,
        isActive: false,
        effectiveFrom: null,
        effectiveUntil: null,
        createdAt: null,
        updatedAt: null,
        displayName: runtime.displayName,
        billingTargetKey: runtime.key,
        actualModel: runtime.model,
        baseUrlHost: runtime.baseUrlHost,
        apiType: runtime.apiType,
        tokenState: runtime.tokenState,
        runtimeConfigAnchor: runtime.runtimeConfigAnchor,
        cacheHitRatio: 0,
        cacheCreationRatio: 0,
      } as any);
    }

    res.json({ items: pricingWithCache });
  } catch (error) {
    console.error('[Billing Admin] 获取定价列表失败:', error);
    res.status(500).json({ error: '获取定价列表失败' });
  }
});

/**
 * GET /api/internal/billing/pricing/model-candidates
 * 从当前定价与实际使用日志中读取模型候选，辅助管理员新建定价
 */
router.get('/pricing/model-candidates', async (_req, res) => {
  try {
    const result = await db.execute(sql`
      WITH candidates AS (
        SELECT model, model_provider AS provider, MAX(created_at) AS last_seen_at, BOOL_OR(is_active) AS has_active_pricing
        FROM model_pricing
        GROUP BY model, model_provider
        UNION ALL
        SELECT model, NULL::text AS provider, MAX(created_at) AS last_seen_at, false AS has_active_pricing
        FROM token_usage_logs
        WHERE model NOT LIKE 'agent.%' AND model NOT LIKE 'sandbox.%'
        GROUP BY model
      )
      SELECT
        model,
        CASE
          WHEN LOWER(model) LIKE 'qwen%' OR LOWER(model) LIKE '%/qwen%' THEN 'qwen'
          WHEN LOWER(model) LIKE 'claude%' OR LOWER(model) LIKE '%anthropic%' THEN 'anthropic'
          WHEN LOWER(model) LIKE 'deepseek%' THEN 'deepseek'
          ELSE COALESCE(MAX(provider), 'openai')
        END AS provider,
        MAX(last_seen_at) AS last_seen_at,
        BOOL_OR(has_active_pricing) AS has_active_pricing
      FROM candidates
      WHERE model IS NOT NULL AND model <> ''
        AND model NOT LIKE 'agent.%'
        AND model NOT LIKE 'sandbox.%'
      GROUP BY model
      ORDER BY has_active_pricing ASC, last_seen_at DESC NULLS LAST, model ASC
      LIMIT 100
    `);
    const rows = Array.isArray((result as any)?.rows) ? (result as any).rows : [];
    res.json({
      items: rows.map((row: any) => ({
        model: String(row.model),
        provider: String(row.provider || 'openai'),
        lastSeenAt: row.last_seen_at instanceof Date ? row.last_seen_at.toISOString() : row.last_seen_at || null,
        hasActivePricing: Boolean(row.has_active_pricing),
      })),
    });
  } catch (error) {
    console.error('[Billing Admin] 获取模型候选失败:', error);
    res.status(500).json({ error: '获取模型候选失败' });
  }
});

/**
 * POST /api/internal/billing/pricing
 * 新增/更新模型定价
 */
router.post('/pricing', async (req, res) => {
  try {
    const {
      model,
      modelProvider,
      promptPricePer1mTokens,
      completionPricePer1mTokens,
      multiplier,
      effectiveFrom,
      cacheHitRatio,
      cacheCreationRatio,
    } = req.body;

    if (!model || !modelProvider) {
      return res.status(400).json({ error: '缺少必要参数' });
    }
    const allowedBillingTargets = new Map(
      billingRuntimeConfigService.listBillingTargets().map((item) => [item.key, item.kind])
    );
    if (!allowedBillingTargets.has(String(model))) {
      return res.status(400).json({ error: '定价配置仅允许 Agent 档位与 Sandbox 引擎业务对象' });
    }
    if (String(modelProvider) !== allowedBillingTargets.get(String(model))) {
      return res.status(400).json({ error: '计费对象与 provider 不匹配' });
    }
    if (
      !isPositivePostgresInteger(promptPricePer1mTokens) ||
      !isPositivePostgresInteger(completionPricePer1mTokens)
    ) {
      return res.status(400).json({ error: '模型定价必须是大于 0 的整数' });
    }
    const parsedEffectiveFrom = effectiveFrom ? new Date(effectiveFrom) : undefined;
    if (effectiveFrom && (!parsedEffectiveFrom || Number.isNaN(parsedEffectiveFrom.getTime()))) {
      return res.status(400).json({ error: '生效时间格式不正确' });
    }
    const shouldUpdateCacheRatio = cacheHitRatio !== undefined || cacheCreationRatio !== undefined;
    if (shouldUpdateCacheRatio) {
      if (!isNonNegativePostgresInteger(cacheHitRatio) || !isNonNegativePostgresInteger(cacheCreationRatio)) {
        return res.status(400).json({ error: '缓存计费比例必须是非负整数' });
      }
      if (cacheHitRatio > CACHE_HIT_RATIO_MAX || cacheCreationRatio > CACHE_CREATION_RATIO_MAX) {
        return res.status(400).json({ error: '缓存计费比例超出允许范围' });
      }
    }

    const result = await pricingService.createPricing({
      model,
      modelProvider,
      promptPricePer1mTokens,
      completionPricePer1mTokens,
      multiplier: multiplier !== undefined ? Number(parseFloat(String(multiplier)).toFixed(4)) : undefined,
      effectiveFrom: parsedEffectiveFrom,
    });

    if (shouldUpdateCacheRatio) {
      await pricingService.createCacheConfig({
        provider: pricingService.resolveCacheProvider({ model, modelProvider }),
        hitRatio: cacheHitRatio,
        creationRatio: cacheCreationRatio,
      });
    }

    res.json(result);
  } catch (error) {
    console.error('[Billing Admin] 创建定价失败:', error);
    res.status(500).json({ error: '创建定价失败' });
  }
});

/**
 * DELETE /api/internal/billing/pricing/:id
 * 停用定价
 */
router.delete('/pricing/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pricingService.deactivatePricing(id);
    res.json({ success: true });
  } catch (error) {
    console.error('[Billing Admin] 停用定价失败:', error);
    res.status(500).json({ error: '停用定价失败' });
  }
});

/**
 * GET /api/internal/billing/stats
 * 平台统计看板
 */
router.get('/stats', async (req, res) => {
  try {
    const period = req.query.period as string || 'today';
    
    // 计算时间范围
    const now = new Date();
    let startDate: Date;
    
    switch (period) {
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case 'today':
      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
    }

    // 统计积分消耗
    const creditsResult = await db
      .select({
        totalCredits: sql`COALESCE(SUM(${creditTransactions.amount}), 0)`,
        totalCount: count(),
      })
      .from(creditTransactions)
      .where(and(
        eq(creditTransactions.type, 'consume'),
        gte(creditTransactions.createdAt, startDate)
      ));

    // 统计 Token 使用
    const tokensResult = await db
      .select({
        totalTokens: sql`COALESCE(SUM(${tokenUsageLogs.totalTokens}), 0)`,
        totalCredits: sql`COALESCE(SUM(${tokenUsageLogs.creditsConsumed}), 0)`,
        cachedTokens: sql`COALESCE(SUM(${tokenUsageLogs.cachedPromptTokens}), 0)`,
        cacheCreationTokens: sql`COALESCE(SUM(${tokenUsageLogs.cacheCreationTokens}), 0)`,
      })
      .from(tokenUsageLogs)
      .where(gte(tokenUsageLogs.createdAt, startDate));

    // Top 10 消费用户
    const topUsers = await db
      .select({
        userId: creditTransactions.userId,
        email: appUsers.email,
        displayName: appUsers.displayName,
        totalConsumed: sql`SUM(ABS(${creditTransactions.amount}))`,
      })
      .from(creditTransactions)
      .leftJoin(appUsers, eq(appUsers.id, creditTransactions.userId))
      .where(and(
        eq(creditTransactions.type, 'consume'),
        gte(creditTransactions.createdAt, startDate)
      ))
      .groupBy(creditTransactions.userId, appUsers.email, appUsers.displayName)
      .orderBy(desc(sql`SUM(ABS(${creditTransactions.amount}))`))
      .limit(10);

    // Top 10 使用模型
    const topModels = await db
      .select({
        model: tokenUsageLogs.model,
        creditsConsumed: sql`SUM(${tokenUsageLogs.creditsConsumed})`,
        tokensUsed: sql`SUM(${tokenUsageLogs.totalTokens})`,
        cachedTokens: sql`SUM(${tokenUsageLogs.cachedPromptTokens})`,
      })
      .from(tokenUsageLogs)
      .where(gte(tokenUsageLogs.createdAt, startDate))
      .groupBy(tokenUsageLogs.model)
      .orderBy(desc(sql`SUM(${tokenUsageLogs.creditsConsumed})`))
      .limit(10);

    // 积分余额分布
    const balanceDistribution = await db
      .select({
        range: sql`CASE
          WHEN ${userCredits.balance} = 0 THEN '0'
          WHEN ${userCredits.balance} BETWEEN 1 AND 100 THEN '1-100'
          WHEN ${userCredits.balance} BETWEEN 101 AND 1000 THEN '100-1000'
          ELSE '1000+'
        END`,
        count: count(),
      })
      .from(userCredits)
      .groupBy(sql`CASE
        WHEN ${userCredits.balance} = 0 THEN '0'
        WHEN ${userCredits.balance} BETWEEN 1 AND 100 THEN '1-100'
        WHEN ${userCredits.balance} BETWEEN 101 AND 1000 THEN '100-1000'
        ELSE '1000+'
      END`);

    const totalTokens = Number(tokensResult[0]?.totalTokens || 0);
    const cachedTokens = Number(tokensResult[0]?.cachedTokens || 0);

    // 积分消费/充值趋势
    const dateFormat = period === 'today' ? 'HH24:00' : 'YYYY-MM-DD';
    const trendResult = await db.execute(sql`
      SELECT
        TO_CHAR(created_at, ${dateFormat}) as label,
        SUM(CASE WHEN type = 'consume' THEN ABS(amount) ELSE 0 END)::int as consumed,
        SUM(CASE WHEN type IN ('recharge', 'adjust') THEN amount ELSE 0 END)::int as recharged
      FROM credit_transactions
      WHERE created_at >= ${startDate}
      GROUP BY 1
      ORDER BY 1
    `);

    const trendRows = Array.isArray((trendResult as any)?.rows) ? (trendResult as any).rows : [];
    const trend = trendRows.map((row: any) => ({
      label: String(row.label),
      consumed: Number(row.consumed || 0),
      recharged: Number(row.recharged || 0),
    }));
    
    res.json({
      period,
      totalCreditsConsumed: Math.abs(Number(creditsResult[0]?.totalCredits || 0)),
      totalTokensUsed: totalTokens,
      totalSessions: Number(creditsResult[0]?.totalCount || 0),
      cacheStats: {
        totalCacheHitTokens: cachedTokens,
        totalCacheCreationTokens: Number(tokensResult[0]?.cacheCreationTokens || 0),
        totalCacheSavings: cachedTokens * 0.5, // 简化估算：假设平均节省50%
        cacheHitRate: totalTokens > 0 
          ? `${((cachedTokens / totalTokens) * 100).toFixed(1)}%`
          : '0%',
      },
      topUsers,
      topModels,
      balanceDistribution,
      trend,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Billing Admin] 获取平台统计失败:', error);
    res.status(500).json({ error: '获取平台统计失败' });
  }
});

/**
 * GET /api/internal/billing/usage-logs
 * Token 使用明细
 */
router.get('/usage-logs', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const userId = req.query.userId as string | undefined;
    const model = req.query.model as string | undefined;
    const sessionId = req.query.sessionId as string | undefined;
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;

    const offset = (page - 1) * limit;

    let conditions = [];
    
    if (userId) conditions.push(eq(tokenUsageLogs.userId, userId as any));
    if (model) conditions.push(eq(tokenUsageLogs.model, model));
    if (sessionId) conditions.push(eq(tokenUsageLogs.sessionId, sessionId as any));
    if (startDate) conditions.push(gte(tokenUsageLogs.createdAt, new Date(startDate)));
    if (endDate) conditions.push(lte(tokenUsageLogs.createdAt, new Date(endDate)));

    let query = db.select().from(tokenUsageLogs);
    
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }

    const items = await query
      .orderBy(desc(tokenUsageLogs.createdAt))
      .limit(limit)
      .offset(offset);

    // 总数
    let countQuery = db.select({ count: count() }).from(tokenUsageLogs);
    if (conditions.length > 0) {
      countQuery = countQuery.where(and(...conditions)) as any;
    }
    const totalResult = await countQuery;

    res.json({
      items,
      total: Number(totalResult[0].count),
      page,
      limit,
    });
  } catch (error) {
    console.error('[Billing Admin] 获取使用明细失败:', error);
    res.status(500).json({ error: '获取使用明细失败' });
  }
});

// ==================== 激活码管理 ====================

const activationCodeService = new ActivationCodeService();

/**
 * POST /api/internal/billing/activation-codes
 * 创建激活码
 */
router.post('/activation-codes', async (req, res) => {
  try {
    const { creditsAmount, quantity, maxUses, expiresInDays, description, prefix, groupId } = req.body;

    if (!creditsAmount || creditsAmount <= 0) {
      return res.status(400).json({ error: '积分数量必须大于 0' });
    }

    const adminUserId = (req as any).adminUserId;

    const result = await activationCodeService.createActivationCodes({
      creditsAmount,
      quantity,
      maxUses,
      expiresInDays,
      description,
      prefix,
      groupId,
      adminUserId,
    });

    res.json(result);
  } catch (error: any) {
    console.error('[Billing Admin] 创建激活码失败:', error);
    res.status(400).json({ error: error.message || '创建激活码失败' });
  }
});

/**
 * GET /api/internal/billing/activation-codes
 * 获取激活码列表
 */
router.get('/activation-codes', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const status = req.query.status as string | undefined;
    const batchId = req.query.batchId as string | undefined;
    const groupId = req.query.groupId as string | undefined;
    const search = req.query.search as string | undefined;
    const sortBy = req.query.sortBy as string | undefined;
    const sortOrder = req.query.sortOrder as 'asc' | 'desc' | undefined;

    const result = await activationCodeService.listActivationCodes({
      page,
      limit,
      status,
      batchId,
      groupId,
      search,
      sortBy,
      sortOrder,
    });

    res.json(result);
  } catch (error) {
    console.error('[Billing Admin] 获取激活码列表失败:', error);
    res.status(500).json({ error: '获取激活码列表失败' });
  }
});

/**
 * GET /api/internal/billing/activation-codes/stats
 * 获取激活码统计
 */
router.get('/activation-codes/stats', async (req, res) => {
  try {
    const stats = await activationCodeService.getActivationCodeStats();
    res.json(stats);
  } catch (error) {
    console.error('[Billing Admin] 获取激活码统计失败:', error);
    res.status(500).json({ error: '获取激活码统计失败' });
  }
});

/**
 * GET /api/internal/billing/activation-codes/export
 * 导出激活码
 */
router.get('/activation-codes/export', async (req, res) => {
  try {
    const status = req.query.status as string | undefined;
    const batchId = req.query.batchId as string | undefined;
    const groupId = req.query.groupId as string | undefined;
    const search = req.query.search as string | undefined;

    const items = await activationCodeService.exportActivationCodes({ status, batchId, groupId, search });

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=activation-codes.json');
    res.json(items);
  } catch (error) {
    console.error('[Billing Admin] 导出激活码失败:', error);
    res.status(500).json({ error: '导出激活码失败' });
  }
});

/**
 * GET /api/internal/billing/activation-codes/:id
 * 获取激活码详情
 */
router.get('/activation-codes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const detail = await activationCodeService.getActivationCodeDetail(id);

    if (!detail) {
      return res.status(404).json({ error: '激活码不存在' });
    }

    res.json(detail);
  } catch (error) {
    console.error('[Billing Admin] 获取激活码详情失败:', error);
    res.status(500).json({ error: '获取激活码详情失败' });
  }
});

/**
 * PUT /api/internal/billing/activation-codes/:id
 * 更新激活码状态（启用/禁用）
 */
router.put('/activation-codes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (status !== 'active' && status !== 'disabled') {
      return res.status(400).json({ error: '状态只能是 active 或 disabled' });
    }

    const result = await activationCodeService.updateActivationCodeStatus(id, status);

    if (!result) {
      return res.status(404).json({ error: '激活码不存在或状态不允许修改' });
    }

    res.json(result);
  } catch (error) {
    console.error('[Billing Admin] 更新激活码状态失败:', error);
    res.status(500).json({ error: '更新激活码状态失败' });
  }
});

/**
 * DELETE /api/internal/billing/activation-codes/:id
 * 删除激活码
 */
router.delete('/activation-codes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const success = await activationCodeService.deleteActivationCode(id);

    if (!success) {
      return res.status(404).json({ error: '激活码不存在或已被使用，无法删除' });
    }

    res.json({ success: true, message: '激活码已删除' });
  } catch (error) {
    console.error('[Billing Admin] 删除激活码失败:', error);
    res.status(500).json({ error: '删除激活码失败' });
  }
});

/**
 * POST /api/internal/billing/activation-codes/bulk-status
 * 批量更新激活码状态（启用/禁用）
 */
router.post('/activation-codes/bulk-status', async (req, res) => {
  try {
    const { ids, status } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: '请选择至少一个激活码' });
    }
    if (!ids.every((id) => isUuidLike(id))) {
      return res.status(400).json({ error: '激活码ID格式无效' });
    }
    if (status !== 'active' && status !== 'disabled') {
      return res.status(400).json({ error: '状态仅支持 active 或 disabled' });
    }

    const result = await activationCodeService.bulkUpdateActivationCodeStatus(ids, status);
    return res.json({
      success: true,
      matched: result.matched,
      updated: result.updated,
      skippedAlreadyTarget: result.skippedAlreadyTarget,
      skippedUsed: result.skippedUsed,
      skippedExpired: result.skippedExpired,
      skippedOtherStatus: result.skippedOtherStatus,
      missing: result.missing,
    });
  } catch (error) {
    console.error('[Billing Admin] 批量更新激活码状态失败:', error);
    return res.status(500).json({ error: '批量更新激活码状态失败' });
  }
});

/**
 * POST /api/internal/billing/activation-codes/bulk-delete
 * 批量删除激活码（仅删除未使用激活码）
 */
router.post('/activation-codes/bulk-delete', async (req, res) => {
  try {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: '请选择至少一个激活码' });
    }
    if (!ids.every((id) => isUuidLike(id))) {
      return res.status(400).json({ error: '激活码ID格式无效' });
    }

    const result = await activationCodeService.bulkDeleteActivationCodes(ids);
    return res.json({
      success: true,
      matched: result.matched,
      deleted: result.deleted,
      skippedUsed: result.skippedUsed,
      missing: result.missing,
    });
  } catch (error) {
    console.error('[Billing Admin] 批量删除激活码失败:', error);
    return res.status(500).json({ error: '批量删除激活码失败' });
  }
});

// ==================== 激活码分组管理 ====================

/**
 * GET /api/internal/billing/activation-code-groups
 * 获取分组列表
 */
router.get('/activation-code-groups', async (req, res) => {
  try {
    const groups = await activationCodeService.listGroups();
    res.json(groups);
  } catch (error) {
    console.error('[Billing Admin] 获取分组列表失败:', error);
    res.status(500).json({ error: '获取分组列表失败' });
  }
});

/**
 * POST /api/internal/billing/activation-code-groups
 * 创建分组
 */
router.post('/activation-code-groups', async (req, res) => {
  try {
    const { name, description } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: '分组名称不能为空' });
    }

    const adminUserId = (req as any).adminUserId;

    const group = await activationCodeService.createGroup({
      name,
      description,
      adminUserId,
    });

    res.json(group);
  } catch (error: any) {
    console.error('[Billing Admin] 创建分组失败:', error);
    res.status(400).json({ error: error.message || '创建分组失败' });
  }
});

/**
 * PUT /api/internal/billing/activation-code-groups/:id
 * 更新分组
 */
router.put('/activation-code-groups/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, status } = req.body;

    const group = await activationCodeService.updateGroup(id, { name, description, status });

    if (!group) {
      return res.status(404).json({ error: '分组不存在' });
    }

    res.json(group);
  } catch (error: any) {
    console.error('[Billing Admin] 更新分组失败:', error);
    res.status(400).json({ error: error.message || '更新分组失败' });
  }
});

/**
 * DELETE /api/internal/billing/activation-code-groups/:id
 * 删除分组
 */
router.delete('/activation-code-groups/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const success = await activationCodeService.deleteGroup(id);

    if (!success) {
      return res.status(404).json({ error: '分组不存在' });
    }

    res.json({ success: true, message: '分组已删除' });
  } catch (error: any) {
    console.error('[Billing Admin] 删除分组失败:', error);
    res.status(400).json({ error: error.message || '删除分组失败' });
  }
});

export default router;
