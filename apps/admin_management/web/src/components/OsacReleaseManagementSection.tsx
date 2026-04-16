import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { OsacRelease, OsacReleaseDetailResponse } from '../types';

type Props = {
  onError: (message: string | null) => void;
};

type TabKey = 'published' | 'pending' | 'all' | 'upload';

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

export function OsacReleaseManagementSection({ onError }: Props) {
  const [tab, setTab] = useState<TabKey>('published');
  const [list, setList] = useState<OsacRelease[]>([]);
  const [publishedReleaseId, setPublishedReleaseId] = useState<string | null>(null);
  const [publishedVersion, setPublishedVersion] = useState<string | null>(null);
  const [selectedReleaseId, setSelectedReleaseId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OsacReleaseDetailResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
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
      return;
    }
    if (filteredList.length === 0) {
      setSelectedReleaseId(null);
      setDetail(null);
      return;
    }
    if (!selectedReleaseId || !filteredList.some((item) => item.id === selectedReleaseId)) {
      setSelectedReleaseId(filteredList[0].id);
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
    if (!selectedReleaseId) return;
    void loadDetail(selectedReleaseId).catch((error) => {
      onError(error instanceof Error ? error.message : 'OSAC release 详情加载失败');
    });
  }, [loadDetail, onError, selectedReleaseId]);

  const handleRefreshList = useCallback(() => {
    void loadList().catch((error) => {
      onError(error instanceof Error ? error.message : 'OSAC release 列表加载失败');
    });
  }, [loadList, onError]);

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
    }
  };

  const publishRelease = async () => {
    if (!detail?.release) return;
    setBusy(true);
    try {
      const next = await api.publishOsacRelease(detail.release.id);
      setDetail(next);
      await loadList();
    } catch (error) {
      onError(error instanceof Error ? error.message : '发布 OSAC latest 失败');
    } finally {
      setBusy(false);
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
    }
  };

  return (
    <main className="content-stack viewport-lock-page osac-release-page">
      <section className="panel hero-panel fade-in osac-release-hero-panel">
        <div className="panel-header osac-release-hero-head">
          <div>
            <p className="section-tag">OSAC 发布台</p>
            <h2>稳定版发布</h2>
            <p className="panel-copy osac-release-hero-copy">上传、校验、切换 latest 都在同一条工作流里完成，减少来回跳转。</p>
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

        <div className="osac-release-rule-strip">
          <span className="osac-release-rule-chip">上传后不会自动生效</span>
          <span className="osac-release-rule-chip">发布记录决定 latest</span>
          <span className="osac-release-rule-chip">二进制通过短时链接分发</span>
        </div>
      </section>

      <section className="panel fade-in osac-release-panel osac-release-console">
        <div className="section-heading osac-release-console-head">
          <div>
            <p className="eyebrow">发布工作区</p>
            <h2>版本选择与切换</h2>
            <p className="subtitle">先选版本，再在右侧完成校验、发布或切换。</p>
          </div>
          <div className="section-actions osac-release-toolbar">
            <input
              className="control-input"
              placeholder="搜索版本号"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <button type="button" className="ghost-btn" onClick={handleRefreshList} disabled={busy}>
              刷新
            </button>
          </div>
        </div>

        <div className="osac-release-tabs" role="tablist" aria-label="OSAC 视图切换">
          {tabOptions.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`osac-release-tab-btn ${tab === item.key ? 'active' : ''}`}
              onClick={() => setTab(item.key)}
              disabled={busy}
            >
              <span className="osac-release-tab-label">{item.label}</span>
              {item.count !== null ? <strong className="osac-release-tab-count">{item.count}</strong> : null}
              <small className="osac-release-tab-hint">{item.hint}</small>
            </button>
          ))}
        </div>

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
          <div className="osac-release-console-grid">
            <article className="sub-panel osac-release-list-panel">
              <div className="editor-header osac-release-list-head">
                <div>
                  <h3>{currentListTitle}</h3>
                  <p className="cell-subtle">{currentListSubtitle}</p>
                </div>
                <span className="session-status">{filteredList.length} 个版本</span>
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
                        className={`osac-release-row ${isSelected ? 'active' : ''}`}
                        onClick={() => setSelectedReleaseId(item.id)}
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
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </article>

            <article className="sub-panel osac-release-detail-panel">
              <div className="editor-header osac-release-detail-head">
                <div>
                  <h3>版本详情</h3>
                </div>
                {selectedRelease ? (
                  <span className={`status-pill osac-release-status-${selectedRelease.status}`}>
                    {selectedRelease.id === currentPublishedReleaseId ? '当前已发布' : releaseStatusLabel(selectedRelease.status)}
                  </span>
                ) : null}
              </div>
              <div className="osac-release-detail-body">
                {selectedRelease ? (
                  <>
                  <div className="osac-release-detail-summary">
                    <div>
                      <span>版本号</span>
                      <strong>{selectedRelease.version}</strong>
                    </div>
                    <div>
                      <span>平台</span>
                      <strong>{selectedRelease.platform}/{selectedRelease.arch}</strong>
                    </div>
                    <div>
                      <span>上传人</span>
                      <strong>{selectedRelease.uploadedBy || '-'}</strong>
                    </div>
                  </div>

                  <div className="osac-release-detail-facts">
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
                      <strong className="mono">{selectedRelease.sha256 || '-'}</strong>
                    </article>
                  </div>

                  <article className="osac-release-notes">
                    <span>发布说明</span>
                    <p>{selectedRelease.releaseNotes?.trim() || '暂无发布说明。'}</p>
                  </article>

                  <div className="osac-release-action-row">
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
                        onClick={() => void rollbackRelease(selectedRelease.id)}
                      >
                        切换为当前版本
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="primary-btn"
                        disabled={busy || selectedRelease.id === currentPublishedReleaseId}
                        onClick={() => void publishRelease()}
                      >
                        {selectedRelease.id === currentPublishedReleaseId ? '当前已发布版本' : '发布为 latest'}
                      </button>
                    )}
                  </div>
                  </>
                ) : (
                  <p className="empty osac-release-empty">请选择一个版本查看详情。</p>
                )}
              </div>
            </article>
          </div>
        )}
      </section>
    </main>
  );
}
