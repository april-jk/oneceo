import dotenv from 'dotenv';
dotenv.config({ path: '.env' });
(async()=>{
  const { kvmConnector } = await import('./src/connectors/kvm-connector');
  try {
    const r = await kvmConnector.health();
    console.log(JSON.stringify(r));
  } catch (e:any) {
    console.error(e?.message || String(e));
    process.exit(1);
  }
})();
