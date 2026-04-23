import { useState, useEffect } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
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
}

const COLORS = ['#0f766e', '#0d9488', '#14b8a6', '#5eead4', '#99f6e4', '#ccfbf1'];
const PIE_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e'];

export function BillingStatsDashboard() {
  const [period, setPeriod] = useState<'today' | 'week' | 'month'>('today');
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchStats = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/internal/billing/stats?period=${period}`, {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        setStats(data);
      }
    } catch (error) {
      console.error('获取平台统计失败:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, [period]);

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toLocaleString();
  };

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
        </div>
      </section>

      {loading && (
        <section className="sub-panel user-management-list-panel">
          <div className="user-management-empty">正在加载统计数据...</div>
        </section>
      )}

      {stats && (
        <>
          {/* Summary Cards */}
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

            <article className="user-management-summary-card">
              <div className="user-management-summary-head">
                <span>缓存节省</span>
              </div>
              <strong>{formatNumber(stats.cacheStats.totalCacheSavings)}</strong>
              <small>credits</small>
            </article>

            <article className="user-management-summary-card">
              <div className="user-management-summary-head">
                <span>缓存创建</span>
              </div>
              <strong>{formatNumber(stats.cacheStats.totalCacheCreationTokens)}</strong>
              <small>tokens</small>
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
                        name: `用户${i + 1}`,
                        credits: Number(u.totalConsumed),
                        userId: u.userId.slice(0, 8),
                      }))}
                      layout="vertical"
                      margin={{ left: 20, right: 20, top: 10, bottom: 10 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis type="number" />
                      <YAxis dataKey="name" type="category" width={60} />
                      <Tooltip
                        formatter={(value: number) => [value.toLocaleString(), '积分']}
                        labelFormatter={(_, payload: any) => {
                          if (payload && payload[0]) {
                            return `用户ID: ${payload[0].payload.userId}...`;
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
                      margin={{ left: 20, right: 20, top: 10, bottom: 40 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="name" angle={-30} textAnchor="end" height={60} />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="credits" fill="#0f766e" name="积分消耗" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="tokens" fill="#14b8a6" name="Token 数" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="user-management-empty">暂无数据</div>
              )}
            </article>

            {/* Balance Distribution Pie Chart */}
            <article className="sub-panel user-management-detail-card">
              <div className="user-management-list-head">
                <div>
                  <p className="section-tag">用户余额分布</p>
                </div>
              </div>
              {stats.balanceDistribution.length > 0 ? (
                <div style={{ width: '100%', height: 280, padding: '16px' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={stats.balanceDistribution.map((d) => ({
                          name: d.range === '0' ? '0积分' : `${d.range}积分`,
                          value: Number(d.count),
                        }))}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="value"
                      >
                        {stats.balanceDistribution.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
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
                  * OpenAI 缓存命中按 50% 计费，Anthropic 按 10% 计费
                </div>
              </div>
            </article>
          </section>
        </>
      )}
    </>
  );
}
