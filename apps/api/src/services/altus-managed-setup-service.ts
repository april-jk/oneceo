import { randomUUID } from 'node:crypto';
import { taskCreationFileMemoryStore } from '../agents/task-creation/file-memory-store';
import {
  taskCreationSessionDAO,
  taskSessionRunDAO,
  taskSessionConnectorBindingDAO,
} from '../db/dao';
import { osacAgentService } from './osac-agent-service';
import { sessionMcpRecoveryService } from './session-mcp-recovery-service';
import { sessionConnectorService } from './session-connector-service';
import { resolveOpencodeWorkspacePath } from '../utils/opencode-workspace';
import { ensureSandboxRuntimeMetadata } from './sandbox-runtime-metadata-service';
import { sandboxAgentProvisionService } from './sandbox-agent-provision-service';
import { asText, pickObject, type ChatMessage, type ChatMessageContentPart } from './altus-managed-shared';
import {
  deriveManagedTaskIntentProfile,
  type AltusManagedTaskIntentProfile,
} from './altus-managed-prompt-service';
import { buildAttachmentContextPrompt } from './task-attachment-service';
import { managedImageObjectService, type ManagedImageObjectService } from './managed-image-object-service';
import { isSameUserId } from '../utils/user-id';

const INLINE_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const INLINE_IMAGE_MAX_BYTES = 6 * 1024 * 1024;
const INLINE_IMAGE_MAX_COUNT = 4;
const COMPOSIO_BROKERED_RUNTIME_TRANSPORT = 'api_brokered_mcp';
const COMPOSIO_BROKERED_CONNECTORS = new Set(['github', 'notion', 'slack', 'figma', 'supabase']);

function isSnapshotRuntimeTransportSupported(binding: { connectorKey?: unknown; runtimeTransport?: unknown }) {
  if (!COMPOSIO_BROKERED_CONNECTORS.has(asText(binding.connectorKey))) {
    return true;
  }
  return asText(binding.runtimeTransport) === COMPOSIO_BROKERED_RUNTIME_TRANSPORT;
}

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

function normalizeAttachmentRecord(raw: unknown) {
  const record = pickObject(raw);
  const path = asText(record.path);
  const mimeType = asText(record.mimeType).toLowerCase();
  if (!path || !mimeType) return null;
  return {
    name: asText(record.name) || path.split('/').pop() || 'attachment',
    path,
    mimeType,
    size: typeof record.size === 'number' && Number.isFinite(record.size) ? record.size : 0,
    externalObjectKey: asText(record.externalObjectKey),
  };
}

function isInlineImageAttachment(raw: unknown) {
  const record = normalizeAttachmentRecord(raw);
  if (!record) return null;
  if (!INLINE_IMAGE_MIME_TYPES.has(record.mimeType)) return null;
  if (record.size > INLINE_IMAGE_MAX_BYTES) return null;
  if (record.path.startsWith('/') || record.path.includes('..')) return null;
  if (!record.externalObjectKey) return null;
  return record;
}

function extractMessageTextContent(content: ChatMessage['content']) {
  if (typeof content === 'string') {
    return asText(content);
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((item) => (item?.type === 'text' ? asText(item.text) : ''))
    .filter(Boolean)
    .join('\n')
    .trim();
}

export class AltusManagedSetupService {
  constructor(private readonly imageObjectService: ManagedImageObjectService = managedImageObjectService) {}

  private async buildInlineImageBlocks(input: {
    metadata?: unknown;
    cache: Map<string, ChatMessageContentPart>;
  }): Promise<ChatMessageContentPart[]> {
    const metadata = pickObject(input.metadata);
    const rawAttachments = Array.isArray(metadata.attachments) ? metadata.attachments : [];
    const attachments = rawAttachments
      .map((item) => isInlineImageAttachment(item))
      .filter(Boolean)
      .slice(0, INLINE_IMAGE_MAX_COUNT) as Array<{
        name: string;
        path: string;
        mimeType: string;
        size: number;
        externalObjectKey: string;
      }>;

    const results: ChatMessageContentPart[] = [];
    for (const attachment of attachments) {
      const cached = input.cache.get(attachment.externalObjectKey);
      if (cached) {
        results.push(cached);
        continue;
      }

      try {
        const signedUrl = await this.imageObjectService.getSignedDownloadUrl(attachment.externalObjectKey);
        const block: ChatMessageContentPart = {
          type: 'image_url',
          image_url: {
            url: signedUrl,
          },
          _managedObjectKey: attachment.externalObjectKey,
        };
        input.cache.set(attachment.externalObjectKey, block);
        results.push(block);
      } catch {
        continue;
      }
    }

    return results;
  }

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
      if (!rebound?.userId) {
        throw new Error('会话缺少归属用户，无法进入 Altus managed 链路');
      }
      session = rebound;
    } else if (!isSameUserId(session.userId, userId)) {
      throw new Error('当前用户无权操作该 Altus 会话');
    }

    const memory = await taskCreationFileMemoryStore.getSession(sessionId);
    if (!memory) {
      await taskCreationFileMemoryStore.createSession('待识别任务', sessionId);
      await taskCreationFileMemoryStore.addMessage(sessionId, 'system', 'session_started', '会话已创建');
    }

    await taskCreationFileMemoryStore.updateSessionMode(sessionId, 'altus');
    await taskCreationFileMemoryStore.updateSessionDriver(sessionId, 'altus');
    return session;
  }

  async captureConnectorSnapshot(sessionId: string, userId: string) {
    await sessionConnectorService.waitForAttachIdle(sessionId).catch(() => false);
    const memory = await taskCreationFileMemoryStore.getSession(sessionId).catch(() => null);
    const orchestratorSessionId = asText(memory?.runtime?.orchestratorSessionId);
    if (orchestratorSessionId) {
      await sessionMcpRecoveryService.ensureSessionRecovered(sessionId, orchestratorSessionId).catch(() => null);
    }
    await sessionConnectorService.waitForAttachIdle(sessionId).catch(() => false);
    let statuses = await sessionConnectorService.listSessionConnectors(sessionId, userId).catch(() => []);
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

  async captureMcpToolSnapshot(sessionId: string) {
    await sessionConnectorService.waitForAttachIdle(sessionId).catch(() => false);
    const bindings = await taskSessionConnectorBindingDAO.listByTaskSessionId(sessionId).catch(() => []);
    const providers = bindings
      .filter(
        (item) =>
          item.desiredState === 'attached' &&
          asText(item.runtimeStatus).toLowerCase() === 'connected' &&
          asText(item.runtimeProviderId) &&
          isSnapshotRuntimeTransportSupported(item)
      )
      .map((item) => ({
        connectorKey: item.connectorKey,
        providerId: asText(item.runtimeProviderId),
        transport: asText(item.runtimeTransport) || null,
        envVersion: typeof item.runtimeEnvVersion === 'number' ? item.runtimeEnvVersion : 0,
          tools: Array.isArray(item.runtimeAttachedToolsJson) ? item.runtimeAttachedToolsJson : [],
      }));
    const shouldProbeLiveProviders = providers.some((item) => !Array.isArray(item.tools) || item.tools.length === 0);
    if (providers.length === 0) {
      const snapshot = await taskSessionRunDAO.createMcpToolSnapshot({
        sessionId,
        snapshotJson: {
          providers: [],
          tools: [],
        },
      });
      return {
        snapshotId: snapshot.id,
        providers: [],
      };
    }

    const sessionMemory = await taskCreationFileMemoryStore.getSession(sessionId).catch(() => null);
    const orchestratorSessionId = asText(sessionMemory?.runtime?.orchestratorSessionId);
    if (orchestratorSessionId && shouldProbeLiveProviders) {
      const expectedProviderIds = new Set(providers.map((item) => item.providerId));
      const live = await osacAgentService.listSessionMcpTools(orchestratorSessionId).catch(() => null);
      const liveProviders = Array.isArray(live?.providers)
        ? live.providers.map((item) => ({
            connectorKey: null,
            providerId: asText((item as Record<string, unknown>)?.providerId),
            transport: asText((item as Record<string, unknown>)?.transport) || null,
            envVersion:
              typeof (item as Record<string, unknown>)?.envVersion === 'number'
                ? ((item as Record<string, unknown>).envVersion as number)
                : 0,
            tools: Array.isArray((item as Record<string, unknown>)?.tools)
              ? ((item as Record<string, unknown>).tools as unknown[])
              : [],
          }))
            .filter((item) => expectedProviderIds.has(item.providerId))
        : [];
      if (liveProviders.length > 0) {
        const snapshot = await taskSessionRunDAO.createMcpToolSnapshot({
          sessionId,
          snapshotJson: {
            providers: liveProviders,
            tools: liveProviders.flatMap((item) => (Array.isArray(item.tools) ? item.tools : [])),
          },
        });
        return {
          snapshotId: snapshot.id,
          providers: liveProviders,
        };
      }
    }
    const snapshot = await taskSessionRunDAO.createMcpToolSnapshot({
      sessionId,
      snapshotJson: {
        providers,
        tools: providers.flatMap((item) => (Array.isArray(item.tools) ? item.tools : [])),
      },
    });
    return {
      snapshotId: snapshot.id,
      providers,
    };
  }

  async ensureSandbox(sessionId: string, sessionTitle?: string | null) {
    const workspaceRoot = resolveOpencodeWorkspacePath(sessionId);
    const provision = await sandboxAgentProvisionService.provisionWithLock({
      executor: 'altus',
      metadata: {
        taskSessionId: sessionId,
        taskTitle: sessionTitle || undefined,
        sandboxProvider: 'e2b',
        sandboxExecutor: 'altus',
        executor: 'altus',
        workspaceRoot,
        opencodeWorkspaceRoot: workspaceRoot,
        altusMode: 'managed',
      },
    });

    await taskSessionRunDAO.upsertSandboxBinding({
      sessionId,
      sandboxId: provision.sessionId,
      workspaceRoot,
      status: 'ready',
      metadataJson: {
        provider: 'e2b',
      },
    });
    await ensureSandboxRuntimeMetadata(provision.sessionId, {
      taskSessionId: sessionId,
    }).catch(() => null);
    await taskCreationFileMemoryStore.updateSessionExecutor(sessionId, 'altus');
    await taskCreationFileMemoryStore.updateRuntimeBinding(sessionId, {
      orchestratorSessionId: provision.sessionId,
      executor: 'altus',
      workspaceRoot,
    });
    void sessionMcpRecoveryService.ensureSessionRecovered(sessionId, provision.sessionId).catch(() => null);
    return {
      sandboxId: provision.sessionId,
      workspaceRoot,
      reused: provision.allocationSource === 'reused_session',
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
    const inlineImageCache = new Map<string, ChatMessageContentPart>();
    const relevantHistory = history
      .filter((item) => isHistoryMessageRelevant({ role: item.role, messageType: item.messageType }))
      .slice(-24);
    const relevant: ChatMessage[] = [];

    for (const item of relevantHistory) {
      const role = normalizeHistoryRole(item.role);
      if (!role) continue;
      const textContent = asText(item.content);
      if (role !== 'user') {
        if (!textContent) continue;
        relevant.push({
          role,
          content: textContent,
        });
        continue;
      }

      const imageBlocks = await this.buildInlineImageBlocks({
        metadata: item.metadata,
        cache: inlineImageCache,
      });
      if (!textContent && imageBlocks.length === 0) {
        continue;
      }
      if (imageBlocks.length === 0) {
        relevant.push({
          role,
          content: textContent,
        });
        continue;
      }

      const content: ChatMessageContentPart[] = [];
      if (textContent) {
        content.push({
          type: 'text',
          text: textContent,
        });
      }
      content.push(...imageBlocks);
      relevant.push({
        role,
        content,
      });
    }

    const latestHistory = relevant[relevant.length - 1];
    const shouldAppendCurrentInput =
      latestHistory?.role !== 'user' || extractMessageTextContent(latestHistory.content) !== asText(currentInput);

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

  async buildTaskIntentProfile(
    sessionId: string,
    currentInput?: string | null
  ): Promise<AltusManagedTaskIntentProfile> {
    const history = await taskCreationSessionDAO.getMessages(sessionId);
    const relevantUserTexts = history
      .filter(
        (item) =>
          normalizeHistoryRole(item.role) === 'user' &&
          isHistoryMessageRelevant({ role: item.role, messageType: item.messageType })
      )
      .map((item) => asText(item.content))
      .filter(Boolean)
      .slice(-8);
    const currentText = asText(currentInput);
    const latestHistoryText = relevantUserTexts[relevantUserTexts.length - 1] || '';
    const texts =
      currentText && currentText !== latestHistoryText
        ? [...relevantUserTexts, currentText]
        : relevantUserTexts;
    return deriveManagedTaskIntentProfile(texts);
  }

  async refreshInlineImageUrls(messages: ChatMessage[]): Promise<ChatMessage[]> {
    for (const message of messages) {
      if (!Array.isArray(message.content)) continue;
      for (const part of message.content) {
        if (part?.type !== 'image_url') continue;
        const objectKey = asText(part._managedObjectKey);
        if (!objectKey) continue;
        part.image_url.url = await this.imageObjectService.getSignedDownloadUrl(objectKey);
      }
    }
    return messages;
  }
}

export const altusManagedSetupService = new AltusManagedSetupService();
