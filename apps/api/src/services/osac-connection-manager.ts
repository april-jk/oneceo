import { osacConnector, type OsacConnectionHandle } from '../connectors/osac-connector';
import type { OsacMessage } from '../clients/osac-client';
import { touchSandbox } from './sandbox-activity-service';

type ConnectionEntry = {
  handle: OsacConnectionHandle;
  lastUsedAt: number;
};

type PendingConnect = {
  promise: Promise<ConnectionEntry>;
};

type MessageHandler = (sessionId: string, message: OsacMessage) => void | Promise<void>;
type ConnectionOperationOptions = {
  connectAcquireTimeoutMs?: number;
};

function toBool(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function resolveStartNewVmSwitch(): boolean | null {
  const raw = (process.env.OSAC_START_NEW_VM || '').trim();
  if (!raw) return null;
  return toBool(raw, false);
}

function isFixedSessionMode(): boolean {
  const startNewVm = resolveStartNewVmSwitch();
  if (startNewVm === true) return false;
  if (startNewVm === false) return true;
  return toBool(process.env.OSAC_USE_FIXED_SANDBOX_SESSION, false);
}

export class OsacConnectionManager {
  private connections = new Map<string, ConnectionEntry>();
  private messageBuffers = new Map<string, OsacMessage[]>();
  private connecting = new Map<string, PendingConnect>();
  private reconnectFailures = new Map<string, number>();
  private maxMessages = Number(process.env.OSAC_MESSAGE_MAX_COUNT || 120);
  private maxPayloadChars = Number(process.env.OSAC_MESSAGE_MAX_CHARS || 15000);
  private maxBufferSessions = Number(process.env.OSAC_MESSAGE_BUFFER_MAX_SESSIONS || 200);
  private handlers: MessageHandler[] = [];
  private persistentSessions = new Set<string>();
  private bridgeReady = new Map<string, Promise<void>>();
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
  private fixedSessionMode = isFixedSessionMode();
  private defaultOperationConnectAcquireTimeoutMs = Number(
    process.env.OSAC_OPERATION_CONNECT_ACQUIRE_TIMEOUT_MS || 0
  );
  private healthTimer: NodeJS.Timeout | null = null;
  private healthChecking = false;

  constructor() {
    if (this.fixedSessionMode) {
      console.log('[OSAC_CONNECTION_MANAGER]', 'fixed_session_mode: disable background health check');
      return;
    }

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
      this.dispatchMessage(sessionId, message);
    });

    handle.onClose(() => {
      const existing = this.connections.get(sessionId);
      if (existing?.handle === handle) {
        this.connections.delete(sessionId);
      }
      this.bridgeReady.delete(sessionId);
      this.triggerReconnectNow(sessionId);
    });

    return entry;
  }

  private async ensureBridgeReady(sessionId: string, entry: ConnectionEntry): Promise<void> {
    const existing = this.bridgeReady.get(sessionId);
    if (existing) {
      await existing;
      return;
    }

    const probe = (async () => {
      await entry.handle.request(
        {
          type: 'GET_SESSION_LIST',
          payload: { maxCount: 1, format: 'json' },
        },
        (message) => message.type === 'SESSION_LIST_RESPONSE'
      );
    })();

    this.bridgeReady.set(sessionId, probe);
    try {
      await probe;
    } catch (error) {
      this.bridgeReady.delete(sessionId);
      throw error;
    }
  }

  private isSocketNotConnectedError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes('OSAC WebSocket 尚未连接');
  }

  private isReconnectInProgressError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes('code=reconnect_in_progress');
  }

  private isRequestTimeoutError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes('OSAC 请求超时') || /request timeout/i.test(message);
  }

  private isPingTimeoutError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes('OSAC WebSocket ping 超时') || /ping timeout/i.test(message);
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
    if (this.fixedSessionMode) {
      return;
    }
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
          if (this.isReconnectInProgressError(error)) {
            continue;
          }
          if (this.isRequestTimeoutError(error)) {
            // Request timeout alone is not enough evidence that socket is broken.
            // Keep current connection and let next health tick verify again.
            console.warn(
              '[OSAC_HEALTHCHECK_TIMEOUT]',
              sessionId,
              error instanceof Error ? error.message : String(error)
            );
            continue;
          }
          if (this.isPingTimeoutError(error)) {
            // Ping timeout can happen during OSAC candidate->active convergence.
            // Avoid drop/reconnect storms; let following ticks or business traffic verify connectivity.
            console.warn(
              '[OSAC_HEALTHCHECK_PING_TIMEOUT]',
              sessionId,
              error instanceof Error ? error.message : String(error)
            );
            continue;
          }
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
      if (!this.fixedSessionMode) {
        this.triggerReconnectNow(sessionId);
      }
    }
    return false;
  }

  private dropConnection(sessionId: string) {
    const existing = this.connections.get(sessionId);
    if (existing) {
      existing.handle.close();
      this.connections.delete(sessionId);
    }
    this.bridgeReady.delete(sessionId);
    this.messageBuffers.delete(sessionId);
  }

  registerMessageHandler(handler: MessageHandler) {
    this.handlers.push(handler);
  }

  async close(sessionId: string) {
    this.persistentSessions.delete(sessionId);
    this.reconnectFailures.delete(sessionId);
    this.clearReconnectTimer(sessionId);
    this.dropConnection(sessionId);
    this.messageBuffers.delete(sessionId);
  }

  listMessages(sessionId: string, limit: number = 50): OsacMessage[] {
    const buffer = this.messageBuffers.get(sessionId);
    if (!buffer) {
      return [];
    }
    return buffer.slice(-limit);
  }

  getMessageCount(sessionId: string): number {
    return this.messageBuffers.get(sessionId)?.length || 0;
  }

  getMessagesSince(sessionId: string, offset: number): OsacMessage[] {
    const buffer = this.messageBuffers.get(sessionId);
    if (!buffer) {
      return [];
    }
    return buffer.slice(offset);
  }

  emitExternalMessage(sessionId: string, message: OsacMessage) {
    this.dispatchMessage(sessionId, message);
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
      await this.ensureBridgeReady(sessionId, entry);
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
        await this.ensureBridgeReady(sessionId, entry);
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
      await this.ensureBridgeReady(sessionId, entry);
      entry.lastUsedAt = Date.now();
      return await entry.handle.request(message, match);
    } catch (error) {
      if (this.isSocketNotConnectedError(error)) {
        this.dropConnection(sessionId);
        const entry = await this.getConnection(sessionId, options);
        await this.ensureBridgeReady(sessionId, entry);
        entry.lastUsedAt = Date.now();
        return await entry.handle.request(message, match);
      }
      if (this.isReconnectInProgressError(error)) {
        throw error;
      }
      if (this.isRequestTimeoutError(error)) {
        // Avoid reconnect storms when bridge is still healthy but backend response is slow.
        throw error;
      }
      this.triggerReconnectNow(sessionId);
      throw error;
    }
  }

  private dispatchMessage(sessionId: string, message: OsacMessage) {
    const messageType = typeof message?.type === 'string' ? message.type.toLowerCase() : 'unknown';
    const shouldCountAsActivity =
      messageType.startsWith('opencode_') ||
      messageType.startsWith('command_') ||
      messageType.startsWith('sandbox_webhook');
    if (shouldCountAsActivity) {
      void touchSandbox(sessionId, `osac_recv_${messageType}`);
    }

    const buffer = this.messageBuffers.get(sessionId) || [];
    buffer.push(this.sanitizeMessage(message));
    const maxMessages = Number.isFinite(this.maxMessages) ? Math.max(20, this.maxMessages) : 120;
    if (buffer.length > maxMessages) {
      buffer.splice(0, buffer.length - maxMessages);
    }
    this.messageBuffers.set(sessionId, buffer);
    this.pruneMessageBuffers();

    for (const handler of this.handlers) {
      Promise.resolve(handler(sessionId, message)).catch((error) => {
        console.warn('[OSAC_HANDLER_ERROR]', error);
      });
    }
  }

  private pruneMessageBuffers() {
    const maxSessions = Number.isFinite(this.maxBufferSessions)
      ? Math.max(20, this.maxBufferSessions)
      : 200;
    if (this.messageBuffers.size <= maxSessions) return;

    for (const key of Array.from(this.messageBuffers.keys())) {
      if (this.messageBuffers.size <= maxSessions) return;
      if (!this.connections.has(key) && !this.persistentSessions.has(key)) {
        this.messageBuffers.delete(key);
      }
    }

    if (this.messageBuffers.size <= maxSessions) return;
    const entries = Array.from(this.messageBuffers.keys()).map((key) => ({
      key,
      lastUsedAt: this.connections.get(key)?.lastUsedAt ?? 0,
    }));
    entries.sort((a, b) => a.lastUsedAt - b.lastUsedAt);
    for (const entry of entries) {
      if (this.messageBuffers.size <= maxSessions) break;
      this.messageBuffers.delete(entry.key);
    }
  }

  private sanitizeMessage(message: OsacMessage): OsacMessage {
    const maxChars = Number.isFinite(this.maxPayloadChars) ? Math.max(2000, this.maxPayloadChars) : 50000;
    if (!message || typeof message !== 'object') return message;
    if (!message.payload || maxChars <= 0) return message;
    try {
      const payloadText = JSON.stringify(message.payload);
      if (payloadText.length <= maxChars) return message;
      return {
        ...message,
        payload: {
          truncated: true,
          preview: payloadText.slice(0, maxChars) + '...',
        },
      };
    } catch {
      return {
        ...message,
        payload: {
          truncated: true,
          preview: '[unserializable payload]',
        },
      };
    }
  }
}

export const osacConnectionManager = new OsacConnectionManager();
