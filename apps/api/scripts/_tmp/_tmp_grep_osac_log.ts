import dotenv from 'dotenv';
dotenv.config({ path: '.env' });
const sid = String(process.env.SID || process.env.OSAC_FIXED_SANDBOX_SESSION_ID || '').trim();
if (!sid) {
  throw new Error('SID or OSAC_FIXED_SANDBOX_SESSION_ID is required');
}
const { kvmConnector } = await import('../src/connectors/kvm-connector');

async function sleep(ms:number){ await new Promise(r=>setTimeout(r,ms)); }
async function waitJob(jobId:string){
  for(let i=0;i<180;i++){
    const job = await kvmConnector.getJob(jobId);
    const st = (job as any)?.data?.status;
    if(st && st !== 'queued' && st !== 'running') return job;
    await sleep(1000);
  }
  throw new Error('timeout');
}
async function exec(cmd:string){
  const rs = await kvmConnector.execSession(sid,{path:'/bin/bash',args:['-lc',cmd],capture_output:true,timeout_seconds:120});
  const jobId = (rs as any)?.data?.jobId || (rs as any)?.data?.job_id;
  const fin = jobId ? await waitJob(String(jobId)) : rs;
  const payload = (fin as any)?.data?.result || (fin as any)?.data || {};
  console.log(String(payload.stdout || payload.output || ''));
  if(payload.stderr){ console.log('STDERR:', String(payload.stderr)); }
}
await exec("grep -nE 'bootstrap|OPENCODE|opencode|BAD_BOOTSTRAP|server_ensure|session_create|prompt_send' /opt/.altus/opencode/log/osac.log | tail -n 200");
