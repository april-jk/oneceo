const dotenv=require('dotenv');dotenv.config({path:'.env'});
const {Client}=require('pg');
(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL,ssl:false});await c.connect();
const r=await c.query("select session_id, metadata->>'osacEndpoint' ep, metadata->>'osacAuthToken' tok from sandbox_execution_environments where session_id in ('sess_b20d406dcb2b4a3c','sess_6aafa07c82ee40d0')");
console.log(r.rows);await c.end();})();
