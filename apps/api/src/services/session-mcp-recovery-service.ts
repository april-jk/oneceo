import {
  sandboxExecutionEnvironmentDAO,
  taskSessionConnectorBindingDAO,
  taskSessionMcpRecoveryJobDAO,
  taskSessionRunDAO,
} from '../db/dao';
import { ensureDatabaseConnection } from '../config/database';
import { taskCreationFileMemoryStore } from '../agents/task-creation/file-memory-store';
import { sessionConnectorService } from './session-connector-service';
import { osacAgentService } from './osac-agent-service';
import { taskSessionRedisCacheService } from './task-session-redis-cache-service';
import { writeConnectorDebugLog } from '../utils/connector-debug-log';

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function pickObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function recoveryKeyFor(taskSessionId: string, orchestratorSessionId: string) {
  return `session:${taskSessionId}:sandbox:${orchestratorSessionId}:session_reconcile`;
}

const COMPOSIO_BROKERED_RUNTIME_TRANSPORT = 'api_brokered_mcp';
const COMPOSIO_BROKERED_CONNECTORS = new Set(['notion', 'slack', 'figma', 'supabase']);

function isRecoveredRuntimeTransportSupported(binding: Record<string, unknown>) {
  const connectorKey = asText(binding.connectorKey);
  if (!COMPOSIO_BROKERED_CONNECTORS.has(connectorKey)) {
    return true;
  }
  return asText(binding.runtimeTransport) === COMPOSIO_BROKERED_RUNTIME_TRANSPORT;
}

function hasRecoveredRuntimeTools(binding: Record<string, unknown>) {
  const connectorKey = asText(binding.connectorKey);
  if (!COMPOSIO_BROKERED_CONNECTORS.has(connectorKey)) {
    return true;
  }
  return Array.isArray(binding.runtimeAttachedToolsJson) && binding.runtimeAttachedToolsJson.length > 0;
}

export class SessionMcpRecoveryService {
  private runningTaskSessions = new Set<string>();

  private async isSessionAlreadyRecovered(
    taskSessionId: string,
    orchestratorSessionId: string,
    options?: { probeLive?: boolean }
  ) {
    const probeLive = Boolean(options?.probeLive);
    const bindings = await taskSessionConnectorBindingDAO.listByTaskSessionId(taskSessionId);
    const attachedBindings = bindings.filter((item) => asText(item.desiredState) === 'attached');
    if (attachedBindings.length === 0) {
      return true;
    }
    const activeJobs = await taskSessionMcpRecoveryJobDAO.listActiveByTaskSession(taskSessionId);
    if (activeJobs.length > 0) {
      return false;
    }
    const dbRecovered = attachedBindings.every((binding) => {
      const providerId = asText(binding.runtimeProviderId);
      return (
        asText(binding.orchestratorSessionId) === orchestratorSessionId &&
        asText(binding.runtimeStatus) === 'connected' &&
        Boolean(binding.recoveryCompletedAt) &&
        Boolean(providerId) &&
        isRecoveredRuntimeTransportSupported(binding) &&
        hasRecoveredRuntimeTools(binding)
      );
    });
    if (!probeLive) {
      return dbRecovered;
    }
    let liveProviderIds = new Set<string>();
    try {
      const live = await osacAgentService.listSessionMcpTools(orchestratorSessionId);
      const providers = Array.isArray(live.providers) ? live.providers : [];
      liveProviderIds = new Set(
        providers
          .map((item) =>
            item && typeof item === 'object' && 'providerId' in item
              ? asText((item as Record<string, unknown>).providerId)
              : ''
          )
          .filter(Boolean)
      );
    } catch (error) {
      writeConnectorDebugLog('[SESSION_MCP_RECOVERY_LIVE_CHECK_FAILED]', {
        taskSessionId,
        orchestratorSessionId,
        error: error instanceof Error ? error.message : String(error),
      }, 'error');
      return false;
    }
    return attachedBindings.every((binding) => {
      const providerId = asText(binding.runtimeProviderId);
      return (
        asText(binding.orchestratorSessionId) === orchestratorSessionId &&
        asText(binding.runtimeStatus) === 'connected' &&
        Boolean(binding.recoveryCompletedAt) &&
        providerId &&
        liveProviderIds.has(providerId) &&
        isRecoveredRuntimeTransportSupported(binding) &&
        hasRecoveredRuntimeTools(binding)
      );
    });
  }

  private async resolveTaskSessionId(orchestratorSessionId: string): Promise<string | null> {
    const environment = await sandboxExecutionEnvironmentDAO.getBySessionId(orchestratorSessionId);
    const metadata = pickObject(environment?.metadata);
    const fromMetadata = asText(metadata.taskSessionId);
    if (fromMetadata) return fromMetadata;
    const memory = await taskCreationFileMemoryStore.findSessionByOrchestratorSessionId(orchestratorSessionId);
    return asText(memory?.id) || null;
  }

  private async hasAttachedBindings(taskSessionId: string): Promise<boolean> {
    const bindings = await taskSessionConnectorBindingDAO.listByTaskSessionId(taskSessionId);
    return bindings.some((item) => asText(item.desiredState) === 'attached');
  }

  async markPendingRecoverByOrchestratorSessionId(
    orchestratorSessionId: string,
    reason = 'sandbox_unavailable_pending_recover'
  ) {
    const taskSessionId = await this.resolveTaskSessionId(orchestratorSessionId);
    if (!taskSessionId) return;
    const bindings = await taskSessionConnectorBindingDAO.listByTaskSessionId(taskSessionId);
    const now = new Date();
    for (const binding of bindings) {
      if (asText(binding.desiredState) === 'attached') {
        await taskSessionConnectorBindingDAO.updateRuntime(taskSessionId, binding.connectorKey, {
          runtimeStatus: 'pending_recover',
          orchestratorSessionId: null,
          runtimeProviderId: null,
          runtimeAttachedToolsJson: [],
          runtimeLastStoppedAt: now,
          recoveryQueuedAt: now,
          recoveryStartedAt: null,
          recoveryCompletedAt: null,
          lastError: reason,
        });
      } else {
        await taskSessionConnectorBindingDAO.updateRuntime(taskSessionId, binding.connectorKey, {
          runtimeStatus: 'detached',
          orchestratorSessionId: null,
          runtimeProviderId: null,
          runtimeAttachedToolsJson: [],
          runtimeLastStoppedAt: now,
          recoveryQueuedAt: null,
          recoveryStartedAt: null,
          recoveryCompletedAt: null,
          lastError: null,
        });
      }
    }
    await taskSessionRedisCacheService.invalidateConnectorProjectionBySessionId(taskSessionId).catch(() => null);
  }

  async enqueueSessionRecovery(taskSessionId: string, orchestratorSessionId: string) {
    if (!(await this.hasAttachedBindings(taskSessionId))) {
      return null;
    }
    const bindings = await taskSessionConnectorBindingDAO.listByTaskSessionId(taskSessionId);
    const attachedBindings = bindings
      .filter((item) => asText(item.desiredState) === 'attached')
      .map((item) => ({
        connectorKey: item.connectorKey,
        profileId: item.profileId,
        enabledTools: Array.isArray(item.enabledTools) ? item.enabledTools : [],
        sessionConfigJson: item.sessionConfigJson,
      }));
    const now = new Date();
    for (const binding of bindings) {
      if (asText(binding.desiredState) !== 'attached') continue;
      await taskSessionConnectorBindingDAO.updateRuntime(taskSessionId, binding.connectorKey, {
        runtimeStatus: 'pending_recover',
        orchestratorSessionId,
        recoveryQueuedAt: now,
        recoveryStartedAt: null,
        recoveryCompletedAt: null,
      });
    }
    return taskSessionMcpRecoveryJobDAO.upsertPending({
      taskSessionId,
      orchestratorSessionId,
      recoveryKey: recoveryKeyFor(taskSessionId, orchestratorSessionId),
      jobType: 'session_reconcile',
      status: 'pending',
      payloadJson: {
        bindings: attachedBindings,
      },
    });
  }

  async ensureSessionRecovered(taskSessionId: string, orchestratorSessionId: string) {
    const environment = await sandboxExecutionEnvironmentDAO.getBySessionId(orchestratorSessionId);
    if (!environment || environment.status !== 'ready') {
      await this.markPendingRecoverByOrchestratorSessionId(
        orchestratorSessionId,
        'sandbox_not_ready_pending_recover'
      );
      return false;
    }
    if (await this.isSessionAlreadyRecovered(taskSessionId, orchestratorSessionId, { probeLive: false })) {
      writeConnectorDebugLog('[SESSION_MCP_RECOVERY_SKIP_ALREADY_RECOVERED]', {
        taskSessionId,
        orchestratorSessionId,
      });
      return true;
    }
    const job = await this.enqueueSessionRecovery(taskSessionId, orchestratorSessionId);
    if (!job) {
      return true;
    }
    writeConnectorDebugLog('[SESSION_MCP_RECOVERY_ENQUEUED_ASYNC]', {
      taskSessionId,
      orchestratorSessionId,
      jobId: job.id,
    });
    await this.runRecoveryJob(job.id, taskSessionId);
    return true;
  }

  private async runRecoveryJob(jobId: string, taskSessionId: string) {
    if (this.runningTaskSessions.has(taskSessionId)) {
      return;
    }
    this.runningTaskSessions.add(taskSessionId);
    try {
      const runnable = (await taskSessionMcpRecoveryJobDAO.listRunnable(50)).find((item) => item.id === jobId);
      if (!runnable) return;
      const attemptCount = Number(runnable.attemptCount || 0) + 1;
      await taskSessionMcpRecoveryJobDAO.markRunning(jobId, attemptCount);

      const bindings = await taskSessionConnectorBindingDAO.listByTaskSessionId(taskSessionId);
      const now = new Date();
      for (const binding of bindings) {
        if (asText(binding.desiredState) !== 'attached') continue;
        await taskSessionConnectorBindingDAO.updateRuntime(taskSessionId, binding.connectorKey, {
          runtimeStatus: 'recovering',
          orchestratorSessionId: runnable.orchestratorSessionId,
          recoveryStartedAt: now,
          lastError: null,
        });
      }

      try {
        await sessionConnectorService.reconcileByOrchestratorSessionId(runnable.orchestratorSessionId);
        for (const binding of bindings) {
          if (asText(binding.desiredState) !== 'attached') continue;
          await taskSessionConnectorBindingDAO.updateRuntime(taskSessionId, binding.connectorKey, {
            recoveryCompletedAt: new Date(),
            lastError: null,
          });
        }
        await taskSessionMcpRecoveryJobDAO.markCompleted(jobId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        for (const binding of bindings) {
          if (asText(binding.desiredState) !== 'attached') continue;
          await taskSessionConnectorBindingDAO.updateRuntime(taskSessionId, binding.connectorKey, {
            runtimeStatus: 'failed',
            orchestratorSessionId: runnable.orchestratorSessionId,
            lastError: message,
          });
        }
        await taskSessionMcpRecoveryJobDAO.markFailed(jobId, attemptCount, message);
        throw error;
      }
    } finally {
      await taskSessionRedisCacheService.invalidateConnectorProjectionBySessionId(taskSessionId).catch(() => null);
      this.runningTaskSessions.delete(taskSessionId);
    }
  }

  async recoverBacklog(limit = 100) {
    try {
      await ensureDatabaseConnection({ retries: 3, delayMs: 1000 });
    } catch (error) {
      writeConnectorDebugLog(
        '[SESSION_MCP_RECOVERY_BACKLOG_DB_UNAVAILABLE]',
        {
          limit,
          error: error instanceof Error ? error.message : String(error),
        },
        'error'
      );
      return;
    }
    let jobs = [];
    try {
      jobs = await taskSessionMcpRecoveryJobDAO.listRunnable(limit);
    } catch (error) {
      writeConnectorDebugLog(
        '[SESSION_MCP_RECOVERY_BACKLOG_LIST_JOBS_FAILED]',
        {
          limit,
          error: error instanceof Error ? error.message : String(error),
        },
        'error'
      );
      return;
    }
    for (const job of jobs) {
      let environment = null;
      try {
        environment = await sandboxExecutionEnvironmentDAO.getBySessionId(job.orchestratorSessionId);
      } catch (error) {
        writeConnectorDebugLog(
          '[SESSION_MCP_RECOVERY_BACKLOG_LOAD_ENV_FAILED]',
          {
            jobId: job.id,
            taskSessionId: job.taskSessionId,
            orchestratorSessionId: job.orchestratorSessionId,
            error: error instanceof Error ? error.message : String(error),
          },
          'error'
        );
        continue;
      }
      if (!environment || environment.status !== 'ready') {
        continue;
      }
      await this.runRecoveryJob(job.id, job.taskSessionId).catch(() => null);
    }

    let pendingBindings = [];
    try {
      pendingBindings = await taskSessionConnectorBindingDAO.listPendingRecovery(limit);
    } catch (error) {
      writeConnectorDebugLog(
        '[SESSION_MCP_RECOVERY_BACKLOG_LIST_BINDINGS_FAILED]',
        {
          limit,
          error: error instanceof Error ? error.message : String(error),
        },
        'error'
      );
      return;
    }
    const touched = new Set<string>();
    for (const binding of pendingBindings) {
      const taskSessionId = asText(binding.taskSessionId);
      if (!taskSessionId || touched.has(taskSessionId)) continue;
      touched.add(taskSessionId);
      let sandboxBinding = null;
      try {
        sandboxBinding = await taskSessionRunDAO.getSandboxBindingBySession(taskSessionId);
      } catch (error) {
        writeConnectorDebugLog(
          '[SESSION_MCP_RECOVERY_BACKLOG_LOAD_SANDBOX_BINDING_FAILED]',
          {
            taskSessionId,
            connectorKey: binding.connectorKey,
            error: error instanceof Error ? error.message : String(error),
          },
          'error'
        );
        continue;
      }
      const orchestratorSessionId = asText(sandboxBinding?.sandboxId);
      if (!orchestratorSessionId) continue;
      let environment = null;
      try {
        environment = await sandboxExecutionEnvironmentDAO.getBySessionId(orchestratorSessionId);
      } catch (error) {
        writeConnectorDebugLog(
          '[SESSION_MCP_RECOVERY_BACKLOG_LOAD_SANDBOX_ENV_FAILED]',
          {
            taskSessionId,
            orchestratorSessionId,
            connectorKey: binding.connectorKey,
            error: error instanceof Error ? error.message : String(error),
          },
          'error'
        );
        continue;
      }
      if (!environment || environment.status !== 'ready') continue;
      await this.ensureSessionRecovered(taskSessionId, orchestratorSessionId).catch(() => null);
    }
  }
}

export const sessionMcpRecoveryService = new SessionMcpRecoveryService();
