import WebSocket from 'ws';
import { EventEmitter } from 'events';

export type OsacMessage = {
  type: string;
  payload?: Record<string, unknown>;
  requestId?: string;
};

type PendingRequest = {
  resolve: (message: OsacMessage) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  match: (message: OsacMessage) => boolean;
};

export class OsacClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();

  constructor(
    private readonly url: string,
    private readonly options: {
      authToken?: string | null;
      connectTimeoutMs: number;
      requestTimeoutMs: number;
    }
  ) {
    super();
  }

  async connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    const headers: Record<string, string> = {};
    if (this.options.authToken) {
      headers.authorization = `Bearer ${this.options.authToken}`;
    }

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.url, { headers });
      const timeout = setTimeout(() => {
        ws.terminate();
        reject(new Error('OSAC WebSocket 连接超时'));
      }, this.options.connectTimeoutMs);

      ws.on('open', () => {
        clearTimeout(timeout);
        this.ws = ws;
        this.attachListeners(ws);
        resolve();
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err instanceof Error ? err : new Error('OSAC WebSocket 连接失败'));
      });
    });
  }

  private attachListeners(ws: WebSocket) {
    ws.on('message', (data) => {
      const message = this.parseMessage(data);
      if (!message) {
        return;
      }

      this.emit('message', message);

      if (message.requestId && this.pending.has(message.requestId)) {
        const pending = this.pending.get(message.requestId);
        if (pending && pending.match(message)) {
          clearTimeout(pending.timeout);
          this.pending.delete(message.requestId);
          pending.resolve(message);
        }
      }
    });

    ws.on('close', () => {
      this.emit('close');
      this.flushPending(new Error('OSAC WebSocket 已断开'));
      this.ws = null;
    });

    ws.on('error', (error) => {
      this.emit('error', error);
    });
  }

  private parseMessage(data: WebSocket.Data): OsacMessage | null {
    try {
      const payload = JSON.parse(data.toString());
      if (!payload || typeof payload !== 'object') {
        return null;
      }
      return {
        type: String(payload.type || ''),
        payload: (payload.payload || undefined) as Record<string, unknown> | undefined,
        requestId: payload.requestId || payload.payload?.requestId,
      };
    } catch {
      return null;
    }
  }

  private flushPending(error: Error) {
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  private ensureConnected() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('OSAC WebSocket 尚未连接');
    }
  }

  send(message: OsacMessage) {
    this.ensureConnected();
    this.ws?.send(JSON.stringify(message));
  }

  request(message: OsacMessage, match?: (reply: OsacMessage) => boolean): Promise<OsacMessage> {
    this.ensureConnected();

    const requestId = message.requestId || `osac_req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const finalMessage: OsacMessage = {
      ...message,
      requestId,
      payload: {
        ...(message.payload || {}),
        requestId,
      },
    };

    const matcher =
      match ||
      ((reply: OsacMessage) => {
        return reply.requestId === requestId;
      });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('OSAC 请求超时'));
      }, this.options.requestTimeoutMs);

      this.pending.set(requestId, {
        resolve,
        reject,
        timeout,
        match: matcher,
      });

      this.send(finalMessage);
    });
  }

  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}
