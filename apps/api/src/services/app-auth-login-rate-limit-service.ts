import { createHash } from 'node:crypto';
import { redisClientService, type RedisCommandPort } from './redis-client-service';

type LoginAttemptIdentity = {
  email?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

type RateLimitDecision = {
  allowed: boolean;
  retryAfterSeconds: number;
  scope: 'email' | 'ip' | null;
};

type CounterEntry = {
  count: number;
  expiresAt: number;
};

const DEFAULT_FAILURE_WINDOW_SECONDS = 5 * 60;
const DEFAULT_BLOCK_SECONDS = 15 * 60;
const DEFAULT_EMAIL_MAX_FAILURES = 5;
const DEFAULT_IP_MAX_FAILURES = 20;

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function asPositiveInteger(value: unknown, fallback: number) {
  const parsed = Number(asText(value));
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function normalizeEmail(value: unknown) {
  return asText(value).toLowerCase();
}

function normalizeIpAddress(value: unknown) {
  const raw = asText(value);
  if (!raw) return '';
  return raw.split(',')[0]?.trim() || '';
}

function hashKeyPart(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function maskEmail(value: string) {
  const normalized = normalizeEmail(value);
  const atIndex = normalized.indexOf('@');
  if (atIndex <= 1) return normalized ? '***' : '';
  return `${normalized.slice(0, 1)}***${normalized.slice(atIndex)}`;
}

function buildFailureCounterKey(scope: 'email' | 'ip', value: string) {
  return `app-auth:login:fail:${scope}:${hashKeyPart(value)}`;
}

function buildBlockedKey(scope: 'email' | 'ip', value: string) {
  return `app-auth:login:block:${scope}:${hashKeyPart(value)}`;
}

export class AppAuthLoginRateLimitService {
  private readonly fallbackCounters = new Map<string, CounterEntry>();
  private readonly fallbackBlocks = new Map<string, number>();

  constructor(private readonly redis: RedisCommandPort = redisClientService) {}

  private getConfig() {
    return {
      failureWindowSeconds: asPositiveInteger(
        process.env.APP_AUTH_LOGIN_FAILURE_WINDOW_SECONDS,
        DEFAULT_FAILURE_WINDOW_SECONDS
      ),
      blockSeconds: asPositiveInteger(process.env.APP_AUTH_LOGIN_BLOCK_SECONDS, DEFAULT_BLOCK_SECONDS),
      emailMaxFailures: asPositiveInteger(
        process.env.APP_AUTH_LOGIN_EMAIL_MAX_FAILURES,
        DEFAULT_EMAIL_MAX_FAILURES
      ),
      ipMaxFailures: asPositiveInteger(process.env.APP_AUTH_LOGIN_IP_MAX_FAILURES, DEFAULT_IP_MAX_FAILURES),
    };
  }

  private cleanupFallbackState(now = Date.now()) {
    for (const [key, entry] of this.fallbackCounters.entries()) {
      if (entry.expiresAt <= now) {
        this.fallbackCounters.delete(key);
      }
    }
    for (const [key, expiresAt] of this.fallbackBlocks.entries()) {
      if (expiresAt <= now) {
        this.fallbackBlocks.delete(key);
      }
    }
  }

  private readFallbackBlock(key: string) {
    this.cleanupFallbackState();
    return this.fallbackBlocks.get(key) || 0;
  }

  private readFallbackCounter(key: string) {
    this.cleanupFallbackState();
    return this.fallbackCounters.get(key)?.count || 0;
  }

  private incrementFallbackCounter(key: string, ttlSeconds: number) {
    const now = Date.now();
    const existing = this.fallbackCounters.get(key);
    if (!existing || existing.expiresAt <= now) {
      this.fallbackCounters.set(key, {
        count: 1,
        expiresAt: now + ttlSeconds * 1000,
      });
      return 1;
    }
    const nextCount = existing.count + 1;
    this.fallbackCounters.set(key, {
      ...existing,
      count: nextCount,
    });
    return nextCount;
  }

  private setFallbackBlock(key: string, ttlSeconds: number) {
    this.fallbackBlocks.set(key, Date.now() + ttlSeconds * 1000);
  }

  private async readBlock(key: string) {
    if (this.redis.isEnabled()) {
      const value = await this.redis.getString(key);
      if (value) return true;
    }
    return this.readFallbackBlock(key) > 0;
  }

  private async readCounter(key: string) {
    if (this.redis.isEnabled()) {
      const raw = await this.redis.getString(key);
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
    return this.readFallbackCounter(key);
  }

  private async incrementCounter(key: string, ttlSeconds: number) {
    if (this.redis.isEnabled()) {
      const count = await this.redis.incrementCounter(key, ttlSeconds);
      if (count > 0) {
        return count;
      }
    }
    return this.incrementFallbackCounter(key, ttlSeconds);
  }

  private async setBlock(key: string, ttlSeconds: number) {
    if (this.redis.isEnabled()) {
      const ok = await this.redis.setString(key, '1', {
        ttlSeconds,
      });
      if (ok) {
        return;
      }
    }
    this.setFallbackBlock(key, ttlSeconds);
  }

  private async clearKey(key: string) {
    if (this.redis.isEnabled()) {
      await this.redis.delete(key);
    }
    this.fallbackCounters.delete(key);
    this.fallbackBlocks.delete(key);
  }

  private buildScopeKeys(input: LoginAttemptIdentity) {
    const email = normalizeEmail(input.email);
    const ipAddress = normalizeIpAddress(input.ipAddress);
    return {
      email,
      ipAddress,
      emailCounterKey: email ? buildFailureCounterKey('email', email) : null,
      emailBlockedKey: email ? buildBlockedKey('email', email) : null,
      ipCounterKey: ipAddress ? buildFailureCounterKey('ip', ipAddress) : null,
      ipBlockedKey: ipAddress ? buildBlockedKey('ip', ipAddress) : null,
    };
  }

  async check(input: LoginAttemptIdentity): Promise<RateLimitDecision> {
    const config = this.getConfig();
    const keys = this.buildScopeKeys(input);

    if (keys.emailBlockedKey && (await this.readBlock(keys.emailBlockedKey))) {
      return {
        allowed: false,
        retryAfterSeconds: config.blockSeconds,
        scope: 'email',
      };
    }

    if (keys.ipBlockedKey && (await this.readBlock(keys.ipBlockedKey))) {
      return {
        allowed: false,
        retryAfterSeconds: config.blockSeconds,
        scope: 'ip',
      };
    }

    const emailFailures = keys.emailCounterKey ? await this.readCounter(keys.emailCounterKey) : 0;
    if (keys.emailBlockedKey && keys.emailCounterKey && emailFailures >= config.emailMaxFailures) {
      await this.setBlock(keys.emailBlockedKey, config.blockSeconds);
      return {
        allowed: false,
        retryAfterSeconds: config.blockSeconds,
        scope: 'email',
      };
    }

    const ipFailures = keys.ipCounterKey ? await this.readCounter(keys.ipCounterKey) : 0;
    if (keys.ipBlockedKey && keys.ipCounterKey && ipFailures >= config.ipMaxFailures) {
      await this.setBlock(keys.ipBlockedKey, config.blockSeconds);
      return {
        allowed: false,
        retryAfterSeconds: config.blockSeconds,
        scope: 'ip',
      };
    }

    return {
      allowed: true,
      retryAfterSeconds: 0,
      scope: null,
    };
  }

  async recordFailure(input: LoginAttemptIdentity): Promise<RateLimitDecision> {
    const config = this.getConfig();
    const keys = this.buildScopeKeys(input);

    let blockedScope: 'email' | 'ip' | null = null;

    if (keys.emailCounterKey && keys.emailBlockedKey) {
      const failures = await this.incrementCounter(keys.emailCounterKey, config.failureWindowSeconds);
      if (failures >= config.emailMaxFailures) {
        await this.setBlock(keys.emailBlockedKey, config.blockSeconds);
        blockedScope = 'email';
      }
    }

    if (keys.ipCounterKey && keys.ipBlockedKey) {
      const failures = await this.incrementCounter(keys.ipCounterKey, config.failureWindowSeconds);
      if (failures >= config.ipMaxFailures) {
        await this.setBlock(keys.ipBlockedKey, config.blockSeconds);
        blockedScope = blockedScope || 'ip';
      }
    }

    return {
      allowed: blockedScope === null,
      retryAfterSeconds: blockedScope ? config.blockSeconds : 0,
      scope: blockedScope,
    };
  }

  async recordSuccess(input: LoginAttemptIdentity) {
    const keys = this.buildScopeKeys(input);
    await Promise.all(
      [keys.emailCounterKey, keys.emailBlockedKey]
        .filter((value): value is string => Boolean(value))
        .map((key) => this.clearKey(key))
    );
  }

  logSecurityEvent(
    event: 'login_blocked' | 'login_failed' | 'login_succeeded',
    input: LoginAttemptIdentity,
    extra?: Record<string, unknown>
  ) {
    const email = normalizeEmail(input.email);
    const ipAddress = normalizeIpAddress(input.ipAddress);
    const payload = JSON.stringify({
      event,
      email: maskEmail(email),
      hasEmail: Boolean(email),
      ipAddress: ipAddress || null,
      userAgent: asText(input.userAgent) || null,
      ...extra,
    });
    if (event === 'login_succeeded') {
      console.info('[APP_AUTH_SECURITY]', payload);
      return;
    }
    console.warn('[APP_AUTH_SECURITY]', payload);
  }

  resetForTests() {
    this.fallbackCounters.clear();
    this.fallbackBlocks.clear();
  }
}

export const appAuthLoginRateLimitService = new AppAuthLoginRateLimitService();
