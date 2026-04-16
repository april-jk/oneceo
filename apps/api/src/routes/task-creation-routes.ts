/**
 * 任务创建 API 路由
 * 
 * 提供任务创建历史、会话详情等查询接口
 */

import express from 'express';
import { randomUUID } from 'node:crypto';
import {
  appUserLegacyIdMappingDAO,
  sandboxExecutionEnvironmentDAO,
  taskCreationSessionDAO,
  taskSessionRunDAO,
  taskSessionWorkspaceCacheDAO,
} from '../db/dao';
import { getPublicErrorMessage } from '../utils/error-response';
import { writeConnectorDebugLog } from '../utils/connector-debug-log';
import {
  deriveSessionDriver,
  taskCreationFileMemoryStore,
  type FileSessionRecord,
} from '../agents/task-creation/file-memory-store';
import { taskCreationWebSocketService } from '../agents/task-creation/websocket-service';
import { taskCreationCacheStore } from '../agents/task-creation/task-creation-cache-store';
import { osacAgentService } from '../services/osac-agent-service';
import { opencodeRemoteService } from '../services/opencode-remote-service';
import { opencodeEventStreamService } from '../services/opencode-event-stream-service';
import { sandboxAgentProvisionService } from '../services/sandbox-agent-provision-service';
import { sandboxEnvironmentService } from '../services/sandbox-environment-service';
import { hasRenderableAssistantReply } from '../utils/opencode-history-recovery';
import { resolveOpencodeWorkspacePath } from '../utils/opencode-workspace';
import { setSandboxMetadata, touchSandbox } from '../services/sandbox-activity-service';
import { ensureNekoDebug, probeNekoIceHealth } from '../services/sandbox-debug-service';
import { cloudflareTurnService } from '../services/cloudflare-turn-service';
import {
  getRailwayDeploymentPanel,
  triggerRailwayRedeploy,
  triggerRailwayRollback,
  waitForRailwayDeploymentAfterSourceSync,
  type RailwayDeploymentPanelData,
} from '../services/railway-deployment-service';
import {
  railwayDatabaseService,
  type RailwayDatabaseRowLocator,
} from '../services/railway-database-service';
import { platformDeploymentAccountService } from '../services/platform-deployment-account-service';
import { publishTaskSessionWorkspaceToRepository } from '../services/task-creation-deployment-source-service';
import { e2bConnector } from '../connectors/e2b-connector';
import { currentUserResolver } from '../services/current-user-resolver';
import { codexRuntimeConfigService } from '../services/codex-runtime-config-service';
import { codexRemoteService } from '../services/codex-remote-service';
import { restoreWorkspaceIfArchived } from '../services/sandbox-archive-service';
import { CONNECTOR_KEYS, type ConnectorKey } from '../services/connector-registry';
import { resolveAttachConnectorError, sessionConnectorService } from '../services/session-connector-service';
import { sessionConnectorDraftService } from '../services/session-connector-draft-service';
import { connectorGuideService } from '../services/connector-guide-service';
import { taskSessionCacheFacade } from '../services/task-session-cache-facade';
import {
  inferFilenameFromResponse,
  resolveRemoteAttachmentTarget,
  type RemoteAttachmentProvider,
} from '../services/remote-attachment-service';
import {
  TASK_ATTACHMENT_MAX_BYTES,
  isAllowedAttachmentFile,
  sanitizeAttachmentName,
} from '../services/task-attachment-service';
import { downloadFromR2 } from '../services/r2-client';
import { taskSessionDeliverableService } from '../services/task-session-deliverable-service';
import { platformSkillService } from '../services/platform-skill-service';
import { userSkillService } from '../services/user-skill-service';
import { isLegacyClientUserId, isSameUserId, normalizeUserId } from '../utils/user-id';

const router = express.Router();
const TASK_ATTACHMENT_DIR = '.attachments';
const recentHistoryHydrationInFlight = new Map<string, Promise<void>>();
const recentHistoryHydrationQueuedAt = new Map<string, number>();
const DEFAULT_SESSION_TITLE = '新建任务会话';
const WEAK_INTENT_TITLE_INPUTS = new Set([
  '你好',
  '您好',
  '嗨',
  'hi',
  'hello',
  'hey',
  '在吗',
  '有人吗',
  'help',
  '帮我一下',
  '开始',
  '继续',
  'ok',
  'okay',
  '好的',
  '收到',
  '1',
  '？',
  '?',
]);

router.get('/skills', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const data = await userSkillService.listAvailableSkills(currentUser.userId);
    return res.json({
      success: true,
      data,
    });
  } catch (error: any) {
    const authError = resolveCurrentUserError(error);
    console.error('获取平台 skills 失败:', error);
    return res.status(authError?.status || 500).json({
      success: false,
      error: getPublicErrorMessage(authError?.message || error?.message || '获取平台 skills 失败'),
    });
  }
});

router.get('/settings/skills', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const data = await userSkillService.listSettings(currentUser.userId);
    return res.json({
      success: true,
      data,
    });
  } catch (error: any) {
    const authError = resolveCurrentUserError(error);
    console.error('获取用户技能设置失败:', error);
    return res.status(authError?.status || 400).json({
      success: false,
      error: getPublicErrorMessage(authError?.message || error?.message || '获取用户技能设置失败'),
    });
  }
});

router.post('/settings/skills/platform/:skillId/enable', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const data = await userSkillService.enablePlatformSkill(currentUser.userId, req.params.skillId);
    return res.json({ success: true, data });
  } catch (error: any) {
    const authError = resolveCurrentUserError(error);
    console.error('启用平台技能失败:', error);
    return res.status(authError?.status || 400).json({
      success: false,
      error: getPublicErrorMessage(authError?.message || error?.message || '启用平台技能失败'),
    });
  }
});

router.post('/settings/skills/platform/:skillId/disable', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const data = await userSkillService.disablePlatformSkill(currentUser.userId, req.params.skillId);
    return res.json({ success: true, data });
  } catch (error: any) {
    const authError = resolveCurrentUserError(error);
    console.error('停用平台技能失败:', error);
    return res.status(authError?.status || 400).json({
      success: false,
      error: getPublicErrorMessage(authError?.message || error?.message || '停用平台技能失败'),
    });
  }
});

router.post('/settings/skills/custom', express.json({ limit: '1mb' }), async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const data = await userSkillService.createCustomSkill(currentUser.userId, {
      slug: req.body?.slug,
      name: req.body?.name,
      description: req.body?.description,
      category: req.body?.category,
      bodyMarkdown: req.body?.bodyMarkdown,
      documents: Array.isArray(req.body?.documents)
        ? req.body.documents.map((item: any) => ({
            documentKey: item?.documentKey,
            documentPath: item?.documentPath,
            title: item?.title,
            summary: item?.summary,
            bodyMarkdown: item?.bodyMarkdown,
          }))
        : [],
    });
    return res.status(201).json({ success: true, data });
  } catch (error: any) {
    const authError = resolveCurrentUserError(error);
    console.error('创建自定义技能失败:', error);
    return res.status(authError?.status || 400).json({
      success: false,
      error: getPublicErrorMessage(authError?.message || error?.message || '创建自定义技能失败'),
    });
  }
});

router.put('/settings/skills/custom/:customSkillId', express.json({ limit: '1mb' }), async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const data = await userSkillService.updateCustomSkill(currentUser.userId, req.params.customSkillId, {
      name: req.body?.name,
      description: req.body?.description,
      category: req.body?.category,
      bodyMarkdown: req.body?.bodyMarkdown,
      documents: Array.isArray(req.body?.documents)
        ? req.body.documents.map((item: any) => ({
            documentKey: item?.documentKey,
            documentPath: item?.documentPath,
            title: item?.title,
            summary: item?.summary,
            bodyMarkdown: item?.bodyMarkdown,
          }))
        : undefined,
    });
    return res.json({ success: true, data });
  } catch (error: any) {
    const authError = resolveCurrentUserError(error);
    console.error('更新自定义技能失败:', error);
    return res.status(authError?.status || 400).json({
      success: false,
      error: getPublicErrorMessage(authError?.message || error?.message || '更新自定义技能失败'),
    });
  }
});

router.post('/settings/skills/custom/:customSkillId/archive', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const data = await userSkillService.archiveCustomSkill(currentUser.userId, req.params.customSkillId);
    return res.json({ success: true, data });
  } catch (error: any) {
    const authError = resolveCurrentUserError(error);
    console.error('归档自定义技能失败:', error);
    return res.status(authError?.status || 400).json({
      success: false,
      error: getPublicErrorMessage(authError?.message || error?.message || '归档自定义技能失败'),
    });
  }
});

router.post('/settings/skills/custom/:customSkillId/activate', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const data = await userSkillService.activateCustomSkill(currentUser.userId, req.params.customSkillId);
    return res.json({ success: true, data });
  } catch (error: any) {
    const authError = resolveCurrentUserError(error);
    console.error('启用自定义技能失败:', error);
    return res.status(authError?.status || 400).json({
      success: false,
      error: getPublicErrorMessage(authError?.message || error?.message || '启用自定义技能失败'),
    });
  }
});

router.get('/codex/runtime-config', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const data = await codexRuntimeConfigService.getByUserId(currentUser.userId);
    return res.json({
      success: true,
      data,
    });
  } catch (error: any) {
    const authError = resolveCurrentUserError(error);
    console.error('获取 Codex 运行配置失败:', error);
    return res.status(authError?.status || 400).json({
      success: false,
      error: getPublicErrorMessage(authError?.message || error?.message || '获取 Codex 运行配置失败'),
    });
  }
});

router.put('/codex/runtime-config', express.json({ limit: '2mb' }), async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const data = await codexRuntimeConfigService.upsertByUserId(currentUser.userId, {
      baseUrl: typeof req.body?.baseUrl === 'string' ? req.body.baseUrl : undefined,
      model: typeof req.body?.model === 'string' ? req.body.model : undefined,
      apiKey: typeof req.body?.apiKey === 'string' ? req.body.apiKey : undefined,
      configToml: typeof req.body?.configToml === 'string' ? req.body.configToml : undefined,
      authJson: typeof req.body?.authJson === 'string' ? req.body.authJson : undefined,
    });
    return res.json({
      success: true,
      data,
    });
  } catch (error: any) {
    const authError = resolveCurrentUserError(error);
    console.error('保存 Codex 运行配置失败:', error);
    return res.status(authError?.status || 400).json({
      success: false,
      error: getPublicErrorMessage(authError?.message || error?.message || '保存 Codex 运行配置失败'),
    });
  }
});

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function isUnsafePath(input: string): boolean {
  if (!input) return true;
  if (input.startsWith('/') || input.startsWith('\\')) return true;
  const normalized = input.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts.some((part) => part === '..');
}

function parseRefreshFlag(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  const text = String(value).trim().toLowerCase();
  return text === '1' || text === 'true' || text === 'yes';
}

function flattenErrorMessages(error: unknown): string[] {
  const messages: string[] = [];
  let current: any = error;
  const visited = new Set<unknown>();
  while (current && !visited.has(current)) {
    visited.add(current);
    const message = typeof current?.message === 'string' ? current.message.trim() : '';
    if (message) {
      messages.push(message);
    }
    current = current?.cause;
  }
  return messages;
}

function isTransientDatabaseError(error: unknown): boolean {
  const messages = flattenErrorMessages(error).join(' | ').toLowerCase();
  if (!messages) return false;
  return (
    messages.includes('drizzlequeryerror') ||
    messages.includes('connection terminated due to connection timeout') ||
    messages.includes('connection terminated unexpectedly') ||
    messages.includes('timeout exceeded when trying to connect') ||
    messages.includes('terminating connection due to administrator command') ||
    messages.includes('too many clients already') ||
    messages.includes('remaining connection slots are reserved')
  );
}

function respondDatabaseUnavailable(
  res: express.Response,
  fallbackMessage = '数据库暂时不可用，请稍后重试'
) {
  return res.status(503).json({
    success: false,
    error: getPublicErrorMessage(fallbackMessage),
  });
}

function resolveTenantKey(currentUser: { tenantKey: string }): string {
  return currentUser.tenantKey;
}

function resolveCurrentUserError(error: unknown): { status: number; message: string } | null {
  const message = error instanceof Error ? error.message : String(error || '');
  if (message.includes('无法识别当前用户')) {
    return { status: 401, message };
  }
  return null;
}

function resolveLegacyUserIdHint(req: express.Request, currentUserId: string): string {
  const candidate = asText(req.header('X-Legacy-User-Id') || req.header('X-User-Id') || req.query.legacyUserId);
  if (!candidate) return '';
  if (isSameUserId(candidate, currentUserId)) return '';
  if (!isLegacyClientUserId(candidate)) return '';
  return candidate;
}

async function upsertLegacyUserMapping(appUserId: string, legacyUserIdHint: string) {
  if (!legacyUserIdHint) return;
  try {
    await appUserLegacyIdMappingDAO.upsert({
      appUserId,
      legacyUserId: legacyUserIdHint,
      source: 'request_header',
    });
  } catch (error) {
    console.warn('[TASK_SESSION_LEGACY_MAPPING_UPSERT_FAILED]', {
      appUserId,
      legacyUserId: legacyUserIdHint,
      error,
    });
  }
}

async function collectLegacyUserIdsForMigration(appUserId: string, legacyUserIdHint: string): Promise<string[]> {
  const values = new Set<string>();
  if (legacyUserIdHint) values.add(legacyUserIdHint);
  try {
    const mapped = await appUserLegacyIdMappingDAO.listLegacyIdsByAppUserId(appUserId, 200);
    for (const legacyUserId of mapped) {
      if (legacyUserId) values.add(legacyUserId);
    }
  } catch (error) {
    console.warn('[TASK_SESSION_LEGACY_MAPPING_LIST_FAILED]', {
      appUserId,
      error,
    });
  }
  return [...values];
}

async function requireOwnedTaskSession(sessionId: string, userId: string, legacyUserIdHint?: string) {
  const normalizedUserId = normalizeUserId(userId);
  let session = await taskCreationSessionDAO.getSession(sessionId);
  if (!session) {
    throw new Error('会话不存在');
  }
  if (!session.userId) {
    const rebound = await taskCreationSessionDAO.bindUserIfMissing(sessionId, normalizedUserId);
    if (!rebound?.userId) {
      throw new Error('会话缺少归属用户，禁止继续访问');
    }
    session = rebound;
  }
  const normalizedSessionUserId = normalizeUserId(session.userId);
  if (!isSameUserId(normalizedSessionUserId, normalizedUserId) && legacyUserIdHint) {
    const adopted = await taskCreationSessionDAO.adoptSessionFromLegacyUserId(
      sessionId,
      normalizedUserId,
      legacyUserIdHint
    );
    if (adopted?.userId) {
      session = adopted;
    }
  }
  if (!isSameUserId(normalizeUserId(session.userId), normalizedUserId)) {
    const legacyOwner = normalizeUserId(session.userId);
    if (isLegacyClientUserId(legacyOwner)) {
      try {
        const mappedAppUserId = await appUserLegacyIdMappingDAO.resolveAppUserIdByLegacyUserId(legacyOwner);
        if (isSameUserId(mappedAppUserId, normalizedUserId)) {
          const adopted = await taskCreationSessionDAO.adoptSessionFromLegacyUserId(
            sessionId,
            normalizedUserId,
            legacyOwner
          );
          if (adopted?.userId) {
            session = adopted;
          }
        }
      } catch (error) {
        console.warn('[TASK_SESSION_REQUIRE_OWNED_LEGACY_RESOLVE_FAILED]', {
          sessionId,
          userId: normalizedUserId,
          legacyOwner,
          error,
        });
      }
    }
  }
  if (!isSameUserId(normalizeUserId(session.userId), normalizedUserId)) {
    throw new Error('当前用户无权访问该会话');
  }
  return session;
}

function resolveOwnedTaskSessionError(error: unknown): { status: number; message: string } | null {
  const message = error instanceof Error ? error.message : String(error || '');
  if (message === '会话不存在') {
    return { status: 404, message };
  }
  if (message === '会话缺少归属用户，禁止继续访问' || message === '当前用户无权访问该会话') {
    return { status: 403, message };
  }
  return null;
}

function resolveSessionConnectorOwnershipError(error: unknown): { status: number; message: string } | null {
  const message = error instanceof Error ? error.message : String(error || '');
  if (message === '会话不存在') {
    return { status: 404, message };
  }
  if (
    message === '当前用户无权管理该会话连接器' ||
    message === '会话缺少归属用户，无法管理该会话连接器'
  ) {
    return { status: 403, message };
  }
  if (message.includes('无法识别当前用户')) {
    return { status: 401, message };
  }
  return null;
}

function parseConnectorKey(value: string): ConnectorKey {
  if ((CONNECTOR_KEYS as readonly string[]).includes(value)) {
    return value as ConnectorKey;
  }
  throw new Error(`未知连接器: ${value}`);
}

function toIso(value: Date | string | null | undefined): string {
  if (!value) return new Date().toISOString();
  if (value instanceof Date) return value.toISOString();
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  return new Date().toISOString();
}

function toSessionSummary(session: any) {
  const normalizedStage = normalizeLiveSessionStage(session);
  return {
    id: session.id,
    title: session.title,
    titleLocked: Boolean(session.titleLocked),
    titleSource: session.titleSource,
    titleResolvedAt: session.titleResolvedAt,
    isFavorite: Boolean(session.isFavorite),
    projectId: session.projectId || null,
    projectName: session.projectName || null,
    shareEnabled: Boolean(session.shareEnabled),
    shareToken: session.shareToken || null,
    status: session.status,
    stage: normalizedStage,
    phase: session.phase,
    phaseCycle: session.phaseCycle,
    driver: session.driver,
    mode: session.mode,
    executor: session.executor,
    codexExecutionMode: session.codexExecutionMode,
    runtime: session.runtime,
    pendingQuestion: session.pendingQuestion,
    pendingOptions: session.pendingOptions,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: Array.isArray(session.messages) ? session.messages.length : 0,
    messages: [],
  };
}

function mergeSessionLifecycleFromDb(memorySession: any, dbSession: any) {
  if (!memorySession) return dbSession;
  if (!dbSession) return memorySession;

  const dbStatus = asText(dbSession.status);
  const memoryStatus = asText(memorySession.status);
  const shouldPreferDbLifecycle =
    (dbStatus === 'completed' || dbStatus === 'failed') && dbStatus !== memoryStatus;

  if (!shouldPreferDbLifecycle) {
    return memorySession;
  }

  return {
    ...memorySession,
    status: dbSession.status,
    stage: dbSession.stage,
    updatedAt: dbSession.updatedAt || memorySession.updatedAt,
  };
}

function normalizeLiveSessionStage(
  session: Pick<
    FileSessionRecord,
    'status' | 'stage' | 'mode' | 'driver' | 'executor' | 'runtime' | 'messages'
  > | null | undefined
): NonNullable<FileSessionRecord['stage']> | undefined {
  const status = asText(session?.status);
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  if (status === 'waiting_user') return 'clarifying';

  const currentStage = asText(session?.stage);
  const mode = asText(session?.mode);
  const driver = asText(session?.driver);
  const executor = asText(session?.executor);
  const hasRuntime = Boolean(asText(session?.runtime?.orchestratorSessionId));
  const hasExecutorRuntime = Boolean(asText(session?.runtime?.executorSessionId));
  const hasOpencodeRuntime = Boolean(asText(session?.runtime?.opencodeSessionId));
  const hasUserInput = Array.isArray(session?.messages)
    ? session!.messages.some((message) => {
        const type = asText(message?.messageType);
        return type === 'user_input' || type === 'user_response' || type === 'opencode_user_input';
      })
    : false;

  if (
    status === 'in_progress' &&
    (
      mode === 'sandbox' ||
      driver === 'opencode' ||
      driver === 'codex' ||
      driver === 'claudecode' ||
      executor === 'opencode' ||
      executor === 'codex' ||
      executor === 'claudecode' ||
      hasRuntime ||
      hasExecutorRuntime ||
      hasOpencodeRuntime
    ) &&
    hasUserInput
  ) {
    return 'executing';
  }

  return (currentStage as NonNullable<FileSessionRecord['stage']>) || 'collecting';
}

async function findEnvironmentByTaskSessionId(taskSessionId: string) {
  return sandboxExecutionEnvironmentDAO.findCanonicalByTaskSessionId(taskSessionId);
}

async function reconcileTaskSessionDuplicateEnvironments(
  taskSessionId: string,
  activeOrchestratorSessionId: string
) {
  if (!taskSessionId || !activeOrchestratorSessionId) return;
  const environments = await sandboxExecutionEnvironmentDAO.listByTaskSessionId(taskSessionId, 200);
  for (const env of environments) {
    if (env.sessionId === activeOrchestratorSessionId || env.status === 'closed') {
      continue;
    }
    const metadata = ((env.metadata || {}) as Record<string, unknown>) || {};
    const isE2b = String(metadata.sandboxProvider || '').toLowerCase() === 'e2b';
    if (isE2b) {
      try {
        await sandboxEnvironmentService.closeEnvironment(env.sessionId);
      } catch (error) {
        if (!isSandboxNotFoundError(error)) {
          console.warn('[TASK_RUNTIME_DUPLICATE_KILL_FAILED]', {
            taskSessionId,
            staleSandboxId: env.sessionId,
            activeOrchestratorSessionId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    await setSandboxMetadata(env.sessionId, {
      dedupeReplacedAt: new Date().toISOString(),
      dedupeReason: 'task_runtime_rebound',
      dedupeReplacementSandboxId: activeOrchestratorSessionId,
    });
    await sandboxExecutionEnvironmentDAO.updateStatus(env.sessionId, 'closed', env.vmName || null).catch(() => null);
  }
}

async function buildFileSessionFromDb(sessionId: string): Promise<FileSessionRecord | null> {
  const session = await taskCreationSessionDAO.getSession(sessionId);
  if (!session) return null;
  let taskDescription: Awaited<ReturnType<typeof taskCreationSessionDAO.getTaskDescription>> | null = null;
  let messages: Awaited<ReturnType<typeof taskCreationSessionDAO.getMessages>> = [];
  try {
    [taskDescription, messages] = await Promise.all([
      taskCreationSessionDAO.getTaskDescription(sessionId),
      taskCreationSessionDAO.getMessages(sessionId),
    ]);
  } catch (error) {
    if (!isTransientDatabaseError(error)) {
      throw error;
    }
    console.warn('[TASK_SESSION_DB_HYDRATE_PARTIAL]', { sessionId, error });
  }
  const titleCandidate =
    taskDescription?.title ||
    messages?.find((m) => m.role === 'user')?.content ||
    '新建任务会话';

  const status: FileSessionRecord['status'] =
    session.status === 'completed' || session.status === 'failed' || session.status === 'waiting_user'
      ? session.status
      : 'in_progress';
  const stage: NonNullable<FileSessionRecord['stage']> =
    status === 'completed'
      ? 'completed'
      : status === 'failed'
        ? 'failed'
        : status === 'waiting_user'
          ? 'clarifying'
          : 'executing';

  const env = await findEnvironmentByTaskSessionId(sessionId);
  const orchestratorSessionId = env?.sessionId;
  const normalizedMessages = Array.isArray(messages)
    ? annotateRuntimeGenerations(
        messages.map((m, idx) => ({
          id: String(m.id),
          role: (m.role as any) || 'agent',
          messageType: m.messageType || 'message',
          content: m.content || '',
          metadata: normalizeMessageTimelineMetadata(sanitizeTimelineMetadataForClient(m.metadata), m.createdAt, idx),
          createdAt: toIso(m.createdAt as any),
        })),
        { orchestratorSessionId }
      )
    : [];
  const inferredRuntime = inferRuntimeFromMessages(normalizedMessages, orchestratorSessionId);
  const mergedRuntime = mergeCodexRuntimeMetadata(inferredRuntime, pickRecord(env?.metadata));
  const inferredExecutor =
    asText(mergedRuntime.executor) || (mergedRuntime.executorSessionId ? 'opencode' : '');
  const inferredTransport = asText(mergedRuntime.transport) || undefined;
  const hasSandboxHistory = Array.isArray(messages)
    ? messages.some((message) => {
        const messageType = asText(message.messageType);
        return (
          messageType.startsWith('opencode_') ||
          messageType.startsWith('codex_') ||
          messageType === 'executor_event'
        );
      })
    : false;
  const sandboxExecutor = inferredExecutor || (hasSandboxHistory ? 'opencode' : '');

  return {
    id: session.id,
    title: String(titleCandidate).trim().slice(0, 80) || '新建任务会话',
    isFavorite: false,
    projectId: null,
    projectName: null,
    shareEnabled: false,
    shareToken: null,
    status,
    stage,
    mode: sandboxExecutor ? 'sandbox' : undefined,
    executor: sandboxExecutor || undefined,
    codexExecutionMode:
      sandboxExecutor === 'codex'
        ? inferredTransport === 'app_server'
          ? 'ws'
          : 'sdk'
        : undefined,
    driver: sandboxExecutor ? deriveSessionDriver({ mode: 'sandbox', executor: sandboxExecutor }) : undefined,
    runtime: orchestratorSessionId
      ? {
          generation: inferredRuntime.generation,
          codexRestoreStatus: mergedRuntime.codexRestoreStatus as any,
          codexRestoreAt: mergedRuntime.codexRestoreAt,
          codexRestoreSourceKey: mergedRuntime.codexRestoreSourceKey,
          previousExecutorSessionId: mergedRuntime.previousExecutorSessionId,
          codexRestoreFailureReason: mergedRuntime.codexRestoreFailureReason,
          orchestratorSessionId,
          executor: mergedRuntime.executor || (mergedRuntime.opencodeSessionId ? 'opencode' : undefined),
          transport: mergedRuntime.transport,
          executorSessionId: mergedRuntime.executorSessionId || mergedRuntime.opencodeSessionId,
          opencodeSessionId: mergedRuntime.opencodeSessionId,
          updatedAt: toIso(env?.updatedAt as any),
        }
      : undefined,
    createdAt: toIso(session.createdAt as any),
    updatedAt: toIso(session.updatedAt as any),
    messages: normalizedMessages,
  };
}

async function buildLightweightFileSessionFromDb(sessionId: string): Promise<FileSessionRecord | null> {
  const session = await taskCreationSessionDAO.getSession(sessionId);
  if (!session) return null;

  let taskDescription: Awaited<ReturnType<typeof taskCreationSessionDAO.getTaskDescription>> | null = null;
  let recentMessages: Awaited<ReturnType<typeof taskCreationSessionDAO.getRecentMessages>> = [];
  try {
    [taskDescription, recentMessages] = await Promise.all([
      taskCreationSessionDAO.getTaskDescription(sessionId),
      taskCreationSessionDAO.getRecentMessages(sessionId, 50),
    ]);
  } catch (error) {
    if (!isTransientDatabaseError(error)) {
      throw error;
    }
    console.warn('[TASK_SESSION_DB_LIGHTWEIGHT_PARTIAL]', { sessionId, error });
  }

  const env = await findEnvironmentByTaskSessionId(sessionId);
  const orchestratorSessionId = env?.sessionId;
  const normalizedRecentMessages = Array.isArray(recentMessages)
    ? annotateRuntimeGenerations(
        recentMessages.map((message, idx) => ({
          id: String(message.id),
          role: (message.role as any) || 'agent',
          messageType: message.messageType || 'message',
          content: message.content || '',
          metadata: normalizeMessageTimelineMetadata(
            sanitizeTimelineMetadataForClient(message.metadata),
            message.createdAt,
            idx
          ),
          createdAt: toIso(message.createdAt as any),
        })),
        { orchestratorSessionId }
      )
    : [];

  const inferredRuntime = inferRuntimeFromMessages(normalizedRecentMessages, orchestratorSessionId);
  const mergedRuntime = mergeCodexRuntimeMetadata(inferredRuntime, pickRecord(env?.metadata));
  const inferredExecutor =
    asText(mergedRuntime.executor) || (mergedRuntime.executorSessionId ? 'opencode' : '');
  const inferredTransport = asText(mergedRuntime.transport) || undefined;
  const hasSandboxSignals =
    Boolean(orchestratorSessionId) ||
    Boolean(inferredRuntime.executorSessionId || inferredRuntime.opencodeSessionId) ||
    normalizedRecentMessages.some((message) => {
      const messageType = asText(message.messageType);
      return (
        messageType.startsWith('opencode_') ||
        messageType.startsWith('codex_') ||
        messageType === 'executor_event'
      );
    });
  const sandboxExecutor = inferredExecutor || (hasSandboxSignals ? 'opencode' : '');
  const titleCandidate =
    taskDescription?.title ||
    normalizedRecentMessages.find((message) => asText(message.role) === 'user')?.content ||
    '新建任务会话';

  const status: FileSessionRecord['status'] =
    session.status === 'completed' || session.status === 'failed' || session.status === 'waiting_user'
      ? session.status
      : 'in_progress';
  const stage: NonNullable<FileSessionRecord['stage']> =
    status === 'completed'
      ? 'completed'
      : status === 'failed'
        ? 'failed'
        : status === 'waiting_user'
          ? 'clarifying'
          : 'executing';

  return {
    id: session.id,
    title: String(titleCandidate).trim().slice(0, 80) || '新建任务会话',
    status,
    stage,
    mode: hasSandboxSignals ? 'sandbox' : undefined,
    executor: sandboxExecutor || undefined,
    codexExecutionMode:
      sandboxExecutor === 'codex'
        ? inferredTransport === 'app_server'
          ? 'ws'
          : 'sdk'
        : undefined,
    driver: hasSandboxSignals ? deriveSessionDriver({ mode: 'sandbox', executor: sandboxExecutor || 'opencode' }) : undefined,
    runtime: orchestratorSessionId
      ? {
          generation: inferredRuntime.generation,
          codexRestoreStatus: mergedRuntime.codexRestoreStatus as any,
          codexRestoreAt: mergedRuntime.codexRestoreAt,
          codexRestoreSourceKey: mergedRuntime.codexRestoreSourceKey,
          previousExecutorSessionId: mergedRuntime.previousExecutorSessionId,
          codexRestoreFailureReason: mergedRuntime.codexRestoreFailureReason,
          orchestratorSessionId,
          executor: mergedRuntime.executor || (mergedRuntime.opencodeSessionId ? 'opencode' : undefined),
          transport: mergedRuntime.transport,
          executorSessionId: mergedRuntime.executorSessionId || mergedRuntime.opencodeSessionId,
          opencodeSessionId: mergedRuntime.opencodeSessionId,
          updatedAt: toIso(env?.updatedAt as any),
        }
      : undefined,
    createdAt: toIso(session.createdAt as any),
    updatedAt: toIso(session.updatedAt as any),
    messages: [],
  };
}

async function hydrateFileSessionFromDb(sessionId: string) {
  const record = await buildFileSessionFromDb(sessionId);
  if (!record) return null;
  await taskCreationFileMemoryStore.createSession(record.title, record.id);
  await taskCreationFileMemoryStore.updateSessionStatus(record.id, record.status as any);
  if (record.runtime?.orchestratorSessionId) {
    await taskCreationFileMemoryStore.updateRuntimeBinding(record.id, {
      generation: record.runtime.generation,
      orchestratorSessionId: record.runtime.orchestratorSessionId,
      executor: record.runtime.executor || record.executor,
      transport: record.runtime.transport,
      executorSessionId: record.runtime.executorSessionId || record.runtime.opencodeSessionId,
      opencodeSessionId: record.runtime.opencodeSessionId,
      codexRestoreStatus: record.runtime.codexRestoreStatus as any,
      codexRestoreAt: record.runtime.codexRestoreAt,
      codexRestoreSourceKey: record.runtime.codexRestoreSourceKey,
      previousExecutorSessionId: record.runtime.previousExecutorSessionId,
      codexRestoreFailureReason: record.runtime.codexRestoreFailureReason,
    });
  }
  if (record.codexExecutionMode === 'sdk' || record.codexExecutionMode === 'ws') {
    await taskCreationFileMemoryStore.updateSessionCodexExecutionMode(record.id, record.codexExecutionMode);
  }
  if (record.driver) {
    await taskCreationFileMemoryStore.updateSessionDriver(record.id, record.driver);
  }
  return record;
}

async function resolveTaskSessionRecord(sessionId: string) {
  let session = await taskCreationFileMemoryStore.getSession(sessionId);
  if (!session) {
    session = await hydrateFileSessionFromDb(sessionId);
  }
  session = await reconcileRecoveredOpencodeCompletion(session);
  return session;
}

async function resolveTaskSessionMeta(sessionId: string) {
  const session = await taskCreationFileMemoryStore.getSession(sessionId);
  if (session) {
    return reconcileRecoveredOpencodeCompletion({
      ...session,
      stage: normalizeLiveSessionStage(session),
      messages: [],
    });
  }
  const lightweight = await buildLightweightFileSessionFromDb(sessionId);
  return reconcileRecoveredOpencodeCompletion(lightweight);
}

async function reconcileRecoveredOpencodeCompletion(
  session: FileSessionRecord | null
): Promise<FileSessionRecord | null> {
  if (!session) {
    return null;
  }

  if (session.status === 'completed' || session.status === 'failed') {
    return session;
  }

  const shouldInspectNativeCompletion =
    asText(session.mode) === 'sandbox' &&
    (asText(session.executor) === 'opencode' || asText(session.runtime?.opencodeSessionId));

  if (!shouldInspectNativeCompletion) {
    return session;
  }

  let nativeProgress: Awaited<ReturnType<typeof opencodeRemoteService.inspectNativeSessionProgress>> | null = null;
  try {
    nativeProgress = await opencodeRemoteService.inspectNativeSessionProgress(session.id, {
      // 会话详情/历史接口不应触发 sandbox provision，否则会因为运行时依赖缺失导致 500。
      allowProvision: false,
    });
  } catch (error) {
    console.warn('[TASK_CREATION_NATIVE_PROGRESS_CHECK_FAILED]', { sessionId: session.id, error });
    return session;
  }

  if (
    !nativeProgress?.assistantObserved ||
    !nativeProgress.hasRenderableAssistantReply ||
    nativeProgress.hasActiveAssistantParts
  ) {
    return session;
  }

  const nextPhase = session.phase === 'delivery' ? 'delivery' : (session.phase as any) || 'delivery';
  await taskCreationFileMemoryStore.updateSessionState(session.id, {
    status: 'completed',
    stage: 'completed',
    phase: nextPhase,
  });
  await taskCreationSessionDAO.updateSessionStatus(session.id, 'completed');

  return {
    ...session,
    status: 'completed' as FileSessionRecord['status'],
    stage: 'completed' as NonNullable<FileSessionRecord['stage']>,
    phase: nextPhase as FileSessionRecord['phase'],
    runtime: session.runtime
      ? {
          ...session.runtime,
          orchestratorSessionId:
            nativeProgress.orchestratorSessionId || session.runtime.orchestratorSessionId,
          opencodeSessionId: nativeProgress.opencodeSessionId || session.runtime.opencodeSessionId,
        }
      : {
        generation: 1,
        orchestratorSessionId: nativeProgress.orchestratorSessionId,
        opencodeSessionId: nativeProgress.opencodeSessionId,
        updatedAt: new Date().toISOString(),
        },
  };
}

async function resolveTaskSessionEnvironment(session: FileSessionRecord | null) {
  const orchestratorSessionId = asText(session?.runtime?.orchestratorSessionId);
  if (orchestratorSessionId) {
    const byRuntime = await sandboxExecutionEnvironmentDAO.getBySessionId(orchestratorSessionId);
    if (byRuntime) {
      return {
        orchestratorSessionId,
        environment: byRuntime,
      };
    }
  }

  const byTaskSession = session ? await findEnvironmentByTaskSessionId(session.id) : null;
  if (byTaskSession) {
    return {
      orchestratorSessionId: byTaskSession.sessionId,
      environment: byTaskSession,
    };
  }

  return {
    orchestratorSessionId: '',
    environment: null,
  };
}

async function buildRailwayDeploymentResponse(
  userId: string,
  session: FileSessionRecord | null,
  selectedDeploymentId?: string
) {
  const account = await platformDeploymentAccountService.getUserAccount(userId);
  if (!account) {
    return {
      configured: false,
      canDeploy: true,
      message: '首次部署时将自动准备托管仓库与部署资源，并发布当前工作区内容。',
      activeDeploymentPending: false,
      domains: [],
      deployments: [],
      logs: [],
      missing: [],
    } satisfies RailwayDeploymentPanelData;
  }
  const { environment } = await resolveTaskSessionEnvironment(session);
  const metadata = pickRecord(environment?.metadata);
  return getRailwayDeploymentPanel(metadata, {
    platformDeployment: {
      adminToken: process.env.RAILWAY_ADMIN_TOKEN,
      token: account.accessToken,
      projectId: account.projectId,
      projectName: account.projectName,
      environmentId: account.environmentId,
      environmentName: account.environmentName,
      serviceId: account.serviceId,
      serviceName: account.serviceName,
    },
    deploymentId: selectedDeploymentId,
  });
}

async function persistRailwayDeploymentSelection(
  orchestratorSessionId: string,
  environmentMetadata: unknown,
  payload: {
    deploymentId?: string;
    action: 'deploy' | 'redeploy' | 'rollback';
  }
) {
  if (!orchestratorSessionId) return;
  const metadata = pickRecord(environmentMetadata);
  const railway = pickRecord(metadata.railway);
  await setSandboxMetadata(orchestratorSessionId, {
    railway: {
      ...railway,
      lastDeploymentId: payload.deploymentId || railway.lastDeploymentId || null,
      lastAction: payload.action,
      lastActionAt: new Date().toISOString(),
    },
  });
}

function getDeploymentErrorMessage(error: unknown) {
  const message = asText((error as { message?: unknown })?.message);
  if (!message) {
    return '触发部署失败';
  }
  if (
    message.includes('No GitHub installation found for repo') ||
    message.includes('not found or is not accessible') ||
    message.includes('unable to access')
  ) {
    return '平台部署供应链接入未完成，当前托管仓库尚未授权到部署服务';
  }
  return message;
}

type SessionListCache = {
  fetchedAt: number;
  limit: number;
  data: any[];
};

const sessionListCacheByUser = new Map<string, SessionListCache>();
const sessionListEmptyLogAtByUser = new Map<string, number>();

function logSessionListEmpty(input: {
  userId: string;
  source: 'db_summary' | 'memory_reconcile';
  ownedDbCount: number;
  memoryCount: number;
  refresh: boolean;
}) {
  const now = Date.now();
  const lastLoggedAt = sessionListEmptyLogAtByUser.get(input.userId) || 0;
  if (now - lastLoggedAt < 30000) {
    return;
  }
  sessionListEmptyLogAtByUser.set(input.userId, now);
  console.warn('[TASK_SESSION_LIST_EMPTY]', {
    userId: input.userId,
    source: input.source,
    ownedDbCount: input.ownedDbCount,
    memoryCount: input.memoryCount,
    refresh: input.refresh,
    loggedAt: new Date(now).toISOString(),
  });
}

function mapStageFromStatus(status: string | null | undefined) {
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  if (status === 'waiting_user') return 'clarifying';
  return 'executing';
}

async function buildSessionSummaryFromDb(limit: number, userId: string) {
  const sessions = await taskCreationSessionDAO.getRecentSessions(limit, userId);
  const result: any[] = [];
  for (const session of sessions) {
    let description: Awaited<ReturnType<typeof taskCreationSessionDAO.getTaskDescription>> | null = null;
    let messages: Awaited<ReturnType<typeof taskCreationSessionDAO.getMessages>> = [];
    try {
      [description, messages] = await Promise.all([
        taskCreationSessionDAO.getTaskDescription(session.id),
        taskCreationSessionDAO.getMessages(session.id),
      ]);
    } catch (error) {
      if (!isTransientDatabaseError(error)) {
        throw error;
      }
      console.warn('[TASK_SESSION_LIST_DB_PARTIAL]', { sessionId: session.id, error });
    }
    const firstUserMessage =
      messages?.find((message) => message.role === 'user' && asText(message.content))?.content || '';
    const title =
      description?.title ||
      (isExplicitSessionTitleInput(String(firstUserMessage))
        ? deriveResolvedSessionTitle(firstUserMessage)
        : '') ||
      `任务会话 ${String(session.id).slice(-6)}`;
    result.push({
      id: session.id,
      title: title.trim().slice(0, 80),
      status: session.status,
      stage: mapStageFromStatus(session.status),
      createdAt: toIso(session.createdAt as any),
      updatedAt: toIso(session.updatedAt as any),
      messages: [],
    });
  }
  return result;
}

async function createDraftTaskSession(title: string | undefined, userId: string) {
  const created = await taskCreationSessionDAO.createSession({
    id: randomUUID(),
    userId,
    status: 'in_progress',
  });
  await taskCreationFileMemoryStore.createSession(title || DEFAULT_SESSION_TITLE, created.id);
  await taskCreationFileMemoryStore.updateSessionStatus(created.id, 'in_progress');
  return created.id;
}

async function ensureOpencodeServer(orchestratorSessionId: string, workspaceRoot: string) {
  const enabledRaw = String(process.env.OPENCODE_SERVER_ENSURE_ON_READ || 'true').trim().toLowerCase();
  if (enabledRaw === 'false') return;
  try {
    await osacAgentService.ensureOpencodeServer(orchestratorSessionId, {
      workspacePath: workspaceRoot || undefined,
    });
  } catch (error) {
    console.warn('[OPENCODE_SERVER_ENSURE_FAILED]', orchestratorSessionId, error);
  }
}

async function syncTaskSessionSandboxBinding(
  sessionId: string,
  sandboxId: string,
  workspaceRoot: string | null | undefined
) {
  const normalizedSandboxId = asText(sandboxId);
  if (!normalizedSandboxId) return;
  const resolvedWorkspaceRoot = asText(workspaceRoot) || resolveOpencodeWorkspacePath(sessionId);
  await taskSessionRunDAO.upsertSandboxBinding({
    sessionId,
    sandboxId: normalizedSandboxId,
    workspaceRoot: resolvedWorkspaceRoot,
    status: 'ready',
    metadataJson: {
      provider: 'e2b',
    },
  });
}

function resolveRuntimeExecutor(
  session: Pick<FileSessionRecord, 'driver' | 'executor' | 'runtime' | 'mode'>
): 'opencode' | 'codex' | 'altus' {
  if (isAltusManagedSession(session)) {
    return 'altus';
  }
  const preferred =
    asText(session.runtime?.executor) ||
    asText(session.executor) ||
    asText(session.driver);
  return preferred === 'codex' ? 'codex' : 'opencode';
}

function isAltusManagedSession(session: Pick<FileSessionRecord, 'mode' | 'driver'>): boolean {
  return asText(session.mode) === 'altus' || asText(session.driver) === 'altus';
}

export async function ensureTaskSessionRuntime(sessionId: string) {
  const session = await resolveTaskSessionRecord(sessionId);
  if (!session) {
    throw new Error('会话不存在');
  }

  const executor = resolveRuntimeExecutor(session);
  const altusManaged = isAltusManagedSession(session);
  const workspaceRoot =
    asText(session.runtime?.workspaceRoot) ||
    resolveOpencodeWorkspacePath(sessionId);
  const orchestratorSessionId = asText(session.runtime?.orchestratorSessionId);
  writeConnectorDebugLog('[CONNECTOR_RUNTIME_ENSURE_START]', {
    taskSessionId: sessionId,
    executor,
    altusManaged,
    mode: asText(session.mode),
    driver: asText(session.driver),
    orchestratorSessionId: orchestratorSessionId || null,
  });
  if (orchestratorSessionId) {
    const environment = await sandboxExecutionEnvironmentDAO.getBySessionId(orchestratorSessionId);
    if (environment?.status === 'ready') {
      try {
        if (executor === 'opencode') {
          if (!altusManaged) {
            writeConnectorDebugLog('[CONNECTOR_RUNTIME_REUSE_SYNC_OPENCODE]', {
              taskSessionId: sessionId,
              orchestratorSessionId,
              altusManaged,
            });
            await sandboxAgentProvisionService.syncOpencodeRuntimeConfig({
              orchestratorSessionId,
              taskSessionId: sessionId,
            });
            await osacAgentService.ensureOpencodeServer(orchestratorSessionId, {
              workspacePath: workspaceRoot || undefined,
            });
          } else {
            writeConnectorDebugLog('[CONNECTOR_RUNTIME_REUSE_SKIP_OPENCODE_SYNC]', {
              taskSessionId: sessionId,
              orchestratorSessionId,
            });
          }
        } else {
          await sandboxAgentProvisionService.provisionWithLock({
            executor,
            metadata: {
              taskSessionId: sessionId,
              taskTitle: session.title,
              executor,
              altusMode: altusManaged ? 'managed' : undefined,
            },
          });
        }
        await syncTaskSessionSandboxBinding(sessionId, orchestratorSessionId, workspaceRoot);
        await touchSandbox(orchestratorSessionId, 'runtime_start_reuse');
        await reconcileTaskSessionDuplicateEnvironments(sessionId, orchestratorSessionId);
        const runtimeStatus = await resolveRuntimeStatus(orchestratorSessionId);
        writeConnectorDebugLog('[CONNECTOR_RUNTIME_ENSURE_REUSED]', {
          taskSessionId: sessionId,
          orchestratorSessionId,
          executor,
          altusManaged,
          runtimeStatus: runtimeStatus?.status || 'ready',
        });
        return {
          orchestratorSessionId,
          status: runtimeStatus?.status || 'ready',
          reused: true,
        };
      } catch (error) {
        writeConnectorDebugLog('[CONNECTOR_RUNTIME_ENSURE_REUSE_FAILED]', {
          taskSessionId: sessionId,
          orchestratorSessionId,
          executor,
          altusManaged,
          error: error instanceof Error ? error.message : String(error),
        }, 'error');
        if (!isSandboxNotFoundError(error)) {
          throw error;
        }
        await markSandboxClosed(orchestratorSessionId);
      }
    }
  }

  const provision = await sandboxAgentProvisionService.provisionWithLock({
    executor,
    metadata: {
      taskSessionId: sessionId,
      taskTitle: session.title,
      executor,
      altusMode: altusManaged ? 'managed' : undefined,
    },
  });

  await taskCreationFileMemoryStore.updateRuntimeBinding(sessionId, {
    orchestratorSessionId: provision.sessionId,
    executor,
    workspaceRoot,
    executorSessionId: executor === 'codex' ? session.runtime?.executorSessionId || undefined : '',
    opencodeSessionId: executor === 'opencode' ? '' : undefined,
    previousExecutorSessionId:
      executor === 'codex' ? session.runtime?.executorSessionId || undefined : undefined,
  });
  await syncTaskSessionSandboxBinding(sessionId, provision.sessionId, workspaceRoot);
  await taskCreationCacheStore.invalidateWorkspaceBySession(sessionId);
  await taskSessionCacheFacade.invalidateWorkspaceBySessionId(sessionId);
  await touchSandbox(provision.sessionId, 'runtime_start_new');
  await reconcileTaskSessionDuplicateEnvironments(sessionId, provision.sessionId);

  const runtimeStatus = await resolveRuntimeStatus(provision.sessionId);
  writeConnectorDebugLog('[CONNECTOR_RUNTIME_ENSURE_PROVISIONED]', {
    taskSessionId: sessionId,
    orchestratorSessionId: provision.sessionId,
    executor,
    altusManaged,
    runtimeStatus: runtimeStatus?.status || provision.status || 'ready',
  });

  return {
    orchestratorSessionId: provision.sessionId,
    status: runtimeStatus?.status || provision.status || 'ready',
    reused: false,
  };
}

async function fetchOpencodeJsonViaOsac<T>(
  orchestratorSessionId: string,
  workspaceRoot: string,
  path: string,
  query: Record<string, string>
): Promise<T> {
  const response = await osacAgentService.opencodeHttpRequest(orchestratorSessionId, {
    method: 'GET',
    path,
    query: {
      ...query,
      directory: workspaceRoot,
    },
    workspacePath: workspaceRoot,
  });

  const status = Number(response.status || 0);
  const body = typeof response.body === 'string' ? response.body : '';
  if (!Number.isFinite(status) || status <= 0) {
    throw new Error('opencode response invalid');
  }
  if (status < 200 || status >= 300) {
    throw new Error(`opencode request failed: ${status} ${body || 'unknown error'}`);
  }
  if (!body) {
    throw new Error('opencode response empty');
  }
  try {
    return JSON.parse(body) as T;
  } catch (error: any) {
    throw new Error(`opencode response parse error: ${error?.message || error}`);
  }
}

type OpencodeFileNode = {
  path: string;
  type: 'file' | 'directory';
  ignored?: boolean;
};

type OpencodeFileContent = {
  type: 'text' | 'binary';
  content: string;
  encoding?: string;
  mimeType?: string;
};

type WorkspacePreviewType =
  | 'text'
  | 'markdown'
  | 'html'
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'binary';

async function listOpencodeDirectory(
  orchestratorSessionId: string,
  workspaceRoot: string,
  dir: string
): Promise<OpencodeFileNode[]> {
  const data = await fetchOpencodeJsonViaOsac<OpencodeFileNode[]>(
    orchestratorSessionId,
    workspaceRoot,
    '/file',
    {
      path: dir,
    }
  );
  if (!Array.isArray(data)) {
    throw new Error('opencode file list invalid');
  }
  return data;
}

async function readOpencodeFile(
  orchestratorSessionId: string,
  workspaceRoot: string,
  filePath: string
): Promise<OpencodeFileContent> {
  const data = await fetchOpencodeJsonViaOsac<OpencodeFileContent>(
    orchestratorSessionId,
    workspaceRoot,
    '/file/content',
    {
      path: filePath,
    }
  );
  if (!data || typeof data !== 'object') {
    throw new Error('opencode file content invalid');
  }
  return data;
}

type SandboxWorkspaceNode = {
  path: string;
  type: 'file' | 'directory';
  ignored?: boolean;
};

type WorkspaceDirectoryCachePayload = {
  root: string;
  path: string;
  items: Array<{ path: string; type: 'file' | 'dir' }>;
  cursor: number;
  total: number;
  returned: number;
  limit: number;
  hasMore: boolean;
  nextCursor: number | null;
};

function asWorkspaceDirectoryCachePayload(value: unknown): WorkspaceDirectoryCachePayload | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const rawItems = Array.isArray(record.items) ? record.items : [];
  const items = rawItems
    .map((item) => (item && typeof item === 'object' ? (item as Record<string, unknown>) : null))
    .filter(Boolean)
    .map((item) => {
      const path = normalizeWorkspacePath(String(item!.path || ''));
      const type = String(item!.type || '').toLowerCase() === 'dir' ? ('dir' as const) : ('file' as const);
      return { path, type };
    })
    .filter((item) => Boolean(item.path));

  return {
    root: typeof record.root === 'string' ? record.root : '',
    path: typeof record.path === 'string' ? record.path : '',
    items,
    cursor: Number.isFinite(Number(record.cursor)) ? Number(record.cursor) : 0,
    total: Number.isFinite(Number(record.total)) ? Number(record.total) : items.length,
    returned: Number.isFinite(Number(record.returned)) ? Number(record.returned) : items.length,
    limit: Number.isFinite(Number(record.limit)) ? Number(record.limit) : items.length,
    hasMore: Boolean(record.hasMore),
    nextCursor:
      record.nextCursor === null || record.nextCursor === undefined
        ? null
        : Number.isFinite(Number(record.nextCursor))
          ? Number(record.nextCursor)
          : null,
  };
}

function buildWorkspaceDirCacheKey(input: {
  path: string;
  cursor: number;
  limit: number;
  includeIgnored: boolean;
}) {
  return JSON.stringify({
    path: normalizeWorkspacePath(input.path),
    cursor: input.cursor,
    limit: input.limit,
    includeIgnored: input.includeIgnored,
  });
}

function resolveWorkspaceExecutor(session?: FileSessionRecord | null): string {
  return String(session?.runtime?.executor || session?.driver || '').trim().toLowerCase();
}

function isE2bWorkspaceExecutor(executor: string): boolean {
  return executor === 'codex' || executor === 'altus';
}

function resolveWorkspaceAbsolutePath(workspaceRoot: string, relativePath: string): string {
  const root = workspaceRoot.replace(/\/+$/, '');
  const normalized = normalizeWorkspacePath(relativePath);
  return normalized ? `${root}/${normalized}` : root;
}

async function listSandboxDirectory(
  orchestratorSessionId: string,
  workspaceRoot: string,
  dir: string
): Promise<SandboxWorkspaceNode[]> {
  const result: any = await e2bConnector.runCommand(
    orchestratorSessionId,
    `python3 - <<'PY'
import json
import os
import sys
from pathlib import Path

root = Path(os.environ["ONECEO_WORKSPACE_ROOT"]).resolve()
rel = os.environ.get("ONECEO_DIR_PATH", "").strip()
target = (root / rel).resolve() if rel else root

if not str(target).startswith(str(root)):
    print("workspace path escape", file=sys.stderr)
    sys.exit(2)

if not target.exists():
    print("directory not found", file=sys.stderr)
    sys.exit(3)

if not target.is_dir():
    print("not a directory", file=sys.stderr)
    sys.exit(4)

items = []
for child in sorted(target.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
    rel_path = child.relative_to(root).as_posix()
    items.append({
        "path": rel_path,
        "type": "directory" if child.is_dir() else "file",
    })

print(json.dumps(items, ensure_ascii=False))
PY`,
    {
      timeoutMs: 20_000,
      envs: {
        ONECEO_WORKSPACE_ROOT: workspaceRoot,
        ONECEO_DIR_PATH: normalizeWorkspacePath(dir),
      },
    }
  );

  const stdout = String(result?.stdout || result?.output || '').trim();
  if (!stdout) {
    throw new Error('sandbox directory list empty');
  }
  const parsed = JSON.parse(stdout);
  if (!Array.isArray(parsed)) {
    throw new Error('sandbox directory list invalid');
  }
  return parsed as SandboxWorkspaceNode[];
}

async function buildWorkspaceTreeFromSandbox(input: {
  orchestratorSessionId: string;
  workspaceRoot: string;
  maxDepth: number;
  maxEntries: number;
}) {
  const items: Array<{ path: string; type: 'file' | 'dir' }> = [];
  const queue: Array<{ path: string; depth: number }> = [{ path: '', depth: 0 }];
  const seenDirs = new Set<string>();

  while (queue.length > 0 && items.length < input.maxEntries) {
    const current = queue.shift()!;
    const nodes = await listSandboxDirectory(
      input.orchestratorSessionId,
      input.workspaceRoot,
      current.path
    );
    for (const node of nodes) {
      const normalizedPath = normalizeWorkspacePath(node.path);
      if (!normalizedPath) continue;
      const type = node.type === 'directory' ? 'dir' : 'file';
      if (type === 'dir' && current.depth >= input.maxDepth) {
        continue;
      }
      items.push({ path: normalizedPath, type });
      if (items.length >= input.maxEntries) break;
      if (type === 'dir' && current.depth + 1 <= input.maxDepth && !seenDirs.has(normalizedPath)) {
        seenDirs.add(normalizedPath);
        queue.push({ path: normalizedPath, depth: current.depth + 1 });
      }
    }
  }

  return {
    root: input.workspaceRoot,
    items,
  };
}

function normalizeHistoricalPath(value: unknown, workspaceRoot: string): string {
  const normalized = resolveWorkspaceRelativeRequestPath(
    typeof value === 'string' ? value : '',
    workspaceRoot
  );
  if (!normalized || normalized === '.') return '';
  return normalized;
}

function buildHistoricalWorkspaceItems(
  messages: Array<{ metadata?: unknown }>,
  workspaceRoot: string
): Array<{ path: string; type: 'file' | 'dir' }> {
  const filePaths = new Set<string>();
  const dirPaths = new Set<string>();

  for (const message of messages) {
    const metadata = message && typeof message === 'object' ? ((message as any).metadata as Record<string, unknown>) : {};
    if (!metadata || typeof metadata !== 'object') continue;

    const candidates: string[] = [];
    const rawFilePaths = Array.isArray(metadata.filePaths) ? metadata.filePaths : [];
    for (const raw of rawFilePaths) {
      const path = normalizeHistoricalPath(raw, workspaceRoot);
      if (path) candidates.push(path);
    }
    const rawFileChanges = Array.isArray(metadata.fileChanges) ? metadata.fileChanges : [];
    for (const raw of rawFileChanges) {
      if (!raw || typeof raw !== 'object') continue;
      const path = normalizeHistoricalPath((raw as Record<string, unknown>).path, workspaceRoot);
      if (path) candidates.push(path);
    }
    for (const key of ['path', 'targetPath']) {
      const path = normalizeHistoricalPath(metadata[key], workspaceRoot);
      if (path) candidates.push(path);
    }

    for (const candidate of candidates) {
      const segments = candidate.split('/').filter(Boolean);
      if (segments.length === 0) continue;
      const looksLikeDir =
        String((metadata.itemType || metadata.partType || '')).toLowerCase() === 'directory' ||
        candidate.endsWith('/');
      if (looksLikeDir) {
        dirPaths.add(candidate.replace(/\/+$/, ''));
      } else {
        filePaths.add(candidate);
        let parent = '';
        for (let i = 0; i < segments.length - 1; i += 1) {
          parent = parent ? `${parent}/${segments[i]}` : segments[i]!;
          dirPaths.add(parent);
        }
      }
    }
  }

  const items: Array<{ path: string; type: 'file' | 'dir' }> = [];
  for (const dir of dirPaths) {
    items.push({ path: dir, type: 'dir' });
  }
  for (const file of filePaths) {
    items.push({ path: file, type: 'file' });
  }
  return sortWorkspaceTreeItems(items);
}

async function buildWorkspaceFallbackFromMessageHistory(input: {
  sessionId: string;
  workspaceRoot: string;
  path: string;
  cursor: number;
  limit: number;
}): Promise<WorkspaceDirectoryCachePayload | null> {
  const recent = await taskCreationSessionDAO.getRecentMessages(input.sessionId, 50);
  const recentItems = buildHistoricalWorkspaceItems(
    recent as Array<{ metadata?: unknown }>,
    input.workspaceRoot
  );
  const allItems =
    recentItems.length > 0
      ? recentItems
      : buildHistoricalWorkspaceItems(
          (await taskCreationSessionDAO.getMessages(input.sessionId)) as Array<{ metadata?: unknown }>,
          input.workspaceRoot
        );
  if (allItems.length === 0) {
    return null;
  }
  const prefix = input.path ? `${input.path}/` : '';
  const filtered = allItems.filter((item) => {
    if (!input.path) {
      return !item.path.includes('/');
    }
    if (!item.path.startsWith(prefix)) return false;
    const rest = item.path.slice(prefix.length);
    return rest.length > 0 && !rest.includes('/');
  });
  const start = Math.min(Math.max(0, input.cursor), filtered.length);
  const end = Math.min(filtered.length, start + input.limit);
  const pageItems = filtered.slice(start, end);
  return {
    root: input.workspaceRoot,
    path: input.path,
    items: pageItems,
    cursor: start,
    total: filtered.length,
    returned: pageItems.length,
    limit: input.limit,
    hasMore: end < filtered.length,
    nextCursor: end < filtered.length ? end : null,
  };
}

function normalizeWorkspacePath(input: string): string {
  return input.replace(/\\/g, '/').replace(/^\/+/, '');
}

function normalizeWorkspaceRootPath(input: string): string {
  return String(input || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
}

function resolveWorkspaceRelativeRequestPath(
  input: string,
  workspaceRoot: string,
  options?: { allowWorkspaceRoot?: boolean }
): string | null {
  const raw = String(input || '').trim().replace(/\\/g, '/');
  if (!raw) return null;
  const allowWorkspaceRoot = Boolean(options?.allowWorkspaceRoot);
  const normalizedRoot = normalizeWorkspaceRootPath(workspaceRoot);
  const rootWithoutLeadingSlash = normalizedRoot.replace(/^\/+/, '');
  const parentRootWithoutLeadingSlash = rootWithoutLeadingSlash.includes('/')
    ? rootWithoutLeadingSlash.slice(0, rootWithoutLeadingSlash.lastIndexOf('/'))
    : '';

  let candidate = raw;
  if (candidate.startsWith('/') || candidate.startsWith('\\')) {
    if (!normalizedRoot) return null;
    if (candidate === normalizedRoot) {
      candidate = '';
    } else if (candidate.startsWith(`${normalizedRoot}/`)) {
      candidate = candidate.slice(normalizedRoot.length + 1);
    } else {
      return null;
    }
  } else if (rootWithoutLeadingSlash) {
    if (candidate === rootWithoutLeadingSlash) {
      candidate = '';
    } else if (candidate.startsWith(`${rootWithoutLeadingSlash}/`)) {
      candidate = candidate.slice(rootWithoutLeadingSlash.length + 1);
    } else if (
      parentRootWithoutLeadingSlash &&
      candidate.startsWith(`${parentRootWithoutLeadingSlash}/`)
    ) {
      return null;
    }
  }

  const normalized = normalizeWorkspacePath(candidate.replace(/^\.\/+/, ''));
  if (!normalized) {
    return allowWorkspaceRoot ? '' : null;
  }
  if (isUnsafePath(normalized)) {
    return null;
  }
  return normalized;
}

function shellEscape(value: string): string {
  if (!value) return "''";
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function parseRemoteAttachmentProvider(value: unknown): RemoteAttachmentProvider {
  const normalized = asText(value);
  if (
    normalized === 'website' ||
    normalized === 'google-drive' ||
    normalized === 'onedrive'
  ) {
    return normalized;
  }
  throw new Error('不支持的远程来源');
}

function shouldAllowPrivateRemoteAttachmentHosts() {
  if (process.env.ALLOW_PRIVATE_REMOTE_ATTACHMENTS === '1') {
    return true;
  }
  return process.env.NODE_ENV !== 'production';
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeSessionTitleText(value: unknown): string {
  return asText(value).replace(/\s+/g, ' ').trim();
}

function toComparableTitleText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[，。、“”"'!！?？,.；;:：()\[\]{}<>《》【】\-_`~]/g, '')
    .replace(/\s+/g, '');
}

function isWeakIntentTitleInput(value: string): boolean {
  const comparable = toComparableTitleText(value);
  if (!comparable) return true;
  if (WEAK_INTENT_TITLE_INPUTS.has(comparable)) return true;
  if (comparable.length <= 2) return true;
  return false;
}

function isExplicitSessionTitleInput(value: string): boolean {
  const normalized = normalizeSessionTitleText(value);
  if (!normalized) return false;
  if (isWeakIntentTitleInput(normalized)) return false;
  if (normalized.length >= 12) return true;
  return /(帮我|请|请帮|分析|排查|修复|开发|实现|优化|重构|设计|生成|创建|制作|写|继续|修改|整理|总结|如何|怎么|为什么|报错|bug|问题|页面|功能|css|html|nodejs|代码|接口|数据库|deploy|build|fix|debug|analy[sz]e|implement|optimi[sz]e|refactor|create|write)/i.test(
    normalized
  );
}

function deriveResolvedSessionTitle(value: unknown): string {
  return normalizeSessionTitleText(value).slice(0, 80);
}

function asPositiveInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }
  return null;
}

function asTimelineCursor(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === 'string') {
    const raw = value.trim();
    if (!raw) return null;
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
    const parsedDate = Date.parse(raw);
    if (Number.isFinite(parsedDate) && parsedDate > 0) {
      return Math.floor(parsedDate);
    }
  }
  return null;
}

function resolveMessageTimelineCursor(message: any): number {
  const metadata = pickRecord(message?.metadata);
  const sessionEventSeq = asPositiveInt(metadata.sessionEventSeq);
  if (sessionEventSeq !== null) return sessionEventSeq;

  const metadataTimestamp = asTimelineCursor(metadata.timestamp);
  if (metadataTimestamp !== null) return metadataTimestamp;

  const createdAtTs = asTimelineCursor(message?.createdAt);
  if (createdAtTs !== null) return createdAtTs;
  return 0;
}

function normalizeMessageTimelineMetadata(
  metadataRaw: unknown,
  createdAt: unknown,
  seed: number
): Record<string, unknown> {
  const metadata = { ...pickRecord(metadataRaw) };
  const timestamp =
    asTimelineCursor(metadata.timestamp) ??
    asTimelineCursor(createdAt) ??
    Date.now();
  metadata.timestamp = timestamp;

  const existingSeq = asPositiveInt(metadata.sessionEventSeq);
  if (existingSeq !== null) {
    metadata.sessionEventSeq = existingSeq;
    return metadata;
  }

  const tail = Math.abs(seed || 0) % 1000;
  const candidate = timestamp * 1000 + tail;
  metadata.sessionEventSeq =
    Number.isSafeInteger(candidate) && candidate > 0 ? candidate : timestamp;
  return metadata;
}

function sanitizeTimelineMetadataForClient(metadataRaw: unknown): Record<string, unknown> {
  const metadata = pickRecord(metadataRaw);
  const slim: Record<string, unknown> = {};

  for (const key of [
    'messageKey',
    'timestamp',
    'sessionEventSeq',
    'timelineCursor',
    'runtimeGeneration',
    'runtimeGenerationBoundary',
    'orchestratorSessionId',
    'opencodeSessionId',
    'workspacePath',
    'stage',
    'tone',
    'runId',
    'sessionId',
    'executionMode',
    'deliverables',
    'verification',
    'streamKey',
    'partId',
    'eventType',
    'executor',
    'toolCallId',
    'arguments',
    'error',
    'itemId',
    'itemType',
    'itemStatus',
    'itemText',
    'command',
    'outputPreview',
    'exitCode',
    'fileChanges',
    'filePaths',
    'commandCategory',
    'targetPath',
    'approvalText',
    'approvalOptions',
    'codexRestoreStatus',
    'codexRestoreAt',
    'codexRestoreSourceKey',
    'previousExecutorSessionId',
    'codexRestoreFailureReason',
    'originalInput',
    'skills',
    'managedSkillContext',
    'managedSkillCatalog',
    'attachments',
    'attachmentContext',
    'mcpReferences',
  ]) {
    if (metadata[key] !== undefined) {
      slim[key] = metadata[key];
    }
  }

  const eventFromMeta = pickRecord(metadata.event);
  const rawPayload = pickRecord(metadata.rawPayload);
  const eventFromPayload = pickRecord(rawPayload.event);
  const event = Object.keys(eventFromMeta).length > 0 ? eventFromMeta : eventFromPayload;
  const properties = pickRecord(event.properties);
  const part = pickRecord(properties.part);

  const toolName =
    asText(metadata.toolName) ||
    asText(part.tool) ||
    asText(part.name) ||
    asText(properties.tool) ||
    asText(properties.name);
  if (toolName) {
    slim.toolName = toolName;
  }

  const partType = asText(metadata.partType) || asText(part.type);
  if (partType) {
    slim.partType = partType;
  }

  const eventRole = asText(metadata.eventRole) || asText(part.role);
  if (eventRole) {
    slim.eventRole = eventRole;
  }

  const eventState =
    asText(metadata.eventState) ||
    asText(pickRecord(properties.state).state) ||
    asText(properties.state) ||
    asText(properties.status);
  if (eventState) {
    slim.eventState = eventState;
  }

  const resolvedPartId =
    asText(slim.partId) ||
    asText(part.id) ||
    asText(part.callID) ||
    asText(properties.partId) ||
    asText(properties.callID);
  if (resolvedPartId) {
    slim.partId = resolvedPartId;
  }

  if (Object.keys(event).length > 0) {
    const slimProps: Record<string, unknown> = {};
    const slimPart: Record<string, unknown> = {};
    for (const key of ['id', 'callID', 'type', 'role', 'tool', 'name']) {
      const value = asText(part[key]);
      if (value) {
        slimPart[key] = value;
      }
    }
    if (Object.keys(slimPart).length > 0) {
      slimProps.part = slimPart;
    }
    for (const key of ['tool', 'name', 'partId', 'callID', 'status']) {
      const value = asText(properties[key]);
      if (value) {
        slimProps[key] = value;
      }
    }
    if (eventState) {
      slimProps.state = { state: eventState };
    }
    if (Object.keys(slimProps).length > 0) {
      slim.event = { properties: slimProps };
    }
  }

  return slim;
}

function hasUserReferenceMetadata(metadataRaw: unknown): boolean {
  const metadata = pickRecord(metadataRaw);
  if (asText(metadata.originalInput)) return true;
  if (Array.isArray(metadata.skills) && metadata.skills.length > 0) return true;
  if (Array.isArray(metadata.managedSkillContext) && metadata.managedSkillContext.length > 0) return true;
  if (Array.isArray(metadata.attachments) && metadata.attachments.length > 0) return true;
  if (Array.isArray(metadata.attachmentContext) && metadata.attachmentContext.length > 0) return true;
  if (Array.isArray(metadata.mcpReferences) && metadata.mcpReferences.length > 0) return true;
  return false;
}

function normalizeUserReferenceText(contentRaw: unknown, metadataRaw: unknown): string {
  const metadata = pickRecord(metadataRaw);
  const base = asText(metadata.originalInput) || asText(contentRaw);
  if (!base) return '';
  return base
    .replace(/\r\n?/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function mergeUserReferenceMetadataFromPersisted(
  primaryMessages: TimelineMessage[],
  persistedMessages: TimelineMessage[]
): TimelineMessage[] {
  if (!Array.isArray(primaryMessages) || primaryMessages.length === 0) {
    return primaryMessages;
  }
  if (!Array.isArray(persistedMessages) || persistedMessages.length === 0) {
    return primaryMessages;
  }

  const referenceQueueByText = new Map<string, Array<Record<string, unknown>>>();
  for (const message of persistedMessages) {
    if (message?.role !== 'user') continue;
    if (!hasUserReferenceMetadata(message?.metadata)) continue;
    const key = normalizeUserReferenceText(message?.content, message?.metadata);
    if (!key) continue;
    const queue = referenceQueueByText.get(key) || [];
    queue.push(pickRecord(message?.metadata));
    referenceQueueByText.set(key, queue);
  }

  if (referenceQueueByText.size === 0) {
    return primaryMessages;
  }

  return primaryMessages.map((message) => {
    if (message?.role !== 'user') return message;
    if (hasUserReferenceMetadata(message?.metadata)) return message;
    const key = normalizeUserReferenceText(message?.content, message?.metadata);
    if (!key) return message;
    const queue = referenceQueueByText.get(key);
    if (!queue || queue.length === 0) return message;
    const mergedSource = queue.shift();
    if (!mergedSource) return message;
    return {
      ...message,
      metadata: {
        ...pickRecord(message.metadata),
        ...mergedSource,
      },
    };
  });
}

function normalizeRuntimeGenerationValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }
  return null;
}

function resolveOpencodePartId(metadataRaw: unknown): string {
  const metadata = pickRecord(metadataRaw);
  const explicit =
    asText(metadata.partId) ||
    asText(metadata.streamKey);
  if (explicit) {
    return explicit;
  }
  const rawPayload = pickRecord(metadata.rawPayload);
  const eventFromMeta = pickRecord(metadata.event);
  const eventFromPayload = pickRecord(rawPayload.event);
  const event = Object.keys(eventFromMeta).length > 0 ? eventFromMeta : eventFromPayload;
  const properties = pickRecord(event.properties);
  const part = pickRecord(properties.part);
  return (
    asText(part.id) ||
    asText(part.callID) ||
    asText(properties.partId) ||
    asText(properties.callID)
  );
}

function buildTimelineMessageKey(input: {
  id?: string | number | null;
  messageType?: string | null;
  metadata?: unknown;
  createdAt?: unknown;
}): string {
  const metadata = pickRecord(input.metadata);
  const explicit = asText(metadata.messageKey);
  if (explicit) {
    return explicit;
  }

  const messageType = asText(input.messageType) || 'message';
  const runtimeGeneration = normalizeRuntimeGenerationValue(metadata.runtimeGeneration);
  const generationSegment = runtimeGeneration ?? 'na';
  const sessionEventSeq = asPositiveInt(metadata.sessionEventSeq);
  const timelineCursor =
    sessionEventSeq ??
    asTimelineCursor(metadata.timestamp) ??
    asTimelineCursor(input.createdAt) ??
    0;

  if (metadata.runtimeGenerationBoundary === true) {
    return `boundary:${generationSegment}:${timelineCursor || 'na'}`;
  }

  const opencodeSessionId = asText(metadata.opencodeSessionId);
  const partId = resolveOpencodePartId(metadata);
  if (opencodeSessionId && partId) {
    return `stream:${generationSegment}:${opencodeSessionId}:${partId}`;
  }

  if (sessionEventSeq !== null) {
    return `runtime:${generationSegment}:${sessionEventSeq}:${messageType}`;
  }

  const id = input.id !== undefined && input.id !== null ? String(input.id).trim() : '';
  if (id) {
    return id.startsWith('db:') || id.startsWith('boundary:') || id.startsWith('stream:') || id.startsWith('runtime:')
      ? id
      : `db:${id}`;
  }

  return `runtime:${generationSegment}:${timelineCursor || 'na'}:${messageType}`;
}

function annotateRuntimeGenerations<T extends { metadata?: Record<string, unknown>; createdAt?: string }>(
  messages: T[],
  runtime?: { generation?: number; orchestratorSessionId?: string | null } | null
): T[] {
  if (!Array.isArray(messages) || messages.length === 0) return [];

  const sorted = [...messages].sort((a, b) => resolveMessageTimelineCursor(a) - resolveMessageTimelineCursor(b));
  const distinctOrchestrators: string[] = [];
  const seenOrchestrators = new Set<string>();
  for (const item of sorted) {
    const orchestratorId = asText(pickRecord(item?.metadata).orchestratorSessionId);
    if (!orchestratorId || seenOrchestrators.has(orchestratorId)) continue;
    seenOrchestrators.add(orchestratorId);
    distinctOrchestrators.push(orchestratorId);
  }

  const generationByOrchestrator = new Map<string, number>();
  for (const item of sorted) {
    const metadata = pickRecord(item?.metadata);
    const explicitGeneration = normalizeRuntimeGenerationValue(metadata.runtimeGeneration);
    const orchestratorId = asText(metadata.orchestratorSessionId);
    if (explicitGeneration !== null && orchestratorId) {
      generationByOrchestrator.set(orchestratorId, explicitGeneration);
    }
  }

  const currentGeneration = normalizeRuntimeGenerationValue(runtime?.generation);
  const currentOrchestrator = asText(runtime?.orchestratorSessionId);
  if (
    currentGeneration !== null &&
    currentOrchestrator &&
    distinctOrchestrators.includes(currentOrchestrator)
  ) {
    const currentIndex = distinctOrchestrators.indexOf(currentOrchestrator);
    const startGeneration = Math.max(1, currentGeneration - currentIndex);
    distinctOrchestrators.forEach((orchestratorId, index) => {
      if (!generationByOrchestrator.has(orchestratorId)) {
        generationByOrchestrator.set(orchestratorId, startGeneration + index);
      }
    });
  }

  let nextGeneration = Math.max(
    0,
    ...Array.from(generationByOrchestrator.values()).filter((value) => Number.isFinite(value) && value > 0)
  );
  for (const orchestratorId of distinctOrchestrators) {
    if (generationByOrchestrator.has(orchestratorId)) continue;
    nextGeneration += 1;
    generationByOrchestrator.set(orchestratorId, nextGeneration);
  }

  let lastKnownGeneration = currentGeneration || 1;
  return sorted.map((item) => {
    const metadata = normalizeMessageTimelineMetadata(item?.metadata, item?.createdAt, 0);
    const explicitGeneration = normalizeRuntimeGenerationValue(metadata.runtimeGeneration);
    const orchestratorId = asText(metadata.orchestratorSessionId);
    const runtimeGeneration =
      explicitGeneration ??
      (orchestratorId ? generationByOrchestrator.get(orchestratorId) || null : null) ??
      lastKnownGeneration;
    if (runtimeGeneration) {
      metadata.runtimeGeneration = runtimeGeneration;
      lastKnownGeneration = runtimeGeneration;
    }
    return {
      ...item,
      metadata,
    };
  });
}

function inferRuntimeFromMessages(
  messages: Array<{ metadata?: Record<string, unknown>; createdAt?: string; messageType?: string }>,
  orchestratorSessionId?: string | null
): {
  generation?: number;
  executor?: string;
  transport?: string;
  executorSessionId?: string;
  opencodeSessionId?: string;
  codexRestoreStatus?: string;
  codexRestoreAt?: string;
  codexRestoreSourceKey?: string;
  previousExecutorSessionId?: string;
  codexRestoreFailureReason?: string;
} {
  const targetOrchestrator = asText(orchestratorSessionId);
  const ordered = annotateRuntimeGenerations(messages);
  const matched = ordered.filter((item) => {
    if (!targetOrchestrator) return true;
    return asText(pickRecord(item?.metadata).orchestratorSessionId) === targetOrchestrator;
  });
  const latest = matched.length > 0 ? matched[matched.length - 1] : null;
  if (!latest) return {};
  const metadata = pickRecord(latest.metadata);
  const legacySessionId = asText(metadata.opencodeSessionId);
  const rawExecutorSessionId = asText(metadata.executorSessionId) || legacySessionId;
  const messageType = asText(latest.messageType);
  const inferredExecutor =
    asText(metadata.executor) ||
    (messageType.startsWith('codex_') ? 'codex' : '') ||
    (rawExecutorSessionId ? 'opencode' : '');
  const transport = asText(metadata.transport) || undefined;
  const opencodeSessionId = legacySessionId || rawExecutorSessionId || undefined;
  const executorSessionId = rawExecutorSessionId || undefined;
  const executor = inferredExecutor;
  return {
    generation: normalizeRuntimeGenerationValue(metadata.runtimeGeneration) || undefined,
    executor: executor || undefined,
    transport,
    executorSessionId,
    opencodeSessionId,
    codexRestoreStatus: asText(metadata.codexRestoreStatus) || undefined,
    codexRestoreAt: asText(metadata.codexRestoreAt) || undefined,
    codexRestoreSourceKey: asText(metadata.codexRestoreSourceKey) || undefined,
    previousExecutorSessionId: asText(metadata.previousExecutorSessionId) || undefined,
    codexRestoreFailureReason: asText(metadata.codexRestoreFailureReason) || undefined,
  };
}

function mergeCodexRuntimeMetadata(
  runtime: {
    generation?: number;
    executor?: string;
    transport?: string;
    executorSessionId?: string;
    opencodeSessionId?: string;
    codexRestoreStatus?: string;
    codexRestoreAt?: string;
    codexRestoreSourceKey?: string;
    previousExecutorSessionId?: string;
    codexRestoreFailureReason?: string;
  },
  environmentMetadata?: Record<string, unknown> | null
) {
  const metadata = pickRecord(environmentMetadata);
  return {
    ...runtime,
    transport: asText(metadata.transport) || runtime.transport,
    codexRestoreStatus: asText(metadata.codexRestoreStatus) || runtime.codexRestoreStatus,
    codexRestoreAt: asText(metadata.codexRestoreAt) || runtime.codexRestoreAt,
    codexRestoreSourceKey: asText(metadata.codexRestoreSourceKey) || runtime.codexRestoreSourceKey,
    previousExecutorSessionId: asText(metadata.previousExecutorSessionId) || runtime.previousExecutorSessionId,
    codexRestoreFailureReason:
      asText(metadata.codexRestoreFailureReason) || runtime.codexRestoreFailureReason,
  };
}

function injectRuntimeGenerationBoundaries<
  T extends {
    id?: string;
    messageKey?: string;
    role?: string;
    messageType?: string;
    content?: string;
    metadata?: Record<string, unknown>;
    createdAt?: string;
  },
>(messages: T[]): T[] {
  if (!Array.isArray(messages) || messages.length === 0) return [];

  const allGenerations = Array.from(
    new Set(
      messages
        .map((item) => normalizeRuntimeGenerationValue(pickRecord(item?.metadata).runtimeGeneration))
        .filter((value): value is number => value !== null)
    )
  );
  if (allGenerations.length <= 1) {
    return messages;
  }

  const result: T[] = [];
  let lastGeneration: number | null = null;
  for (const item of messages) {
    const metadata = pickRecord(item?.metadata);
    const runtimeGeneration = normalizeRuntimeGenerationValue(metadata.runtimeGeneration);
    if (runtimeGeneration !== null && lastGeneration !== null && runtimeGeneration !== lastGeneration) {
      const timelineCursor = resolveMessageTimelineCursor(item);
      result.push({
        id: `runtime-generation-boundary-${runtimeGeneration}-${timelineCursor || Date.now()}`,
        messageKey: `boundary:${runtimeGeneration}:${timelineCursor || Date.now()}`,
        role: 'system',
        messageType: 'status_update',
        content: `已切换到第 ${runtimeGeneration} 代执行环境，以下内容来自新的 sandbox 恢复。`,
        metadata: {
          messageKey: `boundary:${runtimeGeneration}:${timelineCursor || Date.now()}`,
          runtimeGeneration,
          runtimeGenerationBoundary: true,
          stage: 'executing',
          tone: 'system',
          timestamp: timelineCursor || Date.now(),
          sessionEventSeq:
            Number.isFinite(timelineCursor) && timelineCursor > 0 ? timelineCursor - 1 : Date.now() * 1000 - 1,
        },
        createdAt: item.createdAt,
      } as unknown as T);
    }
    if (runtimeGeneration !== null) {
      lastGeneration = runtimeGeneration;
    }
    result.push(item);
  }
  return result;
}

type TimelineMessage = {
  id: string;
  messageKey: string;
  role: 'user' | 'agent' | 'system';
  messageType: string;
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

function mapStoredMessagesToTimeline(
  messages: Array<{
    id: string | number;
    role?: string | null;
    messageType?: string | null;
    content?: string | null;
    metadata?: unknown;
    createdAt?: unknown;
  }>
): TimelineMessage[] {
  return Array.isArray(messages)
    ? messages.map((message, idx) => {
        const sanitizedMetadata = sanitizeTimelineMetadataForClient(message.metadata);
        const normalizedMetadata = normalizeMessageTimelineMetadata(
          sanitizedMetadata,
          message.createdAt,
          idx
        );
        const messageKey = buildTimelineMessageKey({
          id: message.id,
          messageType: message.messageType,
          metadata: sanitizedMetadata,
          createdAt: message.createdAt,
        });
        const timestamp = asTimelineCursor(normalizedMetadata.timestamp);
        const createdAt =
          timestamp !== null
            ? new Date(timestamp).toISOString()
            : toIso(message.createdAt as any);
        return {
          id: String(message.id),
          messageKey,
          role: (message.role as any) || 'agent',
          messageType: message.messageType || 'message',
          content: message.content || '',
          metadata: {
            ...normalizedMetadata,
            messageKey,
          },
          createdAt,
        };
      })
    : [];
}

function attachTimelineMessageKeys(
  messages: Array<{
    id: string;
    role: 'user' | 'agent' | 'system';
    messageType: string;
    content: string;
    metadata?: Record<string, unknown>;
    createdAt: string;
  }>
): TimelineMessage[] {
  return Array.isArray(messages)
    ? messages.map((message) => {
        const sanitizedMetadata = sanitizeTimelineMetadataForClient(message.metadata);
        const messageKey = buildTimelineMessageKey({
          id: message.id,
          messageType: message.messageType,
          metadata: sanitizedMetadata,
          createdAt: message.createdAt,
        });
        return {
          ...message,
          messageKey,
          metadata: {
            ...sanitizedMetadata,
            messageKey,
          },
        };
      })
    : [];
}

async function resolveRenderableTimelineMessages(
  sessionId: string,
  session?: any
): Promise<TimelineMessage[]> {
  const shouldPreferOpencodeNativeHistory =
    asText(session?.mode) === 'sandbox' &&
    (asText(session?.executor) === 'opencode' || asText(session?.runtime?.opencodeSessionId));
  const shouldPreferDatabaseTimelineForManaged =
    asText(session?.mode) === 'altus' ||
    asText(session?.executor) === 'altus' ||
    asText(session?.runtime?.executionMode) === 'managed' ||
    asText(session?.runtime?.executor) === 'altus';

  let fileStoreMessages: TimelineMessage[] | null = null;
  const loadFileStoreMessages = async () => {
    if (fileStoreMessages) return fileStoreMessages;
    fileStoreMessages = mapStoredMessagesToTimeline(await taskCreationFileMemoryStore.getMessages(sessionId));
    return fileStoreMessages;
  };

  let dbMessages: TimelineMessage[] | null = null;
  const loadDatabaseMessages = async () => {
    if (dbMessages) return dbMessages;
    dbMessages = mapStoredMessagesToTimeline(await taskCreationSessionDAO.getMessages(sessionId));
    return dbMessages;
  };

  const loadPrimaryTimelineMessages = async () => {
    if (!shouldPreferDatabaseTimelineForManaged) {
      return loadFileStoreMessages();
    }
    const primaryDbMessages = await loadDatabaseMessages();
    if (primaryDbMessages.length === 0) {
      return loadFileStoreMessages();
    }
    const fallbackFileMessages = await loadFileStoreMessages();
    return mergeUserReferenceMetadataFromPersisted(primaryDbMessages, fallbackFileMessages);
  };

  let messages: TimelineMessage[] | null = null;
  if (shouldPreferOpencodeNativeHistory) {
    const nativeMessages = await opencodeRemoteService.loadNativeMessageHistory(sessionId, {
      allowProvision: true,
    });
    const normalizedNativeMessages = nativeMessages ? attachTimelineMessageKeys(nativeMessages) : null;
    if (normalizedNativeMessages && normalizedNativeMessages.length > 0) {
      const fallbackMessages = await loadPrimaryTimelineMessages();
      const mergedNativeMessages = mergeUserReferenceMetadataFromPersisted(
        normalizedNativeMessages,
        fallbackMessages
      );
      if (hasRenderableAssistantReply(normalizedNativeMessages)) {
        messages = mergedNativeMessages;
      } else {
        messages = hasRenderableAssistantReply(fallbackMessages) ? fallbackMessages : mergedNativeMessages;
      }
    }
  }

  if (!messages || messages.length === 0) {
    messages = await loadPrimaryTimelineMessages();
  }
  if (!messages || messages.length === 0) {
    const fallback = await taskCreationSessionDAO.getMessages(sessionId);
    messages = mapStoredMessagesToTimeline(fallback);
  }

  messages = annotateRuntimeGenerations(messages, session?.runtime);
  messages = injectRuntimeGenerationBoundaries(messages);
  messages = filterLegacyTimelineNoise(messages);
  messages.sort((a, b) => {
    const ta = resolveMessageTimelineCursor(a);
    const tb = resolveMessageTimelineCursor(b);
    if (ta !== tb) return ta - tb;

    const sa = asPositiveInt(pickRecord(a?.metadata).sessionEventSeq) || 0;
    const sb = asPositiveInt(pickRecord(b?.metadata).sessionEventSeq) || 0;
    if (sa !== sb) return sa - sb;

    const ca = a?.createdAt ? Date.parse(String(a.createdAt)) : 0;
    const cb = b?.createdAt ? Date.parse(String(b.createdAt)) : 0;
    if (ca !== cb) return ca - cb;
    return 0;
  });

  return messages;
}

function buildTimelinePage(messages: TimelineMessage[]) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return {
      messages: [],
      oldestCursor: null,
      newestCursor: null,
    };
  }
  return {
    messages,
    oldestCursor: resolveMessageTimelineCursor(messages[0]) || null,
    newestCursor: resolveMessageTimelineCursor(messages[messages.length - 1]) || null,
  };
}

function hasLegacyRecentNoise(messages: TimelineMessage[]) {
  return messages.some((message) => {
    const content = asText(message?.content);
    const metadata = pickRecord(message?.metadata);
    const eventType = asText(metadata.eventType).toLowerCase();
    const isStructuralOpencodeEvent =
      eventType === 'message.updated' ||
      eventType === 'message.part.updated' ||
      eventType === 'message.part.delta' ||
      eventType === 'message.part.removed' ||
      eventType === 'session.status' ||
      eventType === 'session.idle' ||
      eventType === 'message.final';
    if (message?.messageType === 'opencode_event') {
      if (!content && !isStructuralOpencodeEvent) {
        return true;
      }
      if (content.startsWith('[Message] ')) {
        return true;
      }
      return false;
    }
    if (message?.messageType === 'status_update' && !content) {
      return true;
    }
    return false;
  });
}

function filterLegacyTimelineNoise<T extends { messageType?: string; content?: string }>(messages: T[]): T[] {
  return messages.filter((message) => {
    const content = asText(message?.content);
    const metadata = pickRecord((message as any)?.metadata);
    const eventType = asText(metadata.eventType).toLowerCase();
    const isStructuralOpencodeEvent =
      eventType === 'message.updated' ||
      eventType === 'message.part.updated' ||
      eventType === 'message.part.delta' ||
      eventType === 'message.part.removed' ||
      eventType === 'session.status' ||
      eventType === 'session.idle' ||
      eventType === 'message.final';
    if (message?.messageType === 'opencode_event') {
      if (!content && !isStructuralOpencodeEvent) return false;
      if (content.startsWith('[Message] ')) return false;
    }
    if (message?.messageType === 'status_update' && !content) {
      return false;
    }
    return true;
  });
}

function scheduleRecentHistoryHydration(sessionId: string) {
  const taskId = asText(sessionId);
  if (!taskId || recentHistoryHydrationInFlight.has(taskId)) {
    return;
  }

  const now = Date.now();
  const lastQueuedAt = recentHistoryHydrationQueuedAt.get(taskId) || 0;
  if (now - lastQueuedAt < 5000) {
    return;
  }
  recentHistoryHydrationQueuedAt.set(taskId, now);

  const task = (async () => {
    try {
      const nativeMessages = await opencodeRemoteService.loadNativeMessageHistory(taskId, {
        allowProvision: true,
      });
      if (!nativeMessages || nativeMessages.length === 0) {
        return;
      }

      await taskCreationSessionDAO.replaceRecentMessagesSnapshot(
        taskId,
        filterLegacyTimelineNoise(nativeMessages).slice(-50).map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
          messageType: message.messageType,
          metadata: message.metadata,
          createdAt: message.createdAt,
        }))
      );
    } catch (error) {
      console.warn('[RECENT_HISTORY_HYDRATION_FAILED]', { sessionId: taskId, error });
    } finally {
      recentHistoryHydrationInFlight.delete(taskId);
    }
  })();

  recentHistoryHydrationInFlight.set(taskId, task);
}

function pickRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  return {};
}

function isSandboxNotFoundError(error: unknown): boolean {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return (
    normalized.includes('sandbox was not found') ||
    normalized.includes('sandbox not found') ||
    normalized.includes('not running anymore') ||
    normalized.includes('guest has been shut down') ||
    normalized.includes('instance was stopped') ||
    normalized.includes('failed to connect to sandbox')
  );
}

function isWorkspaceFileNotFoundError(error: unknown): boolean {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  const name = error instanceof Error ? String(error.name || '').toLowerCase() : '';
  return (
    name === 'notfounderror' ||
    normalized.includes("does not exist") ||
    normalized.includes('no such file') ||
    normalized.includes('enoent') ||
    normalized.includes('file not found')
  );
}

function resolveRuntimeRestoreSourceKey(runtime: unknown): string {
  const record = (runtime || {}) as Record<string, unknown>;
  return (
    asText(record.codexRestoreSourceKey) ||
    asText(record.r2RestoreSourceKey) ||
    asText(record.r2ArchiveKey) ||
    ''
  );
}

async function tryRestoreWorkspaceForPreviewRead(
  sessionId: string,
  orchestratorSessionId: string,
  session: FileSessionRecord | null,
): Promise<boolean> {
  if (!isE2bWorkspaceExecutor(resolveWorkspaceExecutor(session))) return false;
  const restoreSourceKey = resolveRuntimeRestoreSourceKey(session?.runtime);
  if (!restoreSourceKey) return false;
  try {
    const restored = await restoreWorkspaceIfArchived(orchestratorSessionId);
    if (restored) {
      await taskCreationCacheStore.invalidateWorkspaceBySession(sessionId);
      await taskSessionCacheFacade.invalidateWorkspaceBySessionId(sessionId);
      return true;
    }
    return false;
  } catch (restoreError) {
    console.warn('[WORKSPACE_RAW_RESTORE_ON_MISSING_FAILED]', {
      sessionId,
      orchestratorSessionId,
      error: restoreError instanceof Error ? restoreError.message : String(restoreError),
    });
    return false;
  }
}

function resolvePathBasename(filePath: string): string {
  const normalized = String(filePath || '').replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts.length > 0 ? String(parts[parts.length - 1] || '') : '';
}

function resolvePathExt(filePath: string): string {
  const base = resolvePathBasename(filePath);
  const index = base.lastIndexOf('.');
  return index > 0 ? base.slice(index + 1).toLowerCase() : '';
}

function decodeCachedWorkspaceFileBytes(payload: Record<string, unknown> | null | undefined): Buffer | null {
  const data = payload || null;
  if (!data) return null;
  if (Boolean(data.truncated)) return null;
  if (typeof data.content !== 'string') return null;
  const encoding = asText(data.encoding).toLowerCase();
  const isBinary = Boolean(data.isBinary) || encoding === 'base64';
  if (!isBinary) {
    return Buffer.from(data.content, 'utf8');
  }
  const base64 = String(data.content || '').trim();
  if (!base64) return Buffer.alloc(0);
  try {
    return Buffer.from(base64, 'base64');
  } catch {
    return null;
  }
}

async function writeWorkspaceFileToSandbox(
  orchestratorSessionId: string,
  workspaceRoot: string,
  normalizedPath: string,
  bytes: Buffer,
): Promise<void> {
  const slash = normalizedPath.lastIndexOf('/');
  if (slash > 0) {
    const dirPath = normalizedPath.slice(0, slash);
    const absoluteDir = resolveWorkspaceAbsolutePath(workspaceRoot, dirPath);
    await e2bConnector.runCommand(
      orchestratorSessionId,
      `mkdir -p ${shellEscape(absoluteDir)}`,
      {
        timeoutMs: 10000,
      },
    );
  }
  const absolutePath = resolveWorkspaceAbsolutePath(workspaceRoot, normalizedPath);
  await e2bConnector.writeFile(orchestratorSessionId, absolutePath, bytes);
}

async function tryRebuildWorkspaceFileFromCache(input: {
  sessionId: string;
  tenantKey: string;
  normalizedPath: string;
  workspaceRoot: string;
  orchestratorSessionId: string;
}): Promise<boolean> {
  if (!input.tenantKey) return false;
  try {
    const dbCached = await taskSessionWorkspaceCacheDAO.get({
      sessionId: input.sessionId,
      tenantKey: input.tenantKey,
      cacheType: 'file',
      cacheKey: input.normalizedPath,
    });
    const dbBytes = decodeCachedWorkspaceFileBytes(pickRecord(dbCached?.data));
    if (dbBytes) {
      await writeWorkspaceFileToSandbox(
        input.orchestratorSessionId,
        input.workspaceRoot,
        input.normalizedPath,
        dbBytes,
      );
      return true;
    }

    const stale = await taskCreationCacheStore.getWorkspaceFile(
      input.tenantKey,
      input.sessionId,
      input.normalizedPath,
      { allowStale: true },
    );
    const staleBytes = decodeCachedWorkspaceFileBytes(
      stale && stale.data && typeof stale.data === 'object'
        ? (stale.data as Record<string, unknown>)
        : null,
    );
    if (staleBytes) {
      await writeWorkspaceFileToSandbox(
        input.orchestratorSessionId,
        input.workspaceRoot,
        input.normalizedPath,
        staleBytes,
      );
      return true;
    }
    return false;
  } catch (error) {
    console.warn('[WORKSPACE_RAW_REBUILD_FROM_CACHE_FAILED]', {
      sessionId: input.sessionId,
      path: input.normalizedPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

async function tryRebuildWorkspaceFileFromDeliverables(input: {
  sessionId: string;
  normalizedPath: string;
  workspaceRoot: string;
  orchestratorSessionId: string;
}): Promise<boolean> {
  try {
    const deliverables = await taskSessionDeliverableService.listSessionDeliverables(input.sessionId);
    if (!deliverables.length) return false;
    const normalizedTarget = normalizeWorkspacePath(input.normalizedPath);
    const targetBasename = resolvePathBasename(input.normalizedPath);
    const targetExt = resolvePathExt(input.normalizedPath);
    const candidate =
      deliverables.find((item) => normalizeWorkspacePath(item.path) === normalizedTarget) ||
      deliverables.find((item) => {
        const base = resolvePathBasename(item.path);
        if (!base || base !== targetBasename) return false;
        if (!targetExt) return true;
        return resolvePathExt(item.path) === targetExt;
      }) ||
      null;
    if (!candidate) return false;
    const artifact = await taskSessionDeliverableService.getSessionDeliverable(
      input.sessionId,
      candidate.id,
    );
    if (!artifact?.storageKey) return false;
    const bytes = await downloadFromR2(artifact.storageKey);
    await writeWorkspaceFileToSandbox(
      input.orchestratorSessionId,
      input.workspaceRoot,
      input.normalizedPath,
      bytes,
    );
    return true;
  } catch (error) {
    console.warn('[WORKSPACE_RAW_REBUILD_FROM_DELIVERABLE_FAILED]', {
      sessionId: input.sessionId,
      path: input.normalizedPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

async function tryRebuildWorkspaceFileForPreview(input: {
  sessionId: string;
  tenantKey: string;
  normalizedPath: string;
  workspaceRoot: string;
  orchestratorSessionId: string;
}): Promise<boolean> {
  const cacheRebuilt = await tryRebuildWorkspaceFileFromCache(input);
  if (cacheRebuilt) return true;
  return tryRebuildWorkspaceFileFromDeliverables({
    sessionId: input.sessionId,
    normalizedPath: input.normalizedPath,
    workspaceRoot: input.workspaceRoot,
    orchestratorSessionId: input.orchestratorSessionId,
  });
}

async function resolveRuntimeStatus(orchestratorSessionId?: string | null) {
  const sessionId = asText(orchestratorSessionId);
  if (!sessionId) return null;
  try {
    const environment = await sandboxExecutionEnvironmentDAO.getBySessionId(sessionId);
    if (!environment) return null;
    const metadata = pickRecord(environment.metadata);
    return {
      status: environment.status,
      provider: metadata.sandboxProvider || undefined,
      updatedAt: environment.updatedAt,
      sandboxId: environment.sessionId,
      codexRestoreStatus: asText(metadata.codexRestoreStatus) || undefined,
      codexRestoreAt: asText(metadata.codexRestoreAt) || undefined,
      codexRestoreSourceKey: asText(metadata.codexRestoreSourceKey) || undefined,
      previousExecutorSessionId: asText(metadata.previousExecutorSessionId) || undefined,
      codexRestoreFailureReason: asText(metadata.codexRestoreFailureReason) || undefined,
    };
  } catch (error) {
    console.warn('[TASK_CREATION_RUNTIME_STATUS_FAILED]', sessionId, error);
    return null;
  }
}

async function markSandboxClosed(orchestratorSessionId: string) {
  try {
    const environment = await sandboxExecutionEnvironmentDAO.getBySessionId(orchestratorSessionId);
    if (!environment) return;
    if (environment.status === 'closed') return;
    await sandboxExecutionEnvironmentDAO.updateStatus(
      orchestratorSessionId,
      'closed',
      environment.vmName ?? null
    );
  } catch (error) {
    console.warn('[TASK_CREATION_MARK_CLOSED_FAILED]', orchestratorSessionId, error);
  }
}

function truncateUtf8(text: string, maxBytes: number): { text: string; truncated: boolean; size: number } {
  const buffer = Buffer.from(text || '', 'utf8');
  if (buffer.length <= maxBytes) {
    return { text, truncated: false, size: buffer.length };
  }
  const sliced = buffer.subarray(0, maxBytes).toString('utf8');
  return { text: sliced, truncated: true, size: maxBytes };
}

function getFileExt(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const filename = normalized.split('/').pop() || '';
  const dot = filename.lastIndexOf('.');
  if (dot < 0) return '';
  return filename.slice(dot + 1).toLowerCase();
}

function inferMimeTypeFromExt(filePath: string): string | undefined {
  const ext = getFileExt(filePath);
  if (!ext) return undefined;
  const map: Record<string, string> = {
    txt: 'text/plain',
    text: 'text/plain',
    html: 'text/html',
    htm: 'text/html',
    css: 'text/css',
    js: 'text/javascript',
    mjs: 'text/javascript',
    cjs: 'text/javascript',
    json: 'application/json',
    csv: 'text/csv',
    tsv: 'text/tab-separated-values',
    xml: 'application/xml',
    yaml: 'application/yaml',
    yml: 'application/yaml',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    m4v: 'video/x-m4v',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    flac: 'audio/flac',
    pdf: 'application/pdf',
    md: 'text/markdown',
    markdown: 'text/markdown',
    mdx: 'text/markdown',
  };
  return map[ext];
}

function resolveMimeType(filePath: string, fromUpstream?: string): string {
  const normalized = (fromUpstream || '').trim().toLowerCase();
  if (normalized) return normalized;
  return inferMimeTypeFromExt(filePath) || 'application/octet-stream';
}

function buildDeliverableDownloadPath(sessionId: string, artifactId: string): string {
  return `/api/task-creation/sessions/${encodeURIComponent(sessionId)}/deliverables/${encodeURIComponent(artifactId)}/download`;
}

function serializeDeliverableArtifact(input: {
  sessionId: string;
  id: string;
  runId: string;
  path: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string | null;
}) {
  return {
    id: input.id,
    runId: input.runId,
    path: input.path,
    name: input.name,
    mimeType: input.mimeType,
    size: input.sizeBytes,
    createdAt: input.createdAt,
    downloadPath: buildDeliverableDownloadPath(input.sessionId, input.id),
  };
}

function buildAttachmentDisposition(fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7E]+/g, '_').replace(/["\\]/g, '_') || 'download';
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function isTextLikeMimeType(mimeType: string): boolean {
  const normalized = String(mimeType || '').trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized.startsWith('text/') ||
    normalized === 'application/json' ||
    normalized === 'application/xml' ||
    normalized === 'application/yaml' ||
    normalized === 'application/javascript' ||
    normalized === 'text/javascript'
  );
}

function detectPreviewType(filePath: string, mimeType: string, isBinary: boolean): WorkspacePreviewType {
  const ext = getFileExt(filePath);
  if (!isBinary) {
    if (mimeType === 'image/svg+xml' || ext === 'svg') {
      return 'image';
    }
    if (mimeType === 'text/markdown' || ext === 'md' || ext === 'markdown' || ext === 'mdx') {
      return 'markdown';
    }
    if (mimeType === 'text/html' || ext === 'html' || ext === 'htm') {
      return 'html';
    }
    return 'text';
  }
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType === 'application/pdf') return 'pdf';
  return 'binary';
}

function estimateBase64Bytes(base64: string): number {
  if (!base64) return 0;
  const sanitized = base64.replace(/\s+/g, '');
  const padding = sanitized.endsWith('==') ? 2 : sanitized.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((sanitized.length * 3) / 4) - padding);
}

async function buildWorkspaceTreeFromOpencode(input: {
  orchestratorSessionId: string;
  workspaceRoot: string;
  maxDepth: number;
  maxEntries: number;
}) {
  const items: Array<{ path: string; type: 'file' | 'dir' }> = [];
  const queue: Array<{ path: string; depth: number }> = [{ path: '', depth: 0 }];
  const seenDirs = new Set<string>();

  while (queue.length > 0 && items.length < input.maxEntries) {
    const current = queue.shift()!;
    const nodes = await listOpencodeDirectory(
      input.orchestratorSessionId,
      input.workspaceRoot,
      current.path
    );
    for (const node of nodes) {
      if (node.ignored) continue;
      const normalizedPath = normalizeWorkspacePath(node.path);
      if (!normalizedPath) continue;
      const type = node.type === 'directory' ? 'dir' : 'file';
      if (type === 'dir' && current.depth >= input.maxDepth) {
        continue;
      }
      items.push({ path: normalizedPath, type });
      if (items.length >= input.maxEntries) break;
      if (type === 'dir' && current.depth + 1 <= input.maxDepth && !seenDirs.has(normalizedPath)) {
        seenDirs.add(normalizedPath);
        queue.push({ path: normalizedPath, depth: current.depth + 1 });
      }
    }
  }

  return {
    root: input.workspaceRoot,
    items,
  };
}

function sortWorkspaceTreeItems(
  items: Array<{ path: string; type: 'file' | 'dir' }>
): Array<{ path: string; type: 'file' | 'dir' }> {
  return items
    .slice()
    .sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'dir' ? -1 : 1;
      }
      return a.path.localeCompare(b.path, 'zh-CN');
    });
}

function writeSse(res: express.Response, payload: unknown, eventName?: string, eventId?: number) {
  if (Number.isFinite(eventId) && eventId) {
    res.write(`id: ${eventId}\n`);
  }
  if (eventName) {
    res.write(`event: ${eventName}\n`);
  }
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
  if (typeof (res as any).flush === 'function') {
    (res as any).flush();
  }
}

function respondEphemeralSseBridge(
  res: express.Response,
  payload: Record<string, unknown>,
  options?: { retryMs?: number }
) {
  const retryMs = Math.max(1000, Number(options?.retryMs || 5000));
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  res.write(`retry: ${retryMs}\n`);
  writeSse(res, payload, 'bridge');
  res.end();
}

type SseClientRuntimeState = {
  sessionId: string;
  clientId: string;
  connectedAt: number;
  disconnectedAt: number;
  activeConnections: number;
  reconnectCount: number;
  lastCursor: number;
  updatedAt: number;
};

const sseClientState = new Map<string, SseClientRuntimeState>();
const sseClientStateTtlMs = clampNumber(
  Number(process.env.TASK_CREATION_SSE_CLIENT_STATE_TTL_MS || 24 * 60 * 60 * 1000),
  5 * 60 * 1000,
  7 * 24 * 60 * 60 * 1000
);

function buildSseClientStateKey(sessionId: string, clientId: string) {
  return `${sessionId}::${clientId}`;
}

function isTimestampCursorValue(value: number) {
  return Number.isFinite(value) && value >= 1_000_000_000_000;
}

function parseSseClientId(req: express.Request): string {
  const fromQuery = asText(req.query.clientId);
  if (fromQuery) return fromQuery.slice(0, 128);
  const fromHeader = asText(req.headers['x-sse-client-id']);
  if (fromHeader) return fromHeader.slice(0, 128);
  const fallback =
    asText(req.ip) ||
    asText((req.headers['x-forwarded-for'] as string) || '') ||
    'anonymous';
  return `anon_${fallback}`.slice(0, 128);
}

function cleanupSseClientState(now: number) {
  for (const [key, state] of sseClientState.entries()) {
    if (state.activeConnections > 0) continue;
    if (now - state.updatedAt <= sseClientStateTtlMs) continue;
    sseClientState.delete(key);
  }
}

function registerSseClientConnection(sessionId: string, clientId: string) {
  const now = Date.now();
  cleanupSseClientState(now);
  const key = buildSseClientStateKey(sessionId, clientId);
  const prev = sseClientState.get(key);
  const reconnecting = Boolean(prev && prev.disconnectedAt > 0 && now >= prev.disconnectedAt);
  const next: SseClientRuntimeState = {
    sessionId,
    clientId,
    connectedAt: now,
    disconnectedAt: 0,
    activeConnections: (prev?.activeConnections || 0) + 1,
    reconnectCount: reconnecting ? (prev?.reconnectCount || 0) + 1 : prev?.reconnectCount || 0,
    lastCursor: prev?.lastCursor || 0,
    updatedAt: now,
  };
  sseClientState.set(key, next);
  return {
    key,
    state: next,
    reconnecting,
    previousDisconnectedAt: prev?.disconnectedAt || 0,
  };
}

function markSseClientDisconnected(key: string) {
  const now = Date.now();
  const prev = sseClientState.get(key);
  if (!prev) return;
  const nextActive = Math.max(0, (prev.activeConnections || 0) - 1);
  sseClientState.set(key, {
    ...prev,
    activeConnections: nextActive,
    disconnectedAt: now,
    updatedAt: now,
  });
}

function updateSseClientCursor(key: string, cursor: number) {
  if (!Number.isFinite(cursor) || cursor <= 0) return;
  const prev = sseClientState.get(key);
  if (!prev) return;
  const prevCursor = prev.lastCursor || 0;
  const prevIsTimestamp = isTimestampCursorValue(prevCursor);
  const nextIsTimestamp = isTimestampCursorValue(cursor);
  if (prevCursor > 0 && prevIsTimestamp !== nextIsTimestamp) {
    // 统一以时间戳/时间序列游标为主，避免 seq 在后端重连后重置导致断点错乱。
    if (prevIsTimestamp && !nextIsTimestamp) {
      return;
    }
  }
  if (cursor <= prevCursor) return;
  sseClientState.set(key, {
    ...prev,
    lastCursor: cursor,
    updatedAt: Date.now(),
  });
}

/**
 * POST /api/task-creation/sessions
 * 先创建任务会话（可选写入首条用户消息），用于前端在 runtime 连接前先落盘任务
 */
router.post('/sessions', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const legacyUserIdHint = resolveLegacyUserIdHint(req, currentUser.userId);
    await upsertLegacyUserMapping(currentUser.userId, legacyUserIdHint);
    const requestedSessionId = asText(req.body?.sessionId);
    const requestedTitle = asText(req.body?.title);
    const requestedMode = asText(req.body?.mode);
    const requestedExecutor = asText(req.body?.executor);
    const requestedCodexExecutionMode = asText(req.body?.codexExecutionMode);
    const requestedDriver = asText(req.body?.driver);
    const initialMessage = asText(req.body?.initialMessage);
    const initialMessageTypeRaw = asText(req.body?.initialMessageType);
    const initialMessageType = initialMessageTypeRaw === 'user_response' ? 'user_response' : 'user_input';
    const effectiveSessionId = requestedSessionId || randomUUID();

    const existingSession = effectiveSessionId
      ? await taskCreationFileMemoryStore.getSession(effectiveSessionId)
      : null;
    const isNewSession = !existingSession;
    const normalizedRequestedTitle = deriveResolvedSessionTitle(requestedTitle);
    const title =
      (normalizedRequestedTitle && !isWeakIntentTitleInput(normalizedRequestedTitle)
        ? normalizedRequestedTitle
        : '') ||
      DEFAULT_SESSION_TITLE;

    const session = await taskCreationFileMemoryStore.createSession(
      isNewSession ? title : '',
      effectiveSessionId
    );

    if (requestedMode === 'sandbox' || requestedMode === 'altus') {
      await taskCreationFileMemoryStore.updateSessionMode(session.id, requestedMode as any);
    }
    if (requestedExecutor) {
      await taskCreationFileMemoryStore.updateSessionExecutor(session.id, requestedExecutor);
    }
    if (requestedExecutor === 'codex' && (requestedCodexExecutionMode === 'sdk' || requestedCodexExecutionMode === 'ws')) {
      await taskCreationFileMemoryStore.updateSessionCodexExecutionMode(
        session.id,
        requestedCodexExecutionMode as 'sdk' | 'ws'
      );
      await taskCreationFileMemoryStore.updateRuntimeBinding(session.id, {
        executor: 'codex',
        transport: requestedCodexExecutionMode === 'ws' ? 'app_server' : 'sdk',
      });
    }
    const derivedDriver =
      (requestedDriver as FileSessionRecord['driver']) ||
      deriveSessionDriver({
        mode: requestedMode || session.mode,
        executor: requestedExecutor || session.executor,
        fallbackDriver: session.driver,
      });
    if (derivedDriver) {
      await taskCreationFileMemoryStore.updateSessionDriver(session.id, derivedDriver);
    }

    if (isNewSession) {
      await taskCreationFileMemoryStore.addMessage(
        session.id,
        'system',
        'session_started',
        '会话已创建'
      );
    }

    let persistedInitialMessage = false;
    if (initialMessage && isNewSession) {
      const history = await taskCreationFileMemoryStore.getMessages(session.id);
      const last = history.length > 0 ? history[history.length - 1] : null;
      const isDuplicateTail =
        last?.role === 'user' &&
        last?.messageType === initialMessageType &&
        String(last?.content || '') === initialMessage;
      if (!isDuplicateTail) {
        await taskCreationFileMemoryStore.addMessage(
          session.id,
          'user',
          initialMessageType,
          initialMessage
        );
        persistedInitialMessage = true;
      }
    }

    if (requestedMode === 'sandbox') {
      await taskCreationFileMemoryStore.updateSessionState(session.id, {
        status: 'in_progress',
        stage: 'executing',
        phase: 'development',
      });
    }

    try {
      const existingDbSession = await taskCreationSessionDAO.getSession(session.id);
      if (!existingDbSession) {
        await taskCreationSessionDAO.createSession({
          id: session.id,
          userId: currentUser.userId,
          status: 'in_progress',
        });
      } else {
        const normalizedExistingUserId = normalizeUserId(existingDbSession.userId);
        if (normalizedExistingUserId && !isSameUserId(normalizedExistingUserId, currentUser.userId)) {
          if (legacyUserIdHint && isSameUserId(normalizedExistingUserId, legacyUserIdHint)) {
            await taskCreationSessionDAO.adoptSessionFromLegacyUserId(
              session.id,
              currentUser.userId,
              legacyUserIdHint
            );
          } else {
            return res.status(403).json({
              success: false,
              error: '当前用户无权访问该会话',
            });
          }
        }
        await taskCreationSessionDAO.bindUserIfMissing(session.id, currentUser.userId);
      }
      if (isNewSession) {
        await taskCreationSessionDAO.addMessage({
          id: randomUUID(),
          sessionId: session.id,
          role: 'system',
          messageType: 'session_started',
          content: '会话已创建',
        });
      }
      if (persistedInitialMessage) {
        await taskCreationSessionDAO.addMessage({
          id: randomUUID(),
          sessionId: session.id,
          role: 'user',
          messageType: initialMessageType,
          content: initialMessage,
        });
      }
    } catch (error) {
      console.warn('[TASK_CREATION_CREATE_SESSION_DB_FAILED]', error);
    }

    const snapshot = (await taskCreationFileMemoryStore.getSession(session.id)) || session;
    return res.json({
      success: true,
      data: toSessionSummary(snapshot),
      message: isNewSession ? '会话已创建' : '会话已就绪',
    });
  } catch (error: any) {
    const authError = resolveCurrentUserError(error);
    console.error('创建会话失败:', error);
    res.status(authError?.status || 500).json({
      success: false,
      error: getPublicErrorMessage(authError?.message || '创建会话失败，请稍后重试'),
    });
  }
});

/**
 * GET /api/task-creation/sessions
 * 获取最近的任务创建会话列表
 */
router.get('/sessions', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const legacyUserIdHint = resolveLegacyUserIdHint(req, currentUser.userId);
    await upsertLegacyUserMapping(currentUser.userId, legacyUserIdHint);
    const rawLimit = (req.query.limit as string | undefined)?.trim();
    let limit = 200;
    if (rawLimit === 'all') {
      limit = Number.MAX_SAFE_INTEGER;
    } else if (rawLimit) {
      const parsed = Number.parseInt(rawLimit, 10);
      if (!Number.isNaN(parsed) && parsed > 0) {
        limit = Math.min(parsed, 5000);
      }
    }
    const refresh = parseRefreshFlag(req.query.refresh);
    const cacheTtlMs = clampNumber(
      Number(process.env.TASK_CREATION_LIST_CACHE_TTL_MS || 10000),
      1000,
      60000
    );
    const now = Date.now();
    let ownedDbSessions = await taskCreationSessionDAO.getRecentSessions(limit, currentUser.userId);
    if (ownedDbSessions.length === 0) {
      try {
        const legacyUserIds = await collectLegacyUserIdsForMigration(currentUser.userId, legacyUserIdHint);
        if (legacyUserIds.length > 0) {
          for (const legacyUserId of legacyUserIds) {
            const reboundLegacy = await taskCreationSessionDAO.rebindSessionsFromLegacyUserId(
              currentUser.userId,
              legacyUserId,
              limit
            );
            if (reboundLegacy.length > 0) {
              ownedDbSessions = reboundLegacy;
              console.warn('[TASK_SESSION_LIST_REBOUND_LEGACY_USER]', {
                userId: currentUser.userId,
                legacyUserId,
                reboundCount: reboundLegacy.length,
              });
              break;
            }
          }
        }
      } catch (error) {
        console.warn('[TASK_SESSION_LIST_REBOUND_LEGACY_FAILED]', {
          userId: currentUser.userId,
          error,
        });
      }
    }
    const ownedSessionIds = new Set(ownedDbSessions.map((item) => String(item.id)));

    const rawSessions = await taskCreationFileMemoryStore.listSessions(limit);
    let sessions = rawSessions
      .filter((session) => ownedSessionIds.has(String(session.id)))
      .map(toSessionSummary);
    if (!refresh && sessions.length > 0) {
      return res.json({
        success: true,
        data: sessions,
      });
    }

    const sessionListCache = sessionListCacheByUser.get(currentUser.userId) || null;
    if (
      !refresh &&
      sessionListCache &&
      now - sessionListCache.fetchedAt < cacheTtlMs &&
      sessionListCache.data.length > 0
    ) {
      const cached = limit >= sessionListCache.data.length
        ? sessionListCache.data
        : sessionListCache.data.slice(0, limit);
      return res.json({
        success: true,
        data: cached,
        cache: { hit: true, ageMs: now - sessionListCache.fetchedAt },
      });
    }

    if (sessions.length === 0) {
      const summaries = await buildSessionSummaryFromDb(limit, currentUser.userId);
      if (summaries.length === 0) {
        logSessionListEmpty({
          userId: currentUser.userId,
          source: 'db_summary',
          ownedDbCount: ownedDbSessions.length,
          memoryCount: rawSessions.length,
          refresh,
        });
      }
      sessionListCacheByUser.set(currentUser.userId, {
        fetchedAt: now,
        limit,
        data: summaries,
      });
      return res.json({
        success: true,
        data: summaries,
        cache: { hit: false },
      });
    }

    try {
      const dbSummaries = await buildSessionSummaryFromDb(limit, currentUser.userId);
      const dbById = new Map(dbSummaries.map((item) => [String(item.id), item]));
      sessions = sessions.map((session) => mergeSessionLifecycleFromDb(session, dbById.get(String(session.id))));
    } catch (error) {
      if (!isTransientDatabaseError(error)) {
        throw error;
      }
      console.warn('[TASK_SESSION_LIST_DB_RECONCILE_FAILED]', error);
    }

    sessionListCacheByUser.set(currentUser.userId, {
      fetchedAt: now,
      limit,
      data: sessions,
    });
    if (sessions.length === 0) {
      logSessionListEmpty({
        userId: currentUser.userId,
        source: 'memory_reconcile',
        ownedDbCount: ownedDbSessions.length,
        memoryCount: rawSessions.length,
        refresh,
      });
    }

    return res.json({
      success: true,
      data: sessions,
      cache: { hit: false },
    });
  } catch (error: any) {
    console.error('获取会话列表失败:', error);
    const currentUser = currentUserResolver.resolve(req);
    const sessionListCache = currentUser ? sessionListCacheByUser.get(currentUser.userId) || null : null;
    if (!currentUser) {
      return res.status(401).json({
        success: false,
        error: getPublicErrorMessage(error?.message || '当前未登录'),
      });
    }
    if (isTransientDatabaseError(error)) {
      if (sessionListCache && sessionListCache.data.length > 0) {
        return res.json({
          success: true,
          data: sessionListCache.data,
          cache: { hit: true, stale: true, ageMs: Date.now() - sessionListCache.fetchedAt },
        });
      }
      return respondDatabaseUnavailable(res);
    }
    res.status(500).json({
      success: false,
      error: getPublicErrorMessage('获取会话列表失败，请稍后重试'),
    });
  }
});

router.post('/sessions/draft', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const requestedTitle = deriveResolvedSessionTitle(req.body?.title);
    const title =
      requestedTitle && !isWeakIntentTitleInput(requestedTitle)
        ? requestedTitle
        : DEFAULT_SESSION_TITLE;
    const sessionId = await createDraftTaskSession(title, currentUser.userId);
    const session = await resolveTaskSessionRecord(sessionId);
    return res.json({
      success: true,
      data: session ? toSessionSummary(session) : { id: sessionId, title, status: 'in_progress' },
    });
  } catch (error: any) {
    const authError = resolveCurrentUserError(error);
    if (authError) {
      return res.status(authError.status).json({
        success: false,
        error: getPublicErrorMessage(authError.message),
      });
    }
    console.error('创建草稿会话失败:', error);
    if (isTransientDatabaseError(error)) {
      return respondDatabaseUnavailable(res);
    }
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '创建草稿会话失败'),
    });
  }
});

router.post('/sessions/:sessionId/title/resolve', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const { sessionId } = req.params;
    await requireOwnedTaskSession(sessionId, currentUser.userId, resolveLegacyUserIdHint(req, currentUser.userId));
    const input = normalizeSessionTitleText(req.body?.message);
    const session = await resolveTaskSessionRecord(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: '会话不存在',
      });
    }

    const titleLocked = Boolean(session.titleLocked);
    const currentTitle = asText(session.title) || DEFAULT_SESSION_TITLE;
    if (!input || titleLocked || !isExplicitSessionTitleInput(input)) {
      return res.json({
        success: true,
        data: {
          id: session.id,
          title: currentTitle,
          titleLocked,
          titleSource: session.titleSource || 'placeholder',
          titleResolvedAt: session.titleResolvedAt || null,
          resolved: false,
        },
      });
    }

    const nextTitle = deriveResolvedSessionTitle(input) || DEFAULT_SESSION_TITLE;
    await taskCreationFileMemoryStore.updateSessionTitle(session.id, nextTitle, {
      lock: true,
      source: 'first_explicit_user_input',
    });
    const updated = await resolveTaskSessionRecord(session.id);
    return res.json({
      success: true,
      data: {
        id: session.id,
        title: updated?.title || nextTitle,
        titleLocked: Boolean(updated?.titleLocked),
        titleSource: updated?.titleSource || 'first_explicit_user_input',
        titleResolvedAt: updated?.titleResolvedAt || null,
        resolved: true,
      },
    });
  } catch (error: any) {
    const authError = resolveCurrentUserError(error);
    if (authError) {
      return res.status(authError.status).json({
        success: false,
        error: getPublicErrorMessage(authError.message),
      });
    }
    const ownershipError = resolveOwnedTaskSessionError(error);
    if (ownershipError) {
      return res.status(ownershipError.status).json({
        success: false,
        error: getPublicErrorMessage(ownershipError.message),
      });
    }
    console.error('解析会话标题失败:', error);
    if (isTransientDatabaseError(error)) {
      return respondDatabaseUnavailable(res);
    }
    return res.status(500).json({
      success: false,
      error: getPublicErrorMessage('解析会话标题失败，请稍后重试'),
    });
  }
});

router.post('/sessions/:sessionId/title/rename', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const { sessionId } = req.params;
    await requireOwnedTaskSession(sessionId, currentUser.userId, resolveLegacyUserIdHint(req, currentUser.userId));
    const session = await resolveTaskSessionRecord(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: '会话不存在',
      });
    }

    const nextTitle = deriveResolvedSessionTitle(req.body?.title);
    if (!nextTitle) {
      return res.status(400).json({
        success: false,
        error: '标题不能为空',
      });
    }

    await taskCreationFileMemoryStore.updateSessionTitle(session.id, nextTitle, {
      lock: true,
      source: 'manual',
      force: true,
    });
    const updated = await resolveTaskSessionRecord(session.id);
    return res.json({
      success: true,
      data: toSessionSummary(updated || { ...session, title: nextTitle, titleLocked: true, titleSource: 'manual' }),
    });
  } catch (error: any) {
    const authError = resolveCurrentUserError(error);
    if (authError) {
      return res.status(authError.status).json({
        success: false,
        error: getPublicErrorMessage(authError.message),
      });
    }
    const ownershipError = resolveOwnedTaskSessionError(error);
    if (ownershipError) {
      return res.status(ownershipError.status).json({
        success: false,
        error: getPublicErrorMessage(ownershipError.message),
      });
    }
    console.error('重命名会话失败:', error);
    if (isTransientDatabaseError(error)) {
      return respondDatabaseUnavailable(res);
    }
    return res.status(500).json({
      success: false,
      error: getPublicErrorMessage('重命名会话失败，请稍后重试'),
    });
  }
});

router.post('/sessions/:sessionId/favorite', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const { sessionId } = req.params;
    await requireOwnedTaskSession(sessionId, currentUser.userId, resolveLegacyUserIdHint(req, currentUser.userId));
    const session = await resolveTaskSessionRecord(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: '会话不存在',
      });
    }
    const favorite = Boolean(req.body?.favorite);
    await taskCreationFileMemoryStore.updateSessionFavorite(session.id, favorite);
    const updated = await resolveTaskSessionRecord(session.id);
    return res.json({
      success: true,
      data: toSessionSummary(updated || { ...session, isFavorite: favorite }),
    });
  } catch (error: any) {
    const authError = resolveCurrentUserError(error);
    if (authError) {
      return res.status(authError.status).json({
        success: false,
        error: getPublicErrorMessage(authError.message),
      });
    }
    const ownershipError = resolveOwnedTaskSessionError(error);
    if (ownershipError) {
      return res.status(ownershipError.status).json({
        success: false,
        error: getPublicErrorMessage(ownershipError.message),
      });
    }
    console.error('更新会话收藏状态失败:', error);
    if (isTransientDatabaseError(error)) {
      return respondDatabaseUnavailable(res);
    }
    return res.status(500).json({
      success: false,
      error: getPublicErrorMessage('更新会话收藏状态失败，请稍后重试'),
    });
  }
});

/**
 * GET /api/task-creation/sessions/:sessionId
 * 获取会话的完整信息（包括所有关联数据）
 */
router.get('/sessions/:sessionId', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const { sessionId } = req.params;
    await requireOwnedTaskSession(sessionId, currentUser.userId, resolveLegacyUserIdHint(req, currentUser.userId));
    const sessionData = await resolveTaskSessionMeta(sessionId);

    if (!sessionData) {
      return res.status(404).json({
        success: false,
        error: '会话不存在',
      });
    }

    const runtimeStatus = await resolveRuntimeStatus(sessionData.runtime?.orchestratorSessionId);
    let connectorsSummary: ReturnType<typeof sessionConnectorService.summarizeStatuses> | null = null;
    try {
      const statuses = await sessionConnectorService.listSessionConnectors(sessionId, currentUser.userId);
      connectorsSummary = sessionConnectorService.summarizeStatuses(statuses);
    } catch {
      connectorsSummary = null;
    }

    res.json({
      success: true,
      data: {
        ...sessionData,
        runtimeStatus,
        connectorsSummary,
      },
    });
  } catch (error: any) {
    const authError = resolveCurrentUserError(error);
    if (authError) {
      return res.status(authError.status).json({
        success: false,
        error: getPublicErrorMessage(authError.message),
      });
    }
    const ownershipError = resolveOwnedTaskSessionError(error);
    if (ownershipError) {
      return res.status(ownershipError.status).json({
        success: false,
        error: getPublicErrorMessage(ownershipError.message),
      });
    }
    console.error('获取会话详情失败:', error);
    if (isTransientDatabaseError(error)) {
      return respondDatabaseUnavailable(res);
    }
    res.status(500).json({
      success: false,
      error: getPublicErrorMessage('获取会话详情失败，请稍后重试'),
    });
  }
});

/**
 * GET /api/task-creation/sessions/:sessionId/messages/recent
 * 首屏最近消息热缓存，仅依赖数据库
 */
router.get('/sessions/:sessionId/messages/recent', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const { sessionId } = req.params;
    await requireOwnedTaskSession(sessionId, currentUser.userId, resolveLegacyUserIdHint(req, currentUser.userId));
    const session = await resolveTaskSessionMeta(sessionId);
    const tenantKey = resolveTenantKey(currentUser);
    const shouldPreferOpencodeNativeHistory =
      asText(session?.mode) === 'sandbox' &&
      (asText(session?.executor) === 'opencode' || asText(session?.runtime?.opencodeSessionId));
    if (!shouldPreferOpencodeNativeHistory) {
      const redisCachedPage = await taskSessionCacheFacade.getRecentMessagesPage({
        sessionId,
        userId: currentUser.userId,
        tenantKey,
      });
      if (redisCachedPage) {
        return res.json({
          success: true,
          data: redisCachedPage,
        });
      }
    }
    const cachedMessages = await taskCreationSessionDAO.getRecentMessages(sessionId, 50);
    const recentMessages = filterLegacyTimelineNoise(
      injectRuntimeGenerationBoundaries(
        annotateRuntimeGenerations(mapStoredMessagesToTimeline(cachedMessages), session?.runtime)
      )
    );
    const shouldHydrateFromNativeHistory =
      shouldPreferOpencodeNativeHistory &&
      (!hasRenderableAssistantReply(recentMessages) || hasLegacyRecentNoise(recentMessages));

    if (shouldPreferOpencodeNativeHistory) {
      const resolvedMessages = await resolveRenderableTimelineMessages(sessionId, session);
      const resolvedRecentMessages = resolvedMessages.slice(Math.max(resolvedMessages.length - 50, 0));
      const cacheOutOfSync =
        shouldHydrateFromNativeHistory ||
        recentMessages.length !== resolvedRecentMessages.length ||
        (resolveMessageTimelineCursor(recentMessages[recentMessages.length - 1]) || 0) !==
          (resolveMessageTimelineCursor(resolvedRecentMessages[resolvedRecentMessages.length - 1]) || 0) ||
        (recentMessages[recentMessages.length - 1]?.messageKey || '') !==
          (resolvedRecentMessages[resolvedRecentMessages.length - 1]?.messageKey || '');

      if (cacheOutOfSync && resolvedRecentMessages.length > 0) {
        void taskCreationSessionDAO
          .replaceRecentMessagesSnapshot(
            sessionId,
            resolvedRecentMessages.map((message) => ({
              id: message.id,
              role: message.role,
              content: message.content,
              messageType: message.messageType,
              metadata: message.metadata,
              createdAt: message.createdAt,
            }))
          )
          .catch((error) => {
            console.warn('[RECENT_MESSAGES_SYNC_FAILED]', { sessionId, error });
          });
      }

      const page = buildTimelinePage(resolvedRecentMessages);
      const mayHaveOlderHistory =
        resolvedRecentMessages.length >= 50 ||
        asText(session?.runtime?.opencodeSessionId).length > 0 ||
        asText(session?.executor) === 'opencode';
      const responsePayload = {
        ...page,
        hasOlderHistory: mayHaveOlderHistory,
        source: 'resolved_recent',
      };
      await taskSessionCacheFacade.setRecentMessagesPage({
        sessionId,
        userId: currentUser.userId,
        tenantKey,
        payload: responsePayload,
      });

      return res.json({
        success: true,
        data: responsePayload,
      });
    }

    if (shouldHydrateFromNativeHistory) {
      scheduleRecentHistoryHydration(sessionId);
    }

    const page = buildTimelinePage(recentMessages);
    const mayHaveOlderHistory =
      recentMessages.length >= 50 ||
      asText(session?.runtime?.opencodeSessionId).length > 0 ||
      asText(session?.executor) === 'opencode';
    const responsePayload = {
      ...page,
      hasOlderHistory: mayHaveOlderHistory,
      source: taskSessionCacheFacade.isRedisEnabled() ? 'recent_cache' : 'recent_db_no_redis',
    };
    await taskSessionCacheFacade.setRecentMessagesPage({
      sessionId,
      userId: currentUser.userId,
      tenantKey,
      payload: responsePayload,
    });

    return res.json({
      success: true,
      data: responsePayload,
    });
  } catch (error: any) {
    const authError = resolveCurrentUserError(error);
    if (authError) {
      return res.status(authError.status).json({
        success: false,
        error: getPublicErrorMessage(authError.message),
      });
    }
    const ownershipError = resolveOwnedTaskSessionError(error);
    if (ownershipError) {
      return res.status(ownershipError.status).json({
        success: false,
        error: getPublicErrorMessage(ownershipError.message),
      });
    }
    console.error('获取最近消息缓存失败:', error);
    if (isTransientDatabaseError(error)) {
      return respondDatabaseUnavailable(res);
    }
    res.status(500).json({
      success: false,
      error: getPublicErrorMessage('获取最近消息缓存失败，请稍后重试'),
    });
  }
});

/**
 * GET /api/task-creation/sessions/:sessionId/messages/history
 * 按 cursor 增量加载更老历史
 */
router.get('/sessions/:sessionId/messages/history', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const { sessionId } = req.params;
    await requireOwnedTaskSession(sessionId, currentUser.userId, resolveLegacyUserIdHint(req, currentUser.userId));
    const session = await resolveTaskSessionMeta(sessionId);
    const beforeCursor = asTimelineCursor(req.query.before);
    const limit = clampNumber(Number(req.query.limit) || 50, 1, 200);

    const fullTimeline = await resolveRenderableTimelineMessages(sessionId, session);
    const olderMessages =
      beforeCursor !== null
        ? fullTimeline.filter((item) => resolveMessageTimelineCursor(item) < beforeCursor)
        : fullTimeline;
    const pageMessages = olderMessages.slice(Math.max(olderMessages.length - limit, 0));
    const page = buildTimelinePage(pageMessages);
    await taskSessionCacheFacade.setHistoryCursor({
      sessionId,
      userId: currentUser.userId,
      tenantKey: resolveTenantKey(currentUser),
      beforeCursor,
      oldestCursor: page.oldestCursor,
      newestCursor: page.newestCursor,
    });

    return res.json({
      success: true,
      data: {
        ...page,
        hasMore: olderMessages.length > pageMessages.length,
        nextBeforeCursor: page.oldestCursor,
        source: 'resolved_history',
      },
    });
  } catch (error: any) {
    const authError = resolveCurrentUserError(error);
    if (authError) {
      return res.status(authError.status).json({
        success: false,
        error: getPublicErrorMessage(authError.message),
      });
    }
    const ownershipError = resolveOwnedTaskSessionError(error);
    if (ownershipError) {
      return res.status(ownershipError.status).json({
        success: false,
        error: getPublicErrorMessage(ownershipError.message),
      });
    }
    console.error('获取增量历史失败:', error);
    if (isTransientDatabaseError(error)) {
      return respondDatabaseUnavailable(res);
    }
    res.status(500).json({
      success: false,
      error: getPublicErrorMessage('获取增量历史失败，请稍后重试'),
    });
  }
});

/**
 * GET /api/task-creation/sessions/:sessionId/messages
 * 获取会话的对话消息
 */
router.get('/sessions/:sessionId/messages', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const { sessionId } = req.params;
    await requireOwnedTaskSession(sessionId, currentUser.userId, resolveLegacyUserIdHint(req, currentUser.userId));
    const session = await resolveTaskSessionMeta(sessionId);
    const messages = await resolveRenderableTimelineMessages(sessionId, session);

    res.json({
      success: true,
      data: messages,
    });
  } catch (error: any) {
    const authError = resolveCurrentUserError(error);
    if (authError) {
      return res.status(authError.status).json({
        success: false,
        error: getPublicErrorMessage(authError.message),
      });
    }
    const ownershipError = resolveOwnedTaskSessionError(error);
    if (ownershipError) {
      return res.status(ownershipError.status).json({
        success: false,
        error: getPublicErrorMessage(ownershipError.message),
      });
    }
    console.error('获取对话消息失败:', error);
    if (isTransientDatabaseError(error)) {
      return respondDatabaseUnavailable(res);
    }
    res.status(500).json({
      success: false,
      error: getPublicErrorMessage('获取对话消息失败，请稍后重试'),
    });
  }
});

router.post('/attachments/fetch', async (req, res) => {
  try {
    currentUserResolver.require(req);
    const provider = parseRemoteAttachmentProvider(req.body?.provider);
    const sourceUrl = asText(req.body?.url);
    const target = resolveRemoteAttachmentTarget(provider, sourceUrl, {
      allowPrivateHosts: shouldAllowPrivateRemoteAttachmentHosts(),
    });

    const upstream = await fetch(target.fetchUrl, {
      redirect: 'follow',
      headers: {
        'user-agent': 'oneceo-remote-attachment/1.0',
      },
    });
    if (!upstream.ok) {
      throw new Error(`远程文件获取失败 (${upstream.status})`);
    }

    const declaredSize = asPositiveInt(upstream.headers.get('content-length'));
    if (declaredSize !== null && declaredSize > TASK_ATTACHMENT_MAX_BYTES) {
      throw new Error('单个附件不能超过 10 MB');
    }

    const rawBody = Buffer.from(await upstream.arrayBuffer());
    if (!rawBody.length) {
      throw new Error('远程文件内容为空');
    }
    if (rawBody.length > TASK_ATTACHMENT_MAX_BYTES) {
      throw new Error('单个附件不能超过 10 MB');
    }

    const mimeType = asText(upstream.headers.get('content-type')).split(';')[0] || 'application/octet-stream';
    const filename = inferFilenameFromResponse({
      contentDisposition: upstream.headers.get('content-disposition'),
      responseUrl: upstream.url || target.fetchUrl,
      fallbackName: target.suggestedName,
      mimeType,
    });
    if (!isAllowedAttachmentFile({ name: filename, mimeType })) {
      throw new Error('仅支持文本、文档和图片类附件');
    }

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', String(rawBody.length));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader(
      'Access-Control-Expose-Headers',
      'Content-Type, Content-Length, X-Attachment-Name, X-Attachment-Provider'
    );
    res.setHeader('X-Attachment-Name', encodeURIComponent(filename));
    res.setHeader('X-Attachment-Provider', provider);
    return res.status(200).send(rawBody);
  } catch (error: any) {
    console.error('远程附件获取失败:', error);
    const authError = resolveSessionConnectorOwnershipError(error);
    return res.status(authError?.status || 400).json({
      success: false,
      error: getPublicErrorMessage(authError?.message || error?.message || '远程附件获取失败'),
    });
  }
});

router.post(
  '/sessions/:sessionId/attachments',
  express.raw({ type: '*/*', limit: `${TASK_ATTACHMENT_MAX_BYTES}b` }),
  async (req, res) => {
    try {
      const currentUser = currentUserResolver.require(req);
      const { sessionId } = req.params;
      await sessionConnectorService.assertSessionOwnership(sessionId, currentUser.userId);

      const rawBody =
        req.body instanceof Buffer
          ? req.body
          : Buffer.isBuffer(req.body)
            ? req.body
            : Buffer.from(req.body || []);
      if (!rawBody.length) {
        return res.status(400).json({
          success: false,
          error: getPublicErrorMessage('附件内容为空'),
        });
      }
      if (rawBody.length > TASK_ATTACHMENT_MAX_BYTES) {
        return res.status(400).json({
          success: false,
          error: getPublicErrorMessage('单个附件不能超过 10 MB'),
        });
      }

      const originalName = decodeURIComponent(asText(req.header('X-Attachment-Name')) || 'attachment');
      const mimeType = asText(req.header('Content-Type')) || 'application/octet-stream';
      if (!isAllowedAttachmentFile({ name: originalName, mimeType })) {
        return res.status(400).json({
          success: false,
          error: getPublicErrorMessage('仅支持文本、文档和图片类附件'),
        });
      }
      const safeName = sanitizeAttachmentName(originalName);
      const workspaceRoot = resolveOpencodeWorkspacePath(sessionId);
      const runtime = await ensureTaskSessionRuntime(sessionId);
      const orchestratorSessionId = asText(runtime.orchestratorSessionId);
      if (!orchestratorSessionId) {
        throw new Error('执行环境未就绪，无法上传附件');
      }

      const attachmentDir = `${workspaceRoot}/${TASK_ATTACHMENT_DIR}`;
      const storedName = `${Date.now()}-${safeName}`;
      const relativePath = `${TASK_ATTACHMENT_DIR}/${storedName}`;
      const fullPath = `${workspaceRoot}/${relativePath}`;

      await e2bConnector.runCommand(
        orchestratorSessionId,
        `mkdir -p ${shellEscape(attachmentDir)}`,
        { timeoutMs: 15_000 }
      );
      await e2bConnector.writeFile(orchestratorSessionId, fullPath, rawBody);
      await touchSandbox(orchestratorSessionId, 'task_attachment_upload');

      return res.json({
        success: true,
        data: {
          name: originalName || safeName,
          path: relativePath,
          size: rawBody.length,
          mimeType,
          uploadedAt: new Date().toISOString(),
        },
      });
    } catch (error: any) {
      console.error('上传附件失败:', error);
      const ownershipError = resolveSessionConnectorOwnershipError(error);
      return res.status(ownershipError?.status || 400).json({
        success: false,
        error: getPublicErrorMessage(ownershipError?.message || error?.message || '上传附件失败'),
      });
    }
  }
);

router.get('/sessions/:sessionId/deliverables', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const { sessionId } = req.params;
    await sessionConnectorService.assertSessionOwnership(sessionId, currentUser.userId);
    const runId = asText(req.query.runId);
    const deliverables = await taskSessionDeliverableService.listSessionDeliverables(sessionId, {
      runId: runId || null,
    });
    return res.json({
      success: true,
      data: deliverables.map((item) => serializeDeliverableArtifact(item)),
    });
  } catch (error: any) {
    const ownershipError = resolveSessionConnectorOwnershipError(error);
    console.error('获取交付物列表失败:', error);
    return res.status(ownershipError?.status || 400).json({
      success: false,
      error: getPublicErrorMessage(ownershipError?.message || error?.message || '获取交付物列表失败'),
    });
  }
});

router.get('/sessions/:sessionId/deliverables/:artifactId/download', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const { sessionId, artifactId } = req.params;
    await sessionConnectorService.assertSessionOwnership(sessionId, currentUser.userId);
    const artifact = await taskSessionDeliverableService.getSessionDeliverable(sessionId, artifactId);
    if (!artifact) {
      return res.status(404).json({
        success: false,
        error: getPublicErrorMessage('交付物不存在'),
      });
    }

    const body = await downloadFromR2(artifact.storageKey);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', artifact.mimeType || 'application/octet-stream');
    res.setHeader('Content-Length', String(body.length));
    res.setHeader('Content-Disposition', buildAttachmentDisposition(artifact.displayName));
    return res.status(200).send(body);
  } catch (error: any) {
    const ownershipError = resolveSessionConnectorOwnershipError(error);
    console.error('下载交付物失败:', error);
    return res.status(ownershipError?.status || 400).json({
      success: false,
      error: getPublicErrorMessage(ownershipError?.message || error?.message || '下载交付物失败'),
    });
  }
});

/**
 * POST /api/task-creation/sessions/:sessionId/runtime/start
 * 显式启动/恢复任务执行环境
 */
router.post('/sessions/:sessionId/runtime/start', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const { sessionId } = req.params;
    await sessionConnectorService.assertSessionOwnership(sessionId, currentUser.userId);
    const session = await resolveTaskSessionRecord(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: getPublicErrorMessage('会话不存在'),
      });
    }
    const runtime = await ensureTaskSessionRuntime(sessionId);
    return res.json({
      success: true,
      data: runtime,
    });
  } catch (error: any) {
    const ownershipError = resolveSessionConnectorOwnershipError(error);
    if (ownershipError) {
      return res.status(ownershipError.status).json({
        success: false,
        error: getPublicErrorMessage(ownershipError.message),
      });
    }
    if (error?.message === '会话不存在') {
      return res.status(404).json({
        success: false,
        error: getPublicErrorMessage('会话不存在'),
      });
    }
    console.error('启动执行环境失败:', error);
    res.status(isSandboxNotFoundError(error) ? 409 : 500).json({
      success: false,
      error: getPublicErrorMessage(
        isSandboxNotFoundError(error) ? '执行环境已关闭，请重新启动' : '启动执行环境失败，请稍后重试'
      ),
    });
  }
});

/**
 * POST /api/task-creation/sessions/:sessionId/runtime/touch
 * 心跳维持执行环境（用于前端保持会话时防止自动回收）
 */
router.post('/sessions/:sessionId/runtime/touch', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const { sessionId } = req.params;
    await sessionConnectorService.assertSessionOwnership(sessionId, currentUser.userId);
    let session = await taskCreationFileMemoryStore.getSession(sessionId);
    if (!session) {
      session = await hydrateFileSessionFromDb(sessionId);
    }
    if (!session) {
      return res.status(404).json({
        success: false,
        error: getPublicErrorMessage('会话不存在'),
      });
    }

    const orchestratorSessionId = asText(session.runtime?.orchestratorSessionId);
    if (!orchestratorSessionId) {
      return res.status(409).json({
        success: false,
        error: getPublicErrorMessage('执行环境未就绪，无法维持状态'),
      });
    }

    await setSandboxMetadata(orchestratorSessionId, {
      lastHeartbeatAt: new Date().toISOString(),
      lastHeartbeatReason: 'ui_keepalive',
    });
    try {
      await e2bConnector.getSandboxInfo(orchestratorSessionId);
    } catch (error) {
      console.warn('[RUNTIME_TOUCH] sandbox info failed', orchestratorSessionId, error);
    }

    return res.json({
      success: true,
      data: {
        orchestratorSessionId,
        touchedAt: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    const ownershipError = resolveSessionConnectorOwnershipError(error);
    if (ownershipError) {
      return res.status(ownershipError.status).json({
        success: false,
        error: getPublicErrorMessage(ownershipError.message),
      });
    }
    if (error?.message === '会话不存在') {
      return res.status(404).json({
        success: false,
        error: getPublicErrorMessage('会话不存在'),
      });
    }
    console.error('维持执行环境失败:', error);
    res.status(500).json({
      success: false,
      error: getPublicErrorMessage('维持执行环境失败，请稍后重试'),
    });
  }
});

/**
 * POST /api/task-creation/connector-drafts/:draftId
 * 保存 new-task 连接器草稿（Redis 优先）
 */
router.post('/connector-drafts/:draftId', express.json({ limit: '1mb' }), async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const draftId = asText(req.params.draftId);
    if (!draftId) {
      return res.status(400).json({
        success: false,
        error: getPublicErrorMessage('draftId 不能为空'),
      });
    }
    const result = await sessionConnectorDraftService.saveDraft({
      userId: currentUser.userId,
      draftId,
      entries: req.body?.entries,
    });
    return res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    const authError = resolveCurrentUserError(error);
    return res.status(authError?.status || 400).json({
      success: false,
      error: getPublicErrorMessage(authError?.message || error?.message || '保存连接器草稿失败'),
    });
  }
});

/**
 * POST /api/task-creation/connector-drafts/:draftId/apply
 * 将草稿回放到 session 绑定（不阻断主流程）
 */
router.post('/connector-drafts/:draftId/apply', express.json({ limit: '1mb' }), async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const draftId = asText(req.params.draftId);
    const sessionId = asText(req.body?.sessionId);
    if (!draftId || !sessionId) {
      return res.status(400).json({
        success: false,
        error: getPublicErrorMessage('draftId 或 sessionId 缺失'),
      });
    }
    const result = await sessionConnectorDraftService.applyDraftToSession({
      userId: currentUser.userId,
      draftId,
      taskSessionId: sessionId,
      entries: req.body?.entries,
    });
    return res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    const authError = resolveCurrentUserError(error);
    const ownershipError = resolveSessionConnectorOwnershipError(error);
    return res.status(authError?.status || ownershipError?.status || 400).json({
      success: false,
      error: getPublicErrorMessage(
        authError?.message || ownershipError?.message || error?.message || '应用连接器草稿失败'
      ),
    });
  }
});

/**
 * DELETE /api/task-creation/connector-drafts/:draftId
 * 清理已消费草稿
 */
router.delete('/connector-drafts/:draftId', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const draftId = asText(req.params.draftId);
    if (!draftId) {
      return res.status(400).json({
        success: false,
        error: getPublicErrorMessage('draftId 不能为空'),
      });
    }
    const result = await sessionConnectorDraftService.clearDraft(currentUser.userId, draftId);
    return res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    const authError = resolveCurrentUserError(error);
    return res.status(authError?.status || 400).json({
      success: false,
      error: getPublicErrorMessage(authError?.message || error?.message || '清理连接器草稿失败'),
    });
  }
});

/**
 * GET /api/task-creation/sessions/:sessionId/connectors
 * 获取当前会话的连接器运行状态
 */
router.get('/sessions/:sessionId/connectors', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const { sessionId } = req.params;
    await sessionConnectorService.assertSessionOwnership(sessionId, currentUser.userId);
    await connectorGuideService.ensureSessionGuidesUpToDate(sessionId).catch((error) => {
      writeConnectorDebugLog(
        '[CONNECTOR_GUIDE_ON_DEMAND_RECOMPUTE_FAILED]',
        {
          taskSessionId: sessionId,
          userId: currentUser.userId,
          error: error instanceof Error ? error.message : String(error),
        },
        'warn'
      );
    });
    const statuses = await sessionConnectorService.listSessionConnectors(sessionId, currentUser.userId);
    return res.json({
      success: true,
      data: {
        items: statuses,
        summary: sessionConnectorService.summarizeStatuses(statuses),
      },
    });
  } catch (error: any) {
    const ownershipError = resolveSessionConnectorOwnershipError(error);
    return res.status(ownershipError?.status || 401).json({
      success: false,
      error: getPublicErrorMessage(ownershipError?.message || error?.message || '获取会话连接器失败'),
    });
  }
});

/**
 * POST /api/task-creation/sessions/:sessionId/connectors/:connectorKey/attach
 * 热加载当前会话连接器
 */
router.post('/sessions/:sessionId/connectors/:connectorKey/attach', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const { sessionId } = req.params;
    const connectorKey = parseConnectorKey(req.params.connectorKey);
    const profileId = String(req.body?.profileId || '').trim();
    const enabledTools = Array.isArray(req.body?.enabledTools)
      ? req.body.enabledTools.map((item: unknown) => String(item))
      : [];
    const sessionConfig =
      req.body?.sessionConfig && typeof req.body.sessionConfig === 'object' && !Array.isArray(req.body.sessionConfig)
        ? (req.body.sessionConfig as Record<string, unknown>)
        : {};
    writeConnectorDebugLog('[CONNECTOR_ATTACH_ROUTE_START]', {
      taskSessionId: sessionId,
      connectorKey,
      profileId,
      enabledTools,
      sessionConfigKeys: Object.keys(sessionConfig),
      userId: currentUser.userId,
    });
    await sessionConnectorService.assertSessionOwnership(sessionId, currentUser.userId);
    const session = await resolveTaskSessionRecord(sessionId);
    const runtimeOrchestratorSessionId = asText(session?.runtime?.orchestratorSessionId) || undefined;
    if (!profileId) {
      throw new Error('缺少 profileId');
    }
    const status = await sessionConnectorService.attachConnector(
      sessionId,
      currentUser.userId,
      connectorKey,
      profileId,
      enabledTools,
      sessionConfig,
      runtimeOrchestratorSessionId
    );
    return res.json({
      success: true,
      data: {
        connector: status,
      },
    });
  } catch (error: any) {
    const authError = resolveCurrentUserError(error);
    if (authError) {
      return res.status(authError.status).json({
        success: false,
        error: getPublicErrorMessage(authError.message),
      });
    }
    const ownershipError = resolveOwnedTaskSessionError(error);
    const connectorOwnershipError = resolveSessionConnectorOwnershipError(error);
    const attachError = resolveAttachConnectorError(error);
    const message = ownershipError?.message || connectorOwnershipError?.message || error?.message || '挂载连接器失败';
    writeConnectorDebugLog('[CONNECTOR_ATTACH_ROUTE_FAILED]', {
      taskSessionId: req.params.sessionId,
      connectorKey: req.params.connectorKey,
      errorCode: attachError?.code || null,
      error: message,
    }, 'error');
    const normalized = String(message).toLowerCase();
    const status = attachError?.status
      ? attachError.status
      : ownershipError?.status === 403 || connectorOwnershipError?.status === 403
        ? 403
        : connectorOwnershipError?.status === 401
          ? 401
          : normalized.includes('无权') || normalized.includes('登录')
            ? 401
            : normalized.includes('未授权') || normalized.includes('尚未完成授权')
              ? 409
              : normalized.includes('osac 请求超时') || normalized.includes('request timeout')
                ? 504
                : 400;
    return res.status(status).json({
      success: false,
      errorCode: attachError?.code,
      error: getPublicErrorMessage(message),
    });
  }
});

/**
 * POST /api/task-creation/sessions/:sessionId/connectors/:connectorKey/detach
 * 热卸载当前会话连接器
 */
router.post('/sessions/:sessionId/connectors/:connectorKey/detach', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const { sessionId } = req.params;
    const connectorKey = parseConnectorKey(req.params.connectorKey);
    await sessionConnectorService.assertSessionOwnership(sessionId, currentUser.userId);
    const session = await resolveTaskSessionRecord(sessionId);
    const status = await sessionConnectorService.detachConnector(
      sessionId,
      currentUser.userId,
      connectorKey,
      session?.runtime?.orchestratorSessionId
    );
    return res.json({
      success: true,
      data: {
        connector: status,
      },
    });
  } catch (error: any) {
    const authError = resolveCurrentUserError(error);
    if (authError) {
      return res.status(authError.status).json({
        success: false,
        error: getPublicErrorMessage(authError.message),
      });
    }
    const ownershipError = resolveOwnedTaskSessionError(error);
    const connectorOwnershipError = resolveSessionConnectorOwnershipError(error);
    return res.status(ownershipError?.status || connectorOwnershipError?.status || 400).json({
      success: false,
      error: getPublicErrorMessage(
        ownershipError?.message || connectorOwnershipError?.message || error?.message || '卸载连接器失败'
      ),
    });
  }
});

/**
 * POST /api/task-creation/sessions/:sessionId/runtime/interrupt
 * 中断当前会话的直通执行
 */
router.post('/sessions/:sessionId/runtime/interrupt', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const { sessionId } = req.params;
    await sessionConnectorService.assertSessionOwnership(sessionId, currentUser.userId);
    const preserveForRetry = Boolean(req.body?.preserveForRetry ?? true);
    const clientMessageKey = asText(req.body?.clientMessageKey);
    const session = await resolveTaskSessionRecord(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: getPublicErrorMessage('会话不存在'),
      });
    }

    const executor = asText(session.executor || session.runtime?.executor || 'opencode').toLowerCase();
    const orchestratorSessionId = asText(session.runtime?.orchestratorSessionId);
    const executorSessionId =
      asText(session.runtime?.executorSessionId) || asText(session.runtime?.opencodeSessionId);

    const managedInterrupt = await taskCreationWebSocketService.interruptManagedSession(sessionId, {
      preserveForRetry,
      clientMessageKey,
    });
    if (managedInterrupt.interrupted && managedInterrupt.phase === 'intent_processing') {
      return res.json({
        success: true,
        data: {
          interrupted: true,
          phase: 'intent_processing',
          replayPending: managedInterrupt.replayPending,
          reason: 'intent_processing_interrupted',
        },
      });
    }

    if (!orchestratorSessionId) {
      return res.json({
        success: true,
        data: {
          interrupted: false,
          reason: 'runtime_not_ready',
        },
      });
    }

    if (executor === 'codex') {
      const interrupted = await codexRemoteService.interruptCurrentRun(sessionId, orchestratorSessionId);
      return res.json({
        success: true,
        data: {
          interrupted,
          executor: 'codex',
          orchestratorSessionId,
          executorSessionId: executorSessionId || undefined,
        },
      });
    }

    if (executor === 'opencode' || executor === 'claudecode') {
      await osacAgentService.interruptExecutor(orchestratorSessionId, {
        executor: executor as 'opencode' | 'claudecode',
        executorSessionId: executorSessionId || '',
      });
      await touchSandbox(orchestratorSessionId, `${executor}_interrupt`);
      return res.json({
        success: true,
        data: {
          interrupted: true,
          executor,
          orchestratorSessionId,
          executorSessionId: executorSessionId || undefined,
        },
      });
    }

    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(`不支持的 executor: ${executor || 'unknown'}`),
    });
  } catch (error: any) {
    const ownershipError = resolveSessionConnectorOwnershipError(error);
    if (ownershipError) {
      return res.status(ownershipError.status).json({
        success: false,
        error: getPublicErrorMessage(ownershipError.message),
      });
    }
    if (error?.message === '会话不存在') {
      return res.status(404).json({
        success: false,
        error: getPublicErrorMessage('会话不存在'),
      });
    }
    console.error('中断执行环境失败:', error);
    return res.status(500).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '中断执行环境失败，请稍后重试'),
    });
  }
});

/**
 * GET /api/task-creation/sessions/:sessionId/debug
 * 获取调试浏览器信息（仅查询，不触发启动）
 */
router.get('/sessions/:sessionId/debug', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const currentUser = currentUserResolver.require(req);
    const tenantKey = resolveTenantKey(currentUser);
    await requireOwnedTaskSession(sessionId, currentUser.userId, resolveLegacyUserIdHint(req, currentUser.userId));
    let session = await taskCreationFileMemoryStore.getSession(sessionId);
    if (!session) {
      session = await hydrateFileSessionFromDb(sessionId);
    }
    if (!session) {
      return res.status(404).json({
        success: false,
        error: getPublicErrorMessage('会话不存在'),
      });
    }

    const orchestratorSessionId = asText(session.runtime?.orchestratorSessionId);
    if (!orchestratorSessionId) {
      return res.status(409).json({
        success: false,
        error: getPublicErrorMessage('执行环境未就绪，无法获取调试信息'),
      });
    }

    const environment = await sandboxExecutionEnvironmentDAO.getBySessionId(orchestratorSessionId);
    if (!environment) {
      return res.status(404).json({
        success: false,
        error: getPublicErrorMessage('执行环境不存在'),
      });
    }

    const metadata = pickRecord(environment.metadata);
    const debugMeta = pickRecord(metadata.debug);
    const nekoMeta = pickRecord(debugMeta.neko);
    const baseUrl = asText(nekoMeta.baseUrl) || asText(nekoMeta.url);
    const clientUrl = asText(nekoMeta.clientUrl);
    let status = asText(nekoMeta.status) || environment.status;
    let reasonCode = asText(nekoMeta.reasonCode) || undefined;
    let message = baseUrl ? asText(nekoMeta.message) || undefined : '调试服务未配置或未启动';
    if (status === 'running' || status === 'ready') {
      const health = await probeNekoIceHealth(orchestratorSessionId);
      if (health.failed) {
        status = 'failed';
        reasonCode = 'ice_failed';
        message = '远程调试 ICE 连接失败，请检查 TURN 配置后重试';
        await sandboxExecutionEnvironmentDAO.updateMetadata(orchestratorSessionId, {
          ...metadata,
          debug: {
            ...(metadata as any)?.debug,
            neko: {
              ...nekoMeta,
              status,
              reasonCode,
              message,
              updatedAt: new Date().toISOString(),
            },
          },
        });
      }
    }
    const ready = Boolean(baseUrl) && (status === 'running' || status === 'ready') && environment.status === 'ready';

    return res.json({
      success: true,
      data: {
        ready,
        url: clientUrl || baseUrl || undefined,
        status: status || environment.status,
        updatedAt: toIso(environment.updatedAt as any),
        sandboxId: orchestratorSessionId,
        reasonCode,
        message,
      },
    });
  } catch (error: any) {
    const authError = resolveCurrentUserError(error);
    if (authError) {
      return res.status(authError.status).json({
        success: false,
        error: getPublicErrorMessage(authError.message),
      });
    }
    const ownershipError = resolveOwnedTaskSessionError(error);
    if (ownershipError) {
      return res.status(ownershipError.status).json({
        success: false,
        error: getPublicErrorMessage(ownershipError.message),
      });
    }
    console.error('获取调试信息失败:', error);
    res.status(500).json({
      success: false,
      error: getPublicErrorMessage('获取调试信息失败，请稍后重试'),
    });
  }
});

/**
 * POST /api/task-creation/sessions/:sessionId/debug/start
 * 启动调试浏览器（会执行 sandbox 内安装与启动，不创建新 sandbox）
 */
router.post('/sessions/:sessionId/debug/start', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const currentUser = currentUserResolver.require(req);
    const tenantKey = resolveTenantKey(currentUser);
    await requireOwnedTaskSession(sessionId, currentUser.userId, resolveLegacyUserIdHint(req, currentUser.userId));
    let session = await taskCreationFileMemoryStore.getSession(sessionId);
    if (!session) {
      session = await hydrateFileSessionFromDb(sessionId);
    }
    if (!session) {
      return res.status(404).json({
        success: false,
        error: getPublicErrorMessage('会话不存在'),
      });
    }

    const orchestratorSessionId = asText(session.runtime?.orchestratorSessionId);
    if (!orchestratorSessionId) {
      return res.status(409).json({
        success: false,
        error: getPublicErrorMessage('执行环境未就绪，无法启动调试'),
      });
    }

    const environment = await sandboxExecutionEnvironmentDAO.getBySessionId(orchestratorSessionId);
    if (!environment) {
      return res.status(404).json({
        success: false,
        error: getPublicErrorMessage('执行环境不存在'),
      });
    }
    if (environment.status !== 'ready') {
      return res.status(409).json({
        success: false,
        error: getPublicErrorMessage('执行环境未启动，无法启动调试'),
      });
    }

    let dynamicIceServers: Array<{ urls: string[]; username?: string; credential?: string }> | null = null;
    try {
      dynamicIceServers = await cloudflareTurnService.issueIceServersForUser(currentUser.userId);
    } catch (error) {
      console.warn('[TURN_ICE_GENERATE_FAILED]', {
        userId: currentUser.userId,
        sessionId,
        error: error instanceof Error ? error.message : String(error || ''),
      });
    }
    const result = await ensureNekoDebug(orchestratorSessionId, {
      requireTurn: true,
      strictIceCheck: true,
      ...(dynamicIceServers ? { iceServers: dynamicIceServers } : {}),
    });
    return res.json({
      success: true,
      data: {
        ready: result.ready,
        url: result.url,
        status: result.status,
        reasonCode: result.reasonCode,
        updatedAt: result.updatedAt,
        sandboxId: result.sandboxId,
        message: result.message,
      },
    });
  } catch (error: any) {
    const authError = resolveCurrentUserError(error);
    if (authError) {
      return res.status(authError.status).json({
        success: false,
        error: getPublicErrorMessage(authError.message),
      });
    }
    const ownershipError = resolveOwnedTaskSessionError(error);
    if (ownershipError) {
      return res.status(ownershipError.status).json({
        success: false,
        error: getPublicErrorMessage(ownershipError.message),
      });
    }
    console.error('启动调试失败:', error);
    res.status(500).json({
      success: false,
      error: getPublicErrorMessage('启动调试失败，请稍后重试'),
    });
  }
});

/**
 * GET /api/task-creation/sessions/:sessionId/deployment
 * 获取 Railway 部署面板数据
 */
router.get('/sessions/:sessionId/deployment', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const currentUser = currentUserResolver.require(req);
    await sessionConnectorService.assertSessionOwnership(sessionId, currentUser.userId);
    const session = await resolveTaskSessionRecord(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: getPublicErrorMessage('会话不存在'),
      });
    }

    const deploymentId = asText(req.query.deploymentId);
    const data = await buildRailwayDeploymentResponse(currentUser.userId, session, deploymentId || undefined);
    return res.json({
      success: true,
      data,
    });
  } catch (error: any) {
    const authError = resolveCurrentUserError(error);
    const ownershipError = resolveSessionConnectorOwnershipError(error);
    console.error('获取部署信息失败:', error);
    return res.status(authError?.status || ownershipError?.status || 500).json({
      success: false,
      error: getPublicErrorMessage(authError?.message || ownershipError?.message || error?.message || '获取部署信息失败，请稍后重试'),
    });
  }
});

/**
 * POST /api/task-creation/sessions/:sessionId/deployment/deploy
 * 触发 Railway 部署
 */
router.post('/sessions/:sessionId/deployment/deploy', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const currentUser = currentUserResolver.require(req);
    await sessionConnectorService.assertSessionOwnership(sessionId, currentUser.userId);
    const session = await resolveTaskSessionRecord(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: getPublicErrorMessage('会话不存在'),
      });
    }

    const runtime = await ensureTaskSessionRuntime(sessionId);
    const orchestratorSessionId = asText(runtime.orchestratorSessionId);
    const environment = orchestratorSessionId
      ? await sandboxExecutionEnvironmentDAO.getBySessionId(orchestratorSessionId)
      : null;
    const workspaceRoot =
      asText((pickRecord(environment?.metadata) as any).opencodeWorkspaceRoot) ||
      resolveOpencodeWorkspacePath(sessionId);
    if (!orchestratorSessionId || !workspaceRoot) {
      return res.status(400).json({
        success: false,
        error: getPublicErrorMessage('未找到可部署的工作区，请先生成项目文件'),
      });
    }
    const account = await platformDeploymentAccountService.ensureUserAccount(currentUser.userId);
    const deploymentRequestedAt = Date.now();
    const platformDeployment = {
      adminToken: process.env.RAILWAY_ADMIN_TOKEN,
      token: account.accessToken,
      projectId: account.projectId,
      projectName: account.projectName,
      environmentId: account.environmentId,
      environmentName: account.environmentName,
      serviceId: account.serviceId,
      serviceName: account.serviceName,
      repository: account.githubRepoFullName,
    };
    await publishTaskSessionWorkspaceToRepository({
      orchestratorSessionId,
      workspaceRoot,
      repository: {
        owner: account.githubRepoOwner || '',
        name: account.githubRepoName || '',
        fullName: account.githubRepoFullName || '',
        htmlUrl: account.githubRepoUrl,
        defaultBranch: account.githubDefaultBranch || 'main',
      },
      sessionId,
    });
    const metadata = pickRecord(environment?.metadata);
    const actionResult = await waitForRailwayDeploymentAfterSourceSync(
      {
        ...metadata,
        platformDeployment,
      },
      {
        since: deploymentRequestedAt,
        timeoutMs: 120_000,
        pollIntervalMs: 4_000,
      }
    );
    await persistRailwayDeploymentSelection(orchestratorSessionId, environment?.metadata, actionResult);
    const data = await buildRailwayDeploymentResponse(currentUser.userId, session, actionResult.deploymentId);
    return res.json({
      success: true,
      data,
    });
  } catch (error: any) {
    const authError = resolveCurrentUserError(error);
    const ownershipError = resolveSessionConnectorOwnershipError(error);
    console.error('触发部署失败:', error);
    return res.status(authError?.status || ownershipError?.status || 400).json({
      success: false,
      error: getPublicErrorMessage(authError?.message || ownershipError?.message || getDeploymentErrorMessage(error)),
    });
  }
});

/**
 * POST /api/task-creation/sessions/:sessionId/deployment/redeploy
 * 重新部署指定版本
 */
router.post('/sessions/:sessionId/deployment/redeploy', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const currentUser = currentUserResolver.require(req);
    await sessionConnectorService.assertSessionOwnership(sessionId, currentUser.userId);
    const session = await resolveTaskSessionRecord(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: getPublicErrorMessage('会话不存在'),
      });
    }

    const deploymentId = asText(req.body?.deploymentId);
    if (!deploymentId) {
      return res.status(400).json({
        success: false,
        error: getPublicErrorMessage('缺少 deploymentId'),
      });
    }

    const { orchestratorSessionId, environment } = await resolveTaskSessionEnvironment(session);
    const account = await platformDeploymentAccountService.ensureUserAccount(currentUser.userId);
    const metadata = pickRecord(environment?.metadata);
    const actionResult = await triggerRailwayRedeploy(
      {
        ...metadata,
        platformDeployment: {
          adminToken: process.env.RAILWAY_ADMIN_TOKEN,
          token: account.accessToken,
          projectId: account.projectId,
          projectName: account.projectName,
          environmentId: account.environmentId,
          environmentName: account.environmentName,
          serviceId: account.serviceId,
          serviceName: account.serviceName,
        },
      },
      deploymentId
    );
    await persistRailwayDeploymentSelection(orchestratorSessionId, environment?.metadata, actionResult);
    const data = await buildRailwayDeploymentResponse(currentUser.userId, session, actionResult.deploymentId);
    return res.json({
      success: true,
      data,
    });
  } catch (error: any) {
    const authError = resolveCurrentUserError(error);
    const ownershipError = resolveSessionConnectorOwnershipError(error);
    console.error('重新部署失败:', error);
    return res.status(authError?.status || ownershipError?.status || 400).json({
      success: false,
      error: getPublicErrorMessage(authError?.message || ownershipError?.message || getDeploymentErrorMessage(error) || '重新部署失败'),
    });
  }
});

/**
 * POST /api/task-creation/sessions/:sessionId/deployment/rollback
 * 回滚到指定部署版本
 */
router.post('/sessions/:sessionId/deployment/rollback', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const currentUser = currentUserResolver.require(req);
    await sessionConnectorService.assertSessionOwnership(sessionId, currentUser.userId);
    const session = await resolveTaskSessionRecord(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: getPublicErrorMessage('会话不存在'),
      });
    }

    const deploymentId = asText(req.body?.deploymentId);
    if (!deploymentId) {
      return res.status(400).json({
        success: false,
        error: getPublicErrorMessage('缺少 deploymentId'),
      });
    }

    const { orchestratorSessionId, environment } = await resolveTaskSessionEnvironment(session);
    const account = await platformDeploymentAccountService.ensureUserAccount(currentUser.userId);
    const metadata = pickRecord(environment?.metadata);
    const actionResult = await triggerRailwayRollback(
      {
        ...metadata,
        platformDeployment: {
          adminToken: process.env.RAILWAY_ADMIN_TOKEN,
          token: account.accessToken,
          projectId: account.projectId,
          projectName: account.projectName,
          environmentId: account.environmentId,
          environmentName: account.environmentName,
          serviceId: account.serviceId,
          serviceName: account.serviceName,
        },
      },
      deploymentId
    );
    await persistRailwayDeploymentSelection(orchestratorSessionId, environment?.metadata, actionResult);
    const data = await buildRailwayDeploymentResponse(currentUser.userId, session, actionResult.deploymentId);
    return res.json({
      success: true,
      data,
    });
  } catch (error: any) {
    const authError = resolveCurrentUserError(error);
    const ownershipError = resolveSessionConnectorOwnershipError(error);
    console.error('回滚部署失败:', error);
    return res.status(authError?.status || ownershipError?.status || 400).json({
      success: false,
      error: getPublicErrorMessage(authError?.message || ownershipError?.message || getDeploymentErrorMessage(error) || '回滚部署失败'),
    });
  }
});

/**
 * GET /api/task-creation/sessions/:sessionId/deployment/database
 * 获取数据库总览与连接信息
 */
router.get('/sessions/:sessionId/deployment/database', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const currentUser = currentUserResolver.require(req);
    await sessionConnectorService.assertSessionOwnership(sessionId, currentUser.userId);
    const session = await resolveTaskSessionRecord(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: getPublicErrorMessage('会话不存在'),
      });
    }

    const account = await platformDeploymentAccountService.ensureDatabaseResources(currentUser.userId);
    const data = await railwayDatabaseService.getSummary(account);
    return res.json({
      success: true,
      data,
    });
  } catch (error: any) {
    const authError = resolveCurrentUserError(error);
    const ownershipError = resolveSessionConnectorOwnershipError(error);
    console.error('获取数据库信息失败:', error);
    return res.status(authError?.status || ownershipError?.status || 400).json({
      success: false,
      error: getPublicErrorMessage(authError?.message || ownershipError?.message || error?.message || '获取数据库信息失败'),
    });
  }
});

/**
 * GET /api/task-creation/sessions/:sessionId/deployment/database/rows
 * 获取数据库表数据
 */
router.get('/sessions/:sessionId/deployment/database/rows', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const currentUser = currentUserResolver.require(req);
    await sessionConnectorService.assertSessionOwnership(sessionId, currentUser.userId);
    const session = await resolveTaskSessionRecord(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: getPublicErrorMessage('会话不存在'),
      });
    }

    const table = asText(req.query.table);
    if (!table) {
      return res.status(400).json({
        success: false,
        error: getPublicErrorMessage('缺少 table 参数'),
      });
    }

    const page = clampNumber(Number(req.query.page || 1), 1, 10_000);
    const pageSize = clampNumber(Number(req.query.pageSize || 50), 10, 200);
    const account = await platformDeploymentAccountService.ensureDatabaseResources(currentUser.userId);
    const data = await railwayDatabaseService.getRows(account, table, page, pageSize);
    return res.json({
      success: true,
      data,
    });
  } catch (error: any) {
    const authError = resolveCurrentUserError(error);
    const ownershipError = resolveSessionConnectorOwnershipError(error);
    console.error('获取数据库表数据失败:', error);
    return res.status(authError?.status || ownershipError?.status || 400).json({
      success: false,
      error: getPublicErrorMessage(authError?.message || ownershipError?.message || error?.message || '获取数据库表数据失败'),
    });
  }
});

/**
 * POST /api/task-creation/sessions/:sessionId/deployment/database/rows
 * 新增数据库记录
 */
router.post('/sessions/:sessionId/deployment/database/rows', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const currentUser = currentUserResolver.require(req);
    await sessionConnectorService.assertSessionOwnership(sessionId, currentUser.userId);
    const session = await resolveTaskSessionRecord(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: getPublicErrorMessage('会话不存在'),
      });
    }

    const table = asText(req.body?.table);
    const values = pickRecord(req.body?.values);
    if (!table) {
      return res.status(400).json({
        success: false,
        error: getPublicErrorMessage('缺少 table 参数'),
      });
    }

    const account = await platformDeploymentAccountService.ensureDatabaseResources(currentUser.userId);
    const data = await railwayDatabaseService.insertRow(account, table, values);
    return res.json({
      success: true,
      data,
    });
  } catch (error: any) {
    const authError = resolveCurrentUserError(error);
    const ownershipError = resolveSessionConnectorOwnershipError(error);
    console.error('新增数据库记录失败:', error);
    return res.status(authError?.status || ownershipError?.status || 400).json({
      success: false,
      error: getPublicErrorMessage(authError?.message || ownershipError?.message || error?.message || '新增数据库记录失败'),
    });
  }
});

/**
 * PATCH /api/task-creation/sessions/:sessionId/deployment/database/rows
 * 更新数据库记录
 */
router.patch('/sessions/:sessionId/deployment/database/rows', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const currentUser = currentUserResolver.require(req);
    await sessionConnectorService.assertSessionOwnership(sessionId, currentUser.userId);
    const session = await resolveTaskSessionRecord(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: getPublicErrorMessage('会话不存在'),
      });
    }

    const table = asText(req.body?.table);
    const locator = pickRecord(req.body?.locator) as RailwayDatabaseRowLocator;
    const values = pickRecord(req.body?.values);
    if (!table) {
      return res.status(400).json({
        success: false,
        error: getPublicErrorMessage('缺少 table 参数'),
      });
    }

    const account = await platformDeploymentAccountService.ensureDatabaseResources(currentUser.userId);
    const data = await railwayDatabaseService.updateRow(account, table, locator, values);
    return res.json({
      success: true,
      data,
    });
  } catch (error: any) {
    const authError = resolveCurrentUserError(error);
    const ownershipError = resolveSessionConnectorOwnershipError(error);
    console.error('更新数据库记录失败:', error);
    return res.status(authError?.status || ownershipError?.status || 400).json({
      success: false,
      error: getPublicErrorMessage(authError?.message || ownershipError?.message || error?.message || '更新数据库记录失败'),
    });
  }
});

/**
 * DELETE /api/task-creation/sessions/:sessionId/deployment/database/rows
 * 删除数据库记录
 */
router.delete('/sessions/:sessionId/deployment/database/rows', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const currentUser = currentUserResolver.require(req);
    await sessionConnectorService.assertSessionOwnership(sessionId, currentUser.userId);
    const session = await resolveTaskSessionRecord(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: getPublicErrorMessage('会话不存在'),
      });
    }

    const table = asText(req.body?.table);
    const locator = pickRecord(req.body?.locator) as RailwayDatabaseRowLocator;
    if (!table) {
      return res.status(400).json({
        success: false,
        error: getPublicErrorMessage('缺少 table 参数'),
      });
    }

    const account = await platformDeploymentAccountService.ensureDatabaseResources(currentUser.userId);
    const data = await railwayDatabaseService.deleteRow(account, table, locator);
    return res.json({
      success: true,
      data,
    });
  } catch (error: any) {
    const authError = resolveCurrentUserError(error);
    const ownershipError = resolveSessionConnectorOwnershipError(error);
    console.error('删除数据库记录失败:', error);
    return res.status(authError?.status || ownershipError?.status || 400).json({
      success: false,
      error: getPublicErrorMessage(authError?.message || ownershipError?.message || error?.message || '删除数据库记录失败'),
    });
  }
});

/**
 * GET /api/task-creation/sessions/:sessionId/workspace/dir
 * 分页获取指定目录的直接子项（用于前端渐进式加载文件树）
 */
router.get('/sessions/:sessionId/workspace/dir', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const { sessionId } = req.params;
    await requireOwnedTaskSession(sessionId, currentUser.userId, resolveLegacyUserIdHint(req, currentUser.userId));
    const session = await taskCreationFileMemoryStore.getSession(sessionId);
    const tenantKey = resolveTenantKey(currentUser);
    const workspaceRoot = resolveOpencodeWorkspacePath(sessionId);
    const rawPath = String(req.query.path || '').trim();
    const resolvedDirPath = rawPath
      ? resolveWorkspaceRelativeRequestPath(rawPath, workspaceRoot, {
          allowWorkspaceRoot: true,
        })
      : '';
    if (rawPath && resolvedDirPath === null) {
      return res.status(400).json({
        success: false,
        error: getPublicErrorMessage('非法路径'),
      });
    }
    const dirPath = resolvedDirPath || '';
    const limit = clampNumber(Number(req.query.limit || 200), 50, 1000);
    const rawCursor = Number(req.query.cursor || 0);
    const cursor = Number.isFinite(rawCursor) && rawCursor > 0 ? Math.floor(rawCursor) : 0;
    const includeIgnored = !['0', 'false', 'no'].includes(
      String(req.query.includeIgnored ?? '1').trim().toLowerCase()
    );
    const workspaceExecutor = resolveWorkspaceExecutor(session);
    const dirCacheKey = buildWorkspaceDirCacheKey({
      path: dirPath,
      cursor,
      limit,
      includeIgnored,
    });
    const redisCachedPage = !parseRefreshFlag(req.query.refresh)
      ? asWorkspaceDirectoryCachePayload(
          await taskSessionCacheFacade.getWorkspaceDir({
            sessionId,
            userId: currentUser.userId,
            tenantKey,
            cacheKey: dirCacheKey,
          })
        )
      : null;
    if (redisCachedPage) {
      return res.json({
        success: true,
        data: redisCachedPage,
        cache: { hit: true, source: 'redis_workspace_cache' },
      });
    }
    const codexCachedRow =
      isE2bWorkspaceExecutor(workspaceExecutor)
        ? await taskSessionWorkspaceCacheDAO.get({
            sessionId,
            tenantKey,
            cacheType: 'dir',
            cacheKey: dirCacheKey,
          })
        : null;
    const codexCachedPage = asWorkspaceDirectoryCachePayload(codexCachedRow?.data);
    const tryCodexDirFallback = async () => {
      if (!isE2bWorkspaceExecutor(workspaceExecutor)) return null;
      if (!codexCachedPage) return null;
      return res.json({
        success: true,
        data: codexCachedPage,
        cache: { hit: true, stale: true, source: 'db_workspace_cache' },
      });
    };

    const orchestratorSessionId = session?.runtime?.orchestratorSessionId;
    if (!orchestratorSessionId) {
      const fallback = await tryCodexDirFallback();
      if (fallback) return fallback;
      return res.status(409).json({
        success: false,
        error: getPublicErrorMessage('执行环境未就绪，无法读取目录'),
      });
    }
    const runtimeStatus = await resolveRuntimeStatus(orchestratorSessionId);
    if (
      !isE2bWorkspaceExecutor(workspaceExecutor) &&
      runtimeStatus?.status &&
      runtimeStatus.status !== 'ready'
    ) {
      const fallback = await tryCodexDirFallback();
      if (fallback) return fallback;
      return res.status(409).json({
        success: false,
        error: getPublicErrorMessage('执行环境未启动，无法读取目录'),
      });
    }

    const listWorkspaceNodes = async () =>
      isE2bWorkspaceExecutor(workspaceExecutor)
        ? await listSandboxDirectory(orchestratorSessionId, workspaceRoot, dirPath)
        : (await ensureOpencodeServer(orchestratorSessionId, workspaceRoot),
          await listOpencodeDirectory(orchestratorSessionId, workspaceRoot, dirPath));
    let nodes = await listWorkspaceNodes();
    if (isE2bWorkspaceExecutor(workspaceExecutor) && dirPath === '' && nodes.length === 0) {
      const runtime = (session?.runtime || {}) as Record<string, unknown>;
      const restoreSourceKey =
        asText(runtime.codexRestoreSourceKey) || asText(runtime.r2RestoreSourceKey) || asText(runtime.r2ArchiveKey);
      if (restoreSourceKey) {
        try {
          const restored = await restoreWorkspaceIfArchived(orchestratorSessionId);
          if (restored) {
            await taskCreationCacheStore.invalidateWorkspaceBySession(sessionId);
            await taskSessionCacheFacade.invalidateWorkspaceBySessionId(sessionId);
            nodes = await listWorkspaceNodes();
          }
        } catch (restoreError) {
          console.warn('[WORKSPACE_DIR_RESTORE_ON_EMPTY_FAILED]', {
            sessionId,
            orchestratorSessionId,
            error: restoreError instanceof Error ? restoreError.message : String(restoreError),
          });
        }
      }
    }
    const normalizedCandidates = nodes
      .map((node): { path: string; type: 'file' | 'dir'; ignored: boolean } | null => {
        const normalizedPath = normalizeWorkspacePath(node.path || '');
        if (!normalizedPath) return null;
        return {
          path: normalizedPath,
          type: node.type === 'directory' ? 'dir' : 'file',
          ignored: Boolean(node.ignored),
        };
      })
      .filter((item): item is { path: string; type: 'file' | 'dir'; ignored: boolean } => Boolean(item));
    const normalizedItems = sortWorkspaceTreeItems(
      normalizedCandidates
        .filter((item) => includeIgnored || !item.ignored)
        .map((item) => ({ path: item.path, type: item.type }))
    );

    const total = normalizedItems.length;
    const start = Math.min(Math.max(0, cursor), total);
    const end = Math.min(total, start + limit);
    const pageItems = normalizedItems.slice(start, end);
    const livePage = {
      root: workspaceRoot,
      path: dirPath,
      items: pageItems,
      cursor: start,
      total,
      returned: pageItems.length,
      limit,
      hasMore: end < total,
      nextCursor: end < total ? end : null,
    };
    const shouldUseHistoricalCache =
      isE2bWorkspaceExecutor(workspaceExecutor) &&
      dirPath === '' &&
      total === 0 &&
      Boolean(codexCachedPage && codexCachedPage.items.length > 0);
    const shouldUseMessageHistoryFallback =
      isE2bWorkspaceExecutor(workspaceExecutor) &&
      dirPath === '' &&
      total === 0 &&
      !shouldUseHistoricalCache;

    await touchSandbox(orchestratorSessionId, 'workspace_dir');

    if (shouldUseHistoricalCache) {
      return res.json({
        success: true,
        data: codexCachedPage,
        cache: { hit: true, stale: true, source: 'db_workspace_cache', reason: 'live_root_empty' },
      });
    }

    if (shouldUseMessageHistoryFallback) {
      const historyFallback = await buildWorkspaceFallbackFromMessageHistory({
        sessionId,
        workspaceRoot,
        path: dirPath,
        cursor,
        limit,
      });
      if (historyFallback && historyFallback.items.length > 0) {
        return res.json({
          success: true,
          data: historyFallback,
          cache: { hit: true, stale: true, source: 'message_history', reason: 'live_root_empty' },
        });
      }
    }

    if (isE2bWorkspaceExecutor(workspaceExecutor)) {
      await taskSessionCacheFacade.setWorkspaceDir({
        sessionId,
        userId: currentUser.userId,
        tenantKey,
        cacheKey: dirCacheKey,
        payload: livePage,
      });
      await taskSessionWorkspaceCacheDAO.upsert({
        sessionId,
        tenantKey,
        cacheType: 'dir',
        cacheKey: dirCacheKey,
        data: livePage,
      });
    }

    return res.json({
      success: true,
      data: livePage,
    });
  } catch (error: any) {
    const authError = resolveCurrentUserError(error);
    if (authError) {
      return res.status(authError.status).json({
        success: false,
        error: getPublicErrorMessage(authError.message),
      });
    }
    const ownershipError = resolveOwnedTaskSessionError(error);
    if (ownershipError) {
      return res.status(ownershipError.status).json({
        success: false,
        error: getPublicErrorMessage(ownershipError.message),
      });
    }
    const currentUser = currentUserResolver.resolve(req);
    const { sessionId } = req.params;
    const tenantKey = currentUser ? resolveTenantKey(currentUser) : '';
    const session = await taskCreationFileMemoryStore.getSession(sessionId);
    const workspaceExecutor = resolveWorkspaceExecutor(session);
    const rawPath = String(req.query.path || '').trim();
    const workspaceRoot = resolveOpencodeWorkspacePath(sessionId);
    const resolvedDirPath = rawPath
      ? resolveWorkspaceRelativeRequestPath(rawPath, workspaceRoot, {
          allowWorkspaceRoot: true,
        })
      : '';
    const dirPath = resolvedDirPath === null ? normalizeWorkspacePath(rawPath) : resolvedDirPath;
    const limit = clampNumber(Number(req.query.limit || 200), 50, 1000);
    const rawCursor = Number(req.query.cursor || 0);
    const cursor = Number.isFinite(rawCursor) && rawCursor > 0 ? Math.floor(rawCursor) : 0;
    const includeIgnored = !['0', 'false', 'no'].includes(
      String(req.query.includeIgnored ?? '1').trim().toLowerCase()
    );
    if (tenantKey && isE2bWorkspaceExecutor(workspaceExecutor)) {
      const redisCached = await taskSessionCacheFacade.getWorkspaceDir({
        sessionId,
        userId: currentUser?.userId || tenantKey,
        tenantKey,
        cacheKey: buildWorkspaceDirCacheKey({
          path: dirPath,
          cursor,
          limit,
          includeIgnored,
        }),
      });
      const normalizedRedisCached = asWorkspaceDirectoryCachePayload(redisCached);
      if (normalizedRedisCached) {
        return res.json({
          success: true,
          data: normalizedRedisCached,
          cache: { hit: true, stale: true, source: 'redis_workspace_cache' },
        });
      }
      const cached = await taskSessionWorkspaceCacheDAO.get({
        sessionId,
        tenantKey,
        cacheType: 'dir',
        cacheKey: buildWorkspaceDirCacheKey({
          path: dirPath,
          cursor,
          limit,
          includeIgnored,
        }),
      });
      if (cached?.data) {
        return res.json({
          success: true,
          data: cached.data,
          cache: { hit: true, stale: true, source: 'db_workspace_cache' },
        });
      }
    }
    if (isSandboxNotFoundError(error)) {
      const orchestratorSessionId = session?.runtime?.orchestratorSessionId;
      if (orchestratorSessionId) {
        await markSandboxClosed(orchestratorSessionId);
      }
      return res.status(409).json({
        success: false,
        error: getPublicErrorMessage('执行环境已关闭，请重新启动'),
      });
    }
    console.error('获取目录列表失败:', error);
    res.status(500).json({
      success: false,
      error: getPublicErrorMessage('获取目录列表失败，请稍后重试'),
    });
  }
});

/**
 * GET /api/task-creation/sessions/:sessionId/workspace/tree
 * 获取会话对应工作区的文件树
 */
router.get('/sessions/:sessionId/workspace/tree', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const { sessionId } = req.params;
    await requireOwnedTaskSession(sessionId, currentUser.userId, resolveLegacyUserIdHint(req, currentUser.userId));
    const session = await taskCreationFileMemoryStore.getSession(sessionId);
    const refresh = parseRefreshFlag(req.query.refresh);
    const tenantKey = resolveTenantKey(currentUser);
    const workspaceExecutor = resolveWorkspaceExecutor(session);
    if (!refresh) {
      const redisCached = await taskSessionCacheFacade.getWorkspaceTree({
        sessionId,
        userId: currentUser.userId,
        tenantKey,
      });
      if (redisCached) {
        return res.json({
          success: true,
          data: redisCached,
          cache: { hit: true, source: 'redis_workspace_cache' },
        });
      }
      if (isE2bWorkspaceExecutor(workspaceExecutor)) {
        const dbCached = await taskSessionWorkspaceCacheDAO.get({
          sessionId,
          tenantKey,
          cacheType: 'tree',
          cacheKey: '',
        });
        if (dbCached?.data) {
          return res.json({
            success: true,
            data: dbCached.data,
            cache: { hit: true, stale: true, source: 'db_workspace_cache' },
          });
        }
      }
    }

    const orchestratorSessionId = session?.runtime?.orchestratorSessionId;
    if (!orchestratorSessionId) {
      if (isE2bWorkspaceExecutor(workspaceExecutor)) {
        const dbCached = await taskSessionWorkspaceCacheDAO.get({
          sessionId,
          tenantKey,
          cacheType: 'tree',
          cacheKey: '',
        });
        if (dbCached?.data) {
          return res.json({
            success: true,
            data: dbCached.data,
            cache: { hit: true, stale: true, source: 'db_workspace_cache' },
          });
        }
      }
      return res.status(409).json({
        success: false,
        error: getPublicErrorMessage('执行环境未就绪，无法读取工作区'),
      });
    }
    const runtimeStatus = await resolveRuntimeStatus(orchestratorSessionId);
    if (
      !isE2bWorkspaceExecutor(workspaceExecutor) &&
      runtimeStatus?.status &&
      runtimeStatus.status !== 'ready'
    ) {
      if (isE2bWorkspaceExecutor(workspaceExecutor)) {
        const dbCached = await taskSessionWorkspaceCacheDAO.get({
          sessionId,
          tenantKey,
          cacheType: 'tree',
          cacheKey: '',
        });
        if (dbCached?.data) {
          return res.json({
            success: true,
            data: dbCached.data,
            cache: { hit: true, stale: true, source: 'db_workspace_cache' },
          });
        }
      }
      return res.status(409).json({
        success: false,
        error: getPublicErrorMessage('执行环境未启动，无法读取工作区'),
      });
    }

    const workspaceRoot = resolveOpencodeWorkspacePath(sessionId);
    const maxDepth = clampNumber(Number(req.query.depth || 6), 1, 8);
    const maxEntries = clampNumber(Number(req.query.maxEntries || 2000), 200, 5000);

    const parsed =
      isE2bWorkspaceExecutor(workspaceExecutor)
        ? await buildWorkspaceTreeFromSandbox({
            orchestratorSessionId,
            workspaceRoot,
            maxDepth,
            maxEntries,
          })
        : (await ensureOpencodeServer(orchestratorSessionId, workspaceRoot),
          await buildWorkspaceTreeFromOpencode({
            orchestratorSessionId,
            workspaceRoot,
            maxDepth,
            maxEntries,
          }));
    await touchSandbox(orchestratorSessionId, 'workspace_tree');

    const ttlMs = clampNumber(
      Number(process.env.TASK_CREATION_CACHE_TTL_TREE_MS || 10000),
      1000,
      60000
    );
    await taskCreationCacheStore.setWorkspaceTree(tenantKey, sessionId, parsed, ttlMs);
    await taskSessionCacheFacade.setWorkspaceTree({
      sessionId,
      userId: currentUser.userId,
      tenantKey,
      payload: parsed as Record<string, unknown>,
    });
    if (isE2bWorkspaceExecutor(workspaceExecutor)) {
      await taskSessionWorkspaceCacheDAO.upsert({
        sessionId,
        tenantKey,
        cacheType: 'tree',
        cacheKey: '',
        data: parsed as Record<string, unknown>,
      });
    }

    return res.json({
      success: true,
      data: parsed,
      cache: { hit: false },
    });
  } catch (error: any) {
    const authError = resolveCurrentUserError(error);
    if (authError) {
      return res.status(authError.status).json({
        success: false,
        error: getPublicErrorMessage(authError.message),
      });
    }
    const ownershipError = resolveOwnedTaskSessionError(error);
    if (ownershipError) {
      return res.status(ownershipError.status).json({
        success: false,
        error: getPublicErrorMessage(ownershipError.message),
      });
    }
    const currentUser = currentUserResolver.resolve(req);
    const tenantKey = currentUser ? resolveTenantKey(currentUser) : '';
    const { sessionId } = req.params;
    const session = await taskCreationFileMemoryStore.getSession(sessionId);
    if (tenantKey && currentUser) {
      const redisCached = await taskSessionCacheFacade.getWorkspaceTree({
        sessionId,
        userId: currentUser.userId,
        tenantKey,
      });
      if (redisCached) {
        return res.json({
          success: true,
          data: redisCached,
          cache: { hit: true, stale: true, source: 'redis_workspace_cache' },
        });
      }
    }
    if (tenantKey && isE2bWorkspaceExecutor(resolveWorkspaceExecutor(session))) {
      const dbCached = await taskSessionWorkspaceCacheDAO.get({
        sessionId,
        tenantKey,
        cacheType: 'tree',
        cacheKey: '',
      });
      if (dbCached?.data) {
        return res.json({
          success: true,
          data: dbCached.data,
          cache: { hit: true, stale: true, source: 'db_workspace_cache' },
        });
      }
    }
    if (isSandboxNotFoundError(error)) {
      const orchestratorSessionId = session?.runtime?.orchestratorSessionId;
      if (orchestratorSessionId) {
        await markSandboxClosed(orchestratorSessionId);
      }
      return res.status(409).json({
        success: false,
        error: getPublicErrorMessage('执行环境已关闭，请重新启动'),
      });
    }
    const fallback = await taskCreationCacheStore.getWorkspaceTree(tenantKey, sessionId, { allowStale: true });
    if (fallback) {
      return res.json({
        success: true,
        data: fallback.data,
        cache: { hit: true, ageMs: fallback.ageMs, stale: true },
      });
    }
    console.error('获取工作区文件树失败:', error);
    res.status(500).json({
      success: false,
      error: getPublicErrorMessage('获取工作区文件树失败，请稍后重试'),
    });
  }
});

/**
 * GET /api/task-creation/sessions/:sessionId/workspace/file
 * 读取会话工作区内的文件内容
 */
router.get('/sessions/:sessionId/workspace/file', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const { sessionId } = req.params;
    await requireOwnedTaskSession(sessionId, currentUser.userId, resolveLegacyUserIdHint(req, currentUser.userId));
    const rawRequestPath = String(req.query.path || '').trim();
    const session = await taskCreationFileMemoryStore.getSession(sessionId);
    const workspaceRoot = resolveOpencodeWorkspacePath(sessionId);
    const normalizedPath = resolveWorkspaceRelativeRequestPath(rawRequestPath, workspaceRoot);
    if (!normalizedPath) {
      return res.status(400).json({
        success: false,
        error: getPublicErrorMessage('非法路径'),
      });
    }
    const refresh = parseRefreshFlag(req.query.refresh);
    const tenantKey = resolveTenantKey(currentUser);
    const workspaceExecutor = resolveWorkspaceExecutor(session);
    if (!refresh) {
      const redisCached = await taskSessionCacheFacade.getWorkspaceFile({
        sessionId,
        userId: currentUser.userId,
        tenantKey,
        path: normalizedPath,
      });
      if (redisCached) {
        return res.json({
          success: true,
          data: redisCached,
          cache: { hit: true, source: 'redis_workspace_cache' },
        });
      }
      if (isE2bWorkspaceExecutor(workspaceExecutor)) {
        const dbCached = await taskSessionWorkspaceCacheDAO.get({
          sessionId,
          tenantKey,
          cacheType: 'file',
          cacheKey: normalizedPath,
        });
        if (dbCached?.data) {
          return res.json({
            success: true,
            data: dbCached.data,
            cache: { hit: true, stale: true, source: 'db_workspace_cache' },
          });
        }
      }
    }

    const orchestratorSessionId = session?.runtime?.orchestratorSessionId;
    if (!orchestratorSessionId) {
      if (isE2bWorkspaceExecutor(workspaceExecutor)) {
        const dbCached = await taskSessionWorkspaceCacheDAO.get({
          sessionId,
          tenantKey,
          cacheType: 'file',
          cacheKey: normalizedPath,
        });
        if (dbCached?.data) {
          return res.json({
            success: true,
            data: dbCached.data,
            cache: { hit: true, stale: true, source: 'db_workspace_cache' },
          });
        }
      }
      return res.status(409).json({
        success: false,
        error: getPublicErrorMessage('执行环境未就绪，无法读取文件'),
      });
    }
    const runtimeStatus = await resolveRuntimeStatus(orchestratorSessionId);
    if (runtimeStatus?.status && runtimeStatus.status !== 'ready') {
      if (isE2bWorkspaceExecutor(workspaceExecutor)) {
        const dbCached = await taskSessionWorkspaceCacheDAO.get({
          sessionId,
          tenantKey,
          cacheType: 'file',
          cacheKey: normalizedPath,
        });
        if (dbCached?.data) {
          return res.json({
            success: true,
            data: dbCached.data,
            cache: { hit: true, stale: true, source: 'db_workspace_cache' },
          });
        }
      }
      return res.status(409).json({
        success: false,
        error: getPublicErrorMessage('执行环境未启动，无法读取文件'),
      });
    }

    const maxBytes = clampNumber(Number(req.query.maxBytes || 200000), 20000, 500000);
    const maxBinaryBytes = clampNumber(
      Number(req.query.maxBinaryBytes || 2 * 1024 * 1024),
      64 * 1024,
      10 * 1024 * 1024
    );

    let content:
      | OpencodeFileContent
      | {
          type: 'text' | 'binary';
          content: string;
          encoding?: string;
          mimeType?: string;
        };
    let isBinary: boolean;
    let mimeType: string;

    if (isE2bWorkspaceExecutor(workspaceExecutor)) {
      const absolutePath = resolveWorkspaceAbsolutePath(workspaceRoot, normalizedPath);
      const bytes = await e2bConnector.readFile(orchestratorSessionId, absolutePath);
      const buffer = Buffer.from(bytes);
      const hasNullByte = buffer.includes(0);
      const textContent = hasNullByte ? '' : buffer.toString('utf8');
      const binaryHeuristic = hasNullByte || textContent.includes('\uFFFD');
      isBinary = binaryHeuristic;
      mimeType = resolveMimeType(normalizedPath);
      content = {
        type: isBinary ? 'binary' : 'text',
        content: isBinary ? buffer.toString('base64') : textContent,
        encoding: isBinary ? 'base64' : 'utf8',
        mimeType,
      };
    } else {
      await ensureOpencodeServer(orchestratorSessionId, workspaceRoot);
      content = await readOpencodeFile(orchestratorSessionId, workspaceRoot, normalizedPath);
      isBinary = content.type !== 'text' || content.encoding === 'base64';
      mimeType = resolveMimeType(normalizedPath, content.mimeType);
    }

    const previewType = detectPreviewType(normalizedPath, mimeType, isBinary);

    let parsed:
      | {
          path: string;
          content: string;
          truncated: boolean;
          size: number;
          isBinary: boolean;
          encoding: string;
          mimeType: string;
          previewType: WorkspacePreviewType;
          previewAvailable: boolean;
          binaryTooLarge?: boolean;
        }
      | {
          path: string;
          content: string;
          truncated: boolean;
          size: number;
          isBinary: boolean;
          encoding: string;
          mimeType: string;
          previewType: WorkspacePreviewType;
          previewAvailable: boolean;
          binaryTooLarge?: boolean;
        };

    if (isBinary) {
      const encoded = (content.content || '').trim();
      const base64Content =
        content.encoding === 'base64'
          ? encoded
          : Buffer.from(content.content || '', 'utf8').toString('base64');
      const byteSize = estimateBase64Bytes(base64Content);
      const binaryTooLarge = byteSize > maxBinaryBytes;
      const previewableKinds = new Set<WorkspacePreviewType>(['image', 'video', 'audio', 'pdf']);
      parsed = {
        path: normalizedPath,
        content: binaryTooLarge ? '' : base64Content,
        truncated: binaryTooLarge,
        size: byteSize,
        isBinary: true,
        encoding: 'base64',
        mimeType,
        previewType,
        previewAvailable: !binaryTooLarge && previewableKinds.has(previewType),
        binaryTooLarge,
      };
    } else {
      const textContent = content.content || '';
      const trimmed = truncateUtf8(textContent, maxBytes);
      parsed = {
        path: normalizedPath,
        content: trimmed.text,
        truncated: trimmed.truncated,
        size: trimmed.size,
        isBinary: false,
        encoding: 'utf8',
        mimeType,
        previewType,
        previewAvailable: true,
      };
    }

    const ttlMs = clampNumber(
      Number(process.env.TASK_CREATION_CACHE_TTL_FILE_MS || 60000),
      5000,
      300000
    );
    await taskCreationCacheStore.setWorkspaceFile(tenantKey, sessionId, normalizedPath, parsed, ttlMs);
    await taskSessionCacheFacade.setWorkspaceFile({
      sessionId,
      userId: currentUser.userId,
      tenantKey,
      path: normalizedPath,
      payload: parsed as Record<string, unknown>,
    });
    if (isE2bWorkspaceExecutor(workspaceExecutor)) {
      await taskSessionWorkspaceCacheDAO.upsert({
        sessionId,
        tenantKey,
        cacheType: 'file',
        cacheKey: normalizedPath,
        data: parsed as Record<string, unknown>,
      });
    }
    await touchSandbox(orchestratorSessionId, 'workspace_file');

    return res.json({
      success: true,
      data: parsed,
      cache: { hit: false },
    });
  } catch (error: any) {
    const authError = resolveCurrentUserError(error);
    if (authError) {
      return res.status(authError.status).json({
        success: false,
        error: getPublicErrorMessage(authError.message),
      });
    }
    const ownershipError = resolveOwnedTaskSessionError(error);
    if (ownershipError) {
      return res.status(ownershipError.status).json({
        success: false,
        error: getPublicErrorMessage(ownershipError.message),
      });
    }
    const currentUser = currentUserResolver.resolve(req);
    const tenantKey = currentUser ? resolveTenantKey(currentUser) : '';
    const { sessionId } = req.params;
    const session = await taskCreationFileMemoryStore.getSession(sessionId);
    const workspaceRoot = resolveOpencodeWorkspacePath(sessionId);
    const normalizedPath =
      resolveWorkspaceRelativeRequestPath(String(req.query.path || '').trim(), workspaceRoot) ||
      normalizeWorkspacePath(String(req.query.path || '').trim());
    if (tenantKey && currentUser) {
      const redisCached = await taskSessionCacheFacade.getWorkspaceFile({
        sessionId,
        userId: currentUser.userId,
        tenantKey,
        path: normalizedPath,
      });
      if (redisCached) {
        return res.json({
          success: true,
          data: redisCached,
          cache: { hit: true, stale: true, source: 'redis_workspace_cache' },
        });
      }
    }
    if (isSandboxNotFoundError(error)) {
      const orchestratorSessionId = session?.runtime?.orchestratorSessionId;
      if (orchestratorSessionId) {
        await markSandboxClosed(orchestratorSessionId);
      }
      if (tenantKey && isE2bWorkspaceExecutor(resolveWorkspaceExecutor(session))) {
        const dbCached = await taskSessionWorkspaceCacheDAO.get({
          sessionId,
          tenantKey,
          cacheType: 'file',
          cacheKey: normalizedPath,
        });
        if (dbCached?.data) {
          return res.json({
            success: true,
            data: dbCached.data,
            cache: { hit: true, stale: true, source: 'db_workspace_cache' },
          });
        }
      }
      return res.status(409).json({
        success: false,
        error: getPublicErrorMessage('执行环境已关闭，请重新启动'),
      });
    }
    if (isE2bWorkspaceExecutor(resolveWorkspaceExecutor(session))) {
      const dbCached = await taskSessionWorkspaceCacheDAO.get({
        sessionId,
        tenantKey,
        cacheType: 'file',
        cacheKey: normalizedPath,
      });
      if (dbCached?.data) {
        return res.json({
          success: true,
          data: dbCached.data,
          cache: { hit: true, stale: true, source: 'db_workspace_cache' },
        });
      }
    }
    const fallback = await taskCreationCacheStore.getWorkspaceFile(tenantKey, sessionId, normalizedPath, {
      allowStale: true,
    });
    if (fallback) {
      return res.json({
        success: true,
        data: fallback.data,
        cache: { hit: true, ageMs: fallback.ageMs, stale: true },
      });
    }
    console.error('读取工作区文件失败:', error);
    res.status(500).json({
      success: false,
      error: getPublicErrorMessage('读取工作区文件失败，请稍后重试'),
    });
  }
});

async function handleWorkspaceRawRequest(
  req: express.Request,
  res: express.Response,
  options?: { headOnly?: boolean }
) {
  const headOnly = options?.headOnly === true;
  try {
    const { sessionId } = req.params;
    const currentUser = currentUserResolver.require(req);
    const tenantKey = resolveTenantKey(currentUser);
    await requireOwnedTaskSession(sessionId, currentUser.userId, resolveLegacyUserIdHint(req, currentUser.userId));
    const wildcardPath = String((req.params as Record<string, string | undefined>)['0'] || '').trim();
    const workspaceRoot = resolveOpencodeWorkspacePath(sessionId);
    const normalizedPath = resolveWorkspaceRelativeRequestPath(wildcardPath, workspaceRoot);
    if (!normalizedPath) {
      return res.status(400).type('text/plain; charset=utf-8').send('非法路径');
    }
    const session = await taskCreationFileMemoryStore.getSession(sessionId);
    if (!session) {
      return res.status(404).type('text/plain; charset=utf-8').send('会话不存在');
    }

    const workspaceExecutor = resolveWorkspaceExecutor(session);
    const orchestratorSessionId = session?.runtime?.orchestratorSessionId;
    if (!orchestratorSessionId) {
      return res.status(409).type('text/plain; charset=utf-8').send('执行环境未就绪，无法读取文件');
    }

    const runtimeStatus = await resolveRuntimeStatus(orchestratorSessionId);
    if (runtimeStatus?.status && runtimeStatus.status !== 'ready') {
      return res.status(409).type('text/plain; charset=utf-8').send('执行环境未启动，无法读取文件');
    }

    let buffer: Buffer | null = null;
    let mimeType = resolveMimeType(normalizedPath);

    if (isE2bWorkspaceExecutor(workspaceExecutor)) {
      const absolutePath = resolveWorkspaceAbsolutePath(workspaceRoot, normalizedPath);
      let rawContent: Uint8Array | null = null;
      try {
        rawContent = await e2bConnector.readFile(orchestratorSessionId, absolutePath);
      } catch (readError) {
        if (!isWorkspaceFileNotFoundError(readError)) {
          throw readError;
        }
        let rebuilt = false;
        const restored = await tryRestoreWorkspaceForPreviewRead(
          sessionId,
          orchestratorSessionId,
          session,
        );
        if (restored) {
          try {
            rawContent = await e2bConnector.readFile(orchestratorSessionId, absolutePath);
            rebuilt = true;
          } catch (afterRestoreError) {
            if (!isWorkspaceFileNotFoundError(afterRestoreError)) {
              throw afterRestoreError;
            }
          }
        }
        if (!rebuilt) {
          const recovered = await tryRebuildWorkspaceFileForPreview({
            sessionId,
            tenantKey,
            normalizedPath,
            workspaceRoot,
            orchestratorSessionId,
          });
          if (!recovered) {
            throw readError;
          }
          rawContent = await e2bConnector.readFile(orchestratorSessionId, absolutePath);
        }
      }
      if (!rawContent) {
        throw new Error('workspace_raw_content_unavailable');
      }
      if (!headOnly) {
        buffer = Buffer.from(rawContent);
      }
    } else {
      await ensureOpencodeServer(orchestratorSessionId, workspaceRoot);
      const content = await readOpencodeFile(orchestratorSessionId, workspaceRoot, normalizedPath);
      mimeType = resolveMimeType(normalizedPath, content.mimeType);
      if (!headOnly) {
        const isBinary = content.type !== 'text' || content.encoding === 'base64';
        if (isBinary) {
          const encoded =
            content.encoding === 'base64'
              ? String(content.content || '').trim()
              : Buffer.from(String(content.content || ''), 'utf8').toString('base64');
          buffer = Buffer.from(encoded, 'base64');
        } else {
          buffer = Buffer.from(String(content.content || ''), 'utf8');
        }
      }
    }

    await touchSandbox(orchestratorSessionId, 'workspace_file');

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader(
      'Content-Type',
      isTextLikeMimeType(mimeType) ? `${mimeType}; charset=utf-8` : mimeType
    );
    if (headOnly) {
      return res.status(200).end();
    }
    return res.status(200).send(buffer || Buffer.alloc(0));
  } catch (error: any) {
    const authError = resolveCurrentUserError(error);
    if (authError) {
      return res.status(authError.status).type('text/plain; charset=utf-8').send(getPublicErrorMessage(authError.message));
    }
    const ownershipError = resolveOwnedTaskSessionError(error);
    if (ownershipError) {
      return res
        .status(ownershipError.status)
        .type('text/plain; charset=utf-8')
        .send(getPublicErrorMessage(ownershipError.message));
    }
    const { sessionId } = req.params;
    const session = await taskCreationFileMemoryStore.getSession(sessionId);
    if (isSandboxNotFoundError(error)) {
      const orchestratorSessionId = session?.runtime?.orchestratorSessionId;
      if (orchestratorSessionId) {
        await markSandboxClosed(orchestratorSessionId);
      }
      return res.status(409).type('text/plain; charset=utf-8').send('执行环境已关闭，请重新启动');
    }
    if (isWorkspaceFileNotFoundError(error)) {
      return res.status(409).type('text/plain; charset=utf-8').send('预览暂不可用，请重新加载预览');
    }
    console.error('获取工作区原始文件失败:', error);
    return res.status(500).type('text/plain; charset=utf-8').send('获取工作区原始文件失败，请稍后重试');
  }
}

/**
 * HEAD /api/task-creation/sessions/:sessionId/workspace/raw/*
 * 预检查文件原始预览是否可用（不返回正文）
 */
router.head('/sessions/:sessionId/workspace/raw/*', async (req, res) => {
  return handleWorkspaceRawRequest(req, res, { headOnly: true });
});

/**
 * GET /api/task-creation/sessions/:sessionId/workspace/raw/*
 * 以原始内容返回会话工作区内的单个文件，供 iframe 预览和新标签页打开使用
 */
router.get('/sessions/:sessionId/workspace/raw/*', async (req, res) => {
  return handleWorkspaceRawRequest(req, res, { headOnly: false });
});

/**
 * GET /api/task-creation/sessions/:sessionId/opencode/events
 * SSE 转发 OpenCode 全局事件流（按会话过滤）。
 *
 * 注意：即使是“sandbox 直通”模式，也必须走编排平台转发，
 * 以保证事件落盘与历史回放一致，避免前端直连 sandbox 导致丢消息。
 */
router.get('/sessions/:sessionId/opencode/events', async (req, res) => {
  const { sessionId } = req.params;
  let session: FileSessionRecord | null = null;
  let currentUser: ReturnType<typeof currentUserResolver.require> | null = null;
  try {
    currentUser = currentUserResolver.require(req);
    await requireOwnedTaskSession(sessionId, currentUser.userId, resolveLegacyUserIdHint(req, currentUser.userId));
  } catch (error) {
    const authError = resolveCurrentUserError(error);
    if (authError) {
      return res.status(authError.status).json({
        success: false,
        error: getPublicErrorMessage(authError.message),
      });
    }
    const ownershipError = resolveOwnedTaskSessionError(error);
    if (ownershipError) {
      return res.status(ownershipError.status).json({
        success: false,
        error: getPublicErrorMessage(ownershipError.message),
      });
    }
    throw error;
  }
  try {
    session = await resolveTaskSessionRecord(sessionId);
  } catch (error) {
    console.error('获取 OpenCode 事件流会话失败:', error);
    if (isTransientDatabaseError(error)) {
      return respondDatabaseUnavailable(res);
    }
    return res.status(500).json({
      success: false,
      error: getPublicErrorMessage('读取会话失败，请稍后重试'),
    });
  }
  if (!session) {
    return res.status(404).json({
      success: false,
      error: getPublicErrorMessage('会话不存在'),
    });
  }

  const orchestratorSessionId = session.runtime?.orchestratorSessionId;
  if (!orchestratorSessionId) {
    return respondEphemeralSseBridge(res, {
      status: 'runtime_unavailable',
      reason: 'missing_orchestrator_session',
      sessionId,
      retryAfterMs: 5000,
      relay: 'backend_only',
    });
  }
  opencodeEventStreamService.bindSession(orchestratorSessionId, sessionId, session.mode);

  let runtimeStatus: Awaited<ReturnType<typeof resolveRuntimeStatus>>;
  try {
    runtimeStatus = await resolveRuntimeStatus(orchestratorSessionId);
  } catch (error) {
    console.error('获取 OpenCode 事件流运行时状态失败:', error);
    if (isTransientDatabaseError(error)) {
      return respondDatabaseUnavailable(res);
    }
    return res.status(500).json({
      success: false,
      error: getPublicErrorMessage('读取执行环境状态失败，请稍后重试'),
    });
  }
  if (runtimeStatus?.status && runtimeStatus.status !== 'ready') {
    return respondEphemeralSseBridge(res, {
      status: 'runtime_not_ready',
      reason: runtimeStatus.status,
      sessionId,
      orchestratorSessionId,
      retryAfterMs: 5000,
      relay: 'backend_only',
    });
  }

  const opencodeSessionId =
    (typeof req.query.opencodeSessionId === 'string' && req.query.opencodeSessionId.trim()) ||
    session.runtime?.opencodeSessionId ||
    '';
  const clientId = parseSseClientId(req);

  const workspaceRoot = resolveOpencodeWorkspacePath(sessionId);
  const filterSessionId = String(opencodeSessionId || '').trim();
  const parseSince = (value: unknown): number => {
    if (!value) return 0;
    if (Array.isArray(value)) {
      return parseSince(value[0]);
    }
    const raw = String(value || '').trim();
    if (!raw) return 0;
    const asNumber = Number(raw);
    if (!Number.isNaN(asNumber) && Number.isFinite(asNumber)) {
      return asNumber;
    }
    const parsed = Date.parse(raw);
    return Number.isNaN(parsed) ? 0 : parsed;
  };
  const querySince = parseSince(req.query.since);
  const headerSince = parseSince(
    req.headers['last-event-id'] || (req.headers as Record<string, unknown>)['Last-Event-ID']
  );
  const sinceParam = querySince || headerSince;
  let connection: ReturnType<typeof registerSseClientConnection> | null = null;
  let replayCursor = sinceParam;
  let isTimestampCursor = replayCursor >= 1_000_000_000_000;
  let fallbackReplayTs = Date.now();

  try {
    await osacAgentService.ensureOpencodeServer(orchestratorSessionId, {
      workspacePath: workspaceRoot,
    });
  } catch (error: any) {
    if (isSandboxNotFoundError(error)) {
      await markSandboxClosed(orchestratorSessionId);
      return respondEphemeralSseBridge(res, {
        status: 'runtime_closed',
        reason: 'sandbox_not_found',
        sessionId,
        orchestratorSessionId,
        retryAfterMs: 5000,
        relay: 'backend_only',
      });
    }
    return res.status(502).json({
      success: false,
      error: getPublicErrorMessage(error?.message || 'OpenCode 服务未就绪'),
    });
  }

  connection = registerSseClientConnection(sessionId, clientId);
  const activeConnection = connection;
  const stateCursor =
    activeConnection.reconnecting && activeConnection.state.lastCursor > 0
      ? activeConnection.state.lastCursor
      : 0;
  if (!replayCursor) {
    replayCursor = stateCursor;
  } else if (stateCursor > 0) {
    const queryIsTimestamp = isTimestampCursorValue(replayCursor);
    const stateIsTimestamp = isTimestampCursorValue(stateCursor);
    replayCursor =
      queryIsTimestamp === stateIsTimestamp
        ? Math.max(replayCursor, stateCursor)
        : stateCursor;
  }
  isTimestampCursor = isTimestampCursorValue(replayCursor);
  fallbackReplayTs =
    activeConnection.previousDisconnectedAt > 0
      ? activeConnection.previousDisconnectedAt
      : activeConnection.state.connectedAt;
  console.log(
    '[OPENCODE_SSE_CLIENT_CONNECTED]',
    JSON.stringify({
      sessionId,
      orchestratorSessionId,
      clientId,
      reconnecting: activeConnection.reconnecting,
      replayCursor,
      connectedAt: new Date(activeConnection.state.connectedAt).toISOString(),
      previousDisconnectedAt: activeConnection.previousDisconnectedAt
        ? new Date(activeConnection.previousDisconnectedAt).toISOString()
        : null,
    })
  );

  await touchSandbox(orchestratorSessionId, 'opencode_events');

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const pingMs = Math.max(5000, Number(process.env.OPENCODE_EVENT_PROXY_PING_MS || 15000));

  const pingTimer = setInterval(() => {
    res.write(': ping\n\n');
  }, pingMs);

  if (replayCursor) {
    try {
      const redisHistory = await taskSessionCacheFacade.listSessionEvents({
        sessionId,
        userId: currentUser?.userId || '',
        tenantKey: currentUser ? resolveTenantKey(currentUser) : '',
        afterEventId: replayCursor,
      });
      if (redisHistory.length > 0) {
        for (const item of redisHistory) {
          writeSse(res, {
            sessionId,
            type: item.messageType,
            content: item.content,
            metadata: {
              ...pickRecord(item.metadata),
              messageKey: item.messageKey,
            },
            messageKey: item.messageKey,
            createdAt: item.createdAt,
          }, undefined, item.eventId);
          updateSseClientCursor(activeConnection.key, item.eventId);
        }
      } else {
        const history = await taskCreationFileMemoryStore.getMessages(sessionId);
        const pickCursorFromItem = (item: any) => {
        const meta = pickRecord(item?.metadata);
        const sessionEventSeq = asPositiveInt(meta.sessionEventSeq);
        const seq = Number(meta.seq);
        const tsMeta = Number(meta.timestamp);
        const tsCreated = item?.createdAt ? Date.parse(item.createdAt) : NaN;
        if (isTimestampCursor) {
          if (sessionEventSeq !== null) return sessionEventSeq;
          if (Number.isFinite(tsMeta) && tsMeta > 0) return tsMeta;
          if (Number.isFinite(tsCreated) && tsCreated > 0) return tsCreated;
          if (Number.isFinite(seq) && seq > 0) return seq;
          return 0;
        }
        if (sessionEventSeq !== null) return sessionEventSeq;
        if (Number.isFinite(seq) && seq > 0) return seq;
        if (Number.isFinite(tsMeta) && tsMeta > fallbackReplayTs) return tsMeta;
        if (Number.isFinite(tsCreated) && tsCreated > fallbackReplayTs) return tsCreated;
        return 0;
      };
        const filtered = history
          .filter((item) =>
            item.messageType === 'opencode_event' ||
            item.messageType === 'opencode_error' ||
            item.messageType === 'status_update'
          )
          .filter((item) => {
            const cursor = pickCursorFromItem(item);
            if (!Number.isFinite(cursor) || cursor <= 0) return false;
            return cursor > replayCursor;
          })
          .filter((item) => {
            if (!filterSessionId) return true;
            const metadata = pickRecord(item.metadata);
            const msgOpencodeSessionId = asText(metadata.opencodeSessionId);
            if (!msgOpencodeSessionId) return false;
            return msgOpencodeSessionId === filterSessionId;
          })
          .sort((a, b) => {
            const ma = pickRecord(a?.metadata);
            const mb = pickRecord(b?.metadata);
            const ta = asTimelineCursor(ma.timestamp);
            const tb = asTimelineCursor(mb.timestamp);
            if (ta !== null && tb !== null && ta !== tb) {
              return ta - tb;
            }
            if (ta !== null && tb === null) return -1;
            if (ta === null && tb !== null) return 1;
            const ca = a.createdAt ? Date.parse(a.createdAt) : null;
            const cb = b.createdAt ? Date.parse(b.createdAt) : null;
            if (ca !== null && cb !== null && ca !== cb) {
              return ca - cb;
            }
            if (ca !== null && cb === null) return -1;
            if (ca === null && cb !== null) return 1;
            const sa = asPositiveInt(ma.seq);
            const sb = asPositiveInt(mb.seq);
            if (sa !== null && sb !== null) {
              return sa - sb;
            }
            return 0;
          })
          .slice(-500);
        for (const item of filtered) {
          const meta = pickRecord(item.metadata);
          const sessionEventSeq = asPositiveInt(meta.sessionEventSeq);
          const timestampEventId = Number(meta.timestamp);
          const createdAtEventId = item.createdAt ? Date.parse(item.createdAt) : NaN;
          const seqEventId = Number(meta.seq);
          const eventId =
            (sessionEventSeq !== null ? sessionEventSeq : undefined) ??
            (Number.isFinite(timestampEventId) && timestampEventId > 0 ? timestampEventId : undefined) ??
            (Number.isFinite(createdAtEventId) && createdAtEventId > 0 ? createdAtEventId : undefined) ??
            (Number.isFinite(seqEventId) && seqEventId > 0 ? seqEventId : undefined);
          const messageKey = buildTimelineMessageKey({
            id: item.id,
            messageType: item.messageType,
            metadata: item.metadata,
            createdAt: item.createdAt,
          });
          writeSse(res, {
            sessionId,
            type: item.messageType,
            content: item.content,
            metadata: {
              ...pickRecord(item.metadata),
              messageKey,
            },
            messageKey,
            createdAt: item.createdAt,
          }, undefined, Number.isFinite(eventId as number) ? (eventId as number) : undefined);
          if (Number.isFinite(eventId as number) && (eventId as number) > 0) {
            updateSseClientCursor(activeConnection.key, eventId as number);
          }
        }
      }
    } catch (error) {
      console.warn('[OPENCODE_SSE_REPLAY_FAILED]', error);
    }
  }

  const unsubscribe = opencodeEventStreamService.subscribe(orchestratorSessionId, (payload) => {
    const msgOpencodeSessionId = String(payload.opencodeSessionId || '').trim();
    if (filterSessionId && msgOpencodeSessionId && msgOpencodeSessionId !== filterSessionId) {
      return;
    }
    if (
      (payload.eventType === 'message.part.updated' || payload.eventType === 'message.part.delta') &&
      (() => {
        const properties = pickRecord(payload.event?.properties);
        const part = pickRecord(properties.part);
        const partType = asText(part.type) || asText(properties.type);
        const normalized = partType.trim().toLowerCase();
        return normalized === 'text' || normalized === 'reasoning';
      })()
    ) {
      return;
    }
    const projected = opencodeEventStreamService.projectForClient({
      orchestratorSessionId,
      opencodeSessionId: msgOpencodeSessionId || undefined,
      eventType: payload.eventType,
      event: payload.event,
      seq: payload.seq,
      timestamp: payload.timestamp,
      sessionEventSeq: payload.sessionEventSeq,
    });
    const createdAt = new Date(payload.timestamp || Date.now()).toISOString();
    const messageKey = buildTimelineMessageKey({
      messageType: projected.type,
      metadata: {
        ...pickRecord(projected.metadata),
        opencodeSessionId: msgOpencodeSessionId || undefined,
        sessionEventSeq: payload.sessionEventSeq,
        timestamp: payload.timestamp,
      },
      createdAt,
    });
    const liveEventId =
      (typeof payload.sessionEventSeq === 'number' &&
      Number.isFinite(payload.sessionEventSeq) &&
      payload.sessionEventSeq > 0
        ? payload.sessionEventSeq
        : undefined) ??
      (typeof payload.timestamp === 'number' && Number.isFinite(payload.timestamp) && payload.timestamp > 0
        ? payload.timestamp
        : undefined) ??
      (typeof payload.seq === 'number' && Number.isFinite(payload.seq) && payload.seq > 0
        ? payload.seq
        : undefined) ??
      Date.parse(createdAt);
    writeSse(
      res,
      {
        sessionId,
        ...projected,
        messageKey,
        opencodeSessionId: msgOpencodeSessionId || undefined,
        eventType: payload.eventType,
        event: payload.event,
        createdAt,
        metadata: {
          ...pickRecord(projected.metadata),
          messageKey,
        },
      },
      undefined,
      Number.isFinite(liveEventId as number) ? (liveEventId as number) : undefined
    );
    if (Number.isFinite(liveEventId as number) && (liveEventId as number) > 0) {
      updateSseClientCursor(activeConnection.key, liveEventId as number);
    }
  });
  const unsubscribeTerminal = opencodeRemoteService.subscribe(({ taskSessionId, message }) => {
    if (taskSessionId !== sessionId) {
      return;
    }
    const metadata = pickRecord(message.metadata);
    const msgOpencodeSessionId = asText(metadata.opencodeSessionId);
    if (filterSessionId && msgOpencodeSessionId && msgOpencodeSessionId !== filterSessionId) {
      return;
    }
    const createdAt = new Date().toISOString();
    const messageKey = buildTimelineMessageKey({
      messageType: message.type,
      metadata: message.metadata,
      createdAt,
    });
    const liveEventId =
      asPositiveInt(metadata.sessionEventSeq) ??
      asTimelineCursor(metadata.timestamp) ??
      Date.parse(createdAt);
    writeSse(
      res,
      {
        sessionId,
        type: message.type,
        content: message.content,
        metadata: {
          ...metadata,
          messageKey,
        },
        messageKey,
        stage: message.stage,
        phase: message.phase,
        tone: message.tone,
        createdAt,
      },
      undefined,
      Number.isFinite(liveEventId as number) ? (liveEventId as number) : undefined
    );
    if (Number.isFinite(liveEventId as number) && (liveEventId as number) > 0) {
      updateSseClientCursor(activeConnection.key, liveEventId as number);
    }
  });

  writeSse(
    res,
    {
      status: 'connected',
      reconnecting: activeConnection.reconnecting,
      clientId,
      connectedAt: new Date(activeConnection.state.connectedAt).toISOString(),
      disconnectedAt: activeConnection.previousDisconnectedAt
        ? new Date(activeConnection.previousDisconnectedAt).toISOString()
        : undefined,
      replayCursor: replayCursor || undefined,
      relay: 'backend_only',
    },
    'bridge'
  );

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clearInterval(pingTimer);
    unsubscribe();
    unsubscribeTerminal();
    console.log(
      '[OPENCODE_SSE_CLIENT_DISCONNECTED]',
      JSON.stringify({
        sessionId,
        orchestratorSessionId,
        clientId,
        lastCursor: sseClientState.get(activeConnection.key)?.lastCursor || 0,
        disconnectedAt: new Date().toISOString(),
      })
    );
    markSseClientDisconnected(activeConnection.key);
    res.end();
  };

  req.on('close', cleanup);
  req.on('error', cleanup);

  writeSse(res, { status: 'ready', opencodeSessionId: opencodeSessionId || undefined }, 'ready');
  return undefined;
});

/**
 * GET /api/task-creation/sessions/:sessionId/intent
 * 获取会话的意图识别结果
 */
router.get('/sessions/:sessionId/intent', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const currentUser = currentUserResolver.require(req);
    await requireOwnedTaskSession(sessionId, currentUser.userId, resolveLegacyUserIdHint(req, currentUser.userId));

    const intentResult = await taskCreationSessionDAO.getIntentResult(sessionId);

    if (!intentResult) {
      return res.status(404).json({
        success: false,
        error: '意图识别结果不存在',
      });
    }

    res.json({
      success: true,
      data: intentResult,
    });
  } catch (error: any) {
    const authError = resolveCurrentUserError(error);
    if (authError) {
      return res.status(authError.status).json({
        success: false,
        error: getPublicErrorMessage(authError.message),
      });
    }
    const ownershipError = resolveOwnedTaskSessionError(error);
    if (ownershipError) {
      return res.status(ownershipError.status).json({
        success: false,
        error: getPublicErrorMessage(ownershipError.message),
      });
    }
    console.error('获取意图识别结果失败:', error);
    if (isTransientDatabaseError(error)) {
      return respondDatabaseUnavailable(res);
    }
    res.status(500).json({
      success: false,
      error: getPublicErrorMessage('获取意图识别结果失败，请稍后重试'),
    });
  }
});

/**
 * GET /api/task-creation/sessions/:sessionId/task-description
 * 获取会话的任务描述
 */
router.get('/sessions/:sessionId/task-description', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const currentUser = currentUserResolver.require(req);
    await requireOwnedTaskSession(sessionId, currentUser.userId, resolveLegacyUserIdHint(req, currentUser.userId));

    const taskDescription = await taskCreationSessionDAO.getTaskDescription(sessionId);

    if (!taskDescription) {
      return res.status(404).json({
        success: false,
        error: '任务描述不存在',
      });
    }

    res.json({
      success: true,
      data: taskDescription,
    });
  } catch (error: any) {
    const authError = resolveCurrentUserError(error);
    if (authError) {
      return res.status(authError.status).json({
        success: false,
        error: getPublicErrorMessage(authError.message),
      });
    }
    const ownershipError = resolveOwnedTaskSessionError(error);
    if (ownershipError) {
      return res.status(ownershipError.status).json({
        success: false,
        error: getPublicErrorMessage(ownershipError.message),
      });
    }
    console.error('获取任务描述失败:', error);
    if (isTransientDatabaseError(error)) {
      return respondDatabaseUnavailable(res);
    }
    res.status(500).json({
      success: false,
      error: getPublicErrorMessage('获取任务描述失败，请稍后重试'),
    });
  }
});

/**
 * GET /api/task-creation/sessions/:sessionId/execution-plan
 * 获取会话的执行计划
 */
router.get('/sessions/:sessionId/execution-plan', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const currentUser = currentUserResolver.require(req);
    await requireOwnedTaskSession(sessionId, currentUser.userId, resolveLegacyUserIdHint(req, currentUser.userId));

    const executionPlan = await taskCreationSessionDAO.getExecutionPlan(sessionId);

    if (!executionPlan) {
      return res.status(404).json({
        success: false,
        error: '执行计划不存在',
      });
    }

    res.json({
      success: true,
      data: executionPlan,
    });
  } catch (error: any) {
    const authError = resolveCurrentUserError(error);
    if (authError) {
      return res.status(authError.status).json({
        success: false,
        error: getPublicErrorMessage(authError.message),
      });
    }
    const ownershipError = resolveOwnedTaskSessionError(error);
    if (ownershipError) {
      return res.status(ownershipError.status).json({
        success: false,
        error: getPublicErrorMessage(ownershipError.message),
      });
    }
    console.error('获取执行计划失败:', error);
    if (isTransientDatabaseError(error)) {
      return respondDatabaseUnavailable(res);
    }
    res.status(500).json({
      success: false,
      error: getPublicErrorMessage('获取执行计划失败，请稍后重试'),
    });
  }
});

/**
 * DELETE /api/task-creation/sessions/:sessionId
 * 删除会话（级联删除所有关联数据）
 */
router.delete('/sessions/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const currentUser = currentUserResolver.require(req);
    await requireOwnedTaskSession(sessionId, currentUser.userId, resolveLegacyUserIdHint(req, currentUser.userId));

    await taskCreationSessionDAO.deleteSession(sessionId);
    await taskCreationFileMemoryStore.deleteSession(sessionId);

    res.json({
      success: true,
      message: '会话已删除',
    });
  } catch (error: any) {
    const authError = resolveCurrentUserError(error);
    if (authError) {
      return res.status(authError.status).json({
        success: false,
        error: getPublicErrorMessage(authError.message),
      });
    }
    const ownershipError = resolveOwnedTaskSessionError(error);
    if (ownershipError) {
      return res.status(ownershipError.status).json({
        success: false,
        error: getPublicErrorMessage(ownershipError.message),
      });
    }
    console.error('删除会话失败:', error);
    res.status(500).json({
      success: false,
      error: getPublicErrorMessage('删除会话失败，请稍后重试'),
    });
  }
});

export default router;
