import { useState, useEffect, useCallback, useMemo, type CSSProperties } from 'react';
import { getBillingErrorMessage, readBillingResponseError, type BillingNotify } from './billing-feedback';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
  Legend,
  Line,
  Area,
  Sector,
  ComposedChart,
} from 'recharts';

interface StatsData {
  period: string;
  totalCreditsConsumed: number;
  totalTokensUsed: number;
  totalSessions: number;
  cacheStats: {
    totalCacheHitTokens: number;
    totalCacheCreationTokens: number;
    totalCacheSavings: number;
    cacheHitRate: string;
  };
  topUsers: Array<{
    userId: string;
    email?: string;
    displayName?: string;
    totalConsumed: number;
  }>;
  topModels: Array<{
    model: string;
    creditsConsumed: number;
    tokensUsed: number;
    cachedTokens: number;
  }>;
  balanceDistribution: Array<{
    range: string;
    count: number;
  }>;
  trend?: Array<{
    label: string;
    consumed: number;
    recharged: number;
  }>;
  updatedAt?: string;
}

/* ─── Color tokens ─── */
const C = {
  primary: 'var(--primary)',
  text: 'var(--text)',
  textSoft: 'var(--text-soft)',
  textFaint: 'var(--text-faint)',
  border: 'var(--border)',
  surfaceMuted: 'var(--surface-muted)',
  surfaceStrong: 'var(--surface-strong)',
  danger: 'var(--danger)',
  success: 'var(--success)',
};

const PIE_COLORS = [
  'var(--primary)',
  'var(--primary-soft, oklch(57% 0.13 221))',
  'var(--success)',
  'var(--warning, oklch(67% 0.16 75))',
  'var(--danger)',
  'var(--info, oklch(55% 0.18 300))',
];

/* ─── Tooltip ─── */
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;

  const firstItem = payload[0];
  const raw = firstItem?.payload;

  let title = label ?? '';
  if (raw?.userId && label) {
    title = `${label} · ID: ${raw.userId}`;
  }

  return (
    <div className="billing-chart-tooltip">
      {title && <div className="billing-chart-tooltip-title">{title}</div>}
      {payload.map((entry: any, idx: number) => (
        <div key={idx} className="billing-chart-tooltip-row">
          <span
            className="billing-chart-tooltip-dot"
            style={{ background: entry.color }}
          />
          <span className="billing-chart-tooltip-label">
            {entry.name || (entry.dataKey === 'credits' ? '积分消耗' : entry.dataKey === 'value' ? '用户数' : entry.dataKey)}
          </span>
          <span className="billing-chart-tooltip-value">
            {typeof entry.value === 'number' ? entry.value.toLocaleString() : entry.value}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ─── Pie active shape ─── */
function PieActiveShape(props: any) {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props;
  return (
    <Sector
      cx={cx}
      cy={cy}
      innerRadius={innerRadius}
      outerRadius={outerRadius + 5}
      startAngle={startAngle}
      endAngle={endAngle}
      fill={fill}
      stroke={C.surfaceMuted}
      strokeWidth={2}
    />
  );
}

/* ─── Y-axis tick formatter ─── */
function truncateLabel(maxLen: number) {
  return (value: string) => {
    if (value.length <= maxLen) return value;
    return value.slice(0, maxLen - 1) + '…';
  };
}

/* ─── Empty state ─── */
function ChartEmpty({ message = '暂无数据' }: { message?: string }) {
  return (
    <div className="billing-chart-empty">
      <span>{message}</span>
    </div>
  );
}

/* ─── Props ─── */
interface BillingStatsDashboardProps {
  onNotify?: BillingNotify;
}

export function BillingStatsDashboard({ onNotify }: BillingStatsDashboardProps) {
  const [period, setPeriod] = useState<'today' | 'week' | 'month'>('today');
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activePieIndex, setActivePieIndex] = useState<number | undefined>();

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/internal/billing/stats?period=${period}`, {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        setStats(data);
        setError(null);
      } else {
        const message = await readBillingResponseError(response, '无法获取平台统计');
        setError(message);
        onNotify?.('error', '加载失败', message);
      }
    } catch (error) {
      console.error('获取平台统计失败:', error);
      const message = getBillingErrorMessage(error, '无法获取平台统计');
      setError(message);
      onNotify?.('error', '加载失败', message);
    } finally {
      setLoading(false);
    }
  }, [onNotify, period]);

  useEffect(() => {
    void fetchStats();
  }, [fetchStats]);

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toLocaleString();
  };

  const updatedAt = stats?.updatedAt
    ? new Date(stats.updatedAt).toLocaleString('zh-CN', { hour12: false })
    : '尚未刷新';

  /* ── Derived chart data ── */
  const topUsersData = useMemo(
    () =>
      stats?.topUsers.map((u, i) => ({
        name: u.displayName || u.email || `用户${i + 1}`,
        credits: Number(u.totalConsumed),
        userId: u.userId,
      })) ?? [],
    [stats?.topUsers]
  );

  const topModelsData = useMemo(
    () =>
      stats?.topModels.map((m) => ({
        name: m.model.split('/').pop() || m.model,
        credits: Number(m.creditsConsumed),
        tokens: Number(m.tokensUsed),
      })) ?? [],
    [stats?.topModels]
  );

  const balanceData = useMemo(
    () =>
      stats?.balanceDistribution.map((d) => ({
        name: d.range === '0' ? '0 积分' : `${d.range} 积分`,
        value: Number(d.count),
      })) ?? [],
    [stats?.balanceDistribution]
  );

  const balanceTotal = useMemo(
    () => balanceData.reduce((sum, d) => sum + d.value, 0),
    [balanceData]
  );

  /* ─── Axis tick styles ─── */
  const axisTick = { fontSize: 11, fill: C.textFaint };
  const yAxisTickSoft = { fontSize: 11, fill: C.textSoft };

  return (
    <>
      {/* Period Selector */}
      <section className="sub-panel user-management-filter-panel" style={{ padding: '12px 16px' }}>
        <div className="user-management-tab-strip" style={{ margin: 0 }}>
          {[
            { key: 'today' as const, label: '今日' },
            { key: 'week' as const, label: '近7天' },
            { key: 'month' as const, label: '近30天' },
          ].map((p) => (
            <button
              key={p.key}
              type="button"
              className={`secondary-btn ${period === p.key ? 'active' : ''}`}
              onClick={() => setPeriod(p.key)}
            >
              {p.label}
            </button>
          ))}
          <button type="button" className="secondary-btn" onClick={() => void fetchStats()} disabled={loading}>
            {loading ? '刷新中...' : '刷新'}
          </button>
          <span className="panel-caption" style={{ alignSelf: 'center' }}>更新于 {updatedAt}</span>
        </div>
      </section>

      {loading && (
        <section className="billing-metric-strip">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="billing-metric-item">
              <span className="billing-metric-label">加载中</span>
              <strong className="billing-metric-value">—</strong>
              <span className="billing-metric-unit">正在刷新统计</span>
            </div>
          ))}
        </section>
      )}

      {error && !loading ? (
        <section className="sub-panel billing-analytics-panel">
          <div className="billing-chart-empty">
            <p>{error}</p>
            <button type="button" className="secondary-btn" onClick={() => void fetchStats()}>重试</button>
          </div>
        </section>
      ) : null}

      {stats && (
        <>
          {/* Core KPI Strip */}
          <section className="billing-metric-strip billing-metric-strip-compact">
            <div className="billing-metric-item">
              <span className="billing-metric-label">积分消耗</span>
              <strong className="billing-metric-value">{formatNumber(stats.totalCreditsConsumed)}</strong>
              <span className="billing-metric-unit">credits</span>
            </div>
            <div className="billing-metric-item">
              <span className="billing-metric-label">Token 使用</span>
              <strong className="billing-metric-value">{formatNumber(stats.totalTokensUsed)}</strong>
              <span className="billing-metric-unit">tokens</span>
            </div>
            <div className="billing-metric-item">
              <span className="billing-metric-label">会话次数</span>
              <strong className="billing-metric-value">{formatNumber(stats.totalSessions)}</strong>
              <span className="billing-metric-unit">次</span>
            </div>
            <div className="billing-metric-item">
              <span className="billing-metric-label">缓存命中</span>
              <strong className="billing-metric-value">{formatNumber(stats.cacheStats.totalCacheHitTokens)}</strong>
              <span className="billing-metric-unit">{stats.cacheStats.cacheHitRate}</span>
            </div>
          </section>

          {/* Analytics Panel */}
          <section className="sub-panel billing-analytics-panel">
            <div className="billing-chart-grid">
              {/* ── Top Users Rank List ── */}
              <div className="billing-chart-section top-users-rank-shell">
                <div className="billing-chart-section-head">
                  <p className="section-tag">消费排行 Top 10</p>
                  <p className="billing-chart-caption">条形排行直读积分规模，突出头部消耗</p>
                </div>
                {stats.topUsers.length > 0 ? (
                  <div className="top-users-rank-list">
                    {topUsersData.map((user, index) => {
                      const maxCredits = topUsersData[0]?.credits || 1;
                      const width = Math.max(8, Math.round((user.credits / maxCredits) * 100));
                      return (
                        <div key={`top-users-rank-${user.userId}`} className="top-users-rank-row" style={{ '--rank-width': `${width}%` } as CSSProperties}>
                          <span className="top-users-rank-index">{String(index + 1).padStart(2, '0')}</span>
                          <span className="top-users-rank-name">{user.name}</span>
                          <span className="top-users-rank-track" aria-hidden="true"><i className="top-users-rank-fill" /></span>
                          <strong className="top-users-rank-value">{formatNumber(user.credits)}</strong>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <ChartEmpty message="暂无消费数据" />
                )}
              </div>

              {/* ── Top Models Bar Chart ── */}
              <div className="billing-chart-section top-users-rank-shell">
                <div className="billing-chart-section-head">
                  <p className="section-tag">模型使用 Top 10</p>
                  <p className="billing-chart-caption">与消费排行一致的条形排行，按积分消耗降序</p>
                </div>
                {stats.topModels.length > 0 ? (
                  <div className="top-users-rank-list">
                    {topModelsData.map((model, index) => {
                      const maxCredits = topModelsData[0]?.credits || 1;
                      const width = Math.max(8, Math.round((model.credits / maxCredits) * 100));
                      return (
                        <div key={`top-models-rank-${model.name}`} className="top-users-rank-row" style={{ '--rank-width': `${width}%` } as CSSProperties}>
                          <span className="top-users-rank-index">{String(index + 1).padStart(2, '0')}</span>
                          <span className="top-users-rank-name">{model.name}</span>
                          <span className="top-users-rank-track" aria-hidden="true"><i className="top-users-rank-fill" /></span>
                          <strong className="top-users-rank-value">{formatNumber(model.credits)}</strong>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <ChartEmpty message="暂无模型使用数据" />
                )}
              </div>

              <div className="billing-chart-section balance-modern-shell">
                <div className="billing-chart-section-head">
                  <p className="section-tag">用户余额分布</p>
                  <p className="billing-chart-caption">环形占比 + 明细排行 · 共 {balanceTotal.toLocaleString()} 人</p>
                </div>
                {stats.balanceDistribution.length > 0 ? (
                  <div className="balance-modern-body">
                    <div className="balance-modern-donut">
                      <ResponsiveContainer width="100%" height={216}>
                        <PieChart>
                          <Pie data={balanceData} cx="50%" cy="50%" outerRadius={92} innerRadius={64} dataKey="value" nameKey="name" paddingAngle={3} stroke="var(--surface-strong)" strokeWidth={3}>
                            {balanceData.map((_, index) => (
                              <Cell key={`balance-modern-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip content={<ChartTooltip />} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="balance-modern-total">
                        <strong>{balanceTotal.toLocaleString()}</strong>
                        <span>用户总数</span>
                      </div>
                    </div>
                    <div className="balance-modern-list">
                      {balanceData.map((item, index) => (
                        <div key={`balance-modern-row-${item.name}`} className="balance-modern-row" style={{ '--balance-color': PIE_COLORS[index % PIE_COLORS.length] } as CSSProperties}>
                          <i className="balance-modern-dot" aria-hidden="true" />
                          <span className="balance-modern-label">{item.name}</span>
                          <strong className="balance-modern-value">{item.value.toLocaleString()} 人</strong>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <ChartEmpty message="暂无余额分布数据" />
                )}
              </div>

              {/* ── Credits Trend Line Chart ── */}
              <div className="billing-chart-section credit-trend-modern-shell">
                <div className="billing-chart-section-head">
                  <p className="section-tag">积分消费/充值趋势</p>
                  <p className="billing-chart-caption">趋势线保留，顶部补充关键总量，减少读图成本</p>
                </div>
                {stats.trend && stats.trend.length > 0 ? (
                  <>
                    <div className="credit-trend-modern-summary">
                      <div className="credit-trend-modern-card" style={{ '--trend-color': C.danger } as CSSProperties}>
                        <span>累计消费</span>
                        <strong>{formatNumber(stats.trend.reduce((sum, item) => sum + item.consumed, 0))}</strong>
                      </div>
                      <div className="credit-trend-modern-card" style={{ '--trend-color': C.success } as CSSProperties}>
                        <span>累计充值</span>
                        <strong>{formatNumber(stats.trend.reduce((sum, item) => sum + item.recharged, 0))}</strong>
                      </div>
                    </div>
                    <div className="credit-trend-modern-chart">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={stats.trend} margin={{ left: 4, right: 20, top: 8, bottom: 4 }}>
                          <CartesianGrid vertical={false} stroke={C.border} strokeDasharray="3 3" />
                          <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} minTickGap={18} />
                          <YAxis tick={axisTick} axisLine={false} tickLine={false} width={52} tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v.toString())} />
                          <Tooltip content={<ChartTooltip />} />
                          <Line type="monotone" dataKey="consumed" name="积分消费" stroke={C.danger} strokeWidth={3} dot={{ r: 3, fill: C.surfaceStrong, stroke: C.danger, strokeWidth: 2 }} />
                          <Line type="monotone" dataKey="recharged" name="积分充值" stroke={C.success} strokeWidth={3} dot={{ r: 3, fill: C.surfaceStrong, stroke: C.success, strokeWidth: 2 }} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </>
                ) : (
                  <ChartEmpty message="暂无趋势数据" />
                )}
              </div>
            </div>
          </section>
        </>
      )}
    </>
  );
}
