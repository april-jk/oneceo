import { useState, useEffect, useCallback } from 'react';
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
  updatedAt?: string;
}

const COLORS = ['#0f766e', '#0d9488', '#14b8a6', '#5eead4', '#99f6e4', '#ccfbf1'];

interface BillingStatsDashboardProps {
  onNotify?: BillingNotify;
}

export function BillingStatsDashboard({ onNotify }: BillingStatsDashboardProps) {
  const [period, setPeriod] = useState<'today' | 'week' | 'month'>('today');
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const updatedAt = stats?.updatedAt ? new Date(stats.updatedAt).toLocaleString('zh-CN', { hour12: false }) : '尚未刷新';

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
        <section className="sub-panel user-management-list-panel">
          <div className="user-management-summary-strip">
            {Array.from({ length: 4 }).map((_, index) => (
              <article key={index} className="user-management-summary-card">
                <div className="user-management-summary-head"><span>加载中</span></div>
                <strong>—</strong>
                <small>正在刷新统计</small>
              </article>
            ))}
          </div>
        </section>
      )}

      {error && !loading ? (
        <section className="sub-panel user-management-list-panel">
          <div className="user-management-empty">
            <p>{error}</p>
            <button type="button" className="secondary-btn" onClick={() => void fetchStats()}>重试</button>
          </div>
        </section>
      ) : null}

      {stats && (
        <>
          {/* Core KPI Cards */}
          <section className="user-management-summary-strip">
            <article className="user-management-summary-card">
              <div className="user-management-summary-head">
                <span>积分消耗</span>
              </div>
              <strong>{formatNumber(stats.totalCreditsConsumed)}</strong>
              <small>credits</small>
            </article>

            <article className="user-management-summary-card">
              <div className="user-management-summary-head">
                <span>Token 使用</span>
              </div>
              <strong>{formatNumber(stats.totalTokensUsed)}</strong>
              <small>tokens</small>
            </article>

            <article className="user-management-summary-card">
              <div className="user-management-summary-head">
                <span>会话次数</span>
              </div>
              <strong>{formatNumber(stats.totalSessions)}</strong>
              <small>次</small>
            </article>

            <article className="user-management-summary-card">
              <div className="user-management-summary-head">
                <span>缓存命中</span>
              </div>
              <strong>{formatNumber(stats.cacheStats.totalCacheHitTokens)}</strong>
              <small>{stats.cacheStats.cacheHitRate}</small>
            </article>

          </section>

          {/* Charts Grid */}
          <section className="user-management-detail-grid">
            {/* Top Users Bar Chart */}
            <article className="sub-panel user-management-detail-card">
              <div className="user-management-list-head">
                <div>
                  <p className="section-tag">消费排行 Top 10</p>
                </div>
              </div>
              {stats.topUsers.length > 0 ? (
                <div style={{ width: '100%', height: 280, padding: '16px' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={stats.topUsers.map((u, i) => ({
                        name: u.displayName || u.email || `用户${i + 1}`,
                        credits: Number(u.totalConsumed),
                        userId: u.userId,
                      }))}
                      layout="vertical"
                      margin={{ left: 20, right: 20, top: 10, bottom: 10 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis type="number" />
                      <YAxis dataKey="name" type="category" width={120} />
                      <Tooltip
                        formatter={(value: number) => [value.toLocaleString(), '积分']}
                        labelFormatter={(_, payload: any) => {
                          if (payload && payload[0]) {
                            return `用户ID: ${payload[0].payload.userId}`;
                          }
                          return '';
                        }}
                      />
                      <Bar dataKey="credits" fill="#0f766e" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="user-management-empty">暂无数据</div>
              )}
            </article>

            {/* Top Models Bar Chart */}
            <article className="sub-panel user-management-detail-card">
              <div className="user-management-list-head">
                <div>
                  <p className="section-tag">模型使用 Top 10</p>
                </div>
              </div>
              {stats.topModels.length > 0 ? (
                <div style={{ width: '100%', height: 280, padding: '16px' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={stats.topModels.map((m) => ({
                        name: m.model.split('/').pop() || m.model,
                        credits: Number(m.creditsConsumed),
                        tokens: Number(m.tokensUsed),
                      }))}
                      layout="vertical"
                      margin={{ left: 20, right: 20, top: 10, bottom: 10 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis type="number" />
                      <YAxis dataKey="name" type="category" width={140} />
                      <Tooltip />
                      <Bar dataKey="credits" fill="#0f766e" name="积分消耗" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="user-management-empty">暂无数据</div>
              )}
            </article>

            {/* Balance Distribution Bar Chart */}
            <article className="sub-panel user-management-detail-card">
              <div className="user-management-list-head">
                <div>
                  <p className="section-tag">用户余额分布</p>
                </div>
              </div>
              {stats.balanceDistribution.length > 0 ? (
                <div style={{ width: '100%', height: 280, padding: '16px' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={stats.balanceDistribution.map((d, index) => ({
                        name: d.range === '0' ? '0 积分' : `${d.range} 积分`,
                        count: Number(d.count),
                        fill: COLORS[index % COLORS.length],
                      }))}
                      layout="vertical"
                      margin={{ left: 20, right: 20, top: 10, bottom: 10 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis type="number" />
                      <YAxis dataKey="name" type="category" width={100} />
                      <Tooltip />
                      <Bar dataKey="count" name="用户数" radius={[0, 4, 4, 0]}>
                        {stats.balanceDistribution.map((_, index) => (
                          <Cell key={`balance-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="user-management-empty">暂无数据</div>
              )}
            </article>

            {/* Cache Stats */}
            <article className="sub-panel user-management-detail-card">
              <div className="user-management-list-head">
                <div>
                  <p className="section-tag">缓存效果概览</p>
                </div>
              </div>
              <div style={{ padding: '16px 24px' }}>
                <div className="user-management-overview-stat-strip">
                  <div className="user-management-overview-stat">
                    <span>缓存命中 Token</span>
                    <strong>{stats.cacheStats.totalCacheHitTokens.toLocaleString()}</strong>
                    <small>{stats.cacheStats.cacheHitRate}</small>
                  </div>
                  <div className="user-management-overview-stat">
                    <span>缓存创建 Token</span>
                    <strong>{stats.cacheStats.totalCacheCreationTokens.toLocaleString()}</strong>
                    <small>tokens</small>
                  </div>
                  <div className="user-management-overview-stat">
                    <span>预估节省积分</span>
                    <strong style={{ color: '#22c55e' }}>{stats.cacheStats.totalCacheSavings.toLocaleString()}</strong>
                    <small>credits</small>
                  </div>
                </div>
                <div className="user-management-overview-note" style={{ marginTop: '12px' }}>
                  * OpenAI 缓存命中按 50% 计费，Anthropic 显式缓存命中按 10% / 创建按 125%，Qwen 隐式缓存命中按 20%。
                </div>
              </div>
            </article>
          </section>
        </>
      )}
    </>
  );
}
