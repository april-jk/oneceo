import type { OsacMessage } from '../clients/osac-client';
import { ensureDatabaseConnection } from '../config/database';
import { sandboxExecutionEnvironmentDAO } from '../db/dao';
import { opencodeHttpClient } from '../connectors/opencode-http-client';
import { e2bConnector } from '../connectors/e2b-connector';
import { e2bConfig } from '../config/e2b-config';
import { osacConnectionManager } from './osac-connection-manager';
import { opencodeEventStreamService } from './opencode-event-stream-service';
import {
  resolveLegacyOpencodeStatePath,
  resolveOpencodeStatePath,
  resolveOpencodeWorkspacePath,
} from '../utils/opencode-workspace';
import { auditOsacAction } from '../utils/osac-audit';
import { markSandboxDirty, touchSandbox } from './sandbox-activity-service';
import { sessionConnectorService } from './session-connector-service';
import { ensureSandboxRuntimeMetadata } from './sandbox-runtime-metadata-service';
import { sandboxSkillSyncService } from './sandbox-skill-sync-service';

type OpencodePartInput = {
  type: string;
  text?: string;
  mime?: string;
  url?: string;
  name?: string;
};

type ExecutorName = 'opencode' | 'codex';

type ExecutorPartInput = OpencodePartInput;

type OpencodeHttpResponse = {
  requestId?: string;
  status?: number;
  headers?: Record<string, string>;
  body?: string;
};

type RuntimeInfo = {
  baseUrl: string;
  trafficAccessToken?: string | null;
  workspaceRoot?: string;
  stateRoot?: string;
};

type SandboxPromptDispatchResult = {
  accepted: boolean;
  sent: boolean;
  responseHeadSeen: boolean;
  status: number;
  detail: string;
  rc: number;
};

type McpProviderTransport =
  | {
      type: 'local_stdio';
      command: string[];
      env?: Record<string, string>;
    }
  | {
      type: 'remote_sse';
      url: string;
      headers?: Record<string, string>;
      env?: Record<string, string>;
    }
  | {
      type: 'streamable_http';
      url: string;
      headers?: Record<string, string>;
      env?: Record<string, string>;
    };

type McpProviderTool = {
  toolName: string;
  title?: string | null;
  description?: string | null;
  inputSchema?: Record<string, unknown> | null;
};

type McpProviderStatusPayload = {
  providerId?: string;
  sessionId?: string;
  status?: string;
  transport?: string;
  envVersion?: number;
  tools?: McpProviderTool[];
  errorMessage?: string;
};

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveWorkspaceRoot(sessionId: string, metadata: Record<string, unknown>) {
  const explicit =
    asString(metadata.workspaceRoot) ||
    asString(metadata.altusWorkspaceRoot) ||
    asString(metadata.opencodeWorkspaceRoot);
  if (explicit) return explicit;
  const taskSessionId = asString(metadata.taskSessionId);
  if (taskSessionId) return resolveOpencodeWorkspacePath(taskSessionId);
  return resolveOpencodeWorkspacePath(sessionId);
}

function resolveStateRoot(sessionId: string, metadata: Record<string, unknown>, workspaceRoot?: string) {
  const explicit =
    asString(metadata.stateRoot) ||
    asString(metadata.altusStateRoot) ||
    asString(metadata.opencodeStateRoot);
  if (explicit) return explicit;
  const taskSessionId = asString(metadata.taskSessionId);
  if (taskSessionId) return resolveOpencodeStatePath(taskSessionId);
  const legacy = resolveLegacyOpencodeStatePath(workspaceRoot);
  return legacy || resolveOpencodeStatePath(sessionId);
}

async function resolveRuntime(sessionId: string): Promise<RuntimeInfo> {
  await ensureDatabaseConnection({ retries: 3, delayMs: 1000 });
  const ensured = await ensureSandboxRuntimeMetadata(sessionId);
  if (!ensured) {
    throw new Error(`未找到执行环境: ${sessionId}`);
  }
  const workspaceRoot = resolveWorkspaceRoot(sessionId, ensured.metadata);
  const stateRoot = resolveStateRoot(sessionId, ensured.metadata, workspaceRoot);
  return {
    baseUrl: ensured.baseUrl,
    trafficAccessToken: ensured.trafficAccessToken,
    workspaceRoot,
    stateRoot,
  };
}

function buildSyntheticMessage(
  type: OsacMessage['type'],
  sessionId: string,
  payload: Record<string, unknown>
): OsacMessage {
  return {
    type,
    payload: {
      ...payload,
      orchestratorSessionId: sessionId,
    },
  };
}

function createOsacRequestId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeExecutorName(value: unknown): ExecutorName {
  const normalized = asString(value).toLowerCase();
  if (normalized === 'codex') return 'codex';
  return 'opencode';
}

function asPayloadRecord(message: OsacMessage | null | undefined): Record<string, unknown> {
  const payload = message?.payload;
  return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
}

function normalizeMcpProviderStatus(message: OsacMessage): McpProviderStatusPayload {
  const payload = asPayloadRecord(message);
  const tools = Array.isArray(payload.tools)
    ? payload.tools
        .map((item) => {
          const record = item && typeof item === 'object' ? (item as Record<string, unknown>) : null;
          if (!record) return null;
          const toolName = asString(record.toolName || record.name);
          if (!toolName) return null;
          return {
            toolName,
            title: asString(record.title) || null,
            description: asString(record.description) || null,
            inputSchema:
              record.inputSchema && typeof record.inputSchema === 'object'
                ? (record.inputSchema as Record<string, unknown>)
                : null,
          };
        })
        .filter(Boolean)
    : [];
  return {
    providerId: asString(payload.providerId) || undefined,
    sessionId: asString(payload.sessionId) || undefined,
    status: asString(payload.status) || undefined,
    transport: asString(payload.transport) || undefined,
    envVersion: typeof payload.envVersion === 'number' ? payload.envVersion : undefined,
    tools: tools as McpProviderTool[],
    errorMessage: asString(payload.errorMessage) || undefined,
  };
}

function throwExecutorError(message: OsacMessage): never {
  const payload = asPayloadRecord(message);
  const errorCode = asString(payload.code) || 'executor_error';
  const details =
    payload.details && typeof payload.details === 'object'
      ? (payload.details as Record<string, unknown>)
      : null;
  const detailedMessage =
    asString(details?.error) ||
    asString(details?.message) ||
    (typeof payload.details === 'string' ? asString(payload.details) : '');
  const errorMessage =
    detailedMessage ||
    asString(payload.message) ||
    'executor request failed';
  throw new Error(`${errorCode}: ${errorMessage}`);
}

function isAbortError(error: unknown): boolean {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return normalized.includes('aborted') || normalized.includes('timeout');
}

function isRetryablePromptError(error: unknown): boolean {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  if (isAbortError(error)) return true;
  if (normalized.includes('fetch failed')) return true;
  if (normalized.includes('network')) return true;
  if (normalized.includes('socket hang up')) return true;
  if (normalized.includes('econnreset')) return true;
  if (normalized.includes('econnrefused')) return true;
  if (normalized.includes('etimedout')) return true;
  if (normalized.includes('eai_again')) return true;
  const statusMatch = normalized.match(/opencode send prompt failed:\s*(\d{3})/);
  if (statusMatch) {
    const status = Number(statusMatch[1]);
    if ([429, 500, 502, 503, 504].includes(status)) {
      return true;
    }
  }
  return false;
}

function getErrorMessage(error: unknown): string {
  if (!error) return 'unknown error';
  return error instanceof Error ? error.message : String(error);
}

function preferSandboxPromptDispatch(): boolean {
  // OpenCode's POST /session/:id/message can stay open long enough to hit our HTTP timeout
  // even after the prompt has already been accepted. Default to in-sandbox fire-and-forget
  // dispatch so timeout fallback does not duplicate the same user turn.
  return String(process.env.OPENCODE_PROMPT_PREFER_SANDBOX || 'true')
    .trim()
    .toLowerCase() !== 'false';
}

async function ensureOpencodeServer(sessionId: string, runtime: RuntimeInfo) {
  try {
    await opencodeHttpClient.ensureServerReady(runtime.baseUrl, runtime.trafficAccessToken || undefined);
    return;
  } catch {
    // start server if not ready
  }

  const opencodeDataHome = asString(runtime.stateRoot);
  const envPrefix = opencodeDataHome ? `XDG_DATA_HOME=${shellEscape(opencodeDataHome)} ` : '';
  const command = `${envPrefix}nohup opencode serve --hostname ${e2bConfig.opencodeHost} --port ${e2bConfig.opencodePort} > /tmp/opencode-server.log 2>&1 &`;
  await e2bConnector.runCommand(sessionId, command, { timeoutMs: 30000 });

  const maxAttempts = Math.max(5, Number(process.env.OPENCODE_SERVER_START_ATTEMPTS || 20));
  const delayMs = Math.max(200, Number(process.env.OPENCODE_SERVER_START_DELAY_MS || 500));
  let lastError: unknown = null;
  for (let i = 0; i < maxAttempts; i += 1) {
    try {
      await opencodeHttpClient.ensureServerReady(runtime.baseUrl, runtime.trafficAccessToken || undefined);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`opencode serve 启动失败: ${message}`);
}

async function dispatchPromptInSandbox(
  sessionId: string,
  input: { opencodeSessionId: string; parts: OpencodePartInput[]; workspacePath?: string }
): Promise<SandboxPromptDispatchResult> {
  const directory = input.workspacePath ? `?directory=${encodeURIComponent(input.workspacePath)}` : '';
  const url = `http://127.0.0.1:${e2bConfig.opencodePort}/session/${encodeURIComponent(
    input.opencodeSessionId
  )}/message${directory}`;
  const payload = JSON.stringify({ parts: input.parts || [] });
  const payloadB64 = Buffer.from(payload, 'utf-8').toString('base64');
  const command = `python3 - <<'PY'
import base64, json, socket, sys, urllib.parse
payload = base64.b64decode('${payloadB64}').decode('utf-8')
url = '${url}'
body = payload.encode('utf-8')
parsed = urllib.parse.urlsplit(url)
host = parsed.hostname or '127.0.0.1'
port = parsed.port or 80
path = parsed.path or '/'
if parsed.query:
    path += '?' + parsed.query
request = (
    f"POST {path} HTTP/1.1\\r\\n"
    f"Host: {host}:{port}\\r\\n"
    "Content-Type: application/json\\r\\n"
    f"Content-Length: {len(body)}\\r\\n"
    "Connection: close\\r\\n\\r\\n"
).encode('utf-8') + body

result = {"accepted": False, "sent": False, "responseHeadSeen": False, "status": 0, "detail": ""}
try:
    sock = socket.create_connection((host, int(port)), timeout=5)
    try:
        sock.sendall(request)
        result["sent"] = True
        sock.settimeout(2)
        head = b""
        try:
            head = sock.recv(128)
        except socket.timeout:
            head = b""
        status = 0
        preview = ""
        response_head_seen = False
        if head:
            response_head_seen = True
            preview = head.decode('utf-8', 'ignore').splitlines()[0][:180]
            if preview.startswith("HTTP/"):
                parts = preview.split()
                if len(parts) >= 2 and parts[1].isdigit():
                    status = int(parts[1])
        # status=0 means response head not observed in short timeout; request is already sent.
        accepted = status == 0 or status < 400 or status == 409
        result = {
            "accepted": accepted,
            "sent": True,
            "responseHeadSeen": response_head_seen,
            "status": status,
            "detail": preview,
        }
    except Exception as e:
        result = {
            "accepted": bool(result.get("sent")) and int(result.get("status", 0) or 0) == 0,
            "sent": bool(result.get("sent")),
            "responseHeadSeen": bool(result.get("responseHeadSeen")),
            "status": int(result.get("status", 0) or 0),
            "detail": str(e),
        }
    finally:
        sock.close()
except Exception as e:
    result = {
        "accepted": False,
        "sent": bool(result.get("sent")),
        "responseHeadSeen": bool(result.get("responseHeadSeen")),
        "status": int(result.get("status", 0) or 0),
        "detail": str(e),
    }
print("OCPROMPT_RESULT=" + json.dumps(result, ensure_ascii=False, separators=(",", ":")))
sys.exit(0 if result.get("accepted") else 1)
PY
__oc_prompt_rc=$?
echo "__OCPROMPT_RC__=\${__oc_prompt_rc}"
exit 0
`;
  const result: any = await e2bConnector.runCommand(sessionId, command, { timeoutMs: 30000 });
  const output = String(result?.stdout || result?.output || '');
  const rcMatch = output.match(/__OCPROMPT_RC__=(\d+)/);
  const rc = rcMatch ? Number(rcMatch[1]) : -1;
  const jsonLine = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith('OCPROMPT_RESULT='));

  let accepted = false;
  let sent = false;
  let responseHeadSeen = false;
  let status = 0;
  let detail = '';
  if (jsonLine) {
    try {
      const parsed = JSON.parse(jsonLine.slice('OCPROMPT_RESULT='.length)) as Record<string, unknown>;
      accepted = Boolean(parsed.accepted ?? parsed.ok);
      sent = Boolean(parsed.sent);
      responseHeadSeen = Boolean(parsed.responseHeadSeen);
      status = Number(parsed.status || 0);
      detail = String(parsed.detail || '');
    } catch (error) {
      throw new Error(`sandbox prompt result parse failed: ${getErrorMessage(error)}; raw=${output.slice(0, 300)}`);
    }
  }

  return {
    accepted,
    sent,
    responseHeadSeen,
    status,
    detail,
    rc,
  };
}

export class OsacAgentService {
  async ensurePlaywrightMcp(sessionId: string): Promise<void> {
    try {
      await ensureDatabaseConnection({ retries: 3, delayMs: 1000 });
      const environment = await sandboxExecutionEnvironmentDAO.getBySessionId(sessionId);
      if (!environment) {
        console.warn('[MCP] sandbox environment not found', sessionId);
        return;
      }
      const metadata = (environment.metadata || {}) as Record<string, unknown>;
      const opencodeMeta = (metadata.opencode as Record<string, unknown>) || {};
      const mcpMeta = (opencodeMeta.mcp as Record<string, unknown>) || {};
      const playwrightMeta = (mcpMeta.playwright as Record<string, unknown>) || {};
      const cdpPort = Number(process.env.NEKO_CDP_PORT || 9222);
      const desiredCdpEndpoint = `http://127.0.0.1:${Number.isFinite(cdpPort) && cdpPort > 0 ? cdpPort : 9222}`;
      if (
        playwrightMeta.installedAt &&
        playwrightMeta.status === 'ready' &&
        asString(playwrightMeta.cdpEndpoint) === desiredCdpEndpoint
      ) {
        return;
      }

      const command = `python3 - <<'PY'
import json
from pathlib import Path

config_path = Path.home() / ".config" / "opencode" / "opencode.json"
config_path.parent.mkdir(parents=True, exist_ok=True)

data = {}
if config_path.exists():
    try:
        data = json.loads(config_path.read_text())
    except Exception:
        data = {}

if not isinstance(data, dict):
    data = {}

mcp = data.get("mcp")
if not isinstance(mcp, dict):
    mcp = {}

import shutil
import os

display = os.environ.get("NEKO_DISPLAY", ":0")

use_bin = shutil.which("playwright-mcp") is not None
base_cmd = ["playwright-mcp"] if use_bin else ["npx", "@playwright/mcp@latest"]
mcp["playwright"] = {
    "type": "local",
    "command": [
        "/usr/bin/env",
        f"DISPLAY={display}",
        "PLAYWRIGHT_HEADLESS=false",
        "XDG_RUNTIME_DIR=/tmp",
        *base_cmd,
        "--cdp-endpoint",
        "${desiredCdpEndpoint}",
    ],
    "enabled": True
}

data["mcp"] = mcp

if "$schema" not in data:
    data["$schema"] = "https://opencode.ai/config.json"

config_path.write_text(json.dumps(data, indent=2, ensure_ascii=False))
print("playwright mcp configured")
PY`;
      await e2bConnector.runCommand(sessionId, command, { timeoutMs: 120000 });

      const updated = {
        ...metadata,
        opencode: {
          ...opencodeMeta,
          mcp: {
            ...mcpMeta,
            playwright: {
              status: 'ready',
              installedAt: new Date().toISOString(),
              command: 'opencode.json.mcp.playwright',
              cdpEndpoint: desiredCdpEndpoint,
            },
          },
        },
      };
      await sandboxExecutionEnvironmentDAO.updateMetadata(sessionId, updated);
    } catch (error) {
      console.warn('[MCP] ensure playwright mcp failed', sessionId, error);
      try {
        const environment = await sandboxExecutionEnvironmentDAO.getBySessionId(sessionId);
        if (!environment) return;
        const metadata = (environment.metadata || {}) as Record<string, unknown>;
        const opencodeMeta = (metadata.opencode as Record<string, unknown>) || {};
        const mcpMeta = (opencodeMeta.mcp as Record<string, unknown>) || {};
        await sandboxExecutionEnvironmentDAO.updateMetadata(sessionId, {
          ...metadata,
          opencode: {
            ...opencodeMeta,
            mcp: {
              ...mcpMeta,
              playwright: {
                status: 'failed',
                error: error instanceof Error ? error.message : String(error),
                updatedAt: new Date().toISOString(),
              },
            },
          },
        });
      } catch (metaError) {
        console.warn('[MCP] update metadata failed', metaError);
      }
    }
  }

  async getRuntimeInfo(sessionId: string): Promise<RuntimeInfo> {
    return resolveRuntime(sessionId);
  }

  async executeCommand(
    sessionId: string,
    input: {
      command: string;
      sessionId?: string;
      continueSession?: boolean;
      options?: Record<string, unknown>;
    }
  ) {
    auditOsacAction('EXECUTE_COMMAND', { sessionId, command: input.command });
    await this.executeCommandAndWait(sessionId, input, { timeoutMs: 900000, pollMs: 2000 });
    return { status: 'sent' };
  }

  async executeCommandAndWait(
    sessionId: string,
    input: {
      command: string;
      sessionId?: string;
      continueSession?: boolean;
      options?: Record<string, unknown>;
    },
    config?: { timeoutMs?: number; pollMs?: number }
  ) {
    const options = input.options || {};
    const shell = Boolean(options.shell);
    const cwd = typeof options.cwd === 'string' ? options.cwd : '';
    const envs = (options.envs as Record<string, string>) || undefined;
    let command = input.command;
    await touchSandbox(sessionId, 'sdk_execute_command');
    if (shell) {
      command = `/bin/bash -lc ${shellEscape(input.command)}`;
    }
    if (cwd) {
      command = `cd ${shellEscape(cwd)} && ${command}`;
    }

    const result: any = await e2bConnector.runCommand(sessionId, command, {
      envs,
      timeoutMs: config?.timeoutMs,
    });
    const output = String(result?.stdout || result?.output || '');
    const exitCode = Number.isFinite(result?.exitCode)
      ? result.exitCode
      : Number.isFinite(result?.exit_code)
        ? result.exit_code
        : Number.isFinite(result?.status)
          ? result.status
          : undefined;
    const status = exitCode === undefined || exitCode === 0 ? 'completed' : 'failed';
    await touchSandbox(sessionId, 'sdk_execute_result');
    await markSandboxDirty(sessionId, 'sdk_execute_command');
    const messages: OsacMessage[] = [
      {
        type: 'COMMAND_OUTPUT',
        payload: { output },
      },
    ];

    return {
      status,
      output,
      messages,
    };
  }

  async getSessionList(sessionId: string, input?: { maxCount?: number; format?: string }) {
    await touchSandbox(sessionId, 'sdk_get_session_list');
    const runtime = await resolveRuntime(sessionId);
    const query: Record<string, string> = {};
    if (input?.maxCount) query.limit = String(input.maxCount);
    const response = await opencodeHttpClient.doRequest(
      runtime.baseUrl,
      {
        method: 'GET',
        path: '/session',
        query,
      },
      runtime.trafficAccessToken || undefined
    );
    const body = response.body || '[]';
    return { sessions: JSON.parse(body) };
  }

  async getSessionDetails(sessionId: string, opencodeSessionId: string) {
    await touchSandbox(sessionId, 'sdk_get_session_details');
    const runtime = await resolveRuntime(sessionId);
    const response = await opencodeHttpClient.doRequest(
      runtime.baseUrl,
      {
        method: 'GET',
        path: `/session/${encodeURIComponent(opencodeSessionId)}`,
      },
      runtime.trafficAccessToken || undefined
    );
    return JSON.parse(response.body || '{}');
  }

  async getSessionMessages(
    sessionId: string,
    input: { opencodeSessionId: string; workspacePath?: string }
  ) {
    await touchSandbox(sessionId, 'sdk_get_session_messages');
    const runtime = await resolveRuntime(sessionId);
    await ensureOpencodeServer(sessionId, runtime);
    return opencodeHttpClient.getSessionMessages(
      runtime.baseUrl,
      {
        sessionId: input.opencodeSessionId,
        directory: input.workspacePath || runtime.workspaceRoot,
      },
      runtime.trafficAccessToken || undefined
    );
  }

  async getSessionDiff(sessionId: string, opencodeSessionId: string) {
    await touchSandbox(sessionId, 'sdk_get_session_diff');
    const runtime = await resolveRuntime(sessionId);
    return opencodeHttpClient.getSessionDiff(
      runtime.baseUrl,
      { sessionId: opencodeSessionId },
      runtime.trafficAccessToken || undefined
    );
  }

  async listOpencodeQuestions(sessionId: string, input?: { workspacePath?: string }) {
    await touchSandbox(sessionId, 'sdk_list_opencode_questions');
    const runtime = await resolveRuntime(sessionId);
    await ensureOpencodeServer(sessionId, runtime);
    return opencodeHttpClient.listQuestions(
      runtime.baseUrl,
      {
        directory: input?.workspacePath || runtime.workspaceRoot,
      },
      runtime.trafficAccessToken || undefined
    );
  }

  async replyOpencodeQuestion(
    sessionId: string,
    input: { requestId: string; answers: string[][]; workspacePath?: string }
  ) {
    await touchSandbox(sessionId, 'sdk_reply_opencode_question');
    const runtime = await resolveRuntime(sessionId);
    await ensureOpencodeServer(sessionId, runtime);
    const result = await opencodeHttpClient.replyQuestion(
      runtime.baseUrl,
      {
        requestId: input.requestId,
        answers: input.answers,
        directory: input.workspacePath || runtime.workspaceRoot,
      },
      runtime.trafficAccessToken || undefined
    );
    await touchSandbox(sessionId, 'sdk_reply_opencode_question_done');
    return result;
  }

  async opencodeHttpRequest(
    sessionId: string,
    input: {
      method: string;
      path: string;
      query?: Record<string, string>;
      headers?: Record<string, string>;
      body?: string;
      workspacePath?: string;
    }
  ): Promise<OpencodeHttpResponse> {
    await touchSandbox(sessionId, 'sdk_opencode_http_request');
    const runtime = await resolveRuntime(sessionId);
    const response = await opencodeHttpClient.doRequest(
      runtime.baseUrl,
      {
        method: input.method,
        path: input.path,
        query: input.query,
        headers: input.headers,
        body: input.body,
      },
      runtime.trafficAccessToken || undefined
    );
    await touchSandbox(sessionId, 'sdk_opencode_http_response');
    return {
      status: response.status,
      headers: response.headers,
      body: response.body,
    };
  }

  async loadSkill(
    sessionId: string,
    input?: { skillName: string; skillContent: string; overwrite?: boolean }
  ) {
    auditOsacAction('LOAD_SKILL', { sessionId });
    if (!input?.skillName || !input.skillContent) {
      throw new Error('缺少 skillName 或 skillContent');
    }
    return sandboxSkillSyncService.upsertCustomSkill({
      orchestratorSessionId: sessionId,
      skillName: input.skillName,
      skillContent: input.skillContent,
    });
  }

  async unloadSkill(sessionId: string, skillName?: string) {
    auditOsacAction('UNLOAD_SKILL', { sessionId });
    if (!skillName) {
      throw new Error('缺少 skillName');
    }
    return sandboxSkillSyncService.removeSkill({
      orchestratorSessionId: sessionId,
      skillName,
    });
  }

  async loadSkillResource(
    sessionId: string,
    input?: {
      taskSessionId?: string | null;
      skill: {
        sourceType: 'platform' | 'custom';
        skillId: string;
        revisionId: string;
        slug: string;
        name: string;
        description: string;
        category: string;
        renderedMarkdown: string;
        revisionNumber: number | null;
        resourceSummary?: {
          totalCount: number;
          referenceCount: number;
          templateCount: number;
          paths: string[];
        } | null;
      };
      resourcePath: string;
    }
  ) {
    auditOsacAction('LOAD_SKILL_RESOURCE', { sessionId });
    if (!input?.skill || !input?.resourcePath) {
      throw new Error('缺少 skill 或 resourcePath');
    }
    return sandboxSkillSyncService.syncResolvedSkillResource({
      taskSessionId: input.taskSessionId || null,
      orchestratorSessionId: sessionId,
      skill: input.skill,
      resourcePath: input.resourcePath,
    });
  }

  async addMcpServer(
    sessionId: string,
    input?: { serverName: string; serverConfig: Record<string, unknown>; overwrite?: boolean }
  ) {
    auditOsacAction('ADD_MCP_SERVER', { sessionId });
    if (!input?.serverName || !input?.serverConfig) {
      throw new Error('缺少 serverName 或 serverConfig');
    }
    const runtime = await resolveRuntime(sessionId);
    await ensureOpencodeServer(sessionId, runtime);
    const response = await opencodeHttpClient.doRequest(
      runtime.baseUrl,
      {
        method: 'POST',
        path: '/mcp',
        body: JSON.stringify({
          name: input.serverName,
          config: input.serverConfig,
          overwrite: input.overwrite,
        }),
      },
      runtime.trafficAccessToken || undefined
    );
    if (response.status < 200 || response.status >= 300) {
      const body = String(response.body || '').toLowerCase();
      if (response.status !== 409 && !body.includes('already') && !body.includes('exists')) {
        throw new Error(response.body || `添加 MCP 失败: ${response.status}`);
      }
    }
    const connectResponse = await opencodeHttpClient.doRequest(
      runtime.baseUrl,
      {
        method: 'POST',
        path: `/mcp/${encodeURIComponent(input.serverName)}/connect`,
      },
      runtime.trafficAccessToken || undefined
    );
    if (connectResponse.status < 200 || connectResponse.status >= 300) {
      throw new Error(connectResponse.body || `连接 MCP 失败: ${connectResponse.status}`);
    }
    return {
      serverName: input.serverName,
      status: 'connected',
    };
  }

  async removeMcpServer(sessionId: string, serverName?: string) {
    auditOsacAction('REMOVE_MCP_SERVER', { sessionId });
    if (!serverName) {
      throw new Error('缺少 serverName');
    }
    const runtime = await resolveRuntime(sessionId);
    await ensureOpencodeServer(sessionId, runtime);
    const response = await opencodeHttpClient.doRequest(
      runtime.baseUrl,
      {
        method: 'POST',
        path: `/mcp/${encodeURIComponent(serverName)}/disconnect`,
      },
      runtime.trafficAccessToken || undefined
    );
    if (response.status >= 400 && response.status !== 404) {
      throw new Error(response.body || `卸载 MCP 失败: ${response.status}`);
    }
    return {
      serverName,
      status: 'disconnected',
    };
  }

  async registerMcpProvider(
    sessionId: string,
    input?: {
      providerId: string;
      taskSessionId?: string | null;
      connectorKey?: string | null;
      providerLabel?: string | null;
      transport: McpProviderTransport;
      overwrite?: boolean;
    }
  ) {
    auditOsacAction('REGISTER_MCP_PROVIDER', { sessionId, providerId: input?.providerId });
    if (!input?.providerId || !input.transport) {
      throw new Error('缺少 providerId 或 transport');
    }
    const reply = await osacConnectionManager.request(
      sessionId,
      {
        type: 'REGISTER_MCP_PROVIDER',
        requestId: createOsacRequestId('register_mcp_provider'),
        payload: {
          providerId: input.providerId,
          taskSessionId: input.taskSessionId || null,
          connectorKey: input.connectorKey || null,
          providerLabel: input.providerLabel || null,
          transport: input.transport,
          overwrite: input.overwrite === true,
        },
      },
      (message) => {
        const payload = asPayloadRecord(message);
        return message.type === 'MCP_PROVIDER_STATUS' && asString(payload.providerId) === input.providerId;
      }
    );
    if (reply.type === 'ERROR') {
      throwExecutorError(reply);
    }
    return normalizeMcpProviderStatus(reply);
  }

  async updateMcpProviderEnv(
    sessionId: string,
    input?: {
      providerId: string;
      env: Record<string, string>;
      restartPolicy?: 'before_next_call' | 'immediate';
    }
  ) {
    auditOsacAction('UPDATE_MCP_PROVIDER_ENV', { sessionId, providerId: input?.providerId });
    if (!input?.providerId || !input.env || typeof input.env !== 'object') {
      throw new Error('缺少 providerId 或 env');
    }
    const reply = await osacConnectionManager.request(
      sessionId,
      {
        type: 'UPDATE_MCP_PROVIDER_ENV',
        requestId: createOsacRequestId('update_mcp_provider_env'),
        payload: {
          providerId: input.providerId,
          env: input.env,
          restartPolicy: input.restartPolicy || 'before_next_call',
        },
      },
      (message) => {
        const payload = asPayloadRecord(message);
        return message.type === 'MCP_PROVIDER_STATUS' && asString(payload.providerId) === input.providerId;
      }
    );
    if (reply.type === 'ERROR') {
      throwExecutorError(reply);
    }
    return normalizeMcpProviderStatus(reply);
  }

  async attachMcpProviderToSession(
    sessionId: string,
    input?: {
      providerId: string;
      taskSessionId?: string | null;
      enabledTools?: string[];
    }
  ) {
    auditOsacAction('ATTACH_MCP_PROVIDER_TO_SESSION', { sessionId, providerId: input?.providerId });
    if (!input?.providerId) {
      throw new Error('缺少 providerId');
    }
    const reply = await osacConnectionManager.request(
      sessionId,
      {
        type: 'ATTACH_MCP_PROVIDER_TO_SESSION',
        requestId: createOsacRequestId('attach_mcp_provider'),
        payload: {
          sessionId,
          providerId: input.providerId,
          taskSessionId: input.taskSessionId || null,
          enabledTools: Array.isArray(input.enabledTools) ? input.enabledTools : [],
        },
      },
      (message) => {
        const payload = asPayloadRecord(message);
        return (
          message.type === 'MCP_PROVIDER_STATUS' &&
          asString(payload.providerId) === input.providerId &&
          asString(payload.sessionId) === sessionId
        );
      }
    );
    if (reply.type === 'ERROR') {
      throwExecutorError(reply);
    }
    return normalizeMcpProviderStatus(reply);
  }

  async detachMcpProviderFromSession(sessionId: string, providerId?: string) {
    auditOsacAction('DETACH_MCP_PROVIDER_FROM_SESSION', { sessionId, providerId });
    if (!providerId) {
      throw new Error('缺少 providerId');
    }
    const reply = await osacConnectionManager.request(
      sessionId,
      {
        type: 'DETACH_MCP_PROVIDER_FROM_SESSION',
        requestId: createOsacRequestId('detach_mcp_provider'),
        payload: {
          sessionId,
          providerId,
        },
      },
      (message) => {
        const payload = asPayloadRecord(message);
        return (
          message.type === 'MCP_PROVIDER_STATUS' &&
          asString(payload.providerId) === providerId &&
          asString(payload.sessionId) === sessionId
        );
      }
    );
    if (reply.type === 'ERROR') {
      throwExecutorError(reply);
    }
    return normalizeMcpProviderStatus(reply);
  }

  async removeMcpProvider(sessionId: string, providerId?: string) {
    auditOsacAction('REMOVE_MCP_PROVIDER', { sessionId, providerId });
    if (!providerId) {
      throw new Error('缺少 providerId');
    }
    const reply = await osacConnectionManager.request(
      sessionId,
      {
        type: 'REMOVE_MCP_PROVIDER',
        requestId: createOsacRequestId('remove_mcp_provider'),
        payload: {
          providerId,
        },
      },
      (message) => {
        const payload = asPayloadRecord(message);
        return message.type === 'MCP_PROVIDER_STATUS' && asString(payload.providerId) === providerId;
      }
    );
    if (reply.type === 'ERROR') {
      throwExecutorError(reply);
    }
    return normalizeMcpProviderStatus(reply);
  }

  async listSessionMcpTools(sessionId: string) {
    auditOsacAction('LIST_SESSION_MCP_TOOLS', { sessionId });
    const reply = await osacConnectionManager.request(
      sessionId,
      {
        type: 'LIST_SESSION_MCP_TOOLS',
        requestId: createOsacRequestId('list_session_mcp_tools'),
        payload: {
          sessionId,
        },
      },
      (message) => message.type === 'SESSION_MCP_TOOLS_RESPONSE'
    );
    if (reply.type === 'ERROR') {
      throwExecutorError(reply);
    }
    const payload = asPayloadRecord(reply);
    return {
      sessionId: asString(payload.sessionId) || sessionId,
      providers: Array.isArray(payload.providers) ? payload.providers : [],
      tools: Array.isArray(payload.tools) ? payload.tools : [],
    };
  }

  async callSessionMcpTool(
    sessionId: string,
    input?: {
      providerId: string;
      toolName: string;
      arguments?: Record<string, unknown>;
    }
  ) {
    auditOsacAction('CALL_SESSION_MCP_TOOL', {
      sessionId,
      providerId: input?.providerId,
      toolName: input?.toolName,
    });
    if (!input?.providerId || !input.toolName) {
      throw new Error('缺少 providerId 或 toolName');
    }
    await touchSandbox(sessionId, 'sdk_call_session_mcp_tool');
    const reply = await osacConnectionManager.request(
      sessionId,
      {
        type: 'CALL_SESSION_MCP_TOOL',
        requestId: createOsacRequestId('call_session_mcp_tool'),
        payload: {
          sessionId,
          providerId: input.providerId,
          toolName: input.toolName,
          arguments: input.arguments || {},
        },
      },
      (message) => message.type === 'MCP_TOOL_CALL_RESPONSE' || message.type === 'ERROR'
    );
    if (reply.type === 'ERROR') {
      throwExecutorError(reply);
    }
    const payload = asPayloadRecord(reply);
    await touchSandbox(sessionId, 'sdk_call_session_mcp_tool_done');
    if (payload.isError !== true) {
      await markSandboxDirty(sessionId, `sdk_call_session_mcp_tool:${input.toolName}`);
    }
    return {
      sessionId: asString(payload.sessionId) || sessionId,
      providerId: asString(payload.providerId) || input.providerId,
      toolName: asString(payload.toolName) || input.toolName,
      result: payload.result,
      isError: payload.isError === true,
    };
  }

  async initiateUpdate(
    sessionId: string,
    _input?: { updateType: string; version?: string; downloadUrl?: string; updateCommand?: string }
  ) {
    auditOsacAction('INITIATE_UPDATE', { sessionId });
    throw new Error('E2B 模式不支持 OSAC 自更新');
  }

  async ensureOpencodeServer(sessionId: string, input?: { host?: string; port?: number; workspacePath?: string }) {
    await touchSandbox(sessionId, 'ensure_opencode_server');
    const runtime = await resolveRuntime(sessionId);
    await ensureOpencodeServer(sessionId, runtime);
    await opencodeEventStreamService.ensureStream({
      orchestratorSessionId: sessionId,
      baseUrl: runtime.baseUrl,
      workspaceRoot: runtime.workspaceRoot || input?.workspacePath,
      trafficAccessToken: runtime.trafficAccessToken || undefined,
    });
    await sessionConnectorService.reconcileByOrchestratorSessionId(sessionId);
    osacConnectionManager.emitExternalMessage(
      sessionId,
      buildSyntheticMessage('OPENCODE_SERVER_READY', sessionId, {
        opencodeBaseUrl: runtime.baseUrl,
      })
    );
    return { opencodeBaseUrl: runtime.baseUrl };
  }

  async createOpencodeSession(sessionId: string, input?: { workspacePath?: string; title?: string }) {
    await touchSandbox(sessionId, 'create_opencode_session');
    const runtime = await resolveRuntime(sessionId);
    await ensureOpencodeServer(sessionId, runtime);
    const result = await opencodeHttpClient.createSession(
      runtime.baseUrl,
      {
        directory: input?.workspacePath || runtime.workspaceRoot,
        title: input?.title,
      },
      runtime.trafficAccessToken || undefined
    );
    osacConnectionManager.emitExternalMessage(
      sessionId,
      buildSyntheticMessage('OPENCODE_SESSION_READY', sessionId, {
        opencodeSessionId: result.id,
      })
    );
    await touchSandbox(sessionId, 'opencode_session_created');
    return { opencodeSessionId: result.id };
  }

  async sendOpencodePrompt(
    sessionId: string,
    input: { opencodeSessionId: string; parts: OpencodePartInput[]; workspacePath?: string }
  ) {
    await touchSandbox(sessionId, 'send_opencode_prompt');
    const runtime = await resolveRuntime(sessionId);
    await ensureOpencodeServer(sessionId, runtime);

    const sendViaHttp = async () => {
      await opencodeHttpClient.sendPrompt(
        runtime.baseUrl,
        {
          sessionId: input.opencodeSessionId,
          directory: input.workspacePath || runtime.workspaceRoot,
          parts: input.parts || [],
        },
        runtime.trafficAccessToken || undefined
      );
    };

    const logFallback = String(process.env.OPENCODE_PROMPT_TIMEOUT_LOG || 'false')
      .trim()
      .toLowerCase() === 'true';

    if (preferSandboxPromptDispatch()) {
      try {
        const sandboxResult = await dispatchPromptInSandbox(sessionId, {
          opencodeSessionId: input.opencodeSessionId,
          parts: input.parts || [],
          workspacePath: input.workspacePath || runtime.workspaceRoot,
        });
        if (!sandboxResult.accepted) {
          const sandboxMessage = `status=${sandboxResult.status || 'unknown'}; rc=${sandboxResult.rc}; detail=${sandboxResult.detail || 'none'}`;
          if (logFallback) {
            console.warn('[OPENCODE_PROMPT_SANDBOX_FAILED] fallback to http:', sandboxResult);
          }
          try {
            await sendViaHttp();
          } catch (httpError) {
            const httpMessage = getErrorMessage(httpError);
            if (!isRetryablePromptError(httpError)) {
              throw new Error(`opencode prompt failed: sandbox=${sandboxMessage}; http=${httpMessage}`);
            }
            await ensureOpencodeServer(sessionId, runtime);
            try {
              await sendViaHttp();
            } catch (retryError) {
              const retryMessage = getErrorMessage(retryError);
              throw new Error(
                `opencode prompt failed after sandbox+http retry: sandbox=${sandboxMessage}; http=${httpMessage}; retry=${retryMessage}`
              );
            }
          }
        }
      } catch (sandboxError) {
        const sandboxMessage = getErrorMessage(sandboxError);
        if (logFallback) {
          console.warn('[OPENCODE_PROMPT_SANDBOX_FAILED] fallback to http:', sandboxError);
        }
        try {
          await sendViaHttp();
        } catch (httpError) {
          const httpMessage = getErrorMessage(httpError);
          if (!isRetryablePromptError(httpError)) {
            throw new Error(`opencode prompt failed: sandbox=${sandboxMessage}; http=${httpMessage}`);
          }
          await ensureOpencodeServer(sessionId, runtime);
          try {
            await sendViaHttp();
          } catch (retryError) {
            const retryMessage = getErrorMessage(retryError);
            throw new Error(
              `opencode prompt failed after sandbox+http retry: sandbox=${sandboxMessage}; http=${httpMessage}; retry=${retryMessage}`
            );
          }
        }
      }
    } else {
      try {
        await sendViaHttp();
      } catch (error) {
        if (!isRetryablePromptError(error)) {
          throw error;
        }
        const primaryError = getErrorMessage(error);
        if (logFallback) {
          console.warn('[OPENCODE_PROMPT_FALLBACK] dispatch in sandbox:', error);
        }
        try {
          await dispatchPromptInSandbox(sessionId, {
            opencodeSessionId: input.opencodeSessionId,
            parts: input.parts || [],
            workspacePath: input.workspacePath || runtime.workspaceRoot,
          });
        } catch (fallbackError) {
          const fallbackMessage = getErrorMessage(fallbackError);
          await ensureOpencodeServer(sessionId, runtime);
          try {
            await sendViaHttp();
          } catch (retryError) {
            const retryMessage = getErrorMessage(retryError);
            throw new Error(
              `opencode prompt failed after fallback: primary=${primaryError}; fallback=${fallbackMessage}; retry=${retryMessage}`
            );
          }
        }
      }
    }

    osacConnectionManager.emitExternalMessage(
      sessionId,
      buildSyntheticMessage('OPENCODE_PROMPT_ACCEPTED', sessionId, {
        opencodeSessionId: input.opencodeSessionId,
      })
    );
    await touchSandbox(sessionId, 'opencode_prompt_accepted');
    return { opencodeSessionId: input.opencodeSessionId };
  }

  async ensureExecutorRuntime(
    sessionId: string,
    input: { executor: ExecutorName | string; workspacePath?: string }
  ) {
    const executor = normalizeExecutorName(input.executor);
    const requestId = createOsacRequestId('executor_runtime');
    auditOsacAction('EXECUTOR_RUNTIME_ENSURE', { sessionId, executor, requestId });
    const reply = await osacConnectionManager.request(
      sessionId,
      {
        type: 'EXECUTOR_RUNTIME_ENSURE',
        payload: {
          requestId,
          executor,
          workspacePath: input.workspacePath || undefined,
        },
      },
      (message) =>
        message.type === 'EXECUTOR_RUNTIME_READY' ||
        message.type === 'EXECUTOR_ERROR'
    );
    if (reply.type === 'EXECUTOR_ERROR') {
      throwExecutorError(reply);
    }
    const payload = asPayloadRecord(reply);
    return {
      executor,
      workspacePath: asString(payload.workspacePath) || input.workspacePath || undefined,
      orchestratorSessionId: asString(payload.orchestratorSessionId) || sessionId,
    };
  }

  async createExecutorSession(
    sessionId: string,
    input: { executor: ExecutorName | string; workspacePath?: string; title?: string }
  ) {
    const executor = normalizeExecutorName(input.executor);
    const requestId = createOsacRequestId('executor_create');
    auditOsacAction('EXECUTOR_SESSION_CREATE', { sessionId, executor, requestId });
    const reply = await osacConnectionManager.request(
      sessionId,
      {
        type: 'EXECUTOR_SESSION_CREATE',
        payload: {
          requestId,
          executor,
          workspacePath: input.workspacePath || undefined,
          title: input.title || undefined,
        },
      },
      (message) =>
        message.type === 'EXECUTOR_SESSION_READY' ||
        message.type === 'EXECUTOR_ERROR'
    );
    if (reply.type === 'EXECUTOR_ERROR') {
      throwExecutorError(reply);
    }
    const payload = asPayloadRecord(reply);
    return {
      executor,
      orchestratorSessionId: asString(payload.orchestratorSessionId) || sessionId,
      executorSessionId: asString(payload.executorSessionId),
    };
  }

  async resumeExecutorSession(
    sessionId: string,
    input: { executor: ExecutorName | string; executorSessionId: string; workspacePath?: string }
  ) {
    const executor = normalizeExecutorName(input.executor);
    const requestId = createOsacRequestId('executor_resume');
    auditOsacAction('EXECUTOR_SESSION_RESUME', {
      sessionId,
      executor,
      executorSessionId: input.executorSessionId,
      requestId,
    });
    const reply = await osacConnectionManager.request(
      sessionId,
      {
        type: 'EXECUTOR_SESSION_RESUME',
        payload: {
          requestId,
          executor,
          executorSessionId: input.executorSessionId,
          workspacePath: input.workspacePath || undefined,
        },
      },
      (message) =>
        message.type === 'EXECUTOR_SESSION_READY' ||
        message.type === 'EXECUTOR_ERROR'
    );
    if (reply.type === 'EXECUTOR_ERROR') {
      throwExecutorError(reply);
    }
    const payload = asPayloadRecord(reply);
    return {
      executor,
      orchestratorSessionId: asString(payload.orchestratorSessionId) || sessionId,
      executorSessionId: asString(payload.executorSessionId) || input.executorSessionId,
    };
  }

  async sendExecutorInput(
    sessionId: string,
    input: {
      executor: ExecutorName | string;
      executorSessionId?: string;
      workspacePath?: string;
      parts: ExecutorPartInput[];
    }
  ) {
    const executor = normalizeExecutorName(input.executor);
    const requestId = createOsacRequestId('executor_input');
    auditOsacAction('EXECUTOR_INPUT_SEND', {
      sessionId,
      executor,
      executorSessionId: input.executorSessionId,
      requestId,
    });
    const reply = await osacConnectionManager.request(
      sessionId,
      {
        type: 'EXECUTOR_INPUT_SEND',
        payload: {
          requestId,
          executor,
          executorSessionId: input.executorSessionId || undefined,
          workspacePath: input.workspacePath || undefined,
          parts: input.parts || [],
        },
      },
      (message) =>
        message.type === 'EXECUTOR_INPUT_ACCEPTED' ||
        message.type === 'EXECUTOR_ERROR'
    );
    if (reply.type === 'EXECUTOR_ERROR') {
      throwExecutorError(reply);
    }
    const payload = asPayloadRecord(reply);
    return {
      executor,
      orchestratorSessionId: asString(payload.orchestratorSessionId) || sessionId,
      executorSessionId: asString(payload.executorSessionId) || input.executorSessionId || '',
      status: asString(payload.status) || 'accepted',
    };
  }

  async interruptExecutor(
    sessionId: string,
    input: { executor: ExecutorName | string; executorSessionId: string }
  ) {
    const executor = normalizeExecutorName(input.executor);
    const requestId = createOsacRequestId('executor_interrupt');
    auditOsacAction('EXECUTOR_INTERRUPT', {
      sessionId,
      executor,
      executorSessionId: input.executorSessionId,
      requestId,
    });
    const reply = await osacConnectionManager.request(
      sessionId,
      {
        type: 'EXECUTOR_INTERRUPT',
        payload: {
          requestId,
          executor,
          executorSessionId: input.executorSessionId,
        },
      },
      (message) =>
        message.type === 'EXECUTOR_STATUS_RESPONSE' ||
        message.type === 'EXECUTOR_ERROR'
    );
    if (reply.type === 'EXECUTOR_ERROR') {
      throwExecutorError(reply);
    }
    const payload = asPayloadRecord(reply);
    return {
      executor,
      executorSessionId: asString(payload.executorSessionId) || input.executorSessionId,
      status: asString(payload.status) || 'unknown',
      running: Boolean(payload.running),
    };
  }

  async getExecutorStatus(
    sessionId: string,
    input: { executor: ExecutorName | string; executorSessionId: string }
  ) {
    const executor = normalizeExecutorName(input.executor);
    const requestId = createOsacRequestId('executor_status');
    auditOsacAction('EXECUTOR_STATUS_GET', {
      sessionId,
      executor,
      executorSessionId: input.executorSessionId,
      requestId,
    });
    const reply = await osacConnectionManager.request(
      sessionId,
      {
        type: 'EXECUTOR_STATUS_GET',
        payload: {
          requestId,
          executor,
          executorSessionId: input.executorSessionId,
        },
      },
      (message) =>
        message.type === 'EXECUTOR_STATUS_RESPONSE' ||
        message.type === 'EXECUTOR_ERROR'
    );
    if (reply.type === 'EXECUTOR_ERROR') {
      throwExecutorError(reply);
    }
    const payload = asPayloadRecord(reply);
    const status =
      payload.status && typeof payload.status === 'object'
        ? (payload.status as Record<string, unknown>)
        : {};
    return {
      executor,
      executorSessionId: asString(payload.executorSessionId) || input.executorSessionId,
      status: asString(status.status) || 'unknown',
      running: Boolean(status.running),
      workspacePath: asString(status.workspacePath) || undefined,
      transport: asString(status.transport) || undefined,
      lastEventType: asString(status.lastEventType) || undefined,
      resolvedSessionId: asString(status.resolvedSessionId) || undefined,
    };
  }

  listMessages(sessionId: string, limit?: number) {
    return osacConnectionManager.listMessages(sessionId, limit);
  }

  async closeConnection(sessionId: string) {
    await opencodeEventStreamService.stopStream(sessionId);
    await osacConnectionManager.close(sessionId);
  }
}

function shellEscape(value: string): string {
  if (!value) return "''";
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

export const osacAgentService = new OsacAgentService();
