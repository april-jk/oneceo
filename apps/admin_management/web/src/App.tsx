import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type * as React from 'react';

// 管理后台主页面：统一组装导航、区块切换和会话/主机/技能/发布等能力面板。
import { api } from './api';
import type { AdminUser } from './api';
import {
  DEFAULT_DEPLOYMENT_MANAGEMENT_VIEW_STATE,
  DEFAULT_CONNECTOR_GUIDE_MANAGEMENT_VIEW_STATE,
  DEFAULT_OSAC_RELEASE_MANAGEMENT_VIEW_STATE,
  DEFAULT_SKILL_MANAGEMENT_VIEW_STATE,
  DEFAULT_USER_MANAGEMENT_VIEW_STATE,
} from './components/adminViewState';
import type {
  DeploymentManagementViewState,
  ConnectorGuideManagementViewState,
  OsacReleaseManagementViewState,
  SkillManagementViewState,
  UserManagementViewState,
} from './components/adminViewState';
import type {
  AdminThemeKey,
  AdminThemeMode,
  AdminThemeSettings,
  AgentManagementOverview,
  AuditDetailResponse,
  AuditLogEntry,
  AuditResponse,
  ConversationMessage,
  ConversationSession,
  ConversationSessionDetailResponse,
  DashboardOverview,
  DeploymentRecord,
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
  SandboxLiveSummary,
  VmItem,
} from './types';

const KvmControlCenter = lazy(() =>
  import('./components/KvmControlCenter').then((module) => ({ default: module.KvmControlCenter }))
);
const KvmHostTrendChart = lazy(() =>
  import('./components/KvmCharts').then((module) => ({ default: module.KvmHostTrendChart }))
);
const KvmVmStatusPieChart = lazy(() =>
  import('./components/KvmCharts').then((module) => ({ default: module.KvmVmStatusPieChart }))
);
const KvmSessionStatusBarChart = lazy(() =>
  import('./components/KvmCharts').then((module) => ({ default: module.KvmSessionStatusBarChart }))
);
const UserManagementSection = lazy(() =>
  import('./components/UserManagementSection').then((module) => ({ default: module.UserManagementSection }))
);
const DeploymentManagementSection = lazy(() =>
  import('./components/DeploymentManagementSection').then((module) => ({ default: module.DeploymentManagementSection }))
);
const SkillManagementSection = lazy(() =>
  import('./components/SkillManagementSection').then((module) => ({ default: module.SkillManagementSection }))
);
const ConnectorGuideManagementSection = lazy(() =>
  import('./components/ConnectorGuideManagementSection').then((module) => ({
    default: module.ConnectorGuideManagementSection,
  }))
);
const OsacReleaseManagementSection = lazy(() =>
  import('./components/OsacReleaseManagementSection').then((module) => ({ default: module.OsacReleaseManagementSection }))
);
const BillingManagementSection = lazy(() =>
  import('./components/BillingManagementSection').then((module) => ({ default: module.BillingManagementSection }))
);

type SectionKey = 'kvm' | 'deployment' | 'conversation' | 'user' | 'agent' | 'skill' | 'connectorGuide' | 'osacRelease' | 'sandbox' | 'audit' | 'billing';
type NavGroupKey = 'runtime' | 'platform' | 'billing';
type ToastTone = 'error' | 'success' | 'warning' | 'info';
type SandboxDetailTab = 'overview' | 'files' | 'processes' | 'connectivity' | 'archive' | 'terminal';
type SandboxProcessToolView = 'processes' | 'ports';
type SandboxFileOperation = 'upload' | 'download' | 'delete';
type SandboxFileTransferProgress = {
  operation: Extract<SandboxFileOperation, 'upload' | 'download'>;
  label: string;
  detail: string;
  percent: number | null;
};
type SandboxLoadStepKey = 'overview' | 'runtime' | 'templates' | 'live';
type SandboxLoadProgressState = {
  active: boolean;
  startedAt: number | null;
  completed: Record<SandboxLoadStepKey, boolean>;
};

type UiToast = {
  id: number;
  tone: ToastTone;
  title: string;
  message: string;
};

function sandboxDisplayLabel(detail: SandboxRuntimeDetail | null | undefined, fallback?: string | null) {
  return (
    detail?.runtime.taskTitle ||
    detail?.runtime.sandboxId ||
    detail?.liveSandboxDetail?.sandboxId ||
    detail?.liveSandbox?.sandboxId ||
    fallback ||
    '当前环境'
  );
}

type AuditFilterState = {
  query: string;
  operator: string;
  action: string;
  result: string;
  from: string;
  to: string;
};

type ConversationDialogTab = 'overview' | 'billing' | 'interaction' | 'infra' | 'raw' | 'transitions';
type ConversationBillingUsage = {
  totalCredits: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  cachedPromptTokens: number;
  cacheCreationTokens: number;
  callCount: number;
  items: Array<{
    id: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cachedPromptTokens: number;
    cacheCreationTokens: number;
    creditsConsumed: number;
    createdAt: string;
  }>;
};
type AdminDetailOrigin = {
  section: SectionKey;
  trail: string;
};

// 左侧主导航分组：区分“运行态能力”和“平台配置能力”。
type HostTrendPoint = {
  timestamp: number;
  timeLabel: string;
  cpu: number;
  memory: number;
  storage: number;
};

const SIDEBAR_STACK_BREAKPOINT = 920;
const WHEEL_LINE_HEIGHT_PX = 16;
const ADMIN_THEME_STORAGE_KEY = 'oneceo-admin-management-theme';
const ADMIN_THEME_MODE_STORAGE_KEY = 'oneceo-admin-management-theme-mode';
const ADMIN_SIDEBAR_STORAGE_KEY = 'oneceo-admin-management-sidebar-collapsed';
const DEFAULT_ADMIN_THEME: AdminThemeKey = 'github';
const DEFAULT_ADMIN_THEME_MODE: AdminThemeMode = 'system';
const FALLBACK_ADMIN_THEME_OPTIONS: AdminThemeSettings['themes'] = [
  {
    key: 'github',
    label: 'GitHub',
    description: '中性克制，适合高密度表格、索引和日志。',
    lightSwatches: ['#f6f8fa', '#24292f', '#0969da'],
    darkSwatches: ['#0d1117', '#e6edf3', '#2f81f7'],
  },
  {
    key: 'nord',
    label: 'Nord',
    description: '冷静蓝灰，长时间值守也不刺眼。',
    lightSwatches: ['#eceff4', '#2e3440', '#5e81ac'],
    darkSwatches: ['#2e3440', '#e5e9f0', '#88c0d0'],
  },
  {
    key: 'rose-pine',
    label: 'Rose Pine',
    description: '柔和暖调，让后台界面更温和但不发灰。',
    lightSwatches: ['#faf4ed', '#575279', '#b4637a'],
    darkSwatches: ['#191724', '#e0def4', '#c4a7e7'],
  },
  {
    key: 'one-dark-light',
    label: 'One Dark Light',
    description: 'Atom One 风格，代码、日志和表格更利落。',
    lightSwatches: ['#fafafa', '#383a42', '#4078f2'],
    darkSwatches: ['#282c34', '#abb2bf', '#61afef'],
  },
];
const FALLBACK_ADMIN_THEME_MODES: AdminThemeSettings['modes'] = [
  { key: 'light', label: '亮色', description: '始终使用亮色外观。' },
  { key: 'dark', label: '暗色', description: '始终使用暗色外观。' },
  { key: 'system', label: '跟随系统', description: '自动跟随设备当前的明暗模式。' },
];
const FALLBACK_ADMIN_THEME_KEYS = new Set(FALLBACK_ADMIN_THEME_OPTIONS.map((item) => item.key));

function normalizeAdminThemeKey(value: unknown): AdminThemeKey {
  const key = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return FALLBACK_ADMIN_THEME_KEYS.has(key) ? key : DEFAULT_ADMIN_THEME;
}

function normalizeAdminThemeMode(value: unknown): AdminThemeMode {
  const mode = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return mode === 'light' || mode === 'dark' || mode === 'system' ? mode : DEFAULT_ADMIN_THEME_MODE;
}

function readLegacyAdminThemePreference(value: unknown): { theme: AdminThemeKey; mode: AdminThemeMode | null } {
  const key = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (FALLBACK_ADMIN_THEME_KEYS.has(key)) {
    return { theme: key, mode: null };
  }
  if (key === 'github' || key.startsWith('github-')) {
    return { theme: 'github', mode: key === 'github' || key.includes('light') ? 'light' : 'dark' };
  }
  if (key === 'nord' || key.startsWith('nord-')) {
    return { theme: 'nord', mode: key.includes('frost') ? 'light' : 'dark' };
  }
  if (key === 'rosepine' || key === 'rose-pine' || key.startsWith('rose-pine-')) {
    return { theme: 'rose-pine', mode: key.includes('dawn') ? 'light' : 'dark' };
  }
  if (
    key === 'one'
    || key === 'one-light'
    || key === 'one-dark'
    || key === 'one-dark-light'
    || key.startsWith('one-dark-light-')
  ) {
    return {
      theme: 'one-dark-light',
      mode: key === 'one-light' || key.includes('light') ? 'light' : key.includes('dark') ? 'dark' : null,
    };
  }
  if (key.includes('light') || key.includes('dawn') || key.includes('day') || key.includes('frost')) {
    return { theme: DEFAULT_ADMIN_THEME, mode: 'light' };
  }
  if (
    key.includes('dark') ||
    key.includes('night') ||
    key.includes('moon') ||
    key.includes('main') ||
    key.includes('dimmed') ||
    key.includes('storm') ||
    key.includes('hard') ||
    key.includes('mocha') ||
    key.includes('macchiato') ||
    key.includes('polar')
  ) {
    return { theme: DEFAULT_ADMIN_THEME, mode: 'dark' };
  }
  return { theme: DEFAULT_ADMIN_THEME, mode: null };
}

function getSystemThemeTone() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveAdminThemeTone(mode: AdminThemeMode, systemTone: 'light' | 'dark') {
  return mode === 'system' ? systemTone : mode;
}

function resolveAdminThemeVariant(themeKey: AdminThemeKey, tone: 'light' | 'dark') {
  const normalizedTheme = normalizeAdminThemeKey(themeKey);
  if (normalizedTheme === 'nord') {
    return tone === 'dark' ? 'nord-polar-night' : 'nord-frost';
  }
  if (normalizedTheme === 'rose-pine') {
    return tone === 'dark' ? 'rose-pine-main' : 'rose-pine-dawn';
  }
  if (normalizedTheme === 'one-dark-light') {
    return tone === 'dark' ? 'one-dark-light-dark' : 'one-dark-light';
  }
  return tone === 'dark' ? 'github-dark' : 'github-light';
}

function readStoredAdminTheme(): AdminThemeKey {
  if (typeof window === 'undefined') return DEFAULT_ADMIN_THEME;
  return readLegacyAdminThemePreference(window.localStorage.getItem(ADMIN_THEME_STORAGE_KEY)).theme;
}

function persistStoredAdminTheme(themeKey: AdminThemeKey) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ADMIN_THEME_STORAGE_KEY, themeKey);
}

function readStoredAdminThemeMode(): AdminThemeMode {
  if (typeof window === 'undefined') return DEFAULT_ADMIN_THEME_MODE;
  const storedMode = window.localStorage.getItem(ADMIN_THEME_MODE_STORAGE_KEY);
  if (storedMode) return normalizeAdminThemeMode(storedMode);
  const legacy = readLegacyAdminThemePreference(window.localStorage.getItem(ADMIN_THEME_STORAGE_KEY));
  return legacy.mode || DEFAULT_ADMIN_THEME_MODE;
}

function persistStoredAdminThemeMode(mode: AdminThemeMode) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ADMIN_THEME_MODE_STORAGE_KEY, mode);
}

function readStoredSidebarCollapsed() {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(ADMIN_SIDEBAR_STORAGE_KEY) === 'true';
}

function persistStoredSidebarCollapsed(collapsed: boolean) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ADMIN_SIDEBAR_STORAGE_KEY, collapsed ? 'true' : 'false');
}

function applyAdminTheme(themeKey: AdminThemeKey, mode: AdminThemeMode, systemTone: 'light' | 'dark') {
  if (typeof document === 'undefined') return;
  const tone = resolveAdminThemeTone(mode, systemTone);
  const resolvedTheme = resolveAdminThemeVariant(themeKey, tone);
  document.documentElement.dataset.adminTheme = resolvedTheme;
  document.documentElement.dataset.adminTone = tone;
  document.documentElement.dataset.adminThemeMode = mode;
  document.documentElement.style.colorScheme = tone;
}

// 顶部导航模块配置，用于渲染卡片列表与权限/体验文案。
const NAV_GROUPS: Array<{ key: NavGroupKey; label: string; description: string }> = [
  { key: 'runtime', label: '运行管理', description: '运行状态与操作记录' },
  { key: 'platform', label: '平台配置', description: '能力、策略与发布配置' },
  { key: 'billing', label: '计费管理', description: '积分、定价与消费统计' },
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
    key: 'sandbox',
    group: 'runtime',
    label: 'Sandbox 管理',
    subtitle: 'Sandbox 与 OSAC',
    tag: 'SBX',
    description: '查看 Sandbox、归档记录和连通性状态。',
    signal: 'Sandbox 状态',
  },
  {
    key: 'deployment',
    group: 'runtime',
    label: '部署管理',
    subtitle: '发布与访问状态',
    tag: 'DEP',
    description: '查看会话部署记录、访问地址和用户归属。',
    signal: '部署状态',
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
    key: 'user',
    group: 'runtime',
    label: '用户管理',
    subtitle: '普通用户账号',
    tag: 'USR',
    description: '查看普通用户账号状态、登录来源，以及对话和 Sandbox 的关联情况。',
    signal: '账号关联',
  },
  {
    key: 'audit',
    group: 'runtime',
    label: '审计日志',
    subtitle: '操作追踪',
    tag: 'LOG',
    description: '查看操作记录、结果状态和时间线。',
    signal: '操作记录',
  },
  {
    key: 'kvm',
    group: 'runtime',
    label: 'KVM 管理',
    subtitle: '虚拟机与资源',
    tag: 'KVM',
    description: '查看宿主机资源、虚拟机状态和实例操作。',
    signal: '资源占用',
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
    subtitle: '平台技能与版本',
    tag: 'SKL',
    description: '维护平台技能、版本记录和校验结果。',
    signal: '技能工作区',
  },
  {
    key: 'connectorGuide',
    group: 'platform',
    label: '连接器 Guide',
    subtitle: '引导与发布',
    tag: 'CGD',
    description: '维护连接器引导策略、版本与发布记录。',
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
  {
    key: 'billing',
    group: 'billing',
    label: '计费管理',
    subtitle: '积分与定价配置',
    tag: 'BIL',
    description: '查看平台积分消耗、调整用户余额、配置模型定价。',
    signal: '消费统计',
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
const SANDBOX_LOAD_STEPS: Array<{ key: SandboxLoadStepKey; label: string; detail: string }> = [
  { key: 'overview', label: '概览', detail: '同步运行概览' },
  { key: 'runtime', label: '列表', detail: '拉取 Runtime 列表' },
  { key: 'templates', label: '模板', detail: '准备模板入口' },
  { key: 'live', label: 'Live', detail: '统计 live 数量' },
];
const EMPTY_SANDBOX_LOAD_PROGRESS: Record<SandboxLoadStepKey, boolean> = {
  overview: false,
  runtime: false,
  templates: false,
  live: false,
};

// 运行时列表排序参数。
type RuntimeSortKey = 'task_session' | 'sandbox' | 'executor' | 'status' | 'last_active';
type RuntimeSortDirection = 'asc' | 'desc';
type RuntimeSortState = {
  key: RuntimeSortKey;
  direction: RuntimeSortDirection;
};
type RuntimeColumnKey = 'task_session' | 'sandbox' | 'executor' | 'status' | 'last_active' | 'actions';
type ArchiveSortKey = 'time' | 'type' | 'size' | 'reason' | 'status';
type ArchiveSortState = {
  key: ArchiveSortKey;
  direction: RuntimeSortDirection;
};
type ArchiveColumnKey = 'time' | 'type' | 'size' | 'reason' | 'status' | 'actions';
type ConversationSortKey = 'session' | 'user' | 'executor' | 'session_id' | 'status' | 'updated_at' | 'created_at';
type AuditSortKey = 'id' | 'time' | 'action' | 'result' | 'operator' | 'target' | 'session';
type SortDirection = 'asc' | 'desc';

type ConversationSortState = {
  key: ConversationSortKey;
  direction: SortDirection;
};

type AuditSortState = {
  key: AuditSortKey;
  direction: SortDirection;
};

const DEFAULT_RUNTIME_SORT: RuntimeSortState = {
  key: 'last_active',
  direction: 'desc',
};

const DEFAULT_RUNTIME_COLUMN_WIDTHS: Record<RuntimeColumnKey, number> = {
  task_session: 190,
  sandbox: 176,
  executor: 108,
  status: 128,
  last_active: 132,
  actions: 178,
};

const RUNTIME_COLUMN_MIN_WIDTHS: Record<RuntimeColumnKey, number> = {
  task_session: 150,
  sandbox: 132,
  executor: 92,
  status: 112,
  last_active: 110,
  actions: 154,
};

const DEFAULT_ARCHIVE_SORT: ArchiveSortState = {
  key: 'time',
  direction: 'desc',
};

const DEFAULT_CONVERSATION_SORT: ConversationSortState = {
  key: 'updated_at',
  direction: 'desc',
};

const DEFAULT_AUDIT_SORT: AuditSortState = {
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

function formatRelativeTime(value?: string | null) {
  const timestamp = toTimestamp(value);
  if (!timestamp) return '-';
  const deltaMs = Date.now() - timestamp;
  if (deltaMs < 60 * 1000) return '刚刚';
  if (deltaMs < 60 * 60 * 1000) return `${Math.floor(deltaMs / (60 * 1000))} 分钟前`;
  if (deltaMs < 24 * 60 * 60 * 1000) return `${Math.floor(deltaMs / (60 * 60 * 1000))} 小时前`;
  if (deltaMs < 30 * 24 * 60 * 60 * 1000) return `${Math.floor(deltaMs / (24 * 60 * 60 * 1000))} 天前`;
  return formatDateTime(value);
}

function formatCompactRelativeTime(value?: string | null, now = Date.now()) {
  const timestamp = toTimestamp(value);
  if (!timestamp) return '-';
  const deltaMs = Math.max(0, now - timestamp);
  if (deltaMs < 60 * 1000) return `${Math.max(1, Math.floor(deltaMs / 1000))}秒前`;
  if (deltaMs < 60 * 60 * 1000) return `${Math.floor(deltaMs / (60 * 1000))}分钟前`;
  if (deltaMs < 24 * 60 * 60 * 1000) return `${Math.floor(deltaMs / (60 * 60 * 1000))}小时前`;
  if (deltaMs < 30 * 24 * 60 * 60 * 1000) return `${Math.floor(deltaMs / (24 * 60 * 60 * 1000))}天前`;
  return formatDateTime(value);
}

function stateClassName(state: string) {
  return `status-pill status-${state}`;
}

function statusLabel(status: string) {
  if (status === 'in_progress') return '进行中';
  if (status === 'waiting_user') return '待用户确认';
  if (status === 'completed') return '完成';
  if (status === 'failed') return '失败';
  if (status === 'unknown') return '未知';
  return status;
}

function deploymentStatusLabel(status?: string | null) {
  if (status === 'success') return '成功';
  if (status === 'failed') return '失败';
  if (status === 'pending') return '处理中';
  if (status === 'ready') return '已就绪';
  if (status === 'uninitialized') return '未初始化';
  return status || '-';
}

function deploymentStatusTone(status?: string | null) {
  if (status === 'success' || status === 'ready') return 'status-running';
  if (status === 'failed') return 'status-error';
  if (status === 'pending') return 'status-paused';
  return 'status-stopped';
}

function conversationStageLabel(stage?: string | null) {
  if (stage === 'collecting') return '信息收集';
  if (stage === 'clarifying') return '等待补充';
  if (stage === 'planning') return '方案规划';
  if (stage === 'executing') return '执行中';
  if (stage === 'completed') return '完成';
  if (stage === 'failed') return '失败';
  if (stage === 'unknown') return '未知阶段';
  return stage || '-';
}

function conversationPhaseLabel(phase?: string | null) {
  if (phase === 'input') return '输入';
  if (phase === 'thinking') return '思考';
  if (phase === 'planning') return '规划';
  if (phase === 'execution') return '执行';
  if (phase === 'waiting') return '等待';
  if (phase === 'output') return '输出';
  if (phase === 'completed') return '完成';
  if (phase === 'unknown') return '未知相位';
  return phase || '-';
}

function conversationUserLabel(user?: ConversationSession['user'] | null) {
  return user?.displayName || user?.email || user?.id || '未知用户';
}

function conversationUserMeta(user?: ConversationSession['user'] | null) {
  const parts = [user?.email, user?.ipAddress ? `IP ${user.ipAddress}` : '', user?.status]
    .filter((value): value is string => Boolean(value));
  return parts.length ? parts.join(' · ') : '未记录来源信息';
}

function conversationUserSourceLabel(source?: string | null) {
  if (source === 'app_user') return '用户账号';
  if (source === 'legacy_user_id') return '旧账号标识';
  if (source === 'missing_app_user') return '账号记录缺失';
  return source || '未知来源';
}

function conversationUserAgentLabel(userAgent?: string | null) {
  if (!userAgent) return '-';
  return summarizeText(userAgent, 96);
}

function conversationRoleLabel(role?: string | null) {
  if (role === 'user') return '用户';
  if (role === 'agent') return '智能体';
  if (role === 'assistant') return '助手';
  if (role === 'system') return '系统';
  if (role === 'tool') return '工具';
  if (role === 'developer') return '开发者';
  if (role === 'function') return '函数';
  return role || '-';
}

function conversationMessageTypeLabel(messageType?: string | null) {
  if (messageType === 'user_input') return '用户输入';
  if (messageType === 'user_response') return '用户补充';
  if (messageType === 'assistant_message') return '助手回复';
  if (messageType === 'agent_message') return '智能体回复';
  if (messageType === 'clarification_request') return '澄清请求';
  if (messageType === 'executor_event') return '执行事件';
  if (messageType === 'opencode_event') return 'OpenCode 事件';
  if (messageType === 'opencode_status') return 'OpenCode 状态';
  if (messageType === 'opencode_error') return 'OpenCode 异常';
  if (messageType === 'opencode_user_input') return '系统转发输入';
  if (messageType === 'codex_user_input') return 'Codex 转发输入';
  if (messageType === 'status_update') return '状态更新';
  if (messageType === 'session_started') return '会话开始';
  if (messageType === 'error') return '错误';
  if (messageType === 'plan_generated') return '计划生成';
  if (messageType === 'user') return '用户消息';
  if (messageType === 'assistant') return '助手回复';
  if (messageType === 'system') return '系统消息';
  if (messageType === 'tool') return '工具调用';
  if (messageType === 'tool_result') return '工具结果';
  if (messageType === 'state_transition') return '状态流转';
  if (messageType === 'request') return '请求';
  if (messageType === 'response') return '响应';
  if (messageType === 'text') return '文本';
  return messageType || '-';
}

function conversationAgentLabel(agent?: string | null) {
  if (agent === 'task-creation' || agent === 'task_creation') return '任务创建智能体';
  if (agent === 'ceo-view' || agent === 'ceo_view') return 'CEO 视图智能体';
  if (agent === 'task-detail' || agent === 'task_detail') return '任务详情智能体';
  return agent || '-';
}

function conversationToneLabel(tone?: string | null) {
  if (tone === 'friendly') return '友好';
  if (tone === 'neutral') return '中性';
  if (tone === 'professional') return '专业';
  if (tone === 'direct') return '直接';
  if (tone === 'concise') return '简洁';
  return tone || '-';
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

function adminInitials(displayName?: string | null, loginName?: string | null) {
  const source = adminDisplayNameLabel(displayName, loginName).trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return parts
      .slice(0, 2)
      .map((part) => Array.from(part)[0] || '')
      .join('')
      .toUpperCase();
  }
  return Array.from(source.replace(/\s+/g, '')).slice(0, 2).join('').toUpperCase() || 'AD';
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
  if (status === 'pending_update') return '待同步';
  if (status === 'unknown') return '未知';
  return status || '-';
}

function templateStatusLabel(status?: string | null) {
  if (status === 'active') return '启用';
  if (status === 'archived') return '已归档';
  if (status === 'building') return '构建中';
  if (status === 'failed') return '失败';
  if (status === 'ready' || status === 'available') return '可用';
  if (status === 'unknown') return '未知';
  return status || '-';
}

function archiveEntryTypeLabel(type?: string | null) {
  if (type === 'current') return '当前快照';
  if (type === 'snapshot') return '快照';
  if (type === 'dirty') return '待整理快照';
  return type || '-';
}

function sandboxRuntimeStateLabel(status?: string | null) {
  if (status === 'ready') return '就绪';
  if (status === 'running') return '运行中';
  if (status === 'paused') return '已暂停';
  if (status === 'stopped') return '已停止';
  if (status === 'closed') return '已关闭';
  if (status === 'starting') return '启动中';
  if (status === 'pending_archive') return '待归档';
  if (status === 'archived') return '已归档';
  if (status === 'error') return '异常';
  if (status === 'unknown') return '未知状态';
  return status || '-';
}

function sandboxRiskLabel(risk?: string | null) {
  if (risk === 'missing_osac_endpoint') return '缺少 OSAC 地址';
  if (risk === 'missing_opencode_base_url') return '缺少 OpenCode 地址';
  if (risk === 'archive_pending_too_long') return '归档等待过久';
  if (risk === 'archive_failed') return '归档失败';
  if (risk === 'inactive_but_running') return '空闲但仍在运行';
  if (risk === 'missing_executor_metadata') return '缺少执行器元数据';
  if (risk === 'untracked_environment') return '未纳管环境';
  return risk || '-';
}

function executorLabel(executor?: string | null) {
  if (executor === 'opencode') return 'OpenCode';
  if (executor === 'codex') return 'Codex';
  if (executor === 'altus') return 'Altus';
  if (executor === 'unknown') return '未知执行器';
  return executor || '-';
}

function capabilityNameLabel(name?: string | null) {
  if (name === 'Task Creation Agent') return '任务创建智能体';
  if (name === 'CEO View Agent') return 'CEO 视图智能体';
  if (name === 'Task Detail Agent') return '任务详情智能体';
  return name || '-';
}

function agentApiMessageLabel(message?: string | null) {
  if (message === 'Agent API is running') return '智能体接口运行正常';
  if (message === 'unavailable') return '智能体接口不可用';
  return message || '-';
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
  sizeBytes?: number | null;
  modifiedAt?: string | null;
  permissions?: string | null;
};

type SandboxFileTreeRow = SandboxFileItem & {
  depth: number;
  expanded: boolean;
  loaded: boolean;
  childCount: number;
  isRoot: boolean;
  isEmpty?: boolean;
};

type SandboxProcessRow = {
  pid: string;
  pidValue: number | null;
  ppid: string;
  user: string;
  cpuPercent: string;
  memoryPercent: string;
  elapsed: string;
  state: string;
  command: string;
  args: string;
};

type SandboxPortRow = {
  id: string;
  protocol: string;
  status: string;
  localAddress: string;
  port: string;
  peerAddress: string;
  process: string;
  raw: string;
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
      sizeBytes: typeof record.sizeBytes === 'number' ? record.sizeBytes : null,
      modifiedAt: typeof record.modifiedAt === 'string' ? record.modifiedAt : null,
      permissions:
        (typeof record.permissions === 'string' && record.permissions) ||
        (typeof record.mode === 'string' && record.mode) ||
        null,
    });
  }

  return Array.from(next.values()).sort((a, b) => {
    if (a.kind === 'dir' && b.kind !== 'dir') return -1;
    if (a.kind !== 'dir' && b.kind === 'dir') return 1;
    return a.label.localeCompare(b.label);
  });
}

function parentPath(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '/') return '/';
  const normalized = trimmed.replace(/\/+$/, '');
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length <= 1) return '/';
  return `/${segments.slice(0, -1).join('/')}`;
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

function formatBytes(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '-';
  }
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
}

function normalizeSandboxPath(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '/';
  const normalized = trimmed.replace(/\/+/g, '/').replace(/\/+$/, '');
  return normalized || '/';
}

function sandboxFileNameFromPath(value: string) {
  const segments = normalizeSandboxPath(value).split('/').filter(Boolean);
  return segments.at(-1) || 'sandbox-file';
}

function joinSandboxPath(directoryPath: string, filename: string) {
  const directory = normalizeSandboxPath(directoryPath);
  const safeName = filename.replace(/\\/g, '/').split('/').filter(Boolean).at(-1)?.trim() || 'upload.bin';
  return directory === '/' ? `/${safeName}` : `${directory}/${safeName}`;
}

function sandboxToolStringResult(value: unknown) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  const payload = value as Record<string, unknown>;
  const candidates = [payload.url, payload.downloadUrl, payload.uploadUrl, payload.href, payload.data];
  const matched = candidates.find((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return matched || '';
}

function clampTransferPercent(value: number) {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function triggerBrowserDownload(downloadUrl: string, fileName: string) {
  const link = document.createElement('a');
  link.href = downloadUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function uploadFileToSandboxUrl(
  uploadUrl: string,
  file: File,
  onProgress?: (loadedBytes: number, totalBytes: number) => void
) {
  return new Promise<void>((resolve, reject) => {
    const formData = new FormData();
    formData.append('file', file, file.name);

    const request = new XMLHttpRequest();
    request.open('POST', uploadUrl);
    request.upload.onprogress = (event) => {
      onProgress?.(event.loaded, event.lengthComputable ? event.total : file.size);
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress?.(file.size, file.size);
        resolve();
        return;
      }
      reject(new Error(`上传 ${file.name} 失败：${request.status}`));
    };
    request.onerror = () => reject(new Error(`上传 ${file.name} 失败：网络异常`));
    request.send(formData);
  });
}

async function downloadFileFromSandboxUrl(
  downloadUrl: string,
  fileName: string,
  onProgress?: (loadedBytes: number, totalBytes: number | null) => void
) {
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`下载 ${fileName} 失败：${response.status}`);
  }

  const contentLength = Number(response.headers.get('content-length'));
  const totalBytes = Number.isFinite(contentLength) && contentLength > 0 ? contentLength : null;

  if (!response.body) {
    const blob = await response.blob();
    onProgress?.(blob.size, totalBytes ?? blob.size);
    const objectUrl = window.URL.createObjectURL(blob);
    triggerBrowserDownload(objectUrl, fileName);
    window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 1000);
    return;
  }

  const reader = response.body.getReader();
  const chunks: BlobPart[] = [];
  let loadedBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    const chunk = new ArrayBuffer(value.byteLength);
    new Uint8Array(chunk).set(value);
    chunks.push(chunk);
    loadedBytes += value.byteLength;
    onProgress?.(loadedBytes, totalBytes);
  }

  const blob = new Blob(chunks, {
    type: response.headers.get('content-type') || 'application/octet-stream',
  });
  onProgress?.(blob.size, totalBytes ?? blob.size);
  const objectUrl = window.URL.createObjectURL(blob);
  triggerBrowserDownload(objectUrl, fileName);
  window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 1000);
}

function isPathWithin(rootPath: string, candidatePath: string) {
  const root = normalizeSandboxPath(rootPath);
  const candidate = normalizeSandboxPath(candidatePath);
  return root === '/' || candidate === root || candidate.startsWith(`${root}/`);
}

function addPathAndAncestors(target: Set<string>, path: string, rootPath?: string) {
  const root = rootPath ? normalizeSandboxPath(rootPath) : null;
  let current = normalizeSandboxPath(path);
  target.add(current);
  while (current !== '/') {
    current = parentPath(current);
    target.add(current);
    if (root && current === root) break;
  }
}

function buildSandboxFileTreeRows(
  rootPath: string,
  itemsByPath: Record<string, SandboxFileItem[]>,
  expandedPaths: string[]
): SandboxFileTreeRow[] {
  const root = normalizeSandboxPath(rootPath);
  const expandedSet = new Set([root, ...expandedPaths.map(normalizeSandboxPath)]);
  const rows: SandboxFileTreeRow[] = [];
  const visited = new Set<string>();

  const walk = (directoryPath: string, depth: number, includeSelf: boolean) => {
    const path = normalizeSandboxPath(directoryPath);
    if (visited.has(path)) return;
    visited.add(path);
    const loaded = Object.prototype.hasOwnProperty.call(itemsByPath, path);
    const children = itemsByPath[path] || [];

    if (includeSelf) {
      rows.push({
        path,
        label: path === '/' ? '/' : path.split('/').filter(Boolean).at(-1) || path,
        kind: 'dir',
        depth,
        expanded: expandedSet.has(path),
        loaded,
        childCount: children.length,
        isRoot: path === root,
      });
    }

    if (!expandedSet.has(path)) return;

    if (loaded && children.length === 0) {
      rows.push({
        path: `${path}::empty`,
        label: '空目录',
        kind: 'item',
        depth: depth + 1,
        expanded: false,
        loaded: true,
        childCount: 0,
        isRoot: false,
        isEmpty: true,
      });
      return;
    }

    children.forEach((item) => {
      const itemLoaded = Object.prototype.hasOwnProperty.call(itemsByPath, item.path);
      const itemExpanded = expandedSet.has(item.path);
      rows.push({
        ...item,
        depth: depth + 1,
        expanded: itemExpanded,
        loaded: itemLoaded,
        childCount: itemLoaded ? (itemsByPath[item.path] || []).length : 0,
        isRoot: false,
      });
      if (item.kind === 'dir' && itemExpanded) {
        walk(item.path, depth + 1, false);
      }
    });
  };

  walk(root, 0, true);
  return rows;
}

function sandboxFileTypeLabel(item: SandboxFileItem) {
  if (item.kind === 'dir') return '文件夹';
  const extension = item.label.includes('.') ? item.label.split('.').pop()?.trim() : '';
  return extension ? `${extension.toUpperCase()} 文件` : item.kind === 'file' ? '文件' : '项目';
}

function sandboxFileIconText(item: SandboxFileItem) {
  if (item.kind === 'dir') return 'DIR';
  const extension = item.label.includes('.') ? item.label.split('.').pop()?.trim() : '';
  return extension ? extension.slice(0, 4).toUpperCase() : 'FILE';
}

function sandboxFilePermissionsText(item: Pick<SandboxFileItem, 'permissions'> & { isEmpty?: boolean }) {
  if (item.isEmpty) return '-';
  const permissions = item.permissions?.trim();
  return permissions || '----------';
}

function processCellText(value: unknown, fallback = '-') {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value);
}

function getSandboxProcessRows(value: unknown): SandboxProcessRow[] {
  if (!value || typeof value !== 'object') return [];
  const items = (value as Record<string, unknown>).items;
  if (!Array.isArray(items)) return [];

  return items
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    .map((item) => {
      const pidNumber = Number(item.pid);
      const command = processCellText(item.command ?? item.args);
      const args = processCellText(item.args, '');
      return {
        pid: processCellText(item.pid),
        pidValue: Number.isFinite(pidNumber) && pidNumber > 0 ? pidNumber : null,
        ppid: processCellText(item.ppid),
        user: processCellText(item.user),
        cpuPercent: processCellText(item.cpuPercent),
        memoryPercent: processCellText(item.memoryPercent),
        elapsed: processCellText(item.elapsed),
        state: processCellText(item.state),
        command,
        args: args && args !== command ? args : '',
      };
    });
}

function extractPortFromAddress(value: string) {
  const bracketMatch = value.match(/\]:(\d+)(?:\b|$)/);
  if (bracketMatch?.[1]) return bracketMatch[1];
  const matches = [...value.matchAll(/[:.](\d+)(?=$|\s|\))/g)];
  return matches.at(-1)?.[1] || '-';
}

function parseSandboxPortLine(rawLine: string, index: number): SandboxPortRow | null {
  const raw = rawLine.trim();
  if (!raw || /^netid\s+/i.test(raw) || /^command\s+pid\s+/i.test(raw) || /^proto\s+/i.test(raw)) {
    return null;
  }

  const parts = raw.split(/\s+/);
  const processMatch = raw.match(/users:\(\("([^"]+)",pid=(\d+)/);
  let protocol = parts[0] || '-';
  let status = parts[1] || '-';
  let localAddress = parts[4] || parts[3] || '-';
  let peerAddress = parts[5] || '-';
  let process = processMatch ? `${processMatch[1]} (${processMatch[2]})` : parts.slice(6).join(' ') || '-';

  if (!/^(tcp|udp|raw|unix|u_str)$/i.test(protocol) && parts.length >= 8) {
    protocol = parts.find((part) => /^(tcp|udp)$/i.test(part)) || '-';
    status = raw.includes('(LISTEN)') ? 'LISTEN' : parts.find((part) => /^[A-Z_]{2,}$/.test(part)) || '-';
    localAddress = parts.slice(8).join(' ') || parts.at(-1) || '-';
    peerAddress = '-';
    process = [parts[0], parts[1]].filter(Boolean).join(' ') || '-';
  }

  return {
    id: `${index}-${raw}`,
    protocol,
    status,
    localAddress,
    port: extractPortFromAddress(localAddress),
    peerAddress,
    process,
    raw,
  };
}

function getSandboxPortRows(value: unknown): SandboxPortRow[] {
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  const sourceLines = Array.isArray(record.lines)
    ? record.lines
    : typeof record.output === 'string'
      ? record.output.split('\n')
      : typeof record.stdout === 'string'
        ? record.stdout.split('\n')
        : [];

  return sourceLines
    .filter((line): line is string => typeof line === 'string')
    .map(parseSandboxPortLine)
    .filter((line): line is SandboxPortRow => Boolean(line));
}

function formatSandboxProcessResult(value: unknown) {
  if (!value || typeof value !== 'object') {
    return toJsonText(value || { tip: '进程列表和 kill 结果在这里展示' });
  }

  const record = value as Record<string, unknown>;
  const items = Array.isArray(record.items) ? record.items : null;
  if (!items) {
    return toJsonText(value);
  }

  const lines = [
    'PID      PPID   USER       CPU%   MEM%   ELAPSED      STATE   COMMAND',
    '--------------------------------------------------------------------------',
  ];

  for (const item of items.slice(0, 80)) {
    if (!item || typeof item !== 'object') continue;
    const process = item as Record<string, unknown>;
    const pid = String(process.pid ?? '-').padEnd(8);
    const ppid = String(process.ppid ?? '-').padEnd(6);
    const user = String(process.user ?? '-').slice(0, 10).padEnd(10);
    const cpu = String(process.cpuPercent ?? '-').padEnd(6);
    const memory = String(process.memoryPercent ?? '-').padEnd(6);
    const elapsed = String(process.elapsed ?? '-').slice(0, 12).padEnd(12);
    const state = String(process.state ?? '-').slice(0, 7).padEnd(7);
    const command = String(process.command ?? process.args ?? '-');
    const args = String(process.args ?? '').trim();
    lines.push(`${pid} ${ppid} ${user} ${cpu} ${memory} ${elapsed} ${state} ${command}`);
    if (args && args !== command) {
      lines.push(`  args: ${args}`);
    }
  }

  if (!items.length) {
    lines.push('当前没有读到进程信息。');
  }

  if (typeof record.generatedAt === 'string') {
    lines.push('');
    lines.push(`更新时间: ${formatDateTime(record.generatedAt)}`);
  }

  return lines.join('\n');
}

function formatSandboxPortResult(value: unknown) {
  if (!value || typeof value !== 'object') {
    return toJsonText(value || { tip: '端口扫描和 host 映射结果在这里展示' });
  }

  const record = value as Record<string, unknown>;
  if (Array.isArray(record.lines)) {
    const lines = [`扫描器: ${String(record.scanner ?? 'unknown')}`];
    const listeners = (record.lines as unknown[]).filter((line): line is string => typeof line === 'string');
    if (listeners.length) {
      lines.push('');
      lines.push(...listeners);
    } else {
      lines.push('', '未发现监听端口。');
    }
    if (typeof record.generatedAt === 'string') {
      lines.push('', `更新时间: ${formatDateTime(record.generatedAt)}`);
    }
    return lines.join('\n');
  }

  return toJsonText(value);
}

function summarizeText(value: string | undefined, max = 260) {
  if (!value) return '';
  const compact = value.replace(/\s+/g, ' ').trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max)}...`;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function metadataString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function messageRunId(message: ConversationMessage): string | null {
  return metadataString(toRecord(message.metadata), 'runId');
}

function messageEventType(message: ConversationMessage): string | null {
  return metadataString(toRecord(message.metadata), 'eventType');
}

function messageToolName(message: ConversationMessage): string | null {
  return metadataString(toRecord(message.metadata), 'toolName');
}

function messageExecutor(message: ConversationMessage): string | null {
  return metadataString(toRecord(message.metadata), 'executor');
}

function messageSessionLocator(message: ConversationMessage): string | null {
  const metadata = toRecord(message.metadata);
  return (
    metadataString(metadata, 'orchestratorSessionId') ||
    metadataString(metadata, 'opencodeSessionId') ||
    metadataString(metadata, 'workspacePath')
  );
}

function isUserFacingMessage(message: ConversationMessage): boolean {
  return [
    'user_input',
    'user_response',
    'assistant_message',
    'agent_message',
    'clarification_request',
    'error',
    'opencode_error',
  ].includes(String(message.messageType || ''));
}

function isStatusTimelineMessage(message: ConversationMessage): boolean {
  return ['status_update', 'session_started'].includes(String(message.messageType || ''));
}

function isExecutionTraceMessage(message: ConversationMessage): boolean {
  return [
    'executor_event',
    'opencode_status',
    'opencode_user_input',
    'codex_user_input',
  ].includes(String(message.messageType || ''));
}

function isOpencodeNoiseMessage(message: ConversationMessage): boolean {
  return String(message.messageType || '') === 'opencode_event';
}

function isFailureMessage(message: ConversationMessage): boolean {
  if (['error', 'opencode_error'].includes(String(message.messageType || ''))) return true;
  if (String(message.messageType || '') === 'executor_event') {
    return messageEventType(message) === 'tool_call_failed';
  }
  if (String(message.messageType || '') === 'status_update') {
    return metadataString(toRecord(message.metadata), 'stage') === 'failed';
  }
  return false;
}

function deriveMessageOutcome(messages: ConversationMessage[]): string {
  const hasFailure = messages.some(isFailureMessage);
  if (hasFailure) return '失败';
  const hasWaiting = messages.some((message) => String(message.messageType || '') === 'clarification_request');
  if (hasWaiting) return '等待用户';
  const latestStatus = [...messages].reverse().find((message) => String(message.messageType || '') === 'status_update');
  const latestStage = latestStatus ? metadataString(toRecord(latestStatus.metadata), 'stage') : null;
  if (latestStage === 'completed') return '已完成';
  if (latestStage === 'reviewing') return '待确认';
  const hasAssistantReply = messages.some((message) =>
    ['assistant_message', 'agent_message'].includes(String(message.messageType || ''))
  );
  if (hasAssistantReply) return '已回复';
  return '处理中';
}

function messageContentPreview(message: ConversationMessage, max = 220): string {
  const summary = summarizeText(message.content, max);
  if (summary) return summary;
  const metadata = toRecord(message.metadata);
  const outputPreview = metadataString(metadata, 'outputPreview');
  if (outputPreview) return summarizeText(outputPreview, max);
  const question = metadataString(metadata, 'question');
  if (question) return summarizeText(question, max);
  const eventType = metadataString(metadata, 'eventType');
  if (eventType) return `事件: ${eventType}`;
  return '无正文';
}

function parseJsonMaybe(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function messageOutputPreviewRecord(message: ConversationMessage): Record<string, unknown> | null {
  const metadata = toRecord(message.metadata);
  const parsed = parseJsonMaybe(metadataString(metadata, 'outputPreview'));
  const record = toRecord(parsed);
  return Object.keys(record).length > 0 ? record : null;
}

function clarificationOptions(message: ConversationMessage): string[] {
  const metadata = toRecord(message.metadata);
  return asStringArray(metadata.options);
}

function clarificationQuestion(message: ConversationMessage): string {
  const metadata = toRecord(message.metadata);
  return metadataString(metadata, 'question') || summarizeText(message.content, 360) || '待补充信息';
}

function clarificationOptionsSummary(message: ConversationMessage, max = 4): string {
  const options = clarificationOptions(message);
  if (options.length === 0) return '未提供可选项';
  return options.slice(0, max).join(' / ');
}

function messageSummaryLabel(message: ConversationMessage): string | null {
  const type = String(message.messageType || '');
  if (type === 'clarification_request') return '等待用户确认';
  if (type === 'assistant_message') return '主回复';
  if (type === 'agent_message') return '智能体回复';
  if (type === 'user_input') return '用户发起';
  if (type === 'user_response') return '用户补充';
  if (type === 'opencode_error' || type === 'error') return '执行异常';
  if (type === 'status_update') {
    const eventType = messageEventType(message);
    if (eventType === 'deliverables_ready') return '交付已生成';
    if (eventType === 'run_completed') return '运行完成';
  }
  return null;
}

type CompletionSummary = {
  summary: string;
  verification: string[];
  deliverables: Array<{ name: string; path: string }>;
};

function completionSummaryFromGroup(group: ConversationInteractionGroup): CompletionSummary | null {
  const completionEvent = [...group.executionMessages]
    .reverse()
    .find((message) => messageToolName(message) === 'complete_task');
  if (!completionEvent) return null;
  const output = messageOutputPreviewRecord(completionEvent);
  if (!output) return null;
  const summary = metadataString(output, 'summary') || '';
  const verification = asStringArray(output.verification);
  const deliverablesSource = Array.isArray(output.deliverables) ? output.deliverables : Array.isArray(output.attachments) ? output.attachments : [];
  const deliverables = deliverablesSource
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    .map((item) => ({
      name:
        (typeof item.name === 'string' && item.name) ||
        (typeof item.displayName === 'string' && item.displayName) ||
        (typeof item.path === 'string' && item.path.split('/').filter(Boolean).at(-1)) ||
        '未命名交付',
      path: typeof item.path === 'string' ? item.path : '',
    }));
  if (!summary && verification.length === 0 && deliverables.length === 0) return null;
  return { summary, verification, deliverables };
}

type ConversationInteractionGroup = {
  id: string;
  runId: string | null;
  sessionLocator: string | null;
  messages: ConversationMessage[];
  primaryMessages: ConversationMessage[];
  statusMessages: ConversationMessage[];
  executionMessages: ConversationMessage[];
  eventMessages: ConversationMessage[];
  failedMessages: ConversationMessage[];
  toolNames: string[];
  outcome: string;
  startedAt: string;
  endedAt: string;
};

function buildConversationInteractionGroups(messages: ConversationMessage[]): ConversationInteractionGroup[] {
  const groups: ConversationInteractionGroup[] = [];
  const groupOrder = new Map<string, ConversationInteractionGroup>();
  let fallbackCounter = 0;
  let lastGroup: ConversationInteractionGroup | null = null;

  for (const message of messages) {
    const runId = messageRunId(message);
    const sessionLocator = messageSessionLocator(message);
    const role = String(message.role || '');
    const type = String(message.messageType || '');
    const startsOwnFallbackGroup = role === 'user' || ['session_started', 'opencode_error', 'error'].includes(type);
    const groupKey: string =
      runId ||
      (sessionLocator && !startsOwnFallbackGroup ? `locator:${sessionLocator}` : null) ||
      (lastGroup && !startsOwnFallbackGroup ? lastGroup.id : `fallback:${fallbackCounter++}`);

    let group = groupOrder.get(groupKey);
    if (!group) {
      group = {
        id: groupKey,
        runId,
        sessionLocator,
        messages: [],
        primaryMessages: [],
        statusMessages: [],
        executionMessages: [],
        eventMessages: [],
        failedMessages: [],
        toolNames: [],
        outcome: '处理中',
        startedAt: message.createdAt,
        endedAt: message.createdAt,
      };
      groupOrder.set(groupKey, group);
      groups.push(group);
    }

    group.messages.push(message);
    group.endedAt = message.createdAt;
    if (isUserFacingMessage(message)) group.primaryMessages.push(message);
    if (isStatusTimelineMessage(message)) group.statusMessages.push(message);
    if (isExecutionTraceMessage(message)) group.executionMessages.push(message);
    if (isOpencodeNoiseMessage(message)) group.eventMessages.push(message);
    if (isFailureMessage(message)) group.failedMessages.push(message);
    const toolName = messageToolName(message);
    if (toolName && !group.toolNames.includes(toolName)) {
      group.toolNames.push(toolName);
    }
    group.outcome = deriveMessageOutcome(group.messages);
    lastGroup = group;
  }

  return groups;
}

function messageMetaSummary(message: ConversationMessage): string[] {
  const metadata = toRecord(message.metadata);
  const parts: string[] = [];
  const eventType = metadataString(metadata, 'eventType');
  const toolName = metadataString(metadata, 'toolName');
  const executor = messageExecutor(message);
  const stage = metadataString(metadata, 'stage');
  const tone = metadataString(metadata, 'tone');
  const runId = metadataString(metadata, 'runId');
  const outputPreview = metadataString(metadata, 'outputPreview');
  const question = metadataString(metadata, 'question');

  if (toolName) parts.push(`工具: ${toolName}`);
  if (eventType) parts.push(`事件: ${eventType}`);
  if (executor) parts.push(`处理方式: ${executorLabel(executor)}`);
  if (stage) parts.push(`阶段: ${conversationStageLabel(stage)}`);
  if (tone) parts.push(`语气: ${conversationToneLabel(tone)}`);
  if (runId) parts.push(`运行批次: ${runId.slice(0, 8)}`);
  if (!parts.length && question) parts.push(`问题: ${summarizeText(question, 80)}`);
  if (!parts.length && outputPreview) parts.push(`输出: ${summarizeText(outputPreview, 80)}`);
  return parts;
}

type ConversationDiagnosticLevel = 'error' | 'warning' | 'success' | 'info';

function messageDiagnosticLevel(message: ConversationMessage): ConversationDiagnosticLevel {
  if (isFailureMessage(message)) return 'error';
  const type = String(message.messageType || '');
  const eventType = messageEventType(message);
  if (type === 'clarification_request' || eventType === 'deliverables_ready') return 'warning';
  if (
    type === 'assistant_message' ||
    (type === 'status_update' && eventType === 'run_completed') ||
    (type === 'executor_event' && messageToolName(message) === 'complete_task' && eventType === 'tool_call_completed')
  ) {
    return 'success';
  }
  return 'info';
}

function diagnosticLevelLabel(level: ConversationDiagnosticLevel): string {
  if (level === 'error') return '阻塞';
  if (level === 'warning') return '关注';
  if (level === 'success') return '完成';
  return '信息';
}

function diagnosticSortScore(message: ConversationMessage): number {
  const level = messageDiagnosticLevel(message);
  if (level === 'error') return 0;
  if (level === 'warning') return 1;
  if (level === 'success') return 2;
  return 3;
}

function sortRawMessagesForDiagnostics(messages: ConversationMessage[]): ConversationMessage[] {
  return [...messages].sort((left, right) => {
    const severityDiff = diagnosticSortScore(left) - diagnosticSortScore(right);
    if (severityDiff !== 0) return severityDiff;
    return toTimestamp(right.createdAt) - toTimestamp(left.createdAt);
  });
}

function messageDiagnosticSummary(message: ConversationMessage): string | null {
  const type = String(message.messageType || '');
  const eventType = messageEventType(message);
  const toolName = messageToolName(message);
  const metadata = toRecord(message.metadata);
  if (type === 'opencode_error') {
    return '处理链路异常，优先确认 Sandbox 端口、订阅状态和 OpenCode 是否可用。';
  }
  if (type === 'error') {
    return '当前这一轮出现明确错误，建议结合附带信息和时间线继续排查。';
  }
  if (type === 'clarification_request') {
    return '当前轮次在等待用户补充信息或确认下一步。';
  }
  if (type === 'executor_event' && eventType === 'tool_call_failed') {
    return `${toolName || '工具'} 执行失败，优先检查参数、工作目录和运行状态。`;
  }
  if (type === 'executor_event' && eventType === 'tool_call_completed') {
    return `${toolName || '工具'} 已完成，可结合结果摘要判断是否真的产出了可用结果。`;
  }
  if (type === 'status_update' && metadataString(metadata, 'stage') === 'failed') {
    return '会话进入 failed 阶段，本轮已终止。';
  }
  if (type === 'status_update' && eventType === 'deliverables_ready') {
    return '交付已生成，建议核对文件与最终回复是否一致。';
  }
  if (type === 'status_update' && eventType === 'run_completed') {
    return '这一轮自动处理已经结束。';
  }
  if (type === 'opencode_event') {
    return '这是系统底层记录，主要用于补充上下文，不代表用户会直接看到的回复。';
  }
  return null;
}

function metadataHighlights(message: ConversationMessage): string[] {
  const metadata = toRecord(message.metadata);
  const output = messageOutputPreviewRecord(message);
  const outputRecord = output || {};
  const highlights: string[] = [];
  const eventType = messageEventType(message);

  const requestId = metadataString(metadata, 'requestId') || metadataString(outputRecord, 'requestId');
  if (requestId) highlights.push(`请求 ${requestId.slice(0, 12)}`);

  const responseTime =
    (typeof output?.responseTime === 'number' && Number.isFinite(output.responseTime) ? `${output.responseTime}s` : null) ||
    metadataString(metadata, 'responseTime');
  if (responseTime) highlights.push(`耗时 ${responseTime}`);

  if (eventType === 'tool_call_completed') {
    const results = Array.isArray(output?.results) ? output.results : [];
    const topTitles = results
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
      .map((item) => (typeof item.title === 'string' ? item.title : ''))
      .filter(Boolean)
      .slice(0, 3);
    highlights.push(...topTitles.map((title) => summarizeText(title, 42)));
  }

  const errorMessage =
    metadataString(metadata, 'error') ||
    metadataString(metadata, 'errorMessage') ||
    metadataString(outputRecord, 'error') ||
    metadataString(outputRecord, 'message');
  if (errorMessage && highlights.length < 4) {
    highlights.push(summarizeText(errorMessage, 56));
  }

  return highlights.slice(0, 4);
}

type ConversationReplayCapsuleTone = 'system' | 'intent' | 'planning' | 'execution' | 'review' | 'error';
type ConversationReplayToolStatus = 'running' | 'completed' | 'failed' | 'unknown';

type ConversationReplayItem =
  | {
      id: string;
      kind: 'user';
      text: string;
      timestamp: string;
      messageKey?: string;
    }
  | {
      id: string;
      kind: 'agent_plain';
      text: string;
      timestamp: string;
      author: string;
      options?: string[];
      messageKey?: string;
      showAuthor?: boolean;
    }
  | {
      id: string;
      kind: 'capsule';
      label: string;
      timestamp: string;
      tone: ConversationReplayCapsuleTone;
      loading?: boolean;
      segments?: string[];
      messageKey?: string;
    }
  | {
      id: string;
      kind: 'clarification_notice';
      text: string;
      timestamp: string;
      messageKey?: string;
    }
  | {
      id: string;
      kind: 'managed_tool';
      timestamp: string;
      runId: string;
      toolCallId: string;
      eventType: string;
      toolName: string;
      status: ConversationReplayToolStatus;
      summary: string;
      preview: string;
      detail: string;
      artifactPaths: string[];
      expandWrite: boolean;
      messageKey?: string;
    }
  | {
      id: string;
      kind: 'opencode_tool';
      timestamp: string;
      variant: 'chip' | 'card';
      iconLabel: string;
      title: string;
      subtitle?: string;
      statusLabel?: string;
      tone?: 'default' | 'success' | 'error';
      command?: string;
      preview?: string;
      previewMode?: 'code' | 'plain';
      detail?: string;
      messageKey?: string;
    }
  | {
      id: string;
      kind: 'error';
      text: string;
      timestamp: string;
      author: string;
      messageKey?: string;
      showAuthor?: boolean;
    };

type ConversationOpencodeEventInfo = {
  eventType: string;
  event: Record<string, unknown>;
  properties: Record<string, unknown>;
  part: Record<string, unknown>;
  partType: string;
  toolName: string;
};

function conversationMessageKey(message: ConversationMessage): string {
  return metadataString(toRecord(message.metadata), 'messageKey') || message.id;
}

function normalizeConversationReplayText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function normalizeConversationClarificationText(value: string): string {
  return value
    .replace(/[\s\u3000]+/g, ' ')
    .replace(/[。！？!?.:：]/g, '')
    .trim()
    .toLowerCase();
}

function extractConversationReplayCapsule(content: string): { label: string; rest: string } | null {
  const text = content.trim();
  const match = text.match(/^\{([^{}]+)\}\s*([\s\S]*)$/);
  if (match) {
    return {
      label: match[1].trim(),
      rest: (match[2] || '').trim(),
    };
  }

  const statusCapsules = [
    '构思阶段',
    '分析阶段',
    '开发阶段',
    '测试阶段',
    '修复阶段',
    '交付阶段',
    '正在分析您的任务需求',
    '正在分析您的任务需求...',
    '已识别任务类型',
    '正在规划任务详情',
    '正在规划任务详情...',
    '任务规划完成',
    '任务规划完成：',
    '正在生成执行计划',
    '正在生成执行计划...',
    '执行计划已生成',
  ];
  for (const status of statusCapsules) {
    if (text.includes(status)) {
      return { label: text, rest: '' };
    }
  }

  const fallbackLabels = ['意图识别', '任务规划', '执行计划', '系统', '错误'];
  for (const label of fallbackLabels) {
    if (text.startsWith(label)) {
      return {
        label,
        rest: text
          .slice(label.length)
          .replace(/^[:：\-\s]+/, '')
          .trim(),
      };
    }
  }

  return null;
}

function isConversationProgressStatusLabel(label: string): boolean {
  const text = label.trim();
  if (!text) return false;
  if (text.includes('错误') || text.includes('失败') || text.toLowerCase().includes('error')) {
    return false;
  }
  const keywords = [
    '构思阶段',
    '分析阶段',
    '开发阶段',
    '测试阶段',
    '修复阶段',
    '交付阶段',
    '正在分析您的任务需求',
    '已识别任务类型',
    '正在规划任务详情',
    '任务规划完成',
    '正在生成执行计划',
    '执行计划已生成',
    '开始执行',
    '执行完成',
    '继续工作',
    '处理中',
  ];
  return keywords.some((keyword) => text.includes(keyword));
}

function conversationReplayCapsuleTone(message: ConversationMessage, label: string): ConversationReplayCapsuleTone {
  if (isFailureMessage(message)) return 'error';
  const metadata = toRecord(message.metadata);
  const rawTone = metadataString(metadata, 'tone');
  if (rawTone === 'intent' || rawTone === 'planning' || rawTone === 'execution' || rawTone === 'review' || rawTone === 'error') {
    return rawTone;
  }
  if (label.includes('意图') || label.includes('分析')) return 'intent';
  if (label.includes('规划')) return 'planning';
  if (label.includes('执行') || label.includes('运行')) return 'execution';
  if (label.includes('交付') || label.includes('完成')) return 'review';
  if (label.includes('错误') || label.includes('失败')) return 'error';
  return 'system';
}

function truncateConversationReplayText(value: string, max = 1200): { text: string; truncated: boolean } {
  const text = value.trim();
  if (!text) return { text: '', truncated: false };
  if (text.length <= max) return { text, truncated: false };
  return { text: `${text.slice(0, max)}...`, truncated: true };
}

function parseConversationReplayOutputPreview(outputPreviewRaw: unknown): Record<string, unknown> {
  if (!outputPreviewRaw) return {};
  if (typeof outputPreviewRaw === 'string') {
    const trimmed = outputPreviewRaw.trim();
    if (!trimmed) return {};
    try {
      return toRecord(JSON.parse(trimmed));
    } catch {
      return {};
    }
  }
  return toRecord(outputPreviewRaw);
}

function getConversationReplayFilename(path: string | undefined) {
  if (!path) return '';
  const parts = path.split(/[/\\]+/);
  return parts[parts.length - 1] || path;
}

function normalizeConversationReplayShellCommand(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) return '';
  const bashLcMatch = trimmed.match(/^(?:\/bin\/)?(?:ba)?sh\s+-lc\s+(.+)$/i);
  if (bashLcMatch?.[1]) {
    return bashLcMatch[1].trim().replace(/^['"]|['"]$/g, '');
  }
  return trimmed;
}

function inferConversationReplayCommandCategory(command: string): 'list' | 'search' | 'read' | 'write' | 'command' {
  const normalized = normalizeConversationReplayShellCommand(command).toLowerCase();
  if (!normalized) return 'command';
  if (normalized.startsWith('ls') || normalized.startsWith('tree') || normalized.startsWith('find ')) {
    return 'list';
  }
  if (normalized.startsWith('rg ') || normalized.startsWith('grep ') || normalized.includes(' grep ') || normalized.includes(' rg ')) {
    return 'search';
  }
  if (normalized.startsWith('cat ') || normalized.startsWith('sed ') || normalized.startsWith('head ') || normalized.startsWith('tail ')) {
    return 'read';
  }
  if (normalized.includes('>') || normalized.includes('tee ') || normalized.includes('cat <<') || normalized.startsWith('cp ') || normalized.startsWith('mv ')) {
    return 'write';
  }
  return 'command';
}

function getConversationReplayCommandCard(command: string): { category: 'list' | 'search' | 'read' | 'write' | 'command'; title: string; iconLabel: string } {
  const category = inferConversationReplayCommandCategory(command);
  switch (category) {
    case 'list':
      return { category, title: '目录检查', iconLabel: '目' };
    case 'search':
      return { category, title: '搜索', iconLabel: '搜' };
    case 'read':
      return { category, title: '文件查看', iconLabel: '读' };
    case 'write':
      return { category, title: '文件修改', iconLabel: '写' };
    default:
      return { category, title: 'Shell 执行', iconLabel: '命' };
  }
}

function conversationReplayMapFileChangeLabel(kind: string): string {
  const normalized = kind.trim().toLowerCase();
  if (normalized === 'add' || normalized === 'create' || normalized === 'created') {
    return '新建文件';
  }
  if (normalized === 'delete' || normalized === 'deleted' || normalized === 'remove' || normalized === 'removed') {
    return '删除文件';
  }
  return '更新文件';
}

function getConversationReplayOpencodeEventInfo(metadata: Record<string, unknown>): ConversationOpencodeEventInfo {
  const rawPayload = toRecord(metadata.rawPayload);
  const eventFromMeta = toRecord(metadata.event);
  const eventFromPayload = toRecord(rawPayload.event);
  const event = Object.keys(eventFromMeta).length > 0 ? eventFromMeta : eventFromPayload;
  const eventType = asText(metadata.eventType) || asText(event.type);
  const properties = toRecord(event.properties);
  const part = toRecord(properties.part);
  const partType = (asText(part.type) || asText(properties.type)).toLowerCase();
  const toolName = asText(part.tool) || asText(part.name) || asText(properties.tool) || asText(metadata.toolName);
  return {
    eventType,
    event,
    properties,
    part,
    partType,
    toolName,
  };
}

function isManagedConversationExecutionEvent(message: ConversationMessage): boolean {
  const metadata = toRecord(message.metadata);
  return asText(metadata.executionMode).toLowerCase() === 'managed' || asText(metadata.executor).toLowerCase() === 'altus';
}

function collectConversationReplayArtifactPaths(toolName: string, metadataRaw: unknown): string[] {
  const metadata = toRecord(metadataRaw);
  const args = toRecord(metadata.arguments);
  const output = parseConversationReplayOutputPreview(metadata.outputPreview);
  const paths = new Set<string>();
  const pushPath = (value: unknown) => {
    const path = asText(value).replace(/\\/g, '/');
    if (!path) return;
    paths.add(path);
  };

  if (toolName === 'write_file' || toolName === 'read_file') {
    pushPath(args.path);
    pushPath(output.path);
  }

  if (toolName === 'complete_task' && Array.isArray((args as { attachments?: unknown[] }).attachments)) {
    for (const item of (args as { attachments?: unknown[] }).attachments || []) {
      const record = toRecord(item);
      pushPath(record.path);
      pushPath(record.filePath);
    }
  }

  return Array.from(paths);
}

function getConversationManagedToolDisplayName(toolName: string): string {
  switch (toolName) {
    case 'shell_execute':
      return '命令执行';
    case 'write_file':
      return '写入文件';
    case 'read_file':
      return '读取文件';
    case 'list_directory':
      return '列出目录';
    case 'search_code':
      return '代码搜索';
    case 'ask_user':
      return '请求澄清';
    case 'complete_task':
      return '完成任务';
    default:
      return toolName || '工具调用';
  }
}

function readConversationManagedWriteFileProgress(metadataRaw: unknown) {
  const metadata = toRecord(metadataRaw);
  const progress = toRecord(metadata.writeFileProgress);
  const path = asText(progress.path);
  const generatedCharsRaw = progress.generatedChars;
  const generatedChars =
    typeof generatedCharsRaw === 'number' && Number.isFinite(generatedCharsRaw)
      ? Math.max(0, Math.floor(generatedCharsRaw))
      : typeof generatedCharsRaw === 'string' && generatedCharsRaw.trim()
        ? Math.max(0, Math.floor(Number(generatedCharsRaw)))
        : 0;
  const preview = asText(progress.preview);
  return {
    path,
    generatedChars,
    preview,
  };
}

function shouldExpandConversationManagedWriteFileCard(toolName: string, status: ConversationReplayToolStatus, metadataRaw: unknown) {
  if (toolName !== 'write_file' || status !== 'running') return false;
  const progress = readConversationManagedWriteFileProgress(metadataRaw);
  return progress.generatedChars > 0 || Boolean(progress.preview);
}

function formatConversationManagedToolSummary(toolName: string, metadataRaw: unknown): string {
  const metadata = toRecord(metadataRaw);
  const args = toRecord(metadata.arguments);
  const writeFileProgress = readConversationManagedWriteFileProgress(metadata);
  if (toolName === 'shell_execute') {
    return asText(args.command) || '执行 shell 命令';
  }
  if (toolName === 'write_file') {
    const path = asText(args.path) || writeFileProgress.path;
    if (writeFileProgress.generatedChars > 0) {
      return [path || '写入文件', `生成中 ${writeFileProgress.generatedChars} 字符`].filter(Boolean).join(' · ');
    }
    return path || '写入文件';
  }
  if (toolName === 'read_file') {
    return asText(args.path) || '读取文件';
  }
  if (toolName === 'list_directory') {
    return asText(args.path) || '列出目录';
  }
  if (toolName === 'search_code') {
    const query = asText(args.query);
    const target = asText(args.path);
    return [query, target ? `@ ${target}` : ''].filter(Boolean).join(' ');
  }
  if (toolName === 'ask_user') {
    return asText(args.question) || '请求用户澄清';
  }
  if (toolName === 'complete_task') {
    return asText(args.summary) || '输出最终完成总结';
  }
  return asText(metadata.content) || toolName;
}

function formatConversationManagedToolPreview(toolName: string, metadataRaw: unknown): string {
  const metadata = toRecord(metadataRaw);
  const args = toRecord(metadata.arguments);
  const output = parseConversationReplayOutputPreview(metadata.outputPreview);
  const writeFileProgress = readConversationManagedWriteFileProgress(metadata);
  const error = asText(metadata.error);

  if (error) return error;

  if (toolName === 'shell_execute') {
    return asText(output.stdout) || asText(output.stderr) || asText(args.command) || '执行命令';
  }

  if (toolName === 'write_file') {
    if (writeFileProgress.preview) {
      return writeFileProgress.preview;
    }
    return asText(output.path) || '已写入目标文件';
  }

  if (toolName === 'read_file') {
    return asText(output.content) || asText(output.path) || '已读取目标文件';
  }

  if (toolName === 'list_directory') {
    return asText(output.output) || asText(output.path) || '已返回目录内容';
  }

  if (toolName === 'search_code') {
    return asText(output.output) || asText(args.query) || '已返回搜索结果';
  }

  if (toolName === 'complete_task') {
    return asText(args.summary) || '任务已完成';
  }

  return asText(metadata.outputPreview) || asText(metadata.content);
}

function formatConversationManagedToolDetail(toolName: string, metadataRaw: unknown): string {
  const metadata = toRecord(metadataRaw);
  const args = toRecord(metadata.arguments);
  const output = parseConversationReplayOutputPreview(metadata.outputPreview);
  const writeFileProgress = readConversationManagedWriteFileProgress(metadata);
  const error = asText(metadata.error);
  const lines: string[] = [];
  const pushLine = (label: string, value: unknown) => {
    const text = asText(value);
    if (text) {
      lines.push(`${label}: ${text}`);
    }
  };

  lines.push(`工具: ${getConversationManagedToolDisplayName(toolName)} (${toolName})`);

  if (toolName === 'shell_execute') {
    pushLine('命令', args.command);
    pushLine('目录', output.cwd || args.cwd);
    pushLine('退出码', output.exitCode);
    pushLine('输出', output.stdout);
    pushLine('错误输出', output.stderr);
  } else if (toolName === 'write_file') {
    pushLine('目标文件', args.path || output.path || writeFileProgress.path);
    pushLine('已生成字符', writeFileProgress.generatedChars > 0 ? String(writeFileProgress.generatedChars) : '');
    pushLine('代码预览', writeFileProgress.preview);
  } else if (toolName === 'read_file') {
    pushLine('目标文件', args.path || output.path);
    pushLine('内容预览', output.content);
  } else if (toolName === 'list_directory') {
    pushLine('目标目录', args.path || output.path);
    pushLine('递归深度', output.depth || args.depth);
    pushLine('结果预览', output.output);
  } else if (toolName === 'search_code') {
    pushLine('搜索词', args.query);
    pushLine('搜索范围', args.path || output.path);
    pushLine('结果预览', output.output);
  } else if (toolName === 'ask_user') {
    pushLine('问题', args.question);
    if (Array.isArray(args.options)) {
      const options = (args.options as unknown[]).map((item) => asText(item)).filter(Boolean).join(' / ');
      pushLine('建议选项', options);
    }
  } else if (toolName === 'complete_task') {
    pushLine('完成摘要', args.summary);
    if (Array.isArray(args.verification)) {
      const checks = (args.verification as unknown[]).map((item) => asText(item)).filter(Boolean).join(' / ');
      pushLine('验证', checks);
    }
  } else {
    pushLine('摘要', asText(metadata.content));
  }

  if (error) {
    pushLine('失败原因', error);
  }

  if (lines.length === 1) {
    pushLine('摘要', formatConversationManagedToolSummary(toolName, metadata));
  }

  return lines.join('\n');
}

function getConversationReplayToolStatusLabel(status: string): string {
  const normalized = status.trim().toLowerCase();
  if (normalized === 'failed' || normalized === 'error') return '失败';
  if (normalized === 'completed' || normalized === 'success') return '已完成';
  if (normalized === 'pending') return '等待中';
  if (normalized === 'running') return '进行中';
  return '执行中';
}

function buildConversationManagedToolItem(message: ConversationMessage): ConversationReplayItem | null {
  const metadata = toRecord(message.metadata);
  const eventType = (messageEventType(message) || '').toLowerCase();
  if (!['tool_call_started', 'tool_call_progress', 'tool_call_completed', 'tool_call_failed'].includes(eventType)) {
    return null;
  }
  const toolName = messageToolName(message) || 'tool';
  const runId = messageRunId(message) || 'unknown-run';
  const toolCallId = metadataString(metadata, 'toolCallId') || conversationMessageKey(message);
  const status: ConversationReplayToolStatus =
    eventType === 'tool_call_failed'
      ? 'failed'
      : eventType === 'tool_call_completed'
        ? 'completed'
        : eventType === 'tool_call_started' || eventType === 'tool_call_progress'
          ? 'running'
          : 'unknown';
  return {
    id: message.id,
    kind: 'managed_tool',
    timestamp: message.createdAt,
    runId,
    toolCallId,
    eventType,
    toolName,
    status,
    summary: formatConversationManagedToolSummary(toolName, metadata),
    preview: formatConversationManagedToolPreview(toolName, metadata),
    detail: formatConversationManagedToolDetail(toolName, metadata),
    artifactPaths: collectConversationReplayArtifactPaths(toolName, metadata),
    expandWrite: shouldExpandConversationManagedWriteFileCard(toolName, status, metadata),
    messageKey: conversationMessageKey(message),
  };
}

function buildConversationOpencodeToolCard(input: {
  message: ConversationMessage;
  eventType: string;
  toolName: string;
  properties: Record<string, unknown>;
  part: Record<string, unknown>;
  content: string;
  metadata: Record<string, unknown>;
}): ConversationReplayItem {
  const { message, eventType, toolName, properties, part, content, metadata } = input;
  const toolState = toRecord(part.state);
  const rawInput = toolState.input ?? part.input;
  const toolInput =
    typeof rawInput === 'string' && rawInput.trim()
      ? { command: rawInput }
      : toRecord(rawInput);
  const toolKey = toolName.toLowerCase();
  const filePath =
    asText(toolInput.filePath) ||
    asText(toolInput.path) ||
    asText(properties.file) ||
    asText(properties.path);
  const commandText =
    asText(toolInput.command) ||
    asText(toolInput.cmd) ||
    asText(properties.command) ||
    asText(properties.cmd);
  const outputText =
    asText(toolState.output) ||
    asText(properties.output) ||
    asText(properties.stdout) ||
    asText(metadata.outputPreview) ||
    content;
  const errorText = asText(toolState.error) || asText(properties.error) || asText(metadata.error);
  const statusText =
    asText(toolState.status) ||
    asText(properties.status) ||
    (errorText ? 'failed' : commandText || outputText ? 'completed' : '');
  const statusLabel = statusText ? getConversationReplayToolStatusLabel(statusText) : undefined;

  if (eventType === 'command.executed' || toolKey === 'bash') {
    const commandCard = getConversationReplayCommandCard(commandText);
    return {
      id: message.id,
      kind: 'opencode_tool',
      timestamp: message.createdAt,
      variant: 'card',
      iconLabel: commandCard.iconLabel,
      title: commandCard.title,
      subtitle: statusLabel,
      statusLabel,
      tone: errorText ? 'error' : statusLabel === '完成' ? 'success' : 'default',
      command: commandText,
      preview: truncateConversationReplayText(outputText, 900).text,
      previewMode: 'code',
      detail: [commandText ? `命令: ${commandText}` : '', outputText ? `输出: ${truncateConversationReplayText(outputText, 1800).text}` : '']
        .filter(Boolean)
        .join('\n'),
      messageKey: conversationMessageKey(message),
    };
  }

  if (toolKey === 'write' || toolKey === 'edit') {
    const title = toolKey === 'write' ? '写入文件' : '编辑文件';
    return {
      id: message.id,
      kind: 'opencode_tool',
      timestamp: message.createdAt,
      variant: 'chip',
      iconLabel: toolKey === 'write' ? '写' : '改',
      title,
      subtitle: getConversationReplayFilename(filePath) || '文件',
      statusLabel,
      tone: errorText ? 'error' : 'default',
      preview: filePath || undefined,
      previewMode: 'plain',
      detail: filePath ? `目标文件: ${filePath}` : undefined,
      messageKey: conversationMessageKey(message),
    };
  }

  if (toolKey === 'read') {
    return {
      id: message.id,
      kind: 'opencode_tool',
      timestamp: message.createdAt,
      variant: 'chip',
      iconLabel: '读',
      title: '读取文件',
      subtitle: getConversationReplayFilename(filePath) || '文件',
      statusLabel,
      preview: filePath || undefined,
      previewMode: 'plain',
      detail: filePath ? `目标文件: ${filePath}` : undefined,
      messageKey: conversationMessageKey(message),
    };
  }

  if (toolKey === 'list') {
    return {
      id: message.id,
      kind: 'opencode_tool',
      timestamp: message.createdAt,
      variant: 'chip',
      iconLabel: '列',
      title: '列出目录',
      subtitle: filePath || '/',
      statusLabel,
      preview: filePath || undefined,
      previewMode: 'plain',
      detail: filePath ? `目标目录: ${filePath}` : undefined,
      messageKey: conversationMessageKey(message),
    };
  }

  if (toolKey === 'grep' || toolKey === 'glob' || toolKey === 'search_code') {
    const pattern = asText(toolInput.pattern) || asText(toolInput.query) || asText(properties.pattern);
    return {
      id: message.id,
      kind: 'opencode_tool',
      timestamp: message.createdAt,
      variant: 'chip',
      iconLabel: '搜',
      title: toolKey === 'glob' ? '匹配文件' : '代码搜索',
      subtitle: pattern || getConversationReplayFilename(filePath) || '搜索',
      statusLabel,
      preview: filePath || undefined,
      previewMode: 'plain',
      detail: [pattern ? `搜索模式: ${pattern}` : '', filePath ? `范围: ${filePath}` : ''].filter(Boolean).join('\n') || undefined,
      messageKey: conversationMessageKey(message),
    };
  }

  if (toolKey === 'question') {
    const question = asText(toolInput.question) || content || '待确认';
    const options = Array.isArray((toolInput as { options?: unknown[] }).options)
      ? ((toolInput as { options?: unknown[] }).options || []).map((item) => asText(item)).filter(Boolean)
      : [];
    return {
      id: message.id,
      kind: 'opencode_tool',
      timestamp: message.createdAt,
      variant: 'card',
      iconLabel: '问',
      title: '待确认',
      subtitle: statusLabel,
      statusLabel,
      tone: 'default',
      preview: [question, options.length ? options.map((option) => `- ${option}`).join('\n') : ''].filter(Boolean).join('\n\n'),
      previewMode: 'plain',
      detail: question,
      messageKey: conversationMessageKey(message),
    };
  }

  if (toolKey === 'todowrite') {
    return {
      id: message.id,
      kind: 'opencode_tool',
      timestamp: message.createdAt,
      variant: 'card',
      iconLabel: '待',
      title: '待办',
      subtitle: statusLabel,
      statusLabel,
      tone: 'default',
      preview: truncateConversationReplayText(outputText || content, 800).text || '已更新待办列表',
      previewMode: 'plain',
      detail: truncateConversationReplayText(outputText || content, 1600).text || undefined,
      messageKey: conversationMessageKey(message),
    };
  }

  if (eventType === 'file.changed' || eventType.startsWith('file.') || toolKey === 'apply_patch') {
    const files = Array.isArray((properties as { files?: unknown[] }).files)
      ? ((properties as { files?: unknown[] }).files || [])
          .map((item) => toRecord(item))
          .map((item) => ({
            kind: asText(item.kind) || asText(item.status),
            path: asText(item.path) || asText(item.file),
          }))
          .filter((item) => item.path)
      : [];
    const primary = files[0];
    const primaryPath = primary?.path || filePath;
    const label =
      asText(properties.label) ||
      (primary?.kind ? conversationReplayMapFileChangeLabel(primary.kind) : toolKey === 'apply_patch' ? '应用补丁' : '文件变更');
    const detail =
      files.length > 0
        ? files
            .slice(0, 6)
            .map((item) => `${conversationReplayMapFileChangeLabel(item.kind)}: ${item.path}`)
            .join('\n')
        : primaryPath
          ? `目标文件: ${primaryPath}`
          : '';
    return {
      id: message.id,
      kind: 'opencode_tool',
      timestamp: message.createdAt,
      variant: 'chip',
      iconLabel: toolKey === 'apply_patch' ? '补' : '文',
      title: label,
      subtitle:
        files.length > 1
          ? `${files.length} 个文件`
          : getConversationReplayFilename(primaryPath) || getConversationReplayFilename(filePath) || '文件',
      statusLabel,
      tone: errorText ? 'error' : 'default',
      preview: detail || undefined,
      previewMode: 'plain',
      detail: detail || undefined,
      messageKey: conversationMessageKey(message),
    };
  }

  return {
    id: message.id,
    kind: 'opencode_tool',
    timestamp: message.createdAt,
    variant: 'chip',
    iconLabel: toolKey ? toolKey.slice(0, 1).toUpperCase() : '工',
    title: toolName || eventType || '工具调用',
    subtitle: summarizeText(outputText || content, 48) || statusLabel,
    statusLabel,
    tone: errorText ? 'error' : 'default',
    preview: outputText ? truncateConversationReplayText(outputText, 800).text : undefined,
    previewMode: 'plain',
    detail: outputText ? truncateConversationReplayText(outputText, 1600).text : undefined,
    messageKey: conversationMessageKey(message),
  };
}

function conversationReplayMessageText(message: ConversationMessage): string {
  const direct = typeof message.content === 'string' ? message.content.trim() : '';
  if (direct) {
    return direct;
  }
  if (String(message.messageType || '') === 'clarification_request') {
    return clarificationQuestion(message);
  }
  const metadata = toRecord(message.metadata);
  const question = metadataString(metadata, 'question');
  if (question) {
    return question;
  }
  const outputPreview = metadataString(metadata, 'outputPreview');
  if (outputPreview) {
    return summarizeText(outputPreview, 600);
  }
  return messageContentPreview(message, 220);
}

function conversationReplayAuthor(message: ConversationMessage): string {
  const metadata = toRecord(message.metadata);
  const executor = messageExecutor(message);
  const agent = metadataString(metadata, 'agent');
  if (executor) {
    return executorLabel(executor);
  }
  if (agent) {
    return conversationAgentLabel(agent);
  }
  if (
    String(message.messageType || '') === 'assistant_message' ||
    String(message.role || '') === 'assistant'
  ) {
    return 'Altus';
  }
  return conversationRoleLabel(message.role);
}

function conversationReplayNoticeText(message: ConversationMessage): string {
  const direct = typeof message.content === 'string' ? message.content.trim() : '';
  if (direct) {
    return direct;
  }
  const metadata = toRecord(message.metadata);
  const stage = metadataString(metadata, 'stage');
  const eventType = messageEventType(message);
  const parts = [
    conversationMessageTypeLabel(message.messageType),
    stage ? conversationStageLabel(stage) : '',
    eventType ? eventType : '',
  ].filter(Boolean);
  return parts.join(' · ') || '会话状态已更新';
}

function buildConversationReplayItems(messages: ConversationMessage[]): ConversationReplayItem[] {
  const items: ConversationReplayItem[] = [];

  const pushAgentPlain = (message: ConversationMessage, text: string, author: string, options: string[] = []) => {
    const normalized = normalizeConversationReplayText(text);
    if (!normalized) return;
    const last = items[items.length - 1];
    if (last?.kind === 'agent_plain' && normalizeConversationReplayText(last.text) === normalized && last.author === author) {
      return;
    }
    items.push({
      id: message.id,
      kind: 'agent_plain',
      text,
      timestamp: message.createdAt,
      author,
      options,
      messageKey: conversationMessageKey(message),
    });
  };

  const pushCapsule = (message: ConversationMessage, label: string, segments?: string[]) => {
    const text = label.trim();
    if (!text) return;
    items.push({
      id: message.id,
      kind: 'capsule',
      label: text,
      timestamp: message.createdAt,
      tone: conversationReplayCapsuleTone(message, text),
      loading: isConversationProgressStatusLabel(text),
      segments,
      messageKey: conversationMessageKey(message),
    });
  };

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    const type = String(message.messageType || '');
    if (type === 'user_input' || type === 'user_response') {
      items.push({
        id: message.id,
        kind: 'user',
        text: conversationReplayMessageText(message),
        timestamp: message.createdAt,
        messageKey: conversationMessageKey(message),
      });
      continue;
    }

    if (type === 'assistant_message' || type === 'agent_message') {
      const text = conversationReplayMessageText(message);
      const capsule = extractConversationReplayCapsule(text);
      if (capsule) {
        if (isConversationProgressStatusLabel(capsule.label) && !capsule.rest.trim()) {
          pushCapsule(message, capsule.label);
          continue;
        }
        pushCapsule(message, capsule.label);
        if (capsule.rest.trim()) {
          pushAgentPlain(message, capsule.rest, conversationReplayAuthor(message));
        }
        continue;
      }
      pushAgentPlain(message, text, conversationReplayAuthor(message));
      continue;
    }

    if (type === 'clarification_request') {
      const question = clarificationQuestion(message);
      const options = clarificationOptions(message);
      const previousMessage = index > 0 ? messages[index - 1] : null;
      const previousContent =
        previousMessage && ['assistant_message', 'agent_message'].includes(String(previousMessage.messageType || ''))
          ? conversationReplayMessageText(previousMessage)
          : '';
      const currentRunId = messageRunId(message);
      const previousRunId = previousMessage ? messageRunId(previousMessage) : null;
      const sameRun = !currentRunId || !previousRunId || currentRunId === previousRunId;

      if (
        previousContent &&
        sameRun &&
        normalizeConversationClarificationText(previousContent) === normalizeConversationClarificationText(question)
      ) {
        items.push({
          id: message.id,
          kind: 'clarification_notice',
          text: 'Altus 将在你回复后继续工作',
          timestamp: message.createdAt,
          messageKey: conversationMessageKey(message),
        });
        continue;
      }

      pushAgentPlain(message, question, conversationReplayAuthor(message), options);
      items.push({
        id: `${message.id}:notice`,
        kind: 'clarification_notice',
        text: 'Altus 将在你回复后继续工作',
        timestamp: message.createdAt,
        messageKey: conversationMessageKey(message),
      });
      continue;
    }

    if (type === 'status_update' || type === 'session_started') {
      const output = messageOutputPreviewRecord(message);
      const label = conversationReplayNoticeText(message);
      const segments =
        messageEventType(message) === 'deliverables_ready' && Array.isArray(output?.deliverables)
          ? ['完成任务', '已完成', '对话已结束。']
          : undefined;
      pushCapsule(message, label, segments);
      continue;
    }

    if (type === 'executor_event') {
      if (isManagedConversationExecutionEvent(message)) {
        const managedToolItem = buildConversationManagedToolItem(message);
        if (managedToolItem) {
          items.push(managedToolItem);
          continue;
        }
      }

      const metadata = toRecord(message.metadata);
      const eventType = asText(metadata.eventType).toLowerCase();
      const eventInfo = getConversationReplayOpencodeEventInfo(metadata);
      const item = toRecord(toRecord(metadata.event).item);
      const itemType = (asText(metadata.itemType) || asText(item.type)).toLowerCase();
      const content =
        asText(item.text) ||
        asText(item.content) ||
        asText(item.message) ||
        conversationReplayMessageText(message);
      const executorName = messageExecutor(message) ? executorLabel(messageExecutor(message) || '') : conversationReplayAuthor(message);

      if (eventType === 'turn.started') {
        pushCapsule(message, `${executorName} 开始执行`);
        continue;
      }

      if (eventType === 'turn.completed') {
        pushCapsule(message, `${executorName} 执行完成`);
        continue;
      }

      if (eventType === 'turn.failed' || eventType === 'turn.interrupted') {
        pushCapsule(message, content || `${executorName} 执行失败`);
        continue;
      }

      if (eventType === 'turn/plan/updated' && content) {
        pushAgentPlain(message, content, executorName);
        continue;
      }

      if (eventType === 'stderr.line' || eventType === 'stdout.line' || eventType === 'item/filechange/outputdelta') {
        continue;
      }

      if (itemType === 'approval_request' || itemType === 'approvalrequest') {
        pushCapsule(message, '需要授权');
        pushAgentPlain(message, content || `${executorName} 需要进一步授权后才能继续执行。`, executorName);
        continue;
      }

      if (itemType === 'command_execution' || itemType === 'commandexecution') {
        const commandText = asText(metadata.command) || asText(item.command);
        items.push(
          buildConversationOpencodeToolCard({
            message,
            eventType: 'command.executed',
            toolName: 'bash',
            properties: {
              command: commandText,
              stdout: asText(metadata.outputPreview) || asText(item.aggregated_output),
              status: asText(metadata.itemStatus) || asText(item.status),
            },
            part: {},
            content,
            metadata,
          }),
        );
        continue;
      }

      if (itemType === 'file_change' || itemType === 'filechange' || itemType === 'diff' || eventType === 'turn/diff/updated') {
        const files = Array.isArray((metadata as { fileChanges?: unknown[] }).fileChanges)
          ? ((metadata as { fileChanges?: unknown[] }).fileChanges || [])
              .map((entry) => toRecord(entry))
              .map((entry) => ({
                kind: asText(entry.kind),
                path: asText(entry.path) || asText(entry.file),
              }))
              .filter((entry) => entry.path)
          : [];
        items.push(
          buildConversationOpencodeToolCard({
            message,
            eventType: 'file.changed',
            toolName: asText(eventInfo.toolName) || 'apply_patch',
            properties: {
              label: files[0]?.kind ? conversationReplayMapFileChangeLabel(files[0].kind) : '文件变更',
              files,
              file: files[0]?.path || '',
              path: files[0]?.path || '',
              status: asText(metadata.itemStatus) || asText(item.status) || 'completed',
            },
            part: {},
            content,
            metadata,
          }),
        );
        continue;
      }

      if (
        eventInfo.partType === 'tool' ||
        eventInfo.eventType.startsWith('file.') ||
        eventInfo.eventType.startsWith('pty.') ||
        eventInfo.eventType === 'command.executed' ||
        content.startsWith('[Tool]')
      ) {
        items.push(
          buildConversationOpencodeToolCard({
            message,
            eventType: eventInfo.eventType,
            toolName: eventInfo.toolName,
            properties: eventInfo.properties,
            part: eventInfo.part,
            content,
            metadata,
          }),
        );
        continue;
      }

      if (content) {
        pushAgentPlain(message, content, executorName);
      }
      continue;
    }

    if (type === 'opencode_event') {
      const metadata = toRecord(message.metadata);
      const eventInfo = getConversationReplayOpencodeEventInfo(metadata);
      const content = conversationReplayMessageText(message);
      const normalizedContent = normalizeConversationReplayText(content);

      if (eventInfo.eventType === 'message.final') {
        if (!normalizedContent) continue;
        pushAgentPlain(message, content, 'OpenCode');
        continue;
      }

      if (eventInfo.partType === 'text') {
        if (!normalizedContent) continue;
        pushAgentPlain(message, content, 'OpenCode');
        continue;
      }

      if (
        eventInfo.partType === 'tool' ||
        eventInfo.eventType.startsWith('file.') ||
        eventInfo.eventType.startsWith('pty.') ||
        eventInfo.eventType === 'command.executed' ||
        content.startsWith('[Tool]')
      ) {
        items.push(
          buildConversationOpencodeToolCard({
            message,
            eventType: eventInfo.eventType,
            toolName: eventInfo.toolName,
            properties: eventInfo.properties,
            part: eventInfo.part,
            content,
            metadata,
          }),
        );
      }
      continue;
    }

    if (type === 'error' || type === 'opencode_error') {
      items.push({
        id: message.id,
        kind: 'error',
        text: conversationReplayMessageText(message),
        timestamp: message.createdAt,
        author: conversationReplayAuthor(message),
        messageKey: conversationMessageKey(message),
      });
    }
  }

  let previousAuthor = '';
  for (const item of items) {
    if (item.kind === 'agent_plain' || item.kind === 'error') {
      item.showAuthor = item.author !== previousAuthor;
      previousAuthor = item.author;
      continue;
    }
    if (item.kind === 'capsule') {
      continue;
    }
    previousAuthor = '';
  }

  return items;
}

function formatStateSnapshot(snapshot?: { status?: string; stage?: string; phase?: string }) {
  const status = statusLabel(snapshot?.status || '-');
  const stage = conversationStageLabel(snapshot?.stage);
  const phase = conversationPhaseLabel(snapshot?.phase);
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

function auditActionLabel(action?: string | null) {
  if (action === 'start') return '启动';
  if (action === 'stop') return '停止';
  if (action === 'shutdown') return '关机';
  if (action === 'reboot') return '重启';
  if (action === 'resume') return '恢复';
  if (action === 'suspend') return '暂停';
  return action || '-';
}

function auditResultLabel(result?: string | null) {
  if (result === 'success') return '成功';
  if (result === 'failed') return '失败';
  return result || '-';
}

function templateIdOf(template?: E2bTemplate | E2bTemplateWithBuilds | null) {
  if (!template) return '';
  return ((template as any).templateID ?? (template as any).templateId ?? '') as string;
}

function templateAliasOf(template?: E2bTemplate | E2bTemplateWithBuilds | null) {
  if (!template) return '';
  return String((template as any).alias ?? '').trim();
}

function parseAliasCheckResult(result: unknown) {
  const record = asRecord(result);
  if (!record) {
    return {
      state: 'unknown' as const,
      message: '返回结果无法识别',
      targetTemplateId: null,
    };
  }

  const availableValue = record.available ?? record.isAvailable ?? record.valid ?? record.ok;
  const targetTemplateId =
    typeof record.templateId === 'string'
      ? record.templateId
      : typeof record.templateID === 'string'
        ? record.templateID
        : null;

  if (availableValue === true || record.exists === false) {
    return {
      state: 'available' as const,
      message: '该别名当前可用',
      targetTemplateId,
    };
  }

  if (availableValue === false || record.exists === true || targetTemplateId || record.alias || record.name) {
    return {
      state: 'occupied' as const,
      message: '该别名已被占用',
      targetTemplateId,
    };
  }

  return {
    state: 'unknown' as const,
    message: '已返回结果，但无法明确判断是否可用',
    targetTemplateId,
  };
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

const DEFAULT_AUDIT_FILTERS: AuditFilterState = {
  query: '',
  operator: 'all',
  action: 'all',
  result: 'all',
  from: '',
  to: '',
};

type AdminUrlState = {
  activeSection: SectionKey;
  deployment: DeploymentManagementViewState;
  conversation: {
    query: string;
    status: 'all' | 'in_progress' | 'waiting_user' | 'failed' | 'completed';
    stage: string;
    user: string;
    executor: string;
    updatedFrom: string;
    updatedTo: string;
    selectedSessionId: string | null;
  };
  sandbox: {
    tab: 'runtime';
    query: string;
    executor: string;
    status: string;
    risk: string;
    selectedSandboxId: string | null;
    detailTab: SandboxDetailTab;
  };
  user: UserManagementViewState;
  skill: SkillManagementViewState;
  connectorGuide: ConnectorGuideManagementViewState;
  osacRelease: OsacReleaseManagementViewState;
  audit: AuditFilterState;
};

const ADMIN_URL_QUERY_KEYS = [
  'section',
  'dep_view',
  'dep_q',
  'dep_status',
  'dep_has_url',
  'dep_user',
  'dep_session',
  'dep_detail',
  'dep_tab',
  'conv_q',
  'conv_status',
  'conv_stage',
  'conv_user',
  'conv_exec',
  'conv_from',
  'conv_to',
  'conv_session',
  'sbx_tab',
  'sbx_q',
  'sbx_exec',
  'sbx_status',
  'sbx_risk',
  'sbx_id',
  'sbx_detail_tab',
  'user_q',
  'user_status',
  'user_activity',
  'user_session',
  'user_conv',
  'user_sort',
  'user_dir',
  'user_id',
  'user_tab',
  'skill_q',
  'skill_status',
  'skill_category',
  'skill_view',
  'skill_id',
  'skill_dialog',
  'skill_tab',
  'skill_rev',
  'guide_connector',
  'guide_status',
  'guide_q',
  'guide_id',
  'guide_rev',
  'osac_tab',
  'osac_q',
  'osac_id',
  'osac_dialog',
  'audit_q',
  'audit_operator',
  'audit_action',
  'audit_result',
  'audit_session',
  'audit_target',
  'audit_from',
  'audit_to',
] as const;

const USER_DETAIL_TAB_VALUES = new Set(['overview', 'conversations', 'sandboxes', 'deployments']);
const DEPLOYMENT_VIEW_VALUES = new Set(['records', 'conversations', 'users', 'railway']);
const DEPLOYMENT_DETAIL_TAB_VALUES = new Set(['overview', 'history', 'logs', 'relations', 'raw']);
const SANDBOX_TAB_VALUES = new Set(['runtime']);
const SANDBOX_DETAIL_TAB_VALUES = new Set(['overview', 'files', 'processes', 'connectivity', 'archive', 'terminal']);
const USER_SORT_KEY_VALUES = new Set(['user', 'status', 'last_activity', 'sessions', 'conversations', 'sandboxes']);
const USER_SORT_DIRECTION_VALUES = new Set(['asc', 'desc']);
const SKILL_VIEW_VALUES = new Set(['all', 'active', 'archived', 'published', 'unpublished']);
const SKILL_DETAIL_TAB_VALUES = new Set(['editor', 'resources', 'validation']);
const OSAC_TAB_VALUES = new Set(['published', 'pending', 'all', 'upload']);

function isSectionKey(value: string | null): value is SectionKey {
  return value === 'kvm'
    || value === 'deployment'
    || value === 'conversation'
    || value === 'user'
    || value === 'agent'
    || value === 'skill'
    || value === 'connectorGuide'
    || value === 'osacRelease'
    || value === 'sandbox'
    || value === 'audit'
    || value === 'billing';
}

function cloneDeploymentManagementViewState(
  state: DeploymentManagementViewState = DEFAULT_DEPLOYMENT_MANAGEMENT_VIEW_STATE
): DeploymentManagementViewState {
  return {
    view: state.view,
    filters: { ...state.filters },
    selectedTaskSessionId: state.selectedTaskSessionId,
    detailDialogOpen: state.detailDialogOpen,
    detailTab: state.detailTab,
  };
}

function cloneUserManagementViewState(state: UserManagementViewState = DEFAULT_USER_MANAGEMENT_VIEW_STATE): UserManagementViewState {
  return {
    filters: { ...state.filters },
    sort: { ...state.sort },
    selectedUserId: state.selectedUserId,
    selectedUserLabel: state.selectedUserLabel,
    drawerOpen: state.drawerOpen,
    detailTab: state.detailTab,
  };
}

function cloneSkillManagementViewState(
  state: SkillManagementViewState = DEFAULT_SKILL_MANAGEMENT_VIEW_STATE
): SkillManagementViewState {
  return {
    filters: { ...state.filters },
    skillView: state.skillView,
    selectedSkillId: state.selectedSkillId,
    detailDialogOpen: state.detailDialogOpen,
    detailTab: state.detailTab,
    selectedRevisionId: state.selectedRevisionId,
    selectedResourcePath: state.selectedResourcePath,
  };
}

function cloneConnectorGuideManagementViewState(
  state: ConnectorGuideManagementViewState = DEFAULT_CONNECTOR_GUIDE_MANAGEMENT_VIEW_STATE
): ConnectorGuideManagementViewState {
  return {
    filters: { ...state.filters },
    selectedPolicyId: state.selectedPolicyId,
    selectedRevisionId: state.selectedRevisionId,
  };
}

function cloneOsacReleaseManagementViewState(
  state: OsacReleaseManagementViewState = DEFAULT_OSAC_RELEASE_MANAGEMENT_VIEW_STATE
): OsacReleaseManagementViewState {
  return {
    tab: state.tab,
    query: state.query,
    selectedReleaseId: state.selectedReleaseId,
    detailDialogOpen: state.detailDialogOpen,
  };
}

function readAdminUrlState(): AdminUrlState {
  const deploymentState = cloneDeploymentManagementViewState();
  const userState = cloneUserManagementViewState();
  const skillState = cloneSkillManagementViewState();
  const connectorGuideState = cloneConnectorGuideManagementViewState();
  const osacReleaseState = cloneOsacReleaseManagementViewState();
  const auditState = { ...DEFAULT_AUDIT_FILTERS };

  if (typeof window === 'undefined') {
    return {
      activeSection: 'sandbox',
      deployment: deploymentState,
      conversation: {
        query: '',
        status: 'all',
        stage: 'all',
        user: 'all',
        executor: 'all',
        updatedFrom: '',
        updatedTo: '',
        selectedSessionId: null,
      },
      sandbox: {
        tab: 'runtime',
        query: '',
        executor: 'all',
        status: 'all',
        risk: 'all',
        selectedSandboxId: null,
        detailTab: 'overview',
      },
      user: userState,
      skill: skillState,
      connectorGuide: connectorGuideState,
      osacRelease: osacReleaseState,
      audit: auditState,
    };
  }

  const params = new URLSearchParams(window.location.search);
  const sectionParam = params.get('section');
  const activeSection = isSectionKey(sectionParam) ? sectionParam : 'sandbox';
  const conversationStatus = params.get('conv_status');
  const deploymentView = params.get('dep_view');
  const deploymentDetailTab = params.get('dep_tab');
  const sandboxTab = params.get('sbx_tab');
  const sandboxDetailTab = params.get('sbx_detail_tab');
  const userSortKey = params.get('user_sort');
  const userSortDirection = params.get('user_dir');
  const userDetailTab = params.get('user_tab');
  const skillView = params.get('skill_view');
  const skillDetailTab = params.get('skill_tab');
  const osacTab = params.get('osac_tab');

  deploymentState.view = DEPLOYMENT_VIEW_VALUES.has(deploymentView || '')
    ? (deploymentView as DeploymentManagementViewState['view'])
    : DEFAULT_DEPLOYMENT_MANAGEMENT_VIEW_STATE.view;
  deploymentState.filters = {
    query: params.get('dep_q') || '',
    status: params.get('dep_status') || 'all',
    hasUrl: params.get('dep_has_url') || 'all',
    userId: params.get('dep_user') || '',
    taskSessionId: params.get('dep_session') || '',
  };
  deploymentState.selectedTaskSessionId = params.get('dep_detail') || null;
  deploymentState.detailDialogOpen = params.get('dep_detail') !== null;
  deploymentState.detailTab = DEPLOYMENT_DETAIL_TAB_VALUES.has(deploymentDetailTab || '')
    ? (deploymentDetailTab as DeploymentManagementViewState['detailTab'])
    : DEFAULT_DEPLOYMENT_MANAGEMENT_VIEW_STATE.detailTab;

  userState.filters = {
    query: params.get('user_q') || '',
    status: params.get('user_status') || 'all',
    activity: params.get('user_activity') || 'all',
    hasSession: params.get('user_session') || 'all',
    hasConversation: params.get('user_conv') || 'all',
  };
  userState.sort = {
    key: USER_SORT_KEY_VALUES.has(userSortKey || '') ? (userSortKey as UserManagementViewState['sort']['key']) : DEFAULT_USER_MANAGEMENT_VIEW_STATE.sort.key,
    direction: USER_SORT_DIRECTION_VALUES.has(userSortDirection || '') ? (userSortDirection as UserManagementViewState['sort']['direction']) : DEFAULT_USER_MANAGEMENT_VIEW_STATE.sort.direction,
  };
  userState.selectedUserId = params.get('user_id') || null;
  userState.selectedUserLabel = null;
  userState.drawerOpen = Boolean(userState.selectedUserId);
  userState.detailTab = USER_DETAIL_TAB_VALUES.has(userDetailTab || '')
    ? (userDetailTab as UserManagementViewState['detailTab'])
    : DEFAULT_USER_MANAGEMENT_VIEW_STATE.detailTab;

  skillState.filters = {
    query: params.get('skill_q') || '',
    status: params.get('skill_status') || 'all',
    category: params.get('skill_category') || '',
  };
  skillState.skillView = SKILL_VIEW_VALUES.has(skillView || '')
    ? (skillView as SkillManagementViewState['skillView'])
    : DEFAULT_SKILL_MANAGEMENT_VIEW_STATE.skillView;
  skillState.selectedSkillId = params.get('skill_id') || null;
  skillState.detailDialogOpen = params.get('skill_dialog') === '1' && Boolean(skillState.selectedSkillId);
  skillState.detailTab = SKILL_DETAIL_TAB_VALUES.has(skillDetailTab || '')
    ? (skillDetailTab as SkillManagementViewState['detailTab'])
    : DEFAULT_SKILL_MANAGEMENT_VIEW_STATE.detailTab;
  skillState.selectedRevisionId = params.get('skill_rev') || null;

  connectorGuideState.filters = {
    connectorKey: params.get('guide_connector') || '',
    status: params.get('guide_status') || 'all',
    query: params.get('guide_q') || '',
  };
  connectorGuideState.selectedPolicyId = params.get('guide_id') || null;
  connectorGuideState.selectedRevisionId = params.get('guide_rev') || null;

  osacReleaseState.tab = OSAC_TAB_VALUES.has(osacTab || '')
    ? (osacTab as OsacReleaseManagementViewState['tab'])
    : DEFAULT_OSAC_RELEASE_MANAGEMENT_VIEW_STATE.tab;
  osacReleaseState.query = params.get('osac_q') || '';
  osacReleaseState.selectedReleaseId = params.get('osac_id') || null;
  osacReleaseState.detailDialogOpen = params.get('osac_dialog') === '1' && Boolean(osacReleaseState.selectedReleaseId);

  auditState.query = params.get('audit_q') || '';
  auditState.operator = params.get('audit_operator') || 'all';
  auditState.action = params.get('audit_action') || 'all';
  auditState.result = params.get('audit_result') || 'all';
  auditState.from = params.get('audit_from') || '';
  auditState.to = params.get('audit_to') || '';

  return {
    activeSection,
    deployment: deploymentState,
    conversation: {
      query: params.get('conv_q') || '',
      status:
        conversationStatus === 'in_progress'
        || conversationStatus === 'waiting_user'
        || conversationStatus === 'failed'
        || conversationStatus === 'completed'
          ? conversationStatus
          : 'all',
      stage: params.get('conv_stage') || 'all',
      user: params.get('conv_user') || 'all',
      executor: params.get('conv_exec') || 'all',
      updatedFrom: params.get('conv_from') || '',
      updatedTo: params.get('conv_to') || '',
      selectedSessionId: params.get('conv_session') || null,
    },
    sandbox: {
      tab: SANDBOX_TAB_VALUES.has(sandboxTab || '') ? (sandboxTab as AdminUrlState['sandbox']['tab']) : 'runtime',
      query: params.get('sbx_q') || '',
      executor: params.get('sbx_exec') || 'all',
      status: params.get('sbx_status') || 'all',
      risk: params.get('sbx_risk') || 'all',
      selectedSandboxId: params.get('sbx_id') || null,
      detailTab: SANDBOX_DETAIL_TAB_VALUES.has(sandboxDetailTab || '')
        ? (sandboxDetailTab as SandboxDetailTab)
        : 'overview',
    },
    user: userState,
    skill: skillState,
    connectorGuide: connectorGuideState,
    osacRelease: osacReleaseState,
    audit: auditState,
  };
}

function writeAdminUrlState(input: {
  activeSection: SectionKey;
  deployment: DeploymentManagementViewState;
  conversation: AdminUrlState['conversation'];
  sandbox: AdminUrlState['sandbox'] & { modalOpen: boolean };
  user: UserManagementViewState;
  skill: SkillManagementViewState;
  connectorGuide: ConnectorGuideManagementViewState;
  osacRelease: OsacReleaseManagementViewState;
  audit: AuditFilterState;
}) {
  if (typeof window === 'undefined') return;

  const url = new URL(window.location.href);
  for (const key of ADMIN_URL_QUERY_KEYS) {
    url.searchParams.delete(key);
  }

  url.searchParams.set('section', input.activeSection);

  if (input.activeSection === 'deployment') {
    if (input.deployment.view !== DEFAULT_DEPLOYMENT_MANAGEMENT_VIEW_STATE.view) {
      url.searchParams.set('dep_view', input.deployment.view);
    }
    if (input.deployment.filters.query) url.searchParams.set('dep_q', input.deployment.filters.query);
    if (input.deployment.filters.status !== 'all') url.searchParams.set('dep_status', input.deployment.filters.status);
    if (input.deployment.filters.hasUrl !== 'all') url.searchParams.set('dep_has_url', input.deployment.filters.hasUrl);
    if (input.deployment.filters.userId) url.searchParams.set('dep_user', input.deployment.filters.userId);
    if (input.deployment.filters.taskSessionId) url.searchParams.set('dep_session', input.deployment.filters.taskSessionId);
    if (input.deployment.detailDialogOpen && input.deployment.selectedTaskSessionId) {
      url.searchParams.set('dep_detail', input.deployment.selectedTaskSessionId);
      if (input.deployment.detailTab !== DEFAULT_DEPLOYMENT_MANAGEMENT_VIEW_STATE.detailTab) {
        url.searchParams.set('dep_tab', input.deployment.detailTab);
      }
    }
  }

  if (input.activeSection === 'conversation') {
    if (input.conversation.query) url.searchParams.set('conv_q', input.conversation.query);
    if (input.conversation.status !== 'all') url.searchParams.set('conv_status', input.conversation.status);
    if (input.conversation.stage !== 'all') url.searchParams.set('conv_stage', input.conversation.stage);
    if (input.conversation.user !== 'all') url.searchParams.set('conv_user', input.conversation.user);
    if (input.conversation.executor !== 'all') url.searchParams.set('conv_exec', input.conversation.executor);
    if (input.conversation.updatedFrom) url.searchParams.set('conv_from', input.conversation.updatedFrom);
    if (input.conversation.updatedTo) url.searchParams.set('conv_to', input.conversation.updatedTo);
    if (input.conversation.selectedSessionId) url.searchParams.set('conv_session', input.conversation.selectedSessionId);
  }

  if (input.activeSection === 'sandbox') {
    if (input.sandbox.query) url.searchParams.set('sbx_q', input.sandbox.query);
    if (input.sandbox.executor !== 'all') url.searchParams.set('sbx_exec', input.sandbox.executor);
    if (input.sandbox.status !== 'all') url.searchParams.set('sbx_status', input.sandbox.status);
    if (input.sandbox.risk !== 'all') url.searchParams.set('sbx_risk', input.sandbox.risk);
    if (input.sandbox.modalOpen && input.sandbox.selectedSandboxId) {
      url.searchParams.set('sbx_id', input.sandbox.selectedSandboxId);
      if (input.sandbox.detailTab !== 'overview') {
        url.searchParams.set('sbx_detail_tab', input.sandbox.detailTab);
      }
    }
  }

  if (input.activeSection === 'user') {
    const filters = input.user.filters;
    if (filters.query) url.searchParams.set('user_q', filters.query);
    if (filters.status !== 'all') url.searchParams.set('user_status', filters.status);
    if (filters.activity !== 'all') url.searchParams.set('user_activity', filters.activity);
    if (filters.hasSession !== 'all') url.searchParams.set('user_session', filters.hasSession);
    if (filters.hasConversation !== 'all') url.searchParams.set('user_conv', filters.hasConversation);
    if (input.user.sort.key !== DEFAULT_USER_MANAGEMENT_VIEW_STATE.sort.key) {
      url.searchParams.set('user_sort', input.user.sort.key);
    }
    if (input.user.sort.direction !== DEFAULT_USER_MANAGEMENT_VIEW_STATE.sort.direction) {
      url.searchParams.set('user_dir', input.user.sort.direction);
    }
    if (input.user.drawerOpen && input.user.selectedUserId) {
      url.searchParams.set('user_id', input.user.selectedUserId);
      if (input.user.detailTab !== 'overview') {
        url.searchParams.set('user_tab', input.user.detailTab);
      }
    }
  }

  if (input.activeSection === 'skill') {
    if (input.skill.filters.query) url.searchParams.set('skill_q', input.skill.filters.query);
    if (input.skill.filters.status !== 'all') url.searchParams.set('skill_status', input.skill.filters.status);
    if (input.skill.filters.category) url.searchParams.set('skill_category', input.skill.filters.category);
    if (input.skill.skillView !== DEFAULT_SKILL_MANAGEMENT_VIEW_STATE.skillView) {
      url.searchParams.set('skill_view', input.skill.skillView);
    }
    if (input.skill.detailDialogOpen && input.skill.selectedSkillId) {
      url.searchParams.set('skill_id', input.skill.selectedSkillId);
      url.searchParams.set('skill_dialog', '1');
      if (input.skill.detailTab !== DEFAULT_SKILL_MANAGEMENT_VIEW_STATE.detailTab) {
        url.searchParams.set('skill_tab', input.skill.detailTab);
      }
      if (input.skill.selectedRevisionId) {
        url.searchParams.set('skill_rev', input.skill.selectedRevisionId);
      }
    }
  }

  if (input.activeSection === 'connectorGuide') {
    if (input.connectorGuide.filters.connectorKey) {
      url.searchParams.set('guide_connector', input.connectorGuide.filters.connectorKey);
    }
    if (input.connectorGuide.filters.status !== 'all') {
      url.searchParams.set('guide_status', input.connectorGuide.filters.status);
    }
    if (input.connectorGuide.filters.query) {
      url.searchParams.set('guide_q', input.connectorGuide.filters.query);
    }
    if (input.connectorGuide.selectedPolicyId) {
      url.searchParams.set('guide_id', input.connectorGuide.selectedPolicyId);
    }
    if (input.connectorGuide.selectedRevisionId) {
      url.searchParams.set('guide_rev', input.connectorGuide.selectedRevisionId);
    }
  }

  if (input.activeSection === 'osacRelease') {
    if (input.osacRelease.tab !== DEFAULT_OSAC_RELEASE_MANAGEMENT_VIEW_STATE.tab) {
      url.searchParams.set('osac_tab', input.osacRelease.tab);
    }
    if (input.osacRelease.query) {
      url.searchParams.set('osac_q', input.osacRelease.query);
    }
    if (input.osacRelease.detailDialogOpen && input.osacRelease.selectedReleaseId) {
      url.searchParams.set('osac_id', input.osacRelease.selectedReleaseId);
      url.searchParams.set('osac_dialog', '1');
    }
  }

  if (input.activeSection === 'audit') {
    if (input.audit.query) url.searchParams.set('audit_q', input.audit.query);
    if (input.audit.operator !== 'all') url.searchParams.set('audit_operator', input.audit.operator);
    if (input.audit.action !== 'all') url.searchParams.set('audit_action', input.audit.action);
    if (input.audit.result !== 'all') url.searchParams.set('audit_result', input.audit.result);
    if (input.audit.from) url.searchParams.set('audit_from', input.audit.from);
    if (input.audit.to) url.searchParams.set('audit_to', input.audit.to);
  }

  const nextQuery = url.searchParams.toString();
  const nextUrl = `${url.pathname}${nextQuery ? `?${nextQuery}` : ''}${url.hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl !== currentUrl) {
    window.history.replaceState(window.history.state, '', nextUrl);
  }
}

export default function App() {
  const initialUrlStateRef = useRef<AdminUrlState | null>(null);
  const initialUrlState = initialUrlStateRef.current || readAdminUrlState();
  initialUrlStateRef.current = initialUrlState;
  const sectionRefreshHandlerRef = useRef<(() => Promise<void>) | null>(null);
  const initialSandboxDeepLinkHandledRef = useRef(false);

  const [authStatus, setAuthStatus] = useState<'loading' | 'authenticated' | 'anonymous'>('loading');
  const [adminUser, setAdminUser] = useState<AdminUser | null>(null);
  const [loginName, setLoginName] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<SectionKey>(initialUrlState.activeSection);
  const [themeSettings, setThemeSettings] = useState<AdminThemeSettings | null>(null);
  const [currentTheme, setCurrentTheme] = useState<AdminThemeKey>(() => readStoredAdminTheme());
  const [currentThemeMode, setCurrentThemeMode] = useState<AdminThemeMode>(() => readStoredAdminThemeMode());
  const [themeSaving, setThemeSaving] = useState(false);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [systemThemeTone, setSystemThemeTone] = useState<'light' | 'dark'>(() => getSystemThemeTone());
  const settingsMenuRef = useRef<HTMLDivElement | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => readStoredSidebarCollapsed());
  const [sidebarMobileOpen, setSidebarMobileOpen] = useState(false);

  const [kvmOverview, setKvmOverview] = useState<DashboardOverview | null>(null);
  const [vms, setVms] = useState<VmItem[]>([]);
  const [hosts, setHosts] = useState<HostListResponse['hosts']>([]);
  const [hostTrendMap, setHostTrendMap] = useState<Record<string, HostTrendPoint[]>>({});
  const [busyVmIds, setBusyVmIds] = useState<Record<string, boolean>>({});

  const [conversationSessions, setConversationSessions] = useState<ConversationSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(initialUrlState.conversation.selectedSessionId);
  const [conversationDetail, setConversationDetail] = useState<ConversationSessionDetailResponse | null>(null);
  const [conversationDetailLoading, setConversationDetailLoading] = useState(false);
  const [conversationInfraError, setConversationInfraError] = useState<string | null>(null);
  const [conversationSearchQuery, setConversationSearchQuery] = useState(initialUrlState.conversation.query);
  const [conversationStatusFilter, setConversationStatusFilter] = useState<'all' | 'in_progress' | 'waiting_user' | 'failed' | 'completed'>(initialUrlState.conversation.status);
  const [conversationStageFilter, setConversationStageFilter] = useState(initialUrlState.conversation.stage);
  const [conversationUserFilter, setConversationUserFilter] = useState(initialUrlState.conversation.user);
  const [conversationExecutorFilter, setConversationExecutorFilter] = useState(initialUrlState.conversation.executor);
  const [conversationUpdatedFromDate, setConversationUpdatedFromDate] = useState(initialUrlState.conversation.updatedFrom);
  const [conversationUpdatedToDate, setConversationUpdatedToDate] = useState(initialUrlState.conversation.updatedTo);
  const [conversationSort, setConversationSort] = useState<ConversationSortState>(DEFAULT_CONVERSATION_SORT);
  const [conversationSummaryRefreshing, setConversationSummaryRefreshing] = useState(false);
  const [conversationSummaryFetchedAt, setConversationSummaryFetchedAt] = useState<string | null>(null);
  const [conversationSummaryClock, setConversationSummaryClock] = useState(() => Date.now());
  const [conversationDialog, setConversationDialog] = useState<{ sessionId: string } | null>(null);
  const [conversationDialogOrigin, setConversationDialogOrigin] = useState<AdminDetailOrigin | null>(null);
  const [conversationDialogZIndex, setConversationDialogZIndex] = useState(240);
  const [conversationSectionOrigin, setConversationSectionOrigin] = useState<AdminDetailOrigin | null>(null);
  const [showOpencodePayload, setShowOpencodePayload] = useState(false);
  const [conversationGovernanceFilter, setConversationGovernanceFilter] = useState<string | null>(null);
  const [conversationEnvironmentGroupFilter, setConversationEnvironmentGroupFilter] = useState<string | null>(null);
  const [conversationDialogTab, setConversationDialogTab] = useState<ConversationDialogTab>('overview');
  const [conversationDeploymentSummary, setConversationDeploymentSummary] = useState<DeploymentRecord | null>(null);
  const [conversationDeploymentLoading, setConversationDeploymentLoading] = useState(false);
  const [conversationBillingUsage, setConversationBillingUsage] = useState<ConversationBillingUsage | null>(null);
  const [conversationBillingLoading, setConversationBillingLoading] = useState(false);
  const [transitionView, setTransitionView] = useState<'timeline' | 'list'>('timeline');
  const [transitionQuery, setTransitionQuery] = useState('');
  const [transitionFilters, setTransitionFilters] = useState(DEFAULT_TRANSITION_FILTERS);
  const [transitionAdvancedFiltersOpen, setTransitionAdvancedFiltersOpen] = useState(false);
  const [deploymentManagementUpdatedAt, setDeploymentManagementUpdatedAt] = useState<string | null>(null);
  const [userManagementUpdatedAt, setUserManagementUpdatedAt] = useState<string | null>(null);
  const [skillManagementUpdatedAt, setSkillManagementUpdatedAt] = useState<string | null>(null);
  const [connectorGuideUpdatedAt, setConnectorGuideUpdatedAt] = useState<string | null>(null);
  const [osacReleaseUpdatedAt, setOsacReleaseUpdatedAt] = useState<string | null>(null);
  const [deploymentManagementViewState, setDeploymentManagementViewState] = useState<DeploymentManagementViewState>(() => cloneDeploymentManagementViewState(initialUrlState.deployment));
  const [userManagementViewState, setUserManagementViewState] = useState<UserManagementViewState>(() => cloneUserManagementViewState(initialUrlState.user));
  const [skillManagementViewState, setSkillManagementViewState] = useState<SkillManagementViewState>(() => cloneSkillManagementViewState(initialUrlState.skill));
  const [connectorGuideManagementViewState, setConnectorGuideManagementViewState] = useState<ConnectorGuideManagementViewState>(() => cloneConnectorGuideManagementViewState(initialUrlState.connectorGuide));
  const [osacReleaseManagementViewState, setOsacReleaseManagementViewState] = useState<OsacReleaseManagementViewState>(() => cloneOsacReleaseManagementViewState(initialUrlState.osacRelease));

  const [agentOverview, setAgentOverview] = useState<AgentManagementOverview | null>(null);
  const [sandboxOverview, setSandboxOverview] = useState<SandboxManagementOverview | null>(null);
  const [sandboxLiveSummary, setSandboxLiveSummary] = useState<SandboxLiveSummary | null>(null);
  const [sandboxLiveSummaryRefreshing, setSandboxLiveSummaryRefreshing] = useState(false);
  const [sandboxLiveSummaryClock, setSandboxLiveSummaryClock] = useState(() => Date.now());
  const [sandboxRuntimeRegistry, setSandboxRuntimeRegistry] = useState<SandboxRuntimeRegistry | null>(null);
  const [sandboxRuntimeDetail, setSandboxRuntimeDetail] = useState<SandboxRuntimeDetail | null>(null);
  const [sandboxDetail, setSandboxDetail] = useState<E2bSandboxDetail | null>(null);
  const [sandboxArchiveHistory, setSandboxArchiveHistory] = useState<SandboxArchiveHistoryEntry[]>([]);
  const [sandboxModalOpen, setSandboxModalOpen] = useState(false);
  const [sandboxModalOrigin, setSandboxModalOrigin] = useState<AdminDetailOrigin | null>(null);
  const [sandboxModalZIndex, setSandboxModalZIndex] = useState(250);
  const [sandboxSectionOrigin, setSandboxSectionOrigin] = useState<AdminDetailOrigin | null>(null);
  const [sandboxRuntimeQuery, setSandboxRuntimeQuery] = useState(initialUrlState.sandbox.query);
  const [sandboxExecutorFilter, setSandboxExecutorFilter] = useState(initialUrlState.sandbox.executor);
  const [sandboxStatusFilter, setSandboxStatusFilter] = useState(initialUrlState.sandbox.status);
  const [sandboxRiskFilter, setSandboxRiskFilter] = useState(initialUrlState.sandbox.risk);
  const [sandboxDeepLinkId, setSandboxDeepLinkId] = useState<string | null>(initialUrlState.sandbox.selectedSandboxId);
  const [runtimeSort, setRuntimeSort] = useState<RuntimeSortState>(DEFAULT_RUNTIME_SORT);
  const [runtimeColumnWidths, setRuntimeColumnWidths] = useState<Record<RuntimeColumnKey, number>>(DEFAULT_RUNTIME_COLUMN_WIDTHS);
  const [archiveSort, setArchiveSort] = useState<ArchiveSortState>(DEFAULT_ARCHIVE_SORT);
  const [archiveColumnWidths, setArchiveColumnWidths] = useState<Record<ArchiveColumnKey, number>>(DEFAULT_ARCHIVE_COLUMN_WIDTHS);
  const [sandboxRegistryLimit, setSandboxRegistryLimit] = useState(SANDBOX_RUNTIME_PAGE_SIZE);
  const [sandboxRegistryLoadingMore, setSandboxRegistryLoadingMore] = useState(false);
  const [sandboxRegistryLoadMoreError, setSandboxRegistryLoadMoreError] = useState<string | null>(null);
  const [sandboxDetailTab, setSandboxDetailTab] = useState<SandboxDetailTab>(initialUrlState.sandbox.detailTab);
  const [sandboxProcessToolView, setSandboxProcessToolView] = useState<SandboxProcessToolView>('processes');
  const [sandboxFullInfo, setSandboxFullInfo] = useState<E2bSandboxFullInfo | null>(null);
  const [sandboxConnectivityResult, setSandboxConnectivityResult] = useState<unknown>(null);
  const [sandboxCommandInput, setSandboxCommandInput] = useState('pwd && ls -la');
  const [sandboxTerminalOutput, setSandboxTerminalOutput] = useState('');
  const [sandboxDirectoryPath, setSandboxDirectoryPath] = useState('/');
  const [sandboxFileTreeRootPath, setSandboxFileTreeRootPath] = useState('/');
  const [sandboxFileTreeItemsByPath, setSandboxFileTreeItemsByPath] = useState<Record<string, SandboxFileItem[]>>({});
  const [sandboxFileExpandedPaths, setSandboxFileExpandedPaths] = useState<string[]>([]);
  const [sandboxFilePath, setSandboxFilePath] = useState('');
  const [sandboxFileTargetKind, setSandboxFileTargetKind] = useState<SandboxFileItem['kind'] | null>(null);
  const [sandboxFileItems, setSandboxFileItems] = useState<SandboxFileItem[]>([]);
  const [, setSandboxFileStatus] = useState('等待加载目录');
  const [sandboxFileOperation, setSandboxFileOperation] = useState<SandboxFileOperation | null>(null);
  const [sandboxFileTransferProgress, setSandboxFileTransferProgress] = useState<SandboxFileTransferProgress | null>(null);
  const [sandboxProcessResult, setSandboxProcessResult] = useState<unknown>(null);
  const [sandboxProcessFetchedAt, setSandboxProcessFetchedAt] = useState<number | null>(null);
  const [sandboxPidInput, setSandboxPidInput] = useState('');
  const [sandboxPortResult, setSandboxPortResult] = useState<unknown>(null);
  const [sandboxPortFetchedAt, setSandboxPortFetchedAt] = useState<number | null>(null);
  const [sandboxToolSnapshotClock, setSandboxToolSnapshotClock] = useState(() => Date.now());
  const [sandboxCreatePayload, setSandboxCreatePayload] = useState(
    '{"template":"opencode-playwright-mcp-v4-neko-lockapi-20260413","timeoutMs":300000}'
  );
  const [sandboxCreateDrawerOpen, setSandboxCreateDrawerOpen] = useState(false);
  const overlayZIndexRef = useRef(260);
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
  const [templateWorkbenchMode, setTemplateWorkbenchMode] = useState<'detail' | 'create'>('detail');
  const [templateDetail, setTemplateDetail] = useState<E2bTemplateWithBuilds | null>(null);
  const [templateBuildLogs, setTemplateBuildLogs] = useState<E2bTemplateBuildLogsResponse | null>(null);
  const [templateBuildStatus, setTemplateBuildStatus] = useState<E2bTemplateBuildInfo | null>(null);
  const [templateActionPayload, setTemplateActionPayload] = useState('{}');
  const [templateAliasDraft, setTemplateAliasDraft] = useState('');
  const [templateAliasResult, setTemplateAliasResult] = useState<unknown>(null);
  const [sandboxBusyIds, setSandboxBusyIds] = useState<Record<string, boolean>>({});
  const [auditEntries, setAuditEntries] = useState<AuditLogEntry[]>([]);
  const [auditResponseMeta, setAuditResponseMeta] = useState<AuditResponse>({
    total: 0,
    filteredTotal: 0,
    limit: 80,
    offset: 0,
    entries: [],
    availableActions: [],
    availableOperators: [],
    availableTargets: [],
  });
  const [auditFilters, setAuditFilters] = useState<AuditFilterState>({ ...initialUrlState.audit });
  const [auditSort, setAuditSort] = useState<AuditSortState>(DEFAULT_AUDIT_SORT);
  const [auditDetail, setAuditDetail] = useState<AuditDetailResponse | null>(null);
  const [auditSummaryRefreshing, setAuditSummaryRefreshing] = useState(false);
  const [auditSummaryFetchedAt, setAuditSummaryFetchedAt] = useState<string | null>(null);
  const [auditSummaryClock, setAuditSummaryClock] = useState(() => Date.now());
  const [selectedAgentStageKey, setSelectedAgentStageKey] = useState<string | null>(null);
  const [toasts, setToasts] = useState<UiToast[]>([]);
  const [operationOverlay, setOperationOverlay] = useState<{ message: string } | null>(null);
  const [sandboxLoadProgress, setSandboxLoadProgress] = useState<SandboxLoadProgressState>({
    active: false,
    startedAt: null,
    completed: { ...EMPTY_SANDBOX_LOAD_PROGRESS },
  });
  const [sandboxLoadProgressClock, setSandboxLoadProgressClock] = useState(() => Date.now());

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sandboxSectionRequestRef = useRef<Promise<void> | null>(null);
  const sandboxOverviewRequestRef = useRef<Promise<void> | null>(null);
  const sandboxRuntimeRegistryRequestRef = useRef<Promise<void> | null>(null);
  const sandboxRuntimeRegistryRequestVersionRef = useRef(0);
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
  const auditRequestVersionRef = useRef(0);
  const auditFiltersRef = useRef<AuditFilterState>({ ...initialUrlState.audit });
  const toastIdRef = useRef(1);
  const lastErrorToastRef = useRef<string | null>(null);
  const sidebarNavRef = useRef<HTMLElement | null>(null);
  const sandboxFileUploadInputRef = useRef<HTMLInputElement | null>(null);

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

  const dismissToast = useCallback((toastId: number) => {
    setToasts((previous) => previous.filter((item) => item.id !== toastId));
  }, []);

  const pushToast = useCallback(
    (tone: ToastTone, title: string, message: string, durationMs = tone === 'error' ? 8000 : 3200) => {
      const nextId = toastIdRef.current++;
      setToasts((previous) => [...previous, { id: nextId, tone, title, message }]);
      window.setTimeout(() => {
        dismissToast(nextId);
      }, durationMs);
    },
    [dismissToast]
  );

  const saveThemePreferences = useCallback(
    async (nextThemeRaw: AdminThemeKey, nextModeRaw: AdminThemeMode) => {
      const nextTheme = normalizeAdminThemeKey(nextThemeRaw);
      const nextMode = normalizeAdminThemeMode(nextModeRaw);
      if (nextTheme === currentTheme && nextMode === currentThemeMode) return;

      const previousTheme = currentTheme;
      const previousMode = currentThemeMode;
      setCurrentTheme(nextTheme);
      setCurrentThemeMode(nextMode);
      persistStoredAdminTheme(nextTheme);
      persistStoredAdminThemeMode(nextMode);
      setThemeSaving(true);

      try {
        const settings = await api.updateAdminTheme({ themeKey: nextTheme, mode: nextMode });
        setThemeSettings(settings);
        setCurrentTheme(settings.currentTheme);
        setCurrentThemeMode(settings.currentMode);
        persistStoredAdminTheme(settings.currentTheme);
        persistStoredAdminThemeMode(settings.currentMode);
        const themeLabel =
          settings.themes.find((item) => item.key === settings.currentTheme)?.label || settings.currentTheme;
        const modeLabel =
          settings.modes.find((item) => item.key === settings.currentMode)?.label || settings.currentMode;
        pushToast('success', '外观已保存', `${themeLabel} · ${modeLabel} 已写入 ${settings.envKey} / ${settings.envModeKey}`);
      } catch (themeError) {
        setCurrentTheme(previousTheme);
        setCurrentThemeMode(previousMode);
        persistStoredAdminTheme(previousTheme);
        persistStoredAdminThemeMode(previousMode);
        setError(themeError instanceof Error ? themeError.message : '外观保存失败');
      } finally {
        setThemeSaving(false);
      }
    },
    [currentTheme, currentThemeMode, pushToast]
  );

  const runBlockingTask = useCallback(
    async <T,>(
      message: string,
      task: () => Promise<T>,
      options?: { successToast?: string; fallbackError?: string }
    ): Promise<T> => {
      setOperationOverlay({ message });
      try {
        const result = await task();
        setError(null);
        if (options?.successToast) {
          pushToast('success', '已完成', options.successToast);
        }
        return result;
      } catch (taskError) {
        const nextError = taskError instanceof Error ? taskError.message : options?.fallbackError || '操作失败';
        setError(nextError);
        throw taskError;
      } finally {
        setOperationOverlay(null);
      }
    },
    [pushToast]
  );

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

  const applyConversationSessions = useCallback((sessions: ConversationSession[], refreshedAt = new Date().toISOString()) => {
    setConversationSessions(sessions);
    setConversationSummaryFetchedAt(refreshedAt);
    setConversationSummaryClock(Date.now());

    if (sessions.length > 0) {
      const nextId = selectedSessionId && sessions.some((item) => item.id === selectedSessionId)
        ? selectedSessionId
        : sessions[0].id;
      setSelectedSessionId(nextId);
    } else {
      setSelectedSessionId(null);
      setConversationDetail(null);
      setConversationDetailLoading(false);
    }
  }, [selectedSessionId]);

  const loadConversationSessions = useCallback(async () => {
    const result = await api.listConversationSessions(200);
    applyConversationSessions(result.sessions);
  }, [applyConversationSessions]);

  const selectConversationSession = useCallback((sessionId: string) => {
    if (selectedSessionId === sessionId) {
      return;
    }
    setSelectedSessionId(sessionId);
    setConversationDetailLoading(true);
  }, [selectedSessionId]);

  const claimOverlayZIndex = useCallback(() => {
    overlayZIndexRef.current += 10;
    return overlayZIndexRef.current;
  }, []);

  const openConversationDialog = useCallback(
    (sessionId: string, initialTab: ConversationDialogTab = 'overview', origin: AdminDetailOrigin | null = null) => {
      selectConversationSession(sessionId);
      setConversationDialog({ sessionId });
      setConversationDialogOrigin(origin);
      setConversationDialogTab(initialTab);
      setConversationDialogZIndex(claimOverlayZIndex());
    },
    [claimOverlayZIndex, selectConversationSession]
  );

  const closeConversationDialog = useCallback(() => {
    setConversationDialog(null);
    setConversationDialogOrigin(null);
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
      const initialDirection: RuntimeSortDirection = key === 'last_active' ? 'desc' : 'asc';
      return {
        key,
        direction: initialDirection,
      };
    });
  }, []);

  const toggleConversationSort = useCallback((key: ConversationSortKey) => {
    setConversationSort((previous) => {
      if (previous.key === key) {
        return {
          key,
          direction: previous.direction === 'asc' ? 'desc' : 'asc',
        };
      }
      return {
        key,
        direction: key === 'updated_at' || key === 'created_at' ? 'desc' : 'asc',
      };
    });
  }, []);

  const toggleAuditSort = useCallback((key: AuditSortKey) => {
    setAuditSort((previous) => {
      if (previous.key === key) {
        return {
          key,
          direction: previous.direction === 'asc' ? 'desc' : 'asc',
        };
      }
      return {
        key,
        direction: key === 'time' ? 'desc' : 'asc',
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

  const loadSandboxLiveSummary = useCallback(async (options?: { forceRefresh?: boolean }) => {
    const summary = await api.getSandboxLiveSummary(options);
    setSandboxLiveSummary(summary);
    setSandboxLiveSummaryClock(Date.now());
  }, []);

  const beginSandboxLoadProgress = useCallback(() => {
    const startedAt = Date.now();
    setSandboxLoadProgress({
      active: true,
      startedAt,
      completed: { ...EMPTY_SANDBOX_LOAD_PROGRESS },
    });
    setSandboxLoadProgressClock(startedAt);
  }, []);

  const markSandboxLoadProgressStep = useCallback((step: SandboxLoadStepKey) => {
    setSandboxLoadProgress((current) => {
      if (!current.active || current.completed[step]) {
        return current;
      }
      return {
        ...current,
        completed: {
          ...current.completed,
          [step]: true,
        },
      };
    });
  }, []);

  const finishSandboxLoadProgress = useCallback(() => {
    setSandboxLoadProgress((current) => {
      if (!current.active) {
        return current;
      }
      return {
        ...current,
        active: false,
      };
    });
  }, []);

  const refreshSandboxLiveSummary = useCallback(async () => {
    setSandboxLiveSummaryRefreshing(true);
    try {
      await loadSandboxLiveSummary({ forceRefresh: true });
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '刷新 E2B live 数量失败');
    } finally {
      setSandboxLiveSummaryRefreshing(false);
    }
  }, [loadSandboxLiveSummary]);

  const refreshConversationSummary = useCallback(async () => {
    setConversationSummaryRefreshing(true);
    try {
      await loadConversationSessions();
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '刷新会话列表失败');
    } finally {
      setConversationSummaryRefreshing(false);
    }
  }, [loadConversationSessions]);

  const loadSandboxRuntimeRegistry = useCallback(async () => {
    if (sandboxRuntimeRegistryRequestRef.current) {
      return sandboxRuntimeRegistryRequestRef.current;
    }

    const request = (async () => {
      const requestVersion = ++sandboxRuntimeRegistryRequestVersionRef.current;
      const registry = await api.getSandboxRuntimeRegistry(sandboxRegistryLimitRef.current);
      if (requestVersion === sandboxRuntimeRegistryRequestVersionRef.current) {
        setSandboxRuntimeRegistry(registry);
      }
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

    const request = (async () => {
      await Promise.all([
        loadSandboxOverview(),
        loadSandboxRuntimeRegistry(),
      ]);
      await loadSandboxLiveSummary().catch(() => undefined);
    })();
    sandboxSectionRequestRef.current = request;
    try {
      await request;
    } finally {
      sandboxSectionRequestRef.current = null;
    }
  }, [loadSandboxLiveSummary, loadSandboxOverview, loadSandboxRuntimeRegistry]);

  const loadMoreSandboxRuntime = useCallback(async () => {
    const previousLimit = sandboxRegistryLimitRef.current;
    const nextLimit = previousLimit + SANDBOX_RUNTIME_LOAD_MORE_STEP;
    sandboxRegistryLimitRef.current = nextLimit;
    setSandboxRegistryLimit(nextLimit);
    setSandboxRegistryLoadingMore(true);
    setSandboxRegistryLoadMoreError(null);
    try {
      const requestVersion = ++sandboxRuntimeRegistryRequestVersionRef.current;
      const registry = await api.getSandboxRuntimeRegistry(nextLimit);
      if (requestVersion === sandboxRuntimeRegistryRequestVersionRef.current) {
        setSandboxRuntimeRegistry(registry);
      }
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
  }, []);

  const loadTemplates = useCallback(async () => {
    const result = await api.listTemplates();
    setTemplates(result);
    return result;
  }, []);

  const loadSandboxSectionWithProgress = useCallback(async () => {
    beginSandboxLoadProgress();
    try {
      await Promise.all([
        loadSandboxOverview().then(() => {
          markSandboxLoadProgressStep('overview');
        }),
        loadSandboxRuntimeRegistry().then(() => {
          markSandboxLoadProgressStep('runtime');
        }),
        loadTemplates()
          .catch(() => undefined)
          .finally(() => {
            markSandboxLoadProgressStep('templates');
          }),
      ]);
      await loadSandboxLiveSummary()
        .catch(() => undefined)
        .finally(() => {
          markSandboxLoadProgressStep('live');
        });
    } finally {
      finishSandboxLoadProgress();
    }
  }, [
    beginSandboxLoadProgress,
    finishSandboxLoadProgress,
    loadSandboxLiveSummary,
    loadSandboxOverview,
    loadSandboxRuntimeRegistry,
    loadTemplates,
    markSandboxLoadProgressStep,
  ]);

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

  const currentConversationOrigin = useCallback((): AdminDetailOrigin | null => {
    if (conversationDialog) {
      const dialogLabel = conversationDetail?.session.title || conversationDialog.sessionId;
      return {
        section: 'conversation',
        trail: conversationDialogOrigin?.trail
          ? `${conversationDialogOrigin.trail} / ${dialogLabel}`
          : `对话详情 / ${dialogLabel}`,
      };
    }
    if (activeSection === 'conversation' && selectedSessionId) {
      return {
        section: 'conversation',
        trail: `对话管理 / ${conversationDetail?.session.title || selectedSessionId}`,
      };
    }
    return null;
  }, [activeSection, conversationDetail?.session.title, conversationDialog, conversationDialogOrigin?.trail, selectedSessionId]);

  const currentSandboxOrigin = useCallback((): AdminDetailOrigin | null => {
    if (sandboxModalOpen && sandboxRuntimeDetail) {
      const sandboxLabel = sandboxDisplayLabel(sandboxRuntimeDetail);
      return {
        section: 'sandbox',
        trail: sandboxModalOrigin?.trail
          ? `${sandboxModalOrigin.trail} / ${sandboxLabel}`
          : `Sandbox 详情 / ${sandboxLabel}`,
      };
    }
    if (activeSection === 'sandbox') {
      return {
        section: 'sandbox',
        trail: `Sandbox 管理 / ${sandboxDisplayLabel(sandboxRuntimeDetail)}`,
      };
    }
    return null;
  }, [activeSection, sandboxModalOpen, sandboxModalOrigin?.trail, sandboxRuntimeDetail]);

  const openUserManagementView = useCallback((userId: string, origin: AdminDetailOrigin | null = null) => {
    if (!userId) return;
    setUserManagementViewState((current) => ({
      ...current,
      selectedUserId: userId,
      selectedUserLabel: current.selectedUserLabel,
      drawerOpen: true,
      detailTab: origin?.section === 'deployment' ? 'deployments' : 'overview',
    }));
    setActiveSection('user');
    setError(null);
  }, []);

  const openDeploymentManagementView = useCallback(
    (taskSessionId: string, origin: AdminDetailOrigin | null = null) => {
      if (!taskSessionId) return;
      const nextView: DeploymentManagementViewState['view'] =
        origin?.section === 'user'
          ? 'users'
          : origin?.section === 'conversation'
            ? 'conversations'
            : 'records';
      setDeploymentManagementViewState((current) => ({
        ...current,
        view: nextView,
        selectedTaskSessionId: taskSessionId,
        detailDialogOpen: true,
        detailTab: 'overview',
        filters: {
          ...current.filters,
          taskSessionId: nextView === 'records' ? taskSessionId : current.filters.taskSessionId,
          userId: nextView === 'users' ? origin?.section === 'user' ? current.filters.userId : current.filters.userId : current.filters.userId,
        },
      }));
      setActiveSection('deployment');
      setError(null);
    },
    []
  );

  const auditOriginForEntry = useCallback(
    (entry: AuditLogEntry): AdminDetailOrigin => ({
      section: 'audit',
      trail: `审计日志 / ${auditActionLabel(entry.action)} / ${entry.id}`,
    }),
    []
  );

  const openTemplateDetail = useCallback(async (templateId: string) => {
    try {
      await runBlockingTask(
        '正在加载模板详情',
        async () => {
          const result = await api.getTemplate(templateId);
          setTemplateWorkbenchMode('detail');
          setTemplateDetail(result);
          setTemplateAliasDraft(templateAliasOf(result));
          setTemplateAliasResult(null);
          setTemplateBuildLogs(null);
          setTemplateBuildStatus(null);
          setTemplateModalOpen(true);
        },
        { fallbackError: '加载模板详情失败' }
      );
    } catch {
      // error is routed to banner and toast
    }
  }, [runBlockingTask]);

  const openTemplateCreateWorkbench = useCallback(() => {
    setTemplateModalOpen(true);
    setTemplateWorkbenchMode('create');
    setTemplateBuildLogs(null);
    setTemplateBuildStatus(null);
    setTemplateAliasResult(null);
    if (!templateActionPayload.trim()) {
      setTemplateActionPayload('{}');
    }
  }, [templateActionPayload]);

  const openTemplateWorkbench = useCallback(() => {
    setTemplateModalOpen(true);
    if (!templates.length) {
      setTemplateWorkbenchMode('create');
      return;
    }
    if (templateDetail) {
      setTemplateWorkbenchMode('detail');
      return;
    }
    const firstTemplateId = templates
      .map((item) => templateIdOf(item))
      .find((item): item is string => Boolean(item));
    if (firstTemplateId) {
      void openTemplateDetail(firstTemplateId);
    }
  }, [openTemplateDetail, templateDetail, templates]);

  const openSandboxDetail = useCallback(
    async (sandboxId: string, origin: AdminDetailOrigin | null = null, initialDetailTab: SandboxDetailTab = 'overview') => {
      try {
        await runBlockingTask(
          '正在加载 Sandbox 详情',
          async () => {
            await loadSandboxRuntimeDetail(sandboxId);
            setSandboxDeepLinkId(sandboxId);
            setSandboxDetailTab(initialDetailTab);
            setSandboxProcessToolView('processes');
            setSandboxConnectivityResult(null);
            setSandboxTerminalOutput('');
            setSandboxDirectoryPath('/');
            setSandboxFileTreeRootPath('/');
            setSandboxFileTreeItemsByPath({});
            setSandboxFileExpandedPaths(['/']);
            setSandboxFilePath('');
            setSandboxFileTargetKind(null);
            setSandboxFileItems([]);
            setSandboxFileOperation(null);
            setSandboxFileTransferProgress(null);
            setSandboxFileStatus('目录根已重置为 /');
            setSandboxProcessResult(null);
            setSandboxProcessFetchedAt(null);
            setSandboxPortResult(null);
            setSandboxPortFetchedAt(null);
            setSandboxModalOrigin(origin);
            setSandboxModalZIndex(claimOverlayZIndex());
            setSandboxModalOpen(true);
          },
          { fallbackError: '加载 Sandbox 详情失败' }
        );
      } catch (detailError) {
        setError(detailError instanceof Error ? detailError.message : '加载 Sandbox 详情失败');
      }
    },
    [claimOverlayZIndex, loadSandboxRuntimeDetail, runBlockingTask]
  );

  const closeSandboxDetail = useCallback(() => {
    setSandboxModalOpen(false);
    setSandboxModalOrigin(null);
    setSandboxDeepLinkId(null);
  }, []);

  const closeTemplateDetail = useCallback(() => {
    setTemplateModalOpen(false);
    setTemplateWorkbenchMode('detail');
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
    openConversationDialog(taskSessionId, 'overview', currentSandboxOrigin());
  }, [currentSandboxOrigin, openConversationDialog]);

  const openDeploymentFromConversation = useCallback((taskSessionId?: string | null) => {
    if (!taskSessionId) return;
    openDeploymentManagementView(taskSessionId, currentConversationOrigin());
  }, [currentConversationOrigin, openDeploymentManagementView]);

  const openSandboxFromConversation = useCallback((sandboxId?: string | null, origin: AdminDetailOrigin | null = null) => {
    if (!sandboxId) return;
    setError(null);
    void openSandboxDetail(sandboxId, origin || currentConversationOrigin());
  }, [currentConversationOrigin, openSandboxDetail]);

  const openConversationFromAudit = useCallback((entry: AuditLogEntry) => {
    if (!entry.sessionId) return;
    setError(null);
    openConversationDialog(entry.sessionId, 'overview', auditOriginForEntry(entry));
  }, [auditOriginForEntry, openConversationDialog]);

  const openSandboxFromAudit = useCallback((entry: AuditLogEntry) => {
    if (!entry.targetVmId) return;
    setError(null);
    void openSandboxDetail(entry.targetVmId, auditOriginForEntry(entry));
  }, [auditOriginForEntry, openSandboxDetail]);

  const openConversationManagementView = useCallback(() => {
    sectionRefreshHandlerRef.current = null;
    setConversationSectionOrigin(conversationDialogOrigin);
    setConversationDialog(null);
    setConversationDialogOrigin(null);
    setSandboxModalOpen(false);
    setSandboxModalOrigin(null);
    setSandboxDeepLinkId(null);
    setActiveSection('conversation');
  }, [conversationDialogOrigin]);

  const openSandboxManagementView = useCallback(() => {
    sectionRefreshHandlerRef.current = null;
    setSandboxSectionOrigin(sandboxModalOrigin);
    setSandboxModalOpen(false);
    setSandboxModalOrigin(null);
    setSandboxDeepLinkId(null);
    setConversationDialog(null);
    setConversationDialogOrigin(null);
    setActiveSection('sandbox');
  }, [sandboxModalOrigin]);

  useEffect(() => {
    if (authStatus !== 'authenticated' || activeSection !== 'sandbox') {
      return;
    }
    const initialSandboxId = initialUrlStateRef.current?.sandbox.selectedSandboxId;
    if (!initialSandboxId || initialSandboxDeepLinkHandledRef.current) {
      return;
    }
    initialSandboxDeepLinkHandledRef.current = true;
    void openSandboxDetail(initialSandboxId, null, initialUrlStateRef.current?.sandbox.detailTab || 'overview');
  }, [activeSection, authStatus, openSandboxDetail]);

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
      setError(null);
      const result = await api.runSandboxToolAction(sandboxId, 'system.process.list');
      const fetchedAt = Date.now();
      setSandboxProcessResult(result);
      setSandboxProcessFetchedAt(fetchedAt);
      setSandboxToolSnapshotClock(fetchedAt);
    } catch (toolError) {
      setError(toolError instanceof Error ? toolError.message : '获取进程列表失败');
    }
  }, [sandboxRuntimeDetail?.runtime.sandboxId, sandboxDetail?.sandboxId]);

  const killSandboxProcess = useCallback(async () => {
    const sandboxId = sandboxRuntimeDetail?.runtime.sandboxId || sandboxDetail?.sandboxId;
    const pid = Number(sandboxPidInput);
    if (!sandboxId || !Number.isFinite(pid) || pid <= 0) return;
    try {
      setError(null);
      await api.runSandboxToolAction(sandboxId, 'system.process.kill', { pid });
      setSandboxTerminalOutput((prev) => `${prev}${prev ? '\n\n' : ''}[process] killed ${pid}`);
      setSandboxPidInput('');
      await loadSandboxProcesses();
    } catch (toolError) {
      setError(toolError instanceof Error ? toolError.message : '结束进程失败');
    }
  }, [sandboxRuntimeDetail?.runtime.sandboxId, sandboxDetail?.sandboxId, sandboxPidInput, loadSandboxProcesses]);

  const listSandboxFiles = useCallback(async (targetPath?: string, options?: { resetTreeRoot?: boolean }) => {
    const sandboxId = sandboxRuntimeDetail?.runtime.sandboxId || sandboxDetail?.sandboxId;
    const directoryPath = normalizeSandboxPath(targetPath ?? sandboxDirectoryPath);
    if (!sandboxId || !directoryPath) return;
    try {
      setError(null);
      setSandboxFileStatus(`正在刷新目录 ${directoryPath}`);
      const result = await api.runSandboxToolAction(sandboxId, 'files.list', {
        path: directoryPath,
      });
      const items = normalizeSandboxFileItems(result, directoryPath);
      const resolvedPath =
        result && typeof result === 'object' && typeof (result as Record<string, unknown>).path === 'string'
          ? normalizeSandboxPath(String((result as Record<string, unknown>).path))
          : directoryPath;
      setSandboxDirectoryPath(resolvedPath);
      setSandboxFilePath(resolvedPath);
      setSandboxFileTargetKind('dir');
      setSandboxFileItems(items);
      if (options?.resetTreeRoot) {
        setSandboxFileTreeRootPath(resolvedPath);
      }
      setSandboxFileTreeItemsByPath((prev) => ({
        ...prev,
        [resolvedPath]: items,
      }));
      setSandboxFileExpandedPaths((prev) => {
        const next = new Set(prev.map(normalizeSandboxPath));
        addPathAndAncestors(next, resolvedPath, options?.resetTreeRoot ? resolvedPath : undefined);
        return Array.from(next);
      });
      setSandboxFileStatus(items.length ? `${resolvedPath} · ${items.length} 项` : `${resolvedPath} 为空目录`);
    } catch (toolError) {
      setSandboxFileItems([]);
      setSandboxFileStatus('目录读取失败');
      setError(toolError instanceof Error ? toolError.message : '查看目录失败');
    }
  }, [sandboxRuntimeDetail?.runtime.sandboxId, sandboxDetail?.sandboxId, sandboxDirectoryPath]);

  const goSandboxFileParent = useCallback(async () => {
    const nextPath = parentPath(sandboxDirectoryPath);
    await listSandboxFiles(nextPath, { resetTreeRoot: !isPathWithin(sandboxFileTreeRootPath, nextPath) });
  }, [listSandboxFiles, sandboxDirectoryPath, sandboxFileTreeRootPath]);

  const openSandboxFileItem = useCallback(async (item: SandboxFileItem) => {
    setSandboxFilePath(item.path);
    setSandboxFileTargetKind(item.kind);

    if (item.kind === 'dir') {
      setSandboxFileExpandedPaths((prev) => {
        const next = new Set(prev.map(normalizeSandboxPath));
        addPathAndAncestors(next, item.path, sandboxFileTreeRootPath);
        return Array.from(next);
      });
      await listSandboxFiles(item.path);
      return;
    }

    setSandboxFileStatus(`已选择文件 ${item.path}`);
  }, [listSandboxFiles, sandboxFileTreeRootPath]);

  const toggleSandboxFileTreeDirectory = useCallback(async (item: SandboxFileTreeRow) => {
    if (item.kind !== 'dir') {
      setSandboxFilePath(item.path);
      setSandboxFileTargetKind(item.kind);
      setSandboxFileStatus(`已选择文件 ${item.path}`);
      return;
    }

    setSandboxFilePath(item.path);
    setSandboxFileTargetKind('dir');
    if (item.expanded && item.loaded) {
      setSandboxDirectoryPath(item.path);
      setSandboxFileExpandedPaths((prev) => prev.map(normalizeSandboxPath).filter((path) => path !== item.path));
      return;
    }

    setSandboxFileExpandedPaths((prev) => {
      const next = new Set(prev.map(normalizeSandboxPath));
      addPathAndAncestors(next, item.path, sandboxFileTreeRootPath);
      return Array.from(next);
    });
    await listSandboxFiles(item.path);
  }, [listSandboxFiles, sandboxFileTreeRootPath]);

  const openSandboxFileUploadPicker = useCallback(() => {
    sandboxFileUploadInputRef.current?.click();
  }, []);

  const uploadSandboxFiles = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const sandboxId = sandboxRuntimeDetail?.runtime.sandboxId || sandboxDetail?.sandboxId;
      const files = Array.from(event.currentTarget.files || []);
      event.currentTarget.value = '';
      if (!sandboxId || files.length === 0) return;

      const directoryPath = normalizeSandboxPath(sandboxDirectoryPath);
      const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
      let completedBytes = 0;
      setSandboxFileOperation('upload');
      setSandboxFileTransferProgress({
        operation: 'upload',
        label: `上传到 ${directoryPath}`,
        detail: `${files.length} 个文件等待传输`,
        percent: 0,
      });
      setSandboxFileStatus(`正在上传 ${files.length} 个文件到 ${directoryPath}`);
      try {
        for (const [index, file] of files.entries()) {
          const targetPath = joinSandboxPath(directoryPath, file.name);
          setSandboxFileTransferProgress({
            operation: 'upload',
            label: `上传 ${file.name}`,
            detail: `${index + 1}/${files.length} · ${formatBytes(file.size)}`,
            percent: clampTransferPercent(totalBytes > 0 ? (completedBytes / totalBytes) * 100 : 0),
          });
          const uploadUrlResult = await api.runSandboxToolAction(sandboxId, 'sandbox.uploadUrl', {
            path: targetPath,
            useSignatureExpiration: 3600,
          });
          const uploadUrl = sandboxToolStringResult(uploadUrlResult);
          if (!uploadUrl) {
            throw new Error(`上传 ${file.name} 失败：上传链接返回为空`);
          }
          await uploadFileToSandboxUrl(uploadUrl, file, (loadedBytes, fileTotalBytes) => {
            const currentFileBytes = Math.min(loadedBytes, fileTotalBytes || file.size);
            const nextPercent = totalBytes > 0 ? ((completedBytes + currentFileBytes) / totalBytes) * 100 : null;
            setSandboxFileTransferProgress({
              operation: 'upload',
              label: `上传 ${file.name}`,
              detail: `${index + 1}/${files.length} · ${formatBytes(currentFileBytes)} / ${formatBytes(file.size)}`,
              percent: clampTransferPercent(nextPercent ?? 0),
            });
          });
          completedBytes += file.size;
        }
        setSandboxFileTransferProgress({
          operation: 'upload',
          label: `上传到 ${directoryPath}`,
          detail: `${files.length} 个文件已完成`,
          percent: 100,
        });
        await listSandboxFiles(directoryPath);
        setSandboxFileStatus(`${directoryPath} · 已上传 ${files.length} 个文件`);
        pushToast('success', '上传完成', `${files.length} 个文件已写入 ${directoryPath}`);
      } catch (toolError) {
        setSandboxFileStatus('上传失败');
        setError(toolError instanceof Error ? toolError.message : '上传文件失败');
      } finally {
        setSandboxFileOperation(null);
        setSandboxFileTransferProgress(null);
      }
    },
    [sandboxRuntimeDetail?.runtime.sandboxId, sandboxDetail?.sandboxId, sandboxDirectoryPath, listSandboxFiles, pushToast]
  );

  const downloadSandboxFile = useCallback(async () => {
    const sandboxId = sandboxRuntimeDetail?.runtime.sandboxId || sandboxDetail?.sandboxId;
    const targetPath = sandboxFilePath ? normalizeSandboxPath(sandboxFilePath) : '';
    if (!sandboxId || !targetPath || sandboxFileTargetKind === 'dir') {
      setSandboxFileStatus('请选择普通文件后下载');
      return;
    }

    setSandboxFileOperation('download');
    setSandboxFileTransferProgress({
      operation: 'download',
      label: `准备下载 ${sandboxFileNameFromPath(targetPath)}`,
      detail: targetPath,
      percent: 0,
    });
    setSandboxFileStatus(`正在生成下载链接 ${targetPath}`);
    try {
      const result = await api.runSandboxToolAction(sandboxId, 'sandbox.downloadUrl', {
        path: targetPath,
        useSignatureExpiration: 3600,
      });
      const downloadUrl = sandboxToolStringResult(result);
      if (!downloadUrl) {
        throw new Error('下载链接返回为空');
      }
      const fileName = sandboxFileNameFromPath(targetPath);
      await downloadFileFromSandboxUrl(downloadUrl, fileName, (loadedBytes, totalBytes) => {
        setSandboxFileTransferProgress({
          operation: 'download',
          label: `下载 ${fileName}`,
          detail: totalBytes ? `${formatBytes(loadedBytes)} / ${formatBytes(totalBytes)}` : `${formatBytes(loadedBytes)} 已接收`,
          percent: totalBytes ? clampTransferPercent((loadedBytes / totalBytes) * 100) : null,
        });
      });
      setSandboxFileTransferProgress({
        operation: 'download',
        label: `下载 ${fileName}`,
        detail: '下载文件已生成',
        percent: 100,
      });
      setSandboxFileStatus(`已开始下载 ${targetPath}`);
      pushToast('success', '下载完成', fileName);
    } catch (toolError) {
      setSandboxFileStatus('下载失败');
      setError(toolError instanceof Error ? toolError.message : '下载文件失败');
    } finally {
      setSandboxFileOperation(null);
      setSandboxFileTransferProgress(null);
    }
  }, [
    sandboxRuntimeDetail?.runtime.sandboxId,
    sandboxDetail?.sandboxId,
    sandboxFilePath,
    sandboxFileTargetKind,
    pushToast,
  ]);

  const deleteSandboxFileTarget = useCallback(async () => {
    const sandboxId = sandboxRuntimeDetail?.runtime.sandboxId || sandboxDetail?.sandboxId;
    const targetPath = normalizeSandboxPath(sandboxFilePath || sandboxDirectoryPath);
    const targetKind = sandboxFileTargetKind || 'dir';
    const treeRootPath = normalizeSandboxPath(sandboxFileTreeRootPath);
    if (!sandboxId || !targetPath) return;
    if (targetPath === '/' || targetPath === treeRootPath) {
      setSandboxFileStatus('不能删除当前文件树根目录');
      return;
    }

    const targetLabel = targetKind === 'dir' ? '目录' : '文件';
    const confirmed = window.confirm(`确定删除${targetLabel}：${targetPath}？此操作不可撤销。`);
    if (!confirmed) return;

    const refreshPath = parentPath(targetPath);
    setSandboxFileOperation('delete');
    setSandboxFileStatus(`正在删除${targetLabel} ${targetPath}`);
    try {
      await api.runSandboxToolAction(sandboxId, 'files.removeRecursive', {
        path: targetPath,
        requestTimeoutMs: 120000,
      });
      setSandboxFileExpandedPaths((prev) =>
        prev.map(normalizeSandboxPath).filter((path) => path !== targetPath && !path.startsWith(`${targetPath}/`))
      );
      setSandboxFileTreeItemsByPath((prev) => {
        const next = { ...prev };
        for (const path of Object.keys(next)) {
          if (path === targetPath || path.startsWith(`${targetPath}/`)) {
            delete next[path];
          }
        }
        return next;
      });
      await listSandboxFiles(refreshPath, { resetTreeRoot: !isPathWithin(sandboxFileTreeRootPath, refreshPath) });
      setSandboxFileStatus(`已删除${targetLabel} ${targetPath}`);
      pushToast('success', '删除完成', targetPath);
    } catch (toolError) {
      setSandboxFileStatus('删除失败');
      setError(toolError instanceof Error ? toolError.message : '删除失败');
    } finally {
      setSandboxFileOperation(null);
    }
  }, [
    sandboxRuntimeDetail?.runtime.sandboxId,
    sandboxDetail?.sandboxId,
    sandboxFilePath,
    sandboxDirectoryPath,
    sandboxFileTargetKind,
    sandboxFileTreeRootPath,
    listSandboxFiles,
    pushToast,
  ]);

  const inspectSandboxPorts = useCallback(async () => {
    const sandboxId = sandboxRuntimeDetail?.runtime.sandboxId || sandboxDetail?.sandboxId;
    if (!sandboxId) return;
    try {
      setError(null);
      const result = await api.runSandboxToolAction(sandboxId, 'system.ports.inspect');
      const fetchedAt = Date.now();
      setSandboxPortResult(result);
      setSandboxPortFetchedAt(fetchedAt);
      setSandboxToolSnapshotClock(fetchedAt);
    } catch (toolError) {
      setError(toolError instanceof Error ? toolError.message : '查看端口失败');
    }
  }, [sandboxRuntimeDetail?.runtime.sandboxId, sandboxDetail?.sandboxId]);

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
    setTemplateAliasDraft(templateAliasOf(detail));
  }, []);

  const runTemplateAction = useCallback(
    async (action: 'create' | 'update' | 'rebuild' | 'delete' | 'tags-assign' | 'tags-delete') => {
      const actionLabelMap: Record<typeof action, string> = {
        create: '创建模板',
        update: '更新模板',
        rebuild: '重建模板',
        delete: '删除模板',
        'tags-assign': '分配标签',
        'tags-delete': '删除标签',
      };

      try {
        const payload = templateActionPayload.trim()
          ? (JSON.parse(templateActionPayload) as Record<string, unknown>)
          : {};
        const payloadAlias = typeof payload.alias === 'string' ? payload.alias.trim() : '';
        const payloadName = typeof payload.name === 'string' ? payload.name.trim() : '';
        const reason = action === 'delete' || action === 'rebuild' ? window.prompt('请输入操作备注（必填）') : 'ok';
        if ((action === 'delete' || action === 'rebuild') && !reason) return;
        await runBlockingTask(
          `正在${actionLabelMap[action]}`,
          async () => {
            let createdTemplateId: string | null = null;
            if (action === 'create') {
              const created = await api.createTemplate(payload);
              createdTemplateId = templateIdOf(created as E2bTemplate);
            } else if (action === 'update' && templateDetail) {
              await api.updateTemplate(templateIdOf(templateDetail), payload);
            } else if (action === 'rebuild' && templateDetail) {
              await api.rebuildTemplate(templateIdOf(templateDetail), payload);
            } else if (action === 'delete' && templateDetail) {
              await api.deleteTemplate(templateIdOf(templateDetail));
            } else if (action === 'tags-assign') {
              await api.assignTemplateTags(payload);
            } else if (action === 'tags-delete') {
              await api.deleteTemplateTags(payload);
            }
            const refreshedTemplates = await loadTemplates();
            if (action === 'create') {
              const nextTemplateId =
                createdTemplateId
                || refreshedTemplates.find((item) => templateAliasOf(item) === payloadAlias)?.templateID
                || refreshedTemplates.find((item) => templateAliasOf(item) === payloadAlias)?.templateId
                || refreshedTemplates.find((item) => String((item as any).name ?? '').trim() === payloadName)?.templateID
                || refreshedTemplates.find((item) => String((item as any).name ?? '').trim() === payloadName)?.templateId
                || null;
              if (nextTemplateId) {
                await updateTemplateDetail(nextTemplateId);
                setTemplateWorkbenchMode('detail');
              }
            } else if (templateDetail && action === 'delete') {
              const nextTemplateId = refreshedTemplates
                .map((item) => templateIdOf(item))
                .find((item): item is string => Boolean(item));
              if (nextTemplateId) {
                await updateTemplateDetail(nextTemplateId);
              } else {
                setTemplateDetail(null);
                setTemplateAliasDraft('');
                setTemplateAliasResult(null);
                setTemplateBuildLogs(null);
                setTemplateBuildStatus(null);
              }
            } else if (templateDetail) {
              await updateTemplateDetail(templateIdOf(templateDetail));
            }
          },
          {
            successToast: `${actionLabelMap[action]}已完成`,
            fallbackError: '模板操作失败',
          }
        );
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : '模板操作失败');
      }
    },
    [templateActionPayload, templateDetail, loadTemplates, runBlockingTask, updateTemplateDetail]
  );

  const checkAlias = useCallback(async () => {
    if (!templateAliasDraft.trim()) return;
    try {
      await runBlockingTask(
        '正在检查模板别名',
        async () => {
          const result = await api.checkTemplateAlias(templateAliasDraft.trim());
          setTemplateAliasResult(result);
        },
        { fallbackError: '别名查询失败' }
      );
    } catch {
      // error is routed to banner and toast
    }
  }, [templateAliasDraft, runBlockingTask]);

  const saveTemplateAlias = useCallback(async () => {
    const templateId = templateIdOf(templateDetail);
    const alias = templateAliasDraft.trim();
    if (!templateId || !alias) return;

    try {
      await runBlockingTask(
        '正在保存模板别名',
        async () => {
          await api.updateTemplate(templateId, { alias });
          await loadTemplates();
          await updateTemplateDetail(templateId);
          setTemplateAliasResult(null);
        },
        {
          successToast: `模板别名已更新为 ${alias}`,
          fallbackError: '保存模板别名失败',
        }
      );
    } catch {
      // error is routed to banner and toast
    }
  }, [templateAliasDraft, templateDetail, loadTemplates, runBlockingTask, updateTemplateDetail]);

  const loadTemplateBuildLogs = useCallback(async (templateId: string, buildId: string) => {
    try {
      await runBlockingTask(
        '正在加载构建日志',
        async () => {
          const logs = await api.getTemplateBuildLogs(templateId, buildId);
          setTemplateBuildLogs(logs);
        },
        { fallbackError: '加载构建日志失败' }
      );
    } catch {
      // error is routed to banner and toast
    }
  }, [runBlockingTask]);

  const loadTemplateBuildStatus = useCallback(async (templateId: string, buildId: string) => {
    try {
      await runBlockingTask(
        '正在加载构建状态',
        async () => {
          const status = await api.getTemplateBuildStatus(templateId, buildId);
          setTemplateBuildStatus(status);
        },
        { fallbackError: '加载构建状态失败' }
      );
    } catch {
      // error is routed to banner and toast
    }
  }, [runBlockingTask]);

  useEffect(() => {
    auditFiltersRef.current = auditFilters;
  }, [auditFilters]);

  const loadAuditSection = useCallback(
    async (filters: AuditFilterState = auditFiltersRef.current) => {
      const requestVersion = ++auditRequestVersionRef.current;
      const result = await api.listAudit({
        query: filters.query.trim() || undefined,
        operator: filters.operator !== 'all' ? filters.operator : undefined,
        action: filters.action !== 'all' ? filters.action : undefined,
        result: filters.result !== 'all' ? filters.result : undefined,
        from: filters.from ? new Date(filters.from).toISOString() : undefined,
        to: filters.to ? new Date(filters.to).toISOString() : undefined,
        limit: 80,
        offset: 0,
      });
      if (requestVersion !== auditRequestVersionRef.current) {
        return;
      }
      setAuditEntries(result.entries);
      setAuditResponseMeta(result);
      setAuditSummaryFetchedAt(new Date().toISOString());
      setAuditSummaryClock(Date.now());
      setError(null);
    },
    []
  );

  const refreshAuditSummary = useCallback(async () => {
    setAuditSummaryRefreshing(true);
    try {
      await loadAuditSection();
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '刷新审计日志失败');
    } finally {
      setAuditSummaryRefreshing(false);
    }
  }, [loadAuditSection]);

  const openAuditDetail = useCallback(
    async (auditId: string) => {
      try {
        await runBlockingTask(
          '正在加载日志详情',
          async () => {
            const result = await api.getAuditDetail(auditId);
            setAuditDetail(result);
          },
          { fallbackError: '加载日志详情失败' }
        );
      } catch {
        // error is routed to banner and toast
      }
    },
    [runBlockingTask]
  );

  const loadSection = useCallback(
    async (section: SectionKey, initial = false) => {
      if (initial) {
        setLoading(true);
      }
      setRefreshing(true);

      try {
        if (section === 'kvm') {
          await Promise.all([loadKvmSection(), loadAuditSection()]);
        } else if (section === 'deployment') {
          setError(null);
        } else if (section === 'conversation') {
          await loadConversationSessions();
        } else if (section === 'user') {
          setError(null);
        } else if (section === 'agent') {
          await loadAgentSection();
        } else if (section === 'skill') {
          setError(null);
        } else if (section === 'connectorGuide') {
          setError(null);
        } else if (section === 'sandbox') {
          if (initial) {
            await loadSandboxSectionWithProgress();
          } else {
            await Promise.all([
              loadSandboxSection(),
              loadTemplates().catch(() => undefined),
            ]);
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
      loadAgentSection,
      loadAuditSection,
      loadConversationSessions,
      loadKvmSection,
      loadSandboxSection,
      loadSandboxSectionWithProgress,
      loadTemplates,
    ]
  );

  useEffect(() => {
    void bootstrapAdminSession();
  }, [bootstrapAdminSession]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      setSystemThemeTone(mediaQuery.matches ? 'dark' : 'light');
    };
    handleChange();
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  useEffect(() => {
    applyAdminTheme(currentTheme, currentThemeMode, systemThemeTone);
  }, [currentTheme, currentThemeMode, systemThemeTone]);

  useEffect(() => {
    if (!settingsMenuOpen) return undefined;
    const handlePointerDown = (event: MouseEvent) => {
      if (settingsMenuRef.current && !settingsMenuRef.current.contains(event.target as Node)) {
        setSettingsMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSettingsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [settingsMenuOpen]);

  useEffect(() => {
    if (authStatus !== 'authenticated') {
      return;
    }
    let stopped = false;
    void api
      .getAdminTheme()
      .then((settings) => {
        if (stopped) return;
        setThemeSettings(settings);
        setCurrentTheme(settings.currentTheme);
        setCurrentThemeMode(settings.currentMode);
        persistStoredAdminTheme(settings.currentTheme);
        persistStoredAdminThemeMode(settings.currentMode);
      })
      .catch((themeError) => {
        if (stopped) return;
        setError(themeError instanceof Error ? themeError.message : '外观设置加载失败');
      });
    return () => {
      stopped = true;
    };
  }, [authStatus]);

  useEffect(() => {
    if (!error) {
      lastErrorToastRef.current = null;
      return;
    }
    if (lastErrorToastRef.current === error) {
      return;
    }
    lastErrorToastRef.current = error;
    pushToast('error', '操作失败', error);
  }, [error, pushToast]);

  useEffect(() => {
    sandboxRegistryLimitRef.current = sandboxRegistryLimit;
  }, [sandboxRegistryLimit]);

  useEffect(() => {
    writeAdminUrlState({
      activeSection,
      deployment: deploymentManagementViewState,
      conversation: {
        query: conversationSearchQuery,
        status: conversationStatusFilter,
        stage: conversationStageFilter,
        user: conversationUserFilter,
        executor: conversationExecutorFilter,
        updatedFrom: conversationUpdatedFromDate,
        updatedTo: conversationUpdatedToDate,
        selectedSessionId,
      },
      sandbox: {
        tab: 'runtime',
        query: sandboxRuntimeQuery,
        executor: sandboxExecutorFilter,
        status: sandboxStatusFilter,
        risk: sandboxRiskFilter,
        selectedSandboxId: sandboxDeepLinkId,
        detailTab: sandboxDetailTab,
        modalOpen: sandboxModalOpen,
      },
      user: userManagementViewState,
      skill: skillManagementViewState,
      connectorGuide: connectorGuideManagementViewState,
      osacRelease: osacReleaseManagementViewState,
      audit: auditFilters,
    });
  }, [
    activeSection,
    auditFilters,
    connectorGuideManagementViewState,
    conversationExecutorFilter,
    deploymentManagementViewState,
    conversationSearchQuery,
    conversationStageFilter,
    conversationStatusFilter,
    conversationUpdatedFromDate,
    conversationUpdatedToDate,
    conversationUserFilter,
    sandboxDeepLinkId,
    sandboxDetailTab,
    sandboxExecutorFilter,
    sandboxModalOpen,
    sandboxRiskFilter,
    sandboxRuntimeQuery,
    sandboxStatusFilter,
    skillManagementViewState,
    selectedSessionId,
    userManagementViewState,
    osacReleaseManagementViewState,
  ]);

  useEffect(() => {
    const firstStageKey = agentOverview?.stageDistribution?.[0]?.stageKey || null;
    if (!selectedAgentStageKey || !(agentOverview?.stageDistribution || []).some((item) => item.stageKey === selectedAgentStageKey)) {
      setSelectedAgentStageKey(firstStageKey);
    }
  }, [agentOverview, selectedAgentStageKey]);

  useEffect(() => {
    if (authStatus !== 'authenticated') {
      return;
    }
    loadSection(activeSection, true);
  }, [activeSection, authStatus, loadSection]);

  useEffect(() => {
    if (!sandboxLiveSummary?.countedAt) {
      return;
    }
    const timer = window.setInterval(() => {
      setSandboxLiveSummaryClock(Date.now());
    }, 10000);
    return () => {
      window.clearInterval(timer);
    };
  }, [sandboxLiveSummary?.countedAt]);

  useEffect(() => {
    if (!conversationSummaryFetchedAt) {
      return;
    }
    const timer = window.setInterval(() => {
      setConversationSummaryClock(Date.now());
    }, 10000);
    return () => {
      window.clearInterval(timer);
    };
  }, [conversationSummaryFetchedAt]);

  useEffect(() => {
    if (!auditSummaryFetchedAt) {
      return;
    }
    const timer = window.setInterval(() => {
      setAuditSummaryClock(Date.now());
    }, 10000);
    return () => {
      window.clearInterval(timer);
    };
  }, [auditSummaryFetchedAt]);

  useEffect(() => {
    if (!loading || activeSection !== 'sandbox' || !sandboxLoadProgress.startedAt) {
      return;
    }
    setSandboxLoadProgressClock(Date.now());
    const timer = window.setInterval(() => {
      setSandboxLoadProgressClock(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [activeSection, loading, sandboxLoadProgress.startedAt]);

  useEffect(() => {
    if (authStatus !== 'authenticated') {
      return;
    }
    if (activeSection !== 'kvm' && activeSection !== 'sandbox') {
      return;
    }

    const timer = window.setInterval(() => {
      if (activeSection === 'sandbox') {
        const refresh =
          sandboxRegistryLimitRef.current > SANDBOX_RUNTIME_PAGE_SIZE
            ? () => Promise.all([loadSandboxOverview(), loadSandboxLiveSummary().catch(() => undefined)]).then(() => undefined)
            : loadSandboxSection;
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
  }, [activeSection, authStatus, loadKvmSection, loadSandboxLiveSummary, loadSandboxOverview, loadSandboxSection]);

  useEffect(() => {
    if (!sandboxModalOpen || sandboxDetailTab !== 'files') {
      return;
    }
    if (!sandboxDirectoryPath.trim()) {
      return;
    }
    if (sandboxFileItems.length > 0) {
      return;
    }
    void listSandboxFiles().catch((toolError) => {
      setError(toolError instanceof Error ? toolError.message : '加载目录失败');
    });
  }, [sandboxModalOpen, sandboxDetailTab, sandboxDirectoryPath, sandboxFileItems.length, listSandboxFiles]);

  useEffect(() => {
    if (!sandboxModalOpen || sandboxDetailTab !== 'processes') {
      return;
    }
    if (sandboxProcessToolView === 'processes' && !sandboxProcessResult) {
      void loadSandboxProcesses().catch((toolError) => {
        setError(toolError instanceof Error ? toolError.message : '加载进程失败');
      });
    }
    if (sandboxProcessToolView === 'ports' && !sandboxPortResult) {
      void inspectSandboxPorts().catch((toolError) => {
        setError(toolError instanceof Error ? toolError.message : '加载端口失败');
      });
    }
  }, [
    sandboxModalOpen,
    sandboxDetailTab,
    sandboxProcessToolView,
    sandboxProcessResult,
    sandboxPortResult,
    loadSandboxProcesses,
    inspectSandboxPorts,
  ]);

  useEffect(() => {
    if (!sandboxModalOpen || sandboxDetailTab !== 'processes') {
      return;
    }
    const activeFetchedAt = sandboxProcessToolView === 'processes' ? sandboxProcessFetchedAt : sandboxPortFetchedAt;
    if (!activeFetchedAt) {
      return;
    }
    setSandboxToolSnapshotClock(Date.now());
    const timer = window.setInterval(() => {
      setSandboxToolSnapshotClock(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [
    sandboxModalOpen,
    sandboxDetailTab,
    sandboxProcessToolView,
    sandboxProcessFetchedAt,
    sandboxPortFetchedAt,
  ]);

  useEffect(() => {
    if (authStatus !== 'authenticated') {
      return;
    }
    if (!selectedSessionId || (activeSection !== 'conversation' && !conversationDialog)) {
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

    if (activeSection === 'conversation') {
      void api.listConversationSessions(200)
        .then((sessions) => {
          if (!cancelled) {
            setConversationSessions(sessions.sessions);
          }
        })
        .catch(() => {
          // ignore list refresh error here; detail view has higher priority
        });
    }

    return () => {
      cancelled = true;
    };
  }, [activeSection, authStatus, conversationDialog, selectedSessionId]);

  useEffect(() => {
    const sessionId = conversationDetail?.session.id || null;
    if (!sessionId || conversationDialogTab !== 'billing') return;
    let cancelled = false;
    setConversationBillingLoading(true);
    void fetch(`/api/internal/billing/usage-logs?sessionId=${encodeURIComponent(sessionId)}&limit=100`, {
      credentials: 'include',
    })
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error || '会话计费信息加载失败');
        }
        return response.json();
      })
      .then((payload) => {
        if (cancelled) return;
        const items = Array.isArray(payload?.items) ? payload.items : [];
        setConversationBillingUsage({
          totalCredits: items.reduce((sum: number, item: any) => sum + Number(item.creditsConsumed || 0), 0),
          totalTokens: items.reduce((sum: number, item: any) => sum + Number(item.totalTokens || 0), 0),
          promptTokens: items.reduce((sum: number, item: any) => sum + Number(item.promptTokens || 0), 0),
          completionTokens: items.reduce((sum: number, item: any) => sum + Number(item.completionTokens || 0), 0),
          cachedPromptTokens: items.reduce((sum: number, item: any) => sum + Number(item.cachedPromptTokens || 0), 0),
          cacheCreationTokens: items.reduce((sum: number, item: any) => sum + Number(item.cacheCreationTokens || 0), 0),
          callCount: items.length,
          items,
        });
      })
      .catch((error) => {
        if (!cancelled) {
          setConversationBillingUsage(null);
          setError(error instanceof Error ? error.message : '会话计费信息加载失败');
        }
      })
      .finally(() => {
        if (!cancelled) setConversationBillingLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationDetail?.session.id, conversationDialogTab]);

  useEffect(() => {
    if (authStatus !== 'authenticated') {
      return;
    }
    if (!selectedSessionId || (activeSection !== 'conversation' && !conversationDialog)) {
      setConversationDeploymentSummary(null);
      setConversationDeploymentLoading(false);
      return;
    }

    let cancelled = false;
    setConversationDeploymentLoading(true);
    void api.getDeploymentDetail(selectedSessionId)
      .then((detail) => {
        if (cancelled) return;
        setConversationDeploymentSummary(detail);
      })
      .catch(() => {
        if (cancelled) return;
        setConversationDeploymentSummary(null);
      })
      .finally(() => {
        if (!cancelled) {
          setConversationDeploymentLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeSection, authStatus, conversationDialog, selectedSessionId]);

  useEffect(() => {
    if (authStatus !== 'authenticated') {
      return;
    }
    if (!selectedSessionId || (activeSection !== 'conversation' && !conversationDialog)) {
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
  }, [activeSection, authStatus, conversationDialog, selectedSessionId]);

  useEffect(() => {
    setConversationDialogTab('overview');
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

  const vmPieData = (kvmOverview?.vmStateDistribution ?? []).filter((item) => item.value > 0);
  const conversationSummary = (() => {
    const summary = {
      total: conversationSessions.length,
      waitingUser: 0,
      inProgress: 0,
      completed: 0,
      failed: 0,
      latestUpdatedAt: null as string | null,
    };

    for (const session of conversationSessions) {
      if (session.status === 'waiting_user') summary.waitingUser += 1;
      else if (session.status === 'in_progress') summary.inProgress += 1;
      else if (session.status === 'completed') summary.completed += 1;
      else if (session.status === 'failed') summary.failed += 1;

      const sessionUpdatedAt = new Date(session.updatedAt).getTime();
      const latestUpdatedAt = summary.latestUpdatedAt ? new Date(summary.latestUpdatedAt).getTime() : 0;
      if (Number.isFinite(sessionUpdatedAt) && sessionUpdatedAt > latestUpdatedAt) {
        summary.latestUpdatedAt = session.updatedAt;
      }
    }

    return summary;
  })();
  const conversationQuickStatusFilters = [
    { label: '全部', value: 'all', count: conversationSummary.total, meta: '全部会话' },
    { label: '进行中', value: 'in_progress', count: conversationSummary.inProgress, meta: '执行中或处理中' },
    { label: '待确认', value: 'waiting_user', count: conversationSummary.waitingUser, meta: '等待用户确认' },
    { label: '失败', value: 'failed', count: conversationSummary.failed, meta: '存在阻塞错误' },
    { label: '完成', value: 'completed', count: conversationSummary.completed, meta: '已完成会话' },
  ] as const;
  const conversationSummaryAge = formatCompactRelativeTime(conversationSummaryFetchedAt, conversationSummaryClock);
  const conversationStageOptions = uniqueSorted(conversationSessions.map((session) => session.stage));
  const conversationUserOptions = Array.from(
    conversationSessions.reduce<Map<string, { value: string; label: string; count: number }>>((map, session) => {
      const userValue = session.user?.id || '__unknown_user__';
      const userLabel = conversationUserLabel(session.user);
      const userMeta = session.user?.email || (session.user?.id && session.user.id !== userLabel ? session.user.id : '');
      const optionLabel = userMeta ? `${userLabel} · ${userMeta}` : userLabel;
      const existing = map.get(userValue);
      if (existing) {
        existing.count += 1;
        return map;
      }
      map.set(userValue, {
        value: userValue,
        label: optionLabel,
        count: 1,
        });
      return map;
    }, new Map()).values()
  ).sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, 'zh-Hans-CN', { sensitivity: 'base' }));
  const conversationExecutorOptions = Array.from(
    conversationSessions.reduce<Map<string, { value: string; label: string; count: number }>>((map, session) => {
      const executorValue = String(session.executor || '').trim().toLowerCase() || '__unknown_executor__';
      const existing = map.get(executorValue);
      if (existing) {
        existing.count += 1;
        return map;
      }
      map.set(executorValue, {
        value: executorValue,
        label: executorValue === '__unknown_executor__' ? '未记录处理方式' : executorLabel(executorValue),
        count: 1,
        });
      return map;
    }, new Map()).values()
  ).sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, 'zh-Hans-CN', { sensitivity: 'base' }));
  const conversationScopeFilterValue =
    conversationStatusFilter !== 'all'
      ? `status:${conversationStatusFilter}`
      : conversationStageFilter !== 'all'
        ? `stage:${conversationStageFilter}`
        : 'all';
  const activeConversationFilterLabels = [
    conversationStatusFilter !== 'all'
      ? `状态 ${conversationQuickStatusFilters.find((item) => item.value === conversationStatusFilter)?.label || conversationStatusFilter}`
      : '',
    conversationStageFilter !== 'all' ? `阶段 ${conversationStageLabel(conversationStageFilter)}` : '',
    conversationUserFilter !== 'all'
      ? `用户 ${conversationUserOptions.find((item) => item.value === conversationUserFilter)?.label || conversationUserFilter}`
      : '',
    conversationExecutorFilter !== 'all'
      ? `处理方式 ${conversationExecutorOptions.find((item) => item.value === conversationExecutorFilter)?.label || conversationExecutorFilter}`
      : '',
    conversationUpdatedFromDate ? `开始 ${conversationUpdatedFromDate}` : '',
    conversationUpdatedToDate ? `结束 ${conversationUpdatedToDate}` : '',
  ].filter(Boolean);
  const filteredConversationSessions = (() => {
    const query = conversationSearchQuery.trim().toLowerCase();
    const fromTime = conversationUpdatedFromDate ? new Date(`${conversationUpdatedFromDate}T00:00:00`).getTime() : null;
    const toTime = conversationUpdatedToDate ? new Date(`${conversationUpdatedToDate}T23:59:59.999`).getTime() : null;
    const filtered = conversationSessions.filter((session) => {
      if (conversationStatusFilter !== 'all' && session.status !== conversationStatusFilter) {
        return false;
      }
      if (conversationStageFilter !== 'all' && (session.stage || '') !== conversationStageFilter) {
        return false;
      }
      const sessionUserFilterValue = session.user?.id || '__unknown_user__';
      if (conversationUserFilter !== 'all' && sessionUserFilterValue !== conversationUserFilter) {
        return false;
      }
      const sessionExecutorFilterValue = String(session.executor || '').trim().toLowerCase() || '__unknown_executor__';
      if (conversationExecutorFilter !== 'all' && sessionExecutorFilterValue !== conversationExecutorFilter) {
        return false;
      }
      const updatedAt = new Date(session.updatedAt).getTime();
      if (fromTime !== null && (!Number.isFinite(updatedAt) || updatedAt < fromTime)) {
        return false;
      }
      if (toTime !== null && (!Number.isFinite(updatedAt) || updatedAt > toTime)) {
        return false;
      }
      if (!query) {
        return true;
      }
      const haystack = [
        session.id,
        session.title,
        session.user?.id || '',
        session.user?.displayName || '',
        session.user?.email || '',
        session.user?.ipAddress || '',
        session.pendingQuestion || '',
        session.stage || '',
        session.status,
        session.executor || '',
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });

    return filtered.sort((a, b) => {
      let delta = 0;
      if (conversationSort.key === 'session') {
        delta = (a.title || a.id || '').localeCompare(b.title || b.id || '', 'zh-Hans-CN', { sensitivity: 'base' });
      } else if (conversationSort.key === 'user') {
        delta = conversationUserLabel(a.user).localeCompare(conversationUserLabel(b.user), 'zh-Hans-CN', { sensitivity: 'base' });
      } else if (conversationSort.key === 'executor') {
        delta = executorLabel(a.executor || 'unknown').localeCompare(executorLabel(b.executor || 'unknown'), 'zh-Hans-CN', { sensitivity: 'base' });
      } else if (conversationSort.key === 'session_id') {
        delta = (a.id || '').localeCompare(b.id || '', 'zh-Hans-CN', { sensitivity: 'base' });
      } else if (conversationSort.key === 'status') {
        delta = (a.status || '').localeCompare(b.status || '', 'zh-Hans-CN', { sensitivity: 'base' });
      } else if (conversationSort.key === 'updated_at') {
        delta = toTimestamp(a.updatedAt) - toTimestamp(b.updatedAt);
      } else if (conversationSort.key === 'created_at') {
        delta = toTimestamp(a.createdAt) - toTimestamp(b.createdAt);
      }
      if (delta !== 0) return conversationSort.direction === 'asc' ? delta : -delta;
      return toTimestamp(b.updatedAt) - toTimestamp(a.updatedAt);
    });
  })();
  const conversationTabCounts = {
    transitions: conversationDetail?.trace?.stateTransitions?.length || 0,
    messages: conversationDetail?.messages.length || 0,
  };
  const conversationMessages = asArray(conversationDetail?.messages);
  const conversationRawMessages = sortRawMessagesForDiagnostics(conversationMessages);
  const conversationInteractionGroups = buildConversationInteractionGroups(conversationMessages);
  const conversationMessageSummary = (() => {
    const latestUserMessage = [...conversationMessages].reverse().find((message) =>
      ['user_input', 'user_response'].includes(String(message.messageType || ''))
    );
    const latestAssistantMessage = [...conversationMessages].reverse().find((message) =>
      ['assistant_message', 'agent_message', 'clarification_request'].includes(String(message.messageType || ''))
    );
    const latestFailure = [...conversationMessages].reverse().find(isFailureMessage);
    const latestClarification = [...conversationMessages].reverse().find(
      (message) => String(message.messageType || '') === 'clarification_request'
    );
    const latestStatusUpdate = [...conversationMessages].reverse().find(
      (message) => String(message.messageType || '') === 'status_update'
    );
    const failedToolNames = Array.from(
      new Set(
        conversationMessages
          .filter(isFailureMessage)
          .map((message) => messageToolName(message))
          .filter((value): value is string => Boolean(value))
      )
    );
    return {
      latestUserSummary: latestUserMessage ? messageContentPreview(latestUserMessage, 120) : '暂无用户输入',
      latestAssistantSummary: latestAssistantMessage ? messageContentPreview(latestAssistantMessage, 120) : '暂无主回复',
      latestFailureSummary: latestFailure ? messageContentPreview(latestFailure, 120) : '',
      latestFailureAt: latestFailure?.createdAt || null,
      latestClarificationSummary: latestClarification ? messageContentPreview(latestClarification, 120) : '',
      latestStatusStage: latestStatusUpdate ? metadataString(toRecord(latestStatusUpdate.metadata), 'stage') : null,
      userCount: conversationMessages.filter((message) => message.role === 'user').length,
      assistantCount: conversationMessages.filter((message) =>
        ['assistant_message', 'agent_message', 'clarification_request'].includes(String(message.messageType || ''))
      ).length,
      executionCount: conversationMessages.filter(
        (message) => isExecutionTraceMessage(message) || isOpencodeNoiseMessage(message)
      ).length,
      failureCount: conversationMessages.filter(isFailureMessage).length,
      failedToolNames,
    };
  })();
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
      total: auditResponseMeta.filteredTotal || auditEntries.length,
      success: auditEntries.filter((item) => item.result === 'success').length,
      failed: auditEntries.filter((item) => item.result !== 'success').length,
    };
  })();
  const auditSummaryAge = formatCompactRelativeTime(auditSummaryFetchedAt, auditSummaryClock);
  const sortedAuditEntries = [...auditEntries].sort((a, b) => {
    let delta = 0;
    if (auditSort.key === 'id') {
      delta = (a.id || '').localeCompare(b.id || '', 'zh-Hans-CN', { sensitivity: 'base' });
    } else if (auditSort.key === 'time') {
      delta = toTimestamp(a.timestamp) - toTimestamp(b.timestamp);
    } else if (auditSort.key === 'action') {
      delta = auditActionLabel(a.action).localeCompare(auditActionLabel(b.action), 'zh-Hans-CN', { sensitivity: 'base' });
    } else if (auditSort.key === 'result') {
      delta = auditResultLabel(a.result).localeCompare(auditResultLabel(b.result), 'zh-Hans-CN', { sensitivity: 'base' });
    } else if (auditSort.key === 'operator') {
      delta = (a.operator || '').localeCompare(b.operator || '', 'zh-Hans-CN', { sensitivity: 'base' });
    } else if (auditSort.key === 'target') {
      delta = (a.targetVmId || '').localeCompare(b.targetVmId || '', 'zh-Hans-CN', { sensitivity: 'base' });
    } else if (auditSort.key === 'session') {
      delta = (a.sessionId || '').localeCompare(b.sessionId || '', 'zh-Hans-CN', { sensitivity: 'base' });
    }
    if (delta !== 0) return auditSort.direction === 'asc' ? delta : -delta;
    return toTimestamp(b.timestamp) - toTimestamp(a.timestamp);
  });
  const selectedAgentStage =
    agentOverview?.stageDistribution.find((item) => item.stageKey === selectedAgentStageKey) ||
    agentOverview?.stageDistribution[0] ||
    null;
  const auditActionOptions = auditResponseMeta.availableActions || [];
  const auditOperatorOptions = auditResponseMeta.availableOperators || [];

  const stateTransitions = conversationDetail?.trace?.stateTransitions || [];
  const llmItems = conversationDetail?.trace?.llm || [];
  const conversationDetailedLogs = (() => {
    const entries = [
      ...conversationRawMessages.map((message) => ({
        id: `message-${message.id}`,
        timestamp: message.createdAt,
        entryType: 'conversation_message',
        level: messageDiagnosticLevel(message),
        summary: messageDiagnosticSummary(message),
        payload: {
          id: message.id,
          role: message.role,
          messageType: message.messageType,
          content: message.content,
          createdAt: message.createdAt,
          metadata: message.metadata,
        },
      })),
      ...llmItems.map((item) => ({
        id: `llm-${item.id}`,
        timestamp: item.createdAt,
        entryType: 'llm_trace',
        level: item.inferred ? 'info' : 'success',
        summary: `${item.stage} / ${item.source}`,
        payload: item,
      })),
    ].sort((left, right) => toTimestamp(right.timestamp) - toTimestamp(left.timestamp));

    return {
      sessionId: conversationDetail?.session.id || null,
      exportedAt: new Date().toISOString(),
      counts: {
        messages: conversationRawMessages.length,
        llm: llmItems.length,
        total: entries.length,
      },
      entries,
    };
  })();
  const primaryEnvironment = conversationDetail?.trace?.sandbox.primaryEnvironment ?? null;
  const relatedEnvironments = (conversationDetail?.trace?.sandbox.relatedEnvironments || []).filter(
    (environment) => environment.id !== primaryEnvironment?.id
  );
  const primaryEnvironmentSandboxId = environmentSandboxId(primaryEnvironment);
  const primaryEnvironmentExecutor = environmentExecutor(primaryEnvironment);
  const primaryEnvironmentArchiveStatus = environmentArchiveStatus(primaryEnvironment);
  const primaryEnvironmentReplacementId = environmentReplacementSandboxId(primaryEnvironment);
  const recentRelatedEnvironments = [...relatedEnvironments]
    .sort((left, right) => toTimestamp(right.updatedAt) - toTimestamp(left.updatedAt))
    .slice(0, 3);
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
  const transitionActiveFilterCount = [
    transitionQuery.trim() ? 'query' : '',
    transitionFilters.fromTime ? 'fromTime' : '',
    transitionFilters.toTime ? 'toTime' : '',
    transitionFilters.fromStage !== 'all' ? 'fromStage' : '',
    transitionFilters.toStage !== 'all' ? 'toStage' : '',
    transitionFilters.status !== 'all' ? 'status' : '',
    transitionFilters.phase !== 'all' ? 'phase' : '',
    transitionFilters.messageType !== 'all' ? 'messageType' : '',
    transitionFilters.role !== 'all' ? 'role' : '',
    transitionFilters.agent !== 'all' ? 'agent' : '',
    transitionFilters.tone !== 'all' ? 'tone' : '',
  ].filter(Boolean).length;
  const latestFilteredTransition = filteredTransitions[filteredTransitions.length - 1] || null;
  const latestRelatedEnvironmentUpdatedAt = recentRelatedEnvironments[0]?.updatedAt || primaryEnvironment?.updatedAt || null;
  const conversationReplayItems = buildConversationReplayItems(conversationMessages);
  const conversationDialogDetail =
    conversationDialog && conversationDetail?.session.id === conversationDialog.sessionId
      ? conversationDetail
      : null;
  const conversationDialogLoading = Boolean(conversationDialog) && !conversationDialogDetail;

  const renderConversationTransitionsPanel = () => {
    const stagePreview = transitionStats.stages.slice(0, 3).map((value) => conversationStageLabel(value)).join(' / ') || '无';
    const statusPreview = transitionStats.statuses.slice(0, 3).map((value) => statusLabel(value)).join(' / ') || '无';
    const phasePreview = transitionStats.phases.slice(0, 3).map((value) => conversationPhaseLabel(value)).join(' / ') || '无';

    return (
      <>
        <article className="sub-panel state-transition-overview">
          <div className="state-transition-overview-top">
            <div>
              <p className="section-tag">状态流转</p>
              <h3 className="state-transition-overview-title">会话状态机轨迹</h3>
              <p className="panel-caption state-transition-overview-caption">
                {latestFilteredTransition
                  ? `最近一次流转发生在 ${formatDateTime(latestFilteredTransition.at)}。`
                  : '当前没有可展示的流转记录。'}
              </p>
            </div>
            <div className="state-transition-overview-actions">
              <div className="panel-subtitle-actions">
                <button type="button" className={`toggle-btn ${transitionView === 'timeline' ? 'active' : ''}`} onClick={() => setTransitionView('timeline')}>
                  时间轴
                </button>
                <button type="button" className={`toggle-btn ${transitionView === 'list' ? 'active' : ''}`} onClick={() => setTransitionView('list')}>
                  列表
                </button>
              </div>
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

          <div className="state-transition-overview-stats">
            <article className="state-transition-overview-stat">
              <span>筛选后流转</span>
              <strong>{transitionStats.filtered}</strong>
              <small>总计 {transitionStats.total} 条</small>
            </article>
            <article className="state-transition-overview-stat">
              <span>命中阶段</span>
              <strong>{transitionStats.stages.length}</strong>
              <small>{stagePreview}</small>
            </article>
            <article className="state-transition-overview-stat">
              <span>命中状态</span>
              <strong>{transitionStats.statuses.length}</strong>
              <small>{statusPreview}</small>
            </article>
            <article className="state-transition-overview-stat">
              <span>命中阶段相位</span>
              <strong>{transitionStats.phases.length}</strong>
              <small>{phasePreview}</small>
            </article>
          </div>

          <div className="state-transition-overview-meta">
            <span className="session-status">筛选条件 {transitionActiveFilterCount}</span>
            <span className="session-status">{transitionView === 'timeline' ? '时间轴视图' : '列表视图'}</span>
            {latestFilteredTransition?.trigger?.messageType ? (
              <span className="session-status">
                最近触发 {conversationMessageTypeLabel(latestFilteredTransition.trigger.messageType)}
              </span>
            ) : null}
          </div>
        </article>

        <div className="state-filter state-filter-modern">
          <div className="state-filter-summary-row">
            <p className="panel-caption state-filter-caption">按时间、阶段或消息内容定位关键流转。</p>
            <button type="button" className="secondary-btn" onClick={() => setTransitionAdvancedFiltersOpen((prev) => !prev)}>
              {transitionAdvancedFiltersOpen ? '收起高级筛选' : '展开高级筛选'}
            </button>
          </div>
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
                <span>阶段相位</span>
                <select value={transitionFilters.phase} onChange={(event) => setTransitionFilters((prev) => ({ ...prev, phase: event.target.value }))}>
                  <option value="all">全部</option>
                  {transitionOptions.phases.map((value) => <option key={value} value={value}>{conversationPhaseLabel(value)}</option>)}
                </select>
              </label>
              <label className="state-filter-field">
                <span>消息类型</span>
                <select value={transitionFilters.messageType} onChange={(event) => setTransitionFilters((prev) => ({ ...prev, messageType: event.target.value }))}>
                  <option value="all">全部</option>
                  {transitionOptions.messageTypes.map((value) => <option key={value} value={value}>{conversationMessageTypeLabel(value)}</option>)}
                </select>
              </label>
              <label className="state-filter-field">
                <span>角色</span>
                <select value={transitionFilters.role} onChange={(event) => setTransitionFilters((prev) => ({ ...prev, role: event.target.value }))}>
                  <option value="all">全部</option>
                  {transitionOptions.roles.map((value) => <option key={value} value={value}>{conversationRoleLabel(value)}</option>)}
                </select>
              </label>
              <label className="state-filter-field">
                <span>智能体</span>
                <select value={transitionFilters.agent} onChange={(event) => setTransitionFilters((prev) => ({ ...prev, agent: event.target.value }))}>
                  <option value="all">全部</option>
                  {transitionOptions.agents.map((value) => <option key={value} value={value}>{conversationAgentLabel(value)}</option>)}
                </select>
              </label>
              <label className="state-filter-field">
                <span>语气</span>
                <select value={transitionFilters.tone} onChange={(event) => setTransitionFilters((prev) => ({ ...prev, tone: event.target.value }))}>
                  <option value="all">全部</option>
                  {transitionOptions.tones.map((value) => <option key={value} value={value}>{conversationToneLabel(value)}</option>)}
                </select>
              </label>
            </div>
          ) : null}
        </div>

        {transitionView === 'timeline' ? (
          <div className="state-timeline">
            {filteredTransitions.length === 0 ? (
              <p className="empty">当前筛选条件下无状态流转记录。</p>
            ) : (
              filteredTransitions.map((transition, index) => {
                const trigger = transition.trigger || {};
                const triggerTags = [
                  trigger.messageType ? `消息 ${conversationMessageTypeLabel(trigger.messageType)}` : '',
                  trigger.role ? `角色 ${conversationRoleLabel(trigger.role)}` : '',
                  trigger.agent ? `智能体 ${conversationAgentLabel(trigger.agent)}` : '',
                  trigger.tone ? `语气 ${conversationToneLabel(trigger.tone)}` : '',
                  trigger.messageId ? `消息 ID ${trigger.messageId}` : '',
                ].filter(Boolean);
                const prev = index > 0 ? filteredTransitions[index - 1] : null;
                const gap =
                  prev?.at && transition.at
                    ? formatDuration(Date.parse(transition.at) - Date.parse(prev.at))
                    : '-';
                const transitionNumber = String(index + 1).padStart(2, '0');
                const fromStage = conversationStageLabel(transition.from?.stage);
                const toStage = conversationStageLabel(transition.to?.stage);
                const toStatus = statusLabel(transition.to?.status || 'unknown');
                const toPhase = transition.to?.phase ? conversationPhaseLabel(transition.to.phase) : '-';
                return (
                  <article key={`${transition.at || 'transition'}-${index}`} className="state-timeline-item">
                    <div className="state-timeline-rail" aria-hidden="true">
                      <span className="state-timeline-step mono">{transitionNumber}</span>
                    </div>
                    <div className="state-timeline-card">
                      <div className="state-timeline-head">
                        <div className="state-timeline-title-block">
                          <span className={traceLevelClass('info')}>状态</span>
                          <strong className="state-timeline-title">{`${fromStage} → ${toStage}`}</strong>
                        </div>
                        <div className="state-timeline-time">
                          <span>{formatDateTime(transition.at)}</span>
                          <span className="state-gap">间隔 {gap}</span>
                        </div>
                      </div>
                      <div className="state-transition-flow">
                        <span className="state-chip from">{fromStage}</span>
                        <span className="state-flow-arrow" aria-hidden="true">→</span>
                        <span className="state-chip status">{toStatus}</span>
                        <span className="state-flow-arrow" aria-hidden="true">→</span>
                        <span className="state-chip phase">{toPhase}</span>
                        <span className="state-flow-arrow" aria-hidden="true">→</span>
                        <span className="state-chip to">{toStage}</span>
                      </div>
                      <div className="state-timeline-meta">
                        <span>
                          <small>变更前</small>
                          <strong className="mono">{formatStateSnapshot(transition.from)}</strong>
                        </span>
                        <span>
                          <small>变更后</small>
                          <strong className="mono">{formatStateSnapshot(transition.to)}</strong>
                        </span>
                      </div>
                      <div className="state-trigger-stack">
                        {triggerTags.length ? (
                          <div className="state-trigger-badges">
                            {triggerTags.map((tag) => (
                              <span key={`${transitionNumber}-${tag}`} className="state-trigger-badge">
                                {tag}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        {trigger.content ? (
                          <div className="state-trigger-content-card">
                            <span className="state-trigger-content-label">触发内容</span>
                            <p className="state-trigger-line">{summarizeText(trigger.content, 240)}</p>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        ) : (
          <div className="trace-list">
            {filteredTransitions.map((transition, index) => {
              const trigger = transition.trigger || {};
              const triggerTags = [
                trigger.messageType ? `消息 ${conversationMessageTypeLabel(trigger.messageType)}` : '',
                trigger.role ? `角色 ${conversationRoleLabel(trigger.role)}` : '',
                trigger.agent ? `智能体 ${conversationAgentLabel(trigger.agent)}` : '',
                trigger.tone ? `语气 ${conversationToneLabel(trigger.tone)}` : '',
                trigger.messageId ? `消息 ID ${trigger.messageId}` : '',
              ].filter(Boolean);
              return (
                <article key={`${transition.at || 'transition'}-${index}`} className="trace-item state-transition-list-item">
                  <p className="trace-head">
                    <span className={traceLevelClass('info')}>状态</span>
                    <strong>{`${conversationStageLabel(transition.from?.stage)} → ${conversationStageLabel(transition.to?.stage)}`}</strong>
                    <span>{formatDateTime(transition.at)}</span>
                  </p>
                  <p className="trace-meta mono">{formatStateSnapshot(transition.from)} → {formatStateSnapshot(transition.to)}</p>
                  {triggerTags.length ? (
                    <div className="state-trigger-badges">
                      {triggerTags.map((tag) => (
                        <span key={`${index}-${tag}`} className="state-trigger-badge">
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {trigger.content ? <p className="state-trigger-line">{summarizeText(trigger.content, 240)}</p> : null}
                </article>
              );
            })}
          </div>
        )}
      </>
    );
  };

  const renderJsonWithLineNumbers = (value: unknown) => {
    const lines = toJsonText(value).split('\n');
    return (
      <pre className="json-block conversation-detailed-logs-json">
        {lines.map((line, index) => (
          <span key={`json-line-${index}`} className="conversation-detailed-logs-line">
            <span className="conversation-detailed-logs-line-number">{index + 1}</span>
            <code>{line || ' '}</code>
          </span>
        ))}
      </pre>
    );
  };

  const renderConversationDetailedLogsPanel = () => (
    <div className="conversation-detailed-logs-stack">
      <article className="sub-panel conversation-detailed-logs-summary">
        <div className="conversation-detailed-logs-summary-top">
          <div>
            <p className="section-tag">原始日志</p>
            <h3 className="conversation-detailed-logs-title">结构化导出视图</h3>
            <p className="panel-caption conversation-detailed-logs-caption">
              保留完整结构，先给出消息量、LLM 轨迹和最近记录时间，再进入 JSON 正文。
            </p>
          </div>
          <div className="conversation-detailed-logs-meta">
            <span className="session-status">会话 {conversationDetailedLogs.sessionId || '-'}</span>
            <span className="session-status">导出 {formatDateTime(conversationDetailedLogs.exportedAt)}</span>
          </div>
        </div>
        <div className="conversation-detailed-logs-stat-strip">
          <article className="conversation-detailed-logs-stat">
            <span>消息记录</span>
            <strong>{conversationDetailedLogs.counts.messages}</strong>
            <small>用户、智能体与系统消息</small>
          </article>
          <article className="conversation-detailed-logs-stat">
            <span>LLM 轨迹</span>
            <strong>{conversationDetailedLogs.counts.llm}</strong>
            <small>模型调用与推断条目</small>
          </article>
          <article className="conversation-detailed-logs-stat">
            <span>总载荷</span>
            <strong>{conversationDetailedLogs.counts.total}</strong>
            <small>当前导出结构中的全部条目</small>
          </article>
          <article className="conversation-detailed-logs-stat">
            <span>最近记录</span>
            <strong>{formatDateTime(conversationDetailedLogs.entries[0]?.timestamp)}</strong>
            <small>{conversationDetailedLogs.entries[0]?.summary || '当前没有日志条目'}</small>
          </article>
        </div>
      </article>

      <article className="sub-panel conversation-detailed-logs-panel">
        <div className="conversation-detailed-logs-panel-head">
          <div>
            <h3>JSON 正文</h3>
            <p className="panel-caption">左侧行号固定，便于定位字段和复制排障信息。</p>
          </div>
          <span className="session-status">只读视图</span>
        </div>
        <div className="conversation-detailed-logs-shell">
          {renderJsonWithLineNumbers(conversationDetailedLogs)}
        </div>
      </article>
    </div>
  );

  const renderConversationInfraPanel = () => {
    if (!conversationDetail) {
      return <p className="empty">选择会话后，可在这里查看来源用户和主 Sandbox 的关联信息。</p>;
    }

    const sourceUser = conversationDetail.session.user;

    return (
      <div className="conversation-inspector-content conversation-dialog-infra conversation-dialog-infra-compact conversation-infra-layout">
        {conversationInfraError ? (
          <p className="panel-caption">关联信息加载异常：{conversationInfraError}</p>
        ) : null}
        <article className="sub-panel conversation-infra-panel conversation-infra-panel-identity">
          <div className="conversation-infra-panel-top">
            <div>
              <p className="section-tag">会话身份</p>
              <h3 className="conversation-infra-panel-title">{conversationUserLabel(sourceUser)}</h3>
              <p className="panel-caption conversation-infra-caption">
                {sourceUser?.email || '当前没有可识别邮箱'}{sourceUser?.source ? ` · ${conversationUserSourceLabel(sourceUser.source)}` : ''}
              </p>
            </div>
            <div className="conversation-infra-pill-row">
              <span className={stateClassName(conversationDetail.session.status)}>{statusLabel(conversationDetail.session.status)}</span>
              <span className="session-status">{conversationStageLabel(conversationDetail.session.stage)}</span>
            </div>
          </div>
          <div className="conversation-infra-kv-grid">
            <div>
              <span>来源用户</span>
              <strong>{conversationUserLabel(sourceUser)}</strong>
            </div>
            <div>
              <span>来源 IP</span>
              <strong className="mono">{sourceUser?.ipAddress || '-'}</strong>
            </div>
            <div>
              <span>最近活跃</span>
              <strong>{formatDateTime(conversationDetail.session.updatedAt)}</strong>
            </div>
            <div>
              <span>最近访问来源</span>
              <strong>{conversationUserSourceLabel(sourceUser?.source)}</strong>
            </div>
          </div>
          {sourceUser?.userAgent ? (
            <p className="conversation-infra-footnote">{conversationUserAgentLabel(sourceUser.userAgent)}</p>
          ) : null}
        </article>

        <article className="sub-panel conversation-infra-panel conversation-infra-panel-runtime">
          <div className="conversation-infra-panel-top">
            <div>
              <p className="section-tag">运行绑定</p>
              <h3 className="conversation-infra-panel-title">{primaryEnvironmentSandboxId || '当前还没有主 Sandbox'}</h3>
              <p className="panel-caption conversation-infra-caption">
                {primaryEnvironmentSandboxId ? '主 Sandbox、编排会话和最近关联实例都收在这里。' : '当前会话尚未绑定可排查的主 Sandbox。'}
              </p>
            </div>
            <div className="conversation-infra-pill-row">
              <span className="session-status">{executorLabel(primaryEnvironmentExecutor)}</span>
              <span className="session-status">{archiveStatusLabel(primaryEnvironmentArchiveStatus)}</span>
            </div>
          </div>
          {primaryEnvironmentSandboxId ? (
            <div className="conversation-infra-binding-hero">
              <div className="conversation-infra-binding-copy">
                <span className="conversation-infra-binding-label">主 Sandbox</span>
                <button type="button" className="link-btn sandbox-jump-btn mono conversation-infra-binding-id" onClick={() => openSandboxFromConversation(primaryEnvironmentSandboxId)}>
                  {primaryEnvironmentSandboxId}
                </button>
              </div>
              <div className="conversation-infra-binding-summary">
                <span>{executorLabel(primaryEnvironmentExecutor)}</span>
                <span>{archiveStatusLabel(primaryEnvironmentArchiveStatus)}</span>
                <span>{relatedEnvironments.length} 条关联记录</span>
              </div>
            </div>
          ) : (
            <div className="conversation-infra-binding-hero conversation-infra-binding-hero-empty">
              <p className="conversation-infra-empty">当前还没有主 Sandbox 关联。</p>
            </div>
          )}
          <div className="conversation-infra-kv-grid">
            <div>
              <span>编排会话 ID</span>
              {conversationDetail.runtime?.orchestratorSessionId ? (
                <button type="button" className="link-btn sandbox-jump-btn mono" onClick={() => openSandboxFromConversation(conversationDetail.runtime?.orchestratorSessionId)}>
                  {conversationDetail.runtime.orchestratorSessionId}
                </button>
              ) : (
                <strong className="mono">-</strong>
              )}
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
              <span>处理方式</span>
              <strong>{executorLabel(primaryEnvironmentExecutor)}</strong>
            </div>
            <div>
              <span>归档状态</span>
              <strong>{archiveStatusLabel(primaryEnvironmentArchiveStatus)}</strong>
            </div>
            <div>
              <span>关联记录数</span>
              <strong>{relatedEnvironments.length}</strong>
            </div>
            <div>
              <span>最近绑定变更</span>
              <strong>{formatDateTime(latestRelatedEnvironmentUpdatedAt)}</strong>
            </div>
          </div>
          {primaryEnvironmentReplacementId ? (
            <div className="conversation-infra-note">
              <span className="conversation-infra-note-label">接管 Sandbox</span>
              <button type="button" className="link-btn sandbox-jump-btn mono" onClick={() => openSandboxFromConversation(primaryEnvironmentReplacementId)}>
                {primaryEnvironmentReplacementId}
              </button>
            </div>
          ) : null}
          {recentRelatedEnvironments.length ? (
            <div className="conversation-infra-related-section">
              <div className="panel-subtitle panel-subtitle-row">
                <span>最近关联的 Sandbox</span>
                <span className="panel-caption">最近 {recentRelatedEnvironments.length} 条</span>
              </div>
              <div className="compact-list conversation-infra-related-list">
                {recentRelatedEnvironments.map((environment) => {
                  const sandboxId = environmentSandboxId(environment);
                  return (
                    <article key={environment.id} className="compact-item conversation-infra-related-item">
                      <div className="conversation-infra-related-head">
                        <strong>{sandboxId || '-'}</strong>
                        <span className="mono">{formatDateTime(environment.updatedAt)}</span>
                      </div>
                      <div className="conversation-infra-related-main">
                        <span>{sandboxRuntimeStateLabel(environment.status)}</span>
                        <span>{executorLabel(environmentExecutor(environment))}</span>
                        <span>{archiveStatusLabel(environmentArchiveStatus(environment))}</span>
                      </div>
                      {sandboxId ? (
                        <button type="button" className="link-btn sandbox-jump-btn mono conversation-infra-related-link" onClick={() => openSandboxFromConversation(sandboxId)}>
                          打开 {sandboxId}
                        </button>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </div>
          ) : null}
        </article>
      </div>
    );
  };

  const renderConversationBillingPanel = () => {
    if (conversationBillingLoading) {
      return <p className="empty">正在加载会话计费信息...</p>;
    }
    if (!conversationBillingUsage) {
      return <p className="empty">当前会话暂无计费记录</p>;
    }
    return (
      <div className="conversation-dialog-overview conversation-dialog-overview-layout">
        <article className="sub-panel conversation-dialog-overview-hero">
          <div className="conversation-dialog-overview-top">
            <div>
              <p className="section-tag">计费摘要</p>
              <h3 className="conversation-dialog-overview-title">{conversationDetail?.session.title || '未命名会话'}</h3>
              <p className="conversation-dialog-overview-subtitle mono">{conversationDetail?.session.id || '-'}</p>
            </div>
          </div>
          <div className="conversation-dialog-overview-stat-grid">
            <div>
              <span>积分消耗</span>
              <strong>{conversationBillingUsage.totalCredits.toLocaleString()}</strong>
            </div>
            <div>
              <span>Total tokens</span>
              <strong>{conversationBillingUsage.totalTokens.toLocaleString()}</strong>
            </div>
            <div>
              <span>缓存命中</span>
              <strong>{conversationBillingUsage.cachedPromptTokens.toLocaleString()}</strong>
            </div>
            <div>
              <span>调用次数</span>
              <strong>{conversationBillingUsage.callCount.toLocaleString()}</strong>
            </div>
          </div>
        </article>

        <article className="sub-panel conversation-dialog-overview-card">
          <div className="panel-subtitle">Token 构成</div>
          <dl className="conversation-dialog-overview-facts">
            <div><dt>输入 tokens</dt><dd>{conversationBillingUsage.promptTokens.toLocaleString()}</dd></div>
            <div><dt>输出 tokens</dt><dd>{conversationBillingUsage.completionTokens.toLocaleString()}</dd></div>
            <div><dt>缓存创建 tokens</dt><dd>{conversationBillingUsage.cacheCreationTokens.toLocaleString()}</dd></div>
            <div><dt>缓存命中 tokens</dt><dd>{conversationBillingUsage.cachedPromptTokens.toLocaleString()}</dd></div>
          </dl>
        </article>

        <article className="sub-panel conversation-dialog-overview-card">
          <div className="panel-subtitle">调用明细</div>
          {conversationBillingUsage.items.length > 0 ? (
            <div className="compact-list conversation-infra-related-list">
              {conversationBillingUsage.items.map((item) => (
                <article key={item.id} className="compact-item conversation-infra-related-item">
                  <div className="conversation-infra-related-head">
                    <strong>{item.creditsConsumed.toLocaleString()} credits</strong>
                    <span className="mono">{formatDateTime(item.createdAt)}</span>
                  </div>
                  <div className="conversation-infra-related-main">
                    <span>{Number(item.totalTokens || item.promptTokens + item.completionTokens).toLocaleString()} tokens</span>
                    <span>输入 {item.promptTokens.toLocaleString()}</span>
                    <span>输出 {item.completionTokens.toLocaleString()}</span>
                    <span>缓存命中 {item.cachedPromptTokens.toLocaleString()}</span>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="empty">当前会话暂无调用明细</p>
          )}
        </article>
      </div>
    );
  };

  const renderConversationContentOverview = () => {
    const sourceUser = conversationDetail?.session.user || null;
    const latestPendingQuestion = conversationDetail?.runtime?.pendingQuestion || conversationMessageSummary.latestClarificationSummary;
    const conversationStatusText = conversationDetail ? statusLabel(conversationDetail.session.status) : '-';
    const conversationStageText = conversationDetail ? conversationStageLabel(conversationDetail.session.stage) : '-';
    return (
      <div className="conversation-dialog-overview conversation-dialog-overview-layout">
        <article className="sub-panel conversation-dialog-overview-hero">
          <div className="conversation-dialog-overview-top">
            <div>
              <p className="section-tag">会话总览</p>
              <h3 className="conversation-dialog-overview-title">{conversationDetail?.session.title || '未命名会话'}</h3>
              <p className="conversation-dialog-overview-subtitle mono">{conversationDetail?.session.id || '-'}</p>
            </div>
            <div className="conversation-dialog-overview-badges">
              <span className={stateClassName(conversationDetail?.session.status || 'unknown')}>
                {conversationStatusText}
              </span>
              {conversationStageText !== conversationStatusText ? (
                <span className="session-status">{conversationStageText}</span>
              ) : null}
              <span className="session-status">{conversationUserSourceLabel(sourceUser?.source)}</span>
            </div>
          </div>

          <div className="conversation-dialog-overview-stats">
            <article className="conversation-dialog-overview-stat">
              <span>最近更新</span>
              <strong>{formatDateTime(conversationDetail?.session.updatedAt || conversationDetail?.runtime?.bindingUpdatedAt)}</strong>
              <small>当前会话的最近更新时间</small>
            </article>
            <article className="conversation-dialog-overview-stat">
              <span>对话消息</span>
              <strong>{conversationTabCounts.messages}</strong>
              <small>用户与智能体消息总数</small>
            </article>
            <article className="conversation-dialog-overview-stat">
              <span>执行事件</span>
              <strong>{conversationMessageSummary.executionCount}</strong>
              <small>工具与执行节点记录</small>
            </article>
            <article className="conversation-dialog-overview-stat">
              <span>状态流转</span>
              <strong>{conversationTabCounts.transitions}</strong>
              <small>{transitionStats.stages.length ? `覆盖 ${transitionStats.stages.length} 个阶段` : '当前无流转记录'}</small>
            </article>
          </div>

          <dl className="conversation-dialog-overview-facts">
            <div>
              <dt>OpenCode 会话</dt>
              <dd className="mono">{conversationDetail?.runtime?.opencodeSessionId || '-'}</dd>
            </div>
            <div>
              <dt>编排会话</dt>
              <dd>
                {conversationDetail?.runtime?.orchestratorSessionId ? (
                  <button
                    type="button"
                    className="link-btn sandbox-jump-btn mono"
                    onClick={() => openSandboxFromConversation(conversationDetail.runtime?.orchestratorSessionId)}
                  >
                    {conversationDetail.runtime.orchestratorSessionId}
                  </button>
                ) : (
                  <span className="mono">-</span>
                )}
              </dd>
            </div>
            <div>
              <dt>挂起原因</dt>
              <dd>{conversationDetail?.runtime?.pendingResume?.reason || '-'}</dd>
            </div>
            <div>
              <dt>待确认问题</dt>
              <dd>{latestPendingQuestion ? summarizeText(latestPendingQuestion, 120) : '当前无需补充信息'}</dd>
            </div>
          </dl>
        </article>

        <div className="conversation-dialog-overview-side">
          <section className="sub-panel conversation-user-panel conversation-dialog-side-panel">
          <div className="panel-header">
            <div>
              <h3>来源用户</h3>
              <p className="panel-caption">对话归属与最近访问来源。</p>
            </div>
            <span className="session-status">{conversationUserSourceLabel(sourceUser?.source)}</span>
          </div>
          <div className="detail-grid conversation-user-grid">
            <div>
              <p className="kpi-title">用户</p>
              <p>{conversationUserLabel(sourceUser)}</p>
            </div>
            <div>
              <p className="kpi-title">邮箱</p>
              <p>{sourceUser?.email || '-'}</p>
            </div>
            <div>
              <p className="kpi-title">来源 IP</p>
              <p className="mono">{sourceUser?.ipAddress || '-'}</p>
            </div>
            <div>
              <p className="kpi-title">最近访问</p>
              <p>{formatDateTime(sourceUser?.lastSeenAt || sourceUser?.sessionCreatedAt)}</p>
            </div>
          </div>
          <p className="conversation-user-agent">{conversationUserAgentLabel(sourceUser?.userAgent)}</p>
          </section>

          <section className="sub-panel conversation-dialog-side-panel">
            <div className="panel-header">
              <div>
                <h3>部署摘要</h3>
                <p className="panel-caption">当前会话的部署状态与访问入口。</p>
              </div>
              {conversationDeploymentSummary ? (
                <span className={`state-chip ${deploymentStatusTone(conversationDeploymentSummary.statusCategory)}`}>
                  {deploymentStatusLabel(conversationDeploymentSummary.statusCategory)}
                </span>
              ) : null}
            </div>
            {conversationDeploymentLoading ? (
              <p className="panel-caption">正在加载部署状态...</p>
            ) : conversationDeploymentSummary ? (
              <>
                <div className="detail-grid conversation-message-summary-grid">
                  <div>
                    <p className="kpi-title">项目 / 服务</p>
                    <p>{conversationDeploymentSummary.projectName || '-'} / {conversationDeploymentSummary.serviceName || '-'}</p>
                  </div>
                  <div>
                    <p className="kpi-title">最新状态</p>
                    <p>{conversationDeploymentSummary.latestStatus || conversationDeploymentSummary.bindingState}</p>
                  </div>
                  <div>
                    <p className="kpi-title">访问地址</p>
                    <p>{conversationDeploymentSummary.latestUrl || conversationDeploymentSummary.latestStaticUrl || '-'}</p>
                  </div>
                  <div>
                    <p className="kpi-title">最近验证</p>
                    <p>{formatDateTime(conversationDeploymentSummary.lastVerifiedAt)}</p>
                  </div>
                </div>
                <div className="section-actions">
                  <button type="button" className="table-btn" onClick={() => openDeploymentFromConversation(conversationDeploymentSummary.taskSessionId)}>
                    打开部署管理
                  </button>
                </div>
              </>
            ) : (
              <div className="section-actions">
                <p className="panel-caption">当前会话暂无部署记录。</p>
                {conversationDetail?.session.id ? (
                  <button type="button" className="table-btn" onClick={() => openDeploymentFromConversation(conversationDetail.session.id)}>
                    前往部署管理
                  </button>
                ) : null}
              </div>
            )}
          </section>

          <section className="sub-panel conversation-message-summary conversation-dialog-message-summary conversation-dialog-side-panel">
            <div className="detail-grid conversation-message-summary-grid">
              <div>
                <p className="kpi-title">最近用户输入</p>
                <p>{conversationMessageSummary.latestUserSummary}</p>
              </div>
              <div>
                <p className="kpi-title">最近主回复</p>
                <p>{conversationMessageSummary.latestAssistantSummary}</p>
              </div>
              <div>
                <p className="kpi-title">最近轮次结果</p>
                <p>{conversationInteractionGroups[conversationInteractionGroups.length - 1]?.outcome || '暂无'}</p>
              </div>
              <div>
                <p className="kpi-title">最近阶段</p>
                <p>{conversationStageLabel(conversationMessageSummary.latestStatusStage || conversationDetail?.session.stage)}</p>
              </div>
            </div>
            {latestPendingQuestion ? (
              <div className="conversation-message-inline-card">
                <p className="kpi-title">当前待确认问题</p>
                <p className="message-content">{latestPendingQuestion}</p>
              </div>
            ) : null}
          </section>
        </div>
      </div>
    );
  };

  const renderConversationMessageSummaryCard = () => (
    <section className="sub-panel conversation-message-summary conversation-dialog-message-summary">
      <div className="detail-grid conversation-message-summary-grid">
        <div>
          <p className="kpi-title">最近用户输入</p>
          <p>{conversationMessageSummary.latestUserSummary}</p>
        </div>
        <div>
          <p className="kpi-title">当前会话状态</p>
          <p>{conversationDetail ? statusLabel(conversationDetail.session.status) : '-'}</p>
        </div>
        <div>
          <p className="kpi-title">最近轮次结果</p>
          <p>{conversationInteractionGroups[conversationInteractionGroups.length - 1]?.outcome || '暂无'}</p>
        </div>
        <div>
          <p className="kpi-title">最近阶段</p>
          <p>{conversationStageLabel(conversationMessageSummary.latestStatusStage || conversationDetail?.session.stage)}</p>
        </div>
      </div>
      {conversationMessageSummary.latestClarificationSummary || conversationDetail?.runtime?.pendingQuestion ? (
        <div className="conversation-message-inline-card">
          <p className="kpi-title">当前待确认问题</p>
          <p className="message-content">
            {conversationDetail?.runtime?.pendingQuestion || conversationMessageSummary.latestClarificationSummary}
          </p>
          {conversationDetail?.runtime?.pendingOptions?.length ? (
            <div className="conversation-message-summary-stats">
              {conversationDetail.runtime.pendingOptions.map((option) => (
                <span key={option} className="session-status">{option}</span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="conversation-message-summary-stats">
        <span className="session-status">用户消息 {conversationMessageSummary.userCount}</span>
        <span className="session-status">主回复 {conversationMessageSummary.assistantCount}</span>
        <span className="session-status">执行事件 {conversationMessageSummary.executionCount}</span>
        <span className={`session-status ${conversationMessageSummary.failureCount > 0 ? 'state-error' : ''}`}>
          失败事件 {conversationMessageSummary.failureCount}
        </span>
        {conversationMessageSummary.failedToolNames.slice(0, 3).map((toolName) => (
          <span key={toolName} className="session-status">{toolName}</span>
        ))}
      </div>
      {conversationMessageSummary.latestFailureSummary ? (
        <p className="panel-caption">
          最近阻塞: {conversationMessageSummary.latestFailureSummary}
          {conversationMessageSummary.latestFailureAt ? ` · ${formatDateTime(conversationMessageSummary.latestFailureAt)}` : ''}
        </p>
      ) : conversationMessageSummary.latestClarificationSummary ? (
        <p className="panel-caption">
          最近等待用户: {summarizeText(conversationMessageSummary.latestClarificationSummary, 140)}
        </p>
      ) : (
        <p className="panel-caption">最近主回复: {conversationMessageSummary.latestAssistantSummary}</p>
      )}
    </section>
  );

  const renderConversationReplayPanel = () => (
    <div className="conversation-replay-shell">
      <div className="conversation-replay-scroll">
        {conversationReplayItems.length === 0 ? (
          <p className="empty">无可回放的用户态消息。</p>
        ) : (
          conversationReplayItems.map((item) => {
            if (item.kind === 'user') {
              return (
                <div key={item.id} className="conversation-replay-row conversation-replay-row-user" title={formatDateTime(item.timestamp)}>
                  <div className="conversation-replay-user-bubble">
                    <span className="conversation-replay-user-text">{item.text}</span>
                  </div>
                </div>
              );
            }

            if (item.kind === 'capsule') {
              const segments = item.segments && item.segments.length > 0 ? item.segments : [item.label];
              const lastIndex = segments.length - 1;
              return (
                <div key={item.id} className="conversation-replay-row conversation-replay-row-agent" title={formatDateTime(item.timestamp)}>
                  <div className={`conversation-replay-capsule conversation-replay-capsule-${item.tone}`}>
                    <span className="conversation-replay-capsule-content">
                      {segments.map((segment, index) => (
                        <span
                          key={`${item.id}-${segment}-${index}`}
                          className={item.loading && (segments.length === 1 || index < lastIndex) ? 'conversation-replay-capsule-loading' : ''}
                        >
                          {segment}
                          {index < lastIndex ? <span className="conversation-replay-capsule-dot">·</span> : null}
                        </span>
                      ))}
                    </span>
                  </div>
                </div>
              );
            }

            if (item.kind === 'clarification_notice') {
              return (
                <div key={item.id} className="conversation-replay-row conversation-replay-row-agent" title={formatDateTime(item.timestamp)}>
                  <div className="conversation-replay-clarification">
                    <span className="conversation-replay-clarification-icon" aria-hidden="true" />
                    <span>{item.text}</span>
                  </div>
                </div>
              );
            }

            if (item.kind === 'managed_tool') {
              const statusLabel =
                item.status === 'failed'
                  ? '失败'
                  : item.status === 'completed'
                    ? '已完成'
                    : item.status === 'running'
                      ? '进行中'
                      : '未知';
              return (
                <div key={item.id} className="conversation-replay-row conversation-replay-row-agent" title={formatDateTime(item.timestamp)}>
                  <div className="conversation-replay-tool-block">
                    <div
                      className={`conversation-replay-managed-tool ${
                        item.expandWrite ? 'conversation-replay-managed-tool-expanded' : 'conversation-replay-managed-tool-compact'
                      } conversation-replay-managed-tool-${item.status}`}
                    >
                      {item.expandWrite ? (
                        <>
                          <div className="conversation-replay-managed-tool-header">
                            <div className="conversation-replay-tool-title-group">
                              <span className="conversation-replay-tool-icon-badge">写</span>
                              <div>
                                <div className="conversation-replay-tool-title">写入文件</div>
                                <div className="conversation-replay-tool-subtitle">{item.summary}</div>
                              </div>
                            </div>
                            <div className="conversation-replay-tool-status-stack">
                              <span className={`conversation-replay-tool-status conversation-replay-tool-status-${item.status}`}>{statusLabel}</span>
                              <span className="conversation-replay-tool-meta">{formatDateTime(item.timestamp)}</span>
                            </div>
                          </div>
                          <div className="conversation-replay-tool-preview conversation-replay-tool-preview-code">
                            {item.preview || '正在生成代码片段...'}
                          </div>
                        </>
                      ) : (
                        <>
                          <span className="conversation-replay-tool-icon-badge">
                            {item.toolName === 'shell_execute'
                              ? '命'
                              : item.toolName === 'write_file'
                                ? '写'
                                : item.toolName === 'read_file'
                                  ? '读'
                                  : item.toolName === 'search_code'
                                    ? '搜'
                                    : item.toolName === 'list_directory'
                                      ? '列'
                                      : item.toolName === 'ask_user'
                                        ? '问'
                                        : '工'}
                          </span>
                          <span className="conversation-replay-managed-tool-content">
                            <span className="conversation-replay-managed-tool-label">{getConversationManagedToolDisplayName(item.toolName)}</span>
                            <span className={`conversation-replay-tool-status conversation-replay-tool-status-${item.status}`}>{statusLabel}</span>
                            {item.summary ? <span className="conversation-replay-managed-tool-summary">{item.summary}</span> : null}
                          </span>
                        </>
                      )}
                    </div>
                    {!item.expandWrite && item.status === 'failed' && item.preview ? (
                      <div className="conversation-replay-tool-preview conversation-replay-tool-preview-plain">
                        {item.preview}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            }

            if (item.kind === 'opencode_tool') {
              return (
                <div key={item.id} className="conversation-replay-row conversation-replay-row-agent" title={formatDateTime(item.timestamp)}>
                  <div className="conversation-replay-tool-block">
                    <div
                      className={`conversation-replay-opencode-tool ${
                        item.variant === 'card'
                          ? 'conversation-replay-opencode-tool-card'
                          : 'conversation-replay-opencode-tool-chip'
                      } conversation-replay-opencode-tool-${item.tone || 'default'}`}
                    >
                      <div className="conversation-replay-tool-title-group">
                        <span className="conversation-replay-tool-icon-badge">{item.iconLabel}</span>
                        <div>
                          <div className="conversation-replay-tool-title-row">
                            <span className="conversation-replay-tool-title">{item.title}</span>
                            {item.statusLabel ? (
                              <span className="conversation-replay-tool-status conversation-replay-tool-status-compact">
                                {item.statusLabel}
                              </span>
                            ) : null}
                          </div>
                          {item.subtitle ? <div className="conversation-replay-tool-subtitle">{item.subtitle}</div> : null}
                        </div>
                      </div>
                      {item.command ? (
                        <div className="conversation-replay-tool-preview conversation-replay-tool-preview-code">
                          {item.command}
                        </div>
                      ) : null}
                      {item.variant === 'card' && item.preview ? (
                        <div
                          className={`conversation-replay-tool-preview ${
                            item.previewMode === 'code'
                              ? 'conversation-replay-tool-preview-code'
                              : 'conversation-replay-tool-preview-plain'
                          }`}
                        >
                          {item.preview}
                        </div>
                      ) : null}
                    </div>
                    {item.variant === 'chip' && item.preview && item.detail && item.preview !== item.detail ? (
                      <div className="conversation-replay-tool-preview conversation-replay-tool-preview-plain">{item.preview}</div>
                    ) : null}
                  </div>
                </div>
              );
            }

            if (item.kind === 'error') {
              return (
                <div key={item.id} className="conversation-replay-row conversation-replay-row-agent" title={formatDateTime(item.timestamp)}>
                  <article className="conversation-replay-agent-block conversation-replay-agent-block-error">
                    {item.showAuthor !== false ? (
                      <div className="conversation-replay-author">{item.author || '智能体'}</div>
                    ) : null}
                    <div className="conversation-replay-agent-text">{item.text}</div>
                  </article>
                </div>
              );
            }

            return (
              <div key={item.id} className="conversation-replay-row conversation-replay-row-agent" title={formatDateTime(item.timestamp)}>
                <article className="conversation-replay-agent-block">
                  {item.showAuthor !== false ? (
                    <div className="conversation-replay-author">{item.author || '智能体'}</div>
                  ) : null}
                  <div className="conversation-replay-agent-text">{item.text}</div>
                  {item.options?.length ? (
                    <div className="conversation-replay-option-list">
                      {item.options.map((option) => (
                        <span key={`${item.id}-${option}`} className="conversation-replay-option-chip">
                          {option}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </article>
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  const activeNavItem = NAV_ITEMS.find((item) => item.key === activeSection) || NAV_ITEMS[0];
  const activeNavGroup = NAV_GROUPS.find((group) => group.key === activeNavItem.group) || NAV_GROUPS[0];
  const breadcrumbTitle = activeNavItem.label;
  const themeOptions = themeSettings?.themes.length ? themeSettings.themes : FALLBACK_ADMIN_THEME_OPTIONS;
  const themeModeOptions = themeSettings?.modes.length ? themeSettings.modes : FALLBACK_ADMIN_THEME_MODES;
  const selectedThemeOption = themeOptions.find((item) => item.key === currentTheme) || themeOptions[0];
  const selectedThemeMode = themeModeOptions.find((item) => item.key === currentThemeMode) || themeModeOptions[0];
  const resolvedThemeTone = resolveAdminThemeTone(currentThemeMode, systemThemeTone);
  const sandboxApi = sandboxOverview?.sandboxApi ?? null;
  const sandboxOverviewItems = asArray(sandboxOverview?.sandboxes);
  const sandboxRegistryItems = asArray(sandboxRuntimeRegistry?.items).map((item) => ({
    ...item,
    riskTags: asArray(item?.riskTags),
  }));
  const activeServiceOnline =
    activeSection === 'agent'
      ? agentOverview?.agentApi.online
      : activeSection === 'deployment'
        ? true
      : activeSection === 'conversation'
        ? true
      : activeSection === 'user'
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
      : activeSection === 'deployment'
        ? '平台接口'
      : activeSection === 'conversation'
        ? '会话索引'
      : activeSection === 'user'
        ? '平台接口'
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
      : activeSection === 'deployment'
        ? deploymentManagementUpdatedAt
      : activeSection === 'conversation'
        ? conversationDetail?.session.updatedAt || conversationSessions[0]?.updatedAt
        : activeSection === 'user'
          ? userManagementUpdatedAt
        : activeSection === 'skill'
          ? skillManagementUpdatedAt
          : activeSection === 'connectorGuide'
            ? connectorGuideUpdatedAt
            : activeSection === 'osacRelease'
              ? osacReleaseUpdatedAt
        : activeSection === 'agent'
          ? agentOverview?.agentApi.timestamp || agentOverview?.oneceoApi.timestamp
        : activeSection === 'audit'
          ? auditSummaryFetchedAt || auditEntries[0]?.timestamp
            : kvmOverview?.updatedAt;
  const lockMainAreaScroll =
    activeSection === 'deployment' ||
    activeSection === 'conversation' ||
    activeSection === 'user' ||
    activeSection === 'skill' ||
    activeSection === 'osacRelease' ||
    activeSection === 'audit' ||
    activeSection === 'sandbox';
  const currentTemplateId = templateIdOf(templateDetail);
  const currentTemplateAlias = templateAliasOf(templateDetail);
  const templateWorkbenchTitle = templateWorkbenchMode === 'create'
    ? '新建模板'
    : currentTemplateAlias || currentTemplateId || '模板';
  const templateWorkbenchCaption = templateWorkbenchMode === 'create'
    ? '填写创建 payload 后会直接写入模板列表'
    : templates.length ? `共 ${templates.length} 个模板` : '当前没有模板记录';
  const templateAliasCheck = parseAliasCheckResult(templateAliasResult);

  const registerSectionRefresh = useCallback((handler: (() => Promise<void>) | null) => {
    sectionRefreshHandlerRef.current = handler;
  }, []);

  const refreshActiveSection = useCallback(async () => {
    try {
      await runBlockingTask(`正在刷新${breadcrumbTitle}`, async () => {
        if (sectionRefreshHandlerRef.current) {
          setRefreshing(true);
          try {
            await sectionRefreshHandlerRef.current();
          } finally {
            setRefreshing(false);
          }
          return;
        }
        await loadSection(activeSection);
      });
    } catch {
      // error is routed to banner and toast
    }
  }, [activeSection, breadcrumbTitle, loadSection, runBlockingTask]);

  const updateAuditFilters = useCallback(
    (nextValue: AuditFilterState | ((current: AuditFilterState) => AuditFilterState)) => {
      setAuditFilters((current) => {
        const next = typeof nextValue === 'function'
          ? (nextValue as (value: AuditFilterState) => AuditFilterState)(current)
          : nextValue;
        auditFiltersRef.current = next;
        void loadAuditSection(next)
          .catch((requestError) => {
            setError(requestError instanceof Error ? requestError.message : '审计日志加载失败');
          });
        return next;
      });
    },
    [loadAuditSection]
  );

  const resetAuditFilters = useCallback(() => {
    updateAuditFilters(DEFAULT_AUDIT_FILTERS);
  }, [updateAuditFilters]);

  const resetSandboxRuntimeFilters = useCallback(() => {
    setSandboxRuntimeQuery('');
    setSandboxExecutorFilter('all');
    setSandboxStatusFilter('all');
    setSandboxRiskFilter('all');
  }, []);

  const handleSidebarWheel = useCallback((event: React.WheelEvent<HTMLElement>) => {
    if (typeof window !== 'undefined' && window.innerWidth <= SIDEBAR_STACK_BREAKPOINT) {
      return;
    }

    const sidebarNav = sidebarNavRef.current;
    if (!sidebarNav) {
      return;
    }

    const maxScrollTop = sidebarNav.scrollHeight - sidebarNav.clientHeight;
    if (maxScrollTop <= 0) {
      return;
    }

    const dominantDeltaY = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : 0;
    if (dominantDeltaY === 0) {
      return;
    }

    const scrollFactor =
      event.deltaMode === 1
        ? WHEEL_LINE_HEIGHT_PX
        : event.deltaMode === 2
          ? sidebarNav.clientHeight
          : 1;
    const nextScrollTop = Math.min(
      maxScrollTop,
      Math.max(0, sidebarNav.scrollTop + dominantDeltaY * scrollFactor)
    );

    if (Math.abs(nextScrollTop - sidebarNav.scrollTop) < 0.5) {
      event.preventDefault();
      return;
    }

    sidebarNav.scrollTop = nextScrollTop;
    event.preventDefault();
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
                <input
                  type="text"
                  name="username"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={loginName}
                  onChange={(event) => setLoginName(event.target.value)}
                  required
                />
              </label>
              <label>
                <span>密码</span>
                <input
                  type="password"
                  name="password"
                  autoComplete="current-password"
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
                  <Suspense fallback={<div className="loading-state chart-loading-state">正在加载趋势图...</div>}>
                    <KvmHostTrendChart data={hostTrendMap[host.hostId] || []} />
                  </Suspense>
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
            <Suspense fallback={<div className="loading-state chart-loading-state">正在加载状态图...</div>}>
              <KvmVmStatusPieChart data={vmPieData} stateColors={VM_STATE_COLORS} />
            </Suspense>
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <h2>会话状态分布</h2>
            <span className="panel-caption">任务绑定态</span>
          </div>
          <div className="chart-wrap">
            <Suspense fallback={<div className="loading-state chart-loading-state">正在加载会话图...</div>}>
              <KvmSessionStatusBarChart data={kvmOverview?.sessionStatusDistribution ?? []} />
            </Suspense>
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
    <main className="content-stack conversation-content-stack">
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
              <span>OpenCode 会话 ID</span>
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
                  <p>{conversationStageLabel(conversationDetail.session.stage)}</p>
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
                  <p className="kpi-title">OpenCode 会话 ID</p>
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
                    <span>处理阶段</span>
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
                    <span>智能体</span>
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
                    <span>语气</span>
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
                  <span>涉及处理阶段</span>
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
                      trigger.messageType ? `消息=${conversationMessageTypeLabel(trigger.messageType)}` : '',
                      trigger.role ? `角色=${conversationRoleLabel(trigger.role)}` : '',
                      trigger.agent ? `智能体=${conversationAgentLabel(trigger.agent)}` : '',
                      trigger.tone ? `语气=${conversationToneLabel(trigger.tone)}` : '',
                      trigger.messageId ? `消息 ID=${trigger.messageId}` : '',
                    ]
                      .filter(Boolean)
                      .join(' / ');
                    const prev = index > 0 ? filteredTransitions[index - 1] : null;
                    const gap =
                      prev?.at && transition.at
                        ? formatDuration(Date.parse(transition.at) - Date.parse(prev.at))
                        : '-';
                    const transitionNumber = String(index + 1).padStart(2, '0');
                    const fromStage = conversationStageLabel(transition.from?.stage);
                    const toStage = conversationStageLabel(transition.to?.stage);
                    const toStatus = statusLabel(transition.to?.status || 'unknown');
                    const toPhase = transition.to?.phase ? conversationPhaseLabel(transition.to.phase) : '-';
                    return (
                      <article key={`${transition.at || 'transition'}-${index}`} className="state-timeline-item">
                        <div className="state-timeline-rail" aria-hidden="true">
                          <span className="state-timeline-step mono">{transitionNumber}</span>
                        </div>
                        <div className="state-timeline-card">
                          <div className="state-timeline-head">
                            <div className="state-timeline-title-block">
                              <span className={traceLevelClass('info')}>状态</span>
                              <strong className="state-timeline-title">{`${fromStage} → ${toStage}`}</strong>
                            </div>
                            <div className="state-timeline-time">
                              <span>{formatDateTime(transition.at)}</span>
                              <span className="state-gap">间隔 {gap}</span>
                            </div>
                          </div>
                          <div className="state-timeline-meta">
                            <span>
                              <small>变更前</small>
                              <strong className="mono">{formatStateSnapshot(transition.from)}</strong>
                            </span>
                            <span>
                              <small>变更后</small>
                              <strong className="mono">{formatStateSnapshot(transition.to)}</strong>
                            </span>
                          </div>
                          <div className="state-transition-flow">
                            <span className="state-chip from">{fromStage}</span>
                            <span className="state-flow-arrow" aria-hidden="true">→</span>
                            <span className="state-chip status">{toStatus}</span>
                            <span className="state-flow-arrow" aria-hidden="true">→</span>
                            <span className="state-chip phase">{toPhase}</span>
                            <span className="state-flow-arrow" aria-hidden="true">→</span>
                            <span className="state-chip to">{toStage}</span>
                          </div>
                          <div className="state-trigger-stack">
                            {triggerSummary ? <p className="state-trigger-line">触发: {triggerSummary}</p> : null}
                            {trigger.content ? (
                              <p className="state-trigger-line">内容: {summarizeText(trigger.content, 240)}</p>
                            ) : null}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="trace-list">
                  {filteredTransitions.map((transition, index) => {
                    const trigger = transition.trigger || {};
                    const triggerSummary = [
                      trigger.messageType ? `消息=${conversationMessageTypeLabel(trigger.messageType)}` : '',
                      trigger.role ? `角色=${conversationRoleLabel(trigger.role)}` : '',
                      trigger.agent ? `智能体=${conversationAgentLabel(trigger.agent)}` : '',
                      trigger.tone ? `语气=${conversationToneLabel(trigger.tone)}` : '',
                      trigger.messageId ? `消息 ID=${trigger.messageId}` : '',
                    ]
                      .filter(Boolean)
                      .join(' / ');
                    return (
                      <article key={`${transition.at || 'transition'}-${index}`} className="trace-item">
                        <p className="trace-head">
                          <span className={traceLevelClass('info')}>状态</span>
                          <strong>{`${conversationStageLabel(transition.from?.stage)} → ${conversationStageLabel(transition.to?.stage)}`}</strong>
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
                        <strong>{conversationRoleLabel(message.role)}</strong> · {formatDateTime(message.createdAt)}
                      </p>
                      <p className="message-content">{message.content}</p>
                      {message.metadata !== undefined ? (
                        <pre className="json-block message-meta-json">{toJsonText(message.metadata)}</pre>
                      ) : null}
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
                      <p className="kpi-title">主记录会话 ID</p>
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
                      <p className="kpi-title">处理方式</p>
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
    return (
      <>
      <main className="content-stack conversation-content-stack">
        <section className="conversation-ops-layout fade-in">
          <article className="panel conversation-index-panel">
            <div className="panel-header conversation-index-panel-header">
              <div>
                <p className="section-tag">会话索引</p>
                <h2>会话索引</h2>
              </div>
              <div className="sandbox-list-header-actions conversation-index-header-actions">
                <div className="conversation-live-summary-strip session-status sandbox-live-count" aria-label="会话索引摘要">
                  <span className="sandbox-live-metric sandbox-live-metric-total">
                    <span>全部</span>
                    <strong>{conversationSummary.total}</strong>
                  </span>
                  <span className="sandbox-live-metric sandbox-live-metric-running">
                    <span>进行中</span>
                    <strong>{conversationSummary.inProgress}</strong>
                  </span>
                  <span className="sandbox-live-metric conversation-live-metric-waiting">
                    <span>待确认</span>
                    <strong>{conversationSummary.waitingUser}</strong>
                  </span>
                  <span className="sandbox-live-metric conversation-live-metric-failed">
                    <span>失败</span>
                    <strong>{conversationSummary.failed}</strong>
                  </span>
                  <span className="sandbox-live-age" title={formatDateTime(conversationSummaryFetchedAt)}>
                    {conversationSummaryAge}
                  </span>
                  <button
                    type="button"
                    className={`sandbox-live-refresh-btn ${conversationSummaryRefreshing ? 'is-refreshing' : ''}`}
                    onClick={() => void refreshConversationSummary()}
                    disabled={conversationSummaryRefreshing}
                    aria-label="刷新会话列表"
                  >
                    ↻
                  </button>
                </div>
              </div>
            </div>
            <div className="conversation-index-toolbar">
              <div className="runtime-filter-grid conversation-index-filter-grid conversation-index-filter-grid-compact">
                <label className="state-filter-field">
                  <span>搜索会话</span>
                  <input
                    type="search"
                    placeholder="sessionId / 标题 / 用户名 / 执行器"
                    value={conversationSearchQuery}
                    onChange={(event) => setConversationSearchQuery(event.target.value)}
                  />
                </label>
                <label className="state-filter-field">
                  <span>状态 / 阶段</span>
                  <select
                    value={conversationScopeFilterValue}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (value === 'all') {
                        setConversationStatusFilter('all');
                        setConversationStageFilter('all');
                        return;
                      }
                      if (value.startsWith('status:')) {
                        setConversationStatusFilter(value.replace('status:', '') as typeof conversationStatusFilter);
                        setConversationStageFilter('all');
                        return;
                      }
                      setConversationStatusFilter('all');
                      setConversationStageFilter(value.replace('stage:', ''));
                    }}
                  >
                    <option value="all">全部状态与阶段</option>
                    {conversationQuickStatusFilters.filter((item) => item.value !== 'all').map((item) => (
                      <option key={item.value} value={`status:${item.value}`}>
                        {item.label} ({item.count})
                      </option>
                    ))}
                    {conversationStageOptions.map((stage) => (
                      <option key={stage} value={`stage:${stage}`}>
                        {conversationStageLabel(stage)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="state-filter-field">
                  <span>用户</span>
                  <select value={conversationUserFilter} onChange={(event) => setConversationUserFilter(event.target.value)}>
                    <option value="all">全部用户</option>
                    {conversationUserOptions.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label} ({item.count})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="state-filter-field">
                  <span>处理方式</span>
                  <select
                    value={conversationExecutorFilter}
                    onChange={(event) => setConversationExecutorFilter(event.target.value)}
                  >
                    <option value="all">全部处理方式</option>
                    {conversationExecutorOptions.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label} ({item.count})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="state-filter-field">
                  <span>更新开始日期</span>
                  <input
                    type="date"
                    value={conversationUpdatedFromDate}
                    max={conversationUpdatedToDate || undefined}
                    onChange={(event) => setConversationUpdatedFromDate(event.target.value)}
                  />
                </label>
                <label className="state-filter-field">
                  <span>更新结束日期</span>
                  <input
                    type="date"
                    value={conversationUpdatedToDate}
                    min={conversationUpdatedFromDate || undefined}
                    onChange={(event) => setConversationUpdatedToDate(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="secondary-btn conversation-index-reset-btn"
                  onClick={() => {
                    setConversationSearchQuery('');
                    setConversationStatusFilter('all');
                    setConversationStageFilter('all');
                    setConversationUserFilter('all');
                    setConversationExecutorFilter('all');
                    setConversationUpdatedFromDate('');
                    setConversationUpdatedToDate('');
                  }}
                >
                  重置筛选
                </button>
              </div>
              <p className="panel-caption">
                当前筛选命中 {filteredConversationSessions.length} / {conversationSessions.length} · 进行中 {conversationSummary.inProgress} · 待确认 {conversationSummary.waitingUser} · 失败 {conversationSummary.failed}
                {activeConversationFilterLabels.length ? ` · 已启用 ${activeConversationFilterLabels.join(' / ')}` : ''}
              </p>
            </div>
            <div className="table-wrap conversation-index-table-wrap">
              <table className="conversation-index-table">
                <colgroup>
                  <col style={{ width: '26%' }} />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '15%' }} />
                  <col style={{ width: '13%' }} />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '12%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>
                      <button type="button" className={`runtime-sort-btn ${conversationSort.key === 'session' ? 'active' : ''}`} onClick={() => toggleConversationSort('session')}>
                        会话
                        <span className="runtime-sort-indicator">{conversationSort.key === 'session' ? (conversationSort.direction === 'asc' ? '▲' : '▼') : '↕'}</span>
                      </button>
                    </th>
                    <th>
                      <button type="button" className={`runtime-sort-btn ${conversationSort.key === 'user' ? 'active' : ''}`} onClick={() => toggleConversationSort('user')}>
                        用户名
                        <span className="runtime-sort-indicator">{conversationSort.key === 'user' ? (conversationSort.direction === 'asc' ? '▲' : '▼') : '↕'}</span>
                      </button>
                    </th>
                    <th>
                      <button type="button" className={`runtime-sort-btn ${conversationSort.key === 'executor' ? 'active' : ''}`} onClick={() => toggleConversationSort('executor')}>
                        执行器
                        <span className="runtime-sort-indicator">{conversationSort.key === 'executor' ? (conversationSort.direction === 'asc' ? '▲' : '▼') : '↕'}</span>
                      </button>
                    </th>
                    <th>
                      <button type="button" className={`runtime-sort-btn ${conversationSort.key === 'session_id' ? 'active' : ''}`} onClick={() => toggleConversationSort('session_id')}>
                        会话 ID
                        <span className="runtime-sort-indicator">{conversationSort.key === 'session_id' ? (conversationSort.direction === 'asc' ? '▲' : '▼') : '↕'}</span>
                      </button>
                    </th>
                    <th>
                      <button type="button" className={`runtime-sort-btn ${conversationSort.key === 'status' ? 'active' : ''}`} onClick={() => toggleConversationSort('status')}>
                        状态
                        <span className="runtime-sort-indicator">{conversationSort.key === 'status' ? (conversationSort.direction === 'asc' ? '▲' : '▼') : '↕'}</span>
                      </button>
                    </th>
                    <th>
                      <button type="button" className={`runtime-sort-btn ${conversationSort.key === 'updated_at' ? 'active' : ''}`} onClick={() => toggleConversationSort('updated_at')}>
                        最近活跃
                        <span className="runtime-sort-indicator">{conversationSort.key === 'updated_at' ? (conversationSort.direction === 'asc' ? '▲' : '▼') : '↕'}</span>
                      </button>
                    </th>
                    <th>
                      <button type="button" className={`runtime-sort-btn ${conversationSort.key === 'created_at' ? 'active' : ''}`} onClick={() => toggleConversationSort('created_at')}>
                        创建时间
                        <span className="runtime-sort-indicator">{conversationSort.key === 'created_at' ? (conversationSort.direction === 'asc' ? '▲' : '▼') : '↕'}</span>
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {conversationSessions.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="empty">暂无对话会话。</td>
                    </tr>
                  ) : filteredConversationSessions.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="empty">当前筛选条件下无会话。</td>
                    </tr>
                  ) : (
                    filteredConversationSessions.map((session) => {
                      const isSelected = selectedSessionId === session.id;
                      const stageLabel = conversationStageLabel(session.stage);
                      const statusText = statusLabel(session.status);
                      const stageDisplay = stageLabel !== '-' && stageLabel !== statusText ? stageLabel : null;
                      const executorText = session.executor ? executorLabel(session.executor) : null;
                      const sourceUserLabel = conversationUserLabel(session.user);
                      const sourceUserMeta = conversationUserMeta(session.user);
                      const titleText = session.title || session.id;
                      return (
                        <tr
                          key={session.id}
                          className={`${isSelected ? 'selected-row' : ''} conversation-index-row`}
                          aria-selected={isSelected}
                        >
                          <td>
                            <div className="runtime-primary-cell conversation-index-primary-cell">
                              <button
                                type="button"
                                className="link-btn sandbox-jump-btn conversation-index-title"
                                title={titleText}
                                onClick={() => openConversationDialog(session.id, 'overview')}
                              >
                                {titleText}
                              </button>
                            </div>
                          </td>
                          <td>
                            <div className="conversation-index-compact-cell">
                              <span className="conversation-index-user-text" title={sourceUserMeta}>
                                {sourceUserLabel}
                              </span>
                            </div>
                          </td>
                          <td>
                            <div className="conversation-index-compact-cell">
                              <span className="conversation-index-text" title={executorText || '-'}>
                                {executorText || '-'}
                              </span>
                            </div>
                          </td>
                          <td>
                            <div className="conversation-index-compact-cell">
                              <span className="conversation-index-session-id mono" title={session.id}>
                                {truncateMiddle(session.id, 10, 8)}
                              </span>
                            </div>
                          </td>
                          <td>
                            <div className="conversation-index-status-cell">
                              <span className={stateClassName(session.status)}>{statusText}</span>
                              {stageDisplay ? <span className="session-status">{stageDisplay}</span> : null}
                            </div>
                          </td>
                          <td>
                            <div className="conversation-index-compact-cell">
                              <span className="conversation-index-time-text" title={formatDateTime(session.updatedAt)}>
                                {formatCompactRelativeTime(session.updatedAt)}
                              </span>
                            </div>
                          </td>
                          <td>
                            <div className="conversation-index-compact-cell">
                              <span className="conversation-index-time-text" title={formatDateTime(session.createdAt)}>
                                {formatDateTime(session.createdAt)}
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </article>
        </section>
      </main>
      {conversationDialog ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={closeConversationDialog} style={{ zIndex: conversationDialogZIndex }}>
          <div
            className="modal-card conversation-dialog-modal"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
              <div className="modal-header">
                <div>
                  <p className="section-tag">对话详情</p>
                  <h2>{conversationDialogDetail?.session.title || conversationDialogDetail?.session.id || '正在加载会话...'}</h2>
                  {conversationDialogOrigin ? <p className="modal-context-path">来自 {conversationDialogOrigin.trail}</p> : null}
                </div>
                <div className="conversation-dialog-actions">
                  {activeSection !== 'conversation' ? (
                    <button
                    type="button"
                    className="secondary-btn"
                    onClick={openConversationManagementView}
                  >
                    在对话管理中查看
                  </button>
                ) : null}
                {conversationDialogDetail ? (
                  <button type="button" className="secondary-btn" onClick={exportConversationDetail}>
                    下载会话
                  </button>
                ) : null}
                <button type="button" className="secondary-btn" onClick={closeConversationDialog}>
                  关闭
                </button>
              </div>
            </div>

            {conversationDialogLoading ? (
              <div className="modal-body conversation-dialog-body">
                <p className="empty">正在加载会话内容...</p>
              </div>
            ) : (
              <>
                <div className="button-grid modal-tab-grid conversation-dialog-tab-grid">
                  {[
                    { key: 'overview', label: '概览', tabKey: '01' },
                    { key: 'billing', label: '计费', tabKey: '02' },
                    { key: 'interaction', label: '交互回放', tabKey: '03' },
                    { key: 'infra', label: '关联', tabKey: '04' },
                    { key: 'raw', label: `日志 (${conversationDetailedLogs.counts.total})`, tabKey: '05' },
                    { key: 'transitions', label: `流转 (${conversationTabCounts.transitions})`, tabKey: '06' },
                  ].map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      className={`inspector-tab-card ${conversationDialogTab === item.key ? 'active' : ''}`}
                      onClick={() => setConversationDialogTab(item.key as ConversationDialogTab)}
                    >
                      <span className="inspector-tab-card-key mono">{item.tabKey}</span>
                      <span className="inspector-tab-card-label">{item.label}</span>
                    </button>
                  ))}
                </div>
                <div className="modal-body conversation-dialog-body">
                  {conversationDialogTab === 'overview' ? renderConversationContentOverview() : null}
                  {conversationDialogTab === 'billing' ? renderConversationBillingPanel() : null}
                  {conversationDialogTab === 'interaction' ? (
                    <>
                      {renderConversationReplayPanel()}
                    </>
                  ) : null}
                  {conversationDialogTab === 'infra' ? renderConversationInfraPanel() : null}
                  {conversationDialogTab === 'raw' ? renderConversationDetailedLogsPanel() : null}
                  {conversationDialogTab === 'transitions' ? renderConversationTransitionsPanel() : null}
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
      </>
    );
  };

  const renderAgentSection = () => {
    const taskSessions = agentOverview?.taskCreationSessions;
    const overviewTimestamp = formatDateTime(agentOverview?.agentApi.timestamp || agentOverview?.oneceoApi.timestamp);
    const selectedStageStatusText =
      selectedAgentStage?.statusSummary
        .filter((item) => item.value > 0)
        .map((item) => `${item.label} ${item.value}`)
        .join(' · ') || '当前没有状态构成';

    return (
      <main className="content-stack agent-command-center">
        <section className="panel fade-in agent-overview-panel">
          <div className="agent-overview-head">
            <div>
              <p className="section-tag">智能体总览</p>
              <h2>服务、会话与能力</h2>
              <p className="panel-caption">
                {agentApiMessageLabel(agentOverview?.agentApi.message)} · 最近检查 {overviewTimestamp}
              </p>
            </div>
            <div className="agent-overview-status-row">
              <span className={`service-state ${agentOverview?.oneceoApi.online ? 'ok' : 'down'}`}>
                {agentOverview?.oneceoApi.online ? '平台接口在线' : '平台接口离线'}
              </span>
              <span className={`service-state ${agentOverview?.agentApi.online ? 'ok' : 'down'}`}>
                {agentOverview?.agentApi.online ? '智能体服务在线' : '智能体服务离线'}
              </span>
            </div>
          </div>

          <div className="agent-overview-strip">
            <article className="agent-overview-card">
              <span>总会话</span>
              <strong>{taskSessions?.total ?? 0}</strong>
              <small>当前任务创建记录</small>
            </article>
            <article className="agent-overview-card">
              <span>待确认</span>
              <strong>{taskSessions?.waitingUser ?? 0}</strong>
              <small>等用户补充信息</small>
            </article>
            <article className="agent-overview-card">
              <span>进行中</span>
              <strong>{taskSessions?.inProgress ?? 0}</strong>
              <small>仍在持续推进</small>
            </article>
            <article className="agent-overview-card">
              <span>失败</span>
              <strong>{taskSessions?.failed ?? 0}</strong>
              <small>优先排查异常链路</small>
            </article>
            <article className="agent-overview-card">
              <span>可用能力</span>
              <strong>
                {agentCapabilitySummary.available}/{agentCapabilitySummary.total}
              </strong>
              <small>
                {agentCapabilitySummary.planned > 0 ? `${agentCapabilitySummary.planned} 个规划中` : '当前都已落地'}
              </small>
            </article>
          </div>
        </section>

        <section className="panel fade-in agent-stage-workbench">
          <div className="panel-header panel-header-stack">
            <div>
              <h2>任务阶段</h2>
              <span className="panel-caption">按阶段切换，只看当前最需要处理的会话。</span>
            </div>
          </div>

          {(agentOverview?.stageDistribution || []).length > 0 ? (
            <>
              <div className="agent-stage-tabs" role="tablist" aria-label="任务阶段">
                {(agentOverview?.stageDistribution || []).map((item) => (
                  <button
                    key={item.stageKey}
                    type="button"
                    role="tab"
                    aria-selected={selectedAgentStage?.stageKey === item.stageKey}
                    className={`agent-stage-tab ${selectedAgentStage?.stageKey === item.stageKey ? 'active' : ''}`}
                    onClick={() => setSelectedAgentStageKey(item.stageKey)}
                  >
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                  </button>
                ))}
              </div>

              {selectedAgentStage ? (
                <div className="agent-stage-detail-surface" role="tabpanel">
                  <div className="agent-stage-detail-head">
                    <div>
                      <p className="section-tag">当前阶段</p>
                      <h3>{selectedAgentStage.label}</h3>
                      <p className="panel-caption">{selectedStageStatusText}</p>
                    </div>
                    <span className="status-pill">{selectedAgentStage.value} 个会话</span>
                  </div>

                  <div className="agent-status-pills">
                    {selectedAgentStage.statusSummary
                      .filter((summary) => summary.value > 0)
                      .map((summary) => (
                        <span key={`${selectedAgentStage.stageKey}-${summary.label}`} className="session-status">
                          {summary.label} · {summary.value}
                        </span>
                      ))}
                  </div>

                  <div className="agent-session-compact-list">
                    {selectedAgentStage.recentSessions.map((session) => (
                      <article key={session.id} className="agent-session-compact-item">
                        <div className="agent-session-compact-main">
                          <strong title={session.title || session.id}>{session.title || '未命名会话'}</strong>
                          <span className="session-status">{statusLabel(session.status)}</span>
                        </div>
                        <p className="agent-session-compact-meta">更新时间 {formatDateTime(session.updatedAt)}</p>
                        {session.pendingQuestion ? (
                          <p className="agent-session-pending">待补充: {summarizeText(session.pendingQuestion, 120)}</p>
                        ) : null}
                      </article>
                    ))}
                    {selectedAgentStage.recentSessions.length === 0 ? <p className="empty">当前阶段暂无最近会话。</p> : null}
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <p className="empty">当前没有阶段数据。</p>
          )}
        </section>

        <section className="panel fade-in agent-capability-compact-panel">
          <div className="panel-header">
            <h2>智能体能力</h2>
            <span className="panel-caption">保留能力名称、接入方式和可用状态。</span>
          </div>
          <div className="agent-capability-summary">
            <span className="session-status">可用 {agentCapabilitySummary.available}</span>
            <span className="session-status">规划中 {agentCapabilitySummary.planned}</span>
            <span className="session-status">总数 {agentCapabilitySummary.total}</span>
          </div>
          <div className="agent-capability-list">
            {(agentOverview?.capabilities || []).map((item) => (
              <article key={item.key} className="agent-capability-row" title={item.endpoint || undefined}>
                <div className="agent-capability-main">
                  <strong>{capabilityNameLabel(item.name)}</strong>
                  <span className="agent-capability-transport mono">{item.transport}</span>
                </div>
                <span className={`capability-status ${item.status}`}>{capabilityStatusLabel(item.status)}</span>
              </article>
            ))}
            {(agentOverview?.capabilities || []).length === 0 ? <p className="empty">当前没有可展示的能力信息。</p> : null}
          </div>
        </section>
      </main>
    );
  };

  const renderSandboxSection = () => {
    const liveSandboxIdSet = new Set(sandboxOverviewItems.map((item) => item.sandboxId).filter(Boolean));
    const currentScopeItems =
      liveSandboxIdSet.size === 0
        ? sandboxRegistryItems
        : sandboxRegistryItems.filter((item) => liveSandboxIdSet.has(item.sandboxId));
    const executorOptions = Array.from(new Set(sandboxRegistryItems.map((item) => item.executor).filter(Boolean))).sort();
    const statusOptions = Array.from(
      new Set([
        ...sandboxRegistryItems.map((item) => item.sandboxState || item.status).filter(Boolean),
        'running',
        'paused',
        'pending_archive',
      ])
    ).sort();
    const riskOptions = Array.from(new Set(currentScopeItems.flatMap((item) => item.riskTags))).sort((a, b) =>
      sandboxRiskLabel(a).localeCompare(sandboxRiskLabel(b), 'zh-Hans-CN', { sensitivity: 'base' })
    );
    const loadedRuntimeCount = sandboxRegistryItems.length;
    const runtimeLoadMoreStep = SANDBOX_RUNTIME_LOAD_MORE_STEP;
    const canLoadMoreRuntime = Boolean(sandboxRuntimeRegistry?.hasMore);
    const loadMoreTargetCount = Math.max(loadedRuntimeCount, sandboxRegistryLimit);
    const loadMoreRangeStart = loadedRuntimeCount + 1;
    const loadMoreRangeEnd = loadMoreTargetCount;
    const liveSummaryAge = formatCompactRelativeTime(sandboxLiveSummary?.countedAt, sandboxLiveSummaryClock);
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
      } else if (runtimeSort.key === 'last_active') {
        delta =
          toTimestamp(a.lastActiveAt || a.updatedAt || a.createdAt) - toTimestamp(b.lastActiveAt || b.updatedAt || b.createdAt);
      }

      if (delta !== 0) {
        return runtimeSort.direction === 'asc' ? delta : -delta;
      }

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
    const sandboxFileTreeRows = buildSandboxFileTreeRows(
      sandboxFileTreeRootPath || sandboxDirectoryPath || '/',
      sandboxFileTreeItemsByPath,
      sandboxFileExpandedPaths
    );
    const selectedSandboxFilePath = sandboxFilePath ? normalizeSandboxPath(sandboxFilePath) : '';
    const selectedSandboxFileKind =
      sandboxFileTargetKind ||
      (selectedSandboxFilePath && selectedSandboxFilePath === normalizeSandboxPath(sandboxDirectoryPath) ? 'dir' : null);
    const sandboxFileActionsBusy = sandboxFileOperation !== null;
    const sandboxFileTransferActive = sandboxFileTransferProgress !== null;
    const sandboxFileTransferPercent = sandboxFileTransferProgress?.percent ?? null;
    const canDownloadSandboxFile = Boolean(selectedSandboxFilePath && selectedSandboxFileKind !== 'dir');
    const canDeleteSandboxFileTarget = Boolean(
      selectedSandboxFilePath &&
        selectedSandboxFilePath !== '/' &&
        selectedSandboxFilePath !== normalizeSandboxPath(sandboxFileTreeRootPath)
    );
    const processRows = getSandboxProcessRows(sandboxProcessResult);
    const portRows = getSandboxPortRows(sandboxPortResult);
    const processListAgeLabel = sandboxProcessFetchedAt
      ? `这是 ${Math.max(0, Math.floor((sandboxToolSnapshotClock - sandboxProcessFetchedAt) / 1000))} 秒前的进程列表`
      : '等待刷新进程列表';
    const portListAgeLabel = sandboxPortFetchedAt
      ? `这是 ${Math.max(0, Math.floor((sandboxToolSnapshotClock - sandboxPortFetchedAt) / 1000))} 秒前的端口列表`
      : '等待刷新端口列表';
    const renderSandboxToolbarActions = () => (
      <div className="sandbox-workspace-actions">
        <button
          type="button"
          className="primary-btn"
          onClick={() => setSandboxCreateDrawerOpen(true)}
        >
          新建 Sandbox
        </button>
        <button type="button" className="secondary-btn template-workbench-open-btn" onClick={openTemplateWorkbench}>
          模板
        </button>
      </div>
    );

    return (
      <>
        <main className="content-stack sandbox-page viewport-lock-page sandbox-page-runtime">
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
                  <div className="sandbox-list-header-actions">
                    <div className="session-status sandbox-live-count" aria-live="polite">
                      <span className="sandbox-live-metric sandbox-live-metric-total">
                        <span>全部</span>
                        <strong>{sandboxLiveSummary?.total ?? '-'}</strong>
                      </span>
                      <span className="sandbox-live-metric sandbox-live-metric-paused">
                        <span>暂停</span>
                        <strong>{sandboxLiveSummary?.paused ?? '-'}</strong>
                      </span>
                      <span className="sandbox-live-metric sandbox-live-metric-running">
                        <span>运行</span>
                        <strong>{sandboxLiveSummary?.running ?? '-'}</strong>
                      </span>
                      <span className="sandbox-live-age" title={formatDateTime(sandboxLiveSummary?.countedAt)}>
                        {liveSummaryAge}
                      </span>
                      <button
                        type="button"
                        className={`sandbox-live-refresh-btn ${sandboxLiveSummaryRefreshing ? 'is-refreshing' : ''}`}
                        onClick={refreshSandboxLiveSummary}
                        disabled={sandboxLiveSummaryRefreshing}
                        aria-label="刷新 E2B live 数量"
                      >
                        ↻
                      </button>
                    </div>
                    {renderSandboxToolbarActions()}
                  </div>
                </div>
                <div className="runtime-filter-grid sandbox-runtime-filter-grid">
                  <label className="state-filter-field">
                    <span>搜索 Sandbox</span>
                    <input
                      type="text"
                      value={sandboxRuntimeQuery}
                      placeholder="sessionId / sandboxId"
                      onChange={(event) => setSandboxRuntimeQuery(event.target.value)}
                    />
                  </label>
                  <label className="state-filter-field">
                    <span>执行器</span>
                    <select value={sandboxExecutorFilter} onChange={(event) => setSandboxExecutorFilter(event.target.value)}>
                      <option value="all">全部</option>
                      {executorOptions.map((item) => (
                        <option key={item} value={item}>
                          {executorLabel(item)}
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
                          {sandboxRuntimeStateLabel(item)}
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
                          {sandboxRiskLabel(item)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="secondary-btn sandbox-filter-reset-btn"
                    onClick={resetSandboxRuntimeFilters}
                  >
                    重置筛选
                  </button>
                </div>
                {runtimeItems.length === 0 ? (
                  <p className="empty runtime-empty-state">当前筛选条件下没有 Sandbox 记录</p>
                ) : null}
                <div className="table-wrap table-wrap-runtime" aria-busy={sandboxRegistryLoadingMore}>
                  <table className="runtime-table">
                    <colgroup>
                      <col style={{ width: `${runtimeColumnWidths.sandbox}px` }} />
                      <col style={{ width: `${runtimeColumnWidths.task_session}px` }} />
                      <col style={{ width: `${runtimeColumnWidths.executor}px` }} />
                      <col style={{ width: `${runtimeColumnWidths.status}px` }} />
                      <col style={{ width: `${runtimeColumnWidths.last_active}px` }} />
                      <col style={{ width: `${runtimeColumnWidths.actions}px` }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>
                          <div className="runtime-th-wrap">
                            <button type="button" className={`runtime-sort-btn ${runtimeSort.key === 'sandbox' ? 'active' : ''}`} onClick={() => toggleRuntimeSort('sandbox')}>
                              ID
                              <span className="runtime-sort-indicator">{runtimeSort.key === 'sandbox' ? (runtimeSort.direction === 'asc' ? '▲' : '▼') : '↕'}</span>
                            </button>
                            <span className="runtime-col-resize-handle" onMouseDown={(event) => beginRuntimeColumnResize('sandbox', event)} />
                          </div>
                        </th>
                        <th>
                          <div className="runtime-th-wrap">
                            <button type="button" className={`runtime-sort-btn ${runtimeSort.key === 'task_session' ? 'active' : ''}`} onClick={() => toggleRuntimeSort('task_session')}>
                              会话
                              <span className="runtime-sort-indicator">{runtimeSort.key === 'task_session' ? (runtimeSort.direction === 'asc' ? '▲' : '▼') : '↕'}</span>
                            </button>
                            <span className="runtime-col-resize-handle" onMouseDown={(event) => beginRuntimeColumnResize('task_session', event)} />
                          </div>
                        </th>
                        <th>
                          <div className="runtime-th-wrap">
                            <button type="button" className={`runtime-sort-btn ${runtimeSort.key === 'executor' ? 'active' : ''}`} onClick={() => toggleRuntimeSort('executor')}>
                              执行器
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
                          <td colSpan={6} className="empty">
                            {sandboxRegistryLoadingMore ? '正在扩展已加载范围，请稍候...' : '当前筛选条件下没有 Sandbox 记录'}
                          </td>
                        </tr>
                      ) : (
                        runtimeItems.map((item) => (
                          <tr key={item.sandboxId} className={sandboxRuntimeDetail?.runtime.sandboxId === item.sandboxId ? 'selected-row' : undefined}>
                            <td>
                              <div className="runtime-primary-cell">
                                <div className="runtime-id-row">
                                  <button
                                    type="button"
                                    className="link-btn sandbox-jump-btn mono"
                                    title={item.sandboxId}
                                    onClick={() => void openSandboxDetail(item.sandboxId)}
                                  >
                                    {truncateMiddle(item.sandboxId, 8, 6)}
                                  </button>
                                </div>
                              </div>
                            </td>
                            <td>
                              <div className="runtime-primary-cell">
                                <div className="runtime-id-row">
                                  <span className="mono mono-truncate" title={item.taskSessionId || '-'}>
                                    {item.taskSessionId ? truncateMiddle(item.taskSessionId, 8, 6) : '-'}
                                  </span>
                                </div>
                                {item.taskTitle ? <p className="session-meta">{item.taskTitle}</p> : null}
                              </div>
                            </td>
                            <td>
                              <strong className="runtime-one-line" title={item.codexExecutionMode || executorLabel(item.executor)}>
                                {executorLabel(item.executor)}
                              </strong>
                            </td>
                            <td>
                              <div className="runtime-status-stack">
                                <div className="action-inline">
                                  <span className={stateClassName(item.sandboxState || item.status)}>{sandboxRuntimeStateLabel(item.sandboxState || item.status)}</span>
                                  {item.taskStatus ? <span className={stateClassName(item.taskStatus)}>{statusLabel(item.taskStatus)}</span> : null}
                                  {item.status === 'closed' && (item.dedupeReplacementSandboxId || item.dedupeReplacedAt) ? (
                                    <span className="session-status session-status-governance">已处理</span>
                                  ) : null}
                                </div>
                              </div>
                            </td>
                            <td>
                              <div className="runtime-one-line runtime-last-active" title={item.lastActiveReason || formatDateTime(item.lastActiveAt || item.updatedAt)}>
                                {formatDateTime(item.lastActiveAt || item.updatedAt)}
                              </div>
                            </td>
                            <td className="runtime-col-actions">
                              <div className="action-inline runtime-actions">
                                <button type="button" className="table-btn" onClick={() => void openSandboxDetail(item.sandboxId)}>
                                  详情
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
                                <details className="runtime-action-menu">
                                  <summary className="secondary-btn runtime-action-menu-trigger">更多</summary>
                                  <div className="runtime-action-menu-popover">
                                    {item.taskSessionId ? (
                                      <button
                                        type="button"
                                        className="table-btn runtime-action-menu-item"
                                        onClick={(event) => {
                                          closeParentDetails(event.currentTarget);
                                          void copyRuntimeField('会话 ID', item.taskSessionId!);
                                        }}
                                      >
                                        复制会话 ID
                                      </button>
                                    ) : null}
                                    <button
                                      type="button"
                                      className="table-btn runtime-action-menu-item"
                                      onClick={(event) => {
                                        closeParentDetails(event.currentTarget);
                                        void copyRuntimeField('Sandbox ID', item.sandboxId);
                                      }}
                                    >
                                      复制 Sandbox ID
                                    </button>
                                    {item.sandboxState === 'running' || item.sandboxState === 'paused' ? (
                                      <button
                                        type="button"
                                        className="table-btn runtime-action-menu-item"
                                        disabled={sandboxBusyIds[item.sandboxId]}
                                        onClick={(event) => {
                                          closeParentDetails(event.currentTarget);
                                          void closeSandbox(item.sandboxId);
                                        }}
                                      >
                                        关机
                                      </button>
                                    ) : null}
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
                        `查看更多 Sandbox（+${runtimeLoadMoreStep}）`
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
        </main>

        {sandboxModalOpen && sandboxRuntimeDetail ? (
          <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={closeSandboxDetail} style={{ zIndex: sandboxModalZIndex }}>
            <div
              className="modal-card runtime-inspector-modal"
              onClick={(event) => {
                event.stopPropagation();
              }}
            >
              <div className="modal-header">
                <div>
                  <p className="section-tag">Sandbox 详情</p>
                  <h2>{sandboxRuntimeDetail.runtime.alias || sandboxRuntimeDetail.taskSession?.title || sandboxDisplayLabel(sandboxRuntimeDetail)}</h2>
                  {sandboxModalOrigin ? <p className="modal-context-path">来自 {sandboxModalOrigin.trail}</p> : null}
                </div>
                <div className="conversation-dialog-actions">
                  {activeSection !== 'sandbox' ? (
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={openSandboxManagementView}
                    >
                      在 Sandbox 管理中查看
                    </button>
                  ) : null}
                  <button type="button" className="secondary-btn" onClick={closeSandboxDetail}>
                    关闭
                  </button>
                </div>
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
                  className={`inspector-tab-card ${sandboxDetailTab === 'files' ? 'active' : ''}`}
                  onClick={() => setSandboxDetailTab('files')}
                >
                  <span className="inspector-tab-card-key mono">02</span>
                  <span className="inspector-tab-card-label">文件</span>
                </button>
                <button
                  type="button"
                  className={`inspector-tab-card ${sandboxDetailTab === 'processes' ? 'active' : ''}`}
                  onClick={() => setSandboxDetailTab('processes')}
                >
                  <span className="inspector-tab-card-key mono">03</span>
                  <span className="inspector-tab-card-label">进程与端口</span>
                </button>
                <button
                  type="button"
                  className={`inspector-tab-card ${sandboxDetailTab === 'connectivity' ? 'active' : ''}`}
                  onClick={() => setSandboxDetailTab('connectivity')}
                >
                  <span className="inspector-tab-card-key mono">04</span>
                  <span className="inspector-tab-card-label">连通性</span>
                </button>
                <button
                  type="button"
                  className={`inspector-tab-card ${sandboxDetailTab === 'archive' ? 'active' : ''}`}
                  onClick={() => setSandboxDetailTab('archive')}
                >
                  <span className="inspector-tab-card-key mono">05</span>
                  <span className="inspector-tab-card-label">归档</span>
                </button>
                <button
                  type="button"
                  className={`inspector-tab-card ${sandboxDetailTab === 'terminal' ? 'active' : ''}`}
                  onClick={() => setSandboxDetailTab('terminal')}
                >
                  <span className="inspector-tab-card-key mono">06</span>
                  <span className="inspector-tab-card-label">命令调试</span>
                </button>
              </div>

              <div className="modal-body">
              {sandboxDetailTab === 'overview' ? (
                <div className="inspector-page-stack sandbox-overview-stack">
                  <article className="inspector-card inspector-overview-hero">
                    <div className="inspector-overview-hero-top">
                      <div>
                        <p className="section-tag">运行摘要</p>
                        <h3 className="inspector-overview-title">
                          {sandboxRuntimeDetail.runtime.alias || sandboxRuntimeDetail.taskSession?.title || sandboxDisplayLabel(sandboxRuntimeDetail)}
                        </h3>
                        <p className="inspector-overview-subtitle mono">{sandboxDisplayLabel(sandboxRuntimeDetail)}</p>
                      </div>
                      <div className="inspector-overview-badges">
                        <span className={stateClassName(sandboxRuntimeDetail.runtime.sandboxState || sandboxRuntimeDetail.runtime.status)}>
                          {sandboxRuntimeStateLabel(sandboxRuntimeDetail.runtime.sandboxState || sandboxRuntimeDetail.runtime.status)}
                        </span>
                        <span className="session-status">
                          {archiveStatusLabel(sandboxRuntimeDetail.archive.archiveStatus || sandboxRuntimeDetail.runtime.archiveStatus) === '-'
                            ? '未归档'
                            : archiveStatusLabel(sandboxRuntimeDetail.archive.archiveStatus || sandboxRuntimeDetail.runtime.archiveStatus)}
                        </span>
                        <span className="session-status">
                          {sandboxRuntimeDetail.runtime.source === 'live_only' ? '仅实时发现' : '已纳管'}
                        </span>
                      </div>
                    </div>

                    <div className="inspector-overview-stat-strip">
                      <article className="inspector-overview-stat">
                        <span>会话状态</span>
                        <strong>{sandboxRuntimeDetail.taskSession ? statusLabel(sandboxRuntimeDetail.taskSession.status) : '-'}</strong>
                        <small>{sandboxRuntimeDetail.runtime.taskSessionId ? '已绑定任务会话' : '当前未绑定会话'}</small>
                      </article>
                      <article className="inspector-overview-stat">
                        <span>最近活跃</span>
                        <strong>{formatDateTime(sandboxRuntimeDetail.runtime.lastActiveAt)}</strong>
                        <small>{sandboxRuntimeDetail.runtime.lastActiveReason || '暂无活跃原因'}</small>
                      </article>
                      <article className="inspector-overview-stat">
                        <span>归档状态</span>
                        <strong>
                          {archiveStatusLabel(sandboxRuntimeDetail.archive.archiveStatus || sandboxRuntimeDetail.runtime.archiveStatus) === '-'
                            ? '未归档'
                            : archiveStatusLabel(sandboxRuntimeDetail.archive.archiveStatus || sandboxRuntimeDetail.runtime.archiveStatus)}
                        </strong>
                        <small>
                          {sandboxRuntimeDetail.archive.archiveDirty
                            ? '当前有未归档变更'
                            : sandboxRuntimeDetail.archive.pendingArchiveUpdate
                              ? '等待归档更新'
                              : '归档状态稳定'}
                        </small>
                      </article>
                    </div>

                    <div className="inspector-kv-grid inspector-overview-kv-grid">
                      <div><span>Sandbox 标识</span><strong className="mono">{sandboxDisplayLabel(sandboxRuntimeDetail)}</strong></div>
                      <div><span>执行器</span><strong>{executorLabel(sandboxRuntimeDetail.runtime.executor)}</strong></div>
                      <div><span>模板</span><strong className="mono">{sandboxRuntimeDetail.runtime.template || '-'}</strong></div>
                      <div><span>会话标题</span><strong>{sandboxRuntimeDetail.taskSession?.title || sandboxRuntimeDetail.runtime.taskTitle || '-'}</strong></div>
                      <div><span>创建时间</span><strong>{formatDateTime(sandboxRuntimeDetail.runtime.createdAt || sandboxRuntimeDetail.runtime.startedAt)}</strong></div>
                      <div><span>最后更新</span><strong>{formatDateTime(sandboxRuntimeDetail.runtime.updatedAt || sandboxRuntimeDetail.runtime.lastActiveAt)}</strong></div>
                    </div>

                    {sandboxRuntimeDetail.runtime.riskTags.length ? (
                      <div className="runtime-risk-list inspector-overview-risk-list">
                        {sandboxRuntimeDetail.runtime.riskTags.map((risk) => (
                          <span key={risk} className="session-status">
                            {sandboxRiskLabel(risk)}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </article>

                  <section className="inspector-overview-bottom-grid">
                    <article className="inspector-card inspector-card-large">
                      <div className="inspector-card-header">
                        <div>
                          <h3>关联会话</h3>
                          <p className="panel-caption">快速定位当前 Sandbox 的归属与运行入口。</p>
                        </div>
                        {sandboxRuntimeDetail.runtime.taskSessionId ? (
                          <button
                            type="button"
                            className="link-btn sandbox-jump-btn mono"
                            onClick={() => openConversationSessionFromSandbox(sandboxRuntimeDetail.runtime.taskSessionId)}
                          >
                            {sandboxRuntimeDetail.runtime.taskSessionId}
                          </button>
                        ) : (
                          <span className="session-meta">未绑定会话</span>
                        )}
                      </div>
                      <div className="inspector-kv-grid inspector-overview-kv-grid">
                        <div><span>会话标识</span><strong className="mono">{sandboxRuntimeDetail.runtime.taskSessionId || '-'}</strong></div>
                        <div><span>会话标题</span><strong>{sandboxRuntimeDetail.taskSession?.title || sandboxRuntimeDetail.runtime.taskTitle || '-'}</strong></div>
                        <div><span>OpenCode 地址</span><strong className="mono">{sandboxRuntimeDetail.runtime.opencodeBaseUrl || '-'}</strong></div>
                        <div><span>OSAC 地址</span><strong className="mono">{sandboxRuntimeDetail.runtime.osacEndpoint || '-'}</strong></div>
                      </div>
                    </article>
                    <article className="inspector-card inspector-overview-actions-card">
                      <div className="inspector-card-header">
                        <div>
                          <h3>运行动作</h3>
                          <p className="panel-caption">开机、关机、重启与归档都集中在这里。</p>
                        </div>
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
                  <article className="inspector-card archive-overview-hero">
                    <div className="archive-overview-hero-top">
                      <div>
                        <p className="section-tag">归档摘要</p>
                        <h3 className="archive-overview-title">
                          {currentArchiveRow ? archiveEntryTypeLabel(currentArchiveRow.type) : '当前没有归档快照'}
                        </h3>
                        <p className="panel-caption archive-overview-caption">
                          {currentArchiveRow
                            ? `最近归档时间 ${formatDateTime(currentArchiveRow.timestamp)}`
                            : '可在这里查看当前快照、历史快照以及归档元数据。'}
                        </p>
                      </div>
                      <div className="inspector-overview-badges">
                        <span className="session-status">快照 {archiveRows.length}</span>
                        <span className={stateClassName(currentArchiveRow?.status || sandboxRuntimeDetail.archive.archiveStatus || 'unknown')}>
                          {currentArchiveRow
                            ? archiveStatusLabel(currentArchiveRow.status)
                            : archiveStatusLabel(sandboxRuntimeDetail.archive.archiveStatus || 'unknown')}
                        </span>
                        <span className="session-status">
                          {sandboxRuntimeDetail.archive.archiveDirty
                            ? '有未归档变更'
                            : sandboxRuntimeDetail.archive.pendingArchiveUpdate
                              ? '等待归档更新'
                              : '状态稳定'}
                        </span>
                      </div>
                    </div>

                    <div className="archive-overview-stat-strip">
                      <article className="archive-overview-stat">
                        <span>最近归档</span>
                        <strong>{formatDateTime(currentArchiveRow?.timestamp)}</strong>
                        <small>{currentArchiveRow?.reason || '当前没有归档原因'}</small>
                      </article>
                      <article className="archive-overview-stat">
                        <span>快照数量</span>
                        <strong>{archiveRows.length}</strong>
                        <small>{archiveRows.length > 0 ? '含当前与历史快照' : '尚未生成快照'}</small>
                      </article>
                      <article className="archive-overview-stat">
                        <span>当前体积</span>
                        <strong>{currentArchiveRow?.size || '-'}</strong>
                        <small>{currentArchiveRow?.hash ? '已记录校验哈希' : '暂未记录哈希'}</small>
                      </article>
                    </div>

                    <div className="inspector-kv-grid archive-overview-kv-grid">
                      <div>
                        <span>当前快照</span>
                        <strong className="mono">{currentArchiveRow?.id || sandboxRuntimeDetail.archive.snapshotKey || '-'}</strong>
                      </div>
                      <div>
                        <span>归档状态</span>
                        <strong>{currentArchiveRow ? archiveStatusLabel(currentArchiveRow.status) : archiveStatusLabel(sandboxRuntimeDetail.archive.archiveStatus || 'unknown')}</strong>
                      </div>
                      <div>
                        <span>最近恢复</span>
                        <strong>{formatDateTime(sandboxRuntimeDetail.archive.restoredAt)}</strong>
                      </div>
                      <div>
                        <span>元数据键</span>
                        <strong className="mono">{sandboxRuntimeDetail.archive.metadataKey || '-'}</strong>
                      </div>
                    </div>

                    <div className="archive-overview-actions">
                      <button
                        type="button"
                        className="primary-btn"
                        disabled={sandboxBusyIds[sandboxRuntimeDetail.runtime.sandboxId]}
                        onClick={() => void runSandboxArchive(sandboxRuntimeDetail.runtime.sandboxId)}
                      >
                        手动归档
                      </button>
                      <button
                        type="button"
                        className="secondary-btn snapshot-action-download"
                        disabled={sandboxBusyIds[sandboxRuntimeDetail.runtime.sandboxId] || !currentArchiveRow?.snapshotKey}
                        onClick={() =>
                          currentArchiveRow?.snapshotKey
                            ? void downloadSandboxSnapshot(sandboxRuntimeDetail.runtime.sandboxId, currentArchiveRow.snapshotKey)
                            : undefined
                        }
                      >
                        下载当前快照
                      </button>
                      <button
                        type="button"
                        className="secondary-btn snapshot-action-restore"
                        disabled={sandboxBusyIds[sandboxRuntimeDetail.runtime.sandboxId] || !currentArchiveRow?.snapshotKey}
                        onClick={() =>
                          currentArchiveRow?.snapshotKey
                            ? void runSandboxRestore(sandboxRuntimeDetail.runtime.sandboxId, currentArchiveRow.snapshotKey)
                            : undefined
                        }
                      >
                        恢复当前快照
                      </button>
                    </div>
                  </article>

                  <article className="inspector-card archive-history-card">
                    <div className="inspector-card-header archive-history-head">
                      <div>
                        <h3>历史快照</h3>
                        <p className="panel-caption">按时间查看快照、类型、体积和处理状态。</p>
                      </div>
                      <span className="session-status">共 {archiveSortedRows.length} 条</span>
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
                              <td><span className="session-status">{archiveEntryTypeLabel(row.type)}</span></td>
                              <td>{row.size}</td>
                              <td>{row.reason}</td>
                              <td><span className={stateClassName(row.status)}>{archiveStatusLabel(row.status)}</span></td>
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

                  <details className="inspector-card archive-meta-card">
                    <summary className="archive-meta-summary">
                      <div>
                        <h3>归档元数据</h3>
                        <p className="panel-caption">原始元数据仍保留，默认收起避免打断主视线。</p>
                      </div>
                      <span className="session-status">JSON</span>
                    </summary>
                    <pre className="json-block debug-output-block">{toJsonText(sandboxRuntimeDetail.archive)}</pre>
                  </details>

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
                            <p className="section-tag">快照详情</p>
                            <h3>{archiveDetailRow.id}</h3>
                            <p className="panel-caption">完整标识、校验信息和恢复动作都集中在这里。</p>
                          </div>
                          <div className="archive-detail-popup-head-actions">
                            <span className={stateClassName(archiveDetailRow.status)}>{archiveStatusLabel(archiveDetailRow.status)}</span>
                            <button type="button" className="secondary-btn" onClick={() => setArchiveDetailRow(null)}>
                              关闭
                            </button>
                          </div>
                        </div>
                        <div className="archive-detail-popup-body">
                          <article className="archive-detail-summary-card">
                            <div className="archive-detail-summary-top">
                              <div>
                                <span className="archive-detail-summary-label">快照概览</span>
                                <strong className="archive-detail-summary-title">{archiveEntryTypeLabel(archiveDetailRow.type)}</strong>
                                <p className="panel-caption archive-detail-summary-caption">
                                  {formatDateTime(archiveDetailRow.timestamp)} · {archiveDetailRow.reason}
                                </p>
                              </div>
                              <div className="archive-detail-summary-badges">
                                <span className="session-status">{archiveDetailRow.size}</span>
                                <span className={stateClassName(archiveDetailRow.status)}>{archiveStatusLabel(archiveDetailRow.status)}</span>
                              </div>
                            </div>
                            <div className="archive-detail-facts">
                              <article className="archive-detail-fact">
                                <span>时间</span>
                                <strong>{formatDateTime(archiveDetailRow.timestamp)}</strong>
                              </article>
                              <article className="archive-detail-fact">
                                <span>类型</span>
                                <strong>{archiveEntryTypeLabel(archiveDetailRow.type)}</strong>
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
                          </article>
                          <div className="archive-detail-code-grid">
                            <article className="archive-detail-code-card">
                              <span>快照标识</span>
                              <code className="mono">{archiveDetailRow.id}</code>
                            </article>
                            <article className="archive-detail-code-card">
                              <span>哈希</span>
                              <code className="mono">{archiveDetailRow.hash}</code>
                            </article>
                          </div>
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

              {sandboxDetailTab === 'files' ? (
                <div className={`inspector-page-stack file-explorer-page ${sandboxFileTransferActive ? 'is-transfer-active' : ''}`}>
                  <section className="file-explorer-toolbar" aria-label="Sandbox 文件工具栏">
                    <div className="file-explorer-nav-actions">
                      <button type="button" className="secondary-btn" onClick={() => void goSandboxFileParent()}>
                        上级
                      </button>
                      <button type="button" className="secondary-btn" onClick={() => void listSandboxFiles(undefined, { resetTreeRoot: true })}>
                        刷新
                      </button>
                    </div>
                    <label className="file-explorer-address">
                      <span>地址</span>
                      <input
                        className="text-input"
                        value={sandboxDirectoryPath}
                        onChange={(event) => setSandboxDirectoryPath(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            void listSandboxFiles(undefined, { resetTreeRoot: true });
                          }
                        }}
                        placeholder="/"
                      />
                    </label>
                    <div className="file-explorer-file-actions" aria-label="Sandbox 文件操作">
                      <button
                        type="button"
                        className="secondary-btn"
                        disabled={sandboxFileActionsBusy}
                        onClick={openSandboxFileUploadPicker}
                      >
                        {sandboxFileOperation === 'upload' ? '上传中' : '上传'}
                      </button>
                      <input
                        ref={sandboxFileUploadInputRef}
                        className="file-explorer-upload-input"
                        type="file"
                        multiple
                        onChange={(event) => void uploadSandboxFiles(event)}
                      />
                      <button
                        type="button"
                        className="secondary-btn"
                        disabled={sandboxFileActionsBusy || !canDownloadSandboxFile}
                        onClick={() => void downloadSandboxFile()}
                      >
                        {sandboxFileOperation === 'download' ? '下载中' : '下载'}
                      </button>
                      <button
                        type="button"
                        className="table-btn danger"
                        disabled={sandboxFileActionsBusy || !canDeleteSandboxFileTarget}
                        onClick={() => void deleteSandboxFileTarget()}
                      >
                        {sandboxFileOperation === 'delete' ? '删除中' : '删除'}
                      </button>
                    </div>
                  </section>

                  <section className="file-explorer-shell">
                    <article className="file-explorer-main">
                      <div className="file-tree-head">
                        <code className="mono">{sandboxDirectoryPath}</code>
                      </div>
                      <div className="file-tree-list" role="tree" aria-label="Sandbox 文件树">
                        {sandboxFileTreeRows.length ? (
                          sandboxFileTreeRows.map((item) => {
                            const isActive = !item.isEmpty && (sandboxFilePath === item.path || sandboxDirectoryPath === item.path);
                            const itemKindClass = item.isEmpty ? 'is-empty' : item.kind === 'dir' ? 'is-dir' : 'is-file';
                            return (
                              <div
                                key={`${item.path}-${item.depth}`}
                                className={`file-tree-row ${isActive ? 'active' : ''} ${itemKindClass}`}
                                style={{ paddingLeft: `${item.depth * 18 + 8}px` }}
                                role="treeitem"
                                aria-expanded={item.kind === 'dir' && !item.isEmpty ? item.expanded : undefined}
                              >
                                <button
                                  type="button"
                                  className="file-tree-disclosure mono"
                                  disabled={item.isEmpty || item.kind !== 'dir' || item.isRoot}
                                  onClick={() => void toggleSandboxFileTreeDirectory(item)}
                                  aria-label={item.expanded ? '折叠目录' : '展开目录'}
                                >
                                  {item.isEmpty ? '·' : item.kind === 'dir' ? (item.isRoot || item.expanded ? 'v' : '>') : '-'}
                                </button>
                                {item.isEmpty ? (
                                  <span className="file-tree-node file-tree-empty-node">
                                    <span className="file-tree-empty-mark mono">EMPTY</span>
                                    <span className="file-tree-node-main">
                                      <span>空目录</span>
                                      <small>没有子项</small>
                                    </span>
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    className="file-tree-node"
                                    onClick={() => void openSandboxFileItem(item)}
                                  >
                                    <span className={`file-explorer-icon ${item.kind === 'dir' ? 'is-dir' : 'is-file'} mono`}>
                                      {sandboxFileIconText(item)}
                                    </span>
                                    <span className="file-tree-node-main">
                                      <span>{item.isRoot ? item.path : item.label}</span>
                                      <small className="mono">{item.path}</small>
                                    </span>
                                  </button>
                                )}
                                <span className="file-tree-permissions mono">{sandboxFilePermissionsText(item)}</span>
                                <span className="file-tree-meta">{item.isEmpty ? '0 项' : item.kind === 'dir' ? (item.loaded ? `${item.childCount} 项` : '未展开') : formatBytes(item.sizeBytes)}</span>
                                <span className="file-tree-meta">{item.isEmpty ? '空' : sandboxFileTypeLabel(item)}</span>
                                <span className="file-tree-meta">{item.isEmpty || !item.modifiedAt ? '-' : formatDateTime(item.modifiedAt)}</span>
                              </div>
                            );
                          })
                        ) : (
                          <p className="empty">当前目录暂无内容，或请先刷新目录。</p>
                        )}
                      </div>
                    </article>
                  </section>
                  {sandboxFileTransferProgress ? (
                    <div className="file-transfer-overlay" role="status" aria-live="polite">
                      <div className="file-transfer-card">
                        <span className="file-transfer-eyebrow">
                          {sandboxFileTransferProgress.operation === 'upload' ? '上传文件' : '下载文件'}
                        </span>
                        <strong>{sandboxFileTransferProgress.label}</strong>
                        <span className="file-transfer-detail mono">{sandboxFileTransferProgress.detail}</span>
                        <div
                          className={`file-transfer-progress-track ${sandboxFileTransferPercent === null ? 'is-indeterminate' : ''}`}
                          role="progressbar"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={sandboxFileTransferPercent === null ? undefined : sandboxFileTransferPercent}
                        >
                          <span
                            className="file-transfer-progress-bar"
                            style={sandboxFileTransferPercent === null ? undefined : { width: `${sandboxFileTransferPercent}%` }}
                          />
                        </div>
                        <span className="file-transfer-percent mono">
                          {sandboxFileTransferPercent === null ? '处理中' : `${sandboxFileTransferPercent}%`}
                        </span>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {sandboxDetailTab === 'processes' ? (
                <div className="inspector-page-stack task-manager-page">
                  <section className="task-manager-view-switch" aria-label="选择进程或端口视图">
                    <button
                      type="button"
                      className={`task-manager-view-btn ${sandboxProcessToolView === 'processes' ? 'active' : ''}`}
                      onClick={() => setSandboxProcessToolView('processes')}
                    >
                      <span>进程</span>
                      <strong>{processRows.length || '-'}</strong>
                    </button>
                    <button
                      type="button"
                      className={`task-manager-view-btn ${sandboxProcessToolView === 'ports' ? 'active' : ''}`}
                      onClick={() => setSandboxProcessToolView('ports')}
                    >
                      <span>端口</span>
                      <strong>{portRows.length || '-'}</strong>
                    </button>
                  </section>

                  {sandboxProcessToolView === 'processes' ? (
                    <article className="inspector-card task-manager-panel task-manager-panel-full">
                      <div className="inspector-card-header task-manager-card-head">
                        <div className="task-manager-panel-title">
                          <div className="task-manager-panel-heading">
                            <h3>进程</h3>
                            <span className="task-manager-panel-pill">{processRows.length ? `${processRows.length} 个进程` : '等待刷新'}</span>
                          </div>
                          <div className="task-manager-panel-meta">
                            <span className="task-manager-toolbar-note">点击列表行可快速带入 PID</span>
                            <span className="task-manager-panel-age mono">{processListAgeLabel}</span>
                          </div>
                        </div>
                        <div className="task-manager-panel-tools" aria-label="Sandbox 进程操作">
                          <button type="button" className="secondary-btn" onClick={() => void loadSandboxProcesses()}>
                            刷新进程
                          </button>
                          <label className="task-manager-inline-field">
                            <span>结束 PID</span>
                            <input
                              className="text-input mono"
                              value={sandboxPidInput}
                              onChange={(event) => setSandboxPidInput(event.target.value)}
                              placeholder="PID"
                            />
                          </label>
                          <button type="button" className="primary-btn" onClick={() => void killSandboxProcess()}>
                            结束进程
                          </button>
                        </div>
                      </div>
                      <div className="task-manager-table-wrap">
                        <table className="task-manager-table task-manager-table-selectable">
                          <thead>
                            <tr>
                              <th>PID</th>
                              <th>用户</th>
                              <th>CPU</th>
                              <th>内存</th>
                              <th>状态</th>
                              <th>运行时长</th>
                              <th>命令</th>
                            </tr>
                          </thead>
                          <tbody>
                            {processRows.length ? (
                              processRows.slice(0, 120).map((row) => (
                                <tr
                                  key={`${row.pid}-${row.command}`}
                                  className={sandboxPidInput === row.pid ? 'active' : undefined}
                                  onClick={() => {
                                    if (row.pidValue) setSandboxPidInput(row.pid);
                                  }}
                                >
                                  <td className="mono">{row.pid}</td>
                                  <td>{row.user}</td>
                                  <td className="mono">{row.cpuPercent}</td>
                                  <td className="mono">{row.memoryPercent}</td>
                                  <td>{row.state}</td>
                                  <td className="mono">{row.elapsed}</td>
                                  <td>
                                    <span className="task-manager-process-cell">
                                      <span>{row.command}</span>
                                      {row.args ? <small>{row.args}</small> : null}
                                    </span>
                                  </td>
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td colSpan={7}>
                                  <p className="empty">当前还没有进程数据。</p>
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </article>
                  ) : (
                    <article className="inspector-card task-manager-panel task-manager-panel-full">
                      <div className="inspector-card-header task-manager-card-head">
                        <div className="task-manager-panel-title">
                          <div className="task-manager-panel-heading">
                            <h3>端口</h3>
                            <span className="task-manager-panel-pill">{portRows.length ? `${portRows.length} 个监听项` : '等待刷新'}</span>
                          </div>
                          <div className="task-manager-panel-meta">
                            <span className="task-manager-toolbar-note">手动刷新可更新监听端口快照</span>
                            <span className="task-manager-panel-age mono">{portListAgeLabel}</span>
                          </div>
                        </div>
                        <div className="task-manager-panel-tools" aria-label="Sandbox 端口操作">
                          <button type="button" className="secondary-btn" onClick={() => void inspectSandboxPorts()}>
                            刷新端口
                          </button>
                        </div>
                      </div>
                      <div className="task-manager-table-wrap">
                        <table className="task-manager-table">
                          <thead>
                            <tr>
                              <th>协议</th>
                              <th>状态</th>
                              <th>本地地址</th>
                              <th>端口</th>
                              <th>对端</th>
                              <th>进程</th>
                            </tr>
                          </thead>
                          <tbody>
                            {portRows.length ? (
                              portRows.map((row) => (
                                <tr
                                  key={row.id}
                                  title={row.raw}
                                >
                                  <td className="mono">{row.protocol}</td>
                                  <td>{row.status}</td>
                                  <td className="mono">{row.localAddress}</td>
                                  <td className="mono">{row.port}</td>
                                  <td className="mono">{row.peerAddress}</td>
                                  <td>{row.process}</td>
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td colSpan={6}>
                                  <p className="empty">当前还没有端口数据。</p>
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </article>
                  )}

                  <details className="debug-disclosure task-manager-raw-output">
                    <summary>原始输出</summary>
                    <div className="debug-disclosure-body debug-meta-grid">
                      <pre className="json-block debug-output-block">
                        {sandboxProcessToolView === 'processes'
                          ? formatSandboxProcessResult(sandboxProcessResult)
                          : formatSandboxPortResult(sandboxPortResult)}
                      </pre>
                    </div>
                  </details>
                </div>
              ) : null}

              {sandboxDetailTab === 'terminal' ? (
                <div className="inspector-page-stack debug-console command-debug-console">
                  <article className="inspector-log-shell terminal-console">
                    <div className="inspector-card-header">
                      <div>
                        <h2>命令调试</h2>
                        <span className="panel-caption">命令、输入和回显统一使用等宽字体</span>
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
                        placeholder="pwd && ls -la"
                      />
                      <button type="button" className="primary-btn" onClick={() => void runSandboxCommand()}>
                        发送
                      </button>
                    </div>
                  </article>

                  <details className="debug-disclosure">
                    <summary>运行元数据</summary>
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

        {templateModalOpen ? (
          <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={closeTemplateDetail}>
            <div
              className="modal-card template-workbench-modal"
              onClick={(event) => {
                event.stopPropagation();
              }}
            >
              <div className="modal-header">
                <div>
                  <p className="section-tag">模板工作台</p>
                  <h2>{templateWorkbenchTitle}</h2>
                  <p className="panel-caption">{templateWorkbenchCaption}</p>
                </div>
                <button type="button" className="secondary-btn" onClick={closeTemplateDetail}>
                  关闭
                </button>
              </div>
              <div className="template-workbench-layout">
                <aside className="template-workbench-sidebar">
                  <div className="template-workbench-sidebar-head">
                    <div className="template-workbench-sidebar-head-meta">
                      <strong>模板列表</strong>
                      <span>{templates.length} 个</span>
                    </div>
                    <button
                      type="button"
                      className="secondary-btn template-workbench-create-trigger"
                      onClick={openTemplateCreateWorkbench}
                    >
                      新建模板
                    </button>
                  </div>
                  <div className="template-workbench-list">
                    {templates.length === 0 ? (
                      <p className="empty template-workbench-empty-text">暂无模板记录</p>
                    ) : (
                      templates.map((item, idx) => {
                        const templateId = (item as any).templateID ?? (item as any).templateId ?? `template-${idx}`;
                        const alias = item.alias || (item as any).name || '未设置';
                        const updatedAt = item.updatedAt || item.createdAt || null;
                        const isActive = currentTemplateId === templateId;
                        return (
                          <button
                            key={templateId}
                            type="button"
                            className={`template-workbench-item ${isActive ? 'active' : ''}`}
                            onClick={() => void openTemplateDetail(templateId)}
                          >
                            <div className="template-workbench-item-head">
                              <strong title={templateId}>{truncateMiddle(templateId, 10, 8)}</strong>
                              <span>{templateStatusLabel(String(item.status ?? '-'))}</span>
                            </div>
                            <span className="template-workbench-item-alias" title={alias}>
                              {alias}
                            </span>
                            <span className="template-workbench-item-meta" title={updatedAt ? formatDateTime(updatedAt) : undefined}>
                              {updatedAt ? `更新于 ${formatRelativeTime(updatedAt)}` : '等待更新'}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </aside>

                <div className="template-workbench-main">
                  {templateWorkbenchMode === 'create' ? (
                    <div className="template-workbench-detail-stack">
                      <article className="sub-panel template-workbench-create-panel">
                        <div className="template-workbench-create-head">
                          <div>
                            <p className="kpi-title">新建模板</p>
                            <p className="panel-caption">填写模板创建 payload JSON，创建完成后自动切到新模板详情。</p>
                          </div>
                          {templateDetail ? (
                            <button
                              type="button"
                              className="secondary-btn"
                              onClick={() => setTemplateWorkbenchMode('detail')}
                            >
                              返回当前模板
                            </button>
                          ) : null}
                        </div>
                        <textarea
                          className="input-area template-workbench-create-input"
                          rows={14}
                          placeholder="填写 E2B TemplateBuildRequest JSON"
                          value={templateActionPayload}
                          onChange={(event) => setTemplateActionPayload(event.target.value)}
                        />
                        <div className="button-grid">
                          <button type="button" className="secondary-btn" onClick={() => setTemplateActionPayload('{}')}>
                            重置
                          </button>
                          <button type="button" className="primary-btn" onClick={() => void runTemplateAction('create')}>
                            创建模板
                          </button>
                        </div>
                        <p className="panel-caption">这里直接复用现有模板创建接口；成功后会刷新左侧模板列表并切到详情视图。</p>
                      </article>
                    </div>
                  ) : templateDetail ? (
                    <div className="template-workbench-detail-stack">
                      <div className="detail-grid modal-grid template-workbench-detail-grid">
                        <article className="sub-panel">
                          <p className="kpi-title">模板摘要</p>
                          <div className="validation-result">
                            <div>模板 ID: {currentTemplateId || '-'}</div>
                            <div>当前别名: {currentTemplateAlias || '未设置'}</div>
                            <div>状态: {templateStatusLabel(String((templateDetail as any).status ?? '-'))}</div>
                            <div>更新时间: {formatDateTime((templateDetail as any).updatedAt ?? (templateDetail as any).createdAt)}</div>
                          </div>
                          <details className="template-raw-details">
                            <summary>查看原始详情</summary>
                            <pre className="json-block">{toJsonText(templateDetail)}</pre>
                          </details>
                        </article>
                        <article className="sub-panel">
                          <p className="kpi-title">别名设置</p>
                          <label className="form-field">
                            <span>模板别名</span>
                            <input
                              className="control-input"
                              placeholder="例如：opencode-playwright-min"
                              value={templateAliasDraft}
                              onChange={(event) => {
                                setTemplateAliasDraft(event.target.value);
                                setTemplateAliasResult(null);
                              }}
                            />
                          </label>
                          <div className="button-grid">
                            <button type="button" className="secondary-btn" disabled={!templateAliasDraft.trim()} onClick={() => void checkAlias()}>
                              检查是否可用
                            </button>
                            <button
                              type="button"
                              className="primary-btn"
                              disabled={!templateAliasDraft.trim() || templateAliasDraft.trim() === currentTemplateAlias}
                              onClick={() => void saveTemplateAlias()}
                            >
                              保存别名
                            </button>
                          </div>
                          {templateAliasResult ? (
                            <div className={`alias-check-card ${templateAliasCheck.state}`}>
                              <strong>{templateAliasCheck.message}</strong>
                              <span>
                                {templateAliasDraft.trim() || '-'}
                                {templateAliasCheck.targetTemplateId ? ` · ${templateAliasCheck.targetTemplateId}` : ''}
                              </span>
                            </div>
                          ) : (
                            <p className="panel-caption">别名检测已从模板首页移除，收敛到详情内作为辅助动作。</p>
                          )}
                        </article>
                      </div>

                      <article className="sub-panel">
                        <p className="kpi-title">模板操作</p>
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
                        </div>
                        <div className="danger-zone">
                          <p className="panel-caption">危险操作单独放置，避免与别名设置和常规维护混用。</p>
                          <button type="button" className="table-btn danger" onClick={() => void runTemplateAction('delete')}>
                            删除模板
                          </button>
                        </div>
                      </article>

                      {(templateDetail as any)?.builds ? (
                        <div className="panel template-workbench-build-panel">
                          <div className="panel-header">
                            <h2>构建记录</h2>
                            <span className="panel-caption">用于查看当前模板最近构建状态</span>
                          </div>
                          <div className="table-wrap">
                            <table>
                              <thead>
                                <tr>
                                  <th>构建 ID</th>
                                  <th>状态</th>
                                  <th>创建时间</th>
                                  <th>操作</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(templateDetail as any).builds.map((build: any) => (
                                  <tr key={build.buildID || build.buildId}>
                                    <td className="mono">{build.buildID || build.buildId}</td>
                                    <td>{templateStatusLabel(build.status || '-')}</td>
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
                  ) : (
                    <article className="sub-panel template-workbench-empty">
                      <p className="kpi-title">模板详情</p>
                      <p className="panel-caption">从左侧选择模板后查看摘要、别名设置和构建记录。</p>
                    </article>
                  )}
                </div>
              </div>
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
  const renderAuditEntryActions = (entry: AuditLogEntry) => (
    <div className="audit-link-stack">
      {entry.targetVmId ? (
        <button type="button" className="link-btn sandbox-jump-btn mono" onClick={() => openSandboxFromAudit(entry)}>
          查看 Sandbox
        </button>
      ) : null}
      {entry.sessionId ? (
        <button type="button" className="link-btn sandbox-jump-btn mono" onClick={() => openConversationFromAudit(entry)}>
          查看对话
        </button>
      ) : null}
    </div>
  );

  const renderAuditSection = () => {
    const auditDetailSubject = auditDetail
      ? auditDetail.entry.targetVmId || auditDetail.entry.sessionId || auditDetail.entry.id
      : '-';
    const sortedAuditRelatedEntries = auditDetail
      ? [...auditDetail.relatedEntries].sort((left, right) => {
          const delta = toTimestamp(right.timestamp) - toTimestamp(left.timestamp);
          if (delta !== 0) return delta;
          return right.id.localeCompare(left.id, 'zh-Hans-CN', { sensitivity: 'base' });
        })
      : [];

    return (
    <>
      <main className="content-stack viewport-lock-page audit-page">
        <section className="fade-in">
          <article className="panel hero-panel">
            <div className="panel-header audit-hero-header">
              <div>
                <p className="section-tag">审计摘要</p>
                <h2>管理动作与失败排查</h2>
              </div>
              <div className="sandbox-list-header-actions audit-hero-actions">
                <div className="audit-live-summary-strip session-status sandbox-live-count" aria-label="审计日志摘要">
                  <span className="sandbox-live-metric sandbox-live-metric-total">
                    <span>全部</span>
                    <strong>{auditSummary.total}</strong>
                  </span>
                  <span className="sandbox-live-metric sandbox-live-metric-running">
                    <span>成功</span>
                    <strong>{auditSummary.success}</strong>
                  </span>
                  <span className="sandbox-live-metric audit-live-metric-failed">
                    <span>失败</span>
                    <strong>{auditSummary.failed}</strong>
                  </span>
                  <span className="sandbox-live-age" title={formatDateTime(auditSummaryFetchedAt)}>
                    {auditSummaryAge}
                  </span>
                  <button
                    type="button"
                    className={`sandbox-live-refresh-btn ${auditSummaryRefreshing ? 'is-refreshing' : ''}`}
                    onClick={() => void refreshAuditSummary()}
                    disabled={auditSummaryRefreshing}
                    aria-label="刷新审计日志"
                  >
                    ↻
                  </button>
                </div>
              </div>
            </div>
          </article>
        </section>

        <section className="panel fade-in audit-filter-panel">
          <div className="audit-filter-toolbar">
            <div className="audit-filter-toolbar-copy">
              <p className="section-tag">筛选条件</p>
              <h2>筛选条件</h2>
              <span className="panel-caption">按关键词、操作人、动作、结果和时间快速定位。</span>
            </div>
          </div>
          <div className="audit-filter-grid audit-filter-grid-compact">
            <label className="audit-filter-field">
              <span>搜索</span>
              <input
                className="control-input"
                placeholder="日志 ID、详情、实例、会话"
                value={auditFilters.query}
                onChange={(event) => updateAuditFilters((previous) => ({ ...previous, query: event.target.value }))}
              />
            </label>
            <label className="audit-filter-field">
              <span>操作人</span>
              <select
                className="control-input"
                value={auditFilters.operator}
                onChange={(event) => updateAuditFilters((previous) => ({ ...previous, operator: event.target.value }))}
              >
                <option value="all">全部操作人</option>
                {auditOperatorOptions.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label className="audit-filter-field">
              <span>动作</span>
              <select
                className="control-input"
                value={auditFilters.action}
                onChange={(event) => updateAuditFilters((previous) => ({ ...previous, action: event.target.value }))}
              >
                <option value="all">全部动作</option>
                {auditActionOptions.map((item) => (
                  <option key={item} value={item}>
                    {auditActionLabel(item)}
                  </option>
                ))}
              </select>
            </label>
            <label className="audit-filter-field">
              <span>结果</span>
              <select
                className="control-input"
                value={auditFilters.result}
                onChange={(event) => updateAuditFilters((previous) => ({ ...previous, result: event.target.value }))}
              >
                <option value="all">全部结果</option>
                <option value="success">成功</option>
                <option value="failed">失败</option>
              </select>
            </label>
            <label className="audit-filter-field">
              <span>开始时间</span>
              <input
                className="control-input"
                type="datetime-local"
                value={auditFilters.from}
                onChange={(event) => updateAuditFilters((previous) => ({ ...previous, from: event.target.value }))}
              />
            </label>
            <label className="audit-filter-field">
              <span>结束时间</span>
              <input
                className="control-input"
                type="datetime-local"
                value={auditFilters.to}
                onChange={(event) => updateAuditFilters((previous) => ({ ...previous, to: event.target.value }))}
              />
            </label>
            <div className="audit-filter-actions">
              <button type="button" className="secondary-btn" onClick={resetAuditFilters}>
                重置筛选
              </button>
            </div>
          </div>
        </section>

        <section className="panel fade-in audit-log-panel">
          <div className="panel-header">
            <h2>审计日志</h2>
            <span className="panel-caption">
              当前显示 {auditEntries.length} 条，筛选后共 {auditResponseMeta.filteredTotal || auditEntries.length} 条
            </span>
          </div>
          <div className="table-wrap">
            <table className="audit-table">
              <thead>
                <tr>
                  <th>
                    <button type="button" className={`runtime-sort-btn ${auditSort.key === 'id' ? 'active' : ''}`} onClick={() => toggleAuditSort('id')}>
                      日志 ID
                      <span className="runtime-sort-indicator">{auditSort.key === 'id' ? (auditSort.direction === 'asc' ? '▲' : '▼') : '↕'}</span>
                    </button>
                  </th>
                  <th>
                    <button type="button" className={`runtime-sort-btn ${auditSort.key === 'time' ? 'active' : ''}`} onClick={() => toggleAuditSort('time')}>
                      时间
                      <span className="runtime-sort-indicator">{auditSort.key === 'time' ? (auditSort.direction === 'asc' ? '▲' : '▼') : '↕'}</span>
                    </button>
                  </th>
                  <th>
                    <button type="button" className={`runtime-sort-btn ${auditSort.key === 'action' ? 'active' : ''}`} onClick={() => toggleAuditSort('action')}>
                      动作
                      <span className="runtime-sort-indicator">{auditSort.key === 'action' ? (auditSort.direction === 'asc' ? '▲' : '▼') : '↕'}</span>
                    </button>
                  </th>
                  <th>
                    <button type="button" className={`runtime-sort-btn ${auditSort.key === 'result' ? 'active' : ''}`} onClick={() => toggleAuditSort('result')}>
                      结果
                      <span className="runtime-sort-indicator">{auditSort.key === 'result' ? (auditSort.direction === 'asc' ? '▲' : '▼') : '↕'}</span>
                    </button>
                  </th>
                  <th>
                    <button type="button" className={`runtime-sort-btn ${auditSort.key === 'operator' ? 'active' : ''}`} onClick={() => toggleAuditSort('operator')}>
                      操作人
                      <span className="runtime-sort-indicator">{auditSort.key === 'operator' ? (auditSort.direction === 'asc' ? '▲' : '▼') : '↕'}</span>
                    </button>
                  </th>
                  <th>
                    <button type="button" className={`runtime-sort-btn ${auditSort.key === 'target' ? 'active' : ''}`} onClick={() => toggleAuditSort('target')}>
                      目标实例
                      <span className="runtime-sort-indicator">{auditSort.key === 'target' ? (auditSort.direction === 'asc' ? '▲' : '▼') : '↕'}</span>
                    </button>
                  </th>
                  <th>
                    <button type="button" className={`runtime-sort-btn ${auditSort.key === 'session' ? 'active' : ''}`} onClick={() => toggleAuditSort('session')}>
                      会话
                      <span className="runtime-sort-indicator">{auditSort.key === 'session' ? (auditSort.direction === 'asc' ? '▲' : '▼') : '↕'}</span>
                    </button>
                  </th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {auditEntries.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="empty">
                      暂无符合条件的审计日志。
                    </td>
                  </tr>
                ) : (
                  sortedAuditEntries.map((entry) => (
                    <tr key={entry.id}>
                      <td>
                        <button
                          type="button"
                          className="link-btn sandbox-jump-btn mono audit-id-link"
                          title={entry.id}
                          onClick={() => void openAuditDetail(entry.id)}
                        >
                          {truncateMiddle(entry.id, 10, 8)}
                        </button>
                      </td>
                      <td>{formatDateTime(entry.timestamp)}</td>
                      <td>{auditActionLabel(entry.action)}</td>
                      <td>
                        <span className={resultClassName(entry.result)}>{auditResultLabel(entry.result)}</span>
                      </td>
                      <td>{entry.operator}</td>
                      <td>
                        {entry.targetVmId ? (
                          <button
                            type="button"
                            className="link-btn sandbox-jump-btn mono audit-id-link"
                            title={entry.targetVmId}
                            onClick={() => openSandboxFromAudit(entry)}
                          >
                            {truncateMiddle(entry.targetVmId, 10, 8)}
                          </button>
                        ) : (
                          <span className="mono">-</span>
                        )}
                      </td>
                      <td>
                        {entry.sessionId ? (
                          <button
                            type="button"
                            className="link-btn sandbox-jump-btn mono audit-id-link"
                            title={entry.sessionId}
                            onClick={() => openConversationFromAudit(entry)}
                          >
                            {truncateMiddle(entry.sessionId, 10, 8)}
                          </button>
                        ) : (
                          <span className="mono">-</span>
                        )}
                      </td>
                      <td>
                        <button type="button" className="table-btn" onClick={() => void openAuditDetail(entry.id)}>
                          查看详情
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {auditDetail ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setAuditDetail(null)}>
          <div
            className="modal-card audit-detail-modal"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <div className="modal-header audit-detail-modal-header">
              <div>
                <p className="section-tag">审计详情</p>
                <h2>{auditActionLabel(auditDetail.entry.action)} · {auditDetailSubject}</h2>
                <p className="panel-caption">
                  日志 {auditDetail.entry.id} · {formatDateTime(auditDetail.entry.timestamp)}
                </p>
              </div>
              <div className="audit-detail-header-actions">
                {auditDetail.entry.sessionId ? (
                  <button type="button" className="secondary-btn" onClick={() => openConversationFromAudit(auditDetail.entry)}>
                    打开对话
                  </button>
                ) : null}
                {auditDetail.entry.targetVmId ? (
                  <button type="button" className="secondary-btn" onClick={() => openSandboxFromAudit(auditDetail.entry)}>
                    打开 Sandbox
                  </button>
                ) : null}
                <button type="button" className="secondary-btn" onClick={() => setAuditDetail(null)}>
                  关闭
                </button>
              </div>
            </div>
            <div className="audit-detail-summary-strip">
              <span className={resultClassName(auditDetail.entry.result)}>{auditResultLabel(auditDetail.entry.result)}</span>
              <span className="audit-detail-meta-pill">{auditActionLabel(auditDetail.entry.action)}</span>
              <span className="audit-detail-meta-pill">{auditDetail.entry.operator || '-'}</span>
              <span className="audit-detail-meta-pill">{auditDetail.relatedEntries.length} 条关联</span>
            </div>
            <div className="detail-grid modal-grid audit-detail-grid">
              <article className="sub-panel audit-detail-primary-panel">
                <div className="editor-header">
                  <div>
                    <h3>当前记录</h3>
                    <p className="cell-subtle">先看当前动作与结果，再决定是否继续跳转或展开原始记录。</p>
                  </div>
                </div>
                <div className="audit-detail-fact-grid">
                  <div className="audit-detail-fact">
                    <span>日志 ID</span>
                    <strong className="mono">{auditDetail.entry.id}</strong>
                  </div>
                  <div className="audit-detail-fact">
                    <span>时间</span>
                    <strong>{formatDateTime(auditDetail.entry.timestamp)}</strong>
                  </div>
                  <div className="audit-detail-fact">
                    <span>动作</span>
                    <strong>{auditActionLabel(auditDetail.entry.action)}</strong>
                  </div>
                  <div className="audit-detail-fact">
                    <span>结果</span>
                    <strong>{auditResultLabel(auditDetail.entry.result)}</strong>
                  </div>
                  <div className="audit-detail-fact">
                    <span>操作人</span>
                    <strong>{auditDetail.entry.operator || '-'}</strong>
                  </div>
                  <div className="audit-detail-fact">
                    <span>目标实例</span>
                    <strong className="mono">{auditDetail.entry.targetVmId || '-'}</strong>
                  </div>
                  <div className="audit-detail-fact">
                    <span>会话 ID</span>
                    <strong className="mono">{auditDetail.entry.sessionId || '-'}</strong>
                  </div>
                  <div className="audit-detail-fact">
                    <span>关联记录</span>
                    <strong>{auditDetail.relatedEntries.length}</strong>
                  </div>
                </div>

                <div className={`audit-detail-note-card ${auditDetail.entry.detail ? '' : 'is-empty'}`}>
                  <span>说明</span>
                  <p>{auditDetail.entry.detail || '没有额外说明。'}</p>
                </div>

                <details className="audit-detail-json-panel">
                  <summary>查看原始记录</summary>
                  <pre className="json-block">{toJsonText(auditDetail.entry)}</pre>
                </details>
              </article>

              <article className="sub-panel audit-detail-sidebar-panel">
                <div className="editor-header">
                  <div>
                    <h3>关联上下文</h3>
                    <p className="cell-subtle">直接打开对应资源，或继续查看关联日志。</p>
                  </div>
                </div>
                <div className="audit-detail-context-grid">
                  <div className="audit-detail-context-card">
                    <span>日志 ID</span>
                    <strong className="mono">{auditDetail.entry.id}</strong>
                  </div>
                  {auditDetail.entry.targetVmId ? (
                    <div className="audit-detail-context-card">
                      <span>Sandbox</span>
                      <button
                        type="button"
                        className="link-btn sandbox-jump-btn mono audit-id-link"
                        title={auditDetail.entry.targetVmId}
                        onClick={() => openSandboxFromAudit(auditDetail.entry)}
                      >
                        {truncateMiddle(auditDetail.entry.targetVmId, 10, 8)}
                      </button>
                    </div>
                  ) : null}
                  {auditDetail.entry.sessionId ? (
                    <div className="audit-detail-context-card">
                      <span>对话</span>
                      <button
                        type="button"
                        className="link-btn sandbox-jump-btn mono audit-id-link"
                        title={auditDetail.entry.sessionId}
                        onClick={() => openConversationFromAudit(auditDetail.entry)}
                      >
                        {truncateMiddle(auditDetail.entry.sessionId, 10, 8)}
                      </button>
                    </div>
                  ) : null}
                </div>

                <div className="editor-header audit-detail-section-head">
                  <div>
                    <h3>关联记录</h3>
                    <p className="cell-subtle">按时间倒序展示，点击日志 ID 可继续查看细节。</p>
                  </div>
                </div>
                {sortedAuditRelatedEntries.length > 0 ? (
                  <div className="audit-related-list">
                    {sortedAuditRelatedEntries.map((entry) => (
                      <article key={entry.id} className="audit-related-item">
                        <div className="audit-related-head">
                          <button
                            type="button"
                            className="link-btn sandbox-jump-btn mono audit-id-link"
                            title={entry.id}
                            onClick={() => void openAuditDetail(entry.id)}
                          >
                            {truncateMiddle(entry.id, 10, 8)}
                          </button>
                          <span className={resultClassName(entry.result)}>{auditResultLabel(entry.result)}</span>
                        </div>
                        <div className="audit-related-meta">
                          <span>{auditActionLabel(entry.action)}</span>
                          <span>{formatDateTime(entry.timestamp)}</span>
                          <span>{entry.operator || '-'}</span>
                        </div>
                        {(entry.sessionId || entry.targetVmId) ? renderAuditEntryActions(entry) : null}
                        {entry.detail ? <p className="audit-related-detail">{entry.detail}</p> : null}
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="empty">没有其他关联记录。</p>
                )}
              </article>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
  };

  const handleSidebarSectionOpen = (nextSection: SectionKey) => {
    sectionRefreshHandlerRef.current = null;
    setConversationDialog(null);
    setConversationDialogOrigin(null);
    setConversationSectionOrigin(null);
    setSandboxModalOpen(false);
    setSandboxModalOrigin(null);
    setSandboxSectionOrigin(null);
    setSandboxDeepLinkId(null);
    setSidebarMobileOpen(false);
    setActiveSection(nextSection);
  };

  const handleSidebarToggle = () => {
    if (typeof window !== 'undefined' && window.innerWidth <= SIDEBAR_STACK_BREAKPOINT) {
      setSidebarMobileOpen((current) => !current);
      return;
    }

    setSidebarCollapsed((current) => {
      const next = !current;
      persistStoredSidebarCollapsed(next);
      return next;
    });
  };

  const renderContent = () => {
    if (loading) {
      if (activeSection === 'sandbox') {
        const completedCount = SANDBOX_LOAD_STEPS.filter((step) => sandboxLoadProgress.completed[step.key]).length;
        const firstPendingIndex = SANDBOX_LOAD_STEPS.findIndex((step) => !sandboxLoadProgress.completed[step.key]);
        const activeStep =
          SANDBOX_LOAD_STEPS[firstPendingIndex >= 0 ? firstPendingIndex : SANDBOX_LOAD_STEPS.length - 1];
        const elapsedSeconds = sandboxLoadProgress.startedAt
          ? Math.max(1, Math.floor((sandboxLoadProgressClock - sandboxLoadProgress.startedAt) / 1000))
          : 0;
        const progressPercent =
          completedCount === SANDBOX_LOAD_STEPS.length
            ? 100
            : Math.max(8, Math.round((completedCount / SANDBOX_LOAD_STEPS.length) * 100));

        return (
          <main className="content-stack sandbox-loading-page">
            <section className="fade-in">
              <article className="panel sandbox-loading-panel">
                <div className="sandbox-loading-head">
                  <div className="sandbox-loading-copy">
                    <p className="section-tag">Sandbox 管理</p>
                    <h2>正在同步 Sandbox 列表</h2>
                    <p className="panel-caption">{activeStep.detail}</p>
                  </div>
                  <div className="sandbox-loading-status" aria-live="polite">
                    <span className="sandbox-loading-status-dot" aria-hidden="true" />
                    <strong>{completedCount}/{SANDBOX_LOAD_STEPS.length}</strong>
                    <span>{elapsedSeconds > 0 ? `${elapsedSeconds}秒` : '准备中'}</span>
                  </div>
                </div>

                <div
                  className="sandbox-loading-progress-bar"
                  role="progressbar"
                  aria-label="Sandbox 数据加载进度"
                  aria-valuemin={0}
                  aria-valuemax={SANDBOX_LOAD_STEPS.length}
                  aria-valuenow={completedCount}
                >
                  <span className="sandbox-loading-progress-fill" style={{ width: `${progressPercent}%` }} />
                </div>

                <div className="sandbox-loading-step-strip" aria-live="polite">
                  {SANDBOX_LOAD_STEPS.map((step, index) => {
                    const isDone = sandboxLoadProgress.completed[step.key];
                    const isActive = !isDone && index === firstPendingIndex;
                    return (
                      <span
                        key={step.key}
                        className={`sandbox-loading-step${isDone ? ' is-done' : isActive ? ' is-active' : ''}`}
                      >
                        {step.label}
                      </span>
                    );
                  })}
                </div>

                <div className="sandbox-loading-preview" aria-hidden="true">
                  <div className="sandbox-loading-live-preview">
                    <span className="sandbox-loading-live-pill">
                      <span className="runtime-skeleton sandbox-loading-pill-skeleton" />
                    </span>
                    <span className="sandbox-loading-live-pill">
                      <span className="runtime-skeleton sandbox-loading-pill-skeleton" />
                    </span>
                    <span className="sandbox-loading-live-pill">
                      <span className="runtime-skeleton sandbox-loading-pill-skeleton" />
                    </span>
                    <span className="sandbox-loading-live-age">
                      <span className="runtime-skeleton sandbox-loading-age-skeleton" />
                    </span>
                    <span className="sandbox-loading-refresh">
                      <span className="runtime-skeleton sandbox-loading-refresh-skeleton" />
                    </span>
                  </div>

                  <div className="sandbox-loading-table-preview">
                    {Array.from({ length: 6 }, (_, index) => (
                      <div key={`sandbox-loading-row-${index}`} className="sandbox-loading-row-preview">
                        <span className="runtime-skeleton sandbox-loading-skeleton-id" />
                        <span className="runtime-skeleton sandbox-loading-skeleton-session" />
                        <span className="runtime-skeleton runtime-skeleton-chip" />
                        <span className="runtime-skeleton runtime-skeleton-chip" />
                        <span className="runtime-skeleton sandbox-loading-skeleton-time" />
                        <span className="runtime-skeleton runtime-skeleton-button" />
                      </div>
                    ))}
                  </div>
                </div>
              </article>
            </section>
          </main>
        );
      }
      return <main className="loading-state">正在加载 {breadcrumbTitle} ...</main>;
    }

    if (activeSection === 'kvm') return renderKvmSection();
    if (activeSection === 'deployment') {
      return (
        <DeploymentManagementSection
          onError={setError}
          onUpdatedAtChange={setDeploymentManagementUpdatedAt}
          onRegisterRefresh={registerSectionRefresh}
          persistedState={deploymentManagementViewState}
          onStateChange={setDeploymentManagementViewState}
          onOpenConversation={(sessionId, origin) => {
            openConversationDialog(sessionId, 'overview', origin || null);
          }}
          onOpenUser={(userId, origin) => {
            openUserManagementView(userId, origin || null);
          }}
          onOpenSandbox={(sandboxId, origin) => {
            void openSandboxDetail(sandboxId, origin || null);
          }}
        />
      );
    }
    if (activeSection === 'conversation') return renderConversationOpsSection();
    if (activeSection === 'user') {
      return (
        <UserManagementSection
          onError={setError}
          onUpdatedAtChange={setUserManagementUpdatedAt}
          onRegisterRefresh={registerSectionRefresh}
          persistedState={userManagementViewState}
          onStateChange={setUserManagementViewState}
          onOpenConversation={(sessionId, origin) => {
            openConversationDialog(sessionId, 'overview', origin || null);
          }}
          onOpenSandbox={(sandboxId, origin) => {
            void openSandboxDetail(sandboxId, origin || null);
          }}
          onOpenDeployment={(taskSessionId, origin) => {
            openDeploymentManagementView(taskSessionId, origin || null);
          }}
        />
      );
    }
    if (activeSection === 'agent') return renderAgentSection();
    if (activeSection === 'skill') {
      return (
        <SkillManagementSection
          onError={setError}
          onUpdatedAtChange={setSkillManagementUpdatedAt}
          onRegisterRefresh={registerSectionRefresh}
          persistedState={skillManagementViewState}
          onStateChange={setSkillManagementViewState}
        />
      );
    }
    if (activeSection === 'connectorGuide') {
      return (
        <ConnectorGuideManagementSection
          onError={setError}
          onUpdatedAtChange={setConnectorGuideUpdatedAt}
          onRegisterRefresh={registerSectionRefresh}
          persistedState={connectorGuideManagementViewState}
          onStateChange={setConnectorGuideManagementViewState}
        />
      );
    }
    if (activeSection === 'osacRelease') {
      return (
        <OsacReleaseManagementSection
          onError={setError}
          onUpdatedAtChange={setOsacReleaseUpdatedAt}
          onRegisterRefresh={registerSectionRefresh}
          persistedState={osacReleaseManagementViewState}
          onStateChange={setOsacReleaseManagementViewState}
        />
      );
    }
    if (activeSection === 'billing') {
      return (
        <Suspense fallback={<div className="p-6">加载中...</div>}>
          <BillingManagementSection
            onOpenUser={(userId) => {
              openUserManagementView(userId, { section: 'billing', trail: '计费管理' });
            }}
            onOpenConversation={(sessionId) => {
              openConversationDialog(sessionId, 'overview', { section: 'billing', trail: '计费管理' });
            }}
            onNotify={pushToast}
          />
        </Suspense>
      );
    }
    if (activeSection === 'sandbox') return renderSandboxSection();
    return renderAuditSection();
  };

  return (
    <div
      className={`page-shell${sidebarCollapsed ? ' sidebar-collapsed' : ''}${sidebarMobileOpen ? ' sidebar-mobile-open' : ''}`}
    >
      <div className="background-glow" aria-hidden="true" />
      <button
        type="button"
        className="sidebar-mobile-scrim"
        aria-label="关闭侧边栏"
        onClick={() => setSidebarMobileOpen(false)}
      />
      <div className="app-layout">
        <aside className="sidebar fade-in" onWheelCapture={handleSidebarWheel}>
          <div className="sidebar-brand">
            <div className="sidebar-brand-row">
              <div>
                <p className="eyebrow">ONECEO</p>
                <p className="sidebar-title">管理控制台</p>
              </div>
              <span className="env-badge">OPS</span>
            </div>
          </div>
          <nav className="sidebar-nav" aria-label="Primary" ref={sidebarNavRef}>
            {NAV_GROUPS.map((group) => (
              <section key={group.key} className="nav-group">
                <div className="nav-group-header">
                  <p className="nav-group-title">{group.label}</p>
                </div>
                <div className="nav-group-list">
                  {NAV_ITEMS.filter((item) => item.group === group.key).map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      className={`nav-item ${activeSection === item.key ? 'active' : ''}`}
                      onClick={() => handleSidebarSectionOpen(item.key)}
                      title={sidebarCollapsed ? item.label : undefined}
                    >
                      <span className="nav-item-tag">{item.tag}</span>
                      <span className="nav-item-body">
                        <span>{item.label}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </nav>
          <div className="sidebar-footer">
            <span className="sidebar-footer-avatar" aria-hidden="true">
              {adminInitials(adminUser?.displayName, adminUser?.loginName)}
            </span>
            <div className="sidebar-footer-body">
              <p className="sidebar-footer-title">{adminDisplayNameLabel(adminUser?.displayName, adminUser?.loginName)}</p>
              <span className="sidebar-footer-role">{adminRoleLabel(adminUser?.role)}</span>
            </div>
          </div>
        </aside>

        <section className={`main-area ${activeSection === 'conversation' ? 'conversation-main-area' : ''}${lockMainAreaScroll ? ' main-area-locked' : ''}`}>
          <header className="top-header fade-in">
            <div className="page-header-shell page-header-compact-bar">
              <div className="header-main page-header-mainline">
                <button
                  type="button"
                  className="icon-btn sidebar-toggle-btn"
                  aria-label="切换侧边栏"
                  onClick={handleSidebarToggle}
                >
                  <span aria-hidden="true">☰</span>
                </button>
                <span className="topbar-pill">{activeNavGroup.label}</span>
                <div className="page-header-copy">
                  <h1>{breadcrumbTitle}</h1>
                </div>
              </div>
              <div className="page-header-compact-meta">
                <span className="updated-at topbar-meta-pill topbar-meta-pill-time">最后更新: {formatDateTime(updatedAtLabel)}</span>
                <span className={`service-state topbar-meta-pill ${activeServiceOnline ? 'ok' : 'down'}`}>
                  {activeServiceOnline ? `${activeServiceLabel}在线` : `${activeServiceLabel}离线`}
                </span>
              </div>
              <div className="header-actions page-header-compact-actions">
                <div className="topbar-settings" ref={settingsMenuRef}>
                  <button
                    type="button"
                    className={`icon-btn topbar-settings-btn ${settingsMenuOpen ? 'active' : ''}`}
                    aria-label="界面设置"
                    aria-haspopup="dialog"
                    aria-expanded={settingsMenuOpen}
                    onClick={() => setSettingsMenuOpen((open) => !open)}
                  >
                    <svg className="topbar-settings-icon" viewBox="0 0 20 20" aria-hidden="true">
                      <path d="M8.861 2.1a1.25 1.25 0 0 1 2.278 0l.41 1.008c.158.388.504.664.92.735l1.081.181a1.25 1.25 0 0 1 .904 1.813l-.516.968a1.19 1.19 0 0 0 0 1.12l.516.968a1.25 1.25 0 0 1-.904 1.813l-1.08.18a1.2 1.2 0 0 0-.922.736l-.41 1.008a1.25 1.25 0 0 1-2.277 0l-.41-1.008a1.2 1.2 0 0 0-.921-.735l-1.081-.181a1.25 1.25 0 0 1-.904-1.813l.516-.968a1.19 1.19 0 0 0 0-1.12l-.516-.968a1.25 1.25 0 0 1 .904-1.813l1.08-.18a1.2 1.2 0 0 0 .922-.736z" />
                      <path d="M10 7.05A2.95 2.95 0 1 0 10 12.95A2.95 2.95 0 1 0 10 7.05Z" />
                    </svg>
                  </button>
                  {settingsMenuOpen ? (
                    <div className="topbar-settings-menu" role="dialog" aria-label="界面设置">
                      <div className="topbar-settings-head">
                        <div className="topbar-settings-copy">
                          <strong>界面设置</strong>
                          <span>
                            {selectedThemeOption?.label} · {selectedThemeMode?.label}
                            {currentThemeMode === 'system' ? `（当前${resolvedThemeTone === 'dark' ? '暗色' : '亮色'}）` : ''}
                          </span>
                        </div>
                        {themeSaving ? <span className="session-status">保存中</span> : null}
                      </div>

                      <div className="topbar-settings-section">
                        <div className="topbar-settings-section-head">
                          <span>主题</span>
                          <small>GitHub、Nord、Rose Pine、One Dark Light</small>
                        </div>
                        <div className="theme-family-grid">
                          {themeOptions.map((theme) => {
                            const swatches = resolvedThemeTone === 'dark' ? theme.darkSwatches : theme.lightSwatches;
                            return (
                              <button
                                key={theme.key}
                                type="button"
                                className={`theme-family-card ${theme.key === currentTheme ? 'active' : ''}`}
                                onClick={() => void saveThemePreferences(theme.key, currentThemeMode)}
                                disabled={themeSaving}
                              >
                                <div className="theme-family-card-copy">
                                  <strong>{theme.label}</strong>
                                  <span>{theme.description}</span>
                                </div>
                                <div className="theme-family-swatches" aria-hidden="true">
                                  {swatches.map((swatch) => (
                                    <i key={`${theme.key}-${swatch}`} style={{ backgroundColor: swatch }} />
                                  ))}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="topbar-settings-section">
                        <div className="topbar-settings-section-head">
                          <span>外观</span>
                          <small>亮色、暗色、跟随系统</small>
                        </div>
                        <div className="theme-mode-strip" role="group" aria-label="外观模式">
                          {themeModeOptions.map((mode) => (
                            <button
                              key={mode.key}
                              type="button"
                              className={`theme-mode-btn ${mode.key === currentThemeMode ? 'active' : ''}`}
                              onClick={() => void saveThemePreferences(currentTheme, mode.key)}
                              disabled={themeSaving}
                            >
                              <strong>{mode.label}</strong>
                              <span>{mode.description}</span>
                            </button>
                          ))}
                        </div>
                        <p className="topbar-settings-note">
                          当前使用 {selectedThemeOption?.label} · {resolvedThemeTone === 'dark' ? '暗色' : '亮色'}。
                        </p>
                      </div>
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="primary-btn topbar-btn topbar-refresh-btn"
                  aria-label={refreshing ? '刷新中' : '刷新当前页'}
                  onClick={() => void refreshActiveSection()}
                  disabled={refreshing}
                >
                  <span aria-hidden="true">↻</span>
                  <span className="topbar-btn-label">{refreshing ? '刷新中...' : '刷新当前页'}</span>
                </button>
                <button type="button" className="secondary-btn topbar-btn topbar-logout-btn" aria-label="退出" onClick={() => void handleAdminLogout()}>
                  <span aria-hidden="true">⎋</span>
                  <span className="topbar-btn-label">退出</span>
                </button>
              </div>
            </div>
          </header>

          {error ? (
            <section className="error-banner fade-in" role="alert">
              {error}
            </section>
          ) : null}

          <Suspense fallback={<main className="loading-state">正在加载 {breadcrumbTitle} ...</main>}>
            {renderContent()}
          </Suspense>
          {activeSection !== 'conversation' && conversationDialog ? (
            <div className="section-overlay-host section-overlay-host-conversation">
              {renderConversationOpsSection()}
            </div>
          ) : null}
          {activeSection !== 'sandbox' && sandboxModalOpen && sandboxRuntimeDetail ? (
            <div className="section-overlay-host section-overlay-host-sandbox">
              {renderSandboxSection()}
            </div>
          ) : null}
        </section>
      </div>
      {operationOverlay ? (
        <div className="global-operation-overlay" role="status" aria-live="polite">
          <div className="global-operation-card">
            <span className="global-operation-spinner" aria-hidden="true" />
            <strong>{operationOverlay.message}</strong>
            <span>请稍候，后台正在处理当前操作。</span>
          </div>
        </div>
      ) : null}
      {toasts.length ? (
        <div className="toast-stack" aria-live="polite" aria-atomic="true">
          {toasts.map((toast) => (
            <article key={toast.id} className={`toast-card ${toast.tone}`}>
              <div className="toast-copy">
                <strong>{toast.title}</strong>
                <span>{toast.message}</span>
              </div>
              <button type="button" className="toast-close-btn" onClick={() => dismissToast(toast.id)}>
                关闭
              </button>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}
