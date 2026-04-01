import express from 'express';
import { connectorGuideService } from '../services/connector-guide-service';
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

router.get('/connector-guides', async (req, res) => {
  try {
    const data = await connectorGuideService.listPolicies({
      connectorKey: asText(req.query.connectorKey),
      status: asText(req.query.status),
      query: asText(req.query.query),
    });
    return res.json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '获取 connector guides 失败'),
    });
  }
});

router.get('/connector-guides-debug/sessions/:taskSessionId', async (req, res) => {
  try {
    const data = await connectorGuideService.listSessionGuides(req.params.taskSessionId);
    return res.json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '获取 session connector guides 失败'),
    });
  }
});

router.get('/connector-guides/:policyId', async (req, res) => {
  try {
    const data = await connectorGuideService.getPolicy(req.params.policyId);
    return res.json({ success: true, data });
  } catch (error: any) {
    return res.status(404).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '获取 connector guide policy 失败'),
    });
  }
});

router.post('/connector-guides', async (req, res) => {
  try {
    const data = await connectorGuideService.createPolicy({
      connectorKey: req.body?.connectorKey,
      triggerMode: req.body?.triggerMode,
      description: req.body?.description,
      createdBy: req.body?.createdBy,
    });
    return res.status(201).json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '创建 connector guide policy 失败'),
    });
  }
});

router.put('/connector-guides/:policyId', async (req, res) => {
  try {
    const data = await connectorGuideService.updatePolicy(req.params.policyId, {
      triggerMode: req.body?.triggerMode,
      description: req.body?.description,
      status: req.body?.status,
    });
    return res.json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '更新 connector guide policy 失败'),
    });
  }
});

router.post('/connector-guides/:policyId/revisions', async (req, res) => {
  try {
    const data = await connectorGuideService.createRevision(req.params.policyId, {
      createdBy: req.body?.createdBy,
    });
    return res.status(201).json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '创建 connector guide revision 失败'),
    });
  }
});

router.get('/connector-guides/:policyId/revisions/:revisionId', async (req, res) => {
  try {
    const data = await connectorGuideService.getRevision(req.params.policyId, req.params.revisionId);
    return res.json({ success: true, data });
  } catch (error: any) {
    return res.status(404).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '获取 connector guide revision 失败'),
    });
  }
});

router.put('/connector-guides/:policyId/revisions/:revisionId', async (req, res) => {
  try {
    const data = await connectorGuideService.updateRevision(req.params.policyId, req.params.revisionId, {
      serverInstructionsMarkdown: req.body?.serverInstructionsMarkdown,
      guideReminderMarkdown: req.body?.guideReminderMarkdown,
      blockingRulesMarkdown: req.body?.blockingRulesMarkdown,
      notes: req.body?.notes,
    });
    return res.json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '保存 connector guide revision 失败'),
    });
  }
});

router.post('/connector-guides/:policyId/revisions/:revisionId/validate', async (req, res) => {
  try {
    const data = await connectorGuideService.validateRevision(req.params.policyId, req.params.revisionId);
    return res.json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '校验 connector guide revision 失败'),
    });
  }
});

router.post('/connector-guides/:policyId/revisions/:revisionId/publish', async (req, res) => {
  try {
    const data = await connectorGuideService.publishRevision(req.params.policyId, req.params.revisionId);
    return res.json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '发布 connector guide revision 失败'),
    });
  }
});

router.post('/connector-guides/:policyId/revisions/:revisionId/rollback', async (req, res) => {
  try {
    const data = await connectorGuideService.rollbackRevision(req.params.policyId, req.params.revisionId);
    return res.json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '回滚 connector guide revision 失败'),
    });
  }
});

export default router;
