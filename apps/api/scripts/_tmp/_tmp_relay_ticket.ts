import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const sid = process.argv[2];
if (!sid) throw new Error('sid required');

(async()=>{
  const { kvmConnector } = await import('../src/connectors/kvm-connector');
  const res = await kvmConnector.createRelayTcpTicket(sid, { target_port: 18080, target_host: 'vm' });
  console.log(JSON.stringify(res, null, 2));
})();
