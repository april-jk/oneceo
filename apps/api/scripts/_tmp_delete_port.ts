import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const sid = process.argv[2];
const hostPort = process.argv[3] || '23080';
const hostIp = process.argv[4] || '192.168.10.172';
const vmPort = process.argv[5];
if (!sid) throw new Error('sid required');

(async()=>{
  const { kvmConnector } = await import('../src/connectors/kvm-connector');
  const query: Record<string, string> = { host_port: hostPort, protocol: 'tcp', host_ip: hostIp };
  if (vmPort) {
    query.vm_port = String(vmPort);
  }
  const res = await kvmConnector.deleteSandboxPort(sid, query);
  console.log(JSON.stringify(res, null, 2));
})();
