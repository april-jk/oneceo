import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import type {
  ConnectorCatalogItem,
  ConnectorGuideCatalogSummary,
  ConnectorGuidePolicy,
  ConnectorGuidePolicyDetail,
  ConnectorGuideRevision,
  ConnectorGuideValidationResult,
} from '../types';
import {
  DEFAULT_CONNECTOR_GUIDE_MANAGEMENT_FILTERS,
  DEFAULT_CONNECTOR_GUIDE_MANAGEMENT_VIEW_STATE,
} from './adminViewState';
import type { ConnectorGuideManagementViewState } from './adminViewState';
import { AdminButton, ConfirmDialog, AdminDetailShell, AdminStickyInspector, AdminTabs, DangerConfirmDialog, DiffDrawer, StatusBadge, getAdminActionIcon, getAdminModuleIcon } from './admin-ui';

type Props = {
  onError: (message: string | null) => void;
  onUpdatedAtChange?: (value: string | null) => void;
  onRegisterRefresh?: (handler: (() => Promise<void>) | null) => void;
  persistedState?: ConnectorGuideManagementViewState | null;
  onStateChange?: (state: ConnectorGuideManagementViewState) => void;
};

type InlineConfirmPayload = {
  kind: 'publish' | 'rollback';
  policyId: string;
  revisionId: string;
  label: string;
  status: string;
  publishedLabel: string;
};

const DEFAULT_FILTERS = DEFAULT_CONNECTOR_GUIDE_MANAGEMENT_FILTERS;

type EditorState = {
  description: string;
  triggerMode: string;
  status: string;
  serverInstructionsMarkdown: string;
  guideReminderMarkdown: string;
  blockingRulesMarkdown: string;
  notes: string;
};

const EMPTY_EDITOR: EditorState = {
  description: '',
  triggerMode: 'on_attach',
  status: 'draft',
  serverInstructionsMarkdown: '',
  guideReminderMarkdown: '',
  blockingRulesMarkdown: '',
  notes: '',
};

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function toEditorState(detail: ConnectorGuidePolicyDetail, revision?: ConnectorGuideRevision | null): EditorState {
  return {
    description: detail.description || '',
    triggerMode: detail.triggerMode || 'on_attach',
    status: detail.status || 'draft',
    serverInstructionsMarkdown: revision?.serverInstructionsMarkdown || '',
    guideReminderMarkdown: revision?.guideReminderMarkdown || '',
    blockingRulesMarkdown: revision?.blockingRulesMarkdown || '',
    notes: revision?.notes || '',
  };
}

function guideStatusLabel(status: string) {
  if (status === 'draft') return '草稿';
  if (status === 'active') return '启用';
  if (status === 'archived') return '已归档';
  return status;
}

function triggerModeLabel(mode: string) {
  if (mode === 'on_attach') return '接入时';
  if (mode === 'on_active_use') return '活跃使用时';
  if (mode === 'on_attach_and_active_use') return '接入时和活跃使用时';
  return mode;
}

function previewText(value?: string | null) {
  return value?.trim() || '未填写';
}

export function ConnectorGuideManagementSection({
  onError,
  onUpdatedAtChange,
  onRegisterRefresh,
  persistedState,
  onStateChange,
}: Props) {
  const initialState = persistedState || DEFAULT_CONNECTOR_GUIDE_MANAGEMENT_VIEW_STATE;
  const [policies, setPolicies] = useState<ConnectorGuidePolicy[]>([]);
  const [allPolicyConnectorKeys, setAllPolicyConnectorKeys] = useState<string[]>([]);
  const [catalogSummary, setCatalogSummary] = useState<ConnectorGuideCatalogSummary | null>(null);
  const [selectedPolicyId, setSelectedPolicyId] = useState<string | null>(initialState.selectedPolicyId);
  const [detail, setDetail] = useState<ConnectorGuidePolicyDetail | null>(null);
  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(initialState.selectedRevisionId);
  const [editor, setEditor] = useState<EditorState>(EMPTY_EDITOR);
  const [validationResult, setValidationResult] = useState<ConnectorGuideValidationResult | null>(null);
  const [filters, setFilters] = useState(initialState.filters);
  const [busy, setBusy] = useState(false);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [inlineConfirm, setInlineConfirm] = useState<InlineConfirmPayload | null>(null);
  const [diffOpen, setDiffOpen] = useState(false);
  const [expandedPreviewCards, setExpandedPreviewCards] = useState<Set<string>>(new Set());
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const selectedRevisionIdRef = useRef<string | null>(initialState.selectedRevisionId);

  const revision = useMemo(
    () => detail?.revisions.find((item) => item.id === selectedRevisionId) || detail?.publishedRevision || null,
    [detail, selectedRevisionId]
  );

  const isDirty = useMemo(() => {
    if (!detail || !revision) return false;
    return (
      editor.description !== (detail.description || '') ||
      editor.triggerMode !== detail.triggerMode ||
      editor.status !== detail.status ||
      editor.serverInstructionsMarkdown !== (revision.serverInstructionsMarkdown || '') ||
      editor.guideReminderMarkdown !== (revision.guideReminderMarkdown || '') ||
      editor.blockingRulesMarkdown !== (revision.blockingRulesMarkdown || '') ||
      editor.notes !== (revision.notes || '')
    );
  }, [detail, revision, editor]);

  const catalogVisibleItems = useMemo(
    () => (catalogSummary?.items || []).filter((item) => item.visibleInMenu && item.available),
    [catalogSummary?.items]
  );

  const connectorOptions = useMemo(() => {
    const candidates = new Set<string>();
    catalogVisibleItems.forEach((item) => candidates.add(item.key));
    allPolicyConnectorKeys.forEach((connectorKey) => candidates.add(connectorKey));
    return Array.from(candidates).sort((left, right) => left.localeCompare(right));
  }, [allPolicyConnectorKeys, catalogVisibleItems]);

  const creatableConnectorOptions = useMemo(() => {
    const existingConnectorKeys = new Set(allPolicyConnectorKeys);
    return Array.from(new Set(catalogVisibleItems.map((item) => item.key)))
      .filter((connectorKey) => !existingConnectorKeys.has(connectorKey))
      .sort((left, right) => left.localeCompare(right));
  }, [allPolicyConnectorKeys, catalogVisibleItems]);

  const catalogKeySummary = useMemo(
    () =>
      catalogVisibleItems.length > 0
        ? catalogVisibleItems.map((item) => `${item.key}${item.available ? '' : '（不可用）'}`).join(' / ')
        : '-',
    [catalogVisibleItems]
  );

  useEffect(() => {
    selectedRevisionIdRef.current = selectedRevisionId;
  }, [selectedRevisionId]);

  const loadPolicies = useCallback(async () => {
    const next = await api.listConnectorGuidePolicies({
      connectorKey: filters.connectorKey || undefined,
      status: filters.status !== 'all' ? filters.status : undefined,
      query: filters.query || undefined,
    });
    setPolicies(next);
    onError(null);
    if (!next.length) {
      setSelectedPolicyId(null);
      setDetail(null);
      setSelectedRevisionId(null);
      setEditor(EMPTY_EDITOR);
      return;
    }
    if (!selectedPolicyId || !next.some((item) => item.id === selectedPolicyId)) {
      setSelectedPolicyId(next[0].id);
    }
  }, [filters.connectorKey, filters.query, filters.status, onError, selectedPolicyId]);

  const loadCatalogSummary = useCallback(async () => {
    const next = await api.getConnectorGuideCatalogSummary();
    setCatalogSummary(next);
    onError(null);
    return next;
  }, [onError]);

  const loadPolicyConnectorKeys = useCallback(async () => {
    const next = await api.listConnectorGuidePolicies();
    setAllPolicyConnectorKeys(
      Array.from(new Set(next.map((item) => item.connectorKey))).sort((left, right) => left.localeCompare(right))
    );
    onError(null);
    return next;
  }, [onError]);

  const refreshOverview = useCallback(async () => {
    await Promise.all([loadPolicies(), loadCatalogSummary(), loadPolicyConnectorKeys()]);
  }, [loadCatalogSummary, loadPolicies, loadPolicyConnectorKeys]);

  const loadDetail = useCallback(
    async (policyId: string) => {
      const next = await api.getConnectorGuidePolicy(policyId);
      setDetail(next);
      const currentSelectedRevisionId = selectedRevisionIdRef.current;
      const nextRevisionId =
        currentSelectedRevisionId && next.revisions.some((item) => item.id === currentSelectedRevisionId)
          ? currentSelectedRevisionId
          : next.publishedRevision?.id || next.revisions[0]?.id || null;
      const nextRevision =
        next.revisions.find((item) => item.id === nextRevisionId)
        || next.publishedRevision
        || next.revisions[0]
        || null;
      setSelectedRevisionId(nextRevisionId);
      setEditor(toEditorState(next, nextRevision));
      setValidationResult(null);
      onError(null);
    },
    [onError]
  );

  useEffect(() => {
    void refreshOverview().catch((error) => {
      onError(error instanceof Error ? error.message : 'connector guide 列表加载失败');
    });
  }, [onError, refreshOverview]);

  useEffect(() => {
    if (!selectedPolicyId) return;
    void loadDetail(selectedPolicyId).catch((error) => {
      onError(error instanceof Error ? error.message : 'connector guide 详情加载失败');
    });
  }, [selectedPolicyId, loadDetail, onError]);

  useEffect(() => {
    if (!detail) return;
    setEditor(toEditorState(detail, revision));
  }, [detail, revision]);

  useEffect(() => {
    if (!detailDialogOpen || !detail) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && editMode) {
        setEditor(toEditorState(detail, revision));
        setEditMode(false);
      } else if (event.key === 'Escape' && !editMode) {
        setDetailDialogOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [detail, detailDialogOpen, editMode, revision]);

  useEffect(() => {
    onUpdatedAtChange?.(
      detail?.updatedAt
      || revision?.publishedAt
      || revision?.createdAt
      || catalogSummary?.updatedAt
      || policies[0]?.updatedAt
      || null
    );
  }, [catalogSummary?.updatedAt, detail?.updatedAt, onUpdatedAtChange, policies, revision?.createdAt, revision?.publishedAt]);

  const handleExternalRefresh = useCallback(async () => {
    await refreshOverview();
    if (selectedPolicyId) {
      await loadDetail(selectedPolicyId);
    }
  }, [loadDetail, refreshOverview, selectedPolicyId]);

  useEffect(() => {
    onRegisterRefresh?.(handleExternalRefresh);
    return () => {
      onRegisterRefresh?.(null);
    };
  }, [handleExternalRefresh, onRegisterRefresh]);

  useEffect(() => {
    onStateChange?.({
      filters,
      selectedPolicyId,
      selectedRevisionId,
    });
  }, [filters, onStateChange, selectedPolicyId, selectedRevisionId]);

  const createPolicy = async (connectorKey: string) => {
    setBusy(true);
    try {
      const policy = await api.createConnectorGuidePolicy({
        connectorKey,
        triggerMode: 'on_attach',
        description: `${connectorKey} connector guide policy`,
        createdBy: 'admin_management',
      });
      await refreshOverview();
      setSelectedPolicyId(policy.id);
    } catch (error) {
      onError(error instanceof Error ? error.message : '创建 connector guide policy 失败');
    } finally {
      setBusy(false);
      setInlineConfirm(null);
    }
  };

  const savePolicy = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      await api.updateConnectorGuidePolicy(detail.id, {
        description: editor.description,
        triggerMode: editor.triggerMode,
        status: editor.status,
      });
      let createdRevisionId: string | null = null;
      if (!revision) {
        const created = await api.createConnectorGuideRevision(detail.id, {
          createdBy: 'admin_management',
        });
        createdRevisionId = created.id;
        setSelectedRevisionId(created.id);
      }
      const targetRevisionId = revision?.id || createdRevisionId || selectedRevisionIdRef.current;
      if (targetRevisionId) {
        await api.updateConnectorGuideRevision(detail.id, targetRevisionId, {
          serverInstructionsMarkdown: editor.serverInstructionsMarkdown,
          guideReminderMarkdown: editor.guideReminderMarkdown,
          blockingRulesMarkdown: editor.blockingRulesMarkdown,
          notes: editor.notes,
        });
      }
      await loadDetail(detail.id);
    } catch (error) {
      onError(error instanceof Error ? error.message : '保存 connector guide 失败');
    } finally {
      setBusy(false);
      setInlineConfirm(null);
    }
  };

  const createRevision = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      const created = await api.createConnectorGuideRevision(detail.id, {
        createdBy: 'admin_management',
      });
      await loadDetail(detail.id);
      setSelectedRevisionId(created.id);
    } catch (error) {
      onError(error instanceof Error ? error.message : '创建 revision 失败');
    } finally {
      setBusy(false);
      setInlineConfirm(null);
    }
  };

  const validateRevision = async () => {
    if (!detail || !revision) return;
    setBusy(true);
    try {
      await api.updateConnectorGuideRevision(detail.id, revision.id, {
        serverInstructionsMarkdown: editor.serverInstructionsMarkdown,
        guideReminderMarkdown: editor.guideReminderMarkdown,
        blockingRulesMarkdown: editor.blockingRulesMarkdown,
        notes: editor.notes,
      });
      const result = await api.validateConnectorGuideRevision(detail.id, revision.id);
      await loadDetail(detail.id);
      setValidationResult(result);
    } catch (error) {
      onError(error instanceof Error ? error.message : '校验 connector guide 失败');
    } finally {
      setBusy(false);
      setInlineConfirm(null);
    }
  };

  const publishRevision = async (payload: InlineConfirmPayload) => {
    setBusy(true);
    try {
      await api.updateConnectorGuideRevision(payload.policyId, payload.revisionId, {
        serverInstructionsMarkdown: editor.serverInstructionsMarkdown,
        guideReminderMarkdown: editor.guideReminderMarkdown,
        blockingRulesMarkdown: editor.blockingRulesMarkdown,
        notes: editor.notes,
      });
      await api.publishConnectorGuideRevision(payload.policyId, payload.revisionId);
      await loadDetail(payload.policyId);
      setValidationResult(null);
    } catch (error) {
      onError(error instanceof Error ? error.message : '发布 connector guide 失败');
    } finally {
      setBusy(false);
      setInlineConfirm(null);
    }
  };

  const rollbackRevision = async (payload: InlineConfirmPayload) => {
    setBusy(true);
    try {
      await api.rollbackConnectorGuideRevision(payload.policyId, payload.revisionId);
      await loadDetail(payload.policyId);
      setSelectedRevisionId(payload.revisionId);
      setValidationResult(null);
    } catch (error) {
      onError(error instanceof Error ? error.message : '回滚 connector guide 失败');
    } finally {
      setBusy(false);
      setInlineConfirm(null);
    }
  };

  const handleRefresh = async () => {
    setBusy(true);
    try {
      await handleExternalRefresh();
    } catch (error) {
      onError(error instanceof Error ? error.message : '刷新 connector guide 列表失败');
    } finally {
      setBusy(false);
    }
  };

  const handleResetFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
  }, []);

  const enterEditMode = useCallback(() => {
    if (!detail) return;
    setEditor(toEditorState(detail, revision));
    setEditMode(true);
  }, [detail, revision]);

  const exitEditMode = useCallback(() => {
    if (isDirty) {
      setDiscardConfirmOpen(true);
      return;
    }
    if (detail) {
      setEditor(toEditorState(detail, revision));
    }
    setEditMode(false);
    setInlineConfirm(null);
  }, [detail, revision, isDirty]);

  const confirmDiscard = useCallback(() => {
    if (detail) {
      setEditor(toEditorState(detail, revision));
    }
    setEditMode(false);
    setInlineConfirm(null);
    setDiscardConfirmOpen(false);
  }, [detail, revision]);

  return (
    <main className="content-stack">
      <section className="panel fade-in connector-guide-panel">
        <div className="section-heading connector-guide-heading">
          <div className="connector-guide-heading-copy">
            <p className="eyebrow">连接器引导规则</p>
            <h2>连接器 Guide 管理</h2>
          </div>
          <div className="section-actions connector-guide-heading-actions">
            {creatableConnectorOptions.length > 0 ? (
              <div className="connector-guide-quick-create-row" role="group" aria-label="快速新建连接器 Guide">
                {creatableConnectorOptions.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className="connector-guide-create-btn"
                    disabled={busy}
                    onClick={() => void createPolicy(item)}
                  >
                    <span className="connector-guide-create-btn-prefix">新建</span>
                    <span className="connector-guide-create-btn-key">{item}</span>
                  </button>
                ))}
              </div>
            ) : catalogVisibleItems.length > 0 ? (
              <span className="connector-guide-create-empty">已全部建档</span>
            ) : null}
            <button
              type="button"
              className="primary-btn connector-guide-refresh-btn"
              disabled={busy}
              onClick={() => void handleRefresh()}
            >
              同步列表
            </button>
          </div>
        </div>

        <div className="detail-grid modal-grid" style={{ marginBottom: 12 }}>
          <article className="sub-panel">
            <div className="editor-header editor-header--compact">
              <h3>Catalog 概览</h3>
            </div>
            <div className="signal-list signal-list--compact">
              <p>
                <strong>MCP 类型:</strong> {catalogSummary?.stats.total ?? '-'}（可用 {catalogSummary?.stats.available ?? '-'} / 不可用 {catalogSummary?.stats.unavailable ?? '-'}）
              </p>
              <p>
                <strong>类型列表:</strong> {catalogKeySummary}
              </p>
              <p>
                <strong>同步时间:</strong> {formatDateTime(catalogSummary?.updatedAt)}
              </p>
            </div>
          </article>

          <article className="sub-panel">
            <div className="editor-header editor-header--compact">
              <h3>可见 Connector</h3>
            </div>
            <div className="signal-list signal-list--compact">
              {catalogVisibleItems.length === 0 ? (
                <p className="empty">还没有 catalog 快照。</p>
              ) : (
                catalogVisibleItems.map((item: ConnectorCatalogItem) => (
                  <p key={item.key} className={item.available ? '' : 'text-muted'}>
                    <strong>{item.key}</strong> · {item.name} {item.available ? '' : `· ${item.availabilityReason || '不可用'}`}
                  </p>
                ))
              )}
            </div>
          </article>
        </div>

        <div className="skill-toolbar">
          <select
            className="control-input"
            aria-label="连接器筛选"
            value={filters.connectorKey}
            onChange={(event) => setFilters((prev) => ({ ...prev, connectorKey: event.target.value }))}
          >
            <option value="">全部连接器</option>
            {connectorOptions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <select
            className="control-input"
            aria-label="连接器指南状态筛选"
            value={filters.status}
            onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
          >
            <option value="all">全部状态</option>
            <option value="draft">草稿</option>
            <option value="active">启用</option>
            <option value="archived">已归档</option>
          </select>
          <input
            className="control-input"
            aria-label="按连接器搜索"
            placeholder="按连接器搜索"
            value={filters.query}
            onChange={(event) => setFilters((prev) => ({ ...prev, query: event.target.value }))}
          />
          <button type="button" className="secondary-btn" disabled={busy} onClick={handleResetFilters}>
            重置筛选
          </button>
        </div>

        <div className="skill-list">
          <table className="skill-table">
            <thead>
              <tr>
                <th>连接器</th>
                <th>状态</th>
                <th>触发</th>
                <th>发布</th>
              </tr>
            </thead>
            <tbody>
              {policies.length === 0 ? (
                <tr>
                  <td colSpan={4} className="table-empty">
                    暂无连接器引导规则
                  </td>
                </tr>
              ) : (
                policies.map((item) => (
                  <tr
                    key={item.id}
                    className={selectedPolicyId === item.id ? 'selected' : ''}
                  >
                    <td>
                      <button
                        type="button"
                        className="management-title-link"
                        onClick={() => {
                          setSelectedPolicyId(item.id);
                          setDetailDialogOpen(true);
                        }}
                      >
                        {item.connectorKey}
                      </button>
                      <div className="cell-subtle">{item.description || '-'}</div>
                    </td>
                    <td>
                      <span className={`status-pill status-${item.status}`}>{guideStatusLabel(item.status)}</span>
                    </td>
                    <td>{triggerModeLabel(item.triggerMode)}</td>
                    <td>{item.publishedRevisionId ? '已发布' : '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>


      {detail && detailDialogOpen ? (
        <AdminDetailShell
          open={detailDialogOpen}
          onClose={() => setDetailDialogOpen(false)}
          size="xl"
          eyebrow="连接器引导规则"
          title={detail.connectorKey}
          subtitle={`${detail.publishedRevision ? `published v${detail.publishedRevision.versionNumber}` : '未发布'} · ${guideStatusLabel(detail.status)} · ${formatDateTime(detail.updatedAt)}`}
          icon={getAdminModuleIcon('connector')}
          entityType="Connector Guide"
          status={<StatusBadge tone={detail.status === 'active' ? 'success' : detail.status === 'archived' ? 'danger' : 'warning'}>{guideStatusLabel(detail.status)}</StatusBadge>}
          metrics={[
            { label: 'Revision', value: revision ? `v${revision.versionNumber}` : '-' },
            { label: '触发', value: triggerModeLabel(detail.triggerMode) },
            { label: '已发布', value: detail.publishedRevision ? `v${detail.publishedRevision.versionNumber}` : '未发布' },
            { label: '校验', value: validationResult ? (validationResult.valid ? '通过' : '未通过') : '未校验' },
          ]}
          actions={
            editMode ? (
              <AdminButton variant={isDirty ? 'dangerSoft' : 'secondary'} disabled={busy} onClick={exitEditMode}>
                {isDirty ? '退出编辑（未保存）' : '退出编辑'}
              </AdminButton>
            ) : (
              <AdminButton variant="primary" disabled={busy} onClick={enterEditMode}>
                编辑
              </AdminButton>
            )
          }
          summary={
            <div className="skill-detail-summary-strip">
              <article className="skill-detail-summary-card">
                <span>触发模式</span>
                <strong>{triggerModeLabel(detail.triggerMode)}</strong>
              </article>
              <article className="skill-detail-summary-card">
                <span>当前 Revision</span>
                <strong className="mono">{revision ? `v${revision.versionNumber}` : '-'}</strong>
              </article>
              <article className="skill-detail-summary-card">
                <span>已发布版本</span>
                <strong className="mono">{detail.publishedRevision ? `v${detail.publishedRevision.versionNumber}` : '未发布'}</strong>
              </article>
              <article className="skill-detail-summary-card">
                <span>校验状态</span>
                <strong>{validationResult ? (validationResult.valid ? '通过' : '未通过') : '未校验'}</strong>
              </article>
            </div>
          }
          inspector={
            <AdminStickyInspector
              compact
              title="Inspector"
              sections={[
                {
                  key: 'status',
                  title: '状态与风险',
                  children: (
                    <div className="signal-list signal-list--compact">
                      <p>
                        {detail.status === 'archived'
                          ? '已归档，需恢复后才能发布。'
                          : revision?.status === 'published'
                            ? '当前 revision 已发布，编辑后需保存才生效。'
                            : '草稿状态，发布前需确认 Diff 并保存。'}
                      </p>
                      <p>
                        {revision
                          ? '无阻断，可正常操作。'
                          : '无可用 revision，需先新建或保存。'}
                      </p>
                    </div>
                  ),
                },
                {
                  key: 'impact',
                  title: '影响范围',
                  children: (
                    <div className="signal-list signal-list--compact">
                      <p>影响 {detail.connectorKey} 的引导说明、提醒与阻断规则。不修改 connector 目录。</p>
                    </div>
                  ),
                },
                {
                  key: 'recommend',
                  title: '推荐动作',
                  children: (
                    <div className="signal-list signal-list--compact">
                      <p>发布前查看 Diff，按需执行校验。</p>
                    </div>
                  ),
                },
              ]}
            />
          }
        >
          <div className="modal-body connector-guide-modal-body">
            {editMode ? (
              <>
                <div className="connector-guide-toolbar">
                  <div className="toolbar-group">
                    <AdminButton variant="ghost" icon={getAdminActionIcon('refresh')} disabled={busy || !revision} onClick={() => void validateRevision()}>
                      校验
                    </AdminButton>
                  </div>
                  <div className="toolbar-group toolbar-group--primary">
                    <AdminButton variant="secondary" disabled={busy} onClick={() => void savePolicy()}>
                      保存
                    </AdminButton>
                    <AdminButton
                      variant="danger"
                      icon={getAdminActionIcon('save')}
                      disabled={busy || !revision}
                      onClick={() =>
                        revision &&
                        setInlineConfirm({
                          kind: 'publish',
                          policyId: detail.id,
                          revisionId: revision.id,
                          label: detail.connectorKey,
                          status: revision.status,
                          publishedLabel: detail.publishedRevision
                            ? `v${detail.publishedRevision.versionNumber}`
                            : '未发布',
                        })
                      }
                    >
                      发布
                    </AdminButton>
                  </div>
                </div>

                <div className="detail-grid modal-grid connector-guide-editor-grid">
                  <article className="sub-panel connector-guide-editor-main">
                    <div className="skill-form-grid skill-form-grid--compact">
                      <label className="form-field">
                        <span>触发模式</span>
                        <select
                          className="control-input"
                          value={editor.triggerMode}
                          onChange={(event) => setEditor((prev) => ({ ...prev, triggerMode: event.target.value }))}
                        >
                          <option value="on_attach">接入时</option>
                          <option value="on_active_use">活跃使用时</option>
                          <option value="on_attach_and_active_use">接入时和活跃使用时</option>
                        </select>
                      </label>
                      <label className="form-field">
                        <span>状态</span>
                        <select
                          className="control-input"
                          value={editor.status}
                          onChange={(event) => setEditor((prev) => ({ ...prev, status: event.target.value }))}
                        >
                          <option value="draft">草稿</option>
                          <option value="active">启用</option>
                          <option value="archived">已归档</option>
                        </select>
                      </label>
                      <label className="form-field field-span-2">
                        <span>说明</span>
                        <input
                          className="control-input"
                          value={editor.description}
                          onChange={(event) => setEditor((prev) => ({ ...prev, description: event.target.value }))}
                        />
                      </label>
                    </div>

                    {[
                      {
                        key: 'serverInstructions',
                        label: '服务端说明',
                        rows: 6,
                        value: editor.serverInstructionsMarkdown,
                        onChange: (v: string) => setEditor((prev) => ({ ...prev, serverInstructionsMarkdown: v })),
                      },
                      {
                        key: 'guideReminder',
                        label: '引导提醒',
                        rows: 5,
                        value: editor.guideReminderMarkdown,
                        onChange: (v: string) => setEditor((prev) => ({ ...prev, guideReminderMarkdown: v })),
                      },
                      {
                        key: 'blockingRules',
                        label: '阻断规则',
                        rows: 2,
                        value: editor.blockingRulesMarkdown,
                        onChange: (v: string) => setEditor((prev) => ({ ...prev, blockingRulesMarkdown: v })),
                      },
                      {
                        key: 'notes',
                        label: '备注',
                        rows: 2,
                        value: editor.notes,
                        onChange: (v: string) => setEditor((prev) => ({ ...prev, notes: v })),
                      },
                    ].map((block) => (
                      <div key={block.key} className="connector-guide-textarea-block">
                        <label className="connector-guide-textarea-label">
                          {block.label}
                        </label>
                        <textarea
                          className="control-textarea connector-guide-textarea-resize"
                          rows={block.rows}
                          value={block.value}
                          onChange={(event) => block.onChange(event.target.value)}
                        />
                      </div>
                    ))}
                  </article>

                  <article className="sub-panel connector-guide-sidebar-panel">
                    <div className="connector-guide-sidebar-section">
                      <div className="editor-header editor-header--compact">
                        <h3>版本信息</h3>
                      </div>
                      <div className="signal-list signal-list--compact">
                        <p>
                          {revision
                            ? <strong>v{revision.versionNumber} · {guideStatusLabel(revision.status)}</strong>
                            : <span className="cell-subtle">保存时自动创建</span>}
                        </p>
                        <p className="cell-subtle">
                          创建 {formatDateTime(revision?.createdAt)} · 发布 {formatDateTime(revision?.publishedAt)}
                        </p>
                      </div>
                    </div>

                    <div className="connector-guide-sidebar-section">
                      <div className="connector-guide-sidebar-actions">
                        <AdminButton variant="secondary" size="sm" icon={getAdminActionIcon('logs')} onClick={() => setDiffOpen(true)}>
                          查看 Diff
                        </AdminButton>
                        <AdminButton variant="secondary" size="sm" icon={getAdminActionIcon('sync')} disabled={busy} onClick={() => void createRevision()}>
                          新建 revision
                        </AdminButton>
                        <AdminButton variant="ghost" size="sm" disabled={busy || !revision} onClick={() => void validateRevision()}>
                          执行校验
                        </AdminButton>
                      </div>
                    </div>

                    <div className="connector-guide-sidebar-section">
                      <div className="editor-header editor-header--compact">
                        <h3>校验状态</h3>
                      </div>
                      {validationResult ? (
                        <div className="connector-guide-validation-compact">
                          <span className={`validation-badge ${validationResult.valid ? 'valid' : 'invalid'}`}>
                            {validationResult.valid ? '通过' : '未通过'}
                          </span>
                          <span className="cell-subtle">
                            {validationResult.errors.length} 错误 · {validationResult.warnings.length} 警告
                          </span>
                        </div>
                      ) : (
                        <p className="empty">尚未校验</p>
                      )}
                    </div>
                  </article>
                </div>

              </>
          ) : (
            <div className="detail-grid modal-grid connector-guide-readonly-grid">
              <article className="sub-panel connector-guide-readonly-main">
                <div className="editor-header editor-header--compact">
                  <h3>Guide 内容</h3>
                </div>
                {(() => {
                  const guidePreviewCards = [
                    { key: 'description', label: '说明', value: detail.description },
                    { key: 'serverInstructions', label: '服务端说明', value: revision?.serverInstructionsMarkdown },
                    { key: 'guideReminder', label: '引导提醒', value: revision?.guideReminderMarkdown },
                    { key: 'blockingRules', label: '阻断规则', value: revision?.blockingRulesMarkdown },
                    { key: 'notes', label: '备注', value: revision?.notes },
                  ];
                  const emptyLabels = guidePreviewCards.filter((card) => !card.value?.trim()).map((card) => card.label);
                  return (
                    <div className="connector-guide-preview-compact">
                      {guidePreviewCards
                        .filter((card) => card.value?.trim())
                        .map((card) => {
                          const text = previewText(card.value);
                          const isExpanded = expandedPreviewCards.has(card.key);
                          return (
                            <div key={card.key} className={`preview-compact-card ${isExpanded ? 'expanded' : ''}`}>
                              <div className="preview-compact-header">
                                <span className="preview-compact-label">{card.label}</span>
                                {text.length > 120 && (
                                  <button
                                    type="button"
                                    className="preview-compact-toggle"
                                    onClick={() =>
                                      setExpandedPreviewCards((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(card.key)) {
                                          next.delete(card.key);
                                        } else {
                                          next.add(card.key);
                                        }
                                        return next;
                                      })
                                    }
                                    aria-expanded={isExpanded}
                                  >
                                    {isExpanded ? '收起' : '展开'}
                                  </button>
                                )}
                              </div>
                              <p className="preview-compact-body">{text}</p>
                            </div>
                          );
                        })}
                      {emptyLabels.length > 0 && (
                        <div className="preview-compact-card preview-compact-card--muted">
                          <span className="preview-compact-label">{emptyLabels.join('、')} 未填写</span>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </article>

              <article className="sub-panel connector-guide-sidebar-panel">
                <div className="editor-header editor-header--compact">
                  <h3>Revision 历史</h3>
                </div>
                <div className="skill-list connector-guide-revision-list">
                  <table className="skill-table connector-guide-revision-table">
                    <thead>
                      <tr>
                        <th>版本</th>
                        <th>状态</th>
                        <th>发布时间</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.revisions.map((item) => (
                        <tr key={item.id} className={selectedRevisionId === item.id ? 'selected' : ''}>
                          <td>
                            <button
                              type="button"
                              className={`connector-guide-revision-select ${selectedRevisionId === item.id ? 'active' : ''}`}
                              onClick={() => setSelectedRevisionId(item.id)}
                              aria-pressed={selectedRevisionId === item.id}
                              aria-label={`查看 v${item.versionNumber} 版本`}
                            >
                              <strong>v{item.versionNumber}</strong>
                              <span className="cell-subtle connector-guide-revision-meta">
                                {formatDateTime(item.createdAt)}
                              </span>
                              <span className="connector-guide-revision-select-label">查看版本</span>
                            </button>
                          </td>
                          <td>
                            <span className={`status-pill status-${item.status}`}>{item.status}</span>
                          </td>
                          <td className="connector-guide-revision-date">
                            {formatDateTime(item.publishedAt)}
                          </td>
                          <td>
                            <AdminButton
                              variant="ghost"
                              size="sm"
                              disabled={busy || item.status === 'published'}
                              onClick={() =>
                                setInlineConfirm({
                                  kind: 'rollback',
                                  policyId: detail.id,
                                  revisionId: item.id,
                                  label: detail.connectorKey,
                                  status: item.status,
                                  publishedLabel: detail.publishedRevision
                                    ? `v${detail.publishedRevision.versionNumber}`
                                    : '未发布',
                                })
                              }
                            >
                              回滚
                            </AdminButton>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="editor-header editor-header--compact" style={{ marginTop: 12 }}>
                  <h3>校验结果</h3>
                </div>
                {validationResult ? (
                  <div className={`validation-result ${validationResult.valid ? 'valid' : 'invalid'}`}>
                    <div className="validation-result-header">
                      <span className="validation-result-badge">
                        {validationResult.valid ? '通过' : '未通过'}
                      </span>
                      <span className="validation-result-meta">
                        {validationResult.errors.length} 错误 · {validationResult.warnings.length} 警告
                      </span>
                    </div>
                    {validationResult.errors.length > 0 && (
                      <ul className="validation-result-list validation-result-errors">
                        {validationResult.errors.map((error, index) => (
                          <li key={`error-${index}`}>{error}</li>
                        ))}
                      </ul>
                    )}
                    {validationResult.warnings.length > 0 && (
                      <ul className="validation-result-list validation-result-warnings">
                        {validationResult.warnings.map((warning, index) => (
                          <li key={`warning-${index}`}>{warning}</li>
                        ))}
                      </ul>
                    )}
                    {validationResult.valid &&
                      validationResult.errors.length === 0 &&
                      validationResult.warnings.length === 0 && (
                        <p className="validation-result-empty">无问题</p>
                      )}
                  </div>
                ) : (
                  <p className="empty">尚未校验</p>
                )}

              </article>
            </div>
          )}
          </div>

          <DiffDrawer
            open={diffOpen}
            onClose={() => setDiffOpen(false)}
            title="Connector Guide Diff"
            objectLabel={detail.connectorKey}
            language="markdown"
            beforeText={[
              revision?.serverInstructionsMarkdown || '',
              revision?.guideReminderMarkdown || '',
              revision?.blockingRulesMarkdown || '',
              revision?.notes || '',
            ].join('\\n\\n---\\n\\n')}
            afterText={[
              editor.serverInstructionsMarkdown,
              editor.guideReminderMarkdown,
              editor.blockingRulesMarkdown,
              editor.notes,
            ].join('\\n\\n---\\n\\n')}
            fields={[
              {
                key: 'description',
                label: '说明',
                before: detail.description || '-',
                after: editor.description || '-',
                changeType: (detail.description || '') === editor.description ? 'unchanged' : 'changed',
              },
              {
                key: 'triggerMode',
                label: '触发模式',
                before: triggerModeLabel(detail.triggerMode),
                after: triggerModeLabel(editor.triggerMode),
                changeType: detail.triggerMode === editor.triggerMode ? 'unchanged' : 'changed',
              },
              {
                key: 'status',
                label: '状态',
                before: guideStatusLabel(detail.status),
                after: guideStatusLabel(editor.status),
                changeType: detail.status === editor.status ? 'unchanged' : 'changed',
              },
            ]}
            impactItems={[
              `影响 ${detail.connectorKey} 的 guide 文本与触发策略`,
              '发布前会保存当前 revision 文本',
              '不修改 Connector Catalog',
            ]}
            rollbackHint="可通过 Revision 历史回滚到已有真实版本。"
            syncHint="Before 使用当前选中 revision/detail，After 使用编辑器内容。"
          />
        </AdminDetailShell>
      ) : null}
      <ConfirmDialog
        open={discardConfirmOpen}
        title="确认退出编辑？"
        description="当前修改尚未保存，退出后将丢弃所有更改。"
        confirmLabel="丢弃修改"
        cancelLabel="继续编辑"
        onCancel={() => setDiscardConfirmOpen(false)}
        onConfirm={confirmDiscard}
      />
      {inlineConfirm ? (
        <DangerConfirmDialog
          open={Boolean(inlineConfirm)}
          title={inlineConfirm.kind === 'publish' ? '确认发布 Connector Guide' : '确认回滚 Connector Guide'}
          objectLabel="Connector Guide"
          objectId={inlineConfirm.revisionId}
          objectName={inlineConfirm.label}
          objectMeta={[
            { label: 'Policy', value: inlineConfirm.policyId },
            { label: '当前 published', value: inlineConfirm.publishedLabel },
          ]}
          actionLabel={inlineConfirm.kind === 'publish' ? '发布当前 revision' : '回滚到此版本'}
          impactItems={
            inlineConfirm.kind === 'publish'
              ? ['该 connector 的 guide 将发布为当前生效内容', '发布前会先保存编辑器中当前 revision 文本']
              : ['该 connector 的 published revision 会切换到目标历史版本', '当前编辑选择会同步到回滚后的 revision']
          }
          nonImpactItems={['不修改业务 API', '审计原因仅前端收集，不随当前 API 提交']}
          reversibility="partially_reversible"
          confirmText={inlineConfirm.label}
          loading={busy}
          onCancel={() => setInlineConfirm(null)}
          onConfirm={() => {
            if (inlineConfirm.kind === 'publish') {
              void publishRevision(inlineConfirm);
            } else {
              void rollbackRevision(inlineConfirm);
            }
          }}
        />
      ) : null}
    </main>
  );
}
