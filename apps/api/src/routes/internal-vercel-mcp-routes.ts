import { randomUUID } from 'node:crypto';
import express from 'express';
import { createRequireInternalToken } from './internal-auth-middleware';
import {
  INTERNAL_CONNECTOR_RUNTIME_AUTH_HEADER,
  parseInternalConnectorRuntimeToken,
} from '../services/internal-mcp-auth-service';
import { vercelMcpService } from '../services/vercel-mcp-service';
import { getPublicErrorMessage } from '../utils/error-response';

const router = express.Router();

router.use(
  createRequireInternalToken({
    disabledMessage: 'Vercel internal MCP 未启用',
    unauthorizedMessage: '未授权的 Vercel internal MCP 请求',
  })
);

router.post('/connectors/vercel/mcp', async (req, res) => {
  const mcpSessionId =
    (typeof req.header('mcp-session-id') === 'string' && req.header('mcp-session-id')?.trim()) ||
    randomUUID();
  res.setHeader('Mcp-Session-Id', mcpSessionId);

  try {
    const runtimeToken = String(req.header(INTERNAL_CONNECTOR_RUNTIME_AUTH_HEADER) || '').trim();
    if (!runtimeToken) {
      return res.status(401).json({
        jsonrpc: '2.0',
        id: req.body?.id ?? null,
        error: {
          code: -32000,
          message: getPublicErrorMessage('缺少 internal MCP 运行时鉴权上下文'),
        },
      });
    }

    const parsedRuntimeContext = parseInternalConnectorRuntimeToken(runtimeToken, 'vercel');
    const runtimeContext = {
      ...parsedRuntimeContext,
      connectorKey: 'vercel' as const,
    };
    const method = typeof req.body?.method === 'string' ? req.body.method.trim() : '';
    const id = req.body?.id ?? null;
    if (!method) {
      return res.status(400).json({
        jsonrpc: '2.0',
        id,
        error: {
          code: -32600,
          message: getPublicErrorMessage('MCP request 缺少 method'),
        },
      });
    }

    const result = await vercelMcpService.executeRpc({
      method,
      params:
        req.body?.params && typeof req.body.params === 'object' && !Array.isArray(req.body.params)
          ? (req.body.params as Record<string, unknown>)
          : {},
      runtimeContext,
    });

    if (req.body?.id === undefined || req.body?.id === null) {
      return res.status(202).end();
    }

    return res.json({
      jsonrpc: '2.0',
      id,
      result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Vercel MCP 调用失败';
    return res.status(400).json({
      jsonrpc: '2.0',
      id: req.body?.id ?? null,
      error: {
        code: -32000,
        message: getPublicErrorMessage(message),
      },
    });
  }
});

router.get('/connectors/vercel/mcp', (_req, res) => {
  return res.status(405).json({
    success: false,
    error: getPublicErrorMessage('Vercel internal MCP 仅支持 POST'),
  });
});

export default router;
