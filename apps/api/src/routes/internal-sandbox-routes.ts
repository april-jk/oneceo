import express from 'express';
import { sandboxEnvironmentService } from '../services/sandbox-environment-service';
import { listSandboxArchiveHistory } from '../services/sandbox-archive-service';
import { getPublicErrorMessage } from '../utils/error-response';

const router = express.Router();

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function requireInternalToken(req: express.Request, res: express.Response, next: express.NextFunction) {
  const configured = asText(process.env.ONECEO_INTERNAL_TOKEN);
  if (!configured) {
    next();
    return;
  }
  const incoming = asText(req.header('x-oneceo-internal-token'));
  if (incoming !== configured) {
    res.status(401).json({
      success: false,
      error: getPublicErrorMessage('未授权的内部请求'),
    });
    return;
  }
  next();
}

router.use(requireInternalToken);

router.get('/sandbox/environment-registry', async (req, res) => {
  try {
    const limit = Number(req.query.limit || 20);
    return res.json({
      success: true,
      data: await sandboxEnvironmentService.listRegistryEnvironments(limit),
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '获取 Sandbox 环境摘要列表失败'),
    });
  }
});

router.get('/sandbox/:sandboxId/archive-history', async (req, res) => {
  try {
    return res.json({
      success: true,
      data: await listSandboxArchiveHistory(req.params.sandboxId),
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '获取 Sandbox 归档历史失败'),
    });
  }
});

export default router;
