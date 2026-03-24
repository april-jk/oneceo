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
  protected requestTimeoutMs: number;
  protected maxRetries: number;
  protected retryBaseMs: number;
  protected retryMaxMs: number;

  constructor(config: AgentConfig) {
    this.config = config;
    const localProxyBaseUrl = `http://127.0.0.1:${process.env.PORT || '4000'}/api/llm-proxy/v1`;

    // 初始化 LLM
    const agentModel =
      config.modelName ||
      process.env.AGENT_OPENAI_MODEL ||
      process.env.LLM_MODEL ||
      'claude-haiku-4-5-20251001';
    this.llm = new ChatOpenAI({
      modelName: agentModel,
      temperature: config.temperature || 0.7,
      timeout: Number(process.env.LLM_TIMEOUT_MS || 90000),
      openAIApiKey: process.env.AGENT_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
      configuration: {
        baseURL:
          process.env.AGENT_OPENAI_BASE_URL ||
          localProxyBaseUrl,
      },
    });
    this.requestTimeoutMs = Number(process.env.LLM_TIMEOUT_MS || 90000);
    this.maxRetries = Math.max(0, Number(process.env.LLM_MAX_RETRIES || 2));
    this.retryBaseMs = Math.max(200, Number(process.env.LLM_RETRY_BASE_MS || 800));
    this.retryMaxMs = Math.max(this.retryBaseMs, Number(process.env.LLM_RETRY_MAX_MS || 4000));
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

      const response = await this.withRetry(
        () =>
          this.withTimeout(
            this.llm.invoke(messages),
            this.requestTimeoutMs,
            'LLM 请求超时'
          ),
        `${this.config.name} 执行`
      );

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
   * 从模型输出中解析 JSON，并在首次失败时自动进行一次修复重试
   */
  protected async parseJsonResponse<T>(rawOutput: string, context: string): Promise<T> {
    const parseError = new Error(`解析 ${context} 失败`);
    const candidates = this.extractJsonCandidates(rawOutput);

    for (const candidate of candidates) {
      const parsed = this.tryParseJson<T>(candidate);
      if (parsed.success) {
        return parsed.value;
      }
    }

    // 兜底：让模型把已有输出修正为严格 JSON
    const repairPrompt = `请将下面内容转换为严格有效的 JSON。
要求：
1. 仅输出 JSON，不要输出任何解释文字
2. 使用双引号包裹字符串与键名
3. 去除注释、尾随逗号和无效字符

原始内容：
${rawOutput}`;

    const repairResult = await this.execute(repairPrompt);
    if (repairResult.success) {
      const repairedCandidates = this.extractJsonCandidates(repairResult.output || '');
      for (const candidate of repairedCandidates) {
        const parsed = this.tryParseJson<T>(candidate);
        if (parsed.success) {
          return parsed.value;
        }
      }
    }

    throw parseError;
  }

  private extractJsonCandidates(text: string): string[] {
    const normalized = (text || '').trim();
    if (!normalized) return [];

    const candidates: string[] = [];

    // 优先尝试 ```json ... ``` 代码块
    const fenced = normalized.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      candidates.push(fenced[1].trim());
    }

    // 尝试提取第一个平衡的 JSON 对象
    const objectBlock = this.extractBalancedBlock(normalized, '{', '}');
    if (objectBlock) {
      candidates.push(objectBlock);
    }

    // 尝试提取第一个平衡的 JSON 数组
    const arrayBlock = this.extractBalancedBlock(normalized, '[', ']');
    if (arrayBlock) {
      candidates.push(arrayBlock);
    }

    // 最后尝试整段文本
    candidates.push(normalized);

    return Array.from(new Set(candidates));
  }

  private extractBalancedBlock(text: string, openChar: '{' | '[', closeChar: '}' | ']'): string | null {
    const start = text.indexOf(openChar);
    if (start === -1) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < text.length; i++) {
      const ch = text[i];

      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === '\\') {
          escaped = true;
          continue;
        }
        if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }

      if (ch === openChar) {
        depth += 1;
      } else if (ch === closeChar) {
        depth -= 1;
        if (depth === 0) {
          return text.slice(start, i + 1);
        }
      }
    }

    return null;
  }

  private tryParseJson<T>(input: string): { success: true; value: T } | { success: false } {
    const normalized = (input || '')
      .replace(/\u201c|\u201d/g, '"')
      .replace(/\u2018|\u2019/g, "'")
      .replace(/,\s*([}\]])/g, '$1')
      .trim();

    if (!normalized) return { success: false };

    try {
      return {
        success: true,
        value: JSON.parse(normalized) as T,
      };
    } catch {
      return { success: false };
    }
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    let timer: NodeJS.Timeout | null = null;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error(message)), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private shouldRetry(error: unknown): boolean {
    if (!error) return false;
    const message = error instanceof Error ? error.message : String(error);
    const normalized = message.toLowerCase();
    return (
      normalized.includes('timeout') ||
      normalized.includes('timed out') ||
      normalized.includes('rate limit') ||
      normalized.includes('429') ||
      normalized.includes('socket') ||
      normalized.includes('econnreset') ||
      normalized.includes('econnrefused') ||
      normalized.includes('503') ||
      normalized.includes('502') ||
      normalized.includes('504') ||
      normalized.includes('network')
    );
  }

  private async withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
    let attempt = 0;
    let lastError: unknown;
    const maxAttempts = Math.max(1, this.maxRetries + 1);

    while (attempt < maxAttempts) {
      attempt += 1;
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (attempt >= maxAttempts || !this.shouldRetry(error)) {
          break;
        }
        const jitter = Math.floor(Math.random() * 200);
        const delay = Math.min(this.retryMaxMs, this.retryBaseMs * Math.pow(2, attempt - 1)) + jitter;
        console.warn(`[${label}] LLM 调用失败，准备重试 (${attempt}/${maxAttempts}):`, (error as any)?.message || error);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError instanceof Error ? lastError : new Error(`${label} 失败`);
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

      const stream = await this.withRetry(
        () => this.llm.stream(messages),
        `${this.config.name} 流式执行`
      );
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
