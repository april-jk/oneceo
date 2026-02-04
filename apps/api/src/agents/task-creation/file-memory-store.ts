import { promises as fs } from 'fs';
import path from 'path';

export interface FileSessionMessage {
  id: string;
  role: 'user' | 'agent' | 'system';
  messageType: string;
  content: string;
  metadata?: any;
  createdAt: string;
}

export interface FileSessionRecord {
  id: string;
  title: string;
  status: 'in_progress' | 'waiting_user' | 'completed' | 'failed';
  createdAt: string;
  updatedAt: string;
  messages: FileSessionMessage[];
}

interface MemoryFileShape {
  sessions: FileSessionRecord[];
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const MEMORY_FILE = path.join(DATA_DIR, 'task-creation-memory.json');

class TaskCreationFileMemoryStore {
  private writeLock: Promise<void> = Promise.resolve();

  private async ensureFile(): Promise<void> {
    await fs.mkdir(DATA_DIR, { recursive: true });
    try {
      await fs.access(MEMORY_FILE);
    } catch {
      const initial: MemoryFileShape = { sessions: [] };
      await fs.writeFile(MEMORY_FILE, JSON.stringify(initial, null, 2), 'utf-8');
    }
  }

  private async readMemory(): Promise<MemoryFileShape> {
    await this.ensureFile();
    const raw = await fs.readFile(MEMORY_FILE, 'utf-8');
    try {
      const parsed = JSON.parse(raw) as MemoryFileShape;
      return {
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      };
    } catch {
      return { sessions: [] };
    }
  }

  private async writeMemory(data: MemoryFileShape): Promise<void> {
    await fs.writeFile(MEMORY_FILE, JSON.stringify(data, null, 2), 'utf-8');
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.writeLock;
    let release!: () => void;
    this.writeLock = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private createId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  async createSession(title: string): Promise<FileSessionRecord> {
    return this.withLock(async () => {
      const memory = await this.readMemory();
      const now = new Date().toISOString();
      const session: FileSessionRecord = {
        id: this.createId('session'),
        title: title.trim().slice(0, 80) || '新建任务会话',
        status: 'in_progress',
        createdAt: now,
        updatedAt: now,
        messages: [],
      };
      memory.sessions.push(session);
      await this.writeMemory(memory);
      return session;
    });
  }

  async getSession(sessionId: string): Promise<FileSessionRecord | null> {
    const memory = await this.readMemory();
    return memory.sessions.find((s) => s.id === sessionId) || null;
  }

  async listSessions(limit: number = 20): Promise<FileSessionRecord[]> {
    const memory = await this.readMemory();
    return [...memory.sessions]
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, limit);
  }

  async updateSessionStatus(sessionId: string, status: FileSessionRecord['status']): Promise<void> {
    await this.withLock(async () => {
      const memory = await this.readMemory();
      const session = memory.sessions.find((s) => s.id === sessionId);
      if (!session) return;
      session.status = status;
      session.updatedAt = new Date().toISOString();
      await this.writeMemory(memory);
    });
  }

  async addMessage(
    sessionId: string,
    role: FileSessionMessage['role'],
    messageType: string,
    content: string,
    metadata?: any
  ): Promise<void> {
    await this.withLock(async () => {
      const memory = await this.readMemory();
      const session = memory.sessions.find((s) => s.id === sessionId);
      if (!session) return;
      session.messages.push({
        id: this.createId('msg'),
        role,
        messageType,
        content,
        metadata,
        createdAt: new Date().toISOString(),
      });
      session.updatedAt = new Date().toISOString();
      await this.writeMemory(memory);
    });
  }

  async getMessages(sessionId: string): Promise<FileSessionMessage[]> {
    const session = await this.getSession(sessionId);
    return session?.messages || [];
  }
}

export const taskCreationFileMemoryStore = new TaskCreationFileMemoryStore();

