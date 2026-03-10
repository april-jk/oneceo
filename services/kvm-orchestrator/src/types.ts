export type VmLifecycleState = 'stopped' | 'running' | 'paused' | 'error';
export type SessionStatus = 'pending' | 'initializing' | 'ready' | 'active' | 'idle' | 'terminating' | 'terminated';

export interface VmRecord {
  vmId: string;
  sessionId: string;
  name: string;
  description?: string;
  cpuCores: number;
  memoryMb: number;
  rootDiskGb: number;
  dataDiskGb?: number;
  networkBridge: string;
  macAddress: string;
  ipAddress?: string;
  state: VmLifecycleState;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  stoppedAt?: string;
  tags?: Record<string, string>;
  snapshots: SnapshotRecord[];
  logs: string[];
}

export interface SnapshotRecord {
  snapshotId: string;
  vmId: string;
  name: string;
  description?: string;
  createdAt: string;
  sizeGb: number;
}

export interface QuotaRecord {
  sessionId: string;
  cpuCores: number;
  maxCpuCores: number;
  memoryMb: number;
  maxMemoryMb: number;
  storageGb: number;
  maxStorageGb: number;
  bandwidthMbps: number;
  createdAt: string;
  updatedAt: string;
}

export interface SessionRecord {
  sessionId: string;
  userId: string;
  projectId?: string;
  agentId: string;
  agentType: string;
  vmId?: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  lastActivity: string;
  tags?: Record<string, string>;
}

export interface SessionEvent {
  eventId: string;
  sessionId: string;
  type: string;
  timestamp: string;
  details?: Record<string, unknown>;
}

export interface StoreData {
  vms: VmRecord[];
  sessions: SessionRecord[];
  quotas: QuotaRecord[];
  events: SessionEvent[];
}

export interface ApiEnvelope<T> {
  code: number;
  message: string;
  data?: T;
  error?: {
    type: string;
    details?: string;
    field?: string;
  };
}
