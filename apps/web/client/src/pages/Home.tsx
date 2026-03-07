/**
 * Design Philosophy: Swiss International Style + Digital Minimalism
 * - Centered content with clear hierarchy
 * - Consistent input experience across pages
 * - 支持对话模式和任务创建智能体
 */

import { useState, useRef, useEffect, useMemo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import WorkspaceLayout from "@/components/WorkspaceLayout";
import ProjectDetail from "./ProjectDetail";
import {
  Mic,
  Plug,
  Send,
  Plus,
  Sparkles,
  Loader2,
  FilePlus,
  FilePenLine,
  FileText,
  FileDiff,
  Terminal,
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
import ConnectorDialog from "@/components/ConnectorDialog";
import TaskRuntimeDrawer from "@/components/TaskRuntimeDrawer";
import OpencodePreviewPanel from "@/components/OpencodePreviewPanel";
import { motion, AnimatePresence } from "framer-motion";
import { useTaskCreationAgent, type AgentMessage } from "@/hooks/useTaskCreationAgent";
import { buildPreviewItems, extractDiffPayload } from "@/lib/opencode-preview";
import { useLocation, useSearch } from "wouter";
import { Streamdown } from "streamdown";

type PageMode = 'input' | 'chat';

export default function Home() {
  const [location] = useLocation();
  const search = useSearch();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [mode, setMode] = useState<PageMode>('input');
  const [message, setMessage] = useState("");
  const [showConnector, setShowConnector] = useState(false);
  const [showRuntimeDrawer, setShowRuntimeDrawer] = useState(false);
  const [selectedModel, setSelectedModel] = useState("Agent Pro");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewTab, setPreviewTab] = useState<"files" | "changes" | "debug">("files");
  const [selectedDiffId, setSelectedDiffId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pendingInputRef = useRef<string | null>(null);
  const sessionIdFromPath = useMemo(() => {
    const match = location.match(/^\/session\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }, [location]);
  const isHistoryView = useMemo(() => {
    const params = new URLSearchParams(search);
    return params.get("view") === "history";
  }, [search]);

  const {
    isConnected,
    isProcessing,
    messages,
    sessionId,
    currentQuestion,
    runtime,
    sendChatInput,
    answerQuestion,
  } = useTaskCreationAgent({
    autoRuntime: !isHistoryView,
    compactHistory: false,
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
    if (mode === 'chat') {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, mode]);

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
      setMode('chat');
      if (location.startsWith("/new-task") && sessionInQuery === params.get("sessionId")?.trim()) {
        const nextUrl = `/session/${encodeURIComponent(sessionInQuery)}${isHistoryView ? "?view=history" : ""}`;
        window.history.replaceState(null, "", nextUrl);
      }
    }

    if (input && location.startsWith("/new-task")) {
      pendingInputRef.current = input;
      setMode('chat');
      const nextUrl = sessionInQuery
        ? `/session/${encodeURIComponent(sessionInQuery)}`
        : "/new-task";
      window.history.replaceState(null, "", nextUrl);
    }
  }, [location, search, sessionIdFromPath]);

  useEffect(() => {
    if (!pendingInputRef.current) {
      return;
    }
    const input = pendingInputRef.current;
    pendingInputRef.current = null;
    void sendChatInput(input);
  }, [sendChatInput]);

  const exitHistoryView = () => {
    if (!isHistoryView) return;
    const base = sessionId
      ? `/session/${encodeURIComponent(sessionId)}`
      : location.startsWith("/session/")
        ? location
        : "/new-task";
    window.history.replaceState(null, "", base);
  };

  const handleSend = () => {
    if (message.trim()) {
      const input = message.trim();
      // 切换到对话模式
      setMode('chat');
      exitHistoryView();
      void sendChatInput(input);
      setMessage("");
    }
  };

  const handleQuickAction = (action: string) => {
    setMode('chat');
    exitHistoryView();
    void sendChatInput(action);
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
    value.replace(/\\+/g, "/").replace(/^\.\/+/, "").toLowerCase();

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
        item.files?.some((file) =>
          pathMatches(file.file, filePath) || (fileName ? file.file.toLowerCase().includes(fileName) : false)
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

  const findDiffIdForMessageIndex = (messageIndex: number | null | undefined) => {
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

  return (
    <WorkspaceLayout
      selectedProjectId={selectedProjectId}
      onProjectSelect={setSelectedProjectId}
    >
      {selectedProjectId ? (
        <ProjectDetail projectId={selectedProjectId} onBack={() => setSelectedProjectId(null)} />
      ) : (
        <div
          className={`flex flex-col min-h-[calc(100vh-2rem)] ${
            mode === "chat" ? "h-[calc(100vh-2rem)] overflow-hidden" : ""
          }`}
        >
          <AnimatePresence mode="wait">
            {mode === 'input' ? (
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
                        <span className="text-background font-bold text-xl">M</span>
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

                      {/* Bottom Action Bar */}
                      <TooltipProvider>
                        <div className="flex items-center justify-between pt-2">
                          {/* Left Side Actions */}
                          <div className="flex items-center gap-1">
                            {/* Add Attachment Button */}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-9 w-9 rounded-xl hover:bg-muted transition-colors"
                                >
                                  <Plus className="w-4 h-4 text-muted-foreground" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Add attachment</p>
                              </TooltipContent>
                            </Tooltip>

                            {/* Connector Button */}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-9 w-9 rounded-xl hover:bg-muted transition-colors"
                                  onClick={() => setShowConnector(true)}
                                >
                                  <Plug className="w-4 h-4 text-muted-foreground" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Connector</p>
                              </TooltipContent>
                            </Tooltip>

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
                                      <span className="text-sm text-muted-foreground">{selectedModel}</span>
                                    </Button>
                                  </DropdownMenuTrigger>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Select AI model</p>
                                </TooltipContent>
                              </Tooltip>
                              <DropdownMenuContent align="start" className="w-40">
                                <DropdownMenuItem onClick={() => setSelectedModel("Agent Lite")}>
                                  <div className="flex flex-col">
                                    <span className="font-medium">Agent Lite</span>
                                    <span className="text-xs text-muted-foreground">Fast & efficient</span>
                                  </div>
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setSelectedModel("Agent Pro")}>
                                  <div className="flex flex-col">
                                    <span className="font-medium">Agent Pro</span>
                                    <span className="text-xs text-muted-foreground">Balanced performance</span>
                                  </div>
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setSelectedModel("Agent Max")}>
                                  <div className="flex flex-col">
                                    <span className="font-medium">Agent Max</span>
                                    <span className="text-xs text-muted-foreground">Maximum capability</span>
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
                                  disabled={!message.trim()}
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
                className="flex-1 min-h-0 overflow-hidden"
              >
                <div
                  className={`grid gap-4 h-full min-h-0 ${
                    previewOpen ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1"
                  }`}
                >
                  <section className="flex flex-col min-h-0 h-full">
                    <div className="flex flex-1 flex-col min-h-0 h-full rounded-2xl border border-border/70 bg-white shadow-sm overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-3 border-b border-border/70">
                        <div className="space-y-1">
                          <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                            Dialogue
                          </div>
                          <div className="text-sm font-semibold text-foreground">对话</div>
                        </div>
                        <div className="flex items-center gap-2">
                          {runtime.orchestratorSessionId && runtime.ready ? (
                            <span className="text-xs text-muted-foreground">
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
                      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
                        <div
                          className={`mx-auto w-full ${
                            previewOpen ? "max-w-3xl" : "max-w-5xl"
                          } space-y-4`}
                        >
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
                              icon={<Loader2 className={`w-4 h-4 ${runtime.syncing ? "animate-spin" : ""}`} />}
                              text={
                                `执行环境已接入（${runtime.orchestratorSessionId}）${runtime.latestType ? ` · ${runtime.latestType}` : ""}`
                              }
                            />
                          )}

                          <AnimatePresence>
                            {chatItems.map((item, index) => (
                              <MessageBubble key={index} item={item} onOpenDiffPreview={openDiffPreview} />
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
                        transition={{ delay: 0.2, duration: 0.4, ease: "easeOut" }}
                        className="mt-auto sticky bottom-0 z-10 border-t border-border/70 bg-background/95 backdrop-blur"
                      >
                        <div className="px-6 py-3">
                          <div
                            className={`mx-auto w-full ${
                              previewOpen ? "max-w-3xl" : "max-w-5xl"
                            } bg-card border-2 border-border rounded-3xl shadow-lg hover:shadow-xl transition-all duration-200`}
                          >
                            <div className="p-4 space-y-3">
                              <Textarea
                                placeholder={currentQuestion ? "请输入问题回答..." : "继续对话..."}
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
                                className="border-0 bg-transparent focus-visible:ring-0 text-base resize-none min-h-[56px] px-0 py-0"
                                rows={2}
                              />

                              <TooltipProvider>
                                <div className="flex items-center justify-between pt-2">
                                  <div className="flex items-center gap-1">
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-9 w-9 rounded-xl hover:bg-muted transition-colors"
                                        >
                                          <Plus className="w-4 h-4 text-muted-foreground" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        <p>Add attachment</p>
                                      </TooltipContent>
                                    </Tooltip>

                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-9 w-9 rounded-xl hover:bg-muted transition-colors"
                                          onClick={() => setShowConnector(true)}
                                        >
                                          <Plug className="w-4 h-4 text-muted-foreground" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        <p>Connector</p>
                                      </TooltipContent>
                                    </Tooltip>

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
                                              <span className="text-sm text-muted-foreground">{selectedModel}</span>
                                            </Button>
                                          </DropdownMenuTrigger>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                          <p>Select AI model</p>
                                        </TooltipContent>
                                      </Tooltip>
                                      <DropdownMenuContent align="start" className="w-40">
                                        <DropdownMenuItem onClick={() => setSelectedModel("Agent Lite")}>
                                          <div className="flex flex-col">
                                            <span className="font-medium">Agent Lite</span>
                                            <span className="text-xs text-muted-foreground">Fast & efficient</span>
                                          </div>
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => setSelectedModel("Agent Pro")}>
                                          <div className="flex flex-col">
                                            <span className="font-medium">Agent Pro</span>
                                            <span className="text-xs text-muted-foreground">Balanced performance</span>
                                          </div>
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => setSelectedModel("Agent Max")}>
                                          <div className="flex flex-col">
                                            <span className="font-medium">Agent Max</span>
                                            <span className="text-xs text-muted-foreground">Maximum capability</span>
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
                                          className="h-9 w-9 rounded-xl hover:bg-muted transition-colors"
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
                                          disabled={!message.trim()}
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
                          </div>
                        </div>
                      </motion.div>
                    </div>
                  </section>

                  {previewOpen ? (
                    <section className="flex flex-col min-h-0 h-full">
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
                        className="h-full min-h-0"
                      />
                    </section>
                  ) : null}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Connector Dialog */}
      <ConnectorDialog open={showConnector} onOpenChange={setShowConnector} />
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
  const toneClass =
    "border-border/70 bg-muted/50 text-foreground/80";

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
  | { kind: "user"; text: string }
  | { kind: "agent"; markdown: string }
  | { kind: "agent_plain"; text: string; author?: string }
  | {
      kind: "capsule";
      label: string;
      tone: "system" | "intent" | "planning" | "execution" | "review" | "error";
      loading?: boolean;
      segments?: string[];
    }
  | {
      kind: "opencode_tool";
      eventType: string;
      event: Record<string, unknown>;
      content?: string;
      metadata?: Record<string, unknown>;
      messageIndex: number;
      diffId?: string;
    };

type CapsuleTone = "system" | "intent" | "planning" | "execution" | "review" | "error";

export function buildChatItems(messages: AgentMessage[]): ChatItem[] {
  const items: ChatItem[] = [];
  let progressBuffer: { label: string; tone: CapsuleTone; loading: boolean } | null = null;
  const seenDiffs = new Set<string>();
  const seenFinalMessages = new Set<string>();
  const normalizeForDedup = (value: string): string => value.replace(/\r\n/g, "\n").trim();
  const userTextSet = new Set<string>();
  const finalizedPartIds = new Set<string>();
  const skipFinalIndices = new Set<number>();

  const getPartIdFromMetadata = (metadata: Record<string, unknown>): string => {
    const explicit = asText(metadata.partId);
    if (explicit) return explicit;
    const rawPayload = toRecord(metadata.rawPayload);
    const event = toRecord(rawPayload.event);
    const properties = toRecord(event.properties);
    const part = toRecord(properties.part);
    return asText(part.id) || asText(properties.partId);
  };

  // 预扫描：构建用户文本集、已终态 partId、每轮仅保留最后一条 final。
  let currentTurnFinalIndices: number[] = [];
  const flushTurnFinalIndices = () => {
    if (currentTurnFinalIndices.length <= 1) {
      currentTurnFinalIndices = [];
      return;
    }
    for (let i = 0; i < currentTurnFinalIndices.length - 1; i += 1) {
      skipFinalIndices.add(currentTurnFinalIndices[i]);
    }
    currentTurnFinalIndices = [];
  };
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.type === "user_input" || message.type === "user_response") {
      const normalized = normalizeForDedup(message.content || "");
      if (normalized) userTextSet.add(normalized);
      flushTurnFinalIndices();
      continue;
    }
    if (message.type !== "opencode_event") continue;
    const metadata = toRecord(message.metadata);
    const eventInfo = getOpencodeEventInfo(metadata);
    if (eventInfo.eventType === "message.final") {
      const partId = getPartIdFromMetadata(metadata);
      if (partId) finalizedPartIds.add(partId);
      currentTurnFinalIndices.push(index);
    }
  }
  flushTurnFinalIndices();

  const pushUser = (text: string) => {
    const normalized = normalizeForDedup(text);
    if (!normalized) return;
    const last = items[items.length - 1];
    if (last?.kind === "user" && normalizeForDedup(last.text) === normalized) {
      return;
    }
    items.push({
      kind: "user",
      text,
    });
  };

  const pushAgentMarkdown = (markdown: string) => {
    const normalized = normalizeForDedup(markdown);
    if (!normalized) return;
    const last = items[items.length - 1];
    if (last?.kind === "agent" && normalizeForDedup(last.markdown) === normalized) {
      return;
    }
    items.push({
      kind: "agent",
      markdown,
    });
  };

  const pushAgentPlain = (text: string, author?: string) => {
    const normalized = normalizeForDedup(text);
    if (!normalized) return;
    const last = items[items.length - 1];
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
    });
  };

  const getDiffSignature = (payload: ReturnType<typeof extractDiffPayload>): string | null => {
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
    });
    progressBuffer = null;
  };

  const pushProgress = (label: string, tone: CapsuleTone) => {
    progressBuffer = {
      label,
      tone,
      loading: isProgressLoadingLabel(label),
    };
  };

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.type === "user_input" || message.type === "user_response") {
      flushProgress();
      pushUser(message.content || "");
      continue;
    }

    if (message.type === "agent_message") {
      const parsed = extractCapsule(message.content || "");
      if (parsed) {
        if (isProgressStatusLabel(parsed.label) && !parsed.rest.trim()) {
          pushProgress(parsed.label, getCapsuleTone(parsed.label));
          continue;
        }
        flushProgress();
        items.push({
          kind: "capsule",
          label: parsed.label,
          tone: getCapsuleTone(parsed.label),
        });
        if (parsed.rest.trim()) {
          pushAgentMarkdown(`**${getAgentName(message.agent)}**\n\n${parsed.rest}`);
        }
        continue;
      }

      flushProgress();
      pushAgentMarkdown(`**${getAgentName(message.agent)}**\n\n${message.content || ""}`);
      continue;
    }

    if (message.type === "status_update") {
      const label = message.content || "状态更新";
      const tone = message.tone || getCapsuleTone(label);
      if (isProgressStatusLabel(label)) {
        pushProgress(label, tone);
      } else {
        flushProgress();
        items.push({
          kind: "capsule",
          label,
          tone,
        });
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
        if (skipFinalIndices.has(index)) {
          continue;
        }
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
          pushAgentMarkdown(`**OpenCode**\n\n${content}`);
        }
      } else if (eventInfo.partType === "text") {
        if (partId && finalizedPartIds.has(partId)) {
          continue;
        }
        if (normalizedContent && userTextSet.has(normalizedContent)) {
          continue;
        }
        if (content) {
          pushAgentPlain(content, "OpenCode");
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
        });
      }
      continue;
    }

    if (message.type === "error") {
      flushProgress();
      pushAgentMarkdown(`**错误**\n\n> ${message.message || "请求失败，请稍后重试"}`);
      continue;
    }

    if (message.type === "clarification_request") {
      flushProgress();
      const optionLines =
        message.options && message.options.length > 0
          ? `\n\n${message.options.map((opt) => `- ${opt}`).join("\n")}`
          : "";
      pushAgentMarkdown(`**需要补充信息**\n\n${message.question || "请补充更多信息"}${optionLines}`);
      continue;
    }

    if (message.type === "plan_generated") {
      flushProgress();
      pushAgentMarkdown(`**执行计划已生成**\n\n项目：${message.plan?.project?.title || "未命名项目"}`);
    }
  }

  flushProgress();
  return items;
}

function MessageBubble({
  item,
  onOpenDiffPreview,
}: {
  item: ChatItem;
  onOpenDiffPreview?: (options?: { diffId?: string | null; filePath?: string | null; messageIndex?: number | null }) => void;
}) {
  if (item.kind === "capsule") {
    const toneClass = "border-border/70 bg-muted/50 text-foreground/80";
    const segments = item.segments && item.segments.length > 0 ? item.segments : [item.label];
    const lastIndex = segments.length - 1;

    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="w-full"
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
                  {index < lastIndex ? <span className="px-1 text-slate-400">·</span> : null}
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
      >
        <div className="max-w-[80%] rounded-md bg-slate-900 px-3 py-2 text-sm text-white">
          <span className="whitespace-pre-wrap break-words">{item.text}</span>
        </div>
      </motion.div>
    );
  }

  if (item.kind === "opencode_tool") {
    return <OpencodeToolCard item={item} onOpenDiffPreview={onOpenDiffPreview} />;
  }

  if (item.kind === "agent_plain") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="w-full"
      >
        <div className="space-y-1.5 text-sm text-foreground">
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {item.author || "OpenCode"}
          </div>
          <div className="whitespace-pre-wrap break-words leading-6">{item.text}</div>
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
      <div className="max-w-none text-sm leading-7 text-foreground [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_strong]:font-semibold">
        <Streamdown>{item.markdown}</Streamdown>
      </div>
    </motion.div>
  );
}

function extractCapsule(content: string): { label: string; rest: string } | null {
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
      return { label, rest: text.slice(label.length).replace(/^[:：\-\s]+/, "").trim() };
    }
  }
  return null;
}

function isProgressStatusLabel(label: string): boolean {
  const text = label.trim();
  if (!text) return false;
  if (text.includes("错误") || text.includes("失败") || text.toLowerCase().includes("error")) {
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
  if (text.includes("错误") || text.includes("失败") || text.toLowerCase().includes("error")) {
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

function formatOpencodeEventLabel(eventType: string, stream: boolean): string {
  if (stream) return "OpenCode · 实时输出";
  if (!eventType) return "OpenCode";
  if (eventType === "message.final") return "OpenCode · 最终产出";
  if (eventType === "session.idle") return "OpenCode · 执行完成";
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
  if (value && typeof value === "object") return value as Record<string, unknown>;
  if (typeof value === "string") {
    const parsed = parseStructString(value);
    if (Object.keys(parsed).length > 0) return parsed;
  }
  return {};
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

type OpencodeEventInfo = {
  eventType: string;
  event: Record<string, unknown>;
  properties: Record<string, unknown>;
  part: Record<string, unknown>;
  partType: string;
  toolName: string;
};

function getOpencodeEventInfo(metadata: Record<string, unknown>): OpencodeEventInfo {
  const rawPayload = toRecord(metadata.rawPayload);
  const eventFromMeta = toRecord(metadata.event);
  const eventFromPayload = toRecord(rawPayload.event);
  const event = Object.keys(eventFromMeta).length > 0 ? eventFromMeta : eventFromPayload;
  const eventType = asText(metadata.eventType) || asText(event.type);
  const properties = toRecord(event.properties);
  const part = toRecord(properties.part);
  const partType = (asText(part.type) || asText(properties.type)).toLowerCase();
  const toolName = asText(part.tool) || asText(part.name) || asText(properties.tool);
  return {
    eventType,
    event,
    properties,
    part,
    partType,
    toolName,
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

function getToolInfo(tool: string, input: Record<string, unknown>) {
  const lower = tool.toLowerCase();
  switch (lower) {
    case "read":
      return { title: "读取", subtitle: getFilename(asText(input.filePath)) };
    case "list":
      return { title: "列出", subtitle: getDirectory(asText(input.path) || "/") };
    case "glob":
      return { title: "匹配", subtitle: asText(input.pattern) };
    case "grep":
      return { title: "搜索", subtitle: asText(input.pattern) };
    case "webfetch":
      return { title: "抓取", subtitle: asText(input.url) };
    case "task":
      return { title: "子任务", subtitle: asText(input.description) };
    case "bash":
      return { title: "Shell", subtitle: asText(input.description) || asText(input.command) };
    case "edit":
      return { title: "编辑", subtitle: getFilename(asText(input.filePath)) };
    case "write":
      return { title: "写入", subtitle: getFilename(asText(input.filePath)) };
    case "apply_patch":
      return {
        title: "补丁",
        subtitle: Array.isArray(input.files) ? `${input.files.length} 文件` : "",
      };
    case "todowrite":
      return { title: "待办" };
    case "question":
      return { title: "待确认" };
    default:
      return { title: tool || "Tool" };
  }
}

function OpencodeToolCard({
  item,
  onOpenDiffPreview,
}: {
  item: Extract<ChatItem, { kind: "opencode_tool" }>;
  onOpenDiffPreview?: (options?: { diffId?: string | null; filePath?: string | null; messageIndex?: number | null }) => void;
}) {
  const metadata = item.metadata || {};
  const { eventType, part, toolName, properties } = getOpencodeEventInfo(metadata);
  const toolState = toRecord(part.state);
  const rawInput = toolState.input ?? part.input;
  const input =
    typeof rawInput === "string" && rawInput.trim()
      ? { command: rawInput }
      : toRecord(rawInput);
  const metaInfo = toRecord(toolState.metadata);
  let output = asText(toolState.output) || asText(properties.output) || asText(item.content);
  const error = asText(toolState.error) || asText(properties.error);
  const status = asText(toolState.status) || asText(properties.status) || (error ? "error" : "unknown");

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
      <span className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] ${capsuleTone}`}>
        <Icon className="w-3.5 h-3.5" />
        <span>{text}</span>
      </span>
    );

    if (!title) return capsule;

    return (
      <Tooltip>
        <TooltipTrigger asChild>{capsule}</TooltipTrigger>
        <TooltipContent>
          <p className="max-w-xs break-words">{title}</p>
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
  const commandFromArgv = Array.isArray((properties as Record<string, unknown>).argv)
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
  if (!toolName) {
    if (eventType.startsWith("file.")) {
      const filePath = asText(properties.file) || asText(properties.path);
      info = {
        title: eventType === "file.watcher.updated" ? "文件监听" : "文件更新",
        subtitle: getFilename(filePath),
      };
    } else if (eventType === "command.executed") {
      info = {
        title: "命令执行",
        subtitle: asText(properties.command),
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
      Object.keys(metaInfo).length > 0
  );
  const summaryText = info.subtitle || "";

  if (isDiffEvent) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="w-full"
      >
        <button
          type="button"
          onClick={() => onOpenDiffPreview?.({ diffId: item.diffId, messageIndex: item.messageIndex })}
          className="text-left"
        >
          <EventCapsule icon={FileDiff} text="Diff · 点击查看更改" />
        </button>
      </motion.div>
    );
  }

  const extractTodos = (value: unknown): Array<Record<string, unknown>> => {
    if (Array.isArray(value)) {
      return value.filter((item) => item && typeof item === "object") as Array<Record<string, unknown>>;
    }
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (Array.isArray(record.todos)) {
        return record.todos.filter((item) => item && typeof item === "object") as Array<Record<string, unknown>>;
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
  const todosFromProps = todosFromInput.length > 0 || todosFromOutput.length > 0 ? [] : extractTodos(properties.todos);
  const todos = todosFromInput.length > 0 ? todosFromInput : todosFromOutput.length > 0 ? todosFromOutput : todosFromProps;

  const extractQuestions = (value: unknown): Array<{ header: string; question: string; options: string[] }> => {
    const mapOptions = (raw: unknown): string[] => {
      if (!Array.isArray(raw)) return [];
      return raw
        .map((option) => {
          if (typeof option === "string") return option.trim();
          if (option && typeof option === "object") {
            const record = option as Record<string, unknown>;
            return asText(record.label) || asText(record.text) || asText(record.value);
          }
          return "";
        })
        .filter(Boolean);
    };

    const normalizeQuestionRecord = (record: Record<string, unknown>) => {
      const question = asText(record.question) || asText(record.content) || asText(record.title);
      if (!question) return null;
      return {
        header: asText(record.header),
        question,
        options: mapOptions(record.options),
      };
    };

    if (Array.isArray(value)) {
      return value
        .map((item) => (item && typeof item === "object" ? normalizeQuestionRecord(item as Record<string, unknown>) : null))
        .filter((item): item is { header: string; question: string; options: string[] } => Boolean(item));
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

  const questionsFromInput = extractQuestions((input as { questions?: unknown[] }).questions);
  const questionsFromOutput = questionsFromInput.length > 0 ? [] : extractQuestions(output);
  const questionsFromProps =
    questionsFromInput.length > 0 || questionsFromOutput.length > 0 ? [] : extractQuestions(properties.questions);
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
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="w-full"
      >
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">待办</div>
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
                  <div key={`${content}-${index}`} className="flex items-center justify-between gap-3">
                    <div className="text-sm text-slate-800">{content}</div>
                    <div className="flex items-center gap-2">
                      {priority ? (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
                          {priority === "high" ? "高优先级" : priority === "medium" ? "中优先级" : "低优先级"}
                        </span>
                      ) : null}
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusTone}`}>
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
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">待确认</div>
          <div className="mt-3 space-y-3">
            {questions.map((question, index) => (
              <div key={`${question.question}-${index}`} className="space-y-1.5">
                {question.header ? (
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{question.header}</div>
                ) : null}
                <div className="text-sm text-slate-800">{question.question}</div>
                {question.options.length > 0 ? (
                  <ul className="list-disc pl-5 text-xs text-slate-600 space-y-1">
                    {question.options.map((option, optionIndex) => (
                      <li key={`${option}-${optionIndex}`}>{option}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
            <div className="text-xs text-slate-500">请直接在输入框回复你的选择或补充信息。</div>
          </div>
        </div>
      </motion.div>
    );
  }

  if (toolKey === "write" || toolKey === "edit") {
    const filePath =
      asText(input.filePath) || asText(input.path) || asText(properties.file) || asText(properties.path);
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
              onOpenDiffPreview?.({ filePath: filePath || null, messageIndex: item.messageIndex })
            }
            className="text-left"
          >
            <EventCapsule icon={toolKey === "write" ? FilePlus : FilePenLine} text={capsuleText} />
          </button>
        ) : (
          <EventCapsule icon={toolKey === "write" ? FilePlus : FilePenLine} text={capsuleText} />
        )}
      </motion.div>
    );
  }

  if (eventType === "command.executed") {
    const commandText = asText(properties.command) || asText(input.command) || asText(properties.cmd);
    const rawOutput =
      asText(properties.stdout) || asText(properties.output) || asText(properties.text) || output || error;
    const { text: outputText, truncated } = truncateText(rawOutput, 1200);
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="w-full"
      >
        <div className="space-y-2">
          <EventCapsule icon={Terminal} text="Shell 执行" title={commandHint || undefined} />
          {commandText ? (
            <div className="rounded-md bg-slate-900 px-3 py-2 text-xs text-slate-100 font-mono">
              {commandText}
            </div>
          ) : null}
          {outputText ? (
            <div className="rounded-md bg-slate-950 px-3 py-2 text-xs text-slate-100 font-mono whitespace-pre-wrap">
              {outputText}
            </div>
          ) : null}
          {truncated ? (
            <div className="text-[11px] text-slate-500">输出已截断，请查看日志</div>
          ) : null}
        </div>
      </motion.div>
    );
  }

  if (eventType.startsWith("file.")) {
    const filePath = asText(properties.file) || asText(properties.path);
    const label = eventType === "file.watcher.updated" ? "文件监听" : "文件更新";
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
              onOpenDiffPreview?.({ filePath: filePath || null, messageIndex: item.messageIndex })
            }
            className="text-left"
          >
            <EventCapsule icon={FileText} text={`${label} · ${getFilename(filePath) || "文件已更新"}`} />
          </button>
        ) : (
          <EventCapsule icon={FileText} text={`${label} · ${getFilename(filePath) || "文件已更新"}`} />
        )}
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
      <EventCapsule
        icon={toolKey === "bash" ? Terminal : FileText}
        text={`${info.title}${summaryText ? ` · ${summaryText}` : ""}`}
        title={toolKey === "bash" ? commandHint || undefined : undefined}
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
