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
      modelName: process.env.AGENT_OPENAI_MODEL || 'claude-haiku-4-5-20251001',
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
    const artifactKind = String((taskDescription as any)?.additional_info?.artifactKind || '').trim().toLowerCase();
    if (
      artifactKind === 'script_artifact' ||
      artifactKind === 'web_app' ||
      artifactKind === 'business_system' ||
      artifactKind === 'software_artifact'
    ) {
      return this.buildFallbackPlan(taskDescription);
    }

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

    try {
      const result = await this.execute(prompt);

      if (!result.success) {
        throw new Error(result.error || '生成执行计划失败');
      }

      const executionPlan = await this.parseJsonResponse<ExecutionPlan>(
        result.output || '',
        '执行计划'
      );

      // 验证并补全计划的基本结构
      const normalized = this.normalizePlan(executionPlan, taskDescription);

      return normalized;
    } catch (error: any) {
      console.warn('[ExecutionPlanAgent] 解析执行计划失败，改用兜底计划:', error?.message || error);
      return this.buildFallbackPlan(taskDescription);
    }
  }

  /**
   * 验证计划的基本结构
   */
  private normalizePlan(plan: ExecutionPlan, taskDescription: TaskDescription): ExecutionPlan {
    if (!plan.project) {
      throw new Error('执行计划缺少 project 字段');
    }

    const projectTitle = plan.project.title || taskDescription.title || '任务执行计划';
    const projectDescription =
      plan.project.description || taskDescription.objective || '执行计划描述待补充';

    const managers = Array.isArray(plan.project.managers) && plan.project.managers.length > 0
      ? plan.project.managers
      : [
          {
            id: 'm1',
            name: '执行经理',
            description: '负责整体执行计划与协调',
            tasks: [],
          },
        ];

    const normalizedManagers = managers.map((manager, managerIndex) => {
      const managerId = manager.id || `m${managerIndex + 1}`;
      const managerName = manager.name || `执行经理${managerIndex + 1}`;
      const managerDescription = manager.description || '负责任务执行与交付';

      const tasks = Array.isArray(manager.tasks) && manager.tasks.length > 0
        ? manager.tasks
        : [
            {
              id: `t${managerIndex + 1}-1`,
              title: taskDescription.title || '任务执行',
              description: taskDescription.objective || '根据任务描述完成执行',
              estimated_hours: 8,
              deliverables: taskDescription.deliverables || ['交付物待确认'],
            },
          ];

      const normalizedTasks = tasks.map((task, taskIndex) => {
        const estimated = typeof task.estimated_hours === 'string'
          ? Number.parseFloat(task.estimated_hours)
          : task.estimated_hours;
        const estimatedHours = Number.isFinite(estimated) && (estimated as number) > 0 ? Number(estimated) : 8;

        const deliverables = Array.isArray(task.deliverables)
          ? task.deliverables
          : task.deliverables
            ? [String(task.deliverables)]
            : (taskDescription.deliverables || ['交付物待确认']);

        return {
          ...task,
          id: task.id || `t${managerIndex + 1}-${taskIndex + 1}`,
          title: task.title || `任务${taskIndex + 1}`,
          description: task.description || '待补充任务描述',
          estimated_hours: estimatedHours,
          deliverables,
        };
      });

      return {
        ...manager,
        id: managerId,
        name: managerName,
        description: managerDescription,
        tasks: normalizedTasks,
      };
    });

    return {
      ...plan,
      project: {
        ...plan.project,
        title: projectTitle,
        description: projectDescription,
        managers: normalizedManagers,
      },
    };
  }

  private buildFallbackPlan(taskDescription: TaskDescription): ExecutionPlan {
    const deliverables = Array.isArray(taskDescription.deliverables)
      ? taskDescription.deliverables
      : taskDescription.deliverables
        ? [String(taskDescription.deliverables)]
        : ['交付物待确认'];

    const tasks = deliverables.map((item, index) => {
      const title = typeof item === 'string' ? item : (item as any)?.name || `任务${index + 1}`;
      const description =
        typeof item === 'string'
          ? `完成交付物：${item}`
          : (item as any)?.description || '完成交付物';
      return {
        id: `t1-${index + 1}`,
        title,
        description,
        estimated_hours: 8,
        deliverables: [typeof item === 'string' ? item : (item as any)?.name || '交付物'],
      };
    });

    return {
      project: {
        title: taskDescription.title || '任务执行计划',
        description: taskDescription.objective || '执行计划描述待补充',
        managers: [
          {
            id: 'm1',
            name: '执行经理',
            description: '负责整体执行计划与协调',
            tasks: tasks.length > 0 ? tasks : [
              {
                id: 't1-1',
                title: '任务执行',
                description: taskDescription.objective || '根据任务描述完成执行',
                estimated_hours: 8,
                deliverables: ['交付物待确认'],
              },
            ],
          },
        ],
      },
    };
  }
}

/**
 * 导出单例实例
 */
export const executionPlanAgent = new ExecutionPlanAgent();
