import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

import { OsacClient } from '../src/clients/osac-client';

const sid='sess_eaf60f9da28c4431';
const mapped='ws://192.168.10.172:20078/ws';
const token='234a6ab360b943a3fc40cae58e0274c3b1efc42ad2b29669';

async function sleep(ms:number){return new Promise(r=>setTimeout(r,ms));}

async function exec(cmd:string){
  const {kvmConnector}=await import('../src/connectors/kvm-connector');
  const res=await kvmConnector.execSession(sid,{path:'/bin/bash',args:['-lc',cmd],capture_output:true,timeout_seconds:25});
  const jobId=(res as any)?.data?.jobId||(res as any)?.data?.job_id||(res as any)?.jobId||(res as any)?.job_id;
  let final:any=res;
  if(jobId){for(let i=0;i<40;i++){const j=await kvmConnector.getJob(String(jobId)); const s=(j as any)?.data?.status; if(s&&s!=='queued'&&s!=='running'){final=j;break;} await sleep(1000);}}
  const p=(final as any)?.data?.result||(final as any)?.data||{};
  return String(p.stdout||p.output||'');
}

(async()=>{
  console.log('beforeLog=');
  console.log(await exec('tail -n 20 /opt/.altus/opencode/log/osac.log 2>/dev/null || true'));

  const c=new OsacClient(mapped,{authToken:token,connectTimeoutMs:5000,requestTimeoutMs:8000});
  try{await c.connect(); console.log('ws=ok');}
  catch(e:any){console.log('ws=fail',e?.message||String(e));}
  finally{try{c.close();}catch{}}

  await sleep(1500);
  console.log('afterLog=');
  console.log(await exec('tail -n 20 /opt/.altus/opencode/log/osac.log 2>/dev/null || true'));
})();
