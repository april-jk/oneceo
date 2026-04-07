import express from 'express';
import { e2bConnector } from '../connectors/e2b-connector';
import { opencodeHttpClient } from '../connectors/opencode-http-client';
import { getPublicErrorMessage } from '../utils/error-response';
import { sandboxEnvironmentService } from '../services/sandbox-environment-service';
import { archiveSandboxWorkspace, restoreWorkspaceIfArchived } from '../services/sandbox-archive-service';

const router = express.Router();

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function toPortFromEndpoint(endpoint: string): number | null {
  const value = asText(endpoint);
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.port) return Number(url.port);
  } catch {
    const match = value.match(/:(\d+)(?:\/|$)/);
    if (match) return Number(match[1]);
  }
  return null;
}

function handleError(res: express.Response, error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  return res.status(502).json({
    success: false,
    error: getPublicErrorMessage(message || fallback),
  });
}

function ok(res: express.Response, payload: { data: unknown; requestId?: string; code?: number; message?: string }) {
  return res.json({
    success: true,
    code: payload.code,
    message: payload.message,
    requestId: payload.requestId,
    data: payload.data,
  });
}

router.get('/health', async (_req, res) => {
  try {
    return ok(res, { data: { provider: 'e2b', status: 'ok' } });
  } catch (error) {
    return handleError(res, error, '获取 Sandbox 服务健康状态失败');
  }
});

router.post('/sessions', async (req, res) => {
  try {
    const result = await sandboxEnvironmentService.openEnvironment({
      metadata: req.body?.metadata || {},
    });
    return res.status(201).json({ success: true, data: result });
  } catch (error) {
    return handleError(res, error, '创建 Sandbox 失败');
  }
});

router.get('/sessions/:sessionId', async (req, res) => {
  try {
    const info = await e2bConnector.getSandboxInfo(req.params.sessionId);
    return ok(res, { data: info });
  } catch (error) {
    return handleError(res, error, '获取 Sandbox 失败');
  }
});

router.post('/sessions/:sessionId/close', async (req, res) => {
  try {
    const result = await sandboxEnvironmentService.closeEnvironment(req.params.sessionId);
    return res.json({ success: true, data: result });
  } catch (error) {
    return handleError(res, error, '关闭 Sandbox 失败');
  }
});

// execution environment (base + incremental + db mapping)
router.post('/environment/open', async (req, res) => {
  try {
    const idempotencyKey = req.header('Idempotency-Key') || undefined;
    const result = await sandboxEnvironmentService.openEnvironment({
      metadata: req.body?.metadata || {},
      idempotencyKey,
    });
    return res.status(201).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return handleError(res, error, '创建执行层 KVM 环境失败');
  }
});

router.get('/environment/:sessionId', async (req, res) => {
  try {
    return res.json({
      success: true,
      data: await sandboxEnvironmentService.getEnvironment(req.params.sessionId),
    });
  } catch (error) {
    return handleError(res, error, '获取执行层 KVM 环境失败');
  }
});

router.get('/environment', async (req, res) => {
  try {
    const limit = Number(req.query.limit || 20);
    return res.json({
      success: true,
      data: await sandboxEnvironmentService.listEnvironments(limit),
    });
  } catch (error) {
    return handleError(res, error, '获取执行层 KVM 环境列表失败');
  }
});

router.post('/environment/:sessionId/close', async (req, res) => {
  try {
    return res.json({
      success: true,
      data: await sandboxEnvironmentService.closeEnvironment(req.params.sessionId),
    });
  } catch (error) {
    return handleError(res, error, '关闭执行层 KVM 环境失败');
  }
});

router.post('/environment/:sessionId/archive', async (req, res) => {
  try {
    const result = await archiveSandboxWorkspace(req.params.sessionId, 'admin_management_manual_archive', {
      forceUpload: true,
    });
    return res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    return handleError(res, error, '手动归档 Sandbox 失败');
  }
});

router.post('/environment/:sessionId/restore', async (req, res) => {
  try {
    const snapshotKey = asText(req.body?.snapshotKey);
    const restored = await restoreWorkspaceIfArchived(req.params.sessionId, {
      snapshotKey: snapshotKey || undefined,
    });
    return res.json({
      success: true,
      data: {
        sessionId: req.params.sessionId,
        restored,
      },
    });
  } catch (error) {
    return handleError(res, error, '恢复 Sandbox 工作区失败');
  }
});

router.post('/environment/:sessionId/connectivity-check', async (req, res) => {
  try {
    const environment = await sandboxEnvironmentService.getEnvironment(req.params.sessionId);
    const metadata = asRecord(environment.metadata);
    const e2bMeta = asRecord(metadata.e2b);
    const osacEndpoint = asText(metadata.osacEndpoint);
    const opencodeBaseUrl = asText(metadata.opencodeBaseUrl);
    const trafficAccessToken =
      asText(metadata.trafficAccessToken) ||
      asText(e2bMeta.trafficAccessToken) ||
      undefined;
    const workspaceRoot = asText(metadata.opencodeWorkspaceRoot);
    const stateRoot = asText(metadata.opencodeStateRoot);
    const osacPort = toPortFromEndpoint(osacEndpoint) || Number(metadata.osacPort || 18080);

    let opencode: Record<string, unknown> = {
      configured: Boolean(opencodeBaseUrl),
      reachable: false,
    };
    if (opencodeBaseUrl) {
      try {
        await opencodeHttpClient.ensureServerReady(opencodeBaseUrl, trafficAccessToken);
        opencode = {
          configured: true,
          reachable: true,
          baseUrl: opencodeBaseUrl,
        };
      } catch (error) {
        opencode = {
          configured: true,
          reachable: false,
          baseUrl: opencodeBaseUrl,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    let osac: Record<string, unknown> = {
      configured: Boolean(osacEndpoint),
      endpoint: osacEndpoint || undefined,
      reachable: false,
    };
    try {
      const result: any = await e2bConnector.runCommand(
        req.params.sessionId,
        `sh -lc "ss -ltnp 2>/dev/null | grep ':${osacPort} ' || true"`,
        { timeoutMs: 15000 }
      );
      const stdout = asText(result?.stdout || result?.output);
      osac = {
        ...osac,
        reachable: Boolean(stdout),
        listenProbe: stdout || null,
      };
    } catch (error) {
      osac = {
        ...osac,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    let workspace: Record<string, unknown> = {
      workspaceRoot: workspaceRoot || undefined,
      stateRoot: stateRoot || undefined,
    };
    if (workspaceRoot || stateRoot) {
      try {
        const cmd = [
          workspaceRoot ? `if [ -d '${workspaceRoot.replace(/'/g, `'\"'\"'`)}' ]; then echo WORKSPACE_OK; else echo WORKSPACE_MISSING; fi` : '',
          stateRoot ? `if [ -d '${stateRoot.replace(/'/g, `'\"'\"'`)}' ]; then echo STATE_OK; else echo STATE_MISSING; fi` : '',
        ]
          .filter(Boolean)
          .join(' ; ');
        const result: any = await e2bConnector.runCommand(req.params.sessionId, `sh -lc "${cmd}"`, {
          timeoutMs: 15000,
        });
        const stdout = asText(result?.stdout || result?.output);
        workspace = {
          ...workspace,
          workspaceReachable: stdout.includes('WORKSPACE_OK'),
          stateReachable: stdout.includes('STATE_OK'),
          probe: stdout || null,
        };
      } catch (error) {
        workspace = {
          ...workspace,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    return res.json({
      success: true,
      data: {
        sessionId: req.params.sessionId,
        checkedAt: new Date().toISOString(),
        osac,
        opencode,
        workspace,
      },
    });
  } catch (error) {
    return handleError(res, error, '执行 Sandbox 连通性检查失败');
  }
});

router.get('/sessions/:sessionId/quota', async (_req, res) => {
  return res.status(410).json({ success: false, error: getPublicErrorMessage('E2B 不支持配额查询') });
});

router.put('/sessions/:sessionId/quota', async (_req, res) => {
  return res.status(410).json({ success: false, error: getPublicErrorMessage('E2B 不支持配额更新') });
});

router.get('/jobs/:jobId', async (_req, res) => {
  return res.status(410).json({ success: false, error: getPublicErrorMessage('E2B 不支持 Job 查询') });
});

export default router;
