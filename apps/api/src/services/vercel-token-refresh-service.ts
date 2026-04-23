import { userConnectorProfileDAO } from '../db/dao';
import { connectorSecretService } from './connector-secret-service';
import {
  connectorRegistry,
  type ConnectorAccountSecret,
} from './connector-registry';
import { userConnectorService } from './user-connector-service';

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveExpiresAt(tokenPayload: Record<string, unknown>, existing?: ConnectorAccountSecret | null): string | undefined {
  const expiresAt = asText(tokenPayload.expires_at);
  if (expiresAt) return expiresAt;

  const expiresInRaw = Number(tokenPayload.expires_in);
  if (Number.isFinite(expiresInRaw) && expiresInRaw > 0) {
    return new Date(Date.now() + expiresInRaw * 1000).toISOString();
  }

  return asText(existing?.expiresAt) || undefined;
}

function shouldRefreshNow(secret: ConnectorAccountSecret | null | undefined): boolean {
  const expiresAt = Date.parse(asText(secret?.expiresAt));
  if (!Number.isFinite(expiresAt)) return false;
  return expiresAt <= Date.now() + 60_000;
}

async function fetchJson(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, init);
  const text = await response.text();
  let payload: Record<string, unknown> = {};
  if (text) {
    try {
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
      payload = { raw: text };
    }
  }
  if (!response.ok) {
    throw new Error(
      asText(payload.error_description) ||
        asText(payload.error) ||
        asText(payload.message) ||
        `vercel token request failed: ${response.status}`
    );
  }
  return payload;
}

export class VercelTokenRefreshService {
  async getActiveAccessToken(input: { userId: string; profileId: string }): Promise<string> {
    const profile = await userConnectorService.getProfileMaterial(input.userId, input.profileId);
    if (!profile || profile.connectorKey !== 'vercel') {
      throw new Error('Vercel connector profile 不存在');
    }
    const secret = profile.secret || null;
    const accessToken = asText(secret?.accessToken);
    if (accessToken && !shouldRefreshNow(secret)) {
      return accessToken;
    }
    if (!asText(secret?.refreshToken)) {
      if (accessToken) {
        return accessToken;
      }
      throw new Error('Vercel connector 缺少 refresh token，需要重新授权');
    }
    return this.refreshAccessToken(input);
  }

  async refreshAccessToken(input: { userId: string; profileId: string }): Promise<string> {
    const row = await userConnectorProfileDAO.getByIdAndUser(input.profileId, input.userId);
    if (!row || row.connectorKey !== 'vercel') {
      throw new Error('Vercel connector profile 不存在');
    }

    const secret =
      connectorSecretService.decryptJson<ConnectorAccountSecret>(row.secretCiphertext, 'vercel');
    const refreshToken = asText(secret?.refreshToken);
    if (!refreshToken) {
      await userConnectorService.markProfileNeedsAuth(input.userId, input.profileId, {
        lastError: 'Vercel connector 缺少 refresh token，需要重新授权',
      });
      throw new Error('Vercel connector 缺少 refresh token，需要重新授权');
    }

    const provider = connectorRegistry.getOauthProvider('vercel');
    if (!provider) {
      throw new Error('Vercel OAuth provider 未配置');
    }

    try {
      const tokenPayload = await fetchJson(provider.tokenUrl, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: provider.clientId,
          client_secret: provider.clientSecret,
        }).toString(),
      });

      const nextAccessToken = asText(tokenPayload.access_token);
      if (!nextAccessToken) {
        throw new Error('Vercel refresh 响应未返回 access_token');
      }

      const nextSecret: ConnectorAccountSecret = {
        accessToken: nextAccessToken,
        refreshToken: asText(tokenPayload.refresh_token) || refreshToken,
        tokenType: asText(tokenPayload.token_type) || asText(secret?.tokenType) || undefined,
        scope: asText(tokenPayload.scope) || asText(secret?.scope) || undefined,
        expiresAt: resolveExpiresAt(tokenPayload, secret),
      };

      await userConnectorProfileDAO.update(input.profileId, input.userId, {
        authMode: 'oauth',
        authStatus: 'authorized',
        secretCiphertext: connectorSecretService.encrypt(nextSecret, 'vercel'),
        lastAuthAt: new Date(),
        lastError: null,
      } as any);

      return nextAccessToken;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await userConnectorService.markProfileNeedsAuth(input.userId, input.profileId, {
        lastError: message,
      });
      throw error;
    }
  }
}

export const vercelTokenRefreshService = new VercelTokenRefreshService();
