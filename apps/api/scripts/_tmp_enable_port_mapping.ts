import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const sid = process.argv[2];
const hostPort = Number(process.argv[3] || 23080);
if (!sid) throw new Error('sid required');
if (!Number.isFinite(hostPort) || hostPort <= 0) throw new Error('invalid hostPort');

(async()=>{
  const { kvmConnector } = await import('../src/connectors/kvm-connector');
  const { sandboxExecutionEnvironmentDAO } = await import('../src/db/dao');

  const env = await sandboxExecutionEnvironmentDAO.getBySessionId(sid);
  const host = (env?.metadata as any)?.osacHost || (env?.metadata as any)?.orchestratorHost || undefined;

  let portResult: any = null;
  try {
    portResult = await kvmConnector.createSandboxPort(sid, {
      vm_port: 18080,
      host_port: hostPort,
      protocol: 'tcp',
    });
    console.log('PORT=', JSON.stringify(portResult?.data || portResult, null, 2));
  } catch (error: any) {
    console.warn('PORT_ERR=', error?.message || String(error));
  }

  const endpoint = host ? `ws://${host}:${hostPort}/ws` : undefined;
  await sandboxExecutionEnvironmentDAO.updateMetadata(sid, {
    osacConnectionMode: 'port-mapping',
    osacHostPort: hostPort,
    ...(endpoint ? { osacEndpoint: endpoint } : {}),
  });

  console.log('METADATA_UPDATED', JSON.stringify({ osacConnectionMode: 'port-mapping', osacHostPort: hostPort, osacEndpoint: endpoint || null }, null, 2));
})();
