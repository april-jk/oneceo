import type { DirectModeCapabilityId } from './direct-mode-capability-types';

export type PlatformCapabilityIntentKind =
  | 'explicit_action'
  | 'capability_question'
  | 'how_to_advice'
  | 'requirement_discussion'
  | 'concept_question'
  | 'unclear'
  | 'not_related';

export type PlatformCapabilityKind =
  | 'deploy'
  | 'redeploy'
  | 'rollback'
  | 'deployment_status';

export type PlatformCapabilityIntentMode =
  | 'execute'
  | 'answer_capability'
  | 'explain_how_to'
  | 'discuss_requirement'
  | 'explain_concept'
  | 'normal_task'
  | 'unclear';

export type PlatformCapabilityTopic =
  | 'vercel'
  | 'railway'
  | 'deployment'
  | 'domain';

export type PlatformCapabilityIntentDecision = {
  mode: PlatformCapabilityIntentMode;
  intentKind: PlatformCapabilityIntentKind;
  topic: PlatformCapabilityTopic | null;
  capabilityKind: PlatformCapabilityKind | null;
  directModeCapabilityId: DirectModeCapabilityId | null;
  shouldExecute: boolean;
  confidence: number;
  reason: string;
};

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalize(value: unknown) {
  return asText(value).toLowerCase();
}

function includesAny(text: string, values: readonly string[]) {
  return values.some((value) => text.includes(value));
}

const PLATFORM_TOPIC_MARKERS = [
  '部署',
  '发布',
  '上线',
  'deploy',
  'deployment',
  'publish',
  'go live',
  'vercel',
  'railway',
  '域名',
] as const;

const CAPABILITY_QUESTION_MARKERS = [
  '支持',
  '具有',
  '有没有',
  '是否有',
  '是否具有',
  '能用',
  '能用吗',
  '能不能',
  '可以吗',
  '可以不',
  '能否',
  '能力',
  'capability',
  'can you',
  'do you support',
] as const;

const HOW_TO_MARKERS = [
  '怎么',
  '如何',
  '怎样',
  '教程',
  '步骤',
  '方案',
  '流程',
  '文档',
  'how to',
  'guide',
  'tutorial',
] as const;

const REQUIREMENT_DISCUSSION_MARKERS = [
  '要不要',
  '是否需要',
  '需不需要',
  '需要吗',
  '应该',
  '适合',
  '选择',
  '比较',
  '还是',
  'should',
] as const;

const CONCEPT_QUESTION_MARKERS = [
  '是什么',
  '什么意思',
  '区别',
  '限制',
  '费用',
  '概念',
  'what is',
  'meaning',
] as const;

const DEPLOY_ACTION_MARKERS = [
  '帮我部署',
  '请部署',
  '部署一下',
  '直接部署',
  '开始部署',
  '触发部署',
  '部署当前',
  '部署这个',
  '帮我发布',
  '请发布',
  '发布一下',
  '直接发布',
  '上线吧',
  '帮我上线',
  '请上线',
  'go live',
  'deploy this',
  'deploy current',
  'please deploy',
] as const;

const REDEPLOY_ACTION_MARKERS = [
  '重新部署',
  '重部署',
  '再部署',
  '重新发布',
  '再次发布',
  'redeploy',
] as const;

const ROLLBACK_ACTION_MARKERS = [
  '帮我回滚',
  '请回滚',
  '回滚一下',
  '回滚到',
  '恢复上一个部署',
  'rollback',
  'revert deployment',
] as const;

const STATUS_ACTION_MARKERS = [
  '查看当前部署状态',
  '查看部署状态',
  '查一下部署状态',
  '查询部署状态',
  '看下部署状态',
  '看一下部署状态',
  '当前部署状态',
  '最新部署状态',
  '部署进度',
  '部署 url',
  '部署地址',
  'deployment status',
] as const;

function detectTopic(text: string): PlatformCapabilityTopic {
  if (text.includes('vercel')) return 'vercel';
  if (text.includes('railway')) return 'railway';
  if (text.includes('域名')) return 'domain';
  return 'deployment';
}

function buildDecision(input: Omit<PlatformCapabilityIntentDecision, 'directModeCapabilityId'>): PlatformCapabilityIntentDecision {
  const directModeCapabilityId =
    input.capabilityKind === 'deploy'
      ? 'deploy_session_website'
      : input.capabilityKind === 'redeploy'
        ? 'redeploy_session_website'
        : input.capabilityKind === 'rollback'
          ? 'rollback_session_deployment'
          : input.capabilityKind === 'deployment_status'
            ? 'get_session_deployment_status'
            : null;
  return {
    ...input,
    directModeCapabilityId,
  };
}

function classifyOne(text: string): PlatformCapabilityIntentDecision {
  if (!text || !includesAny(text, PLATFORM_TOPIC_MARKERS)) {
    return buildDecision({
      mode: 'normal_task',
      intentKind: 'not_related',
      topic: null,
      capabilityKind: null,
      shouldExecute: false,
      confidence: 0.95,
      reason: '未涉及平台能力主题',
    });
  }
  const topic = detectTopic(text);

  const hasCapabilityQuestion = includesAny(text, CAPABILITY_QUESTION_MARKERS);
  const hasHowTo = includesAny(text, HOW_TO_MARKERS);
  const hasRequirementDiscussion = includesAny(text, REQUIREMENT_DISCUSSION_MARKERS);
  const hasConceptQuestion = includesAny(text, CONCEPT_QUESTION_MARKERS);
  const hasQuestionPunctuation = text.includes('?') || text.includes('？') || text.endsWith('吗');

  if (hasConceptQuestion) {
    return buildDecision({
      mode: 'explain_concept',
      intentKind: 'concept_question',
      topic,
      capabilityKind: null,
      shouldExecute: false,
      confidence: 0.9,
      reason: '用户在询问部署相关概念，不是要求执行平台能力',
    });
  }
  if (hasHowTo) {
    return buildDecision({
      mode: 'explain_how_to',
      intentKind: 'how_to_advice',
      topic,
      capabilityKind: null,
      shouldExecute: false,
      confidence: 0.9,
      reason: '用户在询问部署方案或步骤，不是要求执行平台能力',
    });
  }
  if (hasCapabilityQuestion || hasQuestionPunctuation) {
    return buildDecision({
      mode: 'answer_capability',
      intentKind: 'capability_question',
      topic,
      capabilityKind: null,
      shouldExecute: false,
      confidence: 0.88,
      reason: '用户在询问平台能力是否可用，不是要求立刻执行',
    });
  }
  if (hasRequirementDiscussion) {
    return buildDecision({
      mode: 'discuss_requirement',
      intentKind: 'requirement_discussion',
      topic,
      capabilityKind: null,
      shouldExecute: false,
      confidence: 0.86,
      reason: '用户在讨论交付边界，不是要求立刻执行平台能力',
    });
  }

  if (includesAny(text, ROLLBACK_ACTION_MARKERS)) {
    return buildDecision({
      mode: 'execute',
      intentKind: 'explicit_action',
      topic,
      capabilityKind: 'rollback',
      shouldExecute: true,
      confidence: 0.92,
      reason: '用户明确要求执行部署回滚',
    });
  }
  if (includesAny(text, REDEPLOY_ACTION_MARKERS)) {
    return buildDecision({
      mode: 'execute',
      intentKind: 'explicit_action',
      topic,
      capabilityKind: 'redeploy',
      shouldExecute: true,
      confidence: 0.92,
      reason: '用户明确要求执行重新部署',
    });
  }
  if (includesAny(text, STATUS_ACTION_MARKERS)) {
    return buildDecision({
      mode: 'execute',
      intentKind: 'explicit_action',
      topic,
      capabilityKind: 'deployment_status',
      shouldExecute: true,
      confidence: 0.92,
      reason: '用户明确要求查询当前部署状态',
    });
  }
  if (includesAny(text, DEPLOY_ACTION_MARKERS)) {
    return buildDecision({
      mode: 'execute',
      intentKind: 'explicit_action',
      topic,
      capabilityKind: 'deploy',
      shouldExecute: true,
      confidence: 0.92,
      reason: '用户明确要求执行部署',
    });
  }

  return buildDecision({
    mode: 'unclear',
    intentKind: 'unclear',
    topic,
    capabilityKind: null,
    shouldExecute: false,
    confidence: 0.45,
    reason: '涉及部署主题，但缺少明确执行动作',
  });
}

export function classifyPlatformCapabilityIntent(input: string | string[]): PlatformCapabilityIntentDecision {
  const texts = Array.isArray(input) ? input : [input];
  const normalizedTexts = texts.map(normalize).filter(Boolean);
  const latest = normalizedTexts[normalizedTexts.length - 1] || '';
  const latestDecision = classifyOne(latest);
  if (latestDecision.intentKind !== 'not_related') {
    return latestDecision;
  }
  const combined = normalizedTexts.join('\n');
  const combinedDecision = classifyOne(combined);
  if (combinedDecision.shouldExecute) {
    return buildDecision({
      mode: 'unclear',
      intentKind: 'unclear',
      topic: combinedDecision.topic,
      capabilityKind: combinedDecision.capabilityKind,
      shouldExecute: false,
      confidence: 0.4,
      reason: '历史上下文涉及平台动作，但当前轮没有明确执行授权',
    });
  }
  return combinedDecision;
}

export function isPlatformCapabilityTopic(input: string | string[]) {
  const text = (Array.isArray(input) ? input : [input]).map(normalize).join('\n');
  return includesAny(text, PLATFORM_TOPIC_MARKERS);
}
