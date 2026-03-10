/**
 * Design Philosophy: Swiss International Style + Digital Minimalism
 * CEO View Page - Chat with CEO AI to manage projects and managers
 */

import { useState } from "react";
import { toast } from "sonner";
import WorkspaceLayout from "@/components/WorkspaceLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import AttachmentChipList from "@/components/AttachmentChipList";
import AttachmentPickerButton from "@/components/AttachmentPickerButton";
import {
  TrendingUp,
  Users,
  FolderOpen,
  Target,
  Mic,
  Send,
  Sparkles,
} from "lucide-react";
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
import { mergePendingAttachments, type PendingAttachment } from "@/lib/task-attachments";

// 模拟数据
const mockProjects = [
  {
    id: "1",
    name: "E-commerce Platform",
    status: "active",
    progress: 65,
    managersCount: 3,
    employeesCount: 8,
    tasksTotal: 12,
    tasksCompleted: 8,
  },
  {
    id: "2",
    name: "Mobile App Development",
    status: "active",
    progress: 45,
    managersCount: 2,
    employeesCount: 5,
    tasksTotal: 10,
    tasksCompleted: 4,
  },
  {
    id: "3",
    name: "Marketing Campaign",
    status: "active",
    progress: 90,
    managersCount: 2,
    employeesCount: 4,
    tasksTotal: 8,
    tasksCompleted: 7,
  },
  {
    id: "4",
    name: "Data Analytics Platform",
    status: "paused",
    progress: 30,
    managersCount: 1,
    employeesCount: 3,
    tasksTotal: 15,
    tasksCompleted: 5,
  },
  {
    id: "5",
    name: "Customer Portal",
    status: "completed",
    progress: 100,
    managersCount: 2,
    employeesCount: 6,
    tasksTotal: 20,
    tasksCompleted: 20,
  },
];

export default function CEOView() {
  const [message, setMessage] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [selectedModel, setSelectedModel] = useState("Agent Pro");
  const projects = mockProjects;

  // 计算统计数据
  const stats = {
    totalProjects: projects.length,
    activeProjects: projects.filter((p) => p.status === "active").length,
    totalManagers: projects.reduce((sum, p) => sum + p.managersCount, 0),
    totalEmployees: projects.reduce((sum, p) => sum + p.employeesCount, 0),
    totalTasks: projects.reduce((sum, p) => sum + p.tasksTotal, 0),
    completedTasks: projects.reduce((sum, p) => sum + p.tasksCompleted, 0),
    averageProgress: Math.round(
      projects.reduce((sum, p) => sum + p.progress, 0) / projects.length
    ),
  };

  const handleSend = () => {
    if (message.trim() || attachments.length > 0) {
      // TODO: 实现发送消息逻辑
      console.log("Sending message:", message, attachments.map((item) => item.name));
      setMessage("");
      setAttachments([]);
    }
  };

  const handleAttachmentSelect = (files: File[]) => {
    const merged = mergePendingAttachments(attachments, files);
    setAttachments(merged.attachments);
    merged.rejected.forEach((item) => toast.error(item));
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((item) => item.id !== id));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <WorkspaceLayout>
      <div className="flex flex-col h-[calc(100vh-3.5rem)] overflow-hidden">
        {/* 上方：统计数据卡片 */}
        <div className="flex-shrink-0 p-6 space-y-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">总经理视图</h1>
            <p className="text-muted-foreground mt-1">
              与总经理 AI 对话，调度项目和经理
            </p>
          </div>

          {/* 关键指标卡片 - 横向排列 */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* 项目总数 */}
            <Card className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">项目总数</p>
                  <p className="text-3xl font-bold mt-2">{stats.totalProjects}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {stats.activeProjects} 个进行中
                  </p>
                </div>
                <div className="w-12 h-12 bg-blue-500/10 rounded-xl flex items-center justify-center">
                  <FolderOpen className="w-6 h-6 text-blue-500" />
                </div>
              </div>
            </Card>

            {/* 团队规模 */}
            <Card className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">团队规模</p>
                  <p className="text-3xl font-bold mt-2">
                    {stats.totalManagers + stats.totalEmployees}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {stats.totalManagers} 经理 · {stats.totalEmployees} 员工
                  </p>
                </div>
                <div className="w-12 h-12 bg-green-500/10 rounded-xl flex items-center justify-center">
                  <Users className="w-6 h-6 text-green-500" />
                </div>
              </div>
            </Card>

            {/* 任务完成率 */}
            <Card className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">任务完成率</p>
                  <p className="text-3xl font-bold mt-2">
                    {Math.round((stats.completedTasks / stats.totalTasks) * 100)}%
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {stats.completedTasks} / {stats.totalTasks} 已完成
                  </p>
                </div>
                <div className="w-12 h-12 bg-purple-500/10 rounded-xl flex items-center justify-center">
                  <Target className="w-6 h-6 text-purple-500" />
                </div>
              </div>
            </Card>

            {/* 平均进度 */}
            <Card className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">平均进度</p>
                  <p className="text-3xl font-bold mt-2">{stats.averageProgress}%</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    所有项目平均
                  </p>
                </div>
                <div className="w-12 h-12 bg-orange-500/10 rounded-xl flex items-center justify-center">
                  <TrendingUp className="w-6 h-6 text-orange-500" />
                </div>
              </div>
            </Card>
          </div>
        </div>

        {/* 下方：聊天区域（包含消息列表和输入框） */}
        <div className="flex-1 flex flex-col min-h-0 px-6 pb-6">
          {/* 聊天消息区域 - 可滚动 */}
          <div className="flex-1 overflow-y-auto mb-4 scrollbar-thin scrollbar-thumb-muted-foreground/20 scrollbar-track-transparent">
            <div className="max-w-4xl mx-auto">
              {/* 欢迎消息 */}
              <div className="flex items-start gap-4 mb-6">
                <div className="w-10 h-10 bg-primary rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-primary-foreground font-semibold text-sm">
                    CEO
                  </span>
                </div>
                <div className="flex-1">
                  <div className="bg-muted/50 rounded-2xl rounded-tl-none p-4">
                    <p className="text-sm leading-relaxed">
                      您好！我是总经理 AI 助手。我可以帮助您：
                    </p>
                    <ul className="text-sm leading-relaxed mt-2 space-y-1 list-disc list-inside text-muted-foreground">
                      <li>查看和分析项目进度</li>
                      <li>调度和分配经理资源</li>
                      <li>评估团队绩效</li>
                      <li>制定战略决策</li>
                      <li>优化项目优先级</li>
                    </ul>
                    <p className="text-sm leading-relaxed mt-2">
                      请告诉我您需要什么帮助？
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2 ml-1">
                    刚刚
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* 输入框区域 - 固定在聊天区底部 */}
          <div className="flex-shrink-0">
            <div className="max-w-4xl mx-auto">
              <Card className="p-4">
                <div className="space-y-3">
                  {/* Textarea */}
                  <Textarea
                    placeholder="输入您的指令或问题..."
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="border-0 bg-transparent focus-visible:ring-0 text-base resize-none min-h-[100px] px-0 py-0"
                    rows={4}
                  />

                  <AttachmentChipList attachments={attachments} onRemove={removeAttachment} />

                  {/* Bottom Action Bar */}
                  <TooltipProvider>
                    <div className="flex items-center justify-between pt-2">
                      {/* Left Side Actions */}
                      <div className="flex items-center gap-1">
                        <AttachmentPickerButton onSelectFiles={handleAttachmentSelect} />

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
                              onClick={handleSend}
                              disabled={!message.trim() && attachments.length === 0}
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
      </div>
    </WorkspaceLayout>
  );
}
