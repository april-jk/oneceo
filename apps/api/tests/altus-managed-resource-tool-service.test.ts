import assert from 'node:assert/strict';
import test from 'node:test';

import { AltusManagedResourceToolService } from '../src/services/altus-managed-resource-tool-service';

test('ensure_project_database records explicit database declaration', async () => {
  let declarationInput: Record<string, unknown> | null = null;
  const service = new AltusManagedResourceToolService({
    ensureProjectDatabaseResources: async () => ({ databaseServiceId: 'db_1' } as any),
    getProjectAccount: async () => null,
    getDatabaseSummary: async () =>
      ({
        configured: true,
        provider: 'railway_postgres',
        serviceId: 'db_1',
        serviceName: 'Postgres',
        volumeId: 'vol_1',
        volumeName: 'Postgres data',
        latestDeploymentStatus: 'SUCCESS',
        latestDeploymentAt: new Date().toISOString(),
        tables: [],
        connection: {
          host: 'db.local',
          port: 5432,
          database: 'app',
          username: 'user',
          password: 'secret',
          sslMode: 'require',
          publicConnectionUrl: 'postgres://demo',
        },
      }) as any,
    getDatabaseSchemaSummary: async () => ({ tables: [] }) as any,
    ensureRailwayBucket: async () => ({ configured: true }) as any,
    getStorageStatus: async () => ({ configured: false }) as any,
    markResourceProvisioned: async (input) => {
      declarationInput = input as unknown as Record<string, unknown>;
      return {
        database: {
          requested: true,
          provisioned: true,
          source: 'tool',
          toolName: 'ensure_project_database',
          updatedAt: new Date().toISOString(),
        },
        storage: null,
      };
    },
  });

  const result = await service.execute({
    action: 'ensure_project_database',
    sessionId: 'session-1',
    userId: 'user-1',
    reason: '需要用户表',
  });

  assert.equal(result.status, 'success');
  assert.equal(result.resource, 'database');
  assert.equal(declarationInput?.sessionId, 'session-1');
  assert.equal(declarationInput?.resource, 'database');
  assert.equal(declarationInput?.toolName, 'ensure_project_database');
  assert.equal(declarationInput?.reason, '需要用户表');
});

test('get_project_storage_status does not record declaration', async () => {
  let declarationCalls = 0;
  const service = new AltusManagedResourceToolService({
    ensureProjectDatabaseResources: async () => ({ databaseServiceId: 'db_1' } as any),
    getProjectAccount: async () => null,
    getDatabaseSummary: async () => ({ configured: false }) as any,
    getDatabaseSchemaSummary: async () => ({ tables: [] }) as any,
    ensureRailwayBucket: async () => ({ configured: true }) as any,
    getStorageStatus: async () => ({ configured: false, provider: 'railway_bucket' }) as any,
    markResourceProvisioned: async () => {
      declarationCalls += 1;
      return { database: null, storage: null };
    },
  });

  const result = await service.execute({
    action: 'get_project_storage_status',
    sessionId: 'session-1',
    userId: 'user-1',
  });

  assert.equal(result.status, 'not_configured');
  assert.equal(result.resource, 'storage');
  assert.equal(declarationCalls, 0);
});
