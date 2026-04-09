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

  const currentPublishedReleaseId = detail?.currentPublishedReleaseId || publishedReleaseId || null;

  const filteredList = useMemo(() => {
    if (tab === 'published') {
      return list.filter((item) => item.id === currentPublishedReleaseId);
    }
    if (tab === 'pending') {
      return list.filter((item) => item.status === 'uploaded' || item.status === 'validated');
    }
    return list;
  }, [currentPublishedReleaseId, list, tab]);

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
    <main className="content-stack">
      <section className="page-intro-grid fade-in">
        <article className="panel hero-panel">
          <div className="panel-header panel-header-stack">
            <div>
              <p className="section-tag">OSAC Artifact Control</p>
              <h2>统一管理 OSAC 版本、发布 latest，并驱动 sandbox 自动下载当前发布版本</h2>
            </div>
            <span className="service-state ok">R2 presigned GET</span>
          </div>
          <div className="hero-metrics">
            <div>
              <span className="hero-metric-label">当前已发布</span>
              <strong>{detail?.currentPublishedVersion || publishedVersion || '-'}</strong>
            </div>
            <div>
              <span className="hero-metric-label">Channel</span>
              <strong>stable</strong>
            </div>
            <div>
              <span className="hero-metric-label">版本总数</span>
              <strong>{list.length}</strong>
            </div>
          </div>
        </article>

        <article className="panel aside-panel">
          <div className="panel-header panel-header-stack">
            <div>
              <p className="section-tag">运行规则</p>
              <h2>上传不等于发布</h2>
            </div>
          </div>
          <ul className="signal-list">
            <li>新 sandbox 默认只跟随当前 published latest，不跟随最近上传文件。</li>
            <li>R2 只负责对象分发，发布真相源仍由平台的 release 与 channel 记录控制。</li>
            <li>sandbox 端下载 OSAC 时不接收主密钥，只接收短时 presigned URL。</li>
          </ul>
        </article>
      </section>

      <section className="panel fade-in">
        <div className="section-heading">
          <div>
            <p className="eyebrow">OSAC 版本管理标签卡</p>
            <h2>发布与回滚</h2>
            <p className="subtitle">选择一个 revision 查看详情、校验、发布为 latest 或回滚历史版本。</p>
          </div>
          <div className="section-actions">
            <input
              className="control-input"
              placeholder="按 version 搜索"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <button type="button" className="ghost-btn" onClick={() => void loadList()} disabled={busy}>
              刷新
            </button>
          </div>
        </div>

        <div className="section-actions" style={{ marginBottom: 16 }}>
          {([
            ['published', '已发布'],
            ['pending', '待发布'],
            ['all', '全部版本'],
            ['upload', '上传新版本'],
          ] as Array<[TabKey, string]>).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={tab === key ? 'primary-btn' : 'ghost-btn'}
              onClick={() => setTab(key)}
              disabled={busy}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'upload' ? (
          <article className="sub-panel">
            <div className="editor-header">
              <div>
                <h3>上传新版本</h3>
                <p className="cell-subtle">文件先上传到 R2 并生成 release，之后再显式发布为 latest。</p>
              </div>
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
                  className="control-input"
                  value={uploadForm.sourceCommit}
                  onChange={(event) => setUploadForm((prev) => ({ ...prev, sourceCommit: event.target.value }))}
                />
              </label>
              <label className="form-field field-span-2">
                <span>发布说明</span>
                <textarea
                  className="control-textarea"
                  rows={4}
                  value={uploadForm.releaseNotes}
                  onChange={(event) => setUploadForm((prev) => ({ ...prev, releaseNotes: event.target.value }))}
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
            <div className="section-actions" style={{ marginTop: 16 }}>
              <button type="button" className="primary-btn" disabled={busy} onClick={() => void submitUpload()}>
                上传到 R2 并创建 release
              </button>
            </div>
          </article>
        ) : (
          <div className="detail-grid modal-grid">
            <article className="sub-panel">
              <div className="editor-header">
                <div>
                  <h3>Revision 列表</h3>
                  <p className="cell-subtle">当前 published 版本会单独高亮。</p>
                </div>
              </div>
              <div className="skill-list">
                <table className="skill-table">
                  <thead>
                    <tr>
                      <th>版本</th>
                      <th>状态</th>
                      <th>大小</th>
                      <th>上传时间</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredList.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="table-empty">
                          当前标签下没有版本
                        </td>
                      </tr>
                    ) : (
                      filteredList.map((item) => (
                        <tr
                          key={item.id}
                          className={selectedReleaseId === item.id ? 'selected' : ''}
                          onClick={() => setSelectedReleaseId(item.id)}
                        >
                          <td>
                            <strong>{item.version}</strong>
                            <div className="cell-subtle">{item.id === currentPublishedReleaseId ? '当前已发布' : '-'}</div>
                          </td>
                          <td>
                            <span className={`status-pill status-${item.status}`}>{releaseStatusLabel(item.status)}</span>
                          </td>
                          <td>{formatBytes(item.sizeBytes)}</td>
                          <td>{formatDateTime(item.uploadedAt)}</td>
                          <td>
                            <button
                              type="button"
                              className="ghost-btn"
                              disabled={busy || item.id === currentPublishedReleaseId}
                              onClick={(event) => {
                                event.stopPropagation();
                                void rollbackRelease(item.id);
                              }}
                            >
                              回滚到此版本
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </article>

            <article className="sub-panel">
              <div className="editor-header">
                <div>
                  <h3>版本详情</h3>
                  <p className="cell-subtle">当前 sandbox 会自动下载当前 published latest。</p>
                </div>
              </div>
              {detail?.release ? (
                <>
                  <div className="signal-list">
                    <p><strong>版本号：</strong> {detail.release.version}</p>
                    <p><strong>状态：</strong> {releaseStatusLabel(detail.release.status)}</p>
                    <p><strong>存储桶：</strong> {detail.release.bucket}</p>
                    <p><strong>对象 Key：</strong> {detail.release.objectKey}</p>
                    <p><strong>清单 Key：</strong> {detail.release.manifestKey}</p>
                    <p><strong>SHA256：</strong> {shortSha(detail.release.sha256)}</p>
                    <p><strong>大小：</strong> {formatBytes(detail.release.sizeBytes)}</p>
                    <p><strong>来源提交：</strong> {detail.release.sourceCommit || '-'}</p>
                    <p><strong>上传人：</strong> {detail.release.uploadedBy || '-'}</p>
                    <p><strong>上传时间：</strong> {formatDateTime(detail.release.uploadedAt)}</p>
                    <p><strong>发布时间：</strong> {formatDateTime(detail.release.publishedAt)}</p>
                  </div>

                  <label className="form-field" style={{ marginTop: 16 }}>
                    <span>发布说明</span>
                    <textarea
                      className="control-textarea"
                      rows={5}
                      value={detail.release.releaseNotes || ''}
                      disabled
                    />
                  </label>

                  <div className="section-actions" style={{ marginTop: 16 }}>
                    <button type="button" className="ghost-btn" disabled={busy} onClick={() => void validateRelease()}>
                      校验文件
                    </button>
                    <button type="button" className="primary-btn" disabled={busy} onClick={() => void publishRelease()}>
                      发布为 latest
                    </button>
                  </div>
                </>
              ) : (
                <p className="empty">请选择一个 OSAC 版本。</p>
              )}
            </article>
          </div>
        )}
      </section>
    </main>
  );
}
