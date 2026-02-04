/**
 * 基础 Agent 类
 * 
 * 为所有智能体提供通用的基础功能和接口
 */

import { ChatOpenAI } from '@langchain/openai';
import type { BaseMessage } from '@langchain/core/messages';
import type { StructuredTool } from '@langchain/core/tools';

/**
 * Agent 配置接口
 */
export interface AgentConfig {
  /** Agent 名称 */
  name: string;
  /** Agent 描述 */
  description: string;
  /** 系统提示词 */
  systemPrompt: string;
  /** 可用工具列表 */
  tools: StructuredTool[];
  /** LLM 模型名称 */
  modelName?: string;
  /** LLM 温度参数 */
  temperature?: number;
  /** 最大迭代次数 */
  maxIterations?: number;
}

/**
 * Agent 执行结果接口
 */
export interface AgentResult {
  /** 是否成功 */
  success: boolean;
  /** 输出内容 */
  output: string;
  /** 中间步骤 */
  intermediateSteps?: any[];
  /** 错误信息 */
  error?: string;
}

/**
 * 基础 Agent 抽象类
 */
export abstract class BaseAgent {
  protected config: AgentConfig;
  protected llm: ChatOpenAI;

  constructor(config: AgentConfig) {
    this.config = config;

    // 初始化 LLM
    this.llm = new ChatOpenAI({
      modelName: config.modelName || 'gpt-4.1-mini',
      temperature: config.temperature || 0.7,
      openAIApiKey: process.env.OPENAI_API_KEY,
    });
  }

  /**
   * 执行 Agent
   * 
   * @param input - 用户输入
   * @returns Agent 执行结果
   */
  async execute(input: string): Promise<AgentResult> {
    try {
      const messages = [
        { role: 'system' as const, content: this.config.systemPrompt },
        { role: 'user' as const, content: input },
      ];

      const response = await this.llm.invoke(messages);

      return {
        success: true,
        output: response.content as string,
        intermediateSteps: [],
      };
    } catch (error: any) {
      console.error(`[${this.config.name}] 执行失败:`, error);
      return {
        success: false,
        output: '',
        error: error.message || '执行失败',
      };
    }
  }

  /**
   * 流式执行 Agent
   * 
   * @param input - 用户输入
   * @param onChunk - 接收流式输出的回调函数
   * @returns Agent 执行结果
   */
  async executeStream(
    input: string,
    onChunk: (chunk: string) => void
  ): Promise<AgentResult> {
    try {
      const messages = [
        { role: 'system' as const, content: this.config.systemPrompt },
        { role: 'user' as const, content: input },
      ];

      const stream = await this.llm.stream(messages);
      let fullOutput = '';

      for await (const chunk of stream) {
        const content = chunk.content as string;
        fullOutput += content;
        onChunk(content);
      }

      return {
        success: true,
        output: fullOutput,
        intermediateSteps: [],
      };
    } catch (error: any) {
      console.error(`[${this.config.name}] 流式执行失败:`, error);
      return {
        success: false,
        output: '',
        error: error.message || '流式执行失败',
      };
    }
  }

  /**
   * 获取 Agent 信息
   */
  getInfo() {
    return {
      name: this.config.name,
      description: this.config.description,
      modelName: this.config.modelName || 'gpt-4.1-mini',
      temperature: this.config.temperature || 0.7,
      toolsCount: this.config.tools.length,
    };
  }

  /**
   * 获取 Agent 名称
   */
  getName(): string {
    return this.config.name;
  }

  /**
   * 获取 Agent 描述
   */
  getDescription(): string {
    return this.config.description;
  }
}
