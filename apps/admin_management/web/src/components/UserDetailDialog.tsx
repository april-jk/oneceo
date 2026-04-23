import { useState, useEffect, useCallback } from 'react';

interface UserDetailDialogProps {
  user: {
    userId: string;
    email: string;
    displayName: string;
    balance: number;
    totalEarned: number;
    totalConsumed: number;
    lastRechargeAt: string | null;
  } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface Transaction {
  id: string;
  type: string;
  amount: number;
  balanceAfter: number;
  description: string;
  createdAt: string;
}

interface UsageLog {
  id: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  creditsConsumed: number;
  createdAt: string;
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

export function UserDetailDialog({ user, open, onOpenChange }: UserDetailDialogProps) {
  const [activeTab, setActiveTab] = useState('overview');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [usageLogs, setUsageLogs] = useState<UsageLog[]>([]);
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [adjustLoading, setAdjustLoading] = useState(false);
  const [txPage, setTxPage] = useState(1);
  const [txTotal, setTxTotal] = useState(0);

  const fetchTransactions = useCallback(async () => {
    if (!user) return;
    try {
      const response = await fetch(`/api/internal/billing/users/${user.userId}/transactions?page=${txPage}&limit=20`, {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        setTransactions(data.items || []);
        setTxTotal(data.total || 0);
      }
    } catch (error) {
      console.error('获取交易记录失败:', error);
    }
  }, [user, txPage]);

  const fetchUsageLogs = useCallback(async () => {
    if (!user) return;
    try {
      const response = await fetch(`/api/internal/billing/usage-logs?userId=${user.userId}&limit=50`, {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        setUsageLogs(data.items || []);
      }
    } catch (error) {
      console.error('获取使用明细失败:', error);
    }
  }, [user]);

  useEffect(() => {
    if (user && open) {
      fetchTransactions();
      fetchUsageLogs();
    }
  }, [user, open, fetchTransactions, fetchUsageLogs]);

  const handleAdjust = async () => {
    if (!user || !adjustAmount) return;
    setAdjustLoading(true);
    try {
      const response = await fetch(`/api/internal/billing/users/${user.userId}/adjust`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          amount: parseInt(adjustAmount),
          reason: adjustReason || '人工调整',
        }),
      });
      if (response.ok) {
        setAdjustAmount('');
        setAdjustReason('');
        fetchTransactions();
      }
    } catch (error) {
      console.error('调整积分失败:', error);
    } finally {
      setAdjustLoading(false);
    }
  };

  if (!open || !user) return null;

  const tabs = [
    { key: 'overview', label: '概览' },
    { key: 'history', label: '积分历史' },
    { key: 'usage', label: '使用明细' },
    { key: 'adjust', label: '积分调整' },
  ];

  return (
    <>
      {/* Summary Cards */}
      <section className="user-management-summary-strip">
        <article className="user-management-summary-card">
          <div className="user-management-summary-head">
            <span>当前余额</span>
          </div>
          <strong>{user.balance.toLocaleString()}</strong>
          <small>credits</small>
        </article>

        <article className="user-management-summary-card">
          <div className="user-management-summary-head">
            <span>累计获得</span>
          </div>
          <strong>{user.totalEarned.toLocaleString()}</strong>
          <small>credits</small>
        </article>

        <article className="user-management-summary-card">
          <div className="user-management-summary-head">
            <span>累计消费</span>
          </div>
          <strong>{user.totalConsumed.toLocaleString()}</strong>
          <small>credits</small>
        </article>

        <article className="user-management-summary-card">
          <div className="user-management-summary-head">
            <span>最后充值</span>
          </div>
          <strong>{user.lastRechargeAt ? formatDateTime(user.lastRechargeAt) : '无'}</strong>
          <small>{user.lastRechargeAt ? '上次充值时间' : '从未充值'}</small>
        </article>
      </section>

      {/* Inner Tab Strip */}
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

      {/* Overview */}
      {activeTab === 'overview' && (
        <>
          <section className="sub-panel user-management-list-panel">
            <div className="user-management-list-head">
              <div>
                <p className="section-tag">最近交易</p>
                <p className="panel-caption">共 {txTotal} 条记录</p>
              </div>
            </div>
            <div className="table-wrap user-management-table-wrap">
              <table className="user-management-table">
                <thead>
                  <tr>
                    <th><span className="runtime-th-label">时间</span></th>
                    <th><span className="runtime-th-label">类型</span></th>
                    <th><span className="runtime-th-label">金额</span></th>
                    <th><span className="runtime-th-label">余额</span></th>
                    <th><span className="runtime-th-label">描述</span></th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.slice(0, 5).map((tx) => (
                    <tr key={tx.id}>
                      <td>
                        <div className="user-management-table-cell-stack">
                          <strong>{formatDateTime(tx.createdAt)}</strong>
                        </div>
                      </td>
                      <td>
                        <span className={`state-chip ${tx.type === 'consume' ? 'status-error' : tx.type === 'recharge' ? 'status-running' : 'status-paused'}`}>
                          {tx.type === 'consume' ? '消费' : tx.type === 'recharge' ? '充值' : '调整'}
                        </span>
                      </td>
                      <td>
                        <div className="user-management-table-cell-stack user-management-table-metric">
                          <strong style={{ color: tx.amount < 0 ? '#c03d3d' : '#0f766e' }}>
                            {tx.amount > 0 ? '+' : ''}{tx.amount}
                          </strong>
                          <small>credits</small>
                        </div>
                      </td>
                      <td>
                        <div className="user-management-table-cell-stack user-management-table-metric">
                          <strong>{tx.balanceAfter.toLocaleString()}</strong>
                          <small>credits</small>
                        </div>
                      </td>
                      <td><p>{tx.description}</p></td>
                    </tr>
                  ))}
                  {transactions.length === 0 && (
                    <tr><td colSpan={5} className="empty">暂无交易记录</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="sub-panel user-management-list-panel">
            <div className="user-management-list-head">
              <div>
                <p className="section-tag">最近使用</p>
                <p className="panel-caption">共 {usageLogs.length} 条记录</p>
              </div>
            </div>
            <div className="table-wrap user-management-table-wrap">
              <table className="user-management-table">
                <thead>
                  <tr>
                    <th><span className="runtime-th-label">时间</span></th>
                    <th><span className="runtime-th-label">模型</span></th>
                    <th><span className="runtime-th-label">Token 数</span></th>
                    <th><span className="runtime-th-label">积分</span></th>
                  </tr>
                </thead>
                <tbody>
                  {usageLogs.slice(0, 5).map((log) => (
                    <tr key={log.id}>
                      <td>
                        <div className="user-management-table-cell-stack">
                          <strong>{formatDateTime(log.createdAt)}</strong>
                        </div>
                      </td>
                      <td><strong>{log.model}</strong></td>
                      <td>
                        <div className="user-management-table-cell-stack user-management-table-metric">
                          <strong>{log.totalTokens.toLocaleString()}</strong>
                          <small>tokens</small>
                        </div>
                      </td>
                      <td>
                        <div className="user-management-table-cell-stack user-management-table-metric">
                          <strong style={{ color: '#c03d3d' }}>-{log.creditsConsumed.toLocaleString()}</strong>
                          <small>credits</small>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {usageLogs.length === 0 && (
                    <tr><td colSpan={4} className="empty">暂无使用记录</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {/* History */}
      {activeTab === 'history' && (
        <section className="sub-panel user-management-list-panel">
          <div className="user-management-list-head">
            <div>
              <p className="section-tag">积分历史</p>
              <p className="panel-caption">共 {txTotal} 条记录，第 {txPage} 页</p>
            </div>
          </div>
          <div className="table-wrap user-management-table-wrap">
            <table className="user-management-table">
              <thead>
                <tr>
                  <th><span className="runtime-th-label">时间</span></th>
                  <th><span className="runtime-th-label">类型</span></th>
                  <th><span className="runtime-th-label">金额</span></th>
                  <th><span className="runtime-th-label">余额</span></th>
                  <th><span className="runtime-th-label">描述</span></th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr key={tx.id}>
                    <td>
                      <div className="user-management-table-cell-stack">
                        <strong>{formatDateTime(tx.createdAt)}</strong>
                      </div>
                    </td>
                    <td>
                      <span className={`state-chip ${tx.type === 'consume' ? 'status-error' : tx.type === 'recharge' ? 'status-running' : 'status-paused'}`}>
                        {tx.type === 'consume' ? '消费' : tx.type === 'recharge' ? '充值' : '调整'}
                      </span>
                    </td>
                    <td>
                      <div className="user-management-table-cell-stack user-management-table-metric">
                        <strong style={{ color: tx.amount < 0 ? '#c03d3d' : '#0f766e' }}>
                          {tx.amount > 0 ? '+' : ''}{tx.amount}
                        </strong>
                        <small>credits</small>
                      </div>
                    </td>
                    <td>
                      <div className="user-management-table-cell-stack user-management-table-metric">
                        <strong>{tx.balanceAfter.toLocaleString()}</strong>
                        <small>credits</small>
                      </div>
                    </td>
                    <td><p>{tx.description}</p></td>
                  </tr>
                ))}
                {transactions.length === 0 && (
                  <tr><td colSpan={5} className="empty">暂无交易记录</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Usage */}
      {activeTab === 'usage' && (
        <section className="sub-panel user-management-list-panel">
          <div className="user-management-list-head">
            <div>
              <p className="section-tag">使用明细</p>
              <p className="panel-caption">共 {usageLogs.length} 条记录</p>
            </div>
          </div>
          <div className="table-wrap user-management-table-wrap">
            <table className="user-management-table">
              <thead>
                <tr>
                  <th><span className="runtime-th-label">时间</span></th>
                  <th><span className="runtime-th-label">模型</span></th>
                  <th><span className="runtime-th-label">Prompt</span></th>
                  <th><span className="runtime-th-label">Completion</span></th>
                  <th><span className="runtime-th-label">总计</span></th>
                  <th><span className="runtime-th-label">积分</span></th>
                </tr>
              </thead>
              <tbody>
                {usageLogs.map((log) => (
                  <tr key={log.id}>
                    <td>
                      <div className="user-management-table-cell-stack">
                        <strong>{formatDateTime(log.createdAt)}</strong>
                      </div>
                    </td>
                    <td><strong>{log.model}</strong></td>
                    <td>
                      <div className="user-management-table-cell-stack user-management-table-metric">
                        <strong>{log.promptTokens.toLocaleString()}</strong>
                        <small>tokens</small>
                      </div>
                    </td>
                    <td>
                      <div className="user-management-table-cell-stack user-management-table-metric">
                        <strong>{log.completionTokens.toLocaleString()}</strong>
                        <small>tokens</small>
                      </div>
                    </td>
                    <td>
                      <div className="user-management-table-cell-stack user-management-table-metric">
                        <strong>{log.totalTokens.toLocaleString()}</strong>
                        <small>tokens</small>
                      </div>
                    </td>
                    <td>
                      <div className="user-management-table-cell-stack user-management-table-metric">
                        <strong style={{ color: '#c03d3d' }}>-{log.creditsConsumed.toLocaleString()}</strong>
                        <small>credits</small>
                      </div>
                    </td>
                  </tr>
                ))}
                {usageLogs.length === 0 && (
                  <tr><td colSpan={6} className="empty">暂无使用记录</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Adjust */}
      {activeTab === 'adjust' && (
        <section className="sub-panel user-management-list-panel">
          <div className="user-management-list-head">
            <div>
              <p className="section-tag">积分调整</p>
              <p className="panel-caption">手动调整用户积分余额</p>
            </div>
          </div>

          <div style={{ padding: '16px 24px' }}>
            <div className="user-management-filter-grid">
              <label>
                <span>调整金额</span>
                <input
                  type="number"
                  placeholder="正数增加，负数减少"
                  value={adjustAmount}
                  onChange={(e) => setAdjustAmount(e.target.value)}
                />
              </label>
              <label style={{ gridColumn: 'span 2' }}>
                <span>调整原因</span>
                <input
                  type="text"
                  placeholder="请输入调整原因"
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                />
              </label>
            </div>
            <div className="user-management-filter-actions" style={{ marginTop: '16px' }}>
              <button
                type="button"
                className="secondary-btn"
                onClick={handleAdjust}
                disabled={adjustLoading || !adjustAmount}
              >
                {adjustLoading ? '调整中...' : '确认调整'}
              </button>
            </div>
          </div>
        </section>
      )}
    </>
  );
}
