/**
 * 任务创建服务 (TaskCreationService)
 * 
 * 负责编排三层 Agent 的工作流程
 */

import { randomUUID } from 'node:crypto';
import { IntentRecognitionAgent } from './layers/intent-recognition-agent';
import { PlanningAgent } from './layers/planning-agent';
import { ExecutionPlanAgent } from './layers/execution-plan-agent';
import type { ExecutionPlan, WebSocketMessage, IntentRecognitionResult } from './types/intent';
import { taskCreationSessionDAO, taskSessionRunDAO } from '../../db/dao';
import { ensureDatabaseConnection } from '../../config/database';
import { getPublicErrorMessage } from '../../utils/error-response';
import {
  InterruptedTaskError,
  isAwaitingUserInputError,
  isInterruptedTaskError,
  RecoverableAgentError,
} from './errors';
import { classifyTaskIntentShape, type TaskIntentShape } from '../../services/task-intent-shape-service';
import { taskCreationFileMemoryStore } from './file-memory-store';
import { AltusRunState } from '../../services/altus-run-state';
import { altusRunCoordinator } from '../../services/altus-run-coordinator';
import { altusMemoryContextService } from '../../services/altus-memory-context-service';
import { altusManagedSetupService } from '../../services/altus-managed-setup-service';
import { deriveManagedTaskIntentProfile } from '../../services/altus-managed-prompt-service';
import { readManagedSkillCatalog, readManagedSkillContext } from '../../services/altus-managed-shared';
import { readSessionSkillState } from '../../services/task-session-skill-state-service';

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

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
  private stage: 'collecting' | 'clarifying' | 'planning' | 'executing' | 'reviewing' | 'completed' | 'failed' =
    'collecting';
  private phase: 'ideation' | 'analysis' | 'development' | 'testing' | 'repair' | 'delivery' = 'ideation';
  private osacEnabled = (process.env.OSAC_EXECUTION_ENABLED || 'false').toLowerCase() === 'true';
  private osacMaxAttempts = Number(process.env.OSAC_EXECUTION_RETRIES || 2);
  private osacExecutionMode = this.normalizeExecutionMode(process.env.OSAC_EXECUTION_MODE);
  private runControl:
    | {
        isCancelled: () => boolean;
        getCancelReason?: () => string | undefined;
        setPhase?: (phase: 'intent_processing' | 'executor_processing') => void;
      }
    | null = null;

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

  setRunControl(
    control:
      | {
          isCancelled: () => boolean;
          getCancelReason?: () => string | undefined;
          setPhase?: (phase: 'intent_processing' | 'executor_processing') => void;
        }
      | null
  ): void {
    this.runControl = control;
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
    messageType: 'user_input' | 'user_response' = 'user_input',
    metadata?: Record<string, unknown>
  ): Promise<ExecutionPlan> {
    try {
      const resolvedUserId = asText(userId);
      if (!resolvedUserId) {
        throw new Error('无法识别当前用户，请先登录');
      }
      this.runControl?.setPhase?.('intent_processing');
      this.sessionId = sessionId;
      console.log('[TaskCreationService] 开始创建任务:', userInput);
      await ensureDatabaseConnection({ retries: 3, delayMs: 1200 });
      
      // 创建新的会话（或复用会话）
      if (!this.sessionId) {
        console.log('[TaskCreationService] 创建会话...');
        const session = await this.runDbOperation(
          'createSession',
          () => taskCreationSessionDAO.createSession({ userId: resolvedUserId })
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
              userId: resolvedUserId,
              status: 'in_progress',
            } as any)
          );
        } else {
          await this.runDbOperation('bindUserIfMissing', () =>
            taskCreationSessionDAO.bindUserIfMissing(this.sessionId!, resolvedUserId)
          );
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
            metadata: metadata || undefined,
          })
      );

      const existingIntentRecord = this.sessionId
        ? await this.runDbOperation(
            'getIntentResult',
            () => taskCreationSessionDAO.getIntentResult(this.sessionId!)
          )
        : null;
      const existingTaskDescriptionRecord = this.sessionId
        ? await this.runDbOperation(
            'getTaskDescription',
            () => taskCreationSessionDAO.getTaskDescription(this.sessionId!)
          )
        : null;

      // Step 1: 意图识别
      console.log('[TaskCreationService] 开始 Layer 1: 意图识别');
      this.setStage('collecting');
      this.throwIfCancelled();
      let intentResult: IntentRecognitionResult;
      if (existingIntentRecord) {
        intentResult = {
          intent_type: existingIntentRecord.intentType,
          confidence: existingIntentRecord.confidence,
          key_info: existingIntentRecord.keyInfo,
          clarification_needed: existingIntentRecord.clarificationNeeded,
          clarification_questions: existingIntentRecord.clarificationQuestions,
          next_agent: 'planning_agent',
        } as any;
        const confidenceScore = this.normalizeConfidence(intentResult.confidence);

        this.setStage('planning');
        this.sendPhaseStatus('analysis', '分析阶段：沿用历史任务定义，更新任务规划...', 'planning');
        this.sendMessage({
          type: 'agent_message' as any,
          agent: 'intent_recognition',
          content: `沿用任务类型：${this.getIntentTypeName(intentResult.intent_type)}`,
          metadata: {
            intent_type: intentResult.intent_type,
            confidence: confidenceScore,
            next_action: 'plan',
            reused: true,
          },
        });
      } else {
        this.sendPhaseStatus('ideation', '构思阶段：正在整理需求...', 'system');
        this.sendPhaseStatus('analysis', '分析阶段：正在分析您的任务需求...', 'intent');

        try {
          intentResult = await this.layer1.recognizeIntent(userInput);
        } catch (error: any) {
          if (this.isRecoverableLlmError(error)) {
            throw new RecoverableAgentError(error.message || '意图识别失败');
          }
          throw error;
        }
        console.log('[TaskCreationService] 意图识别完成:', intentResult);
        this.throwIfCancelled();
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
      }

      // Step 2: 任务规划
      this.setStage('planning');
      if (!existingIntentRecord) {
        this.sendPhaseStatus('analysis', '分析阶段：正在规划任务详情...', 'planning');
      }
      this.throwIfCancelled();

      let taskDescription;
      try {
        const planningInput = this.buildPlanningInput(
          userInput,
          existingTaskDescriptionRecord
            ? {
                title: existingTaskDescriptionRecord.title,
                objective: existingTaskDescriptionRecord.objective,
                scope: existingTaskDescriptionRecord.scope,
                deliverables: existingTaskDescriptionRecord.deliverables,
                constraints: existingTaskDescriptionRecord.constraints,
                additional_info: existingTaskDescriptionRecord.additionalInfo,
              }
            : null
        );
        taskDescription = await this.layer2.generateTaskDescription(
          intentResult,
          planningInput
        );
      } catch (error: any) {
        if (this.isRecoverableLlmError(error)) {
          throw new RecoverableAgentError(error.message || '任务描述生成失败');
        }
        throw error;
      }
      this.throwIfCancelled();

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
      this.setStage('planning');
      this.sendPhaseStatus('analysis', '分析阶段：正在生成执行计划...', 'planning');
      this.throwIfCancelled();

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
      this.throwIfCancelled();

      // 保存执行计划
      const taskDescriptionRecord = await this.runDbOperation(
        'getTaskDescription',
        () => taskCreationSessionDAO.getTaskDescription(this.sessionId!)
      );
      if (!taskDescriptionRecord) {
        throw new Error('数据库中未找到任务描述记录');
      }
      const estimatedTotalHoursRaw = executionPlan.project.estimated_total_hours;
      const estimatedTotalHours =
        typeof estimatedTotalHoursRaw === 'number' && Number.isFinite(estimatedTotalHoursRaw)
          ? estimatedTotalHoursRaw
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

      this.sendMessage({
        type: 'plan_generated' as any,
        plan: executionPlan,
      });

      // Step 4: 交由 OSAC 在 sandbox 内执行（可开关）
      if (this.osacEnabled) {
        this.runControl?.setPhase?.('executor_processing');
        await this.runDbOperation(
          'updateSessionStatus:in_progress',
          () => taskCreationSessionDAO.updateSessionStatus(this.sessionId!, 'in_progress')
        );
        this.setStage('executing');
        this.sendPhaseStatus('development', '开发阶段：执行计划已生成，正在启动执行环境...', 'execution');

        await this.executeInSandbox({
          userInput,
          userId: resolvedUserId,
          metadata,
          taskDescription,
          executionPlan,
        });

        if (this.osacExecutionMode !== 'command') {
          return executionPlan;
        }

        await this.runDbOperation(
          'updateSessionStatus:completed',
          () => taskCreationSessionDAO.updateSessionStatus(this.sessionId!, 'completed')
        );
        this.setStage('completed');
        this.sendPhaseStatus('delivery', '交付阶段：执行任务已完成', 'execution');
        return executionPlan;
      }

      // 未启用 OSAC 时，本轮执行计划生成即视为完成
      await this.runDbOperation(
        'updateSessionStatus:completed',
        () => taskCreationSessionDAO.updateSessionStatus(this.sessionId!, 'completed')
      );
      this.setStage('completed');
      this.sendPhaseStatus('delivery', '交付阶段：执行计划已生成', 'planning');

      return executionPlan;
    } catch (error: any) {
      if (isInterruptedTaskError(error)) {
        if (this.sessionId) {
          try {
            await this.runDbOperation(
              'updateSessionStatus:in_progress_after_interrupt',
              () => taskCreationSessionDAO.updateSessionStatus(this.sessionId!, 'in_progress')
            );
          } catch (dbError: any) {
            console.warn('[TaskCreationService] 更新会话中断状态失败:', dbError?.message || dbError);
          }
        }
        this.sendStatus('system', '当前处理已停止');
        (error as any).__clientNotified = true;
        throw error;
      }
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
        const tone =
          this.stage === 'collecting'
            ? 'intent'
            : this.stage === 'planning'
              ? 'planning'
              : this.stage === 'reviewing'
                ? 'review'
                : 'execution';
        this.sendStatus(tone, '模型暂时不可用，稍后自动继续处理...');
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

  private throwIfCancelled(): void {
    if (!this.runControl?.isCancelled?.()) return;
    throw new InterruptedTaskError(
      this.runControl?.getCancelReason?.() || '当前处理已停止'
    );
  }

  private setStage(
    stage: 'collecting' | 'clarifying' | 'planning' | 'executing' | 'reviewing' | 'completed' | 'failed'
  ): void {
    this.stage = stage;
    if (this.sessionId) {
      void taskCreationFileMemoryStore.updateSessionState(this.sessionId, { stage });
    }
  }

  private setPhase(
    phase: 'ideation' | 'analysis' | 'development' | 'testing' | 'repair' | 'delivery'
  ): void {
    this.phase = phase;
    if (this.sessionId) {
      void taskCreationFileMemoryStore.updateSessionState(this.sessionId, { phase });
    }
  }

  private sendPhaseStatus(
    phase: 'ideation' | 'analysis' | 'development' | 'testing' | 'repair' | 'delivery',
    content: string,
    tone: 'system' | 'intent' | 'planning' | 'execution' | 'review' | 'error' = 'system'
  ): void {
    this.setPhase(phase);
    if (this.sessionId) {
      void taskCreationFileMemoryStore.updateSessionState(this.sessionId, {
        phase,
        stage: this.stage,
      });
    }
    this.sendMessage({
      type: 'status_update' as any,
      agent: 'system',
      tone,
      stage: this.stage,
      phase,
      content,
      metadata: {
        phase,
      },
    } as any);
  }

  private sendStatus(
    tone: 'system' | 'intent' | 'planning' | 'execution' | 'review' | 'error',
    content: string
  ): void {
    if (this.sessionId) {
      void taskCreationFileMemoryStore.updateSessionState(this.sessionId, { stage: this.stage });
    }
    this.sendMessage({
      type: 'status_update' as any,
      agent:
        tone === 'intent'
          ? 'intent_recognition'
          : tone === 'planning'
            ? 'planning'
            : tone === 'execution'
              ? 'execution_plan'
              : tone === 'review'
                ? 'execution_review'
                : 'system',
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

  private buildExecutionBrief(
    payload: {
      userInput: string;
      taskDescription: any;
      executionPlan: ExecutionPlan;
    },
    phase: 'development' | 'testing' | 'repair' = 'development'
  ): string {
    const phaseHint =
      phase === 'testing'
        ? '当前处于【测试阶段】'
        : phase === 'repair'
          ? '当前处于【修复阶段】'
          : '当前处于【开发阶段】';
    const shape = this.resolveExecutionShape(payload);
    const requirements = this.buildExecutionRequirements(shape);
    return [
      phaseHint,
      '你是执行智能体，请依据以下任务信息在当前工作区完成执行：',
      `用户需求: ${payload.userInput}`,
      `任务描述: ${JSON.stringify(this.pickTaskDescription(payload.taskDescription))}`,
      `执行计划摘要: ${JSON.stringify(this.pickExecutionSummary(payload.executionPlan))}`,
      '要求：',
      '1) 以命令行模式执行（不要进入交互式界面）。',
      '2) 输出可落地的执行结果与产出说明。',
      '3) 如需生成文件，请直接写入当前工作区并在输出中说明文件路径。',
      ...requirements.map((item, index) => `${index + 4}) ${item}`),
    ].join('\n');
  }

  private async executeInSandbox(payload: {
    userInput: string;
    userId: string;
    metadata?: Record<string, unknown>;
    taskDescription: any;
    executionPlan: ExecutionPlan;
  }) {
    this.throwIfCancelled();
    this.setStage('executing');
    this.sendPhaseStatus('development', '开发阶段：正在启动 Altus 执行环境...', 'execution');

    let lastError: unknown;
    for (let attempt = 1; attempt <= this.osacMaxAttempts; attempt++) {
      try {
        this.throwIfCancelled();
        if (!this.sessionId) {
          throw new Error('当前任务会话不存在，无法启动 Altus 执行');
        }
        if (!payload.userId) {
          throw new Error('当前用户不存在，无法启动 Altus 执行');
        }

        await altusManagedSetupService.ensureSessionOwnership(this.sessionId, payload.userId);
        const connectorSnapshot = await altusManagedSetupService.captureConnectorSnapshot(this.sessionId, payload.userId);
        const mcpToolSnapshot = await altusManagedSetupService.captureMcpToolSnapshot(this.sessionId);
        const sessionMemory = await taskCreationFileMemoryStore.getSession(this.sessionId);
        const executionShape = this.resolveExecutionShape(payload);
        const run = await taskSessionRunDAO.createRun({
          id: randomUUID(),
          sessionId: this.sessionId,
          status: 'queued',
          mode: 'managed',
          model: this.resolveAltusModel(),
          connectorSnapshotId: connectorSnapshot.snapshotId,
          mcpToolSnapshotId: mcpToolSnapshot.snapshotId,
          metadataJson: {
            trigger: 'task_creation_execution_handoff',
            source: 'task_creation_service',
            executionMode: this.osacExecutionMode,
            artifactKind: executionShape.artifactKind,
          },
        });
        const taskIntentProfile = deriveManagedTaskIntentProfile([
          payload.userInput,
          asText(payload.taskDescription?.title),
          asText(payload.taskDescription?.objective),
          ...(Array.isArray(payload.taskDescription?.deliverables) ? payload.taskDescription.deliverables : []),
          ...(Array.isArray(payload.taskDescription?.constraints) ? payload.taskDescription.constraints : []),
        ]);
        const skillCatalog = readManagedSkillCatalog(payload.metadata?.managedSkillCatalog);
        const skills = readManagedSkillContext(payload.metadata?.managedSkillContext);
        const residentSkillSelections = skills.map((item) => ({
          sourceType: item.sourceType,
          skillId: item.skillId,
          revisionId: item.revisionId,
        }));
        const sessionSkillState = readSessionSkillState(payload.metadata?.sessionSkillState);
        const memoryContext = await altusMemoryContextService.buildPromptSectionForRun({
          sessionId: this.sessionId,
          userId: payload.userId,
        });
        const state = new AltusRunState({
          runId: run.id,
          sessionId: this.sessionId,
          userId: payload.userId,
          model: run.model || this.resolveAltusModel(),
          userInput: this.buildExecutionBrief(payload, 'development'),
          sessionTitle: sessionMemory?.title || null,
          memoryContextPrompt: memoryContext.promptSection,
          userMemory: memoryContext.userMemory,
          projectMemory: memoryContext.projectMemory,
          sessionAltusMemory: memoryContext.sessionMemory,
          connectors: connectorSnapshot.statuses,
          mcpProviders: mcpToolSnapshot.providers as any,
          skillCatalog,
          skills,
          residentSkillSelections,
          sessionSkillState,
          taskIntentProfile,
        });

        this.sendMessage({
          type: 'agent_message' as any,
          agent: 'execution_plan',
          content: '执行环境已就绪，已切换到 Altus 执行循环。',
          metadata: {
            runId: run.id,
            executor: 'altus',
            executionMode: 'altus_managed',
            artifactKind: executionShape.artifactKind,
          },
        });

        const abortController = new AbortController();
        const cancelWatcher = setInterval(() => {
          if (!abortController.signal.aborted && this.runControl?.isCancelled?.()) {
            abortController.abort();
          }
        }, 500);

        try {
          await altusRunCoordinator.execute(state, abortController);
        } finally {
          clearInterval(cancelWatcher);
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
      additional_info: taskDescription.additional_info,
    };
  }

  private resolveExecutionShape(payload: {
    userInput: string;
    taskDescription: any;
    executionPlan: ExecutionPlan;
  }): TaskIntentShape {
    return classifyTaskIntentShape([
      payload.userInput,
      asText(payload.taskDescription?.title),
      asText(payload.taskDescription?.objective),
      asText(payload.taskDescription?.scope),
      ...(Array.isArray(payload.taskDescription?.deliverables) ? payload.taskDescription.deliverables : []),
      ...(Array.isArray(payload.taskDescription?.constraints) ? payload.taskDescription.constraints : []),
      asText(payload.taskDescription?.additional_info?.artifactKind),
      asText(payload.executionPlan?.project?.title),
      asText(payload.executionPlan?.project?.description),
    ]);
  }

  private shouldUseBrowserValidation(shape: TaskIntentShape): boolean {
    return shape.artifactKind === 'web_app' && !shape.explicitNoWeb;
  }

  private normalizeExecutionMode(raw: unknown): string {
    const normalized = String(raw || '').trim().toLowerCase();
    if (!normalized || normalized === 'opencode_remote') {
      return 'altus_managed';
    }
    return normalized;
  }

  private resolveAltusModel(): string {
    return (
      asText(process.env.ALTUS_MANAGED_MODEL) ||
      asText(process.env.AGENT_OPENAI_MODEL) ||
      asText(process.env.OPENAI_MODEL) ||
      'qwen3-max'
    );
  }

  private buildExecutionRequirements(shape: TaskIntentShape): string[] {
    if (this.shouldUseBrowserValidation(shape)) {
      return [
        '必须使用 playwright-mcp 进行浏览器自动化验证。',
        'playwright-mcp 已预置，无需安装任何 Playwright 依赖，也不要修改 package.json 或执行 npm/pnpm 安装。',
        '必须连接到与 n.eko 同一实例的 Chromium（CDP 9222，例如 http://127.0.0.1:9222），不要启动新的独立浏览器实例。',
        '连接后复用现有浏览器上下文与首个页面（contexts[0] 与 pages[0]）；若无页面，仅在该上下文中创建一个新页面，确保同一个窗口可被 n.eko 捕获。',
        '要求 Playwright 以可视模式运行（headless=false），保证画面在调试窗口可见。',
        '若需启动网页服务，请使用可访问端口并明确输出访问地址。',
        '在输出中说明测试步骤、结果与发现的问题。',
        '如需用户协助（账号/权限/业务确认），请明确提出。',
      ];
    }

    const requirements = [
      '先直接产出最小可验证的实际文件，不要停留在规划、空回复或只描述方案。',
      '按任务类型做本地验证：脚本/CLI 用命令或样例输入验证，源码类任务检查文件结构、入口与使用说明。',
      '不要擅自改造成网页应用、浏览器自动化或部署流程；除非任务本身明确要求网页验证。',
      '如需运行命令，请优先使用最小可验证路径，并保留关键输出摘要。',
      '在输出中说明验证步骤、验证结果与发现的问题。',
      '如需用户协助（账号/权限/业务确认），请明确提出。',
    ];

    if (shape.artifactKind === 'script_artifact' || shape.scriptArtifactRequested) {
      requirements.splice(
        1,
        0,
        '脚本任务必须至少生成一个可执行脚本文件；若缺少输入样例，请在当前工作区创建最小样例数据并跑通至少一次命令验证。',
        '除非用户明确要求，否则不要引入新的第三方依赖；Python 脚本优先使用标准库完成 CSV/文本处理，避免因为环境缺包而中断交付。'
      );
    } else {
      requirements.splice(1, 0, '源码类任务至少生成入口文件或核心源码文件，并补充最小使用说明。');
    }

    return requirements;
  }

  private buildRepairRequirements(shape: TaskIntentShape): string[] {
    if (this.shouldUseBrowserValidation(shape)) {
      return [
        '必须使用 playwright-mcp 进行浏览器自动化验证（headless=false），输出测试步骤与结果。',
        'playwright-mcp 已预置，无需安装任何 Playwright 依赖，也不要修改 package.json 或执行 npm/pnpm 安装。',
        '必须连接到与 n.eko 同一实例的 Chromium（CDP 9222，例如 http://127.0.0.1:9222），不要启动新的独立浏览器实例。',
        '连接后复用现有浏览器上下文与首个页面（contexts[0] 与 pages[0]）；若无页面，仅在该上下文中创建一个新页面，确保同一个窗口可被 n.eko 捕获。',
      ];
    }

    const requirements = [
      '先补齐实际文件产出，再做最小验证闭环，不要只返回分析或计划。',
      '继续按任务类型做最小验证闭环：脚本/CLI 跑通命令与样例输入，源码类任务核对文件结构和使用说明。',
      '不要引入 Playwright、浏览器自动化或部署步骤，除非任务本身明确要求网页验证。',
      '补齐缺口后输出更新后的验证步骤、结果与剩余风险。',
    ];

    if (shape.artifactKind === 'script_artifact' || shape.scriptArtifactRequested) {
      requirements.splice(
        1,
        0,
        '若用户未提供样例输入，请先构造最小样例数据并验证脚本输出。',
        '若当前实现依赖环境中不存在的第三方包，请先改写为无需新增依赖的最小可运行版本，再继续验证。'
      );
    }

    return requirements;
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
            phase: (message as any).phase || (message as any).metadata?.phase,
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

  private buildPlanningInput(userInput: string, baseDescription?: Record<string, unknown> | null): string {
    if (!baseDescription) {
      return userInput;
    }
    const base = JSON.stringify(baseDescription);
    return `历史任务定义：${base}\n\n用户补充：${userInput}`;
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

  async resumeTask(sessionId: string, latestUserInput?: string, userId?: string): Promise<void> {
    const resolvedUserId = asText(userId);
    if (!resolvedUserId) {
      throw new Error('无法识别当前用户，请先登录');
    }
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

    if (!intentResultRecord && !taskDescriptionRecord && !executionPlanRecord) {
      const restartInput = (latestUserInput || firstUserInput || '').trim();
      if (!restartInput) {
        throw new RecoverableAgentError('缺少可恢复的用户输入，无法继续任务');
      }

      this.setStage('collecting');
      this.sendStatus('intent', '上下文不足，正在重新发起任务流程...');
      await this.createTask(restartInput, resolvedUserId, sessionId, 'user_response');
      return;
    }

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
      this.setStage('planning');
      this.sendStatus('planning', '正在重新生成执行计划...');
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
      this.sendStatus('planning', '执行计划已生成');
      this.sendMessage({ type: 'plan_generated' as any, plan: executionPlan });
    }

    if (this.osacEnabled && executionPlan) {
      await this.executeInSandbox({
        userInput: firstUserInput,
        userId: resolvedUserId,
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
