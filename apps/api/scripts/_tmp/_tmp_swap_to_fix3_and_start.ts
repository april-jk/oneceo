import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const sid='sess_b20d406dcb2b4a3c';

async function sleep(ms:number){return new Promise(r=>setTimeout(r,ms));}

(async()=>{
  const {kvmConnector}=await import('../src/connectors/kvm-connector');
  const cmd=`set -e
pkill -f '/opt/.altus/opencode/osac' || true
mv -f /opt/.altus/opencode/osac-linux-amd64_v1.1.2.fix3 /opt/.altus/opencode/osac
chmod +x /opt/.altus/opencode/osac
set -a
. /etc/environment
set +a
setsid /opt/.altus/opencode/osac >> /opt/.altus/opencode/log/osac.log 2>&1 < /dev/null &
sleep 1
echo '---proc---'
pgrep -a osac || true
echo '---listen---'
if command -v ss >/dev/null 2>&1; then ss -ltnp | grep -E ':18080|:18111' || true; else netstat -ltnp | grep -E ':18080|:18111' || true; fi
echo '---sha---'
sha256sum /opt/.altus/opencode/osac || true
echo '---log---'
tail -n 60 /opt/.altus/opencode/log/osac.log || true`;
  const r=await kvmConnector.execSession(sid,{path:'/bin/bash',args:['-lc',cmd],capture_output:true,timeout_seconds:90});
  const jobId=(r as any)?.data?.jobId||(r as any)?.data?.job_id||(r as any)?.jobId||(r as any)?.job_id;
  let fin:any=r;
  if(jobId){for(let i=0;i<120;i++){const j=await kvmConnector.getJob(String(jobId)); const s=(j as any)?.data?.status; if(s&&s!=='queued'&&s!=='running'){fin=j;break;} await sleep(1000);}}
  const d=(fin as any)?.data||{};
  const p=d?.result||d||{};
  console.log('status=',d?.status||p?.status||'unknown');
  console.log('stdout=',String(p.stdout||p.output||''));
  console.log('stderr=',String(p.stderr||''));
})();
