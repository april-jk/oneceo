/**
 * 总经理视图智能体 (CEO View Agent)
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
 */

import { BaseAgent, type AgentConfig } from '../base-agent';
import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

/**
 * 总经理视图智能体类
 */
export class CEOViewAgent extends BaseAgent {
  constructor() {
    const config: AgentConfig = {
      name: 'CEOViewAgent',
      description: '总经理视图智能体 - 提供项目全局视角和战略决策支持',
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
- ROI 和业务价值`,
      tools: this.initializeTools(),
      modelName: 'gpt-4.1-mini',
      temperature: 0.5, // 较低的温度以保持客观和一致性
      maxIterations: 15,
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
      // - getAllProjectsStatus: 获取所有项目状态
      // - analyzeResourceAllocation: 分析资源分配
      // - identifyBottlenecks: 识别瓶颈
      // - generateExecutiveSummary: 生成执行摘要
      // - compareProjectPerformance: 比较项目表现
      // - predictProjectRisks: 预测项目风险
      // - suggestResourceReallocation: 建议资源重新分配
    ];
  }

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
    const input = `请生成${period === 'daily' ? '每日' : period === 'weekly' ? '每周' : '每月'}执行摘要报告，包括：

1. 项目整体进展概览
2. 关键成就和里程碑
3. 主要问题和风险
4. 资源利用情况
5. 下一步行动建议

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
2. 资源利用不足的情况
3. 跨项目的资源冲突
4. 潜在的瓶颈和风险
5. 资源优化建议

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
2. 可选方案
3. 每个方案的优缺点
4. 推荐方案和理由
5. 实施建议`;

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
2. 资源效率
3. 任务完成质量
4. 团队协作效果
5. 风险管理

请提供详细的对比分析和改进建议。`;

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
 * 导出单例实例
 */
export const ceoViewAgent = new CEOViewAgent();
