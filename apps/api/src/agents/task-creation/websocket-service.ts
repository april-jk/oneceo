/**
 * WebSocket 服务
 * 
 * 负责 WebSocket 连接管理和消息推送
 */

import { WebSocket, WebSocketServer } from 'ws';
import { TaskCreationService } from './task-creation-service';
import type { WebSocketMessage } from './types/intent';

export class TaskCreationWebSocketService {
  private wss: WebSocketServer | null = null;
  private clients: Map<string, WebSocket> = new Map();
  private services: Map<string, TaskCreationService> = new Map();

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
          await this.handleMessage(clientId, message);
        } catch (error: any) {
          console.error('[WebSocket] 消息处理失败:', error);
          this.sendToClient(clientId, {
            type: 'error' as any,
            message: error.message || '消息处理失败',
          });
        }
      });

      // 处理断开连接
      ws.on('close', () => {
        console.log(`[WebSocket] 客户端断开: ${clientId}`);
        this.clients.delete(clientId);
        this.services.delete(clientId);
      });

      // 发送欢迎消息
      this.sendToClient(clientId, {
        type: 'agent_message' as any,
        agent: 'system',
        content: '欢迎使用 Altus 任务创建助手！请描述您想要创建的任务。',
      });
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
        if (!message.content) {
          throw new Error('用户输入不能为空');
        }
        await service.createTask(message.content);
        break;

      case 'user_response' as any:
        // 处理用户对澄清问题的回复
        // 这个会在 askUser 的 Promise 中处理
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
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * 向用户提问并等待回复
   */
  private askUser(clientId: string, question: string, options?: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const ws = this.clients.get(clientId);
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket 连接已断开'));
        return;
      }

      // 发送澄清请求
      this.sendToClient(clientId, {
        type: 'clarification_request' as any,
        question,
        options,
      });

      // 监听用户回复
      const messageHandler = (data: Buffer) => {
        try {
          const message: WebSocketMessage = JSON.parse(data.toString());
          
          if (message.type === 'user_response' as any && message.content) {
            ws.off('message', messageHandler);
            resolve(message.content);
          }
        } catch (error) {
          // 忽略解析错误，继续等待
        }
      };

      ws.on('message', messageHandler);

      // 设置超时
      setTimeout(() => {
        ws.off('message', messageHandler);
        reject(new Error('用户回复超时'));
      }, 60000); // 60秒超时
    });
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
    }
  }
}

/**
 * 导出单例实例
 */
export const taskCreationWebSocketService = new TaskCreationWebSocketService();
