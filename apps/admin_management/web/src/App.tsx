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
  AdminThemeKey,
  AdminThemeSettings,
  AgentManagementOverview,
  AuditDetailResponse,
  AuditLogEntry,
  AuditResponse,
  ConversationMessage,
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
type ToastTone = 'error' | 'success' | 'warning' | 'info';
type SandboxDetailTab = 'overview' | 'files' | 'processes' | 'connectivity' | 'archive' | 'terminal';
type SandboxProcessToolView = 'processes' | 'ports';

type UiToast = {
  id: number;
  tone: ToastTone;
  title: string;
  message: string;
};

type AuditFilterState = {
  query: string;
  operator: string;
  action: string;
  result: string;
  sessionId: string;
  targetVmId: string;
  from: string;
  to: string;
};

type ConversationDialogTab = 'overview' | 'interaction' | 'infra' | 'raw' | 'transitions';

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
const DEFAULT_ADMIN_THEME: AdminThemeKey = 'everforest-light';
const FALLBACK_ADMIN_THEME_OPTIONS: AdminThemeSettings['themes'] = [
  { key: 'github-light', label: 'GitHub Light', family: 'GitHub', variant: 'Light', tone: 'light', description: '清爽浅色，适合白天处理表格和日志。', swatches: ['#f6f8fa', '#24292f', '#0969da'] },
  { key: 'github-dark', label: 'GitHub Dark', family: 'GitHub', variant: 'Dark', tone: 'dark', description: 'GitHub 暗色语义，适合夜间阅读。', swatches: ['#0d1117', '#e6edf3', '#2f81f7'] },
  { key: 'github-dimmed', label: 'GitHub Dimmed', family: 'GitHub', variant: 'Dimmed', tone: 'dark', description: '低对比暗色，减少长时间日志阅读疲劳。', swatches: ['#22272e', '#adbac7', '#539bf5'] },
  { key: 'dracula-classic', label: 'Dracula Classic', family: 'Dracula', variant: 'Classic', tone: 'dark', description: '高对比暗色，适合长时间排障。', swatches: ['#282a36', '#f8f8f2', '#bd93f9'] },
  { key: 'dracula-soft', label: 'Dracula Soft', family: 'Dracula', variant: 'Soft', tone: 'dark', description: '降低紫色饱和度，保留 Dracula 的辨识度。', swatches: ['#2b2d3a', '#f3eefc', '#a98df2'] },
  { key: 'everforest-light', label: 'Everforest Light', family: 'Everforest', variant: 'Light', tone: 'light', description: '柔和绿灰，适合默认运维控制台。', swatches: ['#f3f5f1', '#1f261f', '#16785f'] },
  { key: 'everforest-dark', label: 'Everforest Dark', family: 'Everforest', variant: 'Dark', tone: 'dark', description: '森林暗色，兼顾控制台状态色可读性。', swatches: ['#2b3339', '#d3c6aa', '#a7c080'] },
  { key: 'everforest-hard', label: 'Everforest Hard', family: 'Everforest', variant: 'Hard', tone: 'dark', description: '更深背景，适合大屏值守。', swatches: ['#1e2326', '#d3c6aa', '#83c092'] },
  { key: 'onedark-classic', label: 'One Dark Classic', family: 'One Dark', variant: 'Classic', tone: 'dark', description: '克制暗色，偏工程编辑器风格。', swatches: ['#282c34', '#abb2bf', '#61afef'] },
  { key: 'onedark-pro', label: 'One Dark Pro', family: 'One Dark', variant: 'Pro', tone: 'dark', description: '更强蓝绿强调，适合高频操作界面。', swatches: ['#1f2329', '#d7dae0', '#4fa6ed'] },
  { key: 'catppuccin-latte', label: 'Catppuccin Latte', family: 'Catppuccin', variant: 'Latte', tone: 'light', description: '柔和浅色，保留 Catppuccin 的粉彩强调。', swatches: ['#eff1f5', '#4c4f69', '#8839ef'] },
  { key: 'catppuccin-macchiato', label: 'Catppuccin Macchiato', family: 'Catppuccin', variant: 'Macchiato', tone: 'dark', description: '中等暗度，适合日夜混合使用。', swatches: ['#24273a', '#cad3f5', '#c6a0f6'] },
  { key: 'catppuccin-mocha', label: 'Catppuccin Mocha', family: 'Catppuccin', variant: 'Mocha', tone: 'dark', description: '温和暗色，低疲劳阅读。', swatches: ['#1e1e2e', '#cdd6f4', '#cba6f7'] },
  { key: 'tokyo-night-day', label: 'Tokyo Night Day', family: 'Tokyo Night', variant: 'Day', tone: 'light', description: 'Tokyo Night 的浅色变体，适合白天办公。', swatches: ['#e1e2e7', '#3760bf', '#2e7de9'] },
  { key: 'tokyo-night-storm', label: 'Tokyo Night Storm', family: 'Tokyo Night', variant: 'Storm', tone: 'dark', description: '灰蓝暗色，适合控制台密集信息。', swatches: ['#24283b', '#c0caf5', '#7aa2f7'] },
  { key: 'tokyo-night-night', label: 'Tokyo Night Night', family: 'Tokyo Night', variant: 'Night', tone: 'dark', description: '深夜蓝黑，突出状态色和代码块。', swatches: ['#1a1b26', '#c0caf5', '#7aa2f7'] },
  { key: 'nord-polar-night', label: 'Nord Polar Night', family: 'Nord', variant: 'Polar Night', tone: 'dark', description: '冷静蓝灰，适合低饱和监控界面。', swatches: ['#2e3440', '#d8dee9', '#88c0d0'] },
  { key: 'nord-frost', label: 'Nord Frost', family: 'Nord', variant: 'Frost', tone: 'light', description: 'Nord 的浅色霜感变体。', swatches: ['#eceff4', '#2e3440', '#5e81ac'] },
  { key: 'solarized-light', label: 'Solarized Light', family: 'Solarized', variant: 'Light', tone: 'light', description: '经典低对比浅色，适合长文档阅读。', swatches: ['#fdf6e3', '#586e75', '#268bd2'] },
  { key: 'solarized-dark', label: 'Solarized Dark', family: 'Solarized', variant: 'Dark', tone: 'dark', description: '经典低对比暗色，适合长时间终端风工作。', swatches: ['#002b36', '#93a1a1', '#268bd2'] },
  { key: 'gruvbox-light', label: 'Gruvbox Light', family: 'Gruvbox', variant: 'Light', tone: 'light', description: '复古暖色浅色，适合低刺激阅读。', swatches: ['#fbf1c7', '#3c3836', '#b57614'] },
  { key: 'gruvbox-dark', label: 'Gruvbox Dark', family: 'Gruvbox', variant: 'Dark', tone: 'dark', description: '复古暗色，高辨识度状态色。', swatches: ['#282828', '#ebdbb2', '#fabd2f'] },
  { key: 'gruvbox-material', label: 'Gruvbox Material', family: 'Gruvbox', variant: 'Material', tone: 'dark', description: '更柔和的 Gruvbox 暗色变体。', swatches: ['#1d2021', '#ddc7a1', '#a9b665'] },
  { key: 'monokai-classic', label: 'Monokai Classic', family: 'Monokai', variant: 'Classic', tone: 'dark', description: '经典高对比代码主题。', swatches: ['#272822', '#f8f8f2', '#a6e22e'] },
  { key: 'monokai-pro', label: 'Monokai Pro', family: 'Monokai', variant: 'Pro', tone: 'dark', description: '更现代的 Monokai 暗色控制台。', swatches: ['#2d2a2e', '#fcfcfa', '#ffd866'] },
  { key: 'material-ocean', label: 'Material Ocean', family: 'Material', variant: 'Ocean', tone: 'dark', description: 'Material 深海蓝，适合监控大屏。', swatches: ['#0f111a', '#b8c6db', '#82aaff'] },
  { key: 'material-palenight', label: 'Material Palenight', family: 'Material', variant: 'Palenight', tone: 'dark', description: '柔和蓝紫暗色，适合夜间后台。', swatches: ['#292d3e', '#a6accd', '#c792ea'] },
  { key: 'material-lighter', label: 'Material Lighter', family: 'Material', variant: 'Lighter', tone: 'light', description: 'Material 浅色，高可读表格体验。', swatches: ['#fafafa', '#546e7a', '#00bcd4'] },
  { key: 'ayu-light', label: 'Ayu Light', family: 'Ayu', variant: 'Light', tone: 'light', description: '干净浅色，突出金色操作焦点。', swatches: ['#fafafa', '#5c6773', '#ff9940'] },
  { key: 'ayu-mirage', label: 'Ayu Mirage', family: 'Ayu', variant: 'Mirage', tone: 'dark', description: '不太深的暗色，适合昼夜切换。', swatches: ['#1f2430', '#cbccc6', '#ffcc66'] },
  { key: 'ayu-dark', label: 'Ayu Dark', family: 'Ayu', variant: 'Dark', tone: 'dark', description: '深色 Ayu，适合专注编辑。', swatches: ['#0f1419', '#bfbdb6', '#ffb454'] },
  { key: 'rose-pine-dawn', label: 'Rose Pine Dawn', family: 'Rose Pine', variant: 'Dawn', tone: 'light', description: '柔和浅色，减少后台的冷硬感。', swatches: ['#faf4ed', '#575279', '#d7827e'] },
  { key: 'rose-pine-moon', label: 'Rose Pine Moon', family: 'Rose Pine', variant: 'Moon', tone: 'dark', description: '中深玫瑰暗色，适合信息面板。', swatches: ['#232136', '#e0def4', '#c4a7e7'] },
  { key: 'rose-pine-main', label: 'Rose Pine Main', family: 'Rose Pine', variant: 'Main', tone: 'dark', description: '经典 Rose Pine 暗色。', swatches: ['#191724', '#e0def4', '#ebbcba'] },
  { key: 'kanagawa-lotus', label: 'Kanagawa Lotus', family: 'Kanagawa', variant: 'Lotus', tone: 'light', description: '水墨浅色，适合白天管理任务。', swatches: ['#f2ecbc', '#545464', '#b35b79'] },
  { key: 'kanagawa-wave', label: 'Kanagawa Wave', family: 'Kanagawa', variant: 'Wave', tone: 'dark', description: '经典 Kanagawa 暗色。', swatches: ['#1f1f28', '#dcd7ba', '#7e9cd8'] },
  { key: 'kanagawa-dragon', label: 'Kanagawa Dragon', family: 'Kanagawa', variant: 'Dragon', tone: 'dark', description: '更深的水墨暗色，适合夜间值守。', swatches: ['#181616', '#c5c9c5', '#8ba4b0'] },
  { key: 'synthwave-84', label: 'SynthWave 84', family: 'SynthWave', variant: '84', tone: 'dark', description: '霓虹复古暗色，适合个性化后台。', swatches: ['#262335', '#f92aad', '#72f1b8'] },
  { key: 'synthwave-dim', label: 'SynthWave Dim', family: 'SynthWave', variant: 'Dim', tone: 'dark', description: '降低霓虹亮度，兼顾可读性。', swatches: ['#241b2f', '#f6d5ff', '#36f9f6'] },
  { key: 'night-owl', label: 'Night Owl', family: 'Night Owl', variant: 'Dark', tone: 'dark', description: '夜间编码经典主题，高可读蓝色调。', swatches: ['#011627', '#d6deeb', '#82aaff'] },
  { key: 'night-owl-light', label: 'Night Owl Light', family: 'Night Owl', variant: 'Light', tone: 'light', description: 'Night Owl 的浅色变体。', swatches: ['#fbfbfb', '#403f53', '#4876d6'] },
  { key: 'arc-light', label: 'Arc Light', family: 'Arc', variant: 'Light', tone: 'light', description: '现代 Linux 风浅色。', swatches: ['#f5f6f7', '#2f343f', '#5294e2'] },
  { key: 'arc-dark', label: 'Arc Dark', family: 'Arc', variant: 'Dark', tone: 'dark', description: '现代 Linux 风暗色。', swatches: ['#2f343f', '#d3dae3', '#5294e2'] },
];
const FALLBACK_ADMIN_THEME_KEYS = new Set(FALLBACK_ADMIN_THEME_OPTIONS.map((item) => item.key));
const ADMIN_THEME_ALIASES = new Map<string, AdminThemeKey>([
  ['github', 'github-light'],
  ['dracula', 'dracula-classic'],
  ['everforest', 'everforest-light'],
  ['onedark', 'onedark-classic'],
  ['catppuccin', 'catppuccin-mocha'],
  ['tokyo-night', 'tokyo-night-night'],
  ['nord', 'nord-polar-night'],
  ['solarized', 'solarized-light'],
  ['gruvbox', 'gruvbox-dark'],
  ['monokai', 'monokai-classic'],
  ['material', 'material-ocean'],
  ['ayu', 'ayu-mirage'],
  ['rose-pine', 'rose-pine-main'],
  ['kanagawa', 'kanagawa-wave'],
  ['synthwave', 'synthwave-84'],
  ['night-owl-dark', 'night-owl'],
  ['arc', 'arc-light'],
]);

function normalizeAdminThemeKey(value: unknown): AdminThemeKey {
  const key = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (ADMIN_THEME_ALIASES.has(key)) {
    return ADMIN_THEME_ALIASES.get(key) || DEFAULT_ADMIN_THEME;
  }
  return FALLBACK_ADMIN_THEME_KEYS.has(key) ? key : DEFAULT_ADMIN_THEME;
}

function getAdminThemeTone(themeKey: AdminThemeKey): 'light' | 'dark' {
  const normalizedTheme = normalizeAdminThemeKey(themeKey);
  return FALLBACK_ADMIN_THEME_OPTIONS.find((item) => item.key === normalizedTheme)?.tone || 'light';
}

function readStoredAdminTheme(): AdminThemeKey {
  if (typeof window === 'undefined') return DEFAULT_ADMIN_THEME;
  return normalizeAdminThemeKey(window.localStorage.getItem(ADMIN_THEME_STORAGE_KEY));
}

function persistStoredAdminTheme(themeKey: AdminThemeKey) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ADMIN_THEME_STORAGE_KEY, themeKey);
}

function applyAdminTheme(themeKey: AdminThemeKey) {
  if (typeof document === 'undefined') return;
  const normalizedTheme = normalizeAdminThemeKey(themeKey);
  const tone = getAdminThemeTone(normalizedTheme);
  document.documentElement.dataset.adminTheme = normalizedTheme;
  document.documentElement.dataset.adminTone = tone;
  document.documentElement.style.colorScheme = tone;
}

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
    key: 'sandbox',
    group: 'runtime',
    label: 'Sandbox 管理',
    subtitle: 'Sandbox 与 OSAC',
    tag: 'SBX',
    description: '查看 Sandbox、归档记录和连通性状态。',
    signal: 'Sandbox 状态',
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
  if (status === 'unknown') return '未知';
  return status;
}

function conversationStageLabel(stage?: string | null) {
  if (stage === 'collecting') return '信息收集';
  if (stage === 'clarifying') return '等待补充';
  if (stage === 'planning') return '方案规划';
  if (stage === 'executing') return '执行中';
  if (stage === 'completed') return '已完成';
  if (stage === 'failed') return '已失败';
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
  if (source === 'legacy_user_id') return '旧版用户标识';
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
  if (messageType === 'opencode_user_input') return '执行器转发输入';
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
};

type SandboxFileTreeRow = SandboxFileItem & {
  depth: number;
  expanded: boolean;
  loaded: boolean;
  childCount: number;
  isRoot: boolean;
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
  if (executor) parts.push(`执行器: ${executorLabel(executor)}`);
  if (stage) parts.push(`阶段: ${conversationStageLabel(stage)}`);
  if (tone) parts.push(`语气: ${conversationToneLabel(tone)}`);
  if (runId) parts.push(`Run: ${runId.slice(0, 8)}`);
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
    return '执行器链路异常，优先确认 sandbox 端口、订阅状态和 OpenCode 可达性。';
  }
  if (type === 'error') {
    return '当前轮次出现显式错误，需要结合 metadata 与时间线继续排障。';
  }
  if (type === 'clarification_request') {
    return '当前轮次在等待用户补充信息或确认下一步。';
  }
  if (type === 'executor_event' && eventType === 'tool_call_failed') {
    return `${toolName || '工具'} 执行失败，优先检查参数、workspace 与 runtime 状态。`;
  }
  if (type === 'executor_event' && eventType === 'tool_call_completed') {
    return `${toolName || '工具'} 已完成，可结合 outputPreview 判断是否产生有效结果。`;
  }
  if (type === 'status_update' && metadataString(metadata, 'stage') === 'failed') {
    return '会话进入 failed 阶段，本轮已终止。';
  }
  if (type === 'status_update' && eventType === 'deliverables_ready') {
    return '交付已生成，建议核对文件与最终回复是否一致。';
  }
  if (type === 'status_update' && eventType === 'run_completed') {
    return '本轮 managed run 已结束。';
  }
  if (type === 'opencode_event') {
    return '执行器原始事件，通常用于补充上下文，不代表用户可见主回复。';
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
      tone: errorText ? 'error' : statusLabel === '已完成' ? 'success' : 'default',
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
  sessionId: '',
  targetVmId: '',
  from: '',
  to: '',
};

export default function App() {
  const [authStatus, setAuthStatus] = useState<'loading' | 'authenticated' | 'anonymous'>('loading');
  const [adminUser, setAdminUser] = useState<AdminUser | null>(null);
  const [loginName, setLoginName] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<SectionKey>('sandbox');
  const [themeSettings, setThemeSettings] = useState<AdminThemeSettings | null>(null);
  const [currentTheme, setCurrentTheme] = useState<AdminThemeKey>(() => readStoredAdminTheme());
  const [themeSaving, setThemeSaving] = useState(false);

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
  const [conversationStageFilter, setConversationStageFilter] = useState('all');
  const [conversationUpdatedFromDate, setConversationUpdatedFromDate] = useState('');
  const [conversationUpdatedToDate, setConversationUpdatedToDate] = useState('');
  const [conversationAutoRefreshEnabled, setConversationAutoRefreshEnabled] = useState(true);
  const [conversationDialog, setConversationDialog] = useState<{ sessionId: string } | null>(null);
  const [showOpencodePayload, setShowOpencodePayload] = useState(false);
  const [conversationGovernanceFilter, setConversationGovernanceFilter] = useState<string | null>(null);
  const [conversationEnvironmentGroupFilter, setConversationEnvironmentGroupFilter] = useState<string | null>(null);
  const [conversationDialogTab, setConversationDialogTab] = useState<ConversationDialogTab>('overview');
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
  const [sandboxDetailTab, setSandboxDetailTab] = useState<SandboxDetailTab>('overview');
  const [sandboxProcessToolView, setSandboxProcessToolView] = useState<SandboxProcessToolView>('processes');
  const [sandboxFullInfo, setSandboxFullInfo] = useState<E2bSandboxFullInfo | null>(null);
  const [pendingSandboxJumpId, setPendingSandboxJumpId] = useState<string | null>(null);
  const [sandboxConnectivityResult, setSandboxConnectivityResult] = useState<unknown>(null);
  const [sandboxCommandInput, setSandboxCommandInput] = useState('pwd && ls -la');
  const [sandboxTerminalOutput, setSandboxTerminalOutput] = useState('');
  const [sandboxDirectoryPath, setSandboxDirectoryPath] = useState('/');
  const [sandboxFileTreeRootPath, setSandboxFileTreeRootPath] = useState('/');
  const [sandboxFileTreeItemsByPath, setSandboxFileTreeItemsByPath] = useState<Record<string, SandboxFileItem[]>>({});
  const [sandboxFileExpandedPaths, setSandboxFileExpandedPaths] = useState<string[]>([]);
  const [sandboxFilePath, setSandboxFilePath] = useState('');
  const [sandboxFileItems, setSandboxFileItems] = useState<SandboxFileItem[]>([]);
  const [sandboxFileStatus, setSandboxFileStatus] = useState('等待加载目录');
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
  const [auditFilters, setAuditFilters] = useState<AuditFilterState>(DEFAULT_AUDIT_FILTERS);
  const [auditAppliedFilters, setAuditAppliedFilters] = useState<AuditFilterState>(DEFAULT_AUDIT_FILTERS);
  const [auditDetail, setAuditDetail] = useState<AuditDetailResponse | null>(null);
  const [selectedAgentStageKey, setSelectedAgentStageKey] = useState<string | null>(null);
  const [toasts, setToasts] = useState<UiToast[]>([]);
  const [operationOverlay, setOperationOverlay] = useState<{ message: string } | null>(null);

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
  const auditAppliedFiltersRef = useRef(DEFAULT_AUDIT_FILTERS);
  const toastIdRef = useRef(1);
  const lastErrorToastRef = useRef<string | null>(null);
  const sidebarNavRef = useRef<HTMLElement | null>(null);

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

  const handleThemeChange = useCallback(
    async (event: React.ChangeEvent<HTMLSelectElement>) => {
      const nextTheme = normalizeAdminThemeKey(event.target.value);
      const previousTheme = currentTheme;
      setCurrentTheme(nextTheme);
      persistStoredAdminTheme(nextTheme);
      setThemeSaving(true);

      try {
        const settings = await api.updateAdminTheme(nextTheme);
        setThemeSettings(settings);
        setCurrentTheme(settings.currentTheme);
        persistStoredAdminTheme(settings.currentTheme);
        const themeLabel =
          settings.themes.find((item) => item.key === settings.currentTheme)?.label || settings.currentTheme;
        pushToast('success', '主题已保存', `${themeLabel} 已写入 ${settings.envKey}`);
      } catch (themeError) {
        setCurrentTheme(previousTheme);
        persistStoredAdminTheme(previousTheme);
        setError(themeError instanceof Error ? themeError.message : '主题保存失败');
      } finally {
        setThemeSaving(false);
      }
    },
    [currentTheme, pushToast]
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

  const selectConversationSession = useCallback((sessionId: string) => {
    if (selectedSessionId === sessionId) {
      return;
    }
    setSelectedSessionId(sessionId);
    setConversationDetailLoading(true);
  }, [selectedSessionId]);

  const openConversationDialog = useCallback(
    (sessionId: string, initialTab: ConversationDialogTab = 'overview') => {
      selectConversationSession(sessionId);
      setConversationDialog({ sessionId });
      setConversationDialogTab(initialTab);
    },
    [selectConversationSession]
  );

  const closeConversationDialog = useCallback(() => {
    setConversationDialog(null);
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
    try {
      await runBlockingTask(
        '正在加载模板详情',
        async () => {
          const result = await api.getTemplate(templateId);
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

  const openSandboxDetail = useCallback(
    async (sandboxId: string) => {
      try {
        await runBlockingTask(
          '正在加载 Sandbox 详情',
          async () => {
            const detail = await loadSandboxRuntimeDetail(sandboxId);
            setSandboxDetailTab('overview');
            setSandboxProcessToolView('processes');
            setSandboxConnectivityResult(null);
            setSandboxTerminalOutput('');
            setSandboxDirectoryPath(detail.connectivity.workspaceRoot?.trim() || '/');
            setSandboxFileTreeRootPath(detail.connectivity.workspaceRoot?.trim() || '/');
            setSandboxFileTreeItemsByPath({});
            setSandboxFileExpandedPaths([detail.connectivity.workspaceRoot?.trim() || '/']);
            setSandboxFilePath('');
            setSandboxFileItems([]);
            setSandboxFileStatus(`目录根已重置为 ${detail.connectivity.workspaceRoot?.trim() || '/'}`);
            setSandboxProcessResult(null);
            setSandboxPortResult(null);
            setSandboxModalOpen(true);
          },
          { fallbackError: '加载 Sandbox 详情失败' }
        );
      } catch (detailError) {
        setError(detailError instanceof Error ? detailError.message : '加载 Sandbox 详情失败');
      }
    },
    [loadSandboxRuntimeDetail, runBlockingTask]
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
    if (item.kind === 'dir') {
      setSandboxFilePath('');
      setSandboxFileExpandedPaths((prev) => {
        const next = new Set(prev.map(normalizeSandboxPath));
        addPathAndAncestors(next, item.path, sandboxFileTreeRootPath);
        return Array.from(next);
      });
      await listSandboxFiles(item.path);
      return;
    }

    setSandboxFilePath(item.path);
    setSandboxFileStatus(`已选择文件 ${item.path}`);
  }, [listSandboxFiles, sandboxFileTreeRootPath]);

  const toggleSandboxFileTreeDirectory = useCallback(async (item: SandboxFileTreeRow) => {
    if (item.kind !== 'dir') {
      setSandboxFilePath(item.path);
      setSandboxFileStatus(`已选择文件 ${item.path}`);
      return;
    }

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

  const inspectSandboxPorts = useCallback(async () => {
    const sandboxId = sandboxRuntimeDetail?.runtime.sandboxId || sandboxDetail?.sandboxId;
    if (!sandboxId) return;
    try {
      setError(null);
      const result = await api.runSandboxToolAction(sandboxId, 'system.ports.inspect');
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
      setSandboxPortResult({
        stdout: `端口 ${port} 对外地址：https://${String(result)}`,
      });
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
        const reason = action === 'delete' || action === 'rebuild' ? window.prompt('请输入操作备注（必填）') : 'ok';
        if ((action === 'delete' || action === 'rebuild') && !reason) return;
        await runBlockingTask(
          `正在${actionLabelMap[action]}`,
          async () => {
            if (action === 'create') {
              await api.createTemplate(payload);
            } else if (action === 'update' && templateDetail) {
              await api.updateTemplate(templateIdOf(templateDetail), payload);
            } else if (action === 'rebuild' && templateDetail) {
              await api.rebuildTemplate(templateIdOf(templateDetail), payload);
            } else if (action === 'delete' && templateDetail) {
              await api.deleteTemplate(templateIdOf(templateDetail));
              setTemplateModalOpen(false);
            } else if (action === 'tags-assign') {
              await api.assignTemplateTags(payload);
            } else if (action === 'tags-delete') {
              await api.deleteTemplateTags(payload);
            }
            await loadTemplates();
            if (templateDetail && action !== 'delete') {
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

  const loadAuditSection = useCallback(
    async (filters: AuditFilterState = auditAppliedFiltersRef.current) => {
      const result = await api.listAudit({
        query: filters.query.trim() || undefined,
        operator: filters.operator !== 'all' ? filters.operator : undefined,
        action: filters.action !== 'all' ? filters.action : undefined,
        result: filters.result !== 'all' ? filters.result : undefined,
        sessionId: filters.sessionId.trim() || undefined,
        targetVmId: filters.targetVmId.trim() || undefined,
        from: filters.from ? new Date(filters.from).toISOString() : undefined,
        to: filters.to ? new Date(filters.to).toISOString() : undefined,
        limit: 80,
        offset: 0,
      });
      setAuditEntries(result.entries);
      setAuditResponseMeta(result);
      auditAppliedFiltersRef.current = filters;
      setAuditAppliedFilters(filters);
    },
    []
  );

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
    applyAdminTheme(currentTheme);
  }, [currentTheme]);

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
        persistStoredAdminTheme(settings.currentTheme);
      })
      .catch((themeError) => {
        if (stopped) return;
        setError(themeError instanceof Error ? themeError.message : '主题设置加载失败');
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
    auditAppliedFiltersRef.current = auditAppliedFilters;
  }, [auditAppliedFilters]);

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
    if (activeSection === 'conversation') {
      return;
    }
    setConversationDialog(null);
  }, [activeSection]);

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
    { label: '已完成', value: 'completed', count: conversationSummary.completed, meta: '已完成的会话' },
  ] as const;
  const conversationIndexSummaryCards = [
    { label: '全部', value: conversationSummary.total, meta: '当前加载会话', tone: 'neutral' },
    { label: '进行中', value: conversationSummary.inProgress, meta: '执行中或处理中', tone: 'active' },
    { label: '待确认', value: conversationSummary.waitingUser, meta: '等待用户补充', tone: 'warning' },
    { label: '失败', value: conversationSummary.failed, meta: '需要人工介入', tone: 'danger' },
    { label: '最近活跃', value: formatDateTime(conversationSummary.latestUpdatedAt), meta: '按更新时间排序', tone: 'time' },
  ] as const;
  const conversationStageOptions = uniqueSorted(conversationSessions.map((session) => session.stage));
  const conversationScopeFilterValue =
    conversationStatusFilter !== 'all'
      ? `status:${conversationStatusFilter}`
      : conversationStageFilter !== 'all'
        ? `stage:${conversationStageFilter}`
        : 'all';
  const filteredConversationSessions = (() => {
    const query = conversationSearchQuery.trim().toLowerCase();
    const fromTime = conversationUpdatedFromDate ? new Date(`${conversationUpdatedFromDate}T00:00:00`).getTime() : null;
    const toTime = conversationUpdatedToDate ? new Date(`${conversationUpdatedToDate}T23:59:59.999`).getTime() : null;
    return conversationSessions.filter((session) => {
      if (conversationStatusFilter !== 'all' && session.status !== conversationStatusFilter) {
        return false;
      }
      if (conversationStageFilter !== 'all' && (session.stage || '') !== conversationStageFilter) {
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
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
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
  const osacMessages = conversationDetail?.trace?.osac?.messages || [];
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
  const conversationReplayItems = buildConversationReplayItems(conversationMessages);
  const conversationDialogDetail =
    conversationDialog && conversationDetail?.session.id === conversationDialog.sessionId
      ? conversationDetail
      : null;
  const conversationDialogLoading = Boolean(conversationDialog) && !conversationDialogDetail;

  const renderConversationTransitionsPanel = () => (
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

      <div className="kpi-grid conversation-kpi-grid">
        <article className="kpi-card">
          <p className="kpi-title">筛选后流转</p>
          <p className="kpi-value">{transitionStats.filtered}</p>
          <p className="kpi-meta">总计 {transitionStats.total} 条</p>
        </article>
        <article className="kpi-card">
          <p className="kpi-title">命中阶段</p>
          <p className="kpi-value">{transitionStats.stages.length}</p>
          <p className="kpi-meta">{transitionStats.stages.slice(0, 3).map((value) => conversationStageLabel(value)).join(' / ') || '无'}</p>
        </article>
        <article className="kpi-card">
          <p className="kpi-title">命中状态</p>
          <p className="kpi-value">{transitionStats.statuses.length}</p>
          <p className="kpi-meta">{transitionStats.statuses.slice(0, 3).map((value) => statusLabel(value)).join(' / ') || '无'}</p>
        </article>
        <article className="kpi-card">
          <p className="kpi-title">命中阶段相位</p>
          <p className="kpi-value">{transitionStats.phases.length}</p>
          <p className="kpi-meta">{transitionStats.phases.slice(0, 3).map((value) => conversationPhaseLabel(value)).join(' / ') || '无'}</p>
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
                trigger.messageType ? `消息=${conversationMessageTypeLabel(trigger.messageType)}` : '',
                trigger.role ? `角色=${conversationRoleLabel(trigger.role)}` : '',
                trigger.agent ? `智能体=${conversationAgentLabel(trigger.agent)}` : '',
                trigger.tone ? `语气=${conversationToneLabel(trigger.tone)}` : '',
                trigger.messageId ? `id=${trigger.messageId}` : '',
              ].filter(Boolean).join(' / ');
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
                        <span className={traceLevelClass('info')}>state</span>
                        <strong className="state-timeline-title">{`${fromStage} → ${toStage}`}</strong>
                      </div>
                      <div className="state-timeline-time">
                        <span>{formatDateTime(transition.at)}</span>
                        <span className="state-gap">间隔 {gap}</span>
                      </div>
                    </div>
                    <div className="state-timeline-meta">
                      <span>
                        <small>From</small>
                        <strong className="mono">{formatStateSnapshot(transition.from)}</strong>
                      </span>
                      <span>
                        <small>To</small>
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
                      {trigger.content ? <p className="state-trigger-line">内容: {summarizeText(trigger.content, 240)}</p> : null}
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
            const triggerSummary = [
              trigger.messageType ? `消息=${conversationMessageTypeLabel(trigger.messageType)}` : '',
              trigger.role ? `角色=${conversationRoleLabel(trigger.role)}` : '',
              trigger.agent ? `智能体=${conversationAgentLabel(trigger.agent)}` : '',
              trigger.tone ? `语气=${conversationToneLabel(trigger.tone)}` : '',
              trigger.messageId ? `id=${trigger.messageId}` : '',
            ].filter(Boolean).join(' / ');
            return (
              <article key={`${transition.at || 'transition'}-${index}`} className="trace-item">
                <p className="trace-head">
                  <span className={traceLevelClass('info')}>state</span>
                  <strong>{`${conversationStageLabel(transition.from?.stage)} → ${conversationStageLabel(transition.to?.stage)}`}</strong>
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
  );

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
    <div className="sub-panel conversation-detailed-logs-panel">
      {renderJsonWithLineNumbers(conversationDetailedLogs)}
    </div>
  );

  const renderConversationInfraPanel = () => {
    if (!conversationDetail) {
      return <p className="empty">选择会话后，可在此查看运行绑定、Sandbox 分组与 OSAC 诊断信息。</p>;
    }

    return (
      <div className="conversation-inspector-content conversation-dialog-infra">
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
              <strong>{conversationStageLabel(conversationDetail.session.stage)}</strong>
            </div>
            <div>
              <span>来源用户</span>
              <strong>{conversationUserLabel(conversationDetail.session.user)}</strong>
            </div>
            <div>
              <span>来源 IP</span>
              <strong className="mono">{conversationDetail.session.user?.ipAddress || '-'}</strong>
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
            <h3>Sandbox 绑定信息</h3>
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
                          {sandboxRuntimeStateLabel(group.status)} · {executorLabel(group.executor)}
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
                                <strong>{sandboxRuntimeStateLabel(environment.status)}</strong>
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
    );
  };

  const renderConversationContentOverview = () => {
    const sourceUser = conversationDetail?.session.user || null;
    return (
      <div className="conversation-dialog-overview">
        <div className="detail-grid detail-grid-wide summary-grid conversation-summary-grid">
          <div>
            <p className="kpi-title">会话 ID</p>
            <p className="mono">{conversationDetail?.session.id}</p>
          </div>
          <div>
            <p className="kpi-title">状态</p>
            <p>{conversationDetail ? statusLabel(conversationDetail.session.status) : '-'}</p>
          </div>
          <div>
            <p className="kpi-title">阶段</p>
            <p>{conversationDetail ? conversationStageLabel(conversationDetail.session.stage) : '-'}</p>
          </div>
          <div>
            <p className="kpi-title">OpenCode ID</p>
            <p className="mono">{conversationDetail?.runtime?.opencodeSessionId || '-'}</p>
          </div>
          <div>
            <p className="kpi-title">绑定更新时间</p>
            <p>{formatDateTime(conversationDetail?.runtime?.bindingUpdatedAt)}</p>
          </div>
        </div>

        <section className="sub-panel conversation-user-panel">
          <div className="panel-header">
            <div>
              <h3>来源用户</h3>
              <p className="panel-caption">对话归属、最近访问来源与会话身份线索。</p>
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

        <div className="conversation-message-summary-stats">
          <span className="session-status">状态流转 {conversationTabCounts.transitions}</span>
          <span className="session-status">对话消息 {conversationTabCounts.messages}</span>
          <span className="session-status">详细日志 {conversationDetailedLogs.counts.total}</span>
        </div>

        <section className="sub-panel conversation-message-summary">
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
          {conversationMessageSummary.latestClarificationSummary || conversationDetail?.runtime?.pendingQuestion ? (
            <div className="conversation-message-inline-card">
              <p className="kpi-title">当前待确认问题</p>
              <p className="message-content">
                {conversationDetail?.runtime?.pendingQuestion || conversationMessageSummary.latestClarificationSummary}
              </p>
            </div>
          ) : null}
        </section>
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
  const selectedThemeOption = themeOptions.find((item) => item.key === currentTheme) || themeOptions[0];
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
  const currentTemplateId = templateIdOf(templateDetail);
  const currentTemplateAlias = templateAliasOf(templateDetail);
  const templateAliasCheck = parseAliasCheckResult(templateAliasResult);

  const refreshActiveSection = useCallback(async () => {
    try {
      await runBlockingTask(`正在刷新${breadcrumbTitle}`, async () => {
        await loadSection(activeSection);
      });
    } catch {
      // error is routed to banner and toast
    }
  }, [activeSection, breadcrumbTitle, loadSection, runBlockingTask]);

  const applyAuditFilters = useCallback(async () => {
    try {
      await runBlockingTask('正在筛选审计日志', async () => {
        await loadAuditSection(auditFilters);
      });
    } catch {
      // error is routed to banner and toast
    }
  }, [auditFilters, loadAuditSection, runBlockingTask]);

  const resetAuditFilters = useCallback(async () => {
    setAuditFilters(DEFAULT_AUDIT_FILTERS);
    try {
      await runBlockingTask('正在重置审计筛选', async () => {
        await loadAuditSection(DEFAULT_AUDIT_FILTERS);
      });
    } catch {
      // error is routed to banner and toast
    }
  }, [loadAuditSection, runBlockingTask]);

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
                    const transitionNumber = String(index + 1).padStart(2, '0');
                    const fromStage = transition.from?.stage || '-';
                    const toStage = transition.to?.stage || '-';
                    const toStatus = transition.to?.status || '-';
                    const toPhase = transition.to?.phase || '-';
                    return (
                      <article key={`${transition.at || 'transition'}-${index}`} className="state-timeline-item">
                        <div className="state-timeline-rail" aria-hidden="true">
                          <span className="state-timeline-step mono">{transitionNumber}</span>
                        </div>
                        <div className="state-timeline-card">
                          <div className="state-timeline-head">
                            <div className="state-timeline-title-block">
                              <span className={traceLevelClass('info')}>state</span>
                              <strong className="state-timeline-title">{`${fromStage} → ${toStage}`}</strong>
                            </div>
                            <div className="state-timeline-time">
                              <span>{formatDateTime(transition.at)}</span>
                              <span className="state-gap">间隔 {gap}</span>
                            </div>
                          </div>
                          <div className="state-timeline-meta">
                            <span>
                              <small>From</small>
                              <strong className="mono">{formatStateSnapshot(transition.from)}</strong>
                            </span>
                            <span>
                              <small>To</small>
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
    return (
      <>
      <main className="content-stack conversation-content-stack">
        <section className="conversation-ops-layout fade-in">
          <article className="panel conversation-index-panel">
            <div className="panel-header panel-header-stack">
              <div>
                <p className="section-tag">会话索引</p>
                <h2>会话索引</h2>
                <p className="panel-caption">主工作区使用高密度明细列表承载索引；会话详情、关联信息与排障视图直接从列表行进入。</p>
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
            <div className="conversation-index-summary-strip" aria-label="会话索引摘要">
              {conversationIndexSummaryCards.map((item) => (
                <article key={item.label} className={`conversation-index-summary-card conversation-index-summary-card-${item.tone}`}>
                  <span className="conversation-index-summary-label">{item.label}</span>
                  <strong>{item.value}</strong>
                  <span>{item.meta}</span>
                </article>
              ))}
            </div>
            <div className="conversation-index-toolbar">
              <div className="runtime-filter-grid conversation-index-filter-grid">
                <label className="state-filter-field">
                  <span>搜索会话</span>
                  <input
                    type="search"
                    placeholder="sessionId / 标题 / 阶段 / 待确认问题"
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
                    setConversationUpdatedFromDate('');
                    setConversationUpdatedToDate('');
                  }}
                >
                  重置筛选
                </button>
              </div>
              <p className="panel-caption">
                按更新时间排序 · 当前筛选命中 {filteredConversationSessions.length} / {conversationSessions.length} · 进行中 {conversationSummary.inProgress} · 待确认 {conversationSummary.waitingUser} · 失败 {conversationSummary.failed}
              </p>
            </div>
            <div className="table-wrap conversation-index-table-wrap">
              <table className="conversation-index-table">
                <colgroup>
                  <col style={{ width: '51%' }} />
                  <col style={{ width: '22%' }} />
                  <col style={{ width: '16%' }} />
                  <col style={{ width: '11%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>会话</th>
                    <th>状态</th>
                    <th>时间</th>
                    <th className="runtime-col-actions">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {conversationSessions.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="empty">暂无对话会话。</td>
                    </tr>
                  ) : filteredConversationSessions.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="empty">当前筛选条件下无会话。</td>
                    </tr>
                  ) : (
                    filteredConversationSessions.map((session) => {
                      const isSelected = selectedSessionId === session.id;
                      const stageLabel = conversationStageLabel(session.stage);
                      const statusText = statusLabel(session.status);
                      const stageDisplay = stageLabel !== '-' && stageLabel !== statusText ? stageLabel : null;
                      const pendingSummary = session.pendingQuestion
                        ? summarizeText(session.pendingQuestion, 120)
                        : session.status === 'waiting_user'
                          ? '等待用户补充信息'
                          : session.status === 'failed'
                            ? '存在阻塞错误，请查看详情'
                            : session.status === 'completed'
                              ? '对话已完成'
                              : '暂无待确认问题';
                      const progressMeta = session.pendingOptions?.length
                        ? `${session.pendingOptions.length} 个待确认选项`
                        : session.status === 'in_progress'
                          ? '会话正在推进'
                          : session.status === 'waiting_user'
                            ? '等待用户确认'
                            : session.status === 'failed'
                              ? '需人工介入'
                              : '流程已结束';
                      const sourceUserLabel = conversationUserLabel(session.user);
                      const sourceUserMeta = conversationUserMeta(session.user);
                      return (
                        <tr
                          key={session.id}
                          className={`${isSelected ? 'selected-row' : ''} conversation-index-row`}
                          onClick={() => selectConversationSession(session.id)}
                          aria-selected={isSelected}
                        >
                          <td>
                            <div className="runtime-primary-cell conversation-index-primary-cell">
                              <p className="conversation-index-title" title={session.title || session.id}>{session.title || session.id}</p>
                              <p className="conversation-index-summary">{pendingSummary}</p>
                              <p className="conversation-index-user" title={sourceUserMeta}>
                                <span>{sourceUserLabel}</span>
                                <small>{sourceUserMeta}</small>
                              </p>
                              <div className="runtime-id-row conversation-index-id-row">
                                <span className="mono mono-truncate" title={session.id}>{truncateMiddle(session.id, 10, 8)}</span>
                                <button
                                  type="button"
                                  className="copy-btn"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void copyRuntimeField('会话 ID', session.id);
                                  }}
                                >
                                  复制
                                </button>
                              </div>
                            </div>
                          </td>
                          <td>
                            <div className="conversation-index-status-stack">
                              <div className="action-inline conversation-index-status-row">
                                <span className={stateClassName(session.status)}>{statusText}</span>
                                {stageDisplay ? <span className="session-status">{stageDisplay}</span> : null}
                              </div>
                              <p className="session-meta">{progressMeta}</p>
                            </div>
                          </td>
                          <td>
                            <div className="conversation-index-time-cell">{formatDateTime(session.updatedAt)}</div>
                            <p className="session-meta">创建于 {formatDateTime(session.createdAt)}</p>
                          </td>
                          <td className="runtime-col-actions">
                            <div className="action-inline runtime-actions conversation-index-actions" onClick={(event) => event.stopPropagation()}>
                              <button
                                type="button"
                                className={`secondary-btn conversation-index-detail-btn ${isSelected ? 'active' : ''}`}
                                onClick={() => openConversationDialog(session.id, 'overview')}
                              >
                                查看详情
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
          </article>
        </section>
      </main>
      {conversationDialog ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={closeConversationDialog}>
          <div
            className="modal-card conversation-dialog-modal"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <div className="modal-header">
              <div>
                <p className="section-tag">Dialogue</p>
                <h2>{conversationDialogDetail?.session.title || conversationDialogDetail?.session.id || '正在加载会话...'}</h2>
                <p className="panel-copy">
                  统一会话详情工作台：在同一 popup 中查看概览、交互回放、关联信息、详细日志与状态流转。
                </p>
              </div>
              <div className="conversation-dialog-actions">
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
                    { key: 'overview', label: '概览' },
                    { key: 'interaction', label: '交互回放' },
                    { key: 'infra', label: '关联信息' },
                    { key: 'raw', label: `详细日志 (${conversationDetailedLogs.counts.total})` },
                    { key: 'transitions', label: `状态流转 (${conversationTabCounts.transitions})` },
                  ].map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      className={`inspector-tab-card ${conversationDialogTab === item.key ? 'active' : ''}`}
                      onClick={() => setConversationDialogTab(item.key as ConversationDialogTab)}
                    >
                      <span className="inspector-tab-card-label">{item.label}</span>
                    </button>
                  ))}
                </div>
                <div className="modal-body conversation-dialog-body">
                  {conversationDialogTab === 'overview' ? renderConversationContentOverview() : null}
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

  const renderAgentSection = () => (
    <main className="content-stack agent-command-center">
      <section className="page-intro-grid fade-in agent-hero-grid">
        <article className="panel hero-panel agent-hero-panel">
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

        <article className="panel aside-panel agent-session-summary-panel">
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
              <strong>{agentApiMessageLabel(agentOverview?.agentApi.message)}</strong>
            </div>
          </div>
        </article>
      </section>

      <section className="kpi-grid fade-in agent-health-grid">
        <article className="kpi-card agent-health-card">
          <p className="kpi-title">平台接口</p>
          <p className="kpi-value">{agentOverview?.oneceoApi.online ? '在线' : '离线'}</p>
          <p className="kpi-meta">{formatDateTime(agentOverview?.oneceoApi.timestamp)}</p>
        </article>
        <article className="kpi-card agent-health-card">
          <p className="kpi-title">智能体服务</p>
          <p className="kpi-value">{agentOverview?.agentApi.online ? '在线' : '离线'}</p>
          <p className="kpi-meta">{agentApiMessageLabel(agentOverview?.agentApi.message)}</p>
        </article>
        <article className="kpi-card agent-health-card">
          <p className="kpi-title">会话总数</p>
          <p className="kpi-value">{agentOverview?.taskCreationSessions.total ?? 0}</p>
          <p className="kpi-meta">当前会话记录</p>
        </article>
        <article className="kpi-card agent-health-card">
          <p className="kpi-title">待确认会话</p>
          <p className="kpi-value">{agentOverview?.taskCreationSessions.waitingUser ?? 0}</p>
          <p className="kpi-meta">状态为待用户确认</p>
        </article>
      </section>

      <section className="chart-grid fade-in agent-intelligence-grid">
        <article className="panel agent-stage-chart-panel">
          <div className="panel-header">
            <h2>任务阶段概览</h2>
            <span className="panel-caption">按任务创建阶段统计，标签已转成中文</span>
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

        <article className="panel agent-capability-panel">
          <div className="panel-header">
            <h2>智能体能力卡</h2>
            <span className="panel-caption">可用性与接入方式</span>
          </div>
          <div className="capability-grid">
            {(agentOverview?.capabilities || []).map((item) => (
              <article key={item.key} className="capability-card">
                <p className="capability-name">{capabilityNameLabel(item.name)}</p>
                <p className="capability-meta">{item.transport}</p>
                <p className="mono">{item.endpoint}</p>
                <span className={`capability-status ${item.status}`}>{capabilityStatusLabel(item.status)}</span>
              </article>
            ))}
          </div>
        </article>
      </section>

      <section className="panel fade-in agent-stage-workbench">
        <div className="panel-header">
          <h2>阶段详情</h2>
          <span className="panel-caption">按阶段查看状态构成与最近会话</span>
        </div>
        <div className="agent-stage-grid">
          <div className="agent-stage-nav">
            {(agentOverview?.stageDistribution || []).map((item) => (
              <button
                key={item.stageKey}
                type="button"
                className={`agent-stage-nav-card ${selectedAgentStage?.stageKey === item.stageKey ? 'active' : ''}`}
                onClick={() => setSelectedAgentStageKey(item.stageKey)}
              >
                <span className="agent-stage-nav-title">{item.label}</span>
                <span className="agent-stage-nav-meta">共 {item.value} 个会话</span>
              </button>
            ))}
          </div>
          <div className="agent-stage-detail-panel">
            {selectedAgentStage ? (
              <>
                <div className="agent-stage-summary-card">
                  <div>
                    <p className="section-tag">当前阶段</p>
                    <h3>{selectedAgentStage.label}</h3>
                    <p className="panel-caption">最近会话与状态构成只保留最有排障价值的信息。</p>
                  </div>
                  <span className="status-pill">{selectedAgentStage.value}</span>
                </div>
                <div className="agent-status-pills">
                  {selectedAgentStage.statusSummary.map((summary) => (
                    <span key={`${selectedAgentStage.stageKey}-${summary.label}`} className="session-status">
                      {summary.label} · {summary.value}
                    </span>
                  ))}
                </div>
                <div className="agent-session-list">
                  {selectedAgentStage.recentSessions.map((session) => (
                    <article key={session.id} className="agent-session-item">
                      <div className="trace-head">
                        <strong>{session.title || session.id}</strong>
                        <span>{session.status}</span>
                      </div>
                      <p className="trace-meta">{session.id}</p>
                      <p className="trace-meta">更新时间：{formatDateTime(session.updatedAt)}</p>
                      {session.pendingQuestion ? <p className="trace-meta">待确认：{session.pendingQuestion}</p> : null}
                    </article>
                  ))}
                  {selectedAgentStage.recentSessions.length === 0 ? <p className="empty">当前阶段暂无最近会话。</p> : null}
                </div>
              </>
            ) : (
              <p className="empty">当前没有阶段数据。</p>
            )}
          </div>
        </div>
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
    const executorDistribution = Array.from(
      currentScopeItems.reduce((acc, item) => {
        const key = item.executor || 'unknown';
        acc.set(key, (acc.get(key) || 0) + 1);
        return acc;
      }, new Map<string, number>())
    )
      .map(([label, value]) => ({ label: executorLabel(label), value }))
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
    const riskOptions = Array.from(new Set(currentScopeItems.flatMap((item) => item.riskTags))).sort((a, b) =>
      sandboxRiskLabel(a).localeCompare(sandboxRiskLabel(b), 'zh-Hans-CN', { sensitivity: 'base' })
    );
    const templateSummary = {
      total: templates.length,
      aliased: templates.filter((item) => templateAliasOf(item)).length,
      lastUpdatedAt: templates
        .map((item) => ((item as any).updatedAt ?? (item as any).createdAt ?? null) as string | null)
        .sort((a, b) => toTimestamp(b) - toTimestamp(a))[0] || null,
    };
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
    const sandboxFileTreeRows = buildSandboxFileTreeRows(
      sandboxFileTreeRootPath || sandboxDirectoryPath || '/',
      sandboxFileTreeItemsByPath,
      sandboxFileExpandedPaths
    );
    const processRows = getSandboxProcessRows(sandboxProcessResult);
    const portRows = getSandboxPortRows(sandboxPortResult);

    return (
      <>
        <main className="content-stack">
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
                概览
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
                    <h2>执行器分布</h2>
                    <span className="panel-caption">按执行器统计</span>
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
                            <p className="session-meta">{item.riskTags.map((risk) => sandboxRiskLabel(risk)).join(' / ')}</p>
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
                              <strong>{executorLabel(item.executor)}</strong>
                              <p className="session-meta">{item.codexExecutionMode || '-'}</p>
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
                                      <span key={risk} className="session-status">{sandboxRiskLabel(risk)}</span>
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
                  <p className="kpi-value">{templateSummary.total}</p>
                  <p className="kpi-meta">来自 E2B</p>
                </article>
                <article className="kpi-card">
                  <p className="kpi-title">已设置别名</p>
                  <p className="kpi-value">{templateSummary.aliased}</p>
                  <p className="kpi-meta">可直接识别的模板数量</p>
                </article>
                <article className="kpi-card">
                  <p className="kpi-title">最近更新时间</p>
                  <p className="kpi-value">{formatDateTime(templateSummary.lastUpdatedAt)}</p>
                  <p className="kpi-meta">模板治理优先看最近改动</p>
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
                              <td>{templateStatusLabel((item as any).status ?? '-')}</td>
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
                  <span className="panel-caption">创建模板与批量标签维护</span>
                </div>
                <div className="form-stack">
                  <p className="muted">使用 JSON 触发创建、批量分配标签或删除标签。别名设置已收进模板详情。</p>
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
                <div className="inspector-page-stack">
                  <section className="inspector-stat-grid">
                    <article className="inspector-stat-card">
                      <span className="inspector-stat-label">运行状态</span>
                      <strong>{sandboxRuntimeStateLabel(sandboxRuntimeDetail.runtime.sandboxState || sandboxRuntimeDetail.runtime.status)}</strong>
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
                        <span className="session-status">{executorLabel(sandboxRuntimeDetail.runtime.executor)}</span>
                      </div>
                      <div className="inspector-kv-grid">
                        <div><span>Sandbox 标识</span><strong className="mono">{sandboxRuntimeDetail.runtime.sandboxId}</strong></div>
                        <div><span>执行器</span><strong>{executorLabel(sandboxRuntimeDetail.runtime.executor)}</strong></div>
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

              {sandboxDetailTab === 'files' ? (
                <div className="inspector-page-stack file-explorer-page">
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
                        placeholder="/workspace"
                      />
                    </label>
                    <span className="file-explorer-status">{sandboxFileStatus}</span>
                  </section>

                  <section className="file-explorer-shell">
                    <article className="file-explorer-main">
                      <div className="file-tree-head">
                        <div>
                          <h3>文件树</h3>
                          <span className="panel-caption">ranger / yazi 式目录导航</span>
                        </div>
                        <code className="mono">{sandboxDirectoryPath}</code>
                      </div>
                      <div className="file-tree-list" role="tree" aria-label="Sandbox 文件树">
                        {sandboxFileTreeRows.length ? (
                          sandboxFileTreeRows.map((item) => {
                            const isActive = sandboxFilePath === item.path || sandboxDirectoryPath === item.path;
                            return (
                              <div
                                key={`${item.path}-${item.depth}`}
                                className={`file-tree-row ${isActive ? 'active' : ''} ${item.kind === 'dir' ? 'is-dir' : 'is-file'}`}
                                style={{ paddingLeft: `${item.depth * 18 + 8}px` }}
                                role="treeitem"
                                aria-expanded={item.kind === 'dir' ? item.expanded : undefined}
                              >
                                <button
                                  type="button"
                                  className="file-tree-disclosure mono"
                                  disabled={item.kind !== 'dir' || item.isRoot}
                                  onClick={() => void toggleSandboxFileTreeDirectory(item)}
                                  aria-label={item.expanded ? '折叠目录' : '展开目录'}
                                >
                                  {item.kind === 'dir' ? (item.isRoot || item.expanded ? 'v' : '>') : '-'}
                                </button>
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
                                <span className="file-tree-meta">{item.kind === 'dir' ? (item.loaded ? `${item.childCount} 项` : '未展开') : formatBytes(item.sizeBytes)}</span>
                                <span className="file-tree-meta">{sandboxFileTypeLabel(item)}</span>
                                <span className="file-tree-meta">{item.modifiedAt ? formatDateTime(item.modifiedAt) : '-'}</span>
                              </div>
                            );
                          })
                        ) : (
                          <p className="empty">当前目录暂无内容，或请先刷新目录。</p>
                        )}
                      </div>
                    </article>
                  </section>
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
                    <section className="task-manager-toolbar" aria-label="Sandbox 进程工具栏">
                      <button type="button" className="secondary-btn" onClick={() => void loadSandboxProcesses()}>
                        刷新进程
                      </button>
                      <label>
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
                      <span className="task-manager-toolbar-note">单击表格行可把 PID 带入结束输入框</span>
                    </section>
                  ) : (
                    <section className="task-manager-toolbar" aria-label="Sandbox 端口工具栏">
                      <button type="button" className="secondary-btn" onClick={() => void inspectSandboxPorts()}>
                        刷新端口
                      </button>
                      <label>
                        <span>端口映射</span>
                        <input
                          className="text-input mono"
                          value={sandboxPortInput}
                          onChange={(event) => setSandboxPortInput(event.target.value)}
                          placeholder="3000"
                        />
                      </label>
                      <button type="button" className="primary-btn" onClick={() => void resolveSandboxHost()}>
                        查询 Host
                      </button>
                      <span className="task-manager-toolbar-note">单击监听行可把端口带入映射输入框</span>
                    </section>
                  )}

                  <section className="task-manager-fullscreen">
                    {sandboxProcessToolView === 'processes' ? (
                      <article className="inspector-card task-manager-panel task-manager-panel-full">
                      <div className="inspector-card-header">
                        <div>
                          <h3>进程</h3>
                          <span className="panel-caption">{processRows.length ? `${processRows.length} 个进程` : '等待刷新进程列表'}</span>
                        </div>
                      </div>
                      <div className="task-manager-table-wrap">
                        <table className="task-manager-table">
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
                      <div className="inspector-card-header">
                        <div>
                          <h3>端口</h3>
                          <span className="panel-caption">{portRows.length ? `${portRows.length} 个监听项` : '等待刷新监听端口'}</span>
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
                                  className={sandboxPortInput === row.port ? 'active' : undefined}
                                  title={row.raw}
                                  onClick={() => {
                                    if (row.port !== '-') setSandboxPortInput(row.port);
                                  }}
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
                  </section>

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
                  <h2>{currentTemplateAlias || currentTemplateId || '模板详情'}</h2>
                </div>
                <button type="button" className="secondary-btn" onClick={closeTemplateDetail}>
                  关闭
                </button>
              </div>
              <div className="detail-grid modal-grid">
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
              </div>
              {(templateDetail as any)?.builds ? (
                <div className="panel">
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
    <>
      <main className="content-stack">
        <section className="page-intro-grid audit-intro-grid fade-in">
          <article className="panel hero-panel">
            <div className="panel-header panel-header-stack">
              <div>
                <p className="section-tag">审计摘要</p>
                <h2>管理动作与失败排查</h2>
              </div>
              <span className="service-state ok">按时间倒序展示</span>
            </div>
            <div className="hero-metrics">
              <div>
                <span className="hero-metric-label">筛选结果</span>
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
                <p className="section-tag">筛选状态</p>
                <h2>当前范围</h2>
              </div>
            </div>
            <ul className="signal-list">
              <li>总日志数：{auditResponseMeta.total}</li>
              <li>当前筛选后：{auditResponseMeta.filteredTotal || auditEntries.length}</li>
              <li>可筛维度：操作人 / 动作 / 结果 / 会话 / 目标实例 / 时间</li>
            </ul>
          </article>
        </section>

        <section className="panel fade-in">
          <div className="panel-header">
            <h2>筛选条件</h2>
            <span className="panel-caption">按操作人、动作、结果、会话、目标实例和时间筛选</span>
          </div>
          <div className="audit-filter-grid">
            <input
              className="control-input"
              placeholder="搜索日志 ID、详情、实例、会话"
              value={auditFilters.query}
              onChange={(event) => setAuditFilters((previous) => ({ ...previous, query: event.target.value }))}
            />
            <select
              className="control-input"
              value={auditFilters.operator}
              onChange={(event) => setAuditFilters((previous) => ({ ...previous, operator: event.target.value }))}
            >
              <option value="all">全部操作人</option>
              {auditOperatorOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <select
              className="control-input"
              value={auditFilters.action}
              onChange={(event) => setAuditFilters((previous) => ({ ...previous, action: event.target.value }))}
            >
              <option value="all">全部动作</option>
              {auditActionOptions.map((item) => (
                <option key={item} value={item}>
                  {auditActionLabel(item)}
                </option>
              ))}
            </select>
            <select
              className="control-input"
              value={auditFilters.result}
              onChange={(event) => setAuditFilters((previous) => ({ ...previous, result: event.target.value }))}
            >
              <option value="all">全部结果</option>
              <option value="success">成功</option>
              <option value="failed">失败</option>
            </select>
            <input
              className="control-input"
              placeholder="会话 ID"
              value={auditFilters.sessionId}
              onChange={(event) => setAuditFilters((previous) => ({ ...previous, sessionId: event.target.value }))}
            />
            <input
              className="control-input"
              placeholder="目标实例 ID"
              value={auditFilters.targetVmId}
              onChange={(event) => setAuditFilters((previous) => ({ ...previous, targetVmId: event.target.value }))}
            />
            <input
              className="control-input"
              type="datetime-local"
              value={auditFilters.from}
              onChange={(event) => setAuditFilters((previous) => ({ ...previous, from: event.target.value }))}
            />
            <input
              className="control-input"
              type="datetime-local"
              value={auditFilters.to}
              onChange={(event) => setAuditFilters((previous) => ({ ...previous, to: event.target.value }))}
            />
          </div>
          <div className="action-inline">
            <button type="button" className="primary-btn" onClick={() => void applyAuditFilters()}>
              应用筛选
            </button>
            <button type="button" className="secondary-btn" onClick={() => void resetAuditFilters()}>
              重置
            </button>
          </div>
        </section>

        <section className="panel fade-in">
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
                  <th>时间</th>
                  <th>动作</th>
                  <th>结果</th>
                  <th>操作人</th>
                  <th>目标实例</th>
                  <th>会话</th>
                  <th>详情</th>
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
                  auditEntries.map((entry) => (
                    <tr key={entry.id}>
                      <td>{formatDateTime(entry.timestamp)}</td>
                      <td>{auditActionLabel(entry.action)}</td>
                      <td>
                        <span className={resultClassName(entry.result)}>{auditResultLabel(entry.result)}</span>
                      </td>
                      <td>{entry.operator}</td>
                      <td className="mono">{entry.targetVmId}</td>
                      <td className="mono">{entry.sessionId || '-'}</td>
                      <td>{entry.detail || '-'}</td>
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
            className="modal-card"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <div className="modal-header">
              <div>
                <p className="section-tag">审计详情</p>
                <h2>{auditActionLabel(auditDetail.entry.action)} · {auditDetail.entry.targetVmId}</h2>
              </div>
              <button type="button" className="secondary-btn" onClick={() => setAuditDetail(null)}>
                关闭
              </button>
            </div>
            <div className={`detail-grid modal-grid audit-detail-grid ${auditDetail.relatedEntries.length === 0 ? 'audit-detail-grid-single' : ''}`}>
              <article className="sub-panel">
                <p className="kpi-title">当前记录</p>
                <div className="validation-result">
                  <div>日志 ID: {auditDetail.entry.id}</div>
                  <div>时间: {formatDateTime(auditDetail.entry.timestamp)}</div>
                  <div>动作: {auditActionLabel(auditDetail.entry.action)}</div>
                  <div>结果: {auditResultLabel(auditDetail.entry.result)}</div>
                  <div>操作人: {auditDetail.entry.operator}</div>
                  <div>目标实例: {auditDetail.entry.targetVmId}</div>
                  <div>会话 ID: {auditDetail.entry.sessionId || '-'}</div>
                  <div>关联记录: {auditDetail.relatedEntries.length || 0}</div>
                </div>
                <pre className="json-block">{toJsonText(auditDetail.entry)}</pre>
              </article>
              {auditDetail.relatedEntries.length > 0 ? (
                <article className="sub-panel">
                  <p className="kpi-title">关联记录</p>
                  <div className="audit-related-list">
                    {auditDetail.relatedEntries.map((entry) => (
                      <article key={entry.id} className="audit-related-item">
                        <strong>{auditActionLabel(entry.action)} · {auditResultLabel(entry.result)}</strong>
                        <span>{formatDateTime(entry.timestamp)}</span>
                        <span className="mono">{entry.sessionId || entry.targetVmId}</span>
                        {entry.detail ? <p>{entry.detail}</p> : null}
                      </article>
                    ))}
                  </div>
                </article>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
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
        <aside className="sidebar fade-in" onWheelCapture={handleSidebarWheel}>
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
          <nav className="sidebar-nav" aria-label="Primary" ref={sidebarNavRef}>
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

        <section className={`main-area ${activeSection === 'conversation' ? 'conversation-main-area' : ''}`}>
          <header className="top-header fade-in">
            <div className="page-header-shell page-header-compact-bar">
              <div className="header-main page-header-mainline">
                <span className="topbar-pill">{activeNavGroup.label}</span>
                <p className="eyebrow">
                  {activeNavGroup.label} / {breadcrumbTitle}
                </p>
                <h1>{breadcrumbTitle}</h1>
                <p className="subtitle">{activeNavItem.description}</p>
              </div>
              <div className="page-header-compact-meta">
                <span className="updated-at">最后更新: {formatDateTime(updatedAtLabel)}</span>
                <span className={`service-state ${activeServiceOnline ? 'ok' : 'down'}`}>
                  {activeServiceOnline ? `${activeServiceLabel}在线` : `${activeServiceLabel}离线`}
                </span>
                <span className="updated-at">{adminDisplayNameLabel(adminUser?.displayName, adminUser?.loginName)}</span>
              </div>
              <div className="header-actions page-header-compact-actions">
                <label className="theme-switcher" title={selectedThemeOption?.description || '切换后台主题'}>
                  <span>主题</span>
                  <select value={currentTheme} onChange={(event) => void handleThemeChange(event)} disabled={themeSaving}>
                    {themeOptions.map((theme) => (
                      <option key={theme.key} value={theme.key}>
                        {theme.label}
                      </option>
                    ))}
                  </select>
                  <span className="theme-switcher-swatches" aria-hidden="true">
                    {(selectedThemeOption?.swatches || []).slice(0, 3).map((swatch) => (
                      <i key={swatch} style={{ backgroundColor: swatch }} />
                    ))}
                  </span>
                </label>
                <button
                  type="button"
                  className="primary-btn"
                  onClick={() => void refreshActiveSection()}
                  disabled={refreshing}
                >
                  {refreshing ? '刷新中...' : '刷新当前页面'}
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
