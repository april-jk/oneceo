import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminButton, DangerConfirmDialog, StatusBadge } from './admin-ui';
import type { BillingNotify } from './billing-feedback';

type Placement = 'home_bubble' | 'sidebar_bubble';
type DisplayType = 'single' | 'carousel';
type BannerStatus = 'draft' | 'published' | 'offline';

type PromoBannerItem = {
  id?: string;
  sortOrder: number;
  title: string;
  subtitle: string;
  imageUrl: string;
  ctaText: string;
  linkType: 'internal' | 'external' | 'none';
  linkTarget: string;
  isActive: boolean;
};

type PromoBanner = {
  id: string;
  name: string;
  placement: Placement;
  displayType: DisplayType;
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

const emptyItem = (index: number): PromoBannerItem => ({
  sortOrder: index,
  title: '',
  subtitle: '',
  imageUrl: '',
  ctaText: '',
  linkType: 'none',
  linkTarget: '',
  isActive: true,
});

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
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);
  const [form, setForm] = useState({
    name: '',
    displayType: 'single' as DisplayType,
    priority: 0,
    allowDismiss: true,
    dismissResetOnVersion: true,
    startAt: '',
    endAt: '',
    items: [emptyItem(0)],
  });

  const readPayload = () => ({
    name: form.name,
    placement: tab,
    displayType: form.displayType,
    priority: Number(form.priority || 0),
    allowDismiss: form.allowDismiss,
    dismissResetOnVersion: form.dismissResetOnVersion,
    startAt: form.startAt || null,
    endAt: form.endAt || null,
    items: form.items.map((item, index) => ({
      ...item,
      sortOrder: index,
      title: item.title.trim(),
      subtitle: item.subtitle.trim(),
      imageUrl: item.imageUrl.trim(),
      ctaText: item.ctaText.trim(),
      linkTarget: item.linkTarget.trim(),
    })),
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

  const resetForm = () => {
    setEditingId(null);
    setForm({
      name: '',
      displayType: 'single',
      priority: 0,
      allowDismiss: true,
      dismissResetOnVersion: true,
      startAt: '',
      endAt: '',
      items: [emptyItem(0)],
    });
  };

  const openCreate = () => {
    resetForm();
    setFormOpen(true);
  };

  const openEdit = (banner: PromoBanner) => {
    setEditingId(banner.id);
    setForm({
      name: banner.name,
      displayType: banner.displayType,
      priority: banner.priority,
      allowDismiss: banner.allowDismiss,
      dismissResetOnVersion: banner.dismissResetOnVersion,
      startAt: banner.startAt ? banner.startAt.slice(0, 16) : '',
      endAt: banner.endAt ? banner.endAt.slice(0, 16) : '',
      items: banner.items.length
        ? banner.items.map((item, index) => ({
            sortOrder: index,
            title: item.title || '',
            subtitle: item.subtitle || '',
            imageUrl: item.imageUrl || '',
            ctaText: item.ctaText || '',
            linkType: item.linkType || 'none',
            linkTarget: item.linkTarget || '',
            isActive: item.isActive !== false,
          }))
        : [emptyItem(0)],
    });
    setFormOpen(true);
  };

  const submit = async () => {
    try {
      if (!form.name.trim()) {
        onNotify?.('error', '参数错误', '条幅名称不能为空');
        return;
      }
      if (form.displayType === 'carousel' && form.items.length < 2) {
        onNotify?.('error', '参数错误', '轮播模式至少需要 2 条素材');
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

  const totalItemsLabel = useMemo(() => `${items.length} 条`, [items.length]);

  const handleUploadImage = async (index: number, file: File) => {
    try {
      setUploadingIndex(index);
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 1) {
        binary += String.fromCharCode(bytes[i]!);
      }
      const dataBase64 = btoa(binary);
      const response = await fetch('/api/internal/promo-banners/upload-media', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type || 'application/octet-stream',
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
      const next = [...form.items];
      next[index] = { ...next[index], imageUrl };
      setForm((prev) => ({ ...prev, items: next }));
      onNotify?.('success', '上传成功', '素材已上传并填入图片地址');
    } catch (error) {
      onNotify?.('error', '上传失败', error instanceof Error ? error.message : '上传失败');
    } finally {
      setUploadingIndex(null);
    }
  };

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
              <th>展示类型</th>
              <th>优先级</th>
              <th>状态</th>
              <th>素材数</th>
              <th>更新时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="empty">加载中...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={7} className="empty">暂无条幅</td></tr>
            ) : items.map((banner) => (
              <tr key={banner.id}>
                <td>{banner.name}</td>
                <td>{banner.displayType === 'carousel' ? '轮播' : '单卡'}</td>
                <td>{banner.priority}</td>
                <td>
                  <StatusBadge tone={banner.status === 'published' ? 'success' : banner.status === 'offline' ? 'warning' : 'neutral'}>
                    {banner.status === 'published' ? '已发布' : banner.status === 'offline' ? '已下线' : '草稿'}
                  </StatusBadge>
                </td>
                <td>{banner.items.length}</td>
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
                  <label>展示类型</label>
                  <select value={form.displayType} onChange={(e) => setForm((prev) => ({ ...prev, displayType: e.target.value as DisplayType }))}>
                    <option value="single">单卡</option>
                    <option value="carousel">轮播</option>
                  </select>
                </div>
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
              {form.items.map((item, index) => (
                <div key={`item-${index}`} className="detail-group" style={{ marginBottom: 14 }}>
                  <label>素材 #{index + 1}</label>
                  <div className="form-row">
                    <div className="form-group">
                      <input type="text" placeholder="标题 *" value={item.title} onChange={(e) => {
                        const next = [...form.items];
                        next[index] = { ...next[index], title: e.target.value };
                        setForm((prev) => ({ ...prev, items: next }));
                      }} />
                    </div>
                    <div className="form-group">
                      <input type="text" placeholder="副标题" value={item.subtitle} onChange={(e) => {
                        const next = [...form.items];
                        next[index] = { ...next[index], subtitle: e.target.value };
                        setForm((prev) => ({ ...prev, items: next }));
                      }} />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <input type="text" placeholder="图片 URL" value={item.imageUrl} onChange={(e) => {
                        const next = [...form.items];
                        next[index] = { ...next[index], imageUrl: e.target.value };
                        setForm((prev) => ({ ...prev, items: next }));
                      }} />
                      <div style={{ marginTop: 6 }}>
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/gif"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              void handleUploadImage(index, file);
                            }
                            e.currentTarget.value = '';
                          }}
                        />
                        {uploadingIndex === index ? (
                          <span className="text-xs text-[var(--muted-text-color)]" style={{ marginLeft: 8 }}>
                            上传中...
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="form-group">
                      <input type="text" placeholder="CTA 文案" value={item.ctaText} onChange={(e) => {
                        const next = [...form.items];
                        next[index] = { ...next[index], ctaText: e.target.value };
                        setForm((prev) => ({ ...prev, items: next }));
                      }} />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <select value={item.linkType} onChange={(e) => {
                        const next = [...form.items];
                        next[index] = { ...next[index], linkType: e.target.value as any };
                        setForm((prev) => ({ ...prev, items: next }));
                      }}>
                        <option value="none">不跳转</option>
                        <option value="internal">站内跳转</option>
                        <option value="external">外链跳转</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <input type="text" placeholder="跳转目标（路由或 https://）" value={item.linkTarget} onChange={(e) => {
                        const next = [...form.items];
                        next[index] = { ...next[index], linkTarget: e.target.value };
                        setForm((prev) => ({ ...prev, items: next }));
                      }} />
                    </div>
                  </div>
                </div>
              ))}
              <div className="notification-actions">
                <AdminButton variant="secondary" onClick={() => setForm((prev) => ({ ...prev, items: [...prev.items, emptyItem(prev.items.length)] }))}>
                  新增素材
                </AdminButton>
                <AdminButton
                  variant="secondary"
                  disabled={form.items.length <= 1}
                  onClick={() => setForm((prev) => ({ ...prev, items: prev.items.slice(0, -1) }))}
                >
                  移除最后一条
                </AdminButton>
              </div>
            </div>
            <div className="modal-footer">
              <AdminButton variant="secondary" onClick={() => setFormOpen(false)}>取消</AdminButton>
              <AdminButton variant="primary" loading={formLoading} onClick={submit}>保存</AdminButton>
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
