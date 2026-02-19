import express from 'express';
import fs from 'fs';
import path from 'path';
import { osacAgentService } from '../services/osac-agent-service';
import { getPublicErrorMessage } from '../utils/error-response';
import { osacBootstrapConfig } from '../config/osac-bootstrap-config';
import { sandboxAgentProvisionService } from '../services/sandbox-agent-provision-service';

const router = express.Router();

function handleError(res: express.Response, error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  return res.status(502).json({
    success: false,
    error: getPublicErrorMessage(message || fallback),
  });
}

function resolveBinaryPath(requested: 'osac' | 'opencode') {
  return requested === 'osac'
    ? osacBootstrapConfig.osacBinaryPath
    : osacBootstrapConfig.opencodeBinaryPath;
}

function assertBinaryAccess(req: express.Request, res: express.Response): boolean {
  if (!osacBootstrapConfig.binaryAuthToken) {
    return true;
  }
  const token = req.header('X-OSAC-BINARY-TOKEN');
  if (token === osacBootstrapConfig.binaryAuthToken) {
    return true;
  }
  res.status(401).json({ success: false, error: getPublicErrorMessage('未授权的下载请求') });
  return false;
}

router.post('/provision', async (req, res) => {
  try {
    const idempotencyKey = req.header('Idempotency-Key') || undefined;
    const result = await sandboxAgentProvisionService.provision({
      metadata: req.body?.metadata || {},
      idempotencyKey,
      bind: req.body?.bind || {},
      requestBaseUrl: `${req.protocol}://${req.get('host')}`,
    });
    return res.status(201).json({ success: true, data: result });
  } catch (error) {
    return handleError(res, error, 'OSAC 执行环境创建失败');
  }
});

router.get('/warm-pool/status', async (_req, res) => {
  try {
    const result = await sandboxAgentProvisionService.getWarmPoolStatus();
    return res.json({ success: true, data: result });
  } catch (error) {
    return handleError(res, error, '获取预热池状态失败');
  }
});

router.get('/binaries/:name', async (req, res) => {
  try {
    if (!assertBinaryAccess(req, res)) {
      return;
    }
    const name = req.params.name === 'osac' ? 'osac' : req.params.name === 'opencode' ? 'opencode' : null;
    if (!name) {
      return res.status(404).json({ success: false, error: getPublicErrorMessage('未找到二进制文件') });
    }

    const filePath = resolveBinaryPath(name);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: getPublicErrorMessage('文件不存在') });
    }

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);

    const stream = fs.createReadStream(filePath);
    stream.on('error', () => {
      res.status(500).json({ success: false, error: getPublicErrorMessage('读取文件失败') });
    });
    stream.pipe(res);
  } catch (error) {
    return handleError(res, error, '下载二进制文件失败');
  }
});

router.post('/:sessionId/execute', async (req, res) => {
  try {
    const { command, sessionId, continueSession, options } = req.body || {};
    if (!command) {
      return res.status(400).json({ success: false, error: getPublicErrorMessage('缺少 command') });
    }
    const result = await osacAgentService.executeCommand(req.params.sessionId, {
      command,
      sessionId,
      continueSession,
      options,
    });
    return res.json({ success: true, data: result });
  } catch (error) {
    return handleError(res, error, 'OSAC 执行命令失败');
  }
});

router.get('/:sessionId/sessions', async (req, res) => {
  try {
    const maxCount = req.query.maxCount ? Number(req.query.maxCount) : undefined;
    const format = req.query.format ? String(req.query.format) : undefined;
    const result = await osacAgentService.getSessionList(req.params.sessionId, { maxCount, format });
    return res.json({ success: true, data: result });
  } catch (error) {
    return handleError(res, error, 'OSAC 获取会话列表失败');
  }
});

router.get('/:sessionId/sessions/:opencodeSessionId', async (req, res) => {
  try {
    const result = await osacAgentService.getSessionDetails(req.params.sessionId, req.params.opencodeSessionId);
    return res.json({ success: true, data: result });
  } catch (error) {
    return handleError(res, error, 'OSAC 获取会话详情失败');
  }
});

router.post('/:sessionId/skills', async (req, res) => {
  try {
    const { skillName, skillContent, overwrite } = req.body || {};
    if (!skillName || !skillContent) {
      return res.status(400).json({ success: false, error: getPublicErrorMessage('缺少 skillName 或 skillContent') });
    }
    const result = await osacAgentService.loadSkill(req.params.sessionId, {
      skillName,
      skillContent,
      overwrite,
    });
    return res.json({ success: true, data: result });
  } catch (error) {
    return handleError(res, error, 'OSAC 加载技能失败');
  }
});

router.delete('/:sessionId/skills/:skillName', async (req, res) => {
  try {
    const result = await osacAgentService.unloadSkill(req.params.sessionId, req.params.skillName);
    return res.json({ success: true, data: result });
  } catch (error) {
    return handleError(res, error, 'OSAC 卸载技能失败');
  }
});

router.post('/:sessionId/mcp', async (req, res) => {
  try {
    const { serverName, serverConfig, overwrite } = req.body || {};
    if (!serverName || !serverConfig) {
      return res.status(400).json({ success: false, error: getPublicErrorMessage('缺少 serverName 或 serverConfig') });
    }
    const result = await osacAgentService.addMcpServer(req.params.sessionId, {
      serverName,
      serverConfig,
      overwrite,
    });
    return res.json({ success: true, data: result });
  } catch (error) {
    return handleError(res, error, 'OSAC 添加 MCP 失败');
  }
});

router.delete('/:sessionId/mcp/:serverName', async (req, res) => {
  try {
    const result = await osacAgentService.removeMcpServer(req.params.sessionId, req.params.serverName);
    return res.json({ success: true, data: result });
  } catch (error) {
    return handleError(res, error, 'OSAC 移除 MCP 失败');
  }
});

router.post('/:sessionId/update', async (req, res) => {
  try {
    const { updateType, version, downloadUrl, updateCommand } = req.body || {};
    if (!updateType) {
      return res.status(400).json({ success: false, error: getPublicErrorMessage('缺少 updateType') });
    }
    const result = await osacAgentService.initiateUpdate(req.params.sessionId, {
      updateType,
      version,
      downloadUrl,
      updateCommand,
    });
    return res.json({ success: true, data: result });
  } catch (error) {
    return handleError(res, error, 'OSAC 更新指令发送失败');
  }
});

router.get('/:sessionId/messages', async (req, res) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const result = osacAgentService.listMessages(req.params.sessionId, limit);
    return res.json({ success: true, data: result });
  } catch (error) {
    return handleError(res, error, 'OSAC 获取消息失败');
  }
});

router.post('/:sessionId/close', async (req, res) => {
  try {
    await osacAgentService.closeConnection(req.params.sessionId);
    return res.json({ success: true });
  } catch (error) {
    return handleError(res, error, 'OSAC 关闭连接失败');
  }
});

export default router;
