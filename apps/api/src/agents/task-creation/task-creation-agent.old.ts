/**
 * ============================================================================
 * 智能体 1：任务创建智能体 (Task Creation Agent)
 * ============================================================================
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
 * 
 * ============================================================================
 * 代码修改指南：
 * ============================================================================
 * 
 * 📍 位置 1：提示词编写
 *    - 搜索：【提示词编写位置 - 智能体1】
 *    - 说明：在 constructor 中的 systemPrompt 字段
 *    - 作用：定义智能体的角色、职责和工作原则
 * 
 * 📍 位置 2：工具调用配置
 *    - 搜索：【工具调用位置 - 智能体1】
 *    - 说明：在 initializeTools() 方法中
 *    - 作用：定义智能体可以使用的工具函数
 * 
 * 📍 位置 3：智能体创建和配置
 *    - 搜索：【智能体创建位置 - 智能体1】
 *    - 说明：在 constructor 中的 AgentConfig 对象
 *    - 作用：配置智能体的基本参数（模型、温度等）
 * 
 * ============================================================================
 */

import { BaseAgent, type AgentConfig } from '../base-agent';
import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

/**
 * 任务创建智能体类
 */
export class TaskCreationAgent extends BaseAgent {
  constructor() {
    // ========================================================================
    // 【智能体创建位置 - 智能体1】
    // ========================================================================
    // 
    // 📝 说明：
    // 这里是智能体的核心配置，包括名称、描述、提示词、工具等
    // 
    // 🔧 可修改的参数：
    // - name: 智能体名称（用于日志和识别）
    // - description: 智能体描述（用于文档和说明）
    // - systemPrompt: 系统提示词（见下方【提示词编写位置】）
    // - tools: 可用工具列表（见下方【工具调用位置】）
    // - modelName: LLM 模型名称（如 'gpt-4.1-mini', 'gpt-4.1-nano'）
    // - temperature: 温度参数（0-1，越高越随机，越低越确定）
    // - maxIterations: 最大迭代次数（智能体思考和工具调用的最大轮数）
    // 
    // ========================================================================
    
    const config: AgentConfig = {
      name: 'TaskCreationAgent',
      description: '任务创建智能体 - 用于分析用户需求并辅助创建项目任务',
      
      // ======================================================================
      // 【提示词编写位置 - 智能体1】
      // ======================================================================
      // 
      // 📝 说明：
      // 这是智能体的系统提示词，定义了智能体的角色、职责和工作原则
      // 
      // ✏️ 修改建议：
      // 1. 角色定义：明确智能体扮演的角色（如项目管理助手）
      // 2. 主要职责：列出智能体需要完成的核心任务
      // 3. 工作原则：说明智能体的工作方式和注意事项
      // 4. 当前上下文：提供智能体所处的环境信息
      // 5. 输出格式：指定期望的输出结构和格式
      // 
      // 💡 提示：
      // - 使用清晰、具体的语言
      // - 提供示例可以提高输出质量
      // - 根据实际使用反馈不断优化
      // 
      // ======================================================================
      
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
- 你需要帮助用户完善任务信息，使其更加清晰和可执行

输出格式建议：
- 使用结构化的格式（如标题、列表、表格）
- 提供具体的数字和时间估算
- 给出可选方案和推荐理由
- 突出重点和关键信息`,

      // ======================================================================
      // 工具配置（见下方 initializeTools 方法）
      // ======================================================================
      tools: [],
      
      // ======================================================================
      // LLM 参数配置
      // ======================================================================
      modelName: 'gpt-4.1-mini',    // 可选：gpt-4.1-nano（更快更便宜）
      temperature: 0.7,              // 0.7 适合创意性任务，0.3 适合确定性任务
      maxIterations: 10,             // 最大迭代次数
    };

    super(config);
  }

  /**
   * ========================================================================
   * 【工具调用位置 - 智能体1】
   * ========================================================================
   * 
   * 📝 说明：
   * 这里定义智能体可以使用的工具函数
   * 工具是智能体与外部系统交互的接口（如查询数据库、调用 API 等）
   * 
   * 🔧 如何添加工具：
   * 
   * 1. 导入工具类（如果已实现）：
   *    import { AnalyzeComplexityTool } from './tools/analyze-complexity';
   * 
   * 2. 在 return 数组中添加工具实例：
   *    return [
   *      new AnalyzeComplexityTool(),
   *      new SuggestTeamTool(),
   *      // ... 更多工具
   *    ];
   * 
   * 3. 或者使用 LangChain 的 DynamicStructuredTool：
   *    import { DynamicStructuredTool } from '@langchain/core/tools';
   * 
   *    return [
   *      new DynamicStructuredTool({
   *        name: "analyze_task_complexity",
   *        description: "分析任务的复杂度，返回简单/中等/复杂",
   *        schema: z.object({
   *          description: z.string().describe("任务描述"),
   *        }),
   *        func: async ({ description }) => {
   *          // 实现工具逻辑
   *          return "中等";
   *        },
   *      }),
   *    ];
   * 
   * 📋 建议实现的工具：
   * - analyzeTaskComplexity: 分析任务复杂度
   * - suggestTeamStructure: 建议团队结构
   * - generateTaskBreakdown: 生成任务分解
   * - estimateTimeline: 估算时间线
   * - identifyRisks: 识别风险
   * - searchSimilarTasks: 搜索相似任务（从历史数据中学习）
   * - validateTaskRequirements: 验证任务需求的完整性
   * 
   * 💡 提示：
   * - 工具名称使用 snake_case（如 analyze_complexity）
   * - 工具描述要清晰，帮助 LLM 理解何时使用
   * - 使用 zod schema 定义参数类型，确保类型安全
   * 
   * ========================================================================
   */
  private initializeTools(): StructuredTool[] {
    // TODO: 在这里添加具体的工具实现
    // 
    // 示例：
    // import { DynamicStructuredTool } from '@langchain/core/tools';
    // 
    // return [
    //   new DynamicStructuredTool({
    //     name: "analyze_task_complexity",
    //     description: "分析任务的复杂度，返回简单/中等/复杂以及分析理由",
    //     schema: z.object({
    //       description: z.string().describe("任务描述"),
    //       requirements: z.string().optional().describe("任务需求"),
    //     }),
    //     func: async ({ description, requirements }) => {
    //       // 这里实现分析逻辑
    //       // 可以调用数据库、外部 API 等
    //       return JSON.stringify({
    //         complexity: "中等",
    //         reason: "任务涉及多个模块，需要团队协作",
    //         estimatedDays: 15,
    //       });
    //     },
    //   }),
    //   
    //   new DynamicStructuredTool({
    //     name: "suggest_team_structure",
    //     description: "根据任务复杂度建议团队结构（经理和员工数量）",
    //     schema: z.object({
    //       complexity: z.enum(["简单", "中等", "复杂"]).describe("任务复杂度"),
    //       taskType: z.string().describe("任务类型"),
    //     }),
    //     func: async ({ complexity, taskType }) => {
    //       // 实现团队建议逻辑
    //       return JSON.stringify({
    //         managers: 1,
    //         employees: 3,
    //         roles: ["前端开发", "后端开发", "测试工程师"],
    //       });
    //     },
    //   }),
    // ];
    
    return [
      // 工具列表（待实现）
      // 当前返回空数组，智能体将仅依赖 LLM 的知识
    ];
  }

  // ==========================================================================
  // 智能体方法
  // ==========================================================================
  // 
  // 以下方法是智能体对外提供的接口，用于不同的使用场景
  // 这些方法内部会调用 BaseAgent 的 execute() 方法
  // 
  // 💡 提示：
  // - 可以根据需要添加更多方法
  // - 每个方法都应该有清晰的参数和返回值
  // - 方法内部构造合适的 prompt，然后调用 execute()
  // 
  // ==========================================================================

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
    return await this.executeStream(input, onToken);
  }
}

/**
 * ============================================================================
 * 导出单例实例
 * ============================================================================
 * 
 * 📝 说明：
 * 导出一个单例实例，在整个应用中共享同一个智能体实例
 * 这样可以避免重复初始化，提高性能
 * 
 * 使用方式：
 * import { taskCreationAgent } from './agents';
 * const result = await taskCreationAgent.analyzeTask('开发用户管理系统');
 * 
 * ============================================================================
 */
export const taskCreationAgent = new TaskCreationAgent();
