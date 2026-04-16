/**
 * WebSocket 服务
 * 
 * 负责 WebSocket 连接管理和消息推送
 */

import { WebSocket, WebSocketServer } from 'ws';
import { TaskCreationService } from './task-creation-service';
import type { WebSocketMessage } from './types/intent';
import { getPublicErrorMessage } from '../../utils/error-response';
import { taskCreationFileMemoryStore } from './file-memory-store';
import {
  AwaitingUserInputError,
  isAwaitingUserInputError,
  isInterruptedTaskError,
  isRecoverableAgentError,
} from './errors';
import { randomUUID } from 'crypto';
import { codexRemoteService } from '../../services/codex-remote-service';
import { opencodeRemoteService } from '../../services/opencode-remote-service';
import { sandboxExecutorRegistry } from '../../services/sandbox-executor-registry';
import { sandboxAgentProvisionService } from '../../services/sandbox-agent-provision-service';
import { taskCreationSessionDAO } from '../../db/dao';
import { directModeEntryService } from '../../services/direct-mode-entry-service';
import { getDirectModeDeploymentErrorMessage } from '../../services/direct-mode-deployment-capability-service';
import { appAuthService } from '../../services/app-auth-service';
import { APP_SESSION_COOKIE_NAME } from '../../utils/auth-session';

function normalizeDirectOpencodeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || '');
  const normalized = raw.toLowerCase();
  if (
    normalized.includes('fetch failed') ||
    normalized.includes('socket hang up') ||
    normalized.includes('econnreset') ||
    normalized.includes('econnrefused') ||
    normalized.includes('etimedout') ||
    normalized.includes('und_err_socket') ||
    normalized.includes('timeout') ||
    normalized.includes('network')
  ) {
    return getPublicErrorMessage('执行环境启动较慢，请稍后再试');
  }
  return raw || getPublicErrorMessage('OpenCode 执行失败');
}

type WebSocketClientAuthContext = {
  sessionCookiePresent: boolean;
  resolvedUserId: string | null;
  resolveStatus: 'pending' | 'authenticated' | 'anonymous' | 'error';
  resolvedAt: number | null;
};

function requiresAuthenticatedUser(messageType: unknown): boolean {
  const normalized = String(messageType || '').trim().toLowerCase();
  return (
    normalized === 'user_input' ||
    normalized === 'user_response' ||
    normalized === 'auto_plan' ||
    normalized === 'opencode_input'
  );
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readCookieFromHeader(cookieHeader: unknown, name: string): string | null {
  const header = asText(cookieHeader);
  if (!header) return null;
  const items = header.split(/;\s*/g).filter(Boolean);
  for (const item of items) {
    const index = item.indexOf('=');
    if (index <= 0) continue;
    const key = item.slice(0, index).trim();
    if (key !== name) continue;
    const rawValue = item.slice(index + 1);
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }
  return null;
}

export class TaskCreationWebSocketService {
  private wss: WebSocketServer | null = null;
  private clients: Map<string, WebSocket> = new Map();
  private services: Map<string, TaskCreationService> = new Map();
  private clientAuthContext: Map<string, WebSocketClientAuthContext> = new Map();
  private clientAuthResolvePromises: Map<string, Promise<void>> = new Map();
  private sessionByClient: Map<string, string> = new Map();
  private sessionCleanupTimers: Map<string, NodeJS.Timeout> = new Map();
  private clarificationTimers: Map<string, NodeJS.Timeout> = new Map();
  private autoContinueCounts: Map<string, number> = new Map();
  private activeManagedRuns: Map<
    string,
    {
      clientId: string;
      phase: 'intent_processing' | 'executor_processing';
      cancelled: boolean;
      cancelReason?: string;
      latestUserInput: string;
    }
  > = new Map();
  private interruptedIntentReplayInputs: Map<string, string[]> = new Map();
  private cancelledClientMessageKeys: Map<string, Set<string>> = new Map();
  private opencodeUnsubscribe: (() => void) | null = null;
  private codexUnsubscribe: (() => void) | null = null;

  /**
   * 初始化 WebSocket 服务器
   */
  initialize(server: any): void {
    this.wss = new WebSocketServer({ server, path: '/ws/task-creation' });
    this.wss.on('error', (error) => {
      console.error('[WebSocket] 服务异常:', error);
    });
    opencodeRemoteService.initialize();
    codexRemoteService.initialize();
    if (!this.opencodeUnsubscribe) {
      this.opencodeUnsubscribe = opencodeRemoteService.subscribe(async ({ taskSessionId, message }) => {
        this.sendToSessionClients(taskSessionId, {
          type: message.type as any,
          content: message.content,
          metadata: message.metadata,
          stage: message.stage as any,
          phase: message.phase as any,
          tone: message.tone as any,
          sessionId: taskSessionId,
        } as WebSocketMessage, { skipPersistence: true });
      });
    }
    if (!this.codexUnsubscribe) {
      this.codexUnsubscribe = codexRemoteService.subscribe(async ({ taskSessionId, message }) => {
        this.sendToSessionClients(taskSessionId, {
          type: message.type as any,
          content: message.content,
          metadata: message.metadata,
          stage: message.stage as any,
          phase: message.phase as any,
          tone: message.tone as any,
          sessionId: taskSessionId,
        } as WebSocketMessage, { skipPersistence: true });
      });
    }

    this.wss.on('connection', (ws: WebSocket, req: any) => {
      const clientId = this.generateClientId();
      this.clients.set(clientId, ws);
      this.clientAuthContext.set(clientId, {
        sessionCookiePresent: false,
        resolvedUserId: null,
        resolveStatus: 'pending',
        resolvedAt: null,
      });
      const existingTimer = this.sessionCleanupTimers.get(clientId);
      if (existingTimer) {
        clearTimeout(existingTimer);
        this.sessionCleanupTimers.delete(clientId);
      }

      console.log(`[WebSocket] 客户端连接: ${clientId}`);
      const authResolvePromise = this.resolveClientAuthContext(clientId, req)
        .catch(() => undefined)
        .finally(() => {
          const latest = this.clientAuthResolvePromises.get(clientId);
          if (latest === authResolvePromise) {
            this.clientAuthResolvePromises.delete(clientId);
          }
        });
      this.clientAuthResolvePromises.set(clientId, authResolvePromise);

      // 创建任务创建服务实例
      const service = new TaskCreationService({
        onSessionCreated: (sessionId: string) => {
          this.sessionByClient.set(clientId, sessionId);
          void taskCreationFileMemoryStore.createSession('新建任务会话', sessionId);
        },
        onMessage: (message: WebSocketMessage) => {
          this.sendToClient(clientId, message);
        },
        onAskUser: (question: string, options?: string[]) => {
          return this.askUser(clientId, question, options);
        },
        onSearch: async (query: string) => {
          // TODO: 实现搜索功能
          console.log(`[WebSocket] 搜索查询: ${query}`);
          return [];
        },
      });

      this.services.set(clientId, service);

      // 处理消息
      ws.on('message', async (data: Buffer) => {
        try {
          const message: WebSocketMessage = JSON.parse(data.toString());
          console.log(`[WebSocket] 收到消息 from ${clientId}:`, message);
          await this.handleMessage(clientId, message);
        } catch (error: any) {
          if (isAwaitingUserInputError(error)) {
            console.log('[WebSocket] 当前会话等待用户补充输入');
            return;
          }
          if (isRecoverableAgentError(error)) {
            console.log('[WebSocket] 当前会话进入可恢复状态');
            return;
          }
          console.error('[WebSocket] 消息处理失败:', error);
          if (!error?.__clientNotified) {
            this.sendToClient(clientId, {
              type: 'error' as any,
              message: getPublicErrorMessage('请求处理失败，请稍后重试'),
            });
          }
        }
      });

      // 处理断开连接
      ws.on('close', () => {
        console.log(`[WebSocket] 客户端断开: ${clientId}`);
        this.clients.delete(clientId);
        this.services.delete(clientId);
        this.clientAuthContext.delete(clientId);
        this.clientAuthResolvePromises.delete(clientId);
        this.scheduleSessionCleanup(clientId);
      });

      // 发送欢迎消息
      const initial = {
        type: 'agent_message' as any,
        agent: 'system',
        content: '欢迎使用 Altus 任务创建助手！请描述您想要创建的任务。',
      };
      this.sendToClient(clientId, initial);
    });
  }

  /**
   * 处理客户端消息
   */
  private async handleMessage(clientId: string, message: WebSocketMessage): Promise<void> {
    const service = this.services.get(clientId);
    if (!service) {
      throw new Error('服务未找到');
    }

    const authContext = await this.ensureClientAuthResolved(clientId);
    const resolvedUserId = asText(authContext?.resolvedUserId);
    if (requiresAuthenticatedUser(message.type) && !resolvedUserId) {
      this.sendToClient(clientId, {
        type: 'error' as any,
        message: getPublicErrorMessage('当前未登录或会话已过期，请刷新后重新登录'),
      });
      return;
    }

    const altusMode = String((message.metadata as any)?.altusMode || '').trim();
    const executor = String((message.metadata as any)?.executor || '').trim();
    const sessionId = message.sessionId || this.sessionByClient.get(clientId);

    if (sessionId && altusMode === 'managed') {
      void taskCreationFileMemoryStore.updateSessionMode(sessionId, 'altus');
    }
    if (sessionId && executor) {
      void taskCreationFileMemoryStore.updateSessionExecutor(sessionId, executor);
    }

    switch (message.type) {
      case 'user_input' as any:
      case 'user_response' as any:
        if (!message.content) {
          throw new Error('用户输入不能为空');
        }
        if (message.sessionId) {
          this.clearClarificationTimer(message.sessionId);
        }
        console.log(`[WebSocket] 开始处理任务创建: ${message.content}`);
        await this.handleUserMessage(clientId, message, service);
        console.log(`[WebSocket] 任务创建完成`);
        break;
      case 'auto_plan' as any:
        await this.handleAutoPlan(clientId, message);
        break;
      case 'opencode_input' as any:
        // 直通模式入口：来自前端的“sandbox 直通”对话。
        // 该路径只做桥接 + 落盘 + 运行时绑定，不进入 Altus 三层编排。
        // 后续 claudecode/codex 直通也应复用此语义，避免误触 Altus 接管流程。
        if (!message.content) {
          throw new Error('用户输入不能为空');
        }
        await this.handleOpencodeInput(clientId, message);
        break;

      default:
        throw new Error(`未知的消息类型: ${message.type}`);
    }
  }

  private async syncSessionStateFromCurrentStage(sessionId: string): Promise<void> {
    const current = await taskCreationFileMemoryStore.getSession(sessionId);
    const stage = current?.stage;

    if (stage === 'completed') {
      await taskCreationFileMemoryStore.updateSessionState(sessionId, {
        status: 'completed',
        stage: 'completed',
      });
      return;
    }
    if (stage === 'failed') {
      await taskCreationFileMemoryStore.updateSessionState(sessionId, {
        status: 'failed',
        stage: 'failed',
      });
      return;
    }
    if (stage === 'clarifying') {
      await taskCreationFileMemoryStore.updateSessionState(sessionId, {
        status: 'waiting_user',
        stage: 'clarifying',
      });
      return;
    }

    await taskCreationFileMemoryStore.updateSessionState(sessionId, {
      status: 'in_progress',
    });
    if (stage) {
      await taskCreationFileMemoryStore.updateSessionState(sessionId, { stage: stage as any });
    }
  }

  /**
   * 向客户端发送消息
   */
  private sendToClient(
    clientId: string,
    message: WebSocketMessage,
    options?: { skipPersistence?: boolean }
  ): void {
    const ws = this.clients.get(clientId);
    const sessionId = this.sessionByClient.get(clientId) || message.sessionId;
    if (sessionId && !options?.skipPersistence) {
      const content = message.content || message.message || message.question || '';
      if (message.type === 'status_update') {
        const phaseValue =
          (message as any).phase ||
          (message.metadata && (message.metadata as any).phase);
        void taskCreationFileMemoryStore.updateSessionState(sessionId, {
          stage: message.stage as any,
          phase: phaseValue as any,
        });
      }
      const metadata = {
        ...message.metadata,
        stage: message.stage,
        phase: (message as any).phase,
        tone: message.tone,
        agent: message.agent,
        options: message.options,
        plan: message.plan,
      } as Record<string, unknown>;
      const orchestratorSessionId = String(metadata.orchestratorSessionId || '').trim();
      const executor = String(metadata.executor || '').trim();
      const executorSessionId =
        String(metadata.executorSessionId || '').trim() ||
        String(metadata.opencodeSessionId || '').trim();
      const opencodeSessionId = String(metadata.opencodeSessionId || '').trim();
      if (executor) {
        void taskCreationFileMemoryStore.updateSessionExecutor(sessionId, executor as any);
      }
      if (orchestratorSessionId || executorSessionId || opencodeSessionId) {
        void taskCreationFileMemoryStore.updateRuntimeBinding(sessionId, {
          orchestratorSessionId: orchestratorSessionId || undefined,
          executor: executor || undefined,
          executorSessionId: executorSessionId || undefined,
          opencodeSessionId: opencodeSessionId || undefined,
        });
      }
      if (content) {
        void taskCreationFileMemoryStore.addMessage(
          sessionId,
          'agent',
          message.type,
          content,
          metadata
        );
      }
    }

    if (ws && ws.readyState === WebSocket.OPEN) {
      console.log(`[WebSocket] 发送消息 to ${clientId}:`, message.type);
      ws.send(
        JSON.stringify({
          ...message,
          sessionId,
          metadata: {
            ...(message.metadata || {}),
            ...(sessionId ? { sessionId } : {}),
          },
        })
      );
    }
  }

  private sendToSessionClients(
    sessionId: string,
    message: WebSocketMessage,
    options?: { skipPersistence?: boolean }
  ): void {
    for (const [clientId, mappedSessionId] of this.sessionByClient.entries()) {
      if (mappedSessionId !== sessionId) continue;
      this.sendToClient(clientId, { ...message, sessionId }, options);
    }
  }

  private buildPersistedAgentMessageMetadata(message: WebSocketMessage, fallbackSeq: number) {
    const timestamp = Date.now();
    return {
      ...(message.metadata || {}),
      timestamp,
      sessionEventSeq:
        typeof (message.metadata as any)?.sessionEventSeq === 'number'
          ? (message.metadata as any).sessionEventSeq
          : fallbackSeq,
      messageKey:
        asText((message.metadata as any)?.messageKey) ||
        `runtime:${asText((message.metadata as any)?.runtimeGeneration) || 'na'}:${fallbackSeq}:${message.type}`,
      stage: message.stage,
      phase: (message as any).phase,
      tone: message.tone,
      agent: message.agent,
      options: message.options,
      plan: message.plan,
    } as Record<string, unknown>;
  }

  private async persistAgentMessage(
    sessionId: string,
    message: WebSocketMessage,
    options?: { fallbackSeq?: number }
  ) {
    const content = message.content || message.message || message.question || '';
    if (!content) return;
    const fallbackSeq = options?.fallbackSeq || Date.now() * 1000;
    const metadata = this.buildPersistedAgentMessageMetadata(message, fallbackSeq);
    if (message.type === 'status_update') {
      const phaseValue =
        (message as any).phase ||
        (message.metadata && (message.metadata as any).phase);
      await taskCreationFileMemoryStore.updateSessionState(sessionId, {
        stage: message.stage as any,
        phase: phaseValue as any,
      });
    }
    await taskCreationFileMemoryStore.addMessage(
      sessionId,
      'agent',
      message.type,
      content,
      metadata
    );
    try {
      await taskCreationSessionDAO.addMessage({
        id: randomUUID(),
        sessionId,
        role: 'agent',
        messageType: message.type as any,
        content,
        metadata,
      });
    } catch (error) {
      console.warn('[DIRECT_CAPABILITY_MESSAGE_DB_FAILED]', {
        sessionId,
        messageType: message.type,
        error,
      });
    }
  }

  private async persistAndSendAgentMessage(
    clientId: string,
    sessionId: string,
    message: WebSocketMessage,
    options?: { fallbackSeq?: number }
  ) {
    await this.persistAgentMessage(sessionId, { ...message, sessionId }, options);
    this.sendToClient(clientId, { ...message, sessionId }, { skipPersistence: true });
  }

  /**
   * 向用户提问并等待回复
   */
  private askUser(clientId: string, question: string, options?: string[]): Promise<string> {
    console.log(`[WebSocket] 向用户提问: ${question}`);
    const sessionId = this.sessionByClient.get(clientId);
    if (sessionId) {
      void taskCreationFileMemoryStore.setPendingClarification(sessionId, question, options);
    }

    this.sendToClient(clientId, {
      type: 'status_update' as any,
      content: '需要你补充关键信息',
      stage: 'clarifying' as any,
      tone: 'planning' as any,
      sessionId,
    });

    this.sendToClient(clientId, {
      type: 'clarification_request' as any,
      question,
      options,
      sessionId,
    });

    if (sessionId) {
      this.scheduleAutoContinue(sessionId, clientId, question);
    }

    return Promise.reject(new AwaitingUserInputError());
  }

  private scheduleAutoContinue(sessionId: string, clientId: string, question: string) {
    this.clearClarificationTimer(sessionId);
    const timeoutMs = Number(process.env.TASK_CREATION_CLARIFY_TIMEOUT_MS || 45000);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return;
    const timer = setTimeout(() => {
      this.autoContinueClarification(sessionId, clientId, 'timeout');
    }, timeoutMs);
    if (typeof (timer as any).unref === 'function') {
      (timer as any).unref();
    }
    this.clarificationTimers.set(sessionId, timer);
  }

  private clearClarificationTimer(sessionId: string) {
    const existing = this.clarificationTimers.get(sessionId);
    if (existing) {
      clearTimeout(existing);
      this.clarificationTimers.delete(sessionId);
    }
  }

  private async handleAutoPlan(clientId: string, message: WebSocketMessage): Promise<void> {
    const sessionId =
      message.sessionId ||
      this.sessionByClient.get(clientId) ||
      (message.metadata as any)?.sessionId;
    if (!sessionId) {
      throw new Error('缺少 sessionId，无法自动规划');
    }
    await this.autoContinueClarification(sessionId, clientId, 'user_triggered');
  }

  private async autoContinueClarification(sessionId: string, clientId: string, reason: 'timeout' | 'user_triggered') {
    const service = this.services.get(clientId);
    if (!service) return;

    const count = (this.autoContinueCounts.get(sessionId) || 0) + 1;
    this.autoContinueCounts.set(sessionId, count);
    this.clearClarificationTimer(sessionId);

    const session = await taskCreationFileMemoryStore.getSession(sessionId);
    if (!session || session.status !== 'waiting_user') {
      return;
    }

    const fallbackResponse = [
      '用户未补充，按默认假设继续。',
      '请基于已有信息完成规划，不再追加澄清问题。',
    ].join(' ');

    this.sendToClient(clientId, {
      type: 'status_update' as any,
      sessionId,
      stage: 'planning' as any,
      tone: 'planning' as any,
      content: reason === 'timeout' ? '超时未补充，系统自动继续规划...' : '已选择自主规划，系统继续执行...',
    });

    await this.handleUserMessage(
      clientId,
      {
        type: 'user_response' as any,
        sessionId,
        content: fallbackResponse,
        metadata: { autoContinue: true, reason, count },
      } as WebSocketMessage,
      service
    );
  }

  private async handleUserMessage(
    clientId: string,
    message: WebSocketMessage,
    service: TaskCreationService
  ): Promise<void> {
    const incomingSessionId = String(message.sessionId || '').trim();
    const forceNewSession = message.type === ('user_input' as any) && !incomingSessionId;
    let sessionId = forceNewSession
      ? undefined
      : incomingSessionId || this.sessionByClient.get(clientId);
    if (!sessionId) {
      sessionId = randomUUID();
      await taskCreationFileMemoryStore.createSession(message.content || '新建任务', sessionId);
      await taskCreationFileMemoryStore.addMessage(
        sessionId,
        'system',
        'session_started',
        '会话已创建'
      );
    }
    const wasWaitingForUser = sessionId ? await this.isWaitingForUser(sessionId) : false;
    const pendingResume = sessionId ? await this.getPendingResume(sessionId) : null;
    const authContext = await this.ensureClientAuthResolved(clientId);
    const resolvedUserId = authContext?.resolvedUserId || undefined;
    if (sessionId) {
      this.sessionByClient.set(clientId, sessionId);
      await taskCreationFileMemoryStore.updateSessionState(sessionId, { stage: 'collecting' });
      await taskCreationFileMemoryStore.addMessage(
        sessionId,
        'user',
        message.type,
        message.content || '',
        message.metadata
      );
    }

    if (sessionId) {
      this.prefetchRuntime(sessionId, message.content || '');
    }

    const replayInputs = sessionId ? this.interruptedIntentReplayInputs.get(sessionId) || [] : [];
    const mergedReplayInput =
      replayInputs.length > 0
        ? [...replayInputs, message.content || '']
            .filter((item) => typeof item === 'string' && item.trim())
            .map((item, index) =>
              index === 0 ? `原始需求：${item.trim()}` : `补充需求${index}：${item.trim()}`
            )
            .join('\n\n')
        : message.content || '';
    if (sessionId && replayInputs.length > 0) {
      this.interruptedIntentReplayInputs.delete(sessionId);
    }

    if (sessionId && pendingResume) {
      try {
        await taskCreationFileMemoryStore.clearPendingResume(sessionId);
        await taskCreationFileMemoryStore.updateSessionState(sessionId, {
          stage: pendingResume.stage || 'executing',
          allowBackward: true,
        });
        this.beginManagedRun(sessionId, clientId, mergedReplayInput);
        service.setRunControl({
          isCancelled: () => Boolean(this.activeManagedRuns.get(sessionId)?.cancelled),
          getCancelReason: () => this.activeManagedRuns.get(sessionId)?.cancelReason,
          setPhase: (phase) => this.updateManagedRunPhase(sessionId, phase),
        });
        await service.resumeTask(sessionId, message.content || pendingResume.lastUserInput, resolvedUserId);
        this.clearManagedRun(sessionId);
        await this.syncSessionStateFromCurrentStage(sessionId);
        return;
      } catch (error) {
        this.clearManagedRun(sessionId);
        if (isRecoverableAgentError(error)) {
          const current = await taskCreationFileMemoryStore.getSession(sessionId);
          await taskCreationFileMemoryStore.setPendingResume(sessionId, {
            stage: (current?.stage || pendingResume.stage || 'executing') as any,
            reason: (error as any)?.message,
            lastUserInput: message.content || pendingResume.lastUserInput,
          });
          return;
        }
        await taskCreationFileMemoryStore.updateSessionState(sessionId, {
          status: isAwaitingUserInputError(error) ? 'waiting_user' : 'failed',
          stage: isAwaitingUserInputError(error) ? 'clarifying' : 'failed',
        });
        throw error;
      }
    }

    if (sessionId && wasWaitingForUser) {
      try {
        const includePendingQuestion = Boolean((message.metadata as any)?.autoContinue);
        const resumedInput = await this.buildResumedInput(sessionId, message.content!, {
          includePendingQuestion,
        });
        await taskCreationFileMemoryStore.clearPendingClarification(sessionId);
        await taskCreationFileMemoryStore.updateSessionState(sessionId, { stage: 'planning' });
        this.beginManagedRun(sessionId, clientId, resumedInput);
        service.setRunControl({
          isCancelled: () => Boolean(this.activeManagedRuns.get(sessionId)?.cancelled),
          getCancelReason: () => this.activeManagedRuns.get(sessionId)?.cancelReason,
          setPhase: (phase) => this.updateManagedRunPhase(sessionId, phase),
        });
        await service.createTask(resumedInput, resolvedUserId, sessionId, 'user_response');
        this.clearManagedRun(sessionId);
        await this.syncSessionStateFromCurrentStage(sessionId);
        return;
      } catch (error) {
        this.clearManagedRun(sessionId);
        await taskCreationFileMemoryStore.updateSessionState(sessionId, {
          status: isAwaitingUserInputError(error) ? 'waiting_user' : 'failed',
          stage: isAwaitingUserInputError(error) ? 'clarifying' : 'failed',
        });
        throw error;
      }
    }

    try {
      if (sessionId) {
        this.beginManagedRun(sessionId, clientId, mergedReplayInput);
        service.setRunControl({
          isCancelled: () => Boolean(this.activeManagedRuns.get(sessionId)?.cancelled),
          getCancelReason: () => this.activeManagedRuns.get(sessionId)?.cancelReason,
          setPhase: (phase) => this.updateManagedRunPhase(sessionId, phase),
        });
      }
      await service.createTask(
        mergedReplayInput,
        resolvedUserId,
        sessionId,
        (message.type as any) || 'user_input',
        message.metadata
      );
      if (sessionId) {
        this.clearManagedRun(sessionId);
      }
      if (sessionId) {
        await this.syncSessionStateFromCurrentStage(sessionId);
      }
    } catch (error) {
      if (sessionId) {
        this.clearManagedRun(sessionId);
      }
      if (isInterruptedTaskError(error)) {
        return;
      }
      if (sessionId) {
        if (isRecoverableAgentError(error)) {
          const current = await taskCreationFileMemoryStore.getSession(sessionId);
          await taskCreationFileMemoryStore.setPendingResume(sessionId, {
            stage: (current?.stage || 'executing') as any,
            reason: (error as any)?.message,
            lastUserInput: message.content || undefined,
          });
          return;
        }
        await taskCreationFileMemoryStore.updateSessionState(sessionId, {
          status: isAwaitingUserInputError(error) ? 'waiting_user' : 'failed',
          stage: isAwaitingUserInputError(error) ? 'clarifying' : 'failed',
        });
      }
      throw error;
    }
  }

  private beginManagedRun(sessionId: string, clientId: string, latestUserInput: string) {
    this.activeManagedRuns.set(sessionId, {
      clientId,
      phase: 'intent_processing',
      cancelled: false,
      latestUserInput,
    });
  }

  private updateManagedRunPhase(sessionId: string, phase: 'intent_processing' | 'executor_processing') {
    const current = this.activeManagedRuns.get(sessionId);
    if (!current) return;
    current.phase = phase;
  }

  private clearManagedRun(sessionId: string) {
    const current = this.activeManagedRuns.get(sessionId);
    if (current) {
      const service = this.services.get(current.clientId);
      service?.setRunControl(null);
    }
    this.activeManagedRuns.delete(sessionId);
  }

  async interruptManagedSession(
    sessionId: string,
    options?: { preserveForRetry?: boolean; clientMessageKey?: string }
  ): Promise<{ interrupted: boolean; phase?: 'intent_processing' | 'executor_processing'; replayPending?: boolean }> {
    const normalizedClientMessageKey = String(options?.clientMessageKey || '').trim();
    if (normalizedClientMessageKey) {
      const existing = this.cancelledClientMessageKeys.get(sessionId) || new Set<string>();
      existing.add(normalizedClientMessageKey);
      this.cancelledClientMessageKeys.set(sessionId, existing);
    }
    const current = this.activeManagedRuns.get(sessionId);
    if (!current) {
      return { interrupted: false };
    }
    current.cancelled = true;
    current.cancelReason = '当前处理已停止';
    if (current.phase === 'intent_processing' && options?.preserveForRetry && current.latestUserInput.trim()) {
      const existing = this.interruptedIntentReplayInputs.get(sessionId) || [];
      this.interruptedIntentReplayInputs.set(sessionId, [...existing, current.latestUserInput.trim()]);
    }
    return {
      interrupted: true,
      phase: current.phase,
      replayPending: current.phase === 'intent_processing' && Boolean(options?.preserveForRetry),
    };
  }

  private consumeCancelledClientMessageKey(sessionId: string, clientMessageKey?: string): boolean {
    const normalized = String(clientMessageKey || '').trim();
    if (!normalized) return false;
    const current = this.cancelledClientMessageKeys.get(sessionId);
    if (!current?.has(normalized)) return false;
    current.delete(normalized);
    if (current.size === 0) {
      this.cancelledClientMessageKeys.delete(sessionId);
    }
    return true;
  }

  private prefetchRuntime(sessionId: string, taskTitle: string) {
    const enabled = String(process.env.TASK_CREATION_PREFETCH_RUNTIME || 'true').trim().toLowerCase() !== 'false';
    if (!enabled) return;
    void sandboxAgentProvisionService
      .provisionWithLock({
        metadata: {
          taskSessionId: sessionId,
          taskTitle: taskTitle?.slice(0, 80) || '新建任务会话',
        },
      })
      .catch((error) => {
        console.warn('[TASK_CREATION_PREFETCH_RUNTIME_FAILED]', sessionId, error);
      });
  }

  private async handleOpencodeInput(clientId: string, message: WebSocketMessage): Promise<void> {
    // 直通模式处理：为 OpenCode（未来可扩展 ClaudeCode/Codex）建立会话并转发。
    // 注意：此处不应写入 Altus 的澄清/规划阶段状态，避免干扰接管模式。
    let taskSessionId =
      message.sessionId ||
      this.sessionByClient.get(clientId) ||
      (message.metadata as any)?.sessionId;

    let createdSession = false;
    if (!taskSessionId) {
      taskSessionId = randomUUID();
      createdSession = true;
    }

    // 允许前端在首条消息时主动携带 sessionId（避免并发输入导致重复新建会话）：
    // 若该 id 尚不存在，则按“新会话”路径初始化。
    if (!createdSession) {
      const exists = await taskCreationFileMemoryStore.getSession(taskSessionId);
      if (!exists) {
        createdSession = true;
      }
    }

    this.sessionByClient.set(clientId, taskSessionId);

    const orchestratorSessionId = String((message.metadata as any)?.orchestratorSessionId || '').trim();
    const workspacePath = String((message.metadata as any)?.workspacePath || '').trim();
    const executor = sandboxExecutorRegistry.resolveExecutor((message.metadata as any)?.executor);
    const clientMessageKey = String((message.metadata as any)?.messageKey || '').trim() || undefined;
    const prePersistedUserInput = Boolean((message.metadata as any)?.prePersistedUserInput);
    const persistLegacyUserInput = Boolean((message.metadata as any)?.persistLegacyUserInput);
    const authContext = await this.ensureClientAuthResolved(clientId);
    const resolvedUserId = authContext?.resolvedUserId || undefined;
    if (taskSessionId && this.consumeCancelledClientMessageKey(taskSessionId, clientMessageKey)) {
      return;
    }

    try {
      if (createdSession) {
        await taskCreationFileMemoryStore.createSession(message.content || '新建任务', taskSessionId);
        await taskCreationFileMemoryStore.addMessage(
          taskSessionId,
          'system',
          'session_started',
          '会话已创建'
        );
        await taskCreationFileMemoryStore.updateSessionMode(taskSessionId, 'sandbox');
        await taskCreationFileMemoryStore.updateSessionExecutor(taskSessionId, executor);
        await taskCreationFileMemoryStore.updateSessionState(taskSessionId, {
          stage: 'executing',
          phase: 'development',
        });
        try {
          const existing = await taskCreationSessionDAO.getSession(taskSessionId);
          if (!existing) {
            await taskCreationSessionDAO.createSession({
              id: taskSessionId,
              userId: resolvedUserId,
              status: 'in_progress',
            });
          } else if (resolvedUserId) {
            await taskCreationSessionDAO.bindUserIfMissing(taskSessionId, resolvedUserId);
          }
          await taskCreationSessionDAO.addMessage({
            id: randomUUID(),
            sessionId: taskSessionId,
            role: 'system',
            messageType: 'session_started',
            content: '会话已创建',
          });
        } catch (error) {
          console.warn('[OPENCODE_INPUT_SESSION_DB_FAILED]', error);
        }
        // 直通模式需要尽早返回 sessionId 给前端，以便 SSE 订阅实时事件流。
        // 该消息不进入 Altus 编排流程，仅用于前端建立会话上下文。
        this.sendToClient(
          clientId,
          {
            type: 'agent_message' as any,
            agent: 'system',
            content: '会话已创建',
            sessionId: taskSessionId,
          },
          { skipPersistence: true }
        );
      }
      if (!createdSession) {
        await taskCreationFileMemoryStore.updateSessionMode(taskSessionId, 'sandbox');
        await taskCreationFileMemoryStore.updateSessionExecutor(taskSessionId, executor);
      }

      try {
        const existingDbSession = await taskCreationSessionDAO.getSession(taskSessionId);
        if (!existingDbSession) {
          await taskCreationSessionDAO.createSession({
            id: taskSessionId,
            userId: resolvedUserId,
            status: 'in_progress',
          });
        } else if (resolvedUserId) {
          await taskCreationSessionDAO.bindUserIfMissing(taskSessionId, resolvedUserId);
        }
      } catch (error) {
        console.warn('[OPENCODE_INPUT_SESSION_DB_ENSURE_FAILED]', error);
      }

      if (!prePersistedUserInput && persistLegacyUserInput) {
        const userMessageTimestamp = Date.now();
        const userMessageMetadata = {
          timestamp: userMessageTimestamp,
          sessionEventSeq: userMessageTimestamp * 1000,
        };
        await taskCreationFileMemoryStore.addMessage(
          taskSessionId,
          'user',
          'user_input',
          message.content || '',
          userMessageMetadata
        );
        try {
          await taskCreationSessionDAO.addMessage({
            id: randomUUID(),
            sessionId: taskSessionId,
            role: 'user',
            messageType: 'user_input',
            content: message.content || '',
            metadata: userMessageMetadata,
          });
        } catch (error) {
          console.warn('[OPENCODE_INPUT_MESSAGE_DB_FAILED]', error);
        }
      }

      const entryDecision = await directModeEntryService.decide({
        content: message.content || '',
      });
      if (entryDecision.action === 'platform_capability') {
        const capabilityLabel = directModeEntryService.getCapabilityDisplayName(entryDecision);
        const directCapabilityStartedMessage: WebSocketMessage = {
          type: 'status_update' as any,
          sessionId: taskSessionId,
          content: `已识别为${capabilityLabel}请求，正在调用平台服务...`,
          stage: 'executing' as any,
          tone: 'system' as any,
          metadata: {
            directModeIntercepted: true,
            capabilityId: entryDecision.capabilityId,
            decisionReason: entryDecision.reason,
            interceptSource: entryDecision.source,
            executionMode: 'direct_platform_capability',
          },
        };
        await taskCreationFileMemoryStore.updateSessionState(taskSessionId, {
          status: 'in_progress',
          stage: 'executing',
        });
        await this.persistAndSendAgentMessage(clientId, taskSessionId, directCapabilityStartedMessage);

        try {
          const capabilityResult = await directModeEntryService.execute(entryDecision, {
            taskSessionId,
            content: message.content || '',
            orchestratorSessionId: orchestratorSessionId || undefined,
            workspacePath: workspacePath || undefined,
          });

          await taskCreationFileMemoryStore.updateSessionState(taskSessionId, {
            status: 'completed',
            stage: 'completed',
          });
          try {
            await taskCreationSessionDAO.updateSessionStatus(taskSessionId, 'completed');
          } catch (error) {
            console.warn('[DIRECT_CAPABILITY_STATUS_DB_COMPLETE_FAILED]', error);
          }

          await this.persistAndSendAgentMessage(clientId, taskSessionId, {
            type: 'agent_message' as any,
            agent: 'system',
            sessionId: taskSessionId,
            content: capabilityResult.message,
            tone: 'system' as any,
            metadata: {
              ...(capabilityResult.metadata || {}),
              directModeIntercepted: true,
              capabilityId: capabilityResult.capabilityId,
              decisionReason: entryDecision.reason,
              interceptSource: entryDecision.source,
              executionMode: 'direct_platform_capability',
            },
          });

          await this.persistAndSendAgentMessage(clientId, taskSessionId, {
            type: 'status_update' as any,
            sessionId: taskSessionId,
            content: `${capabilityLabel}已完成`,
            stage: 'completed' as any,
            tone: 'system' as any,
            metadata: {
              directModeIntercepted: true,
              capabilityId: capabilityResult.capabilityId,
              outcome: 'completed',
              executionMode: 'direct_platform_capability',
            },
          });
          return;
        } catch (error) {
          const errorMessage = getPublicErrorMessage(getDirectModeDeploymentErrorMessage(error));
          await taskCreationFileMemoryStore.updateSessionState(taskSessionId, {
            status: 'failed',
            stage: 'failed',
          });
          try {
            await taskCreationSessionDAO.updateSessionStatus(taskSessionId, 'failed');
          } catch (dbError) {
            console.warn('[DIRECT_CAPABILITY_STATUS_DB_FAILED_FAILED]', dbError);
          }
          await this.persistAndSendAgentMessage(clientId, taskSessionId, {
            type: 'status_update' as any,
            sessionId: taskSessionId,
            content: errorMessage,
            stage: 'failed' as any,
            tone: 'error' as any,
            metadata: {
              directModeIntercepted: true,
              capabilityId: entryDecision.capabilityId,
              outcome: 'failed',
              decisionReason: entryDecision.reason,
              interceptSource: entryDecision.source,
              executionMode: 'direct_platform_capability',
            },
          });
          return;
        }
      }

      const accepted = await sandboxExecutorRegistry.sendUserInput(executor, {
        taskSessionId,
        content: message.content || '',
        orchestratorSessionId: orchestratorSessionId || undefined,
        workspacePath: workspacePath || undefined,
        clientMessageKey,
        metadata: (message.metadata as Record<string, unknown>) || undefined,
      });

      // 直通模式下给前端一个“已接收”回执，并同步当前 opencodeSessionId，
      // 避免前端在重连窗口期因会话绑定缺失导致后续续聊错位或卡住。
      this.sendToClient(
        clientId,
        {
          type: 'opencode_status' as any,
          sessionId: taskSessionId,
          content:
            accepted.executor === 'opencode'
              ? 'OpenCode 已接收输入，正在执行...'
              : `${accepted.executor} 已接收输入，正在执行...`,
          metadata: {
            orchestratorSessionId: accepted.orchestratorSessionId,
            executor: accepted.executor,
            executorSessionId: accepted.executorSessionId,
            opencodeSessionId: accepted.opencodeSessionId,
            executionMode: 'sandbox_direct',
          },
        },
        { skipPersistence: true }
      );

      // 直通模式不注入额外状态消息，避免污染 OpenCode 原始对话流。
    } catch (error) {
      const errText = normalizeDirectOpencodeErrorMessage(error);
      this.sendToClient(clientId, {
        type: 'error' as any,
        sessionId: taskSessionId,
        message: errText,
        content: errText,
      });
    }
  }

  private async isWaitingForUser(sessionId: string): Promise<boolean> {
    const session = await taskCreationFileMemoryStore.getSession(sessionId);
    return session?.status === 'waiting_user';
  }

  private async getPendingResume(sessionId: string) {
    const session = await taskCreationFileMemoryStore.getSession(sessionId);
    return session?.pendingResume || null;
  }

  private async buildResumedInput(
    sessionId: string,
    latestResponse: string,
    options?: { includePendingQuestion?: boolean }
  ): Promise<string> {
    const session = await taskCreationFileMemoryStore.getSession(sessionId);
    const messages = await taskCreationFileMemoryStore.getMessages(sessionId);
    const firstUserInput = messages.find((m) => m.messageType === 'user_input')?.content || '';
    const previousResponses = messages
      .filter((m) => m.messageType === 'user_response')
      .map((m) => m.content);
    const mergedResponses =
      previousResponses.length > 0 && previousResponses[previousResponses.length - 1] === latestResponse
        ? previousResponses
        : [...previousResponses, latestResponse];
    const allResponses = mergedResponses.map((text, index) => `补充${index + 1}: ${text}`).join('\n');

    const includeQuestion = Boolean(options?.includePendingQuestion);
    const pendingQ = includeQuestion && session?.pendingQuestion ? `\n\n待补充问题：${session.pendingQuestion}` : '';
    return `${firstUserInput}${pendingQ}\n\n用户补充信息：\n${allResponses}`;
  }

  /**
   * 生成客户端 ID
   */
  private generateClientId(): string {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private async ensureClientAuthResolved(clientId: string): Promise<WebSocketClientAuthContext | null> {
    const resolvePromise = this.clientAuthResolvePromises.get(clientId);
    if (resolvePromise) {
      await resolvePromise.catch(() => null);
    }
    return this.clientAuthContext.get(clientId) || null;
  }

  private async resolveClientAuthContext(clientId: string, req: any) {
    const context = this.clientAuthContext.get(clientId);
    if (!context) return;

    const sessionToken = readCookieFromHeader(req?.headers?.cookie, APP_SESSION_COOKIE_NAME);
    context.sessionCookiePresent = Boolean(sessionToken);

    if (!sessionToken) {
      context.resolveStatus = 'anonymous';
      context.resolvedAt = Date.now();
      return;
    }

    try {
      const resolved = await appAuthService.resolveUserBySessionToken(sessionToken);
      const latest = this.clientAuthContext.get(clientId);
      if (!latest) return;
      latest.resolvedAt = Date.now();
      latest.resolvedUserId = asText(resolved?.user?.id) || null;
      latest.resolveStatus = latest.resolvedUserId ? 'authenticated' : 'anonymous';
    } catch (error) {
      const latest = this.clientAuthContext.get(clientId);
      if (!latest) return;
      latest.resolvedAt = Date.now();
      latest.resolvedUserId = null;
      latest.resolveStatus = 'error';
    }
  }

  private scheduleSessionCleanup(clientId: string) {
    const sessionId = this.sessionByClient.get(clientId);
    if (!sessionId) {
      this.sessionByClient.delete(clientId);
      const existing = this.sessionCleanupTimers.get(clientId);
      if (existing) {
        clearTimeout(existing);
        this.sessionCleanupTimers.delete(clientId);
      }
      return;
    }

    const existing = this.sessionCleanupTimers.get(clientId);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      this.sessionByClient.delete(clientId);
      this.sessionCleanupTimers.delete(clientId);
    }, 5 * 60 * 1000);
    if (typeof (timer as any).unref === 'function') {
      (timer as any).unref();
    }
    this.sessionCleanupTimers.set(clientId, timer);
  }

  /**
   * 关闭 WebSocket 服务器
   */
  close(): void {
    if (this.wss) {
      this.wss.close();
      this.clients.clear();
      this.services.clear();
      this.clientAuthContext.clear();
      this.clientAuthResolvePromises.clear();
      this.sessionByClient.clear();
      for (const timer of this.sessionCleanupTimers.values()) {
        clearTimeout(timer);
      }
      this.sessionCleanupTimers.clear();
    }
    if (this.opencodeUnsubscribe) {
      this.opencodeUnsubscribe();
      this.opencodeUnsubscribe = null;
    }
    if (this.codexUnsubscribe) {
      this.codexUnsubscribe();
      this.codexUnsubscribe = null;
    }
  }
}

/**
 * 导出单例实例
 */
export const taskCreationWebSocketService = new TaskCreationWebSocketService();
