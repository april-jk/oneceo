/**
 * ============================================================================
 * 智能体 3：任务详情智能体 / 经理智能体 (Task Detail Agent / Manager Agent)
 * ============================================================================
 * 
 * 使用场景：项目-经理-任务详情页面 (TaskDetail.tsx)
 * 
 * 主要职责：
 * 1. 协助经理和员工完成具体任务
 * 2. 提供任务执行指导和最佳实践建议
 * 3. 解答任务相关的技术和业务问题
 * 4. 协助任务进度跟踪和状态更新
 * 5. 生成任务文档和交付物
 * 6. 识别任务执行中的问题和风险
 * 
 * 使用位置：
 * - 前端页面：/client/src/pages/TaskDetail.tsx
 * - 路由示例：/task/:projectId/:managerId/:taskId (如 /task/1/m1/t1)
 * - 触发时机：用户在任务详情页面中寻求帮助、更新状态或生成文档时
 * - API 端点：POST /api/agents/task-detail/assist
 * 
 * 角色说明：
 * - 此智能体服务于两种角色：经理和员工
 * - 经理：需要协调和监督任务执行
 * - 员工：需要具体的执行指导和技术支持
 * 
 * ============================================================================
 * 代码修改指南：
 * ============================================================================
 * 
 * 📍 位置 1：提示词编写
 *    - 搜索：【提示词编写位置 - 智能体3】
 *    - 说明：在 constructor 中的 systemPrompt 字段
 *    - 作用：定义智能体的角色、职责和工作原则
 * 
 * 📍 位置 2：工具调用配置
 *    - 搜索：【工具调用位置 - 智能体3】
 *    - 说明：在 initializeTools() 方法中
 *    - 作用：定义智能体可以使用的工具函数
 * 
 * 📍 位置 3：智能体创建和配置
 *    - 搜索：【智能体创建位置 - 智能体3】
 *    - 说明：在 constructor 中的 AgentConfig 对象
 *    - 作用：配置智能体的基本参数（模型、温度等）
 * 
 * ============================================================================
 */

import { BaseAgent, type AgentConfig } from '../base-agent';
import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

/**
 * 任务详情智能体类
 */
export class TaskDetailAgent extends BaseAgent {
  constructor() {
    // ========================================================================
    // 【智能体创建位置 - 智能体3】
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
    //   * 建议：任务详情智能体使用中等温度（0.6-0.8）平衡创意和准确性
    // - maxIterations: 最大迭代次数（智能体思考和工具调用的最大轮数）
    // 
    // ========================================================================
    
    const config: AgentConfig = {
      name: 'TaskDetailAgent',
      description: '任务详情智能体 - 协助经理和员工完成具体任务执行',
      
      // ======================================================================
      // 【提示词编写位置 - 智能体3】
      // ======================================================================
      // 
      // 📝 说明：
      // 这是智能体的系统提示词，定义了智能体的角色、职责和工作原则
      // 
      // ✏️ 修改建议：
      // 1. 角色定义：任务执行助手，服务于经理和员工两种角色
      // 2. 主要职责：执行指导、问题解决、文档生成、进度跟踪
      // 3. 工作原则：具体可操作、关注细节、根据角色调整
      // 4. 任务生命周期：覆盖从规划到完成的全过程
      // 5. 输出格式：具体的步骤和建议
      // 
      // 💡 提示：
      // - 区分经理和员工的不同需求
      // - 经理：协调、监督、决策层面的建议
      // - 员工：执行、技术、操作层面的指导
      // - 提供具体的、可执行的建议
      // - 关注实际执行中的细节
      // 
      // ======================================================================
      
      systemPrompt: `你是一个专业的任务执行助手，帮助经理和员工高效完成具体任务。

你的主要职责：
1. 理解任务目标和要求，提供清晰的执行指导
2. 解答任务执行过程中的技术和业务问题
3. 提供最佳实践建议和解决方案
4. 协助生成任务相关的文档和交付物
5. 帮助跟踪任务进度和识别阻塞点
6. 提供质量检查和改进建议

工作原则：
- 以任务完成为核心目标
- 提供具体、可操作的建议
- 关注实际执行细节和可行性
- 主动识别潜在问题和风险
- 保持专业但友好的沟通风格
- 根据用户角色（经理/员工）调整建议的详细程度

当前上下文：
- 你正在协助用户完成特定的项目任务
- 用户可能是经理（负责协调和监督）或员工（负责具体执行）
- 你需要根据任务的当前状态提供相应的帮助
- 你可以访问任务的详细信息、历史记录和相关文档

角色区分：
【经理角色】
- 关注点：团队协调、进度监控、资源分配、风险管理
- 建议层次：偏向管理和协调层面
- 输出内容：团队安排、里程碑规划、问题升级处理

【员工角色】
- 关注点：具体执行、技术实现、问题解决、交付物质量
- 建议层次：偏向技术和操作层面
- 输出内容：详细步骤、代码示例、最佳实践、troubleshooting

任务生命周期阶段：
- 待开始：提供任务理解和规划建议
- 进行中：提供执行指导和问题解决
- 待审核：提供质量检查和改进建议
- 已完成：提供总结和经验提炼

输出格式建议：
- 使用清晰的步骤和列表
- 提供具体的示例和模板
- 突出关键点和注意事项
- 包含可执行的行动项
- 适当使用代码块和格式化`,

      // ======================================================================
      // 工具配置（见下方 initializeTools 方法）
      // ======================================================================
      tools: [],
      
      // ======================================================================
      // LLM 参数配置
      // ======================================================================
      modelName: 'gpt-4.1-mini',    // 可选：gpt-4.1-nano（更快更便宜）
      temperature: 0.7,              // 中等温度，平衡创意和准确性
      maxIterations: 12,             // 中等迭代次数
    };

    super(config);
  }

  /**
   * ========================================================================
   * 【工具调用位置 - 智能体3】
   * ========================================================================
   * 
   * 📝 说明：
   * 这里定义智能体可以使用的工具函数
   * 工具是智能体与外部系统交互的接口（如查询数据库、调用 API 等）
   * 
   * 🔧 如何添加工具：
   * 
   * 1. 导入工具类（如果已实现）：
   *    import { GetTaskDetailsTool } from './tools/get-task-details';
   * 
   * 2. 在 return 数组中添加工具实例：
   *    return [
   *      new GetTaskDetailsTool(),
   *      new UpdateTaskStatusTool(),
   *      // ... 更多工具
   *    ];
   * 
   * 3. 或者使用 LangChain 的 DynamicStructuredTool：
   *    import { DynamicStructuredTool } from '@langchain/core/tools';
   * 
   *    return [
   *      new DynamicStructuredTool({
   *        name: "get_task_details",
   *        description: "获取任务的详细信息，包括描述、状态、负责人、截止日期等",
   *        schema: z.object({
   *          taskId: z.string().describe("任务 ID"),
   *        }),
   *        func: async ({ taskId }) => {
   *          // 从数据库查询任务详情
   *          // const task = await db.tasks.findById(taskId);
   *          return JSON.stringify({
   *            id: taskId,
   *            title: "实现用户登录功能",
   *            description: "开发用户登录功能，包括前端表单和后端 API",
   *            status: "进行中",
   *            assignee: "张三",
   *            deadline: "2024-03-15",
   *            progress: 0.6,
   *          });
   *        },
   *      }),
   *    ];
   * 
   * 📋 建议实现的工具：
   * 
   * 【任务信息工具】
   * - getTaskDetails: 获取任务详细信息
   * - getTaskHistory: 获取任务历史记录
   * - getRelatedTasks: 获取相关任务
   * - getTaskDependencies: 获取任务依赖关系
   * 
   * 【任务操作工具】
   * - updateTaskStatus: 更新任务状态
   * - addTaskComment: 添加任务评论
   * - uploadTaskAttachment: 上传任务附件
   * - assignTask: 分配任务给员工
   * 
   * 【文档生成工具】
   * - generateTaskPlan: 生成任务计划文档
   * - generateProgressReport: 生成进度报告
   * - generateDeliverableDoc: 生成交付物文档
   * - generateTaskSummary: 生成任务总结
   * 
   * 【知识检索工具】
   * - searchBestPractices: 搜索最佳实践
   * - searchSimilarTasks: 搜索相似任务
   * - searchDocumentation: 搜索技术文档
   * - searchCodeExamples: 搜索代码示例
   * 
   * 【分析工具】
   * - analyzeTaskProgress: 分析任务进度
   * - identifyBlockers: 识别阻塞因素
   * - estimateRemainingTime: 估算剩余时间
   * - assessTaskRisk: 评估任务风险
   * 
   * 【质量检查工具】
   * - validateDeliverable: 验证交付物
   * - checkTaskCompleteness: 检查任务完整性
   * - reviewCodeQuality: 审查代码质量
   * - testTaskOutput: 测试任务输出
   * 
   * 💡 提示：
   * - 工具应该返回结构化的数据（JSON）
   * - 工具描述要清晰，说明何时使用
   * - 考虑工具的组合使用（如先查询再更新）
   * - 添加错误处理和数据验证
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
    //     name: "get_task_details",
    //     description: "获取任务的完整详细信息，包括描述、状态、负责人、进度、截止日期等",
    //     schema: z.object({
    //       taskId: z.string().describe("任务 ID"),
    //     }),
    //     func: async ({ taskId }) => {
    //       // 从数据库查询任务
    //       // const task = await taskService.getTaskById(taskId);
    //       
    //       return JSON.stringify({
    //         id: taskId,
    //         title: "实现用户登录功能",
    //         description: "开发用户登录功能，包括前端表单验证和后端 JWT 认证 API",
    //         status: "进行中",
    //         assignee: {
    //           id: "emp-1",
    //           name: "张三",
    //           role: "前端开发",
    //         },
    //         manager: {
    //           id: "mgr-1",
    //           name: "李经理",
    //         },
    //         progress: 0.6,
    //         startDate: "2024-03-01",
    //         deadline: "2024-03-15",
    //         estimatedHours: 40,
    //         actualHours: 24,
    //         priority: "高",
    //         tags: ["前端", "认证", "安全"],
    //       });
    //     },
    //   }),
    //   
    //   new DynamicStructuredTool({
    //     name: "update_task_status",
    //     description: "更新任务的状态（待开始、进行中、待审核、已完成）",
    //     schema: z.object({
    //       taskId: z.string().describe("任务 ID"),
    //       status: z.enum(["待开始", "进行中", "待审核", "已完成"]).describe("新状态"),
    //       comment: z.string().optional().describe("状态更新说明"),
    //     }),
    //     func: async ({ taskId, status, comment }) => {
    //       // 更新数据库
    //       // await taskService.updateTaskStatus(taskId, status, comment);
    //       
    //       return JSON.stringify({
    //         success: true,
    //         message: `任务状态已更新为：${status}`,
    //         timestamp: new Date().toISOString(),
    //       });
    //     },
    //   }),
    //   
    //   new DynamicStructuredTool({
    //     name: "search_best_practices",
    //     description: "搜索与当前任务相关的最佳实践和经验教训",
    //     schema: z.object({
    //       taskType: z.string().describe("任务类型或关键词"),
    //       limit: z.number().optional().describe("返回结果数量限制"),
    //     }),
    //     func: async ({ taskType, limit = 5 }) => {
    //       // 从知识库搜索
    //       // const practices = await knowledgeBase.search(taskType, limit);
    //       
    //       return JSON.stringify({
    //         results: [
    //           {
    //             title: "用户认证最佳实践",
    //             summary: "使用 JWT + Refresh Token 机制，确保安全性和用户体验",
    //             source: "项目 A - 用户管理系统",
    //             relevance: 0.95,
    //           },
    //           {
    //             title: "前端表单验证指南",
    //             summary: "结合前端和后端验证，提供实时反馈",
    //             source: "最佳实践文档",
    //             relevance: 0.88,
    //           },
    //         ],
    //       });
    //     },
    //   }),
    //   
    //   new DynamicStructuredTool({
    //     name: "analyze_task_progress",
    //     description: "分析任务的当前进度，识别是否按计划进行",
    //     schema: z.object({
    //       taskId: z.string().describe("任务 ID"),
    //     }),
    //     func: async ({ taskId }) => {
    //       // 分析任务进度
    //       // const analysis = await taskService.analyzeProgress(taskId);
    //       
    //       return JSON.stringify({
    //         taskId,
    //         overallProgress: 0.6,
    //         isOnTrack: true,
    //         daysElapsed: 10,
    //         daysRemaining: 5,
    //         estimatedCompletion: "2024-03-14",
    //         completedMilestones: [
    //           "前端表单设计",
    //           "API 接口定义",
    //         ],
    //         pendingMilestones: [
    //           "JWT 认证实现",
    //           "单元测试",
    //         ],
    //         risks: [
    //           {
    //             type: "技术风险",
    //             description: "JWT 刷新机制复杂度较高",
    //             severity: "中",
    //           },
    //         ],
    //       });
    //     },
    //   }),
    //   
    //   new DynamicStructuredTool({
    //     name: "validate_deliverable",
    //     description: "验证任务交付物的质量和完整性",
    //     schema: z.object({
    //       taskId: z.string().describe("任务 ID"),
    //       deliverableDescription: z.string().describe("交付物描述"),
    //     }),
    //     func: async ({ taskId, deliverableDescription }) => {
    //       // 验证交付物
    //       return JSON.stringify({
    //         isValid: true,
    //         score: 85,
    //         checklist: [
    //           { item: "功能完整性", passed: true, note: "所有功能已实现" },
    //           { item: "代码质量", passed: true, note: "符合编码规范" },
    //           { item: "测试覆盖率", passed: false, note: "覆盖率 75%，建议提高到 80%" },
    //           { item: "文档完整性", passed: true, note: "API 文档完整" },
    //         ],
    //         recommendations: [
    //           "增加边界情况的单元测试",
    //           "补充错误处理的文档说明",
    //         ],
    //         overallAssessment: "交付物质量良好，建议完善测试后通过审核",
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
  // - 区分经理和员工的不同需求
  // 
  // ==========================================================================

  /**
   * 提供任务执行指导
   * 
   * @param taskId - 任务 ID
   * @param question - 用户问题或需求
   * @param userRole - 用户角色（manager 或 employee）
   * @returns 执行指导
   */
  async provideGuidance(
    taskId: string,
    question: string,
    userRole: 'manager' | 'employee' = 'employee'
  ) {
    const roleContext =
      userRole === 'manager'
        ? '你正在协助一位经理，请提供偏向协调和监督层面的建议。'
        : '你正在协助一位员工，请提供具体的执行步骤和技术指导。';

    const input = `任务 ID: ${taskId}
用户角色: ${userRole === 'manager' ? '经理' : '员工'}

${roleContext}

用户问题：
${question}

请提供详细的指导和建议。`;

    return await this.execute(input);
  }

  /**
   * 生成任务文档
   * 
   * @param taskId - 任务 ID
   * @param documentType - 文档类型
   * @returns 生成的文档内容
   */
  async generateDocument(
    taskId: string,
    documentType: 'plan' | 'progress' | 'deliverable' | 'summary'
  ) {
    const documentPrompts = {
      plan: '请生成任务执行计划，包括步骤、时间安排和资源需求',
      progress: '请生成任务进度报告，包括已完成工作、当前状态和下一步计划',
      deliverable: '请生成任务交付物文档，包括成果描述、质量标准和验收标准',
      summary: '请生成任务总结报告，包括完成情况、经验教训和改进建议',
    };

    const input = `任务 ID: ${taskId}

${documentPrompts[documentType]}

请使用清晰的结构和专业的语言。`;

    return await this.execute(input);
  }

  /**
   * 分析任务进度
   * 
   * @param taskId - 任务 ID
   * @param currentStatus - 当前状态信息
   * @returns 进度分析结果
   */
  async analyzeProgress(taskId: string, currentStatus?: Record<string, any>) {
    let input = `任务 ID: ${taskId}

请分析任务的当前进度，包括：
1. 完成度评估
2. 是否按计划进行
3. 存在的问题和风险
4. 建议的调整措施
5. 预计完成时间`;

    if (currentStatus) {
      input += `\n\n当前状态信息：\n${JSON.stringify(currentStatus, null, 2)}`;
    }

    return await this.execute(input);
  }

  /**
   * 识别任务阻塞因素
   * 
   * @param taskId - 任务 ID
   * @param description - 问题描述
   * @returns 阻塞分析和解决建议
   */
  async identifyBlockers(taskId: string, description?: string) {
    let input = `任务 ID: ${taskId}

请帮助识别任务执行中的阻塞因素，并提供解决方案。`;

    if (description) {
      input += `\n\n问题描述：\n${description}`;
    }

    input += `\n\n请提供：
1. 阻塞因素分析
2. 影响程度评估
3. 可能的解决方案
4. 建议的行动步骤
5. 需要的支持和资源`;

    return await this.execute(input);
  }

  /**
   * 验证任务交付物
   * 
   * @param taskId - 任务 ID
   * @param deliverable - 交付物描述或内容
   * @returns 验证结果和改进建议
   */
  async validateDeliverable(taskId: string, deliverable: string) {
    const input = `任务 ID: ${taskId}

请验证以下任务交付物的质量和完整性：

${deliverable}

请提供：
1. 质量评估（是否符合标准）
2. 完整性检查（是否包含所有必要内容）
3. 发现的问题和不足
4. 改进建议
5. 是否建议通过审核`;

    return await this.execute(input);
  }

  /**
   * 建议下一步行动
   * 
   * @param taskId - 任务 ID
   * @param currentStage - 当前阶段
   * @returns 下一步行动建议
   */
  async suggestNextSteps(
    taskId: string,
    currentStage: 'planning' | 'executing' | 'reviewing' | 'completed'
  ) {
    const stagePrompts = {
      planning: '任务处于规划阶段，请建议如何开始执行',
      executing: '任务正在执行中，请建议下一步的具体行动',
      reviewing: '任务处于审核阶段，请建议如何完善和改进',
      completed: '任务已完成，请建议如何总结和应用经验',
    };

    const input = `任务 ID: ${taskId}
当前阶段: ${currentStage}

${stagePrompts[currentStage]}

请提供具体的、可执行的行动建议。`;

    return await this.execute(input);
  }

  /**
   * 流式提供任务协助（用于实时对话）
   * 
   * @param taskId - 任务 ID
   * @param message - 用户消息
   * @param onToken - Token 回调函数
   * @returns 协助结果
   */
  async assistStream(taskId: string, message: string, onToken: (token: string) => void) {
    const input = `任务 ID: ${taskId}\n\n用户消息: ${message}`;
    return await this.executeStream(input, onToken);
  }

  /**
   * 生成任务检查清单
   * 
   * @param taskId - 任务 ID
   * @param taskType - 任务类型
   * @returns 检查清单
   */
  async generateChecklist(taskId: string, taskType?: string) {
    let input = `任务 ID: ${taskId}`;

    if (taskType) {
      input += `\n任务类型: ${taskType}`;
    }

    input += `\n\n请生成一个详细的任务执行检查清单，包括：
1. 任务开始前的准备事项
2. 执行过程中的关键检查点
3. 质量控制要点
4. 完成前的验收标准
5. 文档和交付要求

请使用清晰的列表格式。`;

    return await this.execute(input);
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
 * import { taskDetailAgent } from './agents';
 * const result = await taskDetailAgent.provideGuidance('task-123', '如何开始？', 'employee');
 * 
 * ============================================================================
 */
export const taskDetailAgent = new TaskDetailAgent();
