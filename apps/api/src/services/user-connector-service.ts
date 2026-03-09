import { randomUUID } from 'node:crypto';
import {
  connectorAuthRequestDAO,
  userConnectorAccountDAO,
} from '../db/dao';
import { connectorSecretService } from './connector-secret-service';
import { connectorStorageBootstrap } from './connector-storage-bootstrap';
import {
  type ConnectorAccountMaterial,
  type ConnectorAccountSecret,
  type ConnectorAuthStatus,
  type ConnectorCatalogItem,
  type ConnectorKey,
  connectorRegistry,
} from './connector-registry';

type UserConnectorAccountView = {
  connectorKey: ConnectorKey;
  authMode: string;
  authStatus: string;
  displayName?: string | null;
  config: Record<string, unknown>;
  secretSummary?: string | null;
  lastAuthAt?: string | null;
  updatedAt?: string | null;
  lastError?: string | null;
};

type SaveConnectorInput = {
  displayName?: string;
  config?: Record<string, unknown>;
  credentials?: Record<string, unknown>;
};

type StartOauthInput = {
  redirectUri: string;
  returnToSessionId?: string;
};

type CompleteOauthInput = {
  state: string;
  code: string;
  redirectUri: string;
};

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const text = asText(value);
  if (!text) return null;
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

function pickObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
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
      (typeof payload.error === 'string' && payload.error) ||
        (typeof payload.message === 'string' && payload.message) ||
        `oauth request failed: ${response.status}`
    );
  }
  return payload;
}

function buildAccountView(
  catalogItem: ConnectorCatalogItem,
  row?: {
    connectorKey: string;
    authMode: string;
    authStatus: string;
    displayName: string | null;
    configJson: Record<string, unknown> | null;
    secretCiphertext: string | null;
    lastAuthAt: Date | null;
    updatedAt: Date;
    lastError: string | null;
  } | null
): UserConnectorAccountView {
  const secret = row?.secretCiphertext
    ? connectorSecretService.decryptJson<ConnectorAccountSecret>(row.secretCiphertext)
    : null;
  return {
    connectorKey: catalogItem.key,
    authMode: row?.authMode || catalogItem.authMode,
    authStatus: row?.authStatus || (catalogItem.available ? 'not_configured' : 'unavailable'),
    displayName: row?.displayName || null,
    config: pickObject(row?.configJson),
    secretSummary: connectorSecretService.summarize(secret),
    lastAuthAt: toIso(row?.lastAuthAt),
    updatedAt: toIso(row?.updatedAt),
    lastError: row?.lastError || null,
  };
}

function buildSecretPayload(
  connectorKey: ConnectorKey,
  credentials: Record<string, unknown>,
  existing?: ConnectorAccountSecret | null
): ConnectorAccountSecret | null {
  const current = existing || {};
  if (connectorKey === 'postgres') {
    const dsn = asText(credentials.dsn) || asText(current.dsn);
    return dsn ? { dsn } : null;
  }
  const accessToken = asText(credentials.accessToken) || asText(current.accessToken);
  if (!accessToken) return null;
  return {
    accessToken,
    refreshToken: asText(credentials.refreshToken) || asText(current.refreshToken) || undefined,
    tokenType: asText(credentials.tokenType) || asText(current.tokenType) || undefined,
    scope: asText(credentials.scope) || asText(current.scope) || undefined,
  };
}

function sanitizeConfig(
  connectorKey: ConnectorKey,
  config: Record<string, unknown>,
  displayName?: string
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config || {})) {
    if (value === undefined) continue;
    if (key === 'dsn' || key === 'accessToken' || key === 'refreshToken') continue;
    next[key] = value;
  }
  if (connectorKey === 'postgres' && displayName) {
    next.displayName = displayName;
  }
  return next;
}

function resolveAuthStatus(
  catalogItem: ConnectorCatalogItem,
  secret: ConnectorAccountSecret | null,
  explicitStatus?: string
): ConnectorAuthStatus {
  if (!catalogItem.available) return 'unavailable';
  if (explicitStatus === 'error') return 'error';
  if (secret?.accessToken || secret?.dsn) return 'authorized';
  if (catalogItem.oauth?.supported) return 'needs_auth';
  return 'not_configured';
}

async function resolveGithubProfile(accessToken: string): Promise<{ displayName?: string }> {
  const payload = await fetchJson('https://api.github.com/user', {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'oneceo-connectors',
    },
  });
  return {
    displayName:
      asText(payload.login) ||
      asText(payload.name) ||
      undefined,
  };
}

async function resolveDisplayNameForSave(input: {
  connectorKey: ConnectorKey;
  secret: ConnectorAccountSecret | null;
  fallbackDisplayName?: string;
}): Promise<string | undefined> {
  const fallback = asText(input.fallbackDisplayName) || undefined;
  if (input.connectorKey !== 'github') {
    return fallback;
  }
  const accessToken = asText(input.secret?.accessToken);
  if (!accessToken) {
    return fallback;
  }
  const profile = await resolveGithubProfile(accessToken);
  return profile.displayName || fallback;
}

export class UserConnectorService {
  async listCatalog() {
    return connectorRegistry.listCatalog();
  }

  async listUserAccounts(userId: string) {
    await connectorStorageBootstrap.ensureReady();
    const [catalog, rows] = await Promise.all([
      Promise.resolve(connectorRegistry.listCatalog()),
      userConnectorAccountDAO.listByUserId(userId),
    ]);
    const rowMap = new Map(rows.map((row) => [row.connectorKey, row]));
    return catalog.map((item) => buildAccountView(item, rowMap.get(item.key) as any));
  }

  async getUserAccount(userId: string, connectorKey: ConnectorKey) {
    await connectorStorageBootstrap.ensureReady();
    const catalogItem = connectorRegistry.getCatalogItem(connectorKey);
    const row = await userConnectorAccountDAO.getByUserAndConnectorKey(userId, connectorKey);
    return buildAccountView(catalogItem, row as any);
  }

  async getAccountMaterial(userId: string, connectorKey: ConnectorKey): Promise<ConnectorAccountMaterial | null> {
    await connectorStorageBootstrap.ensureReady();
    const row = await userConnectorAccountDAO.getByUserAndConnectorKey(userId, connectorKey);
    if (!row) return null;
    return {
      connectorKey,
      authMode: row.authMode,
      authStatus: row.authStatus,
      displayName: row.displayName,
      configJson: pickObject(row.configJson),
      secret: row.secretCiphertext
        ? connectorSecretService.decryptJson<ConnectorAccountSecret>(row.secretCiphertext)
        : null,
    };
  }

  async saveUserConnector(
    userId: string,
    connectorKey: ConnectorKey,
    input: SaveConnectorInput
  ) {
    await connectorStorageBootstrap.ensureReady();
    const catalogItem = connectorRegistry.getCatalogItem(connectorKey);
    const existing = await userConnectorAccountDAO.getByUserAndConnectorKey(userId, connectorKey);
    const existingSecret = existing?.secretCiphertext
      ? connectorSecretService.decryptJson<ConnectorAccountSecret>(existing.secretCiphertext)
      : null;
    const config = pickObject(input.config);
    const credentials = pickObject(input.credentials);
    const displayName = asText(input.displayName) || asText(config.displayName) || existing?.displayName || '';
    const secret = buildSecretPayload(connectorKey, credentials, existingSecret);
    if (catalogItem.authMode === 'dsn' && !secret?.dsn) {
      throw new Error('Postgres 连接器需要提供 DSN');
    }
    const resolvedDisplayName = await resolveDisplayNameForSave({
      connectorKey,
      secret,
      fallbackDisplayName: displayName,
    });
    const authStatus = resolveAuthStatus(catalogItem, secret, existing?.authStatus);
    const saved = await userConnectorAccountDAO.upsert({
      userId,
      connectorKey,
      authMode: catalogItem.authMode,
      authStatus,
      displayName: resolvedDisplayName || null,
      configJson: sanitizeConfig(connectorKey, config, resolvedDisplayName),
      secretCiphertext: connectorSecretService.encrypt(secret),
      lastAuthAt: authStatus === 'authorized' ? new Date() : existing?.lastAuthAt || null,
      lastError: null,
    });
    return buildAccountView(catalogItem, saved as any);
  }

  async clearConnectorAuth(userId: string, connectorKey: ConnectorKey) {
    await connectorStorageBootstrap.ensureReady();
    const catalogItem = connectorRegistry.getCatalogItem(connectorKey);
    const existing = await userConnectorAccountDAO.getByUserAndConnectorKey(userId, connectorKey);
    const saved = await userConnectorAccountDAO.upsert({
      userId,
      connectorKey,
      authMode: catalogItem.authMode,
      authStatus: catalogItem.available ? 'not_configured' : 'unavailable',
      displayName: existing?.displayName || null,
      configJson: pickObject(existing?.configJson),
      secretCiphertext: null,
      lastAuthAt: null,
      lastError: null,
    });
    return buildAccountView(catalogItem, saved as any);
  }

  async startOAuth(userId: string, connectorKey: ConnectorKey, input: StartOauthInput) {
    await connectorStorageBootstrap.ensureReady();
    const provider = connectorRegistry.getOauthProvider(connectorKey);
    if (!provider) {
      throw new Error('当前连接器未配置 OAuth');
    }
    const state = randomUUID();
    const requestId = randomUUID();
    await connectorAuthRequestDAO.create({
      requestId,
      userId,
      connectorKey,
      provider: provider.provider,
      state,
      codeVerifier: randomUUID(),
      returnToSessionId: asText(input.returnToSessionId) || null,
      status: 'pending',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });
    const authUrl = new URL(provider.authorizationUrl);
    authUrl.searchParams.set('client_id', provider.clientId);
    authUrl.searchParams.set('redirect_uri', input.redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('state', state);
    const scopeParam = provider.scopeParam || 'scope';
    if (provider.scopes.length > 0) {
      authUrl.searchParams.set(scopeParam, provider.scopes.join(' '));
    }
    for (const [key, value] of Object.entries(provider.authorizationExtraParams || {})) {
      authUrl.searchParams.set(key, value);
    }
    return {
      requestId,
      state,
      authUrl: authUrl.toString(),
    };
  }

  async completeOAuth(userId: string, connectorKey: ConnectorKey, input: CompleteOauthInput) {
    await connectorStorageBootstrap.ensureReady();
    const provider = connectorRegistry.getOauthProvider(connectorKey);
    if (!provider) {
      throw new Error('当前连接器未配置 OAuth');
    }
    const request = await connectorAuthRequestDAO.getByState(input.state);
    if (!request || request.userId !== userId || request.connectorKey !== connectorKey) {
      throw new Error('OAuth 请求不存在或不属于当前用户');
    }
    if (request.expiresAt && request.expiresAt.getTime() < Date.now()) {
      await connectorAuthRequestDAO.markFailedByState(input.state, 'expired');
      throw new Error('OAuth 请求已过期');
    }

    try {
      const body: Record<string, string> = {
        code: input.code,
        redirect_uri: input.redirectUri,
      };
      if (provider.tokenClientAuth !== 'basic') {
        body.client_id = provider.clientId;
        body.client_secret = provider.clientSecret;
      }
      for (const [key, value] of Object.entries(provider.tokenExtraParams || {})) {
        body[key] = value;
      }

      const headers: Record<string, string> = {
        Accept: 'application/json',
      };
      let payload: string;
      if (provider.tokenRequestBodyFormat === 'json') {
        headers['Content-Type'] = 'application/json';
        payload = JSON.stringify(body);
      } else {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        payload = new URLSearchParams(body).toString();
      }
      if (provider.tokenClientAuth === 'basic') {
        headers.Authorization = `Basic ${Buffer.from(
          `${provider.clientId}:${provider.clientSecret}`,
          'utf8'
        ).toString('base64')}`;
      }

      const tokenPayload = await fetchJson(provider.tokenUrl, {
        method: 'POST',
        headers,
        body: payload,
      });
      const accessToken = asText(tokenPayload.access_token);
      if (!accessToken) {
        throw new Error('OAuth 回调未返回 access_token');
      }
      let displayName =
        asText((tokenPayload.team as Record<string, unknown> | undefined)?.name) ||
        asText(tokenPayload.workspace_name) ||
        '';

      if (connectorKey === 'github') {
        const profile = await resolveGithubProfile(accessToken);
        displayName = profile.displayName || displayName;
      }

      const secret: ConnectorAccountSecret = {
        accessToken,
        refreshToken: asText(tokenPayload.refresh_token) || undefined,
        tokenType: asText(tokenPayload.token_type) || undefined,
        scope: asText(tokenPayload.scope) || undefined,
      };

      await connectorAuthRequestDAO.markCompleted(request.requestId, 'completed');
      const saved = await userConnectorAccountDAO.upsert({
        userId,
        connectorKey,
        authMode: 'oauth',
        authStatus: 'authorized',
        displayName: displayName || null,
        configJson: {},
        secretCiphertext: connectorSecretService.encrypt(secret),
        lastAuthAt: new Date(),
        lastError: null,
      });

      return {
        account: buildAccountView(connectorRegistry.getCatalogItem(connectorKey), saved as any),
        returnToSessionId: request.returnToSessionId || null,
      };
    } catch (error) {
      await connectorAuthRequestDAO.markFailedByState(input.state, 'failed');
      throw error;
    }
  }
}

export const userConnectorService = new UserConnectorService();
