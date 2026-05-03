import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

function buildAdminDatabaseUrl() {
  const rawUrl = process.env.TEST_DATABASE_ADMIN_URL ||
    process.env.DATABASE_URL ||
    'postgresql://postgres:postgres@127.0.0.1:5432/postgres?sslmode=disable';
  const url = new URL(rawUrl);
  if (!process.env.TEST_DATABASE_ADMIN_URL) {
    url.pathname = '/postgres';
  }
  return url.toString();
}

function buildTargetDatabaseUrl(adminUrl: string, databaseName: string) {
  const url = new URL(adminUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function runTest(databaseUrl: string) {
  return new Promise<number>((resolve, reject) => {
    const child = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tsx', '--test', 'tests/db-migration-readiness.test.ts'], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        ONECEO_DB_MIGRATION_TEST_DATABASE: 'true',
      },
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
}

async function main() {
  const databaseName = `oneceo_migration_test_${Date.now()}_${process.pid}`;
  const adminUrl = buildAdminDatabaseUrl();
  const adminPool = new Pool({
    connectionString: adminUrl,
    ssl: adminUrl.includes('sslmode=disable') ? undefined : { rejectUnauthorized: false },
  });

  try {
    await adminPool.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
    const targetUrl = buildTargetDatabaseUrl(adminUrl, databaseName);
    const exitCode = await runTest(targetUrl);
    if (exitCode !== 0) {
      process.exitCode = exitCode;
    }
  } finally {
    await adminPool.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [databaseName]
    ).catch(() => null);
    await adminPool.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`).catch((error) => {
      console.error('[db-migration-test] failed to drop temp database:', error);
      process.exitCode = process.exitCode || 1;
    });
    await adminPool.end();
  }
}

main().catch((error) => {
  console.error('[db-migration-test] failed:', error);
  process.exitCode = 1;
});
