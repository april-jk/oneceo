import { inspectDatabaseSchemaReadiness, runMigration } from '../db/migrate';

type ConnectorStorageBootstrapDeps = {
  inspectSchema: () => Promise<{ ready: boolean; missing: string[] }>;
  runMigration: () => Promise<unknown>;
};

export class ConnectorStorageBootstrap {
  private readyPromise: Promise<void> | null = null;

  constructor(
    private readonly deps: ConnectorStorageBootstrapDeps = {
      inspectSchema: inspectDatabaseSchemaReadiness,
      runMigration,
    }
  ) {}

  async ensureReady() {
    if (!this.readyPromise) {
      this.readyPromise = (async () => {
        const schemaState = await this.deps.inspectSchema();
        if (schemaState.ready) {
          console.log('[DB_BOOTSTRAP] latest schema detected, skip migration');
          return;
        }

        const missingList = schemaState.missing.join(', ');
        console.warn('[DB_BOOTSTRAP] schema incomplete, running migration: ' + missingList);
        await this.deps.runMigration();

        // Verify migration succeeded
        const postState = await this.deps.inspectSchema();
        if (!postState.ready) {
          const postMissing = postState.missing.join(', ');
          throw new Error('[DB_BOOTSTRAP] migration completed but schema still incomplete: ' + postMissing);
        }
        console.log('[DB_BOOTSTRAP] migration verified, schema is complete');
      })().catch((error) => {
        this.readyPromise = null;
        throw error;
      });
    }
    await this.readyPromise;
  }
}

export const connectorStorageBootstrap = new ConnectorStorageBootstrap();