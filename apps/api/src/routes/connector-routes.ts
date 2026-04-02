import express from 'express';
import { getPublicErrorMessage } from '../utils/error-response';
import { currentUserResolver } from '../services/current-user-resolver';
import { CONNECTOR_KEYS, type ConnectorKey } from '../services/connector-registry';
import { githubConnectorRepositoryService } from '../services/github-connector-repository-service';
import { userConnectorService } from '../services/user-connector-service';
import { sessionConnectorService } from '../services/session-connector-service';

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

function queueProfileRuntimeRefresh(userId: string, profileId: string, context: string) {
  void sessionConnectorService.refreshAttachedBindingsForProfile(userId, profileId).catch((error) => {
    console.error(`[${context}]`, {
      userId,
      profileId,
      error: error instanceof Error ? error.message : String(error),
    });
  });
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
    const [catalog, profiles] = await Promise.all([
      userConnectorService.listCatalog(),
      userConnectorService.listUserProfiles(currentUser.userId),
    ]);
    return res.json({
      success: true,
      data: {
        userId: currentUser.userId,
        source: currentUser.source,
        catalog,
        profiles,
      },
    });
  } catch (error) {
    return handleError(res, error, '获取当前用户连接器失败', 401);
  }
});

router.get('/github/profiles/:profileId/repositories', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const items = await githubConnectorRepositoryService.listRepositories(
      currentUser.userId,
      req.params.profileId
    );
    return res.json({
      success: true,
      data: {
        items,
      },
    });
  } catch (error) {
    return handleError(res, error, '获取 GitHub 仓库列表失败', 401);
  }
});

router.post('/:connectorKey/profiles', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const connectorKey = parseConnectorKey(req.params.connectorKey);
    const saved = await userConnectorService.createProfile(currentUser.userId, connectorKey, {
      profileName: req.body?.profileName,
      displayName: req.body?.displayName,
      config: req.body?.config,
      credentials: req.body?.credentials,
      metadata: req.body?.metadata,
    });
    return res.json({
      success: true,
      data: saved,
    });
  } catch (error) {
    return handleError(res, error, '创建连接器 profile 失败');
  }
});

router.put('/profiles/:profileId', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const saved = await userConnectorService.updateProfile(currentUser.userId, req.params.profileId, {
      profileName: req.body?.profileName,
      displayName: req.body?.displayName,
      config: req.body?.config,
      credentials: req.body?.credentials,
      metadata: req.body?.metadata,
    });
    return res.json({
      success: true,
      data: saved,
    });
  } catch (error) {
    return handleError(res, error, '更新连接器 profile 失败');
  }
});

router.delete('/profiles/:profileId', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    await userConnectorService.deleteProfile(currentUser.userId, req.params.profileId);
    return res.json({
      success: true,
      data: {
        deleted: true,
      },
    });
  } catch (error) {
    return handleError(res, error, '删除连接器 profile 失败');
  }
});

router.put('/profiles/:profileId/default', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const saved = await userConnectorService.setDefaultProfile(currentUser.userId, req.params.profileId);
    return res.json({
      success: true,
      data: saved,
    });
  } catch (error) {
    return handleError(res, error, '设置默认 profile 失败');
  }
});

router.post('/profiles/:profileId/oauth/start', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const result = await userConnectorService.startOAuthForProfile(currentUser.userId, req.params.profileId, {
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

router.post('/profiles/:profileId/oauth/callback', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const result = await userConnectorService.completeOAuthByProfile(currentUser.userId, req.params.profileId, {
      state: String(req.body?.state || '').trim(),
      code: String(req.body?.code || '').trim(),
      redirectUri: String(req.body?.redirectUri || '').trim(),
    });
    const runtimeRefreshQueued = result.profile.authStatus === 'authorized';
    if (runtimeRefreshQueued) {
      queueProfileRuntimeRefresh(
        currentUser.userId,
        result.profile.profileId,
        'CONNECTOR_PROFILE_OAUTH_REFRESH_FAILED'
      );
    }
    return res.json({
      success: true,
      data: {
        ...result,
        runtimeRefreshQueued,
      },
    });
  } catch (error) {
    return handleError(res, error, '完成连接器 OAuth 失败');
  }
});

router.delete('/profiles/:profileId/auth', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const result = await userConnectorService.clearProfileAuth(currentUser.userId, req.params.profileId);
    void sessionConnectorService.detachBindingsForProfile(currentUser.userId, req.params.profileId).catch((error) => {
      console.error('[CONNECTOR_PROFILE_AUTH_DETACH_FAILED]', {
        profileId: req.params.profileId,
        userId: currentUser.userId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    return res.json({
      success: true,
      data: {
        ...result.profile,
        remoteGrantRevoked: result.remoteGrantRevoked,
        remoteGrantError: result.remoteGrantError,
        runtimeDetachQueued: true,
      },
    });
  } catch (error) {
    return handleError(res, error, '断开连接器授权失败');
  }
});

// Backward-compatible endpoints while the frontend migrates to profile-based APIs.
router.put('/:connectorKey', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const connectorKey = parseConnectorKey(req.params.connectorKey);
    const saved = await userConnectorService.saveUserConnector(currentUser.userId, connectorKey, {
      profileName: req.body?.profileName,
      displayName: req.body?.displayName,
      config: req.body?.config,
      credentials: req.body?.credentials,
      metadata: req.body?.metadata,
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
    const profileId = result.account?.defaultProfileId || result.account?.profileId;
    const runtimeRefreshQueued = Boolean(profileId && result.account?.authStatus === 'authorized');
    if (runtimeRefreshQueued && profileId) {
      queueProfileRuntimeRefresh(
        currentUser.userId,
        profileId,
        'CONNECTOR_OAUTH_REFRESH_FAILED'
      );
    }
    return res.json({
      success: true,
      data: {
        ...result,
        runtimeRefreshQueued,
      },
    });
  } catch (error) {
    return handleError(res, error, '完成连接器 OAuth 失败');
  }
});

router.delete('/:connectorKey/auth', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const connectorKey = parseConnectorKey(req.params.connectorKey);
    const existing = await userConnectorService.getDefaultOrFirstProfile(currentUser.userId, connectorKey);
    const result = await userConnectorService.clearConnectorAuth(currentUser.userId, connectorKey);
    if (existing) {
      void sessionConnectorService.detachBindingsForProfile(currentUser.userId, existing.profileId).catch((error) => {
        console.error('[CONNECTOR_AUTH_DETACH_FAILED]', {
          connectorKey,
          profileId: existing.profileId,
          userId: currentUser.userId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
    return res.json({
      success: true,
      data: {
        ...result.account,
        remoteGrantRevoked: result.remoteGrantRevoked,
        remoteGrantError: result.remoteGrantError,
        runtimeDetachQueued: Boolean(existing),
      },
    });
  } catch (error) {
    return handleError(res, error, '断开连接器授权失败');
  }
});

export default router;
