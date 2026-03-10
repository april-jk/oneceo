import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const sid = process.argv[2];
const cmd = process.argv.slice(3).join(' ');
if (!sid || !cmd) throw new Error('usage: sid cmd');

async function sleep(ms:number){return new Promise(r=>setTimeout(r,ms));}

(async()=>{
  const {kvmConnector}=await import('../src/connectors/kvm-connector');
  const r=await kvmConnector.execSession(sid,{path:'/bin/bash',args:['-lc',cmd],capture_output:true,timeout_seconds:90});
  const jobId=(r as any)?.data?.jobId||(r as any)?.data?.job_id||(r as any)?.jobId||(r as any)?.job_id;
  let fin:any=r;
  if(jobId){for(let i=0;i<120;i++){const j=await kvmConnector.getJob(String(jobId));const s=(j as any)?.data?.status; if(s&&s!=='queued'&&s!=='running'){fin=j;break;} await sleep(1000);}}
  const d=(fin as any)?.data||{};
  const p=d?.result||d||{};
  console.log(JSON.stringify({status:d?.status||p?.status||'unknown', stdout:String(p.stdout||p.output||''), stderr:String(p.stderr||'')}));
})();
