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
      modelName: 'claude-haiku-4-5-20251001', // 快速响应的意图识别
      temperature: 0.7,
      maxIterations: 10,
    };

    super(config);
    this.userCallback = userCallback;
  }

  /**
   * 识别用户意图
   * 
   * @param userInput - 用户输入的任务描述
   * @returns 意图识别结果
   */
  async recognizeIntent(userInput: string): Promise<IntentRecognitionResult> {
    const prompt = `用户输入：${userInput}

请分析用户的意图，并以 JSON 格式返回识别结果。`;

    const result = await this.execute(prompt);

    if (!result.success) {
      throw new Error(result.error || '意图识别失败');
    }

    try {
      const intentResult = await this.parseJsonResponse<IntentRecognitionResult>(
        result.output || '',
        '意图识别结果'
      );

      // 如果需要澄清，调用用户回调
      if (intentResult.clarification_needed && intentResult.clarification_question && this.userCallback) {
        const userResponse = await this.userCallback(intentResult.clarification_question);
        
        // 使用用户的回复重新识别意图
        return this.recognizeIntent(`${userInput}\n\n用户补充信息：${userResponse}`);
      }

      return intentResult;
    } catch (error: any) {
      throw new Error(`解析意图识别结果失败: ${error.message}`);
    }
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
