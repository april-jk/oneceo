export type VmState = 'running' | 'stopped' | 'paused' | 'error';
export type HostStatus = 'online' | 'degraded' | 'offline' | 'maintenance';
export type AdminThemeKey = string;
export type AdminThemeMode = 'light' | 'dark' | 'system';

export interface AdminThemeOption {
  key: AdminThemeKey;
  label: string;
  description: string;
  lightSwatches: string[];
  darkSwatches: string[];
}

export interface AdminThemeModeOption {
  key: AdminThemeMode;
  label: string;
  description: string;
}

export interface AdminThemeSettings {
  currentTheme: AdminThemeKey;
  currentMode: AdminThemeMode;
  envKey: string;
  envModeKey: string;
  envPath: string;
  themes: AdminThemeOption[];
  modes: AdminThemeModeOption[];
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
  action: string;
  targetVmId: string;
  sessionId?: string;
  result: 'success' | 'failed';
  detail?: string;
}

export interface AuditResponse {
  total: number;
  filteredTotal: number;
  limit: number;
  offset: number;
  entries: AuditLogEntry[];
  availableOperators?: string[];
  availableActions?: string[];
  availableTargets?: string[];
}

export interface AuditDetailResponse {
  entry: AuditLogEntry;
  relatedEntries: AuditLogEntry[];
}

export interface AgentStageDistributionItem {
  stageKey: string;
  label: string;
  value: number;
  statusSummary: Array<{ label: string; value: number }>;
  recentSessions: Array<{
    id: string;
    title: string;
    status: string;
    updatedAt: string;
    pendingQuestion?: string;
  }>;
}

export interface ConversationSession {
  id: string;
  title: string;
  status: 'in_progress' | 'waiting_user' | 'completed' | 'failed' | string;
  stage?: string;
  executor?: string | null;
  pendingQuestion?: string;
  pendingOptions?: string[];
  createdAt: string;
  updatedAt: string;
  user?: ConversationSessionUser | null;
}

export interface ConversationSessionUser {
  id: string;
  source: 'app_user' | 'legacy_user_id' | 'missing_app_user' | string;
  displayName?: string | null;
  email?: string | null;
  status?: string | null;
  lastLoginAt?: string | null;
  lastSeenAt?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  sessionCreatedAt?: string | null;
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
      binding?: ConversationSandboxBinding | null;
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

export interface ConversationSandboxBinding {
  id: string;
  sessionId: string;
  sandboxId: string;
  workspaceRoot?: string | null;
  status?: string | null;
  metadataJson?: Record<string, unknown> | null;
  createdAt?: string;
  updatedAt?: string;
  lastActiveAt?: string | null;
}

export interface ConversationSessionInfraResponse {
  sessionId: string;
  runtime?: ConversationSessionDetailResponse['runtime'];
  trace?: {
    sandbox?: ConversationSessionDetailResponse['trace'] extends { sandbox: infer T } ? T : never;
    kvm?: ConversationSessionDetailResponse['trace'] extends { kvm: infer T } ? T : never;
    osac?: ConversationSessionDetailResponse['trace'] extends { osac: infer T } ? T : never;
  };
}

export interface ConnectorGuidePolicy {
  id: string;
  connectorKey: string;
  status: 'draft' | 'active' | 'archived' | string;
  triggerMode: 'on_attach' | 'on_active_use' | 'on_attach_and_active_use' | string;
  description: string;
  publishedRevisionId: string | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectorGuideRevision {
  id: string;
  policyId: string;
  versionNumber: number;
  status: 'draft' | 'published' | 'archived' | string;
  serverInstructionsMarkdown: string;
  guideReminderMarkdown: string;
  blockingRulesMarkdown: string;
  notes: string;
  createdBy?: string | null;
  createdAt: string;
  publishedAt?: string | null;
}

export interface ConnectorGuidePolicyDetail extends ConnectorGuidePolicy {
  publishedRevision?: ConnectorGuideRevision | null;
  revisions: ConnectorGuideRevision[];
}

export interface ConnectorGuideValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ConnectorCatalogItem {
  key: string;
  name: string;
  available: boolean;
  availabilityReason?: string;
  visibleInMenu: boolean;
}

export interface ConnectorGuideCatalogSummary {
  items: ConnectorCatalogItem[];
  stats: {
    total: number;
    available: number;
    unavailable: number;
  };
  updatedAt: string;
}

export interface SkillSummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  status: 'active' | 'archived';
  publishedRevisionId: string | null;
  publishedRevisionNumber: number | null;
  publishedAt: string | null;
  updatedAt: string;
  governance: {
    systemRole: string | null;
    adminManaged: boolean;
    required: boolean;
    autoActivation: {
      enabled: boolean;
      triggers: string[];
      toolNames: string[];
    };
  };
}

export interface SkillDetail {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  status: 'active' | 'archived';
  publishedRevisionId: string | null;
  latestBodyMarkdown: string;
  renderedSkillMarkdown: string | null;
  governance: {
    systemRole: string | null;
    adminManaged: boolean;
    required: boolean;
    autoActivation: {
      enabled: boolean;
      triggers: string[];
      toolNames: string[];
    };
  };
  resourceSummary?: {
    totalCount: number;
    referenceCount: number;
    templateCount: number;
    paths: string[];
  };
  resources?: Array<{
    id: string;
    resourcePath: string;
    resourceType: 'reference' | 'template';
    createdAt: string;
  }>;
  updatedAt: string;
}

export interface SkillGovernanceOption {
  value: string;
  label: string;
  description?: string;
  category?: string;
}

export interface SkillGovernanceOptions {
  systemRoles: SkillGovernanceOption[];
  autoActivationTriggers: SkillGovernanceOption[];
  toolNames: SkillGovernanceOption[];
}

export interface SkillRevision {
  id: string;
  revisionNumber: number;
  createdAt: string;
  createdBy?: string | null;
  publishedAt?: string | null;
  isPublished: boolean;
}

export interface SkillRenderedRevision {
  skillId: string;
  revisionId: string;
  revisionNumber: number;
  slug: string;
  renderedMarkdown: string;
  signature: string;
}

export interface SkillRevisionResources {
  skill: {
    id: string;
    slug: string;
    name: string;
  };
  revision: {
    id: string;
    revisionNumber: number;
  };
  resourceSummary: {
    totalCount: number;
    referenceCount: number;
    templateCount: number;
    paths: string[];
  };
  resources: Array<{
    id: string;
    resourceKey: string;
    resourcePath: string;
    resourceType: 'reference' | 'template';
    title: string;
    summary: string;
    contentStorage: 'database' | 'object_storage';
    mimeType: string;
    storagePath: string | null;
    storageLocatorJson: Record<string, unknown> | null;
    loadStage: string;
    sortOrder: number;
    contentMarkdown: string;
    createdAt: string;
    updatedAt: string;
  }>;
}

export interface SkillValidationResult {
  sessionId: string;
  skillId: string;
  revisionId: string;
  slug: string | null;
  skillPath: string | null;
  signature: string;
  restartTriggered: boolean;
  syncedAt: string;
}

export interface SkillImportPreview {
  rootFolderName: string;
  slug: string;
  name: string;
  discoveryDescription: string;
  activationSummary: string;
  entry: {
    entryName: string;
    entryDescription: string;
    bodyMarkdown: string;
  };
  files: Array<{
    relativePath: string;
    nodeType: 'file';
    resourceKind: 'reference' | 'template' | 'example' | 'script';
    storageTarget: 'database' | 'object_storage';
    processingState: 'pending';
    sizeBytes: number;
  }>;
  resources: Array<{
    resourceKey: string;
    resourcePath: string;
    resourceKind: 'reference' | 'template' | 'example' | 'script';
    title: string;
    summary: string;
    contentFormat: 'markdown' | 'text' | 'json';
    contentMode: 'inline' | 'chunked';
    fullTextHash: string;
    contentSize: number;
    chunks: Array<{
      chunkIndex: number;
      chunkRole: 'summary' | 'body';
      chunkSummary: string;
      contentText: string;
      tokenEstimate: number;
    }>;
  }>;
  warnings: string[];
}

export interface SkillImportResult {
  mode: 'create' | 'revision';
  preview: SkillImportPreview;
  skill: SkillDetail;
  revision: SkillRevision;
}

export interface SkillImportJob {
  jobId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  createdAt: string;
  updatedAt: string;
  preview: SkillImportPreview;
  files: Array<{
    relativePath: string;
    storageTarget: 'database' | 'object_storage';
    processingState: 'pending' | 'processing' | 'success' | 'failed';
    error?: string | null;
  }>;
  result?: SkillImportResult | null;
  error?: string | null;
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
  stageDistribution: AgentStageDistributionItem[];
}

export interface AppUserSessionSummary {
  id: string;
  expiresAt: string | null;
  revokedAt: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  lastSeenAt: string | null;
  isActive: boolean;
  isOnline: boolean;
}

export interface AppUserConversationSummary {
  id: string;
  userId?: string | null;
  title: string;
  status: string;
  createdAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
}

export interface AppUserSandboxSummary {
  sandboxId: string;
  sessionId: string;
  taskSessionId: string;
  orchestratorSessionId?: string | null;
  vmName?: string | null;
  baseImage?: string | null;
  status: string;
  metadata?: Record<string, unknown> | null;
  createdAt: string | null;
  updatedAt: string | null;
  closedAt: string | null;
}

export interface AppUserLegacyMapping {
  id: string;
  legacyUserId: string;
  source: string;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface AppUserListItem {
  id: string;
  email: string;
  displayName: string;
  status: string;
  createdAt: string | null;
  updatedAt: string | null;
  lastLoginAt: string | null;
  latestSession: AppUserSessionSummary | null;
  sessionCount: number;
  activeSessionCount: number;
  conversationCount: number;
  lastConversationAt: string | null;
  sandboxCount: number;
  lastSandboxAt: string | null;
  legacyMappingCount: number;
  lastLegacySeenAt: string | null;
  lastActivityAt: string | null;
  ownershipHealth: 'healthy' | 'legacy_mapping' | 'anomaly' | string;
  ownershipReason: string;
}

export interface AppUserListResponse {
  summary: {
    totalUsers: number;
    activeUsers7d: number;
    disabledUsers: number;
    ownershipAlertUsers: number;
    generatedAt: string;
  };
  filters: {
    limit: number;
    query: string | null;
    status: string;
    activity: string;
    hasSession: string;
    hasConversation: string;
    hasSandbox: string;
    ownershipHealth: string;
    sortKey: string;
    sortDirection: string;
  };
  items: AppUserListItem[];
}

export interface AppUserDetailResponse {
  user: {
    id: string;
    email: string;
    displayName: string;
    status: string;
    createdAt: string | null;
    updatedAt: string | null;
    lastLoginAt: string | null;
  } | null;
  stats: {
    sessionCount: number;
    activeSessionCount: number;
    conversationCount: number;
    sandboxCount: number;
    legacyMappingCount: number;
    lastActivityAt: string | null;
    lastConversationAt: string | null;
    lastSandboxAt: string | null;
    lastLegacySeenAt: string | null;
    ownershipHealth: 'healthy' | 'legacy_mapping' | 'anomaly' | string;
    ownershipReason: string;
  };
  recentSessions: AppUserSessionSummary[];
  recentConversations: AppUserConversationSummary[];
  recentSandboxes: AppUserSandboxSummary[];
  legacyMappings: AppUserLegacyMapping[];
  revokedSessionCount?: number;
}

export interface DeploymentPanelData {
  configured: boolean;
  canDeploy: boolean;
  message?: string;
  bindingState: string;
  provisioningPhase?: string;
  providerErrorCode?: string;
  providerErrorMessage?: string;
  lastVerifiedAt?: string;
  projectId?: string;
  projectName?: string;
  environmentId?: string;
  environmentName?: string;
  serviceId?: string;
  serviceName?: string;
  deploymentId?: string;
  latestStatus?: string;
  latestUrl?: string;
  latestStaticUrl?: string;
  activeDeploymentPending: boolean;
  domains: string[];
  deployments: Array<{
    id: string;
    status: string;
    createdAt?: string;
    serviceName?: string;
    commitMessage?: string;
    commitAuthor?: string;
    url?: string;
    staticUrl?: string;
  }>;
  logs: Array<{
    timestamp?: string;
    message: string;
    severity?: string;
  }>;
  missing: string[];
  analytics?: Record<string, unknown>;
  resourceBinding?: Record<string, unknown>;
}

export interface DeploymentRecord {
  taskSessionId: string;
  statusCategory: 'success' | 'failed' | 'pending' | 'ready' | 'uninitialized' | 'unknown' | string;
  hasDeployment: boolean;
  deploymentId: string | null;
  bindingState: string;
  latestStatus: string | null;
  latestUrl: string | null;
  latestStaticUrl: string | null;
  activeDeploymentPending: boolean;
  projectName: string | null;
  environmentName: string | null;
  serviceName: string | null;
  lastVerifiedAt: string | null;
  updatedAt: string;
  user: {
    id: string;
    source: string;
    displayName: string | null;
    email: string | null;
    status: string | null;
    lastLoginAt: string | null;
    lastSeenAt: string | null;
  } | null;
  session: {
    id: string;
    userId: string | null;
    title: string;
    status: string;
    stage: string | null;
    createdAt: string | null;
    updatedAt: string | null;
  };
  sandbox: {
    sandboxId: string;
    sessionId: string;
    orchestratorSessionId: string | null;
    vmName: string | null;
    status: string;
    createdAt: string | null;
    updatedAt: string | null;
    closedAt: string | null;
  } | null;
  panel: DeploymentPanelData;
}

export interface DeploymentManagementOverview {
  summary: {
    total: number;
    success: number;
    failed: number;
    pending: number;
    ready: number;
    withUrl: number;
    latestUpdatedAt: string | null;
  };
}

export type OperationsAnalyticsRangeKey = '24h' | '7d' | '30d' | '90d';

export interface OperationsAnalyticsExpandedMetric {
  name: string;
  pageviews: number;
  visitors: number;
  visits: number;
  bounces: number;
  totaltime: number;
}

export interface OperationsAnalyticsOverview {
  updatedAt: string;
  range: {
    key: OperationsAnalyticsRangeKey;
    startAt: string;
    endAt: string;
    unit: 'hour' | 'day' | 'month' | 'year';
    timezone: string;
  };
  source: {
    umami: {
      configured: boolean;
      host: string;
      teamId: string | null;
      websiteId: string | null;
    };
    oneceoDb: {
      configured: boolean;
    };
  };
  traffic: {
    stats: {
      pageviews: number;
      visits: number;
      visitors: number;
      bounces: number;
      totaltime: number;
    };
    activeVisitors: number;
    bounceRate: number;
    averageVisitDurationSeconds: number;
    pageviews: {
      pageviews: Array<{ x: string; y: number }>;
      sessions: Array<{ x: string; y: number }>;
    };
  };
  acquisition: {
    referrers: OperationsAnalyticsExpandedMetric[];
    channels: OperationsAnalyticsExpandedMetric[];
    entryPages: OperationsAnalyticsExpandedMetric[];
  };
  behavior: {
    topPages: OperationsAnalyticsExpandedMetric[];
    devices: OperationsAnalyticsExpandedMetric[];
    events: OperationsAnalyticsExpandedMetric[];
  };
  business: {
    metrics: Array<{
      key: string;
      label: string;
      value: number;
      source: 'umami' | 'oneceo_db';
      unit?: 'count' | 'percent' | 'seconds';
    }>;
  };
  alerts: string[];
}

export interface DeploymentManagementListResponse {
  records: DeploymentRecord[];
  total: number;
}

export interface DeploymentConversationListResponse {
  items: DeploymentRecord[];
  total: number;
}

export interface DeploymentUserSummary {
  user: DeploymentRecord['user'];
  deploymentCount: number;
  successCount: number;
  failedCount: number;
  pendingCount: number;
  latestUpdatedAt: string | null;
  latestRecord: DeploymentRecord | null;
}

export interface DeploymentUserListResponse {
  items: DeploymentUserSummary[];
  total: number;
}

export interface RailwayManagedAccountRef {
  userId: string;
  connectorKey: string;
  displayName: string | null;
  authStatus: string;
  lastError: string | null;
  updatedAt: string | null;
  projectKey: string;
}

export interface RailwayServiceItem {
  key: string;
  projectId: string;
  projectName: string | null;
  environmentId: string;
  environmentName: string | null;
  serviceId: string;
  serviceName: string | null;
  primaryDomain: string | null;
  domainCount: number;
  targetPort: number | null;
  latestDeploymentId: string | null;
  latestDeploymentStatus: string | null;
  latestDeploymentAt: string | null;
  latestUrl: string | null;
  latestStaticUrl: string | null;
  linkedUsers: Array<{
    id: string;
    displayName: string | null;
    email: string | null;
    status: string | null;
  }>;
  linkedUserCount: number;
  managedAccountCount: number;
  riskTags: string[];
  variablesPreview: string[];
  refs: RailwayManagedAccountRef[];
  updatedAt: string | null;
}

export interface RailwayServiceListResponse {
  summary: {
    total: number;
    withDomain: number;
    failed: number;
    risky: number;
    updatedAt: string | null;
  };
  items: RailwayServiceItem[];
}

export interface RailwayBatchActionResponse {
  total: number;
  successCount: number;
  failureCount: number;
  results: Array<{
    key: string;
    serviceId: string;
    serviceName: string | null;
    ok: boolean;
    message?: string;
  }>;
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
    running: number;
    paused: number;
  };
  sandboxes: E2bSandboxItem[];
}

export interface SandboxLiveSummary {
  total: number;
  running: number;
  paused: number;
  pagesScanned: number;
  countedAt: string;
}

export interface SandboxRuntimeRegistryItem {
  sandboxId: string;
  orchestratorSessionId: string;
  taskSessionId?: string | null;
  taskTitle?: string | null;
  taskStatus?: string | null;
  executor: string;
  codexExecutionMode?: string | null;
  template?: string | null;
  alias?: string | null;
  status: string;
  sandboxState?: string | null;
  archiveStatus?: string | null;
  archiveDirty: boolean;
  pendingArchiveUpdate: boolean;
  lastActiveAt?: string | null;
  lastActiveReason?: string | null;
  opencodeBaseUrl?: string | null;
  osacEndpoint?: string | null;
  osacHostPort?: number | null;
  trafficAccessTokenPresent: boolean;
  startedAt?: string | null;
  endAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  closedAt?: string | null;
  dedupeReplacedAt?: string | null;
  dedupeReason?: string | null;
  dedupeReplacementSandboxId?: string | null;
  riskTags: string[];
  source: 'tracked' | 'live_only';
}

export interface SandboxRuntimeRegistry {
  summary: {
    total: number;
    running: number;
    paused: number;
    closed: number;
    pendingArchive: number;
    archiveFailed: number;
    risky: number;
  };
  distributions: {
    executors: Array<{ label: string; value: number }>;
    templates: Array<{ label: string; value: number }>;
    archiveStatuses: Array<{ label: string; value: number }>;
  };
  hasMore: boolean;
  items: SandboxRuntimeRegistryItem[];
}

export interface SandboxRuntimeDetail {
  runtime: SandboxRuntimeRegistryItem;
  trackedEnvironment: SandboxEnvironmentItem | null;
  liveSandbox: E2bSandboxItem | null;
  liveSandboxDetail: E2bSandboxDetail | null;
  liveSandboxFullInfo: E2bSandboxFullInfo | null;
  taskSession: ConversationSession | null;
  debug: Record<string, unknown> | null;
  metrics: E2bSandboxMetricPoint[];
  connectivity: {
    osacConfigured: boolean;
    opencodeConfigured: boolean;
    trafficAccessTokenPresent: boolean;
    workspaceRoot?: string | null;
    stateRoot?: string | null;
  };
  archive: {
    archiveStatus?: string | null;
    archiveDirty: boolean;
    pendingArchiveUpdate: boolean;
    archiveKey?: string | null;
    snapshotKey?: string | null;
    metadataKey?: string | null;
    archivePendingSince?: string | null;
    lastDirtyAt?: string | null;
    lastDirtyReason?: string | null;
    restoredAt?: string | null;
  };
  archiveHistory?: SandboxArchiveHistoryEntry[];
  metadata: Record<string, unknown>;
}

export interface SandboxArchiveHistoryEntry {
  snapshotKey: string;
  archiveKey?: string | null;
  metadataKey?: string | null;
  archivedAt: string | null;
  sizeBytes?: number | null;
  sha256?: string | null;
  reason?: string | null;
  status?: string | null;
  isCurrent: boolean;
}

export interface E2bSandboxItem {
  sandboxId: string;
  state: 'running' | 'paused';
  templateId: string;
  alias?: string;
  startedAt: string;
  endAt: string;
  cpuCount: number;
  memoryMB: number;
  diskSizeMB: number;
  metadata?: Record<string, string>;
}

export interface E2bSandboxDetail {
  sandboxId: string;
  state: 'running' | 'paused' | string;
  templateId: string;
  name?: string;
  startedAt: string;
  endAt: string;
  cpuCount: number;
  memoryMB: number;
  diskSizeMB: number;
  metadata: Record<string, string>;
}

export interface E2bSandboxFullInfo {
  sandboxId: string;
  state: 'running' | 'paused' | string;
  templateId: string;
  name?: string;
  startedAt: string;
  endAt: string;
  cpuCount: number;
  memoryMB: number;
  sandboxDomain?: string;
  envdVersion?: string;
  envdAccessToken?: string;
  metadata: Record<string, string>;
}

export interface E2bSandboxMetricPoint {
  timestamp: string;
  cpuUsagePercent?: number;
  memoryUsagePercent?: number;
  memoryUsedMB?: number;
  memoryTotalMB?: number;
  diskUsagePercent?: number;
}

export type E2bTemplate = {
  templateID?: string;
  templateId?: string;
  alias?: string;
  name?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
};

export type E2bTemplateWithBuilds = {
  templateID?: string;
  templateId?: string;
  alias?: string;
  builds?: Array<Record<string, unknown>>;
  [key: string]: unknown;
};

export type E2bTemplateBuildInfo = Record<string, unknown>;
export type E2bTemplateBuildLogsResponse = Record<string, unknown>;

export interface OsacRelease {
  id: string;
  artifactType: string;
  platform: string;
  arch: string;
  version: string;
  channel: string;
  status: 'uploaded' | 'validated' | 'published' | 'archived' | string;
  bucket: string;
  objectKey: string;
  manifestKey: string;
  sha256: string;
  sizeBytes: number;
  releaseNotes: string;
  sourceCommit?: string | null;
  uploadedBy?: string | null;
  publishedBy?: string | null;
  uploadedAt: string;
  publishedAt?: string | null;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  metadataJson?: Record<string, unknown> | null;
}

export interface OsacReleaseListResponse {
  currentPublishedReleaseId: string | null;
  currentPublishedVersion: string | null;
  channel: string;
  items: OsacRelease[];
}

export interface OsacReleaseDetailResponse {
  release: OsacRelease;
  currentPublishedReleaseId: string | null;
  currentPublishedVersion: string | null;
}
