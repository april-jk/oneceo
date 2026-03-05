import dotenv from 'dotenv';
dotenv.config({ path: '.env' });
const sid = 'sess_b192117a78c14a2a';

async function main() {
  const { kvmConnector } = await import('./src/connectors/kvm-connector');
  const sandbox = await kvmConnector.getSandbox(sid).catch((e:any)=>({error:e?.message||String(e)}));
  const ports = await kvmConnector.listSandboxPorts(sid, { refresh: 'true', verify: 'true', wait_seconds: '5' } as any).catch((e:any)=>({error:e?.message||String(e)}));
  console.log(JSON.stringify({ sandbox, ports }, null, 2));
}

main().catch((e)=>{ console.error(e); process.exit(1); });
