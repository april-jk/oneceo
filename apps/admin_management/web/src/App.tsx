import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { api } from './api';
import { KvmControlCenter } from './components/KvmControlCenter';
import type {
  AgentManagementOverview,
  AuditLogEntry,
  ConversationSession,
  ConversationSessionDetailResponse,
  DashboardOverview,
  E2bSandboxDetail,
  E2bSandboxFullInfo,
  E2bSandboxMetricPoint,
  E2bTemplate,
  E2bTemplateBuildInfo,
  E2bTemplateBuildLogsResponse,
  E2bTemplateWithBuilds,
  HostListResponse,
  SandboxManagementOverview,
  VmItem,
} from './types';

type SectionKey = 'kvm' | 'conversation' | 'agent' | 'sandbox' | 'audit';
type HostTrendPoint = {
  timestamp: number;
  timeLabel: string;
  cpu: number;
  memory: number;
  storage: number;
};

const NAV_ITEMS: Array<{ key: SectionKey; label: string; subtitle: string }> = [
  { key: 'kvm', label: 'KVM 管理', subtitle: '虚拟机与资源' },
  { key: 'conversation', label: '对话管理', subtitle: '任务创建会话' },
  { key: 'agent', label: '智能体管理', subtitle: 'Agent 运行状态' },
  { key: 'sandbox', label: '执行环境管理', subtitle: 'Sandbox 与 OSAC' },
  { key: 'audit', label: '审计日志', subtitle: '操作追踪' },
];

const VM_STATE_COLORS: Record<string, string> = {
  running: '#0f766e',
  stopped: '#94a3b8',
  paused: '#f59e0b',
  error: '#dc2626',
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
  const [activeSection, setActiveSection] = useState<SectionKey>('kvm');
  const [kvmMode, setKvmMode] = useState<'kvm' | 'sandbox'>('sandbox');

  const [kvmOverview, setKvmOverview] = useState<DashboardOverview | null>(null);
  const [vms, setVms] = useState<VmItem[]>([]);
  const [hosts, setHosts] = useState<HostListResponse['hosts']>([]);
  const [hostTrendMap, setHostTrendMap] = useState<Record<string, HostTrendPoint[]>>({});
  const [busyVmIds, setBusyVmIds] = useState<Record<string, boolean>>({});

  const [conversationSessions, setConversationSessions] = useState<ConversationSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [conversationDetail, setConversationDetail] = useState<ConversationSessionDetailResponse | null>(null);
  const [showOpencodePayload, setShowOpencodePayload] = useState(false);
  const [transitionView, setTransitionView] = useState<'timeline' | 'list'>('timeline');
  const [transitionQuery, setTransitionQuery] = useState('');
  const [transitionFilters, setTransitionFilters] = useState(DEFAULT_TRANSITION_FILTERS);

  const [agentOverview, setAgentOverview] = useState<AgentManagementOverview | null>(null);
  const [sandboxOverview, setSandboxOverview] = useState<SandboxManagementOverview | null>(null);
  const [sandboxDetail, setSandboxDetail] = useState<E2bSandboxDetail | null>(null);
  const [sandboxModalOpen, setSandboxModalOpen] = useState(false);
  const [sandboxTab, setSandboxTab] = useState<'sandboxes' | 'templates'>('sandboxes');
  const [sandboxDetailTab, setSandboxDetailTab] = useState<'info' | 'metrics' | 'tools'>('info');
  const [sandboxFullInfo, setSandboxFullInfo] = useState<E2bSandboxFullInfo | null>(null);
  const [sandboxMetrics, setSandboxMetrics] = useState<E2bSandboxMetricPoint[]>([]);
  const [sandboxToolAction, setSandboxToolAction] = useState('command.run');
  const [sandboxToolPayload, setSandboxToolPayload] = useState('{"cmd":"ls"}');
  const [sandboxToolResult, setSandboxToolResult] = useState<unknown>(null);
  const [sandboxCreatePayload, setSandboxCreatePayload] = useState(
    '{"template":"opencode-playwright-mcp-v2-min-eko","timeoutMs":300000}'
  );

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
    const result = await api.listConversationSessions(30);
    setConversationSessions(result.sessions);

    if (result.sessions.length > 0) {
      const nextId = selectedSessionId && result.sessions.some((item) => item.id === selectedSessionId)
        ? selectedSessionId
        : result.sessions[0].id;
      setSelectedSessionId(nextId);
    } else {
      setSelectedSessionId(null);
      setConversationDetail(null);
    }
  }, [selectedSessionId]);

  const loadConversationDetail = useCallback(async (sessionId: string) => {
    const detail = await api.getConversationSessionDetail(sessionId);
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

  const loadAgentSection = useCallback(async () => {
    const result = await api.getAgentManagementOverview();
    setAgentOverview(result);
  }, []);

  const loadSandboxSection = useCallback(async () => {
    const result = await api.getSandboxManagementOverview(80);
    setSandboxOverview(result);
  }, []);

  const loadTemplates = useCallback(async () => {
    const result = await api.listTemplates();
    setTemplates(result);
  }, []);

  const loadSandboxDetail = useCallback(async (sandboxId: string) => {
    const result = await api.getSandboxEnvironment(sandboxId);
    setSandboxDetail(result);
  }, []);

  const loadSandboxFullInfo = useCallback(async (sandboxId: string) => {
    const result = await api.getSandboxFullInfo(sandboxId);
    setSandboxFullInfo(result);
  }, []);

  const loadSandboxMetrics = useCallback(async (sandboxId: string) => {
    const result = await api.getSandboxMetrics(sandboxId);
    setSandboxMetrics(result);
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
      await loadSandboxDetail(sandboxId);
      setSandboxDetailTab('info');
      setSandboxFullInfo(null);
      setSandboxMetrics([]);
      setSandboxModalOpen(true);
    },
    [loadSandboxDetail]
  );

  const closeSandboxDetail = useCallback(() => {
    setSandboxModalOpen(false);
  }, []);

  const closeTemplateDetail = useCallback(() => {
    setTemplateModalOpen(false);
  }, []);

  const closeSandbox = useCallback(
    async (sandboxId: string) => {
      setSandboxBusyIds((prev) => ({ ...prev, [sandboxId]: true }));
      try {
        await api.closeSandboxEnvironment(sandboxId);
        if (sandboxDetail?.sandboxId === sandboxId) {
          const refreshed = await api.getSandboxEnvironment(sandboxId).catch(() => null);
          setSandboxDetail(refreshed);
        }
        await loadSandboxSection();
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : '关闭 Sandbox 失败');
      } finally {
        setSandboxBusyIds((prev) => ({ ...prev, [sandboxId]: false }));
      }
    },
    [loadSandboxSection, sandboxDetail?.sandboxId]
  );

  const pauseSandbox = useCallback(
    async (sandboxId: string) => {
      setSandboxBusyIds((prev) => ({ ...prev, [sandboxId]: true }));
      try {
        await api.pauseSandboxEnvironment(sandboxId);
        await loadSandboxSection();
        if (sandboxDetail?.sandboxId === sandboxId) {
          const refreshed = await api.getSandboxEnvironment(sandboxId).catch(() => null);
          setSandboxDetail(refreshed);
        }
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : '暂停 Sandbox 失败');
      } finally {
        setSandboxBusyIds((prev) => ({ ...prev, [sandboxId]: false }));
      }
    },
    [loadSandboxSection, sandboxDetail?.sandboxId]
  );

  const resumeSandbox = useCallback(
    async (sandboxId: string) => {
      setSandboxBusyIds((prev) => ({ ...prev, [sandboxId]: true }));
      try {
        await api.resumeSandboxEnvironment(sandboxId);
        await loadSandboxSection();
        if (sandboxDetail?.sandboxId === sandboxId) {
          const refreshed = await api.getSandboxEnvironment(sandboxId).catch(() => null);
          setSandboxDetail(refreshed);
        }
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : '恢复 Sandbox 失败');
      } finally {
        setSandboxBusyIds((prev) => ({ ...prev, [sandboxId]: false }));
      }
    },
    [loadSandboxSection, sandboxDetail?.sandboxId]
  );

  const runSandboxTool = useCallback(async () => {
    if (!sandboxDetail?.sandboxId) return;
    try {
      const payload = sandboxToolPayload.trim() ? (JSON.parse(sandboxToolPayload) as Record<string, unknown>) : undefined;
      const result = await api.runSandboxToolAction(sandboxDetail.sandboxId, sandboxToolAction, payload);
      setSandboxToolResult(result);
    } catch (toolError) {
      setError(toolError instanceof Error ? toolError.message : '执行工具操作失败');
    }
  }, [sandboxDetail?.sandboxId, sandboxToolAction, sandboxToolPayload]);

  const createSandbox = useCallback(async () => {
    try {
      const payload = sandboxCreatePayload.trim()
        ? (JSON.parse(sandboxCreatePayload) as Record<string, unknown>)
        : {};
      await api.createSandboxEnvironment(payload);
      await loadSandboxSection();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '创建 Sandbox 失败');
    }
  }, [sandboxCreatePayload, loadSandboxSection]);

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
          if (kvmMode === 'sandbox') {
            if (sandboxTab === 'templates') {
              await loadTemplates();
            } else {
              await loadSandboxSection();
            }
          } else {
            await Promise.all([loadKvmSection(), loadAuditSection()]);
          }
        } else if (section === 'conversation') {
          await loadConversationSessions();
        } else if (section === 'agent') {
          await loadAgentSection();
        } else if (section === 'sandbox') {
          await loadSandboxSection();
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
      kvmMode,
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
    loadSection(activeSection, true);
  }, [activeSection, loadSection]);

  useEffect(() => {
    if (activeSection !== 'kvm') return;
    void loadSection('kvm');
  }, [activeSection, kvmMode, sandboxTab, loadSection]);

  useEffect(() => {
    if (activeSection !== 'kvm') {
      return;
    }

    const timer = window.setInterval(() => {
      if (kvmMode === 'sandbox') {
        const refresh = sandboxTab === 'templates' ? loadTemplates : loadSandboxSection;
        void refresh().catch((requestError) => {
          setError(requestError instanceof Error ? requestError.message : 'Sandbox 自动刷新失败');
        });
      } else {
        void loadKvmSection().catch((requestError) => {
          setError(requestError instanceof Error ? requestError.message : 'KVM 自动刷新失败');
        });
      }
    }, 15000);

    return () => {
      window.clearInterval(timer);
    };
  }, [activeSection, kvmMode, sandboxTab, loadKvmSection, loadSandboxSection, loadTemplates]);

  useEffect(() => {
    if (!selectedSessionId || activeSection !== 'conversation') {
      return;
    }

    let cancelled = false;
    const run = async () => {
      try {
        const [detail, sessions] = await Promise.all([
          api.getConversationSessionDetail(selectedSessionId),
          api.listConversationSessions(30),
        ]);
        if (!cancelled) {
          setConversationDetail(detail);
          setConversationSessions(sessions.sessions);
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : '加载会话详情失败');
        }
      }
    };

    void run();
    const timer = window.setInterval(() => {
      void run();
    }, 4000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeSection, selectedSessionId]);

  useEffect(() => {
    setTransitionView('timeline');
    setTransitionQuery('');
    setTransitionFilters(DEFAULT_TRANSITION_FILTERS);
  }, [selectedSessionId]);

  const vmPieData = useMemo(
    () => (kvmOverview?.vmStateDistribution ?? []).filter((item) => item.value > 0),
    [kvmOverview]
  );

  const stateTransitions = useMemo(
    () => conversationDetail?.trace?.stateTransitions || [],
    [conversationDetail]
  );
  const sortedTransitions = useMemo(() => {
    return [...stateTransitions].sort((a, b) => {
      const aTime = a.at ? Date.parse(a.at) : Number.MAX_SAFE_INTEGER;
      const bTime = b.at ? Date.parse(b.at) : Number.MAX_SAFE_INTEGER;
      return aTime - bTime;
    });
  }, [stateTransitions]);

  const transitionOptions = useMemo(() => {
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
  }, [sortedTransitions]);

  const filteredTransitions = useMemo(() => {
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
  }, [sortedTransitions, transitionFilters, transitionQuery]);

  const transitionStats = useMemo(() => {
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
  }, [sortedTransitions.length, filteredTransitions]);

  const kvmShowsSandbox = activeSection === 'kvm' && kvmMode === 'sandbox';
  const breadcrumbTitle = NAV_ITEMS.find((item) => item.key === activeSection)?.label || '管理后台';
  const activeServiceOnline =
    activeSection === 'agent'
      ? agentOverview?.agentApi.online
      : activeSection === 'sandbox' || kvmShowsSandbox
        ? sandboxOverview?.sandboxApi.online
        : kvmOverview?.orchestrator.online;
  const activeServiceLabel =
    activeSection === 'agent'
      ? 'Agent 服务'
      : activeSection === 'sandbox' || kvmShowsSandbox
        ? 'Sandbox 服务'
        : 'KVM 服务';
  const updatedAtLabel = kvmShowsSandbox
    ? sandboxOverview?.sandboxApi.timestamp || sandboxOverview?.sandboxes?.[0]?.startedAt
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
      <section className="panel fade-in">
        <div className="panel-header">
          <h2>KVM 宿主机状态</h2>
          <span className="kpi-meta">总计 {hosts.length} 台</span>
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
        <article className="kpi-card">
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
      <section className="conversation-layout fade-in">
        <article className="panel">
          <div className="panel-header">
            <h2>会话列表</h2>
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
                下载会话详情
              </button>
            ) : null}
          </div>
          {!conversationDetail ? (
            <p className="empty">请选择左侧会话查看详情。</p>
          ) : (
            <div className="conversation-detail">
              <div className="detail-grid detail-grid-wide">
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
                  <p className="kpi-title">编排 Session</p>
                  <p className="mono">{conversationDetail.runtime?.orchestratorSessionId || '-'}</p>
                </div>
                <div>
                  <p className="kpi-title">OpenCode Session</p>
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
                  <pre className="json-block">
                    {toJsonText({
                      primaryEnvironment: conversationDetail.trace?.sandbox.primaryEnvironment,
                      relatedEnvironments: conversationDetail.trace?.sandbox.relatedEnvironments,
                    })}
                  </pre>
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
            </div>
          )}
        </article>
      </section>
    </main>
  );

  const renderAgentSection = () => (
    <main className="content-stack">
      <section className="kpi-grid fade-in">
        <article className="kpi-card">
          <p className="kpi-title">Oneceo API</p>
          <p className="kpi-value">{agentOverview?.oneceoApi.online ? '在线' : '离线'}</p>
          <p className="kpi-meta">{formatDateTime(agentOverview?.oneceoApi.timestamp)}</p>
        </article>
        <article className="kpi-card">
          <p className="kpi-title">Agent API</p>
          <p className="kpi-value">{agentOverview?.agentApi.online ? '在线' : '离线'}</p>
          <p className="kpi-meta">{agentOverview?.agentApi.message || '-'}</p>
        </article>
        <article className="kpi-card">
          <p className="kpi-title">任务会话总数</p>
          <p className="kpi-value">{agentOverview?.taskCreationSessions.total ?? 0}</p>
          <p className="kpi-meta">来自 task-creation sessions</p>
        </article>
        <article className="kpi-card">
          <p className="kpi-title">待确认会话</p>
          <p className="kpi-value">{agentOverview?.taskCreationSessions.waitingUser ?? 0}</p>
          <p className="kpi-meta">状态 waiting_user</p>
        </article>
      </section>

      <section className="chart-grid fade-in">
        <article className="panel">
          <div className="panel-header">
            <h2>任务阶段分布</h2>
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
    const summary = sandboxOverview?.summary;
    const statusData = [
      { name: 'Running', value: summary?.running ?? 0, color: '#0f766e' },
      { name: 'Paused', value: summary?.paused ?? 0, color: '#f59e0b' },
    ];
    const metricsData = sandboxMetrics.map((point) => ({
      timeLabel: point.timestamp ? new Date(point.timestamp).toLocaleTimeString('zh-CN', { hour12: false }) : '-',
      cpu: point.cpuUsagePercent ?? 0,
      memory: point.memoryUsagePercent ?? 0,
      disk: point.diskUsagePercent ?? 0,
    }));

    return (
      <>
        <main className="content-stack">
          <section className="panel fade-in">
            <div className="panel-header">
              <h2>Sandbox 模块</h2>
            </div>
            <div className="button-grid">
              <button
                type="button"
                className={`secondary-btn ${sandboxTab === 'sandboxes' ? 'active' : ''}`}
                onClick={() => setSandboxTab('sandboxes')}
              >
                Sandboxes
              </button>
              <button
                type="button"
                className={`secondary-btn ${sandboxTab === 'templates' ? 'active' : ''}`}
                onClick={() => setSandboxTab('templates')}
              >
                Templates
              </button>
            </div>
          </section>

          {sandboxTab === 'sandboxes' ? (
            <>
              <section className="kpi-grid fade-in">
                <article className="kpi-card">
                  <p className="kpi-title">Sandbox API</p>
                  <p className="kpi-value">{sandboxOverview?.sandboxApi.online ? '在线' : '离线'}</p>
                  <p className="kpi-meta">{sandboxOverview?.sandboxApi.service || '-'}</p>
                </article>
                <article className="kpi-card">
                  <p className="kpi-title">执行环境总数</p>
                  <p className="kpi-value">{sandboxOverview?.summary.total ?? 0}</p>
                  <p className="kpi-meta">环境记录</p>
                </article>
                <article className="kpi-card">
                  <p className="kpi-title">Running</p>
                  <p className="kpi-value">{sandboxOverview?.summary.running ?? 0}</p>
                  <p className="kpi-meta">运行中</p>
                </article>
                <article className="kpi-card">
                  <p className="kpi-title">Paused</p>
                  <p className="kpi-value">{sandboxOverview?.summary.paused ?? 0}</p>
                  <p className="kpi-meta">暂停</p>
                </article>
              </section>

              <section className="chart-grid fade-in">
                <article className="panel">
                  <div className="panel-header">
                    <h2>Sandbox 状态分布</h2>
                  </div>
                  <div className="chart-wrap">
                    <ResponsiveContainer width="100%" height={260}>
                      <PieChart>
                        <Pie
                          data={statusData}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          outerRadius={90}
                          innerRadius={48}
                          label
                        >
                          {statusData.map((entry) => (
                            <Cell key={entry.name} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </article>
              </section>

              <section className="panel fade-in">
                <div className="panel-header">
                  <h2>执行环境列表</h2>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Sandbox ID</th>
                        <th>状态</th>
                        <th>模板</th>
                        <th>开始时间</th>
                        <th>到期时间</th>
                        <th>资源</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(sandboxOverview?.sandboxes || []).length === 0 ? (
                        <tr>
                          <td colSpan={7} className="empty">
                            暂无运行中的 Sandbox（请确认 E2B API Key 与是否存在运行实例）
                          </td>
                        </tr>
                      ) : (
                        (sandboxOverview?.sandboxes || []).map((item) => (
                          <tr
                            key={item.sandboxId}
                            className={sandboxDetail?.sandboxId === item.sandboxId ? 'selected-row' : undefined}
                          >
                            <td className="mono">{item.sandboxId}</td>
                            <td>{item.state}</td>
                            <td className="mono">{item.alias || item.templateId}</td>
                            <td>{formatDateTime(item.startedAt)}</td>
                            <td>{formatDateTime(item.endAt)}</td>
                            <td>{`${item.cpuCount}C / ${item.memoryMB}MB / ${item.diskSizeMB}MB`}</td>
                            <td>
                              <div className="action-inline">
                                <button
                                  type="button"
                                  className="table-btn"
                                  onClick={() => void openSandboxDetail(item.sandboxId)}
                                >
                                  查看详情
                                </button>
                                {item.state === 'running' ? (
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
                                    onClick={() => void resumeSandbox(item.sandboxId)}
                                  >
                                    恢复
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="table-btn danger"
                                  disabled={sandboxBusyIds[item.sandboxId]}
                                  onClick={() => {
                                    const reason = window.prompt('请输入终止原因（必填）');
                                    if (!reason) return;
                                    if (window.confirm(`确认终止 sandbox ${item.sandboxId} 吗？`)) {
                                      void closeSandbox(item.sandboxId);
                                    }
                                  }}
                                >
                                  终止
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="panel fade-in">
                <div className="panel-header">
                  <h2>创建 Sandbox</h2>
                </div>
                <div className="form-stack">
                  <p className="muted">
                    使用 E2B SDK 的 create/betaCreate 能力。JSON 支持 template/timeoutMs/metadata/envs/allowInternetAccess 等。
                  </p>
                  <textarea
                    className="input-area"
                    rows={6}
                    value={sandboxCreatePayload}
                    onChange={(event) => setSandboxCreatePayload(event.target.value)}
                  />
                  <button type="button" className="primary-btn" onClick={() => void createSandbox()}>
                    创建 Sandbox
                  </button>
                </div>
              </section>
            </>
          ) : (
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
                  <p className="kpi-meta">点击检测可查看</p>
                </article>
              </section>

              <section className="panel fade-in">
                <div className="panel-header">
                  <h2>模板列表</h2>
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
              </section>

              <section className="panel fade-in">
                <div className="panel-header">
                  <h2>模板动作</h2>
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
          )}
        </main>

        {sandboxModalOpen && sandboxDetail ? (
          <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={closeSandboxDetail}>
            <div
              className="modal-card"
              onClick={(event) => {
                event.stopPropagation();
              }}
            >
              <div className="modal-header">
                <h2>Sandbox 详情</h2>
                <button type="button" className="secondary-btn" onClick={closeSandboxDetail}>
                  关闭
                </button>
              </div>
              <div className="button-grid">
                <button
                  type="button"
                  className={`secondary-btn ${sandboxDetailTab === 'info' ? 'active' : ''}`}
                  onClick={() => setSandboxDetailTab('info')}
                >
                  Info
                </button>
                <button
                  type="button"
                  className={`secondary-btn ${sandboxDetailTab === 'metrics' ? 'active' : ''}`}
                  onClick={() => {
                    setSandboxDetailTab('metrics');
                    void loadSandboxMetrics(sandboxDetail.sandboxId);
                  }}
                >
                  Metrics
                </button>
                <button
                  type="button"
                  className={`secondary-btn ${sandboxDetailTab === 'tools' ? 'active' : ''}`}
                  onClick={() => setSandboxDetailTab('tools')}
                >
                  Tools
                </button>
              </div>

              {sandboxDetailTab === 'info' ? (
                <div className="detail-grid">
                  <article className="sub-panel">
                    <p className="kpi-title">Sandbox ID</p>
                    <p className="mono">{sandboxDetail.sandboxId}</p>
                    <p className="kpi-title">状态</p>
                    <p>{sandboxDetail.state}</p>
                    <p className="kpi-title">模板</p>
                    <p className="mono">{sandboxDetail.name || sandboxDetail.templateId}</p>
                    <p className="kpi-title">开始时间</p>
                    <p>{formatDateTime(sandboxDetail.startedAt)}</p>
                    <p className="kpi-title">到期时间</p>
                    <p>{formatDateTime(sandboxDetail.endAt)}</p>
                    <p className="kpi-title">资源</p>
                    <p>{`${sandboxDetail.cpuCount}C / ${sandboxDetail.memoryMB}MB / ${sandboxDetail.diskSizeMB}MB`}</p>
                  </article>
                  <article className="sub-panel">
                    <p className="kpi-title">元数据</p>
                    <pre className="json-block">{toJsonText(sandboxDetail.metadata || {})}</pre>
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={() => void loadSandboxFullInfo(sandboxDetail.sandboxId)}
                    >
                      载入 Full Info
                    </button>
                    {sandboxFullInfo ? <pre className="json-block">{toJsonText(sandboxFullInfo)}</pre> : null}
                  </article>
                </div>
              ) : null}

              {sandboxDetailTab === 'metrics' ? (
                <div className="chart-grid">
                  <article className="panel">
                    <div className="panel-header">
                      <h2>CPU/内存/磁盘</h2>
                    </div>
                    <div className="chart-wrap">
                      <ResponsiveContainer width="100%" height={260}>
                        <LineChart data={metricsData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#dbe7f4" />
                          <XAxis dataKey="timeLabel" />
                          <YAxis />
                          <Tooltip />
                          <Line type="monotone" dataKey="cpu" stroke="#0f766e" name="CPU%" strokeWidth={2} />
                          <Line type="monotone" dataKey="memory" stroke="#1d4ed8" name="内存%" strokeWidth={2} />
                          <Line type="monotone" dataKey="disk" stroke="#b45309" name="磁盘%" strokeWidth={2} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </article>
                </div>
              ) : null}

              {sandboxDetailTab === 'tools' ? (
                <div className="form-stack">
                  <p className="muted">通过统一工具入口调用 E2B SDK（命令/文件系统/Git 等）。</p>
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
                    rows={6}
                    value={sandboxToolPayload}
                    onChange={(event) => setSandboxToolPayload(event.target.value)}
                  />
                  <button type="button" className="primary-btn" onClick={() => void runSandboxTool()}>
                    执行工具
                  </button>
                  {sandboxToolResult ? <pre className="json-block">{toJsonText(sandboxToolResult)}</pre> : null}
                </div>
              ) : null}
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
                <h2>模板详情</h2>
                <button type="button" className="secondary-btn" onClick={closeTemplateDetail}>
                  关闭
                </button>
              </div>
              <div className="detail-grid">
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
      </>
    );
  };
const renderAuditSection = () => (
    <main className="content-stack">
      <section className="panel fade-in">
        <div className="panel-header">
          <h2>审计日志</h2>
        </div>
        <div className="audit-list">
          {auditEntries.length === 0 ? (
            <p className="empty">暂无审计日志。</p>
          ) : (
            auditEntries.map((entry) => (
              <article key={entry.id} className="audit-item">
                <p>
                  <strong>{entry.action.toUpperCase()}</strong> {entry.targetVmId}{' '}
                  <span className={entry.result === 'success' ? 'ok-text' : 'error-text'}>{entry.result}</span>
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

    if (activeSection === 'kvm') return kvmMode === 'sandbox' ? renderSandboxSection() : renderKvmSection();
    if (activeSection === 'conversation') return renderConversationSection();
    if (activeSection === 'agent') return renderAgentSection();
    if (activeSection === 'sandbox') return renderSandboxSection();
    return renderAuditSection();
  };

  return (
    <div className="page-shell">
      <div className="background-glow" aria-hidden="true" />
      <div className="app-layout">
        <aside className="sidebar fade-in">
          <div className="sidebar-brand">
            <p className="eyebrow">Oneceo Admin</p>
            <p className="sidebar-title">管理面板</p>
          </div>
          <nav className="sidebar-nav" aria-label="Primary">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`nav-item ${activeSection === item.key ? 'active' : ''}`}
                onClick={() => setActiveSection(item.key)}
              >
                <span>{item.label}</span>
                <small>{item.subtitle}</small>
              </button>
            ))}
          </nav>
        </aside>

        <section className="main-area">
          <header className="top-header fade-in">
            <div>
              <p className="eyebrow">控制台 / {breadcrumbTitle}</p>
              <h1>{kvmShowsSandbox ? `${breadcrumbTitle} · Sandbox` : breadcrumbTitle}</h1>
              <p className="subtitle">基于 oneceo 项目现有模块能力构建的管理标签页。</p>
            </div>
            <div className="header-tools">
              <span className={`service-state ${activeServiceOnline ? 'ok' : 'down'}`}>
                {activeServiceOnline ? `${activeServiceLabel}在线` : `${activeServiceLabel}离线`}
              </span>
              {activeSection === 'kvm' ? (
                <div className="toggle-group" role="group" aria-label="KVM 切换">
                  <button
                    type="button"
                    className={`toggle-btn ${kvmMode === 'kvm' ? 'active' : ''}`}
                    onClick={() => setKvmMode('kvm')}
                  >
                    自建 KVM
                  </button>
                  <button
                    type="button"
                    className={`toggle-btn ${kvmMode === 'sandbox' ? 'active' : ''}`}
                    onClick={() => setKvmMode('sandbox')}
                  >
                    Sandbox
                  </button>
                </div>
              ) : null}
              <button
                type="button"
                className="primary-btn"
                onClick={() => loadSection(activeSection)}
                disabled={refreshing}
              >
                {refreshing ? '刷新中...' : '刷新当前标签'}
              </button>
              <p className="updated-at">最后更新: {formatDateTime(updatedAtLabel)}</p>
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
