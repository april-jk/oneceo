import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const name = process.argv[2];
if (!name) throw new Error('vm name required');

(async()=>{
  const { kvmConnector } = await import('../src/connectors/kvm-connector');
  const res = await kvmConnector.getVm(name);
  console.log(JSON.stringify(res, null, 2));
})();
