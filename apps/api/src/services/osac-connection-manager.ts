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

export class OsacConnectionManager {
  private connections = new Map<string, ConnectionEntry>();
  private connecting = new Map<string, PendingConnect>();
  private maxMessages = 300;
  private handlers: MessageHandler[] = [];
  private persistentSessions = new Set<string>();
  private reconnectTimers = new Map<string, NodeJS.Timeout>();
  private reconnectDelayMs = Number(process.env.OSAC_RECONNECT_DELAY_MS || 3000);

  async getConnection(sessionId: string): Promise<ConnectionEntry> {
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
      return pending.promise;
    }

    const promise = this.createConnection(sessionId);
    this.connecting.set(sessionId, { promise });

    try {
      const entry = await promise;
      this.connections.set(sessionId, entry);
      this.clearReconnectTimer(sessionId);
      return entry;
    } finally {
      this.connecting.delete(sessionId);
    }
  }

  private async createConnection(sessionId: string): Promise<ConnectionEntry> {
    const handle = await osacConnector.connectForSession(sessionId);
    const entry: ConnectionEntry = {
      handle,
      lastUsedAt: Date.now(),
      messages: [],
    };

    handle.onMessage((message) => {
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
      this.scheduleReconnect(sessionId);
    });

    return entry;
  }

  private clearReconnectTimer(sessionId: string) {
    const timer = this.reconnectTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(sessionId);
    }
  }

  private scheduleReconnect(sessionId: string) {
    if (!this.persistentSessions.has(sessionId)) {
      return;
    }
    if (this.reconnectTimers.has(sessionId) || this.connecting.has(sessionId)) {
      return;
    }
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(sessionId);
      void this.getConnection(sessionId).catch((error) => {
        console.warn('[OSAC_RECONNECT_ERROR]', sessionId, error);
        this.scheduleReconnect(sessionId);
      });
    }, this.reconnectDelayMs);
    this.reconnectTimers.set(sessionId, timer);
  }

  async ensurePersistent(sessionId: string) {
    this.persistentSessions.add(sessionId);
    try {
      await this.getConnection(sessionId);
    } catch (error) {
      console.warn('[OSAC_PERSISTENT_CONNECT_ERROR]', sessionId, error);
      this.scheduleReconnect(sessionId);
    }
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

  async send(sessionId: string, message: OsacMessage) {
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
      const entry = await this.getConnection(sessionId);
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
      if ((error as Error)?.message?.includes('OSAC WebSocket 尚未连接')) {
        this.dropConnection(sessionId);
        const entry = await this.getConnection(sessionId);
        entry.lastUsedAt = Date.now();
        entry.handle.send(message);
        return;
      }
      throw error;
    }
  }

  async request(
    sessionId: string,
    message: OsacMessage,
    match?: (reply: OsacMessage) => boolean
  ): Promise<OsacMessage> {
    try {
      const entry = await this.getConnection(sessionId);
      entry.lastUsedAt = Date.now();
      return await entry.handle.request(message, match);
    } catch (error) {
      if ((error as Error)?.message?.includes('OSAC WebSocket 尚未连接')) {
        this.dropConnection(sessionId);
        const entry = await this.getConnection(sessionId);
        entry.lastUsedAt = Date.now();
        return await entry.handle.request(message, match);
      }
      throw error;
    }
  }
}

export const osacConnectionManager = new OsacConnectionManager();
