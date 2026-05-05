import type { KvmOrchestratorConnector } from '../connectors/kvm-orchestrator-connector';
import type { DashboardOverview } from '../types';

function buildDistribution(input: string[]): Array<{ label: string; value: number }> {
  const bucket = new Map<string, number>();
  for (const label of input) {
    bucket.set(label, (bucket.get(label) || 0) + 1);
  }
  return Array.from(bucket.entries()).map(([label, value]) => ({ label, value }));
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sum = values.reduce((acc, item) => acc + item, 0);
  return Number((sum / values.length).toFixed(1));
}

export class DashboardService {
  constructor(private readonly connector: KvmOrchestratorConnector) {}

  async getOverview(): Promise<DashboardOverview> {
    const [healthResult, vmResult, sessionResult] = await Promise.allSettled([
      this.connector.health(),
      this.connector.listVms({ limit: 300, offset: 0 }),
      this.connector.listSessions({ limit: 300, offset: 0 }),
    ]);

    const orchestratorOnline =
      healthResult.status === 'fulfilled' && healthResult.value.status.toLowerCase() === 'ok';

    const vms = vmResult.status === 'fulfilled' ? vmResult.value.vms : [];
    const sessions = sessionResult.status === 'fulfilled' ? sessionResult.value.sessions : [];

    const vmSummary = {
      total: vms.length,
      running: vms.filter((item) => item.state === 'running').length,
      stopped: vms.filter((item) => item.state === 'stopped').length,
      paused: vms.filter((item) => item.state === 'paused').length,
      error: vms.filter((item) => item.state === 'error').length,
    };

    const sessionSummary = {
      total: sessions.length,
      ready: sessions.filter((item) => item.status === 'ready').length,
      active: sessions.filter((item) => item.status === 'active').length,
      terminating: sessions.filter((item) => item.status === 'terminating').length,
      terminated: sessions.filter((item) => item.status === 'terminated').length,
    };

    const hostSummary = {
      total: 0,
      online: 0,
      degraded: 0,
      maintenance: 0,
      offline: 0,
      averageCpuUsagePercent: 0,
      averageMemoryUsagePercent: 0,
    };

    const alerts: string[] = [];
    if (!orchestratorOnline) {
      alerts.push('kvm-orchestrator 当前离线，数据已回退为缓存/本地配置');
    }

    if (vmSummary.error > 0) {
      alerts.push(`发现 ${vmSummary.error} 台处于 error 状态的 VM，建议优先处理`);
    }

    return {
      updatedAt: new Date().toISOString(),
      orchestrator: {
        online: orchestratorOnline,
        service: healthResult.status === 'fulfilled' ? healthResult.value.service : 'kvm-orchestrator',
        message: orchestratorOnline ? '连接正常' : '连接异常',
      },
      vmSummary,
      sessionSummary,
      hostSummary,
      vmStateDistribution: buildDistribution(vms.map((item) => item.state)),
      sessionStatusDistribution: buildDistribution(sessions.map((item) => item.status)),
      hostLoadSeries: [],
      alerts,
    };
  }
}
