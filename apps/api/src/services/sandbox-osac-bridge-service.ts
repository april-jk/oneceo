import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { e2bConnector } from '../connectors/e2b-connector';
import { osacBootstrapConfig } from '../config/osac-bootstrap-config';
import { writeConnectorDebugLog } from '../utils/connector-debug-log';

export type SandboxOsacExecutor = 'opencode' | 'codex' | 'claudecode' | 'altus';

function pickString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
}

function shellEscape(value: string): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function assertLinuxAmd64Binary(buffer: Buffer, sourcePath: string) {
  if (buffer.length < 20) {
    throw new Error(`OSAC binary is too small: ${sourcePath}`);
  }
  const isElf =
    buffer[0] === 0x7f &&
    buffer[1] === 0x45 &&
    buffer[2] === 0x4c &&
    buffer[3] === 0x46;
  if (!isElf) {
    throw new Error(`OSAC binary is not a Linux ELF executable: ${sourcePath}`);
  }
  const machine = buffer.readUInt16LE(18);
  if (machine !== 62) {
    throw new Error(`OSAC binary is not linux/amd64 (e_machine=${machine}): ${sourcePath}`);
  }
}

function resolveExecutorRemoteBaseDir(
  executor: SandboxOsacExecutor,
  workspaceRoot?: string | null
): string {
  const configured = (osacBootstrapConfig.remoteBaseDir || '').trim();
  const normalizedWorkspace = pickString(workspaceRoot);

  const deriveFromWorkspaceRoot = () => {
    if (!normalizedWorkspace) return null;
    const trimmed = normalizedWorkspace.replace(/\/+$/, '');
    const workspaceMarker = trimmed.indexOf('/workspaces/');
    if (workspaceMarker > 0) {
      return trimmed.slice(0, workspaceMarker);
    }
    const stateMarker = trimmed.indexOf('/state/');
    if (stateMarker > 0) {
      return trimmed.slice(0, stateMarker);
    }
    const idx = trimmed.lastIndexOf('/');
    if (idx > 0) {
      const parent = trimmed.slice(0, idx);
      if (parent.endsWith('/workspaces') || parent.endsWith('/state')) {
        const parentIdx = parent.lastIndexOf('/');
        if (parentIdx > 0) {
          return parent.slice(0, parentIdx);
        }
      }
      return parent;
    }
    return null;
  };

  const derived = deriveFromWorkspaceRoot();
  const isLegacyConfiguredDir = !configured || configured === '/opt/.altus/opencode';

  if (executor !== 'codex') {
    if (derived && isLegacyConfiguredDir) {
      return derived;
    }
    return configured || derived || '/home/user/opencode';
  }

  if (configured && configured !== '/opt/.altus/opencode') {
    return configured;
  }

  if (derived) {
    return derived;
  }

  return '/home/user/.altus/opencode';
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function resolveLocalOsacBinaryPath(): Promise<string> {
  const candidates = [osacBootstrapConfig.osacBinaryPath];
  const localDistDirs = [
    path.resolve(process.cwd(), 'OSAC_client/dist'),
    path.resolve(process.cwd(), '../OSAC_client/dist'),
    path.resolve(process.cwd(), '../../OSAC_client/dist'),
  ];
  for (const localDistDir of localDistDirs) {
    try {
      const entries = await fs.readdir(localDistDir);
      const matched = entries
        .filter((entry) => /^osac-linux-amd64/.test(entry))
        .sort((left, right) => {
          const leftDebug = left.endsWith('_debug');
          const rightDebug = right.endsWith('_debug');
          const leftBase = leftDebug ? left.slice(0, -6) : left;
          const rightBase = rightDebug ? right.slice(0, -6) : right;
          if (leftBase !== rightBase) {
            return rightBase.localeCompare(leftBase);
          }
          if (leftDebug === rightDebug) return right.localeCompare(left);
          return leftDebug ? 1 : -1;
        });
      for (const entry of matched) {
        candidates.push(path.join(localDistDir, entry));
      }
    } catch {
      // ignore local dist scan failures for this directory
    }
  }

  for (const candidate of candidates) {
    if (!candidate) continue;
    const resolved = path.isAbsolute(candidate) ? candidate : path.resolve(process.cwd(), candidate);
    if (await fileExists(resolved)) {
      return resolved;
    }
  }

  throw new Error(`OSAC binary not found; checked ${candidates.filter(Boolean).join(', ')}`);
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

export async function ensureOsacBridge(
  sessionId: string,
  input: {
    executor: SandboxOsacExecutor;
    workspaceRoot?: string | null;
    authToken?: string | null;
    codexPath?: string | null;
    forceBinaryRewrite?: boolean;
  }
): Promise<{
  osacEndpoint: string;
  osacHost: string;
  osacAuthToken: string;
  osacRemoteBinary: string;
}> {
  writeConnectorDebugLog('[OSAC_BRIDGE_ENSURE_START]', {
    orchestratorSessionId: sessionId,
    executor: input.executor,
    workspaceRoot: pickString(input.workspaceRoot) || null,
    hasAuthToken: Boolean(pickString(input.authToken)),
    hasCodexPath: Boolean(pickString(input.codexPath)),
    forceBinaryRewrite: Boolean(input.forceBinaryRewrite),
  });
  const osacBinaryPath = await resolveLocalOsacBinaryPath();
  const osacBuffer = await fs.readFile(osacBinaryPath);
  assertLinuxAmd64Binary(osacBuffer, osacBinaryPath);
  const remoteBaseDir = resolveExecutorRemoteBaseDir(input.executor, input.workspaceRoot);
  const remoteBinaryName = osacBootstrapConfig.osacBinaryName || 'osac';
  const remoteBinary = `${remoteBaseDir.replace(/\/+$/, '')}/${remoteBinaryName}`;
  const osacLogDir = `${remoteBaseDir.replace(/\/+$/, '')}/log`;
  const osacTmpDir = `${remoteBaseDir.replace(/\/+$/, '')}/tmp`;
  const osacLockPath = `${remoteBaseDir.replace(/\/+$/, '')}/osac.lock`;
  const authToken = pickString(input.authToken) || `e2b_${randomUUID().replace(/-/g, '')}`;
  const workspaceRoot = pickString(input.workspaceRoot) || '';

  try {
    await e2bConnector.runCommand(
      sessionId,
      `mkdir -p ${shellEscape(remoteBaseDir)} ${shellEscape(osacLogDir)} ${shellEscape(osacTmpDir)}`,
      { timeoutMs: 30_000 }
    );
    writeConnectorDebugLog('[OSAC_BRIDGE_ENSURE_MKDIR_DONE]', {
      orchestratorSessionId: sessionId,
      remoteBaseDir,
      osacLogDir,
      osacTmpDir,
    });
  } catch (error) {
    writeConnectorDebugLog('[OSAC_BRIDGE_ENSURE_MKDIR_FAILED]', {
      orchestratorSessionId: sessionId,
      remoteBaseDir,
      osacLogDir,
      osacTmpDir,
      error: error instanceof Error ? error.message : String(error),
    }, 'error');
    throw error;
  }
  try {
    let probeOutput = 'MISSING';
    if (!input.forceBinaryRewrite) {
      const binaryProbe: any = await e2bConnector.runCommand(
        sessionId,
        `if [ -x ${shellEscape(remoteBinary)} ]; then echo EXISTS; else echo MISSING; fi`,
        { timeoutMs: 10_000 }
      );
      probeOutput = String(binaryProbe?.stdout || binaryProbe?.output || '').trim();
    }
    if (probeOutput !== 'EXISTS') {
      await e2bConnector.writeFile(sessionId, remoteBinary, osacBuffer);
    }
    writeConnectorDebugLog('[OSAC_BRIDGE_ENSURE_WRITE_BINARY_DONE]', {
      orchestratorSessionId: sessionId,
      remoteBinary,
      binaryBytes: osacBuffer.byteLength,
      reusedExistingBinary: probeOutput === 'EXISTS',
      forceBinaryRewrite: Boolean(input.forceBinaryRewrite),
    });
  } catch (error) {
    writeConnectorDebugLog('[OSAC_BRIDGE_ENSURE_WRITE_BINARY_FAILED]', {
      orchestratorSessionId: sessionId,
      remoteBinary,
      binaryBytes: osacBuffer.byteLength,
      error: error instanceof Error ? error.message : String(error),
    }, 'error');
    throw error;
  }

  const envParts = [
    `OSAC_AUTH_TOKEN=${shellEscape(authToken)}`,
    `OSAC_LISTEN_ADDR=':${osacBootstrapConfig.osacPort}'`,
    `OSAC_LOG_DIR=${shellEscape(osacLogDir)}`,
    `OSAC_UPDATE_TMP=${shellEscape(osacTmpDir)}`,
    `OSAC_INSTANCE_LOCK_PATH=${shellEscape(osacLockPath)}`,
    `OSAC_CODEX_PATH=${shellEscape(pickString(input.codexPath) || 'codex')}`,
    `OSAC_CODEX_DEFAULT_WORKTREE=${shellEscape(workspaceRoot)}`,
    `OSAC_OPENCODE_PATH='opencode'`,
    `OSAC_OPENCODE_DEFAULT_WORKTREE=${shellEscape(workspaceRoot)}`,
    `OSAC_LLM_PROXY_ENABLE='false'`,
  ];
  const startCommand = `
set -euo pipefail
chmod +x ${shellEscape(remoteBinary)}
pkill -x ${shellEscape(remoteBinaryName)} || true
rm -f ${shellEscape(osacLockPath)}
nohup env ${envParts.join(' ')} ${shellEscape(remoteBinary)} >> ${shellEscape(`${osacLogDir}/osac.log`)} 2>&1 < /dev/null &
sleep 1
if command -v ss >/dev/null 2>&1; then
  ss -ltnp | grep -E ':${osacBootstrapConfig.osacPort}\\b' || true
else
  netstat -ltnp | grep -E ':${osacBootstrapConfig.osacPort}\\b' || true
fi
`;
  try {
    await e2bConnector.runCommand(sessionId, startCommand, { timeoutMs: 30_000 });
    writeConnectorDebugLog('[OSAC_BRIDGE_ENSURE_START_COMMAND_DONE]', {
      orchestratorSessionId: sessionId,
      remoteBinary,
      osacPort: osacBootstrapConfig.osacPort,
    });
  } catch (error) {
    writeConnectorDebugLog('[OSAC_BRIDGE_ENSURE_START_COMMAND_FAILED]', {
      orchestratorSessionId: sessionId,
      remoteBinary,
      osacPort: osacBootstrapConfig.osacPort,
      error: error instanceof Error ? error.message : String(error),
    }, 'error');
    throw error;
  }

  let osacHost: string;
  try {
    osacHost = await resolveE2bPublicHost(sessionId, osacBootstrapConfig.osacPort);
  } catch (error) {
    writeConnectorDebugLog('[OSAC_BRIDGE_ENSURE_RESOLVE_HOST_FAILED]', {
      orchestratorSessionId: sessionId,
      remoteBinary,
      osacPort: osacBootstrapConfig.osacPort,
      error: error instanceof Error ? error.message : String(error),
    }, 'error');
    throw error;
  }
  const protocol = osacHost.startsWith('localhost') || osacHost.startsWith('127.') ? 'ws' : 'wss';
  writeConnectorDebugLog('[OSAC_BRIDGE_ENSURE_DONE]', {
    orchestratorSessionId: sessionId,
    executor: input.executor,
    osacHost,
    endpoint: `${protocol}://${osacHost}${osacBootstrapConfig.osacPathSuffix}`,
  });

  return {
    osacEndpoint: `${protocol}://${osacHost}${osacBootstrapConfig.osacPathSuffix}`,
    osacHost,
    osacAuthToken: authToken,
    osacRemoteBinary: remoteBinary,
  };
}

export async function waitForOsacBridgeReady(input: {
  endpoint: string;
  authToken: string;
}): Promise<void> {
  writeConnectorDebugLog('[OSAC_BRIDGE_READY_WAIT_START]', {
    endpoint: input.endpoint,
    hasAuthToken: Boolean(input.authToken),
  });
  const statusUrl = input.endpoint.replace(/^ws/i, 'http').replace(/\/ws$/, '/status');
  const attempts = Math.max(5, Number(process.env.OSAC_READY_ATTEMPTS || 20));
  const delayMs = Math.max(250, Number(process.env.OSAC_READY_DELAY_MS || 1000));
  let lastError: unknown = null;

  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(statusUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${input.authToken}`,
        },
      });
      if (response.ok) {
        writeConnectorDebugLog('[OSAC_BRIDGE_READY_WAIT_DONE]', {
          endpoint: input.endpoint,
          status: response.status,
        });
        return;
      }
      lastError = new Error(`status=${response.status}`);
    } catch (error) {
      lastError = error;
    }

    if (index + 1 < attempts) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError || 'osac bridge not ready'));
}

export async function canReuseOsacBridge(input: {
  endpoint?: string | null;
  authToken?: string | null;
}): Promise<boolean> {
  const endpoint = pickString(input.endpoint);
  const authToken = pickString(input.authToken);
  return Boolean(endpoint && authToken);
}
