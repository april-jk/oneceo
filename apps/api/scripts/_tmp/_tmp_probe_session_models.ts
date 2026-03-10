import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const sid = process.env.SID;
if (!sid) throw new Error('SID required');

async function sleep(ms:number){return new Promise(r=>setTimeout(r,ms));}

async function main(){
  const { kvmConnector } = await import('../src/connectors/kvm-connector');

  async function exec(command:string, timeoutSeconds=75){
    const r = await kvmConnector.execSession(sid, {
      path:'/bin/bash',
      args:['-lc', command],
      capture_output:true,
      timeout_seconds: timeoutSeconds,
    });
    const jobId = (r as any)?.data?.jobId || (r as any)?.data?.job_id || (r as any)?.jobId || (r as any)?.job_id;
    let fin:any = r;
    if(jobId){
      for(let i=0;i<95;i++){
        const j = await kvmConnector.getJob(String(jobId));
        const s = (j as any)?.data?.status;
        if(s && s !== 'queued' && s !== 'running'){ fin = j; break; }
        await sleep(1000);
      }
    }
    const p = (fin as any)?.data?.result || (fin as any)?.data || fin || {};
    return {
      status: (fin as any)?.data?.status || p.status || 'unknown',
      exit: p.exitcode ?? p.exitCode ?? null,
      stdout: String(p.stdout || p.output || ''),
      stderr: String(p.stderr || ''),
    };
  }

  const models = await exec('curl -sS -m 60 http://127.0.0.1:18111/v1/models -H "Authorization: Bearer local-proxy" || true', 80);
  console.log('modelsProbe=', JSON.stringify({status: models.status, exit: models.exit, stdout: models.stdout.replace(/\s+/g,' ').trim().slice(0,1600), stderr: models.stderr.replace(/\s+/g,' ').trim().slice(0,300)}));

  const logTail = await exec('tail -n 50 /opt/.altus/opencode/log/osac.log 2>/dev/null || true', 30);
  console.log('osacLogTail=', logTail.stdout.replace(/\s+/g,' ').trim().slice(0,4000));
}

main().catch((e)=>{ console.error(e); process.exit(1); });
