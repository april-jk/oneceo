import type { OsacMessage } from '../clients/osac-client';
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
import { ensureNekoDebug } from './sandbox-debug-service';
import { sandboxAgentProvisionService } from './sandbox-agent-provision-service';

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
  toolsUsed: Set<string>;
};

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
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

function buildReviewFeedbackPrompt(payload: {
  userInput: string;
  taskDescription: TaskDescription;
  executionPlan: ExecutionPlan;
  lastOutput: string;
  feedback: string;
  runSummary?: string;
}): string {
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

  if (eventType === 'message.updated') {
    const info = normalizeRecord(properties.info);
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
  if (lowerType === 'session.idle') {
    return 'completed';
  }

  const event = toRecord(payload.event);
  const properties = toRecord(event.properties);
  const info = toRecord(properties.info);
  const statusRecord = toRecord(properties.status);
  const infoStatusRecord = toRecord(info.status);
  const part = toRecord(properties.part);
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

  // 仅在 session 级事件上进行终态判定，避免 message.part.updated 等中间事件提前触发 completed。
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

async function resolveRuntimeBinding(
  taskSessionId: string,
  fallbackOrchestratorSessionId?: string
): Promise<RuntimeBinding | null> {
  const session = await taskCreationFileMemoryStore.getSession(taskSessionId);
  if (!session) return null;

  const runtime = session.runtime || {};
  const orchestratorFromRuntime = asString(runtime.orchestratorSessionId);
  const opencodeSessionId = asString(runtime.opencodeSessionId) || undefined;

  if (orchestratorFromRuntime) {
    return {
      orchestratorSessionId: orchestratorFromRuntime,
      opencodeSessionId,
    };
  }

  const fallback = asString(fallbackOrchestratorSessionId);
  if (fallback) {
    return {
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
  private runArtifacts = new Map<string, RunArtifact>();
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
  private sessionArtifactsSeen = new Set<string>();
  private sessionArtifactRevision = new Map<string, number>();
  private sessionTestedRevision = new Map<string, number>();
  private sessionTestDispatchedRevision = new Map<string, number>();
  private sessionNoArtifactNudges = new Map<string, number>();
  private sessionTestDispatchedCycle = new Map<string, number>();
  private workspaceBaselines = new Map<string, Set<string>>();
  private messageQueue: NewConversationMessage[] = [];
  private messageFlushTimer: NodeJS.Timeout | null = null;
  private messageFlushInProgress: Promise<void> = Promise.resolve();
  private messageFlushIntervalMs =
    toNonNegativeInt(process.env.TASK_CREATION_MESSAGE_FLUSH_INTERVAL_MS) ?? 2000;
  private messageFlushMaxBatch =
    toNonNegativeInt(process.env.TASK_CREATION_MESSAGE_FLUSH_MAX_BATCH) ?? 50;
  private messageFlushMaxQueue =
    toNonNegativeInt(process.env.TASK_CREATION_MESSAGE_FLUSH_MAX_QUEUE) ?? 300;

  private buildRunKey(taskSessionId: string, opencodeSessionId: string): string {
    return `${taskSessionId}::${opencodeSessionId}`;
  }

  private getRunArtifact(runKey: string) {
    let record = this.runArtifacts.get(runKey);
    if (!record) {
      const now = Date.now();
      record = {
        hasFileChange: false,
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

  private enqueueDbMessage(message: NewConversationMessage) {
    this.messageQueue.push(message);
    const maxBatch = this.messageFlushMaxBatch > 0 ? this.messageFlushMaxBatch : 0;
    const maxQueue = this.messageFlushMaxQueue > 0 ? this.messageFlushMaxQueue : 0;
    if ((maxQueue > 0 && this.messageQueue.length >= maxQueue) || (maxBatch > 0 && this.messageQueue.length >= maxBatch)) {
      void this.flushMessageQueue(true);
      return;
    }
    this.scheduleMessageFlush();
  }

  private async flushMessageQueue(force: boolean = false) {
    if (this.messageQueue.length === 0) return;
    const batchSize = this.messageFlushMaxBatch > 0 ? this.messageFlushMaxBatch : this.messageQueue.length;
    const batch = this.messageQueue.splice(0, batchSize);
    const run = async () => {
      try {
        await ensureDatabaseConnection({ retries: 3, delayMs: 1000 });
        await taskCreationSessionDAO.addMessages(batch);
      } catch (error) {
        console.warn('[TASK_CREATION_MESSAGE_FLUSH_FAILED]', error);
        this.messageQueue.unshift(...batch);
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
    await taskCreationFileMemoryStore.addMessage(taskSessionId, role, messageType, content, metadata);
    this.enqueueDbMessage({
      sessionId: taskSessionId,
      role,
      content,
      messageType,
      metadata,
    });
  }

  private async detectWorkspaceArtifactsAfterBaseline(
    sessionId: string,
    orchestratorSessionId: string,
    workspaceRoot: string
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
      if (!baseline.has(file)) {
        hasNew = true;
        break;
      }
    }
    if (hasNew) {
      this.workspaceBaselines.set(sessionId, new Set(files));
    }
    return hasNew;
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
      timestamp: Date.now(),
      source: 'stream_checkpoint',
      rawPayload: {
        eventType: 'message.part.updated',
        text: content,
        source: 'stream_checkpoint',
      },
    };

    await this.persistMessage(
      taskSessionId,
      'agent',
      'opencode_event',
      content,
      metadata
    );

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
    if (this.finalizedRuns.has(this.buildRunKey(taskSessionId, opencodeSessionId))) return;

    const workspacePath = resolveOpencodeWorkspacePath(taskSessionId);
    const syntheticEvent: Record<string, unknown> = {
      type: 'session.idle',
      properties: {
        sessionID: opencodeSessionId,
        status: 'idle',
      },
      directory: workspacePath || undefined,
    };
    const syntheticMessage: OsacMessage = {
      type: 'OPENCODE_EVENT',
      payload: {
        seq: Date.now(),
        timestamp: Date.now(),
        eventType: 'session.idle',
        event: syntheticEvent,
        orchestratorSessionId,
        opencodeSessionId,
      },
    };

    await this.handleOsacMessage(orchestratorSessionId, syntheticMessage);
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

    return {
      orchestratorSessionId: provision.sessionId,
      opencodeSessionId: undefined,
    };
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

    const event = toRecord(payload.event);
    const properties = normalizeRecord(event.properties);
    const part = normalizeRecord(properties.part);
    const message = normalizeRecord(properties.message);
    const partType = (asString(part.type) || asString(properties.type)).toLowerCase();
    if (partType && partType !== 'text') {
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

  private upsertTextStream(input: {
    taskSessionId: string;
    orchestratorSessionId: string;
    opencodeSessionId: string;
    partId: string;
    text: string;
    delta: string;
    updatedAt: number;
  }): { streamKey: string; text: string; resetFrom?: string } {
    const streamKey = this.buildTextStreamKey(input.taskSessionId, input.opencodeSessionId, input.partId);
    const previous = this.textStreams.get(streamKey);
    if (previous?.truncated) {
      return { streamKey, text: previous.text };
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

  async sendUserInput(input: {
    taskSessionId: string;
    content: string;
    orchestratorSessionId?: string;
    workspacePath?: string;
    source?: 'user' | 'agent';
  }): Promise<{ orchestratorSessionId: string; opencodeSessionId: string }> {
    const taskSessionId = asString(input.taskSessionId);
    const content = String(input.content || '').trim();
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

    let orchestratorSessionId = runtime.orchestratorSessionId;
    const workspacePath = asString(input.workspacePath) || resolveOpencodeWorkspacePath(taskSessionId);
    const opencodeHost = asString(process.env.OPENCODE_SERVER_HOST) || undefined;
    const opencodePort = toPositiveInt(process.env.OPENCODE_SERVER_PORT);

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const runtimeStatus = await resolveRuntimeFromEnvironment(orchestratorSessionId);
      if (!runtimeStatus.ready) {
        runtime = await this.recoverRuntime(taskSessionId);
        orchestratorSessionId = runtime.orchestratorSessionId;
      }

      try {
        return await this.withOpencodeLock(orchestratorSessionId, async () => {
          await this.ensureWorkspaceGit(orchestratorSessionId, workspacePath);
          await osacAgentService.ensureOpencodeServer(orchestratorSessionId, {
            workspacePath: workspacePath || undefined,
            host: opencodeHost,
            port: opencodePort,
          });
          await this.ensureWorkspaceBaseline(taskSessionId, orchestratorSessionId, workspacePath || '');

          let opencodeSessionId = runtime?.opencodeSessionId;
          if (!opencodeSessionId) {
            const created = await osacAgentService.createOpencodeSession(orchestratorSessionId, {
              workspacePath: workspacePath || undefined,
            });
            opencodeSessionId = asString(created.opencodeSessionId);
            if (!opencodeSessionId) {
              throw new Error('创建 OpenCode 会话失败：缺少 opencodeSessionId');
            }
            await taskCreationFileMemoryStore.updateRuntimeBinding(taskSessionId, {
              orchestratorSessionId,
              opencodeSessionId,
            });
          } else {
            await taskCreationFileMemoryStore.updateRuntimeBinding(taskSessionId, {
              orchestratorSessionId,
            });
          }

          await osacAgentService.sendOpencodePrompt(orchestratorSessionId, {
            opencodeSessionId,
            workspacePath: workspacePath || undefined,
            parts: [{ type: 'text', text: content }],
          });
          await this.initRunArtifactsForPrompt(taskSessionId, orchestratorSessionId, opencodeSessionId);

          const role = input.source === 'agent' ? 'agent' : 'user';
          const messageType = input.source === 'agent' ? 'opencode_agent_input' : 'opencode_user_input';
          await this.persistMessage(
            taskSessionId,
            role,
            messageType,
            content,
            {
              orchestratorSessionId,
              opencodeSessionId,
              workspacePath,
            }
          );

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
        if (isSandboxNotFoundError(error) && attempt < 2) {
          await markSandboxClosed(orchestratorSessionId);
          runtime = await this.recoverRuntime(taskSessionId);
          orchestratorSessionId = runtime.orchestratorSessionId;
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
    const now = Date.now();
    const phaseAtStart = (session.phase as FlowPhase) || 'development';
    this.runArtifacts.set(this.buildRunKey(session.id, opencodeSessionId), {
      hasFileChange: false,
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
      toolsUsed: new Set<string>(),
      phaseAtStart,
      cycleAtStart: session.phaseCycle ?? 0,
    });
    this.touchStreamIdle(session.id, orchestratorSessionId, opencodeSessionId);
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
    const event = toRecord(payload.event);
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
        this.clearTextStreams(session.id, opencodeSessionId);
        this.finalizedRuns.delete(this.buildRunKey(session.id, opencodeSessionId));
        const now = Date.now();
        const phaseAtStart = (session.phase as FlowPhase) || 'development';
        this.runArtifacts.set(this.buildRunKey(session.id, opencodeSessionId), {
          hasFileChange: false,
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
          toolsUsed: new Set<string>(),
          phaseAtStart,
          cycleAtStart: session.phaseCycle ?? 0,
        });
        this.touchStreamIdle(session.id, orchestratorSessionId, opencodeSessionId);
      }
      await taskCreationFileMemoryStore.updateSessionState(session.id, {
        status: 'in_progress',
        stage: 'executing',
        phase: session.phase ? (session.phase as any) : 'development',
      });

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
        return;
      }
      const content = rawMessage;
      const opencodeSessionId = asString(payload.opencodeSessionId) || session.runtime?.opencodeSessionId;
      if (opencodeSessionId) {
        this.clearStreamIdleTimer(this.buildStreamIdleKey(session.id, opencodeSessionId));
      }
      await this.flushTextStreams(
        session.id,
        orchestratorSessionId,
        opencodeSessionId || undefined,
        { persistMode: this.isDirectSession(session) ? 'latest' : 'all' }
      );

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
      return;
    }

    const eventType = asString(payload.eventType) || asString((toRecord(payload.event)).type) || 'unknown';
    const opencodeSessionId =
      asString(payload.opencodeSessionId) ||
      pickSessionIdFromEvent(event) ||
      session.runtime?.opencodeSessionId ||
      '';
    if (opencodeSessionId) {
      this.touchStreamIdle(session.id, orchestratorSessionId, opencodeSessionId);
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
    }

    const outcome = detectOpencodeOutcome(eventType, payload);

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

      if (stream.resetFrom && !this.isDirectSession(session)) {
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
        }
      }

      const eventPreview = buildEventPreview(event);
      const metadata: Record<string, unknown> = {
        orchestratorSessionId,
        opencodeSessionId: textStream.opencodeSessionId,
        eventType,
        seq: payload.seq,
        timestamp: payload.timestamp,
        event: eventPreview,
        rawPayload: buildRawPayloadPreview(eventType, eventPreview),
        stream: true,
        streamKey: stream.streamKey,
        partId: textStream.partId,
      };

      this.streamBroadcastMeta.set(stream.streamKey, metadata);
      // 直通/实时增量：优先推送当前片段，避免等待广播节流。
      const immediateContent = textStream.delta || stream.text;
      if (immediateContent) {
        const immediateMeta = {
          ...metadata,
          streamDelta: Boolean(textStream.delta),
          source: textStream.delta ? 'stream_delta' : metadata.source,
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
        return;
      }
      this.scheduleStreamBroadcast(session.id, stream.streamKey);
      this.scheduleStreamCheckpoint(session.id, orchestratorSessionId, textStream.opencodeSessionId, stream.streamKey);
      return;
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
    const metadata: Record<string, unknown> = {
      orchestratorSessionId,
      opencodeSessionId: opencodeSessionId || undefined,
      eventType,
      seq: payload.seq,
      timestamp: payload.timestamp,
      event: eventPreview,
      rawPayload: buildRawPayloadPreview(eventType, eventPreview),
    };

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
      const aggregated = await this.flushTextStreams(
        session.id,
        orchestratorSessionId,
        opencodeSessionId || undefined,
        { persistMode: isDirect ? 'latest' : 'all' }
      );
      if (isDirect) {
        const artifact = this.getRunArtifact(runKey);
        this.finalizedRuns.add(runKey);
        if (runOpencodeSessionId) {
          this.clearStreamIdleTimer(this.buildStreamIdleKey(session.id, runOpencodeSessionId));
        }
        artifact.completionInProgress = false;
        this.runArtifacts.delete(runKey);
        return;
      }
      const currentPhase = (session.phase as FlowPhase) || 'development';
      let phaseForReview: FlowPhase = currentPhase;
      const artifact = this.getRunArtifact(runKey);
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

      if ((currentPhase === 'development' || currentPhase === 'repair') && artifact && !artifact.hasFileChange) {
        if (orchestratorSessionId && workspaceRoot) {
          try {
            if (await this.detectWorkspaceArtifactsAfterBaseline(session.id, orchestratorSessionId, workspaceRoot)) {
              artifact.hasFileChange = true;
              this.sessionArtifactsSeen.add(session.id);
            }
          } catch (error) {
            console.warn('[OPENCODE_ARTIFACT_SCAN_FAILED]', error);
          }
        }
      }

      const sessionHasArtifacts = this.sessionArtifactsSeen.has(session.id);
      let hasArtifacts = artifact.hasFileChange || sessionHasArtifacts;
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
        if (sessionHasArtifacts && !artifact.hasFileChange) {
          artifact.hasFileChange = true;
          hasArtifacts = true;
        }
        if (!hasArtifacts) {
          const nudged = this.sessionNoArtifactNudges.get(session.id) || 0;
          const shouldNudge = artifact.missingArtifactNudges < 1 && nudged < 1;
          if (shouldNudge) {
            artifact.missingArtifactNudges += 1;
            this.sessionNoArtifactNudges.set(session.id, nudged + 1);
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
            const followUp = [
              '当前未检测到任何文件产出，请继续完成交付物。',
              '请直接在当前工作区生成单 HTML 文件（包含 HTML/CSS/JS）。',
              '完成后再执行 Playwright 测试（连接 CDP 9222，同一浏览器窗口）。',
            ].join('\n');
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
          if (runOpencodeSessionId) {
            this.clearStreamIdleTimer(this.buildStreamIdleKey(session.id, runOpencodeSessionId));
          }
          await taskCreationFileMemoryStore.updateSessionState(session.id, {
            status: 'in_progress',
            stage: 'reviewing',
          });

          await this.emitPhaseStatus({
            sessionId: session.id,
            phase: 'testing',
            message: '正在执行自动化测试...',
            stage: 'reviewing',
            tone: 'review',
            metadata: {
              ...metadata,
              outcome,
            },
          });
          this.sessionTestDispatchedRevision.set(session.id, revision);

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

          const context = await this.resolveReviewContext(session.id);
          const runSummary = await this.resolveLatestRunSummary(session.id);
          if (context) {
            const testPrompt = buildPlaywrightTestPrompt({
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

      await taskCreationFileMemoryStore.updateSessionState(session.id, {
        status: 'completed',
        stage: 'completed',
        phase: session.phase === 'delivery' ? 'delivery' : (session.phase as any) || 'delivery',
      });
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
        if (runOpencodeSessionId) {
          this.clearStreamIdleTimer(this.buildStreamIdleKey(session.id, runOpencodeSessionId));
        }
        await this.flushTextStreams(
          session.id,
          orchestratorSessionId,
          opencodeSessionId || undefined,
          { persistMode: 'latest' }
        );
        this.runArtifacts.delete(runKey);
        return;
      }
      this.finalizedRuns.add(runKey);
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
      this.runArtifacts.delete(runKey);
      if (orchestratorSessionId) {
        try {
          await osacAgentService.closeConnection(orchestratorSessionId);
        } catch (error) {
          console.warn('[OPENCODE_REMOTE_CLOSE_FAILED]', orchestratorSessionId, error);
        }
      }

      const errorContent = 'OpenCode 执行失败';
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
