import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import type {
  SkillDetail,
  SkillImportPreview,
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

type ImportedFolderPayload = {
  rootFolderName?: string;
  files: Array<{ relativePath: string; content: string }>;
};

type ImportFileStatus = 'pending' | 'success' | 'failed';

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

async function readDirectoryFiles(fileList: FileList): Promise<Array<{ relativePath: string; content: string }>> {
  const files = Array.from(fileList);
  const binaryExtensionPattern =
    /\.(png|jpe?g|gif|webp|bmp|ico|svg|pdf|zip|gz|tgz|tar|7z|rar|woff2?|ttf|otf|eot|mp3|mp4|mov|avi|mkv|webm|exe|dll|so|dylib|bin|class|pyc|pyo|jar|lock)$/i;
  const ignoredPathPattern = /(^|\/)\.(ds_store|gitkeep)$/i;
  const acceptedFiles = files.filter((file) => {
    const relativePath = String((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name);
    if (!relativePath) return false;
    if (ignoredPathPattern.test(relativePath)) return false;
    return !binaryExtensionPattern.test(relativePath);
  });

  return Promise.all(
    acceptedFiles.map(async (file) => ({
      relativePath: String((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name).replace(
        /^[^/]+\//,
        ''
      ),
      content: await file.text(),
    }))
  );
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
  const [importPreview, setImportPreview] = useState<SkillImportPreview | null>(null);
  const [importPayload, setImportPayload] = useState<ImportedFolderPayload | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importFileStatuses, setImportFileStatuses] = useState<Record<string, ImportFileStatus>>({});
  const [importJobId, setImportJobId] = useState<string | null>(null);
  const [importJobStatus, setImportJobStatus] = useState<'pending' | 'running' | 'completed' | 'failed' | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const resetImportState = useCallback(() => {
    setImportPreview(null);
    setImportPayload(null);
    setImportDialogOpen(false);
    setImportFileStatuses({});
    setImportJobId(null);
    setImportJobStatus(null);
  }, []);

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

  useEffect(() => {
    if (!importDialogOpen || !importJobId) return;
    let stopped = false;
    const timer = window.setInterval(() => {
      void api
        .getSkillFolderImportJob(importJobId)
        .then(async (job) => {
          if (stopped) return;
          setImportJobStatus(job.status);
          setImportFileStatuses(
            Object.fromEntries(
              job.files.map((item) => [
                item.relativePath,
                item.processingState === 'processing' ? 'pending' : item.processingState,
              ])
            )
          );
          if (job.status === 'completed' && job.result) {
            setImportPreview(job.result.preview);
            setIsCreating(false);
            await loadSkills();
            setSelectedSkillId(job.result.skill.id);
            onError(null);
          }
          if (job.status === 'failed') {
            onError(job.error || '导入技能文件夹失败');
          }
          if (job.status === 'completed' || job.status === 'failed') {
            window.clearInterval(timer);
          }
        })
        .catch((error) => {
          if (stopped) return;
          window.clearInterval(timer);
          onError(error instanceof Error ? error.message : '导入任务状态获取失败');
        });
    }, 500);

    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [importDialogOpen, importJobId, loadSkills, onError]);

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
                resetImportState();
                setEditor(EMPTY_EDITOR);
              }}
            >
              新建技能
            </button>
            <input
              ref={importInputRef}
              type="file"
              multiple
              // @ts-expect-error non-standard browser directory picker.
              webkitdirectory="true"
              style={{ display: 'none' }}
              onChange={(event) => {
                const files = event.currentTarget.files;
                if (!files?.length) return;
                setBusy(true);
                void readDirectoryFiles(files)
                  .then((items) => {
                    const payload = {
                      rootFolderName: String(
                        (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath || ''
                      ).split('/')[0],
                      files: items,
                    };
                    setImportPayload(payload);
                    return api.previewSkillFolderImport(payload);
                  })
                  .then((preview) => {
                    setImportPreview(preview);
                    setImportDialogOpen(true);
                    setImportFileStatuses(
                      Object.fromEntries(preview.files.map((item) => [item.relativePath, item.processingState]))
                    );
                    setIsCreating(true);
                    setSelectedSkillId(null);
                    setDetail(null);
                    setRevisions([]);
                    setSelectedRevisionId(null);
                    setRenderedRevision(null);
                    setEditor({
                      slug: preview.slug,
                      name: preview.name,
                      description: preview.discoveryDescription,
                      category: 'general',
                      bodyMarkdown: preview.entry.bodyMarkdown,
                    });
                    onError(null);
                  })
                  .catch((error) => {
                    setImportPayload(null);
                    onError(error instanceof Error ? error.message : '技能文件夹导入预览失败');
                  })
                  .finally(() => {
                    setBusy(false);
                    event.currentTarget.value = '';
                  });
              }}
            />
            <button type="button" className="ghost-btn" onClick={() => importInputRef.current?.click()} disabled={busy}>
              导入技能文件夹
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
      {importDialogOpen && importPreview ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.55)',
            display: 'grid',
            placeItems: 'center',
            padding: 24,
            zIndex: 40,
          }}
        >
          <div
            className="panel fade-in"
            style={{
              width: 'min(1080px, 100%)',
              maxHeight: '86vh',
              overflow: 'auto',
            }}
          >
            <div className="section-heading">
              <div>
                <p className="eyebrow">Import Preview</p>
                <h2>技能文件夹导入</h2>
                <p className="subtitle">
                  入口正文会进入数据库，脚本等运行型资源后续按存储策略处理。当前目录共 {importPreview.files.length} 个待处理文件。
                </p>
              </div>
              <div className="section-actions">
                <button type="button" className="ghost-btn" onClick={resetImportState} disabled={busy}>
                  关闭
                </button>
                <button
                  type="button"
                  className="primary-btn"
                  disabled={busy || !importPayload || importJobStatus === 'running'}
                  onClick={() => {
                    if (!importPayload) return;
                    setBusy(true);
                    setImportFileStatuses(
                      Object.fromEntries(importPreview.files.map((item) => [item.relativePath, 'pending']))
                    );
                    void api
                      .createSkillFolderImportJob({
                        ...importPayload,
                        createdBy: 'admin_management',
                        ...(isCreating ? {} : selectedSkillId ? { skillId: selectedSkillId } : {}),
                      })
                      .then((job) => {
                        setImportJobId(job.jobId);
                        setImportJobStatus(job.status);
                        setImportPreview(job.preview);
                        setImportFileStatuses(
                          Object.fromEntries(
                            job.files.map((item) => [
                              item.relativePath,
                              item.processingState === 'processing' ? 'pending' : item.processingState,
                            ])
                          )
                        );
                        onError(null);
                      })
                      .catch((error) => {
                        setImportJobStatus('failed');
                        setImportFileStatuses(Object.fromEntries(importPreview.files.map((item) => [item.relativePath, 'failed'])));
                        onError(error instanceof Error ? error.message : '导入技能文件夹失败');
                      })
                      .finally(() => {
                        setBusy(false);
                      });
                  }}
                >
                  {importJobStatus === 'running' ? '导入处理中...' : isCreating ? '导入并创建 skill' : '导入为新 revision'}
                </button>
              </div>
            </div>

            <div className="skill-secondary-grid">
              <article className="panel fade-in">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">File Tree</p>
                    <h2>待处理文件</h2>
                  </div>
                </div>
                <div className="revision-list">
                  <div className="revision-item active" style={{ display: 'grid', gap: 8 }}>
                    <strong>{importPreview.rootFolderName || importPreview.slug}</strong>
                  </div>
                  {importPreview.files.map((file) => {
                    const depth = Math.max(1, file.relativePath.split('/').length);
                    const status = importFileStatuses[file.relativePath] || file.processingState;
                    const statusLabel =
                      status === 'success' ? '成功' : status === 'failed' ? '失败' : '处理中';
                    const statusColor =
                      status === 'success' ? '#16a34a' : status === 'failed' ? '#dc2626' : '#64748b';
                    return (
                      <div
                        key={file.relativePath}
                        className="revision-item"
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'minmax(0,1fr) auto auto',
                          gap: 12,
                          alignItems: 'center',
                          paddingLeft: depth * 14,
                        }}
                      >
                        <span>{file.relativePath}</span>
                        <span className="cell-subtle">
                          {'->'} {file.storageTarget === 'database' ? '数据库' : '存储桶'}
                        </span>
                        <span style={{ color: statusColor, fontWeight: 600 }}>
                          {status === 'pending' ? '◌' : status === 'success' ? '●' : '●'} {statusLabel}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </article>

              <article className="panel fade-in">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Activation</p>
                    <h2>入口与告警</h2>
                  </div>
                </div>
                <div className="validation-box">
                  <div>jobStatus: {importJobStatus || 'idle'}</div>
                  <div>slug: {importPreview.slug}</div>
                  <div>name: {importPreview.name}</div>
                  <div>entry: {importPreview.entry.entryName}</div>
                  <div>summary: {importPreview.activationSummary || '-'}</div>
                  <pre className="code-block">{importPreview.entry.bodyMarkdown}</pre>
                  {importPreview.warnings.length ? (
                    <pre className="code-block">{importPreview.warnings.join('\n')}</pre>
                  ) : null}
                </div>
              </article>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
