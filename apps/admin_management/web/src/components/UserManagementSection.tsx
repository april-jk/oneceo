import { useCallback, useEffect, useMemo, useState } from 'react';
import type * as React from 'react';
import { api } from '../api';
import type {
  AppUserConversationSummary,
  AppUserDetailResponse,
  AppUserLegacyMapping,
  AppUserListItem,
  AppUserListResponse,
  AppUserSandboxSummary,
  AppUserSessionSummary,
} from '../types';

type UserManagementFilters = {
  query: string;
  status: string;
  activity: string;
  hasSession: string;
  hasConversation: string;
  hasSandbox: string;
  ownershipHealth: string;
};

type UserDetailTab = 'overview' | 'sessions' | 'conversations' | 'sandboxes' | 'mappings';

type Props = {
  onError: (message: string | null) => void;
  onUpdatedAtChange?: (value: string | null) => void;
  onOpenConversation?: (sessionId: string) => void;
  onOpenSandbox?: (sandboxId: string) => void;
};

const DEFAULT_FILTERS: UserManagementFilters = {
  query: '',
  status: 'all',
  activity: 'all',
  hasSession: 'all',
  hasConversation: 'all',
  hasSandbox: 'all',
  ownershipHealth: 'all',
};

const LIST_LIMIT = 120;

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function userStatusLabel(value?: string | null) {
  if (value === 'active') return '正常';
  if (value === 'disabled') return '已禁用';
  return value || '-';
}

function ownershipHealthLabel(value?: string | null) {
  if (value === 'healthy') return '正常';
  if (value === 'legacy_mapping') return 'Legacy 映射';
  if (value === 'anomaly') return '异常';
  return value || '-';
}

function ownershipHealthTone(value?: string | null) {
  if (value === 'healthy') return 'status-running';
  if (value === 'legacy_mapping') return 'status-paused';
  return 'status-error';
}

function yesNoLabel(value: number) {
  return value > 0 ? '有' : '无';
}

function compactUserAgent(value?: string | null) {
  const text = String(value || '').trim();
  if (!text) return '-';
  if (text.length <= 88) return text;
  return `${text.slice(0, 85)}...`;
}

function sessionStateLabel(item: AppUserSessionSummary) {
  if (item.revokedAt) return '已撤销';
  return item.isActive ? '有效' : '已过期';
}

function conversationStatusLabel(value?: string | null) {
  if (value === 'in_progress') return '进行中';
  if (value === 'waiting_user') return '待确认';
  if (value === 'completed') return '已完成';
  if (value === 'failed') return '失败';
  return value || '-';
}

function sandboxStatusLabel(value?: string | null) {
  if (value === 'ready') return '运行中';
  if (value === 'creating') return '创建中';
  if (value === 'closing') return '关闭中';
  if (value === 'closed') return '已关闭';
  if (value === 'failed') return '失败';
  return value || '-';
}

function filterQuery(filters: UserManagementFilters) {
  return {
    limit: LIST_LIMIT,
    query: filters.query || undefined,
    status: filters.status !== 'all' ? filters.status : undefined,
    activity: filters.activity !== 'all' ? filters.activity : undefined,
    hasSession: filters.hasSession !== 'all' ? filters.hasSession : undefined,
    hasConversation: filters.hasConversation !== 'all' ? filters.hasConversation : undefined,
    hasSandbox: filters.hasSandbox !== 'all' ? filters.hasSandbox : undefined,
    ownershipHealth: filters.ownershipHealth !== 'all' ? filters.ownershipHealth : undefined,
  };
}

function SummaryValue({ label, value, hint }: { label: string; value: string | number; hint: string }) {
  return (
    <article className="user-management-summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </article>
  );
}

function DetailListEmpty({ title }: { title: string }) {
  return <p className="user-management-empty">{title}</p>;
}

function SessionItem({ item }: { item: AppUserSessionSummary }) {
  return (
    <article className="user-management-record-item">
      <div className="user-management-record-head">
        <strong>{sessionStateLabel(item)}</strong>
        <span className={`state-chip ${item.isActive && !item.revokedAt ? 'status-running' : 'status-stopped'}`}>
          {item.isActive && !item.revokedAt ? '在线' : '离线'}
        </span>
      </div>
      <dl className="user-management-record-grid">
        <div>
          <dt>会话 ID</dt>
          <dd>{item.id}</dd>
        </div>
        <div>
          <dt>最近访问</dt>
          <dd>{formatDateTime(item.lastSeenAt)}</dd>
        </div>
        <div>
          <dt>来源 IP</dt>
          <dd>{item.ipAddress || '-'}</dd>
        </div>
        <div>
          <dt>过期时间</dt>
          <dd>{formatDateTime(item.expiresAt)}</dd>
        </div>
      </dl>
      <p className="user-management-record-note">{compactUserAgent(item.userAgent)}</p>
    </article>
  );
}

function ConversationItem({
  item,
  onOpenConversation,
}: {
  item: AppUserConversationSummary;
  onOpenConversation?: (sessionId: string) => void;
}) {
  return (
    <article className="user-management-record-item">
      <div className="user-management-record-head">
        <strong>{item.title}</strong>
        <span className={`state-chip ${item.status === 'completed' ? 'status-running' : item.status === 'failed' ? 'status-error' : 'status-paused'}`}>
          {conversationStatusLabel(item.status)}
        </span>
      </div>
      <dl className="user-management-record-grid">
        <div>
          <dt>会话 ID</dt>
          <dd>{item.id}</dd>
        </div>
        <div>
          <dt>最近更新</dt>
          <dd>{formatDateTime(item.updatedAt)}</dd>
        </div>
        <div>
          <dt>创建时间</dt>
          <dd>{formatDateTime(item.createdAt)}</dd>
        </div>
        <div>
          <dt>完成时间</dt>
          <dd>{formatDateTime(item.completedAt)}</dd>
        </div>
      </dl>
      {onOpenConversation ? (
        <div className="user-management-record-actions">
          <button type="button" className="secondary-btn" onClick={() => onOpenConversation(item.id)}>
            打开对话
          </button>
        </div>
      ) : null}
    </article>
  );
}

function SandboxItem({
  item,
  onOpenSandbox,
}: {
  item: AppUserSandboxSummary;
  onOpenSandbox?: (sandboxId: string) => void;
}) {
  return (
    <article className="user-management-record-item">
      <div className="user-management-record-head">
        <strong>{item.vmName || item.sandboxId}</strong>
        <span className={`state-chip ${item.status === 'ready' ? 'status-running' : item.status === 'failed' ? 'status-error' : 'status-paused'}`}>
          {sandboxStatusLabel(item.status)}
        </span>
      </div>
      <dl className="user-management-record-grid">
        <div>
          <dt>Sandbox ID</dt>
          <dd>{item.sandboxId}</dd>
        </div>
        <div>
          <dt>会话绑定</dt>
          <dd>{item.taskSessionId}</dd>
        </div>
        <div>
          <dt>基础镜像</dt>
          <dd>{item.baseImage || '-'}</dd>
        </div>
        <div>
          <dt>最近更新</dt>
          <dd>{formatDateTime(item.updatedAt)}</dd>
        </div>
      </dl>
      {onOpenSandbox ? (
        <div className="user-management-record-actions">
          <button type="button" className="secondary-btn" onClick={() => onOpenSandbox(item.sandboxId)}>
            打开 Sandbox
          </button>
        </div>
      ) : null}
    </article>
  );
}

function MappingItem({ item }: { item: AppUserLegacyMapping }) {
  return (
    <article className="user-management-record-item">
      <div className="user-management-record-head">
        <strong>{item.legacyUserId}</strong>
        <span className="state-chip status-paused">{item.source || 'legacy'}</span>
      </div>
      <dl className="user-management-record-grid">
        <div>
          <dt>首次出现</dt>
          <dd>{formatDateTime(item.firstSeenAt)}</dd>
        </div>
        <div>
          <dt>最近出现</dt>
          <dd>{formatDateTime(item.lastSeenAt)}</dd>
        </div>
        <div>
          <dt>创建时间</dt>
          <dd>{formatDateTime(item.createdAt)}</dd>
        </div>
        <div>
          <dt>更新时间</dt>
          <dd>{formatDateTime(item.updatedAt)}</dd>
        </div>
      </dl>
    </article>
  );
}

export function UserManagementSection({ onError, onUpdatedAtChange, onOpenConversation, onOpenSandbox }: Props) {
  const [filters, setFilters] = useState<UserManagementFilters>(DEFAULT_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<UserManagementFilters>(DEFAULT_FILTERS);
  const [response, setResponse] = useState<AppUserListResponse | null>(null);
  const [detail, setDetail] = useState<AppUserDetailResponse | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detailTab, setDetailTab] = useState<UserDetailTab>('overview');
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState<'status' | 'revoke' | null>(null);

  const users = response?.items || [];
  const selectedListItem = useMemo(
    () => users.find((item) => item.id === selectedUserId) || null,
    [selectedUserId, users]
  );

  const loadUsers = useCallback(
    async (nextFilters: UserManagementFilters = appliedFilters) => {
      setLoading(true);
      try {
        const next = await api.listAppUsers(filterQuery(nextFilters));
        setResponse(next);
        onUpdatedAtChange?.(next.summary.generatedAt || null);
        onError(null);
      } catch (error) {
        onUpdatedAtChange?.(null);
        onError(error instanceof Error ? error.message : '用户列表加载失败');
      } finally {
        setLoading(false);
      }
    },
    [appliedFilters, onError, onUpdatedAtChange]
  );

  const loadDetail = useCallback(
    async (userId: string) => {
      setDetailLoading(true);
      try {
        const next = await api.getAppUserDetail(userId);
        setDetail(next);
        onError(null);
        return next;
      } catch (error) {
        onError(error instanceof Error ? error.message : '用户详情加载失败');
        return null;
      } finally {
        setDetailLoading(false);
      }
    },
    [onError]
  );

  useEffect(() => {
    void loadUsers(appliedFilters);
  }, [appliedFilters, loadUsers]);

  useEffect(() => {
    if (!selectedUserId) return;
    if (!users.some((item) => item.id === selectedUserId)) {
      setSelectedUserId(null);
      setDetail(null);
      setDrawerOpen(false);
    }
  }, [selectedUserId, users]);

  const openDetail = useCallback(
    async (userId: string) => {
      setSelectedUserId(userId);
      setDrawerOpen(true);
      setDetailTab('overview');
      await loadDetail(userId);
    },
    [loadDetail]
  );

  const refreshCurrent = useCallback(async () => {
    await loadUsers(appliedFilters);
    if (drawerOpen && selectedUserId) {
      await loadDetail(selectedUserId);
    }
  }, [appliedFilters, drawerOpen, loadDetail, loadUsers, selectedUserId]);

  const handleApplyFilters = useCallback((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAppliedFilters(filters);
  }, [filters]);

  const handleResetFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
    setAppliedFilters(DEFAULT_FILTERS);
  }, []);

  const handleStatusToggle = useCallback(async () => {
    const userId = detail?.user?.id || selectedUserId;
    const nextStatus = detail?.user?.status === 'disabled' ? 'active' : 'disabled';
    if (!userId) return;

    setActionBusy('status');
    try {
      const next = await api.updateAppUserStatus(userId, nextStatus);
      setDetail(next);
      await loadUsers(appliedFilters);
      onError(null);
    } catch (error) {
      onError(error instanceof Error ? error.message : '用户状态更新失败');
    } finally {
      setActionBusy(null);
    }
  }, [appliedFilters, detail?.user?.id, detail?.user?.status, loadUsers, onError, selectedUserId]);

  const handleRevokeSessions = useCallback(async () => {
    const userId = detail?.user?.id || selectedUserId;
    if (!userId) return;

    setActionBusy('revoke');
    try {
      const next = await api.revokeAppUserSessions(userId);
      setDetail(next);
      await loadUsers(appliedFilters);
      onError(null);
    } catch (error) {
      onError(error instanceof Error ? error.message : '强制下线失败');
    } finally {
      setActionBusy(null);
    }
  }, [appliedFilters, detail?.user?.id, loadUsers, onError, selectedUserId]);

  const summary = response?.summary;
  const detailUser = detail?.user || selectedListItem;

  return (
    <>
      <main className="content-stack user-management-page">
        <section className="user-management-hero">
          <div className="user-management-hero-copy">
            <p className="section-tag">App User</p>
            <h2>用户管理</h2>
            <p className="panel-caption">集中查看 app_users 的账号状态、来源线索、最近登录与会话/Sandbox 归属。</p>
          </div>
          <div className="user-management-hero-actions">
            <button type="button" className="ghost-btn" onClick={() => void refreshCurrent()} disabled={loading || detailLoading}>
              {loading ? '刷新中...' : '刷新列表'}
            </button>
          </div>
        </section>

        <section className="user-management-summary-strip">
          <SummaryValue label="全部用户" value={summary?.totalUsers ?? '-'} hint="app_users 总量" />
          <SummaryValue label="7 天活跃" value={summary?.activeUsers7d ?? '-'} hint="最近有登录态访问" />
          <SummaryValue label="已禁用" value={summary?.disabledUsers ?? '-'} hint="状态为 disabled" />
          <SummaryValue label="归属提醒" value={summary?.ownershipAlertUsers ?? '-'} hint="存在 legacy 映射" />
        </section>

        <section className="sub-panel user-management-filter-panel">
          <div className="user-management-filter-head">
            <div>
              <p className="section-tag">筛选</p>
              <p className="panel-caption">按身份、活跃度和关联运行态快速定位用户。</p>
            </div>
            <span className="panel-caption">当前 {users.length} 条</span>
          </div>
          <form className="user-management-filter-grid" onSubmit={handleApplyFilters}>
            <label>
              <span>用户</span>
              <input
                value={filters.query}
                onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
                placeholder="用户名 / 邮箱 / 用户 ID"
              />
            </label>
            <label>
              <span>状态</span>
              <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
                <option value="all">全部</option>
                <option value="active">正常</option>
                <option value="disabled">已禁用</option>
              </select>
            </label>
            <label>
              <span>活跃度</span>
              <select value={filters.activity} onChange={(event) => setFilters((current) => ({ ...current, activity: event.target.value }))}>
                <option value="all">全部</option>
                <option value="active_7d">7 天活跃</option>
                <option value="active_30d">30 天活跃</option>
                <option value="inactive_30d">30 天未活跃</option>
              </select>
            </label>
            <label>
              <span>登录态</span>
              <select value={filters.hasSession} onChange={(event) => setFilters((current) => ({ ...current, hasSession: event.target.value }))}>
                <option value="all">全部</option>
                <option value="yes">有</option>
                <option value="no">无</option>
              </select>
            </label>
            <label>
              <span>对话</span>
              <select value={filters.hasConversation} onChange={(event) => setFilters((current) => ({ ...current, hasConversation: event.target.value }))}>
                <option value="all">全部</option>
                <option value="yes">有</option>
                <option value="no">无</option>
              </select>
            </label>
            <label>
              <span>Sandbox</span>
              <select value={filters.hasSandbox} onChange={(event) => setFilters((current) => ({ ...current, hasSandbox: event.target.value }))}>
                <option value="all">全部</option>
                <option value="yes">有</option>
                <option value="no">无</option>
              </select>
            </label>
            <label>
              <span>归属健康</span>
              <select value={filters.ownershipHealth} onChange={(event) => setFilters((current) => ({ ...current, ownershipHealth: event.target.value }))}>
                <option value="all">全部</option>
                <option value="healthy">正常</option>
                <option value="legacy_mapping">Legacy 映射</option>
                <option value="anomaly">异常</option>
              </select>
            </label>
            <div className="user-management-filter-actions">
              <button type="submit" className="primary-btn" disabled={loading}>
                应用筛选
              </button>
              <button type="button" className="secondary-btn" onClick={handleResetFilters} disabled={loading}>
                重置
              </button>
            </div>
          </form>
        </section>

        <section className="user-management-list" aria-live="polite">
          {loading ? <p className="user-management-empty">正在加载用户列表...</p> : null}
          {!loading && users.length === 0 ? <p className="user-management-empty">当前筛选条件下没有匹配用户</p> : null}
          {!loading
            ? users.map((item) => (
                <article key={item.id} className={`user-management-row ${selectedUserId === item.id ? 'is-selected' : ''}`}>
                  <div className="user-management-row-main">
                    <div className="user-management-identity">
                      <div className="user-management-identity-head">
                        <h3>{item.displayName}</h3>
                        <span className={`state-chip ${item.status === 'active' ? 'status-running' : 'status-error'}`}>
                          {userStatusLabel(item.status)}
                        </span>
                        <span className={`state-chip ${ownershipHealthTone(item.ownershipHealth)}`}>
                          {ownershipHealthLabel(item.ownershipHealth)}
                        </span>
                      </div>
                      <p>{item.email}</p>
                      <small>{item.id}</small>
                    </div>

                    <div className="user-management-meta">
                      <div>
                        <span>最近活跃</span>
                        <strong>{formatDateTime(item.lastActivityAt)}</strong>
                      </div>
                      <div>
                        <span>最近 IP</span>
                        <strong>{item.latestSession?.ipAddress || '-'}</strong>
                      </div>
                      <div>
                        <span>最近登录</span>
                        <strong>{formatDateTime(item.lastLoginAt)}</strong>
                      </div>
                    </div>

                    <div className="user-management-stats">
                      <div>
                        <span>登录态</span>
                        <strong>{item.sessionCount}</strong>
                        <small>有效 {item.activeSessionCount}</small>
                      </div>
                      <div>
                        <span>对话</span>
                        <strong>{item.conversationCount}</strong>
                        <small>{formatDateTime(item.lastConversationAt)}</small>
                      </div>
                      <div>
                        <span>Sandbox</span>
                        <strong>{item.sandboxCount}</strong>
                        <small>{formatDateTime(item.lastSandboxAt)}</small>
                      </div>
                      <div>
                        <span>映射</span>
                        <strong>{item.legacyMappingCount}</strong>
                        <small>{yesNoLabel(item.legacyMappingCount)}</small>
                      </div>
                    </div>
                  </div>

                  <div className="user-management-row-side">
                    <p className="user-management-row-reason">{item.ownershipReason}</p>
                    <button type="button" className="secondary-btn" onClick={() => void openDetail(item.id)}>
                      查看详情
                    </button>
                  </div>
                </article>
              ))
            : null}
        </section>
      </main>

      {drawerOpen ? (
        <div className="modal-backdrop drawer-backdrop" role="dialog" aria-modal="true" onClick={() => setDrawerOpen(false)}>
          <aside className="runtime-create-drawer user-management-drawer" onClick={(event) => event.stopPropagation()}>
            <div className="drawer-header">
              <div>
                <p className="section-tag">用户详情</p>
                <h2>{detailUser?.displayName || '用户详情'}</h2>
                <p className="panel-caption">{detailUser?.email || selectedUserId || '-'}</p>
              </div>
              <div className="user-management-drawer-actions">
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => void handleRevokeSessions()}
                  disabled={actionBusy !== null || detailLoading || !detailUser}
                >
                  {actionBusy === 'revoke' ? '处理中...' : '强制下线'}
                </button>
                <button
                  type="button"
                  className="primary-btn"
                  onClick={() => void handleStatusToggle()}
                  disabled={actionBusy !== null || detailLoading || !detailUser}
                >
                  {actionBusy === 'status'
                    ? '处理中...'
                    : detailUser?.status === 'disabled'
                      ? '启用用户'
                      : '禁用用户'}
                </button>
                <button type="button" className="secondary-btn" onClick={() => setDrawerOpen(false)}>
                  关闭
                </button>
              </div>
            </div>

            <div className="user-management-tab-strip">
              {([
                ['overview', '概览'],
                ['sessions', '登录会话'],
                ['conversations', '对话'],
                ['sandboxes', 'Sandbox'],
                ['mappings', '归属映射'],
              ] as Array<[UserDetailTab, string]>).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={`secondary-btn ${detailTab === key ? 'active' : ''}`}
                  onClick={() => setDetailTab(key)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="drawer-body user-management-drawer-body">
              {detailLoading ? <p className="user-management-empty">正在加载用户详情...</p> : null}
              {!detailLoading && detail && detailTab === 'overview' ? (
                <div className="user-management-detail-grid">
                  <article className="sub-panel user-management-detail-card">
                    <p className="section-tag">账号</p>
                    <dl className="user-management-kv-list">
                      <div>
                        <dt>用户名</dt>
                        <dd>{detail.user?.displayName || '-'}</dd>
                      </div>
                      <div>
                        <dt>邮箱</dt>
                        <dd>{detail.user?.email || '-'}</dd>
                      </div>
                      <div>
                        <dt>状态</dt>
                        <dd>{userStatusLabel(detail.user?.status)}</dd>
                      </div>
                      <div>
                        <dt>最后登录</dt>
                        <dd>{formatDateTime(detail.user?.lastLoginAt)}</dd>
                      </div>
                    </dl>
                  </article>

                  <article className="sub-panel user-management-detail-card">
                    <p className="section-tag">活跃概况</p>
                    <dl className="user-management-kv-list">
                      <div>
                        <dt>最近活跃</dt>
                        <dd>{formatDateTime(detail.stats.lastActivityAt)}</dd>
                      </div>
                      <div>
                        <dt>最近对话</dt>
                        <dd>{formatDateTime(detail.stats.lastConversationAt)}</dd>
                      </div>
                      <div>
                        <dt>最近 Sandbox</dt>
                        <dd>{formatDateTime(detail.stats.lastSandboxAt)}</dd>
                      </div>
                      <div>
                        <dt>归属判断</dt>
                        <dd>{ownershipHealthLabel(detail.stats.ownershipHealth)}</dd>
                      </div>
                    </dl>
                  </article>

                  <article className="sub-panel user-management-detail-card">
                    <p className="section-tag">关联数量</p>
                    <dl className="user-management-kv-list">
                      <div>
                        <dt>登录态</dt>
                        <dd>{detail.stats.sessionCount}</dd>
                      </div>
                      <div>
                        <dt>有效登录态</dt>
                        <dd>{detail.stats.activeSessionCount}</dd>
                      </div>
                      <div>
                        <dt>对话</dt>
                        <dd>{detail.stats.conversationCount}</dd>
                      </div>
                      <div>
                        <dt>Sandbox</dt>
                        <dd>{detail.stats.sandboxCount}</dd>
                      </div>
                    </dl>
                  </article>

                  <article className="sub-panel user-management-detail-card">
                    <p className="section-tag">归属说明</p>
                    <p className="user-management-detail-note">{detail.stats.ownershipReason}</p>
                    <p className="panel-caption">Legacy 映射 {detail.stats.legacyMappingCount} 条，最近出现 {formatDateTime(detail.stats.lastLegacySeenAt)}</p>
                    {detail.revokedSessionCount ? (
                      <p className="panel-caption">最近一次操作已撤销 {detail.revokedSessionCount} 个登录态。</p>
                    ) : null}
                  </article>
                </div>
              ) : null}

              {!detailLoading && detail && detailTab === 'sessions'
                ? (detail.recentSessions.length > 0
                    ? detail.recentSessions.map((item) => <SessionItem key={item.id} item={item} />)
                    : <DetailListEmpty title="当前用户暂无登录会话记录" />)
                : null}

              {!detailLoading && detail && detailTab === 'conversations'
                ? (detail.recentConversations.length > 0
                    ? detail.recentConversations.map((item) => (
                        <ConversationItem key={item.id} item={item} onOpenConversation={onOpenConversation} />
                      ))
                    : <DetailListEmpty title="当前用户暂无对话记录" />)
                : null}

              {!detailLoading && detail && detailTab === 'sandboxes'
                ? (detail.recentSandboxes.length > 0
                    ? detail.recentSandboxes.map((item) => (
                        <SandboxItem key={item.sandboxId} item={item} onOpenSandbox={onOpenSandbox} />
                      ))
                    : <DetailListEmpty title="当前用户暂无 Sandbox 记录" />)
                : null}

              {!detailLoading && detail && detailTab === 'mappings'
                ? (detail.legacyMappings.length > 0
                    ? detail.legacyMappings.map((item) => <MappingItem key={item.id} item={item} />)
                    : <DetailListEmpty title="当前用户暂无 legacy 映射记录" />)
                : null}
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
