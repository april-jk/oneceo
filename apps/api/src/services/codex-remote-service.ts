import { randomUUID } from 'node:crypto';
import type { OsacMessage } from '../clients/osac-client';
import { taskCreationFileMemoryStore, type FileSessionRecord } from '../agents/task-creation/file-memory-store';
import { sandboxExecutionEnvironmentDAO, taskCreationSessionDAO } from '../db/dao';
import { e2bConnector } from '../connectors/e2b-connector';
import { osacAgentService } from './osac-agent-service';
import { osacConnectionManager } from './osac-connection-manager';
import { sandboxAgentProvisionService } from './sandbox-agent-provision-service';
import { archiveSandboxWorkspace } from './sandbox-archive-service';
import { setSandboxMetadata, touchSandbox } from './sandbox-activity-service';
import { resolveCodexArchiveDotCodexPath, resolveOpencodeWorkspacePath } from '../utils/opencode-workspace';
import { buildTimelineMessageKey, normalizeMessageTimelineMetadata } from '../utils/task-message-identity';
import { codexAppServerService } from './codex-app-server-service';
import { codexAppServerTurnService } from './codex-app-server-turn-service';
import { codexRuntimeConfigService } from './codex-runtime-config-service';
import {
  extractAppServerErrorMessage,
  extractAppServerTurnStatus,
  buildCodexAppServerMetadata,
  buildNotificationIdentity,
  extractNotificationItemType,
  summarizeCodexAppServerNotification,
  type CodexAppServerNotification,
} from './codex-app-server-protocol';

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
  codexBinaryPath?: string;
  previousExecutorSessionId?: string;
  codexRestoreStatus?: 'not_needed' | 'session_restored' | 'session_restore_failed' | 'state_restore_failed';
  codexRestoreAt?: string;
  codexRestoreSourceKey?: string;
  codexRestoreFailureReason?: string;
  generation?: number;
};

function preferCodexAppServer(): boolean {
  return String(process.env.CODEX_TRANSPORT_MODE || 'osac')
    .trim()
    .toLowerCase() === 'app_server';
}

function resolveCodexAppServerWaitTimeoutMs(): number {
  const configured = Number(process.env.CODEX_APP_SERVER_TURN_TIMEOUT_MS || '');
  if (Number.isFinite(configured) && configured > 0) {
    return Math.max(60_000, Math.floor(configured));
  }
  return 10 * 60_000;
}

function resolveCodexTransportMode(session: FileSessionRecord | null | undefined): 'sdk' | 'app_server' {
  const runtimeTransport = asString(session?.runtime?.transport).toLowerCase();
  if (runtimeTransport === 'app_server') return 'app_server';
  if (runtimeTransport === 'sdk') return 'sdk';
  const codexExecutionMode = asString((session as any)?.codexExecutionMode).toLowerCase();
  if (codexExecutionMode === 'ws') return 'app_server';
  if (codexExecutionMode === 'sdk') return 'sdk';
  return preferCodexAppServer() ? 'app_server' : 'sdk';
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asRawString(value: unknown): string {
  return typeof value === 'string' ? value : '';
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
  const fileChanges = Array.isArray(item.changes)
    ? item.changes
        .map((change) => toRecord(change))
        .filter((change) => Object.keys(change).length > 0)
        .map((change) => ({
          kind: asString(change.kind) || undefined,
          path: asString(change.path) || undefined,
        }))
        .filter((change) => change.kind || change.path)
    : [];
  const filePaths = fileChanges
    .map((change) => change.path)
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
  const approvalOptions = Array.isArray(item.options)
    ? item.options.map((option) => asString(option)).filter(Boolean)
    : [];
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
    toolName: compactCodexMetadataText(item.tool ?? item.name),
    command: compactCodexMetadataText(item.command),
    outputPreview: compactCodexMetadataText(item.aggregated_output),
    approvalText: compactCodexMetadataText(item.prompt ?? item.instructions ?? item.question),
    ...(approvalOptions.length > 0 ? { approvalOptions } : {}),
    ...(fileChanges.length > 0
      ? {
          fileChanges,
          filePaths,
        }
      : {}),
    ...(exitCode !== undefined && Number.isFinite(exitCode) ? { exitCode } : {}),
  };
}

function shouldPersistCodexEvent(eventType: string, event: Record<string, unknown>, content: string): boolean {
  const normalized = eventType.trim().toLowerCase();
  const normalizedContent = content.trim().toLowerCase();
  const item = extractCodexItem(event);
  const itemType = asString(item.type).toLowerCase();
  if (normalized === 'thread.started' || normalized === 'item.started') {
    return false;
  }
  if (normalized === 'stderr.line' || normalized === 'stdout.line') {
    return false;
  }
  if (normalized === 'item.completed') {
    if (itemType === 'command_execution') {
      return true;
    }
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

function mapAppServerStage(notification: CodexAppServerNotification): CodexEventListenerPayload['message']['stage'] | undefined {
  const method = notification.method;
  if (method === 'turn/completed') {
    const turnStatus = (extractAppServerTurnStatus(notification) || '').toLowerCase();
    if (turnStatus === 'failed') return 'failed';
    if (turnStatus === 'completed') return 'completed';
    return 'executing';
  }
  if (method === 'error') return 'failed';
  return 'executing';
}

function shouldPersistAppServerNotification(notification: CodexAppServerNotification): boolean {
  const method = notification.method;
  const itemType = (extractNotificationItemType(notification) || '').toLowerCase();
  const turnStatus = (extractAppServerTurnStatus(notification) || '').toLowerCase();
  const errorMessage = extractAppServerErrorMessage(notification);
  if (method === 'thread/started') return false;
  if (method === 'item/started') return false;
  if (method === 'item/agentMessage/delta') return false;
  if (method === 'item/reasoning/summaryPartAdded') return false;
  if (method === 'item/reasoning/summaryTextDelta') return false;
  if (method.startsWith('item/reasoning/') && method !== 'item/reasoning/summary') return false;
  if (method === 'account/rateLimits/updated') return false;
  if (method === 'thread/tokenUsage/updated') return false;
  if (method === 'thread/status/changed') return false;
  if (method.startsWith('codex/event/')) return false;
  if (method === 'item/fileChange/outputDelta') return false;
  if (method === 'turn/completed' && turnStatus === 'failed' && errorMessage) return false;
  if (method === 'item/completed' && (itemType === 'usermessage' || itemType === 'reasoning')) {
    return false;
  }
  return true;
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
    previousExecutorSessionId: asString(runtime.previousExecutorSessionId) || undefined,
    codexRestoreStatus:
      (asString(runtime.codexRestoreStatus) as CodexRuntimeBinding['codexRestoreStatus']) || undefined,
    codexRestoreAt: asString(runtime.codexRestoreAt) || undefined,
    codexRestoreSourceKey: asString(runtime.codexRestoreSourceKey) || undefined,
    codexRestoreFailureReason: asString(runtime.codexRestoreFailureReason) || undefined,
    generation:
      typeof runtime.generation === 'number' && Number.isFinite(runtime.generation) && runtime.generation > 0
        ? Math.floor(runtime.generation)
        : undefined,
  };
}

export class CodexRemoteService {
  private initialized = false;
  private listeners = new Set<CodexEventListener>();
  private appServerJobs = new Map<
    string,
    {
      jobId: string;
      orchestratorSessionId: string;
      executorSessionId: string;
      notificationOffset: number;
      pollTimer: NodeJS.Timeout | null;
      polling: boolean;
      stopped: boolean;
      reasoningSummaries: Map<string, string>;
    }
  >();

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

  private prepareTimelineMetadata(
    messageType: string,
    metadataInput: Record<string, unknown>,
    options?: { createdAt?: string; seed?: number }
  ): Record<string, unknown> {
    const createdAt = options?.createdAt || new Date().toISOString();
    const metadata = normalizeMessageTimelineMetadata(metadataInput, createdAt, options?.seed || 0);
    return {
      ...metadata,
      timelineCursor: metadata.timelineCursor ?? metadata.sessionEventSeq ?? metadata.timestamp,
      messageKey: buildTimelineMessageKey({
        messageType,
        metadata,
        createdAt,
      }),
    };
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
    metadata: Record<string, unknown>,
    options?: { createdAt?: string; seed?: number }
  ): Promise<Record<string, unknown>> {
    const preparedMetadata = this.prepareTimelineMetadata(messageType, metadata, options);
    await taskCreationFileMemoryStore.addMessage(sessionId, role, messageType, content, preparedMetadata);
    try {
      await taskCreationSessionDAO.addMessage({
        id: randomUUID(),
        sessionId,
        role,
        messageType,
        content,
        metadata: preparedMetadata,
        ...(options?.createdAt ? { createdAt: new Date(options.createdAt) } : {}),
      });
    } catch (error) {
      console.warn('[CODEX_REMOTE_DB_MESSAGE_FAILED]', { sessionId, messageType, error });
    }
    return preparedMetadata;
  }

  private async updateRuntimeBinding(
    taskSessionId: string,
    input: {
      orchestratorSessionId: string;
      transport?: 'sdk' | 'app_server';
      executorSessionId?: string;
      previousExecutorSessionId?: string;
      codexRestoreStatus?: 'not_needed' | 'session_restored' | 'session_restore_failed' | 'state_restore_failed';
      codexRestoreAt?: string;
      codexRestoreSourceKey?: string;
      codexRestoreFailureReason?: string;
    }
  ) {
    await taskCreationFileMemoryStore.updateRuntimeBinding(taskSessionId, {
      orchestratorSessionId: input.orchestratorSessionId,
      executor: 'codex',
      transport: input.transport,
      executorSessionId: input.executorSessionId || undefined,
      previousExecutorSessionId: input.previousExecutorSessionId || undefined,
      codexRestoreStatus: input.codexRestoreStatus,
      codexRestoreAt: input.codexRestoreAt,
      codexRestoreSourceKey: input.codexRestoreSourceKey,
      codexRestoreFailureReason: input.codexRestoreFailureReason,
    });
  }

  private async updateRestoreMetadata(
    orchestratorSessionId: string,
    input: {
      codexRestoreStatus: 'not_needed' | 'session_restored' | 'session_restore_failed' | 'state_restore_failed';
      codexRestoreAt?: string;
      codexRestoreSourceKey?: string;
      previousExecutorSessionId?: string;
      codexRestoreFailureReason?: string;
    }
  ) {
    await setSandboxMetadata(orchestratorSessionId, {
      codexRestoreStatus: input.codexRestoreStatus,
      codexRestoreAt: input.codexRestoreAt || new Date().toISOString(),
      codexRestoreSourceKey: input.codexRestoreSourceKey || undefined,
      previousExecutorSessionId: input.previousExecutorSessionId || undefined,
      codexRestoreFailureReason: input.codexRestoreFailureReason || undefined,
    });
  }

  private async updateActiveExecutorMetadata(
    orchestratorSessionId: string,
    input: {
      executorSessionId?: string;
      eventType?: string;
      turnCompletedAt?: string;
    }
  ) {
    await setSandboxMetadata(orchestratorSessionId, {
      codexActiveExecutorSessionId: input.executorSessionId || undefined,
      lastExecutorSessionId: input.executorSessionId || undefined,
      codexLastEventType: input.eventType || undefined,
      codexLastTurnCompletedAt: input.turnCompletedAt || undefined,
      codexStateSyncRequired: input.executorSessionId ? true : undefined,
    });
  }

  private async emitRestoreStatus(
    taskSessionId: string,
    payload: {
      orchestratorSessionId: string;
      executorSessionId?: string;
      content: string;
      stage?: 'executing' | 'failed';
      tone?: 'system' | 'error';
      codexRestoreStatus: 'session_restored' | 'session_restore_failed' | 'state_restore_failed';
      codexRestoreAt: string;
      codexRestoreSourceKey?: string;
      previousExecutorSessionId?: string;
      codexRestoreFailureReason?: string;
    }
  ) {
    const metadata = this.prepareTimelineMetadata(
      payload.tone === 'error' ? 'error' : 'status_update',
      {
        executor: 'codex',
        orchestratorSessionId: payload.orchestratorSessionId,
        executorSessionId: payload.executorSessionId || undefined,
        opencodeSessionId: payload.executorSessionId || undefined,
        codexRestoreStatus: payload.codexRestoreStatus,
        codexRestoreAt: payload.codexRestoreAt,
        codexRestoreSourceKey: payload.codexRestoreSourceKey || undefined,
        previousExecutorSessionId: payload.previousExecutorSessionId || undefined,
        codexRestoreFailureReason: payload.codexRestoreFailureReason || undefined,
      }
    );
    await this.persistMessage(
      taskSessionId,
      'agent',
      payload.tone === 'error' ? 'error' : 'status_update',
      payload.content,
      metadata
    );
    await this.notify({
      taskSessionId,
      message: {
        type: payload.tone === 'error' ? 'error' : 'status_update',
        content: payload.content,
        metadata,
        stage: payload.stage,
        tone: payload.tone,
      },
    });
  }

  private async hasCodexSessionState(
    orchestratorSessionId: string,
    taskSessionId: string,
    executorSessionId: string,
    metadata?: Record<string, unknown>
  ): Promise<boolean> {
    const codexDotCodexPath =
      asString(metadata?.codexDotCodexPath) || resolveCodexArchiveDotCodexPath(taskSessionId);
    if (!codexDotCodexPath || !executorSessionId) {
      return false;
    }
    const command = `
set -euo pipefail
state_dir=${JSON.stringify(`${codexDotCodexPath.replace(/\/+$/, '')}/sessions`)}
target=${JSON.stringify(executorSessionId)}
if [ ! -d "$state_dir" ]; then
  exit 0
fi
match="$(find "$state_dir" -type f -name "*$target*.jsonl" -print -quit 2>/dev/null || true)"
if [ -n "$match" ]; then
  printf 'found'
  exit 0
fi
fallback="$(find "$state_dir" -type f -name '*.jsonl' -print -quit 2>/dev/null || true)"
if [ -n "$fallback" ]; then
  printf 'fallback'
fi
`;
    try {
      const result: any = await e2bConnector.runCommand(orchestratorSessionId, command, {
        timeoutMs: 20_000,
      });
      const output = asString(result?.stdout || result?.output);
      return output === 'found' || output === 'fallback';
    } catch {
      return false;
    }
  }

  private async ensureRuntime(taskSessionId: string, title?: string, fallbackOrchestratorSessionId?: string) {
    const currentSession = await taskCreationFileMemoryStore.getSession(taskSessionId);
    const previousRuntime = currentSession?.runtime || {};
    const previousOrchestratorSessionId = asString(previousRuntime.orchestratorSessionId);
    const previousRestoreStatus = asString(previousRuntime.codexRestoreStatus).toLowerCase();
    const previousExecutorSessionId =
      asString(previousRuntime.previousExecutorSessionId) || asString(previousRuntime.executorSessionId);
    const provision = await sandboxAgentProvisionService.provisionWithLock({
      executor: 'codex',
      metadata: {
        taskSessionId,
        taskTitle: title || '待识别任务',
        executor: 'codex',
      },
    });
    const orchestratorSessionId = provision.sessionId;
    const environment = await sandboxExecutionEnvironmentDAO.getBySessionId(orchestratorSessionId);
    const envMetadata = toRecord(environment?.metadata);
    const restoreSourceKey = asString(envMetadata.r2RestoreSourceKey) || asString(envMetadata.r2ArchiveKey) || undefined;
    const workspacePath = resolveOpencodeWorkspacePath(taskSessionId);
    await osacAgentService.ensureExecutorRuntime(orchestratorSessionId, {
      executor: 'codex',
      workspacePath,
    });
    let activeExecutorSessionId =
      asString(previousRuntime.executorSessionId) ||
      asString(previousRuntime.previousExecutorSessionId) ||
      undefined;
    const isRecoveredSandboxGeneration =
      Boolean(previousExecutorSessionId) &&
      (Boolean(previousOrchestratorSessionId && previousOrchestratorSessionId !== orchestratorSessionId) ||
        asString(envMetadata.restoreStatus).toLowerCase() === 'restored');
    const stateRestored =
      asString(envMetadata.restoreStatus).toLowerCase() === 'restored' ||
      (previousExecutorSessionId
        ? await this.hasCodexSessionState(
            orchestratorSessionId,
            taskSessionId,
            previousExecutorSessionId,
            envMetadata
          )
        : false);

    if (isRecoveredSandboxGeneration && !stateRestored) {
      const restoreAt = new Date().toISOString();
      const reason = '未找到 Codex 会话状态归档，无法恢复原上下文';
      await this.updateRuntimeBinding(taskSessionId, {
        orchestratorSessionId,
        executorSessionId: '',
        previousExecutorSessionId,
        codexRestoreStatus: 'state_restore_failed',
        codexRestoreAt: restoreAt,
        codexRestoreSourceKey: restoreSourceKey,
        codexRestoreFailureReason: reason,
      });
      await this.updateRestoreMetadata(orchestratorSessionId, {
        codexRestoreStatus: 'state_restore_failed',
        codexRestoreAt: restoreAt,
        codexRestoreSourceKey: restoreSourceKey,
        previousExecutorSessionId,
        codexRestoreFailureReason: reason,
      });
      await this.emitRestoreStatus(taskSessionId, {
        orchestratorSessionId,
        content: reason,
        stage: 'failed',
        tone: 'error',
        codexRestoreStatus: 'state_restore_failed',
        codexRestoreAt: restoreAt,
        codexRestoreSourceKey: restoreSourceKey,
        previousExecutorSessionId,
        codexRestoreFailureReason: reason,
      });
      throw new Error(reason);
    }

    if (stateRestored && previousExecutorSessionId && previousRestoreStatus !== 'session_restored') {
      const restoreAt = new Date().toISOString();
      try {
        const resumed = await osacAgentService.resumeExecutorSession(orchestratorSessionId, {
          executor: 'codex',
          executorSessionId: previousExecutorSessionId,
          workspacePath,
        });
        activeExecutorSessionId = resumed.executorSessionId || previousExecutorSessionId;
        await this.updateRuntimeBinding(taskSessionId, {
          orchestratorSessionId,
          executorSessionId: activeExecutorSessionId,
          previousExecutorSessionId,
          codexRestoreStatus: 'session_restored',
          codexRestoreAt: restoreAt,
          codexRestoreSourceKey: restoreSourceKey,
          codexRestoreFailureReason: '',
        });
        await this.updateRestoreMetadata(orchestratorSessionId, {
          codexRestoreStatus: 'session_restored',
          codexRestoreAt: restoreAt,
          codexRestoreSourceKey: restoreSourceKey,
          previousExecutorSessionId,
          codexRestoreFailureReason: '',
        });
        await this.emitRestoreStatus(taskSessionId, {
          orchestratorSessionId,
          executorSessionId: activeExecutorSessionId,
          content: 'Codex 历史会话已恢复，正在沿用原上下文继续执行。',
          stage: 'executing',
          tone: 'system',
          codexRestoreStatus: 'session_restored',
          codexRestoreAt: restoreAt,
          codexRestoreSourceKey: restoreSourceKey,
          previousExecutorSessionId,
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        await this.updateRuntimeBinding(taskSessionId, {
          orchestratorSessionId,
          executorSessionId: '',
          previousExecutorSessionId,
          codexRestoreStatus: 'session_restore_failed',
          codexRestoreAt: restoreAt,
          codexRestoreSourceKey: restoreSourceKey,
          codexRestoreFailureReason: reason,
        });
        await this.updateRestoreMetadata(orchestratorSessionId, {
          codexRestoreStatus: 'session_restore_failed',
          codexRestoreAt: restoreAt,
          codexRestoreSourceKey: restoreSourceKey,
          previousExecutorSessionId,
          codexRestoreFailureReason: reason,
        });
        await this.emitRestoreStatus(taskSessionId, {
          orchestratorSessionId,
          content: `Codex 历史会话恢复失败：${reason}`,
          stage: 'failed',
          tone: 'error',
          codexRestoreStatus: 'session_restore_failed',
          codexRestoreAt: restoreAt,
          codexRestoreSourceKey: restoreSourceKey,
          previousExecutorSessionId,
          codexRestoreFailureReason: reason,
        });
        throw new Error(`Codex 历史会话恢复失败，请检查恢复状态后再继续：${reason}`);
      }
    } else {
      await this.updateRuntimeBinding(taskSessionId, {
        orchestratorSessionId,
        executorSessionId: activeExecutorSessionId,
        previousExecutorSessionId:
          previousOrchestratorSessionId && previousOrchestratorSessionId !== orchestratorSessionId
            ? previousExecutorSessionId || undefined
            : asString(previousRuntime.previousExecutorSessionId) || undefined,
        codexRestoreStatus:
          previousRestoreStatus === 'session_restore_failed' || previousRestoreStatus === 'state_restore_failed'
            ? (previousRuntime.codexRestoreStatus as any)
            : 'not_needed',
        codexRestoreAt: asString(previousRuntime.codexRestoreAt) || undefined,
        codexRestoreSourceKey: asString(previousRuntime.codexRestoreSourceKey) || restoreSourceKey,
        codexRestoreFailureReason:
          previousRestoreStatus === 'session_restore_failed' || previousRestoreStatus === 'state_restore_failed'
            ? asString(previousRuntime.codexRestoreFailureReason) || undefined
            : '',
      });
      await this.updateRestoreMetadata(orchestratorSessionId, {
        codexRestoreStatus:
          previousRestoreStatus === 'session_restore_failed' || previousRestoreStatus === 'state_restore_failed'
            ? (previousRuntime.codexRestoreStatus as any)
            : 'not_needed',
        codexRestoreAt: asString(previousRuntime.codexRestoreAt) || new Date().toISOString(),
        codexRestoreSourceKey: asString(previousRuntime.codexRestoreSourceKey) || restoreSourceKey,
        previousExecutorSessionId: asString(previousRuntime.previousExecutorSessionId) || undefined,
        codexRestoreFailureReason:
          previousRestoreStatus === 'session_restore_failed' || previousRestoreStatus === 'state_restore_failed'
            ? asString(previousRuntime.codexRestoreFailureReason) || undefined
            : '',
      });
    }

    const session = await taskCreationFileMemoryStore.getSession(taskSessionId);
    return {
      session,
      orchestratorSessionId,
      executorSessionId: activeExecutorSessionId,
      codexBinaryPath: asString(envMetadata.codexBinaryPath) || undefined,
      workspacePath,
    };
  }

  private async persistAppServerNotifications(
    taskSessionId: string,
    orchestratorSessionId: string,
    executorSessionId: string,
    notifications: CodexAppServerNotification[]
  ) {
    const retained: CodexAppServerNotification[] = [];
    const seen = new Set<string>();
    for (let index = notifications.length - 1; index >= 0; index -= 1) {
      const notification = notifications[index]!;
      const identity = buildNotificationIdentity(notification);
      if (seen.has(identity)) continue;
      seen.add(identity);
      retained.push(notification);
    }
    retained.reverse();

    for (let index = 0; index < retained.length; index += 1) {
      const notification = retained[index]!;

      if (!shouldPersistAppServerNotification(notification)) {
        continue;
      }

      const content = summarizeCodexAppServerNotification(notification);
      const metadata = this.prepareTimelineMetadata(
        'executor_event',
        {
          ...(notification.method === 'item/reasoning/summary'
            ? {
                messageKey: `codex-reasoning:${executorSessionId}:${asString(
                  toRecord((notification.params as Record<string, unknown>).item).id
                )}:${asString((notification.params as Record<string, unknown>).summaryIndex || '0') || '0'}`,
              }
            : {}),
          executor: 'codex',
          transport: 'app_server',
          orchestratorSessionId,
          executorSessionId,
          opencodeSessionId: executorSessionId,
          eventType: notification.method,
          appServerNotification: {
            method: notification.method,
          },
          ...buildCodexAppServerMetadata(notification),
        },
        {
          createdAt: new Date(Date.now() + index).toISOString(),
          seed: index + 1,
        }
      );

      const stage = mapAppServerStage(notification);
      if (stage === 'completed') {
        const completedAt = new Date().toISOString();
        await taskCreationFileMemoryStore.updateSessionState(taskSessionId, {
          status: 'completed',
          stage: 'completed',
        });
        try {
          await taskCreationSessionDAO.updateSessionStatus(taskSessionId, 'completed');
        } catch (error) {
          console.warn('[CODEX_APP_SERVER_STATUS_DB_COMPLETE_FAILED]', { sessionId: taskSessionId, error });
        }
        await this.updateActiveExecutorMetadata(orchestratorSessionId, {
          executorSessionId,
          eventType: notification.method,
          turnCompletedAt: completedAt,
        });
        void archiveSandboxWorkspace(orchestratorSessionId, 'codex_app_server_turn_completed').catch((error) => {
          console.warn('[CODEX_APP_SERVER_ARCHIVE_AFTER_COMPLETED_FAILED]', {
            sessionId: taskSessionId,
            orchestratorSessionId,
            error,
          });
        });
      } else if (stage === 'failed') {
        await taskCreationFileMemoryStore.updateSessionState(taskSessionId, {
          status: 'failed',
          stage: 'failed',
        });
        try {
          await taskCreationSessionDAO.updateSessionStatus(taskSessionId, 'failed');
        } catch (error) {
          console.warn('[CODEX_APP_SERVER_STATUS_DB_FAILED_FAILED]', { sessionId: taskSessionId, error });
        }
      }

      await this.persistMessage(taskSessionId, 'agent', 'executor_event', content, metadata, {
        createdAt: new Date(Date.now() + index).toISOString(),
        seed: index + 1,
      });
      await this.notify({
        taskSessionId,
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

  private clearAppServerJob(taskSessionId: string) {
    const current = this.appServerJobs.get(taskSessionId);
    if (!current) return;
    current.stopped = true;
    if (current.pollTimer) {
      clearTimeout(current.pollTimer);
      current.pollTimer = null;
    }
    this.appServerJobs.delete(taskSessionId);
  }

  private projectAppServerNotifications(
    current: {
      reasoningSummaries: Map<string, string>;
    },
    notifications: CodexAppServerNotification[]
  ): CodexAppServerNotification[] {
    const projected: CodexAppServerNotification[] = [];
    for (const notification of notifications) {
      if (notification.method === 'item/reasoning/summaryPartAdded') {
        const itemId = asString(notification.params.itemId);
        const summaryIndex = asString(notification.params.summaryIndex || '0') || '0';
        if (itemId) {
          current.reasoningSummaries.set(`${itemId}:${summaryIndex}`, '');
        }
        continue;
      }
      if (notification.method === 'item/reasoning/summaryTextDelta') {
        const itemId = asString(notification.params.itemId);
        const summaryIndex = asString(notification.params.summaryIndex || '0') || '0';
        const delta = asRawString(notification.params.delta);
        if (!itemId || !delta) {
          continue;
        }
        const key = `${itemId}:${summaryIndex}`;
        const nextText = `${current.reasoningSummaries.get(key) || ''}${delta}`;
        current.reasoningSummaries.set(key, nextText);
        projected.push({
          method: 'item/reasoning/summary',
          params: {
            threadId: notification.params.threadId,
            turnId: notification.params.turnId,
            summaryIndex,
            item: {
              id: itemId,
              type: 'reasoning',
              text: nextText,
            },
          },
        });
        continue;
      }
      projected.push(notification);
    }
    return projected;
  }

  private scheduleAppServerJobPoll(taskSessionId: string, delayMs = 0) {
    const current = this.appServerJobs.get(taskSessionId);
    if (!current || current.stopped) return;
    if (current.pollTimer) {
      clearTimeout(current.pollTimer);
    }
    current.pollTimer = setTimeout(() => {
      void this.pollAppServerJob(taskSessionId);
    }, Math.max(0, delayMs));
  }

  private async emitAppServerJobError(
    taskSessionId: string,
    orchestratorSessionId: string,
    executorSessionId: string,
    content: string
  ) {
    const metadata = this.prepareTimelineMetadata(
      'error',
      {
        executor: 'codex',
        transport: 'app_server',
        orchestratorSessionId,
        executorSessionId,
        opencodeSessionId: executorSessionId,
      },
      {
        createdAt: new Date().toISOString(),
      }
    );
    await taskCreationFileMemoryStore.updateSessionState(taskSessionId, {
      status: 'failed',
      stage: 'failed',
    });
    try {
      await taskCreationSessionDAO.updateSessionStatus(taskSessionId, 'failed');
    } catch (error) {
      console.warn('[CODEX_APP_SERVER_JOB_STATUS_DB_FAILED]', { sessionId: taskSessionId, error });
    }
    await this.persistMessage(taskSessionId, 'agent', 'error', content, metadata);
    await this.notify({
      taskSessionId,
      message: {
        type: 'error',
        content,
        metadata,
        stage: 'failed',
        tone: 'error',
      },
    });
  }

  private async pollAppServerJob(taskSessionId: string) {
    const current = this.appServerJobs.get(taskSessionId);
    if (!current || current.stopped || current.polling) return;
    current.polling = true;
    try {
      const result = await codexAppServerTurnService.readTurnJob(
        current.orchestratorSessionId,
        current.jobId,
        current.notificationOffset
      );
      if (current.stopped) return;

      current.notificationOffset = result.nextOffset;

      if (result.threadId && result.threadId !== current.executorSessionId) {
        current.executorSessionId = result.threadId;
        await this.updateRuntimeBinding(taskSessionId, {
          orchestratorSessionId: current.orchestratorSessionId,
          transport: 'app_server',
          executorSessionId: current.executorSessionId,
        });
      }

      const projectedNotifications = this.projectAppServerNotifications(
        current,
        result.notifications as CodexAppServerNotification[]
      );

      if (projectedNotifications.length > 0) {
        await this.persistAppServerNotifications(
          taskSessionId,
          current.orchestratorSessionId,
          current.executorSessionId,
          projectedNotifications
        );
      }

      if (result.status === 'failed') {
        this.clearAppServerJob(taskSessionId);
        const message = result.error || result.stderr || 'Codex App Server 执行失败';
        await this.emitAppServerJobError(
          taskSessionId,
          current.orchestratorSessionId,
          current.executorSessionId,
          message
        );
        return;
      }

      if (result.status === 'completed') {
        this.clearAppServerJob(taskSessionId);
        return;
      }

      this.scheduleAppServerJobPoll(taskSessionId, 800);
    } catch (error) {
      console.warn('[CODEX_APP_SERVER_JOB_POLL_FAILED]', {
        taskSessionId,
        orchestratorSessionId: current.orchestratorSessionId,
        error,
      });
      if (!current.stopped) {
        this.scheduleAppServerJobPoll(taskSessionId, 1500);
      }
    } finally {
      const latest = this.appServerJobs.get(taskSessionId);
      if (latest) {
        latest.polling = false;
      }
    }
  }

  async interruptCurrentRun(taskSessionId: string, orchestratorSessionId?: string): Promise<boolean> {
    const normalizedTaskSessionId = asString(taskSessionId);
    if (!normalizedTaskSessionId) {
      throw new Error('taskSessionId is required');
    }

    const currentSession =
      (await taskCreationFileMemoryStore.getSession(normalizedTaskSessionId)) || null;
    const runtimeOrchestratorSessionId =
      asString(orchestratorSessionId) || asString(currentSession?.runtime?.orchestratorSessionId);
    const runtimeExecutorSessionId =
      asString(currentSession?.runtime?.executorSessionId) ||
      asString(currentSession?.runtime?.opencodeSessionId);
    if (!runtimeOrchestratorSessionId) {
      return false;
    }

    const transportMode = resolveCodexTransportMode(currentSession);
    if (transportMode === 'app_server') {
      const activeJob = this.appServerJobs.get(normalizedTaskSessionId);
      this.clearAppServerJob(normalizedTaskSessionId);
      await codexAppServerService.stopServer(runtimeOrchestratorSessionId);
      await touchSandbox(runtimeOrchestratorSessionId, 'codex_interrupt');
      const interruptedAt = new Date().toISOString();
      const metadata = this.prepareTimelineMetadata(
        'executor_event',
        {
          executor: 'codex',
          transport: 'app_server',
          orchestratorSessionId: runtimeOrchestratorSessionId,
          executorSessionId:
            asString(activeJob?.executorSessionId) || runtimeExecutorSessionId || undefined,
          opencodeSessionId:
            asString(activeJob?.executorSessionId) || runtimeExecutorSessionId || undefined,
          eventType: 'turn.interrupted',
          status: 'interrupted',
        },
        {
          createdAt: interruptedAt,
        }
      );
      await this.persistMessage(
        normalizedTaskSessionId,
        'agent',
        'executor_event',
        'interrupted',
        metadata,
        {
          createdAt: interruptedAt,
        }
      );
      await this.notify({
        taskSessionId: normalizedTaskSessionId,
        message: {
          type: 'executor_event',
          content: 'interrupted',
          metadata,
          stage: 'failed',
          tone: 'system',
        },
      });
      return true;
    }

    await osacAgentService.interruptExecutor(runtimeOrchestratorSessionId, {
      executor: 'codex',
      executorSessionId: runtimeExecutorSessionId || '',
    });
    await touchSandbox(runtimeOrchestratorSessionId, 'codex_interrupt');
    return true;
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
    const inputTimestamp = Date.now();
    let accepted: {
      orchestratorSessionId: string;
      executorSessionId: string;
    };

    const transportMode = resolveCodexTransportMode(currentSession);
    if (transportMode === 'app_server') {
      const existingExecutorSessionId = runtime.executorSessionId || undefined;
      await this.updateRuntimeBinding(taskSessionId, {
        orchestratorSessionId: runtime.orchestratorSessionId,
        transport: 'app_server',
        executorSessionId: existingExecutorSessionId,
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
        console.warn('[CODEX_APP_SERVER_STATUS_DB_FAILED]', { taskSessionId, error });
      }

      await this.persistMessage(
        taskSessionId,
        input.source === 'agent' ? 'agent' : 'user',
        input.source === 'agent' ? 'codex_agent_input' : 'codex_user_input',
        content,
        {
          ...(input.clientMessageKey ? { messageKey: input.clientMessageKey } : {}),
          executor: 'codex',
          transport: 'app_server',
          orchestratorSessionId: runtime.orchestratorSessionId,
          executorSessionId: existingExecutorSessionId,
          opencodeSessionId: existingExecutorSessionId,
          workspacePath,
          timestamp: inputTimestamp,
          sessionEventSeq: inputTimestamp * 1000,
          ...(input.clientMessageKey ? { clientMessageKey: input.clientMessageKey } : {}),
        },
        {
          createdAt: new Date(inputTimestamp).toISOString(),
          seed: inputTimestamp % 1000,
        }
      );

      const acceptedAt = new Date(inputTimestamp + 1).toISOString();
      const acceptedMetadata = this.prepareTimelineMetadata(
        'status_update',
        {
          executor: 'codex',
          transport: 'app_server',
          orchestratorSessionId: runtime.orchestratorSessionId,
          executorSessionId: existingExecutorSessionId,
          opencodeSessionId: existingExecutorSessionId,
          status: 'accepted',
        },
        {
          createdAt: acceptedAt,
          seed: (inputTimestamp % 1000) + 1,
        }
      );
      await this.persistMessage(
        taskSessionId,
        'agent',
        'status_update',
        'Codex 已接收输入，正在执行...',
        acceptedMetadata,
        {
          createdAt: acceptedAt,
          seed: (inputTimestamp % 1000) + 1,
        }
      );
      await this.notify({
        taskSessionId,
        message: {
          type: 'status_update',
          content: 'Codex 已接收输入，正在执行...',
          metadata: acceptedMetadata,
          stage: 'executing',
          tone: 'system',
        },
      });

      const runtimeConfig = await codexRuntimeConfigService.getByTaskSessionId(taskSessionId);
      this.clearAppServerJob(taskSessionId);
      const turnJob = await codexAppServerTurnService.startBackgroundTurn({
        sessionId: runtime.orchestratorSessionId,
        workspacePath,
        prompt: content,
        threadId: existingExecutorSessionId,
        waitTimeoutMs: resolveCodexAppServerWaitTimeoutMs(),
        model: runtimeConfig.model || process.env.CODEX_MODEL || process.env.OPENAI_MODEL || undefined,
        codexBinaryPath: runtime.codexBinaryPath || undefined,
        configToml: runtimeConfig.configToml,
        authJson: runtimeConfig.authJson,
      });
      if (!turnJob.threadId) {
        throw new Error('Codex App Server 未返回 threadId');
      }
      accepted = {
        orchestratorSessionId: runtime.orchestratorSessionId,
        executorSessionId: turnJob.threadId,
      };
      await this.updateRuntimeBinding(taskSessionId, {
        orchestratorSessionId: accepted.orchestratorSessionId,
        transport: 'app_server',
        executorSessionId: accepted.executorSessionId,
      });
      await this.updateActiveExecutorMetadata(accepted.orchestratorSessionId, {
        executorSessionId: accepted.executorSessionId,
        eventType: 'turn.started',
      });
      await touchSandbox(accepted.orchestratorSessionId, 'codex_user_input');
      this.appServerJobs.set(taskSessionId, {
        jobId: turnJob.jobId,
        orchestratorSessionId: accepted.orchestratorSessionId,
        executorSessionId: accepted.executorSessionId,
        notificationOffset: 0,
        pollTimer: null,
        polling: false,
        stopped: false,
        reasoningSummaries: new Map(),
      });
      this.scheduleAppServerJobPoll(taskSessionId, 0);
      return accepted;
    }

    const osacAccepted = await osacAgentService.sendExecutorInput(runtime.orchestratorSessionId, {
      executor: 'codex',
      executorSessionId: runtime.executorSessionId || undefined,
      workspacePath,
      parts: [{ type: 'text', text: content }],
    });

    if (!osacAccepted.executorSessionId) {
      throw new Error('Codex 未返回 executorSessionId');
    }
    accepted = {
      orchestratorSessionId: osacAccepted.orchestratorSessionId,
      executorSessionId: osacAccepted.executorSessionId,
    };
    await this.updateRuntimeBinding(taskSessionId, {
      orchestratorSessionId: accepted.orchestratorSessionId,
      transport: 'sdk',
      executorSessionId: accepted.executorSessionId,
    });
    await this.updateActiveExecutorMetadata(accepted.orchestratorSessionId, {
      executorSessionId: accepted.executorSessionId,
      eventType: 'input.accepted',
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
        ...(input.clientMessageKey ? { messageKey: input.clientMessageKey } : {}),
        executor: 'codex',
        orchestratorSessionId: accepted.orchestratorSessionId,
        executorSessionId: accepted.executorSessionId,
        opencodeSessionId: accepted.executorSessionId,
        workspacePath,
        timestamp: inputTimestamp,
        sessionEventSeq: inputTimestamp * 1000,
        ...(input.clientMessageKey ? { clientMessageKey: input.clientMessageKey } : {}),
      },
      {
        createdAt: new Date(inputTimestamp).toISOString(),
        seed: inputTimestamp % 1000,
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
      await this.updateActiveExecutorMetadata(orchestratorSessionId, {
        executorSessionId,
        eventType:
          message.type === 'EXECUTOR_EVENT'
            ? asString(payload.eventType) || 'executor.event'
            : message.type.toLowerCase(),
      });
    }

    if (message.type === 'EXECUTOR_SESSION_READY') {
      const content = 'Codex 会话已建立，正在等待执行...';
      const metadata = this.prepareTimelineMetadata('status_update', {
        executor: 'codex',
        orchestratorSessionId,
        executorSessionId: executorSessionId || undefined,
        opencodeSessionId: executorSessionId || undefined,
        workspacePath: asString(payload.workspacePath) || undefined,
      }, {
        createdAt: new Date().toISOString(),
        seed: Number(payload.seq || 0),
      });
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
      const metadata = this.prepareTimelineMetadata('status_update', {
        executor: 'codex',
        orchestratorSessionId,
        executorSessionId: executorSessionId || undefined,
        opencodeSessionId: executorSessionId || undefined,
        status: asString(payload.status) || 'accepted',
      }, {
        createdAt: new Date().toISOString(),
        seed: Number(payload.seq || 0),
      });
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
      const metadata = this.prepareTimelineMetadata('error', {
        executor: 'codex',
        orchestratorSessionId,
        executorSessionId: executorSessionId || undefined,
        opencodeSessionId: executorSessionId || undefined,
        code: asString(payload.code) || undefined,
        stage: asString(payload.stage) || undefined,
      }, {
        createdAt: new Date().toISOString(),
        seed: Number(payload.seq || 0),
      });
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
    const eventCreatedAt = new Date(
      typeof payload.timestamp === 'number' && Number.isFinite(payload.timestamp) && payload.timestamp > 0
        ? payload.timestamp
        : Date.now()
    ).toISOString();
    const metadata = this.prepareTimelineMetadata('executor_event', {
      executor: 'codex',
      orchestratorSessionId,
      executorSessionId: executorSessionId || undefined,
      opencodeSessionId: executorSessionId || undefined,
      eventType,
      event,
      timestamp: payload.timestamp,
      seq: payload.seq,
      ...buildCodexEventMetadata(event),
    }, {
      createdAt: eventCreatedAt,
      seed: Number(payload.seq || 0),
    });

    if (stage === 'completed') {
      const completedAt = new Date().toISOString();
      await taskCreationFileMemoryStore.updateSessionState(session.id, {
        status: 'completed',
        stage: 'completed',
      });
      try {
        await taskCreationSessionDAO.updateSessionStatus(session.id, 'completed');
      } catch (error) {
        console.warn('[CODEX_REMOTE_STATUS_DB_COMPLETE_FAILED]', { sessionId: session.id, error });
      }
      await this.updateActiveExecutorMetadata(orchestratorSessionId, {
        executorSessionId: executorSessionId || undefined,
        eventType: eventType || 'turn.completed',
        turnCompletedAt: completedAt,
      });
      void archiveSandboxWorkspace(orchestratorSessionId, 'codex_turn_completed').catch((error) => {
        console.warn('[CODEX_REMOTE_ARCHIVE_AFTER_COMPLETED_FAILED]', {
          sessionId: session.id,
          orchestratorSessionId,
          error,
        });
      });
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

    await this.persistMessage(session.id, 'agent', 'executor_event', content, metadata, {
      createdAt: eventCreatedAt,
      seed: Number(payload.seq || 0),
    });
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
