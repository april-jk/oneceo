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
import { ensureDatabaseConnection } from '../../config/database';
import { getPublicErrorMessage } from '../../utils/error-response';
import { isAwaitingUserInputError } from './errors';

export interface TaskCreationCallbacks {
  onMessage: (message: WebSocketMessage) => void;
  onAskUser: (question: string, options?: string[]) => Promise<string>;
  onSearch?: (query: string) => Promise<any[]>;
  onSessionCreated?: (sessionId: string) => void;
}

export class TaskCreationService {
  private layer1: IntentRecognitionAgent;
  private layer2: PlanningAgent;
  private layer3: ExecutionPlanAgent;
  private callbacks?: TaskCreationCallbacks;
  private sessionId?: string; // 当前会话 ID
  private stage: 'collecting' | 'clarifying' | 'planning' | 'executing' | 'completed' | 'failed' = 'collecting';

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
  async createTask(
    userInput: string,
    userId?: string,
    sessionId?: string,
    messageType: 'user_input' | 'user_response' = 'user_input'
  ): Promise<ExecutionPlan> {
    try {
      this.sessionId = sessionId;
      console.log('[TaskCreationService] 开始创建任务:', userInput);
      await ensureDatabaseConnection({ retries: 3, delayMs: 1200 });
      
      // 创建新的会话（或复用会话）
      if (!this.sessionId) {
        console.log('[TaskCreationService] 创建会话...');
        const session = await this.runDbOperation(
          'createSession',
          () => taskCreationSessionDAO.createSession({ userId })
        );
        this.sessionId = session.id;
        this.callbacks?.onSessionCreated?.(this.sessionId);
        console.log('[TaskCreationService] 会话创建成功:', this.sessionId);
      } else {
        const existed = await this.runDbOperation('getSession', () =>
          taskCreationSessionDAO.getSession(this.sessionId!)
        );
        if (!existed) {
          await this.runDbOperation('createSessionWithId', () =>
            taskCreationSessionDAO.createSession({
              id: this.sessionId!,
              userId,
              status: 'in_progress',
            } as any)
          );
        } else {
          await this.runDbOperation(
            'updateSessionStatus:in_progress',
            () => taskCreationSessionDAO.updateSessionStatus(this.sessionId!, 'in_progress')
          );
        }
      }

      // 保存用户输入消息
      await this.runDbOperation(
        'addMessage',
        () =>
          taskCreationSessionDAO.addMessage({
            sessionId: this.sessionId!,
            role: 'user',
            content: userInput,
            messageType,
          })
      );

      // Step 1: 意图识别
      console.log('[TaskCreationService] 开始 Layer 1: 意图识别');
      this.setStage('collecting');
      this.sendStatus('intent', '正在分析您的任务需求...');

      const intentResult = await this.layer1.recognizeIntent(userInput);
      console.log('[TaskCreationService] 意图识别完成:', intentResult);
      const confidenceScore = this.normalizeConfidence(intentResult.confidence);

      // 保存意图识别结果
      await this.runDbOperation(
        'saveIntentResult',
        () =>
          taskCreationSessionDAO.saveIntentResult({
            sessionId: this.sessionId!,
            userInput,
            intentType: intentResult.intent_type,
            confidence: confidenceScore,
            keyInfo: intentResult.key_info,
            clarificationNeeded: intentResult.clarification_needed,
            clarificationQuestions: intentResult.clarification_questions,
          })
      );

      this.sendMessage({
        type: 'agent_message' as any,
        agent: 'intent_recognition',
        content: `已识别任务类型：${this.getIntentTypeName(intentResult.intent_type)}`,
        metadata: {
          intent_type: intentResult.intent_type,
          confidence: confidenceScore,
          next_action: intentResult.clarification_needed ? 'ask_user' : 'plan',
        },
      });

      // Step 2: 任务规划
      this.setStage('planning');
      this.sendStatus('planning', '正在规划任务详情...');

      const taskDescription = await this.layer2.generateTaskDescription(
        intentResult,
        userInput
      );

      // 保存任务描述
      const intentResultRecord = await this.runDbOperation(
        'getIntentResult',
        () => taskCreationSessionDAO.getIntentResult(this.sessionId!)
      );
      if (!intentResultRecord) {
        throw new Error('数据库中未找到意图识别记录');
      }
      await this.runDbOperation(
        'saveTaskDescription',
        () =>
          taskCreationSessionDAO.saveTaskDescription({
            sessionId: this.sessionId!,
            intentResultId: intentResultRecord.id,
            title: taskDescription.title,
            objective: taskDescription.objective,
            scope: taskDescription.scope,
            deliverables: taskDescription.deliverables,
            constraints: taskDescription.constraints,
            additionalInfo: taskDescription.additional_info,
          })
      );

      this.sendMessage({
        type: 'agent_message' as any,
        agent: 'planning',
        content: `任务规划完成：${taskDescription.title}`,
        metadata: {
          task_description: taskDescription,
        },
      });

      // Step 3: 生成执行计划
      this.setStage('executing');
      this.sendStatus('execution', '正在生成执行计划...');

      const executionPlan = await this.withTimeout(
        this.layer3.generateExecutionPlan(taskDescription),
        Number(process.env.EXECUTION_PLAN_TIMEOUT_MS || 120000),
        '执行计划生成超时，请稍后重试'
      );
      console.log('[TaskCreationService] 执行计划生成完成');

      // 保存执行计划
      const taskDescriptionRecord = await this.runDbOperation(
        'getTaskDescription',
        () => taskCreationSessionDAO.getTaskDescription(this.sessionId!)
      );
      if (!taskDescriptionRecord) {
        throw new Error('数据库中未找到任务描述记录');
      }
      await this.runDbOperation(
        'saveExecutionPlan',
        () =>
          taskCreationSessionDAO.saveExecutionPlan({
            sessionId: this.sessionId!,
            taskDescriptionId: taskDescriptionRecord.id,
            projectTitle: executionPlan.project.title,
            projectDescription: executionPlan.project.description,
            estimatedTotalHours: executionPlan.project.estimated_total_hours,
            managers: executionPlan.project.managers,
          })
      );
      console.log('[TaskCreationService] 执行计划已保存到数据库');

      // 更新会话状态为完成
      await this.runDbOperation(
        'updateSessionStatus:completed',
        () => taskCreationSessionDAO.updateSessionStatus(this.sessionId!, 'completed')
      );
      this.setStage('completed');
      this.sendStatus('execution', '执行计划已生成');

      this.sendMessage({
        type: 'plan_generated' as any,
        plan: executionPlan,
      });

      return executionPlan;
    } catch (error: any) {
      if (isAwaitingUserInputError(error)) {
        this.setStage('clarifying');
        if (this.sessionId) {
          try {
            await this.runDbOperation(
              'updateSessionStatus:waiting_user',
              () => taskCreationSessionDAO.updateSessionStatus(this.sessionId!, 'waiting_user')
            );
          } catch (dbError: any) {
            console.warn('[TaskCreationService] 更新会话等待状态失败:', dbError?.message || dbError);
          }
        }
        (error as any).__clientNotified = true;
        throw error;
      }

      // 更新会话状态为失败
      this.setStage('failed');
      this.sendStatus('error', '任务处理失败');
      if (this.sessionId) {
        try {
          await this.runDbOperation(
            'updateSessionStatus:failed',
            () => taskCreationSessionDAO.updateSessionStatus(this.sessionId!, 'failed'),
            2,
            1000
          );
        } catch (dbError: any) {
          console.warn('[TaskCreationService] 更新会话失败状态失败:', dbError?.message || dbError);
        }
      }

      this.sendMessage({
        type: 'error' as any,
        message: getPublicErrorMessage('任务创建失败，请稍后重试'),
      });

      (error as any).__clientNotified = true;
      throw error;
    }
  }

  private async runDbOperation<T>(
    operationName: string,
    operation: () => Promise<T>,
    retries: number = 3,
    delayMs: number = 1200
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (attempt === retries) {
          break;
        }
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `[TaskCreationService] 数据库操作失败，重试中 (${operationName} ${attempt}/${retries}): ${message}`
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    const message = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(`数据库操作失败(${operationName}): ${message}`);
  }

  private normalizeConfidence(confidence: number): number {
    if (!Number.isFinite(confidence)) {
      return 0;
    }
    const normalized = confidence <= 1 ? confidence * 100 : confidence;
    return Math.max(0, Math.min(100, Math.round(normalized)));
  }

  private setStage(stage: 'collecting' | 'clarifying' | 'planning' | 'executing' | 'completed' | 'failed'): void {
    this.stage = stage;
  }

  private sendStatus(
    tone: 'system' | 'intent' | 'planning' | 'execution' | 'error',
    content: string
  ): void {
    this.sendMessage({
      type: 'status_update' as any,
      agent: tone === 'intent' ? 'intent_recognition' : tone === 'planning' ? 'planning' : tone === 'execution' ? 'execution_plan' : 'system',
      tone,
      stage: this.stage,
      content,
    } as any);
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    timeoutMessage: string
  ): Promise<T> {
    let timeoutHandle: NodeJS.Timeout | null = null;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timeoutHandle = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
        }),
      ]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  /**
   * 发送消息到前端
   */
  private sendMessage(message: WebSocketMessage): void {
    if (this.sessionId) {
      const content =
        message.content ||
        message.message ||
        message.question ||
        (message.type === 'plan_generated' ? '执行计划已生成' : '');

      if (content) {
        void taskCreationSessionDAO.addMessage({
          sessionId: this.sessionId,
          role: 'agent',
          content,
          messageType: message.type as any,
          metadata: {
            agent: message.agent,
            stage: (message as any).stage,
            tone: (message as any).tone,
            options: message.options,
            plan: message.plan,
            message: message.message,
            question: message.question,
          },
        });
      }
    }

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
