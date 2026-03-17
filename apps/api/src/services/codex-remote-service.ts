import { randomUUID } from 'node:crypto';
import type { OsacMessage } from '../clients/osac-client';
import { taskCreationFileMemoryStore, type FileSessionRecord } from '../agents/task-creation/file-memory-store';
import { taskCreationSessionDAO } from '../db/dao';
import { osacAgentService } from './osac-agent-service';
import { osacConnectionManager } from './osac-connection-manager';
import { sandboxAgentProvisionService } from './sandbox-agent-provision-service';
import { touchSandbox } from './sandbox-activity-service';
import { resolveOpencodeWorkspacePath } from '../utils/opencode-workspace';

type CodexDirectInput = {
  taskSessionId: string;
  content: string;
  orchestratorSessionId?: string;
  workspacePath?: string;
  source?: 'user' | 'agent';
  clientMessageKey?: string;
};

type CodexEventListenerPayload = {
  taskSessionId: string;
  message: {
    type: 'executor_event' | 'status_update' | 'agent_message' | 'error';
    content: string;
    metadata: Record<string, unknown>;
    stage?: 'collecting' | 'clarifying' | 'planning' | 'executing' | 'reviewing' | 'completed' | 'failed';
    phase?: 'ideation' | 'analysis' | 'development' | 'testing' | 'repair' | 'delivery';
    tone?: 'system' | 'intent' | 'planning' | 'execution' | 'review' | 'error';
  };
};

type CodexEventListener = (payload: CodexEventListenerPayload) => void | Promise<void>;

type CodexRuntimeBinding = {
  orchestratorSessionId: string;
  executorSessionId?: string;
  generation?: number;
};

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function extractCodexItem(event: Record<string, unknown>): Record<string, unknown> {
  return toRecord(event.item);
}

function compactCodexMetadataText(value: unknown, max = 2000): string | undefined {
  const text = asString(value);
  if (!text) return undefined;
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

function resolveCodexEventText(event: Record<string, unknown>): string {
  const item = extractCodexItem(event);
  return (
    asString(item.text) ||
    asString(item.content) ||
    asString(item.message) ||
    asString(event.text) ||
    asString(event.content) ||
    asString(event.message) ||
    asString(event.status)
  );
}

function summarizeCodexEvent(eventType: string, event: Record<string, unknown>): string {
  const normalized = eventType.trim().toLowerCase();
  const text = resolveCodexEventText(event);

  if (text) {
    return text;
  }
  if (normalized === 'turn.started') return 'Codex 开始执行';
  if (normalized === 'turn.completed') return 'Codex 执行完成';
  if (normalized === 'turn.failed') return 'Codex 执行失败';
  if (normalized === 'turn.interrupted') return 'Codex 执行已中断';
  if (normalized.startsWith('item.')) return `Codex 事件: ${eventType}`;
  return eventType || 'Codex 事件';
}

function buildCodexEventMetadata(event: Record<string, unknown>): Record<string, unknown> {
  const item = extractCodexItem(event);
  const exitCodeValue = item.exit_code;
  const exitCode =
    typeof exitCodeValue === 'number' && Number.isFinite(exitCodeValue)
      ? exitCodeValue
      : typeof exitCodeValue === 'string' && exitCodeValue.trim()
        ? Number(exitCodeValue)
        : undefined;

  return {
    itemId: asString(item.id) || undefined,
    itemType: asString(item.type) || undefined,
    itemStatus: asString(item.status) || undefined,
    itemText: compactCodexMetadataText(item.text ?? item.content ?? item.message),
    command: compactCodexMetadataText(item.command),
    outputPreview: compactCodexMetadataText(item.aggregated_output),
    ...(exitCode !== undefined && Number.isFinite(exitCode) ? { exitCode } : {}),
  };
}

function shouldPersistCodexEvent(eventType: string, event: Record<string, unknown>, content: string): boolean {
  const normalized = eventType.trim().toLowerCase();
  const normalizedContent = content.trim().toLowerCase();
  if (normalized === 'thread.started' || normalized === 'item.started') {
    return false;
  }
  if (normalized === 'item.completed') {
    return Boolean(content.trim()) && normalizedContent !== `codex 事件: ${normalized}`;
  }
  if (normalized === 'turn.completed' && normalizedContent === 'completed') {
    return false;
  }
  if (normalized === 'turn.failed' && normalizedContent === 'failed') {
    return false;
  }
  if (normalized === 'turn.interrupted' && normalizedContent === 'interrupted') {
    return false;
  }
  return true;
}

function mapEventStage(eventType: string): CodexEventListenerPayload['message']['stage'] | undefined {
  const normalized = eventType.trim().toLowerCase();
  if (normalized === 'turn.completed') return 'completed';
  if (normalized === 'turn.failed' || normalized === 'turn.interrupted') return 'failed';
  return 'executing';
}

async function resolveRuntimeBinding(
  taskSessionId: string,
  fallbackOrchestratorSessionId?: string
): Promise<CodexRuntimeBinding | null> {
  const session = await taskCreationFileMemoryStore.getSession(taskSessionId);
  if (!session) return null;

  const runtime = session.runtime || {};
  const orchestratorSessionId = asString(runtime.orchestratorSessionId) || asString(fallbackOrchestratorSessionId);
  if (!orchestratorSessionId) return null;

  return {
    orchestratorSessionId,
    executorSessionId: asString(runtime.executorSessionId) || undefined,
    generation:
      typeof runtime.generation === 'number' && Number.isFinite(runtime.generation) && runtime.generation > 0
        ? Math.floor(runtime.generation)
        : undefined,
  };
}

export class CodexRemoteService {
  private initialized = false;
  private listeners = new Set<CodexEventListener>();

  initialize() {
    if (this.initialized) return;
    this.initialized = true;
    osacConnectionManager.registerMessageHandler(async (orchestratorSessionId, message) => {
      try {
        await this.handleOsacMessage(orchestratorSessionId, message);
      } catch (error) {
        console.warn('[CODEX_REMOTE_HANDLER_ERROR]', orchestratorSessionId, error);
      }
    });
  }

  subscribe(listener: CodexEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async notify(payload: CodexEventListenerPayload) {
    for (const listener of this.listeners) {
      try {
        await listener(payload);
      } catch (error) {
        console.warn('[CODEX_REMOTE_NOTIFY_ERROR]', error);
      }
    }
  }

  private isDirectSession(session: FileSessionRecord | null): boolean {
    return Boolean(session && session.mode === 'sandbox');
  }

  private async resolveTargetSession(
    orchestratorSessionId: string,
    payload: Record<string, unknown>
  ): Promise<FileSessionRecord | null> {
    const executorSessionId = asString(payload.executorSessionId);
    if (executorSessionId) {
      const byExecutor = await taskCreationFileMemoryStore.findSessionByExecutorSessionId(executorSessionId);
      if (byExecutor) {
        return byExecutor;
      }
    }
    return taskCreationFileMemoryStore.findSessionByOrchestratorSessionId(orchestratorSessionId);
  }

  private async persistMessage(
    sessionId: string,
    role: 'user' | 'agent' | 'system',
    messageType: string,
    content: string,
    metadata: Record<string, unknown>
  ) {
    await taskCreationFileMemoryStore.addMessage(sessionId, role, messageType, content, metadata);
    try {
      await taskCreationSessionDAO.addMessage({
        id: randomUUID(),
        sessionId,
        role,
        messageType,
        content,
        metadata,
      });
    } catch (error) {
      console.warn('[CODEX_REMOTE_DB_MESSAGE_FAILED]', { sessionId, messageType, error });
    }
  }

  private async updateRuntimeBinding(
    taskSessionId: string,
    input: { orchestratorSessionId: string; executorSessionId?: string }
  ) {
    await taskCreationFileMemoryStore.updateRuntimeBinding(taskSessionId, {
      orchestratorSessionId: input.orchestratorSessionId,
      executor: 'codex',
      executorSessionId: input.executorSessionId || undefined,
    });
  }

  private async ensureRuntime(taskSessionId: string, title?: string, fallbackOrchestratorSessionId?: string) {
    const provision = await sandboxAgentProvisionService.provisionWithLock({
      executor: 'codex',
      metadata: {
        taskSessionId,
        taskTitle: title || '新建任务会话',
        executor: 'codex',
      },
    });
    const runtime =
      (await resolveRuntimeBinding(taskSessionId, fallbackOrchestratorSessionId || provision.sessionId)) || {
        orchestratorSessionId: provision.sessionId,
      };
    const orchestratorSessionId = runtime.orchestratorSessionId;
    const session = await taskCreationFileMemoryStore.getSession(taskSessionId);
    const workspacePath = resolveOpencodeWorkspacePath(taskSessionId);
    await osacAgentService.ensureExecutorRuntime(orchestratorSessionId, {
      executor: 'codex',
      workspacePath,
    });
    await this.updateRuntimeBinding(taskSessionId, {
      orchestratorSessionId,
      executorSessionId: runtime.executorSessionId,
    });
    return {
      session,
      orchestratorSessionId,
      executorSessionId: runtime.executorSessionId,
      workspacePath,
    };
  }

  async sendUserInput(input: CodexDirectInput): Promise<{
    orchestratorSessionId: string;
    executorSessionId: string;
  }> {
    const taskSessionId = asString(input.taskSessionId);
    const content = String(input.content || '').trim();
    if (!taskSessionId) {
      throw new Error('taskSessionId is required');
    }
    if (!content) {
      throw new Error('content is required');
    }

    const runtime = await this.ensureRuntime(taskSessionId, undefined, input.orchestratorSessionId);
    const currentSession = runtime.session || (await taskCreationFileMemoryStore.getSession(taskSessionId));
    const workspacePath = asString(input.workspacePath) || runtime.workspacePath;

    const accepted = await osacAgentService.sendExecutorInput(runtime.orchestratorSessionId, {
      executor: 'codex',
      executorSessionId: runtime.executorSessionId || undefined,
      workspacePath,
      parts: [{ type: 'text', text: content }],
    });

    if (!accepted.executorSessionId) {
      throw new Error('Codex 未返回 executorSessionId');
    }

    const inputTimestamp = Date.now();
    await this.updateRuntimeBinding(taskSessionId, {
      orchestratorSessionId: accepted.orchestratorSessionId,
      executorSessionId: accepted.executorSessionId,
    });
    await taskCreationFileMemoryStore.updateSessionExecutor(taskSessionId, 'codex');
    await taskCreationFileMemoryStore.updateSessionState(taskSessionId, {
      status: 'in_progress',
      stage: 'executing',
      phase: currentSession?.phase ? (currentSession.phase as any) : 'development',
      allowBackward: true,
    });
    try {
      await taskCreationSessionDAO.updateSessionStatus(taskSessionId, 'in_progress');
    } catch (error) {
      console.warn('[CODEX_REMOTE_STATUS_DB_FAILED]', { taskSessionId, error });
    }

    await this.persistMessage(
      taskSessionId,
      input.source === 'agent' ? 'agent' : 'user',
      input.source === 'agent' ? 'codex_agent_input' : 'codex_user_input',
      content,
      {
        executor: 'codex',
        orchestratorSessionId: accepted.orchestratorSessionId,
        executorSessionId: accepted.executorSessionId,
        opencodeSessionId: accepted.executorSessionId,
        workspacePath,
        timestamp: inputTimestamp,
        sessionEventSeq: inputTimestamp * 1000,
        ...(input.clientMessageKey ? { clientMessageKey: input.clientMessageKey } : {}),
      }
    );

    await touchSandbox(accepted.orchestratorSessionId, 'codex_user_input');

    return {
      orchestratorSessionId: accepted.orchestratorSessionId,
      executorSessionId: accepted.executorSessionId,
    };
  }

  private async handleOsacMessage(orchestratorSessionId: string, message: OsacMessage) {
    if (
      message.type !== 'EXECUTOR_EVENT' &&
      message.type !== 'EXECUTOR_SESSION_READY' &&
      message.type !== 'EXECUTOR_INPUT_ACCEPTED' &&
      message.type !== 'EXECUTOR_ERROR'
    ) {
      return;
    }

    const payload = toRecord(message.payload);
    if (asString(payload.executor).toLowerCase() !== 'codex') {
      return;
    }

    const session = await this.resolveTargetSession(orchestratorSessionId, payload);
    if (!session) return;

    const executorSessionId = asString(payload.executorSessionId) || session.runtime?.executorSessionId || '';
    if (executorSessionId) {
      await this.updateRuntimeBinding(session.id, {
        orchestratorSessionId,
        executorSessionId,
      });
    }

    if (message.type === 'EXECUTOR_SESSION_READY') {
      const content = 'Codex 会话已建立，正在等待执行...';
      const metadata = {
        executor: 'codex',
        orchestratorSessionId,
        executorSessionId: executorSessionId || undefined,
        opencodeSessionId: executorSessionId || undefined,
        workspacePath: asString(payload.workspacePath) || undefined,
      };
      if (!this.isDirectSession(session)) {
        await this.persistMessage(session.id, 'agent', 'status_update', content, metadata);
      }
      await this.notify({
        taskSessionId: session.id,
        message: {
          type: 'status_update',
          content,
          metadata,
          stage: 'executing',
          tone: 'system',
        },
      });
      return;
    }

    if (message.type === 'EXECUTOR_INPUT_ACCEPTED') {
      const content = 'Codex 已接收输入，正在执行...';
      const metadata = {
        executor: 'codex',
        orchestratorSessionId,
        executorSessionId: executorSessionId || undefined,
        opencodeSessionId: executorSessionId || undefined,
        status: asString(payload.status) || 'accepted',
      };
      if (!this.isDirectSession(session)) {
        await this.persistMessage(session.id, 'agent', 'status_update', content, metadata);
      }
      await this.notify({
        taskSessionId: session.id,
        message: {
          type: 'status_update',
          content,
          metadata,
          stage: 'executing',
          tone: 'system',
        },
      });
      return;
    }

    if (message.type === 'EXECUTOR_ERROR') {
      const content = asString(payload.message) || 'Codex 执行失败';
      const metadata = {
        executor: 'codex',
        orchestratorSessionId,
        executorSessionId: executorSessionId || undefined,
        opencodeSessionId: executorSessionId || undefined,
        code: asString(payload.code) || undefined,
        stage: asString(payload.stage) || undefined,
      };
      await taskCreationFileMemoryStore.updateSessionState(session.id, {
        status: 'failed',
        stage: 'failed',
      });
      await this.persistMessage(session.id, 'agent', 'error', content, metadata);
      await this.notify({
        taskSessionId: session.id,
        message: {
          type: 'error',
          content,
          metadata,
          stage: 'failed',
          tone: 'error',
        },
      });
      return;
    }

    const eventType = asString(payload.eventType);
    const event = toRecord(payload.event);
    const content = summarizeCodexEvent(eventType, event);
    const stage = mapEventStage(eventType);
    const metadata = {
      executor: 'codex',
      orchestratorSessionId,
      executorSessionId: executorSessionId || undefined,
      opencodeSessionId: executorSessionId || undefined,
      eventType,
      event,
      timestamp: payload.timestamp,
      seq: payload.seq,
      ...buildCodexEventMetadata(event),
    };

    if (stage === 'completed') {
      await taskCreationFileMemoryStore.updateSessionState(session.id, {
        status: 'completed',
        stage: 'completed',
      });
      try {
        await taskCreationSessionDAO.updateSessionStatus(session.id, 'completed');
      } catch (error) {
        console.warn('[CODEX_REMOTE_STATUS_DB_COMPLETE_FAILED]', { sessionId: session.id, error });
      }
    } else if (stage === 'failed') {
      await taskCreationFileMemoryStore.updateSessionState(session.id, {
        status: 'failed',
        stage: 'failed',
      });
      try {
        await taskCreationSessionDAO.updateSessionStatus(session.id, 'failed');
      } catch (error) {
        console.warn('[CODEX_REMOTE_STATUS_DB_FAILED_FAILED]', { sessionId: session.id, error });
      }
    }

    if (!shouldPersistCodexEvent(eventType, event, content)) {
      return;
    }

    await this.persistMessage(session.id, 'agent', 'executor_event', content, metadata);
    await this.notify({
      taskSessionId: session.id,
      message: {
        type: 'executor_event',
        content,
        metadata,
        stage,
        tone: stage === 'failed' ? 'error' : 'execution',
      },
    });
  }
}

export const codexRemoteService = new CodexRemoteService();
