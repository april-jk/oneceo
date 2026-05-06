export type VmLifecycleState = 'running' | 'stopped' | 'paused' | 'error';
export type VmAction = 'start' | 'shutdown' | 'reboot' | 'suspend' | 'resume' | 'stop';
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | string;
export type SessionStatus =
  | 'pending'
  | 'initializing'
  | 'open'
  | 'closed'
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
  name?: string;
  sessionId?: string;
  state: VmLifecycleState;
  stateRaw?: string;
  ipAddresses?: string[];
  cpuCores?: number;
  memoryMb?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface KvmVmState {
  vmId: string;
  state: VmLifecycleState;
  stateRaw?: string;
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

export interface KvmVmMetrics {
  vmId: string;
  state: VmLifecycleState;
  stateRaw?: string;
  memoryActualMb?: number;
  memoryRssMb?: number;
  stats: Record<string, number | string>;
  collectedAt?: string;
}

export interface KvmVmDetail {
  vmId: string;
  sessionId?: string;
  name: string;
  state: VmLifecycleState;
  stateRaw?: string;
  ipAddresses?: string[];
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
  updatedAt?: string;
}

export interface KvmVmIpInfo {
  vmId: string;
  ipAddresses: string[];
  primaryIp?: string;
}

export interface KvmSessionQuota {
  maxActionsPerMinute: number;
  maxRuntimeMinutes: number;
  maxRebootsPerHour: number;
}

export interface KvmSessionInfo {
  sessionId: string;
  status: SessionStatus;
  vmName?: string | null;
  metadata?: Record<string, unknown>;
  quota?: KvmSessionQuota;
  createdAt?: string;
  updatedAt?: string;
  closedAt?: string | null;
}

export interface KvmSessionListItem {
  sessionId: string;
  userId: string;
  status: SessionStatus;
  vmId?: string;
  createdAt: string;
}

export interface KvmJobInfo {
  jobId: string;
  status: JobStatus;
  type?: string;
  operationId?: string;
  target?: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  error?: Record<string, unknown> | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface KvmSnapshotInfo {
  snapshotName: string;
  vmName: string;
  operationId?: string;
  description?: string;
  createdAt?: string;
  restoredAt?: string;
  deletedAt?: string;
  diskOnly?: boolean;
  quiesce?: boolean;
}

export interface KvmSandboxInfo {
  sessionId: string;
  vmName?: string;
  vmExists?: boolean;
  overlayPath?: string;
  overlayExists?: boolean;
  state?: string | null;
  ipAddresses?: string[];
}

export interface KvmSandboxPortMapping {
  vmPort: number;
  hostPort: number;
  protocol: 'tcp' | 'udp' | string;
  hostIp?: string;
  portReady?: boolean;
  portReadyDetail?: {
    vmPortReady?: boolean;
    hostPortReady?: boolean;
    vmError?: string;
    hostError?: string;
  };
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
