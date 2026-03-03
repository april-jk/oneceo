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
  name?: string;
  sessionId?: string;
  state: VmState;
  stateRaw?: string;
  ipAddresses?: string[];
  cpuCores?: number;
  memoryMb?: number;
  createdAt?: string;
  updatedAt?: string;
  stateInfo?: {
    vmId: string;
    state: VmState;
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
  };
}

export interface VmIpInfo {
  vmId: string;
  ipAddresses: string[];
  primaryIp?: string;
}

export interface VmMetricsInfo {
  vmId: string;
  state: VmState;
  stateRaw?: string;
  memoryActualMb?: number;
  memoryRssMb?: number;
  stats: Record<string, number | string>;
  collectedAt?: string;
}

export interface VmDetailResponse extends VmItem {
  network?: {
    ipAddress?: string;
    macAddress?: string;
  };
  config?: {
    cpuCores: number;
    memoryMb: number;
    rootDiskGb: number;
  };
  ipInfo?: VmIpInfo;
}

export interface KvmSnapshotInfo {
  snapshotName: string;
  vmName: string;
  operationId?: string;
  description?: string;
  createdAt?: string;
  restoredAt?: string;
  deletedAt?: string;
}

export interface KvmJobInfo {
  jobId: string;
  status: string;
  type?: string;
  operationId?: string;
  target?: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  error?: Record<string, unknown> | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface KvmSessionQuota {
  maxActionsPerMinute: number;
  maxRuntimeMinutes: number;
  maxRebootsPerHour: number;
}

export interface KvmSessionInfo {
  sessionId: string;
  status: string;
  vmName?: string | null;
  metadata?: Record<string, unknown>;
  quota?: KvmSessionQuota;
  createdAt?: string;
  updatedAt?: string;
  closedAt?: string | null;
}

export interface KvmSandboxPortMapping {
  vmPort: number;
  hostPort: number;
  protocol: string;
  hostIp?: string;
  portReady?: boolean;
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
  runtime?: {
    taskSessionId: string;
    orchestratorSessionId?: string | null;
    opencodeSessionId?: string | null;
    vmName?: string | null;
    bindingUpdatedAt?: string | null;
    pendingResume?: {
      stage: string;
      reason?: string;
      lastUserInput?: string;
      updatedAt?: string;
    } | null;
    pendingQuestion?: string | null;
    pendingOptions?: string[];
  };
  trace?: {
    timeline: ConversationTraceEvent[];
    llm: ConversationLlmTrace[];
    agentDecisions: ConversationMessage[];
    opencodeMessages: ConversationMessage[];
    stateTransitions?: ConversationStateTransition[];
    sandbox: {
      primaryEnvironment: SandboxEnvironmentItem | null;
      relatedEnvironments: SandboxEnvironmentItem[];
    };
    kvm: {
      orchestratorSessionId?: string | null;
      vmName?: string | null;
      session?: Record<string, unknown> | null;
      sessionVm?: Record<string, unknown> | null;
      sandbox?: Record<string, unknown> | null;
      sandboxIp?: Record<string, unknown> | null;
      sandboxPorts?: Record<string, unknown> | null;
      vmDetail?: Record<string, unknown> | null;
      vmMetrics?: Record<string, unknown> | null;
      vmLogs?: Record<string, unknown> | null;
      quota?: Record<string, unknown> | null;
      auditEntries?: AuditLogEntry[];
      errors?: string[];
    };
    osac: {
      messages: Array<{
        type: string;
        requestId?: string;
        payload?: Record<string, unknown>;
      }>;
      summary: {
        total: number;
        byType: Array<{
          type: string;
          count: number;
        }>;
      };
      errors: string[];
    };
  };
}

export interface ConversationTraceEvent {
  id: string;
  timestamp?: string;
  source: 'user' | 'agent' | 'system' | 'osac' | 'kvm';
  category: string;
  title: string;
  content?: string;
  badge?: string;
  rawContent?: string;
  level: 'info' | 'warn' | 'error';
  metadata?: Record<string, unknown>;
  decision?: {
    layer?: string;
    source?: string;
    type?: string;
    name?: string;
  };
  decisionInput?: Record<string, unknown> | string;
  decisionOutput?: Record<string, unknown> | string;
  execution?: {
    component?: string;
    action?: string;
    detail?: string;
  };
  context?: {
    trigger?: {
      id?: string;
      role?: string;
      messageType?: string;
      content?: string;
      createdAt?: string;
    };
    previous?: {
      id?: string;
      role?: string;
      messageType?: string;
      content?: string;
      createdAt?: string;
    };
  };
}

export interface ConversationStateSnapshot {
  status?: string;
  stage?: string;
  phase?: string;
}

export interface ConversationStateTransition {
  from: ConversationStateSnapshot;
  to: ConversationStateSnapshot;
  at?: string;
  trigger: {
    messageId?: string;
    messageType?: string;
    role?: string;
    agent?: string;
    tone?: string;
    content?: string;
  };
}

export interface ConversationLlmTrace {
  id: string;
  stage: 'intent_recognition' | 'planning' | 'execution_plan' | 'execution_review' | 'opencode_command';
  source: 'task_creation_agent' | 'opencode';
  inferred: boolean;
  request: Record<string, unknown>;
  response: Record<string, unknown>;
  createdAt?: string;
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
