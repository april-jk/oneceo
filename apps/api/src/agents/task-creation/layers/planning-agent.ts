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
      modelName: 'claude-sonnet-4-5-20250929', // 平衡性能的任务规划
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
    let prompt = `意图识别结果：
${JSON.stringify(intentResult, null, 2)}

原始用户输入：
${userInput}

请根据意图识别结果和用户输入，生成详细的任务描述。`;

    // 如果是研究或分析类任务，考虑调用搜索
    const needsSearch = this.shouldSearch(intentResult.intent_type);
    
    if (needsSearch && this.searchCallback) {
      try {
        const searchQuery = this.buildSearchQuery(intentResult);
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

    const result = await this.execute(prompt);

    if (!result.success) {
      throw new Error(result.error || '生成任务描述失败');
    }

    try {
      const planningResult = await this.parseJsonResponse<any>(
        result.output || '',
        '任务规划结果'
      );

      // 如果需要澄清，调用用户回调
      if (planningResult.needs_clarification && planningResult.clarification_question && this.userCallback) {
        const userResponse = await this.userCallback(planningResult.clarification_question);
        
        // 使用用户的回复重新生成任务描述
        return this.generateTaskDescription(intentResult, `${userInput}\n\n用户补充信息：${userResponse}`);
      }

      return planningResult.task_description;
    } catch (error: any) {
      if (isAwaitingUserInputError(error)) {
        throw error;
      }
      throw new Error(`解析任务描述失败: ${error.message}`);
    }
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
