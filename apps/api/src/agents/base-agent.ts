/**
 * 基础 Agent 类
 * 
 * 为所有智能体提供通用的基础功能和接口
 */

import { ChatOpenAI } from '@langchain/openai';
import { AgentExecutor, createOpenAIFunctionsAgent } from 'langchain/agents';
import { ChatPromptTemplate } from '@langchain/core/prompts';
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
  protected agent: any;
  protected agentExecutor: AgentExecutor | null = null;

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
   * 初始化 Agent
   * 子类可以重写此方法以自定义初始化逻辑
   */
  protected async initialize(): Promise<void> {
    // 创建提示词模板
    const prompt = ChatPromptTemplate.fromMessages([
      ['system', this.config.systemPrompt],
      ['placeholder', '{chat_history}'],
      ['human', '{input}'],
      ['placeholder', '{agent_scratchpad}'],
    ]);

    // 创建 Agent
    this.agent = await createOpenAIFunctionsAgent({
      llm: this.llm,
      tools: this.config.tools,
      prompt,
    });

    // 创建 Agent Executor
    this.agentExecutor = new AgentExecutor({
      agent: this.agent,
      tools: this.config.tools,
      maxIterations: this.config.maxIterations || 10,
      verbose: true,
    });
  }

  /**
   * 执行 Agent
   * 
   * @param input - 用户输入
   * @param chatHistory - 聊天历史
   * @returns Agent 执行结果
   */
  async execute(input: string, chatHistory: BaseMessage[] = []): Promise<AgentResult> {
    try {
      // 确保 Agent 已初始化
      if (!this.agentExecutor) {
        await this.initialize();
      }

      if (!this.agentExecutor) {
        throw new Error('Agent executor initialization failed');
      }

      // 执行 Agent
      const result = await this.agentExecutor.invoke({
        input,
        chat_history: chatHistory,
      });

      return {
        success: true,
        output: result.output,
        intermediateSteps: result.intermediateSteps,
      };
    } catch (error: any) {
      console.error(`[${this.config.name}] Error:`, error);
      return {
        success: false,
        output: '',
        error: error.message || 'Unknown error occurred',
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
      tools: this.config.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
      })),
    };
  }

  /**
   * 流式执行 Agent（用于实时响应）
   * 
   * @param input - 用户输入
   * @param chatHistory - 聊天历史
   * @param onToken - Token 回调函数
   * @returns Agent 执行结果
   */
  async executeStream(
    input: string,
    chatHistory: BaseMessage[] = [],
    onToken?: (token: string) => void
  ): Promise<AgentResult> {
    try {
      // 确保 Agent 已初始化
      if (!this.agentExecutor) {
        await this.initialize();
      }

      if (!this.agentExecutor) {
        throw new Error('Agent executor initialization failed');
      }

      // 流式执行
      const result = await this.agentExecutor.invoke(
        {
          input,
          chat_history: chatHistory,
        },
        {
          callbacks: onToken
            ? [
                {
                  handleLLMNewToken(token: string) {
                    onToken(token);
                  },
                },
              ]
            : undefined,
        }
      );

      return {
        success: true,
        output: result.output,
        intermediateSteps: result.intermediateSteps,
      };
    } catch (error: any) {
      console.error(`[${this.config.name}] Error:`, error);
      return {
        success: false,
        output: '',
        error: error.message || 'Unknown error occurred',
      };
    }
  }
}
