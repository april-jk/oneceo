import { taskCreationSessionDAO, taskSessionRunDAO } from '../db/dao';
import type { ManagedRunStatus } from '../db/dao/task-session-run.dao';
import {
  AltusRunRedisStateService,
  altusRunRedisStateService,
  type RunRecoverySnapshot,
} from './altus-run-redis-state-service';
import { createAltusRunLoopSnapshot } from './altus-run-loop-state';

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function asRecord(value: unknown) {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asManagedRunStatus(value: unknown): ManagedRunStatus | null {
  const text = asText(value);
  if (
    text === 'queued' ||
    text === 'starting' ||
    text === 'running' ||
    text === 'streaming' ||
    text === 'waiting_tool' ||
    text === 'waiting_user' ||
    text === 'completed' ||
    text === 'failed' ||
    text === 'stopped'
  ) {
    return text;
  }
  return null;
}

function isRecoverableStatus(status: ManagedRunStatus | null | undefined): status is Extract<ManagedRunStatus, 'queued' | 'running' | 'waiting_user'> {
  return status === 'queued' || status === 'running' || status === 'waiting_user';
}

function collectProviderIds(snapshotJson: unknown) {
  const snapshot = asRecord(snapshotJson);
  const providers = Array.isArray(snapshot.providers) ? snapshot.providers : [];
  return providers
    .map((item) => asText(asRecord(item).providerId))
    .filter(Boolean);
}

export class AltusRunRecoveryService {
  constructor(private readonly redisStateService: AltusRunRedisStateService = altusRunRedisStateService) {}

  async buildRecoverySnapshot(input: {
    runId: string;
    sessionId: string;
    userId: string;
    model?: string | null;
    status: Extract<ManagedRunStatus, 'queued' | 'running' | 'waiting_user'>;
  }): Promise<RunRecoverySnapshot> {
    const [sandboxBinding, latestSequence] = await Promise.all([
      taskSessionRunDAO.getSandboxBindingBySession(input.sessionId),
      taskSessionRunDAO.getLatestRunEventSequence(input.runId),
    ]);
    const run = await taskSessionRunDAO.getRun(input.runId);
    const mcpSnapshot = run?.mcpToolSnapshotId
      ? await taskSessionRunDAO.getMcpToolSnapshot(run.mcpToolSnapshotId)
      : null;
    const currentRecovery = await this.redisStateService.getRecoverySnapshot(input);
    return {
      tenantKey: input.userId,
      userId: input.userId,
      sessionId: input.sessionId,
      runId: input.runId,
      model: input.model ?? null,
      status: input.status,
      sequence: latestSequence,
      sandbox: {
        sandboxId: asText(sandboxBinding?.sandboxId) || null,
        workspaceRoot: asText(sandboxBinding?.workspaceRoot) || null,
        reused: Boolean(asRecord(sandboxBinding?.metadataJson).reused) || currentRecovery?.sandbox?.reused || false,
        updatedAt:
          (sandboxBinding?.updatedAt instanceof Date ? sandboxBinding.updatedAt.toISOString() : null) ??
          currentRecovery?.sandbox?.updatedAt ??
          null,
      },
      connectorRuntime: {
        providerIds: collectProviderIds(mcpSnapshot?.snapshotJson),
        updatedAt:
          (mcpSnapshot?.createdAt instanceof Date ? mcpSnapshot.createdAt.toISOString() : null) ??
          currentRecovery?.connectorRuntime?.updatedAt ??
          null,
      },
      stream: {
        latestSequence,
        latestEventType: currentRecovery?.stream?.latestEventType ?? null,
      },
      loop: currentRecovery?.loop
        ? createAltusRunLoopSnapshot(currentRecovery.loop)
        : createAltusRunLoopSnapshot(),
      updatedAt: new Date().toISOString(),
    };
  }

  async reconcileRunById(runId: string) {
    const run = await taskSessionRunDAO.getRun(runId);
    if (!run) {
      return false;
    }
    const status = asManagedRunStatus(run.status);
    if (!status) {
      return false;
    }
    const session = await taskCreationSessionDAO.getSession(run.sessionId);
    const userId = asText(session?.userId);
    if (!userId) {
      return false;
    }

    const scope = {
      runId,
      sessionId: run.sessionId,
      userId,
    };
    const latestSequence = await taskSessionRunDAO.getLatestRunEventSequence(runId);
    await this.redisStateService.syncRunStatus({
      ...scope,
      model: run.model || null,
      status,
      sequence: latestSequence,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      stopReason: run.stopReason,
    });

    if (isRecoverableStatus(status)) {
      const recovery = await this.buildRecoverySnapshot({
        ...scope,
        model: run.model || null,
        status,
      });
      await this.redisStateService.setRecoverySnapshot({
        ...scope,
        model: recovery.model || null,
        status: recovery.status,
        sequence: recovery.sequence,
        sandbox: recovery.sandbox,
        connectorRuntime: recovery.connectorRuntime,
        stream: recovery.stream,
        loop: recovery.loop,
      });
      return true;
    }

    await this.redisStateService.clearStopRequest(scope);
    await this.redisStateService.clearRecoverySnapshot(scope);
    return true;
  }

  async reconcileLatestRun(sessionId: string, userId: string) {
    const latest = await taskSessionRunDAO.getLatestRun(sessionId);
    if (!latest) {
      return null;
    }
    if (latest.sessionId !== sessionId) {
      return latest;
    }
    await this.reconcileRunById(latest.id);
    return latest;
  }
}

export const altusRunRecoveryService = new AltusRunRecoveryService();
