import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import type {
  DeploymentManagementListResponse,
  DeploymentManagementOverview,
  DeploymentRecord,
  DeploymentUserListResponse,
  RailwayBatchActionResponse,
  RailwayServiceItem,
  RailwayServiceListResponse,
} from '../types';
import {
  DEFAULT_DEPLOYMENT_MANAGEMENT_FILTERS,
  DEFAULT_DEPLOYMENT_MANAGEMENT_VIEW_STATE,
} from './adminViewState';
import type {
  DeploymentManagementDetailTab,
  DeploymentManagementViewKey,
  DeploymentManagementViewState,
} from './adminViewState';

type DeploymentJumpOrigin = {
  section: 'deployment';
  trail: string;
};

type RailwayDialogMode = 'configure' | 'variables' | 'delete' | null;

type Props = {
  onError: (message: string | null) => void;
  onUpdatedAtChange?: (value: string | null) => void;
  onRegisterRefresh?: (handler: (() => Promise<void>) | null) => void;
  persistedState?: DeploymentManagementViewState | null;
  onStateChange?: (state: DeploymentManagementViewState) => void;
  onOpenConversation?: (sessionId: string, origin?: DeploymentJumpOrigin) => void;
  onOpenUser?: (userId: string, origin?: DeploymentJumpOrigin) => void;
  onOpenSandbox?: (sandboxId: string, origin?: DeploymentJumpOrigin) => void;
};

const LIST_LIMIT = 120;

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

function deploymentStatusLabel(value?: string | null) {
  if (value === 'success') return '成功';
  if (value === 'failed') return '失败';
  if (value === 'pending') return '处理中';
  if (value === 'ready') return '已就绪';
  if (value === 'uninitialized') return '未初始化';
  return value || '-';
}

function deploymentStatusTone(value?: string | null) {
  if (value === 'success' || value === 'ready') return 'status-running';
  if (value === 'failed') return 'status-error';
  if (value === 'pending') return 'status-paused';
  return 'status-stopped';
}

function railwayStatusCategory(value?: string | null) {
  const normalized = `${value || ''}`.trim().toUpperCase();
  if (!normalized) return 'unknown';
  if (normalized.includes('FAIL') || normalized.includes('ERROR') || normalized.includes('CRASH') || normalized.includes('CANCEL')) {
    return 'failed';
  }
  if (normalized.includes('SUCCESS') || normalized.includes('ACTIVE') || normalized.includes('READY') || normalized.includes('LIVE')) {
    return 'success';
  }
  if (normalized.includes('BUILD') || normalized.includes('QUEUED') || normalized.includes('DEPLOY') || normalized.includes('PROGRESS')) {
    return 'pending';
  }
  return 'unknown';
}

function railwayStatusLabel(value?: string | null) {
  const category = railwayStatusCategory(value);
  if (category === 'success') return '成功';
  if (category === 'failed') return '失败';
  if (category === 'pending') return '处理中';
  return value || '-';
}

function sessionStatusLabel(value?: string | null) {
  if (value === 'in_progress') return '进行中';
  if (value === 'waiting_user') return '待确认';
  if (value === 'completed') return '已完成';
  if (value === 'failed') return '失败';
  return value || '-';
}

function truncateMiddle(value: string, head = 10, tail = 8) {
  if (!value) return '-';
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

function asExternalUrl(record: { latestUrl?: string | null; latestStaticUrl?: string | null }) {
  return record.latestUrl || record.latestStaticUrl || null;
}

function formatExternalLinkLabel(value?: string | null) {
  if (!value) return '-';
  return value.replace(/^https?:\/\//, '');
}

function buildQuery(filters: DeploymentManagementViewState['filters']) {
  return {
    limit: LIST_LIMIT,
    query: filters.query || undefined,
    status: filters.status !== 'all' ? filters.status : undefined,
    hasUrl: filters.hasUrl !== 'all' ? filters.hasUrl : undefined,
    userId: filters.userId || undefined,
    taskSessionId: filters.taskSessionId || undefined,
  };
}

function detailTrail(label: string) {
  return {
    section: 'deployment' as const,
    trail: `部署管理 / ${label}`,
  };
}

function DetailEmpty({ title }: { title: string }) {
  return <p className="user-management-empty">{title}</p>;
}

function buildRailwayResultMessage(actionLabel: string, result: RailwayBatchActionResponse) {
  return `${actionLabel}完成：成功 ${result.successCount}，失败 ${result.failureCount}，共 ${result.total} 项`;
}

export function DeploymentManagementSection({
  onError,
  onUpdatedAtChange,
  onRegisterRefresh,
  persistedState,
  onStateChange,
  onOpenConversation,
  onOpenUser,
  onOpenSandbox,
}: Props) {
  const initialState = persistedState || DEFAULT_DEPLOYMENT_MANAGEMENT_VIEW_STATE;
  const [view, setView] = useState<DeploymentManagementViewKey>(initialState.view);
  const [filters, setFilters] = useState(initialState.filters);
  const [overview, setOverview] = useState<DeploymentManagementOverview | null>(null);
  const [recordsResponse, setRecordsResponse] = useState<DeploymentManagementListResponse | null>(null);
  const [conversationResponse, setConversationResponse] = useState<DeploymentManagementListResponse | null>(null);
  const [userResponse, setUserResponse] = useState<DeploymentUserListResponse | null>(null);
  const [railwayResponse, setRailwayResponse] = useState<RailwayServiceListResponse | null>(null);
  const [selectedRailwayKeys, setSelectedRailwayKeys] = useState<string[]>([]);
  const [railwayDialogMode, setRailwayDialogMode] = useState<RailwayDialogMode>(null);
  const [railwayBusy, setRailwayBusy] = useState(false);
  const [railwayActionMessage, setRailwayActionMessage] = useState<string | null>(null);
  const [railwayPatchDraft, setRailwayPatchDraft] = useState({
    builder: '',
    buildCommand: '',
    startCommand: '',
    rootDirectory: '',
    healthcheckPath: '',
    sourceImage: '',
  });
  const [railwayVariablesDraft, setRailwayVariablesDraft] = useState('{\n  "NODE_ENV": "production"\n}');
  const [railwayVariablesReplace, setRailwayVariablesReplace] = useState(false);
  const [railwayDeleteConfirm, setRailwayDeleteConfirm] = useState('');
  const [selectedTaskSessionId, setSelectedTaskSessionId] = useState<string | null>(initialState.selectedTaskSessionId);
  const [detailDialogOpen, setDetailDialogOpen] = useState(initialState.detailDialogOpen);
  const [detailTab, setDetailTab] = useState<DeploymentManagementDetailTab>(initialState.detailTab);
  const [detail, setDetail] = useState<DeploymentRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [summaryRefreshing, setSummaryRefreshing] = useState(false);
  const [summaryFetchedAt, setSummaryFetchedAt] = useState<string | null>(null);
  const [summaryClock, setSummaryClock] = useState(() => Date.now());
  const requestVersionRef = useRef(0);

  const activeRecords = useMemo(() => {
    if (view === 'records') return recordsResponse?.records || [];
    if (view === 'conversations') return conversationResponse?.records || [];
    return [];
  }, [conversationResponse?.records, recordsResponse?.records, view]);

  const selectedRailwayItems = useMemo(() => {
    const keySet = new Set(selectedRailwayKeys);
    return (railwayResponse?.items || []).filter((item) => keySet.has(item.key));
  }, [railwayResponse?.items, selectedRailwayKeys]);

  const currentItemCount = view === 'users'
    ? userResponse?.items.length || 0
    : view === 'railway'
      ? railwayResponse?.items.length || 0
      : activeRecords.length;

  useEffect(() => {
    onStateChange?.({
      view,
      filters,
      selectedTaskSessionId,
      detailDialogOpen,
      detailTab,
    });
  }, [detailDialogOpen, detailTab, filters, onStateChange, selectedTaskSessionId, view]);

  const loadOverview = useCallback(async (nextFilters = filters) => {
    const result = await api.getDeploymentOverview(buildQuery(nextFilters));
    setOverview(result);
    const fetchedAt = result.summary.latestUpdatedAt || new Date().toISOString();
    setSummaryFetchedAt(fetchedAt);
    setSummaryClock(Date.now());
    onUpdatedAtChange?.(fetchedAt);
  }, [filters, onUpdatedAtChange]);

  const loadActiveView = useCallback(async (nextView = view, nextFilters = filters) => {
    const requestVersion = ++requestVersionRef.current;
    setLoading(true);
    try {
      if (nextView === 'records') {
        const next = await api.listDeploymentRecords(buildQuery(nextFilters));
        if (requestVersion !== requestVersionRef.current) return;
        setRecordsResponse(next);
        setRailwayActionMessage(null);
      } else if (nextView === 'conversations') {
        const next = await api.listDeploymentConversations(buildQuery(nextFilters));
        if (requestVersion !== requestVersionRef.current) return;
        setConversationResponse({
          records: next.items,
          total: next.total,
        });
        setRailwayActionMessage(null);
      } else if (nextView === 'users') {
        const next = await api.listDeploymentUsers({
          limit: LIST_LIMIT,
          query: nextFilters.query || undefined,
          status: nextFilters.status !== 'all' ? nextFilters.status : undefined,
          hasUrl: nextFilters.hasUrl !== 'all' ? nextFilters.hasUrl : undefined,
          userId: nextFilters.userId || undefined,
        });
        if (requestVersion !== requestVersionRef.current) return;
        setUserResponse(next);
        setRailwayActionMessage(null);
      } else {
        const next = await api.listRailwayServices({
          limit: LIST_LIMIT,
          query: nextFilters.query || undefined,
          status: nextFilters.status !== 'all' ? nextFilters.status : undefined,
        });
        if (requestVersion !== requestVersionRef.current) return;
        setRailwayResponse(next);
        const fetchedAt = next.summary.updatedAt || new Date().toISOString();
        setSummaryFetchedAt(fetchedAt);
        setSummaryClock(Date.now());
        onUpdatedAtChange?.(fetchedAt);
      }
      onError(null);
    } catch (error) {
      if (requestVersion !== requestVersionRef.current) return;
      onError(error instanceof Error ? error.message : '部署列表加载失败');
    } finally {
      if (requestVersion === requestVersionRef.current) {
        setLoading(false);
      }
    }
  }, [filters, onError, onUpdatedAtChange, view]);

  const loadDetail = useCallback(async (taskSessionId: string) => {
    setDetailLoading(true);
    try {
      const next = await api.getDeploymentDetail(taskSessionId);
      setDetail(next);
      onError(null);
      return next;
    } catch (error) {
      onError(error instanceof Error ? error.message : '部署详情加载失败');
      return null;
    } finally {
      setDetailLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    if (view === 'railway') {
      void loadActiveView(view, filters);
      return;
    }
    void loadOverview(filters);
    void loadActiveView(view, filters);
  }, [filters, loadActiveView, loadOverview, view]);

  useEffect(() => {
    if (!detailDialogOpen || !selectedTaskSessionId) return;
    if (detail?.taskSessionId === selectedTaskSessionId) return;
    void loadDetail(selectedTaskSessionId);
  }, [detail?.taskSessionId, detailDialogOpen, loadDetail, selectedTaskSessionId]);

  useEffect(() => {
    if (!summaryFetchedAt) return;
    const timer = window.setInterval(() => setSummaryClock(Date.now()), 10000);
    return () => window.clearInterval(timer);
  }, [summaryFetchedAt]);

  useEffect(() => {
    if (view !== 'railway') {
      setSelectedRailwayKeys([]);
      setRailwayDialogMode(null);
      return;
    }
    const availableKeys = new Set((railwayResponse?.items || []).map((item) => item.key));
    setSelectedRailwayKeys((current) => current.filter((item) => availableKeys.has(item)));
  }, [railwayResponse?.items, view]);

  const handleExternalRefresh = useCallback(async () => {
    if (view === 'railway') {
      await loadActiveView(view, filters);
    } else {
      await loadOverview(filters);
      await loadActiveView(view, filters);
    }
    if (detailDialogOpen && selectedTaskSessionId) {
      await loadDetail(selectedTaskSessionId);
    }
  }, [detailDialogOpen, filters, loadActiveView, loadDetail, loadOverview, selectedTaskSessionId, view]);

  useEffect(() => {
    onRegisterRefresh?.(handleExternalRefresh);
    return () => onRegisterRefresh?.(null);
  }, [handleExternalRefresh, onRegisterRefresh]);

  const handleSummaryRefresh = useCallback(async () => {
    setSummaryRefreshing(true);
    try {
      await handleExternalRefresh();
    } finally {
      setSummaryRefreshing(false);
    }
  }, [handleExternalRefresh]);

  const openDetail = useCallback((taskSessionId: string, tab: DeploymentManagementDetailTab = 'overview') => {
    setSelectedTaskSessionId(taskSessionId);
    setDetail(null);
    setDetailTab(tab);
    setDetailDialogOpen(true);
  }, []);

  const resetFilters = useCallback(() => {
    setFilters(DEFAULT_DEPLOYMENT_MANAGEMENT_FILTERS);
  }, []);

  const closeRailwayDialog = useCallback(() => {
    if (railwayBusy) return;
    setRailwayDialogMode(null);
  }, [railwayBusy]);

  const toggleRailwayKey = useCallback((key: string) => {
    setSelectedRailwayKeys((current) => (
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key]
    ));
  }, []);

  const toggleRailwayAll = useCallback(() => {
    const items = railwayResponse?.items || [];
    if (items.length === 0) return;
    setSelectedRailwayKeys((current) => {
      if (current.length === items.length) return [];
      return items.map((item) => item.key);
    });
  }, [railwayResponse?.items]);

  const submitRailwayConfigure = useCallback(async () => {
    if (selectedRailwayKeys.length === 0) {
      onError('请先选择 Railway 服务');
      return;
    }
    setRailwayBusy(true);
    try {
      const result = await api.batchConfigureRailwayServices(selectedRailwayKeys, {
        builder: railwayPatchDraft.builder.trim() || undefined,
        buildCommand: railwayPatchDraft.buildCommand,
        startCommand: railwayPatchDraft.startCommand,
        rootDirectory: railwayPatchDraft.rootDirectory,
        healthcheckPath: railwayPatchDraft.healthcheckPath,
        sourceImage: railwayPatchDraft.sourceImage.trim() || undefined,
      });
      setRailwayActionMessage(buildRailwayResultMessage('批量变更服务配置', result));
      setRailwayDialogMode(null);
      await loadActiveView('railway', filters);
      onError(null);
    } catch (error) {
      onError(error instanceof Error ? error.message : '批量变更服务配置失败');
    } finally {
      setRailwayBusy(false);
    }
  }, [filters, loadActiveView, onError, railwayPatchDraft, selectedRailwayKeys]);

  const submitRailwayVariables = useCallback(async () => {
    if (selectedRailwayKeys.length === 0) {
      onError('请先选择 Railway 服务');
      return;
    }
    let parsedVariables: Record<string, string> = {};
    try {
      const parsed = JSON.parse(railwayVariablesDraft) as Record<string, unknown>;
      parsedVariables = Object.fromEntries(
        Object.entries(parsed || {})
          .map(([key, value]) => [String(key).trim(), String(value ?? '').trim()])
          .filter(([key, value]) => key && value)
      );
      if (Object.keys(parsedVariables).length === 0) {
        throw new Error('变量不能为空');
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : '变量 JSON 解析失败');
      return;
    }

    setRailwayBusy(true);
    try {
      const result = await api.batchUpsertRailwayServiceVariables(
        selectedRailwayKeys,
        parsedVariables,
        railwayVariablesReplace,
      );
      setRailwayActionMessage(buildRailwayResultMessage('批量更新服务变量', result));
      setRailwayDialogMode(null);
      await loadActiveView('railway', filters);
      onError(null);
    } catch (error) {
      onError(error instanceof Error ? error.message : '批量更新服务变量失败');
    } finally {
      setRailwayBusy(false);
    }
  }, [filters, loadActiveView, onError, railwayVariablesDraft, railwayVariablesReplace, selectedRailwayKeys]);

  const submitRailwayDelete = useCallback(async () => {
    if (selectedRailwayKeys.length === 0) {
      onError('请先选择 Railway 服务');
      return;
    }
    if (railwayDeleteConfirm.trim().toUpperCase() !== 'DELETE') {
      onError('请输入 DELETE 以确认删除');
      return;
    }
    setRailwayBusy(true);
    try {
      const result = await api.batchDeleteRailwayServices(selectedRailwayKeys);
      setRailwayActionMessage(buildRailwayResultMessage('批量删除服务', result));
      setSelectedRailwayKeys([]);
      setRailwayDialogMode(null);
      setRailwayDeleteConfirm('');
      await loadActiveView('railway', filters);
      onError(null);
    } catch (error) {
      onError(error instanceof Error ? error.message : '批量删除 Railway 服务失败');
    } finally {
      setRailwayBusy(false);
    }
  }, [filters, loadActiveView, onError, railwayDeleteConfirm, selectedRailwayKeys]);

  const summaryAge = formatCompactRelativeTime(summaryFetchedAt, summaryClock);
  const detailTitle = detail?.session.title || selectedTaskSessionId || '部署详情';
  const detailOrigin = detail
    ? detailTrail(detail.session.title || detail.taskSessionId)
    : null;
  const allRailwaySelected = (railwayResponse?.items.length || 0) > 0 && selectedRailwayKeys.length === (railwayResponse?.items.length || 0);

  return (
    <>
      <main className="content-stack viewport-lock-page deployment-management-page">
        <section className="user-management-hero">
          <div className="user-management-hero-copy">
            <p className="section-tag">Runtime</p>
            <h2>部署管理</h2>
          </div>
          <div className="sandbox-list-header-actions user-management-hero-actions">
            <section className="user-management-summary-strip user-management-live-summary session-status sandbox-live-count" aria-label="部署管理摘要">
              {view === 'railway' ? (
                <>
                  <span className="sandbox-live-metric sandbox-live-metric-total">
                    <span>Railway 服务</span>
                    <strong>{railwayResponse?.summary.total ?? '-'}</strong>
                  </span>
                  <span className="sandbox-live-metric sandbox-live-metric-running">
                    <span>有域名</span>
                    <strong>{railwayResponse?.summary.withDomain ?? '-'}</strong>
                  </span>
                  <span className="sandbox-live-metric user-management-live-metric-disabled">
                    <span>失败</span>
                    <strong>{railwayResponse?.summary.failed ?? '-'}</strong>
                  </span>
                  <span className="sandbox-live-metric">
                    <span>风险</span>
                    <strong>{railwayResponse?.summary.risky ?? '-'}</strong>
                  </span>
                </>
              ) : (
                <>
                  <span className="sandbox-live-metric sandbox-live-metric-total">
                    <span>部署记录</span>
                    <strong>{overview?.summary.total ?? '-'}</strong>
                  </span>
                  <span className="sandbox-live-metric sandbox-live-metric-running">
                    <span>成功</span>
                    <strong>{overview?.summary.success ?? '-'}</strong>
                  </span>
                  <span className="sandbox-live-metric user-management-live-metric-disabled">
                    <span>失败</span>
                    <strong>{overview?.summary.failed ?? '-'}</strong>
                  </span>
                  <span className="sandbox-live-metric">
                    <span>待处理</span>
                    <strong>{overview?.summary.pending ?? '-'}</strong>
                  </span>
                </>
              )}
              <span className="sandbox-live-age" title={formatDateTime(summaryFetchedAt)}>
                {summaryAge}
              </span>
              <button
                type="button"
                className={`sandbox-live-refresh-btn ${summaryRefreshing ? 'is-refreshing' : ''}`}
                onClick={() => void handleSummaryRefresh()}
                disabled={summaryRefreshing || loading || railwayBusy}
                aria-label="刷新部署管理"
              >
                ↻
              </button>
            </section>
          </div>
        </section>

        <div className="skill-secondary-menu" role="tablist" aria-label="部署管理视图切换">
          {([
            ['records', '部署索引'],
            ['conversations', '对话视图'],
            ['users', '用户视图'],
            ['railway', 'Railway 视图'],
          ] as Array<[DeploymentManagementViewKey, string]>).map(([key, label]) => (
            <button key={key} type="button" className={view === key ? 'active' : ''} onClick={() => setView(key)}>
              <strong>{label}</strong>
            </button>
          ))}
        </div>

        <section className="sub-panel user-management-filter-panel">
          <div className="user-management-filter-head">
            <div>
              <p className="section-tag">筛选</p>
            </div>
            <span className="panel-caption">当前 {currentItemCount} 条</span>
          </div>
          <div className="runtime-filter-grid deployment-filter-grid">
            <label>
              <span>检索</span>
              <input
                value={filters.query}
                onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
                placeholder={view === 'railway' ? '服务 / 项目 / 域名 / 用户' : '会话 / 用户 / 项目 / URL'}
              />
            </label>
            <label>
              <span>状态</span>
              <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
                <option value="all">全部</option>
                <option value="success">成功</option>
                <option value="failed">失败</option>
                <option value="pending">处理中</option>
                {view !== 'railway' ? <option value="ready">已就绪</option> : null}
              </select>
            </label>
            {view !== 'railway' ? (
              <>
                <label>
                  <span>访问地址</span>
                  <select value={filters.hasUrl} onChange={(event) => setFilters((current) => ({ ...current, hasUrl: event.target.value }))}>
                    <option value="all">全部</option>
                    <option value="yes">已有 URL</option>
                    <option value="no">无 URL</option>
                  </select>
                </label>
                <label>
                  <span>用户 ID</span>
                  <input
                    value={filters.userId}
                    onChange={(event) => setFilters((current) => ({ ...current, userId: event.target.value }))}
                    placeholder="app_user id"
                  />
                </label>
                <label>
                  <span>会话 ID</span>
                  <input
                    value={filters.taskSessionId}
                    onChange={(event) => setFilters((current) => ({ ...current, taskSessionId: event.target.value }))}
                    placeholder="task session id"
                  />
                </label>
              </>
            ) : null}
            <div className="user-management-filter-actions">
              <button type="button" className="secondary-btn" onClick={resetFilters} disabled={loading || railwayBusy}>
                重置筛选
              </button>
            </div>
          </div>
        </section>

        <section className="sub-panel user-management-list-panel">
          <div className="user-management-list-head">
            <div>
              <p className="section-tag">
                {view === 'records'
                  ? '部署索引'
                  : view === 'conversations'
                    ? '部署对话'
                    : view === 'users'
                      ? '部署用户'
                      : 'Railway 服务'}
              </p>
              <p className="panel-caption">
                {view === 'railway'
                  ? '仅展示已接入管理链路的 Railway 部署服务'
                  : '仅展示已有部署记录或部署状态信号的对象'}
              </p>
            </div>
          </div>

          {view === 'railway' ? (
            <div className="deployment-railway-stack">
              <div className="deployment-railway-toolbar">
                <label className="checkbox-row">
                  <input type="checkbox" checked={allRailwaySelected} onChange={toggleRailwayAll} />
                  <span>全选当前列表</span>
                </label>
                <div className="deployment-railway-toolbar-copy">
                  <strong>已选 {selectedRailwayKeys.length} 项</strong>
                  <span>{railwayActionMessage || '可批量变更服务配置、变量，或直接删除服务'}</span>
                </div>
                <div className="user-management-filter-actions deployment-railway-toolbar-actions">
                  <button type="button" className="secondary-btn" disabled={selectedRailwayKeys.length === 0 || railwayBusy} onClick={() => setRailwayDialogMode('configure')}>
                    变更服务配置
                  </button>
                  <button type="button" className="secondary-btn" disabled={selectedRailwayKeys.length === 0 || railwayBusy} onClick={() => setRailwayDialogMode('variables')}>
                    更新服务变量
                  </button>
                  <button type="button" className="secondary-btn danger-btn" disabled={selectedRailwayKeys.length === 0 || railwayBusy} onClick={() => setRailwayDialogMode('delete')}>
                    删除服务
                  </button>
                </div>
              </div>

              <div className="table-wrap user-management-table-wrap" aria-live="polite">
                <table className="conversation-index-table deployment-table">
                  <thead>
                    <tr>
                      <th>选择</th>
                      <th>服务</th>
                      <th>归属部署</th>
                      <th>最新部署</th>
                      <th>访问地址</th>
                      <th>关联用户</th>
                      <th>风险</th>
                      <th>最近更新</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={8} className="empty">正在加载 Railway 服务列表...</td>
                      </tr>
                    ) : null}
                    {!loading && (railwayResponse?.items.length || 0) === 0 ? (
                      <tr>
                        <td colSpan={8} className="empty">当前筛选条件下没有 Railway 部署服务</td>
                      </tr>
                    ) : null}
                    {!loading ? (railwayResponse?.items || []).map((item) => {
                      const externalUrl = asExternalUrl(item);
                      return (
                        <tr key={item.key}>
                          <td>
                            <label className="checkbox-row">
                              <input
                                type="checkbox"
                                checked={selectedRailwayKeys.includes(item.key)}
                                onChange={() => toggleRailwayKey(item.key)}
                              />
                              <span className="sr-only">选择服务</span>
                            </label>
                          </td>
                          <td>
                            <div className="user-management-table-user">
                              <div className="user-management-table-user-head">
                                <strong>{item.serviceName || item.serviceId}</strong>
                              </div>
                              <p className="mono">{truncateMiddle(item.serviceId)}</p>
                              <small>{item.projectName || item.projectId} / {item.environmentName || item.environmentId}</small>
                            </div>
                          </td>
                          <td>
                            <div className="user-management-table-cell-stack">
                              <strong>{item.managedAccountCount} 个接入记录</strong>
                              <small>{item.domainCount} 个域名，{item.targetPort || '-'} 端口</small>
                              <small>{item.variablesPreview.length > 0 ? `变量：${item.variablesPreview.join(', ')}` : '变量预览为空'}</small>
                            </div>
                          </td>
                          <td>
                            <div className="user-management-table-cell-stack">
                              <span className={`state-chip ${deploymentStatusTone(railwayStatusCategory(item.latestDeploymentStatus))}`}>
                                {railwayStatusLabel(item.latestDeploymentStatus)}
                              </span>
                              <small>{item.latestDeploymentId ? truncateMiddle(item.latestDeploymentId) : '无部署 ID'}</small>
                              <small>{formatDateTime(item.latestDeploymentAt)}</small>
                            </div>
                          </td>
                          <td>
                            <div className="user-management-table-cell-stack">
                              {externalUrl ? (
                                <a className="record-title-link" href={externalUrl} target="_blank" rel="noreferrer">
                                  {formatExternalLinkLabel(externalUrl)}
                                </a>
                              ) : (
                                <strong>{item.primaryDomain || '-'}</strong>
                              )}
                              <small>{item.primaryDomain || '无主域名'}</small>
                            </div>
                          </td>
                          <td>
                            <div className="user-management-table-cell-stack">
                              <strong>{item.linkedUserCount} 个用户</strong>
                              <small>{item.linkedUsers.slice(0, 2).map((user) => user.displayName || user.email || user.id).join(' / ') || '-'}</small>
                            </div>
                          </td>
                          <td>
                            <div className="deployment-risk-list">
                              {item.riskTags.length > 0 ? item.riskTags.map((tag) => (
                                <span key={`${item.key}-${tag}`} className="state-chip status-stopped">{tag}</span>
                              )) : <span className="state-chip status-running">正常</span>}
                            </div>
                          </td>
                          <td>
                            <div className="user-management-table-cell-stack">
                              <strong>{formatDateTime(item.updatedAt || item.latestDeploymentAt)}</strong>
                              <small>{formatCompactRelativeTime(item.updatedAt || item.latestDeploymentAt)}</small>
                            </div>
                          </td>
                        </tr>
                      );
                    }) : null}
                  </tbody>
                </table>
              </div>
            </div>
          ) : view === 'users' ? (
            <div className="table-wrap user-management-table-wrap" aria-live="polite">
              <table className="conversation-index-table deployment-table">
                <thead>
                  <tr>
                    <th>用户</th>
                    <th>部署数量</th>
                    <th>成功 / 失败 / 处理中</th>
                    <th>最近部署</th>
                    <th>访问地址</th>
                    <th>最近更新</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={7} className="empty">正在加载部署用户视图...</td>
                    </tr>
                  ) : null}
                  {!loading && (userResponse?.items.length || 0) === 0 ? (
                    <tr>
                      <td colSpan={7} className="empty">当前筛选条件下没有用户部署记录</td>
                    </tr>
                  ) : null}
                  {!loading ? (userResponse?.items || []).map((item) => {
                    const latestRecord = item.latestRecord;
                    const latestUrl = latestRecord ? asExternalUrl(latestRecord) : null;
                    return (
                      <tr key={item.user?.id || latestRecord?.taskSessionId || 'deployment-user'}>
                        <td>
                          <div className="user-management-table-user">
                            <div className="user-management-table-user-head">
                              <strong>{item.user?.displayName || item.user?.email || item.user?.id || '未识别用户'}</strong>
                            </div>
                            <p className="mono">{item.user?.id ? truncateMiddle(item.user.id) : '-'}</p>
                            <small>{item.user?.email || '-'}</small>
                          </div>
                        </td>
                        <td>
                          <div className="user-management-table-cell-stack">
                            <strong>{item.deploymentCount}</strong>
                            <small>仅统计有部署记录的会话</small>
                          </div>
                        </td>
                        <td>
                          <div className="user-management-table-cell-stack">
                            <strong>{item.successCount} / {item.failedCount} / {item.pendingCount}</strong>
                            <small>
                              <span className={`state-chip ${deploymentStatusTone(item.failedCount > 0 ? 'failed' : item.pendingCount > 0 ? 'pending' : 'success')}`}>
                                {item.failedCount > 0 ? '有失败' : item.pendingCount > 0 ? '处理中' : '稳定'}
                              </span>
                            </small>
                          </div>
                        </td>
                        <td>
                          <div className="user-management-table-cell-stack">
                            <strong>{latestRecord?.serviceName || latestRecord?.projectName || '-'}</strong>
                            <small>{latestRecord ? deploymentStatusLabel(latestRecord.statusCategory) : '-'}</small>
                            <small className="mono">{latestRecord ? truncateMiddle(latestRecord.taskSessionId) : '-'}</small>
                          </div>
                        </td>
                        <td>
                          <div className="user-management-table-cell-stack">
                            {latestUrl ? (
                              <a className="record-title-link" href={latestUrl} target="_blank" rel="noreferrer">
                                {formatExternalLinkLabel(latestUrl)}
                              </a>
                            ) : (
                              <strong>-</strong>
                            )}
                            <small>{latestRecord?.deploymentId || '-'}</small>
                          </div>
                        </td>
                        <td>
                          <div className="user-management-table-cell-stack">
                            <strong>{formatDateTime(item.latestUpdatedAt)}</strong>
                            <small>{formatCompactRelativeTime(item.latestUpdatedAt)}</small>
                          </div>
                        </td>
                        <td>
                          <div className="user-management-table-actions">
                            {item.user?.id && onOpenUser ? (
                              <button
                                type="button"
                                className="table-btn"
                                onClick={() => onOpenUser(item.user!.id, detailTrail(item.user?.displayName || item.user?.email || item.user?.id || '用户'))}
                              >
                                打开用户
                              </button>
                            ) : null}
                            {latestRecord ? (
                              <button type="button" className="table-btn" onClick={() => openDetail(latestRecord.taskSessionId)}>
                                查看部署
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  }) : null}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="table-wrap user-management-table-wrap" aria-live="polite">
              <table className="conversation-index-table deployment-table">
                <thead>
                  <tr>
                    <th>{view === 'records' ? '部署会话' : '部署对话'}</th>
                    <th>部署归属</th>
                    <th>部署状态</th>
                    <th>部署目标</th>
                    <th>访问地址</th>
                    <th>最近更新</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={7} className="empty">正在加载部署列表...</td>
                    </tr>
                  ) : null}
                  {!loading && activeRecords.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="empty">当前筛选条件下没有部署记录</td>
                    </tr>
                  ) : null}
                  {!loading ? activeRecords.map((record) => {
                    const latestUrl = asExternalUrl(record);
                    return (
                      <tr key={record.taskSessionId}>
                        <td>
                          <div className="user-management-table-user">
                            <div className="user-management-table-user-head">
                              <button type="button" className="management-title-link user-management-name-link" onClick={() => openDetail(record.taskSessionId)}>
                                {record.session.title}
                              </button>
                            </div>
                            <p className="mono">{truncateMiddle(record.taskSessionId)}</p>
                            <small>{sessionStatusLabel(record.session.status)}</small>
                          </div>
                        </td>
                        <td>
                          <div className="user-management-table-cell-stack">
                            <strong>{record.user?.displayName || record.user?.email || '-'}</strong>
                            <small>{record.projectName || '-'}</small>
                            <small>{record.serviceName || record.environmentName || '-'}</small>
                          </div>
                        </td>
                        <td>
                          <div className="user-management-table-cell-stack">
                            <span className={`state-chip ${deploymentStatusTone(record.statusCategory)}`}>
                              {deploymentStatusLabel(record.statusCategory)}
                            </span>
                            <small>{record.latestStatus || record.bindingState}</small>
                          </div>
                        </td>
                        <td>
                          <div className="user-management-table-cell-stack">
                            <strong>{record.projectName || '-'}</strong>
                            <small>{record.environmentName || '-'}</small>
                            <small>{record.serviceName || '-'}</small>
                          </div>
                        </td>
                        <td>
                          <div className="user-management-table-cell-stack">
                            {latestUrl ? (
                              <a className="record-title-link" href={latestUrl} target="_blank" rel="noreferrer">
                                {formatExternalLinkLabel(latestUrl)}
                              </a>
                            ) : (
                              <strong>-</strong>
                            )}
                            <small>{record.deploymentId || '-'}</small>
                          </div>
                        </td>
                        <td>
                          <div className="user-management-table-cell-stack">
                            <strong>{formatDateTime(record.updatedAt)}</strong>
                            <small>{formatCompactRelativeTime(record.updatedAt)}</small>
                          </div>
                        </td>
                        <td>
                          <div className="user-management-table-actions">
                            <button type="button" className="table-btn" onClick={() => openDetail(record.taskSessionId)}>
                              查看详情
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  }) : null}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      {railwayDialogMode ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={closeRailwayDialog}>
          <div className="modal-card deployment-bulk-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="section-tag">Railway 批量操作</p>
                <h2>
                  {railwayDialogMode === 'configure'
                    ? '批量变更服务配置'
                    : railwayDialogMode === 'variables'
                      ? '批量更新服务变量'
                      : '批量删除服务'}
                </h2>
                <p className="panel-caption">当前选择 {selectedRailwayKeys.length} 个服务</p>
              </div>
              <div className="section-actions">
                <button type="button" className="secondary-btn" onClick={closeRailwayDialog} disabled={railwayBusy}>
                  关闭
                </button>
              </div>
            </div>

            <div className="modal-body deployment-bulk-modal-body">
              <div className="deployment-bulk-selection">
                {selectedRailwayItems.map((item) => (
                  <span key={item.key} className="state-chip status-stopped">
                    {item.serviceName || item.serviceId}
                  </span>
                ))}
              </div>

              {railwayDialogMode === 'configure' ? (
                <div className="deployment-bulk-form">
                  <label>
                    <span>Builder</span>
                    <input value={railwayPatchDraft.builder} onChange={(event) => setRailwayPatchDraft((current) => ({ ...current, builder: event.target.value }))} placeholder="NIXPACKS / DOCKERFILE / RAILPACK" />
                  </label>
                  <label>
                    <span>Build Command</span>
                    <input value={railwayPatchDraft.buildCommand} onChange={(event) => setRailwayPatchDraft((current) => ({ ...current, buildCommand: event.target.value }))} placeholder="pnpm build" />
                  </label>
                  <label>
                    <span>Start Command</span>
                    <input value={railwayPatchDraft.startCommand} onChange={(event) => setRailwayPatchDraft((current) => ({ ...current, startCommand: event.target.value }))} placeholder="pnpm start" />
                  </label>
                  <label>
                    <span>Root Directory</span>
                    <input value={railwayPatchDraft.rootDirectory} onChange={(event) => setRailwayPatchDraft((current) => ({ ...current, rootDirectory: event.target.value }))} placeholder="apps/web" />
                  </label>
                  <label>
                    <span>Healthcheck Path</span>
                    <input value={railwayPatchDraft.healthcheckPath} onChange={(event) => setRailwayPatchDraft((current) => ({ ...current, healthcheckPath: event.target.value }))} placeholder="/health" />
                  </label>
                  <label>
                    <span>Source Image</span>
                    <input value={railwayPatchDraft.sourceImage} onChange={(event) => setRailwayPatchDraft((current) => ({ ...current, sourceImage: event.target.value }))} placeholder="ghcr.io/org/app:latest" />
                  </label>
                </div>
              ) : null}

              {railwayDialogMode === 'variables' ? (
                <div className="deployment-bulk-form">
                  <label className="deployment-variable-field">
                    <span>Variables JSON</span>
                    <textarea
                      value={railwayVariablesDraft}
                      onChange={(event) => setRailwayVariablesDraft(event.target.value)}
                      rows={12}
                      spellCheck={false}
                    />
                  </label>
                  <label className="checkbox-row">
                    <input type="checkbox" checked={railwayVariablesReplace} onChange={(event) => setRailwayVariablesReplace(event.target.checked)} />
                    <span>替换现有变量集合</span>
                  </label>
                </div>
              ) : null}

              {railwayDialogMode === 'delete' ? (
                <div className="deployment-bulk-form">
                  <p className="panel-caption">删除会直接作用到 Railway 服务，并清理对应后台关联接入。</p>
                  <label>
                    <span>输入 DELETE 确认</span>
                    <input value={railwayDeleteConfirm} onChange={(event) => setRailwayDeleteConfirm(event.target.value)} placeholder="DELETE" />
                  </label>
                </div>
              ) : null}

              <div className="section-actions">
                {railwayDialogMode === 'configure' ? (
                  <button type="button" className="secondary-btn" onClick={() => void submitRailwayConfigure()} disabled={railwayBusy}>
                    {railwayBusy ? '提交中...' : '提交配置变更'}
                  </button>
                ) : null}
                {railwayDialogMode === 'variables' ? (
                  <button type="button" className="secondary-btn" onClick={() => void submitRailwayVariables()} disabled={railwayBusy}>
                    {railwayBusy ? '提交中...' : '提交变量变更'}
                  </button>
                ) : null}
                {railwayDialogMode === 'delete' ? (
                  <button type="button" className="secondary-btn danger-btn" onClick={() => void submitRailwayDelete()} disabled={railwayBusy}>
                    {railwayBusy ? '删除中...' : '确认删除'}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {detailDialogOpen ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setDetailDialogOpen(false)}>
          <div className="modal-card deployment-detail-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="section-tag">部署详情</p>
                <h2>{detailTitle}</h2>
                <p className="panel-caption mono">{selectedTaskSessionId || '-'}</p>
              </div>
              <div className="section-actions">
                <button type="button" className="secondary-btn" onClick={() => setDetailDialogOpen(false)}>
                  关闭
                </button>
              </div>
            </div>

            <div className="skill-secondary-menu" role="tablist" aria-label="部署详情标签">
              {([
                ['overview', '概览'],
                ['history', '历史'],
                ['logs', '日志'],
                ['relations', '关联'],
                ['raw', '原始'],
              ] as Array<[DeploymentManagementDetailTab, string]>).map(([key, label]) => (
                <button key={key} type="button" className={detailTab === key ? 'active' : ''} onClick={() => setDetailTab(key)}>
                  <strong>{label}</strong>
                </button>
              ))}
            </div>

            <div className="modal-body deployment-detail-body">
              {detailLoading ? <DetailEmpty title="正在加载部署详情..." /> : null}
              {!detailLoading && !detail ? <DetailEmpty title="当前会话暂无部署详情" /> : null}

              {!detailLoading && detail && detailTab === 'overview' ? (
                <div className="deployment-detail-grid">
                  <article className="sub-panel">
                    <div className="user-management-record-head">
                      <strong>部署状态</strong>
                      <span className={`state-chip ${deploymentStatusTone(detail.statusCategory)}`}>
                        {deploymentStatusLabel(detail.statusCategory)}
                      </span>
                    </div>
                    <dl className="user-management-record-grid">
                      <div>
                        <dt>最新状态</dt>
                        <dd>{detail.latestStatus || detail.bindingState}</dd>
                      </div>
                      <div>
                        <dt>部署 ID</dt>
                        <dd className="mono">{detail.deploymentId || '-'}</dd>
                      </div>
                      <div>
                        <dt>项目 / 服务</dt>
                        <dd>{detail.projectName || '-'} / {detail.serviceName || '-'}</dd>
                      </div>
                      <div>
                        <dt>最近验证</dt>
                        <dd>{formatDateTime(detail.lastVerifiedAt)}</dd>
                      </div>
                    </dl>
                    {detail.latestUrl || detail.latestStaticUrl ? (
                      <div className="deployment-links">
                        {detail.latestUrl ? <a href={detail.latestUrl} target="_blank" rel="noreferrer">{detail.latestUrl}</a> : null}
                        {detail.latestStaticUrl ? <a href={detail.latestStaticUrl} target="_blank" rel="noreferrer">{detail.latestStaticUrl}</a> : null}
                      </div>
                    ) : null}
                  </article>

                  <article className="sub-panel">
                    <div className="user-management-record-head">
                      <strong>关联对象</strong>
                    </div>
                    <dl className="user-management-record-grid">
                      <div>
                        <dt>用户</dt>
                        <dd>{detail.user?.displayName || detail.user?.email || detail.user?.id || '-'}</dd>
                      </div>
                      <div>
                        <dt>会话状态</dt>
                        <dd>{sessionStatusLabel(detail.session.status)}</dd>
                      </div>
                      <div>
                        <dt>Sandbox</dt>
                        <dd>{detail.sandbox?.vmName || detail.sandbox?.sandboxId || '-'}</dd>
                      </div>
                      <div>
                        <dt>更新时间</dt>
                        <dd>{formatDateTime(detail.updatedAt)}</dd>
                      </div>
                    </dl>
                    <div className="section-actions">
                      {detailOrigin && onOpenConversation ? (
                        <button type="button" className="table-btn" onClick={() => onOpenConversation(detail.taskSessionId, detailOrigin)}>
                          打开对话
                        </button>
                      ) : null}
                      {detail.user?.id && detailOrigin && onOpenUser ? (
                        <button type="button" className="table-btn" onClick={() => onOpenUser(detail.user!.id, detailOrigin)}>
                          打开用户
                        </button>
                      ) : null}
                      {detail.sandbox?.sandboxId && detailOrigin && onOpenSandbox ? (
                        <button type="button" className="table-btn" onClick={() => onOpenSandbox(detail.sandbox!.sandboxId, detailOrigin)}>
                          打开 Sandbox
                        </button>
                      ) : null}
                    </div>
                  </article>
                </div>
              ) : null}

              {!detailLoading && detail && detailTab === 'history'
                ? (detail.panel.deployments.length > 0
                    ? detail.panel.deployments.map((item) => (
                        <article key={item.id} className="user-management-record-item">
                          <div className="user-management-record-head">
                            <strong className="mono">{item.id}</strong>
                            <span className={`state-chip ${deploymentStatusTone(railwayStatusCategory(item.status))}`}>{item.status}</span>
                          </div>
                          <dl className="user-management-record-grid">
                            <div>
                              <dt>创建时间</dt>
                              <dd>{formatDateTime(item.createdAt)}</dd>
                            </div>
                            <div>
                              <dt>服务</dt>
                              <dd>{item.serviceName || '-'}</dd>
                            </div>
                            <div>
                              <dt>提交人</dt>
                              <dd>{item.commitAuthor || '-'}</dd>
                            </div>
                            <div>
                              <dt>访问地址</dt>
                              <dd>{item.url || item.staticUrl || '-'}</dd>
                            </div>
                          </dl>
                        </article>
                      ))
                    : <DetailEmpty title="当前没有部署历史记录" />)
                : null}

              {!detailLoading && detail && detailTab === 'logs'
                ? (detail.panel.logs.length > 0
                    ? detail.panel.logs.map((item, index) => (
                        <article key={`${item.timestamp || 'log'}-${index}`} className="user-management-record-item">
                          <div className="user-management-record-head">
                            <strong>{item.severity || 'info'}</strong>
                            <span className="session-status">{formatDateTime(item.timestamp)}</span>
                          </div>
                          <p className="deployment-log-line">{item.message}</p>
                        </article>
                      ))
                    : <DetailEmpty title="当前没有部署日志快照" />)
                : null}

              {!detailLoading && detail && detailTab === 'relations' ? (
                <article className="sub-panel">
                  <dl className="user-management-record-grid">
                    <div>
                      <dt>用户 ID</dt>
                      <dd className="mono">{detail.user?.id || '-'}</dd>
                    </div>
                    <div>
                      <dt>会话 ID</dt>
                      <dd className="mono">{detail.taskSessionId}</dd>
                    </div>
                    <div>
                      <dt>Sandbox ID</dt>
                      <dd className="mono">{detail.sandbox?.sandboxId || '-'}</dd>
                    </div>
                    <div>
                      <dt>编排会话</dt>
                      <dd className="mono">{detail.sandbox?.sessionId || '-'}</dd>
                    </div>
                  </dl>
                </article>
              ) : null}

              {!detailLoading && detail && detailTab === 'raw' ? (
                <pre className="deployment-raw-panel">{JSON.stringify(detail, null, 2)}</pre>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
