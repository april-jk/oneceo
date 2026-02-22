import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const sid = process.argv[2] || '';
if (!sid) { console.error('need sid'); process.exit(1); }

(async()=>{
  const { ensureDatabaseConnection } = await import('../src/config/database');
  const { sandboxExecutionEnvironmentDAO } = await import('../src/db/dao');
  await ensureDatabaseConnection({ retries: 1, delayMs: 100 });
  const env = await sandboxExecutionEnvironmentDAO.getBySessionId(sid);
  if (!env) { console.log('NOT_FOUND'); return; }
  const m = (env.metadata || {}) as Record<string, unknown>;
  const t = typeof m.osacAuthToken === 'string' ? String(m.osacAuthToken) : null;
  const mask = (x: string | null) => {
    if (!x) return null;
    if (x.length <= 8) return '***';
    return `${x.slice(0,4)}***${x.slice(-2)}`;
  };
  console.log(JSON.stringify({
    sessionId: sid,
    osacEndpoint: m.osacEndpoint || null,
    osacHostPort: m.osacHostPort || null,
    osacMappingId: m.osacMappingId || null,
    osacMappingEpoch: m.osacMappingEpoch || null,
    tokenMask: mask(t),
    tokenLen: t?.length || null,
    tokenQuoted: t ? ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) : null,
  }, null, 2));
})();
