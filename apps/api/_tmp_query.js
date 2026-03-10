const {Client}=require("pg");
const sid=process.env.SID;
const cs=process.env.DB;
(async()=>{
  const c=new Client({connectionString:cs, ssl:false});
  await c.connect();
  const res=await c.query('select session_id, metadata from sandbox_execution_environments where session_id=$1',[sid]);
  console.log(JSON.stringify(res.rows[0]||null));
  await c.end();
})().catch(e=>{console.error(e); process.exit(1);});
