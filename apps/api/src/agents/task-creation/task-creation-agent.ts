/**
 * ============================================================================
 * 智能体 1：任务创建智能体 (Task Creation Agent)
 * ============================================================================
 * 
 * 使用场景：创建任务页面 (NewTaskDialog.tsx) 和 首页 (HomePage.tsx)
 * 
 * 架构：三层 Agent 架构
 * - Layer 1: IntentRecognitionAgent (意图识别)
 * - Layer 2: PlanningAgent (任务规划)
 * - Layer 3: ExecutionPlanAgent (执行计划生成)
 * 
 * 主要职责：
 * 1. 理解用户的任务描述和需求
 * 2. 识别任务意图类型
 * 3. 收集必要信息（可能调用搜索）
 * 4. 生成结构化任务描述
 * 5. 生成详细的执行计划
 * 
 * 使用位置：
 * - 前端页面：/client/src/components/NewTaskDialog.tsx
 * - 前端页面：/client/src/pages/HomePage.tsx
 * - WebSocket 端点：ws://localhost:4000/ws/task-creation
 * 
 * ============================================================================
 */

// 导出三层 Agent
export { IntentRecognitionAgent } from './layers/intent-recognition-agent';
export { PlanningAgent } from './layers/planning-agent';
export { ExecutionPlanAgent } from './layers/execution-plan-agent';

// 导出任务创建服务
export { TaskCreationService } from './task-creation-service';

// 导出 WebSocket 服务
export { TaskCreationWebSocketService, taskCreationWebSocketService } from './websocket-service';

// 导出类型定义
export * from './types/intent';

/**
 * 为了兼容旧的 API，提供一个简化的 TaskCreationAgent 类
 */
import { TaskCreationService } from './task-creation-service';

export class TaskCreationAgent {
  private service: TaskCreationService;

  constructor() {
    this.service = new TaskCreationService();
  }

  /**
   * 创建任务
   */
  async createTask(userInput: string) {
    return this.service.createTask(userInput);
  }

  /**
   * 获取智能体信息
   */
  getInfo() {
    return {
      name: 'TaskCreationAgent',
      description: '任务创建智能体 - 三层架构',
      version: '2.0.0',
      layers: ['IntentRecognitionAgent', 'PlanningAgent', 'ExecutionPlanAgent'],
    };
  }
}

/**
 * 导出单例实例
 */
export const taskCreationAgent = new TaskCreationAgent();
