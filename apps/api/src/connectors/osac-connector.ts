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

function toPositiveIntOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }
  return null;
}

function parsePortFromEndpoint(endpoint: string | null | undefined): number | null {
  if (!endpoint) return null;
  try {
    const parsed = new URL(endpoint);
    const port = Number(parsed.port || '');
    if (Number.isFinite(port) && port > 0) {
      return Math.floor(port);
    }
  } catch {
    // ignore parse errors
  }
  return null;
}

type MappingContext = {
  mappingId: string | null;
  mappingEpoch: number | null;
  hostPort: number | null;
};

type PortMappingResolution = {
  endpoint: string | null;
  hostPort: number | null;
  mappingId: string | null;
  mappingEpoch: number | null;
};

type OsacConnectionMode = 'direct' | 'port-mapping' | 'kvm-tcp-relay';

type RelayTicketContext = {
  wsUrl: string;
  subprotocol: string;
  relayId: string | null;
  expiresAt: string | null;
};

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

function resolveConnectionMode(metadata: Record<string, unknown> | null | undefined): OsacConnectionMode {
  const nested = metadata?.osac as Record<string, unknown> | undefined;
  const fromMetadata = pickString(
    metadata?.osacConnectionMode,
    metadata?.connectionMode,
    nested?.connectionMode,
    (nested as any)?.connection_mode
  );
  if (fromMetadata === 'direct' || fromMetadata === 'port-mapping' || fromMetadata === 'kvm-tcp-relay') {
    return fromMetadata;
  }
  return osacBootstrapConfig.connectionMode;
}

function buildRelayInnerEndpoint(metadata: Record<string, unknown>): string {
  const existing = resolveOsacEndpoint(metadata);
  if (existing) {
    return existing;
  }
  return `ws://127.0.0.1:${osacBootstrapConfig.osacPort}${osacBootstrapConfig.osacPathSuffix}`;
}

function resolveRelayRequestOptions() {
  const targetPort = Math.max(
    1,
    Math.min(65535, toNumber(process.env.OSAC_KVM_RELAY_TARGET_PORT, osacBootstrapConfig.osacPort))
  );
  const connectTimeoutMs = Math.max(1000, toNumber(process.env.OSAC_KVM_RELAY_CONNECT_TIMEOUT_MS, 5000));
  const idleTimeoutMs = Math.max(60000, toNumber(process.env.OSAC_KVM_RELAY_IDLE_TIMEOUT_MS, 180000));
  const ticketTtlMs = Math.max(5000, Math.min(120000, toNumber(process.env.OSAC_KVM_RELAY_TICKET_TTL_MS, 30000)));
  const singleUseRaw = (process.env.OSAC_KVM_RELAY_SINGLE_USE || 'true').trim().toLowerCase();
  const singleUse = singleUseRaw !== 'false';
  return {
    target_port: targetPort,
    target_host: 'vm' as const,
    connect_timeout_ms: connectTimeoutMs,
    idle_timeout_ms: idleTimeoutMs,
    ticket_ttl_ms: ticketTtlMs,
    single_use: singleUse,
  };
}

async function issueRelayTcpTicket(sessionId: string): Promise<RelayTicketContext> {
  const ticket = await kvmConnector.createRelayTcpTicket(sessionId, resolveRelayRequestOptions());
  const payload = (ticket.data || {}) as Record<string, unknown>;
  const wsUrl = pickString(payload.wsUrl, payload.ws_url);
  if (!wsUrl) {
    throw new Error('KVM relay ticket 返回缺少 ws_url');
  }
  return {
    wsUrl,
    subprotocol: pickString(payload.subprotocol) || 'kvm.tcp.v1',
    relayId: pickString(payload.relayId, payload.relay_id),
    expiresAt: pickString(payload.expiresAt, payload.expires_at),
  };
}

function resolvePortMapping(
  metadata: Record<string, unknown> | null | undefined,
  ports: Record<string, unknown>[] | null
): PortMappingResolution {
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
      return {
        endpoint: `ws://${resolvedHost}:${normalized.hostPort}${osacBootstrapConfig.osacPathSuffix}`,
        hostPort: normalized.hostPort,
        mappingId: normalized.mappingId || null,
        mappingEpoch: normalized.mappingEpoch || null,
      };
    }
  }

  const hostPort = toPositiveIntOrNull((metadata as any)?.osacHostPort);
  if (host && hostPort !== null) {
    return {
      endpoint: `ws://${host}:${hostPort}${osacBootstrapConfig.osacPathSuffix}`,
      hostPort,
      mappingId: null,
      mappingEpoch: null,
    };
  }

  return {
    endpoint: null,
    hostPort: null,
    mappingId: null,
    mappingEpoch: null,
  };
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

function resolveMappingId(metadata: Record<string, unknown> | null | undefined): string | null {
  if (!metadata) return null;
  const nested = metadata.osac as Record<string, unknown> | undefined;
  const mapping = metadata.mapping as Record<string, unknown> | undefined;
  return pickString(
    (metadata as any)?.osacMappingId,
    (metadata as any)?.mappingId,
    (metadata as any)?.mapping_id,
    nested?.mappingId,
    (nested as any)?.mapping_id,
    mapping?.id,
    mapping?.mappingId,
    (mapping as any)?.mapping_id
  );
}

function resolveMappingEpoch(metadata: Record<string, unknown> | null | undefined): number | null {
  if (!metadata) return null;
  const nested = metadata.osac as Record<string, unknown> | undefined;
  const mapping = metadata.mapping as Record<string, unknown> | undefined;
  return (
    toPositiveIntOrNull((metadata as any)?.osacMappingEpoch) ??
    toPositiveIntOrNull((metadata as any)?.mappingEpoch) ??
    toPositiveIntOrNull((metadata as any)?.mapping_epoch) ??
    toPositiveIntOrNull((nested as any)?.mappingEpoch) ??
    toPositiveIntOrNull((nested as any)?.mapping_epoch) ??
    toPositiveIntOrNull(mapping?.epoch) ??
    toPositiveIntOrNull((mapping as any)?.mappingEpoch) ??
    toPositiveIntOrNull((mapping as any)?.mapping_epoch)
  );
}

function deriveMappingId(sessionId: string, hostPort: number | null, endpoint: string): string {
  const safeSession = sessionId.trim() || 'unknown';
  if (hostPort !== null) {
    return `portmap:${safeSession}:${hostPort}`;
  }
  const parsedPort = parsePortFromEndpoint(endpoint);
  if (parsedPort !== null) {
    return `portmap:${safeSession}:${parsedPort}`;
  }
  return `portmap:${safeSession}:direct`;
}

function resolveMappingContext(
  sessionId: string,
  endpoint: string,
  metadata: Record<string, unknown>,
  override?: Partial<MappingContext>
): MappingContext {
  const currentId = resolveMappingId(metadata);
  const currentEpoch = resolveMappingEpoch(metadata);
  const currentHostPort = toPositiveIntOrNull((metadata as any)?.osacHostPort);
  const overrideHostPort = toPositiveIntOrNull(override?.hostPort);
  const hostPort = overrideHostPort ?? parsePortFromEndpoint(endpoint) ?? currentHostPort;

  const candidateId =
    pickString(override?.mappingId) ||
    currentId ||
    deriveMappingId(sessionId, hostPort, endpoint);

  let candidateEpoch =
    toPositiveIntOrNull(override?.mappingEpoch) ??
    currentEpoch ??
    1;

  if (currentId && candidateId && currentId !== candidateId && !toPositiveIntOrNull(override?.mappingEpoch)) {
    candidateEpoch = Math.max(candidateEpoch, (currentEpoch || 1) + 1);
  }
  if (
    currentHostPort !== null &&
    hostPort !== null &&
    currentHostPort !== hostPort &&
    !toPositiveIntOrNull(override?.mappingEpoch)
  ) {
    candidateEpoch = Math.max(candidateEpoch, (currentEpoch || 1) + 1);
  }

  return {
    mappingId: candidateId,
    mappingEpoch: Math.max(1, candidateEpoch),
    hostPort,
  };
}

function withMappingQuery(
  endpoint: string,
  mappingId: string | null,
  mappingEpoch: number | null
): string {
  if (!mappingId || !mappingEpoch || mappingEpoch <= 0) {
    return endpoint;
  }
  try {
    const url = new URL(endpoint);
    url.searchParams.set('mappingId', mappingId);
    url.searchParams.set('mappingEpoch', String(mappingEpoch));
    return url.toString();
  } catch {
    return endpoint;
  }
}

function withAuthTokenQuery(endpoint: string, token: string): string {
  try {
    const url = new URL(endpoint);
    url.searchParams.set('authToken', token);
    return url.toString();
  } catch {
    return endpoint;
  }
}

function withSessionIdQuery(endpoint: string, sessionId: string): string {
  if (!sessionId || !sessionId.trim()) {
    return endpoint;
  }
  try {
    const url = new URL(endpoint);
    url.searchParams.set('sessionId', sessionId.trim());
    return url.toString();
  } catch {
    return endpoint;
  }
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function buildAuthEndpoints(
  endpoint: string,
  token: string,
  sessionId: string,
  mapping: MappingContext
): string[] {
  const mode = (process.env.OSAC_WS_AUTH_MODE || 'header-first').trim().toLowerCase();
  const baseWithSession = withSessionIdQuery(endpoint, sessionId);
  const baseWithMapping = withMappingQuery(baseWithSession, mapping.mappingId, mapping.mappingEpoch);
  const queryEndpoint = withAuthTokenQuery(baseWithMapping, token);
  if (mode === 'query-only') {
    return uniqueStrings([queryEndpoint]);
  }
  if (mode === 'query-then-header') {
    return uniqueStrings([queryEndpoint, baseWithMapping]);
  }
  if (mode === 'header-then-query') {
    return uniqueStrings([baseWithMapping, queryEndpoint]);
  }
  // default: header-only
  return uniqueStrings([baseWithMapping]);
}

export type OsacConnectionHandle = {
  sessionId: string;
  endpoint: string;
  isOpen: () => boolean;
  ping: (timeoutMs?: number) => Promise<void>;
  send: (message: OsacMessage) => void;
  request: (message: OsacMessage, match?: (reply: OsacMessage) => boolean) => Promise<OsacMessage>;
  onMessage: (handler: (message: OsacMessage) => void) => void;
  onClose: (handler: () => void) => void;
  close: () => void;
};

export const osacConnector = {
  async connectForSession(sessionId: string): Promise<OsacConnectionHandle> {
    await ensureDatabaseConnection({ retries: 3, delayMs: 1000 });

    const maxAttempts = toNumber(process.env.OSAC_CONNECT_RETRIES, 3);
    const delayMs = toNumber(process.env.OSAC_CONNECT_RETRY_DELAY_MS, 1500);
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const environment = await sandboxExecutionEnvironmentDAO.getBySessionId(sessionId);
      if (!environment) {
        throw new Error(`未找到执行环境: ${sessionId}`);
      }

      const metadata = (environment.metadata || {}) as Record<string, unknown>;
      const nextMetadata: Record<string, unknown> = { ...metadata };
      const connectionMode = resolveConnectionMode(nextMetadata);
      let endpoint = resolveOsacEndpoint(nextMetadata);
      let mappingOverride: Partial<MappingContext> = {};

      if (connectionMode === 'port-mapping') {
        try {
          const ports = await kvmConnector.listSandboxPorts(
            sessionId,
            buildSandboxPortProbeQuery()
          );
          const portResolution = resolvePortMapping(
            nextMetadata,
            extractSandboxPortMappings(ports?.data as any)
          );
          if (portResolution.endpoint) {
            endpoint = portResolution.endpoint;
            nextMetadata.osacEndpoint = endpoint;
            if (portResolution.hostPort !== null) {
              nextMetadata.osacHostPort = portResolution.hostPort;
            }
            mappingOverride = {
              mappingId: portResolution.mappingId,
              mappingEpoch: portResolution.mappingEpoch,
              hostPort: portResolution.hostPort,
            };
          }
        } catch {
          // ignore and retry
        }
      }

      if (connectionMode === 'kvm-tcp-relay') {
        endpoint = buildRelayInnerEndpoint(nextMetadata);
        nextMetadata.osacEndpoint = endpoint;
        nextMetadata.osacConnectionMode = 'kvm-tcp-relay';
      }

      if (!endpoint) {
        lastError = new Error('未找到 OSAC 连接地址（metadata.osacEndpoint/osacUrl/sandboxAgentEndpoint）');
      } else {
        const token = resolveOsacToken(metadata) || osacConfig.authToken;
        if (!token) {
          throw new Error('未找到 OSAC 认证 Token（metadata.osacAuthToken）');
        }

        const mapping = resolveMappingContext(sessionId, endpoint, nextMetadata, mappingOverride);
        nextMetadata.osacMappingId = mapping.mappingId;
        nextMetadata.osacMappingEpoch = mapping.mappingEpoch;
        if (mapping.hostPort !== null) {
          nextMetadata.osacHostPort = mapping.hostPort;
        }

        const oldEndpoint = pickString(metadata.osacEndpoint);
        const oldHostPort = toPositiveIntOrNull((metadata as any)?.osacHostPort);
        const oldMappingId = resolveMappingId(metadata);
        const oldMappingEpoch = resolveMappingEpoch(metadata);
        const oldMode = pickString((metadata as any)?.osacConnectionMode);

        const metadataChanged =
          oldEndpoint !== pickString(nextMetadata.osacEndpoint) ||
          oldHostPort !== toPositiveIntOrNull((nextMetadata as any)?.osacHostPort) ||
          oldMappingId !== mapping.mappingId ||
          oldMappingEpoch !== mapping.mappingEpoch ||
          oldMode !== pickString(nextMetadata.osacConnectionMode);

        if (metadataChanged) {
          await sandboxExecutionEnvironmentDAO.updateMetadata(sessionId, {
            ...nextMetadata,
          });
        }

        const authEndpoints = buildAuthEndpoints(endpoint, token, sessionId, mapping);
        for (const candidate of authEndpoints) {
          let relay: RelayTicketContext | null = null;
          if (connectionMode === 'kvm-tcp-relay') {
            try {
              relay = await issueRelayTcpTicket(sessionId);
            } catch (error) {
              lastError = error;
              continue;
            }
          }
          const client = new OsacClient(candidate, {
            authToken: token,
            connectTimeoutMs: osacConfig.connectTimeoutMs,
            requestTimeoutMs: osacConfig.requestTimeoutMs,
            kvmRelay: relay
              ? {
                  wsUrl: relay.wsUrl,
                  subprotocol: relay.subprotocol,
                  connectTimeoutMs: toNumber(process.env.OSAC_KVM_RELAY_CONNECT_TIMEOUT_MS, 5000),
                }
              : undefined,
          });

          try {
            await client.connect();
            return {
              sessionId,
              endpoint: candidate,
              isOpen: () => client.isOpen(),
              ping: (timeoutMs?: number) => client.ping(timeoutMs),
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
      }

      if (attempt < maxAttempts) {
        await sleep(delayMs);
      }
    }

    const message = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(message || 'OSAC 连接失败');
  },
};
