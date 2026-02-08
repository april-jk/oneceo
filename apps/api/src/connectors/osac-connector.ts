import { ensureDatabaseConnection } from '../config/database';
import { osacConfig } from '../config/osac-config';
import { osacBootstrapConfig } from '../config/osac-bootstrap-config';
import { sandboxExecutionEnvironmentDAO } from '../db/dao';
import { OsacClient, type OsacMessage } from '../clients/osac-client';

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
  send: (message: OsacMessage) => void;
  request: (message: OsacMessage, match?: (reply: OsacMessage) => boolean) => Promise<OsacMessage>;
  onMessage: (handler: (message: OsacMessage) => void) => void;
  close: () => void;
};

export const osacConnector = {
  async connectForSession(sessionId: string): Promise<OsacConnectionHandle> {
    await ensureDatabaseConnection({ retries: 3, delayMs: 1000 });

    const environment = await sandboxExecutionEnvironmentDAO.getBySessionId(sessionId);
    if (!environment) {
      throw new Error(`未找到执行环境: ${sessionId}`);
    }

    const metadata = (environment.metadata || {}) as Record<string, unknown>;
    const endpoint = resolveOsacEndpoint(metadata);
    if (!endpoint) {
      throw new Error('未找到 OSAC 连接地址（metadata.osacEndpoint/osacUrl/sandboxAgentEndpoint）');
    }

    const token = resolveOsacToken(metadata) || osacConfig.authToken;
    if (!token) {
      throw new Error('未找到 OSAC 认证 Token（metadata.osacAuthToken）');
    }

    const client = new OsacClient(endpoint, {
      authToken: token,
      connectTimeoutMs: osacConfig.connectTimeoutMs,
      requestTimeoutMs: osacConfig.requestTimeoutMs,
    });

    await client.connect();

    return {
      sessionId,
      endpoint,
      send: (message) => client.send(message),
      request: (message, match) => client.request(message, match),
      onMessage: (handler) => client.on('message', handler),
      close: () => client.close(),
    };
  },
};
