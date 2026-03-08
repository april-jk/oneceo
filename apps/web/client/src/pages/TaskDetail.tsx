/**
 * Design Philosophy: Swiss International Style + Digital Minimalism
 * - Task detail page with conversation-style layout
 * - Manager-Employee interaction timeline
 * - CEO can communicate with manager at the bottom
 */

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Send,
  User,
  Users,
  CheckCircle2,
  Clock,
  FileText,
  AlertCircle,
  Plus,
  Sparkles,
  Mic,
} from "lucide-react";
import { useState } from "react";
import { useRoute } from "wouter";
import WorkspaceLayout from "@/components/WorkspaceLayout";
import { EmployeeDeliverableViewer, type EmployeeDeliverable } from "@/components/DeliverableViewer";
import ConnectorDialog from "@/components/ConnectorDialog";

interface Message {
  id: string;
  sender: "manager" | "employee" | "user";
  senderName: string;
  content: string;
  timestamp: string;
  type: "assignment" | "progress" | "deliverable" | "evaluation" | "message";
  deliverable?: {
    id: string;
    title: string;
    content: string;
    attachments: string[];
    submittedAt: string;
    evaluation?: "perfect" | "acceptable" | "rejected";
    feedback?: string;
  };
}

export default function TaskDetail() {
  const [, params] = useRoute("/task/:projectId/:managerId/:taskId");
  const [ceoMessage, setCeoMessage] = useState("");
  const [selectedDeliverable, setSelectedDeliverable] = useState<any>(null);
  const [selectedModel, setSelectedModel] = useState("Agent Pro");

  // Mock data - 模拟经理-员工对话数据
  const taskInfo = {
    projectName: "oneceo.ai",
    managerName: "开发经理",
    taskName: "API 设计与实现",
    status: "in_progress",
    priority: "high",
    deadline: "2026-02-15",
  };

  const messages: Message[] = [
    {
      id: "1",
      sender: "manager",
      senderName: "开发经理",
      content: "我需要你完成用户认证 API 的设计和实现，包括注册、登录和 JWT token 管理。请在 3 天内提交设计文档。",
      timestamp: "2026-02-01 09:00",
      type: "assignment",
    },
    {
      id: "2",
      sender: "employee",
      senderName: "后端工程师 Alice",
      content: "收到任务。我会先设计 API 接口规范，然后实现核心功能。预计明天提交设计文档。",
      timestamp: "2026-02-01 09:15",
      type: "progress",
    },
    {
      id: "3",
      sender: "employee",
      senderName: "后端工程师 Alice",
      content: "已完成 API 设计文档，包含接口定义、数据模型和安全策略。请审阅。",
      timestamp: "2026-02-02 14:30",
      type: "deliverable",
      deliverable: {
        id: "d1",
        title: "用户认证 API 设计文档",
        content: "## API 设计文档\n\n### 接口列表\n- POST /api/auth/register - 用户注册\n- POST /api/auth/login - 用户登录\n- POST /api/auth/refresh - 刷新 token\n\n### 安全策略\n- 使用 bcrypt 加密密码\n- JWT token 有效期 24 小时\n- Refresh token 有效期 7 天",
        attachments: ["api-spec.pdf", "data-model.png"],
        submittedAt: "2026-02-02 14:30",
        evaluation: "perfect",
        feedback: "设计非常完善，安全策略考虑周全。可以开始实现了。",
      },
    },
    {
      id: "4",
      sender: "manager",
      senderName: "开发经理",
      content: "设计非常完善，安全策略考虑周全。可以开始实现了。评价：完美",
      timestamp: "2026-02-02 16:00",
      type: "evaluation",
    },
    {
      id: "5",
      sender: "employee",
      senderName: "后端工程师 Alice",
      content: "开始实现 API 功能，预计 2 天内完成。",
      timestamp: "2026-02-02 16:30",
      type: "progress",
    },
  ];

  const handleSendMessage = () => {
    if (!ceoMessage.trim()) return;
    // TODO: 发送消息给经理
    console.log("CEO message to manager:", ceoMessage);
    setCeoMessage("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <WorkspaceLayout>
      <div className="flex flex-col h-full">
        {/* Task Header */}
        <div className="p-6 border-b border-border">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                <span>{taskInfo.projectName}</span>
                <span>/</span>
                <span>{taskInfo.managerName}</span>
              </div>
              <h1 className="text-2xl font-semibold text-foreground mb-3">
                {taskInfo.taskName}
              </h1>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    截止日期: {taskInfo.deadline}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-orange-500" />
                  <span className="text-sm font-medium text-orange-500">
                    高优先级
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-blue-500" />
                  <span className="text-sm text-muted-foreground">
                    进行中
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Conversation Area */}
        <ScrollArea className="flex-1 p-6">
          <div className="max-w-4xl mx-auto space-y-6">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex gap-4 ${
                  message.sender === "user" ? "flex-row-reverse" : "flex-row"
                }`}
              >
                {/* Avatar */}
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                    message.sender === "manager"
                      ? "bg-blue-100"
                      : message.sender === "employee"
                      ? "bg-green-100"
                      : "bg-purple-100"
                  }`}
                >
                  {message.sender === "manager" ? (
                    <User className="w-5 h-5 text-blue-600" />
                  ) : message.sender === "employee" ? (
                    <Users className="w-5 h-5 text-green-600" />
                  ) : (
                    <User className="w-5 h-5 text-purple-600" />
                  )}
                </div>

                {/* Message Content */}
                <div
                  className={`flex-1 max-w-2xl ${
                    message.sender === "user" ? "text-right" : ""
                  }`}
                >
                  <div
                    className={`flex items-center gap-2 mb-1 ${
                      message.sender === "user" ? "justify-end" : ""
                    }`}
                  >
                    <span className="text-sm font-medium text-foreground">
                      {message.senderName}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {message.timestamp}
                    </span>
                  </div>

                  <Card
                    className={`p-4 ${
                      message.sender === "user"
                        ? "bg-primary text-primary-foreground"
                        : message.sender === "manager"
                        ? "bg-card"
                        : "bg-accent/30"
                    }`}
                  >
                    <p className="text-sm whitespace-pre-wrap text-left">
                      {message.content}
                    </p>

                    {/* Deliverable */}
                    {message.deliverable && (
                      <div className="mt-3 pt-3 border-t border-border">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <FileText className="w-4 h-4 text-muted-foreground" />
                            <span className="text-sm font-medium text-foreground">
                              {message.deliverable.title}
                            </span>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setSelectedDeliverable(message.deliverable)
                            }
                          >
                            查看交付文档
                          </Button>
                        </div>
                        {message.deliverable.evaluation && (
                          <div className="mt-2 flex items-center gap-2">
                            <span
                              className={`text-xs px-2 py-1 rounded-full ${
                                message.deliverable.evaluation === "perfect"
                                  ? "bg-green-100 text-green-700"
                                  : message.deliverable.evaluation ===
                                    "acceptable"
                                  ? "bg-blue-100 text-blue-700"
                                  : "bg-red-100 text-red-700"
                              }`}
                            >
                              {message.deliverable.evaluation === "perfect"
                                ? "完美"
                                : message.deliverable.evaluation ===
                                  "acceptable"
                                ? "可接受"
                                : "不可接受"}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </Card>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>

        <Separator />

        {/* CEO Input Area - 与总经理视图样式一致 */}
        <div className="p-6 bg-card">
          <div className="max-w-4xl mx-auto">
            <div className="mb-3">
              <span className="text-sm font-medium text-foreground">
                与经理对话
              </span>
              <p className="text-xs text-muted-foreground mt-1">
                您可以向经理提出优化建议，经理将根据您的建议调度员工完成任务
              </p>
            </div>
            <Card className="p-4">
              <div className="space-y-3">
                {/* Textarea */}
                <Textarea
                  placeholder="输入您的指令或问题..."
                  value={ceoMessage}
                  onChange={(e) => setCeoMessage(e.target.value)}
                  onKeyDown={handleKeyDown}
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

                      <ConnectorDialog />

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
                        <DropdownMenuContent align="start" className="w-48">
                          <DropdownMenuItem
                            onClick={() => setSelectedModel("Agent Lite")}
                          >
                            <div className="flex flex-col gap-1">
                              <span className="font-medium">Agent Lite</span>
                              <span className="text-xs text-muted-foreground">
                                Fast & efficient
                              </span>
                            </div>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setSelectedModel("Agent Pro")}
                          >
                            <div className="flex flex-col gap-1">
                              <span className="font-medium">Agent Pro</span>
                              <span className="text-xs text-muted-foreground">
                                Balanced performance
                              </span>
                            </div>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setSelectedModel("Agent Max")}
                          >
                            <div className="flex flex-col gap-1">
                              <span className="font-medium">Agent Max</span>
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
                            size="icon"
                            className="h-9 w-9 rounded-xl"
                            onClick={handleSendMessage}
                            disabled={!ceoMessage.trim()}
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
            </Card>
          </div>
        </div>
      </div>

      {/* Deliverable Viewer */}
      {selectedDeliverable && (
        <EmployeeDeliverableViewer
          deliverable={selectedDeliverable}
          open={!!selectedDeliverable}
          onOpenChange={(open) => !open && setSelectedDeliverable(null)}
        />
      )}
    </WorkspaceLayout>
  );
}
