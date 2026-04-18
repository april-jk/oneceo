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
import MessageAttachmentReference from "@/components/MessageAttachmentReference";
import {
  type TaskCreationPlatformSkill,
  uploadTaskCreationAttachment,
  type TaskCreationUploadedAttachment as UploadedTaskAttachment,
} from "@/lib/task-creation-client";
import {
  appendAttachmentsToPrompt,
  DEFAULT_ATTACHMENT_PROMPT,
  partitionPendingAttachments,
  type PendingAttachment,
} from "@/lib/task-attachments";
import {
  buildTaskSessionDeploymentPrompt,
  type TaskSessionDeploymentPromptAction,
} from "@/lib/task-session-deployment-prompts";
import { readAltusMode } from "@/lib/altus-settings";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

interface TaskCreationChatProps {
  onPlanGenerated?: (plan: any) => void;
  initialInput?: string;
  initialAttachments?: PendingAttachment[];
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

function getMessageSkills(message: AgentMessage): TaskCreationPlatformSkill[] {
  const raw = message?.metadata?.skills;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is TaskCreationPlatformSkill => {
    return (
      !!item &&
      typeof item === "object" &&
      typeof (item as TaskCreationPlatformSkill).skillId === "string" &&
      typeof (item as TaskCreationPlatformSkill).revisionId === "string" &&
      typeof (item as TaskCreationPlatformSkill).name === "string"
    );
  });
}

export default function TaskCreationChat({
  onPlanGenerated,
  initialInput,
  initialAttachments = [],
}: TaskCreationChatProps) {
  const { t } = useTranslation();
  const [userAnswer, setUserAnswer] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewTab, setPreviewTab] = useState<
    "files" | "changes" | "debug" | "deployment"
  >("files");
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
      const { uploadableAttachments, selectedSkills } =
        partitionPendingAttachments(initialAttachments);
      let targetSessionId = (sessionId || "").trim() || undefined;
      let uploadedAttachments: UploadedTaskAttachment[] = [];

      if (altusMode !== "managed" && uploadableAttachments.length > 0) {
        targetSessionId = await ensureSession(
          text || t("attachments.addedToWorkspace"),
        );
        uploadedAttachments = await Promise.all(
          uploadableAttachments.map((item) =>
            uploadTaskCreationAttachment(targetSessionId!, item.file),
          ),
        );
      }

      if (altusMode === "managed") {
        await sendChatInput(baseText, {
          sessionId: targetSessionId,
          metadata: hasAttachments
            ? {
                ...(selectedSkills.length ? { skills: selectedSkills } : {}),
                originalInput: text || t("attachments.addedToWorkspace"),
              }
            : undefined,
          files: uploadableAttachments.map((item) => item.file),
        });
      } else {
        await sendChatInput(
          appendAttachmentsToPrompt(baseText, uploadedAttachments),
          {
            sessionId: targetSessionId,
            metadata:
              uploadedAttachments.length || selectedSkills.length
                ? {
                    ...(uploadedAttachments.length
                      ? { attachments: uploadedAttachments }
                      : {}),
                    ...(selectedSkills.length
                      ? { skills: selectedSkills }
                      : {}),
                    originalInput: text || t("attachments.addedToWorkspace"),
                  }
                : undefined,
          },
        );
      }
    })().catch((error) => {
      console.error("任务创建附件发送失败:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : t("homeWorkspace.attachmentSendFailed"),
      );
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

  const submitDeploymentPrompt = async (
    action: TaskSessionDeploymentPromptAction,
  ) => {
    setPreviewTab("deployment");
    setPreviewOpen(true);
    await sendChatInput(buildTaskSessionDeploymentPrompt(action), {
      sessionId: sessionId || undefined,
    });
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
            {previewOpen
              ? t("homeWorkspace.hidePreview")
              : t("homeWorkspace.showPreview")}
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
          <div className="flex-1 min-h-0 space-y-3 overflow-y-auto overscroll-contain p-4">
            {!isConnected && (
              <Card className="border-yellow-500/30 bg-yellow-500/10 p-4">
                <div className="flex items-center gap-2 text-yellow-200">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">
                    {t("homeWorkspace.connectingAgent")}
                  </span>
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
                <span className="text-sm">
                  {t("homeWorkspace.agentProcessing")}
                </span>
              </motion.div>
            )}
          </div>

          {currentQuestion && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="shrink-0 border-t border-border/70 bg-muted/35 p-4"
            >
              <Card className="border-blue-500/30 bg-blue-500/10 p-4">
                <p className="mb-3 text-sm font-medium text-blue-100">
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
                            void interruptCurrentRun(
                              sessionId || undefined,
                            ).catch((error) => {
                              const text =
                                error instanceof Error
                                  ? error.message
                                  : String(error || "");
                              if (
                                /signal:\s*terminated/i.test(text) ||
                                /terminated/i.test(text)
                              ) {
                                return;
                              }
                              toast.error(
                                text || t("homeWorkspace.stopExecutionFailed"),
                              );
                            });
                          } else {
                            handleAnswerSubmit();
                          }
                        }
                      }}
                      placeholder={t("homeWorkspace.answerPlaceholder")}
                      className="flex-1"
                    />
                    <Button
                      onClick={() => {
                        if (showStopButton) {
                          void interruptCurrentRun(
                            sessionId || undefined,
                          ).catch((error) => {
                            const text =
                              error instanceof Error
                                ? error.message
                                : String(error || "");
                            if (
                              /signal:\s*terminated/i.test(text) ||
                              /terminated/i.test(text)
                            ) {
                              return;
                            }
                            toast.error(
                              text || t("homeWorkspace.stopExecutionFailed"),
                            );
                          });
                        } else {
                          handleAnswerSubmit();
                        }
                      }}
                      disabled={
                        isInterrupting ||
                        (showStopButton ? false : !userAnswer.trim())
                      }
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
            activeTab={previewTab}
            onTabChange={setPreviewTab}
            onToggle={() => setPreviewOpen(false)}
            onRequestDeployByMessage={() => {
              void submitDeploymentPrompt("deploy");
            }}
            onRequestRedeployByMessage={() => {
              void submitDeploymentPrompt("redeploy");
            }}
            onRequestRollbackByMessage={() => {
              void submitDeploymentPrompt("rollback");
            }}
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
  const { t } = useTranslation();
  const attachments = getMessageAttachments(message);
  const skills = getMessageSkills(message);

  const getAgentName = (agent?: string) => {
    const nameMap: Record<string, string> = {
      system: t("homeWorkspace.systemAgent"),
      intent_recognition: t("homeWorkspace.intentRecognition"),
      planning: t("homeWorkspace.taskPlanning"),
      execution_plan: t("homeWorkspace.executionPlan"),
    };
    return agent ? nameMap[agent] || agent : t("homeWorkspace.agentLabel");
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
            <p className="text-sm font-medium text-red-900">
              {t("homeWorkspace.errorTitle")}
            </p>
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
            <p className="text-sm font-medium text-green-900">
              {t("homeWorkspace.planGenerated")}
            </p>
            <p className="text-sm text-green-700 mt-1">
              {t("homeWorkspace.projectLabel")}：
              {message.plan?.project?.title ||
                t("homeWorkspace.unnamedProject")}
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
          {skills.length || attachments.length ? (
            <MessageAttachmentReference
              skills={skills}
              attachments={attachments}
              className="mt-3"
            />
          ) : null}
          <p className="text-sm text-muted-foreground mt-1">
            {message.content}
          </p>
        </div>
      </div>
    </Card>
  );
}
