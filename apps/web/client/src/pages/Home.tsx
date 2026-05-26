/**
 * Design Philosophy: Swiss International Style + Digital Minimalism
 * - Centered content with clear hierarchy
 * - Consistent input experience across pages
 * - 支持对话模式和任务创建智能体
 */

import {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import WorkspaceLayout from "@/components/WorkspaceLayout";
import {
  Send,
  Square,
  Sparkles,
  Loader2,
  FilePlus,
  FilePenLine,
  FileSearch,
  FileText,
  FileDiff,
  FolderSearch2,
  Search,
  Plug,
  Terminal,
  Bug,
  Rocket,
  ChevronDown,
  ChevronRight,
  Figma,
  Check,
  Link,
  Trash2,
  X,
  PanelRightOpen,
  PanelRightClose,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import ConnectorDialog from "@/components/ConnectorDialog";
import VoiceInputButton from "@/components/VoiceInputButton";
import AttachmentChipList from "@/components/AttachmentChipList";
import AttachmentPickerButton from "@/components/AttachmentPickerButton";
import {
  MessageAttachmentFiles,
  MessageInlineReferences,
} from "@/components/MessageAttachmentReference";
import OpencodePreviewPanel from "@/components/OpencodePreviewPanel";
import AltusArtifactPreviewCard, {
  type AltusArtifactFile,
} from "@/components/AltusArtifactPreviewCard";
import TaskDeliverableCard from "@/components/TaskDeliverableCard";
import {
  GuidedTour,
  resolveGuidedTourStorageKey,
  type GuidedTourStep,
} from "@/components/GuidedTour";
import AltusRunReplayDrawer, {
  type AltusDrawerView,
  type AltusReplayAction,
  type AltusReplayFile,
} from "@/components/AltusRunReplayDrawer";
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
import {
  buildPreviewItems,
  extractDiffPayload,
  type PreviewDiffItem,
} from "@/lib/opencode-preview";
import {
  getTaskCreationDebugInfo,
  getWorkspaceRawFileUrl,
  listTaskCreationProjects,
  listTaskCreationSkills,
  uploadTaskCreationAttachment,
  type TaskCreationProjectSummary,
  type TaskCreationDeliverableArtifact,
  type TaskCreationPlatformSkill,
  type TaskCreationUploadedAttachment as UploadedTaskAttachment,
  type TaskCreationDebugInfo,
  type TaskCreationWebsitePreviewSnapshot,
} from "@/lib/task-creation-client";
import {
  approveMcpToolConfirmation,
  getMyConnectorAccounts,
  rejectMcpToolConfirmation,
} from "@/lib/connectors-client";
import {
  buildSlashText,
  parseTrailingSlashQuery,
  stripTrailingSlashQuery,
  type SlashReferenceKind,
} from "@/lib/slash-references";
import {
  appendAttachmentsToPrompt,
  consumePendingDraftAttachments,
  DEFAULT_ATTACHMENT_PROMPT,
  mergePendingAttachments,
  mergePendingPlatformSkills,
  partitionPendingAttachments,
  type PendingAttachment,
} from "@/lib/task-attachments";
import {
  extractFilesFromTransfer,
  hasFileTransfer,
} from "@/lib/task-attachment-transfer";
import {
  buildManagedTaskInputMetadata,
  type TaskCreationMcpReference,
} from "@/lib/task-input-metadata";
import {
  buildTaskSessionDeploymentPrompt,
  type TaskSessionDeploymentPromptAction,
} from "@/lib/task-session-deployment-prompts";
import { resolveUserMessageReferences } from "@/lib/message-reference-parser";
import { isManagedInternalSupportArtifact } from "@/lib/managed-artifact-visibility";
import { readAltusMode } from "@/lib/altus-settings";
import { shouldAutoCollapseSidebarForAltusActions } from "@/lib/altus-actions-layout";
import type { TaskProjectSelection } from "@/lib/task-project-selection";
import i18n from "@/i18n";
import { useLocation, useSearch } from "wouter";
import { Streamdown } from "streamdown";
import { useAuth } from "@/contexts/AuthContext";

type PageMode = "input" | "chat";
const BILLING_TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "stopped"]);
const HOME_NEW_TASK_TOUR_KEY = "oneceo:tour.home_new_task.completed";
const MANAGED_AUTO_DEBUG_READY_POLL_MS = 1000;
const MANAGED_AUTO_DEBUG_RETRY_POLL_MS = 2000;

export function resolveHomeSubmitActiveSessionId(input: {
  routeForcesNewSession: boolean;
  sessionId?: string | null;
  uploadSessionId?: string | null;
}): string {
  if (input.routeForcesNewSession) return "";
  return (input.sessionId || input.uploadSessionId || "").trim();
}

type HomeScenarioModel = "lite" | "pro" | "max";

type HomeCapabilityExample = {
  id: string;
  title: string;
  prompt: string;
  category?: string;
};

type HomeCapabilityGuideItem = {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  model: HomeScenarioModel;
  prompt: string;
  examples: HomeCapabilityExample[];
  skillHints?: string[];
  mcpHints?: string[];
};

const HOME_CAPABILITY_GUIDE_ITEMS: HomeCapabilityGuideItem[] = [
  {
    id: "slides",
    label: "制作幻灯片",
    description: "从目标、素材到可复核大纲",
    icon: FileText,
    model: "max",
    prompt: `请帮我制作一份面向 CEO 的产品复盘汇报 PPT。

目标：
1. 梳理本季度产品进展、关键风险和下一阶段优先级。
2. 把结论整理成 8-10 页的汇报结构。
3. 每页写清标题、核心观点、图表建议和需要补充的数据。

约束：
- 面向高层决策，不要堆砌过程细节。
- 结论要可追问、可复核。
- 输出先做成项目计划，方便我分配给团队继续补资料和设计。`,
    examples: [
      {
        id: "slides-competition",
        title: "出海竞品与渠道格局",
        prompt: `为 oneceo 的出海计划制作竞品与渠道格局汇报，覆盖北美与东南亚市场。请比较 5 个 AI Agent 平台在定价、渠道、功能深度、合规能力与客户结构上的差异，并输出 SWOT 和 90 天可执行策略。`,
      },
      {
        id: "slides-business-review",
        title: "OPC 周经营复盘汇报",
        prompt: `生成面向 OPC 团队负责人的周经营复盘 PPT：新增线索、渠道转化、试用到付费漏斗、ARPA、流失预警、交付效率和客服 SLA。要求给出异常原因、影响范围、责任人和下周动作。`,
      },
      {
        id: "slides-market-opportunity",
        title: "出海新市场机会评估",
        prompt: `为 oneceo 评估“日本中型技术服务公司”市场机会，输出 TAM/SAM/SOM、客户画像、本地化需求、合规风险、进入路径与 12 个月收入预测，并给出关键验证假设。`,
      },
      {
        id: "slides-team-status",
        title: "OPC 跨团队周状态模板",
        prompt: `创建 OPC 跨团队周状态报告模板，覆盖增长、销售、交付、客服四条线：本周目标达成、阻塞问题、资源占用、下周关键依赖和升级事项，适合管理层快速决策。`,
      },
    ],
    skillHints: ["ppt", "presentation", "slides", "deck"],
  },
  {
    id: "website",
    label: "创建网站",
    description: "从需求到结构、文案和验收",
    icon: Rocket,
    model: "max",
    prompt: `请帮我复盘一个 SaaS 产品发布页改版任务。

目标：
1. 对比当前首页信息架构，指出最影响转化的 3 个问题。
2. 给出一版新的首屏结构和模块顺序。
3. 输出可执行的设计验收清单，方便我分配给设计师和前端。

约束：
- 面向 B2B 团队管理员。
- 风格要克制、专业、可复核。
- 请把结论整理成项目计划，不要只给灵感。`,
    examples: [
      {
        id: "website-launch-ai-writer",
        category: "landing",
        title: "oneceo 出海落地页",
        prompt: `为 oneceo 构建英文出海落地页，目标是获取北美中型团队试用注册。核心模块：价值主张首屏、行业场景卡片（SaaS/Agency/Consulting）、客户案例、定价入口、FAQ、预约演示表单。风格：专业克制、B2B 高信任感。`,
      },
      {
        id: "website-mobile-app-download",
        category: "landing",
        title: "海外 Webinar 注册页",
        prompt: `为 oneceo 海外 Webinar「Scale Ops with AI Agents」构建注册页。需要包含议程、讲者、受众收益、时间时区切换、注册表单与邮件确认说明，重点提升活动报名转化。`,
      },
      {
        id: "website-brand-agency",
        category: "landing",
        title: "海外代理商合作页",
        prompt: `为 oneceo 构建海外渠道代理合作页，目标是招募区域合作伙伴。模块包含合作收益、返佣机制、支持政策、成功案例、申请流程与资质要求。`,
      },
      {
        id: "website-task-dashboard",
        category: "dashboard",
        title: "OPC 执行仪表盘",
        prompt: `构建 oneceo 的 OPC 执行仪表盘，展示目标完成率、关键任务状态、跨团队阻塞、升级事项和负责人负载。强调高密度信息与可追责链路。`,
      },
      {
        id: "website-crm-dashboard",
        category: "dashboard",
        title: "出海销售漏斗仪表盘",
        prompt: `构建出海销售漏斗仪表盘，包含线索来源、Demo 预约、POC 转化、签约周期、客单价和销售代表表现，支持按国家和行业筛选。`,
      },
      {
        id: "website-hr-dashboard",
        category: "dashboard",
        title: "全球团队用工健康看板",
        prompt: `为出海团队构建用工健康看板，跟踪各地区人效、招聘进度、流失风险和人员成本，支持按区域、部门、岗位类型切换。`,
      },
    ],
    skillHints: ["frontend", "design", "website"],
    mcpHints: ["figma", "vercel"],
  },
  {
    id: "app",
    label: "开发应用",
    description: "拆需求、写代码、预览和部署",
    icon: Terminal,
    model: "max",
    prompt: `请帮我设计并推进一个内部运营看板应用。

目标：
1. 明确首页、项目列表、任务详情和数据筛选的核心交互。
2. 拆出前端组件、接口依赖、状态管理和验收标准。
3. 给出第一版可开发任务清单，并标注风险点。

约束：
- 面向平台管理员高频使用，信息密度要高但不能混乱。
- 每个任务都要能被测试或人工验收。
- 需要考虑后续预览、调试和部署。`,
    examples: [
      {
        id: "app-admin-dashboard",
        title: "构建 OPC 指挥台",
        prompt: "为 oneceo 构建 OPC 指挥台，包含目标分解、任务推进、风险升级、责任人追踪和经营复盘入口，支持多团队并行协作。",
      },
      {
        id: "app-workflow-tracker",
        title: "搭建出海交付流转看板",
        prompt: "构建出海交付流转看板，包含线索接入、方案评估、POC、交付中、上线验收阶段，支持时区、语言和地区合规标记。",
      },
      {
        id: "app-release-console",
        title: "开发全球发布控制台",
        prompt: "开发全球发布控制台，支持多区域灰度、法规检查、发布审批、回滚策略和发布后观测，适用于跨国版本发布。",
      },
    ],
    skillHints: ["frontend", "development", "app"],
  },
  {
    id: "research",
    label: "深度研究",
    description: "收集证据、归纳判断和引用来源",
    icon: Search,
    model: "max",
    prompt: `请帮我做一次 AI Agent 平台竞品研究。

目标：
1. 比较 Manus、OpenAI Codex、Claude Code 和至少 2 个同类产品。
2. 提炼它们在任务入口、工具调用、交付物呈现和团队协作上的差异。
3. 输出 oneceo 可以借鉴的 5 条产品机会。

约束：
- 需要区分事实、推断和建议。
- 关键结论要有来源或证据说明。
- 输出要适合放入产品决策文档。`,
    examples: [
      {
        id: "research-competitor-matrix",
        title: "出海竞品能力矩阵",
        prompt: "研究 Manus、OpenAI Codex、Claude Code、Devin 在海外市场的能力与商业化差异，按目标客户、定价、合规和生态连接输出矩阵。",
      },
      {
        id: "research-pricing-analysis",
        title: "海外定价与包装策略",
        prompt: "分析海外 Agent 产品的 seat/usage/hybrid 定价模型，给出 oneceo 的套餐包装、试用策略和续费提升建议。",
      },
      {
        id: "research-go-to-market",
        title: "出海 GTM 路径建议",
        prompt: "围绕 OPC 与运营负责人场景，输出 oneceo 出海 GTM 方案：目标国家优先级、获客渠道、关键合作伙伴与 180 天执行节奏。",
      },
    ],
    skillHints: ["research", "wide-research"],
    mcpHints: ["notion", "github"],
  },
  {
    id: "spreadsheet",
    label: "分析表格",
    description: "清洗数据、找异常和做图表",
    icon: FileSearch,
    model: "pro",
    prompt: `请帮我分析一份团队运营表格。

目标：
1. 识别数据缺失、异常值和口径不一致的问题。
2. 找出项目延期、成本超预算和人员负载过高的风险。
3. 输出一份适合 CEO 快速查看的图表和结论清单。

约束：
- 先说明需要哪些字段和数据格式。
- 结论必须能回到原始数据复核。
- 不要只给笼统建议，要给下一步动作。`,
    examples: [
      {
        id: "spreadsheet-risk-scan",
        title: "识别出海经营风险",
        prompt: "分析出海运营表，识别 CAC 异常上升、试用转化下滑、回款延迟和交付超期风险，输出风险等级与建议动作。",
      },
      {
        id: "spreadsheet-ceo-brief",
        title: "生成 OPC 周经营简报",
        prompt: "基于运营数据生成 OPC 周经营简报：渠道表现、销售漏斗、交付效率、客户健康度和下周关键动作，结论可追溯。",
      },
      {
        id: "spreadsheet-data-cleaning",
        title: "统一跨区域数据口径",
        prompt: "对多国家运营数据做清洗与标准化，统一币种、时区、渠道命名与客户阶段口径，并输出复核规则。",
      },
    ],
    skillHints: ["spreadsheet", "excel", "table"],
  },
  {
    id: "project",
    label: "项目拆解",
    description: "把目标变成可分配计划",
    icon: FolderSearch2,
    model: "pro",
    prompt: `请帮我把“上线企业级权限系统”拆成一个可执行项目。

目标：
1. 拆出阶段、里程碑、负责人角色和交付物。
2. 标出最容易延期或返工的依赖。
3. 给出每周 CEO 复盘应该看的指标。

约束：
- 输出要便于放进 oneceo 项目管理。
- 每个任务都要有清晰验收标准。
- 不要做过度复杂的流程设计。`,
    examples: [
      {
        id: "project-enterprise-permission",
        title: "企业权限系统拆解",
        prompt: "把“上线企业级权限系统”拆成可执行项目，给出阶段目标、关键依赖、任务清单、负责人和验收标准。",
      },
      {
        id: "project-multi-team-delivery",
        title: "跨团队交付计划",
        prompt: "为跨前端、后端、设计和运维的项目构建交付计划，明确里程碑、阻塞点和每周复盘指标。",
      },
      {
        id: "project-rescue-plan",
        title: "延期项目抢救计划",
        prompt: "针对已延期项目输出抢救计划：优先级重排、范围收敛、资源调整和风险兜底，并给出两周执行路线图。",
      },
    ],
    skillHints: ["project", "plan"],
  },
  {
    id: "debug",
    label: "修复问题",
    description: "定位缺陷、修代码和补验证",
    icon: Bug,
    model: "max",
    prompt: `请帮我定位并修复一个前端交互问题。

现象：
点击引导的下一步后，当前设置界面会被意外关闭。

目标：
1. 找出触发关闭的事件链路。
2. 给出最短路径修复方案并说明影响范围。
3. 补充必要验证，确保引导不会打断原页面状态。

约束：
- 不做兼容性补丁，不绕过真实问题。
- 不要改无关 UI。
- 修复后需要说明验证路径。`,
    examples: [
      {
        id: "debug-ui-regression",
        title: "修复前端交互回归",
        prompt: "定位并修复“点击下一步导致设置弹窗退出”的交互回归问题，给出根因、修复点、影响范围和验证路径。",
      },
      {
        id: "debug-api-failure",
        title: "排查接口偶发失败",
        prompt: "排查任务提交接口偶发失败问题，输出复现条件、日志证据、根因判断和最短路径修复方案。",
      },
      {
        id: "debug-performance-drop",
        title: "修复性能退化",
        prompt: "分析最近版本页面卡顿问题，找出主要性能瓶颈并给出优先级排序的优化方案与验收指标。",
      },
    ],
    skillHints: ["debug", "code", "fix"],
    mcpHints: ["github"],
  },
  {
    id: "materials",
    label: "资料整合",
    description: "汇总多源材料形成可用结论",
    icon: FileSearch,
    model: "pro",
    prompt: `请帮我整理一次多来源资料分析任务。

目标：
1. 汇总需求文档、设计稿、代码变更和会议记录里的关键信息。
2. 找出当前结论之间的冲突、缺口和需要补证据的位置。
3. 输出一份可以直接进入项目决策的资料摘要。

约束：
- 不要简单复制原文，要提炼事实、判断和待确认问题。
- 每条关键结论都要能追溯到来源。
- 输出要方便团队成员继续执行。`,
    examples: [
      {
        id: "materials-design-dev-sync",
        title: "设计与代码差异整合",
        prompt: "整合 PRD、Figma 和代码变更，梳理设计与实现的差异，输出需要决策和需要修正的清单。",
      },
      {
        id: "materials-meeting-brief",
        title: "会议资料决策摘要",
        prompt: "基于会议纪要、行动项和风险记录生成决策摘要，区分已确认结论、待确认问题和负责人。",
      },
      {
        id: "materials-client-package",
        title: "客户交付资料包",
        prompt: "整理客户沟通、交付文档和变更记录，输出可直接发送的资料包目录与关键说明。",
      },
    ],
    skillHints: ["document", "summary"],
    mcpHints: ["notion", "google-drive"],
  },
  {
    id: "visualization",
    label: "数据可视化",
    description: "把运营数据变成可解释图表",
    icon: FileDiff,
    model: "pro",
    prompt: `请帮我设计一个 CEO 运营可视化看板。

目标：
1. 定义收入、项目进度、客户风险和团队负载的核心指标。
2. 为每类指标选择图表形式，并说明为什么。
3. 输出首屏布局和每个模块的复核口径。

约束：
- 面向高频管理决策，不做装饰性图表。
- 每个图表都要能解释下一步动作。
- 指标口径要清楚，避免误读。`,
    examples: [
      {
        id: "visualization-exec-dashboard",
        title: "经营驾驶舱",
        prompt: "设计 CEO 经营驾驶舱，覆盖收入趋势、项目进度、客户风险和团队负载，强调可解释和可行动。",
      },
      {
        id: "visualization-project-health",
        title: "项目健康度看板",
        prompt: "构建项目健康度看板，定义风险评分、进度偏差、阻塞时长、资源利用率等核心指标与图表。",
      },
      {
        id: "visualization-weekly-ops",
        title: "周运营复盘图表",
        prompt: "为周运营复盘设计图表组合，突出异常波动、影响范围和建议动作，支持会议快速决策。",
      },
    ],
    skillHints: ["visualization", "chart", "dashboard"],
    mcpHints: ["supabase"],
  },
  {
    id: "document",
    label: "文档/PDF",
    description: "整理文档、审阅材料和生成报告",
    icon: FilePlus,
    model: "pro",
    prompt: `请帮我整理一份客户项目复盘文档。

目标：
1. 从会议记录、交付物和问题列表中提炼关键事实。
2. 输出项目目标、执行过程、问题根因和下一步动作。
3. 生成适合给客户和内部团队同时查看的版本结构。

约束：
- 客户版要克制、清楚，不暴露内部无关细节。
- 内部版要保留可追责和可改进的信息。
- 结论要能追溯到原始资料。`,
    examples: [
      {
        id: "document-client-retro",
        title: "客户项目复盘报告",
        prompt: "整理客户项目复盘报告，分客户版与内部版，覆盖目标、过程、问题根因、改进动作和时间线。",
      },
      {
        id: "document-implementation-plan",
        title: "实施方案文档",
        prompt: "生成实施方案文档，包含范围说明、技术方案、资源计划、风险控制和验收标准。",
      },
      {
        id: "document-policy-brief",
        title: "政策与流程说明书",
        prompt: "将分散规范整合为流程说明书，明确角色职责、操作步骤、异常处理和审计要求。",
      },
    ],
    skillHints: ["pdf", "document"],
  },
  {
    id: "business_review",
    label: "经营复盘",
    description: "跨项目梳理风险、进度和动作",
    icon: ChevronRight,
    model: "pro",
    prompt: `请帮我准备一次经营复盘。

目标：
1. 汇总当前项目、收入、客户风险和团队负载的关键变化。
2. 标出需要 CEO 介入的阻塞点和决策点。
3. 输出下一周优先处理的 5 个经营动作。

约束：
- 优先呈现异常和决策点，不要平均用力。
- 每个风险都要说明影响、证据和建议动作。
- 输出要便于周会上直接使用。`,
    examples: [
      {
        id: "business-review-weekly",
        title: "每周经营复盘",
        prompt: "输出每周经营复盘，聚焦异常指标、关键风险、跨项目依赖和下周优先动作。",
      },
      {
        id: "business-review-quarterly",
        title: "季度经营总结",
        prompt: "生成季度经营总结，包含增长结果、利润结构、执行偏差、管理洞见和下季度重点。",
      },
      {
        id: "business-review-risk-radar",
        title: "经营风险雷达",
        prompt: "构建经营风险雷达，按财务、交付、客户和团队四象限评估风险并给出干预建议。",
      },
    ],
    skillHints: ["business", "review"],
    mcpHints: ["notion", "slack"],
  },
  {
    id: "deployment",
    label: "部署上线",
    description: "把应用从预览推进到上线检查",
    icon: Rocket,
    model: "max",
    prompt: `请帮我准备一个 Web 应用上线方案。

目标：
1. 梳理当前应用上线前需要完成的功能、配置、测试和部署检查。
2. 标出最可能影响上线的风险和回滚方案。
3. 输出一份上线执行清单，方便前端、后端和运维协同。

约束：
- 不做泛泛而谈的发布建议。
- 每个检查项都要有负责人角色和验收方式。
- 需要包含预览、调试、部署和回滚。`,
    examples: [
      {
        id: "deployment-release-checklist",
        title: "上线执行清单",
        prompt: "生成发布上线执行清单，覆盖功能冻结、环境校验、回归验证、灰度策略和回滚预案。",
      },
      {
        id: "deployment-risk-assessment",
        title: "上线风险评估",
        prompt: "输出上线风险评估报告，标出高风险变更、影响面、缓解策略和观测指标。",
      },
      {
        id: "deployment-post-verification",
        title: "上线后验证计划",
        prompt: "设计上线后验证计划，包含关键链路监控、告警阈值、业务指标观察和应急处理流程。",
      },
    ],
    skillHints: ["deploy", "release"],
    mcpHints: ["vercel", "github"],
  },
];

const HOME_PRIMARY_CAPABILITY_IDS = [
  "slides",
  "website",
  "app",
  "research",
  "spreadsheet",
];
const HOME_PRIMARY_CAPABILITY_GUIDE_ITEMS = HOME_CAPABILITY_GUIDE_ITEMS.filter(
  (item) => HOME_PRIMARY_CAPABILITY_IDS.includes(item.id),
);
const HOME_MORE_CAPABILITY_GUIDE_ITEMS = HOME_CAPABILITY_GUIDE_ITEMS.filter(
  (item) => !HOME_PRIMARY_CAPABILITY_IDS.includes(item.id),
);
const HOME_DEFAULT_CAPABILITY =
  HOME_CAPABILITY_GUIDE_ITEMS.find((item) => item.id === "website") ??
  HOME_CAPABILITY_GUIDE_ITEMS[0]!;
const HOME_NEW_TASK_TOUR_STEPS: GuidedTourStep[] = [
  {
    id: "scenario-entry",
    selector: '[data-tour="home-capability-guide"]',
    title: "从任务入口开始",
    body: "新建任务页第一次打开时，会直接演示一次真实起手方式。这里已经替你切到了“制作幻灯片”场景，用来说明 oneceo 如何从任务类型开始。",
    placement: "bottom",
  },
  {
    id: "scenario-examples",
    selector: '[data-tour="capability-examples"]',
    title: "示例提示词在这里选",
    body: "点击示例提示词后，需求才会写入输入框。演示阶段不会自动塞进一大段 prompt，避免打断你的思路。",
    placement: "top",
  },
  {
    id: "composer",
    selector: '[data-tour="home-composer"]',
    title: "在这里改成你的任务",
    body: "选完示例后，就在输入框里继续补目标、约束和交付物。越接近真实需求，输出越容易复核。",
    placement: "top",
  },
  {
    id: "scenario-project",
    selector: '[data-tour="composer-project"]',
    title: "把任务归属到项目",
    body: "如果这不是一次临时问答，就把它挂到项目下。后续会话、产出和交付文档会更容易复核。",
    placement: "top",
  },
  {
    id: "scenario-connectors",
    selector: '[data-tour="composer-connectors"]',
    title: "按任务启用外部资料",
    body: "真实任务通常需要 GitHub、Notion、Figma 或 Vercel 等上下文。连接器是在本次任务中按需启用，不是全局强制打开。",
    placement: "top",
  },
  {
    id: "scenario-model",
    selector: '[data-tour="composer-model"]',
    title: "复杂任务提高执行强度",
    body: "演示会根据任务复杂度切到合适模型。普通任务保持 Pro，跨资料分析、开发和研究类任务可以用 Max。",
    placement: "top",
  },
  {
    id: "scenario-send",
    selector: '[data-tour="composer-send"]',
    title: "最后再发送",
    body: "确认目标、项目、连接器和模型后再发送。oneceo 会把执行过程、文件和交付物跟随会话保存。",
    placement: "top",
  },
];
function isInsufficientCreditsError(error: unknown) {
  const text = error instanceof Error ? error.message : String(error || "");
  return /INSUFFICIENT_CREDITS|积分不足|\b402\b/i.test(text);
}

type PersistedMessageScrollAnchor = {
  anchorMessageKey: string | null;
  anchorOffsetTop: number;
  scrollTop: number;
  savedAt: number;
};

type PersistedPreviewState = {
  previewOpen: boolean;
  previewTab: "files" | "changes" | "debug" | "deployment";
  selectedDiffId: string | null;
  selectedDiffMessageKey: string | null;
  savedAt: number;
};

type GoogleWorkspaceConfirmationView = {
  confirmationId: string;
  agentRunId?: string;
  connectorKey: string;
  toolName: string;
  action: string;
  target: string;
  impact: string;
  parameterSummary: Record<string, unknown>;
  status?: string;
};

function normalizeMcpConfirmationStatus(value: unknown): string {
  return asText(value).toLowerCase();
}

function isResolvedMcpConfirmationStatus(value: unknown): boolean {
  const status = normalizeMcpConfirmationStatus(value);
  return (
    status === "approved" ||
    status === "rejected" ||
    status === "consumed" ||
    status === "expired"
  );
}

export function shouldRenderGoogleWorkspaceConfirmation(input: {
  confirmation?: Pick<GoogleWorkspaceConfirmationView, "confirmationId" | "status"> | null;
  hiddenConfirmationIds?: string[];
}): boolean {
  const confirmationId = asText(input.confirmation?.confirmationId);
  if (!confirmationId) return false;
  if (isResolvedMcpConfirmationStatus(input.confirmation?.status)) return false;
  return !input.hiddenConfirmationIds?.includes(confirmationId);
}

export function resolveHandledGoogleConfirmationIds(
  messages: AgentMessage[],
  handledIds: string[] = [],
): string[] {
  const ids = new Set(handledIds);
  for (const item of messages) {
    const metadata = toRecord(item.metadata);
    const confirmationId =
      asText(toRecord(metadata.mcpToolConfirmation).confirmationId) ||
      asText(metadata.confirmationId);
    if (confirmationId) {
      const source = asText(metadata.source);
      if (
        source === "mcp_tool_confirmation_approved" ||
        source === "mcp_tool_confirmation_rejected" ||
        source === "mcp_tool_confirmation_followup"
      ) {
        ids.add(confirmationId);
      }
    }

    const confirmationStatuses = toRecord(metadata.mcpToolConfirmationStatuses);
    for (const [statusConfirmationId, status] of Object.entries(confirmationStatuses)) {
      if (isResolvedMcpConfirmationStatus(status)) {
        ids.add(statusConfirmationId);
      }
    }
  }
  return Array.from(ids);
}

function getMcpConfirmationConnectorLabel(connectorKeyRaw: string) {
  const connectorKey = asText(connectorKeyRaw);
  if (connectorKey === "google_super") return "Google Workspace";
  return connectorKey || "MCP";
}

function isChineseUiLocale() {
  const language = String(i18n.language || "").toLowerCase();
  return !language || language.startsWith("zh");
}

function getMcpConfirmationConnectorDisplayLabel(connectorKeyRaw: string) {
  const connectorKey = asText(connectorKeyRaw);
  if (connectorKey === "google_super") {
    return isChineseUiLocale() ? "Google 工作区" : "Google Workspace";
  }
  return getMcpConfirmationConnectorLabel(connectorKey);
}

function getMcpConfirmationActionDisplayLabel(actionRaw: string) {
  const action = asText(actionRaw);
  const normalized = action.toLowerCase();
  const zh = isChineseUiLocale();
  if (normalized === "send_email" || normalized.includes("email") || normalized.includes("mail")) {
    return zh ? "发送邮件" : "Send email";
  }
  if (normalized.includes("calendar") || normalized.includes("event")) {
    return zh ? "变更日历" : "Update calendar";
  }
  if (normalized.includes("drive") || normalized.includes("file")) {
    return zh ? "变更云端文件" : "Update Drive file";
  }
  if (normalized.includes("document") || normalized.includes("doc")) {
    return zh ? "变更文档" : "Update document";
  }
  if (normalized.includes("sheet")) {
    return zh ? "变更表格" : "Update spreadsheet";
  }
  if (normalized.includes("delete") || normalized.includes("remove")) {
    return zh ? "删除或移除" : "Delete or remove";
  }
  if (normalized.includes("create")) {
    return zh ? "创建资源" : "Create resource";
  }
  if (normalized.includes("update") || normalized.includes("write") || normalized.includes("append")) {
    return zh ? "写入或更新" : "Write or update";
  }
  return zh ? "写操作" : action || "Write operation";
}

function getMcpConfirmationParameterLabel(keyRaw: string) {
  const key = asText(keyRaw);
  const tail = key.toLowerCase().split(".").pop() || key.toLowerCase();
  const zh = isChineseUiLocale();
  if (!zh) return key;
  const labels: Record<string, string> = {
    current_step: "当前步骤",
    thought: "操作说明",
    session_id: "会话",
    recipient_email: "收件人",
    recipientemail: "收件人",
    to: "收件人",
    to_email: "收件人",
    email: "邮箱",
    email_address: "邮箱",
    subject: "题目",
    title: "题目",
    name: "名称",
    body: "邮件内容",
    email_body: "邮件内容",
    emailbody: "邮件内容",
    content: "内容",
    message: "内容",
    text: "正文",
    markdown: "文档内容",
    html: "HTML 内容",
  };
  return labels[tail] || key;
}

function getMcpConfirmationParameterValue(value: unknown) {
  const text = typeof value === "string" ? value : value == null ? "" : String(value);
  if (!isChineseUiLocale()) return text;
  const normalized = text.trim().toLowerCase();
  if (normalized === "sending_test_email") return "发送测试邮件";
  if (normalized === "sending_email") return "发送邮件";
  if (normalized === "creating_document") return "创建文档";
  if (normalized === "updating_document") return "更新文档";
  if (/^sending (a )?(new )?test email/i.test(text)) {
    return "正在发送测试邮件。";
  }
  return text;
}

function buildMcpConfirmationImpactText(confirmation: GoogleWorkspaceConfirmationView) {
  const zh = isChineseUiLocale();
  const connectorLabel = getMcpConfirmationConnectorDisplayLabel(confirmation.connectorKey);
  const actionLabel = getMcpConfirmationActionDisplayLabel(confirmation.action);
  if (zh) {
    return `即将通过 ${connectorLabel} 执行“${actionLabel}”。请确认目标对象与参数无误后继续。`;
  }
  return `This will run "${actionLabel}" through ${connectorLabel}. Review the target and parameters before continuing.`;
}

type ComposerReferenceToken = {
  id: string;
  kind: SlashReferenceKind;
  label: string;
  queryText: string;
  skill?: TaskCreationPlatformSkill;
  mcp?: {
    key: string;
    name: string;
    category: string;
  };
};

const CAPABILITY_AUTO_REFERENCE_PREFIX = "auto-capability:";
function buildSkillAttachmentId(skill: TaskCreationPlatformSkill) {
  return `skill:${skill.skillId}:${skill.revisionId}`;
}

function normalizeCapabilityHint(value: string | null | undefined) {
  return (value || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function findBestCapabilitySkill(
  catalog: TaskCreationPlatformSkill[],
  hints: string[],
) {
  if (!catalog.length || !hints.length) return null;
  const normalizedHints = hints.map((item) => normalizeCapabilityHint(item));
  return (
    catalog.find((item) => {
      const haystack = [
        item.slug,
        item.name,
        item.description,
        item.category,
        item.skillId,
      ]
        .map((text) => normalizeCapabilityHint(text))
        .join(" ");
      return normalizedHints.some((hint) => hint && haystack.includes(hint));
    }) || null
  );
}

function findBestCapabilityMcp(
  catalog: Array<{ key: string; name: string; category: string }>,
  hints: string[],
) {
  if (!catalog.length || !hints.length) return null;
  const normalizedHints = hints.map((item) => normalizeCapabilityHint(item));
  return (
    catalog.find((item) => {
      const haystack = [item.key, item.name, item.category]
        .map((text) => normalizeCapabilityHint(text))
        .join(" ");
      return normalizedHints.some((hint) => hint && haystack.includes(hint));
    }) || null
  );
}

type SlashSuggestion = {
  id: string;
  kind: SlashReferenceKind;
  label: string;
  subLabel: string;
  token: ComposerReferenceToken;
};

function normalizeComposerSelectedMcp(
  references: ComposerReferenceToken[],
): TaskCreationMcpReference[] {
  return references
    .filter((item) => item.kind === "mcp")
    .map((item) => item.mcp)
    .filter(
      (
        item,
      ): item is {
        key: string;
        name: string;
        category: string;
      } => Boolean(item),
    )
    .map((item) => ({
      key: item.key,
      name: item.name,
      category: item.category,
    }));
}

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

function readPersistedPreviewState(
  raw: string | null,
): PersistedPreviewState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PersistedPreviewState;
    if (!parsed || typeof parsed !== "object") return null;
    const previewTab =
      parsed.previewTab === "files" ||
      parsed.previewTab === "changes" ||
      parsed.previewTab === "debug" ||
      parsed.previewTab === "deployment"
        ? parsed.previewTab
        : "files";
    const previewOpen = Boolean(parsed.previewOpen);
    const selectedDiffId =
      typeof parsed.selectedDiffId === "string" && parsed.selectedDiffId.trim()
        ? parsed.selectedDiffId.trim()
        : null;
    const selectedDiffMessageKey =
      typeof parsed.selectedDiffMessageKey === "string" &&
      parsed.selectedDiffMessageKey.trim()
        ? parsed.selectedDiffMessageKey.trim()
        : null;
    return {
      previewOpen,
      previewTab,
      selectedDiffId,
      selectedDiffMessageKey,
      savedAt:
        typeof parsed.savedAt === "number" && Number.isFinite(parsed.savedAt)
          ? parsed.savedAt
          : Date.now(),
    };
  } catch {
    return null;
  }
}

function clampProjectHintLabel(
  value: string | null,
  maxLength = 8,
): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength)}...`;
}

const NO_PROJECT_VALUE = "__no_project__";

function hasCompletedGuidedTour(
  storageKey: string,
  storageScope?: string | null,
) {
  if (typeof window === "undefined") return false;
  return (
    window.localStorage.getItem(
      resolveGuidedTourStorageKey(storageKey, storageScope),
    ) === "completed"
  );
}

export default function Home() {
  const { t } = useTranslation();
  const { user, refreshCredits } = useAuth();
  const MESSAGE_SCROLL_CACHE_PREFIX = "task_creation_history_scroll:";
  const PREVIEW_STATE_CACHE_PREFIX = "task_creation_preview_state:";
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const queryProjectId = useMemo(() => {
    const params = new URLSearchParams(search);
    const projectId = params.get("projectId")?.trim();
    return projectId || null;
  }, [search]);
  const [pendingProjectId, setPendingProjectId] = useState<string | null>(
    queryProjectId,
  );
  const selectedProject = useMemo<TaskProjectSelection | null>(() => {
    if (!pendingProjectId) return null;
    return {
      id: pendingProjectId,
      kind: "manual",
    };
  }, [pendingProjectId]);
  const [projectOptions, setProjectOptions] = useState<TaskCreationProjectSummary[]>(
    [],
  );
  const [projectOptionsLoading, setProjectOptionsLoading] = useState(false);
  const [projectOptionsLoaded, setProjectOptionsLoaded] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [mode, setMode] = useState<PageMode>("input");
  const [message, setMessage] = useState("");
  const [uploadingAttachmentIds, setUploadingAttachmentIds] = useState<
    string[]
  >([]);
  const uploadedAttachmentRecordsRef = useRef<
    Record<string, UploadedTaskAttachment>
  >({});
  const uploadPromisesRef = useRef(
    new Map<string, Promise<UploadedTaskAttachment>>(),
  );
  const uploadSessionIdRef = useRef<string>("");
  const [isComposerDragActive, setIsComposerDragActive] = useState(false);
  const composerDragDepthRef = useRef(0);
  const [handledGoogleConfirmationIds, setHandledGoogleConfirmationIds] = useState<
    string[]
  >([]);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [composerReferences, setComposerReferences] = useState<
    ComposerReferenceToken[]
  >([]);
  const [slashSkillCatalog, setSlashSkillCatalog] = useState<
    TaskCreationPlatformSkill[]
  >([]);
  const [slashMcpCatalog, setSlashMcpCatalog] = useState<
    Array<{ key: string; name: string; category: string }>
  >([]);
  const [slashCatalogLoaded, setSlashCatalogLoaded] = useState(false);
  const [slashCatalogLoading, setSlashCatalogLoading] = useState(false);
  const [slashCatalogError, setSlashCatalogError] = useState<string | null>(
    null,
  );
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [altusReplayRunId, setAltusReplayRunId] = useState<string | null>(null);
  const [altusReplayIndex, setAltusReplayIndex] = useState(0);
  const [altusReplayView, setAltusReplayView] =
    useState<AltusDrawerView>("actions");
  const [pendingAltusReplayToolCallId, setPendingAltusReplayToolCallId] =
    useState<string | null>(null);
  const [pendingAutoManagedDebugAction, setPendingAutoManagedDebugAction] =
    useState<{
      runId: string;
      toolCallId: string;
      key: string;
    } | null>(null);
  const [autoManagedDebugInfo, setAutoManagedDebugInfo] = useState<{
    actionKey: string;
    info: TaskCreationDebugInfo;
  } | null>(null);
  const autoOpenedManagedDebugActionsRef = useRef<Set<string>>(new Set());
  const wasAutoOpeningManagedDebugRef = useRef(false);
  const autoManagedDebugPollRef = useRef<number | null>(null);
  const refreshCreditsRef = useRef(refreshCredits);
  const voiceInputBaseRef = useRef("");
  const lastCreditRefreshRunStatusRef = useRef<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<"lite" | "pro" | "max">(
    "pro",
  );
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewMaximized, setPreviewMaximized] = useState(false);
  const [previewWorkspacePath, setPreviewWorkspacePath] = useState<
    string | null
  >(null);
  const [previewTab, setPreviewTab] = useState<
    "files" | "changes" | "debug" | "deployment"
  >("files");
  const [selectedDiffId, setSelectedDiffId] = useState<string | null>(null);
  const [selectedDiffMessageKey, setSelectedDiffMessageKey] = useState<
    string | null
  >(null);
  const [desktopPreviewLayout, setDesktopPreviewLayout] = useState<
    [number, number]
  >([66, 34]);
  const [pendingDiffTarget, setPendingDiffTarget] = useState<{
    diffId?: string | null;
    filePath?: string | null;
    messageKey?: string | null;
    messageIndex?: number | null;
  } | null>(null);
  const [scenarioDemo, setScenarioDemo] =
    useState<HomeCapabilityGuideItem>(HOME_DEFAULT_CAPABILITY);
  const [selectedCapabilityId, setSelectedCapabilityId] = useState<string | null>(
    null,
  );
  const [selectedCapabilityExampleId, setSelectedCapabilityExampleId] = useState<
    string | null
  >(null);
  const [selectedCapabilityCategory, setSelectedCapabilityCategory] = useState<
    string | null
  >(null);
  const [autoCapabilitySkillIds, setAutoCapabilitySkillIds] = useState<
    string[]
  >([]);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
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
  const previewStateRestoredSessionRef = useRef<string | null>(null);
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
    managedRunActive,
    managedRunStatus,
    isInterrupting,
    messages,
    hasOlderHistory,
    isLoadingOlderHistory,
    sessionId,
    currentQuestion,
    runtime,
    sendChatInput,
    interruptCurrentRun,
    answerQuestion,
    appendLocalMessage,
    awaitManagedRunRecovery,
    ensureSession,
    loadOlderHistory,
  } = useTaskCreationAgent({
    autoRuntime: !isHistoryView,
    compactHistory: false,
    runtimeLogPollingEnabled: false,
    initialProjectId:
      selectedProject?.kind === "manual" ? selectedProject.id : null,
    onPlanGenerated: (plan) => {
      console.log("计划生成:", plan);
      // TODO: 跳转到项目详情页面或更新左侧项目列表
    },
    onError: (error) => {
      console.error("任务创建失败:", error);
    },
  });
  const resolvedGoogleConfirmationIds = useMemo(() => {
    return resolveHandledGoogleConfirmationIds(
      messages,
      handledGoogleConfirmationIds,
    );
  }, [handledGoogleConfirmationIds, messages]);

  useEffect(() => {
    refreshCreditsRef.current = refreshCredits;
  }, [refreshCredits]);

  const selectedCapability = useMemo(() => {
    if (!selectedCapabilityId) return null;
    return (
      HOME_CAPABILITY_GUIDE_ITEMS.find((item) => item.id === selectedCapabilityId) ??
      null
    );
  }, [selectedCapabilityId]);

  const selectedCapabilityCategories = useMemo(() => {
    if (!selectedCapability?.examples.length) return [];
    return Array.from(
      new Set(
        selectedCapability.examples
          .map((example) => example.category?.trim())
          .filter((value): value is string => Boolean(value)),
      ),
    );
  }, [selectedCapability]);

  const visibleCapabilityExamples = useMemo(() => {
    if (!selectedCapability) return [];
    if (!selectedCapability.examples.length) {
      return [
        {
          id: `${selectedCapability.id}-default`,
          title: `用 ${selectedCapability.label} 启动一个任务`,
          prompt: selectedCapability.prompt,
        },
      ];
    }
    if (!selectedCapabilityCategory) return selectedCapability.examples;
    return selectedCapability.examples.filter(
      (example) => example.category === selectedCapabilityCategory,
    );
  }, [selectedCapability, selectedCapabilityCategory]);

  const SelectedCapabilityIcon = selectedCapability?.icon ?? null;

  const applyScenarioPrompt = useCallback(
    (demo: HomeCapabilityGuideItem, prompt: string, exampleId?: string | null) => {
      setScenarioDemo(demo);
      setSelectedCapabilityId(demo.id);
      setSelectedCapabilityExampleId(exampleId ?? null);
      setSelectedModel(demo.model);
      setModelMenuOpen(false);
      setMessage(prompt);
    },
    [],
  );

  const applyCapabilityAutoReferences = useCallback(
    async (demo: HomeCapabilityGuideItem) => {
      const hasCatalog = slashCatalogLoaded && !slashCatalogLoading;
      let skillCatalog = slashSkillCatalog;
      let mcpCatalog = slashMcpCatalog;

      if (!hasCatalog) {
        try {
          setSlashCatalogLoading(true);
          const loaded = await (async () => {
            const [skills, connectorAccounts] = await Promise.all([
              listTaskCreationSkills(),
              getMyConnectorAccounts(),
            ]);
            const nextSkills = Array.isArray(skills) ? skills : [];
            const catalog = Array.isArray(connectorAccounts.catalog)
              ? connectorAccounts.catalog.filter(
                  (
                    item,
                  ): item is (typeof connectorAccounts.catalog)[number] =>
                    Boolean(item && typeof item === "object" && "key" in item),
                )
              : [];
            const accounts = Array.isArray(connectorAccounts.accounts)
              ? connectorAccounts.accounts.filter(
                  (
                    item,
                  ): item is (typeof connectorAccounts.accounts)[number] =>
                    Boolean(
                      item && typeof item === "object" && "connectorKey" in item,
                    ),
                )
              : [];
            const catalogByKey = new Map(
              catalog.map((item) => [item.key, item] as const),
            );
            const nextMcpCatalog = accounts
              .filter((item) => {
                if (item.authStatus !== "authorized") return false;
                const catalogItem = catalogByKey.get(item.connectorKey);
                return (
                  Boolean(catalogItem?.available) &&
                  catalogItem?.category === "custom_mcp"
                );
              })
              .map((item) => ({
                key: item.connectorKey,
                name:
                  catalogByKey.get(item.connectorKey)?.name || item.connectorKey,
                category: "custom_mcp",
              }));
            return {
              skills: nextSkills,
              mcp: nextMcpCatalog,
            };
          })();
          skillCatalog = loaded.skills;
          mcpCatalog = loaded.mcp;
          setSlashSkillCatalog(loaded.skills);
          setSlashMcpCatalog(loaded.mcp);
          setSlashCatalogLoaded(true);
        } catch {
          // ignore auto-mapping failures; user can still select manually
        } finally {
          setSlashCatalogLoading(false);
        }
      }

      const matchedSkill = findBestCapabilitySkill(
        skillCatalog,
        demo.skillHints || [],
      );
      const matchedMcp = findBestCapabilityMcp(mcpCatalog, demo.mcpHints || []);

      const autoTokens: ComposerReferenceToken[] = [];
      const nextAutoSkillIds = matchedSkill
        ? [buildSkillAttachmentId(matchedSkill)]
        : [];
      if (matchedMcp) {
        autoTokens.push({
          id: `${CAPABILITY_AUTO_REFERENCE_PREFIX}mcp:${matchedMcp.key}`,
          kind: "mcp",
          label: matchedMcp.name,
          queryText: buildSlashText("mcp", matchedMcp.key || matchedMcp.name),
          mcp: matchedMcp,
        });
      }

      setAttachments((current) => {
        const withoutPreviousAuto = current.filter((item) => {
          if (item.kind !== "skill") return true;
          return !autoCapabilitySkillIds.includes(item.id);
        });
        if (!matchedSkill) {
          return withoutPreviousAuto;
        }
        return mergePendingPlatformSkills(withoutPreviousAuto, [matchedSkill]);
      });
      setAutoCapabilitySkillIds(nextAutoSkillIds);

      setComposerReferences((current) => {
        const manual = current.filter(
          (item) => !item.id.startsWith(CAPABILITY_AUTO_REFERENCE_PREFIX),
        );
        return [...manual, ...autoTokens];
      });
    },
    [
      autoCapabilitySkillIds,
      slashCatalogLoaded,
      slashCatalogLoading,
      slashMcpCatalog,
      slashSkillCatalog,
    ],
  );

  const startScenarioTour = useCallback((
    demo: HomeCapabilityGuideItem,
    options?: {
      prompt?: string;
      exampleId?: string | null;
      category?: string | null;
    },
  ) => {
    const hasExplicitPrompt = Boolean(options?.prompt?.trim());
    const prompt = hasExplicitPrompt ? options?.prompt?.trim() || "" : "";
    const exampleId = options?.exampleId ?? null;
    const nextCategory =
      options?.category ??
      (exampleId
        ? demo.examples.find((example) => example.id === exampleId)?.category
        : null) ??
      null;
    if (mode !== "input") {
      setMode("input");
    }
    void applyCapabilityAutoReferences(demo);
    setScenarioDemo(demo);
    setSelectedCapabilityId(demo.id);
    setSelectedCapabilityExampleId(exampleId);
    setSelectedCapabilityCategory(nextCategory ?? null);
    setSelectedModel(demo.model);
    setModelMenuOpen(false);
    if (hasExplicitPrompt) {
      applyScenarioPrompt(demo, prompt, exampleId);
    }
  }, [applyCapabilityAutoReferences, applyScenarioPrompt, mode]);

  const handleCapabilityExampleSelect = useCallback(
    (demo: HomeCapabilityGuideItem, example: HomeCapabilityExample) => {
      setSelectedCapabilityCategory(example.category ?? null);
      setSelectedCapabilityId(demo.id);
      setSelectedCapabilityExampleId(example.id);
      startScenarioTour(demo, {
        prompt: example.prompt,
        exampleId: example.id,
        category: example.category ?? null,
      });
    },
    [startScenarioTour],
  );

  const clearSelectedCapability = useCallback(() => {
    setScenarioDemo(HOME_DEFAULT_CAPABILITY);
    setSelectedCapabilityId(null);
    setSelectedCapabilityExampleId(null);
    setSelectedCapabilityCategory(null);
    setModelMenuOpen(false);
    setAttachments((current) =>
      current.filter((item) => {
        if (item.kind !== "skill") return true;
        return !autoCapabilitySkillIds.includes(item.id);
      }),
    );
    setAutoCapabilitySkillIds([]);
    setComposerReferences((current) =>
      current.filter(
        (item) => !item.id.startsWith(CAPABILITY_AUTO_REFERENCE_PREFIX),
      ),
    );
  }, [autoCapabilitySkillIds]);

  const selectedCapabilityBadge =
    selectedCapability && SelectedCapabilityIcon ? (
      <div className="group relative">
        <div className="flex h-9 items-center gap-2 rounded-2xl border border-[var(--brand-link)] bg-[var(--brand-soft)] px-3 text-sm font-medium text-[var(--brand-link)] transition-colors">
          <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
            <SelectedCapabilityIcon className="h-4 w-4 transition-opacity duration-150 group-hover:opacity-0 group-focus-within:opacity-0" />
            <button
              type="button"
              onClick={clearSelectedCapability}
              className="absolute inset-0 flex items-center justify-center rounded-full bg-[var(--brand-link)]/14 text-[var(--brand-link)] opacity-0 transition-opacity duration-150 hover:bg-[var(--brand-link)]/18 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-link)]/35 group-hover:opacity-100 group-focus-within:opacity-100"
              aria-label={`关闭当前能力：${selectedCapability.label}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
          <span>{selectedCapability.label}</span>
        </div>
      </div>
    ) : null;

  const injectWebsiteReference = useCallback(() => {
    setMessage((current) => {
      const trimmed = current.trim();
      if (!trimmed) {
        return "网站参考：\n- 参考链接：\n- 需要保留的布局：\n- 不希望出现的风格：";
      }
      return `${trimmed}\n\n网站参考：\n- 参考链接：\n- 需要保留的布局：\n- 不希望出现的风格：`;
    });
    toast.success("已添加网站参考模板");
  }, []);

  const injectFigmaReference = useCallback(() => {
    setMessage((current) => {
      const trimmed = current.trim();
      if (!trimmed) {
        return "Figma 参考：\n- 文件链接：\n- 关键页面：\n- 需要对齐的组件：";
      }
      return `${trimmed}\n\nFigma 参考：\n- 文件链接：\n- 关键页面：\n- 需要对齐的组件：`;
    });
    toast.success("已添加 Figma 参考模板");
  }, []);

  const handleNewTaskTourStepChange = useCallback((step: GuidedTourStep) => {
    if (step.id === "scenario-examples" || step.id === "composer") {
      setModelMenuOpen(false);
      return;
    }
    if (step.id === "scenario-model") {
      setSelectedModel(scenarioDemo.model);
      setModelMenuOpen(true);
      return;
    }
    setModelMenuOpen(false);
  }, [scenarioDemo]);

  useEffect(() => {
    if (mode !== "input") return;
    if (selectedCapabilityId) return;
    if (hasCompletedGuidedTour(HOME_NEW_TASK_TOUR_KEY, user?.id)) return;
    startScenarioTour(
      HOME_CAPABILITY_GUIDE_ITEMS.find((item) => item.id === "slides") ??
        HOME_DEFAULT_CAPABILITY,
    );
  }, [mode, selectedCapabilityId, startScenarioTour, user?.id]);

  useEffect(() => {
    if (!managedRunStatus || !BILLING_TERMINAL_RUN_STATUSES.has(managedRunStatus)) {
      lastCreditRefreshRunStatusRef.current = null;
      return;
    }
    if (lastCreditRefreshRunStatusRef.current === managedRunStatus) return;
    lastCreditRefreshRunStatusRef.current = managedRunStatus;
    void refreshCreditsRef.current();
  }, [managedRunStatus]);

  const slashQuery = useMemo(() => parseTrailingSlashQuery(message), [message]);

  useEffect(() => {
    setPendingProjectId(queryProjectId);
  }, [queryProjectId]);

  const syncPendingProjectToUrl = useCallback(
    (nextProjectId: string | null) => {
      if (!location.startsWith("/new-task")) return;
      const params = new URLSearchParams(search);
      if (nextProjectId) {
        params.set("projectId", nextProjectId);
      } else {
        params.delete("projectId");
      }
      const nextQuery = params.toString();
      const nextUrl = nextQuery ? `${location}?${nextQuery}` : location;
      setLocation(nextUrl, { replace: true });
    },
    [location, search, setLocation],
  );

  const loadProjectOptions = useCallback(async () => {
    if (projectOptionsLoading) return;
    setProjectOptionsLoading(true);
    try {
      const result = await listTaskCreationProjects();
      setProjectOptions(Array.isArray(result) ? result : []);
    } finally {
      setProjectOptionsLoaded(true);
      setProjectOptionsLoading(false);
    }
  }, [projectOptionsLoading]);

  const loadReferenceCatalog = useCallback(async () => {
    const [skills, connectorAccounts] = await Promise.all([
      listTaskCreationSkills(),
      getMyConnectorAccounts(),
    ]);
    const nextSkills = Array.isArray(skills) ? skills : [];
    const catalog = Array.isArray(connectorAccounts.catalog)
      ? connectorAccounts.catalog.filter(
          (item): item is (typeof connectorAccounts.catalog)[number] =>
            Boolean(item && typeof item === "object" && "key" in item),
        )
      : [];
    const accounts = Array.isArray(connectorAccounts.accounts)
      ? connectorAccounts.accounts.filter(
          (item): item is (typeof connectorAccounts.accounts)[number] =>
            Boolean(item && typeof item === "object" && "connectorKey" in item),
        )
      : [];
    const catalogByKey = new Map(
      catalog.map((item) => [item.key, item] as const),
    );
    const nextMcpCatalog = accounts
      .filter((item) => {
        if (item.authStatus !== "authorized") return false;
        const catalogItem = catalogByKey.get(item.connectorKey);
        return (
          Boolean(catalogItem?.available) &&
          catalogItem?.category === "custom_mcp"
        );
      })
      .map((item) => ({
        key: item.connectorKey,
        name: catalogByKey.get(item.connectorKey)?.name || item.connectorKey,
        category: "custom_mcp",
      }));
    return {
      skills: nextSkills,
      mcp: nextMcpCatalog,
    };
  }, []);

  useEffect(() => {
    if (!slashQuery || slashCatalogLoaded || slashCatalogLoading) {
      return;
    }
    let cancelled = false;
    setSlashCatalogLoading(true);
    setSlashCatalogError(null);
    void (async () => {
      try {
        const nextCatalog = await loadReferenceCatalog();
        if (cancelled) return;
        setSlashSkillCatalog(nextCatalog.skills);
        setSlashMcpCatalog(nextCatalog.mcp);
        setSlashCatalogLoaded(true);
      } catch (error) {
        if (cancelled) return;
        setSlashSkillCatalog([]);
        setSlashMcpCatalog([]);
        setSlashCatalogLoaded(false);
        setSlashCatalogError(
          error instanceof Error && error.message
            ? error.message
            : t("homeWorkspace.referenceLoadFailed"),
        );
      } finally {
        if (cancelled) return;
        setSlashCatalogLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadReferenceCatalog, slashCatalogLoaded, slashQuery]);

  useEffect(() => {
    if (location.startsWith("/new-task") && !projectOptionsLoaded) {
      void loadProjectOptions();
    }
  }, [loadProjectOptions, location, projectOptionsLoaded]);

  useEffect(() => {
    if (!projectMenuOpen || projectOptionsLoaded) {
      return;
    }
    void loadProjectOptions();
  }, [loadProjectOptions, projectMenuOpen, projectOptionsLoaded]);

  const slashSuggestions = useMemo<SlashSuggestion[]>(() => {
    if (!slashQuery) return [];
    const keyword = slashQuery.keyword.trim().toLowerCase();
    const allowSkill = slashQuery.kind === "all" || slashQuery.kind === "skill";
    const allowMcp = slashQuery.kind === "all" || slashQuery.kind === "mcp";
    const list: SlashSuggestion[] = [];

    if (allowSkill) {
      for (const skill of slashSkillCatalog) {
        const name = (skill.name || "").toLowerCase();
        const slug = (skill.slug || "").toLowerCase();
        if (keyword && !name.includes(keyword) && !slug.includes(keyword))
          continue;
        const id = `skill:${skill.skillId}:${skill.revisionId}`;
        list.push({
          id,
          kind: "skill",
          label: skill.name,
          subLabel: `skills · ${skill.slug || skill.skillId}`,
          token: {
            id,
            kind: "skill",
            label: skill.name,
            queryText: buildSlashText("skill", skill.slug || skill.name),
            skill,
          },
        });
      }
    }

    if (allowMcp) {
      for (const item of slashMcpCatalog) {
        const name = (item.name || "").toLowerCase();
        const key = (item.key || "").toLowerCase();
        if (keyword && !name.includes(keyword) && !key.includes(keyword))
          continue;
        const id = `mcp:${item.key}`;
        list.push({
          id,
          kind: "mcp",
          label: item.name,
          subLabel: `mcp · ${item.key}`,
          token: {
            id,
            kind: "mcp",
            label: item.name,
            queryText: buildSlashText("mcp", item.key || item.name),
            mcp: item,
          },
        });
      }
    }

    return list.slice(0, 8);
  }, [slashMcpCatalog, slashQuery, slashSkillCatalog]);

  useEffect(() => {
    setSlashActiveIndex(0);
  }, [message, slashSuggestions.length]);

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

  useEffect(() => {
    if (!sessionId) {
      previewStateRestoredSessionRef.current = null;
      setPreviewOpen(false);
      setPreviewTab("files");
      setSelectedDiffId(null);
      setSelectedDiffMessageKey(null);
      setPendingDiffTarget(null);
      return;
    }
    if (previewStateRestoredSessionRef.current === sessionId) {
      return;
    }
    setPendingDiffTarget(null);
    try {
      const raw = window.sessionStorage.getItem(
        `${PREVIEW_STATE_CACHE_PREFIX}${sessionId}`,
      );
      const persisted = readPersistedPreviewState(raw);
      if (!persisted) {
        setPreviewOpen(false);
        setPreviewTab("files");
        setSelectedDiffId(null);
        setSelectedDiffMessageKey(null);
      } else {
        setPreviewOpen(Boolean(persisted.previewOpen));
        setPreviewTab(persisted.previewTab);
        setSelectedDiffId(persisted.selectedDiffId);
        setSelectedDiffMessageKey(persisted.selectedDiffMessageKey);
      }
    } catch {
      setPreviewOpen(false);
      setPreviewTab("files");
      setSelectedDiffId(null);
      setSelectedDiffMessageKey(null);
    } finally {
      previewStateRestoredSessionRef.current = sessionId;
    }
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    if (previewStateRestoredSessionRef.current !== sessionId) return;
    try {
      const payload: PersistedPreviewState = {
        previewOpen,
        previewTab,
        selectedDiffId,
        selectedDiffMessageKey,
        savedAt: Date.now(),
      };
      window.sessionStorage.setItem(
        `${PREVIEW_STATE_CACHE_PREFIX}${sessionId}`,
        JSON.stringify(payload),
      );
    } catch {
      // ignore storage failures
    }
  }, [
    previewOpen,
    previewTab,
    selectedDiffId,
    selectedDiffMessageKey,
    sessionId,
  ]);

  // 从根页面跳转到 /new-task?q=... 时，自动进入聊天态并发送首条消息
  useEffect(() => {
    const params = new URLSearchParams(search);
    const input = params.get("q")?.trim();
    const prefill = params.get("prefill")?.trim();
    const sessionInQuery = sessionIdFromPath || params.get("sessionId")?.trim();
    const createNewToken = params.get("new")?.trim();

    if (prefill && location.startsWith("/new-task")) {
      pendingInputRef.current = null;
      setMessage(prefill);
      setAttachments([]);
      setComposerReferences([]);
      setMode("input");
      window.history.replaceState(null, "", "/new-task");
      return;
    }

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
    const pendingAttachments = consumePendingDraftAttachments();
    if (!pendingAttachments.length) return;
    setAttachments(pendingAttachments);
    startPendingAttachmentUploads(pendingAttachments);
  }, []);

  useEffect(() => {
    const shouldLockViewport = mode === "chat";
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
  }, [mode]);

  const exitHistoryView = () => {
    if (!isHistoryView) return;
    const base = sessionId
      ? `/session/${encodeURIComponent(sessionId)}`
      : location.startsWith("/session/")
        ? location
        : "/new-task";
    window.history.replaceState(null, "", base);
  };

  const setAttachmentUploading = (id: string, uploading: boolean) => {
    setUploadingAttachmentIds((current) => {
      if (uploading) {
        return current.includes(id) ? current : [...current, id];
      }
      return current.filter((item) => item !== id);
    });
  };

  const ensureAttachmentUploadSession = async (fallbackTitle: string) => {
    const existing = (sessionId || uploadSessionIdRef.current || "").trim();
    if (existing) return existing;
    const created = await ensureSession(
      fallbackTitle || t("homeWorkspace.newTaskSession"),
    );
    uploadSessionIdRef.current = created;
    return created;
  };

  const ensurePendingAttachmentUploaded = (
    attachment: Extract<PendingAttachment, { kind: "file" }>,
    forcedSessionId?: string,
  ) => {
    const uploaded = uploadedAttachmentRecordsRef.current[attachment.id];
    if (uploaded) return Promise.resolve(uploaded);

    const running = uploadPromisesRef.current.get(attachment.id);
    if (running) return running;

    setAttachmentUploading(attachment.id, true);
    const promise = (async () => {
      const activeSessionId =
        forcedSessionId ||
        (await ensureAttachmentUploadSession(attachment.name));
      uploadSessionIdRef.current = activeSessionId;
      const result = await uploadTaskCreationAttachment(
        activeSessionId,
        attachment.file,
      );
      uploadedAttachmentRecordsRef.current = {
        ...uploadedAttachmentRecordsRef.current,
        [attachment.id]: result,
      };
      return result;
    })();

    uploadPromisesRef.current.set(attachment.id, promise);
    promise
      .catch((error) => {
        toast.error(
          error instanceof Error
            ? error.message
            : t("homeWorkspace.attachmentSendFailed"),
        );
      })
      .finally(() => {
        uploadPromisesRef.current.delete(attachment.id);
        setAttachmentUploading(attachment.id, false);
      });

    return promise;
  };

  const startPendingAttachmentUploads = (items: PendingAttachment[]) => {
    if (readAltusMode() === "managed") return;
    items
      .filter(
        (item): item is Extract<PendingAttachment, { kind: "file" }> =>
          item.kind === "file",
      )
      .forEach((item) => {
        void ensurePendingAttachmentUploaded(item);
      });
  };

  const clearAttachmentUploadState = (ids: string[]) => {
    if (!ids.length) return;
    uploadedAttachmentRecordsRef.current = Object.fromEntries(
      Object.entries(uploadedAttachmentRecordsRef.current).filter(
        ([id]) => !ids.includes(id),
      ),
    );
    ids.forEach((id) => uploadPromisesRef.current.delete(id));
    setUploadingAttachmentIds((current) =>
      current.filter((id) => !ids.includes(id)),
    );
  };

  const handleAttachmentSelect = (files: File[]) => {
    if (files.length === 0) return;
    const merged = mergePendingAttachments(attachments, files);
    setAttachments(merged.attachments);
    startPendingAttachmentUploads(merged.attachments);
    merged.rejected.forEach((item) => toast.error(item));
  };

  const resetComposerDragState = () => {
    composerDragDepthRef.current = 0;
    setIsComposerDragActive(false);
  };

  const handleComposerDragEnter = (event: DragEvent<HTMLElement>) => {
    if (!hasFileTransfer(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    composerDragDepthRef.current += 1;
    setIsComposerDragActive(true);
  };

  const handleComposerDragOver = (event: DragEvent<HTMLElement>) => {
    if (!hasFileTransfer(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    setIsComposerDragActive(true);
  };

  const handleComposerDragLeave = (event: DragEvent<HTMLElement>) => {
    if (!hasFileTransfer(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    composerDragDepthRef.current = Math.max(
      0,
      composerDragDepthRef.current - 1,
    );
    if (composerDragDepthRef.current === 0) {
      setIsComposerDragActive(false);
    }
  };

  const handleComposerDrop = (event: DragEvent<HTMLElement>) => {
    if (!hasFileTransfer(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    resetComposerDragState();
    handleAttachmentSelect(extractFilesFromTransfer(event.dataTransfer));
  };

  const handleComposerPaste = (event: ClipboardEvent<HTMLElement>) => {
    const files = extractFilesFromTransfer(event.clipboardData);
    if (files.length === 0) return;
    event.preventDefault();
    handleAttachmentSelect(files);
  };

  const handleSkillSelect = (skills: TaskCreationPlatformSkill[]) => {
    setAttachments((current) => mergePendingPlatformSkills(current, skills));
  };
  const selectedSkillAttachments = useMemo(
    () =>
      attachments
        .filter(
          (item): item is Extract<PendingAttachment, { kind: "skill" }> =>
            item.kind === "skill",
        )
        .map((item) => item),
    [attachments],
  );

  const removeAttachment = (id: string) => {
    clearAttachmentUploadState([id]);
    setAttachments((prev) => prev.filter((item) => item.id !== id));
  };

  const removeComposerReference = (token: ComposerReferenceToken) => {
    setComposerReferences((prev) =>
      prev.filter((item) => item.id !== token.id),
    );
    setMessage(
      (prev) =>
        `${prev}${prev.endsWith(" ") || !prev ? "" : " "}${token.queryText} `,
    );
  };

  const applySlashSuggestion = (suggestion: SlashSuggestion) => {
    setMessage((prev) => stripTrailingSlashQuery(prev));
    setComposerReferences((prev) => {
      if (prev.some((item) => item.id === suggestion.id)) return prev;
      return [...prev, suggestion.token];
    });
  };

  const handleComposerInputChange = (nextValue: string) => {
    setMessage(nextValue);
  };

  const handleComposerKeyDown = (
    event: KeyboardEvent<HTMLTextAreaElement>,
    options?: { submit?: () => void },
  ) => {
    const canUseSlash = Boolean(slashQuery) && slashSuggestions.length > 0;
    const suggestionCount = slashSuggestions.length;
    if (slashQuery && event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      const current = slashSuggestions[Math.max(0, slashActiveIndex)];
      if (current) applySlashSuggestion(current);
      return;
    }
    if (canUseSlash) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSlashActiveIndex((prev) =>
          suggestionCount > 0 ? (prev + 1) % suggestionCount : 0,
        );
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSlashActiveIndex((prev) =>
          suggestionCount > 0
            ? (prev - 1 + suggestionCount) % suggestionCount
            : 0,
        );
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        const current = slashSuggestions[Math.max(0, slashActiveIndex)];
        if (current) applySlashSuggestion(current);
        return;
      }
      if (event.key === " ") {
        const current = slashSuggestions[Math.max(0, slashActiveIndex)];
        if (current) {
          event.preventDefault();
          applySlashSuggestion(current);
          return;
        }
      }
    }

    if (
      event.key === "Backspace" &&
      !message &&
      composerReferences.length > 0
    ) {
      event.preventDefault();
      const last = composerReferences[composerReferences.length - 1];
      if (last) {
        setComposerReferences((prev) => prev.slice(0, -1));
        setMessage(last.queryText);
      }
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      options?.submit?.();
    }
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
    const attachmentDrafts = [...attachments];
    const referenceDrafts = [...composerReferences];
    const hasAttachments = attachmentDrafts.length > 0;
    const hasReferences = referenceDrafts.length > 0;
    const displayText =
      trimmed ||
      (hasAttachments || hasReferences
        ? t("homeWorkspace.referencesAdded")
        : "");
    const baseText =
      trimmed ||
      (hasAttachments
        ? DEFAULT_ATTACHMENT_PROMPT
        : hasReferences
          ? t("homeWorkspace.processReferencedAbilities")
          : "");
    if (!baseText) return;
    const altusMode = readAltusMode();

    if (hasReferences) {
      setComposerReferences([]);
    }

    try {
      const { uploadableAttachments, selectedSkills } =
        partitionPendingAttachments(attachmentDrafts);
      const referencedSkills = referenceDrafts
        .filter((item) => item.kind === "skill")
        .map((item) => item.skill)
        .filter((item): item is TaskCreationPlatformSkill => Boolean(item))
        .map((item) => ({
          sourceType: item.sourceType,
          skillId: item.skillId,
          revisionId: item.revisionId,
          slug: item.slug,
          name: item.name,
          description: item.description,
          category: item.category,
          revisionNumber: item.revisionNumber,
          resourceSummary: item.resourceSummary,
        }));
      const mergedSkills = [...selectedSkills, ...referencedSkills].filter(
        (item, index, list) =>
          list.findIndex(
            (current) =>
              current.skillId === item.skillId &&
              current.revisionId === item.revisionId,
          ) === index,
      );
      const selectedMcp = normalizeComposerSelectedMcp(referenceDrafts);
      const currentPath =
        typeof window !== "undefined" ? window.location.pathname : location;
      const currentSearch =
        typeof window !== "undefined" ? window.location.search : search;
      const routeForcesNewSession =
        currentPath.startsWith("/new-task") &&
        Boolean(new URLSearchParams(currentSearch).get("new")?.trim());
      let activeSessionId = resolveHomeSubmitActiveSessionId({
        routeForcesNewSession,
        sessionId,
        uploadSessionId: uploadSessionIdRef.current,
      });
      if (
        altusMode !== "managed" &&
        uploadableAttachments.length > 0 &&
        !activeSessionId
      ) {
        activeSessionId = await ensureSession(
          displayText || t("homeWorkspace.newTaskSession"),
        );
      }

      let uploadedAttachments: UploadedTaskAttachment[] = [];
      if (altusMode !== "managed" && uploadableAttachments.length > 0) {
        uploadedAttachments = await Promise.all(
          uploadableAttachments.map((item) =>
            ensurePendingAttachmentUploaded(item, activeSessionId),
          ),
        );
        activeSessionId = (
          sessionId ||
          uploadSessionIdRef.current ||
          activeSessionId
        ).trim();
      }

      exitHistoryView();
      if (altusMode === "managed") {
        await sendChatInput(baseText, {
          sessionId: activeSessionId || undefined,
          metadata: buildManagedTaskInputMetadata({
            originalInput: displayText,
            modelTier: selectedModel || "pro",
            skills: mergedSkills,
            mcpReferences: selectedMcp,
            fileCount: uploadableAttachments.length,
          }),
          files: uploadableAttachments.map((item) => item.file),
        });
      } else {
        await sendChatInput(
          appendAttachmentsToPrompt(baseText, uploadedAttachments),
          {
            sessionId: activeSessionId || undefined,
            metadata:
              uploadedAttachments.length || mergedSkills.length
                ? {
                    ...(uploadedAttachments.length
                      ? { attachments: uploadedAttachments }
                      : {}),
                    ...(mergedSkills.length ? { skills: mergedSkills } : {}),
                    ...(selectedMcp.length
                      ? { mcpReferences: selectedMcp }
                      : {}),
                    originalInput: displayText,
                  }
                : selectedMcp.length
                  ? {
                      mcpReferences: selectedMcp,
                      originalInput: displayText,
                    }
                  : undefined,
          },
        );
      }
      if (hasAttachments) {
        clearAttachmentUploadState(uploadableAttachments.map((item) => item.id));
        setAttachments([]);
      }
    } catch (error) {
      if (hasAttachments) {
        const draftFiles = attachmentDrafts
          .filter((item) => item.kind === "file")
          .map((item) => item.file);
        const draftSkills = attachmentDrafts.filter(
          (item) => item.kind === "skill",
        );
        setAttachments((current) => {
          const mergedFiles = mergePendingAttachments(
            current,
            draftFiles,
          ).attachments;
          return mergePendingPlatformSkills(mergedFiles, draftSkills);
        });
      }
      if (hasReferences) {
        setComposerReferences(referenceDrafts);
      }
      toast.error(
        error instanceof Error
          ? error.message
          : t("homeWorkspace.attachmentSendFailed"),
      );
      if (isInsufficientCreditsError(error)) {
        void refreshCreditsRef.current();
      }
    }
  }

  const handleSend = () => {
    if (
      !message.trim() &&
      attachments.length === 0 &&
      composerReferences.length === 0
    )
      return;
    setMode("chat");
    void submitPrompt(message);
    setMessage("");
  };

  function handleResolvedVoiceTranscript(transcript: string) {
    const spokenText = transcript.trim();
    if (!spokenText) {
      throw new Error("未识别到有效语音内容");
    }

    const mergedInput = [voiceInputBaseRef.current.trim(), spokenText]
      .filter(Boolean)
      .join("\n");
    setMessage(mergedInput);
    voiceInputBaseRef.current = "";
  }

  function handleVoiceRecordingStart() {
    voiceInputBaseRef.current = message.trim();
  }

  function handleVoicePreviewTranscript(transcript: string) {
    const previewText = transcript.trim();
    const mergedInput = [voiceInputBaseRef.current.trim(), previewText]
      .filter(Boolean)
      .join("\n");
    setMessage(mergedInput);
  }

  const handleStop = () => {
    if (!sessionId) return;
    void interruptCurrentRun(sessionId).catch((error) => {
      const text = error instanceof Error ? error.message : String(error || "");
      if (/signal:\s*terminated/i.test(text) || /terminated/i.test(text)) {
        return;
      }
      toast.error(text || t("homeWorkspace.stopExecutionFailed"));
    });
  };

  const handleQuickAction = (action: string) => {
    setMode("chat");
    void submitPrompt(action);
    setMessage("");
  };

  async function submitQuestionAnswer(rawInput: string) {
    const trimmed = rawInput.trim();
    const attachmentDrafts = [...attachments];
    const referenceDrafts = [...composerReferences];
    const hasAttachments = attachmentDrafts.length > 0;
    const hasReferences = referenceDrafts.length > 0;
    const displayText =
      trimmed ||
      (hasAttachments || hasReferences
        ? t("homeWorkspace.referencesAdded")
        : "");
    const baseText =
      trimmed ||
      (hasAttachments
        ? DEFAULT_ATTACHMENT_PROMPT
        : hasReferences
          ? t("homeWorkspace.processReferencedAbilities")
          : "");
    if (!baseText) return;

    const altusMode = readAltusMode();
    const activeSessionId = (sessionId || "").trim() || undefined;

    if (hasReferences) {
      setComposerReferences([]);
    }

    try {
      const { uploadableAttachments, selectedSkills } =
        partitionPendingAttachments(attachmentDrafts);
      const referencedSkills = referenceDrafts
        .filter((item) => item.kind === "skill")
        .map((item) => item.skill)
        .filter((item): item is TaskCreationPlatformSkill => Boolean(item))
        .map((item) => ({
          sourceType: item.sourceType,
          skillId: item.skillId,
          revisionId: item.revisionId,
          slug: item.slug,
          name: item.name,
          description: item.description,
          category: item.category,
          revisionNumber: item.revisionNumber,
          resourceSummary: item.resourceSummary,
        }));
      const mergedSkills = [...selectedSkills, ...referencedSkills].filter(
        (item, index, list) =>
          list.findIndex(
            (current) =>
              current.skillId === item.skillId &&
              current.revisionId === item.revisionId,
          ) === index,
      );
      const selectedMcp = normalizeComposerSelectedMcp(referenceDrafts);
      const resolvedSessionId =
        activeSessionId || uploadSessionIdRef.current || "";
      let uploadedAttachments: UploadedTaskAttachment[] = [];
      if (
        altusMode !== "managed" &&
        uploadableAttachments.length > 0 &&
        resolvedSessionId
      ) {
        uploadedAttachments = await Promise.all(
          uploadableAttachments.map((item) =>
            ensurePendingAttachmentUploaded(item, resolvedSessionId),
          ),
        );
      }

      exitHistoryView();
      if (altusMode === "managed") {
        await answerQuestion(baseText, {
          sessionId: activeSessionId,
          metadata: buildManagedTaskInputMetadata({
            originalInput: displayText,
            modelTier: selectedModel || "pro",
            skills: mergedSkills,
            mcpReferences: selectedMcp,
            fileCount: uploadableAttachments.length,
          }),
          files: uploadableAttachments.length
            ? uploadableAttachments.map((item) => item.file)
            : undefined,
        });
      } else {
        await answerQuestion(
          appendAttachmentsToPrompt(baseText, uploadedAttachments),
          {
            sessionId: resolvedSessionId || activeSessionId,
            metadata:
              uploadedAttachments.length || mergedSkills.length
                ? {
                    ...(uploadedAttachments.length
                      ? { attachments: uploadedAttachments }
                      : {}),
                    ...(mergedSkills.length ? { skills: mergedSkills } : {}),
                    ...(selectedMcp.length
                      ? { mcpReferences: selectedMcp }
                      : {}),
                    originalInput: displayText,
                  }
                : selectedMcp.length
                  ? {
                      mcpReferences: selectedMcp,
                      originalInput: displayText,
                    }
                  : undefined,
          },
        );
      }
      if (hasAttachments) {
        clearAttachmentUploadState(uploadableAttachments.map((item) => item.id));
        setAttachments([]);
      }
    } catch (error) {
      if (hasAttachments) {
        const draftFiles = attachmentDrafts
          .filter((item) => item.kind === "file")
          .map((item) => item.file);
        const draftSkills = attachmentDrafts.filter(
          (item) => item.kind === "skill",
        );
        setAttachments((current) => {
          const mergedFiles = mergePendingAttachments(
            current,
            draftFiles,
          ).attachments;
          return mergePendingPlatformSkills(mergedFiles, draftSkills);
        });
      }
      if (hasReferences) {
        setComposerReferences(referenceDrafts);
      }
      toast.error(
        error instanceof Error
          ? error.message
          : t("homeWorkspace.attachmentSendFailed"),
      );
      if (isInsufficientCreditsError(error)) {
        void refreshCreditsRef.current();
      }
    }
  }

  const handleAnswerQuestion = (answer: string) => {
    void submitQuestionAnswer(answer);
  };

  const quickActionLabels = t("homeWorkspace.quickActions", {
    returnObjects: true,
  }) as string[];
  const quickActions = [
    { label: quickActionLabels[0] || "", icon: "📊" },
    { label: quickActionLabels[1] || "", icon: "📄" },
    { label: quickActionLabels[2] || "", icon: "🎨" },
    { label: quickActionLabels[3] || "", icon: "💻" },
  ];

  const chatItems = useMemo(
    () => collapseRepeatedChatAuthors(buildChatItems(messages)),
    [messages],
  );
  const visibleChatItems = useMemo(
    () =>
      groupManagedActivityItems(
        chatItems.filter(
          (item) =>
            item.kind !== "managed_status" || item.displayInTimeline !== false,
        ),
      ),
    [chatItems],
  );
  const managedProcessingText = useMemo(
    () => getActiveManagedStatusText(chatItems),
    [chatItems],
  );
  const altusMode = readAltusMode();
  const managedAltusMode = altusMode === "managed";
  const managedReplayByRun = useMemo(
    () => buildManagedReplayData(messages),
    [messages],
  );
  const latestManagedReplay = useMemo(() => {
    const replays = Array.from(managedReplayByRun.values());
    return replays[replays.length - 1] || null;
  }, [managedReplayByRun]);
  const { diffItems } = useMemo(() => buildPreviewItems(messages), [messages]);
  const hasSendDraft =
    Boolean(message.trim()) ||
    attachments.length > 0 ||
    composerReferences.length > 0;
  const showStopButton = isProcessing && !currentQuestion && !hasSendDraft;
  const slashSkillSuggestions = useMemo(
    () => slashSuggestions.filter((item) => item.kind === "skill"),
    [slashSuggestions],
  );
  const slashMcpSuggestions = useMemo(
    () => slashSuggestions.filter((item) => item.kind === "mcp"),
    [slashSuggestions],
  );
  const suggestionIndexById = useMemo(() => {
    const map = new Map<string, number>();
    slashSuggestions.forEach((item, index) => map.set(item.id, index));
    return map;
  }, [slashSuggestions]);
  const composerReferenceTokens = composerReferences.length ? (
    <div className="flex flex-wrap gap-2">
      {composerReferences.map((token) => (
        <button
          key={token.id}
          type="button"
          onClick={() => removeComposerReference(token)}
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
            token.kind === "skill"
              ? "border-[#34D399]/70 bg-[#ECFDF5] text-[#1E293B]"
              : "border-[#60A5FA]/70 bg-[#EFF6FF] text-[#1E293B]"
          }`}
        >
          <span className="font-medium">
            {token.kind === "skill" ? "skill" : "mcp"}
          </span>
          <span className="max-w-[180px] truncate">{token.label}</span>
          <X className="h-3 w-3 text-muted-foreground" />
        </button>
      ))}
    </div>
  ) : null;
  const slashSuggestionPanel = slashQuery ? (
    slashSuggestions.length ? (
      <div className="space-y-2 rounded-2xl border border-[#CBD5E1] bg-[#FFFFFF] p-2 shadow-[0_12px_40px_rgba(15,23,42,0.08)]">
        {slashSkillSuggestions.length ? (
          <div className="space-y-1">
            <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-[#64748B]">
              Skills
            </div>
            {slashSkillSuggestions.map((item) => {
              const itemIndex = suggestionIndexById.get(item.id) ?? -1;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => applySlashSuggestion(item)}
                  className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-sm transition-colors ${
                    itemIndex === slashActiveIndex
                      ? "bg-[#DBEAFE] text-[#1D4ED8]"
                      : "text-[#0F172A] hover:bg-[#F1F5F9]"
                  }`}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#F1F5F9]">
                    <Terminal className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">
                      {item.label}
                    </span>
                    <span className="block truncate text-xs opacity-80">
                      {item.subLabel}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 opacity-70" />
                </button>
              );
            })}
          </div>
        ) : null}
        {slashMcpSuggestions.length ? (
          <div className="space-y-1">
            {slashSkillSuggestions.length ? (
              <div className="mx-2 h-px bg-[#F1F5F9]" />
            ) : null}
            <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-[#64748B]">
              Connectors
            </div>
            {slashMcpSuggestions.map((item) => {
              const itemIndex = suggestionIndexById.get(item.id) ?? -1;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => applySlashSuggestion(item)}
                  className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-sm transition-colors ${
                    itemIndex === slashActiveIndex
                      ? "bg-[#DBEAFE] text-[#1D4ED8]"
                      : "text-[#0F172A] hover:bg-[#F1F5F9]"
                  }`}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#F1F5F9]">
                    <Plug className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">
                      {item.label}
                    </span>
                    <span className="block truncate text-xs opacity-80">
                      {item.subLabel}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 opacity-70" />
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    ) : (
      <div className="px-1.5 py-1 text-xs text-[#64748B]">
        {slashCatalogLoading
          ? t("homeWorkspace.loadingReferences")
          : slashCatalogError
            ? t("homeWorkspace.referenceLoadFailedWithReason", {
                reason: slashCatalogError,
              })
            : t("homeWorkspace.noReferencesFound", {
                skills: slashSkillCatalog.length,
                connectors: slashMcpCatalog.length,
              })}
      </div>
    )
  ) : null;

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

  const findDiffIdForMessageKey = (messageKey: string | null | undefined) => {
    const normalized = (messageKey || "").trim();
    if (!normalized) return null;
    for (let i = diffItems.length - 1; i >= 0; i -= 1) {
      const item = diffItems[i];
      if (item.eventMessageKey === normalized) return item.id;
      if (item.relatedMessageKeys?.includes(normalized)) return item.id;
    }
    return null;
  };

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

  const resolveDiffTarget = (options?: {
    diffId?: string | null;
    filePath?: string | null;
    messageKey?: string | null;
    messageIndex?: number | null;
  }) =>
    pickExistingDiffId(options?.diffId) ||
    pickExistingDiffId(findDiffIdForMessageKey(options?.messageKey)) ||
    pickExistingDiffId(findDiffIdForFile(options?.filePath || null)) ||
    pickExistingDiffId(findDiffIdForMessageIndex(options?.messageIndex)) ||
    diffItems[diffItems.length - 1]?.id ||
    null;

  const openDiffPreview = (options?: {
    diffId?: string | null;
    filePath?: string | null;
    messageKey?: string | null;
    messageIndex?: number | null;
  }) => {
    setPreviewWorkspacePath(null);
    setPreviewTab("changes");
    setPreviewOpen(true);
    const normalizedMessageKey = (options?.messageKey || "").trim() || null;
    if (normalizedMessageKey) {
      setSelectedDiffMessageKey(normalizedMessageKey);
    }
    const target = resolveDiffTarget(options);
    if (
      !target &&
      (options?.diffId ||
        options?.filePath ||
        options?.messageKey ||
        options?.messageIndex !== undefined)
    ) {
      setPendingDiffTarget({
        diffId: options?.diffId || null,
        filePath: options?.filePath || null,
        messageKey: normalizedMessageKey,
        messageIndex:
          typeof options?.messageIndex === "number" &&
          Number.isFinite(options.messageIndex)
            ? options.messageIndex
            : null,
      });
    } else {
      setPendingDiffTarget(null);
    }
    setSelectedDiffId(target);
  };

  const approveGoogleWorkspaceConfirmation = useCallback(
    async (confirmation: GoogleWorkspaceConfirmationView) => {
      if (!sessionId) {
        toast.error(t("homeWorkspace.missingSession"));
        return;
      }
      const result = await approveMcpToolConfirmation(
        sessionId,
        confirmation.confirmationId,
      );
      const connectorLabel = getMcpConfirmationConnectorLabel(
        confirmation.connectorKey,
      );
      appendLocalMessage(
        {
          messageKey: `mcp-confirmation-followup:${confirmation.confirmationId}`,
          type: "status_update",
          content: `已确认执行，正在继续处理 ${connectorLabel} 高风险操作...`,
          message: `已确认执行，正在继续处理 ${connectorLabel} 高风险操作...`,
          stage: "executing",
          tone: "system",
          sessionId,
          metadata: {
            eventType: "run_status",
            status: "running",
            confirmationId: confirmation.confirmationId,
            connectorKey: confirmation.connectorKey,
            source: "mcp_tool_confirmation_followup",
          },
        },
        { sessionId },
      );
      await awaitManagedRunRecovery(sessionId);
      setHandledGoogleConfirmationIds((prev) =>
        prev.includes(confirmation.confirmationId)
          ? prev
          : [...prev, confirmation.confirmationId],
      );
      toast.success(`已确认 ${connectorLabel} 操作`);
    },
    [awaitManagedRunRecovery, sessionId, t],
  );

  const rejectGoogleWorkspaceConfirmation = useCallback(
    async (confirmation: GoogleWorkspaceConfirmationView) => {
      if (!sessionId) {
        toast.error(t("homeWorkspace.missingSession"));
        return;
      }
      const connectorLabel = getMcpConfirmationConnectorLabel(
        confirmation.connectorKey,
      );
      await rejectMcpToolConfirmation(sessionId, confirmation.confirmationId);
      appendLocalMessage(
        {
          messageKey: `mcp-confirmation-rejected:${confirmation.confirmationId}`,
          type: "status_update",
          content: `已拒绝执行，${connectorLabel} 高风险操作已取消。`,
          message: `已拒绝执行，${connectorLabel} 高风险操作已取消。`,
          stage: "executing",
          tone: "system",
          sessionId,
          metadata: {
            eventType: "run_status",
            status: "waiting_user",
            confirmationId: confirmation.confirmationId,
            connectorKey: confirmation.connectorKey,
            source: "mcp_tool_confirmation_followup",
          },
        },
        { sessionId },
      );
      await awaitManagedRunRecovery(sessionId);
      setHandledGoogleConfirmationIds((prev) =>
        prev.includes(confirmation.confirmationId)
          ? prev
          : [...prev, confirmation.confirmationId],
      );
      toast.success(`已拒绝 ${connectorLabel} 操作`);
    },
    [awaitManagedRunRecovery, sessionId, t],
  );

  const submitDeploymentPrompt = async (
    action: TaskSessionDeploymentPromptAction,
  ) => {
    if (!sessionId) {
      toast.error(t("homeWorkspace.missingSession"));
      return;
    }

    setPreviewWorkspacePath(null);
    setPreviewTab("deployment");
    setPreviewOpen(true);
    await submitPrompt(buildTaskSessionDeploymentPrompt(action));
  };

  const deployFromArtifactCard = async (_path: string) => {
    try {
      await submitDeploymentPrompt("deploy");
      toast.success(t("homeWorkspace.deploySubmitted"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("homeWorkspace.deployFailed"),
      );
      throw error;
    }
  };

  useEffect(() => {
    if (!selectedDiffId) return;
    const current = diffItems.find((item) => item.id === selectedDiffId);
    if (!current) return;
    const nextMessageKey =
      current.eventMessageKey || current.relatedMessageKeys?.[0] || null;
    if (!nextMessageKey || nextMessageKey === selectedDiffMessageKey) {
      return;
    }
    setSelectedDiffMessageKey(nextMessageKey);
  }, [diffItems, selectedDiffId, selectedDiffMessageKey]);

  useEffect(() => {
    if (!selectedDiffId) return;
    if (diffItems.some((item) => item.id === selectedDiffId)) return;
    const fallback =
      pickExistingDiffId(findDiffIdForMessageKey(selectedDiffMessageKey)) ||
      diffItems[diffItems.length - 1]?.id ||
      null;
    setSelectedDiffId(fallback);
  }, [diffItems, selectedDiffId, selectedDiffMessageKey]);

  useEffect(() => {
    if (!pendingDiffTarget) return;
    const target = resolveDiffTarget(pendingDiffTarget);
    if (!target) return;
    setSelectedDiffId(target);
    setPendingDiffTarget(null);
  }, [diffItems, pendingDiffTarget]);

  const showDesktopPreview = previewOpen && !isMobile;
  const showMobilePreview = previewOpen && isMobile;
  const currentProjectOption = useMemo(
    () =>
      pendingProjectId
        ? projectOptions.find((item) => item.id === pendingProjectId) || null
        : null,
    [pendingProjectId, projectOptions],
  );
  const inputProjectHintLabel =
    projectOptionsLoading && pendingProjectId && !currentProjectOption
      ? t("homePage.projectContextLoading")
      : clampProjectHintLabel(
          currentProjectOption?.name || t("homePage.projectNoProject"),
          8,
        );
  const showInputProjectHint =
    mode === "input" && location.startsWith("/new-task");
  const activeAltusReplay = altusReplayRunId
    ? managedReplayByRun.get(altusReplayRunId) || null
    : latestManagedReplay;
  const activeAltusReplayIndex =
    activeAltusReplay && activeAltusReplay.actions.length > 0
      ? Math.min(
          Math.max(0, altusReplayIndex),
          activeAltusReplay.actions.length - 1,
        )
      : 0;
  const previewResizeDraggingRef = useRef(false);
  const previewResizeLastClientXRef = useRef<number | null>(null);
  const previewPanelMaxSize = managedAltusMode ? 70 : 48;
  const previewPanelMinSize = managedAltusMode ? 50 : 30;
  const previewPanelDefaultSize = managedAltusMode ? 50 : 34;
  const chatPanelDefaultSize = 100 - previewPanelDefaultSize;
  const chatPanelMinSize = managedAltusMode ? 30 : 42;

  const openAltusReplay = useCallback((
    runId: string,
    options?: {
      toolCallId?: string | null;
      view?: AltusDrawerView;
    },
  ) => {
    if (!runId) return;
    setAltusReplayRunId(runId);
    setAltusReplayView(options?.view || "actions");
    setPreviewOpen(true);
    setPreviewMaximized(false);
    if (options?.toolCallId) {
      setPendingAltusReplayToolCallId(options.toolCallId);
    } else {
      const replay = managedReplayByRun.get(runId);
      setAltusReplayIndex(Math.max(0, (replay?.actions.length || 1) - 1));
      setPendingAltusReplayToolCallId(null);
    }
  }, [managedReplayByRun]);

  useEffect(() => {
    setPendingAutoManagedDebugAction(null);
    setAutoManagedDebugInfo(null);
    autoOpenedManagedDebugActionsRef.current.clear();
    wasAutoOpeningManagedDebugRef.current = false;
    if (autoManagedDebugPollRef.current) {
      window.clearTimeout(autoManagedDebugPollRef.current);
      autoManagedDebugPollRef.current = null;
    }
  }, [sessionId]);

  useEffect(() => {
    if (!managedAltusMode) {
      wasAutoOpeningManagedDebugRef.current = false;
      setPendingAutoManagedDebugAction(null);
      setAutoManagedDebugInfo(null);
      return;
    }
    if (!isProcessing) {
      seedManagedVisualDebugActionKeys(
        autoOpenedManagedDebugActionsRef.current,
        managedReplayByRun,
      );
      wasAutoOpeningManagedDebugRef.current = false;
      setPendingAutoManagedDebugAction(null);
      return;
    }
    if (!wasAutoOpeningManagedDebugRef.current) {
      seedManagedVisualDebugActionKeys(
        autoOpenedManagedDebugActionsRef.current,
        managedReplayByRun,
      );
      wasAutoOpeningManagedDebugRef.current = true;
      return;
    }
    const action = findLatestManagedVisualDebugAction(latestManagedReplay);
    if (!action) {
      return;
    }
    const autoOpenKey = getManagedVisualDebugActionKey(action);
    if (autoOpenedManagedDebugActionsRef.current.has(autoOpenKey)) {
      return;
    }
    autoOpenedManagedDebugActionsRef.current.add(autoOpenKey);
    setPendingAutoManagedDebugAction({
      runId: action.runId,
      toolCallId: action.toolCallId,
      key: autoOpenKey,
    });
  }, [
    isProcessing,
    latestManagedReplay,
    managedAltusMode,
    managedReplayByRun,
  ]);

  useEffect(() => {
    if (autoManagedDebugPollRef.current) {
      window.clearTimeout(autoManagedDebugPollRef.current);
      autoManagedDebugPollRef.current = null;
    }
    if (!managedAltusMode || !isProcessing || !sessionId || !pendingAutoManagedDebugAction) {
      return;
    }
    let cancelled = false;
    const pollUntilDebugReady = async () => {
      try {
        const info = await getTaskCreationDebugInfo(sessionId);
        if (cancelled) return;
        if (info?.ready && info.url) {
          setAutoManagedDebugInfo({
            actionKey: pendingAutoManagedDebugAction.key,
            info,
          });
          openAltusReplay(pendingAutoManagedDebugAction.runId, {
            toolCallId: pendingAutoManagedDebugAction.toolCallId,
            view: "debug",
          });
          setPendingAutoManagedDebugAction(null);
          return;
        }
        autoManagedDebugPollRef.current = window.setTimeout(
          pollUntilDebugReady,
          MANAGED_AUTO_DEBUG_READY_POLL_MS,
        );
      } catch {
        if (cancelled) return;
        autoManagedDebugPollRef.current = window.setTimeout(
          pollUntilDebugReady,
          MANAGED_AUTO_DEBUG_RETRY_POLL_MS,
        );
      }
    };
    void pollUntilDebugReady();
    return () => {
      cancelled = true;
      if (autoManagedDebugPollRef.current) {
        window.clearTimeout(autoManagedDebugPollRef.current);
        autoManagedDebugPollRef.current = null;
      }
    };
  }, [
    isProcessing,
    managedAltusMode,
    openAltusReplay,
    pendingAutoManagedDebugAction,
    sessionId,
  ]);

  useEffect(() => {
    if (!activeAltusReplay) {
      return;
    }
    if (pendingAltusReplayToolCallId) {
      const action = activeAltusReplay.actions.find(
        (item) => item.toolCallId === pendingAltusReplayToolCallId,
      );
      if (action) {
        setAltusReplayIndex(action.stepIndex);
        setPendingAltusReplayToolCallId(null);
        return;
      }
    }
    if (activeAltusReplay.actions.length === 0) {
      if (altusReplayIndex !== 0) {
        setAltusReplayIndex(0);
      }
      return;
    }
    const maxIndex = activeAltusReplay.actions.length - 1;
    if (altusReplayIndex > maxIndex) {
      setAltusReplayIndex(maxIndex);
    }
  }, [activeAltusReplay, altusReplayIndex, pendingAltusReplayToolCallId]);

  useEffect(() => {
    if (!previewOpen && previewMaximized) {
      setPreviewMaximized(false);
    }
  }, [previewOpen, previewMaximized]);

  useEffect(() => {
    if (!location.startsWith("/new-task") || !projectOptionsLoaded) {
      return;
    }
    if (!pendingProjectId) {
      return;
    }
    const exists = projectOptions.some((item) => item.id === pendingProjectId);
    if (exists) {
      return;
    }
    setPendingProjectId(null);
    syncPendingProjectToUrl(null);
  }, [
    location,
    pendingProjectId,
    projectOptions,
    projectOptionsLoaded,
    syncPendingProjectToUrl,
  ]);

  const handlePreviewResizeDragging = useCallback((isDragging: boolean) => {
    previewResizeDraggingRef.current = isDragging;
    if (!isDragging) {
      previewResizeLastClientXRef.current = null;
    }
  }, []);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!previewResizeDraggingRef.current) return;
      const previousClientX = previewResizeLastClientXRef.current;
      previewResizeLastClientXRef.current = event.clientX;
      if (previousClientX === null) {
        return;
      }
      if (
        shouldAutoCollapseSidebarForAltusActions({
          managedAltusMode,
          sidebarCollapsed,
          previewOpen,
          previewMaximized,
          previewPanelSize: desktopPreviewLayout[1] || 0,
          previewPanelMaxSize,
          dragDeltaX: event.clientX - previousClientX,
        })
      ) {
        setSidebarCollapsed(true);
        previewResizeDraggingRef.current = false;
        previewResizeLastClientXRef.current = null;
      }
    };

    const handlePointerUp = () => {
      previewResizeDraggingRef.current = false;
      previewResizeLastClientXRef.current = null;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [
    desktopPreviewLayout,
    managedAltusMode,
    previewOpen,
    previewMaximized,
    sidebarCollapsed,
  ]);

  const previewPanel = previewOpen ? (
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
      {managedAltusMode && sessionId ? (
        <AltusRunReplayDrawer
          embedded
          open={previewOpen}
          onOpenChange={(open) => {
            setPreviewOpen(open);
            if (!open) {
              setPreviewMaximized(false);
            }
          }}
          sessionId={sessionId}
          runId={activeAltusReplay?.runId || "managed-preview"}
          runTitle={t("homeWorkspace.altusActions")}
          actions={activeAltusReplay?.actions || []}
          files={activeAltusReplay?.files || []}
          currentIndex={activeAltusReplayIndex}
          latestIndex={Math.max(
            0,
            (activeAltusReplay?.actions.length || 1) - 1,
          )}
          activeView={altusReplayView}
          onActiveViewChange={setAltusReplayView}
          onSelectIndex={setAltusReplayIndex}
          onJumpToLatest={() =>
            setAltusReplayIndex(
              Math.max(0, (activeAltusReplay?.actions.length || 1) - 1),
            )
          }
          diffItems={activeAltusReplay?.diffItems || []}
          runtimeReady={runtime.ready}
          runtimeStarting={runtime.starting}
          onEnsureRuntime={runtime.ensure}
          runtimeSwitchBlocked={managedRunActive}
          debugInfoOverride={autoManagedDebugInfo?.info || null}
          onRequestStartDebugByMessage={() => {
            void submitPrompt(t("homeWorkspace.startDebugPrompt"));
          }}
          onRequestDeployByMessage={() => {
            void submitDeploymentPrompt("deploy");
          }}
          onRequestRedeployByMessage={() => {
            void submitDeploymentPrompt("redeploy");
          }}
          onRequestRollbackByMessage={() => {
            void submitDeploymentPrompt("rollback");
          }}
        />
      ) : (
        <OpencodePreviewPanel
          messages={messages}
          sessionId={sessionId}
          open={previewOpen}
          maximized={previewMaximized}
          onToggleMaximized={() => setPreviewMaximized((prev) => !prev)}
          activeTab={previewTab}
          onTabChange={setPreviewTab}
          onToggle={() => setPreviewOpen(false)}
          selectedDiffId={selectedDiffId}
          onSelectDiff={(id) => {
            setPendingDiffTarget(null);
            setSelectedDiffId(id);
          }}
          runtimeReady={runtime.ready}
          runtimeStarting={runtime.starting}
          onEnsureRuntime={runtime.ensure}
          runtimeSwitchBlocked={managedRunActive}
          onRequestStartDebugByMessage={() => {
            void submitPrompt(t("homeWorkspace.startDebugPrompt"));
          }}
          onRequestDeployByMessage={() => {
            void submitDeploymentPrompt("deploy");
          }}
          onRequestRedeployByMessage={() => {
            void submitDeploymentPrompt("redeploy");
          }}
          onRequestRollbackByMessage={() => {
            void submitDeploymentPrompt("rollback");
          }}
          selectedWorkspacePath={previewWorkspacePath}
          className="h-full min-h-0 w-full"
        />
      )}
    </section>
  ) : null;

  const chatPanel = (
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-background/35">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0 space-y-1">
            <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              {t("homeWorkspace.dialogueLabel")}
            </div>
            <div className="truncate text-sm font-semibold text-foreground">
              {t("homeWorkspace.dialogueTitle")}
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            {runtime.orchestratorSessionId && runtime.ready ? (
              <span className="truncate text-xs text-muted-foreground">
                {t("homeWorkspace.runtimeAttached", {
                  sessionId: runtime.orchestratorSessionId,
                })}
              </span>
            ) : null}
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-7 w-7 bg-transparent hover:bg-transparent"
              onClick={() => setPreviewOpen((open) => !open)}
              aria-pressed={previewOpen}
              aria-label={
                previewOpen
                  ? "Close Altus actions window"
                  : "Open Altus actions window"
              }
            >
              {previewOpen ? (
                <PanelRightClose className="h-3.5 w-3.5" />
              ) : (
                <PanelRightOpen className="h-3.5 w-3.5" />
              )}
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
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-6 py-5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        >
          <div className="mx-auto w-full max-w-[52rem] space-y-4">
            {isLoadingOlderHistory && (
              <NoticeMessage
                tone="info"
                icon={<Loader2 className="w-4 h-4 animate-spin" />}
                text={t("homeWorkspace.loadingOlderHistory")}
              />
            )}

            {!isConnected && (
              <NoticeMessage
                tone="warning"
                icon={<Loader2 className="w-4 h-4 animate-spin" />}
                text={t("homeWorkspace.connectingAgent")}
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
                text={t("homeWorkspace.runtimeConnected", {
                  sessionId: runtime.orchestratorSessionId,
                })}
              />
            )}

            <AnimatePresence>
              {visibleChatItems.map((item, index) => (
                <MessageBubble
                  key={item.messageKey || `chat-item-${index}`}
                  item={item}
                  onOpenDiffPreview={openDiffPreview}
                  onOpenManagedReplay={openAltusReplay}
                  onDeployArtifact={deployFromArtifactCard}
                  runtimeSwitchBlocked={managedRunActive}
                  currentSessionId={sessionId}
                  hiddenGoogleConfirmationIds={resolvedGoogleConfirmationIds}
                  onApproveGoogleWorkspaceConfirmation={
                    approveGoogleWorkspaceConfirmation
                  }
                  onRejectGoogleWorkspaceConfirmation={
                    rejectGoogleWorkspaceConfirmation
                  }
                  onSubmitStructuredClarification={handleAnswerQuestion}
                />
              ))}
            </AnimatePresence>

            {isProcessing && !currentQuestion && (
              <NoticeMessage
                tone="info"
                icon={<Loader2 className="w-4 h-4 animate-spin" />}
                text={managedProcessingText || t("homeWorkspace.agentProcessing")}
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
          className="mt-auto shrink-0 bg-background/90 backdrop-blur"
        >
          <div className="px-6 py-3">
            {slashSuggestionPanel ? (
              <div className="mx-auto mb-2 w-[92%] max-w-[52rem]">
                {slashSuggestionPanel}
              </div>
            ) : null}
            <div
              data-tour="home-composer"
              className={`relative mx-auto w-full max-w-[52rem] rounded-[1.15rem] border border-border/80 bg-card/96 shadow-[0_16px_34px_rgba(15,35,65,0.08)] transition-all duration-200 hover:border-border focus-within:border-ring focus-within:shadow-[0_0_0_3px_rgba(9,105,218,0.16),0_16px_34px_rgba(15,35,65,0.08)] dark:shadow-[0_18px_48px_rgba(0,0,0,0.36)] ${
                isComposerDragActive
                  ? "border-ring shadow-[0_0_0_3px_rgba(9,105,218,0.16),0_16px_34px_rgba(15,35,65,0.08)]"
                  : ""
              }`}
              onDragEnter={handleComposerDragEnter}
              onDragOver={handleComposerDragOver}
              onDragLeave={handleComposerDragLeave}
              onDrop={handleComposerDrop}
              onPaste={handleComposerPaste}
            >
              {isComposerDragActive ? (
                <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-[1.15rem] border border-dashed border-ring bg-card/90 text-sm font-medium text-foreground">
                  <span className="inline-flex items-center gap-2 rounded-full bg-background px-3 py-2 shadow-sm">
                    <FilePlus className="h-4 w-4 text-primary" />
                    {t("attachments.dropToUpload")}
                  </span>
                </div>
              ) : null}
              <div className="space-y-3 p-4">
                <AttachmentChipList
                  attachments={attachments}
                  onRemove={removeAttachment}
                  uploadingIds={uploadingAttachmentIds}
                />
                <Textarea
                  placeholder={
                    currentQuestion
                      ? t("homeWorkspace.answerPlaceholder")
                      : t("homeWorkspace.continuePlaceholder")
                  }
                  value={message}
                  onChange={(e) => handleComposerInputChange(e.target.value)}
                  onKeyDown={(e) =>
                    handleComposerKeyDown(e, {
                      submit: () => {
                        if (currentQuestion) {
                          handleAnswerQuestion(message);
                          setMessage("");
                        } else if (showStopButton) {
                          handleStop();
                        } else {
                          handleSend();
                        }
                      },
                    })
                  }
                  className="min-h-[56px] resize-none border-0 bg-transparent px-0 py-0 text-[15px] leading-6 text-foreground placeholder:text-muted-foreground focus-visible:ring-0 md:text-[15px]"
                  rows={2}
                />
                {composerReferenceTokens}

                <TooltipProvider>
                  <div className="flex items-center justify-between pt-2">
                    <div className="flex items-center gap-1">
                      <span data-tour="composer-attachments">
                        <AttachmentPickerButton
                          onSelectFiles={handleAttachmentSelect}
                          onSelectSkills={handleSkillSelect}
                          selectedSkills={selectedSkillAttachments}
                        />
                      </span>

                      <span data-tour="composer-connectors">
                        <ConnectorDialog sessionId={sessionId} />
                      </span>

                      {selectedCapabilityBadge}

                      <DropdownMenu
                        open={modelMenuOpen}
                        onOpenChange={setModelMenuOpen}
                      >
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <DropdownMenuTrigger asChild>
                              <Button
                                data-tour="composer-model"
                                variant="ghost"
                                size="sm"
                                className="h-9 gap-2 rounded-xl px-3 transition-colors hover:bg-accent"
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
                        <DropdownMenuContent align="start" className="w-40">
                          <DropdownMenuItem
                            onClick={() => setSelectedModel("lite")}
                          >
                            <div className="flex flex-col">
                              <span className="font-medium">
                                {t("homePage.models.lite")}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {t("ceoView.modelLiteHint")}
                              </span>
                            </div>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setSelectedModel("pro")}
                          >
                            <div className="flex flex-col">
                              <span className="font-medium">
                                {t("homePage.models.pro")}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {t("ceoView.modelProHint")}
                              </span>
                            </div>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setSelectedModel("max")}
                          >
                            <div className="flex flex-col">
                              <span className="font-medium">
                                {t("homePage.models.max")}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {t("ceoView.modelMaxHint")}
                              </span>
                            </div>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    <div className="flex items-center gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span>
                            <VoiceInputButton
                              disabled={isInterrupting || showStopButton}
                              onRecordingStart={handleVoiceRecordingStart}
                              onPreviewTranscript={handleVoicePreviewTranscript}
                              onResolvedTranscript={handleResolvedVoiceTranscript}
                            />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>{t("homePage.voiceInput")}</p>
                        </TooltipContent>
                      </Tooltip>

                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            data-tour="composer-send"
                            onClick={() => {
                              if (currentQuestion) {
                                handleAnswerQuestion(message);
                                setMessage("");
                              } else if (showStopButton) {
                                handleStop();
                              } else {
                                handleSend();
                              }
                            }}
                            disabled={
                              isInterrupting ||
                              (currentQuestion
                                ? !message.trim() && attachments.length === 0
                                : showStopButton
                                  ? false
                                  : !message.trim() && attachments.length === 0)
                            }
                            size="icon"
                            className="h-9 w-9 rounded-full bg-foreground text-background transition-colors hover:bg-foreground/90 disabled:opacity-50"
                          >
                            {showStopButton ? (
                              <Square className="w-4 h-4" />
                            ) : (
                              <Send className="w-4 h-4" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>
                            {showStopButton
                              ? t("homeWorkspace.stopExecution")
                              : t("homePage.sendMessage")}
                          </p>
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
      fluid={mode === "chat"}
      lockViewport={mode === "chat"}
      selectedProject={selectedProject}
      sidebarCollapsed={sidebarCollapsed}
      onSidebarCollapsedChange={setSidebarCollapsed}
    >
      <GuidedTour
        storageKey={HOME_NEW_TASK_TOUR_KEY}
        storageScope={user?.id}
        steps={HOME_NEW_TASK_TOUR_STEPS}
        autoStart={mode === "input"}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setModelMenuOpen(false);
          }
        }}
        onStepChange={handleNewTaskTourStepChange}
        onComplete={() => setModelMenuOpen(false)}
        nextLabel="继续演示"
        finishLabel="开始修改"
      />
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
                      {t("homePage.title")}
                    </h1>
                  </motion.div>
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.2, duration: 0.4 }}
                    className="text-muted-foreground text-lg"
                  >
                    {t("homePage.subtitle")}
                  </motion.p>
                </div>

                {/* Main Input Area */}
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3, duration: 0.4 }}
                  className="relative"
                >
                  <div className="relative pt-1">
                    {slashSuggestionPanel ? (
                      <div className="mx-auto mb-2 w-[92%] max-w-full">
                        {slashSuggestionPanel}
                      </div>
                    ) : null}
                    {/* Text Area and Actions - Single Container */}
                    <div
                      data-tour="home-composer"
                      className={`relative z-10 space-y-3 rounded-[1.15rem] border border-border/80 bg-card/96 p-4 shadow-[0_16px_34px_rgba(15,35,65,0.08)] transition-all duration-200 hover:border-border focus-within:border-ring focus-within:shadow-[0_0_0_3px_rgba(9,105,218,0.16),0_16px_34px_rgba(15,35,65,0.08)] dark:shadow-[0_18px_48px_rgba(0,0,0,0.36)] ${
                        isComposerDragActive
                          ? "border-ring shadow-[0_0_0_3px_rgba(9,105,218,0.16),0_16px_34px_rgba(15,35,65,0.08)]"
                          : ""
                      }`}
                      onDragEnter={handleComposerDragEnter}
                      onDragOver={handleComposerDragOver}
                      onDragLeave={handleComposerDragLeave}
                      onDrop={handleComposerDrop}
                      onPaste={handleComposerPaste}
                    >
                      {isComposerDragActive ? (
                        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-[1.15rem] border border-dashed border-ring bg-card/90 text-sm font-medium text-foreground">
                          <span className="inline-flex items-center gap-2 rounded-full bg-background px-3 py-2 shadow-sm">
                            <FilePlus className="h-4 w-4 text-primary" />
                            {t("attachments.dropToUpload")}
                          </span>
                        </div>
                      ) : null}
                      <AttachmentChipList
                        attachments={attachments}
                        onRemove={removeAttachment}
                        uploadingIds={uploadingAttachmentIds}
                      />
                      {/* Textarea */}
                      <Textarea
                        placeholder={t("homePage.textareaPlaceholder")}
                        value={message}
                        onChange={(e) =>
                          handleComposerInputChange(e.target.value)
                        }
                        onKeyDown={(e) =>
                          handleComposerKeyDown(e, {
                            submit: () => handleSend(),
                          })
                        }
                        className="min-h-[100px] resize-none border-0 bg-transparent px-0 py-0 text-[15px] leading-6 text-foreground placeholder:text-muted-foreground focus-visible:ring-0 md:text-[15px]"
                        rows={4}
                      />
                      {composerReferenceTokens}

                      {/* Bottom Action Bar */}
                      <TooltipProvider>
                        <div className="flex items-center justify-between pt-2">
                          {/* Left Side Actions */}
                          <div className="flex items-center gap-1">
                            <span data-tour="composer-attachments">
                              <AttachmentPickerButton
                                onSelectFiles={handleAttachmentSelect}
                                onSelectSkills={handleSkillSelect}
                                selectedSkills={selectedSkillAttachments}
                              />
                            </span>

                            <span data-tour="composer-connectors">
                              <ConnectorDialog sessionId={sessionId} />
                            </span>

                            {selectedCapabilityBadge}

                            {/* Model Selection Button */}
                            <DropdownMenu
                              open={modelMenuOpen}
                              onOpenChange={setModelMenuOpen}
                            >
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      data-tour="composer-model"
                                      variant="ghost"
                                      size="sm"
                                      className="h-9 gap-2 rounded-xl transition-colors hover:bg-accent"
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
                              <DropdownMenuContent
                                align="start"
                                className="w-40"
                              >
                                <DropdownMenuItem
                                  onClick={() => setSelectedModel("lite")}
                                >
                                  <div className="flex flex-col">
                                    <span className="font-medium">
                                      {t("homePage.models.lite")}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                      {t("ceoView.modelLiteHint")}
                                    </span>
                                  </div>
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => setSelectedModel("pro")}
                                >
                                  <div className="flex flex-col">
                                    <span className="font-medium">
                                      {t("homePage.models.pro")}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                      {t("ceoView.modelProHint")}
                                    </span>
                                  </div>
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => setSelectedModel("max")}
                                >
                                  <div className="flex flex-col">
                                    <span className="font-medium">
                                      {t("homePage.models.max")}
                                    </span>
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
                                <span>
                                  <VoiceInputButton
                                    disabled={isInterrupting || isProcessing}
                                    onRecordingStart={handleVoiceRecordingStart}
                                    onPreviewTranscript={handleVoicePreviewTranscript}
                                    onResolvedTranscript={handleResolvedVoiceTranscript}
                                  />
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>{t("homePage.voiceInput")}</p>
                              </TooltipContent>
                            </Tooltip>

                            {/* Send Button */}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  data-tour="composer-send"
                                  onClick={handleSend}
                                  disabled={
                                    !message.trim() &&
                                    attachments.length === 0 &&
                                    composerReferences.length === 0
                                  }
                                  size="icon"
                                  className="h-9 w-9 rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
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
                    {showInputProjectHint ? (
                      <DropdownMenu
                        open={projectMenuOpen}
                        onOpenChange={setProjectMenuOpen}
                      >
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="relative z-0 -mt-4 mx-auto flex w-[94%] items-center justify-end rounded-b-[1rem] rounded-t-[0.55rem] border border-t-0 border-border/45 bg-muted/48 px-5 pb-3 pt-6 text-right shadow-[0_12px_24px_rgba(15,35,65,0.06)] transition-colors hover:bg-muted/58 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 dark:bg-muted/24 dark:hover:bg-muted/32 dark:shadow-[0_18px_32px_rgba(0,0,0,0.18)]"
                            aria-label={t("homePage.projectSelectorLabel")}
                          >
                            <div
                              data-tour="composer-project"
                              className="flex min-w-0 items-center justify-end gap-2 text-right"
                            >
                              <FolderSearch2 className="h-4 w-4 shrink-0 text-foreground/42" />
                              <span className="block truncate text-sm font-medium tracking-[0.01em] text-foreground/72">
                                {inputProjectHintLabel}
                              </span>
                              <ChevronDown className="h-4 w-4 shrink-0 text-foreground/42" />
                            </div>
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          side="bottom"
                          sideOffset={2}
                          className="w-[22rem] max-w-[calc(100vw-2.5rem)] rounded-2xl border-border/70 p-1.5 shadow-xl"
                        >
                          {projectOptionsLoading ? (
                              <DropdownMenuItem disabled className="rounded-xl px-3 py-2.5">
                              {t("homePage.projectListLoading")}
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuRadioGroup
                              value={pendingProjectId || NO_PROJECT_VALUE}
                              onValueChange={(value) => {
                                const nextProjectId =
                                  value === NO_PROJECT_VALUE ? null : value;
                                setPendingProjectId(nextProjectId);
                                syncPendingProjectToUrl(nextProjectId);
                              }}
                            >
                              <DropdownMenuRadioItem
                                value={NO_PROJECT_VALUE}
                                hideIndicator
                                className="rounded-xl px-3 py-2.5"
                              >
                                <span className="block truncate">
                                  {t("homePage.projectNoProject")}
                                </span>
                              </DropdownMenuRadioItem>
                              {projectOptions.length > 0 ? (
                                projectOptions.map((project) => (
                                  <DropdownMenuRadioItem
                                    key={project.id}
                                    value={project.id}
                                    hideIndicator
                                    className="rounded-xl px-3 py-2.5"
                                  >
                                    <span className="block truncate">
                                      {project.name}
                                    </span>
                                  </DropdownMenuRadioItem>
                                ))
                              ) : (
                                  <DropdownMenuItem disabled className="rounded-xl px-3 py-2.5">
                                  {t("homePage.projectListEmpty")}
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuRadioGroup>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                    <div
                      data-tour="home-capability-guide"
                      className="mx-auto mt-4 flex w-[94%] flex-wrap items-center justify-center gap-2"
                    >
                      {HOME_PRIMARY_CAPABILITY_GUIDE_ITEMS.map((item) => {
                        const Icon = item.icon;
                        const active = selectedCapabilityId === item.id;
                        return (
                          <Button
                            key={item.id}
                            type="button"
                            variant="outline"
                            onClick={() => startScenarioTour(item)}
                            className={
                              active
                                ? "h-10 gap-2 rounded-full border-[var(--brand-link)] bg-[var(--brand-soft)] px-4 text-sm font-medium text-[var(--brand-link)] shadow-sm"
                                : "h-10 gap-2 rounded-full border-border/70 bg-background/86 px-4 text-sm font-medium text-foreground/82 shadow-sm transition-colors hover:bg-muted/55 hover:text-foreground"
                            }
                          >
                            <Icon
                              className={
                                active
                                  ? "h-4 w-4 text-[var(--brand-link)]"
                                  : "h-4 w-4 text-foreground/48"
                              }
                            />
                            {item.label}
                          </Button>
                        );
                      })}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            className="h-10 gap-2 rounded-full border-border/70 bg-background/86 px-4 text-sm font-medium text-foreground/82 shadow-sm transition-colors hover:bg-muted/55 hover:text-foreground"
                          >
                            更多
                            <ChevronDown className="h-4 w-4 text-foreground/48" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          sideOffset={8}
                          className="w-[19rem] max-w-[calc(100vw-2rem)] rounded-2xl border-border/70 p-2 shadow-xl"
                        >
                          {HOME_MORE_CAPABILITY_GUIDE_ITEMS.map((item) => {
                            const Icon = item.icon;
                            return (
                              <DropdownMenuItem
                                key={item.id}
                                onSelect={() => startScenarioTour(item)}
                                className="gap-3 rounded-xl px-3 py-2.5"
                              >
                                <Icon className="h-4 w-4 shrink-0 text-foreground/48" />
                                <div className="min-w-0">
                                  <div className="text-sm font-medium text-foreground">
                                    {item.label}
                                  </div>
                                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                                    {item.description}
                                  </div>
                                </div>
                              </DropdownMenuItem>
                            );
                          })}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    {selectedCapability ? (
                      <div className="mx-auto mt-3 w-[94%] space-y-3">
                        {selectedCapabilityCategories.length > 0 ? (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-sm font-semibold text-foreground">
                                您想构建什么？
                              </div>
                              {selectedCapability.id === "website" ? (
                                <div className="flex items-center gap-2">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={injectWebsiteReference}
                                    className="h-8 gap-1.5 rounded-full px-2.5 text-xs text-muted-foreground hover:text-foreground"
                                  >
                                    <Link className="h-3.5 w-3.5" />
                                    添加网站参考
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={injectFigmaReference}
                                    className="h-8 gap-1.5 rounded-full px-2.5 text-xs text-muted-foreground hover:text-foreground"
                                  >
                                    <Figma className="h-3.5 w-3.5" />
                                    从 Figma 导入
                                  </Button>
                                </div>
                              ) : null}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {selectedCapabilityCategories.map((category) => {
                                const active = selectedCapabilityCategory === category;
                                const categoryLabel =
                                  category === "landing"
                                    ? "着陆页"
                                    : category === "dashboard"
                                      ? "仪表盘"
                                        : category;
                                return (
                                  <Button
                                    key={category}
                                    type="button"
                                    variant="outline"
                                    onClick={() => setSelectedCapabilityCategory(category)}
                                    className={
                                      active
                                        ? "h-10 rounded-2xl border-[var(--brand-link)] bg-[var(--brand-soft)] px-4 text-sm font-medium text-[var(--brand-link)]"
                                        : "h-10 rounded-2xl border-border/70 bg-background px-4 text-sm font-medium text-foreground/82"
                                    }
                                  >
                                    {categoryLabel}
                                  </Button>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}
                        <div data-tour="capability-examples" className="space-y-1.5">
                          <div className="text-sm font-semibold text-foreground">
                            {selectedCapabilityCategories.length > 0
                              ? "探索想法"
                              : "示例提示词"}
                          </div>
                          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                            {visibleCapabilityExamples.map((example) => {
                              const active =
                                selectedCapabilityExampleId === example.id;
                              return (
                                <button
                                  key={example.id}
                                  type="button"
                                  onClick={() =>
                                    handleCapabilityExampleSelect(
                                      selectedCapability,
                                      example,
                                    )
                                  }
                                  className={
                                    active
                                      ? "group flex min-h-[62px] flex-col justify-between rounded-2xl border border-[var(--brand-link)] bg-[var(--brand-soft)] px-3.5 py-2.5 text-left transition-colors"
                                      : "group flex min-h-[62px] flex-col justify-between rounded-2xl border border-border/70 bg-background px-3.5 py-2.5 text-left transition-colors hover:border-border hover:bg-muted/25"
                                  }
                                >
                                  <div className="text-[15px] font-medium leading-5 text-foreground">
                                    {example.title}
                                  </div>
                                  <div className="flex items-center justify-end text-foreground/28 transition-transform group-hover:translate-x-0.5">
                                    <ChevronRight className="h-3.5 w-3.5" />
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
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
                previewMaximized ? (
                  <div className="flex h-full min-h-0 flex-1 overflow-hidden">
                      <div className="h-full min-h-0 w-full">
                        {previewPanel}
                      </div>
                  </div>
                ) : (
                  <ResizablePanelGroup
                    direction="horizontal"
                    autoSaveId="task-creation-chat-layout"
                    className="h-full min-h-0"
                    onLayout={(sizes) => {
                      if (sizes.length >= 2) {
                        setDesktopPreviewLayout([sizes[0] || 0, sizes[1] || 0]);
                      }
                    }}
                  >
                      <ResizablePanel
                        defaultSize={chatPanelDefaultSize}
                        minSize={chatPanelMinSize}
                      >
                      <div className="h-full min-h-0 pr-2">{chatPanel}</div>
                    </ResizablePanel>
                    <ResizableHandle
                      withHandle
                      className="bg-transparent after:bg-transparent"
                      onDragging={handlePreviewResizeDragging}
                    />
                    <ResizablePanel
                      defaultSize={previewPanelDefaultSize}
                      minSize={previewPanelMinSize}
                      maxSize={previewPanelMaxSize}
                    >
                        <div className="h-full min-h-0 pl-2">
                          {previewPanel}
                        </div>
                    </ResizablePanel>
                  </ResizablePanelGroup>
                )
              ) : (
                <div className="flex h-full min-h-0 flex-1 flex-col gap-4 overflow-hidden">
                  {!previewMaximized ? (
                    <div className="flex-1 min-h-0">{chatPanel}</div>
                  ) : null}
                  {showMobilePreview ? (
                    <div
                      className={
                        previewMaximized
                          ? "flex-1 min-h-0"
                          : "h-[min(45vh,32rem)] min-h-[280px] shrink-0"
                      }
                    >
                      {previewPanel}
                    </div>
                  ) : null}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {!managedAltusMode && activeAltusReplay && sessionId ? (
        <AltusRunReplayDrawer
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          sessionId={sessionId}
          runId={activeAltusReplay.runId}
          runTitle={t("homeWorkspace.altusActions")}
          actions={activeAltusReplay.actions}
          files={activeAltusReplay.files}
          currentIndex={activeAltusReplayIndex}
          latestIndex={Math.max(0, activeAltusReplay.actions.length - 1)}
          activeView={altusReplayView}
          onActiveViewChange={setAltusReplayView}
          onSelectIndex={setAltusReplayIndex}
          onJumpToLatest={() =>
            setAltusReplayIndex(
              Math.max(0, activeAltusReplay.actions.length - 1),
            )
          }
          diffItems={diffItems}
          runtimeReady={runtime.ready}
          runtimeStarting={runtime.starting}
          onEnsureRuntime={runtime.ensure}
          runtimeSwitchBlocked={managedRunActive}
          onRequestStartDebugByMessage={() => {
            void submitPrompt(t("homeWorkspace.startDebugPrompt"));
          }}
          onRequestDeployByMessage={() => {
            void submitDeploymentPrompt("deploy");
          }}
          onRequestRedeployByMessage={() => {
            void submitDeploymentPrompt("redeploy");
          }}
          onRequestRollbackByMessage={() => {
            void submitDeploymentPrompt("rollback");
          }}
        />
      ) : null}
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

type StructuredClarificationOption = {
  id: string;
  label: string;
  description?: string;
  impact?: string;
  recommended?: boolean;
};

type StructuredClarificationCard = {
  id: string;
  title: string;
  question: string;
  why?: string;
  selectionMode: "single" | "multiple";
  required?: boolean;
  options: StructuredClarificationOption[];
  allowOther?: boolean;
  allowNote?: boolean;
  notePlaceholder?: string;
};

type StructuredClarificationCardPlan = {
  kind: "structured_clarification";
  taskType: "ppt" | "report" | "website" | "generic";
  title: string;
  summary?: string;
  maxCards: 4;
  cards: StructuredClarificationCard[];
  briefFields?: string[];
};

export type ChatItem =
  | {
      kind: "user";
      text: string;
      skills?: TaskCreationPlatformSkill[];
      attachments?: UploadedTaskAttachment[];
      mcpReferences?: TaskCreationMcpReference[];
      messageKey?: string;
    }
  | {
      kind: "agent";
      markdown: string;
      author?: string;
      messageKey?: string;
      showAuthor?: boolean;
    }
  | {
      kind: "clarification_notice";
      text: string;
      messageKey?: string;
    }
  | {
      kind: "structured_clarification";
      question: string;
      plan: StructuredClarificationCardPlan;
      messageKey?: string;
    }
  | {
      kind: "agent_explanation";
      markdown: string;
      heading: string;
      collapsedMarkdown?: string;
      author?: string;
      messageKey?: string;
      active?: boolean;
      showAuthor?: boolean;
    }
  | {
      kind: "agent_plain";
      text: string;
      author?: string;
      messageKey?: string;
      showAuthor?: boolean;
    }
  | {
      kind: "managed_status";
      text: string;
      messageKey?: string;
      displayInTimeline?: boolean;
    }
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
      kind: "managed_tool";
      runId: string;
      toolCallId: string;
      eventType: string;
      toolName: string;
      status: "running" | "completed" | "failed" | "unknown";
      summary?: string;
      detail?: string;
      artifactPaths?: string[];
      metadata?: Record<string, unknown>;
      messageKey?: string;
    }
  | {
      kind: "managed_activity_group";
      title: string;
      messageKey?: string;
      defaultExpanded?: boolean;
      items: Array<
        | {
            kind: "managed_status";
            text: string;
            messageKey?: string;
            displayInTimeline?: boolean;
          }
        | {
            kind: "managed_tool";
            runId: string;
            toolCallId: string;
            eventType: string;
            toolName: string;
            status: "running" | "completed" | "failed" | "unknown";
            summary?: string;
            detail?: string;
            artifactPaths?: string[];
            metadata?: Record<string, unknown>;
            messageKey?: string;
          }
      >;
    }
  | {
      kind: "managed_artifact_card";
      sessionId: string;
      runId: string;
      artifacts: AltusArtifactFile[];
      previewSnapshot?: TaskCreationWebsitePreviewSnapshot | null;
      browserScreenshotFallback?: {
        toolCallId: string;
        screenshot: NonNullable<AltusReplayAction["browserScreenshot"]>;
      } | null;
      messageKey?: string;
    }
  | {
      kind: "managed_deliverable_card";
      sessionId: string;
      runId: string;
      deliverables: TaskCreationDeliverableArtifact[];
      messageKey?: string;
    }
  | {
      kind: "opencode_turn";
      userText: string;
      skills?: TaskCreationPlatformSkill[];
      attachments?: UploadedTaskAttachment[];
      mcpReferences?: TaskCreationMcpReference[];
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

type ProgressStatusDefinition = {
  patterns: string[];
  tone: CapsuleTone;
  loading: boolean;
};

type FallbackLabelDefinition = {
  pattern: string;
  tone: CapsuleTone;
};

const PROGRESS_STATUS_DEFINITIONS: ProgressStatusDefinition[] = [
  {
    patterns: ["构思阶段", "Ideation stage"],
    tone: "system",
    loading: true,
  },
  {
    patterns: ["分析阶段", "Analysis stage"],
    tone: "intent",
    loading: true,
  },
  {
    patterns: ["开发阶段", "Development stage"],
    tone: "execution",
    loading: true,
  },
  {
    patterns: ["测试阶段", "Testing stage"],
    tone: "review",
    loading: true,
  },
  {
    patterns: ["修复阶段", "Fix stage"],
    tone: "execution",
    loading: true,
  },
  {
    patterns: ["交付阶段", "Delivery stage"],
    tone: "planning",
    loading: true,
  },
  {
    patterns: ["正在分析您的任务需求", "Analyzing your task requirements"],
    tone: "intent",
    loading: true,
  },
  {
    patterns: [
      "正在分析您的任务需求...",
      "Analyzing your task requirements...",
    ],
    tone: "intent",
    loading: true,
  },
  {
    patterns: ["已识别任务类型", "Task type identified"],
    tone: "intent",
    loading: false,
  },
  {
    patterns: ["正在规划任务详情", "Planning task details"],
    tone: "planning",
    loading: true,
  },
  {
    patterns: ["正在规划任务详情...", "Planning task details..."],
    tone: "planning",
    loading: true,
  },
  {
    patterns: ["任务规划完成", "Task planning completed"],
    tone: "planning",
    loading: false,
  },
  {
    patterns: ["任务规划完成：", "Task planning completed:"],
    tone: "planning",
    loading: false,
  },
  {
    patterns: ["正在生成执行计划", "Generating execution plan"],
    tone: "planning",
    loading: true,
  },
  {
    patterns: ["正在生成执行计划...", "Generating execution plan..."],
    tone: "planning",
    loading: true,
  },
  {
    patterns: ["执行计划已生成", "Execution plan generated"],
    tone: "planning",
    loading: false,
  },
  {
    patterns: ["正在启动执行环境", "Starting execution environment"],
    tone: "execution",
    loading: true,
  },
  {
    patterns: ["执行环境已就绪", "Execution environment ready"],
    tone: "execution",
    loading: false,
  },
];

const CAPSULE_FALLBACK_LABELS: FallbackLabelDefinition[] = [
  {
    pattern: "意图识别",
    tone: "intent",
  },
  {
    pattern: "任务规划",
    tone: "planning",
  },
  {
    pattern: "执行计划",
    tone: "planning",
  },
  {
    pattern: "系统",
    tone: "system",
  },
  {
    pattern: "错误",
    tone: "error",
  },
];

function findProgressStatusDefinition(
  label: string,
): ProgressStatusDefinition | null {
  const text = label.trim();
  if (!text) return null;
  return (
    PROGRESS_STATUS_DEFINITIONS.find((definition) =>
      definition.patterns.some((pattern) => text.includes(pattern)),
    ) || null
  );
}

function findFallbackCapsuleLabel(
  label: string,
): FallbackLabelDefinition | null {
  const text = label.trim();
  if (!text) return null;
  return (
    CAPSULE_FALLBACK_LABELS.find((definition) =>
      text.startsWith(definition.pattern),
    ) || null
  );
}

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
  const normalizeClarificationComparableText = (value: string): string =>
    value
      .replace(/\r\n/g, "\n")
      .replace(/\*\*需要补充信息\*\*/g, "")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  const buildClarificationSemanticKey = (value: string): string =>
    normalizeClarificationComparableText(value).replace(/\s+/g, "");
  const userTextSet = new Set<string>();
  const finalizedPartIds = new Set<string>();
  const codexTurnFilePaths = new Map<string, string[]>();
  const lastCodexDiffIndexByTurn = new Map<string, number>();
  const managedArtifactsByRun = new Map<string, AltusArtifactFile[]>();
  const managedBrowserScreenshotsByRun = new Map<
    string,
    Array<{
      toolCallId: string;
      screenshot: NonNullable<AltusReplayAction["browserScreenshot"]>;
    }>
  >();
  const emittedManagedCompletionRuns = new Set<string>();
  let managedStatusBuffer: {
    text: string;
    messageKey?: string;
    displayInTimeline: boolean;
  } | null = null;

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

  const mergeCodexTurnFilePath = (turnId: string, path: string) => {
    const normalizedTurnId = turnId.trim();
    const normalizedPath = path.trim();
    if (!normalizedTurnId || !normalizedPath) return;
    const existing = codexTurnFilePaths.get(normalizedTurnId) || [];
    if (existing.includes(normalizedPath)) return;
    codexTurnFilePaths.set(normalizedTurnId, [...existing, normalizedPath]);
  };

  const mergeManagedArtifact = (runId: string, artifact: AltusArtifactFile) => {
    const normalizedRunId = runId.trim();
    const normalizedPath = artifact.path.trim().replace(/\\/g, "/");
    if (!normalizedRunId || !normalizedPath) return;
    const existing = managedArtifactsByRun.get(normalizedRunId) || [];
    if (existing.some((item) => item.path === normalizedPath)) return;
    managedArtifactsByRun.set(normalizedRunId, [
      ...existing,
      {
        path: normalizedPath,
        previewType: inferManagedArtifactPreviewType(normalizedPath),
      },
    ]);
  };

  const mergeManagedBrowserScreenshot = (
    runId: string,
    toolCallId: string,
    screenshot: AltusReplayAction["browserScreenshot"],
  ) => {
    const normalizedRunId = runId.trim();
    const normalizedToolCallId = toolCallId.trim();
    if (!normalizedRunId || !normalizedToolCallId || !isPassedManagedBrowserScreenshot(screenshot)) {
      return;
    }
    const existing = managedBrowserScreenshotsByRun.get(normalizedRunId) || [];
    if (existing.some((item) => item.toolCallId === normalizedToolCallId)) return;
    managedBrowserScreenshotsByRun.set(normalizedRunId, [
      ...existing,
      {
        toolCallId: normalizedToolCallId,
        screenshot: screenshot as NonNullable<AltusReplayAction["browserScreenshot"]>,
      },
    ]);
  };

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.type !== "executor_event") continue;
    const metadata = toRecord(message.metadata);
    if (isManagedExecutionEvent(metadata)) {
      mergeManagedBrowserScreenshot(
        asText(metadata.runId),
        asText(metadata.toolCallId) || message.messageKey || "",
        readManagedBrowserScreenshot(metadata),
      );
    }
    const event = toRecord(metadata.event);
    const item = toRecord(event.item);
    const eventType = asText(metadata.eventType).toLowerCase();
    const itemType =
      asText(metadata.itemType).toLowerCase() ||
      asText(item.type).toLowerCase();
    const turnId = asText(metadata.turnId);

    if (eventType === "turn/diff/updated" && turnId) {
      lastCodexDiffIndexByTurn.set(turnId, index);
    }

    if (itemType === "file_change" || itemType === "filechange") {
      const fileChanges = extractCodexFileChanges(metadata, item);
      for (const change of fileChanges) {
        if (turnId && change.path) {
          mergeCodexTurnFilePath(turnId, change.path);
        }
      }
      const filePaths = Array.isArray(metadata.filePaths)
        ? metadata.filePaths.map((value) => asText(value)).filter(Boolean)
        : [];
      for (const path of filePaths) {
        if (turnId && path) {
          mergeCodexTurnFilePath(turnId, path);
        }
      }
    }
  }

  const pushUser = (
    text: string,
    skills?: TaskCreationPlatformSkill[],
    attachments?: UploadedTaskAttachment[],
    mcpReferences?: TaskCreationMcpReference[],
    messageKey?: string,
  ) => {
    const normalized = normalizeForDedup(text);
    if (
      !normalized &&
      (!skills || skills.length === 0) &&
      (!attachments || attachments.length === 0) &&
      (!mcpReferences || mcpReferences.length === 0)
    ) {
      return;
    }
    const last = items[items.length - 1];
    if (messageKey && last?.messageKey === messageKey) {
      return;
    }
    if (
      last?.kind === "user" &&
      normalizeForDedup(last.text) === normalized &&
      JSON.stringify(last.skills || []) === JSON.stringify(skills || []) &&
      JSON.stringify(last.attachments || []) ===
        JSON.stringify(attachments || []) &&
      JSON.stringify(last.mcpReferences || []) ===
        JSON.stringify(mcpReferences || [])
    ) {
      return;
    }
    items.push({
      kind: "user",
      text,
      skills,
      attachments,
      mcpReferences,
      messageKey,
    });
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

  const extractCodexExplanationHeading = (markdown: string) => {
    const headingFromMarkdown = extractThinkingHeading(markdown);
    if (headingFromMarkdown) return headingFromMarkdown;
    const strongHeading = markdown.match(/^\s*\*\*([^*\n]+)\*\*/m);
    if (strongHeading?.[1]) {
      const value = cleanHeadingText(strongHeading[1]);
      if (value) return value;
    }
    const firstLine = markdown
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => cleanHeadingText(line))
      .find(Boolean);
    return firstLine || i18n.t("homeWorkspace.thinking");
  };

  const extractCodexPlanCollapsedMarkdown = (markdown: string) => {
    const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
    const todoLines = lines
      .map((line) => line.trimEnd())
      .filter((line) => /^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line));
    if (todoLines.length === 0) return undefined;
    return todoLines.join("\n");
  };

  const pushCodexExplanation = (
    markdown: string,
    messageKey?: string,
    author?: string,
    options?: {
      collapsedMarkdown?: string;
    },
  ) => {
    const normalized = normalizeForDedup(markdown);
    if (!normalized) return;
    const heading = extractCodexExplanationHeading(markdown);
    const last = items[items.length - 1];
    if (messageKey && last?.messageKey === messageKey) {
      return;
    }
    if (
      last?.kind === "agent_explanation" &&
      normalizeForDedup(last.markdown) === normalized &&
      (last.author || "") === (author || "")
    ) {
      return;
    }
    items.push({
      kind: "agent_explanation",
      markdown,
      heading,
      collapsedMarkdown: options?.collapsedMarkdown,
      author,
      messageKey,
      active: false,
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

  const flushManagedStatus = (options?: {
    displayInTimeline?: boolean;
    skipHidden?: boolean;
  }) => {
    if (!managedStatusBuffer) return;
    const displayInTimeline =
      options?.displayInTimeline ?? managedStatusBuffer.displayInTimeline;
    if (options?.skipHidden && !displayInTimeline) {
      managedStatusBuffer = null;
      return;
    }
    items.push({
      kind: "managed_status",
      text: managedStatusBuffer.text,
      messageKey: managedStatusBuffer.messageKey,
      displayInTimeline,
    });
    managedStatusBuffer = null;
  };

  const clearManagedStatus = () => {
    managedStatusBuffer = null;
  };

  const replaceManagedStatus = (
    text: string,
    messageKey?: string,
    options?: { displayInTimeline?: boolean },
  ) => {
    const normalized = normalizeForDedup(text);
    if (!normalized) return;
    managedStatusBuffer = {
      text,
      messageKey,
      displayInTimeline: options?.displayInTimeline ?? true,
    };
  };

  const pushProgress = (
    rawLabel: string,
    displayLabel: string,
    tone: CapsuleTone,
    messageKey?: string,
  ) => {
    progressBuffer = {
      label: displayLabel,
      tone,
      loading: isProgressLoadingLabel(rawLabel),
      messageKey,
    };
  };

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.type === "user_input" || message.type === "user_response") {
      if (isHiddenMcpConfirmationUserMessage(message)) {
        continue;
      }
      clearManagedStatus();
      flushProgress();
      const resolvedUser = resolveUserMessageReferences({
        content: message.content || "",
        metadata: message.metadata,
      });
      pushUser(
        resolvedUser.text,
        resolvedUser.skills,
        resolvedUser.attachments,
        resolvedUser.mcpReferences,
        message.messageKey,
      );
      continue;
    }

    if (message.type === "agent_message") {
      const managedCompletionCard = buildManagedCompletionCardItem({
        message,
        managedArtifactsByRun,
        emittedManagedCompletionRuns,
        browserScreenshotsByRun: managedBrowserScreenshotsByRun,
      });
      if (managedCompletionCard) {
        clearManagedStatus();
        flushProgress();
        items.push(managedCompletionCard);
      }

      const parsed = extractCapsule(message.content || "");
      if (parsed) {
        if (isProgressStatusLabel(parsed.label) && !parsed.rest.trim()) {
          clearManagedStatus();
          pushProgress(
            parsed.label,
            parsed.label,
            getCapsuleTone(parsed.label),
            message.messageKey,
          );
          continue;
        }
        clearManagedStatus();
        flushProgress();
        items.push({
          kind: "capsule",
          label: parsed.label,
          tone: getCapsuleTone(parsed.label),
          messageKey: message.messageKey,
        });
        if (parsed.rest.trim()) {
          const displayName = resolveAgentDisplayName({
            agent: message.agent,
            metadata: message.metadata,
            messageKey: message.messageKey,
          });
          pushAgentMarkdown(
            displayName === "Altus"
              ? parsed.rest
              : `**${displayName}**\n\n${parsed.rest}`,
            message.messageKey,
            displayName === "Altus" ? displayName : undefined,
          );
        }
        continue;
      }

      flushProgress();
      clearManagedStatus();
      const displayName = resolveAgentDisplayName({
        agent: message.agent,
        metadata: message.metadata,
        messageKey: message.messageKey,
      });
      pushAgentMarkdown(
        displayName === "Altus"
          ? message.content || ""
          : `**${displayName}**\n\n${message.content || ""}`,
        message.messageKey,
        displayName === "Altus" ? displayName : undefined,
      );
      continue;
    }

    if (message.type === "status_update") {
      const metadata = toRecord(message.metadata);
      const managedCompletionCard = buildManagedCompletionCardItem({
        message,
        managedArtifactsByRun,
        emittedManagedCompletionRuns,
        browserScreenshotsByRun: managedBrowserScreenshotsByRun,
      });
      const pushManagedCompletionCard = () => {
        if (!managedCompletionCard) return;
        clearManagedStatus();
        flushProgress();
        items.push(managedCompletionCard);
      };
      const rawLabel = message.content || "状态更新";
      if (isCodexControlStatusLabel(rawLabel)) {
        pushManagedCompletionCard();
        continue;
      }

      if (isManagedStartingStatusMessage(message)) {
        flushProgress();
        replaceManagedStatus(rawLabel, message.messageKey, {
          displayInTimeline: false,
        });
        pushManagedCompletionCard();
        continue;
      }

      if (isManagedNarrationStatusMessage(message)) {
        flushProgress();
        replaceManagedStatus(rawLabel, message.messageKey);
        pushManagedCompletionCard();
        continue;
      }
      const tone = message.tone || getCapsuleTone(rawLabel);
      if (isProgressStatusLabel(rawLabel)) {
        clearManagedStatus();
        pushProgress(rawLabel, rawLabel, tone, message.messageKey);
      } else {
        clearManagedStatus();
        flushProgress();
        items.push({
          kind: "capsule",
          label: rawLabel,
          tone,
          messageKey: message.messageKey,
        });
      }
      pushManagedCompletionCard();
      continue;
    }

    if (message.type === "executor_event") {
      const metadata = toRecord(message.metadata);
      if (isManagedExecutionEvent(metadata)) {
        const managedEventType = asText(metadata.eventType).toLowerCase();
        const managedToolName = asText(metadata.toolName) || "tool";
        const managedRunId = asText(metadata.runId);
        const managedToolCallId =
          asText(metadata.toolCallId) ||
          message.messageKey ||
          `${managedRunId}:${managedToolName}:${index}`;
        const artifactPath = extractManagedArtifactPath(
          managedToolName,
          metadata,
        );
        const internalSupportArtifact = isManagedInternalSupportArtifact(
          artifactPath,
        );
        if (
          managedEventType === "tool_call_completed" &&
          managedRunId &&
          artifactPath &&
          !internalSupportArtifact
        ) {
          mergeManagedArtifact(managedRunId, {
            path: artifactPath,
            previewType: inferManagedArtifactPreviewType(artifactPath),
          });
        }
        if (
          managedEventType === "tool_call_started" ||
          managedEventType === "tool_call_progress" ||
          managedEventType === "tool_call_completed" ||
          managedEventType === "tool_call_failed"
        ) {
          if (
            internalSupportArtifact &&
            (managedToolName === "write_file" || managedToolName === "read_file")
          ) {
            continue;
          }
          flushManagedStatus({ skipHidden: true });
          flushProgress();
          items.push({
            kind: "managed_tool",
            runId: managedRunId,
            toolCallId: managedToolCallId,
            eventType: managedEventType,
            toolName: managedToolName,
            status:
              managedEventType === "tool_call_failed"
                ? "failed"
                : managedEventType === "tool_call_completed"
                  ? "completed"
                  : "running",
            summary: formatManagedToolSummary(managedToolName, metadata),
            detail: formatManagedToolDetail(managedToolName, metadata),
            artifactPaths: collectManagedReplayArtifactPaths(
              managedToolName,
              metadata,
            ),
            metadata,
            messageKey: message.messageKey,
          });
          continue;
        }
        if (managedEventType === "artifact_updated") {
          clearManagedStatus();
          flushProgress();
          items.push({
            kind: "capsule",
            label:
              asText(metadata.content) ||
              i18n.t("homeWorkspace.artifactUpdated"),
            tone: "review",
            messageKey: message.messageKey,
          });
          continue;
        }
      }
      const event = toRecord(metadata.event);
      const item = toRecord(event.item);
      const executorLabel = getExecutorDisplayName(metadata);
      const eventType = asText(metadata.eventType).toLowerCase();
      const itemType =
        asText(metadata.itemType).toLowerCase() ||
        asText(item.type).toLowerCase();
      const turnId = asText(metadata.turnId);
      const content =
        asText(item.text) ||
        asText(item.content) ||
        asText(item.message) ||
        (message.content || "").trim();

      if (eventType === "turn.started") {
        clearManagedStatus();
        const progressLabel = `${executorLabel} ${i18n.t("homeWorkspace.executionStarted")}`;
        pushProgress(
          progressLabel,
          progressLabel,
          "execution",
          message.messageKey,
        );
        continue;
      }

      if (eventType === "turn.completed") {
        const turnStatus = asText(metadata.turnStatus).toLowerCase();
        const errorMessage = asText(metadata.errorMessage) || content;
        if (message.stage === "failed" || turnStatus === "failed") {
          clearManagedStatus();
          flushProgress();
          items.push({
            kind: "capsule",
            label:
              errorMessage ||
              `${executorLabel} ${i18n.t("homeWorkspace.executionFailed")}`,
            tone: "error",
            messageKey: message.messageKey,
          });
          continue;
        }
        clearManagedStatus();
        flushProgress();
        items.push({
          kind: "capsule",
          label: `${executorLabel} ${i18n.t("homeWorkspace.executionCompleted")}`,
          tone: "execution",
          messageKey: message.messageKey,
        });
        continue;
      }

      if (eventType === "turn.failed" || eventType === "turn.interrupted") {
        clearManagedStatus();
        flushProgress();
        items.push({
          kind: "capsule",
          label:
            content ||
            (eventType === "turn.interrupted"
              ? `${executorLabel} ${i18n.t("homeWorkspace.executionInterrupted")}`
              : `${executorLabel} ${i18n.t("homeWorkspace.executionFailed")}`),
          tone: "error",
          messageKey: message.messageKey,
        });
        continue;
      }

      if (eventType === "turn/plan/updated") {
        if (!content) {
          continue;
        }
        clearManagedStatus();
        pushCodexExplanation(content, message.messageKey, executorLabel, {
          collapsedMarkdown: extractCodexPlanCollapsedMarkdown(content),
        });
        continue;
      }

      if (eventType === "stderr.line" || eventType === "stdout.line") {
        continue;
      }

      if (eventType === "item/filechange/outputdelta") {
        continue;
      }

      flushProgress();
      clearManagedStatus();
      if (itemType === "command_execution" || itemType === "commandexecution") {
        const commandText =
          asText(metadata.command) ||
          asText(item.command) ||
          i18n.t("homeWorkspace.shellCommand");
        const commandCard = getCodexCommandCardCopy(commandText);
        const targetPath =
          asText(metadata.targetPath) ||
          extractCodexCommandTargetPath(commandText);
        const outputPreview =
          asText(metadata.outputPreview) || asText(item.aggregated_output);
        const exitCodeValue =
          metadata.exitCode ?? item.exit_code ?? item.exitCode;
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

      if (eventType === "turn/diff/updated") {
        if (turnId && lastCodexDiffIndexByTurn.get(turnId) !== index) {
          continue;
        }
        const fileChanges = extractCodexFileChanges(metadata, item);
        const filePaths = Array.isArray(metadata.filePaths)
          ? metadata.filePaths.map((value) => asText(value)).filter(Boolean)
          : [];
        const turnPaths = turnId ? codexTurnFilePaths.get(turnId) || [] : [];
        const effectivePaths = filePaths.length > 0 ? filePaths : turnPaths;
        const effectiveFiles =
          fileChanges.length > 0
            ? fileChanges
            : effectivePaths.map((path) => ({ kind: "update", path }));
        const primaryPath = fileChanges[0]?.path || effectivePaths[0] || "";
        const fileCount = Math.max(fileChanges.length, effectivePaths.length);

        items.push({
          kind: "opencode_tool",
          eventType: "file.changed",
          event: {
            type: "file.changed",
            properties: {
              file: primaryPath,
              path: primaryPath,
              label: i18n.t("homeWorkspace.changeDiff"),
              files: effectiveFiles,
              diff: asText(metadata.diff) || undefined,
              status: "completed",
            },
          },
          content:
            fileCount > 1
              ? `${i18n.t("homeWorkspace.changeDiff")} · ${fileCount} ${i18n.t("homeWorkspace.filesUnit")}`
              : primaryPath
                ? `${i18n.t("homeWorkspace.changeDiff")} · ${getFilename(primaryPath)}`
                : i18n.t("homeWorkspace.changeDiff"),
          metadata: {
            ...metadata,
            eventType: "file.changed",
            event: {
              type: "file.changed",
              properties: {
                file: primaryPath,
                path: primaryPath,
                label: i18n.t("homeWorkspace.changeDiff"),
                files: effectiveFiles,
                diff: asText(metadata.diff) || undefined,
                status: "completed",
              },
            },
          },
          messageIndex: index,
          messageKey: message.messageKey,
        });
        continue;
      }

      if (itemType === "file_change" || itemType === "filechange") {
        const fileChanges = extractCodexFileChanges(metadata, item);
        if (fileChanges.length === 0) {
          continue;
        }
        const primary = fileChanges[0];
        const primaryPath = primary?.path || "";
        const primaryLabel = mapCodexFileChangeLabel(primary?.kind || "");
        const contentLabel =
          fileChanges.length > 1
            ? `${primaryLabel} · ${fileChanges.length} ${i18n.t("homeWorkspace.filesUnit")}`
            : `${primaryLabel} · ${getFilename(primaryPath) || i18n.t("homeWorkspace.file")}`;

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

      if (itemType === "approval_request" || itemType === "approvalrequest") {
        const approvalText =
          asText(metadata.approvalText) ||
          content ||
          `${executorLabel} ${i18n.t("homeWorkspace.authorizationNeededMessage")}`;
        items.push({
          kind: "capsule",
          label: i18n.t("homeWorkspace.authorizationNeeded"),
          tone: "system",
          messageKey: message.messageKey,
        });
        pushAgentMarkdown(approvalText, message.messageKey, executorLabel);
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
                label: i18n.t("homeWorkspace.changeDraft"),
                files: fileChanges,
                status:
                  asText(metadata.itemStatus) ||
                  asText(item.status) ||
                  "completed",
              },
            },
            content: primary?.path
              ? `${i18n.t("homeWorkspace.changeDraft")} · ${getFilename(primary.path)}`
              : i18n.t("homeWorkspace.changeDraft"),
            metadata: {
              ...metadata,
              eventType: "file.changed",
              event: {
                type: "file.changed",
                properties: {
                  file: primary?.path || "",
                  path: primary?.path || "",
                  label: i18n.t("homeWorkspace.changeDraft"),
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
        itemType === "agentmessage" ||
        isLikelyMarkdownText(content)
      ) {
        if (itemType === "reasoning") {
          pushCodexExplanation(content, message.messageKey, executorLabel);
        } else {
          pushAgentMarkdown(content, message.messageKey, executorLabel);
        }
      } else {
        pushAgentPlain(content, executorLabel, message.messageKey);
      }
      continue;
    }

    if (message.type === "opencode_event") {
      flushProgress();
      clearManagedStatus();
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
      clearManagedStatus();
      flushProgress();
      pushAgentMarkdown(
        `**${i18n.t("homeWorkspace.errorTitle")}**\n\n> ${message.message || i18n.t("homeWorkspace.requestFailedRetry")}`,
        message.messageKey,
      );
      continue;
    }

    if (message.type === "clarification_request") {
      clearManagedStatus();
      flushProgress();
      const question =
        message.question || i18n.t("homeWorkspace.provideMoreInfo");
      const structuredClarification = readStructuredClarificationPlan(
        message.metadata,
      );
      if (structuredClarification) {
        items.push({
          kind: "structured_clarification",
          question,
          plan: structuredClarification,
          messageKey: message.messageKey,
        });
        continue;
      }
      const previousMessage = index > 0 ? messages[index - 1] : null;
      const previousContent =
        previousMessage?.type === "agent_message"
          ? previousMessage.content || ""
          : "";
      const currentNormalized = normalizeClarificationComparableText(question);
      const previousNormalized =
        previousMessage?.type === "agent_message"
          ? normalizeClarificationComparableText(previousContent)
          : "";
      const currentSemantic = buildClarificationSemanticKey(question);
      const previousSemantic =
        previousMessage?.type === "agent_message"
          ? buildClarificationSemanticKey(previousContent)
          : "";
      const currentRunId = asText(toRecord(message.metadata).runId);
      const previousRunId =
        previousMessage?.type === "agent_message"
          ? asText(toRecord(previousMessage.metadata).runId)
          : "";
      const isSameRun =
        !currentRunId || !previousRunId || currentRunId === previousRunId;
      if (
        previousMessage?.type === "agent_message" &&
        isSameRun &&
        (currentNormalized === previousNormalized ||
          (!!currentSemantic &&
            !!previousSemantic &&
            currentSemantic === previousSemantic))
      ) {
        items.push({
          kind: "clarification_notice",
          text: i18n.t("homeWorkspace.altusContinueAfterReply"),
          messageKey: message.messageKey,
        });
        continue;
      }
      const optionLines =
        message.options && message.options.length > 0
          ? `\n\n${message.options.map((opt) => `- ${opt}`).join("\n")}`
          : "";
      pushAgentMarkdown(
        `**${i18n.t("homeWorkspace.clarificationNeeded")}**\n\n${question}${optionLines}`,
        message.messageKey,
      );
      continue;
    }

    if (message.type === "plan_generated") {
      clearManagedStatus();
      flushProgress();
      pushAgentMarkdown(
        `**${i18n.t("homeWorkspace.planGenerated")}**\n\n${i18n.t("homeWorkspace.projectLabel")}：${message.plan?.project?.title || i18n.t("homeWorkspace.unnamedProject")}`,
        message.messageKey,
      );
    }
  }

  flushManagedStatus({ displayInTimeline: false });

  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!item || item.kind === "user") {
      continue;
    }
    if (item.kind === "agent_explanation") {
      item.active = true;
    }
    break;
  }

  flushProgress();
  return items;
}

function isAuthorNeutralSeparator(item: ChatItem): boolean {
  return (
    item.kind === "capsule" ||
    item.kind === "managed_status" ||
    item.kind === "managed_tool" ||
    item.kind === "managed_activity_group" ||
    item.kind === "managed_artifact_card" ||
    item.kind === "managed_deliverable_card"
  );
}

export function getActiveManagedStatusText(items: ChatItem[]): string {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.kind === "managed_status") {
      return item.text;
    }
  }
  return "";
}

type ManagedActivityTimelineItem = Extract<
  ChatItem,
  { kind: "managed_status" | "managed_tool" }
>;

function isManagedActivityTimelineItem(
  item: ChatItem,
): item is ManagedActivityTimelineItem {
  return item.kind === "managed_status" || item.kind === "managed_tool";
}

function getManagedActivityTitle(
  items: ManagedActivityTimelineItem[],
) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!item) continue;
    if (item.kind === "managed_status" && item.text.trim()) return item.text;
    if (item.kind === "managed_tool" && item.toolName !== "complete_task") {
      return (
        getManagedToolTimelineTitle(item.toolName, item.metadata, item.status) ||
        item.summary?.trim() ||
        getManagedToolDisplayName(item.toolName) ||
        i18n.t("homeWorkspace.toolCall")
      );
    }
  }
  return i18n.t("homeWorkspace.agentProcessing");
}

function getManagedActivityState(
  items: ManagedActivityTimelineItem[],
) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.kind !== "managed_tool") continue;
    if (item.status === "failed") return "failed";
    if (item.status === "running") return "running";
    if (item.status === "completed") return "completed";
  }
  return "completed";
}

function hasManagedTodoActivity(items: ManagedActivityTimelineItem[]) {
  return items.some(
    (item) => item.kind === "managed_tool" && item.toolName === "todowrite",
  );
}

function normalizeManagedStageTitle(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function getManagedTodoStageTitle(item: ManagedActivityTimelineItem) {
  if (item.kind !== "managed_tool" || item.toolName !== "todowrite") {
    return "";
  }
  const activeTodo = readManagedTodoItems(item.metadata).find(
    (todo) => todo.status === "in_progress",
  );
  return activeTodo
    ? normalizeManagedStageTitle(activeTodo.activeForm || activeTodo.content)
    : "";
}

export function groupManagedActivityItems(items: ChatItem[]): ChatItem[] {
  const grouped: ChatItem[] = [];
  let buffer: ManagedActivityTimelineItem[] = [];
  let bufferTitle = "";

  const flush = () => {
    if (buffer.length === 0) return;
    const groupItems = buffer;
    grouped.push({
      kind: "managed_activity_group",
      title: bufferTitle || getManagedActivityTitle(groupItems),
      messageKey: groupItems.map((item) => item.messageKey).filter(Boolean).join("|"),
      defaultExpanded: !hasManagedTodoActivity(groupItems),
      items: groupItems,
    });
    buffer = [];
    bufferTitle = "";
  };

  for (const item of items) {
    if (isManagedActivityTimelineItem(item)) {
      const todoStageTitle = getManagedTodoStageTitle(item);
      if (todoStageTitle) {
        const isSameStage =
          bufferTitle &&
          normalizeManagedStageTitle(bufferTitle) ===
            normalizeManagedStageTitle(todoStageTitle);
        if (!isSameStage) {
          flush();
          bufferTitle = todoStageTitle;
        }
      }
      buffer.push(item);
      continue;
    }
    flush();
    grouped.push(item);
  }
  flush();

  let latestTodoGroupIndex = -1;
  let latestTodoHasInProgress = false;
  grouped.forEach((item, index) => {
    if (item.kind !== "managed_activity_group") return;
    for (const entry of item.items) {
      if (entry.kind !== "managed_tool" || entry.toolName !== "todowrite") {
        continue;
      }
      latestTodoGroupIndex = index;
      latestTodoHasInProgress = readManagedTodoItems(entry.metadata).some(
        (todo) => todo.status === "in_progress",
      );
    }
  });

  if (latestTodoGroupIndex >= 0) {
    grouped.forEach((item, index) => {
      if (
        item.kind === "managed_activity_group" &&
        hasManagedTodoActivity(item.items)
      ) {
        item.defaultExpanded =
          latestTodoHasInProgress && index === latestTodoGroupIndex;
      }
    });
  }

  return grouped;
}

export function collapseRepeatedChatAuthors(items: ChatItem[]): ChatItem[] {
  const nextItems = [...items];
  let previousAuthor = "";

  for (let index = 0; index < nextItems.length; index += 1) {
    const item = nextItems[index];
    if (!item) continue;

    if (
      item.kind === "agent" ||
      item.kind === "agent_plain" ||
      item.kind === "agent_explanation"
    ) {
      const author = (item.author || "").trim();
      if (!author) {
        previousAuthor = "";
        continue;
      }
      item.showAuthor = author !== previousAuthor;
      previousAuthor = author;
      continue;
    }

    if (isAuthorNeutralSeparator(item)) {
      continue;
    }

    previousAuthor = "";
  }

  return nextItems;
}

type DirectTurnDraft = {
  userText: string;
  skills?: TaskCreationPlatformSkill[];
  attachments?: UploadedTaskAttachment[];
  mcpReferences?: TaskCreationMcpReference[];
  userMessageKey?: string;
  assistantParts: OpencodeTurnPart[];
  assistantPartIndex: Map<string, number>;
  assistantMessageIds: Set<string>;
  working: boolean;
  thinkingLabel?: string;
  messageKey?: string;
};

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
  skills?: TaskCreationPlatformSkill[],
  attachments?: UploadedTaskAttachment[],
  mcpReferences?: TaskCreationMcpReference[],
  userMessageKey?: string,
): DirectTurnDraft {
  return {
    userText,
    skills,
    attachments,
    mcpReferences,
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
  return countDirectMarkdownLines(normalized) >= 14 || normalized.length >= 600;
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
    summary: `${label} · ${lineCount} ${i18n.t("homeWorkspace.linesUnit")}`,
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
      `${language} ${i18n.t("homeWorkspace.codeLabel")}`,
      fullMatch,
      countDirectMarkdownLines(body.trimEnd()),
    );
  }
  return buildDirectMarkdownFoldSummary(
    i18n.t("homeWorkspace.codeBlock"),
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
    return buildDirectMarkdownFoldSummary(
      i18n.t("homeWorkspace.patchLabel"),
      trimmed,
    );
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

  const upsertTurnPart = (
    turn: DirectTurnDraft,
    key: string,
    part: OpencodeTurnPart,
  ) => {
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
      if (isHiddenMcpConfirmationUserMessage(message)) {
        continue;
      }
      const resolvedUser = resolveUserMessageReferences({
        content: message.content || "",
        metadata: message.metadata,
      });
      directTurns.push(
        createDirectTurnDraft(
          resolvedUser.text,
          resolvedUser.skills,
          resolvedUser.attachments,
          resolvedUser.mcpReferences,
          message.messageKey,
        ),
      );
      continue;
    }

    if (message.type === "error") {
      fallbackItems.push({
        kind: "agent",
        markdown: `**${i18n.t("homeWorkspace.errorTitle")}**\n\n> ${message.message || message.content || i18n.t("homeWorkspace.requestFailedRetry")}`,
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
      const completedAt = asText(
        toRecord(toRecord(eventInfo.properties.info).time).completed,
      );
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
      const partId =
        asText(eventInfo.part.id) || asText(metadata.partId) || "final";
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

    if (
      eventType !== "message.part.updated" &&
      eventType !== "message.part.delta"
    ) {
      continue;
    }

    const partId =
      asText(eventInfo.part.id) ||
      asText(metadata.partId) ||
      `${eventInfo.partType || "part"}-${index}`;
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
      const diffId =
        message.messageKey || `${messageId || "assistant"}:${partId}`;
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
      const toolStatus = asText(
        toRecord(eventInfo.part.state).status,
      ).toLowerCase();
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
      skills: turn.skills,
      attachments: turn.attachments,
      mcpReferences: turn.mcpReferences,
      userMessageKey: turn.userMessageKey,
      assistantParts,
      working: turn.working,
      thinkingLabel: turn.thinkingLabel,
      messageKey: turn.messageKey || turn.userMessageKey,
    });
  }

  return items.length > 0
    ? [...fallbackItems, ...items]
    : buildLegacyChatItems(messages);
}

export function buildChatItems(messages: AgentMessage[]): ChatItem[] {
  const hasOpencodeEvents = messages.some(
    (message) => message.type === "opencode_event",
  );
  if (!hasOpencodeEvents) {
    return buildLegacyChatItems(messages);
  }
  if (messages.some((message) => isManagedTimelineMessage(message))) {
    return buildLegacyChatItems(messages);
  }
  return buildDirectOpencodeChatItems(messages);
}

function isManagedTimelineMessage(message: AgentMessage): boolean {
  const metadata = toRecord(message.metadata);
  const eventType = asText(metadata.eventType).toLowerCase();
  const messageKey = asText(message.messageKey) || asText(metadata.messageKey);
  if (isManagedExecutionEvent(metadata)) {
    return true;
  }
  if (asText(message.agent).toLowerCase() === "altus") {
    return true;
  }
  if (messageKey.startsWith("managed:")) {
    return true;
  }
  return (
    eventType === "assistant_delta" ||
    eventType === "assistant_message" ||
    eventType === "run_ack" ||
    eventType === "run_status" ||
    eventType === "deliverables_ready" ||
    eventType === "run_completed" ||
    eventType === "run_failed" ||
    eventType === "run_stopped" ||
    eventType === "clarification_requested" ||
    eventType === "tool_call_started" ||
    eventType === "tool_call_progress" ||
    eventType === "tool_call_completed" ||
    eventType === "tool_call_failed" ||
    eventType === "artifact_updated"
  );
}

function isManagedNarrationStatusMessage(message: AgentMessage): boolean {
  if (message.type !== "status_update") return false;
  const metadata = toRecord(message.metadata);
  if (!isManagedExecutionEvent(metadata)) return false;
  const eventType = asText(metadata.eventType).toLowerCase();
  const status = asText(metadata.status).toLowerCase();
  const content = asText(message.content);
  return eventType === "run_status" && status !== "starting" && Boolean(content);
}

function isManagedStartingStatusMessage(message: AgentMessage): boolean {
  if (message.type !== "status_update") return false;
  const metadata = toRecord(message.metadata);
  if (!isManagedExecutionEvent(metadata)) return false;
  return (
    asText(metadata.eventType).toLowerCase() === "run_status" &&
    asText(metadata.status).toLowerCase() === "starting"
  );
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
          {open ? i18n.t("common.collapse") : i18n.t("common.expand")}
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
          <div key={`markdown-${index}`} className={bodyClassName}>
            <Streamdown>{segment.markdown}</Streamdown>
          </div>
        ),
      )}
    </div>
  );
}

function CodexExplanationMessage({
  markdown,
  heading,
  collapsedMarkdown,
  active = false,
  author = "Codex",
  showAuthor = true,
}: {
  markdown: string;
  heading: string;
  collapsedMarkdown?: string;
  active?: boolean;
  author?: string;
  showAuthor?: boolean;
}) {
  if (!active) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="w-full"
      >
        <div className="space-y-1.5 text-sm text-foreground">
          {showAuthor ? (
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              {author}
            </div>
          ) : null}
          <div className="text-sm leading-7 text-foreground">{heading}</div>
          {collapsedMarkdown ? (
            <div className="max-w-none text-sm leading-7 text-foreground [&_p]:my-1.5 [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_strong]:font-semibold">
              <Streamdown>{collapsedMarkdown}</Streamdown>
            </div>
          ) : null}
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
      <div className="space-y-1.5 text-sm text-foreground">
        {showAuthor ? (
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {author}
          </div>
        ) : null}
        <div className="relative overflow-hidden rounded-xl border border-border/70 bg-[radial-gradient(circle_at_top,_rgba(148,163,184,0.12),_transparent_58%),linear-gradient(180deg,rgba(255,255,255,0.92),rgba(248,250,252,0.94))] px-4 py-3 shadow-sm dark:bg-[radial-gradient(circle_at_top,_rgba(148,163,184,0.12),_transparent_58%),linear-gradient(180deg,rgba(24,24,27,0.96),rgba(17,17,20,0.96))]">
          <div className="absolute inset-y-3 right-3 w-px animate-pulse bg-gradient-to-b from-transparent via-muted-foreground to-transparent" />
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {heading}
          </div>
          <div className="pr-4">
            <DirectMarkdownMessage markdown={markdown} />
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function StructuredClarificationCardFlow({
  item,
  onSubmit,
}: {
  item: Extract<ChatItem, { kind: "structured_clarification" }>;
  onSubmit?: (answer: string) => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [answers, setAnswers] = useState<
    Record<string, { selected: string[]; other: string; note: string; skipped?: boolean }>
  >({});
  const cards = item.plan.cards.slice(0, 4);
  const activeCard = cards[Math.min(activeIndex, Math.max(0, cards.length - 1))];
  const progress = cards.length > 0 ? Math.round(((activeIndex + 1) / cards.length) * 100) : 0;

  if (!activeCard) return null;

  const currentAnswer = answers[activeCard.id] || {
    selected: activeCard.options.find((option) => option.recommended)?.id
      ? [activeCard.options.find((option) => option.recommended)!.id]
      : [],
    other: "",
    note: "",
  };

  const updateAnswer = (patch: Partial<typeof currentAnswer>) => {
    setAnswers((current) => ({
      ...current,
      [activeCard.id]: {
        ...currentAnswer,
        ...patch,
      },
    }));
  };

  const toggleOption = (optionId: string) => {
    if (activeCard.selectionMode === "multiple") {
      const selected = currentAnswer.selected.includes(optionId)
        ? currentAnswer.selected.filter((id) => id !== optionId)
        : [...currentAnswer.selected, optionId];
      updateAnswer({ selected, skipped: false });
      return;
    }
    updateAnswer({ selected: [optionId], skipped: false });
  };

  const buildSubmittedBrief = (finalAnswers: typeof answers) => {
    const lines = [
      "已确认 PPT 需求（结构化澄清选择）",
      `来源：${item.plan.title}`,
      "",
    ];
    for (const card of cards) {
      const answer = finalAnswers[card.id];
      if (!answer || answer.skipped) {
        lines.push(`- ${card.title}：跳过，按推荐默认处理`);
        continue;
      }
      const selectedLabels = answer.selected
        .map((id) => card.options.find((option) => option.id === id)?.label)
        .filter(Boolean);
      const extra = [answer.other, answer.note].map((value) => value.trim()).filter(Boolean);
      lines.push(
        `- ${card.title}：${[...selectedLabels, ...extra].join("；") || "按推荐默认处理"}`,
      );
    }
    lines.push("");
    lines.push("请基于以上 confirmed brief 先规划，再执行 PPT 工作流。");
    return lines.join("\n");
  };

  const goNext = (skip = false) => {
    const nextAnswers = {
      ...answers,
      [activeCard.id]: {
        ...currentAnswer,
        skipped: skip,
        selected: skip ? [] : currentAnswer.selected,
      },
    };
    setAnswers(nextAnswers);
    if (activeIndex < cards.length - 1) {
      setActiveIndex((value) => value + 1);
      return;
    }
    onSubmit?.(buildSubmittedBrief(nextAnswers));
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="w-full"
      data-message-key={item.messageKey}
    >
      <div className="overflow-hidden rounded-xl border border-border/80 bg-card/95">
        <div className="flex items-start justify-between gap-3 border-b border-border/70 px-4 py-3">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              需求确认
            </div>
            <div className="mt-1 text-sm font-semibold text-foreground">
              {activeCard.title}
            </div>
            {activeCard.why ? (
              <div className="mt-1 text-xs leading-5 text-muted-foreground">
                {activeCard.why}
              </div>
            ) : null}
          </div>
          <div className="shrink-0 text-right">
            <div className="text-[11px] font-semibold text-muted-foreground">
              第 {activeIndex + 1} / {cards.length} 项
            </div>
            <div className="mt-1 text-[11px] font-semibold text-muted-foreground">
              {progress}%
            </div>
          </div>
        </div>

        <div className="space-y-3 px-4 py-4">
          <div className="text-sm font-medium leading-6 text-foreground">
            {activeCard.question}
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {activeCard.options.map((option) => {
              const selected = currentAnswer.selected.includes(option.id);
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => toggleOption(option.id)}
                  className={`min-h-[64px] rounded-lg border px-3 py-2 text-left transition ${
                    selected
                      ? "border-ring bg-primary/5 shadow-[0_0_0_2px_rgba(9,105,218,0.10)]"
                      : "border-border/70 bg-background/80 hover:bg-muted/40"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                        selected ? "border-primary bg-primary text-primary-foreground" : "border-border"
                      }`}
                    >
                      {selected ? <Check className="h-3 w-3" /> : null}
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
                        {option.label}
                        {option.recommended ? (
                          <span className="rounded-full border border-border/70 bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                            推荐
                          </span>
                        ) : null}
                      </span>
                      {option.description ? (
                        <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                          {option.description}
                        </span>
                      ) : null}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="grid gap-2 md:grid-cols-2">
            {activeCard.allowOther !== false ? (
              <input
                value={currentAnswer.other}
                onChange={(event) => updateAnswer({ other: event.target.value, skipped: false })}
                placeholder="其他选择或约束"
                className="h-9 rounded-lg border border-border/70 bg-background/85 px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/15"
              />
            ) : null}
            {activeCard.allowNote !== false ? (
              <input
                value={currentAnswer.note}
                onChange={(event) => updateAnswer({ note: event.target.value, skipped: false })}
                placeholder={activeCard.notePlaceholder || "补充说明（可选）"}
                className="h-9 rounded-lg border border-border/70 bg-background/85 px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/15"
              />
            ) : null}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border/70 px-4 py-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 rounded-lg px-3 text-xs font-semibold"
            onClick={() => goNext(true)}
          >
            跳过
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-8 rounded-lg px-4 text-xs font-semibold"
            onClick={() => goNext(false)}
          >
            {activeIndex < cards.length - 1 ? "下一项" : "完成确认"}
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

function MessageBubble({
  item,
  onOpenDiffPreview,
  onOpenManagedReplay,
  onDeployArtifact,
  runtimeSwitchBlocked,
  currentSessionId,
  hiddenGoogleConfirmationIds,
  onApproveGoogleWorkspaceConfirmation,
  onRejectGoogleWorkspaceConfirmation,
  onSubmitStructuredClarification,
}: {
  item: ChatItem;
  onOpenDiffPreview?: (options?: {
    diffId?: string | null;
    filePath?: string | null;
    messageKey?: string | null;
    messageIndex?: number | null;
  }) => void;
  onOpenManagedReplay?: (
    runId: string,
    options?: {
      toolCallId?: string | null;
      view?: AltusDrawerView;
    },
  ) => void;
  onDeployArtifact?: (path: string) => Promise<void> | void;
  runtimeSwitchBlocked?: boolean;
  currentSessionId?: string | null;
  hiddenGoogleConfirmationIds?: string[];
  onApproveGoogleWorkspaceConfirmation?: (
    confirmation: GoogleWorkspaceConfirmationView,
  ) => Promise<void> | void;
  onRejectGoogleWorkspaceConfirmation?: (
    confirmation: GoogleWorkspaceConfirmationView,
  ) => Promise<void> | void;
  onSubmitStructuredClarification?: (answer: string) => void;
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
        <div className="w-full" data-message-key={item.userMessageKey}>
          <div className="flex justify-end">
            <div className="max-w-[80%] space-y-1.5 rounded-md bg-slate-900 px-3 py-2 text-sm text-white">
              <MessageInlineReferences
                skills={item.skills}
                mcpReferences={item.mcpReferences}
                tone="inverse"
              />
              {item.userText ? (
                <span className="whitespace-pre-wrap break-words">
                  {item.userText}
                </span>
              ) : null}
            </div>
          </div>
          <div className="mt-1.5 flex justify-end">
            <MessageAttachmentFiles
              attachments={item.attachments}
              sessionId={currentSessionId}
              className="max-w-[80%]"
            />
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
                    hiddenGoogleConfirmationIds={hiddenGoogleConfirmationIds}
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
                {i18n.t("homeWorkspace.thinking")}
              </span>
              {item.thinkingLabel ? (
                <span className="text-muted-foreground">
                  {item.thinkingLabel}
                </span>
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

  if (item.kind === "agent_explanation") {
    return (
      <CodexExplanationMessage
        markdown={item.markdown}
        heading={item.heading}
        collapsedMarkdown={item.collapsedMarkdown}
        active={item.active}
        author={item.author}
        showAuthor={item.showAuthor}
      />
    );
  }

  if (item.kind === "clarification_notice") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="w-full"
        data-message-key={item.messageKey}
      >
        <div
          className="flex items-center gap-[6px] py-1.5 text-sm font-medium"
          style={{ color: "var(--function-warning, rgb(217 119 6))" }}
        >
          <svg
            height="16"
            width="16"
            fill="none"
            viewBox="0 0 16 16"
            aria-hidden="true"
          >
            <circle
              cx="8"
              cy="8"
              r="6.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeDasharray="2.44 1.62"
            />
          </svg>
          <span>{item.text}</span>
        </div>
      </motion.div>
    );
  }

  if (item.kind === "structured_clarification") {
    return (
      <StructuredClarificationCardFlow
        item={item}
        onSubmit={onSubmitStructuredClarification}
      />
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
        <div className="flex max-w-[80%] flex-col items-end">
          <div className="space-y-1.5 rounded-md bg-slate-900 px-3 py-2 text-sm text-white">
            <MessageInlineReferences
              skills={item.skills}
              mcpReferences={item.mcpReferences}
              tone="inverse"
            />
            {item.text ? (
              <span className="whitespace-pre-wrap break-words">
                {item.text}
              </span>
            ) : null}
          </div>
          <MessageAttachmentFiles
            attachments={item.attachments}
            sessionId={currentSessionId}
            className="mt-1.5"
          />
        </div>
      </motion.div>
    );
  }

  if (item.kind === "opencode_tool") {
    return (
      <div data-message-key={item.messageKey}>
        <OpencodeToolCard
          item={item}
          currentSessionId={currentSessionId}
          hiddenGoogleConfirmationIds={hiddenGoogleConfirmationIds}
          onApproveGoogleWorkspaceConfirmation={
            onApproveGoogleWorkspaceConfirmation
          }
          onRejectGoogleWorkspaceConfirmation={
            onRejectGoogleWorkspaceConfirmation
          }
          onOpenDiffPreview={onOpenDiffPreview}
        />
      </div>
    );
  }

  if (item.kind === "managed_activity_group") {
    return (
      <div data-message-key={item.messageKey}>
        <ManagedActivityGroup
          item={item}
          currentSessionId={currentSessionId}
          hiddenGoogleConfirmationIds={hiddenGoogleConfirmationIds}
          onApproveGoogleWorkspaceConfirmation={
            onApproveGoogleWorkspaceConfirmation
          }
          onRejectGoogleWorkspaceConfirmation={
            onRejectGoogleWorkspaceConfirmation
          }
          onOpenReplay={(runId, toolCallId, toolName) =>
            onOpenManagedReplay?.(runId, {
              toolCallId,
              view: resolveManagedToolReplayView(toolName),
            })
          }
        />
      </div>
    );
  }

  if (item.kind === "managed_tool") {
    return (
      <div data-message-key={item.messageKey}>
        <ManagedToolCard
          item={item}
          currentSessionId={currentSessionId}
          hiddenGoogleConfirmationIds={hiddenGoogleConfirmationIds}
          onApproveGoogleWorkspaceConfirmation={
            onApproveGoogleWorkspaceConfirmation
          }
          onRejectGoogleWorkspaceConfirmation={
            onRejectGoogleWorkspaceConfirmation
          }
          onOpenReplay={(runId, toolCallId, toolName) =>
            onOpenManagedReplay?.(runId, {
              toolCallId,
              view: resolveManagedToolReplayView(toolName),
            })
          }
        />
      </div>
    );
  }

  if (item.kind === "managed_artifact_card") {
    return (
      <div data-message-key={item.messageKey}>
        <AltusArtifactPreviewCard
          sessionId={item.sessionId}
          runId={item.runId}
          artifacts={item.artifacts}
          previewSnapshot={item.previewSnapshot}
          browserScreenshotFallback={item.browserScreenshotFallback}
          displayMode="web-preview"
          onOpenRemoteDebug={() =>
            onOpenManagedReplay?.(item.runId, { view: "debug" })
          }
          onDeployRequested={onDeployArtifact}
          runtimeSwitchBlocked={runtimeSwitchBlocked}
        />
      </div>
    );
  }

  if (item.kind === "managed_deliverable_card") {
    return (
      <div data-message-key={item.messageKey}>
        <TaskDeliverableCard
          sessionId={item.sessionId}
          deliverables={item.deliverables}
          onOpenFiles={() =>
            onOpenManagedReplay?.(item.runId, { view: "files" })
          }
        />
      </div>
    );
  }

  if (item.kind === "managed_status") {
    return null;
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
          {item.showAuthor !== false ? (
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              {item.author || "OpenCode"}
            </div>
          ) : null}
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
        {item.author && item.showAuthor !== false ? (
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
  for (const definition of PROGRESS_STATUS_DEFINITIONS) {
    if (definition.patterns.some((pattern) => text.includes(pattern))) {
      return { label: text, rest: "" };
    }
  }

  // 兼容后端未加 {标签} 的阶段文本
  for (const fallback of CAPSULE_FALLBACK_LABELS) {
    if (text.startsWith(fallback.pattern)) {
      return {
        label: fallback.pattern,
        rest: text
          .slice(fallback.pattern.length)
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
    text.toLowerCase().includes("failed") ||
    text.toLowerCase().includes("error")
  ) {
    return false;
  }
  return Boolean(findProgressStatusDefinition(text));
}

function isProgressLoadingLabel(label: string): boolean {
  const text = label.trim();
  if (!text) return false;
  if (
    text.includes("错误") ||
    text.includes("失败") ||
    text.toLowerCase().includes("failed") ||
    text.toLowerCase().includes("error")
  ) {
    return false;
  }
  const progressStatus = findProgressStatusDefinition(text);
  if (progressStatus) {
    return progressStatus.loading;
  }
  const completeKeywords = [
    "完成",
    "已生成",
    "已就绪",
    "已接入",
    "成功",
    "completed",
    "generated",
    "ready",
    "attached",
    "success",
  ];
  return !completeKeywords.some((keyword) =>
    text.toLowerCase().includes(keyword.toLowerCase()),
  );
}

function getCapsuleTone(label: string): CapsuleTone {
  const text = label.trim();
  const lower = text.toLowerCase();
  if (
    lower.includes("错误") ||
    lower.includes("失败") ||
    lower.includes("error") ||
    lower.includes("failed")
  ) {
    return "error";
  }
  const progressStatus = findProgressStatusDefinition(text);
  if (progressStatus) return progressStatus.tone;
  const fallbackLabel = findFallbackCapsuleLabel(text);
  if (fallbackLabel) return fallbackLabel.tone;
  if (lower.includes("analysis")) return "intent";
  if (lower.includes("develop") || lower.includes("execution"))
    return "execution";
  if (lower.includes("test")) return "review";
  if (lower.includes("plan")) return "planning";
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
  if (stream) return i18n.t("homeWorkspace.opencodeLiveOutput");
  if (!eventType) return "OpenCode";
  if (eventType === "message.final")
    return i18n.t("homeWorkspace.opencodeFinalOutput");
  if (eventType === "session.idle") return i18n.t("homeWorkspace.opencodeIdle");
  if (eventType === "session.status")
    return i18n.t("homeWorkspace.opencodeStatus");
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

function readStructuredClarificationPlan(
  metadataRaw: unknown,
): StructuredClarificationCardPlan | null {
  const metadata = toRecord(metadataRaw);
  const rawPlan =
    toRecord(metadata.structuredClarification).kind === "structured_clarification"
      ? metadata.structuredClarification
      : toRecord(toRecord(metadata.result).structuredClarification).kind ===
          "structured_clarification"
        ? toRecord(metadata.result).structuredClarification
        : null;
  const plan = toRecord(rawPlan);
  if (plan.kind !== "structured_clarification") return null;
  const cards = (Array.isArray(plan.cards) ? plan.cards : [])
    .map((rawCard) => {
      const card = toRecord(rawCard);
      const options = (Array.isArray(card.options) ? card.options : [])
        .map((rawOption) => {
          const option = toRecord(rawOption);
          const id = asText(option.id);
          const label = asText(option.label);
          if (!id || !label) return null;
          return {
            id,
            label,
            description: asText(option.description),
            impact: asText(option.impact),
            recommended: Boolean(option.recommended),
          } satisfies StructuredClarificationOption;
        })
        .filter((item) => Boolean(item)) as StructuredClarificationOption[];
      const limitedOptions = options.slice(0, 4);
      const id = asText(card.id);
      const title = asText(card.title);
      const question = asText(card.question);
      if (!id || !title || !question || limitedOptions.length < 2) return null;
      return {
        id,
        title,
        question,
        why: asText(card.why),
        selectionMode: asText(card.selectionMode) === "multiple" ? "multiple" : "single",
        required: card.required !== false,
        options: limitedOptions,
        allowOther: card.allowOther !== false,
        allowNote: card.allowNote !== false,
        notePlaceholder: asText(card.notePlaceholder),
      } satisfies StructuredClarificationCard;
    })
    .filter((item) => Boolean(item)) as StructuredClarificationCard[];
  const limitedCards = cards.slice(0, 4);
  if (limitedCards.length === 0) return null;
  return {
    kind: "structured_clarification",
    taskType:
      plan.taskType === "report" ||
      plan.taskType === "website" ||
      plan.taskType === "generic"
        ? plan.taskType
        : "ppt",
    title: asText(plan.title) || "补充关键需求",
    summary: asText(plan.summary),
    maxCards: 4,
    cards: limitedCards,
    briefFields: Array.isArray(plan.briefFields)
      ? plan.briefFields.map((item) => asText(item)).filter(Boolean)
      : limitedCards.map((card) => card.id),
  };
}

function isHiddenMcpConfirmationUserMessage(
  message: Pick<AgentMessage, "type" | "content" | "metadata"> | null | undefined,
): boolean {
  if (message?.type !== "user_response") return false;
  const metadata = toRecord(message.metadata);
  const source = asText(metadata.source);
  if (
    source === "mcp_tool_confirmation_approved" ||
    source === "mcp_tool_confirmation_rejected"
  ) {
    return true;
  }
  const content = (message.content || "").trim();
  return (
    content === "[mcp_tool_confirmation:approve]" ||
    content === "[mcp_tool_confirmation:reject]"
  );
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
    role: (
      asText(message.role) ||
      asText(properties.role) ||
      asText(part.role)
    ).toLowerCase(),
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

type CodexCommandCategory = "list" | "search" | "read" | "write" | "command";

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
    const token = stripShellQuotes(
      heredocMatch[1].trim().split(/\s+/)[0] || "",
    );
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

function extractCodexWritePayloadPreview(command: string): {
  kind: "heredoc" | "command";
  text: string;
  truncated: boolean;
} | null {
  const normalized = normalizeShellCommand(command);
  if (!normalized) return null;

  const markerMatch = normalized.match(/<<['"]?([A-Za-z0-9_]+)['"]?/);
  if (!markerMatch) {
    return null;
  }
  const marker = markerMatch[1];
  const lines = normalized.split(/\r?\n/);
  if (lines.length <= 1) {
    return null;
  }
  const payloadLines: string[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = stripShellQuotes(line.trim());
    if (trimmed === marker) {
      break;
    }
    payloadLines.push(line);
  }
  const payloadText = payloadLines.join("\n").trim();
  if (!payloadText) {
    return null;
  }
  const preview = truncateText(payloadText, 2400);
  return {
    kind: "heredoc",
    text: preview.text,
    truncated: preview.truncated,
  };
}

function inferCodexWriteLabel(command: string): string {
  const normalized = normalizeShellCommand(command).toLowerCase();
  if (normalized.startsWith("mv ")) return i18n.t("homeWorkspace.moveFile");
  if (normalized.startsWith("cp ")) return i18n.t("homeWorkspace.copyFile");
  if (normalized.includes(">>")) return i18n.t("homeWorkspace.appendFile");
  if (
    normalized.includes("cat <<") ||
    normalized.includes(">") ||
    normalized.includes("tee ")
  ) {
    return i18n.t("homeWorkspace.fileEdit");
  }
  return i18n.t("homeWorkspace.fileEdit");
}

function getCodexCommandCardCopy(command: string) {
  const category = inferCodexCommandCategory(command);
  switch (category) {
    case "list":
      return {
        category,
        title: i18n.t("homeWorkspace.directoryCheck"),
        icon: FolderSearch2,
      };
    case "search":
      return { category, title: i18n.t("homeWorkspace.search"), icon: Search };
    case "read":
      return {
        category,
        title: i18n.t("homeWorkspace.fileView"),
        icon: FileSearch,
      };
    case "write":
      return {
        category,
        title: i18n.t("homeWorkspace.fileEdit"),
        icon: FilePenLine,
      };
    default:
      return {
        category,
        title: i18n.t("homeWorkspace.shellExecution"),
        icon: Terminal,
      };
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
  if (
    normalized === "add" ||
    normalized === "create" ||
    normalized === "created"
  ) {
    return i18n.t("homeWorkspace.createFile");
  }
  if (
    normalized === "delete" ||
    normalized === "deleted" ||
    normalized === "remove" ||
    normalized === "removed"
  ) {
    return i18n.t("homeWorkspace.deleteFile");
  }
  return i18n.t("homeWorkspace.updateFile");
}

function getToolInfo(tool: string, input: Record<string, unknown>) {
  const lower = tool.toLowerCase();
  switch (lower) {
    case "read":
      return {
        title: i18n.t("homeWorkspace.readAction"),
        subtitle: getFilename(asText(input.filePath)),
      };
    case "list":
      return {
        title: i18n.t("homeWorkspace.listAction"),
        subtitle: getDirectory(asText(input.path) || "/"),
      };
    case "glob":
      return {
        title: i18n.t("homeWorkspace.matchAction"),
        subtitle: asText(input.pattern),
      };
    case "grep":
      return {
        title: i18n.t("homeWorkspace.search"),
        subtitle: asText(input.pattern),
      };
    case "webfetch":
      return {
        title: i18n.t("homeWorkspace.fetchAction"),
        subtitle: asText(input.url),
      };
    case "task":
      return {
        title: i18n.t("homeWorkspace.subtaskAction"),
        subtitle: asText(input.description),
      };
    case "bash":
      return {
        title: "Shell",
        subtitle: asText(input.description) || asText(input.command),
      };
    case "edit":
      return {
        title: i18n.t("common.edit"),
        subtitle: getFilename(asText(input.filePath)),
      };
    case "write":
      return {
        title: i18n.t("homeWorkspace.writeAction"),
        subtitle: getFilename(asText(input.filePath)),
      };
    case "apply_patch":
      return {
        title: i18n.t("homeWorkspace.patchLabel"),
        subtitle: Array.isArray(input.files)
          ? `${input.files.length} ${i18n.t("homeWorkspace.file")}`
          : "",
      };
    case "todowrite":
      return { title: i18n.t("homeWorkspace.todo") };
    case "question":
      return { title: i18n.t("homeWorkspace.pendingConfirmation") };
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

function buildDetailPreview(
  value: string,
  maxLines = 3,
  maxCharsPerLine = 120,
) {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(
      (line, index, arr) => line || arr.length === 1 || index < arr.length - 1,
    );
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
  const toolLabel = input.toolName
    ? `${i18n.t("homeWorkspace.toolLabel")}: ${input.toolName}`
    : "";
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
      baseCommand
        ? `${i18n.t("homeWorkspace.commandLabel")}: ${baseCommand}`
        : "",
      cwd ? `${i18n.t("homeWorkspace.directoryLabel")}: ${cwd}` : "",
      shortOutput
        ? `${i18n.t("homeWorkspace.outputSummaryLabel")}: ${shortOutput}`
        : "",
    ]);
  }

  if (toolKey === "read") {
    return summarizeTooltipLines([
      toolLabel,
      filePath ? `${i18n.t("homeWorkspace.readFileLabel")}: ${filePath}` : "",
    ]);
  }

  if (toolKey === "write") {
    return summarizeTooltipLines([
      toolLabel,
      filePath ? `${i18n.t("homeWorkspace.writeFileLabel")}: ${filePath}` : "",
    ]);
  }

  if (toolKey === "edit") {
    return summarizeTooltipLines([
      toolLabel,
      filePath ? `${i18n.t("homeWorkspace.editFileLabel")}: ${filePath}` : "",
    ]);
  }

  if (toolKey === "grep") {
    return summarizeTooltipLines([
      toolLabel,
      pattern
        ? `${i18n.t("homeWorkspace.searchPatternLabel")}: ${pattern}`
        : "",
      filePath ? `${i18n.t("homeWorkspace.scopeLabel")}: ${filePath}` : "",
    ]);
  }

  if (toolKey === "glob") {
    return summarizeTooltipLines([
      toolLabel,
      pattern ? `${i18n.t("homeWorkspace.matchPatternLabel")}: ${pattern}` : "",
      filePath ? `${i18n.t("homeWorkspace.scopeLabel")}: ${filePath}` : "",
    ]);
  }

  if (toolKey === "list") {
    return summarizeTooltipLines([
      toolLabel,
      filePath
        ? `${i18n.t("homeWorkspace.listDirectoryLabel")}: ${filePath}`
        : "",
    ]);
  }

  if (toolKey === "webfetch") {
    return summarizeTooltipLines([
      toolLabel,
      url ? `${i18n.t("homeWorkspace.fetchUrlLabel")}: ${url}` : "",
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
      return i18n.t("homeWorkspace.applyPatch");
    }
    return summarizeTooltipLines([
      toolLabel,
      i18n.t("homeWorkspace.patchTargetFiles"),
      ...files.slice(0, 6).map((file) => `- ${file}`),
      files.length > 6
        ? `- ${i18n.t("homeWorkspace.otherFiles", { count: files.length - 6 })}`
        : "",
    ]);
  }

  if (
    input.eventType.startsWith("file.") ||
    input.eventType === "file.changed"
  ) {
    if (fileList.length > 0) {
      return summarizeTooltipLines([
        toolLabel,
        ...fileList
          .slice(0, 6)
          .map((item) => `${mapCodexFileChangeLabel(item.kind)}: ${item.path}`),
        fileList.length > 6
          ? i18n.t("homeWorkspace.otherFiles", { count: fileList.length - 6 })
          : "",
      ]);
    }
    return summarizeTooltipLines([
      toolLabel,
      filePath ? `${i18n.t("homeWorkspace.filePathLabel")}: ${filePath}` : "",
    ]);
  }

  if (toolKey === "task") {
    const description =
      asText(toolInput.description) || asText(properties.description);
    return summarizeTooltipLines([
      toolLabel,
      description
        ? `${i18n.t("homeWorkspace.subtaskLabel")}: ${description}`
        : "",
    ]);
  }

  return summarizeTooltipLines([
    toolLabel,
    baseCommand
      ? `${i18n.t("homeWorkspace.commandLabel")}: ${baseCommand}`
      : "",
    filePath ? `${i18n.t("homeWorkspace.pathLabel")}: ${filePath}` : "",
    shortOutput
      ? `${i18n.t("homeWorkspace.outputSummaryLabel")}: ${shortOutput}`
      : "",
  ]);
}

function OpencodeToolCard({
  item,
  currentSessionId,
  hiddenGoogleConfirmationIds,
  onApproveGoogleWorkspaceConfirmation,
  onRejectGoogleWorkspaceConfirmation,
  onOpenDiffPreview,
}: {
  item: Extract<ChatItem, { kind: "opencode_tool" }>;
  currentSessionId?: string | null;
  hiddenGoogleConfirmationIds?: string[];
  onApproveGoogleWorkspaceConfirmation?: (
    confirmation: GoogleWorkspaceConfirmationView,
  ) => Promise<void> | void;
  onRejectGoogleWorkspaceConfirmation?: (
    confirmation: GoogleWorkspaceConfirmationView,
  ) => Promise<void> | void;
  onOpenDiffPreview?: (options?: {
    diffId?: string | null;
    filePath?: string | null;
    messageKey?: string | null;
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
  const isCodexExecutor = asText(metadata.executor).toLowerCase() === "codex";

  const isDiffEvent = (toolName || "").toLowerCase() === "apply_patch";
  const toolKey = (toolName || "").toLowerCase();
  const googleConfirmation = readGoogleWorkspaceConfirmationFromOpencodeEvent({
    metadata,
    output,
    content: item.content,
    properties,
    part,
    toolState,
  });

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
              {i18n.t("homeWorkspace.showMore")}
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
        title:
          eventType === "file.watcher.updated"
            ? i18n.t("homeWorkspace.fileWatch")
            : i18n.t("homeWorkspace.fileUpdate"),
        subtitle: getFilename(filePath),
      };
    } else if (eventType === "command.executed") {
      const category = asText(metadata.commandCategory).toLowerCase();
      info = {
        title:
          category === "list"
            ? i18n.t("homeWorkspace.directoryCheck")
            : category === "search"
              ? i18n.t("homeWorkspace.search")
              : category === "read"
                ? i18n.t("homeWorkspace.fileView")
                : category === "write"
                  ? i18n.t("homeWorkspace.fileEdit")
                  : i18n.t("homeWorkspace.commandExecution"),
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
            ? `${files.length} ${i18n.t("homeWorkspace.filesUnit")}`
            : getFilename(asText(first.path) || asText(first.file)),
      };
    } else if (eventType.startsWith("pty.")) {
      info = {
        title: i18n.t("homeWorkspace.terminal"),
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
  let detailTitle = `${info.title}${summaryText ? ` · ${summaryText}` : ""}`;
  let detailBodyText = explanationText;
  const wrapWithDetailDialog = (content: ReactNode) => (
    <>
      {content}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{detailTitle}</DialogTitle>
            <DialogDescription>
              {i18n.t("homeWorkspace.toolDetailDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-auto rounded-md bg-slate-950 px-4 py-3 font-mono text-xs leading-6 text-slate-100 whitespace-pre-wrap break-all">
            {detailBodyText}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );

  if (
    shouldRenderGoogleWorkspaceConfirmation({
      confirmation: googleConfirmation,
      hiddenConfirmationIds: hiddenGoogleConfirmationIds,
    })
  ) {
    return (
      <GoogleWorkspaceConfirmationPanel
        confirmation={googleConfirmation!}
        currentSessionId={currentSessionId}
        compact
        onApprove={onApproveGoogleWorkspaceConfirmation}
        onReject={onRejectGoogleWorkspaceConfirmation}
      />
    );
  }

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
              messageKey: item.messageKey || null,
              messageIndex: item.messageIndex,
            })
          }
          className="text-left"
        >
          <EventCapsule
            icon={FileDiff}
            text={i18n.t("homeWorkspace.diffClickToView")}
            title={explanationText || undefined}
          />
        </button>
      </motion.div>,
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
        <div className="rounded-xl border border-border/70 bg-card px-4 py-3 text-sm text-foreground shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {i18n.t("homeWorkspace.todo")}
          </div>
          {todos.length > 0 ? (
            <div className="mt-3 space-y-2">
              {todos.map((todo, index) => {
                const content =
                  asText(todo.content) || i18n.t("homeWorkspace.todoItem");
                const statusText = asText(todo.status) || "pending";
                const priority = asText(todo.priority);
                const statusLabel =
                  statusText === "completed"
                    ? i18n.t("homeWorkspace.completed")
                    : statusText === "in_progress"
                      ? i18n.t("homeWorkspace.inProgress")
                      : i18n.t("homeWorkspace.pending");
                const statusTone = getTodoStatusTone(statusText);
                return (
                  <div
                    key={`${content}-${index}`}
                    className="flex items-center justify-between gap-3"
                  >
                    <div className="text-sm text-foreground">{content}</div>
                    <div className="flex items-center gap-2">
                      {priority ? (
                        <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-200">
                          {priority === "high"
                            ? i18n.t("homeWorkspace.priorityHigh")
                            : priority === "medium"
                              ? i18n.t("homeWorkspace.priorityMedium")
                              : i18n.t("homeWorkspace.priorityLow")}
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
      </motion.div>,
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
        <div className="rounded-xl border border-border/70 bg-card px-4 py-3 text-sm text-foreground shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {i18n.t("homeWorkspace.pendingConfirmation")}
          </div>
          <div className="mt-3 space-y-3">
            {questions.map((question, index) => (
              <div
                key={`${question.question}-${index}`}
                className="space-y-1.5"
              >
                {question.header ? (
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {question.header}
                  </div>
                ) : null}
                <div className="text-sm text-foreground">
                  {question.question}
                </div>
                {question.options.length > 0 ? (
                  <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                    {question.options.map((option, optionIndex) => (
                      <li key={`${option}-${optionIndex}`}>{option}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
            <div className="text-xs text-muted-foreground">
              {i18n.t("homeWorkspace.replyInComposer")}
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
    const label =
      toolKey === "write"
        ? i18n.t("homeWorkspace.writeFile")
        : i18n.t("homeWorkspace.editFile");
    const fileName = getFilename(filePath) || i18n.t("homeWorkspace.file");
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
                messageKey: item.messageKey || null,
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
        ? i18n.t("homeWorkspace.failedShort")
        : statusText === "completed" || exitCodeText === "0"
          ? i18n.t("homeWorkspace.successShort")
          : i18n.t("homeWorkspace.executionShort");
    const capsuleText =
      writeLike && targetPath
        ? `${inferCodexWriteLabel(commandText)} · ${getFilename(targetPath) || targetPath}`
        : `${commandCard.title} · ${statusLabel}`;
    const inlineSummary =
      writeLike && targetPath
        ? i18n.t("homeWorkspace.shellWriteSummary", {
            action: inferCodexWriteLabel(commandText),
            path: targetPath,
          })
        : "";
    if (isCodexExecutor && writeLike) {
      const resolvedLabel = inferCodexWriteLabel(commandText);
      const resolvedPath = targetPath || "";
      const resolvedFileName =
        getFilename(resolvedPath) || i18n.t("homeWorkspace.file");
      const writePayloadPreview = extractCodexWritePayloadPreview(commandText);
      const commandPreview = truncateText(commandText || "", 2400);
      detailTitle = `${resolvedLabel} · ${resolvedFileName}`;
      detailBodyText = [
        `${i18n.t("homeWorkspace.operationLabel")}: ${resolvedLabel}`,
        resolvedPath
          ? `${i18n.t("homeWorkspace.targetFileLabel")}: ${resolvedPath}`
          : "",
        writePayloadPreview
          ? i18n.t("homeWorkspace.writeContentPreviewLabel")
          : commandText
            ? i18n.t("homeWorkspace.commandSummaryLabel")
            : "",
        writePayloadPreview
          ? writePayloadPreview.text
          : commandText
            ? commandPreview.text
            : "",
        writePayloadPreview?.truncated
          ? i18n.t("homeWorkspace.writeContentTruncated")
          : commandText && commandPreview.truncated
            ? i18n.t("homeWorkspace.commandContentTruncated")
            : "",
        !commandText && explanationText ? explanationText : "",
      ]
        .filter(Boolean)
        .join("\n");
    }
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
            <div className="whitespace-pre-wrap break-words text-[11px] text-muted-foreground">
              {inlineSummary}
            </div>
          ) : null}
          {commandText && !writeLike ? (
            <div className="rounded-md bg-slate-900 px-3 py-2 text-xs text-slate-100 font-mono">
              {commandText}
            </div>
          ) : null}
          {compactOutput && previewText ? (
            <div className="whitespace-pre-wrap break-words text-[11px] text-muted-foreground">
              {previewText}
            </div>
          ) : null}
          {!compactOutput && outputText ? (
            <div className="rounded-md bg-slate-950 px-3 py-2 text-xs text-slate-100 font-mono whitespace-pre-wrap">
              {outputText}
            </div>
          ) : null}
          {!compactOutput && truncated ? (
            <div className="text-[11px] text-muted-foreground">
              {i18n.t("homeWorkspace.outputTruncated")}
            </div>
          ) : null}
        </div>
      </motion.div>,
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
        ? `${label || i18n.t("homeWorkspace.fileChange")} · ${files.length} ${i18n.t("homeWorkspace.filesUnit")}`
        : `${label || i18n.t("homeWorkspace.fileChange")} · ${getFilename(primaryPath) || i18n.t("homeWorkspace.file")}`;
    const icon =
      label === i18n.t("homeWorkspace.createFile")
        ? FilePlus
        : label === i18n.t("homeWorkspace.deleteFile")
          ? Trash2
          : FilePenLine;
    detailTitle =
      files.length > 1
        ? `${label || i18n.t("homeWorkspace.fileChange")} · ${files.length} ${i18n.t("homeWorkspace.filesUnit")}`
        : `${label || i18n.t("homeWorkspace.fileChange")} · ${getFilename(primaryPath) || i18n.t("homeWorkspace.file")}`;
    detailBodyText = [
      `${i18n.t("homeWorkspace.operationLabel")}: ${label || i18n.t("homeWorkspace.fileChange")}`,
      primaryPath
        ? `${i18n.t("homeWorkspace.targetFileLabel")}: ${primaryPath}`
        : "",
      files.length > 1
        ? `${i18n.t("homeWorkspace.affectedFilesLabel")}:\n${files
            .map(
              (item) => `${mapCodexFileChangeLabel(item.kind)}: ${item.path}`,
            )
            .join("\n")}`
        : "",
      asText(properties.diff) ? i18n.t("homeWorkspace.nativeDiffSynced") : "",
    ]
      .filter(Boolean)
      .join("\n");
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
                messageKey: item.messageKey || null,
                messageIndex: item.messageIndex,
              })
            }
            className="text-left"
          >
            <EventCapsule
              icon={icon}
              text={text}
              title={explanationText || undefined}
            />
          </button>
        ) : (
          <EventCapsule
            icon={icon}
            text={text}
            title={explanationText || undefined}
          />
        )}
      </motion.div>,
    );
  }

  if (eventType.startsWith("file.")) {
    const filePath = asText(properties.file) || asText(properties.path);
    const label =
      eventType === "file.watcher.updated"
        ? i18n.t("homeWorkspace.fileWatch")
        : i18n.t("homeWorkspace.fileUpdate");
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
                messageKey: item.messageKey || null,
                messageIndex: item.messageIndex,
              })
            }
            className="text-left"
          >
            <EventCapsule
              icon={FileText}
              text={`${label} · ${getFilename(filePath) || i18n.t("homeWorkspace.fileUpdated")}`}
              title={explanationText || undefined}
            />
          </button>
        ) : (
          <EventCapsule
            icon={FileText}
            text={`${label} · ${getFilename(filePath) || i18n.t("homeWorkspace.fileUpdated")}`}
            title={explanationText || undefined}
          />
        )}
      </motion.div>,
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
        title={
          explanationText ||
          (toolKey === "bash" ? commandHint || undefined : undefined)
        }
      />
    </motion.div>,
  );
}

function getManagedToolStatusPresentation(status: string) {
  if (status === "failed") {
    return {
      iconClass:
        "border border-[var(--tool-error-border)] bg-[var(--tool-error-surface)] text-[var(--tool-error-foreground)]",
      badgeClass:
        "border-[var(--tool-error-border)] bg-[var(--tool-error-surface-strong)] text-[var(--tool-error-foreground)]",
      hoverHeaderClass:
        "border-b border-[var(--tool-error-border)] bg-[var(--tool-error-surface)]",
      previewClass:
        "border border-[var(--tool-error-border)] bg-[var(--tool-error-surface)] text-foreground",
      detailClass: "text-foreground/82",
      hintClass: "text-[var(--tool-error-foreground)]/80",
    } as const;
  }

  if (status === "completed") {
    return {
      iconClass:
        "border border-[var(--tool-success-border)] bg-[var(--tool-success-surface)] text-[var(--tool-success-foreground)]",
      badgeClass:
        "border-[var(--tool-success-border)] bg-[var(--tool-success-surface-strong)] text-[var(--tool-success-foreground)]",
      hoverHeaderClass:
        "border-b border-[var(--tool-success-border)] bg-[var(--tool-success-surface)]",
      previewClass:
        "border border-[var(--tool-success-border)] bg-[var(--tool-success-surface)] text-foreground",
      detailClass: "text-foreground/82",
      hintClass: "text-[var(--tool-success-foreground)]/80",
    } as const;
  }

  return {
    iconClass: "border border-border/70 bg-background/85 text-foreground/75",
    badgeClass: "border-border/70 bg-background/90 text-foreground/75",
    hoverHeaderClass: "border-b border-border/70 bg-muted/25",
    previewClass: "border border-border/70 bg-background/70 text-foreground",
    detailClass: "text-foreground/80",
    hintClass: "text-muted-foreground",
  } as const;
}

function getManagedToolIcon(toolName: string): LucideIcon {
  if (toolName === "shell_execute") return Terminal;
  if (toolName === "debug_open_page") return Bug;
  if (isManagedDeploymentTool(toolName)) return Rocket;
  if (toolName === "write_file") return FilePenLine;
  if (toolName === "read_file") return FileText;
  if (toolName === "search_code") return Search;
  if (toolName === "web_search") return Search;
  if (toolName === "web_extract") return FileSearch;
  if (toolName === "list_directory") return FolderSearch2;
  if (toolName === "ask_user") return Sparkles;
  return FileSearch;
}

function isManagedWebResearchTool(toolName: string) {
  return toolName === "web_search" || toolName === "web_extract";
}

function ManagedActivityGroup({
  item,
  onOpenReplay,
  currentSessionId,
  hiddenGoogleConfirmationIds,
  onApproveGoogleWorkspaceConfirmation,
  onRejectGoogleWorkspaceConfirmation,
}: {
  item: Extract<ChatItem, { kind: "managed_activity_group" }>;
  onOpenReplay?: (runId: string, toolCallId: string, toolName: string) => void;
  currentSessionId?: string | null;
  hiddenGoogleConfirmationIds?: string[];
  onApproveGoogleWorkspaceConfirmation?: (
    confirmation: GoogleWorkspaceConfirmationView,
  ) => Promise<void> | void;
  onRejectGoogleWorkspaceConfirmation?: (
    confirmation: GoogleWorkspaceConfirmationView,
  ) => Promise<void> | void;
}) {
  const [expanded, setExpanded] = useState(item.defaultExpanded ?? true);
  useEffect(() => {
    setExpanded(item.defaultExpanded ?? true);
  }, [item.defaultExpanded, item.messageKey]);
  const toolCount = item.items.filter((entry) => entry.kind === "managed_tool").length;
  const completedToolCount = item.items.filter(
    (entry) => entry.kind === "managed_tool" && entry.status === "completed",
  ).length;
  const activityState = getManagedActivityState(item.items);
  const StatusIcon =
    activityState === "failed"
      ? X
      : activityState === "running"
        ? Loader2
        : Check;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="w-full"
    >
      <div className="flex max-w-[min(100%,44rem)] flex-col gap-0">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="group/header flex w-full items-center justify-between gap-3 rounded-lg px-1 py-1 text-left text-sm text-foreground transition hover:bg-muted/35"
        >
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
                activityState === "failed"
                  ? "bg-destructive text-destructive-foreground"
                  : activityState === "running"
                    ? "bg-muted text-muted-foreground"
                    : "bg-muted-foreground text-background"
              }`}
            >
              <StatusIcon
                className={`h-2.5 w-2.5 ${
                  activityState === "running" ? "animate-spin" : ""
                }`}
              />
            </span>
            <span className="truncate font-medium" title={item.title}>
              {item.title}
            </span>
            <ChevronDown
              className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${
                expanded ? "rotate-180" : ""
              }`}
            />
          </div>
          {toolCount > 0 ? (
            <span className="shrink-0 text-[12px] text-muted-foreground opacity-0 transition group-hover/header:opacity-100">
              {completedToolCount}/{toolCount}
            </span>
          ) : null}
        </button>
        {expanded ? (
          <div className="flex">
            <div className="relative w-6 shrink-0">
              <div className="absolute left-2 top-0 bottom-0 border-l border-dashed border-border" />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-2 overflow-hidden pt-2">
              {item.items.map((entry, index) =>
                entry.kind === "managed_status" ? (
                  <p
                    key={entry.messageKey || `managed-status-${index}`}
                    className="text-[14px] leading-6 text-muted-foreground"
                  >
                    {entry.text}
                  </p>
                ) : (
                  <ManagedActivityToolRow
                    key={entry.messageKey || entry.toolCallId || `managed-tool-${index}`}
                    item={entry}
                    onOpenReplay={onOpenReplay}
                    currentSessionId={currentSessionId}
                    hiddenGoogleConfirmationIds={hiddenGoogleConfirmationIds}
                    onApproveGoogleWorkspaceConfirmation={
                      onApproveGoogleWorkspaceConfirmation
                    }
                    onRejectGoogleWorkspaceConfirmation={
                      onRejectGoogleWorkspaceConfirmation
                    }
                  />
                ),
              )}
            </div>
          </div>
        ) : null}
      </div>
    </motion.div>
  );
}

function ManagedActivityToolRow({
  item,
  onOpenReplay,
  currentSessionId,
  hiddenGoogleConfirmationIds,
  onApproveGoogleWorkspaceConfirmation,
  onRejectGoogleWorkspaceConfirmation,
}: {
  item: Extract<ChatItem, { kind: "managed_tool" }>;
  onOpenReplay?: (runId: string, toolCallId: string, toolName: string) => void;
  currentSessionId?: string | null;
  hiddenGoogleConfirmationIds?: string[];
  onApproveGoogleWorkspaceConfirmation?: (
    confirmation: GoogleWorkspaceConfirmationView,
  ) => Promise<void> | void;
  onRejectGoogleWorkspaceConfirmation?: (
    confirmation: GoogleWorkspaceConfirmationView,
  ) => Promise<void> | void;
}) {
  const Icon = getManagedToolIcon(item.toolName);
  const isWebToolRunning =
    item.status === "running" && isManagedWebResearchTool(item.toolName);
  const RowIcon = isWebToolRunning ? Loader2 : Icon;
  const googleConfirmation = readGoogleWorkspaceConfirmation(item.metadata);
  const title =
    getManagedToolTimelineTitle(item.toolName, item.metadata, item.status) ||
    item.summary?.trim() ||
    getManagedToolDisplayName(item.toolName);
  const statusUi = getManagedToolStatusPresentation(item.status);

  if (
    shouldRenderGoogleWorkspaceConfirmation({
      confirmation: googleConfirmation,
      hiddenConfirmationIds: hiddenGoogleConfirmationIds,
    })
  ) {
    return (
      <GoogleWorkspaceConfirmationPanel
        confirmation={{ ...googleConfirmation!, agentRunId: item.runId }}
        currentSessionId={currentSessionId}
        compact
        onApprove={onApproveGoogleWorkspaceConfirmation}
        onReject={onRejectGoogleWorkspaceConfirmation}
      />
    );
  }

  return (
    <div className="group flex w-full items-center gap-2">
      <div className="h-7 min-w-0 flex-1">
        <button
          type="button"
          onClick={() => {
            if (onOpenReplay && item.runId && item.toolCallId) {
              onOpenReplay(item.runId, item.toolCallId, item.toolName);
            }
          }}
          className="inline-flex h-full max-w-full items-center gap-1 overflow-hidden rounded-full border border-border/70 bg-background/85 px-2.5 py-1 text-left transition hover:bg-muted/40"
        >
          <span
            className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${statusUi.iconClass}`}
          >
            <RowIcon
              className={`h-3.5 w-3.5 ${isWebToolRunning ? "animate-spin" : ""}`}
            />
          </span>
          <span className="truncate text-[13px] text-muted-foreground" title={title}>
            {title}
          </span>
        </button>
      </div>
    </div>
  );
}

function GoogleWorkspaceConfirmationPanel({
  confirmation,
  currentSessionId,
  compact = false,
  onApprove,
  onReject,
}: {
  confirmation: GoogleWorkspaceConfirmationView;
  currentSessionId?: string | null;
  compact?: boolean;
  onApprove?: (confirmation: GoogleWorkspaceConfirmationView) => Promise<void> | void;
  onReject?: (confirmation: GoogleWorkspaceConfirmationView) => Promise<void> | void;
}) {
  const [pendingAction, setPendingAction] = useState<"approve" | "reject" | null>(null);
  const disabled =
    Boolean(pendingAction) ||
    !currentSessionId ||
    !confirmation.confirmationId ||
    !onApprove ||
    !onReject;
  const parameterEntries = Object.entries(confirmation.parameterSummary).slice(0, 6);

  const runAction = async (action: "approve" | "reject") => {
    const handler = action === "approve" ? onApprove : onReject;
    if (!handler || disabled) return;
    setPendingAction(action);
    try {
      await handler(confirmation);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error || ""));
    } finally {
      setPendingAction(null);
    }
  };
  const displayConnectorLabel = getMcpConfirmationConnectorDisplayLabel(
    confirmation.connectorKey,
  );
  const displayActionLabel = getMcpConfirmationActionDisplayLabel(confirmation.action);
  const displayImpactText = buildMcpConfirmationImpactText(confirmation);
  const uiText = isChineseUiLocale()
    ? {
        title: "确认高风险操作",
        subtitle: `${displayConnectorLabel} 写操作需要确认`,
        connector: "连接器",
        target: "目标对象",
        action: "动作",
        pending: "待确认",
        targetUnknown: "未识别",
        approve: "确认执行",
        reject: "拒绝",
      }
    : {
        title: "Confirm high-risk operation",
        subtitle: `${displayConnectorLabel} write operation requires confirmation`,
        connector: "Connector",
        target: "Target",
        action: "Action",
        pending: "Pending",
        targetUnknown: "Unknown",
        approve: "Confirm",
        reject: "Reject",
      };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="w-full"
    >
      <div
        className={`max-w-[min(100%,44rem)] rounded-lg border border-amber-300/60 bg-amber-50/80 px-3 py-3 text-amber-950 shadow-sm dark:border-amber-600/45 dark:bg-amber-950/35 dark:text-amber-100 ${
          compact ? "space-y-2" : "space-y-3"
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[12px] font-semibold leading-5">
              {uiText.title}
            </div>
            <div className="truncate text-[11px] leading-5 opacity-75">
              {uiText.subtitle}
            </div>
          </div>
          <span className="shrink-0 rounded-md border border-current/20 px-1.5 py-0.5 text-[10px] font-medium">
            {uiText.pending}
          </span>
        </div>
        <div className="grid gap-2 text-[12px] leading-5 sm:grid-cols-2">
          <div className="min-w-0">
            <div className="text-[10px] font-medium uppercase tracking-[0.16em] opacity-60">
              {uiText.connector}
            </div>
            <div className="truncate" title={displayConnectorLabel}>
              {displayConnectorLabel}
            </div>
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-medium uppercase tracking-[0.16em] opacity-60">
              {uiText.target}
            </div>
            <div className="truncate" title={confirmation.target}>
              {confirmation.target || uiText.targetUnknown}
            </div>
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-medium uppercase tracking-[0.16em] opacity-60">
              {uiText.action}
            </div>
            <div className="truncate" title={displayActionLabel}>
              {displayActionLabel}
            </div>
          </div>
        </div>
        {parameterEntries.length > 0 ? (
          <div className="grid gap-1 text-[11px] leading-5 sm:grid-cols-2">
            {parameterEntries.map(([key, value]) => (
              <div key={key} className="min-w-0 rounded-md bg-background/45 px-2 py-1">
                <span className="mr-1 opacity-60">{getMcpConfirmationParameterLabel(key)}:</span>
                <span className="break-all">{getMcpConfirmationParameterValue(value)}</span>
              </div>
            ))}
          </div>
        ) : null}
        <div className="text-[12px] leading-5 opacity-80">{displayImpactText}</div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            disabled={disabled}
            onClick={() => void runAction("approve")}
          >
            {pendingAction === "approve" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            {uiText.approve}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => void runAction("reject")}
          >
            {pendingAction === "reject" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <X className="h-3.5 w-3.5" />
            )}
            {uiText.reject}
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

function ManagedToolCard({
  item,
  onOpenReplay,
  currentSessionId,
  hiddenGoogleConfirmationIds,
  onApproveGoogleWorkspaceConfirmation,
  onRejectGoogleWorkspaceConfirmation,
}: {
  item: Extract<ChatItem, { kind: "managed_tool" }>;
  onOpenReplay?: (runId: string, toolCallId: string, toolName: string) => void;
  currentSessionId?: string | null;
  hiddenGoogleConfirmationIds?: string[];
  onApproveGoogleWorkspaceConfirmation?: (
    confirmation: GoogleWorkspaceConfirmationView,
  ) => Promise<void> | void;
  onRejectGoogleWorkspaceConfirmation?: (
    confirmation: GoogleWorkspaceConfirmationView,
  ) => Promise<void> | void;
}) {
  const displayName = getManagedToolDisplayName(item.toolName);
  const Icon = getManagedToolIcon(item.toolName);
  const isWebToolRunning =
    item.status === "running" && isManagedWebResearchTool(item.toolName);
  const ToolIcon = isWebToolRunning ? Loader2 : Icon;
  const timelineTitle =
    getManagedToolTimelineTitle(item.toolName, item.metadata, item.status) ||
    displayName;
  const googleConfirmation = readGoogleWorkspaceConfirmation(item.metadata);
  const statusLabel =
    item.status === "failed"
      ? i18n.t("homeWorkspace.failedShort")
      : item.status === "completed"
        ? i18n.t("homeWorkspace.completed")
        : i18n.t("homeWorkspace.inProgress");
  const hoverPreview = buildDetailPreview(
    item.detail || item.summary || item.toolName,
    5,
    96,
  );
  const summaryText = item.summary?.trim();
  const previewText =
    formatManagedToolPreview(item.toolName, item.metadata) ||
    hoverPreview.preview ||
    summaryText ||
    "";
  const statusUi = getManagedToolStatusPresentation(item.status);
  const chipToneClass =
    "border-border/70 bg-card/90 text-foreground/85 hover:bg-muted/40";
  const writeFileProgress = readManagedWriteFileProgress(item.metadata);
  const isWriteFileExpanded = shouldExpandManagedWriteFileCard({
    toolName: item.toolName,
    status: item.status,
    metadata: item.metadata,
  });
  const writeFilePath =
    writeFileProgress.path || summaryText || i18n.t("homeWorkspace.writeFile");
  const writeFileGeneratedLabel =
    writeFileProgress.generatedChars > 0
      ? i18n.t("homeWorkspace.generatedCharsLabel", {
          count: writeFileProgress.generatedChars,
        })
      : i18n.t("homeWorkspace.generatingCode");
  const writeFilePreview =
    writeFileProgress.preview ||
    previewText ||
    i18n.t("homeWorkspace.generatingCodeSnippet");
  const writeFilePreviewRef = useRef<HTMLDivElement | null>(null);
  const todoItems = readManagedTodoItems(item.metadata);

  useEffect(() => {
    if (!isWriteFileExpanded) return;
    const node = writeFilePreviewRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [isWriteFileExpanded, writeFilePreview]);

  if (
    shouldRenderGoogleWorkspaceConfirmation({
      confirmation: googleConfirmation,
      hiddenConfirmationIds: hiddenGoogleConfirmationIds,
    })
  ) {
    return (
      <GoogleWorkspaceConfirmationPanel
        confirmation={{ ...googleConfirmation!, agentRunId: item.runId }}
        currentSessionId={currentSessionId}
        onApprove={onApproveGoogleWorkspaceConfirmation}
        onReject={onRejectGoogleWorkspaceConfirmation}
      />
    );
  }

  if (item.toolName === "todowrite" && todoItems.length > 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18 }}
        className="w-full"
      >
        <button
          type="button"
          onClick={() => {
            if (onOpenReplay && item.runId && item.toolCallId) {
              onOpenReplay(item.runId, item.toolCallId, item.toolName);
            }
          }}
          className={`w-full max-w-[min(100%,42rem)] rounded-2xl border px-4 py-3 text-left transition ${chipToneClass}`}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full shadow-sm ${statusUi.iconClass}`}
              >
                <Sparkles className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0">
                <div className="text-[12px] font-medium leading-5">
                  {displayName}
                </div>
                <div className="truncate text-[11px] leading-5 opacity-75">
                  {summaryText || i18n.t("homeWorkspace.todo")}
                </div>
              </div>
            </div>
            <span
              className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${statusUi.badgeClass}`}
            >
              {statusLabel}
            </span>
          </div>
          <div className="mt-3 space-y-2">
            {todoItems.map((todo, index) => (
              <div
                key={`${todo.content}-${index}`}
                className="flex items-center justify-between gap-3"
              >
                <div className="min-w-0 text-sm text-foreground">
                  <span className="block truncate">{todo.content}</span>
                </div>
                <span
                  className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${getTodoStatusTone(todo.status)}`}
                >
                  {getTodoStatusLabel(todo.status)}
                </span>
              </div>
            ))}
          </div>
        </button>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="w-full"
    >
      <HoverCard openDelay={140} closeDelay={80}>
        <HoverCardTrigger asChild>
          <button
            type="button"
            onClick={() => {
              if (onOpenReplay && item.runId && item.toolCallId) {
                onOpenReplay(item.runId, item.toolCallId, item.toolName);
              }
            }}
            data-managed-tool-layout={
              isWriteFileExpanded ? "expanded" : "compact"
            }
            className={
              isWriteFileExpanded
                ? `group w-full max-w-full lg:max-w-[min(86vw,720px)] rounded-2xl border p-0 text-left transition ${chipToneClass}`
                : `group inline-flex max-w-[min(100%,42rem)] items-center gap-2 rounded-full border px-2.5 py-1.5 text-left transition ${chipToneClass}`
            }
          >
            {isWriteFileExpanded ? (
              <div className="w-full">
                <div className="flex h-[190px] w-full flex-col lg:h-[220px]">
                  <div className="flex items-center justify-between gap-3 border-b border-current/15 px-3 py-2">
                    <div className="min-w-0 flex items-center gap-2">
                      <span
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full shadow-sm ${statusUi.iconClass}`}
                      >
                        <ToolIcon
                          className={`h-3.5 w-3.5 ${isWebToolRunning ? "animate-spin" : ""}`}
                        />
                      </span>
                      <div className="min-w-0">
                        <div className="text-[12px] font-medium leading-5">
                          {i18n.t("homeWorkspace.writeFile")}
                        </div>
                        <div className="truncate text-[11px] leading-5 opacity-75">
                          {writeFilePath}
                        </div>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <span
                        className={`inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${statusUi.badgeClass}`}
                      >
                        {statusLabel}
                      </span>
                      <div className="mt-1 text-[10px] leading-4 opacity-75">
                        {writeFileGeneratedLabel}
                      </div>
                    </div>
                  </div>
                  <div className="flex-1 px-3 py-2">
                    <div
                      ref={writeFilePreviewRef}
                      className="h-[126px] overflow-auto rounded-xl border border-current/15 bg-background/70 px-3 py-2 font-mono text-[11px] leading-5 whitespace-pre-wrap break-all lg:h-[152px]"
                    >
                      {writeFilePreview}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full shadow-sm ${statusUi.iconClass}`}
                >
                  <ToolIcon
                    className={`h-3.5 w-3.5 ${isWebToolRunning ? "animate-spin" : ""}`}
                  />
                </span>
                <span className="min-w-0 flex items-center gap-2 overflow-hidden">
                  <span className="shrink-0 text-[11px] font-medium leading-5">
                    {timelineTitle}
                  </span>
                  <span
                    className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${statusUi.badgeClass}`}
                  >
                    {statusLabel}
                  </span>
                  {summaryText ? (
                    <span className="truncate text-[11px] leading-5 opacity-75">
                      {summaryText}
                    </span>
                  ) : null}
                </span>
              </>
            )}
          </button>
        </HoverCardTrigger>
        <HoverCardContent
          align="start"
          side="top"
          className="w-[380px] rounded-2xl border border-border/80 bg-popover p-0 text-popover-foreground shadow-[0_18px_48px_rgba(0,0,0,0.32)]"
        >
          <div className={`space-y-0 px-4 py-3 ${statusUi.hoverHeaderClass}`}>
            <div className="flex items-center gap-3">
              <div
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl shadow-sm ${statusUi.iconClass}`}
              >
                <ToolIcon
                  className={`h-4 w-4 ${isWebToolRunning ? "animate-spin" : ""}`}
                />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium leading-5">
                    {displayName}
                  </span>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusUi.badgeClass}`}
                  >
                    {statusLabel}
                  </span>
                </div>
                <div className="mt-0.5 text-[11px] leading-5 opacity-70">
                  {item.toolName}
                </div>
              </div>
            </div>
            {summaryText ? (
              <p className="mt-3 text-[12px] leading-5 opacity-85">
                {summaryText}
              </p>
            ) : null}
          </div>
          <div className="space-y-3 px-4 py-3">
            <div className="space-y-1">
              <div className="text-[11px] font-medium uppercase tracking-[0.18em] opacity-55">
                {i18n.t("homeWorkspace.toolResultSummary")}
              </div>
              <p
                className={`whitespace-pre-wrap break-all rounded-xl px-3 py-2 font-mono text-[11px] leading-5 ${statusUi.previewClass}`}
              >
                {previewText}
              </p>
            </div>
            <div className="space-y-1">
              <div className="text-[11px] font-medium uppercase tracking-[0.18em] opacity-55">
                {i18n.t("homeWorkspace.moreInfo")}
              </div>
              <p
                className={`whitespace-pre-wrap break-all text-[12px] leading-5 ${statusUi.detailClass}`}
              >
                {hoverPreview.preview}
              </p>
            </div>
            <div className={`text-[11px] leading-5 ${statusUi.hintClass}`}>
              {i18n.t("homeWorkspace.clickMessageForReplay")}
            </div>
          </div>
        </HoverCardContent>
      </HoverCard>
    </motion.div>
  );
}

/**
 * 获取 Agent 名称
 */
function getAgentName(agent?: string) {
  const nameMap: Record<string, string> = {
    system: i18n.t("homeWorkspace.systemAgent"),
    altus: "Altus",
    intent_recognition: i18n.t("homeWorkspace.intentRecognition"),
    planning: i18n.t("homeWorkspace.taskPlanning"),
    execution_plan: i18n.t("homeWorkspace.executionPlan"),
  };
  return agent ? nameMap[agent] || agent : i18n.t("homeWorkspace.agentLabel");
}

function resolveAgentDisplayName(input: {
  agent?: string;
  metadata?: unknown;
  messageKey?: string;
}) {
  const metadata = toRecord(input.metadata);
  const rawAgent = asText(input.agent).toLowerCase();
  const messageKey = asText(input.messageKey);
  if (
    rawAgent === "altus" ||
    asText(metadata.executor).toLowerCase() === "altus" ||
    asText(metadata.executionMode).toLowerCase() === "managed" ||
    messageKey.startsWith("managed:")
  ) {
    return "Altus";
  }
  return getAgentName(input.agent);
}

function getExecutorDisplayName(metadataRaw: unknown) {
  const metadata = toRecord(metadataRaw);
  const executor = asText(metadata.executor).toLowerCase();
  if (executor === "codex") return "Codex";
  if (executor === "altus") return "Altus";
  if (executor === "opencode") return "OpenCode";
  return i18n.t("homeWorkspace.executorLabel");
}

function isManagedExecutionEvent(metadataRaw: unknown) {
  const metadata = toRecord(metadataRaw);
  return (
    asText(metadata.executionMode).toLowerCase() === "managed" ||
    asText(metadata.executor).toLowerCase() === "altus"
  );
}

function extractManagedDeliverables(
  metadataRaw: unknown,
): TaskCreationDeliverableArtifact[] {
  const metadata = toRecord(metadataRaw);
  const raw = Array.isArray(metadata.deliverables) ? metadata.deliverables : [];
  const unique = new Map<string, TaskCreationDeliverableArtifact>();
  for (const item of raw) {
    const record = toRecord(item);
    const id = asText(record.id);
    const name = asText(record.name);
    if (!id || !name || unique.has(id)) continue;
    const sizeValue =
      typeof record.size === "number"
        ? record.size
        : typeof record.sizeBytes === "number"
          ? record.sizeBytes
          : Number(record.size || record.sizeBytes || 0);
    unique.set(id, {
      id,
      runId: asText(record.runId) || asText(metadata.runId),
      path: asText(record.path),
      name,
      mimeType: asText(record.mimeType) || "application/octet-stream",
      size: Number.isFinite(sizeValue) ? sizeValue : 0,
      createdAt: asText(record.createdAt) || undefined,
      downloadPath: asText(record.downloadPath) || undefined,
    });
  }
  return Array.from(unique.values());
}

function collectManagedWebArtifacts(input: {
  deliverables: TaskCreationDeliverableArtifact[];
  managedArtifacts: AltusArtifactFile[];
}): AltusArtifactFile[] {
  const unique = new Map<string, AltusArtifactFile>();
  const pushArtifact = (
    pathRaw: string,
    previewType?: AltusArtifactFile["previewType"],
  ) => {
    const path = String(pathRaw || "")
      .trim()
      .replace(/\\/g, "/");
    if (!path) return;
    const resolvedPreviewType =
      previewType || inferManagedArtifactPreviewType(path);
    if (resolvedPreviewType !== "web") return;
    if (unique.has(path)) return;
    unique.set(path, {
      path,
      previewType: "web",
    });
  };

  for (const deliverable of input.deliverables) {
    pushArtifact(deliverable.path);
  }
  for (const artifact of input.managedArtifacts) {
    pushArtifact(artifact.path, artifact.previewType);
  }

  return Array.from(unique.values());
}

function extractManagedPreviewSnapshot(
  metadataRaw: unknown,
): TaskCreationWebsitePreviewSnapshot | null {
  const metadata = toRecord(metadataRaw);
  const raw = toRecord(metadata.previewSnapshot);
  const status = asText(raw.status);
  if (
    raw.kind !== "website_screenshot" ||
    ![
      "captured",
      "capture_unavailable",
      "capture_failed",
      "storage_failed",
    ].includes(status)
  ) {
    return null;
  }
  const source = toRecord(raw.source);
  const portValue = Number(source.port);
  const widthValue = Number(raw.width);
  const heightValue = Number(raw.height);
  return {
    kind: "website_screenshot",
    status: status as TaskCreationWebsitePreviewSnapshot["status"],
    storageKey: asText(raw.storageKey) || undefined,
    mimeType: raw.mimeType === "image/png" ? "image/png" : undefined,
    width: Number.isFinite(widthValue) ? widthValue : undefined,
    height: Number.isFinite(heightValue) ? heightValue : undefined,
    capturedAt: asText(raw.capturedAt) || undefined,
    reasonCode: asText(raw.reasonCode) || undefined,
    message: asText(raw.message) || undefined,
    visualCheck: (() => {
      const visualCheck = toRecord(raw.visualCheck);
      const visualStatus = asText(visualCheck.status);
      if (visualStatus !== "passed" && visualStatus !== "failed") {
        return undefined;
      }
      return {
        status: visualStatus as "passed" | "failed",
        reasonCode: asText(visualCheck.reasonCode) || undefined,
        message: asText(visualCheck.message) || undefined,
        diagnostics: toRecord(visualCheck.diagnostics),
      };
    })(),
    source: {
      sandboxId: asText(source.sandboxId) || undefined,
      port: Number.isFinite(portValue) ? portValue : undefined,
      url: asText(source.url) || undefined,
      command: asText(source.command) || undefined,
      logPath: asText(source.logPath) || undefined,
    },
  };
}

function isPassedManagedBrowserScreenshot(
  screenshot: AltusReplayAction["browserScreenshot"],
) {
  return Boolean(
    screenshot?.status === "captured" &&
      screenshot.storageKey &&
      screenshot.visualCheck?.status === "passed",
  );
}

function findPassedBrowserScreenshotFallback(input: {
  runId: string;
  messageMetadata: Record<string, unknown>;
  browserScreenshotsByRun?: Map<
    string,
    Array<{
      toolCallId: string;
      screenshot: NonNullable<AltusReplayAction["browserScreenshot"]>;
    }>
  >;
}) {
  const directToolCallId = asText(input.messageMetadata.toolCallId);
  const directScreenshot = readManagedBrowserScreenshot(input.messageMetadata);
  if (directToolCallId && isPassedManagedBrowserScreenshot(directScreenshot)) {
    return {
      toolCallId: directToolCallId,
      screenshot: directScreenshot as NonNullable<AltusReplayAction["browserScreenshot"]>,
    };
  }

  const screenshots = input.browserScreenshotsByRun?.get(input.runId) || [];
  return screenshots.find((item) => isPassedManagedBrowserScreenshot(item.screenshot)) || null;
}

export function buildManagedCompletionCardItem(input: {
  message: AgentMessage;
  managedArtifactsByRun: Map<string, AltusArtifactFile[]>;
  emittedManagedCompletionRuns: Set<string>;
  browserScreenshotsByRun?: Map<
    string,
    Array<{
      toolCallId: string;
      screenshot: NonNullable<AltusReplayAction["browserScreenshot"]>;
    }>
  >;
}): ChatItem | null {
  const { message, managedArtifactsByRun, emittedManagedCompletionRuns } =
    input;
  const metadata = toRecord(message.metadata);
  if (!isManagedExecutionEvent(metadata)) {
    return null;
  }

  const runId = asText(metadata.runId);
  const sessionId = asText(message.sessionId) || asText(metadata.sessionId);
  if (!runId || !sessionId || emittedManagedCompletionRuns.has(runId)) {
    return null;
  }

  const eventType = asText(metadata.eventType).toLowerCase();
  const deliverables = extractManagedDeliverables(metadata);
  const previewSnapshot = extractManagedPreviewSnapshot(metadata);
  const browserScreenshotFallback = findPassedBrowserScreenshotFallback({
    runId,
    messageMetadata: metadata,
    browserScreenshotsByRun: input.browserScreenshotsByRun,
  });
  const managedArtifacts = managedArtifactsByRun.get(runId) || [];
  const webArtifacts = collectManagedWebArtifacts({
    deliverables,
    managedArtifacts,
  });
  const shouldEmitFromDeliverablesContext = deliverables.length > 0;
  const hasPreviewSnapshot = Boolean(previewSnapshot);
  const isRunCompletedContext =
    message.type === "status_update" && eventType === "run_completed";
  if (
    (shouldEmitFromDeliverablesContext || isRunCompletedContext || hasPreviewSnapshot) &&
    (webArtifacts.length > 0 || hasPreviewSnapshot)
  ) {
    emittedManagedCompletionRuns.add(runId);
    return {
      kind: "managed_artifact_card",
      sessionId,
      runId,
      artifacts: webArtifacts,
      previewSnapshot,
      browserScreenshotFallback,
      messageKey: `managed:${runId}:artifact_card`,
    };
  }

  if (deliverables.length > 0) {
    emittedManagedCompletionRuns.add(runId);
    return {
      kind: "managed_deliverable_card",
      sessionId,
      runId,
      deliverables,
      messageKey: `managed:${runId}:deliverable_card`,
    };
  }

  if (!isRunCompletedContext) {
    return null;
  }

  if (webArtifacts.length === 0 && !hasPreviewSnapshot) {
    return null;
  }

  emittedManagedCompletionRuns.add(runId);
  return {
    kind: "managed_artifact_card",
    sessionId,
    runId,
    artifacts: webArtifacts,
    previewSnapshot,
    browserScreenshotFallback,
    messageKey: `managed:${runId}:artifact_card`,
  };
}

function parseManagedToolOutputPreview(
  outputPreviewRaw: unknown,
): Record<string, unknown> {
  if (!outputPreviewRaw) return {};
  if (typeof outputPreviewRaw === "string") {
    const trimmed = outputPreviewRaw.trim();
    if (!trimmed) return {};
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return toRecord(parsed);
    } catch {
      return {};
    }
  }
  return toRecord(outputPreviewRaw);
}

function readManagedToolViewProjection(metadataRaw: unknown) {
  const metadata = toRecord(metadataRaw);
  const userView = toRecord(metadata.userView);
  const internalView = toRecord(metadata.internalView);
  return {
    userSummary: asText(userView.summary),
    userPreview: asText(userView.preview),
    userDetail: asText(userView.detail),
    internalDetail: asText(internalView.detail),
  };
}

function readGoogleWorkspaceConfirmation(metadataRaw: unknown) {
  const metadata = toRecord(metadataRaw);
  const confirmation = toGoogleWorkspaceConfirmationView(
    extractGoogleWorkspaceConfirmationPayload(
      parseManagedToolOutputPreview(metadata.outputPreview),
    ),
  );
  if (!confirmation) return null;
  const statuses = toRecord(metadata.mcpToolConfirmationStatuses);
  return {
    ...confirmation,
    status: normalizeMcpConfirmationStatus(statuses[confirmation.confirmationId]),
  };
}

function readGoogleWorkspaceConfirmationFromOpencodeEvent(input: {
  metadata?: Record<string, unknown>;
  output?: unknown;
  content?: unknown;
  properties?: Record<string, unknown>;
  part?: Record<string, unknown>;
  toolState?: Record<string, unknown>;
}) {
  const payload = extractGoogleWorkspaceConfirmationPayload([
    input.toolState,
    input.part,
    input.properties,
    input.metadata,
    input.output,
    input.content,
  ]);
  const confirmation = toGoogleWorkspaceConfirmationView(payload);
  if (!confirmation) return null;
  const statuses = toRecord(input.metadata?.mcpToolConfirmationStatuses);
  return {
    ...confirmation,
    status:
      normalizeMcpConfirmationStatus(statuses[confirmation.confirmationId]) ||
      normalizeMcpConfirmationStatus(toRecord(payload).status),
  };
}

function extractGoogleWorkspaceConfirmationPayload(
  raw: unknown,
): Record<string, unknown> | null {
  const visit = (value: unknown, depth = 0): Record<string, unknown> | null => {
    if (depth > 6 || value == null) return null;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return null;
      try {
        return visit(JSON.parse(trimmed), depth + 1);
      } catch {
        return null;
      }
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item, depth + 1);
        if (found) return found;
      }
      return null;
    }
    if (typeof value !== "object") return null;
    const record = toRecord(value);
    if (
      asText(record.type) === "confirmation_required" &&
      asText(record.confirmationId) &&
      asText(record.toolName)
    ) {
      return record;
    }

    const directKeys = [
      "structuredContent",
      "result",
      "outputPreview",
      "output",
      "content",
      "rawPayload",
      "event",
      "properties",
      "part",
      "state",
      "data",
    ];
    for (const key of directKeys) {
      const found = visit(record[key], depth + 1);
      if (found) return found;
    }

    const contentItems = Array.isArray(record.content) ? record.content : [];
    for (const item of contentItems) {
      const found =
        visit(toRecord(item).text, depth + 1) || visit(item, depth + 1);
      if (found) return found;
    }

    return null;
  };

  return visit(raw);
}

function toGoogleWorkspaceConfirmationView(
  payload: Record<string, unknown> | null,
): GoogleWorkspaceConfirmationView | null {
  const direct = toRecord(payload);
  if (!asText(direct.confirmationId) || !asText(direct.toolName)) return null;
  const summary = toRecord(direct.summary);
  return {
    confirmationId: asText(direct.confirmationId),
    connectorKey: asText(direct.connectorKey),
    toolName: asText(direct.toolName),
    action: asText(summary.action),
    target: asText(summary.target),
    impact: asText(summary.impact),
    parameterSummary: toRecord(summary.parameterSummary),
    status: normalizeMcpConfirmationStatus(direct.status),
  };
}

function collectManagedReplayArtifactPaths(
  toolName: string,
  metadataRaw: unknown,
): string[] {
  const metadata = toRecord(metadataRaw);
  const args = toRecord(metadata.arguments);
  const output = parseManagedToolOutputPreview(metadata.outputPreview);
  const paths = new Set<string>();
  const pushPath = (value: unknown) => {
    const path = asText(value).replace(/\\/g, "/");
    if (!path) return;
    paths.add(path);
  };

  if (toolName === "write_file" || toolName === "read_file") {
    pushPath(args.path);
    pushPath(output.path);
  }

  if (
    toolName === "complete_task" &&
    Array.isArray((args as { attachments?: unknown[] }).attachments)
  ) {
    for (const item of (args as { attachments?: unknown[] }).attachments ||
      []) {
      const record = toRecord(item);
      pushPath(record.path);
      pushPath(record.filePath);
    }
  }

  return Array.from(paths);
}

function readManagedBrowserScreenshot(metadataRaw: unknown) {
  const metadata = toRecord(metadataRaw);
  const raw = toRecord(metadata.browserScreenshot);
  const status = asText(raw.status);
  if (
    raw.type !== "browser_screenshot" ||
    raw.kind !== "browser_action_screenshot" ||
    !["captured", "capture_failed", "storage_failed"].includes(status)
  ) {
    return null;
  }
  const source = toRecord(raw.source);
  const visualCheck = toRecord(raw.visualCheck);
  const visualStatus = asText(visualCheck.status);
  const toNumber = (value: unknown) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
  };
  return {
    type: "browser_screenshot" as const,
    kind: "browser_action_screenshot" as const,
    status: status as "captured" | "capture_failed" | "storage_failed",
    storageKey: asText(raw.storageKey) || undefined,
    mimeType: raw.mimeType === "image/png" ? "image/png" as const : undefined,
    width: toNumber(raw.width),
    height: toNumber(raw.height),
    capturedAt: asText(raw.capturedAt) || undefined,
    reasonCode: asText(raw.reasonCode) || undefined,
    message: asText(raw.message) || undefined,
    visualCheck:
      visualStatus === "passed" || visualStatus === "failed"
        ? {
            status: visualStatus as "passed" | "failed",
            reasonCode: asText(visualCheck.reasonCode) || undefined,
            message: asText(visualCheck.message) || undefined,
            diagnostics: toRecord(visualCheck.diagnostics),
          }
        : undefined,
    source: {
      sandboxId: asText(source.sandboxId) || undefined,
      cdpPort: toNumber(source.cdpPort),
      url: asText(source.url) || undefined,
      title: asText(source.title) || undefined,
      toolName: asText(source.toolName) || undefined,
      action: asText(source.action) || undefined,
      description: asText(source.description) || undefined,
    },
  };
}

export function buildManagedReplayData(messages: AgentMessage[]) {
  const actionsByRun = new Map<string, AltusReplayAction[]>();
  const filesByRun = new Map<string, AltusReplayFile[]>();
  const diffItemsByRun = new Map<string, PreviewDiffItem[]>();
  const actionIndexByRun = new Map<string, Map<string, number>>();
  const fileIndexByRun = new Map<string, Map<string, AltusReplayFile>>();
  const diffIndexByRun = new Map<string, Map<string, PreviewDiffItem>>();

  const ensureActions = (runId: string) => {
    const existing = actionsByRun.get(runId);
    if (existing) return existing;
    const created: AltusReplayAction[] = [];
    actionsByRun.set(runId, created);
    actionIndexByRun.set(runId, new Map<string, number>());
    return created;
  };

  const ensureFiles = (runId: string) => {
    const existing = filesByRun.get(runId);
    if (existing) return existing;
    const created: AltusReplayFile[] = [];
    filesByRun.set(runId, created);
    fileIndexByRun.set(runId, new Map<string, AltusReplayFile>());
    return created;
  };

  const ensureDiffItems = (runId: string) => {
    const existing = diffItemsByRun.get(runId);
    if (existing) return existing;
    const created: PreviewDiffItem[] = [];
    diffItemsByRun.set(runId, created);
    diffIndexByRun.set(runId, new Map<string, PreviewDiffItem>());
    return created;
  };

  const upsertFile = (
    runId: string,
    pathRaw: string,
    sourceToolCallId?: string,
    sourceStepIndex?: number,
  ) => {
    const path = pathRaw.trim().replace(/\\/g, "/");
    if (!path) return;
    if (isManagedInternalSupportArtifact(path)) return;
    const files = ensureFiles(runId);
    const index = fileIndexByRun.get(runId)!;
    if (index.has(path)) {
      const existing = index.get(path)!;
      if (typeof sourceStepIndex === "number") {
        existing.lastSourceStepIndex = sourceStepIndex;
      }
      if (sourceToolCallId) {
        existing.lastSourceToolCallId = sourceToolCallId;
      }
      return;
    }
    const file: AltusReplayFile = {
      path,
      displayName: getFilename(path) || path,
      previewType: inferManagedArtifactPreviewType(path),
      lastSourceToolCallId: sourceToolCallId,
      lastSourceStepIndex: sourceStepIndex,
    };
    files.push(file);
    index.set(path, file);
  };

  const upsertDiffItem = (
    runId: string,
    metadata: Record<string, unknown>,
    action: AltusReplayAction,
    message: AgentMessage,
    eventIndex: number,
  ) => {
    if (action.toolName !== "write_file") return;
    const path = extractManagedArtifactPath(action.toolName, metadata)
      .trim()
      .replace(/\\/g, "/");
    if (!path) return;
    if (isManagedInternalSupportArtifact(path)) return;

    const output = parseManagedToolOutputPreview(metadata.outputPreview);
    const args = toRecord(metadata.arguments);
    const progress = readManagedWriteFileProgress(metadata);
    const rawPreview =
      progress.preview ||
      asText(args.content) ||
      asText(output.content) ||
      asText(output.preview) ||
      asText(output.text);
    const preview = truncateText(rawPreview, 4000).text;
    const byteCount =
      typeof output.bytes === "number" && Number.isFinite(output.bytes)
        ? `${output.bytes}`
        : asText(output.bytes);
    const fallbackDetails = [
      `${i18n.t("homeWorkspace.targetFileLabel")}: ${path}`,
      byteCount ? `Bytes: ${byteCount}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    const diffItems = ensureDiffItems(runId);
    const index = diffIndexByRun.get(runId)!;
    const key = `${action.toolCallId}:${path}`;
    const title = `${action.displayName} · ${getFilename(path) || path}`;
    const item: PreviewDiffItem = {
      id: `managed:${runId}:${action.toolCallId}:${path}`,
      title,
      diff: preview || fallbackDetails || undefined,
      files: [
        {
          file: path,
          before: "",
          after: preview,
          status: "modified",
        },
      ],
      source: "managed.write_file",
      createdAt:
        asText(metadata.createdAt) || asText(metadata.timestamp) || null,
      eventMessageKey: message.messageKey || null,
      relatedMessageKeys: message.messageKey ? [message.messageKey] : [],
      eventIndex,
      relatedEventIndexes: [eventIndex],
      canonicalFile: path,
    };

    if (index.has(key)) {
      Object.assign(index.get(key)!, item);
      return;
    }
    index.set(key, item);
    diffItems.push(item);
  };

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.type !== "executor_event") continue;
    const metadata = toRecord(message.metadata);
    if (!isManagedExecutionEvent(metadata)) continue;
    const runId = asText(metadata.runId);
    if (!runId) continue;
    const eventType = asText(metadata.eventType).toLowerCase();
    if (
      eventType !== "tool_call_started" &&
      eventType !== "tool_call_progress" &&
      eventType !== "tool_call_completed" &&
      eventType !== "tool_call_failed"
    ) {
      continue;
    }

    const toolCallId =
      asText(metadata.toolCallId) ||
      message.messageKey ||
      `${runId}:${eventType}:${index}`;
    const toolName = asText(metadata.toolName) || "tool";
    const actions = ensureActions(runId);
    const actionIndex = actionIndexByRun.get(runId)!;
    let stepIndex = actionIndex.get(toolCallId);
    if (stepIndex === undefined) {
      stepIndex = actions.length;
      actionIndex.set(toolCallId, stepIndex);
      actions.push({
        runId,
        toolCallId,
        stepIndex,
        toolName,
        displayName: getManagedToolDisplayName(toolName),
        status:
          eventType === "tool_call_failed"
            ? "failed"
            : eventType === "tool_call_completed"
              ? "completed"
              : "running",
        summary: formatManagedToolSummary(toolName, metadata),
        detail: formatManagedToolDetail(toolName, metadata),
        internalDetail:
          formatManagedToolInternalDetail(toolName, metadata) || undefined,
        artifactPaths: collectManagedReplayArtifactPaths(toolName, metadata),
        browserScreenshot: readManagedBrowserScreenshot(metadata),
      });
    } else {
      const action = actions[stepIndex];
      actions[stepIndex] = {
        ...action,
        status:
          eventType === "tool_call_failed"
            ? "failed"
            : eventType === "tool_call_completed"
              ? "completed"
              : action.status === "completed" || action.status === "failed"
                ? action.status
                : "running",
        summary: formatManagedToolSummary(toolName, metadata),
        detail: formatManagedToolDetail(toolName, metadata),
        internalDetail:
          formatManagedToolInternalDetail(toolName, metadata) || undefined,
        artifactPaths: collectManagedReplayArtifactPaths(toolName, metadata),
        browserScreenshot: readManagedBrowserScreenshot(metadata) || action.browserScreenshot,
      };
    }

    const action = actions[stepIndex];
    for (const path of action.artifactPaths) {
      upsertFile(runId, path, action.toolCallId, action.stepIndex);
    }
    if (eventType === "tool_call_completed") {
      upsertDiffItem(runId, metadata, action, message, index);
    }
  }

  return new Map(
    Array.from(actionsByRun.entries()).map(([runId, actions]) => [
      runId,
      {
        runId,
        actions,
        files: filesByRun.get(runId) || [],
        diffItems: diffItemsByRun.get(runId) || [],
      },
    ]),
  );
}

function inferManagedArtifactPreviewType(
  path: string,
): AltusArtifactFile["previewType"] {
  return /\.(html?)$/i.test(path) ? "web" : "code";
}

export function resolveManagedToolReplayView(
  toolName: string,
): AltusDrawerView {
  if (toolName === "debug_open_page" || toolName === "browser_interact") {
    return "debug";
  }
  if (isManagedDeploymentTool(toolName)) {
    return "deployment";
  }
  return "actions";
}

export function findLatestManagedVisualDebugAction(
  replay:
    | {
        actions: AltusReplayAction[];
      }
    | null
    | undefined,
): AltusReplayAction | null {
  if (!replay) return null;
  for (let index = replay.actions.length - 1; index >= 0; index -= 1) {
    const action = replay.actions[index];
    if (
      action &&
      action.status !== "failed" &&
      resolveManagedToolReplayView(action.toolName) === "debug"
    ) {
      return action;
    }
  }
  return null;
}

export function getManagedVisualDebugActionKey(action: AltusReplayAction) {
  return `${action.runId}:${action.toolCallId}`;
}

export function seedManagedVisualDebugActionKeys(
  target: Set<string>,
  replayByRun: Map<
    string,
    {
      actions: AltusReplayAction[];
    }
  >,
) {
  for (const replay of Array.from(replayByRun.values())) {
    for (const action of replay.actions) {
      if (resolveManagedToolReplayView(action.toolName) === "debug") {
        target.add(getManagedVisualDebugActionKey(action));
      }
    }
  }
}

function isManagedDeploymentTool(toolName: string) {
  return (
    toolName === "deploy_application" ||
    toolName === "redeploy_application" ||
    toolName === "rollback_application_deployment" ||
    toolName === "get_application_deployment_status"
  );
}

function readManagedDeploymentToolOutput(metadataRaw: unknown) {
  const metadata = toRecord(metadataRaw);
  const output = parseManagedToolOutputPreview(metadata.outputPreview);
  const repair = toRecord(output.repair);
  return {
    action: asText(output.action),
    phase: asText(output.phase),
    status: asText(output.status),
    summary: asText(output.summary),
    deploymentStatus: asText(output.deploymentStatus),
    url: asText(output.url),
    deploymentId: asText(output.deploymentId),
    repairCategory: asText(repair.category),
  };
}

function buildManagedBrowserInteractPurpose(args: Record<string, unknown>) {
  const action = asText(args.action).toLowerCase();
  const description = asText(args.description);
  if (description) return description;
  const selector = asText(args.selector);
  const text = asText(args.text);
  const key = asText(args.key);
  const direction = asText(args.direction).toLowerCase() || "down";
  const loadState = asText(args.loadState) || "domcontentloaded";
  const pixelsRaw = Number(args.pixels);
  const target = text || selector;

  if (action === "locator_click") {
    return selector ? `点击 ${selector}` : "点击页面元素";
  }
  if (action === "text_click") {
    return text ? `点击 ${text}` : "点击指定文本";
  }
  if (action === "coordinate_click") {
    return "点击页面指定位置";
  }
  if (action === "locator_fill") {
    if (selector && text) return `在 ${selector} 输入“${text}”`;
    return selector ? `填写 ${selector}` : "填写表单输入框";
  }
  if (action === "keyboard_type") {
    return text ? `键盘输入“${text}”` : "键盘输入文本";
  }
  if (action === "keyboard_press") {
    return key ? `按下 ${key} 键` : "按下键盘按键";
  }
  if (action === "mouse_wheel") {
    const directionLabel =
      direction === "up"
        ? "向上滚动"
        : direction === "left"
          ? "向左滚动"
          : direction === "right"
            ? "向右滚动"
            : "向下滚动";
    return Number.isFinite(pixelsRaw) && pixelsRaw > 0
      ? `${directionLabel} ${Math.floor(pixelsRaw)} 像素`
      : directionLabel;
  }
  if (action === "wait_for_locator") {
    return selector ? `等待 ${selector} 可见` : "等待页面元素可见";
  }
  if (action === "wait_for_text") {
    return text ? `等待页面出现“${text}”` : "等待页面出现指定内容";
  }
  if (action === "wait_for_load_state") {
    return `等待页面进入 ${loadState} 状态`;
  }
  if (action === "wait_for_timeout") {
    return "等待页面稳定";
  }
  return target ? `执行 Playwright 操作：${target}` : "执行 Playwright 视觉检测";
}

export function getManagedToolPurposeSummary(
  toolName: string,
  metadataRaw: unknown,
) {
  const metadata = toRecord(metadataRaw);
  const args = readManagedToolArguments(metadata);
  const output = parseManagedToolOutputPreview(metadata.outputPreview);
  const progress = readManagedWriteFileProgress(metadata);
  const path = asText(args.path) || asText(output.path) || progress.path;
  const command = asText(args.command);
  const query = asText(args.query);
  const target = asText(args.path) || asText(output.path);
  const filename = path ? getFilename(path) || path : "";

  if (toolName === "shell_execute") {
    if (/pnpm|npm|yarn|tsc|typecheck|type-check|check|test|vitest|playwright/i.test(command)) {
      return "检查项目是否正常运行";
    }
    if (/ls|find|tree|pwd|cat|sed|tail|head|rg|grep/i.test(command)) {
      return "检查项目文件和运行日志";
    }
    if (/dev|serve|preview|start|node|vite/i.test(command)) {
      return "启动或检查本地预览服务";
    }
    return "执行项目命令";
  }

  if (toolName === "write_file") {
    if (isManagedInternalSupportArtifact(path)) return "";
    if (filename) return `更新${filename}`;
    return "更新项目文件";
  }

  if (toolName === "read_file") {
    if (isManagedInternalSupportArtifact(path)) return "";
    if (filename) return `读取${filename}检查内容`;
    return "读取项目文件";
  }

  if (toolName === "list_directory") {
    if (target) return "检查项目目录结构";
    return "查看项目目录";
  }

  if (toolName === "search_code") {
    if (query) return "搜索相关代码位置";
    return "搜索项目代码";
  }

  if (toolName === "web_search") {
    return formatManagedWebSearchTitle(metadata, "idle");
  }

  if (toolName === "web_extract") {
    return formatManagedWebExtractTitle(metadata, "idle");
  }

  if (toolName === "todowrite") {
    const todos = readManagedTodoItems(metadataRaw);
    const activeTodo = todos.find((todo) => todo.status === "in_progress");
    if (activeTodo) return activeTodo.activeForm || activeTodo.content;
    return "更新任务清单";
  }

  if (toolName === "browser_interact") {
    return buildManagedBrowserInteractPurpose(args);
  }

  if (toolName === "debug_open_page") {
    const url = asText(args.url) || asText(output.targetUrl) || asText(output.url);
    return url ? `视觉检测：打开 ${url}` : "视觉检测：打开页面";
  }

  if (toolName === "ask_user") {
    return "请求补充必要信息";
  }

  if (isManagedDeploymentTool(toolName)) {
    const projectedView = readManagedToolViewProjection(metadata);
    const deploymentOutput = readManagedDeploymentToolOutput(metadata);
    if (projectedView.userSummary) return projectedView.userSummary;
    if (deploymentOutput.summary) return deploymentOutput.summary;
    if (toolName === "get_application_deployment_status") return "检查部署状态";
    if (toolName === "rollback_application_deployment") return "回滚部署版本";
    if (toolName === "redeploy_application") return "重新部署应用";
    return "部署应用";
  }

  if (toolName === "complete_task") {
    return "完成任务并整理结果";
  }

  return getManagedToolDisplayName(toolName);
}

export function getManagedToolTimelineTitle(
  toolName: string,
  metadataRaw: unknown,
  status?: string,
) {
  const phase =
    status === "running"
      ? "running"
      : status === "completed"
        ? "completed"
        : "idle";
  const metadata = toRecord(metadataRaw);
  if (toolName === "web_search") {
    return formatManagedWebSearchTitle(metadata, phase);
  }
  if (toolName === "web_extract") {
    return formatManagedWebExtractTitle(metadata, phase);
  }
  return getManagedToolPurposeSummary(toolName, metadataRaw);
}

function readManagedToolArguments(metadataRaw: unknown) {
  const metadata = toRecord(metadataRaw);
  const args = toRecord(metadata.arguments);
  if (Object.keys(args).length > 0) return args;
  const rawArguments = parseManagedToolOutputPreview(metadata.rawArguments);
  if (Object.keys(rawArguments).length > 0) return rawArguments;
  return {};
}

function readStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => asText(item)).filter(Boolean);
  }
  const text = asText(value);
  if (!text) return [];
  if (text.startsWith("[") && text.endsWith("]")) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((item) => asText(item)).filter(Boolean);
      }
    } catch {
      return [text];
    }
  }
  return [text];
}

function compactManagedToolSubject(value: string, maxLength = 58) {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function formatManagedUrlSubject(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "") || url;
  } catch {
    return compactManagedToolSubject(url, 44);
  }
}

function readManagedWebToolContext(metadataRaw: unknown) {
  const metadata = toRecord(metadataRaw);
  const args = readManagedToolArguments(metadata);
  const output = parseManagedToolOutputPreview(metadata.outputPreview);
  const query = asText(args.query) || asText(output.query);
  const urls = Array.from(
    new Set([
      ...readStringList(args.urls),
      ...readStringList(output.urls),
    ].filter(Boolean)),
  );
  return {
    query: compactManagedToolSubject(query),
    urls,
    firstUrlLabel: urls[0] ? formatManagedUrlSubject(urls[0]) : "",
  };
}

function formatManagedWebSearchTitle(
  metadataRaw: unknown,
  phase: "running" | "completed" | "idle",
) {
  const { query } = readManagedWebToolContext(metadataRaw);
  const prefix =
    phase === "running"
      ? "正在联网搜索"
      : phase === "completed"
        ? "已联网搜索"
        : "联网搜索";
  return query ? `${prefix}：${query}` : `${prefix}内容`;
}

function formatManagedWebExtractTitle(
  metadataRaw: unknown,
  phase: "running" | "completed" | "idle",
) {
  const { urls, firstUrlLabel } = readManagedWebToolContext(metadataRaw);
  const prefix =
    phase === "running"
      ? "正在解析网页内容"
      : phase === "completed"
        ? "已解析网页内容"
        : "解析网页内容";
  if (firstUrlLabel && urls.length > 1) {
    return `${prefix}：${firstUrlLabel} 等 ${urls.length} 个页面`;
  }
  return firstUrlLabel ? `${prefix}：${firstUrlLabel}` : prefix;
}

function extractManagedArtifactPath(
  toolName: string,
  metadataRaw: unknown,
): string {
  if (toolName !== "write_file") return "";
  const metadata = toRecord(metadataRaw);
  const args = toRecord(metadata.arguments);
  const output = parseManagedToolOutputPreview(metadata.outputPreview);
  return asText(args.path) || asText(output.path);
}

function getManagedToolDisplayName(toolName: string) {
  switch (toolName) {
    case "shell_execute":
      return i18n.t("homeWorkspace.commandExecution");
    case "todowrite":
      return i18n.t("homeWorkspace.todo");
    case "write_file":
      return i18n.t("homeWorkspace.writeFile");
    case "read_file":
      return i18n.t("homeWorkspace.readFile");
    case "list_directory":
      return i18n.t("homeWorkspace.listDirectory");
    case "search_code":
      return i18n.t("homeWorkspace.codeSearch");
    case "web_search":
      return "联网搜索";
    case "web_extract":
      return "解析网页内容";
    case "ask_user":
      return i18n.t("homeWorkspace.requestClarification");
    case "debug_open_page":
      return "视觉检测：打开页面";
    case "browser_interact":
      return "视觉检测步骤";
    case "deploy_application":
      return i18n.t("homeWorkspace.deployApplication");
    case "redeploy_application":
      return i18n.t("homeWorkspace.redeployApplication");
    case "rollback_application_deployment":
      return i18n.t("homeWorkspace.rollbackDeployment");
    case "get_application_deployment_status":
      return i18n.t("homeWorkspace.deploymentStatus");
    case "complete_task":
      return i18n.t("homeWorkspace.completeTask");
    default:
      return toolName || i18n.t("homeWorkspace.toolCall");
  }
}

export function shouldExpandManagedWriteFileCard(input: {
  toolName: string;
  status: string;
  metadataRaw?: unknown;
  metadata?: unknown;
}) {
  if (input.toolName !== "write_file") return false;
  if (input.status !== "running") return false;
  const metadata = toRecord(input.metadataRaw ?? input.metadata);
  const progress = toRecord(metadata.writeFileProgress);
  const generatedCharsRaw = progress.generatedChars;
  const generatedChars =
    typeof generatedCharsRaw === "number" && Number.isFinite(generatedCharsRaw)
      ? generatedCharsRaw
      : typeof generatedCharsRaw === "string" && generatedCharsRaw.trim()
        ? Number(generatedCharsRaw)
        : 0;
  const preview = asText(progress.preview);
  return generatedChars > 0 || Boolean(preview);
}

function readManagedWriteFileProgress(metadataRaw: unknown) {
  const metadata = toRecord(metadataRaw);
  const progress = toRecord(metadata.writeFileProgress);
  const path = asText(progress.path);
  const generatedCharsRaw = progress.generatedChars;
  const generatedChars =
    typeof generatedCharsRaw === "number" && Number.isFinite(generatedCharsRaw)
      ? Math.max(0, Math.floor(generatedCharsRaw))
      : typeof generatedCharsRaw === "string" && generatedCharsRaw.trim()
        ? Math.max(0, Math.floor(Number(generatedCharsRaw)))
        : 0;
  const preview = asText(progress.preview);
  return {
    path,
    generatedChars,
    preview,
  };
}

function readManagedTodoItems(metadataRaw: unknown) {
  const metadata = toRecord(metadataRaw);
  const args = toRecord(metadata.arguments);
  const output = parseManagedToolOutputPreview(metadata.outputPreview);
  const normalize = (raw: unknown) =>
    Array.isArray(raw)
      ? raw
          .map((item) => {
            const record = toRecord(item);
            const content = asText(record.content);
            const status = asText(record.status);
            const activeForm = asText(record.activeForm);
            if (!content || !status) return null;
            return {
              content,
              status,
              ...(activeForm ? { activeForm } : {}),
            };
          })
          .filter(
            (
              item,
            ): item is {
              content: string;
              status: string;
              activeForm?: string;
            } => Boolean(item),
          )
      : [];
  const argsTodos = normalize(args.todos);
  return argsTodos.length > 0 ? argsTodos : normalize(output.todos);
}

function getTodoStatusLabel(status: string) {
  return status === "completed"
    ? i18n.t("homeWorkspace.completed")
    : status === "in_progress"
      ? i18n.t("homeWorkspace.inProgress")
      : i18n.t("homeWorkspace.pending");
}

function getTodoStatusTone(status: string) {
  if (status === "completed") {
    return "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-200";
  }
  if (status === "in_progress") {
    return "border-[var(--brand-border)] bg-[var(--brand-soft)] text-[var(--brand-soft-foreground)]";
  }
  return "border-border bg-muted/50 text-muted-foreground";
}

function formatManagedToolSummary(toolName: string, metadataRaw: unknown) {
  const metadata = toRecord(metadataRaw);
  const args = readManagedToolArguments(metadata);
  const writeFileProgress = readManagedWriteFileProgress(metadata);
  const deploymentOutput = readManagedDeploymentToolOutput(metadata);
  const projectedView = readManagedToolViewProjection(metadata);
  const googleConfirmation = readGoogleWorkspaceConfirmation(metadata);
  if (googleConfirmation) {
    const connectorLabel = getMcpConfirmationConnectorLabel(
      googleConfirmation.connectorKey,
    );
    return `等待确认 ${connectorLabel} 高风险操作`;
  }
  if (toolName === "shell_execute") {
    return asText(args.command) || i18n.t("homeWorkspace.executeShellCommand");
  }
  if (toolName === "write_file") {
    const path = asText(args.path) || writeFileProgress.path;
    if (writeFileProgress.generatedChars > 0) {
      return [
        path || i18n.t("homeWorkspace.writeFile"),
        i18n.t("homeWorkspace.generatingCharsLabel", {
          count: writeFileProgress.generatedChars,
        }),
      ]
        .filter(Boolean)
        .join(" · ");
    }
    return path || i18n.t("homeWorkspace.writeFile");
  }
  if (toolName === "read_file") {
    return asText(args.path) || i18n.t("homeWorkspace.readFile");
  }
  if (toolName === "list_directory") {
    return asText(args.path) || i18n.t("homeWorkspace.listDirectory");
  }
  if (toolName === "search_code") {
    const query = asText(args.query);
    const target = asText(args.path);
    return [query, target ? `@ ${target}` : ""].filter(Boolean).join(" ");
  }
  if (toolName === "web_search") {
    return formatManagedWebSearchTitle(metadata, "idle");
  }
  if (toolName === "web_extract") {
    return formatManagedWebExtractTitle(metadata, "idle");
  }
  if (toolName === "todowrite") {
    const todos = readManagedTodoItems(metadataRaw);
    const activeTodo = todos.find((item) => item.status === "in_progress");
    if (activeTodo) {
      return activeTodo.activeForm || activeTodo.content;
    }
    if (todos.length > 0) {
      return i18n.t("homeWorkspace.tasksProgress", {
        completed: todos.filter((item) => item.status === "completed").length,
        total: todos.length,
      });
    }
    return i18n.t("homeWorkspace.todo");
  }
  if (toolName === "ask_user") {
    return (
      asText(args.question) || i18n.t("homeWorkspace.requestUserClarification")
    );
  }
  if (isManagedDeploymentTool(toolName)) {
    if (projectedView.userSummary) {
      return projectedView.userSummary;
    }
    if (deploymentOutput.status === "retryable_repair_required") {
      return i18n.t("homeWorkspace.fixingDeploymentConfig");
    }
    if (deploymentOutput.summary) {
      return deploymentOutput.summary;
    }
    if (toolName === "deploy_application") {
      return i18n.t("homeWorkspace.preparingDeployment");
    }
    if (toolName === "redeploy_application") {
      return i18n.t("homeWorkspace.preparingRedeployment");
    }
    if (toolName === "rollback_application_deployment") {
      return i18n.t("homeWorkspace.preparingRollback");
    }
    return i18n.t("homeWorkspace.checkDeploymentStatus");
  }
  if (toolName === "complete_task") {
    return (
      asText(args.summary) || i18n.t("homeWorkspace.finalCompletionSummary")
    );
  }
  return asText(metadata.content) || toolName;
}

function formatManagedToolPreview(toolName: string, metadataRaw: unknown) {
  const metadata = toRecord(metadataRaw);
  const args = readManagedToolArguments(metadata);
  const output = parseManagedToolOutputPreview(metadata.outputPreview);
  const writeFileProgress = readManagedWriteFileProgress(metadata);
  const error = asText(metadata.error);
  const deploymentOutput = readManagedDeploymentToolOutput(metadata);
  const projectedView = readManagedToolViewProjection(metadata);
  const googleConfirmation = readGoogleWorkspaceConfirmation(metadata);

  if (googleConfirmation) {
    const connectorLabel = getMcpConfirmationConnectorLabel(
      googleConfirmation.connectorKey,
    );
    return [
      "确认高风险 MCP 操作",
      `连接器：${connectorLabel}`,
      googleConfirmation.target ? `目标：${googleConfirmation.target}` : "",
      googleConfirmation.action ? `动作：${googleConfirmation.action}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (error) {
    if (isManagedDeploymentTool(toolName)) {
      return (
        projectedView.userPreview ||
        i18n.t("homeWorkspace.deploymentNotFinished")
      );
    }
    return error;
  }

  if (toolName === "shell_execute") {
    const stdout = asText(output.stdout);
    const stderr = asText(output.stderr);
    return (
      stdout ||
      stderr ||
      asText(args.command) ||
      i18n.t("homeWorkspace.executeCommand")
    );
  }

  if (toolName === "write_file") {
    if (writeFileProgress.preview) {
      return writeFileProgress.preview;
    }
    const bytes = asText(output.bytes);
    return bytes
      ? i18n.t("homeWorkspace.wroteBytes", { bytes })
      : asText(output.path) || i18n.t("homeWorkspace.wroteTargetFile");
  }

  if (toolName === "read_file") {
    return (
      asText(output.content) ||
      asText(output.path) ||
      i18n.t("homeWorkspace.readTargetFile")
    );
  }

  if (toolName === "list_directory") {
    return (
      asText(output.output) ||
      asText(output.path) ||
      i18n.t("homeWorkspace.returnedDirectoryContent")
    );
  }

  if (toolName === "search_code") {
    return (
      asText(output.output) ||
      asText(args.query) ||
      i18n.t("homeWorkspace.returnedSearchResults")
    );
  }
  if (toolName === "web_search") {
    const results = Array.isArray(output.results) ? output.results : [];
    const titles = results
      .map((item) => asText(toRecord(item).title) || asText(toRecord(item).url))
      .filter(Boolean)
      .slice(0, 4);
    return titles.length > 0
      ? titles.map((item) => `- ${item}`).join("\n")
      : formatManagedWebSearchTitle(metadata, "idle");
  }
  if (toolName === "web_extract") {
    const results = Array.isArray(output.results) ? output.results : [];
    const urls = results
      .map((item) => asText(toRecord(item).url))
      .filter(Boolean)
      .slice(0, 4);
    return urls.length > 0
      ? urls.map((item) => `- ${item}`).join("\n")
      : formatManagedWebExtractTitle(metadata, "idle");
  }
  if (toolName === "todowrite") {
    const todos = readManagedTodoItems(metadataRaw);
    if (todos.length === 0) {
      return i18n.t("homeWorkspace.todo");
    }
    return todos
      .map((item) => `[${getTodoStatusLabel(item.status)}] ${item.content}`)
      .join("\n");
  }

  if (isManagedDeploymentTool(toolName)) {
    if (projectedView.userPreview) {
      return projectedView.userPreview;
    }
    if (deploymentOutput.status === "retryable_repair_required") {
      return i18n.t("homeWorkspace.deploymentConfigIssueRetrying");
    }
    if (deploymentOutput.url) {
      return i18n.t("homeWorkspace.visitUrl", { url: deploymentOutput.url });
    }
    if (deploymentOutput.summary) {
      return deploymentOutput.summary;
    }
    if (toolName === "get_application_deployment_status") {
      return i18n.t("homeWorkspace.returnedDeploymentStatus");
    }
    return i18n.t("homeWorkspace.platformProcessingDeployment");
  }

  if (toolName === "complete_task") {
    return asText(args.summary) || i18n.t("homeWorkspace.taskDone");
  }

  return asText(metadata.outputPreview) || asText(metadata.content);
}

function formatManagedToolInternalDetail(
  toolName: string,
  metadataRaw: unknown,
) {
  if (!isManagedDeploymentTool(toolName)) return "";
  const projectedView = readManagedToolViewProjection(metadataRaw);
  return projectedView.internalDetail;
}

function formatManagedToolDetail(toolName: string, metadataRaw: unknown) {
  const metadata = toRecord(metadataRaw);
  const args = readManagedToolArguments(metadata);
  const output = parseManagedToolOutputPreview(metadata.outputPreview);
  const writeFileProgress = readManagedWriteFileProgress(metadata);
  const error = asText(metadata.error);
  const deploymentOutput = readManagedDeploymentToolOutput(metadata);
  const projectedView = readManagedToolViewProjection(metadata);
  const googleConfirmation = readGoogleWorkspaceConfirmation(metadata);
  const lines: string[] = [];
  const pushLine = (label: string, value: unknown) => {
    const text = asText(value);
    if (text) {
      lines.push(`${label}: ${text}`);
    }
  };

  if (toolName === "complete_task") {
    const blocks: string[] = [];
    const summary = asText(args.summary);
    if (summary) {
      blocks.push(summary);
    }
    if (Array.isArray(args.verification)) {
      const checks = (args.verification as unknown[])
        .map((item) => asText(item))
        .filter(Boolean);
      if (checks.length > 0) {
        blocks.push(
          [
            `${i18n.t("homeWorkspace.verificationLabel")}:`,
            "",
            checks.map((item) => `- ${item.replace(/\n/g, "\n  ")}`).join("\n"),
          ].join("\n"),
        );
      }
    }
    if (error) {
      blocks.push(`${i18n.t("homeWorkspace.failureReasonLabel")}:\n\n${error}`);
    }
    return (
      blocks.join("\n\n").trim() || formatManagedToolSummary(toolName, metadata)
    );
  }

  if (googleConfirmation) {
    const connectorLabel = getMcpConfirmationConnectorLabel(
      googleConfirmation.connectorKey,
    );
    return [
      "确认高风险 MCP 操作",
      `Connector: ${connectorLabel}`,
      `Tool: ${googleConfirmation.toolName || toolName}`,
      googleConfirmation.confirmationId ? `Confirmation: ${googleConfirmation.confirmationId}` : "",
      googleConfirmation.action ? `动作: ${googleConfirmation.action}` : "",
      googleConfirmation.target ? `目标: ${googleConfirmation.target}` : "",
      googleConfirmation.impact ? `影响: ${googleConfirmation.impact}` : "",
      "确认只覆盖本次同参数 tool call，不会长期放行后续操作。",
    ]
      .filter(Boolean)
      .join("\n");
  }

  lines.push(
    `${i18n.t("homeWorkspace.toolLabel")}: ${getManagedToolDisplayName(toolName)} (${toolName})`,
  );

  if (toolName === "shell_execute") {
    pushLine(i18n.t("homeWorkspace.commandLabel"), args.command);
    pushLine(i18n.t("homeWorkspace.directoryLabel"), output.cwd || args.cwd);
    pushLine(i18n.t("homeWorkspace.exitCodeLabel"), output.exitCode);
    pushLine(i18n.t("homeWorkspace.outputLabel"), output.stdout);
    pushLine(i18n.t("homeWorkspace.errorOutputLabel"), output.stderr);
  } else if (toolName === "write_file") {
    pushLine(
      i18n.t("homeWorkspace.targetFileLabel"),
      args.path || output.path || writeFileProgress.path,
    );
    pushLine(
      i18n.t("homeWorkspace.generatedCharsField"),
      writeFileProgress.generatedChars > 0
        ? String(writeFileProgress.generatedChars)
        : "",
    );
    pushLine(
      i18n.t("homeWorkspace.codePreviewLabel"),
      writeFileProgress.preview,
    );
    pushLine(i18n.t("homeWorkspace.writeSizeLabel"), output.bytes);
  } else if (toolName === "read_file") {
    pushLine(i18n.t("homeWorkspace.targetFileLabel"), args.path || output.path);
    pushLine(i18n.t("homeWorkspace.contentPreviewLabel"), output.content);
  } else if (toolName === "list_directory") {
    pushLine(
      i18n.t("homeWorkspace.targetDirectoryLabel"),
      args.path || output.path,
    );
    pushLine(
      i18n.t("homeWorkspace.recursionDepthLabel"),
      output.depth || args.depth,
    );
    pushLine(i18n.t("homeWorkspace.resultPreviewLabel"), output.output);
  } else if (toolName === "search_code") {
    pushLine(i18n.t("homeWorkspace.searchQueryLabel"), args.query);
    pushLine(
      i18n.t("homeWorkspace.searchScopeLabel"),
      args.path || output.path,
    );
    pushLine(i18n.t("homeWorkspace.resultPreviewLabel"), output.output);
  } else if (toolName === "web_search") {
    const results = Array.isArray(output.results) ? output.results : [];
    pushLine("搜索内容", args.query || output.query);
    pushLine("搜索深度", args.searchDepth || output.searchDepth);
    pushLine("结果数量", results.length > 0 ? String(results.length) : "");
    pushLine(
      i18n.t("homeWorkspace.resultPreviewLabel"),
      formatManagedToolPreview(toolName, metadata),
    );
  } else if (toolName === "web_extract") {
    const urls = readManagedWebToolContext(metadata).urls;
    const failedResults = Array.isArray(output.failedResults)
      ? output.failedResults.length
      : 0;
    pushLine("解析网页", urls.join("\n"));
    pushLine("解析深度", args.extractDepth || output.extractDepth);
    pushLine("失败数量", failedResults > 0 ? String(failedResults) : "");
    pushLine(
      i18n.t("homeWorkspace.resultPreviewLabel"),
      formatManagedToolPreview(toolName, metadata),
    );
  } else if (toolName === "todowrite") {
    const todos = readManagedTodoItems(metadataRaw);
    pushLine(
      i18n.t("homeWorkspace.summaryLabel"),
      formatManagedToolSummary(toolName, metadata),
    );
    todos.forEach((todo, index) => {
      lines.push(`${index + 1}. [${getTodoStatusLabel(todo.status)}] ${todo.content}`);
    });
  } else if (isManagedDeploymentTool(toolName)) {
    if (projectedView.userDetail) {
      return projectedView.userDetail;
    }
    pushLine(
      i18n.t("homeWorkspace.phaseLabel"),
      deploymentOutput.phase || (error ? "failed" : "running"),
    );
    pushLine(
      i18n.t("homeWorkspace.statusLabel"),
      deploymentOutput.status || deploymentOutput.deploymentStatus,
    );
    pushLine(i18n.t("homeWorkspace.summaryLabel"), deploymentOutput.summary);
    pushLine(i18n.t("homeWorkspace.accessUrlLabel"), deploymentOutput.url);
    pushLine(
      i18n.t("homeWorkspace.deploymentIdLabel"),
      deploymentOutput.deploymentId,
    );
    if (deploymentOutput.status === "retryable_repair_required") {
      pushLine(
        i18n.t("homeWorkspace.handlingLabel"),
        i18n.t("homeWorkspace.altusRetryingRepair"),
      );
    } else if (error || deploymentOutput.status === "fatal_error") {
      pushLine(
        i18n.t("homeWorkspace.handlingLabel"),
        i18n.t("homeWorkspace.internalDebugLogged"),
      );
    }
  } else if (toolName === "ask_user") {
    pushLine(i18n.t("homeWorkspace.questionLabel"), args.question);
    if (Array.isArray(args.options)) {
      const options = (args.options as unknown[])
        .map((item) => asText(item))
        .filter(Boolean)
        .join(" / ");
      pushLine(i18n.t("homeWorkspace.suggestedOptionsLabel"), options);
    }
  } else {
    pushLine(i18n.t("homeWorkspace.summaryLabel"), asText(metadata.content));
  }

  if (error) {
    pushLine(
      i18n.t("homeWorkspace.failureReasonLabel"),
      isManagedDeploymentTool(toolName)
        ? i18n.t("homeWorkspace.deploymentPending")
        : error,
    );
  }

  if (lines.length === 1) {
    pushLine(
      i18n.t("homeWorkspace.summaryLabel"),
      formatManagedToolSummary(toolName, metadata),
    );
  }

  return lines.join("\n");
}
