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
import { AltusRunState } from './altus-run-state';
import { sessionMcpRecoveryService } from './session-mcp-recovery-service';

export class AltusManagedRunEntryService {
  private readonly controllers = new Map<string, AbortController>();

  constructor(
    private readonly setupService: AltusManagedSetupService = altusManagedSetupService,
    private readonly eventWriter: AltusRunEventWriter = altusRunEventWriter,
    private readonly lifecycleService: AltusRunLifecycleService = altusRunLifecycleService,
    private readonly coordinator: AltusRunCoordinator = altusRunCoordinator
  ) {}

  private getModelName() {
    return (
      asText(process.env.ALTUS_MANAGED_MODEL) ||
      asText(process.env.AGENT_OPENAI_MODEL) ||
      asText(process.env.OPENAI_MODEL) ||
      'claude-haiku-4-5-20251001'
    );
  }

  async startRun(sessionId: string, userId: string, input: ManagedRunStartInput) {
    const content = asText(input.content);
    if (!content) {
      throw new Error('消息内容不能为空');
    }

    await this.setupService.ensureSessionOwnership(sessionId, userId);
    const activeRun = await taskSessionRunDAO.findActiveRun(sessionId);
    if (activeRun) {
      throw new Error('当前会话已有运行中的 Altus managed run');
    }

    const sessionMemory = await taskCreationFileMemoryStore.getSession(sessionId);
    const orchestratorSessionId = asText(sessionMemory?.runtime?.orchestratorSessionId);
    if (orchestratorSessionId) {
      await sessionMcpRecoveryService.ensureSessionRecovered(sessionId, orchestratorSessionId);
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

    await this.eventWriter.appendRunEvent(run.id, sessionId, 'run_ack', {
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

    void this.coordinator.execute(state, abortController).finally(() => {
      this.controllers.delete(run.id);
    });

    return this.eventWriter.toSummary(run);
  }

  async getLatestRun(sessionId: string, userId: string) {
    await this.setupService.ensureSessionOwnership(sessionId, userId);
    const latest = await taskSessionRunDAO.getLatestRun(sessionId);
    return this.eventWriter.toSummary(latest);
  }

  async stopRun(runId: string, userId: string, reason?: string) {
    const run = await taskSessionRunDAO.getRun(runId);
    if (!run) {
      throw new Error('managed run 不存在');
    }
    await this.setupService.ensureSessionOwnership(run.sessionId, userId);
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

  async streamRun(runId: string, res: express.Response, options?: { afterSequence?: number | null }) {
    return altusManagedStreamService.subscribe(runId, res, {
      afterSequence: options?.afterSequence ?? null,
    });
  }
}

export const altusManagedRunEntryService = new AltusManagedRunEntryService();
