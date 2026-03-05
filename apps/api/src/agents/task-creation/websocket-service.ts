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
import { AwaitingUserInputError, isAwaitingUserInputError, isRecoverableAgentError } from './errors';
import { randomUUID } from 'crypto';
import { opencodeRemoteService } from '../../services/opencode-remote-service';
import { sandboxAgentProvisionService } from '../../services/sandbox-agent-provision-service';
import { taskCreationSessionDAO } from '../../db/dao';

export class TaskCreationWebSocketService {
  private wss: WebSocketServer | null = null;
  private clients: Map<string, WebSocket> = new Map();
  private services: Map<string, TaskCreationService> = new Map();
  private sessionByClient: Map<string, string> = new Map();
  private sessionCleanupTimers: Map<string, NodeJS.Timeout> = new Map();
  private clarificationTimers: Map<string, NodeJS.Timeout> = new Map();
  private autoContinueCounts: Map<string, number> = new Map();
  private opencodeUnsubscribe: (() => void) | null = null;

  /**
   * 初始化 WebSocket 服务器
   */
  initialize(server: any): void {
    this.wss = new WebSocketServer({ server, path: '/ws/task-creation' });
    opencodeRemoteService.initialize();
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

    this.wss.on('connection', (ws: WebSocket, req: any) => {
      const clientId = this.generateClientId();
      this.clients.set(clientId, ws);
      const existingTimer = this.sessionCleanupTimers.get(clientId);
      if (existingTimer) {
        clearTimeout(existingTimer);
        this.sessionCleanupTimers.delete(clientId);
      }

      console.log(`[WebSocket] 客户端连接: ${clientId}`);

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
      const opencodeSessionId = String(metadata.opencodeSessionId || '').trim();
      if (orchestratorSessionId || opencodeSessionId) {
        void taskCreationFileMemoryStore.updateRuntimeBinding(sessionId, {
          orchestratorSessionId: orchestratorSessionId || undefined,
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

    if (message.type === ('error' as any)) {
      return;
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
    if (sessionId) {
      this.sessionByClient.set(clientId, sessionId);
      await taskCreationFileMemoryStore.updateSessionState(sessionId, { stage: 'collecting' });
      await taskCreationFileMemoryStore.addMessage(
        sessionId,
        'user',
        message.type,
        message.content || ''
      );
    }

    if (sessionId) {
      this.prefetchRuntime(sessionId, message.content || '');
    }

    if (sessionId && pendingResume) {
      try {
        await taskCreationFileMemoryStore.clearPendingResume(sessionId);
        await taskCreationFileMemoryStore.updateSessionState(sessionId, {
          stage: pendingResume.stage || 'executing',
          allowBackward: true,
        });
        await service.resumeTask(sessionId, message.content || pendingResume.lastUserInput);
        await this.syncSessionStateFromCurrentStage(sessionId);
        return;
      } catch (error) {
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
        await service.createTask(resumedInput, undefined, sessionId, 'user_response');
        await this.syncSessionStateFromCurrentStage(sessionId);
        return;
      } catch (error) {
        await taskCreationFileMemoryStore.updateSessionState(sessionId, {
          status: isAwaitingUserInputError(error) ? 'waiting_user' : 'failed',
          stage: isAwaitingUserInputError(error) ? 'clarifying' : 'failed',
        });
        throw error;
      }
    }

    try {
      await service.createTask(
        message.content!,
        undefined,
        sessionId,
        (message.type as any) || 'user_input'
      );
      if (sessionId) {
        await this.syncSessionStateFromCurrentStage(sessionId);
      }
    } catch (error) {
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

    this.sessionByClient.set(clientId, taskSessionId);

    const orchestratorSessionId = String((message.metadata as any)?.orchestratorSessionId || '').trim();
    const workspacePath = String((message.metadata as any)?.workspacePath || '').trim();

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
        const executor = String((message.metadata as any)?.executor || '').trim() || 'opencode';
        await taskCreationFileMemoryStore.updateSessionExecutor(taskSessionId, executor);
        await taskCreationFileMemoryStore.updateSessionState(taskSessionId, {
          stage: 'executing',
          phase: 'development',
        });
        try {
          const existing = await taskCreationSessionDAO.getSession(taskSessionId);
          if (!existing) {
            await taskCreationSessionDAO.createSession({ id: taskSessionId, status: 'in_progress' });
          }
          await taskCreationSessionDAO.addMessage({
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
        const executor = String((message.metadata as any)?.executor || '').trim() || 'opencode';
        await taskCreationFileMemoryStore.updateSessionExecutor(taskSessionId, executor);
      }

      await taskCreationFileMemoryStore.addMessage(taskSessionId, 'user', 'user_input', message.content || '');
      try {
        await taskCreationSessionDAO.addMessage({
          sessionId: taskSessionId,
          role: 'user',
          messageType: 'user_input',
          content: message.content || '',
        });
      } catch (error) {
        console.warn('[OPENCODE_INPUT_MESSAGE_DB_FAILED]', error);
      }

      await opencodeRemoteService.sendUserInput({
        taskSessionId,
        content: message.content || '',
        orchestratorSessionId: orchestratorSessionId || undefined,
        workspacePath: workspacePath || undefined,
      });

      // 直通模式不注入额外状态消息，避免污染 OpenCode 原始对话流。
    } catch (error) {
      const errText = error instanceof Error ? error.message : 'OpenCode 执行失败';
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
  }
}

/**
 * 导出单例实例
 */
export const taskCreationWebSocketService = new TaskCreationWebSocketService();
