import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

import { OsacClient } from '../src/clients/osac-client';
import { sandboxExecutionEnvironmentDAO } from '../src/db/dao';

const sid = process.env.SID;
if (!sid) throw new Error('SID required');

async function tryConnect(label: string, url: string, token: string) {
  for (let i = 1; i <= 3; i++) {
    const client = new OsacClient(url, {
      authToken: token,
      connectTimeoutMs: 6000,
      requestTimeoutMs: 10000,
    });
    try {
      await client.connect();
      console.log(`${label} attempt${i}=ok`);
      client.close();
      return;
    } catch (e: any) {
      console.log(`${label} attempt${i}=fail ${e?.message || String(e)}`);
      try { client.close(); } catch {}
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

async function main() {
  const env = await sandboxExecutionEnvironmentDAO.getBySessionId(sid);
  const md = (env?.metadata || {}) as any;
  const token = String(md.osacAuthToken || '');
  const mapped = String(md.osacEndpoint || '');
  const vmIp = String(md.vmIpAddress || '').trim();
  const direct = vmIp ? `ws://${vmIp}:18080/ws` : '';

  console.log('mapped=', mapped);
  console.log('direct=', direct || '(none)');

  await tryConnect('mapped', mapped, token);
  if (direct) {
    await tryConnect('direct', direct, token);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
