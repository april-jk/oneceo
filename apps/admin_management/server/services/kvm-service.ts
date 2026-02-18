import { AppError } from '../utils/errors';
import type { KvmOrchestratorConnector } from '../connectors/kvm-orchestrator-connector';
import type { AuditService } from './audit-service';

export class KvmService {
  constructor(private readonly connector: KvmOrchestratorConnector, private readonly auditService: AuditService) {}

  async listVms(options?: { state?: string; limit?: number; offset?: number; withState?: boolean }) {
    const listResult = await this.connector.listVms({
      state: options?.state,
      limit: options?.limit ?? 200,
      offset: options?.offset ?? 0,
    });
    return listResult;
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

    return {
      ...vm,
      stateInfo: state ?? vm.stateInfo,
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
