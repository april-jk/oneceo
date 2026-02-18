import { AppError } from '../utils/errors';
import type { KvmOrchestratorConnector } from '../connectors/kvm-orchestrator-connector';
import type { AuditService } from './audit-service';
import type { HostService } from './host-service';

export class KvmService {
  constructor(
    private readonly connector: KvmOrchestratorConnector,
    private readonly hostService: HostService,
    private readonly auditService: AuditService
  ) {}

  async listVms(options?: { state?: string; limit?: number; offset?: number; withState?: boolean }) {
    const listResult = await this.connector.listVms({
      state: options?.state,
      limit: options?.limit ?? 200,
      offset: options?.offset ?? 0,
    });

    const annotated = await this.hostService.annotateVms(listResult.vms);

    if (!options?.withState) {
      return {
        ...listResult,
        vms: annotated,
      };
    }

    const stateResults = await Promise.allSettled(
      annotated.map((vm) => this.connector.getVmState(vm.vmId))
    );

    const merged = annotated.map((vm, index) => ({
      ...vm,
      stateInfo: stateResults[index].status === 'fulfilled' ? stateResults[index].value : undefined,
    }));

    return {
      ...listResult,
      vms: merged,
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

  async powerVm(vmId: string, action: 'start' | 'stop', operator = 'admin-ui', force = false) {
    const vmMeta = await this.connector.getVm(vmId).catch(() => null);

    try {
      const result =
        action === 'start' ? await this.connector.startVm(vmId) : await this.connector.stopVm(vmId, force);

      await this.auditService.append({
        operator,
        action,
        targetVmId: vmId,
        sessionId: vmMeta?.sessionId,
        result: 'success',
      });

      return result;
    } catch (error) {
      await this.auditService.append({
        operator,
        action,
        targetVmId: vmId,
        sessionId: vmMeta?.sessionId,
        result: 'failed',
        detail: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async getVmDetail(vmId: string) {
    const [vm, state] = await Promise.all([
      this.connector.getVm(vmId),
      this.connector.getVmState(vmId).catch(() => undefined),
    ]);

    const [annotatedVm] = await this.hostService.annotateVms([
      {
        vmId: vm.vmId,
        sessionId: vm.sessionId,
        state: vm.state,
        cpuCores: vm.config.cpuCores,
        memoryMb: vm.config.memoryMb,
        createdAt: vm.createdAt,
      },
    ]);

    return {
      ...vm,
      stateInfo: state ?? vm.stateInfo,
      hostId: annotatedVm?.hostId,
      hostName: annotatedVm?.hostName,
    };
  }

  async listSessions() {
    const sessions = await this.connector.listSessions({
      limit: 300,
      offset: 0,
    });

    return sessions;
  }

  async getQuota(sessionId: string) {
    if (!sessionId?.trim()) {
      throw new AppError(400, 'sessionId 不能为空');
    }

    return this.connector.getQuota(sessionId);
  }
}