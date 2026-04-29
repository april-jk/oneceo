import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { OsacRelease, OsacReleaseDetailResponse } from '../types';
import { DEFAULT_OSAC_RELEASE_MANAGEMENT_VIEW_STATE } from './adminViewState';
import type { OsacReleaseManagementViewState, OsacReleaseTabKey } from './adminViewState';
import { AdminButton, AdminDetailShell, AdminStickyInspector, AdminTabs, AuditTimeline, CodePanel, DangerConfirmDialog, DiffDrawer, StatusBadge, getAdminActionIcon, getAdminModuleIcon } from './admin-ui';

type Props = {
  onError: (message: string | null) => void;
  onUpdatedAtChange?: (value: string | null) => void;
  onRegisterRefresh?: (handler: (() => Promise<void>) | null) => void;
  persistedState?: OsacReleaseManagementViewState | null;
  onStateChange?: (state: OsacReleaseManagementViewState) => void;
};

type TabKey = OsacReleaseTabKey;
type OsacDangerAction = {
  kind: 'publish' | 'rollback';
  releaseId: string;
  label: string;
  status: string;
  channel: string;
  sha256?: string | null;
  currentLatest: string;
};

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function formatBytes(bytes?: number | null) {
  const value = Number(bytes || 0);
  if (value <= 0) return '-';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function shortSha(value?: string | null) {
  const text = value || '';
  return text ? `${text.slice(0, 12)}...` : '-';
}

function releaseStatusLabel(status?: string | null) {
  if (status === 'uploaded') return '已上传';
  if (status === 'validated') return '已校验';
  if (status === 'published') return '已发布';
  if (status === 'failed') return '失败';
  return status || '-';
}

function releaseStatusHint(status?: string | null, isCurrent = false) {
  if (isCurrent) return '当前生效';
  if (status === 'uploaded') return '等待校验';
  if (status === 'validated') return '可直接发布';
  if (status === 'published') return '可切换为当前版本';
  if (status === 'failed') return '需要重新检查';
  return '历史记录';
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('读取文件失败'));
        return;
      }
      const markerIndex = reader.result.indexOf(',');
      if (markerIndex < 0) {
        reject(new Error('文件编码失败'));
        return;
      }
      resolve(reader.result.slice(markerIndex + 1));
    };
    reader.onerror = () => {
      reject(new Error('读取文件失败'));
    };
    reader.readAsDataURL(file);
  });
}

const DEFAULT_UPLOAD_FORM = {
  version: '',
  releaseNotes: '',
  sourceCommit: '',
  channel: 'stable',
  binary: null as File | null,
};

export function OsacReleaseManagementSection({
  onError,
  onUpdatedAtChange,
  onRegisterRefresh,
  persistedState,
  onStateChange,
}: Props) {
  const initialState = persistedState || DEFAULT_OSAC_RELEASE_MANAGEMENT_VIEW_STATE;
  const [tab, setTab] = useState<TabKey>(initialState.tab);
  const [list, setList] = useState<OsacRelease[]>([]);
  const [publishedReleaseId, setPublishedReleaseId] = useState<string | null>(null);
  const [publishedVersion, setPublishedVersion] = useState<string | null>(null);
  const [selectedReleaseId, setSelectedReleaseId] = useState<string | null>(initialState.selectedReleaseId);
  const [detail, setDetail] = useState<OsacReleaseDetailResponse | null>(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(initialState.detailDialogOpen);
  const [busy, setBusy] = useState(false);
  const [dangerAction, setDangerAction] = useState<OsacDangerAction | null>(null);
  const [diffOpen, setDiffOpen] = useState(false);
  const [query, setQuery] = useState(initialState.query);
  const [uploadForm, setUploadForm] = useState(DEFAULT_UPLOAD_FORM);

  const currentPublishedReleaseId =
    (detail?.release?.id === selectedReleaseId ? detail.currentPublishedReleaseId : null) || publishedReleaseId || null;
  const currentPublishedRelease = useMemo(
    () => list.find((item) => item.id === currentPublishedReleaseId) || null,
    [currentPublishedReleaseId, list]
  );
  const selectedRelease = detail?.release?.id === selectedReleaseId ? detail.release : null;

  const filteredList = useMemo(() => {
    if (tab === 'published') {
      return list.filter((item) => item.id === currentPublishedReleaseId);
    }
    if (tab === 'pending') {
      return list.filter((item) => item.status === 'uploaded' || item.status === 'validated');
    }
    return list;
  }, [currentPublishedReleaseId, list, tab]);

  const releaseSummary = useMemo(() => ({
    published: currentPublishedReleaseId ? 1 : 0,
    pending: list.filter((item) => item.status === 'uploaded' || item.status === 'validated').length,
    failed: list.filter((item) => item.status === 'failed').length,
    validated: list.filter((item) => item.status === 'validated').length,
  }), [currentPublishedReleaseId, list]);
  const tabOptions = useMemo(
    () =>
      [
        {
          key: 'published' as const,
          label: '已发布',
          count: releaseSummary.published,
          hint: currentPublishedRelease?.version || '当前生效版本',
        },
        {
          key: 'pending' as const,
          label: '待发布',
          count: releaseSummary.pending,
          hint: releaseSummary.pending ? '待校验或待切换' : '暂无待处理',
        },
        {
          key: 'all' as const,
          label: '全部版本',
          count: list.length,
          hint: '查看全部 revision',
        },
        {
          key: 'upload' as const,
          label: '上传新版本',
          count: null,
          hint: '创建新的 release',
        },
      ] satisfies Array<{ key: TabKey; label: string; count: number | null; hint: string }>,
    [currentPublishedRelease?.version, list.length, releaseSummary.pending, releaseSummary.published]
  );
  const currentListTitle =
    tab === 'published' ? '当前生效版本' : tab === 'pending' ? '待处理版本' : '全部版本';
  const currentListSubtitle =
    tab === 'published'
      ? '只展示当前对 sandbox 生效的版本。'
      : tab === 'pending'
        ? '优先处理待校验或待切换的版本。'
        : '按版本时间查看全部发布历史。';
  const uploadSelectedFileLabel = uploadForm.binary
    ? `${uploadForm.binary.name} · ${formatBytes(uploadForm.binary.size)}`
    : '尚未选择二进制文件';

  useEffect(() => {
    if (tab === 'upload') {
      setDetailDialogOpen(false);
      return;
    }
    if (filteredList.length === 0) {
      setSelectedReleaseId(null);
      setDetail(null);
      setDetailDialogOpen(false);
      return;
    }
    if (!selectedReleaseId || !filteredList.some((item) => item.id === selectedReleaseId)) {
      setSelectedReleaseId(filteredList[0].id);
      setDetail(null);
      setDetailDialogOpen(false);
    }
  }, [filteredList, selectedReleaseId, tab]);

  const loadList = useCallback(async () => {
    const response = await api.listOsacReleases({
      query: query || undefined,
      channel: 'stable',
    });
    setList(response.items);
    setPublishedReleaseId(response.currentPublishedReleaseId);
    setPublishedVersion(response.currentPublishedVersion);
    if (!response.items.length) {
      setSelectedReleaseId(null);
      setDetail(null);
      return;
    }
    if (tab === 'published' && response.currentPublishedReleaseId) {
      setSelectedReleaseId(response.currentPublishedReleaseId);
      return;
    }
    if (!selectedReleaseId || !response.items.some((item) => item.id === selectedReleaseId)) {
      setSelectedReleaseId(response.currentPublishedReleaseId || response.items[0].id);
    }
  }, [query, selectedReleaseId, tab]);

  const loadDetail = useCallback(
    async (releaseId: string) => {
      const response = await api.getOsacRelease(releaseId);
      setDetail(response);
      onError(null);
    },
    [onError]
  );

  useEffect(() => {
    void loadList().catch((error) => {
      onError(error instanceof Error ? error.message : 'OSAC release 列表加载失败');
    });
  }, [loadList, onError]);

  useEffect(() => {
    if (!detailDialogOpen || !selectedReleaseId) return;
    if (detail?.release?.id === selectedReleaseId) return;
    void loadDetail(selectedReleaseId).catch((error) => {
      onError(error instanceof Error ? error.message : 'OSAC release 详情加载失败');
    });
  }, [detail?.release?.id, detailDialogOpen, loadDetail, onError, selectedReleaseId]);

  useEffect(() => {
    onUpdatedAtChange?.(
      selectedRelease?.updatedAt
      || currentPublishedRelease?.updatedAt
      || list[0]?.updatedAt
      || null
    );
  }, [currentPublishedRelease?.updatedAt, list, onUpdatedAtChange, selectedRelease?.updatedAt]);

  const handleExternalRefresh = useCallback(async () => {
    await loadList();
    if (selectedReleaseId) {
      await loadDetail(selectedReleaseId);
    }
  }, [loadDetail, loadList, selectedReleaseId]);

  useEffect(() => {
    onRegisterRefresh?.(handleExternalRefresh);
    return () => {
      onRegisterRefresh?.(null);
    };
  }, [handleExternalRefresh, onRegisterRefresh]);

  useEffect(() => {
    onStateChange?.({
      tab,
      query,
      selectedReleaseId,
      detailDialogOpen,
    });
  }, [detailDialogOpen, onStateChange, query, selectedReleaseId, tab]);

  const handleRefreshList = useCallback(() => {
    void handleExternalRefresh().catch((error) => {
      onError(error instanceof Error ? error.message : 'OSAC release 列表加载失败');
    });
  }, [handleExternalRefresh, onError]);

  const closeDetailDialog = useCallback(() => {
    setDetailDialogOpen(false);
  }, []);

  const openDetailDialog = useCallback(
    async (releaseId: string) => {
      setSelectedReleaseId(releaseId);
      setDetail(null);
      setDetailDialogOpen(true);
      try {
        await loadDetail(releaseId);
      } catch (error) {
        onError(error instanceof Error ? error.message : 'OSAC release 详情加载失败');
      }
    },
    [loadDetail, onError]
  );

  const submitUpload = async () => {
    if (!uploadForm.version.trim()) {
      onError('version 不能为空');
      return;
    }
    if (!uploadForm.binary) {
      onError('请先选择 OSAC 二进制文件');
      return;
    }
    setBusy(true);
    try {
      const created = await api.uploadOsacRelease({
        version: uploadForm.version.trim(),
        releaseNotes: uploadForm.releaseNotes.trim(),
        sourceCommit: uploadForm.sourceCommit.trim(),
        channel: uploadForm.channel,
        uploadedBy: 'admin_management',
        fileBase64: await fileToBase64(uploadForm.binary),
      });
      setUploadForm(DEFAULT_UPLOAD_FORM);
      setTab('pending');
      await loadList();
      setSelectedReleaseId(created.id);
    } catch (error) {
      onError(error instanceof Error ? error.message : '上传 OSAC release 失败');
    } finally {
      setBusy(false);
      setDangerAction(null);
    }
  };

  const validateRelease = async () => {
    if (!detail?.release) return;
    setBusy(true);
    try {
      await api.validateOsacRelease(detail.release.id);
      await loadList();
      await loadDetail(detail.release.id);
    } catch (error) {
      onError(error instanceof Error ? error.message : '校验 OSAC release 失败');
    } finally {
      setBusy(false);
      setDangerAction(null);
    }
  };

  const publishRelease = async (payload: OsacDangerAction) => {
    setBusy(true);
    try {
      const next = await api.publishOsacRelease(payload.releaseId);
      setDetail(next);
      await loadList();
    } catch (error) {
      onError(error instanceof Error ? error.message : '发布 OSAC latest 失败');
    } finally {
      setBusy(false);
      setDangerAction(null);
    }
  };

  const rollbackRelease = async (releaseId: string) => {
    setBusy(true);
    try {
      const next = await api.rollbackOsacRelease(releaseId);
      setDetail(next);
      setSelectedReleaseId(releaseId);
      await loadList();
    } catch (error) {
      onError(error instanceof Error ? error.message : '回滚 OSAC latest 失败');
    } finally {
      setBusy(false);
      setDangerAction(null);
    }
  };

  return (
    <main className="content-stack viewport-lock-page osac-release-page">
      <section className="panel hero-panel fade-in osac-release-hero-panel">
        <div className="panel-header osac-release-hero-head">
          <div>
            <p className="section-tag">OSAC 发布台</p>
            <h2>稳定版发布</h2>
          </div>
          <div className="osac-release-hero-meta">
            <span className="service-state ok">stable 渠道</span>
            <span className="topbar-pill">sandbox 自动跟随当前已发布版本</span>
          </div>
        </div>

        <div className="osac-release-summary-strip">
          <div>
            <span>当前版本</span>
            <strong>{currentPublishedRelease?.version || publishedVersion || '-'}</strong>
          </div>
          <div>
            <span>全部版本</span>
            <strong>{list.length}</strong>
          </div>
          <div>
            <span>待处理</span>
            <strong>{releaseSummary.pending}</strong>
          </div>
          <div>
            <span>失败</span>
            <strong>{releaseSummary.failed}</strong>
          </div>
        </div>

      </section>

      <section className="panel fade-in osac-release-panel osac-release-console">
        <div className="section-heading osac-release-console-head">
          <div>
            <p className="eyebrow">发布工作区</p>
            <h2>版本选择与切换</h2>
            <p className="subtitle">先从索引里选版本，再进入二级详情完成校验、发布或切换。</p>
          </div>
          <div className="section-actions osac-release-toolbar">
            <input
              className="control-input"
              aria-label="搜索 OSAC 版本号"
              placeholder="搜索版本号"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <button type="button" className="ghost-btn" onClick={handleRefreshList} disabled={busy}>
              同步列表
            </button>
          </div>
        </div>

        <AdminTabs value={tab} onChange={setTab} ariaLabel="OSAC 视图切换" items={tabOptions.map((item) => ({ key: item.key, label: item.label, count: item.count }))} />

        {tab === 'upload' ? (
          <div className="osac-release-upload-layout">
            <article className="sub-panel osac-release-upload-panel">
              <div className="editor-header">
                <div>
                  <h3>上传新版本</h3>
                  <p className="cell-subtle">上传完成后会创建 release，是否切换为 latest 由你决定。</p>
                </div>
                <span className="session-status">stable</span>
              </div>
              <div className="skill-form-grid">
                <label className="form-field">
                  <span>版本号</span>
                  <input
                    className="control-input"
                    value={uploadForm.version}
                    onChange={(event) => setUploadForm((prev) => ({ ...prev, version: event.target.value }))}
                  />
                </label>
                <label className="form-field">
                  <span>渠道</span>
                  <input className="control-input" value={uploadForm.channel} disabled />
                </label>
                <label className="form-field field-span-2">
                  <span>来源提交</span>
                  <input
                    className="control-input mono"
                    value={uploadForm.sourceCommit}
                    onChange={(event) => setUploadForm((prev) => ({ ...prev, sourceCommit: event.target.value }))}
                    placeholder="可选，用于回溯构建来源"
                  />
                </label>
                <label className="form-field field-span-2">
                  <span>发布说明</span>
                  <textarea
                    className="control-textarea"
                    rows={5}
                    value={uploadForm.releaseNotes}
                    onChange={(event) => setUploadForm((prev) => ({ ...prev, releaseNotes: event.target.value }))}
                    placeholder="记录这次变更的重点。"
                  />
                </label>
                <label className="form-field field-span-2">
                  <span>二进制文件</span>
                  <input
                    className="control-input"
                    type="file"
                    onChange={(event) =>
                      setUploadForm((prev) => ({ ...prev, binary: event.target.files?.[0] || null }))
                    }
                  />
                </label>
              </div>
              <div className="osac-release-upload-file">{uploadSelectedFileLabel}</div>
              <div className="osac-release-action-row">
                <button type="button" className="primary-btn" disabled={busy} onClick={() => void submitUpload()}>
                  上传并创建 release
                </button>
              </div>
            </article>

            <article className="sub-panel osac-release-upload-side">
              <div className="editor-header">
                <div>
                  <h3>发布规则</h3>
                  <p className="cell-subtle">先上传，再校验，再决定是否切换到当前版本。</p>
                </div>
              </div>
              <div className="osac-release-upload-aside-grid">
                <div className="osac-release-upload-aside-card">
                  <span>当前版本</span>
                  <strong>{currentPublishedRelease?.version || publishedVersion || '-'}</strong>
                </div>
                <div className="osac-release-upload-aside-card">
                  <span>待处理</span>
                  <strong>{releaseSummary.pending}</strong>
                </div>
              </div>
              <ul className="signal-list osac-release-upload-rules">
                <li>新上传文件不会自动接管最新版本。</li>
                <li>校验通过后再发布，便于快速定位异常。</li>
                <li>回滚时直接切换到已存在的历史版本。</li>
              </ul>
            </article>
          </div>
        ) : (
          <div className="osac-release-console-list-shell">
            <article className="sub-panel osac-release-list-panel">
              <div className="editor-header osac-release-list-head">
                <div>
                  <h3>{currentListTitle}</h3>
                  <p className="cell-subtle">{currentListSubtitle}</p>
                </div>
                <div className="osac-release-list-head-meta">
                  <span className="panel-caption">点击版本进入详情</span>
                  <span className="session-status">{filteredList.length} 个版本</span>
                </div>
              </div>
              {filteredList.length === 0 ? (
                <p className="empty osac-release-empty">当前标签下没有版本。</p>
              ) : (
                <div className="osac-release-list">
                  {filteredList.map((item) => {
                    const isSelected = selectedReleaseId === item.id;
                    const isCurrent = item.id === currentPublishedReleaseId;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`osac-release-row ${isSelected && detailDialogOpen ? 'active' : ''}`}
                        onClick={() => void openDetailDialog(item.id)}
                      >
                        <div className="osac-release-row-main">
                          <div className="osac-release-row-title">
                            <strong>{item.version}</strong>
                            {isCurrent ? <span className="osac-release-inline-tag">当前发布</span> : null}
                          </div>
                          <p className="osac-release-row-meta">
                            {formatDateTime(item.uploadedAt)} · {formatBytes(item.sizeBytes)} · {releaseStatusHint(item.status, isCurrent)}
                          </p>
                        </div>
                        <div className="osac-release-row-side">
                          <span className={`status-pill osac-release-status-${item.status}`}>{releaseStatusLabel(item.status)}</span>
                          <span className="mono osac-release-row-sha">{shortSha(item.sha256)}</span>
                          <span className="osac-release-row-link">查看详情</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </article>
          </div>
        )}
      </section>

      {detailDialogOpen ? (
        <>
        <AdminDetailShell
          open={detailDialogOpen}
          onClose={closeDetailDialog}
          size="lg"
          className="osac-release-modal"
          eyebrow="OSAC 版本详情"
          title={selectedRelease?.version || '版本详情'}
          subtitle={selectedRelease ? `${selectedRelease.platform}/${selectedRelease.arch} · 上传于 ${formatDateTime(selectedRelease.uploadedAt)}` : '正在加载版本详情...'}
          icon={getAdminModuleIcon('osac')}
          entityType="OSAC Release"
          lastUpdated={`上传 ${formatDateTime(selectedRelease?.uploadedAt)}`}
          risk={selectedRelease?.status === 'failed' ? '风险：校验失败' : selectedRelease?.id === currentPublishedReleaseId ? '风险：当前 latest' : '风险：可切换版本'}
          metrics={selectedRelease ? [{ label: '大小', value: formatBytes(selectedRelease.sizeBytes) }, { label: '渠道', value: selectedRelease.channel || '-' }, { label: '平台', value: `${selectedRelease.platform}/${selectedRelease.arch}` }, { label: 'SHA', value: shortSha(selectedRelease.sha256) }] : []}
          status={selectedRelease ? <StatusBadge>{selectedRelease.id === currentPublishedReleaseId ? '当前已发布' : releaseStatusLabel(selectedRelease.status)}</StatusBadge> : null}
          moreActions={selectedRelease ? <AdminButton variant="secondary" icon={getAdminActionIcon('logs')} onClick={() => setDiffOpen(true)}>查看 Diff</AdminButton> : null}
          inspector={selectedRelease ? <AdminStickyInspector compact title="Actionable Inspector" sections={[{ key: 'risk', title: '当前风险', children: <div className="signal-list"><p>{selectedRelease.status === 'failed' ? '校验失败，需重新检查后再发布。' : selectedRelease.id === currentPublishedReleaseId ? '当前 latest，切换会影响后续 sandbox。' : '候选版本，发布后 sandbox 将跟随新 latest。'}</p></div> }, { key: 'impact', title: '影响范围', children: <div className="signal-list"><p>stable 渠道 latest 指针与后续 sandbox OSAC 版本。</p><p>历史 release 记录保留。</p></div> }, { key: 'recent', title: '最近操作', children: <AuditTimeline compact items={[{ id: 'uploaded', title: '已上传', time: formatDateTime(selectedRelease.uploadedAt), tone: 'info', meta: [{ label: '大小', value: formatBytes(selectedRelease.sizeBytes) }] }, { id: 'published', title: selectedRelease.publishedAt ? '已发布' : '尚未发布', time: formatDateTime(selectedRelease.publishedAt), tone: selectedRelease.publishedAt ? 'success' : 'neutral', meta: [{ label: 'latest', value: selectedRelease.id === currentPublishedReleaseId ? '是' : '否' }] }]} /> }, { key: 'blockers', title: '阻断原因', children: <div className="signal-list"><p>{selectedRelease.status === 'failed' ? '当前 release 状态为失败。' : selectedRelease.status === 'uploaded' ? '需要先校验文件。' : '当前无前端可见阻断。'}</p></div> }, { key: 'recommend', title: '推荐动作', children: <div className="signal-list"><p>{selectedRelease.status === 'uploaded' ? '先校验文件，再决定是否发布。' : '切换前查看发布 Diff 与 latest 影响。'}</p></div> }, { key: 'actions', title: '快捷动作', children: <AdminButton variant="secondary" size="sm" onClick={() => setDiffOpen(true)}>查看发布 Diff</AdminButton> }]} /> : null}
          summary={selectedRelease ? <div className="osac-release-detail-summary"><div><span>版本号</span><strong>{selectedRelease.version}</strong></div><div><span>平台</span><strong>{selectedRelease.platform}/{selectedRelease.arch}</strong></div><div><span>当前 latest</span><strong>{detail?.currentPublishedVersion || publishedVersion || '-'}</strong></div><div><span>状态</span><strong>{selectedRelease.id === currentPublishedReleaseId ? '当前已发布' : releaseStatusLabel(selectedRelease.status)}</strong></div></div> : null}
        >
            <div className="admin-detail-section-stack osac-release-modal-body">
              {selectedRelease ? (
                <>
                  <div className="admin-detail-section osac-release-detail-facts">
                    <article className="osac-release-fact-card">
                      <span>对象大小</span>
                      <strong>{formatBytes(selectedRelease.sizeBytes)}</strong>
                    </article>
                    <article className="osac-release-fact-card">
                      <span>上传时间</span>
                      <strong>{formatDateTime(selectedRelease.uploadedAt)}</strong>
                    </article>
                    <article className="osac-release-fact-card">
                      <span>发布时间</span>
                      <strong>{formatDateTime(selectedRelease.publishedAt)}</strong>
                    </article>
                    <article className="osac-release-fact-card">
                      <span>来源提交</span>
                      <strong className="mono">{selectedRelease.sourceCommit || '-'}</strong>
                    </article>
                    <article className="osac-release-fact-card osac-release-fact-card-wide">
                      <span>对象 Key</span>
                      <strong className="mono">{selectedRelease.objectKey}</strong>
                    </article>
                    <article className="osac-release-fact-card osac-release-fact-card-wide">
                      <span>清单 Key</span>
                      <strong className="mono">{selectedRelease.manifestKey}</strong>
                    </article>
                    <article className="osac-release-fact-card osac-release-fact-card-wide">
                      <span>SHA256</span>
                      <strong className="mono">{shortSha(selectedRelease.sha256)}</strong>
                    </article>
                  </div>

                  <article className="admin-detail-section osac-release-notes">
                    <span>发布说明</span>
                    <CodePanel title="发布说明" value={selectedRelease.releaseNotes?.trim() || '暂无发布说明。'} language="markdown" maxHeight={180} />
                  </article>

                  <article className="admin-detail-section osac-release-notes">
                    <span>Release Timeline</span>
                    <AuditTimeline compact items={[{ id: 'uploaded', title: '已上传', time: formatDateTime(selectedRelease.uploadedAt), tone: 'info', meta: [{ label: '对象大小', value: formatBytes(selectedRelease.sizeBytes) }, { label: 'SHA256', value: shortSha(selectedRelease.sha256) }] }, { id: 'published', title: selectedRelease.publishedAt ? '已发布' : '尚未发布', time: formatDateTime(selectedRelease.publishedAt), tone: selectedRelease.publishedAt ? 'success' : 'neutral', meta: [{ label: 'latest', value: selectedRelease.id === currentPublishedReleaseId ? '是' : '否' }] }]} />
                  </article>

                  <div className="osac-release-action-row osac-release-modal-action-row">
                    <button
                      type="button"
                      className="ghost-btn"
                      disabled={busy || selectedRelease.status === 'published'}
                      onClick={() => void validateRelease()}
                    >
                      校验文件
                    </button>
                    {selectedRelease.id !== currentPublishedReleaseId && selectedRelease.status === 'published' ? (
                      <button
                        type="button"
                        className="primary-btn"
                        disabled={busy}
                        onClick={() => setDangerAction({ kind: 'rollback', releaseId: selectedRelease.id, label: selectedRelease.version, status: selectedRelease.status, channel: selectedRelease.channel, sha256: selectedRelease.sha256, currentLatest: publishedVersion || '-' })}
                      >
                        切换为当前版本
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="primary-btn"
                        disabled={busy || selectedRelease.id === currentPublishedReleaseId}
                        onClick={() => setDangerAction({ kind: 'publish', releaseId: selectedRelease.id, label: selectedRelease.version, status: selectedRelease.status, channel: selectedRelease.channel, sha256: selectedRelease.sha256, currentLatest: publishedVersion || '-' })}
                      >
                        {selectedRelease.id === currentPublishedReleaseId ? '当前已发布版本' : '发布为 latest'}
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <p className="empty osac-release-empty">正在加载版本详情...</p>
              )}
            </div>
        </AdminDetailShell>
        {selectedRelease ? <DiffDrawer open={diffOpen} onClose={() => setDiffOpen(false)} title="OSAC Release Diff" subtitle="无历史 before 内容时仅展示当前候选 release 元数据与发布说明，不称为历史内容对比。" objectLabel={selectedRelease.version} language="markdown" beforeText="当前前端没有可用的历史 before 文本。" afterText={selectedRelease.releaseNotes || ''} fields={[{ key: 'artifact', label: 'Artifact metadata', before: '-', after: JSON.stringify({ objectKey: selectedRelease.objectKey, manifestKey: selectedRelease.manifestKey, sha256: selectedRelease.sha256, sizeBytes: selectedRelease.sizeBytes }, null, 2), changeType: 'added' }]} impactItems={[`latest: ${detail?.currentPublishedVersion || publishedVersion || '-'}`, `候选版本: ${selectedRelease.version}`, '发布会更新 stable 渠道 latest 指针']} rollbackHint="可切换回已有已发布 release，但不会删除当前 release 记录。" syncHint="当前仅使用选中 release 的真实字段；无历史 before 时不展示伪造差异。" /> : null}
        </>
      ) : null}
      {dangerAction ? (
        <DangerConfirmDialog
          open={Boolean(dangerAction)}
          title={dangerAction.kind === 'publish' ? '确认发布 OSAC latest' : '确认切换当前 OSAC 版本'}
          objectLabel="OSAC Release"
          objectId={dangerAction.releaseId}
          objectName={dangerAction.label}
          objectMeta={[{ label: '渠道', value: dangerAction.channel }, { label: '当前 latest', value: dangerAction.currentLatest }, { label: 'SHA256', value: shortSha(dangerAction.sha256) }]}
          actionLabel={dangerAction.kind === 'publish' ? '发布为 latest' : '切换为当前版本'}
          impactItems={['stable 渠道当前版本指针会更新', '后续 sandbox 将跟随新的当前 OSAC 版本', '已存在历史 release 记录保留']}
          nonImpactItems={['不修改业务 API', '审计原因仅前端收集，不随当前 API 提交']}
          reversibility="partially_reversible"
          confirmText={dangerAction.label}
          loading={busy}
          onCancel={() => setDangerAction(null)}
          onConfirm={() => dangerAction.kind === 'publish' ? void publishRelease(dangerAction) : void rollbackRelease(dangerAction.releaseId)}
        />
      ) : null}
    </main>
  );
}
