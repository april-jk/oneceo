import express from 'express';
import { e2bConnector } from '../connectors/e2b-connector';
import { getPublicErrorMessage } from '../utils/error-response';
import { sandboxEnvironmentService } from '../services/sandbox-environment-service';

const router = express.Router();

function handleError(res: express.Response, error: unknown, fallback: string) {
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

router.get('/health', async (_req, res) => {
  try {
    return ok(res, { data: { provider: 'e2b', status: 'ok' } });
  } catch (error) {
    return handleError(res, error, '获取 Sandbox 服务健康状态失败');
  }
});

router.post('/sessions', async (req, res) => {
  try {
    const result = await sandboxEnvironmentService.openEnvironment({
      metadata: req.body?.metadata || {},
    });
    return res.status(201).json({ success: true, data: result });
  } catch (error) {
    return handleError(res, error, '创建 Sandbox 失败');
  }
});

router.get('/sessions/:sessionId', async (req, res) => {
  try {
    const info = await e2bConnector.getSandboxInfo(req.params.sessionId);
    return ok(res, { data: info });
  } catch (error) {
    return handleError(res, error, '获取 Sandbox 失败');
  }
});

router.post('/sessions/:sessionId/close', async (req, res) => {
  try {
    const result = await sandboxEnvironmentService.closeEnvironment(req.params.sessionId);
    return res.json({ success: true, data: result });
  } catch (error) {
    return handleError(res, error, '关闭 Sandbox 失败');
  }
});

// execution environment (base + incremental + db mapping)
router.post('/environment/open', async (req, res) => {
  try {
    const idempotencyKey = req.header('Idempotency-Key') || undefined;
    const result = await sandboxEnvironmentService.openEnvironment({
      metadata: req.body?.metadata || {},
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

router.get('/sessions/:sessionId/quota', async (_req, res) => {
  return res.status(410).json({ success: false, error: getPublicErrorMessage('E2B 不支持配额查询') });
});

router.put('/sessions/:sessionId/quota', async (_req, res) => {
  return res.status(410).json({ success: false, error: getPublicErrorMessage('E2B 不支持配额更新') });
});

router.get('/jobs/:jobId', async (_req, res) => {
  return res.status(410).json({ success: false, error: getPublicErrorMessage('E2B 不支持 Job 查询') });
});

export default router;
