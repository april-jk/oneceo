import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

import { Client } from 'pg';
import { OsacClient } from '../src/clients/osac-client';

const targetSid = 'sess_b20d406dcb2b4a3c';

async function testToken(url: string, token: string) {
  const client = new OsacClient(url, {
    authToken: token,
    connectTimeoutMs: 3000,
    requestTimeoutMs: 5000,
  });
  try {
    await client.connect();
    client.close();
    return true;
  } catch {
    try { client.close(); } catch {}
    return false;
  }
}

async function main() {
  const pg = new Client({ connectionString: process.env.DATABASE_URL, ssl: false });
  await pg.connect();
  const res = await pg.query(
    `select session_id, metadata, created_at from sandbox_execution_environments
     where metadata ? 'osacEndpoint' and metadata ? 'osacAuthToken'
     order by created_at desc limit 20`
  );
  await pg.end();

  const target = res.rows.find((r) => r.session_id === targetSid);
  if (!target) {
    throw new Error('target session not found in latest rows');
  }
  const targetEndpoint = String(target.metadata?.osacEndpoint || '');
  console.log('targetEndpoint=', targetEndpoint);

  for (const row of res.rows) {
    const sid = String(row.session_id);
    const token = String(row.metadata?.osacAuthToken || '');
    if (!token) continue;
    const ok = await testToken(targetEndpoint, token);
    if (ok) {
      console.log('MATCH_TOKEN', JSON.stringify({ sid, createdAt: row.created_at }));
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
