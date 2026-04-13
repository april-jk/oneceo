import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ensureDatabaseConnection } from '../config/database';
import { e2bConfig } from '../config/e2b-config';
import { osacBootstrapConfig } from '../config/osac-bootstrap-config';
import {
  sandboxExecutionEnvironmentDAO,
  taskCreationSessionDAO,
  taskSessionConnectorBindingDAO,
} from '../db/dao';
import { e2bConnector } from '../connectors/e2b-connector';
import { opencodeHttpClient } from '../connectors/opencode-http-client';
import { sandboxEnvironmentService } from './sandbox-environment-service';
import {
  resolveCodexArchiveDotCodexPath,
  resolveCodexArchiveHomePath,
  resolveLegacyOpencodeStatePath,
  resolveOpencodeStatePath,
  resolveOpencodeWorkspacePath,
} from '../utils/opencode-workspace';
import { taskCreationFileMemoryStore } from '../agents/task-creation/file-memory-store';
import { taskCreationCacheStore } from '../agents/task-creation/task-creation-cache-store';
import { taskSessionRedisCacheService } from './task-session-redis-cache-service';
import { archiveSandboxWorkspace, restoreWorkspaceIfArchived } from './sandbox-archive-service';
import { touchSandbox } from './sandbox-activity-service';
import { osacAgentService } from './osac-agent-service';
import { ensureNekoDebug } from './sandbox-debug-service';
import { codexRuntimeConfigService } from './codex-runtime-config-service';
import { codexAppServerService } from './codex-app-server-service';
import {
  DEFAULT_CODEX_API_KEY,
  DEFAULT_CODEX_MODEL,
  DEFAULT_SANDBOX_OPENAI_BASE_URL,
} from '../utils/codex-runtime-config';
import {
  connectorRegistry,
  type ConnectorKey,
  type ConnectorRuntimeConfig,
} from './connector-registry';
import { userConnectorService } from './user-connector-service';
import { connectorStorageBootstrap } from './connector-storage-bootstrap';
import {
  canReuseOsacBridge,
  ensureOsacBridge,
  waitForOsacBridgeReady,
} from './sandbox-osac-bridge-service';
import { writeConnectorDebugLog } from '../utils/connector-debug-log';

type ProvisionInput = {
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
  bind?: Record<string, unknown>;
  requestBaseUrl?: string;
  executor?: 'opencode' | 'codex' | 'claudecode' | string;
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

type ProvisionExecutor = 'opencode' | 'codex' | 'claudecode' | 'altus';
type ProvisionCodexMode = 'sdk' | 'ws';

function pickString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
}

function normalizeProvisionExecutor(value: unknown): ProvisionExecutor {
  const normalized = pickString(value)?.toLowerCase();
  if (normalized === 'altus') return 'altus';
  if (normalized === 'codex') return 'codex';
  if (normalized === 'claudecode') return 'claudecode';
  return 'opencode';
}

function normalizeProvisionCodexMode(value: unknown): ProvisionCodexMode | null {
  const normalized = pickString(value)?.toLowerCase();
  if (normalized === 'sdk') return 'sdk';
  if (normalized === 'ws') return 'ws';
  return null;
}

async function resolveProvisionCodexMode(
  taskSessionId: string | undefined,
  metadata: Record<string, unknown> | undefined
): Promise<ProvisionCodexMode | null> {
  const requestedMode =
    normalizeProvisionCodexMode(metadata?.codexExecutionMode) ||
    normalizeProvisionCodexMode(metadata?.codexMode) ||
    normalizeProvisionCodexMode(metadata?.transport === 'app_server' ? 'ws' : metadata?.transport);
  if (requestedMode) return requestedMode;
  if (!taskSessionId) return null;
  const session = await taskCreationFileMemoryStore.getSession(taskSessionId);
  return (
    normalizeProvisionCodexMode(session?.codexExecutionMode) ||
    normalizeProvisionCodexMode(session?.runtime?.transport === 'app_server' ? 'ws' : session?.runtime?.transport) ||
    null
  );
}

function resolveProvisionTemplate(
  executor: ProvisionExecutor,
  codexExecutionMode: ProvisionCodexMode | null
): string {
  if (executor === 'codex') {
    return codexExecutionMode === 'ws' ? e2bConfig.codexWsTemplate : e2bConfig.codexTemplate;
  }
  return e2bConfig.template;
}

async function resolveReusableSandbox(
  taskSessionId: string,
  executor: ProvisionExecutor,
  codexExecutionMode: ProvisionCodexMode | null,
  selectedTemplate: string
) {
  const session = await taskCreationFileMemoryStore.getSession(taskSessionId);
  const orchestratorSessionId = pickString(session?.runtime?.orchestratorSessionId);
  if (!orchestratorSessionId) {
    return {
      reusable: null,
      templateMismatchSandboxId: null,
    };
  }

  const sessionExecutor = normalizeProvisionExecutor(
    session?.runtime?.executor || session?.executor || session?.driver
  );
  if (sessionExecutor !== executor) {
    return {
      reusable: null,
      templateMismatchSandboxId: null,
    };
  }

  const environment = await sandboxExecutionEnvironmentDAO.getBySessionId(orchestratorSessionId);
  if (!environment || environment.status !== 'ready') {
    return {
      reusable: null,
      templateMismatchSandboxId: null,
    };
  }

  const metadata = (environment.metadata || {}) as Record<string, unknown>;
  const replacedBySandboxId = pickString(metadata.dedupeReplacementSandboxId);
  if (replacedBySandboxId) {
    return {
      reusable: null,
      templateMismatchSandboxId: null,
    };
  }
  const boundTaskSessionId = pickString(metadata.taskSessionId);
  if (boundTaskSessionId && boundTaskSessionId !== taskSessionId) {
    return {
      reusable: null,
      templateMismatchSandboxId: null,
    };
  }
  const sandboxExecutor = normalizeProvisionExecutor(
    metadata.sandboxExecutor || metadata.executor || session?.runtime?.executor || session?.executor || session?.driver
  );
  if (sandboxExecutor !== executor) {
    return {
      reusable: null,
      templateMismatchSandboxId: null,
    };
  }
  const environmentTemplate = pickString((metadata.e2b as Record<string, unknown> | undefined)?.template);
  // Reuse is allowed only when the running sandbox template exactly matches current selection.
  if (!environmentTemplate || environmentTemplate !== selectedTemplate) {
    return {
      reusable: null,
      templateMismatchSandboxId: orchestratorSessionId,
    };
  }
  if (executor === 'codex') {
    const environmentCodexMode =
      normalizeProvisionCodexMode(metadata.codexExecutionMode) ||
      normalizeProvisionCodexMode(metadata.codexMode) ||
      normalizeProvisionCodexMode(
        pickString((metadata.e2b as Record<string, unknown> | undefined)?.template) === e2bConfig.codexWsTemplate
          ? 'ws'
          : 'sdk'
      );
    if ((codexExecutionMode || environmentCodexMode) && codexExecutionMode !== environmentCodexMode) {
      return {
        reusable: null,
        templateMismatchSandboxId: null,
      };
    }
  }

  return {
    reusable: {
      sessionId: orchestratorSessionId,
      environment,
    },
    templateMismatchSandboxId: null,
  };
}

function isSandboxUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return (
    normalized.includes('sandbox was not found') ||
    normalized.includes('sandbox not found') ||
    normalized.includes('not running anymore') ||
    normalized.includes('sandbox command channel not ready') ||
    normalized.includes('command channel not ready') ||
    normalized.includes('guest has been shut down') ||
    normalized.includes('instance was stopped') ||
    normalized.includes('failed to connect to sandbox')
  );
}

async function markSandboxClosedBestEffort(sessionId: string, reason: string) {
  try {
    await sandboxExecutionEnvironmentDAO.updateMetadata(sessionId, {
      provisionRecoveryReason: reason,
      provisionRecoveryAt: new Date().toISOString(),
    });
  } catch {
    // ignore metadata sync failures during recovery
  }
  try {
    await sandboxExecutionEnvironmentDAO.updateStatus(sessionId, 'closed', null);
  } catch {
    // ignore missing rows during recovery
  }
}

function buildSandboxEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  const passthrough = [
    'OPENAI_API_KEY',
    'CODEX_API_KEY',
    'OPENAI_BASE_URL',
    'OPENAI_API_BASE',
    'LLM_PROXY_UPSTREAM_API_TYPE',
    'OPENAI_MODEL',
    'CODEX_BASE_URL',
    'CODEX_MODEL',
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
  const sandboxApiKey = pickString(process.env.SANDBOX_OPENAI_API_KEY);
  const sandboxBaseUrl =
    pickString(process.env.SANDBOX_OPENAI_BASE_URL) || pickString(process.env.SANDBOX_OPENAI_API_BASE);
  const sandboxModel = pickString(process.env.SANDBOX_OPENAI_MODEL);
  const sandboxApiType = pickString(process.env.SANDBOX_OPENAI_API_TYPE)?.toLowerCase() || null;
  const sandboxOverrideEnabled = Boolean(sandboxApiKey || sandboxBaseUrl || sandboxModel || sandboxApiType);

  if (sandboxApiKey) {
    env.OPENAI_API_KEY = sandboxApiKey;
    env.CODEX_API_KEY = sandboxApiKey;
    env.OPENCODE_API_KEY = sandboxApiKey;
  }
  if (sandboxBaseUrl) {
    env.OPENAI_BASE_URL = sandboxBaseUrl;
    env.OPENAI_API_BASE = sandboxBaseUrl;
    env.CODEX_BASE_URL = sandboxBaseUrl;
    env.OPENCODE_BASE_URL = sandboxBaseUrl;
  }
  if (sandboxModel) {
    env.OPENAI_MODEL = sandboxModel;
    env.CODEX_MODEL = sandboxModel;
    env.OPENCODE_MODEL = sandboxModel;
  }
  if (sandboxApiType) {
    env.LLM_PROXY_UPSTREAM_API_TYPE = sandboxApiType;
  }
  if (sandboxOverrideEnabled) {
    env.OPENCODE_PROVIDER_ID = 'openai';
  }
  if (!env.CODEX_API_KEY && env.OPENAI_API_KEY) {
    env.CODEX_API_KEY = env.OPENAI_API_KEY;
  }
  if (!env.OPENAI_API_KEY && env.CODEX_API_KEY) {
    env.OPENAI_API_KEY = env.CODEX_API_KEY;
  }
  if (!env.OPENAI_BASE_URL) {
    if (env.CODEX_BASE_URL) {
      env.OPENAI_BASE_URL = env.CODEX_BASE_URL;
    } else if (env.OPENCODE_BASE_URL) {
      env.OPENAI_BASE_URL = env.OPENCODE_BASE_URL;
    } else if (env.OPENAI_API_BASE) {
      env.OPENAI_BASE_URL = env.OPENAI_API_BASE;
    }
  }
  if (!env.OPENAI_API_KEY) {
    env.OPENAI_API_KEY = DEFAULT_CODEX_API_KEY;
  }
  if (!env.OPENAI_BASE_URL) {
    env.OPENAI_BASE_URL = DEFAULT_SANDBOX_OPENAI_BASE_URL;
  }
  if (!env.OPENAI_API_BASE && env.OPENAI_BASE_URL) {
    env.OPENAI_API_BASE = env.OPENAI_BASE_URL;
  }
  if (!env.CODEX_BASE_URL) {
    const mirroredBase = env.OPENAI_BASE_URL || env.OPENAI_API_BASE || env.OPENCODE_BASE_URL || '';
    if (mirroredBase) {
      env.CODEX_BASE_URL = mirroredBase;
    }
  }
  if (!env.OPENCODE_BASE_URL) {
    env.OPENCODE_BASE_URL = env.OPENAI_BASE_URL || DEFAULT_SANDBOX_OPENAI_BASE_URL;
  }
  if (!env.OPENAI_MODEL) {
    const mirroredModel =
      env.CODEX_MODEL || env.OPENCODE_MODEL || (process.env.AGENT_OPENAI_MODEL || '').trim() || DEFAULT_CODEX_MODEL;
    if (mirroredModel) {
      env.OPENAI_MODEL = mirroredModel;
    }
  }
  if (!env.CODEX_MODEL) {
    const mirroredModel =
      env.OPENAI_MODEL || env.OPENCODE_MODEL || (process.env.AGENT_OPENAI_MODEL || '').trim() || DEFAULT_CODEX_MODEL;
    if (mirroredModel) {
      env.CODEX_MODEL = mirroredModel;
    }
  }
  if (!env.OPENCODE_MODEL) {
    env.OPENCODE_MODEL = env.OPENAI_MODEL || DEFAULT_CODEX_MODEL;
  }
  if (env.CODEX_BASE_URL && !env.OPENAI_BASE_URL) {
    env.OPENAI_BASE_URL = env.CODEX_BASE_URL;
  }
  const providerRaw = (process.env.OPENCODE_PROVIDER_ID || 'openai').trim();
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

async function resolveE2bPublicHost(sessionId: string, port: number): Promise<string> {
  const attempts = Math.max(3, Number(process.env.E2B_PUBLIC_HOST_ATTEMPTS || 12));
  const delayMs = Math.max(250, Number(process.env.E2B_PUBLIC_HOST_DELAY_MS || 1000));
  let lastError: unknown = null;
  for (let index = 0; index < attempts; index += 1) {
    try {
      return await e2bConnector.getSandboxHost(sessionId, port);
    } catch (error) {
      lastError = error;
      if (index + 1 < attempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError || 'sandbox host unavailable'));
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

    const profileId = pickString(binding.profileId);
    if (!profileId) continue;
    const account = await userConnectorService.getProfileMaterial(userId, profileId);
    if (!account || account.authStatus !== 'authorized') continue;

    try {
      const runtimeConfig = connectorRegistry.materializeRuntimeConfig({
        connectorKey,
        account,
        sessionConfig:
          binding.sessionConfigJson &&
          typeof binding.sessionConfigJson === 'object' &&
          !Array.isArray(binding.sessionConfigJson)
            ? (binding.sessionConfigJson as Record<string, unknown>)
            : null,
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
  const modelId = (envs.OPENCODE_MODEL || DEFAULT_CODEX_MODEL).trim();
  const baseUrlEnv =
    (envs.OPENAI_BASE_URL && 'OPENAI_BASE_URL') ||
    (envs.OPENCODE_BASE_URL && 'OPENCODE_BASE_URL') ||
    (envs.OPENAI_API_BASE && 'OPENAI_API_BASE') ||
    'OPENAI_BASE_URL';
  const apiKeyEnv =
    (envs.OPENAI_API_KEY && 'OPENAI_API_KEY') || (envs.OPENCODE_API_KEY && 'OPENCODE_API_KEY') || 'OPENAI_API_KEY';

  const resolvedBaseUrl = (envs[baseUrlEnv] || '').trim();
  const resolvedApiKey = (envs[apiKeyEnv] || '').trim();

  const providerBase: Record<string, unknown> = {
    options: {
      baseURL: resolvedBaseUrl || `{env:${baseUrlEnv}}`,
      apiKey: resolvedApiKey || `{env:${apiKeyEnv}}`,
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
  const commandLines = [
    `mkdir -p ${configDir}`,
    `rm -f ${configDir}/opencode.jsonc`,
    `cat <<'EOF' > ${configPath}`,
    config,
    'EOF',
  ];
  const command = `${commandLines.join('\n')}
`;
  await e2bConnector.runCommand(sessionId, command, { timeoutMs: 30_000 });
}

async function ensureWorkspaceLayout(sessionId: string, taskSessionId?: string) {
  if (!taskSessionId) return null;
  const workspaceRoot = resolveOpencodeWorkspacePath(taskSessionId);
  const stateRoot = resolveOpencodeStatePath(taskSessionId);
  if (!workspaceRoot || !stateRoot) return null;
  const command = `mkdir -p ${shellEscape(workspaceRoot)} ${shellEscape(stateRoot)}`;
  const maxAttempts = Math.max(3, Number(process.env.E2B_WORKSPACE_PREPARE_ATTEMPTS || 5));
  const delayMs = Math.max(500, Number(process.env.E2B_WORKSPACE_PREPARE_DELAY_MS || 1500));
  let lastError: unknown = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await e2bConnector.runCommand(sessionId, command, { timeoutMs: 30_000 });
      return { workspaceRoot, stateRoot };
    } catch (error) {
      lastError = error;
      if (attempt + 1 >= maxAttempts) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  if (lastError) {
    throw lastError;
  }
  return { workspaceRoot, stateRoot };
}

function resolveCodexArchivePaths(taskSessionId?: string | null, stateRoot?: string | null): {
  codexArchiveHome: string | null;
  codexDotCodexPath: string | null;
} {
  const safeTaskSessionId = pickString(taskSessionId);
  if (safeTaskSessionId) {
    return {
      codexArchiveHome: resolveCodexArchiveHomePath(safeTaskSessionId),
      codexDotCodexPath: resolveCodexArchiveDotCodexPath(safeTaskSessionId),
    };
  }
  const normalizedStateRoot = pickString(stateRoot);
  if (!normalizedStateRoot) {
    return {
      codexArchiveHome: null,
      codexDotCodexPath: null,
    };
  }
  const base = normalizedStateRoot.replace(/\/+$/, '');
  return {
    codexArchiveHome: `${base}/codex-home`,
    codexDotCodexPath: `${base}/codex-home/.codex`,
  };
}

async function ensureCodexHomeMapping(
  sessionId: string,
  input: {
    taskSessionId?: string | null;
    stateRoot?: string | null;
  }
): Promise<{ codexArchiveHome: string; codexDotCodexPath: string }> {
  const { codexArchiveHome, codexDotCodexPath } = resolveCodexArchivePaths(
    input.taskSessionId,
    input.stateRoot
  );
  if (!codexArchiveHome || !codexDotCodexPath) {
    throw new Error('missing codex archive home');
  }

  const command = `
set -euo pipefail
archive_home=${shellEscape(codexArchiveHome)}
archive_codex=${shellEscape(codexDotCodexPath)}
runtime_codex='/home/user/.codex'

mkdir -p "$archive_home" "$archive_codex"
mkdir -p "$archive_codex/sessions" "$archive_codex/tmp" "$archive_codex/shell_snapshots"

if [ -L "$runtime_codex" ]; then
  current_target="$(readlink "$runtime_codex" || true)"
  if [ "$current_target" = "$archive_codex" ]; then
    exit 0
  fi
fi

if [ -d "$runtime_codex" ] && [ ! -L "$runtime_codex" ]; then
  cp -a "$runtime_codex"/. "$archive_codex"/ || true
  rm -rf "$runtime_codex"
fi

ln -sfn "$archive_codex" "$runtime_codex"
`;
  const probeCommand = `
set -euo pipefail
archive_codex=${shellEscape(codexDotCodexPath)}
runtime_codex='/home/user/.codex'

if [ ! -e "$archive_codex" ]; then
  exit 0
fi
if [ -L "$runtime_codex" ]; then
  current_target="$(readlink "$runtime_codex" || true)"
  if [ "$current_target" = "$archive_codex" ]; then
    printf 'READY:%s' "$current_target"
    exit 0
  fi
fi
exit 0
`;
  const attempts = Math.max(2, Number(process.env.CODEX_HOME_MAPPING_ATTEMPTS || 3));
  const delayMs = Math.max(500, Number(process.env.CODEX_HOME_MAPPING_DELAY_MS || 1200));
  let lastError: unknown = null;
  const extractCommandOutput = (value: unknown): string => {
    if (value && typeof value === 'object') {
      const result = (value as any).result;
      const output =
        String(result?.stdout || result?.output || (value as any).stdout || (value as any).output || '').trim();
      if (output) return output;
    }
    return '';
  };
  const runProbe = async (): Promise<boolean> => {
    try {
      const probe: any = await e2bConnector.runCommand(sessionId, probeCommand, { timeoutMs: 10_000 });
      const output = String(probe?.stdout || probe?.output || '').trim();
      return output.startsWith('READY:');
    } catch (probeError) {
      lastError = lastError || probeError;
      const output = extractCommandOutput(probeError);
      return output.startsWith('READY:');
    }
  };

  if (await runProbe()) {
    return {
      codexArchiveHome,
      codexDotCodexPath,
    };
  }

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await e2bConnector.runCommand(sessionId, command, { timeoutMs: 30_000 });
    } catch (error) {
      lastError = error;
    }

    if (await runProbe()) {
      return {
        codexArchiveHome,
        codexDotCodexPath,
      };
    }

    if (attempt + 1 < attempts) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  const lastResult = lastError && typeof lastError === 'object' ? (lastError as any).result : null;
  const detail = [
    lastError instanceof Error ? lastError.message : String(lastError || 'codex home mapping failed'),
    lastResult?.stdout ? `stdout=${String(lastResult.stdout).trim()}` : '',
    lastResult?.stderr ? `stderr=${String(lastResult.stderr).trim()}` : '',
  ]
    .filter(Boolean)
    .join(' | ');
  throw new Error(detail || 'codex home mapping failed');
}

function shellEscape(value: string): string {
  if (!value) return "''";
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function resolveOpencodeDataHome(stateRoot?: string | null): string | null {
  return pickString(stateRoot);
}

async function migrateLegacyWorkspaceState(
  sessionId: string,
  workspaceRoot?: string | null,
  stateRoot?: string | null
) {
  const normalizedWorkspace = pickString(workspaceRoot);
  const normalizedState = pickString(stateRoot);
  const legacyRoot = resolveLegacyOpencodeStatePath(normalizedWorkspace);
  if (!normalizedWorkspace || !normalizedState || !legacyRoot) {
    return;
  }

  const command = `
set -euo pipefail
legacy_root=${shellEscape(legacyRoot)}
state_root=${shellEscape(normalizedState)}
mkdir -p "$(dirname "$state_root")"

if [[ -d "$legacy_root" ]]; then
  if [[ -z "$(find "$state_root" -mindepth 1 -print -quit 2>/dev/null)" ]]; then
    rm -rf "$state_root"
    mv "$legacy_root" "$state_root"
  else
    rm -rf "$legacy_root"
  fi
fi

mkdir -p "$state_root"
`;
  await e2bConnector.runCommand(sessionId, command, { timeoutMs: 30_000 });
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
    `model="\${OPENCODE_MODEL:-${DEFAULT_CODEX_MODEL}}"`,
    'api_type="${LLM_PROXY_UPSTREAM_API_TYPE:-openai}"',
    'if [[ "$api_type" == "anthropic" ]]; then',
    '  chat_url="${OPENAI_BASE_URL%/}/messages"',
    '  payload=$(printf \'{"model":"%s","messages":[{"role":"user","content":"ping"}],"max_tokens":8}\' "$model")',
    '  chat_status=$(curl -sS -o /tmp/oneceo_gateway_chat.json -w "%{http_code}" \\',
    '    -H "x-api-key: ${OPENAI_API_KEY}" \\',
    '    -H "anthropic-version: 2023-06-01" \\',
    '    -H "Content-Type: application/json" \\',
    '    -d "$payload" \\',
    '    "$chat_url" || true)',
    'else',
    '  chat_url="${OPENAI_BASE_URL%/}/chat/completions"',
    '  payload=$(printf \'{"model":"%s","messages":[{"role":"user","content":"ping"}],"max_tokens":8}\' "$model")',
    '  chat_status=$(curl -sS -o /tmp/oneceo_gateway_chat.json -w "%{http_code}" \\',
    '    -H "Authorization: Bearer ${OPENAI_API_KEY}" \\',
    '    -H "Content-Type: application/json" \\',
    '    -d "$payload" \\',
    '    "$chat_url" || true)',
    'fi',
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

async function assertCodexReady(sessionId: string) {
  return ensureCodexReady(sessionId);
}

function resolveDesiredCodexVersion(): string {
  const configured = pickString(process.env.CODEX_SANDBOX_CLI_VERSION);
  if (configured) return configured;
  return '0.115.0-alpha.27';
}

async function ensureCodexReady(
  sessionId: string
): Promise<{ codexBinaryPath: string; codexVersion: string }> {
  const desiredVersion = resolveDesiredCodexVersion();
  const command = `
set -euo pipefail
desired=${shellEscape(desiredVersion)}
install_root='/home/user/.altus/codex-runtime'
prefix="$install_root/npm-global"
bin="$prefix/bin/codex"
mkdir -p "$prefix"
export NPM_CONFIG_PREFIX="$prefix"
export PATH="$prefix/bin:$PATH"
current_version=""
current_path=""
if command -v codex >/dev/null 2>&1; then
  current_path="$(command -v codex || true)"
  current_version="$(codex --version 2>/dev/null | awk '{print $2}' | tr -d '\\r' || true)"
fi
if [ "$current_version" != "$desired" ] || [ -z "$current_path" ] || [ "$current_path" = "/usr/local/bin/codex" ]; then
  npm install -g "@openai/codex@$desired" >/tmp/codex-install.log 2>&1
fi
resolved_path="$bin"
if [ ! -x "$resolved_path" ]; then
  resolved_path="$(command -v codex || true)"
fi
if [ -z "$resolved_path" ]; then
  echo "codex binary missing"
  exit 41
fi
resolved_version="$("$resolved_path" --version 2>/dev/null | awk '{print $2}' | tr -d '\\r' || true)"
if [ "$resolved_version" != "$desired" ]; then
  echo "codex version mismatch: expected=$desired actual=$resolved_version"
  exit 42
fi
printf 'READY:%s:%s' "$resolved_path" "$resolved_version"
`;
  const result: any = await e2bConnector.runCommand(sessionId, command, { timeoutMs: 180000 });
  const stdout = pickString(result?.stdout || result?.output) || '';
  const match = stdout.match(/^READY:(.+):([^:]+)$/);
  if (!match) {
    const stderr = pickString(result?.stderr) || '';
    throw new Error(stderr || stdout || 'codex ready check failed');
  }
  return {
    codexBinaryPath: match[1],
    codexVersion: match[2],
  };
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
  stateRoot?: string | null,
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
    ...(resolveOpencodeDataHome(stateRoot)
      ? { XDG_DATA_HOME: resolveOpencodeDataHome(stateRoot)! }
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
  stateRoot?: string | null,
  trafficAccessToken?: string | null
) {
  await stopOpencodeServer(sessionId);
  await new Promise((resolve) => setTimeout(resolve, 500));
  await startOpencodeServer(sessionId, baseUrl, envs, stateRoot, trafficAccessToken);
}

const provisionLocks = new Map<string, Promise<ProvisionResult>>();

export class SandboxAgentProvisionService {
  async syncOpencodeRuntimeConfig(input: { orchestratorSessionId: string; taskSessionId?: string }) {
    const sessionId = input.orchestratorSessionId;
    writeConnectorDebugLog('[OPENCODE_RUNTIME_SYNC_START]', {
      orchestratorSessionId: sessionId,
      taskSessionId: input.taskSessionId || null,
    });
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
    const stateRoot = input.taskSessionId ? resolveOpencodeStatePath(input.taskSessionId) : undefined;
    await writeOpencodeConfig(sessionId, opencodeEnvs, connectorBootstrap.mcpEntries);
    await restartOpencodeServer(
      sessionId,
      baseUrl,
      opencodeEnvs,
      stateRoot,
      trafficAccessToken
    );
    writeConnectorDebugLog('[OPENCODE_RUNTIME_SYNC_DONE]', {
      orchestratorSessionId: sessionId,
      taskSessionId: input.taskSessionId || null,
      baseUrl,
      connectorMcpKeys: Object.keys(connectorBootstrap.mcpEntries),
      processEnvKeys: Object.keys(connectorBootstrap.processEnvs),
    });
    return {
      baseUrl,
      trafficAccessToken,
    };
  }

  async provisionWithLock(input: ProvisionInput): Promise<ProvisionResult> {
    const taskSessionId = pickString(input.metadata?.taskSessionId);
    const executor = normalizeProvisionExecutor(input.executor || input.metadata?.executor);
    if (!taskSessionId) {
      return this.provision(input);
    }
    const lockKey = `${taskSessionId}:${executor}`;
    const existing = provisionLocks.get(lockKey);
    if (existing) {
      return existing;
    }
    const promise = this.provision(input)
      .finally(() => {
        provisionLocks.delete(lockKey);
      });
    provisionLocks.set(lockKey, promise);
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
    const executor = normalizeProvisionExecutor(input.executor || input.metadata?.executor);
    const codexExecutionMode = await resolveProvisionCodexMode(taskSessionId, input.metadata);
    const selectedTemplate = resolveProvisionTemplate(executor, codexExecutionMode);
    const reusableResolution = taskSessionId
      ? await resolveReusableSandbox(taskSessionId, executor, codexExecutionMode, selectedTemplate)
      : { reusable: null, templateMismatchSandboxId: null };
    const initialReusable = reusableResolution.reusable;
    const mismatchSandboxToClose = reusableResolution.templateMismatchSandboxId || null;
    let reusable = initialReusable;
    let preferredRestoreSnapshotKey: string | null = null;
    let lastRecoverableError: unknown = null;

    if (taskSessionId && !initialReusable && reusableResolution.templateMismatchSandboxId) {
      const archived = await runStep('archive_before_template_migration', () =>
        archiveSandboxWorkspace(reusableResolution.templateMismatchSandboxId as string, 'template_migration', {
          forceUpload: true,
        })
      );
      preferredRestoreSnapshotKey = archived.snapshotKey || null;
      writeConnectorDebugLog('[PROVISION_TEMPLATE_MIGRATION_ARCHIVED]', {
        taskSessionId,
        oldSandboxId: reusableResolution.templateMismatchSandboxId,
        selectedTemplate,
        snapshotKey: preferredRestoreSnapshotKey,
      });
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const environment = reusable
        ? reusable.environment
        : await runStep('open_environment', () =>
            sandboxEnvironmentService.openEnvironment({
              metadata: {
                ...(input.metadata || {}),
                sandboxExecutor: executor,
              },
              envs: envInput,
              templateOverride: selectedTemplate,
            })
          );

      const sessionId = reusable?.sessionId || environment.sessionId;
      const isReused = Boolean(reusable);

      try {
        const info = await runStep('sandbox_info', () => e2bConnector.getSandboxInfo(sessionId));
        const trafficAccessToken =
          (info as any)?.trafficAccessToken || (info as any)?.traffic_access_token || null;
        const existingEnvironment = await sandboxExecutionEnvironmentDAO.getBySessionId(sessionId);
        const existingMetadata = ((existingEnvironment?.metadata || {}) as Record<string, unknown>) || {};

        await runStep('commands_ready', () => waitForSandboxCommands(sessionId));

        const layout = await runStep('workspace_prepare', () => ensureWorkspaceLayout(sessionId, taskSessionId || undefined));
        const workspaceRoot = layout?.workspaceRoot || null;
        const stateRoot = layout?.stateRoot || (taskSessionId ? resolveOpencodeStatePath(taskSessionId) : null);
        let codexArchiveHome: string | null = null;
        let codexDotCodexPath: string | null = null;
        let codexBinaryPath: string | null = null;
        let codexVersion: string | null = null;
        let codexConfigToml: string | null = null;
        let codexAuthJson: string | null = null;

        if (!isReused) {
          const restored = await restoreWorkspaceIfArchived(
            sessionId,
            preferredRestoreSnapshotKey ? { snapshotKey: preferredRestoreSnapshotKey } : undefined
          );
          if (preferredRestoreSnapshotKey && !restored) {
            throw new Error(`template migration restore failed: snapshot=${preferredRestoreSnapshotKey}`);
          }
          if (restored && taskSessionId) {
            await taskCreationCacheStore.invalidateWorkspaceBySession(taskSessionId);
            await taskSessionRedisCacheService.invalidateWorkspaceBySessionId(taskSessionId);
          }
        }

        let baseUrl: string | undefined;
        let host: string | undefined;
        let osacEndpoint: string | null = pickString(existingMetadata.osacEndpoint);
        let osacHost: string | null = pickString(existingMetadata.osacHost);
        let osacHostPort: number | null = null;
        let osacConnectionMode: string | null = pickString(existingMetadata.osacConnectionMode) || null;
        let osacAuthToken: string | null = pickString(existingMetadata.osacAuthToken);

        if (executor === 'opencode') {
          host = await runStep('sandbox_host', () => resolveE2bPublicHost(sessionId, e2bConfig.opencodePort));
          baseUrl = `https://${host}`;

          await runStep('opencode_present', () => assertOpencodeReady(sessionId));
          await runStep('playwright_present', () => assertPlaywrightReady(sessionId));
          await ensurePlaywrightDeps(sessionId);
          await runStep('opencode_state_migrate', () => migrateLegacyWorkspaceState(sessionId, workspaceRoot, stateRoot));

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
            isReused
              ? restartOpencodeServer(sessionId, baseUrl!, opencodeEnvs, stateRoot, trafficAccessToken)
              : startOpencodeServer(sessionId, baseUrl!, opencodeEnvs, stateRoot, trafficAccessToken)
          );
          const reusableBridge = await canReuseOsacBridge({
            endpoint: osacEndpoint,
            authToken: osacAuthToken,
          });
          if (reusableBridge) {
            osacHostPort =
              Number(existingMetadata.osacHostPort || osacBootstrapConfig.osacPort) || osacBootstrapConfig.osacPort;
            osacConnectionMode = pickString(existingMetadata.osacConnectionMode) || 'direct';
          } else {
            const bridge = await runStep('osac_bridge', () =>
              ensureOsacBridge(sessionId, {
                executor,
                workspaceRoot,
                authToken: osacAuthToken,
              })
            );
            osacEndpoint = bridge.osacEndpoint;
            osacHost = bridge.osacHost;
            osacHostPort = osacBootstrapConfig.osacPort;
            osacConnectionMode = 'direct';
            osacAuthToken = bridge.osacAuthToken;
            await runStep('osac_ready', () =>
              waitForOsacBridgeReady({
                endpoint: bridge.osacEndpoint,
                authToken: bridge.osacAuthToken,
              })
            );
          }
          await runStep('sandbox_verify', () => runSandboxVerify(sessionId));
          await runStep('playwright_mcp', () => osacAgentService.ensurePlaywrightMcp(sessionId));
          await runStep('neko_debug', () => ensureNekoDebug(sessionId));
        } else if (executor === 'codex') {
          const codexReady = await runStep('codex_present', () => assertCodexReady(sessionId));
          codexBinaryPath = codexReady.codexBinaryPath;
          codexVersion = codexReady.codexVersion;
          const codexHomeMapping = await runStep('codex_home_mapping', () =>
            ensureCodexHomeMapping(sessionId, {
              taskSessionId,
              stateRoot,
            })
          );
          codexArchiveHome = codexHomeMapping.codexArchiveHome;
          codexDotCodexPath = codexHomeMapping.codexDotCodexPath;
          if (taskSessionId) {
            const runtimeConfig = await runStep('codex_runtime_config', () =>
              codexRuntimeConfigService.getByTaskSessionId(taskSessionId)
            );
            codexConfigToml = runtimeConfig.configToml;
            codexAuthJson = runtimeConfig.authJson;
            await runStep('codex_runtime_files', () =>
              codexAppServerService.ensureRuntimeFiles({
                sessionId,
                configToml: codexConfigToml,
                authJson: codexAuthJson,
              })
            );
          }
          const reusableBridge = await canReuseOsacBridge({
            endpoint: osacEndpoint,
            authToken: osacAuthToken,
          });
          if (reusableBridge) {
            osacHostPort =
              Number(existingMetadata.osacHostPort || osacBootstrapConfig.osacPort) || osacBootstrapConfig.osacPort;
            osacConnectionMode = pickString(existingMetadata.osacConnectionMode) || 'direct';
          } else {
            const bridge = await runStep('osac_bridge', () =>
              ensureOsacBridge(sessionId, {
                executor,
                workspaceRoot,
                authToken: osacAuthToken,
                codexPath: codexBinaryPath,
              })
            );
            osacEndpoint = bridge.osacEndpoint;
            osacHost = bridge.osacHost;
            osacHostPort = osacBootstrapConfig.osacPort;
            osacConnectionMode = 'direct';
            osacAuthToken = bridge.osacAuthToken;
            await runStep('osac_ready', () =>
              waitForOsacBridgeReady({
                endpoint: bridge.osacEndpoint,
                authToken: bridge.osacAuthToken,
              })
            );
          }
        } else if (executor === 'altus') {
          const reusableBridge = await canReuseOsacBridge({
            endpoint: osacEndpoint,
            authToken: osacAuthToken,
          });
          if (reusableBridge) {
            osacHostPort =
              Number(existingMetadata.osacHostPort || osacBootstrapConfig.osacPort) || osacBootstrapConfig.osacPort;
            osacConnectionMode = pickString(existingMetadata.osacConnectionMode) || 'direct';
          } else {
            const bridge = await runStep('osac_bridge', () =>
              ensureOsacBridge(sessionId, {
                executor,
                workspaceRoot,
                authToken: osacAuthToken,
              })
            );
            osacEndpoint = bridge.osacEndpoint;
            osacHost = bridge.osacHost;
            osacHostPort = osacBootstrapConfig.osacPort;
            osacConnectionMode = 'direct';
            osacAuthToken = bridge.osacAuthToken;
            await runStep('osac_ready', () =>
              waitForOsacBridgeReady({
                endpoint: bridge.osacEndpoint,
                authToken: bridge.osacAuthToken,
              })
            );
          }
          await runStep('neko_debug', () => ensureNekoDebug(sessionId));
        } else {
          throw new Error(`unsupported sandbox executor: ${executor}`);
        }

        const mergedMetadata: Record<string, unknown> = {
          ...(((existingEnvironment?.metadata as Record<string, unknown> | undefined) || {})),
          ...(((input.metadata as Record<string, unknown> | undefined) || {})),
          sandboxProvider: 'e2b',
          sandboxExecutor: executor,
          executor,
          codexExecutionMode: codexExecutionMode || undefined,
          codexMode: codexExecutionMode || undefined,
          sandboxBaseUrl: baseUrl,
          sandboxPort: baseUrl ? e2bConfig.opencodePort : undefined,
          sandboxHost: host,
          workspaceRoot: workspaceRoot || undefined,
          stateRoot: stateRoot || undefined,
          altusBaseUrl: executor === 'altus' ? baseUrl : undefined,
          altusPort: executor === 'altus' && baseUrl ? e2bConfig.opencodePort : undefined,
          altusHost: executor === 'altus' ? host : undefined,
          altusWorkspaceRoot: executor === 'altus' ? workspaceRoot || undefined : undefined,
          altusStateRoot: executor === 'altus' ? stateRoot || undefined : undefined,
          opencodeBaseUrl: baseUrl,
          opencodePort: baseUrl ? e2bConfig.opencodePort : undefined,
          opencodeHost: host,
          opencodeWorkspaceRoot: workspaceRoot || undefined,
          opencodeStateRoot: stateRoot || undefined,
          codexArchiveHome: codexArchiveHome || undefined,
          codexDotCodexPath: codexDotCodexPath || undefined,
          codexBinaryPath: codexBinaryPath || undefined,
          codexVersion: codexVersion || undefined,
          codexConfigToml: codexConfigToml || undefined,
          osacEndpoint: osacEndpoint || undefined,
          osacHost: osacHost || undefined,
          osacHostPort: osacHostPort || undefined,
          osacConnectionMode: osacConnectionMode || undefined,
          osacAuthToken: osacAuthToken || undefined,
          e2b: {
            ...(existingEnvironment?.metadata as any)?.e2b,
            sandboxId: sessionId,
            template: selectedTemplate,
            timeoutMs: e2bConfig.timeoutMs,
            trafficAccessToken: trafficAccessToken,
          },
        };
        await sandboxExecutionEnvironmentDAO.updateMetadata(sessionId, mergedMetadata);

        if (taskSessionId) {
          await taskCreationFileMemoryStore.updateRuntimeBinding(taskSessionId, {
            orchestratorSessionId: sessionId,
            executor,
          });
          await taskCreationFileMemoryStore.updateSessionExecutor(taskSessionId, executor);
        }

        await touchSandbox(sessionId, `provisioned_${executor}`);
        if (mismatchSandboxToClose && mismatchSandboxToClose !== sessionId) {
          await sandboxEnvironmentService.closeEnvironment(mismatchSandboxToClose).catch((error) => {
            console.warn('[PROVISION_TEMPLATE_MIGRATION_CLOSE_OLD_FAILED]', {
              taskSessionId,
              oldSandboxId: mismatchSandboxToClose,
              newSandboxId: sessionId,
              error: error instanceof Error ? error.message : String(error),
            });
          });
        }

        return {
          sessionId,
          vmName: null,
          vmIpAddress: null,
          osacEndpoint,
          osacHost,
          osacHostPort,
          osacConnectionMode,
          osacAuthToken,
          status: 'ready',
          sandboxStatus: 'ready',
          allocationSource: isReused ? 'reused_session' : 'cold_start',
          degradedFromWarmPool: false,
          readyGatePassed: true,
          bootstrap: {
            osacBinaryUrl: '',
            opencodeBinaryUrl: '',
            osacPort: osacBootstrapConfig.osacPort,
            osacPathSuffix: osacBootstrapConfig.osacPathSuffix,
          },
          opencodeBaseUrl: baseUrl,
          opencodePort: baseUrl ? e2bConfig.opencodePort : undefined,
          trafficAccessToken,
        };
      } catch (error) {
        const recoverable = isSandboxUnavailableError(error);
        if (!recoverable || attempt >= 1) {
          throw error;
        }
        lastRecoverableError = error;
        console.warn('[SANDBOX_PROVISION_AUTO_RECOVER]', {
          sessionId,
          taskSessionId,
          executor,
          attempt: attempt + 1,
          error: error instanceof Error ? error.message : String(error),
        });
        e2bConnector.forgetSandbox(sessionId);
        await markSandboxClosedBestEffort(
          sessionId,
          error instanceof Error ? error.message : String(error)
        );
        reusable = null;
      }
    }

    throw lastRecoverableError instanceof Error
      ? lastRecoverableError
      : new Error(String(lastRecoverableError || 'sandbox provision failed'));
  }
}

export const sandboxAgentProvisionService = new SandboxAgentProvisionService();
