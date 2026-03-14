import { e2bConnector } from '../connectors/e2b-connector';
import { e2bConfig } from '../config/e2b-config';
import { sandboxExecutionEnvironmentDAO } from '../db/dao';
import { resolveOpencodeWorkspacePath } from '../utils/opencode-workspace';

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') {
    return value as Record<string, unknown>;
  }
  return {};
}

export type EnsuredSandboxRuntimeMetadata = {
  baseUrl: string;
  host: string | null;
  port: number;
  trafficAccessToken: string | null;
  workspaceRoot: string;
  metadata: Record<string, unknown>;
};

export async function ensureSandboxRuntimeMetadata(
  orchestratorSessionId: string,
  options?: { taskSessionId?: string | null }
): Promise<EnsuredSandboxRuntimeMetadata | null> {
  const environment = await sandboxExecutionEnvironmentDAO.getBySessionId(orchestratorSessionId);
  if (!environment) return null;

  const metadata = asObject(environment.metadata);
  const e2bMeta = asObject(metadata.e2b);
  const boundTaskSessionId = asText(options?.taskSessionId) || asText(metadata.taskSessionId);
  const workspaceRoot =
    asText(metadata.opencodeWorkspaceRoot) ||
    resolveOpencodeWorkspacePath(boundTaskSessionId || orchestratorSessionId);
  const trafficAccessToken =
    asText(e2bMeta.trafficAccessToken) || asText(metadata.trafficAccessToken) || null;

  let baseUrl =
    asText(metadata.opencodeBaseUrl) ||
    asText(asObject(metadata.opencode).baseUrl) ||
    asText(metadata.osacEndpoint);
  let host = asText(metadata.opencodeHost) || null;
  let needsMetadataUpdate = false;

  if (!baseUrl) {
    host = await e2bConnector.getSandboxHost(orchestratorSessionId, e2bConfig.opencodePort);
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
  if (Number(metadata.opencodePort) !== e2bConfig.opencodePort) {
    needsMetadataUpdate = true;
  }

  const nextMetadata = needsMetadataUpdate
    ? {
        ...metadata,
        sandboxProvider: asText(metadata.sandboxProvider) || 'e2b',
        opencodeBaseUrl: baseUrl,
        opencodeHost: host || undefined,
        opencodePort: e2bConfig.opencodePort,
        opencodeWorkspaceRoot: workspaceRoot || undefined,
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

  return {
    baseUrl,
    host,
    port: e2bConfig.opencodePort,
    trafficAccessToken,
    workspaceRoot,
    metadata: nextMetadata,
  };
}
