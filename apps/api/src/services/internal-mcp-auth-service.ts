import { connectorSecretService } from './connector-secret-service';
import type { ConnectorKey } from '../connectors/definitions';

export const INTERNAL_CONNECTOR_RUNTIME_AUTH_HEADER = 'x-oneceo-connector-runtime-auth';

type InternalConnectorRuntimePayload = {
  connectorKey: ConnectorKey;
  taskSessionId: string;
  userId: string;
  profileId: string;
  issuedAt: string;
  expiresAt: string;
};

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function createInternalConnectorRuntimeToken(input: {
  connectorKey: ConnectorKey;
  taskSessionId: string;
  userId: string;
  profileId: string;
  ttlMs?: number;
}): string {
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + Math.max(5 * 60_000, input.ttlMs || 24 * 60 * 60_000));
  const token = connectorSecretService.encrypt(
    {
      connectorKey: input.connectorKey,
      taskSessionId: asText(input.taskSessionId),
      userId: asText(input.userId),
      profileId: asText(input.profileId),
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    } satisfies InternalConnectorRuntimePayload,
    input.connectorKey
  );
  if (!token) {
    throw new Error('生成 internal MCP 运行时鉴权上下文失败');
  }
  return token;
}

export function parseInternalConnectorRuntimeToken(
  ciphertext: string,
  connectorKey: ConnectorKey
): InternalConnectorRuntimePayload {
  const payload =
    connectorSecretService.decryptJson<InternalConnectorRuntimePayload>(ciphertext, connectorKey);
  if (!payload) {
    throw new Error('internal MCP 运行时鉴权上下文缺失');
  }
  if (payload.connectorKey !== connectorKey) {
    throw new Error('internal MCP 运行时鉴权上下文 connector 不匹配');
  }
  const taskSessionId = asText(payload.taskSessionId);
  const userId = asText(payload.userId);
  const profileId = asText(payload.profileId);
  const expiresAt = Date.parse(asText(payload.expiresAt));
  if (!taskSessionId || !userId || !profileId || !Number.isFinite(expiresAt)) {
    throw new Error('internal MCP 运行时鉴权上下文无效');
  }
  if (expiresAt < Date.now()) {
    throw new Error('internal MCP 运行时鉴权上下文已过期');
  }
  return {
    connectorKey,
    taskSessionId,
    userId,
    profileId,
    issuedAt: asText(payload.issuedAt),
    expiresAt: new Date(expiresAt).toISOString(),
  };
}
