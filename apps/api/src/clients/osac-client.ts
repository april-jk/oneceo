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

function firstHeader(value: string | string[] | undefined): string | null {
  if (!value) return null;
  if (Array.isArray(value)) {
    return value[0] || null;
  }
  return value;
}

function parseBodyErrorCode(body: string): string | null {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const error = parsed?.error as Record<string, unknown> | undefined;
    const code = error?.code;
    if (typeof code === 'string' && code.trim()) {
      return code.trim();
    }
  } catch {
    // ignore parse errors
  }
  return null;
}

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
      const value = `Bearer ${this.options.authToken}`;
      headers.Authorization = value;
    }

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(this.url, { headers });
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        ws.terminate();
        reject(new Error('OSAC WebSocket 连接超时'));
      }, this.options.connectTimeoutMs);

      ws.on('open', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.ws = ws;
        this.attachListeners(ws);
        resolve();
      });

      ws.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(err instanceof Error ? err : new Error('OSAC WebSocket 连接失败'));
      });

      ws.on('unexpected-response', (req, res) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);

        const status = Number(res.statusCode || 0);
        const headerCode = firstHeader(res.headers['x-osac-auth-code']);
        let finished = false;
        const chunks: Buffer[] = [];
        let total = 0;
        const limit = 8192;

        const finalize = (bodyText: string) => {
          if (finished) return;
          finished = true;
          clearTimeout(bodyTimer);
          const bodyCode = parseBodyErrorCode(bodyText);
          const finalCode = headerCode || bodyCode;
          const codePart = finalCode ? ` code=${finalCode}` : '';
          reject(new Error(`OSAC WebSocket 握手失败: status=${status}${codePart}`));
        };

        const onData = (chunk: Buffer | string) => {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          if (total >= limit || buf.length === 0) {
            return;
          }
          const remain = limit - total;
          const sliced = buf.length > remain ? buf.subarray(0, remain) : buf;
          chunks.push(sliced);
          total += sliced.length;
        };

        const onEnd = () => {
          const bodyText = chunks.length > 0 ? Buffer.concat(chunks).toString('utf8') : '';
          finalize(bodyText);
        };

        // Drain socket data and swallow request/socket-level reset errors.
        (req as NodeJS.EventEmitter | undefined)?.on?.('error', () => finalize(''));
        ((req as any)?.socket as NodeJS.EventEmitter | undefined)?.on?.('error', () => finalize(''));
        (res.socket as NodeJS.EventEmitter | undefined)?.on?.('error', () => finalize(''));
        res.on('error', () => finalize(''));
        res.on('data', onData);
        res.on('end', onEnd);
        const bodyTimer = setTimeout(() => {
          const bodyText = chunks.length > 0 ? Buffer.concat(chunks).toString('utf8') : '';
          finalize(bodyText);
        }, 800);
        try {
          res.resume();
        } catch {
          finalize('');
        }
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
          return;
        }
      }

      // 兼容不返回 requestId 的响应
      for (const [id, pending] of this.pending.entries()) {
        if (pending.match(message)) {
          clearTimeout(pending.timeout);
          this.pending.delete(id);
          pending.resolve(message);
          break;
        }
      }
    });

    ws.on('close', () => {
      this.emit('close');
      this.flushPending(new Error('OSAC WebSocket 已断开'));
      this.ws = null;
    });

    ws.on('error', (error) => {
      // Avoid crashing process when no external error listener is attached.
      if (this.listenerCount('error') > 0) {
        this.emit('error', error);
      } else {
        console.warn('[OSAC_WS_ERROR]', error instanceof Error ? error.message : String(error));
      }
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

  isOpen(): boolean {
    return Boolean(this.ws && this.ws.readyState === WebSocket.OPEN);
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

  ping(timeoutMs: number = Number(process.env.OSAC_PING_TIMEOUT_MS || 5000)): Promise<void> {
    this.ensureConnected();
    const ws = this.ws!;
    return new Promise<void>((resolve, reject) => {
      let finished = false;
      const cleanup = () => {
        ws.off('pong', onPong);
        ws.off('close', onClose);
        ws.off('error', onError);
      };
      const done = (fn: () => void) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        cleanup();
        fn();
      };
      const onPong = () => done(() => resolve());
      const onClose = () => done(() => reject(new Error('OSAC WebSocket 已断开')));
      const onError = (error: Error) => done(() => reject(error));
      const timer = setTimeout(() => {
        done(() => {
          // Do not force-terminate on ping timeout.
          // Abrupt terminate can keep server-side candidate/active stale for a window.
          reject(new Error('OSAC WebSocket ping 超时'));
        });
      }, Math.max(1000, timeoutMs));

      ws.once('pong', onPong);
      ws.once('close', onClose);
      ws.once('error', onError);
      try {
        ws.ping();
      } catch (error) {
        done(() => reject(error instanceof Error ? error : new Error(String(error))));
      }
    });
  }

  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}
