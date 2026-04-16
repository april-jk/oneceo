import { loadApiEnv } from '../config/load-env';

loadApiEnv();

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asPositiveInt(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(max, Math.floor(parsed));
}

type TurnIceServer = {
  urls: string[];
  username?: string;
  credential?: string;
};

type CachedIce = {
  expiresAt: number;
  iceServers: TurnIceServer[];
};

export class CloudflareTurnService {
  private readonly perUserCache = new Map<string, CachedIce>();

  private getCredentialTtlSeconds() {
    return asPositiveInt(process.env.NEKO_TURN_CREDENTIAL_TTL_SECONDS, 3600, 86400);
  }

  private getFixedTurnConfig() {
    const keyId =
      asText(process.env.CLOUDFLARE_TURN_KEY_ID) ||
      asText(process.env.CLOUDFLARE_TURN_TOKEN_ID);
    const keyToken =
      asText(process.env.CLOUDFLARE_TURN_KEY_API_TOKEN) ||
      asText(process.env.CLOUDFLARE_TURN_API_TOKEN);
    if (!keyId || !keyToken) return null;
    return { keyId, keyToken };
  }

  private async fetchJson(url: string, init: RequestInit) {
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
      const firstError =
        Array.isArray(payload.errors) && payload.errors.length
          ? (payload.errors[0] as Record<string, unknown>)
          : null;
      const message =
        asText(firstError?.message) ||
        asText(payload?.error) ||
        asText(payload?.message);
      throw new Error(message || `cloudflare_turn_request_failed:${response.status}`);
    }
    return payload;
  }

  private normalizeIceServers(rawPayload: Record<string, unknown>): TurnIceServer[] {
    const payload = ((rawPayload.result ?? rawPayload) || {}) as Record<string, unknown>;
    const iceServersRaw = Array.isArray(payload.iceServers) ? payload.iceServers : [];
    const result: TurnIceServer[] = [];
    for (const item of iceServersRaw) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const record = item as Record<string, unknown>;
      const urls = Array.isArray(record.urls)
        ? record.urls.map((url) => asText(url)).filter(Boolean)
        : asText(record.urls)
          ? [asText(record.urls)]
          : [];
      if (!urls.length) continue;
      const username = asText(record.username);
      const credential = asText(record.credential);
      result.push({
        urls,
        ...(username ? { username } : {}),
        ...(credential ? { credential } : {}),
      });
    }
    return result;
  }

  private async generateIceServers(input: { keyId: string; keyToken: string }) {
    const ttl = this.getCredentialTtlSeconds();
    const payload = await this.fetchJson(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(input.keyId)}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${input.keyToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ttl }),
      }
    );
    return {
      iceServers: this.normalizeIceServers(payload),
      ttlSeconds: ttl,
    };
  }

  async issueIceServersForUser(userId: string): Promise<TurnIceServer[] | null> {
    const normalizedUserId = asText(userId);
    if (!normalizedUserId) return null;

    const cached = this.perUserCache.get(normalizedUserId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.iceServers;
    }

    const config = this.getFixedTurnConfig();
    if (!config) {
      console.warn('[CLOUDFLARE_TURN_FIXED_KEY_NOT_CONFIGURED]', { userId: normalizedUserId });
      return null;
    }

    try {
      const generated = await this.generateIceServers(config);
      if (!generated.iceServers.length) {
        throw new Error('cloudflare_turn_empty_ice_servers');
      }
      const cacheTtlMs = Math.max(30_000, Math.floor(generated.ttlSeconds * 500));
      this.perUserCache.set(normalizedUserId, {
        iceServers: generated.iceServers,
        expiresAt: Date.now() + cacheTtlMs,
      });
      return generated.iceServers;
    } catch (error) {
      console.warn('[CLOUDFLARE_TURN_ISSUE_FAILED]', {
        userId: normalizedUserId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}

export const cloudflareTurnService = new CloudflareTurnService();
