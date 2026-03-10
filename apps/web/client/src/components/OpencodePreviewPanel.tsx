import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { Button } from "@/components/ui/button";
import {
  BarChart3,
  Database,
  ExternalLink,
  Globe,
  HardDrive,
  History,
  Loader2,
  RefreshCw,
  Rocket,
  ScrollText,
  Server,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import type { AgentMessage } from "@/hooks/useTaskCreationAgent";
import { buildPreviewItems, type PreviewDiffItem, type StructuredFileDiff } from "@/lib/opencode-preview";
import { Streamdown } from "streamdown";
import {
  deployTaskCreationSession,
  getTaskCreationDeploymentInfo,
  getTaskCreationDebugInfo,
  startTaskCreationDebug,
  redeployTaskCreationSession,
  rollbackTaskCreationSessionDeployment,
  getWorkspaceFile,
  getWorkspaceDirectory,
  type TaskCreationDeploymentInfo,
  type TaskCreationDebugInfo,
  type WorkspaceFile,
  type WorkspaceTree,
  type WorkspaceTreeItem,
} from "@/lib/task-creation-client";
import { cn } from "@/lib/utils";

interface OpencodePreviewPanelProps {
  messages: AgentMessage[];
  sessionId?: string | null;
  open: boolean;
  onToggle: () => void;
  activeTab?: PreviewTab;
  onTabChange?: (tab: PreviewTab) => void;
  selectedDiffId?: string | null;
  onSelectDiff?: (id: string | null) => void;
  runtimeReady?: boolean;
  runtimeStarting?: boolean;
  onEnsureRuntime?: () => Promise<void>;
  className?: string;
}

type PreviewTab = "files" | "changes" | "debug" | "deployment";
const DIRECTORY_PAGE_SIZE = 200;
type DirectoryLoadState = {
  initialized: boolean;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  nextCursor: number | null;
  returned: number;
  total: number;
};

export default function OpencodePreviewPanel({
  messages,
  sessionId,
  open,
  onToggle,
  activeTab,
  onTabChange,
  selectedDiffId: controlledSelectedDiffId,
  onSelectDiff,
  runtimeReady,
  runtimeStarting,
  onEnsureRuntime,
  className,
}: OpencodePreviewPanelProps) {
  const { diffItems } = useMemo(() => buildPreviewItems(messages), [messages]);

  const [internalTab, setInternalTab] = useState<PreviewTab>("files");
  const [internalSelectedDiffId, setInternalSelectedDiffId] = useState<string | null>(null);
  const [autoDiff, setAutoDiff] = useState(true);
  const [tree, setTree] = useState<WorkspaceTree | null>(null);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileData, setFileData] = useState<WorkspaceFile | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [dirState, setDirState] = useState<Record<string, DirectoryLoadState>>({});
  const [debugInfo, setDebugInfo] = useState<TaskCreationDebugInfo | null>(null);
  const [debugLoading, setDebugLoading] = useState(false);
  const [debugStarting, setDebugStarting] = useState(false);
  const [debugError, setDebugError] = useState<string | null>(null);
  const [deploymentInfo, setDeploymentInfo] = useState<TaskCreationDeploymentInfo | null>(null);
  const [deploymentLoading, setDeploymentLoading] = useState(false);
  const [deploymentError, setDeploymentError] = useState<string | null>(null);
  const [deploymentAction, setDeploymentAction] = useState<"deploy" | "redeploy" | "rollback" | null>(null);
  const [selectedDeploymentId, setSelectedDeploymentId] = useState<string | null>(null);
  const refreshTimerRef = useRef<number | null>(null);
  const debugBootRef = useRef(false);
  const debugRuntimeBootRef = useRef(false);
  const debugPollRef = useRef<number | null>(null);
  const deploymentPollRef = useRef<number | null>(null);
  const currentTab = activeTab ?? internalTab;

  const selectedDiffId = controlledSelectedDiffId ?? internalSelectedDiffId;
  const setSelectedDiffId = (id: string | null) => {
    if (onSelectDiff) {
      onSelectDiff(id);
    } else {
      setInternalSelectedDiffId(id);
    }
  };

  useEffect(() => {
    if (!open) return;
    if (controlledSelectedDiffId) return;
    if (autoDiff) {
      const latest = diffItems[diffItems.length - 1];
      setSelectedDiffId(latest ? latest.id : null);
    } else if (selectedDiffId && !diffItems.find((item) => item.id === selectedDiffId)) {
      const latest = diffItems[diffItems.length - 1];
      setSelectedDiffId(latest ? latest.id : null);
    }
  }, [autoDiff, diffItems, open, selectedDiffId, controlledSelectedDiffId]);

  const normalizeWorkspacePath = (value: string) =>
    value.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");

  const mergeWorkspaceItems = (
    currentItems: WorkspaceTreeItem[],
    incomingItems: WorkspaceTreeItem[],
    parentPath: string,
    append: boolean
  ): WorkspaceTreeItem[] => {
    const normalizedParent = normalizeWorkspacePath(parentPath);
    const parentPrefix = normalizedParent ? `${normalizedParent}/` : "";
    const byPath = new Map<string, WorkspaceTreeItem>();

    currentItems.forEach((item) => {
      const normalized = normalizeWorkspacePath(item.path);
      const belongsToParent = normalizedParent ? normalized.startsWith(parentPrefix) : true;
      if (!append && belongsToParent) return;
      byPath.set(normalized, { path: normalized, type: item.type });
    });

    incomingItems.forEach((item) => {
      const normalized = normalizeWorkspacePath(item.path);
      if (!normalized) return;
      byPath.set(normalized, { path: normalized, type: item.type });
    });

    return Array.from(byPath.values());
  };

  async function loadDirectory(
    dirPath: string,
    options?: { append?: boolean; refresh?: boolean; silent?: boolean }
  ) {
    if (!sessionId) {
      return null;
    }
    const normalizedDir = normalizeWorkspacePath(dirPath);
    const dirKey = normalizedDir;
    const append = options?.append === true;
    const refresh = options?.refresh === true;
    const currentDirState = dirState[dirKey];
    const cursor = append
      ? Math.max(0, Number(currentDirState?.nextCursor ?? 0))
      : 0;

    setDirState((prev) => ({
      ...prev,
      [dirKey]: {
        initialized: prev[dirKey]?.initialized ?? false,
        loading: true,
        error: null,
        hasMore: prev[dirKey]?.hasMore ?? false,
        nextCursor: prev[dirKey]?.nextCursor ?? null,
        returned: prev[dirKey]?.returned ?? 0,
        total: prev[dirKey]?.total ?? 0,
      },
    }));

    try {
      const page = await getWorkspaceDirectory(sessionId, {
        path: normalizedDir,
        cursor,
        limit: DIRECTORY_PAGE_SIZE,
        refresh,
      });

      setTree((prev) => {
        const baseItems = prev?.items || [];
        const mergedItems = mergeWorkspaceItems(baseItems, page.items || [], normalizedDir, append);
        return {
          root: page.root || prev?.root || "",
          items: mergedItems,
        };
      });

      setDirState((prev) => ({
        ...prev,
        [dirKey]: {
          initialized: true,
          loading: false,
          error: null,
          hasMore: Boolean(page.hasMore),
          nextCursor:
            typeof page.nextCursor === "number" && Number.isFinite(page.nextCursor)
              ? page.nextCursor
              : null,
          returned: Number(page.returned || 0),
          total: Number(page.total || 0),
        },
      }));

      return page;
    } catch (error) {
      const message = error instanceof Error ? error.message : "获取目录失败";
      if (!options?.silent && normalizedDir === "") {
        if (message.includes("409")) {
          setTreeError(null);
        } else {
          setTreeError(message);
        }
      }
      setDirState((prev) => ({
        ...prev,
        [dirKey]: {
          initialized: prev[dirKey]?.initialized ?? false,
          loading: false,
          error: message,
          hasMore: prev[dirKey]?.hasMore ?? false,
          nextCursor: prev[dirKey]?.nextCursor ?? null,
          returned: prev[dirKey]?.returned ?? 0,
          total: prev[dirKey]?.total ?? 0,
        },
      }));
      return null;
    }
  }

  async function handleFileSelect(path: string) {
    if (!sessionId) return;
    if (runtimeReady === false) {
      if (onEnsureRuntime) {
        await onEnsureRuntime();
      } else {
        return;
      }
    }
    setSelectedPath(path);
    const parts = path.split("/").filter(Boolean);
    const parentDirs: string[] = [];
    let parentPath = "";
    parts.slice(0, -1).forEach((part) => {
      parentPath = parentPath ? `${parentPath}/${part}` : part;
      parentDirs.push(parentPath);
    });
    if (parts.length > 0) {
      setExpandedPaths((prev) => {
        const next = new Set(prev);
        parentDirs.forEach((dir) => next.add(dir));
        return next;
      });
    }
    for (const dirPath of parentDirs) {
      const normalized = normalizeWorkspacePath(dirPath);
      const state = dirState[normalized];
      if (!state || !state.initialized || state.error) {
        await loadDirectory(normalized, { append: false, refresh: false, silent: true });
      }
    }
    setFileLoading(true);
    setFileError(null);
    try {
      const file = await getWorkspaceFile(sessionId, path);
      setFileData(file);
      if (file.binaryTooLarge) {
        setFileError("二进制文件过大，暂不支持预览");
      } else if (file.truncated) {
        setFileError("内容较大，已截断显示");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "读取文件失败";
      if (message.includes("409")) {
        setFileError(null);
      } else {
        setFileError(message);
      }
      setFileData(null);
    } finally {
      setFileLoading(false);
    }
  }

  const refreshTree = async (mode: "auto" | "manual" = "manual") => {
    if (!sessionId) {
      setTreeError("缺少会话信息");
      setTree(null);
      setDirState({});
      return;
    }
    if (runtimeReady === false) {
      if (mode === "manual" && onEnsureRuntime) {
        await onEnsureRuntime();
      } else {
        setTree(null);
        setDirState({});
        setTreeError(null);
        setTreeLoading(false);
        return;
      }
    }
    setTreeLoading(true);
    setTreeError(null);
    try {
      const rootPage = await loadDirectory("", {
        append: false,
        refresh: mode === "manual",
        silent: false,
      });
      if (!rootPage) {
        return;
      }
      const expandedDirs = Array.from(expandedPaths)
        .map((path) => normalizeWorkspacePath(path))
        .filter(Boolean)
        .sort((a, b) => a.split("/").length - b.split("/").length);
      for (const dirPath of expandedDirs) {
        await loadDirectory(dirPath, {
          append: false,
          refresh: false,
          silent: true,
        });
      }
      if (!selectedPath) {
        const firstFile = rootPage.items.find((item) => item.type === "file");
        if (firstFile) {
          void handleFileSelect(firstFile.path);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "获取文件树失败";
      if (message.includes("409")) {
        setTreeError(null);
      } else {
        setTreeError(message);
      }
    } finally {
      setTreeLoading(false);
    }
  };

  const handleTogglePath = (path: string) => {
    const normalized = normalizeWorkspacePath(path);
    const isOpen = expandedPaths.has(normalized);
    if (isOpen) {
      setExpandedPaths((prev) => {
        const next = new Set(prev);
        next.delete(normalized);
        return next;
      });
      return;
    }
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      next.add(normalized);
      return next;
    });
    const state = dirState[normalized];
    if (!state || !state.initialized || state.error) {
      void loadDirectory(normalized, { append: false, refresh: false, silent: true });
    }
  };

  const handleLoadMoreDirectory = (path: string) => {
    const normalized = normalizeWorkspacePath(path);
    const state = dirState[normalized];
    if (!state || state.loading || !state.hasMore || state.nextCursor === null) {
      return;
    }
    void loadDirectory(normalized, { append: true, refresh: false, silent: true });
  };

  useEffect(() => {
    if (!open) return;
    void refreshTree("auto");
  }, [open, sessionId, runtimeReady]);

  useEffect(() => {
    setTree(null);
    setTreeError(null);
    setTreeLoading(false);
    setDirState({});
    setExpandedPaths(new Set());
    setSelectedPath(null);
    setFileData(null);
    setFileError(null);
    setFileLoading(false);
  }, [sessionId]);

  useEffect(() => {
    debugBootRef.current = false;
    debugRuntimeBootRef.current = false;
    if (debugPollRef.current) {
      window.clearTimeout(debugPollRef.current);
      debugPollRef.current = null;
    }
    setDebugInfo(null);
    setDebugError(null);
    setDebugLoading(false);
    setDebugStarting(false);
  }, [sessionId]);

  useEffect(() => {
    if (deploymentPollRef.current) {
      window.clearTimeout(deploymentPollRef.current);
      deploymentPollRef.current = null;
    }
    setDeploymentInfo(null);
    setDeploymentError(null);
    setDeploymentLoading(false);
    setDeploymentAction(null);
    setSelectedDeploymentId(null);
  }, [sessionId]);

  useEffect(() => {
    if (runtimeReady === false) {
      debugBootRef.current = false;
      debugRuntimeBootRef.current = false;
    }
  }, [runtimeReady]);

  useEffect(() => {
    if (!open) return;
    if (currentTab !== "debug") return;
    if (!sessionId) {
      setDebugInfo(null);
      setDebugError("缺少会话信息");
      return;
    }
    if (runtimeReady === false) {
      setDebugInfo(null);
      setDebugError(null);
      if (onEnsureRuntime && !runtimeStarting && !debugRuntimeBootRef.current) {
        debugRuntimeBootRef.current = true;
        setDebugStarting(true);
        onEnsureRuntime()
          .catch(() => undefined)
          .finally(() => {
            setDebugStarting(false);
          });
      }
      return;
    }
    let cancelled = false;
    const loadDebug = async () => {
      setDebugLoading(true);
      setDebugError(null);
      try {
        let info = await getTaskCreationDebugInfo(sessionId);
        if ((!info?.ready || !info.url) && !debugBootRef.current) {
          debugBootRef.current = true;
          setDebugStarting(true);
          try {
            await startTaskCreationDebug(sessionId);
          } finally {
            setDebugStarting(false);
          }
          info = await getTaskCreationDebugInfo(sessionId);
        }
        if (!cancelled) {
          setDebugInfo(info);
          if (!info?.ready && info?.status === "starting") {
            if (debugPollRef.current) {
              window.clearTimeout(debugPollRef.current);
            }
            debugPollRef.current = window.setTimeout(() => {
              if (!cancelled) {
                void loadDebug();
              }
            }, 2000);
          }
        }
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "加载调试信息失败";
        setDebugError(message);
        setDebugInfo(null);
        if (message.toLowerCase().includes("failed to fetch") || message.toLowerCase().includes("network")) {
          if (debugPollRef.current) {
            window.clearTimeout(debugPollRef.current);
          }
          debugPollRef.current = window.setTimeout(() => {
            if (!cancelled) {
              void loadDebug();
            }
          }, 3000);
        }
      } finally {
        if (cancelled) return;
        setDebugLoading(false);
      }
    };
    void loadDebug();
    return () => {
      cancelled = true;
    };
  }, [open, currentTab, sessionId, runtimeReady]);

  useEffect(() => {
    if (!open) return;
    if (currentTab !== "deployment") return;
    if (!sessionId) {
      setDeploymentInfo(null);
      setDeploymentError("缺少会话信息");
      return;
    }

    let cancelled = false;

    const schedulePoll = (enabled: boolean) => {
      if (deploymentPollRef.current) {
        window.clearTimeout(deploymentPollRef.current);
        deploymentPollRef.current = null;
      }
      if (!enabled) return;
      deploymentPollRef.current = window.setTimeout(() => {
        if (!cancelled) {
          void loadDeployment(true);
        }
      }, 4000);
    };

    const loadDeployment = async (silent: boolean = false, deploymentId?: string) => {
      if (!silent) {
        setDeploymentLoading(true);
      }
      setDeploymentError(null);
      try {
        const info = await getTaskCreationDeploymentInfo(
          sessionId,
          deploymentId || selectedDeploymentId || undefined
        );
        if (cancelled) return;
        setDeploymentInfo(info);
        setSelectedDeploymentId(info?.deploymentId || null);
        schedulePoll(Boolean(info?.activeDeploymentPending));
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "加载部署信息失败";
        setDeploymentError(message);
        if (!silent) {
          setDeploymentInfo(null);
        }
        schedulePoll(false);
      } finally {
        if (!cancelled) {
          setDeploymentLoading(false);
        }
      }
    };

    void loadDeployment(false);
    return () => {
      cancelled = true;
      if (deploymentPollRef.current) {
        window.clearTimeout(deploymentPollRef.current);
        deploymentPollRef.current = null;
      }
    };
  }, [open, currentTab, sessionId]);

  useEffect(() => {
    if (!open || currentTab !== "deployment" || !sessionId) return;
    if (!deploymentInfo?.activeDeploymentPending) return;
    if (deploymentPollRef.current) {
      window.clearTimeout(deploymentPollRef.current);
    }
    deploymentPollRef.current = window.setTimeout(() => {
      void refreshDeployment(selectedDeploymentId || deploymentInfo.deploymentId || undefined);
    }, 4000);
    return () => {
      if (deploymentPollRef.current) {
        window.clearTimeout(deploymentPollRef.current);
        deploymentPollRef.current = null;
      }
    };
  }, [open, currentTab, sessionId, deploymentInfo?.activeDeploymentPending, deploymentInfo?.deploymentId, selectedDeploymentId]);

  useEffect(() => {
    if (!open) return;
    if (!sessionId) return;
    if (runtimeReady === false) return;
    const last = messages[messages.length - 1];
    if (!shouldRefreshFromMessage(last)) return;
    if (refreshTimerRef.current) {
      window.clearTimeout(refreshTimerRef.current);
    }
    refreshTimerRef.current = window.setTimeout(() => {
      void refreshTree("auto");
    }, 800);
    return () => {
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [messages, open, sessionId]);

  if (!open) return null;

  const currentDiff = diffItems.find((item) => item.id === selectedDiffId) || null;
  const treeCount = tree?.items.length || 0;

  const refreshDeployment = async (deploymentId?: string) => {
    if (!sessionId) {
      setDeploymentError("缺少会话信息");
      return;
    }
    setDeploymentLoading(true);
    setDeploymentError(null);
    try {
      const info = await getTaskCreationDeploymentInfo(
        sessionId,
        deploymentId || selectedDeploymentId || undefined
      );
      setDeploymentInfo(info);
      setSelectedDeploymentId(info?.deploymentId || deploymentId || null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "加载部署信息失败";
      setDeploymentError(message);
    } finally {
      setDeploymentLoading(false);
    }
  };

  const runDeploymentAction = async (action: "deploy" | "redeploy" | "rollback") => {
    if (!sessionId) {
      setDeploymentError("缺少会话信息");
      return;
    }
    setDeploymentAction(action);
    setDeploymentError(null);
    try {
      const result =
        action === "deploy"
          ? await deployTaskCreationSession(sessionId)
          : action === "redeploy"
            ? await redeployTaskCreationSession(sessionId, selectedDeploymentId || "")
            : await rollbackTaskCreationSessionDeployment(sessionId, selectedDeploymentId || "");
      setDeploymentInfo(result);
      setSelectedDeploymentId(result?.deploymentId || selectedDeploymentId || null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "部署操作失败";
      setDeploymentError(message);
    } finally {
      setDeploymentAction(null);
    }
  };

  return (
    <aside
      className={cn(
        "w-full h-full shrink-0 border border-border/70 rounded-2xl bg-gradient-to-b from-white via-white to-slate-50 shadow-sm flex flex-col min-h-0",
        className
      )}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          内容预览
          <span className="text-xs text-muted-foreground">{treeCount + diffItems.length}</span>
        </div>
        <Button variant="ghost" size="sm" onClick={onToggle} className="h-7 rounded-full">
          收起
        </Button>
      </div>

      <div className="flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground border-b border-border">
        <button
          type="button"
          onClick={() => {
            onTabChange?.("files");
            if (!onTabChange) setInternalTab("files");
          }}
          className={currentTab === "files" ? "text-foreground font-semibold" : ""}
        >
          文件
        </button>
        <span>/</span>
        <button
          type="button"
          onClick={() => {
            onTabChange?.("changes");
            if (!onTabChange) setInternalTab("changes");
          }}
          className={currentTab === "changes" ? "text-foreground font-semibold" : ""}
        >
          更改
        </button>
        <span>/</span>
        <button
          type="button"
          onClick={() => {
            onTabChange?.("debug");
            if (!onTabChange) setInternalTab("debug");
          }}
          className={currentTab === "debug" ? "text-foreground font-semibold" : ""}
        >
          调试
        </button>
        <span>/</span>
        <button
          type="button"
          onClick={() => {
            onTabChange?.("deployment");
            if (!onTabChange) setInternalTab("deployment");
          }}
          className={currentTab === "deployment" ? "text-foreground font-semibold" : ""}
        >
          部署
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden relative">
        <div
          className={cn(
            "absolute inset-0 h-full w-full transition-opacity",
            currentTab === "files" ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
          )}
          aria-hidden={currentTab !== "files"}
        >
          <FilePreview
            tree={tree}
            loading={treeLoading}
            error={treeError}
            selectedPath={selectedPath}
            file={fileData}
            contentError={fileError}
            contentLoading={fileLoading}
            expandedPaths={expandedPaths}
            dirState={dirState}
            onTogglePath={handleTogglePath}
            onLoadMoreDir={handleLoadMoreDirectory}
            onRefresh={() => void refreshTree("manual")}
            onSelectFile={handleFileSelect}
            runtimeReady={runtimeReady !== false}
            runtimeStarting={runtimeStarting === true}
          />
        </div>
        <div
          className={cn(
            "absolute inset-0 h-full w-full transition-opacity",
            currentTab === "changes" ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
          )}
          aria-hidden={currentTab !== "changes"}
        >
          <DiffPreview
            items={diffItems}
            current={currentDiff}
            onSelect={(id) => {
              setSelectedDiffId(id);
              setAutoDiff(false);
            }}
          />
        </div>
        <div
          className={cn(
            "absolute inset-0 h-full w-full transition-opacity",
            currentTab === "deployment" ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
          )}
          aria-hidden={currentTab !== "deployment"}
        >
          <DeploymentPreview
            info={deploymentInfo}
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
          />
        </div>
        <div
          className={cn(
            "absolute inset-0 h-full w-full transition-opacity",
            currentTab === "debug" ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
          )}
          aria-hidden={currentTab !== "debug"}
        >
          <DebugPreview
            info={debugInfo}
            loading={debugLoading}
            error={debugError}
            runtimeReady={runtimeReady !== false}
            starting={debugStarting}
            onStart={async () => {
              if (!sessionId) return;
              if (runtimeReady === false) {
                if (onEnsureRuntime) {
                  await onEnsureRuntime();
                } else {
                  return;
                }
              }
              setDebugStarting(true);
              setDebugError(null);
              try {
                await startTaskCreationDebug(sessionId);
                const info = await getTaskCreationDebugInfo(sessionId);
                setDebugInfo(info);
              } catch (error) {
                const message = error instanceof Error ? error.message : "启动调试失败";
                setDebugError(message);
              } finally {
                setDebugStarting(false);
              }
            }}
          />
        </div>
      </div>
    </aside>
  );
}

type TreeNode = {
  name: string;
  path: string;
  type: "file" | "dir";
  children: TreeNode[];
};

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  return {};
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function formatPreviewTimestamp(value?: string | null) {
  if (!value) return "";
  let date: Date | null = null;
  const raw = value.trim();
  if (!raw) return "";
  const asNumber = Number(raw);
  if (Number.isFinite(asNumber)) {
    date = new Date(asNumber);
  } else {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      date = parsed;
    }
  }
  if (!date || Number.isNaN(date.getTime())) return "";
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function shouldRefreshFromMessage(message: AgentMessage | undefined): boolean {
  if (!message || message.type !== "opencode_event") return false;
  const metadata = toRecord(message.metadata);
  const event = toRecord(metadata.event);
  const rawPayload = toRecord(metadata.rawPayload);
  const rawEvent = toRecord(rawPayload.event);
  const eventType = (asText(metadata.eventType) || asText(event.type) || asText(rawEvent.type)).toLowerCase();
  if (eventType.startsWith("file.") || eventType === "session.diff") return true;
  const properties = toRecord(event.properties);
  const part = toRecord(properties.part);
  const tool = (asText(part.tool) || asText(part.name) || asText(properties.tool)).toLowerCase();
  return tool === "write" || tool === "edit" || tool === "apply_patch";
}

function buildTree(items: WorkspaceTreeItem[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", type: "dir", children: [] };
  const lookup = new Map<string, TreeNode>();
  lookup.set("", root);

  items.forEach((item) => {
    const normalized = item.path.replace(/\\/g, "/").replace(/^\/+/, "");
    const parts = normalized.split("/").filter(Boolean);
    let currentPath = "";
    let currentNode = root;
    parts.forEach((part, index) => {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      let child = lookup.get(currentPath);
      if (!child) {
        child = {
          name: part,
          path: currentPath,
          type: index === parts.length - 1 ? item.type : "dir",
          children: [],
        };
        currentNode.children.push(child);
        lookup.set(currentPath, child);
      }
      currentNode = child;
    });
  });

  const sortNodes = (node: TreeNode) => {
    node.children.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "dir" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
    node.children.forEach(sortNodes);
  };
  sortNodes(root);

  return root.children;
}

function FilePreview({
  tree,
  loading,
  error,
  selectedPath,
  file,
  contentError,
  contentLoading,
  expandedPaths,
  dirState,
  onTogglePath,
  onLoadMoreDir,
  onRefresh,
  onSelectFile,
  runtimeReady,
  runtimeStarting,
}: {
  tree: WorkspaceTree | null;
  loading: boolean;
  error: string | null;
  selectedPath: string | null;
  file: WorkspaceFile | null;
  contentError: string | null;
  contentLoading: boolean;
  expandedPaths: Set<string>;
  dirState: Record<string, DirectoryLoadState>;
  onTogglePath: (path: string) => void;
  onLoadMoreDir: (path: string) => void;
  onRefresh: () => void;
  onSelectFile: (path: string) => void;
  runtimeReady: boolean;
  runtimeStarting: boolean;
}) {
  if (!runtimeReady) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-xs text-muted-foreground gap-2">
        <span>文件预览尚未加载</span>
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={runtimeStarting}>
          {runtimeStarting ? "加载中..." : "加载文件"}
        </Button>
      </div>
    );
  }
  if (loading) {
    return <EmptyState text="正在加载文件树..." />;
  }
  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-xs text-muted-foreground gap-2">
        <span>{error}</span>
        <Button variant="outline" size="sm" onClick={onRefresh}>
          重试
        </Button>
      </div>
    );
  }
  if (!tree || tree.items.length === 0) {
    return <EmptyState text="暂无文件" />;
  }

  const nodes = buildTree(tree.items);
  const lineCount = file?.content ? file.content.split("\n").length : 0;
  const previewType = file?.previewType || "text";
  const mimeType = file?.mimeType || "application/octet-stream";
  const isBinary = Boolean(file?.isBinary);
  const rootDirState = dirState[""];
  const binaryDataUrl =
    file && file.encoding === "base64" && file.content
      ? `data:${mimeType};base64,${file.content}`
      : null;

  return (
    <div className="flex h-full flex-col md:flex-row">
      <div className="md:basis-[30%] md:max-w-[30%] border-b md:border-b-0 md:border-r border-border overflow-auto px-3 py-3 bg-slate-50/60">
        <div className="mb-2 space-y-1">
          <div className="text-[11px] text-muted-foreground break-all font-mono">
            根目录: {tree.root}
          </div>
          {rootDirState?.hasMore ? (
            <button
              type="button"
              className="text-[11px] text-blue-600 hover:text-blue-700 disabled:text-slate-400"
              onClick={() => onLoadMoreDir("")}
              disabled={Boolean(rootDirState.loading)}
            >
              {rootDirState.loading ? "加载中..." : "加载更多根目录项..."}
            </button>
          ) : null}
        </div>
        <TreeList
          nodes={nodes}
          selectedPath={selectedPath}
          onSelectFile={onSelectFile}
          expandedPaths={expandedPaths}
          dirState={dirState}
          onTogglePath={onTogglePath}
          onLoadMoreDir={onLoadMoreDir}
        />
      </div>
      <div className="min-h-0 md:basis-[70%] md:max-w-[70%] overflow-hidden px-4 py-3">
        {selectedPath ? (
          <div className="h-full min-h-0 flex flex-col gap-2">
            <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-slate-200 bg-white text-xs text-slate-700 font-mono overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 bg-slate-50 text-[11px] text-slate-500">
                <span className="truncate">文件: {selectedPath}</span>
                <span>
                  {isBinary
                    ? `${mimeType}${typeof file?.size === "number" ? ` · ${Math.ceil(file.size / 1024)} KB` : ""}`
                    : `${lineCount} 行`}
                </span>
              </div>
              {contentLoading ? (
                <div className="px-3 py-3 text-xs text-muted-foreground">加载中...</div>
              ) : previewType === "markdown" && !isBinary ? (
                <div className="min-h-0 flex-1 overflow-auto px-3 py-3 text-sm leading-7 text-foreground [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_strong]:font-semibold [&_pre]:my-3 [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-slate-200 [&_pre]:bg-slate-50 [&_pre]:p-3 [&_code]:font-mono">
                  <Streamdown>{file?.content || ""}</Streamdown>
                </div>
              ) : previewType === "image" && binaryDataUrl ? (
                <div className="min-h-0 flex-1 overflow-auto p-3">
                  <img src={binaryDataUrl} alt={selectedPath} className="max-h-full w-auto max-w-full rounded-md border border-slate-200 bg-slate-50" />
                </div>
              ) : previewType === "video" && binaryDataUrl ? (
                <div className="min-h-0 flex-1 overflow-auto p-3">
                  <video src={binaryDataUrl} controls className="max-h-full w-full rounded-md border border-slate-200 bg-black" />
                </div>
              ) : previewType === "audio" && binaryDataUrl ? (
                <div className="min-h-0 flex-1 overflow-auto p-3">
                  <audio src={binaryDataUrl} controls className="w-full" />
                </div>
              ) : previewType === "pdf" && binaryDataUrl ? (
                <div className="min-h-0 flex-1 overflow-auto p-3">
                  <iframe title={`preview-${selectedPath}`} src={binaryDataUrl} className="h-full min-h-[360px] w-full rounded-md border border-slate-200 bg-white" />
                </div>
              ) : isBinary ? (
                <div className="px-3 py-3 text-xs text-muted-foreground">
                  {file?.binaryTooLarge
                    ? "该二进制文件过大，无法在预览区直接加载。"
                    : "该二进制文件类型暂不支持内嵌预览。"}
                </div>
              ) : (
                <div className="min-h-0 flex-1 overflow-auto">
                  <pre className="px-3 py-3 text-xs leading-5 whitespace-pre text-slate-700">
                    <code>{file?.content || ""}</code>
                  </pre>
                </div>
              )}
            </div>
            {contentError ? (
              <div className="text-[11px] text-amber-600">{contentError}</div>
            ) : null}
          </div>
        ) : (
          <EmptyState text="请选择文件预览" />
        )}
      </div>
    </div>
  );
}

function TreeList({
  nodes,
  selectedPath,
  onSelectFile,
  expandedPaths,
  dirState,
  onTogglePath,
  onLoadMoreDir,
  depth = 0,
}: {
  nodes: TreeNode[];
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  expandedPaths: Set<string>;
  dirState: Record<string, DirectoryLoadState>;
  onTogglePath: (path: string) => void;
  onLoadMoreDir: (path: string) => void;
  depth?: number;
}) {
  return (
    <div className="space-y-1">
      {nodes.map((node) => {
        const isDir = node.type === "dir";
        const isOpen = expandedPaths.has(node.path);
        const indent = depth * 12;
        const state = dirState[node.path];
        return (
          <div key={node.path}>
            <button
              type="button"
              onClick={() => {
                if (isDir) {
                  onTogglePath(node.path);
                } else {
                  onSelectFile(node.path);
                }
              }}
              className={`w-full flex items-center gap-2 rounded-md px-2 py-1 text-left text-xs font-mono transition-colors border ${
                selectedPath === node.path
                  ? "bg-white border-slate-200 text-foreground shadow-sm"
                  : "text-muted-foreground border-transparent hover:bg-white/80 hover:border-slate-200"
              }`}
              style={{ paddingLeft: `${indent + 8}px` }}
            >
              <span className="w-3">{isDir ? (isOpen ? "▾" : "▸") : ""}</span>
              <span className="truncate">{node.name}</span>
              {isDir && state?.loading ? <span className="ml-1 text-[10px] text-slate-400">加载中</span> : null}
            </button>
            {isDir && isOpen ? (
              <div className="space-y-1">
                {node.children.length > 0 ? (
                  <TreeList
                    nodes={node.children}
                    selectedPath={selectedPath}
                    onSelectFile={onSelectFile}
                    expandedPaths={expandedPaths}
                    dirState={dirState}
                    onTogglePath={onTogglePath}
                    onLoadMoreDir={onLoadMoreDir}
                    depth={depth + 1}
                  />
                ) : null}
                {state?.error ? (
                  <div
                    className="px-2 py-1 text-[11px] text-amber-600"
                    style={{ paddingLeft: `${indent + 28}px` }}
                  >
                    {state.error}
                  </div>
                ) : null}
                {state?.hasMore ? (
                  <button
                    type="button"
                    onClick={() => onLoadMoreDir(node.path)}
                    disabled={Boolean(state.loading)}
                    className="px-2 py-1 text-[11px] text-blue-600 hover:text-blue-700 disabled:text-slate-400"
                    style={{ paddingLeft: `${indent + 28}px` }}
                  >
                    {state.loading ? "加载中..." : "加载更多..."}
                  </button>
                ) : null}
                {!state?.loading &&
                state?.initialized &&
                !state.hasMore &&
                !state.error &&
                node.children.length === 0 ? (
                  <div
                    className="px-2 py-1 text-[11px] text-slate-400"
                    style={{ paddingLeft: `${indent + 28}px` }}
                  >
                    空目录
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function DiffPreview({
  items,
  current,
  onSelect,
}: {
  items: PreviewDiffItem[];
  current: PreviewDiffItem | null;
  onSelect: (id: string) => void;
}) {
  if (items.length === 0) {
    return <EmptyState text="暂无更改" />;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        <span className="text-xs text-muted-foreground">最近更改</span>
        <select
          className="text-xs border border-border rounded-md bg-background px-2 py-1 flex-1"
          value={current?.id || items[items.length - 1]?.id || ""}
          onChange={(event) => onSelect(event.target.value)}
        >
          {items
            .slice()
            .reverse()
            .map((item, index, reversed) => {
              const timeLabel = formatPreviewTimestamp(item.createdAt);
              const suffix = timeLabel || `#${reversed.length - index}`;
              const diffStats = item.files?.[0];
              const additions = diffStats?.additions;
              const deletions = diffStats?.deletions;
              const statsLabel =
                typeof additions === "number" || typeof deletions === "number"
                  ? ` +${additions ?? 0} -${deletions ?? 0}`
                  : "";
              const label = item.title
                ? `${item.title}${statsLabel} · ${suffix}`
                : `Diff${statsLabel} · ${suffix}`;
              return (
                <option key={item.id} value={item.id}>
                  {label}
                </option>
              );
            })}
        </select>
      </div>
      <div className="flex-1 min-h-0 overflow-auto px-4 py-3">
        {current ? <DiffBlock diff={current.diff} files={current.files} /> : <EmptyState text="暂无更改" />}
      </div>
    </div>
  );
}

function DeploymentPreview({
  info,
  loading,
  error,
  actionLoading,
  selectedDeploymentId,
  onRefresh,
  onSelectDeployment,
  onDeploy,
  onRedeploy,
  onRollback,
}: {
  info: TaskCreationDeploymentInfo | null;
  loading: boolean;
  error: string | null;
  actionLoading: "deploy" | "redeploy" | "rollback" | null;
  selectedDeploymentId: string | null;
  onRefresh: (deploymentId?: string) => void;
  onSelectDeployment: (deploymentId: string) => void;
  onDeploy: () => void;
  onRedeploy: () => void;
  onRollback: () => void;
}) {
  const [section, setSection] = useState<DeploymentWorkbenchSection>("overview");
  const [settingsSection, setSettingsSection] =
    useState<DeploymentSettingsSection>("general");
  const pendingStatuses = new Set([
    "BUILDING",
    "DEPLOYING",
    "INITIALIZING",
    "PENDING",
    "QUEUED",
    "RESTARTING",
    "REMOVING",
  ]);
  const currentDeploymentId = selectedDeploymentId || info?.deploymentId || "";
  const currentDeployment =
    info?.deployments.find((item) => item.id === currentDeploymentId) || info?.deployments[0] || null;
  const status = currentDeployment?.status || info?.latestStatus || "";
  const hasSuccessfulDeployment =
    info?.deployments.some((item) => item.status === "SUCCESS") || info?.latestStatus === "SUCCESS";
  const isPending = Boolean(info?.activeDeploymentPending || pendingStatuses.has(status.toUpperCase()));
  const statusMeta = !info?.configured
    ? {
        label: "未就绪",
        description:
          info?.missing.length ? `还需准备 ${info.missing.length} 项部署资源后才能发布。` : "正在准备部署资源。",
        badgeClass: "border-slate-200 bg-slate-100 text-slate-700",
        dotClass: "bg-slate-400",
        panelClass: "border-slate-200 bg-slate-50/80",
      }
    : status === "SUCCESS"
      ? {
          label: "已发布",
          description: "当前网站已有线上版本，可直接访问与验证。",
          badgeClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
          dotClass: "bg-emerald-500",
          panelClass: "border-emerald-200 bg-emerald-50/70",
        }
      : status === "FAILED" || status === "CRASHED"
        ? {
            label: "发布失败",
            description: "最近一次发布未完成，建议查看日志后重新发布。",
            badgeClass: "border-rose-200 bg-rose-50 text-rose-700",
            dotClass: "bg-rose-500",
            panelClass: "border-rose-200 bg-rose-50/70",
          }
        : isPending
          ? {
              label: "发布中",
              description: "平台正在同步代码并等待发布结果。",
              badgeClass: "border-amber-200 bg-amber-50 text-amber-700",
              dotClass: "bg-amber-500",
              panelClass: "border-amber-200 bg-amber-50/70",
            }
          : {
              label: hasSuccessfulDeployment ? "等待更新" : "未发布",
              description: hasSuccessfulDeployment
                ? "可以继续发布新版本，线上将保留最近的成功版本。"
                : "项目已准备好，可以开始首次发布。",
              badgeClass: "border-slate-200 bg-slate-100 text-slate-700",
              dotClass: "bg-slate-400",
              panelClass: "border-slate-200 bg-slate-50/80",
            };
  const staticUrl = currentDeployment?.staticUrl || info?.latestStaticUrl || "";
  const runtimeUrl = currentDeployment?.url || info?.latestUrl || "";
  const primaryAccessUrl = staticUrl || runtimeUrl || info?.domains[0] || "";
  const accessEntries = Array.from(
    new Map(
      [
        primaryAccessUrl ? ["网站地址", primaryAccessUrl] : null,
        runtimeUrl && runtimeUrl !== primaryAccessUrl ? ["运行地址", runtimeUrl] : null,
        ...((info?.domains || [])
          .filter((domain) => domain && domain !== primaryAccessUrl && domain !== runtimeUrl)
          .map((domain, index) => [`绑定域名 ${index + 1}`, domain] as const)),
      ]
        .filter(Boolean)
        .map((entry) => entry as readonly [string, string])
    )
  );
  const primaryActionText =
    actionLoading === "deploy" ? "发布中..." : hasSuccessfulDeployment ? "发布新版本" : "立即发布";
  const successCount = info?.deployments.filter((item) => item.status === "SUCCESS").length ?? 0;
  const failedCount =
    info?.deployments.filter((item) => item.status === "FAILED" || item.status === "CRASHED").length ?? 0;
  const totalDeployments = info?.deployments.length ?? 0;
  const successRate = totalDeployments ? `${Math.round((successCount / totalDeployments) * 100)}%` : "暂无数据";
  const latestTimestamp = formatPreviewTimestamp(currentDeployment?.createdAt) || currentDeployment?.createdAt || "尚无记录";
  const logsText = info?.logs.length
    ? info.logs
        .map((entry) =>
          `${entry.timestamp ? `[${formatPreviewTimestamp(entry.timestamp) || entry.timestamp}] ` : ""}${
            entry.severity ? `${entry.severity} ` : ""
          }${entry.message}`
        )
        .join("\n")
    : "";

  if (loading && !info) {
    return <EmptyState text="正在加载部署信息..." />;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">部署</span>
          <span className={cn("rounded-full border px-2 py-0.5 text-[11px]", statusMeta.badgeClass)}>
            {statusMeta.label}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-muted-foreground"
          onClick={() => onRefresh(currentDeploymentId || undefined)}
        >
          <RefreshCw className="size-3.5" />
          刷新状态
        </Button>
      </div>
      <div className="border-b border-border px-4 py-2">
        <div className="flex gap-2 overflow-x-auto pb-1">
          <DeploymentMenuButton
            active={section === "overview"}
            icon={Rocket}
            label="发布"
            onClick={() => setSection("overview")}
          />
          <DeploymentMenuButton
            active={section === "dashboard"}
            icon={BarChart3}
            label="仪表盘"
            onClick={() => setSection("dashboard")}
          />
          <DeploymentMenuButton
            active={section === "database"}
            icon={Database}
            label="数据库"
            onClick={() => setSection("database")}
          />
          <DeploymentMenuButton
            active={section === "storage"}
            icon={HardDrive}
            label="存储桶"
            onClick={() => setSection("storage")}
          />
          <DeploymentMenuButton
            active={section === "settings"}
            icon={Settings2}
            label="设置"
            onClick={() => setSection("settings")}
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto px-4 py-4 space-y-4">
        {error ? <div className="text-xs text-rose-600">{error}</div> : null}
        {info?.message ? <div className="text-xs text-muted-foreground">{info.message}</div> : null}

        {section === "overview" ? (
          <DeploymentOverviewSection
            info={info}
            statusMeta={statusMeta}
            currentDeployment={currentDeployment}
            currentDeploymentId={currentDeploymentId}
            accessEntries={accessEntries}
            primaryAccessUrl={primaryAccessUrl}
            runtimeUrl={runtimeUrl}
            staticUrl={staticUrl}
            actionLoading={actionLoading}
            loading={loading}
            primaryActionText={primaryActionText}
            logsText={logsText}
            onDeploy={onDeploy}
            onRedeploy={onRedeploy}
            onRollback={onRollback}
            onRefresh={onRefresh}
            onSelectDeployment={onSelectDeployment}
          />
        ) : null}

        {section === "dashboard" ? (
          <DeploymentDashboardSection
            info={info}
            statusMeta={statusMeta}
            successCount={successCount}
            failedCount={failedCount}
            successRate={successRate}
            currentDeployment={currentDeployment}
            latestTimestamp={latestTimestamp}
            accessEntries={accessEntries}
          />
        ) : null}

        {section === "database" ? (
          <DeploymentDatabaseSection info={info} statusMeta={statusMeta} />
        ) : null}

        {section === "storage" ? (
          <DeploymentStorageSection info={info} statusMeta={statusMeta} />
        ) : null}

        {section === "settings" ? (
          <DeploymentSettingsSectionPanel
            info={info}
            statusMeta={statusMeta}
            currentDeployment={currentDeployment}
            primaryAccessUrl={primaryAccessUrl}
            accessEntries={accessEntries}
            settingsSection={settingsSection}
            onSettingsSectionChange={setSettingsSection}
          />
        ) : null}
      </div>
    </div>
  );
}

type DeploymentWorkbenchSection =
  | "overview"
  | "dashboard"
  | "database"
  | "storage"
  | "settings";

type DeploymentSettingsSection =
  | "general"
  | "domain"
  | "notifications"
  | "payment"
  | "seo"
  | "keys"
  | "github";

type DeploymentStatusMeta = {
  label: string;
  description: string;
  badgeClass: string;
  dotClass: string;
  panelClass: string;
};

function DeploymentOverviewSection({
  info,
  statusMeta,
  currentDeployment,
  currentDeploymentId,
  accessEntries,
  primaryAccessUrl,
  runtimeUrl,
  staticUrl,
  actionLoading,
  loading,
  primaryActionText,
  logsText,
  onDeploy,
  onRedeploy,
  onRollback,
  onRefresh,
  onSelectDeployment,
}: {
  info: TaskCreationDeploymentInfo | null;
  statusMeta: DeploymentStatusMeta;
  currentDeployment: TaskCreationDeploymentInfo["deployments"][number] | null;
  currentDeploymentId: string;
  accessEntries: Array<[string, string] | readonly [string, string]>;
  primaryAccessUrl: string;
  runtimeUrl: string;
  staticUrl: string;
  actionLoading: "deploy" | "redeploy" | "rollback" | null;
  loading: boolean;
  primaryActionText: string;
  logsText: string;
  onDeploy: () => void;
  onRedeploy: () => void;
  onRollback: () => void;
  onRefresh: (deploymentId?: string) => void;
  onSelectDeployment: (deploymentId: string) => void;
}) {
  return (
    <>
      <section className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-white to-slate-50 p-4 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/90 px-3 py-1 text-[11px] font-medium text-slate-600">
              <Rocket className="size-3.5 text-slate-500" />
              发布与访问
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className={cn("size-2 rounded-full", statusMeta.dotClass)} />
                <h3 className="text-lg font-semibold text-slate-900">{statusMeta.label}</h3>
              </div>
              <p className="max-w-2xl text-sm leading-6 text-slate-600">{statusMeta.description}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={onDeploy} disabled={!info?.canDeploy || Boolean(actionLoading)}>
              {actionLoading === "deploy" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Rocket className="size-4" />
              )}
              {primaryActionText}
            </Button>
            <Button
              variant="outline"
              onClick={onRedeploy}
              disabled={!currentDeploymentId || Boolean(actionLoading)}
            >
              {actionLoading === "redeploy" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <History className="size-4" />
              )}
              重新发布
            </Button>
            <Button
              variant="outline"
              onClick={onRollback}
              disabled={!currentDeploymentId || Boolean(actionLoading)}
            >
              {actionLoading === "rollback" ? <Loader2 className="size-4 animate-spin" /> : null}
              回滚版本
            </Button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <DeploymentMetricCard
            title="当前状态"
            value={statusMeta.label}
            subtitle={
              currentDeployment?.createdAt
                ? `最近变更 ${formatPreviewTimestamp(currentDeployment.createdAt) || currentDeployment.createdAt}`
                : "等待首次发布后展示版本时间"
            }
            className={statusMeta.panelClass}
          />
          <DeploymentMetricCard
            title="访问入口"
            value={primaryAccessUrl ? "网站已生成访问地址" : "尚未生成访问地址"}
            subtitle={primaryAccessUrl || "首次发布成功后，这里会展示线上访问地址。"}
          />
          <DeploymentMetricCard
            title="版本概览"
            value={info?.deployments.length ? `${info.deployments.length} 次发布记录` : "暂无发布记录"}
            subtitle={
              info?.activeDeploymentPending
                ? "当前有任务正在发布中。"
                : "发布后可在这里查看历史版本与回滚入口。"
            }
          />
        </div>

        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
                <Globe className="size-4 text-slate-500" />
                网站地址
              </div>
              {primaryAccessUrl ? (
                <a
                  href={primaryAccessUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all text-sm text-blue-600 hover:text-blue-700"
                >
                  {primaryAccessUrl}
                </a>
              ) : (
                <p className="text-sm text-slate-500">发布完成后自动生成线上地址。</p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {primaryAccessUrl ? (
                <Button asChild>
                  <a href={primaryAccessUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="size-4" />
                    打开网站
                  </a>
                </Button>
              ) : null}
              <Button
                variant="outline"
                onClick={() => onRefresh(currentDeploymentId || undefined)}
                disabled={loading}
              >
                <RefreshCw className={cn("size-4", loading ? "animate-spin" : "")} />
                刷新结果
              </Button>
            </div>
          </div>
        </div>

        {accessEntries.length ? (
          <div className="mt-4 grid gap-2 md:grid-cols-2">
            {accessEntries.map(([label, value]) => (
              <a
                key={`${label}-${value}`}
                href={value}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl border border-slate-200 bg-white px-3 py-3 transition-colors hover:border-slate-300 hover:bg-slate-50"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">
                      {label}
                    </div>
                    <div className="mt-1 break-all text-sm text-slate-700">{value}</div>
                  </div>
                  <ExternalLink className="size-4 shrink-0 text-slate-400" />
                </div>
              </a>
            ))}
          </div>
        ) : null}
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <History className="size-4 text-slate-500" />
              发布记录
            </div>
            <div className="text-xs text-slate-500">
              {currentDeployment ? `当前查看 ${currentDeployment.id.slice(0, 8)}` : "暂无记录"}
            </div>
          </div>
          <div className="space-y-3 p-4">
            {info?.deployments.length ? (
              <div className="space-y-2">
                {info.deployments.slice(0, 6).map((item) => {
                  const itemSelected = item.id === currentDeployment?.id;
                  const itemStatusClass =
                    item.status === "SUCCESS"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : item.status === "FAILED" || item.status === "CRASHED"
                        ? "border-rose-200 bg-rose-50 text-rose-700"
                        : "border-amber-200 bg-amber-50 text-amber-700";
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onSelectDeployment(item.id)}
                      className={cn(
                        "w-full rounded-xl border px-3 py-3 text-left transition-colors",
                        itemSelected ? "border-slate-900 bg-slate-50" : "border-slate-200 hover:bg-slate-50"
                      )}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className={cn("rounded-full border px-2 py-0.5 text-[11px]", itemStatusClass)}>
                              {item.status}
                            </span>
                            <span className="font-mono text-[11px] text-slate-400">{item.id.slice(0, 8)}</span>
                          </div>
                          <div className="text-sm font-medium text-slate-900">
                            {item.commitMessage || "由 OneCEO 触发的版本发布"}
                          </div>
                        </div>
                        <div className="text-xs text-slate-500">
                          {formatPreviewTimestamp(item.createdAt) || item.createdAt || "时间未知"}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                暂无发布记录
              </div>
            )}

            {currentDeployment ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">
                      当前版本详情
                    </div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">
                      {currentDeployment.commitMessage || "由 OneCEO 触发的版本发布"}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {currentDeployment.commitAuthor
                        ? `提交人 ${currentDeployment.commitAuthor}`
                        : "平台托管发布记录"}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {runtimeUrl ? (
                      <Button variant="outline" asChild>
                        <a href={runtimeUrl} target="_blank" rel="noreferrer">
                          <ExternalLink className="size-4" />
                          运行地址
                        </a>
                      </Button>
                    ) : null}
                    {staticUrl && staticUrl !== runtimeUrl ? (
                      <Button variant="outline" asChild>
                        <a href={staticUrl} target="_blank" rel="noreferrer">
                          <ExternalLink className="size-4" />
                          静态地址
                        </a>
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </section>

        <div className="space-y-4">
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900">
              <Server className="size-4 text-slate-500" />
              资源状态
            </div>
            <div className="grid gap-3 p-4">
              <DeploymentInfoCard
                title="项目"
                value={info?.projectName || info?.projectId || "未配置"}
                mono={Boolean(info?.projectId && info?.projectName)}
                extra={info?.projectId && info?.projectName ? info.projectId : undefined}
              />
              <DeploymentInfoCard
                title="服务"
                value={info?.serviceName || info?.serviceId || "未配置"}
                mono={Boolean(info?.serviceId && info?.serviceName)}
                extra={info?.serviceId && info?.serviceName ? info.serviceId : undefined}
              />
              <DeploymentInfoCard
                title="环境"
                value={info?.environmentName || info?.environmentId || "未配置"}
              />
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
                  <ShieldCheck className="size-4 text-slate-500" />
                  部署准备情况
                </div>
                <div className="mt-2 text-xs leading-5 text-slate-600">
                  {info?.missing.length
                    ? `仍缺少 ${info.missing.join("、")}`
                    : info?.configured
                      ? "资源已准备完成，可继续发布与回滚。"
                      : "正在准备部署资源。"}
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900">
              <ScrollText className="size-4 text-slate-500" />
              发布日志
            </div>
            {logsText ? (
              <div className="max-h-[420px] overflow-auto bg-slate-950 text-slate-100">
                <pre className="px-4 py-4 text-[11px] leading-5 whitespace-pre-wrap break-words">
                  <code>{logsText}</code>
                </pre>
              </div>
            ) : (
              <div className="px-4 py-10 text-sm text-slate-500">
                {info?.configured ? "当前版本暂无日志输出" : "部署资源准备完成后可查看发布日志"}
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

function DeploymentDashboardSection({
  info,
  statusMeta,
  successCount,
  failedCount,
  successRate,
  currentDeployment,
  latestTimestamp,
  accessEntries,
}: {
  info: TaskCreationDeploymentInfo | null;
  statusMeta: DeploymentStatusMeta;
  successCount: number;
  failedCount: number;
  successRate: string;
  currentDeployment: TaskCreationDeploymentInfo["deployments"][number] | null;
  latestTimestamp: string;
  accessEntries: Array<[string, string] | readonly [string, string]>;
}) {
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800 p-5 text-white shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.18em] text-slate-400">部署仪表盘</div>
            <div className="mt-2 text-2xl font-semibold">当前状态：{statusMeta.label}</div>
            <div className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
              这里集中展示 OneCEO 平台部署工作台的运行指标。当前以发布稳定性、域名状态和版本轨迹为主，访客类统计后续再补。
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
            <div className="text-[11px] uppercase tracking-[0.14em] text-slate-400">最近活动</div>
            <div className="mt-2 text-sm font-medium text-white">{latestTimestamp}</div>
          </div>
        </div>
      </section>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <DeploymentMetricCard title="发布成功率" value={successRate} subtitle="基于当前会话内的发布历史计算" />
        <DeploymentMetricCard title="成功版本" value={`${successCount}`} subtitle="可用于回滚的稳定版本数" />
        <DeploymentMetricCard title="失败版本" value={`${failedCount}`} subtitle="建议结合日志继续排查的版本数" />
        <DeploymentMetricCard
          title="访问入口"
          value={`${accessEntries.length}`}
          subtitle={accessEntries.length ? "已生成可访问地址" : "等待发布后生成访问地址"}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900">
            发布健康度
          </div>
          <div className="grid gap-3 p-4 md:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">当前版本</div>
              <div className="mt-2 text-sm font-semibold text-slate-900">
                {currentDeployment?.commitMessage || "等待首次发布"}
              </div>
              <div className="mt-1 text-xs leading-5 text-slate-500">
                {currentDeployment?.commitAuthor
                  ? `最近由 ${currentDeployment.commitAuthor} 触发`
                  : "由平台托管的自动发布流程生成"}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">域名状态</div>
              <div className="mt-2 text-sm font-semibold text-slate-900">
                {accessEntries.length ? "访问入口可用" : "尚未生成"}
              </div>
              <div className="mt-1 text-xs leading-5 text-slate-500">
                {accessEntries.length
                  ? `当前共 ${accessEntries.length} 个入口可用于访问与验证`
                  : "完成首次发布后会自动生成默认访问地址"}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 md:col-span-2">
              <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">部署摘要</div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className={cn("rounded-full border px-2 py-0.5 text-[11px]", statusMeta.badgeClass)}>
                  {statusMeta.label}
                </span>
                {info?.activeDeploymentPending ? (
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
                    有任务正在发布
                  </span>
                ) : null}
              </div>
              <div className="mt-2 text-sm leading-6 text-slate-600">{statusMeta.description}</div>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900">
            最近版本轨迹
          </div>
          <div className="space-y-3 p-4">
            {info?.deployments.length ? (
              info.deployments.slice(0, 5).map((item) => (
                <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-slate-900">
                      {item.commitMessage || "由 OneCEO 触发的版本发布"}
                    </span>
                    <span className="text-[11px] text-slate-500">
                      {formatPreviewTimestamp(item.createdAt) || item.createdAt || "时间未知"}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-700">
                      {item.status}
                    </span>
                    <span className="font-mono text-[11px] text-slate-400">{item.id.slice(0, 8)}</span>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                暂无版本轨迹
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function DeploymentDatabaseSection({
  info,
  statusMeta,
}: {
  info: TaskCreationDeploymentInfo | null;
  statusMeta: DeploymentStatusMeta;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900">
          数据库
        </div>
        <div className="grid gap-3 p-4 md:grid-cols-2">
          <DeploymentMetricCard
            title="数据库状态"
            value="未开通"
            subtitle="当前部署链路已具备应用发布能力，数据库服务仍需后续接入。"
          />
          <DeploymentMetricCard
            title="推荐形态"
            value="托管 PostgreSQL"
            subtitle="后续建议以平台托管数据库方式接入，避免把外部连接细节暴露给最终用户。"
          />
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 md:col-span-2">
            <div className="text-sm font-semibold text-slate-900">当前部署工作台已经接入的能力</div>
            <div className="mt-2 grid gap-3 md:grid-cols-3">
              <DeploymentMiniStatus label="应用发布" value={statusMeta.label} />
              <DeploymentMiniStatus
                label="环境准备"
                value={info?.configured ? "已完成" : "准备中"}
              />
              <DeploymentMiniStatus label="数据层" value="待接入" />
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900">
          接入计划
        </div>
        <div className="space-y-3 p-4">
          <DeploymentPlaceholderCard
            title="业务数据库"
            description="为应用提供结构化数据存储、事务处理和持久化能力。"
          />
          <DeploymentPlaceholderCard
            title="连接配置"
            description="后续将支持由平台统一注入连接串与访问策略，用户侧无需感知底层提供商。"
          />
          <DeploymentPlaceholderCard
            title="迁移与初始化"
            description="后续可结合首发部署自动执行 schema 初始化与数据迁移。"
          />
        </div>
      </section>
    </div>
  );
}

function DeploymentStorageSection({
  info,
  statusMeta,
}: {
  info: TaskCreationDeploymentInfo | null;
  statusMeta: DeploymentStatusMeta;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900">
          存储桶
        </div>
        <div className="grid gap-3 p-4 md:grid-cols-2">
          <DeploymentMetricCard
            title="存储状态"
            value="未启用"
            subtitle="当前静态资源仍跟随应用代码发布，用户上传与媒体文件存储尚未开通。"
          />
          <DeploymentMetricCard
            title="推荐用途"
            value="用户上传 / 媒体资源"
            subtitle="适合图片、附件、导出文件和大体积静态资源。"
          />
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 md:col-span-2">
            <div className="text-sm font-semibold text-slate-900">当前可见状态</div>
            <div className="mt-2 grid gap-3 md:grid-cols-3">
              <DeploymentMiniStatus label="应用访问" value={statusMeta.label} />
              <DeploymentMiniStatus
                label="默认域名"
                value={info?.domains.length ? "已生成" : "待发布"}
              />
              <DeploymentMiniStatus label="对象存储" value="待接入" />
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900">
          场景规划
        </div>
        <div className="space-y-3 p-4">
          <DeploymentPlaceholderCard
            title="用户文件上传"
            description="用于头像、商品图片、用户附件等持久化存储。"
          />
          <DeploymentPlaceholderCard
            title="构建产物分离"
            description="让静态资源和运行时代码解耦，减轻重新发布的成本。"
          />
          <DeploymentPlaceholderCard
            title="访问策略"
            description="后续可扩展公开读、私有签名下载和生命周期清理策略。"
          />
        </div>
      </section>
    </div>
  );
}

function DeploymentSettingsSectionPanel({
  info,
  statusMeta,
  currentDeployment,
  primaryAccessUrl,
  accessEntries,
  settingsSection,
  onSettingsSectionChange,
}: {
  info: TaskCreationDeploymentInfo | null;
  statusMeta: DeploymentStatusMeta;
  currentDeployment: TaskCreationDeploymentInfo["deployments"][number] | null;
  primaryAccessUrl: string;
  accessEntries: Array<[string, string] | readonly [string, string]>;
  settingsSection: DeploymentSettingsSection;
  onSettingsSectionChange: (value: DeploymentSettingsSection) => void;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)]">
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900">
          设置
        </div>
        <div className="flex gap-2 overflow-x-auto p-3 xl:flex-col xl:overflow-visible">
          <DeploymentSettingsButton
            active={settingsSection === "general"}
            label="通用"
            onClick={() => onSettingsSectionChange("general")}
          />
          <DeploymentSettingsButton
            active={settingsSection === "domain"}
            label="域名"
            onClick={() => onSettingsSectionChange("domain")}
          />
          <DeploymentSettingsButton
            active={settingsSection === "notifications"}
            label="通知"
            onClick={() => onSettingsSectionChange("notifications")}
          />
          <DeploymentSettingsButton
            active={settingsSection === "payment"}
            label="支付"
            onClick={() => onSettingsSectionChange("payment")}
          />
          <DeploymentSettingsButton
            active={settingsSection === "seo"}
            label="SEO"
            onClick={() => onSettingsSectionChange("seo")}
          />
          <DeploymentSettingsButton
            active={settingsSection === "keys"}
            label="密钥"
            onClick={() => onSettingsSectionChange("keys")}
          />
          <DeploymentSettingsButton
            active={settingsSection === "github"}
            label="GitHub"
            onClick={() => onSettingsSectionChange("github")}
          />
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900">
          {settingsSection === "general" ? "通用" : null}
          {settingsSection === "domain" ? "域名" : null}
          {settingsSection === "notifications" ? "通知" : null}
          {settingsSection === "payment" ? "支付" : null}
          {settingsSection === "seo" ? "SEO" : null}
          {settingsSection === "keys" ? "密钥" : null}
          {settingsSection === "github" ? "GitHub" : null}
        </div>
        <div className="p-4">
          {settingsSection === "general" ? (
            <div className="grid gap-3 md:grid-cols-2">
              <DeploymentInfoCard
                title="站点名称"
                value={info?.serviceName || info?.projectName || "未命名应用"}
                extra="当前由平台托管部署工作流统一管理"
              />
              <DeploymentInfoCard
                title="发布状态"
                value={statusMeta.label}
                extra={statusMeta.description}
              />
              <DeploymentInfoCard
                title="环境"
                value={info?.environmentName || info?.environmentId || "未配置"}
              />
              <DeploymentInfoCard
                title="当前版本"
                value={currentDeployment?.commitMessage || "等待首次发布"}
                extra={currentDeployment?.id ? `版本号 ${currentDeployment.id.slice(0, 8)}` : undefined}
              />
            </div>
          ) : null}

          {settingsSection === "domain" ? (
            <div className="space-y-3">
              <DeploymentInfoCard
                title="主访问地址"
                value={primaryAccessUrl || "尚未生成"}
                extra={primaryAccessUrl ? "当前可直接用于线上访问与验证" : "完成首次发布后自动生成"}
              />
              <div className="grid gap-3 md:grid-cols-2">
                {accessEntries.length ? (
                  accessEntries.map(([label, value]) => (
                    <DeploymentInfoCard key={`${label}-${value}`} title={label} value={value} />
                  ))
                ) : (
                  <DeploymentPlaceholderCard
                    title="域名列表为空"
                    description="当前还没有可展示的访问域名，发布成功后会自动回填。"
                  />
                )}
              </div>
            </div>
          ) : null}

          {settingsSection === "notifications" ? (
            <div className="grid gap-3 md:grid-cols-2">
              <DeploymentInfoCard
                title="发布成功通知"
                value="即将支持"
                extra="后续可在站内或消息渠道订阅发布成功通知。"
              />
              <DeploymentInfoCard
                title="发布失败通知"
                value="即将支持"
                extra="后续可针对失败版本推送告警与排障建议。"
              />
              <DeploymentInfoCard
                title="回滚通知"
                value="即将支持"
                extra="后续会记录并通知版本回滚行为。"
              />
              <DeploymentInfoCard
                title="当前策略"
                value="平台默认静默"
                extra="目前仅在部署面板内查看发布状态，不会主动外发通知。"
              />
            </div>
          ) : null}

          {settingsSection === "payment" ? (
            <div className="grid gap-3 md:grid-cols-2">
              <DeploymentInfoCard
                title="结算方式"
                value="平台统一结算"
                extra="当前部署供应链成本由平台侧统一处理，终端用户不直接接触底层供应商。"
              />
              <DeploymentInfoCard
                title="用户侧计费"
                value="未开放"
                extra="暂未对单个应用暴露独立账单与资源费用。"
              />
              <DeploymentInfoCard
                title="用量阈值提醒"
                value="即将支持"
                extra="后续可在达到部署或存储阈值时进行提醒。"
              />
              <DeploymentInfoCard
                title="升级能力"
                value="待扩展"
                extra="如后续引入更高规格资源，可在此处集中管理。"
              />
            </div>
          ) : null}

          {settingsSection === "seo" ? (
            <div className="grid gap-3 md:grid-cols-2">
              <DeploymentInfoCard
                title="站点标题"
                value={info?.serviceName || info?.projectName || "OneCEO 应用"}
                extra="当前仅做展示级整理，后续可扩展为真实 SEO 元信息配置。"
              />
              <DeploymentInfoCard
                title="索引入口"
                value={primaryAccessUrl || "待发布后生成"}
                extra="成功发布后即可作为爬虫访问入口。"
              />
              <DeploymentInfoCard
                title="Meta / Open Graph"
                value="即将支持"
                extra="后续可统一配置 description、preview 图和社交分享信息。"
              />
              <DeploymentInfoCard
                title="站点地图"
                value="待扩展"
                extra="后续可按应用类型自动生成 sitemap 与 robots 策略。"
              />
            </div>
          ) : null}

          {settingsSection === "keys" ? (
            <div className="grid gap-3 md:grid-cols-2">
              <DeploymentInfoCard
                title="平台托管部署密钥"
                value={info?.configured ? "已就绪" : "准备中"}
                extra="部署用凭据由平台保管，用户侧不需要直接处理供应链 token。"
              />
              <DeploymentInfoCard
                title="用户自定义环境变量"
                value="即将支持"
                extra="后续可在此处管理业务密钥、第三方 API Key 和环境变量。"
              />
              <DeploymentInfoCard
                title="密钥轮换"
                value="平台管理"
                extra="后续可结合发布工作流实现自动轮换与审计。"
              />
              <DeploymentInfoCard
                title="审计视图"
                value="待扩展"
                extra="未来可在此查看密钥变更、发布使用和权限范围。"
              />
            </div>
          ) : null}

          {settingsSection === "github" ? (
            <div className="grid gap-3 md:grid-cols-2">
              <DeploymentInfoCard
                title="源码镜像"
                value={info?.configured ? "平台托管同步中" : "尚未连接"}
                extra="当前发布链路会把工作区导出到平台托管仓库，再由供应链执行部署。"
              />
              <DeploymentInfoCard
                title="触发方式"
                value="推送后自动发布"
                extra="每次发布都会同步最新代码并驱动新的部署版本。"
              />
              <DeploymentInfoCard
                title="最近同步版本"
                value={currentDeployment?.commitMessage || "等待首次同步"}
                extra={currentDeployment?.id ? `同步标识 ${currentDeployment.id.slice(0, 8)}` : undefined}
              />
              <DeploymentInfoCard
                title="用户感知"
                value="OneCEO 平台发布"
                extra="GitHub 仅作为平台内部托管链路的一部分。"
              />
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function DeploymentMenuButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ComponentType<any>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap",
        active
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  );
}

function DeploymentSettingsButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-xl border px-3 py-2 text-left text-sm transition-colors whitespace-nowrap",
        active
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
      )}
    >
      {label}
    </button>
  );
}

function DeploymentMetricCard({
  title,
  value,
  subtitle,
  className,
}: {
  title: string;
  value: string;
  subtitle?: string;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border border-slate-200 bg-white/90 p-3", className)}>
      <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">{title}</div>
      <div className="mt-2 text-sm font-semibold text-slate-900">{value}</div>
      {subtitle ? <div className="mt-1 text-xs leading-5 text-slate-600">{subtitle}</div> : null}
    </div>
  );
}

function DeploymentInfoCard({
  title,
  value,
  extra,
  mono = false,
}: {
  title: string;
  value: string;
  extra?: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
      <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">{title}</div>
      <div className={cn("mt-2 text-sm font-medium text-slate-900 break-all", mono ? "font-mono text-[12px]" : "")}>
        {value}
      </div>
      {extra ? <div className="mt-1 text-xs leading-5 text-slate-500">{extra}</div> : null}
    </div>
  );
}

function DeploymentMiniStatus({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
      <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-medium text-slate-900">{value}</div>
    </div>
  );
}

function DeploymentPlaceholderCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-4">
      <div className="text-sm font-semibold text-slate-900">{title}</div>
      <div className="mt-1 text-sm leading-6 text-slate-600">{description}</div>
    </div>
  );
}

function DebugPreview({
  info,
  loading,
  error,
  runtimeReady,
  starting,
  onStart,
}: {
  info: TaskCreationDebugInfo | null;
  loading: boolean;
  error: string | null;
  runtimeReady: boolean;
  starting: boolean;
  onStart: () => void;
}) {
  const debugUrl = useMemo(() => {
    if (!info?.url) return "";
    try {
      const url = new URL(info.url);
      if (!url.searchParams.get("usr")) {
        url.searchParams.set("usr", "oneceo");
      }
      if (!url.searchParams.get("pwd")) {
        url.searchParams.set("pwd", "oneceo");
      }
      if (!url.searchParams.get("username")) {
        url.searchParams.set("username", url.searchParams.get("usr") || "oneceo");
      }
      if (!url.searchParams.get("password")) {
        url.searchParams.set("password", url.searchParams.get("pwd") || "oneceo");
      }
      if (!url.searchParams.get("autoconnect")) {
        url.searchParams.set("autoconnect", "1");
      }
      if (!url.searchParams.get("autoplay")) {
        url.searchParams.set("autoplay", "1");
      }
      if (!url.searchParams.get("mute")) {
        url.searchParams.set("mute", "1");
      }
      if (!url.searchParams.get("embed")) {
        url.searchParams.set("embed", "1");
      }
      return url.toString();
    } catch {
      return info.url;
    }
  }, [info?.url]);

  if (!runtimeReady) {
    return (
      <EmptyState text={starting ? "正在启动执行环境..." : "执行环境未启动，无法加载调试画面"} />
    );
  }
  if (loading) {
    return <EmptyState text="正在加载调试画面..." />;
  }
  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-xs text-muted-foreground gap-2">
        <span>{error}</span>
      </div>
    );
  }
  if (!info?.ready || !info.url) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-xs text-muted-foreground gap-3">
        <span>{info?.message || "调试服务未就绪"}</span>
        <Button variant="outline" size="sm" onClick={onStart} disabled={starting}>
          {starting ? "启动中..." : "启动调试"}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <div className="text-xs text-muted-foreground">远程浏览器调试</div>
        <a
          href={debugUrl}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-blue-600 hover:text-blue-700"
        >
          打开新窗口
        </a>
      </div>
      <div className="flex-1 min-h-0 p-3">
        <div className="h-full w-full rounded-xl border border-border overflow-hidden bg-black/5">
          <iframe
            title="remote-debug"
            src={debugUrl}
            className="h-full w-full"
            allow="clipboard-read; clipboard-write; fullscreen; autoplay; microphone; camera; display-capture"
          />
        </div>
      </div>
    </div>
  );
}

function DiffBlock({ diff, files }: { diff?: string; files?: StructuredFileDiff[] }) {
  const structuredFiles = useMemo(() => parseStructuredDiffs(files), [files]);
  const unifiedFiles = useMemo(() => (diff ? parseUnifiedDiffDetailed(diff) : []), [diff]);
  const fallbackFiles = useMemo(() => (diff ? parseApplyPatchDiff(diff) : []), [diff]);
  const baseFiles =
    structuredFiles.length > 0 ? structuredFiles : unifiedFiles.length > 0 ? unifiedFiles : fallbackFiles;
  const [showWhitespace, setShowWhitespace] = useState(false);
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const [collapsedHunks, setCollapsedHunks] = useState<Set<string>>(new Set());
  const effectiveFiles = useMemo(() => {
    const withWhitespace = markWhitespaceOnly(baseFiles);
    return ignoreWhitespace ? filterWhitespaceOnly(withWhitespace) : withWhitespace;
  }, [baseFiles, ignoreWhitespace]);
  const displayFiles = useMemo(() => {
    return effectiveFiles
      .map((file) => {
        const stats = computeFileStats(file);
        if (stats.additions === 0 && stats.deletions === 0) {
          return null;
        }
        const mode = resolveDiffDisplayMode(stats);
        const hunks = file.hunks
          .map((hunk) => {
            const lines = filterLinesForMode(hunk.lines, mode);
            return { ...hunk, lines };
          })
          .filter((hunk) => hunk.lines.length > 0);
        return { file, stats, mode, hunks };
      })
      .filter(isDisplayFile);
  }, [effectiveFiles]);

  useEffect(() => {
    setCollapsedFiles(new Set());
    setCollapsedHunks(new Set());
  }, [diff, files]);

  if (baseFiles.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 font-mono whitespace-pre-wrap break-words">
        {diff || "暂无更改"}
      </div>
    );
  }

  if (displayFiles.length === 0) {
    return <EmptyState text="忽略空白差异后无可展示内容" />;
  }

  const showGlobalHeader = displayFiles.every((entry) => entry.mode === "split");
  const allFileIds = displayFiles.map((entry) => entry.file.id);
  const allHunkIds = displayFiles.flatMap((entry) => entry.hunks.map((hunk) => hunk.id));

  const toggleFile = (id: string) => {
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleHunk = (id: string) => {
    setCollapsedHunks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className="flex h-full flex-col rounded-lg border border-slate-200 bg-white text-xs text-slate-700 font-mono overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 text-[11px] text-slate-500">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-full border border-slate-200 px-2 py-0.5 hover:bg-slate-100"
            onClick={() => {
              setCollapsedFiles(new Set(allFileIds));
              setCollapsedHunks(new Set(allHunkIds));
            }}
          >
            全部收起
          </button>
          <button
            type="button"
            className="rounded-full border border-slate-200 px-2 py-0.5 hover:bg-slate-100"
            onClick={() => {
              setCollapsedFiles(new Set());
              setCollapsedHunks(new Set());
            }}
          >
            全部展开
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={`rounded-full border px-2 py-0.5 hover:bg-slate-100 ${
              showWhitespace ? "border-emerald-500 text-emerald-700" : "border-slate-200"
            }`}
            onClick={() => setShowWhitespace((prev) => !prev)}
          >
            高亮空白符
          </button>
          <button
            type="button"
            className={`rounded-full border px-2 py-0.5 hover:bg-slate-100 ${
              ignoreWhitespace ? "border-emerald-500 text-emerald-700" : "border-slate-200"
            }`}
            onClick={() => setIgnoreWhitespace((prev) => !prev)}
          >
            忽略空白差异
          </button>
        </div>
      </div>
      {showGlobalHeader ? (
        <div className="grid grid-cols-2 border-b border-slate-200 text-[11px] uppercase tracking-wide text-slate-500">
          <div className="px-3 py-2 border-r border-slate-200">Before</div>
          <div className="px-3 py-2">After</div>
        </div>
      ) : null}
      <div className="flex-1 min-h-0 overflow-auto">
        {displayFiles.map(({ file, stats, mode, hunks }) => {
          const fileCollapsed = collapsedFiles.has(file.id);
          return (
            <div key={file.id} className="border-b border-slate-200">
              <div className="flex items-center justify-between px-3 py-2 text-slate-700 bg-slate-50">
                <div>
                  <div className="text-xs font-semibold">文件: {file.displayPath}</div>
                  {(file.oldPath || file.newPath) && (
                    <div className="text-[11px] text-slate-500">
                      {file.oldPath ? `- ${file.oldPath}` : ""}
                      {file.oldPath && file.newPath ? " | " : ""}
                      {file.newPath ? `+ ${file.newPath}` : ""}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3 text-[11px] text-slate-500">
                  <span className="text-emerald-600">+{stats.additions}</span>
                  <span className="text-rose-600">-{stats.deletions}</span>
                  <button
                    type="button"
                    onClick={() => toggleFile(file.id)}
                    className="text-[11px] text-slate-500 hover:text-slate-900"
                  >
                    {fileCollapsed ? "展开" : "收起"}
                  </button>
                </div>
              </div>

              {!fileCollapsed && !showGlobalHeader ? (
                mode === "split" ? (
                  <div className="grid grid-cols-2 border-t border-slate-200 border-b border-slate-200 text-[11px] uppercase tracking-wide text-slate-500">
                    <div className="px-3 py-2 border-r border-slate-200">Before</div>
                    <div className="px-3 py-2">After</div>
                  </div>
                ) : (
                  <div className="border-t border-slate-200 border-b border-slate-200 px-3 py-2 text-[11px] uppercase tracking-wide text-slate-500">
                    {mode === "add-only" ? "新增" : "删除"}
                  </div>
                )
              ) : null}

              {!fileCollapsed &&
                hunks.map((hunk) => {
                  const hunkCollapsed = collapsedHunks.has(hunk.id);
                  return (
                    <div key={hunk.id} className="border-t border-slate-200">
                      <div className="flex items-center justify-between px-3 py-1 text-slate-500 bg-slate-50">
                        <span>{hunk.header}</span>
                        <button
                          type="button"
                          onClick={() => toggleHunk(hunk.id)}
                          className="text-[11px] text-slate-500 hover:text-slate-900"
                        >
                          {hunkCollapsed ? "展开" : "收起"}
                        </button>
                      </div>
                      {!hunkCollapsed && (
                        <div>
                          {mode === "split" &&
                            hunk.lines.map((row, index) => (
                              <div key={`${hunk.id}-row-${index}`} className="grid grid-cols-2">
                                <div
                                  className={`flex gap-2 px-3 py-0.5 border-r border-slate-200 ${
                                    row.leftType === "del" ? "bg-rose-50 text-rose-700" : "text-slate-700"
                                  }`}
                                >
                                  <span className="w-8 text-right text-slate-400">{row.leftLine ?? ""}</span>
                                  <span className="whitespace-pre-wrap break-words flex-1">
                                    {renderWhitespace(row.leftText, showWhitespace)}
                                  </span>
                                </div>
                                <div
                                  className={`flex gap-2 px-3 py-0.5 ${
                                    row.rightType === "add" ? "bg-emerald-50 text-emerald-700" : "text-slate-700"
                                  }`}
                                >
                                  <span className="w-8 text-right text-slate-400">{row.rightLine ?? ""}</span>
                                  <span className="whitespace-pre-wrap break-words flex-1">
                                    {renderWhitespace(row.rightText, showWhitespace)}
                                  </span>
                                </div>
                              </div>
                            ))}
                          {mode !== "split" &&
                            hunk.lines.map((row, index) => {
                              const isAdd = mode === "add-only";
                              return (
                                <div
                                  key={`${hunk.id}-row-${index}`}
                                  className={`flex gap-2 px-3 py-0.5 ${
                                    isAdd ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
                                  }`}
                                >
                                  <span className="w-8 text-right text-slate-400">
                                    {isAdd ? row.rightLine ?? "" : row.leftLine ?? ""}
                                  </span>
                                  <span className="whitespace-pre-wrap break-words flex-1">
                                    {renderWhitespace(isAdd ? row.rightText : row.leftText, showWhitespace)}
                                  </span>
                                </div>
                              );
                            })}
                        </div>
                      )}
                      {hunkCollapsed && (
                        <div className="px-3 py-1 text-[11px] text-slate-400">...</div>
                      )}
                    </div>
                  );
                })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

type DiffLine = {
  leftLine: number | null;
  rightLine: number | null;
  leftText: string;
  rightText: string;
  leftType: "context" | "del";
  rightType: "context" | "add";
  whitespaceOnly?: boolean;
};

type DiffHunk = {
  id: string;
  header: string;
  lines: DiffLine[];
};

type DiffFile = {
  id: string;
  oldPath: string | null;
  newPath: string | null;
  displayPath: string;
  hunks: DiffHunk[];
};

type DiffDisplayMode = "split" | "add-only" | "del-only";

type DisplayFile = {
  file: DiffFile;
  stats: { additions: number; deletions: number };
  mode: DiffDisplayMode;
  hunks: DiffHunk[];
};

type DiffOp = {
  type: "equal" | "insert" | "delete";
  line: string;
};

function renderWhitespace(text: string, showWhitespace: boolean) {
  if (!showWhitespace) return text;
  return text.replace(/\t/g, "⇥").replace(/ /g, "·");
}

function normalizeWhitespace(text: string) {
  return text.replace(/\s+/g, "");
}

function markWhitespaceOnly(files: DiffFile[]): DiffFile[] {
  return files.map((file) => {
    const hunks = file.hunks.map((hunk) => {
      const lines = hunk.lines.map((line) => ({ ...line }));
      let i = 0;
      while (i < lines.length) {
        if (lines[i].leftType !== "del") {
          i += 1;
          continue;
        }
        const delStart = i;
        while (i < lines.length && lines[i].leftType === "del") i += 1;
        const addStart = i;
        while (i < lines.length && lines[i].rightType === "add") i += 1;
        const delLines = lines.slice(delStart, addStart);
        const addLines = lines.slice(addStart, i);
        const pairCount = Math.min(delLines.length, addLines.length);
        for (let idx = 0; idx < pairCount; idx += 1) {
          const delText = delLines[idx].leftText;
          const addText = addLines[idx].rightText;
          if (delText !== addText && normalizeWhitespace(delText) === normalizeWhitespace(addText)) {
            delLines[idx].whitespaceOnly = true;
            addLines[idx].whitespaceOnly = true;
          }
        }
      }
      return {
        ...hunk,
        lines,
      };
    });
    return {
      ...file,
      hunks,
    };
  });
}

function filterWhitespaceOnly(files: DiffFile[]): DiffFile[] {
  return files
    .map((file) => {
      const hunks = file.hunks
        .map((hunk) => {
          const lines = hunk.lines.filter((line) => !line.whitespaceOnly);
          return { ...hunk, lines };
        })
        .filter((hunk) => hunk.lines.length > 0);
      return { ...file, hunks };
    })
    .filter((file) => file.hunks.length > 0);
}

function computeFileStats(file: DiffFile) {
  let additions = 0;
  let deletions = 0;
  file.hunks.forEach((hunk) => {
    hunk.lines.forEach((line) => {
      if (line.rightType === "add") additions += 1;
      if (line.leftType === "del") deletions += 1;
    });
  });
  return { additions, deletions };
}

function resolveDiffDisplayMode(stats: { additions: number; deletions: number }): DiffDisplayMode {
  if (stats.additions > 0 && stats.deletions === 0) return "add-only";
  if (stats.deletions > 0 && stats.additions === 0) return "del-only";
  return "split";
}

function isDisplayFile(value: DisplayFile | null): value is DisplayFile {
  return value !== null && value.hunks.length > 0;
}

function filterLinesForMode(lines: DiffLine[], mode: DiffDisplayMode): DiffLine[] {
  if (mode === "add-only") {
    return lines.filter((line) => line.rightType === "add");
  }
  if (mode === "del-only") {
    return lines.filter((line) => line.leftType === "del");
  }
  return lines;
}

function normalizeDiffPath(path: string | null) {
  if (!path) return "";
  return path.replace(/^a\//, "").replace(/^b\//, "");
}

function splitLines(text: string) {
  if (!text) return [] as string[];
  return text.replace(/\r\n/g, "\n").split("\n");
}

function diffLines(before: string[], after: string[]): DiffOp[] {
  const n = before.length;
  const m = after.length;
  const max = n + m;
  const v = new Array(2 * max + 1).fill(0);
  const trace: number[][] = [];

  for (let d = 0; d <= max; d += 1) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      const kIndex = k + max;
      let x;
      if (k === -d || (k !== d && v[kIndex - 1] < v[kIndex + 1])) {
        x = v[kIndex + 1];
      } else {
        x = v[kIndex - 1] + 1;
      }
      let y = x - k;
      while (x < n && y < m && before[x] === after[y]) {
        x += 1;
        y += 1;
      }
      v[kIndex] = x;
      if (x >= n && y >= m) {
        return backtrackDiff(trace, before, after, max);
      }
    }
  }

  return [];
}

function backtrackDiff(trace: number[][], before: string[], after: string[], max: number): DiffOp[] {
  let x = before.length;
  let y = after.length;
  const ops: DiffOp[] = [];

  for (let d = trace.length - 1; d > 0; d -= 1) {
    const v = trace[d - 1];
    const k = x - y;
    let prevK;
    if (k === -d || (k !== d && v[k - 1 + max] < v[k + 1 + max])) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    const prevX = v[prevK + max];
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      ops.push({ type: "equal", line: before[x - 1] });
      x -= 1;
      y -= 1;
    }

    if (x === prevX) {
      if (y > 0) {
        ops.push({ type: "insert", line: after[y - 1] });
        y -= 1;
      }
    } else if (x > 0) {
      ops.push({ type: "delete", line: before[x - 1] });
      x -= 1;
    }
  }

  while (x > 0 && y > 0) {
    if (before[x - 1] === after[y - 1]) {
      ops.push({ type: "equal", line: before[x - 1] });
      x -= 1;
      y -= 1;
    } else {
      ops.push({ type: "delete", line: before[x - 1] });
      x -= 1;
    }
  }
  while (x > 0) {
    ops.push({ type: "delete", line: before[x - 1] });
    x -= 1;
  }
  while (y > 0) {
    ops.push({ type: "insert", line: after[y - 1] });
    y -= 1;
  }

  return ops.reverse();
}

function buildDiffRows(ops: DiffOp[]): DiffLine[] {
  const rows: DiffLine[] = [];
  let leftLine = 1;
  let rightLine = 1;
  let deletes: string[] = [];
  let inserts: string[] = [];

  const flush = () => {
    const max = Math.max(deletes.length, inserts.length);
    for (let i = 0; i < max; i += 1) {
      const hasLeft = i < deletes.length;
      const hasRight = i < inserts.length;
      const leftText = hasLeft ? deletes[i] : "";
      const rightText = hasRight ? inserts[i] : "";
      rows.push({
        leftLine: hasLeft ? leftLine : null,
        rightLine: hasRight ? rightLine : null,
        leftText,
        rightText,
        leftType: hasLeft ? "del" : "context",
        rightType: hasRight ? "add" : "context",
      });
      if (hasLeft) leftLine += 1;
      if (hasRight) rightLine += 1;
    }
    deletes = [];
    inserts = [];
  };

  ops.forEach((op) => {
    if (op.type === "equal") {
      flush();
      rows.push({
        leftLine,
        rightLine,
        leftText: op.line,
        rightText: op.line,
        leftType: "context",
        rightType: "context",
      });
      leftLine += 1;
      rightLine += 1;
      return;
    }
    if (op.type === "delete") {
      deletes.push(op.line);
      return;
    }
    inserts.push(op.line);
  });
  flush();

  return rows;
}

function parseStructuredDiffs(files?: StructuredFileDiff[]): DiffFile[] {
  if (!files || files.length === 0) return [];
  const mapped: DiffFile[] = [];
  files.forEach((file, index) => {
    const beforeLines = splitLines(file.before || "");
    const afterLines = splitLines(file.after || "");
    let ops: DiffOp[] = [];
    if (file.status === "added") {
      ops = afterLines.map((line) => ({ type: "insert", line }));
    } else if (file.status === "deleted") {
      ops = beforeLines.map((line) => ({ type: "delete", line }));
    } else {
      ops = diffLines(beforeLines, afterLines);
    }
    const rows = buildDiffRows(ops);
    const diffFile: DiffFile = {
      id: `struct-${index}`,
      oldPath: file.status === "added" ? null : file.file,
      newPath: file.status === "deleted" ? null : file.file,
      displayPath: normalizeDiffPath(file.file),
      hunks: [
        {
          id: `struct-${index}-hunk-0`,
          header: file.status ? `status: ${file.status}` : "modified",
          lines: rows,
        },
      ],
    };
    mapped.push(diffFile);
  });
  return mapped;
}

function parseUnifiedDiffDetailed(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  const lines = diff.split("\n");
  const hunkRegex = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/;

  let currentFile: DiffFile | null = null;
  let currentHunk: DiffHunk | null = null;
  let leftLine: number | null = null;
  let rightLine: number | null = null;

  const ensureFile = () => {
    if (!currentFile) {
      currentFile = {
        id: `file-${files.length}`,
        oldPath: null,
        newPath: null,
        displayPath: "未命名文件",
        hunks: [],
      };
      files.push(currentFile);
    }
  };

  for (const line of lines) {
    if (line.startsWith("diff --git")) {
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      currentFile = {
        id: `file-${files.length}`,
        oldPath: match ? match[1] : null,
        newPath: match ? match[2] : null,
        displayPath: match ? normalizeDiffPath(match[2]) : "未命名文件",
        hunks: [],
      };
      files.push(currentFile);
      currentHunk = null;
      leftLine = null;
      rightLine = null;
      continue;
    }

    if (line.startsWith("--- ")) {
      ensureFile();
      const path = line.replace(/^---\s+/, "");
      currentFile!.oldPath = normalizeDiffPath(path.replace(/^a\//, ""));
      continue;
    }

    if (line.startsWith("+++ ")) {
      ensureFile();
      const path = line.replace(/^\\+\\+\\+\\s+/, "");
      currentFile!.newPath = normalizeDiffPath(path.replace(/^b\//, ""));
      currentFile!.displayPath = normalizeDiffPath(currentFile!.newPath || currentFile!.oldPath || "未命名文件");
      continue;
    }

    const hunk = line.match(hunkRegex);
    if (hunk) {
      ensureFile();
      leftLine = Number(hunk[1]);
      rightLine = Number(hunk[3]);
      currentHunk = {
        id: `${currentFile!.id}-hunk-${currentFile!.hunks.length}`,
        header: line,
        lines: [],
      };
      currentFile!.hunks.push(currentHunk);
      continue;
    }

    if (!currentHunk) {
      continue;
    }

    if (line.startsWith("+")) {
      currentHunk.lines.push({
        leftLine: null,
        rightLine,
        leftText: "",
        rightText: line.slice(1),
        leftType: "context",
        rightType: "add",
      });
      if (rightLine !== null) rightLine += 1;
      continue;
    }

    if (line.startsWith("-")) {
      currentHunk.lines.push({
        leftLine,
        rightLine: null,
        leftText: line.slice(1),
        rightText: "",
        leftType: "del",
        rightType: "context",
      });
      if (leftLine !== null) leftLine += 1;
      continue;
    }

    if (line.startsWith(" ")) {
      const contextText = line.slice(1);
      currentHunk.lines.push({
        leftLine,
        rightLine,
        leftText: contextText,
        rightText: contextText,
        leftType: "context",
        rightType: "context",
      });
      if (leftLine !== null) leftLine += 1;
      if (rightLine !== null) rightLine += 1;
      continue;
    }
  }

  return files;
}

function parseApplyPatchDiff(diff: string): DiffFile[] {
  const lines = diff.split("\n");
  if (!lines.some((line) => line.startsWith("*** Begin Patch"))) {
    return [];
  }

  const files: DiffFile[] = [];
  let currentFile: DiffFile | null = null;
  let currentHunk: DiffHunk | null = null;

  const startFile = (path: string) => {
    currentFile = {
      id: `file-${files.length}`,
      oldPath: null,
      newPath: path,
      displayPath: normalizeDiffPath(path),
      hunks: [],
    };
    files.push(currentFile);
    currentHunk = {
      id: `${currentFile.id}-hunk-0`,
      header: "apply_patch",
      lines: [],
    };
    currentFile.hunks.push(currentHunk);
  };

  for (const line of lines) {
    if (line.startsWith("*** Update File: ")) {
      startFile(line.replace("*** Update File: ", "").trim());
      continue;
    }
    if (line.startsWith("*** Add File: ")) {
      startFile(line.replace("*** Add File: ", "").trim());
      continue;
    }
    if (line.startsWith("*** Delete File: ")) {
      startFile(line.replace("*** Delete File: ", "").trim());
      continue;
    }
    if (line.startsWith("*** End Patch")) {
      currentFile = null;
      currentHunk = null;
      continue;
    }
    if (!currentHunk) {
      continue;
    }
    if (line.startsWith("@@")) {
      currentHunk = {
        id: `${currentFile!.id}-hunk-${currentFile!.hunks.length}`,
        header: line,
        lines: [],
      };
      currentFile!.hunks.push(currentHunk);
      continue;
    }
    if (line.startsWith("+")) {
      currentHunk.lines.push({
        leftLine: null,
        rightLine: null,
        leftText: "",
        rightText: line.slice(1),
        leftType: "context",
        rightType: "add",
      });
      continue;
    }
    if (line.startsWith("-")) {
      currentHunk.lines.push({
        leftLine: null,
        rightLine: null,
        leftText: line.slice(1),
        rightText: "",
        leftType: "del",
        rightType: "context",
      });
      continue;
    }
    if (line.startsWith(" ")) {
      const contextText = line.slice(1);
      currentHunk.lines.push({
        leftLine: null,
        rightLine: null,
        leftText: contextText,
        rightText: contextText,
        leftType: "context",
        rightType: "context",
      });
      continue;
    }
  }

  return files;
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
      {text}
    </div>
  );
}
