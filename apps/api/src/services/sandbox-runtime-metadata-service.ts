import { e2bConnector } from '../connectors/e2b-connector';
import { e2bConfig } from '../config/e2b-config';
import { osacBootstrapConfig } from '../config/osac-bootstrap-config';
import { sandboxExecutionEnvironmentDAO } from '../db/dao';
import { resolveOpencodeStatePath, resolveOpencodeWorkspacePath } from '../utils/opencode-workspace';
import {
  canReuseOsacBridge,
  ensureOsacBridge,
  waitForOsacBridgeReady,
  type SandboxOsacExecutor,
} from './sandbox-osac-bridge-service';
import { writeConnectorDebugLog } from '../utils/connector-debug-log';

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') {
    return value as Record<string, unknown>;
  }
  return {};
}

function resolveExecutor(metadata: Record<string, unknown>): SandboxOsacExecutor {
  const normalized = asText(metadata.sandboxExecutor || metadata.executor).toLowerCase();
  if (normalized === 'altus') return 'altus';
  if (normalized === 'codex') return 'codex';
  if (normalized === 'claudecode') return 'claudecode';
  return 'opencode';
}

function resolveOsacToken(metadata: Record<string, unknown>): string {
  const osac = asObject(metadata.osac);
  return (
    asText(metadata.osacAuthToken) ||
    asText(metadata.osacToken) ||
    asText(osac.authToken) ||
    asText(osac.token)
  );
}

export type EnsuredSandboxRuntimeMetadata = {
  baseUrl: string;
  host: string | null;
  port: number;
  trafficAccessToken: string | null;
  workspaceRoot: string;
  stateRoot: string;
  metadata: Record<string, unknown>;
};

export async function ensureSandboxRuntimeMetadata(
  orchestratorSessionId: string,
  options?: { taskSessionId?: string | null }
): Promise<EnsuredSandboxRuntimeMetadata | null> {
  writeConnectorDebugLog('[SANDBOX_RUNTIME_METADATA_START]', {
    orchestratorSessionId,
    taskSessionId: asText(options?.taskSessionId) || null,
  });
  const environment = await sandboxExecutionEnvironmentDAO.getBySessionId(orchestratorSessionId);
  if (!environment) return null;

  const metadata = asObject(environment.metadata);
  const e2bMeta = asObject(metadata.e2b);
  const boundTaskSessionId = asText(options?.taskSessionId) || asText(metadata.taskSessionId);
  const runtimeBaseUrl =
    asText(metadata.sandboxBaseUrl) || asText(metadata.altusBaseUrl) || asText(metadata.opencodeBaseUrl);
  const runtimeHost =
    asText(metadata.sandboxHost) || asText(metadata.altusHost) || asText(metadata.opencodeHost);
  const runtimePort =
    Number(metadata.sandboxPort || metadata.altusPort || metadata.opencodePort) || e2bConfig.opencodePort;
  const workspaceRoot =
    asText(metadata.workspaceRoot) ||
    asText(metadata.altusWorkspaceRoot) ||
    asText(metadata.opencodeWorkspaceRoot) ||
    resolveOpencodeWorkspacePath(boundTaskSessionId || orchestratorSessionId);
  const stateRoot =
    asText(metadata.stateRoot) ||
    asText(metadata.altusStateRoot) ||
    asText(metadata.opencodeStateRoot) ||
    resolveOpencodeStatePath(boundTaskSessionId || orchestratorSessionId);
  const trafficAccessToken =
    asText(e2bMeta.trafficAccessToken) || asText(metadata.trafficAccessToken) || null;

  let baseUrl = runtimeBaseUrl || asText(asObject(metadata.opencode).baseUrl) || asText(metadata.osacEndpoint);
  let host = runtimeHost || null;
  let osacEndpoint = asText(metadata.osacEndpoint);
  let osacHost = asText(metadata.osacHost);
  let osacHostPort = Number(metadata.osacHostPort) || null;
  let osacConnectionMode = asText(metadata.osacConnectionMode);
  let osacAuthToken = resolveOsacToken(metadata);
  let needsMetadataUpdate = false;

  if (!baseUrl) {
    host = await e2bConnector.getSandboxHost(orchestratorSessionId, runtimePort);
    baseUrl = `https://${host}`;
    needsMetadataUpdate = true;
  }

  if (!host && baseUrl) {
    try {
      host = new URL(baseUrl).host;
      needsMetadataUpdate = true;
    } catch {
      host = null;
    }
  }

  if (asText(metadata.opencodeWorkspaceRoot) !== workspaceRoot) {
    needsMetadataUpdate = true;
  }
  if (asText(metadata.opencodeStateRoot) !== stateRoot) {
    needsMetadataUpdate = true;
  }
  if (runtimePort !== Number(metadata.sandboxPort || metadata.altusPort || metadata.opencodePort)) {
    needsMetadataUpdate = true;
  }

  if ((asText(metadata.sandboxProvider) || 'e2b') === 'e2b') {
    const reusableBridge = await canReuseOsacBridge({
      endpoint: osacEndpoint,
      authToken: osacAuthToken,
    });
    writeConnectorDebugLog('[SANDBOX_RUNTIME_METADATA_BRIDGE_CHECK]', {
      orchestratorSessionId,
      taskSessionId: boundTaskSessionId || null,
      executor: resolveExecutor(metadata),
      osacEndpoint: osacEndpoint || null,
      hasOsacAuthToken: Boolean(osacAuthToken),
      reusableBridge,
    });
    if (reusableBridge) {
      const normalizedHostPort = Number(metadata.osacHostPort) || osacBootstrapConfig.osacPort;
      if (!osacHostPort || osacHostPort !== normalizedHostPort) {
        osacHostPort = normalizedHostPort;
        needsMetadataUpdate = true;
      }
      if (!osacConnectionMode) {
        osacConnectionMode = 'direct';
        needsMetadataUpdate = true;
      }
      if (asText(metadata.osacAuthToken) !== osacAuthToken && osacAuthToken) {
        needsMetadataUpdate = true;
      }
    } else {
      writeConnectorDebugLog('[SANDBOX_RUNTIME_METADATA_BRIDGE_RECREATE]', {
        orchestratorSessionId,
        taskSessionId: boundTaskSessionId || null,
        executor: resolveExecutor(metadata),
      });
      const bridge = await ensureOsacBridge(orchestratorSessionId, {
        executor: resolveExecutor(metadata),
        workspaceRoot,
        authToken: osacAuthToken || undefined,
        codexPath: asText(metadata.codexBinaryPath) || undefined,
      });
      osacEndpoint = bridge.osacEndpoint;
      osacHost = bridge.osacHost;
      osacHostPort = osacBootstrapConfig.osacPort;
      osacConnectionMode = 'direct';
      osacAuthToken = bridge.osacAuthToken;
      needsMetadataUpdate = true;
      void waitForOsacBridgeReady({
        endpoint: bridge.osacEndpoint,
        authToken: bridge.osacAuthToken,
      }).catch((error) => {
        writeConnectorDebugLog('[OSAC_BRIDGE_READY_WAIT_FAILED]', {
          orchestratorSessionId,
          taskSessionId: boundTaskSessionId || null,
          endpoint: bridge.osacEndpoint,
          error: error instanceof Error ? error.message : String(error),
        }, 'error');
      });
    }
  }

  const nextMetadata = needsMetadataUpdate
    ? {
        ...metadata,
        sandboxProvider: asText(metadata.sandboxProvider) || 'e2b',
        sandboxBaseUrl: baseUrl,
        sandboxHost: host || undefined,
        sandboxPort: runtimePort,
        workspaceRoot: workspaceRoot || undefined,
        stateRoot: stateRoot || undefined,
        altusBaseUrl: resolveExecutor(metadata) === 'altus' ? baseUrl : undefined,
        altusHost: resolveExecutor(metadata) === 'altus' ? host || undefined : undefined,
        altusPort: resolveExecutor(metadata) === 'altus' ? runtimePort : undefined,
        altusWorkspaceRoot: resolveExecutor(metadata) === 'altus' ? workspaceRoot || undefined : undefined,
        altusStateRoot: resolveExecutor(metadata) === 'altus' ? stateRoot || undefined : undefined,
        opencodeBaseUrl: baseUrl,
        opencodeHost: host || undefined,
        opencodePort: runtimePort,
        opencodeWorkspaceRoot: workspaceRoot || undefined,
        opencodeStateRoot: stateRoot || undefined,
        osacEndpoint: osacEndpoint || undefined,
        osacHost: osacHost || undefined,
        osacHostPort: osacHostPort || undefined,
        osacConnectionMode: osacConnectionMode || undefined,
        osacAuthToken: osacAuthToken || undefined,
        e2b: {
          ...e2bMeta,
          sandboxId: asText(e2bMeta.sandboxId) || orchestratorSessionId,
          template: asText(e2bMeta.template) || e2bConfig.template,
          timeoutMs: Number(e2bMeta.timeoutMs) || e2bConfig.timeoutMs,
          trafficAccessToken,
        },
      }
    : metadata;

  if (needsMetadataUpdate) {
    await sandboxExecutionEnvironmentDAO.updateMetadata(orchestratorSessionId, nextMetadata);
  }
  writeConnectorDebugLog('[SANDBOX_RUNTIME_METADATA_DONE]', {
    orchestratorSessionId,
    taskSessionId: boundTaskSessionId || null,
    baseUrl,
    osacEndpoint: asText(nextMetadata.osacEndpoint) || null,
    hasOsacAuthToken: Boolean(resolveOsacToken(nextMetadata)),
    needsMetadataUpdate,
  });

  return {
    baseUrl,
    host,
    port: runtimePort,
    trafficAccessToken,
    workspaceRoot,
    stateRoot,
    metadata: nextMetadata,
  };
}
