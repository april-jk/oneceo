import type { OsacMessage } from '../clients/osac-client';
import { taskCreationFileMemoryStore, type FileSessionRecord } from '../agents/task-creation/file-memory-store';
import { osacAgentService } from './osac-agent-service';
import { osacConnectionManager } from './osac-connection-manager';
import { auditOsacAction } from '../utils/osac-audit';
import { resolveOpencodeWorkspacePath } from '../utils/opencode-workspace';
import { ensureDatabaseConnection } from '../config/database';
import { taskCreationSessionDAO } from '../db/dao';
import type { ExecutionPlan, TaskDescription } from '../agents/task-creation/types/intent';
import { executionReviewAgent } from '../agents/task-creation/layers/execution-review-agent';

type OpencodeEventListenerPayload = {
  taskSessionId: string;
  message: {
    type: 'opencode_event' | 'status_update' | 'agent_message' | 'error';
    content: string;
    metadata: Record<string, unknown>;
    stage?: 'collecting' | 'clarifying' | 'planning' | 'executing' | 'reviewing' | 'completed' | 'failed';
    tone?: 'system' | 'intent' | 'planning' | 'execution' | 'review' | 'error';
  };
};

type OpencodeEventListener = (payload: OpencodeEventListenerPayload) => void | Promise<void>;

type RuntimeBinding = {
  orchestratorSessionId: string;
  opencodeSessionId?: string;
};

type OpencodeTextStreamEntry = {
  taskSessionId: string;
  orchestratorSessionId: string;
  opencodeSessionId: string;
  partId: string;
  text: string;
  updatedAt: number;
};

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toPositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
}

function asScalar(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return '';
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function parseStructString(value: string): Record<string, unknown> {
  const text = value.trim();
  if (!text.startsWith('@{') || !text.endsWith('}')) {
    return {};
  }
  const body = text.slice(2, -1);
  const result: Record<string, unknown> = {};
  for (const rawPart of body.split(';')) {
    const part = rawPart.trim();
    if (!part) continue;
    const eqIndex = part.indexOf('=');
    if (eqIndex <= 0) {
      result[part] = true;
      continue;
    }
    const key = part.slice(0, eqIndex).trim();
    const val = part.slice(eqIndex + 1).trim();
    if (!key) continue;
    result[key] = val;
  }
  return result;
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    const parsed = parseStructString(value);
    if (Object.keys(parsed).length > 0) {
      return parsed;
    }
  }
  return {};
}

function normalizeDirectory(value: unknown): string {
  if (typeof value !== 'string') return '';
  let text = value.trim();
  if (!text) return '';
  if (text.startsWith('file://')) {
    try {
      text = new URL(text).pathname || text;
    } catch {
      // ignore parse errors
    }
  }
  return text.replace(/\\/g, '/').replace(/\/+$/, '');
}

function resolveWorkspaceRoot(): string {
  return (process.env.OPENCODE_TASK_WORKSPACE_ROOT || '/opt/.altus/opencode/workspaces')
    .trim()
    .replace(/[\\/]+$/, '');
}

function extractTaskSessionIdFromDirectory(directory: string): string | null {
  const normalized = normalizeDirectory(directory);
  if (!normalized) return null;
  const root = normalizeDirectory(resolveWorkspaceRoot());
  if (!root) return null;
  if (normalized === root) return null;
  if (!normalized.startsWith(root + '/')) return null;
  const rest = normalized.slice(root.length + 1);
  const segment = rest.split('/')[0];
  return segment ? segment.trim() : null;
}

function extractDirectoryFromPayload(payload: Record<string, unknown>, event?: Record<string, unknown>): string {
  const direct =
    normalizeDirectory(payload.directory) ||
    normalizeDirectory((payload as any).worktree) ||
    normalizeDirectory((payload as any).workspacePath);
  if (direct) return direct;

  const eventDir =
    (event && (normalizeDirectory(event.directory) || normalizeDirectory((event as any).workspacePath))) || '';
  if (eventDir) return eventDir;

  const props = normalizeRecord(event?.properties);
  return normalizeDirectory(props.directory) || normalizeDirectory((props as any).workspacePath) || '';
}

function extractPartType(event: Record<string, unknown>): string {
  const properties = normalizeRecord(event.properties);
  const part = normalizeRecord(properties.part);
  return (asString(part.type) || asString(properties.type)).toLowerCase();
}

function resolveStartNewVmSwitch(): boolean | null {
  const raw = String(process.env.OSAC_START_NEW_VM || '').trim();
  if (!raw) return null;
  const normalized = raw.toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return null;
}

function resolveFixedOrchestratorSessionId(): string {
  const startNewVm = resolveStartNewVmSwitch();
  if (startNewVm === true) return '';
  const enabledLegacy = String(process.env.OSAC_USE_FIXED_SANDBOX_SESSION || 'false').trim().toLowerCase() !== 'false';
  const useFixed = startNewVm === false || enabledLegacy;
  if (!useFixed) return '';
  return asString(process.env.OSAC_FIXED_SANDBOX_SESSION_ID);
}

function compact(value: string, maxLen: number = 200): string {
  const text = value.trim().replace(/\s+/g, ' ');
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}...`;
}

function buildTaskDescription(record: any): TaskDescription {
  return {
    title: record?.title || '',
    objective: record?.objective || '',
    scope: record?.scope || '',
    deliverables: Array.isArray(record?.deliverables) ? record.deliverables : [],
    constraints: record?.constraints || [],
    additional_info: record?.additionalInfo || record?.additional_info,
  };
}

function buildExecutionPlan(record: any): ExecutionPlan {
  return {
    project: {
      title: record?.projectTitle || '',
      description: record?.projectDescription || '',
      estimated_total_hours: record?.estimatedTotalHours ?? undefined,
      managers: Array.isArray(record?.managers) ? record.managers : [],
    },
  };
}

function buildExecutionSummary(executionPlan: ExecutionPlan): Record<string, unknown> {
  const project = executionPlan.project || ({} as any);
  return {
    title: project.title,
    description: project.description,
    total_estimated_hours: (project as any).total_estimated_hours ?? project.estimated_total_hours,
    managers: Array.isArray(project.managers)
      ? project.managers.map((manager: any) => ({
          id: manager.id,
          name: manager.name,
          task_count: Array.isArray(manager.tasks) ? manager.tasks.length : 0,
        }))
      : [],
  };
}

function buildReviewFeedbackPrompt(payload: {
  userInput: string;
  taskDescription: TaskDescription;
  executionPlan: ExecutionPlan;
  lastOutput: string;
  feedback: string;
}): string {
  return [
    '你是执行智能体，请基于上一轮执行结果进行修订与完善：',
    `用户需求: ${payload.userInput}`,
    `任务描述: ${JSON.stringify(payload.taskDescription)}`,
    `执行计划摘要: ${JSON.stringify(buildExecutionSummary(payload.executionPlan))}`,
    `上一轮输出: ${payload.lastOutput}`,
    `改进要求: ${payload.feedback}`,
    '要求：',
    '1) 继续命令行模式执行（不要进入交互式界面）。',
    '2) 补齐缺口并输出更新后的交付物说明。',
    '3) 如需生成/修改文件，请直接写入当前工作区并在输出中说明文件路径。',
  ].join('\n');
}

function pickSessionIdFromEvent(event: Record<string, unknown>): string | null {
  const direct = asString(event.sessionID) || asString(event.sessionId);
  if (direct) return direct;

  const stack: unknown[] = [event];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') continue;
    const record = current as Record<string, unknown>;
    const hit = asString(record.sessionID) || asString(record.sessionId);
    if (hit) return hit;
    for (const value of Object.values(record)) {
      if (value && typeof value === 'object') {
        stack.push(value);
      }
    }
  }
  return null;
}

function summarizeOpencodeEvent(eventType: string, payload: Record<string, unknown>): string {
  const event = toRecord(payload.event);
  const properties = normalizeRecord(event.properties);

  if (eventType === 'message.updated') {
    const info = normalizeRecord(properties.info);
    const state = asString(info.state) || asString(info.status) || asString(properties.state) || asString(properties.status);
    const role = asString(info.role) || asString(properties.role);
    if (state || role) {
      return `[Message] ${[role, state].filter(Boolean).join(' · ')}`;
    }
  }

  if (eventType === 'message.part.delta') {
    const delta = asString(properties.delta);
    if (delta) return compact(delta, 320);
  }
  if (eventType === 'message.part.updated') {
    const part = normalizeRecord(properties.part);
    const partType = asString(part.type) || asString(properties.type);
    const partState = asString(part.state) || asString(part.status);

    if (partType === 'tool' || partType === 'tool-call' || partType === 'tool_call') {
      const toolName = asString(part.tool) || asString(part.name) || asString(toRecord(part.call).name) || 'tool';
      const summary = compact(asString(part.summary) || asString(properties.summary), 120);
      const suffix = summary || partState;
      return suffix ? `[Tool] ${toolName} · ${suffix}` : `[Tool] ${toolName}`;
    }
    if (partType === 'text') {
      const text = asString(part.text) || asString(part.content) || asString(properties.text);
      if (text) return compact(text, 320);
      return partState ? `[Text] ${partState}` : '[Text] updated';
    }
    if (partType === 'file') {
      const filePath = asString(part.path) || asString(properties.path);
      return filePath ? `[File] ${filePath}` : '[File] updated';
    }
  }
  if (eventType === 'command.executed') {
    const name = asString(properties.name) || asString(properties.command);
    const args = asString(properties.arguments);
    const output = compact(asString(properties.output) || asString(toRecord(properties.result).output), 140);
    const command = [name, args].filter(Boolean).join(' ');
    if (command && output) return `[Command] ${command} -> ${output}`;
    return command ? `[Command] ${command}` : '[Command] executed';
  }
  if (eventType === 'file.edited') {
    const path = asString(properties.file) || asString(properties.path);
    return path ? `[File] edited ${path}` : '[File] edited';
  }
  if (eventType.startsWith('pty.')) {
    const command = asString(properties.command);
    const cwd = asString(properties.cwd);
    const exitCode = asScalar(properties.exitCode);
    const suffix = [command, cwd ? `cwd=${cwd}` : '', exitCode ? `exit=${exitCode}` : '']
      .filter(Boolean)
      .join(' · ');
    return suffix ? `[PTY] ${suffix}` : `[PTY] ${eventType}`;
  }

  const fallbackText =
    asString(properties.text) ||
    asString(properties.message) ||
    asString((normalizeRecord(properties.part)).text);
  if (fallbackText) return fallbackText;
  return `[OpenCode] ${eventType}`;
}

function detectOpencodeOutcome(
  eventType: string,
  payload: Record<string, unknown>
): 'completed' | 'failed' | null {
  const lowerType = eventType.toLowerCase();
  if (lowerType === 'session.idle') {
    return 'completed';
  }

  const event = toRecord(payload.event);
  const properties = toRecord(event.properties);
  const info = toRecord(properties.info);
  const statusRecord = toRecord(properties.status);
  const infoStatusRecord = toRecord(info.status);

  // 仅在 session 级事件上进行终态判定，避免 message.part.updated 等中间事件提前触发 completed。
  const isSessionScoped = lowerType.startsWith('session.');
  if (!isSessionScoped) {
    return null;
  }

  const states = [
    asString(event.state),
    asString(event.status),
    asString(properties.state),
    asString(properties.status),
    asString(statusRecord.type),
    asString(info.state),
    asString(info.status),
    asString(infoStatusRecord.type),
  ]
    .map((value) => value.toLowerCase())
    .filter(Boolean);

  const failStates = new Set(['failed', 'error', 'cancelled', 'canceled', 'aborted', 'timeout']);
  const doneStates = new Set(['completed', 'done', 'finished', 'success', 'succeeded', 'idle']);

  if (states.some((state) => failStates.has(state))) {
    return 'failed';
  }
  if (states.some((state) => doneStates.has(state))) {
    return 'completed';
  }

  if (/(^|[._-])(failed|error|cancelled|canceled|aborted|timeout)([._-]|$)/.test(lowerType)) {
    return 'failed';
  }
  if (/(^|[._-])(completed|finished|done|succeeded|success|idle)([._-]|$)/.test(lowerType)) {
    return 'completed';
  }

  const finalSignals = [
    event.final,
    event.done,
    event.isFinal,
    properties.final,
    properties.done,
    properties.isFinal,
  ];
  if (finalSignals.some((value) => value === true)) {
    return 'completed';
  }

  return null;
}

async function resolveRuntimeBinding(
  taskSessionId: string,
  fallbackOrchestratorSessionId?: string
): Promise<RuntimeBinding | null> {
  const session = await taskCreationFileMemoryStore.getSession(taskSessionId);
  if (!session) return null;

  const runtime = session.runtime || {};
  const orchestratorFromRuntime = asString(runtime.orchestratorSessionId);
  const opencodeSessionId = asString(runtime.opencodeSessionId) || undefined;

  if (orchestratorFromRuntime) {
    return {
      orchestratorSessionId: orchestratorFromRuntime,
      opencodeSessionId,
    };
  }

  const fallback = asString(fallbackOrchestratorSessionId);
  if (fallback) {
    return {
      orchestratorSessionId: fallback,
      opencodeSessionId,
    };
  }

  const messages = await taskCreationFileMemoryStore.getMessages(taskSessionId);
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const metadata = toRecord(messages[i]?.metadata);
    const orchestratorId = asString(metadata.orchestratorSessionId);
    if (orchestratorId) {
      return {
        orchestratorSessionId: orchestratorId,
        opencodeSessionId,
      };
    }
  }

  const configured = resolveFixedOrchestratorSessionId();
  if (configured) {
    return {
      orchestratorSessionId: configured,
      opencodeSessionId,
    };
  }

  return null;
}

export class OpencodeRemoteService {
  private initialized = false;
  private listeners = new Set<OpencodeEventListener>();
  private textStreams = new Map<string, OpencodeTextStreamEntry>();
  private finalizedRuns = new Set<string>();
  private opencodeLocks = new Map<string, Promise<void>>();

  private buildRunKey(taskSessionId: string, opencodeSessionId: string): string {
    return `${taskSessionId}::${opencodeSessionId}`;
  }

  private buildTextStreamKey(taskSessionId: string, opencodeSessionId: string, partId: string): string {
    return `${taskSessionId}::${opencodeSessionId}::${partId}`;
  }

  private async withOpencodeLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.opencodeLocks.get(key);
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.opencodeLocks.set(key, current);

    if (prev) {
      await prev.catch(() => undefined);
    }

    try {
      return await fn();
    } finally {
      release();
      if (this.opencodeLocks.get(key) === current) {
        this.opencodeLocks.delete(key);
      }
    }
  }

  private extractTextStreamPayload(
    payload: Record<string, unknown>,
    eventType: string
  ): { opencodeSessionId: string; partId: string; text: string; delta: string } | null {
    if (eventType !== 'message.part.updated' && eventType !== 'message.part.delta') {
      return null;
    }

    const event = toRecord(payload.event);
    const properties = normalizeRecord(event.properties);
    const part = normalizeRecord(properties.part);
    const partType = (asString(part.type) || asString(properties.type)).toLowerCase();
    if (partType && partType !== 'text') {
      return null;
    }

    const partId = asString(part.id) || asString(properties.partId) || 'text';

    const opencodeSessionId =
      asString(payload.opencodeSessionId) ||
      asString(part.sessionID) ||
      asString(part.sessionId) ||
      pickSessionIdFromEvent(event) ||
      '';
    if (!opencodeSessionId) {
      return null;
    }

    const delta = asString(properties.delta);
    const text = asString(part.text) || asString(part.content) || asString(properties.text);
    if (!delta && !text) {
      return null;
    }

    return {
      opencodeSessionId,
      partId,
      text,
      delta,
    };
  }

  private upsertTextStream(input: {
    taskSessionId: string;
    orchestratorSessionId: string;
    opencodeSessionId: string;
    partId: string;
    text: string;
    delta: string;
    updatedAt: number;
  }): { streamKey: string; text: string } {
    const streamKey = this.buildTextStreamKey(input.taskSessionId, input.opencodeSessionId, input.partId);
    const previous = this.textStreams.get(streamKey);

    let nextText = input.text;
    if (!nextText && previous) {
      nextText = `${previous.text}${input.delta}`;
    } else if (previous && nextText && nextText.length < previous.text.length) {
      nextText = input.delta ? `${previous.text}${input.delta}` : previous.text;
    }
    if (!nextText && input.delta) {
      nextText = previous ? `${previous.text}${input.delta}` : input.delta;
    }

    const entry: OpencodeTextStreamEntry = {
      taskSessionId: input.taskSessionId,
      orchestratorSessionId: input.orchestratorSessionId,
      opencodeSessionId: input.opencodeSessionId,
      partId: input.partId,
      text: nextText,
      updatedAt: Number.isFinite(input.updatedAt) ? input.updatedAt : Date.now(),
    };
    this.textStreams.set(streamKey, entry);

    return {
      streamKey,
      text: entry.text,
    };
  }

  private clearTextStreams(taskSessionId: string, opencodeSessionId?: string) {
    for (const [key, entry] of this.textStreams.entries()) {
      if (entry.taskSessionId !== taskSessionId) continue;
      if (opencodeSessionId && entry.opencodeSessionId !== opencodeSessionId) continue;
      this.textStreams.delete(key);
    }
  }

  private async flushTextStreams(
    taskSessionId: string,
    orchestratorSessionId: string,
    opencodeSessionId?: string
  ): Promise<string | null> {
    const matched: OpencodeTextStreamEntry[] = [];
    for (const [key, entry] of this.textStreams.entries()) {
      if (entry.taskSessionId !== taskSessionId) continue;
      if (opencodeSessionId && entry.opencodeSessionId !== opencodeSessionId) continue;
      matched.push(entry);
      this.textStreams.delete(key);
    }
    if (matched.length === 0) {
      return null;
    }

    matched.sort((a, b) => a.updatedAt - b.updatedAt);
    const latest = matched[matched.length - 1];
    const content = latest.text.trim();
    if (!content) {
      return null;
    }

    const metadata: Record<string, unknown> = {
      orchestratorSessionId,
      opencodeSessionId: latest.opencodeSessionId || opencodeSessionId || undefined,
      eventType: 'message.final',
      stream: false,
      source: 'stream_aggregate',
      rawPayload: {
        eventType: 'message.final',
        text: content,
        source: 'stream_aggregate',
      },
    };

    await taskCreationFileMemoryStore.addMessage(
      taskSessionId,
      'agent',
      'opencode_event',
      content,
      metadata
    );

    await this.notify({
      taskSessionId,
      message: {
        type: 'opencode_event',
        content,
        metadata,
      },
    });
    return content;
  }

  private async resolveTargetSession(
    orchestratorSessionId: string,
    payload: Record<string, unknown>,
    event?: Record<string, unknown>,
    options?: { requireOpencodeSessionId?: boolean }
  ): Promise<FileSessionRecord | null> {
    const opencodeSessionId =
      asString(payload.opencodeSessionId) ||
      (event ? pickSessionIdFromEvent(event) : '') ||
      '';

    if (opencodeSessionId) {
      const byOpencode = await taskCreationFileMemoryStore.findSessionByOpencodeSessionId(opencodeSessionId);
      if (byOpencode) {
        return byOpencode;
      }
    }

    const directory = extractDirectoryFromPayload(payload, event);
    if (directory) {
      const sessionIdFromDir = extractTaskSessionIdFromDirectory(directory);
      if (sessionIdFromDir) {
        const byDir = await taskCreationFileMemoryStore.getSession(sessionIdFromDir);
        if (byDir) {
          return byDir;
        }
      }
    }

    if (options?.requireOpencodeSessionId) {
      return null;
    }

    return taskCreationFileMemoryStore.findSessionByOrchestratorSessionId(orchestratorSessionId);
  }

  private async resolveReviewContext(taskSessionId: string): Promise<{
    userInput: string;
    taskDescription: TaskDescription;
    executionPlan: ExecutionPlan;
  } | null> {
    await ensureDatabaseConnection({ retries: 3, delayMs: 1200 });
    const [messages, taskDescriptionRecord, executionPlanRecord] = await Promise.all([
      taskCreationSessionDAO.getMessages(taskSessionId),
      taskCreationSessionDAO.getTaskDescription(taskSessionId),
      taskCreationSessionDAO.getExecutionPlan(taskSessionId),
    ]);

    if (!taskDescriptionRecord || !executionPlanRecord) {
      return null;
    }

    const firstUserInput =
      messages.find((m) => m.messageType === 'user_input')?.content?.trim() || '';
    const userResponses = messages
      .filter((m) => m.messageType === 'user_response')
      .map((m) => (m.content || '').trim())
      .filter(Boolean);

    const userInput = userResponses.length
      ? `${firstUserInput}\n\n用户补充信息：\n${userResponses.map((text, idx) => `补充${idx + 1}: ${text}`).join('\n')}`
      : firstUserInput;

    return {
      userInput: userInput || firstUserInput || '',
      taskDescription: buildTaskDescription(taskDescriptionRecord),
      executionPlan: buildExecutionPlan(executionPlanRecord),
    };
  }

  private async resolveLatestOutput(taskSessionId: string): Promise<string> {
    const messages = await taskCreationFileMemoryStore.getMessages(taskSessionId);
    if (!messages.length) return '';

    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (message.messageType !== 'opencode_event') continue;
      const metadata = toRecord(message.metadata);
      const eventType =
        asString(metadata.eventType) ||
        asString(toRecord(metadata.rawPayload).eventType) ||
        asString(toRecord(toRecord(metadata.rawPayload).event).type);
      if (eventType === 'message.final' || metadata.source === 'stream_aggregate') {
        return String(message.content || '').trim();
      }
    }

    const last = [...messages].reverse().find((m) => m.messageType === 'opencode_event');
    return String(last?.content || '').trim();
  }

  private async runReviewGate(params: {
    session: FileSessionRecord;
    orchestratorSessionId: string;
    opencodeSessionId?: string;
    executionOutput: string;
  }): Promise<
    | { status: 'skipped'; reason: string }
    | { status: 'error'; message: string }
    | { status: 'pass'; summary: string; issues: string[] }
    | { status: 'retry'; summary: string; issues: string[]; nextInstructions: string }
  > {
    try {
      const context = await this.resolveReviewContext(params.session.id);
      if (!context) {
        return { status: 'skipped', reason: '缺少任务描述或执行计划，跳过自动审查' };
      }

      const review = await executionReviewAgent.review({
        userInput: context.userInput || '（未提供用户输入）',
        taskDescription: context.taskDescription,
        executionPlan: context.executionPlan,
        executionOutput: params.executionOutput || '（无输出）',
      });

      if (review.done || !review.next_instructions) {
        return {
          status: 'pass',
          summary: review.summary || '执行结果已通过审查',
          issues: review.issues || [],
        };
      }

      return {
        status: 'retry',
        summary: review.summary || '执行结果未通过审查',
        issues: review.issues || [],
        nextInstructions: review.next_instructions,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { status: 'error', message };
    }
  }

  initialize() {
    if (this.initialized) return;
    this.initialized = true;

    osacConnectionManager.registerMessageHandler(async (orchestratorSessionId, message) => {
      await this.handleOsacMessage(orchestratorSessionId, message);
    });
  }

  async ingestExternalMessage(orchestratorSessionId: string, message: OsacMessage) {
    await this.handleOsacMessage(orchestratorSessionId, message);
  }

  subscribe(listener: OpencodeEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async notify(payload: OpencodeEventListenerPayload) {
    for (const listener of this.listeners) {
      try {
        await listener(payload);
      } catch (error) {
        console.warn('[OPENCODE_REMOTE_NOTIFY_ERROR]', error);
      }
    }
  }

  async sendUserInput(input: {
    taskSessionId: string;
    content: string;
    orchestratorSessionId?: string;
    workspacePath?: string;
    source?: 'user' | 'agent';
  }): Promise<{ orchestratorSessionId: string; opencodeSessionId: string }> {
    const taskSessionId = asString(input.taskSessionId);
    const content = String(input.content || '').trim();
    if (!taskSessionId) {
      throw new Error('taskSessionId is required');
    }
    if (!content) {
      throw new Error('content is required');
    }

    const runtime = await resolveRuntimeBinding(taskSessionId, input.orchestratorSessionId);
    if (!runtime) {
      throw new Error('当前任务尚未绑定执行环境（orchestratorSessionId）');
    }
    const orchestratorSessionId = runtime.orchestratorSessionId;
    const workspacePath = asString(input.workspacePath) || resolveOpencodeWorkspacePath(taskSessionId);
    const opencodeHost = asString(process.env.OPENCODE_SERVER_HOST) || undefined;
    const opencodePort = toPositiveInt(process.env.OPENCODE_SERVER_PORT);

    return await this.withOpencodeLock(orchestratorSessionId, async () => {
      await osacConnectionManager.ensurePersistent(orchestratorSessionId);
      await osacAgentService.ensureOpencodeServer(orchestratorSessionId, {
        workspacePath: workspacePath || undefined,
        host: opencodeHost,
        port: opencodePort,
      });

      let opencodeSessionId = runtime.opencodeSessionId;
      if (!opencodeSessionId) {
        const created = await osacAgentService.createOpencodeSession(orchestratorSessionId, {
          workspacePath: workspacePath || undefined,
        });
        opencodeSessionId = asString(created.opencodeSessionId);
        if (!opencodeSessionId) {
          throw new Error('创建 OpenCode 会话失败：缺少 opencodeSessionId');
        }
        await taskCreationFileMemoryStore.updateRuntimeBinding(taskSessionId, {
          orchestratorSessionId,
          opencodeSessionId,
        });
      } else {
        await taskCreationFileMemoryStore.updateRuntimeBinding(taskSessionId, {
          orchestratorSessionId,
        });
      }

      await osacAgentService.sendOpencodePrompt(orchestratorSessionId, {
        opencodeSessionId,
        workspacePath: workspacePath || undefined,
        parts: [{ type: 'text', text: content }],
      });

      const role = input.source === 'agent' ? 'agent' : 'user';
      const messageType = input.source === 'agent' ? 'opencode_agent_input' : 'opencode_user_input';
      await taskCreationFileMemoryStore.addMessage(
        taskSessionId,
        role,
        messageType,
        content,
        {
          orchestratorSessionId,
          opencodeSessionId,
          workspacePath,
        }
      );

      auditOsacAction('OPENCODE_USER_INPUT', {
        taskSessionId,
        orchestratorSessionId,
        opencodeSessionId,
      });

      return {
        orchestratorSessionId,
        opencodeSessionId,
      };
    });
  }

  private async handleOsacMessage(orchestratorSessionId: string, message: OsacMessage) {
    if (
      message.type !== 'OPENCODE_EVENT' &&
      message.type !== 'OPENCODE_ERROR' &&
      message.type !== 'OPENCODE_PROMPT_ACCEPTED' &&
      message.type !== 'OPENCODE_SESSION_READY'
    ) {
      return;
    }

    const payload = toRecord(message.payload);
    const event = toRecord(payload.event);
    const session = await this.resolveTargetSession(orchestratorSessionId, payload, event, {
      requireOpencodeSessionId: message.type === 'OPENCODE_EVENT',
    });
    if (!session) {
      return;
    }

    if (message.type === 'OPENCODE_SESSION_READY') {
      const opencodeSessionId = asString(payload.opencodeSessionId);
      if (opencodeSessionId) {
        await taskCreationFileMemoryStore.updateRuntimeBinding(session.id, {
          orchestratorSessionId,
          opencodeSessionId,
        });

        await taskCreationFileMemoryStore.updateSessionStatus(session.id, 'in_progress');
        await taskCreationFileMemoryStore.updateSessionStage(session.id, 'executing');

        const content = 'OpenCode 会话已建立，正在等待执行事件...';
        await taskCreationFileMemoryStore.addMessage(
          session.id,
          'agent',
          'opencode_status',
          content,
          {
            orchestratorSessionId,
            opencodeSessionId,
          }
        );

        await this.notify({
          taskSessionId: session.id,
          message: {
            type: 'status_update',
            content,
            metadata: {
              orchestratorSessionId,
              opencodeSessionId,
            },
          },
        });
      }
      return;
    }

    if (message.type === 'OPENCODE_PROMPT_ACCEPTED') {
      const opencodeSessionId = asString(payload.opencodeSessionId) || session.runtime?.opencodeSessionId || '';
      if (opencodeSessionId) {
        await taskCreationFileMemoryStore.updateRuntimeBinding(session.id, {
          orchestratorSessionId,
          opencodeSessionId,
        });
        this.clearTextStreams(session.id, opencodeSessionId);
        this.finalizedRuns.delete(this.buildRunKey(session.id, opencodeSessionId));
      }
      await taskCreationFileMemoryStore.updateSessionStatus(session.id, 'in_progress');
      await taskCreationFileMemoryStore.updateSessionStage(session.id, 'executing');

      const content = 'OpenCode 已接收指令，正在执行并回传实时事件...';
      await taskCreationFileMemoryStore.addMessage(
        session.id,
        'agent',
        'opencode_status',
        content,
        {
          ...payload,
          orchestratorSessionId,
          opencodeSessionId: opencodeSessionId || undefined,
        }
      );

      await this.notify({
        taskSessionId: session.id,
        message: {
          type: 'status_update',
          content,
          metadata: {
            ...payload,
            orchestratorSessionId,
            opencodeSessionId: opencodeSessionId || undefined,
          },
        },
      });
      return;
    }

    if (message.type === 'OPENCODE_ERROR') {
      const content = asString(payload.message) || 'OpenCode 远程执行失败';
      const opencodeSessionId = asString(payload.opencodeSessionId) || session.runtime?.opencodeSessionId;
      await this.flushTextStreams(session.id, orchestratorSessionId, opencodeSessionId || undefined);

      await taskCreationFileMemoryStore.addMessage(
        session.id,
        'agent',
        'opencode_status',
        content,
        {
          ...payload,
          orchestratorSessionId,
          opencodeSessionId: opencodeSessionId || undefined,
        }
      );

      await this.notify({
        taskSessionId: session.id,
        message: {
          type: 'error',
          content,
          metadata: {
            ...payload,
            orchestratorSessionId,
            opencodeSessionId: opencodeSessionId || undefined,
          },
        },
      });
      return;
    }

    const eventType = asString(payload.eventType) || asString((toRecord(payload.event)).type) || 'unknown';
    const opencodeSessionId =
      asString(payload.opencodeSessionId) ||
      pickSessionIdFromEvent(event) ||
      session.runtime?.opencodeSessionId ||
      '';
    const eventProps = normalizeRecord(event.properties);
    const partRecord = normalizeRecord(eventProps.part);
    const partType = extractPartType(event);
    const toolName = asString(partRecord.tool).toLowerCase();

    const outcome = detectOpencodeOutcome(eventType, payload);

    const textStream = this.extractTextStreamPayload(payload, eventType);
    if (textStream) {
      const stream = this.upsertTextStream({
        taskSessionId: session.id,
        orchestratorSessionId,
        opencodeSessionId: textStream.opencodeSessionId,
        partId: textStream.partId,
        text: textStream.text,
        delta: textStream.delta,
        updatedAt: Number(payload.timestamp) || Date.now(),
      });

      const metadata: Record<string, unknown> = {
        orchestratorSessionId,
        opencodeSessionId: textStream.opencodeSessionId,
        eventType,
        seq: payload.seq,
        timestamp: payload.timestamp,
        event,
        rawPayload: payload,
        stream: true,
        streamKey: stream.streamKey,
        partId: textStream.partId,
      };

      await this.notify({
        taskSessionId: session.id,
        message: {
          type: 'opencode_event',
          content: stream.text,
          metadata,
        },
      });
      return;
    }

    const summary = summarizeOpencodeEvent(eventType, payload);

    const isPartUpdate =
      (eventType === 'message.part.updated' || eventType === 'message.part.delta') && partType;
    const isNonTextPartUpdate =
      isPartUpdate && partType === 'tool' && (!toolName || toolName !== 'todoread');

    const shouldPersist =
      eventType === 'message.final' ||
      eventType === 'command.executed' ||
      eventType === 'file.edited' ||
      eventType === 'file.watcher.updated' ||
      eventType === 'todo.updated' ||
      eventType === 'session.diff' ||
      eventType === 'session.error' ||
      eventType.startsWith('pty.') ||
      isNonTextPartUpdate ||
      summary.startsWith('[Tool]') ||
      summary.startsWith('[Command]') ||
      summary.startsWith('[File]') ||
      summary.startsWith('[PTY]');

    if (opencodeSessionId) {
      await taskCreationFileMemoryStore.updateRuntimeBinding(session.id, {
        orchestratorSessionId,
        opencodeSessionId,
      });
    }

    const metadata: Record<string, unknown> = {
      orchestratorSessionId,
      opencodeSessionId: opencodeSessionId || undefined,
      eventType,
      seq: payload.seq,
      timestamp: payload.timestamp,
      event,
      rawPayload: payload,
    };

    if (shouldPersist) {
      await taskCreationFileMemoryStore.addMessage(
        session.id,
        'agent',
        'opencode_event',
        summary,
        metadata
      );

      await this.notify({
        taskSessionId: session.id,
        message: {
          type: 'opencode_event',
          content: summary,
          metadata,
        },
      });
    }

    if (outcome === 'completed' && session.stage !== 'completed') {
      const runOpencodeSessionId = opencodeSessionId || session.runtime?.opencodeSessionId || 'unknown';
      const runKey = this.buildRunKey(session.id, runOpencodeSessionId);
      if (this.finalizedRuns.has(runKey)) {
        return;
      }
      this.finalizedRuns.add(runKey);

      const aggregated = await this.flushTextStreams(session.id, orchestratorSessionId, opencodeSessionId || undefined);

      await taskCreationFileMemoryStore.updateSessionStatus(session.id, 'in_progress');
      await taskCreationFileMemoryStore.updateSessionStage(session.id, 'reviewing');

      const reviewingContent = 'OpenCode 执行完成，正在进行结果审查...';
      await taskCreationFileMemoryStore.addMessage(session.id, 'agent', 'opencode_status', reviewingContent, {
        ...metadata,
        outcome,
        stage: 'reviewing',
      });

      await this.notify({
        taskSessionId: session.id,
        message: {
          type: 'status_update',
          content: reviewingContent,
          stage: 'reviewing',
          tone: 'review',
          metadata: {
            ...metadata,
            outcome,
          },
        },
      });

      const lastOutput = aggregated || (await this.resolveLatestOutput(session.id));
      const reviewResult = await this.runReviewGate({
        session,
        orchestratorSessionId,
        opencodeSessionId: opencodeSessionId || undefined,
        executionOutput: lastOutput || '（无输出）',
      });

      if (reviewResult.status === 'retry') {
        const context = await this.resolveReviewContext(session.id);
        const feedbackPrompt =
          context && reviewResult.nextInstructions
            ? buildReviewFeedbackPrompt({
                userInput: context.userInput || '（未提供用户输入）',
                taskDescription: context.taskDescription,
                executionPlan: context.executionPlan,
                lastOutput: lastOutput || '（无输出）',
                feedback: reviewResult.nextInstructions,
              })
            : '';

        await taskCreationFileMemoryStore.updateSessionStatus(session.id, 'in_progress');
        await taskCreationFileMemoryStore.updateSessionStage(session.id, 'executing');

        const retryContent = reviewResult.summary || '执行结果未通过审查，正在根据反馈继续执行...';
        await taskCreationFileMemoryStore.addMessage(session.id, 'agent', 'agent_message', retryContent, {
          reviewDone: false,
          reviewIssues: reviewResult.issues,
        });

        await this.notify({
          taskSessionId: session.id,
          message: {
            type: 'agent_message',
            content: retryContent,
            metadata: {
              reviewDone: false,
              reviewIssues: reviewResult.issues,
            },
          },
        });

        if (feedbackPrompt) {
          await this.sendUserInput({
            taskSessionId: session.id,
            content: feedbackPrompt,
            orchestratorSessionId,
            workspacePath: resolveOpencodeWorkspacePath(session.id) || undefined,
            source: 'agent',
          });
        }
        return;
      }

      if (reviewResult.status === 'pass') {
        await taskCreationFileMemoryStore.addMessage(session.id, 'agent', 'agent_message', reviewResult.summary, {
          reviewDone: true,
          reviewIssues: reviewResult.issues,
        });
      } else if (reviewResult.status === 'skipped') {
        await taskCreationFileMemoryStore.addMessage(
          session.id,
          'agent',
          'agent_message',
          reviewResult.reason,
          {
            reviewDone: true,
            reviewSkipped: true,
          }
        );
      } else if (reviewResult.status === 'error') {
        await taskCreationFileMemoryStore.addMessage(
          session.id,
          'agent',
          'agent_message',
          `审查失败：${reviewResult.message}`,
          {
            reviewDone: true,
            reviewError: reviewResult.message,
          }
        );
      }

      await taskCreationFileMemoryStore.updateSessionStatus(session.id, 'completed');
      await taskCreationFileMemoryStore.updateSessionStage(session.id, 'completed');

      const content = 'OpenCode 执行完成';
      await taskCreationFileMemoryStore.addMessage(
        session.id,
        'agent',
        'opencode_status',
        content,
        {
          ...metadata,
          outcome,
        }
      );

      await this.notify({
        taskSessionId: session.id,
        message: {
          type: 'status_update',
          content,
          stage: 'completed',
          tone: 'execution',
          metadata: {
            ...metadata,
            outcome,
          },
        },
      });
    } else if (outcome === 'failed' && session.stage !== 'failed') {
      const runOpencodeSessionId = opencodeSessionId || session.runtime?.opencodeSessionId || 'unknown';
      const runKey = this.buildRunKey(session.id, runOpencodeSessionId);
      if (this.finalizedRuns.has(runKey)) {
        return;
      }
      this.finalizedRuns.add(runKey);

      await this.flushTextStreams(session.id, orchestratorSessionId, opencodeSessionId || undefined);
      await taskCreationFileMemoryStore.updateSessionStatus(session.id, 'failed');
      await taskCreationFileMemoryStore.updateSessionStage(session.id, 'failed');

      const content = 'OpenCode 执行失败，请查看上方事件详情';
      await taskCreationFileMemoryStore.addMessage(
        session.id,
        'agent',
        'opencode_status',
        content,
        {
          ...metadata,
          outcome,
        }
      );

      await this.notify({
        taskSessionId: session.id,
        message: {
          type: 'error',
          content,
          metadata: {
            ...metadata,
            outcome,
          },
        },
      });
    }
  }
}

export const opencodeRemoteService = new OpencodeRemoteService();
// Ensure OSAC handlers are registered even when WebSocket service isn't initialized yet.
opencodeRemoteService.initialize();
