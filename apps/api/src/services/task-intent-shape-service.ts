function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function includesAny(text: string, keywords: readonly string[]) {
  return keywords.some((keyword) => text.includes(keyword));
}

function countHits(text: string, keywords: readonly string[]) {
  return keywords.reduce((count, keyword) => count + (text.includes(keyword) ? 1 : 0), 0);
}

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

const DEPLOY_REQUEST_KEYWORDS = [
  '部署',
  '发布',
  '上线',
  'deploy',
  'publish',
  'go live',
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
  const deployRequested = includesAny(combinedText, DEPLOY_REQUEST_KEYWORDS);
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
    reasoningTags,
  };
}
