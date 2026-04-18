import type { WorkspaceRawHeadResult } from "@/lib/task-creation-client";
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
