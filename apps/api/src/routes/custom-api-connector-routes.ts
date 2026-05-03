import express from 'express';
import { currentUserResolver } from '../services/current-user-resolver';
import { customApiConnectorService } from '../services/custom-api-connector-service';
import { getPublicErrorMessage } from '../utils/error-response';

const router = express.Router();

function handleError(res: express.Response, error: unknown, fallback: string, status = 400) {
  const message = error instanceof Error ? error.message : fallback;
  return res.status(status).json({
    success: false,
    error: getPublicErrorMessage(message || fallback),
  });
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean);
}

router.get('/definitions', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const data = await customApiConnectorService.listDefinitions(currentUser.userId);
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error, '获取 Custom API definitions 失败', 401);
  }
});

router.post('/definitions', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const data = await customApiConnectorService.createDefinition(currentUser.userId, req.body || {});
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, '创建 Custom API definition 失败');
  }
});

router.patch('/definitions/:definitionId', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const data = await customApiConnectorService.updateDefinition(
      currentUser.userId,
      req.params.definitionId,
      req.body || {}
    );
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error, '更新 Custom API definition 失败');
  }
});

router.post('/definitions/:definitionId/profiles', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const data = await customApiConnectorService.createProfile(
      currentUser.userId,
      req.params.definitionId,
      req.body || {}
    );
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, '保存 Custom API profile 失败');
  }
});

router.get('/definitions/:definitionId/tools', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const data = await customApiConnectorService.listTools(currentUser.userId, req.params.definitionId);
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error, '获取 Custom API tools 失败');
  }
});

router.post('/definitions/:definitionId/tools', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const data = await customApiConnectorService.createTool(
      currentUser.userId,
      req.params.definitionId,
      req.body || {}
    );
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, '创建 Custom API tool 失败');
  }
});

router.post('/definitions/:definitionId/test-connection', async (_req, res) => {
  return res.status(501).json({
    success: false,
    error: getPublicErrorMessage('test-connection 必须走 broker dry-run，当前接口尚未开放真实请求'),
  });
});

router.patch('/tools/:toolId', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const data = await customApiConnectorService.updateTool(currentUser.userId, req.params.toolId, req.body || {});
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error, '更新 Custom API tool 失败');
  }
});

router.post('/tools/:toolId/submit-review', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const data = await customApiConnectorService.submitReview(currentUser.userId, req.params.toolId);
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error, '提交 Custom API tool 审核失败');
  }
});

router.post('/tools/evaluate-risk', async (req, res) => {
  try {
    const data = await customApiConnectorService.evaluateRisk(req.body || {});
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error, '评估 Custom API tool 风险失败');
  }
});

router.post('/tools/:toolId/dry-run', async (_req, res) => {
  return res.status(501).json({
    success: false,
    error: getPublicErrorMessage('dry-run 当前只返回风险评估能力；真实请求只能通过 published MCP broker 执行'),
  });
});

router.post('/sessions/:taskSessionId/attach', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const data = await customApiConnectorService.attachToSession(
      currentUser.userId,
      req.params.taskSessionId,
      String(req.body?.definitionId || ''),
      String(req.body?.profileId || ''),
      asStringArray(req.body?.endpointToolIds),
      typeof req.body?.orchestratorSessionId === 'string' ? req.body.orchestratorSessionId : undefined
    );
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error, '挂载 Custom API connector 失败');
  }
});

router.post('/confirmations', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const data = await customApiConnectorService.createConfirmation(currentUser.userId, req.body || {});
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, '创建 Custom API confirmation 失败');
  }
});

export default router;
