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

export class AltusRunCoordinator {
  constructor(
    private readonly setupService: AltusManagedSetupService = altusManagedSetupService,
    private readonly eventWriter: AltusRunEventWriter = altusRunEventWriter,
    private readonly lifecycleService: AltusRunLifecycleService = altusRunLifecycleService
  ) {}

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
        tools: buildManagedToolDefinitions(),
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
    const messages = await this.setupService.buildConversationMessages(
      state.input.sessionId,
      state.input.userInput,
      systemPrompt
    );

    for (let round = 0; round < this.getMaxToolRounds(); round += 1) {
      if (signal.aborted) {
        throw new Error('managed_run_aborted');
      }

      await this.eventWriter.appendRunEvent(state.input.runId, state.input.sessionId, 'run_status', {
        status: round === 0 ? 'running' : 'waiting_tool',
        content: round === 0 ? '正在分析并执行任务' : '继续处理工具结果',
      });

      const assistant = await this.callModel({
        messages,
        signal,
      });
      const assistantContent = truncate(asText(assistant.content), 24000);
      const toolCalls = Array.isArray(assistant.tool_calls) ? assistant.tool_calls : [];

      if (toolCalls.length === 0) {
        const finalContent = assistantContent || '任务已处理完成。';
        await this.setupService.persistTimelineMessage({
          sessionId: state.input.sessionId,
          role: 'agent',
          messageType: 'assistant_message',
          content: finalContent,
          metadata: {
            agent: 'assistant',
            runId: state.input.runId,
          },
          messageKey: `managed:${state.input.runId}:assistant_final`,
        });
        await this.eventWriter.appendRunEvent(state.input.runId, state.input.sessionId, 'assistant_message', {
          content: finalContent,
          messageKey: `managed:${state.input.runId}:assistant_final`,
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
            await taskCreationFileMemoryStore.setPendingClarification(
              state.input.sessionId,
              result.question,
              result.options
            );
            await this.setupService.persistTimelineMessage({
              sessionId: state.input.sessionId,
              role: 'agent',
              messageType: 'clarification_request',
              content: result.question,
              metadata: {
                question: result.question,
                options: result.options,
                runId: state.input.runId,
              },
              messageKey: `managed:${state.input.runId}:clarification`,
            });
            await this.eventWriter.appendRunEvent(state.input.runId, state.input.sessionId, 'clarification_requested', {
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
          await this.eventWriter.appendRunEvent(state.input.runId, state.input.sessionId, 'tool_call_completed', {
            toolName,
            content: `工具 ${toolName} 已完成`,
            toolCallId: toolCall.id,
            outputPreview: truncate(result.content, 4000),
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error || 'tool_failed');
          await this.eventWriter.appendRunEvent(state.input.runId, state.input.sessionId, 'tool_call_failed', {
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

      state.markCompleted();
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
