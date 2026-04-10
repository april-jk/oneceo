import type { WorkspaceRawHeadResult } from "@/lib/task-creation-client";

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
      message: "预览环境已关闭或未启动，点击“重新加载预览”后重试。",
    };
  }
  if (result.status === 404) {
    return {
      state: "fetch_failed",
      message: "预览文件不存在或已被移除。",
    };
  }
  if (result.networkError) {
    return {
      state: "fetch_failed",
      message: "网络异常，暂时无法加载预览，请稍后重试。",
    };
  }
  if (result.status >= 500) {
    return {
      state: "runtime_unavailable",
      message: "预览环境正在恢复中，点击“重新加载预览”继续尝试。",
    };
  }
  return {
    state: "fetch_failed",
    message: "预览加载失败，请稍后重试。",
  };
}

export function appendPreviewCacheBust(url: string, nonce: number): string {
  if (!url) return "";
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}_preview=${nonce}`;
}
