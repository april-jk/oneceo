import { randomUUID } from 'crypto';
import { store } from '../store';
import type {
  QuotaRecord,
  SessionEvent,
  SessionRecord,
  SessionStatus,
  SnapshotRecord,
  VmRecord,
  VmLifecycleState,
} from '../types';
import { ApiError } from '../utils/response';
import type { KvmAdapter } from '../adapters/kvm-adapter';

const DEFAULT_CPU = 4;
const DEFAULT_MEMORY_MB = 4096;
const DEFAULT_DISK_GB = 20;
const DEFAULT_BRIDGE = 'virbr0';

function nowIso(): string {
  return new Date().toISOString();
}

function buildMacAddress(): string {
  const bytes = Array.from({ length: 3 }, () => Math.floor(Math.random() * 255));
  return `52:54:00:${bytes.map((n) => n.toString(16).padStart(2, '0')).join(':')}`;
}

export class KvmOrchestratorService {
  constructor(private readonly adapter: KvmAdapter) {}

  private appendEvent(events: SessionEvent[], sessionId: string, type: string, details?: Record<string, unknown>) {
    events.push({
      eventId: `evt-${randomUUID()}`,
      sessionId,
      type,
      timestamp: nowIso(),
      details,
    });
  }

  async createVm(input: {
    sessionId: string;
    cpuCores?: number;
    memoryMb?: number;
    rootDiskGb?: number;
    tags?: Record<string, string>;
  }): Promise<VmRecord> {
    if (!input.sessionId?.trim()) {
      throw new ApiError(400, 'INVALID_PARAMETER', 'session_id is required', 'session_id');
    }

    return store.mutate(async (draft) => {
      const existing = draft.vms.find((vm) => vm.sessionId === input.sessionId);
      if (existing) {
        throw new ApiError(409, 'CONFLICT', 'Session already bound to a VM');
      }

      const vmId = `vm-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
      const vm: VmRecord = {
        vmId,
        sessionId: input.sessionId,
        name: vmId,
        cpuCores: input.cpuCores || DEFAULT_CPU,
        memoryMb: input.memoryMb || DEFAULT_MEMORY_MB,
        rootDiskGb: input.rootDiskGb || DEFAULT_DISK_GB,
        networkBridge: DEFAULT_BRIDGE,
        macAddress: buildMacAddress(),
        state: 'stopped',
        createdAt: nowIso(),
        updatedAt: nowIso(),
        tags: input.tags,
        snapshots: [],
        logs: [`[${nowIso()}] VM created`],
      };

      await this.adapter.createVm(vm);
      draft.vms.push(vm);

      const session = draft.sessions.find((item) => item.sessionId === input.sessionId);
      if (session) {
        session.vmId = vm.vmId;
        session.updatedAt = nowIso();
      }

      this.appendEvent(draft.events, input.sessionId, 'vm_created', { vmId });
      return vm;
    });
  }

  async startVm(vmId: string, _waitReady: boolean): Promise<VmRecord> {
    return store.mutate(async (draft) => {
      const vm = draft.vms.find((item) => item.vmId === vmId);
      if (!vm) {
        throw new ApiError(404, 'NOT_FOUND', 'VM not found');
      }
      const state = await this.adapter.startVm(vm);
      vm.state = state.state;
      vm.ipAddress = state.ipAddress || vm.ipAddress;
      vm.startedAt = nowIso();
      vm.updatedAt = nowIso();
      vm.logs.push(`[${nowIso()}] VM started`);
      this.appendEvent(draft.events, vm.sessionId, 'vm_started', { vmId: vm.vmId, ipAddress: vm.ipAddress });

      const session = draft.sessions.find((item) => item.sessionId === vm.sessionId);
      if (session) {
        session.status = 'ready';
        session.lastActivity = nowIso();
        session.updatedAt = nowIso();
      }

      return vm;
    });
  }

  async stopVm(vmId: string, force: boolean): Promise<VmRecord> {
    return store.mutate(async (draft) => {
      const vm = draft.vms.find((item) => item.vmId === vmId);
      if (!vm) {
        throw new ApiError(404, 'NOT_FOUND', 'VM not found');
      }
      const state = await this.adapter.stopVm(vm, force);
      vm.state = state.state;
      vm.stoppedAt = nowIso();
      vm.updatedAt = nowIso();
      vm.logs.push(`[${nowIso()}] VM stopped`);
      this.appendEvent(draft.events, vm.sessionId, 'vm_stopped', { vmId: vm.vmId });
      return vm;
    });
  }

  async deleteVm(vmId: string, cleanupStorage: boolean): Promise<{ vmId: string; storageFreedGb: number }> {
    return store.mutate(async (draft) => {
      const idx = draft.vms.findIndex((item) => item.vmId === vmId);
      if (idx === -1) {
        throw new ApiError(404, 'NOT_FOUND', 'VM not found');
      }
      const vm = draft.vms[idx];
      await this.adapter.deleteVm(vm);
      draft.vms.splice(idx, 1);
      this.appendEvent(draft.events, vm.sessionId, 'vm_deleted', { vmId, cleanupStorage });
      return {
        vmId,
        storageFreedGb: cleanupStorage ? vm.rootDiskGb : 0,
      };
    });
  }

  async resizeVm(vmId: string, next: { cpuCores?: number; memoryMb?: number; rootDiskGb?: number }) {
    return store.mutate(async (draft) => {
      const vm = draft.vms.find((item) => item.vmId === vmId);
      if (!vm) {
        throw new ApiError(404, 'NOT_FOUND', 'VM not found');
      }
      await this.adapter.resizeVm(vm, next);
      vm.cpuCores = next.cpuCores || vm.cpuCores;
      vm.memoryMb = next.memoryMb || vm.memoryMb;
      vm.rootDiskGb = next.rootDiskGb || vm.rootDiskGb;
      vm.updatedAt = nowIso();
      vm.logs.push(`[${nowIso()}] VM resized`);
      this.appendEvent(draft.events, vm.sessionId, 'vm_resized', {
        vmId,
        cpuCores: vm.cpuCores,
        memoryMb: vm.memoryMb,
        rootDiskGb: vm.rootDiskGb,
      });
      return vm;
    });
  }

  async createSnapshot(vmId: string, name: string, description?: string): Promise<SnapshotRecord> {
    return store.mutate(async (draft) => {
      const vm = draft.vms.find((item) => item.vmId === vmId);
      if (!vm) throw new ApiError(404, 'NOT_FOUND', 'VM not found');
      const snapshot: SnapshotRecord = {
        snapshotId: `snap-${randomUUID().replace(/-/g, '').slice(0, 10)}`,
        vmId,
        name,
        description,
        createdAt: nowIso(),
        sizeGb: Number((Math.random() * 3 + 0.5).toFixed(1)),
      };
      vm.snapshots.push(snapshot);
      vm.updatedAt = nowIso();
      vm.logs.push(`[${nowIso()}] Snapshot ${name} created`);
      this.appendEvent(draft.events, vm.sessionId, 'snapshot_created', { vmId, snapshotId: snapshot.snapshotId });
      return snapshot;
    });
  }

  async restoreSnapshot(vmId: string, snapshotId: string): Promise<void> {
    await store.mutate(async (draft) => {
      const vm = draft.vms.find((item) => item.vmId === vmId);
      if (!vm) throw new ApiError(404, 'NOT_FOUND', 'VM not found');
      const snapshot = vm.snapshots.find((item) => item.snapshotId === snapshotId);
      if (!snapshot) throw new ApiError(404, 'NOT_FOUND', 'Snapshot not found');
      vm.updatedAt = nowIso();
      vm.logs.push(`[${nowIso()}] Snapshot ${snapshot.name} restored`);
      this.appendEvent(draft.events, vm.sessionId, 'snapshot_restored', { vmId, snapshotId });
    });
  }

  async deleteSnapshot(vmId: string, snapshotId: string): Promise<SnapshotRecord> {
    return store.mutate(async (draft) => {
      const vm = draft.vms.find((item) => item.vmId === vmId);
      if (!vm) throw new ApiError(404, 'NOT_FOUND', 'VM not found');
      const idx = vm.snapshots.findIndex((item) => item.snapshotId === snapshotId);
      if (idx === -1) throw new ApiError(404, 'NOT_FOUND', 'Snapshot not found');
      const snapshot = vm.snapshots[idx];
      vm.snapshots.splice(idx, 1);
      vm.updatedAt = nowIso();
      vm.logs.push(`[${nowIso()}] Snapshot ${snapshot.name} deleted`);
      this.appendEvent(draft.events, vm.sessionId, 'snapshot_deleted', { vmId, snapshotId });
      return snapshot;
    });
  }

  async getVm(vmId: string): Promise<VmRecord> {
    const data = await store.read();
    const vm = data.vms.find((item) => item.vmId === vmId);
    if (!vm) throw new ApiError(404, 'NOT_FOUND', 'VM not found');
    return vm;
  }

  async listVms(filters: { state?: VmLifecycleState; sessionId?: string; limit: number; offset: number }) {
    const data = await store.read();
    let list = data.vms;
    if (filters.state) list = list.filter((item) => item.state === filters.state);
    if (filters.sessionId) list = list.filter((item) => item.sessionId === filters.sessionId);

    return {
      total: list.length,
      limit: filters.limit,
      offset: filters.offset,
      vms: list.slice(filters.offset, filters.offset + filters.limit),
    };
  }

  async getVmState(vmId: string) {
    const vm = await this.getVm(vmId);
    return {
      vmId,
      state: vm.state,
      uptimeSeconds: vm.startedAt ? Math.max(0, Math.floor((Date.now() - Date.parse(vm.startedAt)) / 1000)) : 0,
      cpuUsagePercent: Number((Math.random() * 35).toFixed(1)),
      memoryUsageMb: Math.floor(vm.memoryMb * (0.15 + Math.random() * 0.6)),
      diskUsageGb: Number((vm.rootDiskGb * (0.05 + Math.random() * 0.3)).toFixed(2)),
      network: {
        inBytes: Math.floor(Math.random() * 5_000_000),
        outBytes: Math.floor(Math.random() * 3_000_000),
      },
      lastUpdate: nowIso(),
    };
  }

  async getVmLogs(vmId: string, lines: number) {
    const vm = await this.getVm(vmId);
    const slice = vm.logs.slice(Math.max(0, vm.logs.length - lines));
    return { vmId, logs: slice };
  }

  async createSession(input: {
    userId: string;
    projectId?: string;
    agentType?: string;
    config?: { timeoutMinutes?: number };
    resourceQuota?: { cpuCores?: number; memoryMb?: number; storageGb?: number };
    tags?: Record<string, string>;
  }) {
    if (!input.userId?.trim()) {
      throw new ApiError(400, 'INVALID_PARAMETER', 'user_id is required', 'user_id');
    }

    return store.mutate(async (draft) => {
      const sessionId = `session-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
      const now = nowIso();
      const session: SessionRecord = {
        sessionId,
        userId: input.userId,
        projectId: input.projectId,
        agentId: `agent-${randomUUID().replace(/-/g, '').slice(0, 8)}`,
        agentType: input.agentType || 'build',
        status: 'initializing',
        createdAt: now,
        updatedAt: now,
        lastActivity: now,
        expiresAt: input.config?.timeoutMinutes
          ? new Date(Date.now() + input.config.timeoutMinutes * 60_000).toISOString()
          : undefined,
        tags: input.tags,
      };
      draft.sessions.push(session);

      const quota: QuotaRecord = {
        sessionId,
        cpuCores: input.resourceQuota?.cpuCores || DEFAULT_CPU,
        maxCpuCores: Math.max(input.resourceQuota?.cpuCores || DEFAULT_CPU, 8),
        memoryMb: input.resourceQuota?.memoryMb || DEFAULT_MEMORY_MB,
        maxMemoryMb: Math.max(input.resourceQuota?.memoryMb || DEFAULT_MEMORY_MB, 8192),
        storageGb: input.resourceQuota?.storageGb || DEFAULT_DISK_GB,
        maxStorageGb: Math.max(input.resourceQuota?.storageGb || DEFAULT_DISK_GB, 100),
        bandwidthMbps: 100,
        createdAt: now,
        updatedAt: now,
      };
      draft.quotas.push(quota);

      this.appendEvent(draft.events, sessionId, 'session_created', {
        userId: input.userId,
        projectId: input.projectId,
      });

      return session;
    });
  }

  async getSession(sessionId: string) {
    const data = await store.read();
    const session = data.sessions.find((item) => item.sessionId === sessionId);
    if (!session) throw new ApiError(404, 'NOT_FOUND', 'Session not found');
    return session;
  }

  async listSessions(filters: { userId?: string; projectId?: string; status?: SessionStatus; limit: number; offset: number }) {
    const data = await store.read();
    let list = data.sessions;
    if (filters.userId) list = list.filter((item) => item.userId === filters.userId);
    if (filters.projectId) list = list.filter((item) => item.projectId === filters.projectId);
    if (filters.status) list = list.filter((item) => item.status === filters.status);

    return {
      total: list.length,
      limit: filters.limit,
      offset: filters.offset,
      sessions: list.slice(filters.offset, filters.offset + filters.limit),
    };
  }

  async updateSession(sessionId: string, input: { config?: { timeoutMinutes?: number }; tags?: Record<string, string> }) {
    return store.mutate(async (draft) => {
      const session = draft.sessions.find((item) => item.sessionId === sessionId);
      if (!session) throw new ApiError(404, 'NOT_FOUND', 'Session not found');

      if (input.config?.timeoutMinutes) {
        session.expiresAt = new Date(Date.now() + input.config.timeoutMinutes * 60_000).toISOString();
      }
      if (input.tags) {
        session.tags = {
          ...(session.tags || {}),
          ...input.tags,
        };
      }

      session.updatedAt = nowIso();
      this.appendEvent(draft.events, sessionId, 'session_updated');
      return session;
    });
  }

  async closeSession(sessionId: string) {
    return store.mutate(async (draft) => {
      const session = draft.sessions.find((item) => item.sessionId === sessionId);
      if (!session) throw new ApiError(404, 'NOT_FOUND', 'Session not found');

      session.status = 'terminated';
      session.updatedAt = nowIso();
      session.lastActivity = nowIso();

      const vm = draft.vms.find((item) => item.sessionId === sessionId);
      if (vm) {
        vm.state = 'stopped';
        vm.stoppedAt = nowIso();
        vm.updatedAt = nowIso();
      }

      this.appendEvent(draft.events, sessionId, 'session_closed', { vmId: vm?.vmId });
      return { session, vm };
    });
  }

  async bindKvm(sessionId: string, vmId: string) {
    return store.mutate(async (draft) => {
      const session = draft.sessions.find((item) => item.sessionId === sessionId);
      if (!session) throw new ApiError(404, 'NOT_FOUND', 'Session not found');

      const vm = draft.vms.find((item) => item.vmId === vmId);
      if (!vm) throw new ApiError(404, 'NOT_FOUND', 'VM not found');

      session.vmId = vmId;
      session.status = 'ready';
      session.updatedAt = nowIso();
      vm.sessionId = sessionId;
      vm.updatedAt = nowIso();

      this.appendEvent(draft.events, sessionId, 'kvm_bound', { vmId });
      return {
        bindingId: `binding-${randomUUID().replace(/-/g, '').slice(0, 10)}`,
        sessionId,
        vmId,
        agentId: session.agentId,
        status: session.status,
        boundAt: nowIso(),
      };
    });
  }

  async unbindKvm(sessionId: string) {
    return store.mutate(async (draft) => {
      const session = draft.sessions.find((item) => item.sessionId === sessionId);
      if (!session) throw new ApiError(404, 'NOT_FOUND', 'Session not found');

      const vmId = session.vmId;
      session.vmId = undefined;
      session.updatedAt = nowIso();
      this.appendEvent(draft.events, sessionId, 'kvm_unbound', { vmId });
      return { sessionId, vmId, unboundAt: nowIso() };
    });
  }

  async getBinding(sessionId: string) {
    const data = await store.read();
    const session = data.sessions.find((item) => item.sessionId === sessionId);
    if (!session) throw new ApiError(404, 'NOT_FOUND', 'Session not found');
    if (!session.vmId) throw new ApiError(404, 'NOT_FOUND', 'Binding not found');
    const vm = data.vms.find((item) => item.vmId === session.vmId);
    if (!vm) throw new ApiError(404, 'NOT_FOUND', 'VM not found');

    return {
      bindingId: `binding-${session.sessionId}`,
      sessionId,
      vmId: vm.vmId,
      agentId: session.agentId,
      status: session.status,
      boundAt: session.updatedAt,
      vmInfo: {
        state: vm.state,
        ipAddress: vm.ipAddress,
        cpuUsage: Number((Math.random() * 25).toFixed(1)),
        memoryUsageMb: Math.floor(vm.memoryMb * (0.15 + Math.random() * 0.5)),
      },
    };
  }

  async recoverSession(sessionId: string) {
    return store.mutate(async (draft) => {
      const session = draft.sessions.find((item) => item.sessionId === sessionId);
      if (!session) throw new ApiError(404, 'NOT_FOUND', 'Session not found');
      session.status = 'ready';
      session.updatedAt = nowIso();
      this.appendEvent(draft.events, sessionId, 'session_recovered');
      return {
        sessionId,
        recoveredAt: nowIso(),
        recoveryType: 'agent_reconnect',
        dataPreserved: true,
      };
    });
  }

  async getQuota(sessionId: string) {
    const data = await store.read();
    const quota = data.quotas.find((item) => item.sessionId === sessionId);
    if (!quota) throw new ApiError(404, 'NOT_FOUND', 'Quota not found');

    return {
      sessionId,
      quota: {
        cpu: {
          allocated: quota.cpuCores,
          used: Number((Math.random() * quota.cpuCores).toFixed(1)),
          percent: Number((Math.random() * 100).toFixed(1)),
        },
        memory: {
          allocatedMb: quota.memoryMb,
          usedMb: Math.floor(quota.memoryMb * (0.2 + Math.random() * 0.6)),
          percent: Number((20 + Math.random() * 70).toFixed(1)),
        },
        storage: {
          allocatedGb: quota.storageGb,
          usedGb: Number((quota.storageGb * (0.08 + Math.random() * 0.4)).toFixed(1)),
          percent: Number((8 + Math.random() * 40).toFixed(1)),
        },
      },
    };
  }

  async updateQuota(sessionId: string, input: { cpuCores?: number; memoryMb?: number; storageGb?: number }) {
    return store.mutate(async (draft) => {
      const quota = draft.quotas.find((item) => item.sessionId === sessionId);
      if (!quota) throw new ApiError(404, 'NOT_FOUND', 'Quota not found');

      if (input.cpuCores) quota.cpuCores = input.cpuCores;
      if (input.memoryMb) quota.memoryMb = input.memoryMb;
      if (input.storageGb) quota.storageGb = input.storageGb;
      quota.updatedAt = nowIso();

      this.appendEvent(draft.events, sessionId, 'quota_updated', input as Record<string, unknown>);
      return quota;
    });
  }

  async getSessionEvents(sessionId: string, limit: number) {
    const data = await store.read();
    const events = data.events.filter((item) => item.sessionId === sessionId);
    return events.slice(Math.max(0, events.length - limit));
  }
}
