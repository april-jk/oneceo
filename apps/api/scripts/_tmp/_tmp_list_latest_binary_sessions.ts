import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

(async()=>{
  const { sandboxExecutionEnvironmentDAO } = await import('../src/db/dao');
  const { ensureDatabaseConnection } = await import('../src/config/database');
  await ensureDatabaseConnection({ retries: 2, delayMs: 500 });
  const { db } = await import('../src/db');
  const rows = await db.selectFrom('sandbox_execution_environments').select(['sessionId','metadata','createdAt']).orderBy('createdAt','desc').limit(8).execute();
  for (const r of rows as any[]) {
    const m = r.metadata || {};
    const purpose = m.purpose || null;
    if (typeof purpose === 'string' && purpose.includes('binary-api-e2e')) {
      console.log(JSON.stringify({sid:r.sessionId, createdAt:r.createdAt, purpose, endpoint:m.osacEndpoint}));
    }
  }
  process.exit(0);
})();
