import { osacConnector, type OsacConnectionHandle } from '../connectors/osac-connector';
import type { OsacMessage } from '../clients/osac-client';

type ConnectionEntry = {
  handle: OsacConnectionHandle;
  lastUsedAt: number;
  messages: OsacMessage[];
};

type PendingConnect = {
  promise: Promise<ConnectionEntry>;
};

type MessageHandler = (sessionId: string, message: OsacMessage) => void | Promise<void>;
type ConnectionOperationOptions = {
  connectAcquireTimeoutMs?: number;
};

export class OsacConnectionManager {
  private connections = new Map<string, ConnectionEntry>();
  private connecting = new Map<string, PendingConnect>();
  private reconnectFailures = new Map<string, number>();
  private maxMessages = 300;
  private handlers: MessageHandler[] = [];
  private persistentSessions = new Set<string>();
  private reconnectTimers = new Map<string, NodeJS.Timeout>();
  private reconnectDelayMs = Number(process.env.OSAC_RECONNECT_DELAY_MS || 3000);
  private maxReconnectFailures = Number(process.env.OSAC_RECONNECT_MAX_FAILURES || 5);
  private reconnectMaxDelayMs = Number(process.env.OSAC_RECONNECT_MAX_DELAY_MS || 15000);
  private reconnectImmediateAttempts = Number(process.env.OSAC_RECONNECT_IMMEDIATE_ATTEMPTS || 3);
  private reconnectGiveupEnabled =
    String(process.env.OSAC_RECONNECT_GIVEUP_ENABLED || 'false').trim().toLowerCase() === 'true';
  private reconnectAbortCodes = new Set(
    String(process.env.OSAC_RECONNECT_ABORT_CODES || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  );
  private reconnectAbortCodeThreshold = Number(process.env.OSAC_RECONNECT_ABORT_CODE_THRESHOLD || 5);
  private persistentConnectAttempts = Number(process.env.OSAC_PERSISTENT_CONNECT_ATTEMPTS || 3);
  private persistentConnectDelayMs = Number(process.env.OSAC_PERSISTENT_CONNECT_DELAY_MS || 1500);
  private persistentHealthCheckMs = Number(process.env.OSAC_PERSISTENT_HEALTHCHECK_MS || 8000);
  private healthCheckMode = (process.env.OSAC_HEALTHCHECK_MODE || 'ping').trim().toLowerCase();
  private healthCheckPingTimeoutMs = Number(process.env.OSAC_HEALTHCHECK_PING_TIMEOUT_MS || 5000);
  private defaultOperationConnectAcquireTimeoutMs = Number(
    process.env.OSAC_OPERATION_CONNECT_ACQUIRE_TIMEOUT_MS || 0
  );
  private healthTimer: NodeJS.Timeout | null = null;
  private healthChecking = false;

  constructor() {
    if (this.persistentHealthCheckMs > 0) {
      this.healthTimer = setInterval(() => {
        void this.healthCheckPersistentSessions();
      }, this.persistentHealthCheckMs);
      if (typeof this.healthTimer.unref === 'function') {
        this.healthTimer.unref();
      }
    }
  }

  private resolveConnectAcquireTimeoutMs(raw: number | undefined): number | undefined {
    if (raw !== undefined) {
      if (!Number.isFinite(raw)) {
        return undefined;
      }
      const normalized = Math.max(0, Math.floor(raw));
      return normalized > 0 ? normalized : undefined;
    }

    if (!Number.isFinite(this.defaultOperationConnectAcquireTimeoutMs)) {
      return undefined;
    }
    const normalized = Math.max(0, Math.floor(this.defaultOperationConnectAcquireTimeoutMs));
    return normalized > 0 ? normalized : undefined;
  }

  private async waitForConnection(
    sessionId: string,
    promise: Promise<ConnectionEntry>,
    connectAcquireTimeoutMs?: number
  ): Promise<ConnectionEntry> {
    const timeoutMs = this.resolveConnectAcquireTimeoutMs(connectAcquireTimeoutMs);
    if (!timeoutMs) {
      return promise;
    }

    let timer: NodeJS.Timeout | null = null;
    try {
      return await Promise.race([
        promise,
        new Promise<ConnectionEntry>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error(`OSAC connection acquiring timeout code=reconnect_in_progress sessionId=${sessionId}`));
          }, timeoutMs);
          if (timer && typeof timer.unref === 'function') {
            timer.unref();
          }
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  async getConnection(sessionId: string, options?: ConnectionOperationOptions): Promise<ConnectionEntry> {
    const existing = this.connections.get(sessionId);
    if (existing) {
      if (!existing.handle.isOpen()) {
        existing.handle.close();
        this.connections.delete(sessionId);
      } else {
        existing.lastUsedAt = Date.now();
        return existing;
      }
    }

    const pending = this.connecting.get(sessionId);
    if (pending) {
      return this.waitForConnection(sessionId, pending.promise, options?.connectAcquireTimeoutMs);
    }

    const promise = this.createConnection(sessionId)
      .then((entry) => {
        this.connections.set(sessionId, entry);
        this.reconnectFailures.delete(sessionId);
        this.clearReconnectTimer(sessionId);
        return entry;
      })
      .finally(() => {
        this.connecting.delete(sessionId);
      });
    this.connecting.set(sessionId, { promise });

    return this.waitForConnection(sessionId, promise, options?.connectAcquireTimeoutMs);
  }

  private async createConnection(sessionId: string): Promise<ConnectionEntry> {
    const handle = await osacConnector.connectForSession(sessionId);
    const entry: ConnectionEntry = {
      handle,
      lastUsedAt: Date.now(),
      messages: [],
    };

    handle.onMessage((message) => {
      const debug = String(process.env.OSAC_LLM_PROXY_DEBUG || '').toLowerCase() === 'true';
      if (debug && (String(message.type || '').startsWith('LLM_PROXY_') || message.type === 'HEARTBEAT')) {
        const payload = (message.payload || {}) as Record<string, unknown>;
        console.log('[OSAC_RECV]', JSON.stringify({
          sessionId,
          type: message.type,
          requestId: payload.requestId || message.requestId || null,
          path: payload.path || null,
          status: payload.status || null,
        }));
      }
      entry.messages.push(message);
      if (entry.messages.length > this.maxMessages) {
        entry.messages.splice(0, entry.messages.length - this.maxMessages);
      }
      for (const handler of this.handlers) {
        Promise.resolve(handler(sessionId, message)).catch((error) => {
          console.warn('[OSAC_HANDLER_ERROR]', error);
        });
      }
    });

    handle.onClose(() => {
      const existing = this.connections.get(sessionId);
      if (existing?.handle === handle) {
        this.connections.delete(sessionId);
      }
      this.triggerReconnectNow(sessionId);
    });

    return entry;
  }

  private isSocketNotConnectedError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes('OSAC WebSocket 尚未连接');
  }

  private isReconnectInProgressError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes('code=reconnect_in_progress');
  }

  private clearReconnectTimer(sessionId: string) {
    const timer = this.reconnectTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(sessionId);
    }
  }

  private computeReconnectDelayMs(failures: number, immediate: boolean): number {
    if (immediate) {
      return 50;
    }

    const immediateAttempts = Number.isFinite(this.reconnectImmediateAttempts)
      ? Math.max(0, Math.floor(this.reconnectImmediateAttempts))
      : 0;
    if (failures <= immediateAttempts) {
      return 50;
    }

    const baseDelay = Number.isFinite(this.reconnectDelayMs) ? Math.max(100, this.reconnectDelayMs) : 1000;
    const maxDelay = Number.isFinite(this.reconnectMaxDelayMs)
      ? Math.max(baseDelay, this.reconnectMaxDelayMs)
      : 15000;
    const exp = Math.max(0, Math.min(6, failures - immediateAttempts - 1));
    const backoff = Math.min(maxDelay, baseDelay * Math.pow(2, exp));
    const jitter = Math.floor(Math.random() * 150);
    return backoff + jitter;
  }

  private extractReconnectErrorCode(error: unknown): string | null {
    const text = error instanceof Error ? error.message : String(error);
    const match = text.match(/\bcode=([a-zA-Z0-9_.-]+)/);
    return match?.[1] || null;
  }

  private shouldAbortReconnect(error: unknown): { abort: boolean; code: string | null } {
    const code = this.extractReconnectErrorCode(error);
    if (!code) {
      return { abort: false, code: null };
    }
    return { abort: this.reconnectAbortCodes.has(code), code };
  }

  private scheduleReconnect(sessionId: string, immediate: boolean = false) {
    if (!this.persistentSessions.has(sessionId)) {
      return;
    }
    if (this.connecting.has(sessionId)) {
      return;
    }
    if (this.reconnectTimers.has(sessionId)) {
      if (!immediate) {
        return;
      }
      this.clearReconnectTimer(sessionId);
    }

    const failures = this.reconnectFailures.get(sessionId) || 0;
    const delayMs = this.computeReconnectDelayMs(failures, immediate);
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(sessionId);
      void this.getConnection(sessionId).catch((error) => {
        const nextFailures = (this.reconnectFailures.get(sessionId) || 0) + 1;
        this.reconnectFailures.set(sessionId, nextFailures);
        const abortCheck = this.shouldAbortReconnect(error);
        console.warn('[OSAC_RECONNECT_ERROR]', sessionId, nextFailures, abortCheck.code || '', error);

        if (abortCheck.abort && nextFailures >= this.reconnectAbortCodeThreshold) {
          console.warn(
            '[OSAC_RECONNECT_ABORT_CODE]',
            sessionId,
            abortCheck.code,
            nextFailures,
            this.reconnectAbortCodeThreshold
          );
          this.persistentSessions.delete(sessionId);
          this.clearReconnectTimer(sessionId);
          return;
        }

        if (this.reconnectGiveupEnabled && nextFailures >= this.maxReconnectFailures) {
          console.warn('[OSAC_RECONNECT_GIVEUP]', sessionId, nextFailures);
          this.persistentSessions.delete(sessionId);
          this.clearReconnectTimer(sessionId);
          return;
        }

        this.scheduleReconnect(sessionId);
      });
    }, delayMs);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
    this.reconnectTimers.set(sessionId, timer);
  }

  private triggerReconnectNow(sessionId: string) {
    if (!this.persistentSessions.has(sessionId)) {
      return;
    }
    this.scheduleReconnect(sessionId, true);
  }

  private async healthCheckPersistentSessions() {
    if (this.healthChecking || this.persistentSessions.size === 0) {
      return;
    }
    this.healthChecking = true;
    const sessions = Array.from(this.persistentSessions.values());
    try {
      for (const sessionId of sessions) {
        if (this.connecting.has(sessionId)) {
          continue;
        }
        try {
          const entry = await this.getConnection(sessionId);
          if (this.healthCheckMode === 'request') {
            await entry.handle.request(
              {
                type: 'GET_SESSION_LIST',
                payload: { maxCount: 1, format: 'json' },
              },
              (message) => message.type === 'SESSION_LIST_RESPONSE'
            );
          } else {
            await entry.handle.ping(this.healthCheckPingTimeoutMs);
          }
        } catch (error) {
          console.warn(
            '[OSAC_HEALTHCHECK_ERROR]',
            sessionId,
            error instanceof Error ? error.message : String(error)
          );
          this.dropConnection(sessionId);
          this.triggerReconnectNow(sessionId);
        }
      }
    } finally {
      this.healthChecking = false;
    }
  }

  async ensurePersistent(sessionId: string): Promise<boolean> {
    this.persistentSessions.add(sessionId);
    const attempts = Number.isFinite(this.persistentConnectAttempts) && this.persistentConnectAttempts > 0
      ? Math.floor(this.persistentConnectAttempts)
      : 1;
    const delayMs = Number.isFinite(this.persistentConnectDelayMs) && this.persistentConnectDelayMs >= 0
      ? Math.floor(this.persistentConnectDelayMs)
      : 0;

    for (let i = 0; i < attempts; i++) {
      try {
        await this.getConnection(sessionId);
        this.reconnectFailures.delete(sessionId);
        return true;
      } catch (error) {
        console.warn('[OSAC_PERSISTENT_CONNECT_ERROR]', sessionId, error);
        if (i < attempts - 1 && delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }
    if (this.reconnectGiveupEnabled) {
      this.persistentSessions.delete(sessionId);
      this.reconnectFailures.delete(sessionId);
      this.clearReconnectTimer(sessionId);
    } else {
      this.triggerReconnectNow(sessionId);
    }
    return false;
  }

  private dropConnection(sessionId: string) {
    const existing = this.connections.get(sessionId);
    if (existing) {
      existing.handle.close();
      this.connections.delete(sessionId);
    }
  }

  registerMessageHandler(handler: MessageHandler) {
    this.handlers.push(handler);
  }

  async close(sessionId: string) {
    this.persistentSessions.delete(sessionId);
    this.reconnectFailures.delete(sessionId);
    this.clearReconnectTimer(sessionId);
    this.dropConnection(sessionId);
  }

  listMessages(sessionId: string, limit: number = 50): OsacMessage[] {
    const existing = this.connections.get(sessionId);
    if (!existing) {
      return [];
    }
    return existing.messages.slice(-limit);
  }

  getMessageCount(sessionId: string): number {
    const existing = this.connections.get(sessionId);
    return existing ? existing.messages.length : 0;
  }

  getMessagesSince(sessionId: string, offset: number): OsacMessage[] {
    const existing = this.connections.get(sessionId);
    if (!existing) {
      return [];
    }
    return existing.messages.slice(offset);
  }

  async send(sessionId: string, message: OsacMessage, options?: ConnectionOperationOptions) {
    const debug = String(process.env.OSAC_LLM_PROXY_DEBUG || '').toLowerCase() === 'true';
    if (debug && String(message.type || '').startsWith('LLM_PROXY_')) {
      const payload = (message.payload || {}) as Record<string, unknown>;
      console.log('[OSAC_SEND]', JSON.stringify({
        sessionId,
        type: message.type,
        requestId: payload.requestId || message.requestId || null,
        status: payload.status || null,
      }));
    }
    try {
      const entry = await this.getConnection(sessionId, options);
      entry.lastUsedAt = Date.now();
      entry.handle.send(message);
    } catch (error) {
      if (debug && String(message.type || '').startsWith('LLM_PROXY_')) {
        console.error('[OSAC_SEND_ERROR]', JSON.stringify({
          sessionId,
          type: message.type,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
      if (this.isSocketNotConnectedError(error)) {
        this.dropConnection(sessionId);
        const entry = await this.getConnection(sessionId, options);
        entry.lastUsedAt = Date.now();
        entry.handle.send(message);
        return;
      }
      if (this.isReconnectInProgressError(error)) {
        this.triggerReconnectNow(sessionId);
        throw error;
      }
      this.triggerReconnectNow(sessionId);
      throw error;
    }
  }

  async request(
    sessionId: string,
    message: OsacMessage,
    match?: (reply: OsacMessage) => boolean,
    options?: ConnectionOperationOptions
  ): Promise<OsacMessage> {
    try {
      const entry = await this.getConnection(sessionId, options);
      entry.lastUsedAt = Date.now();
      return await entry.handle.request(message, match);
    } catch (error) {
      if (this.isSocketNotConnectedError(error)) {
        this.dropConnection(sessionId);
        const entry = await this.getConnection(sessionId, options);
        entry.lastUsedAt = Date.now();
        return await entry.handle.request(message, match);
      }
      if (this.isReconnectInProgressError(error)) {
        this.triggerReconnectNow(sessionId);
        throw error;
      }
      this.triggerReconnectNow(sessionId);
      throw error;
    }
  }
}

export const osacConnectionManager = new OsacConnectionManager();
