import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type {
  OperationsAnalyticsExpandedMetric,
  OperationsAnalyticsOverview,
  OperationsAnalyticsRangeKey,
} from '../types';

type Props = {
  onError: (message: string | null) => void;
  onUpdatedAtChange?: (value: string | null) => void;
  onRegisterRefresh?: (handler: (() => Promise<void>) | null) => void;
};

const RANGE_OPTIONS: Array<{ key: OperationsAnalyticsRangeKey; label: string }> = [
  { key: '24h', label: '24 小时' },
  { key: '7d', label: '7 天' },
  { key: '30d', label: '30 天' },
  { key: '90d', label: '90 天' },
];

function formatNumber(value: number | null | undefined) {
  return new Intl.NumberFormat('zh-CN').format(Number(value || 0));
}

function formatPercent(value: number | null | undefined) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function formatSeconds(value: number | null | undefined) {
  const total = Math.max(0, Math.round(Number(value || 0)));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}m ${seconds}s`;
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function metricValueLabel(value: number, unit?: string) {
  if (unit === 'percent') return formatPercent(value);
  if (unit === 'seconds') return formatSeconds(value);
  return formatNumber(value);
}

function MetricList({
  title,
  caption,
  items,
  valueKey = 'visitors',
}: {
  title: string;
  caption: string;
  items: OperationsAnalyticsExpandedMetric[];
  valueKey?: 'visitors' | 'visits' | 'pageviews';
}) {
  const maxValue = Math.max(1, ...items.map((item) => Number(item[valueKey] || 0)));
  return (
    <article className="operations-analytics-panel">
      <div className="operations-analytics-panel-head">
        <div>
          <h3>{title}</h3>
          <p>{caption}</p>
        </div>
      </div>
      <div className="operations-analytics-list">
        {items.length === 0 ? (
          <p className="user-management-empty">暂无数据</p>
        ) : (
          items.map((item) => {
            const value = Number(item[valueKey] || 0);
            const width = Math.max(4, Math.round((value / maxValue) * 100));
            return (
              <div key={`${title}-${item.name}`} className="operations-analytics-list-row">
                <div className="operations-analytics-list-main">
                  <span>{item.name || '-'}</span>
                  <strong>{formatNumber(value)}</strong>
                </div>
                <div className="operations-analytics-bar" aria-hidden="true">
                  <span style={{ width: `${width}%` }} />
                </div>
                <div className="operations-analytics-list-meta">
                  <span>PV {formatNumber(item.pageviews)}</span>
                  <span>访问 {formatNumber(item.visits)}</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </article>
  );
}

export function OperationsAnalyticsSection({ onError, onUpdatedAtChange, onRegisterRefresh }: Props) {
  const [range, setRange] = useState<OperationsAnalyticsRangeKey>('7d');
  const [overview, setOverview] = useState<OperationsAnalyticsOverview | null>(null);
  const [loading, setLoading] = useState(false);

  const loadOverview = useCallback(async (nextRange = range) => {
    setLoading(true);
    try {
      const result = await api.getOperationsAnalyticsOverview({
        range: nextRange,
        timezone: 'Asia/Shanghai',
      });
      setOverview(result);
      onUpdatedAtChange?.(result.updatedAt);
      onError(null);
    } catch (error) {
      onError(error instanceof Error ? error.message : '运营数据加载失败');
    } finally {
      setLoading(false);
    }
  }, [onError, onUpdatedAtChange, range]);

  useEffect(() => {
    void loadOverview(range);
  }, [loadOverview, range]);

  useEffect(() => {
    onRegisterRefresh?.(() => loadOverview(range));
    return () => onRegisterRefresh?.(null);
  }, [loadOverview, onRegisterRefresh, range]);

  const sparkline = useMemo(() => {
    const points = overview?.traffic.pageviews.pageviews || [];
    const maxValue = Math.max(1, ...points.map((item) => item.y));
    return points.map((item) => ({
      ...item,
      height: Math.max(8, Math.round((item.y / maxValue) * 100)),
    }));
  }, [overview?.traffic.pageviews.pageviews]);

  const sourceLabel = overview?.source.umami.configured ? 'Umami 已连接' : 'Umami 未配置';

  return (
    <section className="user-management-page operations-analytics-page">
      <div className="user-management-hero">
        <div className="user-management-hero-copy">
          <p className="eyebrow">运营数据中心</p>
          <h2>OneCEO 平台增长与使用数据</h2>
          <p className="panel-caption">
            固定读取 OneCEO 平台 Umami website，并合并注册、会话、Agent Run 与 Sandbox 绑定等业务事实。
          </p>
        </div>
        <div className="user-management-hero-actions operations-analytics-actions">
          <div className="operations-analytics-range" role="group" aria-label="时间范围">
            {RANGE_OPTIONS.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`secondary-btn ${range === item.key ? 'active' : ''}`}
                onClick={() => setRange(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <section className="operations-analytics-source">
        <span className={`state-chip ${overview?.source.umami.configured ? 'status-running' : 'status-paused'}`}>
          {sourceLabel}
        </span>
        <span>websiteId: {overview?.source.umami.websiteId || '-'}</span>
        <span>更新时间: {formatDateTime(overview?.updatedAt)}</span>
        {loading ? <span>正在刷新</span> : null}
      </section>

      {overview?.alerts.length ? (
        <section className="operations-analytics-alerts">
          {overview.alerts.map((item) => (
            <p key={item}>{item}</p>
          ))}
        </section>
      ) : null}

      <section className="user-management-summary-strip operations-analytics-summary">
        <article className="user-management-summary-card">
          <span>访客</span>
          <strong>{formatNumber(overview?.traffic.stats.visitors)}</strong>
          <small>Umami visitors</small>
        </article>
        <article className="user-management-summary-card">
          <span>访问</span>
          <strong>{formatNumber(overview?.traffic.stats.visits)}</strong>
          <small>Umami visits</small>
        </article>
        <article className="user-management-summary-card">
          <span>页面浏览</span>
          <strong>{formatNumber(overview?.traffic.stats.pageviews)}</strong>
          <small>Umami pageviews</small>
        </article>
        <article className="user-management-summary-card">
          <span>当前活跃访客</span>
          <strong>{formatNumber(overview?.traffic.activeVisitors)}</strong>
          <small>最近 5 分钟</small>
        </article>
        <article className="user-management-summary-card">
          <span>跳出率</span>
          <strong>{formatPercent(overview?.traffic.bounceRate)}</strong>
          <small>bounces / visits</small>
        </article>
        <article className="user-management-summary-card">
          <span>平均访问时长</span>
          <strong>{formatSeconds(overview?.traffic.averageVisitDurationSeconds)}</strong>
          <small>总停留 / visits</small>
        </article>
      </section>

      <section className="operations-analytics-grid operations-analytics-grid-main">
        <article className="operations-analytics-panel">
          <div className="operations-analytics-panel-head">
            <div>
              <h3>访问趋势</h3>
              <p>{overview ? `${formatDateTime(overview.range.startAt)} 至 ${formatDateTime(overview.range.endAt)}` : '等待数据'}</p>
            </div>
          </div>
          <div className="operations-analytics-sparkline">
            {sparkline.length === 0 ? (
              <p className="user-management-empty">暂无趋势数据</p>
            ) : (
              sparkline.map((item) => (
                <span key={item.x} title={`${formatDateTime(item.x)}: ${formatNumber(item.y)}`}>
                  <i style={{ height: `${item.height}%` }} />
                </span>
              ))
            )}
          </div>
        </article>

        <article className="operations-analytics-panel">
          <div className="operations-analytics-panel-head">
            <div>
              <h3>业务事实</h3>
              <p>来自 OneCEO DB，不依赖 Umami 身份识别。</p>
            </div>
          </div>
          <div className="operations-analytics-business-grid">
            {(overview?.business.metrics || []).map((item) => (
              <div key={item.key} className="operations-analytics-business-card">
                <span>{item.label}</span>
                <strong>{metricValueLabel(item.value, item.unit)}</strong>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="operations-analytics-grid">
        <MetricList title="来源 Referrer" caption="判断获客来源质量。" items={overview?.acquisition.referrers || []} />
        <MetricList title="入口页面" caption="判断首屏承接与入口价值。" items={overview?.acquisition.entryPages || []} valueKey="pageviews" />
        <MetricList title="页面路径" caption="判断产品功能访问热度。" items={overview?.behavior.topPages || []} valueKey="pageviews" />
        <MetricList title="功能事件" caption="判断用户真实操作行为。" items={overview?.behavior.events || []} />
        <MetricList title="渠道 Channel" caption="按 Umami 渠道聚合。" items={overview?.acquisition.channels || []} />
        <MetricList title="设备 Device" caption="辅助判断端侧体验优先级。" items={overview?.behavior.devices || []} />
      </section>
    </section>
  );
}
