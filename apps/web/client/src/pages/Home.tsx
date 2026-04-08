/**
 * Design Philosophy: Swiss International Style + Digital Minimalism
 * - Centered content with clear hierarchy
 * - Consistent input experience across pages
 * - 支持对话模式和任务创建智能体
 */

import { useState, useRef, useEffect, useMemo, type KeyboardEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import WorkspaceLayout from "@/components/WorkspaceLayout";
import ProjectDetail from "./ProjectDetail";
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
  ChevronDown,
  ChevronRight,
  Trash2,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import TaskRuntimeDrawer from "@/components/TaskRuntimeDrawer";
import OpencodePreviewPanel from "@/components/OpencodePreviewPanel";
import AltusArtifactPreviewCard, {
  type AltusArtifactFile,
} from "@/components/AltusArtifactPreviewCard";
import TaskDeliverableCard from "@/components/TaskDeliverableCard";
import AltusRunReplayDrawer, {
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
import { buildPreviewItems, extractDiffPayload } from "@/lib/opencode-preview";
import {
  deployTaskCreationSession,
  getWorkspaceRawFileUrl,
  listTaskCreationSkills,
  uploadTaskCreationAttachment,
  type TaskCreationDeliverableArtifact,
  type TaskCreationPlatformSkill,
  type TaskCreationUploadedAttachment as UploadedTaskAttachment,
} from "@/lib/task-creation-client";
import { getMyConnectorAccounts } from "@/lib/connectors-client";
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
import { resolveUserMessageReferences } from "@/lib/message-reference-parser";
import { useLocation, useSearch } from "wouter";
import { Streamdown } from "streamdown";

type PageMode = "input" | "chat";
type PersistedMessageScrollAnchor = {
  anchorMessageKey: string | null;
  anchorOffsetTop: number;
  scrollTop: number;
  savedAt: number;
};

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

function escapeMessageKeySelector(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, "\\$&");
}

function readAltusMode(): "sandbox" | "managed" {
  if (typeof window === "undefined") return "sandbox";
  try {
    return window.localStorage.getItem("altus_mode") === "managed" ? "managed" : "sandbox";
  } catch {
    return "sandbox";
  }
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

export default function Home() {
  const MESSAGE_SCROLL_CACHE_PREFIX = "task_creation_history_scroll:";
  const [location] = useLocation();
  const search = useSearch();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const [mode, setMode] = useState<PageMode>("input");
  const [message, setMessage] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [composerReferences, setComposerReferences] = useState<
    ComposerReferenceToken[]
  >([]);
  const [slashSkillCatalog, setSlashSkillCatalog] = useState<
    TaskCreationPlatformSkill[]
  >([]);
  const [slashMcpCatalog, setSlashMcpCatalog] = useState<
    Array<{ key: string; name: string; category: string }>
  >(
    [],
  );
  const [slashCatalogLoaded, setSlashCatalogLoaded] = useState(false);
  const [slashCatalogLoading, setSlashCatalogLoading] = useState(false);
  const [slashCatalogError, setSlashCatalogError] = useState<string | null>(null);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [showRuntimeDrawer, setShowRuntimeDrawer] = useState(false);
  const [altusReplayOpen, setAltusReplayOpen] = useState(false);
  const [altusReplayRunId, setAltusReplayRunId] = useState<string | null>(null);
  const [altusReplayView, setAltusReplayView] = useState<"actions" | "files">(
    "actions",
  );
  const [altusReplayIndex, setAltusReplayIndex] = useState(0);
  const [pendingAltusReplayToolCallId, setPendingAltusReplayToolCallId] =
    useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState("Agent Pro");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewMaximized, setPreviewMaximized] = useState(false);
  const [previewWorkspacePath, setPreviewWorkspacePath] = useState<string | null>(
    null,
  );
  const [previewTab, setPreviewTab] = useState<
    "files" | "changes" | "debug" | "deployment"
  >("files");
  const [selectedDiffId, setSelectedDiffId] = useState<string | null>(null);
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
    ensureSession,
    loadOlderHistory,
  } = useTaskCreationAgent({
    autoRuntime: !isHistoryView,
    compactHistory: false,
    runtimeLogPollingEnabled: showRuntimeDrawer,
    onPlanGenerated: (plan) => {
      console.log("计划生成:", plan);
      // TODO: 跳转到项目详情页面或更新左侧项目列表
    },
    onError: (error) => {
      console.error("任务创建失败:", error);
    },
  });

  const slashQuery = useMemo(() => parseTrailingSlashQuery(message), [message]);

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
                Boolean(item && typeof item === "object" && "connectorKey" in item),
            )
          : [];
        const catalogByKey = new Map(
          catalog.map((item) => [item.key, item] as const),
        );
        const nextMcpCatalog = accounts
          .filter((item) => {
            if (item.authStatus !== "authorized") return false;
            const catalogItem = catalogByKey.get(item.connectorKey);
            return Boolean(catalogItem?.available) && catalogItem?.category === "custom_mcp";
          })
          .map((item) => ({
            key: item.connectorKey,
            name: catalogByKey.get(item.connectorKey)?.name || item.connectorKey,
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
            : "引用项加载失败",
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
        if (keyword && !name.includes(keyword) && !slug.includes(keyword)) continue;
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
        if (keyword && !name.includes(keyword) && !key.includes(keyword)) continue;
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

  // 从根页面跳转到 /new-task?q=... 时，自动进入聊天态并发送首条消息
  useEffect(() => {
    const params = new URLSearchParams(search);
    const input = params.get("q")?.trim();
    const sessionInQuery = sessionIdFromPath || params.get("sessionId")?.trim();
    const createNewToken = params.get("new")?.trim();

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
    const shouldLockViewport = !selectedProjectId && mode === "chat";
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
  }, [mode, selectedProjectId]);

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
    setComposerReferences((prev) => prev.filter((item) => item.id !== token.id));
    setMessage((prev) => `${prev}${prev.endsWith(" ") || !prev ? "" : " "}${token.queryText} `);
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
          suggestionCount > 0 ? (prev - 1 + suggestionCount) % suggestionCount : 0,
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

    if (event.key === "Backspace" && !message && composerReferences.length > 0) {
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
    const displayText = trimmed || (hasAttachments || hasReferences ? "已添加引用" : "");
    const baseText =
      trimmed ||
      (hasAttachments
        ? DEFAULT_ATTACHMENT_PROMPT
        : hasReferences
          ? "请基于我刚刚引用的能力继续处理。"
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
      const selectedMcp = referenceDrafts
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
      let activeSessionId = (sessionId || "").trim();
      if (altusMode !== "managed" && uploadableAttachments.length > 0 && !activeSessionId) {
        activeSessionId = await ensureSession(displayText || "新建任务会话");
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
        await sendChatInput(
          baseText,
          {
            sessionId: activeSessionId || undefined,
            metadata: hasAttachments
              ? {
                  ...(mergedSkills.length ? { skills: mergedSkills } : {}),
                  ...(selectedMcp.length ? { mcpReferences: selectedMcp } : {}),
                  originalInput: displayText,
                }
              : selectedMcp.length
                ? {
                    mcpReferences: selectedMcp,
                    originalInput: displayText,
                  }
                : undefined,
            files: uploadableAttachments.map((item) => item.file),
          },
        );
      } else {
        await sendChatInput(
          appendAttachmentsToPrompt(baseText, uploadedAttachments),
          {
            sessionId: activeSessionId || undefined,
            metadata: uploadedAttachments.length || mergedSkills.length
              ? {
                  ...(uploadedAttachments.length ? { attachments: uploadedAttachments } : {}),
                  ...(mergedSkills.length ? { skills: mergedSkills } : {}),
                  ...(selectedMcp.length ? { mcpReferences: selectedMcp } : {}),
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
        const draftSkills = attachmentDrafts.filter((item) => item.kind === "skill");
        setAttachments((current) => {
          const mergedFiles = mergePendingAttachments(current, draftFiles).attachments;
          return mergePendingPlatformSkills(mergedFiles, draftSkills);
        });
      }
      if (hasReferences) {
        setComposerReferences(referenceDrafts);
      }
      toast.error(error instanceof Error ? error.message : "附件发送失败");
    }
  }

  const handleSend = () => {
    if (!message.trim() && attachments.length === 0 && composerReferences.length === 0) return;
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
      toast.error(text || "停止执行失败");
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
    const displayText = trimmed || (hasAttachments || hasReferences ? "已添加引用" : "");
    const baseText =
      trimmed ||
      (hasAttachments
        ? DEFAULT_ATTACHMENT_PROMPT
        : hasReferences
          ? "请基于我刚刚引用的能力继续处理。"
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
      const selectedMcp = referenceDrafts
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
      let uploadedAttachments: UploadedTaskAttachment[] = [];
      if (altusMode !== "managed" && uploadableAttachments.length > 0 && activeSessionId) {
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
          metadata: hasAttachments
            ? {
                ...(mergedSkills.length ? { skills: mergedSkills } : {}),
                ...(selectedMcp.length ? { mcpReferences: selectedMcp } : {}),
                originalInput: displayText,
              }
            : selectedMcp.length
              ? {
                  mcpReferences: selectedMcp,
                  originalInput: displayText,
                }
              : undefined,
          files: uploadableAttachments.length
            ? uploadableAttachments.map((item) => item.file)
            : undefined,
        });
      } else {
        await answerQuestion(
          appendAttachmentsToPrompt(baseText, uploadedAttachments),
          {
            sessionId: activeSessionId,
            metadata: uploadedAttachments.length || mergedSkills.length
              ? {
                  ...(uploadedAttachments.length ? { attachments: uploadedAttachments } : {}),
                  ...(mergedSkills.length ? { skills: mergedSkills } : {}),
                  ...(selectedMcp.length ? { mcpReferences: selectedMcp } : {}),
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
        const draftSkills = attachmentDrafts.filter((item) => item.kind === "skill");
        setAttachments((current) => {
          const mergedFiles = mergePendingAttachments(current, draftFiles).attachments;
          return mergePendingPlatformSkills(mergedFiles, draftSkills);
        });
      }
      if (hasReferences) {
        setComposerReferences(referenceDrafts);
      }
      toast.error(error instanceof Error ? error.message : "附件发送失败");
    }
  }

  const handleAnswerQuestion = (answer: string) => {
    void submitQuestionAnswer(answer);
  };

  const quickActions = [
    { label: "我想做一个Python开发行业的市场调研", icon: "📊" },
    { label: "帮我分析竞争对手的产品策略", icon: "📄" },
    { label: "创建一个新产品的营销计划", icon: "🎨" },
    { label: "生成季度业务报告", icon: "💻" },
  ];

  const chatItems = useMemo(() => collapseRepeatedChatAuthors(buildChatItems(messages)), [messages]);
  const managedReplayByRun = useMemo(
    () => buildManagedReplayData(messages),
    [messages],
  );
  const { diffItems } = useMemo(() => buildPreviewItems(messages), [messages]);
  const hasSendDraft =
    Boolean(message.trim()) || attachments.length > 0 || composerReferences.length > 0;
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
                    <span className="block truncate font-semibold">{item.label}</span>
                    <span className="block truncate text-xs opacity-80">{item.subLabel}</span>
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
                    <span className="block truncate font-semibold">{item.label}</span>
                    <span className="block truncate text-xs opacity-80">{item.subLabel}</span>
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
          ? "正在加载引用项..."
          : slashCatalogError
            ? `引用项加载失败：${slashCatalogError}`
            : `未找到可引用项（skills: ${slashSkillCatalog.length}，connectors: ${slashMcpCatalog.length}），试试 /xxx-skills 或先在连接器里完成 MCP 授权`}
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

  const openDiffPreview = (options?: {
    diffId?: string | null;
    filePath?: string | null;
    messageIndex?: number | null;
  }) => {
    setPreviewWorkspacePath(null);
    setPreviewTab("changes");
    setPreviewOpen(true);
    const target =
      pickExistingDiffId(options?.diffId) ||
      pickExistingDiffId(findDiffIdForMessageIndex(options?.messageIndex)) ||
      pickExistingDiffId(findDiffIdForFile(options?.filePath || null)) ||
      diffItems[diffItems.length - 1]?.id ||
      null;
    setSelectedDiffId(target);
  };

  const openWorkspacePreview = (path: string) => {
    const normalizedPath = String(path || "").trim().replace(/\\/g, "/");
    if (!normalizedPath) return;
    setPreviewWorkspacePath(normalizedPath);
    setPreviewTab("files");
    setPreviewOpen(true);
  };

  const deployFromArtifactCard = async (_path: string) => {
    if (!sessionId) {
      toast.error("缺少会话信息");
      return;
    }

    try {
      const result = await deployTaskCreationSession(sessionId);
      setPreviewWorkspacePath(null);
      setPreviewTab("deployment");
      setPreviewOpen(true);

      const deploymentUrl = result?.latestStaticUrl || result?.latestUrl || "";
      if (deploymentUrl) {
        toast.success(
          `已触发部署：${deploymentUrl.replace(/^https?:\/\//, "")}`,
        );
      } else {
        toast.success("已触发部署");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "触发部署失败");
      throw error;
    }
  };

  const showDesktopPreview = previewOpen && !isMobile;
  const showMobilePreview = previewOpen && isMobile;
  const activeAltusReplay =
    altusReplayRunId ? managedReplayByRun.get(altusReplayRunId) || null : null;
  const activeAltusReplayIndex =
    activeAltusReplay && activeAltusReplay.actions.length > 0
      ? Math.min(
          Math.max(0, altusReplayIndex),
          activeAltusReplay.actions.length - 1,
        )
      : 0;

  const openAltusReplay = (
    runId: string,
    options?: {
      toolCallId?: string | null;
      view?: "actions" | "files";
    },
  ) => {
    if (!runId) return;
    setAltusReplayRunId(runId);
    setAltusReplayView(options?.view || "actions");
    setAltusReplayOpen(true);
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
  }, [
    activeAltusReplay,
    altusReplayIndex,
    pendingAltusReplayToolCallId,
  ]);

  useEffect(() => {
    if (!previewOpen && previewMaximized) {
      setPreviewMaximized(false);
    }
  }, [previewOpen, previewMaximized]);

  const previewPanel = previewOpen ? (
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
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
        onSelectDiff={(id) => setSelectedDiffId(id)}
        runtimeReady={runtime.ready}
        runtimeStarting={runtime.starting}
        onEnsureRuntime={runtime.ensure}
        selectedWorkspacePath={previewWorkspacePath}
        className="h-full min-h-0 w-full"
      />
    </section>
  ) : null;

  const chatPanel = (
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/70 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
          <div className="min-w-0 space-y-1">
            <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              Dialogue
            </div>
            <div className="truncate text-sm font-semibold text-foreground">
              对话
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            {runtime.orchestratorSessionId && runtime.ready ? (
              <span className="truncate text-xs text-muted-foreground">
                运行中 · {runtime.orchestratorSessionId}
              </span>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-full"
              onClick={() => {
                setPreviewOpen((prev) => {
                  if (prev) {
                    setPreviewMaximized(false);
                  }
                  return !prev;
                });
              }}
            >
              {previewOpen ? "收起预览" : "显示预览"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-full"
              onClick={() => setShowRuntimeDrawer(true)}
              disabled={!runtime.orchestratorSessionId}
            >
              执行日志
            </Button>
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
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-6 py-5"
        >
          <div className="mx-auto w-full space-y-4">
            {isLoadingOlderHistory && (
              <NoticeMessage
                tone="info"
                icon={<Loader2 className="w-4 h-4 animate-spin" />}
                text="正在加载更早历史..."
              />
            )}

            {!isConnected && (
              <NoticeMessage
                tone="warning"
                icon={<Loader2 className="w-4 h-4 animate-spin" />}
                text="正在连接智能体..."
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
                text={`执行环境已接入（${runtime.orchestratorSessionId}）`}
              />
            )}

            <AnimatePresence>
              {chatItems.map((item, index) => (
                <MessageBubble
                  key={item.messageKey || `chat-item-${index}`}
                  item={item}
                  onOpenDiffPreview={openDiffPreview}
                  onOpenManagedReplay={openAltusReplay}
                  onOpenWorkspacePreview={openWorkspacePreview}
                  onDeployArtifact={deployFromArtifactCard}
                />
              ))}
            </AnimatePresence>

            {isProcessing && !currentQuestion && (
              <NoticeMessage
                tone="info"
                icon={<Loader2 className="w-4 h-4 animate-spin" />}
                text="智能体正在处理..."
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
          className="mt-auto shrink-0 border-t border-border/70 bg-background/95 backdrop-blur"
        >
          <div className="px-6 py-3">
            {slashSuggestionPanel ? (
              <div className="mx-auto mb-2 w-[92%] max-w-full">{slashSuggestionPanel}</div>
            ) : null}
            <div className="w-full rounded-[2rem] border border-[#CBD5E1] bg-[#FFFFFF] shadow-[0_12px_40px_rgba(15,23,42,0.08)] transition-all duration-200 hover:border-[#94A3B8] focus-within:border-[#2563EB] focus-within:shadow-[0_0_0_4px_rgba(37,99,235,0.18),0_12px_40px_rgba(15,23,42,0.08)]">
              <div className="space-y-3 p-4">
                <Textarea
                  placeholder={
                    currentQuestion ? "请输入问题回答..." : "继续对话..."
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
                  className="min-h-[56px] resize-none border-0 bg-transparent px-0 py-0 text-base text-[#0F172A] placeholder:text-[#94A3B8] focus-visible:ring-0"
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
                                className="h-9 gap-2 rounded-xl px-3 transition-colors hover:bg-[#F1F5F9]"
                              >
                                <Sparkles className="w-4 h-4 text-muted-foreground" />
                                <span className="text-sm text-muted-foreground">
                                  {selectedModel}
                                </span>
                              </Button>
                            </DropdownMenuTrigger>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Select AI model</p>
                          </TooltipContent>
                        </Tooltip>
                        <DropdownMenuContent align="start" className="w-40">
                          <DropdownMenuItem
                            onClick={() => setSelectedModel("Agent Lite")}
                          >
                            <div className="flex flex-col">
                              <span className="font-medium">Agent Lite</span>
                              <span className="text-xs text-muted-foreground">
                                Fast & efficient
                              </span>
                            </div>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setSelectedModel("Agent Pro")}
                          >
                            <div className="flex flex-col">
                              <span className="font-medium">Agent Pro</span>
                              <span className="text-xs text-muted-foreground">
                                Balanced performance
                              </span>
                            </div>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setSelectedModel("Agent Max")}
                          >
                            <div className="flex flex-col">
                              <span className="font-medium">Agent Max</span>
                              <span className="text-xs text-muted-foreground">
                                Maximum capability
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
                            className="h-9 w-9 rounded-full transition-colors hover:bg-[#F1F5F9]"
                          >
                            <Mic className="w-4 h-4 text-muted-foreground" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Voice input</p>
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
                            className="h-9 w-9 rounded-full bg-[#0F172A] transition-colors hover:bg-[#1E293B] disabled:opacity-50"
                          >
                            {showStopButton ? (
                              <Square className="w-4 h-4" />
                            ) : (
                              <Send className="w-4 h-4" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>{showStopButton ? "停止执行" : "Send message"}</p>
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
      fluid={!selectedProjectId && mode === "chat"}
      lockViewport={!selectedProjectId && mode === "chat"}
      selectedProjectId={selectedProjectId}
      onProjectSelect={setSelectedProjectId}
    >
      {selectedProjectId ? (
        <ProjectDetail
          projectId={selectedProjectId}
          onBack={() => setSelectedProjectId(null)}
        />
      ) : (
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
                        AI Agent
                      </h1>
                    </motion.div>
                    <motion.p
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.2, duration: 0.4 }}
                      className="text-muted-foreground text-lg"
                    >
                      What can I help you with today?
                    </motion.p>
                  </div>

                  {/* Main Input Area */}
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3, duration: 0.4 }}
                    className="relative"
                  >
                    {slashSuggestionPanel ? (
                      <div className="mx-auto mb-2 w-[92%] max-w-full">{slashSuggestionPanel}</div>
                    ) : null}
                    {/* Text Area and Actions - Single Container */}
                    <div className="rounded-[2rem] border border-[#CBD5E1] bg-[#FFFFFF] p-4 shadow-[0_12px_40px_rgba(15,23,42,0.08)] transition-all duration-200 hover:border-[#94A3B8] focus-within:border-[#2563EB] focus-within:shadow-[0_0_0_4px_rgba(37,99,235,0.18),0_12px_40px_rgba(15,23,42,0.08)] space-y-3">
                      {/* Textarea */}
                      <Textarea
                        placeholder="Type your message here..."
                        value={message}
                        onChange={(e) => handleComposerInputChange(e.target.value)}
                        onKeyDown={(e) =>
                          handleComposerKeyDown(e, {
                            submit: () => handleSend(),
                          })
                        }
                        className="border-0 bg-transparent text-[#0F172A] placeholder:text-[#94A3B8] focus-visible:ring-0 text-base resize-none min-h-[100px] px-0 py-0"
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
                                      className="h-9 px-3 rounded-xl hover:bg-[#F1F5F9] transition-colors gap-2"
                                    >
                                      <Sparkles className="w-4 h-4 text-muted-foreground" />
                                      <span className="text-sm text-muted-foreground">
                                        {selectedModel}
                                      </span>
                                    </Button>
                                  </DropdownMenuTrigger>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Select AI model</p>
                                </TooltipContent>
                              </Tooltip>
                              <DropdownMenuContent
                                align="start"
                                className="w-40"
                              >
                                <DropdownMenuItem
                                  onClick={() => setSelectedModel("Agent Lite")}
                                >
                                  <div className="flex flex-col">
                                    <span className="font-medium">
                                      Agent Lite
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                      Fast & efficient
                                    </span>
                                  </div>
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => setSelectedModel("Agent Pro")}
                                >
                                  <div className="flex flex-col">
                                    <span className="font-medium">
                                      Agent Pro
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                      Balanced performance
                                    </span>
                                  </div>
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => setSelectedModel("Agent Max")}
                                >
                                  <div className="flex flex-col">
                                    <span className="font-medium">
                                      Agent Max
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                      Maximum capability
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
                                  className="h-9 w-9 rounded-full hover:bg-[#F1F5F9] transition-colors"
                                >
                                  <Mic className="w-4 h-4 text-muted-foreground" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Voice input</p>
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
                                  className="h-9 w-9 rounded-full bg-[#0F172A] hover:bg-[#1E293B] transition-colors disabled:opacity-50"
                                >
                                  <Send className="w-4 h-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Send message</p>
                              </TooltipContent>
                            </Tooltip>
                          </div>
                        </div>
                      </TooltipProvider>
                    </div>
                  </motion.div>

                  {/* Quick Actions */}
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.4, duration: 0.4 }}
                    className="grid grid-cols-2 gap-3"
                  >
                    {quickActions.map((action) => (
                      <Button
                        key={action.label}
                        variant="outline"
                        className="h-auto py-3 px-4 rounded-xl border-border hover:bg-accent hover:border-primary/30 transition-all duration-200 text-sm font-medium text-left whitespace-normal"
                        onClick={() => handleQuickAction(action.label)}
                      >
                        <span className="mr-2">{action.icon}</span>
                        {action.label}
                      </Button>
                    ))}
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
                      <div className="h-full min-h-0 w-full">{previewPanel}</div>
                    </div>
                  ) : (
                    <ResizablePanelGroup
                      direction="horizontal"
                      autoSaveId="task-creation-chat-layout"
                      className="h-full min-h-0"
                    >
                      <ResizablePanel defaultSize={66} minSize={42}>
                        <div className="h-full min-h-0 pr-2">{chatPanel}</div>
                      </ResizablePanel>
                      <ResizableHandle
                        withHandle
                        className="w-1.5 bg-transparent after:w-1.5 after:rounded-full after:bg-transparent hover:after:bg-transparent data-[resize-handle-active]:after:bg-transparent [&>div]:hidden"
                      />
                      <ResizablePanel defaultSize={34} minSize={30} maxSize={48}>
                        <div className="h-full min-h-0 pl-2">{previewPanel}</div>
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
      )}
      <TaskRuntimeDrawer
        open={showRuntimeDrawer}
        onOpenChange={setShowRuntimeDrawer}
        runtime={runtime}
      />
      {activeAltusReplay && sessionId ? (
        <AltusRunReplayDrawer
          open={altusReplayOpen}
          onOpenChange={setAltusReplayOpen}
          sessionId={sessionId}
          runId={activeAltusReplay.runId}
          runTitle="Altus Actions"
          actions={activeAltusReplay.actions}
          files={activeAltusReplay.files}
          currentIndex={activeAltusReplayIndex}
          latestIndex={Math.max(0, activeAltusReplay.actions.length - 1)}
          onSelectIndex={setAltusReplayIndex}
          onJumpToLatest={() =>
            setAltusReplayIndex(Math.max(0, activeAltusReplay.actions.length - 1))
          }
          activeView={altusReplayView}
          onActiveViewChange={setAltusReplayView}
          onOpenFile={(path) => {
            setAltusReplayOpen(false);
            openWorkspacePreview(path);
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
  | { kind: "agent"; markdown: string; author?: string; messageKey?: string; showAuthor?: boolean }
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
  | { kind: "agent_plain"; text: string; author?: string; messageKey?: string; showAuthor?: boolean }
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
      kind: "managed_artifact_card";
      sessionId: string;
      runId: string;
      artifacts: AltusArtifactFile[];
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
    return firstLine || "思考中";
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

  const pushProgress = (
    label: string,
    tone: CapsuleTone,
    messageKey?: string,
  ) => {
    progressBuffer = {
      label,
      tone,
      loading: isProgressLoadingLabel(label),
      messageKey,
    };
  };

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.type === "user_input" || message.type === "user_response") {
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
        flushProgress();
        items.push(managedCompletionCard);
      }

      const parsed = extractCapsule(message.content || "");
      if (parsed) {
        if (isProgressStatusLabel(parsed.label) && !parsed.rest.trim()) {
          pushProgress(
            parsed.label,
            getCapsuleTone(parsed.label),
            message.messageKey,
          );
          continue;
        }
        flushProgress();
        items.push({
          kind: "capsule",
          label: parsed.label,
          tone: getCapsuleTone(parsed.label),
          messageKey: message.messageKey,
        });
        if (parsed.rest.trim()) {
          pushAgentMarkdown(
            `**${getAgentName(message.agent)}**\n\n${parsed.rest}`,
            message.messageKey,
          );
        }
        continue;
      }

      flushProgress();
      pushAgentMarkdown(
        `**${getAgentName(message.agent)}**\n\n${message.content || ""}`,
        message.messageKey,
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
        flushProgress();
        items.push(managedCompletionCard);
      }
      const label = message.content || "状态更新";
      if (isCodexControlStatusLabel(label)) {
        continue;
      }
      const tone = message.tone || getCapsuleTone(label);
      if (isProgressStatusLabel(label)) {
        pushProgress(label, tone, message.messageKey);
      } else {
        flushProgress();
        items.push({
          kind: "capsule",
          label,
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
        const artifactPath = extractManagedArtifactPath(managedToolName, metadata);
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
          flushProgress();
          items.push({
            kind: "capsule",
            label: asText(metadata.content) || "产物已更新",
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
        pushProgress(`${executorLabel} 开始执行`, "execution", message.messageKey);
        continue;
      }

      if (eventType === "turn.completed") {
        const turnStatus = asText(metadata.turnStatus).toLowerCase();
        const errorMessage = asText(metadata.errorMessage) || content;
        if (message.stage === "failed" || turnStatus === "failed") {
          flushProgress();
          items.push({
            kind: "capsule",
            label: errorMessage || `${executorLabel} 执行失败`,
            tone: "error",
            messageKey: message.messageKey,
          });
          continue;
        }
        flushProgress();
        items.push({
          kind: "capsule",
          label: `${executorLabel} 执行完成`,
          tone: "execution",
          messageKey: message.messageKey,
        });
        continue;
      }

      if (eventType === "turn.failed" || eventType === "turn.interrupted") {
        flushProgress();
        items.push({
          kind: "capsule",
          label:
            content ||
            (eventType === "turn.interrupted" ? `${executorLabel} 执行已中断` : `${executorLabel} 执行失败`),
          tone: "error",
          messageKey: message.messageKey,
        });
        continue;
      }

      if (eventType === "turn/plan/updated") {
        if (!content) {
          continue;
        }
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
      if (itemType === "command_execution" || itemType === "commandexecution") {
        const commandText =
          asText(metadata.command) ||
          asText(item.command) ||
          "Shell 命令";
        const commandCard = getCodexCommandCardCopy(commandText);
        const targetPath =
          asText(metadata.targetPath) || extractCodexCommandTargetPath(commandText);
        const outputPreview =
          asText(metadata.outputPreview) ||
          asText(item.aggregated_output);
        const exitCodeValue =
          metadata.exitCode ??
          item.exit_code ??
          item.exitCode;
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
        const turnPaths = turnId
          ? (codexTurnFilePaths.get(turnId) || [])
          : [];
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
              label: "变更 Diff",
              files: effectiveFiles,
              diff: asText(metadata.diff) || undefined,
              status: "completed",
            },
          },
          content:
            fileCount > 1
              ? `变更 Diff · ${fileCount} 个文件`
              : primaryPath
                ? `变更 Diff · ${getFilename(primaryPath)}`
                : "变更 Diff",
          metadata: {
            ...metadata,
            eventType: "file.changed",
            event: {
              type: "file.changed",
              properties: {
                file: primaryPath,
                path: primaryPath,
                label: "变更 Diff",
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
            ? `${primaryLabel} · ${fileChanges.length} 个文件`
            : `${primaryLabel} · ${getFilename(primaryPath) || "文件"}`;

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
          `${executorLabel} 需要进一步授权后才能继续执行。`;
        items.push({
          kind: "capsule",
          label: "需要授权",
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
                label: "变更草案",
                files: fileChanges,
                status:
                  asText(metadata.itemStatus) ||
                  asText(item.status) ||
                  "completed",
              },
            },
            content: primary?.path ? `变更草案 · ${getFilename(primary.path)}` : "变更草案",
            metadata: {
              ...metadata,
              eventType: "file.changed",
              event: {
                type: "file.changed",
                properties: {
                  file: primary?.path || "",
                  path: primary?.path || "",
                  label: "变更草案",
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
      flushProgress();
      pushAgentMarkdown(
        `**错误**\n\n> ${message.message || "请求失败，请稍后重试"}`,
        message.messageKey,
      );
      continue;
    }

    if (message.type === "clarification_request") {
      flushProgress();
      const question = message.question || "请补充更多信息";
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
      const isSameRun = !currentRunId || !previousRunId || currentRunId === previousRunId;
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
          text: "Altus 将在你回复后继续工作",
          messageKey: message.messageKey,
        });
        continue;
      }
      const optionLines =
        message.options && message.options.length > 0
          ? `\n\n${message.options.map((opt) => `- ${opt}`).join("\n")}`
          : "";
      pushAgentMarkdown(
        `**需要补充信息**\n\n${question}${optionLines}`,
        message.messageKey,
      );
      continue;
    }

    if (message.type === "plan_generated") {
      flushProgress();
      pushAgentMarkdown(
        `**执行计划已生成**\n\n项目：${message.plan?.project?.title || "未命名项目"}`,
        message.messageKey,
      );
    }
  }

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

function collapseRepeatedChatAuthors(items: ChatItem[]): ChatItem[] {
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

    if (item.kind === "capsule") {
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
  return (
    countDirectMarkdownLines(normalized) >= 14 || normalized.length >= 600
  );
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
    summary: `${label} · ${lineCount} 行`,
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
      `${language} 代码`,
      fullMatch,
      countDirectMarkdownLines(body.trimEnd()),
    );
  }
  return buildDirectMarkdownFoldSummary(
    "代码块",
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
    return buildDirectMarkdownFoldSummary("补丁", trimmed);
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

  const upsertTurnPart = (turn: DirectTurnDraft, key: string, part: OpencodeTurnPart) => {
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
        markdown: `**错误**\n\n> ${message.message || message.content || "请求失败，请稍后重试"}`,
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
      const completedAt = asText(toRecord(toRecord(eventInfo.properties.info).time).completed);
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
      const partId = asText(eventInfo.part.id) || asText(metadata.partId) || "final";
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

    if (eventType !== "message.part.updated" && eventType !== "message.part.delta") {
      continue;
    }

    const partId = asText(eventInfo.part.id) || asText(metadata.partId) || `${eventInfo.partType || "part"}-${index}`;
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
      const diffId = message.messageKey || `${messageId || "assistant"}:${partId}`;
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
      const toolStatus = asText(toRecord(eventInfo.part.state).status).toLowerCase();
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

  return items.length > 0 ? [...fallbackItems, ...items] : buildLegacyChatItems(messages);
}

export function buildChatItems(messages: AgentMessage[]): ChatItem[] {
  const hasOpencodeEvents = messages.some((message) => message.type === "opencode_event");
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
          {open ? "收起" : "展开"}
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
          <div
            key={`markdown-${index}`}
            className={bodyClassName}
          >
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
          <div className="text-sm leading-7 text-foreground">
            {heading}
          </div>
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
        <div className="relative overflow-hidden rounded-xl border border-slate-200/80 bg-[radial-gradient(circle_at_top,_rgba(148,163,184,0.14),_transparent_58%),linear-gradient(180deg,rgba(255,255,255,0.92),rgba(248,250,252,0.94))] px-4 py-3 shadow-sm">
          <div className="absolute inset-y-3 right-3 w-px animate-pulse bg-gradient-to-b from-transparent via-slate-500 to-transparent" />
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
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
}: {
  item: ChatItem;
  onOpenDiffPreview?: (options?: {
    diffId?: string | null;
    filePath?: string | null;
    messageIndex?: number | null;
  }) => void;
  onOpenManagedReplay?: (
    runId: string,
    options?: {
      toolCallId?: string | null;
      view?: "actions" | "files";
    },
  ) => void;
  onOpenWorkspacePreview?: (path: string) => void;
  onDeployArtifact?: (path: string) => Promise<void> | void;
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
        <div className="w-full flex justify-end" data-message-key={item.userMessageKey}>
          <div className="max-w-[80%] space-y-2 rounded-md bg-slate-900 px-3 py-2 text-sm text-white">
            {item.skills?.length || item.attachments?.length ? (
              <MessageAttachmentReference
                skills={item.skills}
                attachments={item.attachments}
                tone="inverse"
              />
            ) : null}
            {item.userText ? (
              <span className="whitespace-pre-wrap break-words">{item.userText}</span>
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
                思考中
              </span>
              {item.thinkingLabel ? (
                <span className="text-muted-foreground">{item.thinkingLabel}</span>
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
          <svg height="16" width="16" fill="none" viewBox="0 0 16 16" aria-hidden="true">
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
        <OpencodeToolCard item={item} onOpenDiffPreview={onOpenDiffPreview} />
      </div>
    );
  }

  if (item.kind === "managed_tool") {
    return (
      <div data-message-key={item.messageKey}>
        <ManagedToolCard
          item={item}
          onOpenReplay={(runId, toolCallId) =>
            onOpenManagedReplay?.(runId, { toolCallId, view: "actions" })
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
          artifacts={item.artifacts}
          displayMode="web-preview"
          onOpenViewer={onOpenWorkspacePreview}
          onDeployRequested={onDeployArtifact}
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
  const statusCapsules = [
    "构思阶段",
    "分析阶段",
    "开发阶段",
    "测试阶段",
    "修复阶段",
    "交付阶段",
    "正在分析您的任务需求",
    "正在分析您的任务需求...",
    "已识别任务类型",
    "正在规划任务详情",
    "正在规划任务详情...",
    "任务规划完成",
    "任务规划完成：",
    "正在生成执行计划",
    "正在生成执行计划...",
    "执行计划已生成",
  ];
  for (const status of statusCapsules) {
    if (text.includes(status)) {
      return { label: text, rest: "" };
    }
  }

  // 兼容后端未加 {标签} 的阶段文本
  const fallbackLabels = ["意图识别", "任务规划", "执行计划", "系统", "错误"];
  for (const label of fallbackLabels) {
    if (text.startsWith(label)) {
      return {
        label,
        rest: text
          .slice(label.length)
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
    text.toLowerCase().includes("error")
  ) {
    return false;
  }
  const keywords = [
    "构思阶段",
    "分析阶段",
    "开发阶段",
    "测试阶段",
    "修复阶段",
    "交付阶段",
    "正在分析您的任务需求",
    "正在分析您的任务需求...",
    "已识别任务类型",
    "正在规划任务详情",
    "正在规划任务详情...",
    "任务规划完成",
    "任务规划完成：",
    "正在生成执行计划",
    "正在生成执行计划...",
    "执行计划已生成",
    "正在启动执行环境",
    "执行环境已就绪",
  ];
  return keywords.some((keyword) => text.includes(keyword));
}

function isProgressLoadingLabel(label: string): boolean {
  const text = label.trim();
  if (!text) return false;
  if (
    text.includes("错误") ||
    text.includes("失败") ||
    text.toLowerCase().includes("error")
  ) {
    return false;
  }
  const completeKeywords = ["完成", "已生成", "已就绪", "已接入", "成功"];
  if (completeKeywords.some((keyword) => text.includes(keyword))) {
    return false;
  }
  return true;
}

function getCapsuleTone(label: string): CapsuleTone {
  const lower = label.toLowerCase();
  if (lower.includes("错误") || lower.includes("error")) return "error";
  if (lower.includes("构思")) return "system";
  if (lower.includes("分析")) return "intent";
  if (lower.includes("开发")) return "execution";
  if (lower.includes("测试")) return "review";
  if (lower.includes("修复")) return "execution";
  if (lower.includes("交付")) return "planning";
  if (lower.includes("意图")) return "intent";
  if (lower.includes("规划") || lower.includes("计划")) return "planning";
  if (lower.includes("执行")) return "execution";
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
  if (stream) return "OpenCode · 实时输出";
  if (!eventType) return "OpenCode";
  if (eventType === "message.final") return "OpenCode · 最终产出";
  if (eventType === "session.idle") return "OpenCode · 空闲";
  if (eventType === "session.status") return "OpenCode · 状态";
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
    role:
      (asText(message.role) || asText(properties.role) || asText(part.role)).toLowerCase(),
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

type CodexCommandCategory =
  | "list"
  | "search"
  | "read"
  | "write"
  | "command";

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
    const token = stripShellQuotes(heredocMatch[1].trim().split(/\s+/)[0] || "");
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
  if (normalized.startsWith("mv ")) return "移动文件";
  if (normalized.startsWith("cp ")) return "复制文件";
  if (normalized.includes(">>")) return "追加文件";
  if (normalized.includes("cat <<") || normalized.includes(">") || normalized.includes("tee ")) {
    return "文件修改";
  }
  return "文件修改";
}

function getCodexCommandCardCopy(command: string) {
  const category = inferCodexCommandCategory(command);
  switch (category) {
    case "list":
      return { category, title: "目录检查", icon: FolderSearch2 };
    case "search":
      return { category, title: "搜索", icon: Search };
    case "read":
      return { category, title: "文件查看", icon: FileSearch };
    case "write":
      return { category, title: "文件修改", icon: FilePenLine };
    default:
      return { category, title: "Shell 执行", icon: Terminal };
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
  if (normalized === "add" || normalized === "create" || normalized === "created") {
    return "新建文件";
  }
  if (
    normalized === "delete" ||
    normalized === "deleted" ||
    normalized === "remove" ||
    normalized === "removed"
  ) {
    return "删除文件";
  }
  return "更新文件";
}

function getToolInfo(tool: string, input: Record<string, unknown>) {
  const lower = tool.toLowerCase();
  switch (lower) {
    case "read":
      return { title: "读取", subtitle: getFilename(asText(input.filePath)) };
    case "list":
      return {
        title: "列出",
        subtitle: getDirectory(asText(input.path) || "/"),
      };
    case "glob":
      return { title: "匹配", subtitle: asText(input.pattern) };
    case "grep":
      return { title: "搜索", subtitle: asText(input.pattern) };
    case "webfetch":
      return { title: "抓取", subtitle: asText(input.url) };
    case "task":
      return { title: "子任务", subtitle: asText(input.description) };
    case "bash":
      return {
        title: "Shell",
        subtitle: asText(input.description) || asText(input.command),
      };
    case "edit":
      return { title: "编辑", subtitle: getFilename(asText(input.filePath)) };
    case "write":
      return { title: "写入", subtitle: getFilename(asText(input.filePath)) };
    case "apply_patch":
      return {
        title: "补丁",
        subtitle: Array.isArray(input.files)
          ? `${input.files.length} 文件`
          : "",
      };
    case "todowrite":
      return { title: "待办" };
    case "question":
      return { title: "待确认" };
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

function buildDetailPreview(value: string, maxLines = 3, maxCharsPerLine = 120) {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line, index, arr) => line || arr.length === 1 || index < arr.length - 1);
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
  const toolLabel = input.toolName ? `工具: ${input.toolName}` : "";
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
      baseCommand ? `命令: ${baseCommand}` : "",
      cwd ? `目录: ${cwd}` : "",
      shortOutput ? `输出摘要: ${shortOutput}` : "",
    ]);
  }

  if (toolKey === "read") {
    return summarizeTooltipLines([
      toolLabel,
      filePath ? `读取文件: ${filePath}` : "",
    ]);
  }

  if (toolKey === "write") {
    return summarizeTooltipLines([
      toolLabel,
      filePath ? `写入文件: ${filePath}` : "",
    ]);
  }

  if (toolKey === "edit") {
    return summarizeTooltipLines([
      toolLabel,
      filePath ? `编辑文件: ${filePath}` : "",
    ]);
  }

  if (toolKey === "grep") {
    return summarizeTooltipLines([
      toolLabel,
      pattern ? `搜索模式: ${pattern}` : "",
      filePath ? `范围: ${filePath}` : "",
    ]);
  }

  if (toolKey === "glob") {
    return summarizeTooltipLines([
      toolLabel,
      pattern ? `匹配模式: ${pattern}` : "",
      filePath ? `范围: ${filePath}` : "",
    ]);
  }

  if (toolKey === "list") {
    return summarizeTooltipLines([
      toolLabel,
      filePath ? `列出目录: ${filePath}` : "",
    ]);
  }

  if (toolKey === "webfetch") {
    return summarizeTooltipLines([
      toolLabel,
      url ? `抓取地址: ${url}` : "",
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
      return "应用补丁";
    }
    return summarizeTooltipLines([
      toolLabel,
      "补丁目标文件:",
      ...files.slice(0, 6).map((file) => `- ${file}`),
      files.length > 6 ? `- 以及另外 ${files.length - 6} 个文件` : "",
    ]);
  }

  if (input.eventType.startsWith("file.") || input.eventType === "file.changed") {
    if (fileList.length > 0) {
      return summarizeTooltipLines([
        toolLabel,
        ...fileList
          .slice(0, 6)
          .map((item) => `${mapCodexFileChangeLabel(item.kind)}: ${item.path}`),
        fileList.length > 6 ? `以及另外 ${fileList.length - 6} 个文件` : "",
      ]);
    }
    return summarizeTooltipLines([
      toolLabel,
      filePath ? `文件路径: ${filePath}` : "",
    ]);
  }

  if (toolKey === "task") {
    const description = asText(toolInput.description) || asText(properties.description);
    return summarizeTooltipLines([
      toolLabel,
      description ? `子任务: ${description}` : "",
    ]);
  }

  return summarizeTooltipLines([
    toolLabel,
    baseCommand ? `命令: ${baseCommand}` : "",
    filePath ? `路径: ${filePath}` : "",
    shortOutput ? `输出摘要: ${shortOutput}` : "",
  ]);
}

function OpencodeToolCard({
  item,
  onOpenDiffPreview,
}: {
  item: Extract<ChatItem, { kind: "opencode_tool" }>;
  onOpenDiffPreview?: (options?: {
    diffId?: string | null;
    filePath?: string | null;
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
              展示更多
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
        title: eventType === "file.watcher.updated" ? "文件监听" : "文件更新",
        subtitle: getFilename(filePath),
      };
    } else if (eventType === "command.executed") {
      const category = asText(metadata.commandCategory).toLowerCase();
      info = {
        title:
          category === "list"
            ? "目录检查"
            : category === "search"
              ? "搜索"
              : category === "read"
                ? "文件查看"
                : category === "write"
                  ? "文件修改"
                  : "命令执行",
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
            ? `${files.length} 个文件`
            : getFilename(asText(first.path) || asText(first.file)),
      };
    } else if (eventType.startsWith("pty.")) {
      info = {
        title: "终端",
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
            <DialogDescription>工具原子消息完整信息</DialogDescription>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-auto rounded-md bg-slate-950 px-4 py-3 font-mono text-xs leading-6 text-slate-100 whitespace-pre-wrap break-all">
            {detailBodyText}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );

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
              messageIndex: item.messageIndex,
            })
          }
          className="text-left"
        >
          <EventCapsule
            icon={FileDiff}
            text="Diff · 点击查看更改"
            title={explanationText || undefined}
          />
        </button>
      </motion.div>
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
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            待办
          </div>
          {todos.length > 0 ? (
            <div className="mt-3 space-y-2">
              {todos.map((todo, index) => {
                const content = asText(todo.content) || "待办事项";
                const statusText = asText(todo.status) || "pending";
                const priority = asText(todo.priority);
                const statusLabel =
                  statusText === "completed"
                    ? "已完成"
                    : statusText === "in_progress"
                      ? "进行中"
                      : "待处理";
                const statusTone =
                  statusText === "completed"
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : statusText === "in_progress"
                      ? "bg-blue-50 text-blue-700 border-blue-200"
                      : "bg-slate-50 text-slate-600 border-slate-200";
                return (
                  <div
                    key={`${content}-${index}`}
                    className="flex items-center justify-between gap-3"
                  >
                    <div className="text-sm text-slate-800">{content}</div>
                    <div className="flex items-center gap-2">
                      {priority ? (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
                          {priority === "high"
                            ? "高优先级"
                            : priority === "medium"
                              ? "中优先级"
                              : "低优先级"}
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
      </motion.div>
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
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            待确认
          </div>
          <div className="mt-3 space-y-3">
            {questions.map((question, index) => (
              <div
                key={`${question.question}-${index}`}
                className="space-y-1.5"
              >
                {question.header ? (
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {question.header}
                  </div>
                ) : null}
                <div className="text-sm text-slate-800">
                  {question.question}
                </div>
                {question.options.length > 0 ? (
                  <ul className="list-disc pl-5 text-xs text-slate-600 space-y-1">
                    {question.options.map((option, optionIndex) => (
                      <li key={`${option}-${optionIndex}`}>{option}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
            <div className="text-xs text-slate-500">
              请直接在输入框回复你的选择或补充信息。
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
    const label = toolKey === "write" ? "写入文件" : "编辑文件";
    const fileName = getFilename(filePath) || "文件";
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
        ? "失败"
        : statusText === "completed" || exitCodeText === "0"
          ? "成功"
          : "执行";
    const capsuleText =
      writeLike && targetPath
        ? `${inferCodexWriteLabel(commandText)} · ${getFilename(targetPath) || targetPath}`
        : `${commandCard.title} · ${statusLabel}`;
    const inlineSummary =
      writeLike && targetPath
        ? `通过 shell ${inferCodexWriteLabel(commandText)}：${targetPath}`
        : "";
    if (isCodexExecutor && writeLike) {
      const resolvedLabel = inferCodexWriteLabel(commandText);
      const resolvedPath = targetPath || "";
      const resolvedFileName = getFilename(resolvedPath) || "文件";
      const writePayloadPreview = extractCodexWritePayloadPreview(commandText);
      const commandPreview = truncateText(commandText || "", 2400);
      detailTitle = `${resolvedLabel} · ${resolvedFileName}`;
      detailBodyText = [
        `操作: ${resolvedLabel}`,
        resolvedPath ? `目标文件: ${resolvedPath}` : "",
        writePayloadPreview ? "写入内容预览:" : commandText ? "命令摘要:" : "",
        writePayloadPreview ? writePayloadPreview.text : commandText ? commandPreview.text : "",
        writePayloadPreview?.truncated
          ? "写入内容已截断，请结合工作区文件预览查看完整结果。"
          : commandText && commandPreview.truncated
            ? "命令内容已截断，请结合工作区文件预览查看完整结果。"
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
            <div className="text-[11px] text-slate-500 whitespace-pre-wrap break-words">
              {inlineSummary}
            </div>
          ) : null}
          {commandText && !writeLike ? (
            <div className="rounded-md bg-slate-900 px-3 py-2 text-xs text-slate-100 font-mono">
              {commandText}
            </div>
          ) : null}
          {compactOutput && previewText ? (
            <div className="text-[11px] text-slate-500 whitespace-pre-wrap break-words">
              {previewText}
            </div>
          ) : null}
          {!compactOutput && outputText ? (
            <div className="rounded-md bg-slate-950 px-3 py-2 text-xs text-slate-100 font-mono whitespace-pre-wrap">
              {outputText}
            </div>
          ) : null}
          {!compactOutput && truncated ? (
            <div className="text-[11px] text-slate-500">
              输出已截断，请查看日志
            </div>
          ) : null}
        </div>
      </motion.div>
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
        ? `${label || "文件变更"} · ${files.length} 个文件`
        : `${label || "文件变更"} · ${getFilename(primaryPath) || "文件"}`;
    const icon =
      label === "新建文件"
        ? FilePlus
        : label === "删除文件"
          ? Trash2
          : FilePenLine;
    detailTitle =
      files.length > 1
        ? `${label || "文件变更"} · ${files.length} 个文件`
        : `${label || "文件变更"} · ${getFilename(primaryPath) || "文件"}`;
    detailBodyText = [
      `操作: ${label || "文件变更"}`,
      primaryPath ? `目标文件: ${primaryPath}` : "",
      files.length > 1
        ? `涉及文件:\n${files
            .map((item) => `${mapCodexFileChangeLabel(item.kind)}: ${item.path}`)
            .join("\n")}`
        : "",
      asText(properties.diff) ? "原生 Diff 已同步到内容预览面板，可点击卡片查看。" : "",
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
                messageIndex: item.messageIndex,
              })
            }
            className="text-left"
          >
            <EventCapsule icon={icon} text={text} title={explanationText || undefined} />
          </button>
        ) : (
          <EventCapsule icon={icon} text={text} title={explanationText || undefined} />
        )}
      </motion.div>
    );
  }

  if (eventType.startsWith("file.")) {
    const filePath = asText(properties.file) || asText(properties.path);
    const label =
      eventType === "file.watcher.updated" ? "文件监听" : "文件更新";
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
                messageIndex: item.messageIndex,
              })
            }
            className="text-left"
          >
            <EventCapsule
              icon={FileText}
              text={`${label} · ${getFilename(filePath) || "文件已更新"}`}
              title={explanationText || undefined}
            />
          </button>
        ) : (
          <EventCapsule
            icon={FileText}
            text={`${label} · ${getFilename(filePath) || "文件已更新"}`}
            title={explanationText || undefined}
          />
        )}
      </motion.div>
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
        title={explanationText || (toolKey === "bash" ? commandHint || undefined : undefined)}
      />
    </motion.div>
  );
}

function ManagedToolCard({
  item,
  onOpenReplay,
}: {
  item: Extract<ChatItem, { kind: "managed_tool" }>;
  onOpenReplay?: (runId: string, toolCallId: string) => void;
}) {
  const displayName = getManagedToolDisplayName(item.toolName);
  const icon =
    item.toolName === "shell_execute"
      ? Terminal
      : item.toolName === "write_file"
        ? FilePenLine
        : item.toolName === "read_file"
          ? FileText
          : item.toolName === "search_code"
            ? Search
            : item.toolName === "list_directory"
              ? FolderSearch2
              : item.toolName === "ask_user"
                ? Sparkles
                : FileSearch;
  const Icon = icon;
  const toneClass =
    item.status === "failed"
      ? "border-rose-200 bg-rose-50 text-rose-700"
        : item.status === "completed"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-border/70 bg-muted/50 text-foreground/85";
  const statusLabel =
    item.status === "failed"
      ? "失败"
      : item.status === "completed"
        ? "已完成"
        : "进行中";
  const hoverPreview = buildDetailPreview(item.detail || item.summary || item.toolName, 5, 96);
  const summaryText = item.summary?.trim();
  const previewText =
    formatManagedToolPreview(item.toolName, item.metadata) ||
    hoverPreview.preview ||
    summaryText ||
    "";
  const statusToneClass =
    item.status === "failed"
      ? "border-rose-300/60 bg-rose-100/80 text-rose-700"
      : item.status === "completed"
        ? "border-emerald-300/60 bg-emerald-100/80 text-emerald-700"
        : "border-border/70 bg-background/90 text-foreground/75";
  const chipToneClass =
    item.status === "failed"
      ? "border-rose-200/80 bg-rose-50/80 text-rose-700 hover:bg-rose-50"
      : item.status === "completed"
        ? "border-emerald-200/80 bg-emerald-50/80 text-emerald-700 hover:bg-emerald-50"
        : "border-border/70 bg-card/90 text-foreground/85 hover:bg-muted/40";

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
                onOpenReplay(item.runId, item.toolCallId);
              }
            }}
            className={`group inline-flex max-w-[min(100%,42rem)] items-center gap-2 rounded-full border px-2.5 py-1.5 text-left transition ${chipToneClass}`}
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-background/85 shadow-sm">
              <Icon className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0 flex items-center gap-2 overflow-hidden">
              <span className="shrink-0 text-[11px] font-medium leading-5">
                {displayName}
              </span>
              <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${statusToneClass}`}>
                {statusLabel}
              </span>
              {summaryText ? (
                <span className="truncate text-[11px] leading-5 opacity-75">
                  {summaryText}
                </span>
              ) : null}
            </span>
          </button>
        </HoverCardTrigger>
        <HoverCardContent
          align="start"
          side="top"
          className={`w-[380px] rounded-2xl border p-0 shadow-[0px_12px_32px_rgba(15,23,42,0.18)] ${toneClass}`}
        >
          <div className="space-y-0 border-b border-current/10 px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-background/85 shadow-sm">
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium leading-5">
                    {displayName}
                  </span>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusToneClass}`}>
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
                结果摘要
              </div>
              <p className="whitespace-pre-wrap break-all rounded-xl bg-background/70 px-3 py-2 font-mono text-[11px] leading-5">
                {previewText}
              </p>
            </div>
            <div className="space-y-1">
              <div className="text-[11px] font-medium uppercase tracking-[0.18em] opacity-55">
                更多信息
              </div>
              <p className="whitespace-pre-wrap break-all text-[12px] leading-5 opacity-80">
                {hoverPreview.preview}
              </p>
            </div>
            <div className="text-[11px] leading-5 opacity-60">
              点击消息可查看回放与文件
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
    system: "系统",
    altus: "Altus",
    intent_recognition: "意图识别",
    planning: "任务规划",
    execution_plan: "执行计划",
  };
  return agent ? nameMap[agent] || agent : "智能体";
}

function getExecutorDisplayName(metadataRaw: unknown) {
  const metadata = toRecord(metadataRaw);
  const executor = asText(metadata.executor).toLowerCase();
  if (executor === "codex") return "Codex";
  if (executor === "altus") return "Altus";
  if (executor === "claudecode") return "ClaudeCode";
  if (executor === "opencode") return "OpenCode";
  return "执行器";
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
  const pushArtifact = (pathRaw: string, previewType?: AltusArtifactFile["previewType"]) => {
    const path = String(pathRaw || "").trim().replace(/\\/g, "/");
    if (!path) return;
    const resolvedPreviewType = previewType || inferManagedArtifactPreviewType(path);
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

export function buildManagedCompletionCardItem(input: {
  message: AgentMessage;
  managedArtifactsByRun: Map<string, AltusArtifactFile[]>;
  emittedManagedCompletionRuns: Set<string>;
}): ChatItem | null {
  const { message, managedArtifactsByRun, emittedManagedCompletionRuns } = input;
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
  const managedArtifacts = managedArtifactsByRun.get(runId) || [];
  const webArtifacts = collectManagedWebArtifacts({
    deliverables,
    managedArtifacts,
  });
  const shouldEmitFromDeliverablesContext = deliverables.length > 0;
  const isRunCompletedContext = message.type === "status_update" && eventType === "run_completed";
  if ((shouldEmitFromDeliverablesContext || isRunCompletedContext) && webArtifacts.length > 0) {
    emittedManagedCompletionRuns.add(runId);
    return {
      kind: "managed_artifact_card",
      sessionId,
      runId,
      artifacts: webArtifacts,
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

  if (webArtifacts.length === 0) {
    return null;
  }

  emittedManagedCompletionRuns.add(runId);
  return {
    kind: "managed_artifact_card",
    sessionId,
    runId,
    artifacts: webArtifacts,
    messageKey: `managed:${runId}:artifact_card`,
  };
}

function parseManagedToolOutputPreview(outputPreviewRaw: unknown): Record<string, unknown> {
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

  if (toolName === "complete_task" && Array.isArray((args as { attachments?: unknown[] }).attachments)) {
    for (const item of (args as { attachments?: unknown[] }).attachments || []) {
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
  const actionIndexByRun = new Map<string, Map<string, number>>();
  const fileIndexByRun = new Map<string, Map<string, AltusReplayFile>>();

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
        artifactPaths: collectManagedReplayArtifactPaths(toolName, metadata),
      };
    }

    const action = actions[stepIndex];
    for (const path of action.artifactPaths) {
      upsertFile(runId, path, action.toolCallId, action.stepIndex);
    }
  }

  return new Map(
    Array.from(actionsByRun.entries()).map(([runId, actions]) => [
      runId,
      {
        runId,
        actions,
        files: filesByRun.get(runId) || [],
      },
    ]),
  );
}

function inferManagedArtifactPreviewType(path: string): AltusArtifactFile["previewType"] {
  return /\.(html?)$/i.test(path) ? "web" : "code";
}

function extractManagedArtifactPath(toolName: string, metadataRaw: unknown): string {
  if (toolName !== "write_file") return "";
  const metadata = toRecord(metadataRaw);
  const args = toRecord(metadata.arguments);
  const output = parseManagedToolOutputPreview(metadata.outputPreview);
  return asText(args.path) || asText(output.path);
}

function getManagedToolDisplayName(toolName: string) {
  switch (toolName) {
    case "shell_execute":
      return "命令执行";
    case "write_file":
      return "写入文件";
    case "read_file":
      return "读取文件";
    case "list_directory":
      return "列出目录";
    case "search_code":
      return "代码搜索";
    case "ask_user":
      return "请求澄清";
    case "complete_task":
      return "完成任务";
    default:
      return toolName || "工具调用";
  }
}

function formatManagedToolSummary(toolName: string, metadataRaw: unknown) {
  const metadata = toRecord(metadataRaw);
  const args = toRecord(metadata.arguments);
  if (toolName === "shell_execute") {
    return asText(args.command) || "执行 shell 命令";
  }
  if (toolName === "write_file") {
    return asText(args.path) || "写入文件";
  }
  if (toolName === "read_file") {
    return asText(args.path) || "读取文件";
  }
  if (toolName === "list_directory") {
    return asText(args.path) || "列出目录";
  }
  if (toolName === "search_code") {
    const query = asText(args.query);
    const target = asText(args.path);
    return [query, target ? `@ ${target}` : ""].filter(Boolean).join(" ");
  }
  if (toolName === "ask_user") {
    return asText(args.question) || "请求用户澄清";
  }
  if (toolName === "complete_task") {
    return asText(args.summary) || "输出最终完成总结";
  }
  return asText(metadata.content) || toolName;
}

function formatManagedToolPreview(toolName: string, metadataRaw: unknown) {
  const metadata = toRecord(metadataRaw);
  const args = toRecord(metadata.arguments);
  const output = parseManagedToolOutputPreview(metadata.outputPreview);
  const error = asText(metadata.error);

  if (error) return error;

  if (toolName === "shell_execute") {
    const stdout = asText(output.stdout);
    const stderr = asText(output.stderr);
    return stdout || stderr || asText(args.command) || "执行命令";
  }

  if (toolName === "write_file") {
    const bytes = asText(output.bytes);
    return bytes ? `写入 ${bytes} bytes` : asText(output.path) || "已写入目标文件";
  }

  if (toolName === "read_file") {
    return asText(output.content) || asText(output.path) || "已读取目标文件";
  }

  if (toolName === "list_directory") {
    return asText(output.output) || asText(output.path) || "已返回目录内容";
  }

  if (toolName === "search_code") {
    return asText(output.output) || asText(args.query) || "已返回搜索结果";
  }

  if (toolName === "complete_task") {
    return asText(args.summary) || "任务已完成";
  }

  return asText(metadata.outputPreview) || asText(metadata.content);
}

function formatManagedToolDetail(toolName: string, metadataRaw: unknown) {
  const metadata = toRecord(metadataRaw);
  const args = toRecord(metadata.arguments);
  const output = parseManagedToolOutputPreview(metadata.outputPreview);
  const error = asText(metadata.error);
  const lines: string[] = [];
  const pushLine = (label: string, value: unknown) => {
    const text = asText(value);
    if (text) {
      lines.push(`${label}: ${text}`);
    }
  };

  lines.push(`工具: ${getManagedToolDisplayName(toolName)} (${toolName})`);

  if (toolName === "shell_execute") {
    pushLine("命令", args.command);
    pushLine("目录", output.cwd || args.cwd);
    pushLine("退出码", output.exitCode);
    pushLine("输出", output.stdout);
    pushLine("错误输出", output.stderr);
  } else if (toolName === "write_file") {
    pushLine("目标文件", args.path || output.path);
    pushLine("写入大小", output.bytes);
  } else if (toolName === "read_file") {
    pushLine("目标文件", args.path || output.path);
    pushLine("内容预览", output.content);
  } else if (toolName === "list_directory") {
    pushLine("目标目录", args.path || output.path);
    pushLine("递归深度", output.depth || args.depth);
    pushLine("结果预览", output.output);
  } else if (toolName === "search_code") {
    pushLine("搜索词", args.query);
    pushLine("搜索范围", args.path || output.path);
    pushLine("结果预览", output.output);
  } else if (toolName === "ask_user") {
    pushLine("问题", args.question);
    if (Array.isArray(args.options)) {
      const options = (args.options as unknown[])
        .map((item) => asText(item))
        .filter(Boolean)
        .join(" / ");
      pushLine("建议选项", options);
    }
  } else if (toolName === "complete_task") {
    pushLine("完成摘要", args.summary);
    if (Array.isArray(args.verification)) {
      const checks = (args.verification as unknown[])
        .map((item) => asText(item))
        .filter(Boolean)
        .join(" / ");
      pushLine("验证", checks);
    }
  } else {
    pushLine("摘要", asText(metadata.content));
  }

  if (error) {
    pushLine("失败原因", error);
  }

  if (lines.length === 1) {
    pushLine("摘要", formatManagedToolSummary(toolName, metadata));
  }

  return lines.join("\n");
}
