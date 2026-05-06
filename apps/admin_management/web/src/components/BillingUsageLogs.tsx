import { useState, useEffect } from 'react';
import { getBillingErrorMessage, readBillingResponseError, type BillingNotify } from './billing-feedback';
import { AdminButton, AdminDetailShell, IdToken } from './admin-ui';

interface UsageLog {
  id: string;
  userId: string;
  sessionId: string | null;
  runId: string | null;
  model: string;
  promptTokens: number;
  cachedPromptTokens: number;
  nonCachedPromptTokens: number;
  cacheCreationTokens: number;
  completionTokens: number;
  totalTokens: number;
  creditsConsumed: number;
  createdAt: string;
}

interface BillingUsageLogsProps {
  onOpenUser?: (userId: string) => void;
  onOpenConversation?: (sessionId: string) => void;
  onNotify?: BillingNotify;
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

export function BillingUsageLogs({ onOpenUser, onOpenConversation, onNotify }: BillingUsageLogsProps) {
  const [logs, setLogs] = useState<UsageLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [limit] = useState(50);
  const [selectedLog, setSelectedLog] = useState<UsageLog | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // Filters
  const [userId, setUserId] = useState('');
  const [model, setModel] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', page.toString());
      params.set('limit', limit.toString());
      if (userId) params.set('userId', userId);
      if (model) params.set('model', model);
      if (sessionId) params.set('sessionId', sessionId);
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);

      const response = await fetch(`/api/internal/billing/usage-logs?${params}`, {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        setLogs(data.items || []);
        setTotal(data.total || 0);
      } else {
        onNotify?.('error', '加载失败', await readBillingResponseError(response, '无法获取使用明细'));
      }
    } catch (error) {
      console.error('获取使用明细失败:', error);
      onNotify?.('error', '加载失败', getBillingErrorMessage(error, '无法获取使用明细'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchLogs();
  }, [page]);

  const handleSearch = () => {
    setPage(1);
    void fetchLogs();
  };

  const handleReset = () => {
    setUserId('');
    setModel('');
    setSessionId('');
    setStartDate('');
    setEndDate('');
    setPage(1);
    void fetchLogs();
  };

  const handleOpenDetail = (log: UsageLog) => {
    setSelectedLog(log);
    setDetailOpen(true);
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <>
      {/* Filters */}
      <section className="sub-panel user-management-filter-panel">
        <div className="user-management-filter-head">
          <div>
            <p className="section-tag">筛选条件</p>
          </div>
          <span className="panel-caption">共 {total.toLocaleString()} 条记录</span>
        </div>
        <div className="user-management-filter-grid">
          <label>
            <span>用户ID</span>
            <input
              type="text"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="用户ID"
            />
          </label>
          <label>
            <span>模型</span>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="模型名称"
            />
          </label>
          <label>
            <span>会话ID</span>
            <input
              type="text"
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              placeholder="会话ID"
            />
          </label>
          <label>
            <span>开始日期</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </label>
          <label>
            <span>结束日期</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </label>
          <div className="user-management-filter-actions">
            <AdminButton variant="secondary" onClick={handleSearch}>
              查询
            </AdminButton>
            <AdminButton variant="secondary" onClick={handleReset}>
              重置
            </AdminButton>
          </div>
        </div>
      </section>

      {/* Table */}
      <section className="sub-panel user-management-list-panel">
        <div className="user-management-list-head">
          <div>
            <p className="section-tag">使用明细</p>
            <p className="panel-caption">第 {page} / {totalPages || 1} 页</p>
          </div>
        </div>

        <div className="table-wrap user-management-table-wrap" aria-live="polite">
          <table className="user-management-table">
            <colgroup>
              <col style={{ width: '14%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '10%' }} />
            </colgroup>
            <thead>
              <tr>
                <th><span className="runtime-th-label">时间</span></th>
                <th><span className="runtime-th-label">用户ID</span></th>
                <th><span className="runtime-th-label">模型</span></th>
                <th><span className="runtime-th-label">Prompt</span></th>
                <th><span className="runtime-th-label">缓存命中</span></th>
                <th><span className="runtime-th-label">非缓存</span></th>
                <th><span className="runtime-th-label">缓存创建</span></th>
                <th><span className="runtime-th-label">Completion</span></th>
                <th><span className="runtime-th-label">积分</span></th>
                <th className="runtime-col-actions"><span className="runtime-th-label">操作</span></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} className="empty">正在加载使用明细...</td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan={10} className="empty">暂无数据</td></tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} onClick={() => handleOpenDetail(log)} style={{ cursor: 'pointer' }}>
                    <td>
                      <div className="user-management-table-cell-stack">
                        <strong>{new Date(log.createdAt).toLocaleDateString('zh-CN')}</strong>
                        <small>{new Date(log.createdAt).toLocaleTimeString('zh-CN')}</small>
                      </div>
                    </td>
                    <td>
                      {onOpenUser ? (
                        <button
                          type="button"
                          className="management-title-link mono"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenUser(log.userId);
                          }}
                          title={log.userId}
                        >
                          {log.userId.slice(0, 8)}...
                        </button>
                      ) : (
                        <IdToken value={log.userId} head={8} tail={4} />
                      )}
                    </td>
                    <td><strong>{log.model.split('/').pop() || log.model}</strong></td>
                    <td>
                      <div className="user-management-table-cell-stack user-management-table-metric">
                        <strong>{log.promptTokens.toLocaleString()}</strong>
                      </div>
                    </td>
                    <td>
                      {log.cachedPromptTokens > 0 ? (
                        <div className="user-management-table-cell-stack user-management-table-metric">
                          <strong style={{ color: 'var(--success)' }}>{log.cachedPromptTokens.toLocaleString()}</strong>
                        </div>
                      ) : (
                        <span className="dim">-</span>
                      )}
                    </td>
                    <td>
                      <div className="user-management-table-cell-stack user-management-table-metric">
                        <strong>{log.nonCachedPromptTokens.toLocaleString()}</strong>
                      </div>
                    </td>
                    <td>
                      {log.cacheCreationTokens > 0 ? (
                        <div className="user-management-table-cell-stack user-management-table-metric">
                          <strong style={{ color: 'var(--warning)' }}>{log.cacheCreationTokens.toLocaleString()}</strong>
                        </div>
                      ) : (
                        <span className="dim">-</span>
                      )}
                    </td>
                    <td>
                      <div className="user-management-table-cell-stack user-management-table-metric">
                        <strong>{log.completionTokens.toLocaleString()}</strong>
                      </div>
                    </td>
                    <td>
                      <div className="user-management-table-cell-stack user-management-table-metric">
                        <strong style={{ color: 'var(--success)' }}>{log.creditsConsumed.toLocaleString()}</strong>
                        <small>credits</small>
                      </div>
                    </td>
                    <td>
                      <div className="user-management-table-actions">
                        <button
                          type="button"
                          className="table-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenDetail(log);
                          }}
                        >
                          详情
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="admin-mobile-card-list" aria-label="使用明细移动列表">
          {loading ? <p className="empty">正在加载使用明细...</p> : logs.length === 0 ? <p className="empty">暂无数据</p> : logs.map((log) => (
            <article key={log.id} className="admin-mobile-card" onClick={() => handleOpenDetail(log)}>
              <div className="admin-mobile-card-head"><strong>{log.model.split('/').pop() || log.model}</strong><span>{formatDateTime(log.createdAt)}</span></div>
              <div className="admin-mobile-card-meta"><span>{log.totalTokens.toLocaleString()} tokens</span><span>{log.creditsConsumed.toLocaleString()} credits</span></div>
              <IdToken label="用户" value={log.userId} head={8} tail={4} />
            </article>
          ))}
        </div>

        {/* Pagination */}
        {total > 0 && (
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px 16px',
            borderTop: '1px solid var(--border)',
          }}>
            <span className="panel-caption">
              共 {total.toLocaleString()} 条记录，第 {page} / {totalPages} 页
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <AdminButton
                type="button"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                上一页
              </AdminButton>
              <AdminButton
                type="button"
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
              >
                下一页
              </AdminButton>
            </div>
          </div>
        )}
      </section>

      {/* Detail Modal */}
      {detailOpen && selectedLog && (
        <AdminDetailShell open={detailOpen} onClose={() => setDetailOpen(false)} eyebrow="使用详情" title={selectedLog.model} subtitle={formatDateTime(selectedLog.createdAt)} size="lg" footer={<AdminButton variant="secondary" onClick={() => setDetailOpen(false)}>关闭</AdminButton>} contentClassName="user-management-modal-body">
              <div className="user-management-detail-grid">
                <article className="sub-panel user-management-detail-card">
                  <div className="user-management-list-head">
                    <div>
                      <p className="section-tag">Token 使用详情</p>
                    </div>
                  </div>
                  <div style={{ padding: '16px 24px' }}>
                    <dl className="user-management-record-grid">
                      <div>
                        <dt>Prompt Tokens</dt>
                        <dd>{selectedLog.promptTokens.toLocaleString()}</dd>
                      </div>
                      <div>
                        <dt>缓存命中</dt>
                        <dd style={{ color: 'var(--success)' }}>{selectedLog.cachedPromptTokens.toLocaleString()}</dd>
                      </div>
                      <div>
                        <dt>非缓存</dt>
                        <dd>{selectedLog.nonCachedPromptTokens.toLocaleString()}</dd>
                      </div>
                      <div>
                        <dt>缓存创建</dt>
                        <dd style={{ color: 'var(--warning)' }}>{selectedLog.cacheCreationTokens.toLocaleString()}</dd>
                      </div>
                      <div>
                        <dt>Completion</dt>
                        <dd>{selectedLog.completionTokens.toLocaleString()}</dd>
                      </div>
                      <div>
                        <dt>总计</dt>
                        <dd><strong>{selectedLog.totalTokens.toLocaleString()} tokens</strong></dd>
                      </div>
                    </dl>
                  </div>
                </article>

                <article className="sub-panel user-management-detail-card">
                  <div className="user-management-list-head">
                    <div>
                      <p className="section-tag">计费信息</p>
                    </div>
                  </div>
                  <div style={{ padding: '16px 24px' }}>
                    <dl className="user-management-record-grid">
                      <div>
                        <dt>积分消耗</dt>
                        <dd><strong style={{ color: 'var(--danger)' }}>{selectedLog.creditsConsumed.toLocaleString()} credits</strong></dd>
                      </div>
                      <div>
                        <dt>用户ID</dt>
                        <dd>
                          {onOpenUser ? (
                            <button
                              type="button"
                              className="management-title-link mono"
                              onClick={() => onOpenUser(selectedLog.userId)}
                            >
                              {selectedLog.userId}
                            </button>
                          ) : (
                            <span className="mono">{selectedLog.userId}</span>
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>会话ID</dt>
                        <dd>
                          {selectedLog.sessionId && onOpenConversation ? (
                            <button
                              type="button"
                              className="management-title-link mono"
                              onClick={() => onOpenConversation(selectedLog.sessionId!)}
                            >
                              {selectedLog.sessionId}
                            </button>
                          ) : (
                            <span className="mono">{selectedLog.sessionId || '-'}</span>
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>运行ID</dt>
                        <dd><span className="mono">{selectedLog.runId || '-'}</span></dd>
                      </div>
                    </dl>
                  </div>
                </article>
              </div>
        </AdminDetailShell>
      )}
    </>
  );
}
