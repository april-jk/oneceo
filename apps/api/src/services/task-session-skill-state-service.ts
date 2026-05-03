import path from 'node:path';
import { e2bConnector } from '../connectors/e2b-connector';
import { taskCreationSessionDAO } from '../db/dao/task-creation-session.dao';
import {
  managedSkillContextToCatalogEntry,
  mergeManagedSkillCatalogEntries,
  normalizeManagedSkillContexts,
  type ManagedSkillCatalogEntry,
  type ManagedSkillContext,
} from './altus-managed-shared';
import type { AltusManagedTaskIntentProfile } from './altus-managed-prompt-service';
import { taskSessionRedisCacheService } from './task-session-redis-cache-service';
import { userSkillService } from './user-skill-service';

export type SkillSelectionInput = {
  sourceType: 'platform' | 'custom';
  skillId: string;
  revisionId: string;
};

export type SessionSkillBinding = SkillSelectionInput & {
  activationSource: 'explicit' | 'required' | 'intent' | 'auto_tool';
  retentionMode: 'session';
  residentMode: 'pinned' | 'contextual';
  status: 'candidate' | 'active';
  lastMatchedAt: string | null;
  lastUsedAt: string | null;
  lastMessageType: string | null;
  lastIntentMode: AltusManagedTaskIntentProfile['mode'] | null;
  lastToolName: string | null;
};

export type SessionSkillState = {
  explicitSelections: SkillSelectionInput[];
  residentSelections: SkillSelectionInput[];
  bindings: SessionSkillBinding[];
  sandboxMaterialization: {
    residentVersion: number;
    lastSandboxId: string | null;
    lastSyncedAt: string | null;
  };
  fileMemorySnapshot: {
    snapshotVersion: number;
    savedAt: string | null;
    sourceSandboxId: string | null;
    archiveId: string | null;
    memorySummary: {
      residentSelections: SkillSelectionInput[];
      lastToolActivations: string[];
      workspaceMemoryPath: string;
    };
  };
  updatedAt: string | null;
};

type SandboxSkillFileMemory = {
  version: 1;
  sessionId: string;
  snapshotVersion: number;
  updatedAt: string;
  explicitSelections: SkillSelectionInput[];
  residentSelections: SkillSelectionInput[];
  bindings: SessionSkillBinding[];
  sandboxMaterialization: SessionSkillState['sandboxMaterialization'];
  lastToolActivations: string[];
};

type PrepareRunStateInput = {
  sessionId: string;
  skillCatalog: ManagedSkillCatalogEntry[];
  taskIntentProfile: AltusManagedTaskIntentProfile;
  submittedSelections?: unknown;
  submittedSkillContexts?: unknown;
  messageType: 'user_input' | 'user_response';
};

type PrepareRunStateResult = {
  skillCatalog: ManagedSkillCatalogEntry[];
  activeSkillsForTurn: ManagedSkillContext[];
  residentSkillSelections: SkillSelectionInput[];
  sessionSkillState: SessionSkillState;
};

const SESSION_SKILL_STATE_KEY = 'sessionSkillState';
export const SESSION_SKILL_MEMORY_RELATIVE_PATH = '.oneceo/session-memory/skills-memory.json';

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeTriggerText(value: unknown) {
  return asText(value).toLowerCase();
}

const PRESENTATION_INTENT_KEYWORDS = [
  'ppt',
  'pptx',
  'powerpoint',
  'presentation',
  'slide deck',
  'slides',
  '演示文稿',
  '幻灯片',
  '汇报稿',
] as const;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function shellEscape(value: string): string {
  if (!value) return "''";
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function selectionKey(value: SkillSelectionInput) {
  return `${value.sourceType}:${value.skillId}:${value.revisionId}`;
}

function normalizeSelection(value: unknown): SkillSelectionInput | null {
  const record = asRecord(value);
  const skillId = asText(record.skillId);
  const revisionId = asText(record.revisionId);
  if (!skillId || !revisionId) return null;
  return {
    sourceType: asText(record.sourceType) === 'custom' ? 'custom' : 'platform',
    skillId,
    revisionId,
  };
}

function normalizeSelections(value: unknown): SkillSelectionInput[] {
  if (!Array.isArray(value)) return [];
  const deduped = new Map<string, SkillSelectionInput>();
  for (const item of value) {
    const normalized = normalizeSelection(item);
    if (!normalized) continue;
    deduped.set(selectionKey(normalized), normalized);
  }
  return Array.from(deduped.values());
}

function readBinding(value: unknown): SessionSkillBinding | null {
  const selection = normalizeSelection(value);
  if (!selection) return null;
  const record = asRecord(value);
  const activationSource = asText(record.activationSource);
  const residentMode = asText(record.residentMode);
  const status = asText(record.status);
  return {
    ...selection,
    activationSource:
      activationSource === 'required' || activationSource === 'intent' || activationSource === 'auto_tool'
        ? activationSource
        : 'explicit',
    retentionMode: 'session',
    residentMode: residentMode === 'contextual' ? 'contextual' : 'pinned',
    status: status === 'active' ? 'active' : 'candidate',
    lastMatchedAt: asText(record.lastMatchedAt) || null,
    lastUsedAt: asText(record.lastUsedAt) || null,
    lastMessageType: asText(record.lastMessageType) || null,
    lastIntentMode:
      asText(record.lastIntentMode) === 'deployable_web_app' ||
      asText(record.lastIntentMode) === 'non_deployable_artifact'
        ? (asText(record.lastIntentMode) as AltusManagedTaskIntentProfile['mode'])
        : 'neutral',
    lastToolName: asText(record.lastToolName) || null,
  };
}

function emptyState(): SessionSkillState {
  return {
    explicitSelections: [],
    residentSelections: [],
    bindings: [],
    sandboxMaterialization: {
      residentVersion: 0,
      lastSandboxId: null,
      lastSyncedAt: null,
    },
    fileMemorySnapshot: {
      snapshotVersion: 0,
      savedAt: null,
      sourceSandboxId: null,
      archiveId: null,
      memorySummary: {
        residentSelections: [],
        lastToolActivations: [],
        workspaceMemoryPath: SESSION_SKILL_MEMORY_RELATIVE_PATH,
      },
    },
    updatedAt: null,
  };
}

export function readSessionSkillState(value: unknown): SessionSkillState {
  const record = asRecord(value);
  const sandboxMaterialization = asRecord(record.sandboxMaterialization);
  const fileMemorySnapshot = asRecord(record.fileMemorySnapshot);
  const memorySummary = asRecord(fileMemorySnapshot.memorySummary);
  const bindingsRaw = Array.isArray(record.bindings) ? record.bindings : [];
  const bindings: SessionSkillBinding[] = [];
  for (const item of bindingsRaw) {
    const binding = readBinding(item);
    if (binding) bindings.push(binding);
  }
  return {
    explicitSelections: normalizeSelections(record.explicitSelections),
    residentSelections: normalizeSelections(record.residentSelections),
    bindings,
    sandboxMaterialization: {
      residentVersion:
        typeof sandboxMaterialization.residentVersion === 'number' &&
        Number.isFinite(sandboxMaterialization.residentVersion)
          ? Math.max(0, Math.floor(sandboxMaterialization.residentVersion))
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
      memorySummary: {
        residentSelections: normalizeSelections(memorySummary.residentSelections),
        lastToolActivations: Array.isArray(memorySummary.lastToolActivations)
          ? memorySummary.lastToolActivations.map((item) => asText(item)).filter(Boolean).slice(0, 20)
          : [],
        workspaceMemoryPath: asText(memorySummary.workspaceMemoryPath) || SESSION_SKILL_MEMORY_RELATIVE_PATH,
      },
    },
    updatedAt: asText(record.updatedAt) || null,
  };
}

function serializeState(state: SessionSkillState): Record<string, unknown> {
  return {
    explicitSelections: state.explicitSelections,
    residentSelections: state.residentSelections,
    bindings: state.bindings,
    sandboxMaterialization: state.sandboxMaterialization,
    fileMemorySnapshot: state.fileMemorySnapshot,
    updatedAt: state.updatedAt,
  };
}

function dedupeSelections(items: SkillSelectionInput[]) {
  const deduped = new Map<string, SkillSelectionInput>();
  for (const item of items) {
    deduped.set(selectionKey(item), item);
  }
  return Array.from(deduped.values());
}

function selectionExistsInCatalog(selection: SkillSelectionInput, catalog: ManagedSkillCatalogEntry[]) {
  return catalog.some(
    (item) =>
      item.sourceType === selection.sourceType &&
      item.skillId === selection.skillId &&
      item.revisionId === selection.revisionId
  );
}

function findCatalogEntry(selection: SkillSelectionInput, catalog: ManagedSkillCatalogEntry[]) {
  return catalog.find(
    (item) =>
      item.sourceType === selection.sourceType &&
      item.skillId === selection.skillId &&
      item.revisionId === selection.revisionId
  );
}

function filterSelectionsByCatalog(selections: SkillSelectionInput[], catalog: ManagedSkillCatalogEntry[]) {
  return selections.filter((item) => selectionExistsInCatalog(item, catalog));
}

function isSameSelection(left: SkillSelectionInput, right: SkillSelectionInput) {
  return (
    left.sourceType === right.sourceType &&
    left.skillId === right.skillId &&
    left.revisionId === right.revisionId
  );
}

function mergeResolvedSkillContexts(
  resolved: ManagedSkillContext[],
  fallbackContexts: ManagedSkillContext[],
  activeSelections: SkillSelectionInput[]
) {
  const results = new Map<string, ManagedSkillContext>();
  for (const skill of resolved) {
    results.set(selectionKey(skill), skill);
  }
  for (const skill of fallbackContexts) {
    const selection = {
      sourceType: skill.sourceType,
      skillId: skill.skillId,
      revisionId: skill.revisionId,
    } satisfies SkillSelectionInput;
    if (!activeSelections.some((item) => isSameSelection(item, selection))) continue;
    const key = selectionKey(selection);
    if (!results.has(key)) {
      results.set(key, skill);
    }
  }
  return Array.from(results.values());
}

function shouldRetainPersistedBinding(binding: SessionSkillBinding, catalog: ManagedSkillCatalogEntry[]) {
  const entry = findCatalogEntry(binding, catalog);
  if (!entry) return false;
  if (binding.activationSource === 'required') {
    return Boolean(entry.governance?.required);
  }
  return true;
}

function upsertBinding(
  bindings: SessionSkillBinding[],
  selection: SkillSelectionInput,
  input: {
    activationSource: SessionSkillBinding['activationSource'];
    residentMode: SessionSkillBinding['residentMode'];
    status: SessionSkillBinding['status'];
    matchedAt: string;
    messageType: string;
    intentMode: AltusManagedTaskIntentProfile['mode'];
    toolName?: string | null;
  }
) {
  const key = selectionKey(selection);
  const existing = bindings.find((item) => selectionKey(item) === key);
  if (existing) {
    existing.activationSource = input.activationSource;
    existing.residentMode = input.residentMode;
    existing.status = input.status;
    existing.lastMatchedAt = input.matchedAt;
    existing.lastUsedAt = input.matchedAt;
    existing.lastMessageType = input.messageType;
    existing.lastIntentMode = input.intentMode;
    existing.lastToolName = input.toolName || null;
    return existing;
  }
  const created: SessionSkillBinding = {
    ...selection,
    activationSource: input.activationSource,
    retentionMode: 'session',
    residentMode: input.residentMode,
    status: input.status,
    lastMatchedAt: input.matchedAt,
    lastUsedAt: input.matchedAt,
    lastMessageType: input.messageType,
    lastIntentMode: input.intentMode,
    lastToolName: input.toolName || null,
  };
  bindings.push(created);
  return created;
}

function isIntentTriggeredSkill(
  skill: ManagedSkillCatalogEntry,
  taskIntentProfile: AltusManagedTaskIntentProfile
) {
  const governance = skill.governance;
  if (!governance?.autoActivation?.enabled) return false;
  const triggers = Array.isArray(governance.autoActivation.triggers)
    ? governance.autoActivation.triggers.map((item) => asText(item).toLowerCase()).filter(Boolean)
    : [];
  if (triggers.length === 0) return false;
  if (triggers.includes('always')) return true;
  const recentText = normalizeTriggerText((taskIntentProfile.recentUserMessages || []).join('\n'));
  const hasPresentationTrigger = triggers.some((item) =>
    item === 'ppt' ||
    item === 'pptx' ||
    item === 'powerpoint' ||
    item === 'presentation' ||
    item === 'slides' ||
    item === '演示文稿'
  );
  if (hasPresentationTrigger && PRESENTATION_INTENT_KEYWORDS.some((keyword) => recentText.includes(keyword))) {
    return true;
  }
  const isDeploymentOrchestrator = governance.systemRole === 'deployment_orchestrator';
  const deploymentRequested =
    taskIntentProfile.deployRequested === true &&
    taskIntentProfile.deploymentAllowed === true &&
    !taskIntentProfile.explicitNoDeploy &&
    !taskIntentProfile.explicitNoWeb;
  const hasDeploymentTrigger = triggers.some((item) =>
    item === 'deployment' ||
    item === 'deployable_web_app' ||
    item === 'deploy' ||
    item === 'redeploy' ||
    item === 'rollback' ||
    item === 'status' ||
    item === 'deployment_status'
  );
  if (isDeploymentOrchestrator) {
    return deploymentRequested && hasDeploymentTrigger;
  }
  if (taskIntentProfile.mode === 'deployable_web_app') {
    if (triggers.includes('deployment') || triggers.includes('deployable_web_app') || triggers.includes('web_app')) {
      return true;
    }
  }
  if (taskIntentProfile.mode === 'non_deployable_artifact') {
    if (
      triggers.includes('artifact') ||
      triggers.includes('non_deployable_artifact') ||
      (taskIntentProfile.scriptArtifactRequested && triggers.includes('script')) ||
      (taskIntentProfile.emailTemplateRequested && triggers.includes('email_template'))
    ) {
      return true;
    }
  }
  return false;
}

function shouldAttachResidentBinding(
  binding: SessionSkillBinding,
  taskIntentProfile: AltusManagedTaskIntentProfile,
  isContinuation: boolean
) {
  if (binding.activationSource === 'explicit' || binding.activationSource === 'required') {
    return true;
  }
  if (binding.activationSource === 'intent') {
    return binding.lastIntentMode === taskIntentProfile.mode;
  }
  if (binding.activationSource === 'auto_tool') {
    return isContinuation || binding.lastIntentMode === taskIntentProfile.mode;
  }
  return false;
}

function readToolActivationsFromFile(state: SessionSkillState) {
  return Array.isArray(state.fileMemorySnapshot.memorySummary.lastToolActivations)
    ? state.fileMemorySnapshot.memorySummary.lastToolActivations
    : [];
}

function buildMemoryPath(workspaceRoot: string) {
  return path.posix.join(workspaceRoot, SESSION_SKILL_MEMORY_RELATIVE_PATH);
}

export class TaskSessionSkillStateService {
  private async resolveSessionScope(sessionId: string) {
    const scope = await taskSessionRedisCacheService.resolveScopeBySession(sessionId);
    return scope ? { sessionId, ...scope } : null;
  }

  async getSessionSkillState(sessionId: string) {
    const scope = await this.resolveSessionScope(sessionId);
    if (scope) {
      const cached = await taskSessionRedisCacheService.getSkillSessionState(scope);
      if (cached?.state) {
        return readSessionSkillState(cached.state);
      }
    }

    const metadata = await taskCreationSessionDAO.getSessionMetadataJson(sessionId);
    const state = readSessionSkillState(metadata[SESSION_SKILL_STATE_KEY]);
    if (scope) {
      await taskSessionRedisCacheService.setSkillSessionState({
        ...scope,
        state: serializeState(state),
      });
    }
    return state;
  }

  async saveSessionSkillState(sessionId: string, state: SessionSkillState) {
    const nextState: SessionSkillState = {
      ...state,
      updatedAt: state.updatedAt || new Date().toISOString(),
      fileMemorySnapshot: {
        ...state.fileMemorySnapshot,
        memorySummary: {
          ...state.fileMemorySnapshot.memorySummary,
          workspaceMemoryPath:
            asText(state.fileMemorySnapshot.memorySummary.workspaceMemoryPath) || SESSION_SKILL_MEMORY_RELATIVE_PATH,
        },
      },
    };
    await taskCreationSessionDAO.patchSessionMetadataJson(sessionId, {
      [SESSION_SKILL_STATE_KEY]: serializeState(nextState),
    });
    const scope = await this.resolveSessionScope(sessionId);
    if (scope) {
      await taskSessionRedisCacheService.setSkillSessionState({
        ...scope,
        state: serializeState(nextState),
      });
    }
    return nextState;
  }

  async prepareRunState(input: PrepareRunStateInput): Promise<PrepareRunStateResult> {
    const now = new Date().toISOString();
    const current = await this.getSessionSkillState(input.sessionId);
    const submittedSkillContexts = normalizeManagedSkillContexts(input.submittedSkillContexts);
    const catalog = mergeManagedSkillCatalogEntries(
      Array.isArray(input.skillCatalog) ? input.skillCatalog : [],
      submittedSkillContexts.map((item) => managedSkillContextToCatalogEntry(item))
    );
    const hasSubmittedSelections = input.submittedSelections !== undefined;
    const explicitSelections = filterSelectionsByCatalog(
      hasSubmittedSelections ? normalizeSelections(input.submittedSelections) : current.explicitSelections,
      catalog
    );
    const requiredSelections = catalog
      .filter((item) => Boolean(item.governance?.required))
      .map((item) => ({
        sourceType: item.sourceType,
        skillId: item.skillId,
        revisionId: item.revisionId,
      } satisfies SkillSelectionInput));
    const intentSelections = catalog
      .filter((item) => isIntentTriggeredSkill(item, input.taskIntentProfile))
      .map((item) => ({
        sourceType: item.sourceType,
        skillId: item.skillId,
        revisionId: item.revisionId,
      } satisfies SkillSelectionInput));
    const bindings = current.bindings
      .filter((item) => shouldRetainPersistedBinding(item, catalog))
      .map((item) => ({ ...item }));
    const residentBindings = bindings.filter((item) =>
      shouldAttachResidentBinding(item, input.taskIntentProfile, input.messageType === 'user_response')
    );

    for (const selection of explicitSelections) {
      upsertBinding(bindings, selection, {
        activationSource: 'explicit',
        residentMode: 'pinned',
        status: 'active',
        matchedAt: now,
        messageType: input.messageType,
        intentMode: input.taskIntentProfile.mode,
      });
    }
    for (const selection of requiredSelections) {
      upsertBinding(bindings, selection, {
        activationSource: 'required',
        residentMode: 'pinned',
        status: 'active',
        matchedAt: now,
        messageType: input.messageType,
        intentMode: input.taskIntentProfile.mode,
      });
    }
    for (const selection of intentSelections) {
      upsertBinding(bindings, selection, {
        activationSource: 'intent',
        residentMode: 'contextual',
        status: 'candidate',
        matchedAt: now,
        messageType: input.messageType,
        intentMode: input.taskIntentProfile.mode,
      });
    }

    const activeSelections = dedupeSelections([
      ...explicitSelections,
      ...requiredSelections,
      ...intentSelections,
      ...residentBindings.map((item) => ({
        sourceType: item.sourceType,
        skillId: item.skillId,
        revisionId: item.revisionId,
      })),
    ]);
    const residentSelections = dedupeSelections([
      ...explicitSelections,
      ...requiredSelections,
      ...residentBindings.map((item) => ({
        sourceType: item.sourceType,
        skillId: item.skillId,
        revisionId: item.revisionId,
      })),
      ...intentSelections,
    ]);
    const resolvedActiveSkills = await userSkillService.resolveSelectionsForSession(input.sessionId, activeSelections);
    const activeSkillsForTurn = mergeResolvedSkillContexts(
      resolvedActiveSkills as ManagedSkillContext[],
      submittedSkillContexts,
      activeSelections
    );
    const nextState: SessionSkillState = {
      ...current,
      explicitSelections,
      residentSelections,
      bindings,
      updatedAt: now,
    };
    const savedState = await this.saveSessionSkillState(input.sessionId, nextState);
    return {
      skillCatalog: catalog,
      activeSkillsForTurn,
      residentSkillSelections: residentSelections,
      sessionSkillState: savedState,
    };
  }

  private buildSandboxFileMemory(sessionId: string, state: SessionSkillState): SandboxSkillFileMemory {
    return {
      version: 1,
      sessionId,
      snapshotVersion: Math.max(1, state.fileMemorySnapshot.snapshotVersion + 1),
      updatedAt: new Date().toISOString(),
      explicitSelections: state.explicitSelections,
      residentSelections: state.residentSelections,
      bindings: state.bindings,
      sandboxMaterialization: state.sandboxMaterialization,
      lastToolActivations: readToolActivationsFromFile(state).slice(-20),
    };
  }

  async readSandboxFileMemory(input: { sessionId: string; sandboxId: string; workspaceRoot: string }) {
    try {
      const raw = await e2bConnector.readFile(input.sandboxId, buildMemoryPath(input.workspaceRoot));
      const parsed = JSON.parse(Buffer.from(raw).toString('utf8')) as Partial<SandboxSkillFileMemory>;
      if (!parsed || parsed.version !== 1) return null;
      if (asText(parsed.sessionId) && asText(parsed.sessionId) !== input.sessionId) return null;
      return {
        version: 1 as const,
        sessionId: input.sessionId,
        snapshotVersion:
          typeof parsed.snapshotVersion === 'number' && Number.isFinite(parsed.snapshotVersion)
            ? Math.max(1, Math.floor(parsed.snapshotVersion))
            : 1,
        updatedAt: asText(parsed.updatedAt) || new Date().toISOString(),
        explicitSelections: normalizeSelections(parsed.explicitSelections),
        residentSelections: normalizeSelections(parsed.residentSelections),
        bindings: Array.isArray(parsed.bindings)
          ? parsed.bindings.map((item) => readBinding(item)).filter(Boolean) as SessionSkillBinding[]
          : [],
        sandboxMaterialization: {
          residentVersion:
            typeof parsed.sandboxMaterialization?.residentVersion === 'number' &&
            Number.isFinite(parsed.sandboxMaterialization.residentVersion)
              ? Math.max(0, Math.floor(parsed.sandboxMaterialization.residentVersion))
              : 0,
          lastSandboxId: asText(parsed.sandboxMaterialization?.lastSandboxId) || null,
          lastSyncedAt: asText(parsed.sandboxMaterialization?.lastSyncedAt) || null,
        },
        lastToolActivations: Array.isArray(parsed.lastToolActivations)
          ? parsed.lastToolActivations.map((item) => asText(item)).filter(Boolean).slice(-20)
          : [],
      };
    } catch {
      return null;
    }
  }

  async writeSandboxFileMemory(input: {
    sessionId: string;
    sandboxId: string;
    workspaceRoot: string;
    state: SessionSkillState;
  }) {
    const memory = this.buildSandboxFileMemory(input.sessionId, input.state);
    const memoryPath = buildMemoryPath(input.workspaceRoot);
    const memoryDir = path.posix.dirname(memoryPath);
    await e2bConnector.runCommand(
      input.sandboxId,
      `mkdir -p ${shellEscape(memoryDir)}`,
      { timeoutMs: 15_000 }
    );
    await e2bConnector.writeFile(
      input.sandboxId,
      memoryPath,
      Buffer.from(JSON.stringify(memory, null, 2), 'utf8')
    );
    return memory;
  }

  async recordRuntimeAutoAttachedSkills(input: {
    sessionId: string;
    sandboxId: string;
    workspaceRoot: string;
    activatedSkills: ManagedSkillContext[];
    toolName: string;
    taskIntentProfile: AltusManagedTaskIntentProfile;
  }) {
    if (!Array.isArray(input.activatedSkills) || input.activatedSkills.length === 0) {
      return null;
    }
    const currentState = await this.getSessionSkillState(input.sessionId);
    const bindings = currentState.bindings.map((item) => ({ ...item }));
    const selections = dedupeSelections(
      input.activatedSkills.map((item) => ({
        sourceType: item.sourceType,
        skillId: item.skillId,
        revisionId: item.revisionId,
      }))
    );
    const now = new Date().toISOString();
    for (const selection of selections) {
      upsertBinding(bindings, selection, {
        activationSource: 'auto_tool',
        residentMode: 'contextual',
        status: 'active',
        matchedAt: now,
        messageType: 'tool_runtime',
        intentMode: input.taskIntentProfile.mode,
        toolName: input.toolName,
      });
    }
    const nextState: SessionSkillState = {
      ...currentState,
      bindings,
      residentSelections: dedupeSelections([...currentState.residentSelections, ...selections]),
      sandboxMaterialization: {
        ...currentState.sandboxMaterialization,
        lastSandboxId: input.sandboxId,
        lastSyncedAt: now,
      },
      fileMemorySnapshot: {
        ...currentState.fileMemorySnapshot,
        memorySummary: {
          ...currentState.fileMemorySnapshot.memorySummary,
          lastToolActivations: dedupeSelections([...selections])
            .map((item) => `${input.toolName}:${item.sourceType}:${item.skillId}:${item.revisionId}`)
            .concat(readToolActivationsFromFile(currentState))
            .slice(0, 20),
        },
      },
      updatedAt: now,
    };
    await this.writeSandboxFileMemory({
      sessionId: input.sessionId,
      sandboxId: input.sandboxId,
      workspaceRoot: input.workspaceRoot,
      state: nextState,
    });
    return nextState;
  }

  async markResidentSkillsMaterialized(input: {
    sessionId: string;
    sandboxId: string;
    workspaceRoot: string;
    residentSelections: SkillSelectionInput[];
  }) {
    const currentState = await this.getSessionSkillState(input.sessionId);
    const now = new Date().toISOString();
    const nextState: SessionSkillState = {
      ...currentState,
      residentSelections: dedupeSelections(input.residentSelections),
      sandboxMaterialization: {
        residentVersion: currentState.sandboxMaterialization.residentVersion + 1,
        lastSandboxId: input.sandboxId,
        lastSyncedAt: now,
      },
      updatedAt: now,
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
    reason: string;
  }) {
    const memory = await this.readSandboxFileMemory(input);
    if (!memory) {
      return this.getSessionSkillState(input.sessionId);
    }
    const current = await this.getSessionSkillState(input.sessionId);
    const nextState: SessionSkillState = {
      ...current,
      explicitSelections: memory.explicitSelections,
      residentSelections: memory.residentSelections,
      bindings: memory.bindings,
      sandboxMaterialization: {
        ...memory.sandboxMaterialization,
        lastSandboxId: input.sandboxId,
        lastSyncedAt: memory.updatedAt,
      },
      fileMemorySnapshot: {
        snapshotVersion: memory.snapshotVersion,
        savedAt: new Date().toISOString(),
        sourceSandboxId: input.sandboxId,
        archiveId: asText(input.archiveId) || null,
        memorySummary: {
          residentSelections: memory.residentSelections,
          lastToolActivations: memory.lastToolActivations.slice(-20),
          workspaceMemoryPath: SESSION_SKILL_MEMORY_RELATIVE_PATH,
        },
      },
      updatedAt: new Date().toISOString(),
    };
    return this.saveSessionSkillState(input.sessionId, nextState);
  }
}

export const taskSessionSkillStateService = new TaskSessionSkillStateService();
