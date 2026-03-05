import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

async function sleep(ms: number) { await new Promise((r)=>setTimeout(r, ms)); }
async function waitJob(kvmConnector: any, jobId: string) {
  for (let i=0;i<40;i++) {
    const j:any = await kvmConnector.getJob(jobId);
    const st = String(j?.data?.status||'').toLowerCase();
    if (st && st!=='queued' && st!=='running') return j;
    await sleep(1000);
  }
  throw new Error('job timeout');
}

(async()=>{
  const sid = process.argv[2] || 'sess_cccee2e824f34dcb';
  const { kvmConnector } = await import('../src/connectors/kvm-connector');
  const cmd = `echo ==== binaries ====\nwhich osac || true\nwhich opencode || true\nls -l /opt/.altus/opencode 2>/dev/null || true\nls -l /usr/local/bin/osac 2>/dev/null || true\nls -l /usr/bin/osac 2>/dev/null || true\nfind /opt -maxdepth 4 -type f -name 'osac*' 2>/dev/null | head -n 20 || true\necho ==== port ====\nss -ltnp | grep ':18080' || true`;
  const submit:any = await kvmConnector.execSession(sid,{path:'/bin/bash',args:['-lc',cmd],capture_output:true,timeout_seconds:45});
  const jid = submit?.data?.jobId || submit?.data?.job_id || submit?.jobId || submit?.job_id;
  const done = jid ? await waitJob(kvmConnector, String(jid)) : submit;
  console.log(JSON.stringify(done?.data?.result || done?.data || done || {}, null, 2));
})();
