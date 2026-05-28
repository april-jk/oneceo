import express from 'express';
import { assertTaskSessionRuntimeStartAllowed, ensureTaskSessionRuntime } from './task-creation-routes';
import { getPublicErrorMessage } from '../utils/error-response';
import { createRequireInternalToken } from './internal-auth-middleware';
import { appUserDAO, appUserSessionDAO, taskCreationSessionDAO, taskSessionRunDAO } from '../db/dao';
import { sandboxExecutionEnvironmentDAO } from '../db/dao';
import { taskCreationFileMemoryStore, type FileSessionRecord } from '../agents/task-creation/file-memory-store';
import { isCanonicalAppUserId, normalizeUserId } from '../utils/user-id';
import { taskSessionWebsitePreviewSnapshotService } from '../services/task-session-website-preview-snapshot-service';

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

function mapAdminStageFromStatus(status: unknown) {
  const normalized = typeof status === 'string' ? status.trim() : '';
  if (normalized === 'completed') return 'completed';
  if (normalized === 'failed') return 'failed';
  if (normalized === 'waiting_user') return 'clarifying';
  return null;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function pickRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function buildAdminSessionSummary(input: {
  dbSession: Awaited<ReturnType<typeof taskCreationSessionDAO.getSession>> | null;
  memorySession?: FileSessionRecord | null;
  user?: Awaited<ReturnType<typeof resolveAdminSessionUser>>;
}) {
  const memory = input.memorySession || null;
  const dbSession = input.dbSession;
  const id = memory?.id || dbSession?.id || '';
  const dbStatus = typeof dbSession?.status === 'string' ? dbSession.status.trim() : '';
  const memoryStatus = typeof memory?.status === 'string' ? memory.status.trim() : '';
  const preferDbLifecycle =
    Boolean(dbStatus) &&
    dbStatus !== memoryStatus &&
    (dbStatus === 'completed' || dbStatus === 'failed' || dbStatus === 'waiting_user');
  return {
    id,
    userId: dbSession?.userId || null,
    title: memory?.title || `会话 ${id.slice(-6) || '-'}`,
    status: (preferDbLifecycle ? dbSession?.status : memory?.status) || dbSession?.status || 'in_progress',
    stage: (preferDbLifecycle ? mapAdminStageFromStatus(dbSession?.status) : memory?.stage) || mapAdminStageFromStatus(dbSession?.status),
    phase: memory?.phase,
    runtime: memory?.runtime,
    pendingQuestion: memory?.pendingQuestion,
    pendingOptions: memory?.pendingOptions || [],
    user: input.user || null,
    createdAt: toIso(memory?.createdAt || dbSession?.createdAt),
    updatedAt: toIso((preferDbLifecycle ? dbSession?.updatedAt : memory?.updatedAt) || dbSession?.updatedAt),
  };
}

async function resolveAdminSessionUser(userId: unknown) {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) return null;

  if (!isCanonicalAppUserId(normalizedUserId)) {
    return {
      id: normalizedUserId,
      source: 'legacy_user_id',
      displayName: null,
      email: null,
      status: null,
      lastLoginAt: null,
      lastSeenAt: null,
      ipAddress: null,
      userAgent: null,
      sessionCreatedAt: null,
    };
  }

  const [user, latestSession] = await Promise.all([
    appUserDAO.getById(normalizedUserId),
    appUserSessionDAO.getLatestByUserId(normalizedUserId),
  ]);

  return {
    id: normalizedUserId,
    source: user ? 'app_user' : 'missing_app_user',
    displayName: user?.displayName || null,
    email: user?.email || null,
    status: user?.status || null,
    lastLoginAt: user?.lastLoginAt ? user.lastLoginAt.toISOString() : null,
    lastSeenAt: latestSession?.lastSeenAt ? latestSession.lastSeenAt.toISOString() : null,
    ipAddress: latestSession?.ipAddress || null,
    userAgent: latestSession?.userAgent || null,
    sessionCreatedAt: latestSession?.createdAt ? latestSession.createdAt.toISOString() : null,
  };
}

router.get('/task-creation/admin/sessions', async (req, res) => {
  try {
    const parsed = Number.parseInt(String(req.query.limit || '50'), 10);
    const limit = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 200) : 50;
    const dbSessions = await taskCreationSessionDAO.getRecentSessionsForAdmin(limit);
    const memorySessions = await taskCreationFileMemoryStore.listSessions(Math.max(limit * 3, limit));
    const memoryById = new Map(memorySessions.map((item) => [item.id, item]));
    const data = await Promise.all(dbSessions.map(async (item) =>
      buildAdminSessionSummary({
        dbSession: item,
        memorySession: memoryById.get(item.id) || null,
        user: await resolveAdminSessionUser(item.userId),
      })
    ));
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
      data: buildAdminSessionSummary({
        dbSession,
        memorySession,
        user: await resolveAdminSessionUser(dbSession?.userId),
      }),
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

router.get('/task-creation/admin/sessions/:sessionId/runs/:runId/tool-calls/:toolCallId/browser-screenshot.png', async (req, res) => {
  try {
    const { sessionId, runId, toolCallId } = req.params;
    const run = await taskSessionRunDAO.getRun(runId);
    if (!run || run.sessionId !== sessionId) {
      return res.status(404).json({
        success: false,
        error: getPublicErrorMessage('浏览器截图不存在'),
      });
    }
    const screenshot = await taskSessionWebsitePreviewSnapshotService.getBrowserActionScreenshotImage({
      runId,
      toolCallId,
    });
    if (!screenshot) {
      return res.status(404).json({
        success: false,
        error: getPublicErrorMessage('浏览器截图不存在'),
      });
    }

    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Content-Type', screenshot.mimeType);
    res.setHeader('Content-Length', String(screenshot.body.length));
    return res.status(200).send(screenshot.body);
  } catch (error: any) {
    console.error('内部读取管理态浏览器操作截图失败:', error);
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '读取浏览器操作截图失败'),
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
    const { sessionId } = req.params;
    const [memorySession, binding] = await Promise.all([
      taskCreationFileMemoryStore.getSession(sessionId),
      taskSessionRunDAO.getSandboxBindingBySession(sessionId).catch(() => null),
    ]);
    const runtime = memorySession?.runtime || null;
    const sandboxId = asText(binding?.sandboxId) || asText(runtime?.orchestratorSessionId);
    const environment = sandboxId
      ? await sandboxExecutionEnvironmentDAO.getBySessionId(sandboxId).catch(() => null)
      : null;
    const metadata = pickRecord(environment?.metadata);
    const debugMeta = pickRecord(metadata.debug);
    const nekoMeta = pickRecord(debugMeta.neko);
    const baseUrl = asText(nekoMeta.baseUrl) || asText(nekoMeta.url);
    const clientUrl = asText(nekoMeta.clientUrl);
    const status = asText(nekoMeta.status) || asText(environment?.status) || asText(binding?.status) || (sandboxId ? 'ready' : 'unknown');
    const ready = Boolean(sandboxId) && (
      Boolean(baseUrl) ||
      status === 'running' ||
      status === 'ready' ||
      environment?.status === 'ready' ||
      asText(binding?.status) === 'ready'
    );
    return res.json({
      success: true,
      data: {
        ready,
        status,
        sandboxId: sandboxId || undefined,
        url: clientUrl || baseUrl || undefined,
        reasonCode: asText(nekoMeta.reasonCode) || undefined,
        updatedAt: toIso(environment?.updatedAt || binding?.updatedAt || runtime?.updatedAt || memorySession?.updatedAt),
        message: asText(nekoMeta.message) || (sandboxId ? 'runtime linked' : 'runtime not linked'),
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
    await assertTaskSessionRuntimeStartAllowed(sessionId);
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
    if (error?.message === '当前存在进行中的开发任务，暂不允许切换执行环境') {
      return res.status(409).json({
        success: false,
        error: getPublicErrorMessage('当前存在进行中的开发任务，暂不允许切换执行环境'),
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
