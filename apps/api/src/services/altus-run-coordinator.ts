import { taskCreationFileMemoryStore } from '../agents/task-creation/file-memory-store';
import { AltusManagedToolRuntime } from './altus-managed-tool-runtime';
import { altusManagedPromptService } from './altus-managed-prompt-service';
import {
  asText,
  buildManagedToolDefinitions,
  parseToolArguments,
  truncate,
  type ChatMessage,
  type ToolCall,
} from './altus-managed-shared';
import { AltusManagedSetupService, altusManagedSetupService } from './altus-managed-setup-service';
import { AltusRunEventWriter, altusRunEventWriter } from './altus-run-event-writer';
import { AltusRunLifecycleService, altusRunLifecycleService } from './altus-run-lifecycle-service';
import { AltusRunState } from './altus-run-state';
import {
  TaskSessionDeliverableService,
  taskSessionDeliverableService,
} from './task-session-deliverable-service';

type StreamedToolCallDelta = {
  index?: number;
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
};

type StreamedToolCallState = {
  index: number;
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
};

function sanitizeMessagesForModel(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => {
    if (!Array.isArray(message.content)) {
      return message;
    }
    return {
      ...message,
      content: message.content.map((part) => {
        if (part?.type !== 'image_url') {
          return part;
        }
        return {
          type: 'image_url' as const,
          image_url: {
            url: part.image_url.url,
          },
        };
      }),
    };
  });
}

function hasVisionInput(messages: ChatMessage[]) {
  return messages.some((message) => {
    if (!Array.isArray(message.content)) return false;
    return message.content.some((part) => part?.type === 'image_url' && Boolean(part.image_url?.url));
  });
}

export class AltusRunCoordinator {
  constructor(
    private readonly setupService: AltusManagedSetupService = altusManagedSetupService,
    private readonly eventWriter: AltusRunEventWriter = altusRunEventWriter,
    private readonly lifecycleService: AltusRunLifecycleService = altusRunLifecycleService,
    private readonly deliverableService: TaskSessionDeliverableService = taskSessionDeliverableService
  ) {}

  private getModelName(messages: ChatMessage[], fallbackModel?: string | null) {
    const needsVision = hasVisionInput(messages);
    if (needsVision) {
      return (
        asText(process.env.ALTUS_MANAGED_VISION_MODEL) ||
        asText(process.env.AGENT_OPENAI_VISION_MODEL) ||
        'qwen3-vl-plus'
      );
    }
    return (
      asText(process.env.ALTUS_MANAGED_MODEL) ||
      asText(fallbackModel) ||
      asText(process.env.AGENT_OPENAI_MODEL) ||
      asText(process.env.OPENAI_MODEL) ||
      'claude-haiku-4-5-20251001'
    );
  }

  private getMaxToolRounds() {
    const fallback = 32;
    const parsed = Number(process.env.ALTUS_MANAGED_MAX_TOOL_ROUNDS || fallback);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.min(32, Math.floor(parsed));
  }

  private getModelRetryLimit() {
    const parsed = Number(process.env.ALTUS_MANAGED_MODEL_RETRIES || 1);
    if (!Number.isFinite(parsed) || parsed < 0) return 1;
    return Math.min(3, Math.floor(parsed));
  }

  private getModelRetryDelayMs(attempt: number) {
    const parsed = Number(process.env.ALTUS_MANAGED_MODEL_RETRY_DELAY_MS || 800);
    const baseDelay = !Number.isFinite(parsed) || parsed <= 0 ? 800 : Math.floor(parsed);
    return Math.min(5000, baseDelay * Math.max(1, attempt));
  }

  private async delay(ms: number) {
    if (ms <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private extractModelError(error: unknown) {
    const raw = error instanceof Error ? error.message : String(error || 'managed_model_error');
    try {
      const parsed = JSON.parse(raw) as {
        error?: {
          message?: unknown;
          type?: unknown;
          code?: unknown;
        };
      };
      const payload = parsed?.error;
      return {
        raw,
        message: asText(payload?.message) || raw,
        type: asText(payload?.type),
        code: asText(payload?.code),
      };
    } catch {
      return {
        raw,
        message: raw,
        type: '',
        code: '',
      };
    }
  }

  private isRetryableModelError(error: unknown) {
    const parsed = this.extractModelError(error);
    const normalized = `${parsed.code} ${parsed.type} ${parsed.message}`.toLowerCase();
    return (
      normalized.includes('upstream_timeout') ||
      normalized.includes('upstream_unavailable') ||
      normalized.includes('fetch failed') ||
      normalized.includes('network error')
    );
  }

  private isClarificationResponse(content: string) {
    const normalized = asText(content);
    if (!normalized) return false;
    if (/[?？]/.test(normalized)) return true;
    const keywords = [
      'please clarify',
      'please confirm',
      'could you clarify',
      'can you clarify',
      'what kind',
      'what would you like',
      'which option',
      'please specify',
      '请说明',
      '请确认',
      '请告诉我',
      '请问',
      '请补充',
      '为了更有针对性',
      '希望优化哪些方面',
      '是否需要',
      '能否提供',
      '哪个',
      '哪种',
      '哪一个',
    ];
    const lower = normalized.toLowerCase();
    return keywords.some((keyword) => lower.includes(keyword.toLowerCase()));
  }

  private buildContinuationReminder(assistantContent: string) {
    const reminder = [
      'System reminder: continue from the latest tool result.',
      'Do not repeat the request or ask for optional clarification unless the task is truly blocked.',
      'Choose the next required tool call immediately, or call complete_task if the work is already done and verified.',
    ];
    const excerpt = truncate(asText(assistantContent), 600);
    if (!excerpt) {
      return reminder.join(' ');
    }
    return `${reminder.join(' ')} Latest plain assistant text: ${excerpt}`;
  }

  private async requestClarification(state: AltusRunState, input: { question: string; options?: string[] }) {
    await taskCreationFileMemoryStore.setPendingClarification(
      state.input.sessionId,
      input.question,
      input.options
    );
    await this.setupService.persistTimelineMessage({
      sessionId: state.input.sessionId,
      role: 'agent',
      messageType: 'clarification_request',
      content: input.question,
      metadata: {
        question: input.question,
        options: input.options,
        runId: state.input.runId,
      },
      messageKey: `managed:${state.input.runId}:clarification`,
    });
    await this.eventWriter.appendRunEvent(state.input.runId, state.input.sessionId, 'clarification_requested', {
      question: input.question,
      options: input.options,
      content: input.question,
    });
    return {
      outcome: 'waiting_user' as const,
      question: input.question,
      options: input.options,
    };
  }

  private async callModel(input: {
    messages: ChatMessage[];
    signal: AbortSignal;
    onToolCallDelta?: (toolCall: ToolCall) => Promise<void> | void;
    fallbackModel?: string | null;
  }) {
    const baseUrl = `http://127.0.0.1:${process.env.PORT || '4000'}/api/llm-proxy/v1/chat/completions`;
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.getModelName(input.messages, input.fallbackModel),
        messages: sanitizeMessagesForModel(input.messages),
        tools: buildManagedToolDefinitions(),
        tool_choice: 'auto',
        temperature: 0.2,
        stream: true,
      }),
      signal: input.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(text || `llm_proxy_failed:${response.status}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/event-stream') && response.body) {
      return this.readStreamedModelChoice({
        response,
        signal: input.signal,
        onToolCallDelta: input.onToolCallDelta,
      });
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

  private async callModelWithRetry(input: {
    messages: ChatMessage[];
    signal: AbortSignal;
    onToolCallDelta?: (toolCall: ToolCall) => Promise<void> | void;
    fallbackModel?: string | null;
  }) {
    const maxAttempts = Math.max(1, this.getModelRetryLimit() + 1);
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (input.signal.aborted) {
        throw new Error('managed_run_aborted');
      }
      try {
        return await this.callModel(input);
      } catch (error) {
        lastError = error;
        if (attempt >= maxAttempts || !this.isRetryableModelError(error)) {
          throw error;
        }
        await this.delay(this.getModelRetryDelayMs(attempt));
      }
    }
    throw (lastError instanceof Error ? lastError : new Error(String(lastError || 'managed_model_error')));
  }

  private parseSseBlock(rawBlock: string) {
    const lines = rawBlock.split(/\r?\n/);
    const dataLines: string[] = [];
    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      if (!line || line.startsWith(':')) continue;
      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim());
      }
    }
    if (dataLines.length === 0) return null;
    const rawData = dataLines.join('\n');
    if (rawData === '[DONE]') {
      return { done: true as const, payload: null };
    }
    try {
      return {
        done: false as const,
        payload: JSON.parse(rawData) as any,
      };
    } catch {
      return null;
    }
  }

  private mergeStreamToolCall(
    toolCallsByIndex: Map<number, StreamedToolCallState>,
    delta: StreamedToolCallDelta
  ) {
    const index = Number.isFinite(delta?.index) ? Math.max(0, Math.floor(Number(delta.index))) : 0;
    const existing =
      toolCallsByIndex.get(index) ||
      ({
        index,
        id: '',
        type: 'function',
        function: {
          name: '',
          arguments: '',
        },
      } satisfies StreamedToolCallState);

    const incomingId = asText(delta?.id);
    if (incomingId) {
      existing.id = incomingId;
    }

    const incomingType = asText(delta?.type);
    if (incomingType === 'function') {
      existing.type = 'function';
    }

    const incomingName = asText(delta?.function?.name);
    if (incomingName) {
      if (!existing.function.name) {
        existing.function.name = incomingName;
      } else if (!existing.function.name.endsWith(incomingName)) {
        existing.function.name += incomingName;
      }
    }

    const incomingArguments = typeof delta?.function?.arguments === 'string' ? delta.function.arguments : '';
    if (incomingArguments) {
      existing.function.arguments += incomingArguments;
    }

    toolCallsByIndex.set(index, existing);
    return existing;
  }

  private toToolCalls(toolCallsByIndex: Map<number, StreamedToolCallState>): ToolCall[] {
    return Array.from(toolCallsByIndex.entries())
      .sort(([left], [right]) => left - right)
      .map(([index, toolCall]) => ({
        id: toolCall.id || `streamed_tool_${index}`,
        type: 'function',
        function: {
          name: toolCall.function.name,
          arguments: toolCall.function.arguments || '{}',
        },
      }));
  }

  private async readStreamedModelChoice(input: {
    response: Response;
    signal: AbortSignal;
    onToolCallDelta?: (toolCall: ToolCall) => Promise<void> | void;
  }) {
    const decoder = new TextDecoder();
    let buffer = '';
    let assistantContent = '';
    const toolCallsByIndex = new Map<number, StreamedToolCallState>();

    const flushBlock = async (rawBlock: string) => {
      const parsed = this.parseSseBlock(rawBlock);
      if (!parsed) return false;
      if (parsed.done) return true;

      const payload = parsed.payload;
      if (payload?.error && typeof payload.error === 'object') {
        throw new Error(JSON.stringify(payload));
      }

      const choice = payload?.choices?.[0];
      const delta = choice?.delta;

      if (typeof delta?.content === 'string' && delta.content) {
        assistantContent += delta.content;
      }

      if (Array.isArray(delta?.tool_calls)) {
        for (const toolCallDelta of delta.tool_calls as StreamedToolCallDelta[]) {
          const merged = this.mergeStreamToolCall(toolCallsByIndex, toolCallDelta);
          if (input.onToolCallDelta) {
            await input.onToolCallDelta({
              id: merged.id || `streamed_tool_${merged.index}`,
              type: 'function',
              function: {
                name: merged.function.name,
                arguments: merged.function.arguments,
              },
            });
          }
        }
      }

      return false;
    };

    for await (const chunk of input.response.body as any) {
      if (input.signal.aborted) {
        throw new Error('managed_run_aborted');
      }
      buffer += decoder.decode(chunk, { stream: true });
      while (true) {
        const separatorIndex = buffer.indexOf('\n\n');
        if (separatorIndex < 0) break;
        const rawBlock = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        const done = await flushBlock(rawBlock);
        if (done) {
          return {
            content: assistantContent,
            tool_calls: this.toToolCalls(toolCallsByIndex),
          };
        }
      }
    }

    const tail = buffer.trim();
    if (tail) {
      await flushBlock(tail);
    }

    return {
      content: assistantContent,
      tool_calls: this.toToolCalls(toolCallsByIndex),
    };
  }

  private buildCompletionMessage(summary: string, verification?: string[]) {
    const normalizedSummary = truncate(asText(summary), 8000) || '任务已处理完成。';
    const checks = Array.isArray(verification)
      ? verification.map((item) => truncate(asText(item), 500)).filter(Boolean).slice(0, 8)
      : [];
    if (checks.length === 0) {
      return normalizedSummary;
    }
    return `${normalizedSummary}\n\n验证:\n${checks.map((item) => `- ${item}`).join('\n')}`;
  }

  private async runModelLoop(state: AltusRunState, signal: AbortSignal) {
    if (!state.workspaceRoot || !state.sandboxId) {
      throw new Error('managed_run_missing_sandbox_context');
    }

    const runtime = new AltusManagedToolRuntime({
      sandboxId: state.sandboxId,
      workspaceRoot: state.workspaceRoot,
    });
    const systemPrompt = altusManagedPromptService.buildSystemPrompt({
      sessionId: state.input.sessionId,
      sessionTitle: state.input.sessionTitle,
      workspaceRoot: state.workspaceRoot,
      connectors: state.input.connectors as any,
    });
    const skillPrompt = altusManagedPromptService.buildSkillContextPrompt(state.input.skills);
    const messages = await this.setupService.buildConversationMessages(
      state.input.sessionId,
      state.input.userInput,
      skillPrompt ? `${systemPrompt}\n\n${skillPrompt}` : systemPrompt
    );
    let plainTextRecoveryUsed = false;

    for (let round = 0; round < this.getMaxToolRounds(); round += 1) {
      if (signal.aborted) {
        throw new Error('managed_run_aborted');
      }

      await this.eventWriter.appendRunEvent(state.input.runId, state.input.sessionId, 'run_status', {
        status: round === 0 ? 'running' : 'waiting_tool',
        content: round === 0 ? '正在分析并执行任务' : '继续处理工具结果',
      });

      await this.setupService.refreshInlineImageUrls(messages);

      const toolProgressLengths = new Map<string, number>();
      const assistant = await this.callModelWithRetry({
        messages,
        signal,
        fallbackModel: state.input.model,
        onToolCallDelta: async (toolCall) => {
          const toolName = asText(toolCall?.function?.name);
          const toolCallId = asText(toolCall?.id);
          if (!toolName || !toolCallId) return;
          const rawArguments = typeof toolCall?.function?.arguments === 'string' ? toolCall.function.arguments : '';
          const previousLength = toolProgressLengths.get(toolCallId) || 0;
          const currentLength = rawArguments.length;
          if (previousLength > 0 && currentLength - previousLength < 48) {
            return;
          }
          toolProgressLengths.set(toolCallId, currentLength);
          await this.eventWriter.appendRunEvent(state.input.runId, state.input.sessionId, 'tool_call_progress', {
            toolName,
            content: `正在准备工具 ${toolName}`,
            arguments: parseToolArguments(rawArguments),
            rawArguments,
            toolCallId,
          });
        },
      });
      const assistantContent = truncate(asText(assistant.content), 24000);
      const toolCalls = Array.isArray(assistant.tool_calls) ? assistant.tool_calls : [];

      if (toolCalls.length === 0) {
        if (assistantContent && this.isClarificationResponse(assistantContent)) {
          return this.requestClarification(state, {
            question: assistantContent,
          });
        }
        if (assistantContent) {
          messages.push({
            role: 'assistant',
            content: assistantContent,
          });
        }
        if (plainTextRecoveryUsed) {
          const plainTextExcerpt = assistantContent
            ? truncate(assistantContent, 1000)
            : 'empty assistant response';
          throw new Error(`managed_model_plain_text_without_tool_call:${plainTextExcerpt}`);
        }
        messages.push({
          role: 'user',
          content: this.buildContinuationReminder(assistantContent),
        });
        plainTextRecoveryUsed = true;
        continue;
      }

      plainTextRecoveryUsed = false;

      messages.push({
        role: 'assistant',
        content: assistantContent || '',
        tool_calls: toolCalls,
      });

      for (const toolCall of toolCalls) {
        const toolName = asText(toolCall?.function?.name);
        if (!toolName) continue;
        const args = parseToolArguments(asText(toolCall?.function?.arguments));
        await this.eventWriter.appendRunEvent(state.input.runId, state.input.sessionId, 'tool_call_started', {
          toolName,
          content: `调用工具 ${toolName}`,
          arguments: args,
          toolCallId: toolCall.id,
        });

        try {
          const result = await runtime.execute(toolName, args, signal);
          if (result.type === 'ask_user') {
            return this.requestClarification(state, {
              question: result.question,
              options: result.options,
            });
          }

          if (result.type === 'complete') {
            if (!state.sandboxId || !state.workspaceRoot) {
              throw new Error('managed_run_missing_sandbox_context');
            }
            const deliverables = await this.deliverableService.persistManagedRunDeliverables({
              sessionId: state.input.sessionId,
              runId: state.input.runId,
              sandboxId: state.sandboxId,
              workspaceRoot: state.workspaceRoot,
              attachments: result.attachments || [],
            });
            state.deliverables = deliverables;
            const finalContent = this.buildCompletionMessage(result.summary, result.verification);
            await this.setupService.persistTimelineMessage({
              sessionId: state.input.sessionId,
              role: 'agent',
              messageType: 'assistant_message',
              content: finalContent,
              metadata: {
                agent: 'assistant',
                runId: state.input.runId,
                verification: result.verification,
                deliverables,
              },
              messageKey: `managed:${state.input.runId}:assistant_final`,
            });
            await this.eventWriter.appendRunEvent(state.input.runId, state.input.sessionId, 'tool_call_completed', {
              toolName,
              content: `工具 ${toolName} 已完成`,
              arguments: args,
              toolCallId: toolCall.id,
              outputPreview: truncate(
                JSON.stringify({
                  summary: result.summary,
                  verification: result.verification,
                  attachments: result.attachments,
                  deliverables,
                }),
                4000
              ),
            });
            await this.eventWriter.appendRunEvent(state.input.runId, state.input.sessionId, 'assistant_message', {
              content: finalContent,
              messageKey: `managed:${state.input.runId}:assistant_final`,
              deliverables,
            });
            return { outcome: 'completed' as const, content: finalContent, deliverables };
          }

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: toolName,
            content: result.content,
          });
          await this.eventWriter.appendRunEvent(state.input.runId, state.input.sessionId, 'tool_call_completed', {
            toolName,
            content: `工具 ${toolName} 已完成`,
            arguments: args,
            toolCallId: toolCall.id,
            outputPreview: truncate(result.content, 4000),
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error || 'tool_failed');
          await this.eventWriter.appendRunEvent(state.input.runId, state.input.sessionId, 'tool_call_failed', {
            toolName,
            content: `工具 ${toolName} 失败`,
            arguments: args,
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

  async execute(state: AltusRunState, abortController: AbortController) {
    try {
      const sandbox = await this.setupService.ensureSandbox(
        state.input.sessionId,
        state.input.sessionTitle
      );
      state.markRunning({
        sandboxId: sandbox.sandboxId,
        workspaceRoot: sandbox.workspaceRoot,
        reused: sandbox.reused,
      });
      await this.lifecycleService.markRunning(state);

      const result = await this.runModelLoop(state, abortController.signal);
      if (result.outcome === 'waiting_user') {
        state.markWaitingUser();
        await this.lifecycleService.markWaitingUser(state);
        return;
      }

      state.markCompleted({
        deliverables: state.deliverables,
      });
      await this.lifecycleService.markCompleted(state);
    } catch (error) {
      if (abortController.signal.aborted || asText((error as Error)?.message) === 'managed_run_aborted') {
        state.markStopped('user_interrupt');
        await this.lifecycleService.markStopped(state, 'user_interrupt');
        return;
      }

      const message = error instanceof Error ? error.message : String(error || 'managed run failed');
      state.markFailed(message);
      await this.lifecycleService.markFailed(state, message);
    }
  }
}

export const altusRunCoordinator = new AltusRunCoordinator();
