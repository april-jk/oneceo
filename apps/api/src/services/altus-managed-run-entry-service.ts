import type express from 'express';
import { taskCreationFileMemoryStore } from '../agents/task-creation/file-memory-store';
import { taskSessionRunDAO } from '../db/dao';
import { altusManagedStreamService } from './altus-managed-stream-service';
import {
  asText,
  isManagedRunTerminalStatus,
  readManagedSkillCatalog,
  readManagedSkillContext,
  type ManagedRunStartInput,
} from './altus-managed-shared';
import { AltusManagedSetupService, altusManagedSetupService } from './altus-managed-setup-service';
import { AltusRunCoordinator, altusRunCoordinator } from './altus-run-coordinator';
import { AltusRunEventWriter, altusRunEventWriter } from './altus-run-event-writer';
import { AltusRunLifecycleService, altusRunLifecycleService } from './altus-run-lifecycle-service';
import { altusRunRedisStateService, AltusRunRedisStateService } from './altus-run-redis-state-service';
import { AltusRunState } from './altus-run-state';
import { sessionMcpRecoveryService } from './session-mcp-recovery-service';
import { altusRunRecoveryService, AltusRunRecoveryService } from './altus-run-recovery-service';

export class AltusManagedRunEntryService {
  private readonly controllers = new Map<string, AbortController>();
  private readonly heartbeatTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly setupService: AltusManagedSetupService = altusManagedSetupService,
    private readonly eventWriter: AltusRunEventWriter = altusRunEventWriter,
    private readonly lifecycleService: AltusRunLifecycleService = altusRunLifecycleService,
    private readonly coordinator: AltusRunCoordinator = altusRunCoordinator,
    private readonly redisStateService: AltusRunRedisStateService = altusRunRedisStateService,
    private readonly recoveryService: AltusRunRecoveryService = altusRunRecoveryService
  ) {}

  private getModelName() {
    return (
      asText(process.env.ALTUS_MANAGED_MODEL) ||
      asText(process.env.AGENT_OPENAI_MODEL) ||
      asText(process.env.OPENAI_MODEL) ||
      'claude-haiku-4-5-20251001'
    );
  }

  private getHeartbeatIntervalMs() {
    const parsed = Number(process.env.ALTUS_RUN_HEARTBEAT_INTERVAL_MS || 15000);
    if (!Number.isFinite(parsed) || parsed <= 0) return 15000;
    return Math.max(5000, Math.floor(parsed));
  }

  private startHeartbeat(runId: string, sessionId: string, userId: string) {
    this.stopHeartbeat(runId);
    void this.redisStateService.touchHeartbeat({ runId, sessionId, userId });
    const timer = setInterval(() => {
      void this.redisStateService.touchHeartbeat({ runId, sessionId, userId });
    }, this.getHeartbeatIntervalMs());
    this.heartbeatTimers.set(runId, timer);
  }

  private stopHeartbeat(runId: string) {
    const timer = this.heartbeatTimers.get(runId);
    if (timer) {
      clearInterval(timer);
      this.heartbeatTimers.delete(runId);
    }
  }

  async startRun(sessionId: string, userId: string, input: ManagedRunStartInput) {
    const content = asText(input.content);
    if (!content) {
      throw new Error('消息内容不能为空');
    }

    await this.setupService.ensureSessionOwnership(sessionId, userId);
    await this.recoveryService.reconcileLatestRun(sessionId, userId);
    const activeRun = await taskSessionRunDAO.findActiveRun(sessionId);
    if (activeRun) {
      throw new Error('当前会话已有运行中的 Altus managed run');
    }

    const sessionMemory = await taskCreationFileMemoryStore.getSession(sessionId);
    const orchestratorSessionId = asText(sessionMemory?.runtime?.orchestratorSessionId);
    if (orchestratorSessionId) {
      void sessionMcpRecoveryService.ensureSessionRecovered(sessionId, orchestratorSessionId).catch(() => null);
    }
    const connectorSnapshot = await this.setupService.captureConnectorSnapshot(sessionId, userId);
    const mcpToolSnapshot = await this.setupService.captureMcpToolSnapshot(sessionId);
    const run = await taskSessionRunDAO.createRun({
      sessionId,
      status: 'queued',
      mode: 'managed',
      model: this.getModelName(),
      connectorSnapshotId: connectorSnapshot.snapshotId,
      mcpToolSnapshotId: mcpToolSnapshot.snapshotId,
      metadataJson: {
        trigger: 'user_input',
        mcpToolSnapshotId: mcpToolSnapshot.snapshotId,
      },
    });
    await this.redisStateService.registerRun({
      runId: run.id,
      sessionId,
      userId,
      model: run.model || this.getModelName(),
      status: 'queued',
    });
    const queuedRecovery = await this.recoveryService.buildRecoverySnapshot({
      runId: run.id,
      sessionId,
      userId,
      model: run.model || this.getModelName(),
      status: 'queued',
    });
    await this.redisStateService.setRecoverySnapshot({
      runId: run.id,
      sessionId,
      userId,
      model: queuedRecovery.model || null,
      status: 'queued',
      sequence: queuedRecovery.sequence,
      sandbox: queuedRecovery.sandbox,
      connectorRuntime: queuedRecovery.connectorRuntime,
      stream: queuedRecovery.stream,
    });

    const isClarificationAnswer = Boolean(asText(sessionMemory?.pendingQuestion));
    const messageType = isClarificationAnswer ? 'user_response' : 'user_input';
    const messageKey = asText(input.messageKey) || `managed:${run.id}:${messageType}`;
    await this.setupService.persistTimelineMessage({
      sessionId,
      role: 'user',
      messageType,
      content,
      metadata: {
        ...(input.metadata || {}),
        runId: run.id,
      },
      messageKey,
    });
    await this.setupService.updateSessionLifecycle(sessionId, {
      status: 'in_progress',
      stage: 'executing',
      phase: 'analysis',
      clearClarification: true,
    });

    await this.eventWriter.appendRunEvent(run.id, sessionId, userId, 'run_ack', {
      status: 'queued',
      content: 'managed run 已创建',
      sourceMessageKey: messageKey,
      messageKey: `managed:${run.id}:run_ack`,
    });

    const state = new AltusRunState({
      runId: run.id,
      sessionId,
      userId,
      model: run.model || this.getModelName(),
      userInput: content,
      sessionTitle: sessionMemory?.title || null,
      connectors: connectorSnapshot.statuses,
      mcpProviders: mcpToolSnapshot.providers as any,
      skillCatalog: readManagedSkillCatalog(input.metadata?.managedSkillCatalog),
      skills: readManagedSkillContext(input.metadata?.managedSkillContext),
    });
    const abortController = new AbortController();
    this.controllers.set(run.id, abortController);
    this.startHeartbeat(run.id, sessionId, userId);

    void this.coordinator.execute(state, abortController).finally(() => {
      this.controllers.delete(run.id);
      this.stopHeartbeat(run.id);
    });

    return this.eventWriter.toSummary(run);
  }

  async getLatestRun(sessionId: string, userId: string) {
    await this.setupService.ensureSessionOwnership(sessionId, userId);
    try {
      await this.recoveryService.reconcileLatestRun(sessionId, userId);
    } catch (error) {
      console.warn('[ALTUS_MANAGED_LATEST_RECOVERY_WARN]', {
        sessionId,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    const latest = await taskSessionRunDAO.getLatestRun(sessionId);
    return this.eventWriter.toSummary(latest);
  }

  async stopRun(runId: string, userId: string, reason?: string) {
    const run = await taskSessionRunDAO.getRun(runId);
    if (!run) {
      throw new Error('managed run 不存在');
    }
    await this.setupService.ensureSessionOwnership(run.sessionId, userId);
    await this.redisStateService.requestStop(
      {
        runId,
        sessionId: run.sessionId,
        userId,
      },
      reason || 'user_interrupt'
    );
    if (isManagedRunTerminalStatus(run.status)) {
      return this.eventWriter.toSummary(run);
    }

    const controller = this.controllers.get(runId);
    if (controller) {
      controller.abort(reason || 'user_interrupt');
      return this.eventWriter.toSummary((await taskSessionRunDAO.getRun(runId)) || run);
    }

    const state = new AltusRunState({
      runId: run.id,
      sessionId: run.sessionId,
      userId,
      model: run.model || this.getModelName(),
      userInput: '',
      sessionTitle: null,
      connectors: [],
      mcpProviders: [],
      skillCatalog: [],
      skills: [],
    });
    state.markStopped(reason || 'user_interrupt');
    await this.lifecycleService.markStopped(state, reason || 'user_interrupt');
    return this.eventWriter.toSummary(await taskSessionRunDAO.getRun(runId));
  }

  async streamRun(
    input: { runId: string; sessionId: string; userId: string },
    res: express.Response,
    options?: { afterSequence?: number | null }
  ) {
    return altusManagedStreamService.subscribe(
      {
        runId: input.runId,
        sessionId: input.sessionId,
        userId: input.userId,
      },
      res,
      {
      afterSequence: options?.afterSequence ?? null,
      }
    );
  }
}

export const altusManagedRunEntryService = new AltusManagedRunEntryService();
