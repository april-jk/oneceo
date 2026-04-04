import express from 'express';
import { ensureTaskSessionRuntime } from './task-creation-routes';
import { getPublicErrorMessage } from '../utils/error-response';
import { createRequireInternalToken } from './internal-auth-middleware';

const router = express.Router();
const requireInternalToken = createRequireInternalToken({
  disabledMessage: 'task creation 内部接口未启用',
});

router.use(requireInternalToken);

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
