import { getApiBaseUrl, getTaskCreationWsUrl } from "@/lib/runtime-config";

export type TaskCreationSessionSummary = {
  id: string;
  title?: string;
  status?: string;
  stage?: string;
  updatedAt?: string;
};

export type TaskCreationHistoryMessage = {
  role?: string;
  content?: string;
  messageType?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
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

export async function listTaskCreationSessions(limit: number = 20): Promise<TaskCreationSessionSummary[]> {
  const url = `${getApiBaseUrl()}/api/task-creation/sessions?limit=${limit}`;
  const result = await fetchJson<{ data?: TaskCreationSessionSummary[] }>(url);
  return Array.isArray(result?.data) ? result.data : [];
}

export async function listTaskCreationMessages(sessionId: string): Promise<TaskCreationHistoryMessage[]> {
  const safeSessionId = encodeURIComponent(sessionId);
  const url = `${getApiBaseUrl()}/api/task-creation/sessions/${safeSessionId}/messages`;
  const result = await fetchJson<{ data?: TaskCreationHistoryMessage[] }>(url);
  return Array.isArray(result?.data) ? result.data : [];
}

export async function listOsacMessages(orchestratorSessionId: string, limit: number = 120): Promise<OsacMessageRecord[]> {
  const safeSessionId = encodeURIComponent(orchestratorSessionId);
  const url = `${getApiBaseUrl()}/api/sandbox/osac/${safeSessionId}/messages?limit=${limit}`;
  const result = await fetchJson<{ data?: OsacMessageRecord[] }>(url);
  return Array.isArray(result?.data) ? result.data : [];
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
