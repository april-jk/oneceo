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
  const toolOptions: SkillGovernanceOption[] = [];
  for (const tool of buildManagedToolDefinitions()) {
    const functionRecord =
      tool && typeof tool === 'object' && !Array.isArray(tool) && tool.function && typeof tool.function === 'object'
        ? (tool.function as Record<string, unknown>)
        : null;
    const value = asText(functionRecord?.name);
    if (!value) continue;
    const override = TOOL_OPTION_OVERRIDES[value];
    toolOptions.push({
      value,
      label: override?.label || value,
      description: asText(functionRecord?.description) || undefined,
      category: override?.category || 'general',
    });
  }
  return toolOptions.sort((left, right) => {
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
