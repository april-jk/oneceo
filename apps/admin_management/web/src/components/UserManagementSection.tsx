import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import type {
  AppUserConversationSummary,
  AppUserDetailResponse,
  DeploymentRecord,
  AppUserListResponse,
  AppUserSandboxSummary,
  AppUserSessionSummary,
} from '../types';
import {
  DEFAULT_USER_MANAGEMENT_FILTERS,
  DEFAULT_USER_MANAGEMENT_SORT,
  DEFAULT_USER_MANAGEMENT_VIEW_STATE,
} from './adminViewState';
import type {
  UserDetailTab,
  UserManagementFilters,
  UserManagementSort,
  UserManagementSortDirection,
  UserManagementSortKey,
  UserManagementViewState,
} from './adminViewState';

type UserDetailJumpOrigin = {
  section: 'user';
  trail: string;
};

type UserBillingDetail = {
  credits: {
    balance: number;
    totalEarned: number;
    totalConsumed: number;
    lastRechargeAt?: string | null;
  };
  usageRecords: {
    items: Array<{
      id: string;
      sessionId: string;
      sessionTitle: string;
      totalCredits: number;
      totalTokens: number;
      callCount: number;
      lastUsedAt: string;
    }>;
    total: number;
  };
  acquisitionHistory: {
    items: Array<{
      id: string;
      type: string;
      amount: number;
      balanceAfter: number;
      description?: string | null;
      createdAt: string;
    }>;
    total: number;
  };
};

type Props = {
  onError: (message: string | null) => void;
  onUpdatedAtChange?: (value: string | null) => void;
  onRegisterRefresh?: (handler: (() => Promise<void>) | null) => void;
  onOpenConversation?: (sessionId: string, origin?: UserDetailJumpOrigin) => void;
  onOpenSandbox?: (sandboxId: string, origin?: UserDetailJumpOrigin) => void;
  onOpenDeployment?: (taskSessionId: string, origin?: UserDetailJumpOrigin) => void;
  persistedState?: UserManagementViewState | null;
  onStateChange?: (state: UserManagementViewState) => void;
};

const DEFAULT_FILTERS = DEFAULT_USER_MANAGEMENT_FILTERS;
const DEFAULT_SORT = DEFAULT_USER_MANAGEMENT_SORT;

const LIST_LIMIT = 120;

const SORT_OPTIONS: Array<{ key: UserManagementSortKey; label: string }> = [
  { key: 'user', label: '用户' },
  { key: 'status', label: '状态' },
  { key: 'last_activity', label: '上次登录' },
  { key: 'sessions', label: '登录状态' },
  { key: 'conversations', label: '对话' },
  { key: 'sandboxes', label: 'Sandbox' },
];

const SORT_LABEL_MAP: Record<UserManagementSortKey, string> = {
  user: '用户',
  status: '状态',
  last_activity: '上次登录',
  sessions: '登录状态',
  conversations: '对话',
  sandboxes: 'Sandbox',
};

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function toTimestamp(value?: string | null) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCompactRelativeTime(value?: string | null, now = Date.now()) {
  const timestamp = toTimestamp(value);
  if (!timestamp) return '-';
  const deltaMs = Math.max(0, now - timestamp);
  if (deltaMs < 60 * 1000) return `${Math.max(1, Math.floor(deltaMs / 1000))}秒前`;
  if (deltaMs < 60 * 60 * 1000) return `${Math.floor(deltaMs / (60 * 1000))}分钟前`;
  if (deltaMs < 24 * 60 * 60 * 1000) return `${Math.floor(deltaMs / (60 * 60 * 1000))}小时前`;
  if (deltaMs < 30 * 24 * 60 * 60 * 1000) return `${Math.floor(deltaMs / (24 * 60 * 60 * 1000))}天前`;
  return formatDateTime(value);
}

function userStatusLabel(value?: string | null) {
  if (value === 'active') return '正常';
  if (value === 'disabled') return '已禁用';
  return value || '-';
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

function loginStatusLabel(input: { activeSessionCount?: number | null; lastLoginAt?: string | null }) {
  if ((input.activeSessionCount || 0) > 0) return '当前已登录';
  return '当前未登录';
}

function loginStatusTone(input: { activeSessionCount?: number | null; lastLoginAt?: string | null }) {
  if ((input.activeSessionCount || 0) > 0) return 'status-running';
  if (input.lastLoginAt) return 'status-paused';
  return 'status-stopped';
}

function loginStatusHint(input: { activeSessionCount?: number | null; lastLoginAt?: string | null }) {
  if ((input.activeSessionCount || 0) > 0) return '当前存在在线登录';
  if (input.lastLoginAt) return '当前没有在线登录';
  return '从未登录过';
}

function loginStatusSummary(input: { activeSessionCount?: number | null; lastLoginAt?: string | null }) {
  if ((input.activeSessionCount || 0) > 0) {
    return `${input.activeSessionCount} 个在线登录`;
  }
  if (input.lastLoginAt) return '暂无在线登录';
  return '从未登录';
}

function activitySummary(value?: string | null, emptyLabel = '暂无记录') {
  return value ? formatDateTime(value) : emptyLabel;
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

function deploymentStatusLabel(value?: string | null) {
  if (value === 'success') return '成功';
  if (value === 'failed') return '失败';
  if (value === 'pending') return '处理中';
  if (value === 'ready') return '已就绪';
  if (value === 'uninitialized') return '未初始化';
  return value || '-';
}

function initialSortDirection(key: UserManagementSortKey): UserManagementSortDirection {
  if (key === 'user' || key === 'status') return 'asc';
  return 'desc';
}

function sortDirectionLabel(direction: UserManagementSortDirection) {
  return direction === 'asc' ? '升序' : '降序';
}

function truncateMiddle(value: string, head = 8, tail = 6) {
  if (!value) return '-';
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

function filterQuery(filters: UserManagementFilters, sort: UserManagementSort) {
  return {
    limit: LIST_LIMIT,
    query: filters.query || undefined,
    status: filters.status !== 'all' ? filters.status : undefined,
    activity: filters.activity !== 'all' ? filters.activity : undefined,
    hasSession: filters.hasSession !== 'all' ? filters.hasSession : undefined,
    hasConversation: filters.hasConversation !== 'all' ? filters.hasConversation : undefined,
    sortKey: sort.key,
    sortDirection: sort.direction,
  };
}

function DetailListEmpty({ title }: { title: string }) {
  return <p className="user-management-empty">{title}</p>;
}

function ConversationItem({
  item,
  onOpenConversation,
}: {
  item: AppUserConversationSummary;
  onOpenConversation?: (item: AppUserConversationSummary) => void;
}) {
  return (
    <article className="user-management-record-item">
      <div className="user-management-record-head">
        {onOpenConversation ? (
          <button type="button" className="record-title-link" onClick={() => onOpenConversation(item)}>
            {item.title}
          </button>
        ) : (
          <strong>{item.title}</strong>
        )}
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
    </article>
  );
}

function SandboxItem({
  item,
  onOpenSandbox,
}: {
  item: AppUserSandboxSummary;
  onOpenSandbox?: (item: AppUserSandboxSummary) => void;
}) {
  return (
    <article className="user-management-record-item">
      <div className="user-management-record-head">
        {onOpenSandbox ? (
          <button type="button" className="record-title-link" onClick={() => onOpenSandbox(item)}>
            {item.vmName || item.sandboxId}
          </button>
        ) : (
          <strong>{item.vmName || item.sandboxId}</strong>
        )}
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
    </article>
  );
}

function DeploymentItem({
  item,
  onOpenDeployment,
}: {
  item: DeploymentRecord;
  onOpenDeployment?: (item: DeploymentRecord) => void;
}) {
  return (
    <article className="user-management-record-item">
      <div className="user-management-record-head">
        {onOpenDeployment ? (
          <button type="button" className="record-title-link" onClick={() => onOpenDeployment(item)}>
            {item.session.title}
          </button>
        ) : (
          <strong>{item.session.title}</strong>
        )}
        <span className={`state-chip ${item.statusCategory === 'success' || item.statusCategory === 'ready' ? 'status-running' : item.statusCategory === 'failed' ? 'status-error' : 'status-paused'}`}>
          {deploymentStatusLabel(item.statusCategory)}
        </span>
      </div>
      <dl className="user-management-record-grid">
        <div>
          <dt>会话 ID</dt>
          <dd>{item.taskSessionId}</dd>
        </div>
        <div>
          <dt>项目 / 服务</dt>
          <dd>{item.projectName || '-'} / {item.serviceName || '-'}</dd>
        </div>
        <div>
          <dt>访问地址</dt>
          <dd>{item.latestUrl || item.latestStaticUrl || '-'}</dd>
        </div>
        <div>
          <dt>最近更新</dt>
          <dd>{formatDateTime(item.updatedAt)}</dd>
        </div>
      </dl>
    </article>
  );
}

export function UserManagementSection({
  onError,
  onUpdatedAtChange,
  onRegisterRefresh,
  onOpenConversation,
  onOpenSandbox,
  onOpenDeployment,
  persistedState,
  onStateChange,
}: Props) {
  const initialState = persistedState || DEFAULT_USER_MANAGEMENT_VIEW_STATE;
  const [filters, setFilters] = useState<UserManagementFilters>(initialState.filters);
  const [sort, setSort] = useState<UserManagementSort>(initialState.sort);
  const [response, setResponse] = useState<AppUserListResponse | null>(null);
  const [detail, setDetail] = useState<AppUserDetailResponse | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(initialState.selectedUserId);
  const [selectedUserLabel, setSelectedUserLabel] = useState<string | null>(initialState.selectedUserLabel);
  const [drawerOpen, setDrawerOpen] = useState(initialState.drawerOpen);
  const [detailTab, setDetailTab] = useState<UserDetailTab>(initialState.detailTab);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [deploymentRecords, setDeploymentRecords] = useState<DeploymentRecord[]>([]);
  const [deploymentLoading, setDeploymentLoading] = useState(false);
  const [billingDetail, setBillingDetail] = useState<UserBillingDetail | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState<'status' | null>(null);
  const [summaryRefreshing, setSummaryRefreshing] = useState(false);
  const [summaryFetchedAt, setSummaryFetchedAt] = useState<string | null>(null);
  const [summaryClock, setSummaryClock] = useState(() => Date.now());
  const loadUsersRequestVersionRef = useRef(0);

  const users = response?.items || [];
  const selectedListItem = useMemo(
    () => users.find((item) => item.id === selectedUserId) || null,
    [selectedUserId, users]
  );

  const loadUsers = useCallback(
    async (nextFilters: UserManagementFilters = filters, nextSort: UserManagementSort = sort) => {
      const requestVersion = ++loadUsersRequestVersionRef.current;
      setLoading(true);
      try {
        const next = await api.listAppUsers(filterQuery(nextFilters, nextSort));
        if (requestVersion !== loadUsersRequestVersionRef.current) return;
        setResponse(next);
        const generatedAt = next.summary.generatedAt || new Date().toISOString();
        setSummaryFetchedAt(generatedAt);
        setSummaryClock(Date.now());
        onUpdatedAtChange?.(generatedAt);
        onError(null);
      } catch (error) {
        if (requestVersion !== loadUsersRequestVersionRef.current) return;
        onUpdatedAtChange?.(null);
        onError(error instanceof Error ? error.message : '用户列表加载失败');
      } finally {
        if (requestVersion === loadUsersRequestVersionRef.current) {
          setLoading(false);
        }
      }
    },
    [filters, onError, onUpdatedAtChange, sort]
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
    void loadUsers(filters, sort);
  }, [filters, loadUsers, sort]);

  useEffect(() => {
    onStateChange?.({
      filters,
      sort,
      selectedUserId,
      selectedUserLabel,
      drawerOpen,
      detailTab,
    });
  }, [detailTab, drawerOpen, filters, onStateChange, selectedUserId, selectedUserLabel, sort]);

  useEffect(() => {
    if (!selectedUserId) return;
    if (!response || loading) return;
    if (!users.some((item) => item.id === selectedUserId)) {
      setSelectedUserId(null);
      setSelectedUserLabel(null);
      setDetail(null);
      setDrawerOpen(false);
    }
  }, [loading, response, selectedUserId, users]);

  useEffect(() => {
    if (!drawerOpen || !selectedUserId) return;
    if (detail?.user?.id === selectedUserId) return;
    void loadDetail(selectedUserId);
  }, [detail?.user?.id, drawerOpen, loadDetail, selectedUserId]);

  useEffect(() => {
    if (!drawerOpen || detailTab !== 'deployments' || !selectedUserId) return;
    let cancelled = false;
    setDeploymentLoading(true);
    void api.listDeploymentRecords({
      limit: 20,
      userId: selectedUserId,
    }).then((next) => {
      if (cancelled) return;
      setDeploymentRecords(next.records);
      onError(null);
    }).catch((error) => {
      if (cancelled) return;
      setDeploymentRecords([]);
      onError(error instanceof Error ? error.message : '用户部署记录加载失败');
    }).finally(() => {
      if (!cancelled) {
        setDeploymentLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [detailTab, drawerOpen, onError, selectedUserId]);

  useEffect(() => {
    if (!drawerOpen || detailTab !== 'billing' || !selectedUserId) return;
    let cancelled = false;
    setBillingLoading(true);
    void fetch(`/api/internal/billing/users/${encodeURIComponent(selectedUserId)}/billing-detail`, {
      credentials: 'include',
    })
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error || '用户计费详情加载失败');
        }
        return response.json() as Promise<UserBillingDetail>;
      })
      .then((next) => {
        if (cancelled) return;
        setBillingDetail(next);
        onError(null);
      })
      .catch((error) => {
        if (cancelled) return;
        setBillingDetail(null);
        onError(error instanceof Error ? error.message : '用户计费详情加载失败');
      })
      .finally(() => {
        if (!cancelled) setBillingLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [detailTab, drawerOpen, onError, selectedUserId]);

  useEffect(() => {
    if (detail?.user?.id === selectedUserId) {
      setSelectedUserLabel(detail.user.displayName || detail.user.email || detail.user.id);
      return;
    }
    if (selectedListItem) {
      setSelectedUserLabel(selectedListItem.displayName || selectedListItem.email || selectedListItem.id);
    }
  }, [detail?.user, selectedListItem, selectedUserId]);

  useEffect(() => {
    if (!summaryFetchedAt) return;
    const timer = window.setInterval(() => {
      setSummaryClock(Date.now());
    }, 10000);
    return () => {
      window.clearInterval(timer);
    };
  }, [summaryFetchedAt]);

  const handleExternalRefresh = useCallback(async () => {
    await loadUsers(filters, sort);
    if (drawerOpen && selectedUserId) {
      await loadDetail(selectedUserId);
      if (detailTab === 'deployments') {
        const next = await api.listDeploymentRecords({
          limit: 20,
          userId: selectedUserId,
        });
        setDeploymentRecords(next.records);
      }
    }
  }, [detailTab, drawerOpen, filters, loadDetail, loadUsers, selectedUserId, sort]);

  useEffect(() => {
    onRegisterRefresh?.(handleExternalRefresh);
    return () => {
      onRegisterRefresh?.(null);
    };
  }, [handleExternalRefresh, onRegisterRefresh]);

  const openDetail = useCallback(
    (userId: string) => {
      setSelectedUserId(userId);
      const listItem = users.find((item) => item.id === userId) || null;
      setSelectedUserLabel(listItem?.displayName || listItem?.email || userId);
      setDetail(null);
      setDeploymentRecords([]);
      setBillingDetail(null);
      setDrawerOpen(true);
      setDetailTab('overview');
    },
    [users]
  );

  const handleResetFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
  }, []);

  const handleSummaryRefresh = useCallback(async () => {
    setSummaryRefreshing(true);
    try {
      await handleExternalRefresh();
    } finally {
      setSummaryRefreshing(false);
    }
  }, [handleExternalRefresh]);

  const handleSortToggle = useCallback((key: UserManagementSortKey) => {
    setSort((current) => {
      if (current.key === key) {
        return {
          key,
          direction: current.direction === 'asc' ? 'desc' : 'asc',
        };
      }
      return {
        key,
        direction: initialSortDirection(key),
      };
    });
  }, []);

  const handleStatusToggle = useCallback(async () => {
    const userId = detail?.user?.id || selectedUserId;
    const nextStatus = detail?.user?.status === 'disabled' ? 'active' : 'disabled';
    if (!userId) return;

    setActionBusy('status');
    try {
      const next = await api.updateAppUserStatus(userId, nextStatus);
      setDetail(next);
      await loadUsers(filters);
      onError(null);
    } catch (error) {
      onError(error instanceof Error ? error.message : '用户状态更新失败');
    } finally {
      setActionBusy(null);
    }
  }, [detail?.user?.id, detail?.user?.status, filters, loadUsers, onError, selectedUserId]);

  const summary = response?.summary;
  const summaryAge = formatCompactRelativeTime(summaryFetchedAt, summaryClock);
  const detailUser = detail?.user || selectedListItem;
  const currentSortLabel = SORT_LABEL_MAP[sort.key] || '上次登录';
  const latestSessionRecord = detail?.recentSessions[0] || null;
  const recentSessions = detail?.recentSessions || [];
  const detailJumpOrigin = detailUser
    ? {
        section: 'user' as const,
        trail: `用户管理 / ${detailUser.displayName || detailUser.email || detailUser.id}`,
      }
    : null;

  return (
    <>
      <main className="content-stack viewport-lock-page user-management-page">
        <section className="user-management-hero">
          <div className="user-management-hero-copy">
            <p className="section-tag">普通用户</p>
            <h2>用户管理</h2>
          </div>
          <div className="sandbox-list-header-actions user-management-hero-actions">
            <section className="user-management-summary-strip user-management-live-summary session-status sandbox-live-count" aria-label="用户管理摘要">
              <span className="sandbox-live-metric sandbox-live-metric-total">
                <span>全部</span>
                <strong>{summary?.totalUsers ?? '-'}</strong>
              </span>
              <span className="sandbox-live-metric sandbox-live-metric-running">
                <span>7天活跃</span>
                <strong>{summary?.activeUsers7d ?? '-'}</strong>
              </span>
              <span className="sandbox-live-metric user-management-live-metric-disabled">
                <span>已禁用</span>
                <strong>{summary?.disabledUsers ?? '-'}</strong>
              </span>
              <span className="sandbox-live-age" title={formatDateTime(summaryFetchedAt)}>
                {summaryAge}
              </span>
              <button
                type="button"
                className={`sandbox-live-refresh-btn ${summaryRefreshing ? 'is-refreshing' : ''}`}
                onClick={() => void handleSummaryRefresh()}
                disabled={summaryRefreshing || loading}
                aria-label="刷新用户列表"
              >
                ↻
              </button>
            </section>
          </div>
        </section>

        <section className="sub-panel user-management-filter-panel">
          <div className="user-management-filter-head">
            <div>
              <p className="section-tag">筛选</p>
            </div>
            <span className="panel-caption">当前 {users.length} 条</span>
          </div>
          <div className="user-management-filter-grid">
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
              <span>登录状态</span>
              <select value={filters.hasSession} onChange={(event) => setFilters((current) => ({ ...current, hasSession: event.target.value }))}>
                <option value="all">全部</option>
                <option value="yes">已登录</option>
                <option value="no">未登录</option>
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
            <div className="user-management-filter-actions">
              <button type="button" className="secondary-btn" onClick={handleResetFilters} disabled={loading}>
                重置筛选
              </button>
            </div>
          </div>
        </section>

        <section className="sub-panel user-management-list-panel">
          <div className="user-management-list-head">
            <div>
              <p className="section-tag">索引</p>
              <p className="panel-caption">按 {currentSortLabel}{sortDirectionLabel(sort.direction)}</p>
            </div>
          </div>

          <div className="table-wrap user-management-table-wrap" aria-live="polite">
            <table className="user-management-table">
              <colgroup>
                <col style={{ width: '26%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '18%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '8%' }} />
              </colgroup>
              <thead>
                <tr>
                  {SORT_OPTIONS.map((option) => (
                    <th key={option.key}>
                      <button
                        type="button"
                        className={`runtime-sort-btn ${sort.key === option.key ? 'active' : ''}`}
                        onClick={() => handleSortToggle(option.key)}
                      >
                        {option.label}
                        <span className="runtime-sort-indicator">
                          {sort.key === option.key ? (sort.direction === 'asc' ? '▲' : '▼') : '↕'}
                        </span>
                      </button>
                    </th>
                  ))}
                  <th className="runtime-col-actions">
                    <span className="runtime-th-label">操作</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="empty">正在加载用户列表...</td>
                  </tr>
                ) : null}
                {!loading && users.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="empty">当前筛选条件下没有匹配用户</td>
                  </tr>
                ) : null}
                {!loading
                  ? users.map((item) => {
                      const isSelected = selectedUserId === item.id;
                      return (
                        <tr
                          key={item.id}
                          className={isSelected ? 'selected-row' : ''}
                          aria-selected={isSelected}
                        >
                          <td>
                            <div className="user-management-table-user">
                              <div className="user-management-table-user-head">
                                <button
                                  type="button"
                                  className="management-title-link user-management-name-link"
                                  onClick={() => void openDetail(item.id)}
                                >
                                  {item.displayName}
                                </button>
                              </div>
                              <p>{item.email}</p>
                              <small title={item.id}>{truncateMiddle(item.id, 10, 8)}</small>
                            </div>
                          </td>
                          <td>
                            <div className="user-management-table-cell-stack">
                              <span className={`state-chip ${item.status === 'active' ? 'status-running' : 'status-error'}`}>
                                {userStatusLabel(item.status)}
                              </span>
                              <small>{item.status === 'active' ? '账号可用' : '账号已禁用'}</small>
                            </div>
                          </td>
                          <td>
                            <div className="user-management-table-cell-stack">
                              <strong>{formatDateTime(item.lastLoginAt)}</strong>
                              <small>IP {item.latestSession?.ipAddress || '-'}</small>
                            </div>
                          </td>
                          <td>
                            <div className="user-management-table-cell-stack">
                              <span className={`state-chip ${loginStatusTone(item)}`}>
                                {loginStatusLabel(item)}
                              </span>
                              <small>{loginStatusSummary(item)}</small>
                            </div>
                          </td>
                          <td>
                            <div className="user-management-table-cell-stack user-management-table-metric">
                              <strong>{item.conversationCount}</strong>
                              <small>{activitySummary(item.lastConversationAt, '暂无对话')}</small>
                            </div>
                          </td>
                          <td>
                            <div className="user-management-table-cell-stack user-management-table-metric">
                              <strong>{item.sandboxCount}</strong>
                              <small>{activitySummary(item.lastSandboxAt, '暂无 Sandbox')}</small>
                            </div>
                          </td>
                          <td>
                            <div className="user-management-table-actions">
                              <button
                                type="button"
                                className="table-btn"
                                onClick={() => {
                                  void openDetail(item.id);
                                }}
                              >
                                查看详情
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  : null}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {drawerOpen ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setDrawerOpen(false)}>
          <aside
            className="modal-card user-management-modal"
            aria-labelledby="user-management-detail-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header user-management-modal-header">
              <div className="user-management-modal-heading">
                <p className="section-tag">用户详情</p>
                <h2 id="user-management-detail-title">{detailUser?.displayName || '用户详情'}</h2>
                <p className="panel-caption">{detailUser?.email || selectedUserId || '-'}</p>
              </div>
              <div className="user-management-modal-actions">
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
                <button type="button" className="icon-btn" aria-label="关闭用户详情" onClick={() => setDrawerOpen(false)}>
                  <span aria-hidden="true">×</span>
                </button>
              </div>
            </div>

            <div className="user-management-tab-strip">
              {([
                ['overview', '概览'],
                ['billing', '积分'],
                ['conversations', '对话'],
                ['sandboxes', 'Sandbox'],
                ['deployments', '部署'],
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

            <div className="modal-body user-management-modal-body">
              {detailLoading ? <p className="user-management-empty">正在加载用户详情...</p> : null}
              {!detailLoading && detail && detailTab === 'overview' ? (
                <div className="user-management-overview-layout">
                  <article className="sub-panel user-management-detail-card user-management-overview-summary">
                    <div className="user-management-overview-top">
                      <div>
                        <p className="section-tag">账号摘要</p>
                        <p className="panel-caption user-management-overview-copy">聚焦当前状态、登录与最近访问。</p>
                      </div>
                      <div>
                        <div className="user-management-overview-badges">
                          <span className={`state-chip ${detail.user?.status === 'active' ? 'status-running' : 'status-error'}`}>
                            {userStatusLabel(detail.user?.status)}
                          </span>
                          <span className={`state-chip ${loginStatusTone({ activeSessionCount: detail.stats.activeSessionCount, lastLoginAt: detail.user?.lastLoginAt })}`}>
                            {loginStatusLabel({ activeSessionCount: detail.stats.activeSessionCount, lastLoginAt: detail.user?.lastLoginAt })}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="user-management-overview-stat-strip">
                      <article className="user-management-overview-stat">
                        <span>当前登录</span>
                        <strong>{detail.stats.activeSessionCount ?? 0}</strong>
                        <small>{loginStatusSummary({ activeSessionCount: detail.stats.activeSessionCount, lastLoginAt: detail.user?.lastLoginAt })}</small>
                      </article>
                      <article className="user-management-overview-stat">
                        <span>上次登录</span>
                        <strong>{formatDateTime(detail.user?.lastLoginAt)}</strong>
                        <small>账号最近登录时间</small>
                      </article>
                      <article className="user-management-overview-stat">
                        <span>最近访问</span>
                        <strong>{formatDateTime(latestSessionRecord?.lastSeenAt)}</strong>
                        <small>最近一次访问记录</small>
                      </article>
                    </div>

                    <dl className="user-management-overview-facts">
                      <div>
                        <dt>用户 ID</dt>
                        <dd className="mono">{detail.user?.id || '-'}</dd>
                      </div>
                      <div>
                        <dt>最近来源 IP</dt>
                        <dd className="mono">{latestSessionRecord?.ipAddress || '-'}</dd>
                      </div>
                      <div>
                        <dt>账号状态</dt>
                        <dd>{userStatusLabel(detail.user?.status)}</dd>
                      </div>
                      <div>
                        <dt>登录状态</dt>
                        <dd>{loginStatusLabel({ activeSessionCount: detail.stats.activeSessionCount, lastLoginAt: detail.user?.lastLoginAt })}</dd>
                      </div>
                    </dl>
                    {detail.revokedSessionCount ? (
                      <p className="panel-caption user-management-overview-note">最近一次操作已让 {detail.revokedSessionCount} 个登录失效。</p>
                    ) : (
                      <p className="panel-caption user-management-overview-note">
                        {loginStatusHint({ activeSessionCount: detail.stats.activeSessionCount, lastLoginAt: detail.user?.lastLoginAt })}
                      </p>
                    )}

                    <div className="user-management-overview-login-compact">
                      <div className="user-management-overview-login-head">
                        <div>
                          <p className="section-tag">登录摘要</p>
                          <p className="panel-caption">最近登录与访问信息已合并到账号摘要。</p>
                        </div>
                        <span className="user-management-overview-record-count">最近 {detail.recentSessions.length} 条</span>
                      </div>
                      {recentSessions.length > 0 ? (
                        <div className="user-management-overview-login-list">
                          {recentSessions.map((item) => {
                            const isOnline = Boolean(item.isOnline && !item.revokedAt);

                            return (
                              <article key={item.id} className="user-management-overview-login-item">
                                <div className="user-management-overview-login-row">
                                  <div className="user-management-overview-login-main">
                                    <strong>{sessionStateLabel(item)}</strong>
                                    <span>{formatDateTime(item.lastSeenAt)}</span>
                                  </div>
                                  <span className={`state-chip ${isOnline ? 'status-running' : 'status-stopped'}`}>
                                    {isOnline ? '在线' : '离线'}
                                  </span>
                                </div>
                                <div className="user-management-overview-login-meta">
                                  <span className="mono">{truncateMiddle(item.id, 8, 6)}</span>
                                  <span>{item.ipAddress || '-'}</span>
                                  <span>过期 {formatDateTime(item.expiresAt)}</span>
                                </div>
                                <p className="user-management-record-note">{compactUserAgent(item.userAgent)}</p>
                              </article>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="user-management-empty user-management-overview-inline-empty">当前用户暂无登录记录</p>
                      )}
                    </div>
                  </article>
                </div>
              ) : null}

              {!detailLoading && detail && detailTab === 'conversations'
                ? (detail.recentConversations.length > 0
                    ? detail.recentConversations.map((item) => (
                        <ConversationItem
                          key={item.id}
                          item={item}
                          onOpenConversation={
                            onOpenConversation && detailJumpOrigin
                              ? (conversation) => onOpenConversation(conversation.id, detailJumpOrigin)
                              : undefined
                          }
                        />
                      ))
                    : <DetailListEmpty title="当前用户暂无对话记录" />)
                : null}

              {!detailLoading && detail && detailTab === 'billing' ? (
                billingLoading ? (
                  <DetailListEmpty title="正在加载计费详情..." />
                ) : billingDetail ? (
                  <div className="user-management-overview-layout">
                    <article className="sub-panel user-management-detail-card user-management-overview-summary">
                      <div className="user-management-overview-top">
                        <div>
                          <p className="section-tag">积分摘要</p>
                          <p className="panel-caption user-management-overview-copy">用户余额、session 使用明细与积分获取历史。</p>
                        </div>
                      </div>
                      <div className="user-management-overview-stat-strip">
                        <article className="user-management-overview-stat">
                          <span>当前余额</span>
                          <strong>{billingDetail.credits.balance.toLocaleString()}</strong>
                          <small>credits</small>
                        </article>
                        <article className="user-management-overview-stat">
                          <span>累计获得</span>
                          <strong>{billingDetail.credits.totalEarned.toLocaleString()}</strong>
                          <small>{formatDateTime(billingDetail.credits.lastRechargeAt)}</small>
                        </article>
                        <article className="user-management-overview-stat">
                          <span>累计消费</span>
                          <strong>{billingDetail.credits.totalConsumed.toLocaleString()}</strong>
                          <small>{billingDetail.usageRecords.total} 个消费会话</small>
                        </article>
                      </div>
                    </article>

                    <article className="sub-panel user-management-detail-card">
                      <div className="user-management-overview-login-head">
                        <div>
                          <p className="section-tag">使用明细</p>
                          <p className="panel-caption">按 session 聚合展示，不在用户侧暴露模型信息。</p>
                        </div>
                        <span className="user-management-overview-record-count">共 {billingDetail.usageRecords.total} 个 session</span>
                      </div>
                      {billingDetail.usageRecords.items.length > 0 ? (
                        <div className="user-management-overview-login-list">
                          {billingDetail.usageRecords.items.map((item) => (
                            <article key={item.id} className="user-management-overview-login-item">
                              <div className="user-management-overview-login-row">
                                <button
                                  type="button"
                                  className="record-title-link"
                                  onClick={() => {
                                    if (onOpenConversation && detailJumpOrigin) onOpenConversation(item.sessionId, detailJumpOrigin);
                                  }}
                                >
                                  {item.sessionTitle || '未命名会话'}
                                </button>
                                <span className="state-chip status-paused">-{item.totalCredits.toLocaleString()} credits</span>
                              </div>
                              <div className="user-management-overview-login-meta">
                                <span className="mono">{truncateMiddle(item.sessionId, 10, 8)}</span>
                                <span>{item.totalTokens.toLocaleString()} tokens</span>
                                <span>{item.callCount} 次调用</span>
                                <span>{formatDateTime(item.lastUsedAt)}</span>
                              </div>
                            </article>
                          ))}
                        </div>
                      ) : (
                        <DetailListEmpty title="当前用户暂无积分使用记录" />
                      )}
                    </article>

                    <article className="sub-panel user-management-detail-card">
                      <div className="user-management-overview-login-head">
                        <div>
                          <p className="section-tag">获取历史</p>
                          <p className="panel-caption">充值、活动赠送、后台调整等积分入账记录。</p>
                        </div>
                        <span className="user-management-overview-record-count">共 {billingDetail.acquisitionHistory.total} 条</span>
                      </div>
                      {billingDetail.acquisitionHistory.items.length > 0 ? (
                        <div className="user-management-overview-login-list">
                          {billingDetail.acquisitionHistory.items.map((item) => (
                            <article key={item.id} className="user-management-overview-login-item">
                              <div className="user-management-overview-login-row">
                                <strong>{item.description || (item.type === 'recharge' ? '积分充值' : '积分入账')}</strong>
                                <span className="state-chip status-running">+{item.amount.toLocaleString()} credits</span>
                              </div>
                              <div className="user-management-overview-login-meta">
                                <span>{formatDateTime(item.createdAt)}</span>
                                <span>入账后余额 {item.balanceAfter.toLocaleString()}</span>
                                <span>{item.type}</span>
                              </div>
                            </article>
                          ))}
                        </div>
                      ) : (
                        <DetailListEmpty title="当前用户暂无积分获取记录" />
                      )}
                    </article>
                  </div>
                ) : (
                  <DetailListEmpty title="用户计费详情加载失败" />
                )
              ) : null}

              {!detailLoading && detail && detailTab === 'sandboxes'
                ? (detail.recentSandboxes.length > 0
                    ? detail.recentSandboxes.map((item) => (
                        <SandboxItem
                          key={item.sandboxId}
                          item={item}
                          onOpenSandbox={
                            onOpenSandbox && detailJumpOrigin
                              ? (sandbox) => onOpenSandbox(sandbox.sandboxId, detailJumpOrigin)
                              : undefined
                          }
                        />
                      ))
                    : <DetailListEmpty title="当前用户暂无 Sandbox 记录" />)
                : null}

              {!detailLoading && detail && detailTab === 'deployments'
                ? (deploymentLoading
                    ? <DetailListEmpty title="正在加载部署记录..." />
                    : deploymentRecords.length > 0
                      ? deploymentRecords.map((item) => (
                          <DeploymentItem
                            key={`${item.taskSessionId}-${item.deploymentId || item.updatedAt}`}
                            item={item}
                            onOpenDeployment={
                              onOpenDeployment && detailJumpOrigin
                                ? (record) => onOpenDeployment(record.taskSessionId, detailJumpOrigin)
                                : undefined
                            }
                          />
                        ))
                      : <DetailListEmpty title="当前用户暂无部署记录" />)
                : null}
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
