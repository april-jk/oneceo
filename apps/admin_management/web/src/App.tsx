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
import type { DashboardOverview, HostListResponse, VmItem } from './types';

const VM_STATE_COLORS: Record<string, string> = {
  running: '#059669',
  stopped: '#9ca3af',
  paused: '#f59e0b',
  error: '#dc2626',
};

function formatDateTime(value?: string) {
  if (!value) {
    return '-';
  }
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function stateClassName(state: string) {
  return `status-pill status-${state}`;
}

function formatNumber(value: number | undefined | null, suffix = '') {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return '-';
  }
  return `${value}${suffix}`;
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

  const loadData = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
    }
    setRefreshing(true);

    try {
      const [overviewData, vmData, hostData, auditData] = await Promise.all([
        api.getOverview(),
        api.listVms({ withState: false, limit: 200, offset: 0 }),
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

  const headlineUpdatedAt = overview ? formatDateTime(overview.updatedAt) : '-';

  return (
    <div className="page-shell">
      <div className="background-glow" aria-hidden="true" />
      <header className="top-header fade-in">
        <div>
          <p className="eyebrow">OneCeo KVM Control Center</p>
          <h1>KVM 后台管理系统</h1>
          <p className="subtitle">仅展示并操作来自 kvm-orchestrator 的实时数据，不使用本地 mock 数据。</p>
        </div>
        <div className="header-tools">
          <span className={`service-state ${overview?.orchestrator.online ? 'ok' : 'down'}`}>
            {overview?.orchestrator.online ? 'Orchestrator 在线' : 'Orchestrator 离线'}
          </span>
          <button type="button" className="primary-btn" onClick={() => loadData(true)} disabled={refreshing}>
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
              <p className="kpi-title">停止 VM</p>
              <p className="kpi-value">{overview?.vmSummary.stopped ?? 0}</p>
              <p className="kpi-meta">来自 /v1/vms</p>
            </article>
            <article className="kpi-card">
              <p className="kpi-title">异常 VM</p>
              <p className="kpi-value">{overview?.vmSummary.error ?? 0}</p>
              <p className="kpi-meta">状态为 error</p>
            </article>
            <article className="kpi-card">
              <p className="kpi-title">会话统计</p>
              <p className="kpi-value">{overview?.sessionSummary.total ?? 0}</p>
              <p className="kpi-meta">上游未提供列表时为 0</p>
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
                    <th>Session</th>
                    <th>CPU</th>
                    <th>内存</th>
                    <th>最后更新时间</th>
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
                        <td className="mono">{vm.sessionId || '-'}</td>
                        <td>{formatNumber(vm.cpuCores, 'c')}</td>
                        <td>
                          {vm.memoryMb !== undefined && vm.memoryMb !== null
                            ? `${Math.round(vm.memoryMb / 1024)} GB`
                            : '-'}
                        </td>
                        <td>{formatDateTime(vm.createdAt)}</td>
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
              <h2>宿主机管理（保留位置）</h2>
            </div>
            {hosts.length === 0 ? (
              <p className="empty">
                当前未从 kvm-orchestrator 获取到宿主机列表数据，已移除本地 mock 预置数据。
              </p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Host ID</th>
                      <th>名称</th>
                      <th>状态</th>
                      <th>CPU%</th>
                      <th>内存%</th>
                      <th>存储%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hosts.map((host) => (
                      <tr key={host.hostId}>
                        <td className="mono">{host.hostId}</td>
                        <td>{host.name}</td>
                        <td>{host.effectiveStatus}</td>
                        <td>{host.cpuUsagePercent}</td>
                        <td>{host.memoryUsagePercent}</td>
                        <td>{host.storageUsagePercent}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
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
