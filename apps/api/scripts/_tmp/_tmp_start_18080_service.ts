import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

async function sleep(ms: number) { await new Promise((r)=>setTimeout(r,ms)); }
async function waitJob(kvmConnector: any, jobId: string) {
  for (let i=0;i<40;i++) {
    const j:any = await kvmConnector.getJob(jobId);
    const st = String(j?.data?.status||'').toLowerCase();
    if (st && st !== 'queued' && st !== 'running') return j;
    await sleep(1000);
  }
  throw new Error('job timeout');
}
function getJobId(payload: any): string | null {
  return payload?.data?.jobId || payload?.data?.job_id || payload?.jobId || payload?.job_id || null;
}
async function execAndWait(kvmConnector: any, sid: string, cmd: string, t=30) {
  const sub:any = await kvmConnector.execSession(sid,{path:'/bin/bash',args:['-lc',cmd],capture_output:true,timeout_seconds:t});
  const jid = getJobId(sub);
  return jid ? waitJob(kvmConnector, String(jid)) : sub;
}

(async()=>{
  const sid = process.argv[2] || 'sess_cccee2e824f34dcb';
  const { kvmConnector } = await import('../src/connectors/kvm-connector');

  const step1 = await execAndWait(kvmConnector, sid, "python3 --version || which python3 || true; nohup python3 -m http.server 18080 >/tmp/port18080.log 2>&1 < /dev/null & echo started", 30);
  console.log('STEP1=', JSON.stringify(step1?.data?.result || step1?.data || {}, null, 2));

  const step2 = await execAndWait(kvmConnector, sid, "sleep 1; ss -ltnp | grep ':18080' || true; tail -n 30 /tmp/port18080.log 2>/dev/null || true", 30);
  console.log('STEP2=', JSON.stringify(step2?.data?.result || step2?.data || {}, null, 2));
})();
