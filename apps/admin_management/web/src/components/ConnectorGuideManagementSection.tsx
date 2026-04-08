import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type {
  ConnectorGuidePolicy,
  ConnectorGuidePolicyDetail,
  ConnectorGuideRevision,
  ConnectorGuideValidationResult,
} from '../types';

type Props = {
  onError: (message: string | null) => void;
};

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

export function ConnectorGuideManagementSection({ onError }: Props) {
  const [policies, setPolicies] = useState<ConnectorGuidePolicy[]>([]);
  const [selectedPolicyId, setSelectedPolicyId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConnectorGuidePolicyDetail | null>(null);
  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState>(EMPTY_EDITOR);
  const [validationResult, setValidationResult] = useState<ConnectorGuideValidationResult | null>(null);
  const [filters, setFilters] = useState({
    connectorKey: '',
    status: 'all',
    query: '',
  });
  const [busy, setBusy] = useState(false);

  const revision = useMemo(
    () => detail?.revisions.find((item) => item.id === selectedRevisionId) || detail?.publishedRevision || null,
    [detail, selectedRevisionId]
  );

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

  const loadDetail = useCallback(
    async (policyId: string) => {
      const next = await api.getConnectorGuidePolicy(policyId);
      setDetail(next);
      const nextRevisionId = next.publishedRevision?.id || next.revisions[0]?.id || null;
      setSelectedRevisionId(nextRevisionId);
      setEditor(toEditorState(next, next.publishedRevision || next.revisions[0] || null));
      setValidationResult(null);
      onError(null);
    },
    [onError]
  );

  useEffect(() => {
    void loadPolicies().catch((error) => {
      onError(error instanceof Error ? error.message : 'connector guide 列表加载失败');
    });
  }, [loadPolicies, onError]);

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

  const connectorOptions = ['github', 'supabase', 'vercel'];

  const createPolicy = async (connectorKey: string) => {
    setBusy(true);
    try {
      const policy = await api.createConnectorGuidePolicy({
        connectorKey,
        triggerMode: 'on_attach',
        description: `${connectorKey} connector guide policy`,
        createdBy: 'admin_management',
      });
      await loadPolicies();
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
      if (!revision) {
        const created = await api.createConnectorGuideRevision(detail.id, {
          createdBy: 'admin_management',
        });
        setSelectedRevisionId(created.id);
      }
      const targetRevisionId = revision?.id || selectedRevisionId;
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
      setValidationResult(result);
      await loadDetail(detail.id);
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

  return (
    <main className="content-stack">
      <section className="panel fade-in">
        <div className="section-heading">
          <div>
            <p className="eyebrow">连接器引导规则</p>
            <h2>连接器 Guide 管理</h2>
            <p className="subtitle">管理 GitHub / Supabase / Vercel 的隐式 guide 文本，并控制发布版本。</p>
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
            <button type="button" className="primary-btn" disabled={busy} onClick={() => void loadPolicies()}>
              刷新列表
            </button>
          </div>
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
          <button type="button" className="ghost-btn" disabled={busy} onClick={() => void loadPolicies()}>
            应用筛选
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

            <article className="sub-panel">
              <div className="editor-header">
                <div>
                  <h3>Revision 历史</h3>
                  <p className="cell-subtle">可切换 revision 查看并回滚到历史发布版本。</p>
                </div>
              </div>
              <div className="skill-list">
                <table className="skill-table">
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
                        <td onClick={() => setSelectedRevisionId(item.id)}>
                          <strong>v{item.versionNumber}</strong>
                          <div className="cell-subtle">{formatDateTime(item.createdAt)}</div>
                        </td>
                        <td onClick={() => setSelectedRevisionId(item.id)}>
                          <span className={`status-pill status-${item.status}`}>{item.status}</span>
                        </td>
                        <td onClick={() => setSelectedRevisionId(item.id)}>{formatDateTime(item.publishedAt)}</td>
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
