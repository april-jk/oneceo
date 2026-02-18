import { ensureDatabaseConnection } from '../config/database';
import { osacConfig } from '../config/osac-config';
import { osacBootstrapConfig } from '../config/osac-bootstrap-config';
import { sandboxExecutionEnvironmentDAO } from '../db/dao';
import { OsacClient, type OsacMessage } from '../clients/osac-client';
import { kvmConnector } from './kvm-connector';
import {
  buildSandboxPortProbeQuery,
  extractSandboxPortMappings,
  findSandboxPortMapping,
  normalizeSandboxPortMapping,
} from './kvm-call-pattern';

function toNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function resolveOsacEndpoint(metadata: Record<string, unknown> | null | undefined): string | null {
  if (!metadata) return null;
  const nested = metadata.osac as Record<string, unknown> | undefined;
  const explicit = pickString(
    metadata.osacEndpoint,
    metadata.osacUrl,
    metadata.sandboxAgentEndpoint,
    metadata.sandboxAgentUrl,
    nested?.endpoint,
    nested?.url
  );
  if (explicit) return explicit;

  const ip = pickString(metadata.vmIpAddress, (metadata.vm as any)?.ipAddress);
  if (ip) {
    return `ws://${ip}:${osacBootstrapConfig.osacPort}${osacBootstrapConfig.osacPathSuffix}`;
  }
  return null;
}

function resolvePortMappingEndpoint(
  metadata: Record<string, unknown> | null | undefined,
  ports: Record<string, unknown>[] | null
): string | null {
  const fallbackHost = resolveOrchestratorHost();
  const host = pickString(
    (metadata as any)?.osacHost,
    (metadata as any)?.orchestratorHost,
    fallbackHost || undefined
  );
  const targetPort = osacBootstrapConfig.osacPort;
  const preferredHostPort = pickString((metadata as any)?.osacHostPort);

  const matched = findSandboxPortMapping(
    ports || [],
    Number(targetPort),
    preferredHostPort ? Number(preferredHostPort) : null
  );
  if (matched) {
    const normalized = normalizeSandboxPortMapping(matched);
    const resolvedHost = host || normalized.hostIp || fallbackHost;
    if (resolvedHost && normalized.hostPort !== null) {
      return `ws://${resolvedHost}:${normalized.hostPort}${osacBootstrapConfig.osacPathSuffix}`;
    }
  }

  const hostPort = pickString((metadata as any)?.osacHostPort);
  if (host && hostPort) {
    return `ws://${host}:${hostPort}${osacBootstrapConfig.osacPathSuffix}`;
  }

  return null;
}

function resolveOrchestratorHost(): string | null {
  const raw = process.env.KVM_ORCHESTRATOR_URL;
  if (!raw) return null;
  try {
    return new URL(raw).hostname;
  } catch {
    return null;
  }
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveOsacToken(metadata: Record<string, unknown> | null | undefined): string | null {
  if (!metadata) return null;
  const nested = metadata.osac as Record<string, unknown> | undefined;
  return pickString(
    metadata.osacAuthToken,
    metadata.osacToken,
    nested?.token,
    nested?.authToken
  );
}

export type OsacConnectionHandle = {
  sessionId: string;
  endpoint: string;
  isOpen: () => boolean;
  send: (message: OsacMessage) => void;
  request: (message: OsacMessage, match?: (reply: OsacMessage) => boolean) => Promise<OsacMessage>;
  onMessage: (handler: (message: OsacMessage) => void) => void;
  onClose: (handler: () => void) => void;
  close: () => void;
};

export const osacConnector = {
  async connectForSession(sessionId: string): Promise<OsacConnectionHandle> {
    await ensureDatabaseConnection({ retries: 3, delayMs: 1000 });

    const maxAttempts = toNumber(process.env.OSAC_CONNECT_RETRIES, 6);
    const delayMs = toNumber(process.env.OSAC_CONNECT_RETRY_DELAY_MS, 3000);
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const environment = await sandboxExecutionEnvironmentDAO.getBySessionId(sessionId);
      if (!environment) {
        throw new Error(`未找到执行环境: ${sessionId}`);
      }

      const metadata = (environment.metadata || {}) as Record<string, unknown>;
      let endpoint = resolveOsacEndpoint(metadata);

      if (osacBootstrapConfig.connectionMode === 'port-mapping') {
        try {
          const ports = await kvmConnector.listSandboxPorts(
            sessionId,
            buildSandboxPortProbeQuery()
          );
          const refreshed = resolvePortMappingEndpoint(
            metadata,
            extractSandboxPortMappings(ports?.data as any)
          );
          if (refreshed) {
            endpoint = refreshed;
            await sandboxExecutionEnvironmentDAO.updateMetadata(sessionId, {
              ...metadata,
              osacEndpoint: refreshed,
            });
          }
        } catch {
          // ignore and retry
        }
      }

      if (!endpoint) {
        lastError = new Error('未找到 OSAC 连接地址（metadata.osacEndpoint/osacUrl/sandboxAgentEndpoint）');
      } else {
        const token = resolveOsacToken(metadata) || osacConfig.authToken;
        if (!token) {
          throw new Error('未找到 OSAC 认证 Token（metadata.osacAuthToken）');
        }

        const client = new OsacClient(endpoint, {
          authToken: token,
          connectTimeoutMs: osacConfig.connectTimeoutMs,
          requestTimeoutMs: osacConfig.requestTimeoutMs,
        });

        try {
          await client.connect();
          return {
            sessionId,
            endpoint,
            isOpen: () => client.isOpen(),
            send: (message) => client.send(message),
            request: (message, match) => client.request(message, match),
            onMessage: (handler) => client.on('message', handler),
            onClose: (handler) => client.on('close', handler),
            close: () => client.close(),
          };
        } catch (error) {
          lastError = error;
          try {
            client.close();
          } catch {
            // ignore
          }
        }
      }

      if (attempt < maxAttempts) {
        await sleep(delayMs);
      }
    }

    const message = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(message || 'OSAC 连接失败');
  },
};
