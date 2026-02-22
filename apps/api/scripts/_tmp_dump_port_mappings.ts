import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const sessions = [
  'sess_88fac327db574929',
  'sess_7c8523295e3848b1',
  'sess_20f2c9610d324a05',
  'sess_31689492ebb248bc'
];

async function main() {
  const { sandboxExecutionEnvironmentDAO } = await import('../src/db/dao');
  const { kvmConnector } = await import('../src/connectors/kvm-connector');

  for (const sid of sessions) {
    const env = await sandboxExecutionEnvironmentDAO.getBySessionId(sid);
    const metadata = (env?.metadata || {}) as any;
    let ports: any = null;
    try {
      const resp = await kvmConnector.listSandboxPorts(sid, {} as any);
      ports = resp?.data;
    } catch (e: any) {
      ports = { error: e?.message || String(e) };
    }

    console.log('---', sid, '---');
    console.log('status=', env?.status || null);
    console.log('osacEndpoint=', metadata?.osacEndpoint || null);
    console.log('vmIpAddress=', metadata?.vmIpAddress || null);
    console.log('osacHostPort=', metadata?.osacHostPort || null);
    console.log('osacAuthToken=', metadata?.osacAuthToken || null);
    console.log('portsRaw=', JSON.stringify(ports).slice(0, 2000));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
