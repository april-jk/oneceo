/**
 * 任务创建智能体 (Task Creation Agent)
 * 
 * 使用场景：创建任务页面 (NewTaskDialog.tsx)
 * 
 * 主要职责：
 * 1. 理解用户的任务描述和需求
 * 2. 智能分析任务复杂度和所需资源
 * 3. 建议合适的经理和员工配置
 * 4. 生成任务分解建议
 * 5. 估算任务时间和优先级
 * 
 * 使用位置：
 * - 前端页面：/client/src/components/NewTaskDialog.tsx
 * - 触发时机：用户在创建任务对话框中输入任务描述时
 * - API 端点：POST /api/agents/task-creation/analyze
 */

import { BaseAgent, type AgentConfig } from '../base-agent';
import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

/**
 * 任务创建智能体类
 */
export class TaskCreationAgent extends BaseAgent {
  constructor() {
    const config: AgentConfig = {
      name: 'TaskCreationAgent',
      description: '任务创建智能体 - 用于分析用户需求并辅助创建项目任务',
      systemPrompt: `你是一个专业的项目管理助手，专门帮助用户创建和规划项目任务。

你的主要职责：
1. 理解用户的任务描述，识别关键需求和目标
2. 分析任务的复杂度、所需技能和资源
3. 建议合适的项目结构（经理-员工层级）
4. 提供任务分解建议，将大任务拆分为可执行的子任务
5. 估算任务时间、优先级和依赖关系
6. 识别潜在风险和注意事项

工作原则：
- 始终以用户需求为中心
- 提供清晰、可执行的建议
- 考虑实际可行性和资源约束
- 使用专业但易懂的语言
- 主动询问不明确的信息

当前上下文：
- 你正在协助用户在"创建任务"对话框中创建新的项目任务
- 用户可能提供简单的描述，也可能提供详细的需求文档
- 你需要帮助用户完善任务信息，使其更加清晰和可执行`,
      tools: this.initializeTools(),
      modelName: 'gpt-4.1-mini',
      temperature: 0.7,
      maxIterations: 10,
    };

    super(config);
  }

  /**
   * 初始化工具
   */
  private initializeTools(): StructuredTool[] {
    // TODO: 后续将添加具体的工具实现
    // 这里先定义工具的结构，具体实现将在后续完善
    return [
      // 工具示例（待实现）：
      // - analyzeTaskComplexity: 分析任务复杂度
      // - suggestTeamStructure: 建议团队结构
      // - generateTaskBreakdown: 生成任务分解
      // - estimateTimeline: 估算时间线
      // - identifyRisks: 识别风险
    ];
  }

  /**
   * 分析任务描述
   * 
   * @param description - 用户输入的任务描述
   * @returns 任务分析结果
   */
  async analyzeTask(description: string) {
    const input = `请分析以下任务描述，并提供详细的任务规划建议：

任务描述：
${description}

请提供：
1. 任务目标和关键需求
2. 任务复杂度评估（简单/中等/复杂）
3. 建议的团队结构（需要多少个经理，每个经理下需要多少员工）
4. 任务分解建议（主要的子任务列表）
5. 预估时间和优先级
6. 潜在风险和注意事项`;

    return await this.execute(input);
  }

  /**
   * 生成任务建议
   * 
   * @param description - 任务描述
   * @param constraints - 约束条件（如预算、时间等）
   * @returns 任务建议
   */
  async generateTaskSuggestions(
    description: string,
    constraints?: {
      budget?: number;
      deadline?: string;
      teamSize?: number;
    }
  ) {
    let input = `基于以下信息，生成详细的任务创建建议：

任务描述：
${description}`;

    if (constraints) {
      input += `\n\n约束条件：`;
      if (constraints.budget) input += `\n- 预算：${constraints.budget}`;
      if (constraints.deadline) input += `\n- 截止日期：${constraints.deadline}`;
      if (constraints.teamSize) input += `\n- 团队规模：${constraints.teamSize}人`;
    }

    input += `\n\n请提供具体的任务创建建议，包括团队配置、任务分解和时间规划。`;

    return await this.execute(input);
  }

  /**
   * 流式分析任务（用于实时反馈）
   * 
   * @param description - 任务描述
   * @param onToken - Token 回调函数
   * @returns 分析结果
   */
  async analyzeTaskStream(description: string, onToken: (token: string) => void) {
    const input = `请分析以下任务描述：${description}`;
    return await this.executeStream(input, [], onToken);
  }
}

/**
 * 导出单例实例
 */
export const taskCreationAgent = new TaskCreationAgent();
