import type { OsacMessage } from '../clients/osac-client';
import { ensureDatabaseConnection } from '../config/database';
import { sandboxExecutionEnvironmentDAO } from '../db/dao';
import { opencodeHttpClient } from '../connectors/opencode-http-client';
import { e2bConnector } from '../connectors/e2b-connector';
import { e2bConfig } from '../config/e2b-config';
import { osacConnectionManager } from './osac-connection-manager';
import { opencodeEventStreamService } from './opencode-event-stream-service';
import { resolveOpencodeWorkspacePath } from '../utils/opencode-workspace';
import { auditOsacAction } from '../utils/osac-audit';

type OpencodePartInput = {
  type: string;
  text?: string;
  mime?: string;
  url?: string;
  name?: string;
};

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
};

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveWorkspaceRoot(sessionId: string, metadata: Record<string, unknown>) {
  const explicit = asString(metadata.opencodeWorkspaceRoot);
  if (explicit) return explicit;
  const taskSessionId = asString(metadata.taskSessionId);
  if (taskSessionId) return resolveOpencodeWorkspacePath(taskSessionId);
  return resolveOpencodeWorkspacePath(sessionId);
}

async function resolveRuntime(sessionId: string): Promise<RuntimeInfo> {
  await ensureDatabaseConnection({ retries: 3, delayMs: 1000 });
  const environment = await sandboxExecutionEnvironmentDAO.getBySessionId(sessionId);
  if (!environment) {
    throw new Error(`未找到执行环境: ${sessionId}`);
  }
  const metadata = (environment.metadata || {}) as Record<string, unknown>;
  const baseUrl =
    asString(metadata.opencodeBaseUrl) ||
    asString((metadata.opencode as Record<string, unknown>)?.baseUrl) ||
    asString(metadata.osacEndpoint);
  if (!baseUrl) {
    throw new Error('未找到 OpenCode baseUrl（metadata.opencodeBaseUrl）');
  }
  const trafficAccessToken =
    asString((metadata.e2b as Record<string, unknown>)?.trafficAccessToken) ||
    asString(metadata.trafficAccessToken) ||
    null;
  const workspaceRoot = resolveWorkspaceRoot(sessionId, metadata);
  return { baseUrl, trafficAccessToken, workspaceRoot };
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

function isAbortError(error: unknown): boolean {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return normalized.includes('aborted') || normalized.includes('timeout');
}

async function ensureOpencodeServer(sessionId: string, runtime: RuntimeInfo) {
  try {
    await opencodeHttpClient.ensureServerReady(runtime.baseUrl, runtime.trafficAccessToken || undefined);
    return;
  } catch {
    // start server if not ready
  }

  const command = `nohup opencode serve --hostname ${e2bConfig.opencodeHost} --port ${e2bConfig.opencodePort} > /tmp/opencode-server.log 2>&1 &`;
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
) {
  const directory = input.workspacePath ? `?directory=${encodeURIComponent(input.workspacePath)}` : '';
  const url = `http://127.0.0.1:${e2bConfig.opencodePort}/session/${encodeURIComponent(
    input.opencodeSessionId
  )}/message${directory}`;
  const payload = JSON.stringify({ parts: input.parts || [] });
  const payloadB64 = Buffer.from(payload, 'utf-8').toString('base64');
  const logPath = `/tmp/opencode-prompt-${input.opencodeSessionId}.log`;
  const scriptPath = `/tmp/opencode-prompt-${input.opencodeSessionId}.py`;
  const command = `cat <<'PY' > ${scriptPath}
import base64, urllib.request, sys
payload = base64.b64decode('${payloadB64}').decode('utf-8')
url = '${url}'
req = urllib.request.Request(url, data=payload.encode('utf-8'), headers={'Content-Type':'application/json'})
try:
    urllib.request.urlopen(req, timeout=60).read()
except Exception as e:
    sys.stderr.write(str(e))
PY
nohup python3 ${scriptPath} > ${logPath} 2>&1 &`;
  await e2bConnector.runCommand(sessionId, command, { timeoutMs: 20000 });
}

export class OsacAgentService {
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

  async getSessionDiff(sessionId: string, opencodeSessionId: string) {
    const runtime = await resolveRuntime(sessionId);
    return opencodeHttpClient.getSessionDiff(
      runtime.baseUrl,
      { sessionId: opencodeSessionId },
      runtime.trafficAccessToken || undefined
    );
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
    return {
      status: response.status,
      headers: response.headers,
      body: response.body,
    };
  }

  async loadSkill(
    sessionId: string,
    _input?: { skillName: string; skillContent: string; overwrite?: boolean }
  ) {
    auditOsacAction('LOAD_SKILL', { sessionId });
    throw new Error('E2B 模式不支持 OSAC Skill 管理');
  }

  async unloadSkill(sessionId: string, _skillName?: string) {
    auditOsacAction('UNLOAD_SKILL', { sessionId });
    throw new Error('E2B 模式不支持 OSAC Skill 管理');
  }

  async addMcpServer(
    sessionId: string,
    _input?: { serverName: string; serverConfig: Record<string, unknown>; overwrite?: boolean }
  ) {
    auditOsacAction('ADD_MCP_SERVER', { sessionId });
    throw new Error('E2B 模式不支持 OSAC MCP 管理');
  }

  async removeMcpServer(sessionId: string, _serverName?: string) {
    auditOsacAction('REMOVE_MCP_SERVER', { sessionId });
    throw new Error('E2B 模式不支持 OSAC MCP 管理');
  }

  async initiateUpdate(
    sessionId: string,
    _input?: { updateType: string; version?: string; downloadUrl?: string; updateCommand?: string }
  ) {
    auditOsacAction('INITIATE_UPDATE', { sessionId });
    throw new Error('E2B 模式不支持 OSAC 自更新');
  }

  async ensureOpencodeServer(sessionId: string, input?: { host?: string; port?: number; workspacePath?: string }) {
    const runtime = await resolveRuntime(sessionId);
    await ensureOpencodeServer(sessionId, runtime);
    await opencodeEventStreamService.ensureStream({
      orchestratorSessionId: sessionId,
      baseUrl: runtime.baseUrl,
      workspaceRoot: runtime.workspaceRoot || input?.workspacePath,
      trafficAccessToken: runtime.trafficAccessToken || undefined,
    });
    osacConnectionManager.emitExternalMessage(
      sessionId,
      buildSyntheticMessage('OPENCODE_SERVER_READY', sessionId, {
        opencodeBaseUrl: runtime.baseUrl,
      })
    );
    return { opencodeBaseUrl: runtime.baseUrl };
  }

  async createOpencodeSession(sessionId: string, input?: { workspacePath?: string; title?: string }) {
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
    return { opencodeSessionId: result.id };
  }

  async sendOpencodePrompt(
    sessionId: string,
    input: { opencodeSessionId: string; parts: OpencodePartInput[]; workspacePath?: string }
  ) {
    const runtime = await resolveRuntime(sessionId);
    await ensureOpencodeServer(sessionId, runtime);
    try {
      await opencodeHttpClient.sendPrompt(
        runtime.baseUrl,
        {
          sessionId: input.opencodeSessionId,
          directory: input.workspacePath || runtime.workspaceRoot,
          parts: input.parts || [],
        },
        runtime.trafficAccessToken || undefined
      );
    } catch (error) {
      if (!isAbortError(error)) {
        throw error;
      }
      console.warn('[OPENCODE_PROMPT_TIMEOUT] fallback to sandbox dispatch:', error);
      await dispatchPromptInSandbox(sessionId, {
        opencodeSessionId: input.opencodeSessionId,
        parts: input.parts || [],
        workspacePath: input.workspacePath || runtime.workspaceRoot,
      });
    }
    osacConnectionManager.emitExternalMessage(
      sessionId,
      buildSyntheticMessage('OPENCODE_PROMPT_ACCEPTED', sessionId, {
        opencodeSessionId: input.opencodeSessionId,
      })
    );
    return { opencodeSessionId: input.opencodeSessionId };
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
