/**
 * ============================================================================
 * 智能体 2：总经理视图智能体 (CEO View Agent)
 * ============================================================================
 * 
 * 使用场景：总经理视图页面 (CEOView.tsx)
 * 
 * 主要职责：
 * 1. 提供项目全局视角和战略洞察
 * 2. 监控所有项目的整体进度和健康状况
 * 3. 识别跨项目的资源冲突和瓶颈
 * 4. 提供决策支持和优先级建议
 * 5. 生成项目报告和数据分析
 * 6. 协助项目间的资源调配
 * 
 * 使用位置：
 * - 前端页面：/client/src/pages/CEOView.tsx
 * - 触发时机：用户在总经理视图中查询项目状态、请求分析或寻求建议时
 * - API 端点：POST /api/agents/ceo-view/analyze
 * 
 * ============================================================================
 * 代码修改指南：
 * ============================================================================
 * 
 * 📍 位置 1：提示词编写
 *    - 搜索：【提示词编写位置 - 智能体2】
 *    - 说明：在 constructor 中的 systemPrompt 字段
 *    - 作用：定义智能体的角色、职责和工作原则
 * 
 * 📍 位置 2：工具调用配置
 *    - 搜索：【工具调用位置 - 智能体2】
 *    - 说明：在 initializeTools() 方法中
 *    - 作用：定义智能体可以使用的工具函数
 * 
 * 📍 位置 3：智能体创建和配置
 *    - 搜索：【智能体创建位置 - 智能体2】
 *    - 说明：在 constructor 中的 AgentConfig 对象
 *    - 作用：配置智能体的基本参数（模型、温度等）
 * 
 * ============================================================================
 */

import { BaseAgent, type AgentConfig } from '../base-agent';
import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

/**
 * 总经理视图智能体类
 */
export class CEOViewAgent extends BaseAgent {
  constructor() {
    // ========================================================================
    // 【智能体创建位置 - 智能体2】
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
    //   * 建议：总经理智能体使用较低温度（0.3-0.5）以保持客观和一致性
    // - maxIterations: 最大迭代次数（智能体思考和工具调用的最大轮数）
    // 
    // ========================================================================
    
    const config: AgentConfig = {
      name: 'CEOViewAgent',
      description: '总经理视图智能体 - 提供项目全局视角和战略决策支持',
      
      // ======================================================================
      // 【提示词编写位置 - 智能体2】
      // ======================================================================
      // 
      // 📝 说明：
      // 这是智能体的系统提示词，定义了智能体的角色、职责和工作原则
      // 
      // ✏️ 修改建议：
      // 1. 角色定义：总经理的战略顾问，关注全局而非细节
      // 2. 主要职责：监控、分析、决策支持、资源优化
      // 3. 工作原则：客观、基于数据、战略视角
      // 4. 关键指标：项目进度、资源利用、ROI、风险
      // 5. 输出格式：高层次的摘要和建议
      // 
      // 💡 提示：
      // - 使用商业语言而非技术术语
      // - 强调数据驱动的决策
      // - 提供可执行的战略建议
      // - 保持客观和专业
      // 
      // ======================================================================
      
      systemPrompt: `你是一个高级项目管理顾问和战略分析师，为总经理（CEO）提供全局视角的项目管理支持。

你的主要职责：
1. 监控和分析所有项目的整体状况
2. 识别项目进度、资源分配和团队效率的问题
3. 提供跨项目的资源优化建议
4. 识别风险、瓶颈和机会
5. 生成高层次的项目报告和数据洞察
6. 协助战略决策和优先级排序

工作原则：
- 保持高层次的战略视角，关注整体而非细节
- 基于数据和事实提供客观分析
- 主动识别潜在问题和改进机会
- 提供可执行的建议和行动方案
- 使用清晰的商业语言，避免过度技术化

当前上下文：
- 你正在为总经理提供项目组合管理支持
- 总经理需要了解所有项目的整体状况
- 你可以访问所有项目、经理和任务的数据
- 你的建议将直接影响资源分配和战略决策

关键指标关注：
- 项目进度和交付时间
- 资源利用率和团队负载
- 任务完成率和质量
- 跨项目依赖和风险
- ROI 和业务价值

输出格式建议：
- 使用执行摘要格式（先结论，后细节）
- 提供量化的数据和指标
- 突出关键问题和建议
- 使用可视化描述（如趋势、对比）
- 提供优先级排序的行动项`,

      // ======================================================================
      // 工具配置（见下方 initializeTools 方法）
      // ======================================================================
      tools: this.initializeTools(),
      
      // ======================================================================
      // LLM 参数配置
      // ======================================================================
      modelName: 'gpt-4.1-mini',    // 可选：gpt-4.1-nano（更快更便宜）
      temperature: 0.5,              // 较低温度以保持客观和一致性
      maxIterations: 15,             // 较高迭代次数以支持复杂分析
    };

    super(config);
  }

  /**
   * ========================================================================
   * 【工具调用位置 - 智能体2】
   * ========================================================================
   * 
   * 📝 说明：
   * 这里定义智能体可以使用的工具函数
   * 工具是智能体与外部系统交互的接口（如查询数据库、调用 API 等）
   * 
   * 🔧 如何添加工具：
   * 
   * 1. 导入工具类（如果已实现）：
   *    import { GetProjectsStatusTool } from './tools/get-projects-status';
   * 
   * 2. 在 return 数组中添加工具实例：
   *    return [
   *      new GetProjectsStatusTool(),
   *      new AnalyzeResourcesTool(),
   *      // ... 更多工具
   *    ];
   * 
   * 3. 或者使用 LangChain 的 DynamicStructuredTool：
   *    import { DynamicStructuredTool } from '@langchain/core/tools';
   * 
   *    return [
   *      new DynamicStructuredTool({
   *        name: "get_all_projects_status",
   *        description: "获取所有项目的状态信息，包括进度、资源、风险等",
   *        schema: z.object({
   *          includeCompleted: z.boolean().optional().describe("是否包含已完成项目"),
   *        }),
   *        func: async ({ includeCompleted }) => {
   *          // 从数据库查询项目状态
   *          // const projects = await db.projects.findAll(...);
   *          return JSON.stringify({
   *            totalProjects: 10,
   *            activeProjects: 7,
   *            projects: [
   *              { id: 1, name: "项目A", progress: 0.75, status: "进行中" },
   *              // ...
   *            ],
   *          });
   *        },
   *      }),
   *    ];
   * 
   * 📋 建议实现的工具：
   * - getAllProjectsStatus: 获取所有项目状态
   * - analyzeResourceAllocation: 分析资源分配情况
   * - identifyBottlenecks: 识别瓶颈和阻塞
   * - generateExecutiveSummary: 生成执行摘要
   * - compareProjectPerformance: 比较项目表现
   * - predictProjectRisks: 预测项目风险
   * - suggestResourceReallocation: 建议资源重新分配
   * - getTeamUtilization: 获取团队利用率数据
   * - calculateProjectROI: 计算项目 ROI
   * - getHistoricalTrends: 获取历史趋势数据
   * 
   * 💡 提示：
   * - 工具应该返回结构化的数据（JSON）
   * - 工具描述要清晰，说明返回的数据格式
   * - 考虑性能，避免查询过多数据
   * - 添加缓存机制以提高响应速度
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
    //     name: "get_all_projects_status",
    //     description: "获取所有项目的当前状态，包括进度、资源、风险等关键指标",
    //     schema: z.object({
    //       includeCompleted: z.boolean().optional().describe("是否包含已完成的项目"),
    //       sortBy: z.enum(["progress", "priority", "deadline"]).optional().describe("排序方式"),
    //     }),
    //     func: async ({ includeCompleted, sortBy }) => {
    //       // 从数据库查询项目数据
    //       // const projects = await projectService.getAllProjects({ includeCompleted, sortBy });
    //       
    //       return JSON.stringify({
    //         totalProjects: 10,
    //         activeProjects: 7,
    //         completedProjects: 3,
    //         projects: [
    //           {
    //             id: "project-1",
    //             name: "电商平台开发",
    //             progress: 0.75,
    //             status: "进行中",
    //             managers: 2,
    //             employees: 8,
    //             deadline: "2024-06-30",
    //             budget: 100000,
    //             spent: 65000,
    //           },
    //           // ...
    //         ],
    //       });
    //     },
    //   }),
    //   
    //   new DynamicStructuredTool({
    //     name: "analyze_resource_allocation",
    //     description: "分析当前的资源分配情况，识别过载和闲置的资源",
    //     schema: z.object({}),
    //     func: async () => {
    //       // 分析资源利用率
    //       return JSON.stringify({
    //         overloadedManagers: [
    //           { id: "m1", name: "张经理", utilization: 1.5, projects: 3 },
    //         ],
    //         underutilizedEmployees: [
    //           { id: "e5", name: "李员工", utilization: 0.3, currentTasks: 1 },
    //         ],
    //         averageUtilization: 0.85,
    //         recommendations: [
    //           "建议将项目 B 的部分任务重新分配给闲置员工",
    //         ],
    //       });
    //     },
    //   }),
    //   
    //   new DynamicStructuredTool({
    //     name: "identify_project_risks",
    //     description: "识别所有项目的潜在风险和问题",
    //     schema: z.object({
    //       riskLevel: z.enum(["all", "high", "medium", "low"]).optional().describe("风险级别筛选"),
    //     }),
    //     func: async ({ riskLevel }) => {
    //       return JSON.stringify({
    //         highRiskProjects: [
    //           {
    //             projectId: "project-2",
    //             projectName: "移动应用开发",
    //             risks: [
    //               { type: "进度延迟", severity: "高", description: "关键里程碑延迟 2 周" },
    //               { type: "资源不足", severity: "中", description: "缺少前端开发人员" },
    //             ],
    //           },
    //         ],
    //         totalRisks: 15,
    //         highRisks: 3,
    //         mediumRisks: 8,
    //         lowRisks: 4,
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
  // - 考虑添加数据预处理和后处理逻辑
  // 
  // ==========================================================================

  /**
   * 分析项目组合整体状况
   * 
   * @param projectIds - 项目 ID 列表（可选，不提供则分析所有项目）
   * @returns 分析结果
   */
  async analyzePortfolio(projectIds?: string[]) {
    const input = projectIds
      ? `请分析以下项目的整体状况：${projectIds.join(', ')}`
      : '请分析当前所有项目的整体状况，提供全局视角的洞察和建议。';

    return await this.execute(input);
  }

  /**
   * 生成执行摘要报告
   * 
   * @param period - 时间周期（如 'weekly', 'monthly'）
   * @returns 执行摘要
   */
  async generateExecutiveSummary(period: 'daily' | 'weekly' | 'monthly' = 'weekly') {
    const periodMap = {
      daily: '每日',
      weekly: '每周',
      monthly: '每月',
    };

    const input = `请生成${periodMap[period]}执行摘要报告，包括：

1. 项目整体进展概览
   - 总体进度和里程碑达成情况
   - 与计划的对比分析

2. 关键成就和里程碑
   - 本期完成的重要工作
   - 值得表彰的团队和个人

3. 主要问题和风险
   - 当前面临的挑战
   - 潜在风险和影响评估

4. 资源利用情况
   - 人力资源利用率
   - 预算执行情况

5. 下一步行动建议
   - 优先级排序
   - 具体的行动项和负责人

请使用清晰的结构和数据支持你的分析。`;

    return await this.execute(input);
  }

  /**
   * 识别资源冲突和瓶颈
   * 
   * @returns 资源分析结果
   */
  async identifyResourceIssues() {
    const input = `请分析当前的资源分配情况，识别：

1. 资源过载的经理或员工
   - 谁的工作负载过重？
   - 影响程度如何？

2. 资源利用不足的情况
   - 哪些资源闲置或利用率低？
   - 可以如何优化？

3. 跨项目的资源冲突
   - 是否存在资源竞争？
   - 如何协调和平衡？

4. 潜在的瓶颈和风险
   - 关键资源的单点依赖
   - 技能缺口和培训需求

5. 资源优化建议
   - 具体的调整方案
   - 预期的效果和收益

请提供具体的数据和可执行的建议。`;

    return await this.execute(input);
  }

  /**
   * 提供战略决策支持
   * 
   * @param question - 决策问题
   * @param context - 额外上下文信息
   * @returns 决策建议
   */
  async provideDecisionSupport(question: string, context?: Record<string, any>) {
    let input = `作为总经理的战略顾问，请就以下问题提供决策支持：

问题：
${question}`;

    if (context) {
      input += `\n\n相关上下文：\n${JSON.stringify(context, null, 2)}`;
    }

    input += `\n\n请提供：
1. 问题分析
   - 问题的本质和影响范围
   - 相关的背景和约束条件

2. 可选方案
   - 列出 2-3 个可行的方案
   - 每个方案的具体内容

3. 方案对比
   - 每个方案的优缺点
   - 成本、时间、风险分析

4. 推荐方案
   - 推荐哪个方案，为什么？
   - 关键的决策依据

5. 实施建议
   - 具体的实施步骤
   - 需要注意的事项`;

    return await this.execute(input);
  }

  /**
   * 比较项目表现
   * 
   * @param projectIds - 要比较的项目 ID 列表
   * @returns 比较分析结果
   */
  async compareProjects(projectIds: string[]) {
    const input = `请比较以下项目的表现：${projectIds.join(', ')}

比较维度：
1. 进度和交付时间
   - 计划 vs 实际进度
   - 是否按时交付

2. 资源效率
   - 人力投入 vs 产出
   - 预算使用效率

3. 任务完成质量
   - 交付物质量评估
   - 返工率和缺陷率

4. 团队协作效果
   - 团队沟通和配合
   - 问题解决效率

5. 风险管理
   - 风险识别和应对
   - 问题升级和处理

请提供详细的对比分析和改进建议，突出最佳实践和需要改进的地方。`;

    return await this.execute(input);
  }

  /**
   * 流式生成报告（用于实时反馈）
   * 
   * @param reportType - 报告类型
   * @param onToken - Token 回调函数
   * @returns 报告内容
   */
  async generateReportStream(
    reportType: 'summary' | 'resource' | 'risk',
    onToken: (token: string) => void
  ) {
    const prompts = {
      summary: '请生成项目组合的执行摘要报告',
      resource: '请生成资源分配和利用情况报告',
      risk: '请生成项目风险评估报告',
    };

    return await this.executeStream(prompts[reportType], [], onToken);
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
 * import { ceoViewAgent } from './agents';
 * const result = await ceoViewAgent.analyzePortfolio();
 * 
 * ============================================================================
 */
export const ceoViewAgent = new CEOViewAgent();
