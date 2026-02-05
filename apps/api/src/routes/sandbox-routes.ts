import express from 'express';
import { kvmConnector } from '../connectors/kvm-connector';
import { KvmClientError } from '../clients/kvm-orchestrator-client';
import { getPublicErrorMessage } from '../utils/error-response';
import { sandboxSecurityConfig } from '../config/sandbox-security';
import { sandboxEnvironmentService } from '../services/sandbox-environment-service';

const router = express.Router();

const allowedActions = new Set(['start', 'shutdown', 'reboot', 'suspend', 'resume']);

function handleError(res: express.Response, error: unknown, fallback: string) {
  if (error instanceof KvmClientError) {
    return res.status(error.status).json({
      success: false,
      error: getPublicErrorMessage(error.message || fallback),
      requestId: error.requestId,
    });
  }

  const message = error instanceof Error ? error.message : fallback;
  return res.status(502).json({
    success: false,
    error: getPublicErrorMessage(message || fallback),
  });
}

function ok(res: express.Response, payload: { data: unknown; requestId?: string; code?: number; message?: string }) {
  return res.json({
    success: true,
    code: payload.code,
    message: payload.message,
    requestId: payload.requestId,
    data: payload.data,
  });
}

function isProtectedVm(name: string): boolean {
  return sandboxSecurityConfig.protectedVmNames.includes(name);
}

async function validateVmControlScope(req: express.Request, vmName: string) {
  if (!sandboxSecurityConfig.enforceSessionFirst) {
    return;
  }

  const sessionId =
    (req.query.sessionId as string | undefined) ||
    req.header('X-Sandbox-Session-Id') ||
    (req.body?.sessionId as string | undefined);

  if (!sessionId) {
    throw new KvmClientError(400, '缺少 sessionId（query 或 X-Sandbox-Session-Id）');
  }

  const environment = await sandboxEnvironmentService.findEnvironment(sessionId);
  if (!environment) {
    throw new KvmClientError(404, `未找到 session 对应的执行环境: ${sessionId}`);
  }

  if (environment.status !== 'ready') {
    throw new KvmClientError(409, `执行环境不可操作（当前状态: ${environment.status}）`);
  }

  if (environment.vmName !== vmName) {
    throw new KvmClientError(403, `session(${sessionId}) 无权操作 VM(${vmName})`);
  }
}

router.get('/health', async (_req, res) => {
  try {
    return ok(res, await kvmConnector.health());
  } catch (error) {
    return handleError(res, error, '获取 KVM 服务健康状态失败');
  }
});

// vm
router.get('/vms', async (_req, res) => {
  try {
    return ok(res, await kvmConnector.listVms());
  } catch (error) {
    return handleError(res, error, '获取虚拟机列表失败');
  }
});

router.get('/vms/:name', async (req, res) => {
  try {
    return ok(res, await kvmConnector.getVm(req.params.name));
  } catch (error) {
    return handleError(res, error, '获取虚拟机详情失败');
  }
});

router.post('/vms/:name/:action', async (req, res) => {
  try {
    const action = req.params.action;
    if (!allowedActions.has(action)) {
      return res.status(400).json({
        success: false,
        error: getPublicErrorMessage('不支持的虚拟机动作'),
      });
    }

    if (isProtectedVm(req.params.name)) {
      return res.status(403).json({
        success: false,
        error: getPublicErrorMessage(`受保护虚拟机禁止执行控制动作: ${req.params.name}`),
      });
    }

    await validateVmControlScope(req, req.params.name);

    const asyncMode = String(req.query.async || '').toLowerCase() === 'true';
    return ok(res, await kvmConnector.controlVm(req.params.name, action as any, asyncMode));
  } catch (error) {
    return handleError(res, error, '控制虚拟机失败');
  }
});

router.get('/vms/:name/metrics', async (req, res) => {
  try {
    return ok(res, await kvmConnector.getVmMetrics(req.params.name));
  } catch (error) {
    return handleError(res, error, '获取虚拟机监控失败');
  }
});

router.get('/vms/:name/logs', async (req, res) => {
  try {
    const lines = req.query.lines ? Number(req.query.lines) : undefined;
    return ok(res, await kvmConnector.getVmLogs(req.params.name, lines));
  } catch (error) {
    return handleError(res, error, '获取虚拟机日志失败');
  }
});

router.get('/vms/:name/snapshots', async (req, res) => {
  try {
    return ok(res, await kvmConnector.listVmSnapshots(req.params.name));
  } catch (error) {
    return handleError(res, error, '获取快照列表失败');
  }
});

router.post('/vms/:name/snapshots/create', async (req, res) => {
  try {
    if (isProtectedVm(req.params.name)) {
      return res.status(403).json({
        success: false,
        error: getPublicErrorMessage(`受保护虚拟机禁止创建快照: ${req.params.name}`),
      });
    }
    await validateVmControlScope(req, req.params.name);
    return ok(res, await kvmConnector.createVmSnapshot(req.params.name, req.body || {}));
  } catch (error) {
    return handleError(res, error, '创建快照失败');
  }
});

router.post('/vms/:name/snapshots/:snapshotName/restore', async (req, res) => {
  try {
    if (isProtectedVm(req.params.name)) {
      return res.status(403).json({
        success: false,
        error: getPublicErrorMessage(`受保护虚拟机禁止恢复快照: ${req.params.name}`),
      });
    }
    await validateVmControlScope(req, req.params.name);
    return ok(res, await kvmConnector.restoreVmSnapshot(req.params.name, req.params.snapshotName));
  } catch (error) {
    return handleError(res, error, '恢复快照失败');
  }
});

router.delete('/vms/:name/snapshots/:snapshotName', async (req, res) => {
  try {
    if (isProtectedVm(req.params.name)) {
      return res.status(403).json({
        success: false,
        error: getPublicErrorMessage(`受保护虚拟机禁止删除快照: ${req.params.name}`),
      });
    }
    await validateVmControlScope(req, req.params.name);
    return ok(res, await kvmConnector.deleteVmSnapshot(req.params.name, req.params.snapshotName));
  } catch (error) {
    return handleError(res, error, '删除快照失败');
  }
});

// session
router.post('/sessions', async (req, res) => {
  try {
    const idem = req.header('Idempotency-Key') || undefined;
    return ok(res, await kvmConnector.createSession(req.body || {}, idem));
  } catch (error) {
    return handleError(res, error, '创建会话失败');
  }
});

router.get('/sessions/:sessionId', async (req, res) => {
  try {
    return ok(res, await kvmConnector.getSession(req.params.sessionId));
  } catch (error) {
    return handleError(res, error, '获取会话失败');
  }
});

router.post('/sessions/:sessionId/bind', async (req, res) => {
  try {
    return ok(res, await kvmConnector.bindSessionVm(req.params.sessionId, req.body || {}));
  } catch (error) {
    return handleError(res, error, '绑定会话与虚拟机失败');
  }
});

router.get('/sessions/:sessionId/vm', async (req, res) => {
  try {
    return ok(res, await kvmConnector.getSessionVm(req.params.sessionId));
  } catch (error) {
    return handleError(res, error, '获取会话虚拟机失败');
  }
});

router.post('/sessions/:sessionId/close', async (req, res) => {
  try {
    return ok(res, await kvmConnector.closeSession(req.params.sessionId, req.body || {}));
  } catch (error) {
    return handleError(res, error, '关闭会话失败');
  }
});

// execution environment (base + incremental + db mapping)
router.post('/environment/open', async (req, res) => {
  try {
    const idempotencyKey = req.header('Idempotency-Key') || undefined;
    const result = await sandboxEnvironmentService.openEnvironment({
      metadata: req.body?.metadata || {},
      bind: req.body?.bind || {},
      idempotencyKey,
    });
    return res.status(201).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return handleError(res, error, '创建执行层 KVM 环境失败');
  }
});

router.get('/environment/:sessionId', async (req, res) => {
  try {
    return res.json({
      success: true,
      data: await sandboxEnvironmentService.getEnvironment(req.params.sessionId),
    });
  } catch (error) {
    return handleError(res, error, '获取执行层 KVM 环境失败');
  }
});

router.get('/environment', async (req, res) => {
  try {
    const limit = Number(req.query.limit || 20);
    return res.json({
      success: true,
      data: await sandboxEnvironmentService.listEnvironments(limit),
    });
  } catch (error) {
    return handleError(res, error, '获取执行层 KVM 环境列表失败');
  }
});

router.post('/environment/:sessionId/close', async (req, res) => {
  try {
    return res.json({
      success: true,
      data: await sandboxEnvironmentService.closeEnvironment(req.params.sessionId),
    });
  } catch (error) {
    return handleError(res, error, '关闭执行层 KVM 环境失败');
  }
});

router.get('/sessions/:sessionId/quota', async (req, res) => {
  try {
    return ok(res, await kvmConnector.getSessionQuota(req.params.sessionId));
  } catch (error) {
    return handleError(res, error, '获取会话配额失败');
  }
});

router.put('/sessions/:sessionId/quota', async (req, res) => {
  try {
    return ok(res, await kvmConnector.updateSessionQuota(req.params.sessionId, req.body || {}));
  } catch (error) {
    return handleError(res, error, '更新会话配额失败');
  }
});

// job
router.get('/jobs/:jobId', async (req, res) => {
  try {
    return ok(res, await kvmConnector.getJob(req.params.jobId));
  } catch (error) {
    return handleError(res, error, '获取任务状态失败');
  }
});

export default router;
