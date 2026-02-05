import { kvmOrchestratorClient } from '../clients/kvm-orchestrator-client';

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

function unwrap<T>(payload: EnvelopeLike): { data: T; requestId?: string; code?: number; message?: string } {
  const data = (payload && typeof payload === 'object' && 'data' in payload ? payload.data : payload) as T;
  return {
    data: deepCamel(data) as T,
    requestId: (payload as any)?.request_id || (payload as any)?.requestId,
    code: payload?.code,
    message: payload?.message,
  };
}

export const kvmConnector = {
  health: async () => unwrap(await kvmOrchestratorClient.health()),

  listVms: async () => unwrap(await kvmOrchestratorClient.listVms()),
  getVm: async (name: string) => unwrap(await kvmOrchestratorClient.getVm(name)),
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

  getJob: async (jobId: string) => unwrap(await kvmOrchestratorClient.getJob(jobId)),
};
