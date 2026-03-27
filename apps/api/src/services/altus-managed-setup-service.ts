import { randomUUID } from 'node:crypto';
import { taskCreationFileMemoryStore } from '../agents/task-creation/file-memory-store';
import {
  sandboxExecutionEnvironmentDAO,
  taskCreationSessionDAO,
  taskSessionRunDAO,
} from '../db/dao';
import { sandboxEnvironmentService } from './sandbox-environment-service';
import { sessionConnectorService } from './session-connector-service';
import { e2bConnector } from '../connectors/e2b-connector';
import { resolveOpencodeWorkspacePath } from '../utils/opencode-workspace';
import { restoreWorkspaceIfArchived } from './sandbox-archive-service';
import { asText, pickObject, type ChatMessage } from './altus-managed-shared';
import { buildAttachmentContextPrompt } from './task-attachment-service';

function normalizeHistoryRole(role: unknown): 'system' | 'user' | 'assistant' | null {
  const normalized = asText(role).toLowerCase();
  if (normalized === 'system') return 'system';
  if (normalized === 'user') return 'user';
  if (normalized === 'assistant' || normalized === 'agent') return 'assistant';
  return null;
}

function isHistoryMessageRelevant(input: { role: unknown; messageType: unknown }) {
  const role = normalizeHistoryRole(input.role);
  const messageType = asText(input.messageType);
  if (!role) return false;
  if (messageType === 'session_started') return false;
  if (messageType === 'status_update') return false;
  if (messageType === 'executor_event') return false;
  if (messageType === 'opencode_event') return false;
  if (messageType === 'error' || messageType === 'opencode_error') return false;
  return true;
}

function collectAttachmentContextPrompt(history: Array<{ metadata?: unknown }>): string {
  const seenPaths = new Set<string>();
  const contexts: Array<{
    name: string;
    path: string;
    size: number;
    mimeType?: string;
    excerpt: string;
    truncated: boolean;
    extractedAt: string;
    extraction: 'utf8_text';
  }> = [];

  for (const item of history) {
    const metadata = pickObject(item.metadata);
    const rawContexts = Array.isArray(metadata.attachmentContext) ? metadata.attachmentContext : [];
    for (const raw of rawContexts) {
      const record = pickObject(raw);
      const path = asText(record.path);
      const excerpt = asText(record.excerpt);
      if (!path || !excerpt || seenPaths.has(path)) {
        continue;
      }
      seenPaths.add(path);
      contexts.push({
        name: asText(record.name) || path.split('/').pop() || 'attachment',
        path,
        size: typeof record.size === 'number' && Number.isFinite(record.size) ? record.size : 0,
        mimeType: asText(record.mimeType) || undefined,
        excerpt,
        truncated: record.truncated === true,
        extractedAt: asText(record.extractedAt) || new Date(0).toISOString(),
        extraction: 'utf8_text',
      });
    }
  }

  return buildAttachmentContextPrompt(contexts.slice(-6));
}

export class AltusManagedSetupService {
  async ensureSessionOwnership(sessionId: string, userId: string) {
    let session = await taskCreationSessionDAO.getSession(sessionId);
    if (!session) {
      session = await taskCreationSessionDAO.createSession({
        id: sessionId,
        userId,
        status: 'in_progress',
      });
    } else if (!session.userId) {
      const rebound = await taskCreationSessionDAO.bindUserIfMissing(sessionId, userId);
      if (!rebound) {
        throw new Error('会话不存在');
      }
      session = rebound;
    } else if (session.userId !== userId) {
      throw new Error('当前用户无权操作该 Altus 会话');
    }

    const memory = await taskCreationFileMemoryStore.getSession(sessionId);
    if (!memory) {
      await taskCreationFileMemoryStore.createSession('新建任务会话', sessionId);
      await taskCreationFileMemoryStore.addMessage(sessionId, 'system', 'session_started', '会话已创建');
    }

    await taskCreationFileMemoryStore.updateSessionMode(sessionId, 'altus');
    await taskCreationFileMemoryStore.updateSessionDriver(sessionId, 'altus');
    return session;
  }

  async captureConnectorSnapshot(sessionId: string, userId: string) {
    const statuses = await sessionConnectorService.listSessionConnectors(sessionId, userId).catch(() => []);
    const attached = statuses
      .filter((item) => item.attached)
      .map((item) => ({
        connectorKey: item.connectorKey,
        profileName: item.attachedProfileName || item.selectedProfileName || null,
        authorizedRepositories: item.authorizedRepositories || [],
        runtimeStatus: item.runtimeStatus,
      }));
    const snapshot = await taskSessionRunDAO.createConnectorSnapshot({
      sessionId,
      snapshotJson: {
        attached,
      },
    });
    return {
      snapshotId: snapshot.id,
      statuses,
    };
  }

  async ensureSandbox(sessionId: string, sessionTitle?: string | null) {
    const workspaceRoot = resolveOpencodeWorkspacePath(sessionId);
    const existing = await taskSessionRunDAO.getSandboxBindingBySession(sessionId);
    if (existing?.sandboxId) {
      try {
        await e2bConnector.getSandboxInfo(existing.sandboxId);
        await taskSessionRunDAO.touchSandboxBinding(sessionId, 'ready');
        await sandboxExecutionEnvironmentDAO.updateStatus(existing.sandboxId, 'ready', null);
        return {
          sandboxId: existing.sandboxId,
          workspaceRoot: existing.workspaceRoot || workspaceRoot,
          reused: true,
        };
      } catch {
        await taskSessionRunDAO.touchSandboxBinding(sessionId, 'failed');
        await sandboxExecutionEnvironmentDAO.updateStatus(existing.sandboxId, 'closed', null).catch(() => null);
      }
    }

    const opened = await sandboxEnvironmentService.openEnvironment({
      metadata: {
        taskSessionId: sessionId,
        taskTitle: sessionTitle || undefined,
        sandboxProvider: 'e2b',
        opencodeWorkspaceRoot: workspaceRoot,
        altusMode: 'managed',
      },
    });

    await e2bConnector.runCommand(
      opened.sessionId,
      `mkdir -p '${workspaceRoot.replace(/'/g, `'\"'\"'`)}'`,
      { timeoutMs: 15000 }
    );
    await restoreWorkspaceIfArchived(opened.sessionId).catch(() => false);
    await taskSessionRunDAO.upsertSandboxBinding({
      sessionId,
      sandboxId: opened.sessionId,
      workspaceRoot,
      status: 'ready',
      metadataJson: {
        provider: 'e2b',
      },
    });
    await taskCreationFileMemoryStore.updateRuntimeBinding(sessionId, {
      orchestratorSessionId: opened.sessionId,
    });
    return {
      sandboxId: opened.sessionId,
      workspaceRoot,
      reused: false,
    };
  }

  async persistTimelineMessage(input: {
    sessionId: string;
    role: 'user' | 'agent' | 'system';
    messageType: string;
    content: string;
    metadata?: Record<string, unknown>;
    messageKey?: string;
  }) {
    const messageKey =
      asText(input.messageKey) ||
      `${input.sessionId}:${input.messageType}:${randomUUID()}`;
    const metadata = {
      ...(input.metadata || {}),
      messageKey,
    };
    await taskCreationFileMemoryStore.addMessage(
      input.sessionId,
      input.role,
      input.messageType,
      input.content,
      metadata
    );
    await taskCreationSessionDAO.addMessage({
      sessionId: input.sessionId,
      role: input.role === 'agent' ? 'agent' : input.role,
      messageType: input.messageType,
      content: input.content,
      metadata,
    });
  }

  async updateSessionLifecycle(
    sessionId: string,
    input: {
      status?: 'in_progress' | 'waiting_user' | 'completed' | 'failed';
      stage?: 'collecting' | 'clarifying' | 'planning' | 'executing' | 'reviewing' | 'completed' | 'failed';
      phase?: 'ideation' | 'analysis' | 'development' | 'testing' | 'repair' | 'delivery';
      clearClarification?: boolean;
    }
  ) {
    await taskCreationFileMemoryStore.updateSessionState(sessionId, {
      status: input.status,
      stage: input.stage,
      phase: input.phase,
      allowBackward: true,
    });
    if (input.status) {
      await taskCreationSessionDAO.updateSessionStatus(sessionId, input.status);
    }
    if (input.clearClarification) {
      await taskCreationFileMemoryStore.clearPendingClarification(sessionId);
    }
  }

  async buildConversationMessages(
    sessionId: string,
    currentInput: string,
    systemPrompt: string
  ): Promise<ChatMessage[]> {
    const history = await taskCreationSessionDAO.getMessages(sessionId);
    const attachmentContextPrompt = collectAttachmentContextPrompt(history);
    const relevant = history
      .filter((item) => isHistoryMessageRelevant({ role: item.role, messageType: item.messageType }))
      .slice(-24)
      .map((item) => ({
        role: normalizeHistoryRole(item.role)!,
        content: asText(item.content),
      }));
    const latestHistory = relevant[relevant.length - 1];
    const shouldAppendCurrentInput =
      latestHistory?.role !== 'user' || asText(latestHistory.content) !== asText(currentInput);

    return [
      {
        role: 'system' as const,
        content: systemPrompt,
      },
      ...(attachmentContextPrompt
        ? [
            {
              role: 'system' as const,
              content: attachmentContextPrompt,
            },
          ]
        : []),
      ...relevant,
      ...(shouldAppendCurrentInput
        ? [
            {
              role: 'user' as const,
              content: currentInput,
            },
          ]
        : []),
    ];
  }
}

export const altusManagedSetupService = new AltusManagedSetupService();
