import express from 'express';
import { currentUserResolver } from '../services/current-user-resolver';
import { altusManagedRunService } from '../services/altus-managed-run-service';
import { getPublicErrorMessage } from '../utils/error-response';
import { taskCreationSessionDAO, taskSessionRunDAO } from '../db/dao';

const router = express.Router();

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

router.post('/sessions/:sessionId/runs', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const sessionId = asText(req.params.sessionId);
    const content = asText(req.body?.content);
    const messageKey = asText(req.body?.messageKey) || undefined;
    const metadata =
      req.body?.metadata && typeof req.body.metadata === 'object' && !Array.isArray(req.body.metadata)
        ? (req.body.metadata as Record<string, unknown>)
        : undefined;

    const run = await altusManagedRunService.startRun(sessionId, currentUser.userId, {
      content,
      messageKey,
      metadata,
    });

    return res.json({
      success: true,
      data: run,
    });
  } catch (error: any) {
    console.error('[ALTUS_MANAGED_START_FAILED]', error);
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '启动 Altus managed run 失败'),
    });
  }
});

router.get('/sessions/:sessionId/runs/latest', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const sessionId = asText(req.params.sessionId);
    const run = await altusManagedRunService.getLatestRun(sessionId, currentUser.userId);
    return res.json({
      success: true,
      data: run,
    });
  } catch (error: any) {
    console.error('[ALTUS_MANAGED_LATEST_FAILED]', error);
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '获取 Altus managed run 失败'),
    });
  }
});

router.get('/runs/:runId/stream', async (req, res) => {
  try {
    const runId = asText(req.params.runId);
    const run = await taskSessionRunDAO.getRun(runId);
    if (!run) {
      return res.status(404).json({
        success: false,
        error: 'managed run 不存在',
      });
    }
    const queryUserId = asText(req.query.userId);
    if (!queryUserId) {
      return res.status(401).json({
        success: false,
        error: '缺少 userId，无法订阅 managed run stream',
      });
    }
    const session = await taskCreationSessionDAO.getSession(run.sessionId);
    if (!session?.userId || session.userId !== queryUserId) {
      return res.status(403).json({
        success: false,
        error: '当前用户无权订阅该 Altus managed run',
      });
    }
    const afterSequence = Number(req.query.afterSequence);
    await altusManagedRunService.streamRun(runId, res, {
      afterSequence: Number.isFinite(afterSequence) && afterSequence > 0 ? Math.floor(afterSequence) : null,
    });
  } catch (error: any) {
    console.error('[ALTUS_MANAGED_STREAM_FAILED]', error);
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: getPublicErrorMessage(error?.message || 'Altus managed stream 失败'),
      });
    }
  }
});

router.post('/runs/:runId/stop', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const runId = asText(req.params.runId);
    const reason = asText(req.body?.reason) || 'user_interrupt';
    const run = await altusManagedRunService.stopRun(runId, currentUser.userId, reason);
    return res.json({
      success: true,
      data: run,
    });
  } catch (error: any) {
    console.error('[ALTUS_MANAGED_STOP_FAILED]', error);
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '停止 Altus managed run 失败'),
    });
  }
});

export default router;
