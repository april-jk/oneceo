function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1" || normalized === "[::1]";
}

function resolveCurrentOrigin(): string {
  if (typeof window !== "undefined") {
    return window.location.origin || "http://127.0.0.1:3000";
  }
  return "http://127.0.0.1:4000";
}

export function resolveApiBaseUrlFromRuntime(envBaseUrl?: string, currentOrigin?: string): string {
  const normalizedCurrentOrigin = trimTrailingSlash(currentOrigin || resolveCurrentOrigin());
  const normalizedEnvBase = trimTrailingSlash((envBaseUrl || "").trim());

  if (!normalizedEnvBase) {
    return normalizedCurrentOrigin;
  }

  try {
    const currentUrl = new URL(normalizedCurrentOrigin);
    if (!isLocalHostname(currentUrl.hostname)) {
      return normalizedEnvBase;
    }
    return normalizedEnvBase === normalizedCurrentOrigin ? normalizedEnvBase : normalizedCurrentOrigin;
  } catch {
    return normalizedEnvBase;
  }
}

export function getApiBaseUrl(): string {
  return resolveApiBaseUrlFromRuntime(import.meta.env.VITE_API_BASE_URL, resolveCurrentOrigin());
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
