import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  connectorAuthRequestDAO,
  userConnectorProfileDAO,
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

type UserConnectorProfileView = {
  profileId: string;
  connectorKey: ConnectorKey;
  profileName: string;
  authMode: string;
  authStatus: string;
  displayName?: string | null;
  config: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  secretSummary?: string | null;
  isDefault: boolean;
  lastAuthAt?: string | null;
  updatedAt?: string | null;
  lastError?: string | null;
};

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
  defaultProfileId?: string | null;
  defaultProfileName?: string | null;
  profilesCount?: number;
};

type SaveConnectorInput = {
  profileName?: string;
  displayName?: string;
  config?: Record<string, unknown>;
  credentials?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
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

function base64Url(input: Buffer): string {
  return input
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(48));
  const challenge = base64Url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
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

function buildProfileView(
  row: {
    id: string;
    connectorKey: string;
    profileName: string;
    authMode: string;
    authStatus: string;
    displayName: string | null;
    configJson: Record<string, unknown> | null;
    metadataJson?: Record<string, unknown> | null;
    secretCiphertext: string | null;
    isDefault: boolean;
    lastAuthAt: Date | null;
    updatedAt: Date;
    lastError: string | null;
  }
): UserConnectorProfileView {
  const secret = row.secretCiphertext
    ? connectorSecretService.decryptJson<ConnectorAccountSecret>(row.secretCiphertext)
    : null;
  return {
    profileId: row.id,
    connectorKey: row.connectorKey as ConnectorKey,
    profileName: row.profileName,
    authMode: row.authMode,
    authStatus: row.authStatus,
    displayName: row.displayName || null,
    config: pickObject(row.configJson),
    metadata: pickObject(row.metadataJson),
    secretSummary: connectorSecretService.summarize(secret),
    isDefault: Boolean(row.isDefault),
    lastAuthAt: toIso(row.lastAuthAt),
    updatedAt: toIso(row.updatedAt),
    lastError: row.lastError || null,
  };
}

function summarizeProfiles(
  catalogItem: ConnectorCatalogItem,
  profiles: UserConnectorProfileView[]
): UserConnectorAccountView {
  const defaultProfile = profiles.find((item) => item.isDefault) || profiles[0];
  return {
    connectorKey: catalogItem.key,
    authMode: defaultProfile?.authMode || catalogItem.authMode,
    authStatus:
      defaultProfile?.authStatus || (catalogItem.available ? 'not_configured' : 'unavailable'),
    displayName: defaultProfile?.displayName || null,
    config: defaultProfile?.config || {},
    secretSummary: defaultProfile?.secretSummary || null,
    lastAuthAt: defaultProfile?.lastAuthAt || null,
    updatedAt: defaultProfile?.updatedAt || null,
    lastError: defaultProfile?.lastError || null,
    defaultProfileId: defaultProfile?.profileId || null,
    defaultProfileName: defaultProfile?.profileName || null,
    profilesCount: profiles.length,
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

async function resolveVercelProfile(accessToken: string): Promise<{ displayName?: string }> {
  const payload = await fetchJson('https://api.vercel.com/www/user', {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'oneceo-connectors',
    },
  });
  const user =
    payload.user && typeof payload.user === 'object'
      ? (payload.user as Record<string, unknown>)
      : payload;
  return {
    displayName:
      asText(user.username) || asText(user.name) || asText(user.email) || undefined,
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
    if (
      key === 'dsn' ||
      key === 'accessToken' ||
      key === 'refreshToken' ||
      key === 'profileName' ||
      key === 'displayName'
    ) {
      continue;
    }
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
  if (!catalogItem.available && !catalogItem.deprecated) return 'unavailable';
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
    displayName: asText(payload.login) || asText(payload.name) || undefined,
  };
}

async function resolveGithubInstallationCount(accessToken: string): Promise<number> {
  const payload = await fetchJson('https://api.github.com/user/installations', {
    method: 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'oneceo-connectors',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  const totalCount = Number(payload.total_count || 0);
  if (!Number.isFinite(totalCount)) {
    throw new Error('GitHub 安装状态返回格式无效');
  }
  return totalCount;
}

async function revokeGithubOauthGrant(accessToken: string): Promise<void> {
  const provider = connectorRegistry.getOauthProvider('github');
  if (!provider) {
    throw new Error('GitHub OAuth provider 未配置');
  }

  let response: Response;
  try {
    response = await fetch(
      `https://api.github.com/applications/${encodeURIComponent(provider.clientId)}/grant`,
      {
        method: 'DELETE',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Basic ${Buffer.from(
            `${provider.clientId}:${provider.clientSecret}`,
            'utf8'
          ).toString('base64')}`,
          'Content-Type': 'application/json',
          'User-Agent': 'oneceo-connectors',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({
          access_token: accessToken,
        }),
        signal: AbortSignal.timeout(3000),
      }
    );
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error('GitHub 撤销授权超时，请稍后重试');
    }
    throw error;
  }

  if (response.status === 204) {
    return;
  }

  const text = await response.text();
  let payload: Record<string, unknown> = {};
  if (text) {
    try {
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
      payload = { raw: text };
    }
  }
  const message =
    asText(payload.message) ||
    asText(payload.error_description) ||
    asText(payload.error) ||
    `GitHub revoke grant failed: ${response.status}`;
  if (response.status === 404) {
    return;
  }
  throw new Error(message);
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

function ensureRequiredProfileName(profileName: string, connectorKey: ConnectorKey) {
  if (!profileName) {
    throw new Error(`${connectorKey} 连接器缺少 profile name`);
  }
}

function buildGithubProfileName(displayName?: string | null): string {
  const resolved = asText(displayName);
  return resolved ? `GitHub · ${resolved}` : 'GitHub';
}

export class UserConnectorService {
  async listCatalog() {
    return connectorRegistry.listVisibleCatalog();
  }

  async listAllCatalog() {
    return connectorRegistry.listCatalog();
  }

  async listUserProfiles(userId: string) {
    await connectorStorageBootstrap.ensureReady();
    const profiles = await userConnectorProfileDAO.listByUserId(userId);
    const visibleKeys = new Set(connectorRegistry.listVisibleCatalog().map((item) => item.key));
    return profiles
      .filter((row) => visibleKeys.has(row.connectorKey as ConnectorKey))
      .map((row) => buildProfileView(row as any));
  }

  async getProfile(userId: string, profileId: string) {
    await connectorStorageBootstrap.ensureReady();
    const row = await userConnectorProfileDAO.getByIdAndUser(profileId, userId);
    if (!row) {
      throw new Error('连接器 profile 不存在');
    }
    return buildProfileView(row as any);
  }

  async getProfileMaterial(userId: string, profileId: string): Promise<ConnectorAccountMaterial | null> {
    await connectorStorageBootstrap.ensureReady();
    const row = await userConnectorProfileDAO.getByIdAndUser(profileId, userId);
    if (!row) return null;
    return {
      profileId: row.id,
      connectorKey: row.connectorKey as ConnectorKey,
      profileName: row.profileName,
      authMode: row.authMode,
      authStatus: row.authStatus,
      displayName: row.displayName,
      configJson: pickObject(row.configJson),
      metadataJson: pickObject(row.metadataJson),
      secret: row.secretCiphertext
        ? connectorSecretService.decryptJson<ConnectorAccountSecret>(row.secretCiphertext)
        : null,
    };
  }

  async listUserAccounts(userId: string) {
    await connectorStorageBootstrap.ensureReady();
    const [catalog, profiles] = await Promise.all([
      Promise.resolve(connectorRegistry.listCatalog()),
      userConnectorProfileDAO.listByUserId(userId),
    ]);
    const profilesByKey = new Map<ConnectorKey, UserConnectorProfileView[]>();
    for (const row of profiles) {
      const key = row.connectorKey as ConnectorKey;
      const items = profilesByKey.get(key) || [];
      items.push(buildProfileView(row as any));
      profilesByKey.set(key, items);
    }
    return catalog.map((item) => summarizeProfiles(item, profilesByKey.get(item.key) || []));
  }

  async getUserAccount(userId: string, connectorKey: ConnectorKey) {
    await connectorStorageBootstrap.ensureReady();
    const catalogItem = connectorRegistry.getCatalogItem(connectorKey);
    const rows = await userConnectorProfileDAO.listByUserAndConnectorKey(userId, connectorKey);
    return summarizeProfiles(
      catalogItem,
      rows.map((row) => buildProfileView(row as any))
    );
  }

  async getDefaultOrFirstProfile(userId: string, connectorKey: ConnectorKey) {
    await connectorStorageBootstrap.ensureReady();
    const rows = await userConnectorProfileDAO.listByUserAndConnectorKey(userId, connectorKey);
    const items = rows.map((row) => buildProfileView(row as any));
    return items.find((item) => item.isDefault) || items[0] || null;
  }

  async getAccountMaterial(userId: string, connectorKey: ConnectorKey): Promise<ConnectorAccountMaterial | null> {
    const profile = await this.getDefaultOrFirstProfile(userId, connectorKey);
    if (!profile) return null;
    return this.getProfileMaterial(userId, profile.profileId);
  }

  private async saveProfileInternal(
    userId: string,
    connectorKey: ConnectorKey,
    existingProfileId: string | null,
    input: SaveConnectorInput
  ) {
    await connectorStorageBootstrap.ensureReady();
    const catalogItem = connectorRegistry.getCatalogItem(connectorKey);
    const existing = existingProfileId
      ? await userConnectorProfileDAO.getByIdAndUser(existingProfileId, userId)
      : null;
    const existingSecret = existing?.secretCiphertext
      ? connectorSecretService.decryptJson<ConnectorAccountSecret>(existing.secretCiphertext)
      : null;
    const config = pickObject(input.config);
    const credentials = pickObject(input.credentials);
    const metadata = pickObject(input.metadata);
    const displayName =
      asText(input.displayName) || asText(config.displayName) || asText(existing?.displayName) || '';
    const secret = buildSecretPayload(connectorKey, credentials, existingSecret);
    if (catalogItem.authMode === 'dsn' && !secret?.dsn) {
      throw new Error('Postgres 连接器需要提供 DSN');
    }
    if (catalogItem.authMode === 'token' && !catalogItem.oauth?.supported && connectorKey !== 'postgres' && !secret?.accessToken) {
      throw new Error(`${catalogItem.name} 连接器需要提供 access token`);
    }
    const resolvedDisplayName = await resolveDisplayNameForSave({
      connectorKey,
      secret,
      fallbackDisplayName: displayName,
    });
    const profileNameCandidate =
      asText(input.profileName) ||
      asText(config.profileName) ||
      asText(existing?.profileName) ||
      (connectorKey === 'github'
        ? buildGithubProfileName(resolvedDisplayName)
        : `${catalogItem.name} Default`);
    const profileName =
      connectorKey === 'github'
        ? profileNameCandidate || buildGithubProfileName(resolvedDisplayName)
        : profileNameCandidate;
    ensureRequiredProfileName(profileName, connectorKey);
    const authStatus = resolveAuthStatus(catalogItem, secret, existing?.authStatus);

    let saved;
    if (!existing) {
      const currentProfiles = await userConnectorProfileDAO.listByUserAndConnectorKey(userId, connectorKey);
      const isDefault = currentProfiles.length === 0;
      saved = await userConnectorProfileDAO.create({
        userId,
        connectorKey,
        profileName,
        authMode: catalogItem.authMode,
        authStatus,
        displayName: resolvedDisplayName || null,
        configJson: sanitizeConfig(connectorKey, config, resolvedDisplayName),
        secretCiphertext: connectorSecretService.encrypt(secret),
        metadataJson: metadata,
        isDefault,
        lastAuthAt: authStatus === 'authorized' ? new Date() : null,
        lastError: null,
      } as any);
    } else {
      saved = await userConnectorProfileDAO.update(existing.id, userId, {
        profileName,
        authMode: catalogItem.authMode,
        authStatus,
        displayName: resolvedDisplayName || null,
        configJson: sanitizeConfig(connectorKey, config, resolvedDisplayName),
        secretCiphertext: connectorSecretService.encrypt(secret),
        metadataJson: metadata,
        lastAuthAt: authStatus === 'authorized' ? new Date() : existing.lastAuthAt || null,
        lastError: null,
      } as any);
    }
    if (!saved) {
      throw new Error('保存连接器 profile 失败');
    }
    return buildProfileView(saved as any);
  }

  async createProfile(userId: string, connectorKey: ConnectorKey, input: SaveConnectorInput) {
    return this.saveProfileInternal(userId, connectorKey, null, input);
  }

  async updateProfile(userId: string, profileId: string, input: SaveConnectorInput) {
    const existing = await userConnectorProfileDAO.getByIdAndUser(profileId, userId);
    if (!existing) {
      throw new Error('连接器 profile 不存在');
    }
    return this.saveProfileInternal(userId, existing.connectorKey as ConnectorKey, profileId, input);
  }

  async deleteProfile(userId: string, profileId: string) {
    await connectorStorageBootstrap.ensureReady();
    const existing = await userConnectorProfileDAO.getByIdAndUser(profileId, userId);
    if (!existing) {
      throw new Error('连接器 profile 不存在');
    }
    await userConnectorProfileDAO.delete(profileId, userId);
    if (existing.isDefault) {
      const remaining = await userConnectorProfileDAO.listByUserAndConnectorKey(
        userId,
        existing.connectorKey
      );
      const nextDefault = remaining[0];
      if (nextDefault) {
        await userConnectorProfileDAO.clearDefaultForConnector(userId, existing.connectorKey);
        await userConnectorProfileDAO.update(nextDefault.id, userId, { isDefault: true } as any);
      }
    }
    return true;
  }

  async setDefaultProfile(userId: string, profileId: string) {
    await connectorStorageBootstrap.ensureReady();
    const existing = await userConnectorProfileDAO.getByIdAndUser(profileId, userId);
    if (!existing) {
      throw new Error('连接器 profile 不存在');
    }
    await userConnectorProfileDAO.clearDefaultForConnector(userId, existing.connectorKey);
    const saved = await userConnectorProfileDAO.update(profileId, userId, { isDefault: true } as any);
    if (!saved) {
      throw new Error('设置默认 profile 失败');
    }
    return buildProfileView(saved as any);
  }

  async clearProfileAuth(userId: string, profileId: string) {
    await connectorStorageBootstrap.ensureReady();
    const existing = await userConnectorProfileDAO.getByIdAndUser(profileId, userId);
    if (!existing) {
      throw new Error('连接器 profile 不存在');
    }
    let remoteGrantRevoked = true;
    let remoteGrantError: string | null = null;
    if (existing.connectorKey === 'github' && existing.secretCiphertext) {
      const secret = connectorSecretService.decryptJson<ConnectorAccountSecret>(existing.secretCiphertext);
      const accessToken = asText(secret?.accessToken);
      if (accessToken) {
        try {
          await revokeGithubOauthGrant(accessToken);
        } catch (error) {
          remoteGrantRevoked = false;
          remoteGrantError = error instanceof Error ? error.message : String(error);
        }
      }
    }
    const catalogItem = connectorRegistry.getCatalogItem(existing.connectorKey);
    const saved = await userConnectorProfileDAO.update(profileId, userId, {
      authMode: catalogItem.authMode,
      authStatus: catalogItem.available ? 'not_configured' : 'unavailable',
      secretCiphertext: null,
      lastAuthAt: null,
      lastError: null,
    } as any);
    if (!saved) {
      throw new Error('断开连接器授权失败');
    }
    return {
      profile: buildProfileView(saved as any),
      remoteGrantRevoked,
      remoteGrantError,
    };
  }

  async markProfileNeedsAuth(
    userId: string,
    profileId: string,
    input?: {
      lastError?: string | null;
      clearSecret?: boolean;
    }
  ) {
    await connectorStorageBootstrap.ensureReady();
    const existing = await userConnectorProfileDAO.getByIdAndUser(profileId, userId);
    if (!existing) {
      throw new Error('连接器 profile 不存在');
    }
    const catalogItem = connectorRegistry.getCatalogItem(existing.connectorKey);
    const saved = await userConnectorProfileDAO.update(profileId, userId, {
      authMode: catalogItem.authMode,
      authStatus: catalogItem.available ? 'needs_auth' : 'unavailable',
      secretCiphertext: input?.clearSecret === false ? existing.secretCiphertext : null,
      lastError: asText(input?.lastError) || '授权已失效，需要重新授权',
    } as any);
    if (!saved) {
      throw new Error('更新连接器授权状态失败');
    }
    return buildProfileView(saved as any);
  }

  async startOAuthForProfile(userId: string, profileId: string, input: StartOauthInput) {
    await connectorStorageBootstrap.ensureReady();
    const profile = await userConnectorProfileDAO.getByIdAndUser(profileId, userId);
    if (!profile) {
      throw new Error('连接器 profile 不存在');
    }
    const connectorKey = profile.connectorKey as ConnectorKey;
    const provider = connectorRegistry.getOauthProvider(connectorKey);
    if (!provider) {
      throw new Error('当前连接器未配置 OAuth');
    }
    const state = randomUUID();
    const requestId = randomUUID();
    const pkce = provider.pkceMethod === 'S256' ? createPkcePair() : null;
    await connectorAuthRequestDAO.create({
      requestId,
      userId,
      connectorKey,
      profileId,
      provider: provider.provider,
      state,
      codeVerifier: pkce?.verifier || null,
      returnToSessionId: asText(input.returnToSessionId) || null,
      status: 'pending',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    } as any);
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
    if (provider.pkceMethod === 'S256' && pkce) {
      authUrl.searchParams.set('code_challenge_method', 'S256');
      authUrl.searchParams.set('code_challenge', pkce.challenge);
    }
    return {
      requestId,
      state,
      authUrl: authUrl.toString(),
    };
  }

  async completeOAuthByProfile(userId: string, profileId: string, input: CompleteOauthInput) {
    await connectorStorageBootstrap.ensureReady();
    const profile = await userConnectorProfileDAO.getByIdAndUser(profileId, userId);
    if (!profile) {
      throw new Error('连接器 profile 不存在');
    }
    const connectorKey = profile.connectorKey as ConnectorKey;
    const provider = connectorRegistry.getOauthProvider(connectorKey);
    if (!provider) {
      throw new Error('当前连接器未配置 OAuth');
    }
    const request = await connectorAuthRequestDAO.getByState(input.state);
    if (
      !request ||
      request.userId !== userId ||
      request.connectorKey !== connectorKey ||
      asText(request.profileId) !== profileId
    ) {
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
      if (provider.pkceMethod === 'S256') {
        const codeVerifier = asText(request.codeVerifier);
        if (!codeVerifier) {
          throw new Error('OAuth 请求缺少 PKCE code_verifier');
        }
        body.code_verifier = codeVerifier;
      }
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
        asText(profile.displayName) ||
        '';
      let profileName = asText(profile.profileName) || buildGithubProfileName(displayName);

      const secret: ConnectorAccountSecret = {
        accessToken,
        refreshToken: asText(tokenPayload.refresh_token) || undefined,
        tokenType: asText(tokenPayload.token_type) || undefined,
        scope: asText(tokenPayload.scope) || undefined,
      };

      let authStatus: ConnectorAuthStatus = 'authorized';
      let lastError: string | null = null;
      let secretCiphertext = connectorSecretService.encrypt(secret);
      let lastAuthAt: Date | null = new Date();

      if (connectorKey === 'github') {
        const [githubProfile, installationCount] = await Promise.all([
          resolveGithubProfile(accessToken),
          resolveGithubInstallationCount(accessToken),
        ]);
        displayName = githubProfile.displayName || displayName;
        if (!asText(profile.profileName) || profile.profileName === 'GitHub Default' || profile.profileName === 'GitHub') {
          profileName = buildGithubProfileName(displayName);
        }
        if (installationCount <= 0) {
          authStatus = 'needs_auth';
          lastError =
            'GitHub App 已授权，但当前账号下没有任何可用安装。请先在 GitHub 安装该 App 或批准安装更新后，再重新连接。';
          secretCiphertext = null;
          lastAuthAt = null;
        }
      } else if (connectorKey === 'vercel') {
        const vercelProfile = await resolveVercelProfile(accessToken);
        displayName = vercelProfile.displayName || displayName;
        if (!asText(profile.profileName) || profile.profileName === 'Vercel Default' || profile.profileName === 'Vercel') {
          profileName = displayName || 'Vercel';
        }
      }

      await connectorAuthRequestDAO.markCompleted(request.requestId, 'completed');
      const saved = await userConnectorProfileDAO.update(profileId, userId, {
        profileName,
        authMode: 'oauth',
        authStatus,
        displayName: displayName || profile.displayName || null,
        secretCiphertext,
        lastAuthAt,
        lastError,
      } as any);
      if (!saved) {
        throw new Error('OAuth 结果保存失败');
      }

      return {
        profile: buildProfileView(saved as any),
        returnToSessionId: request.returnToSessionId || null,
      };
    } catch (error) {
      await connectorAuthRequestDAO.markFailedByState(input.state, 'failed');
      throw error;
    }
  }

  // Backward-compatible helpers while callers migrate to profile endpoints.
  async saveUserConnector(userId: string, connectorKey: ConnectorKey, input: SaveConnectorInput) {
    const existing = await this.getDefaultOrFirstProfile(userId, connectorKey);
    if (existing) {
      return this.updateProfile(userId, existing.profileId, input);
    }
    const created = await this.createProfile(userId, connectorKey, {
      profileName: input.profileName || `${connectorRegistry.getCatalogItem(connectorKey).name} Default`,
      ...input,
    });
    return summarizeProfiles(connectorRegistry.getCatalogItem(connectorKey), [created]);
  }

  async clearConnectorAuth(userId: string, connectorKey: ConnectorKey) {
    const existing = await this.getDefaultOrFirstProfile(userId, connectorKey);
    if (!existing) {
      throw new Error('连接器 profile 不存在');
    }
    const cleared = await this.clearProfileAuth(userId, existing.profileId);
    return {
      account: summarizeProfiles(connectorRegistry.getCatalogItem(connectorKey), [cleared.profile]),
      remoteGrantRevoked: cleared.remoteGrantRevoked,
      remoteGrantError: cleared.remoteGrantError,
    };
  }

  async startOAuth(userId: string, connectorKey: ConnectorKey, input: StartOauthInput) {
    let profile = await this.getDefaultOrFirstProfile(userId, connectorKey);
    if (!profile) {
      profile = await this.createProfile(userId, connectorKey, {
        profileName: `${connectorRegistry.getCatalogItem(connectorKey).name} Default`,
      });
    }
    return this.startOAuthForProfile(userId, profile.profileId, input);
  }

  async completeOAuth(userId: string, connectorKey: ConnectorKey, input: CompleteOauthInput) {
    const request = await connectorAuthRequestDAO.getByState(input.state);
    if (!request || request.userId !== userId || request.connectorKey !== connectorKey || !request.profileId) {
      throw new Error('OAuth 请求不存在或不属于当前用户');
    }
    const result = await this.completeOAuthByProfile(userId, String(request.profileId), input);
    return {
      account: summarizeProfiles(connectorRegistry.getCatalogItem(connectorKey), [result.profile]),
      returnToSessionId: result.returnToSessionId,
    };
  }
}

export const userConnectorService = new UserConnectorService();
