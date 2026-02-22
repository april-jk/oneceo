const dotenv=require('dotenv');dotenv.config({path:'.env'});
const {Client}=require('pg');
(async()=>{
 const c=new Client({connectionString:process.env.DATABASE_URL,ssl:false}); await c.connect();
 const res=await c.query("select session_id, created_at, status, metadata->>'purpose' as purpose from sandbox_execution_environments where metadata->>'purpose' is not null order by created_at desc limit 10");
 console.log(JSON.stringify(res.rows,null,2));
 await c.end();
})();
