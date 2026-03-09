import { getApiBaseUrl, getTaskCreationWsUrl } from "@/lib/runtime-config";
import { buildClientIdentityHeaders } from "@/lib/client-identity";

export type TaskCreationSessionSummary = {
  id: string;
  title?: string;
  status?: string;
  stage?: string;
  phase?: string;
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
  role?: string;
  content?: string;
  messageType?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
};

export type TaskCreationRuntimeStatus = {
  status?: string;
  provider?: string;
  updatedAt?: string;
  sandboxId?: string;
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

export type TaskCreationSessionDetail = {
  id: string;
  title?: string;
  status?: string;
  stage?: string;
  phase?: string;
  runtime?: {
    orchestratorSessionId?: string;
    opencodeSessionId?: string;
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

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: buildClientIdentityHeaders(init?.headers),
  });
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
    headers: {
      "Content-Type": "application/json",
    },
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

export async function getTaskCreationSession(sessionId: string): Promise<TaskCreationSessionDetail | null> {
  const safeSessionId = encodeURIComponent(sessionId);
  const url = `${getApiBaseUrl()}/api/task-creation/sessions/${safeSessionId}`;
  const result = await fetchJson<{ data?: TaskCreationSessionDetail }>(url);
  return result?.data || null;
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
