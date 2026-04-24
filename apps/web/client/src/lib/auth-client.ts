import i18n from "@/i18n";
import { clearLegacyClientUserId, readLegacyClientUserId } from "@/lib/client-identity";
import { getApiBaseUrl } from "@/lib/runtime-config";

export type AppAuthUser = {
  id: string;
  email: string;
  displayName: string;
  status?: string;
  personalization?: AppUserPersonalization;
};

export type AppUserPersonalization = {
  preferredName: string;
  occupation: string;
  identity: string;
  location: string;
  background: string;
  preferences: string;
  responsePreferences: string;
};

type AuthEnvelope<T> = {
  success?: boolean;
  data?: T;
  error?: string | { message?: string };
};

type AuthPayload = {
  user?: AppAuthUser;
};

type AuthSessionPayload = {
  authenticated?: boolean;
  user?: AppAuthUser;
};

type AuthSessionDebug = {
  cookieNames: string;
  hasSessionCookie: boolean;
  sessionCookieCount: number;
  hasStateCookie: boolean;
  currentUser: boolean;
  wroteSessionCookie: boolean;
};

type AuthSessionSnapshot = {
  data: AuthSessionPayload;
  debug: AuthSessionDebug;
};

type RegisterCodePayload = {
  cooldownSeconds?: number;
  expiresInSeconds?: number;
};

type LinkLegacyClientIdentityPayload = {
  linked?: boolean;
  reboundCount?: number;
};

const AUTH_SESSION_BOOTSTRAP_ATTEMPTS = 12;
const AUTH_SESSION_BOOTSTRAP_DELAY_MS = 120;
const APP_SESSION_STATE_COOKIE_NAMES = ["app_session_v2_state", "app_session_state"];

function buildAuthSessionSnapshotUrl() {
  const url = new URL("/api/auth/session", getApiBaseUrl() || window.location.origin);
  url.searchParams.set("_ts", `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  return url.toString();
}

function readBooleanHeader(headers: Headers, name: string) {
  return headers.get(name) === "1";
}

function readNumberHeader(headers: Headers, name: string) {
  const raw = Number(headers.get(name) || "0");
  return Number.isFinite(raw) ? raw : 0;
}

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

async function requestAuthSessionSnapshot(): Promise<AuthSessionSnapshot> {
  const response = await fetch(buildAuthSessionSnapshotUrl(), {
    credentials: "include",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
    },
  });

  const payload = (await response.json().catch(() => null)) as AuthEnvelope<AuthSessionPayload> | null;
  if (!response.ok || payload?.success !== true) {
    throw new Error(resolveErrorMessage(payload, `request failed: ${response.status}`));
  }

  return {
    data: payload.data || {},
    debug: {
      cookieNames: response.headers.get("x-oneceo-auth-debug-cookie-names") || "",
      hasSessionCookie: readBooleanHeader(response.headers, "x-oneceo-auth-debug-has-session-cookie"),
      sessionCookieCount: readNumberHeader(response.headers, "x-oneceo-auth-debug-session-cookie-count"),
      hasStateCookie: readBooleanHeader(response.headers, "x-oneceo-auth-debug-has-state-cookie"),
      currentUser: readBooleanHeader(response.headers, "x-oneceo-auth-debug-current-user"),
      wroteSessionCookie: readBooleanHeader(response.headers, "x-oneceo-auth-debug-wrote-session-cookie"),
    },
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function hasAppSessionStateCookie() {
  if (typeof document === "undefined") {
    return false;
  }
  return document.cookie
    .split(/;\s*/g)
    .some((part) =>
      APP_SESSION_STATE_COOKIE_NAMES.some((cookieName) => part.startsWith(`${cookieName}=`))
    );
}

function listBrowserVisibleCookieNames() {
  if (typeof document === "undefined") {
    return [];
  }
  return document.cookie
    .split(/;\s*/g)
    .map((part) => part.split("=")[0]?.trim())
    .filter((value): value is string => Boolean(value));
}

function isPublicAuthRoute() {
  if (typeof window === "undefined") {
    return false;
  }
  const pathname = window.location.pathname || "";
  return pathname === "/login" || pathname === "/register";
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export async function resolveAppAuthSession(): Promise<AppAuthUser | null> {
  if (isPublicAuthRoute() && !hasAppSessionStateCookie()) {
    return null;
  }

  const snapshot = await requestAuthSessionSnapshot();
  if (snapshot.data.authenticated !== true) {
    return null;
  }

  await linkLegacyClientIdentityIfNeeded();
  return snapshot.data.user || null;
}

export async function getCurrentAppUser(): Promise<AppAuthUser | null> {
  const response = await fetch(`${getApiBaseUrl()}/api/auth/me`, {
    credentials: "include",
    cache: "no-store",
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
    throw new Error(i18n.t("auth.missingLoginUser"));
  }
  return await waitForAuthenticatedAppUser();
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
    throw new Error(i18n.t("auth.missingRegisterUser"));
  }
  return await waitForAuthenticatedAppUser();
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

export async function updateAppUserProfile(input: {
  displayName?: string;
  personalization?: AppUserPersonalization;
}): Promise<AppAuthUser> {
  const result = await requestAuth<AuthPayload>("/api/auth/profile", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  if (!result.user) {
    throw new Error(i18n.t("account.profileUpdateFailed"));
  }
  return result.user;
}

async function linkLegacyClientIdentityIfNeeded() {
  const legacyUserId = readLegacyClientUserId();
  if (!legacyUserId) {
    return;
  }
  if (isUuid(legacyUserId)) {
    clearLegacyClientUserId();
    return;
  }

  try {
    await requestAuth<LinkLegacyClientIdentityPayload>("/api/auth/legacy-client-id", {
      method: "POST",
      body: JSON.stringify({
        legacyUserId,
      }),
    });
    clearLegacyClientUserId();
  } catch (error) {
    console.warn("[AUTH] failed to link legacy client identity:", error);
  }
}

async function waitForAuthenticatedAppUser() {
  let lastError: Error | null = null;
  let lastSnapshot: AuthSessionSnapshot | null = null;

  for (let attempt = 0; attempt < AUTH_SESSION_BOOTSTRAP_ATTEMPTS; attempt += 1) {
    try {
      const snapshot = await requestAuthSessionSnapshot();
      lastSnapshot = snapshot;
      if (snapshot.data.authenticated === true && snapshot.data.user) {
        await linkLegacyClientIdentityIfNeeded();
        return snapshot.data.user;
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error || "unknown auth bootstrap failure"));
    }

    if (attempt < AUTH_SESSION_BOOTSTRAP_ATTEMPTS - 1) {
      await sleep(AUTH_SESSION_BOOTSTRAP_DELAY_MS);
    }
  }

  console.error("[AUTH_DIAG] session bootstrap timeout", {
    apiBaseUrl: getApiBaseUrl(),
    browserVisibleCookieNames: listBrowserVisibleCookieNames(),
    hasAppSessionStateCookie: hasAppSessionStateCookie(),
    lastSnapshot: lastSnapshot
      ? {
          authenticated: lastSnapshot.data.authenticated === true,
          hasUser: Boolean(lastSnapshot.data.user?.id),
          debug: lastSnapshot.debug,
        }
      : null,
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
  });

  throw lastError || new Error("登录态建立失败，请重试");
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
