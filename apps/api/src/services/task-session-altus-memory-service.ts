import path from 'node:path';
import { e2bConnector } from '../connectors/e2b-connector';
import { taskCreationSessionDAO } from '../db/dao/task-creation-session.dao';
import { taskSessionRedisCacheService } from './task-session-redis-cache-service';

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function shellEscape(value: string): string {
  if (!value) return "''";
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

export const SESSION_ALTUS_MEMORY_RELATIVE_PATH = '.oneceo/session-memory/altus-memory.json';

export type AltusSessionMemory = {
  version: number;
  summary: {
    goal: string;
    latestOutcome: string;
    openQuestions: string[];
  };
  constraints: string[];
  decisions: string[];
  workingNotes: string[];
  sandboxMaterialization: {
    snapshotVersion: number;
    lastSandboxId: string | null;
    lastSyncedAt: string | null;
  };
  fileMemorySnapshot: {
    snapshotVersion: number;
    savedAt: string | null;
    sourceSandboxId: string | null;
    archiveId: string | null;
    workspaceMemoryPath: string;
  };
  updatedAt: string | null;
  lastWriterRunId: string | null;
};

type SandboxAltusFileMemory = {
  version: 1;
  sessionId: string;
  snapshotVersion: number;
  updatedAt: string;
  summary: AltusSessionMemory['summary'];
  constraints: string[];
  decisions: string[];
  workingNotes: string[];
  sandboxMaterialization: AltusSessionMemory['sandboxMaterialization'];
  lastWriterRunId: string | null;
};

const ALTUS_SESSION_MEMORY_KEY = 'altusSessionMemory';
const LIMITS = {
  goal: 500,
  latestOutcome: 1000,
  listItem: 300,
  openQuestions: 8,
  constraints: 12,
  decisions: 12,
  workingNotes: 20,
} as const;

function buildMemoryPath(workspaceRoot: string) {
  return path.posix.join(workspaceRoot, SESSION_ALTUS_MEMORY_RELATIVE_PATH);
}

function trimList(value: unknown, maxItems: number) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asText(item))
    .filter(Boolean)
    .slice(-maxItems)
    .map((item) => item.slice(0, LIMITS.listItem));
}

function emptyState(): AltusSessionMemory {
  return {
    version: 0,
    summary: {
      goal: '',
      latestOutcome: '',
      openQuestions: [],
    },
    constraints: [],
    decisions: [],
    workingNotes: [],
    sandboxMaterialization: {
      snapshotVersion: 0,
      lastSandboxId: null,
      lastSyncedAt: null,
    },
    fileMemorySnapshot: {
      snapshotVersion: 0,
      savedAt: null,
      sourceSandboxId: null,
      archiveId: null,
      workspaceMemoryPath: SESSION_ALTUS_MEMORY_RELATIVE_PATH,
    },
    updatedAt: null,
    lastWriterRunId: null,
  };
}

export function readSessionAltusMemory(value: unknown): AltusSessionMemory {
  const record = asRecord(value);
  const summary = asRecord(record.summary);
  const sandboxMaterialization = asRecord(record.sandboxMaterialization);
  const fileMemorySnapshot = asRecord(record.fileMemorySnapshot);
  return {
    version:
      typeof record.version === 'number' && Number.isFinite(record.version)
        ? Math.max(0, Math.floor(record.version))
        : 0,
    summary: {
      goal: asText(summary.goal).slice(0, LIMITS.goal),
      latestOutcome: asText(summary.latestOutcome).slice(0, LIMITS.latestOutcome),
      openQuestions: trimList(summary.openQuestions, LIMITS.openQuestions),
    },
    constraints: trimList(record.constraints, LIMITS.constraints),
    decisions: trimList(record.decisions, LIMITS.decisions),
    workingNotes: trimList(record.workingNotes, LIMITS.workingNotes),
    sandboxMaterialization: {
      snapshotVersion:
        typeof sandboxMaterialization.snapshotVersion === 'number' &&
        Number.isFinite(sandboxMaterialization.snapshotVersion)
          ? Math.max(0, Math.floor(sandboxMaterialization.snapshotVersion))
          : 0,
      lastSandboxId: asText(sandboxMaterialization.lastSandboxId) || null,
      lastSyncedAt: asText(sandboxMaterialization.lastSyncedAt) || null,
    },
    fileMemorySnapshot: {
      snapshotVersion:
        typeof fileMemorySnapshot.snapshotVersion === 'number' && Number.isFinite(fileMemorySnapshot.snapshotVersion)
          ? Math.max(0, Math.floor(fileMemorySnapshot.snapshotVersion))
          : 0,
      savedAt: asText(fileMemorySnapshot.savedAt) || null,
      sourceSandboxId: asText(fileMemorySnapshot.sourceSandboxId) || null,
      archiveId: asText(fileMemorySnapshot.archiveId) || null,
      workspaceMemoryPath: asText(fileMemorySnapshot.workspaceMemoryPath) || SESSION_ALTUS_MEMORY_RELATIVE_PATH,
    },
    updatedAt: asText(record.updatedAt) || null,
    lastWriterRunId: asText(record.lastWriterRunId) || null,
  };
}

function serializeState(state: AltusSessionMemory): Record<string, unknown> {
  return {
    version: state.version,
    summary: state.summary,
    constraints: state.constraints,
    decisions: state.decisions,
    workingNotes: state.workingNotes,
    sandboxMaterialization: state.sandboxMaterialization,
    fileMemorySnapshot: state.fileMemorySnapshot,
    updatedAt: state.updatedAt,
    lastWriterRunId: state.lastWriterRunId,
  };
}

function extractTextContent(content: unknown) {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (!item || typeof item !== 'object') return '';
        const part = item as Record<string, unknown>;
        return asText(part.text || part.content || part.value);
      })
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  return '';
}

function mergeWorkingNotes(current: string[], additions: string[]) {
  const normalized = [...current, ...additions]
    .map((item) => asText(item))
    .filter(Boolean)
    .map((item) => item.slice(0, LIMITS.listItem));
  const deduped = normalized.filter((item, index) => normalized.indexOf(item) === index);
  return deduped.slice(-LIMITS.workingNotes);
}

export class TaskSessionAltusMemoryService {
  private buildSandboxFileMemory(sessionId: string, state: AltusSessionMemory): SandboxAltusFileMemory {
    return {
      version: 1,
      sessionId,
      snapshotVersion: Math.max(1, state.fileMemorySnapshot.snapshotVersion || state.version || 1),
      updatedAt: state.updatedAt || new Date().toISOString(),
      summary: state.summary,
      constraints: state.constraints,
      decisions: state.decisions,
      workingNotes: state.workingNotes,
      sandboxMaterialization: state.sandboxMaterialization,
      lastWriterRunId: state.lastWriterRunId,
    };
  }

  private async resolveScope(sessionId: string) {
    return taskSessionRedisCacheService.resolveScopeBySession(sessionId);
  }

  private async deriveSummaryFromTimeline(sessionId: string, current: AltusSessionMemory) {
    const recent = await taskCreationSessionDAO.getRecentMessages(sessionId);
    const reversed = [...recent].reverse();
    const latestUserMessage = reversed.find(
      (item) =>
        item.role === 'user' &&
        (item.messageType === 'user_input' || item.messageType === 'user_response') &&
        extractTextContent(item.content)
    );
    const latestAgentMessage = reversed.find(
      (item) =>
        (item.role === 'agent' || item.role === 'assistant') &&
        item.messageType !== 'tool_result' &&
        extractTextContent(item.content)
    );
    const pendingQuestion = reversed.find(
      (item) =>
        (item.role === 'agent' || item.role === 'assistant') &&
        item.messageType === 'waiting_user' &&
        extractTextContent(item.content)
    );

    return {
      goal:
        extractTextContent(latestUserMessage?.content).slice(0, LIMITS.goal) ||
        current.summary.goal,
      latestOutcome:
        extractTextContent(latestAgentMessage?.content).slice(0, LIMITS.latestOutcome) ||
        current.summary.latestOutcome,
      openQuestions: pendingQuestion
        ? [extractTextContent(pendingQuestion.content).slice(0, LIMITS.listItem)]
        : current.summary.openQuestions,
    };
  }

  private async deriveWorkingNotesFromTimeline(sessionId: string, current: AltusSessionMemory) {
    const recent = await taskCreationSessionDAO.getRecentMessages(sessionId);
    const reversed = [...recent].reverse();
    const latestUserMessage = reversed.find(
      (item) =>
        item.role === 'user' &&
        (item.messageType === 'user_input' || item.messageType === 'user_response') &&
        extractTextContent(item.content)
    );
    const latestAgentMessage = reversed.find(
      (item) =>
        (item.role === 'agent' || item.role === 'assistant') &&
        item.messageType !== 'tool_result' &&
        extractTextContent(item.content)
    );
    return mergeWorkingNotes(current.workingNotes, [
      latestUserMessage ? `user: ${extractTextContent(latestUserMessage.content)}` : '',
      latestAgentMessage ? `assistant: ${extractTextContent(latestAgentMessage.content)}` : '',
    ]);
  }

  async getSessionAltusMemory(sessionId: string): Promise<AltusSessionMemory> {
    const scope = await this.resolveScope(sessionId);
    if (scope) {
      const cached = await taskSessionRedisCacheService.getAltusSessionMemory({
        sessionId,
        ...scope,
      });
      if (cached?.state) {
        return readSessionAltusMemory(cached.state);
      }
    }

    const metadata = await taskCreationSessionDAO.getSessionMetadataJson(sessionId);
    const state = readSessionAltusMemory(metadata[ALTUS_SESSION_MEMORY_KEY]);
    if (scope) {
      await taskSessionRedisCacheService.setAltusSessionMemory({
        sessionId,
        ...scope,
        state: serializeState(state),
      });
    }
    return state;
  }

  async saveSessionAltusMemory(sessionId: string, state: AltusSessionMemory) {
    const normalized = readSessionAltusMemory(state);
    const patched = await taskCreationSessionDAO.patchSessionMetadataJson(sessionId, {
      [ALTUS_SESSION_MEMORY_KEY]: serializeState(normalized),
    });
    const scope = await this.resolveScope(sessionId);
    if (scope) {
      await taskSessionRedisCacheService.setAltusSessionMemory({
        sessionId,
        ...scope,
        state: serializeState(normalized),
      });
    }
    return readSessionAltusMemory(
      asRecord(patched?.metadataJson)[ALTUS_SESSION_MEMORY_KEY] ?? serializeState(normalized)
    );
  }

  async writeSandboxFileMemory(input: {
    sessionId: string;
    sandboxId: string;
    workspaceRoot: string;
    state: AltusSessionMemory;
  }) {
    const memory = this.buildSandboxFileMemory(input.sessionId, input.state);
    const memoryPath = buildMemoryPath(input.workspaceRoot);
    const memoryDir = path.posix.dirname(memoryPath);
    await e2bConnector.runCommand(input.sandboxId, `mkdir -p ${shellEscape(memoryDir)}`, {
      timeoutMs: 15_000,
    });
    await e2bConnector.writeFile(
      input.sandboxId,
      memoryPath,
      Buffer.from(JSON.stringify(memory, null, 2), 'utf8')
    );
    return memory;
  }

  async readSandboxFileMemory(input: { sandboxId: string; workspaceRoot: string }) {
    const memoryPath = buildMemoryPath(input.workspaceRoot);
    try {
      const content = await e2bConnector.readFile(input.sandboxId, memoryPath);
      const parsed = JSON.parse(typeof content === 'string' ? content : String(content)) as Record<string, unknown>;
      return {
        snapshotVersion:
          typeof parsed.snapshotVersion === 'number' && Number.isFinite(parsed.snapshotVersion)
            ? Math.max(1, Math.floor(parsed.snapshotVersion))
            : 1,
        updatedAt: asText(parsed.updatedAt) || new Date().toISOString(),
        summary: readSessionAltusMemory({ summary: parsed.summary }).summary,
        constraints: trimList(parsed.constraints, LIMITS.constraints),
        decisions: trimList(parsed.decisions, LIMITS.decisions),
        workingNotes: trimList(parsed.workingNotes, LIMITS.workingNotes),
        sandboxMaterialization: readSessionAltusMemory({
          sandboxMaterialization: parsed.sandboxMaterialization,
        }).sandboxMaterialization,
        lastWriterRunId: asText(parsed.lastWriterRunId) || null,
      };
    } catch {
      return null;
    }
  }

  async markMaterialized(input: {
    sessionId: string;
    sandboxId: string;
    workspaceRoot: string;
    runId?: string | null;
  }) {
    const current = await this.getSessionAltusMemory(input.sessionId);
    const now = new Date().toISOString();
    const nextState: AltusSessionMemory = {
      ...current,
      sandboxMaterialization: {
        snapshotVersion: current.sandboxMaterialization.snapshotVersion + 1,
        lastSandboxId: input.sandboxId,
        lastSyncedAt: now,
      },
      fileMemorySnapshot: {
        ...current.fileMemorySnapshot,
        snapshotVersion: Math.max(1, current.fileMemorySnapshot.snapshotVersion || current.version || 1),
      },
      updatedAt: now,
      lastWriterRunId: asText(input.runId) || current.lastWriterRunId,
    };
    await this.writeSandboxFileMemory({
      sessionId: input.sessionId,
      sandboxId: input.sandboxId,
      workspaceRoot: input.workspaceRoot,
      state: nextState,
    });
    return nextState;
  }

  async saveSandboxFileMemoryToDb(input: {
    sessionId: string;
    sandboxId: string;
    workspaceRoot: string;
    archiveId?: string | null;
    runId?: string | null;
    reason: string;
  }) {
    const memory = await this.readSandboxFileMemory(input);
    if (!memory) {
      return this.saveTimelineDerivedMemory({
        sessionId: input.sessionId,
        runId: input.runId,
        reason: input.reason,
      });
    }
    const current = await this.getSessionAltusMemory(input.sessionId);
    const derivedSummary = await this.deriveSummaryFromTimeline(input.sessionId, current);
    const now = new Date().toISOString();
    const nextState: AltusSessionMemory = {
      ...current,
      version: Math.max(current.version, memory.snapshotVersion, 0) + 1,
      summary: derivedSummary,
      constraints: memory.constraints,
      decisions: memory.decisions,
      workingNotes: memory.workingNotes,
      sandboxMaterialization: {
        ...memory.sandboxMaterialization,
        lastSandboxId: input.sandboxId,
        lastSyncedAt: memory.updatedAt,
      },
      fileMemorySnapshot: {
        snapshotVersion: memory.snapshotVersion,
        savedAt: now,
        sourceSandboxId: input.sandboxId,
        archiveId: asText(input.archiveId) || null,
        workspaceMemoryPath: SESSION_ALTUS_MEMORY_RELATIVE_PATH,
      },
      updatedAt: now,
      lastWriterRunId: asText(input.runId) || memory.lastWriterRunId || current.lastWriterRunId,
    };
    return this.saveSessionAltusMemory(input.sessionId, nextState);
  }

  async saveTimelineDerivedMemory(input: {
    sessionId: string;
    runId?: string | null;
    reason: string;
  }) {
    const current = await this.getSessionAltusMemory(input.sessionId);
    const [derivedSummary, derivedWorkingNotes] = await Promise.all([
      this.deriveSummaryFromTimeline(input.sessionId, current),
      this.deriveWorkingNotesFromTimeline(input.sessionId, current),
    ]);
    const now = new Date().toISOString();
    const nextState: AltusSessionMemory = {
      ...current,
      version: current.version + 1,
      summary: derivedSummary,
      workingNotes: derivedWorkingNotes,
      updatedAt: now,
      lastWriterRunId: asText(input.runId) || current.lastWriterRunId,
    };
    return this.saveSessionAltusMemory(input.sessionId, nextState);
  }
}

export const taskSessionAltusMemoryService = new TaskSessionAltusMemoryService();
