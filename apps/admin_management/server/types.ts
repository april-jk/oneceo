export type VmLifecycleState = 'running' | 'stopped' | 'paused' | 'error';
export type SessionStatus =
  | 'pending'
  | 'initializing'
  | 'ready'
  | 'active'
  | 'idle'
  | 'terminating'
  | 'terminated'
  | string;

export type HostStatus = 'online' | 'degraded' | 'offline' | 'maintenance';

export interface ApiSuccess<T> {
  success: true;
  data: T;
  message?: string;
}

export interface ApiFailure {
  success: false;
  error: {
    message: string;
    details?: unknown;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export interface KvmVmListItem {
  vmId: string;
  sessionId?: string;
  state: VmLifecycleState;
  cpuCores?: number;
  memoryMb?: number;
  createdAt?: string;
}

export interface KvmVmState {
  vmId: string;
  state: VmLifecycleState;
  uptimeSeconds?: number;
  cpuUsagePercent?: number;
  memoryUsageMb?: number;
  diskUsageGb?: number;
  network?: {
    inBytes: number;
    outBytes: number;
  };
  lastUpdate?: string;
}

export interface KvmVmDetail {
  vmId: string;
  sessionId?: string;
  name: string;
  state: VmLifecycleState;
  config: {
    cpuCores: number;
    memoryMb: number;
    rootDiskGb: number;
  };
  stateInfo?: {
    uptimeSeconds: number;
    cpuUsagePercent: number;
    memoryUsageMb: number;
    diskUsageGb: number;
  };
  network: {
    ipAddress?: string;
    macAddress?: string;
  };
  createdAt: string;
}

export interface KvmSessionListItem {
  sessionId: string;
  userId: string;
  status: SessionStatus;
  vmId?: string;
  createdAt: string;
}

export interface HostRecord {
  hostId: string;
  name: string;
  region: string;
  status: HostStatus;
  cpuCapacityCores: number;
  memoryCapacityGb: number;
  storageCapacityGb: number;
  hypervisor: string;
  managementIp: string;
  lastHeartbeat: string;
  notes?: string;
}

export interface VmAnnotated extends KvmVmListItem {
  hostId: string;
  hostName: string;
  stateInfo?: KvmVmState;
}

export interface HostRuntime extends HostRecord {
  effectiveStatus: HostStatus;
  usedCpuCores: number;
  usedMemoryGb: number;
  usedStorageGb: number;
  cpuUsagePercent: number;
  memoryUsagePercent: number;
  storageUsagePercent: number;
  runningVmCount: number;
  totalVmCount: number;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  operator: string;
  action: 'start' | 'stop';
  targetVmId: string;
  sessionId?: string;
  result: 'success' | 'failed';
  detail?: string;
}

export interface DashboardOverview {
  updatedAt: string;
  orchestrator: {
    online: boolean;
    service: string;
    message: string;
  };
  vmSummary: {
    total: number;
    running: number;
    stopped: number;
    paused: number;
    error: number;
  };
  sessionSummary: {
    total: number;
    ready: number;
    active: number;
    terminating: number;
    terminated: number;
  };
  hostSummary: {
    total: number;
    online: number;
    degraded: number;
    maintenance: number;
    offline: number;
    averageCpuUsagePercent: number;
    averageMemoryUsagePercent: number;
  };
  vmStateDistribution: Array<{ label: string; value: number }>;
  sessionStatusDistribution: Array<{ label: string; value: number }>;
  hostLoadSeries: Array<{
    hostId: string;
    hostName: string;
    cpuUsagePercent: number;
    memoryUsagePercent: number;
    storageUsagePercent: number;
    status: HostStatus;
  }>;
  alerts: string[];
}
