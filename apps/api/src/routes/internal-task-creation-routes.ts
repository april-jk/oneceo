import express from 'express';
import { ensureTaskSessionRuntime } from './task-creation-routes';
import { getPublicErrorMessage } from '../utils/error-response';

const router = express.Router();

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function requireInternalToken(req: express.Request) {
  const configured = asText(process.env.ONECEO_INTERNAL_TOKEN);
  if (!configured) return;
  const incoming = asText(req.header('x-oneceo-internal-token'));
  if (!incoming || incoming !== configured) {
    throw new Error('forbidden');
  }
}

router.post('/task-creation/sessions/:sessionId/runtime/start', async (req, res) => {
  try {
    requireInternalToken(req);
    const { sessionId } = req.params;
    const runtime = await ensureTaskSessionRuntime(sessionId);
    return res.json({
      success: true,
      data: runtime,
    });
  } catch (error: any) {
    const forbidden = error?.message === 'forbidden';
    if (error?.message === '会话不存在') {
      return res.status(404).json({
        success: false,
        error: getPublicErrorMessage('会话不存在'),
      });
    }
    console.error('内部启动执行环境失败:', error);
    return res.status(forbidden ? 403 : 400).json({
      success: false,
      error: getPublicErrorMessage(forbidden ? '无权访问内部任务执行环境接口' : error?.message || '启动执行环境失败'),
    });
  }
});

export default router;
