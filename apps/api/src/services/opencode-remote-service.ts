import type { OsacMessage } from '../clients/osac-client';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { taskCreationFileMemoryStore, type FileSessionRecord } from '../agents/task-creation/file-memory-store';
import { taskCreationCacheStore } from '../agents/task-creation/task-creation-cache-store';
import { osacAgentService } from './osac-agent-service';
import { osacConnectionManager } from './osac-connection-manager';
import { auditOsacAction } from '../utils/osac-audit';
import { resolveOpencodeWorkspacePath } from '../utils/opencode-workspace';
import { ensureDatabaseConnection } from '../config/database';
import { sandboxExecutionEnvironmentDAO, taskCreationSessionDAO } from '../db/dao';
import type { NewConversationMessage } from '../db/schema';
import type { ExecutionPlan, TaskDescription } from '../agents/task-creation/types/intent';
import { executionReviewAgent } from '../agents/task-creation/layers/execution-review-agent';
import { playwrightTestDetectionAgent } from '../agents/task-creation/layers/playwright-test-detection-agent';
import { markSandboxDirty, touchSandbox } from './sandbox-activity-service';
import { archiveSandboxWorkspace } from './sandbox-archive-service';
import { ensureNekoDebug } from './sandbox-debug-service';
import { sandboxAgentProvisionService } from './sandbox-agent-provision-service';
import {
  hasRenderableAssistantReply,
  listRecoveredOpencodeSessionIds,
  normalizeOpencodeNativeMessages,
} from '../utils/opencode-history-recovery';
import {
  buildTimelineMessageKey,
  normalizeMessageTimelineMetadata,
} from '../utils/task-message-identity';
import {
  buildOpencodeQuestionAnswers,
  findPendingOpencodeQuestion,
  type OpencodePendingQuestion,
} from './opencode-question-adapter';
import { DEFAULT_CODEX_MODEL } from '../utils/codex-runtime-config';
import { altusManagedSetupService } from './altus-managed-setup-service';
import type { AltusManagedTaskIntentProfile } from './altus-managed-prompt-service';
import { sandboxSkillSyncService } from './sandbox-skill-sync-service';
import { taskSessionSkillStateService, type SkillSelectionInput } from './task-session-skill-state-service';
import { taskSessionRedisCacheService } from './task-session-redis-cache-service';
import { classifyTaskIntentShape } from './task-intent-shape-service';
import { userSkillService } from './user-skill-service';

type OpencodeEventListenerPayload = {
  taskSessionId: string;
  message: {
    type: 'opencode_event' | 'status_update' | 'agent_message' | 'error';
    content: string;
    metadata: Record<string, unknown>;
    stage?: 'collecting' | 'clarifying' | 'planning' | 'executing' | 'reviewing' | 'completed' | 'failed';
    phase?: 'ideation' | 'analysis' | 'development' | 'testing' | 'repair' | 'delivery';
    tone?: 'system' | 'intent' | 'planning' | 'execution' | 'review' | 'error';
  };
};

type OpencodeEventListener = (payload: OpencodeEventListenerPayload) => void | Promise<void>;

type RuntimeBinding = {
  generation?: number;
  orchestratorSessionId: string;
  opencodeSessionId?: string;
};

type OpencodeTextStreamEntry = {
  taskSessionId: string;
  orchestratorSessionId: string;
  opencodeSessionId: string;
  partId: string;
  text: string;
  updatedAt: number;
  truncated?: boolean;
};

type RunArtifact = {
  hasFileChange: boolean;
  hasFailure: boolean;
  failureMessage?: string;
  missingArtifactNudges: number;
  startedAt: number;
  promptedAt: number;
  completionInProgress: boolean;
  phaseAtStart?: FlowPhase;
  cycleAtStart?: number;
  hasPlaywrightUsage?: boolean;
  testDetectionAttempted?: boolean;
  toolEvents: number;
  commandEvents: number;
  diffEvents: number;
  todoEvents: number;
  fileEvents: number;
  textEvents: number;
  lastText?: string;
  assistantResponseObserved: boolean;
  nativeHistoryPollAttempts: number;
  stableNativeHistoryPolls: number;
  lastNativeAssistantSignature?: string;
  toolsUsed: Set<string>;
};

type QueuedDbMessage = {
  walId: string;
  message: {
    id: string;
    sessionId: string;
    role: NewConversationMessage['role'];
    content: string;
    messageType: string;
    metadata?: Record<string, unknown>;
  };
};

type ClientPromptDispatchRecord = {
  orchestratorSessionId: string;
  opencodeSessionId: string;
  content: string;
  dispatchedAt: number;
};

type OpencodeMessageRoleEntry = {
  role: string;
  updatedAt: number;
};

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function buildNeutralTaskIntentProfile(): AltusManagedTaskIntentProfile {
  return {
    mode: 'neutral',
    reason: 'unknown',
    recentUserMessages: [],
    explicitNoDeploy: false,
    explicitNoWeb: false,
    webArtifactRequested: false,
    deployRequested: false,
    scriptArtifactRequested: false,
    emailTemplateRequested: false,
    deploymentAllowed: true,
    needsClarification: false,
    clarificationQuestion: '',
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableDirectInputError(error: unknown): boolean {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return (
    normalized.includes('fetch failed') ||
    normalized.includes('network') ||
    normalized.includes('socket hang up') ||
    normalized.includes('other side closed') ||
    normalized.includes('econnreset') ||
    normalized.includes('econnrefused') ||
    normalized.includes('etimedout') ||
    normalized.includes('eai_again') ||
    normalized.includes('und_err_socket') ||
    normalized.includes('aborted') ||
    normalized.includes('timeout') ||
    normalized.includes('opencode serve 启动失败') ||
    normalized.includes('opencode 服务未就绪') ||
    normalized.includes('opencode server not ready')
  );
}

function isRecoverableEventSubscribeError(payload: Record<string, unknown>, rawMessage: string): boolean {
  const code = asString(payload.code).toLowerCase();
  const stage = asString(payload.stage).toLowerCase();
  const normalized = rawMessage.trim().toLowerCase();
  if (code !== 'event_stream_error' || stage !== 'event_subscribe') {
    return false;
  }
  return (
    normalized === 'terminated' ||
    normalized.includes('sandbox port is not open') ||
    normalized.includes('fetch failed') ||
    normalized.includes('other side closed') ||
    normalized.includes('econnreset') ||
    normalized.includes('econnrefused') ||
    normalized.includes('etimedout')
  );
}

function isBenignOpencodeTerminationMessage(value: unknown): boolean {
  const normalized = asString(value).toLowerCase();
  if (!normalized) return false;
  return (
    normalized === 'terminated' ||
    normalized === 'other side closed' ||
    normalized === 'fetch failed' ||
    normalized === 'connection closed' ||
    normalized === 'stream closed'
  );
}

function toPositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
}

function toNonNegativeInt(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return Math.floor(parsed);
}

function asScalar(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return '';
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return undefined;
    const numeric = Number(text);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
    const parsed = Date.parse(text);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function resolveNativeMessageTimestamp(record: Record<string, unknown>): number {
  const info = toRecord(record.info);
  const time = toRecord(record.time);
  const infoTime = toRecord(info.time);
  return (
    asNumber(time.created) ||
    asNumber(time.updated) ||
    asNumber(infoTime.created) ||
    asNumber(infoTime.updated) ||
    asNumber(record.createdAt) ||
    asNumber(record.updatedAt) ||
    asNumber(record.timestamp) ||
    Date.now()
  );
}

function resolveNativeMessageRole(record: Record<string, unknown>): string {
  const info = toRecord(record.info);
  return (asString(record.role) || asString(info.role)).toLowerCase();
}

export function inspectLatestAssistantTurn(
  rawMessages: unknown[],
  promptedAt: number
): {
  assistantObserved: boolean;
  hasActiveAssistantParts: boolean;
  latestAssistantSignature: string;
  latestAssistantText: string;
} {
  const records = rawMessages
    .filter((item) => item && typeof item === 'object')
    .map((item) => item as Record<string, unknown>)
    .sort((left, right) => resolveNativeMessageTimestamp(left) - resolveNativeMessageTimestamp(right));

  const isMeaningfulAssistantRecord = (record: Record<string, unknown>) => {
    const info = toRecord(record.info);
    const parts = Array.isArray(record.parts) ? record.parts : [];
    const content = asString(record.content);
    const summary = asString(info.summary);

    if (parts.length > 0) {
      const meaningfulPart = parts.some((rawPart) => {
        const part = toRecord(rawPart);
        const partType = asString(part.type).toLowerCase();
        if (!partType) return false;
        if (partType === 'step-start' || partType === 'step-finish') {
          return false;
        }
        return true;
      });
      if (meaningfulPart) return true;
    }
    if (content) return true;
    if (summary) return true;
    return false;
  };

  let latestAssistant: Record<string, unknown> | null = null;
  for (const record of records) {
    if (resolveNativeMessageRole(record) !== 'assistant') {
      continue;
    }
    const createdAt = resolveNativeMessageTimestamp(record);
    if (promptedAt > 0 && Number.isFinite(createdAt) && createdAt + 1000 < promptedAt) {
      continue;
    }
    if (!isMeaningfulAssistantRecord(record)) {
      continue;
    }
    latestAssistant = record;
  }

  if (!latestAssistant) {
    return {
      assistantObserved: false,
      hasActiveAssistantParts: false,
      latestAssistantSignature: '',
      latestAssistantText: '',
    };
  }

  const info = toRecord(latestAssistant.info);
  const messageTime = toRecord(latestAssistant.time);
  const infoTime = toRecord(info.time);
  const parts = Array.isArray(latestAssistant.parts) ? latestAssistant.parts : [];
  const messageCompletedAt = asNumber(messageTime.completed) || asNumber(infoTime.completed) || 0;
  const messageId = asString(latestAssistant.id) || asString(info.id) || 'assistant';

  let assistantObserved = false;
  let hasActiveAssistantParts = false;
  let latestAssistantText = '';
  const partSignatures: string[] = [];
  let pendingStepCount = 0;

  for (const rawPart of parts) {
    const part = toRecord(rawPart);
    const partType = asString(part.type).toLowerCase();
    const partId = asString(part.id) || asString(part.callID) || '';

    if (partType === 'text' || partType === 'reasoning') {
      const text = asString(part.text) || asString(part.content);
      const time = toRecord(part.time);
      const start = asNumber(time.start) || 0;
      const end = asNumber(time.end) || 0;
      if (text) {
        assistantObserved = true;
        latestAssistantText = text;
      }
      if (start > 0 && end <= 0) {
        hasActiveAssistantParts = true;
      }
      partSignatures.push(`${partType}:${partId}:${text.length}:${start}:${end}`);
      continue;
    }

    if (partType === 'tool') {
      const toolName = asString(part.tool) || asString(part.name) || 'tool';
      const state = toRecord(part.state);
      const stateTime = toRecord(state.time);
      const status = (asString(state.status) || asString(state.state) || asString(part.status)).toLowerCase();
      assistantObserved = true;
      if (status !== 'completed' && status !== 'error') {
        hasActiveAssistantParts = true;
      }
      partSignatures.push(
        `tool:${partId}:${toolName}:${status}:${asNumber(stateTime.start) || 0}:${asNumber(stateTime.end) || 0}`
      );
      continue;
    }

    if (partType === 'step-start') {
      pendingStepCount += 1;
      partSignatures.push(`step-start:${partId}`);
      continue;
    }

    if (partType === 'step-finish') {
      pendingStepCount = Math.max(0, pendingStepCount - 1);
      partSignatures.push(`step-finish:${partId}:${asString(part.reason)}`);
      continue;
    }

    if (partType) {
      partSignatures.push(`${partType}:${partId}`);
    }
  }

  if (!latestAssistantText) {
    const content = asString(latestAssistant.content);
    if (content) {
      assistantObserved = true;
      latestAssistantText = content;
    }
  }

  if (pendingStepCount > 0) {
    hasActiveAssistantParts = true;
  }

  return {
    assistantObserved,
    hasActiveAssistantParts,
    latestAssistantText,
    latestAssistantSignature: JSON.stringify({
      id: messageId,
      completedAt: messageCompletedAt,
      active: hasActiveAssistantParts,
      parts: partSignatures,
      textLength: latestAssistantText.length,
    }),
  };
}

function parseStructString(value: string): Record<string, unknown> {
  const text = value.trim();
  if (!text.startsWith('@{') || !text.endsWith('}')) {
    return {};
  }
  const body = text.slice(2, -1);
  const result: Record<string, unknown> = {};
  for (const rawPart of body.split(';')) {
    const part = rawPart.trim();
    if (!part) continue;
    const eqIndex = part.indexOf('=');
    if (eqIndex <= 0) {
      result[part] = true;
      continue;
    }
    const key = part.slice(0, eqIndex).trim();
    const val = part.slice(eqIndex + 1).trim();
    if (!key) continue;
    result[key] = val;
  }
  return result;
}

function shouldInvalidateWorkspaceCache(eventType: string, toolName: string): boolean {
  if (
    eventType === 'file.edited' ||
    eventType === 'file.watcher.updated' ||
    eventType === 'session.diff' ||
    eventType === 'command.executed'
  ) {
    return true;
  }
  return toolName === 'apply_patch';
}

function isEmptyDiff(value: unknown): boolean {
  return Array.isArray(value) && value.length === 0;
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    const parsed = parseStructString(value);
    if (Object.keys(parsed).length > 0) {
      return parsed;
    }
  }
  return {};
}

function normalizeDirectory(value: unknown): string {
  if (typeof value !== 'string') return '';
  let text = value.trim();
  if (!text) return '';
  if (text.startsWith('file://')) {
    try {
      text = new URL(text).pathname || text;
    } catch {
      // ignore parse errors
    }
  }
  return text.replace(/\\/g, '/').replace(/\/+$/, '');
}

function normalizePath(value: unknown): string {
  if (typeof value !== 'string') return '';
  let text = value.trim();
  if (!text) return '';
  if (text.startsWith('file://')) {
    try {
      text = new URL(text).pathname || text;
    } catch {
      // ignore
    }
  }
  return text.replace(/\\/g, '/').replace(/\/+/g, '/');
}

type OpencodeFileNode = {
  path: string;
  type: 'file' | 'directory';
  ignored?: boolean;
};

async function listWorkspaceFiles(
  orchestratorSessionId: string,
  workspaceRoot: string,
  options?: { maxDepth?: number; maxEntries?: number }
): Promise<string[]> {
  const maxDepth = options?.maxDepth ?? 4;
  const maxEntries = options?.maxEntries ?? 2000;
  const ignoredRoots = new Set([
    '.git',
    'node_modules',
    '.opencode',
    '.cache',
    '.pnpm-store',
    '.vscode',
    '.idea',
  ]);
  const queue: Array<{ path: string; depth: number }> = [{ path: '', depth: 0 }];
  const seenDirs = new Set<string>();
  const files = new Set<string>();
  let visited = 0;

  while (queue.length > 0 && visited < maxEntries) {
    const current = queue.shift()!;
    const nodes = await listOpencodeDirectory(orchestratorSessionId, workspaceRoot, current.path);
    for (const node of nodes) {
      if (node.ignored) continue;
      const normalized = normalizeWorkspacePath(node.path || '');
      if (!normalized) continue;
      const rootName = normalized.split('/')[0];
      if (rootName && ignoredRoots.has(rootName)) continue;
      const type = node.type === 'directory' ? 'dir' : 'file';
      if (type === 'file') {
        files.add(normalized);
      }
      if (type === 'dir' && current.depth < maxDepth && !seenDirs.has(normalized)) {
        seenDirs.add(normalized);
        queue.push({ path: normalized, depth: current.depth + 1 });
      }
      visited += 1;
      if (visited >= maxEntries) break;
    }
  }

  return Array.from(files);
}

async function fetchOpencodeJsonViaOsac<T>(
  orchestratorSessionId: string,
  workspaceRoot: string,
  path: string,
  query: Record<string, string>
): Promise<T> {
  const response = await osacAgentService.opencodeHttpRequest(orchestratorSessionId, {
    method: 'GET',
    path,
    query: {
      ...query,
      directory: workspaceRoot,
    },
    workspacePath: workspaceRoot,
  });

  const status = Number(response.status || 0);
  const body = typeof response.body === 'string' ? response.body : '';
  if (!Number.isFinite(status) || status <= 0) {
    throw new Error('opencode response invalid');
  }
  if (status < 200 || status >= 300) {
    throw new Error(`opencode request failed: ${status} ${body || 'unknown error'}`);
  }
  if (!body) {
    throw new Error('opencode response empty');
  }
  try {
    return JSON.parse(body) as T;
  } catch (error: any) {
    throw new Error(`opencode response parse error: ${error?.message || error}`);
  }
}

async function listOpencodeDirectory(
  orchestratorSessionId: string,
  workspaceRoot: string,
  dir: string
): Promise<OpencodeFileNode[]> {
  const data = await fetchOpencodeJsonViaOsac<OpencodeFileNode[]>(
    orchestratorSessionId,
    workspaceRoot,
    '/file',
    {
      path: dir,
    }
  );
  if (!Array.isArray(data)) {
    throw new Error('opencode file list invalid');
  }
  return data;
}

function normalizeWorkspacePath(input: string): string {
  return input.replace(/\\/g, '/').replace(/^\/+/, '');
}

async function hasWorkspaceArtifacts(
  orchestratorSessionId: string,
  workspaceRoot: string,
  options?: { maxDepth?: number; maxEntries?: number }
): Promise<boolean> {
  const maxDepth = options?.maxDepth ?? 4;
  const maxEntries = options?.maxEntries ?? 2000;
  const ignoredRoots = new Set([
    '.git',
    'node_modules',
    '.opencode',
    '.cache',
    '.pnpm-store',
    '.vscode',
    '.idea',
  ]);
  const queue: Array<{ path: string; depth: number }> = [{ path: '', depth: 0 }];
  const seenDirs = new Set<string>();
  let visited = 0;

  while (queue.length > 0 && visited < maxEntries) {
    const current = queue.shift()!;
    const nodes = await listOpencodeDirectory(orchestratorSessionId, workspaceRoot, current.path);
    for (const node of nodes) {
      if (node.ignored) continue;
      const normalized = normalizeWorkspacePath(node.path || '');
      if (!normalized) continue;
      const rootName = normalized.split('/')[0];
      if (rootName && ignoredRoots.has(rootName)) continue;
      const type = node.type === 'directory' ? 'dir' : 'file';
      if (type === 'file') {
        return true;
      }
      if (type === 'dir' && current.depth < maxDepth && !seenDirs.has(normalized)) {
        seenDirs.add(normalized);
        queue.push({ path: normalized, depth: current.depth + 1 });
      }
      visited += 1;
      if (visited >= maxEntries) break;
    }
  }
  return false;
}

function isWorkspaceFilePath(path: string, workspaceRoot: string): boolean {
  const normalized = normalizePath(path);
  if (!normalized) return false;
  const lower = normalized.toLowerCase();
  if (lower.includes('/.git/') || lower.startsWith('.git/') || lower.endsWith('/.git')) {
    return false;
  }
  if (lower.includes('/node_modules/') || lower.startsWith('node_modules/')) {
    return false;
  }
  const root = normalizeDirectory(workspaceRoot);
  if (root) {
    if (normalized.startsWith(root + '/')) return true;
    if (!normalized.startsWith('/') && !/^[a-z]:/i.test(normalized)) return true;
    return false;
  }
  return !normalized.startsWith('/') && !/^[a-z]:/i.test(normalized);
}

function extractDiffPaths(diff: unknown): string[] {
  const paths: string[] = [];
  const addPath = (value: unknown) => {
    const text = normalizePath(value);
    if (text) paths.push(text);
  };
  const parseDiffText = (text: string) => {
    const lines = text.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      let match = /^diff --git a\/(.+?) b\/(.+)$/.exec(trimmed);
      if (match) {
        addPath(match[1]);
        addPath(match[2]);
        continue;
      }
      match = /^\+\+\+ b\/(.+)$/.exec(trimmed);
      if (match) {
        addPath(match[1]);
        continue;
      }
      match = /^--- a\/(.+)$/.exec(trimmed);
      if (match) {
        addPath(match[1]);
      }
    }
  };

  if (Array.isArray(diff)) {
    for (const item of diff) {
      if (!item) continue;
      if (typeof item === 'string') {
        parseDiffText(item);
        continue;
      }
      if (typeof item === 'object') {
        const record = item as Record<string, unknown>;
        addPath(record.path);
        addPath(record.file);
        addPath(record.filename);
        if (typeof record.diff === 'string') {
          parseDiffText(record.diff);
        }
      }
    }
  } else if (typeof diff === 'string') {
    parseDiffText(diff);
  }

  return Array.from(new Set(paths));
}

function diffHasWorkspaceChange(diff: unknown, workspaceRoot: string): boolean {
  const paths = extractDiffPaths(diff);
  if (paths.length === 0) return false;
  return paths.some((path) => isWorkspaceFilePath(path, workspaceRoot));
}

function resolveArtifactKind(value: unknown): string {
  const kind = asString(value).toLowerCase();
  return kind || 'software_artifact';
}

export function isMeaningfulArtifactFile(filePath: string, artifactKind: string): boolean {
  const normalized = normalizePath(filePath).toLowerCase();
  if (!normalized || normalized.startsWith('.git/')) {
    return false;
  }

  const basename = normalized.split('/').pop() || normalized;
  const ext = path.posix.extname(normalized);
  const kind = resolveArtifactKind(artifactKind);

  const scriptOutputs = new Set([
    '.py',
    '.sh',
    '.bash',
    '.zsh',
    '.js',
    '.mjs',
    '.cjs',
    '.ts',
    '.rb',
    '.go',
    '.rs',
    '.java',
    '.php',
    '.pl',
    '.r',
    '.md',
    '.txt',
    '.html',
  ]);
  const webOutputs = new Set([
    '.html',
    '.css',
    '.js',
    '.mjs',
    '.cjs',
    '.ts',
    '.tsx',
    '.jsx',
    '.vue',
    '.svelte',
  ]);
  const softwareOutputs = new Set([
    ...scriptOutputs,
    '.tsx',
    '.jsx',
    '.json',
    '.yaml',
    '.yml',
    '.toml',
    '.sql',
  ]);
  const ignoredDataOnly = new Set([
    '.csv',
    '.tsv',
    '.xls',
    '.xlsx',
    '.jsonl',
    '.parquet',
    '.db',
    '.sqlite',
  ]);

  if (kind === 'script_artifact') {
    if (ignoredDataOnly.has(ext)) return false;
    return scriptOutputs.has(ext) || basename === 'readme' || basename === 'readme.md';
  }

  if (kind === 'web_app') {
    return webOutputs.has(ext);
  }

  if (kind === 'business_system' || kind === 'software_artifact') {
    if (ignoredDataOnly.has(ext)) return false;
    return softwareOutputs.has(ext) || basename === 'package.json' || basename === 'readme.md';
  }

  if (ignoredDataOnly.has(ext)) return false;
  return Boolean(ext);
}

function extractFilePathsFromEvent(properties: Record<string, unknown>, event?: Record<string, unknown>): string[] {
  const paths: string[] = [];
  const add = (value: unknown) => {
    const text = normalizePath(value);
    if (text) paths.push(text);
  };
  add(properties.file);
  add(properties.path);
  add((properties as any).relativePath);
  add((properties as any).filename);
  add(event?.path);
  add((event as any)?.file);
  return Array.from(new Set(paths));
}

function resolveWorkspaceRoot(): string {
  return (process.env.OPENCODE_TASK_WORKSPACE_ROOT || '/opt/.altus/opencode/workspaces')
    .trim()
    .replace(/[\\/]+$/, '');
}

async function resolveRuntimeFromEnvironment(
  orchestratorSessionId: string
): Promise<{ ready: boolean; status?: string | null }> {
  try {
    const environment = await sandboxExecutionEnvironmentDAO.getBySessionId(orchestratorSessionId);
    if (!environment) {
      return { ready: false, status: null };
    }
    return {
      ready: environment.status === 'ready',
      status: environment.status,
    };
  } catch {
    return { ready: false, status: null };
  }
}

function extractTaskSessionIdFromDirectory(directory: string): string | null {
  const normalized = normalizeDirectory(directory);
  if (!normalized) return null;
  const root = normalizeDirectory(resolveWorkspaceRoot());
  if (!root) return null;
  if (normalized === root) return null;
  if (!normalized.startsWith(root + '/')) return null;
  const rest = normalized.slice(root.length + 1);
  const segment = rest.split('/')[0];
  return segment ? segment.trim() : null;
}

function extractDirectoryFromPayload(payload: Record<string, unknown>, event?: Record<string, unknown>): string {
  const direct =
    normalizeDirectory(payload.directory) ||
    normalizeDirectory((payload as any).worktree) ||
    normalizeDirectory((payload as any).workspacePath);
  if (direct) return direct;

  const eventDir =
    (event && (normalizeDirectory(event.directory) || normalizeDirectory((event as any).workspacePath))) || '';
  if (eventDir) return eventDir;

  const props = normalizeRecord(event?.properties);
  return normalizeDirectory(props.directory) || normalizeDirectory((props as any).workspacePath) || '';
}

function extractPartType(event: Record<string, unknown>): string {
  const properties = normalizeRecord(event.properties);
  const part = normalizeRecord(properties.part);
  return (asString(part.type) || asString(properties.type)).toLowerCase();
}

function compact(value: string, maxLen: number = 200): string {
  const text = value.trim().replace(/\s+/g, ' ');
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}...`;
}

function truncateText(value: unknown, maxLen: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen)}...`;
}

function truncateValue(value: unknown, maxLen: number): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (value.length <= maxLen) return value;
    return `${value.slice(0, maxLen)}...`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  try {
    const text = JSON.stringify(value);
    if (text.length <= maxLen) return value;
    return `${text.slice(0, maxLen)}...`;
  } catch {
    return '[unserializable]';
  }
}

function buildDiffPreview(diff: unknown, maxLen: number = 8000) {
  if (!diff) return undefined;
  if (typeof diff === 'string') {
    return truncateText(diff, maxLen) || diff;
  }
  if (Array.isArray(diff)) {
    const maxItems = 20;
    const items = diff.slice(0, maxItems).map((item) => {
      if (!item || typeof item !== 'object') return item;
      const record = item as Record<string, unknown>;
      const preview: Record<string, unknown> = {};
      if (record.file) preview.file = record.file;
      if (record.path) preview.path = record.path;
      if (record.status) preview.status = record.status;
      if (record.additions !== undefined) preview.additions = record.additions;
      if (record.deletions !== undefined) preview.deletions = record.deletions;
      if (record.diff) preview.diff = truncateText(String(record.diff), maxLen);
      if (record.before) preview.before = truncateText(String(record.before), maxLen);
      if (record.after) preview.after = truncateText(String(record.after), maxLen);
      return preview;
    });
    return diff.length > maxItems ? [...items, { truncated: true, total: diff.length }] : items;
  }
  try {
    const text = JSON.stringify(diff);
    return text.length > maxLen ? `${text.slice(0, maxLen)}...` : diff;
  } catch {
    return '[unserializable diff]';
  }
}

function buildEventPreview(event: Record<string, unknown>): Record<string, unknown> {
  const properties = normalizeRecord(event.properties);
  const previewProps: Record<string, unknown> = {};

  const part = normalizeRecord(properties.part);
  const partType = asString(part.type) || asString(properties.type);
  if (partType) {
    const partPreview: Record<string, unknown> = { type: partType };
    const partId = asString(part.id) || asString(part.callID) || asString(properties.partId);
    if (partId) partPreview.id = partId;
    const toolName = asString(part.tool) || asString(part.name) || asString(properties.tool);
    if (toolName) partPreview.tool = toolName;
    const state = asString(part.state) || asString(part.status);
    if (state) partPreview.status = state;
    const summary = compact(asString(part.summary) || asString(properties.summary), 160);
    if (summary) partPreview.summary = summary;
    // 保留工具输入/输出摘要，便于刷新后还原 Shell/工具细节。
    const partState = normalizeRecord(part.state);
    if (toolName && Object.keys(partState).length > 0) {
      const input = truncateValue(partState.input, 1200);
      const output = truncateValue(partState.output, 1200);
      const error = truncateValue(partState.error, 800);
      const status = truncateValue(partState.status, 200);
      partPreview.state = {
        ...(input !== undefined ? { input } : {}),
        ...(output !== undefined ? { output } : {}),
        ...(error !== undefined ? { error } : {}),
        ...(status !== undefined ? { status } : {}),
      };
    }
    const partInput = truncateValue(part.input ?? (properties as any).input, 1200);
    if (partInput !== undefined) {
      partPreview.input = partInput;
    }
    previewProps.part = partPreview;
  }

  const path = asString(properties.path) || asString((properties as any).file) || asString((properties as any).filename);
  if (path) previewProps.path = path;
  const command = asString(properties.command) || asString(properties.name);
  if (command) previewProps.command = compact(command, 200);
  const cwd = asString(properties.cwd);
  if (cwd) previewProps.cwd = cwd;
  if (properties.exitCode !== undefined) previewProps.exitCode = properties.exitCode;
  const state = asString(properties.state) || asString(properties.status);
  if (state) previewProps.state = state;

  const diffPreview = buildDiffPreview((properties as any).diff);
  if (diffPreview) previewProps.diff = diffPreview;

  return {
    type: asString(event.type) || undefined,
    properties: previewProps,
    directory: asString((event as any).directory) || undefined,
  };
}

function buildRawPayloadPreview(eventType: string, eventPreview: Record<string, unknown>) {
  return {
    eventType,
    event: eventPreview,
  };
}

function isSandboxNotFoundError(error: unknown): boolean {
  if (!error) return false;
  const texts: string[] = [];
  const pushText = (value: unknown) => {
    if (!value) return;
    const text = String(value);
    if (text) texts.push(text);
  };
  if (error instanceof Error) {
    pushText(error.message);
    pushText(error.name);
    pushText((error as any).cause);
  }
  pushText(error);
  const serialized = (() => {
    try {
      return JSON.stringify(error);
    } catch {
      return '';
    }
  })();
  pushText(serialized);
  const normalized = texts.join(' | ').toLowerCase();
  if (!normalized) return false;
  if (normalized.includes('sandbox was not found') || normalized.includes('sandbox not found')) {
    return true;
  }
  if (normalized.includes('paused sandbox') && normalized.includes('not found')) {
    return true;
  }
  if (normalized.includes('the sandbox was not found')) {
    return true;
  }
  if (error instanceof Error && error.name === 'NotFoundError') {
    return true;
  }
  return false;
}

async function markSandboxClosed(orchestratorSessionId: string) {
  try {
    const environment = await sandboxExecutionEnvironmentDAO.getBySessionId(orchestratorSessionId);
    if (!environment) return;
    if (environment.status === 'closed') return;
    await sandboxExecutionEnvironmentDAO.updateStatus(
      orchestratorSessionId,
      'closed',
      environment.vmName ?? null
    );
  } catch (error) {
    console.warn('[OPENCODE_MARK_CLOSED_FAILED]', orchestratorSessionId, error);
  }
}

function buildTaskDescription(record: any): TaskDescription {
  return {
    title: record?.title || '',
    objective: record?.objective || '',
    scope: record?.scope || '',
    deliverables: Array.isArray(record?.deliverables) ? record.deliverables : [],
    constraints: record?.constraints || [],
    additional_info: record?.additionalInfo || record?.additional_info,
  };
}

function buildExecutionPlan(record: any): ExecutionPlan {
  return {
    project: {
      title: record?.projectTitle || '',
      description: record?.projectDescription || '',
      estimated_total_hours: record?.estimatedTotalHours ?? undefined,
      managers: Array.isArray(record?.managers) ? record.managers : [],
    },
  };
}

function buildExecutionSummary(executionPlan: ExecutionPlan): Record<string, unknown> {
  const project = executionPlan.project || ({} as any);
  return {
    title: project.title,
    description: project.description,
    total_estimated_hours: (project as any).total_estimated_hours ?? project.estimated_total_hours,
    managers: Array.isArray(project.managers)
      ? project.managers.map((manager: any) => ({
          id: manager.id,
          name: manager.name,
          task_count: Array.isArray(manager.tasks) ? manager.tasks.length : 0,
        }))
      : [],
  };
}

type FlowPhase = 'ideation' | 'analysis' | 'development' | 'testing' | 'repair' | 'delivery';

const PHASE_LABEL: Record<FlowPhase, string> = {
  ideation: '构思阶段',
  analysis: '分析阶段',
  development: '开发阶段',
  testing: '测试阶段',
  repair: '修复阶段',
  delivery: '交付阶段',
};

function formatPhaseStatus(phase: FlowPhase, message: string): string {
  const prefix = PHASE_LABEL[phase] || '阶段';
  const suffix = message?.trim() || '';
  return suffix ? `${prefix}：${suffix}` : prefix;
}

type ValidationMode = 'browser' | 'generic';

function resolveValidationMode(payload: {
  userInput: string;
  taskDescription: TaskDescription;
  executionPlan: ExecutionPlan;
}): ValidationMode {
  const shape = classifyTaskIntentShape([
    payload.userInput,
    payload.taskDescription.title,
    payload.taskDescription.objective,
    payload.taskDescription.scope,
    ...(Array.isArray(payload.taskDescription.deliverables) ? payload.taskDescription.deliverables : []),
    ...(Array.isArray(payload.taskDescription.constraints) ? payload.taskDescription.constraints : []),
    String(payload.taskDescription.additional_info?.artifactKind || ''),
    payload.executionPlan.project?.title || '',
    payload.executionPlan.project?.description || '',
  ]);
  return shape.artifactKind === 'web_app' && !shape.explicitNoWeb ? 'browser' : 'generic';
}

function buildNoArtifactFollowUp(validationMode: ValidationMode): string {
  return validationMode === 'browser'
    ? [
        '当前未检测到任何文件产出，请继续完成交付物。',
        '请直接在当前工作区生成实际网站文件，并保证能够被浏览器验证。',
        '完成后再执行 Playwright 测试（连接 CDP 9222，同一浏览器窗口）。',
      ].join('\n')
    : [
        '当前未检测到任何文件产出，请继续完成交付物。',
        '请直接在当前工作区生成与任务匹配的脚本或源码文件，不要改造成网页应用。',
        '完成后按任务类型执行本地验证，并在结果中说明命令、输出和文件路径。',
      ].join('\n');
}

function buildReviewFeedbackPrompt(payload: {
  userInput: string;
  taskDescription: TaskDescription;
  executionPlan: ExecutionPlan;
  lastOutput: string;
  feedback: string;
  runSummary?: string;
  validationMode?: ValidationMode;
}): string {
  if ((payload.validationMode || 'browser') === 'generic') {
    return [
      '当前处于【修复阶段】',
      '你是执行智能体，请基于上一轮执行结果进行修订与完善：',
      `用户需求: ${payload.userInput}`,
      `任务描述: ${JSON.stringify(payload.taskDescription)}`,
      `执行计划摘要: ${JSON.stringify(buildExecutionSummary(payload.executionPlan))}`,
      `上一轮输出: ${payload.lastOutput}`,
      payload.runSummary ? `上一轮执行摘要: ${payload.runSummary}` : '',
      `改进要求: ${payload.feedback}`,
      '要求：',
      '1) 继续命令行模式执行（不要进入交互式界面）。',
      '2) 补齐缺口并输出更新后的交付物说明。',
      '3) 如需生成/修改文件，请直接写入当前工作区并在输出中说明文件路径。',
      '4) 继续按任务类型做本地验证：脚本/CLI 跑通命令与样例输入，源码类任务核对文件结构、入口和使用说明。',
      '5) 不要引入 Playwright、浏览器自动化或部署步骤，除非任务本身明确要求网页验证。',
      '6) 输出本轮验证步骤、结果与剩余风险。',
    ]
      .filter(Boolean)
      .join('\n');
  }

  return [
    '当前处于【修复阶段】',
    '你是执行智能体，请基于上一轮执行结果进行修订与完善：',
    `用户需求: ${payload.userInput}`,
    `任务描述: ${JSON.stringify(payload.taskDescription)}`,
    `执行计划摘要: ${JSON.stringify(buildExecutionSummary(payload.executionPlan))}`,
    `上一轮输出: ${payload.lastOutput}`,
    payload.runSummary ? `上一轮执行摘要: ${payload.runSummary}` : '',
    `改进要求: ${payload.feedback}`,
    '要求：',
    '1) 继续命令行模式执行（不要进入交互式界面）。',
    '2) 补齐缺口并输出更新后的交付物说明。',
    '3) 如需生成/修改文件，请直接写入当前工作区并在输出中说明文件路径。',
    '4) 必须使用 playwright-mcp 进行浏览器自动化验证（headless=false），输出测试步骤与结果。',
    '5) playwright-mcp 已预置，无需安装任何 Playwright 依赖，也不要修改 package.json 或执行 npm/pnpm 安装。',
  ].join('\n');
}

function buildPlaywrightTestPrompt(payload: {
  userInput: string;
  taskDescription: TaskDescription;
  executionPlan: ExecutionPlan;
  lastOutput?: string;
  runSummary?: string;
}): string {
  return [
    '当前处于【测试阶段】',
    '你是执行智能体，需要对当前实现进行浏览器自动化测试。',
    `用户需求: ${payload.userInput}`,
    `任务描述: ${JSON.stringify(payload.taskDescription)}`,
    `执行计划摘要: ${JSON.stringify(buildExecutionSummary(payload.executionPlan))}`,
    payload.lastOutput ? `当前交付物摘要: ${payload.lastOutput}` : '',
    payload.runSummary ? `上一轮执行摘要: ${payload.runSummary}` : '',
    '要求：',
    '1) 必须使用 playwright-mcp 执行浏览器自动化测试。',
    '1.1) playwright-mcp 已预置，无需安装任何 Playwright 依赖，也不要修改 package.json 或执行 npm/pnpm 安装。',
    '2) 必须连接到与 n.eko 同一实例的 Chromium（使用 CDP 9222 端口，例如 http://127.0.0.1:9222），不要启动新的独立浏览器实例。',
    '3) 连接后复用现有浏览器上下文与首个页面（contexts[0] 与 pages[0]）；如果没有页面，只能在该上下文中创建一个新页面，确保同一个窗口可被 n.eko 捕获。',
    '4) 测试请以可视模式运行（headless=false），确保调试画面可在 n.eko 中查看。',
    '5) 为保证用户可观察，请在关键步骤后显式等待（例如 page.waitForTimeout(1000)），最后在结果页停留至少 5 秒再结束。',
    '6) 如果需要启动服务，请使用可访问端口并说明访问地址。',
    '7) 输出测试步骤、覆盖的关键路径，以及每项测试结果（通过/失败）。',
    '8) 如发现问题，请总结失败原因，等待下一步修复指令，不要直接进入修复。',
    '9) 如需用户协助（例如账号、权限、业务确认），请明确提出。',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildGenericTestPrompt(payload: {
  userInput: string;
  taskDescription: TaskDescription;
  executionPlan: ExecutionPlan;
  lastOutput?: string;
  runSummary?: string;
}): string {
  return [
    '当前处于【测试阶段】',
    '你是执行智能体，需要对当前实现做与任务形态匹配的验证。',
    `用户需求: ${payload.userInput}`,
    `任务描述: ${JSON.stringify(payload.taskDescription)}`,
    `执行计划摘要: ${JSON.stringify(buildExecutionSummary(payload.executionPlan))}`,
    payload.lastOutput ? `当前交付物摘要: ${payload.lastOutput}` : '',
    payload.runSummary ? `上一轮执行摘要: ${payload.runSummary}` : '',
    '要求：',
    '1) 脚本/CLI 任务请直接运行命令或样例输入，验证输出与预期结构。',
    '2) 若验证依赖输入样例而用户未提供，请在工作区构造最小可验证样例，并明确说明这是用于本地验证的临时样例。',
    '3) 若脚本依赖环境中不存在的第三方包，请先改写为无需新增依赖的最小可运行版本，再继续验证。',
    '4) 源码类任务请核对文件结构、入口文件、关键说明和可执行步骤。',
    '5) 不要引入 Playwright、浏览器自动化或部署步骤，除非任务本身明确要求网页验证。',
    '6) 输出验证步骤、覆盖的关键路径，以及每项验证结果（通过/失败）。',
    '7) 如发现问题，请总结失败原因，等待下一步修复指令，不要直接进入修复。',
    '8) 如需用户协助（例如账号、权限、业务确认），请明确提出。',
  ]
    .filter(Boolean)
    .join('\n');
}

function pickSessionIdFromEvent(event: Record<string, unknown>): string | null {
  const direct = asString(event.sessionID) || asString(event.sessionId);
  if (direct) return direct;

  const stack: unknown[] = [event];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') continue;
    const record = current as Record<string, unknown>;
    const hit = asString(record.sessionID) || asString(record.sessionId);
    if (hit) return hit;
    for (const value of Object.values(record)) {
      if (value && typeof value === 'object') {
        stack.push(value);
      }
    }
  }
  return null;
}

function summarizeOpencodeEvent(eventType: string, payload: Record<string, unknown>): string {
  const event = toRecord(payload.event);
  const properties = normalizeRecord(event.properties);
  const errorMessage = extractOpencodeErrorMessage(payload);

  if (eventType === 'session.error' && errorMessage) {
    return `OpenCode 执行失败：${errorMessage}`;
  }

  if (eventType === 'message.updated') {
    const info = normalizeRecord(properties.info);
    const infoErrorMessage =
      errorMessage ||
      asString(toRecord(info.error).message) ||
      asString(toRecord(toRecord(info.error).data).message);
    if (infoErrorMessage) {
      return `OpenCode 执行失败：${infoErrorMessage}`;
    }
    const state = asString(info.state) || asString(info.status) || asString(properties.state) || asString(properties.status);
    const role = asString(info.role) || asString(properties.role);
    if (state || role) {
      return `[Message] ${[role, state].filter(Boolean).join(' · ')}`;
    }
  }

  if (eventType === 'message.part.delta') {
    const delta = asString(properties.delta);
    if (delta) return compact(delta, 320);
  }
  if (eventType === 'message.part.updated') {
    const part = normalizeRecord(properties.part);
    const partType = asString(part.type) || asString(properties.type);
    const partState = asString(part.state) || asString(part.status);

    if (partType === 'tool' || partType === 'tool-call' || partType === 'tool_call') {
      const toolName = asString(part.tool) || asString(part.name) || asString(toRecord(part.call).name) || 'tool';
      const summary = compact(asString(part.summary) || asString(properties.summary), 120);
      const suffix = summary || partState;
      return suffix ? `[Tool] ${toolName} · ${suffix}` : `[Tool] ${toolName}`;
    }
    if (partType === 'text') {
      const text = asString(part.text) || asString(part.content) || asString(properties.text);
      if (text) return compact(text, 320);
      return partState ? `[Text] ${partState}` : '[Text] updated';
    }
    if (partType === 'reasoning') {
      const text = asString(part.text) || asString(part.content) || asString(properties.text);
      if (text) return compact(text, 320);
      return partState ? `[Reasoning] ${partState}` : '[Reasoning] 思考中';
    }
    if (partType === 'step-start') {
      return '[Step] 开始执行';
    }
    if (partType === 'step-finish') {
      const reason = asString(part.reason) || asString(properties.reason);
      return reason ? `[Step] ${reason}` : '[Step] 完成';
    }
    if (partType === 'file') {
      const filePath = asString(part.path) || asString(properties.path);
      return filePath ? `[File] ${filePath}` : '[File] updated';
    }
  }
  if (eventType === 'command.executed') {
    const name = asString(properties.name) || asString(properties.command);
    const args = asString(properties.arguments);
    const output = compact(asString(properties.output) || asString(toRecord(properties.result).output), 140);
    const command = [name, args].filter(Boolean).join(' ');
    if (command && output) return `[Command] ${command} -> ${output}`;
    return command ? `[Command] ${command}` : '[Command] executed';
  }
  if (eventType === 'file.edited') {
    const path = asString(properties.file) || asString(properties.path);
    return path ? `[File] edited ${path}` : '[File] edited';
  }
  if (eventType.startsWith('pty.')) {
    const command = asString(properties.command);
    const cwd = asString(properties.cwd);
    const exitCode = asScalar(properties.exitCode);
    const suffix = [command, cwd ? `cwd=${cwd}` : '', exitCode ? `exit=${exitCode}` : '']
      .filter(Boolean)
      .join(' · ');
    return suffix ? `[PTY] ${suffix}` : `[PTY] ${eventType}`;
  }

  const fallbackText =
    asString(properties.text) ||
    asString(properties.message) ||
    asString((normalizeRecord(properties.part)).text);
  if (fallbackText) return fallbackText;
  return `[OpenCode] ${eventType}`;
}

function detectOpencodeOutcome(
  eventType: string,
  payload: Record<string, unknown>
): 'completed' | 'failed' | null {
  const lowerType = eventType.toLowerCase();
  if (lowerType === 'message.final' || lowerType === 'message.completed' || lowerType === 'message.done') {
    return 'completed';
  }

  const event = toRecord(payload.event);
  const properties = toRecord(event.properties);
  const info = toRecord(properties.info);
  const statusRecord = toRecord(properties.status);
  const infoStatusRecord = toRecord(info.status);
  const part = toRecord(properties.part);

  const pendingStates = new Set(['pending', 'waiting', 'awaiting', 'pending_confirmation', 'requires_input']);
  const partState = asString(part.state) || asString(part.status);
  const partStateLower = partState.toLowerCase();
  if (pendingStates.has(partStateLower)) {
    return null;
  }

  const pendingTools = toRecord(properties.pendingTools || properties.pending_tools || {});
  if (Object.keys(pendingTools).length > 0) {
    return null;
  }

  const activeTools = Array.isArray(properties.activeTools) ? properties.activeTools : [];
  if (activeTools.length > 0) {
    return null;
  }

  if (lowerType === 'session.idle') {
    const hasPendingParts = Boolean(properties.pendingParts) || Boolean(properties.pending_parts);
    if (hasPendingParts) {
      return null;
    }
    return 'completed';
  }

  const messageStates = [
    asString(part.state),
    asString(part.status),
    asString(properties.state),
    asString(properties.status),
    asString(info.state),
    asString(info.status),
  ]
    .map((value) => value.toLowerCase())
    .filter(Boolean);

  const failStates = new Set(['failed', 'error', 'cancelled', 'canceled', 'aborted', 'timeout']);
  const doneStates = new Set(['completed', 'done', 'finished', 'success', 'succeeded', 'idle']);

  if (lowerType.startsWith('message.')) {
    if (messageStates.some((state) => failStates.has(state))) {
      return 'failed';
    }
    if (messageStates.some((state) => doneStates.has(state))) {
      return 'completed';
    }
  }

  const isSessionScoped = lowerType.startsWith('session.');
  if (!isSessionScoped) {
    return null;
  }

  const states = [
    asString(event.state),
    asString(event.status),
    asString(properties.state),
    asString(properties.status),
    asString(statusRecord.type),
    asString(info.state),
    asString(info.status),
    asString(infoStatusRecord.type),
  ]
    .map((value) => value.toLowerCase())
    .filter(Boolean);

  if (states.some((state) => failStates.has(state))) {
    return 'failed';
  }
  if (states.some((state) => doneStates.has(state))) {
    return 'completed';
  }

  if (/(^|[._-])(failed|error|cancelled|canceled|aborted|timeout)([._-]|$)/.test(lowerType)) {
    return 'failed';
  }
  if (/(^|[._-])(completed|finished|done|succeeded|success|idle)([._-]|$)/.test(lowerType)) {
    return 'completed';
  }

  const finalSignals = [
    event.final,
    event.done,
    event.isFinal,
    properties.final,
    properties.done,
    properties.isFinal,
  ];
  if (finalSignals.some((value) => value === true)) {
    return 'completed';
  }

  return null;
}

function extractOpencodeErrorMessage(payload: Record<string, unknown>): string {
  const event = toRecord(payload.event);
  const properties = toRecord(event.properties);
  const errorRecord = toRecord(properties.error);
  const errorData = toRecord(errorRecord.data);
  return (
    asString(errorData.message) ||
    asString(errorRecord.message) ||
    asString(properties.message) ||
    asString(payload.message)
  );
}

async function resolveRuntimeBinding(
  taskSessionId: string,
  fallbackOrchestratorSessionId?: string
): Promise<RuntimeBinding | null> {
  const session = await taskCreationFileMemoryStore.getSession(taskSessionId);
  if (!session) return null;

  const runtime = session.runtime || {};
  const orchestratorFromRuntime = asString(runtime.orchestratorSessionId);
  const opencodeSessionId = asString(runtime.opencodeSessionId) || undefined;
  const generation =
    typeof runtime.generation === 'number' && Number.isFinite(runtime.generation) && runtime.generation > 0
      ? Math.floor(runtime.generation)
      : undefined;

  if (orchestratorFromRuntime) {
    return {
      generation,
      orchestratorSessionId: orchestratorFromRuntime,
      opencodeSessionId,
    };
  }

  const fallback = asString(fallbackOrchestratorSessionId);
  if (fallback) {
    return {
      generation,
      orchestratorSessionId: fallback,
      opencodeSessionId,
    };
  }

  return null;
}

export class OpencodeRemoteService {
  private initialized = false;
  private listeners = new Set<OpencodeEventListener>();
  private textStreams = new Map<string, OpencodeTextStreamEntry>();
  private finalizedRuns = new Set<string>();
  private messageRoles = new Map<string, OpencodeMessageRoleEntry>();
  private runArtifacts = new Map<string, RunArtifact>();
  private clientPromptDispatches = new Map<string, ClientPromptDispatchRecord>();
  private opencodeLocks = new Map<string, Promise<void>>();
  private workspaceGitInit = new Set<string>();
  private streamIdleTimers = new Map<string, NodeJS.Timeout>();
  private streamIdleAt = new Map<string, number>();
  private streamIdleTimeoutMs = toNonNegativeInt(process.env.OPENCODE_STREAM_IDLE_TIMEOUT_MS) ?? 20000;
  private streamMaxChars = toNonNegativeInt(process.env.OPENCODE_STREAM_MAX_CHARS) ?? 200000;
  private streamMaxEntries = toNonNegativeInt(process.env.OPENCODE_STREAM_MAX_ENTRIES) ?? 200;
  private streamBroadcastTimers = new Map<string, NodeJS.Timeout>();
  private streamBroadcastAt = new Map<string, number>();
  private streamBroadcastMeta = new Map<string, Record<string, unknown>>();
  private streamBroadcastIntervalMs = toNonNegativeInt(process.env.OPENCODE_STREAM_BROADCAST_INTERVAL_MS) ?? 250;
  private streamCheckpointTimers = new Map<string, NodeJS.Timeout>();
  private streamCheckpointAt = new Map<string, number>();
  private streamCheckpointSavedAt = new Map<string, number>();
  private streamCheckpointContent = new Map<string, string>();
  private streamCheckpointIntervalMs =
    toNonNegativeInt(process.env.OPENCODE_STREAM_CHECKPOINT_INTERVAL_MS) ?? 8000;
  private nativeHistoryPollTimers = new Map<string, NodeJS.Timeout>();
  private nativeHistoryPollInFlight = new Set<string>();
  private nativeHistoryPollDelayMs =
    toNonNegativeInt(process.env.OPENCODE_NATIVE_HISTORY_POLL_DELAY_MS) ?? 2500;
  private nativeHistoryPollMaxAttempts =
    toPositiveInt(process.env.OPENCODE_NATIVE_HISTORY_POLL_MAX_ATTEMPTS) ?? 12;
  private sessionArtifactsSeen = new Set<string>();
  private sessionArtifactRevision = new Map<string, number>();
  private sessionTestedRevision = new Map<string, number>();
  private sessionTestDispatchedRevision = new Map<string, number>();
  private sessionNoArtifactNudges = new Map<string, number>();
  private sessionTestDispatchedCycle = new Map<string, number>();
  private workspaceBaselines = new Map<string, Set<string>>();
  private messageQueue: QueuedDbMessage[] = [];
  private messageFlushTimer: NodeJS.Timeout | null = null;
  private messageFlushInProgress: Promise<void> = Promise.resolve();
  private messageWalWriteInProgress: Promise<void> = Promise.resolve();
  private messageWalRecovered = false;
  private messageFlushIntervalMs =
    toNonNegativeInt(process.env.TASK_CREATION_MESSAGE_FLUSH_INTERVAL_MS) ?? 2000;
  private messageFlushMaxBatch =
    toNonNegativeInt(process.env.TASK_CREATION_MESSAGE_FLUSH_MAX_BATCH) ?? 50;
  private messageFlushMaxQueue =
    toNonNegativeInt(process.env.TASK_CREATION_MESSAGE_FLUSH_MAX_QUEUE) ?? 300;
  private messageWalPath =
    asString(process.env.TASK_CREATION_MESSAGE_WAL_PATH) ||
    path.resolve(process.cwd(), 'data', 'task-creation-message-queue.wal.jsonl');

  private async prepareDirectResidentSkillSelections(input: {
    taskSessionId: string;
    content: string;
    source?: 'user' | 'agent';
    submittedSelections?: unknown;
    pendingQuestion?: unknown;
  }): Promise<{
    residentSkillSelections: SkillSelectionInput[];
  }> {
    const source = input.source === 'agent' ? 'agent' : 'user';
    const currentState = await taskSessionSkillStateService.getSessionSkillState(input.taskSessionId);
    if (source === 'agent') {
      return {
        residentSkillSelections: currentState.residentSelections,
      };
    }

    const session = await taskCreationSessionDAO.getSession(input.taskSessionId).catch(() => null);
    const userId = asString(session?.userId);
    if (!userId) {
      return {
        residentSkillSelections: currentState.residentSelections,
      };
    }

    const skillCatalog = await userSkillService.listAvailableSkills(userId).catch(() => []);
    const taskIntentProfile = await altusManagedSetupService
      .buildTaskIntentProfile(input.taskSessionId, input.content)
      .catch(() => buildNeutralTaskIntentProfile());
    const prepared = await taskSessionSkillStateService.prepareRunState({
      sessionId: input.taskSessionId,
      skillCatalog: skillCatalog as any,
      taskIntentProfile,
      submittedSelections: input.submittedSelections,
      messageType: input.pendingQuestion ? 'user_response' : 'user_input',
    });
    return {
      residentSkillSelections: prepared.residentSkillSelections,
    };
  }

  private buildRunKey(taskSessionId: string, opencodeSessionId: string): string {
    return `${taskSessionId}::${opencodeSessionId}`;
  }

  private buildClientPromptDispatchKey(taskSessionId: string, clientMessageKey: string): string {
    return `${taskSessionId}::${clientMessageKey}`;
  }

  private pruneClientPromptDispatches(now = Date.now()) {
    const ttlMs = 30 * 60 * 1000;
    for (const [key, entry] of this.clientPromptDispatches.entries()) {
      if (now - entry.dispatchedAt > ttlMs) {
        this.clientPromptDispatches.delete(key);
      }
    }
  }

  private rememberClientPromptDispatch(
    taskSessionId: string,
    clientMessageKey: string,
    dispatch: ClientPromptDispatchRecord
  ) {
    if (!taskSessionId || !clientMessageKey) {
      return;
    }
    this.pruneClientPromptDispatches(dispatch.dispatchedAt);
    this.clientPromptDispatches.set(
      this.buildClientPromptDispatchKey(taskSessionId, clientMessageKey),
      dispatch
    );
  }

  private getRememberedClientPromptDispatch(
    taskSessionId: string,
    clientMessageKey: string,
    content: string
  ): ClientPromptDispatchRecord | null {
    if (!taskSessionId || !clientMessageKey) {
      return null;
    }
    this.pruneClientPromptDispatches();
    const record = this.clientPromptDispatches.get(
      this.buildClientPromptDispatchKey(taskSessionId, clientMessageKey)
    );
    if (!record) {
      return null;
    }
    return record.content === content ? record : null;
  }

  private async findPersistedClientPromptDispatch(
    taskSessionId: string,
    clientMessageKey: string,
    content: string
  ): Promise<ClientPromptDispatchRecord | null> {
    if (!taskSessionId || !clientMessageKey) {
      return null;
    }
    try {
      const messages = await taskCreationFileMemoryStore.getMessages(taskSessionId);
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        const message = messages[i];
        if (message.messageType !== 'opencode_user_input') {
          continue;
        }
        if (String(message.content || '') !== content) {
          continue;
        }
        const metadata = toRecord(message.metadata);
        const persistedClientMessageKey = asString(metadata.clientMessageKey) || asString(metadata.messageKey);
        if (persistedClientMessageKey !== clientMessageKey) {
          continue;
        }
        const orchestratorSessionId = asString(metadata.orchestratorSessionId);
        const opencodeSessionId = asString(metadata.opencodeSessionId);
        if (!orchestratorSessionId || !opencodeSessionId) {
          continue;
        }
        const dispatchedAt =
          asNumber(metadata.timestamp) ||
          (message.createdAt ? Date.parse(String(message.createdAt)) : 0) ||
          Date.now();
        const dispatch: ClientPromptDispatchRecord = {
          orchestratorSessionId,
          opencodeSessionId,
          content,
          dispatchedAt,
        };
        this.rememberClientPromptDispatch(taskSessionId, clientMessageKey, dispatch);
        return dispatch;
      }
    } catch (error) {
      console.warn('[OPENCODE_CLIENT_PROMPT_LOOKUP_FAILED]', {
        taskSessionId,
        clientMessageKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return null;
  }

  private getRunArtifact(runKey: string) {
    let record = this.runArtifacts.get(runKey);
    if (!record) {
      const now = Date.now();
      record = {
        hasFileChange: false,
        hasFailure: false,
        missingArtifactNudges: 0,
        startedAt: now,
        promptedAt: now,
        completionInProgress: false,
        hasPlaywrightUsage: false,
        testDetectionAttempted: false,
        toolEvents: 0,
        commandEvents: 0,
        diffEvents: 0,
        todoEvents: 0,
        fileEvents: 0,
        textEvents: 0,
        assistantResponseObserved: false,
        nativeHistoryPollAttempts: 0,
        stableNativeHistoryPolls: 0,
        toolsUsed: new Set<string>(),
      };
      this.runArtifacts.set(runKey, record);
    }
    return record;
  }

  private buildTextStreamKey(taskSessionId: string, opencodeSessionId: string, partId: string): string {
    return `${taskSessionId}::${opencodeSessionId}::${partId}`;
  }

  private buildWorkspaceKey(orchestratorSessionId: string, workspacePath: string): string {
    return `${orchestratorSessionId}::${workspacePath}`;
  }

  private buildStreamIdleKey(taskSessionId: string, opencodeSessionId: string): string {
    return this.buildRunKey(taskSessionId, opencodeSessionId);
  }

  private clearStreamIdleTimer(key: string) {
    const timer = this.streamIdleTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.streamIdleTimers.delete(key);
    }
    this.streamIdleAt.delete(key);
  }

  private clearStreamCheckpoint(key: string) {
    const timer = this.streamCheckpointTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.streamCheckpointTimers.delete(key);
    }
    this.streamCheckpointAt.delete(key);
    this.streamCheckpointSavedAt.delete(key);
  }

  private scheduleMessageFlush() {
    if (this.messageFlushIntervalMs <= 0) return;
    if (this.messageFlushTimer) return;
    this.messageFlushTimer = setTimeout(() => {
      this.messageFlushTimer = null;
      void this.flushMessageQueue();
    }, this.messageFlushIntervalMs);
    if (this.messageFlushTimer && typeof this.messageFlushTimer.unref === 'function') {
      this.messageFlushTimer.unref();
    }
  }

  private async withWalWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.messageWalWriteInProgress.then(fn, fn);
    this.messageWalWriteInProgress = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private async ensureWalDir() {
    const dir = path.dirname(this.messageWalPath);
    await fs.mkdir(dir, { recursive: true });
  }

  private async appendWalEntry(item: QueuedDbMessage) {
    await this.withWalWriteLock(async () => {
      await this.ensureWalDir();
      await fs.appendFile(this.messageWalPath, `${JSON.stringify(item)}\n`, 'utf-8');
    });
  }

  private async rewriteWalFromQueue() {
    await this.withWalWriteLock(async () => {
      await this.ensureWalDir();
      if (this.messageQueue.length === 0) {
        await fs.writeFile(this.messageWalPath, '', 'utf-8');
        return;
      }
      const serialized = this.messageQueue.map((item) => JSON.stringify(item)).join('\n');
      await fs.writeFile(this.messageWalPath, `${serialized}\n`, 'utf-8');
    });
  }

  private async recoverMessageQueueFromWal() {
    if (this.messageWalRecovered) return;
    this.messageWalRecovered = true;
    try {
      await this.ensureWalDir();
      let raw = '';
      try {
        raw = await fs.readFile(this.messageWalPath, 'utf-8');
      } catch (error: any) {
        if (error?.code !== 'ENOENT') {
          throw error;
        }
        raw = '';
      }
      if (!raw.trim()) {
        return;
      }

      const recovered: QueuedDbMessage[] = [];
      const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as { walId?: unknown; message?: unknown };
          const msg = toRecord(parsed.message);
          const sessionId = asString(msg.sessionId);
          const role = asString(msg.role);
          const content = typeof msg.content === 'string' ? msg.content : '';
          const messageType = asString(msg.messageType);
          if (!sessionId || !role || !messageType) continue;
          recovered.push({
            walId: asString(parsed.walId) || randomUUID(),
            message: {
              id: asString(msg.id) || randomUUID(),
              sessionId,
              role: role as NewConversationMessage['role'],
              content,
              messageType,
              metadata: msg.metadata as Record<string, unknown> | undefined,
            },
          });
        } catch {
          // ignore malformed wal line
        }
      }

      if (recovered.length > 0) {
        this.messageQueue.push(...recovered);
        void this.flushMessageQueue(true);
      }
    } catch (error) {
      console.warn('[TASK_CREATION_MESSAGE_WAL_RECOVER_FAILED]', error);
    }
  }

  private async enqueueDbMessage(message: {
    id: string;
    sessionId: string;
    role: NewConversationMessage['role'];
    content: string;
    messageType: string;
    metadata?: Record<string, unknown>;
  }) {
    const queued: QueuedDbMessage = {
      walId: randomUUID(),
      message,
    };
    this.messageQueue.push(queued);
    await this.appendWalEntry(queued);
    const maxBatch = this.messageFlushMaxBatch > 0 ? this.messageFlushMaxBatch : 0;
    const maxQueue = this.messageFlushMaxQueue > 0 ? this.messageFlushMaxQueue : 0;
    if ((maxQueue > 0 && this.messageQueue.length >= maxQueue) || (maxBatch > 0 && this.messageQueue.length >= maxBatch)) {
      await this.flushMessageQueue(true);
      return;
    }
    this.scheduleMessageFlush();
  }

  private async flushMessageQueue(force: boolean = false) {
    if (this.messageQueue.length === 0) return;
    const batchSize = this.messageFlushMaxBatch > 0 ? this.messageFlushMaxBatch : this.messageQueue.length;
    const batch = this.messageQueue.splice(0, batchSize);
    const batchMessages = batch.map((item) => item.message);
    const run = async () => {
      try {
        await ensureDatabaseConnection({ retries: 3, delayMs: 1000 });
        await taskCreationSessionDAO.addMessages(batchMessages);
        await this.rewriteWalFromQueue();
      } catch (error) {
        console.warn('[TASK_CREATION_MESSAGE_FLUSH_FAILED]', error);
        this.messageQueue.unshift(...batch);
        await this.rewriteWalFromQueue();
      }
    };
    this.messageFlushInProgress = this.messageFlushInProgress.then(run, run);
    await this.messageFlushInProgress;
    if (force && this.messageQueue.length > 0) {
      await this.flushMessageQueue(force);
    }
  }

  private async persistMessage(
    taskSessionId: string,
    role: 'user' | 'agent' | 'system',
    messageType: string,
    content: string,
    metadata?: Record<string, unknown>
  ) {
    if (messageType === 'opencode_event' && !asString(content)) {
      return;
    }
    await taskCreationFileMemoryStore.addMessage(taskSessionId, role, messageType, content, metadata);
    await this.enqueueDbMessage({
      id: randomUUID(),
      sessionId: taskSessionId,
      role,
      content,
      messageType,
      metadata,
    });
  }

  private async flushPersistenceBarrier(reason: string) {
    try {
      await this.flushMessageQueue(true);
    } catch (error) {
      console.warn('[TASK_CREATION_PERSISTENCE_BARRIER_FAILED]', reason, error);
    }
  }

  private async detectWorkspaceArtifactsAfterBaseline(
    sessionId: string,
    orchestratorSessionId: string,
    workspaceRoot: string,
    artifactKind?: string
  ): Promise<boolean> {
    const files = await listWorkspaceFiles(orchestratorSessionId, workspaceRoot);
    if (files.length === 0) {
      return false;
    }
    const baseline = this.workspaceBaselines.get(sessionId);
    if (!baseline) {
      this.workspaceBaselines.set(sessionId, new Set(files));
      return false;
    }
    let hasNew = false;
    for (const file of files) {
      if (!baseline.has(file) && isMeaningfulArtifactFile(file, artifactKind || 'software_artifact')) {
        hasNew = true;
        break;
      }
    }
    if (hasNew) {
      this.workspaceBaselines.set(sessionId, new Set(files));
    }
    return hasNew;
  }

  private async hasCurrentMeaningfulArtifacts(
    orchestratorSessionId: string,
    workspaceRoot: string,
    artifactKind?: string
  ): Promise<boolean> {
    const files = await listWorkspaceFiles(orchestratorSessionId, workspaceRoot);
    return files.some((file) => isMeaningfulArtifactFile(file, artifactKind || 'software_artifact'));
  }

  private async ensureWorkspaceBaseline(
    sessionId: string,
    orchestratorSessionId: string,
    workspaceRoot: string
  ) {
    if (this.workspaceBaselines.has(sessionId)) return;
    try {
      const files = await listWorkspaceFiles(orchestratorSessionId, workspaceRoot);
      this.workspaceBaselines.set(sessionId, new Set(files));
    } catch (error) {
      console.warn('[OPENCODE_WORKSPACE_BASELINE_FAILED]', error);
    }
  }

  private scheduleStreamCheckpoint(
    taskSessionId: string,
    orchestratorSessionId: string,
    opencodeSessionId: string,
    streamKey: string
  ) {
    if (this.streamCheckpointIntervalMs <= 0) return;
    const now = Date.now();
    this.streamCheckpointAt.set(streamKey, now);
    const lastSaved = this.streamCheckpointSavedAt.get(streamKey) ?? 0;
    // 首次流式内容尽快落盘，避免短响应在刷新后丢失
    if (lastSaved === 0) {
      void this.persistStreamCheckpoint(taskSessionId, orchestratorSessionId, opencodeSessionId, streamKey);
      return;
    }
    const nextDue = lastSaved + this.streamCheckpointIntervalMs;
    if (now >= nextDue) {
      void this.persistStreamCheckpoint(taskSessionId, orchestratorSessionId, opencodeSessionId, streamKey);
      return;
    }
    if (this.streamCheckpointTimers.has(streamKey)) return;

    const delay = Math.max(0, nextDue - now);
    const timer = setTimeout(async () => {
      this.streamCheckpointTimers.delete(streamKey);
      await this.persistStreamCheckpoint(taskSessionId, orchestratorSessionId, opencodeSessionId, streamKey);
    }, delay);
    if (typeof (timer as any).unref === 'function') {
      (timer as any).unref();
    }
    this.streamCheckpointTimers.set(streamKey, timer);
  }

  private async persistStreamCheckpoint(
    taskSessionId: string,
    orchestratorSessionId: string,
    opencodeSessionId: string,
    streamKey: string
  ) {
    const entry = this.textStreams.get(streamKey);
    if (!entry) return;
    if (entry.taskSessionId !== taskSessionId) return;
    if (opencodeSessionId && entry.opencodeSessionId !== opencodeSessionId) return;
    const content = (entry.text || '').trim();
    if (!content) return;
    const lastPersisted = this.streamCheckpointContent.get(streamKey) || '';
    if (lastPersisted === content) return;

    this.streamCheckpointContent.set(streamKey, content);
    this.streamCheckpointSavedAt.set(streamKey, Date.now());
    const metadata: Record<string, unknown> = {
      orchestratorSessionId,
      opencodeSessionId: entry.opencodeSessionId || opencodeSessionId,
      eventType: 'message.part.updated',
      stream: true,
      streamDelta: false,
      streamKey,
      partId: entry.partId,
      timestamp: Date.now(),
      source: 'stream_checkpoint',
      rawPayload: {
        eventType: 'message.part.updated',
        text: content,
        source: 'stream_checkpoint',
      },
    };

    // 立刻广播 checkpoint，确保 SSE 实时可见（避免仅落盘但前端无更新）。
    await this.notify({
      taskSessionId,
      message: {
        type: 'opencode_event',
        content,
        metadata,
      },
    });
  }

  private touchStreamIdle(taskSessionId: string, orchestratorSessionId: string, opencodeSessionId: string) {
    if (!opencodeSessionId || this.streamIdleTimeoutMs <= 0) return;
    const key = this.buildStreamIdleKey(taskSessionId, opencodeSessionId);
    this.streamIdleAt.set(key, Date.now());
    const existing = this.streamIdleTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      void this.handleStreamIdleTimeout(taskSessionId, orchestratorSessionId, opencodeSessionId, key);
    }, this.streamIdleTimeoutMs);
    if (typeof (timer as any).unref === 'function') {
      (timer as any).unref();
    }
    this.streamIdleTimers.set(key, timer);
  }

  private async handleStreamIdleTimeout(
    taskSessionId: string,
    orchestratorSessionId: string,
    opencodeSessionId: string,
    key: string
  ) {
    const lastAt = this.streamIdleAt.get(key);
    if (!lastAt) return;
    if (Date.now() - lastAt < this.streamIdleTimeoutMs) return;
    this.clearStreamIdleTimer(key);

    const session = await taskCreationFileMemoryStore.getSession(taskSessionId);
    if (!session) return;
    if (session.stage === 'completed' || session.stage === 'failed') return;
    const runKey = this.buildRunKey(taskSessionId, opencodeSessionId);
    if (this.finalizedRuns.has(runKey)) return;
    const context = await this.resolveReviewContext(taskSessionId);
    const artifactKind = resolveArtifactKind(context?.taskDescription?.additional_info?.artifactKind);
    const workspaceRoot = resolveOpencodeWorkspacePath(taskSessionId) || '';
    if (workspaceRoot) {
      try {
        const hasMeaningfulArtifacts = await this.hasCurrentMeaningfulArtifacts(
          orchestratorSessionId,
          workspaceRoot,
          artifactKind
        );
        if (hasMeaningfulArtifacts) {
          const latestOutput = await this.resolveLatestOutput(taskSessionId);
          const syntheticMessage: OsacMessage = {
            type: 'OPENCODE_EVENT',
            payload: {
              seq: Date.now(),
              timestamp: Date.now(),
              eventType: 'message.final',
              orchestratorSessionId,
              opencodeSessionId,
              event: {
                type: 'message.final',
                directory: workspaceRoot,
                properties: {
                  sessionID: opencodeSessionId,
                  text: latestOutput || '已检测到工作区交付物，转入验证阶段。',
                  source: 'stream_idle_artifacts',
                },
              },
            },
          };
          await this.handleOsacMessage(orchestratorSessionId, syntheticMessage);
          return;
        }
      } catch (error) {
        console.warn('[OPENCODE_STREAM_IDLE_ARTIFACT_CHECK_FAILED]', {
          taskSessionId,
          orchestratorSessionId,
          opencodeSessionId,
          error,
        });
      }
    }
    this.scheduleNativeHistoryPoll(taskSessionId, orchestratorSessionId, opencodeSessionId, 0);
  }

  private shellEscapeSingle(value: string): string {
    return value.replace(/'/g, "'\"'\"'");
  }

  private async ensureWorkspaceGit(orchestratorSessionId: string, workspacePath: string): Promise<void> {
    if (!workspacePath) return;
    const key = this.buildWorkspaceKey(orchestratorSessionId, workspacePath);
    if (this.workspaceGitInit.has(key)) return;
    this.workspaceGitInit.add(key);

    const escaped = this.shellEscapeSingle(workspacePath);
    const command = [
      "command -v git >/dev/null 2>&1 || exit 0",
      `mkdir -p '${escaped}'`,
      `[ -d '${escaped}/.git' ] || git -C '${escaped}' init -q`,
      `git -C '${escaped}' config core.autocrlf false || true`,
    ].join(" && ");

    try {
      await osacAgentService.executeCommandAndWait(orchestratorSessionId, {
        command,
        options: { shell: true },
      });
    } catch (error) {
      console.warn("[OPENCODE_WORKSPACE_GIT_INIT_FAILED]", error);
    }
  }

  private async recoverRuntime(taskSessionId: string): Promise<RuntimeBinding> {
    const provision = await sandboxAgentProvisionService.provisionWithLock({
      metadata: {
        taskSessionId,
      },
    });

    await taskCreationFileMemoryStore.updateRuntimeBinding(taskSessionId, {
      orchestratorSessionId: provision.sessionId,
    });
    const rebound = await taskCreationFileMemoryStore.getSession(taskSessionId);
    const generation =
      typeof rebound?.runtime?.generation === 'number' && Number.isFinite(rebound.runtime.generation)
        ? Math.floor(rebound.runtime.generation)
        : undefined;

    return {
      generation,
      orchestratorSessionId: provision.sessionId,
      opencodeSessionId: undefined,
    };
  }

  private getExpectedOpencodeModelTarget(): { providerId: string; modelId: string } {
    const providerId = (process.env.OPENCODE_PROVIDER_ID || 'openai').trim().toLowerCase() || 'openai';
    const modelId = (process.env.OPENCODE_MODEL || DEFAULT_CODEX_MODEL).trim();
    return { providerId, modelId };
  }

  private isRecoveredSessionCompatible(
    sessionDetails: unknown,
    expected: { providerId: string; modelId: string }
  ): boolean {
    const record = toRecord(sessionDetails);
    const info = toRecord(record.info);
    const model = toRecord(record.model);
    const providerId = (
      asString(record.providerID) ||
      asString(record.providerId) ||
      asString(info.providerID) ||
      asString(info.providerId) ||
      asString(model.providerID) ||
      asString(model.providerId)
    ).toLowerCase();
    const modelId =
      asString(record.modelID) ||
      asString(record.modelId) ||
      asString(info.modelID) ||
      asString(info.modelId) ||
      asString(model.modelID) ||
      asString(model.modelId);

    if (!providerId && !modelId) {
      return true;
    }

    return providerId === expected.providerId && modelId === expected.modelId;
  }

  private async resolveRecoveredOpencodeSessionId(input: {
    taskSessionId: string;
    orchestratorSessionId: string;
    workspacePath: string;
    preferredOpencodeSessionId?: string;
  }): Promise<string | null> {
    const preferred = asString(input.preferredOpencodeSessionId);
    const expectedTarget = this.getExpectedOpencodeModelTarget();

    await osacAgentService.ensureOpencodeServer(input.orchestratorSessionId, {
      workspacePath: input.workspacePath || undefined,
    });

    if (preferred) {
      try {
        const preferredDetails = await osacAgentService.getSessionDetails(input.orchestratorSessionId, preferred);
        if (this.isRecoveredSessionCompatible(preferredDetails, expectedTarget)) {
          await taskCreationFileMemoryStore.updateRuntimeBinding(input.taskSessionId, {
            orchestratorSessionId: input.orchestratorSessionId,
            opencodeSessionId: preferred,
          });
          return preferred;
        }
        console.warn('[OPENCODE_RECOVER_SESSION_MODEL_MISMATCH]', {
          taskSessionId: input.taskSessionId,
          orchestratorSessionId: input.orchestratorSessionId,
          opencodeSessionId: preferred,
          expectedTarget,
        });
      } catch {
        // try recover from native session list
      }
    }

    try {
      const response = await osacAgentService.getSessionList(input.orchestratorSessionId, {
        maxCount: 50,
        format: 'json',
      });
      const sessions = Array.isArray((response as any)?.sessions) ? (response as any).sessions : [];
      const candidates = listRecoveredOpencodeSessionIds(sessions, input.workspacePath, preferred || undefined);
      for (const candidate of candidates) {
        try {
          const details = await osacAgentService.getSessionDetails(input.orchestratorSessionId, candidate);
          if (!this.isRecoveredSessionCompatible(details, expectedTarget)) {
            continue;
          }

          await taskCreationFileMemoryStore.updateRuntimeBinding(input.taskSessionId, {
            orchestratorSessionId: input.orchestratorSessionId,
            opencodeSessionId: candidate,
          });
          return candidate;
        } catch {
          continue;
        }
      }

      await taskCreationFileMemoryStore.updateRuntimeBinding(input.taskSessionId, {
        orchestratorSessionId: input.orchestratorSessionId,
        opencodeSessionId: '',
      });
      return null;
    } catch (error) {
      console.warn('[OPENCODE_RECOVER_SESSION_ID_FAILED]', input.taskSessionId, error);
      return null;
    }
  }

  private async ensureUsableOpencodeSessionId(input: {
    taskSessionId: string;
    orchestratorSessionId: string;
    workspacePath: string;
    currentOpencodeSessionId?: string;
    preferredRecoveredOpencodeSessionId?: string;
  }): Promise<string> {
    const current = asString(input.currentOpencodeSessionId);
    if (current) {
      try {
        const details = await osacAgentService.getSessionDetails(input.orchestratorSessionId, current);
        if (this.isRecoveredSessionCompatible(details, this.getExpectedOpencodeModelTarget())) {
          await taskCreationFileMemoryStore.updateRuntimeBinding(input.taskSessionId, {
            orchestratorSessionId: input.orchestratorSessionId,
            opencodeSessionId: current,
          });
          return current;
        }
      } catch (error) {
        console.warn('[OPENCODE_VALIDATE_SESSION_FAILED]', {
          taskSessionId: input.taskSessionId,
          orchestratorSessionId: input.orchestratorSessionId,
          opencodeSessionId: current,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      await taskCreationFileMemoryStore.updateRuntimeBinding(input.taskSessionId, {
        orchestratorSessionId: input.orchestratorSessionId,
        opencodeSessionId: '',
      });
    }

    const recovered = await this.resolveRecoveredOpencodeSessionId({
      taskSessionId: input.taskSessionId,
      orchestratorSessionId: input.orchestratorSessionId,
      workspacePath: input.workspacePath,
      preferredOpencodeSessionId: input.preferredRecoveredOpencodeSessionId || current || undefined,
    });
    if (recovered) {
      return recovered;
    }

    const created = await osacAgentService.createOpencodeSession(input.orchestratorSessionId, {
      workspacePath: input.workspacePath || undefined,
    });
    const opencodeSessionId = asString(created.opencodeSessionId);
    if (!opencodeSessionId) {
      throw new Error('创建 OpenCode 会话失败：缺少 opencodeSessionId');
    }
    await taskCreationFileMemoryStore.updateRuntimeBinding(input.taskSessionId, {
      orchestratorSessionId: input.orchestratorSessionId,
      opencodeSessionId,
    });
    return opencodeSessionId;
  }

  async loadNativeMessageHistory(
    taskSessionId: string,
    options?: { allowProvision?: boolean }
  ): Promise<
    Array<{
      id: string;
      role: 'user' | 'agent' | 'system';
      messageType: string;
      content: string;
      metadata?: Record<string, unknown>;
      createdAt: string;
    }> | null
  > {
    const taskId = asString(taskSessionId);
    if (!taskId) return null;

    let runtime = await resolveRuntimeBinding(taskId);
    if (!runtime) {
      if (!options?.allowProvision) {
        return null;
      }
      runtime = await this.recoverRuntime(taskId);
    }

    const workspacePath = resolveOpencodeWorkspacePath(taskId);
    const recoveredOpencodeSessionId = await this.resolveRecoveredOpencodeSessionId({
      taskSessionId: taskId,
      orchestratorSessionId: runtime.orchestratorSessionId,
      workspacePath,
      preferredOpencodeSessionId: runtime.opencodeSessionId,
    });

    if (!recoveredOpencodeSessionId) {
      return null;
    }

    try {
      const rawMessages = await osacAgentService.getSessionMessages(runtime.orchestratorSessionId, {
        opencodeSessionId: recoveredOpencodeSessionId,
        workspacePath,
      });
      const normalized = normalizeOpencodeNativeMessages(
        Array.isArray(rawMessages) ? rawMessages : [],
        {
          taskSessionId: taskId,
          generation: runtime.generation,
          orchestratorSessionId: runtime.orchestratorSessionId,
          opencodeSessionId: recoveredOpencodeSessionId,
          workspacePath,
        }
      );
      return normalized.length > 0 ? normalized : null;
    } catch (error) {
      console.warn('[OPENCODE_LOAD_NATIVE_HISTORY_FAILED]', taskId, error);
      return null;
    }
  }

  async inspectNativeSessionProgress(
    taskSessionId: string,
    options?: { allowProvision?: boolean; promptedAt?: number }
  ): Promise<{
    orchestratorSessionId: string;
    opencodeSessionId: string;
    assistantObserved: boolean;
    hasRenderableAssistantReply: boolean;
    hasActiveAssistantParts: boolean;
    latestAssistantSignature: string;
    latestAssistantText: string;
  } | null> {
    const taskId = asString(taskSessionId);
    if (!taskId) return null;

    let runtime = await resolveRuntimeBinding(taskId);
    if (!runtime) {
      if (!options?.allowProvision) {
        return null;
      }
      runtime = await this.recoverRuntime(taskId);
    }

    const workspacePath = resolveOpencodeWorkspacePath(taskId);
    const recoveredOpencodeSessionId = await this.resolveRecoveredOpencodeSessionId({
      taskSessionId: taskId,
      orchestratorSessionId: runtime.orchestratorSessionId,
      workspacePath,
      preferredOpencodeSessionId: runtime.opencodeSessionId,
    });

    if (!recoveredOpencodeSessionId) {
      return null;
    }

    try {
      const response = await osacAgentService.getSessionMessages(runtime.orchestratorSessionId, {
        opencodeSessionId: recoveredOpencodeSessionId,
        workspacePath,
      });
      const rawMessages = Array.isArray(response) ? response : [];
      const assistantState = inspectLatestAssistantTurn(rawMessages, Number(options?.promptedAt) || 0);
      const normalized = normalizeOpencodeNativeMessages(rawMessages, {
        taskSessionId: taskId,
        generation: runtime.generation,
        orchestratorSessionId: runtime.orchestratorSessionId,
        opencodeSessionId: recoveredOpencodeSessionId,
        workspacePath,
      });
      const renderableAssistantReply = hasRenderableAssistantReply(normalized);

      return {
        orchestratorSessionId: runtime.orchestratorSessionId,
        opencodeSessionId: recoveredOpencodeSessionId,
        assistantObserved: assistantState.assistantObserved || renderableAssistantReply,
        hasRenderableAssistantReply: renderableAssistantReply,
        hasActiveAssistantParts: assistantState.hasActiveAssistantParts,
        latestAssistantSignature: assistantState.latestAssistantSignature,
        latestAssistantText: assistantState.latestAssistantText,
      };
    } catch (error) {
      if (isSandboxNotFoundError(error)) {
        await markSandboxClosed(runtime.orchestratorSessionId);
        return null;
      }
      console.warn('[OPENCODE_INSPECT_NATIVE_PROGRESS_FAILED]', taskId, error);
      return null;
    }
  }

  private async emitPhaseStatus(params: {
    sessionId: string;
    phase: FlowPhase;
    message: string;
    stage?: FileSessionRecord['stage'];
    tone?: 'system' | 'intent' | 'planning' | 'execution' | 'review' | 'error';
    metadata?: Record<string, unknown>;
  }) {
    const session = await taskCreationFileMemoryStore.getSession(params.sessionId);
    const currentCycle = session?.phaseCycle ?? 0;
    const nextCycle =
      params.phase === 'development' ? 0 : params.phase === 'repair' ? currentCycle + 1 : currentCycle;

    await taskCreationFileMemoryStore.updateSessionState(params.sessionId, {
      phase: params.phase,
      phaseCycle: nextCycle,
      stage: params.stage as any,
    });

    const content = formatPhaseStatus(params.phase, params.message);
    const metadata: Record<string, unknown> = {
      ...(params.metadata || {}),
      phase: params.phase,
      phaseCycle: nextCycle,
    };

    await this.persistMessage(
      params.sessionId,
      'agent',
      'status_update',
      content,
      metadata
    );

    await this.notify({
      taskSessionId: params.sessionId,
      message: {
        type: 'status_update',
        content,
        stage: params.stage as any,
        tone: params.tone || 'system',
        phase: params.phase,
        metadata,
      },
    });
  }

  private async withOpencodeLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.opencodeLocks.get(key);
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.opencodeLocks.set(key, current);

    if (prev) {
      await prev.catch(() => undefined);
    }

    try {
      return await fn();
    } finally {
      release();
      if (this.opencodeLocks.get(key) === current) {
        this.opencodeLocks.delete(key);
      }
    }
  }

  private extractTextStreamPayload(
    payload: Record<string, unknown>,
    eventType: string
  ): { opencodeSessionId: string; partId: string; text: string; delta: string } | null {
    if (eventType !== 'message.part.updated' && eventType !== 'message.part.delta') {
      return null;
    }

    let event = toRecord(payload.event);
    const properties = normalizeRecord(event.properties);
    const part = normalizeRecord(properties.part);
    const message = normalizeRecord(properties.message);
    const partType = (asString(part.type) || asString(properties.type)).toLowerCase();
    if (partType && partType !== 'text' && partType !== 'reasoning') {
      return null;
    }
    const role =
      (asString(message.role) || asString(properties.role) || asString(part.role)).toLowerCase();
    if (role === 'user') {
      // 仅聚合 assistant/system 文本，避免把用户输入误当作最终输出落盘并回放。
      return null;
    }

    const partId = asString(part.id) || asString(properties.partId);
    if (!partId) {
      // 无 partId 的文本分片无法可靠归属到同一回复流，跳过以防止串流拼接错乱。
      return null;
    }

    const opencodeSessionId =
      asString(payload.opencodeSessionId) ||
      asString(part.sessionID) ||
      asString(part.sessionId) ||
      pickSessionIdFromEvent(event) ||
      '';
    if (!opencodeSessionId) {
      return null;
    }

    const delta = asString(properties.delta);
    const text = asString(part.text) || asString(part.content) || asString(properties.text);
    if (!delta && !text) {
      return null;
    }

    return {
      opencodeSessionId,
      partId,
      text,
      delta,
    };
  }

  private buildMessageRoleKey(
    taskSessionId: string,
    opencodeSessionId: string | undefined,
    messageId: string
  ) {
    return `${taskSessionId}::${opencodeSessionId || ''}::${messageId}`;
  }

  private pruneMessageRoles() {
    const maxEntries = 4000;
    if (this.messageRoles.size <= maxEntries) return;
    const entries = Array.from(this.messageRoles.entries()).sort((a, b) => a[1].updatedAt - b[1].updatedAt);
    const removeCount = entries.length - maxEntries;
    for (let i = 0; i < removeCount; i += 1) {
      this.messageRoles.delete(entries[i][0]);
    }
  }

  private enrichEventRole(
    taskSessionId: string,
    opencodeSessionId: string | undefined,
    event: Record<string, unknown>
  ): Record<string, unknown> {
    const eventType = asString(event.type);
    const properties =
      event.properties && typeof event.properties === 'object'
        ? { ...(event.properties as Record<string, unknown>) }
        : {};
    const part =
      properties.part && typeof properties.part === 'object'
        ? { ...(properties.part as Record<string, unknown>) }
        : {};
    const info =
      properties.info && typeof properties.info === 'object'
        ? (properties.info as Record<string, unknown>)
        : {};

    const explicitRole =
      (asString(properties.role) || asString(part.role) || asString(info.role)).toLowerCase();
    const infoMessageId = asString(info.id);
    const partMessageId = asString(part.messageID) || asString(part.messageId);

    if (eventType === 'message.updated' && infoMessageId && explicitRole) {
      this.messageRoles.set(
        this.buildMessageRoleKey(taskSessionId, opencodeSessionId, infoMessageId),
        { role: explicitRole, updatedAt: Date.now() }
      );
      this.pruneMessageRoles();
      if (!properties.role) {
        properties.role = explicitRole;
      }
      return {
        ...event,
        properties,
      };
    }

    if (explicitRole || !partMessageId) {
      return event;
    }

    const cached = this.messageRoles.get(
      this.buildMessageRoleKey(taskSessionId, opencodeSessionId, partMessageId)
    );
    if (!cached?.role) {
      return event;
    }

    properties.role = cached.role;
    if (Object.keys(part).length > 0 && !part.role) {
      part.role = cached.role;
      properties.part = part;
    }
    return {
      ...event,
      properties,
    };
  }

  private upsertTextStream(input: {
    taskSessionId: string;
    orchestratorSessionId: string;
    opencodeSessionId: string;
    partId: string;
    text: string;
    delta: string;
    updatedAt: number;
  }): { streamKey: string; text: string; delta: string; resetFrom?: string } {
    const streamKey = this.buildTextStreamKey(input.taskSessionId, input.opencodeSessionId, input.partId);
    const previous = this.textStreams.get(streamKey);
    if (previous?.truncated) {
      return { streamKey, text: previous.text, delta: '' };
    }

    let nextText = input.text;
    if (!nextText && previous) {
      nextText = `${previous.text}${input.delta}`;
    } else if (previous && nextText && nextText.length < previous.text.length) {
      nextText = input.delta ? `${previous.text}${input.delta}` : previous.text;
    }
    if (!nextText && input.delta) {
      nextText = previous ? `${previous.text}${input.delta}` : input.delta;
    }

    const previousText = previous?.text || '';
    let emittedDelta = input.delta;
    if (!emittedDelta && nextText) {
      if (previousText && nextText.startsWith(previousText)) {
        emittedDelta = nextText.slice(previousText.length);
      } else if (!previousText) {
        emittedDelta = nextText;
      }
    }
    const isReset =
      previousText &&
      nextText &&
      !nextText.startsWith(previousText) &&
      !previousText.startsWith(nextText);

    let truncated = false;
    if (this.streamMaxChars > 0 && nextText.length > this.streamMaxChars) {
      nextText = `${nextText.slice(0, this.streamMaxChars)}...`;
      truncated = true;
    }

    const entry: OpencodeTextStreamEntry = {
      taskSessionId: input.taskSessionId,
      orchestratorSessionId: input.orchestratorSessionId,
      opencodeSessionId: input.opencodeSessionId,
      partId: input.partId,
      text: nextText,
      updatedAt: Number.isFinite(input.updatedAt) ? input.updatedAt : Date.now(),
      truncated,
    };
    this.textStreams.set(streamKey, entry);
    if (this.streamMaxEntries > 0 && this.textStreams.size > this.streamMaxEntries) {
      const entries = Array.from(this.textStreams.entries());
      entries.sort((a, b) => a[1].updatedAt - b[1].updatedAt);
      const removeCount = entries.length - this.streamMaxEntries;
      for (let i = 0; i < removeCount; i += 1) {
        this.textStreams.delete(entries[i][0]);
      }
    }

    return {
      streamKey,
      text: entry.text,
      delta: emittedDelta,
      resetFrom: isReset ? previousText : undefined,
    };
  }

  private clearTextStreams(taskSessionId: string, opencodeSessionId?: string) {
    for (const [key, entry] of this.textStreams.entries()) {
      if (entry.taskSessionId !== taskSessionId) continue;
      if (opencodeSessionId && entry.opencodeSessionId !== opencodeSessionId) continue;
      this.textStreams.delete(key);
      this.clearStreamBroadcast(key);
      this.clearStreamCheckpoint(key);
      this.streamCheckpointContent.delete(key);
    }
  }

  private clearNativeHistoryPoll(runKey: string) {
    const timer = this.nativeHistoryPollTimers.get(runKey);
    if (timer) {
      clearTimeout(timer);
      this.nativeHistoryPollTimers.delete(runKey);
    }
    this.nativeHistoryPollInFlight.delete(runKey);
  }

  private scheduleNativeHistoryPoll(
    taskSessionId: string,
    orchestratorSessionId: string,
    opencodeSessionId: string,
    delayMs?: number
  ) {
    if (!opencodeSessionId || opencodeSessionId === 'unknown') return;
    const runKey = this.buildRunKey(taskSessionId, opencodeSessionId);
    if (this.finalizedRuns.has(runKey)) return;
    if (this.nativeHistoryPollTimers.has(runKey)) return;

    const timer = setTimeout(() => {
      this.nativeHistoryPollTimers.delete(runKey);
      void this.runNativeHistoryPoll(taskSessionId, orchestratorSessionId, opencodeSessionId, runKey);
    }, Math.max(0, delayMs ?? this.nativeHistoryPollDelayMs));
    if (typeof (timer as any).unref === 'function') {
      (timer as any).unref();
    }
    this.nativeHistoryPollTimers.set(runKey, timer);
  }

  private async runNativeHistoryPoll(
    taskSessionId: string,
    orchestratorSessionId: string,
    opencodeSessionId: string,
    runKey: string
  ) {
    if (this.nativeHistoryPollInFlight.has(runKey)) {
      return;
    }
    this.nativeHistoryPollInFlight.add(runKey);
    try {
      if (this.finalizedRuns.has(runKey)) {
        return;
      }
      const session = await taskCreationFileMemoryStore.getSession(taskSessionId);
      if (!session) {
        return;
      }
      if (session.stage === 'completed' || session.stage === 'failed') {
        return;
      }

      const artifact = this.getRunArtifact(runKey);
      artifact.nativeHistoryPollAttempts += 1;
      const liveSnapshots = this.getLiveTextStreamSnapshots(taskSessionId, opencodeSessionId);
      const livePreview = liveSnapshots[liveSnapshots.length - 1];
      if (livePreview?.content) {
        artifact.assistantResponseObserved = true;
        artifact.lastText = livePreview.content.slice(-800);
      }

      const syncResult = await this.syncNativeHistoryDelta({
        taskSessionId,
        orchestratorSessionId,
        opencodeSessionId,
        promptedAt: artifact.promptedAt,
      });

      if (syncResult.assistantObserved) {
        artifact.assistantResponseObserved = true;
        if (syncResult.latestAssistantText) {
          artifact.lastText = syncResult.latestAssistantText.slice(-800);
        }
      }

      const effectiveAssistantText =
        syncResult.latestAssistantText ||
        livePreview?.content ||
        artifact.lastText ||
        '';
      const effectiveAssistantObserved =
        syncResult.assistantObserved || Boolean(effectiveAssistantText);
      const effectiveAssistantSignature =
        syncResult.latestAssistantSignature ||
        (effectiveAssistantText
          ? JSON.stringify({
              source: 'live_stream_fallback',
              textLength: effectiveAssistantText.length,
              tail: effectiveAssistantText.slice(-400),
            })
          : '');
      const context = await this.resolveReviewContext(taskSessionId);
      const validationMode = context ? resolveValidationMode(context) : 'browser';
      const artifactKind = resolveArtifactKind(context?.taskDescription?.additional_info?.artifactKind);
      const workspaceRoot = resolveOpencodeWorkspacePath(taskSessionId) || '';
      let hasMeaningfulArtifacts = false;
      if (workspaceRoot) {
        try {
          hasMeaningfulArtifacts = await this.hasCurrentMeaningfulArtifacts(
            orchestratorSessionId,
            workspaceRoot,
            artifactKind
          );
        } catch (error) {
          console.warn('[OPENCODE_POLL_ARTIFACT_SCAN_FAILED]', {
            taskSessionId,
            orchestratorSessionId,
            opencodeSessionId,
            error,
          });
        }
      }

      if (syncResult.hasActiveAssistantParts) {
        artifact.stableNativeHistoryPolls = 0;
        artifact.lastNativeAssistantSignature = syncResult.latestAssistantSignature;
      } else if (effectiveAssistantObserved) {
        const hasExecutionEvidence =
          artifact.commandEvents > 0 ||
          artifact.toolEvents > 0 ||
          artifact.todoEvents > 0 ||
          hasMeaningfulArtifacts;
        if (
          effectiveAssistantSignature &&
          effectiveAssistantSignature === artifact.lastNativeAssistantSignature
        ) {
          artifact.stableNativeHistoryPolls += 1;
        } else {
          artifact.stableNativeHistoryPolls = 1;
          artifact.lastNativeAssistantSignature = effectiveAssistantSignature;
        }
        if (artifact.stableNativeHistoryPolls >= 2 && hasExecutionEvidence && hasMeaningfulArtifacts) {
          const completionPreview =
            effectiveAssistantText || 'OpenCode 已产出回复';
          const syntheticMessage: OsacMessage = {
            type: 'OPENCODE_EVENT',
            payload: {
              seq: Date.now(),
              timestamp: Date.now(),
              eventType: 'message.final',
              orchestratorSessionId,
              opencodeSessionId,
              event: {
                type: 'message.final',
                directory: resolveOpencodeWorkspacePath(taskSessionId) || undefined,
                properties: {
                  sessionID: opencodeSessionId,
                  text: completionPreview,
                  source: 'native_history_poll_stable',
                },
              },
            },
          };
          await this.handleOsacMessage(orchestratorSessionId, syntheticMessage);
          return;
        }
        if (artifact.stableNativeHistoryPolls >= 2 && hasExecutionEvidence && !hasMeaningfulArtifacts) {
          const nudged = artifact.missingArtifactNudges;
          if (nudged < 1 && workspaceRoot) {
            artifact.missingArtifactNudges += 1;
            await this.notify({
              taskSessionId,
              message: {
                type: 'status_update',
                content: '未检测到有效交付物，继续要求执行生成真实产物...',
                stage: 'executing',
                tone: 'execution',
                metadata: {
                  source: 'native_history_poll_no_artifacts',
                  orchestratorSessionId,
                  opencodeSessionId,
                },
              },
            });
            await this.sendUserInput({
              taskSessionId,
              content: buildNoArtifactFollowUp(validationMode),
              orchestratorSessionId,
              workspacePath: workspaceRoot,
              source: 'agent',
            });
          }
          artifact.stableNativeHistoryPolls = 0;
        }
      } else {
        artifact.stableNativeHistoryPolls = 0;
        artifact.lastNativeAssistantSignature = effectiveAssistantSignature;
      }

      if (artifact.nativeHistoryPollAttempts < this.nativeHistoryPollMaxAttempts) {
        this.scheduleNativeHistoryPoll(taskSessionId, orchestratorSessionId, opencodeSessionId);
      }
    } catch (error) {
      console.warn('[OPENCODE_NATIVE_HISTORY_POLL_FAILED]', {
        taskSessionId,
        orchestratorSessionId,
        opencodeSessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      const artifact = this.getRunArtifact(runKey);
      if (artifact.nativeHistoryPollAttempts < this.nativeHistoryPollMaxAttempts) {
        this.scheduleNativeHistoryPoll(taskSessionId, orchestratorSessionId, opencodeSessionId);
      }
    } finally {
      this.nativeHistoryPollInFlight.delete(runKey);
    }
  }

  private buildStoredMessageKey(message: {
    id?: string;
    messageType?: string | null;
    metadata?: Record<string, unknown>;
    createdAt?: string;
  }): string {
    const metadata = normalizeMessageTimelineMetadata(message.metadata, message.createdAt, 0);
    return buildTimelineMessageKey({
      id: message.id,
      messageType: message.messageType,
      metadata,
      createdAt: message.createdAt,
    });
  }

  private async syncNativeHistoryDelta(input: {
    taskSessionId: string;
    orchestratorSessionId: string;
    opencodeSessionId: string;
    promptedAt: number;
  }): Promise<{
    assistantObserved: boolean;
    persistedCount: number;
    hasActiveAssistantParts: boolean;
    latestAssistantSignature: string;
    latestAssistantText: string;
  }> {
    if (!input.opencodeSessionId || input.opencodeSessionId === 'unknown') {
      return {
        assistantObserved: false,
        persistedCount: 0,
        hasActiveAssistantParts: false,
        latestAssistantSignature: '',
        latestAssistantText: '',
      };
    }
    const workspacePath = resolveOpencodeWorkspacePath(input.taskSessionId);
    const runtime = await resolveRuntimeBinding(input.taskSessionId, input.orchestratorSessionId);
    let rawMessages: unknown[] = [];
    try {
      const response = await osacAgentService.getSessionMessages(input.orchestratorSessionId, {
        opencodeSessionId: input.opencodeSessionId,
        workspacePath: workspacePath || undefined,
      });
      rawMessages = Array.isArray(response) ? response : [];
    } catch (error) {
      if (isSandboxNotFoundError(error)) {
        await markSandboxClosed(input.orchestratorSessionId);
        return {
          assistantObserved: false,
          persistedCount: 0,
          hasActiveAssistantParts: false,
          latestAssistantSignature: '',
          latestAssistantText: '',
        };
      }
      throw error;
    }
    const assistantState = inspectLatestAssistantTurn(rawMessages, input.promptedAt);
    const normalized = normalizeOpencodeNativeMessages(Array.isArray(rawMessages) ? rawMessages : [], {
      taskSessionId: input.taskSessionId,
      generation: runtime?.generation,
      orchestratorSessionId: input.orchestratorSessionId,
      opencodeSessionId: input.opencodeSessionId,
      workspacePath: workspacePath || '',
    });

    const promptedAt = Number.isFinite(input.promptedAt) ? input.promptedAt : 0;
    const candidateMessages = normalized.filter((message) => {
      const createdAt = Date.parse(message.createdAt);
      if (promptedAt > 0 && Number.isFinite(createdAt) && createdAt + 1000 < promptedAt) {
        return false;
      }
      return message.role === 'agent' || message.role === 'system';
    });

    if (candidateMessages.length === 0) {
      return {
        assistantObserved: assistantState.assistantObserved,
        persistedCount: 0,
        hasActiveAssistantParts: assistantState.hasActiveAssistantParts,
        latestAssistantSignature: assistantState.latestAssistantSignature,
        latestAssistantText: assistantState.latestAssistantText,
      };
    }

    const existingMessages = await taskCreationFileMemoryStore.getMessages(input.taskSessionId);
    const existingKeys = new Set(
      existingMessages.map((message) =>
        this.buildStoredMessageKey({
          id: message.id,
          messageType: message.messageType,
          metadata: message.metadata,
          createdAt: message.createdAt,
        })
      )
    );

    let persistedCount = 0;
    for (const message of candidateMessages) {
      const messageKey = this.buildStoredMessageKey({
        id: message.id,
        messageType: message.messageType,
        metadata: message.metadata,
        createdAt: message.createdAt,
      });
      if (existingKeys.has(messageKey)) {
        continue;
      }
      existingKeys.add(messageKey);
      persistedCount += 1;
      await this.persistMessage(
        input.taskSessionId,
        message.role,
        message.messageType,
        message.content,
        {
          ...(message.metadata || {}),
          source: 'opencode_native_history_sync',
          recoveredVia: 'native_history_poll',
        }
      );
    }

    return {
      assistantObserved: assistantState.assistantObserved || hasRenderableAssistantReply(candidateMessages),
      persistedCount,
      hasActiveAssistantParts: assistantState.hasActiveAssistantParts,
      latestAssistantSignature: assistantState.latestAssistantSignature,
      latestAssistantText: assistantState.latestAssistantText,
    };
  }

  private clearStreamBroadcast(streamKey: string) {
    const timer = this.streamBroadcastTimers.get(streamKey);
    if (timer) {
      clearTimeout(timer);
      this.streamBroadcastTimers.delete(streamKey);
    }
    this.streamBroadcastAt.delete(streamKey);
    this.streamBroadcastMeta.delete(streamKey);
  }

  private scheduleStreamBroadcast(taskSessionId: string, streamKey: string) {
    const interval = this.streamBroadcastIntervalMs;
    if (interval <= 0) {
      void this.sendStreamBroadcast(taskSessionId, streamKey);
      return;
    }
    const lastAt = this.streamBroadcastAt.get(streamKey) ?? 0;
    const now = Date.now();
    const delay = Math.max(0, interval - (now - lastAt));
    if (delay === 0) {
      void this.sendStreamBroadcast(taskSessionId, streamKey);
      return;
    }
    if (this.streamBroadcastTimers.has(streamKey)) {
      return;
    }
    const timer = setTimeout(() => {
      this.streamBroadcastTimers.delete(streamKey);
      void this.sendStreamBroadcast(taskSessionId, streamKey);
    }, delay);
    if (typeof (timer as any).unref === 'function') {
      (timer as any).unref();
    }
    this.streamBroadcastTimers.set(streamKey, timer);
  }

  private async sendStreamBroadcast(taskSessionId: string, streamKey: string) {
    const entry = this.textStreams.get(streamKey);
    const metadata = this.streamBroadcastMeta.get(streamKey);
    if (!entry || !metadata) return;
    this.streamBroadcastAt.set(streamKey, Date.now());
    await this.notify({
      taskSessionId,
      message: {
        type: 'opencode_event',
        content: entry.text,
        metadata,
      },
    });
  }

  private async flushTextStreams(
    taskSessionId: string,
    orchestratorSessionId: string,
    opencodeSessionId?: string,
    options?: { persistMode?: 'all' | 'latest' }
  ): Promise<string | null> {
    const matched: OpencodeTextStreamEntry[] = [];
    for (const [key, entry] of this.textStreams.entries()) {
      if (entry.taskSessionId !== taskSessionId) continue;
      if (opencodeSessionId && entry.opencodeSessionId !== opencodeSessionId) continue;
      matched.push(entry);
      this.textStreams.delete(key);
      this.clearStreamBroadcast(key);
      this.clearStreamCheckpoint(key);
      this.streamCheckpointContent.delete(key);
    }
    if (matched.length === 0) {
      return null;
    }

    matched.sort((a, b) => a.updatedAt - b.updatedAt);

    const normalizeForCompare = (value: string) => value.replace(/\r\n/g, '\n').trim();
    let latestUserInput = '';
    let latestUserInputAt = 0;
    try {
      const history = await taskCreationFileMemoryStore.getMessages(taskSessionId);
      for (let i = history.length - 1; i >= 0; i -= 1) {
        const item = history[i];
        if (
          item.messageType !== 'user_input' &&
          item.messageType !== 'user_response' &&
          item.messageType !== 'opencode_user_input'
        ) {
          continue;
        }
        latestUserInput = normalizeForCompare(String(item.content || ''));
        const ts = Date.parse(String(item.createdAt || ''));
        latestUserInputAt = Number.isFinite(ts) ? ts : 0;
        break;
      }
    } catch {
      // ignore
    }

    const isLikelyUserEcho = (text: string): boolean => {
      const normalized = normalizeForCompare(text);
      if (!normalized || !latestUserInput) return false;
      if (normalized !== latestUserInput) return false;
      if (!latestUserInputAt) return true;
      return Math.abs(Date.now() - latestUserInputAt) <= 5 * 60 * 1000;
    };

    const candidateEntries = matched.filter((entry) => {
      const content = entry.text.trim();
      if (!content) return false;
      if (isLikelyUserEcho(content)) return false;
      return true;
    });
    if (candidateEntries.length === 0) {
      return null;
    }

    const latest = candidateEntries[candidateEntries.length - 1];
    const latestContent = latest.text.trim();

    const persistMode = options?.persistMode === 'latest' ? 'latest' : 'all';
    let persisted: OpencodeTextStreamEntry[];
    if (persistMode === 'latest') {
      persisted = [latest];
    } else {
      // 非直连模式保留每个流(part)的最终文本，便于完整回放。
      const latestByKey = new Map<string, OpencodeTextStreamEntry>();
      for (const entry of candidateEntries) {
        const key = this.buildTextStreamKey(entry.taskSessionId, entry.opencodeSessionId, entry.partId);
        latestByKey.set(key, entry);
      }
      persisted = Array.from(latestByKey.values()).sort((a, b) => a.updatedAt - b.updatedAt);
    }
    for (const entry of persisted) {
      const content = entry.text.trim();
      if (!content) continue;
      const metadata: Record<string, unknown> = {
        orchestratorSessionId,
        opencodeSessionId: entry.opencodeSessionId || opencodeSessionId || undefined,
        eventType: 'message.final',
        stream: false,
        source: 'stream_aggregate',
        streamKey: this.buildTextStreamKey(entry.taskSessionId, entry.opencodeSessionId, entry.partId),
        partId: entry.partId,
        rawPayload: {
          eventType: 'message.final',
          text: content,
          source: 'stream_aggregate',
        },
      };
      await this.persistMessage(
        taskSessionId,
        'agent',
        'opencode_event',
        content,
        metadata
      );
    }

    const notifyMetadata: Record<string, unknown> = {
      orchestratorSessionId,
      opencodeSessionId: latest.opencodeSessionId || opencodeSessionId || undefined,
      eventType: 'message.final',
      stream: false,
      source: 'stream_aggregate',
      streamKey: this.buildTextStreamKey(latest.taskSessionId, latest.opencodeSessionId, latest.partId),
      partId: latest.partId,
      rawPayload: {
        eventType: 'message.final',
        text: latestContent,
        source: 'stream_aggregate',
      },
    };

    await this.notify({
      taskSessionId,
      message: {
        type: 'opencode_event',
        content: latestContent,
        metadata: notifyMetadata,
      },
    });
    return latestContent;
  }

  public getLiveTextStreamSnapshots(
    taskSessionId: string,
    opencodeSessionId?: string
  ): Array<{
    content: string;
    metadata: Record<string, unknown>;
    createdAt: string;
  }> {
    const matched: OpencodeTextStreamEntry[] = [];
    for (const entry of this.textStreams.values()) {
      if (entry.taskSessionId !== taskSessionId) continue;
      if (opencodeSessionId && entry.opencodeSessionId !== opencodeSessionId) continue;
      matched.push(entry);
    }
    if (matched.length === 0) {
      return [];
    }

    matched.sort((a, b) => a.updatedAt - b.updatedAt);

    const snapshots: Array<{
      content: string;
      metadata: Record<string, unknown>;
      createdAt: string;
    }> = [];

    for (const entry of matched) {
      const content = (entry.text || '').trim();
      if (!content) continue;
      const streamKey = this.buildTextStreamKey(entry.taskSessionId, entry.opencodeSessionId, entry.partId);
      snapshots.push({
        content,
        createdAt: new Date(entry.updatedAt || Date.now()).toISOString(),
        metadata: {
          orchestratorSessionId: entry.orchestratorSessionId,
          opencodeSessionId: entry.opencodeSessionId,
          eventType: 'message.part.updated',
          stream: true,
          streamDelta: false,
          source: 'stream_live_snapshot',
          streamKey,
          partId: entry.partId,
          timestamp: entry.updatedAt || Date.now(),
          rawPayload: {
            eventType: 'message.part.updated',
            text: content,
            source: 'stream_live_snapshot',
          },
        },
      });
    }

    return snapshots;
  }

  private formatRunSummary(artifact: RunArtifact, executionOutput: string): string {
    const tools = Array.from(artifact.toolsUsed || []);
    const toolSnippet = tools.length ? `工具: ${tools.slice(0, 6).join(', ')}${tools.length > 6 ? '…' : ''}` : '工具: 无';
    const outputSnippet = executionOutput ? compact(executionOutput, 260) : '输出摘要: 无';
    return [
      `文件变更: ${artifact.fileEvents > 0 ? '有' : '无'}`,
      `Playwright: ${artifact.hasPlaywrightUsage ? '已执行' : '未执行'}`,
      `工具事件: ${artifact.toolEvents}`,
      `命令事件: ${artifact.commandEvents}`,
      `Diff事件: ${artifact.diffEvents}`,
      toolSnippet,
      `输出摘要: ${outputSnippet}`,
    ].join(' | ');
  }

  private async resolveTargetSession(
    orchestratorSessionId: string,
    payload: Record<string, unknown>,
    event?: Record<string, unknown>,
    options?: { requireOpencodeSessionId?: boolean }
  ): Promise<FileSessionRecord | null> {
    const opencodeSessionId =
      asString(payload.opencodeSessionId) ||
      (event ? pickSessionIdFromEvent(event) : '') ||
      '';

    if (opencodeSessionId) {
      const byOpencode = await taskCreationFileMemoryStore.findSessionByOpencodeSessionId(opencodeSessionId);
      if (byOpencode) {
        return byOpencode;
      }
    }

    const directory = extractDirectoryFromPayload(payload, event);
    if (directory) {
      const sessionIdFromDir = extractTaskSessionIdFromDirectory(directory);
      if (sessionIdFromDir) {
        const byDir = await taskCreationFileMemoryStore.getSession(sessionIdFromDir);
        if (byDir) {
          return byDir;
        }
      }
    }

    if (options?.requireOpencodeSessionId) {
      return null;
    }

    return taskCreationFileMemoryStore.findSessionByOrchestratorSessionId(orchestratorSessionId);
  }

  private async resolveReviewContext(taskSessionId: string): Promise<{
    userInput: string;
    taskDescription: TaskDescription;
    executionPlan: ExecutionPlan;
  } | null> {
    await ensureDatabaseConnection({ retries: 3, delayMs: 1200 });
    const [messages, taskDescriptionRecord, executionPlanRecord] = await Promise.all([
      taskCreationSessionDAO.getMessages(taskSessionId),
      taskCreationSessionDAO.getTaskDescription(taskSessionId),
      taskCreationSessionDAO.getExecutionPlan(taskSessionId),
    ]);

    if (!taskDescriptionRecord || !executionPlanRecord) {
      return null;
    }

    const firstUserInput =
      messages.find((m) => m.messageType === 'user_input')?.content?.trim() || '';
    const userResponses = messages
      .filter((m) => m.messageType === 'user_response')
      .map((m) => (m.content || '').trim())
      .filter(Boolean);

    const userInput = userResponses.length
      ? `${firstUserInput}\n\n用户补充信息：\n${userResponses.map((text, idx) => `补充${idx + 1}: ${text}`).join('\n')}`
      : firstUserInput;

    return {
      userInput: userInput || firstUserInput || '',
      taskDescription: buildTaskDescription(taskDescriptionRecord),
      executionPlan: buildExecutionPlan(executionPlanRecord),
    };
  }

  private async resolveLatestOutput(taskSessionId: string): Promise<string> {
    const messages = await taskCreationFileMemoryStore.getMessages(taskSessionId);
    if (!messages.length) return '';

    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (message.messageType !== 'opencode_event') continue;
      const metadata = toRecord(message.metadata);
      const eventType =
        asString(metadata.eventType) ||
        asString(toRecord(metadata.rawPayload).eventType) ||
        asString(toRecord(toRecord(metadata.rawPayload).event).type);
      if (eventType === 'message.final' || metadata.source === 'stream_aggregate') {
        return String(message.content || '').trim();
      }
    }

    const last = [...messages].reverse().find((m) => m.messageType === 'opencode_event');
    return String(last?.content || '').trim();
  }

  private async resolveLatestRunSummary(taskSessionId: string): Promise<string> {
    const messages = await taskCreationFileMemoryStore.getMessages(taskSessionId);
    if (!messages.length) return '';
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (message.messageType !== 'agent_message') continue;
      const metadata = toRecord(message.metadata);
      if (metadata.summaryType === 'run_summary') {
        return String(message.content || '').trim();
      }
    }
    return '';
  }

  private isDirectSession(session: FileSessionRecord | null): boolean {
    return Boolean(session && session.mode === 'sandbox');
  }

  private async runReviewGate(params: {
    session: FileSessionRecord;
    orchestratorSessionId: string;
    opencodeSessionId?: string;
    executionOutput: string;
  }): Promise<
    | { status: 'skipped'; reason: string }
    | { status: 'error'; message: string }
    | { status: 'pass'; summary: string; issues: string[] }
    | { status: 'retry'; summary: string; issues: string[]; nextInstructions: string }
  > {
    try {
      const context = await this.resolveReviewContext(params.session.id);
      if (!context) {
        return { status: 'skipped', reason: '缺少任务描述或执行计划，跳过自动审查' };
      }

      let workspaceHint = '';
      try {
        const workspaceRoot = resolveOpencodeWorkspacePath(params.session.id);
        if (workspaceRoot) {
          const files = await listWorkspaceFiles(params.orchestratorSessionId, workspaceRoot, {
            maxDepth: 3,
            maxEntries: 200,
          });
          if (files.length) {
            workspaceHint = `\n\n已检测到工作区文件:\n${files.slice(0, 30).join('\n')}`;
          }
        }
      } catch (error) {
        console.warn('[OPENCODE_REVIEW_WORKSPACE_SCAN_FAILED]', error);
      }

      const review = await executionReviewAgent.review({
        userInput: context.userInput || '（未提供用户输入）',
        taskDescription: context.taskDescription,
        executionPlan: context.executionPlan,
        executionOutput: `${params.executionOutput || '（无输出）'}${workspaceHint}`,
      });

      if (review.done || !review.next_instructions) {
        return {
          status: 'pass',
          summary: review.summary || '执行结果已通过审查',
          issues: review.issues || [],
        };
      }

      return {
        status: 'retry',
        summary: review.summary || '执行结果未通过审查',
        issues: review.issues || [],
        nextInstructions: review.next_instructions,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { status: 'error', message };
    }
  }

  initialize() {
    if (this.initialized) return;
    this.initialized = true;
    void this.recoverMessageQueueFromWal();

    osacConnectionManager.registerMessageHandler(async (orchestratorSessionId, message) => {
      try {
        await this.handleOsacMessage(orchestratorSessionId, message);
      } catch (error) {
        if (isSandboxNotFoundError(error)) {
          await markSandboxClosed(orchestratorSessionId);
        }
        console.warn('[OPENCODE_REMOTE_HANDLER_ERROR]', orchestratorSessionId, error);
      }
    });
  }

  async ingestExternalMessage(orchestratorSessionId: string, message: OsacMessage) {
    try {
      await this.handleOsacMessage(orchestratorSessionId, message);
    } catch (error) {
      if (isSandboxNotFoundError(error)) {
        await markSandboxClosed(orchestratorSessionId);
      }
      console.warn('[OPENCODE_REMOTE_EXTERNAL_ERROR]', orchestratorSessionId, error);
    }
  }

  subscribe(listener: OpencodeEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async notify(payload: OpencodeEventListenerPayload) {
    for (const listener of this.listeners) {
      try {
        await listener(payload);
      } catch (error) {
        console.warn('[OPENCODE_REMOTE_NOTIFY_ERROR]', error);
      }
    }
  }

  private async syncDbSessionStatus(
    sessionId: string,
    status: 'completed' | 'failed'
  ) {
    try {
      await taskCreationSessionDAO.updateSessionStatus(sessionId, status);
    } catch (error) {
      console.warn('[OPENCODE_SESSION_STATUS_DB_SYNC_FAILED]', {
        sessionId,
        status,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async archiveCompletedTurn(input: {
    taskSessionId: string;
    orchestratorSessionId?: string;
    opencodeSessionId?: string;
    source: 'direct_completed' | 'managed_completed';
  }): Promise<void> {
    const orchestratorSessionId = asString(input.orchestratorSessionId);
    if (!orchestratorSessionId) {
      return;
    }
    try {
      await archiveSandboxWorkspace(
        orchestratorSessionId,
        `opencode_turn_completed:${input.taskSessionId}:${input.source}:${input.opencodeSessionId || 'unknown'}`
      );
    } catch (error) {
      console.warn('[OPENCODE_TURN_ARCHIVE_FAILED]', {
        taskSessionId: input.taskSessionId,
        orchestratorSessionId,
        opencodeSessionId: input.opencodeSessionId || undefined,
        source: input.source,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async replyPendingQuestionIfAny(input: {
    taskSessionId: string;
    content: string;
    orchestratorSessionId: string;
    opencodeSessionId: string;
    workspacePath: string;
    source?: 'user' | 'agent';
    clientMessageKey?: string;
  }): Promise<boolean> {
    if (!input.opencodeSessionId || input.source === 'agent') {
      return false;
    }

    let pendingQuestion: OpencodePendingQuestion | null = null;
    try {
      const questions = await osacAgentService.listOpencodeQuestions(input.orchestratorSessionId, {
        workspacePath: input.workspacePath || undefined,
      });
      pendingQuestion = findPendingOpencodeQuestion(
        questions as OpencodePendingQuestion[],
        input.opencodeSessionId
      );
    } catch (error) {
      console.warn('[OPENCODE_PENDING_QUESTION_LOOKUP_FAILED]', input.taskSessionId, error);
      return false;
    }

    const requestId = asString(pendingQuestion?.id);
    if (!requestId) {
      return false;
    }

    const answers = buildOpencodeQuestionAnswers(pendingQuestion?.questions, input.content);
    const session = await taskCreationFileMemoryStore.getSession(input.taskSessionId);

    await taskCreationFileMemoryStore.updateRuntimeBinding(input.taskSessionId, {
      orchestratorSessionId: input.orchestratorSessionId,
      opencodeSessionId: input.opencodeSessionId,
    });
    await taskCreationFileMemoryStore.updateSessionState(input.taskSessionId, {
      status: 'in_progress',
      stage: 'executing',
      phase: session?.phase ? (session.phase as any) : 'development',
      allowBackward: true,
    });
    await this.initRunArtifactsForPrompt(
      input.taskSessionId,
      input.orchestratorSessionId,
      input.opencodeSessionId
    );

    await osacAgentService.replyOpencodeQuestion(input.orchestratorSessionId, {
      requestId,
      answers,
      workspacePath: input.workspacePath || undefined,
    });

    const inputTimestamp = Date.now();
    if (input.clientMessageKey) {
      this.rememberClientPromptDispatch(input.taskSessionId, input.clientMessageKey, {
        orchestratorSessionId: input.orchestratorSessionId,
        opencodeSessionId: input.opencodeSessionId,
        content: input.content,
        dispatchedAt: inputTimestamp,
      });
    }
    await this.persistMessage(
      input.taskSessionId,
      'user',
      'opencode_user_input',
      input.content,
      {
        orchestratorSessionId: input.orchestratorSessionId,
        opencodeSessionId: input.opencodeSessionId,
        workspacePath: input.workspacePath,
        questionRequestId: requestId,
        answeredVia: 'opencode_question_reply',
        questionAnswers: answers,
        timestamp: inputTimestamp,
        sessionEventSeq: inputTimestamp * 1000,
        ...(input.clientMessageKey ? { clientMessageKey: input.clientMessageKey } : {}),
      }
    );

    auditOsacAction('OPENCODE_QUESTION_REPLY', {
      taskSessionId: input.taskSessionId,
      orchestratorSessionId: input.orchestratorSessionId,
      opencodeSessionId: input.opencodeSessionId,
      requestId,
    });

    await touchSandbox(input.orchestratorSessionId, 'opencode_question_reply');
    return true;
  }

  async sendUserInput(input: {
    taskSessionId: string;
    content: string;
    orchestratorSessionId?: string;
    workspacePath?: string;
    source?: 'user' | 'agent';
    clientMessageKey?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ orchestratorSessionId: string; opencodeSessionId: string }> {
    const taskSessionId = asString(input.taskSessionId);
    const content = String(input.content || '').trim();
    const clientMessageKey = asString(input.clientMessageKey);
    if (!taskSessionId) {
      throw new Error('taskSessionId is required');
    }
    if (!content) {
      throw new Error('content is required');
    }

    let runtime = await resolveRuntimeBinding(taskSessionId, input.orchestratorSessionId);
    if (!runtime) {
      runtime = await this.recoverRuntime(taskSessionId);
    }
    if (input.source !== 'agent' && clientMessageKey) {
      const rememberedDispatch = this.getRememberedClientPromptDispatch(taskSessionId, clientMessageKey, content);
      if (rememberedDispatch) {
        return {
          orchestratorSessionId: rememberedDispatch.orchestratorSessionId,
          opencodeSessionId: rememberedDispatch.opencodeSessionId,
        };
      }
      const persistedDispatch = await this.findPersistedClientPromptDispatch(taskSessionId, clientMessageKey, content);
      if (persistedDispatch) {
        return {
          orchestratorSessionId: persistedDispatch.orchestratorSessionId,
          opencodeSessionId: persistedDispatch.opencodeSessionId,
        };
      }
    }
    const currentSession = await taskCreationFileMemoryStore.getSession(taskSessionId);
    let preferredRecoveredOpencodeSessionId =
      asString(runtime?.opencodeSessionId) || asString(currentSession?.runtime?.opencodeSessionId) || undefined;
    const directSkillSelections = await this.prepareDirectResidentSkillSelections({
      taskSessionId,
      content,
      source: input.source,
      submittedSelections:
        input.metadata && Object.prototype.hasOwnProperty.call(input.metadata, 'skills')
          ? input.metadata.skills
          : undefined,
      pendingQuestion: currentSession?.pendingQuestion,
    });

    let orchestratorSessionId = runtime.orchestratorSessionId;
    const workspacePath = asString(input.workspacePath) || resolveOpencodeWorkspacePath(taskSessionId);
    const opencodeHost = asString(process.env.OPENCODE_SERVER_HOST) || undefined;
    const opencodePort = toPositiveInt(process.env.OPENCODE_SERVER_PORT);

    const maxAttempts = Math.max(
      2,
      Number(process.env.OPENCODE_DIRECT_INPUT_MAX_ATTEMPTS || 6)
    );
    const retryDelayMs = Math.max(
      1000,
      Number(process.env.OPENCODE_DIRECT_INPUT_RETRY_DELAY_MS || 3000)
    );

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const runtimeStatus = await resolveRuntimeFromEnvironment(orchestratorSessionId);
      if (!runtimeStatus.ready) {
        runtime = await this.recoverRuntime(taskSessionId);
        orchestratorSessionId = runtime.orchestratorSessionId;
      }

      try {
        return await this.withOpencodeLock(orchestratorSessionId, async () => {
          await this.ensureWorkspaceGit(orchestratorSessionId, workspacePath);
          await sandboxSkillSyncService.syncSelectedSkills({
            taskSessionId,
            orchestratorSessionId,
            skills: directSkillSelections.residentSkillSelections,
          });
          try {
            await taskSessionSkillStateService.markResidentSkillsMaterialized({
              sessionId: taskSessionId,
              sandboxId: orchestratorSessionId,
              workspaceRoot: workspacePath,
              residentSelections: directSkillSelections.residentSkillSelections,
            });
          } catch (error) {
            console.warn('[OPENCODE_DIRECT_SKILL_MEMORY_INIT_WARN]', {
              taskSessionId,
              orchestratorSessionId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
          await osacAgentService.ensureOpencodeServer(orchestratorSessionId, {
            workspacePath: workspacePath || undefined,
            host: opencodeHost,
            port: opencodePort,
          });
          await this.ensureWorkspaceBaseline(taskSessionId, orchestratorSessionId, workspacePath || '');

          const opencodeSessionId = await this.ensureUsableOpencodeSessionId({
            taskSessionId,
            orchestratorSessionId,
            workspacePath,
            currentOpencodeSessionId: runtime?.opencodeSessionId,
            preferredRecoveredOpencodeSessionId,
          });
          preferredRecoveredOpencodeSessionId = opencodeSessionId;

          const answeredPendingQuestion = await this.replyPendingQuestionIfAny({
            taskSessionId,
            content,
            orchestratorSessionId,
            opencodeSessionId,
            workspacePath,
            source: input.source,
            clientMessageKey: clientMessageKey || undefined,
          });
          if (answeredPendingQuestion) {
            return {
              orchestratorSessionId,
              opencodeSessionId,
            };
          }

          await osacAgentService.sendOpencodePrompt(orchestratorSessionId, {
            opencodeSessionId,
            workspacePath: workspacePath || undefined,
            parts: [{ type: 'text', text: content }],
          });
          const inputTimestamp = Date.now();
          if (input.source !== 'agent' && clientMessageKey) {
            this.rememberClientPromptDispatch(taskSessionId, clientMessageKey, {
              orchestratorSessionId,
              opencodeSessionId,
              content,
              dispatchedAt: inputTimestamp,
            });
          }
          const role = input.source === 'agent' ? 'agent' : 'user';
          const messageType = input.source === 'agent' ? 'opencode_agent_input' : 'opencode_user_input';
          await this.persistMessage(
            taskSessionId,
            role,
            messageType,
            content,
            {
              ...(input.metadata || {}),
              orchestratorSessionId,
              opencodeSessionId,
              workspacePath,
              timestamp: inputTimestamp,
              sessionEventSeq: inputTimestamp * 1000,
              ...(clientMessageKey ? { clientMessageKey } : {}),
            }
          );
          await this.initRunArtifactsForPrompt(taskSessionId, orchestratorSessionId, opencodeSessionId);
          await taskCreationFileMemoryStore.updateSessionState(taskSessionId, {
            status: 'in_progress',
            stage: 'executing',
            phase: currentSession?.phase ? (currentSession.phase as FlowPhase) : 'development',
            allowBackward: true,
          });
          try {
            await taskCreationSessionDAO.updateSessionStatus(taskSessionId, 'in_progress');
          } catch (error) {
            console.warn('[OPENCODE_SESSION_STATUS_DB_RESUME_FAILED]', {
              taskSessionId,
              orchestratorSessionId,
              opencodeSessionId,
              error: error instanceof Error ? error.message : String(error),
            });
          }

          auditOsacAction('OPENCODE_USER_INPUT', {
            taskSessionId,
            orchestratorSessionId,
            opencodeSessionId,
          });

          await touchSandbox(orchestratorSessionId, 'opencode_user_input');

          return {
            orchestratorSessionId,
            opencodeSessionId,
          };
        });
      } catch (error) {
        if (isSandboxNotFoundError(error) && attempt < maxAttempts) {
          await markSandboxClosed(orchestratorSessionId);
          runtime = await this.recoverRuntime(taskSessionId);
          orchestratorSessionId = runtime.orchestratorSessionId;
          await sleep(Math.min(10_000, retryDelayMs * attempt));
          continue;
        }

        if (isRetryableDirectInputError(error) && attempt < maxAttempts) {
          if (input.source !== 'agent' && clientMessageKey) {
            const rememberedDispatch = this.getRememberedClientPromptDispatch(taskSessionId, clientMessageKey, content);
            if (rememberedDispatch) {
              console.warn('[OPENCODE_DIRECT_INPUT_DUPLICATE_SUPPRESSED]', {
                taskSessionId,
                attempt,
                orchestratorSessionId: rememberedDispatch.orchestratorSessionId,
                opencodeSessionId: rememberedDispatch.opencodeSessionId,
                error: error instanceof Error ? error.message : String(error),
              });
              return {
                orchestratorSessionId: rememberedDispatch.orchestratorSessionId,
                opencodeSessionId: rememberedDispatch.opencodeSessionId,
              };
            }
          }
          console.warn('[OPENCODE_DIRECT_INPUT_RETRY]', {
            taskSessionId,
            attempt,
            maxAttempts,
            orchestratorSessionId,
            error: error instanceof Error ? error.message : String(error),
          });
          const reboundRuntime = await resolveRuntimeBinding(taskSessionId, orchestratorSessionId);
          if (reboundRuntime) {
            runtime = reboundRuntime;
            orchestratorSessionId = reboundRuntime.orchestratorSessionId;
          }
          await sleep(Math.min(10_000, retryDelayMs * attempt));
          continue;
        }
        throw error;
      }
    }

    throw new Error('无法发送 OpenCode 指令');
  }

  private async initRunArtifactsForPrompt(
    taskSessionId: string,
    orchestratorSessionId: string,
    opencodeSessionId: string
  ) {
    if (!taskSessionId || !opencodeSessionId) return;
    const session = await taskCreationFileMemoryStore.getSession(taskSessionId);
    if (!session) return;
    this.clearTextStreams(session.id, opencodeSessionId);
    this.finalizedRuns.delete(this.buildRunKey(session.id, opencodeSessionId));
    const now = await this.resolvePromptedAtSeed(taskSessionId, opencodeSessionId);
    const phaseAtStart = (session.phase as FlowPhase) || 'development';
    this.runArtifacts.set(this.buildRunKey(session.id, opencodeSessionId), {
      hasFileChange: false,
      hasFailure: false,
      missingArtifactNudges: 0,
      startedAt: now,
      promptedAt: now,
      completionInProgress: false,
      hasPlaywrightUsage: false,
      toolEvents: 0,
      commandEvents: 0,
      diffEvents: 0,
      todoEvents: 0,
      fileEvents: 0,
      textEvents: 0,
      assistantResponseObserved: false,
      nativeHistoryPollAttempts: 0,
      stableNativeHistoryPolls: 0,
      toolsUsed: new Set<string>(),
      phaseAtStart,
      cycleAtStart: session.phaseCycle ?? 0,
    });
    this.clearNativeHistoryPoll(this.buildRunKey(session.id, opencodeSessionId));
    this.touchStreamIdle(session.id, orchestratorSessionId, opencodeSessionId);
  }

  private async resolvePromptedAtSeed(taskSessionId: string, opencodeSessionId?: string): Promise<number> {
    const fallback = Date.now();
    try {
      const messages = await taskCreationFileMemoryStore.getMessages(taskSessionId);
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        const message = messages[i];
        if (
          message.messageType !== 'opencode_user_input' &&
          message.messageType !== 'user_input' &&
          message.messageType !== 'user_response'
        ) {
          continue;
        }
        const metadata = toRecord(message.metadata);
        const messageOpencodeSessionId = asString(metadata.opencodeSessionId);
        if (opencodeSessionId && message.messageType === 'opencode_user_input' && messageOpencodeSessionId) {
          if (messageOpencodeSessionId !== opencodeSessionId) {
            continue;
          }
        }
        const parsed = Date.parse(String(message.createdAt || ''));
        if (Number.isFinite(parsed) && parsed > 0) {
          return parsed;
        }
      }
    } catch {
      // ignore and fall back to current time
    }
    return fallback;
  }

  private async handleOsacMessage(orchestratorSessionId: string, message: OsacMessage) {
    if (
      message.type !== 'OPENCODE_EVENT' &&
      message.type !== 'OPENCODE_ERROR' &&
      message.type !== 'OPENCODE_PROMPT_ACCEPTED' &&
      message.type !== 'OPENCODE_SESSION_READY'
    ) {
      return;
    }

    await touchSandbox(orchestratorSessionId, 'opencode_event');

    const payload = toRecord(message.payload);
    let event = toRecord(payload.event);
    const session = await this.resolveTargetSession(orchestratorSessionId, payload, event, {
      requireOpencodeSessionId: message.type === 'OPENCODE_EVENT',
    });
    if (!session) {
      return;
    }

    if (message.type === 'OPENCODE_SESSION_READY') {
      const opencodeSessionId = asString(payload.opencodeSessionId);
      if (opencodeSessionId) {
        await taskCreationFileMemoryStore.updateRuntimeBinding(session.id, {
          orchestratorSessionId,
          opencodeSessionId,
        });

        await taskCreationFileMemoryStore.updateSessionState(session.id, {
          status: 'in_progress',
          stage: 'executing',
        });

        if (!this.isDirectSession(session)) {
          const content = 'OpenCode 会话已建立，正在等待执行事件...';
          await this.persistMessage(
            session.id,
            'agent',
            'opencode_status',
            content,
            {
              orchestratorSessionId,
              opencodeSessionId,
            }
          );

          await this.notify({
            taskSessionId: session.id,
            message: {
              type: 'status_update',
              content,
              metadata: {
                orchestratorSessionId,
                opencodeSessionId,
              },
            },
          });
        }
      }
      return;
    }

    if (message.type === 'OPENCODE_PROMPT_ACCEPTED') {
      const opencodeSessionId = asString(payload.opencodeSessionId) || session.runtime?.opencodeSessionId || '';
      if (opencodeSessionId) {
        await taskCreationFileMemoryStore.updateRuntimeBinding(session.id, {
          orchestratorSessionId,
          opencodeSessionId,
        });
        const runKey = this.buildRunKey(session.id, opencodeSessionId);
        const hadFinalized = this.finalizedRuns.has(runKey);
        const lateCompletionAck =
          hadFinalized &&
          (session.stage === 'completed' ||
            session.status === 'completed');
        if (lateCompletionAck) {
          return;
        }
        // 同一 OpenCode session 会承载多轮对话。新一轮 prompt 被接受时，无论事件是否乱序，
        // 都必须先清掉上一轮的 finalized 标记，否则后续 session.idle 会被直接短路。
        this.finalizedRuns.delete(runKey);
        this.clearNativeHistoryPoll(runKey);
        const existingArtifact = this.runArtifacts.get(runKey);
        if (!existingArtifact) {
          this.clearTextStreams(session.id, opencodeSessionId);
          const now = await this.resolvePromptedAtSeed(session.id, opencodeSessionId);
          const phaseAtStart = (session.phase as FlowPhase) || 'development';
          this.runArtifacts.set(runKey, {
            hasFileChange: false,
            hasFailure: false,
            missingArtifactNudges: 0,
            startedAt: now,
            promptedAt: now,
            completionInProgress: false,
            hasPlaywrightUsage: false,
            toolEvents: 0,
            commandEvents: 0,
            diffEvents: 0,
            todoEvents: 0,
            fileEvents: 0,
            textEvents: 0,
            assistantResponseObserved: false,
            nativeHistoryPollAttempts: 0,
            stableNativeHistoryPolls: 0,
            toolsUsed: new Set<string>(),
            phaseAtStart,
            cycleAtStart: session.phaseCycle ?? 0,
          });
        }
        this.touchStreamIdle(session.id, orchestratorSessionId, opencodeSessionId);
        this.scheduleNativeHistoryPoll(session.id, orchestratorSessionId, opencodeSessionId);
        if (!hadFinalized) {
          await taskCreationFileMemoryStore.updateSessionState(session.id, {
            status: 'in_progress',
            stage: 'executing',
            phase: session.phase ? (session.phase as any) : 'development',
          });
        }
      } else {
        await taskCreationFileMemoryStore.updateSessionState(session.id, {
          status: 'in_progress',
          stage: 'executing',
          phase: session.phase ? (session.phase as any) : 'development',
        });
      }

      if (!this.isDirectSession(session)) {
        const content = 'OpenCode 已接收指令，正在执行并回传实时事件...';
        await this.persistMessage(
          session.id,
          'agent',
          'opencode_status',
          content,
          {
            ...payload,
            orchestratorSessionId,
            opencodeSessionId: opencodeSessionId || undefined,
          }
        );

        await this.notify({
          taskSessionId: session.id,
          message: {
            type: 'status_update',
            content,
            metadata: {
              ...payload,
              orchestratorSessionId,
              opencodeSessionId: opencodeSessionId || undefined,
            },
          },
        });
      }
      return;
    }

    if (message.type === 'OPENCODE_ERROR') {
      const rawMessage = asString(payload.message) || 'OpenCode 远程执行失败';
      if (isSandboxNotFoundError(rawMessage)) {
        await markSandboxClosed(orchestratorSessionId);
        await taskCreationCacheStore.invalidateWorkspaceBySession(session.id);
        await taskSessionRedisCacheService.invalidateWorkspaceBySessionId(session.id);
        return;
      }
      if (isRecoverableEventSubscribeError(payload, rawMessage)) {
        await taskCreationFileMemoryStore.updateSessionState(session.id, {
          status: 'in_progress',
          stage: 'executing',
          phase: session.phase ? (session.phase as any) : 'development',
          allowBackward: true,
        });
        await this.notify({
          taskSessionId: session.id,
          message: {
            type: 'status_update',
            content: `正在连接智能体...`,
            stage: 'executing',
            tone: 'execution',
            metadata: {
              ...payload,
              orchestratorSessionId,
              opencodeSessionId: asString(payload.opencodeSessionId) || session.runtime?.opencodeSessionId || undefined,
              source: 'opencode_event_stream_retry',
            },
          },
        });
        void osacAgentService.ensureOpencodeServer(orchestratorSessionId, {
          workspacePath: resolveOpencodeWorkspacePath(session.id) || undefined,
        }).catch((error) => {
          console.warn('[OPENCODE_EVENT_STREAM_RESTART_FAILED]', {
            sessionId: session.id,
            orchestratorSessionId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
        return;
      }
      const content = rawMessage;
      const opencodeSessionId = asString(payload.opencodeSessionId) || session.runtime?.opencodeSessionId;
      const runKey = opencodeSessionId ? this.buildRunKey(session.id, opencodeSessionId) : '';
      if (
        (runKey && this.finalizedRuns.has(runKey)) ||
        (session.stage === 'completed' && isBenignOpencodeTerminationMessage(content))
      ) {
        if (opencodeSessionId) {
          this.clearStreamIdleTimer(this.buildStreamIdleKey(session.id, opencodeSessionId));
        }
        if (runKey) {
          this.clearNativeHistoryPoll(runKey);
          this.runArtifacts.delete(runKey);
        }
        return;
      }
      if (opencodeSessionId) {
        this.clearStreamIdleTimer(this.buildStreamIdleKey(session.id, opencodeSessionId));
        this.finalizedRuns.add(runKey);
        this.clearNativeHistoryPoll(runKey);
      }
      await this.flushTextStreams(
        session.id,
        orchestratorSessionId,
        opencodeSessionId || undefined,
        { persistMode: 'all' }
      );

      await taskCreationFileMemoryStore.updateSessionState(session.id, {
        status: 'failed',
        stage: 'failed',
      });
      await this.syncDbSessionStatus(session.id, 'failed');

      await this.persistMessage(
        session.id,
        'agent',
        'opencode_error',
        content,
        {
          ...payload,
          orchestratorSessionId,
          opencodeSessionId: opencodeSessionId || undefined,
        }
      );

      await this.notify({
        taskSessionId: session.id,
        message: {
          type: 'error',
          content,
          metadata: {
            ...payload,
            orchestratorSessionId,
            opencodeSessionId: opencodeSessionId || undefined,
            source: 'opencode_error',
          },
        },
      });

      await this.notify({
        taskSessionId: session.id,
        message: {
          type: 'status_update',
          content: 'OpenCode 执行已结束',
          stage: 'failed',
          tone: 'error',
          metadata: {
            ...payload,
            orchestratorSessionId,
            opencodeSessionId: opencodeSessionId || undefined,
            source: 'opencode_error',
          },
        },
      });
      if (runKey) {
        this.runArtifacts.delete(runKey);
      }
      await this.flushPersistenceBarrier('opencode_error');
      return;
    }

    const eventType = asString(payload.eventType) || asString((toRecord(payload.event)).type) || 'unknown';
    const opencodeSessionId =
      asString(payload.opencodeSessionId) ||
      pickSessionIdFromEvent(event) ||
      '';
    const enrichedEvent = this.enrichEventRole(
      session.id,
      opencodeSessionId || undefined,
      event
    );
    payload.event = enrichedEvent;
    event = enrichedEvent;
    if (opencodeSessionId) {
      this.touchStreamIdle(session.id, orchestratorSessionId, opencodeSessionId);
    }
    if (session.stage !== 'executing' && session.stage !== 'reviewing' && session.stage !== 'completed' && session.stage !== 'failed') {
      await taskCreationFileMemoryStore.updateSessionState(session.id, {
        status: 'in_progress',
        stage: 'executing',
        phase: session.phase ? (session.phase as any) : 'development',
      });
    }
    const eventProps = normalizeRecord(event.properties);
    const shouldFetchDiff =
      eventType === 'session.diff' &&
      opencodeSessionId &&
      (!Array.isArray(eventProps.diff) || isEmptyDiff(eventProps.diff));
    if (shouldFetchDiff) {
      try {
        const diffReply = await osacAgentService.getSessionDiff(orchestratorSessionId, opencodeSessionId);
        const diffPayload = toRecord(diffReply);
        const diffItems = diffPayload.diff;
        if (Array.isArray(diffItems) && diffItems.length > 0) {
          eventProps.diff = diffItems;
          event.properties = eventProps;
          payload.event = event;
        }
      } catch (error) {
        console.warn('[OPENCODE_SESSION_DIFF_FETCH_FAILED]', error);
      }
    }
    const partRecord = normalizeRecord(eventProps.part);
    const partType = extractPartType(event);
    const toolName = asString(partRecord.tool).toLowerCase();

    if (shouldInvalidateWorkspaceCache(eventType, toolName)) {
      await taskCreationCacheStore.invalidateWorkspaceBySession(session.id);
      await taskSessionRedisCacheService.invalidateWorkspaceBySessionId(session.id);
    }

    let outcome = detectOpencodeOutcome(eventType, payload);
    let runArtifactForOutcome: RunArtifact | null = null;
    if (opencodeSessionId) {
      const runKey = this.buildRunKey(session.id, opencodeSessionId);
      runArtifactForOutcome = this.getRunArtifact(runKey);
      const errorMessage = extractOpencodeErrorMessage(payload);
      if (eventType === 'session.error' || outcome === 'failed') {
        runArtifactForOutcome.hasFailure = true;
        if (errorMessage) {
          runArtifactForOutcome.failureMessage = errorMessage;
        }
      }
      if (outcome === 'completed' && runArtifactForOutcome.hasFailure) {
        outcome = 'failed';
      }
    }

    const textStream = this.extractTextStreamPayload(payload, eventType);
    if (textStream) {
      const stream = this.upsertTextStream({
        taskSessionId: session.id,
        orchestratorSessionId,
        opencodeSessionId: textStream.opencodeSessionId,
        partId: textStream.partId,
        text: textStream.text,
        delta: textStream.delta,
        updatedAt: Number(payload.timestamp) || Date.now(),
      });

      if (stream.resetFrom) {
        const resetMetadata: Record<string, unknown> = {
          orchestratorSessionId,
          opencodeSessionId: textStream.opencodeSessionId,
          eventType: 'message.final',
          stream: false,
          source: 'stream_segment',
          streamKey: stream.streamKey,
          partId: textStream.partId,
        };
        // 仅落盘，不广播，避免实时界面重复刷新，但保证刷新后可回放。
        await this.persistMessage(
          session.id,
          'agent',
          'opencode_event',
          stream.resetFrom,
          resetMetadata
        );
      }

      if (textStream.opencodeSessionId) {
        const runKey = this.buildRunKey(session.id, textStream.opencodeSessionId);
        const artifact = this.getRunArtifact(runKey);
        artifact.textEvents += 1;
        if (stream.text) {
          artifact.lastText = stream.text.slice(-800);
          artifact.assistantResponseObserved = true;
        }
        console.info('[OPENCODE_TEXT_STREAM_EVENT]', {
          taskSessionId: session.id,
          orchestratorSessionId,
          opencodeSessionId: textStream.opencodeSessionId,
          eventType,
          partId: textStream.partId,
          delta: stream.delta || null,
          text: stream.text.slice(-120),
          textEvents: artifact.textEvents,
          promptedAt: artifact.promptedAt,
        });
      }

      const eventPreview = buildEventPreview(event);
      const streamTimestamp = Number(payload.timestamp) || Date.now();
      const metadata: Record<string, unknown> = {
        orchestratorSessionId,
        opencodeSessionId: textStream.opencodeSessionId,
        eventType,
        seq: payload.seq,
        timestamp: streamTimestamp,
        event: eventPreview,
        rawPayload: buildRawPayloadPreview(eventType, eventPreview),
        stream: true,
        streamKey: stream.streamKey,
        partId: textStream.partId,
      };

      this.streamBroadcastMeta.set(stream.streamKey, metadata);
      // 直通/实时增量：优先推送当前片段，避免等待广播节流。
      const immediateContent = stream.delta || stream.text;
      if (immediateContent) {
        const immediateMeta = {
          ...metadata,
          streamDelta: Boolean(stream.delta),
          source: stream.delta ? 'stream_delta' : metadata.source,
        };
        void this.notify({
          taskSessionId: session.id,
          message: {
            type: 'opencode_event',
            content: immediateContent,
            metadata: immediateMeta,
          },
        });
      }
      if (this.isDirectSession(session)) {
        // 直通模式下也要保留 checkpoint，保证前端断线重连后可补齐中途流式内容。
        this.scheduleStreamCheckpoint(
          session.id,
          orchestratorSessionId,
          textStream.opencodeSessionId,
          stream.streamKey
        );
        if (!outcome) {
          return;
        }
      } else {
        this.scheduleStreamBroadcast(session.id, stream.streamKey);
        this.scheduleStreamCheckpoint(session.id, orchestratorSessionId, textStream.opencodeSessionId, stream.streamKey);
        if (!outcome) {
          return;
        }
      }
    }

    const summary = summarizeOpencodeEvent(eventType, payload);

    const isPartUpdate =
      (eventType === 'message.part.updated' || eventType === 'message.part.delta') && partType;
    const isNonTextPartUpdate =
      isPartUpdate && partType === 'tool' && (!toolName || toolName !== 'todoread');

    const shouldPersist =
      eventType === 'message.final' ||
      eventType === 'command.executed' ||
      eventType === 'file.edited' ||
      eventType === 'file.watcher.updated' ||
      eventType === 'todo.updated' ||
      eventType === 'session.diff' ||
      eventType === 'session.error' ||
      eventType.startsWith('pty.') ||
      isNonTextPartUpdate ||
      summary.startsWith('[Tool]') ||
      summary.startsWith('[Command]') ||
      summary.startsWith('[File]') ||
      summary.startsWith('[PTY]');

    if (opencodeSessionId) {
      await taskCreationFileMemoryStore.updateRuntimeBinding(session.id, {
        orchestratorSessionId,
        opencodeSessionId,
      });
    }

    const eventPreview = buildEventPreview(event);
    const eventTimestamp = Number(payload.timestamp) || Date.now();
    const metadata: Record<string, unknown> = {
      orchestratorSessionId,
      opencodeSessionId: opencodeSessionId || undefined,
      eventType,
      seq: payload.seq,
      timestamp: eventTimestamp,
      event: eventPreview,
      rawPayload: buildRawPayloadPreview(eventType, eventPreview),
    };
    if (runArtifactForOutcome?.failureMessage) {
      metadata.errorMessage = runArtifactForOutcome.failureMessage;
    }
    if (
      outcome === 'completed' &&
      (runArtifactForOutcome?.hasFailure || asString(metadata.errorMessage))
    ) {
      outcome = 'failed';
    }

    if (opencodeSessionId) {
      const runKey = this.buildRunKey(session.id, opencodeSessionId);
      const artifact = this.getRunArtifact(runKey);
      const workspaceRoot = resolveOpencodeWorkspacePath(session.id) || '';
      const summaryLower = summary.toLowerCase();
      const eventLower = eventType.toLowerCase();
      const isPlaywrightTool =
        toolName.startsWith('playwright') ||
        eventLower.startsWith('playwright_') ||
        eventLower.startsWith('playwright.') ||
        summaryLower.includes('playwright_browser_') ||
        summaryLower.includes('[tool] playwright_') ||
        summaryLower.includes('[tool] playwright ');
      if (isPlaywrightTool) {
        artifact.hasPlaywrightUsage = true;
      }
      if (toolName) {
        artifact.toolsUsed.add(toolName);
        artifact.toolEvents += 1;
      }
      if (eventType === 'command.executed' || eventType.startsWith('pty.')) {
        artifact.commandEvents += 1;
      }
      if (eventType === 'message.final' && summary && !summary.startsWith('[OpenCode]')) {
        artifact.assistantResponseObserved = true;
        artifact.lastText = summary.slice(-800);
      }
      if (eventType === 'session.diff') {
        artifact.diffEvents += 1;
      }
      if (eventType === 'todo.updated') {
        artifact.todoEvents += 1;
      }
      let hasWorkspaceChange = false;
      const isFileEvent = eventType.startsWith('file.');
      if (isFileEvent) {
        hasWorkspaceChange = true;
        artifact.fileEvents += 1;
      } else if (eventType === 'file.edited' || eventType === 'file.watcher.updated') {
        const paths = extractFilePathsFromEvent(eventProps, event);
        hasWorkspaceChange = paths.some((path) => isWorkspaceFilePath(path, workspaceRoot));
      } else if (eventType === 'session.diff') {
        hasWorkspaceChange = diffHasWorkspaceChange(eventProps.diff, workspaceRoot);
      }
      if (!hasWorkspaceChange && isPartUpdate && partType === 'tool') {
        const toolLower = toolName.toLowerCase();
        if (toolLower === 'write' || toolLower === 'apply_patch') {
          hasWorkspaceChange = true;
        }
      }
      if (!hasWorkspaceChange) {
        const summaryLower = summary.toLowerCase();
        if (summaryLower.includes('[file]') || summaryLower.includes('写入文件')) {
          hasWorkspaceChange = true;
        }
      }
      if (hasWorkspaceChange) {
        artifact.hasFileChange = true;
        this.sessionArtifactsSeen.add(session.id);
        const nextRevision = (this.sessionArtifactRevision.get(session.id) || 0) + 1;
        this.sessionArtifactRevision.set(session.id, nextRevision);
        void markSandboxDirty(orchestratorSessionId, `opencode_${eventType || 'workspace_change'}`).catch((error) => {
          console.warn('[OPENCODE_MARK_DIRTY_FAILED]', orchestratorSessionId, error);
        });
        metadata.pendingArchiveUpdate = true;
      }
    }

    if (shouldPersist && !this.isDirectSession(session)) {
      await this.persistMessage(
        session.id,
        'agent',
        'opencode_event',
        summary,
        metadata
      );

      await this.notify({
        taskSessionId: session.id,
        message: {
          type: 'opencode_event',
          content: summary,
          metadata,
        },
      });
    }

    if (outcome === 'completed' && session.stage !== 'completed') {
      const runOpencodeSessionId = opencodeSessionId || session.runtime?.opencodeSessionId || 'unknown';
      const runKey = this.buildRunKey(session.id, runOpencodeSessionId);
      if (this.finalizedRuns.has(runKey)) {
        return;
      }

      const isDirect = this.isDirectSession(session);
      let aggregated: string | null = null;
      if (isDirect) {
        const artifact = this.getRunArtifact(runKey);
        const liveSnapshots = this.getLiveTextStreamSnapshots(session.id, opencodeSessionId || undefined);
        const liveAggregated = liveSnapshots[liveSnapshots.length - 1]?.content || null;
        console.info('[OPENCODE_DIRECT_COMPLETION_PRECHECK]', {
          taskSessionId: session.id,
          orchestratorSessionId,
          opencodeSessionId: runOpencodeSessionId,
          eventType,
          outcome,
          liveAggregated: liveAggregated ? liveAggregated.slice(-120) : null,
          assistantResponseObserved: artifact.assistantResponseObserved,
          textEvents: artifact.textEvents,
          promptedAt: artifact.promptedAt,
        });
        if (liveAggregated) {
          artifact.assistantResponseObserved = true;
          artifact.lastText = liveAggregated.slice(-800);
        }
        const syncResult = await this.syncNativeHistoryDelta({
          taskSessionId: session.id,
          orchestratorSessionId,
          opencodeSessionId: runOpencodeSessionId,
          promptedAt: artifact.promptedAt,
        });
        if (syncResult.assistantObserved) {
          artifact.assistantResponseObserved = true;
        }
        if (syncResult.latestAssistantText) {
          artifact.lastText = syncResult.latestAssistantText.slice(-800);
        }
        console.info('[OPENCODE_DIRECT_COMPLETION_NATIVE_SYNC]', {
          taskSessionId: session.id,
          orchestratorSessionId,
          opencodeSessionId: runOpencodeSessionId,
          assistantObserved: syncResult.assistantObserved,
          hasActiveAssistantParts: syncResult.hasActiveAssistantParts,
          persistedCount: syncResult.persistedCount,
          latestAssistantSignature: syncResult.latestAssistantSignature || null,
        });
        if (syncResult.hasActiveAssistantParts) {
          artifact.stableNativeHistoryPolls = 0;
          artifact.lastNativeAssistantSignature = syncResult.latestAssistantSignature;
        }
        if (!artifact.assistantResponseObserved || syncResult.hasActiveAssistantParts) {
          artifact.completionInProgress = false;
          this.scheduleNativeHistoryPoll(session.id, orchestratorSessionId, runOpencodeSessionId, 1000);
          await this.notify({
            taskSessionId: session.id,
            message: {
              type: 'status_update',
              content: syncResult.hasActiveAssistantParts ? 'OpenCode 仍在输出，继续等待完成...' : '正在同步智能体回复...',
              stage: 'executing',
              tone: 'execution',
              metadata: {
                ...metadata,
                outcome,
                source: syncResult.hasActiveAssistantParts
                  ? 'direct_waiting_active_assistant_parts'
                  : 'direct_waiting_native_history',
              },
            },
          });
          return;
        }
        aggregated = await this.flushTextStreams(
          session.id,
          orchestratorSessionId,
          opencodeSessionId || undefined,
          { persistMode: 'all' }
        );
        if (aggregated) {
          artifact.lastText = aggregated.slice(-800);
        }
        this.finalizedRuns.add(runKey);
        this.clearNativeHistoryPoll(runKey);
        if (runOpencodeSessionId) {
          this.clearStreamIdleTimer(this.buildStreamIdleKey(session.id, runOpencodeSessionId));
        }
        void this.archiveCompletedTurn({
          taskSessionId: session.id,
          orchestratorSessionId,
          opencodeSessionId: runOpencodeSessionId,
          source: 'direct_completed',
        }).then(() => {
          console.info('[OPENCODE_DIRECT_COMPLETION_ARCHIVED]', {
            taskSessionId: session.id,
            orchestratorSessionId,
            opencodeSessionId: runOpencodeSessionId,
          });
        });
        await taskCreationFileMemoryStore.updateSessionState(session.id, {
          status: 'completed',
          stage: 'completed',
          phase: session.phase === 'delivery' ? 'delivery' : (session.phase as any) || 'delivery',
        });
        console.info('[OPENCODE_DIRECT_COMPLETION_MEMORY_STATE_UPDATED]', {
          taskSessionId: session.id,
          orchestratorSessionId,
          opencodeSessionId: runOpencodeSessionId,
        });
        await this.syncDbSessionStatus(session.id, 'completed');
        console.info('[OPENCODE_DIRECT_COMPLETION_DB_STATE_UPDATED]', {
          taskSessionId: session.id,
          orchestratorSessionId,
          opencodeSessionId: runOpencodeSessionId,
        });
        await this.persistMessage(
          session.id,
          'agent',
          'opencode_status',
          'OpenCode 执行完成',
          {
            ...metadata,
            outcome,
            source: 'direct_completed',
          }
        );
        console.info('[OPENCODE_DIRECT_COMPLETION_STATUS_PERSISTED]', {
          taskSessionId: session.id,
          orchestratorSessionId,
          opencodeSessionId: runOpencodeSessionId,
        });
        await this.flushPersistenceBarrier('direct_completed');
        await this.notify({
          taskSessionId: session.id,
          message: {
            type: 'status_update',
            content: 'OpenCode 执行完成',
            stage: 'completed',
            tone: 'execution',
            metadata: {
              ...metadata,
              outcome,
              source: 'direct_completed',
            },
          },
        });
        artifact.completionInProgress = false;
        this.runArtifacts.delete(runKey);
        return;
      }
      aggregated = await this.flushTextStreams(
        session.id,
        orchestratorSessionId,
        opencodeSessionId || undefined,
        { persistMode: 'all' }
      );
      const currentPhase = (session.phase as FlowPhase) || 'development';
      let phaseForReview: FlowPhase = currentPhase;
      const artifact = this.getRunArtifact(runKey);
      if (aggregated) {
        artifact.assistantResponseObserved = true;
      }
      if (!artifact.hasPlaywrightUsage && aggregated) {
        const lower = aggregated.toLowerCase();
        if (lower.includes('playwright') || lower.includes('自动化测试')) {
          artifact.hasPlaywrightUsage = true;
        }
      }
      const enableLlmTestDetection =
        String(process.env.OPENCODE_TEST_DETECTION_LLM || 'true').trim().toLowerCase() !== 'false';
      if (!artifact.hasPlaywrightUsage && enableLlmTestDetection && !artifact.testDetectionAttempted) {
        const combined = [aggregated || '', artifact.lastText || ''].join('\n').trim();
        const lower = combined.toLowerCase();
        if (lower.includes('playwright') || lower.includes('自动化测试') || lower.includes('测试脚本')) {
          artifact.testDetectionAttempted = true;
          try {
            const snippet = combined.length > 4000 ? combined.slice(-4000) : combined;
            const detection = await playwrightTestDetectionAgent.detect(snippet);
            if (detection.tested && detection.confidence >= 0.6) {
              artifact.hasPlaywrightUsage = true;
            }
          } catch (error) {
            console.warn('[OPENCODE_TEST_DETECTION_FAILED]', error);
          }
        }
      }
      if (artifact.completionInProgress) {
        return;
      }
      artifact.completionInProgress = true;
      if (payload.timestamp && Number(payload.timestamp) < artifact.promptedAt) {
        artifact.completionInProgress = false;
        return;
      }
      if (artifact.phaseAtStart && artifact.phaseAtStart !== currentPhase) {
        artifact.completionInProgress = false;
        return;
      }
      const workspaceRoot = resolveOpencodeWorkspacePath(session.id) || '';
      const context = await this.resolveReviewContext(session.id);
      const artifactKind = resolveArtifactKind(context?.taskDescription?.additional_info?.artifactKind);

      if ((currentPhase === 'development' || currentPhase === 'repair') && artifact && !artifact.hasFileChange) {
        if (orchestratorSessionId && workspaceRoot) {
          try {
            if (
              await this.detectWorkspaceArtifactsAfterBaseline(
                session.id,
                orchestratorSessionId,
                workspaceRoot,
                artifactKind
              )
            ) {
              artifact.hasFileChange = true;
              this.sessionArtifactsSeen.add(session.id);
            }
          } catch (error) {
            console.warn('[OPENCODE_ARTIFACT_SCAN_FAILED]', error);
          }
        }
      }

      const sessionHasArtifacts = this.sessionArtifactsSeen.has(session.id);
      let workspaceHasMeaningfulArtifacts = false;
      if (orchestratorSessionId && workspaceRoot) {
        try {
          workspaceHasMeaningfulArtifacts = await this.hasCurrentMeaningfulArtifacts(
            orchestratorSessionId,
            workspaceRoot,
            artifactKind
          );
        } catch (error) {
          console.warn('[OPENCODE_MEANINGFUL_ARTIFACT_SCAN_FAILED]', error);
        }
      }
      let hasArtifacts = workspaceHasMeaningfulArtifacts;
      const revision = this.sessionArtifactRevision.get(session.id) || 0;
      if (artifact.hasPlaywrightUsage) {
        this.sessionTestedRevision.set(session.id, revision);
      }
      const testedRevision = this.sessionTestedRevision.get(session.id) || 0;

      const hasAnyActivity =
        artifact.fileEvents > 0 ||
        artifact.toolEvents > 0 ||
        artifact.commandEvents > 0 ||
        artifact.todoEvents > 0 ||
        artifact.diffEvents > 0 ||
        artifact.textEvents > 0 ||
        Boolean(aggregated);

      if (currentPhase === 'development' || currentPhase === 'repair') {
        if (workspaceHasMeaningfulArtifacts && !artifact.hasFileChange) {
          artifact.hasFileChange = true;
          if (!sessionHasArtifacts) {
            this.sessionArtifactsSeen.add(session.id);
          }
          hasArtifacts = true;
        }
        if (!hasArtifacts) {
          const nudged = this.sessionNoArtifactNudges.get(session.id) || 0;
          const shouldNudge = artifact.missingArtifactNudges < 1 && nudged < 1;
          if (shouldNudge) {
            artifact.missingArtifactNudges += 1;
            this.sessionNoArtifactNudges.set(session.id, nudged + 1);
            const validationMode = context ? resolveValidationMode(context) : 'browser';
            await this.emitPhaseStatus({
              sessionId: session.id,
              phase: currentPhase,
              message: '未检测到交付物产出，已尝试重新唤醒执行，请稍候。',
              stage: 'executing',
              tone: 'execution',
              metadata: {
                ...metadata,
                outcome,
                reason: 'no_artifacts_retry',
              },
            });
            const followUp = buildNoArtifactFollowUp(validationMode);
            await this.sendUserInput({
              taskSessionId: session.id,
              content: followUp,
              orchestratorSessionId,
              workspacePath: workspaceRoot || undefined,
              source: 'agent',
            });
            if (runOpencodeSessionId) {
              this.touchStreamIdle(session.id, orchestratorSessionId, runOpencodeSessionId);
            }
            artifact.completionInProgress = false;
            return;
          }

          this.finalizedRuns.add(runKey);
          this.clearNativeHistoryPoll(runKey);
          if (runOpencodeSessionId) {
            this.clearStreamIdleTimer(this.buildStreamIdleKey(session.id, runOpencodeSessionId));
          }
          await this.emitPhaseStatus({
            sessionId: session.id,
            phase: currentPhase,
            message: '未检测到交付物产出，已暂停自动测试，请检查需求或继续开发。',
            stage: 'reviewing',
            tone: 'review',
            metadata: {
              ...metadata,
              outcome,
              reason: 'no_artifacts',
            },
          });
          artifact.completionInProgress = false;
          return;
        }

        const lastDispatchedRevision = this.sessionTestDispatchedRevision.get(session.id) ?? -1;
        if (!artifact.hasPlaywrightUsage && hasArtifacts && revision > testedRevision && lastDispatchedRevision !== revision) {
          this.finalizedRuns.add(runKey);
          this.clearNativeHistoryPoll(runKey);
          if (runOpencodeSessionId) {
            this.clearStreamIdleTimer(this.buildStreamIdleKey(session.id, runOpencodeSessionId));
          }
          await taskCreationFileMemoryStore.updateSessionState(session.id, {
            status: 'in_progress',
            stage: 'reviewing',
          });

          const validationMode = context ? resolveValidationMode(context) : 'browser';
          await this.emitPhaseStatus({
            sessionId: session.id,
            phase: 'testing',
            message: validationMode === 'browser' ? '正在执行自动化测试...' : '正在执行任务类型验证...',
            stage: 'reviewing',
            tone: 'review',
            metadata: {
              ...metadata,
              outcome,
            },
          });
          this.sessionTestDispatchedRevision.set(session.id, revision);

          const runSummary = await this.resolveLatestRunSummary(session.id);
          if (context) {
            if (validationMode === 'browser') {
              await osacAgentService.ensurePlaywrightMcp(orchestratorSessionId);
              try {
                await ensureNekoDebug(orchestratorSessionId);
              } catch (error) {
                if (isSandboxNotFoundError(error)) {
                  await markSandboxClosed(orchestratorSessionId);
                  return;
                }
                console.warn('[OPENCODE_NEKO_START_FAILED]', error);
              }
            }
            const testPrompt =
              validationMode === 'browser'
                ? buildPlaywrightTestPrompt({
                    userInput: context.userInput || '（未提供用户输入）',
                    taskDescription: context.taskDescription,
                    executionPlan: context.executionPlan,
                    lastOutput: aggregated || undefined,
                    runSummary: runSummary || undefined,
                  })
                : buildGenericTestPrompt({
                    userInput: context.userInput || '（未提供用户输入）',
                    taskDescription: context.taskDescription,
                    executionPlan: context.executionPlan,
                    lastOutput: aggregated || undefined,
                    runSummary: runSummary || undefined,
                  });
            await this.sendUserInput({
              taskSessionId: session.id,
              content: testPrompt,
              orchestratorSessionId,
              workspacePath: resolveOpencodeWorkspacePath(session.id) || undefined,
              source: 'agent',
            });
          }
          artifact.completionInProgress = false;
          return;
        }

        if (artifact.hasPlaywrightUsage || (hasArtifacts && testedRevision >= revision && revision > 0)) {
          await this.emitPhaseStatus({
            sessionId: session.id,
            phase: 'testing',
            message: '检测到开发阶段已执行自动化测试，正在审查测试结果...',
            stage: 'reviewing',
            tone: 'review',
            metadata: {
              ...metadata,
              outcome,
              embeddedTesting: true,
            },
          });
          phaseForReview = 'testing';
        }
      }

      this.finalizedRuns.add(runKey);
      this.clearNativeHistoryPoll(runKey);
      if (runOpencodeSessionId) {
        this.clearStreamIdleTimer(this.buildStreamIdleKey(session.id, runOpencodeSessionId));
      }

      const lastOutput = aggregated || (await this.resolveLatestOutput(session.id));
      const runSummary = this.formatRunSummary(artifact, lastOutput || '');
      await this.persistMessage(
        session.id,
        'agent',
        'agent_message',
        runSummary,
        {
          summaryType: 'run_summary',
          phase: currentPhase,
          phaseCycle: session.phaseCycle ?? 0,
          orchestratorSessionId,
          opencodeSessionId: opencodeSessionId || undefined,
          runKey,
          hasPlaywrightUsage: artifact.hasPlaywrightUsage,
          hasFileChange: artifact.hasFileChange,
        }
      );
      const reviewResult = await this.runReviewGate({
        session,
        orchestratorSessionId,
        opencodeSessionId: opencodeSessionId || undefined,
        executionOutput: lastOutput || '（无输出）',
      });

      if (phaseForReview === 'testing' && reviewResult.status === 'retry') {
        const context = await this.resolveReviewContext(session.id);
        const runSummary = await this.resolveLatestRunSummary(session.id);
        const feedbackPrompt =
          context && reviewResult.nextInstructions
            ? buildReviewFeedbackPrompt({
                userInput: context.userInput || '（未提供用户输入）',
                taskDescription: context.taskDescription,
                executionPlan: context.executionPlan,
                lastOutput: lastOutput || '（无输出）',
                feedback: reviewResult.nextInstructions,
                runSummary: runSummary || undefined,
                validationMode: resolveValidationMode(context),
              })
            : '';

        await taskCreationFileMemoryStore.updateSessionState(session.id, {
          status: 'in_progress',
          stage: 'executing',
        });

        await this.emitPhaseStatus({
          sessionId: session.id,
          phase: 'repair',
          message: reviewResult.summary || '测试未通过，正在根据反馈修复...',
          stage: 'executing',
          tone: 'execution',
          metadata: {
            reviewDone: false,
            reviewIssues: reviewResult.issues,
          },
        });

        if (feedbackPrompt) {
          await this.sendUserInput({
            taskSessionId: session.id,
            content: feedbackPrompt,
            orchestratorSessionId,
            workspacePath: resolveOpencodeWorkspacePath(session.id) || undefined,
            source: 'agent',
          });
        }
        artifact.completionInProgress = false;
        return;
      }

      if (reviewResult.status === 'pass') {
        await this.persistMessage(session.id, 'agent', 'agent_message', reviewResult.summary, {
          reviewDone: true,
          reviewIssues: reviewResult.issues,
        });
      } else if (reviewResult.status === 'skipped') {
        await this.persistMessage(
          session.id,
          'agent',
          'agent_message',
          reviewResult.reason,
          {
            reviewDone: true,
            reviewSkipped: true,
          }
        );
      } else if (reviewResult.status === 'error') {
        await this.persistMessage(
          session.id,
          'agent',
          'agent_message',
          `审查失败：${reviewResult.message}`,
          {
            reviewDone: true,
            reviewError: reviewResult.message,
          }
        );
      }

      if (phaseForReview === 'testing') {
        await this.emitPhaseStatus({
          sessionId: session.id,
          phase: 'delivery',
          message: '测试完成，正在整理交付物...',
          stage: 'reviewing',
          tone: 'review',
          metadata: {
            ...metadata,
            outcome,
          },
        });
      }

      void this.archiveCompletedTurn({
        taskSessionId: session.id,
        orchestratorSessionId,
        opencodeSessionId: runOpencodeSessionId,
        source: 'managed_completed',
      });
      await taskCreationFileMemoryStore.updateSessionState(session.id, {
        status: 'completed',
        stage: 'completed',
        phase: session.phase === 'delivery' ? 'delivery' : (session.phase as any) || 'delivery',
      });
      await this.syncDbSessionStatus(session.id, 'completed');
      this.runArtifacts.delete(runKey);
      if (orchestratorSessionId) {
        try {
          await osacAgentService.closeConnection(orchestratorSessionId);
        } catch (error) {
          console.warn('[OPENCODE_REMOTE_CLOSE_FAILED]', orchestratorSessionId, error);
        }
      }

      const content = 'OpenCode 执行完成';
      await this.persistMessage(
        session.id,
        'agent',
        'opencode_status',
        content,
        {
          ...metadata,
          outcome,
        }
      );
      await this.flushPersistenceBarrier('completed_status');

      await this.notify({
        taskSessionId: session.id,
        message: {
          type: 'status_update',
          content,
          stage: 'completed',
          tone: 'execution',
          metadata: {
            ...metadata,
            outcome,
          },
        },
      });
    } else if (outcome === 'failed' && session.stage !== 'failed') {
      const runOpencodeSessionId = opencodeSessionId || session.runtime?.opencodeSessionId || 'unknown';
      const runKey = this.buildRunKey(session.id, runOpencodeSessionId);
      if (this.finalizedRuns.has(runKey)) {
        return;
      }
      if (this.isDirectSession(session)) {
        this.finalizedRuns.add(runKey);
        this.clearNativeHistoryPoll(runKey);
        const errorDetail = asString(metadata.errorMessage);
        const errorContent = errorDetail ? `OpenCode 执行失败：${errorDetail}` : 'OpenCode 执行失败';
        if (runOpencodeSessionId) {
          this.clearStreamIdleTimer(this.buildStreamIdleKey(session.id, runOpencodeSessionId));
        }
        await this.flushTextStreams(
          session.id,
          orchestratorSessionId,
          opencodeSessionId || undefined,
          { persistMode: 'all' }
        );
        await taskCreationFileMemoryStore.updateSessionState(session.id, {
          status: 'failed',
          stage: 'failed',
        });
        await this.syncDbSessionStatus(session.id, 'failed');
        await this.persistMessage(
          session.id,
          'agent',
          'opencode_error',
          errorContent,
          {
            ...metadata,
            outcome,
            source: 'direct_failed',
          }
        );
        await this.flushPersistenceBarrier('direct_failed');
        await this.notify({
          taskSessionId: session.id,
          message: {
            type: 'error',
            content: errorContent,
            metadata: {
              ...metadata,
              outcome,
              source: 'direct_failed',
            },
          },
        });
        await this.notify({
          taskSessionId: session.id,
          message: {
            type: 'status_update',
            content: 'OpenCode 执行已结束',
            stage: 'failed',
            tone: 'error',
            metadata: {
              ...metadata,
              outcome,
              source: 'direct_failed',
            },
          },
        });
        this.runArtifacts.delete(runKey);
        return;
      }
      this.finalizedRuns.add(runKey);
      this.clearNativeHistoryPoll(runKey);
      if (runOpencodeSessionId) {
        this.clearStreamIdleTimer(this.buildStreamIdleKey(session.id, runOpencodeSessionId));
      }

      await this.flushTextStreams(
        session.id,
        orchestratorSessionId,
        opencodeSessionId || undefined,
        { persistMode: 'all' }
      );
      await taskCreationFileMemoryStore.updateSessionState(session.id, {
        status: 'failed',
        stage: 'failed',
      });
      await this.syncDbSessionStatus(session.id, 'failed');
      this.runArtifacts.delete(runKey);
      if (orchestratorSessionId) {
        try {
          await osacAgentService.closeConnection(orchestratorSessionId);
        } catch (error) {
          console.warn('[OPENCODE_REMOTE_CLOSE_FAILED]', orchestratorSessionId, error);
        }
      }

      const errorDetail = asString(metadata.errorMessage);
      const errorContent = errorDetail ? `OpenCode 执行失败：${errorDetail}` : 'OpenCode 执行失败';
      await this.persistMessage(
        session.id,
        'agent',
        'opencode_error',
        errorContent,
        {
          ...metadata,
          outcome,
        }
      );

      const content = 'OpenCode 执行已结束';
      await this.persistMessage(
        session.id,
        'agent',
        'status_update',
        content,
        {
          ...metadata,
          outcome,
          stage: 'failed',
          tone: 'execution',
        }
      );
      await this.flushPersistenceBarrier('failed_status');

      await this.notify({
        taskSessionId: session.id,
        message: {
          type: 'status_update',
          content,
          stage: 'failed',
          tone: 'execution',
          metadata: {
            ...metadata,
            outcome,
          },
        },
      });
    }
  }
}

export const opencodeRemoteService = new OpencodeRemoteService();
// Ensure OSAC handlers are registered even when WebSocket service isn't initialized yet.
opencodeRemoteService.initialize();
