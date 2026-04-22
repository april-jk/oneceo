export const LEGACY_CLIENT_USER_ID_STORAGE_KEY = "oneceo_client_user_id";

export function buildClientIdentityHeaders(init?: HeadersInit): HeadersInit {
  return new Headers(init);
}

export function readLegacyClientUserId(): string {
  try {
    return window.localStorage.getItem(LEGACY_CLIENT_USER_ID_STORAGE_KEY)?.trim() || "";
  } catch {
    return "";
  }
}

export function clearLegacyClientUserId() {
  try {
    window.localStorage.removeItem(LEGACY_CLIENT_USER_ID_STORAGE_KEY);
  } catch {
    // ignore non-browser runtimes
  }
}
