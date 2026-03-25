import { runMigration } from '../db/migrate';

class ConnectorStorageBootstrap {
  private readyPromise: Promise<void> | null = null;

  async ensureReady() {
    if (!this.readyPromise) {
      this.readyPromise = (async () => {
        await runMigration();
      })().catch((error) => {
        this.readyPromise = null;
        throw error;
      });
    }
    await this.readyPromise;
  }
}

export const connectorStorageBootstrap = new ConnectorStorageBootstrap();
