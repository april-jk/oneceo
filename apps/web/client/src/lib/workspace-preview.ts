import {
  getWorkspaceRawTextFile,
  headWorkspaceRawFile,
  type WorkspaceRawHeadResult,
} from "@/lib/task-creation-client";
import i18n from "@/i18n";

export type WorkspaceHtmlPreviewState =
  | "checking"
  | "ready"
  | "runtime_unavailable"
  | "fetch_failed";

export function mapWorkspaceRawPreviewHeadResult(result: WorkspaceRawHeadResult): {
  state: WorkspaceHtmlPreviewState;
  message: string;
} {
  if (result.ok) {
    return { state: "ready", message: "" };
  }
  if (result.status === 409) {
    return {
      state: "runtime_unavailable",
      message: i18n.t("workspacePreview.runtimeUnavailable"),
    };
  }
  if (result.status === 404) {
    return {
      state: "runtime_unavailable",
      message: i18n.t("workspacePreview.preparing"),
    };
  }
  if (result.networkError) {
    return {
      state: "fetch_failed",
      message: i18n.t("workspacePreview.networkError"),
    };
  }
  if (result.status >= 500) {
    return {
      state: "runtime_unavailable",
      message: i18n.t("workspacePreview.recovering"),
    };
  }
  return {
    state: "fetch_failed",
    message: i18n.t("workspacePreview.loadFailed"),
  };
}

export function appendPreviewCacheBust(url: string, nonce: number): string {
  if (!url) return "";
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}_preview=${nonce}`;
}

function readHtmlAttribute(source: string, name: string): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    "\\b" +
      escapedName +
      "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s\"'=<>`]+))",
    "i",
  );
  const match = pattern.exec(source);
  return String(match?.[1] || match?.[2] || match?.[3] || "").trim();
}

function isLocalHtmlAssetReference(rawUrl: string): boolean {
  const url = rawUrl.trim();
  if (!url || url.startsWith("#")) return false;
  const lower = url.toLowerCase();
  if (
    lower.startsWith("//") ||
    lower.startsWith("data:") ||
    lower.startsWith("blob:") ||
    lower.startsWith("mailto:") ||
    lower.startsWith("tel:") ||
    lower.startsWith("javascript:")
  ) {
    return false;
  }
  return !/^[a-z][a-z0-9+.-]*:/i.test(url);
}

function stripHtmlAssetReferenceSuffix(rawUrl: string): string {
  const hashIndex = rawUrl.indexOf("#");
  const withoutHash = hashIndex >= 0 ? rawUrl.slice(0, hashIndex) : rawUrl;
  const queryIndex = withoutHash.indexOf("?");
  const withoutQuery =
    queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  try {
    return decodeURI(withoutQuery.trim());
  } catch {
    return withoutQuery.trim();
  }
}

function normalizeWorkspaceAssetPath(rawPath: string): string {
  const segments: string[] = [];
  for (const segment of rawPath.replace(/\\/g, "/").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return "";
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/");
}

function resolveHtmlAssetWorkspacePath(rawUrl: string, htmlPath: string): string {
  if (!isLocalHtmlAssetReference(rawUrl)) return "";
  const cleaned = stripHtmlAssetReferenceSuffix(rawUrl);
  if (!cleaned) return "";
  if (cleaned.startsWith("/")) {
    return normalizeWorkspaceAssetPath(cleaned);
  }
  const htmlDir = normalizeWorkspaceAssetPath(htmlPath)
    .split("/")
    .slice(0, -1)
    .join("/");
  return normalizeWorkspaceAssetPath([htmlDir, cleaned].filter(Boolean).join("/"));
}

export function extractWorkspaceHtmlPreviewAssetPaths(
  html: string,
  htmlPath: string,
): string[] {
  const assets = new Set<string>();
  const normalizedHtmlPath = normalizeWorkspaceAssetPath(htmlPath);
  const addAsset = (rawUrl: string) => {
    const path = resolveHtmlAssetWorkspacePath(rawUrl, htmlPath);
    if (path && path !== normalizedHtmlPath) {
      assets.add(path);
    }
  };

  const linkPattern = /<link\b([^>]*)>/gi;
  let linkMatch: RegExpExecArray | null = null;
  while ((linkMatch = linkPattern.exec(html)) !== null) {
    const attributes = String(linkMatch[1] || "");
    const rel = readHtmlAttribute(attributes, "rel").toLowerCase();
    if (!rel.split(/\s+/).includes("stylesheet")) continue;
    addAsset(readHtmlAttribute(attributes, "href"));
  }

  const scriptPattern = /<script\b([^>]*)>/gi;
  let scriptMatch: RegExpExecArray | null = null;
  while ((scriptMatch = scriptPattern.exec(html)) !== null) {
    addAsset(readHtmlAttribute(String(scriptMatch[1] || ""), "src"));
  }

  return Array.from(assets).slice(0, 24);
}

function shouldRetryHtmlPreviewCheck(result: {
  state: WorkspaceHtmlPreviewState;
}) {
  return result.state === "runtime_unavailable" || result.state === "fetch_failed";
}

export async function checkWorkspaceHtmlPreviewReady(
  sessionId: string,
  htmlPath: string,
): Promise<{
  state: WorkspaceHtmlPreviewState;
  message: string;
}> {
  const htmlResult = await getWorkspaceRawTextFile(sessionId, htmlPath);
  const htmlState = mapWorkspaceRawPreviewHeadResult(htmlResult);
  if (!htmlResult.ok) {
    return htmlState;
  }

  const assetPaths = extractWorkspaceHtmlPreviewAssetPaths(
    htmlResult.text,
    htmlPath,
  );
  for (const assetPath of assetPaths) {
    const assetResult = await headWorkspaceRawFile(sessionId, assetPath);
    if (!assetResult.ok) {
      return mapWorkspaceRawPreviewHeadResult(assetResult);
    }
  }
  return { state: "ready", message: "" };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

export async function waitWorkspaceHtmlPreviewReady(
  sessionId: string,
  htmlPath: string,
  options?: {
    attempts?: number;
    intervalMs?: number;
  },
): Promise<{
  state: WorkspaceHtmlPreviewState;
  message: string;
}> {
  const attempts = Math.max(1, Math.floor(options?.attempts ?? 8));
  const intervalMs = Math.max(100, Math.floor(options?.intervalMs ?? 600));
  let last: {
    state: WorkspaceHtmlPreviewState;
    message: string;
  } = {
    state: "checking",
    message: "",
  };
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    last = await checkWorkspaceHtmlPreviewReady(sessionId, htmlPath);
    if (!shouldRetryHtmlPreviewCheck(last) || attempt === attempts - 1) {
      return last;
    }
    await sleep(intervalMs);
  }
  return last;
}
