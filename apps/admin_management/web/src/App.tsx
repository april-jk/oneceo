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
import type { DashboardOverview, HostListResponse, HostStatus, VmItem } from './types';

const VM_STATE_COLORS: Record<string, string> = {
  running: '#059669',
  stopped: '#9ca3af',
  paused: '#f59e0b',
  error: '#dc2626',
};

const HOST_STATUS_COLORS: Record<HostStatus, string> = {
  online: '#0ea5a5',
  degraded: '#f97316',
  maintenance: '#3b82f6',
  offline: '#6b7280',
};

type HostDraft = {
  status: HostStatus;
  cpuCapacityCores: number;
  memoryCapacityGb: number;
  storageCapacityGb: number;
  notes: string;
};

function formatDateTime(value?: string) {
  if (!value) {
    return '-';
  }
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function formatUptime(seconds?: number): string {
  if (!seconds || seconds <= 0) {
    return '0m';
  }
  const hour = Math.floor(seconds / 3600);
  const minute = Math.floor((seconds % 3600) / 60);
  if (hour > 0) {
    return `${hour}h ${minute}m`;
  }
  return `${minute}m`;
}

function stateClassName(state: string) {
  return `status-pill status-${state}`;
}

function statusLabel(status: HostStatus) {
  if (status === 'online') return '在线';
  if (status === 'degraded') return '降级';
  if (status === 'maintenance') return '维护';
  return '离线';
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export default function App() {
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [vms, setVms] = useState<VmItem[]>([]);
  const [hosts, setHosts] = useState<HostListResponse['hosts']>([]);
  const [auditEntries, setAuditEntries] = useState<Array<any>>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyVmIds, setBusyVmIds] = useState<Record<string, boolean>>({});
  const [busyHostIds, setBusyHostIds] = useState<Record<string, boolean>>({});
  const [hostDrafts, setHostDrafts] = useState<Record<string, HostDraft>>({});

  const loadData = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
    }
    setRefreshing(true);

    try {
      const [overviewData, vmData, hostData, auditData] = await Promise.all([
        api.getOverview(),
        api.listVms({ withState: true, limit: 200, offset: 0 }),
        api.listHosts(),
        api.listAudit(30),
      ]);

      setOverview(overviewData);
      setVms(vmData.vms);
      setHosts(hostData.hosts);
      setAuditEntries(auditData.entries);
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '数据加载失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData(false);
    const timer = window.setInterval(() => {
      loadData(true);
    }, 15000);

    return () => {
      window.clearInterval(timer);
    };
  }, [loadData]);

  useEffect(() => {
    setHostDrafts((previous) => {
      const next: Record<string, HostDraft> = {};
      for (const host of hosts) {
        const cached = previous[host.hostId];
        next[host.hostId] = {
          status: cached?.status ?? host.status,
          cpuCapacityCores: cached?.cpuCapacityCores ?? host.cpuCapacityCores,
          memoryCapacityGb: cached?.memoryCapacityGb ?? host.memoryCapacityGb,
          storageCapacityGb: cached?.storageCapacityGb ?? host.storageCapacityGb,
          notes: cached?.notes ?? host.notes ?? '',
        };
      }
      return next;
    });
  }, [hosts]);

  const vmPieData = useMemo(
    () => (overview?.vmStateDistribution ?? []).filter((item) => item.value > 0),
    [overview]
  );

  const handlePower = async (vm: VmItem, action: 'start' | 'stop') => {
    setBusyVmIds((prev) => ({ ...prev, [vm.vmId]: true }));

    try {
      await api.powerVm(vm.vmId, action);
      await loadData(true);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : `${action} 操作失败`);
    } finally {
      setBusyVmIds((prev) => ({ ...prev, [vm.vmId]: false }));
    }
  };

  const updateHostDraft = (
    hostId: string,
    key: keyof HostDraft,
    value: HostDraft[keyof HostDraft]
  ) => {
    setHostDrafts((prev) => ({
      ...prev,
      [hostId]: {
        ...prev[hostId],
        [key]: value,
      },
    }));
  };

  const handleSaveHost = async (hostId: string) => {
    const draft = hostDrafts[hostId];
    if (!draft) {
      return;
    }

    setBusyHostIds((prev) => ({ ...prev, [hostId]: true }));

    try {
      await api.updateHost(hostId, {
        status: draft.status,
        cpuCapacityCores: clampNumber(Math.round(draft.cpuCapacityCores), 8, 4096),
        memoryCapacityGb: clampNumber(Math.round(draft.memoryCapacityGb), 32, 65536),
        storageCapacityGb: clampNumber(Math.round(draft.storageCapacityGb), 200, 200000),
        notes: draft.notes,
      });
      await loadData(true);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '保存宿主机失败');
    } finally {
      setBusyHostIds((prev) => ({ ...prev, [hostId]: false }));
    }
  };

  const headlineUpdatedAt = overview ? formatDateTime(overview.updatedAt) : '-';

  return (
    <div className="page-shell">
      <div className="background-glow" aria-hidden="true" />
      <header className="top-header fade-in">
        <div>
          <p className="eyebrow">OneCeo KVM Control Center</p>
          <h1>KVM 后台管理系统</h1>
          <p className="subtitle">
            实时管理虚拟机生命周期、宿主机资源容量与操作审计。
          </p>
        </div>
        <div className="header-tools">
          <span className={`service-state ${overview?.orchestrator.online ? 'ok' : 'down'}`}>
            {overview?.orchestrator.online ? 'Orchestrator 在线' : 'Orchestrator 离线'}
          </span>
          <button
            type="button"
            className="primary-btn"
            onClick={() => loadData(true)}
            disabled={refreshing}
          >
            {refreshing ? '刷新中...' : '手动刷新'}
          </button>
          <p className="updated-at">最后更新: {headlineUpdatedAt}</p>
        </div>
      </header>

      {error ? (
        <section className="error-banner fade-in" role="alert">
          {error}
        </section>
      ) : null}

      {loading ? (
        <main className="loading-state">正在加载控制台数据...</main>
      ) : (
        <main className="content-stack">
          <section className="kpi-grid fade-in">
            <article className="kpi-card">
              <p className="kpi-title">运行中 VM</p>
              <p className="kpi-value">{overview?.vmSummary.running ?? 0}</p>
              <p className="kpi-meta">总计 {overview?.vmSummary.total ?? 0} 台</p>
            </article>
            <article className="kpi-card">
              <p className="kpi-title">宿主机在线率</p>
              <p className="kpi-value">
                {overview && overview.hostSummary.total > 0
                  ? `${Math.round((overview.hostSummary.online / overview.hostSummary.total) * 100)}%`
                  : '0%'}
              </p>
              <p className="kpi-meta">在线 {overview?.hostSummary.online ?? 0} / {overview?.hostSummary.total ?? 0}</p>
            </article>
            <article className="kpi-card">
              <p className="kpi-title">平均 CPU 负载</p>
              <p className="kpi-value">{overview?.hostSummary.averageCpuUsagePercent ?? 0}%</p>
              <p className="kpi-meta">宿主机维度聚合</p>
            </article>
            <article className="kpi-card">
              <p className="kpi-title">活跃会话</p>
              <p className="kpi-value">{overview?.sessionSummary.active ?? 0}</p>
              <p className="kpi-meta">ready {overview?.sessionSummary.ready ?? 0}</p>
            </article>
          </section>

          <section className="chart-grid fade-in">
            <article className="panel">
              <div className="panel-header">
                <h2>VM 状态分布</h2>
              </div>
              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie
                      data={vmPieData}
                      cx="50%"
                      cy="50%"
                      outerRadius={90}
                      innerRadius={55}
                      paddingAngle={2}
                      dataKey="value"
                      nameKey="label"
                    >
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
                <h2>宿主机资源负载</h2>
              </div>
              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={overview?.hostLoadSeries ?? []} margin={{ left: 0, right: 12 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#dde4ee" />
                    <XAxis dataKey="hostName" tick={{ fontSize: 11 }} interval={0} angle={-18} textAnchor="end" height={54} />
                    <YAxis domain={[0, 100]} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="cpuUsagePercent" name="CPU %" fill="#0f766e" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="memoryUsagePercent" name="Memory %" fill="#1d4ed8" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </article>

            <article className="panel">
              <div className="panel-header">
                <h2>会话状态分布</h2>
              </div>
              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={overview?.sessionStatusDistribution ?? []}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#dde4ee" />
                    <XAxis dataKey="label" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="value" name="会话数" fill="#0ea5a5" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </article>
          </section>

          <section className="panel fade-in">
            <div className="panel-header">
              <h2>VM 管理</h2>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>VM ID</th>
                    <th>状态</th>
                    <th>宿主机</th>
                    <th>CPU</th>
                    <th>内存</th>
                    <th>运行时长</th>
                    <th>CPU 使用率</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {vms.map((vm) => {
                    const vmBusy = Boolean(busyVmIds[vm.vmId]);
                    const canStart = vm.state !== 'running';
                    const canStop = vm.state === 'running';

                    return (
                      <tr key={vm.vmId}>
                        <td className="mono">{vm.vmId}</td>
                        <td>
                          <span className={stateClassName(vm.state)}>{vm.state}</span>
                        </td>
                        <td>{vm.hostName}</td>
                        <td>{vm.cpuCores}c</td>
                        <td>{Math.round(vm.memoryMb / 1024)} GB</td>
                        <td>{formatUptime(vm.stateInfo?.uptimeSeconds)}</td>
                        <td>{vm.stateInfo?.cpuUsagePercent ?? 0}%</td>
                        <td>
                          <div className="action-inline">
                            <button
                              type="button"
                              className="table-btn"
                              onClick={() => handlePower(vm, 'start')}
                              disabled={!canStart || vmBusy}
                            >
                              启动
                            </button>
                            <button
                              type="button"
                              className="table-btn danger"
                              onClick={() => handlePower(vm, 'stop')}
                              disabled={!canStop || vmBusy}
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
              <h2>宿主机状态管理</h2>
            </div>
            <div className="host-grid">
              {hosts.map((host) => {
                const draft = hostDrafts[host.hostId];
                const hostBusy = Boolean(busyHostIds[host.hostId]);
                return (
                  <article key={host.hostId} className="host-card">
                    <div className="host-head">
                      <div>
                        <h3>{host.name}</h3>
                        <p className="mono">{host.hostId}</p>
                      </div>
                      <span className="host-dot" style={{ backgroundColor: HOST_STATUS_COLORS[host.effectiveStatus] }}>
                        {statusLabel(host.effectiveStatus)}
                      </span>
                    </div>

                    <div className="usage-grid">
                      <div>
                        <p>CPU</p>
                        <strong>{host.cpuUsagePercent}%</strong>
                      </div>
                      <div>
                        <p>内存</p>
                        <strong>{host.memoryUsagePercent}%</strong>
                      </div>
                      <div>
                        <p>存储</p>
                        <strong>{host.storageUsagePercent}%</strong>
                      </div>
                    </div>

                    <label>
                      状态
                      <select
                        value={draft?.status ?? host.status}
                        onChange={(event) =>
                          updateHostDraft(host.hostId, 'status', event.target.value as HostStatus)
                        }
                      >
                        <option value="online">在线</option>
                        <option value="degraded">降级</option>
                        <option value="maintenance">维护</option>
                        <option value="offline">离线</option>
                      </select>
                    </label>

                    <div className="host-edit-grid">
                      <label>
                        CPU 容量
                        <input
                          type="number"
                          value={draft?.cpuCapacityCores ?? host.cpuCapacityCores}
                          onChange={(event) =>
                            updateHostDraft(host.hostId, 'cpuCapacityCores', Number(event.target.value))
                          }
                        />
                      </label>
                      <label>
                        内存容量 (GB)
                        <input
                          type="number"
                          value={draft?.memoryCapacityGb ?? host.memoryCapacityGb}
                          onChange={(event) =>
                            updateHostDraft(host.hostId, 'memoryCapacityGb', Number(event.target.value))
                          }
                        />
                      </label>
                      <label>
                        存储容量 (GB)
                        <input
                          type="number"
                          value={draft?.storageCapacityGb ?? host.storageCapacityGb}
                          onChange={(event) =>
                            updateHostDraft(host.hostId, 'storageCapacityGb', Number(event.target.value))
                          }
                        />
                      </label>
                    </div>

                    <label>
                      备注
                      <textarea
                        rows={2}
                        value={draft?.notes ?? host.notes ?? ''}
                        onChange={(event) => updateHostDraft(host.hostId, 'notes', event.target.value)}
                      />
                    </label>

                    <div className="host-card-footer">
                      <p>Heartbeat: {formatDateTime(host.lastHeartbeat)}</p>
                      <button
                        type="button"
                        className="secondary-btn"
                        disabled={hostBusy}
                        onClick={() => handleSaveHost(host.hostId)}
                      >
                        {hostBusy ? '保存中...' : '保存变更'}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="panel fade-in">
            <div className="panel-header">
              <h2>审计日志</h2>
            </div>
            <div className="audit-list">
              {auditEntries.length === 0 ? (
                <p className="empty">暂无审计日志</p>
              ) : (
                auditEntries.map((entry) => (
                  <article key={entry.id} className="audit-item">
                    <p>
                      <strong>{entry.action.toUpperCase()}</strong> {entry.targetVmId}{' '}
                      <span className={entry.result === 'success' ? 'ok-text' : 'error-text'}>
                        {entry.result}
                      </span>
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

          {overview && overview.alerts.length > 0 ? (
            <section className="panel fade-in">
              <div className="panel-header">
                <h2>运行告警</h2>
              </div>
              <ul className="alert-list">
                {overview.alerts.map((alert) => (
                  <li key={alert}>{alert}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </main>
      )}
    </div>
  );
}