import { getApiBaseUrl, getTaskCreationWsUrl } from "@/lib/runtime-config";
import { buildClientIdentityHeaders } from "@/lib/client-identity";

export type TaskCreationSessionSummary = {
  id: string;
  title?: string;
  titleLocked?: boolean;
  titleSource?: "placeholder" | "first_explicit_user_input" | "task_description" | "clarification_summary" | "manual";
  titleState?: "provisional" | "resolved" | "manual";
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
  codexExecutionMode?: "sdk" | "ws";
  updatedAt?: string;
};

export type TaskCreationProjectSummary = {
  id: string;
  name: string;
  projectType?: string;
  status?: string;
  pinned?: boolean;
  projectInstruction?: string;
  defaultConnectors?: TaskCreationProjectDefaultConnector[];
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type TaskCreationProjectDefaultConnector = {
  connectorKey: import("@/lib/connectors-client").ConnectorKey;
  profileId: string;
  profileName?: string | null;
  displayName?: string | null;
  authStatus?: string | null;
};

export type CreateTaskCreationSessionInput = {
  sessionId?: string;
  title?: string;
  mode?: "sandbox" | "altus";
  executor?: "opencode" | "claudecode" | "codex";
  codexExecutionMode?: "sdk" | "ws";
  projectId?: string | null;
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

export type TaskCreationManagedRunSummary = {
  id: string;
  runId?: string;
  sessionId: string;
  status?: string;
  model?: string | null;
  stopReason?: string | null;
  streamUrl?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  updatedAt?: string | null;
  sequence?: number | null;
};

export type StartTaskCreationManagedRunInput = {
  content: string;
  messageKey?: string;
  metadata?: Record<string, unknown>;
};

export type SubmitTaskCreationManagedInput = {
  sessionId?: string;
  content: string;
  messageKey?: string;
  metadata?: Record<string, unknown>;
  files?: File[];
};

export type TaskCreationPlatformSkill = {
  sourceType?: "platform" | "custom";
  skillId: string;
  revisionId: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  revisionNumber: number | null;
  resourceSummary?: {
    totalCount: number;
    referenceCount: number;
    templateCount: number;
    paths: string[];
  } | null;
};

export type TaskCreationUserCustomSkill = {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  status: "active" | "archived";
  bodyMarkdown?: string;
  documents?: Array<{
    id: string;
    documentKey: string;
    documentPath: string;
    title: string;
    summary: string;
    bodyMarkdown: string;
    sortOrder: number;
    updatedAt: string;
  }>;
  resourceSummary?: {
    totalCount: number;
    referenceCount: number;
    templateCount: number;
    paths: string[];
  } | null;
  updatedAt: string;
};

export type TaskCreationUserSkillSettings = {
  platformCatalog: Array<TaskCreationPlatformSkill & { enabled: boolean }>;
  customSkills: TaskCreationUserCustomSkill[];
  availableSkills: TaskCreationPlatformSkill[];
};

export type TaskCreationUploadedAttachment = {
  name: string;
  path: string;
  size: number;
  mimeType?: string;
  uploadedAt?: string;
  attachmentKind?: "uploaded_file";
};

export type SubmitTaskCreationManagedInputResult = {
  sessionId: string;
  attachments: TaskCreationUploadedAttachment[];
  run: TaskCreationManagedRunSummary;
};

export type TaskCreationDeliverableArtifact = {
  id: string;
  runId: string;
  path: string;
  name: string;
  mimeType: string;
  size: number;
  createdAt?: string | null;
  downloadPath?: string;
};

export type RemoteAttachmentProvider = "website" | "google-drive" | "onedrive";

export type TaskCreationDebugInfo = {
  ready: boolean;
  url?: string;
  status?: string;
  reasonCode?: string;
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

export type TaskCreationAnalyticsInfo = {
  provider: "umami";
  configured: boolean;
  enabled: boolean;
  status:
    | "bound"
    | "tracking"
    | "pending"
    | "pending_domain"
    | "unconfigured"
    | "error";
  host?: string;
  websiteId?: string;
  websiteName?: string;
  domain?: string;
  tag?: string;
  pageviews?: number;
  visits?: number;
  visitors?: number;
  events?: number;
  activeVisitors?: number;
  updatedAt?: string;
  message?: string;
  error?: string;
};

export type TaskCreationDeploymentResourceBinding = {
  projectKey: string;
  isolationMode: "session" | "default";
  projectModel: "per_user";
  environmentModel: "per_session";
  tokenKind: "project";
  tokenScope: "railway_project_environment";
  tokenManagedBy: "oneceo_platform";
  tokenId?: string;
  tokenRotatedAt?: string;
  repositoryOwner?: string;
  repositoryName?: string;
  repositoryFullName?: string;
  repositoryUrl?: string;
  repositoryBranch?: string;
};

export type TaskCreationDeploymentInfo = {
  configured: boolean;
  canDeploy: boolean;
  message?: string;
  bindingState?:
    | "uninitialized"
    | "provisioning"
    | "ready"
    | "repair_required"
    | "provider_error";
  provisioningPhase?: string;
  providerErrorCode?: string;
  providerErrorMessage?: string;
  lastVerifiedAt?: string;
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
  analytics?: TaskCreationAnalyticsInfo;
  resourceBinding?: TaskCreationDeploymentResourceBinding;
};

export type TaskCreationDeploymentTemplateBaseline = {
  status: "ready" | "needs_attention" | "unavailable";
  checkedAt: string;
  workspaceDetected: boolean;
  analyticsMode: "workspace" | "platform_injected" | "missing" | "unknown";
  manifestGenerated: boolean;
  manifestPath?: string;
  templateVersion?: string;
  buildCommand?: string;
  startCommand?: string;
  healthcheckPath?: string;
  features?: {
    analytics: boolean;
    userTracking: boolean;
    database: "railway_postgres" | false;
    auth: "optional" | false;
    objectStorage: boolean;
  };
  checks: {
    build: boolean | null;
    start: boolean | null;
    analytics: boolean | null;
    healthcheck: boolean | null;
    database: boolean | null;
  };
  warnings: string[];
  errors: string[];
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
  titleSource?: "placeholder" | "first_explicit_user_input" | "task_description" | "clarification_summary" | "manual";
  titleState?: "provisional" | "resolved" | "manual";
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
  codexExecutionMode?: "sdk" | "ws";
  runtime?: {
    generation?: number;
    orchestratorSessionId?: string;
    executor?: "opencode" | "claudecode" | "codex";
    transport?: "sdk" | "app_server";
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
  previewType?:
    | "text"
    | "markdown"
    | "html"
    | "image"
    | "video"
    | "audio"
    | "pdf"
    | "binary";
  previewAvailable?: boolean;
  binaryTooLarge?: boolean;
};

export type WorkspaceRawHeadResult = {
  ok: boolean;
  status: number;
  networkError?: boolean;
};

export type CodexRuntimeConfig = {
  baseUrl: string;
  model: string;
  apiKey: string;
  configToml: string;
  authJson: string;
  updatedAt?: string;
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
      credentials: init?.credentials || "include",
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

export async function listTaskCreationSkills(): Promise<TaskCreationPlatformSkill[]> {
  const url = `${getApiBaseUrl()}/api/task-creation/skills`;
  const result = await fetchJson<{ data?: TaskCreationPlatformSkill[] }>(url);
  return Array.isArray(result?.data) ? result.data : [];
}

export async function getTaskCreationUserSkillSettings(): Promise<TaskCreationUserSkillSettings> {
  const url = `${getApiBaseUrl()}/api/task-creation/settings/skills`;
  const result = await fetchJson<{ data?: TaskCreationUserSkillSettings }>(url);
  if (result?.data) return result.data;
  throw new Error("failed to load user skill settings");
}

export async function enableTaskCreationPlatformSkill(skillId: string) {
  const response = await fetch(`${getApiBaseUrl()}/api/task-creation/settings/skills/platform/${encodeURIComponent(skillId)}/enable`, {
    method: "POST",
    headers: buildClientIdentityHeaders({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({}),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
}

export async function disableTaskCreationPlatformSkill(skillId: string) {
  const response = await fetch(`${getApiBaseUrl()}/api/task-creation/settings/skills/platform/${encodeURIComponent(skillId)}/disable`, {
    method: "POST",
    headers: buildClientIdentityHeaders({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({}),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
}

export async function createTaskCreationCustomSkill(input: {
  slug: string;
  name: string;
  description?: string;
  category?: string;
  bodyMarkdown: string;
  documents?: Array<{
    documentKey?: string;
    documentPath: string;
    title?: string;
    summary?: string;
    bodyMarkdown: string;
  }>;
}): Promise<TaskCreationUserCustomSkill> {
  const response = await fetch(`${getApiBaseUrl()}/api/task-creation/settings/skills/custom`, {
    method: "POST",
    headers: buildClientIdentityHeaders({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  const result = (await response.json()) as { data?: TaskCreationUserCustomSkill };
  if (!result.data) {
    throw new Error("custom skill empty");
  }
  return result.data;
}

export async function updateTaskCreationCustomSkill(
  customSkillId: string,
  input: {
    name?: string;
    description?: string;
    category?: string;
    bodyMarkdown?: string;
    documents?: Array<{
      documentKey?: string;
      documentPath: string;
      title?: string;
      summary?: string;
      bodyMarkdown: string;
    }>;
  }
): Promise<TaskCreationUserCustomSkill> {
  const response = await fetch(
    `${getApiBaseUrl()}/api/task-creation/settings/skills/custom/${encodeURIComponent(customSkillId)}`,
    {
      method: "PUT",
      headers: buildClientIdentityHeaders({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(input),
    }
  );
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  const result = (await response.json()) as { data?: TaskCreationUserCustomSkill };
  if (!result.data) {
    throw new Error("custom skill empty");
  }
  return result.data;
}

export async function archiveTaskCreationCustomSkill(customSkillId: string) {
  const response = await fetch(
    `${getApiBaseUrl()}/api/task-creation/settings/skills/custom/${encodeURIComponent(customSkillId)}/archive`,
    {
      method: "POST",
      headers: buildClientIdentityHeaders({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({}),
    }
  );
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
}

export async function activateTaskCreationCustomSkill(customSkillId: string) {
  const response = await fetch(
    `${getApiBaseUrl()}/api/task-creation/settings/skills/custom/${encodeURIComponent(customSkillId)}/activate`,
    {
      method: "POST",
      headers: buildClientIdentityHeaders({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({}),
    }
  );
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
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

export async function getCodexRuntimeConfig(): Promise<CodexRuntimeConfig> {
  const url = `${getApiBaseUrl()}/api/task-creation/codex/runtime-config`;
  const result = await fetchJson<{ data?: CodexRuntimeConfig }>(url);
  if (result?.data) return result.data;
  throw new Error("failed to load codex runtime config");
}

export async function updateCodexRuntimeConfig(input: {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  configToml?: string;
  authJson?: string;
}): Promise<CodexRuntimeConfig> {
  const url = `${getApiBaseUrl()}/api/task-creation/codex/runtime-config`;
  const response = await fetch(url, {
    method: "PUT",
    headers: buildClientIdentityHeaders({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(input || {}),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  const result = (await response.json()) as { data?: CodexRuntimeConfig };
  if (result?.data) return result.data;
  throw new Error("failed to save codex runtime config");
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
  titleSource?: "placeholder" | "first_explicit_user_input" | "task_description" | "clarification_summary" | "manual";
  titleState?: "provisional" | "resolved" | "manual";
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

export async function startTaskCreationManagedRun(
  sessionId: string,
  input: StartTaskCreationManagedRunInput
): Promise<TaskCreationManagedRunSummary> {
  const safeSessionId = encodeURIComponent(sessionId);
  const url = `${getApiBaseUrl()}/api/altus-managed/sessions/${safeSessionId}/runs`;
  const response = await fetch(url, {
    method: "POST",
    headers: buildClientIdentityHeaders({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(input || {}),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  const result = (await response.json()) as { data?: TaskCreationManagedRunSummary };
  if (!result?.data) {
    throw new Error("managed run empty");
  }
  return result.data;
}

export async function getLatestTaskCreationManagedRun(
  sessionId: string
): Promise<TaskCreationManagedRunSummary | null> {
  const safeSessionId = encodeURIComponent(sessionId);
  const url = `${getApiBaseUrl()}/api/altus-managed/sessions/${safeSessionId}/runs/latest`;
  const response = await fetch(url, {
    headers: buildClientIdentityHeaders(),
    cache: 'no-store',
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  const result = (await response.json()) as { data?: TaskCreationManagedRunSummary | null };
  return result?.data || null;
}

export function getTaskCreationManagedRunStreamUrl(
  runId: string,
  options?: { afterSequence?: number | null; clientId?: string; userId?: string | null }
): string {
  const safeRunId = encodeURIComponent(runId);
  const params = new URLSearchParams();
  if (typeof options?.afterSequence === "number" && Number.isFinite(options.afterSequence) && options.afterSequence > 0) {
    params.set("afterSequence", String(Math.floor(options.afterSequence)));
  }
  if (options?.clientId) {
    params.set("clientId", options.clientId);
  }
  if (typeof options?.userId === "string" && options.userId.trim()) {
    params.set("userId", options.userId.trim());
  }
  const query = params.toString();
  const suffix = query ? `?${query}` : "";
  return `${getApiBaseUrl()}/api/altus-managed/runs/${safeRunId}/stream${suffix}`;
}

export async function stopTaskCreationManagedRun(
  runId: string,
  options?: { reason?: string; clientMessageKey?: string }
): Promise<TaskCreationManagedRunSummary | null> {
  const safeRunId = encodeURIComponent(runId);
  const url = `${getApiBaseUrl()}/api/altus-managed/runs/${safeRunId}/stop`;
  const response = await fetch(url, {
    method: "POST",
    headers: buildClientIdentityHeaders({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({
      reason: options?.reason || undefined,
      clientMessageKey: options?.clientMessageKey || undefined,
    }),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  const result = (await response.json()) as { data?: TaskCreationManagedRunSummary | null };
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

export async function listTaskCreationProjects(): Promise<TaskCreationProjectSummary[]> {
  const url = `${getApiBaseUrl()}/api/task-creation/projects`;
  const response = await fetch(url, {
    headers: buildClientIdentityHeaders(),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  const result = (await response.json()) as { data?: TaskCreationProjectSummary[] };
  return Array.isArray(result?.data) ? result.data : [];
}

export async function getTaskCreationProject(
  projectId: string
): Promise<TaskCreationProjectSummary | null> {
  const safeProjectId = encodeURIComponent(projectId);
  const url = `${getApiBaseUrl()}/api/task-creation/projects/${safeProjectId}`;
  const response = await fetch(url, {
    headers: buildClientIdentityHeaders(),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  const result = (await response.json()) as { data?: TaskCreationProjectSummary };
  return result?.data || null;
}

export async function listTaskCreationProjectSessions(
  projectId: string
): Promise<TaskCreationSessionSummary[]> {
  const safeProjectId = encodeURIComponent(projectId);
  const url = `${getApiBaseUrl()}/api/task-creation/projects/${safeProjectId}/sessions`;
  const response = await fetch(url, {
    headers: buildClientIdentityHeaders(),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  const result = (await response.json()) as { data?: TaskCreationSessionSummary[] };
  return Array.isArray(result?.data) ? result.data : [];
}

export async function createTaskCreationProject(input: {
  name: string;
  projectInstruction?: string | null;
  defaultConnectors?: Array<{
    connectorKey: import("@/lib/connectors-client").ConnectorKey;
    profileId: string;
  }>;
}): Promise<TaskCreationProjectSummary | null> {
  const url = `${getApiBaseUrl()}/api/task-creation/projects`;
  const response = await fetch(url, {
    method: "POST",
    headers: buildClientIdentityHeaders({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({
      name: input.name,
      projectInstruction: input.projectInstruction ?? "",
      defaultConnectors: input.defaultConnectors ?? [],
    }),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  const result = (await response.json()) as { data?: TaskCreationProjectSummary };
  return result?.data || null;
}

export async function updateTaskCreationProject(
  projectId: string,
  input: {
    name?: string;
    pinned?: boolean;
    projectInstruction?: string | null;
    defaultConnectors?: Array<{
      connectorKey: import("@/lib/connectors-client").ConnectorKey;
      profileId: string;
    }>;
  }
): Promise<TaskCreationProjectSummary | null> {
  const safeProjectId = encodeURIComponent(projectId);
  const url = `${getApiBaseUrl()}/api/task-creation/projects/${safeProjectId}`;
  const response = await fetch(url, {
    method: "PUT",
    headers: buildClientIdentityHeaders({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.pinned !== undefined ? { pinned: Boolean(input.pinned) } : {}),
      ...(input.projectInstruction !== undefined
        ? { projectInstruction: input.projectInstruction ?? "" }
        : {}),
      ...(input.defaultConnectors !== undefined
        ? { defaultConnectors: input.defaultConnectors }
        : {}),
    }),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  const result = (await response.json()) as { data?: TaskCreationProjectSummary };
  return result?.data || null;
}

export async function deleteTaskCreationProject(projectId: string): Promise<void> {
  const safeProjectId = encodeURIComponent(projectId);
  const url = `${getApiBaseUrl()}/api/task-creation/projects/${safeProjectId}`;
  const response = await fetch(url, {
    method: "DELETE",
    headers: buildClientIdentityHeaders(),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
}

export function summarizeProjectInstruction(
  value?: string | null,
  options?: { maxLength?: number }
) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  const normalized = text.replace(/\s+/g, " ").trim();
  const maxLength = typeof options?.maxLength === "number" && options.maxLength > 0
    ? Math.floor(options.maxLength)
    : 140;
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export async function updateTaskCreationSessionProject(
  sessionId: string,
  input: {
    projectId?: string | null;
    projectName?: string | null;
  }
): Promise<TaskCreationSessionSummary | null> {
  const safeSessionId = encodeURIComponent(sessionId);
  const url = `${getApiBaseUrl()}/api/task-creation/sessions/${safeSessionId}/project`;
  const response = await fetch(url, {
    method: "POST",
    headers: buildClientIdentityHeaders({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({
      projectId: input.projectId ?? null,
      projectName: input.projectName ?? null,
    }),
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
    throw new Error(await readErrorMessage(response));
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

export async function getTaskCreationDeploymentTemplateBaseline(
  sessionId: string
): Promise<TaskCreationDeploymentTemplateBaseline | null> {
  const safeSessionId = encodeURIComponent(sessionId);
  const url = `${getApiBaseUrl()}/api/task-creation/sessions/${safeSessionId}/deployment/template`;
  const result = await fetchJson<{ data?: TaskCreationDeploymentTemplateBaseline }>(url);
  return result?.data || null;
}

async function postTaskCreationDeploymentAction(
  sessionId: string,
  action: "deploy" | "redeploy" | "rollback" | "token/rotate",
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

export async function rotateTaskCreationDeploymentToken(
  sessionId: string
): Promise<TaskCreationDeploymentInfo | null> {
  return postTaskCreationDeploymentAction(sessionId, "token/rotate");
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
    throw new Error(await readErrorMessage(response));
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

export async function interruptTaskCreationRuntime(
  sessionId: string,
  options?: { clientMessageKey?: string }
): Promise<{
  interrupted: boolean;
  phase?: "intent_processing" | "executor_processing";
  executor?: "opencode" | "claudecode" | "codex";
  orchestratorSessionId?: string;
  executorSessionId?: string;
  reason?: string;
  replayPending?: boolean;
}> {
  const safeSessionId = encodeURIComponent(sessionId);
  const url = `${getApiBaseUrl()}/api/task-creation/sessions/${safeSessionId}/runtime/interrupt`;
  const response = await fetch(url, {
    method: "POST",
    headers: buildClientIdentityHeaders({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({
      preserveForRetry: true,
      clientMessageKey: options?.clientMessageKey || undefined,
    }),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  const result = (await response.json()) as {
    data?: {
      interrupted?: boolean;
      phase?: "intent_processing" | "executor_processing";
      executor?: "opencode" | "claudecode" | "codex";
      orchestratorSessionId?: string;
      executorSessionId?: string;
      reason?: string;
      replayPending?: boolean;
    };
  };
  return {
    interrupted: Boolean(result?.data?.interrupted),
    phase: result?.data?.phase,
    executor: result?.data?.executor,
    orchestratorSessionId: result?.data?.orchestratorSessionId,
    executorSessionId: result?.data?.executorSessionId,
    reason: result?.data?.reason,
    replayPending: Boolean(result?.data?.replayPending),
  };
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

export function getWorkspaceRawFileUrl(sessionId: string, filePath: string): string {
  const safeSessionId = encodeURIComponent(sessionId);
  const encodedPath = String(filePath || "")
    .split(/[\\/]+/)
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${getApiBaseUrl()}/api/task-creation/sessions/${safeSessionId}/workspace/raw/${encodedPath}`;
}

export async function headWorkspaceRawFile(
  sessionId: string,
  filePath: string,
): Promise<WorkspaceRawHeadResult> {
  const url = getWorkspaceRawFileUrl(sessionId, filePath);
  try {
    const response = await fetch(url, {
      method: "HEAD",
      credentials: "include",
      cache: "no-store",
      headers: buildClientIdentityHeaders(),
    });
    return {
      ok: response.ok,
      status: response.status,
    };
  } catch {
    return {
      ok: false,
      status: 0,
      networkError: true,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

function shouldRetryWorkspaceRawHead(result: WorkspaceRawHeadResult): boolean {
  if (result.ok) return false;
  if (result.networkError) return true;
  return result.status === 0 || result.status === 409 || result.status >= 500;
}

export async function waitWorkspaceRawFileReady(
  sessionId: string,
  filePath: string,
  options?: {
    attempts?: number;
    intervalMs?: number;
  },
): Promise<WorkspaceRawHeadResult> {
  const attempts = Math.max(1, Math.floor(options?.attempts ?? 8));
  const intervalMs = Math.max(100, Math.floor(options?.intervalMs ?? 600));
  let last: WorkspaceRawHeadResult = {
    ok: false,
    status: 0,
  };
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    last = await headWorkspaceRawFile(sessionId, filePath);
    if (!shouldRetryWorkspaceRawHead(last) || attempt === attempts - 1) {
      return last;
    }
    await sleep(intervalMs);
  }
  return last;
}

export function getTaskCreationDeliverableDownloadUrl(sessionId: string, artifactId: string): string {
  const safeSessionId = encodeURIComponent(sessionId);
  const safeArtifactId = encodeURIComponent(artifactId);
  return `${getApiBaseUrl()}/api/task-creation/sessions/${safeSessionId}/deliverables/${safeArtifactId}/download`;
}

export async function listTaskCreationDeliverables(
  sessionId: string,
  options?: { runId?: string }
): Promise<TaskCreationDeliverableArtifact[]> {
  const safeSessionId = encodeURIComponent(sessionId);
  const params = new URLSearchParams();
  if (options?.runId) {
    params.set("runId", options.runId);
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const url = `${getApiBaseUrl()}/api/task-creation/sessions/${safeSessionId}/deliverables${suffix}`;
  const result = await fetchJson<{ data?: TaskCreationDeliverableArtifact[] }>(url);
  return Array.isArray(result?.data) ? result.data : [];
}

export async function downloadTaskCreationDeliverable(
  sessionId: string,
  artifact: Pick<TaskCreationDeliverableArtifact, "id" | "name">
): Promise<void> {
  const response = await fetch(getTaskCreationDeliverableDownloadUrl(sessionId, artifact.id), {
    headers: buildClientIdentityHeaders(),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  const blob = await response.blob();
  const objectUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = artifact.name || "deliverable";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => {
    window.URL.revokeObjectURL(objectUrl);
  }, 0);
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

export async function submitTaskCreationManagedInput(
  input: SubmitTaskCreationManagedInput
): Promise<SubmitTaskCreationManagedInputResult> {
  const formData = new FormData();
  if (input.sessionId) {
    formData.set("sessionId", input.sessionId);
  }
  formData.set("content", input.content);
  if (input.messageKey) {
    formData.set("messageKey", input.messageKey);
  }
  if (input.metadata && Object.keys(input.metadata).length > 0) {
    formData.set("metadata", JSON.stringify(input.metadata));
  }
  for (const file of input.files || []) {
    formData.append("files", file, file.name);
  }

  const response = await fetch(`${getApiBaseUrl()}/api/altus-managed/inputs`, {
    method: "POST",
    headers: buildClientIdentityHeaders(),
    body: formData,
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  const result = (await response.json()) as { data?: SubmitTaskCreationManagedInputResult };
  if (!result?.data?.run) {
    throw new Error("managed input result empty");
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
