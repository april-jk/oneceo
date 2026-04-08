import { useCallback, useEffect, useRef, useState } from 'react';
import type * as React from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

// 管理后台主页面：统一组装导航、区块切换和会话/主机/技能/发布等能力面板。
import { api } from './api';
import type { AdminUser } from './api';
import { ConnectorGuideManagementSection } from './components/ConnectorGuideManagementSection';
import { KvmControlCenter } from './components/KvmControlCenter';
import { OsacReleaseManagementSection } from './components/OsacReleaseManagementSection';
import { SkillManagementSection } from './components/SkillManagementSection';
import type {
  AgentManagementOverview,
  AuditLogEntry,
  ConversationSession,
  ConversationSessionDetailResponse,
  DashboardOverview,
  E2bSandboxDetail,
  E2bSandboxFullInfo,
  E2bTemplate,
  E2bTemplateBuildInfo,
  E2bTemplateBuildLogsResponse,
  E2bTemplateWithBuilds,
  HostListResponse,
  SandboxArchiveHistoryEntry,
  SandboxEnvironmentItem,
  SandboxRuntimeDetail,
  SandboxRuntimeRegistry,
  SandboxManagementOverview,
  VmItem,
} from './types';

type SectionKey = 'kvm' | 'conversation' | 'agent' | 'skill' | 'connectorGuide' | 'osacRelease' | 'sandbox' | 'audit';
type NavGroupKey = 'runtime' | 'platform';

// 左侧主导航分组：区分“运行态能力”和“平台配置能力”。
type HostTrendPoint = {
  timestamp: number;
  timeLabel: string;
  cpu: number;
  memory: number;
  storage: number;
};

// 顶部导航模块配置，用于渲染卡片列表与权限/体验文案。
const NAV_GROUPS: Array<{ key: NavGroupKey; label: string; description: string }> = [
  { key: 'runtime', label: '运行管理', description: '运行状态与操作记录' },
  { key: 'platform', label: '平台配置', description: '能力、策略与发布配置' },
];

const NAV_ITEMS: Array<{
  key: SectionKey;
  group: NavGroupKey;
  label: string;
  subtitle: string;
  tag: string;
  description: string;
  signal: string;
}> = [
  {
    key: 'kvm',
    group: 'runtime',
    label: 'KVM 管理',
    subtitle: '虚拟机与资源',
    tag: 'KVM',
    description: '查看宿主机资源、虚拟机状态和实例操作。',
    signal: '资源水位',
  },
  {
    key: 'conversation',
    group: 'runtime',
    label: '对话管理',
    subtitle: '会话记录',
    tag: 'MSG',
    description: '查看会话状态、轨迹和运行绑定信息。',
    signal: '会话状态',
  },
  {
    key: 'sandbox',
    group: 'runtime',
    label: 'Sandbox 管理',
    subtitle: 'Sandbox 与 OSAC',
    tag: 'SBX',
    description: '查看 Sandbox、归档记录和连通性状态。',
    signal: 'Sandbox 状态',
  },
  {
    key: 'audit',
    group: 'runtime',
    label: '审计日志',
    subtitle: '操作追踪',
    tag: 'LOG',
    description: '查看操作记录、结果状态和时间线。',
    signal: '结果回溯',
  },
  {
    key: 'agent',
    group: 'platform',
    label: '智能体管理',
    subtitle: '智能体运行状态',
    tag: 'AGT',
    description: '查看服务健康、能力分布和会话状态。',
    signal: '服务健康',
  },
  {
    key: 'skill',
    group: 'platform',
    label: '技能管理',
    subtitle: '平台技能与 revision',
    tag: 'SKL',
    description: '维护 skill、revision 和校验结果。',
    signal: '技能管理',
  },
  {
    key: 'connectorGuide',
    group: 'platform',
    label: '连接器 Guide',
    subtitle: '隐式引导与发布',
    tag: 'CGD',
    description: '维护 policy、revision、validation 和发布记录。',
    signal: '引导策略',
  },
  {
    key: 'osacRelease',
    group: 'platform',
    label: 'OSAC 版本',
    subtitle: '工件发布与当前版本',
    tag: 'OSA',
    description: '管理上传、校验、发布和回滚。',
    signal: '工件发布',
  },
];

// 运行态状态色板：统一 KVM/Sandbox 运行状态的可视化语义。
const VM_STATE_COLORS: Record<string, string> = {
  running: '#0f766e',
  stopped: '#94a3b8',
  paused: '#f59e0b',
  error: '#dc2626',
};

// 列表默认分页和“加载更多”步长，控制 Sandbox 运行时列表的性能与体验。
const SANDBOX_RUNTIME_PAGE_SIZE = 80;
const SANDBOX_RUNTIME_LOAD_MORE_STEP = 40;

// 运行时列表排序参数。
type RuntimeSortKey = 'task_session' | 'sandbox' | 'executor' | 'status' | 'risk' | 'last_active';
type RuntimeSortDirection = 'asc' | 'desc';
type RuntimeSortState = {
  key: RuntimeSortKey;
  direction: RuntimeSortDirection;
};
type RuntimeColumnKey = 'task_session' | 'sandbox' | 'executor' | 'status' | 'risk' | 'last_active' | 'actions';
type ArchiveSortKey = 'time' | 'type' | 'size' | 'reason' | 'status';
type ArchiveSortState = {
  key: ArchiveSortKey;
  direction: RuntimeSortDirection;
};
type ArchiveColumnKey = 'time' | 'type' | 'size' | 'reason' | 'status' | 'actions';

const DEFAULT_RUNTIME_SORT: RuntimeSortState = {
  key: 'risk',
  direction: 'desc',
};

const DEFAULT_RUNTIME_COLUMN_WIDTHS: Record<RuntimeColumnKey, number> = {
  task_session: 228,
  sandbox: 212,
  executor: 128,
  status: 232,
  risk: 174,
  last_active: 170,
  actions: 236,
};

const RUNTIME_COLUMN_MIN_WIDTHS: Record<RuntimeColumnKey, number> = {
  task_session: 168,
  sandbox: 156,
  executor: 108,
  status: 186,
  risk: 132,
  last_active: 130,
  actions: 206,
};

const DEFAULT_ARCHIVE_SORT: ArchiveSortState = {
  key: 'time',
  direction: 'desc',
};

const DEFAULT_ARCHIVE_COLUMN_WIDTHS: Record<ArchiveColumnKey, number> = {
  time: 210,
  type: 112,
  size: 108,
  reason: 228,
  status: 126,
  actions: 248,
};

const ARCHIVE_COLUMN_MIN_WIDTHS: Record<ArchiveColumnKey, number> = {
  time: 150,
  type: 88,
  size: 84,
  reason: 156,
  status: 96,
  actions: 208,
};

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function formatValue(value: string | number | undefined | null, suffix = '') {
  if (value === undefined || value === null || value === '') {
    return '-';
  }
  return `${value}${suffix}`;
}

function truncateMiddle(value: string | null | undefined, head = 8, tail = 6) {
  if (!value) return '-';
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

function toTimestamp(value?: string | null) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function stateClassName(state: string) {
  return `status-pill status-${state}`;
}

function statusLabel(status: string) {
  if (status === 'in_progress') return '进行中';
  if (status === 'waiting_user') return '待用户确认';
  if (status === 'completed') return '已完成';
  if (status === 'failed') return '失败';
  return status;
}

function adminRoleLabel(role?: string | null) {
  if (role === 'super_admin') return '超级管理员';
  if (role === 'admin') return '管理员';
  return role || '-';
}

function adminDisplayNameLabel(displayName?: string | null, loginName?: string | null) {
  if (displayName === 'Platform Admin') return '平台管理员';
  return displayName || loginName || '-';
}

function capabilityStatusLabel(status?: string | null) {
  if (status === 'available') return '可用';
  if (status === 'planned') return '规划中';
  if (status === 'draft') return '草稿';
  if (status === 'active') return '启用';
  if (status === 'archived') return '已归档';
  return status || '-';
}

function archiveStatusLabel(status?: string | null) {
  if (status === 'up_to_date') return '已同步';
  if (status === 'archived') return '已归档';
  if (status === 'in_progress') return '进行中';
  if (status === 'failed') return '失败';
  if (status === 'none') return '无';
  if (status === 'unknown') return '未知';
  return status || '-';
}

function sandboxSourceLabel(source?: string | null) {
  if (source === 'tracked') return '已纳管';
  if (source === 'live_only') return '仅在线';
  return source || '-';
}

function sandboxDedupeReasonLabel(reason?: string | null) {
  if (reason === 'task_runtime_rebound') return '同任务新实例已接管';
  return reason || '已被新实例接管';
}

function sandboxJumpLabel(sandboxId?: string | null) {
  return sandboxId ? truncateMiddle(sandboxId, 8, 6) : '-';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function recordString(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function environmentMetadataRecord(environment?: SandboxEnvironmentItem | null) {
  return asRecord(environment?.metadata);
}

function environmentSandboxId(environment?: SandboxEnvironmentItem | null): string | null {
  const metadata = environmentMetadataRecord(environment);
  const e2b = asRecord(metadata?.e2b);
  return recordString(e2b, 'sandboxId') || environment?.orchestratorSessionId || environment?.sessionId || null;
}

function environmentTaskSessionId(environment?: SandboxEnvironmentItem | null): string | null {
  const metadata = environmentMetadataRecord(environment);
  return recordString(metadata, 'taskSessionId');
}

function environmentExecutor(environment?: SandboxEnvironmentItem | null): string | null {
  const metadata = environmentMetadataRecord(environment);
  return recordString(metadata, 'sandboxExecutor') || recordString(metadata, 'executor');
}

function environmentArchiveStatus(environment?: SandboxEnvironmentItem | null): string | null {
  const metadata = environmentMetadataRecord(environment);
  return recordString(metadata, 'archiveStatus');
}

function environmentReplacementSandboxId(environment?: SandboxEnvironmentItem | null): string | null {
  const metadata = environmentMetadataRecord(environment);
  return recordString(metadata, 'dedupeReplacementSandboxId');
}

function environmentDedupeReason(environment?: SandboxEnvironmentItem | null): string | null {
  const metadata = environmentMetadataRecord(environment);
  return recordString(metadata, 'dedupeReason');
}

function hostStatusLabel(status: string) {
  if (status === 'online') return '在线';
  if (status === 'degraded') return '降级';
  if (status === 'maintenance') return '维护';
  if (status === 'offline') return '离线';
  return status;
}

function hostStatusColor(status: string) {
  if (status === 'online') return '#047857';
  if (status === 'degraded') return '#b45309';
  if (status === 'maintenance') return '#4f46e5';
  return '#b91c1c';
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '-';
  }
  return `${value.toFixed(1)}%`;
}

function toJsonText(value: unknown) {
  if (value === undefined) return '-';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

type SandboxFileItem = {
  path: string;
  label: string;
  kind: 'dir' | 'file' | 'item';
};

function normalizeSandboxFileItems(value: unknown, basePath: string): SandboxFileItem[] {
  const source =
    value && typeof value === 'object'
      ? ((value as Record<string, unknown>).items ??
          (value as Record<string, unknown>).entries ??
          (value as Record<string, unknown>).files ??
          value)
      : value;
  const list = Array.isArray(source) ? source : [];
  const next = new Map<string, SandboxFileItem>();

  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const rawPath =
      (typeof record.path === 'string' && record.path) ||
      (typeof record.name === 'string' && record.name) ||
      (typeof record.filename === 'string' && record.filename) ||
      (typeof record.file === 'string' && record.file) ||
      '';
    if (!rawPath) continue;
    const path = rawPath.startsWith('/') ? rawPath : `${basePath.replace(/\/$/, '')}/${rawPath}`;
    const typeRaw = String(record.type ?? record.kind ?? '');
    const isDir = record.isDir === true || typeRaw.toLowerCase().includes('dir');
    const label = path.split('/').filter(Boolean).at(-1) || path;
    next.set(path, {
      path,
      label,
      kind: isDir ? 'dir' : typeRaw ? 'file' : 'item',
    });
  }

  return Array.from(next.values()).sort((a, b) => {
    if (a.kind === 'dir' && b.kind !== 'dir') return -1;
    if (a.kind !== 'dir' && b.kind === 'dir') return 1;
    return a.label.localeCompare(b.label);
  });
}

function formatTerminalEntry(command: string, result: unknown) {
  const lines: string[] = [`$ ${command}`];
  if (result && typeof result === 'object') {
    const payload = result as Record<string, unknown>;
    const stdout = typeof payload.stdout === 'string' ? payload.stdout : '';
    const stderr = typeof payload.stderr === 'string' ? payload.stderr : '';
    const exitCode = payload.exitCode;
    if (stdout.trim()) lines.push(stdout.trimEnd());
    if (stderr.trim()) lines.push(`[stderr]\n${stderr.trimEnd()}`);
    if (typeof exitCode === 'number') lines.push(`[exit ${exitCode}]`);
  }
  if (lines.length === 1) {
    lines.push(toJsonText(result));
  }
  return lines.join('\n');
}

function summarizeText(value: string | undefined, max = 260) {
  if (!value) return '';
  const compact = value.replace(/\s+/g, ' ').trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max)}...`;
}

function formatStateSnapshot(snapshot?: { status?: string; stage?: string; phase?: string }) {
  const status = snapshot?.status || '-';
  const stage = snapshot?.stage || '-';
  const phase = snapshot?.phase || '-';
  return `status=${status} stage=${stage} phase=${phase}`;
}

function uniqueSorted(values: Array<string | undefined | null>) {
  const set = new Set<string>();
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      set.add(value.trim());
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function parseFilterTime(value: string): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return '-';
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}

function asArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function buildExportFilename(sessionId: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `conversation-${sessionId}-${stamp}.json`;
}

function buildTransitionSearchText(transition: {
  from?: { status?: string; stage?: string; phase?: string };
  to?: { status?: string; stage?: string; phase?: string };
  trigger?: {
    messageType?: string;
    role?: string;
    agent?: string;
    tone?: string;
    content?: string;
  };
}) {
  const parts = [
    transition.from?.status,
    transition.from?.stage,
    transition.from?.phase,
    transition.to?.status,
    transition.to?.stage,
    transition.to?.phase,
    transition.trigger?.messageType,
    transition.trigger?.role,
    transition.trigger?.agent,
    transition.trigger?.tone,
    transition.trigger?.content,
  ];
  return parts.filter(Boolean).join(' ').toLowerCase();
}

function traceLevelClass(level: string) {
  if (level === 'error') return 'trace-level error';
  if (level === 'warn') return 'trace-level warn';
  return 'trace-level info';
}

function resultClassName(result: string) {
  return `status-pill result-pill result-${result}`;
}

const DEFAULT_TRANSITION_FILTERS = {
  fromStage: 'all',
  toStage: 'all',
  status: 'all',
  phase: 'all',
  role: 'all',
  messageType: 'all',
  agent: 'all',
  tone: 'all',
  fromTime: '',
  toTime: '',
};

export default function App() {
  const [authStatus, setAuthStatus] = useState<'loading' | 'authenticated' | 'anonymous'>('loading');
  const [adminUser, setAdminUser] = useState<AdminUser | null>(null);
  const [loginName, setLoginName] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<SectionKey>('kvm');

  const [kvmOverview, setKvmOverview] = useState<DashboardOverview | null>(null);
  const [vms, setVms] = useState<VmItem[]>([]);
  const [hosts, setHosts] = useState<HostListResponse['hosts']>([]);
  const [hostTrendMap, setHostTrendMap] = useState<Record<string, HostTrendPoint[]>>({});
  const [busyVmIds, setBusyVmIds] = useState<Record<string, boolean>>({});

  const [conversationSessions, setConversationSessions] = useState<ConversationSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [conversationDetail, setConversationDetail] = useState<ConversationSessionDetailResponse | null>(null);
  const [conversationDetailLoading, setConversationDetailLoading] = useState(false);
  const [conversationInfraError, setConversationInfraError] = useState<string | null>(null);
  const [conversationSearchQuery, setConversationSearchQuery] = useState('');
  const [conversationStatusFilter, setConversationStatusFilter] = useState<'all' | 'in_progress' | 'waiting_user' | 'failed' | 'completed'>('all');
  const [conversationAutoRefreshEnabled, setConversationAutoRefreshEnabled] = useState(true);
  const [showOpencodePayload, setShowOpencodePayload] = useState(false);
  const [conversationGovernanceFilter, setConversationGovernanceFilter] = useState<string | null>(null);
  const [conversationEnvironmentGroupFilter, setConversationEnvironmentGroupFilter] = useState<string | null>(null);
  const [conversationWorkspaceTab, setConversationWorkspaceTab] = useState<'transitions' | 'timeline' | 'messages' | 'llm'>('transitions');
  const [transitionView, setTransitionView] = useState<'timeline' | 'list'>('timeline');
  const [transitionQuery, setTransitionQuery] = useState('');
  const [transitionFilters, setTransitionFilters] = useState(DEFAULT_TRANSITION_FILTERS);
  const [transitionAdvancedFiltersOpen, setTransitionAdvancedFiltersOpen] = useState(false);

  const [agentOverview, setAgentOverview] = useState<AgentManagementOverview | null>(null);
  const [sandboxOverview, setSandboxOverview] = useState<SandboxManagementOverview | null>(null);
  const [sandboxRuntimeRegistry, setSandboxRuntimeRegistry] = useState<SandboxRuntimeRegistry | null>(null);
  const [sandboxRuntimeDetail, setSandboxRuntimeDetail] = useState<SandboxRuntimeDetail | null>(null);
  const [sandboxDetail, setSandboxDetail] = useState<E2bSandboxDetail | null>(null);
  const [sandboxArchiveHistory, setSandboxArchiveHistory] = useState<SandboxArchiveHistoryEntry[]>([]);
  const [sandboxModalOpen, setSandboxModalOpen] = useState(false);
  const [sandboxTab, setSandboxTab] = useState<'overview' | 'runtime' | 'templates'>('runtime');
  const [sandboxRuntimeQuery, setSandboxRuntimeQuery] = useState('');
  const [sandboxExecutorFilter, setSandboxExecutorFilter] = useState('all');
  const [sandboxStatusFilter, setSandboxStatusFilter] = useState('all');
  const [sandboxRiskFilter, setSandboxRiskFilter] = useState('all');
  const [runtimeSort, setRuntimeSort] = useState<RuntimeSortState>(DEFAULT_RUNTIME_SORT);
  const [runtimeColumnWidths, setRuntimeColumnWidths] = useState<Record<RuntimeColumnKey, number>>(DEFAULT_RUNTIME_COLUMN_WIDTHS);
  const [archiveSort, setArchiveSort] = useState<ArchiveSortState>(DEFAULT_ARCHIVE_SORT);
  const [archiveColumnWidths, setArchiveColumnWidths] = useState<Record<ArchiveColumnKey, number>>(DEFAULT_ARCHIVE_COLUMN_WIDTHS);
  const [sandboxRegistryLimit, setSandboxRegistryLimit] = useState(SANDBOX_RUNTIME_PAGE_SIZE);
  const [sandboxRegistryLoadingMore, setSandboxRegistryLoadingMore] = useState(false);
  const [sandboxRegistryLoadMoreError, setSandboxRegistryLoadMoreError] = useState<string | null>(null);
  const [sandboxDetailTab, setSandboxDetailTab] = useState<'overview' | 'connectivity' | 'archive' | 'advanced'>('overview');
  const [sandboxFullInfo, setSandboxFullInfo] = useState<E2bSandboxFullInfo | null>(null);
  const [pendingSandboxJumpId, setPendingSandboxJumpId] = useState<string | null>(null);
  const [sandboxConnectivityResult, setSandboxConnectivityResult] = useState<unknown>(null);
  const [sandboxToolAction, setSandboxToolAction] = useState('command.run');
  const [sandboxToolPayload, setSandboxToolPayload] = useState('{"cmd":"ls"}');
  const [sandboxToolResult, setSandboxToolResult] = useState<unknown>(null);
  const [sandboxCommandInput, setSandboxCommandInput] = useState('pwd && ls -la');
  const [sandboxTerminalOutput, setSandboxTerminalOutput] = useState('');
  const [sandboxFilePath, setSandboxFilePath] = useState('/');
  const [sandboxFileItems, setSandboxFileItems] = useState<SandboxFileItem[]>([]);
  const [sandboxFileContent, setSandboxFileContent] = useState('');
  const [sandboxProcessResult, setSandboxProcessResult] = useState<unknown>(null);
  const [sandboxPidInput, setSandboxPidInput] = useState('');
  const [sandboxPortInput, setSandboxPortInput] = useState('3000');
  const [sandboxPortResult, setSandboxPortResult] = useState<unknown>(null);
  const [sandboxCreatePayload, setSandboxCreatePayload] = useState(
    '{"template":"opencode-playwright-mcp-v2-min-eko","timeoutMs":300000}'
  );
  const [sandboxCreateDrawerOpen, setSandboxCreateDrawerOpen] = useState(false);
  const [archiveDetailRow, setArchiveDetailRow] = useState<{
    id: string;
    snapshotKey: string | null;
    timestamp: string | null;
    type: string;
    size: string;
    hash: string;
    status: string;
    reason: string;
  } | null>(null);

  const [templates, setTemplates] = useState<E2bTemplate[]>([]);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [templateDetail, setTemplateDetail] = useState<E2bTemplateWithBuilds | null>(null);
  const [templateBuildLogs, setTemplateBuildLogs] = useState<E2bTemplateBuildLogsResponse | null>(null);
  const [templateBuildStatus, setTemplateBuildStatus] = useState<E2bTemplateBuildInfo | null>(null);
  const [templateActionPayload, setTemplateActionPayload] = useState('{}');
  const [templateAliasQuery, setTemplateAliasQuery] = useState('');
  const [templateAliasResult, setTemplateAliasResult] = useState<unknown>(null);
  const [sandboxBusyIds, setSandboxBusyIds] = useState<Record<string, boolean>>({});
  const [auditEntries, setAuditEntries] = useState<AuditLogEntry[]>([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sandboxSectionRequestRef = useRef<Promise<void> | null>(null);
  const sandboxOverviewRequestRef = useRef<Promise<void> | null>(null);
  const sandboxRuntimeRegistryRequestRef = useRef<Promise<void> | null>(null);
  const sandboxRegistryLimitRef = useRef(SANDBOX_RUNTIME_PAGE_SIZE);
  const runtimeColumnResizeRef = useRef<{
    columnKey: RuntimeColumnKey;
    startX: number;
    startWidth: number;
  } | null>(null);
  const archiveColumnResizeRef = useRef<{
    columnKey: ArchiveColumnKey;
    startX: number;
    startWidth: number;
  } | null>(null);
  const conversationDetailCacheRef = useRef<Map<string, ConversationSessionDetailResponse>>(new Map());

  const bootstrapAdminSession = useCallback(async () => {
    try {
      const result = await api.getCurrentAdmin();
      setAdminUser(result.adminUser);
      setAuthStatus('authenticated');
      setAuthError(null);
    } catch {
      setAdminUser(null);
      setAuthStatus('anonymous');
      setAuthError(null);
    }
  }, []);

  const loadKvmSection = useCallback(async () => {
    const [overviewResult, vmResult, hostResult] = await Promise.allSettled([
      api.getOverview(),
      api.listVms({ withState: false, limit: 200, offset: 0 }),
      api.listHosts(),
    ]);

    if (overviewResult.status === 'fulfilled') {
      setKvmOverview(overviewResult.value);
    }

    setVms(vmResult.status === 'fulfilled' ? vmResult.value.vms : []);
    const nextHosts = hostResult.status === 'fulfilled' ? hostResult.value.hosts : [];
    setHosts(nextHosts);

    if (hostResult.status === 'fulfilled') {
      const sampledAt = Date.now();
      setHostTrendMap((previous) => {
        const updated: Record<string, HostTrendPoint[]> = {};
        for (const host of nextHosts) {
          const previousSeries = previous[host.hostId] || [];
          const nextPoint: HostTrendPoint = {
            timestamp: sampledAt,
            timeLabel: new Date(sampledAt).toLocaleTimeString('zh-CN', { hour12: false }),
            cpu: Number(host.cpuUsagePercent.toFixed(1)),
            memory: Number(host.memoryUsagePercent.toFixed(1)),
            storage: Number(host.storageUsagePercent.toFixed(1)),
          };

          const lastPoint = previousSeries[previousSeries.length - 1];
          const shouldAppend = !lastPoint || Math.abs(lastPoint.timestamp - nextPoint.timestamp) > 1000;

          const series = shouldAppend ? [...previousSeries, nextPoint] : previousSeries;
          updated[host.hostId] = series.slice(-30);
        }
        return updated;
      });
    }

    if (
      overviewResult.status === 'rejected' &&
      vmResult.status === 'rejected' &&
      hostResult.status === 'rejected'
    ) {
      throw new Error('KVM 模块请求失败，请检查后端与编排器连接状态');
    }
  }, []);

  const loadConversationSessions = useCallback(async () => {
    const result = await api.listConversationSessions(200);
    setConversationSessions(result.sessions);

    if (result.sessions.length > 0) {
      const nextId = selectedSessionId && result.sessions.some((item) => item.id === selectedSessionId)
        ? selectedSessionId
        : result.sessions[0].id;
      setSelectedSessionId(nextId);
    } else {
      setSelectedSessionId(null);
      setConversationDetail(null);
      setConversationDetailLoading(false);
    }
  }, [selectedSessionId]);

  const loadConversationDetail = useCallback(async (sessionId: string) => {
    const detail = await api.getConversationSessionCore(sessionId);
    setConversationDetail(detail);
  }, []);

  const exportConversationDetail = useCallback(() => {
    if (!conversationDetail) return;
    const payload = {
      exportedAt: new Date().toISOString(),
      session: conversationDetail.session,
      runtime: conversationDetail.runtime,
      intent: conversationDetail.intent,
      taskDescription: conversationDetail.taskDescription,
      executionPlan: conversationDetail.executionPlan,
      messages: conversationDetail.messages,
      trace: conversationDetail.trace,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = buildExportFilename(conversationDetail.session.id);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  }, [conversationDetail]);

  const closeParentDetails = useCallback((element: HTMLElement | null) => {
    const details = element?.closest('details');
    if (details instanceof HTMLDetailsElement) {
      details.open = false;
    }
  }, []);

  const toggleRuntimeSort = useCallback((key: RuntimeSortKey) => {
    setRuntimeSort((previous) => {
      if (previous.key === key) {
        return {
          key,
          direction: previous.direction === 'asc' ? 'desc' : 'asc',
        };
      }
      const initialDirection: RuntimeSortDirection = key === 'risk' || key === 'last_active' ? 'desc' : 'asc';
      return {
        key,
        direction: initialDirection,
      };
    });
  }, []);

  const beginRuntimeColumnResize = useCallback(
    (columnKey: RuntimeColumnKey, event: React.MouseEvent<HTMLSpanElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const startWidth = runtimeColumnWidths[columnKey] || DEFAULT_RUNTIME_COLUMN_WIDTHS[columnKey];
      runtimeColumnResizeRef.current = {
        columnKey,
        startX: event.clientX,
        startWidth,
      };

      const onPointerMove = (moveEvent: MouseEvent) => {
        const active = runtimeColumnResizeRef.current;
        if (!active) return;
        const minWidth = RUNTIME_COLUMN_MIN_WIDTHS[active.columnKey];
        const nextWidth = Math.max(minWidth, Math.round(active.startWidth + (moveEvent.clientX - active.startX)));
        setRuntimeColumnWidths((previous) => ({
          ...previous,
          [active.columnKey]: nextWidth,
        }));
      };

      const onPointerUp = () => {
        runtimeColumnResizeRef.current = null;
        window.removeEventListener('mousemove', onPointerMove);
        window.removeEventListener('mouseup', onPointerUp);
      };

      window.addEventListener('mousemove', onPointerMove);
      window.addEventListener('mouseup', onPointerUp);
    },
    [runtimeColumnWidths]
  );

  const toggleArchiveSort = useCallback((key: ArchiveSortKey) => {
    setArchiveSort((previous) => {
      if (previous.key === key) {
        return {
          key,
          direction: previous.direction === 'asc' ? 'desc' : 'asc',
        };
      }
      const initialDirection: RuntimeSortDirection = key === 'time' || key === 'size' ? 'desc' : 'asc';
      return {
        key,
        direction: initialDirection,
      };
    });
  }, []);

  const beginArchiveColumnResize = useCallback(
    (columnKey: ArchiveColumnKey, event: React.MouseEvent<HTMLSpanElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const startWidth = archiveColumnWidths[columnKey] || DEFAULT_ARCHIVE_COLUMN_WIDTHS[columnKey];
      archiveColumnResizeRef.current = {
        columnKey,
        startX: event.clientX,
        startWidth,
      };

      const onPointerMove = (moveEvent: MouseEvent) => {
        const active = archiveColumnResizeRef.current;
        if (!active) return;
        const minWidth = ARCHIVE_COLUMN_MIN_WIDTHS[active.columnKey];
        const nextWidth = Math.max(minWidth, Math.round(active.startWidth + (moveEvent.clientX - active.startX)));
        setArchiveColumnWidths((previous) => ({
          ...previous,
          [active.columnKey]: nextWidth,
        }));
      };

      const onPointerUp = () => {
        archiveColumnResizeRef.current = null;
        window.removeEventListener('mousemove', onPointerMove);
        window.removeEventListener('mouseup', onPointerUp);
      };

      window.addEventListener('mousemove', onPointerMove);
      window.addEventListener('mouseup', onPointerUp);
    },
    [archiveColumnWidths]
  );

  const loadAgentSection = useCallback(async () => {
    const result = await api.getAgentManagementOverview();
    setAgentOverview(result);
  }, []);

  const loadSandboxOverview = useCallback(async () => {
    if (sandboxOverviewRequestRef.current) {
      return sandboxOverviewRequestRef.current;
    }

    const request = (async () => {
      const overview = await api.getSandboxManagementOverview(80);
      setSandboxOverview(overview);
    })();

    sandboxOverviewRequestRef.current = request;
    try {
      await request;
    } finally {
      sandboxOverviewRequestRef.current = null;
    }
  }, []);

  const loadSandboxRuntimeRegistry = useCallback(async () => {
    if (sandboxRuntimeRegistryRequestRef.current) {
      return sandboxRuntimeRegistryRequestRef.current;
    }

    const request = (async () => {
      const registry = await api.getSandboxRuntimeRegistry(sandboxRegistryLimitRef.current);
      setSandboxRuntimeRegistry(registry);
    })();

    sandboxRuntimeRegistryRequestRef.current = request;
    try {
      await request;
    } finally {
      sandboxRuntimeRegistryRequestRef.current = null;
    }
  }, []);

  const loadSandboxSection = useCallback(async () => {
    if (sandboxSectionRequestRef.current) {
      return sandboxSectionRequestRef.current;
    }

    const request = Promise.all([loadSandboxOverview(), loadSandboxRuntimeRegistry()]).then(() => undefined);
    sandboxSectionRequestRef.current = request;
    try {
      await request;
    } finally {
      sandboxSectionRequestRef.current = null;
    }
  }, [loadSandboxOverview, loadSandboxRuntimeRegistry]);

  const loadMoreSandboxRuntime = useCallback(async () => {
    const previousLimit = sandboxRegistryLimitRef.current;
    const nextLimit = previousLimit + SANDBOX_RUNTIME_LOAD_MORE_STEP;
    sandboxRegistryLimitRef.current = nextLimit;
    setSandboxRegistryLimit(nextLimit);
    setSandboxRegistryLoadingMore(true);
    setSandboxRegistryLoadMoreError(null);
    try {
      await loadSandboxRuntimeRegistry();
      setError(null);
      setSandboxRegistryLoadMoreError(null);
    } catch (requestError) {
      sandboxRegistryLimitRef.current = previousLimit;
      setSandboxRegistryLimit(previousLimit);
      const message = requestError instanceof Error ? requestError.message : '加载更多 Runtime 失败';
      setError(message);
      setSandboxRegistryLoadMoreError(message);
    } finally {
      setSandboxRegistryLoadingMore(false);
    }
  }, [loadSandboxRuntimeRegistry]);

  const loadTemplates = useCallback(async () => {
    const result = await api.listTemplates();
    setTemplates(result);
  }, []);

  const loadSandboxDetail = useCallback(async (sandboxId: string) => {
    const result = await api.getSandboxEnvironment(sandboxId);
    setSandboxDetail(result);
  }, []);

  const loadSandboxRuntimeDetail = useCallback(async (sandboxId: string) => {
    const [result, archiveHistory] = await Promise.all([
      api.getSandboxRuntimeDetail(sandboxId),
      api.getSandboxArchiveHistory(sandboxId).catch(() => []),
    ]);
    const runtimeDetailWithArchive = {
      ...result,
      archiveHistory,
    };
    setSandboxRuntimeDetail(runtimeDetailWithArchive);
    setSandboxArchiveHistory(archiveHistory);
    setSandboxDetail(result.liveSandboxDetail);
    setSandboxFullInfo(result.liveSandboxFullInfo);
    return runtimeDetailWithArchive;
  }, []);

  const loadSandboxFullInfo = useCallback(async (sandboxId: string) => {
    const result = await api.getSandboxFullInfo(sandboxId);
    setSandboxFullInfo(result);
  }, []);

  const openTemplateDetail = useCallback(async (templateId: string) => {
    const result = await api.getTemplate(templateId);
    setTemplateDetail(result);
    setTemplateBuildLogs(null);
    setTemplateBuildStatus(null);
    setTemplateModalOpen(true);
  }, []);

  const openSandboxDetail = useCallback(
    async (sandboxId: string) => {
      try {
        setError(null);
        const detail = await loadSandboxRuntimeDetail(sandboxId);
        setSandboxDetailTab('overview');
        setSandboxConnectivityResult(null);
        setSandboxToolResult(null);
        setSandboxTerminalOutput('');
        setSandboxFilePath(detail.connectivity.workspaceRoot?.trim() || '/');
        setSandboxFileContent('');
        setSandboxFileItems([]);
        setSandboxProcessResult(null);
        setSandboxPortResult(null);
        setSandboxModalOpen(true);
      } catch (detailError) {
        setError(detailError instanceof Error ? detailError.message : '加载 Sandbox 详情失败');
      }
    },
    [loadSandboxRuntimeDetail]
  );

  const closeSandboxDetail = useCallback(() => {
    setSandboxModalOpen(false);
  }, []);

  const closeTemplateDetail = useCallback(() => {
    setTemplateModalOpen(false);
  }, []);

  const copyRuntimeField = useCallback(async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setError(null);
    } catch {
      setError(`复制${label}失败`);
    }
  }, []);

  const openConversationSessionFromSandbox = useCallback((taskSessionId?: string | null) => {
    if (!taskSessionId) return;
    setError(null);
    setSandboxModalOpen(false);
    setConversationDetailLoading(true);
    setSelectedSessionId(taskSessionId);
    setActiveSection('conversation');
  }, []);

  const openSandboxFromConversation = useCallback((sandboxId?: string | null) => {
    if (!sandboxId) return;
    setError(null);
    setPendingSandboxJumpId(sandboxId);
    setActiveSection('sandbox');
  }, []);

  const closeSandbox = useCallback(
    async (sandboxId: string) => {
      setError(null);
      setSandboxBusyIds((prev) => ({ ...prev, [sandboxId]: true }));
      try {
        await api.closeSandboxEnvironment(sandboxId);
        setError(null);
        if (sandboxRuntimeDetail?.runtime.sandboxId === sandboxId) {
          const refreshed = await api.getSandboxRuntimeDetail(sandboxId).catch(() => null);
          setSandboxRuntimeDetail(refreshed);
        }
        await loadSandboxSection();
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : '关闭 Sandbox 失败');
      } finally {
        setSandboxBusyIds((prev) => ({ ...prev, [sandboxId]: false }));
      }
    },
    [loadSandboxSection, sandboxRuntimeDetail?.runtime.sandboxId]
  );

  const pauseSandbox = useCallback(
    async (sandboxId: string) => {
      setError(null);
      setSandboxBusyIds((prev) => ({ ...prev, [sandboxId]: true }));
      try {
        await api.pauseSandboxEnvironment(sandboxId);
        setError(null);
        await loadSandboxSection();
        if (sandboxRuntimeDetail?.runtime.sandboxId === sandboxId) {
          const refreshed = await api.getSandboxRuntimeDetail(sandboxId).catch(() => null);
          setSandboxRuntimeDetail(refreshed);
        }
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : '暂停 Sandbox 失败');
      } finally {
        setSandboxBusyIds((prev) => ({ ...prev, [sandboxId]: false }));
      }
    },
    [loadSandboxSection, sandboxRuntimeDetail?.runtime.sandboxId]
  );

  const resumeSandbox = useCallback(
    async (sandboxId: string) => {
      setError(null);
      setSandboxBusyIds((prev) => ({ ...prev, [sandboxId]: true }));
      try {
        await api.resumeSandboxEnvironment(sandboxId);
        setError(null);
        await loadSandboxSection();
        if (sandboxRuntimeDetail?.runtime.sandboxId === sandboxId) {
          const refreshed = await api.getSandboxRuntimeDetail(sandboxId).catch(() => null);
          setSandboxRuntimeDetail(refreshed);
        }
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : '恢复 Sandbox 失败');
      } finally {
        setSandboxBusyIds((prev) => ({ ...prev, [sandboxId]: false }));
      }
    },
    [loadSandboxSection, sandboxRuntimeDetail?.runtime.sandboxId]
  );

  const openSandbox = useCallback(
    async (sandboxId: string) => {
      setError(null);
      setSandboxBusyIds((prev) => ({ ...prev, [sandboxId]: true }));
      try {
        await api.openSandboxEnvironment(sandboxId);
        setError(null);
        await loadSandboxSection();
        if (sandboxRuntimeDetail?.runtime.sandboxId === sandboxId) {
          await loadSandboxRuntimeDetail(sandboxId);
        }
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : '开机失败');
      } finally {
        setSandboxBusyIds((prev) => ({ ...prev, [sandboxId]: false }));
      }
    },
    [loadSandboxRuntimeDetail, loadSandboxSection, sandboxRuntimeDetail?.runtime.sandboxId]
  );

  const restartSandbox = useCallback(
    async (sandboxId: string) => {
      setError(null);
      setSandboxBusyIds((prev) => ({ ...prev, [sandboxId]: true }));
      try {
        await api.restartSandboxEnvironment(sandboxId);
        setError(null);
        await loadSandboxSection();
        if (sandboxRuntimeDetail?.runtime.sandboxId === sandboxId) {
          await loadSandboxRuntimeDetail(sandboxId);
        }
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : '重启 Sandbox 失败');
      } finally {
        setSandboxBusyIds((prev) => ({ ...prev, [sandboxId]: false }));
      }
    },
    [loadSandboxRuntimeDetail, loadSandboxSection, sandboxRuntimeDetail?.runtime.sandboxId]
  );

  const runSandboxTool = useCallback(async () => {
    const sandboxId = sandboxRuntimeDetail?.runtime.sandboxId || sandboxDetail?.sandboxId;
    if (!sandboxId) return;
    try {
      const payload = sandboxToolPayload.trim() ? (JSON.parse(sandboxToolPayload) as Record<string, unknown>) : undefined;
      const result = await api.runSandboxToolAction(sandboxId, sandboxToolAction, payload);
      setSandboxToolResult(result);
    } catch (toolError) {
      setError(toolError instanceof Error ? toolError.message : '执行工具操作失败');
    }
  }, [sandboxRuntimeDetail?.runtime.sandboxId, sandboxDetail?.sandboxId, sandboxToolAction, sandboxToolPayload]);

  const runSandboxCommand = useCallback(async () => {
    const sandboxId = sandboxRuntimeDetail?.runtime.sandboxId || sandboxDetail?.sandboxId;
    if (!sandboxId || !sandboxCommandInput.trim()) return;
    try {
      const command = sandboxCommandInput.trim();
      const result = await api.runSandboxToolAction(sandboxId, 'command.run', {
        cmd: command,
      });
      setSandboxTerminalOutput((prev) => `${prev}${prev ? '\n\n' : ''}${formatTerminalEntry(command, result)}`);
      setSandboxCommandInput('');
    } catch (toolError) {
      setError(toolError instanceof Error ? toolError.message : '执行命令失败');
    }
  }, [sandboxRuntimeDetail?.runtime.sandboxId, sandboxDetail?.sandboxId, sandboxCommandInput]);

  const loadSandboxProcesses = useCallback(async () => {
    const sandboxId = sandboxRuntimeDetail?.runtime.sandboxId || sandboxDetail?.sandboxId;
    if (!sandboxId) return;
    try {
      const result = await api.runSandboxToolAction(sandboxId, 'command.list');
      setSandboxProcessResult(result);
    } catch (toolError) {
      setError(toolError instanceof Error ? toolError.message : '获取进程列表失败');
    }
  }, [sandboxRuntimeDetail?.runtime.sandboxId, sandboxDetail?.sandboxId]);

  const killSandboxProcess = useCallback(async () => {
    const sandboxId = sandboxRuntimeDetail?.runtime.sandboxId || sandboxDetail?.sandboxId;
    const pid = Number(sandboxPidInput);
    if (!sandboxId || !Number.isFinite(pid) || pid <= 0) return;
    try {
      const result = await api.runSandboxToolAction(sandboxId, 'command.kill', { pid });
      setSandboxProcessResult(result);
      setSandboxPidInput('');
    } catch (toolError) {
      setError(toolError instanceof Error ? toolError.message : '结束进程失败');
    }
  }, [sandboxRuntimeDetail?.runtime.sandboxId, sandboxDetail?.sandboxId, sandboxPidInput]);

  const listSandboxFiles = useCallback(async () => {
    const sandboxId = sandboxRuntimeDetail?.runtime.sandboxId || sandboxDetail?.sandboxId;
    if (!sandboxId || !sandboxFilePath.trim()) return;
    try {
      setError(null);
      const result = await api.runSandboxToolAction(sandboxId, 'files.list', {
        path: sandboxFilePath.trim(),
      });
      const items = normalizeSandboxFileItems(result, sandboxFilePath.trim());
      setSandboxFileItems(items);
    } catch (toolError) {
      setSandboxFileItems([]);
      setError(toolError instanceof Error ? toolError.message : '查看目录失败');
    }
  }, [sandboxRuntimeDetail?.runtime.sandboxId, sandboxDetail?.sandboxId, sandboxFilePath]);

  const readSandboxFile = useCallback(async () => {
    const sandboxId = sandboxRuntimeDetail?.runtime.sandboxId || sandboxDetail?.sandboxId;
    if (!sandboxId || !sandboxFilePath.trim()) return;
    try {
      const result = await api.runSandboxToolAction(sandboxId, 'files.read', {
        path: sandboxFilePath.trim(),
      });
      if (typeof result === 'string') {
        setSandboxFileContent(result);
      } else if (result && typeof result === 'object' && 'content' in (result as Record<string, unknown>)) {
        const content = (result as Record<string, unknown>).content;
        setSandboxFileContent(typeof content === 'string' ? content : toJsonText(content));
      }
    } catch (toolError) {
      setError(toolError instanceof Error ? toolError.message : '读取文件失败');
    }
  }, [sandboxRuntimeDetail?.runtime.sandboxId, sandboxDetail?.sandboxId, sandboxFilePath]);

  const writeSandboxFile = useCallback(async () => {
    const sandboxId = sandboxRuntimeDetail?.runtime.sandboxId || sandboxDetail?.sandboxId;
    if (!sandboxId || !sandboxFilePath.trim()) return;
    try {
      await api.runSandboxToolAction(sandboxId, 'files.write', {
        path: sandboxFilePath.trim(),
        data: sandboxFileContent,
      });
      setSandboxTerminalOutput((prev) => `${prev}${prev ? '\n\n' : ''}[file] saved ${sandboxFilePath.trim()}`);
    } catch (toolError) {
      setError(toolError instanceof Error ? toolError.message : '下发文件失败');
    }
  }, [sandboxRuntimeDetail?.runtime.sandboxId, sandboxDetail?.sandboxId, sandboxFilePath, sandboxFileContent]);

  const inspectSandboxPorts = useCallback(async () => {
    const sandboxId = sandboxRuntimeDetail?.runtime.sandboxId || sandboxDetail?.sandboxId;
    if (!sandboxId) return;
    try {
      const result = await api.runSandboxToolAction(sandboxId, 'command.run', {
        cmd: `sh -lc "ss -ltnp 2>/dev/null || netstat -ltnp 2>/dev/null || lsof -i -P -n 2>/dev/null"`,
      });
      setSandboxPortResult(result);
    } catch (toolError) {
      setError(toolError instanceof Error ? toolError.message : '查看端口失败');
    }
  }, [sandboxRuntimeDetail?.runtime.sandboxId, sandboxDetail?.sandboxId]);

  const resolveSandboxHost = useCallback(async () => {
    const sandboxId = sandboxRuntimeDetail?.runtime.sandboxId || sandboxDetail?.sandboxId;
    const port = Number(sandboxPortInput);
    if (!sandboxId || !Number.isFinite(port) || port <= 0) return;
    try {
      const result = await api.runSandboxToolAction(sandboxId, 'sandbox.host', {
        port,
      });
      setSandboxPortResult(result);
    } catch (toolError) {
      setError(toolError instanceof Error ? toolError.message : '查询端口映射失败');
    }
  }, [sandboxRuntimeDetail?.runtime.sandboxId, sandboxDetail?.sandboxId, sandboxPortInput]);

  const createSandbox = useCallback(async () => {
    try {
      setError(null);
      const payload = sandboxCreatePayload.trim()
        ? (JSON.parse(sandboxCreatePayload) as Record<string, unknown>)
        : {};
      await api.createSandboxEnvironment(payload);
      setSandboxCreateDrawerOpen(false);
      await loadSandboxSection();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '创建 Sandbox 失败');
    }
  }, [sandboxCreatePayload, loadSandboxSection]);

  const runSandboxArchive = useCallback(
    async (sandboxId: string) => {
      setError(null);
      setSandboxBusyIds((prev) => ({ ...prev, [sandboxId]: true }));
      try {
        await api.archiveSandboxEnvironment(sandboxId);
        setError(null);
        await loadSandboxRuntimeDetail(sandboxId);
        await loadSandboxSection();
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : '触发归档失败');
      } finally {
        setSandboxBusyIds((prev) => ({ ...prev, [sandboxId]: false }));
      }
    },
    [loadSandboxRuntimeDetail, loadSandboxSection]
  );

  const runSandboxRestore = useCallback(
    async (sandboxId: string, snapshotKey?: string) => {
      setSandboxBusyIds((prev) => ({ ...prev, [sandboxId]: true }));
      try {
        await api.restoreSandboxEnvironment(sandboxId, snapshotKey ? { snapshotKey } : undefined);
        await loadSandboxRuntimeDetail(sandboxId);
        await loadSandboxSection();
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : '恢复归档失败');
      } finally {
        setSandboxBusyIds((prev) => ({ ...prev, [sandboxId]: false }));
      }
    },
    [loadSandboxRuntimeDetail, loadSandboxSection]
  );

  const downloadSandboxSnapshot = useCallback(async (sandboxId: string, snapshotKey?: string) => {
    setSandboxBusyIds((prev) => ({ ...prev, [sandboxId]: true }));
    try {
      const result = await api.getSandboxArchiveDownloadUrl(sandboxId, 3600, snapshotKey);
      const link = document.createElement('a');
      link.href = result.downloadUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.download = result.fileName || 'sandbox-snapshot.tar.gz';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setError(null);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '下载归档快照失败');
    } finally {
      setSandboxBusyIds((prev) => ({ ...prev, [sandboxId]: false }));
    }
  }, []);

  const runSandboxConnectivityCheck = useCallback(async (sandboxId: string) => {
    try {
      const result = await api.checkSandboxConnectivity(sandboxId);
      setSandboxConnectivityResult(result);
      const refreshed = await api.getSandboxRuntimeDetail(sandboxId).catch(() => null);
      setSandboxRuntimeDetail(refreshed);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '执行连通性检查失败');
    }
  }, []);

  const updateTemplateDetail = useCallback(async (templateId: string) => {
    const detail = await api.getTemplate(templateId);
    setTemplateDetail(detail);
  }, []);

  const runTemplateAction = useCallback(
    async (action: 'create' | 'update' | 'rebuild' | 'delete' | 'tags-assign' | 'tags-delete') => {
      try {
        const payload = templateActionPayload.trim()
          ? (JSON.parse(templateActionPayload) as Record<string, unknown>)
          : {};
        const reason = action === 'delete' || action === 'rebuild' ? window.prompt('请输入操作备注（必填）') : 'ok';
        if ((action === 'delete' || action === 'rebuild') && !reason) return;
        if (action === 'create') {
          await api.createTemplate(payload);
        } else if (action === 'update' && templateDetail) {
          await api.updateTemplate(
            (templateDetail as any).templateID ?? (templateDetail as any).templateId ?? '',
            payload
          );
        } else if (action === 'rebuild' && templateDetail) {
          await api.rebuildTemplate(
            (templateDetail as any).templateID ?? (templateDetail as any).templateId ?? '',
            payload
          );
        } else if (action === 'delete' && templateDetail) {
          await api.deleteTemplate((templateDetail as any).templateID ?? (templateDetail as any).templateId ?? '');
          setTemplateModalOpen(false);
        } else if (action === 'tags-assign') {
          await api.assignTemplateTags(payload);
        } else if (action === 'tags-delete') {
          await api.deleteTemplateTags(payload);
        }
        await loadTemplates();
        if (templateDetail) {
          await updateTemplateDetail((templateDetail as any).templateID ?? (templateDetail as any).templateId ?? '');
        }
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : '模板操作失败');
      }
    },
    [templateActionPayload, templateDetail, loadTemplates, updateTemplateDetail]
  );

  const checkAlias = useCallback(async () => {
    if (!templateAliasQuery.trim()) return;
    try {
      const result = await api.checkTemplateAlias(templateAliasQuery.trim());
      setTemplateAliasResult(result);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '别名查询失败');
    }
  }, [templateAliasQuery]);

  const loadTemplateBuildLogs = useCallback(async (templateId: string, buildId: string) => {
    const logs = await api.getTemplateBuildLogs(templateId, buildId);
    setTemplateBuildLogs(logs);
  }, []);

  const loadTemplateBuildStatus = useCallback(async (templateId: string, buildId: string) => {
    const status = await api.getTemplateBuildStatus(templateId, buildId);
    setTemplateBuildStatus(status);
  }, []);

  const loadAuditSection = useCallback(async () => {
    const result = await api.listAudit(80);
    setAuditEntries(result.entries);
  }, []);

  const loadSection = useCallback(
    async (section: SectionKey, initial = false) => {
      if (initial) {
        setLoading(true);
      }
      setRefreshing(true);

      try {
        if (section === 'kvm') {
          await Promise.all([loadKvmSection(), loadAuditSection()]);
        } else if (section === 'conversation') {
          await loadConversationSessions();
        } else if (section === 'agent') {
          await loadAgentSection();
        } else if (section === 'skill') {
          setError(null);
        } else if (section === 'connectorGuide') {
          setError(null);
        } else if (section === 'sandbox') {
          if (sandboxTab === 'templates') {
            await loadTemplates();
          } else {
            await loadSandboxSection();
          }
        } else {
          await loadAuditSection();
        }
        setError(null);
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : '数据加载失败');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [
      sandboxTab,
      loadAgentSection,
      loadAuditSection,
      loadConversationSessions,
      loadKvmSection,
      loadSandboxSection,
      loadTemplates,
    ]
  );

  useEffect(() => {
    void bootstrapAdminSession();
  }, [bootstrapAdminSession]);

  useEffect(() => {
    sandboxRegistryLimitRef.current = sandboxRegistryLimit;
  }, [sandboxRegistryLimit]);

  useEffect(() => {
    if (authStatus !== 'authenticated') {
      return;
    }
    loadSection(activeSection, true);
  }, [activeSection, authStatus, loadSection]);

  useEffect(() => {
    if (authStatus !== 'authenticated') {
      return;
    }
    if (activeSection !== 'sandbox' || !pendingSandboxJumpId) {
      return;
    }

    const targetSandboxId = pendingSandboxJumpId;
    void openSandboxDetail(targetSandboxId).finally(() => {
      setPendingSandboxJumpId((current) => (current === targetSandboxId ? null : current));
    });
  }, [activeSection, authStatus, openSandboxDetail, pendingSandboxJumpId]);

  useEffect(() => {
    if (authStatus !== 'authenticated') {
      return;
    }
    if (activeSection !== 'kvm' && activeSection !== 'sandbox') {
      return;
    }

    const timer = window.setInterval(() => {
      if (activeSection === 'sandbox') {
        const refresh = sandboxTab === 'templates' ? loadTemplates : loadSandboxSection;
        void refresh().catch((requestError) => {
          setError(requestError instanceof Error ? requestError.message : 'Sandbox 自动刷新失败');
        });
        return;
      }
      void loadKvmSection().catch((requestError) => {
        setError(requestError instanceof Error ? requestError.message : 'KVM 自动刷新失败');
      });
    }, 15000);

    return () => {
      window.clearInterval(timer);
    };
  }, [activeSection, authStatus, sandboxTab, loadKvmSection, loadSandboxSection, loadTemplates]);

  useEffect(() => {
    if (authStatus !== 'authenticated') {
      return;
    }
    if (!selectedSessionId || activeSection !== 'conversation') {
      return;
    }

    const cachedDetail = conversationDetailCacheRef.current.get(selectedSessionId);
    if (cachedDetail) {
      setConversationDetail(cachedDetail);
      setConversationDetailLoading(false);
    }

    let cancelled = false;
    const run = async () => {
      if (!cachedDetail) {
        setConversationDetailLoading(true);
      }
      try {
        const detail = await api.getConversationSessionCore(selectedSessionId);
        if (!cancelled) {
          conversationDetailCacheRef.current.set(selectedSessionId, detail);
          setConversationDetail(detail);
          setConversationInfraError(null);
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : '加载会话详情失败');
        }
      } finally {
        if (!cancelled) {
          setConversationDetailLoading(false);
        }
      }
    };

    void run();

    void api.listConversationSessions(200)
      .then((sessions) => {
        if (!cancelled) {
          setConversationSessions(sessions.sessions);
        }
      })
      .catch(() => {
        // ignore list refresh error here; detail view has higher priority
      });

    return () => {
      cancelled = true;
    };
  }, [activeSection, authStatus, selectedSessionId]);

  useEffect(() => {
    if (authStatus !== 'authenticated') {
      return;
    }
    if (!selectedSessionId || activeSection !== 'conversation' || !conversationAutoRefreshEnabled) {
      return;
    }

    let cancelled = false;
    const run = async () => {
      try {
        const detail = await api.getConversationSessionCore(selectedSessionId);
        if (!cancelled) {
          conversationDetailCacheRef.current.set(selectedSessionId, detail);
          setConversationDetail(detail);
          setConversationInfraError(null);
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : '会话自动刷新失败');
        }
      }
    };

    const timer = window.setInterval(() => {
      void run();
    }, 4000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeSection, authStatus, selectedSessionId, conversationAutoRefreshEnabled]);

  useEffect(() => {
    if (authStatus !== 'authenticated') {
      return;
    }
    if (activeSection !== 'conversation' || !conversationAutoRefreshEnabled) {
      return;
    }

    let cancelled = false;
    const run = async () => {
      try {
        const sessions = await api.listConversationSessions(200);
        if (!cancelled) {
          setConversationSessions(sessions.sessions);
        }
      } catch {
        // keep current list when periodic refresh fails
      }
    };

    const timer = window.setInterval(() => {
      void run();
    }, 12000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeSection, authStatus, conversationAutoRefreshEnabled]);

  useEffect(() => {
    if (authStatus !== 'authenticated') {
      return;
    }
    if (!selectedSessionId || activeSection !== 'conversation') {
      return;
    }

    let cancelled = false;
    const run = async () => {
      try {
        const infra = await api.getConversationSessionInfra(selectedSessionId);
        if (cancelled) {
          return;
        }
        setConversationDetail((previous) => {
          if (!previous || previous.session.id !== selectedSessionId) {
            return previous;
          }
          return {
            ...previous,
            runtime: {
              ...(previous.runtime || { taskSessionId: previous.session.id }),
              ...(infra.runtime || {}),
            },
            trace: {
              ...(previous.trace || {
                timeline: [],
                llm: [],
                agentDecisions: [],
                opencodeMessages: [],
                sandbox: {
                  primaryEnvironment: null,
                  relatedEnvironments: [],
                },
                kvm: {},
                osac: {
                  messages: [],
                  summary: { total: 0, byType: [] },
                  errors: [],
                },
              }),
              sandbox: infra.trace?.sandbox || previous.trace?.sandbox || {
                primaryEnvironment: null,
                relatedEnvironments: [],
              },
              kvm: infra.trace?.kvm || previous.trace?.kvm || {},
              osac: infra.trace?.osac || previous.trace?.osac || {
                messages: [],
                summary: { total: 0, byType: [] },
                errors: [],
              },
            },
          };
        });
        setConversationInfraError(null);
      } catch (requestError) {
        if (!cancelled) {
          setConversationInfraError(requestError instanceof Error ? requestError.message : '加载关联信息失败');
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [activeSection, authStatus, selectedSessionId]);

  useEffect(() => {
    setConversationWorkspaceTab('transitions');
    setTransitionView('timeline');
    setTransitionQuery('');
    setTransitionFilters(DEFAULT_TRANSITION_FILTERS);
    setTransitionAdvancedFiltersOpen(false);
    setConversationGovernanceFilter(null);
    setConversationEnvironmentGroupFilter(null);
    setConversationInfraError(null);
  }, [selectedSessionId]);

  useEffect(() => {
    setConversationEnvironmentGroupFilter(null);
  }, [conversationGovernanceFilter]);

  const handleAdminLogin = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setAuthSubmitting(true);
      setAuthError(null);
      try {
        const result = await api.adminLogin({
          loginName: loginName.trim(),
          password: loginPassword,
        });
        setAdminUser(result.adminUser);
        setAuthStatus('authenticated');
        setLoginPassword('');
      } catch (requestError) {
        setAdminUser(null);
        setAuthStatus('anonymous');
        setAuthError(requestError instanceof Error ? requestError.message : '管理员登录失败');
      } finally {
        setAuthSubmitting(false);
      }
    },
    [loginName, loginPassword]
  );

  const handleAdminLogout = useCallback(async () => {
    try {
      await api.adminLogout();
    } catch {
      // clear local auth state even if backend session is already invalid
    }
    setAdminUser(null);
    setAuthStatus('anonymous');
    setError(null);
  }, []);

  if (authStatus === 'loading') {
    return (
      <div className="auth-shell">
        <div className="auth-background" aria-hidden="true" />
        <section className="admin-auth-card">
          <p className="eyebrow">ONECEO 管理控制台</p>
          <h1>正在验证管理员会话</h1>
          <p className="admin-auth-loading-copy">请稍候，系统正在检查当前登录状态。</p>
        </section>
      </div>
    );
  }

  if (authStatus !== 'authenticated') {
    return (
      <div className="auth-shell">
        <div className="auth-background" aria-hidden="true" />
        <div className="admin-auth-layout">
          <section className="admin-auth-hero">
            <p className="eyebrow">ONECEO 管理控制台</p>
            <h1>平台管理与运维控制台</h1>
            <p className="admin-auth-copy">用于访问平台配置、运行状态和管理能力。仅限已授权管理员登录。</p>
            <div className="admin-auth-badges">
              <span>平台管理</span>
              <span>运行监控</span>
              <span>配置管理</span>
            </div>
          </section>

          <section className="admin-auth-card">
            <p className="eyebrow">管理员入口</p>
            <h2>管理员登录</h2>
            <form className="admin-auth-form" onSubmit={handleAdminLogin}>
              <label>
                <span>登录名</span>
                <input value={loginName} onChange={(event) => setLoginName(event.target.value)} required />
              </label>
              <label>
                <span>密码</span>
                <input
                  type="password"
                  value={loginPassword}
                  onChange={(event) => setLoginPassword(event.target.value)}
                  required
                />
              </label>
              {authError ? <div className="auth-error-banner">{authError}</div> : null}
              <button type="submit" className="primary-btn admin-auth-submit-btn" disabled={authSubmitting}>
                {authSubmitting ? '登录中...' : '登录'}
              </button>
            </form>
          </section>
        </div>
      </div>
    );
  }

  const vmPieData = (kvmOverview?.vmStateDistribution ?? []).filter((item) => item.value > 0);
  const conversationSummary = (() => {
    const summary = {
      total: conversationSessions.length,
      waitingUser: 0,
      inProgress: 0,
      completed: 0,
      failed: 0,
    };

    for (const session of conversationSessions) {
      if (session.status === 'waiting_user') summary.waitingUser += 1;
      else if (session.status === 'in_progress') summary.inProgress += 1;
      else if (session.status === 'completed') summary.completed += 1;
      else if (session.status === 'failed') summary.failed += 1;
    }

    return summary;
  })();
  const filteredConversationSessions = (() => {
    const query = conversationSearchQuery.trim().toLowerCase();
    return conversationSessions.filter((session) => {
      if (conversationStatusFilter !== 'all' && session.status !== conversationStatusFilter) {
        return false;
      }
      if (!query) {
        return true;
      }
      const haystack = [
        session.id,
        session.title,
        session.pendingQuestion || '',
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  })();
  const conversationTabCounts = {
    transitions: conversationDetail?.trace?.stateTransitions?.length || 0,
    timeline: conversationDetail?.trace?.timeline.length || 0,
    messages: conversationDetail?.messages.length || 0,
    llm: conversationDetail?.trace?.llm.length || 0,
  };
  const conversationSwitching = Boolean(
    conversationDetailLoading &&
      selectedSessionId &&
      conversationDetail &&
      selectedSessionId !== conversationDetail.session.id
  );
  const agentCapabilitySummary = (() => {
    const capabilities = agentOverview?.capabilities || [];
    return {
      total: capabilities.length,
      available: capabilities.filter((item) => item.status === 'available').length,
      planned: capabilities.filter((item) => item.status === 'planned').length,
    };
  })();
  const auditSummary = (() => {
    return {
      total: auditEntries.length,
      success: auditEntries.filter((item) => item.result === 'success').length,
      failed: auditEntries.filter((item) => item.result !== 'success').length,
    };
  })();

  const stateTransitions = conversationDetail?.trace?.stateTransitions || [];
  const sortedTransitions = (() => {
    return [...stateTransitions].sort((a, b) => {
      const aTime = a.at ? Date.parse(a.at) : Number.MAX_SAFE_INTEGER;
      const bTime = b.at ? Date.parse(b.at) : Number.MAX_SAFE_INTEGER;
      return aTime - bTime;
    });
  })();

  const transitionOptions = (() => {
    return {
      fromStages: uniqueSorted(sortedTransitions.map((item) => item.from?.stage)),
      toStages: uniqueSorted(sortedTransitions.map((item) => item.to?.stage)),
      statuses: uniqueSorted(sortedTransitions.map((item) => item.to?.status)),
      phases: uniqueSorted(sortedTransitions.map((item) => item.to?.phase)),
      roles: uniqueSorted(sortedTransitions.map((item) => item.trigger?.role)),
      messageTypes: uniqueSorted(sortedTransitions.map((item) => item.trigger?.messageType)),
      agents: uniqueSorted(sortedTransitions.map((item) => item.trigger?.agent)),
      tones: uniqueSorted(sortedTransitions.map((item) => item.trigger?.tone)),
    };
  })();

  const filteredTransitions = (() => {
    const query = transitionQuery.trim().toLowerCase();
    const fromMs = parseFilterTime(transitionFilters.fromTime);
    const toMs = parseFilterTime(transitionFilters.toTime);

    return sortedTransitions.filter((transition) => {
      if (fromMs !== null) {
        if (!transition.at) return false;
        const ts = Date.parse(transition.at);
        if (Number.isNaN(ts) || ts < fromMs) return false;
      }
      if (toMs !== null) {
        if (!transition.at) return false;
        const ts = Date.parse(transition.at);
        if (Number.isNaN(ts) || ts > toMs) return false;
      }

      if (transitionFilters.fromStage !== 'all' && transition.from?.stage !== transitionFilters.fromStage) {
        return false;
      }
      if (transitionFilters.toStage !== 'all' && transition.to?.stage !== transitionFilters.toStage) {
        return false;
      }
      if (transitionFilters.status !== 'all' && transition.to?.status !== transitionFilters.status) {
        return false;
      }
      if (transitionFilters.phase !== 'all' && transition.to?.phase !== transitionFilters.phase) {
        return false;
      }
      if (transitionFilters.role !== 'all' && transition.trigger?.role !== transitionFilters.role) {
        return false;
      }
      if (transitionFilters.messageType !== 'all' && transition.trigger?.messageType !== transitionFilters.messageType) {
        return false;
      }
      if (transitionFilters.agent !== 'all' && transition.trigger?.agent !== transitionFilters.agent) {
        return false;
      }
      if (transitionFilters.tone !== 'all' && transition.trigger?.tone !== transitionFilters.tone) {
        return false;
      }

      if (query) {
        const haystack = buildTransitionSearchText(transition);
        if (!haystack.includes(query)) {
          return false;
        }
      }

      return true;
    });
  })();

  const transitionStats = (() => {
    const stageSet = new Set(filteredTransitions.map((item) => item.to?.stage).filter(Boolean) as string[]);
    const statusSet = new Set(filteredTransitions.map((item) => item.to?.status).filter(Boolean) as string[]);
    const phaseSet = new Set(filteredTransitions.map((item) => item.to?.phase).filter(Boolean) as string[]);
    return {
      total: sortedTransitions.length,
      filtered: filteredTransitions.length,
      stages: Array.from(stageSet),
      statuses: Array.from(statusSet),
      phases: Array.from(phaseSet),
    };
  })();

  const activeNavItem = NAV_ITEMS.find((item) => item.key === activeSection) || NAV_ITEMS[0];
  const activeNavGroup = NAV_GROUPS.find((group) => group.key === activeNavItem.group) || NAV_GROUPS[0];
  const breadcrumbTitle = activeNavItem.label;
  const sandboxApi = sandboxOverview?.sandboxApi ?? null;
  const sandboxOverviewItems = asArray(sandboxOverview?.sandboxes);
  const sandboxRegistryItems = asArray(sandboxRuntimeRegistry?.items).map((item) => ({
    ...item,
    riskTags: asArray(item?.riskTags),
  }));
  const activeServiceOnline =
    activeSection === 'agent'
      ? agentOverview?.agentApi.online
      : activeSection === 'conversation'
        ? true
      : activeSection === 'skill'
        ? true
        : activeSection === 'connectorGuide'
          ? true
          : activeSection === 'osacRelease'
            ? true
      : activeSection === 'sandbox'
        ? sandboxApi?.online
        : activeSection === 'audit'
          ? true
        : kvmOverview?.orchestrator.online;
  const activeServiceLabel =
    activeSection === 'agent'
      ? '智能体服务'
      : activeSection === 'conversation'
        ? '会话索引'
      : activeSection === 'skill'
        ? '平台接口'
        : activeSection === 'connectorGuide'
          ? '平台接口'
          : activeSection === 'osacRelease'
            ? '平台接口'
      : activeSection === 'sandbox'
        ? 'Sandbox 服务'
        : activeSection === 'audit'
          ? '审计流'
        : 'KVM 服务';
  const updatedAtLabel =
    activeSection === 'sandbox'
      ? sandboxApi?.timestamp || sandboxOverviewItems[0]?.startedAt
      : activeSection === 'conversation'
        ? conversationDetail?.session.updatedAt || conversationSessions[0]?.updatedAt
        : activeSection === 'agent'
          ? agentOverview?.agentApi.timestamp || agentOverview?.oneceoApi.timestamp
          : activeSection === 'audit'
            ? auditEntries[0]?.timestamp
            : kvmOverview?.updatedAt;

  const handlePower = async (vm: VmItem, action: 'start' | 'stop') => {
    setBusyVmIds((prev) => ({ ...prev, [vm.vmId]: true }));
    try {
      await api.powerVm(vm.vmId, action);
      await loadKvmSection();
      await loadAuditSection();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'VM 操作失败');
    } finally {
      setBusyVmIds((prev) => ({ ...prev, [vm.vmId]: false }));
    }
  };

  const renderKvmSection = () => (
    <main className="content-stack">
      <section className="page-intro-grid fade-in">
        <article className="panel hero-panel">
          <div className="panel-header panel-header-stack">
            <div>
              <p className="section-tag">资源摘要</p>
              <h2>KVM 资源与实例</h2>
            </div>
            <span className={`service-state ${kvmOverview?.orchestrator.online ? 'ok' : 'down'}`}>
              {kvmOverview?.orchestrator.online ? 'KVM 编排器在线' : 'KVM 编排器离线'}
            </span>
          </div>
          <p className="panel-copy">
            展示宿主机资源、虚拟机数量和当前运行状态。
          </p>
          <div className="hero-metrics">
            <div>
              <span className="hero-metric-label">宿主机</span>
              <strong>{hosts.length}</strong>
            </div>
            <div>
              <span className="hero-metric-label">运行 VM</span>
              <strong>{kvmOverview?.vmSummary.running ?? 0}</strong>
            </div>
            <div>
              <span className="hero-metric-label">异常 VM</span>
              <strong>{kvmOverview?.vmSummary.error ?? 0}</strong>
            </div>
          </div>
        </article>

        <article className="panel aside-panel">
          <div className="panel-header panel-header-stack">
            <div>
              <p className="section-tag">状态摘要</p>
              <h2>关键指标</h2>
            </div>
          </div>
          <ul className="signal-list">
            <li>宿主机资源使用率</li>
            <li>异常 VM 与停止 VM 数量</li>
            <li>控制中心批量操作</li>
          </ul>
        </article>
      </section>

      <section className="panel fade-in">
        <div className="panel-header">
          <h2>KVM 宿主机状态</h2>
          <span className="panel-caption">总计 {hosts.length} 台宿主机</span>
        </div>
        {hosts.length === 0 ? (
          <p className="empty">暂无宿主机数据，请检查 KVM 编排器连接或稍后重试。</p>
        ) : (
          <div className="host-grid">
            {hosts.map((host) => (
              <article key={host.hostId} className="host-card">
                <div className="host-head">
                  <div>
                    <h3>{host.name}</h3>
                    <p className="kpi-meta mono">{host.managementIp}</p>
                  </div>
                  <span className="host-dot" style={{ backgroundColor: hostStatusColor(host.effectiveStatus) }}>
                    {hostStatusLabel(host.effectiveStatus)}
                  </span>
                </div>

                <div className="usage-grid">
                  <div>
                    <p>CPU 使用率</p>
                    <strong>{formatPercent(host.cpuUsagePercent)}</strong>
                    <p>
                      {host.usedCpuCores.toFixed(1)} / {host.cpuCapacityCores.toFixed(1)} cores
                    </p>
                  </div>
                  <div>
                    <p>内存使用率</p>
                    <strong>{formatPercent(host.memoryUsagePercent)}</strong>
                    <p>
                      {host.usedMemoryGb.toFixed(1)} / {host.memoryCapacityGb.toFixed(1)} GB
                    </p>
                  </div>
                  <div>
                    <p>存储使用率</p>
                    <strong>{formatPercent(host.storageUsagePercent)}</strong>
                    <p>
                      {host.usedStorageGb.toFixed(1)} / {host.storageCapacityGb.toFixed(1)} GB
                    </p>
                  </div>
                </div>

                <div className="host-card-footer">
                  <p>
                    运行 VM {host.runningVmCount} / 总 VM {host.totalVmCount}
                  </p>
                  <p>心跳: {formatDateTime(host.lastHeartbeat)}</p>
                </div>

                <div className="host-trend-wrap">
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={hostTrendMap[host.hostId] || []}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#dbe7f4" />
                      <XAxis dataKey="timeLabel" minTickGap={20} />
                      <YAxis domain={[0, 100]} tickFormatter={(value) => `${value}%`} />
                      <Tooltip formatter={(value) => [`${value}%`, '']} />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="cpu"
                        name="CPU"
                        stroke="#0f766e"
                        strokeWidth={2}
                        dot={{ r: 2 }}
                        activeDot={{ r: 4 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="memory"
                        name="内存"
                        stroke="#0284c7"
                        strokeWidth={2}
                        dot={{ r: 2 }}
                        activeDot={{ r: 4 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="storage"
                        name="存储"
                        stroke="#f59e0b"
                        strokeWidth={2}
                        dot={{ r: 2 }}
                        activeDot={{ r: 4 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="kpi-grid fade-in">
        <article className="kpi-card kpi-card-emphasis">
          <p className="kpi-title">运行中 VM</p>
          <p className="kpi-value">{kvmOverview?.vmSummary.running ?? 0}</p>
          <p className="kpi-meta">总计 {kvmOverview?.vmSummary.total ?? 0} 台</p>
        </article>
        <article className="kpi-card">
          <p className="kpi-title">停止 VM</p>
          <p className="kpi-value">{kvmOverview?.vmSummary.stopped ?? 0}</p>
          <p className="kpi-meta">来源 /v1/vms</p>
        </article>
        <article className="kpi-card">
          <p className="kpi-title">异常 VM</p>
          <p className="kpi-value">{kvmOverview?.vmSummary.error ?? 0}</p>
          <p className="kpi-meta">需人工排查</p>
        </article>
        <article className="kpi-card">
          <p className="kpi-title">服务状态</p>
          <p className="kpi-value">{kvmOverview?.orchestrator.online ? '在线' : '离线'}</p>
          <p className="kpi-meta">{kvmOverview?.orchestrator.service || 'kvm-orchestrator'}</p>
        </article>
      </section>

      <section className="chart-grid fade-in">
        <article className="panel">
          <div className="panel-header">
            <h2>VM 状态分布</h2>
            <span className="panel-caption">状态分布</span>
          </div>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={vmPieData} cx="50%" cy="50%" outerRadius={90} innerRadius={55} dataKey="value" nameKey="label">
                  {vmPieData.map((item) => (
                    <Cell key={item.label} fill={VM_STATE_COLORS[item.label] ?? '#0ea5a5'} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <h2>会话状态分布</h2>
            <span className="panel-caption">任务绑定态</span>
          </div>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={kvmOverview?.sessionStatusDistribution ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#dbe7f4" />
                <XAxis dataKey="label" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="value" name="数量" fill="#0284c7" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>
      </section>

      <section className="panel fade-in">
        <div className="panel-header">
          <h2>KVM 列表</h2>
            <span className="panel-caption">按 VM 进入操作</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>VM 名称</th>
                <th>状态</th>
                <th>Session</th>
                <th>CPU</th>
                <th>内存</th>
                <th>更新时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {vms.map((vm) => {
                const vmBusy = Boolean(busyVmIds[vm.vmId]);
                return (
                  <tr key={vm.vmId}>
                    <td className="mono">{vm.vmId}</td>
                    <td>
                      <span className={stateClassName(vm.state)}>{vm.state}</span>
                    </td>
                    <td className="mono">{vm.sessionId || '-'}</td>
                    <td>{formatValue(vm.cpuCores, 'c')}</td>
                    <td>{vm.memoryMb ? `${Math.round(vm.memoryMb / 1024)} GB` : '-'}</td>
                    <td>{formatDateTime(vm.createdAt)}</td>
                    <td>
                      <div className="action-inline">
                        <button
                          type="button"
                          className="table-btn"
                          onClick={() => handlePower(vm, 'start')}
                          disabled={vm.state === 'running' || vmBusy}
                        >
                          启动
                        </button>
                        <button
                          type="button"
                          className="table-btn danger"
                          onClick={() => handlePower(vm, 'stop')}
                          disabled={vm.state !== 'running' || vmBusy}
                        >
                          关机
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <KvmControlCenter
        vms={vms}
        onDataChanged={async () => {
          await loadKvmSection();
          await loadAuditSection();
        }}
        onError={(message) => setError(message)}
      />
    </main>
  );

  const renderConversationSection = () => (
    <main className="content-stack">
      <section className="page-intro-grid fade-in">
        <article className="panel hero-panel">
          <div className="panel-header panel-header-stack">
            <div>
              <p className="section-tag">会话摘要</p>
              <h2>会话索引与状态记录</h2>
            </div>
            <span className="service-state ok">最近 200 条会话</span>
          </div>
          <div className="hero-metrics">
            <div>
              <span className="hero-metric-label">总会话</span>
              <strong>{conversationSummary.total}</strong>
            </div>
            <div>
              <span className="hero-metric-label">进行中</span>
              <strong>{conversationSummary.inProgress}</strong>
            </div>
            <div>
              <span className="hero-metric-label">待确认</span>
              <strong>{conversationSummary.waitingUser}</strong>
            </div>
            <div>
              <span className="hero-metric-label">失败</span>
              <strong>{conversationSummary.failed}</strong>
            </div>
          </div>
        </article>

        <article className="panel aside-panel">
          <div className="panel-header panel-header-stack">
            <div>
              <p className="section-tag">当前会话</p>
              <h2>{conversationDetail?.session.title || conversationDetail?.session.id || '未选择会话'}</h2>
            </div>
          </div>
          <div className="detail-kv-list">
            <div>
              <span>状态</span>
              <strong>{conversationDetail ? statusLabel(conversationDetail.session.status) : '-'}</strong>
            </div>
            <div>
              <span>阶段</span>
              <strong>{conversationDetail?.session.stage || '-'}</strong>
            </div>
            <div>
              <span>OpenCode ID</span>
              <strong className="mono">{conversationDetail?.runtime?.opencodeSessionId || '-'}</strong>
            </div>
          </div>
        </article>
      </section>

      <section className="conversation-layout fade-in">
        <article className="panel">
          <div className="panel-header">
            <h2>会话列表</h2>
            <span className="panel-caption">左侧索引</span>
          </div>
          <div className="session-list">
            {conversationSessions.length === 0 ? (
              <p className="empty">暂无对话会话。</p>
            ) : (
              conversationSessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  className={`session-item ${selectedSessionId === session.id ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedSessionId(session.id);
                    setConversationDetail(null);
                  }}
                >
                  <div>
                    <p className="session-title">{session.title || session.id}</p>
                    <p className="session-meta">{formatDateTime(session.updatedAt)}</p>
                  </div>
                  <span className="session-status">{statusLabel(session.status)}</span>
                </button>
              ))
            )}
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <h2>会话详情</h2>
            {conversationDetail ? (
              <button type="button" className="secondary-btn" onClick={exportConversationDetail}>
                下载会话
              </button>
            ) : null}
          </div>
          {!conversationDetail ? (
            <p className="empty">请选择左侧会话查看。</p>
          ) : (
            <div className="conversation-detail">
              {(() => {
                const primaryEnvironment = conversationDetail.trace?.sandbox.primaryEnvironment ?? null;
                const relatedEnvironments = (conversationDetail.trace?.sandbox.relatedEnvironments || []).filter(
                  (environment) => environment.id !== primaryEnvironment?.id
                );
                const primaryEnvironmentSandboxId = environmentSandboxId(primaryEnvironment);
                const primaryEnvironmentTaskSessionId = environmentTaskSessionId(primaryEnvironment);
                const primaryEnvironmentExecutor = environmentExecutor(primaryEnvironment);
                const primaryEnvironmentArchiveStatus = environmentArchiveStatus(primaryEnvironment);
                const primaryEnvironmentReplacementId = environmentReplacementSandboxId(primaryEnvironment);
                const governanceGroups = Object.values(
                  relatedEnvironments.reduce<Record<string, {
                    key: string;
                    reason: string;
                    items: SandboxEnvironmentItem[];
                    latestUpdatedAt: string;
                  }>>((groups, environment) => {
                    const reason = sandboxDedupeReasonLabel(environmentDedupeReason(environment));
                    const existing = groups[reason];
                    if (existing) {
                      existing.items.push(environment);
                      if (toTimestamp(environment.updatedAt) > toTimestamp(existing.latestUpdatedAt)) {
                        existing.latestUpdatedAt = environment.updatedAt;
                      }
                      return groups;
                    }
                    groups[reason] = {
                      key: reason,
                      reason,
                      items: [environment],
                      latestUpdatedAt: environment.updatedAt,
                    };
                    return groups;
                  }, {})
                ).sort((left, right) => {
                  if (right.items.length !== left.items.length) {
                    return right.items.length - left.items.length;
                  }
                  return toTimestamp(right.latestUpdatedAt) - toTimestamp(left.latestUpdatedAt);
                });
                const relatedEnvironmentGroups = Object.values(
                  relatedEnvironments.reduce<Record<string, {
                    key: string;
                    status: string;
                    executor: string;
                    archiveStatus: string;
                    governanceReason: string;
                    items: SandboxEnvironmentItem[];
                    latestUpdatedAt: string;
                  }>>((groups, environment) => {
                    const executor = environmentExecutor(environment) || '-';
                    const archiveStatus = environmentArchiveStatus(environment) || '-';
                    const governanceReason = sandboxDedupeReasonLabel(environmentDedupeReason(environment));
                    const key = `${environment.status}__${executor}__${archiveStatus}__${governanceReason}`;
                    const existing = groups[key];
                    if (existing) {
                      existing.items.push(environment);
                      if (toTimestamp(environment.updatedAt) > toTimestamp(existing.latestUpdatedAt)) {
                        existing.latestUpdatedAt = environment.updatedAt;
                      }
                      return groups;
                    }
                    groups[key] = {
                      key,
                      status: environment.status,
                      executor,
                      archiveStatus,
                      governanceReason,
                      items: [environment],
                      latestUpdatedAt: environment.updatedAt,
                    };
                    return groups;
                  }, {})
                ).sort((left, right) => {
                  if (right.items.length !== left.items.length) {
                    return right.items.length - left.items.length;
                  }
                  return toTimestamp(right.latestUpdatedAt) - toTimestamp(left.latestUpdatedAt);
                });
                const visibleRelatedEnvironmentGroups = conversationGovernanceFilter
                  ? relatedEnvironmentGroups.filter((group) => group.governanceReason === conversationGovernanceFilter)
                  : relatedEnvironmentGroups;
                const finalVisibleRelatedEnvironmentGroups = conversationEnvironmentGroupFilter
                  ? visibleRelatedEnvironmentGroups.filter((group) => group.key === conversationEnvironmentGroupFilter)
                  : visibleRelatedEnvironmentGroups;
                return (
                  <>
              <div className="detail-grid detail-grid-wide summary-grid">
                <div>
                  <p className="kpi-title">会话 ID</p>
                  <p className="mono">{conversationDetail.session.id}</p>
                </div>
                <div>
                  <p className="kpi-title">状态</p>
                  <p>{statusLabel(conversationDetail.session.status)}</p>
                </div>
                <div>
                  <p className="kpi-title">阶段</p>
                  <p>{conversationDetail.session.stage || '-'}</p>
                </div>
                <div>
                  <p className="kpi-title">编排 ID</p>
                  {conversationDetail.runtime?.orchestratorSessionId ? (
                    <button
                      type="button"
                      className="link-btn sandbox-jump-btn mono"
                      onClick={() => openSandboxFromConversation(conversationDetail.runtime?.orchestratorSessionId)}
                    >
                      {conversationDetail.runtime.orchestratorSessionId}
                    </button>
                  ) : (
                    <p className="mono">-</p>
                  )}
                </div>
                <div>
                  <p className="kpi-title">OpenCode ID</p>
                  <p className="mono">{conversationDetail.runtime?.opencodeSessionId || '-'}</p>
                </div>
                <div>
                  <p className="kpi-title">VM 名称</p>
                  <p className="mono">{conversationDetail.runtime?.vmName || '-'}</p>
                </div>
                <div>
                  <p className="kpi-title">绑定更新时间</p>
                  <p>{formatDateTime(conversationDetail.runtime?.bindingUpdatedAt)}</p>
                </div>
                <div>
                  <p className="kpi-title">待补充问题</p>
                  <p>{conversationDetail.runtime?.pendingQuestion || '-'}</p>
                </div>
                <div>
                  <p className="kpi-title">挂起原因</p>
                  <p>{conversationDetail.runtime?.pendingResume?.reason || '-'}</p>
                </div>
              </div>

              <div className="panel-subtitle">
                全链路时间线 ({conversationDetail.trace?.timeline.length ?? 0})
              </div>
              <div className="trace-list">
                {(conversationDetail.trace?.timeline || []).length === 0 ? (
                  <p className="empty">无链路事件</p>
                ) : (
                  (conversationDetail.trace?.timeline || []).map((event) => {
                    const badgeLabel = event.badge || event.level;
                    const hasDecision = Boolean(event.decision?.layer || event.decision?.source || event.decision?.type);
                    const hasDecisionIO = Boolean(event.decisionInput || event.decisionOutput);
                    const hasExecution = Boolean(event.execution?.component || event.execution?.action || event.execution?.detail);
                    const hasContext = Boolean(event.context?.trigger || event.context?.previous);
                    const rawContent = event.rawContent || '';
                    const showRaw = rawContent && rawContent !== event.content;
                    return (
                      <article key={event.id} className="trace-item">
                        <p className="trace-head">
                          <span className={traceLevelClass(event.level)}>{badgeLabel}</span>
                          <strong>{event.title}</strong>
                          <span>{formatDateTime(event.timestamp)}</span>
                        </p>
                        <p className="trace-meta mono">
                          {event.source} / {event.category}
                        </p>
                        {hasDecision ? (
                          <p className="trace-meta">
                            决策层级: {event.decision?.layer || '-'}
                            {event.decision?.name ? ` · 名称: ${event.decision.name}` : ''}
                            · 来源: {event.decision?.source || '-'} · 类型: {event.decision?.type || '-'}
                          </p>
                        ) : null}
                        {hasExecution ? (
                          <p className="trace-meta">
                            执行层: {event.execution?.component || '-'}
                            {event.execution?.action ? ` · 动作: ${event.execution.action}` : ''}
                            {event.execution?.detail ? ` · ${summarizeText(event.execution.detail, 180)}` : ''}
                          </p>
                        ) : null}
                        {event.content ? <p className="message-content">{summarizeText(event.content, 360)}</p> : null}
                        {hasDecisionIO ? (
                          <details>
                            <summary>查看决策输入/输出</summary>
                            {event.decisionInput ? (
                              <>
                                <p className="kpi-title">输入</p>
                                <pre className="json-block">{toJsonText(event.decisionInput)}</pre>
                              </>
                            ) : null}
                            {event.decisionOutput ? (
                              <>
                                <p className="kpi-title">输出</p>
                                <pre className="json-block">{toJsonText(event.decisionOutput)}</pre>
                              </>
                            ) : null}
                          </details>
                        ) : null}
                        {hasContext ? (
                          <div className="trace-meta">
                            {event.context?.trigger ? (
                              <p>
                                触发消息: {event.context.trigger.messageType || '-'} ·{' '}
                                {summarizeText(event.context.trigger.content, 180)}
                              </p>
                            ) : null}
                            {event.context?.previous ? (
                              <p>
                                前置消息: {event.context.previous.messageType || '-'} ·{' '}
                                {summarizeText(event.context.previous.content, 180)}
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                        {showRaw ? (
                          <details>
                            <summary>查看原文</summary>
                            <pre className="json-block">{rawContent}</pre>
                          </details>
                        ) : null}
                      </article>
                    );
                  })
                )}
              </div>

              <div className="panel-subtitle panel-subtitle-row">
                <span>状态机流转 ({stateTransitions.length})</span>
                <div className="panel-subtitle-actions">
                  <button
                    type="button"
                    className={`toggle-btn ${transitionView === 'timeline' ? 'active' : ''}`}
                    onClick={() => setTransitionView('timeline')}
                  >
                    时间轴
                  </button>
                  <button
                    type="button"
                    className={`toggle-btn ${transitionView === 'list' ? 'active' : ''}`}
                    onClick={() => setTransitionView('list')}
                  >
                    列表
                  </button>
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => {
                      setTransitionQuery('');
                      setTransitionFilters(DEFAULT_TRANSITION_FILTERS);
                    }}
                  >
                    重置筛选
                  </button>
                </div>
              </div>

              <div className="state-filter">
                <div className="state-filter-row">
                  <label className="state-filter-field">
                    <span>搜索</span>
                    <input
                      type="search"
                      placeholder="按阶段/状态/消息内容搜索"
                      value={transitionQuery}
                      onChange={(event) => setTransitionQuery(event.target.value)}
                    />
                  </label>
                  <label className="state-filter-field">
                    <span>开始时间</span>
                    <input
                      type="datetime-local"
                      value={transitionFilters.fromTime}
                      onChange={(event) =>
                        setTransitionFilters((prev) => ({ ...prev, fromTime: event.target.value }))
                      }
                    />
                  </label>
                  <label className="state-filter-field">
                    <span>结束时间</span>
                    <input
                      type="datetime-local"
                      value={transitionFilters.toTime}
                      onChange={(event) =>
                        setTransitionFilters((prev) => ({ ...prev, toTime: event.target.value }))
                      }
                    />
                  </label>
                </div>

                <div className="state-filter-grid">
                  <label className="state-filter-field">
                    <span>起始阶段</span>
                    <select
                      value={transitionFilters.fromStage}
                      onChange={(event) =>
                        setTransitionFilters((prev) => ({ ...prev, fromStage: event.target.value }))
                      }
                    >
                      <option value="all">全部</option>
                      {transitionOptions.fromStages.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="state-filter-field">
                    <span>目标阶段</span>
                    <select
                      value={transitionFilters.toStage}
                      onChange={(event) =>
                        setTransitionFilters((prev) => ({ ...prev, toStage: event.target.value }))
                      }
                    >
                      <option value="all">全部</option>
                      {transitionOptions.toStages.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="state-filter-field">
                    <span>状态</span>
                    <select
                      value={transitionFilters.status}
                      onChange={(event) =>
                        setTransitionFilters((prev) => ({ ...prev, status: event.target.value }))
                      }
                    >
                      <option value="all">全部</option>
                      {transitionOptions.statuses.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="state-filter-field">
                    <span>阶段(Phase)</span>
                    <select
                      value={transitionFilters.phase}
                      onChange={(event) =>
                        setTransitionFilters((prev) => ({ ...prev, phase: event.target.value }))
                      }
                    >
                      <option value="all">全部</option>
                      {transitionOptions.phases.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="state-filter-field">
                    <span>消息类型</span>
                    <select
                      value={transitionFilters.messageType}
                      onChange={(event) =>
                        setTransitionFilters((prev) => ({ ...prev, messageType: event.target.value }))
                      }
                    >
                      <option value="all">全部</option>
                      {transitionOptions.messageTypes.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="state-filter-field">
                    <span>角色</span>
                    <select
                      value={transitionFilters.role}
                      onChange={(event) => setTransitionFilters((prev) => ({ ...prev, role: event.target.value }))}
                    >
                      <option value="all">全部</option>
                      {transitionOptions.roles.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="state-filter-field">
                    <span>Agent</span>
                    <select
                      value={transitionFilters.agent}
                      onChange={(event) => setTransitionFilters((prev) => ({ ...prev, agent: event.target.value }))}
                    >
                      <option value="all">全部</option>
                      {transitionOptions.agents.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="state-filter-field">
                    <span>Tone</span>
                    <select
                      value={transitionFilters.tone}
                      onChange={(event) => setTransitionFilters((prev) => ({ ...prev, tone: event.target.value }))}
                    >
                      <option value="all">全部</option>
                      {transitionOptions.tones.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>

              <div className="compact-list state-summary">
                <div className="compact-item">
                  <span>总流转</span>
                  <strong className="mono">{transitionStats.total}</strong>
                </div>
                <div className="compact-item">
                  <span>筛选后</span>
                  <strong className="mono">{transitionStats.filtered}</strong>
                </div>
                <div className="compact-item">
                  <span>涉及阶段</span>
                  <strong className="mono">{transitionStats.stages.length}</strong>
                </div>
                <div className="compact-item">
                  <span>涉及状态</span>
                  <strong className="mono">{transitionStats.statuses.length}</strong>
                </div>
                <div className="compact-item">
                  <span>涉及 Phase</span>
                  <strong className="mono">{transitionStats.phases.length}</strong>
                </div>
              </div>

              {filteredTransitions.length === 0 ? (
                <p className="empty">无状态流转记录</p>
              ) : transitionView === 'timeline' ? (
                <div className="state-timeline">
                  {filteredTransitions.map((transition, index) => {
                    const trigger = transition.trigger || {};
                    const triggerSummary = [
                      trigger.messageType ? `type=${trigger.messageType}` : '',
                      trigger.role ? `role=${trigger.role}` : '',
                      trigger.agent ? `agent=${trigger.agent}` : '',
                      trigger.tone ? `tone=${trigger.tone}` : '',
                      trigger.messageId ? `id=${trigger.messageId}` : '',
                    ]
                      .filter(Boolean)
                      .join(' / ');
                    const prev = index > 0 ? filteredTransitions[index - 1] : null;
                    const gap =
                      prev?.at && transition.at
                        ? formatDuration(Date.parse(transition.at) - Date.parse(prev.at))
                        : '-';
                    return (
                      <article key={`${transition.at || 'transition'}-${index}`} className="state-timeline-item">
                        <div className="state-timeline-head">
                          <span className={traceLevelClass('info')}>state</span>
                          <strong>{`${transition.from?.stage || '-'} → ${transition.to?.stage || '-'}`}</strong>
                          <span>{formatDateTime(transition.at)}</span>
                          <span className="state-gap">间隔 {gap}</span>
                        </div>
                        <div className="state-timeline-meta">
                          <span className="mono">{formatStateSnapshot(transition.from)}</span>
                          <span className="mono">{formatStateSnapshot(transition.to)}</span>
                        </div>
                        <div className="state-transition-flow">
                          <span className="state-chip from">{transition.from?.stage || '-'}</span>
                          <span className="state-chip status">{transition.to?.status || '-'}</span>
                          <span className="state-chip phase">{transition.to?.phase || '-'}</span>
                          <span className="state-chip to">{transition.to?.stage || '-'}</span>
                        </div>
                        {triggerSummary ? <p className="message-content">触发: {triggerSummary}</p> : null}
                        {trigger.content ? (
                          <p className="message-content">内容: {summarizeText(trigger.content, 240)}</p>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="trace-list">
                  {filteredTransitions.map((transition, index) => {
                    const trigger = transition.trigger || {};
                    const triggerSummary = [
                      trigger.messageType ? `type=${trigger.messageType}` : '',
                      trigger.role ? `role=${trigger.role}` : '',
                      trigger.agent ? `agent=${trigger.agent}` : '',
                      trigger.tone ? `tone=${trigger.tone}` : '',
                      trigger.messageId ? `id=${trigger.messageId}` : '',
                    ]
                      .filter(Boolean)
                      .join(' / ');
                    return (
                      <article key={`${transition.at || 'transition'}-${index}`} className="trace-item">
                        <p className="trace-head">
                          <span className={traceLevelClass('info')}>state</span>
                          <strong>{`${transition.from?.stage || '-'} → ${transition.to?.stage || '-'}`}</strong>
                          <span>{formatDateTime(transition.at)}</span>
                        </p>
                        <p className="trace-meta mono">
                          {formatStateSnapshot(transition.from)} → {formatStateSnapshot(transition.to)}
                        </p>
                        {triggerSummary ? <p className="message-content">触发: {triggerSummary}</p> : null}
                        {trigger.content ? (
                          <p className="message-content">内容: {summarizeText(trigger.content, 240)}</p>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              )}

              <div className="panel-subtitle">对话消息 ({conversationDetail.messages.length})</div>
              <div className="message-list message-list-large">
                {conversationDetail.messages.length === 0 ? (
                  <p className="empty">无消息</p>
                ) : (
                  conversationDetail.messages.map((message) => (
                    <article key={message.id} className="message-item">
                      <p className="message-head">
                        <strong>{message.role}</strong> · {formatDateTime(message.createdAt)}
                      </p>
                      <p className="message-content">{message.content}</p>
                      {message.metadata !== undefined ? (
                        <pre className="json-block message-meta-json">{toJsonText(message.metadata)}</pre>
                      ) : null}
                    </article>
                  ))
                )}
              </div>

              <div className="panel-subtitle">LLM 调用轨迹 ({conversationDetail.trace?.llm.length ?? 0})</div>
              <div className="llm-trace-list">
                {(conversationDetail.trace?.llm || []).length === 0 ? (
                  <p className="empty">无 LLM 调用轨迹</p>
                ) : (
                  (conversationDetail.trace?.llm || []).map((item) => (
                    <article key={item.id} className="sub-panel">
                      <div className="trace-head">
                        <strong>{item.stage}</strong>
                        <span className="mono">{item.source}</span>
                        <span>{item.inferred ? '推断还原' : '真实命令'}</span>
                      </div>
                      <p className="trace-meta">时间: {formatDateTime(item.createdAt)}</p>
                      <p className="kpi-title">请求内容</p>
                      <pre className="json-block">{toJsonText(item.request)}</pre>
                      <p className="kpi-title">返回内容</p>
                      <pre className="json-block">{toJsonText(item.response)}</pre>
                    </article>
                  ))
                )}
              </div>

              <div className="panel-subtitle">KVM / Sandbox 调用状态</div>
              <div className="trace-columns">
                <article className="sub-panel">
                  <h3>KVM 摘要</h3>
                  <pre className="json-block">
                    {toJsonText({
                      orchestratorSessionId: conversationDetail.trace?.kvm.orchestratorSessionId,
                      vmName: conversationDetail.trace?.kvm.vmName,
                      quota: conversationDetail.trace?.kvm.quota,
                    })}
                  </pre>
                  {conversationDetail.trace?.kvm.errors?.length ? (
                    <pre className="json-block">{toJsonText(conversationDetail.trace.kvm.errors)}</pre>
                  ) : null}
                </article>

                <article className="sub-panel">
                  <h3>KVM 原始状态</h3>
                  <pre className="json-block">
                    {toJsonText({
                      session: conversationDetail.trace?.kvm.session,
                      sessionVm: conversationDetail.trace?.kvm.sessionVm,
                      sandbox: conversationDetail.trace?.kvm.sandbox,
                      sandboxIp: conversationDetail.trace?.kvm.sandboxIp,
                      sandboxPorts: conversationDetail.trace?.kvm.sandboxPorts,
                      vmDetail: conversationDetail.trace?.kvm.vmDetail,
                      vmMetrics: conversationDetail.trace?.kvm.vmMetrics,
                    })}
                  </pre>
                </article>

                <article className="sub-panel">
                  <h3>Sandbox 环境记录</h3>
                  <div className="detail-grid detail-grid-wide summary-grid">
                    <div>
                      <p className="kpi-title">主记录状态</p>
                      <p>{primaryEnvironment?.status || '-'}</p>
                    </div>
                    <div>
                      <p className="kpi-title">主记录 Sandbox</p>
                      {primaryEnvironmentSandboxId ? (
                        <button
                          type="button"
                          className="link-btn sandbox-jump-btn mono"
                          onClick={() => openSandboxFromConversation(primaryEnvironmentSandboxId)}
                        >
                          {primaryEnvironmentSandboxId}
                        </button>
                      ) : (
                        <p className="mono">-</p>
                      )}
                    </div>
                    <div>
                      <p className="kpi-title">主记录 Task Session</p>
                      {primaryEnvironmentTaskSessionId ? (
                        <button
                          type="button"
                          className="link-btn sandbox-jump-btn mono"
                          onClick={() => openConversationSessionFromSandbox(primaryEnvironmentTaskSessionId)}
                        >
                          {primaryEnvironmentTaskSessionId}
                        </button>
                      ) : (
                        <p className="mono">-</p>
                      )}
                    </div>
                    <div>
                      <p className="kpi-title">Executor</p>
                      <p>{primaryEnvironmentExecutor || '-'}</p>
                    </div>
                    <div>
                      <p className="kpi-title">归档状态</p>
                      <p>{archiveStatusLabel(primaryEnvironmentArchiveStatus)}</p>
                    </div>
                    <div>
                      <p className="kpi-title">关联记录数</p>
                      <p>{relatedEnvironments.length}</p>
                    </div>
                  </div>
                  {primaryEnvironmentReplacementId ? (
                    <p className="session-meta">
                      已由{' '}
                      <button
                        type="button"
                        className="link-btn sandbox-jump-btn mono"
                        onClick={() => openSandboxFromConversation(primaryEnvironmentReplacementId)}
                      >
                        {primaryEnvironmentReplacementId}
                      </button>{' '}
                      接管
                    </p>
                  ) : null}
                  {relatedEnvironments.length ? (
                    <div className="conversation-sandbox-list">
                      <div className="conversation-sandbox-governance-grid">
                        {governanceGroups.map((group) => (
                          <button
                            key={group.key}
                            type="button"
                            className={`sub-panel conversation-sandbox-card conversation-sandbox-governance-card conversation-sandbox-governance-filter ${conversationGovernanceFilter === group.reason ? 'active' : ''}`}
                            onClick={() =>
                              setConversationGovernanceFilter((prev) => (prev === group.reason ? null : group.reason))
                            }
                          >
                            <div className="trace-head">
                              <strong>{group.reason}</strong>
                              <span className="session-status session-status-governance">分组</span>
                            </div>
                            <p className="trace-meta">
                              共 {group.items.length} 条 · 最近更新时间 {formatDateTime(group.latestUpdatedAt)}
                            </p>
                          </button>
                        ))}
                      </div>
                      <div className="panel-subtitle panel-subtitle-row">
                        <span>
                          {conversationGovernanceFilter
                            ? `当前仅显示原因：${conversationGovernanceFilter}（${finalVisibleRelatedEnvironmentGroups.length} / ${visibleRelatedEnvironmentGroups.length} 组）`
                            : `当前显示全部实例分组（${finalVisibleRelatedEnvironmentGroups.length} / ${visibleRelatedEnvironmentGroups.length} 组）`}
                        </span>
                        {conversationGovernanceFilter || conversationEnvironmentGroupFilter ? (
                          <div className="panel-subtitle-actions">
                            {conversationEnvironmentGroupFilter ? (
                              <button
                                type="button"
                                className="secondary-btn"
                                onClick={() => setConversationEnvironmentGroupFilter(null)}
                              >
                                清除实例组筛选
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="secondary-btn"
                              onClick={() => setConversationGovernanceFilter(null)}
                            >
                              清除治理筛选
                            </button>
                          </div>
                        ) : null}
                      </div>
                      {finalVisibleRelatedEnvironmentGroups.map((group) => {
                        const groupSelected = conversationEnvironmentGroupFilter === group.key;
                        return (
                          <article
                            key={group.key}
                            className={`sub-panel conversation-sandbox-card conversation-sandbox-group-filter ${groupSelected ? 'active' : ''}`}
                          >
                            <button
                              type="button"
                              className="conversation-sandbox-group-head"
                              onClick={() =>
                                setConversationEnvironmentGroupFilter((prev) => (prev === group.key ? null : group.key))
                              }
                            >
                              <div className="trace-head">
                                <strong>
                                  {group.status} · {group.executor}
                                </strong>
                                <span className="mono">{formatDateTime(group.latestUpdatedAt)}</span>
                              </div>
                              <p className="trace-meta">
                                归档: {archiveStatusLabel(group.archiveStatus)} · 原因: {group.governanceReason} · 共 {group.items.length} 条
                              </p>
                            </button>
                            <details open={groupSelected}>
                              <summary>{groupSelected ? '收起该组 Sandbox' : '查看该组 Sandbox'}</summary>
                              <strong>
                                {group.status} · {group.executor}
                              </strong>
                              <div className="conversation-sandbox-list">
                                {group.items.map((environment) => {
                                  const sandboxId = environmentSandboxId(environment);
                                  const taskSessionId = environmentTaskSessionId(environment);
                                  return (
                                    <article key={environment.id} className="sub-panel conversation-sandbox-card">
                                      <div className="trace-head">
                              <strong>{environment.status}</strong>
                                        <span className="mono">{formatDateTime(environment.updatedAt)}</span>
                                      </div>
                                      <p className="trace-meta">
                                        Sandbox：{' '}
                                        {sandboxId ? (
                                          <button
                                            type="button"
                                            className="link-btn sandbox-jump-btn mono"
                                            onClick={() => openSandboxFromConversation(sandboxId)}
                                          >
                                            {sandboxId}
                                          </button>
                                        ) : (
                                          '-'
                                        )}
                                      </p>
                                      <p className="trace-meta">
                                        会话：{' '}
                                        {taskSessionId ? (
                                          <button
                                            type="button"
                                            className="link-btn sandbox-jump-btn mono"
                                            onClick={() => openConversationSessionFromSandbox(taskSessionId)}
                                          >
                                            {taskSessionId}
                                          </button>
                                        ) : (
                                          '-'
                                        )}
                                      </p>
                                    </article>
                                  );
                                })}
                              </div>
                            </details>
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="empty">当前没有额外关联的 Sandbox 环境记录。</p>
                  )}
                  <details>
                    <summary>查看 Sandbox 原始环境记录</summary>
                    <pre className="json-block">
                      {toJsonText({
                        primaryEnvironment,
                        relatedEnvironments,
                      })}
                    </pre>
                  </details>
                </article>
              </div>

              <div className="panel-subtitle panel-subtitle-row">
                <span>OSAC / OpenCode 消息 ({conversationDetail.trace?.osac.messages.length ?? 0})</span>
                <div className="panel-subtitle-actions">
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => setShowOpencodePayload((prev) => !prev)}
                  >
                    {showOpencodePayload ? '隐藏原始 payload' : '显示原始 payload'}
                  </button>
                </div>
              </div>
              <div className="trace-list">
                {(conversationDetail.trace?.osac.messages || []).length === 0 ? (
                  <p className="empty">无 OSAC 消息</p>
                ) : (
                  (conversationDetail.trace?.osac.messages || []).map((message, index) => {
                    const payload = (message.payload || {}) as Record<string, unknown>;
                    const summary = summarizeText(
                      [
                        typeof payload.eventType === 'string' ? payload.eventType : '',
                        typeof payload.message === 'string' ? payload.message : '',
                        typeof payload.status === 'string' ? payload.status : '',
                        typeof payload.output === 'string' ? payload.output : '',
                      ]
                        .filter(Boolean)
                        .join(' | '),
                      320
                    );
                    const payloadTimestamp =
                      typeof payload.timestamp === 'string'
                        ? payload.timestamp
                        : typeof payload.time === 'string'
                          ? payload.time
                          : undefined;
                    return (
                      <article key={`${message.type}-${index}`} className="trace-item">
                        <p className="trace-head">
                          <span className="trace-level info">osac</span>
                          <strong>{message.type}</strong>
                          <span>{formatDateTime(payloadTimestamp)}</span>
                        </p>
                        {summary ? <p className="message-content">{summary}</p> : null}
                        {showOpencodePayload ? <pre className="json-block">{toJsonText(payload)}</pre> : null}
                      </article>
                    );
                  })
                )}
              </div>
                  </>
                );
              })()}
            </div>
          )}
        </article>
      </section>
    </main>
  );

  const renderConversationOpsSection = () => {
    const primaryEnvironment = conversationDetail?.trace?.sandbox.primaryEnvironment ?? null;
    const relatedEnvironments = (conversationDetail?.trace?.sandbox.relatedEnvironments || []).filter(
      (environment) => environment.id !== primaryEnvironment?.id
    );
    const primaryEnvironmentSandboxId = environmentSandboxId(primaryEnvironment);
    const primaryEnvironmentTaskSessionId = environmentTaskSessionId(primaryEnvironment);
    const primaryEnvironmentExecutor = environmentExecutor(primaryEnvironment);
    const primaryEnvironmentArchiveStatus = environmentArchiveStatus(primaryEnvironment);
    const primaryEnvironmentReplacementId = environmentReplacementSandboxId(primaryEnvironment);
    const governanceGroups = Object.values(
      relatedEnvironments.reduce<Record<string, { key: string; reason: string; items: SandboxEnvironmentItem[]; latestUpdatedAt: string }>>((groups, environment) => {
        const reason = sandboxDedupeReasonLabel(environmentDedupeReason(environment));
        const existing = groups[reason];
        if (existing) {
          existing.items.push(environment);
          if (toTimestamp(environment.updatedAt) > toTimestamp(existing.latestUpdatedAt)) {
            existing.latestUpdatedAt = environment.updatedAt;
          }
          return groups;
        }
        groups[reason] = {
          key: reason,
          reason,
          items: [environment],
          latestUpdatedAt: environment.updatedAt,
        };
        return groups;
      }, {})
    ).sort((left, right) => right.items.length - left.items.length || toTimestamp(right.latestUpdatedAt) - toTimestamp(left.latestUpdatedAt));
    const relatedEnvironmentGroups = Object.values(
      relatedEnvironments.reduce<Record<string, {
        key: string;
        status: string;
        executor: string;
        archiveStatus: string;
        governanceReason: string;
        items: SandboxEnvironmentItem[];
        latestUpdatedAt: string;
      }>>((groups, environment) => {
        const executor = environmentExecutor(environment) || '-';
        const archiveStatus = environmentArchiveStatus(environment) || '-';
        const governanceReason = sandboxDedupeReasonLabel(environmentDedupeReason(environment));
        const key = `${environment.status}__${executor}__${archiveStatus}__${governanceReason}`;
        const existing = groups[key];
        if (existing) {
          existing.items.push(environment);
          if (toTimestamp(environment.updatedAt) > toTimestamp(existing.latestUpdatedAt)) {
            existing.latestUpdatedAt = environment.updatedAt;
          }
          return groups;
        }
        groups[key] = {
          key,
          status: environment.status,
          executor,
          archiveStatus,
          governanceReason,
          items: [environment],
          latestUpdatedAt: environment.updatedAt,
        };
        return groups;
      }, {})
    ).sort((left, right) => right.items.length - left.items.length || toTimestamp(right.latestUpdatedAt) - toTimestamp(left.latestUpdatedAt));
    const visibleRelatedEnvironmentGroups = conversationGovernanceFilter
      ? relatedEnvironmentGroups.filter((group) => group.governanceReason === conversationGovernanceFilter)
      : relatedEnvironmentGroups;
    const finalVisibleRelatedEnvironmentGroups = conversationEnvironmentGroupFilter
      ? visibleRelatedEnvironmentGroups.filter((group) => group.key === conversationEnvironmentGroupFilter)
      : visibleRelatedEnvironmentGroups;
    const timelineItems = conversationDetail?.trace?.timeline || [];
    const llmItems = conversationDetail?.trace?.llm || [];
    const osacMessages = conversationDetail?.trace?.osac.messages || [];

    return (
      <main className="content-stack">
        <section className="summary-strip summary-strip-four fade-in">
          <article className="summary-card summary-card-emphasis">
            <span className="summary-card-label">总会话</span>
            <strong>{conversationSummary.total}</strong>
            <p>最近 200 条会话索引</p>
          </article>
          <article className="summary-card">
            <span className="summary-card-label">进行中</span>
            <strong>{conversationSummary.inProgress}</strong>
            <p>正在运行或处理中</p>
          </article>
          <article className="summary-card">
            <span className="summary-card-label">待确认</span>
            <strong>{conversationSummary.waitingUser}</strong>
            <p>等待用户补充信息</p>
          </article>
          <article className="summary-card">
            <span className="summary-card-label">当前阶段</span>
            <strong>{conversationDetail?.session.stage || '未选择'}</strong>
            <p>{conversationDetail?.session.title || '从左侧选择会话'}</p>
          </article>
        </section>

        <section className="conversation-ops-layout fade-in">
          <article className="panel conversation-index-panel">
            <div className="panel-header panel-header-stack">
              <div>
                <p className="section-tag">会话索引</p>
                <h2>会话索引列</h2>
              </div>
              <label className="conversation-auto-refresh-toggle">
                <input
                  type="checkbox"
                  checked={conversationAutoRefreshEnabled}
                  onChange={(event) => setConversationAutoRefreshEnabled(event.target.checked)}
                />
                <span>{conversationAutoRefreshEnabled ? '自动刷新中' : '已暂停自动刷新'}</span>
              </label>
            </div>
            <div className="conversation-index-toolbar">
              <label className="state-filter-field">
                <span>搜索会话</span>
                <input
                  type="search"
                  placeholder="sessionId / 标题 / 待确认问题"
                  value={conversationSearchQuery}
                  onChange={(event) => setConversationSearchQuery(event.target.value)}
                />
              </label>
              <div className="conversation-status-filter-group" role="group" aria-label="会话状态筛选">
                {[
                  { key: 'all', label: '全部' },
                  { key: 'in_progress', label: '进行中' },
                  { key: 'waiting_user', label: '待确认' },
                  { key: 'failed', label: '失败' },
                  { key: 'completed', label: '已完成' },
                ].map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={`toggle-btn ${conversationStatusFilter === item.key ? 'active' : ''}`}
                    onClick={() => setConversationStatusFilter(item.key as typeof conversationStatusFilter)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <p className="panel-caption">按更新时间排序 · {filteredConversationSessions.length} / {conversationSessions.length}</p>
            </div>
            <div className="session-list">
              {conversationSessions.length === 0 ? (
                <p className="empty">暂无对话会话。</p>
              ) : filteredConversationSessions.length === 0 ? (
                <p className="empty">当前筛选条件下无会话。</p>
              ) : (
                filteredConversationSessions.map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    className={`session-item ${selectedSessionId === session.id ? 'active' : ''}`}
                    onClick={() => {
                      if (selectedSessionId === session.id) return;
                      setSelectedSessionId(session.id);
                      setConversationDetailLoading(true);
                    }}
                  >
                    <div className="session-item-main">
                      <p className="session-title">{session.title || session.id}</p>
                      <p className="session-id mono">{truncateMiddle(session.id, 10, 8)}</p>
                      <p className="session-note">{session.pendingQuestion ? summarizeText(session.pendingQuestion, 72) : '无待确认问题'}</p>
                      <p className="session-meta">{formatDateTime(session.updatedAt)}</p>
                    </div>
                    <div className="session-item-side">
                      <span className={stateClassName(session.status)}>{statusLabel(session.status)}</span>
                      <span className="session-status">{session.stage || '-'}</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </article>

          <article className="panel conversation-workspace-panel">
            <div className="panel-header panel-header-stack">
              <div>
                <p className="section-tag">会话内容</p>
                <h2>{conversationDetail?.session.title || conversationDetail?.session.id || '会话内容'}</h2>
                <p className="panel-copy">状态流转、消息、时间线和 LLM 调用。</p>
              </div>
              {conversationDetail ? (
                <button type="button" className="secondary-btn" onClick={exportConversationDetail}>
                  下载会话
                </button>
              ) : null}
            </div>

            {!conversationDetail ? (
              <p className="empty">请选择左侧会话查看。</p>
            ) : (
              <div className="conversation-workspace-content">
                {conversationSwitching ? <div className="conversation-loading-mask">正在切换会话...</div> : null}
                <div className="conversation-detail">
                <div className="detail-grid detail-grid-wide summary-grid conversation-summary-grid">
                  <div>
                    <p className="kpi-title">会话 ID</p>
                    <p className="mono">{conversationDetail.session.id}</p>
                  </div>
                  <div>
                    <p className="kpi-title">状态</p>
                    <p>{statusLabel(conversationDetail.session.status)}</p>
                  </div>
                  <div>
                    <p className="kpi-title">阶段</p>
                    <p>{conversationDetail.session.stage || '-'}</p>
                  </div>
                  <div>
                    <p className="kpi-title">OpenCode ID</p>
                    <p className="mono">{conversationDetail.runtime?.opencodeSessionId || '-'}</p>
                  </div>
                  <div>
                    <p className="kpi-title">绑定更新时间</p>
                    <p>{formatDateTime(conversationDetail.runtime?.bindingUpdatedAt)}</p>
                  </div>
                </div>

                <div className="workspace-tab-strip">
                  <button type="button" className={`workspace-tab ${conversationWorkspaceTab === 'transitions' ? 'active' : ''}`} onClick={() => setConversationWorkspaceTab('transitions')}>
                    状态流转 ({conversationTabCounts.transitions})
                  </button>
                  <button type="button" className={`workspace-tab ${conversationWorkspaceTab === 'timeline' ? 'active' : ''}`} onClick={() => setConversationWorkspaceTab('timeline')}>
                    全链路时间线 ({conversationTabCounts.timeline})
                  </button>
                  <button type="button" className={`workspace-tab ${conversationWorkspaceTab === 'messages' ? 'active' : ''}`} onClick={() => setConversationWorkspaceTab('messages')}>
                    对话消息 ({conversationTabCounts.messages})
                  </button>
                  <button type="button" className={`workspace-tab ${conversationWorkspaceTab === 'llm' ? 'active' : ''}`} onClick={() => setConversationWorkspaceTab('llm')}>
                    LLM 调用 ({conversationTabCounts.llm})
                  </button>
                </div>

                {conversationWorkspaceTab === 'transitions' ? (
                  <>
                    <div className="panel-subtitle panel-subtitle-row">
                      <span>状态机流转 ({stateTransitions.length})</span>
                      <div className="panel-subtitle-actions">
                        <button type="button" className={`toggle-btn ${transitionView === 'timeline' ? 'active' : ''}`} onClick={() => setTransitionView('timeline')}>
                          时间轴
                        </button>
                        <button type="button" className={`toggle-btn ${transitionView === 'list' ? 'active' : ''}`} onClick={() => setTransitionView('list')}>
                          列表
                        </button>
                        <button
                          type="button"
                          className="secondary-btn"
                          onClick={() => {
                            setTransitionQuery('');
                            setTransitionFilters(DEFAULT_TRANSITION_FILTERS);
                            setTransitionAdvancedFiltersOpen(false);
                          }}
                        >
                          重置筛选
                        </button>
                      </div>
                    </div>

                    <div className="state-filter">
                      <div className="state-filter-row">
                        <label className="state-filter-field">
                          <span>搜索</span>
                          <input type="search" placeholder="按阶段 / 状态 / 消息内容搜索" value={transitionQuery} onChange={(event) => setTransitionQuery(event.target.value)} />
                        </label>
                        <label className="state-filter-field">
                          <span>开始时间</span>
                          <input type="datetime-local" value={transitionFilters.fromTime} onChange={(event) => setTransitionFilters((prev) => ({ ...prev, fromTime: event.target.value }))} />
                        </label>
                        <label className="state-filter-field">
                          <span>结束时间</span>
                          <input type="datetime-local" value={transitionFilters.toTime} onChange={(event) => setTransitionFilters((prev) => ({ ...prev, toTime: event.target.value }))} />
                        </label>
                      </div>
                      <div className="state-filter-advanced-toggle">
                        <button type="button" className="secondary-btn" onClick={() => setTransitionAdvancedFiltersOpen((prev) => !prev)}>
                          {transitionAdvancedFiltersOpen ? '收起高级筛选' : '展开高级筛选'}
                        </button>
                      </div>
                      {transitionAdvancedFiltersOpen ? (
                        <div className="state-filter-grid">
                          <label className="state-filter-field">
                            <span>起始阶段</span>
                            <select value={transitionFilters.fromStage} onChange={(event) => setTransitionFilters((prev) => ({ ...prev, fromStage: event.target.value }))}>
                              <option value="all">全部</option>
                              {transitionOptions.fromStages.map((value) => <option key={value} value={value}>{value}</option>)}
                            </select>
                          </label>
                          <label className="state-filter-field">
                            <span>目标阶段</span>
                            <select value={transitionFilters.toStage} onChange={(event) => setTransitionFilters((prev) => ({ ...prev, toStage: event.target.value }))}>
                              <option value="all">全部</option>
                              {transitionOptions.toStages.map((value) => <option key={value} value={value}>{value}</option>)}
                            </select>
                          </label>
                          <label className="state-filter-field">
                            <span>状态</span>
                            <select value={transitionFilters.status} onChange={(event) => setTransitionFilters((prev) => ({ ...prev, status: event.target.value }))}>
                              <option value="all">全部</option>
                              {transitionOptions.statuses.map((value) => <option key={value} value={value}>{value}</option>)}
                            </select>
                          </label>
                          <label className="state-filter-field">
                            <span>阶段(Phase)</span>
                            <select value={transitionFilters.phase} onChange={(event) => setTransitionFilters((prev) => ({ ...prev, phase: event.target.value }))}>
                              <option value="all">全部</option>
                              {transitionOptions.phases.map((value) => <option key={value} value={value}>{value}</option>)}
                            </select>
                          </label>
                          <label className="state-filter-field">
                            <span>消息类型</span>
                            <select value={transitionFilters.messageType} onChange={(event) => setTransitionFilters((prev) => ({ ...prev, messageType: event.target.value }))}>
                              <option value="all">全部</option>
                              {transitionOptions.messageTypes.map((value) => <option key={value} value={value}>{value}</option>)}
                            </select>
                          </label>
                          <label className="state-filter-field">
                            <span>角色</span>
                            <select value={transitionFilters.role} onChange={(event) => setTransitionFilters((prev) => ({ ...prev, role: event.target.value }))}>
                              <option value="all">全部</option>
                              {transitionOptions.roles.map((value) => <option key={value} value={value}>{value}</option>)}
                            </select>
                          </label>
                          <label className="state-filter-field">
                            <span>Agent</span>
                            <select value={transitionFilters.agent} onChange={(event) => setTransitionFilters((prev) => ({ ...prev, agent: event.target.value }))}>
                              <option value="all">全部</option>
                              {transitionOptions.agents.map((value) => <option key={value} value={value}>{value}</option>)}
                            </select>
                          </label>
                          <label className="state-filter-field">
                            <span>Tone</span>
                            <select value={transitionFilters.tone} onChange={(event) => setTransitionFilters((prev) => ({ ...prev, tone: event.target.value }))}>
                              <option value="all">全部</option>
                              {transitionOptions.tones.map((value) => <option key={value} value={value}>{value}</option>)}
                            </select>
                          </label>
                        </div>
                      ) : null}
                    </div>

                    <div className="kpi-grid conversation-kpi-grid">
                      <article className="kpi-card">
                        <p className="kpi-title">筛选后流转</p>
                        <p className="kpi-value">{transitionStats.filtered}</p>
                        <p className="kpi-meta">总计 {transitionStats.total} 条</p>
                      </article>
                      <article className="kpi-card">
                        <p className="kpi-title">命中阶段</p>
                        <p className="kpi-value">{transitionStats.stages.length}</p>
                        <p className="kpi-meta">{transitionStats.stages.slice(0, 3).join(' / ') || '无'}</p>
                      </article>
                      <article className="kpi-card">
                        <p className="kpi-title">命中状态</p>
                        <p className="kpi-value">{transitionStats.statuses.length}</p>
                        <p className="kpi-meta">{transitionStats.statuses.slice(0, 3).join(' / ') || '无'}</p>
                      </article>
                      <article className="kpi-card">
                        <p className="kpi-title">命中阶段相位</p>
                        <p className="kpi-value">{transitionStats.phases.length}</p>
                        <p className="kpi-meta">{transitionStats.phases.slice(0, 3).join(' / ') || '无'}</p>
                      </article>
                    </div>

                    {transitionView === 'timeline' ? (
                      <div className="state-timeline">
                        {filteredTransitions.length === 0 ? (
                          <p className="empty">当前筛选条件下无状态流转记录。</p>
                        ) : (
                          filteredTransitions.map((transition, index) => {
                            const trigger = transition.trigger || {};
                            const triggerSummary = [
                              trigger.messageType ? `type=${trigger.messageType}` : '',
                              trigger.role ? `role=${trigger.role}` : '',
                              trigger.agent ? `agent=${trigger.agent}` : '',
                              trigger.tone ? `tone=${trigger.tone}` : '',
                              trigger.messageId ? `id=${trigger.messageId}` : '',
                            ].filter(Boolean).join(' / ');
                            return (
                              <article key={`${transition.at || 'transition'}-${index}`} className="state-timeline-item">
                                <p className="state-timeline-head">
                                  <strong>{transition.from?.stage || '-'}</strong>
                                  <span>→</span>
                                  <strong>{transition.to?.stage || '-'}</strong>
                                  <span>{formatDateTime(transition.at)}</span>
                                </p>
                                <p className="state-timeline-meta">{formatStateSnapshot(transition.from)} → {formatStateSnapshot(transition.to)}</p>
                                <p className="state-transition-flow">
                                  <span className={stateClassName(transition.to?.status || 'unknown')}>{transition.to?.status || '-'}</span>
                                  {transition.to?.phase ? <span className="session-status">{transition.to.phase}</span> : null}
                                  {trigger.messageType ? <span className="session-status">{trigger.messageType}</span> : null}
                                </p>
                                {triggerSummary ? <p className="message-content">触发: {triggerSummary}</p> : null}
                                {trigger.content ? <p className="message-content">内容: {summarizeText(trigger.content, 240)}</p> : null}
                              </article>
                            );
                          })
                        )}
                      </div>
                    ) : (
                      <div className="trace-list">
                        {filteredTransitions.map((transition, index) => {
                          const trigger = transition.trigger || {};
                          const triggerSummary = [
                            trigger.messageType ? `type=${trigger.messageType}` : '',
                            trigger.role ? `role=${trigger.role}` : '',
                            trigger.agent ? `agent=${trigger.agent}` : '',
                            trigger.tone ? `tone=${trigger.tone}` : '',
                            trigger.messageId ? `id=${trigger.messageId}` : '',
                          ].filter(Boolean).join(' / ');
                          return (
                            <article key={`${transition.at || 'transition'}-${index}`} className="trace-item">
                              <p className="trace-head">
                                <span className={traceLevelClass('info')}>state</span>
                                <strong>{`${transition.from?.stage || '-'} → ${transition.to?.stage || '-'}`}</strong>
                                <span>{formatDateTime(transition.at)}</span>
                              </p>
                              <p className="trace-meta mono">{formatStateSnapshot(transition.from)} → {formatStateSnapshot(transition.to)}</p>
                              {triggerSummary ? <p className="message-content">触发: {triggerSummary}</p> : null}
                              {trigger.content ? <p className="message-content">内容: {summarizeText(trigger.content, 240)}</p> : null}
                            </article>
                          );
                        })}
                      </div>
                    )}
                  </>
                ) : null}

                {conversationWorkspaceTab === 'timeline' ? (
                  <div className="trace-list trace-list-tall">
                    {timelineItems.length === 0 ? (
                      <p className="empty">无链路事件</p>
                    ) : (
                      timelineItems.map((event) => (
                        <article key={event.id} className="trace-item">
                          <p className="trace-head">
                            <span className={traceLevelClass(event.level)}>{event.badge || event.level}</span>
                            <strong>{event.title}</strong>
                            <span>{formatDateTime(event.timestamp)}</span>
                          </p>
                          <p className="trace-meta mono">{event.source} / {event.category}</p>
                          {event.content ? <p className="message-content">{summarizeText(event.content, 360)}</p> : null}
                          {event.rawContent && event.rawContent !== event.content ? (
                            <details>
                              <summary>查看原文</summary>
                              <pre className="json-block">{event.rawContent}</pre>
                            </details>
                          ) : null}
                        </article>
                      ))
                    )}
                  </div>
                ) : null}

                {conversationWorkspaceTab === 'messages' ? (
                  <div className="message-list message-list-large">
                    {conversationDetail.messages.length === 0 ? (
                      <p className="empty">无消息</p>
                    ) : (
                      conversationDetail.messages.map((message) => (
                        <article key={message.id} className="message-item">
                          <p className="message-head">
                            <strong>{message.role}</strong> · {formatDateTime(message.createdAt)}
                          </p>
                          <p className="message-content">{message.content}</p>
                          {message.metadata !== undefined ? <pre className="json-block message-meta-json">{toJsonText(message.metadata)}</pre> : null}
                        </article>
                      ))
                    )}
                  </div>
                ) : null}

                {conversationWorkspaceTab === 'llm' ? (
                  <div className="llm-trace-list">
                    {llmItems.length === 0 ? (
                      <p className="empty">无 LLM 调用轨迹</p>
                    ) : (
                      llmItems.map((item) => {
                        const requestSize = Object.keys(item.request || {}).length;
                        const responseSize = Object.keys(item.response || {}).length;
                        return (
                          <details key={item.id} className="sub-panel llm-trace-item">
                            <summary>
                              <div className="trace-head">
                                <strong>{item.stage}</strong>
                                <span className="mono">{item.source}</span>
                                <span>{item.inferred ? '推断还原' : '真实命令'}</span>
                                <span>{formatDateTime(item.createdAt)}</span>
                              </div>
                              <p className="trace-meta">request {requestSize} 字段 · response {responseSize} 字段</p>
                            </summary>
                            <p className="kpi-title">请求内容</p>
                            <pre className="json-block">{toJsonText(item.request)}</pre>
                            <p className="kpi-title">返回内容</p>
                            <pre className="json-block">{toJsonText(item.response)}</pre>
                          </details>
                        );
                      })
                    )}
                  </div>
                ) : null}
                </div>
              </div>
            )}
          </article>

          <aside className="conversation-inspector-stack">
            <article className="panel conversation-inspector-panel">
              <div className="panel-header panel-header-stack">
                <div>
                  <p className="section-tag">关联信息</p>
                  <h2>运行绑定与关联信息</h2>
                </div>
                <span className="panel-caption">OpenCode / KVM / Sandbox / OSAC</span>
              </div>

              {!conversationDetail ? (
                <p className="empty">选择会话后，这里会显示运行绑定、KVM 摘要和 Sandbox 信息。</p>
              ) : (
                <div className="conversation-inspector-content">
                  {conversationInfraError ? (
                    <p className="panel-caption">关联信息加载异常：{conversationInfraError}</p>
                  ) : null}
                  <article className="sub-panel">
                    <div className="panel-header">
                      <h3>当前会话</h3>
                      <span className={stateClassName(conversationDetail.session.status)}>{statusLabel(conversationDetail.session.status)}</span>
                    </div>
                    <div className="detail-kv-list">
                      <div>
                        <span>阶段</span>
                        <strong>{conversationDetail.session.stage || '-'}</strong>
                      </div>
                      <div>
                        <span>OpenCode ID</span>
                        <strong className="mono">{conversationDetail.runtime?.opencodeSessionId || '-'}</strong>
                      </div>
                      <div>
                        <span>待补充问题</span>
                        <strong>{conversationDetail.runtime?.pendingQuestion || '-'}</strong>
                      </div>
                      <div>
                        <span>挂起原因</span>
                        <strong>{conversationDetail.runtime?.pendingResume?.reason || '-'}</strong>
                      </div>
                    </div>
                  </article>

                  <article className="sub-panel">
                    <div className="panel-header">
                      <h3>KVM / Sandbox 摘要</h3>
                    </div>
                    <div className="detail-kv-list">
                      <div>
                        <span>编排 ID</span>
                        {conversationDetail.runtime?.orchestratorSessionId ? (
                          <button type="button" className="link-btn sandbox-jump-btn mono" onClick={() => openSandboxFromConversation(conversationDetail.runtime?.orchestratorSessionId)}>
                            {conversationDetail.runtime.orchestratorSessionId}
                          </button>
                        ) : (
                          <strong className="mono">-</strong>
                        )}
                      </div>
                      <div>
                        <span>VM 名称</span>
                        <strong className="mono">{conversationDetail.runtime?.vmName || '-'}</strong>
                      </div>
                      <div>
                        <span>主 Sandbox</span>
                        {primaryEnvironmentSandboxId ? (
                          <button type="button" className="link-btn sandbox-jump-btn mono" onClick={() => openSandboxFromConversation(primaryEnvironmentSandboxId)}>
                            {primaryEnvironmentSandboxId}
                          </button>
                        ) : (
                          <strong className="mono">-</strong>
                        )}
                      </div>
                      <div>
                        <span>Executor</span>
                        <strong>{primaryEnvironmentExecutor || '-'}</strong>
                      </div>
                      <div>
                        <span>归档状态</span>
                        <strong>{archiveStatusLabel(primaryEnvironmentArchiveStatus)}</strong>
                      </div>
                      <div>
                        <span>关联记录数</span>
                        <strong>{relatedEnvironments.length}</strong>
                      </div>
                    </div>
                    {primaryEnvironmentTaskSessionId ? (
                      <p className="session-meta">
                        主记录会话：
                        <button type="button" className="link-btn sandbox-jump-btn mono" onClick={() => openConversationSessionFromSandbox(primaryEnvironmentTaskSessionId)}>
                          {primaryEnvironmentTaskSessionId}
                        </button>
                      </p>
                    ) : null}
                    {primaryEnvironmentReplacementId ? (
                      <p className="session-meta">
                        已由{' '}
                        <button type="button" className="link-btn sandbox-jump-btn mono" onClick={() => openSandboxFromConversation(primaryEnvironmentReplacementId)}>
                          {primaryEnvironmentReplacementId}
                        </button>{' '}
                        接管
                      </p>
                    ) : null}
                  </article>

                  <article className="sub-panel">
                    <div className="panel-header panel-header-stack">
                      <div>
                        <h3>Sandbox 分组</h3>
                        <span className="panel-caption">{conversationGovernanceFilter ? `当前筛选：${conversationGovernanceFilter}` : `共 ${governanceGroups.length} 类原因`}</span>
                      </div>
                      {conversationGovernanceFilter ? (
                        <button type="button" className="secondary-btn" onClick={() => setConversationGovernanceFilter(null)}>
                          清除
                        </button>
                      ) : null}
                    </div>
                    {governanceGroups.length === 0 ? (
                      <p className="empty">当前没有额外关联的 Sandbox 环境记录。</p>
                    ) : (
                      <div className="conversation-sandbox-governance-grid">
                        {governanceGroups.map((group) => (
                          <button
                            key={group.key}
                            type="button"
                            className={`sub-panel conversation-sandbox-card conversation-sandbox-governance-card conversation-sandbox-governance-filter ${conversationGovernanceFilter === group.reason ? 'active' : ''}`}
                            onClick={() => setConversationGovernanceFilter((prev) => (prev === group.reason ? null : group.reason))}
                          >
                            <div className="trace-head">
                              <strong>{group.reason}</strong>
                              <span className="session-status session-status-governance">分组</span>
                            </div>
                            <p className="trace-meta">共 {group.items.length} 条 · 最近更新时间 {formatDateTime(group.latestUpdatedAt)}</p>
                          </button>
                        ))}
                      </div>
                    )}

                    {finalVisibleRelatedEnvironmentGroups.length ? (
                      <div className="conversation-sandbox-list">
                        {finalVisibleRelatedEnvironmentGroups.map((group) => {
                          const groupSelected = conversationEnvironmentGroupFilter === group.key;
                          return (
                            <article key={group.key} className={`sub-panel conversation-sandbox-card conversation-sandbox-group-filter ${groupSelected ? 'active' : ''}`}>
                              <button
                                type="button"
                                className="conversation-sandbox-group-head"
                                onClick={() => setConversationEnvironmentGroupFilter((prev) => (prev === group.key ? null : group.key))}
                              >
                                <div className="trace-head">
                                  <strong>
                                    {group.status} · {group.executor}
                                  </strong>
                                  <span className="mono">{formatDateTime(group.latestUpdatedAt)}</span>
                                </div>
                                <p className="trace-meta">
                                  归档: {archiveStatusLabel(group.archiveStatus)} · 原因: {group.governanceReason} · 共 {group.items.length} 条
                                </p>
                              </button>
                              <details open={groupSelected}>
                                <summary>{groupSelected ? '收起该组 Sandbox' : '查看该组 Sandbox'}</summary>
                                <div className="conversation-sandbox-list">
                                  {group.items.map((environment) => {
                                    const sandboxId = environmentSandboxId(environment);
                                    const taskSessionId = environmentTaskSessionId(environment);
                                    return (
                                      <article key={environment.id} className="sub-panel conversation-sandbox-card">
                                        <div className="trace-head">
                                          <strong>{environment.status}</strong>
                                          <span className="mono">{formatDateTime(environment.updatedAt)}</span>
                                        </div>
                                        <p className="trace-meta">
                                          Sandbox：
                                          {sandboxId ? (
                                            <button type="button" className="link-btn sandbox-jump-btn mono" onClick={() => openSandboxFromConversation(sandboxId)}>
                                              {sandboxId}
                                            </button>
                                          ) : (
                                            '-'
                                          )}
                                        </p>
                                        <p className="trace-meta">
                                          会话：
                                          {taskSessionId ? (
                                            <button type="button" className="link-btn sandbox-jump-btn mono" onClick={() => openConversationSessionFromSandbox(taskSessionId)}>
                                              {taskSessionId}
                                            </button>
                                          ) : (
                                            '-'
                                          )}
                                        </p>
                                      </article>
                                    );
                                  })}
                                </div>
                              </details>
                            </article>
                          );
                        })}
                      </div>
                    ) : null}
                  </article>

                  <details className="sub-panel conversation-osac-panel">
                    <summary>
                      <div className="panel-header panel-header-stack">
                        <div>
                          <h3>OSAC / OpenCode</h3>
                          <span className="panel-caption">{osacMessages.length} 条消息</span>
                        </div>
                      </div>
                    </summary>
                    <div className="conversation-osac-panel-body">
                      <button type="button" className="secondary-btn" onClick={() => setShowOpencodePayload((prev) => !prev)}>
                        {showOpencodePayload ? '隐藏 payload' : '显示 payload'}
                      </button>
                      <div className="trace-list conversation-osac-list">
                        {osacMessages.length === 0 ? (
                          <p className="empty">无 OSAC 消息</p>
                        ) : (
                          osacMessages.map((message, index) => {
                            const payload = (message.payload || {}) as Record<string, unknown>;
                            const summary = summarizeText(
                              [
                                typeof payload.eventType === 'string' ? payload.eventType : '',
                                typeof payload.message === 'string' ? payload.message : '',
                                typeof payload.status === 'string' ? payload.status : '',
                                typeof payload.output === 'string' ? payload.output : '',
                              ].filter(Boolean).join(' | '),
                              220
                            );
                            const payloadTimestamp =
                              typeof payload.timestamp === 'string'
                                ? payload.timestamp
                                : typeof payload.time === 'string'
                                  ? payload.time
                                  : undefined;
                            return (
                              <article key={`${message.type}-${index}`} className="trace-item">
                                <p className="trace-head">
                                  <span className="trace-level info">osac</span>
                                  <strong>{message.type}</strong>
                                  <span>{formatDateTime(payloadTimestamp)}</span>
                                </p>
                                {summary ? <p className="message-content">{summary}</p> : null}
                                {showOpencodePayload ? <pre className="json-block">{toJsonText(payload)}</pre> : null}
                              </article>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </details>

                  <details className="sub-panel">
                    <summary>KVM / Sandbox 原始状态</summary>
                    <pre className="json-block">
                      {toJsonText({
                        kvm: {
                          orchestratorSessionId: conversationDetail.trace?.kvm.orchestratorSessionId,
                          vmName: conversationDetail.trace?.kvm.vmName,
                          quota: conversationDetail.trace?.kvm.quota,
                          session: conversationDetail.trace?.kvm.session,
                          sessionVm: conversationDetail.trace?.kvm.sessionVm,
                          sandbox: conversationDetail.trace?.kvm.sandbox,
                          sandboxIp: conversationDetail.trace?.kvm.sandboxIp,
                          sandboxPorts: conversationDetail.trace?.kvm.sandboxPorts,
                          vmDetail: conversationDetail.trace?.kvm.vmDetail,
                          vmMetrics: conversationDetail.trace?.kvm.vmMetrics,
                          errors: conversationDetail.trace?.kvm.errors,
                        },
                        sandbox: {
                          primaryEnvironment,
                          relatedEnvironments,
                        },
                      })}
                    </pre>
                  </details>
                </div>
              )}
            </article>
          </aside>
        </section>
      </main>
    );
  };

  const renderAgentSection = () => (
    <main className="content-stack">
      <section className="page-intro-grid fade-in">
        <article className="panel hero-panel">
          <div className="panel-header panel-header-stack">
            <div>
              <p className="section-tag">服务健康</p>
              <h2>平台接口、智能体服务和能力状态</h2>
            </div>
            <span className={`service-state ${agentOverview?.agentApi.online ? 'ok' : 'down'}`}>
              {agentOverview?.agentApi.online ? '智能体服务在线' : '智能体服务离线'}
            </span>
          </div>
          <div className="hero-metrics">
            <div>
              <span className="hero-metric-label">能力总数</span>
              <strong>{agentCapabilitySummary.total}</strong>
            </div>
            <div>
              <span className="hero-metric-label">可用</span>
              <strong>{agentCapabilitySummary.available}</strong>
            </div>
            <div>
              <span className="hero-metric-label">规划中</span>
              <strong>{agentCapabilitySummary.planned}</strong>
            </div>
          </div>
        </article>

        <article className="panel aside-panel">
          <div className="panel-header panel-header-stack">
            <div>
              <p className="section-tag">会话状态</p>
              <h2>会话状态摘要</h2>
            </div>
          </div>
          <div className="detail-kv-list">
            <div>
              <span>总会话</span>
              <strong>{agentOverview?.taskCreationSessions.total ?? 0}</strong>
            </div>
            <div>
              <span>待确认</span>
              <strong>{agentOverview?.taskCreationSessions.waitingUser ?? 0}</strong>
            </div>
            <div>
              <span>最近状态</span>
              <strong>{agentOverview?.agentApi.message || '-'}</strong>
            </div>
          </div>
        </article>
      </section>

      <section className="kpi-grid fade-in">
        <article className="kpi-card">
          <p className="kpi-title">平台接口</p>
          <p className="kpi-value">{agentOverview?.oneceoApi.online ? '在线' : '离线'}</p>
          <p className="kpi-meta">{formatDateTime(agentOverview?.oneceoApi.timestamp)}</p>
        </article>
        <article className="kpi-card">
          <p className="kpi-title">智能体服务</p>
          <p className="kpi-value">{agentOverview?.agentApi.online ? '在线' : '离线'}</p>
          <p className="kpi-meta">{agentOverview?.agentApi.message || '-'}</p>
        </article>
        <article className="kpi-card">
          <p className="kpi-title">会话总数</p>
          <p className="kpi-value">{agentOverview?.taskCreationSessions.total ?? 0}</p>
          <p className="kpi-meta">当前会话记录</p>
        </article>
        <article className="kpi-card">
          <p className="kpi-title">待确认会话</p>
          <p className="kpi-value">{agentOverview?.taskCreationSessions.waitingUser ?? 0}</p>
          <p className="kpi-meta">状态为待用户确认</p>
        </article>
      </section>

      <section className="chart-grid fade-in">
        <article className="panel">
          <div className="panel-header">
            <h2>任务阶段分布</h2>
            <span className="panel-caption">按任务创建阶段统计</span>
          </div>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={agentOverview?.stageDistribution ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#dbe7f4" />
                <XAxis dataKey="label" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="value" name="数量" fill="#0f766e" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <h2>智能体能力卡</h2>
            <span className="panel-caption">可用性与接入方式</span>
          </div>
          <div className="capability-grid">
            {(agentOverview?.capabilities || []).map((item) => (
              <article key={item.key} className="capability-card">
                <p className="capability-name">{item.name}</p>
                <p className="capability-meta">{item.transport}</p>
                <p className="mono">{item.endpoint}</p>
                <span className={`capability-status ${item.status}`}>{item.status}</span>
              </article>
            ))}
          </div>
        </article>
      </section>
    </main>
  );

  const renderSandboxSection = () => {
    const liveSandboxIdSet = new Set(sandboxOverviewItems.map((item) => item.sandboxId).filter(Boolean));
    const currentScopeItems =
      liveSandboxIdSet.size === 0
        ? sandboxRegistryItems
        : sandboxRegistryItems.filter((item) => liveSandboxIdSet.has(item.sandboxId));
    const summary = {
      total: sandboxOverview?.summary.total ?? currentScopeItems.length,
      running:
        sandboxOverview?.summary.running ??
        currentScopeItems.filter((item) => item.sandboxState === 'running' || (!item.sandboxState && item.status === 'ready')).length,
      paused: sandboxOverview?.summary.paused ?? currentScopeItems.filter((item) => item.sandboxState === 'paused').length,
      pendingArchive: currentScopeItems.filter((item) => item.pendingArchiveUpdate || item.archiveStatus === 'pending_update').length,
      archiveFailed: currentScopeItems.filter((item) => item.archiveStatus === 'failed').length,
      risky: currentScopeItems.filter((item) => item.riskTags.length > 0).length,
    };
    const riskyItems = currentScopeItems
      .filter((item) => item.riskTags.length > 0)
      .sort((a, b) => b.riskTags.length - a.riskTags.length || toTimestamp(b.lastActiveAt || b.updatedAt) - toTimestamp(a.lastActiveAt || a.updatedAt))
      .slice(0, 6);
    const riskGroupMap = new Map<string, {
      label: string;
      count: number;
      lastSeenAt: string | null;
    }>();
    currentScopeItems.forEach((item) => {
      item.riskTags.forEach((risk) => {
        const previous = riskGroupMap.get(risk);
        const candidateTime = item.lastActiveAt || item.updatedAt || item.createdAt || null;
        if (!previous) {
          riskGroupMap.set(risk, {
            label: risk,
            count: 1,
            lastSeenAt: candidateTime,
          });
          return;
        }
        previous.count += 1;
        if (toTimestamp(candidateTime) > toTimestamp(previous.lastSeenAt)) {
          previous.lastSeenAt = candidateTime;
        }
      });
    });
    const riskGroups = Array.from(riskGroupMap.values()).sort(
      (a, b) => b.count - a.count || toTimestamp(b.lastSeenAt) - toTimestamp(a.lastSeenAt) || a.label.localeCompare(b.label)
    );
    const executorDistribution = Array.from(
      currentScopeItems.reduce((acc, item) => {
        const key = item.executor || 'unknown';
        acc.set(key, (acc.get(key) || 0) + 1);
        return acc;
      }, new Map<string, number>())
    )
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
    const executorOptions = Array.from(new Set(sandboxRegistryItems.map((item) => item.executor).filter(Boolean))).sort();
    const statusOptions = Array.from(
      new Set([
        ...sandboxRegistryItems.map((item) => item.sandboxState || item.status).filter(Boolean),
        'running',
        'paused',
        'pending_archive',
      ])
    ).sort();
    const runtimeQuickStatusFilters = [
      { label: '全部', value: 'all', count: summary?.total ?? 0, meta: '全部 Sandbox' },
      { label: '运行中', value: 'running', count: summary?.running ?? 0, meta: '运行中的 Sandbox' },
      { label: '暂停中', value: 'paused', count: summary?.paused ?? 0, meta: '暂停且不计费' },
      { label: '待归档', value: 'pending_archive', count: summary?.pendingArchive ?? 0, meta: '待归档更新' },
    ];
    const riskOptions = riskGroups.map((item) => item.label);
    const canLoadMoreRuntime = Boolean(sandboxRuntimeRegistry?.hasMore);
    const loadedRuntimeCount = sandboxRegistryItems.length;
    const loadMoreTargetCount = Math.max(loadedRuntimeCount, sandboxRegistryLimit);
    const loadMoreRangeStart = loadedRuntimeCount + 1;
    const loadMoreRangeEnd = loadMoreTargetCount;
    const runtimeFilteredItems = sandboxRegistryItems
      .filter((item) => {
        const query = sandboxRuntimeQuery.trim().toLowerCase();
        if (!query) return true;
        return [
          item.taskSessionId,
          item.sandboxId,
          item.taskTitle,
          item.template,
          item.executor,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(query));
      })
      .filter((item) => sandboxExecutorFilter === 'all' || item.executor === sandboxExecutorFilter)
      .filter((item) => {
        if (sandboxStatusFilter === 'all') return true;
        if (sandboxStatusFilter === 'running') {
          return item.sandboxState === 'running' || (!item.sandboxState && item.status === 'ready');
        }
        if (sandboxStatusFilter === 'pending_archive') {
          return item.pendingArchiveUpdate || item.archiveStatus === 'pending_update';
        }
        return (item.sandboxState || item.status) === sandboxStatusFilter;
      })
      .filter((item) => sandboxRiskFilter === 'all' || item.riskTags.includes(sandboxRiskFilter));
    const runtimeItems = [...runtimeFilteredItems].sort((a, b) => {
      let delta = 0;
      if (runtimeSort.key === 'task_session') {
        delta = (a.taskSessionId || '').localeCompare(b.taskSessionId || '', 'zh-Hans-CN', { sensitivity: 'base' });
      } else if (runtimeSort.key === 'sandbox') {
        delta = (a.sandboxId || '').localeCompare(b.sandboxId || '', 'zh-Hans-CN', { sensitivity: 'base' });
      } else if (runtimeSort.key === 'executor') {
        delta = (a.executor || '').localeCompare(b.executor || '', 'zh-Hans-CN', { sensitivity: 'base' });
      } else if (runtimeSort.key === 'status') {
        delta = (a.sandboxState || a.status || '').localeCompare(b.sandboxState || b.status || '', 'zh-Hans-CN', { sensitivity: 'base' });
      } else if (runtimeSort.key === 'risk') {
        delta = a.riskTags.length - b.riskTags.length;
      } else if (runtimeSort.key === 'last_active') {
        delta =
          toTimestamp(a.lastActiveAt || a.updatedAt || a.createdAt) - toTimestamp(b.lastActiveAt || b.updatedAt || b.createdAt);
      }

      if (delta !== 0) {
        return runtimeSort.direction === 'asc' ? delta : -delta;
      }

      const riskDelta = b.riskTags.length - a.riskTags.length;
      if (riskDelta !== 0) return riskDelta;
      return toTimestamp(b.lastActiveAt || b.updatedAt || b.createdAt) - toTimestamp(a.lastActiveAt || a.updatedAt || a.createdAt);
    });
    const runtimeSkeletonRowCount = runtimeItems.length > 0 && sandboxRegistryLoadingMore ? 4 : 0;
    const archiveRows = sandboxRuntimeDetail
      ? ((sandboxArchiveHistory.length > 0
          ? sandboxArchiveHistory.map((item) => ({
              id: item.snapshotKey,
              snapshotKey: item.snapshotKey,
              timestamp: item.archivedAt,
              type: item.isCurrent ? 'current' : 'snapshot',
              size: item.sizeBytes ? `${Math.max(1, Math.round(item.sizeBytes / 1024))} KB` : '-',
              sizeBytes: item.sizeBytes ?? null,
              hash: item.sha256 || item.archiveKey || '-',
              status: item.status || 'archived',
              reason: item.reason || '-',
            }))
          : [
              {
                id: sandboxRuntimeDetail.archive.snapshotKey || sandboxRuntimeDetail.archive.archiveKey || 'snapshot-current',
                snapshotKey: sandboxRuntimeDetail.archive.snapshotKey || null,
                timestamp:
                  sandboxRuntimeDetail.archive.restoredAt ||
                  sandboxRuntimeDetail.archive.archivePendingSince ||
                  sandboxRuntimeDetail.runtime.updatedAt ||
                  sandboxRuntimeDetail.runtime.createdAt,
                type: sandboxRuntimeDetail.archive.archiveDirty ? 'dirty' : 'snapshot',
                size: sandboxDetail ? `${sandboxDetail.diskSizeMB} MB` : '-',
                sizeBytes: sandboxDetail ? sandboxDetail.diskSizeMB * 1024 * 1024 : null,
                hash: sandboxRuntimeDetail.archive.metadataKey || sandboxRuntimeDetail.archive.archiveKey || '-',
                status: sandboxRuntimeDetail.archive.archiveStatus || 'unknown',
                reason: sandboxRuntimeDetail.archive.lastDirtyReason || '-',
              },
            ]))
      : [];
    const archiveSortedRows = [...archiveRows].sort((a, b) => {
      let delta = 0;
      if (archiveSort.key === 'time') {
        delta = toTimestamp(a.timestamp) - toTimestamp(b.timestamp);
      } else if (archiveSort.key === 'type') {
        delta = (a.type || '').localeCompare(b.type || '', 'zh-Hans-CN', { sensitivity: 'base' });
      } else if (archiveSort.key === 'size') {
        delta = (a.sizeBytes ?? -1) - (b.sizeBytes ?? -1);
      } else if (archiveSort.key === 'reason') {
        delta = (a.reason || '').localeCompare(b.reason || '', 'zh-Hans-CN', { sensitivity: 'base' });
      } else if (archiveSort.key === 'status') {
        delta = (a.status || '').localeCompare(b.status || '', 'zh-Hans-CN', { sensitivity: 'base' });
      }

      if (delta !== 0) {
        return archiveSort.direction === 'asc' ? delta : -delta;
      }

      return toTimestamp(b.timestamp) - toTimestamp(a.timestamp);
    });
    const currentArchiveRow =
      archiveRows.find((row) => row.type === 'current') ||
      [...archiveRows].sort((a, b) => toTimestamp(b.timestamp) - toTimestamp(a.timestamp))[0] ||
      null;

    return (
      <>
        <main className="content-stack">
          <section className="panel hero-panel fade-in sandbox-console-header">
            <div className="panel-header panel-header-stack">
              <div>
                <p className="section-tag">Sandbox 摘要</p>
                <h2>Sandbox、归档与连通性</h2>
              </div>
              <div className="action-inline">
                <span className={`service-state ${sandboxApi?.online ? 'ok' : 'down'}`}>
                  {sandboxApi?.online ? 'Sandbox 服务在线' : 'Sandbox 服务离线'}
                </span>
                <span className="updated-at">{formatDateTime(sandboxApi?.timestamp)}</span>
              </div>
            </div>
            <div className="sandbox-summary-strip">
              <div className="sandbox-summary-card">
                <span className="hero-metric-label">总环境</span>
                <strong>{summary?.total ?? 0}</strong>
              </div>
              <div className="sandbox-summary-card">
                <span className="hero-metric-label">运行中</span>
                <strong>{summary?.running ?? 0}</strong>
              </div>
              <div className="sandbox-summary-card">
                <span className="hero-metric-label">暂停中</span>
                <strong>{summary?.paused ?? 0}</strong>
              </div>
              <div className="sandbox-summary-card">
                <span className="hero-metric-label">待归档</span>
                <strong>{summary?.pendingArchive ?? 0}</strong>
              </div>
              <div className="sandbox-summary-card">
                <span className="hero-metric-label">风险项</span>
                <strong>{summary?.risky ?? 0}</strong>
              </div>
            </div>
          </section>

          <section className="panel fade-in">
            <div className="panel-header">
              <div>
                <h2>Sandbox 工作区</h2>
                <span className="panel-caption">主工作区切换</span>
              </div>
              <button
                type="button"
                className="primary-btn"
                onClick={() => setSandboxCreateDrawerOpen(true)}
              >
                新建 Sandbox
              </button>
            </div>
            <div className="button-grid button-grid-three">
              <button
                type="button"
                className={`secondary-btn ${sandboxTab === 'overview' ? 'active' : ''}`}
                onClick={() => setSandboxTab('overview')}
              >
                摘要
              </button>
              <button
                type="button"
                className={`secondary-btn ${sandboxTab === 'runtime' ? 'active' : ''}`}
                onClick={() => setSandboxTab('runtime')}
              >
                Sandbox
              </button>
              <button
                type="button"
                className={`secondary-btn ${sandboxTab === 'templates' ? 'active' : ''}`}
                onClick={() => setSandboxTab('templates')}
              >
                模板
              </button>
            </div>
          </section>

          {sandboxTab === 'overview' ? (
            <>
              <section className="kpi-grid fade-in">
                <article className="kpi-card">
                  <p className="kpi-title">Sandbox 服务</p>
                  <p className="kpi-value">{sandboxApi?.online ? '在线' : '离线'}</p>
                  <p className="kpi-meta">{sandboxApi?.service || '-'}</p>
                </article>
                <article className="kpi-card">
                  <p className="kpi-title">暂停中</p>
                  <p className="kpi-value">{summary?.paused ?? 0}</p>
                  <p className="kpi-meta">不计费状态</p>
                </article>
                <article className="kpi-card">
                  <p className="kpi-title">待归档</p>
                  <p className="kpi-value">{summary?.pendingArchive ?? 0}</p>
                  <p className="kpi-meta">待归档更新</p>
                </article>
                <article className="kpi-card">
                  <p className="kpi-title">高风险 Sandbox</p>
                  <p className="kpi-value">{summary?.risky ?? 0}</p>
                  <p className="kpi-meta">需人工排查</p>
                </article>
                <article className="kpi-card">
                  <p className="kpi-title">归档失败</p>
                  <p className="kpi-value">{summary?.archiveFailed ?? 0}</p>
                  <p className="kpi-meta">归档失败</p>
                </article>
              </section>

              <section className="chart-grid fade-in">
                <article className="panel">
                  <div className="panel-header">
                    <h2>Executor 分布</h2>
                    <span className="panel-caption">模式分布</span>
                  </div>
                  <div className="compact-list">
                    {executorDistribution.map((item) => (
                      <div key={item.label} className="compact-item">
                        <strong>{item.label}</strong>
                        <span className="session-status">{item.value}</span>
                      </div>
                    ))}
                  </div>
                </article>

                <article className="panel">
                  <div className="panel-header">
                    <h2>风险关注</h2>
                    <span className="panel-caption">按状态和原因筛选</span>
                  </div>
                  <div className="compact-list">
                    {riskyItems.length === 0 ? (
                      <p className="empty">当前没有高风险 Sandbox。</p>
                    ) : (
                      riskyItems.map((item) => (
                        <div key={item.sandboxId} className="compact-item">
                          <div>
                            <strong>{item.taskSessionId || item.sandboxId}</strong>
                            <p className="session-meta">{item.riskTags.join(' / ')}</p>
                          </div>
                          <button type="button" className="secondary-btn" onClick={() => void openSandboxDetail(item.sandboxId)}>
                            查看
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </article>
              </section>
            </>
          ) : null}

          {sandboxTab === 'runtime' ? (
            <section className="sandbox-runtime-layout fade-in">
              <article className="panel sandbox-runtime-main">
                <div className="panel-header">
                  <div>
                    <h2>Sandbox 列表</h2>
                    <span className={`panel-caption ${sandboxRegistryLoadingMore ? 'runtime-load-caption-active' : ''}`} aria-live="polite">
                      {sandboxRegistryLoadingMore
                        ? `已加载 ${loadedRuntimeCount} 条，正在加载第 ${loadMoreRangeStart}-${loadMoreRangeEnd} 条`
                        : `已加载 ${loadedRuntimeCount} 条，当前筛选命中 ${runtimeItems.length} 条`}
                    </span>
                  </div>
                  <span className="session-status">
                    {runtimeItems.length} / {loadedRuntimeCount}
                  </span>
                </div>
                <div className="runtime-quick-filters">
                  {runtimeQuickStatusFilters.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      className={`toggle-btn runtime-quick-filter runtime-status-group-item ${sandboxStatusFilter === item.value ? 'active' : ''}`}
                      onClick={() => setSandboxStatusFilter(item.value)}
                    >
                      <span className="runtime-status-group-main">{item.label}</span>
                      <span className="runtime-status-group-meta">{item.meta}</span>
                      <span className="session-status runtime-status-group-count">{item.count}</span>
                    </button>
                  ))}
                </div>
                <div className="runtime-risk-groups">
                  <div className="runtime-risk-groups-head">
                    <span className="panel-caption">风险聚合</span>
                    <span className="session-status">{riskGroups.length} 类风险</span>
                  </div>
                  {riskGroups.length === 0 ? (
                    <p className="empty runtime-risk-empty">当前没有高风险 Sandbox。</p>
                  ) : (
                    <div className="runtime-risk-group-list">
                      {riskGroups.map((group) => (
                        <button
                          key={group.label}
                          type="button"
                          className={`secondary-btn runtime-risk-group-btn ${sandboxRiskFilter === group.label ? 'active' : ''}`}
                          onClick={() => setSandboxRiskFilter((prev) => (prev === group.label ? 'all' : group.label))}
                          title={`最近出现：${formatDateTime(group.lastSeenAt)}`}
                        >
                          <span className="runtime-risk-group-main">{group.label}</span>
                          <span className="runtime-risk-group-meta">最近出现：{formatDateTime(group.lastSeenAt)}</span>
                          <span className="session-status runtime-risk-group-count">{group.count}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="runtime-filter-grid">
                  <label className="state-filter-field">
                    <span>搜索 Sandbox</span>
                    <input
                      type="text"
                      value={sandboxRuntimeQuery}
                      placeholder="sessionId / sandboxId / template"
                      onChange={(event) => setSandboxRuntimeQuery(event.target.value)}
                    />
                  </label>
                  <label className="state-filter-field">
                    <span>Executor</span>
                    <select value={sandboxExecutorFilter} onChange={(event) => setSandboxExecutorFilter(event.target.value)}>
                      <option value="all">全部</option>
                      {executorOptions.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="state-filter-field">
                    <span>状态</span>
                    <select value={sandboxStatusFilter} onChange={(event) => setSandboxStatusFilter(event.target.value)}>
                      <option value="all">全部</option>
                      {statusOptions.map((item) => (
                        <option key={item} value={item}>
                          {item === 'pending_archive' ? 'pending_archive' : item}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="state-filter-field">
                    <span>风险标签</span>
                    <select value={sandboxRiskFilter} onChange={(event) => setSandboxRiskFilter(event.target.value)}>
                      <option value="all">全部</option>
                      {riskOptions.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {runtimeItems.length === 0 ? (
                  <p className="empty runtime-empty-state">当前筛选条件下没有 Sandbox 记录</p>
                ) : null}
                <div className="table-wrap table-wrap-runtime" aria-busy={sandboxRegistryLoadingMore}>
                  <table className="runtime-table">
                    <colgroup>
                      <col style={{ width: `${runtimeColumnWidths.task_session}px` }} />
                      <col style={{ width: `${runtimeColumnWidths.sandbox}px` }} />
                      <col style={{ width: `${runtimeColumnWidths.executor}px` }} />
                      <col style={{ width: `${runtimeColumnWidths.status}px` }} />
                      <col style={{ width: `${runtimeColumnWidths.risk}px` }} />
                      <col style={{ width: `${runtimeColumnWidths.last_active}px` }} />
                      <col style={{ width: `${runtimeColumnWidths.actions}px` }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>
                          <div className="runtime-th-wrap">
                            <button type="button" className={`runtime-sort-btn ${runtimeSort.key === 'task_session' ? 'active' : ''}`} onClick={() => toggleRuntimeSort('task_session')}>
                              会话 ID
                              <span className="runtime-sort-indicator">{runtimeSort.key === 'task_session' ? (runtimeSort.direction === 'asc' ? '▲' : '▼') : '↕'}</span>
                            </button>
                            <span className="runtime-col-resize-handle" onMouseDown={(event) => beginRuntimeColumnResize('task_session', event)} />
                          </div>
                        </th>
                        <th>
                          <div className="runtime-th-wrap">
                            <button type="button" className={`runtime-sort-btn ${runtimeSort.key === 'sandbox' ? 'active' : ''}`} onClick={() => toggleRuntimeSort('sandbox')}>
                              Sandbox
                              <span className="runtime-sort-indicator">{runtimeSort.key === 'sandbox' ? (runtimeSort.direction === 'asc' ? '▲' : '▼') : '↕'}</span>
                            </button>
                            <span className="runtime-col-resize-handle" onMouseDown={(event) => beginRuntimeColumnResize('sandbox', event)} />
                          </div>
                        </th>
                        <th>
                          <div className="runtime-th-wrap">
                            <button type="button" className={`runtime-sort-btn ${runtimeSort.key === 'executor' ? 'active' : ''}`} onClick={() => toggleRuntimeSort('executor')}>
                              Executor
                              <span className="runtime-sort-indicator">{runtimeSort.key === 'executor' ? (runtimeSort.direction === 'asc' ? '▲' : '▼') : '↕'}</span>
                            </button>
                            <span className="runtime-col-resize-handle" onMouseDown={(event) => beginRuntimeColumnResize('executor', event)} />
                          </div>
                        </th>
                        <th>
                          <div className="runtime-th-wrap">
                            <button type="button" className={`runtime-sort-btn ${runtimeSort.key === 'status' ? 'active' : ''}`} onClick={() => toggleRuntimeSort('status')}>
                              状态
                              <span className="runtime-sort-indicator">{runtimeSort.key === 'status' ? (runtimeSort.direction === 'asc' ? '▲' : '▼') : '↕'}</span>
                            </button>
                            <span className="runtime-col-resize-handle" onMouseDown={(event) => beginRuntimeColumnResize('status', event)} />
                          </div>
                        </th>
                        <th>
                          <div className="runtime-th-wrap">
                            <button type="button" className={`runtime-sort-btn ${runtimeSort.key === 'risk' ? 'active' : ''}`} onClick={() => toggleRuntimeSort('risk')}>
                              风险摘要
                              <span className="runtime-sort-indicator">{runtimeSort.key === 'risk' ? (runtimeSort.direction === 'asc' ? '▲' : '▼') : '↕'}</span>
                            </button>
                            <span className="runtime-col-resize-handle" onMouseDown={(event) => beginRuntimeColumnResize('risk', event)} />
                          </div>
                        </th>
                        <th>
                          <div className="runtime-th-wrap">
                            <button type="button" className={`runtime-sort-btn ${runtimeSort.key === 'last_active' ? 'active' : ''}`} onClick={() => toggleRuntimeSort('last_active')}>
                              最近活跃
                              <span className="runtime-sort-indicator">{runtimeSort.key === 'last_active' ? (runtimeSort.direction === 'asc' ? '▲' : '▼') : '↕'}</span>
                            </button>
                            <span className="runtime-col-resize-handle" onMouseDown={(event) => beginRuntimeColumnResize('last_active', event)} />
                          </div>
                        </th>
                        <th className="runtime-col-actions">
                          <div className="runtime-th-wrap">
                            <span className="runtime-th-label">操作</span>
                            <span className="runtime-col-resize-handle" onMouseDown={(event) => beginRuntimeColumnResize('actions', event)} />
                          </div>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {runtimeItems.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="empty">
                            {sandboxRegistryLoadingMore ? '正在扩展已加载范围，请稍候...' : '当前筛选条件下没有 Sandbox 记录'}
                          </td>
                        </tr>
                      ) : (
                        runtimeItems.map((item) => (
                          <tr key={item.sandboxId} className={sandboxRuntimeDetail?.runtime.sandboxId === item.sandboxId ? 'selected-row' : undefined}>
                            <td>
                              <div className="runtime-primary-cell">
                                <div className="runtime-id-row">
                                  {item.taskSessionId ? (
                                    <button
                                      type="button"
                                      className="link-btn sandbox-jump-btn mono"
                                      title={item.taskSessionId}
                                      onClick={() => openConversationSessionFromSandbox(item.taskSessionId)}
                                    >
                                      {truncateMiddle(item.taskSessionId, 8, 6)}
                                    </button>
                                  ) : (
                                    <strong title="-">-</strong>
                                  )}
                                  {item.taskSessionId ? (
                                    <button
                                      type="button"
                                      className="copy-btn"
                                      onClick={() => void copyRuntimeField('会话 ID', item.taskSessionId!)}
                                    >
                                      复制
                                    </button>
                                  ) : null}
                                </div>
                                <p className="session-meta">{item.taskTitle || item.taskStatus || '-'}</p>
                              </div>
                            </td>
                            <td>
                              <div className="runtime-primary-cell">
                                <div className="runtime-id-row">
                                  <span className="mono mono-truncate" title={item.sandboxId}>{truncateMiddle(item.sandboxId, 8, 6)}</span>
                                  <button
                                    type="button"
                                    className="copy-btn"
                                    onClick={() => void copyRuntimeField('Sandbox ID', item.sandboxId)}
                                  >
                                    复制
                                  </button>
                                </div>
                                <p className="session-meta" title={item.template || '-'}>{item.template || '-'}</p>
                              </div>
                            </td>
                            <td>
                              <strong>{item.executor}</strong>
                              <p className="session-meta">{item.codexExecutionMode || '-'}</p>
                            </td>
                            <td>
                              <div className="runtime-status-stack">
                                <div className="action-inline">
                                  <span className={stateClassName(item.sandboxState || item.status)}>{item.sandboxState || item.status}</span>
                                  {item.taskStatus ? <span className={stateClassName(item.taskStatus)}>{statusLabel(item.taskStatus)}</span> : null}
                                  {item.status === 'closed' && (item.dedupeReplacementSandboxId || item.dedupeReplacedAt) ? (
                                    <span className="session-status session-status-governance">已收口</span>
                                  ) : null}
                                </div>
                                <p className="session-meta">
                                  归档 {archiveStatusLabel(item.archiveStatus || 'none')}
                                  {item.pendingArchiveUpdate ? ' · 有待同步变更' : ''}
                                </p>
                                {item.status === 'closed' && (item.dedupeReplacementSandboxId || item.dedupeReplacedAt) ? (
                                  <div className="runtime-governance-note">
                                    <p className="session-meta">{sandboxDedupeReasonLabel(item.dedupeReason)}</p>
                                    <p className="session-meta">
                                      {item.dedupeReplacementSandboxId ? (
                                        <>
                                          已由{' '}
                                          <button
                                            type="button"
                                            className="link-btn sandbox-jump-btn"
                                            onClick={() => {
                                              const replacementSandboxId = item.dedupeReplacementSandboxId;
                                              if (!replacementSandboxId) return;
                                              void openSandboxDetail(replacementSandboxId);
                                            }}
                                          >
                                            {sandboxJumpLabel(item.dedupeReplacementSandboxId)}
                                          </button>{' '}
                                          接管
                                        </>
                                      ) : (
                                        '已由同任务的新 Sandbox 接管'
                                      )}
                                      {item.dedupeReplacedAt ? ` · ${formatDateTime(item.dedupeReplacedAt)}` : ''}
                                    </p>
                                  </div>
                                ) : null}
                              </div>
                            </td>
                            <td>
                              {item.riskTags.length === 0 ? (
                                <span className="session-status">正常</span>
                              ) : (
                                <div className="runtime-risk-cell">
                                  <div className="runtime-risk-list">
                                    {item.riskTags.slice(0, 2).map((risk) => (
                                      <span key={risk} className="session-status">{risk}</span>
                                    ))}
                                    {item.riskTags.length > 2 ? <span className="session-status">+{item.riskTags.length - 2}</span> : null}
                                  </div>
                                  <p className="session-meta">{item.riskTags.length} 个风险标签</p>
                                </div>
                              )}
                            </td>
                            <td>
                              <div>{formatDateTime(item.lastActiveAt || item.updatedAt)}</div>
                              <p className="session-meta">{item.lastActiveReason || '-'}</p>
                            </td>
                            <td className="runtime-col-actions">
                              <div className="action-inline runtime-actions">
                                <button type="button" className="table-btn" onClick={() => void openSandboxDetail(item.sandboxId)}>
                                  查看
                                </button>
                                {item.sandboxState === 'running' ? (
                                  <button
                                    type="button"
                                    className="secondary-btn"
                                    disabled={sandboxBusyIds[item.sandboxId]}
                                    onClick={() => void pauseSandbox(item.sandboxId)}
                                  >
                                    暂停
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    className="secondary-btn"
                                    disabled={sandboxBusyIds[item.sandboxId]}
                                    onClick={() => void openSandbox(item.sandboxId)}
                                  >
                                    开机
                                  </button>
                                )}
                                {item.sandboxState === 'running' || item.sandboxState === 'paused' ? (
                                  <button
                                    type="button"
                                    className="secondary-btn"
                                    disabled={sandboxBusyIds[item.sandboxId]}
                                    onClick={() => void closeSandbox(item.sandboxId)}
                                  >
                                    关机
                                  </button>
                                ) : null}
                                <details className="runtime-action-menu">
                                  <summary className="secondary-btn runtime-action-menu-trigger">更多</summary>
                                  <div className="runtime-action-menu-popover">
                                    <button
                                      type="button"
                                      className="table-btn runtime-action-menu-item"
                                      disabled={sandboxBusyIds[item.sandboxId] || !item.taskSessionId}
                                      onClick={(event) => {
                                        closeParentDetails(event.currentTarget);
                                        void restartSandbox(item.sandboxId);
                                      }}
                                    >
                                      重启
                                    </button>
                                    <button
                                      type="button"
                                      className="table-btn runtime-action-menu-item"
                                      disabled={sandboxBusyIds[item.sandboxId]}
                                      onClick={(event) => {
                                        closeParentDetails(event.currentTarget);
                                        void runSandboxArchive(item.sandboxId);
                                      }}
                                    >
                                      归档
                                    </button>
                                  </div>
                                </details>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                      {Array.from({ length: runtimeSkeletonRowCount }, (_, index) => (
                        <tr key={`runtime-loading-${index}`} className="runtime-loading-row" aria-hidden="true">
                          <td><span className="runtime-skeleton runtime-skeleton-text" /></td>
                          <td><span className="runtime-skeleton runtime-skeleton-text" /></td>
                          <td><span className="runtime-skeleton runtime-skeleton-chip" /></td>
                          <td><span className="runtime-skeleton runtime-skeleton-chip" /></td>
                          <td><span className="runtime-skeleton runtime-skeleton-text" /></td>
                          <td><span className="runtime-skeleton runtime-skeleton-text" /></td>
                          <td><span className="runtime-skeleton runtime-skeleton-button" /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {canLoadMoreRuntime ? (
                  <div className="runtime-load-more">
                    <button
                      type="button"
                      className={`secondary-btn runtime-load-more-btn ${sandboxRegistryLoadingMore ? 'is-loading' : ''}`}
                      disabled={sandboxRegistryLoadingMore || refreshing}
                      onClick={() => void loadMoreSandboxRuntime()}
                      aria-busy={sandboxRegistryLoadingMore}
                    >
                      {sandboxRegistryLoadingMore ? (
                        <>
                          <span className="runtime-load-spinner" aria-hidden="true" />
                          正在加载更多...
                        </>
                      ) : (
                        `查看更多 Sandbox（+${SANDBOX_RUNTIME_LOAD_MORE_STEP}）`
                      )}
                    </button>
                    <p className="session-meta runtime-load-feedback" aria-live="polite">
                      {sandboxRegistryLoadingMore
                        ? `当前正在请求第 ${loadMoreRangeStart}-${loadMoreRangeEnd} 条 Sandbox 记录，已加载内容保持可见。`
                        : `当前已加载 ${loadedRuntimeCount} 条 Sandbox 记录，筛选后剩余 ${runtimeItems.length} 条。`}
                    </p>
                    {sandboxRegistryLoadMoreError ? <p className="runtime-load-error" role="status">加载更多失败，请重试。{sandboxRegistryLoadMoreError}</p> : null}
                  </div>
                ) : null}
              </article>

            </section>
          ) : null}

          {sandboxTab === 'templates' ? (
            <>
              <section className="kpi-grid fade-in">
                <article className="kpi-card">
                  <p className="kpi-title">模板总数</p>
                  <p className="kpi-value">{templates.length}</p>
                  <p className="kpi-meta">来自 E2B</p>
                </article>
                <article className="kpi-card">
                  <p className="kpi-title">别名检测</p>
                  <p className="kpi-value">{templateAliasQuery || '-'}</p>
                  <p className="kpi-meta">输入别名后检测</p>
                </article>
              </section>

              <section className="panel fade-in">
                <div className="panel-header">
                  <h2>模板列表</h2>
                  <span className="panel-caption">模板列表</span>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>模板 ID</th>
                        <th>别名/名称</th>
                        <th>状态</th>
                        <th>更新时间</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {templates.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="empty">
                            暂无模板记录
                          </td>
                        </tr>
                      ) : (
                        templates.map((item, idx) => {
                          const templateId = (item as any).templateID ?? (item as any).templateId ?? `template-${idx}`;
                          const name = item.alias || (item as any).name || '-';
                          return (
                            <tr key={templateId}>
                              <td className="mono">{templateId}</td>
                              <td>{name}</td>
                              <td>{(item as any).status ?? '-'}</td>
                              <td>{formatDateTime((item as any).updatedAt ?? (item as any).createdAt)}</td>
                              <td>
                                <div className="action-inline">
                                  <button type="button" className="table-btn" onClick={() => void openTemplateDetail(templateId)}>
                                    查看
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="panel fade-in">
                <div className="panel-header">
                  <h2>模板动作</h2>
                  <span className="panel-caption">创建、标签和别名检查</span>
                </div>
                <div className="form-stack">
                  <p className="muted">使用 JSON 触发创建/更新/重建/标签等操作。</p>
                  <textarea
                    className="input-area"
                    rows={6}
                    value={templateActionPayload}
                    onChange={(event) => setTemplateActionPayload(event.target.value)}
                  />
                  <div className="button-grid">
                    <button type="button" className="secondary-btn" onClick={() => void runTemplateAction('create')}>
                      创建模板
                    </button>
                    <button type="button" className="secondary-btn" onClick={() => void runTemplateAction('tags-assign')}>
                      分配标签
                    </button>
                    <button type="button" className="secondary-btn" onClick={() => void runTemplateAction('tags-delete')}>
                      删除标签
                    </button>
                  </div>
                  <div className="button-grid">
                    <input
                      className="text-input"
                      placeholder="输入模板别名"
                      value={templateAliasQuery}
                      onChange={(event) => setTemplateAliasQuery(event.target.value)}
                    />
                    <button type="button" className="secondary-btn" onClick={() => void checkAlias()}>
                      检测别名
                    </button>
                  </div>
                  {templateAliasResult ? <pre className="json-block">{toJsonText(templateAliasResult)}</pre> : null}
                </div>
              </section>
            </>
          ) : null}
        </main>

        {sandboxModalOpen && sandboxRuntimeDetail ? (
          <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={closeSandboxDetail}>
            <div
              className="modal-card runtime-inspector-modal"
              onClick={(event) => {
                event.stopPropagation();
              }}
            >
              <div className="modal-header">
                <div>
                  <p className="section-tag">Sandbox 信息</p>
                  <h2>Sandbox 详情</h2>
                </div>
                <button type="button" className="secondary-btn" onClick={closeSandboxDetail}>
                  关闭
                </button>
              </div>
              <div className="button-grid modal-tab-grid">
                <button
                  type="button"
                  className={`inspector-tab-card ${sandboxDetailTab === 'overview' ? 'active' : ''}`}
                  onClick={() => setSandboxDetailTab('overview')}
                >
                  <span className="inspector-tab-card-key mono">01</span>
                  <span className="inspector-tab-card-label">摘要</span>
                </button>
                <button
                  type="button"
                  className={`inspector-tab-card ${sandboxDetailTab === 'connectivity' ? 'active' : ''}`}
                  onClick={() => setSandboxDetailTab('connectivity')}
                >
                  <span className="inspector-tab-card-key mono">02</span>
                  <span className="inspector-tab-card-label">连通性</span>
                </button>
                <button
                  type="button"
                  className={`inspector-tab-card ${sandboxDetailTab === 'archive' ? 'active' : ''}`}
                  onClick={() => setSandboxDetailTab('archive')}
                >
                  <span className="inspector-tab-card-key mono">03</span>
                  <span className="inspector-tab-card-label">归档</span>
                </button>
                <button
                  type="button"
                  className={`inspector-tab-card ${sandboxDetailTab === 'advanced' ? 'active' : ''}`}
                  onClick={() => setSandboxDetailTab('advanced')}
                >
                  <span className="inspector-tab-card-key mono">04</span>
                  <span className="inspector-tab-card-label">高级调试</span>
                </button>
              </div>

              <div className="modal-body">
              {sandboxDetailTab === 'overview' ? (
                <div className="inspector-page-stack">
                  <section className="inspector-stat-grid">
                    <article className="inspector-stat-card">
                      <span className="inspector-stat-label">运行状态</span>
                      <strong>{sandboxRuntimeDetail.runtime.sandboxState || sandboxRuntimeDetail.runtime.status}</strong>
                    </article>
                    <article className="inspector-stat-card">
                      <span className="inspector-stat-label">会话状态</span>
                      <strong>{sandboxRuntimeDetail.taskSession ? statusLabel(sandboxRuntimeDetail.taskSession.status) : '-'}</strong>
                      {sandboxRuntimeDetail.runtime.taskSessionId ? (
                        <button
                          type="button"
                          className="link-btn sandbox-jump-btn session-meta mono"
                          onClick={() => openConversationSessionFromSandbox(sandboxRuntimeDetail.runtime.taskSessionId)}
                        >
                          {sandboxRuntimeDetail.runtime.taskSessionId}
                        </button>
                      ) : (
                        <span className="session-meta">未绑定会话</span>
                      )}
                    </article>
                    <article className="inspector-stat-card">
                      <span className="inspector-stat-label">最近活跃</span>
                      <strong>{formatDateTime(sandboxRuntimeDetail.runtime.lastActiveAt)}</strong>
                      <span className="session-meta">{sandboxRuntimeDetail.runtime.lastActiveReason || '-'}</span>
                    </article>
                  </section>

                  <section className="inspector-overview-bottom-grid">
                    <article className="inspector-card inspector-card-large">
                      <div className="inspector-card-header">
                        <h3>Sandbox 基础信息</h3>
                        <span className="session-status">{sandboxRuntimeDetail.runtime.executor}</span>
                      </div>
                      <div className="inspector-kv-grid">
                        <div><span>Sandbox 标识</span><strong className="mono">{sandboxRuntimeDetail.runtime.sandboxId}</strong></div>
                        <div><span>执行器</span><strong>{sandboxRuntimeDetail.runtime.executor}</strong></div>
                        <div><span>模板</span><strong className="mono">{sandboxRuntimeDetail.runtime.template || '-'}</strong></div>
                        <div><span>会话标题</span><strong>{sandboxRuntimeDetail.taskSession?.title || sandboxRuntimeDetail.runtime.taskTitle || '-'}</strong></div>
                      </div>
                    </article>
                    <article className="inspector-card inspector-overview-actions-card">
                      <div className="inspector-card-header">
                        <h3>机器动作</h3>
                        <span className="panel-caption">开机/关机/重启/归档</span>
                      </div>
                      <div className="inspector-action-grid">
                        <button
                          type="button"
                          className="primary-btn"
                          disabled={sandboxBusyIds[sandboxRuntimeDetail.runtime.sandboxId]}
                          onClick={() => void openSandbox(sandboxRuntimeDetail.runtime.sandboxId)}
                        >
                          开机
                        </button>
                        <button
                          type="button"
                          className="secondary-btn"
                          disabled={sandboxBusyIds[sandboxRuntimeDetail.runtime.sandboxId]}
                          onClick={() => void closeSandbox(sandboxRuntimeDetail.runtime.sandboxId)}
                        >
                          关机
                        </button>
                        <button
                          type="button"
                          className="secondary-btn"
                          disabled={sandboxBusyIds[sandboxRuntimeDetail.runtime.sandboxId]}
                          onClick={() => void restartSandbox(sandboxRuntimeDetail.runtime.sandboxId)}
                        >
                          重启
                        </button>
                        <button
                          type="button"
                          className="secondary-btn"
                          disabled={sandboxBusyIds[sandboxRuntimeDetail.runtime.sandboxId]}
                          onClick={() => void runSandboxArchive(sandboxRuntimeDetail.runtime.sandboxId)}
                        >
                          归档
                        </button>
                      </div>
                    </article>
                  </section>
                </div>
              ) : null}

              {sandboxDetailTab === 'connectivity' ? (
                <div className="inspector-page-stack">
                  <article className="inspector-card">
                    <div className="inspector-card-header">
                      <h3>配置端点映射</h3>
                      <button type="button" className="primary-btn" onClick={() => void runSandboxConnectivityCheck(sandboxRuntimeDetail.runtime.sandboxId)}>
                        执行连通性检查
                      </button>
                    </div>
                    <div className="inspector-endpoint-list">
                      {[
                        {
                          label: 'osacEndpoint',
                          value: sandboxRuntimeDetail.runtime.osacEndpoint || '-',
                          status: sandboxRuntimeDetail.connectivity.osacConfigured ? 'ok' : 'missing',
                          statusText: sandboxRuntimeDetail.connectivity.osacConfigured ? '正常' : '缺失',
                        },
                        {
                          label: 'opencodeBaseUrl',
                          value: sandboxRuntimeDetail.runtime.opencodeBaseUrl || '-',
                          status: sandboxRuntimeDetail.connectivity.opencodeConfigured ? 'ok' : 'missing',
                          statusText: sandboxRuntimeDetail.connectivity.opencodeConfigured ? '正常' : '缺失',
                        },
                        {
                          label: 'workspaceRoot',
                          value: sandboxRuntimeDetail.connectivity.workspaceRoot || '-',
                        },
                        {
                          label: 'stateRoot',
                          value: sandboxRuntimeDetail.connectivity.stateRoot || '-',
                        },
                      ].map((row) => (
                        <div key={row.label} className="inspector-endpoint-row">
                          <div className="inspector-endpoint-label">
                            <span className="mono">{row.label}</span>
                          </div>
                          <div className="inspector-endpoint-value">
                            <code>{row.value}</code>
                            {row.status ? (
                              <span
                                className={`inspector-endpoint-inline-status is-${row.status}`}
                                title={`连通性${row.statusText}`}
                                aria-label={`连通性${row.statusText}`}
                              >
                                <span className="inspector-endpoint-dot" aria-hidden="true" />
                                <span>{row.statusText}</span>
                              </span>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  </article>

                  <article className="inspector-log-shell">
                    <div className="inspector-card-header">
                      <h3>检查结果日志</h3>
                    </div>
                    <pre className="inspector-log-body">{toJsonText(
                      sandboxConnectivityResult || {
                        osacEndpoint: sandboxRuntimeDetail.runtime.osacEndpoint,
                        opencodeBaseUrl: sandboxRuntimeDetail.runtime.opencodeBaseUrl,
                        workspaceRoot: sandboxRuntimeDetail.connectivity.workspaceRoot,
                        stateRoot: sandboxRuntimeDetail.connectivity.stateRoot,
                      }
                    )}</pre>
                  </article>
                </div>
              ) : null}

              {sandboxDetailTab === 'archive' ? (
                <div className="inspector-page-stack">
                  <article className="inspector-card">
                    <div className="inspector-card-header">
                      <h3>当前快照</h3>
                      <div className="action-inline runtime-actions">
                        <button
                          type="button"
                          className="primary-btn"
                          disabled={sandboxBusyIds[sandboxRuntimeDetail.runtime.sandboxId]}
                          onClick={() => void runSandboxArchive(sandboxRuntimeDetail.runtime.sandboxId)}
                        >
                          手动归档
                        </button>
                      </div>
                    </div>
                    {currentArchiveRow ? (
                      <div className="inspector-governance-list">
                        <article className="inspector-governance-event">
                          <div className="inspector-governance-head">
                            <span className="session-meta">{formatDateTime(currentArchiveRow.timestamp)}</span>
                          </div>
                          <div className="action-inline">
                            <span className="session-status">归档事件</span>
                            <span className={stateClassName(currentArchiveRow.status)}>{archiveStatusLabel(currentArchiveRow.status)}</span>
                          </div>
                          <p className="session-meta">{currentArchiveRow.reason} · {currentArchiveRow.size}</p>
                          <p className="session-meta mono">{currentArchiveRow.hash}</p>
                        </article>
                      </div>
                    ) : (
                      <p className="empty">当前没有归档记录。</p>
                    )}
                  </article>

                  <article className="inspector-card">
                    <div className="inspector-card-header">
                      <h3>历史快照</h3>
                    </div>
                    <div className="table-wrap">
                      <table className="runtime-table archive-snapshot-table">
                        <colgroup>
                          <col style={{ width: `${archiveColumnWidths.time}px` }} />
                          <col style={{ width: `${archiveColumnWidths.type}px` }} />
                          <col style={{ width: `${archiveColumnWidths.size}px` }} />
                          <col style={{ width: `${archiveColumnWidths.reason}px` }} />
                          <col style={{ width: `${archiveColumnWidths.status}px` }} />
                          <col style={{ width: `${archiveColumnWidths.actions}px` }} />
                        </colgroup>
                        <thead>
                          <tr>
                            <th>
                              <div className="runtime-th-wrap">
                                <button type="button" className={`runtime-sort-btn ${archiveSort.key === 'time' ? 'active' : ''}`} onClick={() => toggleArchiveSort('time')}>
                                  时间
                                  <span className="runtime-sort-indicator">{archiveSort.key === 'time' ? (archiveSort.direction === 'asc' ? '▲' : '▼') : '↕'}</span>
                                </button>
                                <span className="runtime-col-resize-handle" onMouseDown={(event) => beginArchiveColumnResize('time', event)} />
                              </div>
                            </th>
                            <th>
                              <div className="runtime-th-wrap">
                                <button type="button" className={`runtime-sort-btn ${archiveSort.key === 'type' ? 'active' : ''}`} onClick={() => toggleArchiveSort('type')}>
                                  类型
                                  <span className="runtime-sort-indicator">{archiveSort.key === 'type' ? (archiveSort.direction === 'asc' ? '▲' : '▼') : '↕'}</span>
                                </button>
                                <span className="runtime-col-resize-handle" onMouseDown={(event) => beginArchiveColumnResize('type', event)} />
                              </div>
                            </th>
                            <th>
                              <div className="runtime-th-wrap">
                                <button type="button" className={`runtime-sort-btn ${archiveSort.key === 'size' ? 'active' : ''}`} onClick={() => toggleArchiveSort('size')}>
                                  大小
                                  <span className="runtime-sort-indicator">{archiveSort.key === 'size' ? (archiveSort.direction === 'asc' ? '▲' : '▼') : '↕'}</span>
                                </button>
                                <span className="runtime-col-resize-handle" onMouseDown={(event) => beginArchiveColumnResize('size', event)} />
                              </div>
                            </th>
                            <th>
                              <div className="runtime-th-wrap">
                                <button type="button" className={`runtime-sort-btn ${archiveSort.key === 'reason' ? 'active' : ''}`} onClick={() => toggleArchiveSort('reason')}>
                                  原因
                                  <span className="runtime-sort-indicator">{archiveSort.key === 'reason' ? (archiveSort.direction === 'asc' ? '▲' : '▼') : '↕'}</span>
                                </button>
                                <span className="runtime-col-resize-handle" onMouseDown={(event) => beginArchiveColumnResize('reason', event)} />
                              </div>
                            </th>
                            <th>
                              <div className="runtime-th-wrap">
                                <button type="button" className={`runtime-sort-btn ${archiveSort.key === 'status' ? 'active' : ''}`} onClick={() => toggleArchiveSort('status')}>
                                  状态
                                  <span className="runtime-sort-indicator">{archiveSort.key === 'status' ? (archiveSort.direction === 'asc' ? '▲' : '▼') : '↕'}</span>
                                </button>
                                <span className="runtime-col-resize-handle" onMouseDown={(event) => beginArchiveColumnResize('status', event)} />
                              </div>
                            </th>
                            <th>
                              <div className="runtime-th-wrap">
                                <span className="runtime-th-label">操作</span>
                                <span className="runtime-col-resize-handle" onMouseDown={(event) => beginArchiveColumnResize('actions', event)} />
                              </div>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {archiveSortedRows.map((row) => (
                            <tr key={`${row.id}-${row.hash}`}>
                              <td>{formatDateTime(row.timestamp)}</td>
                              <td><span className="session-status">{row.type}</span></td>
                              <td>{row.size}</td>
                              <td>{row.reason}</td>
                              <td><span className={stateClassName(row.status)}>{row.status}</span></td>
                              <td>
                                <div className="runtime-actions">
                                  <button
                                    type="button"
                                    className="secondary-btn snapshot-action-download"
                                    disabled={sandboxBusyIds[sandboxRuntimeDetail.runtime.sandboxId] || !row.snapshotKey}
                                    onClick={() =>
                                      row.snapshotKey
                                        ? void downloadSandboxSnapshot(sandboxRuntimeDetail.runtime.sandboxId, row.snapshotKey)
                                        : undefined
                                    }
                                  >
                                    下载
                                  </button>
                                  <button
                                    type="button"
                                    className="secondary-btn snapshot-action-restore"
                                    disabled={sandboxBusyIds[sandboxRuntimeDetail.runtime.sandboxId] || !row.snapshotKey}
                                    onClick={() =>
                                      row.snapshotKey
                                        ? void runSandboxRestore(sandboxRuntimeDetail.runtime.sandboxId, row.snapshotKey)
                                        : undefined
                                    }
                                  >
                                    恢复
                                  </button>
                                  <button
                                    type="button"
                                    className="secondary-btn"
                                    onClick={() =>
                                      setArchiveDetailRow({
                                        id: row.id,
                                        snapshotKey: row.snapshotKey ?? null,
                                        timestamp: row.timestamp ?? null,
                                        type: row.type,
                                        size: row.size,
                                        hash: row.hash,
                                        status: row.status,
                                        reason: row.reason,
                                      })
                                    }
                                  >
                                    详情
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </article>

                  <article className="inspector-card">
                    <div className="inspector-card-header">
                      <h3>归档元数据</h3>
                    </div>
                    <pre className="json-block debug-output-block">{toJsonText(sandboxRuntimeDetail.archive)}</pre>
                  </article>

                  {archiveDetailRow ? (
                    <div className="archive-detail-popup-backdrop" role="dialog" aria-modal="true" onClick={() => setArchiveDetailRow(null)}>
                      <div
                        className="archive-detail-popup-card"
                        onClick={(event) => {
                          event.stopPropagation();
                        }}
                      >
                        <div className="archive-detail-popup-head">
                          <div>
                            <h3>快照详情</h3>
                            <p className="panel-caption">完整标识与校验信息</p>
                          </div>
                          <div className="action-inline">
                            <span className={stateClassName(archiveDetailRow.status)}>{archiveStatusLabel(archiveDetailRow.status)}</span>
                            <button type="button" className="secondary-btn" onClick={() => setArchiveDetailRow(null)}>
                              关闭
                            </button>
                          </div>
                        </div>
                        <div className="archive-detail-popup-body">
                          <div className="archive-detail-facts">
                            <article className="archive-detail-fact">
                              <span>时间</span>
                              <strong>{formatDateTime(archiveDetailRow.timestamp)}</strong>
                            </article>
                            <article className="archive-detail-fact">
                              <span>类型</span>
                              <strong>{archiveDetailRow.type}</strong>
                            </article>
                            <article className="archive-detail-fact">
                              <span>大小</span>
                              <strong>{archiveDetailRow.size}</strong>
                            </article>
                            <article className="archive-detail-fact">
                              <span>原因</span>
                              <strong>{archiveDetailRow.reason}</strong>
                            </article>
                          </div>
                          <article className="archive-detail-code-card">
                            <span>快照标识</span>
                            <code className="mono">{archiveDetailRow.id}</code>
                          </article>
                          <article className="archive-detail-code-card">
                            <span>哈希</span>
                            <code className="mono">{archiveDetailRow.hash}</code>
                          </article>
                        </div>
                        <div className="archive-detail-popup-actions action-inline runtime-actions">
                          <button
                            type="button"
                            className="secondary-btn snapshot-action-download"
                            disabled={sandboxBusyIds[sandboxRuntimeDetail.runtime.sandboxId] || !archiveDetailRow.snapshotKey}
                            onClick={() =>
                              archiveDetailRow.snapshotKey
                                ? void downloadSandboxSnapshot(sandboxRuntimeDetail.runtime.sandboxId, archiveDetailRow.snapshotKey)
                                : undefined
                            }
                          >
                            下载
                          </button>
                          <button
                            type="button"
                            className="secondary-btn snapshot-action-restore"
                            disabled={sandboxBusyIds[sandboxRuntimeDetail.runtime.sandboxId] || !archiveDetailRow.snapshotKey}
                            onClick={() =>
                              archiveDetailRow.snapshotKey
                                ? void runSandboxRestore(sandboxRuntimeDetail.runtime.sandboxId, archiveDetailRow.snapshotKey)
                                : undefined
                            }
                          >
                            恢复
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {sandboxDetailTab === 'advanced' ? (
                <div className="inspector-page-stack debug-console">
                  <article className="inspector-log-shell terminal-console">
                    <div className="inspector-card-header">
                      <div>
                        <h2>Runtime Terminal</h2>
                        <span className="panel-caption">命令执行与回显统一在终端中处理</span>
                      </div>
                    </div>
                    <pre className="inspector-log-body terminal-body">
                      {sandboxTerminalOutput || '# Runtime terminal ready\n# run a command from the input below'}
                    </pre>
                    <div className="terminal-input-row">
                      <span className="terminal-prompt mono">$</span>
                      <input
                        className="text-input terminal-input"
                        value={sandboxCommandInput}
                        onChange={(event) => setSandboxCommandInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            void runSandboxCommand();
                          }
                        }}
                        placeholder="输入 shell 命令，例如: pwd && ls -la"
                      />
                      <button type="button" className="primary-btn" onClick={() => void runSandboxCommand()}>
                        Send
                      </button>
                    </div>
                  </article>

                  <section className="debug-tool-grid advanced-tool-grid">
                    <article className="inspector-card debug-tool-card file-manager-card">
                      <div className="inspector-card-header">
                        <div>
                          <h2>File Manager</h2>
                          <span className="panel-caption">目录菜单 + 文件编辑器</span>
                        </div>
                      </div>
                      <div className="file-manager-layout">
                        <aside className="file-manager-menu">
                          <div className="button-grid-three file-manager-actions">
                            <button type="button" className="secondary-btn" onClick={() => void listSandboxFiles()}>
                              刷新目录
                            </button>
                            <button type="button" className="secondary-btn" onClick={() => void readSandboxFile()}>
                              读取文件
                            </button>
                            <button type="button" className="primary-btn" onClick={() => void writeSandboxFile()}>
                              保存文件
                            </button>
                          </div>
                          <div className="file-manager-list">
                            {sandboxFileItems.length ? (
                              sandboxFileItems.map((item) => (
                                <button
                                  key={item.path}
                                  type="button"
                                  className={`file-entry-btn ${sandboxFilePath === item.path ? 'active' : ''}`}
                                  onClick={() => setSandboxFilePath(item.path)}
                                >
                                  <span className="mono">{item.kind === 'dir' ? 'DIR' : 'FILE'}</span>
                                  <span>{item.label}</span>
                                </button>
                              ))
                            ) : (
                              <p className="empty">暂无目录项，请先执行“刷新目录”。</p>
                            )}
                          </div>
                        </aside>
                        <div className="file-manager-editor">
                          <input
                            className="text-input"
                            value={sandboxFilePath}
                            onChange={(event) => setSandboxFilePath(event.target.value)}
                            placeholder="/workspace/app/index.ts"
                          />
                          <textarea
                            className="input-area"
                            rows={11}
                            value={sandboxFileContent}
                            onChange={(event) => setSandboxFileContent(event.target.value)}
                            placeholder="文件内容"
                          />
                        </div>
                      </div>
                    </article>

                    <article className="inspector-card debug-tool-card">
                      <div className="inspector-card-header">
                        <div>
                          <h2>进程</h2>
                          <span className="panel-caption">查看并结束指定 PID</span>
                        </div>
                      </div>
                      <div className="debug-inline-grid">
                        <button type="button" className="secondary-btn" onClick={() => void loadSandboxProcesses()}>
                          刷新列表
                        </button>
                        <input
                          className="text-input"
                          value={sandboxPidInput}
                          onChange={(event) => setSandboxPidInput(event.target.value)}
                          placeholder="PID"
                        />
                        <button type="button" className="primary-btn" onClick={() => void killSandboxProcess()}>
                          结束
                        </button>
                      </div>
                      <pre className="json-block debug-output-block">
                        {toJsonText(sandboxProcessResult || { tip: '进程列表和 kill 结果在这里展示' })}
                      </pre>
                    </article>

                    <article className="inspector-card debug-tool-card">
                      <div className="inspector-card-header">
                        <div>
                          <h2>端口</h2>
                          <span className="panel-caption">监听情况与 Host 映射</span>
                        </div>
                      </div>
                      <div className="debug-inline-grid">
                        <button type="button" className="secondary-btn" onClick={() => void inspectSandboxPorts()}>
                          查看监听
                        </button>
                        <input
                          className="text-input"
                          value={sandboxPortInput}
                          onChange={(event) => setSandboxPortInput(event.target.value)}
                          placeholder="3000"
                        />
                        <button type="button" className="primary-btn" onClick={() => void resolveSandboxHost()}>
                          查询映射
                        </button>
                      </div>
                        <pre className="json-block debug-output-block">
                          {toJsonText(sandboxPortResult || { tip: '端口扫描和 host 映射结果在这里展示' })}
                        </pre>
                    </article>
                  </section>

                  <details className="debug-disclosure">
                    <summary>原始工具动作</summary>
                    <div className="debug-disclosure-body">
                      <div className="debug-raw-grid">
                        <select
                          className="text-input"
                          value={sandboxToolAction}
                          onChange={(event) => setSandboxToolAction(event.target.value)}
                        >
                          {[
                            'command.list',
                            'command.run',
                            'command.kill',
                            'command.stdin',
                            'files.list',
                            'files.read',
                            'files.write',
                            'files.writeFiles',
                            'files.remove',
                            'files.mkdir',
                            'files.rename',
                            'files.exists',
                            'files.info',
                            'git.status',
                            'git.branches',
                            'git.clone',
                            'git.init',
                            'git.remoteAdd',
                            'git.remoteGet',
                            'git.createBranch',
                            'git.checkoutBranch',
                            'git.deleteBranch',
                            'git.add',
                            'git.commit',
                            'git.reset',
                            'git.restore',
                            'git.pull',
                            'git.push',
                            'git.setConfig',
                            'git.getConfig',
                            'git.configureUser',
                            'git.dangerouslyAuthenticate',
                            'sandbox.host',
                            'sandbox.uploadUrl',
                            'sandbox.downloadUrl',
                          ].map((name) => (
                            <option key={name} value={name}>
                              {name}
                            </option>
                          ))}
                        </select>
                        <textarea
                          className="input-area"
                          rows={5}
                          value={sandboxToolPayload}
                          onChange={(event) => setSandboxToolPayload(event.target.value)}
                        />
                      </div>
                      <div className="action-inline">
                        <button type="button" className="primary-btn" onClick={() => void runSandboxTool()}>
                          执行工具动作
                        </button>
                      </div>
                      <pre className="json-block debug-output-block">
                        {toJsonText(sandboxToolResult || { tip: '原始 tool action 返回会显示在这里' })}
                      </pre>
                    </div>
                  </details>

                  <details className="debug-disclosure">
                    <summary>Runtime Metadata</summary>
                    <div className="debug-disclosure-body debug-meta-grid">
                      <pre className="json-block debug-output-block">{toJsonText(sandboxRuntimeDetail.metadata)}</pre>
                      {sandboxFullInfo ? <pre className="json-block debug-output-block">{toJsonText(sandboxFullInfo)}</pre> : null}
                    </div>
                  </details>
                </div>
              ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {templateModalOpen && templateDetail ? (
          <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={closeTemplateDetail}>
            <div
              className="modal-card"
              onClick={(event) => {
                event.stopPropagation();
              }}
            >
              <div className="modal-header">
                <div>
                  <p className="section-tag">模板详情</p>
                  <h2>模板详情</h2>
                </div>
                <button type="button" className="secondary-btn" onClick={closeTemplateDetail}>
                  关闭
                </button>
              </div>
              <div className="detail-grid modal-grid">
                <article className="sub-panel">
                  <p className="kpi-title">模板信息</p>
                  <pre className="json-block">{toJsonText(templateDetail)}</pre>
                </article>
                <article className="sub-panel">
                  <p className="kpi-title">操作</p>
                  <textarea
                    className="input-area"
                    rows={4}
                    value={templateActionPayload}
                    onChange={(event) => setTemplateActionPayload(event.target.value)}
                  />
                  <div className="button-grid">
                    <button type="button" className="secondary-btn" onClick={() => void runTemplateAction('update')}>
                      更新模板
                    </button>
                    <button type="button" className="secondary-btn" onClick={() => void runTemplateAction('rebuild')}>
                      重建模板
                    </button>
                    <button type="button" className="table-btn danger" onClick={() => void runTemplateAction('delete')}>
                      删除模板
                    </button>
                  </div>
                </article>
              </div>
              {(templateDetail as any)?.builds ? (
                <div className="panel">
                  <div className="panel-header">
                    <h2>Builds</h2>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Build ID</th>
                          <th>状态</th>
                          <th>创建时间</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(templateDetail as any).builds.map((build: any) => (
                          <tr key={build.buildID || build.buildId}>
                            <td className="mono">{build.buildID || build.buildId}</td>
                            <td>{build.status || '-'}</td>
                            <td>{formatDateTime(build.createdAt || build.startedAt)}</td>
                            <td>
                              <div className="action-inline">
                                <button
                                  type="button"
                                  className="table-btn"
                                  onClick={() =>
                                    void loadTemplateBuildLogs(
                                      (templateDetail as any).templateID ?? (templateDetail as any).templateId ?? '',
                                      build.buildID || build.buildId
                                    )
                                  }
                                >
                                  日志
                                </button>
                                <button
                                  type="button"
                                  className="table-btn"
                                  onClick={() =>
                                    void loadTemplateBuildStatus(
                                      (templateDetail as any).templateID ?? (templateDetail as any).templateId ?? '',
                                      build.buildID || build.buildId
                                    )
                                  }
                                >
                                  状态
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {templateBuildLogs ? <pre className="json-block">{toJsonText(templateBuildLogs)}</pre> : null}
                  {templateBuildStatus ? <pre className="json-block">{toJsonText(templateBuildStatus)}</pre> : null}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
        {sandboxCreateDrawerOpen ? (
          <div
            className="modal-backdrop drawer-backdrop"
            onClick={() => setSandboxCreateDrawerOpen(false)}
            role="presentation"
          >
            <aside
              className="runtime-create-drawer"
              onClick={(event) => event.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="runtime-create-drawer-title"
            >
              <div className="drawer-header">
                <div>
                  <p className="section-tag">创建 Sandbox</p>
                  <h2 id="runtime-create-drawer-title">手工创建 Sandbox</h2>
                <p className="panel-caption">低频调试动作放在抽屉中。</p>
                </div>
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => setSandboxCreateDrawerOpen(false)}
                >
                  关闭
                </button>
              </div>
              <div className="drawer-body">
                <p className="muted">通过 E2B create / betaCreate 建立调试环境，仅填写必要字段。</p>
                <textarea
                  className="input-area"
                  rows={12}
                  value={sandboxCreatePayload}
                  onChange={(event) => setSandboxCreatePayload(event.target.value)}
                />
              </div>
              <div className="drawer-actions">
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => setSandboxCreateDrawerOpen(false)}
                >
                  取消
                </button>
                <button type="button" className="primary-btn" onClick={() => void createSandbox()}>
                  创建 Sandbox
                </button>
              </div>
            </aside>
          </div>
        ) : null}
      </>
    );
  };
const renderAuditSection = () => (
    <main className="content-stack">
      <section className="page-intro-grid fade-in">
        <article className="panel hero-panel">
          <div className="panel-header panel-header-stack">
            <div>
              <p className="section-tag">审计摘要</p>
              <h2>最近管理动作</h2>
            </div>
            <span className="service-state ok">按时间倒序展示</span>
          </div>
          <div className="hero-metrics">
            <div>
              <span className="hero-metric-label">日志总数</span>
              <strong>{auditSummary.total}</strong>
            </div>
            <div>
              <span className="hero-metric-label">成功</span>
              <strong>{auditSummary.success}</strong>
            </div>
            <div>
              <span className="hero-metric-label">失败</span>
              <strong>{auditSummary.failed}</strong>
            </div>
          </div>
        </article>

        <article className="panel aside-panel">
          <div className="panel-header panel-header-stack">
            <div>
              <p className="section-tag">状态摘要</p>
              <h2>失败记录</h2>
            </div>
          </div>
          <ul className="signal-list">
            <li>最新失败记录</li>
            <li>连续重试操作</li>
          </ul>
        </article>
      </section>

      <section className="panel fade-in">
        <div className="panel-header">
          <h2>审计日志</h2>
          <span className="panel-caption">最近 {auditEntries.length} 条</span>
        </div>
        <div className="audit-list">
          {auditEntries.length === 0 ? (
            <p className="empty">暂无审计日志。</p>
          ) : (
            auditEntries.map((entry) => (
              <article key={entry.id} className="audit-item">
                <p className="audit-headline">
                  <strong>{entry.action.toUpperCase()}</strong> {entry.targetVmId}{' '}
                  <span className={resultClassName(entry.result)}>{entry.result}</span>
                </p>
                <p className="mono">
                  {entry.operator} | {formatDateTime(entry.timestamp)}
                </p>
                {entry.detail ? <p className="audit-detail">{entry.detail}</p> : null}
              </article>
            ))
          )}
        </div>
      </section>
    </main>
  );

  const renderContent = () => {
    if (loading) {
      return <main className="loading-state">正在加载 {breadcrumbTitle} ...</main>;
    }

    if (activeSection === 'kvm') return renderKvmSection();
    if (activeSection === 'conversation') return renderConversationOpsSection();
    if (activeSection === 'agent') return renderAgentSection();
    if (activeSection === 'skill') return <SkillManagementSection onError={setError} />;
    if (activeSection === 'connectorGuide') return <ConnectorGuideManagementSection onError={setError} />;
    if (activeSection === 'osacRelease') return <OsacReleaseManagementSection onError={setError} />;
    if (activeSection === 'sandbox') return renderSandboxSection();
    return renderAuditSection();
  };

  return (
    <div className="page-shell">
      <div className="background-glow" aria-hidden="true" />
      <div className="app-layout">
        <aside className="sidebar fade-in">
          <div className="sidebar-brand">
            <div className="sidebar-brand-row">
              <div>
                <p className="eyebrow">ONECEO Control Rail</p>
                <p className="sidebar-title">管理控制台</p>
              </div>
              <span className="env-badge">OPS</span>
            </div>
            <p className="sidebar-copy">按运行模块和平台配置分组展示后台模块。</p>
          </div>
          <nav className="sidebar-nav" aria-label="Primary">
            {NAV_GROUPS.map((group) => (
              <section key={group.key} className="nav-group">
                <div className="nav-group-header">
                  <p className="nav-group-title">{group.label}</p>
                  <p className="nav-group-copy">{group.description}</p>
                </div>
                <div className="nav-group-list">
                  {NAV_ITEMS.filter((item) => item.group === group.key).map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      className={`nav-item ${activeSection === item.key ? 'active' : ''}`}
                      onClick={() => setActiveSection(item.key)}
                    >
                      <span className="nav-item-tag">{item.tag}</span>
                      <span className="nav-item-body">
                        <span>{item.label}</span>
                        <small>{item.subtitle}</small>
                        <em>{item.signal}</em>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </nav>
          <div className="sidebar-footer">
            <p className="sidebar-footer-title">{adminDisplayNameLabel(adminUser?.displayName, adminUser?.loginName)}</p>
            <p className="sidebar-footer-copy">{adminRoleLabel(adminUser?.role)}</p>
          </div>
        </aside>

        <section className="main-area">
          <header className="top-header fade-in">
            <div className="top-header-bar">
              <div className="top-header-meta">
                <span className="topbar-pill">{activeNavGroup.label}</span>
                <span className="updated-at">最后更新: {formatDateTime(updatedAtLabel)}</span>
              </div>
              <div className="top-header-meta">
                <span className={`service-state ${activeServiceOnline ? 'ok' : 'down'}`}>
                  {activeServiceOnline ? `${activeServiceLabel}在线` : `${activeServiceLabel}离线`}
                </span>
                <span className="updated-at">{adminDisplayNameLabel(adminUser?.displayName, adminUser?.loginName)}</span>
              </div>
            </div>
            <div className="page-header-shell">
              <div className="header-main">
                <p className="eyebrow">
                  {activeNavGroup.label} / {breadcrumbTitle}
                </p>
                <h1>{breadcrumbTitle}</h1>
                <p className="subtitle">{activeNavItem.description}</p>
              </div>
              <div className="header-actions">
                <div className="page-signal-block">
                  <span className="page-signal-label">当前信号</span>
                  <strong>{activeNavItem.signal}</strong>
                </div>
                <button
                  type="button"
                  className="primary-btn"
                  onClick={() => loadSection(activeSection)}
                  disabled={refreshing}
                >
                  {refreshing ? '刷新中...' : '刷新当前标签'}
                </button>
                <button type="button" className="secondary-btn" onClick={() => void handleAdminLogout()}>
                  退出登录
                </button>
              </div>
            </div>
          </header>

          {error ? (
            <section className="error-banner fade-in" role="alert">
              {error}
            </section>
          ) : null}

          {renderContent()}
        </section>
      </div>
    </div>
  );
}
