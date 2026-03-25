import { promises as fs } from 'fs';
import path from 'path';

export type SessionDriver = 'altus' | 'opencode' | 'codex' | 'claudecode';
export type CodexExecutionMode = 'sdk' | 'ws';
export type CodexTransportMode = 'sdk' | 'app_server';

export function deriveSessionDriver(input: {
  mode?: 'altus' | 'sandbox' | string;
  executor?: 'opencode' | 'claudecode' | 'codex' | string;
  fallbackDriver?: SessionDriver | string;
}): SessionDriver | undefined {
  const mode = typeof input.mode === 'string' ? input.mode.trim() : '';
  const executor = typeof input.executor === 'string' ? input.executor.trim() : '';
  const fallback = typeof input.fallbackDriver === 'string' ? input.fallbackDriver.trim() : '';

  if (mode === 'altus') {
    return 'altus';
  }

  if (mode === 'sandbox') {
    if (executor === 'opencode' || executor === 'codex' || executor === 'claudecode') {
      return executor;
    }
    if (fallback === 'opencode' || fallback === 'codex' || fallback === 'claudecode') {
      return fallback;
    }
    return undefined;
  }

  if (fallback === 'altus' || fallback === 'opencode' || fallback === 'codex' || fallback === 'claudecode') {
    return fallback;
  }

  return undefined;
}

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
  titleLocked?: boolean;
  titleSource?: 'placeholder' | 'first_explicit_user_input' | 'manual';
  titleResolvedAt?: string;
  isFavorite?: boolean;
  projectId?: string | null;
  projectName?: string | null;
  shareEnabled?: boolean;
  shareToken?: string | null;
  status: 'in_progress' | 'waiting_user' | 'completed' | 'failed';
  stage?: 'collecting' | 'clarifying' | 'planning' | 'executing' | 'reviewing' | 'completed' | 'failed';
  phase?: 'ideation' | 'analysis' | 'development' | 'testing' | 'repair' | 'delivery';
  phaseCycle?: number;
  mode?: 'altus' | 'sandbox';
  driver?: SessionDriver;
  executor?: 'opencode' | 'claudecode' | 'codex' | string;
  codexExecutionMode?: CodexExecutionMode;
  runtime?: {
    generation?: number;
    orchestratorSessionId?: string;
    executor?: 'opencode' | 'claudecode' | 'codex' | string;
    transport?: CodexTransportMode | string;
    executorSessionId?: string;
    opencodeSessionId?: string;
    codexRestoreStatus?: 'not_needed' | 'session_restored' | 'session_restore_failed' | 'state_restore_failed';
    codexRestoreAt?: string;
    codexRestoreSourceKey?: string;
    previousExecutorSessionId?: string;
    codexRestoreFailureReason?: string;
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

type TaskStage = NonNullable<FileSessionRecord['stage']>;
type TaskPhase = NonNullable<FileSessionRecord['phase']>;
type TaskStatus = FileSessionRecord['status'];

const PHASE_TRANSITIONS: Record<TaskPhase, TaskPhase[]> = {
  ideation: ['analysis'],
  analysis: ['development'],
  development: ['testing', 'delivery'],
  testing: ['repair', 'delivery'],
  repair: ['testing'],
  delivery: [],
};

const STAGE_TRANSITIONS: Record<TaskStage, TaskStage[]> = {
  collecting: ['planning', 'executing', 'reviewing', 'clarifying', 'completed', 'failed'],
  planning: ['executing', 'reviewing', 'clarifying', 'completed', 'failed'],
  executing: ['reviewing', 'clarifying', 'completed', 'failed'],
  reviewing: ['executing', 'clarifying', 'completed', 'failed'],
  clarifying: ['collecting', 'planning', 'executing', 'reviewing', 'completed', 'failed'],
  completed: [],
  failed: [],
};

function stageFromPhase(phase: TaskPhase): TaskStage {
  switch (phase) {
    case 'ideation':
      return 'collecting';
    case 'analysis':
      return 'planning';
    case 'development':
      return 'executing';
    case 'testing':
      return 'reviewing';
    case 'repair':
      return 'executing';
    case 'delivery':
      return 'reviewing';
  }
}

function canTransitionPhase(current: TaskPhase | undefined, next: TaskPhase, allowBackward: boolean): boolean {
  if (!current || current === next) return true;
  if (allowBackward) return true;
  const allowed = PHASE_TRANSITIONS[current] || [];
  return allowed.includes(next);
}

function canTransitionStage(current: TaskStage | undefined, next: TaskStage, allowBackward: boolean): boolean {
  if (!current || current === next) return true;
  if (allowBackward) return true;
  const allowed = STAGE_TRANSITIONS[current] || [];
  return allowed.includes(next);
}

class TaskCreationFileMemoryStore {
  private writeLock: Promise<void> = Promise.resolve();
  private maxMessagesPerSession = Number(process.env.TASK_CREATION_MAX_MESSAGES || 1200);
  private maxMessageLength = Number(process.env.TASK_CREATION_MAX_MESSAGE_LENGTH || 20000);
  private sandboxMaxMessageLength = Number(process.env.TASK_CREATION_SANDBOX_MAX_MESSAGE_LENGTH || 200000);
  private maxMetadataLength = Number(process.env.TASK_CREATION_MAX_METADATA_LENGTH || 20000);

  private clampMax(value: number, fallback: number) {
    if (!Number.isFinite(value) || value <= 0) return fallback;
    return Math.floor(value);
  }

  private sanitizeText(text: string, maxLenOverride?: number): { text: string; truncated: boolean } {
    const maxLen = this.clampMax(maxLenOverride ?? this.maxMessageLength, 20000);
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

  private asSessionEventSeq(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return Math.floor(value);
    }
    if (typeof value === 'string') {
      const parsed = Number(value.trim());
      if (Number.isFinite(parsed) && parsed > 0) {
        return Math.floor(parsed);
      }
    }
    return null;
  }

  private resolveNextSessionEventSeq(session: FileSessionRecord): number {
    const messages = Array.isArray(session.messages) ? session.messages : [];
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const metadata = messages[i]?.metadata;
      if (!metadata || typeof metadata !== 'object') continue;
      const seq = this.asSessionEventSeq((metadata as Record<string, unknown>).sessionEventSeq);
      if (seq !== null) {
        return seq + 1;
      }
    }
    return 1;
  }

  private attachSessionEventSeq(
    metadataInput: Record<string, unknown> | undefined,
    nextSeq: number
  ): { metadata: Record<string, unknown>; nextSeq: number } {
    const metadata: Record<string, unknown> = { ...(metadataInput || {}) };
    const existing = this.asSessionEventSeq(metadata.sessionEventSeq);
    if (existing !== null) {
      metadata.sessionEventSeq = existing;
      return {
        metadata,
        nextSeq: Math.max(nextSeq, existing + 1),
      };
    }
    metadata.sessionEventSeq = nextSeq;
    return {
      metadata,
      nextSeq: nextSeq + 1,
    };
  }

  async createSession(title: string, sessionId?: string): Promise<FileSessionRecord> {
    return this.withLock(async () => {
      const memory = await this.readMemory();
      const now = new Date().toISOString();
      const existing = sessionId
        ? memory.sessions.find((item) => item.id === sessionId)
        : null;
      if (existing) {
        if (title?.trim() && !existing.titleLocked) {
          existing.title = title.trim().slice(0, 80);
        }
        existing.updatedAt = now;
        await this.writeMemory(memory);
        return existing;
      }

      const session: FileSessionRecord = {
        id: sessionId || this.createId('session'),
        title: title.trim().slice(0, 80) || '新建任务会话',
        titleLocked: false,
        titleSource: 'placeholder',
        isFavorite: false,
        projectId: null,
        projectName: null,
        shareEnabled: false,
        shareToken: null,
        status: 'in_progress',
        stage: 'collecting',
        phase: 'ideation',
        phaseCycle: 0,
        mode: 'altus',
        driver: 'altus',
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
    await this.updateSessionState(sessionId, { status });
  }

  async updateSessionStage(
    sessionId: string,
    stage: NonNullable<FileSessionRecord['stage']>
  ): Promise<void> {
    await this.updateSessionState(sessionId, { stage });
  }

  async updateSessionPhase(
    sessionId: string,
    phase: NonNullable<FileSessionRecord['phase']>,
    options?: { cycle?: number }
  ): Promise<void> {
    await this.updateSessionState(sessionId, { phase, phaseCycle: options?.cycle });
  }

  async updateSessionState(
    sessionId: string,
    payload: {
      status?: TaskStatus;
      stage?: TaskStage;
      phase?: TaskPhase;
      phaseCycle?: number;
      allowBackward?: boolean;
      source?: string;
    }
  ): Promise<void> {
    await this.withLock(async () => {
      const memory = await this.readMemory();
      const session = memory.sessions.find((s) => s.id === sessionId);
      if (!session) return;

      const terminal = session.status === 'completed' || session.status === 'failed';
      const requestedStatus = payload.status;
      const requestedStage = payload.stage;
      const requestedPhase = payload.phase;
      const forceTerminal = requestedStatus === 'completed' || requestedStatus === 'failed';
      const allowBackward = forceTerminal || Boolean(payload.allowBackward);

      if (terminal && !allowBackward && !requestedStatus) {
        return;
      }
      if (terminal && requestedStatus && requestedStatus !== session.status && !allowBackward) {
        return;
      }

      let nextStatus: TaskStatus = requestedStatus || session.status;
      let nextPhase: TaskPhase | undefined = requestedPhase || session.phase;
      let nextStage: TaskStage | undefined = requestedStage || session.stage;
      const currentPhase = session.phase as TaskPhase | undefined;
      const currentStage = session.stage as TaskStage | undefined;

      const reopeningFromTerminal =
        allowBackward &&
        terminal &&
        nextStatus === session.status &&
        ((nextStage && nextStage !== 'completed' && nextStage !== 'failed') ||
          (nextPhase && nextPhase !== 'delivery'));

      if (reopeningFromTerminal) {
        nextStatus = 'in_progress';
      }

      if (nextStatus === 'waiting_user') {
        nextStage = 'clarifying';
      } else if (nextStatus === 'completed') {
        nextStage = 'completed';
        if (!payload.phase) {
          nextPhase = 'delivery';
        }
      } else if (nextStatus === 'failed') {
        nextStage = 'failed';
      }

      if (nextPhase && !canTransitionPhase(currentPhase, nextPhase, allowBackward)) {
        return;
      }

      if (nextPhase) {
        const mappedStage = stageFromPhase(nextPhase);
        const blockOverride =
          nextStage === 'clarifying' ||
          nextStage === 'completed' ||
          nextStage === 'failed' ||
          nextStatus === 'waiting_user' ||
          nextStatus === 'completed' ||
          nextStatus === 'failed';
        if (!blockOverride) {
          if (!nextStage || nextStage === mappedStage) {
            nextStage = mappedStage;
          } else if (stageFromPhase(nextPhase) !== nextStage) {
            nextStage = mappedStage;
          }
        }
      }

      if (nextStage && !canTransitionStage(currentStage, nextStage, allowBackward)) {
        return;
      }

      const phaseChanged = nextPhase && nextPhase !== session.phase;
      const stageChanged = nextStage && nextStage !== session.stage;
      const statusChanged = nextStatus !== session.status;
      const cycleChanged =
        Number.isFinite(payload.phaseCycle) && payload.phaseCycle !== session.phaseCycle;

      if (!phaseChanged && !stageChanged && !statusChanged && !cycleChanged) {
        return;
      }

      session.status = nextStatus;
      if (nextStage) {
        session.stage = nextStage;
      }
      if (nextPhase) {
        session.phase = nextPhase;
      }
      if (Number.isFinite(payload.phaseCycle)) {
        session.phaseCycle = payload.phaseCycle as number;
      }
      session.updatedAt = new Date().toISOString();
      await this.writeMemory(memory);
    });
  }

  async updateSessionMode(sessionId: string, mode: FileSessionRecord['mode']): Promise<void> {
    if (!mode) return;
    await this.withLock(async () => {
      const memory = await this.readMemory();
      const session = memory.sessions.find((s) => s.id === sessionId);
      if (!session) return;
      if (session.mode === mode) {
        const nextDriver = deriveSessionDriver({
          mode,
          executor: session.executor,
          fallbackDriver: session.driver,
        });
        if (nextDriver && session.driver !== nextDriver) {
          session.driver = nextDriver;
          session.updatedAt = new Date().toISOString();
          await this.writeMemory(memory);
        }
        return;
      }
      session.mode = mode;
      session.driver = deriveSessionDriver({
        mode,
        executor: session.executor,
        fallbackDriver: session.driver,
      });
      session.updatedAt = new Date().toISOString();
      await this.writeMemory(memory);
    });
  }

  async updateSessionExecutor(sessionId: string, executor: FileSessionRecord['executor']): Promise<void> {
    if (!executor) return;
    await this.withLock(async () => {
      const memory = await this.readMemory();
      const session = memory.sessions.find((s) => s.id === sessionId);
      if (!session) return;
      if (session.executor === executor) {
        const nextDriver = deriveSessionDriver({
          mode: session.mode,
          executor,
          fallbackDriver: session.driver,
        });
        if (nextDriver && session.driver !== nextDriver) {
          session.driver = nextDriver;
          session.updatedAt = new Date().toISOString();
          await this.writeMemory(memory);
        }
        return;
      }
      session.executor = executor;
      session.driver = deriveSessionDriver({
        mode: session.mode,
        executor,
        fallbackDriver: session.driver,
      });
      session.updatedAt = new Date().toISOString();
      await this.writeMemory(memory);
    });
  }

  async updateSessionCodexExecutionMode(
    sessionId: string,
    codexExecutionMode: FileSessionRecord['codexExecutionMode']
  ): Promise<void> {
    if (codexExecutionMode !== 'sdk' && codexExecutionMode !== 'ws') return;
    await this.withLock(async () => {
      const memory = await this.readMemory();
      const session = memory.sessions.find((s) => s.id === sessionId);
      if (!session) return;
      if (session.codexExecutionMode === codexExecutionMode) return;
      session.codexExecutionMode = codexExecutionMode;
      session.updatedAt = new Date().toISOString();
      await this.writeMemory(memory);
    });
  }

  async updateSessionDriver(sessionId: string, driver: FileSessionRecord['driver']): Promise<void> {
    if (!driver) return;
    await this.withLock(async () => {
      const memory = await this.readMemory();
      const session = memory.sessions.find((s) => s.id === sessionId);
      if (!session) return;
      if (session.driver === driver) return;
      session.driver = driver;
      session.updatedAt = new Date().toISOString();
      await this.writeMemory(memory);
    });
  }

  async updateSessionTitle(
    sessionId: string,
    title: string,
    options?: {
      lock?: boolean;
      source?: FileSessionRecord['titleSource'];
      force?: boolean;
      resolvedAt?: string;
    }
  ): Promise<void> {
    const nextTitle = title.trim().slice(0, 80);
    if (!nextTitle) return;
    await this.withLock(async () => {
      const memory = await this.readMemory();
      const session = memory.sessions.find((s) => s.id === sessionId);
      if (!session) return;
      if (session.titleLocked && !options?.force) return;

      const nextLock = Boolean(options?.lock);
      const nextSource = options?.source || session.titleSource || 'placeholder';
      const nextResolvedAt =
        options?.resolvedAt || (nextLock ? new Date().toISOString() : session.titleResolvedAt);
      const titleChanged = session.title !== nextTitle;
      const lockChanged = Boolean(session.titleLocked) !== nextLock;
      const sourceChanged = session.titleSource !== nextSource;
      const resolvedAtChanged = session.titleResolvedAt !== nextResolvedAt;

      if (!titleChanged && !lockChanged && !sourceChanged && !resolvedAtChanged) {
        return;
      }

      session.title = nextTitle;
      session.titleLocked = nextLock;
      session.titleSource = nextSource;
      session.titleResolvedAt = nextResolvedAt;
      session.updatedAt = new Date().toISOString();
      await this.writeMemory(memory);
    });
  }

  async updateSessionFavorite(sessionId: string, favorite: boolean): Promise<void> {
    await this.withLock(async () => {
      const memory = await this.readMemory();
      const session = memory.sessions.find((s) => s.id === sessionId);
      if (!session) return;
      if (Boolean(session.isFavorite) === favorite) return;
      session.isFavorite = favorite;
      session.updatedAt = new Date().toISOString();
      await this.writeMemory(memory);
    });
  }

  async updateSessionProject(
    sessionId: string,
    payload: {
      projectId?: string | null;
      projectName?: string | null;
    }
  ): Promise<void> {
    await this.withLock(async () => {
      const memory = await this.readMemory();
      const session = memory.sessions.find((s) => s.id === sessionId);
      if (!session) return;
      const nextProjectId =
        payload.projectId !== undefined ? (payload.projectId ? String(payload.projectId).trim() : null) : session.projectId || null;
      const nextProjectName =
        payload.projectName !== undefined
          ? payload.projectName
            ? String(payload.projectName).trim().slice(0, 80)
            : null
          : session.projectName || null;
      if ((session.projectId || null) === nextProjectId && (session.projectName || null) === nextProjectName) {
        return;
      }
      session.projectId = nextProjectId;
      session.projectName = nextProjectName;
      session.updatedAt = new Date().toISOString();
      await this.writeMemory(memory);
    });
  }

  async updateSessionShare(
    sessionId: string,
    payload: {
      shareEnabled?: boolean;
      shareToken?: string | null;
    }
  ): Promise<void> {
    await this.withLock(async () => {
      const memory = await this.readMemory();
      const session = memory.sessions.find((s) => s.id === sessionId);
      if (!session) return;
      const nextShareEnabled =
        payload.shareEnabled !== undefined ? Boolean(payload.shareEnabled) : Boolean(session.shareEnabled);
      const nextShareToken =
        payload.shareToken !== undefined
          ? payload.shareToken
            ? String(payload.shareToken).trim()
            : null
          : session.shareToken || null;
      if (Boolean(session.shareEnabled) === nextShareEnabled && (session.shareToken || null) === nextShareToken) {
        return;
      }
      session.shareEnabled = nextShareEnabled;
      session.shareToken = nextShareToken;
      session.updatedAt = new Date().toISOString();
      await this.writeMemory(memory);
    });
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.withLock(async () => {
      const memory = await this.readMemory();
      const nextSessions = memory.sessions.filter((s) => s.id !== sessionId);
      if (nextSessions.length === memory.sessions.length) return;
      memory.sessions = nextSessions;
      await this.writeMemory(memory);
    });
  }

  async updateRuntimeBinding(
    sessionId: string,
    runtime: {
      generation?: number;
      orchestratorSessionId?: string;
      executor?: 'opencode' | 'claudecode' | 'codex' | string;
      transport?: CodexTransportMode | string;
      executorSessionId?: string;
      opencodeSessionId?: string;
      codexRestoreStatus?: 'not_needed' | 'session_restored' | 'session_restore_failed' | 'state_restore_failed';
      codexRestoreAt?: string;
      codexRestoreSourceKey?: string;
      previousExecutorSessionId?: string;
      codexRestoreFailureReason?: string;
    }
  ): Promise<void> {
    await this.withLock(async () => {
      const memory = await this.readMemory();
      const session = memory.sessions.find((s) => s.id === sessionId);
      if (!session) return;

      const current = session.runtime || {};
      const currentOrchestrator = current.orchestratorSessionId || undefined;
      const nextOrchestrator =
        runtime.orchestratorSessionId !== undefined
          ? runtime.orchestratorSessionId || undefined
          : currentOrchestrator;
      const orchestratorChanged =
        runtime.orchestratorSessionId !== undefined && nextOrchestrator !== currentOrchestrator;
      const currentExecutor =
        typeof current.executor === 'string' && current.executor.trim()
          ? current.executor.trim()
          : undefined;
      const requestedExecutor =
        runtime.executor !== undefined
          ? String(runtime.executor || '').trim() || undefined
          : runtime.opencodeSessionId !== undefined
            ? 'opencode'
            : currentExecutor;
      const currentTransport =
        typeof current.transport === 'string' && current.transport.trim()
          ? current.transport.trim()
          : undefined;
      const requestedTransport =
        runtime.transport !== undefined
          ? String(runtime.transport || '').trim() || undefined
          : requestedExecutor === 'codex'
            ? currentTransport
            : undefined;
      const currentExecutorSessionId = current.executorSessionId || current.opencodeSessionId || undefined;
      const currentPreviousExecutorSessionId = current.previousExecutorSessionId || undefined;
      const nextExecutorSessionId =
        runtime.executorSessionId !== undefined
          ? runtime.executorSessionId || undefined
          : runtime.opencodeSessionId !== undefined
            ? runtime.opencodeSessionId || undefined
            : orchestratorChanged
              ? undefined
              : currentExecutorSessionId;
      const nextOpencode =
        runtime.opencodeSessionId !== undefined
          ? runtime.opencodeSessionId || undefined
          : requestedExecutor === 'opencode'
            ? runtime.executorSessionId !== undefined
              ? runtime.executorSessionId || undefined
              : orchestratorChanged
                ? undefined
                : current.opencodeSessionId || current.executorSessionId || undefined
            : undefined;
      const nextPreviousExecutorSessionId =
        runtime.previousExecutorSessionId !== undefined
          ? runtime.previousExecutorSessionId || undefined
          : orchestratorChanged && currentExecutorSessionId
            ? currentExecutorSessionId
            : currentPreviousExecutorSessionId;
      const nextCodexRestoreStatus =
        runtime.codexRestoreStatus !== undefined
          ? runtime.codexRestoreStatus || undefined
          : current.codexRestoreStatus || undefined;
      const nextCodexRestoreAt =
        runtime.codexRestoreAt !== undefined
          ? runtime.codexRestoreAt || undefined
          : current.codexRestoreAt || undefined;
      const nextCodexRestoreSourceKey =
        runtime.codexRestoreSourceKey !== undefined
          ? runtime.codexRestoreSourceKey || undefined
          : current.codexRestoreSourceKey || undefined;
      const nextCodexRestoreFailureReason =
        runtime.codexRestoreFailureReason !== undefined
          ? runtime.codexRestoreFailureReason || undefined
          : current.codexRestoreFailureReason || undefined;
      const currentGeneration =
        typeof current.generation === 'number' && Number.isFinite(current.generation)
          ? Math.max(0, Math.floor(current.generation))
          : currentOrchestrator
            ? 1
            : 0;
      const requestedGeneration =
        typeof runtime.generation === 'number' && Number.isFinite(runtime.generation) && runtime.generation > 0
          ? Math.floor(runtime.generation)
          : 0;
      const nextGeneration =
        nextOrchestrator
          ? requestedGeneration > 0
            ? requestedGeneration
            : orchestratorChanged
              ? Math.max(1, currentGeneration + 1)
              : Math.max(1, currentGeneration)
          : 0;

      session.runtime = {
        generation: nextGeneration || undefined,
        orchestratorSessionId: nextOrchestrator,
        executor: requestedExecutor,
        transport: requestedTransport,
        executorSessionId: nextExecutorSessionId,
        opencodeSessionId: nextOpencode,
        codexRestoreStatus: nextCodexRestoreStatus,
        codexRestoreAt: nextCodexRestoreAt,
        codexRestoreSourceKey: nextCodexRestoreSourceKey,
        previousExecutorSessionId: nextPreviousExecutorSessionId,
        codexRestoreFailureReason: nextCodexRestoreFailureReason,
        updatedAt: new Date().toISOString(),
      };
      const derivedDriver = deriveSessionDriver({
        mode: session.mode,
        executor: session.executor || requestedExecutor,
        fallbackDriver: session.driver,
      });
      if (derivedDriver) {
        session.driver = derivedDriver;
      }
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
    const meta = this.sanitizeMetadata(metadata);
    await this.withLock(async () => {
      const memory = await this.readMemory();
      const session = memory.sessions.find((s) => s.id === sessionId);
      if (!session) return;
      const maxLen =
        session.mode === 'sandbox' ? this.sandboxMaxMessageLength : this.maxMessageLength;
      const sanitized = this.sanitizeText(String(content || ''), maxLen);
      const mergedMetadata = meta.metadata
        ? { ...meta.metadata, contentTruncated: sanitized.truncated || meta.truncated }
        : sanitized.truncated
          ? { contentTruncated: true }
          : undefined;
      const now = Date.now();
      const seqAttached = this.attachSessionEventSeq(
        mergedMetadata as Record<string, unknown> | undefined,
        this.resolveNextSessionEventSeq(session)
      );
      const effectiveTimestamp = meta.metadata?.timestamp || now;
      const messageMetadata: Record<string, unknown> = {
        ...seqAttached.metadata,
        timestamp: effectiveTimestamp,
      };
      if (
        messageMetadata.runtimeGeneration === undefined &&
        typeof session.runtime?.generation === 'number' &&
        Number.isFinite(session.runtime.generation) &&
        session.runtime.generation > 0
      ) {
        messageMetadata.runtimeGeneration = Math.floor(session.runtime.generation);
      }
      session.messages.push({
        id: this.createId('msg'),
        role,
        messageType,
        content: sanitized.text,
        metadata: messageMetadata,
        createdAt: new Date(effectiveTimestamp).toISOString(),
      });
      const maxMessages = this.clampMax(this.maxMessagesPerSession, 1200);
      if (maxMessages > 0 && session.messages.length > maxMessages) {
        session.messages.splice(0, session.messages.length - maxMessages);
      }
      session.updatedAt = new Date().toISOString();
      await this.writeMemory(memory);
    });
  }

  async addMessagesBatch(
    sessionId: string,
    items: Array<{
      role: FileSessionMessage['role'];
      messageType: string;
      content: string;
      metadata?: any;
      createdAt?: string;
    }>
  ): Promise<void> {
    if (!items || items.length === 0) return;
    const metaList = items.map((item) => this.sanitizeMetadata(item.metadata));
    await this.withLock(async () => {
      const memory = await this.readMemory();
      const session = memory.sessions.find((s) => s.id === sessionId);
      if (!session) return;
      const maxLen =
        session.mode === 'sandbox' ? this.sandboxMaxMessageLength : this.maxMessageLength;
      const now = Date.now();
      const nowIso = new Date(now).toISOString();
      let nextSeq = this.resolveNextSessionEventSeq(session);
      items.forEach((item, idx) => {
        const meta = metaList[idx];
        const sanitized = this.sanitizeText(String(item.content || ''), maxLen);
        const mergedMetadata = meta.metadata
          ? { ...meta.metadata, contentTruncated: sanitized.truncated || meta.truncated }
          : sanitized.truncated
            ? { contentTruncated: true }
            : undefined;
        const seqAttached = this.attachSessionEventSeq(
          mergedMetadata as Record<string, unknown> | undefined,
          nextSeq
        );
        nextSeq = seqAttached.nextSeq;
        const itemTimestamp = meta.metadata?.timestamp || now;
        const messageMetadata: Record<string, unknown> = {
          ...seqAttached.metadata,
          timestamp: itemTimestamp,
        };
        if (
          messageMetadata.runtimeGeneration === undefined &&
          typeof session.runtime?.generation === 'number' &&
          Number.isFinite(session.runtime.generation) &&
          session.runtime.generation > 0
        ) {
          messageMetadata.runtimeGeneration = Math.floor(session.runtime.generation);
        }
        session.messages.push({
          id: this.createId('msg'),
          role: item.role,
          messageType: item.messageType,
          content: sanitized.text,
          metadata: messageMetadata,
          createdAt: item.createdAt || nowIso,
        });
      });
      const maxMessages = this.clampMax(this.maxMessagesPerSession, 1200);
      if (maxMessages > 0 && session.messages.length > maxMessages) {
        session.messages.splice(0, session.messages.length - maxMessages);
      }
      session.updatedAt = nowIso;
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

  async findSessionByExecutorSessionId(executorSessionId: string): Promise<FileSessionRecord | null> {
    const target = executorSessionId.trim();
    if (!target) return null;

    const memory = await this.readMemory();
    const candidates = memory.sessions
      .filter((session) => {
        const runtime = session.runtime || {};
        return (
          runtime.executorSessionId === target ||
          runtime.opencodeSessionId === target
        );
      })
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    return candidates[0] || null;
  }
}

export const taskCreationFileMemoryStore = new TaskCreationFileMemoryStore();
