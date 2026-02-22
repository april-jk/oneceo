const dotenv = require('dotenv');
dotenv.config({ path: '.env' });
const { Client } = require('pg');
(async()=>{
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: false });
  await c.connect();
  const res = await c.query("select session_id, created_at, metadata->>'purpose' as purpose from sandbox_execution_environments where metadata->>'purpose' like 'manual-fix1-e2e%' order by created_at desc limit 5");
  console.log(JSON.stringify(res.rows,null,2));
  await c.end();
})();
