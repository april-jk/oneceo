import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

async function main(){
  const sid='sess_eaf60f9da28c4431';
  const { sandboxExecutionEnvironmentDAO } = await import('../src/db/dao');
  const { kvmConnector } = await import('../src/connectors/kvm-connector');
  const env = await sandboxExecutionEnvironmentDAO.getBySessionId(sid);
  console.log('metadata=', JSON.stringify(env?.metadata||{}, null, 2));
  const ports = await kvmConnector.listSandboxPorts(sid, { refresh: 'true', verify:'true', wait_seconds:'5'} as any);
  console.log('ports=', JSON.stringify(ports?.data||{}, null, 2));
}
main().catch(e=>{console.error(e);process.exit(1)});
