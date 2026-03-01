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
  stage?: 'collecting' | 'clarifying' | 'planning' | 'executing' | 'reviewing' | 'completed' | 'failed';
  phase?: 'ideation' | 'analysis' | 'development' | 'testing' | 'repair' | 'delivery';
  phaseCycle?: number;
  runtime?: {
    orchestratorSessionId?: string;
    opencodeSessionId?: string;
    updatedAt?: string;
  };
  pendingQuestion?: string;
  pendingOptions?: string[];
  pendingResume?: {
    stage: NonNullable<FileSessionRecord['stage']>;
    reason?: string;
    lastUserInput?: string;
    updatedAt: string;
  };
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
  private maxMessagesPerSession = Number(process.env.TASK_CREATION_MAX_MESSAGES || 1200);
  private maxMessageLength = Number(process.env.TASK_CREATION_MAX_MESSAGE_LENGTH || 20000);
  private maxMetadataLength = Number(process.env.TASK_CREATION_MAX_METADATA_LENGTH || 20000);

  private clampMax(value: number, fallback: number) {
    if (!Number.isFinite(value) || value <= 0) return fallback;
    return Math.floor(value);
  }

  private sanitizeText(text: string): { text: string; truncated: boolean } {
    const maxLen = this.clampMax(this.maxMessageLength, 20000);
    if (!text || text.length <= maxLen) {
      return { text, truncated: false };
    }
    return { text: `${text.slice(0, maxLen)}...`, truncated: true };
  }

  private sanitizeMetadata(metadata: any): { metadata?: any; truncated: boolean } {
    if (!metadata || typeof metadata !== 'object') {
      return { metadata, truncated: false };
    }
    const maxLen = this.clampMax(this.maxMetadataLength, 20000);
    let truncated = false;
    const sanitized: Record<string, any> = { ...(metadata as Record<string, any>) };

    const truncateValue = (value: unknown, label: string): unknown => {
      if (typeof value === 'string') {
        if (value.length > maxLen) {
          truncated = true;
          sanitized[`${label}Truncated`] = true;
          return value.slice(0, maxLen) + '...';
        }
        return value;
      }
      if (value && typeof value === 'object') {
        try {
          const rawText = JSON.stringify(value);
          if (rawText.length > maxLen) {
            truncated = true;
            sanitized[`${label}Truncated`] = true;
            return rawText.slice(0, maxLen) + '...';
          }
          return value;
        } catch {
          truncated = true;
          sanitized[`${label}Truncated`] = true;
          return '[unserializable payload]';
        }
      }
      return value;
    };

    if (Object.prototype.hasOwnProperty.call(sanitized, 'rawPayload')) {
      sanitized.rawPayload = truncateValue(sanitized.rawPayload, 'rawPayload');
    }
    if (Object.prototype.hasOwnProperty.call(sanitized, 'event')) {
      sanitized.event = truncateValue(sanitized.event, 'event');
    }
    if (Object.prototype.hasOwnProperty.call(sanitized, 'diff')) {
      sanitized.diff = truncateValue(sanitized.diff, 'diff');
    }

    return { metadata: sanitized, truncated };
  }

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

  async createSession(title: string, sessionId?: string): Promise<FileSessionRecord> {
    return this.withLock(async () => {
      const memory = await this.readMemory();
      const now = new Date().toISOString();
      const existing = sessionId
        ? memory.sessions.find((item) => item.id === sessionId)
        : null;
      if (existing) {
        if (title?.trim()) {
          existing.title = title.trim().slice(0, 80);
        }
        existing.updatedAt = now;
        await this.writeMemory(memory);
        return existing;
      }

      const session: FileSessionRecord = {
        id: sessionId || this.createId('session'),
        title: title.trim().slice(0, 80) || '新建任务会话',
        status: 'in_progress',
        stage: 'collecting',
        phase: 'ideation',
        phaseCycle: 0,
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
      if (status === 'waiting_user') {
        session.stage = 'clarifying';
      } else if (status === 'completed') {
        session.stage = 'completed';
      } else if (status === 'failed') {
        session.stage = 'failed';
      }
      session.updatedAt = new Date().toISOString();
      await this.writeMemory(memory);
    });
  }

  async updateSessionStage(
    sessionId: string,
    stage: NonNullable<FileSessionRecord['stage']>
  ): Promise<void> {
    await this.withLock(async () => {
      const memory = await this.readMemory();
      const session = memory.sessions.find((s) => s.id === sessionId);
      if (!session) return;
      session.stage = stage;
      session.updatedAt = new Date().toISOString();
      await this.writeMemory(memory);
    });
  }

  async updateSessionPhase(
    sessionId: string,
    phase: NonNullable<FileSessionRecord['phase']>,
    options?: { cycle?: number }
  ): Promise<void> {
    await this.withLock(async () => {
      const memory = await this.readMemory();
      const session = memory.sessions.find((s) => s.id === sessionId);
      if (!session) return;
      session.phase = phase;
      if (Number.isFinite(options?.cycle)) {
        session.phaseCycle = options?.cycle as number;
      }
      session.updatedAt = new Date().toISOString();
      await this.writeMemory(memory);
    });
  }

  async updateRuntimeBinding(
    sessionId: string,
    runtime: { orchestratorSessionId?: string; opencodeSessionId?: string }
  ): Promise<void> {
    await this.withLock(async () => {
      const memory = await this.readMemory();
      const session = memory.sessions.find((s) => s.id === sessionId);
      if (!session) return;

      const current = session.runtime || {};
      const nextOrchestrator =
        runtime.orchestratorSessionId !== undefined
          ? runtime.orchestratorSessionId || undefined
          : current.orchestratorSessionId;
      const nextOpencode =
        runtime.opencodeSessionId !== undefined
          ? runtime.opencodeSessionId || undefined
          : current.opencodeSessionId;

      session.runtime = {
        orchestratorSessionId: nextOrchestrator,
        opencodeSessionId: nextOpencode,
        updatedAt: new Date().toISOString(),
      };
      session.updatedAt = new Date().toISOString();
      await this.writeMemory(memory);
    });
  }

  async setPendingClarification(sessionId: string, question: string, options?: string[]): Promise<void> {
    await this.withLock(async () => {
      const memory = await this.readMemory();
      const session = memory.sessions.find((s) => s.id === sessionId);
      if (!session) return;
      session.pendingQuestion = question;
      session.pendingOptions = options;
      session.status = 'waiting_user';
      session.stage = 'clarifying';
      session.updatedAt = new Date().toISOString();
      await this.writeMemory(memory);
    });
  }

  async clearPendingClarification(sessionId: string): Promise<void> {
    await this.withLock(async () => {
      const memory = await this.readMemory();
      const session = memory.sessions.find((s) => s.id === sessionId);
      if (!session) return;
      session.pendingQuestion = undefined;
      session.pendingOptions = undefined;
      if (session.status === 'waiting_user') {
        session.status = 'in_progress';
      }
      session.updatedAt = new Date().toISOString();
      await this.writeMemory(memory);
    });
  }

  async setPendingResume(
    sessionId: string,
    payload: { stage: NonNullable<FileSessionRecord['stage']>; reason?: string; lastUserInput?: string }
  ): Promise<void> {
    await this.withLock(async () => {
      const memory = await this.readMemory();
      const session = memory.sessions.find((s) => s.id === sessionId);
      if (!session) return;
      session.pendingResume = {
        stage: payload.stage,
        reason: payload.reason,
        lastUserInput: payload.lastUserInput,
        updatedAt: new Date().toISOString(),
      };
      session.status = 'in_progress';
      session.updatedAt = new Date().toISOString();
      await this.writeMemory(memory);
    });
  }

  async clearPendingResume(sessionId: string): Promise<void> {
    await this.withLock(async () => {
      const memory = await this.readMemory();
      const session = memory.sessions.find((s) => s.id === sessionId);
      if (!session) return;
      session.pendingResume = undefined;
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
    const sanitized = this.sanitizeText(String(content || ''));
    const meta = this.sanitizeMetadata(metadata);
    await this.withLock(async () => {
      const memory = await this.readMemory();
      const session = memory.sessions.find((s) => s.id === sessionId);
      if (!session) return;
      session.messages.push({
        id: this.createId('msg'),
        role,
        messageType,
        content: sanitized.text,
        metadata: meta.metadata
          ? { ...meta.metadata, contentTruncated: sanitized.truncated || meta.truncated }
          : sanitized.truncated
            ? { contentTruncated: true }
            : meta.metadata,
        createdAt: new Date().toISOString(),
      });
      const maxMessages = this.clampMax(this.maxMessagesPerSession, 1200);
      if (maxMessages > 0 && session.messages.length > maxMessages) {
        session.messages.splice(0, session.messages.length - maxMessages);
      }
      session.updatedAt = new Date().toISOString();
      await this.writeMemory(memory);
    });
  }

  async getMessages(sessionId: string): Promise<FileSessionMessage[]> {
    const session = await this.getSession(sessionId);
    return session?.messages || [];
  }

  async findSessionByOrchestratorSessionId(orchestratorSessionId: string): Promise<FileSessionRecord | null> {
    const target = orchestratorSessionId.trim();
    if (!target) return null;

    const memory = await this.readMemory();
    const candidates = memory.sessions
      .filter((session) => session.runtime?.orchestratorSessionId === target)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    return candidates[0] || null;
  }

  async findSessionByOpencodeSessionId(opencodeSessionId: string): Promise<FileSessionRecord | null> {
    const target = opencodeSessionId.trim();
    if (!target) return null;

    const memory = await this.readMemory();
    const candidates = memory.sessions
      .filter((session) => session.runtime?.opencodeSessionId === target)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    return candidates[0] || null;
  }
}

export const taskCreationFileMemoryStore = new TaskCreationFileMemoryStore();
