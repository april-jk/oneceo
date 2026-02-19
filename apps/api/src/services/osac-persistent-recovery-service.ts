import { sandboxEnvironmentService } from './sandbox-environment-service';
import { osacConnectionManager } from './osac-connection-manager';

function toNumber(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function hasString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasRecoverableToken(metadata: unknown) {
  if (!metadata || typeof metadata !== 'object') return false;
  const map = metadata as Record<string, unknown>;
  const nested = map.osac && typeof map.osac === 'object' ? (map.osac as Record<string, unknown>) : null;
  return (
    hasString(map.osacAuthToken) ||
    hasString(map.osacToken) ||
    hasString(nested?.authToken) ||
    hasString(nested?.token)
  );
}

function hasRecoverableEndpoint(metadata: unknown) {
  if (!metadata || typeof metadata !== 'object') return false;
  const map = metadata as Record<string, unknown>;
  const endpoint =
    (typeof map.osacEndpoint === 'string' && map.osacEndpoint.trim()) ||
    (typeof map.osacUrl === 'string' && map.osacUrl.trim()) ||
    (typeof map.sandboxAgentEndpoint === 'string' && map.sandboxAgentEndpoint.trim()) ||
    '';
  return Boolean(endpoint);
}

function isWarmPoolMetadata(metadata: unknown) {
  if (!metadata || typeof metadata !== 'object') return false;
  const map = metadata as Record<string, unknown>;
  const owner = typeof map.owner === 'string' ? map.owner.trim() : '';
  const purpose = typeof map.purpose === 'string' ? map.purpose.trim() : '';
  const warmPool = map.warmPool && typeof map.warmPool === 'object' ? (map.warmPool as Record<string, unknown>) : null;
  return (
    owner === 'osac-warm-pool' ||
    purpose === 'osac-warm-pool' ||
    warmPool !== null
  );
}

function isRecentEnough(item: any, maxAgeMs: number) {
  if (maxAgeMs <= 0) return true;
  const t = item?.updatedAt || item?.createdAt;
  const ms = t ? new Date(t).getTime() : 0;
  if (!Number.isFinite(ms) || ms <= 0) return false;
  return Date.now() - ms <= maxAgeMs;
}

export class OsacPersistentRecoveryService {
  private started = false;

  async recoverReadySessions() {
    if (this.started) {
      return;
    }
    this.started = true;

    const enabled = String(process.env.OSAC_PERSISTENT_RECOVER_ON_STARTUP || 'true').toLowerCase() !== 'false';
    if (!enabled) {
      return;
    }

    const limit = toNumber(process.env.OSAC_PERSISTENT_RECOVER_LIMIT, 5);
    const maxAgeMs = Math.max(60_000, toNumber(process.env.OSAC_PERSISTENT_RECOVER_MAX_AGE_MS, 30 * 60 * 1000));
    const skipWarmPool = String(process.env.OSAC_PERSISTENT_RECOVER_SKIP_WARM_POOL || 'true').toLowerCase() !== 'false';

    try {
      const environments = await sandboxEnvironmentService.listEnvironments(limit);
      const candidates = environments
        .filter((item) => item.status === 'ready')
        .filter((item) => hasRecoverableToken(item.metadata))
        .filter((item) => hasRecoverableEndpoint(item.metadata))
        .filter((item) => isRecentEnough(item, maxAgeMs))
        .filter((item) => !skipWarmPool || !isWarmPoolMetadata(item.metadata))
        .map((item) => item.sessionId);

      if (candidates.length === 0) {
        return;
      }

      console.log(
        '[OSAC_PERSISTENT_RECOVER]',
        JSON.stringify({ candidates: candidates.length, limit, maxAgeMs, skipWarmPool })
      );

      for (const sessionId of candidates) {
        try {
          const ok = await osacConnectionManager.ensurePersistent(sessionId);
          console.log('[OSAC_PERSISTENT_RECOVER_RESULT]', JSON.stringify({ sessionId, ok }));
        } catch (error) {
          console.warn(
            '[OSAC_PERSISTENT_RECOVER_ERROR]',
            sessionId,
            error instanceof Error ? error.message : String(error)
          );
        }
      }
    } catch (error) {
      console.warn(
        '[OSAC_PERSISTENT_RECOVER_ERROR]',
        error instanceof Error ? error.message : String(error)
      );
    }
  }
}

export const osacPersistentRecoveryService = new OsacPersistentRecoveryService();
