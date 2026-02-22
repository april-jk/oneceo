import { ensureDatabaseConnection } from '../src/config/database';
import { sandboxEnvironmentService } from '../src/services/sandbox-environment-service';

const sessionId = process.env.SEED_SESSION_ID || 'sess_4471f12d0bc444d3';
const vmName = process.env.SEED_VM_NAME || 'test_session_manual_use';
const osacEndpoint = process.env.SEED_OSAC_ENDPOINT || 'ws://127.0.0.1:18080/ws';
const osacAuthToken = process.env.SEED_OSAC_TOKEN || 'manual_fix_session_35ff';
const orchestratorUrl = process.env.KVM_ORCHESTRATOR_URL || '';
let orchestratorHost: string | null = null;
try {
  orchestratorHost = orchestratorUrl ? new URL(orchestratorUrl).hostname : null;
} catch {
  orchestratorHost = null;
}

async function main() {
  await ensureDatabaseConnection({ retries: 3, delayMs: 1000 });
  const metadata = {
    osacEndpoint,
    osacAuthToken,
    osacConnectionMode: 'kvm-tcp-relay',
    osacHost: orchestratorHost || undefined,
    fixedSandbox: {
      enabled: true,
      sessionId,
      vmName,
    },
  };

  const row = await sandboxEnvironmentService.attachPoolEnvironment({
    sessionId,
    vmName,
    metadata,
    status: 'ready',
  });

  console.log('[seed-fixed-env] ok', {
    sessionId,
    vmName,
    hasEndpoint: Boolean(osacEndpoint),
    hasToken: Boolean(osacAuthToken),
    storedId: row?.id || null,
  });
}

main().catch((err) => {
  console.error('[seed-fixed-env] failed', err);
  process.exit(1);
});
