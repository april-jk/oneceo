/**
 * Design Philosophy: Swiss International Style + Digital Minimalism
 * CEO View Page - Chat with CEO AI to manage projects and managers
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
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
import { GuidedTour, type GuidedTourStep } from "@/components/GuidedTour";

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

const CEO_VIEW_TOUR_KEY = "oneceo:tour.ceo_view.completed";
const CEO_VIEW_STEPS: GuidedTourStep[] = [
  {
    id: "ceo-metrics",
    selector: '[data-tour="ceo-metrics"]',
    title: "跨项目指标",
    body: "这里用于快速判断项目规模、团队负载、任务完成率和整体进度。",
    placement: "bottom",
  },
  {
    id: "ceo-context",
    selector: '[data-tour="ceo-context-bubble"]',
    title: "总经理上下文",
    body: "适合问资源调度、项目优先级和团队绩效，不替代单任务执行。",
    placement: "bottom",
  },
  {
    id: "ceo-composer",
    selector: '[data-tour="ceo-composer"]',
    title: "发起调度问题",
    body: "可以带附件、连接器和执行强度，让总经理视角围绕项目治理给出判断。",
    placement: "top",
  },
];

export default function CEOView() {
  const { t } = useTranslation();
  const [message, setMessage] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [selectedModel, setSelectedModel] = useState<"lite" | "pro" | "max">("pro");
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
        <GuidedTour
          storageKey={CEO_VIEW_TOUR_KEY}
          steps={CEO_VIEW_STEPS}
          autoStart
        />
        {/* 上方：统计数据卡片 */}
        <div className="flex-shrink-0 p-6 space-y-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{t("ceoView.title")}</h1>
            <p className="text-muted-foreground mt-1">
              {t("ceoView.subtitle")}
            </p>
          </div>

          {/* 关键指标卡片 - 横向排列 */}
          <div data-tour="ceo-metrics" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* 项目总数 */}
            <Card className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{t("ceoView.totalProjects")}</p>
                  <p className="text-3xl font-bold mt-2">{stats.totalProjects}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("ceoView.activeProjects", { count: stats.activeProjects })}
                  </p>
                </div>
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--brand-soft)]">
                  <FolderOpen className="h-6 w-6 text-[var(--brand-link)]" />
                </div>
              </div>
            </Card>

            {/* 团队规模 */}
            <Card className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{t("ceoView.teamSize")}</p>
                  <p className="text-3xl font-bold mt-2">
                    {stats.totalManagers + stats.totalEmployees}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("ceoView.teamBreakdown", { managers: stats.totalManagers, employees: stats.totalEmployees })}
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
                  <p className="text-sm text-muted-foreground">{t("ceoView.taskCompletion")}</p>
                  <p className="text-3xl font-bold mt-2">
                    {Math.round((stats.completedTasks / stats.totalTasks) * 100)}%
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("ceoView.completedTasks", { completed: stats.completedTasks, total: stats.totalTasks })}
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
                  <p className="text-sm text-muted-foreground">{t("ceoView.averageProgress")}</p>
                  <p className="text-3xl font-bold mt-2">{stats.averageProgress}%</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("ceoView.averageProgressHint")}
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
              <div data-tour="ceo-context" className="flex items-start gap-4 mb-6">
                <div className="w-10 h-10 bg-primary rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-primary-foreground font-semibold text-sm">
                    CEO
                  </span>
                </div>
                <div className="flex-1">
                  <div
                    data-tour="ceo-context-bubble"
                    className="bg-muted/50 rounded-2xl rounded-tl-none p-4"
                  >
                    <p className="text-sm leading-relaxed">
                      {t("ceoView.welcomeIntro")}
                    </p>
                    <ul className="text-sm leading-relaxed mt-2 space-y-1 list-disc list-inside text-muted-foreground">
                      <li>{t("ceoView.helpItem1")}</li>
                      <li>{t("ceoView.helpItem2")}</li>
                      <li>{t("ceoView.helpItem3")}</li>
                      <li>{t("ceoView.helpItem4")}</li>
                      <li>{t("ceoView.helpItem5")}</li>
                    </ul>
                    <p className="text-sm leading-relaxed mt-2">
                      {t("ceoView.welcomeAsk")}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2 ml-1">
                    {t("ceoView.justNow")}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* 输入框区域 - 固定在聊天区底部 */}
          <div className="flex-shrink-0">
            <div className="max-w-4xl mx-auto">
              <Card data-tour="ceo-composer" className="p-4">
                <div className="space-y-3">
                  {/* Textarea */}
                  <Textarea
                    placeholder={t("ceoView.messagePlaceholder")}
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
                                    {t(`homePage.models.${selectedModel}`)}
                                  </span>
                                </Button>
                              </DropdownMenuTrigger>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>{t("homePage.selectModel")}</p>
                            </TooltipContent>
                          </Tooltip>
                          <DropdownMenuContent align="start" className="w-48">
                            <DropdownMenuItem
                              onClick={() => setSelectedModel("lite")}
                            >
                              <div className="flex flex-col gap-1">
                                <span className="font-medium">{t("homePage.models.lite")}</span>
                                <span className="text-xs text-muted-foreground">
                                  {t("ceoView.modelLiteHint")}
                                </span>
                              </div>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setSelectedModel("pro")}
                            >
                              <div className="flex flex-col gap-1">
                                <span className="font-medium">{t("homePage.models.pro")}</span>
                                <span className="text-xs text-muted-foreground">
                                  {t("ceoView.modelProHint")}
                                </span>
                              </div>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setSelectedModel("max")}
                            >
                              <div className="flex flex-col gap-1">
                                <span className="font-medium">{t("homePage.models.max")}</span>
                                <span className="text-xs text-muted-foreground">
                                  {t("ceoView.modelMaxHint")}
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
                            <p>{t("homePage.voiceInput")}</p>
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
                          <p>{t("homePage.sendMessage")}</p>
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
