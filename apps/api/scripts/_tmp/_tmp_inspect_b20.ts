import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const sid='sess_b20d406dcb2b4a3c';
(async()=>{
  const { sandboxExecutionEnvironmentDAO } = await import('../src/db/dao');
  const { kvmConnector } = await import('../src/connectors/kvm-connector');
  const env = await sandboxExecutionEnvironmentDAO.getBySessionId(sid);
  const md = (env?.metadata||{}) as any;
  console.log('metadata', JSON.stringify({endpoint:md.osacEndpoint, token:md.osacAuthToken, vmIp:md.vmIpAddress, hostPort:md.osacHostPort}, null,2));
  try {
    const ports = await kvmConnector.listSandboxPorts(sid, {refresh:'true', verify:'true', wait_seconds:'5'} as any);
    console.log('ports', JSON.stringify(ports?.data || {}, null, 2));
  } catch(e:any){
    console.log('portsErr', e?.message || String(e));
  }
})();
