import { useState, useEffect, useCallback } from 'react';
import { AdminButton, AdminTabs, StatusBadge, DangerConfirmDialog } from './admin-ui';
import type { BillingNotify } from './billing-feedback';

interface ActivationCode {
  id: string;
  code: string;
  creditsAmount: number;
  status: 'active' | 'disabled' | 'used' | 'expired';
  maxUses: number;
  currentUses: number;
  expiresAt: string | null;
  groupId: string | null;
  createdBy: string | null;
  usedBy: string | null;
  usedAt: string | null;
  batchId: string | null;
  description: string | null;
  metadataJson: unknown;
  createdAt: string;
  updatedAt: string;
  creatorName?: string | null;
  usedByName?: string | null;
  usedByEmail?: string | null;
  groupName?: string | null;
}

interface ActivationCodeDetail extends ActivationCode {
  uses: Array<{
    id: string;
    userId: string;
    userName?: string | null;
    userEmail?: string | null;
    creditsGranted: number;
    usedAt: string;
  }>;
}

interface ActivationCodeStats {
  total: number;
  active: number;
  used: number;
  disabled: number;
  expired: number;
  totalCredits: number;
  usedCredits: number;
}

interface ActivationCodeGroup {
  id: string;
  name: string;
  description: string | null;
  status: string;
  codeCount: number;
  createdAt: string;
}

interface ActivationCodeManagementProps {
  onNotify?: BillingNotify;
}

export function ActivationCodeManagement({ onNotify }: ActivationCodeManagementProps) {
  const [codes, setCodes] = useState<ActivationCode[]>([]);
  const [stats, setStats] = useState<ActivationCodeStats | null>(null);
  const [groups, setGroups] = useState<ActivationCodeGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [limit] = useState(20);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [groupIdFilter, setGroupIdFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<string>('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // 创建弹窗状态
  const [createFormOpen, setCreateFormOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    creditsAmount: '',
    quantity: '1',
    maxUses: '1',
    expiresInDays: '30',
    description: '',
    prefix: '',
    groupId: '',
  });
  const [createLoading, setCreateLoading] = useState(false);

  // 分组管理弹窗状态
  const [groupFormOpen, setGroupFormOpen] = useState(false);
  const [groupForm, setGroupForm] = useState({
    name: '',
    description: '',
  });
  const [groupLoading, setGroupLoading] = useState(false);

  // 详情弹窗状态
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailCode, setDetailCode] = useState<ActivationCodeDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // 删除确认状态
  const [deleteTarget, setDeleteTarget] = useState<ActivationCode | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // 分组删除确认状态
  const [deleteGroupTarget, setDeleteGroupTarget] = useState<ActivationCodeGroup | null>(null);
  const [deleteGroupLoading, setDeleteGroupLoading] = useState(false);

  // 获取激活码列表
  const fetchCodes = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        sortBy,
        sortOrder,
      });

      if (statusFilter !== 'all') {
        params.set('status', statusFilter);
      }

      if (groupIdFilter !== 'all') {
        params.set('groupId', groupIdFilter);
      }

      if (searchQuery.trim()) {
        params.set('search', searchQuery.trim());
      }

      const response = await fetch(`/api/internal/billing/activation-codes?${params}`, {
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        setCodes(data.items || []);
        setTotal(data.total || 0);
      } else {
        onNotify?.('error', '加载失败', '无法获取激活码列表');
      }
    } catch (error) {
      console.error('获取激活码列表失败:', error);
      onNotify?.('error', '加载失败', '无法获取激活码列表');
    } finally {
      setLoading(false);
    }
  }, [page, limit, statusFilter, groupIdFilter, searchQuery, sortBy, sortOrder, onNotify]);

  // 获取统计数据
  const fetchStats = useCallback(async () => {
    try {
      const response = await fetch('/api/internal/billing/activation-codes/stats', {
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        setStats(data);
      }
    } catch (error) {
      console.error('获取激活码统计失败:', error);
    }
  }, []);

  // 获取分组列表
  const fetchGroups = useCallback(async () => {
    try {
      const response = await fetch('/api/internal/billing/activation-code-groups', {
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        setGroups(data || []);
      }
    } catch (error) {
      console.error('获取分组列表失败:', error);
    }
  }, []);

  useEffect(() => {
    fetchCodes();
    fetchStats();
    fetchGroups();
  }, [fetchCodes, fetchStats, fetchGroups]);

  // 创建激活码
  const handleCreate = async () => {
    const creditsAmount = parseInt(createForm.creditsAmount);
    const quantity = parseInt(createForm.quantity);
    const maxUses = parseInt(createForm.maxUses);
    const expiresInDays = createForm.expiresInDays ? parseInt(createForm.expiresInDays) : null;

    if (!creditsAmount || creditsAmount <= 0) {
      onNotify?.('error', '参数错误', '积分数量必须大于 0');
      return;
    }

    if (!quantity || quantity < 1 || quantity > 1000) {
      onNotify?.('error', '参数错误', '生成数量必须在 1-1000 之间');
      return;
    }

    setCreateLoading(true);
    try {
      const response = await fetch('/api/internal/billing/activation-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          creditsAmount,
          quantity,
          maxUses,
          expiresInDays,
          description: createForm.description || undefined,
          prefix: createForm.prefix || undefined,
          groupId: createForm.groupId || undefined,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        onNotify?.('success', '创建成功', `已生成 ${data.items.length} 个激活码`);
        setCreateFormOpen(false);
        setCreateForm({
          creditsAmount: '',
          quantity: '1',
          maxUses: '1',
          expiresInDays: '30',
          description: '',
          prefix: '',
          groupId: '',
        });
        fetchCodes();
        fetchStats();
      } else {
        const error = await response.json().catch(() => ({ error: '创建失败' }));
        onNotify?.('error', '创建失败', error.error || '创建激活码失败');
      }
    } catch (error) {
      console.error('创建激活码失败:', error);
      onNotify?.('error', '创建失败', '创建激活码失败');
    } finally {
      setCreateLoading(false);
    }
  };

  // 创建分组
  const handleCreateGroup = async () => {
    if (!groupForm.name.trim()) {
      onNotify?.('error', '参数错误', '分组名称不能为空');
      return;
    }

    setGroupLoading(true);
    try {
      const response = await fetch('/api/internal/billing/activation-code-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: groupForm.name.trim(),
          description: groupForm.description || undefined,
        }),
      });

      if (response.ok) {
        onNotify?.('success', '创建成功', '分组已创建');
        setGroupFormOpen(false);
        setGroupForm({ name: '', description: '' });
        fetchGroups();
      } else {
        const error = await response.json().catch(() => ({ error: '创建失败' }));
        onNotify?.('error', '创建失败', error.error || '创建分组失败');
      }
    } catch (error) {
      console.error('创建分组失败:', error);
      onNotify?.('error', '创建失败', '创建分组失败');
    } finally {
      setGroupLoading(false);
    }
  };

  // 删除分组
  const handleDeleteGroup = async () => {
    if (!deleteGroupTarget) return;

    setDeleteGroupLoading(true);
    try {
      const response = await fetch(`/api/internal/billing/activation-code-groups/${deleteGroupTarget.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (response.ok) {
        onNotify?.('success', '删除成功', '分组已删除');
        setDeleteGroupTarget(null);
        fetchGroups();
      } else {
        const error = await response.json().catch(() => ({ error: '删除失败' }));
        onNotify?.('error', '删除失败', error.error || '删除分组失败');
      }
    } catch (error) {
      console.error('删除分组失败:', error);
      onNotify?.('error', '删除失败', '删除分组失败');
    } finally {
      setDeleteGroupLoading(false);
    }
  };

  // 导出 CSV
  const handleExportCSV = async () => {
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') {
        params.set('status', statusFilter);
      }
      if (groupIdFilter !== 'all') {
        params.set('groupId', groupIdFilter);
      }
      if (searchQuery.trim()) {
        params.set('search', searchQuery.trim());
      }

      const response = await fetch(`/api/internal/billing/activation-codes/export?${params}`, {
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        
        // 生成 CSV
        const headers = ['激活码', '积分', '状态', '使用次数', '分组', '描述', '创建时间', '过期时间'];
        const rows = data.map((item: any) => [
          item.code,
          item.creditsAmount,
          item.status,
          `${item.currentUses}/${item.maxUses}`,
          item.groupName || '-',
          item.description || '-',
          item.createdAt,
          item.expiresAt || '-',
        ]);

        const csvContent = [
          headers.join(','),
          ...rows.map((row: any[]) => row.map((cell: any) => `"${cell}"`).join(',')),
        ].join('\n');

        // 下载文件
        const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `激活码_${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
        URL.revokeObjectURL(url);

        onNotify?.('success', '导出成功', `已导出 ${data.length} 个激活码`);
      } else {
        onNotify?.('error', '导出失败', '无法导出激活码');
      }
    } catch (error) {
      console.error('导出激活码失败:', error);
      onNotify?.('error', '导出失败', '导出激活码失败');
    }
  };

  // 查看详情
  const handleViewDetail = async (id: string) => {
    setDetailLoading(true);
    setDetailOpen(true);
    try {
      const response = await fetch(`/api/internal/billing/activation-codes/${id}`, {
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        setDetailCode(data);
      } else {
        onNotify?.('error', '加载失败', '无法获取激活码详情');
        setDetailOpen(false);
      }
    } catch (error) {
      console.error('获取激活码详情失败:', error);
      onNotify?.('error', '加载失败', '无法获取激活码详情');
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  };

  // 切换状态（启用/禁用）
  const handleToggleStatus = async (code: ActivationCode) => {
    const newStatus = code.status === 'active' ? 'disabled' : 'active';
    try {
      const response = await fetch(`/api/internal/billing/activation-codes/${code.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: newStatus }),
      });

      if (response.ok) {
        onNotify?.('success', '操作成功', `激活码已${newStatus === 'active' ? '启用' : '禁用'}`);
        fetchCodes();
        fetchStats();
        if (detailCode?.id === code.id) {
          handleViewDetail(code.id);
        }
      } else {
        onNotify?.('error', '操作失败', '无法更新激活码状态');
      }
    } catch (error) {
      console.error('更新激活码状态失败:', error);
      onNotify?.('error', '操作失败', '无法更新激活码状态');
    }
  };

  // 删除激活码
  const handleDelete = async (_payload: { reason: string }) => {
    if (!deleteTarget) return;

    setDeleteLoading(true);
    try {
      const response = await fetch(`/api/internal/billing/activation-codes/${deleteTarget.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (response.ok) {
        onNotify?.('success', '删除成功', '激活码已删除');
        setDeleteTarget(null);
        setDetailOpen(false);
        setDetailCode(null);
        fetchCodes();
        fetchStats();
      } else {
        const error = await response.json().catch(() => ({ error: '删除失败' }));
        onNotify?.('error', '删除失败', error.error || '无法删除激活码');
      }
    } catch (error) {
      console.error('删除激活码失败:', error);
      onNotify?.('error', '删除失败', '无法删除激活码');
    } finally {
      setDeleteLoading(false);
    }
  };

  // 复制到剪贴板
  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      onNotify?.('success', '已复制', '已复制到剪贴板');
    } catch {
      onNotify?.('error', '复制失败', '无法复制到剪贴板');
    }
  };

  // 格式化日期
  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString('zh-CN', { hour12: false });
  };

  // 状态标签
  const statusLabel = (status: string) => {
    switch (status) {
      case 'active': return '未使用';
      case 'used': return '已使用';
      case 'disabled': return '已禁用';
      case 'expired': return '已过期';
      default: return status;
    }
  };

  // 状态色调
  const statusTone = (status: string) => {
    switch (status) {
      case 'active': return 'success' as const;
      case 'used': return 'neutral' as const;
      case 'disabled': return 'warning' as const;
      case 'expired': return 'danger' as const;
      default: return 'neutral' as const;
    }
  };

  // 计算总页数
  const totalPages = Math.ceil(total / limit);

  return (
    <section className="activation-code-management">
      {/* 统计卡片 */}
      {stats && (
        <div className="activation-code-stats">
          <div className="stat-card">
            <span className="stat-label">总数</span>
            <strong className="stat-value">{stats.total}</strong>
          </div>
          <div className="stat-card">
            <span className="stat-label">未使用</span>
            <strong className="stat-value stat-active">{stats.active}</strong>
          </div>
          <div className="stat-card">
            <span className="stat-label">已使用</span>
            <strong className="stat-value stat-used">{stats.used}</strong>
          </div>
          <div className="stat-card">
            <span className="stat-label">已禁用</span>
            <strong className="stat-value stat-disabled">{stats.disabled}</strong>
          </div>
          <div className="stat-card">
            <span className="stat-label">已过期</span>
            <strong className="stat-value stat-expired">{stats.expired}</strong>
          </div>
          <div className="stat-card">
            <span className="stat-label">总积分</span>
            <strong className="stat-value">{stats.totalCredits.toLocaleString()}</strong>
          </div>
        </div>
      )}

      {/* 操作栏 */}
      <div className="activation-code-actions">
        <AdminButton variant="primary" onClick={() => setCreateFormOpen(true)}>
          批量创建激活码
        </AdminButton>
        <AdminButton variant="secondary" onClick={() => setGroupFormOpen(true)}>
          管理分组
        </AdminButton>
        <AdminButton variant="secondary" onClick={() => handleExportCSV()}>
          导出 CSV
        </AdminButton>
        <AdminButton variant="secondary" onClick={() => { fetchCodes(); fetchStats(); fetchGroups(); }}>
          刷新
        </AdminButton>
      </div>

      {/* 筛选栏 */}
      <div className="activation-code-filters">
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="filter-select"
        >
          <option value="all">全部状态</option>
          <option value="active">未使用</option>
          <option value="used">已使用</option>
          <option value="disabled">已禁用</option>
          <option value="expired">已过期</option>
        </select>
        <select
          value={groupIdFilter}
          onChange={(e) => { setGroupIdFilter(e.target.value); setPage(1); }}
          className="filter-select"
        >
          <option value="all">全部分组</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name} ({group.codeCount})
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="搜索激活码..."
          value={searchQuery}
          onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
          className="filter-search"
        />
      </div>

      {/* 列表表格 */}
      <div className="table-wrap activation-code-table-wrap">
        <table className="activation-code-table">
          <thead>
            <tr>
              <th>激活码</th>
              <th>积分</th>
              <th>状态</th>
              <th>使用次数</th>
              <th>分组</th>
              <th>过期时间</th>
              <th>创建时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="empty">加载中...</td>
              </tr>
            ) : codes.length === 0 ? (
              <tr>
                <td colSpan={8} className="empty">暂无激活码</td>
              </tr>
            ) : (
              codes.map((code) => (
                <tr key={code.id}>
                  <td>
                    <div className="code-cell">
                      <code className="code-text">{code.code}</code>
                      <button
                        type="button"
                        className="copy-btn"
                        onClick={() => copyToClipboard(code.code)}
                        title="复制"
                      >
                        📋
                      </button>
                    </div>
                  </td>
                  <td>{code.creditsAmount.toLocaleString()}</td>
                  <td>
                    <StatusBadge tone={statusTone(code.status)}>
                      {statusLabel(code.status)}
                    </StatusBadge>
                  </td>
                  <td>{code.currentUses}/{code.maxUses}</td>
                  <td>{code.groupName || '-'}</td>
                  <td>{formatDate(code.expiresAt)}</td>
                  <td>{formatDate(code.createdAt)}</td>
                  <td>
                    <div className="action-buttons">
                      <button
                        type="button"
                        className="table-btn"
                        onClick={() => handleViewDetail(code.id)}
                      >
                        详情
                      </button>
                      {(code.status === 'active' || code.status === 'disabled') && (
                        <button
                          type="button"
                          className="table-btn"
                          onClick={() => handleToggleStatus(code)}
                        >
                          {code.status === 'active' ? '禁用' : '启用'}
                        </button>
                      )}
                      {code.currentUses === 0 && (
                        <button
                          type="button"
                          className="table-btn table-btn-danger"
                          onClick={() => setDeleteTarget(code)}
                        >
                          删除
                        </button>
                      )}
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
        <div className="activation-code-pagination">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            上一页
          </button>
          <span className="page-info">
            第 {page} / {totalPages} 页，共 {total} 条
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
          >
            下一页
          </button>
        </div>
      )}

      {/* 创建弹窗 */}
      {createFormOpen && (
        <div className="modal-backdrop" onClick={() => setCreateFormOpen(false)}>
          <aside
            className="activation-code-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2>批量创建激活码</h2>
              <button
                type="button"
                className="modal-close"
                onClick={() => setCreateFormOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>积分数量 *</label>
                <input
                  type="number"
                  value={createForm.creditsAmount}
                  onChange={(e) => setCreateForm({ ...createForm, creditsAmount: e.target.value })}
                  placeholder="输入积分数量"
                  min="1"
                />
              </div>
              <div className="form-group">
                <label>生成数量</label>
                <input
                  type="number"
                  value={createForm.quantity}
                  onChange={(e) => setCreateForm({ ...createForm, quantity: e.target.value })}
                  placeholder="1-1000"
                  min="1"
                  max="1000"
                />
              </div>
              <div className="form-group">
                <label>分组</label>
                <select
                  value={createForm.groupId}
                  onChange={(e) => setCreateForm({ ...createForm, groupId: e.target.value })}
                  className="filter-select"
                >
                  <option value="">不分组</option>
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>最大使用次数</label>
                <input
                  type="number"
                  value={createForm.maxUses}
                  onChange={(e) => setCreateForm({ ...createForm, maxUses: e.target.value })}
                  placeholder="1"
                  min="1"
                />
              </div>
              <div className="form-group">
                <label>有效期（天）</label>
                <input
                  type="number"
                  value={createForm.expiresInDays}
                  onChange={(e) => setCreateForm({ ...createForm, expiresInDays: e.target.value })}
                  placeholder="留空表示永不过期"
                  min="1"
                />
              </div>
              <div className="form-group">
                <label>描述/备注</label>
                <input
                  type="text"
                  value={createForm.description}
                  onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                  placeholder="可选"
                />
              </div>
              <div className="form-group">
                <label>码前缀</label>
                <input
                  type="text"
                  value={createForm.prefix}
                  onChange={(e) => setCreateForm({ ...createForm, prefix: e.target.value })}
                  placeholder="可选，如 VIP"
                />
              </div>
            </div>
            <div className="modal-footer">
              <AdminButton variant="secondary" onClick={() => setCreateFormOpen(false)}>
                取消
              </AdminButton>
              <AdminButton variant="primary" onClick={handleCreate} loading={createLoading}>
                {createLoading ? '创建中...' : '创建'}
              </AdminButton>
            </div>
          </aside>
        </div>
      )}

      {/* 详情弹窗 */}
      {detailOpen && (
        <div className="modal-backdrop" onClick={() => { setDetailOpen(false); setDetailCode(null); }}>
          <aside
            className="activation-code-modal activation-code-detail-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2>激活码详情</h2>
              <button
                type="button"
                className="modal-close"
                onClick={() => { setDetailOpen(false); setDetailCode(null); }}
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              {detailLoading ? (
                <div className="loading">加载中...</div>
              ) : detailCode ? (
                <>
                  <div className="detail-grid">
                    <div className="detail-item">
                      <span className="detail-label">激活码</span>
                      <div className="detail-value code-cell">
                        <code>{detailCode.code}</code>
                        <button
                          type="button"
                          className="copy-btn"
                          onClick={() => copyToClipboard(detailCode.code)}
                        >
                          📋
                        </button>
                      </div>
                    </div>
                    <div className="detail-item">
                      <span className="detail-label">积分数量</span>
                      <span className="detail-value">{detailCode.creditsAmount.toLocaleString()}</span>
                    </div>
                    <div className="detail-item">
                      <span className="detail-label">状态</span>
                      <StatusBadge tone={statusTone(detailCode.status)}>
                        {statusLabel(detailCode.status)}
                      </StatusBadge>
                    </div>
                    <div className="detail-item">
                      <span className="detail-label">使用次数</span>
                      <span className="detail-value">{detailCode.currentUses} / {detailCode.maxUses}</span>
                    </div>
                    <div className="detail-item">
                      <span className="detail-label">分组</span>
                      <span className="detail-value">{detailCode.groupName || '-'}</span>
                    </div>
                    <div className="detail-item">
                      <span className="detail-label">创建时间</span>
                      <span className="detail-value">{formatDate(detailCode.createdAt)}</span>
                    </div>
                    <div className="detail-item">
                      <span className="detail-label">过期时间</span>
                      <span className="detail-value">{formatDate(detailCode.expiresAt)}</span>
                    </div>
                    <div className="detail-item">
                      <span className="detail-label">创建者</span>
                      <span className="detail-value">{detailCode.creatorName || '-'}</span>
                    </div>
                    {detailCode.description && (
                      <div className="detail-item">
                        <span className="detail-label">描述</span>
                        <span className="detail-value">{detailCode.description}</span>
                      </div>
                    )}
                  </div>

                  {/* 使用记录 */}
                  {detailCode.uses.length > 0 && (
                    <div className="detail-uses">
                      <h3>使用记录</h3>
                      <table className="uses-table">
                        <thead>
                          <tr>
                            <th>用户</th>
                            <th>邮箱</th>
                            <th>授予积分</th>
                            <th>使用时间</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detailCode.uses.map((use) => (
                            <tr key={use.id}>
                              <td>{use.userName || '-'}</td>
                              <td>{use.userEmail || '-'}</td>
                              <td>{use.creditsGranted.toLocaleString()}</td>
                              <td>{formatDate(use.usedAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              ) : (
                <div className="empty">无法加载详情</div>
              )}
            </div>
            <div className="modal-footer">
              {detailCode && (
                <>
                  {(detailCode.status === 'active' || detailCode.status === 'disabled') && (
                    <AdminButton
                      variant="secondary"
                      onClick={() => handleToggleStatus(detailCode)}
                    >
                      {detailCode.status === 'active' ? '禁用' : '启用'}
                    </AdminButton>
                  )}
                  {detailCode.currentUses === 0 && (
                    <AdminButton
                      variant="danger"
                      onClick={() => setDeleteTarget(detailCode)}
                    >
                      删除
                    </AdminButton>
                  )}
                </>
              )}
              <AdminButton variant="secondary" onClick={() => { setDetailOpen(false); setDetailCode(null); }}>
                关闭
              </AdminButton>
            </div>
          </aside>
        </div>
      )}

      {/* 删除确认弹窗 */}
      {deleteTarget && (
        <DangerConfirmDialog
          open={true}
          title="删除激活码"
          objectLabel={deleteTarget.code}
          objectId={deleteTarget.id}
          actionLabel="删除激活码"
          impactItems={['激活码将被永久删除', '此操作不可撤销']}
          reversibility="irreversible"
          confirmText={deleteTarget.code}
          reasonRequired={false}
          loading={deleteLoading}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {/* 分组管理弹窗 */}
      {groupFormOpen && (
        <div className="modal-backdrop" onClick={() => setGroupFormOpen(false)}>
          <aside
            className="activation-code-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2>管理分组</h2>
              <button
                type="button"
                className="modal-close"
                onClick={() => setGroupFormOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>分组名称 *</label>
                <input
                  type="text"
                  value={groupForm.name}
                  onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
                  placeholder="输入分组名称"
                />
              </div>
              <div className="form-group">
                <label>描述</label>
                <input
                  type="text"
                  value={groupForm.description}
                  onChange={(e) => setGroupForm({ ...groupForm, description: e.target.value })}
                  placeholder="可选"
                />
              </div>
              <div className="form-group">
                <label>现有分组</label>
                <div className="group-list">
                  {groups.length === 0 ? (
                    <p className="empty">暂无分组</p>
                  ) : (
                    groups.map((group) => (
                      <div key={group.id} className="group-item">
                        <div className="group-info">
                          <strong>{group.name}</strong>
                          <span>{group.codeCount} 个激活码</span>
                        </div>
                        <button
                          type="button"
                          className="table-btn table-btn-danger"
                          onClick={() => setDeleteGroupTarget(group)}
                        >
                          删除
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <AdminButton variant="secondary" onClick={() => setGroupFormOpen(false)}>
                取消
              </AdminButton>
              <AdminButton variant="primary" onClick={handleCreateGroup} loading={groupLoading}>
                {groupLoading ? '创建中...' : '创建分组'}
              </AdminButton>
            </div>
          </aside>
        </div>
      )}

      {/* 分组删除确认弹窗 */}
      {deleteGroupTarget && (
        <DangerConfirmDialog
          open={true}
          title="删除分组"
          objectLabel={deleteGroupTarget.name}
          objectId={deleteGroupTarget.id}
          actionLabel="删除分组"
          impactItems={['分组将被永久删除', '分组下的激活码将变为未分组状态']}
          reversibility="irreversible"
          confirmText={deleteGroupTarget.name}
          reasonRequired={false}
          loading={deleteGroupLoading}
          onConfirm={handleDeleteGroup}
          onCancel={() => setDeleteGroupTarget(null)}
        />
      )}

      <style>{`
        .activation-code-management {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .activation-code-stats {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
          gap: 12px;
        }

        .stat-card {
          background: var(--surface-muted);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 12px;
          text-align: center;
        }

        .stat-label {
          display: block;
          font-size: 12px;
          color: var(--text-soft);
          margin-bottom: 4px;
        }

        .stat-value {
          display: block;
          font-size: 20px;
          font-weight: 700;
        }

        .stat-active { color: var(--success); }
        .stat-used { color: var(--text); }
        .stat-disabled { color: var(--warning); }
        .stat-expired { color: var(--danger); }

        .activation-code-actions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .activation-code-filters {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .filter-select,
        .filter-search {
          padding: 8px 12px;
          border: 1px solid var(--border);
          border-radius: 6px;
          background: var(--surface);
          color: var(--text);
          font-size: 14px;
        }

        .filter-search {
          flex: 1;
          min-width: 200px;
        }

        .activation-code-table-wrap {
          overflow-x: auto;
        }

        .activation-code-table {
          width: 100%;
          border-collapse: collapse;
        }

        .activation-code-table th,
        .activation-code-table td {
          padding: 10px 12px;
          text-align: left;
          border-bottom: 1px solid var(--border);
        }

        .activation-code-table th {
          font-weight: 600;
          font-size: 12px;
          text-transform: uppercase;
          color: var(--text-soft);
        }

        .code-cell {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .code-text {
          font-family: monospace;
          font-size: 13px;
          background: var(--surface-muted);
          padding: 2px 6px;
          border-radius: 4px;
        }

        .copy-btn {
          background: none;
          border: none;
          cursor: pointer;
          padding: 2px;
          font-size: 14px;
          opacity: 0.6;
          transition: opacity 0.2s;
        }

        .copy-btn:hover {
          opacity: 1;
        }

        .action-buttons {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
        }

        .table-btn {
          padding: 4px 8px;
          font-size: 12px;
          border: 1px solid var(--border);
          border-radius: 4px;
          background: var(--surface);
          color: var(--text);
          cursor: pointer;
          transition: all 0.2s;
        }

        .table-btn:hover {
          background: var(--surface-muted);
        }

        .table-btn-danger {
          color: var(--danger);
          border-color: var(--danger);
        }

        .table-btn-danger:hover {
          background: color-mix(in srgb, var(--danger) 10%, transparent);
        }

        .activation-code-pagination {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          padding: 12px 0;
        }

        .activation-code-pagination button {
          padding: 6px 12px;
          border: 1px solid var(--border);
          border-radius: 4px;
          background: var(--surface);
          color: var(--text);
          cursor: pointer;
        }

        .activation-code-pagination button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .page-info {
          font-size: 13px;
          color: var(--text-soft);
        }

        .empty {
          text-align: center;
          color: var(--text-soft);
          padding: 24px;
        }

        .loading {
          text-align: center;
          padding: 24px;
        }

        /* 弹窗样式 */
        .modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
        }

        .activation-code-modal {
          background: var(--surface);
          border-radius: 12px;
          width: 90%;
          max-width: 500px;
          max-height: 90vh;
          overflow-y: auto;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
        }

        .activation-code-detail-modal {
          max-width: 600px;
        }

        .modal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 20px;
          border-bottom: 1px solid var(--border);
        }

        .modal-header h2 {
          margin: 0;
          font-size: 18px;
        }

        .modal-close {
          background: none;
          border: none;
          font-size: 24px;
          cursor: pointer;
          color: var(--text-soft);
          padding: 0;
          line-height: 1;
        }

        .modal-body {
          padding: 20px;
        }

        .modal-footer {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          padding: 16px 20px;
          border-top: 1px solid var(--border);
        }

        .form-group {
          margin-bottom: 16px;
        }

        .form-group label {
          display: block;
          font-size: 13px;
          font-weight: 600;
          margin-bottom: 6px;
          color: var(--text);
        }

        .form-group input,
        .form-group select {
          width: 100%;
          padding: 8px 12px;
          border: 1px solid var(--border);
          border-radius: 6px;
          background: var(--surface);
          color: var(--text);
          font-size: 14px;
        }

        .form-group input:focus,
        .form-group select:focus {
          outline: none;
          border-color: var(--primary);
          box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary) 12%, transparent);
        }

        .detail-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 16px;
        }

        .detail-item {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .detail-label {
          font-size: 12px;
          color: var(--text-soft);
        }

        .detail-value {
          font-size: 14px;
        }

        .detail-uses {
          margin-top: 20px;
          padding-top: 16px;
          border-top: 1px solid var(--border);
        }

        .detail-uses h3 {
          margin: 0 0 12px;
          font-size: 14px;
        }

        .uses-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
        }

        .uses-table th,
        .uses-table td {
          padding: 8px;
          text-align: left;
          border-bottom: 1px solid var(--border);
        }

        .uses-table th {
          font-weight: 600;
          color: var(--text-soft);
        }

        .group-list {
          max-height: 300px;
          overflow-y: auto;
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 8px;
        }

        .group-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px;
          border-bottom: 1px solid var(--border);
        }

        .group-item:last-child {
          border-bottom: none;
        }

        .group-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .group-info strong {
          font-size: 14px;
        }

        .group-info span {
          font-size: 12px;
          color: var(--text-soft);
        }
      `}</style>
    </section>
  );
}
