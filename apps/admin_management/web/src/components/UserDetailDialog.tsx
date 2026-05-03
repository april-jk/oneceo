import { useState, useEffect, useCallback } from 'react';
import { getBillingErrorMessage, readBillingResponseError, type BillingNotify } from './billing-feedback';
import { AdminDetailShell, AdminTabs, StatusBadge } from './admin-ui';

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
  onAdjusted?: (result: { amount: number; balanceAfter: number }) => void;
  onNotify?: BillingNotify;
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

export function UserDetailDialog({ user, open, onOpenChange, onAdjusted, onNotify }: UserDetailDialogProps) {
  const [activeTab, setActiveTab] = useState('overview');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [usageLogs, setUsageLogs] = useState<UsageLog[]>([]);
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [adjustLoading, setAdjustLoading] = useState(false);
  const [adjustMessage, setAdjustMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
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
      } else {
        onNotify?.('error', '加载失败', await readBillingResponseError(response, '无法获取积分历史'));
      }
    } catch (error) {
      console.error('获取交易记录失败:', error);
      onNotify?.('error', '加载失败', getBillingErrorMessage(error, '无法获取积分历史'));
    }
  }, [onNotify, user, txPage]);

  const fetchUsageLogs = useCallback(async () => {
    if (!user) return;
    try {
      const response = await fetch(`/api/internal/billing/usage-logs?userId=${user.userId}&limit=50`, {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        setUsageLogs(data.items || []);
      } else {
        onNotify?.('error', '加载失败', await readBillingResponseError(response, '无法获取使用明细'));
      }
    } catch (error) {
      console.error('获取使用明细失败:', error);
      onNotify?.('error', '加载失败', getBillingErrorMessage(error, '无法获取使用明细'));
    }
  }, [onNotify, user]);

  useEffect(() => {
    if (user && open) {
      fetchTransactions();
      fetchUsageLogs();
    }
  }, [user, open, fetchTransactions, fetchUsageLogs]);

  const handleAdjust = async () => {
    if (!user || !adjustAmount) return;
    const amount = Number(adjustAmount);
    if (!Number.isInteger(amount) || amount <= 0) {
      setAdjustMessage({ tone: 'error', text: '调整金额必须是大于 0 的整数' });
      onNotify?.('error', '调整失败', '调整金额必须是大于 0 的整数');
      return;
    }
    setAdjustLoading(true);
    setAdjustMessage(null);
    try {
      const response = await fetch(`/api/internal/billing/users/${user.userId}/adjust`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          amount,
          reason: adjustReason || '人工调整',
        }),
      });
      const data = await response.json().catch(() => null);
      if (response.ok) {
        setAdjustAmount('');
        setAdjustReason('');
        setAdjustMessage({ tone: 'success', text: `已增加 ${amount.toLocaleString()} credits` });
        onNotify?.('success', '积分已调整', `已为 ${user.displayName || user.email} 增加 ${amount.toLocaleString()} credits`);
        onAdjusted?.({ amount, balanceAfter: Number(data?.balanceAfter ?? user.balance + amount) });
        fetchTransactions();
      } else {
        const message = data?.error || data?.message || '调整积分失败';
        setAdjustMessage({ tone: 'error', text: message });
        onNotify?.('error', '调整失败', message);
      }
    } catch (error) {
      console.error('调整积分失败:', error);
      const message = getBillingErrorMessage(error, '调整积分失败，请稍后重试');
      setAdjustMessage({ tone: 'error', text: message });
      onNotify?.('error', '调整失败', message);
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
  const parsedAdjustAmount = Number(adjustAmount);
  const canSubmitAdjust = Number.isInteger(parsedAdjustAmount) && parsedAdjustAmount > 0;

  return (
    <AdminDetailShell
      open={open}
      onClose={() => onOpenChange(false)}
      eyebrow="用户计费详情"
      title={user.displayName || user.email || user.userId}
      subtitle={user.email || user.userId}
      size="xl"
      tabs={<AdminTabs value={activeTab} items={tabs} onChange={setActiveTab} ariaLabel="用户计费详情分页" />}
    >
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
                        <StatusBadge tone={tx.type === 'consume' ? 'danger' : tx.type === 'recharge' ? 'success' : 'warning'}>
                          {tx.type === 'consume' ? '消费' : tx.type === 'recharge' ? '充值' : '调整'}
                        </StatusBadge>
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
                      <StatusBadge tone={tx.type === 'consume' ? 'danger' : tx.type === 'recharge' ? 'success' : 'warning'}>
                        {tx.type === 'consume' ? '消费' : tx.type === 'recharge' ? '充值' : '调整'}
                      </StatusBadge>
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
                  placeholder="输入正整数增加积分"
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
                disabled={adjustLoading || !canSubmitAdjust}
              >
                {adjustLoading ? '调整中...' : '确认调整'}
              </button>
            </div>
            {adjustMessage && (
              <p
                className="panel-caption"
                style={{
                  marginTop: '10px',
                  color: adjustMessage.tone === 'error' ? '#c03d3d' : '#0f766e',
                }}
              >
                {adjustMessage.text}
              </p>
            )}
          </div>
        </section>
      )}
    </AdminDetailShell>
  );
}
