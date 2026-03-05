import dotenv from 'dotenv';
dotenv.config({ path: '.env' });
const sid = 'sess_35ff684915754d7c';
const { kvmConnector } = await import('../src/connectors/kvm-connector');
async function sleep(ms:number){ await new Promise(r=>setTimeout(r,ms)); }
async function waitJob(jobId:string){ for(let i=0;i<120;i++){ const job:any = await kvmConnector.getJob(jobId); const st=job?.data?.status; if(st && st!=='queued' && st!=='running') return job; await sleep(1000);} throw new Error('timeout'); }
async function exec(cmd:string){ const res:any = await kvmConnector.execSession(sid,{path:'/bin/bash',args:['-lc',cmd],capture_output:true,timeout_seconds:120}); const jobId=res?.data?.jobId||res?.data?.job_id; const fin:any = jobId? await waitJob(String(jobId)) : res; const data=fin?.data?.result||fin?.data||{}; console.log('CMD:',cmd); console.log(String(data.stdout||data.output||'')); if(data.stderr) console.log('STDERR:', String(data.stderr)); }
await exec("set -e; ls -l /opt/.altus/opencode/osac; stat -c '%y %s %n' /opt/.altus/opencode/osac; md5sum /opt/.altus/opencode/osac");
await exec("if command -v pgrep >/dev/null 2>&1; then pgrep -af '/opt/.altus/opencode/osac' || true; else ps -ef | grep '/opt/.altus/opencode/osac' | grep -v grep || true; fi");
