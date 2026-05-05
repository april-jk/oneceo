/**
 * Design Philosophy: Swiss International Style + Digital Minimalism
 * - Centered content with clear hierarchy
 * - Consistent input experience across pages
 * - 支持对话模式和任务创建智能体
 */

import {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import WorkspaceLayout from "@/components/WorkspaceLayout";
import {
  Mic,
  Send,
  Square,
  Sparkles,
  Loader2,
  FilePlus,
  FilePenLine,
  FileSearch,
  FileText,
  FileDiff,
  FolderSearch2,
  Search,
  Plug,
  Terminal,
  Bug,
  Rocket,
  ChevronDown,
  ChevronRight,
  Check,
  Trash2,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import ConnectorDialog from "@/components/ConnectorDialog";
import AttachmentChipList from "@/components/AttachmentChipList";
import AttachmentPickerButton from "@/components/AttachmentPickerButton";
import MessageAttachmentReference from "@/components/MessageAttachmentReference";
import OpencodePreviewPanel from "@/components/OpencodePreviewPanel";
import AltusArtifactPreviewCard, {
  type AltusArtifactFile,
} from "@/components/AltusArtifactPreviewCard";
import TaskDeliverableCard from "@/components/TaskDeliverableCard";
import { SessionCreditBar } from "@/components/SessionCreditBar";
import AltusRunReplayDrawer, {
  type AltusDrawerView,
  type AltusReplayAction,
  type AltusReplayFile,
} from "@/components/AltusRunReplayDrawer";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { motion, AnimatePresence } from "framer-motion";
import {
  useTaskCreationAgent,
  type AgentMessage,
} from "@/hooks/useTaskCreationAgent";
import { useIsMobile } from "@/hooks/useMobile";
import {
  buildPreviewItems,
  extractDiffPayload,
  type PreviewDiffItem,
} from "@/lib/opencode-preview";
import {
  getWorkspaceRawFileUrl,
  listTaskCreationProjects,
  listTaskCreationSkills,
  uploadTaskCreationAttachment,
  type TaskCreationProjectSummary,
  type TaskCreationDeliverableArtifact,
  type TaskCreationPlatformSkill,
  type TaskCreationUploadedAttachment as UploadedTaskAttachment,
  type TaskCreationWebsitePreviewSnapshot,
} from "@/lib/task-creation-client";
import {
  approveMcpToolConfirmation,
  getMyConnectorAccounts,
  rejectMcpToolConfirmation,
} from "@/lib/connectors-client";
import {
  buildSlashText,
  parseTrailingSlashQuery,
  stripTrailingSlashQuery,
  type SlashReferenceKind,
} from "@/lib/slash-references";
import {
  appendAttachmentsToPrompt,
  consumePendingDraftAttachments,
  DEFAULT_ATTACHMENT_PROMPT,
  mergePendingAttachments,
  mergePendingPlatformSkills,
  partitionPendingAttachments,
  type PendingAttachment,
} from "@/lib/task-attachments";
import {
  buildManagedTaskInputMetadata,
  type TaskCreationMcpReference,
} from "@/lib/task-input-metadata";
import {
  buildTaskSessionDeploymentPrompt,
  type TaskSessionDeploymentPromptAction,
} from "@/lib/task-session-deployment-prompts";
import { normalizeWorkspaceRelativePath } from "@/lib/workspace-path";
import { resolveUserMessageReferences } from "@/lib/message-reference-parser";
import { readAltusMode } from "@/lib/altus-settings";
import { shouldAutoCollapseSidebarForAltusActions } from "@/lib/altus-actions-layout";
import type { TaskProjectSelection } from "@/lib/task-project-selection";
import i18n from "@/i18n";
import { useLocation, useSearch } from "wouter";
import { Streamdown } from "streamdown";
import { useAuth } from "@/contexts/AuthContext";

type PageMode = "input" | "chat";
const BILLING_TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "stopped"]);

function isInsufficientCreditsError(error: unknown) {
  const text = error instanceof Error ? error.message : String(error || "");
  return /INSUFFICIENT_CREDITS|积分不足|\b402\b/i.test(text);
}

type PersistedMessageScrollAnchor = {
  anchorMessageKey: string | null;
  anchorOffsetTop: number;
  scrollTop: number;
  savedAt: number;
};

type PersistedPreviewState = {
  previewOpen: boolean;
  previewTab: "files" | "changes" | "debug" | "deployment";
  selectedDiffId: string | null;
  selectedDiffMessageKey: string | null;
  savedAt: number;
};

type GoogleWorkspaceConfirmationView = {
  confirmationId: string;
  agentRunId?: string;
  connectorKey: string;
  toolName: string;
  action: string;
  target: string;
  impact: string;
  parameterSummary: Record<string, unknown>;
};

function getMcpConfirmationConnectorLabel(connectorKeyRaw: string) {
  const connectorKey = asText(connectorKeyRaw);
  if (connectorKey === "google_super") return "Google Workspace";
  return connectorKey || "MCP";
}

type ComposerReferenceToken = {
  id: string;
  kind: SlashReferenceKind;
  label: string;
  queryText: string;
  skill?: TaskCreationPlatformSkill;
  mcp?: {
    key: string;
    name: string;
    category: string;
  };
};

type SlashSuggestion = {
  id: string;
  kind: SlashReferenceKind;
  label: string;
  subLabel: string;
  token: ComposerReferenceToken;
};

function normalizeComposerSelectedMcp(
  references: ComposerReferenceToken[],
): TaskCreationMcpReference[] {
  return references
    .filter((item) => item.kind === "mcp")
    .map((item) => item.mcp)
    .filter(
      (
        item,
      ): item is {
        key: string;
        name: string;
        category: string;
      } => Boolean(item),
    )
    .map((item) => ({
      key: item.key,
      name: item.name,
      category: item.category,
    }));
}

function escapeMessageKeySelector(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, "\\$&");
}

function readPersistedScrollAnchor(
  raw: string | null,
): PersistedMessageScrollAnchor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PersistedMessageScrollAnchor;
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.scrollTop === "number" &&
      Number.isFinite(parsed.scrollTop)
    ) {
      return {
        anchorMessageKey:
          typeof parsed.anchorMessageKey === "string" &&
          parsed.anchorMessageKey.trim()
            ? parsed.anchorMessageKey.trim()
            : null,
        anchorOffsetTop:
          typeof parsed.anchorOffsetTop === "number" &&
          Number.isFinite(parsed.anchorOffsetTop)
            ? parsed.anchorOffsetTop
            : 0,
        scrollTop: parsed.scrollTop,
        savedAt:
          typeof parsed.savedAt === "number" && Number.isFinite(parsed.savedAt)
            ? parsed.savedAt
            : Date.now(),
      };
    }
  } catch {
    const legacy = Number(raw);
    if (Number.isFinite(legacy) && legacy >= 0) {
      return {
        anchorMessageKey: null,
        anchorOffsetTop: 0,
        scrollTop: legacy,
        savedAt: Date.now(),
      };
    }
  }
  return null;
}

function readPersistedPreviewState(
  raw: string | null,
): PersistedPreviewState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PersistedPreviewState;
    if (!parsed || typeof parsed !== "object") return null;
    const previewTab =
      parsed.previewTab === "files" ||
      parsed.previewTab === "changes" ||
      parsed.previewTab === "debug" ||
      parsed.previewTab === "deployment"
        ? parsed.previewTab
        : "files";
    const previewOpen = Boolean(parsed.previewOpen);
    const selectedDiffId =
      typeof parsed.selectedDiffId === "string" && parsed.selectedDiffId.trim()
        ? parsed.selectedDiffId.trim()
        : null;
    const selectedDiffMessageKey =
      typeof parsed.selectedDiffMessageKey === "string" &&
      parsed.selectedDiffMessageKey.trim()
        ? parsed.selectedDiffMessageKey.trim()
        : null;
    return {
      previewOpen,
      previewTab,
      selectedDiffId,
      selectedDiffMessageKey,
      savedAt:
        typeof parsed.savedAt === "number" && Number.isFinite(parsed.savedAt)
          ? parsed.savedAt
          : Date.now(),
    };
  } catch {
    return null;
  }
}

function clampProjectHintLabel(
  value: string | null,
  maxLength = 8,
): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength)}...`;
}

const NO_PROJECT_VALUE = "__no_project__";

export default function Home() {
  const { t } = useTranslation();
  const { refreshCredits } = useAuth();
  const MESSAGE_SCROLL_CACHE_PREFIX = "task_creation_history_scroll:";
  const PREVIEW_STATE_CACHE_PREFIX = "task_creation_preview_state:";
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const queryProjectId = useMemo(() => {
    const params = new URLSearchParams(search);
    const projectId = params.get("projectId")?.trim();
    return projectId || null;
  }, [search]);
  const [pendingProjectId, setPendingProjectId] = useState<string | null>(
    queryProjectId,
  );
  const selectedProject = useMemo<TaskProjectSelection | null>(() => {
    if (!pendingProjectId) return null;
    return {
      id: pendingProjectId,
      kind: "manual",
    };
  }, [pendingProjectId]);
  const [projectOptions, setProjectOptions] = useState<TaskCreationProjectSummary[]>(
    [],
  );
  const [projectOptionsLoading, setProjectOptionsLoading] = useState(false);
  const [projectOptionsLoaded, setProjectOptionsLoaded] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [mode, setMode] = useState<PageMode>("input");
  const [message, setMessage] = useState("");
  const [handledGoogleConfirmationIds, setHandledGoogleConfirmationIds] = useState<
    string[]
  >([]);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [composerReferences, setComposerReferences] = useState<
    ComposerReferenceToken[]
  >([]);
  const [slashSkillCatalog, setSlashSkillCatalog] = useState<
    TaskCreationPlatformSkill[]
  >([]);
  const [slashMcpCatalog, setSlashMcpCatalog] = useState<
    Array<{ key: string; name: string; category: string }>
  >([]);
  const [slashCatalogLoaded, setSlashCatalogLoaded] = useState(false);
  const [slashCatalogLoading, setSlashCatalogLoading] = useState(false);
  const [slashCatalogError, setSlashCatalogError] = useState<string | null>(
    null,
  );
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [altusReplayRunId, setAltusReplayRunId] = useState<string | null>(null);
  const [altusReplayIndex, setAltusReplayIndex] = useState(0);
  const [altusReplayView, setAltusReplayView] =
    useState<AltusDrawerView>("actions");
  const [pendingAltusReplayToolCallId, setPendingAltusReplayToolCallId] =
    useState<string | null>(null);
  const refreshCreditsRef = useRef(refreshCredits);
  const lastCreditRefreshRunStatusRef = useRef<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<"lite" | "pro" | "max">(
    "pro",
  );
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewMaximized, setPreviewMaximized] = useState(false);
  const [previewWorkspacePath, setPreviewWorkspacePath] = useState<
    string | null
  >(null);
  const [previewTab, setPreviewTab] = useState<
    "files" | "changes" | "debug" | "deployment"
  >("files");
  const [selectedDiffId, setSelectedDiffId] = useState<string | null>(null);
  const [selectedDiffMessageKey, setSelectedDiffMessageKey] = useState<
    string | null
  >(null);
  const [desktopPreviewLayout, setDesktopPreviewLayout] = useState<
    [number, number]
  >([66, 34]);
  const [pendingDiffTarget, setPendingDiffTarget] = useState<{
    diffId?: string | null;
    filePath?: string | null;
    messageKey?: string | null;
    messageIndex?: number | null;
  } | null>(null);
  const isMobile = useIsMobile();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageScrollRef = useRef<HTMLDivElement>(null);
  const pendingInputRef = useRef<string | null>(null);
  const prependRestoreRef = useRef<{
    scrollTop: number;
    scrollHeight: number;
  } | null>(null);
  const historyPaginationInFlightRef = useRef(false);
  const scrollRestoreDoneRef = useRef<string | null>(null);
  const stickToBottomRef = useRef(true);
  const olderHistoryIntentRef = useRef(false);
  const previewStateRestoredSessionRef = useRef<string | null>(null);
  const sessionIdFromPath = useMemo(() => {
    const match = location.match(/^\/session\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }, [location]);
  const isHistoryView = useMemo(() => {
    const params = new URLSearchParams(search);
    return params.get("view") === "history";
  }, [search]);

  const persistScrollAnchor = () => {
    const container = messageScrollRef.current;
    if (!sessionId || !container) return;
    try {
      const containerRect = container.getBoundingClientRect();
      const messageNodes = Array.from(
        container.querySelectorAll<HTMLElement>("[data-message-key]"),
      );
      const firstVisible =
        messageNodes.find((node) => {
          const rect = node.getBoundingClientRect();
          return rect.bottom > containerRect.top + 1;
        }) || null;
      const payload: PersistedMessageScrollAnchor = {
        anchorMessageKey: firstVisible?.dataset.messageKey || null,
        anchorOffsetTop: firstVisible
          ? Math.max(
              0,
              firstVisible.getBoundingClientRect().top - containerRect.top,
            )
          : 0,
        scrollTop: Math.max(0, Math.floor(container.scrollTop)),
        savedAt: Date.now(),
      };
      window.sessionStorage.setItem(
        `${MESSAGE_SCROLL_CACHE_PREFIX}${sessionId}`,
        JSON.stringify(payload),
      );
    } catch {
      // ignore storage failures
    }
  };

  const restoreScrollAnchor = (targetSessionId: string) => {
    const container = messageScrollRef.current;
    if (!container) return;
    try {
      const raw = window.sessionStorage.getItem(
        `${MESSAGE_SCROLL_CACHE_PREFIX}${targetSessionId}`,
      );
      const persisted = readPersistedScrollAnchor(raw);
      if (!persisted) return;
      const applyFallbackScrollTop = () => {
        container.scrollTop = Math.max(0, persisted.scrollTop);
      };
      if (!persisted.anchorMessageKey) {
        applyFallbackScrollTop();
        stickToBottomRef.current =
          container.scrollHeight -
            container.clientHeight -
            container.scrollTop <
          80;
        return;
      }
      const selector = `[data-message-key="${escapeMessageKeySelector(persisted.anchorMessageKey)}"]`;
      const anchorNode = container.querySelector<HTMLElement>(selector);
      if (!anchorNode) {
        applyFallbackScrollTop();
        stickToBottomRef.current =
          container.scrollHeight -
            container.clientHeight -
            container.scrollTop <
          80;
        return;
      }
      container.scrollTop = Math.max(
        0,
        anchorNode.offsetTop - persisted.anchorOffsetTop,
      );
      stickToBottomRef.current =
        container.scrollHeight - container.clientHeight - container.scrollTop <
        80;
    } catch {
      // ignore restore failures
    }
  };

  const {
    isConnected,
    isProcessing,
    managedRunActive,
    managedRunStatus,
    isInterrupting,
    messages,
    hasOlderHistory,
    isLoadingOlderHistory,
    sessionId,
    currentQuestion,
    runtime,
    sendChatInput,
    interruptCurrentRun,
    answerQuestion,
    appendLocalMessage,
    awaitManagedRunRecovery,
    ensureSession,
    loadOlderHistory,
  } = useTaskCreationAgent({
    autoRuntime: !isHistoryView,
    compactHistory: false,
    runtimeLogPollingEnabled: false,
    initialProjectId:
      selectedProject?.kind === "manual" ? selectedProject.id : null,
    onPlanGenerated: (plan) => {
      console.log("计划生成:", plan);
      // TODO: 跳转到项目详情页面或更新左侧项目列表
    },
    onError: (error) => {
      console.error("任务创建失败:", error);
    },
  });
  const resolvedGoogleConfirmationIds = useMemo(() => {
    const ids = new Set(handledGoogleConfirmationIds);
    for (const item of messages) {
      const metadata = toRecord(item.metadata);
      const confirmationId =
        asText(toRecord(metadata.mcpToolConfirmation).confirmationId) ||
        asText(metadata.confirmationId);
      if (!confirmationId) continue;
      const source = asText(metadata.source);
      if (
        source === "mcp_tool_confirmation_approved" ||
        source === "mcp_tool_confirmation_rejected" ||
        source === "mcp_tool_confirmation_followup"
      ) {
        ids.add(confirmationId);
      }
    }
    return Array.from(ids);
  }, [handledGoogleConfirmationIds, messages]);

  useEffect(() => {
    refreshCreditsRef.current = refreshCredits;
  }, [refreshCredits]);

  useEffect(() => {
    if (!managedRunStatus || !BILLING_TERMINAL_RUN_STATUSES.has(managedRunStatus)) {
      lastCreditRefreshRunStatusRef.current = null;
      return;
    }
    if (lastCreditRefreshRunStatusRef.current === managedRunStatus) return;
    lastCreditRefreshRunStatusRef.current = managedRunStatus;
    void refreshCreditsRef.current();
  }, [managedRunStatus]);

  const slashQuery = useMemo(() => parseTrailingSlashQuery(message), [message]);

  useEffect(() => {
    setPendingProjectId(queryProjectId);
  }, [queryProjectId]);

  const syncPendingProjectToUrl = useCallback(
    (nextProjectId: string | null) => {
      if (!location.startsWith("/new-task")) return;
      const params = new URLSearchParams(search);
      if (nextProjectId) {
        params.set("projectId", nextProjectId);
      } else {
        params.delete("projectId");
      }
      const nextQuery = params.toString();
      const nextUrl = nextQuery ? `${location}?${nextQuery}` : location;
      setLocation(nextUrl, { replace: true });
    },
    [location, search, setLocation],
  );

  const loadProjectOptions = useCallback(async () => {
    if (projectOptionsLoading) return;
    setProjectOptionsLoading(true);
    try {
      const result = await listTaskCreationProjects();
      setProjectOptions(Array.isArray(result) ? result : []);
    } finally {
      setProjectOptionsLoaded(true);
      setProjectOptionsLoading(false);
    }
  }, [projectOptionsLoading]);

  useEffect(() => {
    if (!slashQuery || slashCatalogLoaded || slashCatalogLoading) {
      return;
    }
    let cancelled = false;
    setSlashCatalogLoading(true);
    setSlashCatalogError(null);
    void (async () => {
      try {
        const [skills, connectorAccounts] = await Promise.all([
          listTaskCreationSkills(),
          getMyConnectorAccounts(),
        ]);
        if (cancelled) return;
        const nextSkills = Array.isArray(skills) ? skills : [];
        const catalog = Array.isArray(connectorAccounts.catalog)
          ? connectorAccounts.catalog.filter(
              (item): item is (typeof connectorAccounts.catalog)[number] =>
                Boolean(item && typeof item === "object" && "key" in item),
            )
          : [];
        const accounts = Array.isArray(connectorAccounts.accounts)
          ? connectorAccounts.accounts.filter(
              (item): item is (typeof connectorAccounts.accounts)[number] =>
                Boolean(
                  item && typeof item === "object" && "connectorKey" in item,
                ),
            )
          : [];
        const catalogByKey = new Map(
          catalog.map((item) => [item.key, item] as const),
        );
        const nextMcpCatalog = accounts
          .filter((item) => {
            if (item.authStatus !== "authorized") return false;
            const catalogItem = catalogByKey.get(item.connectorKey);
            return (
              Boolean(catalogItem?.available) &&
              catalogItem?.category === "custom_mcp"
            );
          })
          .map((item) => ({
            key: item.connectorKey,
            name:
              catalogByKey.get(item.connectorKey)?.name || item.connectorKey,
            category: "custom_mcp",
          }));
        setSlashSkillCatalog(nextSkills);
        setSlashMcpCatalog(nextMcpCatalog);
        setSlashCatalogLoaded(true);
      } catch (error) {
        if (cancelled) return;
        setSlashSkillCatalog([]);
        setSlashMcpCatalog([]);
        setSlashCatalogLoaded(false);
        setSlashCatalogError(
          error instanceof Error && error.message
            ? error.message
            : t("homeWorkspace.referenceLoadFailed"),
        );
      } finally {
        if (cancelled) return;
        setSlashCatalogLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slashCatalogLoaded, slashQuery]);

  useEffect(() => {
    if (location.startsWith("/new-task") && !projectOptionsLoaded) {
      void loadProjectOptions();
    }
  }, [loadProjectOptions, location, projectOptionsLoaded]);

  useEffect(() => {
    if (!projectMenuOpen || projectOptionsLoaded) {
      return;
    }
    void loadProjectOptions();
  }, [loadProjectOptions, projectMenuOpen, projectOptionsLoaded]);

  const slashSuggestions = useMemo<SlashSuggestion[]>(() => {
    if (!slashQuery) return [];
    const keyword = slashQuery.keyword.trim().toLowerCase();
    const allowSkill = slashQuery.kind === "all" || slashQuery.kind === "skill";
    const allowMcp = slashQuery.kind === "all" || slashQuery.kind === "mcp";
    const list: SlashSuggestion[] = [];

    if (allowSkill) {
      for (const skill of slashSkillCatalog) {
        const name = (skill.name || "").toLowerCase();
        const slug = (skill.slug || "").toLowerCase();
        if (keyword && !name.includes(keyword) && !slug.includes(keyword))
          continue;
        const id = `skill:${skill.skillId}:${skill.revisionId}`;
        list.push({
          id,
          kind: "skill",
          label: skill.name,
          subLabel: `skills · ${skill.slug || skill.skillId}`,
          token: {
            id,
            kind: "skill",
            label: skill.name,
            queryText: buildSlashText("skill", skill.slug || skill.name),
            skill,
          },
        });
      }
    }

    if (allowMcp) {
      for (const item of slashMcpCatalog) {
        const name = (item.name || "").toLowerCase();
        const key = (item.key || "").toLowerCase();
        if (keyword && !name.includes(keyword) && !key.includes(keyword))
          continue;
        const id = `mcp:${item.key}`;
        list.push({
          id,
          kind: "mcp",
          label: item.name,
          subLabel: `mcp · ${item.key}`,
          token: {
            id,
            kind: "mcp",
            label: item.name,
            queryText: buildSlashText("mcp", item.key || item.name),
            mcp: item,
          },
        });
      }
    }

    return list.slice(0, 8);
  }, [slashMcpCatalog, slashQuery, slashSkillCatalog]);

  useEffect(() => {
    setSlashActiveIndex(0);
  }, [message, slashSuggestions.length]);

  // 自动滚动到最新消息
  useEffect(() => {
    const container = messageScrollRef.current;
    if (mode !== "chat" || !container) {
      return;
    }
    if (stickToBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, mode, sessionId]);

  useEffect(() => {
    if (!sessionId || !messages.length) return;
    if (scrollRestoreDoneRef.current === sessionId) return;
    const container = messageScrollRef.current;
    if (!container) return;
    window.requestAnimationFrame(() => {
      restoreScrollAnchor(sessionId);
    });
    scrollRestoreDoneRef.current = sessionId;
  }, [messages.length, sessionId]);

  useEffect(() => {
    scrollRestoreDoneRef.current = null;
    olderHistoryIntentRef.current = false;
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) {
      previewStateRestoredSessionRef.current = null;
      setPreviewOpen(false);
      setPreviewTab("files");
      setSelectedDiffId(null);
      setSelectedDiffMessageKey(null);
      setPendingDiffTarget(null);
      return;
    }
    if (previewStateRestoredSessionRef.current === sessionId) {
      return;
    }
    setPendingDiffTarget(null);
    try {
      const raw = window.sessionStorage.getItem(
        `${PREVIEW_STATE_CACHE_PREFIX}${sessionId}`,
      );
      const persisted = readPersistedPreviewState(raw);
      if (!persisted) {
        setPreviewOpen(false);
        setPreviewTab("files");
        setSelectedDiffId(null);
        setSelectedDiffMessageKey(null);
      } else {
        setPreviewOpen(Boolean(persisted.previewOpen));
        setPreviewTab(persisted.previewTab);
        setSelectedDiffId(persisted.selectedDiffId);
        setSelectedDiffMessageKey(persisted.selectedDiffMessageKey);
      }
    } catch {
      setPreviewOpen(false);
      setPreviewTab("files");
      setSelectedDiffId(null);
      setSelectedDiffMessageKey(null);
    } finally {
      previewStateRestoredSessionRef.current = sessionId;
    }
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    if (previewStateRestoredSessionRef.current !== sessionId) return;
    try {
      const payload: PersistedPreviewState = {
        previewOpen,
        previewTab,
        selectedDiffId,
        selectedDiffMessageKey,
        savedAt: Date.now(),
      };
      window.sessionStorage.setItem(
        `${PREVIEW_STATE_CACHE_PREFIX}${sessionId}`,
        JSON.stringify(payload),
      );
    } catch {
      // ignore storage failures
    }
  }, [
    previewOpen,
    previewTab,
    selectedDiffId,
    selectedDiffMessageKey,
    sessionId,
  ]);

  // 从根页面跳转到 /new-task?q=... 时，自动进入聊天态并发送首条消息
  useEffect(() => {
    const params = new URLSearchParams(search);
    const input = params.get("q")?.trim();
    const prefill = params.get("prefill")?.trim();
    const sessionInQuery = sessionIdFromPath || params.get("sessionId")?.trim();
    const createNewToken = params.get("new")?.trim();

    if (prefill && location.startsWith("/new-task")) {
      pendingInputRef.current = null;
      setMessage(prefill);
      setAttachments([]);
      setComposerReferences([]);
      setMode("input");
      window.history.replaceState(null, "", "/new-task");
      return;
    }

    if (createNewToken) {
      pendingInputRef.current = null;
      setMessage("");
      setMode("input");
      return;
    }

    if (sessionInQuery) {
      setMode("chat");
      if (
        location.startsWith("/new-task") &&
        sessionInQuery === params.get("sessionId")?.trim()
      ) {
        const nextUrl = `/session/${encodeURIComponent(sessionInQuery)}${isHistoryView ? "?view=history" : ""}`;
        window.history.replaceState(null, "", nextUrl);
      }
    }

    if (input && location.startsWith("/new-task")) {
      pendingInputRef.current = input;
      setMode("chat");
      const nextUrl = sessionInQuery
        ? `/session/${encodeURIComponent(sessionInQuery)}`
        : "/new-task";
      window.history.replaceState(null, "", nextUrl);
    }
  }, [location, search, sessionIdFromPath]);

  useEffect(() => {
    if (!isConnected || !pendingInputRef.current) {
      return;
    }
    const input = pendingInputRef.current;
    pendingInputRef.current = null;
    void submitPrompt(input);
  }, [isConnected]);

  useEffect(() => {
    const pendingAttachments = consumePendingDraftAttachments();
    if (!pendingAttachments.length) return;
    setAttachments(pendingAttachments);
  }, []);

  useEffect(() => {
    const shouldLockViewport = mode === "chat";
    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById("root");
    const targets = [html, body, root].filter((node): node is HTMLElement =>
      Boolean(node),
    );

    if (!targets.length) {
      return;
    }

    const previousStyles = targets.map((node) => ({
      node,
      overflow: node.style.overflow,
      height: node.style.height,
      maxHeight: node.style.maxHeight,
      overscrollBehavior: node.style.overscrollBehavior,
    }));

    if (shouldLockViewport) {
      targets.forEach((node) => {
        node.style.overflow = "hidden";
        node.style.height = "100%";
        node.style.maxHeight = "100vh";
        node.style.overscrollBehavior = "none";
      });
    }

    return () => {
      previousStyles.forEach((entry) => {
        entry.node.style.overflow = entry.overflow;
        entry.node.style.height = entry.height;
        entry.node.style.maxHeight = entry.maxHeight;
        entry.node.style.overscrollBehavior = entry.overscrollBehavior;
      });
    };
  }, [mode]);

  const exitHistoryView = () => {
    if (!isHistoryView) return;
    const base = sessionId
      ? `/session/${encodeURIComponent(sessionId)}`
      : location.startsWith("/session/")
        ? location
        : "/new-task";
    window.history.replaceState(null, "", base);
  };

  const handleAttachmentSelect = (files: File[]) => {
    const merged = mergePendingAttachments(attachments, files);
    setAttachments(merged.attachments);
    merged.rejected.forEach((item) => toast.error(item));
  };

  const handleSkillSelect = (skills: TaskCreationPlatformSkill[]) => {
    setAttachments((current) => mergePendingPlatformSkills(current, skills));
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((item) => item.id !== id));
  };

  const removeComposerReference = (token: ComposerReferenceToken) => {
    setComposerReferences((prev) =>
      prev.filter((item) => item.id !== token.id),
    );
    setMessage(
      (prev) =>
        `${prev}${prev.endsWith(" ") || !prev ? "" : " "}${token.queryText} `,
    );
  };

  const applySlashSuggestion = (suggestion: SlashSuggestion) => {
    setMessage((prev) => stripTrailingSlashQuery(prev));
    setComposerReferences((prev) => {
      if (prev.some((item) => item.id === suggestion.id)) return prev;
      return [...prev, suggestion.token];
    });
  };

  const handleComposerInputChange = (nextValue: string) => {
    setMessage(nextValue);
  };

  const handleComposerKeyDown = (
    event: KeyboardEvent<HTMLTextAreaElement>,
    options?: { submit?: () => void },
  ) => {
    const canUseSlash = Boolean(slashQuery) && slashSuggestions.length > 0;
    const suggestionCount = slashSuggestions.length;
    if (slashQuery && event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      const current = slashSuggestions[Math.max(0, slashActiveIndex)];
      if (current) applySlashSuggestion(current);
      return;
    }
    if (canUseSlash) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSlashActiveIndex((prev) =>
          suggestionCount > 0 ? (prev + 1) % suggestionCount : 0,
        );
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSlashActiveIndex((prev) =>
          suggestionCount > 0
            ? (prev - 1 + suggestionCount) % suggestionCount
            : 0,
        );
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        const current = slashSuggestions[Math.max(0, slashActiveIndex)];
        if (current) applySlashSuggestion(current);
        return;
      }
      if (event.key === " ") {
        const current = slashSuggestions[Math.max(0, slashActiveIndex)];
        if (current) {
          event.preventDefault();
          applySlashSuggestion(current);
          return;
        }
      }
    }

    if (
      event.key === "Backspace" &&
      !message &&
      composerReferences.length > 0
    ) {
      event.preventDefault();
      const last = composerReferences[composerReferences.length - 1];
      if (last) {
        setComposerReferences((prev) => prev.slice(0, -1));
        setMessage(last.queryText);
      }
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      options?.submit?.();
    }
  };

  const restorePrependedHistoryScroll = async () => {
    const snapshot = prependRestoreRef.current;
    if (!snapshot) return;
    let target = messageScrollRef.current;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      target = messageScrollRef.current;
      if (target && target.scrollHeight > snapshot.scrollHeight) {
        break;
      }
      await new Promise<void>((resolve) =>
        window.requestAnimationFrame(() => resolve()),
      );
    }
    if (!target) {
      prependRestoreRef.current = null;
      return;
    }
    const nextScrollTop = Math.max(
      0,
      target.scrollHeight - snapshot.scrollHeight + snapshot.scrollTop,
    );
    target.scrollTop = nextScrollTop;
    stickToBottomRef.current =
      target.scrollHeight - target.clientHeight - target.scrollTop < 80;
    persistScrollAnchor();
    prependRestoreRef.current = null;
  };

  const handleMessageScroll = async () => {
    const container = messageScrollRef.current;
    if (!container) return;
    if (historyPaginationInFlightRef.current) {
      return;
    }
    stickToBottomRef.current =
      container.scrollHeight - container.clientHeight - container.scrollTop <
      80;
    persistScrollAnchor();
    if (
      container.scrollTop > 80 ||
      !olderHistoryIntentRef.current ||
      !hasOlderHistory ||
      isLoadingOlderHistory
    ) {
      return;
    }
    prependRestoreRef.current = {
      scrollTop: container.scrollTop,
      scrollHeight: container.scrollHeight,
    };
    historyPaginationInFlightRef.current = true;
    try {
      const loaded = await loadOlderHistory();
      if (loaded) {
        await restorePrependedHistoryScroll();
      } else {
        prependRestoreRef.current = null;
      }
    } finally {
      historyPaginationInFlightRef.current = false;
    }
  };

  async function submitPrompt(rawInput: string) {
    const trimmed = rawInput.trim();
    const attachmentDrafts = [...attachments];
    const referenceDrafts = [...composerReferences];
    const hasAttachments = attachmentDrafts.length > 0;
    const hasReferences = referenceDrafts.length > 0;
    const displayText =
      trimmed ||
      (hasAttachments || hasReferences
        ? t("homeWorkspace.referencesAdded")
        : "");
    const baseText =
      trimmed ||
      (hasAttachments
        ? DEFAULT_ATTACHMENT_PROMPT
        : hasReferences
          ? t("homeWorkspace.processReferencedAbilities")
          : "");
    if (!baseText) return;
    const altusMode = readAltusMode();

    if (hasAttachments) {
      setAttachments([]);
    }
    if (hasReferences) {
      setComposerReferences([]);
    }

    try {
      const { uploadableAttachments, selectedSkills } =
        partitionPendingAttachments(attachmentDrafts);
      const referencedSkills = referenceDrafts
        .filter((item) => item.kind === "skill")
        .map((item) => item.skill)
        .filter((item): item is TaskCreationPlatformSkill => Boolean(item))
        .map((item) => ({
          sourceType: item.sourceType,
          skillId: item.skillId,
          revisionId: item.revisionId,
          slug: item.slug,
          name: item.name,
          description: item.description,
          category: item.category,
          revisionNumber: item.revisionNumber,
          resourceSummary: item.resourceSummary,
        }));
      const mergedSkills = [...selectedSkills, ...referencedSkills].filter(
        (item, index, list) =>
          list.findIndex(
            (current) =>
              current.skillId === item.skillId &&
              current.revisionId === item.revisionId,
          ) === index,
      );
      const selectedMcp = normalizeComposerSelectedMcp(referenceDrafts);
      let activeSessionId = (sessionId || "").trim();
      if (
        altusMode !== "managed" &&
        uploadableAttachments.length > 0 &&
        !activeSessionId
      ) {
        activeSessionId = await ensureSession(
          displayText || t("homeWorkspace.newTaskSession"),
        );
      }

      let uploadedAttachments: UploadedTaskAttachment[] = [];
      if (altusMode !== "managed" && uploadableAttachments.length > 0) {
        uploadedAttachments = await Promise.all(
          uploadableAttachments.map((item) =>
            uploadTaskCreationAttachment(activeSessionId, item.file),
          ),
        );
      }

      exitHistoryView();
      if (altusMode === "managed") {
        await sendChatInput(baseText, {
          sessionId: activeSessionId || undefined,
          metadata: buildManagedTaskInputMetadata({
            originalInput: displayText,
            modelTier: selectedModel || "pro",
            skills: mergedSkills,
            mcpReferences: selectedMcp,
            fileCount: uploadableAttachments.length,
          }),
          files: uploadableAttachments.map((item) => item.file),
        });
      } else {
        await sendChatInput(
          appendAttachmentsToPrompt(baseText, uploadedAttachments),
          {
            sessionId: activeSessionId || undefined,
            metadata:
              uploadedAttachments.length || mergedSkills.length
                ? {
                    ...(uploadedAttachments.length
                      ? { attachments: uploadedAttachments }
                      : {}),
                    ...(mergedSkills.length ? { skills: mergedSkills } : {}),
                    ...(selectedMcp.length
                      ? { mcpReferences: selectedMcp }
                      : {}),
                    originalInput: displayText,
                  }
                : selectedMcp.length
                  ? {
                      mcpReferences: selectedMcp,
                      originalInput: displayText,
                    }
                  : undefined,
          },
        );
      }
    } catch (error) {
      if (hasAttachments) {
        const draftFiles = attachmentDrafts
          .filter((item) => item.kind === "file")
          .map((item) => item.file);
        const draftSkills = attachmentDrafts.filter(
          (item) => item.kind === "skill",
        );
        setAttachments((current) => {
          const mergedFiles = mergePendingAttachments(
            current,
            draftFiles,
          ).attachments;
          return mergePendingPlatformSkills(mergedFiles, draftSkills);
        });
      }
      if (hasReferences) {
        setComposerReferences(referenceDrafts);
      }
      toast.error(
        error instanceof Error
          ? error.message
          : t("homeWorkspace.attachmentSendFailed"),
      );
      if (isInsufficientCreditsError(error)) {
        void refreshCreditsRef.current();
      }
    }
  }

  const handleSend = () => {
    if (
      !message.trim() &&
      attachments.length === 0 &&
      composerReferences.length === 0
    )
      return;
    setMode("chat");
    void submitPrompt(message);
    setMessage("");
  };

  const handleStop = () => {
    if (!sessionId) return;
    void interruptCurrentRun(sessionId).catch((error) => {
      const text = error instanceof Error ? error.message : String(error || "");
      if (/signal:\s*terminated/i.test(text) || /terminated/i.test(text)) {
        return;
      }
      toast.error(text || t("homeWorkspace.stopExecutionFailed"));
    });
  };

  const handleQuickAction = (action: string) => {
    setMode("chat");
    void submitPrompt(action);
    setMessage("");
  };

  async function submitQuestionAnswer(rawInput: string) {
    const trimmed = rawInput.trim();
    const attachmentDrafts = [...attachments];
    const referenceDrafts = [...composerReferences];
    const hasAttachments = attachmentDrafts.length > 0;
    const hasReferences = referenceDrafts.length > 0;
    const displayText =
      trimmed ||
      (hasAttachments || hasReferences
        ? t("homeWorkspace.referencesAdded")
        : "");
    const baseText =
      trimmed ||
      (hasAttachments
        ? DEFAULT_ATTACHMENT_PROMPT
        : hasReferences
          ? t("homeWorkspace.processReferencedAbilities")
          : "");
    if (!baseText) return;

    const altusMode = readAltusMode();
    const activeSessionId = (sessionId || "").trim() || undefined;

    if (hasAttachments) {
      setAttachments([]);
    }
    if (hasReferences) {
      setComposerReferences([]);
    }

    try {
      const { uploadableAttachments, selectedSkills } =
        partitionPendingAttachments(attachmentDrafts);
      const referencedSkills = referenceDrafts
        .filter((item) => item.kind === "skill")
        .map((item) => item.skill)
        .filter((item): item is TaskCreationPlatformSkill => Boolean(item))
        .map((item) => ({
          sourceType: item.sourceType,
          skillId: item.skillId,
          revisionId: item.revisionId,
          slug: item.slug,
          name: item.name,
          description: item.description,
          category: item.category,
          revisionNumber: item.revisionNumber,
          resourceSummary: item.resourceSummary,
        }));
      const mergedSkills = [...selectedSkills, ...referencedSkills].filter(
        (item, index, list) =>
          list.findIndex(
            (current) =>
              current.skillId === item.skillId &&
              current.revisionId === item.revisionId,
          ) === index,
      );
      const selectedMcp = normalizeComposerSelectedMcp(referenceDrafts);
      let uploadedAttachments: UploadedTaskAttachment[] = [];
      if (
        altusMode !== "managed" &&
        uploadableAttachments.length > 0 &&
        activeSessionId
      ) {
        uploadedAttachments = await Promise.all(
          uploadableAttachments.map((item) =>
            uploadTaskCreationAttachment(activeSessionId, item.file),
          ),
        );
      }

      exitHistoryView();
      if (altusMode === "managed") {
        await answerQuestion(baseText, {
          sessionId: activeSessionId,
          metadata: buildManagedTaskInputMetadata({
            originalInput: displayText,
            modelTier: selectedModel || "pro",
            skills: mergedSkills,
            mcpReferences: selectedMcp,
            fileCount: uploadableAttachments.length,
          }),
          files: uploadableAttachments.length
            ? uploadableAttachments.map((item) => item.file)
            : undefined,
        });
      } else {
        await answerQuestion(
          appendAttachmentsToPrompt(baseText, uploadedAttachments),
          {
            sessionId: activeSessionId,
            metadata:
              uploadedAttachments.length || mergedSkills.length
                ? {
                    ...(uploadedAttachments.length
                      ? { attachments: uploadedAttachments }
                      : {}),
                    ...(mergedSkills.length ? { skills: mergedSkills } : {}),
                    ...(selectedMcp.length
                      ? { mcpReferences: selectedMcp }
                      : {}),
                    originalInput: displayText,
                  }
                : selectedMcp.length
                  ? {
                      mcpReferences: selectedMcp,
                      originalInput: displayText,
                    }
                  : undefined,
          },
        );
      }
    } catch (error) {
      if (hasAttachments) {
        const draftFiles = attachmentDrafts
          .filter((item) => item.kind === "file")
          .map((item) => item.file);
        const draftSkills = attachmentDrafts.filter(
          (item) => item.kind === "skill",
        );
        setAttachments((current) => {
          const mergedFiles = mergePendingAttachments(
            current,
            draftFiles,
          ).attachments;
          return mergePendingPlatformSkills(mergedFiles, draftSkills);
        });
      }
      if (hasReferences) {
        setComposerReferences(referenceDrafts);
      }
      toast.error(
        error instanceof Error
          ? error.message
          : t("homeWorkspace.attachmentSendFailed"),
      );
      if (isInsufficientCreditsError(error)) {
        void refreshCreditsRef.current();
      }
    }
  }

  const handleAnswerQuestion = (answer: string) => {
    void submitQuestionAnswer(answer);
  };

  const quickActionLabels = t("homeWorkspace.quickActions", {
    returnObjects: true,
  }) as string[];
  const quickActions = [
    { label: quickActionLabels[0] || "", icon: "📊" },
    { label: quickActionLabels[1] || "", icon: "📄" },
    { label: quickActionLabels[2] || "", icon: "🎨" },
    { label: quickActionLabels[3] || "", icon: "💻" },
  ];

  const chatItems = useMemo(
    () => collapseRepeatedChatAuthors(buildChatItems(messages)),
    [messages],
  );
  const visibleChatItems = useMemo(
    () =>
      groupManagedActivityItems(
        chatItems.filter(
          (item) =>
            item.kind !== "managed_status" || item.displayInTimeline !== false,
        ),
      ),
    [chatItems],
  );
  const managedProcessingText = useMemo(
    () => getActiveManagedStatusText(chatItems),
    [chatItems],
  );
  const altusMode = readAltusMode();
  const managedAltusMode = altusMode === "managed";
  const managedReplayByRun = useMemo(
    () => buildManagedReplayData(messages),
    [messages],
  );
  const latestManagedReplay = useMemo(() => {
    const replays = Array.from(managedReplayByRun.values());
    return replays[replays.length - 1] || null;
  }, [managedReplayByRun]);
  const { diffItems } = useMemo(() => buildPreviewItems(messages), [messages]);
  const hasSendDraft =
    Boolean(message.trim()) ||
    attachments.length > 0 ||
    composerReferences.length > 0;
  const showStopButton = isProcessing && !currentQuestion && !hasSendDraft;
  const slashSkillSuggestions = useMemo(
    () => slashSuggestions.filter((item) => item.kind === "skill"),
    [slashSuggestions],
  );
  const slashMcpSuggestions = useMemo(
    () => slashSuggestions.filter((item) => item.kind === "mcp"),
    [slashSuggestions],
  );
  const suggestionIndexById = useMemo(() => {
    const map = new Map<string, number>();
    slashSuggestions.forEach((item, index) => map.set(item.id, index));
    return map;
  }, [slashSuggestions]);
  const composerReferenceTokens = composerReferences.length ? (
    <div className="flex flex-wrap gap-2">
      {composerReferences.map((token) => (
        <button
          key={token.id}
          type="button"
          onClick={() => removeComposerReference(token)}
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
            token.kind === "skill"
              ? "border-[#34D399]/70 bg-[#ECFDF5] text-[#1E293B]"
              : "border-[#60A5FA]/70 bg-[#EFF6FF] text-[#1E293B]"
          }`}
        >
          <span className="font-medium">
            {token.kind === "skill" ? "skill" : "mcp"}
          </span>
          <span className="max-w-[180px] truncate">{token.label}</span>
          <X className="h-3 w-3 text-muted-foreground" />
        </button>
      ))}
    </div>
  ) : null;
  const slashSuggestionPanel = slashQuery ? (
    slashSuggestions.length ? (
      <div className="space-y-2 rounded-2xl border border-[#CBD5E1] bg-[#FFFFFF] p-2 shadow-[0_12px_40px_rgba(15,23,42,0.08)]">
        {slashSkillSuggestions.length ? (
          <div className="space-y-1">
            <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-[#64748B]">
              Skills
            </div>
            {slashSkillSuggestions.map((item) => {
              const itemIndex = suggestionIndexById.get(item.id) ?? -1;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => applySlashSuggestion(item)}
                  className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-sm transition-colors ${
                    itemIndex === slashActiveIndex
                      ? "bg-[#DBEAFE] text-[#1D4ED8]"
                      : "text-[#0F172A] hover:bg-[#F1F5F9]"
                  }`}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#F1F5F9]">
                    <Terminal className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">
                      {item.label}
                    </span>
                    <span className="block truncate text-xs opacity-80">
                      {item.subLabel}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 opacity-70" />
                </button>
              );
            })}
          </div>
        ) : null}
        {slashMcpSuggestions.length ? (
          <div className="space-y-1">
            {slashSkillSuggestions.length ? (
              <div className="mx-2 h-px bg-[#F1F5F9]" />
            ) : null}
            <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-[#64748B]">
              Connectors
            </div>
            {slashMcpSuggestions.map((item) => {
              const itemIndex = suggestionIndexById.get(item.id) ?? -1;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => applySlashSuggestion(item)}
                  className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-sm transition-colors ${
                    itemIndex === slashActiveIndex
                      ? "bg-[#DBEAFE] text-[#1D4ED8]"
                      : "text-[#0F172A] hover:bg-[#F1F5F9]"
                  }`}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#F1F5F9]">
                    <Plug className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">
                      {item.label}
                    </span>
                    <span className="block truncate text-xs opacity-80">
                      {item.subLabel}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 opacity-70" />
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    ) : (
      <div className="px-1.5 py-1 text-xs text-[#64748B]">
        {slashCatalogLoading
          ? t("homeWorkspace.loadingReferences")
          : slashCatalogError
            ? t("homeWorkspace.referenceLoadFailedWithReason", {
                reason: slashCatalogError,
              })
            : t("homeWorkspace.noReferencesFound", {
                skills: slashSkillCatalog.length,
                connectors: slashMcpCatalog.length,
              })}
      </div>
    )
  ) : null;

  const normalizePath = (value: string) =>
    value
      .replace(/\\+/g, "/")
      .replace(/^\.\/+/, "")
      .toLowerCase();

  const pathMatches = (left: string, right: string) => {
    const a = normalizePath(left);
    const b = normalizePath(right);
    if (!a || !b) return false;
    return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
  };

  const pickExistingDiffId = (id: string | null | undefined) =>
    id && diffItems.some((item) => item.id === id) ? id : null;

  const findDiffIdForMessageKey = (messageKey: string | null | undefined) => {
    const normalized = (messageKey || "").trim();
    if (!normalized) return null;
    for (let i = diffItems.length - 1; i >= 0; i -= 1) {
      const item = diffItems[i];
      if (item.eventMessageKey === normalized) return item.id;
      if (item.relatedMessageKeys?.includes(normalized)) return item.id;
    }
    return null;
  };

  const findDiffIdForFile = (filePath: string | null | undefined) => {
    if (!filePath) return null;
    const fileName = getFilename(filePath).toLowerCase();
    const normalized = normalizePath(filePath);
    if (!fileName && !normalized) return null;
    for (let i = diffItems.length - 1; i >= 0; i -= 1) {
      const item = diffItems[i];
      if (
        item.files?.some(
          (file) =>
            pathMatches(file.file, filePath) ||
            (fileName ? file.file.toLowerCase().includes(fileName) : false),
        )
      ) {
        return item.id;
      }
      if (
        item.diff &&
        ((normalized && item.diff.toLowerCase().includes(normalized)) ||
          (fileName && item.diff.toLowerCase().includes(fileName)))
      ) {
        return item.id;
      }
    }
    return null;
  };

  const findDiffIdForMessageIndex = (
    messageIndex: number | null | undefined,
  ) => {
    if (typeof messageIndex !== "number" || !Number.isFinite(messageIndex)) {
      return null;
    }
    for (let i = diffItems.length - 1; i >= 0; i -= 1) {
      const item = diffItems[i];
      if (item.eventIndex === messageIndex) return item.id;
      if (item.relatedEventIndexes?.includes(messageIndex)) return item.id;
    }
    return null;
  };

  const resolveDiffTarget = (options?: {
    diffId?: string | null;
    filePath?: string | null;
    messageKey?: string | null;
    messageIndex?: number | null;
  }) =>
    pickExistingDiffId(options?.diffId) ||
    pickExistingDiffId(findDiffIdForMessageKey(options?.messageKey)) ||
    pickExistingDiffId(findDiffIdForFile(options?.filePath || null)) ||
    pickExistingDiffId(findDiffIdForMessageIndex(options?.messageIndex)) ||
    diffItems[diffItems.length - 1]?.id ||
    null;

  const openDiffPreview = (options?: {
    diffId?: string | null;
    filePath?: string | null;
    messageKey?: string | null;
    messageIndex?: number | null;
  }) => {
    setPreviewWorkspacePath(null);
    setPreviewTab("changes");
    setPreviewOpen(true);
    const normalizedMessageKey = (options?.messageKey || "").trim() || null;
    if (normalizedMessageKey) {
      setSelectedDiffMessageKey(normalizedMessageKey);
    }
    const target = resolveDiffTarget(options);
    if (
      !target &&
      (options?.diffId ||
        options?.filePath ||
        options?.messageKey ||
        options?.messageIndex !== undefined)
    ) {
      setPendingDiffTarget({
        diffId: options?.diffId || null,
        filePath: options?.filePath || null,
        messageKey: normalizedMessageKey,
        messageIndex:
          typeof options?.messageIndex === "number" &&
          Number.isFinite(options.messageIndex)
            ? options.messageIndex
            : null,
      });
    } else {
      setPendingDiffTarget(null);
    }
    setSelectedDiffId(target);
  };

  const openWorkspacePreview = (path: string) => {
    const normalizedPath = normalizeWorkspaceRelativePath(path, sessionId);
    if (!normalizedPath) return;
    setPreviewWorkspacePath(normalizedPath);
    setPreviewTab("files");
    setPreviewOpen(true);
  };

  const approveGoogleWorkspaceConfirmation = useCallback(
    async (confirmation: GoogleWorkspaceConfirmationView) => {
      if (!sessionId) {
        toast.error(t("homeWorkspace.missingSession"));
        return;
      }
      const result = await approveMcpToolConfirmation(
        sessionId,
        confirmation.confirmationId,
      );
      const connectorLabel = getMcpConfirmationConnectorLabel(
        confirmation.connectorKey,
      );
      appendLocalMessage(
        {
          messageKey: `mcp-confirmation-followup:${confirmation.confirmationId}`,
          type: "status_update",
          content: `已确认执行，正在继续处理 ${connectorLabel} 高风险操作...`,
          message: `已确认执行，正在继续处理 ${connectorLabel} 高风险操作...`,
          stage: "executing",
          tone: "system",
          sessionId,
          metadata: {
            eventType: "run_status",
            status: "running",
            confirmationId: confirmation.confirmationId,
            connectorKey: confirmation.connectorKey,
            source: "mcp_tool_confirmation_followup",
          },
        },
        { sessionId },
      );
      await awaitManagedRunRecovery(sessionId);
      setHandledGoogleConfirmationIds((prev) =>
        prev.includes(confirmation.confirmationId)
          ? prev
          : [...prev, confirmation.confirmationId],
      );
      toast.success(`已确认 ${connectorLabel} 操作`);
    },
    [awaitManagedRunRecovery, sessionId, t],
  );

  const rejectGoogleWorkspaceConfirmation = useCallback(
    async (confirmation: GoogleWorkspaceConfirmationView) => {
      if (!sessionId) {
        toast.error(t("homeWorkspace.missingSession"));
        return;
      }
      const connectorLabel = getMcpConfirmationConnectorLabel(
        confirmation.connectorKey,
      );
      await rejectMcpToolConfirmation(sessionId, confirmation.confirmationId);
      appendLocalMessage(
        {
          messageKey: `mcp-confirmation-rejected:${confirmation.confirmationId}`,
          type: "status_update",
          content: `已拒绝执行，${connectorLabel} 高风险操作已取消。`,
          message: `已拒绝执行，${connectorLabel} 高风险操作已取消。`,
          stage: "executing",
          tone: "system",
          sessionId,
          metadata: {
            eventType: "run_status",
            status: "waiting_user",
            confirmationId: confirmation.confirmationId,
            connectorKey: confirmation.connectorKey,
            source: "mcp_tool_confirmation_followup",
          },
        },
        { sessionId },
      );
      setHandledGoogleConfirmationIds((prev) =>
        prev.includes(confirmation.confirmationId)
          ? prev
          : [...prev, confirmation.confirmationId],
      );
      toast.success(`已拒绝 ${connectorLabel} 操作`);
    },
    [sessionId, t],
  );

  const submitDeploymentPrompt = async (
    action: TaskSessionDeploymentPromptAction,
  ) => {
    if (!sessionId) {
      toast.error(t("homeWorkspace.missingSession"));
      return;
    }

    setPreviewWorkspacePath(null);
    setPreviewTab("deployment");
    setPreviewOpen(true);
    await submitPrompt(buildTaskSessionDeploymentPrompt(action));
  };

  const deployFromArtifactCard = async (_path: string) => {
    try {
      await submitDeploymentPrompt("deploy");
      toast.success(t("homeWorkspace.deploySubmitted"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("homeWorkspace.deployFailed"),
      );
      throw error;
    }
  };

  useEffect(() => {
    if (!selectedDiffId) return;
    const current = diffItems.find((item) => item.id === selectedDiffId);
    if (!current) return;
    const nextMessageKey =
      current.eventMessageKey || current.relatedMessageKeys?.[0] || null;
    if (!nextMessageKey || nextMessageKey === selectedDiffMessageKey) {
      return;
    }
    setSelectedDiffMessageKey(nextMessageKey);
  }, [diffItems, selectedDiffId, selectedDiffMessageKey]);

  useEffect(() => {
    if (!selectedDiffId) return;
    if (diffItems.some((item) => item.id === selectedDiffId)) return;
    const fallback =
      pickExistingDiffId(findDiffIdForMessageKey(selectedDiffMessageKey)) ||
      diffItems[diffItems.length - 1]?.id ||
      null;
    setSelectedDiffId(fallback);
  }, [diffItems, selectedDiffId, selectedDiffMessageKey]);

  useEffect(() => {
    if (!pendingDiffTarget) return;
    const target = resolveDiffTarget(pendingDiffTarget);
    if (!target) return;
    setSelectedDiffId(target);
    setPendingDiffTarget(null);
  }, [diffItems, pendingDiffTarget]);

  const showDesktopPreview = previewOpen && !isMobile;
  const showMobilePreview = previewOpen && isMobile;
  const currentProjectOption = useMemo(
    () =>
      pendingProjectId
        ? projectOptions.find((item) => item.id === pendingProjectId) || null
        : null,
    [pendingProjectId, projectOptions],
  );
  const inputProjectHintLabel =
    projectOptionsLoading && pendingProjectId && !currentProjectOption
      ? t("homePage.projectContextLoading")
      : clampProjectHintLabel(
          currentProjectOption?.name || t("homePage.projectNoProject"),
          8,
        );
  const showInputProjectHint =
    mode === "input" && location.startsWith("/new-task");
  const activeAltusReplay = altusReplayRunId
    ? managedReplayByRun.get(altusReplayRunId) || null
    : latestManagedReplay;
  const activeAltusReplayIndex =
    activeAltusReplay && activeAltusReplay.actions.length > 0
      ? Math.min(
          Math.max(0, altusReplayIndex),
          activeAltusReplay.actions.length - 1,
        )
      : 0;
  const previewResizeDraggingRef = useRef(false);
  const previewResizeLastClientXRef = useRef<number | null>(null);
  const previewPanelMaxSize = managedAltusMode ? 70 : 48;
  const previewPanelMinSize = managedAltusMode ? 50 : 30;
  const previewPanelDefaultSize = managedAltusMode ? 50 : 34;
  const chatPanelDefaultSize = 100 - previewPanelDefaultSize;
  const chatPanelMinSize = managedAltusMode ? 30 : 42;

  const openAltusReplay = (
    runId: string,
    options?: {
      toolCallId?: string | null;
      view?: AltusDrawerView;
    },
  ) => {
    if (!runId) return;
    setAltusReplayRunId(runId);
    setAltusReplayView(options?.view || "actions");
    setPreviewOpen(true);
    setPreviewMaximized(false);
    if (options?.toolCallId) {
      setPendingAltusReplayToolCallId(options.toolCallId);
    } else {
      const replay = managedReplayByRun.get(runId);
      setAltusReplayIndex(Math.max(0, (replay?.actions.length || 1) - 1));
      setPendingAltusReplayToolCallId(null);
    }
  };

  useEffect(() => {
    if (!activeAltusReplay) {
      return;
    }
    if (pendingAltusReplayToolCallId) {
      const action = activeAltusReplay.actions.find(
        (item) => item.toolCallId === pendingAltusReplayToolCallId,
      );
      if (action) {
        setAltusReplayIndex(action.stepIndex);
        setPendingAltusReplayToolCallId(null);
        return;
      }
    }
    if (activeAltusReplay.actions.length === 0) {
      if (altusReplayIndex !== 0) {
        setAltusReplayIndex(0);
      }
      return;
    }
    const maxIndex = activeAltusReplay.actions.length - 1;
    if (altusReplayIndex > maxIndex) {
      setAltusReplayIndex(maxIndex);
    }
  }, [activeAltusReplay, altusReplayIndex, pendingAltusReplayToolCallId]);

  useEffect(() => {
    if (!previewOpen && previewMaximized) {
      setPreviewMaximized(false);
    }
  }, [previewOpen, previewMaximized]);

  useEffect(() => {
    if (!location.startsWith("/new-task") || !projectOptionsLoaded) {
      return;
    }
    if (!pendingProjectId) {
      return;
    }
    const exists = projectOptions.some((item) => item.id === pendingProjectId);
    if (exists) {
      return;
    }
    setPendingProjectId(null);
    syncPendingProjectToUrl(null);
  }, [
    location,
    pendingProjectId,
    projectOptions,
    projectOptionsLoaded,
    syncPendingProjectToUrl,
  ]);

  const handlePreviewResizeDragging = useCallback((isDragging: boolean) => {
    previewResizeDraggingRef.current = isDragging;
    if (!isDragging) {
      previewResizeLastClientXRef.current = null;
    }
  }, []);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!previewResizeDraggingRef.current) return;
      const previousClientX = previewResizeLastClientXRef.current;
      previewResizeLastClientXRef.current = event.clientX;
      if (previousClientX === null) {
        return;
      }
      if (
        shouldAutoCollapseSidebarForAltusActions({
          managedAltusMode,
          sidebarCollapsed,
          previewOpen,
          previewMaximized,
          previewPanelSize: desktopPreviewLayout[1] || 0,
          previewPanelMaxSize,
          dragDeltaX: event.clientX - previousClientX,
        })
      ) {
        setSidebarCollapsed(true);
        previewResizeDraggingRef.current = false;
        previewResizeLastClientXRef.current = null;
      }
    };

    const handlePointerUp = () => {
      previewResizeDraggingRef.current = false;
      previewResizeLastClientXRef.current = null;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [
    desktopPreviewLayout,
    managedAltusMode,
    previewOpen,
    previewMaximized,
    sidebarCollapsed,
  ]);

  const previewPanel = previewOpen ? (
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
      {managedAltusMode && sessionId ? (
        <AltusRunReplayDrawer
          embedded
          open={previewOpen}
          onOpenChange={(open) => {
            setPreviewOpen(open);
            if (!open) {
              setPreviewMaximized(false);
            }
          }}
          sessionId={sessionId}
          runId={activeAltusReplay?.runId || "managed-preview"}
          runTitle={t("homeWorkspace.altusActions")}
          actions={activeAltusReplay?.actions || []}
          files={activeAltusReplay?.files || []}
          currentIndex={activeAltusReplayIndex}
          latestIndex={Math.max(
            0,
            (activeAltusReplay?.actions.length || 1) - 1,
          )}
          activeView={altusReplayView}
          onActiveViewChange={setAltusReplayView}
          onSelectIndex={setAltusReplayIndex}
          onJumpToLatest={() =>
            setAltusReplayIndex(
              Math.max(0, (activeAltusReplay?.actions.length || 1) - 1),
            )
          }
          diffItems={activeAltusReplay?.diffItems || []}
          runtimeReady={runtime.ready}
          runtimeStarting={runtime.starting}
          onEnsureRuntime={runtime.ensure}
          runtimeSwitchBlocked={managedRunActive}
          onRequestStartDebugByMessage={() => {
            void submitPrompt(t("homeWorkspace.startDebugPrompt"));
          }}
          onRequestDeployByMessage={() => {
            void submitDeploymentPrompt("deploy");
          }}
          onRequestRedeployByMessage={() => {
            void submitDeploymentPrompt("redeploy");
          }}
          onRequestRollbackByMessage={() => {
            void submitDeploymentPrompt("rollback");
          }}
        />
      ) : (
        <OpencodePreviewPanel
          messages={messages}
          sessionId={sessionId}
          open={previewOpen}
          maximized={previewMaximized}
          onToggleMaximized={() => setPreviewMaximized((prev) => !prev)}
          activeTab={previewTab}
          onTabChange={setPreviewTab}
          onToggle={() => setPreviewOpen(false)}
          selectedDiffId={selectedDiffId}
          onSelectDiff={(id) => {
            setPendingDiffTarget(null);
            setSelectedDiffId(id);
          }}
          runtimeReady={runtime.ready}
          runtimeStarting={runtime.starting}
          onEnsureRuntime={runtime.ensure}
          runtimeSwitchBlocked={managedRunActive}
          onRequestStartDebugByMessage={() => {
            void submitPrompt(t("homeWorkspace.startDebugPrompt"));
          }}
          onRequestDeployByMessage={() => {
            void submitDeploymentPrompt("deploy");
          }}
          onRequestRedeployByMessage={() => {
            void submitDeploymentPrompt("redeploy");
          }}
          onRequestRollbackByMessage={() => {
            void submitDeploymentPrompt("rollback");
          }}
          selectedWorkspacePath={previewWorkspacePath}
          className="h-full min-h-0 w-full"
        />
      )}
    </section>
  ) : null;

  const chatPanel = (
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-background/35">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0 space-y-1">
            <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              {t("homeWorkspace.dialogueLabel")}
            </div>
            <div className="truncate text-sm font-semibold text-foreground">
              {t("homeWorkspace.dialogueTitle")}
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            {runtime.orchestratorSessionId && runtime.ready ? (
              <span className="truncate text-xs text-muted-foreground">
                {t("homeWorkspace.runtimeAttached", {
                  sessionId: runtime.orchestratorSessionId,
                })}
              </span>
            ) : null}
          </div>
        </div>
        <div
          ref={messageScrollRef}
          onWheelCapture={(event) => {
            if (event.deltaY < 0) {
              olderHistoryIntentRef.current = true;
            }
          }}
          onPointerDownCapture={() => {
            olderHistoryIntentRef.current = true;
          }}
          onTouchStart={() => {
            olderHistoryIntentRef.current = true;
          }}
          onScroll={() => {
            void handleMessageScroll();
          }}
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-6 py-5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        >
          <div className="mx-auto w-full space-y-4">
            {isLoadingOlderHistory && (
              <NoticeMessage
                tone="info"
                icon={<Loader2 className="w-4 h-4 animate-spin" />}
                text={t("homeWorkspace.loadingOlderHistory")}
              />
            )}

            {!isConnected && (
              <NoticeMessage
                tone="warning"
                icon={<Loader2 className="w-4 h-4 animate-spin" />}
                text={t("homeWorkspace.connectingAgent")}
              />
            )}

            {runtime.orchestratorSessionId && runtime.ready && (
              <NoticeMessage
                tone="info"
                icon={
                  <Loader2
                    className={`w-4 h-4 ${runtime.syncing ? "animate-spin" : ""}`}
                  />
                }
                text={t("homeWorkspace.runtimeConnected", {
                  sessionId: runtime.orchestratorSessionId,
                })}
              />
            )}

            <AnimatePresence>
              {visibleChatItems.map((item, index) => (
                <MessageBubble
                  key={item.messageKey || `chat-item-${index}`}
                  item={item}
                  onOpenDiffPreview={openDiffPreview}
                  onOpenManagedReplay={openAltusReplay}
                  onOpenWorkspacePreview={openWorkspacePreview}
                  onDeployArtifact={deployFromArtifactCard}
                  runtimeSwitchBlocked={managedRunActive}
                  currentSessionId={sessionId}
                  hiddenGoogleConfirmationIds={resolvedGoogleConfirmationIds}
                  onApproveGoogleWorkspaceConfirmation={
                    approveGoogleWorkspaceConfirmation
                  }
                  onRejectGoogleWorkspaceConfirmation={
                    rejectGoogleWorkspaceConfirmation
                  }
                />
              ))}
            </AnimatePresence>

            {isProcessing && !currentQuestion && (
              <NoticeMessage
                tone="info"
                icon={<Loader2 className="w-4 h-4 animate-spin" />}
                text={managedProcessingText || t("homeWorkspace.agentProcessing")}
              />
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{
            delay: 0.2,
            duration: 0.4,
            ease: "easeOut",
          }}
          className="mt-auto shrink-0 bg-background/90 backdrop-blur"
        >
          <div className="px-6 py-3">
            {sessionId ? (
              <div className="mx-auto mb-2 w-[92%] max-w-full">
                <SessionCreditBar sessionId={sessionId} refreshKey={managedRunStatus} />
              </div>
            ) : null}
            {slashSuggestionPanel ? (
              <div className="mx-auto mb-2 w-[92%] max-w-full">
                {slashSuggestionPanel}
              </div>
            ) : null}
            <div className="w-full rounded-[2rem] border border-border/70 bg-card shadow-[0_12px_40px_rgba(15,23,42,0.08)] transition-all duration-200 hover:border-border focus-within:border-ring focus-within:shadow-[0_0_0_4px_rgba(59,130,246,0.18),0_12px_40px_rgba(15,23,42,0.08)] dark:shadow-[0_18px_48px_rgba(0,0,0,0.36)]">
              <div className="space-y-3 p-4">
                <Textarea
                  placeholder={
                    currentQuestion
                      ? t("homeWorkspace.answerPlaceholder")
                      : t("homeWorkspace.continuePlaceholder")
                  }
                  value={message}
                  onChange={(e) => handleComposerInputChange(e.target.value)}
                  onKeyDown={(e) =>
                    handleComposerKeyDown(e, {
                      submit: () => {
                        if (currentQuestion) {
                          handleAnswerQuestion(message);
                          setMessage("");
                        } else if (showStopButton) {
                          handleStop();
                        } else {
                          handleSend();
                        }
                      },
                    })
                  }
                  className="min-h-[56px] resize-none border-0 bg-transparent px-0 py-0 text-base text-foreground placeholder:text-muted-foreground focus-visible:ring-0"
                  rows={2}
                />
                {composerReferenceTokens}

                <AttachmentChipList
                  attachments={attachments}
                  onRemove={removeAttachment}
                />

                <TooltipProvider>
                  <div className="flex items-center justify-between pt-2">
                    <div className="flex items-center gap-1">
                      <AttachmentPickerButton
                        onSelectFiles={handleAttachmentSelect}
                        onSelectSkills={handleSkillSelect}
                      />

                      <ConnectorDialog sessionId={sessionId} />

                      <DropdownMenu>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-9 gap-2 rounded-xl px-3 transition-colors hover:bg-accent"
                              >
                                <Sparkles className="w-4 h-4 text-muted-foreground" />
                                <span className="text-sm text-muted-foreground">
                                  {t(`homePage.models.${selectedModel}`)}
                                </span>
                              </Button>
                            </DropdownMenuTrigger>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{t("homePage.selectModel")}</p>
                          </TooltipContent>
                        </Tooltip>
                        <DropdownMenuContent align="start" className="w-40">
                          <DropdownMenuItem
                            onClick={() => setSelectedModel("lite")}
                          >
                            <div className="flex flex-col">
                              <span className="font-medium">
                                {t("homePage.models.lite")}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {t("ceoView.modelLiteHint")}
                              </span>
                            </div>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setSelectedModel("pro")}
                          >
                            <div className="flex flex-col">
                              <span className="font-medium">
                                {t("homePage.models.pro")}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {t("ceoView.modelProHint")}
                              </span>
                            </div>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setSelectedModel("max")}
                          >
                            <div className="flex flex-col">
                              <span className="font-medium">
                                {t("homePage.models.max")}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {t("ceoView.modelMaxHint")}
                              </span>
                            </div>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    <div className="flex items-center gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9 rounded-full transition-colors hover:bg-accent"
                          >
                            <Mic className="w-4 h-4 text-muted-foreground" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>{t("homePage.voiceInput")}</p>
                        </TooltipContent>
                      </Tooltip>

                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            onClick={() => {
                              if (currentQuestion) {
                                handleAnswerQuestion(message);
                                setMessage("");
                              } else if (showStopButton) {
                                handleStop();
                              } else {
                                handleSend();
                              }
                            }}
                            disabled={
                              isInterrupting ||
                              (currentQuestion
                                ? !message.trim() && attachments.length === 0
                                : showStopButton
                                  ? false
                                  : !message.trim() && attachments.length === 0)
                            }
                            size="icon"
                            className="h-9 w-9 rounded-full bg-foreground text-background transition-colors hover:bg-foreground/90 disabled:opacity-50"
                          >
                            {showStopButton ? (
                              <Square className="w-4 h-4" />
                            ) : (
                              <Send className="w-4 h-4" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>
                            {showStopButton
                              ? t("homeWorkspace.stopExecution")
                              : t("homePage.sendMessage")}
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                </TooltipProvider>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );

  return (
    <WorkspaceLayout
      fluid={mode === "chat"}
      lockViewport={mode === "chat"}
      selectedProject={selectedProject}
      sidebarCollapsed={sidebarCollapsed}
      onSidebarCollapsedChange={setSidebarCollapsed}
    >
      <div
        className={
          mode === "chat"
            ? "flex h-[calc(100vh-2rem)] min-h-0 flex-col overflow-hidden overscroll-none"
            : "flex min-h-[calc(100vh-2rem)] flex-col"
        }
      >
        <AnimatePresence mode="wait">
          {mode === "input" ? (
            // 初始输入模式
            <motion.div
              key="input-mode"
              initial={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="flex items-center justify-center min-h-[calc(100vh-2rem)]"
            >
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
                className="w-full max-w-3xl space-y-8"
              >
                {/* Logo and Title */}
                <div className="text-center space-y-4">
                  <motion.div
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: 0.1, duration: 0.4 }}
                    className="flex items-center justify-center gap-3"
                  >
                    <div className="w-12 h-12 bg-foreground rounded-2xl flex items-center justify-center shadow-lg">
                      <span className="text-background font-bold text-xl">
                        M
                      </span>
                    </div>
                    <h1 className="text-3xl font-semibold text-foreground tracking-tight">
                      {t("homePage.title")}
                    </h1>
                  </motion.div>
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.2, duration: 0.4 }}
                    className="text-muted-foreground text-lg"
                  >
                    {t("homePage.subtitle")}
                  </motion.p>
                </div>

                {/* Main Input Area */}
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3, duration: 0.4 }}
                  className="relative"
                >
                  <div className="relative pt-1">
                    {slashSuggestionPanel ? (
                      <div className="mx-auto mb-2 w-[92%] max-w-full">
                        {slashSuggestionPanel}
                      </div>
                    ) : null}
                    {/* Text Area and Actions - Single Container */}
                    <div className="relative z-10 space-y-3 rounded-[2rem] border border-border/70 bg-card p-4 shadow-[0_12px_40px_rgba(15,23,42,0.08)] transition-all duration-200 hover:border-border focus-within:border-ring focus-within:shadow-[0_0_0_4px_rgba(59,130,246,0.18),0_12px_40px_rgba(15,23,42,0.08)] dark:shadow-[0_18px_48px_rgba(0,0,0,0.36)]">
                      {/* Textarea */}
                      <Textarea
                        placeholder={t("homePage.textareaPlaceholder")}
                        value={message}
                        onChange={(e) =>
                          handleComposerInputChange(e.target.value)
                        }
                        onKeyDown={(e) =>
                          handleComposerKeyDown(e, {
                            submit: () => handleSend(),
                          })
                        }
                        className="min-h-[100px] resize-none border-0 bg-transparent px-0 py-0 text-base text-foreground placeholder:text-muted-foreground focus-visible:ring-0"
                        rows={4}
                      />
                      {composerReferenceTokens}

                      <AttachmentChipList
                        attachments={attachments}
                        onRemove={removeAttachment}
                      />

                      {/* Bottom Action Bar */}
                      <TooltipProvider>
                        <div className="flex items-center justify-between pt-2">
                          {/* Left Side Actions */}
                          <div className="flex items-center gap-1">
                            <AttachmentPickerButton
                              onSelectFiles={handleAttachmentSelect}
                              onSelectSkills={handleSkillSelect}
                            />

                            <ConnectorDialog sessionId={sessionId} />

                            {/* Model Selection Button */}
                            <DropdownMenu>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-9 gap-2 rounded-xl transition-colors hover:bg-accent"
                                    >
                                      <Sparkles className="w-4 h-4 text-muted-foreground" />
                                      <span className="text-sm text-muted-foreground">
                                        {t(`homePage.models.${selectedModel}`)}
                                      </span>
                                    </Button>
                                  </DropdownMenuTrigger>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>{t("homePage.selectModel")}</p>
                                </TooltipContent>
                              </Tooltip>
                              <DropdownMenuContent
                                align="start"
                                className="w-40"
                              >
                                <DropdownMenuItem
                                  onClick={() => setSelectedModel("lite")}
                                >
                                  <div className="flex flex-col">
                                    <span className="font-medium">
                                      {t("homePage.models.lite")}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                      {t("ceoView.modelLiteHint")}
                                    </span>
                                  </div>
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => setSelectedModel("pro")}
                                >
                                  <div className="flex flex-col">
                                    <span className="font-medium">
                                      {t("homePage.models.pro")}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                      {t("ceoView.modelProHint")}
                                    </span>
                                  </div>
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => setSelectedModel("max")}
                                >
                                  <div className="flex flex-col">
                                    <span className="font-medium">
                                      {t("homePage.models.max")}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                      {t("ceoView.modelMaxHint")}
                                    </span>
                                  </div>
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>

                          {/* Right Side Actions */}
                          <div className="flex items-center gap-1">
                            {/* Voice Input Button */}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-9 w-9 rounded-full transition-colors hover:bg-accent"
                                >
                                  <Mic className="w-4 h-4 text-muted-foreground" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>{t("homePage.voiceInput")}</p>
                              </TooltipContent>
                            </Tooltip>

                            {/* Send Button */}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  onClick={handleSend}
                                  disabled={
                                    !message.trim() &&
                                    attachments.length === 0 &&
                                    composerReferences.length === 0
                                  }
                                  size="icon"
                                  className="h-9 w-9 rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                                >
                                  <Send className="w-4 h-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>{t("homePage.sendMessage")}</p>
                              </TooltipContent>
                            </Tooltip>
                          </div>
                        </div>
                      </TooltipProvider>
                    </div>
                    {showInputProjectHint ? (
                      <DropdownMenu
                        open={projectMenuOpen}
                        onOpenChange={setProjectMenuOpen}
                      >
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="relative z-0 -mt-5 mx-auto flex w-[94%] items-center justify-end rounded-b-[1.65rem] rounded-t-[0.9rem] border border-t-0 border-border/35 bg-muted/42 px-5 pb-3 pt-7 text-right shadow-[0_16px_28px_rgba(15,23,42,0.07)] backdrop-blur-[2px] transition-colors hover:bg-muted/54 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 dark:bg-muted/24 dark:hover:bg-muted/32 dark:shadow-[0_18px_32px_rgba(0,0,0,0.18)]"
                            aria-label={t("homePage.projectSelectorLabel")}
                          >
                            <div className="flex min-w-0 items-center justify-end gap-2 text-right">
                              <FolderSearch2 className="h-4 w-4 shrink-0 text-foreground/42" />
                              <span className="block truncate text-sm font-medium tracking-[0.01em] text-foreground/72">
                                {inputProjectHintLabel}
                              </span>
                              <ChevronDown className="h-4 w-4 shrink-0 text-foreground/42" />
                            </div>
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          side="bottom"
                          sideOffset={2}
                          className="w-[22rem] max-w-[calc(100vw-2.5rem)] rounded-2xl border-border/70 p-1.5 shadow-xl"
                        >
                          {projectOptionsLoading ? (
                              <DropdownMenuItem disabled className="rounded-xl px-3 py-2.5">
                              {t("homePage.projectListLoading")}
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuRadioGroup
                              value={pendingProjectId || NO_PROJECT_VALUE}
                              onValueChange={(value) => {
                                const nextProjectId =
                                  value === NO_PROJECT_VALUE ? null : value;
                                setPendingProjectId(nextProjectId);
                                syncPendingProjectToUrl(nextProjectId);
                              }}
                            >
                              <DropdownMenuRadioItem
                                value={NO_PROJECT_VALUE}
                                hideIndicator
                                className="rounded-xl px-3 py-2.5"
                              >
                                <span className="block truncate">
                                  {t("homePage.projectNoProject")}
                                </span>
                              </DropdownMenuRadioItem>
                              {projectOptions.length > 0 ? (
                                projectOptions.map((project) => (
                                  <DropdownMenuRadioItem
                                    key={project.id}
                                    value={project.id}
                                    hideIndicator
                                    className="rounded-xl px-3 py-2.5"
                                  >
                                    <span className="block truncate">
                                      {project.name}
                                    </span>
                                  </DropdownMenuRadioItem>
                                ))
                              ) : (
                                  <DropdownMenuItem disabled className="rounded-xl px-3 py-2.5">
                                  {t("homePage.projectListEmpty")}
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuRadioGroup>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </div>
                </motion.div>

              </motion.div>
            </motion.div>
          ) : (
            // 对话模式
            <motion.div
              key="chat-mode"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
              className="flex h-full flex-1 min-h-0 overflow-hidden overscroll-none"
            >
              {showDesktopPreview ? (
                previewMaximized ? (
                  <div className="flex h-full min-h-0 flex-1 overflow-hidden">
                      <div className="h-full min-h-0 w-full">
                        {previewPanel}
                      </div>
                  </div>
                ) : (
                  <ResizablePanelGroup
                    direction="horizontal"
                    autoSaveId="task-creation-chat-layout"
                    className="h-full min-h-0"
                    onLayout={(sizes) => {
                      if (sizes.length >= 2) {
                        setDesktopPreviewLayout([sizes[0] || 0, sizes[1] || 0]);
                      }
                    }}
                  >
                      <ResizablePanel
                        defaultSize={chatPanelDefaultSize}
                        minSize={chatPanelMinSize}
                      >
                      <div className="h-full min-h-0 pr-2">{chatPanel}</div>
                    </ResizablePanel>
                    <ResizableHandle
                      withHandle
                      className="bg-transparent after:bg-transparent"
                      onDragging={handlePreviewResizeDragging}
                    />
                    <ResizablePanel
                      defaultSize={previewPanelDefaultSize}
                      minSize={previewPanelMinSize}
                      maxSize={previewPanelMaxSize}
                    >
                        <div className="h-full min-h-0 pl-2">
                          {previewPanel}
                        </div>
                    </ResizablePanel>
                  </ResizablePanelGroup>
                )
              ) : (
                <div className="flex h-full min-h-0 flex-1 flex-col gap-4 overflow-hidden">
                  {!previewMaximized ? (
                    <div className="flex-1 min-h-0">{chatPanel}</div>
                  ) : null}
                  {showMobilePreview ? (
                    <div
                      className={
                        previewMaximized
                          ? "flex-1 min-h-0"
                          : "h-[min(45vh,32rem)] min-h-[280px] shrink-0"
                      }
                    >
                      {previewPanel}
                    </div>
                  ) : null}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {!managedAltusMode && activeAltusReplay && sessionId ? (
        <AltusRunReplayDrawer
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          sessionId={sessionId}
          runId={activeAltusReplay.runId}
          runTitle={t("homeWorkspace.altusActions")}
          actions={activeAltusReplay.actions}
          files={activeAltusReplay.files}
          currentIndex={activeAltusReplayIndex}
          latestIndex={Math.max(0, activeAltusReplay.actions.length - 1)}
          activeView={altusReplayView}
          onActiveViewChange={setAltusReplayView}
          onSelectIndex={setAltusReplayIndex}
          onJumpToLatest={() =>
            setAltusReplayIndex(
              Math.max(0, activeAltusReplay.actions.length - 1),
            )
          }
          diffItems={diffItems}
          runtimeReady={runtime.ready}
          runtimeStarting={runtime.starting}
          onEnsureRuntime={runtime.ensure}
          runtimeSwitchBlocked={managedRunActive}
          onRequestStartDebugByMessage={() => {
            void submitPrompt(t("homeWorkspace.startDebugPrompt"));
          }}
          onRequestDeployByMessage={() => {
            void submitDeploymentPrompt("deploy");
          }}
          onRequestRedeployByMessage={() => {
            void submitDeploymentPrompt("redeploy");
          }}
          onRequestRollbackByMessage={() => {
            void submitDeploymentPrompt("rollback");
          }}
        />
      ) : null}
    </WorkspaceLayout>
  );
}

/**
 * 消息气泡组件
 */
function NoticeMessage({
  text,
  icon,
  tone,
}: {
  text: string;
  icon: ReactNode;
  tone: "info" | "warning";
}) {
  const toneClass = "border-border/70 bg-muted/50 text-foreground/80";

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <div
        className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] ${toneClass} [&>svg]:size-3.5`}
      >
        {icon}
        <span>{text}</span>
      </div>
    </motion.div>
  );
}

export type ChatItem =
  | {
      kind: "user";
      text: string;
      skills?: TaskCreationPlatformSkill[];
      attachments?: UploadedTaskAttachment[];
      messageKey?: string;
    }
  | {
      kind: "agent";
      markdown: string;
      author?: string;
      messageKey?: string;
      showAuthor?: boolean;
    }
  | {
      kind: "clarification_notice";
      text: string;
      messageKey?: string;
    }
  | {
      kind: "agent_explanation";
      markdown: string;
      heading: string;
      collapsedMarkdown?: string;
      author?: string;
      messageKey?: string;
      active?: boolean;
      showAuthor?: boolean;
    }
  | {
      kind: "agent_plain";
      text: string;
      author?: string;
      messageKey?: string;
      showAuthor?: boolean;
    }
  | {
      kind: "managed_status";
      text: string;
      messageKey?: string;
      displayInTimeline?: boolean;
    }
  | {
      kind: "capsule";
      label: string;
      tone: "system" | "intent" | "planning" | "execution" | "review" | "error";
      loading?: boolean;
      segments?: string[];
      messageKey?: string;
    }
  | {
      kind: "opencode_tool";
      eventType: string;
      event: Record<string, unknown>;
      content?: string;
      metadata?: Record<string, unknown>;
      messageIndex: number;
      diffId?: string;
      messageKey?: string;
    }
  | {
      kind: "managed_tool";
      runId: string;
      toolCallId: string;
      eventType: string;
      toolName: string;
      status: "running" | "completed" | "failed" | "unknown";
      summary?: string;
      detail?: string;
      artifactPaths?: string[];
      metadata?: Record<string, unknown>;
      messageKey?: string;
    }
  | {
      kind: "managed_activity_group";
      title: string;
      messageKey?: string;
      defaultExpanded?: boolean;
      items: Array<
        | {
            kind: "managed_status";
            text: string;
            messageKey?: string;
            displayInTimeline?: boolean;
          }
        | {
            kind: "managed_tool";
            runId: string;
            toolCallId: string;
            eventType: string;
            toolName: string;
            status: "running" | "completed" | "failed" | "unknown";
            summary?: string;
            detail?: string;
            artifactPaths?: string[];
            metadata?: Record<string, unknown>;
            messageKey?: string;
          }
      >;
    }
  | {
      kind: "managed_artifact_card";
      sessionId: string;
      runId: string;
      artifacts: AltusArtifactFile[];
      previewSnapshot?: TaskCreationWebsitePreviewSnapshot | null;
      messageKey?: string;
    }
  | {
      kind: "managed_deliverable_card";
      sessionId: string;
      runId: string;
      deliverables: TaskCreationDeliverableArtifact[];
      messageKey?: string;
    }
  | {
      kind: "opencode_turn";
      userText: string;
      skills?: TaskCreationPlatformSkill[];
      attachments?: UploadedTaskAttachment[];
      userMessageKey?: string;
      assistantParts: OpencodeTurnPart[];
      working?: boolean;
      thinkingLabel?: string;
      messageKey?: string;
    };

type OpencodeTurnPart =
  | {
      kind: "text";
      markdown: string;
      messageKey?: string;
      partId?: string;
    }
  | {
      kind: "reasoning";
      markdown: string;
      messageKey?: string;
      partId?: string;
    }
  | {
      kind: "tool";
      eventType: string;
      event: Record<string, unknown>;
      content?: string;
      metadata?: Record<string, unknown>;
      messageIndex: number;
      diffId?: string;
      messageKey?: string;
      partId?: string;
    };

export type DirectMarkdownSegment =
  | {
      kind: "markdown";
      markdown: string;
    }
  | {
      kind: "foldable";
      markdown: string;
      summary: string;
      lineCount: number;
    };

type CapsuleTone =
  | "system"
  | "intent"
  | "planning"
  | "execution"
  | "review"
  | "error";

type ProgressStatusDefinition = {
  patterns: string[];
  tone: CapsuleTone;
  loading: boolean;
};

type FallbackLabelDefinition = {
  pattern: string;
  tone: CapsuleTone;
};

const PROGRESS_STATUS_DEFINITIONS: ProgressStatusDefinition[] = [
  {
    patterns: ["构思阶段", "Ideation stage"],
    tone: "system",
    loading: true,
  },
  {
    patterns: ["分析阶段", "Analysis stage"],
    tone: "intent",
    loading: true,
  },
  {
    patterns: ["开发阶段", "Development stage"],
    tone: "execution",
    loading: true,
  },
  {
    patterns: ["测试阶段", "Testing stage"],
    tone: "review",
    loading: true,
  },
  {
    patterns: ["修复阶段", "Fix stage"],
    tone: "execution",
    loading: true,
  },
  {
    patterns: ["交付阶段", "Delivery stage"],
    tone: "planning",
    loading: true,
  },
  {
    patterns: ["正在分析您的任务需求", "Analyzing your task requirements"],
    tone: "intent",
    loading: true,
  },
  {
    patterns: [
      "正在分析您的任务需求...",
      "Analyzing your task requirements...",
    ],
    tone: "intent",
    loading: true,
  },
  {
    patterns: ["已识别任务类型", "Task type identified"],
    tone: "intent",
    loading: false,
  },
  {
    patterns: ["正在规划任务详情", "Planning task details"],
    tone: "planning",
    loading: true,
  },
  {
    patterns: ["正在规划任务详情...", "Planning task details..."],
    tone: "planning",
    loading: true,
  },
  {
    patterns: ["任务规划完成", "Task planning completed"],
    tone: "planning",
    loading: false,
  },
  {
    patterns: ["任务规划完成：", "Task planning completed:"],
    tone: "planning",
    loading: false,
  },
  {
    patterns: ["正在生成执行计划", "Generating execution plan"],
    tone: "planning",
    loading: true,
  },
  {
    patterns: ["正在生成执行计划...", "Generating execution plan..."],
    tone: "planning",
    loading: true,
  },
  {
    patterns: ["执行计划已生成", "Execution plan generated"],
    tone: "planning",
    loading: false,
  },
  {
    patterns: ["正在启动执行环境", "Starting execution environment"],
    tone: "execution",
    loading: true,
  },
  {
    patterns: ["执行环境已就绪", "Execution environment ready"],
    tone: "execution",
    loading: false,
  },
];

const CAPSULE_FALLBACK_LABELS: FallbackLabelDefinition[] = [
  {
    pattern: "意图识别",
    tone: "intent",
  },
  {
    pattern: "任务规划",
    tone: "planning",
  },
  {
    pattern: "执行计划",
    tone: "planning",
  },
  {
    pattern: "系统",
    tone: "system",
  },
  {
    pattern: "错误",
    tone: "error",
  },
];

function findProgressStatusDefinition(
  label: string,
): ProgressStatusDefinition | null {
  const text = label.trim();
  if (!text) return null;
  return (
    PROGRESS_STATUS_DEFINITIONS.find((definition) =>
      definition.patterns.some((pattern) => text.includes(pattern)),
    ) || null
  );
}

function findFallbackCapsuleLabel(
  label: string,
): FallbackLabelDefinition | null {
  const text = label.trim();
  if (!text) return null;
  return (
    CAPSULE_FALLBACK_LABELS.find((definition) =>
      text.startsWith(definition.pattern),
    ) || null
  );
}

function buildLegacyChatItems(messages: AgentMessage[]): ChatItem[] {
  const items: ChatItem[] = [];
  let progressBuffer: {
    label: string;
    tone: CapsuleTone;
    loading: boolean;
    messageKey?: string;
  } | null = null;
  const seenDiffs = new Set<string>();
  const seenFinalMessages = new Set<string>();
  const normalizeForDedup = (value: string): string =>
    value.replace(/\r\n/g, "\n").trim();
  const normalizeClarificationComparableText = (value: string): string =>
    value
      .replace(/\r\n/g, "\n")
      .replace(/\*\*需要补充信息\*\*/g, "")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  const buildClarificationSemanticKey = (value: string): string =>
    normalizeClarificationComparableText(value).replace(/\s+/g, "");
  const userTextSet = new Set<string>();
  const finalizedPartIds = new Set<string>();
  const codexTurnFilePaths = new Map<string, string[]>();
  const lastCodexDiffIndexByTurn = new Map<string, number>();
  const managedArtifactsByRun = new Map<string, AltusArtifactFile[]>();
  const emittedManagedCompletionRuns = new Set<string>();
  let managedStatusBuffer: {
    text: string;
    messageKey?: string;
    displayInTimeline: boolean;
  } | null = null;

  const getPartIdFromMetadata = (metadata: Record<string, unknown>): string => {
    const explicit = asText(metadata.partId);
    if (explicit) return explicit;
    const rawPayload = toRecord(metadata.rawPayload);
    const event = toRecord(rawPayload.event);
    const properties = toRecord(event.properties);
    const part = toRecord(properties.part);
    return asText(part.id) || asText(properties.partId);
  };

  // 预扫描：构建用户文本集和已终态 partId。
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.type === "user_input" || message.type === "user_response") {
      const normalized = normalizeForDedup(message.content || "");
      if (normalized) userTextSet.add(normalized);
      continue;
    }
    if (message.type !== "opencode_event") continue;
    const metadata = toRecord(message.metadata);
    const eventInfo = getOpencodeEventInfo(metadata);
    if (eventInfo.eventType === "message.final") {
      const partId = getPartIdFromMetadata(metadata);
      if (partId) finalizedPartIds.add(partId);
    }
  }

  const mergeCodexTurnFilePath = (turnId: string, path: string) => {
    const normalizedTurnId = turnId.trim();
    const normalizedPath = path.trim();
    if (!normalizedTurnId || !normalizedPath) return;
    const existing = codexTurnFilePaths.get(normalizedTurnId) || [];
    if (existing.includes(normalizedPath)) return;
    codexTurnFilePaths.set(normalizedTurnId, [...existing, normalizedPath]);
  };

  const mergeManagedArtifact = (runId: string, artifact: AltusArtifactFile) => {
    const normalizedRunId = runId.trim();
    const normalizedPath = artifact.path.trim().replace(/\\/g, "/");
    if (!normalizedRunId || !normalizedPath) return;
    const existing = managedArtifactsByRun.get(normalizedRunId) || [];
    if (existing.some((item) => item.path === normalizedPath)) return;
    managedArtifactsByRun.set(normalizedRunId, [
      ...existing,
      {
        path: normalizedPath,
        previewType: inferManagedArtifactPreviewType(normalizedPath),
      },
    ]);
  };

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.type !== "executor_event") continue;
    const metadata = toRecord(message.metadata);
    const event = toRecord(metadata.event);
    const item = toRecord(event.item);
    const eventType = asText(metadata.eventType).toLowerCase();
    const itemType =
      asText(metadata.itemType).toLowerCase() ||
      asText(item.type).toLowerCase();
    const turnId = asText(metadata.turnId);

    if (eventType === "turn/diff/updated" && turnId) {
      lastCodexDiffIndexByTurn.set(turnId, index);
    }

    if (itemType === "file_change" || itemType === "filechange") {
      const fileChanges = extractCodexFileChanges(metadata, item);
      for (const change of fileChanges) {
        if (turnId && change.path) {
          mergeCodexTurnFilePath(turnId, change.path);
        }
      }
      const filePaths = Array.isArray(metadata.filePaths)
        ? metadata.filePaths.map((value) => asText(value)).filter(Boolean)
        : [];
      for (const path of filePaths) {
        if (turnId && path) {
          mergeCodexTurnFilePath(turnId, path);
        }
      }
    }
  }

  const pushUser = (
    text: string,
    skills?: TaskCreationPlatformSkill[],
    attachments?: UploadedTaskAttachment[],
    messageKey?: string,
  ) => {
    const normalized = normalizeForDedup(text);
    if (
      !normalized &&
      (!skills || skills.length === 0) &&
      (!attachments || attachments.length === 0)
    ) {
      return;
    }
    const last = items[items.length - 1];
    if (messageKey && last?.messageKey === messageKey) {
      return;
    }
    if (
      last?.kind === "user" &&
      normalizeForDedup(last.text) === normalized &&
      JSON.stringify(last.skills || []) === JSON.stringify(skills || []) &&
      JSON.stringify(last.attachments || []) ===
        JSON.stringify(attachments || [])
    ) {
      return;
    }
    items.push({
      kind: "user",
      text,
      skills,
      attachments,
      messageKey,
    });
  };

  const pushAgentMarkdown = (
    markdown: string,
    messageKey?: string,
    author?: string,
  ) => {
    const normalized = normalizeForDedup(markdown);
    if (!normalized) return;
    const last = items[items.length - 1];
    if (messageKey && last?.messageKey === messageKey) {
      return;
    }
    if (
      last?.kind === "agent" &&
      normalizeForDedup(last.markdown) === normalized &&
      (last.author || "") === (author || "")
    ) {
      return;
    }
    items.push({
      kind: "agent",
      markdown,
      author,
      messageKey,
    });
  };

  const pushAgentPlain = (
    text: string,
    author?: string,
    messageKey?: string,
  ) => {
    const normalized = normalizeForDedup(text);
    if (!normalized) return;
    const last = items[items.length - 1];
    if (messageKey && last?.messageKey === messageKey) {
      return;
    }
    if (
      last?.kind === "agent_plain" &&
      normalizeForDedup(last.text) === normalized &&
      (last.author || "OpenCode") === (author || "OpenCode")
    ) {
      return;
    }
    items.push({
      kind: "agent_plain",
      text,
      author,
      messageKey,
    });
  };

  const extractCodexExplanationHeading = (markdown: string) => {
    const headingFromMarkdown = extractThinkingHeading(markdown);
    if (headingFromMarkdown) return headingFromMarkdown;
    const strongHeading = markdown.match(/^\s*\*\*([^*\n]+)\*\*/m);
    if (strongHeading?.[1]) {
      const value = cleanHeadingText(strongHeading[1]);
      if (value) return value;
    }
    const firstLine = markdown
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => cleanHeadingText(line))
      .find(Boolean);
    return firstLine || i18n.t("homeWorkspace.thinking");
  };

  const extractCodexPlanCollapsedMarkdown = (markdown: string) => {
    const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
    const todoLines = lines
      .map((line) => line.trimEnd())
      .filter((line) => /^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line));
    if (todoLines.length === 0) return undefined;
    return todoLines.join("\n");
  };

  const pushCodexExplanation = (
    markdown: string,
    messageKey?: string,
    author?: string,
    options?: {
      collapsedMarkdown?: string;
    },
  ) => {
    const normalized = normalizeForDedup(markdown);
    if (!normalized) return;
    const heading = extractCodexExplanationHeading(markdown);
    const last = items[items.length - 1];
    if (messageKey && last?.messageKey === messageKey) {
      return;
    }
    if (
      last?.kind === "agent_explanation" &&
      normalizeForDedup(last.markdown) === normalized &&
      (last.author || "") === (author || "")
    ) {
      return;
    }
    items.push({
      kind: "agent_explanation",
      markdown,
      heading,
      collapsedMarkdown: options?.collapsedMarkdown,
      author,
      messageKey,
      active: false,
    });
  };

  const getDiffSignature = (
    payload: ReturnType<typeof extractDiffPayload>,
  ): string | null => {
    if (payload.kind === "structured") {
      if (payload.files.length === 0) return null;
      try {
        return `structured:${JSON.stringify(payload.files)}`;
      } catch {
        return `structured:${payload.files.map((file) => file.file).join("|")}`;
      }
    }
    if (payload.kind === "text") {
      const trimmed = payload.text.trim();
      return trimmed ? `text:${trimmed}` : null;
    }
    return null;
  };

  const flushProgress = () => {
    if (!progressBuffer) return;
    items.push({
      kind: "capsule",
      label: progressBuffer.label,
      tone: progressBuffer.tone,
      loading: progressBuffer.loading,
      messageKey: progressBuffer.messageKey,
    });
    progressBuffer = null;
  };

  const flushManagedStatus = (options?: {
    displayInTimeline?: boolean;
    skipHidden?: boolean;
  }) => {
    if (!managedStatusBuffer) return;
    const displayInTimeline =
      options?.displayInTimeline ?? managedStatusBuffer.displayInTimeline;
    if (options?.skipHidden && !displayInTimeline) {
      managedStatusBuffer = null;
      return;
    }
    items.push({
      kind: "managed_status",
      text: managedStatusBuffer.text,
      messageKey: managedStatusBuffer.messageKey,
      displayInTimeline,
    });
    managedStatusBuffer = null;
  };

  const clearManagedStatus = () => {
    managedStatusBuffer = null;
  };

  const replaceManagedStatus = (
    text: string,
    messageKey?: string,
    options?: { displayInTimeline?: boolean },
  ) => {
    const normalized = normalizeForDedup(text);
    if (!normalized) return;
    managedStatusBuffer = {
      text,
      messageKey,
      displayInTimeline: options?.displayInTimeline ?? true,
    };
  };

  const pushProgress = (
    rawLabel: string,
    displayLabel: string,
    tone: CapsuleTone,
    messageKey?: string,
  ) => {
    progressBuffer = {
      label: displayLabel,
      tone,
      loading: isProgressLoadingLabel(rawLabel),
      messageKey,
    };
  };

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.type === "user_input" || message.type === "user_response") {
      if (isHiddenMcpConfirmationUserMessage(message)) {
        continue;
      }
      clearManagedStatus();
      flushProgress();
      const resolvedUser = resolveUserMessageReferences({
        content: message.content || "",
        metadata: message.metadata,
      });
      pushUser(
        resolvedUser.text,
        resolvedUser.skills,
        resolvedUser.attachments,
        message.messageKey,
      );
      continue;
    }

    if (message.type === "agent_message") {
      const managedCompletionCard = buildManagedCompletionCardItem({
        message,
        managedArtifactsByRun,
        emittedManagedCompletionRuns,
      });
      if (managedCompletionCard) {
        clearManagedStatus();
        flushProgress();
        items.push(managedCompletionCard);
      }

      const parsed = extractCapsule(message.content || "");
      if (parsed) {
        if (isProgressStatusLabel(parsed.label) && !parsed.rest.trim()) {
          clearManagedStatus();
          pushProgress(
            parsed.label,
            parsed.label,
            getCapsuleTone(parsed.label),
            message.messageKey,
          );
          continue;
        }
        clearManagedStatus();
        flushProgress();
        items.push({
          kind: "capsule",
          label: parsed.label,
          tone: getCapsuleTone(parsed.label),
          messageKey: message.messageKey,
        });
        if (parsed.rest.trim()) {
          const displayName = resolveAgentDisplayName({
            agent: message.agent,
            metadata: message.metadata,
            messageKey: message.messageKey,
          });
          pushAgentMarkdown(
            displayName === "Altus"
              ? parsed.rest
              : `**${displayName}**\n\n${parsed.rest}`,
            message.messageKey,
            displayName === "Altus" ? displayName : undefined,
          );
        }
        continue;
      }

      flushProgress();
      clearManagedStatus();
      const displayName = resolveAgentDisplayName({
        agent: message.agent,
        metadata: message.metadata,
        messageKey: message.messageKey,
      });
      pushAgentMarkdown(
        displayName === "Altus"
          ? message.content || ""
          : `**${displayName}**\n\n${message.content || ""}`,
        message.messageKey,
        displayName === "Altus" ? displayName : undefined,
      );
      continue;
    }

    if (message.type === "status_update") {
      const metadata = toRecord(message.metadata);
      const managedCompletionCard = buildManagedCompletionCardItem({
        message,
        managedArtifactsByRun,
        emittedManagedCompletionRuns,
      });
      if (managedCompletionCard) {
        clearManagedStatus();
        flushProgress();
        items.push(managedCompletionCard);
      }
      const rawLabel = message.content || "状态更新";
      if (isCodexControlStatusLabel(rawLabel)) {
        continue;
      }

      if (isManagedStartingStatusMessage(message)) {
        flushProgress();
        replaceManagedStatus(rawLabel, message.messageKey, {
          displayInTimeline: false,
        });
        continue;
      }

      if (isManagedNarrationStatusMessage(message)) {
        flushProgress();
        replaceManagedStatus(rawLabel, message.messageKey);
        continue;
      }
      const tone = message.tone || getCapsuleTone(rawLabel);
      if (isProgressStatusLabel(rawLabel)) {
        clearManagedStatus();
        pushProgress(rawLabel, rawLabel, tone, message.messageKey);
      } else {
        clearManagedStatus();
        flushProgress();
        items.push({
          kind: "capsule",
          label: rawLabel,
          tone,
          messageKey: message.messageKey,
        });
      }
      continue;
    }

    if (message.type === "executor_event") {
      const metadata = toRecord(message.metadata);
      if (isManagedExecutionEvent(metadata)) {
        const managedEventType = asText(metadata.eventType).toLowerCase();
        const managedToolName = asText(metadata.toolName) || "tool";
        const managedRunId = asText(metadata.runId);
        const managedToolCallId =
          asText(metadata.toolCallId) ||
          message.messageKey ||
          `${managedRunId}:${managedToolName}:${index}`;
        const artifactPath = extractManagedArtifactPath(
          managedToolName,
          metadata,
        );
        if (
          managedEventType === "tool_call_completed" &&
          managedRunId &&
          artifactPath
        ) {
          mergeManagedArtifact(managedRunId, {
            path: artifactPath,
            previewType: inferManagedArtifactPreviewType(artifactPath),
          });
        }
        if (
          managedEventType === "tool_call_started" ||
          managedEventType === "tool_call_progress" ||
          managedEventType === "tool_call_completed" ||
          managedEventType === "tool_call_failed"
        ) {
          flushManagedStatus({ skipHidden: true });
          flushProgress();
          items.push({
            kind: "managed_tool",
            runId: managedRunId,
            toolCallId: managedToolCallId,
            eventType: managedEventType,
            toolName: managedToolName,
            status:
              managedEventType === "tool_call_failed"
                ? "failed"
                : managedEventType === "tool_call_completed"
                  ? "completed"
                  : "running",
            summary: formatManagedToolSummary(managedToolName, metadata),
            detail: formatManagedToolDetail(managedToolName, metadata),
            artifactPaths: collectManagedReplayArtifactPaths(
              managedToolName,
              metadata,
            ),
            metadata,
            messageKey: message.messageKey,
          });
          continue;
        }
        if (managedEventType === "artifact_updated") {
          clearManagedStatus();
          flushProgress();
          items.push({
            kind: "capsule",
            label:
              asText(metadata.content) ||
              i18n.t("homeWorkspace.artifactUpdated"),
            tone: "review",
            messageKey: message.messageKey,
          });
          continue;
        }
      }
      const event = toRecord(metadata.event);
      const item = toRecord(event.item);
      const executorLabel = getExecutorDisplayName(metadata);
      const eventType = asText(metadata.eventType).toLowerCase();
      const itemType =
        asText(metadata.itemType).toLowerCase() ||
        asText(item.type).toLowerCase();
      const turnId = asText(metadata.turnId);
      const content =
        asText(item.text) ||
        asText(item.content) ||
        asText(item.message) ||
        (message.content || "").trim();

      if (eventType === "turn.started") {
        clearManagedStatus();
        const progressLabel = `${executorLabel} ${i18n.t("homeWorkspace.executionStarted")}`;
        pushProgress(
          progressLabel,
          progressLabel,
          "execution",
          message.messageKey,
        );
        continue;
      }

      if (eventType === "turn.completed") {
        const turnStatus = asText(metadata.turnStatus).toLowerCase();
        const errorMessage = asText(metadata.errorMessage) || content;
        if (message.stage === "failed" || turnStatus === "failed") {
          clearManagedStatus();
          flushProgress();
          items.push({
            kind: "capsule",
            label:
              errorMessage ||
              `${executorLabel} ${i18n.t("homeWorkspace.executionFailed")}`,
            tone: "error",
            messageKey: message.messageKey,
          });
          continue;
        }
        clearManagedStatus();
        flushProgress();
        items.push({
          kind: "capsule",
          label: `${executorLabel} ${i18n.t("homeWorkspace.executionCompleted")}`,
          tone: "execution",
          messageKey: message.messageKey,
        });
        continue;
      }

      if (eventType === "turn.failed" || eventType === "turn.interrupted") {
        clearManagedStatus();
        flushProgress();
        items.push({
          kind: "capsule",
          label:
            content ||
            (eventType === "turn.interrupted"
              ? `${executorLabel} ${i18n.t("homeWorkspace.executionInterrupted")}`
              : `${executorLabel} ${i18n.t("homeWorkspace.executionFailed")}`),
          tone: "error",
          messageKey: message.messageKey,
        });
        continue;
      }

      if (eventType === "turn/plan/updated") {
        if (!content) {
          continue;
        }
        clearManagedStatus();
        pushCodexExplanation(content, message.messageKey, executorLabel, {
          collapsedMarkdown: extractCodexPlanCollapsedMarkdown(content),
        });
        continue;
      }

      if (eventType === "stderr.line" || eventType === "stdout.line") {
        continue;
      }

      if (eventType === "item/filechange/outputdelta") {
        continue;
      }

      flushProgress();
      clearManagedStatus();
      if (itemType === "command_execution" || itemType === "commandexecution") {
        const commandText =
          asText(metadata.command) ||
          asText(item.command) ||
          i18n.t("homeWorkspace.shellCommand");
        const commandCard = getCodexCommandCardCopy(commandText);
        const targetPath =
          asText(metadata.targetPath) ||
          extractCodexCommandTargetPath(commandText);
        const outputPreview =
          asText(metadata.outputPreview) || asText(item.aggregated_output);
        const exitCodeValue =
          metadata.exitCode ?? item.exit_code ?? item.exitCode;
        const exitCode =
          typeof exitCodeValue === "number" && Number.isFinite(exitCodeValue)
            ? exitCodeValue
            : typeof exitCodeValue === "string" && exitCodeValue.trim()
              ? Number(exitCodeValue)
              : null;
        const statusText =
          asText(metadata.itemStatus) ||
          asText(item.status) ||
          (exitCode === 0 ? "completed" : exitCode !== null ? "failed" : "");

        items.push({
          kind: "opencode_tool",
          eventType: "command.executed",
          event: {
            type: "command.executed",
            properties: {
              command: commandText,
              stdout: outputPreview,
              status: statusText,
              commandCategory: commandCard.category,
              targetPath: targetPath || undefined,
              ...(exitCode !== null && Number.isFinite(exitCode)
                ? { exitCode: String(exitCode) }
                : {}),
            },
          },
          content: outputPreview,
          metadata: {
            ...metadata,
            eventType: "command.executed",
            event: {
              type: "command.executed",
              properties: {
                command: commandText,
                stdout: outputPreview,
                status: statusText,
                commandCategory: commandCard.category,
                targetPath: targetPath || undefined,
                ...(exitCode !== null && Number.isFinite(exitCode)
                  ? { exitCode: String(exitCode) }
                  : {}),
              },
            },
            compactOutput: true,
            toolName: "bash",
            commandCategory: commandCard.category,
            targetPath: targetPath || undefined,
          },
          messageIndex: index,
          messageKey: message.messageKey,
        });
        continue;
      }

      if (eventType === "turn/diff/updated") {
        if (turnId && lastCodexDiffIndexByTurn.get(turnId) !== index) {
          continue;
        }
        const fileChanges = extractCodexFileChanges(metadata, item);
        const filePaths = Array.isArray(metadata.filePaths)
          ? metadata.filePaths.map((value) => asText(value)).filter(Boolean)
          : [];
        const turnPaths = turnId ? codexTurnFilePaths.get(turnId) || [] : [];
        const effectivePaths = filePaths.length > 0 ? filePaths : turnPaths;
        const effectiveFiles =
          fileChanges.length > 0
            ? fileChanges
            : effectivePaths.map((path) => ({ kind: "update", path }));
        const primaryPath = fileChanges[0]?.path || effectivePaths[0] || "";
        const fileCount = Math.max(fileChanges.length, effectivePaths.length);

        items.push({
          kind: "opencode_tool",
          eventType: "file.changed",
          event: {
            type: "file.changed",
            properties: {
              file: primaryPath,
              path: primaryPath,
              label: i18n.t("homeWorkspace.changeDiff"),
              files: effectiveFiles,
              diff: asText(metadata.diff) || undefined,
              status: "completed",
            },
          },
          content:
            fileCount > 1
              ? `${i18n.t("homeWorkspace.changeDiff")} · ${fileCount} ${i18n.t("homeWorkspace.filesUnit")}`
              : primaryPath
                ? `${i18n.t("homeWorkspace.changeDiff")} · ${getFilename(primaryPath)}`
                : i18n.t("homeWorkspace.changeDiff"),
          metadata: {
            ...metadata,
            eventType: "file.changed",
            event: {
              type: "file.changed",
              properties: {
                file: primaryPath,
                path: primaryPath,
                label: i18n.t("homeWorkspace.changeDiff"),
                files: effectiveFiles,
                diff: asText(metadata.diff) || undefined,
                status: "completed",
              },
            },
          },
          messageIndex: index,
          messageKey: message.messageKey,
        });
        continue;
      }

      if (itemType === "file_change" || itemType === "filechange") {
        const fileChanges = extractCodexFileChanges(metadata, item);
        if (fileChanges.length === 0) {
          continue;
        }
        const primary = fileChanges[0];
        const primaryPath = primary?.path || "";
        const primaryLabel = mapCodexFileChangeLabel(primary?.kind || "");
        const contentLabel =
          fileChanges.length > 1
            ? `${primaryLabel} · ${fileChanges.length} ${i18n.t("homeWorkspace.filesUnit")}`
            : `${primaryLabel} · ${getFilename(primaryPath) || i18n.t("homeWorkspace.file")}`;

        items.push({
          kind: "opencode_tool",
          eventType: "file.changed",
          event: {
            type: "file.changed",
            properties: {
              file: primaryPath,
              path: primaryPath,
              label: primaryLabel,
              files: fileChanges,
              status:
                asText(metadata.itemStatus) ||
                asText(item.status) ||
                "completed",
            },
          },
          content: contentLabel,
          metadata: {
            ...metadata,
            eventType: "file.changed",
            event: {
              type: "file.changed",
              properties: {
                file: primaryPath,
                path: primaryPath,
                label: primaryLabel,
                files: fileChanges,
                status:
                  asText(metadata.itemStatus) ||
                  asText(item.status) ||
                  "completed",
              },
            },
          },
          messageIndex: index,
          messageKey: message.messageKey,
        });
        continue;
      }

      if (itemType === "approval_request" || itemType === "approvalrequest") {
        const approvalText =
          asText(metadata.approvalText) ||
          content ||
          `${executorLabel} ${i18n.t("homeWorkspace.authorizationNeededMessage")}`;
        items.push({
          kind: "capsule",
          label: i18n.t("homeWorkspace.authorizationNeeded"),
          tone: "system",
          messageKey: message.messageKey,
        });
        pushAgentMarkdown(approvalText, message.messageKey, executorLabel);
        continue;
      }

      if (itemType === "diff") {
        const fileChanges = extractCodexFileChanges(metadata, item);
        if (fileChanges.length > 0) {
          const primary = fileChanges[0];
          items.push({
            kind: "opencode_tool",
            eventType: "file.changed",
            event: {
              type: "file.changed",
              properties: {
                file: primary?.path || "",
                path: primary?.path || "",
                label: i18n.t("homeWorkspace.changeDraft"),
                files: fileChanges,
                status:
                  asText(metadata.itemStatus) ||
                  asText(item.status) ||
                  "completed",
              },
            },
            content: primary?.path
              ? `${i18n.t("homeWorkspace.changeDraft")} · ${getFilename(primary.path)}`
              : i18n.t("homeWorkspace.changeDraft"),
            metadata: {
              ...metadata,
              eventType: "file.changed",
              event: {
                type: "file.changed",
                properties: {
                  file: primary?.path || "",
                  path: primary?.path || "",
                  label: i18n.t("homeWorkspace.changeDraft"),
                  files: fileChanges,
                  status:
                    asText(metadata.itemStatus) ||
                    asText(item.status) ||
                    "completed",
                },
              },
            },
            messageIndex: index,
            messageKey: message.messageKey,
          });
          continue;
        }
      }

      if (!content) {
        continue;
      }

      if (
        itemType === "reasoning" ||
        itemType === "agent_message" ||
        itemType === "agentmessage" ||
        isLikelyMarkdownText(content)
      ) {
        if (itemType === "reasoning") {
          pushCodexExplanation(content, message.messageKey, executorLabel);
        } else {
          pushAgentMarkdown(content, message.messageKey, executorLabel);
        }
      } else {
        pushAgentPlain(content, executorLabel, message.messageKey);
      }
      continue;
    }

    if (message.type === "opencode_event") {
      flushProgress();
      clearManagedStatus();
      const metadata = toRecord(message.metadata);
      const eventInfo = getOpencodeEventInfo(metadata);
      const content = (message.content || "").trim();
      const normalizedContent = normalizeForDedup(content);
      const partId = getPartIdFromMetadata(metadata);
      const isDiffEvent = eventInfo.toolName.toLowerCase() === "apply_patch";
      let diffId: string | undefined;
      if (isDiffEvent) {
        const payload = extractDiffPayload(metadata);
        const signature = getDiffSignature(payload);
        if (!signature || seenDiffs.has(signature)) {
          continue;
        }
        seenDiffs.add(signature);
      }
      if (eventInfo.eventType === "message.final") {
        if (!normalizedContent) {
          continue;
        }
        if (userTextSet.has(normalizedContent)) {
          continue;
        }
        if (seenFinalMessages.has(normalizedContent)) {
          continue;
        }
        seenFinalMessages.add(normalizedContent);
        if (content) {
          pushAgentMarkdown(`**OpenCode**\n\n${content}`, message.messageKey);
        }
      } else if (eventInfo.partType === "text") {
        if (partId && finalizedPartIds.has(partId)) {
          continue;
        }
        if (normalizedContent && userTextSet.has(normalizedContent)) {
          continue;
        }
        if (content) {
          pushAgentPlain(content, "OpenCode", message.messageKey);
        }
      } else if (eventInfo.partType === "tool") {
        const toolName = eventInfo.toolName.toLowerCase();
        if (toolName && toolName !== "todoread") {
          items.push({
            kind: "opencode_tool",
            eventType: eventInfo.eventType,
            event: eventInfo.event,
            content: message.content || "",
            metadata,
            messageIndex: index,
            diffId,
            messageKey: message.messageKey,
          });
        }
      } else if (
        eventInfo.eventType.startsWith("file.") ||
        eventInfo.eventType.startsWith("pty.") ||
        eventInfo.eventType === "command.executed"
      ) {
        items.push({
          kind: "opencode_tool",
          eventType: eventInfo.eventType,
          event: eventInfo.event,
          content: message.content || "",
          metadata,
          messageIndex: index,
          diffId,
          messageKey: message.messageKey,
        });
      } else if (content.startsWith("[Tool]")) {
        items.push({
          kind: "opencode_tool",
          eventType: eventInfo.eventType,
          event: eventInfo.event,
          content: message.content || "",
          metadata,
          messageIndex: index,
          diffId,
          messageKey: message.messageKey,
        });
      }
      continue;
    }

    if (message.type === "error") {
      clearManagedStatus();
      flushProgress();
      pushAgentMarkdown(
        `**${i18n.t("homeWorkspace.errorTitle")}**\n\n> ${message.message || i18n.t("homeWorkspace.requestFailedRetry")}`,
        message.messageKey,
      );
      continue;
    }

    if (message.type === "clarification_request") {
      clearManagedStatus();
      flushProgress();
      const question =
        message.question || i18n.t("homeWorkspace.provideMoreInfo");
      const previousMessage = index > 0 ? messages[index - 1] : null;
      const previousContent =
        previousMessage?.type === "agent_message"
          ? previousMessage.content || ""
          : "";
      const currentNormalized = normalizeClarificationComparableText(question);
      const previousNormalized =
        previousMessage?.type === "agent_message"
          ? normalizeClarificationComparableText(previousContent)
          : "";
      const currentSemantic = buildClarificationSemanticKey(question);
      const previousSemantic =
        previousMessage?.type === "agent_message"
          ? buildClarificationSemanticKey(previousContent)
          : "";
      const currentRunId = asText(toRecord(message.metadata).runId);
      const previousRunId =
        previousMessage?.type === "agent_message"
          ? asText(toRecord(previousMessage.metadata).runId)
          : "";
      const isSameRun =
        !currentRunId || !previousRunId || currentRunId === previousRunId;
      if (
        previousMessage?.type === "agent_message" &&
        isSameRun &&
        (currentNormalized === previousNormalized ||
          (!!currentSemantic &&
            !!previousSemantic &&
            currentSemantic === previousSemantic))
      ) {
        items.push({
          kind: "clarification_notice",
          text: i18n.t("homeWorkspace.altusContinueAfterReply"),
          messageKey: message.messageKey,
        });
        continue;
      }
      const optionLines =
        message.options && message.options.length > 0
          ? `\n\n${message.options.map((opt) => `- ${opt}`).join("\n")}`
          : "";
      pushAgentMarkdown(
        `**${i18n.t("homeWorkspace.clarificationNeeded")}**\n\n${question}${optionLines}`,
        message.messageKey,
      );
      continue;
    }

    if (message.type === "plan_generated") {
      clearManagedStatus();
      flushProgress();
      pushAgentMarkdown(
        `**${i18n.t("homeWorkspace.planGenerated")}**\n\n${i18n.t("homeWorkspace.projectLabel")}：${message.plan?.project?.title || i18n.t("homeWorkspace.unnamedProject")}`,
        message.messageKey,
      );
    }
  }

  flushManagedStatus({ displayInTimeline: false });

  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!item || item.kind === "user") {
      continue;
    }
    if (item.kind === "agent_explanation") {
      item.active = true;
    }
    break;
  }

  flushProgress();
  return items;
}

function isAuthorNeutralSeparator(item: ChatItem): boolean {
  return (
    item.kind === "capsule" ||
    item.kind === "managed_status" ||
    item.kind === "managed_tool" ||
    item.kind === "managed_activity_group" ||
    item.kind === "managed_artifact_card" ||
    item.kind === "managed_deliverable_card"
  );
}

export function getActiveManagedStatusText(items: ChatItem[]): string {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.kind === "managed_status") {
      return item.text;
    }
  }
  return "";
}

type ManagedActivityTimelineItem = Extract<
  ChatItem,
  { kind: "managed_status" | "managed_tool" }
>;

function isManagedActivityTimelineItem(
  item: ChatItem,
): item is ManagedActivityTimelineItem {
  return item.kind === "managed_status" || item.kind === "managed_tool";
}

function getManagedActivityTitle(
  items: ManagedActivityTimelineItem[],
) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!item) continue;
    if (item.kind === "managed_status" && item.text.trim()) return item.text;
    if (item.kind === "managed_tool" && item.toolName !== "complete_task") {
      return (
        getManagedToolPurposeSummary(item.toolName, item.metadata) ||
        item.summary?.trim() ||
        getManagedToolDisplayName(item.toolName) ||
        i18n.t("homeWorkspace.toolCall")
      );
    }
  }
  return i18n.t("homeWorkspace.agentProcessing");
}

function getManagedActivityState(
  items: ManagedActivityTimelineItem[],
) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.kind !== "managed_tool") continue;
    if (item.status === "failed") return "failed";
    if (item.status === "running") return "running";
    if (item.status === "completed") return "completed";
  }
  return "completed";
}

function hasManagedTodoActivity(items: ManagedActivityTimelineItem[]) {
  return items.some(
    (item) => item.kind === "managed_tool" && item.toolName === "todowrite",
  );
}

function normalizeManagedStageTitle(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function getManagedTodoStageTitle(item: ManagedActivityTimelineItem) {
  if (item.kind !== "managed_tool" || item.toolName !== "todowrite") {
    return "";
  }
  const activeTodo = readManagedTodoItems(item.metadata).find(
    (todo) => todo.status === "in_progress",
  );
  return activeTodo
    ? normalizeManagedStageTitle(activeTodo.activeForm || activeTodo.content)
    : "";
}

export function groupManagedActivityItems(items: ChatItem[]): ChatItem[] {
  const grouped: ChatItem[] = [];
  let buffer: ManagedActivityTimelineItem[] = [];
  let bufferTitle = "";

  const flush = () => {
    if (buffer.length === 0) return;
    const groupItems = buffer;
    grouped.push({
      kind: "managed_activity_group",
      title: bufferTitle || getManagedActivityTitle(groupItems),
      messageKey: groupItems.map((item) => item.messageKey).filter(Boolean).join("|"),
      defaultExpanded: !hasManagedTodoActivity(groupItems),
      items: groupItems,
    });
    buffer = [];
    bufferTitle = "";
  };

  for (const item of items) {
    if (isManagedActivityTimelineItem(item)) {
      const todoStageTitle = getManagedTodoStageTitle(item);
      if (todoStageTitle) {
        const isSameStage =
          bufferTitle &&
          normalizeManagedStageTitle(bufferTitle) ===
            normalizeManagedStageTitle(todoStageTitle);
        if (!isSameStage) {
          flush();
          bufferTitle = todoStageTitle;
        }
      }
      buffer.push(item);
      continue;
    }
    flush();
    grouped.push(item);
  }
  flush();

  let latestTodoGroupIndex = -1;
  let latestTodoHasInProgress = false;
  grouped.forEach((item, index) => {
    if (item.kind !== "managed_activity_group") return;
    for (const entry of item.items) {
      if (entry.kind !== "managed_tool" || entry.toolName !== "todowrite") {
        continue;
      }
      latestTodoGroupIndex = index;
      latestTodoHasInProgress = readManagedTodoItems(entry.metadata).some(
        (todo) => todo.status === "in_progress",
      );
    }
  });

  if (latestTodoGroupIndex >= 0) {
    grouped.forEach((item, index) => {
      if (
        item.kind === "managed_activity_group" &&
        hasManagedTodoActivity(item.items)
      ) {
        item.defaultExpanded =
          latestTodoHasInProgress && index === latestTodoGroupIndex;
      }
    });
  }

  return grouped;
}

export function collapseRepeatedChatAuthors(items: ChatItem[]): ChatItem[] {
  const nextItems = [...items];
  let previousAuthor = "";

  for (let index = 0; index < nextItems.length; index += 1) {
    const item = nextItems[index];
    if (!item) continue;

    if (
      item.kind === "agent" ||
      item.kind === "agent_plain" ||
      item.kind === "agent_explanation"
    ) {
      const author = (item.author || "").trim();
      if (!author) {
        previousAuthor = "";
        continue;
      }
      item.showAuthor = author !== previousAuthor;
      previousAuthor = author;
      continue;
    }

    if (isAuthorNeutralSeparator(item)) {
      continue;
    }

    previousAuthor = "";
  }

  return nextItems;
}

type DirectTurnDraft = {
  userText: string;
  skills?: TaskCreationPlatformSkill[];
  attachments?: UploadedTaskAttachment[];
  userMessageKey?: string;
  assistantParts: OpencodeTurnPart[];
  assistantPartIndex: Map<string, number>;
  assistantMessageIds: Set<string>;
  working: boolean;
  thinkingLabel?: string;
  messageKey?: string;
};

function cleanHeadingText(value: string) {
  return value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1")
    .replace(/[*_~]+/g, "")
    .trim();
}

function extractThinkingHeading(text: string) {
  const markdown = text.replace(/\r\n?/g, "\n");

  const html = markdown.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i);
  if (html?.[1]) {
    const value = cleanHeadingText(html[1].replace(/<[^>]+>/g, " "));
    if (value) return value;
  }

  const atx = markdown.match(/^\s{0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+[ \t]*)?$/m);
  if (atx?.[1]) {
    const value = cleanHeadingText(atx[1]);
    if (value) return value;
  }

  const setext = markdown.match(/^([^\n]+)\n(?:=+|-+)\s*$/m);
  if (setext?.[1]) {
    const value = cleanHeadingText(setext[1]);
    if (value) return value;
  }

  return "";
}

function isStructuralDirectOpencodeEvent(metadata: Record<string, unknown>) {
  const eventType = asText(metadata.eventType).toLowerCase();
  return (
    eventType === "message.updated" ||
    eventType === "message.part.updated" ||
    eventType === "message.part.delta" ||
    eventType === "message.part.removed" ||
    eventType === "message.final" ||
    eventType === "session.status" ||
    eventType === "session.idle"
  );
}

function resolveOpencodeEventMessageId(metadata: Record<string, unknown>) {
  const explicit = asText(metadata.messageId);
  if (explicit) return explicit;
  const eventInfo = getOpencodeEventInfo(metadata);
  const message = toRecord(eventInfo.properties.message);
  const info = toRecord(eventInfo.properties.info);
  return (
    asText(message.id) ||
    asText(message.messageID) ||
    asText(info.id) ||
    asText(info.messageID)
  );
}

function createDirectTurnDraft(
  userText = "",
  skills?: TaskCreationPlatformSkill[],
  attachments?: UploadedTaskAttachment[],
  userMessageKey?: string,
): DirectTurnDraft {
  return {
    userText,
    skills,
    attachments,
    userMessageKey,
    assistantParts: [],
    assistantPartIndex: new Map<string, number>(),
    assistantMessageIds: new Set<string>(),
    working: false,
    messageKey: userMessageKey,
  };
}

function normalizeDirectText(value: string) {
  return value.replace(/\r\n/g, "\n").trim();
}

function countDirectMarkdownLines(value: string) {
  const normalized = value.replace(/\r\n?/g, "\n");
  if (!normalized.trim()) return 0;
  return normalized.split("\n").length;
}

function isLongDirectMarkdown(value: string) {
  const normalized = value.trim();
  if (!normalized) return false;
  return countDirectMarkdownLines(normalized) >= 14 || normalized.length >= 600;
}

function buildDirectMarkdownFoldSummary(
  label: string,
  markdown: string,
  lineCountOverride?: number,
) {
  const lineCount = lineCountOverride ?? countDirectMarkdownLines(markdown);
  return {
    kind: "foldable" as const,
    markdown,
    lineCount,
    summary: `${label} · ${lineCount} ${i18n.t("homeWorkspace.linesUnit")}`,
  };
}

function buildFencedCodeFoldSegment(
  fullMatch: string,
  languageHint: string,
  body: string,
): DirectMarkdownSegment | null {
  if (!isLongDirectMarkdown(body)) {
    return null;
  }
  const language = languageHint.trim().toLowerCase();
  if (language === "diff" || language === "patch") {
    return buildDirectMarkdownFoldSummary(
      "Diff",
      fullMatch,
      countDirectMarkdownLines(body.trimEnd()),
    );
  }
  if (language) {
    return buildDirectMarkdownFoldSummary(
      `${language} ${i18n.t("homeWorkspace.codeLabel")}`,
      fullMatch,
      countDirectMarkdownLines(body.trimEnd()),
    );
  }
  return buildDirectMarkdownFoldSummary(
    i18n.t("homeWorkspace.codeBlock"),
    fullMatch,
    countDirectMarkdownLines(body.trimEnd()),
  );
}

function buildRawMarkdownFoldSegment(
  markdown: string,
): DirectMarkdownSegment | null {
  const trimmed = markdown.trim();
  if (!isLongDirectMarkdown(trimmed)) {
    return null;
  }
  if (
    /^\*\*\* Begin Patch/m.test(trimmed) ||
    /^diff --git\b/m.test(trimmed) ||
    (/^@@/m.test(trimmed) && /^[-+ ]/m.test(trimmed))
  ) {
    return buildDirectMarkdownFoldSummary(
      i18n.t("homeWorkspace.patchLabel"),
      trimmed,
    );
  }
  return null;
}

export function buildDirectMarkdownSegments(
  markdown: string,
): DirectMarkdownSegment[] {
  const normalized = markdown.replace(/\r\n?/g, "\n");
  if (!normalized.trim()) {
    return [];
  }

  const segments: DirectMarkdownSegment[] = [];
  const fencePattern = /```([^\n`]*)\n([\s\S]*?)```/g;
  let cursor = 0;
  let matchedFence = false;

  const pushMarkdownSegment = (value: string) => {
    if (!value.trim()) return;
    segments.push({
      kind: "markdown",
      markdown: value,
    });
  };

  let match: RegExpExecArray | null;
  while ((match = fencePattern.exec(normalized))) {
    matchedFence = true;
    const fullMatch = match[0];
    const languageHint = match[1] || "";
    const body = match[2] || "";
    const start = match.index ?? 0;
    pushMarkdownSegment(normalized.slice(cursor, start));
    const folded = buildFencedCodeFoldSegment(fullMatch, languageHint, body);
    if (folded) {
      segments.push(folded);
    } else {
      pushMarkdownSegment(fullMatch);
    }
    cursor = start + fullMatch.length;
  }

  pushMarkdownSegment(normalized.slice(cursor));

  if (!matchedFence) {
    const folded = buildRawMarkdownFoldSegment(normalized);
    if (folded) {
      return [folded];
    }
  }

  return segments;
}

function getDirectDiffSignature(
  payload: ReturnType<typeof extractDiffPayload>,
): string | null {
  if (payload.kind === "structured") {
    if (payload.files.length === 0) return null;
    try {
      return `structured:${JSON.stringify(payload.files)}`;
    } catch {
      return `structured:${payload.files.map((file) => file.file).join("|")}`;
    }
  }
  if (payload.kind === "text") {
    const trimmed = payload.text.trim();
    return trimmed ? `text:${trimmed}` : null;
  }
  return null;
}

function buildDirectOpencodeChatItems(messages: AgentMessage[]): ChatItem[] {
  const directTurns: DirectTurnDraft[] = [];
  const assistantMessageToTurn = new Map<string, number>();
  const fallbackItems: ChatItem[] = [];
  const seenDiffSignatures = new Set<string>();

  const ensureTurn = () => {
    if (directTurns.length === 0) {
      directTurns.push(createDirectTurnDraft());
    }
    return directTurns[directTurns.length - 1]!;
  };

  const ensureTurnForMessage = (messageId?: string) => {
    if (messageId) {
      const existingIndex = assistantMessageToTurn.get(messageId);
      if (existingIndex !== undefined) {
        return directTurns[existingIndex]!;
      }
    }
    const turn = ensureTurn();
    if (messageId) {
      assistantMessageToTurn.set(messageId, directTurns.length - 1);
      turn.assistantMessageIds.add(messageId);
    }
    return turn;
  };

  const upsertTurnPart = (
    turn: DirectTurnDraft,
    key: string,
    part: OpencodeTurnPart,
  ) => {
    const existingIndex = turn.assistantPartIndex.get(key);
    if (existingIndex === undefined) {
      turn.assistantPartIndex.set(key, turn.assistantParts.length);
      turn.assistantParts.push(part);
      return;
    }
    turn.assistantParts[existingIndex] = part;
  };

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];

    if (message.type === "user_input" || message.type === "user_response") {
      if (isHiddenMcpConfirmationUserMessage(message)) {
        continue;
      }
      const resolvedUser = resolveUserMessageReferences({
        content: message.content || "",
        metadata: message.metadata,
      });
      directTurns.push(
        createDirectTurnDraft(
          resolvedUser.text,
          resolvedUser.skills,
          resolvedUser.attachments,
          message.messageKey,
        ),
      );
      continue;
    }

    if (message.type === "error") {
      fallbackItems.push({
        kind: "agent",
        markdown: `**${i18n.t("homeWorkspace.errorTitle")}**\n\n> ${message.message || message.content || i18n.t("homeWorkspace.requestFailedRetry")}`,
        messageKey: message.messageKey,
      });
      continue;
    }

    if (message.type !== "opencode_event") {
      continue;
    }

    const metadata = toRecord(message.metadata);
    if (!isStructuralDirectOpencodeEvent(metadata)) {
      continue;
    }

    const eventInfo = getOpencodeEventInfo(metadata);
    const eventType = eventInfo.eventType;
    const messageId = resolveOpencodeEventMessageId(metadata);
    const content = (message.content || "").trim();
    const role =
      eventInfo.role ||
      asText(toRecord(eventInfo.properties.info).role).toLowerCase();

    if (eventType === "session.status" || eventType === "session.idle") {
      const statusValue =
        asText(toRecord(eventInfo.properties.status).type).toLowerCase() ||
        asText(eventInfo.properties.status).toLowerCase() ||
        (eventType === "session.idle" ? "idle" : "");
      if (directTurns.length > 0) {
        const currentTurn = directTurns[directTurns.length - 1]!;
        currentTurn.working = statusValue !== "idle";
      }
      continue;
    }

    if (eventType === "message.updated") {
      if (role !== "assistant") {
        continue;
      }
      const turn = ensureTurnForMessage(messageId);
      turn.messageKey = turn.messageKey || message.messageKey;
      const completedAt = asText(
        toRecord(toRecord(eventInfo.properties.info).time).completed,
      );
      if (completedAt) {
        turn.working = false;
      }
      continue;
    }

    if (role && role !== "assistant") {
      continue;
    }

    const turn = ensureTurnForMessage(messageId);
    turn.messageKey = turn.messageKey || message.messageKey;

    if (eventType === "message.final") {
      const partId =
        asText(eventInfo.part.id) || asText(metadata.partId) || "final";
      if (normalizeDirectText(content) === normalizeDirectText(turn.userText)) {
        continue;
      }
      upsertTurnPart(turn, `text:${messageId || "assistant"}:${partId}`, {
        kind: "text",
        markdown: content,
        messageKey: message.messageKey,
        partId,
      });
      turn.working = false;
      continue;
    }

    if (
      eventType !== "message.part.updated" &&
      eventType !== "message.part.delta"
    ) {
      continue;
    }

    const partId =
      asText(eventInfo.part.id) ||
      asText(metadata.partId) ||
      `${eventInfo.partType || "part"}-${index}`;
    const partType = eventInfo.partType;
    if (partType === "text") {
      if (normalizeDirectText(content) === normalizeDirectText(turn.userText)) {
        continue;
      }
      upsertTurnPart(turn, `text:${messageId || "assistant"}:${partId}`, {
        kind: "text",
        markdown: content,
        messageKey: message.messageKey,
        partId,
      });
      const end = asNumericValue(toRecord(eventInfo.part.time).end);
      if (end === null) {
        turn.working = true;
      }
      continue;
    }

    if (partType === "reasoning") {
      upsertTurnPart(turn, `reasoning:${messageId || "assistant"}:${partId}`, {
        kind: "reasoning",
        markdown: content,
        messageKey: message.messageKey,
        partId,
      });
      const heading = extractThinkingHeading(content);
      if (heading) {
        turn.thinkingLabel = heading;
      }
      const end = asNumericValue(toRecord(eventInfo.part.time).end);
      if (end === null) {
        turn.working = true;
      }
      continue;
    }

    if (partType === "tool") {
      const toolName = eventInfo.toolName.toLowerCase();
      if (toolName === "apply_patch") {
        const signature = getDirectDiffSignature(extractDiffPayload(metadata));
        if (!signature || seenDiffSignatures.has(signature)) {
          continue;
        }
        seenDiffSignatures.add(signature);
      }
      const diffId =
        message.messageKey || `${messageId || "assistant"}:${partId}`;
      upsertTurnPart(turn, `tool:${messageId || "assistant"}:${partId}`, {
        kind: "tool",
        eventType,
        event: eventInfo.event,
        content: message.content || "",
        metadata,
        messageIndex: index,
        diffId,
        messageKey: message.messageKey,
        partId,
      });
      const toolStatus = asText(
        toRecord(eventInfo.part.state).status,
      ).toLowerCase();
      if (toolStatus === "pending" || toolStatus === "running") {
        turn.working = true;
      }
    }
  }

  const items: ChatItem[] = [];
  for (const turn of directTurns) {
    const assistantParts = turn.assistantParts.filter((part) =>
      part.kind === "tool"
        ? Boolean(part.eventType)
        : part.kind === "reasoning"
          ? false
          : Boolean(part.markdown.trim()),
    );
    if (!turn.userText.trim() && assistantParts.length === 0 && !turn.working) {
      continue;
    }
    items.push({
      kind: "opencode_turn",
      userText: turn.userText,
      skills: turn.skills,
      attachments: turn.attachments,
      userMessageKey: turn.userMessageKey,
      assistantParts,
      working: turn.working,
      thinkingLabel: turn.thinkingLabel,
      messageKey: turn.messageKey || turn.userMessageKey,
    });
  }

  return items.length > 0
    ? [...fallbackItems, ...items]
    : buildLegacyChatItems(messages);
}

export function buildChatItems(messages: AgentMessage[]): ChatItem[] {
  const hasOpencodeEvents = messages.some(
    (message) => message.type === "opencode_event",
  );
  if (!hasOpencodeEvents) {
    return buildLegacyChatItems(messages);
  }
  if (messages.some((message) => isManagedTimelineMessage(message))) {
    return buildLegacyChatItems(messages);
  }
  return buildDirectOpencodeChatItems(messages);
}

function isManagedTimelineMessage(message: AgentMessage): boolean {
  const metadata = toRecord(message.metadata);
  const eventType = asText(metadata.eventType).toLowerCase();
  const messageKey = asText(message.messageKey) || asText(metadata.messageKey);
  if (isManagedExecutionEvent(metadata)) {
    return true;
  }
  if (asText(message.agent).toLowerCase() === "altus") {
    return true;
  }
  if (messageKey.startsWith("managed:")) {
    return true;
  }
  return (
    eventType === "assistant_delta" ||
    eventType === "assistant_message" ||
    eventType === "run_ack" ||
    eventType === "run_status" ||
    eventType === "deliverables_ready" ||
    eventType === "run_completed" ||
    eventType === "run_failed" ||
    eventType === "run_stopped" ||
    eventType === "clarification_requested" ||
    eventType === "tool_call_started" ||
    eventType === "tool_call_progress" ||
    eventType === "tool_call_completed" ||
    eventType === "tool_call_failed" ||
    eventType === "artifact_updated"
  );
}

function isManagedNarrationStatusMessage(message: AgentMessage): boolean {
  if (message.type !== "status_update") return false;
  const metadata = toRecord(message.metadata);
  if (!isManagedExecutionEvent(metadata)) return false;
  const eventType = asText(metadata.eventType).toLowerCase();
  const status = asText(metadata.status).toLowerCase();
  const content = asText(message.content);
  return eventType === "run_status" && status !== "starting" && Boolean(content);
}

function isManagedStartingStatusMessage(message: AgentMessage): boolean {
  if (message.type !== "status_update") return false;
  const metadata = toRecord(message.metadata);
  if (!isManagedExecutionEvent(metadata)) return false;
  return (
    asText(metadata.eventType).toLowerCase() === "run_status" &&
    asText(metadata.status).toLowerCase() === "starting"
  );
}

function DirectFoldableMarkdownBlock({
  segment,
  muted = false,
}: {
  segment: Extract<DirectMarkdownSegment, { kind: "foldable" }>;
  muted?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const bodyClassName = muted
    ? "max-w-none text-sm leading-7 text-muted-foreground [&_p]:my-2 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-border/60 [&_pre]:bg-muted/40 [&_pre]:p-3 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_strong]:font-semibold"
    : "max-w-none text-sm leading-7 text-foreground [&_p]:my-2 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-border/60 [&_pre]:bg-muted/40 [&_pre]:p-3 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_strong]:font-semibold";

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-lg border border-border/70 bg-muted/30"
    >
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-foreground/85">
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <span>{segment.summary}</span>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {open ? i18n.t("common.collapse") : i18n.t("common.expand")}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t border-border/60 px-3 py-3">
        <div className={bodyClassName}>
          <Streamdown>{segment.markdown}</Streamdown>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function DirectMarkdownMessage({
  markdown,
  muted = false,
}: {
  markdown: string;
  muted?: boolean;
}) {
  const segments = useMemo(
    () => buildDirectMarkdownSegments(markdown),
    [markdown],
  );
  const bodyClassName = muted
    ? "max-w-none text-sm leading-7 text-muted-foreground [&_p]:my-2 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-border/60 [&_pre]:bg-muted/40 [&_pre]:p-3 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_strong]:font-semibold"
    : "max-w-none text-sm leading-7 text-foreground [&_p]:my-2 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-border/60 [&_pre]:bg-muted/40 [&_pre]:p-3 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_strong]:font-semibold";

  if (segments.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {segments.map((segment, index) =>
        segment.kind === "foldable" ? (
          <DirectFoldableMarkdownBlock
            key={`foldable-${segment.summary}-${index}`}
            segment={segment}
            muted={muted}
          />
        ) : (
          <div key={`markdown-${index}`} className={bodyClassName}>
            <Streamdown>{segment.markdown}</Streamdown>
          </div>
        ),
      )}
    </div>
  );
}

function CodexExplanationMessage({
  markdown,
  heading,
  collapsedMarkdown,
  active = false,
  author = "Codex",
  showAuthor = true,
}: {
  markdown: string;
  heading: string;
  collapsedMarkdown?: string;
  active?: boolean;
  author?: string;
  showAuthor?: boolean;
}) {
  if (!active) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="w-full"
      >
        <div className="space-y-1.5 text-sm text-foreground">
          {showAuthor ? (
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              {author}
            </div>
          ) : null}
          <div className="text-sm leading-7 text-foreground">{heading}</div>
          {collapsedMarkdown ? (
            <div className="max-w-none text-sm leading-7 text-foreground [&_p]:my-1.5 [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_strong]:font-semibold">
              <Streamdown>{collapsedMarkdown}</Streamdown>
            </div>
          ) : null}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="w-full"
    >
      <div className="space-y-1.5 text-sm text-foreground">
        {showAuthor ? (
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {author}
          </div>
        ) : null}
        <div className="relative overflow-hidden rounded-xl border border-border/70 bg-[radial-gradient(circle_at_top,_rgba(148,163,184,0.12),_transparent_58%),linear-gradient(180deg,rgba(255,255,255,0.92),rgba(248,250,252,0.94))] px-4 py-3 shadow-sm dark:bg-[radial-gradient(circle_at_top,_rgba(148,163,184,0.12),_transparent_58%),linear-gradient(180deg,rgba(24,24,27,0.96),rgba(17,17,20,0.96))]">
          <div className="absolute inset-y-3 right-3 w-px animate-pulse bg-gradient-to-b from-transparent via-muted-foreground to-transparent" />
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {heading}
          </div>
          <div className="pr-4">
            <DirectMarkdownMessage markdown={markdown} />
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function MessageBubble({
  item,
  onOpenDiffPreview,
  onOpenManagedReplay,
  onOpenWorkspacePreview,
  onDeployArtifact,
  runtimeSwitchBlocked,
  currentSessionId,
  hiddenGoogleConfirmationIds,
  onApproveGoogleWorkspaceConfirmation,
  onRejectGoogleWorkspaceConfirmation,
}: {
  item: ChatItem;
  onOpenDiffPreview?: (options?: {
    diffId?: string | null;
    filePath?: string | null;
    messageKey?: string | null;
    messageIndex?: number | null;
  }) => void;
  onOpenManagedReplay?: (
    runId: string,
    options?: {
      toolCallId?: string | null;
      view?: AltusDrawerView;
    },
  ) => void;
  onOpenWorkspacePreview?: (path: string) => void;
  onDeployArtifact?: (path: string) => Promise<void> | void;
  runtimeSwitchBlocked?: boolean;
  currentSessionId?: string | null;
  hiddenGoogleConfirmationIds?: string[];
  onApproveGoogleWorkspaceConfirmation?: (
    confirmation: GoogleWorkspaceConfirmationView,
  ) => Promise<void> | void;
  onRejectGoogleWorkspaceConfirmation?: (
    confirmation: GoogleWorkspaceConfirmationView,
  ) => Promise<void> | void;
}) {
  if (item.kind === "opencode_turn") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="w-full space-y-4"
        data-message-key={item.messageKey}
      >
        <div
          className="w-full flex justify-end"
          data-message-key={item.userMessageKey}
        >
          <div className="max-w-[80%] space-y-2 rounded-md bg-slate-900 px-3 py-2 text-sm text-white">
            {item.skills?.length || item.attachments?.length ? (
              <MessageAttachmentReference
                skills={item.skills}
                attachments={item.attachments}
                tone="inverse"
              />
            ) : null}
            {item.userText ? (
              <span className="whitespace-pre-wrap break-words">
                {item.userText}
              </span>
            ) : null}
          </div>
        </div>

        <div className="space-y-3">
          {item.assistantParts.map((part, index) => {
            if (part.kind === "tool") {
              return (
                <div key={part.partId || part.messageKey || `tool-${index}`}>
                  <OpencodeToolCard
                    item={{
                      kind: "opencode_tool",
                      eventType: part.eventType,
                      event: part.event,
                      content: part.content,
                      metadata: part.metadata,
                      messageIndex: part.messageIndex,
                      diffId: part.diffId,
                      messageKey: part.messageKey,
                    }}
                    hiddenGoogleConfirmationIds={hiddenGoogleConfirmationIds}
                    onOpenDiffPreview={onOpenDiffPreview}
                  />
                </div>
              );
            }

            return (
              <DirectMarkdownMessage
                key={part.partId || part.messageKey || `text-${index}`}
                markdown={part.markdown}
              />
            );
          })}

          {item.working ? (
            <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-muted/50 px-2.5 py-1 text-[11px] font-medium text-foreground/80">
              <span className="bg-gradient-to-r from-slate-500 via-slate-900 to-slate-500 bg-[length:200%_100%] animate-shimmer text-transparent bg-clip-text">
                {i18n.t("homeWorkspace.thinking")}
              </span>
              {item.thinkingLabel ? (
                <span className="text-muted-foreground">
                  {item.thinkingLabel}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </motion.div>
    );
  }

  if (item.kind === "capsule") {
    const toneClass = "border-border/70 bg-muted/50 text-foreground/80";
    const segments =
      item.segments && item.segments.length > 0 ? item.segments : [item.label];
    const lastIndex = segments.length - 1;

    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="w-full"
        data-message-key={item.messageKey}
      >
        <div
          className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${toneClass} ${
            item.loading ? "relative overflow-hidden" : ""
          }`}
        >
          <span className="relative z-10 inline-flex flex-wrap items-center gap-1">
            {segments.map((segment, index) => {
              const shimmer =
                item.loading && (segments.length === 1 || index < lastIndex)
                  ? "bg-gradient-to-r from-slate-500 via-slate-900 to-slate-500 bg-[length:200%_100%] animate-shimmer text-transparent bg-clip-text"
                  : "";
              return (
                <span key={`${segment}-${index}`} className={shimmer}>
                  {segment}
                  {index < lastIndex ? (
                    <span className="px-1 text-slate-400">·</span>
                  ) : null}
                </span>
              );
            })}
          </span>
        </div>
      </motion.div>
    );
  }

  if (item.kind === "agent_explanation") {
    return (
      <CodexExplanationMessage
        markdown={item.markdown}
        heading={item.heading}
        collapsedMarkdown={item.collapsedMarkdown}
        active={item.active}
        author={item.author}
        showAuthor={item.showAuthor}
      />
    );
  }

  if (item.kind === "clarification_notice") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="w-full"
        data-message-key={item.messageKey}
      >
        <div
          className="flex items-center gap-[6px] py-1.5 text-sm font-medium"
          style={{ color: "var(--function-warning, rgb(217 119 6))" }}
        >
          <svg
            height="16"
            width="16"
            fill="none"
            viewBox="0 0 16 16"
            aria-hidden="true"
          >
            <circle
              cx="8"
              cy="8"
              r="6.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeDasharray="2.44 1.62"
            />
          </svg>
          <span>{item.text}</span>
        </div>
      </motion.div>
    );
  }

  if (item.kind === "user") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="w-full flex justify-end"
        data-message-key={item.messageKey}
      >
        <div className="max-w-[80%] space-y-2 rounded-md bg-slate-900 px-3 py-2 text-sm text-white">
          {item.skills?.length || item.attachments?.length ? (
            <MessageAttachmentReference
              skills={item.skills}
              attachments={item.attachments}
              tone="inverse"
            />
          ) : null}
          {item.text ? (
            <span className="whitespace-pre-wrap break-words">{item.text}</span>
          ) : null}
        </div>
      </motion.div>
    );
  }

  if (item.kind === "opencode_tool") {
    return (
      <div data-message-key={item.messageKey}>
        <OpencodeToolCard
          item={item}
          currentSessionId={currentSessionId}
          hiddenGoogleConfirmationIds={hiddenGoogleConfirmationIds}
          onApproveGoogleWorkspaceConfirmation={
            onApproveGoogleWorkspaceConfirmation
          }
          onRejectGoogleWorkspaceConfirmation={
            onRejectGoogleWorkspaceConfirmation
          }
          onOpenDiffPreview={onOpenDiffPreview}
        />
      </div>
    );
  }

  if (item.kind === "managed_activity_group") {
    return (
      <div data-message-key={item.messageKey}>
        <ManagedActivityGroup
          item={item}
          currentSessionId={currentSessionId}
          hiddenGoogleConfirmationIds={hiddenGoogleConfirmationIds}
          onApproveGoogleWorkspaceConfirmation={
            onApproveGoogleWorkspaceConfirmation
          }
          onRejectGoogleWorkspaceConfirmation={
            onRejectGoogleWorkspaceConfirmation
          }
          onOpenReplay={(runId, toolCallId, toolName) =>
            onOpenManagedReplay?.(runId, {
              toolCallId,
              view: resolveManagedToolReplayView(toolName),
            })
          }
        />
      </div>
    );
  }

  if (item.kind === "managed_tool") {
    return (
      <div data-message-key={item.messageKey}>
        <ManagedToolCard
          item={item}
          currentSessionId={currentSessionId}
          hiddenGoogleConfirmationIds={hiddenGoogleConfirmationIds}
          onApproveGoogleWorkspaceConfirmation={
            onApproveGoogleWorkspaceConfirmation
          }
          onRejectGoogleWorkspaceConfirmation={
            onRejectGoogleWorkspaceConfirmation
          }
          onOpenReplay={(runId, toolCallId, toolName) =>
            onOpenManagedReplay?.(runId, {
              toolCallId,
              view: resolveManagedToolReplayView(toolName),
            })
          }
        />
      </div>
    );
  }

  if (item.kind === "managed_artifact_card") {
    return (
      <div data-message-key={item.messageKey}>
        <AltusArtifactPreviewCard
          sessionId={item.sessionId}
          runId={item.runId}
          artifacts={item.artifacts}
          previewSnapshot={item.previewSnapshot}
          onOpenViewer={onOpenWorkspacePreview}
          onDeployRequested={onDeployArtifact}
          runtimeSwitchBlocked={runtimeSwitchBlocked}
        />
      </div>
    );
  }

  if (item.kind === "managed_deliverable_card") {
    return (
      <div data-message-key={item.messageKey}>
        <TaskDeliverableCard
          sessionId={item.sessionId}
          deliverables={item.deliverables}
        />
      </div>
    );
  }

  if (item.kind === "managed_status") {
    return null;
  }

  if (item.kind === "agent_plain") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="w-full"
        data-message-key={item.messageKey}
      >
        <div className="space-y-1.5 text-sm text-foreground">
          {item.showAuthor !== false ? (
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              {item.author || "OpenCode"}
            </div>
          ) : null}
          <div className="whitespace-pre-wrap break-words leading-6">
            {item.text}
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="w-full"
      data-message-key={item.messageKey}
    >
      <div className="space-y-1.5 text-sm text-foreground">
        {item.author && item.showAuthor !== false ? (
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {item.author}
          </div>
        ) : null}
        <div className="max-w-none leading-7 text-foreground [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_strong]:font-semibold">
          <Streamdown>{item.markdown}</Streamdown>
        </div>
      </div>
    </motion.div>
  );
}

function extractCapsule(
  content: string,
): { label: string; rest: string } | null {
  const text = content.trim();
  const match = text.match(/^\{([^{}]+)\}\s*([\s\S]*)$/);
  if (match) {
    return {
      label: match[1].trim(),
      rest: (match[2] || "").trim(),
    };
  }

  // 纯状态消息，直接渲染胶囊，不再下沉为正文
  for (const definition of PROGRESS_STATUS_DEFINITIONS) {
    if (definition.patterns.some((pattern) => text.includes(pattern))) {
      return { label: text, rest: "" };
    }
  }

  // 兼容后端未加 {标签} 的阶段文本
  for (const fallback of CAPSULE_FALLBACK_LABELS) {
    if (text.startsWith(fallback.pattern)) {
      return {
        label: fallback.pattern,
        rest: text
          .slice(fallback.pattern.length)
          .replace(/^[:：\-\s]+/, "")
          .trim(),
      };
    }
  }
  return null;
}

function isProgressStatusLabel(label: string): boolean {
  const text = label.trim();
  if (!text) return false;
  if (
    text.includes("错误") ||
    text.includes("失败") ||
    text.toLowerCase().includes("failed") ||
    text.toLowerCase().includes("error")
  ) {
    return false;
  }
  return Boolean(findProgressStatusDefinition(text));
}

function isProgressLoadingLabel(label: string): boolean {
  const text = label.trim();
  if (!text) return false;
  if (
    text.includes("错误") ||
    text.includes("失败") ||
    text.toLowerCase().includes("failed") ||
    text.toLowerCase().includes("error")
  ) {
    return false;
  }
  const progressStatus = findProgressStatusDefinition(text);
  if (progressStatus) {
    return progressStatus.loading;
  }
  const completeKeywords = [
    "完成",
    "已生成",
    "已就绪",
    "已接入",
    "成功",
    "completed",
    "generated",
    "ready",
    "attached",
    "success",
  ];
  return !completeKeywords.some((keyword) =>
    text.toLowerCase().includes(keyword.toLowerCase()),
  );
}

function getCapsuleTone(label: string): CapsuleTone {
  const text = label.trim();
  const lower = text.toLowerCase();
  if (
    lower.includes("错误") ||
    lower.includes("失败") ||
    lower.includes("error") ||
    lower.includes("failed")
  ) {
    return "error";
  }
  const progressStatus = findProgressStatusDefinition(text);
  if (progressStatus) return progressStatus.tone;
  const fallbackLabel = findFallbackCapsuleLabel(text);
  if (fallbackLabel) return fallbackLabel.tone;
  if (lower.includes("analysis")) return "intent";
  if (lower.includes("develop") || lower.includes("execution"))
    return "execution";
  if (lower.includes("test")) return "review";
  if (lower.includes("plan")) return "planning";
  return "system";
}

function isCodexControlStatusLabel(label: string): boolean {
  const text = label.trim().toLowerCase();
  return (
    text === "codex 会话已建立，正在等待执行..." ||
    text === "codex 已接收输入，正在执行..."
  );
}

function isLikelyMarkdownText(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  return (
    text.includes("```") ||
    /^\s*\*\*[^*]+?\*\*/m.test(text) ||
    /`[^`]+`/.test(text) ||
    text.includes("\n\n") ||
    /^\s*#{1,6}\s+/m.test(text) ||
    /^\s*[-*+]\s+/m.test(text) ||
    /^\s*\d+\.\s+/m.test(text) ||
    /^\s*>\s+/m.test(text)
  );
}

function formatOpencodeEventLabel(eventType: string, stream: boolean): string {
  if (stream) return i18n.t("homeWorkspace.opencodeLiveOutput");
  if (!eventType) return "OpenCode";
  if (eventType === "message.final")
    return i18n.t("homeWorkspace.opencodeFinalOutput");
  if (eventType === "session.idle") return i18n.t("homeWorkspace.opencodeIdle");
  if (eventType === "session.status")
    return i18n.t("homeWorkspace.opencodeStatus");
  return `OpenCode · ${eventType}`;
}

function parseStructString(value: string): Record<string, unknown> {
  const text = value.trim();
  if (!text.startsWith("@{") || !text.endsWith("}")) {
    return {};
  }
  const body = text.slice(2, -1);
  const result: Record<string, unknown> = {};
  for (const rawPart of body.split(";")) {
    const part = rawPart.trim();
    if (!part) continue;
    const eqIndex = part.indexOf("=");
    if (eqIndex <= 0) {
      result[part] = true;
      continue;
    }
    const key = part.slice(0, eqIndex).trim();
    const val = part.slice(eqIndex + 1).trim();
    if (!key) continue;
    result[key] = val;
  }
  return result;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object")
    return value as Record<string, unknown>;
  if (typeof value === "string") {
    const parsed = parseStructString(value);
    if (Object.keys(parsed).length > 0) return parsed;
  }
  return {};
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isHiddenMcpConfirmationUserMessage(
  message: Pick<AgentMessage, "type" | "content" | "metadata"> | null | undefined,
): boolean {
  if (message?.type !== "user_response") return false;
  const metadata = toRecord(message.metadata);
  const source = asText(metadata.source);
  if (
    source === "mcp_tool_confirmation_approved" ||
    source === "mcp_tool_confirmation_rejected"
  ) {
    return true;
  }
  const content = (message.content || "").trim();
  return (
    content === "[mcp_tool_confirmation:approve]" ||
    content === "[mcp_tool_confirmation:reject]"
  );
}

function asNumericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return null;
}

type OpencodeEventInfo = {
  eventType: string;
  event: Record<string, unknown>;
  properties: Record<string, unknown>;
  part: Record<string, unknown>;
  partType: string;
  toolName: string;
  role: string;
};

function getOpencodeEventInfo(
  metadata: Record<string, unknown>,
): OpencodeEventInfo {
  const rawPayload = toRecord(metadata.rawPayload);
  const eventFromMeta = toRecord(metadata.event);
  const eventFromPayload = toRecord(rawPayload.event);
  const event =
    Object.keys(eventFromMeta).length > 0 ? eventFromMeta : eventFromPayload;
  const eventType = asText(metadata.eventType) || asText(event.type);
  const properties = toRecord(event.properties);
  const part = toRecord(properties.part);
  const message = toRecord(properties.message);
  const partType = (asText(part.type) || asText(properties.type)).toLowerCase();
  const toolName =
    asText(part.tool) || asText(part.name) || asText(properties.tool);
  return {
    eventType,
    event,
    properties,
    part,
    partType,
    toolName,
    role: (
      asText(message.role) ||
      asText(properties.role) ||
      asText(part.role)
    ).toLowerCase(),
  };
}

function stringifySafe(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? "");
  }
}

function truncateText(value: string, maxLength = 800) {
  if (!value) return { text: "", truncated: false };
  if (value.length <= maxLength) {
    return { text: value, truncated: false };
  }
  return { text: `${value.slice(0, maxLength)}…`, truncated: true };
}

function getFilename(path: string | undefined) {
  if (!path) return "";
  const parts = path.split(/[/\\]+/);
  return parts[parts.length - 1] || path;
}

function getDirectory(path: string | undefined) {
  if (!path) return "";
  const normalized = path.replace(/\\+/g, "/");
  const idx = normalized.lastIndexOf("/");
  if (idx <= 0) return normalized;
  return normalized.slice(0, idx + 1);
}

type CodexCommandCategory = "list" | "search" | "read" | "write" | "command";

function normalizeShellCommand(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) return "";
  const bashLcMatch = trimmed.match(/^(?:\/bin\/)?(?:ba)?sh\s+-lc\s+(.+)$/i);
  if (bashLcMatch?.[1]) {
    return bashLcMatch[1].trim().replace(/^['"]|['"]$/g, "");
  }
  return trimmed;
}

function inferCodexCommandCategory(command: string): CodexCommandCategory {
  const normalized = normalizeShellCommand(command).toLowerCase();
  if (!normalized) return "command";
  if (
    normalized.startsWith("ls") ||
    normalized.startsWith("tree") ||
    normalized.startsWith("find ")
  ) {
    return "list";
  }
  if (
    normalized.startsWith("rg ") ||
    normalized.startsWith("grep ") ||
    normalized.includes(" grep ") ||
    normalized.includes(" rg ")
  ) {
    return "search";
  }
  if (
    normalized.startsWith("cat ") ||
    normalized.startsWith("sed ") ||
    normalized.startsWith("head ") ||
    normalized.startsWith("tail ")
  ) {
    return "read";
  }
  if (
    normalized.includes(">") ||
    normalized.includes("tee ") ||
    normalized.includes("cat <<") ||
    normalized.startsWith("cp ") ||
    normalized.startsWith("mv ")
  ) {
    return "write";
  }
  return "command";
}

function stripShellQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function extractCodexCommandTargetPath(command: string): string {
  const normalized = normalizeShellCommand(command);
  if (!normalized) return "";

  const heredocMatch = normalized.match(/(?:^|\s)>\s*([^\n]+)/);
  if (heredocMatch?.[1]) {
    const token = stripShellQuotes(
      heredocMatch[1].trim().split(/\s+/)[0] || "",
    );
    if (token) return token;
  }

  const teeMatch = normalized.match(/\btee\s+([^\s|]+)/);
  if (teeMatch?.[1]) {
    return stripShellQuotes(teeMatch[1]);
  }

  const cpOrMvMatch = normalized.match(/^(?:cp|mv)\s+\S+\s+(\S+)/);
  if (cpOrMvMatch?.[1]) {
    return stripShellQuotes(cpOrMvMatch[1]);
  }

  return "";
}

function extractCodexWritePayloadPreview(command: string): {
  kind: "heredoc" | "command";
  text: string;
  truncated: boolean;
} | null {
  const normalized = normalizeShellCommand(command);
  if (!normalized) return null;

  const markerMatch = normalized.match(/<<['"]?([A-Za-z0-9_]+)['"]?/);
  if (!markerMatch) {
    return null;
  }
  const marker = markerMatch[1];
  const lines = normalized.split(/\r?\n/);
  if (lines.length <= 1) {
    return null;
  }
  const payloadLines: string[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = stripShellQuotes(line.trim());
    if (trimmed === marker) {
      break;
    }
    payloadLines.push(line);
  }
  const payloadText = payloadLines.join("\n").trim();
  if (!payloadText) {
    return null;
  }
  const preview = truncateText(payloadText, 2400);
  return {
    kind: "heredoc",
    text: preview.text,
    truncated: preview.truncated,
  };
}

function inferCodexWriteLabel(command: string): string {
  const normalized = normalizeShellCommand(command).toLowerCase();
  if (normalized.startsWith("mv ")) return i18n.t("homeWorkspace.moveFile");
  if (normalized.startsWith("cp ")) return i18n.t("homeWorkspace.copyFile");
  if (normalized.includes(">>")) return i18n.t("homeWorkspace.appendFile");
  if (
    normalized.includes("cat <<") ||
    normalized.includes(">") ||
    normalized.includes("tee ")
  ) {
    return i18n.t("homeWorkspace.fileEdit");
  }
  return i18n.t("homeWorkspace.fileEdit");
}

function getCodexCommandCardCopy(command: string) {
  const category = inferCodexCommandCategory(command);
  switch (category) {
    case "list":
      return {
        category,
        title: i18n.t("homeWorkspace.directoryCheck"),
        icon: FolderSearch2,
      };
    case "search":
      return { category, title: i18n.t("homeWorkspace.search"), icon: Search };
    case "read":
      return {
        category,
        title: i18n.t("homeWorkspace.fileView"),
        icon: FileSearch,
      };
    case "write":
      return {
        category,
        title: i18n.t("homeWorkspace.fileEdit"),
        icon: FilePenLine,
      };
    default:
      return {
        category,
        title: i18n.t("homeWorkspace.shellExecution"),
        icon: Terminal,
      };
  }
}

type CodexFileChange = {
  kind: string;
  path: string;
};

function extractCodexFileChanges(
  metadata: Record<string, unknown>,
  item?: Record<string, unknown>,
): CodexFileChange[] {
  const metadataChanges = Array.isArray(metadata.fileChanges)
    ? metadata.fileChanges
    : [];
  const itemChanges = Array.isArray(item?.changes) ? item.changes : [];
  const source = metadataChanges.length > 0 ? metadataChanges : itemChanges;
  return source
    .map((change) => toRecord(change))
    .map((change) => ({
      kind: asText(change.kind),
      path: asText(change.path) || asText(change.file),
    }))
    .filter((change) => change.path);
}

function mapCodexFileChangeLabel(kind: string): string {
  const normalized = kind.trim().toLowerCase();
  if (
    normalized === "add" ||
    normalized === "create" ||
    normalized === "created"
  ) {
    return i18n.t("homeWorkspace.createFile");
  }
  if (
    normalized === "delete" ||
    normalized === "deleted" ||
    normalized === "remove" ||
    normalized === "removed"
  ) {
    return i18n.t("homeWorkspace.deleteFile");
  }
  return i18n.t("homeWorkspace.updateFile");
}

function getToolInfo(tool: string, input: Record<string, unknown>) {
  const lower = tool.toLowerCase();
  switch (lower) {
    case "read":
      return {
        title: i18n.t("homeWorkspace.readAction"),
        subtitle: getFilename(asText(input.filePath)),
      };
    case "list":
      return {
        title: i18n.t("homeWorkspace.listAction"),
        subtitle: getDirectory(asText(input.path) || "/"),
      };
    case "glob":
      return {
        title: i18n.t("homeWorkspace.matchAction"),
        subtitle: asText(input.pattern),
      };
    case "grep":
      return {
        title: i18n.t("homeWorkspace.search"),
        subtitle: asText(input.pattern),
      };
    case "webfetch":
      return {
        title: i18n.t("homeWorkspace.fetchAction"),
        subtitle: asText(input.url),
      };
    case "task":
      return {
        title: i18n.t("homeWorkspace.subtaskAction"),
        subtitle: asText(input.description),
      };
    case "bash":
      return {
        title: "Shell",
        subtitle: asText(input.description) || asText(input.command),
      };
    case "edit":
      return {
        title: i18n.t("common.edit"),
        subtitle: getFilename(asText(input.filePath)),
      };
    case "write":
      return {
        title: i18n.t("homeWorkspace.writeAction"),
        subtitle: getFilename(asText(input.filePath)),
      };
    case "apply_patch":
      return {
        title: i18n.t("homeWorkspace.patchLabel"),
        subtitle: Array.isArray(input.files)
          ? `${input.files.length} ${i18n.t("homeWorkspace.file")}`
          : "",
      };
    case "todowrite":
      return { title: i18n.t("homeWorkspace.todo") };
    case "question":
      return { title: i18n.t("homeWorkspace.pendingConfirmation") };
    default:
      return { title: tool || "Tool" };
  }
}

function collectPatchTargetFilesFromText(value: string): string[] {
  if (!value.trim()) return [];
  const pattern =
    /^\*\*\* (?:Update|Add|Delete) File: (.+)$|^diff --git a\/(.+?) b\/.+$/gm;
  const files = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value))) {
    const candidate = (match[1] || match[2] || "").trim();
    if (candidate) {
      files.add(candidate);
    }
  }
  return Array.from(files);
}

function summarizeTooltipLines(lines: Array<string | null | undefined>) {
  return lines
    .map((line) => asText(line).trim())
    .filter(Boolean)
    .join("\n");
}

function buildDetailPreview(
  value: string,
  maxLines = 3,
  maxCharsPerLine = 120,
) {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(
      (line, index, arr) => line || arr.length === 1 || index < arr.length - 1,
    );
  const normalizedLines = lines.length > 0 ? lines : [value.trim()];
  const previewLines = normalizedLines.slice(0, maxLines).map((line) => {
    if (line.length <= maxCharsPerLine) return line;
    return `${line.slice(0, maxCharsPerLine)}...`;
  });
  const truncated =
    normalizedLines.length > maxLines ||
    previewLines.some((line, index) => line !== normalizedLines[index]);
  return {
    preview: previewLines.join("\n").trim(),
    truncated,
  };
}

export function buildOpencodeAtomicTooltip(input: {
  eventType: string;
  toolName: string;
  properties: Record<string, unknown>;
  toolInput: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  output?: string;
}): string {
  const toolKey = input.toolName.toLowerCase();
  const properties = input.properties;
  const toolInput = input.toolInput;
  const metadata = input.metadata || {};
  const output = asText(input.output);

  const filePath =
    asText(toolInput.filePath) ||
    asText(toolInput.path) ||
    asText(properties.file) ||
    asText(properties.path);
  const baseCommand =
    asText(toolInput.command) ||
    asText(toolInput.cmd) ||
    (Array.isArray((toolInput as Record<string, unknown>).args)
      ? ((toolInput as Record<string, unknown>).args as unknown[])
          .map((item) => (typeof item === "string" ? item.trim() : ""))
          .filter(Boolean)
          .join(" ")
      : "") ||
    (Array.isArray((properties as Record<string, unknown>).argv)
      ? ((properties as Record<string, unknown>).argv as unknown[])
          .map((item) => (typeof item === "string" ? item.trim() : ""))
          .filter(Boolean)
          .join(" ")
      : "") ||
    asText(properties.command) ||
    asText(properties.cmd);
  const cwd = asText(toolInput.cwd) || asText(properties.cwd);
  const pattern = asText(toolInput.pattern) || asText(properties.pattern);
  const url = asText(toolInput.url) || asText(properties.url);
  const shortOutput = truncateText(output, 240).text;
  const toolLabel = input.toolName
    ? `${i18n.t("homeWorkspace.toolLabel")}: ${input.toolName}`
    : "";
  const fileList = Array.isArray((properties as Record<string, unknown>).files)
    ? ((properties as Record<string, unknown>).files as unknown[])
        .map((item) => toRecord(item))
        .map((item) => ({
          kind: asText(item.kind) || asText(item.status),
          path: asText(item.path) || asText(item.file),
        }))
        .filter((item) => item.path)
    : [];

  if (toolKey === "bash" || input.eventType === "command.executed") {
    return summarizeTooltipLines([
      toolLabel,
      baseCommand
        ? `${i18n.t("homeWorkspace.commandLabel")}: ${baseCommand}`
        : "",
      cwd ? `${i18n.t("homeWorkspace.directoryLabel")}: ${cwd}` : "",
      shortOutput
        ? `${i18n.t("homeWorkspace.outputSummaryLabel")}: ${shortOutput}`
        : "",
    ]);
  }

  if (toolKey === "read") {
    return summarizeTooltipLines([
      toolLabel,
      filePath ? `${i18n.t("homeWorkspace.readFileLabel")}: ${filePath}` : "",
    ]);
  }

  if (toolKey === "write") {
    return summarizeTooltipLines([
      toolLabel,
      filePath ? `${i18n.t("homeWorkspace.writeFileLabel")}: ${filePath}` : "",
    ]);
  }

  if (toolKey === "edit") {
    return summarizeTooltipLines([
      toolLabel,
      filePath ? `${i18n.t("homeWorkspace.editFileLabel")}: ${filePath}` : "",
    ]);
  }

  if (toolKey === "grep") {
    return summarizeTooltipLines([
      toolLabel,
      pattern
        ? `${i18n.t("homeWorkspace.searchPatternLabel")}: ${pattern}`
        : "",
      filePath ? `${i18n.t("homeWorkspace.scopeLabel")}: ${filePath}` : "",
    ]);
  }

  if (toolKey === "glob") {
    return summarizeTooltipLines([
      toolLabel,
      pattern ? `${i18n.t("homeWorkspace.matchPatternLabel")}: ${pattern}` : "",
      filePath ? `${i18n.t("homeWorkspace.scopeLabel")}: ${filePath}` : "",
    ]);
  }

  if (toolKey === "list") {
    return summarizeTooltipLines([
      toolLabel,
      filePath
        ? `${i18n.t("homeWorkspace.listDirectoryLabel")}: ${filePath}`
        : "",
    ]);
  }

  if (toolKey === "webfetch") {
    return summarizeTooltipLines([
      toolLabel,
      url ? `${i18n.t("homeWorkspace.fetchUrlLabel")}: ${url}` : "",
    ]);
  }

  if (toolKey === "apply_patch") {
    const diffPayload = extractDiffPayload(metadata);
    const files =
      diffPayload.kind === "structured"
        ? diffPayload.files.map((file) => file.file).filter(Boolean)
        : diffPayload.kind === "text"
          ? collectPatchTargetFilesFromText(diffPayload.text)
          : collectPatchTargetFilesFromText(output);
    if (files.length === 0) {
      return i18n.t("homeWorkspace.applyPatch");
    }
    return summarizeTooltipLines([
      toolLabel,
      i18n.t("homeWorkspace.patchTargetFiles"),
      ...files.slice(0, 6).map((file) => `- ${file}`),
      files.length > 6
        ? `- ${i18n.t("homeWorkspace.otherFiles", { count: files.length - 6 })}`
        : "",
    ]);
  }

  if (
    input.eventType.startsWith("file.") ||
    input.eventType === "file.changed"
  ) {
    if (fileList.length > 0) {
      return summarizeTooltipLines([
        toolLabel,
        ...fileList
          .slice(0, 6)
          .map((item) => `${mapCodexFileChangeLabel(item.kind)}: ${item.path}`),
        fileList.length > 6
          ? i18n.t("homeWorkspace.otherFiles", { count: fileList.length - 6 })
          : "",
      ]);
    }
    return summarizeTooltipLines([
      toolLabel,
      filePath ? `${i18n.t("homeWorkspace.filePathLabel")}: ${filePath}` : "",
    ]);
  }

  if (toolKey === "task") {
    const description =
      asText(toolInput.description) || asText(properties.description);
    return summarizeTooltipLines([
      toolLabel,
      description
        ? `${i18n.t("homeWorkspace.subtaskLabel")}: ${description}`
        : "",
    ]);
  }

  return summarizeTooltipLines([
    toolLabel,
    baseCommand
      ? `${i18n.t("homeWorkspace.commandLabel")}: ${baseCommand}`
      : "",
    filePath ? `${i18n.t("homeWorkspace.pathLabel")}: ${filePath}` : "",
    shortOutput
      ? `${i18n.t("homeWorkspace.outputSummaryLabel")}: ${shortOutput}`
      : "",
  ]);
}

function OpencodeToolCard({
  item,
  currentSessionId,
  hiddenGoogleConfirmationIds,
  onApproveGoogleWorkspaceConfirmation,
  onRejectGoogleWorkspaceConfirmation,
  onOpenDiffPreview,
}: {
  item: Extract<ChatItem, { kind: "opencode_tool" }>;
  currentSessionId?: string | null;
  hiddenGoogleConfirmationIds?: string[];
  onApproveGoogleWorkspaceConfirmation?: (
    confirmation: GoogleWorkspaceConfirmationView,
  ) => Promise<void> | void;
  onRejectGoogleWorkspaceConfirmation?: (
    confirmation: GoogleWorkspaceConfirmationView,
  ) => Promise<void> | void;
  onOpenDiffPreview?: (options?: {
    diffId?: string | null;
    filePath?: string | null;
    messageKey?: string | null;
    messageIndex?: number | null;
  }) => void;
}) {
  const [detailOpen, setDetailOpen] = useState(false);
  const metadata = item.metadata || {};
  const { eventType, part, toolName, properties } =
    getOpencodeEventInfo(metadata);
  const toolState = toRecord(part.state);
  const rawInput = toolState.input ?? part.input;
  const input =
    typeof rawInput === "string" && rawInput.trim()
      ? { command: rawInput }
      : toRecord(rawInput);
  const metaInfo = toRecord(toolState.metadata);
  let output =
    asText(toolState.output) ||
    asText(properties.output) ||
    asText(item.content);
  const error = asText(toolState.error) || asText(properties.error);
  const status =
    asText(toolState.status) ||
    asText(properties.status) ||
    (error ? "error" : "unknown");
  const isCodexExecutor = asText(metadata.executor).toLowerCase() === "codex";

  const isDiffEvent = (toolName || "").toLowerCase() === "apply_patch";
  const toolKey = (toolName || "").toLowerCase();
  const googleConfirmation = readGoogleWorkspaceConfirmationFromOpencodeEvent({
    metadata,
    output,
    content: item.content,
    properties,
    part,
    toolState,
  });

  const capsuleTone = "border-border/70 bg-muted/50 text-foreground/80";

  const EventCapsule = ({
    icon: Icon,
    text,
    title,
  }: {
    icon: LucideIcon;
    text: string;
    title?: string;
  }) => {
    const capsule = (
      <span
        className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] ${capsuleTone}`}
      >
        <Icon className="w-3.5 h-3.5" />
        <span>{text}</span>
      </span>
    );

    if (!title) return capsule;

    const preview = buildDetailPreview(title);

    return (
      <Tooltip>
        <TooltipTrigger asChild>{capsule}</TooltipTrigger>
        <TooltipContent className="max-w-md space-y-2">
          <p className="whitespace-pre-wrap break-all text-xs leading-5">
            {preview.preview}
          </p>
          {preview.truncated ? (
            <button
              type="button"
              className="text-[11px] font-medium underline underline-offset-2"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setDetailOpen(true);
              }}
            >
              {i18n.t("homeWorkspace.showMore")}
            </button>
          ) : null}
        </TooltipContent>
      </Tooltip>
    );
  };

  let info = getToolInfo(toolName || "tool", input);
  const commandFromInput = asText(input.command) || asText(input.cmd);
  const commandFromArgs = Array.isArray((input as Record<string, unknown>).args)
    ? ((input as Record<string, unknown>).args as unknown[])
        .map((item) => (typeof item === "string" ? item : ""))
        .filter(Boolean)
        .join(" ")
    : "";
  const commandFromArgv = Array.isArray(
    (properties as Record<string, unknown>).argv,
  )
    ? ((properties as Record<string, unknown>).argv as unknown[])
        .map((item) => (typeof item === "string" ? item : ""))
        .filter(Boolean)
        .join(" ")
    : "";
  const commandHint =
    commandFromInput ||
    commandFromArgs ||
    commandFromArgv ||
    asText(input.description) ||
    asText(properties.command) ||
    asText(properties.cmd);
  const explanationText = buildOpencodeAtomicTooltip({
    eventType,
    toolName: toolName || "",
    properties,
    toolInput: input,
    metadata,
    output,
  });
  if (!toolName) {
    if (eventType.startsWith("file.")) {
      const filePath = asText(properties.file) || asText(properties.path);
      info = {
        title:
          eventType === "file.watcher.updated"
            ? i18n.t("homeWorkspace.fileWatch")
            : i18n.t("homeWorkspace.fileUpdate"),
        subtitle: getFilename(filePath),
      };
    } else if (eventType === "command.executed") {
      const category = asText(metadata.commandCategory).toLowerCase();
      info = {
        title:
          category === "list"
            ? i18n.t("homeWorkspace.directoryCheck")
            : category === "search"
              ? i18n.t("homeWorkspace.search")
              : category === "read"
                ? i18n.t("homeWorkspace.fileView")
                : category === "write"
                  ? i18n.t("homeWorkspace.fileEdit")
                  : i18n.t("homeWorkspace.commandExecution"),
        subtitle: asText(properties.command),
      };
    } else if (eventType === "file.changed") {
      const files = Array.isArray((properties as Record<string, unknown>).files)
        ? ((properties as Record<string, unknown>).files as unknown[])
            .map((item) => toRecord(item))
            .filter((item) => asText(item.path) || asText(item.file))
        : [];
      const first = files[0] || {};
      info = {
        title:
          asText(properties.label) ||
          mapCodexFileChangeLabel(asText(first.kind)),
        subtitle:
          files.length > 1
            ? `${files.length} ${i18n.t("homeWorkspace.filesUnit")}`
            : getFilename(asText(first.path) || asText(first.file)),
      };
    } else if (eventType.startsWith("pty.")) {
      info = {
        title: i18n.t("homeWorkspace.terminal"),
        subtitle: eventType.replace("pty.", ""),
      };
    }
  }

  if (!output && eventType.startsWith("file.")) {
    const filePath = asText(properties.file) || asText(properties.path);
    const action = asText(properties.event);
    output = [action, filePath].filter(Boolean).join(" ");
  }
  if (!output && eventType.startsWith("pty.")) {
    output = asText(properties.data) || asText(properties.text);
  }
  if (!output && eventType === "command.executed") {
    output = asText(properties.stdout) || asText(properties.output);
  }

  const showDetails = Boolean(
    output ||
    error ||
    status === "running" ||
    Object.keys(input).length > 0 ||
    Object.keys(metaInfo).length > 0,
  );
  const summaryText = info.subtitle || "";
  let detailTitle = `${info.title}${summaryText ? ` · ${summaryText}` : ""}`;
  let detailBodyText = explanationText;
  const wrapWithDetailDialog = (content: ReactNode) => (
    <>
      {content}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{detailTitle}</DialogTitle>
            <DialogDescription>
              {i18n.t("homeWorkspace.toolDetailDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-auto rounded-md bg-slate-950 px-4 py-3 font-mono text-xs leading-6 text-slate-100 whitespace-pre-wrap break-all">
            {detailBodyText}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );

  if (
    googleConfirmation &&
    !hiddenGoogleConfirmationIds?.includes(googleConfirmation.confirmationId)
  ) {
    return (
      <GoogleWorkspaceConfirmationPanel
        confirmation={googleConfirmation}
        currentSessionId={currentSessionId}
        compact
        onApprove={onApproveGoogleWorkspaceConfirmation}
        onReject={onRejectGoogleWorkspaceConfirmation}
      />
    );
  }

  if (isDiffEvent) {
    return wrapWithDetailDialog(
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="w-full"
      >
        <button
          type="button"
          onClick={() =>
            onOpenDiffPreview?.({
              diffId: item.diffId,
              messageKey: item.messageKey || null,
              messageIndex: item.messageIndex,
            })
          }
          className="text-left"
        >
          <EventCapsule
            icon={FileDiff}
            text={i18n.t("homeWorkspace.diffClickToView")}
            title={explanationText || undefined}
          />
        </button>
      </motion.div>,
    );
  }

  const extractTodos = (value: unknown): Array<Record<string, unknown>> => {
    if (Array.isArray(value)) {
      return value.filter((item) => item && typeof item === "object") as Array<
        Record<string, unknown>
      >;
    }
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (Array.isArray(record.todos)) {
        return record.todos.filter(
          (item) => item && typeof item === "object",
        ) as Array<Record<string, unknown>>;
      }
    }
    if (typeof value === "string" && value.trim()) {
      try {
        const parsed = JSON.parse(value);
        return extractTodos(parsed);
      } catch {
        return [];
      }
    }
    return [];
  };

  const todosFromInput = extractTodos((input as { todos?: unknown[] }).todos);
  const todosFromOutput = todosFromInput.length > 0 ? [] : extractTodos(output);
  const todosFromProps =
    todosFromInput.length > 0 || todosFromOutput.length > 0
      ? []
      : extractTodos(properties.todos);
  const todos =
    todosFromInput.length > 0
      ? todosFromInput
      : todosFromOutput.length > 0
        ? todosFromOutput
        : todosFromProps;

  const extractQuestions = (
    value: unknown,
  ): Array<{ header: string; question: string; options: string[] }> => {
    const mapOptions = (raw: unknown): string[] => {
      if (!Array.isArray(raw)) return [];
      return raw
        .map((option) => {
          if (typeof option === "string") return option.trim();
          if (option && typeof option === "object") {
            const record = option as Record<string, unknown>;
            return (
              asText(record.label) ||
              asText(record.text) ||
              asText(record.value)
            );
          }
          return "";
        })
        .filter(Boolean);
    };

    const normalizeQuestionRecord = (record: Record<string, unknown>) => {
      const question =
        asText(record.question) ||
        asText(record.content) ||
        asText(record.title);
      if (!question) return null;
      return {
        header: asText(record.header),
        question,
        options: mapOptions(record.options),
      };
    };

    if (Array.isArray(value)) {
      return value
        .map((item) =>
          item && typeof item === "object"
            ? normalizeQuestionRecord(item as Record<string, unknown>)
            : null,
        )
        .filter(
          (
            item,
          ): item is { header: string; question: string; options: string[] } =>
            Boolean(item),
        );
    }

    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (Array.isArray(record.questions)) {
        return extractQuestions(record.questions);
      }
      const single = normalizeQuestionRecord(record);
      return single ? [single] : [];
    }

    if (typeof value === "string" && value.trim()) {
      try {
        return extractQuestions(JSON.parse(value));
      } catch {
        return [];
      }
    }

    return [];
  };

  const questionsFromInput = extractQuestions(
    (input as { questions?: unknown[] }).questions,
  );
  const questionsFromOutput =
    questionsFromInput.length > 0 ? [] : extractQuestions(output);
  const questionsFromProps =
    questionsFromInput.length > 0 || questionsFromOutput.length > 0
      ? []
      : extractQuestions(properties.questions);
  const questions =
    questionsFromInput.length > 0
      ? questionsFromInput
      : questionsFromOutput.length > 0
        ? questionsFromOutput
        : questionsFromProps;

  if (toolKey === "todowrite") {
    if (todos.length === 0) {
      return null;
    }
    return wrapWithDetailDialog(
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="w-full"
      >
        <div className="rounded-xl border border-border/70 bg-card px-4 py-3 text-sm text-foreground shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {i18n.t("homeWorkspace.todo")}
          </div>
          {todos.length > 0 ? (
            <div className="mt-3 space-y-2">
              {todos.map((todo, index) => {
                const content =
                  asText(todo.content) || i18n.t("homeWorkspace.todoItem");
                const statusText = asText(todo.status) || "pending";
                const priority = asText(todo.priority);
                const statusLabel =
                  statusText === "completed"
                    ? i18n.t("homeWorkspace.completed")
                    : statusText === "in_progress"
                      ? i18n.t("homeWorkspace.inProgress")
                      : i18n.t("homeWorkspace.pending");
                const statusTone = getTodoStatusTone(statusText);
                return (
                  <div
                    key={`${content}-${index}`}
                    className="flex items-center justify-between gap-3"
                  >
                    <div className="text-sm text-foreground">{content}</div>
                    <div className="flex items-center gap-2">
                      {priority ? (
                        <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-200">
                          {priority === "high"
                            ? i18n.t("homeWorkspace.priorityHigh")
                            : priority === "medium"
                              ? i18n.t("homeWorkspace.priorityMedium")
                              : i18n.t("homeWorkspace.priorityLow")}
                        </span>
                      ) : null}
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[11px] ${statusTone}`}
                      >
                        {statusLabel}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </motion.div>,
    );
  }

  if (toolKey === "question") {
    if (questions.length === 0) {
      return null;
    }
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="w-full"
      >
        <div className="rounded-xl border border-border/70 bg-card px-4 py-3 text-sm text-foreground shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {i18n.t("homeWorkspace.pendingConfirmation")}
          </div>
          <div className="mt-3 space-y-3">
            {questions.map((question, index) => (
              <div
                key={`${question.question}-${index}`}
                className="space-y-1.5"
              >
                {question.header ? (
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {question.header}
                  </div>
                ) : null}
                <div className="text-sm text-foreground">
                  {question.question}
                </div>
                {question.options.length > 0 ? (
                  <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                    {question.options.map((option, optionIndex) => (
                      <li key={`${option}-${optionIndex}`}>{option}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
            <div className="text-xs text-muted-foreground">
              {i18n.t("homeWorkspace.replyInComposer")}
            </div>
          </div>
        </div>
      </motion.div>
    );
  }

  if (toolKey === "write" || toolKey === "edit") {
    const filePath =
      asText(input.filePath) ||
      asText(input.path) ||
      asText(properties.file) ||
      asText(properties.path);
    const label =
      toolKey === "write"
        ? i18n.t("homeWorkspace.writeFile")
        : i18n.t("homeWorkspace.editFile");
    const fileName = getFilename(filePath) || i18n.t("homeWorkspace.file");
    const capsuleText = `${label} · ${fileName}`;
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="w-full"
      >
        {onOpenDiffPreview ? (
          <button
            type="button"
            onClick={() =>
              onOpenDiffPreview?.({
                filePath: filePath || null,
                messageKey: item.messageKey || null,
                messageIndex: item.messageIndex,
              })
            }
            className="text-left"
          >
            <EventCapsule
              icon={toolKey === "write" ? FilePlus : FilePenLine}
              text={capsuleText}
              title={explanationText || undefined}
            />
          </button>
        ) : (
          <EventCapsule
            icon={toolKey === "write" ? FilePlus : FilePenLine}
            text={capsuleText}
            title={explanationText || undefined}
          />
        )}
      </motion.div>
    );
  }

  if (eventType === "command.executed") {
    const compactOutput = metadata.compactOutput === true;
    const commandText =
      asText(properties.command) ||
      asText(input.command) ||
      asText(properties.cmd);
    const commandCard = getCodexCommandCardCopy(commandText);
    const targetPath =
      asText(metadata.targetPath) ||
      asText(properties.targetPath) ||
      extractCodexCommandTargetPath(commandText);
    const writeLike = commandCard.category === "write";
    const rawOutput =
      asText(properties.stdout) ||
      asText(properties.output) ||
      asText(properties.text) ||
      output ||
      error;
    const { text: outputText, truncated } = truncateText(rawOutput, 1200);
    const previewText = truncateText(rawOutput, 180).text;
    const exitCodeText = asText(properties.exitCode);
    const statusText = asText(properties.status).toLowerCase();
    const statusLabel =
      statusText === "failed" || error || exitCodeText === "127"
        ? i18n.t("homeWorkspace.failedShort")
        : statusText === "completed" || exitCodeText === "0"
          ? i18n.t("homeWorkspace.successShort")
          : i18n.t("homeWorkspace.executionShort");
    const capsuleText =
      writeLike && targetPath
        ? `${inferCodexWriteLabel(commandText)} · ${getFilename(targetPath) || targetPath}`
        : `${commandCard.title} · ${statusLabel}`;
    const inlineSummary =
      writeLike && targetPath
        ? i18n.t("homeWorkspace.shellWriteSummary", {
            action: inferCodexWriteLabel(commandText),
            path: targetPath,
          })
        : "";
    if (isCodexExecutor && writeLike) {
      const resolvedLabel = inferCodexWriteLabel(commandText);
      const resolvedPath = targetPath || "";
      const resolvedFileName =
        getFilename(resolvedPath) || i18n.t("homeWorkspace.file");
      const writePayloadPreview = extractCodexWritePayloadPreview(commandText);
      const commandPreview = truncateText(commandText || "", 2400);
      detailTitle = `${resolvedLabel} · ${resolvedFileName}`;
      detailBodyText = [
        `${i18n.t("homeWorkspace.operationLabel")}: ${resolvedLabel}`,
        resolvedPath
          ? `${i18n.t("homeWorkspace.targetFileLabel")}: ${resolvedPath}`
          : "",
        writePayloadPreview
          ? i18n.t("homeWorkspace.writeContentPreviewLabel")
          : commandText
            ? i18n.t("homeWorkspace.commandSummaryLabel")
            : "",
        writePayloadPreview
          ? writePayloadPreview.text
          : commandText
            ? commandPreview.text
            : "",
        writePayloadPreview?.truncated
          ? i18n.t("homeWorkspace.writeContentTruncated")
          : commandText && commandPreview.truncated
            ? i18n.t("homeWorkspace.commandContentTruncated")
            : "",
        !commandText && explanationText ? explanationText : "",
      ]
        .filter(Boolean)
        .join("\n");
    }
    return wrapWithDetailDialog(
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="w-full"
      >
        <div className="space-y-2">
          <EventCapsule
            icon={commandCard.icon}
            text={capsuleText}
            title={explanationText || commandHint || undefined}
          />
          {writeLike && inlineSummary ? (
            <div className="whitespace-pre-wrap break-words text-[11px] text-muted-foreground">
              {inlineSummary}
            </div>
          ) : null}
          {commandText && !writeLike ? (
            <div className="rounded-md bg-slate-900 px-3 py-2 text-xs text-slate-100 font-mono">
              {commandText}
            </div>
          ) : null}
          {compactOutput && previewText ? (
            <div className="whitespace-pre-wrap break-words text-[11px] text-muted-foreground">
              {previewText}
            </div>
          ) : null}
          {!compactOutput && outputText ? (
            <div className="rounded-md bg-slate-950 px-3 py-2 text-xs text-slate-100 font-mono whitespace-pre-wrap">
              {outputText}
            </div>
          ) : null}
          {!compactOutput && truncated ? (
            <div className="text-[11px] text-muted-foreground">
              {i18n.t("homeWorkspace.outputTruncated")}
            </div>
          ) : null}
        </div>
      </motion.div>,
    );
  }

  if (eventType === "file.changed") {
    const files = Array.isArray((properties as Record<string, unknown>).files)
      ? ((properties as Record<string, unknown>).files as unknown[])
          .map((item) => toRecord(item))
          .map((item) => ({
            kind: asText(item.kind),
            path: asText(item.path) || asText(item.file),
          }))
          .filter((item) => item.path)
      : [];
    const primary = files[0];
    const primaryPath =
      primary?.path || asText(properties.file) || asText(properties.path);
    const label =
      asText(properties.label) || mapCodexFileChangeLabel(primary?.kind || "");
    const text =
      files.length > 1
        ? `${label || i18n.t("homeWorkspace.fileChange")} · ${files.length} ${i18n.t("homeWorkspace.filesUnit")}`
        : `${label || i18n.t("homeWorkspace.fileChange")} · ${getFilename(primaryPath) || i18n.t("homeWorkspace.file")}`;
    const icon =
      label === i18n.t("homeWorkspace.createFile")
        ? FilePlus
        : label === i18n.t("homeWorkspace.deleteFile")
          ? Trash2
          : FilePenLine;
    detailTitle =
      files.length > 1
        ? `${label || i18n.t("homeWorkspace.fileChange")} · ${files.length} ${i18n.t("homeWorkspace.filesUnit")}`
        : `${label || i18n.t("homeWorkspace.fileChange")} · ${getFilename(primaryPath) || i18n.t("homeWorkspace.file")}`;
    detailBodyText = [
      `${i18n.t("homeWorkspace.operationLabel")}: ${label || i18n.t("homeWorkspace.fileChange")}`,
      primaryPath
        ? `${i18n.t("homeWorkspace.targetFileLabel")}: ${primaryPath}`
        : "",
      files.length > 1
        ? `${i18n.t("homeWorkspace.affectedFilesLabel")}:\n${files
            .map(
              (item) => `${mapCodexFileChangeLabel(item.kind)}: ${item.path}`,
            )
            .join("\n")}`
        : "",
      asText(properties.diff) ? i18n.t("homeWorkspace.nativeDiffSynced") : "",
    ]
      .filter(Boolean)
      .join("\n");
    return wrapWithDetailDialog(
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="w-full"
      >
        {onOpenDiffPreview ? (
          <button
            type="button"
            onClick={() =>
              onOpenDiffPreview?.({
                filePath: primaryPath || null,
                messageKey: item.messageKey || null,
                messageIndex: item.messageIndex,
              })
            }
            className="text-left"
          >
            <EventCapsule
              icon={icon}
              text={text}
              title={explanationText || undefined}
            />
          </button>
        ) : (
          <EventCapsule
            icon={icon}
            text={text}
            title={explanationText || undefined}
          />
        )}
      </motion.div>,
    );
  }

  if (eventType.startsWith("file.")) {
    const filePath = asText(properties.file) || asText(properties.path);
    const label =
      eventType === "file.watcher.updated"
        ? i18n.t("homeWorkspace.fileWatch")
        : i18n.t("homeWorkspace.fileUpdate");
    return wrapWithDetailDialog(
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="w-full"
      >
        {onOpenDiffPreview ? (
          <button
            type="button"
            onClick={() =>
              onOpenDiffPreview?.({
                filePath: filePath || null,
                messageKey: item.messageKey || null,
                messageIndex: item.messageIndex,
              })
            }
            className="text-left"
          >
            <EventCapsule
              icon={FileText}
              text={`${label} · ${getFilename(filePath) || i18n.t("homeWorkspace.fileUpdated")}`}
              title={explanationText || undefined}
            />
          </button>
        ) : (
          <EventCapsule
            icon={FileText}
            text={`${label} · ${getFilename(filePath) || i18n.t("homeWorkspace.fileUpdated")}`}
            title={explanationText || undefined}
          />
        )}
      </motion.div>,
    );
  }

  return wrapWithDetailDialog(
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="w-full"
    >
      <EventCapsule
        icon={toolKey === "bash" ? Terminal : FileText}
        text={`${info.title}${summaryText ? ` · ${summaryText}` : ""}`}
        title={
          explanationText ||
          (toolKey === "bash" ? commandHint || undefined : undefined)
        }
      />
    </motion.div>,
  );
}

function getManagedToolStatusPresentation(status: string) {
  if (status === "failed") {
    return {
      iconClass:
        "border border-[var(--tool-error-border)] bg-[var(--tool-error-surface)] text-[var(--tool-error-foreground)]",
      badgeClass:
        "border-[var(--tool-error-border)] bg-[var(--tool-error-surface-strong)] text-[var(--tool-error-foreground)]",
      hoverHeaderClass:
        "border-b border-[var(--tool-error-border)] bg-[var(--tool-error-surface)]",
      previewClass:
        "border border-[var(--tool-error-border)] bg-[var(--tool-error-surface)] text-foreground",
      detailClass: "text-foreground/82",
      hintClass: "text-[var(--tool-error-foreground)]/80",
    } as const;
  }

  if (status === "completed") {
    return {
      iconClass:
        "border border-[var(--tool-success-border)] bg-[var(--tool-success-surface)] text-[var(--tool-success-foreground)]",
      badgeClass:
        "border-[var(--tool-success-border)] bg-[var(--tool-success-surface-strong)] text-[var(--tool-success-foreground)]",
      hoverHeaderClass:
        "border-b border-[var(--tool-success-border)] bg-[var(--tool-success-surface)]",
      previewClass:
        "border border-[var(--tool-success-border)] bg-[var(--tool-success-surface)] text-foreground",
      detailClass: "text-foreground/82",
      hintClass: "text-[var(--tool-success-foreground)]/80",
    } as const;
  }

  return {
    iconClass: "border border-border/70 bg-background/85 text-foreground/75",
    badgeClass: "border-border/70 bg-background/90 text-foreground/75",
    hoverHeaderClass: "border-b border-border/70 bg-muted/25",
    previewClass: "border border-border/70 bg-background/70 text-foreground",
    detailClass: "text-foreground/80",
    hintClass: "text-muted-foreground",
  } as const;
}

function getManagedToolIcon(toolName: string): LucideIcon {
  if (toolName === "shell_execute") return Terminal;
  if (toolName === "debug_open_page") return Bug;
  if (isManagedDeploymentTool(toolName)) return Rocket;
  if (toolName === "write_file") return FilePenLine;
  if (toolName === "read_file") return FileText;
  if (toolName === "search_code") return Search;
  if (toolName === "list_directory") return FolderSearch2;
  if (toolName === "ask_user") return Sparkles;
  return FileSearch;
}

function ManagedActivityGroup({
  item,
  onOpenReplay,
  currentSessionId,
  hiddenGoogleConfirmationIds,
  onApproveGoogleWorkspaceConfirmation,
  onRejectGoogleWorkspaceConfirmation,
}: {
  item: Extract<ChatItem, { kind: "managed_activity_group" }>;
  onOpenReplay?: (runId: string, toolCallId: string, toolName: string) => void;
  currentSessionId?: string | null;
  hiddenGoogleConfirmationIds?: string[];
  onApproveGoogleWorkspaceConfirmation?: (
    confirmation: GoogleWorkspaceConfirmationView,
  ) => Promise<void> | void;
  onRejectGoogleWorkspaceConfirmation?: (
    confirmation: GoogleWorkspaceConfirmationView,
  ) => Promise<void> | void;
}) {
  const [expanded, setExpanded] = useState(item.defaultExpanded ?? true);
  useEffect(() => {
    setExpanded(item.defaultExpanded ?? true);
  }, [item.defaultExpanded, item.messageKey]);
  const toolCount = item.items.filter((entry) => entry.kind === "managed_tool").length;
  const completedToolCount = item.items.filter(
    (entry) => entry.kind === "managed_tool" && entry.status === "completed",
  ).length;
  const activityState = getManagedActivityState(item.items);
  const StatusIcon =
    activityState === "failed"
      ? X
      : activityState === "running"
        ? Loader2
        : Check;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="w-full"
    >
      <div className="flex max-w-[min(100%,44rem)] flex-col gap-0">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="group/header flex w-full items-center justify-between gap-3 rounded-lg px-1 py-1 text-left text-sm text-foreground transition hover:bg-muted/35"
        >
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
                activityState === "failed"
                  ? "bg-destructive text-destructive-foreground"
                  : activityState === "running"
                    ? "bg-muted text-muted-foreground"
                    : "bg-muted-foreground text-background"
              }`}
            >
              <StatusIcon
                className={`h-2.5 w-2.5 ${
                  activityState === "running" ? "animate-spin" : ""
                }`}
              />
            </span>
            <span className="truncate font-medium" title={item.title}>
              {item.title}
            </span>
            <ChevronDown
              className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${
                expanded ? "rotate-180" : ""
              }`}
            />
          </div>
          {toolCount > 0 ? (
            <span className="shrink-0 text-[12px] text-muted-foreground opacity-0 transition group-hover/header:opacity-100">
              {completedToolCount}/{toolCount}
            </span>
          ) : null}
        </button>
        {expanded ? (
          <div className="flex">
            <div className="relative w-6 shrink-0">
              <div className="absolute left-2 top-0 bottom-0 border-l border-dashed border-border" />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-2 overflow-hidden pt-2">
              {item.items.map((entry, index) =>
                entry.kind === "managed_status" ? (
                  <p
                    key={entry.messageKey || `managed-status-${index}`}
                    className="text-[14px] leading-6 text-muted-foreground"
                  >
                    {entry.text}
                  </p>
                ) : (
                  <ManagedActivityToolRow
                    key={entry.messageKey || entry.toolCallId || `managed-tool-${index}`}
                    item={entry}
                    onOpenReplay={onOpenReplay}
                    currentSessionId={currentSessionId}
                    hiddenGoogleConfirmationIds={hiddenGoogleConfirmationIds}
                    onApproveGoogleWorkspaceConfirmation={
                      onApproveGoogleWorkspaceConfirmation
                    }
                    onRejectGoogleWorkspaceConfirmation={
                      onRejectGoogleWorkspaceConfirmation
                    }
                  />
                ),
              )}
            </div>
          </div>
        ) : null}
      </div>
    </motion.div>
  );
}

function ManagedActivityToolRow({
  item,
  onOpenReplay,
  currentSessionId,
  hiddenGoogleConfirmationIds,
  onApproveGoogleWorkspaceConfirmation,
  onRejectGoogleWorkspaceConfirmation,
}: {
  item: Extract<ChatItem, { kind: "managed_tool" }>;
  onOpenReplay?: (runId: string, toolCallId: string, toolName: string) => void;
  currentSessionId?: string | null;
  hiddenGoogleConfirmationIds?: string[];
  onApproveGoogleWorkspaceConfirmation?: (
    confirmation: GoogleWorkspaceConfirmationView,
  ) => Promise<void> | void;
  onRejectGoogleWorkspaceConfirmation?: (
    confirmation: GoogleWorkspaceConfirmationView,
  ) => Promise<void> | void;
}) {
  const Icon = getManagedToolIcon(item.toolName);
  const googleConfirmation = readGoogleWorkspaceConfirmation(item.metadata);
  const title =
    getManagedToolPurposeSummary(item.toolName, item.metadata) ||
    item.summary?.trim() ||
    getManagedToolDisplayName(item.toolName);
  const statusUi = getManagedToolStatusPresentation(item.status);

  if (
    googleConfirmation &&
    !hiddenGoogleConfirmationIds?.includes(googleConfirmation.confirmationId)
  ) {
    return (
      <GoogleWorkspaceConfirmationPanel
        confirmation={{ ...googleConfirmation, agentRunId: item.runId }}
        currentSessionId={currentSessionId}
        compact
        onApprove={onApproveGoogleWorkspaceConfirmation}
        onReject={onRejectGoogleWorkspaceConfirmation}
      />
    );
  }

  return (
    <div className="group flex w-full items-center gap-2">
      <div className="h-7 min-w-0 flex-1">
        <button
          type="button"
          onClick={() => {
            if (onOpenReplay && item.runId && item.toolCallId) {
              onOpenReplay(item.runId, item.toolCallId, item.toolName);
            }
          }}
          className="inline-flex h-full max-w-full items-center gap-1 overflow-hidden rounded-full border border-border/70 bg-background/85 px-2.5 py-1 text-left transition hover:bg-muted/40"
        >
          <span
            className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${statusUi.iconClass}`}
          >
            <Icon className="h-3.5 w-3.5" />
          </span>
          <span className="truncate text-[13px] text-muted-foreground" title={title}>
            {title}
          </span>
        </button>
      </div>
    </div>
  );
}

function GoogleWorkspaceConfirmationPanel({
  confirmation,
  currentSessionId,
  compact = false,
  onApprove,
  onReject,
}: {
  confirmation: GoogleWorkspaceConfirmationView;
  currentSessionId?: string | null;
  compact?: boolean;
  onApprove?: (confirmation: GoogleWorkspaceConfirmationView) => Promise<void> | void;
  onReject?: (confirmation: GoogleWorkspaceConfirmationView) => Promise<void> | void;
}) {
  const [pendingAction, setPendingAction] = useState<"approve" | "reject" | null>(null);
  const disabled =
    Boolean(pendingAction) ||
    !currentSessionId ||
    !confirmation.confirmationId ||
    !onApprove ||
    !onReject;
  const connectorLabel = getMcpConfirmationConnectorLabel(confirmation.connectorKey);
  const parameterEntries = Object.entries(confirmation.parameterSummary).slice(0, 6);

  const runAction = async (action: "approve" | "reject") => {
    const handler = action === "approve" ? onApprove : onReject;
    if (!handler || disabled) return;
    setPendingAction(action);
    try {
      await handler(confirmation);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error || ""));
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="w-full"
    >
      <div
        className={`max-w-[min(100%,44rem)] rounded-lg border border-amber-300/60 bg-amber-50/80 px-3 py-3 text-amber-950 shadow-sm dark:border-amber-600/45 dark:bg-amber-950/35 dark:text-amber-100 ${
          compact ? "space-y-2" : "space-y-3"
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[12px] font-semibold leading-5">
              确认高风险 MCP 操作
            </div>
            <div className="truncate text-[11px] leading-5 opacity-75">
              {confirmation.toolName}
            </div>
          </div>
          <span className="shrink-0 rounded-md border border-current/20 px-1.5 py-0.5 text-[10px] font-medium">
            待确认
          </span>
        </div>
        <div className="grid gap-2 text-[12px] leading-5 sm:grid-cols-2">
          <div className="min-w-0">
            <div className="text-[10px] font-medium uppercase tracking-[0.16em] opacity-60">
              Connector
            </div>
            <div className="truncate" title={connectorLabel}>
              {connectorLabel}
            </div>
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-medium uppercase tracking-[0.16em] opacity-60">
              目标对象
            </div>
            <div className="truncate" title={confirmation.target}>
              {confirmation.target || "未识别"}
            </div>
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-medium uppercase tracking-[0.16em] opacity-60">
              动作
            </div>
            <div className="truncate" title={confirmation.action}>
              {confirmation.action || "write_operation"}
            </div>
          </div>
        </div>
        {parameterEntries.length > 0 ? (
          <div className="grid gap-1 text-[11px] leading-5 sm:grid-cols-2">
            {parameterEntries.map(([key, value]) => (
              <div key={key} className="min-w-0 rounded-md bg-background/45 px-2 py-1">
                <span className="mr-1 opacity-60">{key}:</span>
                <span className="break-all">{String(value)}</span>
              </div>
            ))}
          </div>
        ) : null}
        {confirmation.impact ? (
          <div className="text-[12px] leading-5 opacity-80">{confirmation.impact}</div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            disabled={disabled}
            onClick={() => void runAction("approve")}
          >
            {pendingAction === "approve" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            确认执行
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => void runAction("reject")}
          >
            {pendingAction === "reject" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <X className="h-3.5 w-3.5" />
            )}
            拒绝
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

function ManagedToolCard({
  item,
  onOpenReplay,
  currentSessionId,
  hiddenGoogleConfirmationIds,
  onApproveGoogleWorkspaceConfirmation,
  onRejectGoogleWorkspaceConfirmation,
}: {
  item: Extract<ChatItem, { kind: "managed_tool" }>;
  onOpenReplay?: (runId: string, toolCallId: string, toolName: string) => void;
  currentSessionId?: string | null;
  hiddenGoogleConfirmationIds?: string[];
  onApproveGoogleWorkspaceConfirmation?: (
    confirmation: GoogleWorkspaceConfirmationView,
  ) => Promise<void> | void;
  onRejectGoogleWorkspaceConfirmation?: (
    confirmation: GoogleWorkspaceConfirmationView,
  ) => Promise<void> | void;
}) {
  const displayName = getManagedToolDisplayName(item.toolName);
  const Icon = getManagedToolIcon(item.toolName);
  const googleConfirmation = readGoogleWorkspaceConfirmation(item.metadata);
  const statusLabel =
    item.status === "failed"
      ? i18n.t("homeWorkspace.failedShort")
      : item.status === "completed"
        ? i18n.t("homeWorkspace.completed")
        : i18n.t("homeWorkspace.inProgress");
  const hoverPreview = buildDetailPreview(
    item.detail || item.summary || item.toolName,
    5,
    96,
  );
  const summaryText = item.summary?.trim();
  const previewText =
    formatManagedToolPreview(item.toolName, item.metadata) ||
    hoverPreview.preview ||
    summaryText ||
    "";
  const statusUi = getManagedToolStatusPresentation(item.status);
  const chipToneClass =
    "border-border/70 bg-card/90 text-foreground/85 hover:bg-muted/40";
  const writeFileProgress = readManagedWriteFileProgress(item.metadata);
  const isWriteFileExpanded = shouldExpandManagedWriteFileCard({
    toolName: item.toolName,
    status: item.status,
    metadata: item.metadata,
  });
  const writeFilePath =
    writeFileProgress.path || summaryText || i18n.t("homeWorkspace.writeFile");
  const writeFileGeneratedLabel =
    writeFileProgress.generatedChars > 0
      ? i18n.t("homeWorkspace.generatedCharsLabel", {
          count: writeFileProgress.generatedChars,
        })
      : i18n.t("homeWorkspace.generatingCode");
  const writeFilePreview =
    writeFileProgress.preview ||
    previewText ||
    i18n.t("homeWorkspace.generatingCodeSnippet");
  const writeFilePreviewRef = useRef<HTMLDivElement | null>(null);
  const todoItems = readManagedTodoItems(item.metadata);

  useEffect(() => {
    if (!isWriteFileExpanded) return;
    const node = writeFilePreviewRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [isWriteFileExpanded, writeFilePreview]);

  if (
    googleConfirmation &&
    !hiddenGoogleConfirmationIds?.includes(googleConfirmation.confirmationId)
  ) {
    return (
      <GoogleWorkspaceConfirmationPanel
        confirmation={{ ...googleConfirmation, agentRunId: item.runId }}
        currentSessionId={currentSessionId}
        onApprove={onApproveGoogleWorkspaceConfirmation}
        onReject={onRejectGoogleWorkspaceConfirmation}
      />
    );
  }

  if (item.toolName === "todowrite" && todoItems.length > 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18 }}
        className="w-full"
      >
        <button
          type="button"
          onClick={() => {
            if (onOpenReplay && item.runId && item.toolCallId) {
              onOpenReplay(item.runId, item.toolCallId, item.toolName);
            }
          }}
          className={`w-full max-w-[min(100%,42rem)] rounded-2xl border px-4 py-3 text-left transition ${chipToneClass}`}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full shadow-sm ${statusUi.iconClass}`}
              >
                <Sparkles className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0">
                <div className="text-[12px] font-medium leading-5">
                  {displayName}
                </div>
                <div className="truncate text-[11px] leading-5 opacity-75">
                  {summaryText || i18n.t("homeWorkspace.todo")}
                </div>
              </div>
            </div>
            <span
              className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${statusUi.badgeClass}`}
            >
              {statusLabel}
            </span>
          </div>
          <div className="mt-3 space-y-2">
            {todoItems.map((todo, index) => (
              <div
                key={`${todo.content}-${index}`}
                className="flex items-center justify-between gap-3"
              >
                <div className="min-w-0 text-sm text-foreground">
                  <span className="block truncate">{todo.content}</span>
                </div>
                <span
                  className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${getTodoStatusTone(todo.status)}`}
                >
                  {getTodoStatusLabel(todo.status)}
                </span>
              </div>
            ))}
          </div>
        </button>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="w-full"
    >
      <HoverCard openDelay={140} closeDelay={80}>
        <HoverCardTrigger asChild>
          <button
            type="button"
            onClick={() => {
              if (onOpenReplay && item.runId && item.toolCallId) {
                onOpenReplay(item.runId, item.toolCallId, item.toolName);
              }
            }}
            data-managed-tool-layout={
              isWriteFileExpanded ? "expanded" : "compact"
            }
            className={
              isWriteFileExpanded
                ? `group w-full max-w-full lg:max-w-[min(86vw,720px)] rounded-2xl border p-0 text-left transition ${chipToneClass}`
                : `group inline-flex max-w-[min(100%,42rem)] items-center gap-2 rounded-full border px-2.5 py-1.5 text-left transition ${chipToneClass}`
            }
          >
            {isWriteFileExpanded ? (
              <div className="w-full">
                <div className="flex h-[190px] w-full flex-col lg:h-[220px]">
                  <div className="flex items-center justify-between gap-3 border-b border-current/15 px-3 py-2">
                    <div className="min-w-0 flex items-center gap-2">
                      <span
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full shadow-sm ${statusUi.iconClass}`}
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <div className="min-w-0">
                        <div className="text-[12px] font-medium leading-5">
                          {i18n.t("homeWorkspace.writeFile")}
                        </div>
                        <div className="truncate text-[11px] leading-5 opacity-75">
                          {writeFilePath}
                        </div>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <span
                        className={`inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${statusUi.badgeClass}`}
                      >
                        {statusLabel}
                      </span>
                      <div className="mt-1 text-[10px] leading-4 opacity-75">
                        {writeFileGeneratedLabel}
                      </div>
                    </div>
                  </div>
                  <div className="flex-1 px-3 py-2">
                    <div
                      ref={writeFilePreviewRef}
                      className="h-[126px] overflow-auto rounded-xl border border-current/15 bg-background/70 px-3 py-2 font-mono text-[11px] leading-5 whitespace-pre-wrap break-all lg:h-[152px]"
                    >
                      {writeFilePreview}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full shadow-sm ${statusUi.iconClass}`}
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex items-center gap-2 overflow-hidden">
                  <span className="shrink-0 text-[11px] font-medium leading-5">
                    {displayName}
                  </span>
                  <span
                    className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${statusUi.badgeClass}`}
                  >
                    {statusLabel}
                  </span>
                  {summaryText ? (
                    <span className="truncate text-[11px] leading-5 opacity-75">
                      {summaryText}
                    </span>
                  ) : null}
                </span>
              </>
            )}
          </button>
        </HoverCardTrigger>
        <HoverCardContent
          align="start"
          side="top"
          className="w-[380px] rounded-2xl border border-border/80 bg-popover p-0 text-popover-foreground shadow-[0_18px_48px_rgba(0,0,0,0.32)]"
        >
          <div className={`space-y-0 px-4 py-3 ${statusUi.hoverHeaderClass}`}>
            <div className="flex items-center gap-3">
              <div
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl shadow-sm ${statusUi.iconClass}`}
              >
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium leading-5">
                    {displayName}
                  </span>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusUi.badgeClass}`}
                  >
                    {statusLabel}
                  </span>
                </div>
                <div className="mt-0.5 text-[11px] leading-5 opacity-70">
                  {item.toolName}
                </div>
              </div>
            </div>
            {summaryText ? (
              <p className="mt-3 text-[12px] leading-5 opacity-85">
                {summaryText}
              </p>
            ) : null}
          </div>
          <div className="space-y-3 px-4 py-3">
            <div className="space-y-1">
              <div className="text-[11px] font-medium uppercase tracking-[0.18em] opacity-55">
                {i18n.t("homeWorkspace.toolResultSummary")}
              </div>
              <p
                className={`whitespace-pre-wrap break-all rounded-xl px-3 py-2 font-mono text-[11px] leading-5 ${statusUi.previewClass}`}
              >
                {previewText}
              </p>
            </div>
            <div className="space-y-1">
              <div className="text-[11px] font-medium uppercase tracking-[0.18em] opacity-55">
                {i18n.t("homeWorkspace.moreInfo")}
              </div>
              <p
                className={`whitespace-pre-wrap break-all text-[12px] leading-5 ${statusUi.detailClass}`}
              >
                {hoverPreview.preview}
              </p>
            </div>
            <div className={`text-[11px] leading-5 ${statusUi.hintClass}`}>
              {i18n.t("homeWorkspace.clickMessageForReplay")}
            </div>
          </div>
        </HoverCardContent>
      </HoverCard>
    </motion.div>
  );
}

/**
 * 获取 Agent 名称
 */
function getAgentName(agent?: string) {
  const nameMap: Record<string, string> = {
    system: i18n.t("homeWorkspace.systemAgent"),
    altus: "Altus",
    intent_recognition: i18n.t("homeWorkspace.intentRecognition"),
    planning: i18n.t("homeWorkspace.taskPlanning"),
    execution_plan: i18n.t("homeWorkspace.executionPlan"),
  };
  return agent ? nameMap[agent] || agent : i18n.t("homeWorkspace.agentLabel");
}

function resolveAgentDisplayName(input: {
  agent?: string;
  metadata?: unknown;
  messageKey?: string;
}) {
  const metadata = toRecord(input.metadata);
  const rawAgent = asText(input.agent).toLowerCase();
  const messageKey = asText(input.messageKey);
  if (
    rawAgent === "altus" ||
    asText(metadata.executor).toLowerCase() === "altus" ||
    asText(metadata.executionMode).toLowerCase() === "managed" ||
    messageKey.startsWith("managed:")
  ) {
    return "Altus";
  }
  return getAgentName(input.agent);
}

function getExecutorDisplayName(metadataRaw: unknown) {
  const metadata = toRecord(metadataRaw);
  const executor = asText(metadata.executor).toLowerCase();
  if (executor === "codex") return "Codex";
  if (executor === "altus") return "Altus";
  if (executor === "opencode") return "OpenCode";
  return i18n.t("homeWorkspace.executorLabel");
}

function isManagedExecutionEvent(metadataRaw: unknown) {
  const metadata = toRecord(metadataRaw);
  return (
    asText(metadata.executionMode).toLowerCase() === "managed" ||
    asText(metadata.executor).toLowerCase() === "altus"
  );
}

function extractManagedDeliverables(
  metadataRaw: unknown,
): TaskCreationDeliverableArtifact[] {
  const metadata = toRecord(metadataRaw);
  const raw = Array.isArray(metadata.deliverables) ? metadata.deliverables : [];
  const unique = new Map<string, TaskCreationDeliverableArtifact>();
  for (const item of raw) {
    const record = toRecord(item);
    const id = asText(record.id);
    const name = asText(record.name);
    if (!id || !name || unique.has(id)) continue;
    const sizeValue =
      typeof record.size === "number"
        ? record.size
        : typeof record.sizeBytes === "number"
          ? record.sizeBytes
          : Number(record.size || record.sizeBytes || 0);
    unique.set(id, {
      id,
      runId: asText(record.runId) || asText(metadata.runId),
      path: asText(record.path),
      name,
      mimeType: asText(record.mimeType) || "application/octet-stream",
      size: Number.isFinite(sizeValue) ? sizeValue : 0,
      createdAt: asText(record.createdAt) || undefined,
      downloadPath: asText(record.downloadPath) || undefined,
    });
  }
  return Array.from(unique.values());
}

function collectManagedWebArtifacts(input: {
  deliverables: TaskCreationDeliverableArtifact[];
  managedArtifacts: AltusArtifactFile[];
}): AltusArtifactFile[] {
  const unique = new Map<string, AltusArtifactFile>();
  const pushArtifact = (
    pathRaw: string,
    previewType?: AltusArtifactFile["previewType"],
  ) => {
    const path = String(pathRaw || "")
      .trim()
      .replace(/\\/g, "/");
    if (!path) return;
    const resolvedPreviewType =
      previewType || inferManagedArtifactPreviewType(path);
    if (resolvedPreviewType !== "web") return;
    if (unique.has(path)) return;
    unique.set(path, {
      path,
      previewType: "web",
    });
  };

  for (const deliverable of input.deliverables) {
    pushArtifact(deliverable.path);
  }
  for (const artifact of input.managedArtifacts) {
    pushArtifact(artifact.path, artifact.previewType);
  }

  return Array.from(unique.values());
}

function extractManagedPreviewSnapshot(
  metadataRaw: unknown,
): TaskCreationWebsitePreviewSnapshot | null {
  const metadata = toRecord(metadataRaw);
  const raw = toRecord(metadata.previewSnapshot);
  const status = asText(raw.status);
  if (
    raw.kind !== "website_screenshot" ||
    ![
      "captured",
      "capture_unavailable",
      "capture_failed",
      "storage_failed",
    ].includes(status)
  ) {
    return null;
  }
  const source = toRecord(raw.source);
  const portValue = Number(source.port);
  const widthValue = Number(raw.width);
  const heightValue = Number(raw.height);
  return {
    kind: "website_screenshot",
    status: status as TaskCreationWebsitePreviewSnapshot["status"],
    storageKey: asText(raw.storageKey) || undefined,
    mimeType: raw.mimeType === "image/png" ? "image/png" : undefined,
    width: Number.isFinite(widthValue) ? widthValue : undefined,
    height: Number.isFinite(heightValue) ? heightValue : undefined,
    capturedAt: asText(raw.capturedAt) || undefined,
    reasonCode: asText(raw.reasonCode) || undefined,
    message: asText(raw.message) || undefined,
    source: {
      sandboxId: asText(source.sandboxId) || undefined,
      port: Number.isFinite(portValue) ? portValue : undefined,
      url: asText(source.url) || undefined,
      command: asText(source.command) || undefined,
      logPath: asText(source.logPath) || undefined,
    },
  };
}

export function buildManagedCompletionCardItem(input: {
  message: AgentMessage;
  managedArtifactsByRun: Map<string, AltusArtifactFile[]>;
  emittedManagedCompletionRuns: Set<string>;
}): ChatItem | null {
  const { message, managedArtifactsByRun, emittedManagedCompletionRuns } =
    input;
  const metadata = toRecord(message.metadata);
  if (!isManagedExecutionEvent(metadata)) {
    return null;
  }

  const runId = asText(metadata.runId);
  const sessionId = asText(message.sessionId) || asText(metadata.sessionId);
  if (!runId || !sessionId || emittedManagedCompletionRuns.has(runId)) {
    return null;
  }

  const eventType = asText(metadata.eventType).toLowerCase();
  const deliverables = extractManagedDeliverables(metadata);
  const previewSnapshot = extractManagedPreviewSnapshot(metadata);
  const managedArtifacts = managedArtifactsByRun.get(runId) || [];
  const webArtifacts = collectManagedWebArtifacts({
    deliverables,
    managedArtifacts,
  });
  const shouldEmitFromDeliverablesContext = deliverables.length > 0;
  const hasPreviewSnapshot = Boolean(previewSnapshot);
  const isRunCompletedContext =
    message.type === "status_update" && eventType === "run_completed";
  if (
    (shouldEmitFromDeliverablesContext || isRunCompletedContext || hasPreviewSnapshot) &&
    (webArtifacts.length > 0 || hasPreviewSnapshot)
  ) {
    emittedManagedCompletionRuns.add(runId);
    return {
      kind: "managed_artifact_card",
      sessionId,
      runId,
      artifacts: webArtifacts,
      previewSnapshot,
      messageKey: `managed:${runId}:artifact_card`,
    };
  }

  if (deliverables.length > 0) {
    emittedManagedCompletionRuns.add(runId);
    return {
      kind: "managed_deliverable_card",
      sessionId,
      runId,
      deliverables,
      messageKey: `managed:${runId}:deliverable_card`,
    };
  }

  if (!isRunCompletedContext) {
    return null;
  }

  if (webArtifacts.length === 0 && !hasPreviewSnapshot) {
    return null;
  }

  emittedManagedCompletionRuns.add(runId);
  return {
    kind: "managed_artifact_card",
    sessionId,
    runId,
    artifacts: webArtifacts,
    previewSnapshot,
    messageKey: `managed:${runId}:artifact_card`,
  };
}

function parseManagedToolOutputPreview(
  outputPreviewRaw: unknown,
): Record<string, unknown> {
  if (!outputPreviewRaw) return {};
  if (typeof outputPreviewRaw === "string") {
    const trimmed = outputPreviewRaw.trim();
    if (!trimmed) return {};
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return toRecord(parsed);
    } catch {
      return {};
    }
  }
  return toRecord(outputPreviewRaw);
}

function readManagedToolViewProjection(metadataRaw: unknown) {
  const metadata = toRecord(metadataRaw);
  const userView = toRecord(metadata.userView);
  const internalView = toRecord(metadata.internalView);
  return {
    userSummary: asText(userView.summary),
    userPreview: asText(userView.preview),
    userDetail: asText(userView.detail),
    internalDetail: asText(internalView.detail),
  };
}

function readGoogleWorkspaceConfirmation(metadataRaw: unknown) {
  const metadata = toRecord(metadataRaw);
  return toGoogleWorkspaceConfirmationView(
    extractGoogleWorkspaceConfirmationPayload(
      parseManagedToolOutputPreview(metadata.outputPreview),
    ),
  );
}

function readGoogleWorkspaceConfirmationFromOpencodeEvent(input: {
  metadata?: Record<string, unknown>;
  output?: unknown;
  content?: unknown;
  properties?: Record<string, unknown>;
  part?: Record<string, unknown>;
  toolState?: Record<string, unknown>;
}) {
  const payload = extractGoogleWorkspaceConfirmationPayload([
    input.toolState,
    input.part,
    input.properties,
    input.metadata,
    input.output,
    input.content,
  ]);
  return toGoogleWorkspaceConfirmationView(payload);
}

function extractGoogleWorkspaceConfirmationPayload(
  raw: unknown,
): Record<string, unknown> | null {
  const visit = (value: unknown, depth = 0): Record<string, unknown> | null => {
    if (depth > 6 || value == null) return null;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return null;
      try {
        return visit(JSON.parse(trimmed), depth + 1);
      } catch {
        return null;
      }
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item, depth + 1);
        if (found) return found;
      }
      return null;
    }
    if (typeof value !== "object") return null;
    const record = toRecord(value);
    if (
      asText(record.type) === "confirmation_required" &&
      asText(record.confirmationId) &&
      asText(record.toolName)
    ) {
      return record;
    }

    const directKeys = [
      "structuredContent",
      "result",
      "outputPreview",
      "output",
      "content",
      "rawPayload",
      "event",
      "properties",
      "part",
      "state",
      "data",
    ];
    for (const key of directKeys) {
      const found = visit(record[key], depth + 1);
      if (found) return found;
    }

    const contentItems = Array.isArray(record.content) ? record.content : [];
    for (const item of contentItems) {
      const found =
        visit(toRecord(item).text, depth + 1) || visit(item, depth + 1);
      if (found) return found;
    }

    return null;
  };

  return visit(raw);
}

function toGoogleWorkspaceConfirmationView(
  payload: Record<string, unknown> | null,
): GoogleWorkspaceConfirmationView | null {
  const direct = toRecord(payload);
  if (!asText(direct.confirmationId) || !asText(direct.toolName)) return null;
  const summary = toRecord(direct.summary);
  return {
    confirmationId: asText(direct.confirmationId),
    connectorKey: asText(direct.connectorKey),
    toolName: asText(direct.toolName),
    action: asText(summary.action),
    target: asText(summary.target),
    impact: asText(summary.impact),
    parameterSummary: toRecord(summary.parameterSummary),
  };
}

function collectManagedReplayArtifactPaths(
  toolName: string,
  metadataRaw: unknown,
): string[] {
  const metadata = toRecord(metadataRaw);
  const args = toRecord(metadata.arguments);
  const output = parseManagedToolOutputPreview(metadata.outputPreview);
  const paths = new Set<string>();
  const pushPath = (value: unknown) => {
    const path = asText(value).replace(/\\/g, "/");
    if (!path) return;
    paths.add(path);
  };

  if (toolName === "write_file" || toolName === "read_file") {
    pushPath(args.path);
    pushPath(output.path);
  }

  if (
    toolName === "complete_task" &&
    Array.isArray((args as { attachments?: unknown[] }).attachments)
  ) {
    for (const item of (args as { attachments?: unknown[] }).attachments ||
      []) {
      const record = toRecord(item);
      pushPath(record.path);
      pushPath(record.filePath);
    }
  }

  return Array.from(paths);
}

function buildManagedReplayData(messages: AgentMessage[]) {
  const actionsByRun = new Map<string, AltusReplayAction[]>();
  const filesByRun = new Map<string, AltusReplayFile[]>();
  const diffItemsByRun = new Map<string, PreviewDiffItem[]>();
  const actionIndexByRun = new Map<string, Map<string, number>>();
  const fileIndexByRun = new Map<string, Map<string, AltusReplayFile>>();
  const diffIndexByRun = new Map<string, Map<string, PreviewDiffItem>>();

  const ensureActions = (runId: string) => {
    const existing = actionsByRun.get(runId);
    if (existing) return existing;
    const created: AltusReplayAction[] = [];
    actionsByRun.set(runId, created);
    actionIndexByRun.set(runId, new Map<string, number>());
    return created;
  };

  const ensureFiles = (runId: string) => {
    const existing = filesByRun.get(runId);
    if (existing) return existing;
    const created: AltusReplayFile[] = [];
    filesByRun.set(runId, created);
    fileIndexByRun.set(runId, new Map<string, AltusReplayFile>());
    return created;
  };

  const ensureDiffItems = (runId: string) => {
    const existing = diffItemsByRun.get(runId);
    if (existing) return existing;
    const created: PreviewDiffItem[] = [];
    diffItemsByRun.set(runId, created);
    diffIndexByRun.set(runId, new Map<string, PreviewDiffItem>());
    return created;
  };

  const upsertFile = (
    runId: string,
    pathRaw: string,
    sourceToolCallId?: string,
    sourceStepIndex?: number,
  ) => {
    const path = pathRaw.trim().replace(/\\/g, "/");
    if (!path) return;
    const files = ensureFiles(runId);
    const index = fileIndexByRun.get(runId)!;
    if (index.has(path)) {
      const existing = index.get(path)!;
      if (typeof sourceStepIndex === "number") {
        existing.lastSourceStepIndex = sourceStepIndex;
      }
      if (sourceToolCallId) {
        existing.lastSourceToolCallId = sourceToolCallId;
      }
      return;
    }
    const file: AltusReplayFile = {
      path,
      displayName: getFilename(path) || path,
      previewType: inferManagedArtifactPreviewType(path),
      lastSourceToolCallId: sourceToolCallId,
      lastSourceStepIndex: sourceStepIndex,
    };
    files.push(file);
    index.set(path, file);
  };

  const upsertDiffItem = (
    runId: string,
    metadata: Record<string, unknown>,
    action: AltusReplayAction,
    message: AgentMessage,
    eventIndex: number,
  ) => {
    if (action.toolName !== "write_file") return;
    const path = extractManagedArtifactPath(action.toolName, metadata)
      .trim()
      .replace(/\\/g, "/");
    if (!path) return;

    const output = parseManagedToolOutputPreview(metadata.outputPreview);
    const args = toRecord(metadata.arguments);
    const progress = readManagedWriteFileProgress(metadata);
    const rawPreview =
      progress.preview ||
      asText(args.content) ||
      asText(output.content) ||
      asText(output.preview) ||
      asText(output.text);
    const preview = truncateText(rawPreview, 4000).text;
    const byteCount =
      typeof output.bytes === "number" && Number.isFinite(output.bytes)
        ? `${output.bytes}`
        : asText(output.bytes);
    const fallbackDetails = [
      `${i18n.t("homeWorkspace.targetFileLabel")}: ${path}`,
      byteCount ? `Bytes: ${byteCount}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    const diffItems = ensureDiffItems(runId);
    const index = diffIndexByRun.get(runId)!;
    const key = `${action.toolCallId}:${path}`;
    const title = `${action.displayName} · ${getFilename(path) || path}`;
    const item: PreviewDiffItem = {
      id: `managed:${runId}:${action.toolCallId}:${path}`,
      title,
      diff: preview || fallbackDetails || undefined,
      files: [
        {
          file: path,
          before: "",
          after: preview,
          status: "modified",
        },
      ],
      source: "managed.write_file",
      createdAt:
        asText(metadata.createdAt) || asText(metadata.timestamp) || null,
      eventMessageKey: message.messageKey || null,
      relatedMessageKeys: message.messageKey ? [message.messageKey] : [],
      eventIndex,
      relatedEventIndexes: [eventIndex],
      canonicalFile: path,
    };

    if (index.has(key)) {
      Object.assign(index.get(key)!, item);
      return;
    }
    index.set(key, item);
    diffItems.push(item);
  };

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.type !== "executor_event") continue;
    const metadata = toRecord(message.metadata);
    if (!isManagedExecutionEvent(metadata)) continue;
    const runId = asText(metadata.runId);
    if (!runId) continue;
    const eventType = asText(metadata.eventType).toLowerCase();
    if (
      eventType !== "tool_call_started" &&
      eventType !== "tool_call_progress" &&
      eventType !== "tool_call_completed" &&
      eventType !== "tool_call_failed"
    ) {
      continue;
    }

    const toolCallId =
      asText(metadata.toolCallId) ||
      message.messageKey ||
      `${runId}:${eventType}:${index}`;
    const toolName = asText(metadata.toolName) || "tool";
    const actions = ensureActions(runId);
    const actionIndex = actionIndexByRun.get(runId)!;
    let stepIndex = actionIndex.get(toolCallId);
    if (stepIndex === undefined) {
      stepIndex = actions.length;
      actionIndex.set(toolCallId, stepIndex);
      actions.push({
        runId,
        toolCallId,
        stepIndex,
        toolName,
        displayName: getManagedToolDisplayName(toolName),
        status:
          eventType === "tool_call_failed"
            ? "failed"
            : eventType === "tool_call_completed"
              ? "completed"
              : "running",
        summary: formatManagedToolSummary(toolName, metadata),
        detail: formatManagedToolDetail(toolName, metadata),
        internalDetail:
          formatManagedToolInternalDetail(toolName, metadata) || undefined,
        artifactPaths: collectManagedReplayArtifactPaths(toolName, metadata),
      });
    } else {
      const action = actions[stepIndex];
      actions[stepIndex] = {
        ...action,
        status:
          eventType === "tool_call_failed"
            ? "failed"
            : eventType === "tool_call_completed"
              ? "completed"
              : action.status === "completed" || action.status === "failed"
                ? action.status
                : "running",
        summary: formatManagedToolSummary(toolName, metadata),
        detail: formatManagedToolDetail(toolName, metadata),
        internalDetail:
          formatManagedToolInternalDetail(toolName, metadata) || undefined,
        artifactPaths: collectManagedReplayArtifactPaths(toolName, metadata),
      };
    }

    const action = actions[stepIndex];
    for (const path of action.artifactPaths) {
      upsertFile(runId, path, action.toolCallId, action.stepIndex);
    }
    if (eventType === "tool_call_completed") {
      upsertDiffItem(runId, metadata, action, message, index);
    }
  }

  return new Map(
    Array.from(actionsByRun.entries()).map(([runId, actions]) => [
      runId,
      {
        runId,
        actions,
        files: filesByRun.get(runId) || [],
        diffItems: diffItemsByRun.get(runId) || [],
      },
    ]),
  );
}

function inferManagedArtifactPreviewType(
  path: string,
): AltusArtifactFile["previewType"] {
  return /\.(html?)$/i.test(path) ? "web" : "code";
}

export function resolveManagedToolReplayView(
  toolName: string,
): AltusDrawerView {
  if (toolName === "debug_open_page" || toolName === "browser_interact") {
    return "debug";
  }
  if (isManagedDeploymentTool(toolName)) {
    return "deployment";
  }
  return "actions";
}

function isManagedDeploymentTool(toolName: string) {
  return (
    toolName === "deploy_application" ||
    toolName === "redeploy_application" ||
    toolName === "rollback_application_deployment" ||
    toolName === "get_application_deployment_status"
  );
}

function readManagedDeploymentToolOutput(metadataRaw: unknown) {
  const metadata = toRecord(metadataRaw);
  const output = parseManagedToolOutputPreview(metadata.outputPreview);
  const repair = toRecord(output.repair);
  return {
    action: asText(output.action),
    phase: asText(output.phase),
    status: asText(output.status),
    summary: asText(output.summary),
    deploymentStatus: asText(output.deploymentStatus),
    url: asText(output.url),
    deploymentId: asText(output.deploymentId),
    repairCategory: asText(repair.category),
  };
}

function buildManagedBrowserInteractPurpose(args: Record<string, unknown>) {
  const action = asText(args.action).toLowerCase();
  const description = asText(args.description);
  if (description) return description;
  const selector = asText(args.selector);
  const text = asText(args.text);
  const key = asText(args.key);
  const direction = asText(args.direction).toLowerCase() || "down";
  const loadState = asText(args.loadState) || "domcontentloaded";
  const pixelsRaw = Number(args.pixels);
  const target = text || selector;

  if (action === "locator_click") {
    return selector ? `点击 ${selector}` : "点击页面元素";
  }
  if (action === "text_click") {
    return text ? `点击 ${text}` : "点击指定文本";
  }
  if (action === "coordinate_click") {
    return "点击页面指定位置";
  }
  if (action === "locator_fill") {
    if (selector && text) return `在 ${selector} 输入“${text}”`;
    return selector ? `填写 ${selector}` : "填写表单输入框";
  }
  if (action === "keyboard_type") {
    return text ? `键盘输入“${text}”` : "键盘输入文本";
  }
  if (action === "keyboard_press") {
    return key ? `按下 ${key} 键` : "按下键盘按键";
  }
  if (action === "mouse_wheel") {
    const directionLabel =
      direction === "up"
        ? "向上滚动"
        : direction === "left"
          ? "向左滚动"
          : direction === "right"
            ? "向右滚动"
            : "向下滚动";
    return Number.isFinite(pixelsRaw) && pixelsRaw > 0
      ? `${directionLabel} ${Math.floor(pixelsRaw)} 像素`
      : directionLabel;
  }
  if (action === "wait_for_locator") {
    return selector ? `等待 ${selector} 可见` : "等待页面元素可见";
  }
  if (action === "wait_for_text") {
    return text ? `等待页面出现“${text}”` : "等待页面出现指定内容";
  }
  if (action === "wait_for_load_state") {
    return `等待页面进入 ${loadState} 状态`;
  }
  if (action === "wait_for_timeout") {
    return "等待页面稳定";
  }
  return target ? `执行 Playwright 操作：${target}` : "执行 Playwright 浏览器操作";
}

export function getManagedToolPurposeSummary(
  toolName: string,
  metadataRaw: unknown,
) {
  const metadata = toRecord(metadataRaw);
  const args = toRecord(metadata.arguments);
  const output = parseManagedToolOutputPreview(metadata.outputPreview);
  const progress = readManagedWriteFileProgress(metadata);
  const path = asText(args.path) || asText(output.path) || progress.path;
  const command = asText(args.command);
  const query = asText(args.query);
  const target = asText(args.path) || asText(output.path);
  const filename = path ? getFilename(path) || path : "";

  if (toolName === "shell_execute") {
    if (/pnpm|npm|yarn|tsc|typecheck|type-check|check|test|vitest|playwright/i.test(command)) {
      return "检查项目是否正常运行";
    }
    if (/ls|find|tree|pwd|cat|sed|tail|head|rg|grep/i.test(command)) {
      return "检查项目文件和运行日志";
    }
    if (/dev|serve|preview|start|node|vite/i.test(command)) {
      return "启动或检查本地预览服务";
    }
    return "执行项目命令";
  }

  if (toolName === "write_file") {
    if (filename) return `更新${filename}`;
    return "更新项目文件";
  }

  if (toolName === "read_file") {
    if (filename) return `读取${filename}检查内容`;
    return "读取项目文件";
  }

  if (toolName === "list_directory") {
    if (target) return "检查项目目录结构";
    return "查看项目目录";
  }

  if (toolName === "search_code") {
    if (query) return "搜索相关代码位置";
    return "搜索项目代码";
  }

  if (toolName === "todowrite") {
    const todos = readManagedTodoItems(metadataRaw);
    const activeTodo = todos.find((todo) => todo.status === "in_progress");
    if (activeTodo) return activeTodo.activeForm || activeTodo.content;
    return "更新任务清单";
  }

  if (toolName === "browser_interact") {
    return buildManagedBrowserInteractPurpose(args);
  }

  if (toolName === "ask_user") {
    return "请求补充必要信息";
  }

  if (isManagedDeploymentTool(toolName)) {
    const projectedView = readManagedToolViewProjection(metadata);
    const deploymentOutput = readManagedDeploymentToolOutput(metadata);
    if (projectedView.userSummary) return projectedView.userSummary;
    if (deploymentOutput.summary) return deploymentOutput.summary;
    if (toolName === "get_application_deployment_status") return "检查部署状态";
    if (toolName === "rollback_application_deployment") return "回滚部署版本";
    if (toolName === "redeploy_application") return "重新部署应用";
    return "部署应用";
  }

  if (toolName === "complete_task") {
    return "完成任务并整理结果";
  }

  return getManagedToolDisplayName(toolName);
}

function extractManagedArtifactPath(
  toolName: string,
  metadataRaw: unknown,
): string {
  if (toolName !== "write_file") return "";
  const metadata = toRecord(metadataRaw);
  const args = toRecord(metadata.arguments);
  const output = parseManagedToolOutputPreview(metadata.outputPreview);
  return asText(args.path) || asText(output.path);
}

function getManagedToolDisplayName(toolName: string) {
  switch (toolName) {
    case "shell_execute":
      return i18n.t("homeWorkspace.commandExecution");
    case "todowrite":
      return i18n.t("homeWorkspace.todo");
    case "write_file":
      return i18n.t("homeWorkspace.writeFile");
    case "read_file":
      return i18n.t("homeWorkspace.readFile");
    case "list_directory":
      return i18n.t("homeWorkspace.listDirectory");
    case "search_code":
      return i18n.t("homeWorkspace.codeSearch");
    case "ask_user":
      return i18n.t("homeWorkspace.requestClarification");
    case "debug_open_page":
      return i18n.t("replayDrawer.tabs.debug");
    case "browser_interact":
      return "浏览器操作";
    case "deploy_application":
      return i18n.t("homeWorkspace.deployApplication");
    case "redeploy_application":
      return i18n.t("homeWorkspace.redeployApplication");
    case "rollback_application_deployment":
      return i18n.t("homeWorkspace.rollbackDeployment");
    case "get_application_deployment_status":
      return i18n.t("homeWorkspace.deploymentStatus");
    case "complete_task":
      return i18n.t("homeWorkspace.completeTask");
    default:
      return toolName || i18n.t("homeWorkspace.toolCall");
  }
}

export function shouldExpandManagedWriteFileCard(input: {
  toolName: string;
  status: string;
  metadataRaw?: unknown;
  metadata?: unknown;
}) {
  if (input.toolName !== "write_file") return false;
  if (input.status !== "running") return false;
  const metadata = toRecord(input.metadataRaw ?? input.metadata);
  const progress = toRecord(metadata.writeFileProgress);
  const generatedCharsRaw = progress.generatedChars;
  const generatedChars =
    typeof generatedCharsRaw === "number" && Number.isFinite(generatedCharsRaw)
      ? generatedCharsRaw
      : typeof generatedCharsRaw === "string" && generatedCharsRaw.trim()
        ? Number(generatedCharsRaw)
        : 0;
  const preview = asText(progress.preview);
  return generatedChars > 0 || Boolean(preview);
}

function readManagedWriteFileProgress(metadataRaw: unknown) {
  const metadata = toRecord(metadataRaw);
  const progress = toRecord(metadata.writeFileProgress);
  const path = asText(progress.path);
  const generatedCharsRaw = progress.generatedChars;
  const generatedChars =
    typeof generatedCharsRaw === "number" && Number.isFinite(generatedCharsRaw)
      ? Math.max(0, Math.floor(generatedCharsRaw))
      : typeof generatedCharsRaw === "string" && generatedCharsRaw.trim()
        ? Math.max(0, Math.floor(Number(generatedCharsRaw)))
        : 0;
  const preview = asText(progress.preview);
  return {
    path,
    generatedChars,
    preview,
  };
}

function readManagedTodoItems(metadataRaw: unknown) {
  const metadata = toRecord(metadataRaw);
  const args = toRecord(metadata.arguments);
  const output = parseManagedToolOutputPreview(metadata.outputPreview);
  const normalize = (raw: unknown) =>
    Array.isArray(raw)
      ? raw
          .map((item) => {
            const record = toRecord(item);
            const content = asText(record.content);
            const status = asText(record.status);
            const activeForm = asText(record.activeForm);
            if (!content || !status) return null;
            return {
              content,
              status,
              ...(activeForm ? { activeForm } : {}),
            };
          })
          .filter(
            (
              item,
            ): item is {
              content: string;
              status: string;
              activeForm?: string;
            } => Boolean(item),
          )
      : [];
  const argsTodos = normalize(args.todos);
  return argsTodos.length > 0 ? argsTodos : normalize(output.todos);
}

function getTodoStatusLabel(status: string) {
  return status === "completed"
    ? i18n.t("homeWorkspace.completed")
    : status === "in_progress"
      ? i18n.t("homeWorkspace.inProgress")
      : i18n.t("homeWorkspace.pending");
}

function getTodoStatusTone(status: string) {
  if (status === "completed") {
    return "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-200";
  }
  if (status === "in_progress") {
    return "border-[var(--brand-border)] bg-[var(--brand-soft)] text-[var(--brand-soft-foreground)]";
  }
  return "border-border bg-muted/50 text-muted-foreground";
}

function formatManagedToolSummary(toolName: string, metadataRaw: unknown) {
  const metadata = toRecord(metadataRaw);
  const args = toRecord(metadata.arguments);
  const writeFileProgress = readManagedWriteFileProgress(metadata);
  const deploymentOutput = readManagedDeploymentToolOutput(metadata);
  const projectedView = readManagedToolViewProjection(metadata);
  const googleConfirmation = readGoogleWorkspaceConfirmation(metadata);
  if (googleConfirmation) {
    const connectorLabel = getMcpConfirmationConnectorLabel(
      googleConfirmation.connectorKey,
    );
    return `等待确认 ${connectorLabel} 高风险操作`;
  }
  if (toolName === "shell_execute") {
    return asText(args.command) || i18n.t("homeWorkspace.executeShellCommand");
  }
  if (toolName === "write_file") {
    const path = asText(args.path) || writeFileProgress.path;
    if (writeFileProgress.generatedChars > 0) {
      return [
        path || i18n.t("homeWorkspace.writeFile"),
        i18n.t("homeWorkspace.generatingCharsLabel", {
          count: writeFileProgress.generatedChars,
        }),
      ]
        .filter(Boolean)
        .join(" · ");
    }
    return path || i18n.t("homeWorkspace.writeFile");
  }
  if (toolName === "read_file") {
    return asText(args.path) || i18n.t("homeWorkspace.readFile");
  }
  if (toolName === "list_directory") {
    return asText(args.path) || i18n.t("homeWorkspace.listDirectory");
  }
  if (toolName === "search_code") {
    const query = asText(args.query);
    const target = asText(args.path);
    return [query, target ? `@ ${target}` : ""].filter(Boolean).join(" ");
  }
  if (toolName === "todowrite") {
    const todos = readManagedTodoItems(metadataRaw);
    const activeTodo = todos.find((item) => item.status === "in_progress");
    if (activeTodo) {
      return activeTodo.activeForm || activeTodo.content;
    }
    if (todos.length > 0) {
      return i18n.t("homeWorkspace.tasksProgress", {
        completed: todos.filter((item) => item.status === "completed").length,
        total: todos.length,
      });
    }
    return i18n.t("homeWorkspace.todo");
  }
  if (toolName === "ask_user") {
    return (
      asText(args.question) || i18n.t("homeWorkspace.requestUserClarification")
    );
  }
  if (isManagedDeploymentTool(toolName)) {
    if (projectedView.userSummary) {
      return projectedView.userSummary;
    }
    if (deploymentOutput.status === "retryable_repair_required") {
      return i18n.t("homeWorkspace.fixingDeploymentConfig");
    }
    if (deploymentOutput.summary) {
      return deploymentOutput.summary;
    }
    if (toolName === "deploy_application") {
      return i18n.t("homeWorkspace.preparingDeployment");
    }
    if (toolName === "redeploy_application") {
      return i18n.t("homeWorkspace.preparingRedeployment");
    }
    if (toolName === "rollback_application_deployment") {
      return i18n.t("homeWorkspace.preparingRollback");
    }
    return i18n.t("homeWorkspace.checkDeploymentStatus");
  }
  if (toolName === "complete_task") {
    return (
      asText(args.summary) || i18n.t("homeWorkspace.finalCompletionSummary")
    );
  }
  return asText(metadata.content) || toolName;
}

function formatManagedToolPreview(toolName: string, metadataRaw: unknown) {
  const metadata = toRecord(metadataRaw);
  const args = toRecord(metadata.arguments);
  const output = parseManagedToolOutputPreview(metadata.outputPreview);
  const writeFileProgress = readManagedWriteFileProgress(metadata);
  const error = asText(metadata.error);
  const deploymentOutput = readManagedDeploymentToolOutput(metadata);
  const projectedView = readManagedToolViewProjection(metadata);
  const googleConfirmation = readGoogleWorkspaceConfirmation(metadata);

  if (googleConfirmation) {
    const connectorLabel = getMcpConfirmationConnectorLabel(
      googleConfirmation.connectorKey,
    );
    return [
      "确认高风险 MCP 操作",
      `连接器：${connectorLabel}`,
      googleConfirmation.target ? `目标：${googleConfirmation.target}` : "",
      googleConfirmation.action ? `动作：${googleConfirmation.action}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (error) {
    if (isManagedDeploymentTool(toolName)) {
      return (
        projectedView.userPreview ||
        i18n.t("homeWorkspace.deploymentNotFinished")
      );
    }
    return error;
  }

  if (toolName === "shell_execute") {
    const stdout = asText(output.stdout);
    const stderr = asText(output.stderr);
    return (
      stdout ||
      stderr ||
      asText(args.command) ||
      i18n.t("homeWorkspace.executeCommand")
    );
  }

  if (toolName === "write_file") {
    if (writeFileProgress.preview) {
      return writeFileProgress.preview;
    }
    const bytes = asText(output.bytes);
    return bytes
      ? i18n.t("homeWorkspace.wroteBytes", { bytes })
      : asText(output.path) || i18n.t("homeWorkspace.wroteTargetFile");
  }

  if (toolName === "read_file") {
    return (
      asText(output.content) ||
      asText(output.path) ||
      i18n.t("homeWorkspace.readTargetFile")
    );
  }

  if (toolName === "list_directory") {
    return (
      asText(output.output) ||
      asText(output.path) ||
      i18n.t("homeWorkspace.returnedDirectoryContent")
    );
  }

  if (toolName === "search_code") {
    return (
      asText(output.output) ||
      asText(args.query) ||
      i18n.t("homeWorkspace.returnedSearchResults")
    );
  }
  if (toolName === "todowrite") {
    const todos = readManagedTodoItems(metadataRaw);
    if (todos.length === 0) {
      return i18n.t("homeWorkspace.todo");
    }
    return todos
      .map((item) => `[${getTodoStatusLabel(item.status)}] ${item.content}`)
      .join("\n");
  }

  if (isManagedDeploymentTool(toolName)) {
    if (projectedView.userPreview) {
      return projectedView.userPreview;
    }
    if (deploymentOutput.status === "retryable_repair_required") {
      return i18n.t("homeWorkspace.deploymentConfigIssueRetrying");
    }
    if (deploymentOutput.url) {
      return i18n.t("homeWorkspace.visitUrl", { url: deploymentOutput.url });
    }
    if (deploymentOutput.summary) {
      return deploymentOutput.summary;
    }
    if (toolName === "get_application_deployment_status") {
      return i18n.t("homeWorkspace.returnedDeploymentStatus");
    }
    return i18n.t("homeWorkspace.platformProcessingDeployment");
  }

  if (toolName === "complete_task") {
    return asText(args.summary) || i18n.t("homeWorkspace.taskDone");
  }

  return asText(metadata.outputPreview) || asText(metadata.content);
}

function formatManagedToolInternalDetail(
  toolName: string,
  metadataRaw: unknown,
) {
  if (!isManagedDeploymentTool(toolName)) return "";
  const projectedView = readManagedToolViewProjection(metadataRaw);
  return projectedView.internalDetail;
}

function formatManagedToolDetail(toolName: string, metadataRaw: unknown) {
  const metadata = toRecord(metadataRaw);
  const args = toRecord(metadata.arguments);
  const output = parseManagedToolOutputPreview(metadata.outputPreview);
  const writeFileProgress = readManagedWriteFileProgress(metadata);
  const error = asText(metadata.error);
  const deploymentOutput = readManagedDeploymentToolOutput(metadata);
  const projectedView = readManagedToolViewProjection(metadata);
  const googleConfirmation = readGoogleWorkspaceConfirmation(metadata);
  const lines: string[] = [];
  const pushLine = (label: string, value: unknown) => {
    const text = asText(value);
    if (text) {
      lines.push(`${label}: ${text}`);
    }
  };

  if (toolName === "complete_task") {
    const blocks: string[] = [];
    const summary = asText(args.summary);
    if (summary) {
      blocks.push(summary);
    }
    if (Array.isArray(args.verification)) {
      const checks = (args.verification as unknown[])
        .map((item) => asText(item))
        .filter(Boolean);
      if (checks.length > 0) {
        blocks.push(
          [
            `${i18n.t("homeWorkspace.verificationLabel")}:`,
            "",
            checks.map((item) => `- ${item.replace(/\n/g, "\n  ")}`).join("\n"),
          ].join("\n"),
        );
      }
    }
    if (error) {
      blocks.push(`${i18n.t("homeWorkspace.failureReasonLabel")}:\n\n${error}`);
    }
    return (
      blocks.join("\n\n").trim() || formatManagedToolSummary(toolName, metadata)
    );
  }

  if (googleConfirmation) {
    const connectorLabel = getMcpConfirmationConnectorLabel(
      googleConfirmation.connectorKey,
    );
    return [
      "确认高风险 MCP 操作",
      `Connector: ${connectorLabel}`,
      `Tool: ${googleConfirmation.toolName || toolName}`,
      googleConfirmation.confirmationId ? `Confirmation: ${googleConfirmation.confirmationId}` : "",
      googleConfirmation.action ? `动作: ${googleConfirmation.action}` : "",
      googleConfirmation.target ? `目标: ${googleConfirmation.target}` : "",
      googleConfirmation.impact ? `影响: ${googleConfirmation.impact}` : "",
      "确认只覆盖本次同参数 tool call，不会长期放行后续操作。",
    ]
      .filter(Boolean)
      .join("\n");
  }

  lines.push(
    `${i18n.t("homeWorkspace.toolLabel")}: ${getManagedToolDisplayName(toolName)} (${toolName})`,
  );

  if (toolName === "shell_execute") {
    pushLine(i18n.t("homeWorkspace.commandLabel"), args.command);
    pushLine(i18n.t("homeWorkspace.directoryLabel"), output.cwd || args.cwd);
    pushLine(i18n.t("homeWorkspace.exitCodeLabel"), output.exitCode);
    pushLine(i18n.t("homeWorkspace.outputLabel"), output.stdout);
    pushLine(i18n.t("homeWorkspace.errorOutputLabel"), output.stderr);
  } else if (toolName === "write_file") {
    pushLine(
      i18n.t("homeWorkspace.targetFileLabel"),
      args.path || output.path || writeFileProgress.path,
    );
    pushLine(
      i18n.t("homeWorkspace.generatedCharsField"),
      writeFileProgress.generatedChars > 0
        ? String(writeFileProgress.generatedChars)
        : "",
    );
    pushLine(
      i18n.t("homeWorkspace.codePreviewLabel"),
      writeFileProgress.preview,
    );
    pushLine(i18n.t("homeWorkspace.writeSizeLabel"), output.bytes);
  } else if (toolName === "read_file") {
    pushLine(i18n.t("homeWorkspace.targetFileLabel"), args.path || output.path);
    pushLine(i18n.t("homeWorkspace.contentPreviewLabel"), output.content);
  } else if (toolName === "list_directory") {
    pushLine(
      i18n.t("homeWorkspace.targetDirectoryLabel"),
      args.path || output.path,
    );
    pushLine(
      i18n.t("homeWorkspace.recursionDepthLabel"),
      output.depth || args.depth,
    );
    pushLine(i18n.t("homeWorkspace.resultPreviewLabel"), output.output);
  } else if (toolName === "search_code") {
    pushLine(i18n.t("homeWorkspace.searchQueryLabel"), args.query);
    pushLine(
      i18n.t("homeWorkspace.searchScopeLabel"),
      args.path || output.path,
    );
    pushLine(i18n.t("homeWorkspace.resultPreviewLabel"), output.output);
  } else if (toolName === "todowrite") {
    const todos = readManagedTodoItems(metadataRaw);
    pushLine(
      i18n.t("homeWorkspace.summaryLabel"),
      formatManagedToolSummary(toolName, metadata),
    );
    todos.forEach((todo, index) => {
      lines.push(`${index + 1}. [${getTodoStatusLabel(todo.status)}] ${todo.content}`);
    });
  } else if (isManagedDeploymentTool(toolName)) {
    if (projectedView.userDetail) {
      return projectedView.userDetail;
    }
    pushLine(
      i18n.t("homeWorkspace.phaseLabel"),
      deploymentOutput.phase || (error ? "failed" : "running"),
    );
    pushLine(
      i18n.t("homeWorkspace.statusLabel"),
      deploymentOutput.status || deploymentOutput.deploymentStatus,
    );
    pushLine(i18n.t("homeWorkspace.summaryLabel"), deploymentOutput.summary);
    pushLine(i18n.t("homeWorkspace.accessUrlLabel"), deploymentOutput.url);
    pushLine(
      i18n.t("homeWorkspace.deploymentIdLabel"),
      deploymentOutput.deploymentId,
    );
    if (deploymentOutput.status === "retryable_repair_required") {
      pushLine(
        i18n.t("homeWorkspace.handlingLabel"),
        i18n.t("homeWorkspace.altusRetryingRepair"),
      );
    } else if (error || deploymentOutput.status === "fatal_error") {
      pushLine(
        i18n.t("homeWorkspace.handlingLabel"),
        i18n.t("homeWorkspace.internalDebugLogged"),
      );
    }
  } else if (toolName === "ask_user") {
    pushLine(i18n.t("homeWorkspace.questionLabel"), args.question);
    if (Array.isArray(args.options)) {
      const options = (args.options as unknown[])
        .map((item) => asText(item))
        .filter(Boolean)
        .join(" / ");
      pushLine(i18n.t("homeWorkspace.suggestedOptionsLabel"), options);
    }
  } else {
    pushLine(i18n.t("homeWorkspace.summaryLabel"), asText(metadata.content));
  }

  if (error) {
    pushLine(
      i18n.t("homeWorkspace.failureReasonLabel"),
      isManagedDeploymentTool(toolName)
        ? i18n.t("homeWorkspace.deploymentPending")
        : error,
    );
  }

  if (lines.length === 1) {
    pushLine(
      i18n.t("homeWorkspace.summaryLabel"),
      formatManagedToolSummary(toolName, metadata),
    );
  }

  return lines.join("\n");
}
