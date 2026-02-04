/**
 * Design Philosophy: Swiss International Style + Digital Minimalism
 * - Centered content with clear hierarchy
 * - Consistent input experience across pages
 * - 支持对话模式和任务创建智能体
 */

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import WorkspaceLayout from "@/components/WorkspaceLayout";
import ProjectDetail from "./ProjectDetail";
import { Mic, Plug, Send, Plus, Sparkles, Loader2 } from "lucide-react";
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
import { motion, AnimatePresence } from "framer-motion";
import { useTaskCreationAgent, type AgentMessage } from "@/hooks/useTaskCreationAgent";

type PageMode = 'input' | 'chat';

export default function Home() {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [mode, setMode] = useState<PageMode>('input');
  const [message, setMessage] = useState("");
  const [showConnector, setShowConnector] = useState(false);
  const [selectedModel, setSelectedModel] = useState("Agent Pro");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const hasSentInitialInputRef = useRef(false);

  const {
    isConnected,
    isProcessing,
    messages,
    currentQuestion,
    sendUserInput,
    answerQuestion,
  } = useTaskCreationAgent({
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

  const handleSend = () => {
    if (message.trim()) {
      // 切换到对话模式
      setMode('chat');
      // 发送消息
      if (isConnected && !hasSentInitialInputRef.current) {
        sendUserInput(message.trim());
        hasSentInitialInputRef.current = true;
      }
      setMessage("");
    }
  };

  const handleQuickAction = (action: string) => {
    setMessage(action);
    setMode('chat');
    if (isConnected) {
      sendUserInput(action);
    }
  };

  const handleAnswerQuestion = (answer: string) => {
    answerQuestion(answer);
  };

  const quickActions = [
    { label: "我想做一个Python开发行业的市场调研", icon: "📊" },
    { label: "帮我分析竞争对手的产品策略", icon: "📄" },
    { label: "创建一个新产品的营销计划", icon: "🎨" },
    { label: "生成季度业务报告", icon: "💻" },
  ];

  return (
    <WorkspaceLayout
      selectedProjectId={selectedProjectId}
      onProjectSelect={setSelectedProjectId}
    >
      {selectedProjectId ? (
        <ProjectDetail projectId={selectedProjectId} onBack={() => setSelectedProjectId(null)} />
      ) : (
        <div className="flex flex-col h-full">
          <AnimatePresence mode="wait">
            {mode === 'input' ? (
              // 初始输入模式
              <motion.div
                key="input-mode"
                initial={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="flex items-center justify-center min-h-[calc(100vh-8rem)]"
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
                className="flex-1 flex flex-col"
              >
                {/* 对话区域 */}
                <div className="flex-1 overflow-y-auto">
                  <div className="container mx-auto px-6 py-6 max-w-3xl">
                    <div className="space-y-4">
                      {/* 连接状态 */}
                      {!isConnected && (
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                        >
                          <Card className="p-4 bg-yellow-50 border-yellow-200">
                            <div className="flex items-center gap-2 text-yellow-800">
                              <Loader2 className="w-4 h-4 animate-spin" />
                              <span className="text-sm">正在连接智能体...</span>
                            </div>
                          </Card>
                        </motion.div>
                      )}

                      {/* 消息列表 */}
                      <AnimatePresence>
                        {messages.map((msg, index) => (
                          <MessageBubble key={index} message={msg} />
                        ))}
                      </AnimatePresence>

                      {/* 处理中指示器 */}
                      {isProcessing && !currentQuestion && (
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="flex items-center gap-2 text-muted-foreground"
                        >
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span className="text-sm">智能体正在处理...</span>
                        </motion.div>
                      )}

                      {/* 澄清问题 */}
                      {currentQuestion && (
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                        >
                          <ClarificationCard
                            question={currentQuestion}
                            onAnswer={handleAnswerQuestion}
                          />
                        </motion.div>
                      )}

                      <div ref={messagesEndRef} />
                    </div>
                  </div>
                </div>

                {/* 固定在底部的输入框 */}
                <motion.div
                  initial={{ y: 100, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.2, duration: 0.4, ease: "easeOut" }}
                  className="border-t border-border bg-background/95 backdrop-blur"
                >
                  <div className="container mx-auto px-6 py-4 max-w-3xl">
                    <div className="flex items-center gap-3">
                      <Input
                        placeholder="继续对话..."
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
                        className="flex-1 h-12 rounded-xl"
                      />
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
                        className="h-12 w-12 rounded-xl"
                      >
                        <Send className="w-5 h-5" />
                      </Button>
                    </div>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Connector Dialog */}
      <ConnectorDialog open={showConnector} onOpenChange={setShowConnector} />
    </WorkspaceLayout>
  );
}

/**
 * 消息气泡组件
 */
function MessageBubble({ message }: { message: AgentMessage }) {
  const isUser = message.type === 'user_input';
  const isError = message.type === 'error';
  const isPlanGenerated = message.type === 'plan_generated';

  if (isError) {
    return (
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
        transition={{ duration: 0.3 }}
        className="flex justify-start"
      >
        <Card className="max-w-[80%] p-4 bg-red-50 border-red-200">
          <div className="flex items-start gap-3">
            <span className="text-red-600">❌</span>
            <div className="flex-1">
              <p className="text-sm font-medium text-red-900">错误</p>
              <p className="text-sm text-red-700 mt-1">{message.message}</p>
            </div>
          </div>
        </Card>
      </motion.div>
    );
  }

  if (isPlanGenerated) {
    return (
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
        transition={{ duration: 0.3 }}
        className="flex justify-start"
      >
        <Card className="max-w-[80%] p-4 bg-green-50 border-green-200">
          <div className="flex items-start gap-3">
            <span className="text-green-600">✅</span>
            <div className="flex-1">
              <p className="text-sm font-medium text-green-900">执行计划已生成</p>
              <p className="text-sm text-green-700 mt-1">
                项目：{message.plan?.project?.title || "未命名项目"}
              </p>
            </div>
          </div>
        </Card>
      </motion.div>
    );
  }

  if (isUser) {
    return (
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 20 }}
        transition={{ duration: 0.3 }}
        className="flex justify-end"
      >
        <div className="max-w-[80%] rounded-2xl bg-foreground text-background px-4 py-3">
          <p className="text-sm">{message.content}</p>
        </div>
      </motion.div>
    );
  }

  // AI 消息
  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.3 }}
      className="flex justify-start"
    >
      <Card className="max-w-[80%] p-4">
        <div className="flex items-start gap-3">
          <span className="text-blue-600">🤖</span>
          <div className="flex-1">
            <p className="text-xs font-medium text-muted-foreground mb-1">
              {getAgentName(message.agent)}
            </p>
            <StreamingText text={message.content} />
          </div>
        </div>
      </Card>
    </motion.div>
  );
}

/**
 * 流式文本组件（打字机效果）
 */
function StreamingText({ text }: { text: string }) {
  const [displayText, setDisplayText] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (currentIndex < text.length) {
      const timeout = setTimeout(() => {
        setDisplayText(prev => prev + text[currentIndex]);
        setCurrentIndex(prev => prev + 1);
      }, 20); // 20ms per character
      return () => clearTimeout(timeout);
    }
  }, [currentIndex, text]);

  return <p className="text-sm text-foreground whitespace-pre-wrap">{displayText}</p>;
}

/**
 * 澄清问题卡片组件
 */
function ClarificationCard({ 
  question, 
  onAnswer 
}: { 
  question: { question: string; options?: string[] };
  onAnswer: (answer: string) => void;
}) {
  const [answer, setAnswer] = useState("");

  return (
    <Card className="p-4 bg-blue-50 border-blue-200">
      <p className="text-sm font-medium text-blue-900 mb-3">
        {question.question}
      </p>

      {question.options && question.options.length > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          {question.options.map((option, index) => (
            <Button
              key={index}
              variant="outline"
              className="h-auto py-3 text-sm"
              onClick={() => onAnswer(option)}
            >
              {option}
            </Button>
          ))}
        </div>
      ) : (
        <div className="flex gap-2">
          <Input
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onAnswer(answer);
                setAnswer("");
              }
            }}
            placeholder="请输入您的回答..."
            className="flex-1"
          />
          <Button
            onClick={() => {
              onAnswer(answer);
              setAnswer("");
            }}
            disabled={!answer.trim()}
            size="icon"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      )}
    </Card>
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
