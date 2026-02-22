import dotenv from 'dotenv';
import path from 'path';
import { sandboxAgentProvisionService } from '../src/services/sandbox-agent-provision-service';
import { osacAgentService } from '../src/services/osac-agent-service';
import { sandboxEnvironmentService } from '../src/services/sandbox-environment-service';

dotenv.config({ path: path.resolve(process.cwd(), 'apps/api/.env') });

function now() {
  return new Date().toISOString();
}

function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

async function main() {
  const startedAt = Date.now();
  const traceId = `kvm-pool-retest-${Date.now()}`;
  const out: Record<string, unknown> = {
    traceId,
    startedAt: now(),
    steps: [],
  };

  let sessionId: string | null = null;

  try {
    const provision = await sandboxAgentProvisionService.provision({
      metadata: {
        traceId,
        source: 'manual_retest',
        purpose: 'kvm_pool_fix13_retest',
      },
      requestBaseUrl: 'http://127.0.0.1:4000',
    });

    sessionId = provision.sessionId;

    (out.steps as any[]).push({
      step: 'provision',
      ok: true,
      sessionId: provision.sessionId,
      status: provision.status,
      allocationSource: provision.allocationSource,
      degradedFromWarmPool: provision.degradedFromWarmPool,
      connectionMode: provision.osacConnectionMode,
      endpoint: provision.osacEndpoint,
    });

    try {
      const list = await osacAgentService.getSessionList(provision.sessionId, { maxCount: 1, format: 'json' });
      (out.steps as any[]).push({
        step: 'osac_get_session_list',
        ok: true,
        listKeys: list && typeof list === 'object' ? Object.keys(list as Record<string, unknown>) : [],
      });
    } catch (error) {
      (out.steps as any[]).push({
        step: 'osac_get_session_list',
        ok: false,
        error: toMessage(error),
      });
      throw error;
    }
  } catch (error) {
    (out.steps as any[]).push({
      step: 'provision_or_probe',
      ok: false,
      error: toMessage(error),
    });
  } finally {
    if (sessionId) {
      try {
        const closed = await sandboxEnvironmentService.closeEnvironment(sessionId);
        (out.steps as any[]).push({
          step: 'close_environment',
          ok: true,
          status: closed.status,
        });
      } catch (error) {
        (out.steps as any[]).push({
          step: 'close_environment',
          ok: false,
          error: toMessage(error),
        });
      }
    }
  }

  out.endedAt = now();
  out.elapsedMs = Date.now() - startedAt;

  const hasFailure = (out.steps as any[]).some((s) => s.ok !== true);
  console.log(JSON.stringify(out, null, 2));

  if (hasFailure) {
    process.exit(2);
  }
}

main().catch((error) => {
  console.error('[fatal]', toMessage(error));
  process.exit(1);
});
