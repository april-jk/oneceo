import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type {
  SkillDetail,
  SkillRenderedRevision,
  SkillRevision,
  SkillSummary,
  SkillValidationResult,
} from '../types';

type EditorState = {
  slug: string;
  name: string;
  description: string;
  category: string;
  bodyMarkdown: string;
};

const EMPTY_EDITOR: EditorState = {
  slug: '',
  name: '',
  description: '',
  category: 'general',
  bodyMarkdown: '',
};

function toEditorState(detail: SkillDetail): EditorState {
  return {
    slug: detail.slug,
    name: detail.name,
    description: detail.description || '',
    category: detail.category || 'general',
    bodyMarkdown: detail.latestBodyMarkdown || '',
  };
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

type Props = {
  onError: (message: string | null) => void;
};

export function SkillManagementSection({ onError }: Props) {
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [revisions, setRevisions] = useState<SkillRevision[]>([]);
  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(null);
  const [renderedRevision, setRenderedRevision] = useState<SkillRenderedRevision | null>(null);
  const [validationResult, setValidationResult] = useState<SkillValidationResult | null>(null);
  const [validationSessionId, setValidationSessionId] = useState('');
  const [filters, setFilters] = useState({
    query: '',
    status: 'all',
    category: '',
  });
  const [editor, setEditor] = useState<EditorState>(EMPTY_EDITOR);
  const [isCreating, setIsCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  const categoryOptions = useMemo(() => {
    const categories = new Set<string>();
    for (const item of skills) {
      if (item.category) categories.add(item.category);
    }
    return Array.from(categories).sort((a, b) => a.localeCompare(b));
  }, [skills]);

  const loadSkills = useCallback(async () => {
    const next = await api.listSkills({
      query: filters.query || undefined,
      status: filters.status !== 'all' ? filters.status : undefined,
      category: filters.category || undefined,
    });
    setSkills(next);
    onError(null);
    if (!next.length) {
      setSelectedSkillId(null);
      setDetail(null);
      setRevisions([]);
      setSelectedRevisionId(null);
      setRenderedRevision(null);
      return;
    }
    if (!selectedSkillId || !next.some((item) => item.id === selectedSkillId)) {
      setSelectedSkillId(next[0].id);
    }
  }, [filters.category, filters.query, filters.status, onError, selectedSkillId]);

  const loadSkillDetail = useCallback(
    async (skillId: string) => {
      const [nextDetail, nextRevisions] = await Promise.all([
        api.getSkill(skillId),
        api.listSkillRevisions(skillId),
      ]);
      setDetail(nextDetail);
      setRevisions(nextRevisions);
      setEditor(toEditorState(nextDetail));
      const publishedRevision =
        nextRevisions.find((item) => item.isPublished) || nextRevisions[0] || null;
      const nextRevisionId = publishedRevision?.id || null;
      setSelectedRevisionId(nextRevisionId);
      setValidationResult(null);
      onError(null);
      if (nextRevisionId) {
        const rendered = await api.getRenderedSkillRevision(skillId, nextRevisionId);
        setRenderedRevision(rendered);
      } else {
        setRenderedRevision(null);
      }
    },
    [onError]
  );

  useEffect(() => {
    void loadSkills().catch((error) => {
      onError(error instanceof Error ? error.message : '技能列表加载失败');
    });
  }, [loadSkills, onError]);

  useEffect(() => {
    if (!selectedSkillId) return;
    void loadSkillDetail(selectedSkillId).catch((error) => {
      onError(error instanceof Error ? error.message : '技能详情加载失败');
    });
  }, [selectedSkillId, loadSkillDetail, onError]);

  useEffect(() => {
    if (!selectedSkillId || !selectedRevisionId) return;
    void api
      .getRenderedSkillRevision(selectedSkillId, selectedRevisionId)
      .then(setRenderedRevision)
      .catch((error) => {
        onError(error instanceof Error ? error.message : '技能渲染内容加载失败');
      });
  }, [selectedRevisionId, selectedSkillId, onError]);

  const handleCreate = async () => {
    setBusy(true);
    try {
      const created = await api.createSkill({
        ...editor,
        createdBy: 'admin_management',
      });
      setIsCreating(false);
      await loadSkills();
      setSelectedSkillId(created.id);
    } catch (error) {
      onError(error instanceof Error ? error.message : '创建技能失败');
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    if (!selectedSkillId || isCreating) return;
    setBusy(true);
    try {
      await api.updateSkill(selectedSkillId, {
        name: editor.name,
        description: editor.description,
        category: editor.category,
        bodyMarkdown: editor.bodyMarkdown,
        createdBy: 'admin_management',
      });
      await loadSkills();
      await loadSkillDetail(selectedSkillId);
    } catch (error) {
      onError(error instanceof Error ? error.message : '保存技能失败');
    } finally {
      setBusy(false);
    }
  };

  const handleArchiveToggle = async () => {
    if (!selectedSkillId || !detail) return;
    setBusy(true);
    try {
      if (detail.status === 'archived') {
        await api.activateSkill(selectedSkillId);
      } else {
        await api.archiveSkill(selectedSkillId);
      }
      await loadSkills();
      await loadSkillDetail(selectedSkillId);
    } catch (error) {
      onError(error instanceof Error ? error.message : '技能状态更新失败');
    } finally {
      setBusy(false);
    }
  };

  const handleValidate = async () => {
    if (!selectedSkillId || !selectedRevisionId || !validationSessionId.trim()) return;
    setBusy(true);
    try {
      const result = await api.validateSkillRevision(
        selectedSkillId,
        selectedRevisionId,
        validationSessionId.trim()
      );
      setValidationResult(result);
      onError(null);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Sandbox 验证失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="content-stack">
      <section className="panel fade-in">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Skill Registry</p>
            <h2>技能管理</h2>
            <p className="subtitle">维护平台注册 skills、revision 与 sandbox 验证。</p>
          </div>
          <div className="section-actions">
            <button
              type="button"
              className="ghost-btn"
              onClick={() => {
                setIsCreating(true);
                setSelectedSkillId(null);
                setDetail(null);
                setRevisions([]);
                setSelectedRevisionId(null);
                setRenderedRevision(null);
                setEditor(EMPTY_EDITOR);
              }}
            >
              新建技能
            </button>
            <button type="button" className="primary-btn" onClick={() => void loadSkills()} disabled={busy}>
              刷新技能
            </button>
          </div>
        </div>

        <div className="skill-toolbar">
          <input
            className="control-input"
            placeholder="按名称 / slug 搜索"
            value={filters.query}
            onChange={(event) => setFilters((prev) => ({ ...prev, query: event.target.value }))}
          />
          <select
            className="control-input"
            value={filters.status}
            onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
          >
            <option value="all">全部状态</option>
            <option value="active">active</option>
            <option value="archived">archived</option>
          </select>
          <select
            className="control-input"
            value={filters.category}
            onChange={(event) => setFilters((prev) => ({ ...prev, category: event.target.value }))}
          >
            <option value="">全部分类</option>
            {categoryOptions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <button type="button" className="ghost-btn" onClick={() => void loadSkills()} disabled={busy}>
            应用筛选
          </button>
        </div>

        <div className="skill-layout">
          <div className="skill-list">
            <table className="skill-table">
              <thead>
                <tr>
                  <th>技能</th>
                  <th>分类</th>
                  <th>状态</th>
                  <th>Published</th>
                </tr>
              </thead>
              <tbody>
                {skills.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="table-empty">
                      暂无技能
                    </td>
                  </tr>
                ) : (
                  skills.map((item) => (
                    <tr
                      key={item.id}
                      className={selectedSkillId === item.id ? 'selected' : ''}
                      onClick={() => {
                        setIsCreating(false);
                        setSelectedSkillId(item.id);
                      }}
                    >
                      <td>
                        <strong>{item.name}</strong>
                        <div className="cell-subtle">{item.slug}</div>
                      </td>
                      <td>{item.category}</td>
                      <td>
                        <span className={`status-pill status-${item.status}`}>{item.status}</span>
                      </td>
                      <td>{item.publishedRevisionNumber ? `rev.${item.publishedRevisionNumber}` : '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="skill-editor-card">
            <div className="editor-header">
              <div>
                <h3>{isCreating ? '新建技能' : detail?.name || '技能详情'}</h3>
                <p className="cell-subtle">
                  {isCreating
                    ? '直接创建 skill + revision'
                    : `更新时间 ${formatDateTime(detail?.updatedAt)}`}
                </p>
              </div>
              {!isCreating && detail ? (
                <button type="button" className="ghost-btn" onClick={handleArchiveToggle} disabled={busy}>
                  {detail.status === 'archived' ? '重新启用' : '归档技能'}
                </button>
              ) : null}
            </div>

            <div className="skill-form-grid">
              <label className="form-field">
                <span>Slug</span>
                <input
                  className="control-input"
                  value={editor.slug}
                  disabled={!isCreating}
                  onChange={(event) => setEditor((prev) => ({ ...prev, slug: event.target.value }))}
                />
              </label>
              <label className="form-field">
                <span>名称</span>
                <input
                  className="control-input"
                  value={editor.name}
                  onChange={(event) => setEditor((prev) => ({ ...prev, name: event.target.value }))}
                />
              </label>
              <label className="form-field">
                <span>分类</span>
                <input
                  className="control-input"
                  value={editor.category}
                  onChange={(event) => setEditor((prev) => ({ ...prev, category: event.target.value }))}
                />
              </label>
              <label className="form-field field-span-2">
                <span>描述</span>
                <input
                  className="control-input"
                  value={editor.description}
                  onChange={(event) => setEditor((prev) => ({ ...prev, description: event.target.value }))}
                />
              </label>
              <label className="form-field field-span-2">
                <span>Markdown 正文</span>
                <textarea
                  className="control-textarea"
                  rows={14}
                  value={editor.bodyMarkdown}
                  onChange={(event) => setEditor((prev) => ({ ...prev, bodyMarkdown: event.target.value }))}
                />
              </label>
            </div>

            <div className="section-actions">
              {isCreating ? (
                <button type="button" className="primary-btn" onClick={handleCreate} disabled={busy}>
                  创建并发布
                </button>
              ) : (
                <button type="button" className="primary-btn" onClick={handleSave} disabled={busy || !selectedSkillId}>
                  保存为新 revision
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="skill-secondary-grid">
        <article className="panel fade-in">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Revision History</p>
              <h2>Revision 历史</h2>
            </div>
          </div>
          <div className="revision-list">
            {revisions.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`revision-item ${selectedRevisionId === item.id ? 'active' : ''}`}
                onClick={() => setSelectedRevisionId(item.id)}
              >
                <span>rev.{item.revisionNumber}</span>
                <span>{item.isPublished ? 'published' : 'draft'}</span>
                <span>{formatDateTime(item.createdAt)}</span>
              </button>
            ))}
            {!revisions.length ? <div className="table-empty">暂无 revision</div> : null}
          </div>
        </article>

        <article className="panel fade-in">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Sandbox Validation</p>
              <h2>Sandbox 验证</h2>
            </div>
          </div>
          <div className="validation-box">
            <label className="form-field">
              <span>目标 sessionId</span>
              <input
                className="control-input"
                placeholder="输入已有 task sessionId"
                value={validationSessionId}
                onChange={(event) => setValidationSessionId(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="primary-btn"
              onClick={handleValidate}
              disabled={busy || !selectedSkillId || !selectedRevisionId || !validationSessionId.trim()}
            >
              同步到 sandbox 并验证
            </button>
            <pre className="code-block">{renderedRevision?.renderedMarkdown || '选择 revision 后显示渲染结果'}</pre>
            {validationResult ? (
              <div className="validation-result">
                <div>skillPath: {validationResult.skillPath || '-'}</div>
                <div>signature: {validationResult.signature}</div>
                <div>restartTriggered: {String(validationResult.restartTriggered)}</div>
                <div>syncedAt: {formatDateTime(validationResult.syncedAt)}</div>
              </div>
            ) : null}
          </div>
        </article>
      </section>
    </main>
  );
}
