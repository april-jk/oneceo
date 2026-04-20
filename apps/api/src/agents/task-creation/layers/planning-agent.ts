/**
 * Layer 2: 任务规划 Agent (PlanningAgent)
 * 
 * 职责：
 * - 接收意图识别结果
 * - 收集更多信息（调用搜索 API）
 * - 与用户交互澄清细节
 * - 生成结构化任务描述
 * - 调用孙子 Agent 生成执行计划
 */

import { BaseAgent, type AgentConfig } from '../../base-agent';
import { StructuredTool } from '@langchain/core/tools';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import type { IntentRecognitionResult, TaskDescription } from '../types/intent';
import { isAwaitingUserInputError } from '../errors';
import { getPlanningPersona } from './planners/persona-registry';
import { classifyTaskIntentShape, type TaskIntentShape } from '../../../services/task-intent-shape-service';

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parsePlanningInput(raw: string) {
  const text = asText(raw);
  const marker = '\n\n用户补充：';
  if (!text.startsWith('历史任务定义：') || !text.includes(marker)) {
    return {
      effectiveUserInput: text,
      hasHistoricalBase: false,
      historicalBase: null as Record<string, unknown> | null,
    };
  }

  const baseRaw = text.slice('历史任务定义：'.length, text.indexOf(marker)).trim();
  const supplement = text.slice(text.indexOf(marker) + marker.length).trim();
  try {
    return {
      effectiveUserInput: supplement || text,
      hasHistoricalBase: true,
      historicalBase: JSON.parse(baseRaw) as Record<string, unknown>,
    };
  } catch {
    return {
      effectiveUserInput: supplement || text,
      hasHistoricalBase: true,
      historicalBase: null as Record<string, unknown> | null,
    };
  }
}

export class PlanningAgent extends BaseAgent {
  private userCallback?: (question: string, options?: string[]) => Promise<string>;
  private searchCallback?: (query: string) => Promise<any[]>;

  constructor(
    userCallback?: (question: string, options?: string[]) => Promise<string>,
    searchCallback?: (query: string) => Promise<any[]>
  ) {
    const config: AgentConfig = {
      name: 'PlanningAgent',
      description: 'Layer 2 - 任务规划和信息收集',

      // 【提示词编写位置 - Layer 2】
      systemPrompt: `你是 Altus 系统的规划 Agent。你的职责是：

1. 接收意图识别结果
2. 根据意图类型，确定需要的信息
3. 调用搜索 API 获取最新信息（如需要）
4. 与用户交互，澄清任务细节
5. 生成结构化的任务描述
6. 将任务描述传递给执行计划 Agent

工作流程：
- 分析意图类型和关键信息
- 确定是否需要搜索（根据意图类型和信息完整性）
- 如需要，调用搜索 API
- 根据搜索结果和用户输入，生成任务描述
- 如信息不足，向用户提问
- 最后，调用孙子 Agent 生成执行计划

重要原则：
- 搜索决策：只在必要时调用搜索（例如：研究、分析类任务）
- 用户交互：主动澄清不清楚的地方
- 信息整合：综合搜索结果和用户输入
- 结构化输出：生成清晰的任务描述

输出格式（必须是有效的 JSON）：
{
  "task_description": {
    "title": "Python 开发行业市场调研",
    "objective": "了解2024年Python开发行业的市场趋势和机会",
    "scope": "中文市场，重点关注Web开发和数据科学领域",
    "deliverables": ["市场分析报告", "竞争对手分析", "机会识别"],
    "constraints": ["时间：2周", "资源：1名研究员"]
  },
  "needs_clarification": false,
  "next_step": "call_execution_plan_agent"
}

如果需要澄清，设置 needs_clarification 为 true，并添加 clarification_question 字段。`,

      tools: [],
      modelName: process.env.AGENT_OPENAI_MODEL || 'claude-haiku-4-5-20251001',
      temperature: 0.7,
      maxIterations: 15,
    };

    super(config);
    this.userCallback = userCallback;
    this.searchCallback = searchCallback;
  }

  /**
   * 生成任务描述
   * 
   * @param intentResult - 意图识别结果
   * @param userInput - 原始用户输入
   * @returns 任务描述
   */
  async generateTaskDescription(
    intentResult: IntentRecognitionResult,
    userInput: string
  ): Promise<TaskDescription> {
    const planningInput = parsePlanningInput(userInput);
    const shape = classifyTaskIntentShape(
      planningInput.hasHistoricalBase
        ? [
            asText(planningInput.historicalBase?.title),
            asText(planningInput.historicalBase?.objective),
            asText(planningInput.historicalBase?.scope),
            planningInput.effectiveUserInput,
          ]
        : planningInput.effectiveUserInput
    );
    if (
      !planningInput.hasHistoricalBase &&
      intentResult.intent_type === 'software_development' &&
      ['web_app', 'script_artifact', 'business_system', 'software_artifact'].includes(shape.artifactKind)
    ) {
      return this.buildSoftwareTaskDescription(intentResult, planningInput.effectiveUserInput, shape);
    }

    const route = getPlanningPersona(intentResult.intent_type);
    const clarificationBlock = Array.isArray(route.clarificationTemplate) && route.clarificationTemplate.length > 0
      ? `澄清问题模板（如需补充信息时优先使用）：\n- ${route.clarificationTemplate.join('\n- ')}\n`
      : '';
    const deliverableBlock = Array.isArray(route.deliverableTemplate) && route.deliverableTemplate.length > 0
      ? `默认交付模板（可根据场景调整）：\n- ${route.deliverableTemplate.join('\n- ')}\n`
      : '';

    const routePrompt = `当前规划路由：${intentResult.intent_type}
规划身份：${route.roleName}
身份提示（占位，可后续替换为具体领域规划智能体提示词）：
${route.personaPrompt}
${clarificationBlock}${deliverableBlock}
`;

    let prompt = `${routePrompt}
意图识别结果：
${JSON.stringify(intentResult, null, 2)}

原始用户输入：
${userInput}

请根据意图识别结果和用户输入，生成详细的任务描述。`;

    // 如果是研究或分析类任务，考虑调用搜索
    const needsSearch = route.allowSearch && this.shouldSearch(intentResult.intent_type);
    
    if (needsSearch && this.searchCallback) {
      try {
        const searchQuery = route.buildSearchQuery
          ? route.buildSearchQuery(intentResult.key_info || {})
          : this.buildSearchQuery(intentResult);
        const searchResults = await this.searchCallback(searchQuery);
        
        if (searchResults && searchResults.length > 0) {
          prompt += `\n\n搜索结果：\n${JSON.stringify(searchResults.slice(0, 3), null, 2)}`;
        }
      } catch (error) {
        console.error('[PlanningAgent] 搜索失败:', error);
        // 继续执行，不中断流程
      }
    }

    prompt += `\n\n请以 JSON 格式返回任务描述。`;

    try {
      const result = await this.execute(prompt);

      if (!result.success) {
        throw new Error(result.error || '生成任务描述失败');
      }

      const planningResult = await this.parseJsonResponse<any>(
        result.output || '',
        '任务规划结果'
      );

      const clarificationList = Array.isArray(planningResult.clarification_questions)
        ? planningResult.clarification_questions.filter((item: any) => typeof item === 'string' && item.trim())
        : [];
      const clarificationQuestion =
        planningResult.clarification_question ||
        (clarificationList.length > 0 ? clarificationList.map((item: string) => `- ${item.trim()}`).join('\n') : '');

      // 如果需要澄清，调用用户回调
      if (planningResult.needs_clarification && clarificationQuestion && this.userCallback) {
        const userResponse = await this.userCallback(clarificationQuestion);
        
        // 使用用户的回复重新生成任务描述
        return this.generateTaskDescription(intentResult, `${userInput}\n\n用户补充信息：${userResponse}`);
      }

      if (planningResult.task_description) {
        const description = planningResult.task_description as TaskDescription;
        if (this.isIntentMismatch(intentResult, description, planningInput.effectiveUserInput)) {
          return this.buildFallbackTaskDescription(intentResult, userInput);
        }
        return description;
      }

      // 兼容模型直接返回任务描述对象的情况
      if (planningResult.title || planningResult.objective || planningResult.scope) {
        const description = planningResult as TaskDescription;
        if (this.isIntentMismatch(intentResult, description, planningInput.effectiveUserInput)) {
          return this.buildFallbackTaskDescription(intentResult, userInput);
        }
        return description;
      }

      throw new Error('任务规划结果缺少 task_description');
    } catch (error: any) {
      if (isAwaitingUserInputError(error)) {
        throw error;
      }
      console.warn('[PlanningAgent] 任务描述生成失败，使用兜底方案:', error?.message || error);

      // 兜底方案：当 JSON 解析失败时，生成基础任务描述，避免流程中断
      return this.buildFallbackTaskDescription(intentResult, userInput);
    }
  }

  private isIntentMismatch(
    intentResult: IntentRecognitionResult,
    description: TaskDescription,
    userInput: string
  ): boolean {
    const text = `${description.title || ''} ${description.objective || ''} ${
      Array.isArray(description.deliverables) ? description.deliverables.join(' ') : ''
    }`;
    const shape = classifyTaskIntentShape(userInput);
    const marketingMismatchKeywords = ['营销', '市场', '渠道', '策略', '推广'];

    if (intentResult.intent_type === 'software_development') {
      if (marketingMismatchKeywords.some((keyword) => text.includes(keyword))) {
        return true;
      }
      if (shape.artifactKind === 'script_artifact') {
        return ['网页', '网站', 'web app', '浏览器', 'playwright'].some((keyword) =>
          text.toLowerCase().includes(keyword)
        );
      }
      if (shape.explicitNoDeploy) {
        return ['部署', 'publish', 'go live'].some((keyword) => text.toLowerCase().includes(keyword));
      }
    }

    return false;
  }

  /**
   * 判断是否需要搜索
   */
  private shouldSearch(intentType: string): boolean {
    const searchIntents = [
      'research',
      'data_analysis',
      'competitor_analysis',
      'seo_optimization',
    ];
    return searchIntents.includes(intentType);
  }

  /**
   * 构建搜索查询
   */
  private buildSearchQuery(intentResult: IntentRecognitionResult): string {
    const { key_info } = intentResult;
    const parts: string[] = [];

    if (key_info.target) parts.push(key_info.target);
    if (key_info.scope) parts.push(key_info.scope);

    return parts.join(' ');
  }

  private buildFallbackTaskDescription(
    intentResult: IntentRecognitionResult,
    userInput: string
  ): TaskDescription {
    const planningInput = parsePlanningInput(userInput);
    if (intentResult.intent_type === 'software_development') {
      return this.buildSoftwareTaskDescription(
        intentResult,
        planningInput.effectiveUserInput,
        classifyTaskIntentShape(planningInput.effectiveUserInput)
      );
    }

    const intentType = intentResult.intent_type;
    const keyTarget = intentResult.key_info?.target || '';
    const normalizedInput = planningInput.effectiveUserInput.trim();
    const target = keyTarget || normalizedInput || '当前任务';
    const scope = intentResult.key_info?.scope || '按用户输入补齐范围与交付物';
    const title = normalizedInput ? normalizedInput.replace(/。/g, '') : target;

    return {
      title,
      objective: `根据用户输入整理并执行任务：${target}`,
      scope,
      deliverables: [
        '任务目标说明',
        '交付物清单',
        '关键约束与边界',
      ],
      constraints: [
        '优先遵守用户明确给出的边界条件',
        '避免将任务改写成无关领域模板',
      ],
      additional_info: {
        fallback: true,
        note: '由于解析任务描述失败，已退回到中性任务模板',
        userInput,
      },
    };
  }

  private buildSoftwareTaskDescription(
    intentResult: IntentRecognitionResult,
    userInput: string,
    shape: TaskIntentShape
  ): TaskDescription {
    const normalizedInput = asText(userInput).replace(/。/g, '') || '软件任务';
    const normalizedTarget = asText(intentResult.key_info?.target)
      .replace(/用户补充信息：/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const effectiveInput =
      normalizedTarget && normalizedTarget.length > normalizedInput.length
        ? normalizedTarget.replace(/。/g, '')
        : normalizedInput;
    const inheritedConstraints = asText(intentResult.key_info?.constraints);
    const baseConstraints = [
      shape.explicitNoDeploy ? '不要部署' : '',
      shape.explicitNoWeb ? '不要改造成网站或网页应用' : '',
      shape.sourceCodeOnly ? '只交付源码文件，不附带额外发布链路' : '',
      shape.explicitNoExternalAuth ? '不要假设任何外部平台已经授权' : '',
      inheritedConstraints,
    ].filter(Boolean);

    if (shape.artifactKind === 'script_artifact') {
      const deliverables = ['可运行的脚本源码', '输出结果或报告文件', '基础使用说明'];
      if (!/markdown/i.test(effectiveInput) && !effectiveInput.includes('markdown')) {
        deliverables[1] = '脚本输出结果';
      }
      return {
        title: effectiveInput,
        objective: `编写并验证脚本类交付物：${effectiveInput}`,
        scope: '保持脚本/CLI/分析产物形态，不改造成网页应用或部署项目',
        deliverables,
        constraints: baseConstraints.length > 0 ? baseConstraints : ['交付脚本及其结果，不扩展到网页部署链路'],
        additional_info: {
          fallback: true,
          artifactKind: shape.artifactKind,
          note: '按脚本类任务模板直接规划，避免误入网页应用模板',
        },
      };
    }

    if (shape.artifactKind === 'web_app') {
      return {
        title: effectiveInput,
        objective:
          shape.deliveryMode === 'deployable'
            ? `实现并交付可部署的网站/网页应用：${effectiveInput}`
            : `实现网站/网页应用源码：${effectiveInput}`,
        scope:
          shape.deliveryMode === 'deployable'
            ? '围绕用户目标完成网站实现，并保留可部署所需的最小正确结构'
            : '围绕用户目标完成网站源码，不触发部署或外部平台假设',
        deliverables:
          shape.deliveryMode === 'deployable'
            ? ['可运行的网站或网页应用', '完整源代码', '部署所需配置与使用说明']
            : ['网站源代码', '关键页面与资源文件', '本地使用或预览说明'],
        constraints:
          baseConstraints.length > 0
            ? baseConstraints
            : ['保持网站任务形态，不改写成营销策划或其他非软件任务'],
        additional_info: {
          fallback: true,
          artifactKind: shape.artifactKind,
          note: '按网站类任务模板直接规划，避免误入营销或脚本模板',
        },
      };
    }

    return {
      title: effectiveInput,
      objective: `基于用户需求完成软件开发任务：${effectiveInput}`,
      scope:
        shape.needsClarification
          ? '需要先澄清使用角色、核心模块和交付形态，再进入实现'
          : '围绕用户目标完成核心功能实现',
      deliverables: ['源代码', '核心功能实现', '基础使用说明'],
      constraints:
        shape.needsClarification
          ? [
              '先确认主要使用角色',
              '先确认必须包含的核心模块',
              '先确认本次只要源码、本地运行还是需要部署',
              ...baseConstraints,
            ].filter(Boolean)
          : baseConstraints.length > 0
            ? baseConstraints
            : ['保持当前软件任务边界，不改写成营销策划或网页部署模板'],
      additional_info: {
        fallback: true,
        artifactKind: shape.artifactKind,
        note:
          shape.artifactKind === 'business_system'
            ? '识别为业务系统类软件任务，已阻止营销模板兜底'
            : '按软件任务模板直接规划',
      },
    };
  }

  /**
   * 设置回调函数
   */
  setUserCallback(callback: (question: string, options?: string[]) => Promise<string>) {
    this.userCallback = callback;
  }

  setSearchCallback(callback: (query: string) => Promise<any[]>) {
    this.searchCallback = callback;
  }
}

/**
 * 导出单例实例
 */
export const planningAgent = new PlanningAgent();
