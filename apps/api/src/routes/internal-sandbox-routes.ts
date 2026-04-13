import express from 'express';
import { sandboxEnvironmentService } from '../services/sandbox-environment-service';
import { getSandboxArchiveDownloadSpec, listSandboxArchiveHistory } from '../services/sandbox-archive-service';
import { getPublicErrorMessage } from '../utils/error-response';
import { createRequireInternalToken } from './internal-auth-middleware';

const router = express.Router();
router.use(createRequireInternalToken({
  disabledMessage: 'sandbox 内部接口未启用',
}));

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

router.get('/sandbox/by-task-session/:taskSessionId', async (req, res) => {
  try {
    return res.json({
      success: true,
      data: await sandboxEnvironmentService.listTaskSessionEnvironments(req.params.taskSessionId),
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '获取会话 Sandbox 关联失败'),
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

router.get('/sandbox/:sandboxId/archive-download-url', async (req, res) => {
  try {
    const expiresInSecondsRaw = Number(req.query.expiresInSeconds || 3600);
    const expiresInSeconds = Number.isFinite(expiresInSecondsRaw) ? expiresInSecondsRaw : 3600;
    const snapshotKey = typeof req.query.snapshotKey === 'string' ? req.query.snapshotKey : undefined;
    return res.json({
      success: true,
      data: await getSandboxArchiveDownloadSpec(req.params.sandboxId, {
        expiresInSeconds,
        snapshotKey,
      }),
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '获取 Sandbox 归档下载链接失败'),
    });
  }
});

export default router;
