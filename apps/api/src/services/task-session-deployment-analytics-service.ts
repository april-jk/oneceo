import {
  platformDeploymentAccountService,
  type UserPlatformDeploymentAccount,
} from './platform-deployment-account-service';
import { setSandboxMetadata } from './sandbox-activity-service';
import {
  umamiAnalyticsService,
  type UmamiWebsiteSummary,
} from './umami-analytics-service';
import type { DeploymentAnalyticsPanelData } from './railway-deployment-service';

type AnalyticsMetadata = {
  provider: 'umami';
  status: 'ready' | 'pending' | 'unconfigured' | 'error';
  host?: string;
  websiteId?: string;
  websiteName?: string;
  domain?: string;
  tag?: string;
  updatedAt?: string;
  lastError?: string;
};

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function pickRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function normalizeDomain(value: string): string {
  const trimmed = asText(value);
  if (!trimmed) return '';
  const withProtocol =
    trimmed.startsWith('http://') || trimmed.startsWith('https://')
      ? trimmed
      : `https://${trimmed}`;
  try {
    return new URL(withProtocol).hostname.toLowerCase();
  } catch {
    return trimmed.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
  }
}

function pickAnalyticsMetadata(metadataRaw: unknown): AnalyticsMetadata | null {
  const record = pickRecord(metadataRaw);
  if (!record || Object.keys(record).length === 0) {
    return null;
  }
  const provider = asText(record.provider);
  if (provider !== 'umami') {
    return null;
  }

  return {
    provider: 'umami',
    status:
      (asText(record.status) as AnalyticsMetadata['status']) ||
      (asText(record.websiteId) ? 'ready' : 'pending'),
    host: asText(record.host) || undefined,
    websiteId: asText(record.websiteId) || undefined,
    websiteName: asText(record.websiteName) || undefined,
    domain: normalizeDomain(asText(record.domain)) || undefined,
    tag: asText(record.tag) || undefined,
    updatedAt: asText(record.updatedAt) || undefined,
    lastError: asText(record.lastError) || undefined,
  };
}

function buildWebsiteName(sessionId: string, domain: string): string {
  const normalizedDomain = normalizeDomain(domain);
  return normalizedDomain || `OneCEO Session ${sessionId.slice(0, 8)}`;
}

function buildMetadataFromWebsite(input: {
  website: UmamiWebsiteSummary;
  host: string;
  domain: string;
  tag?: string;
  lastError?: string;
}): AnalyticsMetadata {
  return {
    provider: 'umami',
    status: 'ready',
    host: asText(input.host) || undefined,
    websiteId: input.website.id,
    websiteName: input.website.name || undefined,
    domain: normalizeDomain(input.domain) || undefined,
    tag: asText(input.tag) || undefined,
    updatedAt: new Date().toISOString(),
    lastError: asText(input.lastError) || undefined,
  };
}

export async function prepareTaskSessionAnalyticsBinding(input: {
  sessionId: string;
  orchestratorSessionId: string;
  environmentMetadata: unknown;
  account: UserPlatformDeploymentAccount;
  domain?: string;
  tag?: string;
}): Promise<DeploymentAnalyticsPanelData | null> {
  if (!umamiAnalyticsService.isConfigured()) {
    return {
      provider: 'umami',
      configured: false,
      enabled: false,
      status: 'unconfigured',
      message: '平台尚未配置 Umami 集成账号',
    };
  }

  const metadata = pickRecord(input.environmentMetadata);
  const existing = pickAnalyticsMetadata(metadata.analytics);
  const domain = normalizeDomain(input.domain || existing?.domain || input.account.serviceDomain || '');
  if (!domain) {
    return {
      provider: 'umami',
      configured: true,
      enabled: false,
      status: 'pending',
      host: umamiAnalyticsService.getTrackerHost(),
      message: '当前还没有稳定站点域名，暂不创建统计站点',
    };
  }

  const websiteName = existing?.websiteName || buildWebsiteName(input.sessionId, domain);
  const website = await umamiAnalyticsService.ensureWebsiteBinding({
    websiteId: existing?.websiteId,
    name: websiteName,
    domain,
  });
  const tag = asText(input.tag) || existing?.tag || 'production';
  const nextMetadata = buildMetadataFromWebsite({
    website,
    host: umamiAnalyticsService.getTrackerHost(),
    domain,
    tag,
  });

  await platformDeploymentAccountService.upsertApplicationVariables(
    input.account,
    {
      VITE_ANALYTICS_ENABLED: 'true',
      VITE_ANALYTICS_HOST: nextMetadata.host || '',
      VITE_ANALYTICS_WEBSITE_ID: nextMetadata.websiteId || '',
      VITE_ANALYTICS_TAG: tag,
      VITE_PUBLIC_DOMAIN: domain,
      VITE_ANALYTICS_ENDPOINT: nextMetadata.host || '',
    },
    {
      replace: false,
      skipDeploys: true,
    }
  );

  if (input.orchestratorSessionId) {
    await setSandboxMetadata(input.orchestratorSessionId, {
      analytics: nextMetadata,
    });
  }

  return {
    provider: 'umami',
    configured: true,
    enabled: true,
    status: 'ready',
    host: nextMetadata.host,
    websiteId: nextMetadata.websiteId,
    websiteName: nextMetadata.websiteName,
    domain: nextMetadata.domain,
    tag: nextMetadata.tag,
    updatedAt: nextMetadata.updatedAt,
    message: '已完成 Umami 站点绑定与默认变量注入',
  };
}

export async function buildTaskSessionAnalyticsPanel(
  environmentMetadata: unknown
): Promise<DeploymentAnalyticsPanelData | undefined> {
  const metadata = pickRecord(environmentMetadata);
  const existing = pickAnalyticsMetadata(metadata.analytics);

  if (!umamiAnalyticsService.isEnabled()) {
    if (!existing) {
      return {
        provider: 'umami',
        configured: false,
        enabled: false,
        status: 'unconfigured',
        message: '平台未启用 Umami',
      };
    }
    return {
      provider: 'umami',
      configured: false,
      enabled: Boolean(existing.websiteId),
      status: 'unconfigured',
      host: existing.host,
      websiteId: existing.websiteId,
      websiteName: existing.websiteName,
      domain: existing.domain,
      tag: existing.tag,
      updatedAt: existing.updatedAt,
      error: existing.lastError,
      message: '平台当前未启用 Umami，展示最近一次绑定信息',
    };
  }

  if (!existing?.websiteId) {
    return {
      provider: 'umami',
      configured: umamiAnalyticsService.isConfigured(),
      enabled: false,
      status: umamiAnalyticsService.isConfigured() ? 'pending' : 'unconfigured',
      host: existing?.host || umamiAnalyticsService.getTrackerHost(),
      domain: existing?.domain,
      tag: existing?.tag,
      updatedAt: existing?.updatedAt,
      error: existing?.lastError,
      message: existing?.domain
        ? '站点已记录，但还没有完成 website 绑定'
        : '等待首次部署后绑定 Umami website',
    };
  }

  try {
    const metrics = await umamiAnalyticsService.getWebsiteMetrics(existing.websiteId);
    return {
      provider: 'umami',
      configured: true,
      enabled: true,
      status: 'ready',
      host: existing.host || umamiAnalyticsService.getTrackerHost(),
      websiteId: existing.websiteId,
      websiteName: existing.websiteName,
      domain: existing.domain,
      tag: existing.tag,
      pageviews: metrics?.pageviews,
      visits: metrics?.visits,
      visitors: metrics?.visitors,
      events: metrics?.events,
      activeVisitors: metrics?.activeVisitors,
      updatedAt: metrics?.updatedAt || existing.updatedAt,
      message: '展示近 30 天聚合数据与当前在线访客',
    };
  } catch (error: any) {
    return {
      provider: 'umami',
      configured: true,
      enabled: true,
      status: 'error',
      host: existing.host || umamiAnalyticsService.getTrackerHost(),
      websiteId: existing.websiteId,
      websiteName: existing.websiteName,
      domain: existing.domain,
      tag: existing.tag,
      pageviews: asNumber((metadata.analytics as Record<string, unknown> | undefined)?.pageviews),
      visits: asNumber((metadata.analytics as Record<string, unknown> | undefined)?.visits),
      visitors: asNumber((metadata.analytics as Record<string, unknown> | undefined)?.visitors),
      activeVisitors: asNumber((metadata.analytics as Record<string, unknown> | undefined)?.activeVisitors),
      updatedAt: existing.updatedAt,
      error: asText(error?.message) || existing.lastError,
      message: '统计读取失败，但不影响部署与访问链路',
    };
  }
}
