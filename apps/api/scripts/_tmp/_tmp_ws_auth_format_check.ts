import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

import { sandboxExecutionEnvironmentDAO } from '../src/db/dao';
import WebSocket from 'ws';

const sid = process.env.SID;
if (!sid) throw new Error('SID required');

async function testWs(label: string, url: string, headers?: Record<string, string>) {
  return await new Promise<string>((resolve) => {
    const ws = new WebSocket(url, headers ? { headers } : undefined);
    const timer = setTimeout(() => {
      try { ws.terminate(); } catch {}
      resolve(`${label}=timeout`);
    }, 5000);

    ws.on('open', () => {
      clearTimeout(timer);
      try { ws.close(); } catch {}
      resolve(`${label}=open`);
    });

    ws.on('error', (err: any) => {
      clearTimeout(timer);
      resolve(`${label}=error:${err?.message || String(err)}`);
    });
  });
}

async function main() {
  const env = await sandboxExecutionEnvironmentDAO.getBySessionId(sid);
  const md = (env?.metadata || {}) as any;
  const endpoint = String(md.osacEndpoint || '');
  const token = String(md.osacAuthToken || '');
  const encoded = encodeURIComponent(token);

  const urlToken = endpoint.includes('?') ? `${endpoint}&token=${encoded}` : `${endpoint}?token=${encoded}`;
  const urlAuthToken = endpoint.includes('?') ? `${endpoint}&authToken=${encoded}` : `${endpoint}?authToken=${encoded}`;

  console.log('endpoint=', endpoint);
  console.log(await testWs('bearer_header', endpoint, { Authorization: `Bearer ${token}` }));
  console.log(await testWs('token_query', urlToken));
  console.log(await testWs('authToken_query', urlAuthToken));
  console.log(await testWs('no_auth', endpoint));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
