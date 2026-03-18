import { getApiBaseUrl, getTaskCreationWsUrl } from "@/lib/runtime-config";
import { buildClientIdentityHeaders } from "@/lib/client-identity";

export type TaskCreationSessionSummary = {
  id: string;
  title?: string;
  titleLocked?: boolean;
  titleSource?: "placeholder" | "first_explicit_user_input" | "manual";
  titleResolvedAt?: string;
  isFavorite?: boolean;
  projectId?: string | null;
  projectName?: string | null;
  shareEnabled?: boolean;
  shareToken?: string | null;
  status?: string;
  stage?: string;
  phase?: string;
  driver?: "altus" | "opencode" | "claudecode" | "codex";
  executor?: "opencode" | "claudecode" | "codex";
  updatedAt?: string;
};

export type CreateTaskCreationSessionInput = {
  sessionId?: string;
  title?: string;
  mode?: "sandbox" | "altus";
  executor?: "opencode" | "claudecode" | "codex";
  initialMessage?: string;
  initialMessageType?: "user_input" | "user_response";
};

export type TaskCreationHistoryMessage = {
  id?: string;
  messageKey?: string;
  role?: string;
  content?: string;
  messageType?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
};

export type TaskCreationHistoryRecentPage = {
  messages: TaskCreationHistoryMessage[];
  oldestCursor: number | null;
  newestCursor: number | null;
  hasOlderHistory: boolean;
  source?: string;
};

export type TaskCreationHistoryOlderPage = {
  messages: TaskCreationHistoryMessage[];
  oldestCursor: number | null;
  newestCursor: number | null;
  nextBeforeCursor: number | null;
  hasMore: boolean;
  source?: string;
};

export type TaskCreationRuntimeStatus = {
  status?: string;
  provider?: string;
  updatedAt?: string;
  sandboxId?: string;
  codexRestoreStatus?: "not_needed" | "session_restored" | "session_restore_failed" | "state_restore_failed";
  codexRestoreAt?: string;
  codexRestoreSourceKey?: string;
  previousExecutorSessionId?: string;
  codexRestoreFailureReason?: string;
};

export type TaskCreationUploadedAttachment = {
  name: string;
  path: string;
  size: number;
  mimeType?: string;
  uploadedAt?: string;
};

export type RemoteAttachmentProvider = "website" | "google-drive" | "onedrive";

export type TaskCreationDebugInfo = {
  ready: boolean;
  url?: string;
  status?: string;
  updatedAt?: string;
  sandboxId?: string;
  message?: string;
};

export type TaskCreationDeploymentLog = {
  timestamp?: string;
  message: string;
  severity?: string;
};

export type TaskCreationDeploymentRecord = {
  id: string;
  status: string;
  createdAt?: string;
  serviceName?: string;
  commitMessage?: string;
  commitAuthor?: string;
  url?: string;
  staticUrl?: string;
};

export type TaskCreationDeploymentInfo = {
  configured: boolean;
  canDeploy: boolean;
  message?: string;
  projectId?: string;
  projectName?: string;
  environmentId?: string;
  environmentName?: string;
  serviceId?: string;
  serviceName?: string;
  deploymentId?: string;
  latestStatus?: string;
  latestUrl?: string;
  latestStaticUrl?: string;
  activeDeploymentPending: boolean;
  domains: string[];
  deployments: TaskCreationDeploymentRecord[];
  logs: TaskCreationDeploymentLog[];
  missing: string[];
};

export type TaskCreationDatabaseConnectionInfo = {
  connectionUrl: string;
  publicConnectionUrl?: string;
  host: string;
  port: string;
  username: string;
  password: string;
  database: string;
  sslMode: "require";
};

export type TaskCreationDatabaseTable = {
  id: string;
  schema: string;
  name: string;
  rowCount: number;
  sourceLabel: string;
};

export type TaskCreationDatabaseColumn = {
  name: string;
  dataType: string;
  format?: string;
  isNullable: boolean;
  isPrimaryKey: boolean;
  hasDefault: boolean;
  defaultValue?: string;
};

export type TaskCreationDatabaseInfo = {
  configured: boolean;
  provider: "railway_postgres";
  serviceId: string;
  serviceName: string;
  volumeId?: string;
  volumeName?: string;
  latestDeploymentStatus?: string;
  latestDeploymentAt?: string;
  connection: TaskCreationDatabaseConnectionInfo;
  tables: TaskCreationDatabaseTable[];
};

export type TaskCreationDatabaseRowLocator = {
  ctid?: string;
  primaryKey?: Record<string, unknown>;
};

export type TaskCreationDatabaseRowsPage = {
  table: TaskCreationDatabaseTable;
  columns: TaskCreationDatabaseColumn[];
  rows: Array<Record<string, unknown>>;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type TaskCreationSessionDetail = {
  id: string;
  title?: string;
  titleLocked?: boolean;
  titleSource?: "placeholder" | "first_explicit_user_input" | "manual";
  titleResolvedAt?: string;
  isFavorite?: boolean;
  projectId?: string | null;
  projectName?: string | null;
  shareEnabled?: boolean;
  shareToken?: string | null;
  status?: string;
  stage?: string;
  phase?: string;
  driver?: "altus" | "opencode" | "claudecode" | "codex";
  executor?: "opencode" | "claudecode" | "codex";
  runtime?: {
    generation?: number;
    orchestratorSessionId?: string;
    executor?: "opencode" | "claudecode" | "codex";
    executorSessionId?: string;
    opencodeSessionId?: string;
    codexRestoreStatus?: "not_needed" | "session_restored" | "session_restore_failed" | "state_restore_failed";
    codexRestoreAt?: string;
    codexRestoreSourceKey?: string;
    previousExecutorSessionId?: string;
    codexRestoreFailureReason?: string;
    updatedAt?: string;
  };
  runtimeStatus?: TaskCreationRuntimeStatus | null;
  connectorsSummary?: {
    total?: number;
    attached?: number;
    active?: number;
    needsAuth?: number;
    failed?: number;
  } | null;
};

export type OsacMessagePayload = Record<string, unknown>;

export type OsacMessageRecord = {
  type?: string;
  payload?: OsacMessagePayload;
  requestId?: string;
};

export type WorkspaceTreeItem = {
  path: string;
  type: "file" | "dir";
};

export type WorkspaceTree = {
  root: string;
  items: WorkspaceTreeItem[];
};

export type WorkspaceDirectoryPage = {
  root: string;
  path: string;
  items: WorkspaceTreeItem[];
  total: number;
  returned: number;
  limit: number;
  hasMore: boolean;
  nextCursor: number | null;
};

export type WorkspaceFile = {
  path: string;
  content: string;
  truncated?: boolean;
  size?: number;
  isBinary?: boolean;
  encoding?: string;
  mimeType?: string;
  previewType?: "text" | "markdown" | "image" | "video" | "audio" | "pdf" | "binary";
  previewAvailable?: boolean;
  binaryTooLarge?: boolean;
};

async function fetchJson<T>(url: string, init?: RequestInit, options?: { timeoutMs?: number }): Promise<T> {
  const timeoutMs = options?.timeoutMs;
  const controller =
    typeof AbortController !== "undefined" && timeoutMs && timeoutMs > 0 ? new AbortController() : null;
  const timeoutId =
    controller && timeoutMs
      ? window.setTimeout(() => {
          controller.abort(new DOMException("request timeout", "AbortError"));
        }, timeoutMs)
      : null;

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: controller?.signal ?? init?.signal,
      cache: init?.cache || "no-store",
      headers: buildClientIdentityHeaders(init?.headers),
    });
  } finally {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  }
  if (!response.ok) {
    throw new Error(`request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: string };
    if (typeof payload?.error === "string" && payload.error.trim()) {
      return payload.error.trim();
    }
  } catch {
    // ignore non-json error bodies
  }
  return `request failed: ${response.status}`;
}

export function createTaskCreationSocket(): WebSocket {
  return new WebSocket(getTaskCreationWsUrl());
}

export async function listTaskCreationSessions(
  limit: number | 'all' = 200
): Promise<TaskCreationSessionSummary[]> {
  const url = `${getApiBaseUrl()}/api/task-creation/sessions?limit=${encodeURIComponent(String(limit))}`;
  const result = await fetchJson<{ data?: TaskCreationSessionSummary[] }>(url);
  return Array.isArray(result?.data) ? result.data : [];
}

export async function createTaskCreationSession(
  input: CreateTaskCreationSessionInput
): Promise<TaskCreationSessionSummary | null> {
  const url = `${getApiBaseUrl()}/api/task-creation/sessions`;
  const response = await fetch(url, {
    method: "POST",
    headers: buildClientIdentityHeaders({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(input || {}),
  });
  if (!response.ok) {
    throw new Error(`request failed: ${response.status}`);
  }
  const result = (await response.json()) as { data?: TaskCreationSessionSummary };
  return result?.data || null;
}

export async function listTaskCreationMessages(sessionId: string): Promise<TaskCreationHistoryMessage[]> {
  const safeSessionId = encodeURIComponent(sessionId);
  const url = `${getApiBaseUrl()}/api/task-creation/sessions/${safeSessionId}/messages`;
  const result = await fetchJson<{ data?: TaskCreationHistoryMessage[] }>(url);
  return Array.isArray(result?.data) ? result.data : [];
}

export async function getTaskCreationRecentMessages(sessionId: string): Promise<TaskCreationHistoryRecentPage> {
  const safeSessionId = encodeURIComponent(sessionId);
  const url = `${getApiBaseUrl()}/api/task-creation/sessions/${safeSessionId}/messages/recent`;
  const result = await fetchJson<{ data?: TaskCreationHistoryRecentPage }>(url, undefined, { timeoutMs: 2500 });
  return (
    result?.data || {
      messages: [],
      oldestCursor: null,
      newestCursor: null,
      hasOlderHistory: false,
    }
  );
}

export async function getTaskCreationOlderMessages(
  sessionId: string,
  options?: { before?: number | null; limit?: number }
): Promise<TaskCreationHistoryOlderPage> {
  const safeSessionId = encodeURIComponent(sessionId);
  const params = new URLSearchParams();
  if (typeof options?.before === 'number' && Number.isFinite(options.before) && options.before > 0) {
    params.set('before', String(Math.floor(options.before)));
  }
  if (typeof options?.limit === 'number' && Number.isFinite(options.limit) && options.limit > 0) {
    params.set('limit', String(Math.floor(options.limit)));
  }
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const url = `${getApiBaseUrl()}/api/task-creation/sessions/${safeSessionId}/messages/history${suffix}`;
  const result = await fetchJson<{ data?: TaskCreationHistoryOlderPage }>(url, undefined, { timeoutMs: 4000 });
  return (
    result?.data || {
      messages: [],
      oldestCursor: null,
      newestCursor: null,
      nextBeforeCursor: null,
      hasMore: false,
    }
  );
}

export async function createTaskCreationDraftSession(title?: string): Promise<TaskCreationSessionDetail> {
  const url = `${getApiBaseUrl()}/api/task-creation/sessions/draft`;
  const response = await fetch(url, {
    method: "POST",
    headers: buildClientIdentityHeaders({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({
      title: title || undefined,
    }),
  });
  if (!response.ok) {
    throw new Error(`request failed: ${response.status}`);
  }
  const result = (await response.json()) as { data?: TaskCreationSessionDetail };
  if (!result?.data) {
    throw new Error("draft session empty");
  }
  return result.data;
}

export async function resolveTaskCreationSessionTitle(
  sessionId: string,
  message: string
): Promise<{
  id: string;
  title?: string;
  titleLocked?: boolean;
  titleSource?: "placeholder" | "first_explicit_user_input" | "manual";
  titleResolvedAt?: string | null;
  resolved?: boolean;
} | null> {
  const safeSessionId = encodeURIComponent(sessionId);
  const url = `${getApiBaseUrl()}/api/task-creation/sessions/${safeSessionId}/title/resolve`;
  const response = await fetch(url, {
    method: "POST",
    headers: buildClientIdentityHeaders({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({
      message,
    }),
  });
  if (!response.ok) {
    throw new Error(`request failed: ${response.status}`);
  }
  const result = (await response.json()) as { data?: any };
  return result?.data || null;
}

export async function getTaskCreationSession(sessionId: string): Promise<TaskCreationSessionDetail | null> {
  const safeSessionId = encodeURIComponent(sessionId);
  const url = `${getApiBaseUrl()}/api/task-creation/sessions/${safeSessionId}`;
  const response = await fetch(url, {
    headers: buildClientIdentityHeaders(),
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`request failed: ${response.status}`);
  }
  const result = (await response.json()) as { data?: TaskCreationSessionDetail };
  return result?.data || null;
}

export async function renameTaskCreationSessionTitle(
  sessionId: string,
  title: string
): Promise<TaskCreationSessionSummary | null> {
  const safeSessionId = encodeURIComponent(sessionId);
  const url = `${getApiBaseUrl()}/api/task-creation/sessions/${safeSessionId}/title/rename`;
  const response = await fetch(url, {
    method: "POST",
    headers: buildClientIdentityHeaders({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({ title }),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  const result = (await response.json()) as { data?: TaskCreationSessionSummary };
  return result?.data || null;
}

export async function toggleTaskCreationSessionFavorite(
  sessionId: string,
  favorite: boolean
): Promise<TaskCreationSessionSummary | null> {
  const safeSessionId = encodeURIComponent(sessionId);
  const url = `${getApiBaseUrl()}/api/task-creation/sessions/${safeSessionId}/favorite`;
  const response = await fetch(url, {
    method: "POST",
    headers: buildClientIdentityHeaders({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({ favorite }),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  const result = (await response.json()) as { data?: TaskCreationSessionSummary };
  return result?.data || null;
}

export async function deleteTaskCreationSession(sessionId: string): Promise<void> {
  const safeSessionId = encodeURIComponent(sessionId);
  const url = `${getApiBaseUrl()}/api/task-creation/sessions/${safeSessionId}`;
  const response = await fetch(url, {
    method: "DELETE",
    headers: buildClientIdentityHeaders(),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
}

export async function getTaskCreationDebugInfo(sessionId: string): Promise<TaskCreationDebugInfo | null> {
  const safeSessionId = encodeURIComponent(sessionId);
  const url = `${getApiBaseUrl()}/api/task-creation/sessions/${safeSessionId}/debug`;
  const result = await fetchJson<{ data?: TaskCreationDebugInfo }>(url);
  return result?.data || null;
}

export async function startTaskCreationDebug(sessionId: string): Promise<TaskCreationDebugInfo | null> {
  const safeSessionId = encodeURIComponent(sessionId);
  const url = `${getApiBaseUrl()}/api/task-creation/sessions/${safeSessionId}/debug/start`;
  const response = await fetch(url, {
    method: "POST",
    headers: buildClientIdentityHeaders(),
  });
  if (!response.ok) {
    throw new Error(`request failed: ${response.status}`);
  }
  const result = (await response.json()) as { data?: TaskCreationDebugInfo };
  return result?.data || null;
}

export async function getTaskCreationDeploymentInfo(
  sessionId: string,
  deploymentId?: string
): Promise<TaskCreationDeploymentInfo | null> {
  const safeSessionId = encodeURIComponent(sessionId);
  const params = new URLSearchParams();
  if (deploymentId) {
    params.set("deploymentId", deploymentId);
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const url = `${getApiBaseUrl()}/api/task-creation/sessions/${safeSessionId}/deployment${suffix}`;
  const result = await fetchJson<{ data?: TaskCreationDeploymentInfo }>(url);
  return result?.data || null;
}

async function postTaskCreationDeploymentAction(
  sessionId: string,
  action: "deploy" | "redeploy" | "rollback",
  body?: Record<string, unknown>
): Promise<TaskCreationDeploymentInfo | null> {
  const safeSessionId = encodeURIComponent(sessionId);
  const url = `${getApiBaseUrl()}/api/task-creation/sessions/${safeSessionId}/deployment/${action}`;
  const response = await fetch(url, {
    method: "POST",
    headers: buildClientIdentityHeaders({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(body || {}),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  const result = (await response.json()) as { data?: TaskCreationDeploymentInfo };
  return result?.data || null;
}

export async function deployTaskCreationSession(
  sessionId: string
): Promise<TaskCreationDeploymentInfo | null> {
  return postTaskCreationDeploymentAction(sessionId, "deploy");
}

export async function redeployTaskCreationSession(
  sessionId: string,
  deploymentId: string
): Promise<TaskCreationDeploymentInfo | null> {
  return postTaskCreationDeploymentAction(sessionId, "redeploy", { deploymentId });
}

export async function rollbackTaskCreationSessionDeployment(
  sessionId: string,
  deploymentId: string
): Promise<TaskCreationDeploymentInfo | null> {
  return postTaskCreationDeploymentAction(sessionId, "rollback", { deploymentId });
}

export async function getTaskCreationDatabaseInfo(
  sessionId: string
): Promise<TaskCreationDatabaseInfo | null> {
  const safeSessionId = encodeURIComponent(sessionId);
  const url = `${getApiBaseUrl()}/api/task-creation/sessions/${safeSessionId}/deployment/database`;
  const result = await fetchJson<{ data?: TaskCreationDatabaseInfo }>(url);
  return result?.data || null;
}

export async function getTaskCreationDatabaseRows(
  sessionId: string,
  table: string,
  page: number = 1,
  pageSize: number = 50
): Promise<TaskCreationDatabaseRowsPage | null> {
  const safeSessionId = encodeURIComponent(sessionId);
  const params = new URLSearchParams({
    table,
    page: String(page),
    pageSize: String(pageSize),
  });
  const url = `${getApiBaseUrl()}/api/task-creation/sessions/${safeSessionId}/deployment/database/rows?${params.toString()}`;
  const result = await fetchJson<{ data?: TaskCreationDatabaseRowsPage }>(url);
  return result?.data || null;
}

async function mutateTaskCreationDatabaseRows<T>(
  sessionId: string,
  method: "POST" | "PATCH" | "DELETE",
  body: Record<string, unknown>
): Promise<T | null> {
  const safeSessionId = encodeURIComponent(sessionId);
  const url = `${getApiBaseUrl()}/api/task-creation/sessions/${safeSessionId}/deployment/database/rows`;
  const response = await fetch(url, {
    method,
    headers: buildClientIdentityHeaders({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  const result = (await response.json()) as { data?: T };
  return result?.data || null;
}

export async function insertTaskCreationDatabaseRow(
  sessionId: string,
  table: string,
  values: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
  return mutateTaskCreationDatabaseRows<Record<string, unknown>>(sessionId, "POST", {
    table,
    values,
  });
}

export async function updateTaskCreationDatabaseRow(
  sessionId: string,
  table: string,
  locator: TaskCreationDatabaseRowLocator,
  values: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
  return mutateTaskCreationDatabaseRows<Record<string, unknown>>(sessionId, "PATCH", {
    table,
    locator,
    values,
  });
}

export async function deleteTaskCreationDatabaseRow(
  sessionId: string,
  table: string,
  locator: TaskCreationDatabaseRowLocator
): Promise<{ deleted: number } | null> {
  return mutateTaskCreationDatabaseRows<{ deleted: number }>(sessionId, "DELETE", {
    table,
    locator,
  });
}

export async function startTaskCreationRuntime(sessionId: string): Promise<{
  orchestratorSessionId?: string;
  status?: string;
  reused?: boolean;
}> {
  const safeSessionId = encodeURIComponent(sessionId);
  const url = `${getApiBaseUrl()}/api/task-creation/sessions/${safeSessionId}/runtime/start`;
  const response = await fetch(url, {
    method: "POST",
    headers: buildClientIdentityHeaders(),
  });
  if (!response.ok) {
    throw new Error(`request failed: ${response.status}`);
  }
  const result = (await response.json()) as { data?: any };
  return result?.data || {};
}

export async function touchTaskCreationRuntime(sessionId: string): Promise<void> {
  const safeSessionId = encodeURIComponent(sessionId);
  const url = `${getApiBaseUrl()}/api/task-creation/sessions/${safeSessionId}/runtime/touch`;
  const response = await fetch(url, {
    method: "POST",
    headers: buildClientIdentityHeaders(),
  });
  if (!response.ok) {
    throw new Error(`request failed: ${response.status}`);
  }
}

export async function listOsacMessages(orchestratorSessionId: string, limit: number = 120): Promise<OsacMessageRecord[]> {
  const safeSessionId = encodeURIComponent(orchestratorSessionId);
  const url = `${getApiBaseUrl()}/api/sandbox/osac/${safeSessionId}/messages?limit=${limit}`;
  const result = await fetchJson<{ data?: OsacMessageRecord[] }>(url);
  return Array.isArray(result?.data) ? result.data : [];
}

export function getOpencodeEventStreamUrl(
  sessionId: string,
  opencodeSessionId?: string,
  since?: number,
  clientId?: string
): string {
  const safeSessionId = encodeURIComponent(sessionId);
  const params = new URLSearchParams();
  if (opencodeSessionId) {
    params.set('opencodeSessionId', opencodeSessionId);
  }
  if (since && Number.isFinite(since) && since > 0) {
    params.set('since', String(since));
  }
  if (clientId) {
    params.set('clientId', clientId);
  }
  const query = params.toString();
  const suffix = query ? `?${query}` : '';
  return `${getApiBaseUrl()}/api/task-creation/sessions/${safeSessionId}/opencode/events${suffix}`;
}

export async function getWorkspaceTree(sessionId: string): Promise<WorkspaceTree> {
  const safeSessionId = encodeURIComponent(sessionId);
  const url = `${getApiBaseUrl()}/api/task-creation/sessions/${safeSessionId}/workspace/tree`;
  const result = await fetchJson<{ data?: WorkspaceTree }>(url);
  if (!result?.data) {
    throw new Error("workspace tree empty");
  }
  return result.data;
}

export async function getWorkspaceDirectory(
  sessionId: string,
  options?: {
    path?: string;
    cursor?: number;
    limit?: number;
    refresh?: boolean;
  }
): Promise<WorkspaceDirectoryPage> {
  const safeSessionId = encodeURIComponent(sessionId);
  const params = new URLSearchParams();
  if (options?.path) {
    params.set("path", options.path);
  }
  if (typeof options?.cursor === "number" && Number.isFinite(options.cursor) && options.cursor >= 0) {
    params.set("cursor", String(options.cursor));
  }
  if (typeof options?.limit === "number" && Number.isFinite(options.limit) && options.limit > 0) {
    params.set("limit", String(Math.floor(options.limit)));
  }
  if (options?.refresh) {
    params.set("refresh", "1");
  }
  const query = params.toString();
  const suffix = query ? `?${query}` : "";
  const url = `${getApiBaseUrl()}/api/task-creation/sessions/${safeSessionId}/workspace/dir${suffix}`;
  const result = await fetchJson<{ data?: WorkspaceDirectoryPage }>(url);
  if (!result?.data) {
    throw new Error("workspace dir empty");
  }
  return result.data;
}

export async function getWorkspaceFile(sessionId: string, filePath: string): Promise<WorkspaceFile> {
  const safeSessionId = encodeURIComponent(sessionId);
  const params = new URLSearchParams({ path: filePath });
  const url = `${getApiBaseUrl()}/api/task-creation/sessions/${safeSessionId}/workspace/file?${params.toString()}`;
  const result = await fetchJson<{ data?: WorkspaceFile }>(url);
  if (!result?.data) {
    throw new Error("workspace file empty");
  }
  return result.data;
}

export async function uploadTaskCreationAttachment(
  sessionId: string,
  file: File
): Promise<TaskCreationUploadedAttachment> {
  const safeSessionId = encodeURIComponent(sessionId);
  const url = `${getApiBaseUrl()}/api/task-creation/sessions/${safeSessionId}/attachments`;
  const response = await fetch(url, {
    method: "POST",
    headers: buildClientIdentityHeaders({
      "Content-Type": file.type || "application/octet-stream",
      "X-Attachment-Name": encodeURIComponent(file.name),
      "X-Attachment-Size": String(file.size),
    }),
    body: file,
  });
  if (!response.ok) {
    throw new Error(`request failed: ${response.status}`);
  }
  const result = (await response.json()) as { data?: TaskCreationUploadedAttachment };
  if (!result?.data) {
    throw new Error("attachment upload empty");
  }
  return result.data;
}

export async function fetchRemoteTaskAttachment(input: {
  provider: RemoteAttachmentProvider;
  url: string;
}): Promise<File> {
  const response = await fetch(`${getApiBaseUrl()}/api/task-creation/attachments/fetch`, {
    method: "POST",
    headers: buildClientIdentityHeaders({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  const blob = await response.blob();
  const headerName = response.headers.get("X-Attachment-Name");
  const fallbackName = input.provider === "website" ? "website-file" : `${input.provider}-file`;
  const fileName = headerName ? decodeURIComponent(headerName) : fallbackName;
  return new File([blob], fileName, {
    type: blob.type || "application/octet-stream",
    lastModified: Date.now(),
  });
}
