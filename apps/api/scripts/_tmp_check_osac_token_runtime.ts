import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const sid = process.argv[2] || '';
if (!sid) {
  console.error('need sid');
  process.exit(1);
}

async function sleep(ms:number){return new Promise((r)=>setTimeout(r,ms));}

(async()=>{
  const { kvmConnector } = await import('../src/connectors/kvm-connector');
  const cmd = "echo 'etc'; grep '^OSAC_AUTH_TOKEN=' /etc/environment || true; echo 'proc'; PID=$(pgrep -o osac || true); if [ -n \"$PID\" ]; then tr '\\0' '\\n' </proc/$PID/environ | grep '^OSAC_AUTH_TOKEN=' || true; else echo NOOSAC; fi";
  const res = await kvmConnector.execSession(sid,{ path:'/bin/bash', args:['-lc',cmd], capture_output:true, timeout_seconds:25 });
  const jobId = (res as any)?.data?.jobId || (res as any)?.data?.job_id || (res as any)?.jobId || (res as any)?.job_id;
  let final:any = res;
  if (jobId) {
    for (let i=0;i<40;i++) {
      const j = await kvmConnector.getJob(String(jobId));
      const s = (j as any)?.data?.status;
      if (s && s !== 'queued' && s !== 'running') { final = j; break; }
      await sleep(1000);
    }
  }
  const payload = (final as any)?.data?.result || (final as any)?.data || {};
  console.log(String(payload.stdout || payload.output || ''));
})();
