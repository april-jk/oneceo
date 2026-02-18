export type VmState = 'running' | 'stopped' | 'paused' | 'error';
export type HostStatus = 'online' | 'degraded' | 'offline' | 'maintenance';

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

export interface VmListResponse {
  total: number;
  limit: number;
  offset: number;
  vms: VmItem[];
}

export interface VmItem {
  vmId: string;
  sessionId?: string;
  state: VmState;
  cpuCores?: number;
  memoryMb?: number;
  createdAt?: string;
  stateInfo?: {
    vmId: string;
    state: VmState;
    uptimeSeconds?: number;
    cpuUsagePercent?: number;
    memoryUsageMb?: number;
    diskUsageGb?: number;
    network?: {
      inBytes: number;
      outBytes: number;
    };
    lastUpdate?: string;
  };
}

export interface HostRuntime {
  hostId: string;
  name: string;
  region: string;
  status: HostStatus;
  effectiveStatus: HostStatus;
  cpuCapacityCores: number;
  memoryCapacityGb: number;
  storageCapacityGb: number;
  hypervisor: string;
  managementIp: string;
  lastHeartbeat: string;
  notes?: string;
  usedCpuCores: number;
  usedMemoryGb: number;
  usedStorageGb: number;
  cpuUsagePercent: number;
  memoryUsagePercent: number;
  storageUsagePercent: number;
  runningVmCount: number;
  totalVmCount: number;
}

export interface HostListResponse {
  online: boolean;
  total: number;
  hosts: HostRuntime[];
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

export interface AuditResponse {
  total: number;
  entries: AuditLogEntry[];
}

export interface ConversationSession {
  id: string;
  title: string;
  status: 'in_progress' | 'waiting_user' | 'completed' | 'failed' | string;
  stage?: string;
  pendingQuestion?: string;
  pendingOptions?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ConversationMessage {
  id: string;
  role: 'user' | 'agent' | 'system' | string;
  messageType?: string;
  content: string;
  createdAt: string;
  metadata?: unknown;
}

export interface ConversationSessionsResponse {
  total: number;
  sessions: ConversationSession[];
}

export interface ConversationSessionDetailResponse {
  session: ConversationSession;
  messages: ConversationMessage[];
  intent: Record<string, unknown> | null;
  taskDescription: Record<string, unknown> | null;
  executionPlan: Record<string, unknown> | null;
}

export interface AgentManagementOverview {
  oneceoApi: {
    online: boolean;
    timestamp: string | null;
  };
  agentApi: {
    online: boolean;
    message: string;
    timestamp: string | null;
  };
  capabilities: Array<{
    key: string;
    name: string;
    transport: string;
    endpoint: string;
    status: 'available' | 'planned' | string;
  }>;
  taskCreationSessions: {
    total: number;
    inProgress: number;
    waitingUser: number;
    completed: number;
    failed: number;
  };
  stageDistribution: Array<{ label: string; value: number }>;
}

export interface SandboxEnvironmentItem {
  id: string;
  sessionId: string;
  orchestratorSessionId?: string | null;
  vmName?: string | null;
  baseImage?: string | null;
  status: string;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  closedAt?: string | null;
}

export interface SandboxManagementOverview {
  sandboxApi: {
    online: boolean;
    status: string;
    service: string;
    version: string | null;
    timestamp: string | null;
  };
  summary: {
    total: number;
    ready: number;
    creating: number;
    closed: number;
    failed: number;
  };
  environments: SandboxEnvironmentItem[];
}
