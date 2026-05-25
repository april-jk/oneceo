import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  connectorAuthRequestDAO,
  userConnectorProfileDAO,
} from '../db/dao';
import { connectorSecretService } from './connector-secret-service';
import { connectorStorageBootstrap } from './connector-storage-bootstrap';
import { connectorRedisCacheService } from './connector-redis-cache-service';
import { composioConnectorService } from './composio-connector-service';
import { assertCustomApiEnabled } from './custom-api-feature-flag';
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
  teamId?: string;
  configurationId?: string;
  connectedAccountId?: string;
  status?: string;
  next?: string;
  source?: string;
};

type ConnectorMeSnapshot = {
  catalog: ConnectorCatalogItem[];
  profiles: UserConnectorProfileView[];
  cache: {
    hit: boolean;
    source: 'redis' | 'db';
    redisEnabled: boolean;
  };
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

function isVercelIntegrationProvider(provider: { authorizationMode?: string } | null | undefined) {
  return provider?.authorizationMode === 'vercel_integration';
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
  let secret: ConnectorAccountSecret | null = null;
  if (row.secretCiphertext) {
    try {
      secret = connectorSecretService.decryptJson<ConnectorAccountSecret>(
        row.secretCiphertext,
        row.connectorKey as ConnectorKey
      );
    } catch {
      secret = null;
    }
  }
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
  if (connectorKey === 'custom_api') {
    const accessToken =
      asText(credentials.accessToken) ||
      asText(credentials.apiKey) ||
      asText(credentials.token) ||
      asText(current.accessToken);
    const username = asText(credentials.username) || asText((current as any).username);
    const password = asText(credentials.password) || asText((current as any).password);
    const headerName = asText(credentials.headerName) || asText((current as any).headerName);
    if (!accessToken && (!username || !password)) return null;
    return {
      accessToken: accessToken || undefined,
      ...(headerName ? { headerName } : {}),
      ...(username ? { username } : {}),
      ...(password ? { password } : {}),
    } as ConnectorAccountSecret;
  }
  if (connectorKey === 'custom_mcp') {
    const headers =
      credentials.headers && typeof credentials.headers === 'object' && !Array.isArray(credentials.headers)
        ? (credentials.headers as Record<string, unknown>)
        : {};
    const customMcpHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      const headerName = asText(key);
      const headerValue = asText(value);
      if (headerName && headerValue) {
        customMcpHeaders[headerName] = headerValue;
      }
    }
    return {
      customMcpHeaders,
      accessToken: Object.keys(customMcpHeaders).length > 0 ? '__custom_mcp_headers__' : '__custom_mcp_no_auth__',
    } as ConnectorAccountSecret;
  }
  if (connectorKey === 'postgres') {
    const dsn = asText(credentials.dsn) || asText(current.dsn);
    return dsn ? { dsn } : null;
  }
  if (connectorRegistry.getCatalogItem(connectorKey).composio?.provider === 'composio') {
    return current.composioMcpUrl
      ? {
          source: 'composio',
          composioMcpUrl: current.composioMcpUrl,
          composioMcpHeaders: current.composioMcpHeaders,
        }
      : null;
  }
  const accessToken = asText(credentials.accessToken) || asText(current.accessToken);
  const refreshToken = asText(credentials.refreshToken) || asText(current.refreshToken);
  if (!accessToken && !refreshToken) return null;
  return {
    accessToken: accessToken || undefined,
    refreshToken: refreshToken || undefined,
    tokenType: asText(credentials.tokenType) || asText(current.tokenType) || undefined,
    scope: asText(credentials.scope) || asText(current.scope) || undefined,
    expiresAt: asText(credentials.expiresAt) || asText(current.expiresAt) || undefined,
  };
}

function calculateSecretExpiresAt(tokenPayload: Record<string, unknown>): string | undefined {
  const expiresAt = asText(tokenPayload.expires_at);
  if (expiresAt) return expiresAt;
  const expiresIn = Number(tokenPayload.expires_in);
  if (Number.isFinite(expiresIn) && expiresIn > 0) {
    return new Date(Date.now() + expiresIn * 1000).toISOString();
  }
  return undefined;
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
  if (secret?.accessToken || secret?.refreshToken || secret?.dsn || secret?.composioMcpUrl) return 'authorized';
  if (catalogItem.oauth?.supported) return 'needs_auth';
  return 'not_configured';
}

function ensureRequiredProfileName(profileName: string, connectorKey: ConnectorKey) {
  if (!profileName) {
    throw new Error(`${connectorKey} connector requires a profile name`);
  }
}

function buildGithubProfileName(displayName?: string | null): string {
  const resolved = asText(displayName);
  return resolved ? `GitHub - ${resolved}` : 'GitHub';
}

function buildDefaultProfileName(connectorKey: ConnectorKey, catalogName: string): string {
  if (connectorKey === 'supabase') {
    return 'Supabase Default';
  }
  return `${catalogName} Default`;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    const text = asText(item);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function mergeComposioConfig(
  connectorKey: ConnectorKey,
  currentConfig: Record<string, unknown>,
  metadata: Record<string, unknown>
): Record<string, unknown> {
  if (connectorKey !== 'github') return currentConfig;
  const repositories = asStringArray(metadata.composioRepositoryNames);
  if (repositories.length === 0) return currentConfig;
  return {
    ...currentConfig,
    repositories,
  };
}

type UserConnectorProfileRow = {
  id: string;
  userId?: string;
  connectorKey: string;
  profileName: string;
  displayName: string | null;
  authMode: string;
  authStatus: string;
  configJson: unknown;
  secretCiphertext: string | null;
  metadataJson?: unknown;
  isDefault: boolean;
  lastAuthAt: Date | null;
  lastError: string | null;
  updatedAt: Date;
};

const SLACK_COMPOSIO_REAUTH_MESSAGE =
  'Slack connector now requires Composio OAuth. Reconnect Slack through Composio.';
const GITHUB_COMPOSIO_REAUTH_MESSAGE =
  'GitHub connector now requires Composio OAuth. Reconnect GitHub through Composio.';
const SUPABASE_SECRET_REAUTH_MESSAGE =
  'Supabase connector now requires Composio OAuth. Reconnect Supabase through Composio.';

function mergeMetadata(
  current: Record<string, unknown> | null | undefined,
  patch: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...pickObject(current),
    ...patch,
  };
}

function decryptProfileSecret(row: UserConnectorProfileRow): ConnectorAccountSecret | null {
  if (!row.secretCiphertext) return null;
  try {
    return connectorSecretService.decryptJson<ConnectorAccountSecret>(
      row.secretCiphertext,
      row.connectorKey as ConnectorKey
    );
  } catch {
    return null;
  }
}

function shouldForceSlackComposioReconnect(row: UserConnectorProfileRow): boolean {
  if (row.connectorKey !== 'slack' || !row.secretCiphertext) {
    return false;
  }
  const metadata = pickObject(row.metadataJson);
  const secret = decryptProfileSecret(row);
  return !(
    asText(metadata.provider) === 'composio' &&
    asText(secret?.source) === 'composio' &&
    asText(secret?.composioMcpUrl)
  );
}

function shouldForceGithubComposioReconnect(row: UserConnectorProfileRow): boolean {
  if (row.connectorKey !== 'github' || !row.secretCiphertext) {
    return false;
  }
  const metadata = pickObject(row.metadataJson);
  const secret = decryptProfileSecret(row);
  return !(
    asText(metadata.provider) === 'composio' &&
    asText(secret?.source) === 'composio' &&
    asText(secret?.composioMcpUrl)
  );
}

function shouldForceSupabaseReconnect(row: UserConnectorProfileRow): boolean {
  if (row.connectorKey !== 'supabase' || !row.secretCiphertext) {
    return false;
  }
  const metadata = pickObject(row.metadataJson);
  const secret = decryptProfileSecret(row);
  return !(
    asText(metadata.provider) === 'composio' &&
    asText(secret?.source) === 'composio' &&
    asText(secret?.composioMcpUrl)
  );
}

function shouldForceFigmaComposioReconnect(row: UserConnectorProfileRow): boolean {
  if (row.connectorKey !== 'figma' || !row.secretCiphertext) {
    return false;
  }
  const metadata = pickObject(row.metadataJson);
  const secret = decryptProfileSecret(row);
  return !(
    asText(metadata.provider) === 'composio' &&
    asText(secret?.source) === 'composio' &&
    asText(secret?.composioMcpUrl)
  );
}

function isComposioCredentialError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return /invalid api key|valid api key|unauthorized|forbidden|401|403/i.test(message);
}

function formatComposioOAuthStartError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || '');
  if (isComposioCredentialError(error)) {
    return `Composio service credential is invalid. Update COMPOSIO_API_KEY on the server, then reconnect this connector. ${raw}`;
  }
  return raw || 'Failed to start Composio authorization';
}

const COMPOSIO_CALLBACK_PATHS: Partial<Record<ConnectorKey, string>> = {
  github: '/github/callback',
  notion: '/notion/callback',
  supabase: '/supabase/callback',
  slack: '/slack/callback',
  figma: '/figma/callback',
  google_super: '/google-super/callback',
};

function resolveComposioCallbackBaseUrl(): string {
  const baseUrl =
    asText(process.env.COMPOSIO_OAUTH_CALLBACK_BASE_URL) ||
    asText(process.env.FRONTEND_URL);
  if (!baseUrl) {
    throw new Error('COMPOSIO_OAUTH_CALLBACK_BASE_URL or FRONTEND_URL is required for Composio OAuth');
  }
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('COMPOSIO_OAUTH_CALLBACK_BASE_URL must be an http(s) URL');
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/+$/, '');
}

export function resolveComposioOauthCallbackUrl(
  connectorKey: ConnectorKey,
  inputRedirectUri: string
): URL {
  const callbackPath = COMPOSIO_CALLBACK_PATHS[connectorKey];
  if (!callbackPath) {
    throw new Error(`${connectorKey} Composio OAuth callback path is not configured`);
  }
  const callbackUrl = new URL(callbackPath, `${resolveComposioCallbackBaseUrl()}/`);
  const input = asText(inputRedirectUri);
  if (input) {
    callbackUrl.search = new URL(input).search;
  }
  return callbackUrl;
}

function resolveOauthRedirectUri(
  connectorKey: ConnectorKey,
  provider: { redirectUri?: string },
  inputRedirectUri: string
): string {
  if (connectorKey === 'vercel') {
    const fixedRedirectUri = asText(provider.redirectUri);
    if (!fixedRedirectUri) {
      throw new Error(`${connectorKey} OAuth fixed redirect URI is not configured`);
    }
    return fixedRedirectUri;
  }
  const dynamicRedirectUri = asText(inputRedirectUri);
  if (!dynamicRedirectUri) {
    throw new Error('OAuth redirectUri cannot be empty');
  }
  return dynamicRedirectUri;
}

export class UserConnectorService {
  private readonly inFlightMeLoads = new Map<string, Promise<ConnectorMeSnapshot>>();

  async listCatalog() {
    return connectorRegistry.listVisibleCatalog();
  }

  async listAllCatalog() {
    return connectorRegistry.listCatalog();
  }

  async listUserProfiles(userId: string) {
    await connectorStorageBootstrap.ensureReady();
    const profiles = await this.normalizeRowsForRead(
      userId,
      await userConnectorProfileDAO.listByUserId(userId)
    );
    const visibleKeys = new Set(connectorRegistry.listVisibleCatalog().map((item) => item.key));
    return profiles
      .filter((row) => visibleKeys.has(row.connectorKey as ConnectorKey))
      .map((row) => buildProfileView(row as any));
  }

  private async normalizeSlackProfileForRead(
    userId: string,
    row: UserConnectorProfileRow | null
  ): Promise<{ row: UserConnectorProfileRow | null; mutated: boolean }> {
    if (!row || !shouldForceSlackComposioReconnect(row)) {
      return { row, mutated: false };
    }

    const saved = await userConnectorProfileDAO.update(row.id, userId, {
      authMode: 'oauth',
      authStatus: 'needs_auth',
      secretCiphertext: null,
      lastAuthAt: null,
      lastError: SLACK_COMPOSIO_REAUTH_MESSAGE,
    } as any);

    return {
      row:
        (saved as UserConnectorProfileRow | undefined) ||
        ({
          ...row,
          authMode: 'oauth',
          authStatus: 'needs_auth',
          secretCiphertext: null,
          lastAuthAt: null,
          lastError: SLACK_COMPOSIO_REAUTH_MESSAGE,
        } as UserConnectorProfileRow),
      mutated: true,
    };
  }

  private async normalizeSupabaseProfileForRead(
    userId: string,
    row: UserConnectorProfileRow | null
  ): Promise<{ row: UserConnectorProfileRow | null; mutated: boolean }> {
    if (!row || !shouldForceSupabaseReconnect(row)) {
      return { row, mutated: false };
    }

    const saved = await userConnectorProfileDAO.update(row.id, userId, {
      authMode: 'oauth',
      authStatus: 'needs_auth',
      secretCiphertext: null,
      lastAuthAt: null,
      lastError: SUPABASE_SECRET_REAUTH_MESSAGE,
    } as any);

    return {
      row:
        (saved as UserConnectorProfileRow | undefined) ||
        ({
          ...row,
          authMode: 'oauth',
          authStatus: 'needs_auth',
          secretCiphertext: null,
          lastAuthAt: null,
          lastError: SUPABASE_SECRET_REAUTH_MESSAGE,
        } as UserConnectorProfileRow),
      mutated: true,
    };
  }

  private async normalizeFigmaProfileForRead(
    userId: string,
    row: UserConnectorProfileRow | null
  ): Promise<{ row: UserConnectorProfileRow | null; mutated: boolean }> {
    if (!row || !shouldForceFigmaComposioReconnect(row)) {
      return { row, mutated: false };
    }

    const lastError = 'Figma connector now requires Composio OAuth. Reconnect Figma through Composio.';
    const saved = await userConnectorProfileDAO.update(row.id, userId, {
      authMode: 'oauth',
      authStatus: 'needs_auth',
      secretCiphertext: null,
      lastAuthAt: null,
      lastError,
    } as any);

    return {
      row:
        (saved as UserConnectorProfileRow | undefined) ||
        ({
          ...row,
          authMode: 'oauth',
          authStatus: 'needs_auth',
          secretCiphertext: null,
          lastAuthAt: null,
          lastError,
        } as UserConnectorProfileRow),
      mutated: true,
    };
  }

  private async normalizeGithubProfileForRead(
    userId: string,
    row: UserConnectorProfileRow | null
  ): Promise<{ row: UserConnectorProfileRow | null; mutated: boolean }> {
    if (!row || !shouldForceGithubComposioReconnect(row)) {
      return { row, mutated: false };
    }

    const saved = await userConnectorProfileDAO.update(row.id, userId, {
      authMode: 'oauth',
      authStatus: 'needs_auth',
      secretCiphertext: null,
      lastAuthAt: null,
      lastError: GITHUB_COMPOSIO_REAUTH_MESSAGE,
    } as any);

    return {
      row:
        (saved as UserConnectorProfileRow | undefined) ||
        ({
          ...row,
          authMode: 'oauth',
          authStatus: 'needs_auth',
          secretCiphertext: null,
          lastAuthAt: null,
          lastError: GITHUB_COMPOSIO_REAUTH_MESSAGE,
        } as UserConnectorProfileRow),
      mutated: true,
    };
  }

  private async normalizeRowsForRead(
    userId: string,
    rows: UserConnectorProfileRow[]
  ): Promise<UserConnectorProfileRow[]> {
    if (rows.length === 0) {
      return rows;
    }

    const normalized: UserConnectorProfileRow[] = [];
    let mutated = false;
    for (const row of rows) {
      const githubNormalized = await this.normalizeGithubProfileForRead(userId, row);
      const slackNormalized = await this.normalizeSlackProfileForRead(
        userId,
        (githubNormalized.row || row) as UserConnectorProfileRow
      );
      const supabaseNormalized = await this.normalizeSupabaseProfileForRead(
        userId,
        (slackNormalized.row || githubNormalized.row || row) as UserConnectorProfileRow
      );
      const figmaNormalized = await this.normalizeFigmaProfileForRead(
        userId,
        (supabaseNormalized.row || slackNormalized.row || row) as UserConnectorProfileRow
      );
      normalized.push(
        (figmaNormalized.row ||
          supabaseNormalized.row ||
          slackNormalized.row ||
          githubNormalized.row ||
          row) as UserConnectorProfileRow
      );
      mutated =
        mutated ||
        githubNormalized.mutated ||
        slackNormalized.mutated ||
        supabaseNormalized.mutated ||
        figmaNormalized.mutated;
    }
    if (mutated) {
      await this.invalidateMeCache(userId);
    }
    return normalized;
  }

  private async loadMeSnapshotFromDb(userId: string): Promise<ConnectorMeSnapshot> {
    const [catalog, profiles] = await Promise.all([this.listCatalog(), this.listUserProfiles(userId)]);
    return {
      catalog,
      profiles,
      cache: {
        hit: false,
        source: 'db',
        redisEnabled: connectorRedisCacheService.isEnabled(),
      },
    };
  }

  private async invalidateMeCache(userId: string) {
    try {
      await connectorRedisCacheService.invalidateMe(userId);
      console.info('[connector_cache_invalidate]', { userId });
    } catch (error) {
      console.warn('[connector_cache_invalidate_failed]', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async getMeSnapshot(userId: string): Promise<ConnectorMeSnapshot> {
    const redisEnabled = connectorRedisCacheService.isEnabled();
    if (!redisEnabled) {
      console.info('[connector_cache_fallback_db]', { userId, reason: 'redis_disabled' });
      return this.loadMeSnapshotFromDb(userId);
    }

    let cached: Awaited<ReturnType<typeof connectorRedisCacheService.getMe>> = null;
    try {
      cached = await connectorRedisCacheService.getMe(userId);
    } catch (error) {
      console.warn('[connector_cache_get_failed]', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      console.info('[connector_cache_fallback_db]', { userId, reason: 'redis_get_failed' });
      return this.loadMeSnapshotFromDb(userId);
    }
    if (cached && Array.isArray(cached.catalog) && Array.isArray(cached.profiles)) {
      console.info('[connector_cache_hit]', { userId });
      return {
        catalog: cached.catalog as ConnectorCatalogItem[],
        profiles: cached.profiles as UserConnectorProfileView[],
        cache: {
          hit: true,
          source: 'redis',
          redisEnabled: true,
        },
      };
    }

    console.info('[connector_cache_miss]', { userId });
    const existing = this.inFlightMeLoads.get(userId);
    if (existing) {
      return existing;
    }

    const loadPromise = (async () => {
      const snapshot = await this.loadMeSnapshotFromDb(userId);
      try {
        await connectorRedisCacheService.setMe(userId, {
          catalog: snapshot.catalog,
          profiles: snapshot.profiles,
        });
        console.info('[connector_cache_set]', { userId });
      } catch (error) {
        console.warn('[connector_cache_set_failed]', {
          userId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return snapshot;
    })();
    this.inFlightMeLoads.set(userId, loadPromise);
    try {
      return await loadPromise;
    } finally {
      this.inFlightMeLoads.delete(userId);
    }
  }

  async getProfile(userId: string, profileId: string) {
    await connectorStorageBootstrap.ensureReady();
    const slackNormalized = await this.normalizeSlackProfileForRead(
      userId,
      (await userConnectorProfileDAO.getByIdAndUser(profileId, userId)) as UserConnectorProfileRow | null
    );
    const normalized = await this.normalizeSupabaseProfileForRead(
      userId,
      (slackNormalized.row || null) as UserConnectorProfileRow | null
    );
    const figmaNormalized = await this.normalizeFigmaProfileForRead(
      userId,
      (normalized.row || null) as UserConnectorProfileRow | null
    );
    if (!figmaNormalized.row) {
      throw new Error('Connector profile does not exist');
    }
    if (slackNormalized.mutated || normalized.mutated || figmaNormalized.mutated) {
      await this.invalidateMeCache(userId);
    }
    return buildProfileView(figmaNormalized.row as any);
  }

  async getProfileMaterial(userId: string, profileId: string): Promise<ConnectorAccountMaterial | null> {
    await connectorStorageBootstrap.ensureReady();
    const slackNormalized = await this.normalizeSlackProfileForRead(
      userId,
      (await userConnectorProfileDAO.getByIdAndUser(profileId, userId)) as UserConnectorProfileRow | null
    );
    const normalized = await this.normalizeSupabaseProfileForRead(
      userId,
      (slackNormalized.row || null) as UserConnectorProfileRow | null
    );
    const figmaNormalized = await this.normalizeFigmaProfileForRead(
      userId,
      (normalized.row || null) as UserConnectorProfileRow | null
    );
    const row = figmaNormalized.row;
    if (!row) return null;
    if (slackNormalized.mutated || normalized.mutated || figmaNormalized.mutated) {
      await this.invalidateMeCache(userId);
    }
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
        ? connectorSecretService.decryptJson<ConnectorAccountSecret>(
            row.secretCiphertext,
            row.connectorKey as ConnectorKey
          )
        : null,
    };
  }

  async listUserAccounts(userId: string) {
    await connectorStorageBootstrap.ensureReady();
    const catalog = connectorRegistry.listCatalog();
    const profiles = await this.normalizeRowsForRead(
      userId,
      await userConnectorProfileDAO.listByUserId(userId)
    );
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
    const rows = await this.normalizeRowsForRead(
      userId,
      await userConnectorProfileDAO.listByUserAndConnectorKey(userId, connectorKey)
    );
    return summarizeProfiles(
      catalogItem,
      rows.map((row) => buildProfileView(row as any))
    );
  }

  async getDefaultOrFirstProfile(userId: string, connectorKey: ConnectorKey) {
    await connectorStorageBootstrap.ensureReady();
    const rows = await this.normalizeRowsForRead(
      userId,
      await userConnectorProfileDAO.listByUserAndConnectorKey(userId, connectorKey)
    );
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
      ? connectorSecretService.decryptJson<ConnectorAccountSecret>(
          existing.secretCiphertext,
          existing.connectorKey as ConnectorKey
        )
      : null;
    const config = pickObject(input.config);
    const credentials = pickObject(input.credentials);
    const metadata = pickObject(input.metadata);
    const displayName =
      asText(input.displayName) || asText(config.displayName) || asText(existing?.displayName) || '';
    const secret = buildSecretPayload(connectorKey, credentials, existingSecret);
    if (catalogItem.authMode === 'dsn' && !secret?.dsn) {
      throw new Error('Postgres connector requires a DSN');
    }
    if (catalogItem.authMode === 'token' && !catalogItem.oauth?.supported && connectorKey !== 'postgres' && !secret?.accessToken) {
      throw new Error(`${catalogItem.name} connector requires an access token`);
    }
    const resolvedDisplayName = displayName || undefined;
    const profileNameCandidate =
      asText(input.profileName) ||
      asText(config.profileName) ||
      asText(existing?.profileName) ||
      (connectorKey === 'github'
        ? buildGithubProfileName(resolvedDisplayName)
        : buildDefaultProfileName(connectorKey, catalogItem.name));
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
        secretCiphertext: connectorSecretService.encrypt(secret, connectorKey),
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
        secretCiphertext: connectorSecretService.encrypt(secret, connectorKey),
        metadataJson: metadata,
        lastAuthAt: authStatus === 'authorized' ? new Date() : existing.lastAuthAt || null,
        lastError: null,
      } as any);
    }
    if (!saved) {
      throw new Error('Failed to save connector profile');
    }
    return buildProfileView(saved as any);
  }

  async createProfile(userId: string, connectorKey: ConnectorKey, input: SaveConnectorInput) {
    if (connectorKey === 'custom_api') {
      assertCustomApiEnabled();
    }
    const saved = await this.saveProfileInternal(userId, connectorKey, null, input);
    await this.invalidateMeCache(userId);
    return saved;
  }

  async updateProfile(userId: string, profileId: string, input: SaveConnectorInput) {
    const existing = await userConnectorProfileDAO.getByIdAndUser(profileId, userId);
    if (!existing) {
      throw new Error('Connector profile does not exist');
    }
    if (existing.connectorKey === 'custom_api') {
      assertCustomApiEnabled();
    }
    const saved = await this.saveProfileInternal(
      userId,
      existing.connectorKey as ConnectorKey,
      profileId,
      input
    );
    await this.invalidateMeCache(userId);
    return saved;
  }

  async deleteProfile(userId: string, profileId: string) {
    await connectorStorageBootstrap.ensureReady();
    const existing = await userConnectorProfileDAO.getByIdAndUser(profileId, userId);
    if (!existing) {
      throw new Error('Connector profile does not exist');
    }
    if (existing.connectorKey === 'custom_api') {
      assertCustomApiEnabled();
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
    await this.invalidateMeCache(userId);
    return true;
  }

  async setDefaultProfile(userId: string, profileId: string) {
    await connectorStorageBootstrap.ensureReady();
    const existing = await userConnectorProfileDAO.getByIdAndUser(profileId, userId);
    if (!existing) {
      throw new Error('Connector profile does not exist');
    }
    if (existing.connectorKey === 'custom_api') {
      assertCustomApiEnabled();
    }
    await userConnectorProfileDAO.clearDefaultForConnector(userId, existing.connectorKey);
    const saved = await userConnectorProfileDAO.update(profileId, userId, { isDefault: true } as any);
    if (!saved) {
      throw new Error('Failed to set default profile');
    }
    await this.invalidateMeCache(userId);
    return buildProfileView(saved as any);
  }

  async clearProfileAuth(userId: string, profileId: string) {
    await connectorStorageBootstrap.ensureReady();
    const existing = await userConnectorProfileDAO.getByIdAndUser(profileId, userId);
    if (!existing) {
      throw new Error('Connector profile does not exist');
    }
    if (existing.connectorKey === 'custom_api') {
      assertCustomApiEnabled();
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
      throw new Error('Failed to clear connector authorization');
    }
    await this.invalidateMeCache(userId);
    return {
      profile: buildProfileView(saved as any),
      remoteGrantRevoked: true,
      remoteGrantError: null,
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
      throw new Error('Connector profile does not exist');
    }
    const catalogItem = connectorRegistry.getCatalogItem(existing.connectorKey);
    const saved = await userConnectorProfileDAO.update(profileId, userId, {
      authMode: catalogItem.authMode,
      authStatus: catalogItem.available ? 'needs_auth' : 'unavailable',
      secretCiphertext: input?.clearSecret === false ? existing.secretCiphertext : null,
      lastError: asText(input?.lastError) || 'Authorization is invalid. Please reconnect.',
    } as any);
    if (!saved) {
      throw new Error('Failed to update connector authorization status');
    }
    await this.invalidateMeCache(userId);
    return buildProfileView(saved as any);
  }

  async startOAuthForProfile(userId: string, profileId: string, input: StartOauthInput) {
    await connectorStorageBootstrap.ensureReady();
    const currentProfile = (await userConnectorProfileDAO.getByIdAndUser(
      profileId,
      userId
    )) as UserConnectorProfileRow | null;
    const [profile] = await this.normalizeRowsForRead(userId, currentProfile ? [currentProfile] : []);
    if (!profile) {
      throw new Error('Connector profile does not exist');
    }
    const connectorKey = profile.connectorKey as ConnectorKey;
    const catalogItem = connectorRegistry.getCatalogItem(connectorKey);
    if (catalogItem.composio?.provider === 'composio') {
      if (!catalogItem.available) {
        throw new Error(catalogItem.availabilityReason || `${catalogItem.name} connector is unavailable`);
      }
      const requestId = randomUUID();
      const state = randomUUID();
      const returnToSessionId = asText(input.returnToSessionId) || null;
      await connectorAuthRequestDAO.create({
        requestId,
        userId,
        connectorKey,
        profileId,
        provider: 'composio',
        state,
        codeVerifier: null,
        returnToSessionId,
        status: 'pending',
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      } as any);
      const callbackUrl = resolveComposioOauthCallbackUrl(connectorKey, input.redirectUri);
      callbackUrl.searchParams.set('state', state);
      let auth: Awaited<ReturnType<typeof composioConnectorService.startAuthorization>>;
      try {
        auth = await composioConnectorService.startAuthorization({
          connectorKey,
          userId,
          callbackUrl: callbackUrl.toString(),
          catalogItem,
        });
      } catch (error) {
        const message = formatComposioOAuthStartError(error);
        const credentialError = isComposioCredentialError(error);
        await connectorAuthRequestDAO.markFailedByState(state, 'failed');
        await userConnectorProfileDAO.update(profileId, userId, {
          authMode: 'oauth',
          authStatus: credentialError || asText(profile.authStatus) !== 'authorized'
            ? 'needs_auth'
            : profile.authStatus,
          ...(credentialError ? { secretCiphertext: null } : {}),
          metadataJson: mergeMetadata(pickObject(profile.metadataJson), {
            provider: 'composio',
            composioUserId: composioConnectorService.buildComposioUserId(userId),
            composioToolkitSlugs: catalogItem.composio?.toolkitSlugs || [],
            connectionStatus: 'start_failed',
            lastConnectionError: message,
            lastConnectionCheckAt: new Date().toISOString(),
          }),
          lastError: message,
        } as any);
        await this.invalidateMeCache(userId);
        throw new Error(message);
      }
      const metadataJson = mergeMetadata(pickObject(profile.metadataJson), {
        provider: 'composio',
        composioUserId: auth.composioUserId,
        composioSessionId: auth.composioSessionId,
        composioToolkitSlugs: auth.toolkitSlugs,
        composioConnectedAccountId: auth.composioConnectedAccountId,
        connectionStatus: 'pending',
        oauthState: state,
      });
      await userConnectorProfileDAO.update(profileId, userId, {
        authMode: 'oauth',
        authStatus: 'needs_auth',
        metadataJson,
        secretCiphertext: connectorSecretService.encrypt(
          {
            source: 'composio',
            composioMcpUrl: auth.composioMcpUrl,
            composioMcpHeaders: auth.composioMcpHeaders,
          } satisfies ConnectorAccountSecret,
          connectorKey
        ),
        lastError: null,
      } as any);
      await this.invalidateMeCache(userId);
      return {
        requestId,
        state,
        authUrl: auth.authUrl,
      };
    }
    const provider = connectorRegistry.getOauthProvider(connectorKey);
    if (!provider) {
      throw new Error('Current connector has no OAuth provider configured');
    }
    const requestId = randomUUID();
    const returnToSessionId = asText(input.returnToSessionId) || null;
    const state = randomUUID();
    const pkce = provider.pkceMethod === 'S256' ? createPkcePair() : null;
    const redirectUri = resolveOauthRedirectUri(connectorKey, provider, input.redirectUri);
    await connectorAuthRequestDAO.create({
      requestId,
      userId,
      connectorKey,
      profileId,
      provider: provider.provider,
      state,
      codeVerifier: pkce?.verifier || null,
      returnToSessionId,
      status: 'pending',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    } as any);
    if (connectorKey === 'vercel' && isVercelIntegrationProvider(provider)) {
      const authUrl = new URL(provider.authorizationUrl);
      authUrl.searchParams.set('state', state);
      return {
        requestId,
        state,
        authUrl: authUrl.toString(),
      };
    }
    const authUrl = new URL(provider.authorizationUrl);
    authUrl.searchParams.set('client_id', provider.clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
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
      throw new Error('Connector profile does not exist');
    }
    const connectorKey = profile.connectorKey as ConnectorKey;
    const catalogItem = connectorRegistry.getCatalogItem(connectorKey);
    if (catalogItem.composio?.provider === 'composio') {
      const request = await connectorAuthRequestDAO.getByState(input.state);
      if (
        !request ||
        request.userId !== userId ||
        request.connectorKey !== connectorKey ||
        asText(request.profileId) !== profileId
      ) {
        throw new Error('OAuth request does not exist or does not belong to current user');
      }
      if (request.expiresAt && request.expiresAt.getTime() < Date.now()) {
        await connectorAuthRequestDAO.markFailedByState(input.state, 'expired');
        throw new Error('OAuth request has expired');
      }
      try {
        const currentSecret = profile.secretCiphertext
          ? connectorSecretService.decryptJson<ConnectorAccountSecret>(
              profile.secretCiphertext,
              connectorKey
            )
          : null;
        const callbackConnectedAccountId = asText(input.connectedAccountId);
        const callbackStatus = asText(input.status);
        const callbackMetadata = mergeMetadata(pickObject(profile.metadataJson), {
          ...(callbackConnectedAccountId
            ? { composioConnectedAccountId: callbackConnectedAccountId }
            : {}),
          ...(callbackStatus ? { callbackStatus } : {}),
        });
        const confirmed = await composioConnectorService.confirmAuthorization({
          connectorKey,
          userId,
          catalogItem,
          metadata: callbackMetadata,
          secret: currentSecret,
        });
        await connectorAuthRequestDAO.markCompleted(request.requestId, 'completed');
        const confirmedMetadata = mergeMetadata(pickObject(profile.metadataJson), confirmed.metadata);
        const displayName =
          asText(confirmed.metadata.composioDisplayName) ||
          asText(profile.displayName) ||
          catalogItem.name;
        const saved = await userConnectorProfileDAO.update(profileId, userId, {
          profileName:
            connectorKey === 'github' && (!asText(profile.profileName) || profile.profileName === 'GitHub Default')
              ? buildGithubProfileName(displayName)
              : asText(profile.profileName) || buildDefaultProfileName(connectorKey, catalogItem.name),
          authMode: 'oauth',
          authStatus: 'authorized',
          displayName,
          configJson: mergeComposioConfig(connectorKey, pickObject(profile.configJson), confirmedMetadata),
          secretCiphertext: connectorSecretService.encrypt(confirmed.secret, connectorKey),
          metadataJson: confirmedMetadata,
          lastAuthAt: new Date(),
          lastError: null,
        } as any);
        if (!saved) {
          throw new Error('Failed to save Composio OAuth result');
        }
        await this.invalidateMeCache(userId);
        return {
          profile: buildProfileView(saved as any),
          returnToSessionId: request.returnToSessionId || null,
        };
      } catch (error) {
        await connectorAuthRequestDAO.markFailedByState(input.state, 'failed');
        await userConnectorProfileDAO.update(profileId, userId, {
          authStatus: 'needs_auth',
          lastError: error instanceof Error ? error.message : String(error),
        } as any);
        throw error;
      }
    }
    const provider = connectorRegistry.getOauthProvider(connectorKey);
    if (!provider) {
      throw new Error('Current connector has no OAuth provider configured');
    }
    const request = await connectorAuthRequestDAO.getByState(input.state);
    if (
      !request ||
      request.userId !== userId ||
      request.connectorKey !== connectorKey ||
      asText(request.profileId) !== profileId
    ) {
      throw new Error('OAuth request does not exist or does not belong to current user');
    }
    if (request.expiresAt && request.expiresAt.getTime() < Date.now()) {
      await connectorAuthRequestDAO.markFailedByState(input.state, 'expired');
      throw new Error('OAuth request has expired');
    }

    try {
      const redirectUri = resolveOauthRedirectUri(connectorKey, provider, input.redirectUri);
      const body: Record<string, string> = {
        code: input.code,
        redirect_uri: redirectUri,
      };
      if (provider.pkceMethod === 'S256') {
        const codeVerifier = asText(request.codeVerifier);
        if (!codeVerifier) {
          throw new Error('OAuth 璇锋眰缂哄皯 PKCE code_verifier');
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
      let accessToken = asText(tokenPayload.access_token);
      if (!accessToken) {
        throw new Error('OAuth callback did not return access_token');
      }
      let metadataJson = pickObject(profile.metadataJson);
      let configJson = pickObject(profile.configJson);
      let displayName =
        asText((tokenPayload.team as Record<string, unknown> | undefined)?.name) ||
        asText(tokenPayload.workspace_name) ||
        asText(profile.displayName) ||
        '';
      let profileName =
        asText(profile.profileName) ||
        (connectorKey === 'github'
          ? buildGithubProfileName(displayName)
          : buildDefaultProfileName(connectorKey, catalogItem.name));

      const secret: ConnectorAccountSecret =
        connectorKey === 'vercel' && isVercelIntegrationProvider(provider)
          ? {
              source: 'vercel_integration',
              accessToken,
              tokenType: asText(tokenPayload.token_type) || 'Bearer',
            }
          : {
              accessToken,
              refreshToken: asText(tokenPayload.refresh_token) || undefined,
              tokenType: asText(tokenPayload.token_type) || undefined,
              scope: asText(tokenPayload.scope) || undefined,
              expiresAt: calculateSecretExpiresAt(tokenPayload),
            };
      accessToken = asText(secret.accessToken);
      if (!accessToken) {
        throw new Error('OAuth callback did not return access_token');
      }

      let authStatus: ConnectorAuthStatus = 'authorized';
      let lastError: string | null = null;
      let secretCiphertext = connectorSecretService.encrypt(secret, connectorKey);
      let lastAuthAt: Date | null = new Date();

      if (connectorKey === 'vercel') {
        if (isVercelIntegrationProvider(provider)) {
          const teamId = asText(input.teamId) || asText(tokenPayload.team_id);
          const configurationId =
            asText(input.configurationId) ||
            asText(tokenPayload.configuration_id) ||
            asText(tokenPayload.integration_configuration_id);
          const installationSource = asText(input.source) || 'external';
          configJson = {
            ...configJson,
            vercelAuthMode: 'integration',
            teamId: teamId || null,
            configurationId: configurationId || null,
            installationSource,
          };
          metadataJson = {
            ...metadataJson,
            vercelIntegrationSlug: asText(provider.integrationSlug) || null,
            next: asText(input.next) || null,
            installedAt: new Date().toISOString(),
          };
          displayName = teamId || configurationId || asText(provider.integrationSlug) || displayName || 'Vercel';
        } else {
          throw new Error('Vercel connector only supports Integration authorization.');
        }
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
        configJson,
        secretCiphertext,
        metadataJson,
        lastAuthAt,
        lastError,
      } as any);
      if (!saved) {
        throw new Error('Failed to save OAuth result');
      }
      await this.invalidateMeCache(userId);

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
      throw new Error('Connector profile does not exist');
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
      throw new Error('OAuth request does not exist or does not belong to current user');
    }
    const result = await this.completeOAuthByProfile(userId, String(request.profileId), input);
    return {
      account: summarizeProfiles(connectorRegistry.getCatalogItem(connectorKey), [result.profile]),
      returnToSessionId: result.returnToSessionId,
    };
  }
}

export const userConnectorService = new UserConnectorService();
