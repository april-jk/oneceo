import dotenv from 'dotenv';
dotenv.config({ path: '.env' });
const { ensureDatabaseConnection } = await import('../src/config/database');
const { sandboxExecutionEnvironmentDAO } = await import('../src/db/dao');
await ensureDatabaseConnection({ retries: 1, delayMs: 100 });
const sid='sess_51ce1d5cbf854a78';
const row:any = await sandboxExecutionEnvironmentDAO.getBySessionId(sid);
if(!row){ console.log('NO_ROW'); process.exit(0); }
const m:any = row.metadata || {};
console.log(JSON.stringify({
  sid,
  status: row.status,
  osacEndpoint: m.osacEndpoint || null,
  osacHostPort: m.osacHostPort || null,
  osacAuthToken: m.osacAuthToken || null,
  osacToken: m.osacToken || null,
  nestedToken: (m.osac && (m.osac.token || m.osac.authToken)) || null,
  mappingId: m.osacMappingId || m.mappingId || null,
  mappingEpoch: m.osacMappingEpoch || m.mappingEpoch || null
}, null, 2));
