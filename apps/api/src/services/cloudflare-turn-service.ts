import { userConnectorAccountDAO } from '../db/dao';
import { connectorSecretService } from './connector-secret-service';

type TurnIceServer = {
  urls: string[];
  username?: string;
  credential?: string;
};

type TurnKeySecret = {
  turnKeyApiToken: string;
};

type TurnKeyConfig = {
  provider: 'cloudflare_calls_turn';
  turnKeyId: string;
  turnKeyName: string;
  createdAt: string;
};

const TURN_CONNECTOR_KEY = 'cloudflare_turn';
const TURN_PROVIDER_NAME = 'Cloudflare TURN';

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => asText(item)).filter(Boolean);
  }
  const single = asText(value);
  return single ? [single] : [];
}

function resolveTurnAccountId() {
  return (
    asText(process.env.CLOUDFLARE_ACCOUNT_ID) ||
    asText(process.env.CF_ACCOUNT_ID) ||
    asText(process.env.R2_ACCOUNT_ID)
  );
}

function resolveTurnManagementToken() {
  return (
    asText(process.env.CLOUDFLARE_TURN_MANAGEMENT_API_TOKEN) ||
    asText(process.env.CF_TURN_MANAGEMENT_API_TOKEN)
  );
}

function resolveTurnCredentialTtlSeconds() {
  const raw = Number(process.env.NEKO_TURN_CREDENTIAL_TTL_SECONDS || 3600);
  if (!Number.isFinite(raw) || raw <= 0) return 3600;
  return Math.max(60, Math.min(48 * 3600, Math.floor(raw)));
}

function buildTurnKeyName(userId: string) {
  const prefix = asText(process.env.CLOUDFLARE_TURN_KEY_PREFIX) || 'oneceo-user-turn';
  const normalizedUser = userId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 28) || 'user';
  return `${prefix}-${normalizedUser}`.slice(0, 64);
}

async function requestCloudflareJson<T>(
  url: string,
  token: string,
  init: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: Record<string, unknown>;
    timeoutMs?: number;
  }
): Promise<T> {
  const timeoutMs = Math.max(5000, Math.min(60000, Number(init.timeoutMs || 20000)));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => null)) as any;
    if (!response.ok) {
      const message = asText(payload?.errors?.[0]?.message) || `http_${response.status}`;
      throw new Error(`cloudflare_turn_http_error:${message}`);
    }
    if (payload && payload.success === false) {
      const message = asText(payload?.errors?.[0]?.message) || 'cloudflare_api_failed';
      throw new Error(`cloudflare_turn_api_error:${message}`);
    }
    return payload as T;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeIceServers(value: unknown): TurnIceServer[] {
  if (!Array.isArray(value)) {
    throw new Error('cloudflare_turn_invalid_ice_servers_shape');
  }
  const normalized = value
    .map((item) => {
      const record = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
      const urls = toStringArray(record.urls);
      if (!urls.length) return null;
      const entry: TurnIceServer = { urls };
      const username = asText(record.username);
      const credential = asText(record.credential);
      if (username) entry.username = username;
      if (credential) entry.credential = credential;
      return entry;
    })
    .filter(Boolean) as TurnIceServer[];
  if (!normalized.length) {
    throw new Error('cloudflare_turn_empty_ice_servers');
  }
  return normalized;
}

export class CloudflareTurnService {
  private async ensureUserTurnKey(userId: string) {
    const accountId = resolveTurnAccountId();
    const managementToken = resolveTurnManagementToken();
    if (!accountId || !managementToken) {
      return null;
    }

    const existing = await userConnectorAccountDAO.getByUserAndConnectorKey(userId, TURN_CONNECTOR_KEY);
    const existingConfig = (existing?.configJson || {}) as Record<string, unknown>;
    const existingSecret = existing?.secretCiphertext
      ? connectorSecretService.decryptJson<TurnKeySecret>(existing.secretCiphertext)
      : null;
    const existingTurnKeyId = asText(existingConfig.turnKeyId);
    const existingTurnKeyApiToken = asText(existingSecret?.turnKeyApiToken);

    if (existingTurnKeyId && existingTurnKeyApiToken) {
      return {
        accountId,
        turnKeyId: existingTurnKeyId,
        turnKeyApiToken: existingTurnKeyApiToken,
      };
    }

    const keyName = buildTurnKeyName(userId);
    const created = await requestCloudflareJson<{ result?: { uid?: string; key?: string } }>(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/calls/turn_keys`,
      managementToken,
      {
        method: 'POST',
        body: { name: keyName },
      }
    );

    const turnKeyId = asText(created?.result?.uid);
    const turnKeyApiToken = asText(created?.result?.key);
    if (!turnKeyId || !turnKeyApiToken) {
      throw new Error('cloudflare_turn_create_key_invalid_result');
    }

    const config: TurnKeyConfig = {
      provider: 'cloudflare_calls_turn',
      turnKeyId,
      turnKeyName: keyName,
      createdAt: new Date().toISOString(),
    };

    await userConnectorAccountDAO.upsert({
      userId,
      connectorKey: TURN_CONNECTOR_KEY,
      authMode: 'token',
      authStatus: 'authorized',
      displayName: TURN_PROVIDER_NAME,
      configJson: config,
      secretCiphertext: connectorSecretService.encrypt({ turnKeyApiToken }),
      lastAuthAt: new Date(),
      lastError: null,
    });

    return {
      accountId,
      turnKeyId,
      turnKeyApiToken,
    };
  }

  async issueIceServersForUser(userId: string): Promise<TurnIceServer[] | null> {
    const normalizedUserId = asText(userId);
    if (!normalizedUserId) return null;

    const turnKey = await this.ensureUserTurnKey(normalizedUserId);
    if (!turnKey) {
      return null;
    }

    const ttl = resolveTurnCredentialTtlSeconds();
    const generated = await requestCloudflareJson<{ iceServers?: unknown }>(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(turnKey.turnKeyId)}/credentials/generate-ice-servers`,
      turnKey.turnKeyApiToken,
      {
        method: 'POST',
        body: { ttl },
      }
    );

    return normalizeIceServers(generated?.iceServers);
  }
}

export const cloudflareTurnService = new CloudflareTurnService();

