import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { Duplex } from 'stream';

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

type KvmRelayOptions = {
  wsUrl: string;
  subprotocol?: string;
  connectTimeoutMs?: number;
};

const relayDebugEnabled = String(process.env.OSAC_KVM_RELAY_DEBUG || '')
  .trim()
  .toLowerCase() === 'true';

function relayDebugLog(event: string, payload: Record<string, unknown>) {
  if (!relayDebugEnabled) return;
  try {
    console.log('[OSAC_KVM_RELAY]', JSON.stringify({ event, ...payload }));
  } catch {
    // ignore debug log failures
  }
}

function relayPreview(buf: Buffer, maxBytes: number = 32) {
  const slice = buf.subarray(0, Math.max(0, maxBytes));
  const hex = slice.toString('hex');
  const ascii = slice.toString('utf8').replace(/[^\x20-\x7e]/g, '.');
  return {
    hex,
    ascii,
  };
}

function withBootstrapMessageQuery(url: string, message: OsacMessage | null | undefined): string {
  if (!message) return url;
  try {
    const encoded = Buffer.from(JSON.stringify(message), 'utf8').toString('base64url');
    const parsed = new URL(url);
    parsed.searchParams.set('bootstrapMessage', encoded);
    return parsed.toString();
  } catch {
    return url;
  }
}

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

function toBuffer(data: WebSocket.RawData): Buffer {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (Array.isArray(data)) {
    const chunks = data.map((part) => (Buffer.isBuffer(part) ? part : Buffer.from(part)));
    return Buffer.concat(chunks);
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }
  if (ArrayBuffer.isView(data as any)) {
    const view = data as unknown as ArrayBufferView;
    return Buffer.from(view.buffer, view.byteOffset, view.byteLength);
  }
  return Buffer.from(String(data));
}

class KvmRelaySocket extends Duplex {
  private outerWs: WebSocket;
  private readonly pendingWrites: Array<{ chunk: Buffer; cb: (error?: Error | null) => void }> = [];
  private connected = false;
  private relayClosed = false;
  private readonly connectTimer: NodeJS.Timeout;

  constructor(private readonly relay: KvmRelayOptions) {
    super({ allowHalfOpen: false });
    const protocol = relay.subprotocol || 'kvm.tcp.v1';
    this.outerWs = new WebSocket(relay.wsUrl, protocol);

    this.connectTimer = setTimeout(() => {
      if (this.connected || this.relayClosed) return;
      this.relayClosed = true;
      this.flushPending(new Error('KVM Relay 连接超时'));
      try {
        this.outerWs.terminate();
      } catch {
        // ignore
      }
      this.destroy(new Error('KVM Relay 连接超时'));
    }, Math.max(1000, relay.connectTimeoutMs || 5000));
    if (typeof this.connectTimer.unref === 'function') {
      this.connectTimer.unref();
    }

    this.outerWs.on('open', () => {
      if (this.relayClosed) return;
      this.connected = true;
      clearTimeout(this.connectTimer);
      this.emit('connect');
      this.flushPending();
    });

    this.outerWs.on('message', (data) => {
      if (this.relayClosed) return;
      const buf = toBuffer(data);
      if (buf.length === 0) return;
      this.push(buf);
    });

    this.outerWs.on('close', (code, reason) => {
      if (this.relayClosed) return;
      this.relayClosed = true;
      clearTimeout(this.connectTimer);
      const reasonText = Buffer.isBuffer(reason) ? reason.toString('utf8') : String(reason || '');
      const error =
        !this.connected
          ? new Error(`KVM Relay 提前关闭: code=${code} reason=${reasonText}`)
          : null;
      this.flushPending(error || undefined);
      if (error) {
        this.destroy(error);
      } else {
        this.push(null);
      }
    });

    this.outerWs.on('error', (error) => {
      if (this.relayClosed) return;
      this.relayClosed = true;
      clearTimeout(this.connectTimer);
      const err = error instanceof Error ? error : new Error(String(error));
      this.flushPending(err);
      this.destroy(err);
    });
  }

  setTimeout(_msecs?: number, _callback?: () => void): this {
    return this;
  }

  setNoDelay(_noDelay?: boolean): this {
    return this;
  }

  setKeepAlive(_enable?: boolean, _initialDelay?: number): this {
    return this;
  }

  _read(_size: number): void {
    // no-op, data is pushed by outer websocket `message`
  }

  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    if (this.relayClosed) {
      callback(new Error('KVM Relay 连接已关闭'));
      return;
    }

    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    relayDebugLog('write', {
      connected: this.connected,
      relayClosed: this.relayClosed,
      bytes: buf.length,
      ...relayPreview(buf),
    });
    if (!this.connected) {
      this.pendingWrites.push({ chunk: buf, cb: callback });
      return;
    }

    this.outerWs.send(buf, { binary: true }, (error?: Error) => {
      relayDebugLog('write_sent', {
        bytes: buf.length,
        ok: !error,
        error: error ? error.message : null,
      });
      callback(error || null);
    });
  }

  _final(callback: (error?: Error | null) => void): void {
    if (this.relayClosed) {
      callback();
      return;
    }
    try {
      this.outerWs.close();
    } catch {
      // ignore close errors
    }
    callback();
  }

  _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    this.relayClosed = true;
    clearTimeout(this.connectTimer);
    try {
      if (this.outerWs.readyState === WebSocket.OPEN || this.outerWs.readyState === WebSocket.CONNECTING) {
        this.outerWs.terminate();
      }
    } catch {
      // ignore terminate errors
    }
    this.flushPending(error || undefined);
    callback(error || null);
  }

  private flushPending(error?: Error): void {
    while (this.pendingWrites.length > 0) {
      const current = this.pendingWrites.shift();
      if (!current) continue;
      if (error) {
        current.cb(error);
        continue;
      }
      this.outerWs.send(current.chunk, { binary: true }, (sendError?: Error) => {
        relayDebugLog('write_flush_sent', {
          bytes: current.chunk.length,
          ok: !sendError,
          error: sendError ? sendError.message : null,
        });
        current.cb(sendError || null);
      });
    }
  }
}

export class OsacClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private pingTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly url: string,
    private readonly options: {
      authToken?: string | null;
      connectTimeoutMs: number;
      requestTimeoutMs: number;
      kvmRelay?: KvmRelayOptions;
      bootstrapMessage?: OsacMessage;
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

    const relay = this.options.kvmRelay;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const connectUrl = withBootstrapMessageQuery(this.url, this.options.bootstrapMessage);
      relayDebugLog('connect_url', {
        relay: Boolean(relay),
        hasBootstrapMessage: Boolean(this.options.bootstrapMessage),
        connectUrl,
      });
      const ws = relay
        ? new WebSocket(connectUrl, {
            headers,
            handshakeTimeout: Math.max(1000, this.options.connectTimeoutMs),
            createConnection: () => {
              return new KvmRelaySocket({
                wsUrl: relay.wsUrl,
                subprotocol: relay.subprotocol || 'kvm.tcp.v1',
                connectTimeoutMs: relay.connectTimeoutMs || this.options.connectTimeoutMs,
              }) as unknown as Duplex;
            },
          })
        : new WebSocket(connectUrl, { headers });
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
        this.startPing(ws);
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

    ws.on('ping', (data) => {
      try {
        ws.pong(data);
      } catch {
        // ignore pong errors
      }
    });

    ws.on('close', () => {
      this.emit('close');
      this.flushPending(new Error('OSAC WebSocket 已断开'));
      this.stopPing();
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

  private startPing(ws: WebSocket) {
    const intervalMs = Number(process.env.OSAC_CLIENT_PING_INTERVAL_MS || 15000);
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) return;
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      try {
        ws.ping();
      } catch {
        // ignore ping errors
      }
    }, Math.max(1000, Math.floor(intervalMs)));
    if (this.pingTimer && typeof this.pingTimer.unref === 'function') {
      this.pingTimer.unref();
    }
  }

  private stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
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
