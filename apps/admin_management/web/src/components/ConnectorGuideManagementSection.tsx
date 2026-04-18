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

type Props = {
  onError: (message: string | null) => void;
  onUpdatedAtChange?: (value: string | null) => void;
  onRegisterRefresh?: (handler: (() => Promise<void>) | null) => void;
  persistedState?: ConnectorGuideManagementViewState | null;
  onStateChange?: (state: ConnectorGuideManagementViewState) => void;
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

export function ConnectorGuideManagementSection({
  onError,
  onUpdatedAtChange,
  onRegisterRefresh,
  persistedState,
  onStateChange,
}: Props) {
  const initialState = persistedState || DEFAULT_CONNECTOR_GUIDE_MANAGEMENT_VIEW_STATE;
  const [policies, setPolicies] = useState<ConnectorGuidePolicy[]>([]);
  const [catalogSummary, setCatalogSummary] = useState<ConnectorGuideCatalogSummary | null>(null);
  const [selectedPolicyId, setSelectedPolicyId] = useState<string | null>(initialState.selectedPolicyId);
  const [detail, setDetail] = useState<ConnectorGuidePolicyDetail | null>(null);
  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(initialState.selectedRevisionId);
  const [editor, setEditor] = useState<EditorState>(EMPTY_EDITOR);
  const [validationResult, setValidationResult] = useState<ConnectorGuideValidationResult | null>(null);
  const [filters, setFilters] = useState(initialState.filters);
  const [busy, setBusy] = useState(false);
  const selectedRevisionIdRef = useRef<string | null>(initialState.selectedRevisionId);

  const revision = useMemo(
    () => detail?.revisions.find((item) => item.id === selectedRevisionId) || detail?.publishedRevision || null,
    [detail, selectedRevisionId]
  );

  const catalogVisibleItems = useMemo(
    () => (catalogSummary?.items || []).filter((item) => item.visibleInMenu && item.available),
    [catalogSummary?.items]
  );

  const connectorOptions = useMemo(() => {
    const candidates = new Set<string>();
    catalogVisibleItems.forEach((item) => candidates.add(item.key));
    policies.forEach((policy) => candidates.add(policy.connectorKey));
    return Array.from(candidates).sort((left, right) => left.localeCompare(right));
  }, [catalogVisibleItems, policies]);

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

  const refreshOverview = useCallback(async () => {
    await Promise.all([loadPolicies(), loadCatalogSummary()]);
  }, [loadCatalogSummary, loadPolicies]);

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
    }
  };

  const publishRevision = async () => {
    if (!detail || !revision) return;
    setBusy(true);
    try {
      await api.updateConnectorGuideRevision(detail.id, revision.id, {
        serverInstructionsMarkdown: editor.serverInstructionsMarkdown,
        guideReminderMarkdown: editor.guideReminderMarkdown,
        blockingRulesMarkdown: editor.blockingRulesMarkdown,
        notes: editor.notes,
      });
      await api.publishConnectorGuideRevision(detail.id, revision.id);
      await loadDetail(detail.id);
      setValidationResult(null);
    } catch (error) {
      onError(error instanceof Error ? error.message : '发布 connector guide 失败');
    } finally {
      setBusy(false);
    }
  };

  const rollbackRevision = async (revisionId: string) => {
    if (!detail) return;
    setBusy(true);
    try {
      await api.rollbackConnectorGuideRevision(detail.id, revisionId);
      await loadDetail(detail.id);
      setSelectedRevisionId(revisionId);
      setValidationResult(null);
    } catch (error) {
      onError(error instanceof Error ? error.message : '回滚 connector guide 失败');
    } finally {
      setBusy(false);
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

  return (
    <main className="content-stack">
      <section className="panel fade-in">
        <div className="section-heading">
          <div>
            <p className="eyebrow">连接器引导规则</p>
            <h2>连接器 Guide 管理</h2>
            <p className="subtitle">管理已接入 connector 的隐式 guide 文本，并控制发布版本。</p>
          </div>
          <div className="section-actions">
            {connectorOptions.map((item) => (
              <button
                key={item}
                type="button"
                className="ghost-btn"
                disabled={busy || policies.some((policy) => policy.connectorKey === item)}
                onClick={() => void createPolicy(item)}
              >
                新建 {item}
              </button>
            ))}
            <button type="button" className="primary-btn" disabled={busy} onClick={() => void handleRefresh()}>
              同步列表
            </button>
          </div>
        </div>

        <div className="detail-grid modal-grid" style={{ marginBottom: 20 }}>
          <article className="sub-panel">
            <div className="editor-header">
              <div>
                <h3>MCP Catalog 快照</h3>
                <p className="cell-subtle">页面进入后立即获取一次，后续通过“同步列表”手动同步。</p>
              </div>
            </div>
            <div className="signal-list">
              <p>
                <strong>MCP 类型数量:</strong> {catalogSummary?.stats.total ?? '-'}
              </p>
              <p>
                <strong>可用 / 不可用:</strong>{' '}
                {catalogSummary ? `${catalogSummary.stats.available} / ${catalogSummary.stats.unavailable}` : '-'}
              </p>
              <p>
                <strong>类型列表:</strong> {catalogKeySummary}
              </p>
              <p>
                <strong>更新时间:</strong> {formatDateTime(catalogSummary?.updatedAt)}
              </p>
            </div>
          </article>

          <article className="sub-panel">
            <div className="editor-header">
              <div>
                <h3>可见 Connector</h3>
                <p className="cell-subtle">展示当前 catalog 中可见的 connector 与可用性状态。</p>
              </div>
            </div>
            <div className="signal-list">
              {catalogVisibleItems.length === 0 ? (
                <p className="empty">还没有 catalog 快照。</p>
              ) : (
                catalogVisibleItems.map((item: ConnectorCatalogItem) => (
                  <p key={item.key}>
                    <strong>{item.key}</strong> · {item.name} · {item.available ? '可用' : item.availabilityReason || '不可用'}
                  </p>
                ))
              )}
            </div>
          </article>
        </div>

        <div className="skill-toolbar">
          <select
            className="control-input"
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
                    onClick={() => setSelectedPolicyId(item.id)}
                  >
                    <td>
                      <strong>{item.connectorKey}</strong>
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

      {detail ? (
        <section className="panel fade-in">
          <div className="section-heading">
            <div>
              <p className="eyebrow">连接器引导规则编辑器</p>
              <h2>{detail.connectorKey}</h2>
              <p className="subtitle">
                当前 published: {detail.publishedRevision ? `v${detail.publishedRevision.versionNumber}` : '未发布'} ·
                更新时间 {formatDateTime(detail.updatedAt)}
              </p>
            </div>
            <div className="section-actions">
              <button type="button" className="ghost-btn" disabled={busy} onClick={() => void createRevision()}>
                新建 revision
              </button>
              <button type="button" className="ghost-btn" disabled={busy || !revision} onClick={() => void validateRevision()}>
                校验
              </button>
              <button type="button" className="primary-btn" disabled={busy || !revision} onClick={() => void publishRevision()}>
                发布当前 revision
              </button>
            </div>
          </div>

          <div className="detail-grid modal-grid">
            <article className="sub-panel">
              <div className="editor-header">
                <div>
                  <h3>Policy 配置</h3>
                  <p className="cell-subtle">Policy 元数据不会进入现有 skills 模块。</p>
                </div>
              </div>
              <div className="skill-form-grid">
                <label className="form-field">
                  <span>连接器标识</span>
                  <input className="control-input" value={detail.connectorKey} disabled />
                </label>
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

              <div className="editor-header" style={{ marginTop: 20 }}>
                <div>
                  <h3>Revision 文本</h3>
                  <p className="cell-subtle">
                    当前编辑版本：{revision ? `v${revision.versionNumber} · ${guideStatusLabel(revision.status)}` : '暂无版本'}
                  </p>
                </div>
              </div>

              <div className="skill-form-grid">
                <label className="form-field field-span-2">
                  <span>服务端说明 Markdown</span>
                  <textarea
                    className="control-textarea"
                    rows={10}
                    value={editor.serverInstructionsMarkdown}
                    onChange={(event) =>
                      setEditor((prev) => ({ ...prev, serverInstructionsMarkdown: event.target.value }))
                    }
                  />
                </label>
                <label className="form-field field-span-2">
                  <span>引导提醒 Markdown</span>
                  <textarea
                    className="control-textarea"
                    rows={8}
                    value={editor.guideReminderMarkdown}
                    onChange={(event) =>
                      setEditor((prev) => ({ ...prev, guideReminderMarkdown: event.target.value }))
                    }
                  />
                </label>
                <label className="form-field field-span-2">
                  <span>阻断规则 Markdown</span>
                  <textarea
                    className="control-textarea"
                    rows={8}
                    value={editor.blockingRulesMarkdown}
                    onChange={(event) =>
                      setEditor((prev) => ({ ...prev, blockingRulesMarkdown: event.target.value }))
                    }
                  />
                </label>
                <label className="form-field field-span-2">
                  <span>notes</span>
                  <textarea
                    className="control-textarea"
                    rows={4}
                    value={editor.notes}
                    onChange={(event) => setEditor((prev) => ({ ...prev, notes: event.target.value }))}
                  />
                </label>
              </div>

              <div className="section-actions" style={{ marginTop: 16 }}>
                <button type="button" className="ghost-btn" disabled={busy} onClick={() => void savePolicy()}>
                  保存当前内容
                </button>
              </div>
            </article>

            <article className="sub-panel connector-guide-sidebar-panel">
              <div className="editor-header">
                <div>
                  <h3>Revision 历史</h3>
                  <p className="cell-subtle">可切换 revision 查看并回滚到历史发布版本。</p>
                </div>
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
                          <button
                            type="button"
                            className="ghost-btn"
                            disabled={busy || item.status === 'published'}
                            onClick={() => void rollbackRevision(item.id)}
                          >
                            回滚到此版本
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="editor-header" style={{ marginTop: 20 }}>
                <div>
                  <h3>校验结果</h3>
                  <p className="cell-subtle">只做 connector-domain 文本校验，不触碰现有 skills 模块。</p>
                </div>
              </div>
              {validationResult ? (
                <div className="signal-list">
                  <p>
                    <strong>valid:</strong> {String(validationResult.valid)}
                  </p>
                  <p>
                    <strong>errors:</strong> {validationResult.errors.length ? validationResult.errors.join('；') : '-'}
                  </p>
                  <p>
                    <strong>warnings:</strong>{' '}
                    {validationResult.warnings.length ? validationResult.warnings.join('；') : '-'}
                  </p>
                </div>
              ) : (
                <p className="empty">还没有校验结果。</p>
              )}
            </article>
          </div>
        </section>
      ) : null}
    </main>
  );
}
