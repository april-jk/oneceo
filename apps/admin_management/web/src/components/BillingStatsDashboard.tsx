import { useState, useEffect, useCallback, useMemo } from 'react';
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
  primary: 'oklch(54% 0.19 259)',
  text: 'var(--text)',
  textSoft: 'var(--text-soft)',
  textFaint: 'var(--text-faint)',
  border: 'var(--border)',
  surfaceMuted: 'var(--surface-muted)',
  surfaceStrong: 'var(--surface-strong)',
  danger: 'oklch(55% 0.19 27)',
  success: 'oklch(57% 0.15 154)',
};

const PIE_COLORS = [
  'oklch(54% 0.19 259)',
  'oklch(57% 0.13 221)',
  'oklch(57% 0.15 154)',
  'oklch(67% 0.16 75)',
  'oklch(55% 0.19 27)',
  'oklch(55% 0.18 300)',
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
          <section className="billing-metric-strip">
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
              {/* ── Top Users Bar Chart ── */}
              <div className="billing-chart-section">
                <div className="billing-chart-section-head">
                  <p className="section-tag">消费排行 Top 10</p>
                  <p className="billing-chart-caption">按积分消耗量降序排列</p>
                </div>
                {stats.topUsers.length > 0 ? (
                  <div className="billing-chart-body">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={topUsersData}
                        layout="vertical"
                        margin={{ left: 4, right: 20, top: 4, bottom: 4 }}
                      >
                        <CartesianGrid
                          horizontal={false}
                          strokeDasharray="3 3"
                          stroke={C.border}
                        />
                        <XAxis
                          type="number"
                          tick={axisTick}
                          axisLine={{ stroke: C.border }}
                          tickLine={false}
                        />
                        <YAxis
                          dataKey="name"
                          type="category"
                          width={118}
                          tick={yAxisTickSoft}
                          axisLine={false}
                          tickLine={false}
                          tickFormatter={truncateLabel(14)}
                        />
                        <Tooltip
                          content={<ChartTooltip />}
                          cursor={{ fill: 'var(--surface-muted)' }}
                        />
                        <Bar
                          dataKey="credits"
                          fill={C.primary}
                          radius={[0, 6, 6, 0]}
                          barSize={18}
                          animationDuration={600}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <ChartEmpty message="暂无消费数据" />
                )}
              </div>

              {/* ── Top Models Bar Chart ── */}
              <div className="billing-chart-section">
                <div className="billing-chart-section-head">
                  <p className="section-tag">模型使用 Top 10</p>
                  <p className="billing-chart-caption">各模型积分消耗占比</p>
                </div>
                {stats.topModels.length > 0 ? (
                  <div className="billing-chart-body">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={topModelsData}
                        layout="vertical"
                        margin={{ left: 4, right: 20, top: 4, bottom: 4 }}
                      >
                        <CartesianGrid
                          horizontal={false}
                          strokeDasharray="3 3"
                          stroke={C.border}
                        />
                        <XAxis
                          type="number"
                          tick={axisTick}
                          axisLine={{ stroke: C.border }}
                          tickLine={false}
                        />
                        <YAxis
                          dataKey="name"
                          type="category"
                          width={130}
                          tick={yAxisTickSoft}
                          axisLine={false}
                          tickLine={false}
                          tickFormatter={truncateLabel(16)}
                        />
                        <Tooltip
                          content={<ChartTooltip />}
                          cursor={{ fill: 'var(--surface-muted)' }}
                        />
                        <Bar
                          dataKey="credits"
                          name="积分消耗"
                          fill={C.primary}
                          radius={[0, 6, 6, 0]}
                          barSize={18}
                          animationDuration={600}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <ChartEmpty message="暂无模型使用数据" />
                )}
              </div>

              {/* ── Balance Distribution Pie Chart ── */}
              <div className="billing-chart-section">
                <div className="billing-chart-section-head">
                  <p className="section-tag">用户余额分布</p>
                  <p className="billing-chart-caption">按余额区间统计用户数 · 共 {balanceTotal.toLocaleString()} 人</p>
                </div>
                {stats.balanceDistribution.length > 0 ? (
                  <div className="billing-chart-body">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={balanceData}
                          cx="50%"
                          cy="45%"
                          outerRadius={82}
                          innerRadius={52}
                          dataKey="value"
                          nameKey="name"
                          paddingAngle={2}
                          stroke={C.surfaceMuted}
                          strokeWidth={2}
                          activeIndex={activePieIndex}
                          activeShape={PieActiveShape}
                          onMouseEnter={(_, index) => setActivePieIndex(index)}
                          onMouseLeave={() => setActivePieIndex(undefined)}
                          animationDuration={700}
                          animationBegin={100}
                        >
                          {balanceData.map((_, index) => (
                            <Cell
                              key={`balance-${index}`}
                              fill={PIE_COLORS[index % PIE_COLORS.length]}
                            />
                          ))}
                        </Pie>
                        <Tooltip content={<ChartTooltip />} />
                        <Legend
                          verticalAlign="bottom"
                          align="center"
                          iconType="circle"
                          iconSize={8}
                          wrapperStyle={{
                            paddingTop: 12,
                            fontSize: 12,
                            color: 'var(--text-soft)',
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <ChartEmpty message="暂无余额分布数据" />
                )}
              </div>

              {/* ── Credits Trend Line Chart ── */}
              <div className="billing-chart-section">
                <div className="billing-chart-section-head">
                  <p className="section-tag">积分消费/充值趋势</p>
                  <p className="billing-chart-caption">单位：积分</p>
                </div>
                {stats.trend && stats.trend.length > 0 ? (
                  <div className="billing-chart-body">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart
                        data={stats.trend}
                        margin={{ left: 4, right: 20, top: 8, bottom: 4 }}
                      >
                        <defs>
                          <linearGradient id="consumedFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={C.danger} stopOpacity={0.08} />
                            <stop offset="100%" stopColor={C.danger} stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="rechargedFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={C.success} stopOpacity={0.08} />
                            <stop offset="100%" stopColor={C.success} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid
                          vertical={false}
                          strokeDasharray="3 3"
                          stroke={C.border}
                        />
                        <XAxis
                          dataKey="label"
                          minTickGap={20}
                          tick={axisTick}
                          axisLine={{ stroke: C.border }}
                          tickLine={false}
                        />
                        <YAxis
                          tick={axisTick}
                          axisLine={false}
                          tickLine={false}
                          width={56}
                          tickFormatter={(v: number) =>
                            v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v.toString()
                          }
                        />
                        <Tooltip content={<ChartTooltip />} />
                        <Legend
                          verticalAlign="top"
                          align="right"
                          iconType="circle"
                          iconSize={7}
                          wrapperStyle={{
                            paddingBottom: 8,
                            fontSize: 12,
                            color: 'var(--text-soft)',
                          }}
                        />
                        <Area
                          type="monotone"
                          dataKey="consumed"
                          stroke="none"
                          fill="url(#consumedFill)"
                          animationDuration={800}
                        />
                        <Area
                          type="monotone"
                          dataKey="recharged"
                          stroke="none"
                          fill="url(#rechargedFill)"
                          animationDuration={800}
                        />
                        <Line
                          type="monotone"
                          dataKey="consumed"
                          name="积分消费"
                          stroke={C.danger}
                          strokeWidth={2.5}
                          dot={{ r: 3, fill: C.surfaceStrong, stroke: C.danger, strokeWidth: 2 }}
                          activeDot={{ r: 5, strokeWidth: 0 }}
                          animationDuration={800}
                        />
                        <Line
                          type="monotone"
                          dataKey="recharged"
                          name="积分充值"
                          stroke={C.success}
                          strokeWidth={2.5}
                          dot={{ r: 3, fill: C.surfaceStrong, stroke: C.success, strokeWidth: 2 }}
                          activeDot={{ r: 5, strokeWidth: 0 }}
                          animationDuration={800}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
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
