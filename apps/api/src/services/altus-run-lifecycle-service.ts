import { taskSessionRunDAO } from '../db/dao';
import { altusRunRedisStateService, AltusRunRedisStateService } from './altus-run-redis-state-service';
import { AltusRunState } from './altus-run-state';
import { AltusManagedSetupService, altusManagedSetupService } from './altus-managed-setup-service';
import { AltusRunEventWriter, altusRunEventWriter } from './altus-run-event-writer';

const RUN_COMPLETED_TEXT = 'managed run 已完成';
const RUN_STOPPED_TEXT = '已停止当前处理';

export class AltusRunLifecycleService {
  constructor(
    private readonly setupService: AltusManagedSetupService = altusManagedSetupService,
    private readonly eventWriter: AltusRunEventWriter = altusRunEventWriter,
    private readonly redisStateService: AltusRunRedisStateService = altusRunRedisStateService
  ) {}

  async markRunning(state: AltusRunState) {
    if (!state.sandboxId || !state.workspaceRoot) {
      throw new Error('managed_run_missing_sandbox_context');
    }
    await this.setupService.updateSessionLifecycle(state.input.sessionId, {
      status: 'in_progress',
      stage: 'executing',
      phase: 'development',
      clearClarification: true,
    });
    await taskSessionRunDAO.updateRunStatus(state.input.runId, 'running', {
      startedAt: state.startedAt || new Date(),
    });
    await this.redisStateService.syncRunStatus({
      runId: state.input.runId,
      sessionId: state.input.sessionId,
      userId: state.input.userId,
      model: state.input.model,
      status: 'running',
      startedAt: state.startedAt || new Date(),
    });
    await this.eventWriter.appendRunEvent(state.input.runId, state.input.sessionId, state.input.userId, 'run_status', {
      status: 'running',
      content: state.sandboxReused ? '已复用会话 sandbox，开始执行' : '已创建新的 sandbox，开始执行',
      sandboxId: state.sandboxId,
      workspaceRoot: state.workspaceRoot,
    });
  }

  async markWaitingUser(state: AltusRunState) {
    await taskSessionRunDAO.updateRunStatus(state.input.runId, 'waiting_user');
    await this.redisStateService.syncRunStatus({
      runId: state.input.runId,
      sessionId: state.input.sessionId,
      userId: state.input.userId,
      model: state.input.model,
      status: 'waiting_user',
    });
    await this.setupService.updateSessionLifecycle(state.input.sessionId, {
      status: 'waiting_user',
      stage: 'clarifying',
      phase: 'analysis',
    });
  }

  async markCompleted(state: AltusRunState) {
    await taskSessionRunDAO.updateRunStatus(state.input.runId, 'completed', {
      completedAt: state.completedAt || new Date(),
      metadataJson: {
        deliverables: state.deliverables,
      },
    });
    await this.redisStateService.syncRunStatus({
      runId: state.input.runId,
      sessionId: state.input.sessionId,
      userId: state.input.userId,
      model: state.input.model,
      status: 'completed',
      completedAt: state.completedAt || new Date(),
    });
    await this.setupService.updateSessionLifecycle(state.input.sessionId, {
      status: 'completed',
      stage: 'completed',
      phase: 'delivery',
      clearClarification: true,
    });
    await this.setupService.persistTimelineMessage({
      sessionId: state.input.sessionId,
      role: 'system',
      messageType: 'status_update',
      content: RUN_COMPLETED_TEXT,
      metadata: {
        stage: 'completed',
        tone: 'review',
        eventType: 'run_completed',
        runId: state.input.runId,
        sessionId: state.input.sessionId,
        executor: 'altus',
        executionMode: 'managed',
        deliverables: state.deliverables,
      },
      messageKey: `managed:${state.input.runId}:run_completed`,
    });
    await this.eventWriter.appendRunEvent(
      state.input.runId,
      state.input.sessionId,
      state.input.userId,
      'run_completed',
      {
      status: 'completed',
      content: RUN_COMPLETED_TEXT,
      deliverables: state.deliverables,
      }
    );
  }

  async markStopped(state: AltusRunState, reason: string) {
    await taskSessionRunDAO.updateRunStatus(state.input.runId, 'stopped', {
      completedAt: state.completedAt || new Date(),
      stopReason: reason,
    });
    await this.redisStateService.syncRunStatus({
      runId: state.input.runId,
      sessionId: state.input.sessionId,
      userId: state.input.userId,
      model: state.input.model,
      status: 'stopped',
      completedAt: state.completedAt || new Date(),
      stopReason: reason,
    });
    await this.setupService.updateSessionLifecycle(state.input.sessionId, {
      status: 'in_progress',
      stage: 'collecting',
      phase: 'analysis',
      clearClarification: true,
    });
    await this.setupService.persistTimelineMessage({
      sessionId: state.input.sessionId,
      role: 'system',
      messageType: 'status_update',
      content: RUN_STOPPED_TEXT,
      metadata: {
        stage: 'failed',
        tone: 'system',
        runId: state.input.runId,
        interruptConfirmed: true,
      },
      messageKey: `managed:${state.input.runId}:stopped`,
    });
    await this.eventWriter.appendRunEvent(
      state.input.runId,
      state.input.sessionId,
      state.input.userId,
      'run_stopped',
      {
      status: 'stopped',
      content: RUN_STOPPED_TEXT,
      }
    );
  }

  async markFailed(state: AltusRunState, message: string) {
    await taskSessionRunDAO.updateRunStatus(state.input.runId, 'failed', {
      completedAt: state.completedAt || new Date(),
      stopReason: message,
    });
    await this.redisStateService.syncRunStatus({
      runId: state.input.runId,
      sessionId: state.input.sessionId,
      userId: state.input.userId,
      model: state.input.model,
      status: 'failed',
      completedAt: state.completedAt || new Date(),
      stopReason: message,
    });
    await this.setupService.updateSessionLifecycle(state.input.sessionId, {
      status: 'failed',
      stage: 'failed',
      phase: 'repair',
      clearClarification: true,
    });
    await this.setupService.persistTimelineMessage({
      sessionId: state.input.sessionId,
      role: 'system',
      messageType: 'error',
      content: `Altus managed 运行失败：${message}`,
      metadata: {
        runId: state.input.runId,
      },
      messageKey: `managed:${state.input.runId}:failed`,
    });
    await this.eventWriter.appendRunEvent(
      state.input.runId,
      state.input.sessionId,
      state.input.userId,
      'run_failed',
      {
      status: 'failed',
      content: `Altus managed 运行失败：${message}`,
      error: message,
      }
    );
  }
}

export const altusRunLifecycleService = new AltusRunLifecycleService();
