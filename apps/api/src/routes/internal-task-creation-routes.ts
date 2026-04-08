import express from 'express';
import { ensureTaskSessionRuntime } from './task-creation-routes';
import { getPublicErrorMessage } from '../utils/error-response';
import { createRequireInternalToken } from './internal-auth-middleware';
import { taskCreationSessionDAO } from '../db/dao';
import { taskCreationFileMemoryStore, type FileSessionRecord } from '../agents/task-creation/file-memory-store';

const router = express.Router();
const requireInternalToken = createRequireInternalToken({
  disabledMessage: 'task creation 内部接口未启用',
});

router.use(requireInternalToken);

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  return new Date().toISOString();
}

function buildAdminSessionSummary(input: {
  dbSession: Awaited<ReturnType<typeof taskCreationSessionDAO.getSession>> | null;
  memorySession?: FileSessionRecord | null;
}) {
  const memory = input.memorySession || null;
  const dbSession = input.dbSession;
  const id = memory?.id || dbSession?.id || '';
  return {
    id,
    userId: dbSession?.userId || null,
    title: memory?.title || `会话 ${id.slice(-6) || '-'}`,
    status: memory?.status || dbSession?.status || 'in_progress',
    stage: memory?.stage,
    phase: memory?.phase,
    runtime: memory?.runtime,
    pendingQuestion: memory?.pendingQuestion,
    pendingOptions: memory?.pendingOptions || [],
    createdAt: toIso(memory?.createdAt || dbSession?.createdAt),
    updatedAt: toIso(memory?.updatedAt || dbSession?.updatedAt),
  };
}

router.get('/task-creation/admin/sessions', async (req, res) => {
  try {
    const parsed = Number.parseInt(String(req.query.limit || '50'), 10);
    const limit = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 200) : 50;
    const dbSessions = await taskCreationSessionDAO.getRecentSessionsForAdmin(limit);
    const memorySessions = await taskCreationFileMemoryStore.listSessions(Math.max(limit * 3, limit));
    const memoryById = new Map(memorySessions.map((item) => [item.id, item]));
    const data = dbSessions.map((item) =>
      buildAdminSessionSummary({
        dbSession: item,
        memorySession: memoryById.get(item.id) || null,
      })
    );
    return res.json({
      success: true,
      data,
    });
  } catch (error: any) {
    console.error('内部获取管理态会话列表失败:', error);
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '获取管理态会话列表失败'),
    });
  }
});

router.get('/task-creation/admin/sessions/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const [dbSession, memorySession] = await Promise.all([
      taskCreationSessionDAO.getSession(sessionId),
      taskCreationFileMemoryStore.getSession(sessionId),
    ]);
    if (!dbSession && !memorySession) {
      return res.status(404).json({
        success: false,
        error: getPublicErrorMessage('会话不存在'),
      });
    }
    return res.json({
      success: true,
      data: buildAdminSessionSummary({ dbSession, memorySession }),
    });
  } catch (error: any) {
    console.error('内部获取管理态会话详情失败:', error);
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '获取管理态会话详情失败'),
    });
  }
});

router.get('/task-creation/admin/sessions/:sessionId/messages', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const memorySession = await taskCreationFileMemoryStore.getSession(sessionId);
    if (memorySession?.messages?.length) {
      return res.json({
        success: true,
        data: memorySession.messages,
      });
    }
    const messages = await taskCreationSessionDAO.getMessages(sessionId);
    return res.json({
      success: true,
      data: messages,
    });
  } catch (error: any) {
    console.error('内部获取管理态会话消息失败:', error);
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '获取管理态会话消息失败'),
    });
  }
});

router.get('/task-creation/admin/sessions/:sessionId/intent', async (req, res) => {
  try {
    const result = await taskCreationSessionDAO.getIntentResult(req.params.sessionId);
    return res.json({
      success: true,
      data: result || null,
    });
  } catch (error: any) {
    console.error('内部获取管理态会话 intent 失败:', error);
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '获取管理态会话 intent 失败'),
    });
  }
});

router.get('/task-creation/admin/sessions/:sessionId/task-description', async (req, res) => {
  try {
    const result = await taskCreationSessionDAO.getTaskDescription(req.params.sessionId);
    return res.json({
      success: true,
      data: result || null,
    });
  } catch (error: any) {
    console.error('内部获取管理态会话 task description 失败:', error);
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '获取管理态会话 task description 失败'),
    });
  }
});

router.get('/task-creation/admin/sessions/:sessionId/execution-plan', async (req, res) => {
  try {
    const result = await taskCreationSessionDAO.getExecutionPlan(req.params.sessionId);
    return res.json({
      success: true,
      data: result || null,
    });
  } catch (error: any) {
    console.error('内部获取管理态会话 execution plan 失败:', error);
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '获取管理态会话 execution plan 失败'),
    });
  }
});

router.get('/task-creation/admin/sessions/:sessionId/debug', async (req, res) => {
  try {
    const memorySession = await taskCreationFileMemoryStore.getSession(req.params.sessionId);
    const runtime = memorySession?.runtime || null;
    return res.json({
      success: true,
      data: {
        ready: Boolean(runtime?.orchestratorSessionId),
        status: runtime?.orchestratorSessionId ? 'running' : 'unknown',
        sandboxId: runtime?.orchestratorSessionId || undefined,
        updatedAt: toIso(runtime?.updatedAt || memorySession?.updatedAt),
        message: runtime?.orchestratorSessionId ? 'runtime linked' : 'runtime not linked',
      },
    });
  } catch (error: any) {
    console.error('内部获取管理态会话 debug 失败:', error);
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '获取管理态会话 debug 失败'),
    });
  }
});

router.post('/task-creation/sessions/:sessionId/runtime/start', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const runtime = await ensureTaskSessionRuntime(sessionId);
    return res.json({
      success: true,
      data: runtime,
    });
  } catch (error: any) {
    if (error?.message === '会话不存在') {
      return res.status(404).json({
        success: false,
        error: getPublicErrorMessage('会话不存在'),
      });
    }
    console.error('内部启动执行环境失败:', error);
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '启动执行环境失败'),
    });
  }
});

export default router;
