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
import { Mic, Plug, Send, Plus } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import ConnectorDialog from "@/components/ConnectorDialog";
import TaskCreationChat from "@/components/TaskCreationChat";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTaskCreationAgent } from "@/hooks/useTaskCreationAgent";

interface NewTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function NewTaskDialog({ open, onOpenChange }: NewTaskDialogProps) {
  const [, setLocation] = useLocation();
  const [message, setMessage] = useState("");
  const [showConnector, setShowConnector] = useState(false);
  const [showAgentChat, setShowAgentChat] = useState(false);

  const { sendUserInput } = useTaskCreationAgent({
    onPlanGenerated: (plan) => {
      console.log("计划生成:", plan);
      // TODO: 保存计划并跳转到项目页面
      onOpenChange(false);
      setShowAgentChat(false);
    },
    onError: (error) => {
      console.error("任务创建失败:", error);
    },
  });

  const handleSend = () => {
    if (message.trim()) {
      // 显示智能体对话
      setShowAgentChat(true);
      // 发送用户输入到智能体
      sendUserInput(message);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl p-0 gap-0 border-2 max-h-[80vh] overflow-y-auto">
          {/* Dialog Header */}
          <DialogHeader className="px-6 pt-6 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-foreground rounded-xl flex items-center justify-center">
                <span className="text-background font-bold text-lg">M</span>
              </div>
              <div>
                <DialogTitle className="text-2xl font-semibold">AI Agent</DialogTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  What can I help you with today?
                </p>
              </div>
            </div>
          </DialogHeader>

          {/* Main Content */}
          <div className="px-6 pb-6">
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
              /* Agent Chat */
              <TaskCreationChat
                onPlanGenerated={(plan) => {
                  console.log("计划生成:", plan);
                  onOpenChange(false);
                  setShowAgentChat(false);
                  // TODO: 跳转到项目详情页面
                }}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Connector Dialog */}
      <ConnectorDialog open={showConnector} onOpenChange={setShowConnector} />
    </>
  );
}
