import { kvmConnector } from '../src/connectors/kvm-connector';
import { KvmClientError } from '../src/clients/kvm-orchestrator-client';

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function extractSessionId(payload: Record<string, unknown> | null | undefined): string | null {
  if (!payload) return null;
  const session = payload.session && typeof payload.session === 'object' ? (payload.session as Record<string, unknown>) : null;
  return pickString(payload.sessionId, payload.session_id, payload.orchestratorSessionId, payload.orchestrator_session_id, session?.sessionId, session?.session_id, session?.id);
}

async function main() {
  const out: Record<string, unknown> = { startedAt: new Date().toISOString(), steps: [] };
  let claimedSessionId: string | null = null;

  try {
    const health = await kvmConnector.health();
    (out.steps as any[]).push({ step: 'health', ok: true, data: health.data });

    const status = await kvmConnector.getPoolSandboxesStatus();
    (out.steps as any[]).push({ step: 'pool_status', ok: true, data: status.data });

    const claim = await kvmConnector.claimPoolSandbox({ purpose: 'manual_probe', timeout_ms: 8000 });
    const claimData = (claim.data || {}) as Record<string, unknown>;
    claimedSessionId = extractSessionId(claimData);
    (out.steps as any[]).push({
      step: 'pool_claim',
      ok: true,
      requestId: claim.requestId || null,
      sessionId: claimedSessionId,
      claimData,
    });

    if (claimedSessionId) {
      const sandbox = await kvmConnector.getSandbox(claimedSessionId);
      (out.steps as any[]).push({
        step: 'sandbox_state',
        ok: true,
        data: sandbox.data,
      });

      const ticket = await kvmConnector.createRelayTcpTicket(claimedSessionId, {
        target_port: 18080,
        target_host: 'vm',
        connect_timeout_ms: 5000,
        idle_timeout_ms: 180000,
        ticket_ttl_ms: 30000,
        single_use: true,
      });
      (out.steps as any[]).push({
        step: 'relay_ticket',
        ok: true,
        data: ticket.data,
      });
    }
  } catch (error) {
    const kvmError = error instanceof KvmClientError ? error : null;
    (out.steps as any[]).push({
      step: 'error',
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      status: kvmError?.status,
      code: kvmError?.code,
      retryable: kvmError?.retryable,
      actionHint: kvmError?.actionHint,
      details: kvmError?.details,
    });
  } finally {
    if (claimedSessionId) {
      try {
        const released = await kvmConnector.releasePoolSandbox(claimedSessionId, {
          result: 'failed',
          reason: 'manual_probe_cleanup',
        });
        (out.steps as any[]).push({ step: 'pool_release', ok: true, data: released.data });
      } catch (error) {
        (out.steps as any[]).push({
          step: 'pool_release',
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  out.endedAt = new Date().toISOString();
  console.log(JSON.stringify(out, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
