import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from './api';
import { KvmControlCenter } from './components/KvmControlCenter';
import type {
  AgentManagementOverview,
  AuditLogEntry,
  ConversationSession,
  ConversationSessionDetailResponse,
  DashboardOverview,
  HostListResponse,
  SandboxManagementOverview,
  VmItem,
} from './types';

type SectionKey = 'kvm' | 'conversation' | 'agent' | 'sandbox' | 'audit';
type HostTrendPoint = {
  timestamp: number;
  timeLabel: string;
  cpu: number;
  memory: number;
  storage: number;
};

const NAV_ITEMS: Array<{ key: SectionKey; label: string; subtitle: string }> = [
  { key: 'kvm', label: 'KVM 管理', subtitle: '虚拟机与资源' },
  { key: 'conversation', label: '对话管理', subtitle: '任务创建会话' },
  { key: 'agent', label: '智能体管理', subtitle: 'Agent 运行状态' },
  { key: 'sandbox', label: '执行环境管理', subtitle: 'Sandbox 与 OSAC' },
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

function hostStatusLabel(status: string) {
  if (status === 'online') return '在线';
  if (status === 'degraded') return '降级';
  if (status === 'maintenance') return '维护';
  if (status === 'offline') return '离线';
  return status;
}

function hostStatusColor(status: string) {
  if (status === 'online') return '#047857';
  if (status === 'degraded') return '#b45309';
  if (status === 'maintenance') return '#4f46e5';
  return '#b91c1c';
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '-';
  }
  return `${value.toFixed(1)}%`;
}

function toJsonText(value: unknown) {
  if (value === undefined) return '-';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function summarizeText(value: string | undefined, max = 260) {
  if (!value) return '';
  const compact = value.replace(/\s+/g, ' ').trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max)}...`;
}

function formatStateSnapshot(snapshot?: { status?: string; stage?: string; phase?: string }) {
  const status = snapshot?.status || '-';
  const stage = snapshot?.stage || '-';
  const phase = snapshot?.phase || '-';
  return `status=${status} stage=${stage} phase=${phase}`;
}

function uniqueSorted(values: Array<string | undefined | null>) {
  const set = new Set<string>();
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      set.add(value.trim());
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function parseFilterTime(value: string): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return '-';
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}

function buildTransitionSearchText(transition: {
  from?: { status?: string; stage?: string; phase?: string };
  to?: { status?: string; stage?: string; phase?: string };
  trigger?: {
    messageType?: string;
    role?: string;
    agent?: string;
    tone?: string;
    content?: string;
  };
}) {
  const parts = [
    transition.from?.status,
    transition.from?.stage,
    transition.from?.phase,
    transition.to?.status,
    transition.to?.stage,
    transition.to?.phase,
    transition.trigger?.messageType,
    transition.trigger?.role,
    transition.trigger?.agent,
    transition.trigger?.tone,
    transition.trigger?.content,
  ];
  return parts.filter(Boolean).join(' ').toLowerCase();
}

function traceLevelClass(level: string) {
  if (level === 'error') return 'trace-level error';
  if (level === 'warn') return 'trace-level warn';
  return 'trace-level info';
}

const DEFAULT_TRANSITION_FILTERS = {
  fromStage: 'all',
  toStage: 'all',
  status: 'all',
  phase: 'all',
  role: 'all',
  messageType: 'all',
  agent: 'all',
  tone: 'all',
  fromTime: '',
  toTime: '',
};

export default function App() {
  const [activeSection, setActiveSection] = useState<SectionKey>('kvm');

  const [kvmOverview, setKvmOverview] = useState<DashboardOverview | null>(null);
  const [vms, setVms] = useState<VmItem[]>([]);
  const [hosts, setHosts] = useState<HostListResponse['hosts']>([]);
  const [hostTrendMap, setHostTrendMap] = useState<Record<string, HostTrendPoint[]>>({});
  const [busyVmIds, setBusyVmIds] = useState<Record<string, boolean>>({});

  const [conversationSessions, setConversationSessions] = useState<ConversationSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [conversationDetail, setConversationDetail] = useState<ConversationSessionDetailResponse | null>(null);
  const [showOpencodePayload, setShowOpencodePayload] = useState(false);
  const [transitionView, setTransitionView] = useState<'timeline' | 'list'>('timeline');
  const [transitionQuery, setTransitionQuery] = useState('');
  const [transitionFilters, setTransitionFilters] = useState(DEFAULT_TRANSITION_FILTERS);

  const [agentOverview, setAgentOverview] = useState<AgentManagementOverview | null>(null);
  const [sandboxOverview, setSandboxOverview] = useState<SandboxManagementOverview | null>(null);
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
    const nextHosts = hostResult.status === 'fulfilled' ? hostResult.value.hosts : [];
    setHosts(nextHosts);

    if (hostResult.status === 'fulfilled') {
      const sampledAt = Date.now();
      setHostTrendMap((previous) => {
        const updated: Record<string, HostTrendPoint[]> = {};
        for (const host of nextHosts) {
          const previousSeries = previous[host.hostId] || [];
          const nextPoint: HostTrendPoint = {
            timestamp: sampledAt,
            timeLabel: new Date(sampledAt).toLocaleTimeString('zh-CN', { hour12: false }),
            cpu: Number(host.cpuUsagePercent.toFixed(1)),
            memory: Number(host.memoryUsagePercent.toFixed(1)),
            storage: Number(host.storageUsagePercent.toFixed(1)),
          };

          const lastPoint = previousSeries[previousSeries.length - 1];
          const shouldAppend = !lastPoint || Math.abs(lastPoint.timestamp - nextPoint.timestamp) > 1000;

          const series = shouldAppend ? [...previousSeries, nextPoint] : previousSeries;
          updated[host.hostId] = series.slice(-30);
        }
        return updated;
      });
    }

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

  const loadSandboxSection = useCallback(async () => {
    const result = await api.getSandboxManagementOverview(80);
    setSandboxOverview(result);
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
        } else if (section === 'sandbox') {
          await loadSandboxSection();
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
    [loadAgentSection, loadAuditSection, loadConversationSessions, loadKvmSection, loadSandboxSection]
  );

  useEffect(() => {
    loadSection(activeSection, true);
  }, [activeSection, loadSection]);

  useEffect(() => {
    if (activeSection !== 'kvm') {
      return;
    }

    const timer = window.setInterval(() => {
      void loadKvmSection().catch((requestError) => {
        setError(requestError instanceof Error ? requestError.message : 'KVM 自动刷新失败');
      });
    }, 15000);

    return () => {
      window.clearInterval(timer);
    };
  }, [activeSection, loadKvmSection]);

  useEffect(() => {
    if (!selectedSessionId || activeSection !== 'conversation') {
      return;
    }

    let cancelled = false;
    const run = async () => {
      try {
        const [detail, sessions] = await Promise.all([
          api.getConversationSessionDetail(selectedSessionId),
          api.listConversationSessions(30),
        ]);
        if (!cancelled) {
          setConversationDetail(detail);
          setConversationSessions(sessions.sessions);
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : '加载会话详情失败');
        }
      }
    };

    void run();
    const timer = window.setInterval(() => {
      void run();
    }, 4000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeSection, selectedSessionId]);

  useEffect(() => {
    setTransitionView('timeline');
    setTransitionQuery('');
    setTransitionFilters(DEFAULT_TRANSITION_FILTERS);
  }, [selectedSessionId]);

  const vmPieData = useMemo(
    () => (kvmOverview?.vmStateDistribution ?? []).filter((item) => item.value > 0),
    [kvmOverview]
  );

  const stateTransitions = useMemo(
    () => conversationDetail?.trace?.stateTransitions || [],
    [conversationDetail]
  );
  const sortedTransitions = useMemo(() => {
    return [...stateTransitions].sort((a, b) => {
      const aTime = a.at ? Date.parse(a.at) : Number.MAX_SAFE_INTEGER;
      const bTime = b.at ? Date.parse(b.at) : Number.MAX_SAFE_INTEGER;
      return aTime - bTime;
    });
  }, [stateTransitions]);

  const transitionOptions = useMemo(() => {
    return {
      fromStages: uniqueSorted(sortedTransitions.map((item) => item.from?.stage)),
      toStages: uniqueSorted(sortedTransitions.map((item) => item.to?.stage)),
      statuses: uniqueSorted(sortedTransitions.map((item) => item.to?.status)),
      phases: uniqueSorted(sortedTransitions.map((item) => item.to?.phase)),
      roles: uniqueSorted(sortedTransitions.map((item) => item.trigger?.role)),
      messageTypes: uniqueSorted(sortedTransitions.map((item) => item.trigger?.messageType)),
      agents: uniqueSorted(sortedTransitions.map((item) => item.trigger?.agent)),
      tones: uniqueSorted(sortedTransitions.map((item) => item.trigger?.tone)),
    };
  }, [sortedTransitions]);

  const filteredTransitions = useMemo(() => {
    const query = transitionQuery.trim().toLowerCase();
    const fromMs = parseFilterTime(transitionFilters.fromTime);
    const toMs = parseFilterTime(transitionFilters.toTime);

    return sortedTransitions.filter((transition) => {
      if (fromMs !== null) {
        if (!transition.at) return false;
        const ts = Date.parse(transition.at);
        if (Number.isNaN(ts) || ts < fromMs) return false;
      }
      if (toMs !== null) {
        if (!transition.at) return false;
        const ts = Date.parse(transition.at);
        if (Number.isNaN(ts) || ts > toMs) return false;
      }

      if (transitionFilters.fromStage !== 'all' && transition.from?.stage !== transitionFilters.fromStage) {
        return false;
      }
      if (transitionFilters.toStage !== 'all' && transition.to?.stage !== transitionFilters.toStage) {
        return false;
      }
      if (transitionFilters.status !== 'all' && transition.to?.status !== transitionFilters.status) {
        return false;
      }
      if (transitionFilters.phase !== 'all' && transition.to?.phase !== transitionFilters.phase) {
        return false;
      }
      if (transitionFilters.role !== 'all' && transition.trigger?.role !== transitionFilters.role) {
        return false;
      }
      if (transitionFilters.messageType !== 'all' && transition.trigger?.messageType !== transitionFilters.messageType) {
        return false;
      }
      if (transitionFilters.agent !== 'all' && transition.trigger?.agent !== transitionFilters.agent) {
        return false;
      }
      if (transitionFilters.tone !== 'all' && transition.trigger?.tone !== transitionFilters.tone) {
        return false;
      }

      if (query) {
        const haystack = buildTransitionSearchText(transition);
        if (!haystack.includes(query)) {
          return false;
        }
      }

      return true;
    });
  }, [sortedTransitions, transitionFilters, transitionQuery]);

  const transitionStats = useMemo(() => {
    const stageSet = new Set(filteredTransitions.map((item) => item.to?.stage).filter(Boolean) as string[]);
    const statusSet = new Set(filteredTransitions.map((item) => item.to?.status).filter(Boolean) as string[]);
    const phaseSet = new Set(filteredTransitions.map((item) => item.to?.phase).filter(Boolean) as string[]);
    return {
      total: sortedTransitions.length,
      filtered: filteredTransitions.length,
      stages: Array.from(stageSet),
      statuses: Array.from(statusSet),
      phases: Array.from(phaseSet),
    };
  }, [sortedTransitions.length, filteredTransitions]);

  const breadcrumbTitle = NAV_ITEMS.find((item) => item.key === activeSection)?.label || '管理后台';
  const activeServiceOnline =
    activeSection === 'agent'
      ? agentOverview?.agentApi.online
      : activeSection === 'sandbox'
        ? sandboxOverview?.sandboxApi.online
        : kvmOverview?.orchestrator.online;
  const activeServiceLabel =
    activeSection === 'agent' ? 'Agent 服务' : activeSection === 'sandbox' ? 'Sandbox 服务' : 'KVM 服务';

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
      <section className="panel fade-in">
        <div className="panel-header">
          <h2>KVM 宿主机状态</h2>
          <span className="kpi-meta">总计 {hosts.length} 台</span>
        </div>
        {hosts.length === 0 ? (
          <p className="empty">暂无宿主机数据，请检查 KVM 编排器连接或稍后重试。</p>
        ) : (
          <div className="host-grid">
            {hosts.map((host) => (
              <article key={host.hostId} className="host-card">
                <div className="host-head">
                  <div>
                    <h3>{host.name}</h3>
                    <p className="kpi-meta mono">{host.managementIp}</p>
                  </div>
                  <span className="host-dot" style={{ backgroundColor: hostStatusColor(host.effectiveStatus) }}>
                    {hostStatusLabel(host.effectiveStatus)}
                  </span>
                </div>

                <div className="usage-grid">
                  <div>
                    <p>CPU 使用率</p>
                    <strong>{formatPercent(host.cpuUsagePercent)}</strong>
                    <p>
                      {host.usedCpuCores.toFixed(1)} / {host.cpuCapacityCores.toFixed(1)} cores
                    </p>
                  </div>
                  <div>
                    <p>内存使用率</p>
                    <strong>{formatPercent(host.memoryUsagePercent)}</strong>
                    <p>
                      {host.usedMemoryGb.toFixed(1)} / {host.memoryCapacityGb.toFixed(1)} GB
                    </p>
                  </div>
                  <div>
                    <p>存储使用率</p>
                    <strong>{formatPercent(host.storageUsagePercent)}</strong>
                    <p>
                      {host.usedStorageGb.toFixed(1)} / {host.storageCapacityGb.toFixed(1)} GB
                    </p>
                  </div>
                </div>

                <div className="host-card-footer">
                  <p>
                    运行 VM {host.runningVmCount} / 总 VM {host.totalVmCount}
                  </p>
                  <p>心跳: {formatDateTime(host.lastHeartbeat)}</p>
                </div>

                <div className="host-trend-wrap">
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={hostTrendMap[host.hostId] || []}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#dbe7f4" />
                      <XAxis dataKey="timeLabel" minTickGap={20} />
                      <YAxis domain={[0, 100]} tickFormatter={(value) => `${value}%`} />
                      <Tooltip formatter={(value) => [`${value}%`, '']} />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="cpu"
                        name="CPU"
                        stroke="#0f766e"
                        strokeWidth={2}
                        dot={{ r: 2 }}
                        activeDot={{ r: 4 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="memory"
                        name="内存"
                        stroke="#0284c7"
                        strokeWidth={2}
                        dot={{ r: 2 }}
                        activeDot={{ r: 4 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="storage"
                        name="存储"
                        stroke="#f59e0b"
                        strokeWidth={2}
                        dot={{ r: 2 }}
                        activeDot={{ r: 4 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

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

      <KvmControlCenter
        vms={vms}
        onDataChanged={async () => {
          await loadKvmSection();
          await loadAuditSection();
        }}
        onError={(message) => setError(message)}
      />
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
                    setConversationDetail(null);
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
              <div className="detail-grid detail-grid-wide">
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
                <div>
                  <p className="kpi-title">编排 Session</p>
                  <p className="mono">{conversationDetail.runtime?.orchestratorSessionId || '-'}</p>
                </div>
                <div>
                  <p className="kpi-title">OpenCode Session</p>
                  <p className="mono">{conversationDetail.runtime?.opencodeSessionId || '-'}</p>
                </div>
                <div>
                  <p className="kpi-title">VM 名称</p>
                  <p className="mono">{conversationDetail.runtime?.vmName || '-'}</p>
                </div>
                <div>
                  <p className="kpi-title">绑定更新时间</p>
                  <p>{formatDateTime(conversationDetail.runtime?.bindingUpdatedAt)}</p>
                </div>
                <div>
                  <p className="kpi-title">待补充问题</p>
                  <p>{conversationDetail.runtime?.pendingQuestion || '-'}</p>
                </div>
                <div>
                  <p className="kpi-title">挂起原因</p>
                  <p>{conversationDetail.runtime?.pendingResume?.reason || '-'}</p>
                </div>
              </div>

              <div className="panel-subtitle">
                全链路时间线 ({conversationDetail.trace?.timeline.length ?? 0})
              </div>
              <div className="trace-list">
                {(conversationDetail.trace?.timeline || []).length === 0 ? (
                  <p className="empty">无链路事件</p>
                ) : (
                  (conversationDetail.trace?.timeline || []).map((event) => {
                    const badgeLabel = event.badge || event.level;
                    const hasDecision = Boolean(event.decision?.layer || event.decision?.source || event.decision?.type);
                    const hasDecisionIO = Boolean(event.decisionInput || event.decisionOutput);
                    const hasContext = Boolean(event.context?.trigger || event.context?.previous);
                    const rawContent = event.rawContent || '';
                    const showRaw = rawContent && rawContent !== event.content;
                    return (
                      <article key={event.id} className="trace-item">
                        <p className="trace-head">
                          <span className={traceLevelClass(event.level)}>{badgeLabel}</span>
                          <strong>{event.title}</strong>
                          <span>{formatDateTime(event.timestamp)}</span>
                        </p>
                        <p className="trace-meta mono">
                          {event.source} / {event.category}
                        </p>
                        {hasDecision ? (
                          <p className="trace-meta">
                            决策层级: {event.decision?.layer || '-'}
                            {event.decision?.name ? ` · 名称: ${event.decision.name}` : ''}
                            · 来源: {event.decision?.source || '-'} · 类型: {event.decision?.type || '-'}
                          </p>
                        ) : null}
                        {event.content ? <p className="message-content">{summarizeText(event.content, 360)}</p> : null}
                        {hasDecisionIO ? (
                          <details>
                            <summary>查看决策输入/输出</summary>
                            {event.decisionInput ? (
                              <>
                                <p className="kpi-title">输入</p>
                                <pre className="json-block">{toJsonText(event.decisionInput)}</pre>
                              </>
                            ) : null}
                            {event.decisionOutput ? (
                              <>
                                <p className="kpi-title">输出</p>
                                <pre className="json-block">{toJsonText(event.decisionOutput)}</pre>
                              </>
                            ) : null}
                          </details>
                        ) : null}
                        {hasContext ? (
                          <div className="trace-meta">
                            {event.context?.trigger ? (
                              <p>
                                触发消息: {event.context.trigger.messageType || '-'} ·{' '}
                                {summarizeText(event.context.trigger.content, 180)}
                              </p>
                            ) : null}
                            {event.context?.previous ? (
                              <p>
                                前置消息: {event.context.previous.messageType || '-'} ·{' '}
                                {summarizeText(event.context.previous.content, 180)}
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                        {showRaw ? (
                          <details>
                            <summary>查看原文</summary>
                            <pre className="json-block">{rawContent}</pre>
                          </details>
                        ) : null}
                      </article>
                    );
                  })
                )}
              </div>

              <div className="panel-subtitle panel-subtitle-row">
                <span>状态机流转 ({stateTransitions.length})</span>
                <div className="panel-subtitle-actions">
                  <button
                    type="button"
                    className={`toggle-btn ${transitionView === 'timeline' ? 'active' : ''}`}
                    onClick={() => setTransitionView('timeline')}
                  >
                    时间轴
                  </button>
                  <button
                    type="button"
                    className={`toggle-btn ${transitionView === 'list' ? 'active' : ''}`}
                    onClick={() => setTransitionView('list')}
                  >
                    列表
                  </button>
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => {
                      setTransitionQuery('');
                      setTransitionFilters(DEFAULT_TRANSITION_FILTERS);
                    }}
                  >
                    重置筛选
                  </button>
                </div>
              </div>

              <div className="state-filter">
                <div className="state-filter-row">
                  <label className="state-filter-field">
                    <span>搜索</span>
                    <input
                      type="search"
                      placeholder="按阶段/状态/消息内容搜索"
                      value={transitionQuery}
                      onChange={(event) => setTransitionQuery(event.target.value)}
                    />
                  </label>
                  <label className="state-filter-field">
                    <span>开始时间</span>
                    <input
                      type="datetime-local"
                      value={transitionFilters.fromTime}
                      onChange={(event) =>
                        setTransitionFilters((prev) => ({ ...prev, fromTime: event.target.value }))
                      }
                    />
                  </label>
                  <label className="state-filter-field">
                    <span>结束时间</span>
                    <input
                      type="datetime-local"
                      value={transitionFilters.toTime}
                      onChange={(event) =>
                        setTransitionFilters((prev) => ({ ...prev, toTime: event.target.value }))
                      }
                    />
                  </label>
                </div>

                <div className="state-filter-grid">
                  <label className="state-filter-field">
                    <span>起始阶段</span>
                    <select
                      value={transitionFilters.fromStage}
                      onChange={(event) =>
                        setTransitionFilters((prev) => ({ ...prev, fromStage: event.target.value }))
                      }
                    >
                      <option value="all">全部</option>
                      {transitionOptions.fromStages.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="state-filter-field">
                    <span>目标阶段</span>
                    <select
                      value={transitionFilters.toStage}
                      onChange={(event) =>
                        setTransitionFilters((prev) => ({ ...prev, toStage: event.target.value }))
                      }
                    >
                      <option value="all">全部</option>
                      {transitionOptions.toStages.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="state-filter-field">
                    <span>状态</span>
                    <select
                      value={transitionFilters.status}
                      onChange={(event) =>
                        setTransitionFilters((prev) => ({ ...prev, status: event.target.value }))
                      }
                    >
                      <option value="all">全部</option>
                      {transitionOptions.statuses.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="state-filter-field">
                    <span>阶段(Phase)</span>
                    <select
                      value={transitionFilters.phase}
                      onChange={(event) =>
                        setTransitionFilters((prev) => ({ ...prev, phase: event.target.value }))
                      }
                    >
                      <option value="all">全部</option>
                      {transitionOptions.phases.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="state-filter-field">
                    <span>消息类型</span>
                    <select
                      value={transitionFilters.messageType}
                      onChange={(event) =>
                        setTransitionFilters((prev) => ({ ...prev, messageType: event.target.value }))
                      }
                    >
                      <option value="all">全部</option>
                      {transitionOptions.messageTypes.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="state-filter-field">
                    <span>角色</span>
                    <select
                      value={transitionFilters.role}
                      onChange={(event) => setTransitionFilters((prev) => ({ ...prev, role: event.target.value }))}
                    >
                      <option value="all">全部</option>
                      {transitionOptions.roles.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="state-filter-field">
                    <span>Agent</span>
                    <select
                      value={transitionFilters.agent}
                      onChange={(event) => setTransitionFilters((prev) => ({ ...prev, agent: event.target.value }))}
                    >
                      <option value="all">全部</option>
                      {transitionOptions.agents.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="state-filter-field">
                    <span>Tone</span>
                    <select
                      value={transitionFilters.tone}
                      onChange={(event) => setTransitionFilters((prev) => ({ ...prev, tone: event.target.value }))}
                    >
                      <option value="all">全部</option>
                      {transitionOptions.tones.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>

              <div className="compact-list state-summary">
                <div className="compact-item">
                  <span>总流转</span>
                  <strong className="mono">{transitionStats.total}</strong>
                </div>
                <div className="compact-item">
                  <span>筛选后</span>
                  <strong className="mono">{transitionStats.filtered}</strong>
                </div>
                <div className="compact-item">
                  <span>涉及阶段</span>
                  <strong className="mono">{transitionStats.stages.length}</strong>
                </div>
                <div className="compact-item">
                  <span>涉及状态</span>
                  <strong className="mono">{transitionStats.statuses.length}</strong>
                </div>
                <div className="compact-item">
                  <span>涉及 Phase</span>
                  <strong className="mono">{transitionStats.phases.length}</strong>
                </div>
              </div>

              {filteredTransitions.length === 0 ? (
                <p className="empty">无状态流转记录</p>
              ) : transitionView === 'timeline' ? (
                <div className="state-timeline">
                  {filteredTransitions.map((transition, index) => {
                    const trigger = transition.trigger || {};
                    const triggerSummary = [
                      trigger.messageType ? `type=${trigger.messageType}` : '',
                      trigger.role ? `role=${trigger.role}` : '',
                      trigger.agent ? `agent=${trigger.agent}` : '',
                      trigger.tone ? `tone=${trigger.tone}` : '',
                      trigger.messageId ? `id=${trigger.messageId}` : '',
                    ]
                      .filter(Boolean)
                      .join(' / ');
                    const prev = index > 0 ? filteredTransitions[index - 1] : null;
                    const gap =
                      prev?.at && transition.at
                        ? formatDuration(Date.parse(transition.at) - Date.parse(prev.at))
                        : '-';
                    return (
                      <article key={`${transition.at || 'transition'}-${index}`} className="state-timeline-item">
                        <div className="state-timeline-head">
                          <span className={traceLevelClass('info')}>state</span>
                          <strong>{`${transition.from?.stage || '-'} → ${transition.to?.stage || '-'}`}</strong>
                          <span>{formatDateTime(transition.at)}</span>
                          <span className="state-gap">间隔 {gap}</span>
                        </div>
                        <div className="state-timeline-meta">
                          <span className="mono">{formatStateSnapshot(transition.from)}</span>
                          <span className="mono">{formatStateSnapshot(transition.to)}</span>
                        </div>
                        <div className="state-transition-flow">
                          <span className="state-chip from">{transition.from?.stage || '-'}</span>
                          <span className="state-chip status">{transition.to?.status || '-'}</span>
                          <span className="state-chip phase">{transition.to?.phase || '-'}</span>
                          <span className="state-chip to">{transition.to?.stage || '-'}</span>
                        </div>
                        {triggerSummary ? <p className="message-content">触发: {triggerSummary}</p> : null}
                        {trigger.content ? (
                          <p className="message-content">内容: {summarizeText(trigger.content, 240)}</p>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="trace-list">
                  {filteredTransitions.map((transition, index) => {
                    const trigger = transition.trigger || {};
                    const triggerSummary = [
                      trigger.messageType ? `type=${trigger.messageType}` : '',
                      trigger.role ? `role=${trigger.role}` : '',
                      trigger.agent ? `agent=${trigger.agent}` : '',
                      trigger.tone ? `tone=${trigger.tone}` : '',
                      trigger.messageId ? `id=${trigger.messageId}` : '',
                    ]
                      .filter(Boolean)
                      .join(' / ');
                    return (
                      <article key={`${transition.at || 'transition'}-${index}`} className="trace-item">
                        <p className="trace-head">
                          <span className={traceLevelClass('info')}>state</span>
                          <strong>{`${transition.from?.stage || '-'} → ${transition.to?.stage || '-'}`}</strong>
                          <span>{formatDateTime(transition.at)}</span>
                        </p>
                        <p className="trace-meta mono">
                          {formatStateSnapshot(transition.from)} → {formatStateSnapshot(transition.to)}
                        </p>
                        {triggerSummary ? <p className="message-content">触发: {triggerSummary}</p> : null}
                        {trigger.content ? (
                          <p className="message-content">内容: {summarizeText(trigger.content, 240)}</p>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              )}

              <div className="panel-subtitle">对话消息 ({conversationDetail.messages.length})</div>
              <div className="message-list message-list-large">
                {conversationDetail.messages.length === 0 ? (
                  <p className="empty">无消息</p>
                ) : (
                  conversationDetail.messages.map((message) => (
                    <article key={message.id} className="message-item">
                      <p className="message-head">
                        <strong>{message.role}</strong> · {formatDateTime(message.createdAt)}
                      </p>
                      <p className="message-content">{message.content}</p>
                      {message.metadata !== undefined ? (
                        <pre className="json-block message-meta-json">{toJsonText(message.metadata)}</pre>
                      ) : null}
                    </article>
                  ))
                )}
              </div>

              <div className="panel-subtitle">LLM 调用轨迹 ({conversationDetail.trace?.llm.length ?? 0})</div>
              <div className="llm-trace-list">
                {(conversationDetail.trace?.llm || []).length === 0 ? (
                  <p className="empty">无 LLM 调用轨迹</p>
                ) : (
                  (conversationDetail.trace?.llm || []).map((item) => (
                    <article key={item.id} className="sub-panel">
                      <div className="trace-head">
                        <strong>{item.stage}</strong>
                        <span className="mono">{item.source}</span>
                        <span>{item.inferred ? '推断还原' : '真实命令'}</span>
                      </div>
                      <p className="trace-meta">时间: {formatDateTime(item.createdAt)}</p>
                      <p className="kpi-title">请求内容</p>
                      <pre className="json-block">{toJsonText(item.request)}</pre>
                      <p className="kpi-title">返回内容</p>
                      <pre className="json-block">{toJsonText(item.response)}</pre>
                    </article>
                  ))
                )}
              </div>

              <div className="panel-subtitle">KVM / Sandbox 调用状态</div>
              <div className="trace-columns">
                <article className="sub-panel">
                  <h3>KVM 摘要</h3>
                  <pre className="json-block">
                    {toJsonText({
                      orchestratorSessionId: conversationDetail.trace?.kvm.orchestratorSessionId,
                      vmName: conversationDetail.trace?.kvm.vmName,
                      quota: conversationDetail.trace?.kvm.quota,
                    })}
                  </pre>
                  {conversationDetail.trace?.kvm.errors?.length ? (
                    <pre className="json-block">{toJsonText(conversationDetail.trace.kvm.errors)}</pre>
                  ) : null}
                </article>

                <article className="sub-panel">
                  <h3>KVM 原始状态</h3>
                  <pre className="json-block">
                    {toJsonText({
                      session: conversationDetail.trace?.kvm.session,
                      sessionVm: conversationDetail.trace?.kvm.sessionVm,
                      sandbox: conversationDetail.trace?.kvm.sandbox,
                      sandboxIp: conversationDetail.trace?.kvm.sandboxIp,
                      sandboxPorts: conversationDetail.trace?.kvm.sandboxPorts,
                      vmDetail: conversationDetail.trace?.kvm.vmDetail,
                      vmMetrics: conversationDetail.trace?.kvm.vmMetrics,
                    })}
                  </pre>
                </article>

                <article className="sub-panel">
                  <h3>Sandbox 环境记录</h3>
                  <pre className="json-block">
                    {toJsonText({
                      primaryEnvironment: conversationDetail.trace?.sandbox.primaryEnvironment,
                      relatedEnvironments: conversationDetail.trace?.sandbox.relatedEnvironments,
                    })}
                  </pre>
                </article>
              </div>

              <div className="panel-subtitle panel-subtitle-row">
                <span>OSAC / OpenCode 消息 ({conversationDetail.trace?.osac.messages.length ?? 0})</span>
                <div className="panel-subtitle-actions">
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => setShowOpencodePayload((prev) => !prev)}
                  >
                    {showOpencodePayload ? '隐藏原始 payload' : '显示原始 payload'}
                  </button>
                </div>
              </div>
              <div className="trace-list">
                {(conversationDetail.trace?.osac.messages || []).length === 0 ? (
                  <p className="empty">无 OSAC 消息</p>
                ) : (
                  (conversationDetail.trace?.osac.messages || []).map((message, index) => {
                    const payload = (message.payload || {}) as Record<string, unknown>;
                    const summary = summarizeText(
                      [
                        typeof payload.eventType === 'string' ? payload.eventType : '',
                        typeof payload.message === 'string' ? payload.message : '',
                        typeof payload.status === 'string' ? payload.status : '',
                        typeof payload.output === 'string' ? payload.output : '',
                      ]
                        .filter(Boolean)
                        .join(' | '),
                      320
                    );
                    const payloadTimestamp =
                      typeof payload.timestamp === 'string'
                        ? payload.timestamp
                        : typeof payload.time === 'string'
                          ? payload.time
                          : undefined;
                    return (
                      <article key={`${message.type}-${index}`} className="trace-item">
                        <p className="trace-head">
                          <span className="trace-level info">osac</span>
                          <strong>{message.type}</strong>
                          <span>{formatDateTime(payloadTimestamp)}</span>
                        </p>
                        {summary ? <p className="message-content">{summary}</p> : null}
                        {showOpencodePayload ? <pre className="json-block">{toJsonText(payload)}</pre> : null}
                      </article>
                    );
                  })
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

  const renderSandboxSection = () => (
    <main className="content-stack">
      <section className="kpi-grid fade-in">
        <article className="kpi-card">
          <p className="kpi-title">Sandbox API</p>
          <p className="kpi-value">{sandboxOverview?.sandboxApi.online ? '在线' : '离线'}</p>
          <p className="kpi-meta">{sandboxOverview?.sandboxApi.service || '-'}</p>
        </article>
        <article className="kpi-card">
          <p className="kpi-title">执行环境总数</p>
          <p className="kpi-value">{sandboxOverview?.summary.total ?? 0}</p>
          <p className="kpi-meta">环境记录</p>
        </article>
        <article className="kpi-card">
          <p className="kpi-title">Ready 环境</p>
          <p className="kpi-value">{sandboxOverview?.summary.ready ?? 0}</p>
          <p className="kpi-meta">可执行</p>
        </article>
        <article className="kpi-card">
          <p className="kpi-title">Creating 环境</p>
          <p className="kpi-value">{sandboxOverview?.summary.creating ?? 0}</p>
          <p className="kpi-meta">创建中</p>
        </article>
      </section>

      <section className="panel fade-in">
        <div className="panel-header">
          <h2>执行环境列表</h2>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Session ID</th>
                <th>VM 名称</th>
                <th>状态</th>
                <th>基础镜像</th>
                <th>更新时间</th>
              </tr>
            </thead>
            <tbody>
              {(sandboxOverview?.environments || []).map((item) => (
                <tr key={item.id}>
                  <td className="mono">{item.sessionId}</td>
                  <td className="mono">{item.vmName || '-'}</td>
                  <td>{item.status}</td>
                  <td>{item.baseImage || '-'}</td>
                  <td>{formatDateTime(item.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
    if (activeSection === 'sandbox') return renderSandboxSection();
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
              <span className={`service-state ${activeServiceOnline ? 'ok' : 'down'}`}>
                {activeServiceOnline ? `${activeServiceLabel}在线` : `${activeServiceLabel}离线`}
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
