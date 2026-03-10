import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

async function main() {
  const sid = 'sess_6db835f3b5124ba4';
  process.env.OSAC_KVM_RELAY_TARGET_PORT = '19090';

  const { ensureDatabaseConnection } = await import('../src/config/database');
  const { sandboxExecutionEnvironmentDAO } = await import('../src/db/dao');
  await ensureDatabaseConnection({ retries: 1, delayMs: 0 });

  const exists: any = await sandboxExecutionEnvironmentDAO.getBySessionId(sid);
  if (!exists) {
    await sandboxExecutionEnvironmentDAO.createEnvironment({
      sessionId: sid,
      orchestratorSessionId: sid,
      vmName: 'kvm_orch_test_20260208_114556',
      baseImage: 'relay-test',
      incrementalStorageDir: '/tmp',
      incrementalFileName: 'relay-test.qcow2',
      incrementalFilePath: '/tmp/relay-test.qcow2',
      status: 'ready',
      securityProfile: {},
      networkPolicy: {},
      metadata: {
        osacConnectionMode: 'kvm-tcp-relay',
        osacEndpoint: 'ws://127.0.0.1:19090/ws',
        osacAuthToken: 'dummy-token',
      },
    } as any);
    console.log('ROW=created');
  } else {
    console.log('ROW=exists');
  }

  const { osacConnector } = await import('../src/connectors/osac-connector');
  try {
    await osacConnector.connectForSession(sid);
    console.log('CONNECT=unexpected-success');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log('CONNECT_ERR=', message);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
