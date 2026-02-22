const dotenv = require('dotenv');
dotenv.config({ path: '.env' });
const { Client } = require('pg');
(async()=>{
  const cs = process.env.DATABASE_URL;
  const c = new Client({ connectionString: cs, ssl: false });
  await c.connect();
  const q = `select session_id, metadata, created_at from sandbox_execution_environments order by created_at desc limit 20`;
  const res = await c.query(q);
  for (const r of res.rows) {
    const purpose = r?.metadata?.purpose;
    if (purpose && String(purpose).includes('binary-api-e2e')) {
      console.log(JSON.stringify({sid:r.session_id, created_at:r.created_at, purpose, endpoint:r?.metadata?.osacEndpoint}));
    }
  }
  await c.end();
})();
