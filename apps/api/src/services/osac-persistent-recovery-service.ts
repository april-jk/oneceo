import { sandboxEnvironmentService } from './sandbox-environment-service';
import { osacConnectionManager } from './osac-connection-manager';
import { osacAgentService } from './osac-agent-service';

function toNumber(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBool(value: string | undefined, fallback: boolean) {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function resolveStartNewVmSwitch(): boolean | null {
  const raw = (process.env.OSAC_START_NEW_VM || '').trim();
  if (!raw) return null;
  return toBool(raw, false);
}

function shouldSkipPersistentRecover(): boolean {
  const startNewVm = resolveStartNewVmSwitch();
  if (startNewVm === true) return false;
  if (startNewVm === false) return true;
  return toBool(process.env.OSAC_USE_FIXED_SANDBOX_SESSION, false);
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

function isRecentEnough(item: any, maxAgeMs: number) {
  if (maxAgeMs <= 0) return true;
  const t = item?.updatedAt || item?.createdAt;
  const ms = t ? new Date(t).getTime() : 0;
  if (!Number.isFinite(ms) || ms <= 0) return false;
  return Date.now() - ms <= maxAgeMs;
}

function compareCandidates(a: any, b: any): number {
  const ta = new Date(a?.updatedAt || a?.createdAt || 0).getTime();
  const tb = new Date(b?.updatedAt || b?.createdAt || 0).getTime();
  return tb - ta;
}

export class OsacPersistentRecoveryService {
  private started = false;
  private recovering = false;
  private timer: NodeJS.Timeout | null = null;

  private async withTimeout<T>(label: string, timeoutMs: number, promise: Promise<T>): Promise<T> {
    const normalized = Math.max(1000, timeoutMs);
    let timer: NodeJS.Timeout | null = null;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}_timeout`)), normalized);
      if (timer && typeof timer.unref === 'function') {
        timer.unref();
      }
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private startPeriodicRecovery() {
    if (shouldSkipPersistentRecover()) {
      console.log('[OSAC_PERSISTENT_RECOVER_SKIP]', 'fixed_session_mode');
      return;
    }

    const enabled = toBool(process.env.OSAC_PERSISTENT_RECOVER_ON_STARTUP, true);
    if (!enabled) {
      return;
    }

    const intervalMs = Math.max(5000, toNumber(process.env.OSAC_PERSISTENT_RECOVER_INTERVAL_MS, 20_000));
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.timer = setInterval(() => {
      void this.runRecoveryCycle('periodic');
    }, intervalMs);
    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  private async runRecoveryCycle(reason: 'startup' | 'periodic') {
    if (this.recovering) {
      return;
    }
    this.recovering = true;

    const limit = Math.max(1, toNumber(process.env.OSAC_PERSISTENT_RECOVER_LIMIT, 30));
    const maxAgeMs = Math.max(60_000, toNumber(process.env.OSAC_PERSISTENT_RECOVER_MAX_AGE_MS, 30 * 60 * 1000));
    const readyGateEnabled = toBool(process.env.OSAC_PERSISTENT_RECOVER_READY_GATE_ENABLED, true);
    const readyGateTimeoutMs = Math.max(
      3000,
      toNumber(process.env.OSAC_PERSISTENT_RECOVER_READY_GATE_TIMEOUT_MS, 20_000)
    );

    try {
      const scanLimit = Math.max(limit, Math.min(200, limit * 4));
      const environments = await sandboxEnvironmentService.listEnvironments(scanLimit);
      const candidates = environments
        .filter((item) => item.status === 'ready')
        .filter((item) => hasRecoverableToken(item.metadata))
        .filter((item) => hasRecoverableEndpoint(item.metadata))
        .filter((item) => isRecentEnough(item, maxAgeMs))
        .sort(compareCandidates)
        .slice(0, limit);

      if (candidates.length === 0) {
        return;
      }

      console.log(
        '[OSAC_PERSISTENT_RECOVER]',
        JSON.stringify({
          reason,
          candidates: candidates.length,
          scanLimit,
          limit,
          maxAgeMs,
          readyGateEnabled,
        })
      );

      for (const item of candidates) {
        const sessionId = item.sessionId;
        try {
          const connected = await osacConnectionManager.ensurePersistent(sessionId);
          let gateOk = connected;
          let gateError: string | null = null;

          if (connected && readyGateEnabled) {
            try {
              await this.withTimeout(
                'persistent_recover_ready_gate',
                readyGateTimeoutMs,
                osacAgentService.getSessionList(sessionId, { maxCount: 1, format: 'json' })
              );
            } catch (error) {
              gateOk = false;
              gateError = error instanceof Error ? error.message : String(error);
            }
          }

          console.log(
            '[OSAC_PERSISTENT_RECOVER_RESULT]',
            JSON.stringify({
              reason,
              sessionId,
              connected,
              gateOk,
              gateError,
            })
          );
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
    } finally {
      this.recovering = false;
    }
  }

  async recoverReadySessions() {
    if (this.started) {
      return;
    }
    this.started = true;

    if (shouldSkipPersistentRecover()) {
      console.log('[OSAC_PERSISTENT_RECOVER_SKIP]', 'fixed_session_mode');
      return;
    }

    const enabled = toBool(process.env.OSAC_PERSISTENT_RECOVER_ON_STARTUP, true);
    if (!enabled) {
      return;
    }

    await this.runRecoveryCycle('startup');
    this.startPeriodicRecovery();
  }
}

export const osacPersistentRecoveryService = new OsacPersistentRecoveryService();
