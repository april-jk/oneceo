import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type {
  MembershipDailyRestoreHistoryItem,
  MembershipPlan,
  MembershipUserListItem,
  NewMembershipPlanPayload,
} from '../types';
import { AdminButton, AdminDetailShell, AdminTabs, StatusBadge, statusToneFromValue } from './admin-ui';

type MembershipTab = 'plans' | 'users' | 'restore';
const DEFAULT_AGENT_LEVELS = ['lite', 'pro', 'max'];
const BENEFIT_OPTIONS = ['Agent lite', 'Agent pro', 'Agent max', '优先排队', '专属支持'];

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function formatList(values: unknown[]) {
  const items = values.map((item) => String(item || '').trim()).filter(Boolean);
  return items.length ? items.join(' / ') : '-';
}

function toDatetimeLocal(value?: string | null) {
  if (!value) return '';
  return new Date(value).toISOString().slice(0, 16);
}

export function MembershipManagementSection() {
  const [activeTab, setActiveTab] = useState<MembershipTab>('plans');
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  const [users, setUsers] = useState<MembershipUserListItem[]>([]);
  const [restoreItems, setRestoreItems] = useState<MembershipDailyRestoreHistoryItem[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [loadingPlans, setLoadingPlans] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingRestore, setLoadingRestore] = useState(false);
  const [savingPlan, setSavingPlan] = useState(false);
  const [runningDailyRestore, setRunningDailyRestore] = useState(false);
  const [dailyRestoreMessage, setDailyRestoreMessage] = useState('');
  const [savingUserExpire, setSavingUserExpire] = useState<string | null>(null);

  const emptyForm = {
    name: '',
    status: 'active',
    isDefault: false,
    defaultCredits: '100',
    allowedAgentLevels: [...DEFAULT_AGENT_LEVELS],
    benefits: ['Agent lite'],
    dailyAutoRestoreEnabled: false,
    dailyAutoRestoreCredits: '0',
    description: '',
    sortOrder: '0',
    effectiveFrom: '',
    effectiveUntil: '',
  };

  const [planForm, setPlanForm] = useState(emptyForm);
  const [editPlanForm, setEditPlanForm] = useState(emptyForm);

  const selectedPlan = useMemo(() => plans.find((plan) => plan.id === selectedPlanId) || plans[0] || null, [plans, selectedPlanId]);

  const loadPlans = useCallback(async () => {
    setLoadingPlans(true);
    try {
      const data = await api.listMembershipPlans();
      setPlans(data);
      setSelectedPlanId((current) => current || data[0]?.id || null);
    } finally {
      setLoadingPlans(false);
    }
  }, []);

  const loadUsers = useCallback(async () => {
    setLoadingUsers(true);
    try {
      const data = await api.listMembershipUsers({ page: 1, pageSize: 50 });
      setUsers(data.items);
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  const loadRestoreHistory = useCallback(async () => {
    setLoadingRestore(true);
    try {
      const data = await api.listMembershipDailyRestoreHistory({ page: 1, pageSize: 50 });
      setRestoreItems(data.items);
    } finally {
      setLoadingRestore(false);
    }
  }, []);

  useEffect(() => { void loadPlans(); }, [loadPlans]);
  useEffect(() => {
    if (activeTab === 'users') void loadUsers();
    if (activeTab === 'restore') void loadRestoreHistory();
  }, [activeTab, loadUsers, loadRestoreHistory]);

  const createPlan = useCallback(async () => {
    const payload: NewMembershipPlanPayload = {
      name: planForm.name.trim(),
      status: planForm.status.trim(),
      defaultCredits: Number(planForm.defaultCredits || 0),
      isDefault: planForm.isDefault,
      allowedAgentLevels: planForm.allowedAgentLevels,
      benefits: planForm.benefits,
      dailyAutoRestoreEnabled: planForm.dailyAutoRestoreEnabled,
      dailyAutoRestoreCredits: Number(planForm.dailyAutoRestoreCredits || 0),
      description: planForm.description.trim(),
      sortOrder: Number(planForm.sortOrder || 0),
      effectiveFrom: planForm.effectiveFrom ? new Date(planForm.effectiveFrom).toISOString() : null,
      effectiveUntil: planForm.effectiveUntil ? new Date(planForm.effectiveUntil).toISOString() : null,
    };
    setSavingPlan(true);
    try {
      await api.createMembershipPlan(payload);
      await loadPlans();
      setPlanForm(emptyForm);
      setCreateModalOpen(false);
    } finally {
      setSavingPlan(false);
    }
  }, [loadPlans, planForm]);

  const openEditPlan = useCallback((plan: MembershipPlan) => {
    setEditPlanForm({
      name: plan.name,
      status: plan.status,
      isDefault: plan.isDefault,
      defaultCredits: String(plan.defaultCredits ?? 0),
      allowedAgentLevels: Array.isArray(plan.allowedAgentLevelsJson) ? plan.allowedAgentLevelsJson.map((item) => String(item)) : [],
      benefits: Array.isArray(plan.benefitsJson) ? plan.benefitsJson.map((item) => String(item)) : [],
      dailyAutoRestoreEnabled: !!plan.dailyAutoRestoreEnabled,
      dailyAutoRestoreCredits: String(plan.dailyAutoRestoreCredits ?? 0),
      description: plan.description || '',
      sortOrder: String(plan.sortOrder ?? 0),
      effectiveFrom: toDatetimeLocal(plan.effectiveFrom),
      effectiveUntil: toDatetimeLocal(plan.effectiveUntil),
    });
    setEditModalOpen(true);
  }, []);

  const saveEditedPlan = useCallback(async () => {
    if (!selectedPlan) return;
    setSavingPlan(true);
    try {
      await api.updateMembershipPlan(selectedPlan.id, {
        name: editPlanForm.name.trim(),
        status: editPlanForm.status.trim(),
        defaultCredits: Number(editPlanForm.defaultCredits || 0),
        isDefault: editPlanForm.isDefault,
        allowedAgentLevels: editPlanForm.allowedAgentLevels,
        benefits: editPlanForm.benefits,
        dailyAutoRestoreEnabled: editPlanForm.dailyAutoRestoreEnabled,
        dailyAutoRestoreCredits: Number(editPlanForm.dailyAutoRestoreCredits || 0),
        description: editPlanForm.description.trim(),
        sortOrder: Number(editPlanForm.sortOrder || 0),
        effectiveFrom: editPlanForm.effectiveFrom ? new Date(editPlanForm.effectiveFrom).toISOString() : null,
        effectiveUntil: editPlanForm.effectiveUntil ? new Date(editPlanForm.effectiveUntil).toISOString() : null,
      });
      await loadPlans();
      setEditModalOpen(false);
    } finally {
      setSavingPlan(false);
    }
  }, [editPlanForm, loadPlans, selectedPlan]);

  const togglePlanStatus = useCallback(async (plan: MembershipPlan) => {
    await api.updateMembershipPlanStatus(plan.id, { status: plan.status === 'active' ? 'inactive' : 'active' });
    await loadPlans();
  }, [loadPlans]);

  const setPlanDefault = useCallback(async (plan: MembershipPlan) => {
    await api.updateMembershipPlan(plan.id, { isDefault: true });
    await loadPlans();
  }, [loadPlans]);

  const updateMembershipStatus = useCallback(async (membershipId: string, status: 'active' | 'expired' | 'cancelled') => {
    await api.updateUserMembershipStatus(membershipId, { status });
    await loadUsers();
  }, [loadUsers]);

  const updateMembershipExpireAt = useCallback(async (membershipId: string, value: string) => {
    setSavingUserExpire(membershipId);
    try {
      await api.updateUserMembershipExpireAt(membershipId, {
        expiresAt: value ? new Date(value).toISOString() : null,
      });
      await loadUsers();
    } finally {
      setSavingUserExpire(null);
    }
  }, [loadUsers]);

  const runDailyRestore = useCallback(async () => {
    setRunningDailyRestore(true);
    setDailyRestoreMessage('');
    try {
      const result = await api.runMembershipDailyRestore();
      setDailyRestoreMessage(`已执行 ${result.restoreDate}，恢复用户数：${result.restoredCount}`);
      await loadRestoreHistory();
    } catch (error) {
      setDailyRestoreMessage(error instanceof Error ? error.message : '执行失败');
    } finally {
      setRunningDailyRestore(false);
    }
  }, [loadRestoreHistory]);

  return (
    <main className="content-stack viewport-lock-page user-management-page billing-management-page membership-management-page">
      <section className="sub-panel user-management-filter-panel membership-management-toolbar">
        <div className="user-management-toolbar">
          <AdminButton variant="primary" onClick={() => setCreateModalOpen(true)}>新增会员类型</AdminButton>
          <AdminButton variant="secondary" onClick={() => loadPlans()} loading={loadingPlans}>刷新会员类型</AdminButton>
          <AdminButton variant="secondary" onClick={() => loadUsers()} loading={loadingUsers}>刷新用户会员</AdminButton>
          <AdminButton variant="secondary" onClick={() => void runDailyRestore()} loading={runningDailyRestore}>手动执行每日恢复积分</AdminButton>
        </div>
        {dailyRestoreMessage ? <p className="cell-subtle">{dailyRestoreMessage}</p> : null}
        <AdminTabs value={activeTab} onChange={(value) => setActiveTab(value as MembershipTab)} items={[
          { key: 'plans', label: '会员类型', count: plans.length },
          { key: 'users', label: '用户会员', count: users.length },
          { key: 'restore', label: '恢复记录', count: restoreItems.length },
        ]} />
      </section>

      <section className="membership-management-grid">
        <article className="sub-panel membership-management-list-panel">
          {activeTab === 'plans' && (
            <div className="membership-plan-list">
              {plans.map((plan) => (
                <button key={plan.id} type="button" className={`membership-plan-card ${selectedPlan?.id === plan.id ? 'active' : ''}`} onClick={() => setSelectedPlanId(plan.id)}>
                  <div className="membership-plan-card-head">
                    <strong>{plan.name}{plan.isDefault ? '（默认）' : ''}</strong>
                    <StatusBadge tone={statusToneFromValue(plan.status)}>{plan.status}</StatusBadge>
                  </div>
                  <p className="cell-subtle">{plan.code}</p>
                  <div className="membership-plan-card-meta">
                    <span>默认积分 {plan.defaultCredits}</span>
                    <span>Agent {formatList(plan.allowedAgentLevelsJson)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
          {activeTab === 'users' && (
            <div className="table-wrap user-management-table-wrap">
              <table className="user-management-table">
                <thead><tr><th>用户</th><th>会员类型</th><th>状态</th><th>开始时间</th><th>到期时间</th><th>操作</th></tr></thead>
                <tbody>
                  {users.map((item) => (
                    <tr key={item.membership.id}>
                      <td>{item.user.displayName || item.user.email}</td>
                      <td>{item.plan.name}</td>
                      <td><StatusBadge tone={statusToneFromValue(item.membership.status)}>{item.membership.status}</StatusBadge></td>
                      <td>{formatDateTime(item.membership.startedAt)}</td>
                      <td>{formatDateTime(item.membership.expiresAt)}</td>
                      <td>
                        <div className="user-management-toolbar">
                          <AdminButton variant="secondary" onClick={() => void updateMembershipStatus(item.membership.id, 'active')}>启用</AdminButton>
                          <AdminButton variant="secondary" onClick={() => void updateMembershipStatus(item.membership.id, 'expired')}>设为过期</AdminButton>
                          <input
                            type="datetime-local"
                            defaultValue={toDatetimeLocal(item.membership.expiresAt)}
                            onBlur={(event) => void updateMembershipExpireAt(item.membership.id, event.target.value)}
                            disabled={savingUserExpire === item.membership.id}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {activeTab === 'restore' && (
            <div className="table-wrap user-management-table-wrap">
              {loadingRestore ? <p className="cell-subtle">加载中...</p> : null}
              <table className="user-management-table">
                <thead><tr><th>日期</th><th>用户</th><th>会员类型</th><th>恢复积分</th><th>记录时间</th></tr></thead>
                <tbody>
                  {restoreItems.map((item) => (
                    <tr key={item.restore.id}>
                      <td>{item.restore.restoreDate}</td>
                      <td>{item.user.displayName || item.user.email}</td>
                      <td>{item.plan.name}</td>
                      <td>{item.restore.restoreCredits}</td>
                      <td>{formatDateTime(item.restore.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>

        <aside className="sub-panel membership-management-detail-panel">
          {selectedPlan ? (
            <div className="membership-management-form">
              <div className="editor-header">
                <div><h3>{selectedPlan.name}</h3><p className="cell-subtle">{selectedPlan.code}</p></div>
                <div className="user-management-toolbar">
                  <AdminButton variant="secondary" onClick={() => openEditPlan(selectedPlan)}>编辑</AdminButton>
                  <AdminButton variant="secondary" onClick={() => void togglePlanStatus(selectedPlan)}>{selectedPlan.status === 'active' ? '停用' : '启用'}</AdminButton>
                  {!selectedPlan.isDefault ? <AdminButton variant="secondary" onClick={() => void setPlanDefault(selectedPlan)}>设为默认</AdminButton> : null}
                </div>
              </div>
              <div className="detail-grid">
                <div><dt>默认积分</dt><dd>{selectedPlan.defaultCredits}</dd></div>
                <div><dt>Agent 权益</dt><dd>{formatList(selectedPlan.allowedAgentLevelsJson)}</dd></div>
                <div><dt>会员权益</dt><dd>{formatList(selectedPlan.benefitsJson)}</dd></div>
                <div><dt>默认会员</dt><dd>{selectedPlan.isDefault ? '是' : '否'}</dd></div>
                <div><dt>每日恢复积分</dt><dd>{selectedPlan.dailyAutoRestoreEnabled ? selectedPlan.dailyAutoRestoreCredits : 0}</dd></div>
                <div><dt>排序</dt><dd>{selectedPlan.sortOrder}</dd></div>
              </div>
            </div>
          ) : <p className="empty">请选择会员类型。</p>}
        </aside>
      </section>

      <AdminDetailShell open={createModalOpen} onClose={() => setCreateModalOpen(false)} eyebrow="会员管理" title="新增会员类型" subtitle="配置默认积分、Agent 等级与会员权益。" size="xl" className="membership-create-modal">
        <div className="membership-create-form">
          <div className="membership-form-grid">
            <label><span>名称</span><input value={planForm.name} onChange={(event) => setPlanForm((current) => ({ ...current, name: event.target.value }))} /></label>
            <label><span>状态</span><select value={planForm.status} onChange={(event) => setPlanForm((current) => ({ ...current, status: event.target.value }))}><option value="active">active</option><option value="inactive">inactive</option></select></label>
            <label><span>默认积分</span><input type="number" value={planForm.defaultCredits} onChange={(event) => setPlanForm((current) => ({ ...current, defaultCredits: event.target.value }))} /></label>
            <label><span>排序</span><input type="number" value={planForm.sortOrder} onChange={(event) => setPlanForm((current) => ({ ...current, sortOrder: event.target.value }))} /></label>
          </div>
          <label className="membership-toggle-card"><input type="checkbox" checked={planForm.isDefault} onChange={(event) => setPlanForm((current) => ({ ...current, isDefault: event.target.checked }))} /><span>设为默认会员类型（新注册用户默认使用）</span></label>
          <div className="membership-management-field"><span>允许 Agent 等级</span><div className="membership-choice-grid membership-choice-grid-agent">
            {DEFAULT_AGENT_LEVELS.map((level) => (
              <label key={level} className="membership-choice-chip selectable"><input type="checkbox" checked={planForm.allowedAgentLevels.includes(level)} onChange={(event) => setPlanForm((current) => ({ ...current, allowedAgentLevels: event.target.checked ? Array.from(new Set([...current.allowedAgentLevels, level])) : current.allowedAgentLevels.filter((item) => item !== level) }))} /><span>{level}</span></label>
            ))}
          </div></div>
          <div className="membership-management-field"><span>会员权益</span><div className="membership-choice-grid">
            {BENEFIT_OPTIONS.map((item) => (
              <label key={item} className="membership-choice-chip selectable"><input type="checkbox" checked={planForm.benefits.includes(item)} onChange={(event) => setPlanForm((current) => ({ ...current, benefits: event.target.checked ? Array.from(new Set([...current.benefits, item])) : current.benefits.filter((benefit) => benefit !== item) }))} /><span>{item}</span></label>
            ))}
          </div></div>
          <label className="membership-toggle-card"><input type="checkbox" checked={planForm.dailyAutoRestoreEnabled} onChange={(event) => setPlanForm((current) => ({ ...current, dailyAutoRestoreEnabled: event.target.checked }))} /><span>开启每日自动恢复积分</span></label>
          <div className="membership-form-grid">
            <label><span>每日自动恢复积分</span><input type="number" value={planForm.dailyAutoRestoreCredits} disabled={!planForm.dailyAutoRestoreEnabled} onChange={(event) => setPlanForm((current) => ({ ...current, dailyAutoRestoreCredits: event.target.value }))} /></label>
            <label><span>生效时间</span><input type="datetime-local" value={planForm.effectiveFrom} onChange={(event) => setPlanForm((current) => ({ ...current, effectiveFrom: event.target.value }))} /></label>
          </div>
          <label><span>说明</span><textarea rows={3} value={planForm.description} onChange={(event) => setPlanForm((current) => ({ ...current, description: event.target.value }))} /></label>
          <label><span>失效时间</span><input type="datetime-local" value={planForm.effectiveUntil} onChange={(event) => setPlanForm((current) => ({ ...current, effectiveUntil: event.target.value }))} /></label>
          <div className="user-management-toolbar">
            <AdminButton variant="primary" onClick={() => void createPlan()} loading={savingPlan}>保存会员类型</AdminButton>
            <AdminButton variant="secondary" onClick={() => setPlanForm(emptyForm)}>重置</AdminButton>
          </div>
        </div>
      </AdminDetailShell>

      <AdminDetailShell open={editModalOpen} onClose={() => setEditModalOpen(false)} eyebrow="会员管理" title="编辑会员类型" subtitle="更新会员配置并保存。" size="xl" className="membership-create-modal">
        <div className="membership-create-form">
          <div className="membership-form-grid">
            <label><span>名称</span><input value={editPlanForm.name} onChange={(event) => setEditPlanForm((current) => ({ ...current, name: event.target.value }))} /></label>
            <label><span>状态</span><select value={editPlanForm.status} onChange={(event) => setEditPlanForm((current) => ({ ...current, status: event.target.value }))}><option value="active">active</option><option value="inactive">inactive</option></select></label>
            <label><span>默认积分</span><input type="number" value={editPlanForm.defaultCredits} onChange={(event) => setEditPlanForm((current) => ({ ...current, defaultCredits: event.target.value }))} /></label>
            <label><span>排序</span><input type="number" value={editPlanForm.sortOrder} onChange={(event) => setEditPlanForm((current) => ({ ...current, sortOrder: event.target.value }))} /></label>
          </div>
          <label className="membership-toggle-card"><input type="checkbox" checked={editPlanForm.isDefault} onChange={(event) => setEditPlanForm((current) => ({ ...current, isDefault: event.target.checked }))} /><span>设为默认会员类型</span></label>
          <div className="membership-management-field"><span>允许 Agent 等级</span><div className="membership-choice-grid membership-choice-grid-agent">
            {DEFAULT_AGENT_LEVELS.map((level) => (
              <label key={level} className="membership-choice-chip selectable"><input type="checkbox" checked={editPlanForm.allowedAgentLevels.includes(level)} onChange={(event) => setEditPlanForm((current) => ({ ...current, allowedAgentLevels: event.target.checked ? Array.from(new Set([...current.allowedAgentLevels, level])) : current.allowedAgentLevels.filter((item) => item !== level) }))} /><span>{level}</span></label>
            ))}
          </div></div>
          <div className="membership-management-field"><span>会员权益</span><div className="membership-choice-grid">
            {BENEFIT_OPTIONS.map((item) => (
              <label key={item} className="membership-choice-chip selectable"><input type="checkbox" checked={editPlanForm.benefits.includes(item)} onChange={(event) => setEditPlanForm((current) => ({ ...current, benefits: event.target.checked ? Array.from(new Set([...current.benefits, item])) : current.benefits.filter((benefit) => benefit !== item) }))} /><span>{item}</span></label>
            ))}
          </div></div>
          <label className="membership-toggle-card"><input type="checkbox" checked={editPlanForm.dailyAutoRestoreEnabled} onChange={(event) => setEditPlanForm((current) => ({ ...current, dailyAutoRestoreEnabled: event.target.checked }))} /><span>开启每日自动恢复积分</span></label>
          <div className="membership-form-grid">
            <label><span>每日自动恢复积分</span><input type="number" value={editPlanForm.dailyAutoRestoreCredits} disabled={!editPlanForm.dailyAutoRestoreEnabled} onChange={(event) => setEditPlanForm((current) => ({ ...current, dailyAutoRestoreCredits: event.target.value }))} /></label>
            <label><span>生效时间</span><input type="datetime-local" value={editPlanForm.effectiveFrom} onChange={(event) => setEditPlanForm((current) => ({ ...current, effectiveFrom: event.target.value }))} /></label>
          </div>
          <label><span>说明</span><textarea rows={3} value={editPlanForm.description} onChange={(event) => setEditPlanForm((current) => ({ ...current, description: event.target.value }))} /></label>
          <label><span>失效时间</span><input type="datetime-local" value={editPlanForm.effectiveUntil} onChange={(event) => setEditPlanForm((current) => ({ ...current, effectiveUntil: event.target.value }))} /></label>
          <div className="user-management-toolbar">
            <AdminButton variant="primary" onClick={() => void saveEditedPlan()} loading={savingPlan}>保存修改</AdminButton>
          </div>
        </div>
      </AdminDetailShell>
    </main>
  );
}
