import { sql } from 'drizzle-orm';
import { db } from '../config/database';
import {
  type UmamiWebsiteExpandedMetric,
  type UmamiWebsitePageviews,
  type UmamiWebsiteStats,
  type UmamiWebsiteStatsRange,
  umamiAnalyticsService,
} from './umami-analytics-service';

export type PlatformOperationsAnalyticsRangeKey = '24h' | '7d' | '30d' | '90d';

export type PlatformOperationsAnalyticsMetric = {
  key: string;
  label: string;
  value: number;
  source: 'umami' | 'oneceo_db';
  unit?: 'count' | 'percent' | 'seconds';
};

export type PlatformOperationsAnalyticsOverview = {
  updatedAt: string;
  range: {
    key: PlatformOperationsAnalyticsRangeKey;
    startAt: string;
    endAt: string;
    unit: UmamiWebsiteStatsRange['unit'];
    timezone: string;
  };
  source: {
    umami: {
      configured: boolean;
      host: string;
      teamId: string | null;
      websiteId: string | null;
    };
    oneceoDb: {
      configured: true;
    };
  };
  traffic: {
    stats: UmamiWebsiteStats;
    activeVisitors: number;
    bounceRate: number;
    averageVisitDurationSeconds: number;
    pageviews: UmamiWebsitePageviews;
  };
  acquisition: {
    referrers: UmamiWebsiteExpandedMetric[];
    channels: UmamiWebsiteExpandedMetric[];
    entryPages: UmamiWebsiteExpandedMetric[];
  };
  behavior: {
    topPages: UmamiWebsiteExpandedMetric[];
    devices: UmamiWebsiteExpandedMetric[];
    events: UmamiWebsiteExpandedMetric[];
  };
  business: {
    metrics: PlatformOperationsAnalyticsMetric[];
  };
  alerts: string[];
};

type QueryRows = { rows?: unknown[] } | unknown[];
type QueryFn = (query: unknown) => Promise<QueryRows>;

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function rowsOf(result: QueryRows): unknown[] {
  if (Array.isArray(result)) return result;
  return Array.isArray(result.rows) ? result.rows : [];
}

function normalizeRange(value: unknown): PlatformOperationsAnalyticsRangeKey {
  const text = asText(value).toLowerCase();
  if (text === '24h' || text === '7d' || text === '30d' || text === '90d') {
    return text;
  }
  return '7d';
}

function buildRange(key: PlatformOperationsAnalyticsRangeKey, now = Date.now()) {
  const hours = key === '24h' ? 24 : key === '7d' ? 7 * 24 : key === '30d' ? 30 * 24 : 90 * 24;
  const startAt = now - hours * 60 * 60 * 1000;
  return {
    key,
    startAt,
    endAt: now,
    unit: key === '24h' ? 'hour' as const : 'day' as const,
  };
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

function calculateBounceRate(stats: UmamiWebsiteStats) {
  if (!stats.visits) return 0;
  return Number(((stats.bounces / stats.visits) * 100).toFixed(1));
}

function calculateAverageVisitDurationSeconds(stats: UmamiWebsiteStats) {
  if (!stats.visits) return 0;
  return Number((stats.totaltime / stats.visits).toFixed(1));
}

export class PlatformOperationsAnalyticsService {
  constructor(
    private readonly query: QueryFn = (query) => db.execute(query as any) as Promise<QueryRows>,
    private readonly now: () => number = () => Date.now()
  ) {}

  async getBusinessMetrics(range: { startAt: number; endAt: number }): Promise<PlatformOperationsAnalyticsMetric[]> {
    const startAt = new Date(range.startAt);
    const endAt = new Date(range.endAt);
    const result = await this.query(sql`
      SELECT
        (SELECT COUNT(*) FROM app_users WHERE created_at >= ${startAt} AND created_at < ${endAt}) AS "newUsers",
        (
          SELECT COUNT(DISTINCT user_id)
          FROM app_user_sessions
          WHERE last_seen_at >= ${startAt}
            AND last_seen_at < ${endAt}
            AND revoked_at IS NULL
        ) AS "activeLoggedInUsers",
        (
          SELECT COUNT(*)
          FROM task_creation_sessions
          WHERE created_at >= ${startAt}
            AND created_at < ${endAt}
        ) AS "newTaskSessions",
        (
          SELECT COUNT(*)
          FROM task_creation_sessions
          WHERE status = 'completed'
            AND COALESCE(completed_at, updated_at) >= ${startAt}
            AND COALESCE(completed_at, updated_at) < ${endAt}
        ) AS "completedTaskSessions",
        (
          SELECT COUNT(*)
          FROM task_creation_sessions
          WHERE status = 'failed'
            AND updated_at >= ${startAt}
            AND updated_at < ${endAt}
        ) AS "failedTaskSessions",
        (
          SELECT COUNT(*)
          FROM task_session_runs
          WHERE created_at >= ${startAt}
            AND created_at < ${endAt}
        ) AS "agentRunsStarted",
        (
          SELECT COUNT(*)
          FROM task_session_runs
          WHERE status = 'completed'
            AND COALESCE(completed_at, updated_at) >= ${startAt}
            AND COALESCE(completed_at, updated_at) < ${endAt}
        ) AS "agentRunsCompleted",
        (
          SELECT COUNT(*)
          FROM task_session_runs
          WHERE status = 'failed'
            AND updated_at >= ${startAt}
            AND updated_at < ${endAt}
        ) AS "agentRunsFailed",
        (
          SELECT COUNT(DISTINCT session_id)
          FROM task_session_sandbox_bindings
          WHERE created_at >= ${startAt}
            AND created_at < ${endAt}
        ) AS "sandboxBoundSessions"
    `);

    const row = asObject(rowsOf(result)[0]);
    return [
      { key: 'newUsers', label: '新增注册用户', value: asNumber(row.newUsers), source: 'oneceo_db' },
      { key: 'activeLoggedInUsers', label: '活跃登录用户', value: asNumber(row.activeLoggedInUsers), source: 'oneceo_db' },
      { key: 'newTaskSessions', label: '新建任务会话', value: asNumber(row.newTaskSessions), source: 'oneceo_db' },
      { key: 'completedTaskSessions', label: '完成任务会话', value: asNumber(row.completedTaskSessions), source: 'oneceo_db' },
      { key: 'failedTaskSessions', label: '失败任务会话', value: asNumber(row.failedTaskSessions), source: 'oneceo_db' },
      { key: 'agentRunsStarted', label: 'Agent Run 启动', value: asNumber(row.agentRunsStarted), source: 'oneceo_db' },
      { key: 'agentRunsCompleted', label: 'Agent Run 完成', value: asNumber(row.agentRunsCompleted), source: 'oneceo_db' },
      { key: 'agentRunsFailed', label: 'Agent Run 失败', value: asNumber(row.agentRunsFailed), source: 'oneceo_db' },
      { key: 'sandboxBoundSessions', label: 'Sandbox 绑定会话', value: asNumber(row.sandboxBoundSessions), source: 'oneceo_db' },
    ];
  }

  async getOverview(input?: { range?: unknown; timezone?: unknown }): Promise<PlatformOperationsAnalyticsOverview> {
    const range = buildRange(normalizeRange(input?.range), this.now());
    const timezone = asText(input?.timezone) || 'Asia/Shanghai';
    const websiteId = umamiAnalyticsService.getPlatformWebsiteId();
    const umamiConfigured = umamiAnalyticsService.isPlatformWebsiteConfigured();
    const alerts: string[] = [];

    let stats = emptyStats();
    let activeVisitors = 0;
    let pageviews = emptyPageviews();
    let referrers: UmamiWebsiteExpandedMetric[] = [];
    let channels: UmamiWebsiteExpandedMetric[] = [];
    let entryPages: UmamiWebsiteExpandedMetric[] = [];
    let topPages: UmamiWebsiteExpandedMetric[] = [];
    let devices: UmamiWebsiteExpandedMetric[] = [];
    let events: UmamiWebsiteExpandedMetric[] = [];

    if (umamiConfigured && websiteId) {
      try {
        const [statsResult, activeResult, pageviewsResult, referrerResult, channelResult, entryResult, pageResult, deviceResult, eventResult] =
          await Promise.all([
            umamiAnalyticsService.getWebsiteStats(websiteId, range),
            umamiAnalyticsService.getWebsiteActiveVisitors(websiteId, { scope: 'platform' }),
            umamiAnalyticsService.getWebsitePageviews(websiteId, { ...range, timezone }),
            umamiAnalyticsService.getWebsiteMetric(websiteId, { ...range, type: 'referrer', limit: 8, expanded: true }),
            umamiAnalyticsService.getWebsiteMetric(websiteId, { ...range, type: 'channel', limit: 8, expanded: true }),
            umamiAnalyticsService.getWebsiteMetric(websiteId, { ...range, type: 'entry', limit: 8, expanded: true }),
            umamiAnalyticsService.getWebsiteMetric(websiteId, { ...range, type: 'path', limit: 10, expanded: true }),
            umamiAnalyticsService.getWebsiteMetric(websiteId, { ...range, type: 'device', limit: 8, expanded: true }),
            umamiAnalyticsService.getWebsiteMetric(websiteId, { ...range, type: 'event', limit: 12, expanded: true }),
          ]);

        stats = statsResult || emptyStats();
        activeVisitors = activeResult || 0;
        pageviews = pageviewsResult || emptyPageviews();
        referrers = referrerResult;
        channels = channelResult;
        entryPages = entryResult;
        topPages = pageResult;
        devices = deviceResult;
        events = eventResult;
      } catch (error) {
        alerts.push(`Umami 数据读取失败：${error instanceof Error ? error.message : '未知错误'}`);
      }
    } else {
      alerts.push('Umami 平台 website 未配置，当前仅展示 OneCEO DB 业务事实。');
    }

    const businessMetrics = await this.getBusinessMetrics(range);

    return {
      updatedAt: new Date(this.now()).toISOString(),
      range: {
        key: range.key,
        startAt: new Date(range.startAt).toISOString(),
        endAt: new Date(range.endAt).toISOString(),
        unit: range.unit,
        timezone,
      },
      source: {
        umami: {
          configured: umamiConfigured,
          host: umamiAnalyticsService.getTrackerHost(),
          teamId: asText(process.env.UMAMI_PLATFORM_TEAM_ID) || null,
          websiteId: websiteId || null,
        },
        oneceoDb: {
          configured: true,
        },
      },
      traffic: {
        stats,
        activeVisitors,
        bounceRate: calculateBounceRate(stats),
        averageVisitDurationSeconds: calculateAverageVisitDurationSeconds(stats),
        pageviews,
      },
      acquisition: {
        referrers,
        channels,
        entryPages,
      },
      behavior: {
        topPages,
        devices,
        events,
      },
      business: {
        metrics: businessMetrics,
      },
      alerts,
    };
  }
}

export const platformOperationsAnalyticsService = new PlatformOperationsAnalyticsService();
