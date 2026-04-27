import {
  default as React,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import i18n from "@/i18n";
import { Button } from "@/components/ui/button";
import {
  BarChart3,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Database,
  Download,
  ExternalLink,
  File,
  FileAudio,
  FileCode2,
  FileImage,
  FileJson2,
  FileText,
  FileType2,
  FileVideo,
  Folder,
  FolderOpen,
  Globe,
  Globe2,
  HardDrive,
  History,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Lock,
  Unlock,
  Rocket,
  ScrollText,
  Settings2,
  ShieldCheck,
  TableProperties,
  Trash2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { AgentMessage } from "@/hooks/useTaskCreationAgent";
import {
  buildPreviewItems,
  type PreviewDiffItem,
  type StructuredFileDiff,
} from "@/lib/opencode-preview";
import { Streamdown } from "streamdown";
import {
  deleteTaskCreationDatabaseRow,
  getTaskCreationDatabaseInfo,
  getTaskCreationDatabaseRows,
  getTaskCreationDeploymentInfo,
  getTaskCreationDeploymentTemplateBaseline,
  getTaskCreationDebugInfo,
  insertTaskCreationDatabaseRow,
  rotateTaskCreationDeploymentToken,
  startTaskCreationRuntime,
  updateTaskCreationDatabaseRow,
  getWorkspaceFile,
  getWorkspaceDirectory,
  getWorkspaceRawFileUrl,
  type TaskCreationDatabaseColumn,
  type TaskCreationDatabaseInfo,
  type TaskCreationDatabaseRowLocator,
  type TaskCreationDatabaseRowsPage,
  type TaskCreationDeploymentInfo,
  type TaskCreationDeploymentTemplateBaseline,
  type TaskCreationDebugInfo,
  type WorkspaceFile,
  type WorkspaceTree,
  type WorkspaceTreeItem,
} from "@/lib/task-creation-client";
import { cn } from "@/lib/utils";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  appendPreviewCacheBust,
  checkWorkspaceHtmlPreviewReady,
  waitWorkspaceHtmlPreviewReady,
  type WorkspaceHtmlPreviewState,
} from "@/lib/workspace-preview";
import { normalizeWorkspaceRelativePath } from "@/lib/workspace-path";
import { useTranslation } from "react-i18next";

interface OpencodePreviewPanelProps {
  messages: AgentMessage[];
  sessionId?: string | null;
  open: boolean;
  onToggle: () => void;
  maximized?: boolean;
  onToggleMaximized?: () => void;
  activeTab?: PreviewTab;
  onTabChange?: (tab: PreviewTab) => void;
  selectedDiffId?: string | null;
  onSelectDiff?: (id: string | null) => void;
  runtimeReady?: boolean;
  runtimeStarting?: boolean;
  onEnsureRuntime?: () => Promise<void>;
  runtimeSwitchBlocked?: boolean;
  onRequestStartDebugByMessage?: () => void;
  onRequestDeployByMessage?: () => void;
  onRequestRedeployByMessage?: () => void;
  onRequestRollbackByMessage?: () => void;
  className?: string;
  selectedWorkspacePath?: string | null;
}

function resolveFilePreviewDeploymentUrl(
  info: TaskCreationDeploymentInfo | null | undefined,
): string {
  if (!info) return "";
  const selectedDeployment =
    info.deployments.find((deployment) => deployment.id === info.deploymentId) || null;
  const successfulDeployment =
    info.deployments.find(
      (deployment) =>
        deployment.status === "SUCCESS" && Boolean(deployment.staticUrl || deployment.url),
    ) || null;
  return (
    selectedDeployment?.staticUrl ||
    selectedDeployment?.url ||
    successfulDeployment?.staticUrl ||
    successfulDeployment?.url ||
    info.latestStaticUrl ||
    info.latestUrl ||
    info.domains[0] ||
    ""
  );
}

type PreviewTab = "files" | "changes" | "debug" | "deployment";
const DIRECTORY_PAGE_SIZE = 200;
export type DirectoryLoadState = {
  initialized: boolean;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  nextCursor: number | null;
  returned: number;
  total: number;
};

const DEBUG_POLL_STARTING_MS = 2000;
const DEBUG_POLL_READY_MS = 6000;
const DEBUG_POLL_RETRY_MS = 3000;

function isRetryableDebugError(message: string): boolean {
  const text = String(message || "").toLowerCase();
  return (
    text.includes("failed to fetch") ||
    text.includes("network") ||
    text.includes("timeout") ||
    text.includes("timed out") ||
    text.includes("aborterror") ||
    text.includes("request timeout") ||
    text.includes("超时")
  );
}

export function useWorkspaceFilePreviewState({
  messages,
  sessionId,
  open,
  runtimeReady,
  runtimeStarting,
  onEnsureRuntime,
  runtimeSwitchBlocked = false,
  selectedWorkspacePath,
  diffItems = [],
}: {
  messages?: AgentMessage[];
  sessionId?: string | null;
  open: boolean;
  runtimeReady?: boolean;
  runtimeStarting?: boolean;
  onEnsureRuntime?: () => Promise<void>;
  runtimeSwitchBlocked?: boolean;
  selectedWorkspacePath?: string | null;
  diffItems?: PreviewDiffItem[];
}) {
  const [tree, setTree] = useState<WorkspaceTree | null>(null);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileData, setFileData] = useState<WorkspaceFile | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [dirState, setDirState] = useState<Record<string, DirectoryLoadState>>(
    {},
  );
  const refreshTimerRef = useRef<number | null>(null);
  const fileRequestSequenceRef = useRef(0);
  const ensureRuntimeRef = useRef(runtimeSwitchBlocked ? undefined : onEnsureRuntime);
  const diffDerivedTree = useMemo(
    () => buildWorkspaceTreeFromDiffItems(sessionId, diffItems),
    [sessionId, diffItems],
  );
  const effectiveTree = useMemo(
    () => mergeWorkspaceTrees(sessionId, tree, diffDerivedTree),
    [sessionId, tree, diffDerivedTree],
  );

  useEffect(() => {
    ensureRuntimeRef.current = runtimeSwitchBlocked ? undefined : onEnsureRuntime;
  }, [onEnsureRuntime, runtimeSwitchBlocked]);

  const normalizeWorkspacePath = (value: string) =>
    normalizeWorkspaceRelativePath(value, sessionId);

  const ensureRuntimeForWorkspaceRead = async () => {
    if (runtimeReady !== false || !ensureRuntimeRef.current) {
      return;
    }
    try {
      await ensureRuntimeRef.current();
    } catch {
      // Historical file reads can still be served from archive/cache even when
      // a runtime cannot be started for this session.
    }
  };

  const mergeWorkspaceItems = (
    currentItems: WorkspaceTreeItem[],
    incomingItems: WorkspaceTreeItem[],
    parentPath: string,
    append: boolean,
  ): WorkspaceTreeItem[] => {
    const normalizedParent = normalizeWorkspacePath(parentPath);
    const parentPrefix = normalizedParent ? `${normalizedParent}/` : "";
    const byPath = new Map<string, WorkspaceTreeItem>();

    currentItems.forEach((item) => {
      const normalized = normalizeWorkspacePath(item.path);
      const belongsToParent = normalizedParent
        ? normalized.startsWith(parentPrefix)
        : true;
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
    options?: { append?: boolean; refresh?: boolean; silent?: boolean },
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
        const mergedItems = mergeWorkspaceItems(
          baseItems,
          page.items || [],
          normalizedDir,
          append,
        );
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
            typeof page.nextCursor === "number" &&
            Number.isFinite(page.nextCursor)
              ? page.nextCursor
              : null,
          returned: Number(page.returned || 0),
          total: Number(page.total || 0),
        },
      }));

      return page;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : i18n.t("homeWorkspace.loadDirectoryFailed");
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
    const normalizedPath = normalizeWorkspacePath(path);
    if (!normalizedPath) return;
    if (runtimeReady === false) {
      await ensureRuntimeForWorkspaceRead();
    }
    const requestSequence = fileRequestSequenceRef.current + 1;
    fileRequestSequenceRef.current = requestSequence;
    setSelectedPath(normalizedPath);
    setFileData(null);
    const parts = normalizedPath.split("/").filter(Boolean);
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
        await loadDirectory(normalized, {
          append: false,
          refresh: false,
          silent: true,
        });
      }
    }
    setFileLoading(true);
    setFileError(null);
    try {
      const file = await getWorkspaceFile(sessionId, normalizedPath);
      if (fileRequestSequenceRef.current !== requestSequence) {
        return;
      }
      setFileData(file);
      if (file.binaryTooLarge) {
        setFileError(i18n.t("homeWorkspace.binaryTooLarge"));
      } else if (file.truncated) {
        setFileError(i18n.t("homeWorkspace.contentTruncated"));
      }
    } catch (error) {
      if (fileRequestSequenceRef.current !== requestSequence) {
        return;
      }
      const message =
        error instanceof Error ? error.message : i18n.t("homeWorkspace.readFileFailed");
      if (message.includes("409")) {
        setFileError(null);
      } else {
        setFileError(message);
      }
      setFileData(null);
    } finally {
      if (fileRequestSequenceRef.current === requestSequence) {
        setFileLoading(false);
      }
    }
  }

  const refreshTree = async (mode: "auto" | "manual" = "manual") => {
    if (!sessionId) {
      setTreeError(i18n.t("previewPanel.deployment.missingSession"));
      setTree(null);
      setDirState({});
      return;
    }
    if (runtimeReady === false) {
      if (mode === "manual" && ensureRuntimeRef.current) {
        await ensureRuntimeForWorkspaceRead();
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
      const message =
        error instanceof Error ? error.message : i18n.t("homeWorkspace.loadFileTreeFailed");
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
      void loadDirectory(normalized, {
        append: false,
        refresh: false,
        silent: true,
      });
    }
  };

  const handleLoadMoreDirectory = (path: string) => {
    const normalized = normalizeWorkspacePath(path);
    const state = dirState[normalized];
    if (
      !state ||
      state.loading ||
      !state.hasMore ||
      state.nextCursor === null
    ) {
      return;
    }
    void loadDirectory(normalized, {
      append: true,
      refresh: false,
      silent: true,
    });
  };

  useEffect(() => {
    if (!open) return;
    void refreshTree("auto");
  }, [open, sessionId, runtimeReady]);

  useEffect(() => {
    fileRequestSequenceRef.current += 1;
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
    if (!open || !sessionId || !selectedWorkspacePath) return;
    const normalizedTarget = normalizeWorkspacePath(selectedWorkspacePath);
    const normalizedSelected = selectedPath
      ? normalizeWorkspacePath(selectedPath)
      : "";
    if (!normalizedTarget || normalizedTarget === normalizedSelected) {
      return;
    }
    void handleFileSelect(normalizedTarget);
  }, [
    open,
    selectedPath,
    selectedWorkspacePath,
    sessionId,
    runtimeReady,
    runtimeStarting,
  ]);

  useEffect(() => {
    if (!messages?.length) return;
    if (!open || !sessionId) return;
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
  }, [messages, open, sessionId, runtimeReady]);

  return {
    effectiveTree,
    treeError,
    treeLoading,
    selectedPath,
    fileData,
    fileError,
    fileLoading,
    expandedPaths,
    dirState,
    refreshTree,
    handleFileSelect,
    handleTogglePath,
    handleLoadMoreDirectory,
  };
}

export function useWorkspaceDebugPreviewState({
  sessionId,
  open,
  active,
  runtimeReady,
  runtimeStarting,
  onEnsureRuntime,
  runtimeSwitchBlocked = false,
}: {
  sessionId?: string | null;
  open: boolean;
  active: boolean;
  runtimeReady?: boolean;
  runtimeStarting?: boolean;
  onEnsureRuntime?: () => Promise<void>;
  runtimeSwitchBlocked?: boolean;
}) {
  const [debugInfo, setDebugInfo] = useState<TaskCreationDebugInfo | null>(
    null,
  );
  const [debugLoading, setDebugLoading] = useState(false);
  const [debugStarting, setDebugStarting] = useState(false);
  const [debugError, setDebugError] = useState<string | null>(null);
  const debugRuntimeBootRef = useRef(false);
  const debugPollRef = useRef<number | null>(null);
  const ensureRuntimeRef = useRef(runtimeSwitchBlocked ? undefined : onEnsureRuntime);

  useEffect(() => {
    ensureRuntimeRef.current = runtimeSwitchBlocked ? undefined : onEnsureRuntime;
  }, [onEnsureRuntime, runtimeSwitchBlocked]);

  useEffect(() => {
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
      debugRuntimeBootRef.current = false;
    }
  }, [runtimeReady]);

  useEffect(() => {
    if (!open || !active) return;
    if (!sessionId) {
      setDebugInfo(null);
      setDebugError(i18n.t("previewPanel.debug.missingSession"));
      return;
    }
    if (runtimeReady === false) {
      setDebugInfo(null);
      setDebugError(null);
      if (
        ensureRuntimeRef.current &&
        !runtimeStarting &&
        !debugRuntimeBootRef.current
      ) {
        debugRuntimeBootRef.current = true;
        setDebugStarting(true);
        ensureRuntimeRef.current()
          .catch(() => undefined)
          .finally(() => {
            setDebugStarting(false);
          });
      }
      return;
    }
    let cancelled = false;
    const scheduleDebugPoll = (
      silent = true,
      delayMs = DEBUG_POLL_STARTING_MS,
    ) => {
      if (debugPollRef.current) {
        window.clearTimeout(debugPollRef.current);
      }
      debugPollRef.current = window.setTimeout(() => {
        if (!cancelled) {
          void loadDebug(silent);
        }
      }, delayMs);
    };
    const loadDebug = async (silent = false) => {
      if (!silent) {
        setDebugLoading(true);
      }
      try {
        const info = await getTaskCreationDebugInfo(sessionId);
        if (!cancelled) {
          setDebugInfo(info);
          setDebugError(null);
          if (!info?.ready || info?.status === "starting") {
            scheduleDebugPoll(true, DEBUG_POLL_STARTING_MS);
          } else {
            scheduleDebugPoll(true, DEBUG_POLL_READY_MS);
          }
        }
      } catch (error) {
        if (cancelled) return;
        const message =
          error instanceof Error
            ? error.message
            : i18n.t("previewPanel.debug.loadFailed");
        setDebugError(message);
        if (isRetryableDebugError(message)) {
          scheduleDebugPoll(true, DEBUG_POLL_RETRY_MS);
        }
      } finally {
        if (cancelled) return;
        if (!silent) {
          setDebugLoading(false);
        }
      }
    };
    void loadDebug(false);
    return () => {
      cancelled = true;
      if (debugPollRef.current) {
        window.clearTimeout(debugPollRef.current);
        debugPollRef.current = null;
      }
    };
  }, [open, active, sessionId, runtimeReady, runtimeStarting]);

  const refreshDebug = async () => {
    if (!sessionId) {
      setDebugError(i18n.t("previewPanel.debug.missingSession"));
      return;
    }
    setDebugLoading(true);
    setDebugError(null);
    try {
      const info = await getTaskCreationDebugInfo(sessionId);
      setDebugInfo(info);
    } catch (error) {
      setDebugError(
        error instanceof Error
          ? error.message
          : i18n.t("previewPanel.debug.loadFailed"),
      );
    } finally {
      setDebugLoading(false);
    }
  };

  return {
    debugInfo,
    debugLoading,
    debugStarting,
    debugError,
    refreshDebug,
    setDebugError,
    setDebugStarting,
  };
}

export default function OpencodePreviewPanel({
  messages,
  sessionId,
  open,
  onToggle,
  maximized = false,
  onToggleMaximized,
  activeTab,
  onTabChange,
  selectedDiffId: controlledSelectedDiffId,
  onSelectDiff,
  runtimeReady,
  runtimeStarting,
  onEnsureRuntime,
  runtimeSwitchBlocked = false,
  onRequestStartDebugByMessage,
  onRequestDeployByMessage,
  onRequestRedeployByMessage,
  onRequestRollbackByMessage,
  className,
  selectedWorkspacePath,
}: OpencodePreviewPanelProps) {
  useTranslation();
  const { diffItems } = useMemo(() => buildPreviewItems(messages), [messages]);

  const [internalTab, setInternalTab] = useState<PreviewTab>("files");
  const [internalSelectedDiffId, setInternalSelectedDiffId] = useState<
    string | null
  >(null);
  const [autoDiff, setAutoDiff] = useState(true);
  const [deploymentInfo, setDeploymentInfo] =
    useState<TaskCreationDeploymentInfo | null>(null);
  const [deploymentTemplateBaseline, setDeploymentTemplateBaseline] =
    useState<TaskCreationDeploymentTemplateBaseline | null>(null);
  const [deploymentLoading, setDeploymentLoading] = useState(false);
  const [deploymentError, setDeploymentError] = useState<string | null>(null);
  const [deploymentTemplateLoading, setDeploymentTemplateLoading] =
    useState(false);
  const [deploymentTemplateError, setDeploymentTemplateError] = useState<
    string | null
  >(null);
  const [deploymentAction, setDeploymentAction] = useState<
    "deploy" | "redeploy" | "rollback" | null
  >(null);
  const [deploymentTokenRotating, setDeploymentTokenRotating] = useState(false);
  const [selectedDeploymentId, setSelectedDeploymentId] = useState<
    string | null
  >(null);
  const deploymentPollRef = useRef<number | null>(null);
  const currentTab = activeTab ?? internalTab;
  const effectiveEnsureRuntime = runtimeSwitchBlocked ? undefined : onEnsureRuntime;
  const runtimeSwitchBlockedMessage = i18n.t("previewPanel.runtimeSwitchBlocked");
  const deploymentBlockedMessage = i18n.t("previewPanel.deployment.blockedDuringRun");
  const filePreview = useWorkspaceFilePreviewState({
    messages,
    sessionId,
    open,
    runtimeReady,
    runtimeStarting,
    onEnsureRuntime: effectiveEnsureRuntime,
    runtimeSwitchBlocked,
    selectedWorkspacePath,
    diffItems,
  });
  const debugPreview = useWorkspaceDebugPreviewState({
    sessionId,
    open,
    active: currentTab === "debug",
    runtimeReady,
    runtimeStarting,
    onEnsureRuntime: effectiveEnsureRuntime,
    runtimeSwitchBlocked,
  });

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
    } else if (
      selectedDiffId &&
      !diffItems.find((item) => item.id === selectedDiffId)
    ) {
      const latest = diffItems[diffItems.length - 1];
      setSelectedDiffId(latest ? latest.id : null);
    }
  }, [autoDiff, diffItems, open, selectedDiffId, controlledSelectedDiffId]);

  useEffect(() => {
    if (deploymentPollRef.current) {
      window.clearTimeout(deploymentPollRef.current);
      deploymentPollRef.current = null;
    }
    setDeploymentInfo(null);
    setDeploymentError(null);
    setDeploymentLoading(false);
    setDeploymentTemplateBaseline(null);
    setDeploymentTemplateError(null);
    setDeploymentTemplateLoading(false);
    setDeploymentAction(null);
    setDeploymentTokenRotating(false);
    setSelectedDeploymentId(null);
  }, [sessionId]);

  useEffect(() => {
    if (!open) return;
    if (currentTab !== "deployment") return;
    if (!sessionId) {
      setDeploymentInfo(null);
      setDeploymentError(i18n.t("previewPanel.deployment.missingSession"));
      return;
    }
    if (runtimeSwitchBlocked) {
      setDeploymentInfo(null);
      setDeploymentError(deploymentBlockedMessage);
      setDeploymentLoading(false);
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

    const loadDeployment = async (
      silent: boolean = false,
      deploymentId?: string,
    ) => {
      if (!silent) {
        setDeploymentLoading(true);
      }
      setDeploymentError(null);
      try {
        const info = await getTaskCreationDeploymentInfo(
          sessionId,
          deploymentId || selectedDeploymentId || undefined,
        );
        if (cancelled) return;
        setDeploymentInfo(info);
        setSelectedDeploymentId(info?.deploymentId || null);
        schedulePoll(Boolean(info?.activeDeploymentPending));
      } catch (error) {
        if (cancelled) return;
        const message =
          error instanceof Error
            ? error.message
            : i18n.t("previewPanel.deployment.loadInfoFailed");
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
  }, [currentTab, deploymentBlockedMessage, open, runtimeSwitchBlocked, sessionId]);

  useEffect(() => {
    if (!open || currentTab !== "deployment" || !sessionId) return;
    if (runtimeSwitchBlocked) return;
    if (!deploymentInfo?.activeDeploymentPending) return;
    if (deploymentPollRef.current) {
      window.clearTimeout(deploymentPollRef.current);
    }
    deploymentPollRef.current = window.setTimeout(() => {
      void refreshDeployment(
        selectedDeploymentId || deploymentInfo.deploymentId || undefined,
      );
    }, 4000);
    return () => {
      if (deploymentPollRef.current) {
        window.clearTimeout(deploymentPollRef.current);
        deploymentPollRef.current = null;
      }
    };
  }, [
    open,
    currentTab,
    sessionId,
    deploymentInfo?.activeDeploymentPending,
    deploymentInfo?.deploymentId,
    runtimeSwitchBlocked,
    selectedDeploymentId,
  ]);

  useEffect(() => {
    if (!open) return;
    if (currentTab !== "deployment") return;
    if (!sessionId) {
      setDeploymentTemplateBaseline(null);
      setDeploymentTemplateError(i18n.t("previewPanel.deployment.missingSession"));
      return;
    }
    if (runtimeSwitchBlocked) {
      setDeploymentTemplateBaseline(null);
      setDeploymentTemplateError(deploymentBlockedMessage);
      setDeploymentTemplateLoading(false);
      return;
    }

    let cancelled = false;

    const loadTemplateBaseline = async () => {
      setDeploymentTemplateLoading(true);
      setDeploymentTemplateError(null);
      try {
        const baseline =
          await getTaskCreationDeploymentTemplateBaseline(sessionId);
        if (cancelled) return;
        setDeploymentTemplateBaseline(baseline);
      } catch (error) {
        if (cancelled) return;
        setDeploymentTemplateError(
          error instanceof Error
            ? error.message
            : i18n.t("previewPanel.deployment.loadTemplateBaselineFailed"),
        );
      } finally {
        if (!cancelled) {
          setDeploymentTemplateLoading(false);
        }
      }
    };

    void loadTemplateBaseline();
    return () => {
      cancelled = true;
    };
  }, [currentTab, deploymentBlockedMessage, open, runtimeSwitchBlocked, sessionId]);

  if (!open) return null;

  const currentDiff =
    diffItems.find((item) => item.id === selectedDiffId) || null;
  const treeCount = filePreview.effectiveTree?.items.length || 0;

  const refreshDeployment = async (deploymentId?: string) => {
    if (runtimeSwitchBlocked) {
      setDeploymentError(deploymentBlockedMessage);
      return;
    }
    if (!sessionId) {
      setDeploymentError(i18n.t("previewPanel.deployment.missingSession"));
      return;
    }
    void refreshDeploymentTemplateBaseline();
    setDeploymentLoading(true);
    setDeploymentError(null);
    try {
      const info = await getTaskCreationDeploymentInfo(
        sessionId,
        deploymentId || selectedDeploymentId || undefined,
      );
      setDeploymentInfo(info);
      setSelectedDeploymentId(info?.deploymentId || deploymentId || null);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : i18n.t("previewPanel.deployment.loadInfoFailed");
      setDeploymentError(message);
    } finally {
      setDeploymentLoading(false);
    }
  };

  const refreshDeploymentTemplateBaseline = async () => {
    if (runtimeSwitchBlocked) {
      setDeploymentTemplateError(deploymentBlockedMessage);
      return;
    }
    if (!sessionId) {
      setDeploymentTemplateError(i18n.t("previewPanel.deployment.missingSession"));
      return;
    }
    setDeploymentTemplateLoading(true);
    setDeploymentTemplateError(null);
    try {
      const baseline = await getTaskCreationDeploymentTemplateBaseline(sessionId);
      setDeploymentTemplateBaseline(baseline);
    } catch (error) {
      setDeploymentTemplateError(
        error instanceof Error
          ? error.message
          : i18n.t("previewPanel.deployment.loadTemplateBaselineFailed"),
      );
    } finally {
      setDeploymentTemplateLoading(false);
    }
  };

  const runDeploymentAction = async (
    action: "deploy" | "redeploy" | "rollback",
  ) => {
    if (runtimeSwitchBlocked) {
      setDeploymentError(deploymentBlockedMessage);
      return;
    }
    if (!sessionId) {
      setDeploymentError(i18n.t("previewPanel.deployment.missingSession"));
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
        void refreshDeploymentTemplateBaseline();
        setDeploymentAction(null);
        return;
      }
      setDeploymentError(i18n.t("previewPanel.deployment.missingMessageEntry"));
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : i18n.t("previewPanel.deployment.actionFailed");
      setDeploymentError(message);
    } finally {
      setDeploymentAction(null);
    }
  };

  const rotateDeploymentToken = async () => {
    if (runtimeSwitchBlocked) {
      setDeploymentError(deploymentBlockedMessage);
      return;
    }
    if (!sessionId) {
      setDeploymentError(i18n.t("previewPanel.deployment.missingSession"));
      return;
    }
    setDeploymentTokenRotating(true);
    setDeploymentError(null);
    try {
      const result = await rotateTaskCreationDeploymentToken(sessionId);
      setDeploymentInfo(result);
      void refreshDeploymentTemplateBaseline();
      setSelectedDeploymentId(result?.deploymentId || selectedDeploymentId || null);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : i18n.t("previewPanel.deployment.rotateTokenFailed");
      setDeploymentError(message);
    } finally {
      setDeploymentTokenRotating(false);
    }
  };

  return (
    <aside
      className={cn(
        "w-full h-full shrink-0 rounded-xl border border-border/70 bg-card flex flex-col min-h-0",
        className,
      )}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          {i18n.t("previewPanel.contentPreview")}
          <span className="text-xs text-muted-foreground">
            {treeCount + diffItems.length}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleMaximized}
            className="h-7 rounded-full"
          >
            {maximized ? i18n.t("previewPanel.restore") : i18n.t("common.expand")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggle}
            className="h-7 rounded-full"
          >
            {i18n.t("common.collapse")}
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground border-b border-border">
        <button
          type="button"
          onClick={() => {
            onTabChange?.("files");
            if (!onTabChange) setInternalTab("files");
          }}
          className={
            currentTab === "files" ? "text-foreground font-semibold" : ""
          }
        >
          {i18n.t("previewPanel.tabs.files")}
        </button>
        <span>/</span>
        <button
          type="button"
          onClick={() => {
            onTabChange?.("changes");
            if (!onTabChange) setInternalTab("changes");
          }}
          className={
            currentTab === "changes" ? "text-foreground font-semibold" : ""
          }
        >
          {i18n.t("previewPanel.tabs.changes")}
        </button>
        <span>/</span>
        <button
          type="button"
          onClick={() => {
            onTabChange?.("debug");
            if (!onTabChange) setInternalTab("debug");
          }}
          className={
            currentTab === "debug" ? "text-foreground font-semibold" : ""
          }
        >
          {i18n.t("previewPanel.tabs.debug")}
        </button>
        <span>/</span>
        <button
          type="button"
          onClick={() => {
            onTabChange?.("deployment");
            if (!onTabChange) setInternalTab("deployment");
          }}
          className={
            currentTab === "deployment" ? "text-foreground font-semibold" : ""
          }
        >
          {i18n.t("previewPanel.tabs.deployment")}
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden relative">
        <div
          className={cn(
            "absolute inset-0 h-full w-full transition-opacity",
            currentTab === "files"
              ? "opacity-100 pointer-events-auto"
              : "opacity-0 pointer-events-none",
          )}
          aria-hidden={currentTab !== "files"}
        >
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
            runtimeSwitchBlocked={runtimeSwitchBlocked}
          />
        </div>
        <div
          className={cn(
            "absolute inset-0 h-full w-full transition-opacity",
            currentTab === "changes"
              ? "opacity-100 pointer-events-auto"
              : "opacity-0 pointer-events-none",
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
            currentTab === "deployment"
              ? "opacity-100 pointer-events-auto"
              : "opacity-0 pointer-events-none",
          )}
          aria-hidden={currentTab !== "deployment"}
        >
          <DeploymentPreview
            sessionId={sessionId}
            info={deploymentInfo}
            templateBaseline={deploymentTemplateBaseline}
            templateBaselineLoading={deploymentTemplateLoading}
            templateBaselineError={deploymentTemplateError}
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
            tokenRotationLoading={deploymentTokenRotating}
            onRotateDeploymentToken={() => void rotateDeploymentToken()}
          />
        </div>
        <div
          className={cn(
            "absolute inset-0 h-full w-full transition-opacity",
            currentTab === "debug"
              ? "opacity-100 pointer-events-auto"
              : "opacity-0 pointer-events-none",
          )}
          aria-hidden={currentTab !== "debug"}
        >
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
                  debugPreview.setDebugError(runtimeSwitchBlockedMessage);
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
  if (value && typeof value === "object")
    return value as Record<string, unknown>;
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

function formatMetricCount(value?: number | null, fallback: string = "--") {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return new Intl.NumberFormat(i18n.language === "zh" ? "zh-CN" : "en-US").format(
    value,
  );
}

function getDeploymentAnalyticsPresentation(
  analytics: TaskCreationDeploymentInfo["analytics"] | null | undefined,
  hasPrimaryUrl: boolean,
) {
  if (!hasPrimaryUrl) {
    return {
      integrationValue: i18n.t("previewPanel.analytics.waitingSiteLive"),
      integrationSubtitle: i18n.t("previewPanel.analytics.waitingSiteLiveBind"),
      trafficValue: i18n.t("previewPanel.analytics.waitingSiteLive"),
      trafficSubtitle: i18n.t("previewPanel.analytics.waitingTrafficData"),
      realtimeValue: i18n.t("previewPanel.analytics.waitingSiteLive"),
      realtimeSubtitle: i18n.t("previewPanel.analytics.waitingRealtimeData"),
    };
  }

  if (!analytics) {
    return {
      integrationValue: i18n.t("previewPanel.analytics.pending"),
      integrationSubtitle: i18n.t("previewPanel.analytics.pendingBind"),
      trafficValue: i18n.t("previewPanel.analytics.pending"),
      trafficSubtitle: i18n.t("previewPanel.analytics.pendingTraffic"),
      realtimeValue: i18n.t("previewPanel.analytics.pending"),
      realtimeSubtitle: i18n.t("previewPanel.analytics.pendingRealtime"),
    };
  }

  if (analytics.status === "tracking") {
    return {
      integrationValue: i18n.t("previewPanel.analytics.tracking"),
      integrationSubtitle:
        analytics.message || i18n.t("previewPanel.analytics.trackingDefault"),
      trafficValue: formatMetricCount(analytics.pageviews, "0"),
      trafficSubtitle: `Visits ${formatMetricCount(analytics.visits, "0")} / Visitors ${formatMetricCount(analytics.visitors, "0")}`,
      realtimeValue: formatMetricCount(analytics.activeVisitors, "0"),
      realtimeSubtitle:
        analytics.updatedAt
          ? i18n.t("previewPanel.analytics.recentUpdate", {
              time:
                formatPreviewTimestamp(analytics.updatedAt) || analytics.updatedAt,
            })
          : i18n.t("previewPanel.analytics.realtimeFromUmami"),
    };
  }

  if (analytics.status === "bound") {
    return {
      integrationValue: i18n.t("previewPanel.analytics.bound"),
      integrationSubtitle:
        analytics.message || i18n.t("previewPanel.analytics.boundDefault"),
      trafficValue: formatMetricCount(analytics.pageviews, "0"),
      trafficSubtitle: i18n.t("previewPanel.analytics.boundTraffic"),
      realtimeValue: formatMetricCount(analytics.activeVisitors, "0"),
      realtimeSubtitle: i18n.t("previewPanel.analytics.boundRealtime"),
    };
  }

  if (analytics.status === "error") {
    return {
      integrationValue: i18n.t("previewPanel.analytics.readFailed"),
      integrationSubtitle:
        analytics.error ||
        analytics.message ||
        i18n.t("previewPanel.analytics.readFailedDefault"),
      trafficValue: i18n.t("previewPanel.analytics.readFailed"),
      trafficSubtitle: i18n.t("previewPanel.analytics.readFailedTraffic"),
      realtimeValue: i18n.t("previewPanel.analytics.readFailed"),
      realtimeSubtitle: i18n.t("previewPanel.analytics.readFailedRealtime"),
    };
  }

  if (analytics.status === "unconfigured") {
    return {
      integrationValue: i18n.t("previewPanel.analytics.unconfigured"),
      integrationSubtitle:
        analytics.message ||
        i18n.t("previewPanel.analytics.unconfiguredDefault"),
      trafficValue: i18n.t("previewPanel.analytics.unconfigured"),
      trafficSubtitle: i18n.t("previewPanel.analytics.unconfiguredTraffic"),
      realtimeValue: i18n.t("previewPanel.analytics.unconfigured"),
      realtimeSubtitle: i18n.t("previewPanel.analytics.unconfiguredRealtime"),
    };
  }

  if (analytics.status === "pending_domain") {
    return {
      integrationValue: i18n.t("previewPanel.analytics.pendingDomain"),
      integrationSubtitle:
        analytics.message ||
        i18n.t("previewPanel.analytics.pendingDomainDefault"),
      trafficValue: i18n.t("previewPanel.analytics.pendingDomain"),
      trafficSubtitle: i18n.t("previewPanel.analytics.pendingDomainTraffic"),
      realtimeValue: i18n.t("previewPanel.analytics.pendingDomain"),
      realtimeSubtitle: i18n.t("previewPanel.analytics.pendingDomainRealtime"),
    };
  }

  return {
    integrationValue: i18n.t("previewPanel.analytics.pending"),
    integrationSubtitle:
      analytics.message || i18n.t("previewPanel.analytics.siteReadyPending"),
    trafficValue: i18n.t("previewPanel.analytics.pending"),
    trafficSubtitle: i18n.t("previewPanel.analytics.noAggregateData"),
    realtimeValue: i18n.t("previewPanel.analytics.pending"),
    realtimeSubtitle: i18n.t("previewPanel.analytics.noRealtimeData"),
  };
}

function shouldRefreshFromMessage(message: AgentMessage | undefined): boolean {
  if (!message) return false;
  if (message.type === "executor_event") {
    const metadata = toRecord(message.metadata);
    if (asText(metadata.executor).toLowerCase() !== "codex") return false;
    const event = toRecord(metadata.event);
    const item = toRecord(event.item);
    const eventType = asText(metadata.eventType).toLowerCase();
    const itemType =
      asText(metadata.itemType).toLowerCase() || asText(item.type).toLowerCase();
    return eventType === "item.completed" && itemType === "file_change";
  }
  if (message.type !== "opencode_event") return false;
  const metadata = toRecord(message.metadata);
  const event = toRecord(metadata.event);
  const rawPayload = toRecord(metadata.rawPayload);
  const rawEvent = toRecord(rawPayload.event);
  const eventType = (
    asText(metadata.eventType) ||
    asText(event.type) ||
    asText(rawEvent.type)
  ).toLowerCase();
  if (eventType.startsWith("file.") || eventType === "session.diff")
    return true;
  const properties = toRecord(event.properties);
  const part = toRecord(properties.part);
  const tool = (
    asText(part.tool) ||
    asText(part.name) ||
    asText(properties.tool)
  ).toLowerCase();
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

function detectProjectRootPrefix(items: WorkspaceTreeItem[]): string | null {
  const filePaths = items
    .filter((item) => item.type === "file")
    .map((item) => item.path.replace(/\\/g, "/").replace(/^\/+/, ""))
    .filter(Boolean);
  if (filePaths.length > 0) {
    const firstSegments = filePaths
      .map((path) => path.split("/").filter(Boolean))
      .filter((segments) => segments.length > 1)
      .map((segments) => segments[0]);
    if (firstSegments.length === filePaths.length) {
      const first = firstSegments[0];
      const same = firstSegments.every((segment) => segment === first);
      if (same && first) {
        return first;
      }
    }
    return null;
  }

  const rootDirs = items
    .filter((item) => item.type === "dir")
    .map((item) => item.path.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, ""))
    .filter((path) => path && !path.includes("/"));
  if (rootDirs.length === 1) {
    return rootDirs[0] || null;
  }
  return null;
}

function getWorkspacePathBasename(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
}

function getWorkspacePathExt(path: string): string {
  const base = getWorkspacePathBasename(path).toLowerCase();
  const lastDot = base.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === base.length - 1) return "";
  return base.slice(lastDot + 1);
}

function formatWorkspaceFileSize(size?: number): string {
  if (!Number.isFinite(size) || typeof size !== "number" || size < 0) {
    return i18n.t("previewPanel.unknownSize");
  }
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function resolveTreeNodeIcon(node: TreeNode, isOpen: boolean) {
  if (node.type === "dir") {
    return isOpen ? FolderOpen : Folder;
  }
  const ext = getWorkspacePathExt(node.path);
  if (ext === "html" || ext === "htm") return Globe2;
  if (ext === "md" || ext === "markdown" || ext === "mdx") return ScrollText;
  if (
    ext === "png" ||
    ext === "jpg" ||
    ext === "jpeg" ||
    ext === "gif" ||
    ext === "webp" ||
    ext === "bmp" ||
    ext === "svg"
  ) {
    return FileImage;
  }
  if (ext === "mp4" || ext === "webm" || ext === "mov" || ext === "m4v") {
    return FileVideo;
  }
  if (ext === "mp3" || ext === "wav" || ext === "ogg" || ext === "m4a") {
    return FileAudio;
  }
  if (ext === "pdf") return FileType2;
  if (ext === "json") return FileJson2;
  if (
    ext === "ts" ||
    ext === "tsx" ||
    ext === "js" ||
    ext === "jsx" ||
    ext === "py" ||
    ext === "go" ||
    ext === "java" ||
    ext === "rs" ||
    ext === "css" ||
    ext === "scss" ||
    ext === "sql" ||
    ext === "sh" ||
    ext === "bash" ||
    ext === "zsh"
  ) {
    return FileCode2;
  }
  if (ext === "txt" || ext === "log" || ext === "yaml" || ext === "yml" || ext === "toml" || ext === "xml") {
    return FileText;
  }
  return File;
}

async function writeClipboardTextSafely(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

function triggerFileDownload(url: string, filename: string) {
  if (!url) return;
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener noreferrer";
  anchor.target = "_blank";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

function buildWorkspaceTreeFromDiffItems(
  sessionId: string | null | undefined,
  diffItems: PreviewDiffItem[],
): WorkspaceTree | null {
  if (!sessionId || diffItems.length === 0) return null;
  const normalizePath = (value: string) =>
    normalizeWorkspaceRelativePath(value, sessionId);
  const filePaths = new Set<string>();
  const dirPaths = new Set<string>();

  diffItems.forEach((item) => {
    if (item.canonicalFile) {
      const normalized = normalizePath(item.canonicalFile);
      if (normalized) filePaths.add(normalized);
    }
    (item.files || []).forEach((file) => {
      const normalized = normalizePath(file.file || "");
      if (normalized) filePaths.add(normalized);
    });
  });

  for (const filePath of Array.from(filePaths)) {
    const parts = filePath.split("/").filter(Boolean);
    let current = "";
    for (let i = 0; i < parts.length - 1; i += 1) {
      current = current ? `${current}/${parts[i]}` : parts[i]!;
      dirPaths.add(current);
    }
  }

  const items: WorkspaceTreeItem[] = [
    ...Array.from(dirPaths).map((path) => ({ path, type: "dir" as const })),
    ...Array.from(filePaths).map((path) => ({ path, type: "file" as const })),
  ].sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.path.localeCompare(b.path);
  });

  if (items.length === 0) return null;
  return {
    root: `/home/user/opencode/workspaces/${sessionId}`,
    items,
  };
}

function mergeWorkspaceTrees(
  sessionId: string | null | undefined,
  primary: WorkspaceTree | null | undefined,
  secondary: WorkspaceTree | null | undefined,
): WorkspaceTree | null {
  const allItems = [...(primary?.items || []), ...(secondary?.items || [])];
  if (allItems.length === 0) return null;
  const byPath = new Map<string, WorkspaceTreeItem>();
  allItems.forEach((item) => {
    const normalized = normalizeWorkspaceRelativePath(item.path, sessionId);
    if (!normalized) return;
    byPath.set(normalized, {
      path: normalized,
      type: item.type === "dir" ? "dir" : "file",
    });
  });
  const items = Array.from(byPath.values()).sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.path.localeCompare(b.path);
  });
  if (items.length === 0) return null;
  return {
    root:
      primary?.root ||
      secondary?.root ||
      (sessionId ? `/home/user/opencode/workspaces/${sessionId}` : ""),
    items,
  };
}

export function FilePreview({
  sessionId,
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
  runtimeSwitchBlocked = false,
}: {
  sessionId?: string | null;
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
  runtimeSwitchBlocked?: boolean;
}) {
  const [htmlView, setHtmlView] = useState<"preview" | "source">("preview");
  const [htmlPreviewState, setHtmlPreviewState] =
    useState<WorkspaceHtmlPreviewState>("checking");
  const [htmlPreviewMessage, setHtmlPreviewMessage] = useState("");
  const [htmlPreviewReloading, setHtmlPreviewReloading] = useState(false);
  const [htmlPreviewNonce, setHtmlPreviewNonce] = useState(0);
  const [deploymentPreviewUrl, setDeploymentPreviewUrl] = useState("");
  const [copiedKey, setCopiedKey] = useState<"path" | "content" | null>(null);
  const runtimeSwitchBlockedMessage = i18n.t("previewPanel.runtimeSwitchBlocked");

  const previewType = file?.previewType || "text";
  const mimeType = file?.mimeType || "application/octet-stream";
  const isBinary = Boolean(file?.isBinary);
  const selectedFilename = selectedPath
    ? getWorkspacePathBasename(selectedPath)
    : "";
  const selectedRawUrl =
    sessionId && selectedPath
      ? getWorkspaceRawFileUrl(sessionId, selectedPath)
      : "";
  const selectedExternalUrl =
    previewType === "html" && deploymentPreviewUrl ? deploymentPreviewUrl : selectedRawUrl;
  const pathSegments = selectedPath ? selectedPath.split("/").filter(Boolean) : [];
  const htmlPreviewUrl =
    previewType === "html"
      ? deploymentPreviewUrl ||
        (sessionId && selectedPath
          ? getWorkspaceRawFileUrl(sessionId, selectedPath)
          : "")
      : "";
  const htmlPreviewUsesDeployment = Boolean(previewType === "html" && deploymentPreviewUrl);
  const htmlPreviewEnabled = Boolean(
    !loading &&
      !error &&
      selectedPath &&
      previewType === "html" &&
      !isBinary &&
      htmlView === "preview" &&
      (htmlPreviewUsesDeployment ||
        (runtimeReady &&
          tree &&
          tree.items.length > 0 &&
          sessionId)),
      );
  const effectiveHtmlPreviewUrl = appendPreviewCacheBust(
    htmlPreviewUrl,
    htmlPreviewNonce,
  );
  const hasWorkspacePreviewState = Boolean(
    loading ||
      contentLoading ||
      selectedPath ||
      file ||
      contentError ||
      error ||
      (tree && tree.items.length > 0),
  );

  useEffect(() => {
    if (!sessionId || previewType !== "html") {
      setDeploymentPreviewUrl("");
      return;
    }
    if (runtimeSwitchBlocked) {
      setDeploymentPreviewUrl("");
      return;
    }
    let cancelled = false;
    getTaskCreationDeploymentInfo(sessionId)
      .then((info) => {
        if (cancelled) return;
        setDeploymentPreviewUrl(resolveFilePreviewDeploymentUrl(info));
      })
      .catch(() => {
        if (cancelled) return;
        setDeploymentPreviewUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [previewType, runtimeSwitchBlocked, sessionId]);

  useEffect(() => {
    setHtmlView("preview");
    if (htmlPreviewUsesDeployment) {
      setHtmlPreviewState("ready");
      setHtmlPreviewMessage("");
      return;
    }
    setHtmlPreviewState("checking");
    setHtmlPreviewMessage("");
    setHtmlPreviewNonce(Date.now());
  }, [htmlPreviewUsesDeployment, selectedPath]);

  useEffect(() => {
    if (
      !htmlPreviewEnabled ||
      htmlPreviewUsesDeployment ||
      !sessionId ||
      !selectedPath
    ) {
      return;
    }
    let cancelled = false;
    setHtmlPreviewState("checking");
    setHtmlPreviewMessage("");
    void checkWorkspaceHtmlPreviewReady(sessionId, selectedPath).then((mapped) => {
      if (cancelled) return;
      setHtmlPreviewState(mapped.state);
      setHtmlPreviewMessage(mapped.message);
    });
    return () => {
      cancelled = true;
    };
  }, [htmlPreviewEnabled, htmlPreviewUsesDeployment, selectedPath, sessionId]);

  const reloadHtmlPreview = async () => {
    if (!sessionId || !selectedPath || htmlPreviewReloading) return;
    if (runtimeSwitchBlocked) {
      setHtmlPreviewState("fetch_failed");
      setHtmlPreviewMessage(runtimeSwitchBlockedMessage);
      return;
    }
    setHtmlPreviewReloading(true);
    setHtmlPreviewState("checking");
    setHtmlPreviewMessage("");
    try {
      await startTaskCreationRuntime(sessionId);
      const mapped = await waitWorkspaceHtmlPreviewReady(sessionId, selectedPath, {
        attempts: 8,
        intervalMs: 600,
      });
      setHtmlPreviewState(mapped.state);
      setHtmlPreviewMessage(mapped.message);
      if (mapped.state === "ready") {
        setHtmlPreviewNonce(Date.now());
      }
    } catch {
      setHtmlPreviewState("fetch_failed");
      setHtmlPreviewMessage(i18n.t("previewPanel.previewRestoreFailed"));
    } finally {
      setHtmlPreviewReloading(false);
    }
  };

  const copyPath = async (path: string) => {
    const copied = await writeClipboardTextSafely(path);
    if (!copied) return;
    setCopiedKey("path");
    window.setTimeout(() => {
      setCopiedKey((current) => (current === "path" ? null : current));
    }, 1200);
  };

  const copyContent = async () => {
    if (!file || isBinary) return;
    const copied = await writeClipboardTextSafely(file.content || "");
    if (!copied) return;
    setCopiedKey("content");
    window.setTimeout(() => {
      setCopiedKey((current) => (current === "content" ? null : current));
    }, 1200);
  };

  if (!runtimeReady && !hasWorkspacePreviewState) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-xs text-muted-foreground gap-2">
        <span>{i18n.t("previewPanel.filePreviewNotLoaded")}</span>
        <Button
          variant="outline"
          size="sm"
          onClick={onRefresh}
          disabled={runtimeStarting}
        >
          {runtimeStarting ? (
            <>
              <WorkspaceFileLoadGlyph className="mr-1.5 h-3.5 w-3.5" />
              {i18n.t("common.loading")}
            </>
          ) : (
            i18n.t("previewPanel.loadFiles")
          )}
        </Button>
      </div>
    );
  }
  if (loading) {
    return <WorkspaceFileLoadingState text={i18n.t("previewPanel.loadingFileTree")} />;
  }
  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-xs text-muted-foreground gap-2">
        <span>{error}</span>
        <Button variant="outline" size="sm" onClick={onRefresh}>
          {i18n.t("previewPanel.retry")}
        </Button>
      </div>
    );
  }
  const previewTree =
    tree && tree.items.length > 0
      ? tree
      : selectedPath
        ? {
            root: tree?.root || "",
            items: [{ path: selectedPath, type: "file" as const }],
          }
        : null;

  if (!previewTree || previewTree.items.length === 0) {
    return <EmptyState text={i18n.t("previewPanel.noFiles")} />;
  }

  const nodes = buildTree(previewTree.items);
  const projectPrefix = detectProjectRootPrefix(previewTree.items);
  const projectNode =
    projectPrefix && nodes.length > 0
      ? nodes.find((node) => node.type === "dir" && node.path === projectPrefix) || null
      : null;
  const renderNodes = projectNode ? projectNode.children : nodes;
  const lineCount = file?.content ? file.content.split("\n").length : 0;
  const rootDirState = dirState[""];
  const binaryDataUrl =
    file && file.encoding === "base64" && file.content
      ? `data:${mimeType};base64,${file.content}`
      : null;

  return (
    <ResizablePanelGroup direction="horizontal" className="h-full min-h-0">
      <ResizablePanel defaultSize={28} minSize={20} maxSize={45}>
        <div className="h-full min-h-0 overflow-auto overscroll-contain border-r border-border bg-[var(--fill-tsp-gray-main)]">
          <div className="space-y-1 p-2">
            {rootDirState?.hasMore ? (
              <button
                type="button"
                className="w-full rounded-md border border-transparent px-2 py-1 text-left text-[11px] text-[var(--brand-link)] transition-colors hover:border-[var(--brand-border)] hover:bg-[var(--brand-soft)] disabled:text-muted-foreground"
                onClick={() => onLoadMoreDir("")}
                disabled={Boolean(rootDirState.loading)}
              >
                {rootDirState.loading
                  ? i18n.t("common.loading")
                  : i18n.t("previewPanel.loadMoreRootItems")}
              </button>
            ) : null}
          </div>
          <div className="px-2 pb-3">
            <TreeList
              nodes={renderNodes}
              sessionId={sessionId}
              selectedPath={selectedPath}
              onSelectFile={onSelectFile}
              expandedPaths={expandedPaths}
              dirState={dirState}
              onTogglePath={onTogglePath}
              onLoadMoreDir={onLoadMoreDir}
              onCopyPath={copyPath}
            />
          </div>
        </div>
      </ResizablePanel>
      <ResizableHandle withHandle className="border-0 bg-transparent" />
      <ResizablePanel defaultSize={72} minSize={55}>
        <div className="h-full min-h-0 overflow-hidden bg-background p-3">
          {selectedPath ? (
            <div className="flex h-full min-h-0 flex-col rounded-lg border border-border bg-card">
              <div className="flex h-10 items-center justify-between gap-2 border-b border-border bg-muted/30 px-3">
                <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-[12px]">
                  {pathSegments.map((segment, index) => (
                    <div key={`${segment}-${index}`} className="flex min-w-0 items-center gap-1">
                      <span
                        className={cn(
                          "truncate",
                          index === pathSegments.length - 1
                            ? "font-medium text-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        {segment}
                      </span>
                      {index < pathSegments.length - 1 ? (
                        <span className="text-muted-foreground">/</span>
                      ) : null}
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-slate-200 hover:text-foreground disabled:opacity-40"
                    onClick={() => void copyPath(selectedPath)}
                    title={
                      copiedKey === "path"
                        ? i18n.t("previewPanel.copiedPath")
                        : i18n.t("previewPanel.copyPath")
                    }
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-slate-200 hover:text-foreground disabled:opacity-40"
                    onClick={() => void copyContent()}
                    disabled={!file || isBinary}
                    title={
                      copiedKey === "content"
                        ? i18n.t("previewPanel.copied")
                        : i18n.t("previewPanel.copyContent")
                    }
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-slate-200 hover:text-foreground disabled:opacity-40"
                    onClick={() =>
                      triggerFileDownload(selectedRawUrl, selectedFilename || "workspace-file")
                    }
                    disabled={!selectedRawUrl}
                    title={i18n.t("previewPanel.downloadFile")}
                  >
                    <Download className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-slate-200 hover:text-foreground disabled:opacity-40"
                    onClick={() =>
                      selectedExternalUrl
                        ? window.open(selectedExternalUrl, "_blank", "noopener,noreferrer")
                        : null
                    }
                    disabled={!selectedExternalUrl}
                    title={i18n.t("previewPanel.openInNewWindow")}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3 py-1.5 text-[11px] text-muted-foreground">
                <span className="truncate">{selectedPath}</span>
                <span className="shrink-0">
                  {isBinary
                    ? `${mimeType} · ${formatWorkspaceFileSize(file?.size)}`
                    : `${lineCount} ${i18n.t("homeWorkspace.linesUnit")} · ${mimeType}`}
                </span>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                {contentLoading ? (
                  <WorkspaceFileLoadingState text={i18n.t("common.loading")} />
                ) : previewType === "html" && !isBinary ? (
                  htmlView === "preview" ? (
                    <div className="h-full min-h-0 overflow-auto overscroll-contain p-3">
                      {htmlPreviewUrl ? (
                        htmlPreviewState === "ready" ? (
                          <iframe
                            src={effectiveHtmlPreviewUrl}
                            title={`preview-${selectedPath}`}
                            className="h-full min-h-[360px] w-full rounded-md border border-border bg-card"
                            sandbox={
                              htmlPreviewUsesDeployment
                                ? undefined
                                : "allow-same-origin allow-scripts allow-forms allow-popups allow-downloads"
                            }
                            onError={() => {
                              setHtmlPreviewState("fetch_failed");
                              setHtmlPreviewMessage(i18n.t("previewPanel.previewLoadFailed"));
                            }}
                          />
                        ) : (
                          <div className="flex h-full min-h-[360px] w-full flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border bg-muted/30 px-6 text-center">
                            {htmlPreviewState === "checking" ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                <div className="text-xs text-muted-foreground">{i18n.t("previewPanel.checkingPreviewEnvironment")}</div>
                              </>
                            ) : (
                              <>
                                <div className="text-sm text-foreground">
                                  {htmlPreviewMessage || i18n.t("previewPanel.htmlUnavailable")}
                                </div>
                                <div className="flex items-center gap-2">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => void reloadHtmlPreview()}
                                    disabled={htmlPreviewReloading}
                                  >
                                    {htmlPreviewReloading ? (
                                      <>
                                        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                                        {i18n.t("previewPanel.reloadingPreview")}
                                      </>
                                    ) : (
                                      i18n.t("previewPanel.reloadPreview")
                                    )}
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setHtmlView("source")}
                                  >
                                    {i18n.t("previewPanel.viewSource")}
                                  </Button>
                                </div>
                              </>
                            )}
                          </div>
                        )
                      ) : (
                        <div className="px-3 py-3 text-xs text-muted-foreground">
                          {i18n.t("previewPanel.htmlUnavailable")}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="h-full min-h-0 overflow-auto overscroll-contain bg-slate-950 text-slate-100">
                      <pre className="px-4 py-3 text-[12px] leading-5 whitespace-pre">
                        <code>{file?.content || ""}</code>
                      </pre>
                    </div>
                  )
                ) : previewType === "markdown" && !isBinary ? (
                  <div className="h-full min-h-0 overflow-auto overscroll-contain px-3 py-3 text-sm leading-7 text-foreground [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_strong]:font-semibold [&_pre]:my-3 [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-border [&_pre]:bg-muted/30 [&_pre]:p-3 [&_code]:font-mono">
                    <Streamdown>{file?.content || ""}</Streamdown>
                  </div>
                ) : previewType === "image" && binaryDataUrl ? (
                  <div className="h-full min-h-0 overflow-auto overscroll-contain p-3">
                    <img
                      src={binaryDataUrl}
                      alt={selectedPath}
                      className="max-h-full w-auto max-w-full rounded-md border border-border bg-muted/30"
                    />
                  </div>
                ) : previewType === "video" && binaryDataUrl ? (
                  <div className="h-full min-h-0 overflow-auto overscroll-contain p-3">
                    <video
                      src={binaryDataUrl}
                      controls
                      className="max-h-full w-full rounded-md border border-border bg-black"
                    />
                  </div>
                ) : previewType === "audio" && binaryDataUrl ? (
                  <div className="h-full min-h-0 overflow-auto overscroll-contain p-3">
                    <audio src={binaryDataUrl} controls className="w-full" />
                  </div>
                ) : previewType === "pdf" && binaryDataUrl ? (
                  <div className="h-full min-h-0 overflow-auto overscroll-contain p-3">
                    <iframe
                      title={`preview-${selectedPath}`}
                      src={binaryDataUrl}
                      className="h-full min-h-[360px] w-full rounded-md border border-border bg-card"
                    />
                  </div>
                ) : isBinary ? (
                  <div className="h-full min-h-0 overflow-auto overscroll-contain p-4">
                    <div className="rounded-lg border border-border bg-muted/40 p-4">
                      <div className="mb-3 text-sm font-medium text-foreground">
                        {i18n.t("previewPanel.binaryInfo")}
                      </div>
                      <dl className="grid gap-3 text-xs text-muted-foreground">
                        <div>
                          <dt className="text-muted-foreground">{i18n.t("previewPanel.filePath")}</dt>
                          <dd className="mt-0.5 break-all font-mono text-foreground">{selectedPath}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">{i18n.t("previewPanel.mimeType")}</dt>
                          <dd className="mt-0.5 font-mono text-foreground">{mimeType}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">{i18n.t("previewPanel.fileSize")}</dt>
                          <dd className="mt-0.5 text-foreground">{formatWorkspaceFileSize(file?.size)}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">{i18n.t("previewPanel.previewPolicy")}</dt>
                          <dd className="mt-0.5 text-foreground">
                            {file?.binaryTooLarge
                              ? i18n.t("previewPanel.binaryLargePreviewPolicy")
                              : i18n.t("previewPanel.binaryPreviewPolicy")}
                          </dd>
                        </div>
                      </dl>
                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            triggerFileDownload(selectedRawUrl, selectedFilename || "workspace-file")
                          }
                          disabled={!selectedRawUrl}
                        >
                          <Download className="mr-1.5 h-3.5 w-3.5" />
                          {i18n.t("previewPanel.downloadFile")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            selectedRawUrl
                              ? window.open(selectedRawUrl, "_blank", "noopener,noreferrer")
                              : null
                          }
                          disabled={!selectedRawUrl}
                        >
                          <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                          {i18n.t("previewPanel.openInNewWindow")}
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="h-full min-h-0 overflow-auto overscroll-contain bg-slate-950 text-slate-100">
                    <pre className="px-4 py-3 text-[12px] leading-5 whitespace-pre">
                      <code>{file?.content || ""}</code>
                    </pre>
                  </div>
                )}
              </div>
              {previewType === "html" && !isBinary ? (
                <div className="border-t border-border/70 px-3 py-1.5">
                  <div className="inline-flex items-center rounded-md border border-border bg-card p-0.5 text-[11px]">
                    <button
                      type="button"
                      className={cn(
                        "rounded px-2 py-0.5",
                        htmlView === "preview"
                          ? "bg-slate-900 text-white"
                          : "text-muted-foreground",
                      )}
                      onClick={() => setHtmlView("preview")}
                    >
                      Preview
                    </button>
                    <button
                      type="button"
                      className={cn(
                        "rounded px-2 py-0.5",
                        htmlView === "source"
                          ? "bg-slate-900 text-white"
                          : "text-muted-foreground",
                      )}
                      onClick={() => setHtmlView("source")}
                    >
                      Source
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="h-full rounded-lg border border-dashed border-border bg-muted/40">
              <EmptyState text={i18n.t("previewPanel.selectFilePreview")} />
            </div>
          )}
          {contentError ? (
            <div className="mt-2 text-[11px] text-amber-600">{contentError}</div>
          ) : null}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

function TreeList({
  nodes,
  sessionId,
  selectedPath,
  onSelectFile,
  expandedPaths,
  dirState,
  onTogglePath,
  onLoadMoreDir,
  onCopyPath,
  depth = 0,
}: {
  nodes: TreeNode[];
  sessionId?: string | null;
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  expandedPaths: Set<string>;
  dirState: Record<string, DirectoryLoadState>;
  onTogglePath: (path: string) => void;
  onLoadMoreDir: (path: string) => void;
  onCopyPath: (path: string) => Promise<void>;
  depth?: number;
}) {
  return (
    <div className="space-y-1">
      {nodes.map((node) => {
        const isDir = node.type === "dir";
        const isOpen = expandedPaths.has(node.path);
        const NodeIcon = resolveTreeNodeIcon(node, isOpen);
        const indent = depth * 10;
        const state = dirState[node.path];
        const nodeRawUrl =
          sessionId && !isDir ? getWorkspaceRawFileUrl(sessionId, node.path) : "";
        return (
          <div key={node.path}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => {
                if (isDir) {
                  onTogglePath(node.path);
                } else {
                  onSelectFile(node.path);
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  if (isDir) {
                    onTogglePath(node.path);
                  } else {
                    onSelectFile(node.path);
                  }
                }
              }}
              className={`group w-full flex items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[13px] transition-colors border cursor-pointer ${
                selectedPath === node.path
                  ? "bg-[var(--fill-tsp-white-dark)] border-border text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)] border-transparent hover:bg-[var(--fill-tsp-white-main)] hover:border-border"
              }`}
              style={{ paddingLeft: `${indent + 8}px` }}
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground">
                {isDir ? (
                  isOpen ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )
                ) : (
                  <NodeIcon className="h-3.5 w-3.5" />
                )}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono">{node.name}</span>
              {isDir && state?.loading ? (
                <span className="ml-1 text-[10px] text-muted-foreground">{i18n.t("common.loading")}</span>
              ) : null}
              <span className="hidden items-center gap-1 group-hover:flex">
                <button
                  type="button"
                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-[var(--fill-tsp-white-dark)] hover:text-foreground"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void onCopyPath(node.path);
                  }}
                  title={i18n.t("previewPanel.copyPath")}
                >
                  <Copy className="h-3 w-3" />
                </button>
                {!isDir && nodeRawUrl ? (
                  <button
                    type="button"
                    className="rounded p-1 text-muted-foreground transition-colors hover:bg-[var(--fill-tsp-white-dark)] hover:text-foreground"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      window.open(nodeRawUrl, "_blank", "noopener,noreferrer");
                    }}
                    title={i18n.t("previewPanel.openInNewWindow")}
                  >
                    <ExternalLink className="h-3 w-3" />
                  </button>
                ) : null}
              </span>
            </div>
            {isDir && isOpen ? (
              <div className="space-y-1">
                {node.children.length > 0 ? (
                  <TreeList
                    nodes={node.children}
                    sessionId={sessionId}
                    selectedPath={selectedPath}
                    onSelectFile={onSelectFile}
                    expandedPaths={expandedPaths}
                    dirState={dirState}
                    onTogglePath={onTogglePath}
                    onLoadMoreDir={onLoadMoreDir}
                    onCopyPath={onCopyPath}
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
                    className="px-2 py-1 text-[11px] text-[var(--brand-link)] hover:text-[var(--brand-link-hover)] disabled:text-muted-foreground"
                    style={{ paddingLeft: `${indent + 28}px` }}
                  >
                    {state.loading ? i18n.t("common.loading") : i18n.t("previewPanel.loadMore")}
                  </button>
                ) : null}
                {!state?.loading &&
                state?.initialized &&
                !state.hasMore &&
                !state.error &&
                node.children.length === 0 ? (
                  <div
                    className="px-2 py-1 text-[11px] text-muted-foreground"
                    style={{ paddingLeft: `${indent + 28}px` }}
                  >
                    {i18n.t("previewPanel.emptyDirectory")}
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
    return <EmptyState text={i18n.t("previewPanel.noChanges")} />;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        <span className="text-xs text-muted-foreground">{i18n.t("previewPanel.recentChanges")}</span>
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
      <div className="flex-1 min-h-0 overflow-auto overscroll-contain px-4 py-3">
        {current ? (
          <DiffBlock diff={current.diff} files={current.files} />
        ) : (
          <EmptyState text={i18n.t("previewPanel.noChanges")} />
        )}
      </div>
    </div>
  );
}

export function DeploymentPreview({
  sessionId,
  info,
  templateBaseline,
  templateBaselineLoading,
  templateBaselineError,
  loading,
  error,
  actionLoading,
  selectedDeploymentId,
  onRefresh,
  onSelectDeployment,
  onDeploy,
  onRedeploy,
  onRollback,
  tokenRotationLoading,
  onRotateDeploymentToken,
}: {
  sessionId?: string | null;
  info: TaskCreationDeploymentInfo | null;
  templateBaseline: TaskCreationDeploymentTemplateBaseline | null;
  templateBaselineLoading: boolean;
  templateBaselineError: string | null;
  loading: boolean;
  error: string | null;
  actionLoading: "deploy" | "redeploy" | "rollback" | null;
  selectedDeploymentId: string | null;
  onRefresh: (deploymentId?: string) => void;
  onSelectDeployment: (deploymentId: string) => void;
  onDeploy: () => void;
  onRedeploy: () => void;
  onRollback: () => void;
  tokenRotationLoading: boolean;
  onRotateDeploymentToken: () => void;
}) {
  const [section, setSection] =
    useState<DeploymentWorkbenchSection>("overview");
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
    info?.deployments.find((item) => item.id === currentDeploymentId) ||
    info?.deployments[0] ||
    null;
  const status = currentDeployment?.status || info?.latestStatus || "";
  const hasSuccessfulDeployment =
    info?.deployments.some((item) => item.status === "SUCCESS") ||
    info?.latestStatus === "SUCCESS";
  const isPending = Boolean(
    info?.activeDeploymentPending || pendingStatuses.has(status.toUpperCase()),
  );
  const statusMeta = !info?.configured
    ? info?.bindingState === "repair_required" ||
      info?.bindingState === "provider_error"
      ? {
          label: i18n.t("previewPanel.deployment.status.repairRequired"),
          description:
            info?.providerErrorMessage ||
            info?.message ||
            i18n.t("previewPanel.deployment.status.repairRequiredDescription"),
          badgeClass: "border-rose-200 bg-rose-50 text-rose-700",
          dotClass: "bg-rose-500",
          panelClass: "border-rose-200 bg-rose-50/70",
        }
      : info?.bindingState === "provisioning"
        ? {
            label: i18n.t("previewPanel.deployment.status.provisioning"),
            description:
              info?.message ||
              i18n.t("previewPanel.deployment.status.provisioningDescription"),
            badgeClass: "border-amber-200 bg-amber-50 text-amber-700",
            dotClass: "bg-amber-500",
            panelClass: "border-amber-200 bg-amber-50/70",
          }
        : {
            label: i18n.t("previewPanel.deployment.status.notReady"),
            description: info?.missing.length
              ? i18n.t("previewPanel.deployment.status.notReadyDescription", {
                  count: info.missing.length,
                })
              : i18n.t("previewPanel.deployment.status.preparingResources"),
            badgeClass: "border-border bg-muted/50 text-foreground",
            dotClass: "bg-slate-400",
            panelClass: "border-border bg-muted/40",
          }
    : status === "SUCCESS"
      ? {
          label: i18n.t("previewPanel.deployment.status.published"),
          description: i18n.t(
            "previewPanel.deployment.status.publishedDescription",
          ),
          badgeClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
          dotClass: "bg-emerald-500",
          panelClass: "border-emerald-200 bg-emerald-50/70",
        }
      : status === "FAILED" || status === "CRASHED"
        ? {
            label: i18n.t("previewPanel.deployment.status.failed"),
            description: i18n.t(
              "previewPanel.deployment.status.failedDescription",
            ),
            badgeClass: "border-rose-200 bg-rose-50 text-rose-700",
            dotClass: "bg-rose-500",
            panelClass: "border-rose-200 bg-rose-50/70",
          }
        : isPending
          ? {
              label: i18n.t("previewPanel.deployment.status.publishing"),
              description: i18n.t(
                "previewPanel.deployment.status.publishingDescription",
              ),
              badgeClass: "border-amber-200 bg-amber-50 text-amber-700",
              dotClass: "bg-amber-500",
              panelClass: "border-amber-200 bg-amber-50/70",
            }
          : {
              label: hasSuccessfulDeployment
                ? i18n.t("previewPanel.deployment.status.waitingUpdate")
                : i18n.t("previewPanel.deployment.status.notPublished"),
              description: hasSuccessfulDeployment
                ? i18n.t(
                    "previewPanel.deployment.status.waitingUpdateDescription",
                  )
                : i18n.t(
                    "previewPanel.deployment.status.notPublishedDescription",
                  ),
              badgeClass: "border-border bg-muted/50 text-foreground",
              dotClass: "bg-slate-400",
              panelClass: "border-border bg-muted/40",
            };
  const staticUrl = currentDeployment?.staticUrl || info?.latestStaticUrl || "";
  const runtimeUrl = currentDeployment?.url || info?.latestUrl || "";
  const primaryAccessUrl = staticUrl || runtimeUrl || info?.domains[0] || "";
  const accessEntries = Array.from(
    new Map(
      [
        primaryAccessUrl
          ? [i18n.t("previewPanel.deployment.siteUrl"), primaryAccessUrl]
          : null,
        runtimeUrl && runtimeUrl !== primaryAccessUrl
          ? [i18n.t("previewPanel.deployment.runtimeUrl"), runtimeUrl]
          : null,
        ...(info?.domains || [])
          .filter(
            (domain) =>
              domain && domain !== primaryAccessUrl && domain !== runtimeUrl,
          )
          .map(
            (domain, index) =>
              [
                i18n.t("previewPanel.deployment.boundDomain", {
                  index: index + 1,
                }),
                domain,
              ] as const,
          ),
      ]
        .filter(Boolean)
        .map((entry) => entry as readonly [string, string]),
    ),
  );
  const primaryActionText =
    actionLoading === "deploy"
      ? i18n.t("previewPanel.deployment.publishing")
      : hasSuccessfulDeployment
        ? i18n.t("previewPanel.deployment.publishNewVersion")
        : i18n.t("previewPanel.deployment.publishNow");
  const successCount =
    info?.deployments.filter((item) => item.status === "SUCCESS").length ?? 0;
  const failedCount =
    info?.deployments.filter(
      (item) => item.status === "FAILED" || item.status === "CRASHED",
    ).length ?? 0;
  const totalDeployments = info?.deployments.length ?? 0;
  const successRate = totalDeployments
    ? `${Math.round((successCount / totalDeployments) * 100)}%`
    : i18n.t("previewPanel.deployment.noData");
  const latestTimestamp =
    formatPreviewTimestamp(currentDeployment?.createdAt) ||
    currentDeployment?.createdAt ||
    i18n.t("previewPanel.deployment.noRecord");
  if (loading && !info) {
    return <EmptyState text={i18n.t("previewPanel.deployment.loadingInfo")} />;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-2">
        <div className="flex gap-2 overflow-x-auto pb-1">
          <DeploymentMenuButton
            active={section === "overview"}
            icon={Rocket}
            label={i18n.t("previewPanel.deployment.sections.overview")}
            onClick={() => setSection("overview")}
          />
          <DeploymentMenuButton
            active={section === "dashboard"}
            icon={BarChart3}
            label={i18n.t("previewPanel.deployment.sections.dashboard")}
            onClick={() => setSection("dashboard")}
          />
          <DeploymentMenuButton
            active={section === "database"}
            icon={Database}
            label={i18n.t("previewPanel.deployment.sections.database")}
            onClick={() => setSection("database")}
          />
          <DeploymentMenuButton
            active={section === "storage"}
            icon={HardDrive}
            label={i18n.t("previewPanel.deployment.sections.storage")}
            onClick={() => setSection("storage")}
          />
          <DeploymentMenuButton
            active={section === "settings"}
            icon={Settings2}
            label={i18n.t("previewPanel.deployment.sections.settings")}
            onClick={() => setSection("settings")}
          />
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {i18n.t("previewPanel.tabs.deployment")}
          </span>
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-[11px]",
              statusMeta.badgeClass,
            )}
          >
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
          {i18n.t("previewPanel.deployment.refreshStatus")}
        </Button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto overscroll-contain px-4 py-4 space-y-4">
        {error ? <div className="text-xs text-rose-600">{error}</div> : null}
        {info?.message ? (
          <div className="text-xs text-muted-foreground">{info.message}</div>
        ) : null}

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
            onDeploy={onDeploy}
            onRedeploy={onRedeploy}
            onRollback={onRollback}
            onRefresh={onRefresh}
            onSelectDeployment={onSelectDeployment}
          />
        ) : null}

        {section === "dashboard" ? (
          <DeploymentDashboardSection
            sessionId={sessionId}
            info={info}
            templateBaseline={templateBaseline}
            templateBaselineLoading={templateBaselineLoading}
            templateBaselineError={templateBaselineError}
            statusMeta={statusMeta}
            successCount={successCount}
            failedCount={failedCount}
            totalDeployments={totalDeployments}
            successRate={successRate}
            currentDeployment={currentDeployment}
            latestTimestamp={latestTimestamp}
            accessEntries={accessEntries}
          />
        ) : null}

        {section === "database" ? (
          <DeploymentDatabaseSection
            sessionId={sessionId}
            info={info}
            statusMeta={statusMeta}
          />
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
            tokenRotationLoading={tokenRotationLoading}
            onRotateDeploymentToken={onRotateDeploymentToken}
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
  onDeploy: () => void;
  onRedeploy: () => void;
  onRollback: () => void;
  onRefresh: (deploymentId?: string) => void;
  onSelectDeployment: (deploymentId: string) => void;
}) {
  const [releaseListExpanded, setReleaseListExpanded] = useState(false);
  const deployments = info?.deployments || [];
  const visibleDeployments = releaseListExpanded
    ? deployments.slice(0, 12)
    : currentDeployment
      ? [
          currentDeployment,
          ...deployments
            .filter((item) => item.id !== currentDeployment.id)
            .slice(0, 3),
        ]
      : deployments.slice(0, 4);
  const logEntries = (info?.logs || []).slice(-4).reverse();
  const currentVersionTimestamp =
    formatPreviewTimestamp(currentDeployment?.createdAt) ||
    currentDeployment?.createdAt ||
    i18n.t("previewPanel.deployment.overview.waitingFirstRelease");
  const primaryDomainCount = Math.max(accessEntries.length - 1, 0);
  const stableReleaseCount = deployments.filter(
    (item) => item.status === "SUCCESS",
  ).length;
  const compactPrimaryActionText =
    primaryActionText === i18n.t("previewPanel.deployment.publishing")
      ? i18n.t("previewPanel.deployment.overview.publishingShort")
      : i18n.t("previewPanel.deployment.overview.publishShort");
  const compactActionButtonClass =
    "h-7 gap-1 rounded-md px-2 text-[11px] leading-none has-[>svg]:px-2";
  const compactActionIconClass = "size-3.5";

  return (
    <div className="grid gap-3">
      <section className="min-w-0 rounded-lg border border-border/70 bg-card">
        <div className="flex h-full min-h-0 flex-col p-3 sm:p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-[11px] font-medium text-muted-foreground">
                  <Rocket className="size-3.5 text-muted-foreground" />
                  {i18n.t("previewPanel.deployment.sections.overview")}
                </div>
                <div
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-[11px]",
                    statusMeta.badgeClass,
                  )}
                  >
                    {info?.activeDeploymentPending
                      ? i18n.t("previewPanel.deployment.overview.inProgress")
                      : i18n.t("previewPanel.deployment.overview.settled")}
                  </div>
              </div>
              <div>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <div
                      className={cn("size-2 rounded-full", statusMeta.dotClass)}
                    />
                    <h3 className="truncate text-lg font-semibold text-foreground">
                      {statusMeta.label}
                    </h3>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      className={compactActionButtonClass}
                      onClick={onDeploy}
                      disabled={!info?.canDeploy || Boolean(actionLoading)}
                    >
                      {actionLoading === "deploy" ? (
                        <Loader2
                          className={cn(
                            compactActionIconClass,
                            "animate-spin",
                          )}
                        />
                      ) : (
                        <Rocket className={compactActionIconClass} />
                      )}
                      {compactPrimaryActionText}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className={compactActionButtonClass}
                      onClick={onRedeploy}
                      disabled={!currentDeploymentId || Boolean(actionLoading)}
                    >
                      {actionLoading === "redeploy" ? (
                        <Loader2
                          className={cn(
                            compactActionIconClass,
                            "animate-spin",
                          )}
                        />
                      ) : (
                        <History className={compactActionIconClass} />
                      )}
                      {i18n.t("previewPanel.deployment.overview.redeploy")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className={compactActionButtonClass}
                      onClick={onRollback}
                      disabled={!currentDeploymentId || Boolean(actionLoading)}
                    >
                      {actionLoading === "rollback" ? (
                        <Loader2
                          className={cn(
                            compactActionIconClass,
                            "animate-spin",
                          )}
                        />
                      ) : null}
                      {i18n.t("previewPanel.deployment.overview.rollback")}
                    </Button>
                  </div>
                </div>
                <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                  {statusMeta.description}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <DashboardMiniStat
              label={i18n.t("previewPanel.deployment.overview.currentVersion")}
              value={currentVersionTimestamp}
              subtle
            />
            <DashboardMiniStat
              label={i18n.t("previewPanel.deployment.overview.accessEntries")}
              value={
                primaryAccessUrl
                  ? `${accessEntries.length} ${i18n.t("previewPanel.deployment.overview.accessEntries")}`
                  : i18n.t("previewPanel.deployment.overview.waitingGenerate")
              }
              subtle
            />
            <DashboardMiniStat
              label={i18n.t("previewPanel.deployment.overview.releaseRecords")}
              value={
                deployments.length
                  ? i18n.t("previewPanel.deployment.dashboard.recordsCount", {
                      count: deployments.length,
                    })
                  : i18n.t("previewPanel.deployment.noRecord")
              }
              subtle
            />
          </div>

          <div className="mt-3 rounded-md border border-border/70 bg-muted/30 p-3 sm:p-4">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Globe className="size-4 text-muted-foreground" />
                    {i18n.t("previewPanel.deployment.overview.primaryAccessUrl")}
                  </div>
                  {primaryAccessUrl ? (
                    <a
                      href={primaryAccessUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 block break-all text-sm text-[var(--brand-link)] hover:text-[var(--brand-link-hover)]"
                    >
                      {primaryAccessUrl}
                    </a>
                  ) : (
                    <p className="mt-2 text-sm text-muted-foreground">
                      {i18n.t(
                        "previewPanel.deployment.overview.firstReleaseGeneratesUrl",
                      )}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {primaryAccessUrl ? (
                    <Button asChild>
                      <a
                        href={primaryAccessUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <ExternalLink className="size-4" />
                        {i18n.t("previewPanel.deployment.overview.openSite")}
                      </a>
                    </Button>
                  ) : null}
                  <Button
                    variant="outline"
                    onClick={() => onRefresh(currentDeploymentId || undefined)}
                    disabled={loading}
                    >
                      <RefreshCw
                        className={cn("size-4", loading ? "animate-spin" : "")}
                      />
                    {i18n.t("previewPanel.deployment.overview.refreshResult")}
                  </Button>
                </div>
              </div>

              <div className="grid gap-2">
                {accessEntries.length ? (
                  accessEntries.map(([label, value]) => (
                    <a
                      key={`${label}-${value}`}
                      href={value}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2 transition-colors hover:border-border hover:bg-muted/30"
                    >
                      <div className="min-w-0">
                        <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                          {label}
                        </div>
                        <div className="mt-1 break-all text-sm text-foreground">
                          {value}
                        </div>
                      </div>
                      <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
                    </a>
                  ))
                ) : (
                  <div className="rounded-md border border-dashed border-border bg-card px-3 py-8 text-center text-sm text-muted-foreground">
                    {i18n.t("previewPanel.deployment.overview.noAccessibleEntry")}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="mt-2 rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-xs leading-5 text-muted-foreground">
            {primaryAccessUrl
              ? i18n.t("previewPanel.deployment.overview.accessSummary", {
                  count: accessEntries.length,
                  domainCount: primaryDomainCount,
                })
              : i18n.t("previewPanel.deployment.overview.focusedClosure")}
          </div>
        </div>
      </section>

      <section className="min-w-0 rounded-lg border border-border/70 bg-card">
        <div className="flex h-full min-h-0 flex-col">
          <div className="border-b border-border px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  {i18n.t("previewPanel.deployment.overview.releaseCard")}
                </div>
                <div className="mt-2 text-base font-semibold text-foreground">
                  {currentDeployment?.commitMessage ||
                    i18n.t("previewPanel.deployment.overview.waitingFirstRelease")}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>
                    {currentDeployment?.commitAuthor ||
                      i18n.t("previewPanel.deployment.overview.platformAutoPublish")}
                  </span>
                  <span className="size-1 rounded-full bg-slate-300" />
                  <span>{currentVersionTimestamp}</span>
                  {currentDeployment?.id ? (
                    <>
                      <span className="size-1 rounded-full bg-slate-300" />
                      <span className="font-mono">
                        {currentDeployment.id.slice(0, 8)}
                      </span>
                    </>
                  ) : null}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {runtimeUrl ? (
                  <Button variant="outline" asChild>
                    <a href={runtimeUrl} target="_blank" rel="noreferrer">
                      <ExternalLink className="size-4" />
                      {i18n.t("previewPanel.deployment.runtimeUrl")}
                    </a>
                  </Button>
                ) : null}
                {staticUrl && staticUrl !== runtimeUrl ? (
                  <Button variant="outline" asChild>
                    <a href={staticUrl} target="_blank" rel="noreferrer">
                      <ExternalLink className="size-4" />
                      {i18n.t("previewPanel.deployment.siteUrl")}
                    </a>
                  </Button>
                ) : null}
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 sm:p-4">
            <div className="rounded-md border border-border/70 bg-muted/30 p-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <DashboardMiniStat
                  label={i18n.t("previewPanel.deployment.overview.onlineStatus")}
                  value={currentDeployment?.status || info?.latestStatus || "UNKNOWN"}
                />
                <DashboardMiniStat
                  label={i18n.t("previewPanel.deployment.overview.recentLogs")}
                  value={
                    logEntries.length
                      ? i18n.t("previewPanel.deployment.dashboard.recordsCount", {
                          count: logEntries.length,
                        })
                      : i18n.t("previewPanel.deployment.overview.none")
                  }
                />
                <DashboardMiniStat
                  label={i18n.t("previewPanel.deployment.overview.rollbackCapacity")}
                  value={
                    stableReleaseCount
                      ? i18n.t("previewPanel.deployment.overview.stableVersions", {
                          count: stableReleaseCount,
                        })
                      : i18n.t("previewPanel.deployment.overview.none")
                  }
                />
              </div>
            </div>

            <div className="min-h-0 rounded-md border border-border/70">
              <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <History className="size-4 text-muted-foreground" />
                  {i18n.t("previewPanel.deployment.overview.releaseList")}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {i18n.t("previewPanel.deployment.dashboard.recordsCount", {
                      count: deployments.length,
                    })}
                  </span>
                  {deployments.length > 4 ? (
                    <button
                      type="button"
                      onClick={() =>
                        setReleaseListExpanded((current) => !current)
                      }
                      className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-border hover:text-foreground"
                    >
                      {releaseListExpanded
                        ? i18n.t("previewPanel.deployment.overview.collapse")
                        : i18n.t("previewPanel.deployment.overview.expand")}
                      <ChevronDown
                        className={cn(
                          "size-3 transition-transform",
                          releaseListExpanded ? "rotate-180" : "",
                        )}
                      />
                    </button>
                  ) : null}
                </div>
              </div>
              <div
                className={cn(
                  "space-y-2 overflow-auto px-4 py-2.5",
                  releaseListExpanded ? "max-h-[280px]" : "max-h-[208px]",
                )}
              >
                {visibleDeployments.length ? (
                  visibleDeployments.map((item) => {
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
                          "w-full rounded-md border px-3 py-3 text-left transition-colors",
                          itemSelected
                            ? "border-slate-900 bg-muted/30"
                            : "border-border hover:bg-muted/30",
                        )}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={cn(
                                  "rounded-full border px-2 py-0.5 text-[11px]",
                                  itemStatusClass,
                                )}
                              >
                                {item.status}
                              </span>
                              <span className="font-mono text-[11px] text-muted-foreground">
                                {item.id.slice(0, 8)}
                              </span>
                            </div>
                            <div className="mt-2 text-sm font-medium text-foreground">
                              {item.commitMessage ||
                                i18n.t(
                                  "previewPanel.deployment.overview.triggeredByOneceo",
                                )}
                            </div>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {formatPreviewTimestamp(item.createdAt) ||
                              item.createdAt ||
                              i18n.t("previewPanel.deployment.overview.unknownTime")}
                          </div>
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <div className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                    {i18n.t("previewPanel.deployment.noRecord")}
                  </div>
                )}
              </div>
            </div>

            <div className="min-h-0 overflow-hidden rounded-md border border-border/70 bg-slate-950 text-slate-100">
              <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-2.5">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                  <ScrollText className="size-4 text-muted-foreground" />
                  {i18n.t("previewPanel.deployment.overview.releaseLog")}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {i18n.t("previewPanel.deployment.overview.onlyRecentContent")}
                </div>
              </div>
              {logEntries.length ? (
                <div className="max-h-[176px] overflow-auto overscroll-contain px-4 py-2.5">
                  <div className="space-y-3">
                    {logEntries.map((entry, index) => (
                      <div
                        key={`${entry.timestamp || "log"}-${index}`}
                        className="rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2"
                      >
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                          {entry.timestamp ? (
                            <span>
                              {formatPreviewTimestamp(entry.timestamp) ||
                                entry.timestamp}
                            </span>
                          ) : null}
                          {entry.severity ? (
                            <span className="rounded-full border border-slate-700 px-1.5 py-0.5 uppercase tracking-[0.08em] text-slate-300">
                              {entry.severity}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-2 break-words font-mono text-[11px] leading-5 text-slate-100">
                          {entry.message}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="px-4 py-10 text-sm text-muted-foreground">
                  {info?.configured
                    ? i18n.t("previewPanel.deployment.overview.noCurrentLog")
                    : i18n.t("previewPanel.deployment.overview.logsAfterReady")}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function DeploymentDashboardSection({
  sessionId,
  info,
  templateBaseline,
  templateBaselineLoading,
  templateBaselineError,
  statusMeta,
  successCount,
  failedCount,
  totalDeployments,
  successRate,
  currentDeployment,
  latestTimestamp,
  accessEntries,
}: {
  sessionId?: string | null;
  info: TaskCreationDeploymentInfo | null;
  templateBaseline: TaskCreationDeploymentTemplateBaseline | null;
  templateBaselineLoading: boolean;
  templateBaselineError: string | null;
  statusMeta: DeploymentStatusMeta;
  successCount: number;
  failedCount: number;
  totalDeployments: number;
  successRate: string;
  currentDeployment: TaskCreationDeploymentInfo["deployments"][number] | null;
  latestTimestamp: string;
  accessEntries: Array<[string, string] | readonly [string, string]>;
}) {
  const [mode, setMode] = useState<"deployments" | "site">("deployments");

  if (mode === "site") {
    const siteName =
      info?.projectName ||
      info?.serviceName ||
      i18n.t("previewPanel.deployment.dashboard.unnamedSite");
    const primaryUrl = accessEntries[0]?.[1] || "";
    const recentLogs = info?.logs.slice(-3) || [];
    const siteVisibilityLabel = primaryUrl
      ? i18n.t("previewPanel.deployment.dashboard.publicAccessible")
      : i18n.t("previewPanel.deployment.dashboard.waitingFirstRelease");
    const analyticsPresentation = getDeploymentAnalyticsPresentation(
      info?.analytics,
      Boolean(primaryUrl),
    );
    const hasAnalyticsMetrics =
      info?.analytics?.status === "tracking" || info?.analytics?.status === "bound";
    const visitsValue =
      hasAnalyticsMetrics
        ? formatMetricCount(info?.analytics?.visits, "0")
        : analyticsPresentation.integrationValue;
    const visitorsValue =
      hasAnalyticsMetrics
        ? formatMetricCount(info?.analytics?.visitors, "0")
        : analyticsPresentation.integrationValue;
    return (
      <div className="space-y-4">
        <section className="rounded-lg border border-border/70 bg-card p-4 sm:p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <div className="flex items-start gap-3">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-md border border-border bg-muted/50 text-foreground">
                  <Globe2 className="size-4" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-semibold text-foreground">
                      {siteName}
                    </h3>
                    <span
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-[11px]",
                        statusMeta.badgeClass,
                      )}
                    >
                      {statusMeta.label}
                    </span>
                  </div>
                  {primaryUrl ? (
                    <a
                      href={primaryUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 flex items-center gap-1 truncate text-sm text-muted-foreground hover:text-foreground hover:underline"
                    >
                      {primaryUrl}
                      <ExternalLink className="size-3.5 shrink-0" />
                    </a>
                  ) : (
                    <div className="mt-1 text-sm text-muted-foreground">
                      {i18n.t("previewPanel.deployment.dashboard.siteUrlMissing")}
                    </div>
                  )}
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                    {i18n.t(
                      "previewPanel.deployment.dashboard.siteViewDescription",
                    )}
                  </p>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 self-start">
              <DashboardModeToggle mode={mode} onChange={setMode} />
              {primaryUrl ? (
                <Button asChild size="sm" className="h-8 text-xs">
                  <a href={primaryUrl} target="_blank" rel="noreferrer">
                    {i18n.t("previewPanel.deployment.overview.openSite")}
                  </a>
                </Button>
              ) : null}
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <DeploymentMetricCard
              title={i18n.t("previewPanel.deployment.dashboard.accessStatus")}
              value={siteVisibilityLabel}
              subtitle={
                primaryUrl
                  ? i18n.t(
                      "previewPanel.deployment.dashboard.accessReadyDescription",
                    )
                  : i18n.t(
                      "previewPanel.deployment.dashboard.defaultAccessDescription",
                    )
              }
            />
            <DeploymentMetricCard
              title={i18n.t("previewPanel.deployment.dashboard.latestVersion")}
              value={
                currentDeployment?.commitMessage ||
                (currentDeployment?.id
                  ? currentDeployment.id.slice(0, 8)
                  : i18n.t("previewPanel.deployment.dashboard.waitingFirstVersion"))
              }
              subtitle={
                formatPreviewTimestamp(currentDeployment?.createdAt) ||
                currentDeployment?.createdAt ||
                i18n.t("previewPanel.deployment.dashboard.noReleaseHistory")
              }
            />
            <DeploymentMetricCard
              title={i18n.t("previewPanel.deployment.dashboard.accessEntryCount")}
              value={`${accessEntries.length}`}
              subtitle={
                accessEntries.length
                  ? i18n.t("previewPanel.deployment.dashboard.boundDomainCount", {
                      count: info?.domains.length || 0,
                    })
                  : i18n.t("previewPanel.deployment.dashboard.noEntries")
              }
            />
            <DeploymentMetricCard
              title={i18n.t("previewPanel.deployment.dashboard.pageviews30d")}
              value={analyticsPresentation.trafficValue}
              subtitle={analyticsPresentation.trafficSubtitle}
            />
          </div>
        </section>

        <section className="rounded-lg border border-border/70 bg-card">
          <div className="border-b border-border px-4 py-4 sm:px-5">
            <div className="text-sm font-semibold text-foreground">
              {i18n.t("previewPanel.deployment.dashboard.sensedDataTitle")}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {i18n.t("previewPanel.deployment.dashboard.sensedDataDescription")}
            </div>
          </div>
          <div className="grid gap-4 p-4 sm:p-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <div className="space-y-4">
              <div className="rounded-md border border-border/70 bg-muted/30 p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Globe className="size-4 text-muted-foreground" />
                  {i18n.t("previewPanel.deployment.dashboard.accessEntries")}
                </div>
                <div className="mt-3 space-y-2">
                  {accessEntries.length ? (
                    accessEntries.map(([label, url]) => (
                      <a
                        key={`${label}:${url}`}
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground transition-colors hover:border-border hover:bg-muted/30"
                      >
                        <div className="min-w-0">
                          <div className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                            {label}
                          </div>
                          <div className="mt-1 break-all text-foreground">
                            {url}
                          </div>
                        </div>
                        <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
                      </a>
                    ))
                  ) : (
                    <div className="rounded-md border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">
                      {sessionId
                        ? i18n.t("previewPanel.deployment.dashboard.noAccessEntries")
                        : i18n.t(
                            "previewPanel.deployment.dashboard.noSessionForEntries",
                          )}
                    </div>
                  )}
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <DeploymentInfoCard
                  title={i18n.t("previewPanel.deployment.dashboard.project")}
                  value={
                    info?.projectName ||
                    info?.projectId ||
                    i18n.t("previewPanel.deployment.dashboard.unconfigured")
                  }
                  extra={
                    info?.projectId
                      ? i18n.t("previewPanel.deployment.dashboard.projectId", {
                          id: info.projectId,
                        })
                      : undefined
                  }
                  mono={Boolean(info?.projectId && info?.projectName)}
                />
                <DeploymentInfoCard
                  title={i18n.t("previewPanel.deployment.dashboard.service")}
                  value={
                    info?.serviceName ||
                    info?.serviceId ||
                    i18n.t("previewPanel.deployment.dashboard.unconfigured")
                  }
                  extra={
                    info?.serviceId
                      ? i18n.t("previewPanel.deployment.dashboard.serviceId", {
                          id: info.serviceId,
                        })
                      : i18n.t(
                          "previewPanel.deployment.dashboard.waitingServiceBinding",
                        )
                  }
                  mono={Boolean(info?.serviceId && info?.serviceName)}
                />
                <DeploymentInfoCard
                  title={i18n.t(
                    "previewPanel.deployment.dashboard.currentVersionStatus",
                  )}
                  value={
                    currentDeployment?.status || info?.latestStatus || "UNKNOWN"
                  }
                  extra={statusMeta.description}
                />
                <DeploymentInfoCard
                  title={i18n.t("previewPanel.deployment.dashboard.latestSync")}
                  value={latestTimestamp}
                  extra={
                    totalDeployments
                      ? i18n.t("previewPanel.deployment.dashboard.publishSummary", {
                          count: totalDeployments,
                          rate: successRate,
                        })
                      : i18n.t(
                          "previewPanel.deployment.dashboard.noPublishHistory",
                        )
                  }
                />
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-md border border-border/70 bg-muted/30 p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <BarChart3 className="size-4 text-muted-foreground" />
                  {i18n.t("previewPanel.deployment.dashboard.siteAnalytics")}
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <DeploymentMiniStatus
                    label={i18n.t(
                      "previewPanel.deployment.dashboard.analyticsIntegration",
                    )}
                    value={analyticsPresentation.integrationValue}
                  />
                  <DeploymentMiniStatus
                    label={i18n.t(
                      "previewPanel.deployment.dashboard.realtimeVisitors",
                    )}
                    value={analyticsPresentation.realtimeValue}
                  />
                  <DeploymentMiniStatus
                    label={i18n.t("previewPanel.deployment.dashboard.visits30d")}
                    value={visitsValue}
                  />
                  <DeploymentMiniStatus
                    label={i18n.t(
                      "previewPanel.deployment.dashboard.visitors30d",
                    )}
                    value={visitorsValue}
                  />
                </div>
                <div className="mt-3 text-xs leading-5 text-muted-foreground">
                  {analyticsPresentation.integrationSubtitle}
                </div>
              </div>

              <div className="rounded-md border border-border/70 bg-muted/30 p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <ScrollText className="size-4 text-muted-foreground" />
                  {i18n.t("previewPanel.deployment.dashboard.recentLogs")}
                </div>
                <div className="mt-3 space-y-2">
                  {recentLogs.length ? (
                    recentLogs.map((entry, index) => (
                      <div
                        key={`${entry.timestamp || "log"}-${index}`}
                        className="rounded-md border border-border bg-card px-3 py-2"
                      >
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                          {entry.timestamp ? (
                            <span>
                              {formatPreviewTimestamp(entry.timestamp) ||
                                entry.timestamp}
                            </span>
                          ) : null}
                          {entry.severity ? (
                            <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                              {entry.severity}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 text-sm leading-6 text-foreground">
                          {entry.message}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-md border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">
                      {i18n.t("previewPanel.deployment.dashboard.noRecentLogs")}
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-md border border-border/70 bg-muted/30 p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <ShieldCheck className="size-4 text-muted-foreground" />
                  {i18n.t("previewPanel.deployment.dashboard.platformDecision")}
                </div>
                <div className="mt-3 grid gap-3">
                  <DeploymentMiniStatus
                    label={i18n.t("previewPanel.deployment.dashboard.siteVisibility")}
                    value={siteVisibilityLabel}
                  />
                  <DeploymentMiniStatus
                    label={i18n.t("previewPanel.deployment.dashboard.siteStats")}
                    value={analyticsPresentation.integrationValue}
                  />
                  <DeploymentMiniStatus
                    label={i18n.t(
                      "previewPanel.deployment.dashboard.realtimeVisitors",
                    )}
                    value={analyticsPresentation.realtimeValue}
                  />
                  <DeploymentMiniStatus
                    label={i18n.t(
                      "previewPanel.deployment.dashboard.deploymentPreparation",
                    )}
                    value={
                      info?.missing.length
                        ? i18n.t("previewPanel.deployment.dashboard.missingItems", {
                            items: info.missing.join("、"),
                          })
                        : info?.configured
                          ? i18n.t("previewPanel.deployment.dashboard.ready")
                          : i18n.t("previewPanel.deployment.dashboard.preparing")
                    }
                  />
                </div>
                <div className="mt-3 text-xs leading-5 text-muted-foreground">
                  {analyticsPresentation.realtimeSubtitle}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-border/70 bg-card">
          <div className="border-b border-border px-4 py-4 sm:px-5">
            <div className="text-sm font-semibold text-foreground">
              {i18n.t("previewPanel.deployment.dashboard.analyticsTitle")}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {i18n.t("previewPanel.deployment.dashboard.analyticsDescription")}
            </div>
          </div>
          <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4 sm:p-5">
            <DeploymentMetricCard
              title={i18n.t("previewPanel.deployment.dashboard.pageTraffic")}
              value={analyticsPresentation.trafficValue}
              subtitle={analyticsPresentation.trafficSubtitle}
            />
            <DeploymentMetricCard
              title={i18n.t("previewPanel.deployment.dashboard.visitSessions")}
              value={visitsValue}
              subtitle={i18n.t(
                "previewPanel.deployment.dashboard.visitSessionsDescription",
              )}
            />
            <DeploymentMetricCard
              title={i18n.t("previewPanel.deployment.dashboard.visitorCount")}
              value={visitorsValue}
              subtitle={i18n.t(
                "previewPanel.deployment.dashboard.visitorCountDescription",
              )}
            />
            <DeploymentMetricCard
              title={i18n.t(
                "previewPanel.deployment.dashboard.realtimeVisitors",
              )}
              value={analyticsPresentation.realtimeValue}
              subtitle={analyticsPresentation.realtimeSubtitle}
            />
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-lg border border-border/70 bg-card">
        <div className="border-b border-border p-4 sm:p-5">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  {i18n.t("previewPanel.deployment.dashboard.deploymentData")}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <h3 className="text-xl font-semibold text-foreground">
                    {i18n.t("previewPanel.deployment.dashboard.currentStatus", {
                      status: statusMeta.label,
                    })}
                  </h3>
                  <span
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[11px]",
                      statusMeta.badgeClass,
                    )}
                  >
                    {info?.activeDeploymentPending
                      ? i18n.t("previewPanel.deployment.dashboard.statusPublishing")
                      : i18n.t("previewPanel.deployment.dashboard.statusSynced")}
                  </span>
                </div>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                  {statusMeta.description}
                </p>
              </div>
              <DashboardModeToggle mode={mode} onChange={setMode} />
            </div>

            <div className="flex flex-wrap gap-2">
              <div className="rounded-full border border-border bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
                {i18n.t("previewPanel.deployment.dashboard.latestSyncShort")}:{" "}
                <span className="font-medium text-foreground">
                  {latestTimestamp}
                </span>
              </div>
              <div className="rounded-full border border-border bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
                {i18n.t("previewPanel.deployment.dashboard.rollbackVersions")}:{" "}
                <span className="font-medium text-foreground">
                  {successCount}
                </span>
              </div>
              <div className="rounded-full border border-border bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
                {i18n.t("previewPanel.deployment.dashboard.accessEntriesShort")}:{" "}
                <span className="font-medium text-foreground">
                  {accessEntries.length}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-px bg-slate-200 grid-cols-2 lg:grid-cols-4">
          <CompactDeploymentMetric
            label={i18n.t("previewPanel.deployment.dashboard.successRate")}
            value={successRate}
            hint={
              totalDeployments
                ? i18n.t("previewPanel.deployment.dashboard.recordsCount", {
                    count: totalDeployments,
                  })
                : i18n.t("previewPanel.deployment.noRecord")
            }
          />
          <CompactDeploymentMetric
            label={i18n.t("previewPanel.deployment.dashboard.successVersions")}
            value={`${successCount}`}
            hint={
              successCount
                ? i18n.t("previewPanel.deployment.dashboard.stableRollbackHint")
                : i18n.t("previewPanel.deployment.dashboard.waitingStableVersion")
            }
          />
          <CompactDeploymentMetric
            label={i18n.t("previewPanel.deployment.dashboard.failedVersions")}
            value={`${failedCount}`}
            hint={
              failedCount
                ? i18n.t("previewPanel.deployment.dashboard.reviewFailedLogs")
                : i18n.t("previewPanel.deployment.dashboard.noFailedVersions")
            }
          />
          <CompactDeploymentMetric
            label={i18n.t("previewPanel.deployment.dashboard.accessEntriesShort")}
            value={`${accessEntries.length}`}
            hint={
              accessEntries.length
                ? i18n.t("previewPanel.deployment.dashboard.onlineAddressReady")
                : i18n.t("previewPanel.deployment.dashboard.waitingFirstRelease")
            }
          />
        </div>
      </section>

      <section className="rounded-lg border border-border/70 bg-card">
        <div className="border-b border-border px-4 py-4 sm:px-5">
          <div className="text-sm font-semibold text-foreground">
            {i18n.t("previewPanel.deployment.dashboard.currentLiveVersion")}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {i18n.t(
              "previewPanel.deployment.dashboard.currentLiveVersionDescription",
            )}
          </div>
        </div>
        <div className="space-y-4 p-4 sm:p-5">
          <div className="rounded-md border border-border/70 bg-muted/30 p-4">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  {i18n.t("previewPanel.deployment.dashboard.versionNotes")}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "rounded-full border px-2 py-1 text-[11px]",
                      statusMeta.badgeClass,
                    )}
                  >
                    {currentDeployment?.status ||
                      info?.latestStatus ||
                      "UNKNOWN"}
                  </span>
                  {info?.activeDeploymentPending ? (
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
                      {i18n.t("previewPanel.deployment.dashboard.waitingComplete")}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="text-base font-semibold text-foreground">
                {currentDeployment?.commitMessage ||
                  i18n.t("previewPanel.deployment.overview.waitingFirstRelease")}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>
                  {currentDeployment?.commitAuthor ||
                    i18n.t("previewPanel.deployment.overview.platformAutoPublish")}
                </span>
                <span className="size-1 rounded-full bg-slate-300" />
                <span>
                  {formatPreviewTimestamp(currentDeployment?.createdAt) ||
                    currentDeployment?.createdAt ||
                    i18n.t("previewPanel.deployment.overview.unknownTime")}
                </span>
                {currentDeployment?.id ? (
                  <>
                    <span className="size-1 rounded-full bg-slate-300" />
                    <span className="font-mono">
                      {currentDeployment.id.slice(0, 8)}
                    </span>
                  </>
                ) : null}
              </div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
            <div className="rounded-md border border-border/70 p-4">
              <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                {i18n.t("previewPanel.deployment.dashboard.accessEntries")}
              </div>
              <div className="mt-3 space-y-2">
                {accessEntries.length ? (
                  accessEntries.slice(0, 3).map(([label, url]) => (
                    <a
                      key={`${label}:${url}`}
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between gap-3 rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-sm text-foreground transition-colors hover:border-border hover:bg-muted/30"
                    >
                      <span className="truncate">{label}</span>
                      <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
                    </a>
                  ))
                ) : (
                  <div className="rounded-md border border-dashed border-border px-3 py-6 text-sm text-muted-foreground">
                    {i18n.t("previewPanel.deployment.overview.noAccessibleEntry")}
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-md border border-border/70 p-4">
              <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                {i18n.t("previewPanel.deployment.dashboard.publishOverview")}
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <DashboardMiniStat
                  label={i18n.t("previewPanel.deployment.dashboard.successVersions")}
                  value={`${successCount}`}
                />
                <DashboardMiniStat
                  label={i18n.t("previewPanel.deployment.dashboard.failedVersions")}
                  value={`${failedCount}`}
                />
                <DashboardMiniStat
                  label={i18n.t("previewPanel.deployment.dashboard.accessEntriesShort")}
                  value={`${accessEntries.length}`}
                />
                <DashboardMiniStat
                  label={i18n.t("previewPanel.deployment.dashboard.recentActivity")}
                  value={latestTimestamp}
                  subtle
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-border/70 bg-card">
        <div className="border-b border-border px-4 py-4 sm:px-5">
          <div className="text-sm font-semibold text-foreground">
            {i18n.t("previewPanel.deployment.dashboard.operationsDecision")}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {i18n.t(
              "previewPanel.deployment.dashboard.operationsDecisionDescription",
            )}
          </div>
        </div>
        <div className="grid gap-3 p-4 sm:p-5 md:grid-cols-3">
          <InsightCard
            title={i18n.t("previewPanel.deployment.dashboard.currentVersionInsight")}
            description={
              currentDeployment?.status === "SUCCESS"
                ? i18n.t(
                    "previewPanel.deployment.dashboard.currentVersionStable",
                  )
                : info?.activeDeploymentPending
                  ? i18n.t(
                      "previewPanel.deployment.dashboard.currentVersionPending",
                    )
                  : i18n.t(
                      "previewPanel.deployment.dashboard.currentVersionMissing",
                    )
            }
          />
          <InsightCard
            title={i18n.t("previewPanel.deployment.dashboard.entryStatus")}
            description={
              accessEntries.length
                ? i18n.t("previewPanel.deployment.dashboard.entryStatusCount", {
                    count: accessEntries.length,
                  })
                : i18n.t("previewPanel.deployment.dashboard.entryStatusMissing")
            }
          />
          <InsightCard
            title={i18n.t("previewPanel.deployment.dashboard.rollbackSpace")}
            description={
              successCount > 1
                ? i18n.t(
                    "previewPanel.deployment.dashboard.rollbackSpaceMany",
                    { count: successCount },
                  )
                : successCount === 1
                  ? i18n.t(
                      "previewPanel.deployment.dashboard.rollbackSpaceSingle",
                    )
                  : i18n.t(
                      "previewPanel.deployment.dashboard.rollbackSpaceNone",
                    )
            }
          />
        </div>
      </section>

      <DeploymentTemplateBaselineSection
        baseline={templateBaseline}
        loading={templateBaselineLoading}
        error={templateBaselineError}
      />

      <section className="rounded-lg border border-border/70 bg-card">
        <div className="flex flex-col gap-2 border-b border-border px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-sm font-semibold text-foreground">
              {i18n.t("previewPanel.deployment.dashboard.recentReleaseTimeline")}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {i18n.t(
                "previewPanel.deployment.dashboard.recentReleaseTimelineDescription",
              )}
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            {i18n.t("previewPanel.deployment.dashboard.recordsCount", {
              count: info?.deployments.length || 0,
            })}
          </div>
        </div>
        <div className="p-5">
          {info?.deployments.length ? (
            <div className="space-y-4">
              {info.deployments.slice(0, 6).map((item, index) => (
                <div key={item.id} className="relative pl-6">
                  {index < Math.min(info.deployments.length, 6) - 1 ? (
                    <div className="absolute left-[7px] top-7 h-[calc(100%+12px)] w-px bg-slate-200" />
                  ) : null}
                  <div className="absolute left-0 top-1.5 size-4 rounded-full border border-border bg-card">
                    <div
                      className={cn(
                        "mx-auto mt-[3px] size-2 rounded-full",
                        item.status === "SUCCESS"
                          ? "bg-emerald-500"
                          : item.status === "FAILED" ||
                              item.status === "CRASHED"
                            ? "bg-rose-500"
                            : "bg-amber-500",
                      )}
                    />
                  </div>
                  <div className="flex flex-col gap-2 rounded-md border border-border/70 bg-muted/30 px-4 py-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground">
                        {item.commitMessage ||
                          i18n.t(
                            "previewPanel.deployment.overview.triggeredByOneceo",
                          )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>
                          {item.commitAuthor ||
                            i18n.t(
                              "previewPanel.deployment.overview.platformAutoPublish",
                            )}
                        </span>
                        <span className="size-1 rounded-full bg-slate-300" />
                        <span>
                          {formatPreviewTimestamp(item.createdAt) ||
                            item.createdAt ||
                            i18n.t("previewPanel.deployment.overview.unknownTime")}
                        </span>
                        <span className="size-1 rounded-full bg-slate-300" />
                        <span className="font-mono">{item.id.slice(0, 8)}</span>
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full border border-border bg-card px-2 py-1 text-[11px] text-foreground">
                      {item.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
              {i18n.t("previewPanel.deployment.dashboard.noTimeline")}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function DeploymentDatabaseSection({
  sessionId,
  info,
  statusMeta,
}: {
  sessionId?: string | null;
  info: TaskCreationDeploymentInfo | null;
  statusMeta: DeploymentStatusMeta;
}) {
  const [databaseInfo, setDatabaseInfo] =
    useState<TaskCreationDatabaseInfo | null>(null);
  const [rowsPage, setRowsPage] = useState<TaskCreationDatabaseRowsPage | null>(
    null,
  );
  const [databaseLoading, setDatabaseLoading] = useState(false);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<
    "insert" | "update" | "delete" | null
  >(null);
  const [databaseError, setDatabaseError] = useState<string | null>(null);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const [activeTableId, setActiveTableId] = useState<string | null>(null);
  const [panelMode, setPanelMode] = useState<"record" | "insert" | "settings">(
    "record",
  );
  const [selectedRowLocator, setSelectedRowLocator] =
    useState<TaskCreationDatabaseRowLocator | null>(null);
  const [selectedRowValues, setSelectedRowValues] = useState<
    Record<string, string>
  >({});
  const [page, setPage] = useState(1);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    const loadDatabase = async () => {
      setDatabaseLoading(true);
      setDatabaseError(null);
      try {
        const result = await getTaskCreationDatabaseInfo(sessionId);
        if (cancelled) return;
        setDatabaseInfo(result);
        setActiveTableId((current) => current || result?.tables[0]?.id || null);
      } catch (error) {
        if (cancelled) return;
        setDatabaseError(
          error instanceof Error
            ? error.message
            : i18n.t("previewPanel.deployment.database.loadInfoFailed"),
        );
      } finally {
        if (!cancelled) {
          setDatabaseLoading(false);
        }
      }
    };
    void loadDatabase();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || !activeTableId) return;
    let cancelled = false;
    const loadRows = async () => {
      setRowsLoading(true);
      setRowsError(null);
      try {
        const result = await getTaskCreationDatabaseRows(
          sessionId,
          activeTableId,
          page,
          50,
        );
        if (cancelled) return;
        setRowsPage(result);
        if (!result?.rows.length) {
          setSelectedRowLocator(null);
          if (panelMode === "record") {
            setPanelMode("insert");
          }
          return;
        }
        const currentRow = selectedRowLocator
          ? result.rows.find((row) =>
              matchRowLocator(row, selectedRowLocator, result.columns),
            )
          : null;
        const nextRow = currentRow || result.rows[0];
        const nextLocator = buildRowLocator(nextRow, result.columns);
        setSelectedRowLocator(nextLocator);
        if (panelMode === "record") {
          setSelectedRowValues(buildEditorValues(result.columns, nextRow));
        }
      } catch (error) {
        if (cancelled) return;
        setRowsError(
          error instanceof Error
            ? error.message
            : i18n.t("previewPanel.deployment.database.loadTablesFailed"),
        );
      } finally {
        if (!cancelled) {
          setRowsLoading(false);
        }
      }
    };
    void loadRows();
    return () => {
      cancelled = true;
    };
  }, [sessionId, activeTableId, page]);

  const activeTable =
    databaseInfo?.tables.find((table) => table.id === activeTableId) ||
    databaseInfo?.tables[0] ||
    null;
  const editorColumns = rowsPage?.columns || [];

  const handleRefresh = async () => {
    if (!sessionId) return;
    setDatabaseLoading(true);
    setRowsLoading(true);
    setDatabaseError(null);
    setRowsError(null);
    try {
      const [summary, rows] = await Promise.all([
        getTaskCreationDatabaseInfo(sessionId),
        activeTableId
          ? getTaskCreationDatabaseRows(sessionId, activeTableId, page, 50)
          : Promise.resolve(null),
      ]);
      setDatabaseInfo(summary);
      if (rows) setRowsPage(rows);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : i18n.t("previewPanel.deployment.database.refreshFailed");
      setDatabaseError(message);
      setRowsError(message);
    } finally {
      setDatabaseLoading(false);
      setRowsLoading(false);
    }
  };

  const handleSelectRow = (row: Record<string, unknown>) => {
    if (!rowsPage) return;
    const locator = buildRowLocator(row, rowsPage.columns);
    setSelectedRowLocator(locator);
    setSelectedRowValues(buildEditorValues(rowsPage.columns, row));
    setPanelMode("record");
  };

  const handleCreateNew = () => {
    if (!rowsPage) return;
    setPanelMode("insert");
    setSelectedRowLocator(null);
    setSelectedRowValues(buildEditorValues(rowsPage.columns));
  };

  const handleCopy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(key);
      window.setTimeout(
        () => setCopiedField((current) => (current === key ? null : current)),
        1200,
      );
    } catch {
      // ignore clipboard errors in preview panel
    }
  };

  const handleSave = async () => {
    if (!sessionId || !activeTableId || !rowsPage) return;
    setActionLoading(panelMode === "insert" ? "insert" : "update");
    setRowsError(null);
    try {
      if (panelMode === "insert") {
        await insertTaskCreationDatabaseRow(
          sessionId,
          activeTableId,
          buildMutationValues(rowsPage.columns, selectedRowValues),
        );
      } else {
        await updateTaskCreationDatabaseRow(
          sessionId,
          activeTableId,
          selectedRowLocator || {},
          buildMutationValues(rowsPage.columns, selectedRowValues),
        );
      }
      const refreshed = await getTaskCreationDatabaseRows(
        sessionId,
        activeTableId,
        page,
        50,
      );
      setRowsPage(refreshed);
      if (panelMode === "insert") {
        setPanelMode("record");
      }
      if (refreshed?.rows.length) {
        const targetRow = refreshed.rows[0];
        setSelectedRowLocator(buildRowLocator(targetRow, refreshed.columns));
        setSelectedRowValues(buildEditorValues(refreshed.columns, targetRow));
      }
    } catch (error) {
      setRowsError(
        error instanceof Error
          ? error.message
          : i18n.t("previewPanel.deployment.database.saveFailed"),
      );
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async () => {
    if (!sessionId || !activeTableId || !selectedRowLocator || !rowsPage)
      return;
    const confirmed = window.confirm(
      i18n.t("previewPanel.deployment.database.deleteConfirm"),
    );
    if (!confirmed) return;
    setActionLoading("delete");
    setRowsError(null);
    try {
      await deleteTaskCreationDatabaseRow(
        sessionId,
        activeTableId,
        selectedRowLocator,
      );
      const refreshed = await getTaskCreationDatabaseRows(
        sessionId,
        activeTableId,
        page,
        50,
      );
      setRowsPage(refreshed);
      if (refreshed?.rows.length) {
        const targetRow = refreshed.rows[0];
        setSelectedRowLocator(buildRowLocator(targetRow, refreshed.columns));
        setSelectedRowValues(buildEditorValues(refreshed.columns, targetRow));
        setPanelMode("record");
      } else {
        handleCreateNew();
      }
    } catch (error) {
      setRowsError(
        error instanceof Error
          ? error.message
          : i18n.t("previewPanel.deployment.database.deleteFailed"),
      );
    } finally {
      setActionLoading(null);
    }
  };

  if (!sessionId) {
    return (
      <EmptyState text={i18n.t("previewPanel.deployment.database.missingSession")} />
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[180px_minmax(0,1fr)_320px]">
      <section className="rounded-lg border border-border/70 bg-card">
        <div className="relative flex h-full flex-col">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-0 border-r border-border"
          />
          <div className="flex-1 space-y-2 overflow-y-auto overscroll-contain p-3">
            {databaseLoading && !databaseInfo ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">
                {i18n.t("previewPanel.deployment.database.preparing")}
              </div>
            ) : null}
            {databaseInfo?.tables.map((table) => (
              <button
                key={table.id}
                type="button"
                onClick={() => {
                  setActiveTableId(table.id);
                  setPage(1);
                  setPanelMode("record");
                }}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left transition-colors",
                  activeTableId === table.id
                    ? "bg-muted/50 text-foreground"
                    : "text-foreground hover:bg-muted/30",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {table.name}
                  </div>
                </div>
                <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                  {table.sourceLabel}
                </span>
              </button>
            ))}
            {!databaseLoading && !databaseInfo?.tables.length ? (
              <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                {i18n.t("previewPanel.deployment.database.readyNoTables")}
              </div>
            ) : null}
          </div>
          <div className="border-t border-border p-3">
            <Button
              variant="outline"
              className="w-full justify-center text-sm"
              onClick={() => setPanelMode("settings")}
            >
              <TableProperties className="size-4" />
              {i18n.t("previewPanel.deployment.database.settings")}
            </Button>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-border/70 bg-card">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-foreground">
              {activeTable
                ? activeTable.name
                : i18n.t("previewPanel.deployment.database.database")}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {activeTable
                ? `${activeTable.schema}.${activeTable.name}`
                : i18n.t("previewPanel.deployment.database.waitSelectTable")}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" className="h-8 text-xs">
              <TableProperties className="size-4" />
              {i18n.t("previewPanel.deployment.database.columnCount", {
                count: rowsPage?.columns.length || 0,
              })}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => void handleRefresh()}
            >
              <RefreshCw className="size-4" />
              {i18n.t("previewPanel.deployment.database.refresh")}
            </Button>
            <Button size="sm" className="h-8 text-xs" onClick={handleCreateNew}>
              <Plus className="size-4" />
              {i18n.t("previewPanel.deployment.database.newRecord")}
            </Button>
          </div>
        </div>

        {databaseError ? (
          <div className="px-4 pt-3 text-xs text-rose-600">{databaseError}</div>
        ) : null}
        {rowsError ? (
          <div className="px-4 pt-3 text-xs text-rose-600">{rowsError}</div>
        ) : null}

        <div className="min-h-0">
          {activeTable && rowsPage ? (
            <>
              <div className="max-h-[520px] overflow-auto">
                <table className="min-w-full border-separate border-spacing-0 text-sm">
                  <thead className="sticky top-0 z-10 bg-card">
                    <tr>
                      {rowsPage.columns.map((column) => (
                        <th
                          key={column.name}
                          className="border-b border-border px-3 py-2 text-left font-medium text-muted-foreground"
                        >
                          <div className="flex items-center gap-2">
                            <span>{column.name}</span>
                            {column.isPrimaryKey ? (
                              <KeyRound className="size-3.5 text-muted-foreground" />
                            ) : null}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rowsLoading ? (
                      <tr>
                        <td
                          colSpan={Math.max(rowsPage.columns.length, 1)}
                          className="px-4 py-16 text-center text-muted-foreground"
                        >
                          {i18n.t("previewPanel.deployment.database.loadingData")}
                        </td>
                      </tr>
                    ) : rowsPage.rows.length ? (
                      rowsPage.rows.map((row, index) => {
                        const locator = buildRowLocator(row, rowsPage.columns);
                        const active = selectedRowLocator
                          ? matchRowLocator(
                              row,
                              selectedRowLocator,
                              rowsPage.columns,
                            )
                          : index === 0;
                        return (
                          <tr
                            key={String(row._oneceo_ctid || index)}
                            className={cn(
                              "cursor-pointer transition-colors",
                              active ? "bg-muted/30" : "hover:bg-muted/40",
                            )}
                            onClick={() => handleSelectRow(row)}
                          >
                            {rowsPage.columns.map((column) => (
                              <td
                                key={column.name}
                                className="border-b border-border/70 px-3 py-2 align-top text-foreground"
                              >
                                <div className="max-w-[220px] truncate">
                                  {formatDatabaseCell(row[column.name])}
                                </div>
                              </td>
                            ))}
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td
                          colSpan={Math.max(rowsPage.columns.length, 1)}
                          className="px-4 py-16 text-center text-muted-foreground"
                        >
                          {i18n.t("previewPanel.deployment.database.noTableData")}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <span>
                    {i18n.t("previewPanel.deployment.database.rows", {
                      count: rowsPage.total,
                    })}
                  </span>
                  <span className="size-1 rounded-full bg-slate-300" />
                  <span>
                    {i18n.t("previewPanel.deployment.database.rowsPerPage", {
                      count: rowsPage.pageSize,
                    })}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    disabled={rowsPage.page <= 1}
                    onClick={() =>
                      setPage((current) => Math.max(1, current - 1))
                    }
                  >
                    <ChevronLeft className="size-4" />
                    {i18n.t("previewPanel.deployment.database.previousPage")}
                  </Button>
                  <span>
                    {i18n.t("previewPanel.deployment.database.pageIndicator", {
                      page: rowsPage.page,
                      total: rowsPage.totalPages,
                    })}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    disabled={rowsPage.page >= rowsPage.totalPages}
                    onClick={() => setPage((current) => current + 1)}
                  >
                    {i18n.t("previewPanel.deployment.database.nextPage")}
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="px-4 py-20 text-center text-sm text-muted-foreground">
              {databaseLoading
                ? i18n.t("previewPanel.deployment.database.connecting")
                : i18n.t("previewPanel.deployment.database.selectTableHint")}
            </div>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-border/70 bg-card">
        <div className="border-b border-border px-4 py-3">
          <div className="text-sm font-semibold text-foreground">
            {panelMode === "settings"
              ? i18n.t("previewPanel.deployment.database.connectionInfo")
              : panelMode === "insert"
                ? i18n.t("previewPanel.deployment.database.newRecord")
                : i18n.t("previewPanel.deployment.database.recordDetail")}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {panelMode === "settings"
              ? i18n.t("previewPanel.deployment.database.canCopyToClient")
              : activeTable
                ? `${activeTable.schema}.${activeTable.name}`
                : i18n.t("previewPanel.deployment.database.waitSelectTable")}
          </div>
        </div>

        <div className="space-y-4 p-4">
          {panelMode === "settings" && databaseInfo ? (
            <>
              <div className="grid gap-3">
                <ConnectionInfoField
                  label={i18n.t("previewPanel.deployment.database.connectionUrl")}
                  value={
                    databaseInfo.connection.publicConnectionUrl ||
                    databaseInfo.connection.connectionUrl
                  }
                  copied={copiedField === "url"}
                  onCopy={() =>
                    void handleCopy(
                      "url",
                      databaseInfo.connection.publicConnectionUrl ||
                        databaseInfo.connection.connectionUrl,
                    )
                  }
                />
                <ConnectionInfoField
                  label={i18n.t("previewPanel.deployment.database.host")}
                  value={databaseInfo.connection.host}
                  copied={copiedField === "host"}
                  onCopy={() =>
                    void handleCopy("host", databaseInfo.connection.host)
                  }
                />
                <ConnectionInfoField
                  label={i18n.t("previewPanel.deployment.database.port")}
                  value={databaseInfo.connection.port}
                  copied={copiedField === "port"}
                  onCopy={() =>
                    void handleCopy("port", databaseInfo.connection.port)
                  }
                />
                <ConnectionInfoField
                  label={i18n.t("previewPanel.deployment.database.username")}
                  value={databaseInfo.connection.username}
                  copied={copiedField === "username"}
                  onCopy={() =>
                    void handleCopy(
                      "username",
                      databaseInfo.connection.username,
                    )
                  }
                />
                <ConnectionInfoField
                  label={i18n.t("previewPanel.deployment.database.password")}
                  value={databaseInfo.connection.password}
                  copied={copiedField === "password"}
                  onCopy={() =>
                    void handleCopy(
                      "password",
                      databaseInfo.connection.password,
                    )
                  }
                  sensitive
                />
                <ConnectionInfoField
                  label={i18n.t("previewPanel.deployment.database.databaseName")}
                  value={databaseInfo.connection.database}
                  copied={copiedField === "database"}
                  onCopy={() =>
                    void handleCopy(
                      "database",
                      databaseInfo.connection.database,
                    )
                  }
                />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <DeploymentMiniStatus
                  label={i18n.t("previewPanel.deployment.database.databaseStatus")}
                  value={databaseInfo.latestDeploymentStatus || "UNKNOWN"}
                />
                <DeploymentMiniStatus
                  label={i18n.t("previewPanel.deployment.database.connectionMode")}
                  value={databaseInfo.connection.sslMode.toUpperCase()}
                />
                <DeploymentMiniStatus
                  label={i18n.t("previewPanel.deployment.database.volumeLabel")}
                  value={
                    databaseInfo.volumeName ||
                    i18n.t("previewPanel.deployment.database.mounted")
                  }
                />
                <DeploymentMiniStatus
                  label={i18n.t("previewPanel.deployment.database.appDeployment")}
                  value={
                    info?.configured
                      ? statusMeta.label
                      : i18n.t(
                          "previewPanel.deployment.database.deploymentPreparing",
                        )
                  }
                />
              </div>
            </>
          ) : rowsPage ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium text-foreground">
                  {panelMode === "insert"
                    ? i18n.t("previewPanel.deployment.database.prepareInsert")
                    : i18n.t("previewPanel.deployment.database.selectedRecord")}
                </div>
                {panelMode !== "settings" ? (
                  <div className="flex items-center gap-2">
                    {panelMode === "record" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs"
                        onClick={handleCreateNew}
                      >
                        <Plus className="size-4" />
                        {i18n.t("previewPanel.deployment.database.create")}
                      </Button>
                    ) : null}
                    {panelMode === "record" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs"
                        onClick={() => setPanelMode("record")}
                      >
                        <Pencil className="size-4" />
                        {i18n.t("previewPanel.deployment.database.edit")}
                      </Button>
                    ) : null}
                    {panelMode === "record" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs text-rose-600"
                        onClick={() => void handleDelete()}
                        disabled={actionLoading === "delete"}
                      >
                        <Trash2 className="size-4" />
                        {i18n.t("previewPanel.deployment.database.delete")}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="space-y-3">
                {editorColumns.map((column) => (
                  <DatabaseFieldEditor
                    key={column.name}
                    column={column}
                    value={selectedRowValues[column.name] || ""}
                    disabled={
                      panelMode === "record" ? column.isPrimaryKey : false
                    }
                    onChange={(nextValue) =>
                      setSelectedRowValues((current) => ({
                        ...current,
                        [column.name]: nextValue,
                      }))
                    }
                  />
                ))}
              </div>

              <div className="flex items-center gap-2 pt-2">
                <Button
                  size="sm"
                  className="h-8 text-xs"
                  disabled={Boolean(actionLoading)}
                  onClick={() => void handleSave()}
                >
                  {actionLoading === "insert" || actionLoading === "update" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : null}
                  {panelMode === "insert"
                    ? i18n.t("previewPanel.deployment.database.writeRecord")
                    : i18n.t("previewPanel.deployment.database.saveChanges")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setPanelMode("settings")}
                >
                  {i18n.t("previewPanel.deployment.database.viewConnectionInfo")}
                </Button>
              </div>
            </>
          ) : (
            <div className="py-10 text-center text-sm text-muted-foreground">
              {databaseLoading
                ? i18n.t("previewPanel.deployment.database.preparingPanel")
                : i18n.t("previewPanel.deployment.database.waitPanelReady")}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function DashboardModeToggle({
  mode,
  onChange,
}: {
  mode: "deployments" | "site";
  onChange: (mode: "deployments" | "site") => void;
}) {
  return (
    <div className="relative z-10 flex rounded-md border border-border/70 bg-muted/30 p-1 text-xs text-muted-foreground">
      <button
        type="button"
        onClick={() => onChange("deployments")}
        className={cn(
          "rounded-md px-3 py-1.5 transition-colors",
          mode === "deployments"
            ? "bg-card text-foreground shadow-sm"
            : "hover:text-foreground",
        )}
      >
        {i18n.t("previewPanel.deployment.dashboard.deploymentData")}
      </button>
      <button
        type="button"
        onClick={() => onChange("site")}
        className={cn(
          "rounded-md px-3 py-1.5 transition-colors",
          mode === "site"
            ? "bg-card text-foreground shadow-sm"
            : "hover:text-foreground",
        )}
      >
        {i18n.t("previewPanel.deployment.dashboard.siteData")}
      </button>
    </div>
  );
}

function CompactDeploymentMetric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="bg-card px-5 py-4">
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold text-foreground">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
    </div>
  );
}

function DashboardMiniStat({
  label,
  value,
  subtle = false,
}: {
  label: string;
  value: string;
  subtle?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-md border px-3 py-3",
        subtle
          ? "border-border/70 bg-muted/40"
          : "border-border bg-card",
      )}
    >
      <div className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "mt-2 text-sm font-medium",
          subtle ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function InsightCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-md border border-border/70 bg-muted/30 p-4">
      <div className="text-sm font-medium text-foreground">{title}</div>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
    </div>
  );
}

function ConnectionInfoField({
  label,
  value,
  copied,
  onCopy,
  sensitive = false,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
  sensitive?: boolean;
}) {
  return (
    <div className="rounded-md border border-border/70 bg-muted/30 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs uppercase tracking-[0.08em] text-muted-foreground">
          {label}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-[11px]"
          onClick={onCopy}
        >
          <Copy className="size-3.5" />
          {copied
            ? i18n.t("previewPanel.deployment.database.copied")
            : i18n.t("previewPanel.deployment.database.copy")}
        </Button>
      </div>
      <div className="mt-2 break-all font-mono text-xs text-foreground">
        {sensitive ? value : value}
      </div>
    </div>
  );
}

function DatabaseFieldEditor({
  column,
  value,
  disabled,
  onChange,
}: {
  column: TaskCreationDatabaseColumn;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const isLong =
    column.dataType.includes("json") ||
    column.dataType.includes("text") ||
    column.dataType.includes("timestamp");
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{column.name}</span>
        <span>{column.dataType}</span>
        {column.isPrimaryKey ? <KeyRound className="size-3.5" /> : null}
      </div>
      {isLong ? (
        <Textarea
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className="min-h-[88px] rounded-md border-border bg-card text-xs"
          placeholder={
            column.hasDefault
              ? column.defaultValue || ""
              : column.isNullable
                ? "null"
                : ""
          }
        />
      ) : (
        <Input
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 rounded-md border-border bg-card text-xs"
          placeholder={
            column.hasDefault
              ? column.defaultValue || ""
              : column.isNullable
                ? "null"
                : ""
          }
        />
      )}
    </div>
  );
}

function formatDatabaseCell(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "[object]";
    }
  }
  return String(value);
}

function buildRowLocator(
  row: Record<string, unknown>,
  columns: TaskCreationDatabaseColumn[],
): TaskCreationDatabaseRowLocator {
  const primaryKeys = columns.filter((column) => column.isPrimaryKey);
  if (primaryKeys.length) {
    return {
      primaryKey: Object.fromEntries(
        primaryKeys.map((column) => [column.name, row[column.name]]),
      ),
    };
  }
  return {
    ctid: typeof row._oneceo_ctid === "string" ? row._oneceo_ctid : undefined,
  };
}

function matchRowLocator(
  row: Record<string, unknown>,
  locator: TaskCreationDatabaseRowLocator,
  columns: TaskCreationDatabaseColumn[],
) {
  if (locator.ctid) {
    return row._oneceo_ctid === locator.ctid;
  }
  const primaryKey = locator.primaryKey || {};
  return columns
    .filter((column) => column.isPrimaryKey)
    .every(
      (column) =>
        String(row[column.name] ?? "") ===
        String(primaryKey[column.name] ?? ""),
    );
}

function buildEditorValues(
  columns: TaskCreationDatabaseColumn[],
  row?: Record<string, unknown>,
) {
  return Object.fromEntries(
    columns.map((column) => [
      column.name,
      row && row[column.name] !== undefined && row[column.name] !== null
        ? typeof row[column.name] === "object"
          ? JSON.stringify(row[column.name], null, 2)
          : String(row[column.name])
        : "",
    ]),
  );
}

function buildMutationValues(
  columns: TaskCreationDatabaseColumn[],
  values: Record<string, string>,
) {
  const result: Record<string, unknown> = {};
  columns.forEach((column) => {
    if (!(column.name in values)) return;
    const raw = values[column.name];
    if (!raw.trim()) {
      if (!column.isPrimaryKey) {
        result[column.name] = null;
      }
      return;
    }
    result[column.name] = raw;
  });
  return result;
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
      <section className="rounded-lg border border-border/70 bg-card">
        <div className="border-b border-border px-4 py-3 text-sm font-semibold text-foreground">
          {i18n.t("previewPanel.deployment.storage.title")}
        </div>
        <div className="grid gap-3 p-4 md:grid-cols-2">
          <DeploymentMetricCard
            title={i18n.t("previewPanel.deployment.storage.storageStatus")}
            value={i18n.t("previewPanel.deployment.storage.reservedEntry")}
            subtitle={i18n.t(
              "previewPanel.deployment.storage.reservedEntryDescription",
            )}
          />
          <DeploymentMetricCard
            title={i18n.t("previewPanel.deployment.storage.recommendedUsage")}
            value={i18n.t(
              "previewPanel.deployment.storage.recommendedUsageValue",
            )}
            subtitle={i18n.t(
              "previewPanel.deployment.storage.recommendedUsageDescription",
            )}
          />
          <div className="rounded-md border border-border/70 bg-muted/30 p-4 md:col-span-2">
            <div className="text-sm font-semibold text-foreground">
              {i18n.t("previewPanel.deployment.storage.visibleState")}
            </div>
            <div className="mt-2 grid gap-3 md:grid-cols-3">
              <DeploymentMiniStatus
                label={i18n.t("previewPanel.deployment.storage.appAccess")}
                value={statusMeta.label}
              />
              <DeploymentMiniStatus
                label={i18n.t("previewPanel.deployment.storage.defaultDomain")}
                value={
                  info?.domains.length
                    ? i18n.t("previewPanel.deployment.storage.generated")
                    : i18n.t("previewPanel.deployment.storage.pendingPublish")
                }
              />
              <DeploymentMiniStatus
                label={i18n.t("previewPanel.deployment.storage.objectStorage")}
                value={i18n.t("previewPanel.deployment.storage.futurePlan")}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-border/70 bg-card">
        <div className="border-b border-border px-4 py-3 text-sm font-semibold text-foreground">
          {i18n.t("previewPanel.deployment.storage.scenarioPlanning")}
        </div>
        <div className="space-y-3 p-4">
          <DeploymentPlaceholderCard
            title={i18n.t("previewPanel.deployment.storage.userUpload")}
            description={i18n.t(
              "previewPanel.deployment.storage.userUploadDescription",
            )}
          />
          <DeploymentPlaceholderCard
            title={i18n.t(
              "previewPanel.deployment.storage.buildArtifactSeparation",
            )}
            description={i18n.t(
              "previewPanel.deployment.storage.buildArtifactSeparationDescription",
            )}
          />
          <DeploymentPlaceholderCard
            title={i18n.t("previewPanel.deployment.storage.accessPolicy")}
            description={i18n.t(
              "previewPanel.deployment.storage.accessPolicyDescription",
            )}
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
  tokenRotationLoading,
  onRotateDeploymentToken,
}: {
  info: TaskCreationDeploymentInfo | null;
  statusMeta: DeploymentStatusMeta;
  currentDeployment: TaskCreationDeploymentInfo["deployments"][number] | null;
  primaryAccessUrl: string;
  accessEntries: Array<[string, string] | readonly [string, string]>;
  settingsSection: DeploymentSettingsSection;
  onSettingsSectionChange: (value: DeploymentSettingsSection) => void;
  tokenRotationLoading: boolean;
  onRotateDeploymentToken: () => void;
}) {
  const resourceBinding = info?.resourceBinding;
  const tokenRotationLabel = resourceBinding?.tokenRotatedAt
    ? formatPreviewTimestamp(resourceBinding.tokenRotatedAt) ||
      resourceBinding.tokenRotatedAt
    : i18n.t("previewPanel.deployment.settings.notRecorded");
  const isolationLabel =
    resourceBinding?.isolationMode === "session"
      ? i18n.t("previewPanel.deployment.settings.sharedUserProject")
      : resourceBinding
        ? i18n.t("previewPanel.deployment.settings.defaultSharedResource")
        : i18n.t("previewPanel.deployment.settings.createAfterFirstDeploy");
  const repositoryLabel =
    resourceBinding?.repositoryFullName ||
    i18n.t("previewPanel.deployment.settings.managedRepoMissing");
  const repositoryBranch =
    resourceBinding?.repositoryBranch || "main";

  return (
    <div className="grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)]">
      <section className="rounded-lg border border-border/70 bg-card">
        <div className="border-b border-border px-4 py-3 text-sm font-semibold text-foreground">
          {i18n.t("previewPanel.deployment.sections.settings")}
        </div>
        <div className="flex gap-2 overflow-x-auto p-3 xl:flex-col xl:overflow-visible">
          <DeploymentSettingsButton
            active={settingsSection === "general"}
            label={i18n.t("previewPanel.deployment.settings.general")}
            onClick={() => onSettingsSectionChange("general")}
          />
          <DeploymentSettingsButton
            active={settingsSection === "domain"}
            label={i18n.t("previewPanel.deployment.settings.domain")}
            onClick={() => onSettingsSectionChange("domain")}
          />
          <DeploymentSettingsButton
            active={settingsSection === "notifications"}
            label={i18n.t("previewPanel.deployment.settings.notifications")}
            onClick={() => onSettingsSectionChange("notifications")}
          />
          <DeploymentSettingsButton
            active={settingsSection === "payment"}
            label={i18n.t("previewPanel.deployment.settings.payment")}
            onClick={() => onSettingsSectionChange("payment")}
          />
          <DeploymentSettingsButton
            active={settingsSection === "seo"}
            label="SEO"
            onClick={() => onSettingsSectionChange("seo")}
          />
          <DeploymentSettingsButton
            active={settingsSection === "keys"}
            label={i18n.t("previewPanel.deployment.settings.keys")}
            onClick={() => onSettingsSectionChange("keys")}
          />
          <DeploymentSettingsButton
            active={settingsSection === "github"}
            label="GitHub"
            onClick={() => onSettingsSectionChange("github")}
          />
        </div>
      </section>

      <section className="rounded-lg border border-border/70 bg-card">
        <div className="border-b border-border px-4 py-3 text-sm font-semibold text-foreground">
          {settingsSection === "general"
            ? i18n.t("previewPanel.deployment.settings.general")
            : null}
          {settingsSection === "domain"
            ? i18n.t("previewPanel.deployment.settings.domain")
            : null}
          {settingsSection === "notifications"
            ? i18n.t("previewPanel.deployment.settings.notifications")
            : null}
          {settingsSection === "payment"
            ? i18n.t("previewPanel.deployment.settings.payment")
            : null}
          {settingsSection === "seo" ? "SEO" : null}
          {settingsSection === "keys"
            ? i18n.t("previewPanel.deployment.settings.keys")
            : null}
          {settingsSection === "github" ? "GitHub" : null}
        </div>
        <div className="p-4">
          {settingsSection === "general" ? (
            <div className="grid gap-3 md:grid-cols-2">
              <DeploymentInfoCard
                title={i18n.t("previewPanel.deployment.settings.siteName")}
                value={
                  info?.serviceName ||
                  info?.projectName ||
                  i18n.t("previewPanel.deployment.settings.unnamedApp")
                }
                extra={i18n.t("previewPanel.deployment.settings.managedWorkflow")}
              />
              <DeploymentInfoCard
                title={i18n.t("previewPanel.deployment.settings.publishStatus")}
                value={statusMeta.label}
                extra={statusMeta.description}
              />
              <DeploymentInfoCard
                title={i18n.t("previewPanel.deployment.settings.environment")}
                value={
                  info?.environmentName ||
                  info?.environmentId ||
                  i18n.t("previewPanel.deployment.dashboard.unconfigured")
                }
              />
              <DeploymentInfoCard
                title={i18n.t("previewPanel.deployment.settings.currentVersion")}
                value={
                  currentDeployment?.commitMessage ||
                  i18n.t("previewPanel.deployment.overview.waitingFirstRelease")
                }
                extra={
                  currentDeployment?.id
                    ? i18n.t("previewPanel.deployment.settings.versionId", {
                        id: currentDeployment.id.slice(0, 8),
                      })
                    : undefined
                }
              />
            </div>
          ) : null}

          {settingsSection === "domain" ? (
            <div className="space-y-3">
              <DeploymentInfoCard
                title={i18n.t("previewPanel.deployment.settings.primaryAccessUrl")}
                value={
                  primaryAccessUrl ||
                  i18n.t("previewPanel.deployment.settings.notGenerated")
                }
                extra={
                  primaryAccessUrl
                    ? i18n.t("previewPanel.deployment.settings.readyForValidation")
                    : i18n.t(
                        "previewPanel.deployment.settings.generatedAfterFirstPublish",
                      )
                }
              />
              <div className="grid gap-3 md:grid-cols-2">
                {accessEntries.length ? (
                  accessEntries.map(([label, value]) => (
                    <DeploymentInfoCard
                      key={`${label}-${value}`}
                      title={label}
                      value={value}
                    />
                  ))
                ) : (
                  <DeploymentPlaceholderCard
                    title={i18n.t("previewPanel.deployment.settings.emptyDomainList")}
                    description={i18n.t(
                      "previewPanel.deployment.settings.emptyDomainListDescription",
                    )}
                  />
                )}
              </div>
            </div>
          ) : null}

          {settingsSection === "notifications" ? (
            <div className="grid gap-3 md:grid-cols-2">
              <DeploymentInfoCard
                title={i18n.t(
                  "previewPanel.deployment.settings.publishSuccessNotification",
                )}
                value={i18n.t("previewPanel.deployment.settings.comingSoon")}
                extra={i18n.t(
                  "previewPanel.deployment.settings.publishSuccessNotificationDescription",
                )}
              />
              <DeploymentInfoCard
                title={i18n.t(
                  "previewPanel.deployment.settings.publishFailureNotification",
                )}
                value={i18n.t("previewPanel.deployment.settings.comingSoon")}
                extra={i18n.t(
                  "previewPanel.deployment.settings.publishFailureNotificationDescription",
                )}
              />
              <DeploymentInfoCard
                title={i18n.t(
                  "previewPanel.deployment.settings.rollbackNotification",
                )}
                value={i18n.t("previewPanel.deployment.settings.comingSoon")}
                extra={i18n.t(
                  "previewPanel.deployment.settings.rollbackNotificationDescription",
                )}
              />
              <DeploymentInfoCard
                title={i18n.t("previewPanel.deployment.settings.currentStrategy")}
                value={i18n.t("previewPanel.deployment.settings.platformSilent")}
                extra={i18n.t(
                  "previewPanel.deployment.settings.currentStrategyDescription",
                )}
              />
            </div>
          ) : null}

          {settingsSection === "payment" ? (
            <div className="grid gap-3 md:grid-cols-2">
              <DeploymentInfoCard
                title={i18n.t("previewPanel.deployment.settings.billingMode")}
                value={i18n.t("previewPanel.deployment.settings.platformBilling")}
                extra={i18n.t("previewPanel.deployment.settings.billingDescription")}
              />
              <DeploymentInfoCard
                title={i18n.t("previewPanel.deployment.settings.userBilling")}
                value={i18n.t("previewPanel.deployment.settings.notOpen")}
                extra={i18n.t(
                  "previewPanel.deployment.settings.userBillingDescription",
                )}
              />
              <DeploymentInfoCard
                title={i18n.t("previewPanel.deployment.settings.usageAlert")}
                value={i18n.t("previewPanel.deployment.settings.comingSoon")}
                extra={i18n.t(
                  "previewPanel.deployment.settings.comingSoon",
                )}
              />
              <DeploymentInfoCard
                title={i18n.t(
                  "previewPanel.deployment.settings.upgradeCapability",
                )}
                value={i18n.t("previewPanel.deployment.settings.toExpand")}
                extra={i18n.t(
                  "previewPanel.deployment.settings.upgradeCapabilityDescription",
                )}
              />
            </div>
          ) : null}

          {settingsSection === "seo" ? (
            <div className="grid gap-3 md:grid-cols-2">
              <DeploymentInfoCard
                title={i18n.t("previewPanel.deployment.settings.siteTitle")}
                value={
                  info?.serviceName ||
                  info?.projectName ||
                  i18n.t("previewPanel.deployment.settings.defaultSiteTitle")
                }
                extra={i18n.t(
                  "previewPanel.deployment.settings.siteTitleDescription",
                )}
              />
              <DeploymentInfoCard
                title={i18n.t("previewPanel.deployment.settings.indexEntry")}
                value={
                  primaryAccessUrl ||
                  i18n.t("previewPanel.deployment.settings.generateAfterPublish")
                }
                extra={i18n.t(
                  "previewPanel.deployment.settings.indexEntryDescription",
                )}
              />
              <DeploymentInfoCard
                title="Meta / Open Graph"
                value={i18n.t("previewPanel.deployment.settings.comingSoon")}
                extra={i18n.t(
                  "previewPanel.deployment.settings.metaOpenGraphDescription",
                )}
              />
              <DeploymentInfoCard
                title={i18n.t("previewPanel.deployment.settings.siteMap")}
                value={i18n.t("previewPanel.deployment.settings.toExpand")}
                extra={i18n.t("previewPanel.deployment.settings.siteMapDescription")}
              />
            </div>
          ) : null}

          {settingsSection === "keys" ? (
            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <DeploymentInfoCard
                  title={i18n.t(
                    "previewPanel.deployment.settings.deploymentTokenModel",
                  )}
                  value={
                    resourceBinding
                      ? i18n.t(
                          "previewPanel.deployment.settings.railwayProjectToken",
                        )
                      : i18n.t("previewPanel.deployment.settings.toCreate")
                  }
                  extra={i18n.t(
                    "previewPanel.deployment.settings.deploymentTokenDescription",
                  )}
                />
                <DeploymentInfoCard
                  title={i18n.t("previewPanel.deployment.settings.scope")}
                  value={
                    resourceBinding?.tokenScope === "railway_project_environment"
                      ? i18n.t(
                          "previewPanel.deployment.settings.projectEnvironmentScope",
                        )
                      : i18n.t("previewPanel.deployment.settings.toCreate")
                  }
                  extra={i18n.t("previewPanel.deployment.settings.scopeDescription")}
                />
                <DeploymentInfoCard
                  title={i18n.t("previewPanel.deployment.settings.resourceIsolation")}
                  value={isolationLabel}
                  extra={
                    resourceBinding?.projectKey
                      ? i18n.t("previewPanel.deployment.settings.resourceKey", {
                          key: resourceBinding.projectKey,
                        })
                      : i18n.t(
                          "previewPanel.deployment.settings.resourceIsolationDescription",
                        )
                  }
                  mono={Boolean(resourceBinding?.projectKey)}
                />
                <DeploymentInfoCard
                  title={i18n.t("previewPanel.deployment.settings.lastRotation")}
                  value={tokenRotationLabel}
                  extra={i18n.t(
                    "previewPanel.deployment.settings.lastRotationDescription",
                  )}
                />
                <DeploymentInfoCard
                  title={i18n.t("previewPanel.deployment.settings.credentialId")}
                  value={
                    resourceBinding?.tokenId ||
                    i18n.t("previewPanel.deployment.settings.credentialIdMissing")
                  }
                  extra={i18n.t(
                    "previewPanel.deployment.settings.credentialIdDescription",
                  )}
                  mono
                />
                <DeploymentInfoCard
                  title={i18n.t("previewPanel.deployment.settings.customEnvVars")}
                  value={i18n.t("previewPanel.deployment.settings.comingSoon")}
                  extra={i18n.t(
                    "previewPanel.deployment.settings.customEnvVarsDescription",
                  )}
                />
              </div>
              <div className="flex flex-col gap-3 rounded-md border border-border/70 bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">
                    {i18n.t("previewPanel.deployment.settings.rotateCurrentToken")}
                  </div>
                  <div className="mt-1 text-xs leading-5 text-muted-foreground">
                    {i18n.t(
                      "previewPanel.deployment.settings.rotateCurrentTokenDescription",
                    )}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 w-full sm:w-auto"
                  onClick={onRotateDeploymentToken}
                  disabled={!resourceBinding || tokenRotationLoading}
                >
                  {tokenRotationLoading ? (
                    <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-1.5 size-3.5" />
                  )}
                  {i18n.t("previewPanel.deployment.settings.rotateToken")}
                </Button>
              </div>
            </div>
          ) : null}

          {settingsSection === "github" ? (
            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <DeploymentInfoCard
                  title={i18n.t("previewPanel.deployment.settings.managedRepo")}
                  value={repositoryLabel}
                  extra={i18n.t(
                    "previewPanel.deployment.settings.managedRepoDescription",
                  )}
                  mono={Boolean(resourceBinding?.repositoryFullName)}
                />
                <DeploymentInfoCard
                  title={i18n.t("previewPanel.deployment.settings.defaultBranch")}
                  value={repositoryBranch}
                  extra={i18n.t(
                    "previewPanel.deployment.settings.triggerModeDescription",
                  )}
                  mono
                />
                <DeploymentInfoCard
                  title={i18n.t("previewPanel.deployment.settings.triggerMode")}
                  value={i18n.t("previewPanel.deployment.settings.publishAfterPush")}
                  extra={i18n.t(
                    "previewPanel.deployment.settings.triggerModeDescription",
                  )}
                />
                <DeploymentInfoCard
                  title={i18n.t(
                    "previewPanel.deployment.settings.lastSyncedVersion",
                  )}
                  value={
                    currentDeployment?.commitMessage ||
                    i18n.t("previewPanel.deployment.settings.waitingFirstSync")
                  }
                  extra={
                    currentDeployment?.id
                      ? i18n.t("previewPanel.deployment.settings.syncId", {
                          id: currentDeployment.id.slice(0, 8),
                        })
                      : undefined
                  }
                />
              </div>
              {resourceBinding?.repositoryUrl ? (
                <a
                  href={resourceBinding.repositoryUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/30 sm:w-auto"
                >
                  {i18n.t("previewPanel.deployment.settings.openManagedRepo")}
                  <ExternalLink className="size-4" />
                </a>
              ) : (
                <DeploymentPlaceholderCard
                  title={i18n.t(
                    "previewPanel.deployment.settings.managedRepoNotGenerated",
                  )}
                  description={i18n.t(
                    "previewPanel.deployment.settings.managedRepoNotGeneratedDescription",
                  )}
                />
              )}
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
        "inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap",
        active
          ? "border-border bg-muted/50 text-foreground"
          : "border-transparent bg-transparent text-muted-foreground hover:border-border hover:bg-muted/30",
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
        "rounded-md border px-3 py-2 text-left text-sm transition-colors whitespace-nowrap",
        active
          ? "border-border bg-muted/50 text-foreground"
          : "border-transparent bg-transparent text-muted-foreground hover:border-border hover:bg-muted/30",
      )}
    >
      {label}
    </button>
  );
}

function DeploymentTemplateBaselineSection({
  baseline,
  loading,
  error,
}: {
  baseline: TaskCreationDeploymentTemplateBaseline | null;
  loading: boolean;
  error: string | null;
}) {
  const checkedAt = baseline?.checkedAt
    ? formatPreviewTimestamp(baseline.checkedAt) || baseline.checkedAt
    : i18n.t("previewPanel.deployment.baseline.notChecked");
  const overallValue =
    loading
      ? i18n.t("previewPanel.deployment.baseline.checking")
      : error
        ? i18n.t("previewPanel.deployment.baseline.readFailed")
        : baseline?.status === "ready"
          ? i18n.t("previewPanel.deployment.baseline.passed")
          : baseline?.status === "needs_attention"
            ? i18n.t("previewPanel.deployment.baseline.needsAttention")
            : i18n.t("previewPanel.deployment.baseline.pending");
  const overallSubtitle =
    error ||
    (baseline?.status === "ready"
      ? i18n.t("previewPanel.deployment.baseline.readyDescription")
      : baseline?.status === "needs_attention"
        ? i18n.t("previewPanel.deployment.baseline.needsAttentionDescription")
        : i18n.t("previewPanel.deployment.baseline.pendingDescription"));
  const manifestValue = !baseline
    ? i18n.t("previewPanel.deployment.baseline.pending")
    : baseline.manifestGenerated
      ? i18n.t("previewPanel.deployment.baseline.platformFilled")
      : baseline.manifestPath
        ? i18n.t("previewPanel.deployment.baseline.exists")
        : i18n.t("previewPanel.deployment.baseline.missing");
  const analyticsValue = !baseline
    ? i18n.t("previewPanel.deployment.baseline.pending")
    : baseline.analyticsMode === "platform_injected"
      ? i18n.t("previewPanel.deployment.baseline.platformInjected")
      : baseline.analyticsMode === "workspace"
        ? i18n.t("previewPanel.deployment.baseline.sourceIntegrated")
        : baseline.analyticsMode === "missing"
          ? i18n.t("previewPanel.deployment.baseline.missing")
          : i18n.t("previewPanel.deployment.baseline.unknown");
  const databaseValue =
    !baseline || !baseline.features
      ? i18n.t("previewPanel.deployment.baseline.pending")
      : baseline.features.database === "railway_postgres"
        ? baseline.checks.database === false
          ? i18n.t("previewPanel.deployment.baseline.dependencyMissing")
          : "Railway Postgres"
        : i18n.t("previewPanel.deployment.baseline.notDeclared");
  const healthcheckValue =
    !baseline
      ? i18n.t("previewPanel.deployment.baseline.pending")
      : baseline.checks.healthcheck === false
        ? i18n.t("previewPanel.deployment.baseline.routePending")
        : baseline.healthcheckPath ||
          i18n.t("previewPanel.deployment.baseline.notDeclared");

  return (
    <section className="rounded-lg border border-border/70 bg-card">
      <div className="border-b border-border px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-semibold text-foreground">
              {i18n.t("previewPanel.deployment.baseline.title")}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {i18n.t("previewPanel.deployment.baseline.description")}
            </div>
          </div>
          <div className="rounded-full border border-border bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
            {i18n.t("previewPanel.deployment.baseline.lastCheck")}:{" "}
            <span className="font-medium text-foreground">{checkedAt}</span>
          </div>
        </div>
      </div>

      <div className="space-y-4 p-4 sm:p-5">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <DeploymentMetricCard
            title={i18n.t("previewPanel.deployment.baseline.overallStatus")}
            value={overallValue}
            subtitle={overallSubtitle}
          />
          <DeploymentMetricCard
            title="Manifest"
            value={manifestValue}
            subtitle={
              baseline?.manifestPath ||
              i18n.t("previewPanel.deployment.baseline.manifestWait")
            }
          />
          <DeploymentMetricCard
            title={i18n.t("previewPanel.deployment.baseline.analyticsInjection")}
            value={analyticsValue}
            subtitle={
              baseline?.checks.analytics === false
                ? i18n.t(
                    "previewPanel.deployment.baseline.analyticsInjectionMissing",
                  )
                : baseline?.buildCommand
                  ? i18n.t("previewPanel.deployment.baseline.buildCommand", {
                      command: baseline.buildCommand,
                    })
                  : i18n.t(
                      "previewPanel.deployment.baseline.platformInjectAtExport",
                    )
            }
          />
          <DeploymentMetricCard
            title={i18n.t("previewPanel.deployment.baseline.databaseContract")}
            value={databaseValue}
            subtitle={
              baseline?.features?.database === "railway_postgres"
                ? baseline.checks.database === false
                  ? i18n.t(
                      "previewPanel.deployment.baseline.databaseContractMissingDeps",
                    )
                  : i18n.t(
                      "previewPanel.deployment.baseline.databaseContractReady",
                    )
                : i18n.t(
                    "previewPanel.deployment.baseline.databaseContractNone",
                  )
            }
          />
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <DeploymentInfoCard
            title={i18n.t("previewPanel.deployment.baseline.startCommand")}
            value={
              baseline?.startCommand ||
              i18n.t("previewPanel.deployment.baseline.pending")
            }
            extra={
              baseline?.checks.start === false
                ? i18n.t("previewPanel.deployment.baseline.missingStartScript")
                : i18n.t("previewPanel.deployment.baseline.platformStartCommand")
            }
          />
          <DeploymentInfoCard
            title={i18n.t("previewPanel.deployment.baseline.healthcheck")}
            value={healthcheckValue}
            extra={
              baseline?.checks.healthcheck === false
                ? i18n.t(
                    "previewPanel.deployment.baseline.healthcheckRouteMissing",
                  )
                : i18n.t("previewPanel.deployment.baseline.healthcheckProbe")
            }
          />
          <DeploymentInfoCard
            title={i18n.t("previewPanel.deployment.baseline.userTracking")}
            value={
              !baseline?.features
                ? i18n.t("previewPanel.deployment.baseline.pending")
                : baseline.features.userTracking
                  ? i18n.t("previewPanel.deployment.baseline.declared")
                  : i18n.t("previewPanel.deployment.baseline.notDeclared")
            }
            extra={i18n.t("previewPanel.deployment.baseline.userTrackingDescription")}
          />
          <DeploymentInfoCard
            title={i18n.t("previewPanel.deployment.baseline.objectStorage")}
            value={
              !baseline?.features
                ? i18n.t("previewPanel.deployment.baseline.pending")
                : baseline.features.objectStorage
                  ? i18n.t("previewPanel.deployment.baseline.enabled")
                  : i18n.t("previewPanel.deployment.baseline.notDeclared")
            }
            extra={i18n.t("previewPanel.deployment.baseline.objectStorageDescription")}
          />
        </div>

        {baseline?.warnings.length ? (
          <div className="rounded-md border border-amber-200 bg-amber-50/70 p-4">
            <div className="text-sm font-medium text-amber-900">
              {i18n.t("previewPanel.deployment.baseline.warnings")}
            </div>
            <div className="mt-2 space-y-1 text-xs leading-5 text-amber-800">
              {baseline.warnings.map((item) => (
                <div key={item}>- {item}</div>
              ))}
            </div>
          </div>
        ) : null}

        {baseline?.errors.length ? (
          <div className="rounded-md border border-rose-200 bg-rose-50/70 p-4">
            <div className="text-sm font-medium text-rose-900">
              {i18n.t("previewPanel.deployment.baseline.errors")}
            </div>
            <div className="mt-2 space-y-1 text-xs leading-5 text-rose-800">
              {baseline.errors.map((item) => (
                <div key={item}>- {item}</div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
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
    <div
      className={cn(
        "rounded-md border border-border/70 bg-muted/30 p-3",
        className,
      )}
    >
      <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {title}
      </div>
      <div className="mt-2 text-sm font-semibold text-foreground">{value}</div>
      {subtitle ? (
        <div className="mt-1 text-xs leading-5 text-muted-foreground">{subtitle}</div>
      ) : null}
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
    <div className="rounded-md border border-border/70 bg-muted/30 p-4">
      <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {title}
      </div>
      <div
        className={cn(
          "mt-2 text-sm font-medium text-foreground break-all",
          mono ? "font-mono text-[12px]" : "",
        )}
      >
        {value}
      </div>
      {extra ? (
        <div className="mt-1 text-xs leading-5 text-muted-foreground">{extra}</div>
      ) : null}
    </div>
  );
}

function DeploymentMiniStatus({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-border/70 bg-muted/20 px-3 py-3">
      <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-sm font-medium text-foreground">{value}</div>
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
    <div className="rounded-md border border-dashed border-border bg-muted/30 p-4">
      <div className="text-sm font-semibold text-foreground">{title}</div>
      <div className="mt-1 text-sm leading-6 text-muted-foreground">{description}</div>
    </div>
  );
}

export function DebugPreview({
  info,
  loading,
  error,
  runtimeReady,
  starting,
  onStart,
  onRequestStartDebugByMessage,
}: {
  info: TaskCreationDebugInfo | null;
  loading: boolean;
  error: string | null;
  runtimeReady: boolean;
  starting: boolean;
  onStart: () => void;
  onRequestStartDebugByMessage?: () => void;
}) {
  const [debugLocked, setDebugLocked] = useState(true);
  const [bridgeReady, setBridgeReady] = useState(false);
  const [bridgeWaitExpired, setBridgeWaitExpired] = useState(false);
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  const requestStartDebug = () => {
    if (onRequestStartDebugByMessage) {
      onRequestStartDebugByMessage();
      return;
    }
    onStart();
  };

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
        url.searchParams.set(
          "username",
          url.searchParams.get("usr") || "oneceo",
        );
      }
      if (!url.searchParams.get("password")) {
        url.searchParams.set(
          "password",
          url.searchParams.get("pwd") || "oneceo",
        );
      }
      if (!url.searchParams.get("autoconnect")) {
        url.searchParams.set("autoconnect", "1");
      }
      if (!url.searchParams.get("volume")) {
        url.searchParams.set("volume", "0");
      }
      if (!url.searchParams.get("mute")) {
        url.searchParams.set("mute", "1");
      }
      if (!url.searchParams.get("mute_chat")) {
        url.searchParams.set("mute_chat", "1");
      }
      return url.toString();
    } catch {
      return info.url;
    }
  }, [info?.url]);

  const requestNekoLockState = useCallback(
    (nextLocked: boolean) => {
      const frame = frameRef.current;
      const target = frame?.contentWindow;
      try {
        if (target) {
          target.postMessage(
            {
              source: "oneceo-debug-lock:set",
              locked: nextLocked,
            },
            "*",
          );
        }
      } catch {
        // ignore cross-origin postMessage failures; keep local state
      }
    },
    [],
  );

  useEffect(() => {
    setDebugLocked(true);
    setBridgeReady(false);
    setBridgeWaitExpired(false);
    if (!debugUrl) return;
    const timer = window.setTimeout(() => {
      setBridgeWaitExpired(true);
    }, 4000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [debugUrl]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!frameRef.current?.contentWindow || event.source !== frameRef.current.contentWindow) {
        return;
      }
      const payload = event.data as
        | { source?: string; locked?: boolean; version?: string }
        | null
        | undefined;
      if (!payload) {
        return;
      }
      if (payload.source === "oneceo-neko-ready") {
        setBridgeReady(true);
        setBridgeWaitExpired(false);
        if (typeof payload.locked === "boolean") {
          setDebugLocked(payload.locked);
        }
        return;
      }
      if (payload.source !== "oneceo-neko-lock") {
        return;
      }
      setBridgeReady(true);
      if (typeof payload.locked === "boolean") {
        setDebugLocked(payload.locked);
      }
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
    };
  }, []);

  const isFailed = info?.status === "failed";
  const lockControlEnabled = bridgeReady;

  if (!runtimeReady) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-xs text-muted-foreground gap-3">
        <span>
          {starting
            ? i18n.t("previewPanel.debug.startingRuntime")
            : i18n.t("previewPanel.debug.runtimeNotStarted")}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            requestStartDebug();
          }}
          disabled={starting}
        >
          {i18n.t("previewPanel.debug.startDebug")}
        </Button>
      </div>
    );
  }
  if (loading) {
    return <EmptyState text={i18n.t("previewPanel.debug.loading")} />;
  }
  if (error && (!info?.ready || !info?.url)) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-xs text-muted-foreground gap-2">
        <span>{error}</span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            requestStartDebug();
          }}
          disabled={starting}
        >
          {starting
            ? i18n.t("previewPanel.debug.retrying")
            : i18n.t("previewPanel.debug.reenable")}
        </Button>
      </div>
    );
  }
  if (!info?.ready || !info.url) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-xs text-muted-foreground gap-3">
        <span>
          {info?.message ||
            (isFailed
              ? i18n.t("previewPanel.debug.connectionFailed")
              : i18n.t("previewPanel.debug.serviceNotReady"))}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            requestStartDebug();
          }}
          disabled={starting}
        >
          {starting
            ? i18n.t("previewPanel.debug.enabling")
            : isFailed
              ? i18n.t("previewPanel.debug.retryEnable")
              : i18n.t("previewPanel.debug.enable")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <div className="text-xs text-muted-foreground">{i18n.t("previewPanel.debug.remoteBrowserDebug")}</div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant={debugLocked ? "default" : "outline"}
            size="sm"
            className="h-7 px-2 text-[11px]"
            disabled={!lockControlEnabled}
            onClick={() => {
              if (!lockControlEnabled) return;
              requestNekoLockState(!debugLocked);
            }}
          >
            {debugLocked ? (
              <>
                <Lock className="mr-1 h-3.5 w-3.5" />
                {i18n.t("previewPanel.debug.locked")}
              </>
            ) : (
              <>
                <Unlock className="mr-1 h-3.5 w-3.5" />
                {i18n.t("previewPanel.debug.unlocked")}
              </>
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-[11px]"
            onClick={() => {
              requestStartDebug();
            }}
            disabled={starting}
          >
            {starting ? i18n.t("previewPanel.debug.enabling") : i18n.t("previewPanel.debug.enable")}
          </Button>
          <a
            href={debugUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-[var(--brand-link)] hover:text-[var(--brand-link-hover)]"
          >
            {i18n.t("previewPanel.openInNewWindow")}
          </a>
        </div>
      </div>
      <div className="flex-1 min-h-0 p-3">
        {!lockControlEnabled && bridgeWaitExpired ? (
          <div className="mb-2 rounded-md border border-amber-300/70 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
            {i18n.t("previewPanel.debug.bridgeUnavailable")}
          </div>
        ) : null}
        <div
          className="group relative h-full w-full rounded-xl border border-border overflow-hidden bg-black/5"
        >
          <iframe
            ref={frameRef}
            title="remote-debug"
            src={debugUrl}
            className="h-full w-full"
            allow="autoplay; clipboard-read; clipboard-write; fullscreen; microphone; camera; display-capture"
            onLoad={() => {
              if (lockControlEnabled) {
                requestNekoLockState(debugLocked);
              }
            }}
          />
          {debugLocked ? (
            <button
              type="button"
              className={cn(
                "absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/10 opacity-0 transition-opacity duration-150",
                lockControlEnabled
                  ? "pointer-events-none group-hover:pointer-events-auto group-hover:opacity-100"
                  : "pointer-events-none opacity-0",
              )}
              onClick={() => {
                if (!lockControlEnabled) return;
                requestNekoLockState(false);
              }}
              aria-label={i18n.t("previewPanel.debug.unlockHintAria")}
            >
              <span className="flex h-24 w-24 items-center justify-center rounded-full border border-white/60 bg-black/40 text-white shadow-lg backdrop-blur-[2px]">
                <Lock className="h-10 w-10" />
              </span>
              <span className="mt-3 rounded-full border border-white/30 bg-black/35 px-3 py-1 text-xs text-white/90">
                {i18n.t("previewPanel.debug.clickToUnlock")}
              </span>
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function DiffBlock({
  diff,
  files,
}: {
  diff?: string;
  files?: StructuredFileDiff[];
}) {
  const structuredFiles = useMemo(() => parseStructuredDiffs(files), [files]);
  const unifiedFiles = useMemo(
    () => (diff ? parseUnifiedDiffDetailed(diff) : []),
    [diff],
  );
  const fallbackFiles = useMemo(
    () => (diff ? parseApplyPatchDiff(diff) : []),
    [diff],
  );
  const baseFiles =
    structuredFiles.length > 0
      ? structuredFiles
      : unifiedFiles.length > 0
        ? unifiedFiles
        : fallbackFiles;
  const [showWhitespace, setShowWhitespace] = useState(false);
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const [collapsedHunks, setCollapsedHunks] = useState<Set<string>>(new Set());
  const effectiveFiles = useMemo(() => {
    const withWhitespace = markWhitespaceOnly(baseFiles);
    return ignoreWhitespace
      ? filterWhitespaceOnly(withWhitespace)
      : withWhitespace;
  }, [baseFiles, ignoreWhitespace]);
  const displayFiles = useMemo(() => {
    return effectiveFiles
      .map((file) => {
        const stats = computeFileStats(file);
        const hasRenderableLines = file.hunks.some(
          (hunk) => hunk.lines.length > 0,
        );
        if (
          stats.additions === 0 &&
          stats.deletions === 0 &&
          !hasRenderableLines
        ) {
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
      <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground font-mono whitespace-pre-wrap break-words">
        {diff || i18n.t("previewPanel.noChanges")}
      </div>
    );
  }

  if (displayFiles.length === 0) {
    return <EmptyState text={i18n.t("previewPanel.noDiffAfterIgnoringWhitespace")} />;
  }

  const showGlobalHeader = displayFiles.every(
    (entry) => entry.mode === "split",
  );
  const allFileIds = displayFiles.map((entry) => entry.file.id);
  const allHunkIds = displayFiles.flatMap((entry) =>
    entry.hunks.map((hunk) => hunk.id),
  );

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
    <div className="flex h-full flex-col rounded-lg border border-border bg-card text-xs text-foreground font-mono overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border text-[11px] text-muted-foreground">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-full border border-border px-2 py-0.5 hover:bg-muted/50"
            onClick={() => {
              setCollapsedFiles(new Set(allFileIds));
              setCollapsedHunks(new Set(allHunkIds));
            }}
          >
            {i18n.t("previewPanel.collapseAll")}
          </button>
          <button
            type="button"
            className="rounded-full border border-border px-2 py-0.5 hover:bg-muted/50"
            onClick={() => {
              setCollapsedFiles(new Set());
              setCollapsedHunks(new Set());
            }}
          >
            {i18n.t("previewPanel.expandAll")}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={`rounded-full border px-2 py-0.5 hover:bg-muted/50 ${
              showWhitespace
                ? "border-emerald-500 text-emerald-700"
                : "border-border"
            }`}
            onClick={() => setShowWhitespace((prev) => !prev)}
          >
            {i18n.t("previewPanel.highlightWhitespace")}
          </button>
          <button
            type="button"
            className={`rounded-full border px-2 py-0.5 hover:bg-muted/50 ${
              ignoreWhitespace
                ? "border-emerald-500 text-emerald-700"
                : "border-border"
            }`}
            onClick={() => setIgnoreWhitespace((prev) => !prev)}
          >
            {i18n.t("previewPanel.ignoreWhitespaceDiff")}
          </button>
        </div>
      </div>
      {showGlobalHeader ? (
        <div className="grid grid-cols-2 border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
          <div className="px-3 py-2 border-r border-border">Before</div>
          <div className="px-3 py-2">After</div>
        </div>
      ) : null}
      <div className="flex-1 min-h-0 overflow-auto overscroll-contain">
        {displayFiles.map(({ file, stats, mode, hunks }) => {
          const fileCollapsed = collapsedFiles.has(file.id);
          return (
            <div key={file.id} className="border-b border-border">
              <div className="flex items-center justify-between px-3 py-2 text-foreground bg-muted/30">
                <div>
                  <div className="text-xs font-semibold">
                    {i18n.t("previewPanel.fileLabel")}: {file.displayPath}
                  </div>
                  {(file.oldPath || file.newPath) && (
                    <div className="text-[11px] text-muted-foreground">
                      {file.oldPath ? `- ${file.oldPath}` : ""}
                      {file.oldPath && file.newPath ? " | " : ""}
                      {file.newPath ? `+ ${file.newPath}` : ""}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                  <span className="text-emerald-600">+{stats.additions}</span>
                  <span className="text-rose-600">-{stats.deletions}</span>
                  <button
                    type="button"
                    onClick={() => toggleFile(file.id)}
                    className="text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    {fileCollapsed ? i18n.t("common.expand") : i18n.t("common.collapse")}
                  </button>
                </div>
              </div>

              {!fileCollapsed && !showGlobalHeader ? (
                mode === "split" ? (
                  <div className="grid grid-cols-2 border-t border-border border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                    <div className="px-3 py-2 border-r border-border">
                      Before
                    </div>
                    <div className="px-3 py-2">After</div>
                  </div>
                ) : (
                  <div className="border-t border-border border-b border-border px-3 py-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                    {mode === "add-only" ? i18n.t("previewPanel.added") : i18n.t("common.delete")}
                  </div>
                )
              ) : null}

              {!fileCollapsed &&
                hunks.map((hunk) => {
                  const hunkCollapsed = collapsedHunks.has(hunk.id);
                  return (
                    <div key={hunk.id} className="border-t border-border">
                      <div className="flex items-center justify-between px-3 py-1 text-muted-foreground bg-muted/30">
                        <span>{hunk.header}</span>
                        <button
                          type="button"
                          onClick={() => toggleHunk(hunk.id)}
                          className="text-[11px] text-muted-foreground hover:text-foreground"
                        >
                          {hunkCollapsed ? i18n.t("common.expand") : i18n.t("common.collapse")}
                        </button>
                      </div>
                      {!hunkCollapsed && (
                        <div>
                          {mode === "split" &&
                            hunk.lines.map((row, index) => (
                              <div
                                key={`${hunk.id}-row-${index}`}
                                className="grid grid-cols-2"
                              >
                                <div
                                  className={`flex gap-2 px-3 py-0.5 border-r border-border ${
                                    row.leftType === "del"
                                      ? "bg-rose-50 text-rose-700"
                                      : "text-foreground"
                                  }`}
                                >
                                  <span className="w-8 text-right text-muted-foreground">
                                    {row.leftLine ?? ""}
                                  </span>
                                  <span className="whitespace-pre-wrap break-words flex-1">
                                    {renderWhitespace(
                                      row.leftText,
                                      showWhitespace,
                                    )}
                                  </span>
                                </div>
                                <div
                                  className={`flex gap-2 px-3 py-0.5 ${
                                    row.rightType === "add"
                                      ? "bg-emerald-50 text-emerald-700"
                                      : "text-foreground"
                                  }`}
                                >
                                  <span className="w-8 text-right text-muted-foreground">
                                    {row.rightLine ?? ""}
                                  </span>
                                  <span className="whitespace-pre-wrap break-words flex-1">
                                    {renderWhitespace(
                                      row.rightText,
                                      showWhitespace,
                                    )}
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
                                    isAdd
                                      ? "bg-emerald-50 text-emerald-700"
                                      : "bg-rose-50 text-rose-700"
                                  }`}
                                >
                                  <span className="w-8 text-right text-muted-foreground">
                                    {isAdd
                                      ? (row.rightLine ?? "")
                                      : (row.leftLine ?? "")}
                                  </span>
                                  <span className="whitespace-pre-wrap break-words flex-1">
                                    {renderWhitespace(
                                      isAdd ? row.rightText : row.leftText,
                                      showWhitespace,
                                    )}
                                  </span>
                                </div>
                              );
                            })}
                        </div>
                      )}
                      {hunkCollapsed && (
                        <div className="px-3 py-1 text-[11px] text-muted-foreground">
                          ...
                        </div>
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
          if (
            delText !== addText &&
            normalizeWhitespace(delText) === normalizeWhitespace(addText)
          ) {
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

function resolveDiffDisplayMode(stats: {
  additions: number;
  deletions: number;
}): DiffDisplayMode {
  if (stats.additions > 0 && stats.deletions === 0) return "add-only";
  if (stats.deletions > 0 && stats.additions === 0) return "del-only";
  return "split";
}

function isDisplayFile(value: DisplayFile | null): value is DisplayFile {
  return value !== null && value.hunks.length > 0;
}

function filterLinesForMode(
  lines: DiffLine[],
  mode: DiffDisplayMode,
): DiffLine[] {
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

function backtrackDiff(
  trace: number[][],
  before: string[],
  after: string[],
  max: number,
): DiffOp[] {
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
    if (rows.length === 0 && file.status) {
      rows.push({
        leftLine: null,
        rightLine: null,
        leftText:
          file.status === "added"
            ? i18n.t("previewPanel.diffCreatedNoDetails")
            : file.status === "deleted"
              ? i18n.t("previewPanel.diffDeletedNoDetails")
              : i18n.t("previewPanel.diffUpdatedNoDetails"),
        rightText:
          file.status === "added"
            ? i18n.t("previewPanel.diffCreatedNoDetails")
            : file.status === "deleted"
              ? i18n.t("previewPanel.diffDeletedNoDetails")
              : i18n.t("previewPanel.diffUpdatedNoDetails"),
        leftType: "context",
        rightType: "context",
      });
    }
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
        displayPath: i18n.t("previewPanel.unnamedFile"),
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
        displayPath: match
          ? normalizeDiffPath(match[2])
          : i18n.t("previewPanel.unnamedFile"),
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
      currentFile!.displayPath = normalizeDiffPath(
        currentFile!.newPath ||
          currentFile!.oldPath ||
          i18n.t("previewPanel.unnamedFile"),
      );
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

function WorkspaceFileLoadingState({ text }: { text: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex h-full min-h-[180px] flex-col items-center justify-center gap-3 px-6 text-center text-xs text-muted-foreground"
    >
      <WorkspaceFileLoadGlyph className="h-10 w-10" />
      <span>{text}</span>
    </div>
  );
}

function WorkspaceFileLoadGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      className={cn("shrink-0 text-[var(--brand-link)]", className)}
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M15 7.5h13.5L36 15v25.5H15z"
        className="stroke-current"
        strokeWidth="2"
        strokeLinejoin="round"
        opacity="0.72"
      />
      <path
        d="M28.5 7.5V15H36"
        className="stroke-current"
        strokeWidth="2"
        strokeLinejoin="round"
        opacity="0.38"
      />
      <path
        d="M19 23h16"
        className="stroke-current"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="16"
      >
        <animate
          attributeName="stroke-dashoffset"
          values="16;0;16"
          dur="1.55s"
          repeatCount="indefinite"
        />
        <animate
          attributeName="opacity"
          values="0.18;0.82;0.18"
          dur="1.55s"
          repeatCount="indefinite"
        />
      </path>
      <path
        d="M19 29h11"
        className="stroke-current"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="11"
      >
        <animate
          attributeName="stroke-dashoffset"
          values="11;0;11"
          dur="1.55s"
          begin="0.18s"
          repeatCount="indefinite"
        />
        <animate
          attributeName="opacity"
          values="0.16;0.7;0.16"
          dur="1.55s"
          begin="0.18s"
          repeatCount="indefinite"
        />
      </path>
      <circle cx="34.5" cy="34.5" r="2.4" className="fill-current">
        <animate
          attributeName="opacity"
          values="0.25;1;0.25"
          dur="1.15s"
          repeatCount="indefinite"
        />
      </circle>
    </svg>
  );
}
