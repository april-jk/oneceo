import assert from 'node:assert/strict';
import { test } from 'node:test';

const shouldRun = process.env.ONECEO_DB_MIGRATION_TEST_DATABASE === 'true';

if (!shouldRun) {
  test('db migration readiness live test is opt-in', { skip: 'Use scripts/run-db-migration-readiness-test.ts' }, () => {});
} else {
  test('migration repairs model pricing active-only partial unique index', async () => {
    const { databasePool, closeDatabaseConnection } = await import('../src/config/database');
    const { inspectDatabaseSchemaReadiness, runMigration } = await import('../src/db/migrate');

    try {
      await databasePool.query(`
        CREATE TABLE IF NOT EXISTS model_pricing (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          model TEXT NOT NULL,
          model_provider TEXT NOT NULL,
          prompt_price_per_1k_tokens INTEGER NOT NULL,
          completion_price_per_1k_tokens INTEGER NOT NULL,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          effective_from TIMESTAMP NOT NULL DEFAULT NOW(),
          effective_until TIMESTAMP,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);
      await databasePool.query('DROP INDEX IF EXISTS idx_model_pricing_model_active');
      await databasePool.query('CREATE UNIQUE INDEX idx_model_pricing_model_active ON model_pricing(model, is_active)');

      const readinessBefore = await inspectDatabaseSchemaReadiness();
      assert.ok(
        readinessBefore.missing.includes('index:idx_model_pricing_model_active(partial-active)'),
        `expected partial index drift to be reported, got ${readinessBefore.missing.join(', ')}`
      );

      await runMigration();
      await runMigration();

      const indexResult = await databasePool.query<{ indexdef: string }>(`
        SELECT indexdef
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'idx_model_pricing_model_active'
      `);
      const indexDefinition = indexResult.rows[0]?.indexdef.toLowerCase() || '';
      assert.match(indexDefinition, /unique index/);
      assert.match(indexDefinition, /on public\.model_pricing/);
      assert.match(indexDefinition, /where \(is_active = true\)/);

      await databasePool.query(
        `INSERT INTO model_pricing (model, model_provider, prompt_price_per_1k_tokens, completion_price_per_1k_tokens, is_active)
         VALUES ($1, 'openai', 1, 1, false), ($1, 'openai', 2, 2, false)`,
        ['p2-index-model']
      );
      await databasePool.query(
        `INSERT INTO model_pricing (model, model_provider, prompt_price_per_1k_tokens, completion_price_per_1k_tokens, is_active)
         VALUES ($1, 'openai', 3, 3, true)`,
        ['p2-index-model']
      );
      await assert.rejects(
        () => databasePool.query(
          `INSERT INTO model_pricing (model, model_provider, prompt_price_per_1k_tokens, completion_price_per_1k_tokens, is_active)
           VALUES ($1, 'openai', 4, 4, true)`,
          ['p2-index-model']
        ),
        /duplicate key value violates unique constraint/
      );
    } finally {
      await closeDatabaseConnection();
    }
  });
}
