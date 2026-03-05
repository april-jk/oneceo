import dotenv from 'dotenv';
import WebSocket from 'ws';

dotenv.config({ path: '.env' });

const sid = process.argv[2] || 'sess_0e6ab87015e74907';

async function testWs(url: string, token: string): Promise<string> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${token}` } });
    const timer = setTimeout(() => {
      try { ws.terminate(); } catch {}
      resolve('timeout');
    }, 8000);

    ws.on('open', () => {
      clearTimeout(timer);
      ws.close();
      resolve('open');
    });

    ws.on('unexpected-response', (_req, res) => {
      clearTimeout(timer);
      resolve(`unexpected:${res.statusCode || 0}`);
    });

    ws.on('error', (err) => {
      clearTimeout(timer);
      resolve(`error:${err instanceof Error ? err.message : String(err)}`);
    });
  });
}

async function main() {
  const { sandboxExecutionEnvironmentDAO } = await import('../src/db/dao');
  const { kvmConnector } = await import('../src/connectors/kvm-connector');

  const env: any = await sandboxExecutionEnvironmentDAO.getBySessionId(sid);
  const md: any = env?.metadata || {};
  const token = String(md.osacAuthToken || '');
  const endpoint = String(md.osacEndpoint || '');

  const ports: any = await kvmConnector.listSandboxPorts(sid, {
    refresh: 'true',
    verify: 'true',
    wait_seconds: '3',
  } as any);
  const items = ports?.data?.items || [];
  const hostPort = items?.[0]?.hostPort || items?.[0]?.host_port;
  const relayHost = new URL(process.env.KVM_ORCHESTRATOR_URL || '').hostname;
  const hostEndpoint = hostPort ? `ws://${relayHost}:${hostPort}/ws` : '';

  console.log(JSON.stringify({ sid, endpoint, hostPort, hostEndpoint }, null, 2));
  console.log('vm_endpoint=', await testWs(endpoint, token));
  if (hostEndpoint) {
    console.log('hostport_endpoint=', await testWs(hostEndpoint, token));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
