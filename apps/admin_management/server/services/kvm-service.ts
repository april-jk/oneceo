import { AppError } from '../utils/errors';
import type { KvmOrchestratorConnector } from '../connectors/kvm-orchestrator-connector';
import type { KvmVmListItem, KvmVmState, VmAction } from '../types';
type VmListResult = {
  total: number;
  limit: number;
  offset: number;
  vms: Array<KvmVmListItem & { stateInfo?: KvmVmState }>;
};

export class KvmService {
  constructor(private readonly connector: KvmOrchestratorConnector) {}

  async health() {
    return this.connector.health();
  }

  async listVms(options?: { state?: string; limit?: number; offset?: number; withState?: boolean }): Promise<VmListResult> {
    const limit = options?.limit ?? 200;
    const offset = options?.offset ?? 0;
    let listResult: VmListResult | null = null;
    try {
      listResult = await this.connector.listVms({
        state: options?.state,
        limit,
        offset,
        withState: options?.withState,
      });
    } catch (error) {
      console.warn('[admin-management][kvm] listVms failed', error);
      return {
        total: 0,
        limit,
        offset,
        vms: [],
      };
    }

    if (!options?.withState) {
      return listResult;
    }

    const vmsWithState = await Promise.all(
      listResult.vms.map(async (vm): Promise<KvmVmListItem & { stateInfo?: KvmVmState }> => {
        const detail = await this.connector.getVm(vm.vmId).catch(() => null);
        const stateInfo = await this.connector.getVmState(vm.vmId).catch(() => undefined);
        return {
          ...vm,
          sessionId: detail?.sessionId || vm.sessionId,
          cpuCores: detail?.config.cpuCores || vm.cpuCores,
          memoryMb: detail?.config.memoryMb || vm.memoryMb,
          createdAt: detail?.createdAt || vm.createdAt,
          stateInfo,
        };
      })
    );

    return {
      ...listResult,
      vms: vmsWithState,
    };
  }

  async createVm(input: {
    sessionId: string;
    cpuCores?: number;
    memoryMb?: number;
    rootDiskGb?: number;
    tags?: Record<string, string>;
  }) {
    return this.connector.createVm(input);
  }

  async runVmAction(
    vmId: string,
    action: VmAction,
    options?: { operator?: string; force?: boolean; async?: boolean; idempotencyKey?: string }
  ) {
    const operator = options?.operator || 'admin-ui';
    const vmMeta = await this.connector.getVm(vmId).catch(() => null);

    const result = await this.connector.runVmAction(vmId, action, {
      async: options?.async,
      idempotencyKey: options?.idempotencyKey,
    });

    return result;
  }

  async powerVm(vmId: string, action: 'start' | 'stop', operator = 'admin-ui', force = false) {
    return this.runVmAction(vmId, action === 'start' ? 'start' : 'shutdown', {
      operator,
      force,
      async: false,
    });
  }

  async getVmDetail(vmId: string) {
    const [vm, state, ip] = await Promise.all([
      this.connector.getVm(vmId),
      this.connector.getVmState(vmId).catch(() => undefined),
      this.connector.getVmIp(vmId).catch(() => undefined),
    ]);

    return {
      ...vm,
      stateInfo: state ?? vm.stateInfo,
      ipInfo: ip,
    };
  }

  async getVmIp(vmId: string, refresh?: boolean) {
    return this.connector.getVmIp(vmId, refresh);
  }

  async getVmMetrics(vmId: string) {
    return this.connector.getVmMetrics(vmId);
  }

  async getVmLogs(vmId: string, lines = 100) {
    return this.connector.getVmLogs(vmId, lines);
  }

  async getJob(jobId: string) {
    if (!jobId?.trim()) {
      throw new AppError(400, 'jobId 不能为空');
    }
    return this.connector.getJob(jobId);
  }

  async listSessions() {
    try {
      return await this.connector.listSessions({
        limit: 300,
        offset: 0,
      });
    } catch (error) {
      console.warn('[admin-management][kvm] listSessions failed', error);
      return {
        total: 0,
        offset: 0,
        limit: 300,
        sessions: [],
      };
    }
  }

  async createSession(body?: { metadata?: Record<string, unknown> }, idempotencyKey?: string) {
    return this.connector.createSession(body, idempotencyKey);
  }

  async getSession(sessionId: string) {
    if (!sessionId?.trim()) {
      throw new AppError(400, 'sessionId 不能为空');
    }
    return this.connector.getSession(sessionId);
  }

  async bindSession(sessionId: string, body: { vmName?: string; autoAllocate?: boolean }) {
    if (!sessionId?.trim()) {
      throw new AppError(400, 'sessionId 不能为空');
    }
    return this.connector.bindSessionVm(sessionId, body);
  }

  async getSessionVm(sessionId: string) {
    if (!sessionId?.trim()) {
      throw new AppError(400, 'sessionId 不能为空');
    }
    return this.connector.getSessionVm(sessionId);
  }

  async closeSession(sessionId: string, body?: { gracefulShutdown?: boolean }) {
    if (!sessionId?.trim()) {
      throw new AppError(400, 'sessionId 不能为空');
    }
    return this.connector.closeSession(sessionId, body);
  }

  async getQuota(sessionId: string) {
    if (!sessionId?.trim()) {
      throw new AppError(400, 'sessionId 不能为空');
    }
    return this.connector.getQuota(sessionId);
  }

  async updateQuota(
    sessionId: string,
    quota: {
      maxActionsPerMinute: number;
      maxRuntimeMinutes: number;
      maxRebootsPerHour: number;
    }
  ) {
    if (!sessionId?.trim()) {
      throw new AppError(400, 'sessionId 不能为空');
    }
    return this.connector.updateQuota(sessionId, quota);
  }

  async vmExec(vmId: string, body: Record<string, unknown>) {
    return this.connector.vmExec(vmId, body);
  }

  async sessionExec(sessionId: string, body: Record<string, unknown>) {
    return this.connector.sessionExec(sessionId, body);
  }

  async uploadVmFiles(
    vmId: string,
    bodyBuffer: Uint8Array,
    contentType: string,
    query?: Record<string, unknown>,
    idempotencyKey?: string
  ) {
    return this.connector.uploadVmFiles(vmId, bodyBuffer, contentType, query, idempotencyKey);
  }

  async uploadSessionFiles(
    sessionId: string,
    bodyBuffer: Uint8Array,
    contentType: string,
    query?: Record<string, unknown>,
    idempotencyKey?: string
  ) {
    return this.connector.uploadSessionFiles(sessionId, bodyBuffer, contentType, query, idempotencyKey);
  }

  async deleteVmFiles(vmId: string, query: Record<string, unknown>) {
    return this.connector.deleteVmFiles(vmId, query);
  }

  async deleteSessionFiles(sessionId: string, query: Record<string, unknown>) {
    return this.connector.deleteSessionFiles(sessionId, query);
  }

  async createSandbox(body: Record<string, unknown>, idempotencyKey?: string) {
    return this.connector.createSandbox(body, idempotencyKey);
  }

  async getSandbox(sessionId: string) {
    return this.connector.getSandbox(sessionId);
  }

  async getSandboxIp(sessionId: string, refresh?: boolean) {
    return this.connector.getSandboxIp(sessionId, refresh);
  }

  async restartSandbox(sessionId: string, body?: { gracefulShutdown?: boolean; start?: boolean }) {
    return this.connector.restartSandbox(sessionId, body);
  }

  async deleteSandbox(sessionId: string, query?: { deleteStorage?: boolean }) {
    return this.connector.deleteSandbox(sessionId, query);
  }

  async createSandboxPortMapping(sessionId: string, body: Record<string, unknown>) {
    return this.connector.createSandboxPortMapping(sessionId, body);
  }

  async listSandboxPortMappings(
    sessionId: string,
    query?: { refresh?: boolean; verify?: boolean; waitSeconds?: number }
  ) {
    return this.connector.listSandboxPortMappings(sessionId, query);
  }

  async deleteSandboxPortMapping(
    sessionId: string,
    query: { hostPort: number; protocol?: string; hostIp?: string; vmPort?: number }
  ) {
    return this.connector.deleteSandboxPortMapping(sessionId, query);
  }

  async listVmSnapshots(vmId: string) {
    return this.connector.listVmSnapshots(vmId);
  }

  async createVmSnapshot(vmId: string, body: { snapshotName: string; description?: string }) {
    return this.connector.createVmSnapshot(vmId, body);
  }

  async restoreVmSnapshot(vmId: string, snapshotName: string, body?: { targetState?: string }) {
    return this.connector.restoreVmSnapshot(vmId, snapshotName, body);
  }

  async deleteVmSnapshot(vmId: string, snapshotName: string) {
    return this.connector.deleteVmSnapshot(vmId, snapshotName);
  }

  getEventsWsUrl(replayLast?: number) {
    return {
      url: this.connector.getEventsWsUrl(replayLast),
      replayLast: replayLast ?? 20,
    };
  }
}
