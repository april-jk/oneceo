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

export class OsacConnectionManager {
  private connections = new Map<string, ConnectionEntry>();
  private connecting = new Map<string, PendingConnect>();
  private maxMessages = 300;

  async getConnection(sessionId: string): Promise<ConnectionEntry> {
    const existing = this.connections.get(sessionId);
    if (existing) {
      existing.lastUsedAt = Date.now();
      return existing;
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
    });

    return entry;
  }

  async close(sessionId: string) {
    const existing = this.connections.get(sessionId);
    if (existing) {
      existing.handle.close();
      this.connections.delete(sessionId);
    }
  }

  listMessages(sessionId: string, limit: number = 50): OsacMessage[] {
    const existing = this.connections.get(sessionId);
    if (!existing) {
      return [];
    }
    return existing.messages.slice(-limit);
  }

  async send(sessionId: string, message: OsacMessage) {
    const entry = await this.getConnection(sessionId);
    entry.lastUsedAt = Date.now();
    entry.handle.send(message);
  }

  async request(
    sessionId: string,
    message: OsacMessage,
    match?: (reply: OsacMessage) => boolean
  ): Promise<OsacMessage> {
    const entry = await this.getConnection(sessionId);
    entry.lastUsedAt = Date.now();
    return entry.handle.request(message, match);
  }
}

export const osacConnectionManager = new OsacConnectionManager();
