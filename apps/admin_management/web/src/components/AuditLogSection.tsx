import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type {
  ApiRequestLogEntry,
  ApiTraceItem,
  AppUserListItem,
  AuditToolCall,
  AuditTransaction,
  AuditTokenUsageItem,
  AuditUserSession,
} from '../types';

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  try {
    const d = new Date(value);
    return d.toLocaleString('zh-CN', { hour12: false });
  } catch {
    return value;
  }
}

function truncateMiddle(str: string, startLen = 6, endLen = 4) {
  if (str.length <= startLen + endLen + 3) return str;
  return `${str.slice(0, startLen)}...${str.slice(-endLen)}`;
}

function methodClass(method: string) {
  const m = method.toUpperCase();
  if (m === 'GET') return 'status-success';
  if (m === 'POST') return 'status-info';
  if (m === 'PUT') return 'status-warning';
  if (m === 'DELETE') return 'status-error';
  return 'status-neutral';
}

function statusClass(status: number | null) {
  if (!status) return 'status-neutral';
  if (status >= 200 && status < 300) return 'status-success';
  if (status >= 400 && status < 500) return 'status-warning';
  if (status >= 500) return 'status-error';
  return 'status-neutral';
}

function transactionTypeLabel(type: string) {
  if (type === 'recharge') return '充值';
  if (type === 'consume') return '消费';
  if (type === 'adjust') return '人工调整';
  if (type === 'refund') return '退款';
  return type;
}

function transactionTypeClass(type: string) {
  if (type === 'recharge' || type === 'refund' || type === 'adjust') return 'status-success';
  if (type === 'consume') return 'status-error';
  return 'status-neutral';
}

function JsonPanel({ title, data }: { title: string; data: unknown }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="audit-detail-json-panel" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{title}</summary>
      <pre className="json-block">{JSON.stringify(data, null, 2)}</pre>
    </details>
  );
}

/* ---------- 中文友好的 Metadata 展示 ---------- */



type AuditTab = 'requests' | 'sessions' | 'toolCalls' | 'transactions';

export function AuditLogSection({
  onOpenSession,
  onError,
}: {
  onOpenSession: (sessionId: string) => void;
  onError: (message: string) => void;
}) {
  const [users, setUsers] = useState<AppUserListItem[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  // ---- User Index State ----
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [userStatusFilter, setUserStatusFilter] = useState('');
  const [userSortKey, setUserSortKey] = useState('createdAt');
  const [userSortDirection, setUserSortDirection] = useState('desc');
  const [userPage, setUserPage] = useState(1);
  const userPageSize = 20;
  const [userSummary, setUserSummary] = useState<{
    totalUsers: number;
    activeUsers7d: number;
    disabledUsers: number;
    ownershipAlertUsers: number;
  } | null>(null);

  const loadUsers = useCallback(
    async (page = 1) => {
      setUsersLoading(true);
      try {
        const result = await api.listAppUsers({
          limit: 200,
          query: userSearchQuery || undefined,
          status: userStatusFilter || undefined,
          sortKey: userSortKey || undefined,
          sortDirection: userSortDirection || undefined,
        });
        setUsers(result.items || []);
        setUserSummary(result.summary || null);
        setUserPage(page);
      } catch (err) {
        onError(err instanceof Error ? err.message : '加载用户列表失败');
      } finally {
        setUsersLoading(false);
      }
    },
    [userSearchQuery, userStatusFilter, userSortKey, userSortDirection, onError]
  );

  // Debounced search: reload when query changes
  useEffect(() => {
    const timer = setTimeout(() => {
      void loadUsers(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [userSearchQuery, userStatusFilter, userSortKey, userSortDirection, loadUsers]);

  // Client-side pagination
  const totalUserPages = Math.ceil(users.length / userPageSize);
  const paginatedUsers = users.slice((userPage - 1) * userPageSize, userPage * userPageSize);

  const selectedUser = users.find((u) => u.id === selectedUserId);

  // ---- Tab state ----
  const [activeTab, setActiveTab] = useState<AuditTab>('requests');

  // ---- Requests Tab ----
  const [requestLogs, setRequestLogs] = useState<ApiRequestLogEntry[]>([]);
  const [requestLogsMeta, setRequestLogsMeta] = useState({ total: 0, limit: 50, offset: 0 });
  const [reqLoading, setReqLoading] = useState(false);
  const [reqFilters, setReqFilters] = useState({ method: '', path: '', status: '', from: '', to: '' });
  const [detailLog, setDetailLog] = useState<ApiRequestLogEntry | null>(null);

  const loadRequestLogs = useCallback(
    async (userId?: string, offset = 0) => {
      setReqLoading(true);
      try {
        const result = await api.listRequestLogs({
          userId: userId || undefined,
          method: reqFilters.method || undefined,
          path: reqFilters.path || undefined,
          status: reqFilters.status ? Number(reqFilters.status) : undefined,
          from: reqFilters.from || undefined,
          to: reqFilters.to || undefined,
          limit: 50,
          offset,
        });
        if (offset === 0) {
          setRequestLogs(result.entries);
        } else {
          setRequestLogs((prev) => [...prev, ...result.entries]);
        }
        setRequestLogsMeta({ total: result.total, limit: result.limit, offset: result.offset });
      } catch (err) {
        onError(err instanceof Error ? err.message : '加载请求日志失败');
      } finally {
        setReqLoading(false);
      }
    },
    [reqFilters, onError]
  );

  useEffect(() => {
    if (selectedUserId && activeTab === 'requests') {
      void loadRequestLogs(selectedUserId, 0);
    }
  }, [selectedUserId, activeTab, loadRequestLogs]);

  // ---- Sessions Tab ----
  const [sessions, setSessions] = useState<AuditUserSession[]>([]);
  const [sessionsMeta, setSessionsMeta] = useState({ total: 0, page: 1, limit: 20 });
  const [sessLoading, setSessLoading] = useState(false);

  const loadSessions = useCallback(
    async (userId: string, page = 1) => {
      setSessLoading(true);
      try {
        const result = await api.listUserSessions(userId, { page, limit: 20 });
        if (page === 1) {
          setSessions(result.items);
        } else {
          setSessions((prev) => [...prev, ...result.items]);
        }
        setSessionsMeta({ total: result.total, page, limit: result.limit });
      } catch (err) {
        onError(err instanceof Error ? err.message : '加载会话列表失败');
      } finally {
        setSessLoading(false);
      }
    },
    [onError]
  );

  useEffect(() => {
    if (selectedUserId && activeTab === 'sessions') {
      void loadSessions(selectedUserId, 1);
    }
  }, [selectedUserId, activeTab, loadSessions]);

  // ---- Tool Calls Tab ----
  const [toolCalls, setToolCalls] = useState<AuditToolCall[]>([]);
  const [toolCallsMeta, setToolCallsMeta] = useState({ total: 0, page: 1, limit: 20 });
  const [toolLoading, setToolLoading] = useState(false);

  const loadToolCalls = useCallback(
    async (userId: string, page = 1) => {
      setToolLoading(true);
      try {
        const result = await api.listUserToolCalls(userId, { page, limit: 20 });
        if (page === 1) {
          setToolCalls(result.items);
        } else {
          setToolCalls((prev) => [...prev, ...result.items]);
        }
        setToolCallsMeta({ total: result.total, page, limit: result.limit });
      } catch (err) {
        onError(err instanceof Error ? err.message : '加载工具调用失败');
      } finally {
        setToolLoading(false);
      }
    },
    [onError]
  );

  useEffect(() => {
    if (selectedUserId && activeTab === 'toolCalls') {
      void loadToolCalls(selectedUserId, 1);
    }
  }, [selectedUserId, activeTab, loadToolCalls]);

  // ---- Transactions Tab ----
  const [transactions, setTransactions] = useState<AuditTransaction[]>([]);
  const [transactionsMeta, setTransactionsMeta] = useState({ total: 0, page: 1, limit: 20 });
  const [transLoading, setTransLoading] = useState(false);
  const [transTypeFilter, setTransTypeFilter] = useState('');

  const [tokenUsage, setTokenUsage] = useState<AuditTokenUsageItem[]>([]);
  const [tokenUsageMeta, setTokenUsageMeta] = useState({ total: 0 });
  const [tokenLoading, setTokenLoading] = useState(false);

  const loadTransactions = useCallback(
    async (userId: string, page = 1, type?: string) => {
      setTransLoading(true);
      try {
        const result = await api.listUserTransactions(userId, { page, limit: 20, type: type || undefined });
        if (page === 1) {
          setTransactions(result.items);
        } else {
          setTransactions((prev) => [...prev, ...result.items]);
        }
        setTransactionsMeta({ total: result.total, page, limit: result.limit });
      } catch (err) {
        onError(err instanceof Error ? err.message : '加载交易记录失败');
      } finally {
        setTransLoading(false);
      }
    },
    [onError]
  );

  const loadTokenUsage = useCallback(
    async (userId: string, page = 1) => {
      setTokenLoading(true);
      try {
        const result = await api.listUserTokenUsage(userId, { page, limit: 20 });
        if (page === 1) {
          setTokenUsage(result.items);
        } else {
          setTokenUsage((prev) => [...prev, ...result.items]);
        }
        setTokenUsageMeta({ total: result.total });
      } catch (err) {
        onError(err instanceof Error ? err.message : '加载 Token 使用明细失败');
      } finally {
        setTokenLoading(false);
      }
    },
    [onError]
  );

  useEffect(() => {
    if (selectedUserId && activeTab === 'transactions') {
      void loadTransactions(selectedUserId, 1, transTypeFilter);
      void loadTokenUsage(selectedUserId, 1);
    }
  }, [selectedUserId, activeTab, transTypeFilter, loadTransactions, loadTokenUsage]);

  // ---- Render ----
  if (!selectedUserId) {
    return (
      <main className="content-stack viewport-lock-page audit-page">
        <section className="panel fade-in">
          <div className="panel-header">
            <h2>用户审计索引</h2>
            <span className="panel-caption">选择用户查看其 API 请求日志、会话详情、工具调用和交易记录</span>
          </div>

          {/* 统计摘要 */}
          {userSummary && (
            <div className="audit-user-summary">
              <div className="audit-user-summary-item">
                <span className="audit-user-summary-value">{userSummary.totalUsers}</span>
                <span className="audit-user-summary-label">总用户数</span>
              </div>
              <div className="audit-user-summary-item">
                <span className="audit-user-summary-value" style={{ color: 'var(--success)' }}>
                  {userSummary.totalUsers - userSummary.disabledUsers}
                </span>
                <span className="audit-user-summary-label">正常</span>
              </div>
              <div className="audit-user-summary-item">
                <span className="audit-user-summary-value" style={{ color: 'var(--danger)' }}>
                  {userSummary.disabledUsers}
                </span>
                <span className="audit-user-summary-label">已禁用</span>
              </div>
              <div className="audit-user-summary-item">
                <span className="audit-user-summary-value" style={{ color: 'var(--info)' }}>
                  {userSummary.activeUsers7d}
                </span>
                <span className="audit-user-summary-label">7日活跃</span>
              </div>
            </div>
          )}

          {/* 筛选栏 */}
          <div className="audit-filter-grid audit-filter-grid-compact" style={{ marginTop: 12 }}>
            <label className="audit-filter-field">
              <span>搜索</span>
              <input
                type="text"
                className="control-input"
                placeholder="搜索用户邮箱、名称或 ID..."
                value={userSearchQuery}
                onChange={(e) => setUserSearchQuery(e.target.value)}
              />
            </label>
            <label className="audit-filter-field">
              <span>状态</span>
              <select
                className="control-input"
                value={userStatusFilter}
                onChange={(e) => setUserStatusFilter(e.target.value)}
              >
                <option value="">全部</option>
                <option value="active">正常</option>
                <option value="disabled">已禁用</option>
              </select>
            </label>
            <label className="audit-filter-field">
              <span>排序</span>
              <select
                className="control-input"
                value={`${userSortKey}:${userSortDirection}`}
                onChange={(e) => {
                  const [key, dir] = e.target.value.split(':');
                  setUserSortKey(key);
                  setUserSortDirection(dir);
                }}
              >
                <option value="createdAt:desc">注册时间（新→旧）</option>
                <option value="createdAt:asc">注册时间（旧→新）</option>
                <option value="displayName:asc">用户名称</option>
                <option value="lastActivityAt:desc">最近活动</option>
              </select>
            </label>
          </div>

          {/* 用户表格 */}
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="audit-table">
              <thead>
                <tr>
                  <th>用户</th>
                  <th>状态</th>
                  <th>注册时间</th>
                  <th>最近活动</th>
                  <th>会话数</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {usersLoading ? (
                  <tr>
                    <td colSpan={6} className="empty">加载中...</td>
                  </tr>
                ) : paginatedUsers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="empty">
                      {userSearchQuery || userStatusFilter ? '无匹配用户' : '暂无用户数据'}
                    </td>
                  </tr>
                ) : (
                  paginatedUsers.map((user) => (
                    <tr key={user.id}>
                      <td>
                        <strong>{user.displayName}</strong>
                        <br />
                        <span className="cell-subtle" style={{ fontSize: 12 }}>{user.email}</span>
                      </td>
                      <td>
                        <span className={`status-pill ${user.status === 'active' ? 'status-success' : 'status-neutral'}`}>
                          {user.status === 'active' ? '正常' : '已禁用'}
                        </span>
                      </td>
                      <td>{formatDateTime(user.createdAt)}</td>
                      <td>{formatDateTime(user.lastActivityAt)}</td>
                      <td>{user.sessionCount ?? 0}</td>
                      <td>
                        <button
                          type="button"
                          className="table-btn"
                          onClick={() => setSelectedUserId(user.id)}
                        >
                          查看审计日志
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* 分页 */}
          {users.length > userPageSize && (
            <div className="audit-pagination">
              <button
                type="button"
                className="audit-pagination-btn"
                disabled={userPage <= 1}
                onClick={() => setUserPage((p) => Math.max(1, p - 1))}
              >
                上一页
              </button>
              <span className="audit-pagination-info">
                第 {userPage} 页，共 {totalUserPages} 页（{users.length} 条）
              </span>
              <button
                type="button"
                className="audit-pagination-btn"
                disabled={userPage >= totalUserPages}
                onClick={() => setUserPage((p) => Math.min(totalUserPages, p + 1))}
              >
                下一页
              </button>
            </div>
          )}
        </section>
      </main>
    );
  }

  const TABS: Array<{ key: AuditTab; label: string }> = [
    { key: 'requests', label: 'HTTP 请求日志' },
    { key: 'sessions', label: '会话列表' },
    { key: 'toolCalls', label: '工具调用' },
    { key: 'transactions', label: '交易记录' },
  ];

  return (
    <main className="content-stack viewport-lock-page audit-page">
      {/* 返回 + 标题 */}
      <section className="fade-in">
        <article className="panel hero-panel">
          <div className="panel-header audit-hero-header">
            <div>
              <p className="section-tag">用户审计</p>
              <h2>
                {selectedUser?.displayName || selectedUserId}
                <span className="panel-caption" style={{ marginLeft: 12 }}>
                  {selectedUser?.email}
                </span>
              </h2>
            </div>
            <div className="sandbox-list-header-actions audit-hero-actions">
              <button type="button" className="secondary-btn" onClick={() => setSelectedUserId(null)}>
                ← 返回用户列表
              </button>
            </div>
          </div>
        </article>
      </section>

      {/* Tab 导航 */}
      <section className="panel fade-in audit-tab-bar">
        <div className="audit-tabs">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`audit-tab ${activeTab === tab.key ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>

      {/* === HTTP 请求日志 Tab === */}
      {activeTab === 'requests' && (
        <>
          <section className="panel fade-in audit-filter-panel">
            <div className="audit-filter-grid audit-filter-grid-compact">
              <label className="audit-filter-field">
                <span>方法</span>
                <select
                  className="control-input"
                  value={reqFilters.method}
                  onChange={(e) => setReqFilters((f) => ({ ...f, method: e.target.value }))}
                >
                  <option value="">全部</option>
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                  <option value="DELETE">DELETE</option>
                </select>
              </label>
              <label className="audit-filter-field">
                <span>路径</span>
                <input
                  className="control-input"
                  placeholder="关键词"
                  value={reqFilters.path}
                  onChange={(e) => setReqFilters((f) => ({ ...f, path: e.target.value }))}
                />
              </label>
              <label className="audit-filter-field">
                <span>状态码</span>
                <input
                  className="control-input"
                  placeholder="如 200, 404"
                  value={reqFilters.status}
                  onChange={(e) => setReqFilters((f) => ({ ...f, status: e.target.value }))}
                />
              </label>
              <label className="audit-filter-field">
                <span>开始时间</span>
                <input
                  className="control-input"
                  type="datetime-local"
                  value={reqFilters.from}
                  onChange={(e) => setReqFilters((f) => ({ ...f, from: e.target.value }))}
                />
              </label>
              <label className="audit-filter-field">
                <span>结束时间</span>
                <input
                  className="control-input"
                  type="datetime-local"
                  value={reqFilters.to}
                  onChange={(e) => setReqFilters((f) => ({ ...f, to: e.target.value }))}
                />
              </label>
              <div className="audit-filter-actions">
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => setReqFilters({ method: '', path: '', status: '', from: '', to: '' })}
                >
                  重置筛选
                </button>
              </div>
            </div>
          </section>

          <section className="panel fade-in audit-log-panel">
            <div className="panel-header">
              <h2>HTTP 请求日志</h2>
              <span className="panel-caption">
                共 {requestLogsMeta.total} 条，当前显示 {requestLogs.length} 条
              </span>
            </div>
            <div className="table-wrap">
              <table className="audit-table">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>方法</th>
                    <th>路径</th>
                    <th>状态</th>
                    <th>耗时</th>
                    <th>会话</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {requestLogs.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="empty">
                        {reqLoading ? '加载中...' : '暂无请求日志'}
                      </td>
                    </tr>
                  ) : (
                    requestLogs.map((entry) => (
                      <tr key={entry.id}>
                        <td>{formatDateTime(entry.createdAt)}</td>
                        <td>
                          <span className={`status-pill ${methodClass(entry.method)}`}>{entry.method}</span>
                        </td>
                        <td className="mono" title={entry.path}>
                          {entry.path.length > 40 ? entry.path.slice(0, 40) + '...' : entry.path}
                        </td>
                        <td>
                          {entry.responseStatus ? (
                            <span className={`status-pill ${statusClass(entry.responseStatus)}`}>
                              {entry.responseStatus}
                            </span>
                          ) : (
                            '-'
                          )}
                        </td>
                        <td>{entry.durationMs ? `${entry.durationMs}ms` : '-'}</td>
                        <td>
                          {entry.taskSessionId ? (
                            <button
                              type="button"
                              className="link-btn sandbox-jump-btn mono audit-id-link"
                              onClick={() => onOpenSession(entry.taskSessionId!)}
                            >
                              {truncateMiddle(entry.taskSessionId, 8, 6)}
                            </button>
                          ) : (
                            '-'
                          )}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="table-btn"
                            onClick={async () => {
                              try {
                                const log = await api.getRequestLogDetail(entry.id);
                                setDetailLog(log);
                              } catch (err) {
                                onError(err instanceof Error ? err.message : '加载详情失败');
                              }
                            }}
                          >
                            查看详情
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {requestLogs.length < requestLogsMeta.total && (
              <div style={{ padding: 12, textAlign: 'center' }}>
                <button
                  type="button"
                  className="secondary-btn"
                  disabled={reqLoading}
                  onClick={() => loadRequestLogs(selectedUserId, requestLogs.length)}
                >
                  {reqLoading ? '加载中...' : '加载更多'}
                </button>
              </div>
            )}
          </section>
        </>
      )}

      {/* === 会话列表 Tab === */}
      {activeTab === 'sessions' && (
        <section className="panel fade-in audit-log-panel">
          <div className="panel-header">
            <h2>会话列表</h2>
            <span className="panel-caption">
              共 {sessionsMeta.total} 条，当前显示 {sessions.length} 条
            </span>
          </div>
          <div className="table-wrap">
            <table className="audit-table">
              <thead>
                <tr>
                  <th>会话标题</th>
                  <th>状态</th>
                  <th>Trace 统计</th>
                  <th>创建时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {sessions.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="empty">
                      {sessLoading ? '加载中...' : '暂无会话数据'}
                    </td>
                  </tr>
                ) : (
                  sessions.map((session) => (
                    <tr key={session.id}>
                      <td>
                        <strong>{session.title}</strong>
                        <br />
                        <span className="mono cell-subtle">{truncateMiddle(session.id, 8, 6)}</span>
                      </td>
                      <td>
                        <span className={`status-pill status-${session.status}`}>{session.status}</span>
                      </td>
                      <td>
                        <span className="audit-trace-stats">
                          总 {session.traceSummary.totalTraces} · 工具 {session.traceSummary.toolCalls} · LLM{' '}
                          {session.traceSummary.llmRequests} · 错误 {session.traceSummary.errors}
                        </span>
                      </td>
                      <td>{formatDateTime(session.createdAt)}</td>
                      <td>
                        <button
                          type="button"
                          className="table-btn"
                          onClick={() => onOpenSession(session.id)}
                        >
                          打开会话
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {sessions.length < sessionsMeta.total && (
            <div style={{ padding: 12, textAlign: 'center' }}>
              <button
                type="button"
                className="secondary-btn"
                disabled={sessLoading}
                onClick={() => loadSessions(selectedUserId, sessionsMeta.page + 1)}
              >
                {sessLoading ? '加载中...' : '加载更多'}
              </button>
            </div>
          )}
        </section>
      )}

      {/* === 工具调用 Tab === */}
      {activeTab === 'toolCalls' && (
        <section className="panel fade-in audit-log-panel">
          <div className="panel-header">
            <h2>工具调用</h2>
            <span className="panel-caption">
              共 {toolCallsMeta.total} 条，当前显示 {toolCalls.length} 条
            </span>
          </div>
          <div className="table-wrap">
            <table className="audit-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>工具名</th>
                  <th>会话</th>
                  <th>状态</th>
                  <th>耗时</th>
                  <th>Tokens</th>
                  <th>错误</th>
                </tr>
              </thead>
              <tbody>
                {toolCalls.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="empty">
                      {toolLoading ? '加载中...' : '暂无工具调用记录'}
                    </td>
                  </tr>
                ) : (
                  toolCalls.map((tc) => (
                    <tr key={tc.id}>
                      <td>{formatDateTime(tc.createdAt)}</td>
                        <td>
                        <strong className="mono">{tc.toolName || tc.serviceName || '-'}</strong>
                        {tc.endpoint && (
                          <>
                            <br />
                            <span className="cell-subtle mono" style={{ fontSize: 11 }}>
                              {tc.endpoint}
                            </span>
                          </>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="link-btn sandbox-jump-btn mono audit-id-link"
                          onClick={() => onOpenSession(tc.sessionId)}
                        >
                          {truncateMiddle(tc.sessionId, 8, 6)}
                        </button>
                      </td>
                      <td>
                        {tc.responseStatus ? (
                          <span className={`status-pill ${statusClass(tc.responseStatus)}`}>
                            {tc.responseStatus}
                          </span>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td>{tc.durationMs ? `${tc.durationMs}ms` : '-'}</td>
                      <td>
                        {tc.totalTokens > 0 ? (
                          <span className="audit-token-badge">
                            {tc.promptTokens}+{tc.completionTokens}={tc.totalTokens}
                          </span>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td>
                        {tc.errorMessage ? (
                          <span className="status-pill status-error" title={tc.errorMessage}>
                            失败
                          </span>
                        ) : (
                          <span className="status-pill status-success">成功</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {toolCalls.length < toolCallsMeta.total && (
            <div style={{ padding: 12, textAlign: 'center' }}>
              <button
                type="button"
                className="secondary-btn"
                disabled={toolLoading}
                onClick={() => loadToolCalls(selectedUserId, toolCallsMeta.page + 1)}
              >
                {toolLoading ? '加载中...' : '加载更多'}
              </button>
            </div>
          )}
        </section>
      )}

      {/* === 交易记录 Tab === */}
      {activeTab === 'transactions' && (
        <>
          {/* 交易记录筛选 */}
          <section className="panel fade-in audit-filter-panel">
            <div className="audit-filter-grid audit-filter-grid-compact">
              <label className="audit-filter-field">
                <span>交易类型</span>
                <select
                  className="control-input"
                  value={transTypeFilter}
                  onChange={(e) => setTransTypeFilter(e.target.value)}
                >
                  <option value="">全部</option>
                  <option value="recharge">充值</option>
                  <option value="consume">消费</option>
                  <option value="adjust">人工调整</option>
                  <option value="refund">退款</option>
                </select>
              </label>
              <div className="audit-filter-actions">
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => setTransTypeFilter('')}
                >
                  重置筛选
                </button>
              </div>
            </div>
          </section>

          {/* 交易记录列表 */}
          <section className="panel fade-in audit-log-panel">
            <div className="panel-header">
              <h2>积分交易记录</h2>
              <span className="panel-caption">
                共 {transactionsMeta.total} 条，当前显示 {transactions.length} 条
              </span>
            </div>
            <div className="table-wrap">
              <table className="audit-table">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>类型</th>
                    <th>金额</th>
                    <th>余额变动</th>
                    <th>说明</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="empty">
                        {transLoading ? '加载中...' : '暂无交易记录'}
                      </td>
                    </tr>
                  ) : (
                    transactions.map((tx) => (
                      <tr key={tx.id}>
                        <td>{formatDateTime(tx.createdAt)}</td>
                        <td>
                          <span className={`status-pill ${transactionTypeClass(tx.type)}`}>
                            {transactionTypeLabel(tx.type)}
                          </span>
                        </td>
                        <td>
                          <strong
                            style={{
                              color:
                                tx.type === 'consume'
                                  ? 'var(--danger)'
                                  : tx.type === 'recharge' || tx.type === 'refund' || tx.type === 'adjust'
                                    ? 'var(--success)'
                                    : 'inherit',
                            }}
                          >
                            {tx.type === 'consume' ? '-' : '+'}
                            {tx.amount}
                          </strong>
                        </td>
                        <td>
                          <span className="cell-subtle">
                            {tx.balanceBefore} → {tx.balanceAfter}
                          </span>
                        </td>
                        <td>{tx.description || '-'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {transactions.length < transactionsMeta.total && (
              <div style={{ padding: 12, textAlign: 'center' }}>
                <button
                  type="button"
                  className="secondary-btn"
                  disabled={transLoading}
                  onClick={() => loadTransactions(selectedUserId, transactionsMeta.page + 1, transTypeFilter)}
                >
                  {transLoading ? '加载中...' : '加载更多'}
                </button>
              </div>
            )}
          </section>

          {/* Token 使用明细 */}
          <section className="panel fade-in audit-log-panel">
            <div className="panel-header">
              <h2>Token 使用明细（按会话）</h2>
              <span className="panel-caption">
                共 {tokenUsageMeta.total} 条，当前显示 {tokenUsage.length} 条
              </span>
            </div>
            <div className="table-wrap">
              <table className="audit-table">
                <thead>
                  <tr>
                    <th>会话</th>
                    <th>调用次数</th>
                    <th>消耗积分</th>
                    <th>首次使用</th>
                    <th>最后使用</th>
                  </tr>
                </thead>
                <tbody>
                  {tokenUsage.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="empty">
                        {tokenLoading ? '加载中...' : '暂无 Token 使用记录'}
                      </td>
                    </tr>
                  ) : (
                    tokenUsage.map((tu) => (
                      <tr key={tu.id}>
                        <td>
                          <strong>{tu.sessionTitle}</strong>
                          <br />
                          <span className="mono cell-subtle" style={{ fontSize: 11 }}>
                            {truncateMiddle(tu.sessionId, 8, 6)}
                          </span>
                        </td>
                        <td>{tu.callCount}</td>
                        <td>
                          <strong style={{ color: 'var(--danger)' }}>{tu.totalCredits}</strong>
                        </td>
                        <td>{formatDateTime(tu.startedAt)}</td>
                        <td>{formatDateTime(tu.lastUsedAt)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {tokenUsage.length < tokenUsageMeta.total && (
              <div style={{ padding: 12, textAlign: 'center' }}>
                <button
                  type="button"
                  className="secondary-btn"
                  disabled={tokenLoading}
                  onClick={() => loadTokenUsage(selectedUserId, Math.floor(tokenUsage.length / 20) + 1)}
                >
                  {tokenLoading ? '加载中...' : '加载更多'}
                </button>
              </div>
            )}
          </section>
        </>
      )}

      {/* 请求详情弹窗 */}
      {detailLog && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setDetailLog(null)}>
          <div
            className="modal-card audit-detail-modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 800 }}
          >
            <div className="modal-header audit-detail-modal-header">
              <div>
                <p className="section-tag">请求详情</p>
                <h2>
                  {detailLog.method} {detailLog.path}
                </h2>
                <p className="panel-caption">{formatDateTime(detailLog.createdAt)}</p>
              </div>
              <div className="audit-detail-header-actions">
                {detailLog.taskSessionId && (
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => {
                      setDetailLog(null);
                      onOpenSession(detailLog.taskSessionId!);
                    }}
                  >
                    查看会话 Trace
                  </button>
                )}
                <button type="button" className="secondary-btn" onClick={() => setDetailLog(null)}>
                  关闭
                </button>
              </div>
            </div>

            <div className="audit-detail-summary-strip">
              <span className={`status-pill ${statusClass(detailLog.responseStatus)}`}>
                {detailLog.responseStatus || '—'}
              </span>
              <span className="audit-detail-meta-pill">{detailLog.method}</span>
              <span className="audit-detail-meta-pill">
                {detailLog.durationMs ? `${detailLog.durationMs}ms` : '—'}
              </span>
              <span className="audit-detail-meta-pill">{detailLog.ipAddress || '—'}</span>
            </div>

            <div className="detail-grid modal-grid audit-detail-grid">
              <article className="sub-panel audit-detail-primary-panel">
                <div className="editor-header">
                  <div>
                    <h3>请求信息</h3>
                  </div>
                </div>
                <div className="audit-detail-fact-grid">
                  <div className="audit-detail-fact">
                    <span>方法</span>
                    <strong>{detailLog.method}</strong>
                  </div>
                  <div className="audit-detail-fact">
                    <span>路径</span>
                    <strong className="mono">{detailLog.path}</strong>
                  </div>
                  <div className="audit-detail-fact">
                    <span>状态码</span>
                    <strong>{detailLog.responseStatus || '—'}</strong>
                  </div>
                  <div className="audit-detail-fact">
                    <span>耗时</span>
                    <strong>{detailLog.durationMs ? `${detailLog.durationMs}ms` : '—'}</strong>
                  </div>
                  <div className="audit-detail-fact">
                    <span>IP</span>
                    <strong className="mono">{detailLog.ipAddress || '—'}</strong>
                  </div>
                  <div className="audit-detail-fact">
                    <span>User-Agent</span>
                    <strong className="mono" style={{ fontSize: 11 }}>
                      {detailLog.userAgent || '—'}
                    </strong>
                  </div>
                </div>

                {detailLog.queryString && (
                  <div className="audit-detail-note-card">
                    <span>Query String</span>
                    <p className="mono" style={{ fontSize: 11 }}>
                      {detailLog.queryString}
                    </p>
                  </div>
                )}

                <JsonPanel title="请求 Headers" data={detailLog.requestHeaders} />
                {detailLog.requestBodySummary && (
                  <JsonPanel title="请求 Body 摘要" data={JSON.parse(detailLog.requestBodySummary)} />
                )}
                {detailLog.responseBodySummary && (
                  <JsonPanel title="响应 Body 摘要" data={JSON.parse(detailLog.responseBodySummary)} />
                )}
              </article>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
