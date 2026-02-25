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

export class TaskCreationWebSocketService {
  private wss: WebSocketServer | null = null;
  private clients: Map<string, WebSocket> = new Map();
  private services: Map<string, TaskCreationService> = new Map();
  private sessionByClient: Map<string, string> = new Map();
  private sessionCleanupTimers: Map<string, NodeJS.Timeout> = new Map();
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

    switch (message.type) {
      case 'user_input' as any:
      case 'user_response' as any:
        if (!message.content) {
          throw new Error('用户输入不能为空');
        }
        console.log(`[WebSocket] 开始处理任务创建: ${message.content}`);
        await this.handleUserMessage(clientId, message, service);
        console.log(`[WebSocket] 任务创建完成`);
        break;
      case 'opencode_input' as any:
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
      await taskCreationFileMemoryStore.updateSessionStatus(sessionId, 'completed');
      await taskCreationFileMemoryStore.updateSessionStage(sessionId, 'completed');
      return;
    }
    if (stage === 'failed') {
      await taskCreationFileMemoryStore.updateSessionStatus(sessionId, 'failed');
      await taskCreationFileMemoryStore.updateSessionStage(sessionId, 'failed');
      return;
    }
    if (stage === 'clarifying') {
      await taskCreationFileMemoryStore.updateSessionStatus(sessionId, 'waiting_user');
      await taskCreationFileMemoryStore.updateSessionStage(sessionId, 'clarifying');
      return;
    }

    await taskCreationFileMemoryStore.updateSessionStatus(sessionId, 'in_progress');
    if (stage) {
      await taskCreationFileMemoryStore.updateSessionStage(sessionId, stage as any);
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
      if (message.type === 'status_update' && message.stage) {
        void taskCreationFileMemoryStore.updateSessionStage(sessionId, message.stage as any);
      }
      const metadata = {
        ...message.metadata,
        stage: message.stage,
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

    return Promise.reject(new AwaitingUserInputError());
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
      await taskCreationFileMemoryStore.updateSessionStage(sessionId, 'collecting');
      await taskCreationFileMemoryStore.addMessage(
        sessionId,
        'user',
        message.type,
        message.content || ''
      );
    }

    if (sessionId && pendingResume) {
      try {
        await taskCreationFileMemoryStore.clearPendingResume(sessionId);
        await taskCreationFileMemoryStore.updateSessionStage(sessionId, pendingResume.stage || 'executing');
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
        await taskCreationFileMemoryStore.updateSessionStatus(
          sessionId,
          isAwaitingUserInputError(error) ? 'waiting_user' : 'failed'
        );
        await taskCreationFileMemoryStore.updateSessionStage(
          sessionId,
          isAwaitingUserInputError(error) ? 'clarifying' : 'failed'
        );
        throw error;
      }
    }

    if (sessionId && wasWaitingForUser) {
      try {
        const resumedInput = await this.buildResumedInput(sessionId, message.content!);
        await taskCreationFileMemoryStore.clearPendingClarification(sessionId);
        await taskCreationFileMemoryStore.updateSessionStage(sessionId, 'planning');
        await service.createTask(resumedInput, undefined, sessionId, 'user_response');
        await this.syncSessionStateFromCurrentStage(sessionId);
        return;
      } catch (error) {
        await taskCreationFileMemoryStore.updateSessionStatus(
          sessionId,
          isAwaitingUserInputError(error) ? 'waiting_user' : 'failed'
        );
        await taskCreationFileMemoryStore.updateSessionStage(
          sessionId,
          isAwaitingUserInputError(error) ? 'clarifying' : 'failed'
        );
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
        await taskCreationFileMemoryStore.updateSessionStatus(
          sessionId,
          isAwaitingUserInputError(error) ? 'waiting_user' : 'failed'
        );
        await taskCreationFileMemoryStore.updateSessionStage(
          sessionId,
          isAwaitingUserInputError(error) ? 'clarifying' : 'failed'
        );
      }
      throw error;
    }
  }

  private async handleOpencodeInput(clientId: string, message: WebSocketMessage): Promise<void> {
    const taskSessionId =
      message.sessionId ||
      this.sessionByClient.get(clientId) ||
      (message.metadata as any)?.sessionId;

    if (!taskSessionId) {
      throw new Error('缺少 task sessionId，无法发送到 OpenCode');
    }

    this.sessionByClient.set(clientId, taskSessionId);

    const orchestratorSessionId = String((message.metadata as any)?.orchestratorSessionId || '').trim();
    const workspacePath = String((message.metadata as any)?.workspacePath || '').trim();

    try {
      await opencodeRemoteService.sendUserInput({
        taskSessionId,
        content: message.content || '',
        orchestratorSessionId: orchestratorSessionId || undefined,
        workspacePath: workspacePath || undefined,
      });

      this.sendToClient(clientId, {
        type: 'status_update' as any,
        sessionId: taskSessionId,
        stage: 'executing' as any,
        tone: 'execution' as any,
        content: '{OpenCode} 已接收输入，正在执行...',
      });
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

  private async buildResumedInput(sessionId: string, latestResponse: string): Promise<string> {
    const session = await taskCreationFileMemoryStore.getSession(sessionId);
    const messages = await taskCreationFileMemoryStore.getMessages(sessionId);
    const firstUserInput = messages.find((m) => m.messageType === 'user_input')?.content || '';
    const previousResponses = messages
      .filter((m) => m.messageType === 'user_response')
      .map((m) => m.content);
    const allResponses = [...previousResponses, latestResponse]
      .map((text, index) => `补充${index + 1}: ${text}`)
      .join('\n');

    const pendingQ = session?.pendingQuestion ? `\n\n待补充问题：${session.pendingQuestion}` : '';
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
