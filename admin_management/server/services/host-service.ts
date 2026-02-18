import { promises as fs } from 'fs';
import path from 'path';
import { AppError } from '../utils/errors';
import type { HostRecord, HostRuntime, HostStatus, KvmVmListItem, VmAnnotated } from '../types';

const HOSTS_FILE_PATH = path.resolve(process.cwd(), 'data', 'hosts.json');

function clampPercent(value: number): number {
  return Number(Math.max(0, Math.min(100, value)).toFixed(1));
}

function hashText(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function normalizeStatus(status: HostStatus, orchestratorOnline: boolean): HostStatus {
  if (status === 'maintenance' || status === 'offline') {
    return status;
  }

  if (!orchestratorOnline) {
    return 'degraded';
  }

  return status;
}

const editableKeys = new Set([
  'name',
  'region',
  'status',
  'cpuCapacityCores',
  'memoryCapacityGb',
  'storageCapacityGb',
  'hypervisor',
  'managementIp',
  'notes',
]);

export class HostService {
  private async readHosts(): Promise<HostRecord[]> {
    try {
      const raw = await fs.readFile(HOSTS_FILE_PATH, 'utf8');
      const parsed = JSON.parse(raw) as HostRecord[];
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && (error as any).code === 'ENOENT') {
        await fs.mkdir(path.dirname(HOSTS_FILE_PATH), { recursive: true });
        await fs.writeFile(HOSTS_FILE_PATH, '[]\n', 'utf8');
        return [];
      }

      throw new AppError(500, '无法读取宿主机配置', {
        cause: error instanceof Error ? error.message : error,
      });
    }
  }

  private async writeHosts(hosts: HostRecord[]) {
    await fs.writeFile(HOSTS_FILE_PATH, `${JSON.stringify(hosts, null, 2)}\n`, 'utf8');
  }

  async listHosts() {
    return this.readHosts();
  }

  async updateHost(hostId: string, patch: Partial<HostRecord>) {
    const hosts = await this.readHosts();
    const index = hosts.findIndex((host) => host.hostId === hostId);

    if (index < 0) {
      throw new AppError(404, '宿主机不存在');
    }

    const normalizedPatch: Partial<HostRecord> = {};
    for (const [key, value] of Object.entries(patch) as Array<[keyof HostRecord, HostRecord[keyof HostRecord]]>) {
      if (!editableKeys.has(key)) {
        continue;
      }
      if (value === undefined) {
        continue;
      }
      (normalizedPatch as any)[key] = value;
    }

    const next: HostRecord = {
      ...hosts[index],
      ...normalizedPatch,
      lastHeartbeat:
        normalizedPatch.status && normalizedPatch.status !== 'offline'
          ? new Date().toISOString()
          : hosts[index].lastHeartbeat,
    };

    hosts[index] = next;
    await this.writeHosts(hosts);
    return next;
  }

  private pickHostForVm(vmId: string, hosts: HostRecord[]): HostRecord | null {
    if (hosts.length === 0) {
      return null;
    }

    const index = hashText(vmId) % hosts.length;
    return hosts[index] ?? null;
  }

  async annotateVms(vms: KvmVmListItem[]): Promise<VmAnnotated[]> {
    const hosts = await this.readHosts();

    return vms.map((vm) => {
      const host = this.pickHostForVm(vm.vmId, hosts);
      return {
        ...vm,
        hostId: host?.hostId ?? 'unassigned',
        hostName: host?.name ?? 'Unassigned Host',
      };
    });
  }

  async buildHostRuntime(vms: KvmVmListItem[], orchestratorOnline: boolean): Promise<HostRuntime[]> {
    const hosts = await this.readHosts();

    const runtime = new Map<string, HostRuntime>(
      hosts.map((host) => [
        host.hostId,
        {
          ...host,
          effectiveStatus: normalizeStatus(host.status, orchestratorOnline),
          usedCpuCores: 0,
          usedMemoryGb: 0,
          usedStorageGb: 0,
          cpuUsagePercent: 0,
          memoryUsagePercent: 0,
          storageUsagePercent: 0,
          runningVmCount: 0,
          totalVmCount: 0,
        },
      ])
    );

    for (const vm of vms) {
      const host = this.pickHostForVm(vm.vmId, hosts);
      if (!host) {
        continue;
      }

      const item = runtime.get(host.hostId);
      if (!item) {
        continue;
      }

      const vmWeight = vm.state === 'running' ? 1 : vm.state === 'paused' ? 0.45 : 0.15;
      item.totalVmCount += 1;
      item.runningVmCount += vm.state === 'running' ? 1 : 0;
      item.usedCpuCores += vm.cpuCores * vmWeight;
      item.usedMemoryGb += (vm.memoryMb / 1024) * vmWeight;
      item.usedStorageGb += Math.max(8, vm.cpuCores * 4) * vmWeight;
    }

    for (const value of runtime.values()) {
      value.usedCpuCores = Number(value.usedCpuCores.toFixed(1));
      value.usedMemoryGb = Number(value.usedMemoryGb.toFixed(1));
      value.usedStorageGb = Number(value.usedStorageGb.toFixed(1));
      value.cpuUsagePercent = clampPercent((value.usedCpuCores / value.cpuCapacityCores) * 100);
      value.memoryUsagePercent = clampPercent((value.usedMemoryGb / value.memoryCapacityGb) * 100);
      value.storageUsagePercent = clampPercent((value.usedStorageGb / value.storageCapacityGb) * 100);

      if (value.effectiveStatus !== 'offline') {
        value.lastHeartbeat = new Date().toISOString();
      }
    }

    return Array.from(runtime.values());
  }
}