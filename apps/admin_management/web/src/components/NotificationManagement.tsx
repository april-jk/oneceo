import { useState, useEffect, useCallback } from 'react';
import { AdminButton, StatusBadge, DangerConfirmDialog } from './admin-ui';
import type { BillingNotify } from './billing-feedback';

interface Notification {
  id: string;
  title: string;
  content: string;
  type: string;
  priority: string;
  targetType: string;
  targetUserIds: string[] | null;
  status: string;
  publishedAt: string | null;
  expiresAt: string | null;
  metadataJson: unknown;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

interface NotificationStats {
  total: number;
  draft: number;
  published: number;
  archived: number;
  totalReads: number;
  totalUsers: number;
}

interface NotificationManagementProps {
  onNotify?: BillingNotify;
}

export function NotificationManagement({ onNotify }: NotificationManagementProps) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [limit] = useState(20);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // 表单状态
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: '',
    content: '',
    type: 'system',
    priority: 'normal',
    targetType: 'all',
    expiresAt: '',
  });
  const [formLoading, setFormLoading] = useState(false);

  // 详情状态
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailNotification, setDetailNotification] = useState<Notification | null>(null);
  const [detailStats, setDetailStats] = useState<NotificationStats | null>(null);

  // 删除确认
  const [deleteTarget, setDeleteTarget] = useState<Notification | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // 获取通知列表
  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(limit),
      });
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (typeFilter !== 'all') params.set('type', typeFilter);
      if (searchQuery.trim()) params.set('search', searchQuery.trim());

      const response = await fetch(`/api/internal/notifications?${params}`, {
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        setNotifications(data.items || []);
        setTotal(data.total || 0);
      } else {
        onNotify?.('error', '加载失败', '无法获取通知列表');
      }
    } catch (error) {
      console.error('获取通知列表失败:', error);
      onNotify?.('error', '加载失败', '无法获取通知列表');
    } finally {
      setLoading(false);
    }
  }, [page, limit, statusFilter, typeFilter, searchQuery, onNotify]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // 获取通知详情统计
  const fetchNotificationStats = async (id: string) => {
    try {
      const response = await fetch(`/api/internal/notifications/${id}/stats`, {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        setDetailStats(data);
      }
    } catch (error) {
      console.error('获取统计失败:', error);
    }
  };

  // 打开创建表单
  const handleCreate = () => {
    setEditingId(null);
    setForm({
      title: '',
      content: '',
      type: 'system',
      priority: 'normal',
      targetType: 'all',
      expiresAt: '',
    });
    setFormOpen(true);
  };

  // 打开编辑表单
  const handleEdit = (notification: Notification) => {
    setEditingId(notification.id);
    setForm({
      title: notification.title,
      content: notification.content,
      type: notification.type,
      priority: notification.priority,
      targetType: notification.targetType,
      expiresAt: notification.expiresAt ? notification.expiresAt.split('T')[0] : '',
    });
    setFormOpen(true);
  };

  // 提交表单
  const handleSubmit = async () => {
    if (!form.title.trim()) {
      onNotify?.('error', '参数错误', '通知标题不能为空');
      return;
    }
    if (!form.content.trim()) {
      onNotify?.('error', '参数错误', '通知内容不能为空');
      return;
    }

    setFormLoading(true);
    try {
      const url = editingId
        ? `/api/internal/notifications/${editingId}`
        : '/api/internal/notifications';
      const method = editingId ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ...form,
          expiresAt: form.expiresAt || undefined,
        }),
      });

      if (response.ok) {
        onNotify?.('success', '操作成功', editingId ? '通知已更新' : '通知已创建');
        setFormOpen(false);
        fetchNotifications();
      } else {
        const error = await response.json().catch(() => ({ error: '操作失败' }));
        onNotify?.('error', '操作失败', error.error || '操作失败');
      }
    } catch (error) {
      console.error('提交失败:', error);
      onNotify?.('error', '操作失败', '操作失败');
    } finally {
      setFormLoading(false);
    }
  };

  // 发布通知
  const handlePublish = async (id: string) => {
    try {
      const response = await fetch(`/api/internal/notifications/${id}/publish`, {
        method: 'POST',
        credentials: 'include',
      });
      if (response.ok) {
        onNotify?.('success', '操作成功', '通知已发布');
        fetchNotifications();
      } else {
        onNotify?.('error', '操作失败', '发布失败');
      }
    } catch (error) {
      console.error('发布失败:', error);
      onNotify?.('error', '操作失败', '发布失败');
    }
  };

  // 归档通知
  const handleArchive = async (id: string) => {
    try {
      const response = await fetch(`/api/internal/notifications/${id}/archive`, {
        method: 'POST',
        credentials: 'include',
      });
      if (response.ok) {
        onNotify?.('success', '操作成功', '通知已归档');
        fetchNotifications();
      } else {
        onNotify?.('error', '操作失败', '归档失败');
      }
    } catch (error) {
      console.error('归档失败:', error);
      onNotify?.('error', '操作失败', '归档失败');
    }
  };

  // 删除通知
  const handleDelete = async (_payload: { reason: string }) => {
    if (!deleteTarget) return;

    setDeleteLoading(true);
    try {
      const response = await fetch(`/api/internal/notifications/${deleteTarget.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (response.ok) {
        onNotify?.('success', '删除成功', '通知已删除');
        setDeleteTarget(null);
        setDetailOpen(false);
        setDetailNotification(null);
        fetchNotifications();
      } else {
        const error = await response.json().catch(() => ({ error: '删除失败' }));
        onNotify?.('error', '删除失败', error.error || '无法删除通知');
      }
    } catch (error) {
      console.error('删除通知失败:', error);
      onNotify?.('error', '删除失败', '无法删除通知');
    } finally {
      setDeleteLoading(false);
    }
  };

  // 查看详情
  const handleViewDetail = async (notification: Notification) => {
    setDetailNotification(notification);
    setDetailOpen(true);
    await fetchNotificationStats(notification.id);
  };

  // 格式化日期
  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString('zh-CN', { hour12: false });
  };

  // 状态标签
  const statusLabel = (status: string) => {
    switch (status) {
      case 'draft': return '草稿';
      case 'published': return '已发布';
      case 'archived': return '已归档';
      default: return status;
    }
  };

  // 状态色调
  const statusTone = (status: string) => {
    switch (status) {
      case 'draft': return 'neutral' as const;
      case 'published': return 'success' as const;
      case 'archived': return 'warning' as const;
      default: return 'neutral' as const;
    }
  };

  // 优先级标签
  const priorityLabel = (priority: string) => {
    switch (priority) {
      case 'urgent': return '紧急';
      case 'high': return '高';
      case 'normal': return '普通';
      case 'low': return '低';
      default: return priority;
    }
  };

  // 优先级色调
  const priorityTone = (priority: string) => {
    switch (priority) {
      case 'urgent': return 'danger' as const;
      case 'high': return 'warning' as const;
      case 'normal': return 'info' as const;
      case 'low': return 'neutral' as const;
      default: return 'neutral' as const;
    }
  };

  // 类型标签
  const typeLabel = (type: string) => {
    switch (type) {
      case 'system': return '系统';
      case 'billing': return '计费';
      case 'task': return '任务';
      case 'security': return '安全';
      default: return type;
    }
  };

  // 计算总页数
  const totalPages = Math.ceil(total / limit);

  return (
    <section className="notification-management">
      {/* 操作栏 */}
      <div className="notification-actions">
        <AdminButton variant="primary" onClick={handleCreate}>
          创建通知
        </AdminButton>
        <AdminButton variant="secondary" onClick={fetchNotifications}>
          刷新
        </AdminButton>
      </div>

      {/* 筛选栏 */}
      <div className="notification-filters">
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="filter-select"
        >
          <option value="all">全部状态</option>
          <option value="draft">草稿</option>
          <option value="published">已发布</option>
          <option value="archived">已归档</option>
        </select>
        <select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
          className="filter-select"
        >
          <option value="all">全部类型</option>
          <option value="system">系统</option>
          <option value="billing">计费</option>
          <option value="task">任务</option>
          <option value="security">安全</option>
        </select>
        <input
          type="text"
          placeholder="搜索通知标题..."
          value={searchQuery}
          onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
          className="filter-search"
        />
      </div>

      {/* 列表表格 */}
      <div className="table-wrap notification-table-wrap">
        <table className="notification-table">
          <thead>
            <tr>
              <th>标题</th>
              <th>类型</th>
              <th>优先级</th>
              <th>状态</th>
              <th>下发范围</th>
              <th>创建时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="empty">加载中...</td>
              </tr>
            ) : notifications.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty">暂无通知</td>
              </tr>
            ) : (
              notifications.map((notification) => (
                <tr key={notification.id}>
                  <td>
                    <div className="title-cell">
                      <strong>{notification.title}</strong>
                      <span className="content-preview">{notification.content.slice(0, 50)}...</span>
                    </div>
                  </td>
                  <td>
                    <StatusBadge tone="neutral">{typeLabel(notification.type)}</StatusBadge>
                  </td>
                  <td>
                    <StatusBadge tone={priorityTone(notification.priority)}>
                      {priorityLabel(notification.priority)}
                    </StatusBadge>
                  </td>
                  <td>
                    <StatusBadge tone={statusTone(notification.status)}>
                      {statusLabel(notification.status)}
                    </StatusBadge>
                  </td>
                  <td>{notification.targetType === 'all' ? '全员' : '指定用户'}</td>
                  <td>{formatDate(notification.createdAt)}</td>
                  <td>
                    <div className="action-buttons">
                      <button
                        type="button"
                        className="table-btn"
                        onClick={() => handleViewDetail(notification)}
                      >
                        详情
                      </button>
                      {notification.status === 'draft' && (
                        <>
                          <button
                            type="button"
                            className="table-btn"
                            onClick={() => handleEdit(notification)}
                          >
                            编辑
                          </button>
                          <button
                            type="button"
                            className="table-btn"
                            onClick={() => handlePublish(notification.id)}
                          >
                            发布
                          </button>
                        </>
                      )}
                      {notification.status === 'published' && (
                        <button
                          type="button"
                          className="table-btn"
                          onClick={() => handleArchive(notification.id)}
                        >
                          归档
                        </button>
                      )}
                      <button
                        type="button"
                        className="table-btn table-btn-danger"
                        onClick={() => setDeleteTarget(notification)}
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="pagination">
          <span className="pagination-info">共 {total} 条，第 {page}/{totalPages} 页</span>
          <div className="pagination-buttons">
            <AdminButton
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              上一页
            </AdminButton>
            <AdminButton
              variant="secondary"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
            >
              下一页
            </AdminButton>
          </div>
        </div>
      )}

      {/* 创建/编辑弹窗 */}
      {formOpen && (
        <div className="modal-overlay" onClick={() => setFormOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingId ? '编辑通知' : '创建通知'}</h3>
              <button type="button" className="modal-close" onClick={() => setFormOpen(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>标题 *</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="输入通知标题"
                />
              </div>
              <div className="form-group">
                <label>内容 *</label>
                <textarea
                  value={form.content}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                  placeholder="输入通知内容"
                  rows={4}
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>类型</label>
                  <select
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value })}
                  >
                    <option value="system">系统</option>
                    <option value="billing">计费</option>
                    <option value="task">任务</option>
                    <option value="security">安全</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>优先级</label>
                  <select
                    value={form.priority}
                    onChange={(e) => setForm({ ...form, priority: e.target.value })}
                  >
                    <option value="low">低</option>
                    <option value="normal">普通</option>
                    <option value="high">高</option>
                    <option value="urgent">紧急</option>
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>下发范围</label>
                  <select
                    value={form.targetType}
                    onChange={(e) => setForm({ ...form, targetType: e.target.value })}
                  >
                    <option value="all">全员</option>
                    <option value="specific_users">指定用户</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>有效期（可选）</label>
                  <input
                    type="date"
                    value={form.expiresAt}
                    onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
                  />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <AdminButton variant="secondary" onClick={() => setFormOpen(false)}>
                取消
              </AdminButton>
              <AdminButton
                variant="primary"
                loading={formLoading}
                onClick={handleSubmit}
              >
                确定
              </AdminButton>
            </div>
          </div>
        </div>
      )}

      {/* 详情弹窗 */}
      {detailOpen && detailNotification && (
        <div className="modal-overlay" onClick={() => setDetailOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>通知详情</h3>
              <button type="button" className="modal-close" onClick={() => setDetailOpen(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="detail-group">
                <label>标题</label>
                <p>{detailNotification.title}</p>
              </div>
              <div className="detail-group">
                <label>内容</label>
                <p className="detail-content">{detailNotification.content}</p>
              </div>
              <div className="detail-row">
                <div className="detail-group">
                  <label>类型</label>
                  <StatusBadge tone="neutral">{typeLabel(detailNotification.type)}</StatusBadge>
                </div>
                <div className="detail-group">
                  <label>优先级</label>
                  <StatusBadge tone={priorityTone(detailNotification.priority)}>
                    {priorityLabel(detailNotification.priority)}
                  </StatusBadge>
                </div>
                <div className="detail-group">
                  <label>状态</label>
                  <StatusBadge tone={statusTone(detailNotification.status)}>
                    {statusLabel(detailNotification.status)}
                  </StatusBadge>
                </div>
              </div>
              {detailStats && (
                <div className="detail-stats">
                  <div className="stat-item">
                    <span className="stat-label">总用户数</span>
                    <strong>{detailStats.totalUsers}</strong>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">已读数</span>
                    <strong>{detailStats.totalReads}</strong>
                  </div>
                </div>
              )}
              <div className="detail-row">
                <div className="detail-group">
                  <label>创建时间</label>
                  <p>{formatDate(detailNotification.createdAt)}</p>
                </div>
                <div className="detail-group">
                  <label>发布时间</label>
                  <p>{formatDate(detailNotification.publishedAt)}</p>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <AdminButton variant="secondary" onClick={() => setDetailOpen(false)}>
                关闭
              </AdminButton>
            </div>
          </div>
        </div>
      )}

      {/* 删除确认弹窗 */}
      <DangerConfirmDialog
        open={!!deleteTarget}
        title="删除通知"
        objectLabel="通知"
        objectId={deleteTarget?.id}
        objectName={deleteTarget?.title}
        actionLabel="删除"
        impactItems={['通知将被永久删除', '所有用户的已读记录将被清除']}
        reversibility="irreversible"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        loading={deleteLoading}
      />
    </section>
  );
}