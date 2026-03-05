import dotenv from 'dotenv';
import path from 'path';
import { sandboxEnvironmentService } from '../src/services/sandbox-environment-service';
import { kvmConnector } from '../src/connectors/kvm-connector';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const traceId = `openenv-probe-${Date.now()}`;
  const out: Record<string, unknown> = { traceId, startedAt: new Date().toISOString(), steps: [] };
  let sessionId: string | null = null;

  try {
    const env = await sandboxEnvironmentService.openEnvironment({
      metadata: { traceId, source: 'openenv_probe' },
    });
    sessionId = env.sessionId;
    (out.steps as any[]).push({ step: 'open_environment', ok: true, env });

    for (let i = 0; i < 8; i++) {
      const sandbox = await kvmConnector.getSandbox(sessionId);
      const data = (sandbox.data || {}) as Record<string, unknown>;
      const lifecycleState = pickString(data.lifecycleState, data.lifecycle_state, data.state);
      const lifecycleStage = pickString(data.lifecycleStage, data.lifecycle_stage);
      (out.steps as any[]).push({
        step: 'sandbox_poll',
        idx: i + 1,
        lifecycleState,
        lifecycleStage,
        readyGate: data.readyGate || data.ready_gate || null,
        lastError: data.lastError || data.last_error || null,
      });
      if (lifecycleState && ['ready', 'failed'].includes(lifecycleState.toLowerCase())) {
        break;
      }
      await sleep(5000);
    }
  } catch (error) {
    (out.steps as any[]).push({
      step: 'open_environment',
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    if (sessionId) {
      try {
        const closed = await sandboxEnvironmentService.closeEnvironment(sessionId);
        (out.steps as any[]).push({ step: 'close_environment', ok: true, closed });
      } catch (error) {
        (out.steps as any[]).push({ step: 'close_environment', ok: false, error: error instanceof Error ? error.message : String(error) });
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
