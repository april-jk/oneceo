import { useEffect, useMemo, useState } from "react";
import { Activity, Check, ChevronLeft, ChevronRight, Clock3, ExternalLink, FolderOpen, ListTodo, XCircle } from "lucide-react";
import AltusArtifactPreviewCard, { type AltusArtifactFile } from "@/components/AltusArtifactPreviewCard";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "@/components/ui/drawer";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { normalizeWorkspaceRelativePath } from "@/lib/workspace-path";

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
  activeView: "actions" | "files";
  onActiveViewChange: (view: "actions" | "files") => void;
  onOpenFile?: (path: string) => void;
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
  actions,
  files,
  currentIndex,
  latestIndex,
  onSelectIndex,
  onJumpToLatest,
  activeView,
  onActiveViewChange,
  onOpenFile,
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

  useEffect(() => {
    const preferredPath =
      selectedAction?.artifactPaths.find((path) =>
        normalizedFiles.some((file) => file.path === path),
      ) || normalizedFiles[0]?.path || "";
    setSelectedFilePath(preferredPath);
  }, [normalizedFiles, runId, selectedAction?.artifactPaths]);

  const selectedFile =
    normalizedFiles.find((file) => file.path === selectedFilePath) ||
    normalizedFiles[0] ||
    null;

  const canGoPrev = currentIndex > 0;
  const canGoNext = currentIndex < latestIndex;
  const completedCount = actions.filter((action) => action.status === "completed").length;

  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="bottom">
      <DrawerContent className="h-[90dvh] max-h-[90dvh] overflow-hidden flex flex-col">
        <div className="h-12 flex-shrink-0 px-3 flex items-center justify-between border-b border-border bg-background/95 backdrop-blur-sm">
          <div className="flex items-center min-w-0">
            <DrawerTitle className="text-base font-semibold truncate">
              {runTitle || "Altus Run Replay"}
            </DrawerTitle>
            <DrawerDescription className="sr-only">
              Altus 接管模式的 Actions 与 Files 回放查看器
            </DrawerDescription>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="relative flex items-center rounded-full bg-zinc-100 dark:bg-zinc-800/90 p-[2px]">
              <button
                type="button"
                onClick={() => onActiveViewChange("actions")}
                className={cn(
                  "relative z-10 flex h-[26px] w-16 items-center justify-center gap-1.5 rounded-full text-[11px] font-medium transition-colors",
                  activeView === "actions"
                    ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-100"
                    : "text-zinc-400 dark:text-zinc-500",
                )}
              >
                <Activity className="h-3 w-3" />
                <span>Actions</span>
              </button>
              <button
                type="button"
                onClick={() => onActiveViewChange("files")}
                className={cn(
                  "relative z-10 flex h-[26px] w-16 items-center justify-center gap-1.5 rounded-full text-[11px] font-medium transition-colors",
                  activeView === "files"
                    ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-100"
                    : "text-zinc-400 dark:text-zinc-500",
                )}
              >
                <FolderOpen className="h-3 w-3" />
                <span>Files</span>
              </button>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-2xl text-muted-foreground hover:text-foreground"
              onClick={() => onOpenChange(false)}
              title="关闭"
            >
              <ChevronRight className="h-4 w-4 rotate-90" />
            </Button>
          </div>
        </div>

        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {activeView === "actions" ? (
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
          ) : (
            <div className="flex h-full min-h-0 flex-col overflow-hidden">
              <div className="flex-shrink-0 border-b border-zinc-200 bg-zinc-50/80 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/80">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Files
                  </div>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    {normalizedFiles.length} files
                  </span>
                </div>
                {normalizedFiles.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {normalizedFiles.map((file) => {
                      const active = file.path === selectedFile?.path;
                      return (
                        <button
                          key={file.path}
                          type="button"
                          onClick={() => setSelectedFilePath(file.path)}
                          className={cn(
                            "inline-flex max-w-full items-center rounded-full border px-3 py-1 text-xs transition",
                            active
                              ? "border-foreground/15 bg-foreground text-background"
                              : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800",
                          )}
                        >
                          <span className="truncate">{file.displayName}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
              <div className="flex-1 min-h-0 overflow-auto px-4 py-4">
                {selectedFile ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                          {selectedFile.path}
                        </div>
                        {typeof selectedFile.lastSourceStepIndex === "number" ? (
                          <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                            来自动作 #{selectedFile.lastSourceStepIndex + 1}
                          </div>
                        ) : null}
                      </div>
                      {onOpenFile ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 rounded-2xl text-xs"
                          onClick={() => onOpenFile(selectedFile.path)}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          Open
                        </Button>
                      ) : null}
                    </div>
                    <AltusArtifactPreviewCard
                      sessionId={sessionId}
                      artifacts={[selectedFile]}
                      onOpenViewer={onOpenFile}
                    />
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-zinc-300 px-6 py-10 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                    当前 run 还没有可预览的文件。
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

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
      </DrawerContent>
    </Drawer>
  );
}
