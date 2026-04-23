import { useState, useEffect, useCallback, useMemo } from 'react';
import { UserDetailDialog } from './UserDetailDialog';
import { BillingStatsDashboard } from './BillingStatsDashboard';
import { BillingUsageLogs } from './BillingUsageLogs';

interface UserCredit {
  userId: string;
  email: string;
  displayName: string;
  balance: number;
  totalEarned: number;
  totalConsumed: number;
  lastRechargeAt: string | null;
}

interface Pricing {
  id: string;
  model: string;
  modelProvider: string;
  promptPricePer1kTokens: number;
  completionPricePer1kTokens: number;
  isActive: boolean;
  cacheHitRatio: number;
  cacheCreationRatio: number;
}

interface BillingStats {
  totalUsers: number;
  totalCreditsConsumed: number;
  totalTokensUsed: number;
  totalSessions: number;
}

export function BillingManagementSection() {
  const [activeTab, setActiveTab] = useState<'users' | 'pricing' | 'stats' | 'logs'>('users');
  const [users, setUsers] = useState<UserCredit[]>([]);
  const [pricing, setPricing] = useState<Pricing[]>([]);
  const [stats, setStats] = useState<BillingStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserCredit | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // Pricing form state
  const [pricingFormOpen, setPricingFormOpen] = useState(false);
  const [pricingForm, setPricingForm] = useState({
    model: '',
    modelProvider: 'openai',
    promptPricePer1kTokens: '',
    completionPricePer1kTokens: '',
  });
  const [pricingFormLoading, setPricingFormLoading] = useState(false);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/internal/billing/users', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        setUsers(data.items || []);
      }
    } catch (error) {
      console.error('获取用户积分列表失败:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchPricing = useCallback(async () => {
    try {
      const response = await fetch('/api/internal/billing/pricing', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        setPricing(data.items || []);
      }
    } catch (error) {
      console.error('获取定价列表失败:', error);
    }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const response = await fetch('/api/internal/billing/stats?period=today', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        setStats({
          totalUsers: data.totalUsers || 0,
          totalCreditsConsumed: data.totalCreditsConsumed || 0,
          totalTokensUsed: data.totalTokensUsed || 0,
          totalSessions: data.totalSessions || 0,
        });
      }
    } catch (error) {
      console.error('获取统计失败:', error);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'users') fetchUsers();
    if (activeTab === 'pricing') fetchPricing();
    if (activeTab === 'stats') fetchStats();
  }, [activeTab, fetchUsers, fetchPricing, fetchStats]);

  const handleUserDetail = useCallback((user: UserCredit) => {
    setSelectedUser(user);
    setDetailOpen(true);
  }, []);

  const totalBalance = useMemo(() => users.reduce((sum, u) => sum + u.balance, 0), [users]);
  const totalConsumed = useMemo(() => users.reduce((sum, u) => sum + u.totalConsumed, 0), [users]);

  const tabs = [
    { key: 'users' as const, label: '用户积分' },
    { key: 'pricing' as const, label: '定价配置' },
    { key: 'stats' as const, label: '平台统计' },
    { key: 'logs' as const, label: '使用明细' },
  ];

  const handleCreatePricing = async () => {
    if (!pricingForm.model || !pricingForm.promptPricePer1kTokens || !pricingForm.completionPricePer1kTokens) return;
    setPricingFormLoading(true);
    try {
      const response = await fetch('/api/internal/billing/pricing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          model: pricingForm.model,
          modelProvider: pricingForm.modelProvider,
          promptPricePer1kTokens: parseInt(pricingForm.promptPricePer1kTokens),
          completionPricePer1kTokens: parseInt(pricingForm.completionPricePer1kTokens),
        }),
      });
      if (response.ok) {
        setPricingForm({ model: '', modelProvider: 'openai', promptPricePer1kTokens: '', completionPricePer1kTokens: '' });
        setPricingFormOpen(false);
        fetchPricing();
      }
    } catch (error) {
      console.error('创建定价失败:', error);
    } finally {
      setPricingFormLoading(false);
    }
  };

  const handleDeactivatePricing = async (id: string) => {
    if (!confirm('确定要停用此定价吗？')) return;
    try {
      const response = await fetch(`/api/internal/billing/pricing/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (response.ok) {
        fetchPricing();
      }
    } catch (error) {
      console.error('停用定价失败:', error);
    }
  };

  return (
    <main className="content-stack viewport-lock-page user-management-page">
      {/* Hero */}
      <section className="user-management-hero">
        <div className="user-management-hero-copy">
          <p className="section-tag">计费中心</p>
          <h2>计费管理</h2>
        </div>
        <div className="sandbox-list-header-actions user-management-hero-actions">
          <section className="user-management-summary-strip user-management-live-summary session-status sandbox-live-count" aria-label="计费摘要">
            <span className="sandbox-live-metric sandbox-live-metric-total">
              <span>用户</span>
              <strong>{users.length}</strong>
            </span>
            <span className="sandbox-live-metric sandbox-live-metric-running">
              <span>总积分</span>
              <strong>{totalBalance.toLocaleString()}</strong>
            </span>
            <span className="sandbox-live-metric sandbox-live-metric-paused">
              <span>累计消费</span>
              <strong>{totalConsumed.toLocaleString()}</strong>
            </span>
            <span className="sandbox-live-metric user-management-live-metric-disabled">
              <span>模型数</span>
              <strong>{pricing.length}</strong>
            </span>
          </section>
        </div>
      </section>

      {/* Tab Bar */}
      <section className="sub-panel user-management-filter-panel" style={{ padding: '12px 16px' }}>
        <div className="user-management-tab-strip" style={{ margin: 0 }}>
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`secondary-btn ${activeTab === tab.key ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>

      {/* Users Tab */}
      {activeTab === 'users' && (
        <section className="sub-panel user-management-list-panel">
          <div className="user-management-list-head">
            <div>
              <p className="section-tag">用户积分</p>
              <p className="panel-caption">共 {users.length} 位用户</p>
            </div>
          </div>

          <div className="table-wrap user-management-table-wrap" aria-live="polite">
            <table className="user-management-table">
              <colgroup>
                <col style={{ width: '20%' }} />
                <col style={{ width: '22%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '12%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th><span className="runtime-th-label">用户</span></th>
                  <th><span className="runtime-th-label">邮箱</span></th>
                  <th><span className="runtime-th-label">当前积分</span></th>
                  <th><span className="runtime-th-label">累计消费</span></th>
                  <th><span className="runtime-th-label">累计获得</span></th>
                  <th className="runtime-col-actions"><span className="runtime-th-label">操作</span></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} className="empty">正在加载用户列表...</td></tr>
                ) : users.length === 0 ? (
                  <tr><td colSpan={6} className="empty">暂无用户数据</td></tr>
                ) : (
                  users.map((user) => (
                    <tr key={user.userId}>
                      <td>
                        <div className="user-management-table-user">
                          <div className="user-management-table-user-head">
                            <strong>{user.displayName}</strong>
                          </div>
                          <small title={user.userId}>{user.userId.slice(0, 8)}...</small>
                        </div>
                      </td>
                      <td>
                        <div className="user-management-table-cell-stack">
                          <p>{user.email}</p>
                        </div>
                      </td>
                      <td>
                        <div className="user-management-table-cell-stack user-management-table-metric">
                          <strong>{user.balance.toLocaleString()}</strong>
                          <small>credits</small>
                        </div>
                      </td>
                      <td>
                        <div className="user-management-table-cell-stack user-management-table-metric">
                          <strong>{user.totalConsumed.toLocaleString()}</strong>
                          <small>credits</small>
                        </div>
                      </td>
                      <td>
                        <div className="user-management-table-cell-stack user-management-table-metric">
                          <strong>{user.totalEarned.toLocaleString()}</strong>
                          <small>credits</small>
                        </div>
                      </td>
                      <td>
                        <div className="user-management-table-actions">
                          <button
                            type="button"
                            className="table-btn"
                            onClick={() => handleUserDetail(user)}
                          >
                            查看详情
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Pricing Tab */}
      {activeTab === 'pricing' && (
        <>
          <section className="sub-panel user-management-list-panel">
            <div className="user-management-list-head">
              <div>
                <p className="section-tag">定价配置</p>
                <p className="panel-caption">共 {pricing.length} 条定价规则</p>
              </div>
              <div className="user-management-filter-actions">
                <button type="button" className="secondary-btn" onClick={() => setPricingFormOpen(true)}>
                  + 新建定价
                </button>
              </div>
            </div>

            <div className="table-wrap user-management-table-wrap" aria-live="polite">
              <table className="user-management-table">
                <colgroup>
                  <col style={{ width: '16%' }} />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '20%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '14%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th><span className="runtime-th-label">模型</span></th>
                    <th><span className="runtime-th-label">提供商</span></th>
                    <th><span className="runtime-th-label">输入单价</span></th>
                    <th><span className="runtime-th-label">输出单价</span></th>
                    <th><span className="runtime-th-label">缓存比例</span></th>
                    <th><span className="runtime-th-label">状态</span></th>
                    <th className="runtime-col-actions"><span className="runtime-th-label">操作</span></th>
                  </tr>
                </thead>
                <tbody>
                  {pricing.length === 0 ? (
                    <tr><td colSpan={7} className="empty">暂无定价数据</td></tr>
                  ) : (
                    pricing.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <div className="user-management-table-user">
                            <div className="user-management-table-user-head">
                              <strong>{p.model}</strong>
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="user-management-table-cell-stack">
                            <span className={`state-chip ${p.modelProvider === 'openai' ? 'status-running' : 'status-paused'}`}>
                              {p.modelProvider}
                            </span>
                          </div>
                        </td>
                        <td>
                          <div className="user-management-table-cell-stack user-management-table-metric">
                            <strong>{p.promptPricePer1kTokens}</strong>
                            <small>/ 1k tokens</small>
                          </div>
                        </td>
                        <td>
                          <div className="user-management-table-cell-stack user-management-table-metric">
                            <strong>{p.completionPricePer1kTokens}</strong>
                            <small>/ 1k tokens</small>
                          </div>
                        </td>
                        <td>
                          <div className="user-management-table-cell-stack">
                            {p.cacheHitRatio > 0 && (
                              <span>命中 {(p.cacheHitRatio * 100).toFixed(0)}%</span>
                            )}
                            {p.cacheCreationRatio > 0 && (
                              <span>创建 {(p.cacheCreationRatio * 100).toFixed(0)}%</span>
                            )}
                          </div>
                        </td>
                        <td>
                          <div className="user-management-table-cell-stack">
                            <span className={`state-chip ${p.isActive ? 'status-running' : 'status-error'}`}>
                              {p.isActive ? '生效中' : '已停用'}
                            </span>
                          </div>
                        </td>
                        <td>
                          <div className="user-management-table-actions">
                            {p.isActive && (
                              <button
                                type="button"
                                className="table-btn"
                                onClick={() => handleDeactivatePricing(p.id)}
                              >
                                停用
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Pricing Form Modal */}
          {pricingFormOpen && (
            <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setPricingFormOpen(false)}>
              <aside
                className="modal-card user-management-modal"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="modal-header user-management-modal-header">
                  <div className="user-management-modal-heading">
                    <p className="section-tag">新建定价</p>
                    <h2>添加模型定价</h2>
                  </div>
                  <div className="user-management-modal-actions">
                    <button type="button" className="secondary-btn" onClick={() => setPricingFormOpen(false)}>
                      关闭
                    </button>
                  </div>
                </div>
                <div className="user-management-modal-body">
                  <div className="user-management-filter-grid">
                    <label>
                      <span>模型名称</span>
                      <input
                        type="text"
                        placeholder="如 gpt-4o"
                        value={pricingForm.model}
                        onChange={(e) => setPricingForm({ ...pricingForm, model: e.target.value })}
                      />
                    </label>
                    <label>
                      <span>提供商</span>
                      <select
                        value={pricingForm.modelProvider}
                        onChange={(e) => setPricingForm({ ...pricingForm, modelProvider: e.target.value })}
                      >
                        <option value="openai">OpenAI</option>
                        <option value="anthropic">Anthropic</option>
                      </select>
                    </label>
                    <label>
                      <span>输入单价（credits / 1k tokens）</span>
                      <input
                        type="number"
                        placeholder="如 25"
                        value={pricingForm.promptPricePer1kTokens}
                        onChange={(e) => setPricingForm({ ...pricingForm, promptPricePer1kTokens: e.target.value })}
                      />
                    </label>
                    <label>
                      <span>输出单价（credits / 1k tokens）</span>
                      <input
                        type="number"
                        placeholder="如 50"
                        value={pricingForm.completionPricePer1kTokens}
                        onChange={(e) => setPricingForm({ ...pricingForm, completionPricePer1kTokens: e.target.value })}
                      />
                    </label>
                  </div>
                  <div className="user-management-filter-actions" style={{ marginTop: '16px' }}>
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={handleCreatePricing}
                      disabled={pricingFormLoading || !pricingForm.model || !pricingForm.promptPricePer1kTokens || !pricingForm.completionPricePer1kTokens}
                    >
                      {pricingFormLoading ? '创建中...' : '创建定价'}
                    </button>
                  </div>
                </div>
              </aside>
            </div>
          )}
        </>
      )}

      {/* Stats Tab */}
      {activeTab === 'stats' && (
        <BillingStatsDashboard />
      )}

      {/* Logs Tab */}
      {activeTab === 'logs' && (
        <BillingUsageLogs />
      )}

      {/* Detail Modal */}
      {detailOpen && selectedUser && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setDetailOpen(false)}>
          <aside
            className="modal-card user-management-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header user-management-modal-header">
              <div className="user-management-modal-heading">
                <p className="section-tag">用户详情</p>
                <h2>{selectedUser.displayName}</h2>
                <p className="panel-caption">{selectedUser.email}</p>
              </div>
              <div className="user-management-modal-actions">
                <button type="button" className="secondary-btn" onClick={() => setDetailOpen(false)}>
                  关闭
                </button>
              </div>
            </div>
            <div className="user-management-modal-body">
              <UserDetailDialog
                user={selectedUser}
                open={true}
                onOpenChange={setDetailOpen}
              />
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}
