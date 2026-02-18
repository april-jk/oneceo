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

    try {
      const environments = await sandboxEnvironmentService.listEnvironments(limit);
      const candidates = environments
        .filter((item) => item.status === 'ready' && hasRecoverableToken(item.metadata))
        .map((item) => item.sessionId);

      if (candidates.length === 0) {
        return;
      }

      console.log('[OSAC_PERSISTENT_RECOVER]', JSON.stringify({ candidates: candidates.length, limit }));

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
