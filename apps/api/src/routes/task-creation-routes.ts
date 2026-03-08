/**
 * 任务创建 API 路由
 * 
 * 提供任务创建历史、会话详情等查询接口
 */

import express from 'express';
import { randomUUID } from 'node:crypto';
import { sandboxExecutionEnvironmentDAO, taskCreationSessionDAO } from '../db/dao';
import { getPublicErrorMessage } from '../utils/error-response';
import { taskCreationFileMemoryStore, type FileSessionRecord } from '../agents/task-creation/file-memory-store';
import { taskCreationCacheStore } from '../agents/task-creation/task-creation-cache-store';
import { osacAgentService } from '../services/osac-agent-service';
import { opencodeRemoteService } from '../services/opencode-remote-service';
import { opencodeEventStreamService } from '../services/opencode-event-stream-service';
import { sandboxAgentProvisionService } from '../services/sandbox-agent-provision-service';
import { resolveOpencodeWorkspacePath } from '../utils/opencode-workspace';
import { setSandboxMetadata, touchSandbox } from '../services/sandbox-activity-service';
import { ensureNekoDebug } from '../services/sandbox-debug-service';
import { e2bConnector } from '../connectors/e2b-connector';
import { currentUserResolver } from '../services/current-user-resolver';
import { CONNECTOR_KEYS, type ConnectorKey } from '../services/connector-registry';
import { sessionConnectorService } from '../services/session-connector-service';

const router = express.Router();

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function isUnsafePath(input: string): boolean {
  if (!input) return true;
  if (input.startsWith('/') || input.startsWith('\\')) return true;
  const normalized = input.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts.some((part) => part === '..');
}

function parseRefreshFlag(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  const text = String(value).trim().toLowerCase();
  return text === '1' || text === 'true' || text === 'yes';
}

function resolveTenantKey(req: express.Request): string {
  // TODO: bind tenantKey to authenticated identity once login/auth is implemented.
  const headerTenant = String(req.header('X-Tenant-Id') || '').trim();
  if (headerTenant) return headerTenant;
  const headerUser = String(req.header('X-User-Id') || '').trim();
  if (headerUser) return headerUser;
  const queryTenant = String(req.query.tenantId || '').trim();
  if (queryTenant) return queryTenant;
  return 'default';
}

function parseConnectorKey(value: string): ConnectorKey {
  if ((CONNECTOR_KEYS as readonly string[]).includes(value)) {
    return value as ConnectorKey;
  }
  throw new Error(`未知连接器: ${value}`);
}

function toIso(value: Date | string | null | undefined): string {
  if (!value) return new Date().toISOString();
  if (value instanceof Date) return value.toISOString();
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  return new Date().toISOString();
}

function toSessionSummary(session: any) {
  return {
    id: session.id,
    title: session.title,
    status: session.status,
    stage: session.stage,
    phase: session.phase,
    phaseCycle: session.phaseCycle,
    runtime: session.runtime,
    pendingQuestion: session.pendingQuestion,
    pendingOptions: session.pendingOptions,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: Array.isArray(session.messages) ? session.messages.length : 0,
    messages: [],
  };
}

async function findEnvironmentByTaskSessionId(taskSessionId: string) {
  const limit = clampNumber(Number(process.env.SANDBOX_RUNTIME_LOOKUP_LIMIT || 500), 50, 5000);
  const environments = await sandboxExecutionEnvironmentDAO.listRecent(limit);
  for (const env of environments) {
    const meta = (env.metadata || {}) as Record<string, unknown>;
    const metaTaskId = typeof (meta as any).taskSessionId === 'string' ? String((meta as any).taskSessionId) : '';
    if (metaTaskId && metaTaskId === taskSessionId) {
      return env;
    }
  }
  return null;
}

async function buildFileSessionFromDb(sessionId: string): Promise<FileSessionRecord | null> {
  const session = await taskCreationSessionDAO.getSession(sessionId);
  if (!session) return null;
  const [taskDescription, messages] = await Promise.all([
    taskCreationSessionDAO.getTaskDescription(sessionId),
    taskCreationSessionDAO.getMessages(sessionId),
  ]);
  const titleCandidate =
    taskDescription?.title ||
    messages?.find((m) => m.role === 'user')?.content ||
    '新建任务会话';

  const status: FileSessionRecord['status'] =
    session.status === 'completed' || session.status === 'failed' || session.status === 'waiting_user'
      ? session.status
      : 'in_progress';
  const stage: NonNullable<FileSessionRecord['stage']> =
    status === 'completed'
      ? 'completed'
      : status === 'failed'
        ? 'failed'
        : status === 'waiting_user'
          ? 'clarifying'
          : 'executing';

  const env = await findEnvironmentByTaskSessionId(sessionId);
  const orchestratorSessionId = env?.sessionId;

  return {
    id: session.id,
    title: String(titleCandidate).trim().slice(0, 80) || '新建任务会话',
    status,
    stage,
    runtime: orchestratorSessionId
      ? {
          orchestratorSessionId,
          opencodeSessionId: undefined,
          updatedAt: toIso(env?.updatedAt as any),
        }
      : undefined,
    createdAt: toIso(session.createdAt as any),
    updatedAt: toIso(session.updatedAt as any),
    messages: Array.isArray(messages)
      ? messages.map((m) => ({
          id: String(m.id),
          role: (m.role as any) || 'agent',
          messageType: m.messageType || 'message',
          content: m.content || '',
          metadata: m.metadata || undefined,
          createdAt: toIso(m.createdAt as any),
        }))
      : [],
  };
}

async function hydrateFileSessionFromDb(sessionId: string) {
  const record = await buildFileSessionFromDb(sessionId);
  if (!record) return null;
  await taskCreationFileMemoryStore.createSession(record.title, record.id);
  await taskCreationFileMemoryStore.updateSessionStatus(record.id, record.status as any);
  if (record.runtime?.orchestratorSessionId) {
    await taskCreationFileMemoryStore.updateRuntimeBinding(record.id, {
      orchestratorSessionId: record.runtime.orchestratorSessionId,
      opencodeSessionId: record.runtime.opencodeSessionId,
    });
  }
  return record;
}

async function resolveTaskSessionRecord(sessionId: string) {
  let session = await taskCreationFileMemoryStore.getSession(sessionId);
  if (!session) {
    session = await hydrateFileSessionFromDb(sessionId);
  }
  return session;
}

type SessionListCache = {
  fetchedAt: number;
  limit: number;
  data: any[];
};

let sessionListCache: SessionListCache | null = null;

function mapStageFromStatus(status: string | null | undefined) {
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  if (status === 'waiting_user') return 'clarifying';
  return 'executing';
}

async function buildSessionSummaryFromDb(limit: number) {
  const sessions = await taskCreationSessionDAO.getRecentSessions(limit);
  const result: any[] = [];
  for (const session of sessions) {
    const description = await taskCreationSessionDAO.getTaskDescription(session.id);
    const title =
      description?.title ||
      `任务会话 ${String(session.id).slice(-6)}`;
    result.push({
      id: session.id,
      title: title.trim().slice(0, 80),
      status: session.status,
      stage: mapStageFromStatus(session.status),
      createdAt: toIso(session.createdAt as any),
      updatedAt: toIso(session.updatedAt as any),
      messages: [],
    });
  }
  return result;
}

async function ensureOpencodeServer(orchestratorSessionId: string, workspaceRoot: string) {
  const enabledRaw = String(process.env.OPENCODE_SERVER_ENSURE_ON_READ || 'true').trim().toLowerCase();
  if (enabledRaw === 'false') return;
  try {
    await osacAgentService.ensureOpencodeServer(orchestratorSessionId, {
      workspacePath: workspaceRoot || undefined,
    });
  } catch (error) {
    console.warn('[OPENCODE_SERVER_ENSURE_FAILED]', orchestratorSessionId, error);
  }
}

async function ensureTaskSessionRuntime(sessionId: string) {
  const session = await resolveTaskSessionRecord(sessionId);
  if (!session) {
    throw new Error('会话不存在');
  }

  const workspaceRoot = resolveOpencodeWorkspacePath(sessionId);
  const orchestratorSessionId = asText(session.runtime?.orchestratorSessionId);
  if (orchestratorSessionId) {
    const environment = await sandboxExecutionEnvironmentDAO.getBySessionId(orchestratorSessionId);
    if (environment?.status === 'ready') {
      try {
        await osacAgentService.ensureOpencodeServer(orchestratorSessionId, {
          workspacePath: workspaceRoot || undefined,
        });
        await touchSandbox(orchestratorSessionId, 'runtime_start_reuse');
        const runtimeStatus = await resolveRuntimeStatus(orchestratorSessionId);
        return {
          orchestratorSessionId,
          status: runtimeStatus?.status || 'ready',
          reused: true,
        };
      } catch (error) {
        if (!isSandboxNotFoundError(error)) {
          throw error;
        }
        await markSandboxClosed(orchestratorSessionId);
      }
    }
  }

  const provision = await sandboxAgentProvisionService.provisionWithLock({
    metadata: {
      taskSessionId: sessionId,
      taskTitle: session.title,
    },
  });

  await taskCreationFileMemoryStore.updateRuntimeBinding(sessionId, {
    orchestratorSessionId: provision.sessionId,
    opencodeSessionId: '',
  });
  await taskCreationCacheStore.invalidateWorkspaceBySession(sessionId);
  await touchSandbox(provision.sessionId, 'runtime_start_new');

  const runtimeStatus = await resolveRuntimeStatus(provision.sessionId);

  return {
    orchestratorSessionId: provision.sessionId,
    status: runtimeStatus?.status || provision.status || 'ready',
    reused: false,
  };
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

type OpencodeFileNode = {
  path: string;
  type: 'file' | 'directory';
  ignored?: boolean;
};

type OpencodeFileContent = {
  type: 'text' | 'binary';
  content: string;
  encoding?: string;
  mimeType?: string;
};

type WorkspacePreviewType = 'text' | 'markdown' | 'image' | 'video' | 'audio' | 'pdf' | 'binary';

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

async function readOpencodeFile(
  orchestratorSessionId: string,
  workspaceRoot: string,
  filePath: string
): Promise<OpencodeFileContent> {
  const data = await fetchOpencodeJsonViaOsac<OpencodeFileContent>(
    orchestratorSessionId,
    workspaceRoot,
    '/file/content',
    {
      path: filePath,
    }
  );
  if (!data || typeof data !== 'object') {
    throw new Error('opencode file content invalid');
  }
  return data;
}

function normalizeWorkspacePath(input: string): string {
  return input.replace(/\\/g, '/').replace(/^\/+/, '');
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asPositiveInt(value: unknown): number | null {
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

function pickRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  return {};
}

function isSandboxNotFoundError(error: unknown): boolean {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return normalized.includes('sandbox was not found') || normalized.includes('sandbox not found');
}

async function resolveRuntimeStatus(orchestratorSessionId?: string | null) {
  const sessionId = asText(orchestratorSessionId);
  if (!sessionId) return null;
  try {
    const environment = await sandboxExecutionEnvironmentDAO.getBySessionId(sessionId);
    if (!environment) return null;
    return {
      status: environment.status,
      provider: (environment.metadata as any)?.sandboxProvider || undefined,
      updatedAt: environment.updatedAt,
      sandboxId: environment.sessionId,
    };
  } catch (error) {
    console.warn('[TASK_CREATION_RUNTIME_STATUS_FAILED]', sessionId, error);
    return null;
  }
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
    console.warn('[TASK_CREATION_MARK_CLOSED_FAILED]', orchestratorSessionId, error);
  }
}

function truncateUtf8(text: string, maxBytes: number): { text: string; truncated: boolean; size: number } {
  const buffer = Buffer.from(text || '', 'utf8');
  if (buffer.length <= maxBytes) {
    return { text, truncated: false, size: buffer.length };
  }
  const sliced = buffer.subarray(0, maxBytes).toString('utf8');
  return { text: sliced, truncated: true, size: maxBytes };
}

function getFileExt(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const filename = normalized.split('/').pop() || '';
  const dot = filename.lastIndexOf('.');
  if (dot < 0) return '';
  return filename.slice(dot + 1).toLowerCase();
}

function inferMimeTypeFromExt(filePath: string): string | undefined {
  const ext = getFileExt(filePath);
  if (!ext) return undefined;
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    m4v: 'video/x-m4v',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    flac: 'audio/flac',
    pdf: 'application/pdf',
    md: 'text/markdown',
    markdown: 'text/markdown',
    mdx: 'text/markdown',
  };
  return map[ext];
}

function resolveMimeType(filePath: string, fromUpstream?: string): string {
  const normalized = (fromUpstream || '').trim().toLowerCase();
  if (normalized) return normalized;
  return inferMimeTypeFromExt(filePath) || 'application/octet-stream';
}

function detectPreviewType(filePath: string, mimeType: string, isBinary: boolean): WorkspacePreviewType {
  const ext = getFileExt(filePath);
  if (!isBinary) {
    if (mimeType === 'image/svg+xml' || ext === 'svg') {
      return 'image';
    }
    if (mimeType === 'text/markdown' || ext === 'md' || ext === 'markdown' || ext === 'mdx') {
      return 'markdown';
    }
    return 'text';
  }
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType === 'application/pdf') return 'pdf';
  return 'binary';
}

function estimateBase64Bytes(base64: string): number {
  if (!base64) return 0;
  const sanitized = base64.replace(/\s+/g, '');
  const padding = sanitized.endsWith('==') ? 2 : sanitized.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((sanitized.length * 3) / 4) - padding);
}

async function buildWorkspaceTreeFromOpencode(input: {
  orchestratorSessionId: string;
  workspaceRoot: string;
  maxDepth: number;
  maxEntries: number;
}) {
  const items: Array<{ path: string; type: 'file' | 'dir' }> = [];
  const queue: Array<{ path: string; depth: number }> = [{ path: '', depth: 0 }];
  const seenDirs = new Set<string>();

  while (queue.length > 0 && items.length < input.maxEntries) {
    const current = queue.shift()!;
    const nodes = await listOpencodeDirectory(
      input.orchestratorSessionId,
      input.workspaceRoot,
      current.path
    );
    for (const node of nodes) {
      if (node.ignored) continue;
      const normalizedPath = normalizeWorkspacePath(node.path);
      if (!normalizedPath) continue;
      const type = node.type === 'directory' ? 'dir' : 'file';
      if (type === 'dir' && current.depth >= input.maxDepth) {
        continue;
      }
      items.push({ path: normalizedPath, type });
      if (items.length >= input.maxEntries) break;
      if (type === 'dir' && current.depth + 1 <= input.maxDepth && !seenDirs.has(normalizedPath)) {
        seenDirs.add(normalizedPath);
        queue.push({ path: normalizedPath, depth: current.depth + 1 });
      }
    }
  }

  return {
    root: input.workspaceRoot,
    items,
  };
}

function sortWorkspaceTreeItems(
  items: Array<{ path: string; type: 'file' | 'dir' }>
): Array<{ path: string; type: 'file' | 'dir' }> {
  return items
    .slice()
    .sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'dir' ? -1 : 1;
      }
      return a.path.localeCompare(b.path, 'zh-CN');
    });
}

function writeSse(res: express.Response, payload: unknown, eventName?: string, eventId?: number) {
  if (Number.isFinite(eventId) && eventId) {
    res.write(`id: ${eventId}\n`);
  }
  if (eventName) {
    res.write(`event: ${eventName}\n`);
  }
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
  if (typeof (res as any).flush === 'function') {
    (res as any).flush();
  }
}

type SseClientRuntimeState = {
  sessionId: string;
  clientId: string;
  connectedAt: number;
  disconnectedAt: number;
  activeConnections: number;
  reconnectCount: number;
  lastCursor: number;
  updatedAt: number;
};

const sseClientState = new Map<string, SseClientRuntimeState>();
const sseClientStateTtlMs = clampNumber(
  Number(process.env.TASK_CREATION_SSE_CLIENT_STATE_TTL_MS || 24 * 60 * 60 * 1000),
  5 * 60 * 1000,
  7 * 24 * 60 * 60 * 1000
);

function buildSseClientStateKey(sessionId: string, clientId: string) {
  return `${sessionId}::${clientId}`;
}

function isTimestampCursorValue(value: number) {
  return Number.isFinite(value) && value >= 1_000_000_000_000;
}

function parseSseClientId(req: express.Request): string {
  const fromQuery = asText(req.query.clientId);
  if (fromQuery) return fromQuery.slice(0, 128);
  const fromHeader = asText(req.headers['x-sse-client-id']);
  if (fromHeader) return fromHeader.slice(0, 128);
  const fallback =
    asText(req.ip) ||
    asText((req.headers['x-forwarded-for'] as string) || '') ||
    'anonymous';
  return `anon_${fallback}`.slice(0, 128);
}

function cleanupSseClientState(now: number) {
  for (const [key, state] of sseClientState.entries()) {
    if (state.activeConnections > 0) continue;
    if (now - state.updatedAt <= sseClientStateTtlMs) continue;
    sseClientState.delete(key);
  }
}

function registerSseClientConnection(sessionId: string, clientId: string) {
  const now = Date.now();
  cleanupSseClientState(now);
  const key = buildSseClientStateKey(sessionId, clientId);
  const prev = sseClientState.get(key);
  const reconnecting = Boolean(prev && prev.disconnectedAt > 0 && now >= prev.disconnectedAt);
  const next: SseClientRuntimeState = {
    sessionId,
    clientId,
    connectedAt: now,
    disconnectedAt: 0,
    activeConnections: (prev?.activeConnections || 0) + 1,
    reconnectCount: reconnecting ? (prev?.reconnectCount || 0) + 1 : prev?.reconnectCount || 0,
    lastCursor: prev?.lastCursor || 0,
    updatedAt: now,
  };
  sseClientState.set(key, next);
  return {
    key,
    state: next,
    reconnecting,
    previousDisconnectedAt: prev?.disconnectedAt || 0,
  };
}

function markSseClientDisconnected(key: string) {
  const now = Date.now();
  const prev = sseClientState.get(key);
  if (!prev) return;
  const nextActive = Math.max(0, (prev.activeConnections || 0) - 1);
  sseClientState.set(key, {
    ...prev,
    activeConnections: nextActive,
    disconnectedAt: now,
    updatedAt: now,
  });
}

function updateSseClientCursor(key: string, cursor: number) {
  if (!Number.isFinite(cursor) || cursor <= 0) return;
  const prev = sseClientState.get(key);
  if (!prev) return;
  const prevCursor = prev.lastCursor || 0;
  const prevIsTimestamp = isTimestampCursorValue(prevCursor);
  const nextIsTimestamp = isTimestampCursorValue(cursor);
  if (prevCursor > 0 && prevIsTimestamp !== nextIsTimestamp) {
    if (nextIsTimestamp) {
      // 保留 seq 游标，避免被时间戳游标覆盖后导致实时 seq 回放丢失。
      return;
    }
    // 从 timestamp 切回 seq，优先保证增量流可回放。
    sseClientState.set(key, {
      ...prev,
      lastCursor: cursor,
      updatedAt: Date.now(),
    });
    return;
  }
  if (cursor <= prevCursor) return;
  sseClientState.set(key, {
    ...prev,
    lastCursor: cursor,
    updatedAt: Date.now(),
  });
}

/**
 * POST /api/task-creation/sessions
 * 先创建任务会话（可选写入首条用户消息），用于前端在 runtime 连接前先落盘任务
 */
router.post('/sessions', async (req, res) => {
  try {
    const requestedSessionId = asText(req.body?.sessionId);
    const requestedTitle = asText(req.body?.title);
    const requestedMode = asText(req.body?.mode);
    const requestedExecutor = asText(req.body?.executor);
    const initialMessage = asText(req.body?.initialMessage);
    const initialMessageTypeRaw = asText(req.body?.initialMessageType);
    const initialMessageType = initialMessageTypeRaw === 'user_response' ? 'user_response' : 'user_input';

    const existingSession = requestedSessionId
      ? await taskCreationFileMemoryStore.getSession(requestedSessionId)
      : null;
    const isNewSession = !existingSession;
    const title =
      requestedTitle ||
      (initialMessage ? initialMessage.slice(0, 80) : '') ||
      '新建任务会话';

    const session = await taskCreationFileMemoryStore.createSession(
      title,
      requestedSessionId || undefined
    );

    if (requestedMode === 'sandbox' || requestedMode === 'altus') {
      await taskCreationFileMemoryStore.updateSessionMode(session.id, requestedMode as any);
    }
    if (requestedExecutor) {
      await taskCreationFileMemoryStore.updateSessionExecutor(session.id, requestedExecutor);
    }

    if (isNewSession) {
      await taskCreationFileMemoryStore.addMessage(
        session.id,
        'system',
        'session_started',
        '会话已创建'
      );
    }

    let persistedInitialMessage = false;
    if (initialMessage) {
      const history = await taskCreationFileMemoryStore.getMessages(session.id);
      const last = history.length > 0 ? history[history.length - 1] : null;
      const isDuplicateTail =
        last?.role === 'user' &&
        last?.messageType === initialMessageType &&
        String(last?.content || '') === initialMessage;
      if (!isDuplicateTail) {
        await taskCreationFileMemoryStore.addMessage(
          session.id,
          'user',
          initialMessageType,
          initialMessage
        );
        persistedInitialMessage = true;
      }
    }

    if (requestedMode === 'sandbox') {
      await taskCreationFileMemoryStore.updateSessionState(session.id, {
        status: 'in_progress',
        stage: 'executing',
        phase: 'development',
      });
    }

    try {
      const existingDbSession = await taskCreationSessionDAO.getSession(session.id);
      if (!existingDbSession) {
        await taskCreationSessionDAO.createSession({ id: session.id, status: 'in_progress' });
      }
      if (isNewSession) {
        await taskCreationSessionDAO.addMessage({
          id: randomUUID(),
          sessionId: session.id,
          role: 'system',
          messageType: 'session_started',
          content: '会话已创建',
        });
      }
      if (persistedInitialMessage) {
        await taskCreationSessionDAO.addMessage({
          id: randomUUID(),
          sessionId: session.id,
          role: 'user',
          messageType: initialMessageType,
          content: initialMessage,
        });
      }
    } catch (error) {
      console.warn('[TASK_CREATION_CREATE_SESSION_DB_FAILED]', error);
    }

    const snapshot = (await taskCreationFileMemoryStore.getSession(session.id)) || session;
    return res.json({
      success: true,
      data: toSessionSummary(snapshot),
      message: isNewSession ? '会话已创建' : '会话已就绪',
    });
  } catch (error: any) {
    console.error('创建会话失败:', error);
    res.status(500).json({
      success: false,
      error: getPublicErrorMessage('创建会话失败，请稍后重试'),
    });
  }
});

/**
 * GET /api/task-creation/sessions
 * 获取最近的任务创建会话列表
 */
router.get('/sessions', async (req, res) => {
  try {
    const rawLimit = (req.query.limit as string | undefined)?.trim();
    let limit = 200;
    if (rawLimit === 'all') {
      limit = Number.MAX_SAFE_INTEGER;
    } else if (rawLimit) {
      const parsed = Number.parseInt(rawLimit, 10);
      if (!Number.isNaN(parsed) && parsed > 0) {
        limit = Math.min(parsed, 5000);
      }
    }
    const refresh = parseRefreshFlag(req.query.refresh);
    const cacheTtlMs = clampNumber(
      Number(process.env.TASK_CREATION_LIST_CACHE_TTL_MS || 10000),
      1000,
      60000
    );
    const now = Date.now();

    const rawSessions = await taskCreationFileMemoryStore.listSessions(limit);
    const sessions = rawSessions.map(toSessionSummary);
    if (!refresh && sessions.length > 0) {
      return res.json({
        success: true,
        data: sessions,
      });
    }

    if (
      !refresh &&
      sessionListCache &&
      now - sessionListCache.fetchedAt < cacheTtlMs &&
      sessionListCache.data.length > 0
    ) {
      const cached = limit >= sessionListCache.data.length
        ? sessionListCache.data
        : sessionListCache.data.slice(0, limit);
      return res.json({
        success: true,
        data: cached,
        cache: { hit: true, ageMs: now - sessionListCache.fetchedAt },
      });
    }

    if (sessions.length === 0) {
      const summaries = await buildSessionSummaryFromDb(limit);
      sessionListCache = {
        fetchedAt: now,
        limit,
        data: summaries,
      };
      return res.json({
        success: true,
        data: summaries,
        cache: { hit: false },
      });
    }

    sessionListCache = {
      fetchedAt: now,
      limit,
      data: sessions,
    };

    return res.json({
      success: true,
      data: sessions,
      cache: { hit: false },
    });
  } catch (error: any) {
    console.error('获取会话列表失败:', error);
    res.status(500).json({
      success: false,
      error: getPublicErrorMessage('获取会话列表失败，请稍后重试'),
    });
  }
});

/**
 * GET /api/task-creation/sessions/:sessionId
 * 获取会话的完整信息（包括所有关联数据）
 */
router.get('/sessions/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const sessionData = await resolveTaskSessionRecord(sessionId);

    if (!sessionData) {
      return res.status(404).json({
        success: false,
        error: '会话不存在',
      });
    }

    const runtimeStatus = await resolveRuntimeStatus(sessionData.runtime?.orchestratorSessionId);
    let connectorsSummary: ReturnType<typeof sessionConnectorService.summarizeStatuses> | null = null;
    const currentUser = currentUserResolver.resolve(req);
    if (currentUser?.userId) {
      try {
        const statuses = await sessionConnectorService.listSessionConnectors(sessionId, currentUser.userId);
        connectorsSummary = sessionConnectorService.summarizeStatuses(statuses);
      } catch {
        connectorsSummary = null;
      }
    }

    res.json({
      success: true,
      data: {
        ...sessionData,
        runtimeStatus,
        connectorsSummary,
      },
    });
  } catch (error: any) {
    console.error('获取会话详情失败:', error);
    res.status(500).json({
      success: false,
      error: getPublicErrorMessage('获取会话详情失败，请稍后重试'),
    });
  }
});

/**
 * GET /api/task-creation/sessions/:sessionId/messages
 * 获取会话的对话消息
 */
router.get('/sessions/:sessionId/messages', async (req, res) => {
  try {
    const { sessionId } = req.params;
    let messages = await taskCreationFileMemoryStore.getMessages(sessionId);
    if (!messages || messages.length === 0) {
      const fallback = await taskCreationSessionDAO.getMessages(sessionId);
      messages = Array.isArray(fallback)
        ? fallback.map((m) => ({
            id: String(m.id),
            role: (m.role as any) || 'agent',
            messageType: m.messageType || 'message',
            content: m.content || '',
            metadata: m.metadata || undefined,
            createdAt: toIso(m.createdAt as any),
          }))
        : [];
    }

    // 合并尚未落盘完成的实时文本流快照，避免“刚完成立即刷新”出现文本缺失。
    try {
      const session = await taskCreationFileMemoryStore.getSession(sessionId);
      const runtimeOpencodeSessionId = asText(session?.runtime?.opencodeSessionId);
      const liveSnapshots = opencodeRemoteService.getLiveTextStreamSnapshots(
        sessionId,
        runtimeOpencodeSessionId || undefined
      );
      if (liveSnapshots.length > 0) {
        const existingSignatures = new Set<string>();
        for (const item of messages) {
          if (item?.messageType !== 'opencode_event') continue;
          const metadata = pickRecord(item.metadata);
          const streamKey = asText(metadata.streamKey);
          const content = asText(item.content);
          if (!streamKey || !content) continue;
          existingSignatures.add(`${streamKey}::${content}`);
        }

        for (const snapshot of liveSnapshots) {
          const metadata = pickRecord(snapshot.metadata);
          const streamKey = asText(metadata.streamKey);
          const content = asText(snapshot.content);
          if (!streamKey || !content) continue;
          const signature = `${streamKey}::${content}`;
          if (existingSignatures.has(signature)) {
            continue;
          }
          existingSignatures.add(signature);
          messages.push({
            id: `live_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            role: 'agent',
            messageType: 'opencode_event',
            content: snapshot.content,
            metadata: snapshot.metadata,
            createdAt: snapshot.createdAt,
          } as any);
        }

      }
    } catch (snapshotError) {
      console.warn('[TASK_CREATION_LIVE_STREAM_SNAPSHOT_MERGE_FAILED]', snapshotError);
    }

    messages.sort((a, b) => {
      const ma = pickRecord(a?.metadata);
      const mb = pickRecord(b?.metadata);
      const sa = asPositiveInt(ma.sessionEventSeq);
      const sb = asPositiveInt(mb.sessionEventSeq);
      if (sa !== null && sb !== null && sa !== sb) {
        return sa - sb;
      }
      if (sa !== null && sb === null) return -1;
      if (sa === null && sb !== null) return 1;

      const ta = a?.createdAt ? Date.parse(String(a.createdAt)) : 0;
      const tb = b?.createdAt ? Date.parse(String(b.createdAt)) : 0;
      if (ta !== tb) return ta - tb;
      return 0;
    });

    res.json({
      success: true,
      data: messages,
    });
  } catch (error: any) {
    console.error('获取对话消息失败:', error);
    res.status(500).json({
      success: false,
      error: getPublicErrorMessage('获取对话消息失败，请稍后重试'),
    });
  }
});

/**
 * POST /api/task-creation/sessions/:sessionId/runtime/start
 * 显式启动/恢复任务执行环境
 */
router.post('/sessions/:sessionId/runtime/start', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await resolveTaskSessionRecord(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: getPublicErrorMessage('会话不存在'),
      });
    }
    const runtime = await ensureTaskSessionRuntime(sessionId);
    return res.json({
      success: true,
      data: runtime,
    });
  } catch (error: any) {
    console.error('启动执行环境失败:', error);
    res.status(isSandboxNotFoundError(error) ? 409 : 500).json({
      success: false,
      error: getPublicErrorMessage(
        isSandboxNotFoundError(error) ? '执行环境已关闭，请重新启动' : '启动执行环境失败，请稍后重试'
      ),
    });
  }
});

/**
 * POST /api/task-creation/sessions/:sessionId/runtime/touch
 * 心跳维持执行环境（用于前端保持会话时防止自动回收）
 */
router.post('/sessions/:sessionId/runtime/touch', async (req, res) => {
  try {
    const { sessionId } = req.params;
    let session = await taskCreationFileMemoryStore.getSession(sessionId);
    if (!session) {
      session = await hydrateFileSessionFromDb(sessionId);
    }
    if (!session) {
      return res.status(404).json({
        success: false,
        error: getPublicErrorMessage('会话不存在'),
      });
    }

    const orchestratorSessionId = asText(session.runtime?.orchestratorSessionId);
    if (!orchestratorSessionId) {
      return res.status(409).json({
        success: false,
        error: getPublicErrorMessage('执行环境未就绪，无法维持状态'),
      });
    }

    await setSandboxMetadata(orchestratorSessionId, {
      lastHeartbeatAt: new Date().toISOString(),
      lastHeartbeatReason: 'ui_keepalive',
    });
    try {
      await e2bConnector.getSandboxInfo(orchestratorSessionId);
    } catch (error) {
      console.warn('[RUNTIME_TOUCH] sandbox info failed', orchestratorSessionId, error);
    }

    return res.json({
      success: true,
      data: {
        orchestratorSessionId,
        touchedAt: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    console.error('维持执行环境失败:', error);
    res.status(500).json({
      success: false,
      error: getPublicErrorMessage('维持执行环境失败，请稍后重试'),
    });
  }
});

/**
 * GET /api/task-creation/sessions/:sessionId/connectors
 * 获取当前会话的连接器运行状态
 */
router.get('/sessions/:sessionId/connectors', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const { sessionId } = req.params;
    await sessionConnectorService.assertSessionOwnership(sessionId, currentUser.userId);
    const statuses = await sessionConnectorService.listSessionConnectors(sessionId, currentUser.userId);
    return res.json({
      success: true,
      data: {
        items: statuses,
        summary: sessionConnectorService.summarizeStatuses(statuses),
      },
    });
  } catch (error: any) {
    return res.status(401).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '获取会话连接器失败'),
    });
  }
});

/**
 * POST /api/task-creation/sessions/:sessionId/connectors/:connectorKey/attach
 * 热加载当前会话连接器
 */
router.post('/sessions/:sessionId/connectors/:connectorKey/attach', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const { sessionId } = req.params;
    const connectorKey = parseConnectorKey(req.params.connectorKey);
    await sessionConnectorService.assertSessionOwnership(sessionId, currentUser.userId);
    const runtime = await ensureTaskSessionRuntime(sessionId);
    const status = await sessionConnectorService.attachConnector(
      sessionId,
      currentUser.userId,
      connectorKey,
      runtime.orchestratorSessionId
    );
    return res.json({
      success: true,
      data: {
        runtime,
        connector: status,
      },
    });
  } catch (error: any) {
    const message = error?.message || '挂载连接器失败';
    const normalized = String(message).toLowerCase();
    const status =
      normalized.includes('无权') || normalized.includes('登录') || normalized.includes('x-user-id')
        ? 401
        : normalized.includes('未授权') || normalized.includes('尚未完成授权')
          ? 409
          : 400;
    return res.status(status).json({
      success: false,
      error: getPublicErrorMessage(message),
    });
  }
});

/**
 * POST /api/task-creation/sessions/:sessionId/connectors/:connectorKey/detach
 * 热卸载当前会话连接器
 */
router.post('/sessions/:sessionId/connectors/:connectorKey/detach', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const { sessionId } = req.params;
    const connectorKey = parseConnectorKey(req.params.connectorKey);
    await sessionConnectorService.assertSessionOwnership(sessionId, currentUser.userId);
    const session = await resolveTaskSessionRecord(sessionId);
    const status = await sessionConnectorService.detachConnector(
      sessionId,
      currentUser.userId,
      connectorKey,
      session?.runtime?.orchestratorSessionId
    );
    return res.json({
      success: true,
      data: {
        connector: status,
      },
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '卸载连接器失败'),
    });
  }
});

/**
 * GET /api/task-creation/sessions/:sessionId/debug
 * 获取调试浏览器信息（仅查询，不触发启动）
 */
router.get('/sessions/:sessionId/debug', async (req, res) => {
  try {
    const { sessionId } = req.params;
    let session = await taskCreationFileMemoryStore.getSession(sessionId);
    if (!session) {
      session = await hydrateFileSessionFromDb(sessionId);
    }
    if (!session) {
      return res.status(404).json({
        success: false,
        error: getPublicErrorMessage('会话不存在'),
      });
    }

    const orchestratorSessionId = asText(session.runtime?.orchestratorSessionId);
    if (!orchestratorSessionId) {
      return res.status(409).json({
        success: false,
        error: getPublicErrorMessage('执行环境未就绪，无法获取调试信息'),
      });
    }

    const environment = await sandboxExecutionEnvironmentDAO.getBySessionId(orchestratorSessionId);
    if (!environment) {
      return res.status(404).json({
        success: false,
        error: getPublicErrorMessage('执行环境不存在'),
      });
    }

    const metadata = pickRecord(environment.metadata);
    const debugMeta = pickRecord(metadata.debug);
    const nekoMeta = pickRecord(debugMeta.neko);
    const baseUrl = asText(nekoMeta.baseUrl) || asText(nekoMeta.url);
    const clientUrl = asText(nekoMeta.clientUrl);
    const status = asText(nekoMeta.status) || environment.status;
    const ready = Boolean(baseUrl) && (status === 'running' || status === 'ready') && environment.status === 'ready';

    return res.json({
      success: true,
      data: {
        ready,
        url: clientUrl || baseUrl || undefined,
        status: status || environment.status,
        updatedAt: toIso(environment.updatedAt as any),
        sandboxId: orchestratorSessionId,
        message: baseUrl ? asText(nekoMeta.message) || undefined : '调试服务未配置或未启动',
      },
    });
  } catch (error: any) {
    console.error('获取调试信息失败:', error);
    res.status(500).json({
      success: false,
      error: getPublicErrorMessage('获取调试信息失败，请稍后重试'),
    });
  }
});

/**
 * POST /api/task-creation/sessions/:sessionId/debug/start
 * 启动调试浏览器（会执行 sandbox 内安装与启动，不创建新 sandbox）
 */
router.post('/sessions/:sessionId/debug/start', async (req, res) => {
  try {
    const { sessionId } = req.params;
    let session = await taskCreationFileMemoryStore.getSession(sessionId);
    if (!session) {
      session = await hydrateFileSessionFromDb(sessionId);
    }
    if (!session) {
      return res.status(404).json({
        success: false,
        error: getPublicErrorMessage('会话不存在'),
      });
    }

    const orchestratorSessionId = asText(session.runtime?.orchestratorSessionId);
    if (!orchestratorSessionId) {
      return res.status(409).json({
        success: false,
        error: getPublicErrorMessage('执行环境未就绪，无法启动调试'),
      });
    }

    const environment = await sandboxExecutionEnvironmentDAO.getBySessionId(orchestratorSessionId);
    if (!environment) {
      return res.status(404).json({
        success: false,
        error: getPublicErrorMessage('执行环境不存在'),
      });
    }
    if (environment.status !== 'ready') {
      return res.status(409).json({
        success: false,
        error: getPublicErrorMessage('执行环境未启动，无法启动调试'),
      });
    }

    const result = await ensureNekoDebug(orchestratorSessionId);
    return res.json({
      success: true,
      data: {
        ready: result.ready,
        url: result.url,
        status: result.status,
        updatedAt: result.updatedAt,
        sandboxId: result.sandboxId,
        message: result.message,
      },
    });
  } catch (error: any) {
    console.error('启动调试失败:', error);
    res.status(500).json({
      success: false,
      error: getPublicErrorMessage('启动调试失败，请稍后重试'),
    });
  }
});

/**
 * GET /api/task-creation/sessions/:sessionId/workspace/dir
 * 分页获取指定目录的直接子项（用于前端渐进式加载文件树）
 */
router.get('/sessions/:sessionId/workspace/dir', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await taskCreationFileMemoryStore.getSession(sessionId);
    const rawPath = String(req.query.path || '').trim();
    if (rawPath && isUnsafePath(rawPath)) {
      return res.status(400).json({
        success: false,
        error: getPublicErrorMessage('非法路径'),
      });
    }
    const dirPath = normalizeWorkspacePath(rawPath);
    const limit = clampNumber(Number(req.query.limit || 200), 50, 1000);
    const rawCursor = Number(req.query.cursor || 0);
    const cursor = Number.isFinite(rawCursor) && rawCursor > 0 ? Math.floor(rawCursor) : 0;
    const includeIgnored = !['0', 'false', 'no'].includes(
      String(req.query.includeIgnored ?? '1').trim().toLowerCase()
    );

    const orchestratorSessionId = session?.runtime?.orchestratorSessionId;
    if (!orchestratorSessionId) {
      return res.status(409).json({
        success: false,
        error: getPublicErrorMessage('执行环境未就绪，无法读取目录'),
      });
    }
    const runtimeStatus = await resolveRuntimeStatus(orchestratorSessionId);
    if (runtimeStatus?.status && runtimeStatus.status !== 'ready') {
      return res.status(409).json({
        success: false,
        error: getPublicErrorMessage('执行环境未启动，无法读取目录'),
      });
    }

    const workspaceRoot = resolveOpencodeWorkspacePath(sessionId);
    await ensureOpencodeServer(orchestratorSessionId, workspaceRoot);
    const nodes = await listOpencodeDirectory(orchestratorSessionId, workspaceRoot, dirPath);
    const normalizedCandidates = nodes
      .map((node): { path: string; type: 'file' | 'dir'; ignored: boolean } | null => {
        const normalizedPath = normalizeWorkspacePath(node.path || '');
        if (!normalizedPath) return null;
        return {
          path: normalizedPath,
          type: node.type === 'directory' ? 'dir' : 'file',
          ignored: Boolean(node.ignored),
        };
      })
      .filter((item): item is { path: string; type: 'file' | 'dir'; ignored: boolean } => Boolean(item));
    const normalizedItems = sortWorkspaceTreeItems(
      normalizedCandidates
        .filter((item) => includeIgnored || !item.ignored)
        .map((item) => ({ path: item.path, type: item.type }))
    );

    const total = normalizedItems.length;
    const start = Math.min(Math.max(0, cursor), total);
    const end = Math.min(total, start + limit);
    const pageItems = normalizedItems.slice(start, end);

    await touchSandbox(orchestratorSessionId, 'workspace_dir');

    return res.json({
      success: true,
      data: {
        root: workspaceRoot,
        path: dirPath,
        items: pageItems,
        cursor: start,
        total,
        returned: pageItems.length,
        limit,
        hasMore: end < total,
        nextCursor: end < total ? end : null,
      },
    });
  } catch (error: any) {
    const { sessionId } = req.params;
    if (isSandboxNotFoundError(error)) {
      const session = await taskCreationFileMemoryStore.getSession(sessionId);
      const orchestratorSessionId = session?.runtime?.orchestratorSessionId;
      if (orchestratorSessionId) {
        await markSandboxClosed(orchestratorSessionId);
      }
      return res.status(409).json({
        success: false,
        error: getPublicErrorMessage('执行环境已关闭，请重新启动'),
      });
    }
    console.error('获取目录列表失败:', error);
    res.status(500).json({
      success: false,
      error: getPublicErrorMessage('获取目录列表失败，请稍后重试'),
    });
  }
});

/**
 * GET /api/task-creation/sessions/:sessionId/workspace/tree
 * 获取会话对应工作区的文件树
 */
router.get('/sessions/:sessionId/workspace/tree', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await taskCreationFileMemoryStore.getSession(sessionId);
    const refresh = parseRefreshFlag(req.query.refresh);
    const tenantKey = resolveTenantKey(req);
    if (!refresh) {
      const cached = await taskCreationCacheStore.getWorkspaceTree(tenantKey, sessionId);
      if (cached) {
        return res.json({
          success: true,
          data: cached.data,
          cache: { hit: true, ageMs: cached.ageMs, stale: cached.stale },
        });
      }
    }

    const orchestratorSessionId = session?.runtime?.orchestratorSessionId;
    if (!orchestratorSessionId) {
      return res.status(409).json({
        success: false,
        error: getPublicErrorMessage('执行环境未就绪，无法读取工作区'),
      });
    }
    const runtimeStatus = await resolveRuntimeStatus(orchestratorSessionId);
    if (runtimeStatus?.status && runtimeStatus.status !== 'ready') {
      return res.status(409).json({
        success: false,
        error: getPublicErrorMessage('执行环境未启动，无法读取工作区'),
      });
    }

    const workspaceRoot = resolveOpencodeWorkspacePath(sessionId);
    const maxDepth = clampNumber(Number(req.query.depth || 6), 1, 8);
    const maxEntries = clampNumber(Number(req.query.maxEntries || 2000), 200, 5000);

    await ensureOpencodeServer(orchestratorSessionId, workspaceRoot);
    const parsed = await buildWorkspaceTreeFromOpencode({
      orchestratorSessionId,
      workspaceRoot,
      maxDepth,
      maxEntries,
    });
    await touchSandbox(orchestratorSessionId, 'workspace_tree');

    const ttlMs = clampNumber(
      Number(process.env.TASK_CREATION_CACHE_TTL_TREE_MS || 10000),
      1000,
      60000
    );
    await taskCreationCacheStore.setWorkspaceTree(tenantKey, sessionId, parsed, ttlMs);

    return res.json({
      success: true,
      data: parsed,
      cache: { hit: false },
    });
  } catch (error: any) {
    const tenantKey = resolveTenantKey(req);
    const { sessionId } = req.params;
    if (isSandboxNotFoundError(error)) {
      const session = await taskCreationFileMemoryStore.getSession(sessionId);
      const orchestratorSessionId = session?.runtime?.orchestratorSessionId;
      if (orchestratorSessionId) {
        await markSandboxClosed(orchestratorSessionId);
      }
      return res.status(409).json({
        success: false,
        error: getPublicErrorMessage('执行环境已关闭，请重新启动'),
      });
    }
    const fallback = await taskCreationCacheStore.getWorkspaceTree(tenantKey, sessionId, { allowStale: true });
    if (fallback) {
      return res.json({
        success: true,
        data: fallback.data,
        cache: { hit: true, ageMs: fallback.ageMs, stale: true },
      });
    }
    console.error('获取工作区文件树失败:', error);
    res.status(500).json({
      success: false,
      error: getPublicErrorMessage('获取工作区文件树失败，请稍后重试'),
    });
  }
});

/**
 * GET /api/task-creation/sessions/:sessionId/workspace/file
 * 读取会话工作区内的文件内容
 */
router.get('/sessions/:sessionId/workspace/file', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const relativePath = String(req.query.path || '').trim();
    if (isUnsafePath(relativePath)) {
      return res.status(400).json({
        success: false,
        error: getPublicErrorMessage('非法路径'),
      });
    }
    const normalizedPath = relativePath.replace(/\\/g, '/');

    const session = await taskCreationFileMemoryStore.getSession(sessionId);
    const refresh = parseRefreshFlag(req.query.refresh);
    const tenantKey = resolveTenantKey(req);
    if (!refresh) {
      const cached = await taskCreationCacheStore.getWorkspaceFile(tenantKey, sessionId, normalizedPath);
      if (cached) {
        return res.json({
          success: true,
          data: cached.data,
          cache: { hit: true, ageMs: cached.ageMs, stale: cached.stale },
        });
      }
    }

    const orchestratorSessionId = session?.runtime?.orchestratorSessionId;
    if (!orchestratorSessionId) {
      return res.status(409).json({
        success: false,
        error: getPublicErrorMessage('执行环境未就绪，无法读取文件'),
      });
    }
    const runtimeStatus = await resolveRuntimeStatus(orchestratorSessionId);
    if (runtimeStatus?.status && runtimeStatus.status !== 'ready') {
      return res.status(409).json({
        success: false,
        error: getPublicErrorMessage('执行环境未启动，无法读取文件'),
      });
    }

    const workspaceRoot = resolveOpencodeWorkspacePath(sessionId);
    const maxBytes = clampNumber(Number(req.query.maxBytes || 200000), 20000, 500000);

    await ensureOpencodeServer(orchestratorSessionId, workspaceRoot);
    const content = await readOpencodeFile(orchestratorSessionId, workspaceRoot, normalizedPath);
    const isBinary = content.type !== 'text' || content.encoding === 'base64';
    const mimeType = resolveMimeType(normalizedPath, content.mimeType);
    const previewType = detectPreviewType(normalizedPath, mimeType, isBinary);
    const maxBinaryBytes = clampNumber(
      Number(req.query.maxBinaryBytes || 2 * 1024 * 1024),
      64 * 1024,
      10 * 1024 * 1024
    );

    let parsed:
      | {
          path: string;
          content: string;
          truncated: boolean;
          size: number;
          isBinary: boolean;
          encoding: string;
          mimeType: string;
          previewType: WorkspacePreviewType;
          previewAvailable: boolean;
          binaryTooLarge?: boolean;
        }
      | {
          path: string;
          content: string;
          truncated: boolean;
          size: number;
          isBinary: boolean;
          encoding: string;
          mimeType: string;
          previewType: WorkspacePreviewType;
          previewAvailable: boolean;
          binaryTooLarge?: boolean;
        };

    if (isBinary) {
      const encoded = (content.content || '').trim();
      const base64Content =
        content.encoding === 'base64'
          ? encoded
          : Buffer.from(content.content || '', 'utf8').toString('base64');
      const byteSize = estimateBase64Bytes(base64Content);
      const binaryTooLarge = byteSize > maxBinaryBytes;
      const previewableKinds = new Set<WorkspacePreviewType>(['image', 'video', 'audio', 'pdf']);
      parsed = {
        path: normalizedPath,
        content: binaryTooLarge ? '' : base64Content,
        truncated: binaryTooLarge,
        size: byteSize,
        isBinary: true,
        encoding: 'base64',
        mimeType,
        previewType,
        previewAvailable: !binaryTooLarge && previewableKinds.has(previewType),
        binaryTooLarge,
      };
    } else {
      const textContent = content.content || '';
      const trimmed = truncateUtf8(textContent, maxBytes);
      parsed = {
        path: normalizedPath,
        content: trimmed.text,
        truncated: trimmed.truncated,
        size: trimmed.size,
        isBinary: false,
        encoding: 'utf8',
        mimeType,
        previewType,
        previewAvailable: true,
      };
    }

    const ttlMs = clampNumber(
      Number(process.env.TASK_CREATION_CACHE_TTL_FILE_MS || 60000),
      5000,
      300000
    );
    await taskCreationCacheStore.setWorkspaceFile(tenantKey, sessionId, normalizedPath, parsed, ttlMs);
    await touchSandbox(orchestratorSessionId, 'workspace_file');

    return res.json({
      success: true,
      data: parsed,
      cache: { hit: false },
    });
  } catch (error: any) {
    const tenantKey = resolveTenantKey(req);
    const { sessionId } = req.params;
    if (isSandboxNotFoundError(error)) {
      const session = await taskCreationFileMemoryStore.getSession(sessionId);
      const orchestratorSessionId = session?.runtime?.orchestratorSessionId;
      if (orchestratorSessionId) {
        await markSandboxClosed(orchestratorSessionId);
      }
      return res.status(409).json({
        success: false,
        error: getPublicErrorMessage('执行环境已关闭，请重新启动'),
      });
    }
    const relativePath = String(req.query.path || '').trim();
    const normalizedPath = relativePath.replace(/\\/g, '/');
    const fallback = await taskCreationCacheStore.getWorkspaceFile(tenantKey, sessionId, normalizedPath, {
      allowStale: true,
    });
    if (fallback) {
      return res.json({
        success: true,
        data: fallback.data,
        cache: { hit: true, ageMs: fallback.ageMs, stale: true },
      });
    }
    console.error('读取工作区文件失败:', error);
    res.status(500).json({
      success: false,
      error: getPublicErrorMessage('读取工作区文件失败，请稍后重试'),
    });
  }
});

/**
 * GET /api/task-creation/sessions/:sessionId/opencode/events
 * SSE 转发 OpenCode 全局事件流（按会话过滤）。
 *
 * 注意：即使是“sandbox 直通”模式，也必须走编排平台转发，
 * 以保证事件落盘与历史回放一致，避免前端直连 sandbox 导致丢消息。
 */
router.get('/sessions/:sessionId/opencode/events', async (req, res) => {
  const { sessionId } = req.params;
  const session = await taskCreationFileMemoryStore.getSession(sessionId);
  if (!session) {
    return res.status(404).json({
      success: false,
      error: getPublicErrorMessage('会话不存在'),
    });
  }

  const orchestratorSessionId = session.runtime?.orchestratorSessionId;
  if (!orchestratorSessionId) {
    return res.status(409).json({
      success: false,
      error: getPublicErrorMessage('执行环境未就绪，无法订阅事件流'),
    });
  }
  opencodeEventStreamService.bindSession(orchestratorSessionId, sessionId, session.mode);

  const runtimeStatus = await resolveRuntimeStatus(orchestratorSessionId);
  if (runtimeStatus?.status && runtimeStatus.status !== 'ready') {
    return res.status(409).json({
      success: false,
      error: getPublicErrorMessage('执行环境未启动，无法订阅事件流'),
    });
  }

  const opencodeSessionId =
    (typeof req.query.opencodeSessionId === 'string' && req.query.opencodeSessionId.trim()) ||
    session.runtime?.opencodeSessionId ||
    '';
  const clientId = parseSseClientId(req);

  const workspaceRoot = resolveOpencodeWorkspacePath(sessionId);
  const filterSessionId = String(opencodeSessionId || '').trim();
  const parseSince = (value: unknown): number => {
    if (!value) return 0;
    if (Array.isArray(value)) {
      return parseSince(value[0]);
    }
    const raw = String(value || '').trim();
    if (!raw) return 0;
    const asNumber = Number(raw);
    if (!Number.isNaN(asNumber) && Number.isFinite(asNumber)) {
      return asNumber;
    }
    const parsed = Date.parse(raw);
    return Number.isNaN(parsed) ? 0 : parsed;
  };
  const querySince = parseSince(req.query.since);
  const headerSince = parseSince(
    req.headers['last-event-id'] || (req.headers as Record<string, unknown>)['Last-Event-ID']
  );
  const sinceParam = querySince || headerSince;
  let connection: ReturnType<typeof registerSseClientConnection> | null = null;
  let replayCursor = sinceParam;
  let isTimestampCursor = replayCursor >= 1_000_000_000_000;
  let fallbackReplayTs = Date.now();

  try {
    await osacAgentService.ensureOpencodeServer(orchestratorSessionId, {
      workspacePath: workspaceRoot,
    });
  } catch (error: any) {
    if (isSandboxNotFoundError(error)) {
      await markSandboxClosed(orchestratorSessionId);
      return res.status(409).json({
        success: false,
        error: getPublicErrorMessage('执行环境已关闭，请重新启动'),
      });
    }
    return res.status(502).json({
      success: false,
      error: getPublicErrorMessage(error?.message || 'OpenCode 服务未就绪'),
    });
  }

  connection = registerSseClientConnection(sessionId, clientId);
  const activeConnection = connection;
  const stateCursor =
    activeConnection.reconnecting && activeConnection.state.lastCursor > 0
      ? activeConnection.state.lastCursor
      : 0;
  if (!replayCursor) {
    replayCursor = stateCursor;
  } else if (stateCursor > 0) {
    const queryIsTimestamp = isTimestampCursorValue(replayCursor);
    const stateIsTimestamp = isTimestampCursorValue(stateCursor);
    replayCursor =
      queryIsTimestamp === stateIsTimestamp
        ? Math.max(replayCursor, stateCursor)
        : stateCursor;
  }
  isTimestampCursor = isTimestampCursorValue(replayCursor);
  fallbackReplayTs =
    activeConnection.previousDisconnectedAt > 0
      ? activeConnection.previousDisconnectedAt
      : activeConnection.state.connectedAt;
  console.log(
    '[OPENCODE_SSE_CLIENT_CONNECTED]',
    JSON.stringify({
      sessionId,
      orchestratorSessionId,
      clientId,
      reconnecting: activeConnection.reconnecting,
      replayCursor,
      connectedAt: new Date(activeConnection.state.connectedAt).toISOString(),
      previousDisconnectedAt: activeConnection.previousDisconnectedAt
        ? new Date(activeConnection.previousDisconnectedAt).toISOString()
        : null,
    })
  );

  await touchSandbox(orchestratorSessionId, 'opencode_events');

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const pingMs = Math.max(5000, Number(process.env.OPENCODE_EVENT_PROXY_PING_MS || 15000));

  const pingTimer = setInterval(() => {
    res.write(': ping\n\n');
  }, pingMs);

  if (replayCursor) {
    try {
      const history = await taskCreationFileMemoryStore.getMessages(sessionId);
      const pickCursorFromItem = (item: any) => {
        const meta = pickRecord(item?.metadata);
        const seq = Number(meta.seq);
        const tsMeta = Number(meta.timestamp);
        const tsCreated = item?.createdAt ? Date.parse(item.createdAt) : NaN;
        if (isTimestampCursor) {
          if (Number.isFinite(tsMeta) && tsMeta > 0) return tsMeta;
          if (Number.isFinite(tsCreated) && tsCreated > 0) return tsCreated;
          if (Number.isFinite(seq) && seq > 0) return seq;
          return 0;
        }
        if (Number.isFinite(seq) && seq > 0) return seq;
        if (Number.isFinite(tsMeta) && tsMeta > fallbackReplayTs) return tsMeta;
        if (Number.isFinite(tsCreated) && tsCreated > fallbackReplayTs) return tsCreated;
        return 0;
      };
      const filtered = history
        .filter((item) => item.messageType === 'opencode_event')
        .filter((item) => {
          const cursor = pickCursorFromItem(item);
          if (!Number.isFinite(cursor) || cursor <= 0) return false;
          return cursor > replayCursor;
        })
        .filter((item) => {
          if (!filterSessionId) return true;
          const metadata = pickRecord(item.metadata);
          const msgOpencodeSessionId = asText(metadata.opencodeSessionId);
          if (!msgOpencodeSessionId) return false;
          return msgOpencodeSessionId === filterSessionId;
        })
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
        .slice(-500);
      for (const item of filtered) {
        const meta = pickRecord(item.metadata);
        const eventId =
          (typeof meta.seq === 'number' && Number.isFinite(meta.seq) && meta.seq > 0 ? meta.seq : undefined) ??
          (typeof meta.timestamp === 'number' && Number.isFinite(meta.timestamp) && meta.timestamp > 0
            ? meta.timestamp
            : undefined) ??
          (item.createdAt ? Date.parse(item.createdAt) : undefined);
        writeSse(res, {
          sessionId,
          type: item.messageType,
          content: item.content,
          metadata: item.metadata,
          createdAt: item.createdAt,
        }, undefined, Number.isFinite(eventId as number) ? (eventId as number) : undefined);
        if (Number.isFinite(eventId as number) && (eventId as number) > 0) {
          updateSseClientCursor(activeConnection.key, eventId as number);
        }
      }
    } catch (error) {
      console.warn('[OPENCODE_SSE_REPLAY_FAILED]', error);
    }
  }

  const unsubscribe = opencodeEventStreamService.subscribe(orchestratorSessionId, (payload) => {
    const msgOpencodeSessionId = String(payload.opencodeSessionId || '').trim();
    if (filterSessionId && msgOpencodeSessionId && msgOpencodeSessionId !== filterSessionId) {
      return;
    }
    const createdAt = new Date(payload.timestamp || Date.now()).toISOString();
    const liveEventId =
      (typeof payload.seq === 'number' && Number.isFinite(payload.seq) && payload.seq > 0
        ? payload.seq
        : undefined) ??
      (typeof payload.timestamp === 'number' && Number.isFinite(payload.timestamp) && payload.timestamp > 0
        ? payload.timestamp
        : undefined) ??
      Date.parse(createdAt);
    writeSse(
      res,
      {
        sessionId,
        opencodeSessionId: msgOpencodeSessionId || undefined,
        eventType: payload.eventType,
        event: payload.event,
        createdAt,
        metadata: {
          seq: payload.seq,
          timestamp: payload.timestamp,
          opencodeSessionId: msgOpencodeSessionId || undefined,
          },
      },
      undefined,
      Number.isFinite(liveEventId as number) ? (liveEventId as number) : undefined
    );
    if (Number.isFinite(liveEventId as number) && (liveEventId as number) > 0) {
      updateSseClientCursor(activeConnection.key, liveEventId as number);
    }
  });

  writeSse(
    res,
    {
      status: 'connected',
      reconnecting: activeConnection.reconnecting,
      clientId,
      connectedAt: new Date(activeConnection.state.connectedAt).toISOString(),
      disconnectedAt: activeConnection.previousDisconnectedAt
        ? new Date(activeConnection.previousDisconnectedAt).toISOString()
        : undefined,
      replayCursor: replayCursor || undefined,
      relay: 'backend_only',
    },
    'bridge'
  );

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clearInterval(pingTimer);
    unsubscribe();
    console.log(
      '[OPENCODE_SSE_CLIENT_DISCONNECTED]',
      JSON.stringify({
        sessionId,
        orchestratorSessionId,
        clientId,
        lastCursor: sseClientState.get(activeConnection.key)?.lastCursor || 0,
        disconnectedAt: new Date().toISOString(),
      })
    );
    markSseClientDisconnected(activeConnection.key);
    res.end();
  };

  req.on('close', cleanup);
  req.on('error', cleanup);

  writeSse(res, { status: 'ready', opencodeSessionId: opencodeSessionId || undefined }, 'ready');
  return undefined;
});

/**
 * GET /api/task-creation/sessions/:sessionId/intent
 * 获取会话的意图识别结果
 */
router.get('/sessions/:sessionId/intent', async (req, res) => {
  try {
    const { sessionId } = req.params;

    const intentResult = await taskCreationSessionDAO.getIntentResult(sessionId);

    if (!intentResult) {
      return res.status(404).json({
        success: false,
        error: '意图识别结果不存在',
      });
    }

    res.json({
      success: true,
      data: intentResult,
    });
  } catch (error: any) {
    console.error('获取意图识别结果失败:', error);
    res.status(500).json({
      success: false,
      error: getPublicErrorMessage('获取意图识别结果失败，请稍后重试'),
    });
  }
});

/**
 * GET /api/task-creation/sessions/:sessionId/task-description
 * 获取会话的任务描述
 */
router.get('/sessions/:sessionId/task-description', async (req, res) => {
  try {
    const { sessionId } = req.params;

    const taskDescription = await taskCreationSessionDAO.getTaskDescription(sessionId);

    if (!taskDescription) {
      return res.status(404).json({
        success: false,
        error: '任务描述不存在',
      });
    }

    res.json({
      success: true,
      data: taskDescription,
    });
  } catch (error: any) {
    console.error('获取任务描述失败:', error);
    res.status(500).json({
      success: false,
      error: getPublicErrorMessage('获取任务描述失败，请稍后重试'),
    });
  }
});

/**
 * GET /api/task-creation/sessions/:sessionId/execution-plan
 * 获取会话的执行计划
 */
router.get('/sessions/:sessionId/execution-plan', async (req, res) => {
  try {
    const { sessionId } = req.params;

    const executionPlan = await taskCreationSessionDAO.getExecutionPlan(sessionId);

    if (!executionPlan) {
      return res.status(404).json({
        success: false,
        error: '执行计划不存在',
      });
    }

    res.json({
      success: true,
      data: executionPlan,
    });
  } catch (error: any) {
    console.error('获取执行计划失败:', error);
    res.status(500).json({
      success: false,
      error: getPublicErrorMessage('获取执行计划失败，请稍后重试'),
    });
  }
});

/**
 * DELETE /api/task-creation/sessions/:sessionId
 * 删除会话（级联删除所有关联数据）
 */
router.delete('/sessions/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;

    await taskCreationSessionDAO.deleteSession(sessionId);

    res.json({
      success: true,
      message: '会话已删除',
    });
  } catch (error: any) {
    console.error('删除会话失败:', error);
    res.status(500).json({
      success: false,
      error: getPublicErrorMessage('删除会话失败，请稍后重试'),
    });
  }
});

export default router;
