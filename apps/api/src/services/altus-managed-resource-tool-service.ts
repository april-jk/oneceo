import { platformDeploymentAccountService } from './platform-deployment-account-service';
import { railwayDatabaseService } from './railway-database-service';
import { projectStorageResourceService } from './project-storage-resource-service';

export const ALTUS_MANAGED_RESOURCE_TOOL_NAMES = [
  'ensure_project_database',
  'get_project_database_status',
  'inspect_project_database_schema',
  'ensure_project_storage_bucket',
  'get_project_storage_status',
] as const;

export type AltusManagedResourceToolName = (typeof ALTUS_MANAGED_RESOURCE_TOOL_NAMES)[number];

export type AltusManagedResourceToolResult = {
  action: AltusManagedResourceToolName;
  phase: 'completed' | 'not_configured' | 'failed';
  status: 'success' | 'not_configured' | 'fatal_error';
  summary: string;
  resource: 'database' | 'storage';
  data?: unknown;
};

function safeDatabaseSummary(summary: Awaited<ReturnType<typeof railwayDatabaseService.getSummary>>) {
  return {
    configured: summary.configured,
    provider: summary.provider,
    serviceId: summary.serviceId,
    serviceName: summary.serviceName,
    volumeId: summary.volumeId,
    volumeName: summary.volumeName,
    latestDeploymentStatus: summary.latestDeploymentStatus,
    latestDeploymentAt: summary.latestDeploymentAt,
    tables: summary.tables,
    connection: {
      host: summary.connection.host,
      port: summary.connection.port,
      database: summary.connection.database,
      username: summary.connection.username,
      sslMode: summary.connection.sslMode,
      hasPassword: Boolean(summary.connection.password),
      hasPublicConnectionUrl: Boolean(summary.connection.publicConnectionUrl),
    },
  };
}

export class AltusManagedResourceToolService {
  async execute(input: {
    action: AltusManagedResourceToolName;
    sessionId: string;
    userId: string;
  }): Promise<AltusManagedResourceToolResult> {
    if (input.action === 'ensure_project_database') {
      const account = await platformDeploymentAccountService.ensureProjectDatabaseResources(
        input.userId,
        input.sessionId
      );
      const summary = await railwayDatabaseService.getSummary(account);
      return {
        action: input.action,
        phase: 'completed',
        status: 'success',
        resource: 'database',
        summary: '已在当前 Railway Environment 中启用 Postgres，并将数据库连接变量注入应用服务。',
        data: safeDatabaseSummary(summary),
      };
    }

    if (input.action === 'get_project_database_status' || input.action === 'inspect_project_database_schema') {
      const account = await platformDeploymentAccountService.getProjectAccount(
        input.userId,
        input.sessionId
      );
      if (!account?.databaseServiceId) {
        return {
          action: input.action,
          phase: 'not_configured',
          status: 'not_configured',
          resource: 'database',
          summary: '当前项目尚未启用数据库。只有当用户需求明确需要数据库时，才调用 ensure_project_database。',
          data: {
            configured: false,
            provider: 'railway_postgres',
          },
        };
      }
      if (input.action === 'inspect_project_database_schema') {
        const schemaSummary = await railwayDatabaseService.getSchemaSummary(account);
        return {
          action: input.action,
          phase: 'completed',
          status: 'success',
          resource: 'database',
          summary: `已读取数据库结构，共 ${schemaSummary.tables.length} 张业务表及对应列定义。`,
          data: schemaSummary,
        };
      }

      const summary = await railwayDatabaseService.getSummary(account);
      return {
        action: input.action,
        phase: 'completed',
        status: 'success',
        resource: 'database',
        summary: '已读取当前项目数据库状态。',
        data: safeDatabaseSummary(summary),
      };
    }

    if (input.action === 'ensure_project_storage_bucket') {
      const status = await projectStorageResourceService.ensureRailwayBucket(
        input.userId,
        input.sessionId
      );
      return {
        action: input.action,
        phase: 'completed',
        status: 'success',
        resource: 'storage',
        summary: '已在当前 Railway Environment 中启用 Bucket，并将 S3 访问变量注入应用服务。',
        data: status,
      };
    }

    if (input.action === 'get_project_storage_status') {
      const status = await projectStorageResourceService.getStatus(input.userId, input.sessionId);
      return {
        action: input.action,
        phase: status.configured ? 'completed' : 'not_configured',
        status: status.configured ? 'success' : 'not_configured',
        resource: 'storage',
        summary: status.configured
          ? '已读取当前项目存储桶状态。'
          : '当前项目尚未启用存储桶。只有当用户需求明确需要对象存储时，才调用 ensure_project_storage_bucket。',
        data: status,
      };
    }

    return {
      action: input.action,
      phase: 'failed',
      status: 'fatal_error',
      resource: 'database',
      summary: `未知资源工具：${input.action}`,
    };
  }
}

export const altusManagedResourceToolService = new AltusManagedResourceToolService();
