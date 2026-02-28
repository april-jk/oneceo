import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { AgentMessage } from "@/hooks/useTaskCreationAgent";
import { buildPreviewItems, type PreviewDiffItem, type StructuredFileDiff } from "@/lib/opencode-preview";
import {
  getTaskCreationDebugInfo,
  startTaskCreationDebug,
  getWorkspaceFile,
  getWorkspaceTree,
  type TaskCreationDebugInfo,
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

type PreviewTab = "files" | "changes" | "debug";

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
  const [fileContent, setFileContent] = useState<string>("");
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [debugInfo, setDebugInfo] = useState<TaskCreationDebugInfo | null>(null);
  const [debugLoading, setDebugLoading] = useState(false);
  const [debugStarting, setDebugStarting] = useState(false);
  const [debugError, setDebugError] = useState<string | null>(null);
  const refreshTimerRef = useRef<number | null>(null);
  const debugBootRef = useRef(false);
  const debugRuntimeBootRef = useRef(false);
  const debugPollRef = useRef<number | null>(null);
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
    if (parts.length > 0) {
      setExpandedPaths((prev) => {
        const next = new Set(prev);
        let current = "";
        parts.slice(0, -1).forEach((part) => {
          current = current ? `${current}/${part}` : part;
          next.add(current);
        });
        return next;
      });
    }
    setFileLoading(true);
    setFileError(null);
    try {
      const file = await getWorkspaceFile(sessionId, path);
      setFileContent(file.content || "");
      if (file.truncated) {
        setFileError("内容较大，已截断显示");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "读取文件失败";
      if (message.includes("409")) {
        setFileError(null);
      } else {
        setFileError(message);
      }
      setFileContent("");
    } finally {
      setFileLoading(false);
    }
  }

  const refreshTree = async (mode: "auto" | "manual" = "manual") => {
    if (!sessionId) {
      setTreeError("缺少会话信息");
      setTree(null);
      return;
    }
    if (runtimeReady === false) {
      if (mode === "manual" && onEnsureRuntime) {
        await onEnsureRuntime();
      } else {
        setTree(null);
        setTreeError(null);
        setTreeLoading(false);
        return;
      }
    }
    setTreeLoading(true);
    setTreeError(null);
    try {
      const data = await getWorkspaceTree(sessionId);
      setTree(data);
      if (!selectedPath) {
        const firstFile = data.items.find((item) => item.type === "file");
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

  useEffect(() => {
    if (!open) return;
    void refreshTree("auto");
  }, [open, sessionId, runtimeReady]);

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
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {currentTab === "files" ? (
          <FilePreview
            tree={tree}
            loading={treeLoading}
            error={treeError}
            selectedPath={selectedPath}
            content={fileContent}
            contentError={fileError}
            contentLoading={fileLoading}
            expandedPaths={expandedPaths}
            onTogglePath={(path) => {
              setExpandedPaths((prev) => {
                const next = new Set(prev);
                if (next.has(path)) {
                  next.delete(path);
                } else {
                  next.add(path);
                }
                return next;
              });
            }}
            onRefresh={() => void refreshTree("manual")}
            onSelectFile={handleFileSelect}
            runtimeReady={runtimeReady !== false}
            runtimeStarting={runtimeStarting === true}
          />
        ) : null}
        {currentTab === "changes" ? (
          <DiffPreview
            items={diffItems}
            current={currentDiff}
            onSelect={(id) => {
              setSelectedDiffId(id);
              setAutoDiff(false);
            }}
          />
        ) : null}
        {currentTab === "debug" ? (
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
        ) : null}
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
  content,
  contentError,
  contentLoading,
  expandedPaths,
  onTogglePath,
  onRefresh,
  onSelectFile,
  runtimeReady,
  runtimeStarting,
}: {
  tree: WorkspaceTree | null;
  loading: boolean;
  error: string | null;
  selectedPath: string | null;
  content: string;
  contentError: string | null;
  contentLoading: boolean;
  expandedPaths: Set<string>;
  onTogglePath: (path: string) => void;
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

  return (
    <div className="flex h-full flex-col md:flex-row">
      <div className="md:w-[40%] border-b md:border-b-0 md:border-r border-border overflow-auto px-3 py-3">
        <div className="text-[11px] text-muted-foreground mb-2 break-all">
          根目录: {tree.root}
        </div>
        <TreeList
          nodes={nodes}
          selectedPath={selectedPath}
          onSelectFile={onSelectFile}
          expandedPaths={expandedPaths}
          onTogglePath={onTogglePath}
        />
      </div>
      <div className="flex-1 min-h-0 overflow-auto px-4 py-3">
        {selectedPath ? (
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">{selectedPath}</div>
            {contentLoading ? (
              <div className="text-xs text-muted-foreground">加载中...</div>
            ) : (
              <pre className="whitespace-pre-wrap break-words rounded-lg bg-slate-950 px-3 py-2 text-xs text-slate-100">
                {content || ""}
              </pre>
            )}
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
  onTogglePath,
  depth = 0,
}: {
  nodes: TreeNode[];
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  expandedPaths: Set<string>;
  onTogglePath: (path: string) => void;
  depth?: number;
}) {
  return (
    <div className="space-y-1">
      {nodes.map((node) => {
        const isDir = node.type === "dir";
        const isOpen = expandedPaths.has(node.path);
        const indent = depth * 12;
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
              className={`w-full flex items-center gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-muted transition-colors ${
                selectedPath === node.path ? "bg-muted text-foreground" : "text-muted-foreground"
              }`}
              style={{ paddingLeft: `${indent + 8}px` }}
            >
              <span className="w-3">{isDir ? (isOpen ? "▾" : "▸") : ""}</span>
              <span className="truncate">{node.name}</span>
            </button>
            {isDir && isOpen && node.children.length > 0 ? (
              <TreeList
                nodes={node.children}
                selectedPath={selectedPath}
                onSelectFile={onSelectFile}
                expandedPaths={expandedPaths}
                onTogglePath={onTogglePath}
                depth={depth + 1}
              />
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
  return Boolean(value) && value.hunks.length > 0;
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
