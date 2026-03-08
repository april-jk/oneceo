import express from 'express';
import { getPublicErrorMessage } from '../utils/error-response';
import { currentUserResolver } from '../services/current-user-resolver';
import { CONNECTOR_KEYS, type ConnectorKey } from '../services/connector-registry';
import { userConnectorService } from '../services/user-connector-service';

const router = express.Router();

function handleError(res: express.Response, error: unknown, fallback: string, status = 400) {
  const message = error instanceof Error ? error.message : fallback;
  return res.status(status).json({
    success: false,
    error: getPublicErrorMessage(message || fallback),
  });
}

function parseConnectorKey(value: string): ConnectorKey {
  if ((CONNECTOR_KEYS as readonly string[]).includes(value)) {
    return value as ConnectorKey;
  }
  throw new Error(`未知连接器: ${value}`);
}

router.get('/catalog', async (req, res) => {
  try {
    const catalog = await userConnectorService.listCatalog();
    return res.json({
      success: true,
      data: catalog,
    });
  } catch (error) {
    return handleError(res, error, '获取连接器目录失败', 500);
  }
});

router.get('/me', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const [catalog, accounts] = await Promise.all([
      userConnectorService.listCatalog(),
      userConnectorService.listUserAccounts(currentUser.userId),
    ]);
    return res.json({
      success: true,
      data: {
        userId: currentUser.userId,
        source: currentUser.source,
        catalog,
        accounts,
      },
    });
  } catch (error) {
    return handleError(res, error, '获取当前用户连接器失败', 401);
  }
});

router.put('/:connectorKey', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const connectorKey = parseConnectorKey(req.params.connectorKey);
    const saved = await userConnectorService.saveUserConnector(currentUser.userId, connectorKey, {
      displayName: req.body?.displayName,
      config: req.body?.config,
      credentials: req.body?.credentials,
    });
    return res.json({
      success: true,
      data: saved,
    });
  } catch (error) {
    return handleError(res, error, '保存连接器配置失败');
  }
});

router.post('/:connectorKey/oauth/start', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const connectorKey = parseConnectorKey(req.params.connectorKey);
    const result = await userConnectorService.startOAuth(currentUser.userId, connectorKey, {
      redirectUri: String(req.body?.redirectUri || '').trim(),
      returnToSessionId: String(req.body?.returnToSessionId || '').trim() || undefined,
    });
    return res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    return handleError(res, error, '启动连接器 OAuth 失败');
  }
});

router.post('/:connectorKey/oauth/callback', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const connectorKey = parseConnectorKey(req.params.connectorKey);
    const result = await userConnectorService.completeOAuth(currentUser.userId, connectorKey, {
      state: String(req.body?.state || '').trim(),
      code: String(req.body?.code || '').trim(),
      redirectUri: String(req.body?.redirectUri || '').trim(),
    });
    return res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    return handleError(res, error, '完成连接器 OAuth 失败');
  }
});

router.delete('/:connectorKey/auth', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const connectorKey = parseConnectorKey(req.params.connectorKey);
    const result = await userConnectorService.clearConnectorAuth(currentUser.userId, connectorKey);
    return res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    return handleError(res, error, '断开连接器授权失败');
  }
});

export default router;
