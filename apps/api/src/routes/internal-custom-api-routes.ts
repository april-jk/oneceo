import express from 'express';
import { customApiConnectorService } from '../services/custom-api-connector-service';
import { getPublicErrorMessage } from '../utils/error-response';
import { createRequireInternalToken } from './internal-auth-middleware';

const router = express.Router();

router.use(
  createRequireInternalToken({
    disabledMessage: 'custom API 内部审核接口未启用',
  })
);

function adminUserId(req: express.Request) {
  return String(req.body?.reviewedBy || req.header('x-oneceo-admin-user-id') || 'internal_admin').trim();
}

function handleError(res: express.Response, error: unknown, fallback: string, status = 400) {
  const message = error instanceof Error ? error.message : fallback;
  return res.status(status).json({
    success: false,
    error: getPublicErrorMessage(message || fallback),
  });
}

router.get('/admin/custom-api/review-queue', async (_req, res) => {
  try {
    const data = await customApiConnectorService.listReviewQueue();
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error, '获取 Custom API 审核队列失败');
  }
});

router.post('/admin/custom-api/tools/:toolId/approve', async (req, res) => {
  try {
    const data = await customApiConnectorService.approveTool(
      req.params.toolId,
      adminUserId(req),
      String(req.body?.reviewNote || '')
    );
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error, '批准 Custom API tool 失败');
  }
});

router.post('/admin/custom-api/tools/:toolId/reject', async (req, res) => {
  try {
    const data = await customApiConnectorService.rejectTool(
      req.params.toolId,
      adminUserId(req),
      String(req.body?.reviewNote || '')
    );
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error, '拒绝 Custom API tool 失败');
  }
});

router.post('/admin/custom-api/tools/:toolId/publish', async (req, res) => {
  try {
    const data = await customApiConnectorService.publishTool(
      req.params.toolId,
      adminUserId(req),
      String(req.body?.reviewNote || '')
    );
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error, '发布 Custom API tool 失败');
  }
});

router.post('/admin/custom-api/tools/:toolId/disable', async (req, res) => {
  try {
    const data = await customApiConnectorService.disableTool(
      req.params.toolId,
      adminUserId(req),
      String(req.body?.reviewNote || '')
    );
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error, '禁用 Custom API tool 失败');
  }
});

router.get('/admin/custom-api/audit-logs', async (req, res) => {
  try {
    const data = await customApiConnectorService.listAuditLogs(Number(req.query.limit || 100));
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error, '获取 Custom API audit logs 失败');
  }
});

export default router;
