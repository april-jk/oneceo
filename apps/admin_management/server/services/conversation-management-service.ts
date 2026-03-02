import type {
  OneceoApiConnector,
  OsacMessageRecord,
  SandboxEnvironmentRecord,
  TaskCreationMessage,
  TaskCreationSession,
} from '../connectors/oneceo-api-connector';
import type { KvmOrchestratorConnector } from '../connectors/kvm-orchestrator-connector';
import type { AuditService } from './audit-service';

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

export class ConversationManagementService {
  constructor(
    private readonly oneceoApi: OneceoApiConnector,
    private readonly kvmConnector: KvmOrchestratorConnector,
    private readonly auditService: AuditService
  ) {}

  async listSessions(limit = 20) {
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
  }

  async getSessionDetail(sessionId: string) {
    const sessionErrors: string[] = [];
    const session = await this.oneceoApi.getTaskCreationSession(sessionId).catch((error) => {
      sessionErrors.push(error instanceof Error ? error.message : String(error));
      return null;
    });

    const sessionMessages = Array.isArray(session?.messages) ? session!.messages : [];

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
      ? await this.kvmConnector
          .getSession(binding.orchestratorSessionId)
          .catch((error) => {
            kvmErrors.push(`getSession: ${error instanceof Error ? error.message : String(error)}`);
            return null;
          })
      : null;

    const kvmSessionVm = binding.orchestratorSessionId
      ? await this.kvmConnector
          .getSessionVm(binding.orchestratorSessionId)
          .catch((error) => {
            kvmErrors.push(`getSessionVm: ${error instanceof Error ? error.message : String(error)}`);
            return null;
          })
      : null;

    const kvmSandbox = binding.orchestratorSessionId
      ? await this.kvmConnector
          .getSandbox(binding.orchestratorSessionId)
          .catch((error) => {
            kvmErrors.push(`getSandbox: ${error instanceof Error ? error.message : String(error)}`);
            return null;
          })
      : null;

    const kvmSandboxIp = binding.orchestratorSessionId
      ? await this.kvmConnector
          .getSandboxIp(binding.orchestratorSessionId, false)
          .catch((error) => {
            kvmErrors.push(`getSandboxIp: ${error instanceof Error ? error.message : String(error)}`);
            return null;
          })
      : null;

    const kvmSandboxPorts = binding.orchestratorSessionId
      ? await this.kvmConnector
          .listSandboxPortMappings(binding.orchestratorSessionId, { refresh: false, verify: false, waitSeconds: 0 })
          .catch((error) => {
            kvmErrors.push(`listSandboxPortMappings: ${error instanceof Error ? error.message : String(error)}`);
            return null;
          })
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
          this.kvmConnector.getVm(vmName).catch((error) => {
            kvmErrors.push(`getVm: ${error instanceof Error ? error.message : String(error)}`);
            return null;
          }),
          this.kvmConnector.getVmMetrics(vmName).catch((error) => {
            kvmErrors.push(`getVmMetrics: ${error instanceof Error ? error.message : String(error)}`);
            return null;
          }),
          this.kvmConnector.getVmLogs(vmName, 200).catch((error) => {
            kvmErrors.push(`getVmLogs: ${error instanceof Error ? error.message : String(error)}`);
            return null;
          }),
          binding.orchestratorSessionId
            ? this.kvmConnector.getQuota(binding.orchestratorSessionId).catch((error) => {
                kvmErrors.push(`getQuota: ${error instanceof Error ? error.message : String(error)}`);
                return null;
              })
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
