import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AdminButton, DangerConfirmDialog, StatusBadge } from './admin-ui';
import type { BillingNotify } from './billing-feedback';

type Placement = 'home_bubble' | 'sidebar_bubble';
type BannerStatus = 'draft' | 'published' | 'offline';

type PromoBannerItem = {
  id?: string;
  sortOrder: number;
  title: string;
  imageUrl: string;
  linkType?: 'internal' | 'external' | 'none';
  linkTarget?: string | null;
  isActive: boolean;
};

type PromoBanner = {
  id: string;
  name: string;
  placement: Placement;
  status: BannerStatus;
  priority: number;
  allowDismiss: boolean;
  dismissResetOnVersion: boolean;
  startAt: string | null;
  endAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  items: PromoBannerItem[];
};

type PromoBannerManagementProps = {
  onNotify?: BillingNotify;
};

const SIDEBAR_ASPECT_RATIO = 11 / 5;
const SIDEBAR_SIZE_HINT = '建议比例 11:5（例如 1100x500）';

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = src;
  });
}

export function PromoBannerManagement({ onNotify }: PromoBannerManagementProps) {
  const [tab, setTab] = useState<Placement>('sidebar_bubble');
  const [statusFilter, setStatusFilter] = useState<'all' | BannerStatus>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<PromoBanner[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [formLoading, setFormLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PromoBanner | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [cropOpen, setCropOpen] = useState(false);
  const [cropSource, setCropSource] = useState('');
  const [cropImageSize, setCropImageSize] = useState({ width: 0, height: 0 });
  const [cropViewportSize, setCropViewportSize] = useState({ width: 0, height: 0 });
  const [cropRect, setCropRect] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const [cropSubmitting, setCropSubmitting] = useState(false);
  const cropImageRef = useRef<HTMLImageElement | null>(null);
  const cropDragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);

  const [form, setForm] = useState({
    name: '',
    priority: 0,
    allowDismiss: true,
    dismissResetOnVersion: true,
    startAt: '',
    endAt: '',
    item: {
      title: '',
      imageUrl: '',
      linkType: 'none' as 'internal' | 'external' | 'none',
      linkTarget: '',
      isActive: true,
    },
  });

  const readPayload = () => ({
    name: form.name.trim(),
    placement: tab,
    displayType: 'single',
    priority: Number(form.priority || 0),
    allowDismiss: form.allowDismiss,
    dismissResetOnVersion: form.dismissResetOnVersion,
    startAt: form.startAt || null,
    endAt: form.endAt || null,
    items: [
      {
        sortOrder: 0,
        title: form.item.title.trim(),
        imageUrl: form.item.imageUrl.trim(),
        isActive: form.item.isActive,
        linkType: form.item.linkType,
        linkTarget: form.item.linkTarget.trim(),
      },
    ],
  });

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        placement: tab,
        page: '1',
        pageSize: '50',
      });
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (searchQuery.trim()) params.set('search', searchQuery.trim());
      const response = await fetch(`/api/internal/promo-banners?${params.toString()}`, {
        credentials: 'include',
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: '加载失败' }));
        throw new Error(err.error || '加载失败');
      }
      const data = await response.json();
      setItems((data.items || []) as PromoBanner[]);
    } catch (error) {
      onNotify?.('error', '加载失败', error instanceof Error ? error.message : '加载条幅失败');
    } finally {
      setLoading(false);
    }
  }, [onNotify, searchQuery, statusFilter, tab]);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  useEffect(() => {
    if (!cropSource) return;
    void loadImage(cropSource)
      .then((img) => setCropImageSize({ width: img.width, height: img.height }))
      .catch(() => setCropImageSize({ width: 0, height: 0 }));
  }, [cropSource]);

  const resetForm = () => {
    setEditingId(null);
    setForm({
      name: '',
      priority: 0,
      allowDismiss: true,
      dismissResetOnVersion: true,
      startAt: '',
      endAt: '',
      item: {
        title: '',
        imageUrl: '',
        linkType: 'none',
        linkTarget: '',
        isActive: true,
      },
    });
  };

  const openCreate = () => {
    resetForm();
    setFormOpen(true);
  };

  const openEdit = (banner: PromoBanner) => {
    const firstItem = banner.items[0];
    setEditingId(banner.id);
    setForm({
      name: banner.name,
      priority: banner.priority,
      allowDismiss: banner.allowDismiss,
      dismissResetOnVersion: banner.dismissResetOnVersion,
      startAt: banner.startAt ? banner.startAt.slice(0, 16) : '',
      endAt: banner.endAt ? banner.endAt.slice(0, 16) : '',
      item: {
        title: firstItem?.title || '',
        imageUrl: firstItem?.imageUrl || '',
        linkType: firstItem?.linkType || 'none',
        linkTarget: firstItem?.linkTarget || '',
        isActive: firstItem?.isActive !== false,
      },
    });
    setFormOpen(true);
  };

  const submit = async () => {
    try {
      if (!form.name.trim()) {
        onNotify?.('error', '参数错误', '条幅名称不能为空');
        return;
      }
      if (!form.item.title.trim()) {
        onNotify?.('error', '参数错误', '图片标题不能为空');
        return;
      }
      if (!form.item.imageUrl.trim()) {
        onNotify?.('error', '参数错误', '请先上传并裁剪图片');
        return;
      }
      setFormLoading(true);
      const response = await fetch(
        editingId ? `/api/internal/promo-banners/${editingId}` : '/api/internal/promo-banners',
        {
          method: editingId ? 'PUT' : 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(readPayload()),
        },
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: '保存失败' }));
        throw new Error(err.error || '保存失败');
      }
      onNotify?.('success', '保存成功', editingId ? '条幅已更新' : '条幅已创建');
      setFormOpen(false);
      await fetchList();
    } catch (error) {
      onNotify?.('error', '保存失败', error instanceof Error ? error.message : '保存失败');
    } finally {
      setFormLoading(false);
    }
  };

  const updateStatus = async (id: string, action: 'publish' | 'offline') => {
    try {
      const response = await fetch(`/api/internal/promo-banners/${id}/${action}`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: '操作失败' }));
        throw new Error(err.error || '操作失败');
      }
      onNotify?.('success', '操作成功', action === 'publish' ? '已发布' : '已下线');
      await fetchList();
    } catch (error) {
      onNotify?.('error', '操作失败', error instanceof Error ? error.message : '操作失败');
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      const response = await fetch(`/api/internal/promo-banners/${deleteTarget.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: '删除失败' }));
        throw new Error(err.error || '删除失败');
      }
      onNotify?.('success', '删除成功', '条幅已删除');
      setDeleteTarget(null);
      await fetchList();
    } catch (error) {
      onNotify?.('error', '删除失败', error instanceof Error ? error.message : '删除失败');
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleSelectImage = async (file: File) => {
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setCropSource(dataUrl);
      setCropViewportSize({ width: 0, height: 0 });
      setCropRect({ x: 0, y: 0, width: 0, height: 0 });
      setCropOpen(true);
    } catch (error) {
      onNotify?.('error', '图片处理失败', error instanceof Error ? error.message : '图片处理失败');
    }
  };

  const handleCropImageLoad = () => {
    const imageEl = cropImageRef.current;
    if (!imageEl) return;
    const width = imageEl.clientWidth;
    const height = imageEl.clientHeight;
    if (width <= 0 || height <= 0) return;
    setCropViewportSize({ width, height });
    const maxWidth = width * 0.9;
    const maxHeight = height * 0.9;
    let rectWidth = maxWidth;
    let rectHeight = rectWidth / SIDEBAR_ASPECT_RATIO;
    if (rectHeight > maxHeight) {
      rectHeight = maxHeight;
      rectWidth = rectHeight * SIDEBAR_ASPECT_RATIO;
    }
    setCropRect({
      width: rectWidth,
      height: rectHeight,
      x: (width - rectWidth) / 2,
      y: (height - rectHeight) / 2,
    });
  };

  const handleCropPointerDown: React.PointerEventHandler<HTMLDivElement> = (event) => {
    if (cropRect.width <= 0 || cropRect.height <= 0) return;
    cropDragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      baseX: cropRect.x,
      baseY: cropRect.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleCropPointerMove: React.PointerEventHandler<HTMLDivElement> = (event) => {
    const drag = cropDragRef.current;
    if (!drag) return;
    const maxX = Math.max(0, cropViewportSize.width - cropRect.width);
    const maxY = Math.max(0, cropViewportSize.height - cropRect.height);
    const nextX = Math.min(maxX, Math.max(0, drag.baseX + (event.clientX - drag.startX)));
    const nextY = Math.min(maxY, Math.max(0, drag.baseY + (event.clientY - drag.startY)));
    setCropRect((prev) => ({ ...prev, x: nextX, y: nextY }));
  };

  const handleCropPointerUp: React.PointerEventHandler<HTMLDivElement> = (event) => {
    if (cropDragRef.current) {
      cropDragRef.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleCropAndUpload = async () => {
    if (!cropSource || cropRect.width <= 0 || cropRect.height <= 0 || cropViewportSize.width <= 0 || cropViewportSize.height <= 0) return;
    try {
      setCropSubmitting(true);
      const image = await loadImage(cropSource);
      const scaleX = image.width / cropViewportSize.width;
      const scaleY = image.height / cropViewportSize.height;
      const sourceX = Math.max(0, Math.round(cropRect.x * scaleX));
      const sourceY = Math.max(0, Math.round(cropRect.y * scaleY));
      const sourceWidth = Math.max(1, Math.round(cropRect.width * scaleX));
      const sourceHeight = Math.max(1, Math.round(cropRect.height * scaleY));

      const outputWidth = 1100;
      const outputHeight = Math.round(outputWidth / SIDEBAR_ASPECT_RATIO);
      const canvas = document.createElement('canvas');
      canvas.width = outputWidth;
      canvas.height = outputHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('裁剪图片失败');
      ctx.drawImage(
        image,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        outputWidth,
        outputHeight,
      );

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((created) => {
          if (!created) {
            reject(new Error('裁剪图片失败'));
            return;
          }
          resolve(created);
        }, 'image/png');
      });
      const arrayBuffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);
      const dataBase64 = btoa(binary);

      setUploading(true);
      const response = await fetch('/api/internal/promo-banners/upload-media', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fileName: `promo-banner-${Date.now()}.png`,
          contentType: 'image/png',
          dataBase64,
        }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: '上传失败' }));
        throw new Error(err.error || '上传失败');
      }
      const payload = await response.json();
      const imageUrl = typeof payload?.publicUrl === 'string' ? payload.publicUrl : '';
      if (!imageUrl) throw new Error('上传成功但未返回可访问链接');

      setForm((prev) => ({ ...prev, item: { ...prev.item, imageUrl } }));
      onNotify?.('success', '上传成功', '已完成裁剪并上传图片');
      setCropOpen(false);
    } catch (error) {
      onNotify?.('error', '上传失败', error instanceof Error ? error.message : '上传失败');
    } finally {
      setCropSubmitting(false);
      setUploading(false);
    }
  };

  const totalItemsLabel = useMemo(() => `${items.length} 条`, [items.length]);

  return (
    <section className="notification-management">
      <div className="skill-secondary-menu" role="tablist" aria-label="宣传条幅标签">
        <button type="button" className={tab === 'home_bubble' ? 'active' : ''} onClick={() => setTab('home_bubble')}>
          首页气泡
        </button>
        <button type="button" className={tab === 'sidebar_bubble' ? 'active' : ''} onClick={() => setTab('sidebar_bubble')}>
          侧边栏气泡
        </button>
      </div>

      <div className="notification-actions">
        <AdminButton variant="primary" onClick={openCreate}>创建条幅</AdminButton>
        <AdminButton variant="secondary" onClick={fetchList}>刷新</AdminButton>
        <span className="text-xs text-[var(--muted-text-color)]">{totalItemsLabel}</span>
      </div>

      <div className="notification-filters">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className="filter-select">
          <option value="all">全部状态</option>
          <option value="draft">草稿</option>
          <option value="published">已发布</option>
          <option value="offline">已下线</option>
        </select>
        <input
          type="text"
          placeholder="搜索条幅名称..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="filter-search"
        />
      </div>

      <div className="table-wrap notification-table-wrap">
        <table className="notification-table">
          <thead>
            <tr>
              <th>条幅名称</th>
              <th>优先级</th>
              <th>状态</th>
              <th>标题</th>
              <th>更新时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="empty">加载中...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={6} className="empty">暂无条幅</td></tr>
            ) : items.map((banner) => (
              <tr key={banner.id}>
                <td>{banner.name}</td>
                <td>{banner.priority}</td>
                <td>
                  <StatusBadge tone={banner.status === 'published' ? 'success' : banner.status === 'offline' ? 'warning' : 'neutral'}>
                    {banner.status === 'published' ? '已发布' : banner.status === 'offline' ? '已下线' : '草稿'}
                  </StatusBadge>
                </td>
                <td>{banner.items[0]?.title || '-'}</td>
                <td>{new Date(banner.updatedAt).toLocaleString('zh-CN', { hour12: false })}</td>
                <td>
                  <div className="action-buttons">
                    <button type="button" className="table-btn" onClick={() => openEdit(banner)}>编辑</button>
                    {banner.status !== 'published' ? (
                      <button type="button" className="table-btn" onClick={() => void updateStatus(banner.id, 'publish')}>发布</button>
                    ) : (
                      <button type="button" className="table-btn" onClick={() => void updateStatus(banner.id, 'offline')}>下线</button>
                    )}
                    <button type="button" className="table-btn table-btn-danger" onClick={() => setDeleteTarget(banner)}>删除</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {formOpen ? (
        <div className="modal-overlay" onClick={() => setFormOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingId ? '编辑条幅' : '创建条幅'}</h3>
              <button type="button" className="modal-close" onClick={() => setFormOpen(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>条幅名称 *</label>
                <input type="text" value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>优先级</label>
                  <input type="number" value={form.priority} onChange={(e) => setForm((prev) => ({ ...prev, priority: Number(e.target.value || 0) }))} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>开始时间</label>
                  <input type="datetime-local" value={form.startAt} onChange={(e) => setForm((prev) => ({ ...prev, startAt: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label>结束时间</label>
                  <input type="datetime-local" value={form.endAt} onChange={(e) => setForm((prev) => ({ ...prev, endAt: e.target.value }))} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label><input type="checkbox" checked={form.allowDismiss} onChange={(e) => setForm((prev) => ({ ...prev, allowDismiss: e.target.checked }))} /> 允许用户关闭</label>
                </div>
                <div className="form-group">
                  <label><input type="checkbox" checked={form.dismissResetOnVersion} onChange={(e) => setForm((prev) => ({ ...prev, dismissResetOnVersion: e.target.checked }))} /> 版本更新后重置关闭状态</label>
                </div>
              </div>

              <div className="detail-group" style={{ marginBottom: 14 }}>
                <label>图片标题 *</label>
                <input
                  type="text"
                  placeholder="展示标题"
                  value={form.item.title}
                  onChange={(e) => setForm((prev) => ({ ...prev, item: { ...prev.item, title: e.target.value } }))}
                />
                <div style={{ marginTop: 10 }}>
                  <label>图片素材（{SIDEBAR_SIZE_HINT}）</label>
                  <input
                    type="text"
                    placeholder="图片 URL"
                    value={form.item.imageUrl}
                    onChange={(e) => setForm((prev) => ({ ...prev, item: { ...prev.item, imageUrl: e.target.value } }))}
                  />
                  <div style={{ marginTop: 6 }}>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void handleSelectImage(file);
                        e.currentTarget.value = '';
                      }}
                    />
                    {uploading ? <span className="text-xs text-[var(--muted-text-color)]" style={{ marginLeft: 8 }}>上传中...</span> : null}
                  </div>
                </div>
                <div className="form-row" style={{ marginTop: 10 }}>
                  <div className="form-group">
                    <label>点击跳转</label>
                    <select
                      value={form.item.linkType}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          item: {
                            ...prev.item,
                            linkType: e.target.value as 'internal' | 'external' | 'none',
                            linkTarget: e.target.value === 'none' ? '' : prev.item.linkTarget,
                          },
                        }))
                      }
                    >
                      <option value="none">不跳转</option>
                      <option value="internal">站内跳转</option>
                      <option value="external">外链跳转</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>跳转地址</label>
                    <input
                      type="text"
                      placeholder={form.item.linkType === 'external' ? 'https://example.com' : '/home'}
                      value={form.item.linkTarget}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, item: { ...prev.item, linkTarget: e.target.value } }))
                      }
                      disabled={form.item.linkType === 'none'}
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <AdminButton variant="secondary" onClick={() => setFormOpen(false)}>取消</AdminButton>
              <AdminButton variant="primary" loading={formLoading} onClick={submit}>保存</AdminButton>
            </div>
          </div>
        </div>
      ) : null}

      {cropOpen ? (
        <div className="modal-overlay" onClick={() => setCropOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>裁剪图片</h3>
              <button type="button" className="modal-close" onClick={() => setCropOpen(false)}>×</button>
            </div>
            <div className="modal-body">
              <p className="text-xs text-[var(--muted-text-color)]" style={{ marginBottom: 8 }}>
                侧边栏展示比例：{SIDEBAR_SIZE_HINT}。请直接拖动裁剪框选择保留区域。
                {cropImageSize.width > 0 ? ` 当前原图：${cropImageSize.width}x${cropImageSize.height}` : ''}
              </p>
              <div
                style={{
                  position: 'relative',
                  width: '100%',
                  maxWidth: 760,
                  margin: '0 auto',
                  userSelect: 'none',
                  borderRadius: 8,
                  overflow: 'hidden',
                }}
                onPointerMove={handleCropPointerMove}
                onPointerUp={handleCropPointerUp}
              >
                <img
                  ref={cropImageRef}
                  src={cropSource}
                  alt="待裁剪图片"
                  onLoad={handleCropImageLoad}
                  style={{ display: 'block', width: '100%', height: 'auto' }}
                />
                {cropRect.width > 0 && cropRect.height > 0 ? (
                  <div
                    role="button"
                    tabIndex={0}
                    onPointerDown={handleCropPointerDown}
                    style={{
                      position: 'absolute',
                      left: cropRect.x,
                      top: cropRect.y,
                      width: cropRect.width,
                      height: cropRect.height,
                      border: '2px solid #2563eb',
                      boxShadow: '0 0 0 9999px rgba(0,0,0,0.35)',
                      cursor: 'grab',
                    }}
                    aria-label="可拖动裁剪区域"
                  />
                ) : null}
              </div>
            </div>
            <div className="modal-footer">
              <AdminButton variant="secondary" onClick={() => setCropOpen(false)}>取消</AdminButton>
              <AdminButton variant="primary" loading={cropSubmitting} onClick={handleCropAndUpload}>裁剪并上传</AdminButton>
            </div>
          </div>
        </div>
      ) : null}

      <DangerConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除宣传条幅"
        objectLabel="条幅"
        objectId={deleteTarget?.id}
        objectName={deleteTarget?.name}
        actionLabel="删除"
        impactItems={['条幅将被永久删除', '关联素材将被同步删除']}
        reversibility="irreversible"
        loading={deleteLoading}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      />
    </section>
  );
}
