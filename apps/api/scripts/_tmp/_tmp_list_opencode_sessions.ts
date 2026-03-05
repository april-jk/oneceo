import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

(async()=>{
  const { ensureDatabaseConnection } = await import('../src/config/database');
  const { sandboxExecutionEnvironmentDAO } = await import('../src/db/dao');
  await ensureDatabaseConnection({ retries: 1, delayMs: 100 });
  const rows = await sandboxExecutionEnvironmentDAO.listRecent(30);
  for (const row of rows as any[]) {
    const m = (row.metadata || {}) as Record<string, any>;
    const purpose = m?.purpose || null;
    if (String(purpose || '').includes('opencode-regression') || m?.owner === 'codex-test') {
      console.log(JSON.stringify({
        sid: row.sessionId,
        status: row.status,
        createdAt: row.createdAt,
        purpose,
        endpoint: m.osacEndpoint || null,
        hostPort: m.osacHostPort || null,
      }));
    }
  }
})();
