/**
 * Layer 3: 执行计划 Agent (ExecutionPlanAgent)
 * 
 * 职责：
 * - 生成结构化执行计划
 * - 验证计划可行性
 * - 返回最终计划
 */

import { BaseAgent, type AgentConfig } from '../../base-agent';
import { StructuredTool } from '@langchain/core/tools';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import type { TaskDescription, ExecutionPlan } from '../types/intent';

export class ExecutionPlanAgent extends BaseAgent {
  constructor() {
    const config: AgentConfig = {
      name: 'ExecutionPlanAgent',
      description: 'Layer 3 - 执行计划生成',

      // 【提示词编写位置 - Layer 3】
      systemPrompt: `你是 Altus 系统的执行计划 Agent。你的职责是：

1. 接收任务描述
2. 生成详细的执行计划
3. 将任务分解为具体的步骤
4. 为每个步骤分配经理和员工
5. 估算时间和资源需求
6. 验证计划的可行性

执行计划应包括：
- 任务分解（managers 和 tasks）
- 时间估算
- 资源需求
- 依赖关系
- 风险识别

输出格式（必须是有效的 JSON）：
{
  "project": {
    "title": "Python 开发行业市场调研",
    "description": "了解2024年Python开发行业的市场趋势和机会",
    "managers": [
      {
        "id": "m1",
        "name": "市场研究经理",
        "description": "负责市场调研和分析",
        "tasks": [
          {
            "id": "t1",
            "title": "行业趋势分析",
            "description": "分析Python开发行业的最新趋势",
            "estimated_hours": 16,
            "deliverables": ["趋势分析报告"]
          }
        ]
      }
    ]
  }
}

重要原则：
- 任务分解要合理，每个任务应该是可执行的
- 时间估算要现实，考虑实际工作量
- 经理和员工的分配要明确
- 交付物要具体、可衡量`,

      tools: [],
      modelName: 'gpt-4.1-mini',
      temperature: 0.6,
      maxIterations: 10,
    };

    super(config);
  }

  /**
   * 生成执行计划
   * 
   * @param taskDescription - 任务描述
   * @returns 执行计划
   */
  async generateExecutionPlan(taskDescription: TaskDescription): Promise<ExecutionPlan> {
    const prompt = `任务描述：
${JSON.stringify(taskDescription, null, 2)}

请根据任务描述，生成详细的执行计划。

要求：
1. 将任务分解为多个可执行的子任务
2. 为每个子任务分配经理
3. 估算每个任务的工作时间（小时）
4. 明确每个任务的交付物
5. 确保任务之间的逻辑关系合理

请以 JSON 格式返回执行计划。`;

    const result = await this.execute(prompt);

    if (!result.success) {
      throw new Error(result.error || '生成执行计划失败');
    }

    try {
      // 尝试从输出中提取 JSON
      const output = result.output || '';
      const jsonMatch = output.match(/\{[\s\S]*\}/);
      
      if (!jsonMatch) {
        throw new Error('无法从 Agent 输出中提取 JSON');
      }

      const executionPlan: ExecutionPlan = JSON.parse(jsonMatch[0]);

      // 验证计划的基本结构
      this.validatePlan(executionPlan);

      return executionPlan;
    } catch (error: any) {
      throw new Error(`解析执行计划失败: ${error.message}`);
    }
  }

  /**
   * 验证计划的基本结构
   */
  private validatePlan(plan: ExecutionPlan): void {
    if (!plan.project) {
      throw new Error('执行计划缺少 project 字段');
    }

    if (!plan.project.title || !plan.project.description) {
      throw new Error('项目缺少标题或描述');
    }

    if (!plan.project.managers || plan.project.managers.length === 0) {
      throw new Error('项目至少需要一个经理');
    }

    for (const manager of plan.project.managers) {
      if (!manager.id || !manager.name || !manager.description) {
        throw new Error('经理信息不完整');
      }

      if (!manager.tasks || manager.tasks.length === 0) {
        throw new Error(`经理 ${manager.name} 没有分配任务`);
      }

      for (const task of manager.tasks) {
        if (!task.id || !task.title || !task.description) {
          throw new Error('任务信息不完整');
        }

        if (!task.estimated_hours || task.estimated_hours <= 0) {
          throw new Error(`任务 ${task.title} 的时间估算无效`);
        }

        if (!task.deliverables || task.deliverables.length === 0) {
          throw new Error(`任务 ${task.title} 没有定义交付物`);
        }
      }
    }
  }
}

/**
 * 导出单例实例
 */
export const executionPlanAgent = new ExecutionPlanAgent();
