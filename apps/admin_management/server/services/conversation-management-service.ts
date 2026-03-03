import type {
  OneceoApiConnector,
  OsacMessageRecord,
  SandboxEnvironmentRecord,
  TaskCreationMessage,
  TaskCreationSession,
} from '../connectors/oneceo-api-connector';
import type { KvmOrchestratorConnector } from '../connectors/kvm-orchestrator-connector';
import type { AuditService } from './audit-service';
import { promises as fs } from 'node:fs';
import path from 'node:path';

type TraceEvent = {
  id: string;
  timestamp?: string;
  source: 'user' | 'agent' | 'system' | 'osac' | 'kvm';
  category: string;
  title: string;
  content?: string;
  level: 'info' | 'warn' | 'error';
  metadata?: Record<string, unknown>;
};

type LlmTrace = {
  id: string;
  stage: 'intent_recognition' | 'planning' | 'execution_plan' | 'execution_review' | 'opencode_command';
  source: 'task_creation_agent' | 'opencode';
  inferred: boolean;
  request: Record<string, unknown>;
  response: Record<string, unknown>;
  createdAt?: string;
};

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function toStringValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === undefined || value === null) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function pickString(...candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return undefined;
}

function parseTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return undefined;
  return new Date(parsed).toISOString();
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function getEventLevel(input: { category?: string; content?: string }): 'info' | 'warn' | 'error' {
  const category = (input.category || '').toLowerCase();
  const content = (input.content || '').toLowerCase();
  if (
    category.includes('error') ||
    category.includes('failed') ||
    content.includes('失败') ||
    content.includes('error') ||
    content.includes('timeout') ||
    content.includes('超时')
  ) {
    return 'error';
  }
  if (
    category.includes('status') ||
    content.includes('等待') ||
    content.includes('clarify') ||
    content.includes('待用户')
  ) {
    return 'warn';
  }
  return 'info';
}

function summarizeOsacPayload(payload: Record<string, unknown>): string {
  const eventType = pickString(payload.eventType, toRecord(payload.event).type);
  if (eventType) {
    return eventType;
  }
  const status = pickString(payload.status, payload.state, toRecord(payload.result).status);
  if (status) {
    return status;
  }
  const message = pickString(payload.message, payload.text, payload.content, payload.output);
  if (message) {
    return message;
  }
  return '';
}

function summarizeText(value: string | undefined, max = 160) {
  if (!value) return '';
  const compact = value.replace(/\s+/g, ' ').trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max)}...`;
}

type LocalMemoryStore = {
  sessions: Array<
    TaskCreationSession & {
      phase?: string;
      phaseCycle?: number;
      messages?: TaskCreationMessage[];
    }
  >;
};

type LocalMemorySnapshot = {
  loadedAt: number;
  sessions: TaskCreationSession[];
  messagesBySession: Record<string, TaskCreationMessage[]>;
};

let localMemorySnapshot: LocalMemorySnapshot | null = null;

function isLocalFallbackEnabled(): boolean {
  const raw = String(process.env.ADMIN_MANAGEMENT_LOCAL_MEMORY_FALLBACK || 'true').trim().toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(raw);
}

function resolveLocalMemoryPath(): string {
  const override = String(process.env.ADMIN_MANAGEMENT_LOCAL_MEMORY_PATH || '').trim();
  if (override) {
    return override;
  }
  return path.resolve(process.cwd(), '..', 'api', 'data', 'task-creation-memory.json');
}

function mapLocalSession(session: Record<string, unknown>): TaskCreationSession {
  return {
    id: String(session.id || ''),
    title: String(session.title || '任务会话'),
    status: String(session.status || 'unknown'),
    stage: typeof session.stage === 'string' ? session.stage : undefined,
    runtime: (session.runtime as TaskCreationSession['runtime']) || undefined,
    pendingQuestion: typeof session.pendingQuestion === 'string' ? session.pendingQuestion : undefined,
    pendingOptions: Array.isArray(session.pendingOptions)
      ? (session.pendingOptions as string[]).filter(Boolean)
      : undefined,
    pendingResume: (session.pendingResume as TaskCreationSession['pendingResume']) || undefined,
    createdAt: typeof session.createdAt === 'string' ? session.createdAt : new Date().toISOString(),
    updatedAt: typeof session.updatedAt === 'string' ? session.updatedAt : new Date().toISOString(),
    messages: Array.isArray(session.messages) ? (session.messages as TaskCreationMessage[]) : undefined,
  };
}

function mapLocalMessages(messages: TaskCreationMessage[] | undefined): TaskCreationMessage[] {
  if (!Array.isArray(messages)) return [];
  return messages.map((message) => ({
    id: String(message.id || ''),
    role: message.role,
    messageType: message.messageType,
    content: message.content || '',
    createdAt: message.createdAt || new Date().toISOString(),
    metadata: message.metadata,
  }));
}

async function loadLocalMemorySnapshot(): Promise<LocalMemorySnapshot | null> {
  if (!isLocalFallbackEnabled()) return null;
  const ttlMs = Math.max(1000, Number(process.env.ADMIN_MANAGEMENT_LOCAL_MEMORY_TTL_MS || 5000));
  if (localMemorySnapshot && Date.now() - localMemorySnapshot.loadedAt < ttlMs) {
    return localMemorySnapshot;
  }

  try {
    const filePath = resolveLocalMemoryPath();
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as LocalMemoryStore;
    const sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
    const mappedSessions = sessions.map((item) => mapLocalSession(item as Record<string, unknown>));
    const messagesBySession: Record<string, TaskCreationMessage[]> = {};
    for (const session of mappedSessions) {
      const source = sessions.find((item) => String((item as any).id) === session.id) as any;
      messagesBySession[session.id] = mapLocalMessages(source?.messages);
    }
    localMemorySnapshot = {
      loadedAt: Date.now(),
      sessions: mappedSessions,
      messagesBySession,
    };
    return localMemorySnapshot;
  } catch (error) {
    console.warn('[admin-management][conversation] local memory load failed', error);
    return null;
  }
}

function normalizeMessageSource(role: string): 'user' | 'agent' | 'system' {
  if (role === 'user' || role === 'agent' || role === 'system') {
    return role;
  }
  return 'system';
}

function extractRuntimeBinding(input: {
  session: TaskCreationSession;
  messages: TaskCreationMessage[];
  relatedEnvironments: SandboxEnvironmentRecord[];
}): {
  orchestratorSessionId?: string;
  opencodeSessionId?: string;
  vmName?: string;
  bindingUpdatedAt?: string;
} {
  let orchestratorSessionId = pickString(input.session.runtime?.orchestratorSessionId);
  let opencodeSessionId = pickString(input.session.runtime?.opencodeSessionId);
  let vmName: string | undefined;
  let bindingUpdatedAt = parseTimestamp(input.session.runtime?.updatedAt);

  for (let i = input.messages.length - 1; i >= 0; i -= 1) {
    const message = input.messages[i];
    const metadata = toRecord(message.metadata);
    const nextOrchestrator = pickString(metadata.orchestratorSessionId, metadata.sessionId);
    const nextOpencode = pickString(metadata.opencodeSessionId);
    const nextVmName = pickString(metadata.vmName, metadata.vm_id, metadata.vmId);
    const nextUpdatedAt = parseTimestamp(message.createdAt);

    if (!orchestratorSessionId && nextOrchestrator) {
      orchestratorSessionId = nextOrchestrator;
      bindingUpdatedAt = bindingUpdatedAt || nextUpdatedAt;
    }
    if (!opencodeSessionId && nextOpencode) {
      opencodeSessionId = nextOpencode;
      bindingUpdatedAt = bindingUpdatedAt || nextUpdatedAt;
    }
    if (!vmName && nextVmName) {
      vmName = nextVmName;
    }
    if (orchestratorSessionId && opencodeSessionId && vmName) {
      break;
    }
  }

  if (!vmName) {
    const env = input.relatedEnvironments.find((item) => !!item.vmName) || null;
    vmName = env?.vmName || undefined;
  }

  return {
    orchestratorSessionId,
    opencodeSessionId,
    vmName,
    bindingUpdatedAt,
  };
}

function buildLlmTraces(input: {
  sessionId: string;
  messages: TaskCreationMessage[];
  intent: Record<string, unknown> | null;
  taskDescription: Record<string, unknown> | null;
  executionPlan: Record<string, unknown> | null;
}): LlmTrace[] {
  const firstUserInput =
    input.messages.find((item) => item.role === 'user' && (item.messageType || '').startsWith('user_'))?.content || '';
  const traces: LlmTrace[] = [];

  if (input.intent) {
    traces.push({
      id: `llm-intent-${input.sessionId}`,
      stage: 'intent_recognition',
      source: 'task_creation_agent',
      inferred: true,
      request: {
        userInput: firstUserInput,
        promptTemplate: 'IntentRecognitionAgent.systemPrompt + 用户输入',
      },
      response: input.intent,
      createdAt: parseTimestamp(input.intent.createdAt),
    });
  }

  if (input.taskDescription) {
    traces.push({
      id: `llm-planning-${input.sessionId}`,
      stage: 'planning',
      source: 'task_creation_agent',
      inferred: true,
      request: {
        userInput: firstUserInput,
        intent: input.intent || {},
        promptTemplate: 'PlanningAgent.systemPrompt + 意图结果 + 用户输入',
      },
      response: input.taskDescription,
      createdAt: parseTimestamp(input.taskDescription.createdAt),
    });
  }

  if (input.executionPlan) {
    traces.push({
      id: `llm-execution-plan-${input.sessionId}`,
      stage: 'execution_plan',
      source: 'task_creation_agent',
      inferred: true,
      request: {
        taskDescription: input.taskDescription || {},
        promptTemplate: 'ExecutionPlanAgent.systemPrompt + 任务描述',
      },
      response: input.executionPlan,
      createdAt: parseTimestamp(input.executionPlan.createdAt),
    });
  }

  const reviewMessages = input.messages.filter((message) => {
    const metadata = toRecord(message.metadata);
    return typeof metadata.reviewDone === 'boolean' || Array.isArray(metadata.reviewIssues);
  });

  for (let i = 0; i < reviewMessages.length; i += 1) {
    const message = reviewMessages[i];
    const metadata = toRecord(message.metadata);
    traces.push({
      id: `llm-review-${message.id}`,
      stage: 'execution_review',
      source: 'task_creation_agent',
      inferred: true,
      request: {
        promptTemplate: 'ExecutionReviewAgent.systemPrompt + 执行输出',
      },
      response: {
        done: metadata.reviewDone,
        issues: metadata.reviewIssues,
        summary: message.content,
      },
      createdAt: parseTimestamp(message.createdAt),
    });
  }

  const opencodeCommands = input.messages.filter((message) => {
    const metadata = toRecord(message.metadata);
    return !!pickString(metadata.osacCommand);
  });

  for (const message of opencodeCommands) {
    const metadata = toRecord(message.metadata);
    traces.push({
      id: `llm-opencode-${message.id}`,
      stage: 'opencode_command',
      source: 'opencode',
      inferred: false,
      request: {
        command: toStringValue(metadata.osacCommand),
        orchestratorSessionId: pickString(metadata.orchestratorSessionId),
      },
      response: {
        accepted: true,
        message: message.content,
      },
      createdAt: parseTimestamp(message.createdAt),
    });
  }

  return traces;
}

function buildTimeline(input: {
  messages: TaskCreationMessage[];
  osacMessages: OsacMessageRecord[];
  kvmSummary: Record<string, unknown>;
}): TraceEvent[] {
  const events: Array<TraceEvent & { order: number; timeMs: number }> = [];
  let order = 0;

  for (const message of input.messages) {
    const metadata = toRecord(message.metadata);
    const category = message.messageType || 'message';
    const timestamp = parseTimestamp(message.createdAt);
    const timeMs = timestamp ? Date.parse(timestamp) : Number.MAX_SAFE_INTEGER;
    events.push({
      id: `msg-${message.id}`,
      timestamp,
      source: normalizeMessageSource(message.role),
      category,
      title: `${message.role} · ${category}`,
      content: message.content,
      level: getEventLevel({ category, content: message.content }),
      metadata,
      order: order++,
      timeMs,
    });
  }

  for (let i = 0; i < input.osacMessages.length; i += 1) {
    const message = input.osacMessages[i];
    const payload = toRecord(message.payload);
    const timestamp =
      parseTimestamp(payload.timestamp) ||
      parseTimestamp(payload.time) ||
      parseTimestamp(payload.createdAt) ||
      parseTimestamp(toRecord(payload.event).timestamp);
    const summary = summarizeOsacPayload(payload);
    const timeMs = timestamp ? Date.parse(timestamp) : Number.MAX_SAFE_INTEGER;
    events.push({
      id: `osac-${i}-${message.type}`,
      timestamp,
      source: 'osac',
      category: message.type || 'OSAC',
      title: `OSAC · ${message.type || 'UNKNOWN'}`,
      content: summary || undefined,
      level: getEventLevel({ category: message.type, content: summary }),
      metadata: payload,
      order: order++,
      timeMs,
    });
  }

  const orchestratorSessionId = pickString(
    input.kvmSummary.orchestratorSessionId,
    toRecord(input.kvmSummary.session).sessionId
  );
  if (orchestratorSessionId) {
    events.push({
      id: `kvm-summary-${orchestratorSessionId}`,
      timestamp: parseTimestamp(toRecord(input.kvmSummary.session).updatedAt),
      source: 'kvm',
      category: 'kvm_session',
      title: 'KVM 会话状态',
      content: `session=${orchestratorSessionId} status=${toStringValue(toRecord(input.kvmSummary.session).status)}`,
      level: 'info',
      metadata: input.kvmSummary,
      order: order++,
      timeMs: parseTimestamp(toRecord(input.kvmSummary.session).updatedAt)
        ? Date.parse(String(toRecord(input.kvmSummary.session).updatedAt))
        : Number.MAX_SAFE_INTEGER,
    });
  }

  return events
    .sort((a, b) => (a.timeMs === b.timeMs ? a.order - b.order : a.timeMs - b.timeMs))
    .map(({ order: _order, timeMs: _timeMs, ...event }) => event);
}

type StateSnapshot = {
  status?: string;
  stage?: string;
  phase?: string;
};

type StateTransition = {
  from: StateSnapshot;
  to: StateSnapshot;
  at?: string;
  trigger: {
    messageId?: string;
    messageType?: string;
    role?: string;
    agent?: string;
    tone?: string;
    content?: string;
  };
};

function deriveStatusFromStage(stage?: string): string | undefined {
  if (!stage) return undefined;
  if (stage === 'completed') return 'completed';
  if (stage === 'failed') return 'failed';
  if (stage === 'clarifying') return 'waiting_user';
  return 'in_progress';
}

function extractStateFromMessage(message: TaskCreationMessage): StateSnapshot {
  const metadata = toRecord(message.metadata);
  const stage = pickString((message as any).stage, metadata.stage);
  const phase = pickString((metadata as any).phase, (message as any).phase);
  const status = pickString((metadata as any).status) || deriveStatusFromStage(stage);
  return {
    status: status || undefined,
    stage: stage || undefined,
    phase: phase || undefined,
  };
}

function buildStateTransitions(input: {
  session: TaskCreationSession;
  messages: TaskCreationMessage[];
}): StateTransition[] {
  const transitions: StateTransition[] = [];
  let current: StateSnapshot = {
    status: input.session.status,
    stage: input.session.stage,
  };

  const sorted = [...input.messages].sort((a, b) => {
    const aTime = Date.parse(a.createdAt || '') || 0;
    const bTime = Date.parse(b.createdAt || '') || 0;
    return aTime - bTime;
  });

  for (const message of sorted) {
    const next = extractStateFromMessage(message);
    if (!next.stage && !next.phase && !next.status) {
      continue;
    }

    const merged: StateSnapshot = {
      status: next.status || current.status,
      stage: next.stage || current.stage,
      phase: next.phase || current.phase,
    };

    const changed =
      merged.status !== current.status || merged.stage !== current.stage || merged.phase !== current.phase;

    if (changed) {
      const metadata = toRecord(message.metadata);
      transitions.push({
        from: current,
        to: merged,
        at: parseTimestamp(message.createdAt),
        trigger: {
          messageId: message.id,
          messageType: message.messageType,
          role: message.role,
          agent: pickString(metadata.agent),
          tone: pickString(metadata.tone),
          content: summarizeText(message.content, 120),
        },
      });
      current = merged;
    }
  }

  return transitions;
}

export class ConversationManagementService {
  constructor(
    private readonly oneceoApi: OneceoApiConnector,
    private readonly kvmConnector: KvmOrchestratorConnector,
    private readonly auditService: AuditService
  ) {}

  async listSessions(limit = 20) {
    try {
      const sessions = await this.oneceoApi.listTaskCreationSessions(limit);
      const normalized = sessions.map((item) => ({
        id: item.id,
        title: item.title,
        status: item.status,
        stage: item.stage,
        pendingQuestion: item.pendingQuestion,
        pendingOptions: item.pendingOptions,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      }));

      return {
        total: normalized.length,
        sessions: normalized,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[admin-management][conversation] listSessions failed, fallback to local memory', message);
      const local = await loadLocalMemorySnapshot();
      const sessions = local?.sessions
        .slice()
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
        .slice(0, limit)
        .map((item) => ({
          id: item.id,
          title: item.title,
          status: item.status,
          stage: item.stage,
          pendingQuestion: item.pendingQuestion,
          pendingOptions: item.pendingOptions,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        })) || [];

      if (sessions.length === 0) {
        throw error;
      }

      return {
        total: sessions.length,
        sessions,
      };
    }
  }

  async getSessionDetail(sessionId: string) {
    const sessionErrors: string[] = [];
    let session = await this.oneceoApi.getTaskCreationSession(sessionId).catch((error) => {
      sessionErrors.push(error instanceof Error ? error.message : String(error));
      return null;
    });

    let sessionMessages = Array.isArray(session?.messages) ? session!.messages : [];
    if (!session) {
      const local = await loadLocalMemorySnapshot();
      const localSession = local?.sessions.find((item) => item.id === sessionId) || null;
      if (localSession) {
        session = localSession;
        sessionMessages = local?.messagesBySession[sessionId] || [];
        console.warn('[admin-management][conversation] session fallback to local memory', sessionId);
      }
    }

    const [messages, intent, taskDescription, executionPlan, sandboxEnvironments] = await Promise.all([
      sessionMessages.length > 0
        ? Promise.resolve(sessionMessages)
        : this.oneceoApi.getTaskCreationMessages(sessionId).catch(() => []),
      this.oneceoApi.getTaskCreationIntent(sessionId).catch(() => null),
      this.oneceoApi.getTaskCreationTaskDescription(sessionId).catch(() => null),
      this.oneceoApi.getTaskCreationExecutionPlan(sessionId).catch(() => null),
      this.oneceoApi.listSandboxEnvironments(200).catch(() => []),
    ]);

    const safeSession: TaskCreationSession =
      session ||
      ({
        id: sessionId,
        title: `会话 ${sessionId.slice(-6)}`,
        status: 'unknown',
        stage: 'unknown',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        pendingQuestion: undefined,
        pendingOptions: [],
      } as TaskCreationSession);

    const normalizedMessages = Array.isArray(messages) ? messages : sessionMessages;
    const relatedEnvironments = (Array.isArray(sandboxEnvironments) ? sandboxEnvironments : []).filter((item) => {
      if (!item || typeof item !== 'object') return false;
      if (item.sessionId === sessionId) return true;
      const metadata = toRecord(item.metadata);
      return pickString(metadata.taskSessionId) === sessionId;
    });

    const binding = extractRuntimeBinding({
      session: safeSession,
      messages: normalizedMessages,
      relatedEnvironments,
    });

    const environmentByOrchestrator = binding.orchestratorSessionId
      ? relatedEnvironments.find((item) => item.sessionId === binding.orchestratorSessionId) || null
      : relatedEnvironments[0] || null;

    const kvmErrors: string[] = [...sessionErrors];
    const osacErrors: string[] = [];
    const rawKvmTimeoutMs = Number(process.env.ADMIN_MANAGEMENT_KVM_TIMEOUT_MS || 3000);
    const kvmTimeoutMs =
      Number.isFinite(rawKvmTimeoutMs) && rawKvmTimeoutMs > 0 ? Math.max(500, rawKvmTimeoutMs) : 3000;

    const kvmSafe = async <T>(label: string, task: Promise<T>): Promise<T | null> => {
      try {
        return await withTimeout(task, kvmTimeoutMs, label);
      } catch (error) {
        kvmErrors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      }
    };

    let osacMessages: OsacMessageRecord[] = [];
    if (binding.orchestratorSessionId) {
      try {
        const records = await this.oneceoApi.listOsacMessages(binding.orchestratorSessionId, 300);
        osacMessages = Array.isArray(records) ? records : [];
      } catch (error) {
        osacErrors.push(error instanceof Error ? error.message : String(error));
      }
    }

    const kvmSession = binding.orchestratorSessionId
      ? await kvmSafe('getSession', this.kvmConnector.getSession(binding.orchestratorSessionId))
      : null;

    const kvmSessionVm = binding.orchestratorSessionId
      ? await kvmSafe('getSessionVm', this.kvmConnector.getSessionVm(binding.orchestratorSessionId))
      : null;

    const kvmSandbox = binding.orchestratorSessionId
      ? await kvmSafe('getSandbox', this.kvmConnector.getSandbox(binding.orchestratorSessionId))
      : null;

    const kvmSandboxIp = binding.orchestratorSessionId
      ? await kvmSafe('getSandboxIp', this.kvmConnector.getSandboxIp(binding.orchestratorSessionId, false))
      : null;

    const kvmSandboxPorts = binding.orchestratorSessionId
      ? await kvmSafe(
          'listSandboxPortMappings',
          this.kvmConnector.listSandboxPortMappings(binding.orchestratorSessionId, {
            refresh: false,
            verify: false,
            waitSeconds: 0,
          })
        )
      : null;

    const vmName = pickString(
      binding.vmName,
      toRecord(kvmSessionVm).vmName,
      toRecord(toRecord(kvmSessionVm).vm).name,
      toRecord(kvmSession).vmName,
      environmentByOrchestrator?.vmName
    );

    const [kvmVmDetail, kvmVmMetrics, kvmVmLogs, kvmQuota] = vmName
      ? await Promise.all([
          kvmSafe('getVm', this.kvmConnector.getVm(vmName)),
          kvmSafe('getVmMetrics', this.kvmConnector.getVmMetrics(vmName)),
          kvmSafe('getVmLogs', this.kvmConnector.getVmLogs(vmName, 200)),
          binding.orchestratorSessionId
            ? kvmSafe('getQuota', this.kvmConnector.getQuota(binding.orchestratorSessionId))
            : Promise.resolve(null),
        ])
      : [null, null, null, null];

    const auditEntries = await this.auditService
      .list(300)
      .then((entries) =>
        entries.filter((entry) => {
          if (binding.orchestratorSessionId && entry.sessionId === binding.orchestratorSessionId) {
            return true;
          }
          if (vmName && entry.targetVmId === vmName) {
            return true;
          }
          return false;
        })
      )
      .catch(() => []);

    const osacTypeCounter = osacMessages.reduce<Record<string, number>>((acc, item) => {
      const key = item.type || 'UNKNOWN';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    const llmTraces = buildLlmTraces({
      sessionId,
      messages: normalizedMessages,
      intent,
      taskDescription,
      executionPlan,
    });

    const kvmSummary: Record<string, unknown> = {
      orchestratorSessionId: binding.orchestratorSessionId || null,
      vmName: vmName || null,
      session: kvmSession,
      sessionVm: kvmSessionVm,
      sandbox: kvmSandbox,
      sandboxIp: kvmSandboxIp,
      sandboxPorts: kvmSandboxPorts,
      vmDetail: kvmVmDetail,
      vmMetrics: kvmVmMetrics,
      vmLogs: kvmVmLogs,
      quota: kvmQuota,
      auditEntries,
      errors: kvmErrors,
    };

    const timeline = buildTimeline({
      messages: normalizedMessages,
      osacMessages,
      kvmSummary,
    });

    const transitions = buildStateTransitions({
      session: safeSession,
      messages: normalizedMessages,
    });

    const messageCounts = normalizedMessages.reduce(
      (acc, msg) => {
        if (msg.role === 'user') acc.user += 1;
        else if (msg.role === 'agent') acc.agent += 1;
        else acc.system += 1;
        return acc;
      },
      { user: 0, agent: 0, system: 0 }
    );

    const lastUser = [...normalizedMessages].reverse().find((m) => m.role === 'user');
    const lastAgent = [...normalizedMessages].reverse().find((m) => m.role === 'agent');
    const lastStatus = [...normalizedMessages].reverse().find((m) => m.messageType === 'status_update');
    const lastOpencode = [...normalizedMessages].reverse().find((m) =>
      (m.messageType || '').startsWith('opencode_')
    );

    console.log(
      '[admin-management][conversation-detail]',
      JSON.stringify({
        sessionId,
        status: safeSession.status,
        stage: safeSession.stage,
        pendingQuestion: summarizeText(safeSession.pendingQuestion, 120) || null,
        pendingResume: safeSession.pendingResume || null,
        runtime: {
          orchestratorSessionId: binding.orchestratorSessionId || null,
          opencodeSessionId: binding.opencodeSessionId || null,
          vmName: vmName || null,
        },
        messageCounts,
        lastUserInput: summarizeText(lastUser?.content, 160) || null,
        lastAgentMessage: summarizeText(lastAgent?.content, 160) || null,
        lastStatusUpdate: lastStatus
          ? {
              content: summarizeText(lastStatus.content, 160),
              stage: (lastStatus as any).stage || toRecord(lastStatus.metadata).stage,
              phase: toRecord(lastStatus.metadata).phase,
              tone: toRecord(lastStatus.metadata).tone,
            }
          : null,
        lastOpencodeEvent: lastOpencode
          ? {
              type: lastOpencode.messageType,
              content: summarizeText(lastOpencode.content, 160),
              orchestratorSessionId: pickString(toRecord(lastOpencode.metadata).orchestratorSessionId),
              opencodeSessionId: pickString(toRecord(lastOpencode.metadata).opencodeSessionId),
            }
          : null,
        transitions: transitions.slice(-30),
        osacSummary: {
          total: osacMessages.length,
          byType: Object.entries(osacTypeCounter).map(([type, count]) => ({ type, count })),
          errors: osacErrors,
        },
        kvmErrors,
      })
    );

    const agentDecisionMessages = normalizedMessages.filter((item) => item.role === 'agent');
    const opencodeMessages = normalizedMessages.filter((item) =>
      ['opencode_event', 'opencode_status', 'opencode_user_input'].includes(item.messageType || '')
    );

    return {
      session: safeSession,
      messages: normalizedMessages,
      intent,
      taskDescription,
      executionPlan,
      runtime: {
        taskSessionId: safeSession.id,
        orchestratorSessionId: binding.orchestratorSessionId || null,
        opencodeSessionId: binding.opencodeSessionId || null,
        vmName: vmName || null,
        bindingUpdatedAt: binding.bindingUpdatedAt || null,
        pendingResume: safeSession.pendingResume || null,
        pendingQuestion: safeSession.pendingQuestion || null,
        pendingOptions: safeSession.pendingOptions || [],
      },
      trace: {
        timeline,
        llm: llmTraces,
        agentDecisions: agentDecisionMessages,
        opencodeMessages,
        stateTransitions: transitions,
        sandbox: {
          primaryEnvironment: environmentByOrchestrator,
          relatedEnvironments,
        },
        kvm: kvmSummary,
        osac: {
          messages: osacMessages,
          summary: {
            total: osacMessages.length,
            byType: Object.entries(osacTypeCounter).map(([type, count]) => ({
              type,
              count,
            })),
          },
          errors: osacErrors,
        },
      },
    };
  }

  summarizeStatus(sessions: TaskCreationSession[]) {
    return {
      total: sessions.length,
      inProgress: sessions.filter((item) => item.status === 'in_progress').length,
      waitingUser: sessions.filter((item) => item.status === 'waiting_user').length,
      completed: sessions.filter((item) => item.status === 'completed').length,
      failed: sessions.filter((item) => item.status === 'failed').length,
    };
  }
}
