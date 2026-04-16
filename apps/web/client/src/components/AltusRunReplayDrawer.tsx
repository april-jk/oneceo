import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Activity, Bug, Check, ChevronLeft, ChevronRight, Clock3, FileText, ListTodo, Rocket, XCircle } from "lucide-react";
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
  getTaskCreationDeploymentInfo,
  type TaskCreationDeploymentInfo,
} from "@/lib/task-creation-client";
import { cn } from "@/lib/utils";
import { normalizeWorkspaceRelativePath } from "@/lib/workspace-path";
import type { PreviewDiffItem } from "@/lib/opencode-preview";

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
  artifactPaths: string[];
};

export type AltusReplayFile = AltusArtifactFile & {
  displayName: string;
  lastSourceToolCallId?: string;
  lastSourceStepIndex?: number;
};

type AltusRunReplayDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  runId: string;
  runTitle?: string;
  actions: AltusReplayAction[];
  files: AltusReplayFile[];
  currentIndex: number;
  latestIndex: number;
  onSelectIndex: (index: number) => void;
  onJumpToLatest: () => void;
  diffItems: PreviewDiffItem[];
  runtimeReady?: boolean;
  runtimeStarting?: boolean;
  onEnsureRuntime?: () => Promise<void>;
  onRequestStartDebugByMessage?: () => void;
  onRequestDeployByMessage?: () => void;
  onRequestRedeployByMessage?: () => void;
  onRequestRollbackByMessage?: () => void;
  onOpenPreviewTab?: (tab: "files" | "changes" | "debug" | "deployment") => void;
};

type AltusDrawerView =
  | "actions"
  | "files"
  | "changes"
  | "debug"
  | "deployment";

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
    return "已完成";
  }
  if (status === "failed") {
    return "失败";
  }
  if (status === "running") {
    return "进行中";
  }
  return "待处理";
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
    const normalizedPath = normalizeWorkspaceRelativePath(file.path || "", sessionId);
    if (!normalizedPath || map.has(normalizedPath)) continue;
    map.set(normalizedPath, {
      ...file,
      path: normalizedPath,
    });
  }
  return Array.from(map.values());
}

export default function AltusRunReplayDrawer({
  open,
  onOpenChange,
  sessionId,
  runId,
  runTitle,
  actions = [],
  files = [],
  currentIndex,
  latestIndex,
  onSelectIndex,
  onJumpToLatest,
  diffItems = [],
  runtimeReady,
  runtimeStarting,
  onEnsureRuntime,
  onRequestStartDebugByMessage,
  onRequestDeployByMessage,
  onRequestRedeployByMessage,
  onRequestRollbackByMessage,
  onOpenPreviewTab,
}: AltusRunReplayDrawerProps) {
  const normalizedFiles = useMemo(
    () => uniqueFiles(files, sessionId),
    [files, sessionId],
  );
  const selectedAction =
    currentIndex >= 0 && currentIndex < actions.length ? actions[currentIndex] : null;
  const [selectedFilePath, setSelectedFilePath] = useState<string>(
    normalizedFiles[0]?.path || "",
  );
  const [drawerView, setDrawerView] = useState<AltusDrawerView>("actions");
  const [selectedDiffId, setSelectedDiffId] = useState<string>(
    diffItems.at(-1)?.id || "",
  );
  const [deploymentAction, setDeploymentAction] = useState<
    "deploy" | "redeploy" | "rollback" | null
  >(null);
  const [selectedDeploymentId, setSelectedDeploymentId] = useState<
    string | null
  >(null);
  const [deploymentInfo, setDeploymentInfo] =
    useState<TaskCreationDeploymentInfo | null>(null);
  const [deploymentLoading, setDeploymentLoading] = useState(false);
  const [deploymentError, setDeploymentError] = useState<string | null>(null);
  const filePreview = useWorkspaceFilePreviewState({
    sessionId,
    open: open && drawerView === "files",
    runtimeReady,
    runtimeStarting,
    onEnsureRuntime,
    selectedWorkspacePath: selectedFilePath || normalizedFiles[0]?.path || null,
    diffItems,
  });
  const debugPreview = useWorkspaceDebugPreviewState({
    sessionId,
    open,
    active: drawerView === "debug",
    runtimeReady,
    runtimeStarting,
    onEnsureRuntime,
  });

  useEffect(() => {
    const preferredPath =
      selectedAction?.artifactPaths.find((path) =>
        normalizedFiles.some((file) => file.path === path),
      ) || normalizedFiles[0]?.path || "";
    setSelectedFilePath(preferredPath);
  }, [normalizedFiles, runId, selectedAction?.artifactPaths]);

  useEffect(() => {
    setDrawerView("actions");
  }, [runId]);

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
          error instanceof Error ? error.message : "加载部署信息失败",
        );
      })
      .finally(() => {
        if (cancelled) return;
        setDeploymentLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [drawerView, open, sessionId]);

  const canGoPrev = currentIndex > 0;
  const canGoNext = currentIndex < latestIndex;
  const completedCount = actions.filter((action) => action.status === "completed").length;
  const currentDiff =
    diffItems.find((item) => item.id === selectedDiffId) ||
    diffItems[diffItems.length - 1] ||
    null;

  const refreshDeployment = async (deploymentId?: string) => {
    setDeploymentLoading(true);
    setDeploymentError(null);
    try {
      const targetDeploymentId = deploymentId || selectedDeploymentId || undefined;
      const info = await getTaskCreationDeploymentInfo(
        sessionId,
        targetDeploymentId,
      );
      setDeploymentInfo(info);
      setSelectedDeploymentId(
        info?.deploymentId || targetDeploymentId || null,
      );
    } catch (error) {
      setDeploymentError(
        error instanceof Error ? error.message : "加载部署信息失败",
      );
    } finally {
      setDeploymentLoading(false);
    }
  };

  const runDeploymentAction = async (
    action: "deploy" | "redeploy" | "rollback",
  ) => {
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
      setDeploymentError("当前页面未绑定部署消息入口，请回到会话页触发部署。");
    } catch (error) {
      setDeploymentError(error instanceof Error ? error.message : "部署操作失败");
    } finally {
      setDeploymentAction(null);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="top-4 right-4 bottom-4 left-auto flex h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-none flex-col overflow-hidden rounded-2xl border border-border/70 p-0 shadow-sm sm:max-w-none md:w-[calc((100vw-6rem)*0.66)] lg:w-[calc((100vw-18rem)*0.66)] [&>button.absolute]:hidden"
      >
        <div className="h-12 flex-shrink-0 px-3 flex items-center justify-between border-b border-border bg-background/95 backdrop-blur-sm">
          <div className="flex items-center min-w-0">
            <SheetTitle className="text-base font-semibold truncate">
              {runTitle || "Altus Run Replay"}
            </SheetTitle>
            <SheetDescription className="sr-only">
              Altus 接管模式的 Actions 与 Files 回放查看器
            </SheetDescription>
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
                <span>文件</span>
              </ReplayHeaderTab>
              <ReplayHeaderTab
                active={drawerView === "changes"}
                onClick={() => setDrawerView("changes")}
              >
                <FileText className="h-3 w-3" />
                <span>更改</span>
              </ReplayHeaderTab>
              <ReplayHeaderTab
                active={drawerView === "debug"}
                onClick={() => setDrawerView("debug")}
              >
                <Bug className="h-3 w-3" />
                <span>调试</span>
              </ReplayHeaderTab>
              <ReplayHeaderTab
                active={drawerView === "deployment"}
                onClick={() => setDrawerView("deployment")}
              >
                <Rocket className="h-3 w-3" />
                <span>部署</span>
              </ReplayHeaderTab>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-2xl text-muted-foreground hover:text-foreground"
              onClick={() => onOpenChange(false)}
              title="关闭"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {drawerView === "actions" ? (
            <div className="h-full w-full overflow-hidden">
              <div className="flex h-full flex-col overflow-hidden bg-card">
                <div className="h-14 border-b bg-zinc-50/80 px-4 py-2 backdrop-blur-sm dark:bg-zinc-900/80">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="rounded-lg border bg-zinc-100 p-2 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700">
                        <ListTodo className="h-5 w-5 text-zinc-700 dark:text-zinc-300" />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-base font-medium text-zinc-900 dark:text-zinc-100">
                          Update Tasks
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center justify-center rounded-2xl border px-3 py-1.5 text-xs font-normal text-foreground">
                        {completedCount} / {actions.length} tasks
                      </span>
                    </div>
                  </div>
                </div>

                <ScrollArea className="flex-1 min-h-0">
                  <div className="py-0">
                    {actions.length === 0 ? (
                      <div className="px-4 py-8 text-sm text-muted-foreground">
                        当前 run 还没有可回放的动作。
                      </div>
                    ) : (
                      <div className="border-b border-zinc-200 dark:border-zinc-800 last:border-b-0">
                        <div className="flex items-center justify-between bg-zinc-50/80 px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 dark:bg-zinc-900/80">
                          <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                            {runTitle || "当前任务"}
                          </h3>
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center justify-center rounded-2xl border bg-white px-2 py-0 text-xs font-normal text-foreground dark:bg-zinc-800">
                              {Math.min(currentIndex + 1, actions.length)}/{actions.length}
                            </span>
                            <span className={cn("inline-flex items-center justify-center rounded-2xl border px-2 py-0 text-xs h-5", getStatusBadgeClass(selectedAction?.status || "unknown"))}>
                              {getStatusBadgeCopy(selectedAction?.status || "unknown")}
                            </span>
                          </div>
                        </div>

                        <div className="bg-card">
                          {actions.map((action) => {
                            const isActive = action.stepIndex === currentIndex;
                            return (
                              <button
                                key={action.toolCallId}
                                type="button"
                                onClick={() => onSelectIndex(action.stepIndex)}
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
                                    <span className={cn("inline-flex shrink-0 items-center justify-center rounded-2xl border px-2 py-0 text-xs", getStatusBadgeClass(action.status))}>
                                      {getStatusBadgeCopy(action.status)}
                                    </span>
                                  </div>
                                  <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                                    {action.summary}
                                  </p>
                                  {action.artifactPaths.length > 0 ? (
                                    <div className="flex flex-wrap gap-1.5 pt-1">
                                      {action.artifactPaths.slice(0, 3).map((path) => (
                                        <span
                                          key={`${action.toolCallId}:${path}`}
                                          className="inline-flex max-w-full items-center rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                                        >
                                          <span className="truncate">{path}</span>
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

                <div className="border-t border-zinc-200 bg-zinc-50/90 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/90">
                  <div className="space-y-2">
                    <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
                      Selected Action
                    </div>
                    <div className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
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
                            <span className={cn("inline-flex shrink-0 items-center justify-center rounded-2xl border px-2 py-0 text-xs", getStatusBadgeClass(selectedAction.status))}>
                              {getStatusBadgeCopy(selectedAction.status)}
                            </span>
                          </div>
                          <pre className="whitespace-pre-wrap break-all rounded-lg bg-zinc-50 px-3 py-2 text-xs leading-5 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                            {selectedAction.detail}
                          </pre>
                        </div>
                      ) : (
                        <div className="text-sm text-muted-foreground">暂无选中的步骤。</div>
                      )}
                    </div>
                  </div>
                </div>
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
              onSelectFile={filePreview.handleFileSelect}
              runtimeReady={runtimeReady !== false}
              runtimeStarting={runtimeStarting === true}
            />
          ) : drawerView === "changes" ? (
            <AltusPreviewChangesPanel
              diffItems={diffItems}
              currentDiff={currentDiff}
              onSelectDiff={setSelectedDiffId}
              onOpenPreviewTab={onOpenPreviewTab}
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
                  if (onEnsureRuntime) {
                    debugPreview.setDebugStarting(true);
                    try {
                      await onEnsureRuntime();
                    } finally {
                      debugPreview.setDebugStarting(false);
                    }
                  }
                  return;
                }
                if (!onRequestStartDebugByMessage) {
                  debugPreview.setDebugError("缺少启动调试消息入口");
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
        <div className="flex-shrink-0 border-t border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canGoPrev}
              className="h-8 rounded-2xl text-xs"
              onClick={() => onSelectIndex(Math.max(0, currentIndex - 1))}
            >
              <ChevronLeft className="mr-1 h-3.5 w-3.5" />
              <span>Prev</span>
            </Button>
            <div className="flex items-center gap-1.5">
              <span className="min-w-[44px] text-xs font-medium tabular-nums text-zinc-600 dark:text-zinc-400">
                {actions.length === 0 ? "0/0" : `${Math.min(currentIndex + 1, actions.length)}/${actions.length}`}
              </span>
              <button
                type="button"
                onClick={onJumpToLatest}
                className="flex items-center justify-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-100 px-2.5 py-0.5 transition-colors hover:bg-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700"
              >
                <div className="h-1.5 w-1.5 rounded-full bg-zinc-500" />
                <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Jump to Latest
                </span>
              </button>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canGoNext}
              className="h-8 rounded-2xl text-xs"
              onClick={() => onSelectIndex(Math.min(latestIndex, currentIndex + 1))}
            >
              <span>Next</span>
              <ChevronRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        ) : null}
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
  if (!value) return "时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
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
  onOpenPreviewTab,
}: {
  diffItems: PreviewDiffItem[];
  currentDiff: PreviewDiffItem | null;
  onSelectDiff: (id: string) => void;
  onOpenPreviewTab?: (tab: "files" | "changes" | "debug" | "deployment") => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          更改
          <span className="text-xs text-muted-foreground">{diffItems.length}</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 rounded-full"
          onClick={() => onOpenPreviewTab?.("changes")}
        >
          在内容预览中打开
        </Button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto px-4 py-4 space-y-4">
        {diffItems.length ? (
          <>
            <section className="rounded-lg border border-slate-200/80 bg-white p-4">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">最近更改</span>
                <select
                  className="text-xs border border-border rounded-md bg-background px-2 py-1 flex-1"
                  value={currentDiff?.id || diffItems[diffItems.length - 1]?.id || ""}
                  onChange={(event) => onSelectDiff(event.target.value)}
                >
                  {diffItems
                    .slice()
                    .reverse()
                    .map((item, index) => (
                      <option key={item.id} value={item.id}>
                        {(item.title || `Diff #${diffItems.length - index}`) +
                          ` · ${formatAltusTimestamp(item.createdAt)}`}
                      </option>
                    ))}
                </select>
              </div>
            </section>
            {currentDiff ? (
              <section className="rounded-lg border border-slate-200/80 bg-white p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
                      当前更改
                    </div>
                    <div className="mt-1 truncate text-sm font-medium text-slate-900">
                      {currentDiff.title || "最近更改"}
                    </div>
                  </div>
                  <span className="text-xs text-slate-500">
                    {formatAltusTimestamp(currentDiff.createdAt)}
                  </span>
                </div>
                {currentDiff.files?.length ? (
                  <div className="flex flex-wrap gap-2">
                    {currentDiff.files.slice(0, 4).map((file) => (
                      <span
                        key={file.file}
                        className="rounded-full border border-slate-200 px-2 py-0.5 text-[11px] text-slate-600"
                      >
                        {file.file}
                      </span>
                    ))}
                  </div>
                ) : null}
                <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-all rounded-md border border-border/60 bg-muted/40 p-3 text-xs leading-5 text-foreground">
                  {currentDiff.diff || "当前更改没有可展示的原始 diff。"}
                </pre>
              </section>
            ) : null}
          </>
        ) : (
          <div className="rounded-lg border border-dashed border-slate-200 px-6 py-12 text-center text-sm text-slate-500">
            暂无更改
          </div>
        )}
      </div>
    </div>
  );
}
