import { getApiBaseUrl } from "@/lib/runtime-config";

export type AppAuthUser = {
  id: string;
  email: string;
  displayName: string;
  status?: string;
};

type AuthEnvelope<T> = {
  success?: boolean;
  data?: T;
  error?: string | { message?: string };
};

type AuthPayload = {
  user?: AppAuthUser;
};

type RegisterCodePayload = {
  cooldownSeconds?: number;
  expiresInSeconds?: number;
};

function resolveErrorMessage(payload: AuthEnvelope<unknown> | null, fallback: string) {
  if (typeof payload?.error === "string" && payload.error.trim()) {
    return payload.error.trim();
  }
  if (payload?.error && typeof payload.error === "object" && typeof payload.error.message === "string") {
    return payload.error.message.trim() || fallback;
  }
  return fallback;
}

async function requestAuth<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });

  const payload = (await response.json().catch(() => null)) as AuthEnvelope<T> | null;
  if (!response.ok || payload?.success !== true || !payload.data) {
    throw new Error(resolveErrorMessage(payload, `request failed: ${response.status}`));
  }

  return payload.data;
}

export async function getCurrentAppUser(): Promise<AppAuthUser | null> {
  const response = await fetch(`${getApiBaseUrl()}/api/auth/me`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (response.status === 401) {
    return null;
  }

  const payload = (await response.json().catch(() => null)) as AuthEnvelope<AuthPayload> | null;
  if (!response.ok || payload?.success !== true) {
    throw new Error(resolveErrorMessage(payload, `request failed: ${response.status}`));
  }

  return payload.data?.user || null;
}

export async function loginAppUser(input: {
  email: string;
  password: string;
}): Promise<AppAuthUser> {
  const result = await requestAuth<AuthPayload>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!result.user) {
    throw new Error("登录返回缺少用户信息");
  }
  return result.user;
}

export async function registerAppUser(input: {
  email: string;
  password: string;
  displayName: string;
  verificationCode: string;
}): Promise<AppAuthUser> {
  const result = await requestAuth<AuthPayload>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!result.user) {
    throw new Error("注册返回缺少用户信息");
  }
  return result.user;
}

export async function sendRegisterVerificationCode(input: {
  email: string;
}): Promise<RegisterCodePayload> {
  return await requestAuth<RegisterCodePayload>("/api/auth/register/send-code", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function logoutAppUser(): Promise<void> {
  await requestAuth<{ ok?: boolean }>("/api/auth/logout", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function installApiFetchCredentials() {
  if (typeof window === "undefined") {
    return;
  }

  const marker = "__oneceoApiFetchCredentialsInstalled";
  if ((window as Window & { [marker]?: boolean })[marker]) {
    return;
  }

  const apiBaseUrl = getApiBaseUrl();
  const originalFetch = window.fetch.bind(window);

  const patchedFetch: typeof window.fetch = (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input instanceof Request
            ? input.url
            : String(input);

    const shouldAttachCredentials =
      url.startsWith("/api/") ||
      url.startsWith(`${window.location.origin}/api/`) ||
      url.startsWith(apiBaseUrl);

    const nextInit =
      shouldAttachCredentials && !init?.credentials ? { ...init, credentials: "include" as const } : init;

    return originalFetch(input, nextInit);
  };

  window.fetch = patchedFetch;
  (window as Window & { [marker]?: boolean })[marker] = true;
}
