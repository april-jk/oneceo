/**
 * 任务创建服务 (TaskCreationService)
 * 
 * 负责编排三层 Agent 的工作流程
 */

import { IntentRecognitionAgent } from './layers/intent-recognition-agent';
import { PlanningAgent } from './layers/planning-agent';
import { ExecutionPlanAgent } from './layers/execution-plan-agent';
import type { ExecutionPlan, WebSocketMessage, MessageType } from './types/intent';
import { taskCreationSessionDAO } from '../../db/dao';

export interface TaskCreationCallbacks {
  onMessage: (message: WebSocketMessage) => void;
  onAskUser: (question: string, options?: string[]) => Promise<string>;
  onSearch?: (query: string) => Promise<any[]>;
}

export class TaskCreationService {
  private layer1: IntentRecognitionAgent;
  private layer2: PlanningAgent;
  private layer3: ExecutionPlanAgent;
  private callbacks?: TaskCreationCallbacks;
  private sessionId?: string; // 当前会话 ID

  constructor(callbacks?: TaskCreationCallbacks) {
    this.callbacks = callbacks;

    // 初始化三层 Agent
    this.layer1 = new IntentRecognitionAgent(
      callbacks?.onAskUser
    );

    this.layer2 = new PlanningAgent(
      callbacks?.onAskUser,
      callbacks?.onSearch
    );

    this.layer3 = new ExecutionPlanAgent();
  }

  /**
   * 创建任务的完整流程
   * 
   * @param userInput - 用户输入的任务描述
   * @returns 执行计划
   */
  async createTask(userInput: string, userId?: string): Promise<ExecutionPlan> {
    try {
      // 创建新的会话
      const session = await taskCreationSessionDAO.createSession({ userId });
      this.sessionId = session.id;

      // 保存用户输入消息
      await taskCreationSessionDAO.addMessage({
        sessionId: this.sessionId,
        role: 'user',
        content: userInput,
        messageType: 'user_input',
      });

      // Step 1: 意图识别
      this.sendMessage({
        type: 'agent_message' as any,
        agent: 'intent_recognition',
        content: '正在分析您的任务需求...',
      });

      const intentResult = await this.layer1.recognizeIntent(userInput);

      // 保存意图识别结果
      await taskCreationSessionDAO.saveIntentResult({
        sessionId: this.sessionId!,
        userInput,
        intentType: intentResult.intent_type,
        confidence: intentResult.confidence,
        keyInfo: intentResult.key_info,
        clarificationNeeded: intentResult.clarification_needed,
        clarificationQuestions: intentResult.clarification_questions,
      });

      this.sendMessage({
        type: 'agent_message' as any,
        agent: 'intent_recognition',
        content: `已识别任务类型：${this.getIntentTypeName(intentResult.intent_type)}`,
        metadata: {
          intent_type: intentResult.intent_type,
          confidence: intentResult.confidence,
        },
      });

      // Step 2: 任务规划
      this.sendMessage({
        type: 'agent_message' as any,
        agent: 'planning',
        content: '正在规划任务详情...',
      });

      const taskDescription = await this.layer2.generateTaskDescription(
        intentResult,
        userInput
      );

      // 保存任务描述
      const intentResultRecord = await taskCreationSessionDAO.getIntentResult(this.sessionId!);
      await taskCreationSessionDAO.saveTaskDescription({
        sessionId: this.sessionId!,
        intentResultId: intentResultRecord!.id,
        title: taskDescription.title,
        objective: taskDescription.objective,
        scope: taskDescription.scope,
        deliverables: taskDescription.deliverables,
        constraints: taskDescription.constraints,
        additionalInfo: taskDescription.additional_info,
      });

      this.sendMessage({
        type: 'agent_message' as any,
        agent: 'planning',
        content: `任务规划完成：${taskDescription.title}`,
        metadata: {
          task_description: taskDescription,
        },
      });

      // Step 3: 生成执行计划
      this.sendMessage({
        type: 'agent_message' as any,
        agent: 'execution_plan',
        content: '正在生成执行计划...',
      });

      const executionPlan = await this.layer3.generateExecutionPlan(taskDescription);

      // 保存执行计划
      const taskDescriptionRecord = await taskCreationSessionDAO.getTaskDescription(this.sessionId!);
      await taskCreationSessionDAO.saveExecutionPlan({
        sessionId: this.sessionId!,
        taskDescriptionId: taskDescriptionRecord!.id,
        projectTitle: executionPlan.project.title,
        projectDescription: executionPlan.project.description,
        estimatedTotalHours: executionPlan.project.estimated_total_hours,
        managers: executionPlan.project.managers,
      });

      // 更新会话状态为完成
      await taskCreationSessionDAO.updateSessionStatus(this.sessionId!, 'completed');

      this.sendMessage({
        type: 'plan_generated' as any,
        plan: executionPlan,
      });

      return executionPlan;
    } catch (error: any) {
      // 更新会话状态为失败
      if (this.sessionId) {
        await taskCreationSessionDAO.updateSessionStatus(this.sessionId, 'failed');
      }

      this.sendMessage({
        type: 'error' as any,
        message: error.message || '任务创建失败',
      });

      throw error;
    }
  }

  /**
   * 发送消息到前端
   */
  private sendMessage(message: WebSocketMessage): void {
    if (this.callbacks?.onMessage) {
      this.callbacks.onMessage(message);
    }
  }

  /**
   * 获取意图类型的中文名称
   */
  private getIntentTypeName(intentType: string): string {
    const nameMap: Record<string, string> = {
      research: '行业调研',
      data_analysis: '数据分析',
      competitor_analysis: '竞争对手分析',
      seo_optimization: 'SEO 优化',
      content_optimization: '内容优化',
      content_creation: '内容创建',
      design_creation: '设计创建',
      software_development: '软件开发',
      strategy_planning: '策略规划',
      business_planning: '商业规划',
      other: '其他',
    };

    return nameMap[intentType] || intentType;
  }

  /**
   * 设置回调函数
   */
  setCallbacks(callbacks: TaskCreationCallbacks): void {
    this.callbacks = callbacks;
    
    if (callbacks.onAskUser) {
      this.layer1.setUserCallback(callbacks.onAskUser);
      this.layer2.setUserCallback(callbacks.onAskUser);
    }

    if (callbacks.onSearch) {
      this.layer2.setSearchCallback(callbacks.onSearch);
    }
  }
}
