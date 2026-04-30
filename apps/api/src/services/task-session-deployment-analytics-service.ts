import {
  platformDeploymentAccountService,
  type UserPlatformDeploymentAccount,
} from './platform-deployment-account-service';
import { setSandboxMetadata } from './sandbox-activity-service';
import {
  umamiAnalyticsService,
  type UmamiWebsiteExpandedMetric,
  type UmamiWebsitePageviews,
  type UmamiWebsiteStats,
  type UmamiWebsiteStatsRange,
  type UmamiWebsiteSummary,
} from './umami-analytics-service';
import type { DeploymentAnalyticsPanelData } from './railway-deployment-service';

type AnalyticsMetadata = {
  provider: 'umami';
  status: 'bound' | 'tracking' | 'pending' | 'pending_domain' | 'unconfigured' | 'error';
  host?: string;
  websiteId?: string;
  websiteName?: string;
  domain?: string;
  tag?: string;
  updatedAt?: string;
  lastError?: string;
};

export type TaskSessionDeploymentAnalyticsRangeKey = '24h' | '7d' | '30d';

export type TaskSessionDeploymentAnalyticsOverview = {
  updatedAt: string;
  configured: boolean;
  enabled: boolean;
  status: AnalyticsMetadata['status'] | 'empty';
  message?: string;
  error?: string;
  range: {
    key: TaskSessionDeploymentAnalyticsRangeKey;
    startAt: string;
    endAt: string;
    unit: UmamiWebsiteStatsRange['unit'];
    timezone: string;
  };
  stats: UmamiWebsiteStats;
  activeVisitors: number;
  bounceRate: number;
  averageVisitDurationSeconds: number;
  pageviews: UmamiWebsitePageviews;
  topPages: UmamiWebsiteExpandedMetric[];
  referrers: UmamiWebsiteExpandedMetric[];
  regions: UmamiWebsiteExpandedMetric[];
  devices: UmamiWebsiteExpandedMetric[];
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

function asMetricNumber(value: unknown): number {
  return asNumber(value) || 0;
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
      (asText(record.websiteId) ? 'bound' : 'pending_domain'),
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
    status: 'bound',
    host: asText(input.host) || undefined,
    websiteId: input.website.id,
    websiteName: input.website.name || undefined,
    domain: normalizeDomain(input.domain) || undefined,
    tag: asText(input.tag) || undefined,
    updatedAt: new Date().toISOString(),
    lastError: asText(input.lastError) || undefined,
  };
}

function hasTrackingEvidence(metrics: {
  pageviews?: number;
  visits?: number;
  visitors?: number;
  events?: number;
  activeVisitors?: number;
} | null | undefined) {
  return [
    metrics?.pageviews,
    metrics?.visits,
    metrics?.visitors,
    metrics?.events,
    metrics?.activeVisitors,
  ].some((value) => typeof value === 'number' && value > 0);
}

function emptyStats(): UmamiWebsiteStats {
  return {
    pageviews: 0,
    visits: 0,
    visitors: 0,
    bounces: 0,
    totaltime: 0,
  };
}

function emptyPageviews(): UmamiWebsitePageviews {
  return {
    pageviews: [],
    sessions: [],
  };
}

function normalizeAnalyticsRange(value: unknown): TaskSessionDeploymentAnalyticsRangeKey {
  const text = asText(value).toLowerCase();
  if (text === '7d' || text === '30d') return text;
  return '24h';
}

function buildAnalyticsRange(key: TaskSessionDeploymentAnalyticsRangeKey): {
  range: UmamiWebsiteStatsRange;
  timezone: string;
} {
  const endAt = Date.now();
  const timezone = 'Asia/Shanghai';
  if (key === '24h') {
    return {
      range: {
        startAt: endAt - 24 * 60 * 60 * 1000,
        endAt,
        unit: 'hour',
        timezone,
        scope: 'deployment',
      },
      timezone,
    };
  }
  const days = key === '7d' ? 7 : 30;
  return {
    range: {
      startAt: endAt - days * 24 * 60 * 60 * 1000,
      endAt,
      unit: 'day',
      timezone,
      scope: 'deployment',
    },
    timezone,
  };
}

function calculateBounceRate(stats: UmamiWebsiteStats) {
  return stats.visits > 0 ? Math.round((stats.bounces / stats.visits) * 100) : 0;
}

function calculateAverageVisitDurationSeconds(stats: UmamiWebsiteStats) {
  return stats.visits > 0 ? Math.round(stats.totaltime / stats.visits) : 0;
}

export async function prepareTaskSessionAnalyticsBinding(input: {
  sessionId: string;
  orchestratorSessionId: string;
  environmentMetadata: unknown;
  account: UserPlatformDeploymentAccount;
  domain?: string;
  tag?: string;
}): Promise<DeploymentAnalyticsPanelData | null> {
  if (!umamiAnalyticsService.isConfigured('deployment')) {
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
      status: 'pending_domain',
      host: umamiAnalyticsService.getTrackerHost(),
      message: '当前还没有稳定站点域名，暂不创建统计站点',
    };
  }

  const websiteName =
    existing?.websiteId &&
    existing.websiteName &&
    !existing.websiteName.includes('railway.app')
      ? existing.websiteName
      : buildWebsiteName(input.sessionId, domain);
  const website = await umamiAnalyticsService.ensureWebsiteBinding({
    scope: 'deployment',
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
    status: 'bound',
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

  if (!umamiAnalyticsService.isEnabled('deployment')) {
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
      configured: umamiAnalyticsService.isConfigured('deployment'),
      enabled: false,
      status: umamiAnalyticsService.isConfigured('deployment') ? 'pending_domain' : 'unconfigured',
      host: existing?.host || umamiAnalyticsService.getTrackerHost(),
      domain: existing?.domain,
      tag: existing?.tag,
      updatedAt: existing?.updatedAt,
      error: existing?.lastError,
      message: existing?.domain
        ? '站点域名已记录，等待平台完成 Umami website 绑定'
        : '等待首次部署后绑定 Umami website',
    };
  }

  try {
    const metrics = await umamiAnalyticsService.getWebsiteMetrics(existing.websiteId);
    const tracking = hasTrackingEvidence(metrics);
    return {
      provider: 'umami',
      configured: true,
      enabled: true,
      status: tracking ? 'tracking' : 'bound',
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
      message: tracking
        ? '已验证线上站点存在 Umami 访问数据'
        : '已完成 Umami website 绑定，等待线上站点产生首批访问数据',
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

export async function buildTaskSessionDeploymentAnalyticsOverview(
  environmentMetadata: unknown,
  rangeKeyInput: unknown
): Promise<TaskSessionDeploymentAnalyticsOverview> {
  const metadata = pickRecord(environmentMetadata);
  const existing = pickAnalyticsMetadata(metadata.analytics);
  const key = normalizeAnalyticsRange(rangeKeyInput);
  const { range, timezone } = buildAnalyticsRange(key);
  const baseRange = {
    key,
    startAt: new Date(range.startAt).toISOString(),
    endAt: new Date(range.endAt).toISOString(),
    unit: range.unit,
    timezone,
  };
  const base = {
    updatedAt: new Date().toISOString(),
    configured: umamiAnalyticsService.isConfigured('deployment'),
    enabled: Boolean(existing?.websiteId),
    status: existing?.status || ('empty' as const),
    range: baseRange,
    stats: emptyStats(),
    activeVisitors: 0,
    bounceRate: 0,
    averageVisitDurationSeconds: 0,
    pageviews: emptyPageviews(),
    topPages: [],
    referrers: [],
    regions: [],
    devices: [],
  };

  if (!umamiAnalyticsService.isEnabled('deployment')) {
    return {
      ...base,
      configured: false,
      enabled: Boolean(existing?.websiteId),
      status: 'unconfigured',
      message: '平台未启用 Umami',
    };
  }

  if (!existing?.websiteId) {
    return {
      ...base,
      status: existing?.domain ? 'pending_domain' : 'empty',
      message: existing?.domain
        ? '站点域名已记录，等待平台完成 Umami website 绑定'
        : '等待首次部署后绑定 Umami website',
    };
  }

  try {
    const [
      statsResult,
      activeVisitorsResult,
      pageviewsResult,
      topPagesResult,
      referrersResult,
      regionsResult,
      devicesResult,
    ] = await Promise.all([
      umamiAnalyticsService.getWebsiteStats(existing.websiteId, range),
      umamiAnalyticsService.getWebsiteActiveVisitors(existing.websiteId, {
        scope: 'deployment',
      }),
      umamiAnalyticsService.getWebsitePageviews(existing.websiteId, range),
      umamiAnalyticsService.getWebsiteMetric(existing.websiteId, {
        ...range,
        type: 'path',
        limit: 10,
        expanded: true,
      }),
      umamiAnalyticsService.getWebsiteMetric(existing.websiteId, {
        ...range,
        type: 'referrer',
        limit: 8,
        expanded: true,
      }),
      umamiAnalyticsService.getWebsiteMetric(existing.websiteId, {
        ...range,
        type: 'country',
        limit: 8,
        expanded: true,
      }),
      umamiAnalyticsService.getWebsiteMetric(existing.websiteId, {
        ...range,
        type: 'device',
        limit: 8,
        expanded: true,
      }),
    ]);
    const stats = statsResult || emptyStats();
    return {
      ...base,
      enabled: true,
      status:
        hasTrackingEvidence({
          pageviews: stats.pageviews,
          visits: stats.visits,
          visitors: stats.visitors,
          activeVisitors: activeVisitorsResult,
        })
          ? 'tracking'
          : 'bound',
      stats,
      activeVisitors: activeVisitorsResult || 0,
      bounceRate: calculateBounceRate(stats),
      averageVisitDurationSeconds: calculateAverageVisitDurationSeconds(stats),
      pageviews: pageviewsResult || emptyPageviews(),
      topPages: topPagesResult,
      referrers: referrersResult,
      regions: regionsResult,
      devices: devicesResult,
    };
  } catch (error: any) {
    return {
      ...base,
      enabled: true,
      status: 'error',
      error: asText(error?.message) || '统计读取失败',
      message: '统计读取失败，但不影响部署与访问链路',
      stats: {
        pageviews: asMetricNumber((metadata.analytics as Record<string, unknown> | undefined)?.pageviews),
        visits: asMetricNumber((metadata.analytics as Record<string, unknown> | undefined)?.visits),
        visitors: asMetricNumber((metadata.analytics as Record<string, unknown> | undefined)?.visitors),
        bounces: 0,
        totaltime: 0,
      },
      activeVisitors: asMetricNumber(
        (metadata.analytics as Record<string, unknown> | undefined)?.activeVisitors
      ),
    };
  }
}
