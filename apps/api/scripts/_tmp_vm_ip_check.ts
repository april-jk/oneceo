import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const sid='sess_eaf60f9da28c4431';

async function sleep(ms:number){return new Promise(r=>setTimeout(r,ms));}

(async()=>{
  const {kvmConnector}=await import('../src/connectors/kvm-connector');
  const res=await kvmConnector.execSession(sid,{path:'/bin/bash',args:['-lc','hostname -I; ip -4 -o addr show scope global || true'],capture_output:true,timeout_seconds:20});
  const jobId=(res as any)?.data?.jobId||(res as any)?.data?.job_id||(res as any)?.jobId||(res as any)?.job_id;
  let final:any=res;
  if(jobId){for(let i=0;i<40;i++){const j=await kvmConnector.getJob(String(jobId)); const s=(j as any)?.data?.status; if(s&&s!=='queued'&&s!=='running'){final=j;break;} await sleep(1000);}}
  const payload=(final as any)?.data?.result||(final as any)?.data||{};
  console.log(String(payload.stdout||payload.output||''));
})();
