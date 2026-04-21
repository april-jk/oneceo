import type { OneceoApiConnector } from '../connectors/oneceo-api-connector';

export class DeploymentManagementService {
  constructor(private readonly oneceoApi: OneceoApiConnector) {}

  getOverview(filters?: {
    limit?: number;
    query?: string;
    status?: string;
    hasUrl?: string;
    userId?: string;
    taskSessionId?: string;
  }) {
    return this.oneceoApi.getDeploymentOverview(filters);
  }

  listRecords(filters?: {
    limit?: number;
    query?: string;
    status?: string;
    hasUrl?: string;
    userId?: string;
    taskSessionId?: string;
  }) {
    return this.oneceoApi.listDeploymentRecords(filters);
  }

  listConversations(filters?: {
    limit?: number;
    query?: string;
    status?: string;
    hasUrl?: string;
    userId?: string;
    taskSessionId?: string;
  }) {
    return this.oneceoApi.listDeploymentConversations(filters);
  }

  listUsers(filters?: {
    limit?: number;
    query?: string;
    status?: string;
    hasUrl?: string;
    userId?: string;
  }) {
    return this.oneceoApi.listDeploymentUsers(filters);
  }

  getDetail(taskSessionId: string) {
    return this.oneceoApi.getDeploymentDetail(taskSessionId);
  }

  listRailwayServices(filters?: {
    limit?: number;
    query?: string;
    status?: string;
    risk?: string;
  }) {
    return this.oneceoApi.listRailwayServices(filters);
  }

  batchDeleteRailwayServices(serviceKeys: string[]) {
    return this.oneceoApi.batchDeleteRailwayServices(serviceKeys);
  }

  batchConfigureRailwayServices(
    serviceKeys: string[],
    patch: {
      builder?: string;
      buildCommand?: string;
      startCommand?: string;
      rootDirectory?: string;
      healthcheckPath?: string;
      sourceImage?: string;
    }
  ) {
    return this.oneceoApi.batchConfigureRailwayServices(serviceKeys, patch);
  }

  batchUpsertRailwayServiceVariables(
    serviceKeys: string[],
    variables: Record<string, string>,
    options?: {
      replace?: boolean;
    }
  ) {
    return this.oneceoApi.batchUpsertRailwayServiceVariables(serviceKeys, variables, options?.replace);
  }
}
