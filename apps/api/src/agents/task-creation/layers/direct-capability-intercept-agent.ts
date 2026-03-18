import { BaseAgent, type AgentConfig } from '../../base-agent';
import {
  DIRECT_MODE_CAPABILITY_IDS,
  type DirectModeCapabilityId,
  type DirectModeEntryDecision,
} from '../../../services/direct-mode-capability-types';

type LlmDecisionPayload = {
  isExplicitPlatformRequest?: boolean;
  capabilityId?: string;
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

const DEPLOY_KEYWORDS = ['部署', '上线', '发布', 'deploy', 'ship', 'go live'];
const REDEPLOY_KEYWORDS = ['重新部署', '重部署', '再部署', 'redeploy'];
const ROLLBACK_KEYWORDS = ['回滚', '恢复上一个部署', 'rollback'];
const STATUS_KEYWORDS = ['部署状态', '发布状态', '查看部署', '当前部署', '最新部署', 'deployment status'];
const PLATFORM_HINT_KEYWORDS = [
  ...DEPLOY_KEYWORDS,
  ...REDEPLOY_KEYWORDS,
  ...ROLLBACK_KEYWORDS,
  ...STATUS_KEYWORDS,
  'railway',
  '域名',
];
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

  private hasPlatformHint(text: string): boolean {
    return includesAny(text, PLATFORM_HINT_KEYWORDS);
  }

  private isMixedDevelopmentAndPlatformRequest(text: string): boolean {
    return this.hasDevelopmentIntent(text) && this.hasPlatformHint(text);
  }

  private pickCapabilityFromHeuristic(
    text: string,
    availableCapabilities: Set<DirectModeCapabilityId>
  ): DirectModeEntryDecision | null {
    if (this.isMixedDevelopmentAndPlatformRequest(text)) {
      return this.createPassthroughDecision('同时包含开发诉求与平台动作，按直通放行', 'heuristic', 0.9);
    }

    if (includesAny(text, STATUS_KEYWORDS) && availableCapabilities.has('get_session_deployment_status')) {
      return this.createCapabilityDecision(
        'get_session_deployment_status',
        '用户明确要求查看部署状态',
        'heuristic',
        0.99
      );
    }

    if (includesAny(text, ROLLBACK_KEYWORDS) && availableCapabilities.has('rollback_session_deployment')) {
      return this.createCapabilityDecision(
        'rollback_session_deployment',
        '用户明确要求回滚部署',
        'heuristic',
        0.99
      );
    }

    if (includesAny(text, REDEPLOY_KEYWORDS) && availableCapabilities.has('redeploy_session_website')) {
      return this.createCapabilityDecision(
        'redeploy_session_website',
        '用户明确要求重新部署当前项目',
        'heuristic',
        0.99
      );
    }

    if (includesAny(text, DEPLOY_KEYWORDS) && availableCapabilities.has('deploy_session_website')) {
      return this.createCapabilityDecision(
        'deploy_session_website',
        '用户明确要求部署当前网站或项目',
        'heuristic',
        0.98
      );
    }

    return null;
  }

  private shouldUseLlm(text: string): boolean {
    return this.hasPlatformHint(text) && !this.hasDevelopmentIntent(text);
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

请判断用户是否在明确要求平台立即执行某个已有能力，而不是要求执行器开发或修改代码。`;
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
      const confidence = clampConfidence(payload.confidence, isExplicit ? 0.8 : 0.2);
      const reason = asText(payload.reason) || 'LLM 未提供判定理由';

      if (
        isExplicit &&
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
