export function buildClientIdentityHeaders(init?: HeadersInit): HeadersInit {
  const headers = new Headers(init);
  try {
    const legacyUserId = window.localStorage.getItem("oneceo_client_user_id")?.trim();
    if (legacyUserId) {
      headers.set("X-Legacy-User-Id", legacyUserId);
    }
  } catch {
    // ignore non-browser runtimes
  }
  return headers;
}
