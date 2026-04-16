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

function formatStateSnapshot(snapshot?: { status?: string; stage?: string; phase?: string }) {
  const status = snapshot?.status || '-';
  const stage = snapshot?.stage || '-';
  const phase = snapshot?.phase || '-';
  return `status=${status} stage=${stage} phase=${phase}`;
}

function parseBracketPrefix(content: string | undefined): { prefix?: string; detail?: string } {
  if (!content) return {};
  const matched = content.match(/^\[(.+?)\]\s*(.*)$/);
  if (!matched) return {};
  const prefix = matched[1]?.trim();
  const detail = matched[2]?.trim();
  return {
    prefix: prefix || undefined,
    detail: detail || undefined,
  };
}

function extractToolName(metadata: Record<string, unknown>): string | undefined {
  const event = toRecord(metadata.event);
  const properties = toRecord(event.properties);
  const part = toRecord(properties.part);
  return pickString(part.tool);
}

function inferExecutionDetail(input: {
  message: TaskCreationMessage;
  metadata: Record<string, unknown>;
  opencodeDetail?: string;
  prefix?: { prefix?: string; detail?: string };
}): TraceEvent['execution'] | undefined {
  const content = input.message.content || '';
  const contentLower = content.toLowerCase();
  const messageType = (input.message.messageType || '').toLowerCase();
  const eventType = pickString(input.metadata.eventType, toRecord(input.metadata.event).type);
  const toolName = extractToolName(input.metadata);

  if (toolName) {
    if (toolName.toLowerCase().includes('playwright')) {
      return {
        component: 'Playwright-MCP',
        action: toolName,
        detail: input.opencodeDetail,
      };
    }
    return {
      component: 'OpenCode',
      action: toolName,
      detail: input.opencodeDetail,
    };
  }

  if (messageType.startsWith('opencode_') || eventType) {
    return {
      component: 'OpenCode',
      action: eventType || messageType,
      detail: input.opencodeDetail,
    };
  }

  if (input.metadata.osacCommand) {
    return {
      component: 'OSAC',
      action: 'command',
      detail: summarizeText(String(input.metadata.osacCommand), 160),
    };
  }

  if (input.metadata.osacEndpoint || input.metadata.osacHost || input.metadata.osacConnectionMode) {
    const mode = pickString(input.metadata.osacConnectionMode);
    return {
      component: 'Sandbox',
      action: 'provision',
      detail: mode ? `mode=${mode}` : undefined,
    };
  }

  if (contentLower.includes('playwright')) {
    return {
      component: 'Playwright-MCP',
      action: 'run',
      detail: summarizeText(content, 160),
    };
  }

  if (contentLower.includes('n.eko') || contentLower.includes('neko')) {
    return {
      component: 'n.eko',
      action: 'debug',
      detail: summarizeText(content, 160),
    };
  }

  if (contentLower.includes('sandbox')) {
    return {
      component: 'Sandbox',
      action: 'lifecycle',
      detail: summarizeText(content, 160),
    };
  }

  if (contentLower.includes('osac')) {
    return {
      component: 'OSAC',
      action: 'execute',
      detail: summarizeText(content, 160),
    };
  }

  if (input.prefix?.prefix && ['tool', 'opencode'].includes(input.prefix.prefix.toLowerCase())) {
    return {
      component: 'OpenCode',
      action: input.prefix.detail || input.prefix.prefix,
      detail: summarizeText(content, 160),
    };
  }

  return undefined;
}

function summarizeDiff(diff: Array<Record<string, unknown>>): string {
  if (!diff.length) {
    return 'diff: 无变更';
  }
  const summaryItems = diff.slice(0, 4).map((item) => {
    const status = pickString(item.status, item.changeType, item.type) || 'modified';
    const file = pickString(item.file, item.path, item.name) || 'unknown';
    const additions = typeof item.additions === 'number' ? item.additions : undefined;
    const deletions = typeof item.deletions === 'number' ? item.deletions : undefined;
    if (additions !== undefined || deletions !== undefined) {
      return `${status} ${file} (+${additions ?? 0}/-${deletions ?? 0})`;
    }
    return `${status} ${file}`;
  });
  const more = diff.length > 4 ? `... 另有 ${diff.length - 4} 项` : '';
  return `diff: ${diff.length} 项, ${summaryItems.join(' | ')}${more ? `, ${more}` : ''}`;
}

function summarizeOpencodeEvent(metadata: Record<string, unknown>, content: string | undefined): string | undefined {
  const eventType = pickString(metadata.eventType, toRecord(metadata.event).type);
  const properties = toRecord(toRecord(metadata.event).properties);
  const prefix = parseBracketPrefix(content);

  if (eventType === 'session.diff') {
    const diff = Array.isArray(properties.diff) ? (properties.diff as Array<Record<string, unknown>>) : [];
    return summarizeDiff(diff);
  }

  if (eventType === 'file.edited' || eventType === 'file.created' || eventType === 'file.deleted') {
    const path = pickString(properties.path, properties.file, properties.name);
    return path ? `文件: ${path}` : undefined;
  }

  if (eventType === 'message.part.updated') {
    const part = toRecord(properties.part);
    const partType = pickString(part.type);
    if (partType === 'tool') {
      const toolName = pickString(part.tool, prefix.detail) || 'tool';
      const toolId = pickString(part.id);
      return `Tool: ${toolName}${toolId ? ` (id=${toolId})` : ''}`;
    }
    if (partType === 'text') {
      const text = pickString(part.text, part.content);
      return text ? `Text: ${summarizeText(text, 160)}` : undefined;
    }
  }

  if (eventType === 'todo.updated') {
    const todoList = Array.isArray(properties.todos) ? properties.todos : null;
    if (todoList) {
      return `Todo 更新: ${todoList.length} 项`;
    }
  }

  const fallback = pickString(prefix.detail, eventType);
  if (fallback) {
    return fallback;
  }

  return undefined;
}

function normalizeDecisionLayer(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `L${value}`;
  }
  if (typeof value === 'string' && value.trim()) {
    const raw = value.trim();
    if (/^L?\d+$/.test(raw)) {
      return raw.startsWith('L') ? raw : `L${raw}`;
    }
    return raw;
  }
  return undefined;
}

function mapAgentToDecisionLayer(input: {
  agent?: string;
  tone?: string;
  messageType?: string;
  metadata?: Record<string, unknown>;
}): string | undefined {
  const agent = (input.agent || '').toLowerCase();
  const tone = (input.tone || '').toLowerCase();
  const messageType = (input.messageType || '').toLowerCase();
  const metadata = input.metadata || {};

  if (agent.includes('intent')) return 'L1';
  if (agent.includes('planning')) return 'L2';
  if (agent.includes('execution_plan')) return 'L3';
  if (agent.includes('execution_review')) return 'L3';

  if (tone === 'intent') return 'L1';
  if (tone === 'planning') return 'L2';
  if (tone === 'execution' && agent.includes('execution_plan')) return 'L3';
  if (tone === 'review') return 'L3';

  if (messageType === 'plan_generated') return 'L3';

  return undefined;
}

function inferDecisionLayer(agentLabel: string | undefined): string | undefined {
  if (!agentLabel) return undefined;
  const normalized = agentLabel.toLowerCase();
  if (normalized.includes('intent')) return 'L1';
  if (normalized.includes('planning')) return 'L2';
  if (normalized.includes('execution_plan')) return 'L3';
  if (normalized.includes('review')) return 'L3';
  return undefined;
}

function resolveDecisionName(input: {
  agent?: string;
  tone?: string;
  messageType?: string;
}): string | undefined {
  const agent = (input.agent || '').toLowerCase();
  const tone = (input.tone || '').toLowerCase();
  const messageType = (input.messageType || '').toLowerCase();

  if (agent.includes('intent')) return 'IntentRecognitionAgent';
  if (agent.includes('planning')) return 'PlanningAgent';
  if (agent.includes('execution_plan')) return 'ExecutionPlanAgent';
  if (agent.includes('execution_review')) return 'executionReviewAgent';

  if (tone === 'intent') return 'IntentRecognitionAgent';
  if (tone === 'planning') return 'PlanningAgent';
  if (tone === 'review') return 'executionReviewAgent';

  if (messageType === 'plan_generated') return 'ExecutionPlanAgent';

  return undefined;
}

function extractDecisionInfo(message: TaskCreationMessage): TraceEvent['decision'] | undefined {
  const metadata = toRecord(message.metadata);
  const layer = normalizeDecisionLayer(
    metadata.decisionLayer ?? metadata.layer ?? metadata.depth ?? metadata.agentDepth ?? metadata.managerDepth
  );
  const source = pickString(metadata.agent, metadata.manager, metadata.controller, metadata.owner);
  const inferredLayer =
    layer ||
    mapAgentToDecisionLayer({
      agent: source,
      tone: pickString(metadata.tone),
      messageType: message.messageType,
      metadata,
    }) ||
    inferDecisionLayer(source);
  const decisionType = pickString(metadata.decisionType, metadata.policy, message.messageType);
  const name = resolveDecisionName({
    agent: source,
    tone: pickString(metadata.tone),
    messageType: message.messageType,
  });

  if (!inferredLayer && !source && !decisionType && !name) {
    return undefined;
  }

  return {
    layer: inferredLayer,
    source,
    type: decisionType,
    name,
  };
}

function decisionMetaForTrace(stage: LlmTrace['stage']): { layer: string; name: string; type: string } {
  switch (stage) {
    case 'intent_recognition':
      return { layer: 'L1', name: 'IntentRecognitionAgent', type: 'intent_recognition' };
    case 'planning':
      return { layer: 'L2', name: 'PlanningAgent', type: 'planning' };
    case 'execution_plan':
      return { layer: 'L3', name: 'ExecutionPlanAgent', type: 'execution_plan' };
    case 'opencode_command':
      return { layer: 'L3', name: 'OpencodeRemoteService', type: 'opencode_command' };
    case 'execution_review':
      return { layer: 'L3', name: 'executionReviewAgent', type: 'execution_review' };
    default:
      return { layer: 'L?', name: 'unknown', type: stage };
  }
}

function summarizeDecisionOutput(stage: LlmTrace['stage'], response: Record<string, unknown>): string | undefined {
  if (stage === 'intent_recognition') {
    const intent = pickString(response.intentType, response.intent_type) || 'unknown';
    const confidence = response.confidence !== undefined ? `confidence=${response.confidence}` : '';
    return `intent=${intent}${confidence ? ` ${confidence}` : ''}`;
  }
  if (stage === 'planning') {
    const title = pickString(response.title);
    const objective = pickString(response.objective);
    return [title ? `title=${title}` : '', objective ? `objective=${summarizeText(objective, 80)}` : '']
      .filter(Boolean)
      .join(' ');
  }
  if (stage === 'execution_plan') {
    const project = toRecord(response.project);
    const title = pickString(project.title);
    const managers = Array.isArray(project.managers) ? project.managers.length : undefined;
    const summary = [
      title ? `project=${title}` : '',
      managers !== undefined ? `managers=${managers}` : '',
    ]
      .filter(Boolean)
      .join(' ');
    return summary || undefined;
  }
  if (stage === 'execution_review') {
    const summary = pickString(response.summary);
    const done = response.done !== undefined ? `done=${String(response.done)}` : '';
    const issues = Array.isArray(response.issues) ? `issues=${response.issues.length}` : '';
    return [done, issues, summary ? `summary=${summarizeText(summary, 120)}` : ''].filter(Boolean).join(' ');
  }
  if (stage === 'opencode_command') {
    const accepted = response.accepted !== undefined ? `accepted=${String(response.accepted)}` : '';
    const message = pickString(response.message);
    return [accepted, message ? `message=${summarizeText(message, 120)}` : ''].filter(Boolean).join(' ') || undefined;
  }
  return undefined;
}

function summarizeDecisionInput(stage: LlmTrace['stage'], request: Record<string, unknown>): string | undefined {
  if (stage === 'intent_recognition') {
    const userInput = pickString(request.userInput);
    return userInput ? `userInput=${summarizeText(userInput, 120)}` : undefined;
  }
  if (stage === 'planning') {
    const userInput = pickString(request.userInput);
    const intent = toRecord(request.intent);
    const intentType = pickString(intent.intentType, intent.intent_type);
    return [intentType ? `intent=${intentType}` : '', userInput ? `userInput=${summarizeText(userInput, 120)}` : '']
      .filter(Boolean)
      .join(' ');
  }
  if (stage === 'execution_plan') {
    const taskDescription = toRecord(request.taskDescription);
    const title = pickString(taskDescription.title);
    return title ? `task=${title}` : undefined;
  }
  if (stage === 'execution_review') {
    const template = pickString(request.promptTemplate);
    return template ? `prompt=${template}` : undefined;
  }
  if (stage === 'opencode_command') {
    const command = pickString(request.command);
    return command ? `command=${summarizeText(command, 120)}` : undefined;
  }
  return undefined;
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

  if (!orchestratorSessionId) {
    const env = input.relatedEnvironments.find((item) => !!item.sessionId || !!item.orchestratorSessionId) || null;
    orchestratorSessionId = pickString(env?.sessionId, env?.orchestratorSessionId);
    bindingUpdatedAt = bindingUpdatedAt || parseTimestamp(env?.updatedAt);
  }

  if (!opencodeSessionId) {
    const env = orchestratorSessionId
      ? input.relatedEnvironments.find((item) => item.sessionId === orchestratorSessionId) || null
      : input.relatedEnvironments[0] || null;
    const metadata = toRecord(env?.metadata);
    opencodeSessionId = pickString(metadata.opencodeSessionId, metadata.opencode_session_id);
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
  transitions: StateTransition[];
  llmTraces: LlmTrace[];
}): TraceEvent[] {
  const events: Array<TraceEvent & { order: number; timeMs: number }> = [];
  let order = 0;

  const sortedMessages = [...input.messages].sort((a, b) => {
    const aTime = Date.parse(a.createdAt || '') || 0;
    const bTime = Date.parse(b.createdAt || '') || 0;
    return aTime - bTime;
  });

  const messageIndex = new Map<string, number>();
  sortedMessages.forEach((message, index) => {
    if (message.id) {
      messageIndex.set(message.id, index);
    }
  });

  for (const message of sortedMessages) {
    const metadata = toRecord(message.metadata);
    const category = message.messageType || 'message';
    const timestamp = parseTimestamp(message.createdAt);
    const timeMs = timestamp ? Date.parse(timestamp) : Number.MAX_SAFE_INTEGER;
    const prefix = parseBracketPrefix(message.content);
    const decision = extractDecisionInfo(message);
    const opencodeDetail =
      category.startsWith('opencode_') || category === 'opencode_event'
        ? summarizeOpencodeEvent(metadata, message.content)
        : undefined;
    const contentDetail = opencodeDetail || summarizeText(message.content, 220) || undefined;
    const badge =
      prefix.prefix || prefix.detail
        ? `${prefix.prefix || 'Info'}${prefix.detail ? `: ${prefix.detail}` : ''}`
        : undefined;
    const executionDetail = inferExecutionDetail({
      message,
      metadata,
      opencodeDetail,
      prefix,
    });
    events.push({
      id: `msg-${message.id}`,
      timestamp,
      source: normalizeMessageSource(message.role),
      category,
      title: prefix.detail
        ? `${prefix.detail}`
        : prefix.prefix
          ? `${prefix.prefix}`
          : `${message.role} · ${category}`,
      content: contentDetail,
      badge: executionDetail?.component ? `执行层: ${executionDetail.component}` : badge,
      rawContent: message.content,
      level: getEventLevel({ category, content: message.content }),
      metadata,
      decision,
      execution: executionDetail,
      order: order++,
      timeMs,
    });
  }

  for (const trace of input.llmTraces) {
    const meta = decisionMetaForTrace(trace.stage);
    const summaryOutput = summarizeDecisionOutput(trace.stage, trace.response);
    const summaryInput = summarizeDecisionInput(trace.stage, trace.request);
    const timestamp = parseTimestamp(trace.createdAt);
    const timeMs = timestamp ? Date.parse(timestamp) : Number.MAX_SAFE_INTEGER;
    const contentParts = [
      summaryInput ? `输入: ${summaryInput}` : '',
      summaryOutput ? `输出: ${summaryOutput}` : '',
    ].filter(Boolean);

    events.push({
      id: `llm-${trace.id}`,
      timestamp,
      source: trace.source === 'opencode' ? 'agent' : 'agent',
      category: 'decision',
      title: `决策 ${meta.layer} · ${meta.name}`,
      content: contentParts.join(' | '),
      badge: `决策 ${meta.layer}`,
      level: 'info',
      metadata: {
        request: trace.request,
        response: trace.response,
        inferred: trace.inferred,
        stage: trace.stage,
        source: trace.source,
      },
      decision: {
        layer: meta.layer,
        source: trace.source,
        type: meta.type,
        name: meta.name,
      },
      decisionInput: trace.request,
      decisionOutput: trace.response,
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
      badge: `执行层: OSAC`,
      level: getEventLevel({ category: message.type, content: summary }),
      metadata: payload,
      execution: {
        component: 'OSAC',
        action: message.type,
        detail: summary || undefined,
      },
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
      badge: 'KVM',
      level: 'info',
      metadata: input.kvmSummary,
      order: order++,
      timeMs: parseTimestamp(toRecord(input.kvmSummary.session).updatedAt)
        ? Date.parse(String(toRecord(input.kvmSummary.session).updatedAt))
        : Number.MAX_SAFE_INTEGER,
    });
  }

  for (const transition of input.transitions) {
    const triggerIndex = transition.trigger?.messageId ? messageIndex.get(transition.trigger.messageId) : undefined;
    const triggerMessage = typeof triggerIndex === 'number' ? sortedMessages[triggerIndex] : undefined;
    const previousMessage = typeof triggerIndex === 'number' && triggerIndex > 0 ? sortedMessages[triggerIndex - 1] : undefined;
    const transitionTimestamp =
      transition.at ||
      (triggerMessage?.createdAt ? parseTimestamp(triggerMessage.createdAt) : undefined) ||
      (previousMessage?.createdAt ? parseTimestamp(previousMessage.createdAt) : undefined);
    const level = (() => {
      const status = (transition.to.status || '').toLowerCase();
      if (status.includes('failed')) return 'error';
      if (status.includes('waiting')) return 'warn';
      return 'info';
    })();
    const triggerSummary = triggerMessage ? summarizeText(triggerMessage.content, 220) : undefined;
    const previousSummary = previousMessage ? summarizeText(previousMessage.content, 220) : undefined;
    const contentParts = [
      `状态: ${formatStateSnapshot(transition.from)} → ${formatStateSnapshot(transition.to)}`,
      triggerSummary ? `触发消息: ${triggerSummary}` : '',
      previousSummary ? `前置消息: ${previousSummary}` : '',
    ].filter(Boolean);

    events.push({
      id: `state-${transition.at || transition.trigger?.messageId || Math.random().toString(36).slice(2)}`,
      timestamp: transitionTimestamp,
      source: 'system',
      category: 'state_transition',
      title: `状态流转 ${transition.from.stage || '-'} → ${transition.to.stage || '-'}`,
      content: contentParts.join(' | '),
      badge: '状态机',
      level,
      context: {
        trigger: triggerMessage
          ? {
              id: triggerMessage.id,
              role: triggerMessage.role,
              messageType: triggerMessage.messageType,
              content: triggerMessage.content,
              createdAt: triggerMessage.createdAt,
            }
          : undefined,
        previous: previousMessage
          ? {
              id: previousMessage.id,
              role: previousMessage.role,
              messageType: previousMessage.messageType,
              content: previousMessage.content,
              createdAt: previousMessage.createdAt,
            }
          : undefined,
      },
      metadata: {
        transition,
      },
      order: order++,
      timeMs: transitionTimestamp ? Date.parse(transitionTimestamp) : Number.MAX_SAFE_INTEGER,
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
    const sessions = await this.oneceoApi.listTaskCreationSessions(limit);
    const normalized = sessions.map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      stage: item.stage,
      executor: item.runtime?.executor || (item.runtime?.opencodeSessionId ? 'opencode' : null),
      pendingQuestion: item.pendingQuestion,
      pendingOptions: item.pendingOptions,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      user: item.user || null,
    }));

    return {
      total: normalized.length,
      sessions: normalized,
    };
  }

  async getSessionCore(sessionId: string) {
    const sessionErrors: string[] = [];
    let session = await this.oneceoApi.getTaskCreationSession(sessionId).catch((error) => {
      sessionErrors.push(error instanceof Error ? error.message : String(error));
      return null;
    });

    const sessionMessages = Array.isArray(session?.messages) ? session!.messages : [];

    const [messages, intent, taskDescription, executionPlan, preciseSandbox] = await Promise.all([
      sessionMessages.length > 0
        ? Promise.resolve(sessionMessages)
        : this.oneceoApi.getTaskCreationMessages(sessionId).catch(() => []),
      this.oneceoApi.getTaskCreationIntent(sessionId).catch(() => null),
      this.oneceoApi.getTaskCreationTaskDescription(sessionId).catch(() => null),
      this.oneceoApi.getTaskCreationExecutionPlan(sessionId).catch(() => null),
      this.oneceoApi.getTaskSessionSandboxEnvironments(sessionId).catch((error) => {
        sessionErrors.push(`getTaskSessionSandboxEnvironments: ${error instanceof Error ? error.message : String(error)}`);
        return {
          taskSessionId: sessionId,
          binding: null,
          primaryEnvironment: null,
          relatedEnvironments: [] as SandboxEnvironmentRecord[],
        };
      }),
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
    const relatedEnvironments = Array.isArray(preciseSandbox.relatedEnvironments)
      ? preciseSandbox.relatedEnvironments
      : [];
    const binding = extractRuntimeBinding({
      session: safeSession,
      messages: normalizedMessages,
      relatedEnvironments,
    });

    const llmTraces = buildLlmTraces({
      sessionId,
      messages: normalizedMessages,
      intent,
      taskDescription,
      executionPlan,
    });

    const transitions = buildStateTransitions({
      session: safeSession,
      messages: normalizedMessages,
    });

    const kvmSummary: Record<string, unknown> = {
      orchestratorSessionId: binding.orchestratorSessionId || null,
      vmName: binding.vmName || null,
      session: null,
      sessionVm: null,
      sandbox: preciseSandbox.primaryEnvironment || null,
      sandboxIp: null,
      sandboxPorts: null,
      vmDetail: null,
      vmMetrics: null,
      vmLogs: null,
      quota: null,
      auditEntries: [],
      errors: sessionErrors,
    };

    const timeline = buildTimeline({
      messages: normalizedMessages,
      osacMessages: [],
      kvmSummary,
      transitions,
      llmTraces,
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
        vmName: binding.vmName || null,
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
          binding: preciseSandbox.binding || null,
          primaryEnvironment: preciseSandbox.primaryEnvironment || relatedEnvironments[0] || null,
          relatedEnvironments,
        },
        kvm: kvmSummary,
        osac: {
          messages: [],
          summary: {
            total: 0,
            byType: [],
          },
          errors: [],
        },
      },
    };
  }

  async getSessionInfra(sessionId: string) {
    const detail = await this.getSessionDetail(sessionId);
    return {
      sessionId: detail.session.id,
      runtime: detail.runtime,
      trace: {
        sandbox: detail.trace?.sandbox,
        kvm: detail.trace?.kvm,
        osac: detail.trace?.osac,
      },
    };
  }

  async getSessionDetail(sessionId: string) {
    const sessionErrors: string[] = [];
    let session = await this.oneceoApi.getTaskCreationSession(sessionId).catch((error) => {
      sessionErrors.push(error instanceof Error ? error.message : String(error));
      return null;
    });

    const sessionMessages = Array.isArray(session?.messages) ? session!.messages : [];

    const [messages, intent, taskDescription, executionPlan, preciseSandbox] = await Promise.all([
      sessionMessages.length > 0
        ? Promise.resolve(sessionMessages)
        : this.oneceoApi.getTaskCreationMessages(sessionId).catch(() => []),
      this.oneceoApi.getTaskCreationIntent(sessionId).catch(() => null),
      this.oneceoApi.getTaskCreationTaskDescription(sessionId).catch(() => null),
      this.oneceoApi.getTaskCreationExecutionPlan(sessionId).catch(() => null),
      this.oneceoApi.getTaskSessionSandboxEnvironments(sessionId).catch((error) => {
        sessionErrors.push(`getTaskSessionSandboxEnvironments: ${error instanceof Error ? error.message : String(error)}`);
        return {
          taskSessionId: sessionId,
          binding: null,
          primaryEnvironment: null,
          relatedEnvironments: [] as SandboxEnvironmentRecord[],
        };
      }),
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
    const relatedEnvironments = Array.isArray(preciseSandbox.relatedEnvironments)
      ? preciseSandbox.relatedEnvironments
      : [];

    const binding = extractRuntimeBinding({
      session: safeSession,
      messages: normalizedMessages,
      relatedEnvironments,
    });

    const environmentByOrchestrator = preciseSandbox.primaryEnvironment || (binding.orchestratorSessionId
      ? relatedEnvironments.find((item) => item.sessionId === binding.orchestratorSessionId) || null
      : relatedEnvironments[0] || null);

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

    const [kvmSession, kvmSessionVm, kvmSandbox, kvmSandboxIp, kvmSandboxPorts] = binding.orchestratorSessionId
      ? await Promise.all([
          kvmSafe('getSession', this.kvmConnector.getSession(binding.orchestratorSessionId)),
          kvmSafe('getSessionVm', this.kvmConnector.getSessionVm(binding.orchestratorSessionId)),
          kvmSafe('getSandbox', this.kvmConnector.getSandbox(binding.orchestratorSessionId)),
          kvmSafe('getSandboxIp', this.kvmConnector.getSandboxIp(binding.orchestratorSessionId, false)),
          kvmSafe(
            'listSandboxPortMappings',
            this.kvmConnector.listSandboxPortMappings(binding.orchestratorSessionId, {
              refresh: false,
              verify: false,
              waitSeconds: 0,
            })
          ),
        ])
      : [null, null, null, null, null];

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

    const transitions = buildStateTransitions({
      session: safeSession,
      messages: normalizedMessages,
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
      transitions,
      llmTraces,
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
          binding: preciseSandbox.binding || null,
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
