import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { taskCreationFileMemoryStore } from '../agents/task-creation/file-memory-store';
import {
  taskCreationSessionDAO,
  taskSessionRunDAO,
  taskSessionConnectorBindingDAO,
} from '../db/dao';
import { osacAgentService } from './osac-agent-service';
import { sessionMcpRecoveryService } from './session-mcp-recovery-service';
import { sessionConnectorService } from './session-connector-service';
import { resolveOpencodeWorkspacePath } from '../utils/opencode-workspace';
import { ensureSandboxRuntimeMetadata } from './sandbox-runtime-metadata-service';
import { sandboxAgentProvisionService } from './sandbox-agent-provision-service';
import { asText, pickObject, type ChatMessage, type ChatMessageContentPart } from './altus-managed-shared';
import {
  deriveManagedTaskIntentProfile,
  type AltusManagedTaskIntentProfile,
} from './altus-managed-prompt-service';
import { classifyPlatformCapabilityIntent } from './platform-capability-intent-service';
import { classifyTaskIntentShape, type TaskClarificationType, type TaskIntentShape } from './task-intent-shape-service';
import { buildAttachmentContextPrompt } from './task-attachment-service';
import { managedImageObjectService, type ManagedImageObjectService } from './managed-image-object-service';
import { isSameUserId } from '../utils/user-id';
import {
  altusClarificationPolicyReducer,
  type ClarificationReducerResult,
} from './altus-clarification-policy-reducer';
import { altusClarificationTransitionAgent } from './altus-clarification-transition-agent';
import {
  altusManagedContextService,
  buildManagedConversationEntries,
} from './altus-managed-context-service';
import {
  buildOfficialWebShellMaterializationGuidance,
  materializeOfficialWebShellInSandbox,
} from './oneceo-official-web-shell-materialization-service';

const INLINE_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const INLINE_IMAGE_MAX_BYTES = 6 * 1024 * 1024;
const INLINE_IMAGE_MAX_COUNT = 4;
const ARTIFACT_TYPE_OPTIONS = ['网页应用', '后端 API', '本地脚本', '完整业务系统'] as const;
const ACCEPTANCE_REQUIREMENT_OPTIONS = ['只要源码', '本地可运行', '测试通过', '可直接部署'] as const;
const SPECIFIC_ARTIFACT_KEYWORDS = [
  '网页应用',
  'web app',
  '网站',
  '网页',
  'landing page',
  'dashboard',
  'admin',
  '后台',
  '后端 api',
  'backend api',
  'api 服务',
  'backend service',
  '脚本',
  'cli',
  '命令行',
  '爬虫',
  '完整业务系统',
  '完整系统',
  'erp',
  'crm',
] as const;
const AMBIGUOUS_SOFTWARE_KEYWORDS = ['工具', 'tool', '应用', 'app', '系统', '平台'] as const;
const TECH_STACK_RESPONSE_KEYWORDS = [
  'react',
  'vue',
  'next',
  'vite',
  'typescript',
  'javascript',
  'node',
  'express',
  'fastify',
  'python',
  'fastapi',
  'flask',
  'django',
  'java',
  'spring',
  'go',
  'rust',
  'php',
  'laravel',
  'nestjs',
];
const SCOPE_BOUNDARY_RESPONSE_KEYWORDS = [
  '只要前端',
  '仅前端',
  '只需要前端',
  '前端页面',
  '前后端',
  '全栈',
  'full stack',
  'full-stack',
  '后端',
  '数据库',
  '登录',
  '权限',
  'auth',
  'api',
];
const SCOPE_BOUNDARY_TRIGGER_KEYWORDS = ['后台', 'dashboard', 'admin', 'crm', 'erp', '管理系统'] as const;
const INTEGRATION_REQUEST_KEYWORDS = ['接入', '打通', '集成', '对接', 'integrate'] as const;
const INTEGRATION_TARGET_RESPONSE_KEYWORDS = [
  'github',
  'notion',
  'slack',
  'supabase',
  'vercel',
  'stripe',
  'postgres',
  'mysql',
  '数据库',
  'crm',
  'erp',
  'oa',
  'sap',
  'api',
];
const NO_INTEGRATION_RESPONSE_KEYWORDS = [
  '不需要接入',
  '无需接入',
  '不用接入',
  '不需要集成',
  '无需集成',
  '不用集成',
  '不需要对接',
  '独立实现',
  '不和现有系统打通',
];
const CLARIFICATION_DELEGATION_RESPONSE_KEYWORDS = [
  '按你觉得',
  '你决定',
  '你来定',
  '默认',
  '没有指定',
  '没指定',
  '都可以',
  '随便',
  '合适的方式',
  '仓库现有',
  '现有技术栈',
] as const;
const NEW_TURN_RESPONSE_KEYWORDS = [
  '帮我',
  '请帮',
  '查查',
  '查一下',
  '搜索',
  '检索',
  '最近',
  '年报',
  '报告',
  '行业',
  '开发者',
  '谁开发',
  '你是谁',
  '能做什么',
  '还能做什么',
  '做什么',
  '什么？',
  '什么?',
  'what',
  'search',
  'research',
  'report',
] as const;
const ACCEPTANCE_RESPONSE_KEYWORDS = [
  '只要源码',
  '源码',
  '只要代码',
  '完整代码',
  '完成代码',
  '本地可运行',
  '本地运行',
  '测试通过',
  '测试',
  '可直接部署',
  '直接部署',
  '可部署',
  '部署上线',
  '上线',
  'build',
  'run',
];
const ROOT_STACK_FILES = [
  'package.json',
  'pnpm-workspace.yaml',
  'tsconfig.json',
  'requirements.txt',
  'pyproject.toml',
  'go.mod',
  'Cargo.toml',
  'pom.xml',
] as const;
const COMPOSIO_BROKERED_RUNTIME_TRANSPORT = 'api_brokered_mcp';
const COMPOSIO_BROKERED_CONNECTORS = new Set(['github', 'notion', 'slack', 'figma', 'supabase']);

function isSnapshotRuntimeTransportSupported(binding: { connectorKey?: unknown; runtimeTransport?: unknown }) {
  if (!COMPOSIO_BROKERED_CONNECTORS.has(asText(binding.connectorKey))) {
    return true;
  }
  return asText(binding.runtimeTransport) === COMPOSIO_BROKERED_RUNTIME_TRANSPORT;
}

type WorkspaceTechStackHints = {
  constrained: boolean;
  labels: string[];
};

type FinalClarificationDecision = {
  needsClarification: boolean;
  clarificationType: TaskClarificationType;
  clarificationQuestion: string;
  clarificationOptions?: string[];
};

type TransitionResolvedProfileInput = {
  baseProfile: AltusManagedTaskIntentProfile;
  shape: TaskIntentShape;
  todoDecision: Pick<AltusManagedTaskIntentProfile, 'todoRequired' | 'todoReason'>;
  reduced: ClarificationReducerResult;
  currentText: string;
  pendingQuestion?: string | null;
  texts: string[];
};

function includesAnyKeyword(text: string, keywords: readonly string[]) {
  return keywords.some((keyword) => text.includes(keyword));
}

function normalizeText(value: unknown) {
  return asText(value).toLowerCase();
}

function isPlatformCapabilityAdvisoryText(text: string) {
  const mode = classifyPlatformCapabilityIntent(text).mode;
  return (
    mode === 'answer_capability' ||
    mode === 'explain_how_to' ||
    mode === 'discuss_requirement' ||
    mode === 'explain_concept'
  );
}

function coversArtifactType(text: string) {
  return includesAnyKeyword(text, SPECIFIC_ARTIFACT_KEYWORDS);
}

function coversTechStack(text: string, workspaceHints: WorkspaceTechStackHints) {
  return workspaceHints.constrained || includesAnyKeyword(text, TECH_STACK_RESPONSE_KEYWORDS);
}

function coversScopeBoundary(text: string) {
  return includesAnyKeyword(text, SCOPE_BOUNDARY_RESPONSE_KEYWORDS);
}

function coversIntegrationTarget(text: string) {
  return (
    includesAnyKeyword(text, INTEGRATION_TARGET_RESPONSE_KEYWORDS) ||
    includesAnyKeyword(text, NO_INTEGRATION_RESPONSE_KEYWORDS)
  );
}

function coversAcceptanceRequirement(text: string) {
  return includesAnyKeyword(text, ACCEPTANCE_RESPONSE_KEYWORDS);
}

function shouldTreatPendingClarificationAsNewTurn(
  text: string,
  pendingClarificationType: Exclude<TaskClarificationType, 'none'>,
  workspaceHints: WorkspaceTechStackHints
) {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  if (includesAnyKeyword(normalized, CLARIFICATION_DELEGATION_RESPONSE_KEYWORDS)) {
    return false;
  }
  if (coversClarificationType(pendingClarificationType, normalized, workspaceHints)) {
    return false;
  }
  if (
    coversArtifactType(normalized) ||
    coversScopeBoundary(normalized) ||
    coversIntegrationTarget(normalized) ||
    coversAcceptanceRequirement(normalized)
  ) {
    return false;
  }
  return includesAnyKeyword(normalized, NEW_TURN_RESPONSE_KEYWORDS);
}

function coversClarificationType(
  clarificationType: Exclude<TaskClarificationType, 'none'>,
  text: string,
  workspaceHints: WorkspaceTechStackHints
) {
  switch (clarificationType) {
    case 'artifact_type':
      return coversArtifactType(text);
    case 'tech_stack':
      return coversTechStack(text, workspaceHints);
    case 'scope_boundary':
      return coversScopeBoundary(text);
    case 'integration_target':
      return coversIntegrationTarget(text);
    case 'acceptance_requirement':
      return coversAcceptanceRequirement(text);
    default:
      return false;
  }
}

function buildClarificationQuestion(
  clarificationType: Exclude<TaskClarificationType, 'none'>,
  options?: string[],
  input?: { followUp?: boolean }
) {
  const followUpPrefix = input?.followUp ? '我还需要先确认这一点：' : '';
  switch (clarificationType) {
    case 'artifact_type':
      return {
        question: `${followUpPrefix}这次要交付的是网页应用、后端 API、本地脚本，还是完整业务系统？`,
        options: options || [...ARTIFACT_TYPE_OPTIONS],
      };
    case 'tech_stack':
      return {
        question: `${followUpPrefix}这次希望使用哪种开发语言或框架？如果没有指定，我将按仓库现有技术栈继续。`,
      };
    case 'scope_boundary':
      return {
        question: `${followUpPrefix}这次只需要前端页面，还是需要包含后端、数据库和登录权限？`,
      };
    case 'integration_target':
      return {
        question: `${followUpPrefix}这次需要接入现有系统吗？如果需要，请说明目标系统或接口边界。`,
      };
    case 'acceptance_requirement':
      return {
        question: `${followUpPrefix}这次只需要源码，还是还需要本地可运行、测试通过，或可以直接部署？`,
        options: options || [...ACCEPTANCE_REQUIREMENT_OPTIONS],
      };
  }
}

async function pathExists(targetPath: string) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function deriveWorkspaceTechStackHints(workspaceRoot: string): Promise<WorkspaceTechStackHints> {
  const root = asText(workspaceRoot);
  if (!root || !(await pathExists(root))) {
    return {
      constrained: false,
      labels: [],
    };
  }

  const fileChecks = await Promise.all(
    ROOT_STACK_FILES.map(async (filename) => ({
      filename,
      exists: await pathExists(path.join(root, filename)),
    }))
  );
  const existing = new Set(fileChecks.filter((item) => item.exists).map((item) => item.filename));
  if (existing.size === 0) {
    return {
      constrained: false,
      labels: [],
    };
  }

  const familySignals = new Set<string>();
  const labels = new Set<string>();

  if (existing.has('requirements.txt') || existing.has('pyproject.toml')) {
    familySignals.add('python');
    labels.add('python');
  }
  if (existing.has('go.mod')) {
    familySignals.add('go');
    labels.add('go');
  }
  if (existing.has('Cargo.toml')) {
    familySignals.add('rust');
    labels.add('rust');
  }
  if (existing.has('pom.xml')) {
    familySignals.add('java');
    labels.add('java');
  }

  let packageJson: Record<string, unknown> | null = null;
  if (existing.has('package.json')) {
    familySignals.add('javascript');
    try {
      const raw = await fs.readFile(path.join(root, 'package.json'), 'utf8');
      packageJson = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      packageJson = null;
    }
  }
  if (existing.has('tsconfig.json')) {
    familySignals.add('javascript');
    labels.add('typescript');
  }

  const dependencyKeys = new Set<string>();
  if (packageJson) {
    const dependencies = pickObject(packageJson.dependencies);
    const devDependencies = pickObject(packageJson.devDependencies);
    const scripts = pickObject(packageJson.scripts);
    for (const source of [dependencies, devDependencies, scripts]) {
      for (const key of Object.keys(source)) {
        dependencyKeys.add(normalizeText(key));
      }
      for (const value of Object.values(source)) {
        const normalizedValue = normalizeText(value);
        if (normalizedValue) {
          dependencyKeys.add(normalizedValue);
        }
      }
    }
    if (dependencyKeys.has('react')) labels.add('react');
    if (dependencyKeys.has('vue')) labels.add('vue');
    if (dependencyKeys.has('next')) labels.add('next');
    if (dependencyKeys.has('vite')) labels.add('vite');
    if (dependencyKeys.has('express')) labels.add('express');
    if (dependencyKeys.has('fastify')) labels.add('fastify');
    if (dependencyKeys.has('typescript')) labels.add('typescript');
  }

  const familyList = [...familySignals];
  if (familyList.length !== 1) {
    return {
      constrained: false,
      labels: [...labels],
    };
  }

  if (familyList[0] !== 'javascript') {
    return {
      constrained: true,
      labels: [...labels],
    };
  }

  const frontendSignals = ['next', 'react', 'vue', 'vite'].filter((item) => labels.has(item));
  const backendSignals = ['express', 'fastify'].filter((item) => labels.has(item));
  const constrained =
    (frontendSignals.length > 0 && backendSignals.length === 0) ||
    (backendSignals.length > 0 && frontendSignals.length === 0);

  return {
    constrained,
    labels: [...labels],
  };
}

function resolveTodoDecision(
  shape: TaskIntentShape,
  options?: { deployableWebAppBlueprintRequired?: boolean }
): Pick<AltusManagedTaskIntentProfile, 'todoRequired' | 'todoReason'> {
  if (shape.candidateTodoSignals.explicitTodoRequest) {
    return {
      todoRequired: true,
      todoReason: 'explicit_user_request',
    };
  }
  if (options?.deployableWebAppBlueprintRequired) {
    return {
      todoRequired: true,
      todoReason: 'deployable_web_app_blueprint',
    };
  }
  if (
    shape.candidateTodoSignals.looksTrivial ||
    shape.candidateTodoSignals.isSingleCommandLike ||
    shape.candidateTodoSignals.isSinglePointEditLike
  ) {
    return {
      todoRequired: false,
      todoReason: 'none',
    };
  }
  if (shape.candidateTodoSignals.hasMultipleSubtasks) {
    return {
      todoRequired: true,
      todoReason: 'multi_step',
    };
  }
  if (shape.candidateTodoSignals.hasDebugChain) {
    return {
      todoRequired: true,
      todoReason: 'debug_chain',
    };
  }
  if (shape.candidateTodoSignals.hasIntegrationChain) {
    return {
      todoRequired: true,
      todoReason: 'integration_chain',
    };
  }
  return {
    todoRequired: false,
    todoReason: 'none',
  };
}

function shouldRequireDeployableWebAppBlueprint(input: {
  profile: AltusManagedTaskIntentProfile;
  needsClarification: boolean;
}) {
  return Boolean(
    input.profile.mode === 'deployable_web_app' &&
      !input.needsClarification
  );
}

function resolveClarificationDecision(input: {
  shape: TaskIntentShape;
  currentText: string;
  messageType: 'user_input' | 'user_response';
  pendingClarificationType?: TaskClarificationType | null;
  workspaceHints: WorkspaceTechStackHints;
}): FinalClarificationDecision {
  const combinedText = input.shape.combinedText;
  const currentText = input.currentText;
  const softwareRequest = input.shape.suggestedIntentType === 'software_development';
  const pendingType =
    input.pendingClarificationType &&
    input.pendingClarificationType !== 'none'
      ? input.pendingClarificationType
      : null;

  if (
    input.messageType === 'user_response' &&
    pendingType &&
    !coversClarificationType(pendingType, currentText, input.workspaceHints)
  ) {
    const followUp = buildClarificationQuestion(pendingType, undefined, { followUp: true });
    return {
      needsClarification: true,
      clarificationType: pendingType,
      clarificationQuestion: followUp.question,
      clarificationOptions: followUp.options,
    };
  }

  const candidates: Array<Exclude<TaskClarificationType, 'none'>> = [];
  const needsArtifactClarification =
    softwareRequest &&
    (input.shape.boundaryOnlySoftwareRequest ||
      input.shape.artifactKind === 'business_system' ||
      includesAnyKeyword(combinedText, AMBIGUOUS_SOFTWARE_KEYWORDS)) &&
    !coversArtifactType(combinedText);
  if (needsArtifactClarification) {
    candidates.push('artifact_type');
  }

  const needsTechStackClarification =
    softwareRequest &&
    !input.workspaceHints.constrained &&
    !coversTechStack(combinedText, input.workspaceHints) &&
    !input.shape.candidateTodoSignals.looksTrivial;
  if (needsTechStackClarification) {
    candidates.push('tech_stack');
  }

  const needsScopeClarification =
    softwareRequest &&
    !input.shape.candidateTodoSignals.looksTrivial &&
    (input.shape.artifactKind === 'business_system' ||
      includesAnyKeyword(combinedText, SCOPE_BOUNDARY_TRIGGER_KEYWORDS)) &&
    !coversScopeBoundary(combinedText);
  if (needsScopeClarification) {
    candidates.push('scope_boundary');
  }

  const needsIntegrationClarification =
    includesAnyKeyword(combinedText, INTEGRATION_REQUEST_KEYWORDS) &&
    !coversIntegrationTarget(combinedText);
  if (needsIntegrationClarification) {
    candidates.push('integration_target');
  }

  const needsAcceptanceClarification =
    softwareRequest &&
    !input.shape.candidateTodoSignals.looksTrivial &&
    (input.shape.artifactKind === 'business_system' ||
      (input.shape.artifactKind === 'software_artifact' &&
        includesAnyKeyword(combinedText, ['项目', '系统', '平台']))) &&
    !coversAcceptanceRequirement(combinedText);
  if (needsAcceptanceClarification) {
    candidates.push('acceptance_requirement');
  }

  for (const clarificationType of candidates) {
    if (
      input.messageType === 'user_response' &&
      pendingType === clarificationType &&
      coversClarificationType(clarificationType, currentText, input.workspaceHints)
    ) {
      continue;
    }
    const question = buildClarificationQuestion(clarificationType);
    return {
      needsClarification: true,
      clarificationType,
      clarificationQuestion: question.question,
      clarificationOptions: question.options,
    };
  }

  return {
    needsClarification: false,
    clarificationType: 'none',
    clarificationQuestion: '',
    clarificationOptions: undefined,
  };
}

function shouldUseClarificationTransitionAgent(input: {
  baseProfile: AltusManagedTaskIntentProfile;
  shape: TaskIntentShape;
  pendingClarificationType?: TaskClarificationType | null;
}) {
  return Boolean(
    (input.pendingClarificationType && input.pendingClarificationType !== 'none') ||
      input.baseProfile.needsClarification ||
      input.shape.needsClarification ||
      input.shape.candidateClarificationType !== 'none'
  );
}

function isConfirmationLikeResponse(text: string) {
  const normalized = normalizeText(text).replace(/[。．.!！?？\s]+/g, '');
  return (
    normalized === '确认' ||
    normalized === '确认继续' ||
    normalized === '确认部署' ||
    normalized === '继续' ||
    normalized === '继续部署' ||
    normalized === '可以' ||
    normalized === '可以继续' ||
    normalized === '好的' ||
    normalized === '好' ||
    normalized === '是' ||
    normalized === '是的' ||
    normalized === 'yes' ||
    normalized === 'ok' ||
    normalized === 'okay'
  );
}

function isDeploymentRiskConfirmationQuestion(question?: string | null) {
  const normalized = normalizeText(question);
  return normalized.includes('部署到生产环境') || normalized.includes('外部预览部署');
}

function resolveConfirmedDeploymentIntent(
  input: Pick<TransitionResolvedProfileInput, 'baseProfile' | 'currentText' | 'pendingQuestion' | 'reduced' | 'texts'>
): Pick<
  AltusManagedTaskIntentProfile,
  'deployRequested' | 'deploymentAllowed' | 'mode' | 'platformCapabilityIntent' | 'reason' | 'webArtifactRequested'
> | null {
  if (!input.reduced.accepted || input.reduced.nextState !== 'ready_to_execute') {
    return null;
  }
  if (!isDeploymentRiskConfirmationQuestion(input.pendingQuestion)) {
    return null;
  }
  if (!isConfirmationLikeResponse(input.currentText)) {
    return null;
  }
  if (input.texts.length < 2) {
    return null;
  }

  const historicalProfile = deriveManagedTaskIntentProfile(input.texts.slice(0, -1));
  if (!historicalProfile.deploymentAllowed || historicalProfile.platformCapabilityIntent?.mode !== 'execute') {
    return null;
  }

  return {
    mode: historicalProfile.mode === 'neutral' ? 'deployable_web_app' : historicalProfile.mode,
    reason:
      historicalProfile.reason === 'latest_deployable_request' ||
      historicalProfile.reason === 'historical_deployable_request'
        ? historicalProfile.reason
        : 'historical_deployable_request',
    webArtifactRequested: historicalProfile.webArtifactRequested || input.baseProfile.webArtifactRequested,
    deployRequested: true,
    deploymentAllowed: true,
    platformCapabilityIntent: historicalProfile.platformCapabilityIntent,
  };
}

function buildProfileFromTransition(input: TransitionResolvedProfileInput): AltusManagedTaskIntentProfile {
  const fallbackQuestion = input.reduced.accepted
    ? ''
    : input.reduced.question;
  if (!input.reduced.accepted) {
    return {
      ...input.baseProfile,
      ...input.todoDecision,
      needsClarification: true,
      clarificationType: input.reduced.clarificationType || input.shape.candidateClarificationType || 'none',
      clarificationQuestion: fallbackQuestion,
      clarificationOptions: input.reduced.options,
      clarificationTransition: {
        nextState: input.reduced.nextState,
        reason: input.reduced.reason,
      },
    };
  }

  if (input.reduced.nextState === 'clarifying') {
    return {
      ...input.baseProfile,
      ...input.todoDecision,
      needsClarification: true,
      clarificationType: input.reduced.clarificationType || input.shape.candidateClarificationType || 'none',
      clarificationQuestion: input.reduced.question || input.shape.candidateClarificationQuestion,
      clarificationOptions: input.reduced.options,
      clarificationTransition: {
        nextState: 'clarifying',
        reason: input.reduced.reason,
        assumptions: input.reduced.assumptions,
      },
    };
  }

  const effectiveTexts =
    input.reduced.nextState === 'new_turn' && input.currentText ? [input.currentText] : input.texts;
  const effectiveBaseProfile =
    input.reduced.nextState === 'new_turn'
      ? deriveManagedTaskIntentProfile(effectiveTexts)
      : input.baseProfile;
  const effectiveShape =
    input.reduced.nextState === 'new_turn'
      ? classifyTaskIntentShape(effectiveTexts)
      : input.shape;
  const effectiveTodoDecision =
    input.reduced.nextState === 'new_turn'
      ? resolveTodoDecision(effectiveShape, {
          deployableWebAppBlueprintRequired: shouldRequireDeployableWebAppBlueprint({
            profile: effectiveBaseProfile,
            needsClarification: false,
          }),
        })
      : input.todoDecision;
  const confirmedDeploymentIntent = resolveConfirmedDeploymentIntent(input);
  const resolvedBaseProfile = confirmedDeploymentIntent
    ? {
        ...effectiveBaseProfile,
        ...confirmedDeploymentIntent,
      }
    : effectiveBaseProfile;

  return {
    ...resolvedBaseProfile,
    ...effectiveTodoDecision,
    needsClarification: false,
    clarificationType: 'none',
    clarificationQuestion: '',
    clarificationOptions: undefined,
    clarificationTransition: {
      nextState: input.reduced.nextState,
      reason: input.reduced.reason,
      assumptions: input.reduced.assumptions,
    },
  };
}

function collectAttachmentContextPrompt(history: Array<{ metadata?: unknown }>): string {
  const seenPaths = new Set<string>();
  const contexts: Array<{
    name: string;
    path: string;
    size: number;
    mimeType?: string;
    excerpt: string;
    truncated: boolean;
    extractedAt: string;
    extraction: 'utf8_text';
  }> = [];

  for (const item of history) {
    const metadata = pickObject(item.metadata);
    const rawContexts = Array.isArray(metadata.attachmentContext) ? metadata.attachmentContext : [];
    for (const raw of rawContexts) {
      const record = pickObject(raw);
      const path = asText(record.path);
      const excerpt = asText(record.excerpt);
      if (!path || !excerpt || seenPaths.has(path)) {
        continue;
      }
      seenPaths.add(path);
      contexts.push({
        name: asText(record.name) || path.split('/').pop() || 'attachment',
        path,
        size: typeof record.size === 'number' && Number.isFinite(record.size) ? record.size : 0,
        mimeType: asText(record.mimeType) || undefined,
        excerpt,
        truncated: record.truncated === true,
        extractedAt: asText(record.extractedAt) || new Date(0).toISOString(),
        extraction: 'utf8_text',
      });
    }
  }

  return buildAttachmentContextPrompt(contexts.slice(-6));
}

function collectLatestManagedTodoSnapshot(history: Array<{ metadata?: unknown }>) {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const metadata = pickObject(history[index]?.metadata);
    const eventType = asText(metadata.eventType).toLowerCase();
    const toolName = asText(metadata.toolName).toLowerCase();
    if (eventType !== 'tool_call_completed' || toolName !== 'todowrite') {
      continue;
    }
    const args = pickObject(metadata.arguments);
    if (!Array.isArray(args.todos)) {
      continue;
    }
    const todos = args.todos
      .map((item) => {
        const record = pickObject(item);
        const content = asText(record.content);
        const status = asText(record.status);
        const activeForm = asText(record.activeForm);
        if (!content || !status) {
          return null;
        }
        return {
          content,
          status,
          ...(activeForm ? { activeForm } : {}),
        };
      })
      .filter((item): item is { content: string; status: string; activeForm?: string } => Boolean(item));
    if (todos.length > 0) {
      return todos;
    }
  }
  return [];
}

function buildTodoContextPrompt(history: Array<{ metadata?: unknown }>) {
  const todos = collectLatestManagedTodoSnapshot(history);
  if (todos.length === 0) {
    return '';
  }
  return [
    '# Current todo snapshot',
    'These todos are the latest successful execution snapshot for this session. Reuse and update them instead of inventing a separate plan.',
    ...todos.map((item) => `- [${item.status}] ${item.content}${item.activeForm ? ` | activeForm=${item.activeForm}` : ''}`),
  ].join('\n');
}

function normalizeAttachmentRecord(raw: unknown) {
  const record = pickObject(raw);
  const path = asText(record.path);
  const mimeType = asText(record.mimeType).toLowerCase();
  if (!path || !mimeType) return null;
  return {
    name: asText(record.name) || path.split('/').pop() || 'attachment',
    path,
    mimeType,
    size: typeof record.size === 'number' && Number.isFinite(record.size) ? record.size : 0,
    externalObjectKey: asText(record.externalObjectKey),
  };
}

function isInlineImageAttachment(raw: unknown) {
  const record = normalizeAttachmentRecord(raw);
  if (!record) return null;
  if (!INLINE_IMAGE_MIME_TYPES.has(record.mimeType)) return null;
  if (record.size > INLINE_IMAGE_MAX_BYTES) return null;
  if (record.path.startsWith('/') || record.path.includes('..')) return null;
  if (!record.externalObjectKey) return null;
  return record;
}

function extractMessageTextContent(content: ChatMessage['content']) {
  if (typeof content === 'string') {
    return asText(content);
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((item) => (item?.type === 'text' ? asText(item.text) : ''))
    .filter(Boolean)
    .join('\n')
    .trim();
}

export class AltusManagedSetupService {
  constructor(private readonly imageObjectService: ManagedImageObjectService = managedImageObjectService) {}

  private async buildInlineImageBlocks(input: {
    metadata?: unknown;
    cache: Map<string, ChatMessageContentPart>;
  }): Promise<ChatMessageContentPart[]> {
    const metadata = pickObject(input.metadata);
    const rawAttachments = Array.isArray(metadata.attachments) ? metadata.attachments : [];
    const attachments = rawAttachments
      .map((item) => isInlineImageAttachment(item))
      .filter(Boolean)
      .slice(0, INLINE_IMAGE_MAX_COUNT) as Array<{
        name: string;
        path: string;
        mimeType: string;
        size: number;
        externalObjectKey: string;
      }>;

    const results: ChatMessageContentPart[] = [];
    for (const attachment of attachments) {
      const cached = input.cache.get(attachment.externalObjectKey);
      if (cached) {
        results.push(cached);
        continue;
      }

      try {
        const signedUrl = await this.imageObjectService.getSignedDownloadUrl(attachment.externalObjectKey);
        const block: ChatMessageContentPart = {
          type: 'image_url',
          image_url: {
            url: signedUrl,
          },
          _managedObjectKey: attachment.externalObjectKey,
        };
        input.cache.set(attachment.externalObjectKey, block);
        results.push(block);
      } catch {
        continue;
      }
    }

    return results;
  }

  async ensureSessionOwnership(sessionId: string, userId: string) {
    let session = await taskCreationSessionDAO.getSession(sessionId);
    if (!session) {
      session = await taskCreationSessionDAO.createSession({
        id: sessionId,
        userId,
        status: 'in_progress',
      });
    } else if (!session.userId) {
      const rebound = await taskCreationSessionDAO.bindUserIfMissing(sessionId, userId);
      if (!rebound?.userId) {
        throw new Error('会话缺少归属用户，无法进入 Altus managed 链路');
      }
      session = rebound;
    } else if (!isSameUserId(session.userId, userId)) {
      throw new Error('当前用户无权操作该 Altus 会话');
    }

    const memory = await taskCreationFileMemoryStore.getSession(sessionId);
    if (!memory) {
      await taskCreationFileMemoryStore.createSession('待识别任务', sessionId);
      await taskCreationFileMemoryStore.addMessage(sessionId, 'system', 'session_started', '会话已创建');
    }

    await taskCreationFileMemoryStore.updateSessionMode(sessionId, 'altus');
    await taskCreationFileMemoryStore.updateSessionDriver(sessionId, 'altus');
    return session;
  }

  async captureConnectorSnapshot(sessionId: string, userId: string) {
    await sessionConnectorService.waitForAttachIdle(sessionId).catch(() => false);
    const memory = await taskCreationFileMemoryStore.getSession(sessionId).catch(() => null);
    const orchestratorSessionId = asText(memory?.runtime?.orchestratorSessionId);
    if (orchestratorSessionId) {
      await sessionMcpRecoveryService.ensureSessionRecovered(sessionId, orchestratorSessionId).catch(() => null);
    }
    await sessionConnectorService.waitForAttachIdle(sessionId).catch(() => false);
    let statuses = await sessionConnectorService.listSessionConnectors(sessionId, userId).catch(() => []);
    const attached = statuses
      .filter((item) => item.attached)
      .map((item) => ({
        connectorKey: item.connectorKey,
        profileName: item.attachedProfileName || item.selectedProfileName || null,
        authorizedRepositories: item.authorizedRepositories || [],
        runtimeStatus: item.runtimeStatus,
      }));
    const snapshot = await taskSessionRunDAO.createConnectorSnapshot({
      sessionId,
      snapshotJson: {
        attached,
      },
    });
    return {
      snapshotId: snapshot.id,
      statuses,
    };
  }

  async captureMcpToolSnapshot(sessionId: string) {
    await sessionConnectorService.waitForAttachIdle(sessionId).catch(() => false);
    const bindings = await taskSessionConnectorBindingDAO.listByTaskSessionId(sessionId).catch(() => []);
    const providers = bindings
      .filter(
        (item) =>
          item.desiredState === 'attached' &&
          asText(item.runtimeStatus).toLowerCase() === 'connected' &&
          asText(item.runtimeProviderId) &&
          isSnapshotRuntimeTransportSupported(item)
      )
      .map((item) => ({
        connectorKey: item.connectorKey,
        providerId: asText(item.runtimeProviderId),
        transport: asText(item.runtimeTransport) || null,
        envVersion: typeof item.runtimeEnvVersion === 'number' ? item.runtimeEnvVersion : 0,
          tools: Array.isArray(item.runtimeAttachedToolsJson) ? item.runtimeAttachedToolsJson : [],
      }));
    const shouldProbeLiveProviders = providers.some((item) => !Array.isArray(item.tools) || item.tools.length === 0);
    if (providers.length === 0) {
      const snapshot = await taskSessionRunDAO.createMcpToolSnapshot({
        sessionId,
        snapshotJson: {
          providers: [],
          tools: [],
        },
      });
      return {
        snapshotId: snapshot.id,
        providers: [],
      };
    }

    const sessionMemory = await taskCreationFileMemoryStore.getSession(sessionId).catch(() => null);
    const orchestratorSessionId = asText(sessionMemory?.runtime?.orchestratorSessionId);
    if (orchestratorSessionId && shouldProbeLiveProviders) {
      const expectedProviderIds = new Set(providers.map((item) => item.providerId));
      const live = await osacAgentService.listSessionMcpTools(orchestratorSessionId).catch(() => null);
      const liveProviders = Array.isArray(live?.providers)
        ? live.providers.map((item) => ({
            connectorKey: null,
            providerId: asText((item as Record<string, unknown>)?.providerId),
            transport: asText((item as Record<string, unknown>)?.transport) || null,
            envVersion:
              typeof (item as Record<string, unknown>)?.envVersion === 'number'
                ? ((item as Record<string, unknown>).envVersion as number)
                : 0,
            tools: Array.isArray((item as Record<string, unknown>)?.tools)
              ? ((item as Record<string, unknown>).tools as unknown[])
              : [],
          }))
            .filter((item) => expectedProviderIds.has(item.providerId))
        : [];
      if (liveProviders.length > 0) {
        const snapshot = await taskSessionRunDAO.createMcpToolSnapshot({
          sessionId,
          snapshotJson: {
            providers: liveProviders,
            tools: liveProviders.flatMap((item) => (Array.isArray(item.tools) ? item.tools : [])),
          },
        });
        return {
          snapshotId: snapshot.id,
          providers: liveProviders,
        };
      }
    }
    const snapshot = await taskSessionRunDAO.createMcpToolSnapshot({
      sessionId,
      snapshotJson: {
        providers,
        tools: providers.flatMap((item) => (Array.isArray(item.tools) ? item.tools : [])),
      },
    });
    return {
      snapshotId: snapshot.id,
      providers,
    };
  }

  async ensureSandbox(
    sessionId: string,
    sessionTitle?: string | null,
    options?: {
      taskIntentProfile?: AltusManagedTaskIntentProfile | null;
    }
  ) {
    const workspaceRoot = resolveOpencodeWorkspacePath(sessionId);
    const provision = await sandboxAgentProvisionService.provisionWithLock({
      executor: 'altus',
      metadata: {
        taskSessionId: sessionId,
        taskTitle: sessionTitle || undefined,
        sandboxProvider: 'e2b',
        sandboxExecutor: 'altus',
        executor: 'altus',
        workspaceRoot,
        opencodeWorkspaceRoot: workspaceRoot,
        altusMode: 'managed',
      },
    });

    await taskSessionRunDAO.upsertSandboxBinding({
      sessionId,
      sandboxId: provision.sessionId,
      workspaceRoot,
      status: 'ready',
      metadataJson: {
        provider: 'e2b',
      },
    });
    await ensureSandboxRuntimeMetadata(provision.sessionId, {
      taskSessionId: sessionId,
    }).catch(() => null);
    await taskCreationFileMemoryStore.updateSessionExecutor(sessionId, 'altus');
    await taskCreationFileMemoryStore.updateRuntimeBinding(sessionId, {
      orchestratorSessionId: provision.sessionId,
      executor: 'altus',
      workspaceRoot,
    });
    const materialization = await materializeOfficialWebShellInSandbox({
      sandboxId: provision.sessionId,
      workspaceRoot,
      taskIntentProfile: options?.taskIntentProfile,
    }).catch((error) => {
      console.warn('[OFFICIAL_WEB_SHELL_MATERIALIZATION_WARN]', {
        sessionId,
        sandboxId: provision.sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    });
    if (materialization?.applied) {
      await this.persistTimelineMessage({
        sessionId,
        role: 'system',
        messageType: 'system_template_materialized',
        content: buildOfficialWebShellMaterializationGuidance(),
        metadata: {
          eventType: 'official_web_shell_materialized',
          writtenPaths: materialization.writtenPaths,
        },
      });
    }
    void sessionMcpRecoveryService.ensureSessionRecovered(sessionId, provision.sessionId).catch(() => null);
    return {
      sandboxId: provision.sessionId,
      workspaceRoot,
      reused: provision.allocationSource === 'reused_session',
    };
  }

  async persistTimelineMessage(input: {
    sessionId: string;
    role: 'user' | 'agent' | 'system';
    messageType: string;
    content: string;
    metadata?: Record<string, unknown>;
    messageKey?: string;
  }) {
    const messageKey =
      asText(input.messageKey) ||
      `${input.sessionId}:${input.messageType}:${randomUUID()}`;
    const metadata = {
      ...(input.metadata || {}),
      messageKey,
    };
    await taskCreationFileMemoryStore.addMessage(
      input.sessionId,
      input.role,
      input.messageType,
      input.content,
      metadata
    );
    await taskCreationSessionDAO.addMessage({
      sessionId: input.sessionId,
      role: input.role === 'agent' ? 'agent' : input.role,
      messageType: input.messageType,
      content: input.content,
      metadata,
    });
  }

  async updateSessionLifecycle(
    sessionId: string,
    input: {
      status?: 'in_progress' | 'waiting_user' | 'completed' | 'failed';
      stage?: 'collecting' | 'clarifying' | 'planning' | 'executing' | 'reviewing' | 'completed' | 'failed';
      phase?: 'ideation' | 'analysis' | 'development' | 'testing' | 'repair' | 'delivery';
      clearClarification?: boolean;
    }
  ) {
    await taskCreationFileMemoryStore.updateSessionState(sessionId, {
      status: input.status,
      stage: input.stage,
      phase: input.phase,
      allowBackward: true,
    });
    if (input.status) {
      await taskCreationSessionDAO.updateSessionStatus(sessionId, input.status);
    }
    if (input.clearClarification) {
      await taskCreationFileMemoryStore.clearPendingClarification(sessionId);
    }
  }

  async buildConversationMessages(
    sessionId: string,
    currentInput: string,
    systemPrompt: string,
    options: {
      turnStatePrompt?: string | null;
    } = {}
  ): Promise<ChatMessage[]> {
    const history = await taskCreationSessionDAO.getMessages(sessionId);
    const attachmentContextPrompt = collectAttachmentContextPrompt(history);
    const todoContextPrompt = buildTodoContextPrompt(history);
    const inlineImageCache = new Map<string, ChatMessageContentPart>();
    const relevantHistory = buildManagedConversationEntries(history, { limit: 24 });
    const relevant: ChatMessage[] = [];

    for (const item of relevantHistory) {
      const role = item.role;
      if (!role) continue;
      const textContent = item.content;
      if (role !== 'user') {
        if (!textContent) continue;
        relevant.push({
          role,
          content: textContent,
        });
        continue;
      }

      const imageBlocks = await this.buildInlineImageBlocks({
        metadata: item.metadata,
        cache: inlineImageCache,
      });
      if (!textContent && imageBlocks.length === 0) {
        continue;
      }
      if (imageBlocks.length === 0) {
        relevant.push({
          role,
          content: textContent,
        });
        continue;
      }

      const content: ChatMessageContentPart[] = [];
      if (textContent) {
        content.push({
          type: 'text',
          text: textContent,
        });
      }
      content.push(...imageBlocks);
      relevant.push({
        role,
        content,
      });
    }

    const latestHistory = relevant[relevant.length - 1];
    const shouldAppendCurrentInput =
      latestHistory?.role !== 'user' || extractMessageTextContent(latestHistory.content) !== asText(currentInput);

    const turnStateMessage = asText(options.turnStatePrompt)
      ? {
          role: 'system' as const,
          content: asText(options.turnStatePrompt),
        }
      : null;
    const baseMessages: ChatMessage[] = [
      {
        role: 'system' as const,
        content: systemPrompt,
      },
      ...(attachmentContextPrompt
        ? [
            {
              role: 'system' as const,
              content: attachmentContextPrompt,
            },
          ]
        : []),
      ...(todoContextPrompt
        ? [
            {
              role: 'system' as const,
              content: todoContextPrompt,
            },
          ]
        : []),
      ...relevant,
    ];
    const currentUserMessage: ChatMessage | null = shouldAppendCurrentInput
      ? {
          role: 'user' as const,
          content: currentInput,
        }
      : null;

    if (turnStateMessage && !currentUserMessage && baseMessages[baseMessages.length - 1]?.role === 'user') {
      const lastMessage = baseMessages[baseMessages.length - 1];
      return [...baseMessages.slice(0, -1), turnStateMessage, lastMessage];
    }

    return [
      ...baseMessages,
      ...(turnStateMessage ? [turnStateMessage] : []),
      ...(currentUserMessage ? [currentUserMessage] : []),
    ];
  }

  async buildTaskIntentProfile(
    sessionId: string,
    currentInput?: string | null,
    messageType: 'user_input' | 'user_response' = 'user_input'
  ): Promise<AltusManagedTaskIntentProfile> {
    const history = await taskCreationSessionDAO.getMessages(sessionId);
    const currentText = asText(currentInput);
    const sessionMemory = await taskCreationFileMemoryStore.getSession(sessionId).catch(() => null);
    const pendingClarificationType = sessionMemory?.pendingClarificationType || null;
    const pendingQuestion = sessionMemory?.pendingQuestion || null;
    if (currentText && isPlatformCapabilityAdvisoryText(currentText)) {
      const currentTexts = [currentText];
      const advisoryProfile = deriveManagedTaskIntentProfile(currentTexts);
      const advisoryShape = classifyTaskIntentShape(currentTexts);
      return {
        ...advisoryProfile,
        ...resolveTodoDecision(advisoryShape, {
          deployableWebAppBlueprintRequired: shouldRequireDeployableWebAppBlueprint({
            profile: advisoryProfile,
            needsClarification: false,
          }),
        }),
        needsClarification: false,
        clarificationType: 'none',
        clarificationQuestion: '',
        clarificationOptions: undefined,
        clarificationTransition:
          pendingClarificationType
            ? {
                nextState: 'advisory',
                reason: 'platform_capability_advisory_current_turn',
              }
            : advisoryProfile.clarificationTransition,
      };
    }
    const contextProjection = altusManagedContextService.buildProjection(history, {
      currentInput: currentText,
      currentMessageType: messageType,
      pendingClarificationType,
      pendingQuestion,
      pendingOptions: Array.isArray(sessionMemory?.pendingOptions) ? sessionMemory.pendingOptions : null,
      clarificationTranscriptLimit: 10,
      userTextLimit: 8,
    });
    const recentTransitionMessages = contextProjection.clarificationTranscript;
    const texts = contextProjection.userTexts;
    const latestHistoryText = contextProjection.latestUserText;
    const baseProfile = deriveManagedTaskIntentProfile(texts);
    const shape = classifyTaskIntentShape(texts);
    const workspaceHints = await deriveWorkspaceTechStackHints(resolveOpencodeWorkspacePath(sessionId));
    if (
      messageType === 'user_response' &&
      currentText &&
      isDeploymentRiskConfirmationQuestion(pendingQuestion) &&
      isConfirmationLikeResponse(currentText)
    ) {
      return buildProfileFromTransition({
        baseProfile,
        shape,
        todoDecision: resolveTodoDecision(shape, {
          deployableWebAppBlueprintRequired: shouldRequireDeployableWebAppBlueprint({
            profile: baseProfile,
            needsClarification: false,
          }),
        }),
        reduced: {
          accepted: true,
          nextState: 'ready_to_execute',
          clearedPending: true,
          assumptions: [currentText],
          reason: 'confirmed_pending_deployment_risk',
        },
        currentText,
        pendingQuestion,
        texts,
      });
    }
    if (shouldUseClarificationTransitionAgent({ baseProfile, shape, pendingClarificationType })) {
      try {
        const proposal = await altusClarificationTransitionAgent.propose({
          currentText: currentText || latestHistoryText,
          recentUserTexts: texts,
          recentMessages: recentTransitionMessages,
          pendingClarificationType,
          pendingQuestion,
          pendingOptions: Array.isArray(sessionMemory?.pendingOptions) ? sessionMemory.pendingOptions : null,
          shape,
        });
        if (proposal) {
          const reduced = altusClarificationPolicyReducer.reduce(
            {
              status: pendingClarificationType ? 'clarifying' : 'none',
              pendingClarificationType,
              pendingQuestion,
            },
            proposal
          );
          if (
            reduced.accepted ||
            reduced.reason !== 'invalid_transition' ||
            Boolean(pendingClarificationType)
          ) {
            return buildProfileFromTransition({
              baseProfile,
              shape,
              todoDecision: resolveTodoDecision(shape, {
                deployableWebAppBlueprintRequired: shouldRequireDeployableWebAppBlueprint({
                  profile: baseProfile,
                  needsClarification: false,
                }),
              }),
              reduced,
              currentText,
              pendingQuestion,
              texts,
            });
          }
        }
      } catch (error) {
        console.warn('[altus] clarification transition agent failed; falling back to deterministic gate', error);
      }
    }
    if (
      messageType === 'user_response' &&
      pendingClarificationType &&
      currentText &&
      coversClarificationType(pendingClarificationType, normalizeText(currentText), workspaceHints)
    ) {
      return buildProfileFromTransition({
        baseProfile,
        shape,
        todoDecision: resolveTodoDecision(shape, {
          deployableWebAppBlueprintRequired: shouldRequireDeployableWebAppBlueprint({
            profile: baseProfile,
            needsClarification: false,
          }),
        }),
        reduced: {
          accepted: true,
          nextState: 'ready_to_execute',
          clearedPending: true,
          assumptions: [currentText],
          reason: 'answered_pending_clarification',
        },
        currentText,
        pendingQuestion,
        texts,
      });
    }
    const treatAsNewTurn = Boolean(
      messageType === 'user_response' &&
        pendingClarificationType &&
        shouldTreatPendingClarificationAsNewTurn(currentText, pendingClarificationType, workspaceHints)
    );
    const effectiveTexts = treatAsNewTurn && currentText ? [currentText] : texts;
    const effectiveMessageType = treatAsNewTurn ? 'user_input' : messageType;
    const effectiveBaseProfile = treatAsNewTurn
      ? deriveManagedTaskIntentProfile(effectiveTexts)
      : baseProfile;
    const effectiveShape = treatAsNewTurn ? classifyTaskIntentShape(effectiveTexts) : shape;
    const clarificationDecision = resolveClarificationDecision({
      shape: effectiveShape,
      currentText: normalizeText(currentText),
      messageType: effectiveMessageType,
      pendingClarificationType: treatAsNewTurn ? null : pendingClarificationType,
      workspaceHints,
    });
    const todoDecision = resolveTodoDecision(effectiveShape, {
      deployableWebAppBlueprintRequired: shouldRequireDeployableWebAppBlueprint({
        profile: effectiveBaseProfile,
        needsClarification: clarificationDecision.needsClarification,
      }),
    });

    return {
      ...effectiveBaseProfile,
      ...todoDecision,
      needsClarification: clarificationDecision.needsClarification,
      clarificationType: clarificationDecision.clarificationType,
      clarificationQuestion: clarificationDecision.clarificationQuestion,
      clarificationOptions: clarificationDecision.clarificationOptions,
    };
  }

  async refreshInlineImageUrls(messages: ChatMessage[]): Promise<ChatMessage[]> {
    for (const message of messages) {
      if (!Array.isArray(message.content)) continue;
      for (const part of message.content) {
        if (part?.type !== 'image_url') continue;
        const objectKey = asText(part._managedObjectKey);
        if (!objectKey) continue;
        part.image_url.url = await this.imageObjectService.getSignedDownloadUrl(objectKey);
      }
    }
    return messages;
  }
}

export const altusManagedSetupService = new AltusManagedSetupService();
