export function normalizeWorkspaceRelativePath(
  input: string,
  sessionId?: string | null,
): string {
  let normalized = String(input || "").trim().replace(/\\/g, "/");
  if (!normalized) return "";

  normalized = normalized.replace(/^\.\/+/, "");
  const safeSessionId = typeof sessionId === "string" ? sessionId.trim() : "";
  if (safeSessionId) {
    const lowerPath = normalized.toLowerCase();
    const lowerSessionId = safeSessionId.toLowerCase();
    const workspaceMarker = `/workspaces/${lowerSessionId}`;
    const markerIndex = lowerPath.indexOf(workspaceMarker);
    if (markerIndex >= 0) {
      const markerEnd = markerIndex + workspaceMarker.length;
      if (lowerPath.length === markerEnd) {
        normalized = "";
      } else if (normalized[markerEnd] === "/") {
        normalized = normalized.slice(markerEnd + 1);
      }
    } else {
      const markerNoLeadingSlash = `workspaces/${lowerSessionId}`;
      if (lowerPath === markerNoLeadingSlash) {
        normalized = "";
      } else if (lowerPath.startsWith(`${markerNoLeadingSlash}/`)) {
        normalized = normalized.slice(markerNoLeadingSlash.length + 1);
      }
    }
  }

  return normalized.replace(/^\/+/, "").replace(/\/+$/, "");
}
