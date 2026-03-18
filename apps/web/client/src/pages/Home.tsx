/**
 * Design Philosophy: Swiss International Style + Digital Minimalism
 * - Centered content with clear hierarchy
 * - Consistent input experience across pages
 * - 支持对话模式和任务创建智能体
 */

import { useState, useRef, useEffect, useMemo, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import WorkspaceLayout from "@/components/WorkspaceLayout";
import ProjectDetail from "./ProjectDetail";
import {
  Mic,
  Send,
  Sparkles,
  Loader2,
  FilePlus,
  FilePenLine,
  FileSearch,
  FileText,
  FileDiff,
  FolderSearch2,
  Search,
  Terminal,
  ChevronDown,
  ChevronRight,
  Trash2,
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import ConnectorDialog from "@/components/ConnectorDialog";
import AttachmentChipList from "@/components/AttachmentChipList";
import AttachmentPickerButton from "@/components/AttachmentPickerButton";
import TaskRuntimeDrawer from "@/components/TaskRuntimeDrawer";
import OpencodePreviewPanel from "@/components/OpencodePreviewPanel";
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
import { uploadTaskCreationAttachment } from "@/lib/task-creation-client";
import {
  appendAttachmentsToPrompt,
  consumePendingDraftAttachments,
  DEFAULT_ATTACHMENT_PROMPT,
  mergePendingAttachments,
  type PendingAttachment,
  type UploadedTaskAttachment,
} from "@/lib/task-attachments";
import { useLocation, useSearch } from "wouter";
import { Streamdown } from "streamdown";

type PageMode = "input" | "chat";
type PersistedMessageScrollAnchor = {
  anchorMessageKey: string | null;
  anchorOffsetTop: number;
  scrollTop: number;
  savedAt: number;
};

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
  const [showRuntimeDrawer, setShowRuntimeDrawer] = useState(false);
  const [selectedModel, setSelectedModel] = useState("Agent Pro");
  const [previewOpen, setPreviewOpen] = useState(false);
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
    messages,
    hasOlderHistory,
    isLoadingOlderHistory,
    sessionId,
    currentQuestion,
    runtime,
    sendChatInput,
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
    const pendingFiles = consumePendingDraftAttachments();
    if (!pendingFiles.length) return;
    const merged = mergePendingAttachments([], pendingFiles);
    setAttachments(merged.attachments);
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

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((item) => item.id !== id));
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
    const hasAttachments = attachments.length > 0;
    const displayText = trimmed || (hasAttachments ? "已添加附件" : "");
    const baseText =
      trimmed || (hasAttachments ? DEFAULT_ATTACHMENT_PROMPT : "");
    if (!baseText) return;

    try {
      let activeSessionId = (sessionId || "").trim();
      if (hasAttachments && !activeSessionId) {
        activeSessionId = await ensureSession(displayText || "新建任务会话");
      }

      let uploadedAttachments: UploadedTaskAttachment[] = [];
      if (hasAttachments) {
        uploadedAttachments = await Promise.all(
          attachments.map((item) =>
            uploadTaskCreationAttachment(activeSessionId, item.file),
          ),
        );
      }

      exitHistoryView();
      await sendChatInput(
        appendAttachmentsToPrompt(baseText, uploadedAttachments),
        {
          sessionId: activeSessionId || undefined,
          metadata: uploadedAttachments.length
            ? {
                attachments: uploadedAttachments,
                originalInput: displayText,
              }
            : undefined,
        },
      );

      if (uploadedAttachments.length) {
        setAttachments([]);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "附件发送失败");
    }
  }

  const handleSend = () => {
    if (!message.trim() && attachments.length === 0) return;
    setMode("chat");
    void submitPrompt(message);
    setMessage("");
  };

  const handleQuickAction = (action: string) => {
    setMode("chat");
    void submitPrompt(action);
    setMessage("");
  };

  const handleAnswerQuestion = (answer: string) => {
    exitHistoryView();
    answerQuestion(answer);
  };

  const quickActions = [
    { label: "我想做一个Python开发行业的市场调研", icon: "📊" },
    { label: "帮我分析竞争对手的产品策略", icon: "📄" },
    { label: "创建一个新产品的营销计划", icon: "🎨" },
    { label: "生成季度业务报告", icon: "💻" },
  ];

  const chatItems = useMemo(() => buildChatItems(messages), [messages]);
  const { diffItems } = useMemo(() => buildPreviewItems(messages), [messages]);

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

  const showDesktopPreview = previewOpen && !isMobile;
  const showMobilePreview = previewOpen && isMobile;

  const previewPanel = previewOpen ? (
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
      <OpencodePreviewPanel
        messages={messages}
        sessionId={sessionId}
        open={previewOpen}
        activeTab={previewTab}
        onTabChange={setPreviewTab}
        onToggle={() => setPreviewOpen(false)}
        selectedDiffId={selectedDiffId}
        onSelectDiff={(id) => setSelectedDiffId(id)}
        runtimeReady={runtime.ready}
        runtimeStarting={runtime.starting}
        onEnsureRuntime={runtime.ensure}
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
              onClick={() => setPreviewOpen((prev) => !prev)}
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
            <div className="w-full rounded-3xl border-2 border-border bg-card shadow-lg transition-all duration-200 hover:shadow-xl">
              <div className="space-y-3 p-4">
                <Textarea
                  placeholder={
                    currentQuestion ? "请输入问题回答..." : "继续对话..."
                  }
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (currentQuestion) {
                        handleAnswerQuestion(message);
                        setMessage("");
                      } else {
                        handleSend();
                      }
                    }
                  }}
                  className="min-h-[56px] resize-none border-0 bg-transparent px-0 py-0 text-base focus-visible:ring-0"
                  rows={2}
                />

                {!currentQuestion ? (
                  <AttachmentChipList
                    attachments={attachments}
                    onRemove={removeAttachment}
                  />
                ) : null}

                <TooltipProvider>
                  <div className="flex items-center justify-between pt-2">
                    <div className="flex items-center gap-1">
                      <AttachmentPickerButton
                        onSelectFiles={handleAttachmentSelect}
                        disabled={Boolean(currentQuestion)}
                      />

                      <ConnectorDialog sessionId={sessionId} />

                      <DropdownMenu>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-9 gap-2 rounded-xl px-3 transition-colors hover:bg-muted"
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
                            className="h-9 w-9 rounded-xl transition-colors hover:bg-muted"
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
                              } else {
                                handleSend();
                              }
                            }}
                            disabled={
                              currentQuestion
                                ? !message.trim()
                                : !message.trim() && attachments.length === 0
                            }
                            size="icon"
                            className="h-9 w-9 rounded-xl bg-foreground transition-colors hover:bg-foreground/90 disabled:opacity-50"
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
                    className="bg-card border-2 border-border rounded-3xl shadow-lg hover:shadow-xl transition-all duration-200"
                  >
                    {/* Text Area and Actions - Single Container */}
                    <div className="p-4 space-y-3">
                      {/* Textarea */}
                      <Textarea
                        placeholder="Type your message here..."
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            handleSend();
                          }
                        }}
                        className="border-0 bg-transparent focus-visible:ring-0 text-base resize-none min-h-[100px] px-0 py-0"
                        rows={4}
                      />

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
                                      className="h-9 px-3 rounded-xl hover:bg-muted transition-colors gap-2"
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
                                  className="h-9 w-9 rounded-xl hover:bg-muted transition-colors"
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
                                    !message.trim() && attachments.length === 0
                                  }
                                  size="icon"
                                  className="h-9 w-9 rounded-xl bg-foreground hover:bg-foreground/90 transition-colors disabled:opacity-50"
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
                ) : (
                  <div className="flex h-full min-h-0 flex-1 flex-col gap-4 overflow-hidden">
                    <div className="flex-1 min-h-0">{chatPanel}</div>
                    {showMobilePreview ? (
                      <div className="h-[min(45vh,32rem)] min-h-[280px] shrink-0">
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
      attachments?: UploadedTaskAttachment[];
      messageKey?: string;
    }
  | { kind: "agent"; markdown: string; author?: string; messageKey?: string }
  | { kind: "agent_plain"; text: string; author?: string; messageKey?: string }
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
      kind: "opencode_turn";
      userText: string;
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
  const userTextSet = new Set<string>();
  const finalizedPartIds = new Set<string>();

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

  const pushUser = (
    text: string,
    attachments?: UploadedTaskAttachment[],
    messageKey?: string,
  ) => {
    const normalized = normalizeForDedup(text);
    if (!normalized && (!attachments || attachments.length === 0)) return;
    const last = items[items.length - 1];
    if (messageKey && last?.messageKey === messageKey) {
      return;
    }
    if (
      last?.kind === "user" &&
      normalizeForDedup(last.text) === normalized &&
      JSON.stringify(last.attachments || []) ===
        JSON.stringify(attachments || [])
    ) {
      return;
    }
    items.push({
      kind: "user",
      text,
      attachments,
      messageKey,
    });
  };

  const extractUserAttachments = (
    metadata: unknown,
  ): UploadedTaskAttachment[] => {
    const record = toRecord(metadata);
    const raw = Array.isArray(record.attachments) ? record.attachments : [];
    return raw
      .map((item) => toRecord(item))
      .map((item) => ({
        name: asText(item.name),
        path: asText(item.path),
        size:
          typeof item.size === "number" && Number.isFinite(item.size)
            ? item.size
            : Number(String(item.size || 0)) || 0,
        mimeType: asText(item.mimeType) || undefined,
        uploadedAt: asText(item.uploadedAt) || undefined,
      }))
      .filter((item) => item.name || item.path);
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
      const metadata = toRecord(message.metadata);
      pushUser(
        asText(metadata.originalInput) || message.content || "",
        extractUserAttachments(metadata),
        message.messageKey,
      );
      continue;
    }

    if (message.type === "agent_message") {
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
      const event = toRecord(metadata.event);
      const item = toRecord(event.item);
      const eventType = asText(metadata.eventType).toLowerCase();
      const itemType =
        asText(metadata.itemType).toLowerCase() ||
        asText(item.type).toLowerCase();
      const content =
        asText(item.text) ||
        asText(item.content) ||
        asText(item.message) ||
        (message.content || "").trim();

      if (eventType === "turn.started") {
        pushProgress("Codex 开始执行", "execution", message.messageKey);
        continue;
      }

      if (eventType === "turn.completed") {
        flushProgress();
        items.push({
          kind: "capsule",
          label: "Codex 执行完成",
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
            (eventType === "turn.interrupted" ? "Codex 执行已中断" : "Codex 执行失败"),
          tone: "error",
          messageKey: message.messageKey,
        });
        continue;
      }

      if (eventType === "stderr.line" || eventType === "stdout.line") {
        continue;
      }

      flushProgress();
      if (itemType === "command_execution") {
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

      if (itemType === "file_change") {
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

      if (itemType === "approval_request") {
        const approvalText =
          asText(metadata.approvalText) ||
          content ||
          "Codex 需要进一步授权后才能继续执行。";
        items.push({
          kind: "capsule",
          label: "需要授权",
          tone: "system",
          messageKey: message.messageKey,
        });
        pushAgentMarkdown(approvalText, message.messageKey, "Codex");
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
        isLikelyMarkdownText(content)
      ) {
        pushAgentMarkdown(content, message.messageKey, "Codex");
      } else {
        pushAgentPlain(content, "Codex", message.messageKey);
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
      const optionLines =
        message.options && message.options.length > 0
          ? `\n\n${message.options.map((opt) => `- ${opt}`).join("\n")}`
          : "";
      pushAgentMarkdown(
        `**需要补充信息**\n\n${message.question || "请补充更多信息"}${optionLines}`,
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

  flushProgress();
  return items;
}

type DirectTurnDraft = {
  userText: string;
  attachments?: UploadedTaskAttachment[];
  userMessageKey?: string;
  assistantParts: OpencodeTurnPart[];
  assistantPartIndex: Map<string, number>;
  assistantMessageIds: Set<string>;
  working: boolean;
  thinkingLabel?: string;
  messageKey?: string;
};

function extractUserAttachmentsFromMetadata(
  metadata: unknown,
): UploadedTaskAttachment[] {
  const record = toRecord(metadata);
  const raw = Array.isArray(record.attachments) ? record.attachments : [];
  return raw
    .map((item) => toRecord(item))
    .map((item) => ({
      name: asText(item.name),
      path: asText(item.path),
      size:
        typeof item.size === "number" && Number.isFinite(item.size)
          ? item.size
          : Number(String(item.size || 0)) || 0,
      mimeType: asText(item.mimeType) || undefined,
      uploadedAt: asText(item.uploadedAt) || undefined,
    }))
    .filter((item) => item.name || item.path);
}

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
  attachments?: UploadedTaskAttachment[],
  userMessageKey?: string,
): DirectTurnDraft {
  return {
    userText,
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
      directTurns.push(
        createDirectTurnDraft(
          message.content || "",
          extractUserAttachmentsFromMetadata(message.metadata),
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
  if (!messages.some((message) => message.type === "opencode_event")) {
    return buildLegacyChatItems(messages);
  }
  return buildDirectOpencodeChatItems(messages);
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

function MessageBubble({
  item,
  onOpenDiffPreview,
}: {
  item: ChatItem;
  onOpenDiffPreview?: (options?: {
    diffId?: string | null;
    filePath?: string | null;
    messageIndex?: number | null;
  }) => void;
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
            {item.userText ? (
              <span className="whitespace-pre-wrap break-words">{item.userText}</span>
            ) : null}
            {item.attachments?.length ? (
              <AttachmentChipList attachments={item.attachments} tone="inverse" />
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
          {item.text ? (
            <span className="whitespace-pre-wrap break-words">{item.text}</span>
          ) : null}
          {item.attachments?.length ? (
            <AttachmentChipList attachments={item.attachments} tone="inverse" />
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
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {item.author || "OpenCode"}
          </div>
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
        {item.author ? (
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
  const detailTitle = `${info.title}${summaryText ? ` · ${summaryText}` : ""}`;
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
            {explanationText}
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

/**
 * 获取 Agent 名称
 */
function getAgentName(agent?: string) {
  const nameMap: Record<string, string> = {
    system: "系统",
    intent_recognition: "意图识别",
    planning: "任务规划",
    execution_plan: "执行计划",
  };
  return agent ? nameMap[agent] || agent : "智能体";
}
