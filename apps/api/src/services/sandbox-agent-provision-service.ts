import { ensureDatabaseConnection } from '../config/database';
import { e2bConfig } from '../config/e2b-config';
import { sandboxExecutionEnvironmentDAO } from '../db/dao';
import { e2bConnector } from '../connectors/e2b-connector';
import { opencodeHttpClient } from '../connectors/opencode-http-client';
import { sandboxEnvironmentService } from './sandbox-environment-service';
import { resolveOpencodeWorkspacePath } from '../utils/opencode-workspace';
import { taskCreationFileMemoryStore } from '../agents/task-creation/file-memory-store';

type ProvisionInput = {
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
  bind?: Record<string, unknown>;
  requestBaseUrl?: string;
};

type ProvisionResult = {
  sessionId: string;
  vmName: string | null;
  vmIpAddress: string | null;
  osacEndpoint: string | null;
  osacHost?: string | null;
  osacHostPort?: number | null;
  osacConnectionMode?: string | null;
  osacAuthToken?: string | null;
  status: string;
  sandboxStatus?: string;
  allocationSource: string;
  degradedFromWarmPool: boolean;
  readyGatePassed: boolean;
  bootstrap: {
    osacBinaryUrl: string;
    opencodeBinaryUrl: string;
    osacPort: number;
    osacPathSuffix: string;
  };
  opencodeBaseUrl?: string;
  opencodePort?: number;
  trafficAccessToken?: string | null;
};

function pickString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
}

async function resolveReusableSandbox(taskSessionId: string) {
  const session = await taskCreationFileMemoryStore.getSession(taskSessionId);
  const orchestratorSessionId = pickString(session?.runtime?.orchestratorSessionId);
  if (!orchestratorSessionId) return null;

  const environment = await sandboxExecutionEnvironmentDAO.getBySessionId(orchestratorSessionId);
  if (!environment || environment.status !== 'ready') return null;

  const metadata = (environment.metadata || {}) as Record<string, unknown>;
  const boundTaskSessionId = pickString(metadata.taskSessionId);
  if (boundTaskSessionId && boundTaskSessionId !== taskSessionId) {
    return null;
  }

  return {
    sessionId: orchestratorSessionId,
    environment,
  };
}

function buildSandboxEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  const passthrough = [
    'OPENAI_API_KEY',
    'OPENAI_BASE_URL',
    'OPENAI_API_BASE',
    'ANTHROPIC_API_KEY',
    'GEMINI_API_KEY',
    'OPENCODE_API_KEY',
    'OPENCODE_BASE_URL',
    'OPENCODE_MODEL',
    'OPENCODE_SERVER_PASSWORD',
  ];
  for (const key of passthrough) {
    const value = process.env[key];
    if (value && value.trim()) {
      env[key] = value.trim();
    }
  }
  const providerRaw = (process.env.OPENCODE_PROVIDER_ID || '').trim();
  if (providerRaw) {
    env.OPENCODE_PROVIDER_ID = providerRaw.toLowerCase();
  }
  return env;
}

type OpencodeConfigPayload = {
  $schema: string;
  enabled_providers: string[];
  model: string;
  small_model: string;
  provider: Record<string, Record<string, unknown>>;
};

function buildOpencodeConfig(envs: Record<string, string>): string {
  const providerIdRaw = (envs.OPENCODE_PROVIDER_ID || 'openai').trim();
  const providerId = providerIdRaw.toLowerCase() || 'openai';
  const modelId = (envs.OPENCODE_MODEL || 'claude-haiku-4-5-20251001').trim();
  const baseUrlEnv =
    (envs.OPENAI_BASE_URL && 'OPENAI_BASE_URL') ||
    (envs.OPENCODE_BASE_URL && 'OPENCODE_BASE_URL') ||
    (envs.OPENAI_API_BASE && 'OPENAI_API_BASE') ||
    'OPENAI_BASE_URL';
  const apiKeyEnv =
    (envs.OPENAI_API_KEY && 'OPENAI_API_KEY') || (envs.OPENCODE_API_KEY && 'OPENCODE_API_KEY') || 'OPENAI_API_KEY';

  const providerBase: Record<string, unknown> = {
    options: {
      baseURL: `{env:${baseUrlEnv}}`,
      apiKey: `{env:${apiKeyEnv}}`,
    },
    models: {
      [modelId]: {
        name: modelId,
      },
    },
  };

  if (providerId !== 'openai') {
    providerBase.npm = '@ai-sdk/openai-compatible';
    providerBase.name = providerId;
  }

  const payload: OpencodeConfigPayload = {
    $schema: 'https://opencode.ai/config.json',
    enabled_providers: [providerId],
    model: `${providerId}/${modelId}`,
    small_model: `${providerId}/${modelId}`,
    provider: {
      [providerId]: providerBase,
    },
  };

  return JSON.stringify(payload, null, 2);
}

async function writeOpencodeConfig(sessionId: string, envs: Record<string, string>) {
  const config = buildOpencodeConfig(envs);
  const configDir = '$HOME/.config/opencode';
  const configPath = `${configDir}/opencode.json`;
  const command = `mkdir -p ${configDir}
cat <<'EOF' > ${configPath}
${config}
EOF`;
  await e2bConnector.runCommand(sessionId, command, { timeoutMs: 30_000 });
}

async function ensureWorkspace(sessionId: string, taskSessionId?: string) {
  if (!taskSessionId) return null;
  const workspaceRoot = resolveOpencodeWorkspacePath(taskSessionId);
  if (!workspaceRoot) return null;
  const command = `mkdir -p ${shellEscape(workspaceRoot)}`;
  await e2bConnector.runCommand(sessionId, command, { timeoutMs: 30_000 });
  return workspaceRoot;
}

function shellEscape(value: string): string {
  if (!value) return "''";
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function buildSandboxVerifyScript(): string {
  const lines = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    '',
    'echo "[verify] timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)"',
    '',
    'if [[ -z "${OPENAI_BASE_URL:-}" ]]; then',
    '  echo "[verify] OPENAI_BASE_URL missing"',
    '  exit 10',
    'fi',
    'if [[ -z "${OPENAI_API_KEY:-}" ]]; then',
    '  echo "[verify] OPENAI_API_KEY missing"',
    '  exit 11',
    'fi',
    '',
    'echo "[verify] OPENAI_BASE_URL=$OPENAI_BASE_URL"',
    '',
    'ip=""',
    'for url in https://api.ipify.org https://icanhazip.com https://ifconfig.me/ip; do',
    '  ip=$(curl -fsSL --max-time 10 "$url" | tr -d "\\n" || true)',
    '  if [[ -n "$ip" ]]; then break; fi',
    'done',
    'if [[ -z "$ip" ]]; then',
    '  echo "[verify] public_ip lookup failed"',
    '  exit 12',
    'fi',
    'echo "[verify] public_ip=$ip"',
    '',
    'gateway_url="${OPENAI_BASE_URL%/}/models"',
    'status=$(curl -sS -o /tmp/oneceo_gateway_models.json -w "%{http_code}" \\',
    '  -H "Authorization: Bearer ${OPENAI_API_KEY}" \\',
    '  -H "Content-Type: application/json" \\',
    '  "$gateway_url" || true)',
    'echo "[verify] gateway_status=$status"',
    'if [[ "$status" -lt 200 || "$status" -ge 300 ]]; then',
    '  echo "[verify] gateway models request failed"',
    '  cat /tmp/oneceo_gateway_models.json || true',
    '  exit 13',
    'fi',
    'echo "[verify] gateway_ok"',
    '',
    'model="${OPENCODE_MODEL:-claude-haiku-4-5-20251001}"',
    'chat_url="${OPENAI_BASE_URL%/}/chat/completions"',
    'payload=$(printf \'{"model":"%s","messages":[{"role":"user","content":"ping"}],"max_tokens":8}\' "$model")',
    'chat_status=$(curl -sS -o /tmp/oneceo_gateway_chat.json -w "%{http_code}" \\',
    '  -H "Authorization: Bearer ${OPENAI_API_KEY}" \\',
    '  -H "Content-Type: application/json" \\',
    '  -d "$payload" \\',
    '  "$chat_url" || true)',
    'echo "[verify] gateway_chat_status=$chat_status"',
    'if [[ "$chat_status" -lt 200 || "$chat_status" -ge 300 ]]; then',
    '  echo "[verify] gateway chat request failed"',
    '  cat /tmp/oneceo_gateway_chat.json || true',
    '  exit 15',
    'fi',
    'echo "[verify] gateway_chat_ok"',
    '',
    'if curl -fsSL --max-time 5 "http://127.0.0.1:${OPENCODE_SERVER_PORT:-4096}/global/health" >/dev/null; then',
    '  echo "[verify] opencode_health_ok"',
    'else',
    '  echo "[verify] opencode_health_failed"',
    '  exit 14',
    'fi',
    '',
    'if [[ -f "$HOME/.config/opencode/opencode.json" ]]; then',
    '  echo "[verify] opencode_config=present"',
    'else',
    '  echo "[verify] opencode_config=missing"',
    '  exit 16',
    'fi',
    '',
  ];
  return lines.join('\n');
}

function isSandboxVerifyEnabled(): boolean {
  const raw = String(process.env.E2B_SANDBOX_VERIFY_ENABLED || 'true').trim().toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(raw);
}

async function runSandboxVerify(sessionId: string) {
  if (!isSandboxVerifyEnabled()) return;
  const script = buildSandboxVerifyScript();
  const remotePath = '/tmp/oneceo_sandbox_verify.sh';
  const logPath = '/tmp/oneceo_sandbox_verify.log';
  const timeoutMs = Math.max(15000, Number(process.env.E2B_SANDBOX_VERIFY_TIMEOUT_MS || 90000));
  const command = `cat <<'EOF' > ${remotePath}
${script}
EOF
chmod +x ${remotePath}
${remotePath} > ${logPath} 2>&1`;
  await e2bConnector.runCommand(sessionId, command, { timeoutMs });
}

async function startOpencodeServer(
  sessionId: string,
  baseUrl: string,
  envs: Record<string, string>,
  trafficAccessToken?: string | null
) {
  try {
    await opencodeHttpClient.ensureServerReady(baseUrl, trafficAccessToken || undefined);
    return;
  } catch {
    // proceed to start server
  }

  const inlineEnv = Object.entries(envs)
    .map(([key, value]) => `${key}=${shellEscape(value)}`)
    .join(' ');
  const command = `${inlineEnv} opencode serve --hostname ${e2bConfig.opencodeHost} --port ${e2bConfig.opencodePort} > /tmp/opencode-server.log 2>&1`;
  await e2bConnector.runCommand(sessionId, command, { timeoutMs: 30000, background: true });

  const maxAttempts = Math.max(5, Number(process.env.OPENCODE_SERVER_START_ATTEMPTS || 20));
  const delayMs = Math.max(200, Number(process.env.OPENCODE_SERVER_START_DELAY_MS || 500));
  let lastError: unknown = null;
  for (let i = 0; i < maxAttempts; i += 1) {
    try {
      await opencodeHttpClient.ensureServerReady(baseUrl, trafficAccessToken || undefined);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`opencode serve 启动失败: ${message}`);
}

export class SandboxAgentProvisionService {
  async provision(input: ProvisionInput): Promise<ProvisionResult> {
    await ensureDatabaseConnection({ retries: 3, delayMs: 1000 });

    const envInput = buildSandboxEnv();
    const taskSessionId = pickString(input.metadata?.taskSessionId) || undefined;
    const reusable = taskSessionId ? await resolveReusableSandbox(taskSessionId) : null;

    const environment = reusable
      ? reusable.environment
      : await sandboxEnvironmentService.openEnvironment({
          metadata: input.metadata || {},
          envs: envInput,
        });

    const sessionId = reusable?.sessionId || environment.sessionId;

    const info = await e2bConnector.getSandboxInfo(sessionId);
    const trafficAccessToken =
      (info as any)?.trafficAccessToken || (info as any)?.traffic_access_token || null;

    const host = await e2bConnector.getSandboxHost(sessionId, e2bConfig.opencodePort);
    const baseUrl = `https://${host}`;

    const workspaceRoot = await ensureWorkspace(sessionId, taskSessionId || undefined);

    await writeOpencodeConfig(sessionId, envInput);
    await startOpencodeServer(sessionId, baseUrl, envInput, trafficAccessToken);
    await runSandboxVerify(sessionId);

    const existing = await sandboxExecutionEnvironmentDAO.getBySessionId(sessionId);
    const mergedMetadata: Record<string, unknown> = {
      ...(existing?.metadata || {}),
      ...(input.metadata || {}),
      sandboxProvider: 'e2b',
      opencodeBaseUrl: baseUrl,
      opencodePort: e2bConfig.opencodePort,
      opencodeHost: host,
      opencodeWorkspaceRoot: workspaceRoot || undefined,
      e2b: {
        ...(existing?.metadata as any)?.e2b,
        sandboxId: sessionId,
        template: e2bConfig.template,
        trafficAccessToken: trafficAccessToken,
      },
    };
    await sandboxExecutionEnvironmentDAO.updateMetadata(sessionId, mergedMetadata);

    if (taskSessionId) {
      await taskCreationFileMemoryStore.updateRuntimeBinding(taskSessionId, {
        orchestratorSessionId: sessionId,
      });
    }

    return {
      sessionId,
      vmName: null,
      vmIpAddress: null,
      osacEndpoint: baseUrl,
      osacHost: host,
      osacHostPort: e2bConfig.opencodePort,
      osacConnectionMode: 'e2b-opencode',
      osacAuthToken: null,
      status: 'ready',
      sandboxStatus: 'ready',
      allocationSource: reusable ? 'reused_session' : 'cold_start',
      degradedFromWarmPool: false,
      readyGatePassed: true,
      bootstrap: {
        osacBinaryUrl: '',
        opencodeBinaryUrl: '',
        osacPort: 0,
        osacPathSuffix: '',
      },
      opencodeBaseUrl: baseUrl,
      opencodePort: e2bConfig.opencodePort,
      trafficAccessToken,
    };
  }
}

export const sandboxAgentProvisionService = new SandboxAgentProvisionService();
