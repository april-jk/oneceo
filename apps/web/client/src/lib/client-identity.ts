const CLIENT_USER_STORAGE_KEY = "oneceo_client_user_id";

function generateId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `local-${Math.random().toString(36).slice(2, 10)}`;
}

export function getClientUserId() {
  if (typeof window === "undefined") {
    return "server-render-user";
  }
  const existing = window.localStorage.getItem(CLIENT_USER_STORAGE_KEY);
  if (existing) return existing;
  const next = generateId();
  window.localStorage.setItem(CLIENT_USER_STORAGE_KEY, next);
  return next;
}

export function buildClientIdentityHeaders(init?: HeadersInit): HeadersInit {
  const base = new Headers(init);
  base.set("X-User-Id", getClientUserId());
  return base;
}
