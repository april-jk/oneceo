import dotenv from 'dotenv';
dotenv.config({ path: '.env' });
const sid='sess_b20d406dcb2b4a3c';
async function sleep(ms:number){return new Promise(r=>setTimeout(r,ms));}
(async()=>{
  const {kvmConnector}=await import('../src/connectors/kvm-connector');
  const cmd="set -e; ls -l /opt/.altus/opencode/osac /opt/.altus/opencode/ 2>/dev/null || true; echo '---sha---'; sha256sum /opt/.altus/opencode/osac 2>/dev/null || true; echo '---proc---'; pgrep -a osac || true; echo '---listen---'; if command -v ss >/dev/null 2>&1; then ss -ltnp | grep -E ':18080|:18111' || true; else netstat -ltnp | grep -E ':18080|:18111' || true; fi; echo '---log---'; tail -n 80 /opt/.altus/opencode/log/osac.log 2>/dev/null || true";
  const r=await kvmConnector.execSession(sid,{path:'/bin/bash',args:['-lc',cmd],capture_output:true,timeout_seconds:60});
  const jobId=(r as any)?.data?.jobId||(r as any)?.data?.job_id||(r as any)?.jobId||(r as any)?.job_id;
  let fin:any=r;
  if(jobId){for(let i=0;i<80;i++){const j=await kvmConnector.getJob(String(jobId));const s=(j as any)?.data?.status; if(s&&s!=='queued'&&s!=='running'){fin=j;break;} await sleep(1000);}}
  const p=(fin as any)?.data?.result||(fin as any)?.data||{};
  console.log(String(p.stdout||p.output||''));
})();
