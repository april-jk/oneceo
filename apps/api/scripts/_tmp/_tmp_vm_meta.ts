import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const sid = process.argv[2];
if (!sid) throw new Error('sid required');

(async()=>{
  const { kvmConnector } = await import('../src/connectors/kvm-connector');
  const vm = await kvmConnector.getSessionVm(sid);
  console.log(JSON.stringify(vm?.data || vm, null, 2));
})();
