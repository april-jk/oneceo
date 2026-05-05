import express from 'express';
import { adminAppUserService } from '../services/admin-app-user-service';
import { getPublicErrorMessage } from '../utils/error-response';
import { createRequireInternalToken } from './internal-auth-middleware';
import { billingService } from '../services/billing-service';
import { sessionApiTraceDAO } from '../db/dao/session-api-trace.dao';
import { taskCreationSessionDAO } from '../db/dao/task-creation-session.dao';
import { db } from '../config/database';
import { taskCreationSessions, sessionApiTraces } from '../db/schema';
import { desc, sql, eq, and, count, inArray } from 'drizzle-orm';

const router = express.Router();

router.use(createRequireInternalToken({
  disabledMessage: '用户管理内部接口未启用',
}));

function pickQueryValue(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}

router.get('/admin/app-users', async (req, res) => {
  try {
    const parsedLimit = Number.parseInt(String(req.query.limit || '120'), 10);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 200) : 120;
    const data = await adminAppUserService.listUsers({
      limit,
      query: pickQueryValue(req.query.query),
      status: pickQueryValue(req.query.status),
      activity: pickQueryValue(req.query.activity) as any,
      hasSession: pickQueryValue(req.query.hasSession) as any,
      hasConversation: pickQueryValue(req.query.hasConversation) as any,
      hasSandbox: pickQueryValue(req.query.hasSandbox) as any,
      ownershipHealth: pickQueryValue(req.query.ownershipHealth) as any,
      sortKey: pickQueryValue(req.query.sortKey),
      sortDirection: pickQueryValue(req.query.sortDirection),
    });
    return res.json({
      success: true,
      data,
    });
  } catch (error: any) {
    console.error('内部获取 app 用户列表失败:', error);
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '获取 app 用户列表失败'),
    });
  }
});

router.get('/admin/app-users/:userId', async (req, res) => {
  try {
    const data = await adminAppUserService.getUserDetail(req.params.userId);
    return res.json({
      success: true,
      data,
    });
  } catch (error: any) {
    const isNotFound = error?.message === '用户不存在';
    return res.status(isNotFound ? 404 : 400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '获取 app 用户详情失败'),
    });
  }
});

router.post('/admin/app-users/:userId/status', async (req, res) => {
  try {
    const status = typeof req.body?.status === 'string' ? req.body.status.trim() : '';
    if (status !== 'active' && status !== 'disabled') {
      return res.status(400).json({
        success: false,
        error: getPublicErrorMessage('状态仅支持 active 或 disabled'),
      });
    }

    const data = await adminAppUserService.updateUserStatus(req.params.userId, status);
    return res.json({
      success: true,
      data,
    });
  } catch (error: any) {
    const isNotFound = error?.message === '用户不存在';
    return res.status(isNotFound ? 404 : 400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '更新 app 用户状态失败'),
    });
  }
});

/**
 * GET /api/internal/admin/app-users/:userId/sessions
 * 用户会话列表（审计用）
 */
router.get('/admin/app-users/:userId/sessions', async (req, res) => {
  try {
    const userId = String(req.params.userId || '').trim();
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;

    const sessions = await db
      .select({
        id: taskCreationSessions.id,
        status: taskCreationSessions.status,
        metadataJson: taskCreationSessions.metadataJson,
        createdAt: taskCreationSessions.createdAt,
        updatedAt: taskCreationSessions.updatedAt,
        completedAt: taskCreationSessions.completedAt,
      })
      .from(taskCreationSessions)
      .where(sql`btrim(coalesce(${taskCreationSessions.userId}, '')) = ${userId}`)
      .orderBy(desc(taskCreationSessions.updatedAt), desc(taskCreationSessions.createdAt))
      .limit(limit)
      .offset(offset);

    const countResult = await db
      .select({ count: count() })
      .from(taskCreationSessions)
      .where(sql`btrim(coalesce(${taskCreationSessions.userId}, '')) = ${userId}`);

    // 补充每个会话的 trace 统计
    const sessionsWithStats = await Promise.all(
      sessions.map(async (session) => {
        const metadata = session.metadataJson as Record<string, unknown> || {};
        const title = String(metadata?.title || metadata?.sessionTitle || '未命名会话');

        const traceStats = await db.execute(sql`
          SELECT
            COUNT(*)::int AS total,
            COUNT(CASE WHEN trace_type = 'tool_call' THEN 1 END)::int AS tool_calls,
            COUNT(CASE WHEN trace_type = 'llm_request' THEN 1 END)::int AS llm_requests,
            COUNT(CASE WHEN error_message IS NOT NULL THEN 1 END)::int AS errors
          FROM session_api_traces
          WHERE session_id = ${session.id}::uuid
        `);
        const stats = (traceStats as any)?.rows?.[0] || {};

        return {
          id: session.id,
          title,
          status: session.status,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          completedAt: session.completedAt,
          traceSummary: {
            totalTraces: Number(stats.total || 0),
            toolCalls: Number(stats.tool_calls || 0),
            llmRequests: Number(stats.llm_requests || 0),
            errors: Number(stats.errors || 0),
          },
        };
      })
    );

    return res.json({
      success: true,
      data: {
        items: sessionsWithStats,
        total: Number(countResult[0].count),
        page,
        limit,
      },
    });
  } catch (error: any) {
    console.error('[admin-app-user-routes] 获取用户会话列表失败:', error);
    return res.status(500).json({
      success: false,
      error: getPublicErrorMessage('获取用户会话列表失败'),
    });
  }
});

/**
 * GET /api/internal/admin/app-users/:userId/sessions/:sessionId/messages
 * 会话消息详情（审计用）
 */
router.get('/admin/app-users/:userId/sessions/:sessionId/messages', async (req, res) => {
  try {
    const sessionId = String(req.params.sessionId || '').trim();

    // 获取会话基本信息
    const session = await taskCreationSessionDAO.getSession(sessionId);
    if (!session) {
      return res.status(404).json({ success: false, error: '会话不存在' });
    }

    // 获取会话消息
    const messages = await taskCreationSessionDAO.getMessages(sessionId);

    return res.json({
      success: true,
      data: {
        session: {
          id: session.id,
          status: session.status,
          metadataJson: session.metadataJson,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
        },
        messages: messages.map((msg: any) => ({
          id: msg.id,
          role: msg.role,
          content: msg.content,
          messageType: msg.messageType,
          timelineCursor: msg.timelineCursor,
          createdAt: msg.createdAt,
          metadata: msg.metadata,
        })),
      },
    });
  } catch (error: any) {
    console.error('[admin-app-user-routes] 获取会话消息失败:', error);
    return res.status(500).json({
      success: false,
      error: getPublicErrorMessage('获取会话消息失败'),
    });
  }
});

/**
 * GET /api/internal/admin/app-users/:userId/tool-calls
 * 用户工具调用列表（审计用）
 */
router.get('/admin/app-users/:userId/tool-calls', async (req, res) => {
  try {
    const userId = String(req.params.userId || '').trim();
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));

    // 先获取用户的所有 session ID
    const sessionRows = await db
      .select({ id: taskCreationSessions.id })
      .from(taskCreationSessions)
      .where(sql`btrim(coalesce(${taskCreationSessions.userId}, '')) = ${userId}`)
      .orderBy(desc(taskCreationSessions.updatedAt));

    const sessionIds = sessionRows.map((row) => String(row.id));

    if (sessionIds.length === 0) {
      return res.json({
        success: true,
        data: { items: [], total: 0, page, limit },
      });
    }

    // 查询这些 session 的工具调用
    const traces = await db
      .select({
        id: sessionApiTraces.id,
        sessionId: sessionApiTraces.sessionId,
        runId: sessionApiTraces.runId,
        traceType: sessionApiTraces.traceType,
        sequence: sessionApiTraces.sequence,
        model: sessionApiTraces.model,
        provider: sessionApiTraces.provider,
        toolName: sessionApiTraces.toolName,
        serviceName: sessionApiTraces.serviceName,
        endpoint: sessionApiTraces.endpoint,
        requestMethod: sessionApiTraces.requestMethod,
        responseStatus: sessionApiTraces.responseStatus,
        durationMs: sessionApiTraces.durationMs,
        promptTokens: sessionApiTraces.promptTokens,
        completionTokens: sessionApiTraces.completionTokens,
        totalTokens: sessionApiTraces.totalTokens,
        errorMessage: sessionApiTraces.errorMessage,
        metadataJson: sessionApiTraces.metadataJson,
        createdAt: sessionApiTraces.createdAt,
      })
      .from(sessionApiTraces)
      .where(
        and(
          inArray(sessionApiTraces.sessionId, sessionIds),
          eq(sessionApiTraces.traceType, 'tool_call')
        )
      )
      .orderBy(desc(sessionApiTraces.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);

    const countResult = await db
      .select({ count: count() })
      .from(sessionApiTraces)
      .where(
        and(
          inArray(sessionApiTraces.sessionId, sessionIds),
          eq(sessionApiTraces.traceType, 'tool_call')
        )
      );

    return res.json({
      success: true,
      data: {
        items: traces.map((row) => ({
          id: String(row.id),
          sessionId: String(row.sessionId),
          runId: row.runId ? String(row.runId) : null,
          traceType: String(row.traceType),
          sequence: Number(row.sequence || 0),
          model: row.model || null,
          provider: row.provider || null,
          toolName: row.toolName || null,
          serviceName: row.serviceName || null,
          endpoint: row.endpoint || null,
          requestMethod: row.requestMethod || null,
          responseStatus: row.responseStatus ? Number(row.responseStatus) : null,
          durationMs: row.durationMs ? Number(row.durationMs) : null,
          promptTokens: Number(row.promptTokens || 0),
          completionTokens: Number(row.completionTokens || 0),
          totalTokens: Number(row.totalTokens || 0),
          errorMessage: row.errorMessage || null,
          metadataJson: row.metadataJson || {},
          createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
        })),
        total: Number(countResult[0]?.count || 0),
        page,
        limit,
      },
    });
  } catch (error: any) {
    console.error('[admin-app-user-routes] 获取用户工具调用失败:', error);
    return res.status(500).json({
      success: false,
      error: getPublicErrorMessage('获取用户工具调用失败'),
    });
  }
});

/**
 * GET /api/internal/admin/app-users/:userId/transactions
 * 用户交易记录（审计用）
 */
router.get('/admin/app-users/:userId/transactions', async (req, res) => {
  try {
    const userId = String(req.params.userId || '').trim();
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const type = typeof req.query.type === 'string' ? req.query.type : undefined;

    const result = await billingService.getTransactions(userId, { page, limit, type });

    return res.json({
      success: true,
      data: {
        items: result.items.map((item: any) => ({
          id: item.id,
          userId: item.userId,
          type: item.type,
          amount: item.amount,
          balanceBefore: item.balanceBefore,
          balanceAfter: item.balanceAfter,
          description: item.description,
          metadata: item.metadata,
          createdAt: item.createdAt instanceof Date ? item.createdAt.toISOString() : item.createdAt,
        })),
        total: result.total,
        page,
        limit,
      },
    });
  } catch (error: any) {
    console.error('[admin-app-user-routes] 获取用户交易记录失败:', error);
    return res.status(500).json({
      success: false,
      error: getPublicErrorMessage('获取用户交易记录失败'),
    });
  }
});

/**
 * GET /api/internal/admin/app-users/:userId/token-usage
 * 用户 Token 使用明细（审计用）
 */
router.get('/admin/app-users/:userId/token-usage', async (req, res) => {
  try {
    const userId = String(req.params.userId || '').trim();
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));

    const result = await billingService.getSessionConsumptionRecords(userId, { page, limit });

    return res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error('[admin-app-user-routes] 获取用户 Token 使用明细失败:', error);
    return res.status(500).json({
      success: false,
      error: getPublicErrorMessage('获取用户 Token 使用明细失败'),
    });
  }
});

export default router;
