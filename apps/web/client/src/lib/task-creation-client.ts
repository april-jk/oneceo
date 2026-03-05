import { getApiBaseUrl, getTaskCreationWsUrl } from "@/lib/runtime-config";

export type TaskCreationSessionSummary = {
  id: string;
  title?: string;
  status?: string;
  stage?: string;
  phase?: string;
  updatedAt?: string;
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

export type WorkspaceFile = {
  path: string;
  content: string;
  truncated?: boolean;
  size?: number;
};

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`request failed: ${response.status}`);
  }
  return (await response.json()) as T;
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

export async function listTaskCreationMessages(sessionId: string): Promise<TaskCreationHistoryMessage[]> {
  const safeSessionId = encodeURIComponent(sessionId);
  const url = `${getApiBaseUrl()}/api/task-creation/sessions/${safeSessionId}/messages`;
  const result = await fetchJson<{ data?: TaskCreationHistoryMessage[] }>(url);
  return Array.isArray(result?.data) ? result.data : [];
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
  const response = await fetch(url, { method: "POST" });
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
  const response = await fetch(url, { method: "POST" });
  if (!response.ok) {
    throw new Error(`request failed: ${response.status}`);
  }
  const result = (await response.json()) as { data?: any };
  return result?.data || {};
}

export async function touchTaskCreationRuntime(sessionId: string): Promise<void> {
  const safeSessionId = encodeURIComponent(sessionId);
  const url = `${getApiBaseUrl()}/api/task-creation/sessions/${safeSessionId}/runtime/touch`;
  const response = await fetch(url, { method: "POST" });
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
  since?: number
): string {
  const safeSessionId = encodeURIComponent(sessionId);
  const params = new URLSearchParams();
  if (opencodeSessionId) {
    params.set('opencodeSessionId', opencodeSessionId);
  }
  if (since && Number.isFinite(since) && since > 0) {
    params.set('since', String(since));
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
