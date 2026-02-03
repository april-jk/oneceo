/**
 * Agent 模块入口文件
 * 
 * 统一导出所有智能体实例和相关类型
 */

// 导出基础类和类型
export { BaseAgent, type AgentConfig, type AgentResult } from './base-agent';

// 导出三个主要智能体
export { TaskCreationAgent, taskCreationAgent } from './task-creation/task-creation-agent';
export { CEOViewAgent, ceoViewAgent } from './ceo-view/ceo-view-agent';
export { TaskDetailAgent, taskDetailAgent } from './task-detail/task-detail-agent';

/**
 * Agent 管理器
 * 
 * 提供统一的 Agent 访问接口
 */
export class AgentManager {
  /**
   * 获取任务创建智能体
   */
  static getTaskCreationAgent() {
    return taskCreationAgent;
  }

  /**
   * 获取总经理视图智能体
   */
  static getCEOViewAgent() {
    return ceoViewAgent;
  }

  /**
   * 获取任务详情智能体
   */
  static getTaskDetailAgent() {
    return taskDetailAgent;
  }

  /**
   * 根据类型获取智能体
   * 
   * @param type - 智能体类型
   * @returns 对应的智能体实例
   */
  static getAgent(type: 'task-creation' | 'ceo-view' | 'task-detail') {
    switch (type) {
      case 'task-creation':
        return this.getTaskCreationAgent();
      case 'ceo-view':
        return this.getCEOViewAgent();
      case 'task-detail':
        return this.getTaskDetailAgent();
      default:
        throw new Error(`Unknown agent type: ${type}`);
    }
  }

  /**
   * 获取所有智能体的信息
   */
  static getAllAgentsInfo() {
    return {
      'task-creation': taskCreationAgent.getInfo(),
      'ceo-view': ceoViewAgent.getInfo(),
      'task-detail': taskDetailAgent.getInfo(),
    };
  }
}
