import express from 'express';
import { appUserDAO, appUserSessionDAO, sandboxExecutionEnvironmentDAO, taskCreationSessionDAO } from '../db/dao';
import { taskCreationFileMemoryStore, type FileSessionRecord } from '../agents/task-creation/file-memory-store';
import { buildTaskSessionDeploymentResponse } from '../services/task-session-deployment-runtime-service';
import { adminRailwayManagementService } from '../services/admin-railway-management-service';
import { getPublicErrorMessage } from '../utils/error-response';
import { createRequireInternalToken } from './internal-auth-middleware';
import { isCanonicalAppUserId, normalizeUserId } from '../utils/user-id';

const router = express.Router();

router.use(createRequireInternalToken({
  disabledMessage: '部署管理内部接口未启用',
}));

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  return null;
}

function mapAdminStageFromStatus(status: unknown) {
  const normalized = typeof status === 'string' ? status.trim() : '';
  if (normalized === 'completed') return 'completed';
  if (normalized === 'failed') return 'failed';
  if (normalized === 'waiting_user') return 'clarifying';
  return undefined;
}

function maxIso(...values: Array<unknown>) {
  let winner = 0;
  for (const value of values) {
    const iso = toIso(value);
    if (!iso) continue;
    const timestamp = Date.parse(iso);
    if (Number.isFinite(timestamp) && timestamp > winner) {
      winner = timestamp;
    }
  }
  return winner > 0 ? new Date(winner).toISOString() : null;
}

function toDateMs(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => asText(item)).filter(Boolean);
}

function readStringRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, entry]) => [asText(key), asText(entry)] as const)
    .filter(([key, entry]) => key && entry);
  return Object.fromEntries(entries);
}

function deploymentStatusCategory(input: {
  bindingState?: string;
  latestStatus?: string;
  latestUrl?: string;
  latestStaticUrl?: string;
  activeDeploymentPending?: boolean;
  providerErrorMessage?: string;
}) {
  const bindingState = asText(input.bindingState).toLowerCase();
  const latestStatus = asText(input.latestStatus).toUpperCase();

  if (input.activeDeploymentPending || bindingState === 'provisioning' || bindingState === 'public_settling') {
    return 'pending';
  }
  if (bindingState === 'repair_required' || bindingState === 'provider_error') return 'failed';
  if (
    latestStatus.includes('FAIL') ||
    latestStatus.includes('ERROR') ||
    latestStatus.includes('CANCEL') ||
    latestStatus.includes('ROLLBACK')
  ) {
    return 'failed';
  }
  if (
    latestStatus.includes('SUCCESS') ||
    latestStatus.includes('DEPLOY') ||
    latestStatus.includes('ACTIVE') ||
    latestStatus.includes('READY') ||
    latestStatus.includes('LIVE')
  ) {
    return 'success';
  }
  if (input.latestUrl || input.latestStaticUrl) return 'success';
  if (bindingState === 'ready') return 'ready';
  if (bindingState === 'uninitialized') return 'uninitialized';
  return 'unknown';
}

function hasDeploymentSignal(panel: Awaited<ReturnType<typeof buildTaskSessionDeploymentResponse>>) {
  return (
    asText(panel.bindingState) !== '' && panel.bindingState !== 'uninitialized'
  ) || Boolean(
    panel.deploymentId ||
    panel.latestStatus ||
    panel.latestUrl ||
    panel.latestStaticUrl ||
    panel.providerErrorMessage ||
    panel.projectId ||
    panel.projectName ||
    panel.environmentId ||
    panel.environmentName ||
    panel.serviceId ||
    panel.serviceName ||
    panel.activeDeploymentPending ||
    panel.deployments.length > 0 ||
    panel.logs.length > 0
  );
}

async function resolveDeploymentUser(userId: unknown) {
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
    lastLoginAt: toIso(user?.lastLoginAt),
    lastSeenAt: toIso(latestSession?.lastSeenAt),
  };
}

function buildSessionForDeploymentPanel(input: {
  dbSession: Awaited<ReturnType<typeof taskCreationSessionDAO.getSession>> | null;
  memorySession: FileSessionRecord | null;
  environment: Awaited<ReturnType<typeof sandboxExecutionEnvironmentDAO.findCanonicalByTaskSessionId>> | null;
}): FileSessionRecord | null {
  if (input.memorySession) return input.memorySession;
  const dbSession = input.dbSession;
  if (!dbSession) return null;
  return {
    id: dbSession.id,
    title: `会话 ${String(dbSession.id).slice(-6)}`,
    status: (asText(dbSession.status) || 'in_progress') as FileSessionRecord['status'],
    stage: mapAdminStageFromStatus(dbSession.status),
    createdAt: toIso(dbSession.createdAt) || new Date().toISOString(),
    updatedAt: toIso(dbSession.updatedAt) || new Date().toISOString(),
    runtime: {
      orchestratorSessionId: input.environment?.sessionId || undefined,
    },
    messages: [],
  };
}

async function buildDeploymentRecord(input: {
  dbSession: Awaited<ReturnType<typeof taskCreationSessionDAO.getSession>> | null;
  memorySession: FileSessionRecord | null;
  user: Awaited<ReturnType<typeof resolveDeploymentUser>>;
}) {
  const dbSession = input.dbSession;
  const sessionId = asText(input.memorySession?.id || dbSession?.id);
  if (!sessionId) return null;

  const environment = await sandboxExecutionEnvironmentDAO.findCanonicalByTaskSessionId(sessionId);
  const sessionForPanel = buildSessionForDeploymentPanel({
    dbSession,
    memorySession: input.memorySession,
    environment,
  });
  const normalizedUserId = normalizeUserId(dbSession?.userId) || '';
  const panel = await buildTaskSessionDeploymentResponse({
    userId: normalizedUserId,
    session: sessionForPanel,
    resolvedEnvironment: environment,
  });

  if (!hasDeploymentSignal(panel)) {
    return null;
  }

  const statusCategory = deploymentStatusCategory({
    bindingState: panel.bindingState,
    latestStatus: panel.latestStatus,
    latestUrl: panel.latestUrl,
    latestStaticUrl: panel.latestStaticUrl,
    activeDeploymentPending: panel.activeDeploymentPending,
    providerErrorMessage: panel.providerErrorMessage,
  });

  return {
    taskSessionId: sessionId,
    statusCategory,
    hasDeployment: true,
    deploymentId: panel.deploymentId || null,
    bindingState: panel.bindingState || 'uninitialized',
    latestStatus: panel.latestStatus || null,
    latestUrl: panel.latestUrl || null,
    latestStaticUrl: panel.latestStaticUrl || null,
    activeDeploymentPending: panel.activeDeploymentPending === true,
    projectName: panel.projectName || null,
    environmentName: panel.environmentName || null,
    serviceName: panel.serviceName || null,
    lastVerifiedAt: panel.lastVerifiedAt || null,
    updatedAt:
      maxIso(
        panel.lastVerifiedAt,
        panel.deployments[0]?.createdAt,
        input.memorySession?.updatedAt,
        dbSession?.updatedAt,
        environment?.updatedAt
      ) || new Date().toISOString(),
    user: input.user,
    session: {
      id: sessionId,
      userId: normalizeUserId(dbSession?.userId) || null,
      title: input.memorySession?.title || `会话 ${sessionId.slice(-6)}`,
      status: input.memorySession?.status || asText(dbSession?.status) || 'in_progress',
      stage: input.memorySession?.stage || mapAdminStageFromStatus(dbSession?.status) || null,
      createdAt: toIso(input.memorySession?.createdAt || dbSession?.createdAt),
      updatedAt: toIso(input.memorySession?.updatedAt || dbSession?.updatedAt),
    },
    sandbox: environment
      ? {
          sandboxId: environment.id,
          sessionId: environment.sessionId,
          orchestratorSessionId: environment.orchestratorSessionId || null,
          vmName: environment.vmName || null,
          status: environment.status,
          createdAt: toIso(environment.createdAt),
          updatedAt: toIso(environment.updatedAt),
          closedAt: toIso(environment.closedAt),
        }
      : null,
    panel,
  };
}

type AdminDeploymentItem = NonNullable<Awaited<ReturnType<typeof buildDeploymentRecord>>>;

async function collectDeploymentRecords(input: {
  limit: number;
  query?: string;
  status?: string;
  hasUrl?: string;
  userId?: string;
  taskSessionId?: string;
}) {
  const exactTaskSessionId = asText(input.taskSessionId);
  const normalizedUserId = normalizeUserId(input.userId);
  const fetchLimit = Math.max(input.limit, 200);
  const dbSessions = exactTaskSessionId
    ? (() => {
        const run = async () => {
          const row = await taskCreationSessionDAO.getSession(exactTaskSessionId);
          return row ? [row] : [];
        };
        return run();
      })()
    : taskCreationSessionDAO.getRecentSessionsForAdmin(fetchLimit);
  const memorySessionsPromise = taskCreationFileMemoryStore.listSessions(Math.max(fetchLimit * 3, fetchLimit));
  const [dbRows, memoryRows] = await Promise.all([dbSessions, memorySessionsPromise]);

  const filteredDbRows = dbRows.filter((row) => {
    if (normalizedUserId && normalizeUserId(row.userId) !== normalizedUserId) return false;
    return true;
  });
  const memoryById = new Map(memoryRows.map((item) => [item.id, item]));
  const records: AdminDeploymentItem[] = (
    await Promise.all(
      filteredDbRows.map(async (row) =>
        buildDeploymentRecord({
          dbSession: row,
          memorySession: memoryById.get(row.id) || null,
          user: await resolveDeploymentUser(row.userId),
        })
      )
    )
  ).filter((item): item is AdminDeploymentItem => item !== null);

  const queryText = asText(input.query).toLowerCase();
  const normalizedStatus = asText(input.status).toLowerCase();
  const normalizedHasUrl = asText(input.hasUrl).toLowerCase();

  const matched = records.filter((record) => {
    if (!record) return false;

    if (normalizedStatus && normalizedStatus !== 'all' && record.statusCategory !== normalizedStatus) {
      return false;
    }

    const hasUrl = Boolean(record.latestUrl || record.latestStaticUrl);
    if (normalizedHasUrl === 'yes' && !hasUrl) return false;
    if (normalizedHasUrl === 'no' && hasUrl) return false;

    if (queryText) {
      const haystack = [
        record.taskSessionId,
        record.session.title,
        record.user?.displayName,
        record.user?.email,
        record.projectName,
        record.serviceName,
        record.environmentName,
        record.latestStatus,
        record.latestUrl,
        record.latestStaticUrl,
        record.sandbox?.sandboxId,
      ]
        .map((item) => asText(item).toLowerCase())
        .filter(Boolean);
      if (!haystack.some((item) => item.includes(queryText))) {
        return false;
      }
    }

    return true;
  });

  return matched
    .sort((left, right) => toDateMs(right.updatedAt) - toDateMs(left.updatedAt))
    .slice(0, input.limit);
}

router.get('/admin/deployments/overview', async (req, res) => {
  try {
    const parsedLimit = Number.parseInt(String(req.query.limit || '200'), 10);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 300) : 200;
    const records = await collectDeploymentRecords({
      limit,
      query: asText(req.query.query),
      status: asText(req.query.status),
      hasUrl: asText(req.query.hasUrl),
      userId: asText(req.query.userId),
      taskSessionId: asText(req.query.taskSessionId),
    });
    const summary = {
      total: records.length,
      success: records.filter((item) => item.statusCategory === 'success').length,
      failed: records.filter((item) => item.statusCategory === 'failed').length,
      pending: records.filter((item) => item.statusCategory === 'pending').length,
      ready: records.filter((item) => item.statusCategory === 'ready').length,
      withUrl: records.filter((item) => item.latestUrl || item.latestStaticUrl).length,
      latestUpdatedAt: records[0]?.updatedAt || null,
    };
    return res.json({
      success: true,
      data: {
        summary,
      },
    });
  } catch (error: any) {
    console.error('内部获取部署管理概览失败:', error);
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '获取部署管理概览失败'),
    });
  }
});

router.get('/admin/deployments', async (req, res) => {
  try {
    const parsedLimit = Number.parseInt(String(req.query.limit || '120'), 10);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 200) : 120;
    const records = await collectDeploymentRecords({
      limit,
      query: asText(req.query.query),
      status: asText(req.query.status),
      hasUrl: asText(req.query.hasUrl),
      userId: asText(req.query.userId),
      taskSessionId: asText(req.query.taskSessionId),
    });
    return res.json({
      success: true,
      data: {
        records,
        total: records.length,
      },
    });
  } catch (error: any) {
    console.error('内部获取部署管理列表失败:', error);
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '获取部署管理列表失败'),
    });
  }
});

router.get('/admin/deployments/conversations', async (req, res) => {
  try {
    const parsedLimit = Number.parseInt(String(req.query.limit || '120'), 10);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 200) : 120;
    const records = await collectDeploymentRecords({
      limit,
      query: asText(req.query.query),
      status: asText(req.query.status),
      hasUrl: asText(req.query.hasUrl),
      userId: asText(req.query.userId),
      taskSessionId: asText(req.query.taskSessionId),
    });
    return res.json({
      success: true,
      data: {
        items: records,
        total: records.length,
      },
    });
  } catch (error: any) {
    console.error('内部获取部署会话视图失败:', error);
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '获取部署会话视图失败'),
    });
  }
});

router.get('/admin/deployments/users', async (req, res) => {
  try {
    const parsedLimit = Number.parseInt(String(req.query.limit || '200'), 10);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 300) : 200;
    const records = await collectDeploymentRecords({
      limit,
      query: asText(req.query.query),
      status: asText(req.query.status),
      hasUrl: asText(req.query.hasUrl),
      userId: asText(req.query.userId),
    });
    const userMap = new Map<string, {
      user: AdminDeploymentItem['user'];
      deploymentCount: number;
      successCount: number;
      failedCount: number;
      pendingCount: number;
      latestUpdatedAt: string | null;
      latestRecord: AdminDeploymentItem | null;
    }>();

    for (const record of records) {
      const userKey = record.user?.id || `missing:${record.taskSessionId}`;
      const current = userMap.get(userKey) || {
        user: record.user,
        deploymentCount: 0,
        successCount: 0,
        failedCount: 0,
        pendingCount: 0,
        latestUpdatedAt: null,
        latestRecord: null,
      };
      current.deploymentCount += 1;
      if (record.statusCategory === 'success') current.successCount += 1;
      if (record.statusCategory === 'failed') current.failedCount += 1;
      if (record.statusCategory === 'pending') current.pendingCount += 1;
      if (!current.latestUpdatedAt || toDateMs(record.updatedAt) >= toDateMs(current.latestUpdatedAt)) {
        current.latestUpdatedAt = record.updatedAt;
        current.latestRecord = record;
      }
      userMap.set(userKey, current);
    }

    const items = Array.from(userMap.values())
      .sort((left, right) => toDateMs(right.latestUpdatedAt) - toDateMs(left.latestUpdatedAt))
      .slice(0, limit);

    return res.json({
      success: true,
      data: {
        items,
        total: items.length,
      },
    });
  } catch (error: any) {
    console.error('内部获取部署用户视图失败:', error);
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '获取部署用户视图失败'),
    });
  }
});

router.get('/admin/deployments/task-sessions/:taskSessionId', async (req, res) => {
  try {
    const taskSessionId = asText(req.params.taskSessionId);
    if (!taskSessionId) {
      return res.status(400).json({
        success: false,
        error: getPublicErrorMessage('taskSessionId 不能为空'),
      });
    }
    const dbSession = await taskCreationSessionDAO.getSession(taskSessionId);
    if (!dbSession) {
      return res.status(404).json({
        success: false,
        error: getPublicErrorMessage('会话不存在'),
      });
    }
    const memorySession = await taskCreationFileMemoryStore.getSession(taskSessionId);
    const record = await buildDeploymentRecord({
      dbSession,
      memorySession,
      user: await resolveDeploymentUser(dbSession.userId),
    });
    if (!record) {
      return res.status(404).json({
        success: false,
        error: getPublicErrorMessage('当前会话暂无部署记录'),
      });
    }
    return res.json({
      success: true,
      data: record,
    });
  } catch (error: any) {
    console.error('内部获取部署详情失败:', error);
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '获取部署详情失败'),
    });
  }
});

router.get('/admin/deployments/railway/services', async (req, res) => {
  try {
    const parsedLimit = Number.parseInt(String(req.query.limit || '120'), 10);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 300) : 120;
    const data = await adminRailwayManagementService.listServices({
      limit,
      query: asText(req.query.query),
      status: asText(req.query.status),
      risk: asText(req.query.risk),
    });
    return res.json({
      success: true,
      data,
    });
  } catch (error: any) {
    console.error('内部获取 Railway 服务视图失败:', error);
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '获取 Railway 服务视图失败'),
    });
  }
});

router.post('/admin/deployments/railway/services/batch-delete', async (req, res) => {
  try {
    const serviceKeys = readStringArray(req.body?.serviceKeys).slice(0, 50);
    if (serviceKeys.length === 0) {
      return res.status(400).json({
        success: false,
        error: getPublicErrorMessage('serviceKeys 不能为空'),
      });
    }
    const data = await adminRailwayManagementService.batchDeleteServices(serviceKeys);
    return res.json({
      success: true,
      data,
    });
  } catch (error: any) {
    console.error('内部批量删除 Railway 服务失败:', error);
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '批量删除 Railway 服务失败'),
    });
  }
});

router.post('/admin/deployments/railway/services/batch-configure', async (req, res) => {
  try {
    const serviceKeys = readStringArray(req.body?.serviceKeys).slice(0, 50);
    const patch = {
      builder: asText(req.body?.patch?.builder) || undefined,
      buildCommand: typeof req.body?.patch?.buildCommand === 'string' ? req.body.patch.buildCommand : undefined,
      startCommand: typeof req.body?.patch?.startCommand === 'string' ? req.body.patch.startCommand : undefined,
      rootDirectory: typeof req.body?.patch?.rootDirectory === 'string' ? req.body.patch.rootDirectory : undefined,
      healthcheckPath: typeof req.body?.patch?.healthcheckPath === 'string' ? req.body.patch.healthcheckPath : undefined,
      sourceImage: asText(req.body?.patch?.sourceImage) || undefined,
    };
    if (serviceKeys.length === 0) {
      return res.status(400).json({
        success: false,
        error: getPublicErrorMessage('serviceKeys 不能为空'),
      });
    }
    if (Object.values(patch).every((value) => value === undefined)) {
      return res.status(400).json({
        success: false,
        error: getPublicErrorMessage('patch 不能为空'),
      });
    }
    const data = await adminRailwayManagementService.batchConfigureServices(serviceKeys, patch);
    return res.json({
      success: true,
      data,
    });
  } catch (error: any) {
    console.error('内部批量更新 Railway 服务配置失败:', error);
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '批量更新 Railway 服务配置失败'),
    });
  }
});

router.post('/admin/deployments/railway/services/batch-variables', async (req, res) => {
  try {
    const serviceKeys = readStringArray(req.body?.serviceKeys).slice(0, 50);
    const variables = readStringRecord(req.body?.variables);
    if (serviceKeys.length === 0) {
      return res.status(400).json({
        success: false,
        error: getPublicErrorMessage('serviceKeys 不能为空'),
      });
    }
    if (Object.keys(variables).length === 0) {
      return res.status(400).json({
        success: false,
        error: getPublicErrorMessage('variables 不能为空'),
      });
    }
    const data = await adminRailwayManagementService.batchUpsertServiceVariables(serviceKeys, variables, {
      replace: req.body?.replace === true,
    });
    return res.json({
      success: true,
      data,
    });
  } catch (error: any) {
    console.error('内部批量更新 Railway 服务变量失败:', error);
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '批量更新 Railway 服务变量失败'),
    });
  }
});

export default router;
