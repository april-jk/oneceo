import { ensureDatabaseConnection } from '../config/database';
import { e2bConfig } from '../config/e2b-config';
import {
  sandboxExecutionEnvironmentDAO,
  taskCreationSessionDAO,
  taskSessionConnectorBindingDAO,
} from '../db/dao';
import { e2bConnector } from '../connectors/e2b-connector';
import { opencodeHttpClient } from '../connectors/opencode-http-client';
import { sandboxEnvironmentService } from './sandbox-environment-service';
import { resolveOpencodeWorkspacePath } from '../utils/opencode-workspace';
import { taskCreationFileMemoryStore } from '../agents/task-creation/file-memory-store';
import { taskCreationCacheStore } from '../agents/task-creation/task-creation-cache-store';
import { restoreWorkspaceIfArchived } from './sandbox-archive-service';
import { touchSandbox } from './sandbox-activity-service';
import { osacAgentService } from './osac-agent-service';
import { ensureNekoDebug } from './sandbox-debug-service';
import {
  connectorRegistry,
  type ConnectorKey,
  type ConnectorRuntimeConfig,
} from './connector-registry';
import { userConnectorService } from './user-connector-service';
import { connectorStorageBootstrap } from './connector-storage-bootstrap';

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
  const display = (process.env.NEKO_DISPLAY || ':0').trim();
  if (display) {
    env.DISPLAY = display;
  }
  env.PLAYWRIGHT_HEADLESS = 'false';
  const browsersPath = (process.env.PLAYWRIGHT_BROWSERS_PATH || '').trim();
  if (browsersPath) {
    env.PLAYWRIGHT_BROWSERS_PATH = browsersPath;
  }
  env.XDG_RUNTIME_DIR = '/tmp';
  return env;
}

type OpencodeConfigPayload = {
  $schema: string;
  enabled_providers: string[];
  model: string;
  small_model: string;
  provider: Record<string, Record<string, unknown>>;
  mcp?: Record<string, unknown>;
};

type ResolvedConnectorBootstrap = {
  mcpEntries: Record<string, unknown>;
  processEnvs: Record<string, string>;
};

function connectorServerName(connectorKey: ConnectorKey, taskSessionId: string) {
  return `${connectorKey}--${taskSessionId}`;
}

function buildGithubProcessEnv(runtimeConfig: Extract<ConnectorRuntimeConfig, { type: 'local' }>) {
  const token = runtimeConfig.environment?.GITHUB_PERSONAL_ACCESS_TOKEN?.trim();
  if (!token) return {};
  return {
    GITHUB_PERSONAL_ACCESS_TOKEN: token,
    GH_TOKEN: token,
    GITHUB_TOKEN: token,
  };
}

async function resolveAttachedConnectorBootstrap(
  taskSessionId?: string
): Promise<ResolvedConnectorBootstrap> {
  if (!taskSessionId) {
    return {
      mcpEntries: {},
      processEnvs: {},
    };
  }

  await connectorStorageBootstrap.ensureReady();
  const session = await taskCreationSessionDAO.getSession(taskSessionId);
  const userId = pickString(session?.userId);
  if (!userId) {
    return {
      mcpEntries: {},
      processEnvs: {},
    };
  }

  const bindings = await taskSessionConnectorBindingDAO.listByTaskSessionId(taskSessionId);
  const attachedBindings = bindings.filter((binding) => binding.desiredState === 'attached');
  if (attachedBindings.length === 0) {
    return {
      mcpEntries: {},
      processEnvs: {},
    };
  }

  const mcpEntries: Record<string, unknown> = {};
  const processEnvs: Record<string, string> = {};

  for (const binding of attachedBindings) {
    const connectorKey = binding.connectorKey as ConnectorKey;
    const catalogItem = connectorRegistry.getCatalogItem(connectorKey);
    if (!catalogItem.available) continue;

    const account = await userConnectorService.getAccountMaterial(userId, connectorKey);
    if (!account || account.authStatus !== 'authorized') continue;

    try {
      const runtimeConfig = connectorRegistry.materializeRuntimeConfig({
        connectorKey,
        account,
      });
      const serverName = binding.serverName || connectorServerName(connectorKey, taskSessionId);
      mcpEntries[serverName] = runtimeConfig;
      if (connectorKey === 'github' && runtimeConfig.type === 'local') {
        Object.assign(processEnvs, buildGithubProcessEnv(runtimeConfig));
      }
    } catch (error) {
      console.warn('[OPENCODE_CONNECTOR_BOOTSTRAP_SKIP]', {
        taskSessionId,
        connectorKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { mcpEntries, processEnvs };
}

function buildOpencodeConfig(
  envs: Record<string, string>,
  extraMcpEntries: Record<string, unknown> = {}
): string {
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
    mcp: {
      playwright: {
        type: 'local',
        command: ['npx', '@playwright/mcp@latest', '--cdp-endpoint', 'http://127.0.0.1:9222'],
        enabled: true,
      },
      ...extraMcpEntries,
    },
  };

  return JSON.stringify(payload, null, 2);
}

async function writeOpencodeConfig(
  sessionId: string,
  envs: Record<string, string>,
  extraMcpEntries: Record<string, unknown> = {}
) {
  const config = buildOpencodeConfig(envs, extraMcpEntries);
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

function resolveOpencodeDataHome(workspaceRoot?: string | null): string | null {
  const normalized = pickString(workspaceRoot);
  if (!normalized) return null;
  return `${normalized.replace(/\/+$/, '')}/.opencode`;
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

async function ensurePlaywrightDeps(sessionId: string) {
  const command = `
set -euo pipefail
PLAYWRIGHT_BROWSERS_PATH="\${PLAYWRIGHT_BROWSERS_PATH:-/opt/ms-playwright}"

if [[ ! -d "$PLAYWRIGHT_BROWSERS_PATH" ]]; then
  echo "[playwright] browsers path missing: $PLAYWRIGHT_BROWSERS_PATH"
  exit 21
fi

if ! ls "$PLAYWRIGHT_BROWSERS_PATH"/chromium-* >/dev/null 2>&1; then
  echo "[playwright] chromium browser not installed in $PLAYWRIGHT_BROWSERS_PATH"
  exit 22
fi

CHROME_BIN=""
for candidate in "$PLAYWRIGHT_BROWSERS_PATH"/chromium-*/chrome-linux*/chrome; do
  if [[ -x "$candidate" ]]; then
    CHROME_BIN="$candidate"
    break
  fi
done

if [[ -z "$CHROME_BIN" ]]; then
  echo "[playwright] chromium executable missing"
  exit 23
fi
`;
  await e2bConnector.runCommand(sessionId, command, { timeoutMs: 20000 });
}

async function assertPlaywrightReady(sessionId: string) {
  const command = `
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

playwright --version >/dev/null 2>&1
`;
  await e2bConnector.runCommand(sessionId, command, { timeoutMs: 30000 });
}

async function assertOpencodeReady(sessionId: string) {
  const command = `
set -euo pipefail
command -v opencode >/dev/null 2>&1
opencode --version >/dev/null 2>&1 || true
`;
  await e2bConnector.runCommand(sessionId, command, { timeoutMs: 20000 });
}

async function waitForSandboxCommands(sessionId: string) {
  const maxAttempts = Math.max(5, Number(process.env.E2B_COMMANDS_READY_ATTEMPTS || 10));
  const delayMs = Math.max(500, Number(process.env.E2B_COMMANDS_READY_DELAY_MS || 1000));
  let lastError: unknown;
  for (let i = 0; i < maxAttempts; i += 1) {
    try {
      await e2bConnector.runCommand(sessionId, 'echo ready', { timeoutMs: 10000 });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`sandbox command channel not ready: ${message}`);
}

async function startOpencodeServer(
  sessionId: string,
  baseUrl: string,
  envs: Record<string, string>,
  workspaceRoot?: string | null,
  trafficAccessToken?: string | null
) {
  try {
    await opencodeHttpClient.ensureServerReady(baseUrl, trafficAccessToken || undefined);
    return;
  } catch {
    // proceed to start server
  }

  const inlineEnv = Object.entries({
    ...envs,
    ...(resolveOpencodeDataHome(workspaceRoot)
      ? { XDG_DATA_HOME: resolveOpencodeDataHome(workspaceRoot)! }
      : {}),
  })
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

async function stopOpencodeServer(sessionId: string) {
  const command = `pid=$(ps -ef | awk '/opencode serve --hostname ${e2bConfig.opencodeHost} --port ${e2bConfig.opencodePort}/ && !/awk/ {print $2; exit}')
if [ -n "$pid" ]; then
  kill "$pid" || true
fi`;
  try {
    await e2bConnector.runCommand(sessionId, command, { timeoutMs: 20_000 });
  } catch {
    // best effort
  }
}

async function restartOpencodeServer(
  sessionId: string,
  baseUrl: string,
  envs: Record<string, string>,
  workspaceRoot?: string | null,
  trafficAccessToken?: string | null
) {
  await stopOpencodeServer(sessionId);
  await new Promise((resolve) => setTimeout(resolve, 500));
  await startOpencodeServer(sessionId, baseUrl, envs, workspaceRoot, trafficAccessToken);
}

const provisionLocks = new Map<string, Promise<ProvisionResult>>();

export class SandboxAgentProvisionService {
  async syncOpencodeRuntimeConfig(input: { orchestratorSessionId: string; taskSessionId?: string }) {
    const sessionId = input.orchestratorSessionId;
    const info = await e2bConnector.getSandboxInfo(sessionId);
    const trafficAccessToken =
      (info as any)?.trafficAccessToken || (info as any)?.traffic_access_token || null;
    const host = await e2bConnector.getSandboxHost(sessionId, e2bConfig.opencodePort);
    const baseUrl = `https://${host}`;
    const baseEnvs = buildSandboxEnv();
    const connectorBootstrap = await resolveAttachedConnectorBootstrap(input.taskSessionId);
    const opencodeEnvs = {
      ...baseEnvs,
      ...connectorBootstrap.processEnvs,
    };
    await writeOpencodeConfig(sessionId, opencodeEnvs, connectorBootstrap.mcpEntries);
    await restartOpencodeServer(
      sessionId,
      baseUrl,
      opencodeEnvs,
      resolveOpencodeWorkspacePath(input.taskSessionId || ''),
      trafficAccessToken
    );
    return {
      baseUrl,
      trafficAccessToken,
    };
  }

  async provisionWithLock(input: ProvisionInput): Promise<ProvisionResult> {
    const taskSessionId = pickString(input.metadata?.taskSessionId);
    if (!taskSessionId) {
      return this.provision(input);
    }
    const existing = provisionLocks.get(taskSessionId);
    if (existing) {
      return existing;
    }
    const promise = this.provision(input)
      .finally(() => {
        provisionLocks.delete(taskSessionId);
      });
    provisionLocks.set(taskSessionId, promise);
    return promise;
  }

  async provision(input: ProvisionInput): Promise<ProvisionResult> {
    await ensureDatabaseConnection({ retries: 3, delayMs: 1000 });
    const runStep = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
      try {
        return await fn();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`[PROVISION:${name}] ${message}`);
      }
    };

    const envInput = buildSandboxEnv();
    const taskSessionId = pickString(input.metadata?.taskSessionId) || undefined;
    const reusable = taskSessionId ? await resolveReusableSandbox(taskSessionId) : null;

    const environment = reusable
      ? reusable.environment
      : await runStep('open_environment', () =>
          sandboxEnvironmentService.openEnvironment({
            metadata: input.metadata || {},
            envs: envInput,
          })
        );

    const sessionId = reusable?.sessionId || environment.sessionId;
    const isReused = Boolean(reusable);

    const info = await runStep('sandbox_info', () => e2bConnector.getSandboxInfo(sessionId));
    const trafficAccessToken =
      (info as any)?.trafficAccessToken || (info as any)?.traffic_access_token || null;

    const host = await runStep('sandbox_host', () => e2bConnector.getSandboxHost(sessionId, e2bConfig.opencodePort));
    const baseUrl = `https://${host}`;

    await runStep('commands_ready', () => waitForSandboxCommands(sessionId));
    await runStep('opencode_present', () => assertOpencodeReady(sessionId));
    await runStep('playwright_present', () => assertPlaywrightReady(sessionId));

    const workspaceRoot = await runStep('workspace_prepare', () => ensureWorkspace(sessionId, taskSessionId || undefined));

    await ensurePlaywrightDeps(sessionId);

    if (!isReused) {
      const restored = await restoreWorkspaceIfArchived(sessionId);
      if (restored && taskSessionId) {
        await taskCreationCacheStore.invalidateWorkspaceBySession(taskSessionId);
      }
    }

    const connectorBootstrap = await runStep('opencode_connector_config', () =>
      resolveAttachedConnectorBootstrap(taskSessionId)
    );
    const opencodeEnvs = {
      ...envInput,
      ...connectorBootstrap.processEnvs,
    };

    await runStep('opencode_config', () =>
      writeOpencodeConfig(sessionId, opencodeEnvs, connectorBootstrap.mcpEntries)
    );
    await runStep('opencode_start', () =>
      startOpencodeServer(sessionId, baseUrl, opencodeEnvs, workspaceRoot, trafficAccessToken)
    );
    await runStep('sandbox_verify', () => runSandboxVerify(sessionId));
    await runStep('playwright_mcp', () => osacAgentService.ensurePlaywrightMcp(sessionId));
    await runStep('neko_debug', () => ensureNekoDebug(sessionId));

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
        timeoutMs: e2bConfig.timeoutMs,
        trafficAccessToken: trafficAccessToken,
      },
    };
    await sandboxExecutionEnvironmentDAO.updateMetadata(sessionId, mergedMetadata);

    if (taskSessionId) {
      await taskCreationFileMemoryStore.updateRuntimeBinding(taskSessionId, {
        orchestratorSessionId: sessionId,
      });
    }

    await touchSandbox(sessionId, 'provisioned');

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
