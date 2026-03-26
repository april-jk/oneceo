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

        console.warn(
          `[DB_BOOTSTRAP] schema incomplete, running migration: ${schemaState.missing.join(', ')}`
        );
        await this.deps.runMigration();
      })().catch((error) => {
        this.readyPromise = null;
        throw error;
      });
    }
    await this.readyPromise;
  }
}

export const connectorStorageBootstrap = new ConnectorStorageBootstrap();
