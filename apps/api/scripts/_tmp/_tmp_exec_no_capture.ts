import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const sid = process.argv[2];
const cmd = process.argv.slice(3).join(' ');
if (!sid || !cmd) throw new Error('usage');

async function sleep(ms:number){return new Promise(r=>setTimeout(r,ms));}

(async()=>{
  const {kvmConnector}=await import('../src/connectors/kvm-connector');
  const r=await kvmConnector.execSession(sid,{path:'/bin/bash',args:['-lc',cmd],capture_output:false,timeout_seconds:40});
  const jobId=(r as any)?.data?.jobId||(r as any)?.data?.job_id||(r as any)?.jobId||(r as any)?.job_id;
  let fin:any=r;
  if(jobId){for(let i=0;i<90;i++){const j=await kvmConnector.getJob(String(jobId));const s=(j as any)?.data?.status; if(s&&s!=='queued'&&s!=='running'){fin=j;break;} await sleep(1000);}}
  const d=(fin as any)?.data||{};
  console.log(JSON.stringify({status:d?.status||'unknown', error:d?.error||null}));
})();
