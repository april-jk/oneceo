import express from 'express';
import { currentUserResolver } from '../services/current-user-resolver';
import { customMcpConnectorService } from '../services/custom-mcp-connector-service';
import { getPublicErrorMessage } from '../utils/error-response';

const router = express.Router();

function handleError(res: express.Response, error: unknown, fallback: string, status = 400) {
  const message = error instanceof Error ? error.message : fallback;
  return res.status(status).json({
    success: false,
    error: getPublicErrorMessage(message || fallback),
  });
}

router.get('/profiles', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const data = await customMcpConnectorService.listProfiles(currentUser.userId);
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error, '获取 Custom MCP profiles 失败', 401);
  }
});

router.post('/profiles', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const data = await customMcpConnectorService.createProfile(currentUser.userId, req.body || {});
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, '创建 Custom MCP profile 失败');
  }
});

router.patch('/profiles/:profileId', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const data = await customMcpConnectorService.updateProfile(
      currentUser.userId,
      req.params.profileId,
      req.body || {}
    );
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error, '更新 Custom MCP profile 失败');
  }
});

router.delete('/profiles/:profileId', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const data = await customMcpConnectorService.deleteProfile(currentUser.userId, req.params.profileId);
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error, '删除 Custom MCP profile 失败');
  }
});

router.post('/import-json', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const data = await customMcpConnectorService.importJson(currentUser.userId, {
      json: req.body?.json ?? req.body,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error, '导入 Custom MCP JSON 失败');
  }
});

router.get('/profiles/:profileId/json', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const data = await customMcpConnectorService.getEditableJson(currentUser.userId, req.params.profileId);
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error, '读取 Custom MCP JSON 失败');
  }
});

router.put('/profiles/:profileId/json', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const data = await customMcpConnectorService.updateFromJson(
      currentUser.userId,
      req.params.profileId,
      req.body?.json ?? req.body
    );
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error, '保存 Custom MCP JSON 失败');
  }
});

router.post('/profiles/:profileId/test', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const data = await customMcpConnectorService.testProfile(currentUser.userId, req.params.profileId);
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error, '测试 Custom MCP 连接失败');
  }
});

router.post('/sessions/:taskSessionId/attach', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const data = await customMcpConnectorService.attachToSession(
      currentUser.userId,
      req.params.taskSessionId,
      String(req.body?.profileId || '').trim(),
      String(req.body?.orchestratorSessionId || '').trim() || undefined
    );
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error, '挂载 Custom MCP 失败');
  }
});

export default router;
