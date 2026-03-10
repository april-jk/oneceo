require('dotenv').config({path:'apps/api/.env'});
const { Client } = require('pg');
(async () => {
  const sslDisabled = String(process.env.DATABASE_SSL || '').toLowerCase() === 'disable';
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: sslDisabled ? false : undefined,
  });
  await client.connect();
  const sessionId = 'sess_f60e1410f00c45cd';
  const osacEndpoint = 'ws://192.168.10.172:20047/ws';
  const host = '192.168.10.172';
  const hostPort = 20047;
  const vmIp = '172.28.0.187';
  const payload = JSON.stringify({
    osacEndpoint,
    osacHost: host,
    osacHostPort: hostPort,
    vmIpAddress: vmIp,
    osacConnectionMode: 'port-mapping',
  });
  const res = await client.query(
    "update sandbox_execution_environments set metadata = coalesce(metadata,'{}'::jsonb) || $1::jsonb, updated_at=now() where session_id=$2 returning metadata",
    [payload, sessionId]
  );
  console.log(res.rows[0]);
  await client.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
