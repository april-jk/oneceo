import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const sid = process.argv[2];
const vmName = process.argv[3] || 'sandbox_sess_0042e555cc414cae';
const token = process.argv[4] || 'focus_token_1';

if (!sid) {
  throw new Error('usage: pnpm exec tsx scripts/_tmp_seed_osac_metadata.ts <sessionId> [vmName] [token]');
}

async function main() {
  const { ensureDatabaseConnection } = await import('../src/config/database');
  const { sandboxExecutionEnvironmentDAO } = await import('../src/db/dao');

  await ensureDatabaseConnection({ retries: 1, delayMs: 100 });
  const row: any = await sandboxExecutionEnvironmentDAO.getBySessionId(sid);

  const metadata = {
    owner: 'codex-focus',
    purpose: 'sandbox-internal-osac-proxy-check',
    osacConnectionMode: 'kvm-tcp-relay',
    osacEndpoint: 'ws://127.0.0.1:18080/ws',
    osacAuthToken: token,
    osacToken: token,
    osacHostPort: null,
    osacPort: 18080,
  } as Record<string, unknown>;

  if (!row) {
    await sandboxExecutionEnvironmentDAO.createEnvironment({
      sessionId: sid,
      orchestratorSessionId: sid,
      vmName,
      baseImage: process.env.KVM_SANDBOX_BASE_IMAGE || 'unknown',
      incrementalStorageDir: '/var/lib/libvirt/images/sandboxes',
      incrementalFileName: `${vmName}.qcow2`,
      incrementalFilePath: `/var/lib/libvirt/images/sandboxes/${sid}/${vmName}.qcow2`,
      status: 'ready',
      securityProfile: {},
      networkPolicy: {},
      metadata,
    } as any);
    console.log('ROW_CREATED');
  } else {
    await sandboxExecutionEnvironmentDAO.updateMetadata(sid, {
      ...(row.metadata || {}),
      ...metadata,
    });
    console.log('ROW_UPDATED');
  }

  const next: any = await sandboxExecutionEnvironmentDAO.getBySessionId(sid);
  console.log(
    JSON.stringify(
      {
        sid,
        status: next?.status || null,
        vmName: next?.vmName || null,
        metadata: {
          osacConnectionMode: next?.metadata?.osacConnectionMode || null,
          osacEndpoint: next?.metadata?.osacEndpoint || null,
          osacAuthToken: next?.metadata?.osacAuthToken || null,
        },
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
