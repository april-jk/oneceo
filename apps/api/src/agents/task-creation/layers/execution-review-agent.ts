import { BaseAgent, type AgentConfig } from '../../base-agent';
import type { ExecutionPlan, TaskDescription } from '../types/intent';

export type ExecutionReviewResult = {
  done: boolean;
  summary: string;
  issues: string[];
  next_instructions?: string;
};

export class ExecutionReviewAgent extends BaseAgent {
  constructor() {
    const config: AgentConfig = {
      name: 'ExecutionReviewAgent',
      description: '执行结果复核与改进建议',
      systemPrompt: `你是执行结果审核 Agent。职责：
1. 评估执行输出是否满足用户需求与交付物要求
2. 指出不足与缺口
3. 给出下一轮改进指令（如需）

输出格式（必须是有效 JSON）：
{
  "done": false,
  "summary": "简要总结已完成内容",
  "issues": ["缺口1","缺口2"],
  "next_instructions": "给执行智能体的下一步具体指令（若已完成可省略）"
}

注意：
- 如果输出已经满足要求，done=true，issues 可以为空。
- next_instructions 要具体、可执行、可检验。`,
      tools: [],
      modelName: process.env.AGENT_OPENAI_MODEL || 'claude-haiku-4-5-20251001',
      temperature: 0.3,
      maxIterations: 8,
    };
    super(config);
  }

  async review(params: {
    userInput: string;
    taskDescription: TaskDescription;
    executionPlan: ExecutionPlan;
    executionOutput: string;
  }): Promise<ExecutionReviewResult> {
    const prompt = `用户需求：
${params.userInput}

任务描述：
${JSON.stringify(params.taskDescription, null, 2)}

执行计划：
${JSON.stringify(params.executionPlan, null, 2)}

执行输出：
${params.executionOutput}

请评估输出质量并给出结论。`;

    const result = await this.execute(prompt);
    if (!result.success) {
      throw new Error(result.error || '执行结果评估失败');
    }

    const review = await this.parseJsonResponse<ExecutionReviewResult>(
      result.output || '',
      '执行结果评估'
    );

    return {
      done: Boolean(review.done),
      summary: review.summary || '',
      issues: Array.isArray(review.issues) ? review.issues : [],
      next_instructions: review.next_instructions,
    };
  }
}

export const executionReviewAgent = new ExecutionReviewAgent();
