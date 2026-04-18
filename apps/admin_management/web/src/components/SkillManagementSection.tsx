import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import type {
  SkillDetail,
  SkillImportPreview,
  SkillRevision,
  SkillRevisionResources,
  SkillSummary,
  SkillValidationResult,
} from '../types';
import {
  DEFAULT_SKILL_MANAGEMENT_FILTERS,
  DEFAULT_SKILL_MANAGEMENT_VIEW_STATE,
} from './adminViewState';
import type { SkillManagementViewState, SkillViewFilter } from './adminViewState';

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
const DEFAULT_FILTERS = DEFAULT_SKILL_MANAGEMENT_FILTERS;

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
  onUpdatedAtChange?: (value: string | null) => void;
  onRegisterRefresh?: (handler: (() => Promise<void>) | null) => void;
  persistedState?: SkillManagementViewState | null;
  onStateChange?: (state: SkillManagementViewState) => void;
};

export function SkillManagementSection({
  onError,
  onUpdatedAtChange,
  onRegisterRefresh,
  persistedState,
  onStateChange,
}: Props) {
  const initialState = persistedState || DEFAULT_SKILL_MANAGEMENT_VIEW_STATE;
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(initialState.selectedSkillId);
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [revisions, setRevisions] = useState<SkillRevision[]>([]);
  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(initialState.selectedRevisionId);
  const [revisionResources, setRevisionResources] = useState<SkillRevisionResources | null>(null);
  const [selectedResourcePath, setSelectedResourcePath] = useState<string | null>(initialState.selectedResourcePath);
  const [validationResult, setValidationResult] = useState<SkillValidationResult | null>(null);
  const [validationSessionId, setValidationSessionId] = useState('');
  const [detailDialogOpen, setDetailDialogOpen] = useState(initialState.detailDialogOpen);
  const [detailTab, setDetailTab] = useState<'editor' | 'resources' | 'validation'>(initialState.detailTab);
  const [skillView, setSkillView] = useState<SkillViewFilter>(initialState.skillView);
  const [filters, setFilters] = useState(initialState.filters);
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
  const selectedRevisionIdRef = useRef<string | null>(initialState.selectedRevisionId);

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

  useEffect(() => {
    selectedRevisionIdRef.current = selectedRevisionId;
  }, [selectedRevisionId]);

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
      const currentSelectedRevisionId = selectedRevisionIdRef.current;
      const nextRevisionId =
        currentSelectedRevisionId && nextRevisions.some((item) => item.id === currentSelectedRevisionId)
          ? currentSelectedRevisionId
          : publishedRevision?.id || null;
      setSelectedRevisionId(nextRevisionId);
      setValidationResult(null);
      onError(null);
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

  useEffect(() => {
    onUpdatedAtChange?.(
      validationResult?.syncedAt
      || detail?.updatedAt
      || skills[0]?.updatedAt
      || null
    );
  }, [detail?.updatedAt, onUpdatedAtChange, skills, validationResult?.syncedAt]);

  const handleExternalRefresh = useCallback(async () => {
    await loadSkills();
    if (selectedSkillId) {
      await loadSkillDetail(selectedSkillId);
    }
  }, [loadSkillDetail, loadSkills, selectedSkillId]);

  useEffect(() => {
    onRegisterRefresh?.(handleExternalRefresh);
    return () => {
      onRegisterRefresh?.(null);
    };
  }, [handleExternalRefresh, onRegisterRefresh]);

  useEffect(() => {
    onStateChange?.({
      filters,
      skillView,
      selectedSkillId,
      detailDialogOpen,
      detailTab,
      selectedRevisionId,
      selectedResourcePath,
    });
  }, [detailDialogOpen, detailTab, filters, onStateChange, selectedResourcePath, selectedRevisionId, selectedSkillId, skillView]);

  const handleRefreshSkills = useCallback(() => {
    void handleExternalRefresh().catch((error) => {
      onError(error instanceof Error ? error.message : '技能列表加载失败');
    });
  }, [handleExternalRefresh, onError]);

  const handleResetFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
  }, []);

  const openCreateDialog = () => {
    setIsCreating(true);
    setDetailDialogOpen(true);
    setDetailTab('editor');
    setSelectedSkillId(null);
    setDetail(null);
    setRevisions([]);
    setSelectedRevisionId(null);
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

  const skillOverview = useMemo(() => ({
    total: skills.length,
    active: skills.filter((item) => item.status === 'active').length,
    archived: skills.filter((item) => item.status === 'archived').length,
    published: skills.filter((item) => Boolean(item.publishedRevisionNumber)).length,
    unpublished: skills.filter((item) => !item.publishedRevisionNumber).length,
  }), [skills]);

  const skillViewOptions: Array<{ key: SkillViewFilter; label: string; count: number }> = [
    { key: 'all', label: '全部', count: skillOverview.total },
    { key: 'active', label: '启用', count: skillOverview.active },
    { key: 'archived', label: '归档', count: skillOverview.archived },
    { key: 'published', label: '已发布', count: skillOverview.published },
    { key: 'unpublished', label: '待发布', count: skillOverview.unpublished },
  ];

  const visibleSkills = useMemo(() => {
    if (skillView === 'active') return skills.filter((item) => item.status === 'active');
    if (skillView === 'archived') return skills.filter((item) => item.status === 'archived');
    if (skillView === 'published') return skills.filter((item) => Boolean(item.publishedRevisionNumber));
    if (skillView === 'unpublished') return skills.filter((item) => !item.publishedRevisionNumber);
    return skills;
  }, [skillView, skills]);

  const publishedRevision = useMemo(
    () => revisions.find((item) => item.id === detail?.publishedRevisionId) || revisions.find((item) => item.isPublished) || null,
    [detail?.publishedRevisionId, revisions]
  );

  const selectedRevision = useMemo(
    () => revisions.find((item) => item.id === selectedRevisionId) || null,
    [revisions, selectedRevisionId]
  );

  const currentResourceCount = revisionResources?.resourceSummary.totalCount
    ?? detail?.resourceSummary?.totalCount
    ?? detail?.resources?.length
    ?? 0;

  const selectedResource = useMemo(
    () => revisionResources?.resources.find((item) => item.resourcePath === selectedResourcePath) || null,
    [revisionResources, selectedResourcePath]
  );

  const skillDetailSummary = useMemo(() => {
    if (isCreating) {
      return [
        { label: '当前模式', value: '新建技能' },
        { label: '分类', value: skillCategoryLabel(editor.category) },
        { label: '补充文档', value: String(editor.documents.length) },
        { label: '发布方式', value: '创建后生成版本 1' },
      ];
    }

    if (!detail) return [];

    return [
      { label: '唯一标识', value: detail.slug, mono: true },
      { label: '分类', value: skillCategoryLabel(detail.category) },
      { label: '已发布版本', value: publishedRevision ? `版本 ${publishedRevision.revisionNumber}` : '未发布' },
      { label: '当前工作版本', value: selectedRevision ? `版本 ${selectedRevision.revisionNumber}` : '-' },
      { label: '资源 / 文档', value: `${currentResourceCount} / ${editor.documents.length}` },
    ];
  }, [
    currentResourceCount,
    detail,
    editor.category,
    editor.documents.length,
    isCreating,
    publishedRevision,
    selectedRevision,
  ]);

  const detailTabOptions = useMemo(
    () => [
      {
        key: 'editor' as const,
        index: '01',
        label: '内容与版本',
        meta: isCreating ? '创建中' : selectedRevision ? `版本 ${selectedRevision.revisionNumber}` : '编辑中',
        disabled: false,
      },
      {
        key: 'resources' as const,
        index: '02',
        label: '资源明细',
        meta: isCreating ? '创建后可用' : `${currentResourceCount} 项`,
        disabled: isCreating,
      },
      {
        key: 'validation' as const,
        index: '03',
        label: '沙箱校验',
        meta: isCreating ? '创建后可用' : validationResult ? '已同步' : '待校验',
        disabled: isCreating,
      },
    ],
    [currentResourceCount, isCreating, selectedRevision, validationResult]
  );

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
    <main className="content-stack viewport-lock-page skill-management-page">
      <section className="panel fade-in skill-management-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">技能总览</p>
            <h2>技能管理</h2>
            <p className="subtitle">维护平台技能、版本记录、资源文档与沙箱校验。</p>
          </div>
          <div className="section-actions skill-management-actions">
            <button
              type="button"
              className="primary-btn skill-action-btn skill-action-btn-primary"
              onClick={openCreateDialog}
            >
              <span className="skill-action-btn-icon" aria-hidden="true">+</span>
              <span className="skill-action-btn-copy">
                <span className="skill-action-btn-label">新建技能</span>
                <span className="skill-action-btn-support">从空白版本开始</span>
              </span>
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
            <button
              type="button"
              className="secondary-btn skill-action-btn"
              onClick={() => importInputRef.current?.click()}
              disabled={busy}
            >
              <span className="skill-action-btn-icon" aria-hidden="true">↥</span>
              <span className="skill-action-btn-copy">
                <span className="skill-action-btn-label">导入技能文件夹</span>
                <span className="skill-action-btn-support">把目录转成版本</span>
              </span>
            </button>
            <button
              type="button"
              className="secondary-btn skill-action-btn skill-action-btn-refresh"
              onClick={handleRefreshSkills}
              disabled={busy}
            >
              <span className="skill-action-btn-icon" aria-hidden="true">↻</span>
              <span className="skill-action-btn-copy">
                <span className="skill-action-btn-label">同步列表</span>
                <span className="skill-action-btn-support">重新拉取当前结果</span>
              </span>
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
          <button type="button" className="secondary-btn" onClick={handleResetFilters} disabled={busy}>
            重置筛选
          </button>
        </div>

        <div className="skill-overview-strip">
          <div>
            <span>技能总数</span>
            <strong>{skillOverview.total}</strong>
          </div>
          <div>
            <span>已启用</span>
            <strong>{skillOverview.active}</strong>
          </div>
          <div>
            <span>已发布</span>
            <strong>{skillOverview.published}</strong>
          </div>
          <div>
            <span>待发布</span>
            <strong>{skillOverview.unpublished}</strong>
          </div>
        </div>

        <div className="skill-secondary-menu" role="tablist" aria-label="技能二级筛选">
          {skillViewOptions.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={skillView === item.key}
              className={skillView === item.key ? 'active' : ''}
              onClick={() => setSkillView(item.key)}
            >
              <span>{item.label}</span>
              <strong>{item.count}</strong>
            </button>
          ))}
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
              {visibleSkills.length === 0 ? (
                <tr>
                  <td colSpan={4} className="table-empty">
                    当前筛选下暂无技能记录
                  </td>
                </tr>
              ) : (
                visibleSkills.map((item) => (
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
            className="modal-card skill-detail-modal"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
              <div className="modal-header skill-detail-modal-header">
                <div>
                  <p className="section-tag">技能详情</p>
                  <h2>{isCreating ? '新建技能' : detail?.name || '技能详情'}</h2>
                  <p className="cell-subtle">
                    {isCreating
                    ? '直接创建平台技能，并在同一窗口完成正文与资源校验'
                    : `${detail?.slug || '-'} · 更新时间 ${formatDateTime(detail?.updatedAt)}`}
                  </p>
                  <div className="skill-detail-header-meta">
                    {isCreating ? (
                      <>
                        <span className="skill-detail-meta-chip">新建模式</span>
                        <span className="skill-detail-meta-chip">{skillCategoryLabel(editor.category)}</span>
                      </>
                    ) : detail ? (
                      <>
                        <span className={`status-pill status-${detail.status}`}>{skillStatusLabel(detail.status)}</span>
                        <span className="skill-detail-meta-chip">{skillCategoryLabel(detail.category)}</span>
                        <span className="skill-detail-meta-chip mono">{detail.slug}</span>
                      </>
                    ) : null}
                  </div>
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
            {skillDetailSummary.length ? (
              <div className="skill-detail-summary-strip">
                {skillDetailSummary.map((item) => (
                  <article key={item.label} className="skill-detail-summary-card">
                    <span>{item.label}</span>
                    <strong className={item.mono ? 'mono' : undefined}>{item.value}</strong>
                  </article>
                ))}
              </div>
            ) : null}
            <div className="button-grid modal-tab-grid skill-detail-tabbar">
              {detailTabOptions.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`inspector-tab-card ${detailTab === item.key ? 'active' : ''}`}
                  onClick={() => setDetailTab(item.key)}
                  disabled={item.disabled}
                >
                  <span className="inspector-tab-card-key mono">{item.index}</span>
                  <span className="inspector-tab-card-label">{item.label}</span>
                  <span className="skill-detail-tab-meta">{item.meta}</span>
                </button>
              ))}
            </div>
            <div className="modal-body">
              {detailTab === 'editor' ? (
                <div className="skill-editor-layout">
                  <article className="sub-panel skill-editor-main-panel">
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
                  <aside className="sub-panel skill-editor-side-panel">
                    <div className="editor-header skill-side-panel-head">
                      <div>
                        <h3>{isCreating ? '创建节奏' : '版本列表'}</h3>
                        <p className="cell-subtle">
                          {isCreating ? '先写正文，再补充文档，确认后直接创建。' : '先选工作版本，再决定是否保存为新版本。'}
                        </p>
                      </div>
                      {!isCreating ? <span className="session-status">{revisions.length} 个版本</span> : null}
                    </div>
                    {isCreating ? (
                      <div className="skill-quick-note-list">
                        <article className="skill-quick-note">
                          <span>01</span>
                          <strong>先填基本信息</strong>
                          <p>名称、分类和描述决定后台检索体验。</p>
                        </article>
                        <article className="skill-quick-note">
                          <span>02</span>
                          <strong>再写主说明文档</strong>
                          <p>主说明文档是技能正文，优先把主流程写完整。</p>
                        </article>
                        <article className="skill-quick-note">
                          <span>03</span>
                          <strong>最后补补充文档</strong>
                          <p>把规则、示例和模板拆成独立 Markdown，后续更好维护。</p>
                        </article>
                      </div>
                    ) : (
                      <div className="revision-list skill-version-list skill-version-list-compact">
                        {revisions.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            className={`revision-item skill-version-item ${selectedRevisionId === item.id ? 'active' : ''}`}
                            onClick={() => setSelectedRevisionId(item.id)}
                          >
                            <div className="skill-version-item-head">
                              <strong>版本 {item.revisionNumber}</strong>
                              {item.isPublished ? <span className="skill-version-badge">已发布</span> : null}
                            </div>
                            <span>{formatDateTime(item.createdAt)}</span>
                            <span>{item.createdBy || 'admin_management'}</span>
                          </button>
                        ))}
                        {!revisions.length ? <div className="table-empty">暂无版本记录</div> : null}
                      </div>
                    )}
                  </aside>
                </div>
              ) : null}

              {detailTab === 'resources' ? (
                <div className="skill-resource-layout">
                  <article className="sub-panel skill-version-history-panel">
                    <div className="editor-header skill-side-panel-head">
                      <div>
                        <h3>版本列表</h3>
                        <p className="cell-subtle">切换版本后，中间和右侧资源会同步更新。</p>
                      </div>
                      <span className="session-status">{revisions.length} 个版本</span>
                    </div>
                    <div className="revision-list skill-version-list">
                      {revisions.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className={`revision-item skill-version-item ${selectedRevisionId === item.id ? 'active' : ''}`}
                          onClick={() => setSelectedRevisionId(item.id)}
                        >
                          <div className="skill-version-item-head">
                            <strong>版本 {item.revisionNumber}</strong>
                            {item.isPublished ? <span className="skill-version-badge">已发布</span> : null}
                          </div>
                          <span>{formatDateTime(item.createdAt)}</span>
                          <span>{item.createdBy || 'admin_management'}</span>
                        </button>
                      ))}
                      {!revisions.length ? <div className="table-empty">暂无版本记录</div> : null}
                    </div>
                    {!isCreating && detail ? (
                      <div className="skill-resource-summary-box">
                        <article className="skill-side-fact-card">
                          <span>当前发布</span>
                          <strong>{publishedRevision ? `版本 ${publishedRevision.revisionNumber}` : '未发布'}</strong>
                        </article>
                        <article className="skill-side-fact-card">
                          <span>资源数量</span>
                          <strong>{currentResourceCount}</strong>
                        </article>
                        <article className="skill-side-fact-card">
                          <span>参考文档</span>
                          <strong>{revisionResources?.resourceSummary.referenceCount ?? detail.resourceSummary?.referenceCount ?? 0}</strong>
                        </article>
                        <article className="skill-side-fact-card">
                          <span>模板片段</span>
                          <strong>{revisionResources?.resourceSummary.templateCount ?? detail.resourceSummary?.templateCount ?? 0}</strong>
                        </article>
                      </div>
                    ) : null}
                  </article>
                  <article className="sub-panel skill-resource-list-panel">
                    <div className="editor-header skill-side-panel-head">
                      <div>
                        <h3>资源列表</h3>
                        <p className="cell-subtle">
                          {selectedRevision ? `版本 ${selectedRevision.revisionNumber} 的资源` : '先选择一个版本'}
                        </p>
                      </div>
                      <span className="session-status">{currentResourceCount} 项</span>
                    </div>
                    <div className="revision-list skill-resource-items">
                      {revisionResources?.resources.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className={`revision-item skill-resource-item ${selectedResourcePath === item.resourcePath ? 'active' : ''}`}
                          onClick={() => setSelectedResourcePath(item.resourcePath)}
                        >
                          <div className="skill-resource-item-head">
                            <strong>{item.title || item.resourcePath.split('/').pop() || item.resourcePath}</strong>
                            <span className="skill-resource-type-badge">{resourceTypeLabel(item.resourceType)}</span>
                          </div>
                          <span className="skill-resource-item-path mono">{item.resourcePath}</span>
                          <div className="skill-resource-item-meta">
                            <span>{storageLabel(item.contentStorage)}</span>
                            <span>{item.loadStage || '默认加载'}</span>
                          </div>
                        </button>
                      ))}
                      {!revisionResources?.resources.length ? (
                        <div className="table-empty">当前版本暂无额外资源</div>
                      ) : null}
                    </div>
                  </article>
                  <article className="sub-panel skill-resource-detail-panel">
                    {selectedResource ? (
                      <div className="skill-resource-detail-stack">
                        <div className="skill-resource-detail-hero">
                          <div>
                            <p className="eyebrow">资源详情</p>
                            <h3>{selectedResource.title || selectedResource.resourcePath.split('/').pop() || selectedResource.resourcePath}</h3>
                            <p className="cell-subtle">{selectedResource.resourcePath}</p>
                          </div>
                          <div className="skill-resource-detail-badges">
                            <span className="skill-detail-meta-chip">{resourceTypeLabel(selectedResource.resourceType)}</span>
                            <span className="skill-detail-meta-chip">{storageLabel(selectedResource.contentStorage)}</span>
                            {selectedResource.mimeType ? (
                              <span className="skill-detail-meta-chip mono">{selectedResource.mimeType}</span>
                            ) : null}
                          </div>
                        </div>
                        <div className="skill-resource-fact-grid">
                          <article className="skill-resource-fact-card">
                            <span>加载阶段</span>
                            <strong>{selectedResource.loadStage || '-'}</strong>
                          </article>
                          <article className="skill-resource-fact-card">
                            <span>更新时间</span>
                            <strong>{formatDateTime(selectedResource.updatedAt)}</strong>
                          </article>
                          <article className="skill-resource-fact-card">
                            <span>存储路径</span>
                            <strong className="mono">{selectedResource.storagePath || '-'}</strong>
                          </article>
                          <article className="skill-resource-fact-card">
                            <span>资源 Key</span>
                            <strong className="mono">{selectedResource.resourceKey || '-'}</strong>
                          </article>
                        </div>
                        {selectedResource.summary ? (
                          <article className="skill-resource-summary-card">
                            <span>摘要</span>
                            <p>{selectedResource.summary}</p>
                          </article>
                        ) : null}
                        {selectedResource.storageLocatorJson ? (
                          <article className="skill-resource-summary-card">
                            <span>存储定位信息</span>
                            <code className="skill-resource-inline-code">
                              {JSON.stringify(selectedResource.storageLocatorJson)}
                            </code>
                          </article>
                        ) : null}
                        <pre className="code-block">
                          {selectedResource.contentMarkdown || (selectedResource.contentStorage === 'object_storage' ? '该存储桶文件当前无可预览文本内容' : '暂无正文')}
                        </pre>
                      </div>
                    ) : (
                      <div className="table-empty">选择左侧资源查看详情。</div>
                    )}
                  </article>
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
