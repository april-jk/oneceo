import { asText, buildManagedToolDefinitions } from './altus-managed-shared';

export type SkillGovernanceOption = {
  value: string;
  label: string;
  description?: string;
  category?: string;
};

export type SkillGovernanceOptions = {
  systemRoles: SkillGovernanceOption[];
  autoActivationTriggers: SkillGovernanceOption[];
  toolNames: SkillGovernanceOption[];
};

const SYSTEM_ROLE_OPTIONS: SkillGovernanceOption[] = [
  {
    value: 'deployment_orchestrator',
    label: '部署编排',
    description: '统一治理部署、重部署、回滚和状态查询链路。',
    category: 'deployment',
  },
  {
    value: 'vercel_mcp_project_operator',
    label: 'Vercel MCP 项目配置',
    description: '治理 Vercel MCP 项目创建、更新和删除工具，避免把配置修改误当源码部署。',
    category: 'deployment',
  },
  {
    value: 'vercel_mcp_release_operator',
    label: 'Vercel MCP 发布安全',
    description: '治理 Vercel MCP 环境变量、域名、部署事件和重部署工具。',
    category: 'deployment',
  },
  {
    value: 'ppt_builder',
    label: 'PPT 构建',
    description: 'PPT 多阶段生成链路中的最终构建阶段。',
    category: 'office',
  },
  {
    value: 'docx_builder',
    label: 'Word 构建',
    description: 'Word 多阶段生成链路中的最终构建阶段。',
    category: 'office',
  },
  {
    value: 'xlsx_builder',
    label: 'Excel 构建',
    description: 'Excel 多阶段生成链路中的最终构建阶段。',
    category: 'office',
  },
];

const AUTO_ACTIVATION_TRIGGER_OPTIONS: SkillGovernanceOption[] = [
  { value: 'deploy', label: '部署', description: '用户触发发布当前项目。', category: 'deployment' },
  { value: 'redeploy', label: '重部署', description: '用户要求重新发布最新代码。', category: 'deployment' },
  { value: 'rollback', label: '回滚', description: '用户要求回滚到历史版本。', category: 'deployment' },
  { value: 'status', label: '部署状态', description: '用户查询部署状态、URL 或健康情况。', category: 'deployment' },
  { value: 'vercel', label: 'Vercel', description: '用户要求使用 Vercel 连接器或 Vercel MCP。', category: 'deployment' },
  {
    value: 'project-config',
    label: '项目配置',
    description: '用户要求创建、更新或删除 Vercel 项目配置。',
    category: 'deployment',
  },
  { value: 'env', label: '环境变量', description: '用户要求管理 Vercel 项目环境变量。', category: 'deployment' },
  { value: 'domain', label: '域名', description: '用户要求管理 Vercel 项目域名。', category: 'deployment' },
  { value: 'ppt', label: 'PPT', description: '用户要求生成、规划或准备 PPT。', category: 'office' },
  { value: 'pptx', label: 'PPTX', description: '用户要求生成或处理 PowerPoint 文件。', category: 'office' },
  { value: 'powerpoint', label: 'PowerPoint', description: '用户明确提到 PowerPoint。', category: 'office' },
  { value: 'presentation', label: '演示文稿', description: '用户要求制作演示文稿或 slides。', category: 'office' },
  { value: 'slides', label: 'Slides', description: '用户明确提到 slides。', category: 'office' },
  { value: '演示文稿', label: '演示文稿', description: '用户用中文要求演示文稿。', category: 'office' },
];

const VERCEL_MCP_TOOL_OPTIONS: SkillGovernanceOption[] = [
  {
    value: 'vercel_create_project',
    label: 'Vercel 创建项目',
    description: '创建 Vercel project，不等于上传当前工作区源码。',
    category: 'vercel',
  },
  {
    value: 'vercel_update_project',
    label: 'Vercel 更新项目配置',
    description: '更新 framework、buildCommand、outputDirectory 等项目配置，不等于部署。',
    category: 'vercel',
  },
  {
    value: 'vercel_delete_project',
    label: 'Vercel 删除项目',
    description: '删除 Vercel project，属于破坏性操作。',
    category: 'vercel',
  },
  {
    value: 'vercel_create_project_from_git',
    label: 'Vercel 从 Git 创建项目',
    description: '创建绑定 Git repository 的 Vercel project，不等于上传当前工作区源码。',
    category: 'vercel',
  },
  {
    value: 'vercel_update_project_git_repository',
    label: 'Vercel 更新 Git 绑定',
    description: '只更新项目 Git repository 相关字段，不混入普通项目配置。',
    category: 'vercel',
  },
  {
    value: 'vercel_get_project_git_repository',
    label: 'Vercel 读取 Git 绑定',
    description: '从项目详情提取 Git repository 上下文，便于确认绑定关系。',
    category: 'vercel',
  },
  {
    value: 'vercel_create_deployment',
    label: 'Vercel 创建 Git 部署',
    description: '通过 Git source 创建部署，首版不支持 workspace 文件上传。',
    category: 'vercel',
  },
  {
    value: 'vercel_get_deployment_events',
    label: 'Vercel 部署事件',
    description: '读取部署事件，用于诊断构建和部署失败。',
    category: 'vercel',
  },
  {
    value: 'vercel_add_project_domain',
    label: 'Vercel 添加项目域名',
    description: '为项目添加域名，需要确认项目和域名归属。',
    category: 'vercel',
  },
  {
    value: 'vercel_upsert_env_var',
    label: 'Vercel 写入环境变量',
    description: '新增或更新项目环境变量，需要明确 target。',
    category: 'vercel',
  },
  {
    value: 'vercel_remove_env_var',
    label: 'Vercel 删除环境变量',
    description: '删除项目环境变量，需要明确 key 和 target。',
    category: 'vercel',
  },
  {
    value: 'vercel_redeploy_deployment',
    label: 'Vercel 重部署已有部署',
    description: '基于已有 deploymentId 重部署，不是首次源码上传。',
    category: 'vercel',
  },
];

const TOOL_OPTION_OVERRIDES: Record<string, Pick<SkillGovernanceOption, 'label' | 'category'>> = {
  shell_execute: { label: '命令执行', category: 'workspace' },
  debug_open_page: { label: '调试页面', category: 'debug' },
  deploy_application: { label: '发布应用', category: 'deployment' },
  redeploy_application: { label: '重新发布', category: 'deployment' },
  rollback_application_deployment: { label: '回滚部署', category: 'deployment' },
  get_application_deployment_status: { label: '部署状态查询', category: 'deployment' },
  read_file: { label: '读取文件', category: 'workspace' },
  write_file: { label: '写入文件', category: 'workspace' },
  list_directory: { label: '列出目录', category: 'workspace' },
  search_code: { label: '搜索代码', category: 'workspace' },
  web_search: { label: '网页搜索', category: 'web' },
  web_extract: { label: '网页提取', category: 'web' },
  load_skill_resource: { label: '加载技能资源', category: 'skill' },
  load_connector_guide: { label: '加载连接器指南', category: 'connector' },
  ask_user: { label: '向用户提问', category: 'conversation' },
  complete_task: { label: '完成任务', category: 'conversation' },
};

function buildToolOptions(): SkillGovernanceOption[] {
  const toolOptionsByValue = new Map<string, SkillGovernanceOption>();
  const addToolOption = (option: SkillGovernanceOption) => {
    if (!option.value || toolOptionsByValue.has(option.value)) return;
    toolOptionsByValue.set(option.value, option);
  };

  for (const tool of buildManagedToolDefinitions()) {
    const functionRecord =
      tool && typeof tool === 'object' && !Array.isArray(tool) && tool.function && typeof tool.function === 'object'
        ? (tool.function as Record<string, unknown>)
        : null;
    const value = asText(functionRecord?.name);
    if (!value) continue;
    const override = TOOL_OPTION_OVERRIDES[value];
    addToolOption({
      value,
      label: override?.label || value,
      description: asText(functionRecord?.description) || undefined,
      category: override?.category || 'general',
    });
  }

  for (const option of VERCEL_MCP_TOOL_OPTIONS) {
    addToolOption(option);
  }

  return Array.from(toolOptionsByValue.values()).sort((left, right) => {
      const categoryCompare = (left.category || '').localeCompare(right.category || '', 'zh-Hans-CN');
      if (categoryCompare !== 0) return categoryCompare;
      return left.label.localeCompare(right.label, 'zh-Hans-CN');
    });
}

export function listPlatformSkillGovernanceOptions(): SkillGovernanceOptions {
  return {
    systemRoles: SYSTEM_ROLE_OPTIONS,
    autoActivationTriggers: AUTO_ACTIVATION_TRIGGER_OPTIONS,
    toolNames: buildToolOptions(),
  };
}
