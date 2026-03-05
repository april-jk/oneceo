import dotenv from 'dotenv';
dotenv.config({ path: '.env' });
const sid='sess_35ff684915754d7c';
const token='manual_fix_session_35ff';
const { kvmConnector } = await import('../src/connectors/kvm-connector');
async function sleep(ms:number){await new Promise(r=>setTimeout(r,ms));}
async function waitJob(id:string){for(let i=0;i<180;i++){const j:any=await kvmConnector.getJob(id);const s=j?.data?.status; if(s && s!=='queued'&&s!=='running') return j; await sleep(1000);}throw new Error('timeout');}
async function exec(cmd:string){const rs:any=await kvmConnector.execSession(sid,{path:'/bin/bash',args:['-lc',cmd],capture_output:true,timeout_seconds:180});const id=rs?.data?.jobId||rs?.data?.job_id;const fin:any=id?await waitJob(String(id)):rs;const d=fin?.data?.result||fin?.data||{};console.log('---');console.log(cmd);console.log(String(d.stdout||d.output||''));if(d.stderr)console.log('STDERR',String(d.stderr));}
await exec("set -e; mkdir -p /opt/.altus/opencode/log /opt/.altus/opencode/tmp; rm -f /opt/.altus/opencode/osac.lock; chmod +x /opt/.altus/opencode/osac /opt/.altus/opencode/opencode; nohup env OSAC_AUTH_TOKEN='"+token+"' OSAC_LISTEN_ADDR=':18080' OSAC_OPENCODE_PATH='/opt/.altus/opencode/opencode' OSAC_LOG_DIR='/opt/.altus/opencode/log' OSAC_UPDATE_TMP='/opt/.altus/opencode/tmp' OPENCODE_BIN='/opt/.altus/opencode/opencode' OPENCODE_PATH='/opt/.altus/opencode/opencode' OSAC_LLM_PROXY_ENABLE='true' OSAC_LLM_PROXY_PORT='18111' OSAC_LLM_PROXY_TIMEOUT_MS='90000' /opt/.altus/opencode/osac >> /opt/.altus/opencode/log/osac.log 2>&1 < /dev/null & sleep 1; pgrep -af '/opt/.altus/opencode/osac' || true; tail -n 20 /opt/.altus/opencode/log/osac.log || true");
