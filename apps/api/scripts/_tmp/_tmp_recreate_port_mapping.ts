import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const sid = process.argv[2];
const hostPort = Number(process.argv[3] || 23080);
const hostIp = process.argv[4] || '192.168.10.172';
if (!sid) throw new Error('sid required');

(async()=>{
  const { kvmConnector } = await import('../src/connectors/kvm-connector');
  const { sandboxExecutionEnvironmentDAO } = await import('../src/db/dao');

  try {
    const del = await kvmConnector.deleteSandboxPort(sid, { host_port: String(hostPort), protocol: 'tcp', host_ip: hostIp });
    console.log('DELETE=', JSON.stringify(del, null, 2));
  } catch (error: any) {
    console.warn('DELETE_ERR=', error?.message || String(error));
  }

  const created = await kvmConnector.createSandboxPort(sid, {
    vm_port: 18080,
    host_port: hostPort,
    protocol: 'tcp',
    host_ip: hostIp,
  });
  console.log('CREATED=', JSON.stringify(created, null, 2));

  const endpoint = `ws://${hostIp}:${hostPort}/ws`;
  await sandboxExecutionEnvironmentDAO.updateMetadata(sid, {
    osacConnectionMode: 'port-mapping',
    osacHostPort: hostPort,
    osacEndpoint: endpoint,
    osacHost: hostIp,
    osacAuthToken: 'manual_fix_session_35ff',
    taskTitle: '创建单文件 HTML 贪吃蛇游戏',
    fixedSandbox: { vmName: 'test_session_manual_use', enabled: true, sessionId: sid },
    osacMappingId: 'portmap:sess_4471f12d0bc444d3:18080',
    sandboxStatus: 'ready',
    taskSessionId: 'b3534c14-8ffd-4ddb-9994-8b036c919872',
    allocationSource: 'fixed_session',
    osacMappingEpoch: 1,
  });
  console.log('METADATA_UPDATED');
})();
