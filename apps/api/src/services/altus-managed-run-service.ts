import { randomUUID } from 'node:crypto';
import type express from 'express';
import { taskCreationFileMemoryStore } from '../agents/task-creation/file-memory-store';
import {
  sandboxExecutionEnvironmentDAO,
  taskCreationSessionDAO,
  taskSessionRunDAO,
} from '../db/dao';
import { sandboxEnvironmentService } from './sandbox-environment-service';
import { altusManagedStreamService } from './altus-managed-stream-service';
import { altusManagedPromptService } from './altus-managed-prompt-service';
import { AltusManagedToolRuntime } from './altus-managed-tool-runtime';
import { sessionConnectorService } from './session-connector-service';
import { e2bConnector } from '../connectors/e2b-connector';
import { resolveOpencodeWorkspacePath } from '../utils/opencode-workspace';
import { restoreWorkspaceIfArchived } from './sandbox-archive-service';

type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string;
  tool_call_id?: string;
  name?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
};

type ManagedRunStartInput = {
  content: string;
  messageKey?: string;
  metadata?: Record<string, unknown>;
};

type ManagedRunSummary = {
  id: string;
  sessionId: string;
  status?: string;
  model?: string | null;
  stopReason?: string | null;
  streamUrl?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  updatedAt?: string | null;
  sequence?: number | null;
};

type ToolCall = {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
};

type JsonSchema =
  | {
      type: 'string' | 'number' | 'integer' | 'boolean';
      description?: string;
    }
  | {
      type: 'array';
      description?: string;
      items: JsonSchema;
    }
  | {
      type: 'object';
      description?: string;
      properties: Record<string, JsonSchema>;
      required: string[];
      additionalProperties: false;
    };

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function pickObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const text = asText(value);
  if (!text) return null;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function truncate(value: string, limit = 16000) {
  if (!value || value.length <= limit) return value;
  return `${value.slice(0, limit)}\n...[truncated]`;
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

function buildToolDefinitions() {
  const objectSchema = (
    properties: Record<string, JsonSchema>,
    required: string[] = [],
    description?: string
  ): JsonSchema => ({
    type: 'object',
    description,
    properties,
    required,
    additionalProperties: false,
  });

  return [
    {
      type: 'function',
      function: {
        name: 'shell_execute',
        description: 'Run a shell command inside the E2B sandbox workspace.',
        parameters: objectSchema(
          {
            command: { type: 'string', description: 'Shell command to execute.' },
            cwd: { type: 'string', description: 'Workspace-relative directory. Defaults to workspace root.' },
            timeoutMs: { type: 'integer', description: 'Timeout in milliseconds, max 120000.' },
          },
          ['command']
        ),
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read a UTF-8 text file from the workspace.',
        parameters: objectSchema(
          {
            path: { type: 'string', description: 'Workspace-relative file path.' },
          },
          ['path']
        ),
      },
    },
    {
      type: 'function',
      function: {
        name: 'write_file',
        description: 'Write or replace a UTF-8 text file in the workspace.',
        parameters: objectSchema(
          {
            path: { type: 'string', description: 'Workspace-relative file path.' },
            content: { type: 'string', description: 'Full file content to write.' },
          },
          ['path', 'content']
        ),
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_directory',
        description: 'List files and directories under a workspace path.',
        parameters: objectSchema({
            path: { type: 'string', description: 'Workspace-relative directory path.' },
            depth: { type: 'integer', description: 'Recursion depth, max 6.' },
          }),
      },
    },
    {
      type: 'function',
      function: {
        name: 'search_code',
        description: 'Search code or text inside the workspace using ripgrep.',
        parameters: objectSchema(
          {
            query: { type: 'string', description: 'Search pattern or literal query.' },
            path: { type: 'string', description: 'Workspace-relative root to search in.' },
            limit: { type: 'integer', description: 'Maximum number of matches to return, max 300.' },
          },
          ['query']
        ),
      },
    },
    {
      type: 'function',
      function: {
        name: 'ask_user',
        description: 'Ask the user one precise clarification question when blocked by missing requirements.',
        parameters: objectSchema(
          {
            question: { type: 'string', description: 'The clarification question.' },
            options: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional suggested answer options.',
            },
          },
          ['question']
        ),
      },
    },
  ];
}

function parseToolArguments(raw: string) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return pickObject(parsed);
  } catch {
    return {};
  }
}

function isManagedRunTerminalStatus(value: unknown) {
  const text = asText(value);
  return text === 'completed' || text === 'failed' || text === 'stopped';
}

export class AltusManagedRunService {
  private readonly controllers = new Map<string, AbortController>();

  private getModelName() {
    return (
      asText(process.env.ALTUS_MANAGED_MODEL) ||
      asText(process.env.AGENT_OPENAI_MODEL) ||
      asText(process.env.OPENAI_MODEL) ||
      'claude-haiku-4-5-20251001'
    );
  }

  private getMaxToolRounds() {
    const parsed = Number(process.env.ALTUS_MANAGED_MAX_TOOL_ROUNDS || 12);
    if (!Number.isFinite(parsed) || parsed <= 0) return 12;
    return Math.min(24, Math.floor(parsed));
  }

  private async appendRunEvent(
    runId: string,
    sessionId: string,
    eventType: string,
    payload: Record<string, unknown>
  ) {
    const event = await taskSessionRunDAO.appendRunEvent({
      runId,
      sessionId,
      eventType,
      payloadJson: payload,
    });
    const sequence = Number(event.sequence || 0);
    const envelopePayload = {
      ...payload,
      runId,
      sessionId,
      sequence,
      eventType,
    };
    altusManagedStreamService.publish(runId, {
      sequence,
      eventType,
      payload: envelopePayload,
    });
    return { sequence, payload: envelopePayload };
  }

  private async toSummary(run: Awaited<ReturnType<typeof taskSessionRunDAO.getRun>>): Promise<ManagedRunSummary | null> {
    if (!run) return null;
    return {
      id: run.id,
      sessionId: run.sessionId,
      status: run.status || undefined,
      model: run.model || null,
      stopReason: run.stopReason || null,
      streamUrl: `/api/altus-managed/runs/${encodeURIComponent(run.id)}/stream`,
      startedAt: toIso(run.startedAt),
      completedAt: toIso(run.completedAt),
      updatedAt: toIso(run.updatedAt),
      sequence: await taskSessionRunDAO.getLatestRunEventSequence(run.id),
    };
  }

  private async ensureSessionOwnership(sessionId: string, userId: string) {
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

  private async captureConnectorSnapshot(sessionId: string, userId: string) {
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

  private async ensureSandbox(sessionId: string, sessionTitle?: string | null) {
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

  private async persistTimelineMessage(input: {
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

  private async updateSessionLifecycle(
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

  private async buildConversationMessages(sessionId: string, currentInput: string, systemPrompt: string): Promise<ChatMessage[]> {
    const history = await taskCreationSessionDAO.getMessages(sessionId);
    const relevant = history
      .filter((item) => isHistoryMessageRelevant({ role: item.role, messageType: item.messageType }))
      .slice(-24)
      .map((item) => ({
        role: normalizeHistoryRole(item.role)!,
        content: asText(item.content),
      }));

    return [
      {
        role: 'system',
        content: systemPrompt,
      },
      ...relevant,
      {
        role: 'user',
        content: currentInput,
      },
    ];
  }

  private async callModel(input: {
    messages: ChatMessage[];
    signal: AbortSignal;
  }) {
    const baseUrl = `http://127.0.0.1:${process.env.PORT || '4000'}/api/llm-proxy/v1/chat/completions`;
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.getModelName(),
        messages: input.messages,
        tools: buildToolDefinitions(),
        tool_choice: 'auto',
        temperature: 0.2,
        stream: false,
      }),
      signal: input.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(text || `llm_proxy_failed:${response.status}`);
    }

    const payload = (await response.json()) as any;
    const choice = payload?.choices?.[0]?.message;
    if (!choice || typeof choice !== 'object') {
      throw new Error('managed_model_empty_choice');
    }
    return choice as {
      content?: string | null;
      tool_calls?: ToolCall[];
    };
  }

  private async runModelLoop(input: {
    runId: string;
    sessionId: string;
    userId: string;
    userInput: string;
    sandboxId: string;
    workspaceRoot: string;
    sessionTitle?: string | null;
    connectors: Awaited<ReturnType<typeof sessionConnectorService.listSessionConnectors>>;
    signal: AbortSignal;
  }) {
    const runtime = new AltusManagedToolRuntime({
      sandboxId: input.sandboxId,
      workspaceRoot: input.workspaceRoot,
    });
    const systemPrompt = altusManagedPromptService.buildSystemPrompt({
      sessionId: input.sessionId,
      sessionTitle: input.sessionTitle,
      workspaceRoot: input.workspaceRoot,
      connectors: input.connectors,
    });
    const messages = await this.buildConversationMessages(input.sessionId, input.userInput, systemPrompt);

    for (let round = 0; round < this.getMaxToolRounds(); round += 1) {
      if (input.signal.aborted) {
        throw new Error('managed_run_aborted');
      }

      await this.appendRunEvent(input.runId, input.sessionId, 'run_status', {
        status: round === 0 ? 'running' : 'waiting_tool',
        content: round === 0 ? '正在分析并执行任务' : '继续处理工具结果',
      });

      const assistant = await this.callModel({
        messages,
        signal: input.signal,
      });
      const assistantContent = truncate(asText(assistant.content), 24000);
      const toolCalls = Array.isArray(assistant.tool_calls) ? assistant.tool_calls : [];

      if (toolCalls.length === 0) {
        const finalContent = assistantContent || '任务已处理完成。';
        await this.persistTimelineMessage({
          sessionId: input.sessionId,
          role: 'agent',
          messageType: 'assistant_message',
          content: finalContent,
          metadata: {
            agent: 'assistant',
            runId: input.runId,
          },
          messageKey: `managed:${input.runId}:assistant_final`,
        });
        await this.appendRunEvent(input.runId, input.sessionId, 'assistant_message', {
          content: finalContent,
          messageKey: `managed:${input.runId}:assistant_final`,
        });
        return { outcome: 'completed' as const, content: finalContent };
      }

      messages.push({
        role: 'assistant',
        content: assistantContent || '',
        tool_calls: toolCalls,
      });

      for (const toolCall of toolCalls) {
        const toolName = asText(toolCall?.function?.name);
        if (!toolName) {
          continue;
        }
        const args = parseToolArguments(asText(toolCall?.function?.arguments));
        await this.appendRunEvent(input.runId, input.sessionId, 'tool_call_started', {
          toolName,
          content: `调用工具 ${toolName}`,
          arguments: args,
          toolCallId: toolCall.id,
        });

        try {
          const result = await runtime.execute(toolName, args, input.signal);
          if (result.type === 'ask_user') {
            await taskCreationFileMemoryStore.setPendingClarification(
              input.sessionId,
              result.question,
              result.options
            );
            await this.persistTimelineMessage({
              sessionId: input.sessionId,
              role: 'agent',
              messageType: 'clarification_request',
              content: result.question,
              metadata: {
                question: result.question,
                options: result.options,
                runId: input.runId,
              },
              messageKey: `managed:${input.runId}:clarification`,
            });
            await this.appendRunEvent(input.runId, input.sessionId, 'clarification_requested', {
              question: result.question,
              options: result.options,
              content: result.question,
              toolName,
              toolCallId: toolCall.id,
            });
            return {
              outcome: 'waiting_user' as const,
              question: result.question,
              options: result.options,
            };
          }

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: toolName,
            content: result.content,
          });
          await this.appendRunEvent(input.runId, input.sessionId, 'tool_call_completed', {
            toolName,
            content: `工具 ${toolName} 已完成`,
            toolCallId: toolCall.id,
            outputPreview: truncate(result.content, 4000),
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error || 'tool_failed');
          await this.appendRunEvent(input.runId, input.sessionId, 'tool_call_failed', {
            toolName,
            content: `工具 ${toolName} 失败`,
            toolCallId: toolCall.id,
            error: message,
          });
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: toolName,
            content: JSON.stringify({
              error: message,
            }),
          });
        }
      }
    }

    throw new Error('managed_run_tool_round_limit_exceeded');
  }

  private async executeRun(input: {
    runId: string;
    sessionId: string;
    userId: string;
    userInput: string;
    sessionTitle?: string | null;
    connectors: Awaited<ReturnType<typeof sessionConnectorService.listSessionConnectors>>;
  }) {
    const abortController = new AbortController();
    this.controllers.set(input.runId, abortController);

    try {
      const sandbox = await this.ensureSandbox(input.sessionId, input.sessionTitle);
      await this.updateSessionLifecycle(input.sessionId, {
        status: 'in_progress',
        stage: 'executing',
        phase: 'development',
        clearClarification: true,
      });
      await taskSessionRunDAO.updateRunStatus(input.runId, 'running', {
        startedAt: new Date(),
      });
      await this.appendRunEvent(input.runId, input.sessionId, 'run_status', {
        status: 'running',
        content: sandbox.reused ? '已恢复会话 sandbox，开始执行' : '已创建新的 sandbox，开始执行',
        sandboxId: sandbox.sandboxId,
        workspaceRoot: sandbox.workspaceRoot,
      });

      const result = await this.runModelLoop({
        runId: input.runId,
        sessionId: input.sessionId,
        userId: input.userId,
        userInput: input.userInput,
        sandboxId: sandbox.sandboxId,
        workspaceRoot: sandbox.workspaceRoot,
        sessionTitle: input.sessionTitle,
        connectors: input.connectors,
        signal: abortController.signal,
      });

      if (result.outcome === 'waiting_user') {
        await taskSessionRunDAO.updateRunStatus(input.runId, 'waiting_user');
        await this.updateSessionLifecycle(input.sessionId, {
          status: 'waiting_user',
          stage: 'clarifying',
          phase: 'analysis',
        });
        return;
      }

      await taskSessionRunDAO.updateRunStatus(input.runId, 'completed', {
        completedAt: new Date(),
      });
      await this.updateSessionLifecycle(input.sessionId, {
        status: 'completed',
        stage: 'completed',
        phase: 'delivery',
        clearClarification: true,
      });
      await this.appendRunEvent(input.runId, input.sessionId, 'run_completed', {
        status: 'completed',
        content: 'managed run 已完成',
      });
    } catch (error) {
      if (abortController.signal.aborted || asText((error as Error)?.message) === 'managed_run_aborted') {
        await taskSessionRunDAO.updateRunStatus(input.runId, 'stopped', {
          completedAt: new Date(),
          stopReason: 'user_interrupt',
        });
        await this.updateSessionLifecycle(input.sessionId, {
          status: 'in_progress',
          stage: 'collecting',
          phase: 'analysis',
          clearClarification: true,
        });
        await this.persistTimelineMessage({
          sessionId: input.sessionId,
          role: 'system',
          messageType: 'status_update',
          content: '已停止当前处理',
          metadata: {
            stage: 'failed',
            tone: 'system',
            runId: input.runId,
            interruptConfirmed: true,
          },
          messageKey: `managed:${input.runId}:stopped`,
        });
        await this.appendRunEvent(input.runId, input.sessionId, 'run_stopped', {
          status: 'stopped',
          content: '已停止当前处理',
        });
        return;
      }

      const message = error instanceof Error ? error.message : String(error || 'managed run failed');
      await taskSessionRunDAO.updateRunStatus(input.runId, 'failed', {
        completedAt: new Date(),
        stopReason: message,
      });
      await this.updateSessionLifecycle(input.sessionId, {
        status: 'failed',
        stage: 'failed',
        phase: 'repair',
        clearClarification: true,
      });
      await this.persistTimelineMessage({
        sessionId: input.sessionId,
        role: 'system',
        messageType: 'error',
        content: `Altus managed 运行失败：${message}`,
        metadata: {
          runId: input.runId,
        },
        messageKey: `managed:${input.runId}:failed`,
      });
      await this.appendRunEvent(input.runId, input.sessionId, 'run_failed', {
        status: 'failed',
        content: `Altus managed 运行失败：${message}`,
        error: message,
      });
    } finally {
      this.controllers.delete(input.runId);
    }
  }

  async startRun(sessionId: string, userId: string, input: ManagedRunStartInput): Promise<ManagedRunSummary> {
    const content = asText(input.content);
    if (!content) {
      throw new Error('消息内容不能为空');
    }

    await this.ensureSessionOwnership(sessionId, userId);
    const activeRun = await taskSessionRunDAO.findActiveRun(sessionId);
    if (activeRun) {
      throw new Error('当前会话已有运行中的 Altus managed run');
    }

    const sessionMemory = await taskCreationFileMemoryStore.getSession(sessionId);
    const connectorSnapshot = await this.captureConnectorSnapshot(sessionId, userId);
    const run = await taskSessionRunDAO.createRun({
      sessionId,
      status: 'queued',
      mode: 'managed',
      model: this.getModelName(),
      connectorSnapshotId: connectorSnapshot.snapshotId,
      metadataJson: {
        trigger: 'user_input',
      },
    });

    const isClarificationAnswer = Boolean(asText(sessionMemory?.pendingQuestion));
    const messageType = isClarificationAnswer ? 'user_response' : 'user_input';
    const messageKey = asText(input.messageKey) || `managed:${run.id}:${messageType}`;
    await this.persistTimelineMessage({
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
    await this.updateSessionLifecycle(sessionId, {
      status: 'in_progress',
      stage: 'executing',
      phase: 'analysis',
      clearClarification: true,
    });

    await this.appendRunEvent(run.id, sessionId, 'run_ack', {
      status: 'queued',
      content: 'managed run 已创建',
      messageKey,
    });

    void this.executeRun({
      runId: run.id,
      sessionId,
      userId,
      userInput: content,
      sessionTitle: sessionMemory?.title || null,
      connectors: connectorSnapshot.statuses,
    });

    return (await this.toSummary(run)) as ManagedRunSummary;
  }

  async getLatestRun(sessionId: string, userId: string) {
    await this.ensureSessionOwnership(sessionId, userId);
    const latest = await taskSessionRunDAO.getLatestRun(sessionId);
    return this.toSummary(latest);
  }

  async stopRun(runId: string, userId: string, reason?: string) {
    const run = await taskSessionRunDAO.getRun(runId);
    if (!run) {
      throw new Error('managed run 不存在');
    }
    await this.ensureSessionOwnership(run.sessionId, userId);
    if (isManagedRunTerminalStatus(run.status)) {
      return this.toSummary(run);
    }

    const controller = this.controllers.get(runId);
    if (controller) {
      controller.abort(reason || 'user_interrupt');
      return this.toSummary((await taskSessionRunDAO.getRun(runId)) || run);
    }

    await taskSessionRunDAO.updateRunStatus(runId, 'stopped', {
      completedAt: new Date(),
      stopReason: reason || 'user_interrupt',
    });
    await this.updateSessionLifecycle(run.sessionId, {
      status: 'in_progress',
      stage: 'collecting',
      phase: 'analysis',
      clearClarification: true,
    });
    await this.appendRunEvent(runId, run.sessionId, 'run_stopped', {
      status: 'stopped',
      content: '已停止当前处理',
    });
    return this.toSummary(await taskSessionRunDAO.getRun(runId));
  }

  async streamRun(runId: string, res: express.Response, options?: { afterSequence?: number | null }) {
    return altusManagedStreamService.subscribe(runId, res, {
      afterSequence: options?.afterSequence ?? null,
    });
  }
}

export const altusManagedRunService = new AltusManagedRunService();
