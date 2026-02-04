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
import { AwaitingUserInputError, isAwaitingUserInputError } from './errors';

export class TaskCreationWebSocketService {
  private wss: WebSocketServer | null = null;
  private clients: Map<string, WebSocket> = new Map();
  private services: Map<string, TaskCreationService> = new Map();
  private sessionByClient: Map<string, string> = new Map();

  /**
   * 初始化 WebSocket 服务器
   */
  initialize(server: any): void {
    this.wss = new WebSocketServer({ server, path: '/ws/task-creation' });

    this.wss.on('connection', (ws: WebSocket, req: any) => {
      const clientId = this.generateClientId();
      this.clients.set(clientId, ws);

      console.log(`[WebSocket] 客户端连接: ${clientId}`);

      // 创建任务创建服务实例
      const service = new TaskCreationService({
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

      default:
        throw new Error(`未知的消息类型: ${message.type}`);
    }
  }

  /**
   * 向客户端发送消息
   */
  private sendToClient(clientId: string, message: WebSocketMessage): void {
    const ws = this.clients.get(clientId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      console.log(`[WebSocket] 发送消息 to ${clientId}:`, message.type);
      const sessionId = this.sessionByClient.get(clientId) || message.sessionId;
      if (sessionId) {
        const content = message.content || message.message || message.question || '';
        if (content) {
          void taskCreationFileMemoryStore.addMessage(
            sessionId,
            'agent',
            message.type,
            content,
            {
              ...message.metadata,
              options: message.options,
              plan: message.plan,
            }
          );
        }
      }
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

  /**
   * 向用户提问并等待回复
   */
  private askUser(clientId: string, question: string, options?: string[]): Promise<string> {
    console.log(`[WebSocket] 向用户提问: ${question}`);
    const sessionId = this.sessionByClient.get(clientId);
    if (sessionId) {
      void taskCreationFileMemoryStore.updateSessionStatus(sessionId, 'waiting_user');
    }

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
    let sessionId = message.sessionId || this.sessionByClient.get(clientId);
    if (!sessionId) {
      const session = await taskCreationFileMemoryStore.createSession(message.content || '新建任务');
      sessionId = session.id;
      await taskCreationFileMemoryStore.addMessage(
        sessionId,
        'system',
        'session_started',
        '会话已创建'
      );
    }
    if (sessionId) {
      this.sessionByClient.set(clientId, sessionId);
      await taskCreationFileMemoryStore.addMessage(
        sessionId,
        'user',
        message.type,
        message.content || ''
      );
    }

    if (sessionId && (await this.isWaitingForUser(sessionId))) {
      try {
        const resumedInput = await this.buildResumedInput(sessionId, message.content!);
        await service.createTask(resumedInput);
        await taskCreationFileMemoryStore.updateSessionStatus(sessionId, 'completed');
        return;
      } catch (error) {
        await taskCreationFileMemoryStore.updateSessionStatus(
          sessionId,
          isAwaitingUserInputError(error) ? 'waiting_user' : 'failed'
        );
        throw error;
      }
    }

    try {
      await service.createTask(message.content!);
      if (sessionId) {
        await taskCreationFileMemoryStore.updateSessionStatus(sessionId, 'completed');
      }
    } catch (error) {
      if (sessionId) {
        await taskCreationFileMemoryStore.updateSessionStatus(
          sessionId,
          isAwaitingUserInputError(error) ? 'waiting_user' : 'failed'
        );
      }
      throw error;
    }
  }

  private async isWaitingForUser(sessionId: string): Promise<boolean> {
    const session = await taskCreationFileMemoryStore.getSession(sessionId);
    return session?.status === 'waiting_user';
  }

  private async buildResumedInput(sessionId: string, latestResponse: string): Promise<string> {
    const messages = await taskCreationFileMemoryStore.getMessages(sessionId);
    const firstUserInput = messages.find((m) => m.messageType === 'user_input')?.content || '';
    const previousResponses = messages
      .filter((m) => m.messageType === 'user_response')
      .map((m) => m.content);
    const allResponses = [...previousResponses, latestResponse]
      .map((text, index) => `补充${index + 1}: ${text}`)
      .join('\n');

    return `${firstUserInput}\n\n用户补充信息：\n${allResponses}`;
  }

  /**
   * 生成客户端 ID
   */
  private generateClientId(): string {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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
    }
  }
}

/**
 * 导出单例实例
 */
export const taskCreationWebSocketService = new TaskCreationWebSocketService();
