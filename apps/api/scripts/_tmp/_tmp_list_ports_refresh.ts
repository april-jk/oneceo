import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const sid = process.argv[2];
if (!sid) throw new Error('sid required');

(async()=>{
  const { kvmConnector } = await import('../src/connectors/kvm-connector');
  const { buildSandboxPortProbeQuery } = await import('../src/connectors/kvm-call-pattern');
  const res = await kvmConnector.listSandboxPorts(sid, buildSandboxPortProbeQuery());
  console.log(JSON.stringify(res, null, 2));
})();
