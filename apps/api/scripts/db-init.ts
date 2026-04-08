import { inspectDatabaseSchemaReadiness, runMigration } from '../src/db/migrate';

async function main() {
  console.log('[DB_INIT] start');
  await runMigration();

  const readiness = await inspectDatabaseSchemaReadiness();
  if (!readiness.ready) {
    console.error('[DB_INIT] schema still incomplete after migration');
    for (const item of readiness.missing) {
      console.error(`  - ${item}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log('[DB_INIT] schema ready');
}

main().catch((error) => {
  console.error('[DB_INIT] failed:', error);
  process.exit(1);
});

