function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function resolveDefaultApiBaseUrl(): string {
  if (typeof window !== "undefined") {
    if (import.meta.env.DEV) {
      const protocol = window.location.protocol || "http:";
      const hostname = window.location.hostname || "127.0.0.1";
      return `${protocol}//${hostname}:4000`;
    }
    return window.location.origin || "http://127.0.0.1:3000";
  }
  return "http://127.0.0.1:4000";
}

export function getApiBaseUrl(): string {
  const envBase = (import.meta.env.VITE_API_BASE_URL || "").trim();
  if (envBase) {
    return trimTrailingSlash(envBase);
  }
  return trimTrailingSlash(resolveDefaultApiBaseUrl());
}

export function getTaskCreationWsUrl(): string {
  const envWs = (import.meta.env.VITE_TASK_CREATION_WS_URL || "").trim();
  if (envWs) {
    return trimTrailingSlash(envWs);
  }

  const apiBase = getApiBaseUrl();
  const wsBase = apiBase.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:");
  return `${trimTrailingSlash(wsBase)}/ws/task-creation`;
}
