import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import type {
  SkillDetail,
  SkillImportPreview,
  SkillRenderedRevision,
  SkillRevision,
  SkillRevisionResources,
  SkillSummary,
  SkillValidationResult,
} from '../types';

type EditorState = {
  slug: string;
  name: string;
  description: string;
  category: string;
  bodyMarkdown: string;
  documents: Array<{
    documentKey: string;
    resourcePath: string;
    resourceType: 'reference' | 'template';
    title: string;
    summary: string;
    bodyMarkdown: string;
  }>;
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
  documents: [],
};

const DEFAULT_CATEGORY_OPTIONS = ['general', 'office', 'engineering', 'ops', 'design'];

function toEditorState(detail: SkillDetail): EditorState {
  return {
    slug: detail.slug,
    name: detail.name,
    description: detail.description || '',
    category: detail.category || 'general',
    bodyMarkdown: detail.latestBodyMarkdown || '',
    documents: [],
  };
}

const EMPTY_DOCUMENT = {
  documentKey: '',
  resourcePath: '',
  resourceType: 'reference' as const,
  title: '',
  summary: '',
  bodyMarkdown: '',
};

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function formatBytes(value?: number | null) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function skillStatusLabel(status?: string | null) {
  if (status === 'active') return '启用';
  if (status === 'archived') return '已归档';
  if (status === 'draft') return '草稿';
  if (status === 'published') return '已发布';
  return status || '-';
}

function resourceTypeLabel(value?: string | null) {
  if (value === 'template') return '模板片段';
  if (value === 'reference') return '参考文档';
  return value || '-';
}

function storageLabel(value?: string | null) {
  return value === 'object_storage' ? '存储桶' : '数据库';
}

function skillCategoryLabel(category?: string | null) {
  if (category === 'general') return '通用';
  if (category === 'office') return '办公';
  if (category === 'engineering') return '工程';
  if (category === 'ops') return '运维';
  if (category === 'design') return '设计';
  return category || '-';
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
  const [revisionResources, setRevisionResources] = useState<SkillRevisionResources | null>(null);
  const [selectedResourcePath, setSelectedResourcePath] = useState<string | null>(null);
  const [validationResult, setValidationResult] = useState<SkillValidationResult | null>(null);
  const [validationSessionId, setValidationSessionId] = useState('');
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [detailTab, setDetailTab] = useState<'editor' | 'resources' | 'rendered' | 'validation'>('editor');
  const [filters, setFilters] = useState({
    query: '',
    status: 'all',
    category: '',
  });
  const [editor, setEditor] = useState<EditorState>(EMPTY_EDITOR);
  const [selectedDocumentIndex, setSelectedDocumentIndex] = useState(0);
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
    const categories = new Set<string>(DEFAULT_CATEGORY_OPTIONS);
    for (const item of skills) {
      if (item.category) categories.add(item.category);
    }
    return Array.from(categories).sort((a, b) => skillCategoryLabel(a).localeCompare(skillCategoryLabel(b), 'zh-Hans-CN'));
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
      setRevisionResources(null);
      setSelectedResourcePath(null);
      setSelectedDocumentIndex(0);
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
      setSelectedDocumentIndex(0);
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
    if (!selectedSkillId || !selectedRevisionId || !detailDialogOpen || isCreating) {
      setRevisionResources(null);
      setSelectedResourcePath(null);
      return;
    }
    void api
      .getSkillRevisionResources(selectedSkillId, selectedRevisionId)
      .then((next) => {
        setRevisionResources(next);
        setSelectedResourcePath((prev) => {
          if (prev && next.resources.some((item) => item.resourcePath === prev)) {
            return prev;
          }
          return next.resources[0]?.resourcePath || null;
        });
        setEditor((prev) => ({
          ...prev,
          documents: next.resources
            .filter((item) => item.contentStorage === 'database')
            .map((item, index) => ({
              documentKey: item.resourceKey || `doc-${index + 1}`,
              resourcePath: item.resourcePath,
              resourceType: item.resourceType === 'template' ? 'template' : 'reference',
              title: item.title || item.resourcePath.split('/').pop() || item.resourcePath,
              summary: item.summary || '',
              bodyMarkdown: item.contentMarkdown || '',
            })),
        }));
        setSelectedDocumentIndex(0);
      })
      .catch((error) => {
        onError(error instanceof Error ? error.message : '技能资源加载失败');
      });
  }, [detailDialogOpen, isCreating, onError, selectedRevisionId, selectedSkillId]);

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
            setDetailDialogOpen(true);
            setDetailTab('resources');
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

  const openCreateDialog = () => {
    setIsCreating(true);
    setDetailDialogOpen(true);
    setDetailTab('editor');
    setSelectedSkillId(null);
    setDetail(null);
    setRevisions([]);
    setSelectedRevisionId(null);
    setRenderedRevision(null);
    setRevisionResources(null);
    setSelectedResourcePath(null);
    setValidationResult(null);
    resetImportState();
    setEditor(EMPTY_EDITOR);
  };

  const openDetailDialog = (skillId: string) => {
    setIsCreating(false);
    setDetailDialogOpen(true);
    setDetailTab('editor');
    setSelectedSkillId(skillId);
  };

  const closeDetailDialog = () => {
    setDetailDialogOpen(false);
    setDetailTab('editor');
    setRevisionResources(null);
    setSelectedResourcePath(null);
    setValidationResult(null);
    if (isCreating) {
      setIsCreating(false);
      setEditor(EMPTY_EDITOR);
    }
  };

  const handleCreate = async () => {
    setBusy(true);
    try {
      const created = await api.createSkill({
        ...editor,
        resources: editor.documents
          .map((item, index) => ({
            resourcePath: item.resourcePath.trim(),
            resourceType: item.resourceType,
            contentMarkdown: item.bodyMarkdown,
          }))
          .filter((item) => item.resourcePath && item.contentMarkdown.trim()),
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
        resources: editor.documents
          .map((item) => ({
            resourcePath: item.resourcePath.trim(),
            resourceType: item.resourceType,
            contentMarkdown: item.bodyMarkdown,
          }))
          .filter((item) => item.resourcePath && item.contentMarkdown.trim()),
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
      onError(error instanceof Error ? error.message : '沙箱校验失败');
    } finally {
      setBusy(false);
    }
  };

  const selectedDocument = editor.documents[selectedDocumentIndex] || null;

  const selectedRevisionLabel = selectedRevisionId
    ? `版本 ${revisions.find((item) => item.id === selectedRevisionId)?.revisionNumber || '-'}`
    : '未选择版本';

  const updateDocument = (
    index: number,
    patch: Partial<{
      documentKey: string;
      resourcePath: string;
      resourceType: 'reference' | 'template';
      title: string;
      summary: string;
      bodyMarkdown: string;
    }>
  ) => {
    setEditor((prev) => ({
      ...prev,
      documents: prev.documents.map((item, currentIndex) =>
        currentIndex === index ? { ...item, ...patch } : item
      ),
    }));
  };

  const addDocument = () => {
    setEditor((prev) => ({
      ...prev,
      documents: [
        ...prev.documents,
        {
          ...EMPTY_DOCUMENT,
          documentKey: `doc-${prev.documents.length + 1}`,
          resourcePath: `references/doc-${prev.documents.length + 1}.md`,
        },
      ],
    }));
    setSelectedDocumentIndex(editor.documents.length);
  };

  const removeDocument = (index: number) => {
    setEditor((prev) => ({
      ...prev,
      documents: prev.documents.filter((_, currentIndex) => currentIndex !== index),
    }));
    setSelectedDocumentIndex((prev) => Math.max(0, Math.min(prev, editor.documents.length - 2)));
  };

  return (
    <main className="content-stack">
      <section className="panel fade-in">
        <div className="section-heading">
          <div>
            <p className="eyebrow">技能总览</p>
            <h2>技能管理</h2>
            <p className="subtitle">维护平台技能、版本记录、资源文档与沙箱校验。</p>
          </div>
          <div className="section-actions">
            <button
              type="button"
              className="ghost-btn"
              onClick={openCreateDialog}
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
                      documents: preview.resources
                        .filter((item) => item.resourceKind === 'reference' || item.resourceKind === 'template')
                        .map((item, index) => ({
                          documentKey: item.resourceKey || `doc-${index + 1}`,
                          resourcePath: item.resourcePath,
                          resourceType: item.resourceKind === 'template' ? 'template' : 'reference',
                          title: item.title || item.resourcePath,
                          summary: item.summary || '',
                          bodyMarkdown: item.chunks
                            .filter((chunk) => chunk.chunkRole === 'body' || item.chunks.length === 1)
                            .map((chunk) => chunk.contentText)
                            .join(''),
                        })),
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
            placeholder="按名称或 slug 搜索"
            value={filters.query}
            onChange={(event) => setFilters((prev) => ({ ...prev, query: event.target.value }))}
          />
          <select
            className="control-input"
            value={filters.status}
            onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
          >
            <option value="all">全部状态</option>
            <option value="active">启用</option>
            <option value="archived">已归档</option>
          </select>
          <select
            className="control-input"
            value={filters.category}
            onChange={(event) => setFilters((prev) => ({ ...prev, category: event.target.value }))}
          >
              <option value="">全部分类</option>
              {categoryOptions.map((item) => (
                <option key={item} value={item}>
                  {skillCategoryLabel(item)}
                </option>
              ))}
            </select>
          <button type="button" className="ghost-btn" onClick={() => void loadSkills()} disabled={busy}>
            应用筛选
          </button>
        </div>

        <div className="skill-list">
          <table className="skill-table">
            <thead>
              <tr>
                <th>技能</th>
                <th>分类</th>
                <th>状态</th>
                <th>当前版本</th>
              </tr>
            </thead>
            <tbody>
              {skills.length === 0 ? (
                <tr>
                  <td colSpan={4} className="table-empty">
                    暂无技能记录
                  </td>
                </tr>
              ) : (
                skills.map((item) => (
                  <tr
                    key={item.id}
                    className={selectedSkillId === item.id && detailDialogOpen ? 'selected' : ''}
                    onClick={() => openDetailDialog(item.id)}
                  >
                    <td>
                      <strong>{item.name}</strong>
                      <div className="cell-subtle">{item.slug}</div>
                    </td>
                    <td>{skillCategoryLabel(item.category)}</td>
                    <td>
                      <span className={`status-pill status-${item.status}`}>{skillStatusLabel(item.status)}</span>
                    </td>
                    <td>{item.publishedRevisionNumber ? `版本 ${item.publishedRevisionNumber}` : '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {detailDialogOpen ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={closeDetailDialog}>
          <div
            className="modal-card"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
              <div className="modal-header">
                <div>
                  <p className="section-tag">技能详情</p>
                  <h2>{isCreating ? '新建技能' : detail?.name || '技能详情'}</h2>
                  <p className="cell-subtle">
                    {isCreating
                    ? '直接创建平台技能，并在同一窗口完成正文与资源校验'
                    : `${detail?.slug || '-'} · 更新时间 ${formatDateTime(detail?.updatedAt)}`}
                  </p>
                </div>
              <div className="section-actions">
                {!isCreating && detail ? (
                  <button type="button" className="ghost-btn" onClick={handleArchiveToggle} disabled={busy}>
                    {detail.status === 'archived' ? '重新启用' : '归档技能'}
                  </button>
                ) : null}
                <button type="button" className="secondary-btn" onClick={closeDetailDialog}>
                  关闭
                </button>
              </div>
            </div>
            <div className="button-grid modal-tab-grid">
              <button
                type="button"
                className={`inspector-tab-card ${detailTab === 'editor' ? 'active' : ''}`}
                onClick={() => setDetailTab('editor')}
              >
                <span className="inspector-tab-card-key mono">01</span>
                <span className="inspector-tab-card-label">内容与版本</span>
              </button>
              <button
                type="button"
                className={`inspector-tab-card ${detailTab === 'resources' ? 'active' : ''}`}
                onClick={() => setDetailTab('resources')}
                disabled={isCreating}
              >
                <span className="inspector-tab-card-key mono">02</span>
                <span className="inspector-tab-card-label">资源明细</span>
              </button>
              <button
                type="button"
                className={`inspector-tab-card ${detailTab === 'rendered' ? 'active' : ''}`}
                onClick={() => setDetailTab('rendered')}
                disabled={isCreating}
              >
                <span className="inspector-tab-card-key mono">03</span>
                <span className="inspector-tab-card-label">渲染预览</span>
              </button>
              <button
                type="button"
                className={`inspector-tab-card ${detailTab === 'validation' ? 'active' : ''}`}
                onClick={() => setDetailTab('validation')}
                disabled={isCreating}
              >
                <span className="inspector-tab-card-key mono">04</span>
                <span className="inspector-tab-card-label">沙箱校验</span>
              </button>
            </div>
            <div className="modal-body">
              {detailTab === 'editor' ? (
                <div className="detail-grid modal-grid">
                  <article className="sub-panel">
                    <div className="editor-header">
                      <div>
                        <h3>{isCreating ? '基本信息' : '版本编辑器'}</h3>
                        <p className="cell-subtle">
                          {isCreating ? '填写后直接创建并发布' : '保存会生成新的已发布版本'}
                        </p>
                      </div>
                    </div>
                    <div className="skill-form-grid">
                      <label className="form-field">
                        <span>唯一标识（Slug）</span>
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
                        <select
                          className="control-input"
                          value={editor.category}
                          onChange={(event) => setEditor((prev) => ({ ...prev, category: event.target.value }))}
                        >
                          {categoryOptions.map((item) => (
                            <option key={item} value={item}>
                              {skillCategoryLabel(item)}
                            </option>
                          ))}
                          {!categoryOptions.includes(editor.category) && editor.category ? (
                            <option value={editor.category}>{skillCategoryLabel(editor.category)}</option>
                          ) : null}
                        </select>
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
                        <span>主说明文档（Markdown）</span>
                        <textarea
                          className="control-textarea"
                          rows={16}
                          value={editor.bodyMarkdown}
                          onChange={(event) => setEditor((prev) => ({ ...prev, bodyMarkdown: event.target.value }))}
                        />
                      </label>
                      <div className="form-field field-span-2">
                        <div className="editor-header">
                          <div>
                            <span>补充文档</span>
                            <div className="cell-subtle">支持多份数据库型 Markdown 文档，交互方式与用户态编辑器保持一致。</div>
                          </div>
                          <button type="button" className="ghost-btn" onClick={addDocument}>
                            新增文档
                          </button>
                        </div>
                        <div className="skill-doc-editor-grid">
                          <div className="skill-doc-nav">
                            {editor.documents.length === 0 ? (
                              <div className="table-empty">
                                还没有补充文档。可以添加 `references/overview.md`、`design/rules.md` 这类 Markdown 文件。
                              </div>
                            ) : (
                              editor.documents.map((item, index) => (
                                <button
                                  key={`${item.documentKey || 'doc'}:${index}`}
                                  type="button"
                                  className={`skill-doc-nav-item ${selectedDocumentIndex === index ? 'active' : ''}`}
                                  onClick={() => setSelectedDocumentIndex(index)}
                                >
                                  <strong>{item.title || item.resourcePath || `文档 ${index + 1}`}</strong>
                                  <span>{resourceTypeLabel(item.resourceType)}</span>
                                  <span>{item.resourcePath || '未设置路径'}</span>
                                </button>
                              ))
                            )}
                          </div>
                          <div className="skill-doc-editor-pane">
                            {selectedDocument ? (
                              <>
                                <div className="skill-form-grid">
                                  <label className="form-field">
                                    <span>文档路径</span>
                                    <input
                                      className="control-input"
                                      value={selectedDocument.resourcePath}
                                      onChange={(event) =>
                                        updateDocument(selectedDocumentIndex, { resourcePath: event.target.value })
                                      }
                                      placeholder="references/overview.md"
                                    />
                                  </label>
                                  <label className="form-field">
                                    <span>文档标识（Key）</span>
                                    <input
                                      className="control-input"
                                      value={selectedDocument.documentKey}
                                      onChange={(event) =>
                                        updateDocument(selectedDocumentIndex, { documentKey: event.target.value })
                                      }
                                      placeholder="overview"
                                    />
                                  </label>
                                  <label className="form-field">
                                    <span>文档类型</span>
                                    <select
                                      className="control-input"
                                      value={selectedDocument.resourceType}
                                      onChange={(event) =>
                                        updateDocument(selectedDocumentIndex, {
                                          resourceType: event.target.value === 'template' ? 'template' : 'reference',
                                        })
                                      }
                                    >
                                      <option value="reference">参考文档（reference）</option>
                                      <option value="template">模板片段（template）</option>
                                    </select>
                                  </label>
                                  <label className="form-field">
                                    <span>标题</span>
                                    <input
                                      className="control-input"
                                      value={selectedDocument.title}
                                      onChange={(event) =>
                                        updateDocument(selectedDocumentIndex, { title: event.target.value })
                                      }
                                      placeholder="总体说明"
                                    />
                                  </label>
                                  <label className="form-field field-span-2">
                                    <span>摘要</span>
                                    <input
                                      className="control-input"
                                      value={selectedDocument.summary}
                                      onChange={(event) =>
                                        updateDocument(selectedDocumentIndex, { summary: event.target.value })
                                      }
                                      placeholder="告诉模型这份文档适合什么时候读"
                                    />
                                  </label>
                                  <label className="form-field field-span-2">
                                    <span>Markdown 文档</span>
                                    <textarea
                                      className="control-textarea"
                                      rows={12}
                                      value={selectedDocument.bodyMarkdown}
                                      onChange={(event) =>
                                        updateDocument(selectedDocumentIndex, { bodyMarkdown: event.target.value })
                                      }
                                    />
                                  </label>
                                </div>
                                <div className="section-actions">
                                  <button
                                    type="button"
                                    className="ghost-btn"
                                    onClick={() => removeDocument(selectedDocumentIndex)}
                                  >
                                    删除当前文档
                                  </button>
                                </div>
                              </>
                            ) : (
                              <div className="table-empty">选择左侧文档进行编辑，或先新增一份渐进式文档。</div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="section-actions">
                      {isCreating ? (
                        <button type="button" className="primary-btn" onClick={handleCreate} disabled={busy}>
                          创建并发布
                        </button>
                      ) : (
                        <button type="button" className="primary-btn" onClick={handleSave} disabled={busy || !selectedSkillId}>
                          保存为新版本
                        </button>
                      )}
                    </div>
                  </article>
                  <article className="sub-panel">
                    <p className="kpi-title">版本历史</p>
                    <div className="revision-list">
                      {revisions.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className={`revision-item ${selectedRevisionId === item.id ? 'active' : ''}`}
                          onClick={() => setSelectedRevisionId(item.id)}
                        >
                          <span>版本 {item.revisionNumber}</span>
                          <span>{item.isPublished ? '已发布' : '草稿版本'}</span>
                          <span>{formatDateTime(item.createdAt)}</span>
                        </button>
                      ))}
                      {!revisions.length ? <div className="table-empty">暂无版本记录</div> : null}
                    </div>
                    {!isCreating && detail ? (
                      <div className="validation-result">
                        <div>当前发布版本 ID: {detail.publishedRevisionId || '-'}</div>
                        <div>资源数量: {detail.resourceSummary?.totalCount ?? detail.resources?.length ?? 0}</div>
                        <div>引用路径数: {detail.resourceSummary?.paths?.length ?? 0}</div>
                      </div>
                    ) : null}
                  </article>
                </div>
              ) : null}

              {detailTab === 'resources' ? (
                <div className="detail-grid modal-grid">
                  <article className="sub-panel">
                    <div className="section-heading">
                      <div>
                        <p className="eyebrow">资源工作区</p>
                        <h2>当前版本资源</h2>
                      </div>
                    </div>
                    <div className="revision-list">
                      {revisionResources?.resources.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className={`revision-item ${selectedResourcePath === item.resourcePath ? 'active' : ''}`}
                          onClick={() => setSelectedResourcePath(item.resourcePath)}
                        >
                          <span>{item.resourcePath}</span>
                          <span>{resourceTypeLabel(item.resourceType)}</span>
                          <span>{storageLabel(item.contentStorage)}</span>
                        </button>
                      ))}
                      {!revisionResources?.resources.length ? (
                        <div className="table-empty">当前版本暂无额外资源</div>
                      ) : null}
                    </div>
                  </article>
                  <article className="sub-panel">
                    {(() => {
                      const resource =
                        revisionResources?.resources.find((item) => item.resourcePath === selectedResourcePath) || null;
                      if (!resource) {
                        return <div className="table-empty">选择左侧资源查看详情。</div>;
                      }
                      return (
                        <div className="inspector-page-stack">
                          <div className="validation-result">
                            <div>资源路径: {resource.resourcePath}</div>
                            <div>文档类型: {resourceTypeLabel(resource.resourceType)}</div>
                            <div>存储位置: {storageLabel(resource.contentStorage)}</div>
                            <div>MIME 类型: {resource.mimeType || '-'}</div>
                            <div>加载阶段: {resource.loadStage || '-'}</div>
                            <div>存储路径: {resource.storagePath || '-'}</div>
                            <div>更新时间: {formatDateTime(resource.updatedAt)}</div>
                          </div>
                          <div className="validation-result">
                            <div>标题: {resource.title || '-'}</div>
                            <div>摘要: {resource.summary || '-'}</div>
                            <div>存储定位信息: {resource.storageLocatorJson ? JSON.stringify(resource.storageLocatorJson) : '-'}</div>
                          </div>
                          <pre className="code-block">
                            {resource.contentMarkdown || (resource.contentStorage === 'object_storage' ? '该存储桶文件当前无可预览文本内容' : '暂无正文')}
                          </pre>
                        </div>
                      );
                    })()}
                  </article>
                </div>
              ) : null}

              {detailTab === 'rendered' ? (
                <div className="inspector-page-stack">
                  <section className="inspector-stat-grid">
                    <article className="inspector-stat-card">
                      <span className="inspector-stat-label">当前版本</span>
                      <strong>{renderedRevision ? `版本 ${renderedRevision.revisionNumber}` : '-'}</strong>
                      <span className="session-meta">{selectedRevisionLabel}</span>
                    </article>
                    <article className="inspector-stat-card">
                      <span className="inspector-stat-label">校验签名</span>
                      <strong>{renderedRevision?.signature?.slice(0, 12) || '-'}</strong>
                      <span className="session-meta">当前技能 Markdown 的渲染结果</span>
                    </article>
                    <article className="inspector-stat-card">
                      <span className="inspector-stat-label">资源数</span>
                      <strong>{revisionResources?.resourceSummary.totalCount ?? 0}</strong>
                      <span className="session-meta">当前版本下的数据库与存储桶资源总数</span>
                    </article>
                  </section>
                  <pre className="code-block">{renderedRevision?.renderedMarkdown || '选择版本后显示渲染结果'}</pre>
                </div>
              ) : null}

              {detailTab === 'validation' ? (
                <div className="detail-grid modal-grid">
                  <article className="sub-panel">
                    <p className="kpi-title">沙箱校验</p>
                    <div className="validation-box">
                      <label className="form-field">
                        <span>目标会话 ID（sessionId）</span>
                        <input
                          className="control-input"
                          placeholder="输入已有任务会话 ID"
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
                        同步到沙箱并校验
                      </button>
                      {validationResult ? (
                        <div className="validation-result">
                          <div>技能路径: {validationResult.skillPath || '-'}</div>
                          <div>校验签名: {validationResult.signature}</div>
                          <div>是否触发重启: {String(validationResult.restartTriggered)}</div>
                          <div>同步时间: {formatDateTime(validationResult.syncedAt)}</div>
                        </div>
                      ) : null}
                    </div>
                  </article>
                  <article className="sub-panel">
                    <p className="kpi-title">资源清单</p>
                    <div className="revision-list">
                      {revisionResources?.resources.map((item) => (
                        <div key={item.id} className="revision-item active">
                          <span>{item.resourcePath}</span>
                          <span>{storageLabel(item.contentStorage)}</span>
                          <span>{formatBytes(item.contentMarkdown?.length)}</span>
                        </div>
                      ))}
                      {!revisionResources?.resources.length ? <div className="table-empty">暂无资源记录</div> : null}
                    </div>
                  </article>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
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
                <p className="eyebrow">导入预览</p>
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
                  {importJobStatus === 'running' ? '导入处理中...' : isCreating ? '导入并创建技能' : '导入为新版本'}
                </button>
              </div>
            </div>

            <div className="skill-secondary-grid">
              <article className="panel fade-in">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">文件树</p>
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
                    <p className="eyebrow">导入摘要</p>
                    <h2>入口与提示</h2>
                  </div>
                </div>
                <div className="validation-box">
                  <div>任务状态: {importJobStatus || '空闲'}</div>
                  <div>唯一标识（Slug）: {importPreview.slug}</div>
                  <div>名称: {importPreview.name}</div>
                  <div>入口文件: {importPreview.entry.entryName}</div>
                  <div>摘要: {importPreview.activationSummary || '-'}</div>
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
