/**
 * Design Philosophy: Swiss International Style + Digital Minimalism
 * New Task Dialog - Modal dialog for creating new tasks
 */

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Mic, Send } from "lucide-react";
import { useState } from "react";
import ConnectorDialog from "@/components/ConnectorDialog";
import TaskCreationChat from "@/components/TaskCreationChat";
import AttachmentChipList from "@/components/AttachmentChipList";
import AttachmentPickerButton from "@/components/AttachmentPickerButton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DEFAULT_ATTACHMENT_PROMPT,
  mergePendingAttachments,
  type PendingAttachment,
} from "@/lib/task-attachments";
import { toast } from "sonner";

interface NewTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function NewTaskDialog({
  open,
  onOpenChange,
}: NewTaskDialogProps) {
  const [message, setMessage] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [showAgentChat, setShowAgentChat] = useState(false);
  const [initialAgentInput, setInitialAgentInput] = useState("");
  const [initialAttachments, setInitialAttachments] = useState<File[]>([]);

  const handleSend = () => {
    const trimmed = message.trim();
    if (!trimmed && attachments.length === 0) return;
    setInitialAgentInput(trimmed || DEFAULT_ATTACHMENT_PROMPT);
    setInitialAttachments(attachments.map((item) => item.file));
    setShowAgentChat(true);
    setMessage("");
    setAttachments([]);
  };

  const handleAttachmentSelect = (files: File[]) => {
    const merged = mergePendingAttachments(attachments, files);
    setAttachments(merged.attachments);
    merged.rejected.forEach((item) => toast.error(item));
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((item) => item.id !== id));
  };

  const handleDialogChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (nextOpen) return;
    setMessage("");
    setAttachments([]);
    setShowAgentChat(false);
    setInitialAgentInput("");
    setInitialAttachments([]);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleDialogChange}>
        <DialogContent className="flex max-h-[80vh] max-w-5xl flex-col gap-0 overflow-hidden border-2 p-0 sm:max-w-5xl">
          {/* Dialog Header */}
          <DialogHeader className="shrink-0 px-6 pt-6 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-foreground rounded-xl flex items-center justify-center">
                <span className="text-background font-bold text-lg">M</span>
              </div>
              <div>
                <DialogTitle className="text-2xl font-semibold">
                  AI Agent
                </DialogTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  What can I help you with today?
                </p>
              </div>
            </div>
          </DialogHeader>

          {/* Main Content */}
          <div className="flex min-h-0 flex-1 flex-col px-6 pb-6">
            {!showAgentChat ? (
              <>
                {/* Input Area */}
                <div className="bg-card border-2 border-border rounded-2xl">
                  {/* Text Area and Actions */}
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
                      autoFocus
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

                          <ConnectorDialog />
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
                                className="h-9 w-9 rounded-xl bg-foreground hover:bg-foreground/90 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
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

                {/* Quick Actions */}
                <div className="grid grid-cols-2 gap-3 mt-4">
                  {[
                    "Analyze data",
                    "Generate report",
                    "Create presentation",
                    "Code assistant",
                  ].map((action) => (
                    <Button
                      key={action}
                      variant="outline"
                      className="h-11 rounded-xl border-border hover:bg-accent hover:border-primary/30 transition-all duration-200 text-sm font-medium"
                      onClick={() => setMessage(action)}
                    >
                      {action}
                    </Button>
                  ))}
                </div>
              </>
            ) : (
              <div className="min-h-0 flex-1 pt-2">
                <TaskCreationChat
                  initialInput={initialAgentInput}
                  initialAttachments={initialAttachments}
                  onPlanGenerated={(plan) => {
                    console.log("计划生成:", plan);
                    onOpenChange(false);
                    setShowAgentChat(false);
                    setInitialAgentInput("");
                    setInitialAttachments([]);
                    // TODO: 跳转到项目详情页面
                  }}
                />
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
