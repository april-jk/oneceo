/**
 * 任务创建对话组件
 *
 * 显示与任务创建智能体的对话流程
 */

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Loader2, Send, CheckCircle2, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  useTaskCreationAgent,
  type AgentMessage,
} from "@/hooks/useTaskCreationAgent";
import { motion, AnimatePresence } from "framer-motion";
import OpencodePreviewPanel from "@/components/OpencodePreviewPanel";
import AttachmentChipList from "@/components/AttachmentChipList";
import { uploadTaskCreationAttachment } from "@/lib/task-creation-client";
import {
  appendAttachmentsToPrompt,
  DEFAULT_ATTACHMENT_PROMPT,
  mergePendingAttachments,
  partitionPendingAttachments,
  type UploadedTaskAttachment,
} from "@/lib/task-attachments";
import { toast } from "sonner";

interface TaskCreationChatProps {
  onPlanGenerated?: (plan: any) => void;
  initialInput?: string;
  initialAttachments?: File[];
}

function getMessageAttachments(
  message: AgentMessage,
): UploadedTaskAttachment[] {
  const raw = message?.metadata?.attachments;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is UploadedTaskAttachment => {
    return (
      !!item &&
      typeof item === "object" &&
      typeof item.name === "string" &&
      typeof item.size === "number"
    );
  });
}

function readAltusMode(): "sandbox" | "managed" {
  if (typeof window === "undefined") return "sandbox";
  try {
    return window.localStorage.getItem("altus_mode") === "managed" ? "managed" : "sandbox";
  } catch {
    return "sandbox";
  }
}

export default function TaskCreationChat({
  onPlanGenerated,
  initialInput,
  initialAttachments = [],
}: TaskCreationChatProps) {
  const [userAnswer, setUserAnswer] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const hasSentInitialInputRef = useRef(false);

  const {
    isConnected,
    isProcessing,
    isInterrupting,
    messages,
    sessionId,
    currentQuestion,
    sendChatInput,
    interruptCurrentRun,
    ensureSession,
    answerQuestion,
  } = useTaskCreationAgent({
    onPlanGenerated,
    onError: (error) => {
      console.error("任务创建失败:", error);
      toast.error(error);
    },
  });

  useEffect(() => {
    if (!isConnected || hasSentInitialInputRef.current) {
      return;
    }

    const text = initialInput?.trim() || "";
    const hasAttachments = initialAttachments.length > 0;
    const baseText = text || (hasAttachments ? DEFAULT_ATTACHMENT_PROMPT : "");
    if (!baseText) {
      return;
    }

    hasSentInitialInputRef.current = true;
    void (async () => {
      const altusMode = readAltusMode();
      const merged = mergePendingAttachments([], initialAttachments);
      merged.rejected.forEach((item) => toast.error(item));
      const { uploadableAttachments, inlinePromptAttachments } =
        partitionPendingAttachments(merged.attachments);
      let targetSessionId = (sessionId || "").trim() || undefined;
      let uploadedAttachments: UploadedTaskAttachment[] = [];

      if (altusMode !== "managed" && uploadableAttachments.length > 0) {
        targetSessionId = await ensureSession(text || "已添加附件");
        uploadedAttachments = await Promise.all(
          uploadableAttachments.map((item) =>
            uploadTaskCreationAttachment(targetSessionId!, item.file),
          ),
        );
      }

      if (altusMode === "managed") {
        await sendChatInput(
          appendAttachmentsToPrompt(baseText, inlinePromptAttachments),
          {
            sessionId: targetSessionId,
            metadata: hasAttachments
              ? {
                  ...(inlinePromptAttachments.length
                    ? { attachments: inlinePromptAttachments }
                    : {}),
                  originalInput: text || "已添加附件",
                }
              : undefined,
            files: uploadableAttachments.map((item) => item.file),
          },
        );
      } else {
        const promptAttachments = [
          ...uploadedAttachments,
          ...inlinePromptAttachments,
        ];
        await sendChatInput(
          appendAttachmentsToPrompt(baseText, promptAttachments),
          {
            sessionId: targetSessionId,
            metadata: promptAttachments.length
              ? {
                  attachments: promptAttachments,
                  originalInput: text || "已添加附件",
                }
              : undefined,
          },
        );
      }
    })().catch((error) => {
      console.error("任务创建附件发送失败:", error);
      toast.error(error instanceof Error ? error.message : "附件发送失败");
    });
  }, [
    ensureSession,
    initialAttachments,
    initialInput,
    isConnected,
    sendChatInput,
    sessionId,
  ]);

  const handleAnswerSubmit = () => {
    if (userAnswer.trim()) {
      answerQuestion(userAnswer);
      setUserAnswer("");
    }
  };

  const showStopButton = isProcessing && !currentQuestion && !userAnswer.trim();

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 md:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-full"
            onClick={() => setPreviewOpen((prev) => !prev)}
          >
            {previewOpen ? "隐藏预览" : "显示预览"}
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/70 bg-white shadow-sm">
          <div className="flex-1 min-h-0 space-y-3 overflow-y-auto overscroll-contain p-4">
            {!isConnected && (
              <Card className="border-yellow-200 bg-yellow-50 p-4">
                <div className="flex items-center gap-2 text-yellow-800">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">正在连接智能体...</span>
                </div>
              </Card>
            )}

            <AnimatePresence>
              {messages.map((message, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.3 }}
                >
                  <MessageCard message={message} />
                </motion.div>
              ))}
            </AnimatePresence>

            {isProcessing && !currentQuestion && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex items-center gap-2 text-muted-foreground"
              >
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">智能体正在处理...</span>
              </motion.div>
            )}
          </div>

          {currentQuestion && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="shrink-0 border-t border-border/70 bg-slate-50/70 p-4"
            >
              <Card className="border-blue-200 bg-blue-50 p-4">
                <p className="mb-3 text-sm font-medium text-blue-900">
                  {currentQuestion.question}
                </p>

                {currentQuestion.options &&
                currentQuestion.options.length > 0 ? (
                  <div className="grid grid-cols-2 gap-2">
                    {currentQuestion.options.map((option, index) => (
                      <Button
                        key={index}
                        variant="outline"
                        className="h-auto py-3 text-sm"
                        onClick={() => answerQuestion(option)}
                      >
                        {option}
                      </Button>
                    ))}
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Input
                      value={userAnswer}
                      onChange={(e) => setUserAnswer(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          if (showStopButton) {
                            void interruptCurrentRun(sessionId || undefined).catch((error) => {
                              const text = error instanceof Error ? error.message : String(error || "");
                              if (/signal:\s*terminated/i.test(text) || /terminated/i.test(text)) {
                                return;
                              }
                              toast.error(text || "停止执行失败");
                            });
                          } else {
                            handleAnswerSubmit();
                          }
                        }
                      }}
                      placeholder="请输入您的回答..."
                      className="flex-1"
                    />
                        <Button
                          onClick={() => {
                            if (showStopButton) {
                              void interruptCurrentRun(sessionId || undefined).catch((error) => {
                                const text = error instanceof Error ? error.message : String(error || "");
                                if (/signal:\s*terminated/i.test(text) || /terminated/i.test(text)) {
                                  return;
                                }
                                toast.error(text || "停止执行失败");
                              });
                            } else {
                              handleAnswerSubmit();
                            }
                          }}
                          disabled={isInterrupting || (showStopButton ? false : !userAnswer.trim())}
                          size="icon"
                        >
                          {showStopButton ? (
                            <Square className="w-4 h-4" />
                          ) : (
                            <Send className="w-4 h-4" />
                          )}
                        </Button>
                  </div>
                )}
              </Card>
            </motion.div>
          )}
        </div>
      </div>

      {previewOpen ? (
        <div className="min-h-0 min-w-0 md:w-[min(44%,32rem)] md:min-w-[20rem]">
          <OpencodePreviewPanel
            messages={messages}
            sessionId={sessionId}
            open={previewOpen}
            onToggle={() => setPreviewOpen(false)}
            className="h-full min-h-0"
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * 消息卡片组件
 */
function MessageCard({ message }: { message: AgentMessage }) {
  const attachments = getMessageAttachments(message);

  const getAgentName = (agent?: string) => {
    const nameMap: Record<string, string> = {
      system: "系统",
      intent_recognition: "意图识别",
      planning: "任务规划",
      execution_plan: "执行计划",
    };
    return agent ? nameMap[agent] || agent : "智能体";
  };

  const getIcon = (type: string) => {
    switch (type) {
      case "plan_generated":
        return <CheckCircle2 className="w-4 h-4 text-green-600" />;
      case "error":
        return <span className="text-red-600">❌</span>;
      default:
        return <span className="text-blue-600">🤖</span>;
    }
  };

  if (message.type === "error") {
    return (
      <Card className="p-4 bg-red-50 border-red-200">
        <div className="flex items-start gap-3">
          {getIcon(message.type)}
          <div className="flex-1">
            <p className="text-sm font-medium text-red-900">错误</p>
            <p className="text-sm text-red-700 mt-1">{message.message}</p>
          </div>
        </div>
      </Card>
    );
  }

  if (message.type === "plan_generated") {
    return (
      <Card className="p-4 bg-green-50 border-green-200">
        <div className="flex items-start gap-3">
          {getIcon(message.type)}
          <div className="flex-1">
            <p className="text-sm font-medium text-green-900">执行计划已生成</p>
            <p className="text-sm text-green-700 mt-1">
              项目：{message.plan?.project?.title || "未命名项目"}
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        {getIcon(message.type)}
        <div className="flex-1">
          <p className="text-sm font-medium text-foreground">
            {getAgentName(message.agent)}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {message.content}
          </p>
          {attachments.length ? (
            <AttachmentChipList attachments={attachments} className="mt-3" />
          ) : null}
        </div>
      </div>
    </Card>
  );
}
