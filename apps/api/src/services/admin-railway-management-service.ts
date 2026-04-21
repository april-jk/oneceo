import { and, desc, eq, inArray, like, or } from 'drizzle-orm';
import { db } from '../config/database';
import { appUsers, userConnectorAccounts } from '../db/schema';
import { userConnectorAccountDAO } from '../db/dao';
import { requestRailwayGraphql } from './railway-graphql-client';

const INTERNAL_DEPLOYMENT_CONNECTOR_KEY = 'railway_internal';

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function pickRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  return null;
}

function toDateMs(value: unknown) {
  const iso = toIso(value);
  if (!iso) return 0;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : 0;
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    const text = asText(value);
    if (text) return text;
  }
  return '';
}

function resolveRailwayManagementToken() {
  const token = firstText(
    process.env.RAILWAY_API_TOKEN,
    process.env.RAILWAY_ADMIN_TOKEN,
    process.env.RAILWAY_PROJECT_TOKEN,
  );
  if (!token) {
    throw new Error('未配置可用的 Railway token，部署管理不可用');
  }
  return token;
}

function parseManagedDeploymentConfig(input: unknown) {
  const record = pickRecord(input);
  const provider = asText(record.provider);
  const supplier = asText(record.supplier);
  const projectId = asText(record.projectId);
  const environmentId = asText(record.environmentId);
  const serviceId = asText(record.serviceId);
  if (provider !== 'platform_managed' || supplier !== 'railway' || !projectId || !environmentId || !serviceId) {
    return null;
  }
  return {
    projectKey: asText(record.projectKey) || 'default',
    projectId,
    projectName: asText(record.projectName) || undefined,
    environmentId,
    environmentName: asText(record.environmentName) || undefined,
    serviceId,
    serviceName: asText(record.serviceName) || undefined,
    serviceDomain: asText(record.serviceDomain) || undefined,
  };
}

async function railwayAdminRequest<T>(query: string, variables?: Record<string, unknown>) {
  return requestRailwayGraphql<T>(resolveRailwayManagementToken(), query, variables);
}

async function loadProjectSummary(projectId: string) {
  return railwayAdminRequest<{
    project?: {
      id?: string;
      name?: string;
      environments?: { edges?: Array<{ node?: { id?: string; name?: string } }> };
      services?: { edges?: Array<{ node?: { id?: string; name?: string } }> };
    } | null;
  }>(
    `
      query AdminRailwayProjectSummary($id: String!) {
        project(id: $id) {
          id
          name
          environments {
            edges {
              node {
                id
                name
              }
            }
          }
          services {
            edges {
              node {
                id
                name
              }
            }
          }
        }
      }
    `,
    { id: projectId }
  );
}

async function loadServiceRuntime(input: {
  projectId: string;
  environmentId: string;
  serviceId: string;
}) {
  return railwayAdminRequest<{
    variables?: Record<string, unknown> | null;
    serviceInstance?: {
      latestDeployment?: {
        id?: string;
        status?: string;
        createdAt?: string;
      } | null;
    } | null;
  }>(
    `
      query AdminRailwayServiceRuntime(
        $projectId: String!,
        $environmentId: String!,
        $serviceId: String!
      ) {
        variables(
          projectId: $projectId,
          environmentId: $environmentId,
          serviceId: $serviceId
        )
        serviceInstance(serviceId: $serviceId, environmentId: $environmentId) {
          latestDeployment {
            id
            status
            createdAt
          }
        }
      }
    `,
    input
  );
}

async function loadDeploymentDetail(deploymentId: string) {
  return railwayAdminRequest<{
    deployment?: {
      id?: string;
      status?: string;
      createdAt?: string;
      url?: string;
      staticUrl?: string;
    } | null;
  }>(
    `
      query AdminRailwayDeploymentDetail($deploymentId: String!) {
        deployment(id: $deploymentId) {
          id
          status
          createdAt
          url
          staticUrl
        }
      }
    `,
    { deploymentId }
  );
}

async function loadDomains(input: {
  projectId: string;
  environmentId: string;
  serviceId: string;
}) {
  return railwayAdminRequest<{
    domains?: {
      serviceDomains?: Array<{ id?: string; domain?: string; targetPort?: number }>;
      customDomains?: Array<{ id?: string; domain?: string; targetPort?: number }>;
    } | null;
  }>(
    `
      query AdminRailwayServiceDomains(
        $projectId: String!,
        $environmentId: String!,
        $serviceId: String!
      ) {
        domains(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId) {
          serviceDomains {
            id
            domain
            targetPort
          }
          customDomains {
            id
            domain
            targetPort
          }
        }
      }
    `,
    input
  );
}

async function deleteRailwayService(serviceId: string, environmentId: string) {
  await railwayAdminRequest(
    `
      mutation AdminRailwayServiceDelete($id: String!, $environmentId: String) {
        serviceDelete(id: $id, environmentId: $environmentId)
      }
    `,
    {
      id: serviceId,
      environmentId,
    }
  );
}

async function updateRailwayServiceInstance(input: {
  serviceId: string;
  environmentId: string;
  patch: {
    builder?: string;
    buildCommand?: string;
    startCommand?: string;
    rootDirectory?: string;
    healthcheckPath?: string;
    sourceImage?: string;
  };
}) {
  const nextInput: Record<string, unknown> = {};
  if (asText(input.patch.builder)) nextInput.builder = asText(input.patch.builder);
  if (input.patch.buildCommand !== undefined) nextInput.buildCommand = asText(input.patch.buildCommand) || null;
  if (input.patch.startCommand !== undefined) nextInput.startCommand = asText(input.patch.startCommand) || null;
  if (input.patch.rootDirectory !== undefined) nextInput.rootDirectory = asText(input.patch.rootDirectory) || null;
  if (input.patch.healthcheckPath !== undefined) nextInput.healthcheckPath = asText(input.patch.healthcheckPath) || null;
  if (asText(input.patch.sourceImage)) {
    nextInput.source = {
      image: asText(input.patch.sourceImage),
    };
  }
  await railwayAdminRequest(
    `
      mutation AdminRailwayServiceInstanceUpdate(
        $serviceId: String!,
        $environmentId: String!,
        $input: ServiceInstanceUpdateInput!
      ) {
        serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input)
      }
    `,
    {
      serviceId: input.serviceId,
      environmentId: input.environmentId,
      input: nextInput,
    }
  );
}

async function upsertRailwayServiceVariables(input: {
  projectId: string;
  environmentId: string;
  serviceId: string;
  variables: Record<string, string>;
  replace?: boolean;
}) {
  const entries = Object.entries(input.variables).filter(([key, value]) => asText(key) && asText(value));
  if (entries.length === 0) {
    throw new Error('至少需要一个变量');
  }
  await railwayAdminRequest(
    `
      mutation AdminRailwayVariableCollectionUpsert($input: VariableCollectionUpsertInput!) {
        variableCollectionUpsert(input: $input)
      }
    `,
    {
      input: {
        projectId: input.projectId,
        environmentId: input.environmentId,
        serviceId: input.serviceId,
        skipDeploys: true,
        replace: input.replace === true,
        variables: Object.fromEntries(entries),
      },
    }
  );
}

type ManagedAccountRow = {
  userId: string;
  connectorKey: string;
  authStatus: string;
  lastError: string | null;
  updatedAt: Date | null;
  displayName: string | null;
  configJson: unknown;
};

type AdminRailwayManagedAccountRef = {
  userId: string;
  connectorKey: string;
  displayName: string | null;
  authStatus: string;
  lastError: string | null;
  updatedAt: string | null;
  projectKey: string;
};

export type AdminRailwayServiceItem = {
  key: string;
  projectId: string;
  projectName: string | null;
  environmentId: string;
  environmentName: string | null;
  serviceId: string;
  serviceName: string | null;
  primaryDomain: string | null;
  domainCount: number;
  targetPort: number | null;
  latestDeploymentId: string | null;
  latestDeploymentStatus: string | null;
  latestDeploymentAt: string | null;
  latestUrl: string | null;
  latestStaticUrl: string | null;
  linkedUsers: Array<{
    id: string;
    displayName: string | null;
    email: string | null;
    status: string | null;
  }>;
  linkedUserCount: number;
  managedAccountCount: number;
  riskTags: string[];
  variablesPreview: string[];
  refs: AdminRailwayManagedAccountRef[];
  updatedAt: string | null;
};

function railwayDeploymentStatusCategory(status: string | null | undefined) {
  const normalized = asText(status).toUpperCase();
  if (!normalized) return 'unknown';
  if (normalized.includes('FAIL') || normalized.includes('ERROR') || normalized.includes('CRASH') || normalized.includes('CANCEL')) {
    return 'failed';
  }
  if (normalized.includes('SUCCESS') || normalized.includes('ACTIVE') || normalized.includes('READY') || normalized.includes('LIVE')) {
    return 'success';
  }
  if (normalized.includes('BUILD') || normalized.includes('QUEUED') || normalized.includes('DEPLOY') || normalized.includes('PROGRESS')) {
    return 'pending';
  }
  return 'unknown';
}

function buildServiceRiskTags(input: {
  item: AdminRailwayServiceItem;
}) {
  const tags = new Set<string>();
  if (!input.item.primaryDomain) tags.add('无域名');
  if (!input.item.latestDeploymentId) tags.add('无部署');
  if (!input.item.latestUrl && !input.item.latestStaticUrl) tags.add('无访问地址');
  if ((input.item.latestDeploymentStatus || '').toUpperCase().includes('FAIL')) tags.add('部署失败');
  if ((input.item.latestDeploymentStatus || '').toUpperCase().includes('CRASH')) tags.add('运行异常');
  if (input.item.linkedUserCount > 1) tags.add('多用户复用');
  if (input.item.refs.some((ref) => ref.lastError)) tags.add('账号异常');
  return Array.from(tags);
}

async function loadManagedAccountRows(): Promise<ManagedAccountRow[]> {
  return db
    .select({
      userId: userConnectorAccounts.userId,
      connectorKey: userConnectorAccounts.connectorKey,
      authStatus: userConnectorAccounts.authStatus,
      lastError: userConnectorAccounts.lastError,
      updatedAt: userConnectorAccounts.updatedAt,
      displayName: userConnectorAccounts.displayName,
      configJson: userConnectorAccounts.configJson,
    })
    .from(userConnectorAccounts)
    .where(
      and(
        or(
          eq(userConnectorAccounts.connectorKey, INTERNAL_DEPLOYMENT_CONNECTOR_KEY),
          like(userConnectorAccounts.connectorKey, `${INTERNAL_DEPLOYMENT_CONNECTOR_KEY}:%`)
        ),
        eq(userConnectorAccounts.authMode, 'token')
      )
    )
    .orderBy(desc(userConnectorAccounts.updatedAt));
}

async function loadAppUserMap(userIds: string[]) {
  if (userIds.length === 0) return new Map<string, { id: string; displayName: string | null; email: string | null; status: string | null }>();
  const rows = await db
    .select({
      id: appUsers.id,
      displayName: appUsers.displayName,
      email: appUsers.email,
      status: appUsers.status,
    })
    .from(appUsers)
    .where(inArray(appUsers.id, userIds));
  return new Map(rows.map((row) => [row.id, {
    id: row.id,
    displayName: row.displayName || null,
    email: row.email || null,
    status: row.status || null,
  }]));
}

export type AdminRailwayServiceListResponse = {
  summary: {
    total: number;
    withDomain: number;
    failed: number;
    risky: number;
    updatedAt: string | null;
  };
  items: AdminRailwayServiceItem[];
};

export type AdminRailwayBatchActionResponse = {
  total: number;
  successCount: number;
  failureCount: number;
  results: Array<{
    key: string;
    serviceId: string;
    serviceName: string | null;
    ok: boolean;
    message?: string;
  }>;
};

export class AdminRailwayManagementService {
  private async buildManagedServices(options?: {
    hydrateRemote?: boolean;
  }) {
    const rows = await loadManagedAccountRows();
    const grouped = new Map<string, {
      config: NonNullable<ReturnType<typeof parseManagedDeploymentConfig>>;
      rows: ManagedAccountRow[];
    }>();

    for (const row of rows) {
      const config = parseManagedDeploymentConfig(row.configJson);
      if (!config) continue;
      const key = `${config.projectId}:${config.environmentId}:${config.serviceId}`;
      const current = grouped.get(key);
      if (current) {
        current.rows.push(row);
      } else {
        grouped.set(key, {
          config,
          rows: [row],
        });
      }
    }

    const userIds = Array.from(new Set(rows.map((row) => row.userId).filter(Boolean)));
    const appUserMap = await loadAppUserMap(userIds);
    const hydrateRemote = options?.hydrateRemote === true;
    const projectCache = new Map<string, Awaited<ReturnType<typeof loadProjectSummary>>>();
    const runtimeCache = new Map<string, Awaited<ReturnType<typeof loadServiceRuntime>>>();
    const domainCache = new Map<string, Awaited<ReturnType<typeof loadDomains>>>();
    const deploymentDetailCache = new Map<string, Awaited<ReturnType<typeof loadDeploymentDetail>>>();

    const items: AdminRailwayServiceItem[] = [];

    for (const [key, value] of grouped.entries()) {
      const { config, rows: serviceRows } = value;
      const runtimeKey = `${config.projectId}:${config.environmentId}:${config.serviceId}`;
      let projectSummary: Awaited<ReturnType<typeof loadProjectSummary>> | undefined;
      let runtime: Awaited<ReturnType<typeof loadServiceRuntime>> | undefined;
      let domains: Awaited<ReturnType<typeof loadDomains>> | undefined;
      let latestDeploymentDetail: Awaited<ReturnType<typeof loadDeploymentDetail>> | undefined;
      let latestDeploymentId: string | null = null;
      let serviceDomains: Array<{
        id: string;
        domain: string;
        targetPort: number | null;
      }> = [];

      if (hydrateRemote) {
        projectSummary = projectCache.get(config.projectId);
        if (!projectSummary) {
          projectSummary = await loadProjectSummary(config.projectId);
          projectCache.set(config.projectId, projectSummary);
        }

        runtime = runtimeCache.get(runtimeKey);
        if (!runtime) {
          runtime = await loadServiceRuntime({
            projectId: config.projectId,
            environmentId: config.environmentId,
            serviceId: config.serviceId,
          });
          runtimeCache.set(runtimeKey, runtime);
        }

        domains = domainCache.get(runtimeKey);
        if (!domains) {
          domains = await loadDomains({
            projectId: config.projectId,
            environmentId: config.environmentId,
            serviceId: config.serviceId,
          });
          domainCache.set(runtimeKey, domains);
        }

        latestDeploymentId = asText(runtime.serviceInstance?.latestDeployment?.id) || null;
        latestDeploymentDetail = latestDeploymentId ? deploymentDetailCache.get(latestDeploymentId) : undefined;
        if (latestDeploymentId && !latestDeploymentDetail) {
          latestDeploymentDetail = await loadDeploymentDetail(latestDeploymentId);
          deploymentDetailCache.set(latestDeploymentId, latestDeploymentDetail);
        }

        serviceDomains = [
          ...(domains.domains?.serviceDomains || []),
          ...(domains.domains?.customDomains || []),
        ].map((entry) => ({
          id: asText(entry.id),
          domain: asText(entry.domain),
          targetPort: typeof entry.targetPort === 'number' && Number.isFinite(entry.targetPort) ? entry.targetPort : null,
        })).filter((entry) => entry.domain);
      } else if (config.serviceDomain) {
        serviceDomains = [{
          id: '',
          domain: config.serviceDomain,
          targetPort: null,
        }];
      }

      const linkedUsers = serviceRows
        .map((row) => appUserMap.get(row.userId))
        .filter((item): item is NonNullable<typeof item> => Boolean(item));

      const refs = serviceRows.map((row) => ({
        userId: row.userId,
        connectorKey: row.connectorKey,
        displayName: row.displayName,
        authStatus: row.authStatus,
        lastError: row.lastError,
        updatedAt: toIso(row.updatedAt),
        projectKey: config.projectKey,
      }));

      const projectName =
        asText(projectSummary?.project?.name) ||
        config.projectName ||
        null;
      const environmentName =
        projectSummary?.project?.environments?.edges
          ?.map((edge) => ({
            id: asText(edge?.node?.id),
            name: asText(edge?.node?.name),
          }))
          .find((item) => item.id === config.environmentId)?.name ||
        config.environmentName ||
        null;
      const serviceName =
        projectSummary?.project?.services?.edges
          ?.map((edge) => ({
            id: asText(edge?.node?.id),
            name: asText(edge?.node?.name),
          }))
          .find((item) => item.id === config.serviceId)?.name ||
        config.serviceName ||
        null;

      const item: AdminRailwayServiceItem = {
        key,
        projectId: config.projectId,
        projectName,
        environmentId: config.environmentId,
        environmentName,
        serviceId: config.serviceId,
        serviceName,
        primaryDomain: serviceDomains[0]?.domain || config.serviceDomain || null,
        domainCount: serviceDomains.length,
        targetPort: serviceDomains[0]?.targetPort || null,
        latestDeploymentId,
        latestDeploymentStatus:
          asText(runtime?.serviceInstance?.latestDeployment?.status) ||
          asText(latestDeploymentDetail?.deployment?.status) ||
          null,
        latestDeploymentAt:
          toIso(runtime?.serviceInstance?.latestDeployment?.createdAt) ||
          toIso(latestDeploymentDetail?.deployment?.createdAt),
        latestUrl: asText(latestDeploymentDetail?.deployment?.url) || null,
        latestStaticUrl: asText(latestDeploymentDetail?.deployment?.staticUrl) || null,
        linkedUsers,
        linkedUserCount: linkedUsers.length,
        managedAccountCount: refs.length,
        riskTags: [],
        variablesPreview: Object.keys(pickRecord(runtime?.variables)).sort().slice(0, 8),
        refs,
        updatedAt: refs.map((ref) => ref.updatedAt).sort((left, right) => toDateMs(right) - toDateMs(left))[0] || null,
      };
      item.riskTags = buildServiceRiskTags({ item });
      items.push(item);
    }

    return items.sort((left, right) => toDateMs(right.updatedAt || right.latestDeploymentAt) - toDateMs(left.updatedAt || left.latestDeploymentAt));
  }

  async listServices(filters?: {
    query?: string;
    status?: string;
    risk?: string;
    limit?: number;
  }) {
    const items = await this.buildManagedServices({
      hydrateRemote: false,
    });
    const query = asText(filters?.query).toLowerCase();
    const status = asText(filters?.status).toLowerCase();
    const risk = asText(filters?.risk);
    const limit = Number.isFinite(filters?.limit) ? Math.max(1, Math.min(Number(filters?.limit), 300)) : 120;

    const filtered = items.filter((item) => {
      if (status && status !== 'all') {
        const deploymentStatus = railwayDeploymentStatusCategory(item.latestDeploymentStatus);
        if (deploymentStatus !== status) {
          return false;
        }
      }
      if (risk && risk !== 'all' && !item.riskTags.includes(risk)) {
        return false;
      }
      if (query) {
        const haystack = [
          item.projectName,
          item.projectId,
          item.environmentName,
          item.environmentId,
          item.serviceName,
          item.serviceId,
          item.primaryDomain,
          item.latestUrl,
          item.latestStaticUrl,
          ...item.linkedUsers.map((user) => `${user.displayName || ''} ${user.email || ''} ${user.id}`),
          ...item.riskTags,
        ].map((value) => asText(value).toLowerCase()).filter(Boolean);
        if (!haystack.some((value) => value.includes(query))) {
          return false;
        }
      }
      return true;
    }).slice(0, limit);

    return {
      summary: {
        total: filtered.length,
        withDomain: filtered.filter((item) => item.primaryDomain).length,
        failed: filtered.filter((item) => railwayDeploymentStatusCategory(item.latestDeploymentStatus) === 'failed').length,
        risky: filtered.filter((item) => item.riskTags.length > 0).length,
        updatedAt: filtered[0]?.updatedAt || null,
      },
      items: filtered,
    } satisfies AdminRailwayServiceListResponse;
  }

  private async getServicesByKeys(serviceKeys: string[]) {
    const items = await this.buildManagedServices();
    const itemMap = new Map(items.map((item) => [item.key, item]));
    return serviceKeys
      .map((key) => itemMap.get(asText(key)))
      .filter((item): item is AdminRailwayServiceItem => Boolean(item));
  }

  async batchDeleteServices(serviceKeys: string[]) {
    const items = await this.getServicesByKeys(serviceKeys);
    const results: Array<{ key: string; serviceId: string; serviceName: string | null; ok: boolean; message?: string }> = [];

    for (const item of items) {
      try {
        await deleteRailwayService(item.serviceId, item.environmentId);
        for (const ref of item.refs) {
          await userConnectorAccountDAO.deleteByUserAndConnectorKey(ref.userId, ref.connectorKey);
        }
        results.push({
          key: item.key,
          serviceId: item.serviceId,
          serviceName: item.serviceName,
          ok: true,
        });
      } catch (error: any) {
        results.push({
          key: item.key,
          serviceId: item.serviceId,
          serviceName: item.serviceName,
          ok: false,
          message: error instanceof Error ? error.message : '删除服务失败',
        });
      }
    }

    return {
      total: items.length,
      successCount: results.filter((item) => item.ok).length,
      failureCount: results.filter((item) => !item.ok).length,
      results,
    } satisfies AdminRailwayBatchActionResponse;
  }

  async batchConfigureServices(
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
    const items = await this.getServicesByKeys(serviceKeys);
    const results: Array<{ key: string; serviceId: string; serviceName: string | null; ok: boolean; message?: string }> = [];

    for (const item of items) {
      try {
        await updateRailwayServiceInstance({
          serviceId: item.serviceId,
          environmentId: item.environmentId,
          patch,
        });
        results.push({
          key: item.key,
          serviceId: item.serviceId,
          serviceName: item.serviceName,
          ok: true,
        });
      } catch (error: any) {
        results.push({
          key: item.key,
          serviceId: item.serviceId,
          serviceName: item.serviceName,
          ok: false,
          message: error instanceof Error ? error.message : '更新服务配置失败',
        });
      }
    }

    return {
      total: items.length,
      successCount: results.filter((item) => item.ok).length,
      failureCount: results.filter((item) => !item.ok).length,
      results,
    } satisfies AdminRailwayBatchActionResponse;
  }

  async batchUpsertServiceVariables(
    serviceKeys: string[],
    variables: Record<string, string>,
    options?: {
      replace?: boolean;
    }
  ) {
    const items = await this.getServicesByKeys(serviceKeys);
    const results: Array<{ key: string; serviceId: string; serviceName: string | null; ok: boolean; message?: string }> = [];

    for (const item of items) {
      try {
        await upsertRailwayServiceVariables({
          projectId: item.projectId,
          environmentId: item.environmentId,
          serviceId: item.serviceId,
          variables,
          replace: options?.replace,
        });
        results.push({
          key: item.key,
          serviceId: item.serviceId,
          serviceName: item.serviceName,
          ok: true,
        });
      } catch (error: any) {
        results.push({
          key: item.key,
          serviceId: item.serviceId,
          serviceName: item.serviceName,
          ok: false,
          message: error instanceof Error ? error.message : '更新服务变量失败',
        });
      }
    }

    return {
      total: items.length,
      successCount: results.filter((item) => item.ok).length,
      failureCount: results.filter((item) => !item.ok).length,
      results,
    } satisfies AdminRailwayBatchActionResponse;
  }
}

export const adminRailwayManagementService = new AdminRailwayManagementService();
