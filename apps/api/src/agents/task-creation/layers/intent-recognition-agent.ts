/**
 * Layer 1: 意图识别 Agent (IntentRecognitionAgent)
 * 
 * 职责：
 * - 解析用户输入
 * - 识别意图类型
 * - 提取关键信息
 * - 决定是否需要澄清
 * - 路由到对应的子 Agent
 */

import { BaseAgent, type AgentConfig } from '../../base-agent';
import { StructuredTool } from '@langchain/core/tools';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { IntentType, type IntentRecognitionResult } from '../types/intent';
import { isAwaitingUserInputError } from '../errors';
import { classifyTaskIntentShape } from '../../../services/task-intent-shape-service';

export class IntentRecognitionAgent extends BaseAgent {
  private userCallback?: (question: string, options?: string[]) => Promise<string>;

  constructor(userCallback?: (question: string, options?: string[]) => Promise<string>) {
    const config: AgentConfig = {
      name: 'IntentRecognitionAgent',
      description: 'Layer 1 - 意图识别和路由',

      // 【提示词编写位置 - Layer 1】
      systemPrompt: `你是 Altus 系统的意图识别 Agent。你的职责是：

1. 理解用户的自然语言输入
2. 识别用户的意图类型（研究、分析、优化、创建、策略等）
3. 提取关键信息（目标、范围、约束等）
4. 如果信息不足，向用户提问澄清
5. 将识别结果传递给下一层 Agent

意图类型包括：
- research: 行业调研、市场分析
- data_analysis: 数据分析、统计
- competitor_analysis: 竞争对手分析
- seo_optimization: SEO 优化
- content_optimization: 内容优化
- content_creation: 内容创建
- design_creation: 设计创建（图表、PPT等）
- software_development: 软件开发
- strategy_planning: 策略规划
- business_planning: 商业规划
- other: 其他类型

重要原则：
- 高自主性：尽可能根据现有信息做出判断
- 高清晰度：如果不确定，主动向用户提问
- 简洁明了：用户应该能看到你在做什么

输出格式（必须是有效的 JSON）：
{
  "intent_type": "research",
  "confidence": 0.95,
  "key_info": {
    "target": "Python 开发行业",
    "scope": "2024年市场趋势",
    "constraints": "中文资源优先"
  },
  "clarification_needed": false,
  "next_agent": "planning_agent"
}

如果需要澄清，设置 clarification_needed 为 true，并添加 clarification_question 字段。`,

      tools: [],
      modelName: process.env.AGENT_OPENAI_MODEL || 'claude-haiku-4-5-20251001',
      temperature: 0.7,
      maxIterations: 10,
    };

    super(config);
    this.userCallback = userCallback;
  }

  private containsKeyword(input: string, keywords: string[]): boolean {
    return keywords.some((kw) => input.includes(kw));
  }

  private isLikelySoftwareIntent(userInput: string): boolean {
    const text = userInput.toLowerCase();
    const softwareKeywords = [
      'html',
      'css',
      'javascript',
      'js',
      'typescript',
      'ts',
      'react',
      'vue',
      'node',
      'api',
      'web',
      'app',
      'game',
      '小游戏',
      '游戏',
      '网页',
      '前端',
      '后端',
      '程序',
      '代码',
      '开发',
      '编程',
      '脚本',
      '应用',
      '接口',
      '算法',
      '实现',
    ];
    const marketingKeywords = [
      '营销',
      '市场',
      '策略',
      '推广',
      '投放',
      '品牌',
      '渠道',
      '增长',
      '运营',
      '商业',
      '销售',
    ];
    const hasSoftware = this.containsKeyword(text, softwareKeywords);
    const hasMarketing = this.containsKeyword(text, marketingKeywords);
    return hasSoftware && !hasMarketing;
  }

  private coerceIntent(userInput: string, intentResult: IntentRecognitionResult): IntentRecognitionResult {
    const shape = classifyTaskIntentShape(userInput);
    if (shape.suggestedIntentType === IntentType.SOFTWARE_DEVELOPMENT) {
      const constraints = [
        shape.explicitNoDeploy ? '不要部署' : '',
        shape.explicitNoWeb ? '不要改造成网站' : '',
        shape.sourceCodeOnly ? '只交付源码' : '',
        shape.explicitNoExternalAuth ? '不要假设已授权任何外部平台' : '',
      ]
        .filter(Boolean)
        .join('；');

      return {
        ...intentResult,
        intent_type: IntentType.SOFTWARE_DEVELOPMENT,
        confidence: Math.max(0.82, intentResult.confidence || 0),
        key_info: {
          ...intentResult.key_info,
          target: intentResult.key_info?.target || userInput.slice(0, 80),
          constraints: constraints || intentResult.key_info?.constraints || '',
        },
        clarification_needed: shape.needsClarification,
        clarification_question: shape.clarificationQuestion || intentResult.clarification_question,
        clarification_questions:
          shape.clarificationQuestions.length > 0
            ? shape.clarificationQuestions
            : intentResult.clarification_questions,
        next_agent: shape.needsClarification ? 'user_clarification' : 'planning_agent',
      };
    }

    if (!this.isLikelySoftwareIntent(userInput)) {
      return intentResult;
    }

    if (intentResult.intent_type === IntentType.SOFTWARE_DEVELOPMENT) {
      return intentResult;
    }

    return {
      ...intentResult,
      intent_type: IntentType.SOFTWARE_DEVELOPMENT,
      confidence: Math.max(0.72, intentResult.confidence || 0),
      key_info: {
        ...intentResult.key_info,
        target: intentResult.key_info?.target || userInput.slice(0, 80),
      },
    };
  }

  /**
   * 识别用户意图
   * 
   * @param userInput - 用户输入的任务描述
   * @returns 意图识别结果
   */
  async recognizeIntent(userInput: string): Promise<IntentRecognitionResult> {
    const shape = classifyTaskIntentShape(userInput);
    if (shape.suggestedIntentType === IntentType.SOFTWARE_DEVELOPMENT) {
      const deterministicIntent = this.coerceIntent(userInput, {
        intent_type: IntentType.SOFTWARE_DEVELOPMENT,
        confidence: 0.92,
        key_info: {
          target: userInput.slice(0, 80),
          scope: shape.artifactKind,
          constraints: '',
        },
        clarification_needed: shape.needsClarification,
        clarification_question: shape.clarificationQuestion || undefined,
        clarification_questions: shape.clarificationQuestions,
        next_agent: shape.needsClarification ? 'user_clarification' : 'planning_agent',
      });

      if (
        deterministicIntent.clarification_needed &&
        deterministicIntent.clarification_question &&
        this.userCallback
      ) {
        const userResponse = await this.userCallback(deterministicIntent.clarification_question);
        return this.recognizeIntent(`${userInput}\n\n用户补充信息：${userResponse}`);
      }

      return deterministicIntent;
    }

    const prompt = `用户输入：${userInput}

请分析用户的意图，并以 JSON 格式返回识别结果。`;

    try {
      const result = await this.execute(prompt);

      if (!result.success) {
        throw new Error(result.error || '意图识别失败');
      }

      const intentResult = await this.parseJsonResponse<IntentRecognitionResult>(
        result.output || '',
        '意图识别结果'
      );

      const clarificationList = Array.isArray(intentResult.clarification_questions)
        ? intentResult.clarification_questions.filter((item) => typeof item === 'string' && item.trim())
        : [];
      const clarificationQuestion =
        intentResult.clarification_question ||
        (clarificationList.length > 0 ? clarificationList.map((item) => `- ${item.trim()}`).join('\n') : '');

      // 如果需要澄清，调用用户回调
      if (intentResult.clarification_needed && clarificationQuestion && this.userCallback) {
        const userResponse = await this.userCallback(clarificationQuestion);

        // 使用用户的回复重新识别意图
        return this.recognizeIntent(`${userInput}\n\n用户补充信息：${userResponse}`);
      }

      return this.coerceIntent(userInput, intentResult);
    } catch (error: any) {
      if (isAwaitingUserInputError(error)) {
        throw error;
      }
      console.warn('[IntentRecognitionAgent] 识别失败，使用兜底意图:', error?.message || error);
      const fallback = this.buildFallbackIntent(userInput);
      return this.coerceIntent(userInput, fallback);
    }
  }

  private buildFallbackIntent(userInput: string): IntentRecognitionResult {
    const text = userInput.toLowerCase();
    const contains = (keywords: string[]) => keywords.some((kw) => text.includes(kw));

    let intentType: IntentType = IntentType.OTHER;
    if (contains(['调研', 'research', '市场'])) {
      intentType = IntentType.RESEARCH;
    } else if (contains(['分析', 'analysis', '数据'])) {
      intentType = IntentType.DATA_ANALYSIS;
    } else if (contains(['seo', '优化'])) {
      intentType = IntentType.SEO_OPTIMIZATION;
    } else if (contains(['营销', '策略', 'plan', '规划'])) {
      intentType = IntentType.STRATEGY_PLANNING;
    } else if (contains(['开发', '代码', '软件', 'program', 'html', 'css', 'js', 'javascript', '游戏', '小游戏', '网页'])) {
      intentType = IntentType.SOFTWARE_DEVELOPMENT;
    } else if (contains(['设计', 'ui', 'ux'])) {
      intentType = IntentType.DESIGN_CREATION;
    }

    return {
      intent_type: intentType,
      confidence: 0.6,
      key_info: {
        target: userInput.slice(0, 80),
        scope: '待补充',
        constraints: '待确认',
      },
      clarification_needed: false,
      next_agent: 'planning_agent',
    } as IntentRecognitionResult;
  }

  /**
   * 设置用户回调函数
   */
  setUserCallback(callback: (question: string, options?: string[]) => Promise<string>) {
    this.userCallback = callback;
  }
}

/**
 * 导出单例实例
 */
export const intentRecognitionAgent = new IntentRecognitionAgent();
