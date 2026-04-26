import { classifyPlatformCapabilityIntent } from './platform-capability-intent-service';

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function includesAny(text: string, keywords: readonly string[]) {
  return keywords.some((keyword) => text.includes(keyword));
}

function countHits(text: string, keywords: readonly string[]) {
  return keywords.reduce((count, keyword) => count + (text.includes(keyword) ? 1 : 0), 0);
}

export type TaskClarificationType =
  | 'artifact_type'
  | 'tech_stack'
  | 'scope_boundary'
  | 'integration_target'
  | 'acceptance_requirement'
  | 'none';

export type TaskTodoSignalSummary = {
  explicitTodoRequest: boolean;
  hasMultipleSubtasks: boolean;
  hasDebugChain: boolean;
  hasIntegrationChain: boolean;
  looksTrivial: boolean;
  isSingleCommandLike: boolean;
  isSinglePointEditLike: boolean;
};

const EXPLICIT_NO_DEPLOY_KEYWORDS = [
  '不要部署',
  '不需要部署',
  '无需部署',
  '不要重新部署',
  '不需要重新部署',
  '无需重新部署',
  '不要发布',
  '不需要发布',
  '无需发布',
  '不要上线',
  '无需上线',
  '不要回滚部署',
  '不需要回滚部署',
  '无需回滚部署',
  '不要查看部署状态',
  '不需要查看部署状态',
  '无需查看部署状态',
  '不要查询部署状态',
  '不需要查询部署状态',
  '无需查询部署状态',
  '不要检查部署状态',
  '不需要检查部署状态',
  '无需检查部署状态',
  'do not deploy',
  "don't deploy",
  'no deploy',
  'do not publish',
  'do not redeploy',
  "don't redeploy",
  'do not roll back',
  "don't roll back",
  'do not check deployment status',
  "don't check deployment status",
] as const;

const EXPLICIT_NO_WEB_KEYWORDS = [
  '不要做网站',
  '不做网站',
  '不要做网页',
  '不做网页',
  '不是网站',
  '不是网页',
  '无需网站',
  '无需网页',
  '不要改造成网站',
  '不要改造成网页',
  '不要改造成网页应用',
  '不改造成网站',
  '不改造成网页',
  '不改造成网页应用',
] as const;

const SOURCE_CODE_ONLY_KEYWORDS = [
  '只生成源码',
  '只给源码',
  '只输出源码',
  '只需要源码',
  '只需要输出源码文件',
  'source code only',
  'just output the source code',
] as const;

const NO_EXTERNAL_AUTH_KEYWORDS = [
  '不要假设我已经授权任何外部平台',
  '不要假设已授权任何外部平台',
  '不要假设已经授权任何外部平台',
  '不要假设已授权',
  '不要假设已有授权',
  '不要假设任何外部平台已经授权',
  '不要假设外部平台已经授权',
  '不要假设外部权限已准备好',
  'without assuming any external platform authorization',
  'do not assume any external platform authorization',
  'do not assume external platform access',
] as const;

const WEB_ARTIFACT_KEYWORDS = [
  '网站',
  '网页',
  '官网',
  '企业官网',
  'landing page',
  'web app',
  'website',
  'dashboard',
  'admin panel',
  'browser product',
] as const;

const SCRIPT_ARTIFACT_KEYWORDS = [
  '脚本',
  'python 脚本',
  'python script',
  'cli',
  '命令行',
  'command line',
  '控制台程序',
  'console program',
  'console app',
  'console application',
  'tool script',
  'csv',
  'markdown 报告',
  'markdown report',
  '批量重命名',
] as const;

const SOFTWARE_KEYWORDS = [
  '开发',
  '代码',
  '软件',
  '应用',
  'app',
  '程序',
  '实现',
  'html',
  'css',
  'javascript',
  'typescript',
  'react',
  'vue',
  'python',
  'java',
  'node',
  'api',
  '后端',
  '前端',
  '网页',
  '网站',
  '官网',
  '脚本',
] as const;

const BUSINESS_SYSTEM_KEYWORDS = [
  '客户管理系统',
  'crm',
  'erp',
  '管理系统',
  '管理平台',
  'saas',
  '后台系统',
  '业务系统',
] as const;

const SOFTWARE_DETAIL_KEYWORDS = [
  '登录',
  '注册',
  '权限',
  '角色',
  '模块',
  '页面',
  '报表',
  '表单',
  '数据库',
  'api',
  'csv',
  'markdown',
  '源码',
  '部署',
  'html',
  'react',
  'vue',
  'python',
  '命令行',
  '脚本',
  'dashboard',
  'auth',
  'database',
  'report',
] as const;

const RESEARCH_ANALYSIS_KEYWORDS = [
  '分析',
  '报告',
  '调研',
  '统计',
  'research',
  'analysis',
  'report',
] as const;

const BUSINESS_PLANNING_KEYWORDS = [
  '营销',
  '市场',
  '推广',
  '渠道',
  '增长',
  '品牌',
  '商业计划',
  'strategy',
  'business plan',
] as const;

const EXPLICIT_TODO_REQUEST_KEYWORDS = [
  'todo',
  'todo list',
  'to-do',
  '待办',
  '待办列表',
  '任务列表',
] as const;

const MULTI_TASK_HINT_KEYWORDS = [
  '并',
  '以及',
  '并且',
  '同时',
  '分别',
  '以及',
  '、',
  '，',
  ',',
  ' and ',
  ' then ',
] as const;

const VERIFICATION_HINT_KEYWORDS = [
  '测试',
  '验证',
  'test',
  'tests',
  'build',
  '检查',
] as const;

const DEBUG_CHAIN_KEYWORDS = [
  '修复',
  '排查',
  'debug',
  'bug',
  '报错',
  '错误',
  '问题',
  '故障',
  '卡住',
  '崩溃',
] as const;

const INTEGRATION_CHAIN_KEYWORDS = [
  '部署',
  '上线',
  '迁移',
  '联调',
  '集成',
  '接入',
  '打通',
  '接口',
  'api',
  '数据库',
  '登录',
  '权限',
  'connector',
] as const;

const TRIVIAL_EDIT_KEYWORDS = [
  '注释',
  'comment',
  '文案',
  'copy',
  '按钮文案',
  '样式',
  '颜色',
  '一行',
  '改单词',
  '改个字',
  '改一下文案',
] as const;

const SINGLE_COMMAND_HINT_KEYWORDS = [
  'npm install',
  'pnpm install',
  'yarn install',
  'git status',
  'git diff',
  'ls',
  'pwd',
  '执行一次',
  'run ',
] as const;

const TECH_STACK_KEYWORDS = [
  'react',
  'vue',
  'next',
  'typescript',
  'javascript',
  'node',
  'express',
  'fastify',
  'python',
  'fastapi',
  'flask',
  'java',
  'spring',
  'go',
  'rust',
  'php',
] as const;

const SCOPE_BOUNDARY_KEYWORDS = [
  '前端',
  '后端',
  '数据库',
  '登录',
  '权限',
  'auth',
  'api',
  'frontend',
  'backend',
  'full stack',
  'full-stack',
] as const;

const ACCEPTANCE_REQUIREMENT_KEYWORDS = [
  '源码',
  '本地运行',
  '测试通过',
  '测试',
  '部署',
  '上线',
  'build',
  'run',
  '可运行',
] as const;

const INTEGRATION_VERB_KEYWORDS = ['接入', '打通', '集成', '对接', 'integrate'] as const;

const INTEGRATION_TARGET_HINT_KEYWORDS = [
  'github',
  'notion',
  'slack',
  'supabase',
  'vercel',
  'stripe',
  '数据库',
  'postgres',
  'mysql',
  'crm',
  'erp',
  'oa',
  'sap',
] as const;

const ARTIFACT_TYPE_OPTIONS = ['网页应用', '后端 API', '本地脚本', '完整业务系统'] as const;
const ACCEPTANCE_REQUIREMENT_OPTIONS = ['只要源码', '本地可运行', '测试通过', '可直接部署'] as const;

export type TaskArtifactKind =
  | 'web_app'
  | 'script_artifact'
  | 'business_system'
  | 'software_artifact'
  | 'research_analysis'
  | 'business_plan'
  | 'other';

export type TaskDeliveryMode = 'deployable' | 'source_only' | 'non_deployable' | 'neutral';

export type TaskIntentShape = {
  latestText: string;
  combinedText: string;
  artifactKind: TaskArtifactKind;
  deliveryMode: TaskDeliveryMode;
  suggestedIntentType:
    | 'software_development'
    | 'data_analysis'
    | 'research'
    | 'business_planning'
    | 'other';
  explicitNoDeploy: boolean;
  explicitNoWeb: boolean;
  sourceCodeOnly: boolean;
  explicitNoExternalAuth: boolean;
  deployRequested: boolean;
  webArtifactRequested: boolean;
  scriptArtifactRequested: boolean;
  researchAnalysisRequested: boolean;
  broadSoftwareRequested: boolean;
  boundaryOnlySoftwareRequest: boolean;
  needsClarification: boolean;
  clarificationQuestions: string[];
  clarificationQuestion: string;
  candidateTodoSignals: TaskTodoSignalSummary;
  candidateClarificationType: TaskClarificationType;
  candidateClarificationQuestion: string;
  candidateClarificationOptions: string[];
  reasoningTags: string[];
};

export function classifyTaskIntentShape(input: string | string[]): TaskIntentShape {
  const texts = Array.isArray(input) ? input : [input];
  const normalizedTexts = texts.map((item) => asText(item).toLowerCase()).filter(Boolean);
  const latestText = normalizedTexts[normalizedTexts.length - 1] || '';
  const combinedText = normalizedTexts.join('\n');

  const explicitNoDeploy = includesAny(combinedText, EXPLICIT_NO_DEPLOY_KEYWORDS);
  const explicitNoWeb = includesAny(combinedText, EXPLICIT_NO_WEB_KEYWORDS);
  const sourceCodeOnly = includesAny(combinedText, SOURCE_CODE_ONLY_KEYWORDS);
  const explicitNoExternalAuth = includesAny(combinedText, NO_EXTERNAL_AUTH_KEYWORDS);
  const deployRequested = classifyPlatformCapabilityIntent(texts).mode === 'execute';
  const webArtifactRequested = includesAny(combinedText, WEB_ARTIFACT_KEYWORDS);
  const scriptArtifactRequested = includesAny(combinedText, SCRIPT_ARTIFACT_KEYWORDS);
  const broadSoftwareRequested = includesAny(combinedText, BUSINESS_SYSTEM_KEYWORDS);
  const softwareBoundaryRequested =
    explicitNoDeploy || explicitNoWeb || sourceCodeOnly || explicitNoExternalAuth;
  const softwareRequested =
    broadSoftwareRequested ||
    webArtifactRequested ||
    scriptArtifactRequested ||
    includesAny(combinedText, SOFTWARE_KEYWORDS);
  const researchAnalysisRequested = includesAny(combinedText, RESEARCH_ANALYSIS_KEYWORDS);
  const businessPlanningRequested = includesAny(combinedText, BUSINESS_PLANNING_KEYWORDS);
  const softwareDetailHits = countHits(combinedText, SOFTWARE_DETAIL_KEYWORDS);
  const boundaryOnlySoftwareRequest =
    softwareBoundaryRequested &&
    !softwareRequested &&
    !researchAnalysisRequested &&
    !businessPlanningRequested;

  let artifactKind: TaskArtifactKind = 'other';
  if (webArtifactRequested) {
    artifactKind = 'web_app';
  } else if (scriptArtifactRequested) {
    artifactKind = 'script_artifact';
  } else if (broadSoftwareRequested) {
    artifactKind = 'business_system';
  } else if (boundaryOnlySoftwareRequest) {
    artifactKind = 'software_artifact';
  } else if (softwareRequested) {
    artifactKind = 'software_artifact';
  } else if (researchAnalysisRequested) {
    artifactKind = 'research_analysis';
  } else if (businessPlanningRequested) {
    artifactKind = 'business_plan';
  }

  let deliveryMode: TaskDeliveryMode = 'neutral';
  if (artifactKind === 'web_app' && deployRequested && !explicitNoDeploy && !explicitNoWeb) {
    deliveryMode = 'deployable';
  } else if (explicitNoDeploy || explicitNoWeb || sourceCodeOnly || artifactKind === 'script_artifact') {
    deliveryMode = 'non_deployable';
  } else if (artifactKind === 'web_app') {
    deliveryMode = 'source_only';
  }

  const needsClarification =
    (artifactKind === 'business_system' &&
      softwareDetailHits < 2 &&
      !deployRequested) ||
    boundaryOnlySoftwareRequest;

  const explicitTodoRequest = includesAny(combinedText, EXPLICIT_TODO_REQUEST_KEYWORDS);
  const hasMultipleSubtasks =
    softwareRequested &&
    includesAny(combinedText, MULTI_TASK_HINT_KEYWORDS) &&
    (countHits(combinedText, SOFTWARE_DETAIL_KEYWORDS) >= 2 ||
      includesAny(combinedText, VERIFICATION_HINT_KEYWORDS));
  const hasDebugChain = includesAny(combinedText, DEBUG_CHAIN_KEYWORDS);
  const hasIntegrationChain = includesAny(combinedText, INTEGRATION_CHAIN_KEYWORDS);
  const isSingleCommandLike = includesAny(latestText, SINGLE_COMMAND_HINT_KEYWORDS);
  const isSinglePointEditLike = includesAny(combinedText, TRIVIAL_EDIT_KEYWORDS);
  const looksTrivial =
    !needsClarification &&
    !explicitTodoRequest &&
    (isSingleCommandLike || isSinglePointEditLike) &&
    !hasDebugChain &&
    !hasIntegrationChain;

  const hasExplicitTechStack = includesAny(combinedText, TECH_STACK_KEYWORDS);
  const hasScopeBoundaryDetail = includesAny(combinedText, SCOPE_BOUNDARY_KEYWORDS);
  const hasAcceptanceRequirement = includesAny(combinedText, ACCEPTANCE_REQUIREMENT_KEYWORDS);
  const hasIntegrationVerb = includesAny(combinedText, INTEGRATION_VERB_KEYWORDS);
  const hasIntegrationTargetHint = includesAny(combinedText, INTEGRATION_TARGET_HINT_KEYWORDS);
  const artifactTypeUnclear =
    softwareRequested &&
    !researchAnalysisRequested &&
    !businessPlanningRequested &&
    !webArtifactRequested &&
    !scriptArtifactRequested &&
    !includesAny(combinedText, ['后端 api', 'backend api', '后端', 'backend', '网页应用', '移动端']) &&
    (broadSoftwareRequested || includesAny(combinedText, ['工具', 'tool', '应用', 'app', '后台']));
  const techStackUnclear =
    softwareRequested &&
    !hasExplicitTechStack &&
    !artifactTypeUnclear &&
    !researchAnalysisRequested &&
    !businessPlanningRequested;
  const scopeBoundaryUnclear =
    softwareRequested &&
    !artifactTypeUnclear &&
    (artifactKind === 'business_system' || includesAny(combinedText, ['后台', 'dashboard', 'admin', 'crm', 'erp'])) &&
    !hasScopeBoundaryDetail;
  const integrationTargetUnclear = hasIntegrationVerb && !hasIntegrationTargetHint;
  const acceptanceRequirementUnclear =
    softwareRequested &&
    !artifactTypeUnclear &&
    !scopeBoundaryUnclear &&
    !hasAcceptanceRequirement &&
    !researchAnalysisRequested &&
    !businessPlanningRequested;

  let candidateClarificationType: TaskClarificationType = 'none';
  let candidateClarificationQuestion = '';
  let candidateClarificationOptions: string[] = [];
  if (artifactTypeUnclear || boundaryOnlySoftwareRequest) {
    candidateClarificationType = 'artifact_type';
    candidateClarificationQuestion =
      '这次要交付的是网页应用、后端 API、本地脚本，还是完整业务系统？';
    candidateClarificationOptions = [...ARTIFACT_TYPE_OPTIONS];
  } else if (techStackUnclear) {
    candidateClarificationType = 'tech_stack';
    candidateClarificationQuestion =
      '这次希望使用哪种开发语言或框架？如果没有指定，我将按仓库现有技术栈继续。';
  } else if (scopeBoundaryUnclear) {
    candidateClarificationType = 'scope_boundary';
    candidateClarificationQuestion =
      '这次只需要前端页面，还是需要包含后端、数据库和登录权限？';
  } else if (integrationTargetUnclear) {
    candidateClarificationType = 'integration_target';
    candidateClarificationQuestion =
      '这次需要接入现有系统吗？如果需要，请说明目标系统或接口边界。';
  } else if (acceptanceRequirementUnclear) {
    candidateClarificationType = 'acceptance_requirement';
    candidateClarificationQuestion =
      '这次只需要源码，还是还需要本地可运行、测试通过，或可以直接部署？';
    candidateClarificationOptions = [...ACCEPTANCE_REQUIREMENT_OPTIONS];
  }

  const clarificationQuestions = !needsClarification
    ? []
    : boundaryOnlySoftwareRequest
      ? [
          '请先告诉我要生成的具体软件交付物是什么，例如脚本、网站源码或业务系统；我会继续遵守“只生成源码、不部署、不假设外部平台已授权”这些边界。',
        ]
      : [
          '请先确认这个系统的主要使用角色、必须包含的核心模块，以及本次是只要源码、本地运行，还是需要部署上线？',
        ];

  const reasoningTags: string[] = [];
  if (artifactKind === 'web_app') reasoningTags.push('web_app');
  if (artifactKind === 'script_artifact') reasoningTags.push('script_artifact');
  if (artifactKind === 'business_system') reasoningTags.push('broad_business_system');
  if (boundaryOnlySoftwareRequest) reasoningTags.push('boundary_only_software_request');
  if (explicitNoDeploy) reasoningTags.push('explicit_no_deploy');
  if (sourceCodeOnly) reasoningTags.push('source_code_only');
  if (explicitNoExternalAuth) reasoningTags.push('explicit_no_external_auth');
  if (deployRequested) reasoningTags.push('deploy_requested');

  return {
    latestText,
    combinedText,
    artifactKind,
    deliveryMode,
    suggestedIntentType:
      artifactKind === 'research_analysis'
        ? 'data_analysis'
        : artifactKind === 'business_plan'
          ? 'business_planning'
          : artifactKind === 'other'
            ? 'other'
            : 'software_development',
    explicitNoDeploy,
    explicitNoWeb,
    sourceCodeOnly,
    explicitNoExternalAuth,
    deployRequested,
    webArtifactRequested,
    scriptArtifactRequested,
    researchAnalysisRequested,
    broadSoftwareRequested,
    boundaryOnlySoftwareRequest,
    needsClarification,
    clarificationQuestions,
    clarificationQuestion: clarificationQuestions[0] || '',
    candidateTodoSignals: {
      explicitTodoRequest,
      hasMultipleSubtasks,
      hasDebugChain,
      hasIntegrationChain,
      looksTrivial,
      isSingleCommandLike,
      isSinglePointEditLike,
    },
    candidateClarificationType,
    candidateClarificationQuestion,
    candidateClarificationOptions,
    reasoningTags,
  };
}
