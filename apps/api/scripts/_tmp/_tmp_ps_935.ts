import dotenv from 'dotenv';
dotenv.config({ path: '.env' });
const sid='sess_35ff684915754d7c';
const { kvmConnector } = await import('../src/connectors/kvm-connector');
async function sleep(ms:number){await new Promise(r=>setTimeout(r,ms));}
async function waitJob(id:string){for(let i=0;i<120;i++){const j:any=await kvmConnector.getJob(id);const s=j?.data?.status; if(s && s!=='queued'&&s!=='running') return j; await sleep(1000);}throw new Error('timeout');}
async function exec(cmd:string){const rs:any=await kvmConnector.execSession(sid,{path:'/bin/bash',args:['-lc',cmd],capture_output:true,timeout_seconds:120});const id=rs?.data?.jobId||rs?.data?.job_id;const fin:any=id?await waitJob(String(id)):rs;const d=fin?.data?.result||fin?.data||{};console.log(String(d.stdout||d.output||''));if(d.stderr)console.log('STDERR',String(d.stderr));}
await exec("ps -p 935 -o pid,lstart,cmd --no-headers || true");
