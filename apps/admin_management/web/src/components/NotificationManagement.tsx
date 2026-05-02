import { useState, useEffect, useCallback } from 'react';
import { AdminButton, AdminTabs, StatusBadge, DangerConfirmDialog } from './admin-ui';
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
  const [stats, setStats] = useState<NotificationStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [limit] = useState(20);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // 创建/编辑弹窗状态
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: '',
    content: '',
    type: 'system',
    priority: 'normal',
    targetType: 'all',
    targetUserIds: [] as string[],
    expiresAt: '',
  });
  const [formLoading, setFormLoading] = useState(false);

  // 详情弹窗状态
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailNotification, setDetailNotification] = useState<Notification | null>(null);
  const [detailStats, setDetailStats] = useState<NotificationStats | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // 删除确认状态
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // 获取通知列表
  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: limit.toString(),
      });
      if (statusFilter !== 'all') params.append('status', statusFilter);
      if (typeFilter !== 'all') params.append('type', typeFilter);
      if (searchQuery) params.append('search', searchQuery);

      const response = await fetch(`/api/internal/notifications?${params}`);
      if (!response.ok) throw new Error('获取通知列表失败');
      const data = await response.json();
      setNotifications(data.items);
      setTotal(data.total);
    } catch (error) {
      console.error('获取通知列表失败:', error);
      onNotify?.('error', '获取失败', '获取通知列表失败');
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
      const response = await fetch(`/api/internal/notifications/${id}/stats`);
      if (!response.ok) throw new Error('获取统计失败');
      const data = await response.json();
      setDetailStats(data);
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
      targetUserIds: [],
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
      targetUserIds: notification.targetUserIds || [],
      expiresAt: notification.expiresAt ? notification.expiresAt.split('T')[0] : '',
    });
    setFormOpen(true);
  };

  // 提交表单
  const handleSubmit = async () => {
    if (!form.title.trim()) {
      onNotify?.('error', '验证失败', '通知标题不能为空');
      return;
    }
    if (!form.content.trim()) {
      onNotify?.('error', '验证失败', '通知内容不能为空');
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
        body: JSON.stringify({
          ...form,
          expiresAt: form.expiresAt || undefined,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || '操作失败');
      }

      onNotify?.('success', '操作成功', editingId ? '通知已更新' : '通知已创建');
      setFormOpen(false);
      fetchNotifications();
    } catch (error) {
      console.error('提交失败:', error);
      onNotify?.('error', '操作失败', error instanceof Error ? error.message : '操作失败');
    } finally {
      setFormLoading(false);
    }
  };

  // 发布通知
  const handlePublish = async (id: string) => {
    try {
      const response = await fetch(`/api/internal/notifications/${id}/publish`, {
        method: 'POST',
      });
      if (!response.ok) throw new Error('发布失败');
      onNotify?.('success', '发布成功', '通知已发布');
      fetchNotifications();
    } catch (error) {
      console.error('发布失败:', error);
      onNotify?.('error', '发布失败', '发布失败');
    }
  };

  // 归档通知
  const handleArchive = async (id: string) => {
    try {
      const response = await fetch(`/api/internal/notifications/${id}/archive`, {
        method: 'POST',
      });
      if (!response.ok) throw new Error('归档失败');
      onNotify?.('success', '归档成功', '通知已归档');
      fetchNotifications();
    } catch (error) {
      console.error('归档失败:', error);
      onNotify?.('error', '归档失败', '归档失败');
    }
  };

  // 删除通知
  const handleDelete = async () => {
    if (!deletingId) return;
    try {
      const response = await fetch(`/api/internal/notifications/${deletingId}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('删除失败');
      onNotify?.('success', '删除成功', '通知已删除');
      setDeleteConfirmOpen(false);
      setDeletingId(null);
      fetchNotifications();
    } catch (error) {
      console.error('删除失败:', error);
      onNotify?.('error', '删除失败', '删除失败');
    }
  };

  // 查看详情
  const handleViewDetail = async (notification: Notification) => {
    setDetailNotification(notification);
    setDetailOpen(true);
    await fetchNotificationStats(notification.id);
  };

  // 获取状态颜色
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'draft': return 'bg-gray-100 text-gray-800';
      case 'published': return 'bg-green-100 text-green-800';
      case 'archived': return 'bg-blue-100 text-blue-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  // 获取优先级颜色
  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent': return 'bg-red-100 text-red-800';
      case 'high': return 'bg-orange-100 text-orange-800';
      case 'normal': return 'bg-blue-100 text-blue-800';
      case 'low': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  // 获取类型标签
  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'system': return '系统';
      case 'billing': return '计费';
      case 'task': return '任务';
      case 'security': return '安全';
      default: return type;
    }
  };

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">通知管理</h2>
          <p className="text-sm text-muted-foreground">管理系统通知，向用户下发通知</p>
        </div>
        <AdminButton onClick={handleCreate}>创建通知</AdminButton>
      </div>

      {/* 筛选栏 */}
      <div className="flex items-center gap-4">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border rounded-md"
        >
          <option value="all">全部状态</option>
          <option value="draft">草稿</option>
          <option value="published">已发布</option>
          <option value="archived">已归档</option>
        </select>

        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="px-3 py-2 border rounded-md"
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
          onChange={(e) => setSearchQuery(e.target.value)}
          className="px-3 py-2 border rounded-md flex-1"
        />
      </div>

      {/* 通知列表 */}
      <div className="border rounded-lg">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">标题</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">类型</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">优先级</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">状态</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">创建时间</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  加载中...
                </td>
              </tr>
            ) : notifications.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  暂无通知
                </td>
              </tr>
            ) : (
              notifications.map((notification) => (
                <tr key={notification.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-medium">{notification.title}</div>
                    <div className="text-sm text-gray-500 truncate max-w-xs">
                      {notification.content}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-1 text-xs rounded-full bg-gray-100">
                      {getTypeLabel(notification.type)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs rounded-full ${getPriorityColor(notification.priority)}`}>
                      {notification.priority === 'urgent' ? '紧急' :
                       notification.priority === 'high' ? '高' :
                       notification.priority === 'normal' ? '普通' : '低'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs rounded-full ${getStatusColor(notification.status)}`}>
                      {notification.status === 'draft' ? '草稿' :
                       notification.status === 'published' ? '已发布' : '已归档'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {new Date(notification.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleViewDetail(notification)}
                        className="text-blue-600 hover:text-blue-800 text-sm"
                      >
                        详情
                      </button>
                      {notification.status === 'draft' && (
                        <>
                          <button
                            onClick={() => handleEdit(notification)}
                            className="text-gray-600 hover:text-gray-800 text-sm"
                          >
                            编辑
                          </button>
                          <button
                            onClick={() => handlePublish(notification.id)}
                            className="text-green-600 hover:text-green-800 text-sm"
                          >
                            发布
                          </button>
                        </>
                      )}
                      {notification.status === 'published' && (
                        <button
                          onClick={() => handleArchive(notification.id)}
                          className="text-orange-600 hover:text-orange-800 text-sm"
                        >
                          归档
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setDeletingId(notification.id);
                          setDeleteConfirmOpen(true);
                        }}
                        className="text-red-600 hover:text-red-800 text-sm"
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
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-500">
          共 {total} 条记录
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page === 1}
            className="px-3 py-1 border rounded disabled:opacity-50"
          >
            上一页
          </button>
          <span className="text-sm">第 {page} 页</span>
          <button
            onClick={() => setPage(page + 1)}
            disabled={notifications.length < limit}
            className="px-3 py-1 border rounded disabled:opacity-50"
          >
            下一页
          </button>
        </div>
      </div>

      {/* 创建/编辑弹窗 */}
      {formOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold mb-4">
              {editingId ? '编辑通知' : '创建通知'}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">标题 *</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md"
                  placeholder="输入通知标题"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">内容 *</label>
                <textarea
                  value={form.content}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md h-32"
                  placeholder="输入通知内容"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">类型</label>
                  <select
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md"
                  >
                    <option value="system">系统</option>
                    <option value="billing">计费</option>
                    <option value="task">任务</option>
                    <option value="security">安全</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">优先级</label>
                  <select
                    value={form.priority}
                    onChange={(e) => setForm({ ...form, priority: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md"
                  >
                    <option value="low">低</option>
                    <option value="normal">普通</option>
                    <option value="high">高</option>
                    <option value="urgent">紧急</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">下发范围</label>
                  <select
                    value={form.targetType}
                    onChange={(e) => setForm({ ...form, targetType: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md"
                  >
                    <option value="all">全员</option>
                    <option value="specific_users">指定用户</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">有效期（可选）</label>
                  <input
                    type="date"
                    value={form.expiresAt}
                    onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setFormOpen(false)}
                className="px-4 py-2 border rounded-md hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={handleSubmit}
                disabled={formLoading}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {formLoading ? '提交中...' : '确定'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 详情弹窗 */}
      {detailOpen && detailNotification && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold mb-4">通知详情</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-500">标题</label>
                <p className="mt-1">{detailNotification.title}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500">内容</label>
                <p className="mt-1 whitespace-pre-wrap">{detailNotification.content}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-500">类型</label>
                  <p className="mt-1">{getTypeLabel(detailNotification.type)}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-500">优先级</label>
                  <p className="mt-1">{detailNotification.priority}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-500">状态</label>
                  <p className="mt-1">{detailNotification.status === 'draft' ? '草稿' :
                    detailNotification.status === 'published' ? '已发布' : '已归档'}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-500">下发范围</label>
                  <p className="mt-1">{detailNotification.targetType === 'all' ? '全员' : '指定用户'}</p>
                </div>
              </div>
              {detailStats && (
                <div className="border-t pt-4">
                  <label className="block text-sm font-medium text-gray-500 mb-2">统计数据</label>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>总用户数：{detailStats.totalUsers}</div>
                    <div>已读数：{detailStats.totalReads}</div>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4 text-sm text-gray-500">
                <div>创建时间：{new Date(detailNotification.createdAt).toLocaleString()}</div>
                <div>
                  发布时间：{detailNotification.publishedAt
                    ? new Date(detailNotification.publishedAt).toLocaleString()
                    : '-'}
                </div>
              </div>
            </div>
            <div className="flex justify-end mt-6">
              <button
                onClick={() => setDetailOpen(false)}
                className="px-4 py-2 border rounded-md hover:bg-gray-50"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 删除确认弹窗 */}
      <DangerConfirmDialog
        open={deleteConfirmOpen}
        title="删除通知"
        objectLabel="通知"
        objectId={deletingId}
        actionLabel="删除"
        impactItems={['通知将被永久删除', '所有用户的已读记录将被清除']}
        reversibility="irreversible"
        onCancel={() => {
          setDeleteConfirmOpen(false);
          setDeletingId(null);
        }}
        onConfirm={handleDelete}
      />
    </div>
  );
}