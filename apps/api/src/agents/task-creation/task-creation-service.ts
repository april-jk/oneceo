/**
 * 任务创建服务 (TaskCreationService)
 * 
 * 负责编排三层 Agent 的工作流程
 */

import { IntentRecognitionAgent } from './layers/intent-recognition-agent';
import { PlanningAgent } from './layers/planning-agent';
import { ExecutionPlanAgent } from './layers/execution-plan-agent';
import { executionReviewAgent } from './layers/execution-review-agent';
import type { ExecutionPlan, WebSocketMessage, MessageType } from './types/intent';
import { taskCreationSessionDAO } from '../../db/dao';
import { ensureDatabaseConnection } from '../../config/database';
import { getPublicErrorMessage } from '../../utils/error-response';
import { normalizeOpencodeModel } from '../../utils/opencode-model';
import { isAwaitingUserInputError, RecoverableAgentError } from './errors';
import { sandboxAgentProvisionService } from '../../services/sandbox-agent-provision-service';
import { osacAgentService } from '../../services/osac-agent-service';

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
  private osacEnabled = (process.env.OSAC_EXECUTION_ENABLED || 'true').toLowerCase() === 'true';
  private osacMaxAttempts = Number(process.env.OSAC_EXECUTION_RETRIES || 2);

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

      let intentResult;
      try {
        intentResult = await this.layer1.recognizeIntent(userInput);
      } catch (error: any) {
        if (this.isRecoverableLlmError(error)) {
          throw new RecoverableAgentError(error.message || '意图识别失败');
        }
        throw error;
      }
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

      let taskDescription;
      try {
        taskDescription = await this.layer2.generateTaskDescription(
          intentResult,
          userInput
        );
      } catch (error: any) {
        if (this.isRecoverableLlmError(error)) {
          throw new RecoverableAgentError(error.message || '任务描述生成失败');
        }
        throw error;
      }

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

      let executionPlan: ExecutionPlan;
      try {
        executionPlan = await this.layer3.generateExecutionPlan(taskDescription);
      } catch (error: any) {
        if (this.isRecoverableLlmError(error)) {
          throw new RecoverableAgentError(error.message || '执行计划生成失败');
        }
        throw error;
      }
      console.log('[TaskCreationService] 执行计划生成完成');

      // 保存执行计划
      const taskDescriptionRecord = await this.runDbOperation(
        'getTaskDescription',
        () => taskCreationSessionDAO.getTaskDescription(this.sessionId!)
      );
      if (!taskDescriptionRecord) {
        throw new Error('数据库中未找到任务描述记录');
      }
      const estimatedTotalHoursRaw = executionPlan.project.estimated_total_hours;
      const estimatedTotalHours = Number.isFinite(estimatedTotalHoursRaw)
        ? Number(estimatedTotalHoursRaw)
        : typeof estimatedTotalHoursRaw === 'string' && estimatedTotalHoursRaw.trim() !== ''
          ? Number(estimatedTotalHoursRaw)
          : undefined;

      await this.runDbOperation(
        'saveExecutionPlan',
        () =>
          taskCreationSessionDAO.saveExecutionPlan({
            sessionId: this.sessionId!,
            taskDescriptionId: taskDescriptionRecord.id,
            projectTitle: executionPlan.project.title,
            projectDescription: executionPlan.project.description,
            estimatedTotalHours: Number.isFinite(estimatedTotalHours)
              ? Math.round(estimatedTotalHours as number)
              : undefined,
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

      // Step 4: 交由 OSAC 在 sandbox 内执行（可开关）
      if (this.osacEnabled) {
        await this.executeInSandbox({
          userInput,
          taskDescription,
          executionPlan,
        });
      }

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

      if (error instanceof RecoverableAgentError) {
        this.setStage('executing');
        this.sendStatus('execution', '模型暂时不可用，稍后自动继续处理...');
        if (this.sessionId) {
          try {
            await this.runDbOperation(
              'updateSessionStatus:in_progress',
              () => taskCreationSessionDAO.updateSessionStatus(this.sessionId!, 'in_progress')
            );
          } catch (dbError: any) {
            console.warn('[TaskCreationService] 更新会话状态失败:', dbError?.message || dbError);
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

  private buildOpencodeCommand(payload: {
    userInput: string;
    taskDescription: any;
    executionPlan: ExecutionPlan;
  }): string {
    const prompt = [
      '你是执行智能体，请依据以下任务信息在当前工作区完成执行：',
      `用户需求: ${payload.userInput}`,
      `任务描述: ${JSON.stringify(this.pickTaskDescription(payload.taskDescription))}`,
      `执行计划摘要: ${JSON.stringify(this.pickExecutionSummary(payload.executionPlan))}`,
      '要求：',
      '1) 以命令行模式执行（不要进入交互式界面）。',
      '2) 输出可落地的执行结果与产出说明。',
      '3) 如需生成文件，请直接写入当前工作区并在输出中说明文件路径。',
    ].join('\n');

    const flattened = prompt
      .replace(/\r?\n/g, ' ')
      .replace(/"/g, "'")
      .replace(/\s+/g, ' ')
      .trim();

    // 注意：OSAC 侧以空格拆分命令参数，避免使用引号包裹导致解析异常
    return `run --format json --model ${this.resolveOpencodeModel()} ${flattened}`;
  }

  private buildOpencodeCommandWithFeedback(payload: {
    userInput: string;
    taskDescription: any;
    executionPlan: ExecutionPlan;
    lastOutput: string;
    feedback: string;
  }): string {
    const prompt = [
      '你是执行智能体，请基于上一轮执行结果进行修订与完善：',
      `用户需求: ${payload.userInput}`,
      `任务描述: ${JSON.stringify(this.pickTaskDescription(payload.taskDescription))}`,
      `执行计划摘要: ${JSON.stringify(this.pickExecutionSummary(payload.executionPlan))}`,
      `上一轮输出: ${payload.lastOutput}`,
      `改进要求: ${payload.feedback}`,
      '要求：',
      '1) 继续命令行模式执行（不要进入交互式界面）。',
      '2) 补齐缺口并输出更新后的交付物说明。',
      '3) 如需生成/修改文件，请直接写入当前工作区并在输出中说明文件路径。',
    ].join('\n');

    const flattened = prompt
      .replace(/\r?\n/g, ' ')
      .replace(/"/g, "'")
      .replace(/\s+/g, ' ')
      .trim();

    return `run --format json --model ${this.resolveOpencodeModel()} ${flattened}`;
  }

  private resolveOpencodeModel(): string {
    const raw = (process.env.OPENCODE_MODEL || '').trim();
    if (!raw) {
      throw new Error('OPENCODE_MODEL 未配置');
    }
    const normalized = normalizeOpencodeModel(
      raw,
      process.env.OPENCODE_PROVIDER_ID || 'openai'
    );
    if (!normalized) {
      throw new Error('OPENCODE_MODEL 格式无效');
    }
    return normalized.fullModel;
  }

  private async executeInSandbox(payload: {
    userInput: string;
    taskDescription: any;
    executionPlan: ExecutionPlan;
  }) {
    this.sendStatus('execution', '正在启动执行环境...');

    let lastError: unknown;
    for (let attempt = 1; attempt <= this.osacMaxAttempts; attempt++) {
      try {
        const provision = await sandboxAgentProvisionService.provision({
          metadata: {
            taskSessionId: this.sessionId,
            taskTitle: payload.executionPlan?.project?.title,
          },
        });

        this.sendMessage({
          type: 'agent_message' as any,
          agent: 'execution_plan',
          content: '执行环境已就绪，开始下发执行指令...',
          metadata: {
            osacEndpoint: provision.osacEndpoint,
            osacHost: provision.osacHost,
            osacHostPort: provision.osacHostPort,
            osacConnectionMode: provision.osacConnectionMode,
            osacAuthToken: provision.osacAuthToken,
            orchestratorSessionId: provision.sessionId,
          },
        });

        const maxRounds = Number(process.env.OSAC_EXECUTION_ROUNDS || 3);
        let lastOutput = '';
        let command = this.buildOpencodeCommand(payload);

        for (let round = 1; round <= maxRounds; round += 1) {
          this.sendMessage({
            type: 'agent_message' as any,
            agent: 'execution_plan',
            content: `执行指令已提交到 OSAC，正在执行中...（第 ${round}/${maxRounds} 轮）`,
            metadata: {
              osacCommand: command,
              orchestratorSessionId: provision.sessionId,
            },
          });

          const result = await osacAgentService.executeCommandAndWait(
            provision.sessionId,
            { command },
            {
              timeoutMs: Number(process.env.OSAC_COMMAND_TIMEOUT_MS || 900000),
              pollMs: Number(process.env.OSAC_COMMAND_POLL_MS || 2000),
            }
          );

          lastOutput = result.output || lastOutput;

          if (result.status && result.status !== 'completed' && result.status !== 'success') {
            this.sendMessage({
              type: 'agent_message' as any,
              agent: 'execution_plan',
              content: `OSAC 执行返回状态: ${result.status}`,
            });
          }

          const review = await executionReviewAgent.review({
            userInput: payload.userInput,
            taskDescription: payload.taskDescription,
            executionPlan: payload.executionPlan,
            executionOutput: lastOutput || '（无输出）',
          });

          this.sendMessage({
            type: 'agent_message' as any,
            agent: 'execution_plan',
            content: review.summary || '已完成执行结果评估',
            metadata: {
              reviewDone: review.done,
              reviewIssues: review.issues,
            },
          });

          if (review.done || !review.next_instructions) {
            break;
          }

          command = this.buildOpencodeCommandWithFeedback({
            ...payload,
            lastOutput,
            feedback: review.next_instructions,
          });
        }
        return;
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        this.sendMessage({
          type: 'agent_message' as any,
          agent: 'execution_plan',
          content: `执行环境调度失败（第 ${attempt}/${this.osacMaxAttempts} 次）：${message}`,
        });
        if (attempt < this.osacMaxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error('执行环境调度失败');
  }

  private pickTaskDescription(taskDescription: any) {
    if (!taskDescription) return {};
    return {
      title: taskDescription.title,
      objective: taskDescription.objective,
      scope: taskDescription.scope,
      deliverables: taskDescription.deliverables,
      constraints: taskDescription.constraints,
    };
  }

  private pickExecutionSummary(executionPlan: ExecutionPlan) {
    if (!executionPlan) return {};
    const project = executionPlan.project || ({} as any);
    return {
      title: project.title,
      description: project.description,
      total_estimated_hours: (project as any).total_estimated_hours ?? project.estimated_total_hours,
      managers: Array.isArray(project.managers)
        ? project.managers.map((manager: any) => ({
            id: manager.id,
            name: manager.name,
            task_count: Array.isArray(manager.tasks) ? manager.tasks.length : 0,
          }))
        : [],
    };
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

  private isRecoverableLlmError(error: unknown): boolean {
    if (!error) return false;
    const message = error instanceof Error ? error.message : String(error);
    const normalized = message.toLowerCase();
    return (
      normalized.includes('llm') ||
      normalized.includes('timeout') ||
      normalized.includes('timed out') ||
      normalized.includes('rate limit') ||
      normalized.includes('429') ||
      normalized.includes('econnreset') ||
      normalized.includes('econnrefused') ||
      normalized.includes('socket') ||
      normalized.includes('network') ||
      normalized.includes('502') ||
      normalized.includes('503') ||
      normalized.includes('504')
    );
  }

  async resumeTask(sessionId: string, latestUserInput?: string): Promise<void> {
    this.sessionId = sessionId;
    await ensureDatabaseConnection({ retries: 3, delayMs: 1200 });

    const [messages, intentResultRecord, taskDescriptionRecord, executionPlanRecord] = await Promise.all([
      taskCreationSessionDAO.getMessages(sessionId),
      taskCreationSessionDAO.getIntentResult(sessionId),
      taskCreationSessionDAO.getTaskDescription(sessionId),
      taskCreationSessionDAO.getExecutionPlan(sessionId),
    ]);

    const firstUserInput =
      messages.find((m) => m.messageType === 'user_input')?.content ||
      latestUserInput ||
      '';

    let taskDescription: any = taskDescriptionRecord
      ? {
          title: taskDescriptionRecord.title,
          objective: taskDescriptionRecord.objective,
          scope: taskDescriptionRecord.scope,
          deliverables: taskDescriptionRecord.deliverables,
          constraints: taskDescriptionRecord.constraints,
          additional_info: taskDescriptionRecord.additionalInfo,
        }
      : null;

    if (!taskDescription && intentResultRecord && firstUserInput) {
      const intentResult: any = {
        intent_type: intentResultRecord.intentType,
        confidence: intentResultRecord.confidence,
        key_info: intentResultRecord.keyInfo,
        clarification_needed: intentResultRecord.clarificationNeeded,
        clarification_questions: intentResultRecord.clarificationQuestions,
      };
      taskDescription = await this.layer2.generateTaskDescription(intentResult, firstUserInput);

      await this.runDbOperation(
        'saveTaskDescription:resume',
        () =>
          taskCreationSessionDAO.saveTaskDescription({
            sessionId,
            intentResultId: intentResultRecord.id,
            title: taskDescription.title,
            objective: taskDescription.objective,
            scope: taskDescription.scope,
            deliverables: taskDescription.deliverables,
            constraints: taskDescription.constraints,
            additionalInfo: taskDescription.additional_info,
          })
      );
    }

    if (!taskDescription) {
      throw new RecoverableAgentError('缺少任务描述，无法恢复任务');
    }

    let executionPlan: ExecutionPlan | null = executionPlanRecord
      ? ({
          project: {
            title: executionPlanRecord.projectTitle,
            description: executionPlanRecord.projectDescription || '',
            estimated_total_hours: executionPlanRecord.estimatedTotalHours ?? undefined,
            managers: executionPlanRecord.managers as any,
          },
        } as ExecutionPlan)
      : null;

    if (!executionPlan) {
      this.setStage('executing');
      this.sendStatus('execution', '正在重新生成执行计划...');
      executionPlan = await this.layer3.generateExecutionPlan(taskDescription);

      const latestTaskDescription = taskDescriptionRecord || (await taskCreationSessionDAO.getTaskDescription(sessionId));
      if (!latestTaskDescription) {
        throw new RecoverableAgentError('执行计划生成完成但未找到任务描述记录');
      }
      await this.runDbOperation(
        'saveExecutionPlan:resume',
        () =>
          taskCreationSessionDAO.saveExecutionPlan({
            sessionId,
            taskDescriptionId: latestTaskDescription.id,
            projectTitle: executionPlan!.project.title,
            projectDescription: executionPlan!.project.description,
            estimatedTotalHours:
              typeof executionPlan!.project.estimated_total_hours === 'number'
                ? Math.round(executionPlan!.project.estimated_total_hours)
                : undefined,
            managers: executionPlan!.project.managers,
          })
      );
      this.sendStatus('execution', '执行计划已生成');
      this.sendMessage({ type: 'plan_generated' as any, plan: executionPlan });
    }

    if (this.osacEnabled && executionPlan) {
      await this.executeInSandbox({
        userInput: firstUserInput,
        taskDescription,
        executionPlan,
      });
    }
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
