import { kvmOrchestratorClient } from '../clients/kvm-orchestrator-client';
import type {
  UploadFileInput,
  ExecInput,
  SandboxCreateInput,
  SandboxPortMappingInput,
  RelayTcpTicketInput,
  PoolSandboxClaimInput,
  PoolSandboxReleaseInput,
} from '../clients/kvm-orchestrator-client';

type Action = 'start' | 'shutdown' | 'reboot' | 'suspend' | 'resume';

type EnvelopeLike = {
  code?: number;
  message?: string;
  data?: unknown;
  request_id?: string;
  requestId?: string;
};

function toCamelKey(input: string): string {
  return input.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase());
}

function deepCamel(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(deepCamel);
  if (!value || typeof value !== 'object') return value;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[toCamelKey(k)] = deepCamel(v);
  }
  return out;
}

function unwrap<T>(payload: unknown): { data: T; requestId?: string; code?: number; message?: string } {
  const envelope = (payload || {}) as EnvelopeLike;
  const data = (envelope && typeof envelope === 'object' && 'data' in envelope ? envelope.data : envelope) as T;
  return {
    data: deepCamel(data) as T,
    requestId: (envelope as any)?.request_id || (envelope as any)?.requestId,
    code: envelope?.code,
    message: envelope?.message,
  };
}

export const kvmConnector = {
  health: async () => unwrap(await kvmOrchestratorClient.health()),

  listVms: async () => unwrap(await kvmOrchestratorClient.listVms()),
  getVm: async (name: string) => unwrap(await kvmOrchestratorClient.getVm(name)),
  getVmIp: async (name: string, query?: Record<string, string>) =>
    unwrap(await kvmOrchestratorClient.getVmIp(name, query)),
  controlVm: async (name: string, action: Action, asyncMode?: boolean) =>
    unwrap(await kvmOrchestratorClient.controlVm(name, action, asyncMode)),
  getVmMetrics: async (name: string) => unwrap(await kvmOrchestratorClient.getVmMetrics(name)),
  getVmLogs: async (name: string, lines?: number) => unwrap(await kvmOrchestratorClient.getVmLogs(name, lines)),

  listVmSnapshots: async (name: string) => unwrap(await kvmOrchestratorClient.listVmSnapshots(name)),
  createVmSnapshot: async (name: string, input: Record<string, unknown>) =>
    unwrap(await kvmOrchestratorClient.createVmSnapshot(name, input)),
  restoreVmSnapshot: async (name: string, snapshotName: string) =>
    unwrap(await kvmOrchestratorClient.restoreVmSnapshot(name, snapshotName)),
  deleteVmSnapshot: async (name: string, snapshotName: string) =>
    unwrap(await kvmOrchestratorClient.deleteVmSnapshot(name, snapshotName)),

  createSession: async (input: Record<string, unknown>, idempotencyKey?: string) =>
    unwrap(await kvmOrchestratorClient.createSession(input, idempotencyKey)),
  getSession: async (sessionId: string) => unwrap(await kvmOrchestratorClient.getSession(sessionId)),
  bindSessionVm: async (sessionId: string, input: Record<string, unknown>) =>
    unwrap(await kvmOrchestratorClient.bindSessionVm(sessionId, input)),
  getSessionVm: async (sessionId: string) => unwrap(await kvmOrchestratorClient.getSessionVm(sessionId)),
  closeSession: async (sessionId: string, input: Record<string, unknown>) =>
    unwrap(await kvmOrchestratorClient.closeSession(sessionId, input)),

  getSessionQuota: async (sessionId: string) => unwrap(await kvmOrchestratorClient.getSessionQuota(sessionId)),
  updateSessionQuota: async (sessionId: string, input: Record<string, unknown>) =>
    unwrap(await kvmOrchestratorClient.updateSessionQuota(sessionId, input)),

  uploadVmFile: async (vmName: string, input: UploadFileInput) =>
    unwrap(await kvmOrchestratorClient.uploadVmFile(vmName, input)),
  uploadSessionFile: async (sessionId: string, input: UploadFileInput) =>
    unwrap(await kvmOrchestratorClient.uploadSessionFile(sessionId, input)),
  deleteVmFile: async (vmName: string, query: Record<string, string>) =>
    unwrap(await kvmOrchestratorClient.deleteVmFile(vmName, query)),
  deleteSessionFile: async (sessionId: string, query: Record<string, string>) =>
    unwrap(await kvmOrchestratorClient.deleteSessionFile(sessionId, query)),
  execVm: async (vmName: string, input: ExecInput) =>
    unwrap(await kvmOrchestratorClient.execVm(vmName, input)),
  execSession: async (sessionId: string, input: ExecInput) =>
    unwrap(await kvmOrchestratorClient.execSession(sessionId, input)),

  createSandbox: async (input: SandboxCreateInput, idempotencyKey?: string) =>
    unwrap(await kvmOrchestratorClient.createSandbox(input, idempotencyKey)),
  getSandbox: async (sessionId: string) => unwrap(await kvmOrchestratorClient.getSandbox(sessionId)),
  getSandboxIp: async (sessionId: string, query?: Record<string, string>) =>
    unwrap(await kvmOrchestratorClient.getSandboxIp(sessionId, query)),
  createSandboxPort: async (sessionId: string, input: SandboxPortMappingInput) =>
    unwrap(await kvmOrchestratorClient.createSandboxPort(sessionId, input)),
  listSandboxPorts: async (sessionId: string, query?: Record<string, string>) =>
    unwrap(await kvmOrchestratorClient.listSandboxPorts(sessionId, query)),
  deleteSandboxPort: async (sessionId: string, query: Record<string, string>) =>
    unwrap(await kvmOrchestratorClient.deleteSandboxPort(sessionId, query)),
  restartSandbox: async (sessionId: string, input: Record<string, unknown>) =>
    unwrap(await kvmOrchestratorClient.restartSandbox(sessionId, input)),
  deleteSandbox: async (sessionId: string, query?: Record<string, string>) =>
    unwrap(await kvmOrchestratorClient.deleteSandbox(sessionId, query)),

  createRelayTcpTicket: async (sessionId: string, input: RelayTcpTicketInput) =>
    unwrap(await kvmOrchestratorClient.createRelayTcpTicket(sessionId, input)),
  getRelayTcpState: async (sessionId: string) =>
    unwrap(await kvmOrchestratorClient.getRelayTcpState(sessionId)),

  claimPoolSandbox: async (input: PoolSandboxClaimInput) =>
    unwrap(await kvmOrchestratorClient.claimPoolSandbox(input)),
  releasePoolSandbox: async (sessionId: string, input: PoolSandboxReleaseInput) =>
    unwrap(await kvmOrchestratorClient.releasePoolSandbox(sessionId, input)),
  getPoolSandboxesStatus: async () =>
    unwrap(await kvmOrchestratorClient.getPoolSandboxesStatus()),
  ensurePoolSandboxes: async () =>
    unwrap(await kvmOrchestratorClient.ensurePoolSandboxes()),

  getJob: async (jobId: string) => unwrap(await kvmOrchestratorClient.getJob(jobId)),
};
