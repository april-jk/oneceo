import { randomUUID } from 'node:crypto';
import { e2bConnector } from '../connectors/e2b-connector';
import { osacBootstrapConfig } from '../config/osac-bootstrap-config';
import { writeConnectorDebugLog } from '../utils/connector-debug-log';
import { platformRuntimeArtifactService } from './platform-runtime-artifact-service';

export type SandboxOsacExecutor = 'opencode' | 'codex' | 'altus';

function pickString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
}

function shellEscape(value: string): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
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

  if (executor !== 'codex') {
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
  osacVersion: string;
  osacSha256: string;
  osacObjectKey: string;
}> {
  writeConnectorDebugLog('[OSAC_BRIDGE_ENSURE_START]', {
    orchestratorSessionId: sessionId,
    executor: input.executor,
    workspaceRoot: pickString(input.workspaceRoot) || null,
    hasAuthToken: Boolean(pickString(input.authToken)),
    hasCodexPath: Boolean(pickString(input.codexPath)),
    forceBinaryRewrite: Boolean(input.forceBinaryRewrite),
  });
  const downloadSpec = await platformRuntimeArtifactService.getPublishedOsacDownloadSpec();
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
      osacVersion: downloadSpec.version,
      objectKey: downloadSpec.objectKey,
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
        `if [ -x ${shellEscape(remoteBinary)} ] && command -v sha256sum >/dev/null 2>&1; then
  current_sha=$(sha256sum ${shellEscape(remoteBinary)} | awk '{print $1}' | tr -d '\\r' || true)
  if [ "$current_sha" = ${shellEscape(downloadSpec.sha256)} ]; then
    echo EXISTS_MATCH
  else
    echo EXISTS_MISMATCH
  fi
else
  echo MISSING
fi`,
        { timeoutMs: 10_000 }
      );
      probeOutput = String(binaryProbe?.stdout || binaryProbe?.output || '').trim();
    }
    if (probeOutput !== 'EXISTS_MATCH') {
      const downloadCommand = `
set -euo pipefail
target=${shellEscape(remoteBinary)}
tmp_file=${shellEscape(`${remoteBinary}.download.tmp`)}
expected_sha=${shellEscape(downloadSpec.sha256)}
download_url=${shellEscape(downloadSpec.presignedUrl)}
rm -f "$tmp_file"
curl -fsSL --retry 3 --retry-all-errors "$download_url" -o "$tmp_file"
actual_sha=$(sha256sum "$tmp_file" | awk '{print $1}' | tr -d '\\r')
if [ "$actual_sha" != "$expected_sha" ]; then
  echo "sha256 mismatch: expected=$expected_sha actual=$actual_sha"
  exit 41
fi
python3 - <<'PY' "$tmp_file"
import sys, struct
path = sys.argv[1]
with open(path, 'rb') as fh:
    data = fh.read(20)
if len(data) < 20:
    raise SystemExit('binary_too_small')
if data[:4] != b'\\x7fELF':
    raise SystemExit('not_elf')
machine = struct.unpack('<H', data[18:20])[0]
if machine != 62:
    raise SystemExit(f'wrong_machine:{machine}')
PY
mv "$tmp_file" "$target"
chmod +x "$target"
`;
      await e2bConnector.runCommand(sessionId, downloadCommand, { timeoutMs: 60_000 });
    }
    writeConnectorDebugLog('[OSAC_BRIDGE_ENSURE_WRITE_BINARY_DONE]', {
      orchestratorSessionId: sessionId,
      remoteBinary,
      binaryBytes: downloadSpec.sizeBytes,
      reusedExistingBinary: probeOutput === 'EXISTS_MATCH',
      forceBinaryRewrite: Boolean(input.forceBinaryRewrite),
      osacVersion: downloadSpec.version,
      objectKey: downloadSpec.objectKey,
      presignTtlSeconds: downloadSpec.expiresInSeconds,
    });
  } catch (error) {
    writeConnectorDebugLog('[OSAC_BRIDGE_ENSURE_WRITE_BINARY_FAILED]', {
      orchestratorSessionId: sessionId,
      remoteBinary,
      binaryBytes: downloadSpec.sizeBytes,
      osacVersion: downloadSpec.version,
      objectKey: downloadSpec.objectKey,
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
    osacVersion: downloadSpec.version,
    osacSha256: downloadSpec.sha256,
    osacObjectKey: downloadSpec.objectKey,
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
  currentSha256?: string | null;
  expectedSha256?: string | null;
}): Promise<boolean> {
  const endpoint = pickString(input.endpoint);
  const authToken = pickString(input.authToken);
  const currentSha256 = pickString(input.currentSha256);
  const expectedSha256 = pickString(input.expectedSha256);
  if (!endpoint || !authToken) return false;
  if (!currentSha256 || !expectedSha256 || currentSha256 !== expectedSha256) {
    return false;
  }
  const statusUrl = endpoint.replace(/^ws/i, 'http').replace(/\/ws$/, '/status');
  try {
    const response = await fetch(statusUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });
    return response.ok;
  } catch {
    return false;
  }
}
