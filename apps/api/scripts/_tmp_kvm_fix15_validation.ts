import dotenv from 'dotenv';
import path from 'path';
import { kvmConnector } from '../src/connectors/kvm-connector';
import { KvmClientError } from '../src/clients/kvm-orchestrator-client';
import { sandboxAgentProvisionService } from '../src/services/sandbox-agent-provision-service';
import { osacAgentService } from '../src/services/osac-agent-service';
import { sandboxEnvironmentService } from '../src/services/sandbox-environment-service';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function extractSessionId(payload: Record<string, unknown> | null | undefined): string | null {
  if (!payload) return null;
  const session = payload.session && typeof payload.session === 'object'
    ? (payload.session as Record<string, unknown>)
    : null;
  return pickString(
    payload.sessionId,
    payload.session_id,
    payload.orchestratorSessionId,
    payload.orchestrator_session_id,
    session?.sessionId,
    session?.session_id,
    session?.id
  );
}

async function withTimeout<T>(label: string, timeoutMs: number, promise: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}_timeout_${timeoutMs}ms`)), timeoutMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function main() {
  process.env.KVM_HTTP_TIMEOUT_POOL_CLAIM_MS = process.env.KVM_HTTP_TIMEOUT_POOL_CLAIM_MS || '20000';
  process.env.KVM_HTTP_RETRIES_POOL_CLAIM = process.env.KVM_HTTP_RETRIES_POOL_CLAIM || '0';

  const out: Record<string, unknown> = {
    startedAt: new Date().toISOString(),
    versionExpected: '1.3.3fix15',
    steps: [],
  };

  let claimSessionId: string | null = null;
  let provisionSessionId: string | null = null;

  try {
    const health = await withTimeout('health', 20000, kvmConnector.health());
    (out.steps as any[]).push({ step: 'health', ok: true, data: health.data });

    const t0 = Date.now();
    try {
      await kvmConnector.claimPoolSandbox({ purpose: 'fix15-timeout-zero', timeout_ms: 0 });
      (out.steps as any[]).push({
        step: 'claim_timeout_zero',
        ok: false,
        elapsedMs: Date.now() - t0,
        message: 'unexpected success',
      });
    } catch (error) {
      const ke = error instanceof KvmClientError ? error : null;
      (out.steps as any[]).push({
        step: 'claim_timeout_zero',
        ok: true,
        elapsedMs: Date.now() - t0,
        status: ke?.status,
        code: ke?.code,
        message: toMessage(error),
      });
    }

    const t1 = Date.now();
    try {
      const ensure = await withTimeout('pool_ensure', 15000, kvmConnector.ensurePoolSandboxes());
      (out.steps as any[]).push({
        step: 'pool_ensure_async',
        ok: true,
        elapsedMs: Date.now() - t1,
        data: ensure.data,
      });
    } catch (error) {
      const ke = error instanceof KvmClientError ? error : null;
      (out.steps as any[]).push({
        step: 'pool_ensure_async',
        ok: false,
        elapsedMs: Date.now() - t1,
        status: ke?.status,
        code: ke?.code,
        message: toMessage(error),
      });
    }

    const status = await withTimeout('pool_status', 20000, kvmConnector.getPoolSandboxesStatus());
    (out.steps as any[]).push({
      step: 'pool_status',
      ok: true,
      data: status.data,
    });

    const t2 = Date.now();
    try {
      const claim = await withTimeout(
        'claim_timeout_8s',
        25000,
        kvmConnector.claimPoolSandbox({ purpose: 'fix15-claim', timeout_ms: 8000 })
      );
      const claimData = (claim.data || {}) as Record<string, unknown>;
      claimSessionId = extractSessionId(claimData);
      (out.steps as any[]).push({
        step: 'claim_timeout_8s',
        ok: true,
        elapsedMs: Date.now() - t2,
        requestId: claim.requestId,
        sessionId: claimSessionId,
        data: claimData,
      });

      if (claimSessionId) {
        const ticket = await withTimeout(
          'relay_ticket',
          20000,
          kvmConnector.createRelayTcpTicket(claimSessionId, {
            target_port: 18080,
            target_host: 'vm',
            connect_timeout_ms: 5000,
            idle_timeout_ms: 180000,
            ticket_ttl_ms: 30000,
            single_use: true,
          })
        );
        (out.steps as any[]).push({ step: 'relay_ticket_18080', ok: true, data: ticket.data });
      }
    } catch (error) {
      const ke = error instanceof KvmClientError ? error : null;
      (out.steps as any[]).push({
        step: 'claim_timeout_8s',
        ok: false,
        elapsedMs: Date.now() - t2,
        status: ke?.status,
        code: ke?.code,
        retryable: ke?.retryable,
        actionHint: ke?.actionHint,
        message: toMessage(error),
      });
    }

    try {
      const provision = await withTimeout(
        'provision_e2e',
        220000,
        sandboxAgentProvisionService.provision({
          metadata: {
            source: 'fix15_validation',
            purpose: 'fix15_validation',
          },
          requestBaseUrl: 'http://127.0.0.1:4000',
        })
      );
      provisionSessionId = provision.sessionId;
      (out.steps as any[]).push({
        step: 'provision',
        ok: true,
        data: {
          sessionId: provision.sessionId,
          status: provision.status,
          allocationSource: provision.allocationSource,
          degradedFromWarmPool: provision.degradedFromWarmPool,
          osacConnectionMode: provision.osacConnectionMode,
          osacEndpoint: provision.osacEndpoint,
        },
      });

      const sessionList = await withTimeout(
        'osac_get_session_list',
        30000,
        osacAgentService.getSessionList(provision.sessionId, { maxCount: 1, format: 'json' })
      );
      (out.steps as any[]).push({
        step: 'osac_get_session_list',
        ok: true,
        keys: sessionList && typeof sessionList === 'object' ? Object.keys(sessionList as Record<string, unknown>) : [],
      });
    } catch (error) {
      const ke = error instanceof KvmClientError ? error : null;
      (out.steps as any[]).push({
        step: 'provision_or_osac_probe',
        ok: false,
        status: ke?.status,
        code: ke?.code,
        retryable: ke?.retryable,
        actionHint: ke?.actionHint,
        message: toMessage(error),
      });
    }
  } finally {
    if (claimSessionId) {
      try {
        const released = await withTimeout(
          'release_claimed_pool_session',
          20000,
          kvmConnector.releasePoolSandbox(claimSessionId, {
            result: 'failed',
            reason: 'fix15_validation_cleanup',
          })
        );
        (out.steps as any[]).push({ step: 'release_claimed_pool_session', ok: true, data: released.data });
      } catch (error) {
        (out.steps as any[]).push({
          step: 'release_claimed_pool_session',
          ok: false,
          message: toMessage(error),
        });
      }
    }

    if (provisionSessionId) {
      try {
        const closed = await withTimeout(
          'close_provision_session',
          30000,
          sandboxEnvironmentService.closeEnvironment(provisionSessionId)
        );
        (out.steps as any[]).push({ step: 'close_provision_session', ok: true, status: closed.status });
      } catch (error) {
        (out.steps as any[]).push({
          step: 'close_provision_session',
          ok: false,
          message: toMessage(error),
        });
      }
    }
  }

  out.endedAt = new Date().toISOString();
  console.log(JSON.stringify(out, null, 2));
}

main().catch((error) => {
  console.error('[fatal]', toMessage(error));
  process.exit(1);
});
