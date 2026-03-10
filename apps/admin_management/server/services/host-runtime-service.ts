import { config } from '../config';
import type { KvmOrchestratorConnector } from '../connectors/kvm-orchestrator-connector';
import type { HostRuntime, HostStatus, KvmVmListItem, VmLifecycleState } from '../types';

type VmMetricDigest = {
  vmId: string;
  state: VmLifecycleState;
  vcpuCurrent: number;
  memoryActualMb: number;
  memoryRssMb: number;
  storageCapacityGb: number;
  storageUsedGb: number;
  cpuTimeNsTotal: number;
  collectedAtMs: number;
};

type CpuHistoryPoint = {
  cpuTimeNsTotal: number;
  collectedAtMs: number;
};

type HostIdentity = {
  hostId: string;
  name: string;
  managementIp: string;
};

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function clampPercent(value: number): number {
  return Number(Math.max(0, Math.min(100, value)).toFixed(1));
}

function bytesToGb(value: number): number {
  return Number((value / (1024 * 1024 * 1024)).toFixed(2));
}

function mbToGb(value: number): number {
  return Number((value / 1024).toFixed(2));
}

function sumByKeyPattern(stats: Record<string, number | string>, pattern: RegExp) {
  let total = 0;
  for (const [key, value] of Object.entries(stats)) {
    if (pattern.test(key)) {
      total += asNumber(value, 0);
    }
  }
  return total;
}

function toHostIdentity(orchestratorUrl: string): HostIdentity {
  const url = new URL(orchestratorUrl);
  const hostPart = url.hostname.replace(/[^a-zA-Z0-9]+/g, '-');
  const portPart = url.port ? `-${url.port}` : '';
  return {
    hostId: `orch-${hostPart}${portPart}`,
    name: `kvm-orchestrator (${url.hostname})`,
    managementIp: url.port ? `${url.hostname}:${url.port}` : url.hostname,
  };
}

function normalizeHostStatus(online: boolean, metricsAvailable: boolean, totalVms: number): HostStatus {
  if (!online) {
    return 'offline';
  }
  if (totalVms > 0 && !metricsAvailable) {
    return 'degraded';
  }
  return 'online';
}

export class HostRuntimeService {
  private cache:
    | {
        expiresAt: number;
        hosts: HostRuntime[];
      }
    | null = null;
  private readonly cpuHistory = new Map<string, CpuHistoryPoint>();

  constructor(private readonly connector: KvmOrchestratorConnector) {}

  private async collectMetricDigests(vms: KvmVmListItem[]): Promise<VmMetricDigest[]> {
    const targets = vms.filter((item) => item.state === 'running' || item.state === 'paused');
    if (targets.length === 0) {
      return [];
    }

    const concurrency = Math.min(config.hostMetricsConcurrency, targets.length);
    const output: VmMetricDigest[] = [];
    let cursor = 0;

    const workers = Array.from({ length: concurrency }, async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= targets.length) {
          return;
        }

        const vm = targets[index];
        const metrics = await this.connector.getVmMetrics(vm.vmId, { retries: 0 }).catch(() => null);
        if (!metrics) {
          continue;
        }

        const stats = metrics.stats || {};
        const cpuTimeNsTotal = sumByKeyPattern(stats, /^vcpu\.\d+\.time$/);
        const storageCapacityGb = bytesToGb(sumByKeyPattern(stats, /^block\.\d+\.capacity$/));
        const storageUsedGb = bytesToGb(sumByKeyPattern(stats, /^block\.\d+\.allocation$/));
        const collectedAtMs =
          metrics.collectedAt && Number.isFinite(Date.parse(metrics.collectedAt))
            ? Date.parse(metrics.collectedAt)
            : Date.now();

        output.push({
          vmId: vm.vmId,
          state: vm.state,
          vcpuCurrent: Math.max(0, asNumber(stats['vcpu.current'], 0)),
          memoryActualMb: Math.max(0, asNumber(metrics.memoryActualMb, 0)),
          memoryRssMb: Math.max(0, asNumber(metrics.memoryRssMb, 0)),
          storageCapacityGb: Math.max(0, storageCapacityGb),
          storageUsedGb: Math.max(0, storageUsedGb),
          cpuTimeNsTotal: Math.max(0, cpuTimeNsTotal),
          collectedAtMs,
        });
      }
    });

    await Promise.all(workers);
    return output;
  }

  private calculateUsedCpuCores(digests: VmMetricDigest[]) {
    let usedCpuCores = 0;
    const activeVmIds = new Set<string>();

    for (const item of digests) {
      activeVmIds.add(item.vmId);

      const previous = this.cpuHistory.get(item.vmId);
      let vmUsedCpuCores = 0;

      if (
        previous &&
        item.collectedAtMs > previous.collectedAtMs &&
        item.cpuTimeNsTotal >= previous.cpuTimeNsTotal
      ) {
        const deltaCpuTimeNs = item.cpuTimeNsTotal - previous.cpuTimeNsTotal;
        const deltaWallNs = (item.collectedAtMs - previous.collectedAtMs) * 1_000_000;
        if (deltaWallNs > 0) {
          vmUsedCpuCores = deltaCpuTimeNs / deltaWallNs;
        }
      }

      if (!Number.isFinite(vmUsedCpuCores) || vmUsedCpuCores <= 0) {
        vmUsedCpuCores = item.state === 'running' ? item.vcpuCurrent * 0.35 : item.vcpuCurrent * 0.1;
      }

      vmUsedCpuCores = Math.min(Math.max(vmUsedCpuCores, 0), item.vcpuCurrent);
      usedCpuCores += vmUsedCpuCores;

      this.cpuHistory.set(item.vmId, {
        cpuTimeNsTotal: item.cpuTimeNsTotal,
        collectedAtMs: item.collectedAtMs,
      });
    }

    for (const vmId of this.cpuHistory.keys()) {
      if (!activeVmIds.has(vmId)) {
        this.cpuHistory.delete(vmId);
      }
    }

    return Number(usedCpuCores.toFixed(2));
  }

  private toRuntimeHost(identity: HostIdentity, online: boolean, vms: KvmVmListItem[], digests: VmMetricDigest[]): HostRuntime {
    const nowIso = new Date().toISOString();
    const runningVmCount = vms.filter((item) => item.state === 'running').length;
    const totalVmCount = vms.length;

    const usedCpuCores = this.calculateUsedCpuCores(digests);
    const cpuCapacityCoresRaw = digests.reduce((sum, item) => sum + item.vcpuCurrent, 0);
    const memoryCapacityGbRaw = mbToGb(digests.reduce((sum, item) => sum + item.memoryActualMb, 0));
    const usedMemoryGb = Number(mbToGb(digests.reduce((sum, item) => sum + item.memoryRssMb, 0)).toFixed(2));
    const storageCapacityGbRaw = Number(
      digests.reduce((sum, item) => sum + item.storageCapacityGb, 0).toFixed(2)
    );
    const usedStorageGb = Number(digests.reduce((sum, item) => sum + item.storageUsedGb, 0).toFixed(2));

    const previousHost = this.cache?.hosts[0];
    const cpuCapacityCores = Number(Math.max(cpuCapacityCoresRaw, previousHost?.cpuCapacityCores || 0).toFixed(2));
    const memoryCapacityGb = Number(
      Math.max(memoryCapacityGbRaw, previousHost?.memoryCapacityGb || 0).toFixed(2)
    );
    const storageCapacityGb = Number(
      Math.max(storageCapacityGbRaw, previousHost?.storageCapacityGb || 0).toFixed(2)
    );

    const status = normalizeHostStatus(online, digests.length > 0 || totalVmCount === 0, totalVmCount);
    const cpuUsagePercent = cpuCapacityCores > 0 ? clampPercent((usedCpuCores / cpuCapacityCores) * 100) : 0;
    const memoryUsagePercent = memoryCapacityGb > 0 ? clampPercent((usedMemoryGb / memoryCapacityGb) * 100) : 0;
    const storageUsagePercent =
      storageCapacityGb > 0 ? clampPercent((usedStorageGb / storageCapacityGb) * 100) : 0;

    return {
      hostId: identity.hostId,
      name: identity.name,
      region: 'kvm-orchestrator',
      status,
      effectiveStatus: status,
      cpuCapacityCores,
      memoryCapacityGb,
      storageCapacityGb,
      hypervisor: 'KVM/libvirt',
      managementIp: identity.managementIp,
      lastHeartbeat: online ? nowIso : previousHost?.lastHeartbeat || nowIso,
      notes:
        digests.length > 0
          ? `实时聚合 ${digests.length} 台 VM 的 metrics`
          : totalVmCount > 0
            ? '当前 metrics 拉取受限，已使用最近可用容量数据'
            : '当前无 VM 运行',
      usedCpuCores,
      usedMemoryGb,
      usedStorageGb,
      cpuUsagePercent,
      memoryUsagePercent,
      storageUsagePercent,
      runningVmCount,
      totalVmCount,
    };
  }

  async listHosts() {
    const healthResult = await this.connector.health().catch(() => null);
    const online = Boolean(healthResult && healthResult.status.toLowerCase() === 'ok');
    const now = Date.now();

    if (this.cache && this.cache.expiresAt > now) {
      const cachedHosts = this.cache.hosts.map((item) => ({
        ...item,
        status: online ? item.status : 'offline',
        effectiveStatus: online ? item.effectiveStatus : 'offline',
      }));
      return {
        online,
        total: cachedHosts.length,
        hosts: cachedHosts,
      };
    }

    const identity = toHostIdentity(config.kvmOrchestratorUrl);
    const vmList = await this.connector
      .listVms({
        limit: 500,
        offset: 0,
      })
      .catch(() => ({
        total: 0,
        limit: 500,
        offset: 0,
        vms: [] as KvmVmListItem[],
      }));

    const digests = await this.collectMetricDigests(vmList.vms);
    const host = this.toRuntimeHost(identity, online, vmList.vms, digests);

    this.cache = {
      expiresAt: now + config.hostMetricsCacheMs,
      hosts: [host],
    };

    return {
      online,
      total: 1,
      hosts: [host],
    };
  }
}
