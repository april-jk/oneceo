import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from './api';
import type {
  AgentManagementOverview,
  AuditLogEntry,
  ConversationSession,
  ConversationSessionDetailResponse,
  DashboardOverview,
  HostListResponse,
  VmItem,
} from './types';

type SectionKey = 'kvm' | 'conversation' | 'agent' | 'audit';

const NAV_ITEMS: Array<{ key: SectionKey; label: string; subtitle: string }> = [
  { key: 'kvm', label: 'KVM 管理', subtitle: '虚拟机与资源' },
  { key: 'conversation', label: '对话管理', subtitle: '任务创建会话' },
  { key: 'agent', label: '智能体管理', subtitle: 'Agent 运行状态' },
  { key: 'audit', label: '审计日志', subtitle: '操作追踪' },
];

const VM_STATE_COLORS: Record<string, string> = {
  running: '#0f766e',
  stopped: '#94a3b8',
  paused: '#f59e0b',
  error: '#dc2626',
};

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function formatValue(value: string | number | undefined | null, suffix = '') {
  if (value === undefined || value === null || value === '') {
    return '-';
  }
  return `${value}${suffix}`;
}

function stateClassName(state: string) {
  return `status-pill status-${state}`;
}

function statusLabel(status: string) {
  if (status === 'in_progress') return '进行中';
  if (status === 'waiting_user') return '待用户确认';
  if (status === 'completed') return '已完成';
  if (status === 'failed') return '失败';
  return status;
}

export default function App() {
  const [activeSection, setActiveSection] = useState<SectionKey>('kvm');

  const [kvmOverview, setKvmOverview] = useState<DashboardOverview | null>(null);
  const [vms, setVms] = useState<VmItem[]>([]);
  const [hosts, setHosts] = useState<HostListResponse['hosts']>([]);
  const [busyVmIds, setBusyVmIds] = useState<Record<string, boolean>>({});

  const [conversationSessions, setConversationSessions] = useState<ConversationSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [conversationDetail, setConversationDetail] = useState<ConversationSessionDetailResponse | null>(null);

  const [agentOverview, setAgentOverview] = useState<AgentManagementOverview | null>(null);
  const [auditEntries, setAuditEntries] = useState<AuditLogEntry[]>([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadKvmSection = useCallback(async () => {
    const [overviewResult, vmResult, hostResult] = await Promise.allSettled([
      api.getOverview(),
      api.listVms({ withState: false, limit: 200, offset: 0 }),
      api.listHosts(),
    ]);

    if (overviewResult.status === 'fulfilled') {
      setKvmOverview(overviewResult.value);
    }

    setVms(vmResult.status === 'fulfilled' ? vmResult.value.vms : []);
    setHosts(hostResult.status === 'fulfilled' ? hostResult.value.hosts : []);

    if (
      overviewResult.status === 'rejected' &&
      vmResult.status === 'rejected' &&
      hostResult.status === 'rejected'
    ) {
      throw new Error('KVM 模块请求失败，请检查后端与编排器连接状态');
    }
  }, []);

  const loadConversationSessions = useCallback(async () => {
    const result = await api.listConversationSessions(30);
    setConversationSessions(result.sessions);

    if (result.sessions.length > 0) {
      const nextId = selectedSessionId && result.sessions.some((item) => item.id === selectedSessionId)
        ? selectedSessionId
        : result.sessions[0].id;
      setSelectedSessionId(nextId);
    } else {
      setSelectedSessionId(null);
      setConversationDetail(null);
    }
  }, [selectedSessionId]);

  const loadConversationDetail = useCallback(async (sessionId: string) => {
    const detail = await api.getConversationSessionDetail(sessionId);
    setConversationDetail(detail);
  }, []);

  const loadAgentSection = useCallback(async () => {
    const result = await api.getAgentManagementOverview();
    setAgentOverview(result);
  }, []);

  const loadAuditSection = useCallback(async () => {
    const result = await api.listAudit(80);
    setAuditEntries(result.entries);
  }, []);

  const loadSection = useCallback(
    async (section: SectionKey, initial = false) => {
      if (initial) {
        setLoading(true);
      }
      setRefreshing(true);

      try {
        if (section === 'kvm') {
          await Promise.all([loadKvmSection(), loadAuditSection()]);
        } else if (section === 'conversation') {
          await loadConversationSessions();
        } else if (section === 'agent') {
          await loadAgentSection();
        } else {
          await loadAuditSection();
        }
        setError(null);
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : '数据加载失败');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [loadAgentSection, loadAuditSection, loadConversationSessions, loadKvmSection]
  );

  useEffect(() => {
    loadSection(activeSection, true);
  }, [activeSection, loadSection]);

  useEffect(() => {
    if (!selectedSessionId || activeSection !== 'conversation') {
      return;
    }

    let cancelled = false;
    const run = async () => {
      try {
        const detail = await api.getConversationSessionDetail(selectedSessionId);
        if (!cancelled) {
          setConversationDetail(detail);
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : '加载会话详情失败');
        }
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [activeSection, selectedSessionId]);

  const vmPieData = useMemo(
    () => (kvmOverview?.vmStateDistribution ?? []).filter((item) => item.value > 0),
    [kvmOverview]
  );

  const breadcrumbTitle = NAV_ITEMS.find((item) => item.key === activeSection)?.label || '管理后台';

  const handlePower = async (vm: VmItem, action: 'start' | 'stop') => {
    setBusyVmIds((prev) => ({ ...prev, [vm.vmId]: true }));
    try {
      await api.powerVm(vm.vmId, action);
      await loadKvmSection();
      await loadAuditSection();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'VM 操作失败');
    } finally {
      setBusyVmIds((prev) => ({ ...prev, [vm.vmId]: false }));
    }
  };

  const renderKvmSection = () => (
    <main className="content-stack">
      <section className="kpi-grid fade-in">
        <article className="kpi-card">
          <p className="kpi-title">运行中 VM</p>
          <p className="kpi-value">{kvmOverview?.vmSummary.running ?? 0}</p>
          <p className="kpi-meta">总计 {kvmOverview?.vmSummary.total ?? 0} 台</p>
        </article>
        <article className="kpi-card">
          <p className="kpi-title">停止 VM</p>
          <p className="kpi-value">{kvmOverview?.vmSummary.stopped ?? 0}</p>
          <p className="kpi-meta">来源 /v1/vms</p>
        </article>
        <article className="kpi-card">
          <p className="kpi-title">异常 VM</p>
          <p className="kpi-value">{kvmOverview?.vmSummary.error ?? 0}</p>
          <p className="kpi-meta">需人工排查</p>
        </article>
        <article className="kpi-card">
          <p className="kpi-title">服务状态</p>
          <p className="kpi-value">{kvmOverview?.orchestrator.online ? '在线' : '离线'}</p>
          <p className="kpi-meta">{kvmOverview?.orchestrator.service || 'kvm-orchestrator'}</p>
        </article>
      </section>

      <section className="chart-grid fade-in">
        <article className="panel">
          <div className="panel-header">
            <h2>VM 状态分布</h2>
          </div>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={vmPieData} cx="50%" cy="50%" outerRadius={90} innerRadius={55} dataKey="value" nameKey="label">
                  {vmPieData.map((item) => (
                    <Cell key={item.label} fill={VM_STATE_COLORS[item.label] ?? '#0ea5a5'} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <h2>会话状态分布</h2>
          </div>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={kvmOverview?.sessionStatusDistribution ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#dbe7f4" />
                <XAxis dataKey="label" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="value" name="数量" fill="#0284c7" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>
      </section>

      <section className="panel fade-in">
        <div className="panel-header">
          <h2>KVM 列表</h2>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>VM 名称</th>
                <th>状态</th>
                <th>Session</th>
                <th>CPU</th>
                <th>内存</th>
                <th>更新时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {vms.map((vm) => {
                const vmBusy = Boolean(busyVmIds[vm.vmId]);
                return (
                  <tr key={vm.vmId}>
                    <td className="mono">{vm.vmId}</td>
                    <td>
                      <span className={stateClassName(vm.state)}>{vm.state}</span>
                    </td>
                    <td className="mono">{vm.sessionId || '-'}</td>
                    <td>{formatValue(vm.cpuCores, 'c')}</td>
                    <td>{vm.memoryMb ? `${Math.round(vm.memoryMb / 1024)} GB` : '-'}</td>
                    <td>{formatDateTime(vm.createdAt)}</td>
                    <td>
                      <div className="action-inline">
                        <button
                          type="button"
                          className="table-btn"
                          onClick={() => handlePower(vm, 'start')}
                          disabled={vm.state === 'running' || vmBusy}
                        >
                          启动
                        </button>
                        <button
                          type="button"
                          className="table-btn danger"
                          onClick={() => handlePower(vm, 'stop')}
                          disabled={vm.state !== 'running' || vmBusy}
                        >
                          关机
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel fade-in">
        <div className="panel-header">
          <h2>宿主机管理（占位）</h2>
        </div>
        {hosts.length === 0 ? (
          <p className="empty">当前 KVM v1 未提供宿主机管理接口，已保留模块位置等待接入。</p>
        ) : (
          <p className="empty">已获取宿主机数：{hosts.length}</p>
        )}
      </section>
    </main>
  );

  const renderConversationSection = () => (
    <main className="content-stack">
      <section className="conversation-layout fade-in">
        <article className="panel">
          <div className="panel-header">
            <h2>会话列表</h2>
          </div>
          <div className="session-list">
            {conversationSessions.length === 0 ? (
              <p className="empty">暂无对话会话。</p>
            ) : (
              conversationSessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  className={`session-item ${selectedSessionId === session.id ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedSessionId(session.id);
                    void loadConversationDetail(session.id);
                  }}
                >
                  <div>
                    <p className="session-title">{session.title || session.id}</p>
                    <p className="session-meta">{formatDateTime(session.updatedAt)}</p>
                  </div>
                  <span className="session-status">{statusLabel(session.status)}</span>
                </button>
              ))
            )}
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <h2>会话详情</h2>
          </div>
          {!conversationDetail ? (
            <p className="empty">请选择左侧会话查看详情。</p>
          ) : (
            <div className="conversation-detail">
              <div className="detail-grid">
                <div>
                  <p className="kpi-title">会话 ID</p>
                  <p className="mono">{conversationDetail.session.id}</p>
                </div>
                <div>
                  <p className="kpi-title">状态</p>
                  <p>{statusLabel(conversationDetail.session.status)}</p>
                </div>
                <div>
                  <p className="kpi-title">阶段</p>
                  <p>{conversationDetail.session.stage || '-'}</p>
                </div>
              </div>

              <div className="panel-subtitle">对话消息 ({conversationDetail.messages.length})</div>
              <div className="message-list">
                {conversationDetail.messages.length === 0 ? (
                  <p className="empty">无消息</p>
                ) : (
                  conversationDetail.messages.map((message) => (
                    <article key={message.id} className="message-item">
                      <p className="message-head">
                        <strong>{message.role}</strong> · {formatDateTime(message.createdAt)}
                      </p>
                      <p className="message-content">{message.content}</p>
                    </article>
                  ))
                )}
              </div>
            </div>
          )}
        </article>
      </section>
    </main>
  );

  const renderAgentSection = () => (
    <main className="content-stack">
      <section className="kpi-grid fade-in">
        <article className="kpi-card">
          <p className="kpi-title">Oneceo API</p>
          <p className="kpi-value">{agentOverview?.oneceoApi.online ? '在线' : '离线'}</p>
          <p className="kpi-meta">{formatDateTime(agentOverview?.oneceoApi.timestamp)}</p>
        </article>
        <article className="kpi-card">
          <p className="kpi-title">Agent API</p>
          <p className="kpi-value">{agentOverview?.agentApi.online ? '在线' : '离线'}</p>
          <p className="kpi-meta">{agentOverview?.agentApi.message || '-'}</p>
        </article>
        <article className="kpi-card">
          <p className="kpi-title">任务会话总数</p>
          <p className="kpi-value">{agentOverview?.taskCreationSessions.total ?? 0}</p>
          <p className="kpi-meta">来自 task-creation sessions</p>
        </article>
        <article className="kpi-card">
          <p className="kpi-title">待确认会话</p>
          <p className="kpi-value">{agentOverview?.taskCreationSessions.waitingUser ?? 0}</p>
          <p className="kpi-meta">状态 waiting_user</p>
        </article>
      </section>

      <section className="chart-grid fade-in">
        <article className="panel">
          <div className="panel-header">
            <h2>任务阶段分布</h2>
          </div>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={agentOverview?.stageDistribution ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#dbe7f4" />
                <XAxis dataKey="label" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="value" name="数量" fill="#0f766e" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <h2>智能体能力卡</h2>
          </div>
          <div className="capability-grid">
            {(agentOverview?.capabilities || []).map((item) => (
              <article key={item.key} className="capability-card">
                <p className="capability-name">{item.name}</p>
                <p className="capability-meta">{item.transport}</p>
                <p className="mono">{item.endpoint}</p>
                <span className={`capability-status ${item.status}`}>{item.status}</span>
              </article>
            ))}
          </div>
        </article>
      </section>
    </main>
  );

  const renderAuditSection = () => (
    <main className="content-stack">
      <section className="panel fade-in">
        <div className="panel-header">
          <h2>审计日志</h2>
        </div>
        <div className="audit-list">
          {auditEntries.length === 0 ? (
            <p className="empty">暂无审计日志。</p>
          ) : (
            auditEntries.map((entry) => (
              <article key={entry.id} className="audit-item">
                <p>
                  <strong>{entry.action.toUpperCase()}</strong> {entry.targetVmId}{' '}
                  <span className={entry.result === 'success' ? 'ok-text' : 'error-text'}>{entry.result}</span>
                </p>
                <p className="mono">
                  {entry.operator} | {formatDateTime(entry.timestamp)}
                </p>
                {entry.detail ? <p className="audit-detail">{entry.detail}</p> : null}
              </article>
            ))
          )}
        </div>
      </section>
    </main>
  );

  const renderContent = () => {
    if (loading) {
      return <main className="loading-state">正在加载 {breadcrumbTitle} ...</main>;
    }

    if (activeSection === 'kvm') return renderKvmSection();
    if (activeSection === 'conversation') return renderConversationSection();
    if (activeSection === 'agent') return renderAgentSection();
    return renderAuditSection();
  };

  return (
    <div className="page-shell">
      <div className="background-glow" aria-hidden="true" />
      <div className="app-layout">
        <aside className="sidebar fade-in">
          <div className="sidebar-brand">
            <p className="eyebrow">Oneceo Admin</p>
            <p className="sidebar-title">管理面板</p>
          </div>
          <nav className="sidebar-nav" aria-label="Primary">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`nav-item ${activeSection === item.key ? 'active' : ''}`}
                onClick={() => setActiveSection(item.key)}
              >
                <span>{item.label}</span>
                <small>{item.subtitle}</small>
              </button>
            ))}
          </nav>
        </aside>

        <section className="main-area">
          <header className="top-header fade-in">
            <div>
              <p className="eyebrow">控制台 / {breadcrumbTitle}</p>
              <h1>{breadcrumbTitle}</h1>
              <p className="subtitle">基于 oneceo 项目现有模块能力构建的管理标签页。</p>
            </div>
            <div className="header-tools">
              <span className={`service-state ${kvmOverview?.orchestrator.online ? 'ok' : 'down'}`}>
                {kvmOverview?.orchestrator.online ? 'KVM 在线' : 'KVM 离线'}
              </span>
              <button
                type="button"
                className="primary-btn"
                onClick={() => loadSection(activeSection)}
                disabled={refreshing}
              >
                {refreshing ? '刷新中...' : '刷新当前标签'}
              </button>
              <p className="updated-at">最后更新: {formatDateTime(kvmOverview?.updatedAt)}</p>
            </div>
          </header>

          {error ? (
            <section className="error-banner fade-in" role="alert">
              {error}
            </section>
          ) : null}

          {renderContent()}
        </section>
      </div>
    </div>
  );
}
