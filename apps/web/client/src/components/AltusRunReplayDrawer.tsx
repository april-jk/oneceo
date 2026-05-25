import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Bug,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileText,
  ListTodo,
  Rocket,
  XCircle,
} from "lucide-react";
import { Streamdown } from "streamdown";
import type { AltusArtifactFile } from "@/components/AltusArtifactPreviewCard";
import {
  DebugPreview,
  DeploymentPreview,
  FilePreview,
  useWorkspaceDebugPreviewState,
  useWorkspaceFilePreviewState,
} from "@/components/OpencodePreviewPanel";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  getTaskCreationBrowserActionScreenshotUrl,
  getTaskCreationDeploymentInfo,
  type TaskCreationDeploymentInfo,
} from "@/lib/task-creation-client";
import { cn } from "@/lib/utils";
import { normalizeWorkspaceRelativePath } from "@/lib/workspace-path";
import type { PreviewDiffItem } from "@/lib/opencode-preview";
import i18n from "@/i18n";
import { useTranslation } from "react-i18next";

export type AltusReplayActionStatus =
  | "running"
  | "completed"
  | "failed"
  | "unknown";

export type AltusReplayAction = {
  runId: string;
  toolCallId: string;
  stepIndex: number;
  toolName: string;
  displayName: string;
  status: AltusReplayActionStatus;
  summary: string;
  detail: string;
  internalDetail?: string;
  artifactPaths: string[];
  browserScreenshot?: AltusReplayBrowserScreenshot | null;
};

export type AltusReplayBrowserScreenshot = {
  type: "browser_screenshot";
  kind: "browser_action_screenshot";
  status: "captured" | "capture_failed" | "storage_failed";
  storageKey?: string;
  mimeType?: "image/png";
  width?: number;
  height?: number;
  capturedAt?: string;
  reasonCode?: string;
  message?: string;
  visualCheck?: {
    status: "passed" | "failed";
    reasonCode?: string;
    message?: string;
    diagnostics?: Record<string, unknown>;
  };
  source?: {
    sandboxId?: string;
    cdpPort?: number;
    url?: string;
    title?: string;
    toolName?: string;
    action?: string;
    description?: string;
  };
};

export function shouldRenderReplayActionMarkdown(
  action: Pick<AltusReplayAction, "toolName"> | null | undefined,
) {
  return action?.toolName === "complete_task";
}

export function normalizeReplayCompletionMarkdown(markdown: string) {
  return markdown
    .trim()
    .replace(/(^|\n)([ \t]*)•[ \t]+/g, "$1$2- ")
    .replace(/([^\n])([ \t]+)•[ \t]+/g, "$1\n- ");
}

function ReplayActionMarkdown({
  markdown,
  compact = false,
}: {
  markdown: string;
  compact?: boolean;
}) {
  const text = normalizeReplayCompletionMarkdown(markdown);
  if (!text) return null;
  return (
    <div
      className={cn(
        "max-w-none break-words text-sm leading-relaxed text-zinc-700 dark:text-zinc-300",
        "[&_p]:my-1 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_strong]:font-semibold",
        "[&_code]:rounded [&_code]:bg-zinc-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.92em] dark:[&_code]:bg-zinc-800",
        compact
          ? "max-h-40 overflow-hidden [&_a]:pointer-events-none [&_a]:text-inherit [&_a]:no-underline"
          : "text-xs leading-5 [&_p]:my-1.5 [&_ul]:my-1.5 [&_ol]:my-1.5",
      )}
    >
      <Streamdown>{text}</Streamdown>
    </div>
  );
}

export type AltusReplayFile = AltusArtifactFile & {
  displayName: string;
  lastSourceToolCallId?: string;
  lastSourceStepIndex?: number;
};

export type AltusDrawerView =
  | "actions"
  | "files"
  | "changes"
  | "debug"
  | "deployment";

type AltusRunReplayDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  embedded?: boolean;
  sessionId: string;
  runId: string;
  runTitle?: string;
  actions: AltusReplayAction[];
  files: AltusReplayFile[];
  currentIndex: number;
  latestIndex: number;
  activeView?: AltusDrawerView;
  onActiveViewChange?: (view: AltusDrawerView) => void;
  onSelectIndex: (index: number) => void;
  onJumpToLatest: () => void;
  diffItems: PreviewDiffItem[];
  runtimeReady?: boolean;
  runtimeStarting?: boolean;
  onEnsureRuntime?: () => Promise<void>;
  runtimeSwitchBlocked?: boolean;
  onRequestStartDebugByMessage?: () => void;
  onRequestDeployByMessage?: () => void;
  onRequestRedeployByMessage?: () => void;
  onRequestRollbackByMessage?: () => void;
};

function getStatusIcon(status: AltusReplayActionStatus) {
  if (status === "completed") {
    return <Check className="h-4 w-4 text-zinc-700 dark:text-zinc-300" />;
  }
  if (status === "failed") {
    return <XCircle className="h-4 w-4 text-rose-600 dark:text-rose-400" />;
  }
  return <Clock3 className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />;
}

function getStatusBadgeCopy(status: AltusReplayActionStatus) {
  if (status === "completed") {
    return i18n.t("replayDrawer.completed");
  }
  if (status === "failed") {
    return i18n.t("replayDrawer.failed");
  }
  if (status === "running") {
    return i18n.t("replayDrawer.running");
  }
  return i18n.t("replayDrawer.unknown");
}

function getStatusBadgeClass(status: AltusReplayActionStatus) {
  if (status === "completed") {
    return "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700";
  }
  if (status === "failed") {
    return "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900";
  }
  return "bg-white text-zinc-700 border-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:border-zinc-700";
}

function uniqueFiles(files: AltusReplayFile[], sessionId: string) {
  const map = new Map<string, AltusReplayFile>();
  for (const file of files) {
    const normalizedPath = normalizeWorkspaceRelativePath(
      file.path || "",
      sessionId,
    );
    if (!normalizedPath || map.has(normalizedPath)) continue;
    map.set(normalizedPath, {
      ...file,
      path: normalizedPath,
    });
  }
  return Array.from(map.values());
}

export function resolveReplayPreferredFilePath(
  files: AltusReplayFile[],
  artifactPaths: string[] | undefined,
) {
  if (!files.length) return "";
  const normalizedArtifactPaths = Array.isArray(artifactPaths)
    ? artifactPaths.filter(Boolean)
    : [];
  return (
    normalizedArtifactPaths.find((path) =>
      files.some((file) => file.path === path),
    ) ||
    files[0]?.path ||
    ""
  );
}

export function resolveReplaySelectedFilePath(input: {
  currentSelectedPath: string;
  files: AltusReplayFile[];
  artifactPaths?: string[] | undefined;
  forcePreferred: boolean;
}) {
  const { currentSelectedPath, files, artifactPaths, forcePreferred } = input;
  const preferredPath = resolveReplayPreferredFilePath(files, artifactPaths);
  if (forcePreferred) {
    return preferredPath;
  }
  if (
    currentSelectedPath &&
    files.some((file) => file.path === currentSelectedPath)
  ) {
    return currentSelectedPath;
  }
  return preferredPath;
}

function isClickInsideElement(
  target: EventTarget | null,
  element: HTMLElement | null,
) {
  return Boolean(target instanceof Node && element?.contains(target));
}

function formatScreenshotTimestamp(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(i18n.language === "zh" ? "zh-CN" : "en-US", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function BrowserScreenshotEvidence({
  sessionId,
  runId,
  toolCallId,
  screenshot,
}: {
  sessionId: string;
  runId: string;
  toolCallId: string;
  screenshot?: AltusReplayBrowserScreenshot | null;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => {
    setImageFailed(false);
  }, [screenshot?.storageKey, toolCallId]);

  if (!screenshot) return null;
  const captured = screenshot.status === "captured" && screenshot.storageKey && !imageFailed;
  const visualStatus = screenshot.visualCheck?.status;
  const visualPassed = visualStatus === "passed";
  const visualFailed = visualStatus === "failed";
  const imageUrl = captured
    ? getTaskCreationBrowserActionScreenshotUrl(sessionId, runId, toolCallId)
    : "";
  const meta = [
    screenshot.source?.title,
    screenshot.source?.url,
    formatScreenshotTimestamp(screenshot.capturedAt),
  ].filter(Boolean);

  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-700 dark:bg-zinc-800">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-medium text-zinc-800 dark:text-zinc-100">
            浏览器截图
          </div>
          {meta.length > 0 ? (
            <div className="mt-0.5 truncate text-[11px] text-zinc-500 dark:text-zinc-400">
              {meta.join(" · ")}
            </div>
          ) : null}
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full border px-2 py-0.5 text-[11px]",
            captured && !visualFailed
              ? "border-zinc-300 bg-white text-zinc-700 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200"
              : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
          )}
        >
          {captured ? (visualPassed ? "检测通过" : visualFailed ? "检测未通过" : "已捕获") : "不可用"}
        </span>
      </div>
      {visualFailed ? (
        <div className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {screenshot.visualCheck?.reasonCode
            ? `${screenshot.visualCheck.reasonCode}: ${screenshot.visualCheck.message || "页面未渲染出有效内容。"}`
            : screenshot.visualCheck?.message || "页面未渲染出有效内容。"}
        </div>
      ) : null}
      {captured ? (
        <a
          href={imageUrl}
          target="_blank"
          rel="noreferrer"
          className="block overflow-hidden rounded-md border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900"
        >
          <img
            src={imageUrl}
            alt="浏览器操作截图"
            className="max-h-72 w-full object-contain"
            loading="lazy"
            onError={() => setImageFailed(true)}
          />
        </a>
      ) : (
        <div className="rounded-md border border-dashed border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
          {screenshot.message || "本次浏览器操作截图未能保存。"}
        </div>
      )}
    </div>
  );
}

export default function AltusRunReplayDrawer({
  open,
  onOpenChange,
  embedded = false,
  sessionId,
  runId,
  runTitle,
  actions = [],
  files = [],
  currentIndex,
  latestIndex,
  activeView,
  onActiveViewChange,
  onSelectIndex,
  onJumpToLatest,
  diffItems = [],
  runtimeReady,
  runtimeStarting,
  onEnsureRuntime,
  runtimeSwitchBlocked = false,
  onRequestStartDebugByMessage,
  onRequestDeployByMessage,
  onRequestRedeployByMessage,
  onRequestRollbackByMessage,
}: AltusRunReplayDrawerProps) {
  useTranslation();
  const normalizedFiles = useMemo(
    () => uniqueFiles(files, sessionId),
    [files, sessionId],
  );
  const selectedAction =
    currentIndex >= 0 && currentIndex < actions.length
      ? actions[currentIndex]
      : null;
  const [selectedFilePath, setSelectedFilePath] = useState<string>(
    normalizedFiles[0]?.path || "",
  );
  const [drawerView, setDrawerViewState] = useState<AltusDrawerView>(
    activeView || "actions",
  );
  const [selectedDiffId, setSelectedDiffId] = useState<string>(
    diffItems.at(-1)?.id || "",
  );
  const [deploymentAction, setDeploymentAction] = useState<
    "deploy" | "redeploy" | "rollback" | null
  >(null);
  const [detailViewMode, setDetailViewMode] = useState<"user" | "internal">(
    "user",
  );
  const [selectedActionVisible, setSelectedActionVisible] = useState(true);
  const [selectedDeploymentId, setSelectedDeploymentId] = useState<
    string | null
  >(null);
  const [deploymentInfo, setDeploymentInfo] =
    useState<TaskCreationDeploymentInfo | null>(null);
  const [deploymentLoading, setDeploymentLoading] = useState(false);
  const [deploymentError, setDeploymentError] = useState<string | null>(null);
  const effectiveEnsureRuntime = runtimeSwitchBlocked
    ? undefined
    : onEnsureRuntime;
  const filePreview = useWorkspaceFilePreviewState({
    sessionId,
    open: open && drawerView === "files",
    runtimeReady,
    runtimeStarting,
    onEnsureRuntime: effectiveEnsureRuntime,
    selectedWorkspacePath: selectedFilePath || normalizedFiles[0]?.path || null,
    diffItems,
  });
  const debugPreview = useWorkspaceDebugPreviewState({
    sessionId,
    open,
    active: drawerView === "debug",
    runtimeReady,
    runtimeStarting,
    onEnsureRuntime: effectiveEnsureRuntime,
  });
  const selectedActionKey = `${runId}:${selectedAction?.toolCallId || "none"}`;
  const previousSelectedActionKeyRef = useRef(selectedActionKey);
  const drawerContentRef = useRef<HTMLDivElement | null>(null);
  const selectedActionPanelRef = useRef<HTMLDivElement | null>(null);
  const actionButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const setDrawerView = (view: AltusDrawerView) => {
    setDrawerViewState(view);
    onActiveViewChange?.(view);
  };

  useEffect(() => {
    if (!activeView) return;
    setDrawerViewState(activeView);
  }, [activeView, runId]);

  useEffect(() => {
    const actionChanged =
      previousSelectedActionKeyRef.current !== selectedActionKey;
    setSelectedFilePath((prev) =>
      resolveReplaySelectedFilePath({
        currentSelectedPath: prev,
        files: normalizedFiles,
        artifactPaths: selectedAction?.artifactPaths,
        forcePreferred: actionChanged || !prev,
      }),
    );
    previousSelectedActionKeyRef.current = selectedActionKey;
  }, [normalizedFiles, selectedActionKey]);

  useEffect(() => {
    if (activeView) return;
    setDrawerViewState("actions");
  }, [activeView, runId]);

  useEffect(() => {
    setDetailViewMode("user");
  }, [runId, selectedAction?.toolCallId]);

  useEffect(() => {
    setSelectedActionVisible(true);
  }, [runId, selectedAction?.toolCallId]);

  useEffect(() => {
    if (!open || drawerView !== "actions" || !selectedActionVisible) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!isClickInsideElement(target, drawerContentRef.current)) return;
      if (isClickInsideElement(target, selectedActionPanelRef.current)) return;
      setSelectedActionVisible(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [drawerView, open, selectedActionVisible]);

  useEffect(() => {
    if (!open || drawerView !== "actions" || !selectedAction?.toolCallId) {
      return;
    }
    const node = actionButtonRefs.current.get(selectedAction.toolCallId);
    if (!node) return;
    const frame = window.requestAnimationFrame(() => {
      node.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [drawerView, open, selectedAction?.toolCallId]);

  useEffect(() => {
    if (!diffItems.length) {
      setSelectedDiffId("");
      return;
    }
    if (!diffItems.some((item) => item.id === selectedDiffId)) {
      setSelectedDiffId(diffItems[diffItems.length - 1]?.id || "");
    }
  }, [diffItems, selectedDiffId]);

  useEffect(() => {
    if (!open || drawerView !== "deployment") return;
    if (runtimeSwitchBlocked) {
      setDeploymentInfo(null);
      setDeploymentError(i18n.t("previewPanel.deployment.blockedDuringRun"));
      setDeploymentLoading(false);
      return;
    }
    let cancelled = false;
    setDeploymentLoading(true);
    setDeploymentError(null);
    void getTaskCreationDeploymentInfo(sessionId)
      .then((info) => {
        if (cancelled) return;
        setDeploymentInfo(info);
        setSelectedDeploymentId(info?.deploymentId || null);
      })
      .catch((error) => {
        if (cancelled) return;
        setDeploymentError(
          error instanceof Error
            ? error.message
            : i18n.t("replayDrawer.loadDeploymentFailed"),
        );
      })
      .finally(() => {
        if (cancelled) return;
        setDeploymentLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [drawerView, open, runtimeSwitchBlocked, sessionId]);

  const canGoPrev = currentIndex > 0;
  const canGoNext = currentIndex < latestIndex;
  const completedCount = actions.filter(
    (action) => action.status === "completed",
  ).length;
  const currentDiff =
    diffItems.find((item) => item.id === selectedDiffId) ||
    diffItems[diffItems.length - 1] ||
    null;
  const canShowInternalDetail = Boolean(selectedAction?.internalDetail?.trim());
  const selectedActionDetail =
    detailViewMode === "internal" && canShowInternalDetail
      ? selectedAction?.internalDetail || ""
      : selectedAction?.detail || "";

  const refreshDeployment = async (deploymentId?: string) => {
    if (runtimeSwitchBlocked) {
      setDeploymentError(i18n.t("previewPanel.deployment.blockedDuringRun"));
      return;
    }
    setDeploymentLoading(true);
    setDeploymentError(null);
    try {
      const targetDeploymentId =
        deploymentId || selectedDeploymentId || undefined;
      const info = await getTaskCreationDeploymentInfo(
        sessionId,
        targetDeploymentId,
      );
      setDeploymentInfo(info);
      setSelectedDeploymentId(info?.deploymentId || targetDeploymentId || null);
    } catch (error) {
      setDeploymentError(
        error instanceof Error
          ? error.message
          : i18n.t("replayDrawer.loadDeploymentFailed"),
      );
    } finally {
      setDeploymentLoading(false);
    }
  };

  const runDeploymentAction = async (
    action: "deploy" | "redeploy" | "rollback",
  ) => {
    if (runtimeSwitchBlocked) {
      setDeploymentError(i18n.t("previewPanel.deployment.blockedDuringRun"));
      return;
    }
    setDeploymentAction(action);
    setDeploymentError(null);
    try {
      const messageHandler =
        action === "deploy"
          ? onRequestDeployByMessage
          : action === "redeploy"
            ? onRequestRedeployByMessage
            : onRequestRollbackByMessage;
      if (messageHandler) {
        messageHandler();
        setDeploymentAction(null);
        return;
      }
      setDeploymentError(i18n.t("replayDrawer.missingDeployEntry"));
    } catch (error) {
      setDeploymentError(
        error instanceof Error
          ? error.message
          : i18n.t("replayDrawer.deployActionFailed"),
      );
    } finally {
      setDeploymentAction(null);
    }
  };

  const handleReplayFileSelect = async (path: string) => {
    const normalizedPath = normalizeWorkspaceRelativePath(path, sessionId);
    if (!normalizedPath) return;
    setSelectedFilePath(normalizedPath);
    await filePreview.handleFileSelect(normalizedPath);
  };

  const handleSelectActionIndex = (index: number) => {
    setSelectedActionVisible(true);
    onSelectIndex(index);
  };

  const handleJumpToLatestAction = () => {
    setSelectedActionVisible(true);
    onJumpToLatest();
  };

  const content = (
    <div
      ref={drawerContentRef}
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden",
        embedded ? "gap-3 p-2" : "",
      )}
    >
      <div
        className={cn(
          "h-12 flex-shrink-0 px-3 flex items-center justify-between",
          embedded
            ? "rounded-xl border border-border/60 bg-card/80"
            : "border-b border-border bg-background/95 backdrop-blur-sm",
        )}
      >
        <div className="flex items-center min-w-0">
          {embedded ? (
            <div className="text-base font-semibold truncate">
              {runTitle || i18n.t("replayDrawer.titleFallback")}
            </div>
          ) : (
            <>
              <SheetTitle className="text-base font-semibold truncate">
                {runTitle || i18n.t("replayDrawer.titleFallback")}
              </SheetTitle>
              <SheetDescription className="sr-only">
                {i18n.t("replayDrawer.description")}
              </SheetDescription>
            </>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <div className="relative flex flex-wrap items-center rounded-full bg-zinc-100 p-[2px] dark:bg-zinc-800/90">
            <ReplayHeaderTab
              active={drawerView === "actions"}
              onClick={() => setDrawerView("actions")}
            >
              <Activity className="h-3 w-3" />
              <span>Actions</span>
            </ReplayHeaderTab>
            <ReplayHeaderTab
              active={drawerView === "files"}
              onClick={() => setDrawerView("files")}
            >
              <FileText className="h-3 w-3" />
              <span>{i18n.t("replayDrawer.tabs.files")}</span>
            </ReplayHeaderTab>
            <ReplayHeaderTab
              active={drawerView === "changes"}
              onClick={() => setDrawerView("changes")}
            >
              <FileText className="h-3 w-3" />
              <span>{i18n.t("replayDrawer.tabs.changes")}</span>
            </ReplayHeaderTab>
            <ReplayHeaderTab
              active={drawerView === "debug"}
              onClick={() => setDrawerView("debug")}
            >
              <Bug className="h-3 w-3" />
              <span>{i18n.t("replayDrawer.tabs.debug")}</span>
            </ReplayHeaderTab>
            <ReplayHeaderTab
              active={drawerView === "deployment"}
              onClick={() => setDrawerView("deployment")}
            >
              <Rocket className="h-3 w-3" />
              <span>{i18n.t("replayDrawer.tabs.deployment")}</span>
            </ReplayHeaderTab>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-2xl text-muted-foreground hover:text-foreground"
            onClick={() => onOpenChange(false)}
            title={i18n.t("replayDrawer.close")}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div
        className={cn(
          "flex-1 min-h-0 flex flex-col overflow-hidden",
          embedded ? "rounded-xl border border-border/60 bg-card/60" : "",
        )}
      >
        {drawerView === "actions" ? (
          <div className="h-full w-full overflow-hidden">
            <div
              className={cn(
                "flex h-full flex-col overflow-hidden",
                embedded ? "bg-transparent" : "bg-card",
              )}
            >
              <div
                className={cn(
                  "h-14 px-4 py-2 backdrop-blur-sm",
                  embedded
                    ? "bg-transparent"
                    : "border-b bg-zinc-50/80 dark:bg-zinc-900/80",
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <div
                      className={cn(
                        "rounded-lg p-2",
                        embedded
                          ? "bg-zinc-100/70 dark:bg-zinc-800/60"
                          : "border bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700",
                      )}
                    >
                      <ListTodo className="h-5 w-5 text-zinc-700 dark:text-zinc-300" />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-base font-medium text-zinc-900 dark:text-zinc-100">
                        {i18n.t("replayDrawer.updateTasks")}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "inline-flex items-center justify-center rounded-2xl px-3 py-1.5 text-xs font-normal text-foreground",
                        embedded
                          ? "bg-zinc-100/70 dark:bg-zinc-800/60"
                          : "border",
                      )}
                    >
                      {i18n.t("replayDrawer.tasksProgress", {
                        completed: completedCount,
                        total: actions.length,
                      })}
                    </span>
                  </div>
                </div>
              </div>

              <ScrollArea className="flex-1 min-h-0">
                <div className="py-0">
                  {actions.length === 0 ? (
                    <div className="px-4 py-8 text-sm text-muted-foreground">
                      {i18n.t("replayDrawer.emptyActions")}
                    </div>
                  ) : (
                    <div
                      className={cn(
                        "last:border-b-0",
                        embedded
                          ? ""
                          : "border-b border-zinc-200 dark:border-zinc-800",
                      )}
                    >
                      <div
                        className={cn(
                          "flex items-center justify-between px-4 py-3",
                          embedded
                            ? "bg-transparent"
                            : "bg-zinc-50/80 border-b border-zinc-200 dark:border-zinc-700 dark:bg-zinc-900/80",
                        )}
                      >
                        <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                          {runTitle || i18n.t("replayDrawer.currentTask")}
                        </h3>
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center justify-center rounded-2xl border bg-white px-2 py-0 text-xs font-normal text-foreground dark:bg-zinc-800">
                            {Math.min(currentIndex + 1, actions.length)}/
                            {actions.length}
                          </span>
                          <span
                            className={cn(
                              "inline-flex items-center justify-center rounded-2xl border px-2 py-0 text-xs h-5",
                              getStatusBadgeClass(
                                selectedAction?.status || "unknown",
                              ),
                            )}
                          >
                            {getStatusBadgeCopy(
                              selectedAction?.status || "unknown",
                            )}
                          </span>
                        </div>
                      </div>

                      <div
                        className={cn(embedded ? "bg-transparent" : "bg-card")}
                      >
                        {actions.map((action) => {
                          const isActive = action.stepIndex === currentIndex;
                          return (
                            <button
                              key={action.toolCallId}
                              type="button"
                              ref={(node) => {
                                if (node) {
                                  actionButtonRefs.current.set(
                                    action.toolCallId,
                                    node,
                                  );
                                } else {
                                  actionButtonRefs.current.delete(
                                    action.toolCallId,
                                  );
                                }
                              }}
                              onClick={() =>
                                handleSelectActionIndex(action.stepIndex)
                              }
                              className={cn(
                                "flex w-full items-start gap-3 border-b border-zinc-100 px-4 py-3 text-left transition-colors last:border-b-0 dark:border-zinc-800",
                                isActive
                                  ? "bg-zinc-100/90 dark:bg-zinc-800/70"
                                  : "hover:bg-zinc-50/60 dark:hover:bg-zinc-800/40",
                              )}
                            >
                              <div className="flex-shrink-0 pt-0.5">
                                {getStatusIcon(action.status)}
                              </div>
                              <div className="min-w-0 flex-1 space-y-1">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                    {action.displayName}
                                  </p>
                                  <span
                                    className={cn(
                                      "inline-flex shrink-0 items-center justify-center rounded-2xl border px-2 py-0 text-xs",
                                      getStatusBadgeClass(action.status),
                                    )}
                                  >
                                    {getStatusBadgeCopy(action.status)}
                                  </span>
                                </div>
                                {shouldRenderReplayActionMarkdown(action) ? (
                                  <ReplayActionMarkdown
                                    markdown={
                                      action.summary || action.displayName
                                    }
                                    compact
                                  />
                                ) : (
                                  <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                                    {action.summary}
                                  </p>
                                )}
                                {action.artifactPaths.length > 0 ? (
                                  <div className="flex flex-wrap gap-1.5 pt-1">
                                    {action.artifactPaths
                                      .slice(0, 3)
                                      .map((path) => (
                                        <span
                                          key={`${action.toolCallId}:${path}`}
                                          className="inline-flex max-w-full items-center rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                                        >
                                          <span className="truncate">
                                            {path}
                                          </span>
                                        </span>
                                      ))}
                                  </div>
                                ) : null}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>

              {selectedActionVisible ? (
                <div
                  ref={selectedActionPanelRef}
                  className={cn(
                    "px-4 py-3",
                    embedded
                      ? "bg-transparent"
                      : "border-t border-zinc-200 bg-zinc-50/90 dark:border-zinc-800 dark:bg-zinc-900/90",
                  )}
                >
                  <div className="space-y-2">
                    <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
                      {i18n.t("replayDrawer.selectedAction")}
                    </div>
                    <div className="max-h-[30vh] overflow-y-auto rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
                      {selectedAction ? (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                {selectedAction.displayName}
                              </div>
                              <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                                {selectedAction.toolName}
                              </div>
                            </div>
                            <span
                              className={cn(
                                "inline-flex shrink-0 items-center justify-center rounded-2xl border px-2 py-0 text-xs",
                                getStatusBadgeClass(selectedAction.status),
                              )}
                            >
                              {getStatusBadgeCopy(selectedAction.status)}
                            </span>
                          </div>
                          {canShowInternalDetail ? (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => setDetailViewMode("user")}
                                className={cn(
                                  "rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                                  detailViewMode === "user"
                                    ? "border-zinc-300 bg-zinc-100 text-zinc-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                                    : "border-zinc-200 bg-white text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400",
                                )}
                              >
                                {i18n.t("replayDrawer.userDetail")}
                              </button>
                              <button
                                type="button"
                                onClick={() => setDetailViewMode("internal")}
                                className={cn(
                                  "rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                                  detailViewMode === "internal"
                                    ? "border-zinc-300 bg-zinc-100 text-zinc-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                                    : "border-zinc-200 bg-white text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400",
                                )}
                              >
                                {i18n.t("replayDrawer.internalDetail")}
                              </button>
                            </div>
                          ) : null}
                          {shouldRenderReplayActionMarkdown(selectedAction) &&
                          detailViewMode === "user" ? (
                            <div className="rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800">
                              <ReplayActionMarkdown
                                markdown={
                                  selectedActionDetail ||
                                  selectedAction.summary ||
                                  selectedAction.displayName
                                }
                              />
                            </div>
                          ) : (
                            <pre className="whitespace-pre-wrap break-all rounded-lg bg-zinc-50 px-3 py-2 text-xs leading-5 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                              {selectedActionDetail}
                            </pre>
                          )}
                          <BrowserScreenshotEvidence
                            sessionId={sessionId}
                            runId={runId}
                            toolCallId={selectedAction.toolCallId}
                            screenshot={selectedAction.browserScreenshot}
                          />
                        </div>
                      ) : (
                        <div className="text-sm text-muted-foreground">
                          {i18n.t("replayDrawer.noSelectedStep")}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : drawerView === "files" ? (
          <FilePreview
            sessionId={sessionId}
            tree={filePreview.effectiveTree}
            loading={filePreview.treeLoading}
            error={filePreview.treeError}
            selectedPath={filePreview.selectedPath}
            file={filePreview.fileData}
            contentError={filePreview.fileError}
            contentLoading={filePreview.fileLoading}
            expandedPaths={filePreview.expandedPaths}
            dirState={filePreview.dirState}
            onTogglePath={filePreview.handleTogglePath}
            onLoadMoreDir={filePreview.handleLoadMoreDirectory}
            onRefresh={() => void filePreview.refreshTree("manual")}
            onSelectFile={handleReplayFileSelect}
            runtimeReady={runtimeReady !== false}
            runtimeStarting={runtimeStarting === true}
            runtimeSwitchBlocked={runtimeSwitchBlocked}
          />
        ) : drawerView === "changes" ? (
          <AltusPreviewChangesPanel
            diffItems={diffItems}
            currentDiff={currentDiff}
            onSelectDiff={setSelectedDiffId}
          />
        ) : drawerView === "debug" ? (
          <DebugPreview
            info={debugPreview.debugInfo}
            loading={debugPreview.debugLoading}
            error={debugPreview.debugError}
            runtimeReady={runtimeReady !== false}
            starting={debugPreview.debugStarting}
            onRequestStartDebugByMessage={onRequestStartDebugByMessage}
            onStart={async () => {
              if (runtimeReady === false) {
                if (runtimeSwitchBlocked) {
                  debugPreview.setDebugError(
                    i18n.t("previewPanel.runtimeSwitchBlocked"),
                  );
                  return;
                }
                if (effectiveEnsureRuntime) {
                  debugPreview.setDebugStarting(true);
                  try {
                    await effectiveEnsureRuntime();
                  } finally {
                    debugPreview.setDebugStarting(false);
                  }
                }
                return;
              }
              if (!onRequestStartDebugByMessage) {
                debugPreview.setDebugError(
                  i18n.t("previewPanel.debug.missingStartEntry"),
                );
                return;
              }
              onRequestStartDebugByMessage();
            }}
          />
        ) : (
          <DeploymentPreview
            sessionId={sessionId}
            info={deploymentInfo}
            templateBaseline={null}
            templateBaselineLoading={false}
            templateBaselineError={null}
            loading={deploymentLoading}
            error={deploymentError}
            actionLoading={deploymentAction}
            selectedDeploymentId={selectedDeploymentId}
            onRefresh={(deploymentId) => void refreshDeployment(deploymentId)}
            onSelectDeployment={(deploymentId) => {
              setSelectedDeploymentId(deploymentId);
              void refreshDeployment(deploymentId);
            }}
            onDeploy={() => void runDeploymentAction("deploy")}
            onRedeploy={() => void runDeploymentAction("redeploy")}
            onRollback={() => void runDeploymentAction("rollback")}
            tokenRotationLoading={false}
            onRotateDeploymentToken={() => undefined}
          />
        )}
      </div>

      {drawerView === "actions" ? (
        <div
          className={cn(
            "flex-shrink-0 p-3",
            embedded
              ? "bg-transparent"
              : "border-t border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900",
          )}
        >
          <div className="flex items-center justify-between">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canGoPrev}
              className="h-8 rounded-2xl text-xs"
              onClick={() =>
                handleSelectActionIndex(Math.max(0, currentIndex - 1))
              }
            >
              <ChevronLeft className="mr-1 h-3.5 w-3.5" />
              <span>{i18n.t("replayDrawer.prev")}</span>
            </Button>
            <div className="flex items-center gap-1.5">
              <span className="min-w-[44px] text-xs font-medium tabular-nums text-zinc-600 dark:text-zinc-400">
                {actions.length === 0
                  ? "0/0"
                  : `${Math.min(currentIndex + 1, actions.length)}/${actions.length}`}
              </span>
              <button
                type="button"
                onClick={handleJumpToLatestAction}
                className="flex items-center justify-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-100 px-2.5 py-0.5 transition-colors hover:bg-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700"
              >
                <div className="h-1.5 w-1.5 rounded-full bg-zinc-500" />
                <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  {i18n.t("replayDrawer.jumpToLatest")}
                </span>
              </button>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canGoNext}
              className="h-8 rounded-2xl text-xs"
              onClick={() =>
                handleSelectActionIndex(Math.min(latestIndex, currentIndex + 1))
              }
            >
              <span>{i18n.t("replayDrawer.next")}</span>
              <ChevronRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );

  if (embedded) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-transparent">
        {content}
      </div>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="top-4 right-4 bottom-4 left-auto flex h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-none flex-col overflow-hidden rounded-2xl border border-border/70 p-0 shadow-sm sm:max-w-none md:w-[calc((100vw-6rem)*0.66)] lg:w-[calc((100vw-18rem)*0.66)] [&>button.absolute]:hidden"
      >
        {content}
      </SheetContent>
    </Sheet>
  );
}

function ReplayHeaderTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative z-10 flex h-[26px] items-center justify-center gap-1.5 rounded-full px-3 text-[11px] font-medium transition-colors",
        active
          ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-100"
          : "text-zinc-400 dark:text-zinc-500",
      )}
    >
      {children}
    </button>
  );
}

function formatAltusTimestamp(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(i18n.language === "zh" ? "zh-CN" : "en-US", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function AltusPreviewChangesPanel({
  diffItems,
  currentDiff,
  onSelectDiff,
}: {
  diffItems: PreviewDiffItem[];
  currentDiff: PreviewDiffItem | null;
  onSelectDiff: (id: string) => void;
}) {
  useTranslation();
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          {i18n.t("replayDrawer.changesTitle")}
          <span className="text-xs text-muted-foreground">
            {diffItems.length}
          </span>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto px-4 py-4 space-y-5">
        {diffItems.length ? (
          <>
            <section className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">
                {i18n.t("replayDrawer.recentChanges")}
              </div>
              <div className="flex items-center">
                <select
                  className="h-9 min-w-0 flex-1 rounded-md bg-transparent px-0 text-sm font-medium text-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-0"
                  value={
                    currentDiff?.id || diffItems[diffItems.length - 1]?.id || ""
                  }
                  onChange={(event) => onSelectDiff(event.target.value)}
                >
                  {diffItems
                    .slice()
                    .reverse()
                    .map((item, index) => (
                      <option key={item.id} value={item.id}>
                        {[
                          item.title || `Diff #${diffItems.length - index}`,
                          formatAltusTimestamp(item.createdAt),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </option>
                    ))}
                </select>
              </div>
            </section>
            {currentDiff ? (
              <section className="space-y-3">
                {currentDiff.files?.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {currentDiff.files.slice(0, 4).map((file) => (
                      <span
                        key={file.file}
                        className="rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                      >
                        {file.file}
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className="overflow-hidden rounded-xl bg-zinc-950 text-zinc-100 shadow-inner ring-1 ring-zinc-900/10 dark:bg-zinc-950/80">
                  <pre className="max-h-[30rem] overflow-auto p-4 font-mono text-[12px] leading-5 [tab-size:2]">
                    <code>
                      {currentDiff.diff || i18n.t("replayDrawer.noRawDiff")}
                    </code>
                  </pre>
                </div>
              </section>
            ) : null}
          </>
        ) : (
          <div className="rounded-lg border border-dashed border-slate-200 px-6 py-12 text-center text-sm text-slate-500">
            {i18n.t("replayDrawer.noChanges")}
          </div>
        )}
      </div>
    </div>
  );
}
