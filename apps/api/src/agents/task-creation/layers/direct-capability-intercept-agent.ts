import { BaseAgent, type AgentConfig } from '../../base-agent';
import {
  DIRECT_MODE_CAPABILITY_IDS,
  type DirectModeCapabilityId,
  type DirectModeEntryDecision,
} from '../../../services/direct-mode-capability-types';
import {
  classifyPlatformCapabilityIntent,
  isPlatformCapabilityTopic,
  type PlatformCapabilityIntentKind,
} from '../../../services/platform-capability-intent-service';

type LlmDecisionPayload = {
  isExplicitPlatformRequest?: boolean;
  capabilityId?: string;
  intentKind?: PlatformCapabilityIntentKind;
  confidence?: number;
  reason?: string;
};

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function clampConfidence(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(1, parsed));
}

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function normalizeContent(content: string): string {
  return content.trim().toLowerCase();
}

const DEVELOPMENT_KEYWORDS = [
  '开发',
  '实现',
  '修改',
  '改完',
  '修复',
  '重构',
  '新增',
  '创建页面',
  '写代码',
  'build a',
  'implement',
  'refactor',
  'fix',
];

export class DirectCapabilityInterceptAgent extends BaseAgent {
  constructor() {
    const config: AgentConfig = {
      name: 'DirectCapabilityInterceptAgent',
      description: '直通模式 Layer 1 - 平台能力拦截判定',
      systemPrompt: `你是 oneceo 直通模式入口层的能力拦截 Agent。

你的唯一职责是判断一条用户消息是否在明确要求平台立刻执行“已有平台能力”。

重要约束：
1. 你不是规划 Agent，不做任务拆解
2. 你不是代码执行 Agent，不改写用户任务
3. 如果用户是在要求“开发/修改/实现/修复功能”，一律返回不拦截
4. 只有当用户明确要求平台执行已有能力时才可命中
5. 如果不确定，必须返回不拦截
6. 只能从给定 capabilityId 列表中选择，不能发明新能力

输出必须是严格 JSON：
{
  "isExplicitPlatformRequest": true,
  "capabilityId": "deploy_session_website",
  "intentKind": "explicit_action",
  "confidence": 0.98,
  "reason": "用户明确要求立即部署当前网站"
}`,
      tools: [],
      modelName: process.env.AGENT_OPENAI_MODEL || 'claude-haiku-4-5-20251001',
      temperature: 0.1,
      maxIterations: 1,
    };

    super(config);
  }

  private createPassthroughDecision(
    reason: string,
    source: DirectModeEntryDecision['source'] = 'fallback',
    confidence = 0.15
  ): DirectModeEntryDecision {
    return {
      action: 'passthrough',
      confidence,
      reason,
      source,
    };
  }

  private createCapabilityDecision(
    capabilityId: DirectModeCapabilityId,
    reason: string,
    source: DirectModeEntryDecision['source'],
    confidence: number
  ): DirectModeEntryDecision {
    return {
      action: 'platform_capability',
      capabilityId,
      confidence,
      reason,
      source,
    };
  }

  private hasDevelopmentIntent(text: string): boolean {
    return includesAny(text, DEVELOPMENT_KEYWORDS);
  }

  private isMixedDevelopmentAndPlatformRequest(text: string): boolean {
    return this.hasDevelopmentIntent(text) && isPlatformCapabilityTopic(text);
  }

  private pickCapabilityFromHeuristic(
    text: string,
    availableCapabilities: Set<DirectModeCapabilityId>
  ): DirectModeEntryDecision | null {
    if (this.isMixedDevelopmentAndPlatformRequest(text)) {
      return this.createPassthroughDecision('同时包含开发诉求与平台动作，按直通放行', 'heuristic', 0.9);
    }

    const capabilityIntent = classifyPlatformCapabilityIntent(text);
    if (capabilityIntent.mode === 'execute' && capabilityIntent.directModeCapabilityId) {
      if (availableCapabilities.has(capabilityIntent.directModeCapabilityId)) {
        return this.createCapabilityDecision(
          capabilityIntent.directModeCapabilityId,
          capabilityIntent.reason,
          'heuristic',
          capabilityIntent.confidence
        );
      }
      return this.createPassthroughDecision(
        `平台能力未注册：${capabilityIntent.directModeCapabilityId}`,
        'heuristic',
        0.85
      );
    }
    if (capabilityIntent.intentKind !== 'not_related' && capabilityIntent.intentKind !== 'unclear') {
      return this.createPassthroughDecision(capabilityIntent.reason, 'heuristic', capabilityIntent.confidence);
    }

    return null;
  }

  private shouldUseLlm(text: string): boolean {
    return isPlatformCapabilityTopic(text) && !this.hasDevelopmentIntent(text);
  }

  async decide(input: {
    content: string;
    availableCapabilities: readonly DirectModeCapabilityId[];
  }): Promise<DirectModeEntryDecision> {
    const text = normalizeContent(input.content || '');
    const availableCapabilities = new Set<DirectModeCapabilityId>(
      (input.availableCapabilities || []).filter((item): item is DirectModeCapabilityId =>
        DIRECT_MODE_CAPABILITY_IDS.includes(item)
      )
    );

    if (!text) {
      return this.createPassthroughDecision('消息为空', 'fallback', 1);
    }

    const heuristic = this.pickCapabilityFromHeuristic(text, availableCapabilities);
    if (heuristic) {
      return heuristic;
    }

    if (this.hasDevelopmentIntent(text)) {
      return this.createPassthroughDecision('识别为常规开发/修改需求', 'heuristic', 0.96);
    }

    if (!this.shouldUseLlm(text)) {
      return this.createPassthroughDecision('未命中平台能力特征，保持直通', 'heuristic', 0.9);
    }

    try {
      const prompt = `用户消息：
${input.content}

可用 capabilityId 列表：
${Array.from(availableCapabilities).join(', ')}

请判断用户是在要求立即执行平台能力，还是只是询问能力、咨询方案、讨论边界或解释概念。

必须区分：
- explicit_action: 直接执行能力，例如“帮我部署当前项目”“重新部署一下”“看下部署状态”
- capability_question: 询问是否支持或具备能力，例如“你支持 Vercel 部署吗？”
- how_to_advice: 询问如何做或方案步骤，例如“怎么部署到 Vercel？”
- requirement_discussion: 讨论是否需要或是否适合，例如“这个项目要不要部署？”
- concept_question: 询问概念含义，例如“部署状态是什么意思？”
- not_related: 与平台能力无关

只有 intentKind=explicit_action 时，isExplicitPlatformRequest 才能为 true。
输出严格 JSON。`;
      const result = await this.execute(prompt);
      if (!result.success) {
        throw new Error(result.error || 'LLM 判定失败');
      }

      const payload = await this.parseJsonResponse<LlmDecisionPayload>(
        result.output || '',
        '直通模式入口判定结果'
      );

      const capabilityId = asText(payload.capabilityId) as DirectModeCapabilityId;
      const isExplicit = Boolean(payload.isExplicitPlatformRequest);
      const intentKind = asText(payload.intentKind);
      const confidence = clampConfidence(payload.confidence, isExplicit ? 0.8 : 0.2);
      const reason = asText(payload.reason) || 'LLM 未提供判定理由';

      if (
        isExplicit &&
        intentKind === 'explicit_action' &&
        confidence >= 0.8 &&
        capabilityId &&
        availableCapabilities.has(capabilityId)
      ) {
        return this.createCapabilityDecision(capabilityId, reason, 'llm', confidence);
      }

      return this.createPassthroughDecision(reason || 'LLM 未命中平台能力', 'llm', confidence);
    } catch (error: any) {
      return this.createPassthroughDecision(
        `入口判定回退为直通：${asText(error?.message) || 'LLM 不可用'}`,
        'fallback',
        0.3
      );
    }
  }
}

export const directCapabilityInterceptAgent = new DirectCapabilityInterceptAgent();
