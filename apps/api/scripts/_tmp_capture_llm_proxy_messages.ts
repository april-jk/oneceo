import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const sid = process.env.SID;
if (!sid) throw new Error('SID required');

async function sleep(ms:number){return new Promise(r=>setTimeout(r,ms));}

async function main(){
  const { osacConnector } = await import('../src/connectors/osac-connector');
  const { kvmConnector } = await import('../src/connectors/kvm-connector');

  const handle = await osacConnector.connectForSession(sid);
  console.log('connected');

  handle.onMessage((m:any)=>{
    const p = m?.payload || {};
    console.log('MSG', m.type, JSON.stringify({requestId: p.requestId || m.requestId || null, status: p.status || null, path: p.path || null, code: p?.error?.code || null}));
  });

  const exec = await kvmConnector.execSession(sid, {
    path:'/bin/bash',
    args:['-lc','curl -sS -m 60 http://127.0.0.1:18111/v1/models -H "Authorization: Bearer local-proxy" || true'],
    capture_output:true,
    timeout_seconds:75,
  });
  const jobId=(exec as any)?.data?.jobId||(exec as any)?.data?.job_id||(exec as any)?.jobId||(exec as any)?.job_id;
  if(jobId){
    for(let i=0;i<90;i++){
      const job=await kvmConnector.getJob(String(jobId));
      const s=(job as any)?.data?.status;
      if(s&&s!=='queued'&&s!=='running'){
        const p=(job as any)?.data?.result||(job as any)?.data||{};
        console.log('execDone', JSON.stringify({status:s, stdout:String(p.stdout||p.output||'').replace(/\s+/g,' ').trim().slice(0,300), stderr:String(p.stderr||'').replace(/\s+/g,' ').trim().slice(0,200)}));
        break;
      }
      await sleep(1000);
    }
  }

  await sleep(5000);
  handle.close();
}

main().catch((e)=>{console.error(e); process.exit(1);});
