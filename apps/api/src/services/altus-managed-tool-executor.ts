import type { ManagedToolResult, AltusManagedToolRuntime } from './altus-managed-tool-runtime';
import type { AltusRunEventWriter } from './altus-run-event-writer';
import type { AltusRunRecoveryMode, AltusRunTransitionReason } from './altus-run-loop-state';
import type { ToolCall } from './altus-managed-shared';
import { asText } from './altus-managed-shared';
import {
  traceToolCallStart,
  traceToolCallComplete,
} from './api-trace-service';
import {
  buildManagedToolResultEnvelope,
  type ManagedToolResultEnvelope,
} from './altus-managed-tool-result-envelope';

export type AltusManagedToolExecutionEnvelope =
  | {
      status: 'result';
      toolName: string;
      toolCallId: string;
      args: Record<string, unknown>;
      result: Extract<ManagedToolResult, { type: 'result' }>;
      transitionReason: AltusRunTransitionReason;
      recoveryMode: AltusRunRecoveryMode;
      toolResultEnvelope: ManagedToolResultEnvelope;
      meta?: Record<string, unknown>;
    }
  | {
      status: 'ask_user';
      toolName: string;
      toolCallId: string;
      args: Record<string, unknown>;
      result: Extract<ManagedToolResult, { type: 'ask_user' }>;
      toolResultEnvelope: ManagedToolResultEnvelope;
    }
  | {
      status: 'complete';
      toolName: string;
      toolCallId: string;
      args: Record<string, unknown>;
      result: Extract<ManagedToolResult, { type: 'complete' }>;
      toolResultEnvelope: ManagedToolResultEnvelope;
    }
  | {
      status: 'failed';
      toolName: string;
      toolCallId: string;
      args: Record<string, unknown>;
      error: string;
      rawError: string;
      transitionReason: AltusRunTransitionReason;
      recoveryMode: AltusRunRecoveryMode;
      toolResultEnvelope: ManagedToolResultEnvelope;
      meta?: Record<string, unknown>;
    };

type ToolResultDisposition = {
  transitionReason?: AltusRunTransitionReason;
  recoveryMode?: AltusRunRecoveryMode;
  eventPayload?: Record<string, unknown>;
  meta?: Record<string, unknown>;
};

type ToolFailureDisposition = {
  transitionReason?: AltusRunTransitionReason;
  recoveryMode?: AltusRunRecoveryMode;
  eventPayload?: Record<string, unknown>;
  meta?: Record<string, unknown>;
};

export class AltusManagedToolExecutor {
  constructor(
    private readonly input: {
      runId: string;
      sessionId: string;
      userId: string;
      runtime: AltusManagedToolRuntime;
      eventWriter: AltusRunEventWriter;
      buildToolEventContent: (toolName: string, phase: 'started' | 'progress' | 'completed' | 'failed') => string;
      sanitizeToolEventError: (toolName: string, errorMessage: string) => string;
    }
  ) {}

  async executeToolCall(input: {
    toolCall: ToolCall;
    args: Record<string, unknown>;
    eventArgs?: Record<string, unknown>;
    signal: AbortSignal;
    modelRoundId?: string | number | null;
    onResult?: (result: Extract<ManagedToolResult, { type: 'result' }>) => ToolResultDisposition;
    onFailure?: (rawError: string, sanitizedError: string) => ToolFailureDisposition;
  }): Promise<AltusManagedToolExecutionEnvelope> {
    const toolName = asText(input.toolCall?.function?.name);
    const toolCallId = asText(input.toolCall?.id);
    const toolStartedAt = new Date();
    const eventArgs = input.eventArgs || input.args;

    const toolTrace = await traceToolCallStart({
      sessionId: this.input.sessionId,
      runId: this.input.runId,
      toolName: toolName || 'unknown',
      arguments: input.args,
      startedAt: toolStartedAt,
    });

    await this.input.eventWriter.appendRunEvent(
      this.input.runId,
      this.input.sessionId,
      this.input.userId,
      'tool_call_started',
      {
        toolName,
        content: this.input.buildToolEventContent(toolName, 'started'),
        arguments: eventArgs,
        toolCallId,
      }
    );

    try {
      const result = await this.input.runtime.execute(toolName, input.args, input.signal);
      if (result.type === 'ask_user') {
        const toolResultEnvelope = buildManagedToolResultEnvelope({
          status: 'ask_user',
          runId: this.input.runId,
          toolUseId: toolCallId,
          toolName,
          modelRoundId: input.modelRoundId,
          args: eventArgs,
          content: result.question,
          contentForUser: result.question,
          activatedSkills: result.activatedSkills as any,
        });
        traceToolCallComplete(toolTrace, {
          responseBody: { type: 'ask_user', question: result.question },
          completedAt: new Date(),
          durationMs: Date.now() - toolStartedAt.getTime(),
        });
        return {
          status: 'ask_user',
          toolName,
          toolCallId,
          args: input.args,
          result,
          toolResultEnvelope,
        };
      }

      if (result.type === 'complete') {
        const toolResultEnvelope = buildManagedToolResultEnvelope({
          status: 'complete',
          runId: this.input.runId,
          toolUseId: toolCallId,
          toolName,
          modelRoundId: input.modelRoundId,
          args: eventArgs,
          content: JSON.stringify({
            summary: result.summary,
            verification: result.verification || [],
            attachments: result.attachments || [],
          }),
          contentForUser: result.summary,
          activatedSkills: result.activatedSkills as any,
        });
        traceToolCallComplete(toolTrace, {
          responseBody: { type: 'complete', summary: result.summary },
          completedAt: new Date(),
          durationMs: Date.now() - toolStartedAt.getTime(),
        });
        return {
          status: 'complete',
          toolName,
          toolCallId,
          args: input.args,
          result,
          toolResultEnvelope,
        };
      }

      const disposition = input.onResult?.(result) || {};
      const toolResultEnvelope = buildManagedToolResultEnvelope({
        status: 'ok',
        runId: this.input.runId,
        toolUseId: toolCallId,
        toolName,
        modelRoundId: input.modelRoundId,
        args: eventArgs,
        content: result.content,
        contentForUser: this.input.buildToolEventContent(toolName, 'completed'),
        activatedSkills: result.activatedSkills as any,
        result: result.content,
      });
      await this.input.eventWriter.appendRunEvent(
        this.input.runId,
        this.input.sessionId,
        this.input.userId,
        'tool_call_completed',
        {
          toolName,
          content: this.input.buildToolEventContent(toolName, 'completed'),
          arguments: eventArgs,
          toolCallId,
          toolResultEnvelope,
          ...(disposition.eventPayload || {}),
        }
      );
      traceToolCallComplete(toolTrace, {
        responseBody: { type: 'result', content: result.content },
        completedAt: new Date(),
        durationMs: Date.now() - toolStartedAt.getTime(),
      });

      return {
        status: 'result',
        toolName,
        toolCallId,
        args: input.args,
        result,
        toolResultEnvelope,
        transitionReason: disposition.transitionReason || 'tool_result_continue',
        recoveryMode: disposition.recoveryMode || 'none',
        meta: disposition.meta,
      };
    } catch (error) {
      const rawError = error instanceof Error ? error.message : String(error || 'tool_failed');
      const sanitizedError = this.input.sanitizeToolEventError(toolName, rawError);
      const disposition = input.onFailure?.(rawError, sanitizedError) || {};
      const toolResultEnvelope = buildManagedToolResultEnvelope({
        status: 'error',
        runId: this.input.runId,
        toolUseId: toolCallId,
        toolName,
        modelRoundId: input.modelRoundId,
        args: eventArgs,
        content: sanitizedError,
        contentForUser: sanitizedError,
        errorMessage: rawError,
      });

      await this.input.eventWriter.appendRunEvent(
        this.input.runId,
        this.input.sessionId,
        this.input.userId,
        'tool_call_failed',
        {
          toolName,
          content: this.input.buildToolEventContent(toolName, 'failed'),
          arguments: eventArgs,
          toolCallId,
          error: sanitizedError,
          toolResultEnvelope,
          transitionReason: disposition.transitionReason || 'tool_failed_but_recoverable',
          ...(disposition.eventPayload || {}),
        }
      );
      traceToolCallComplete(toolTrace, {
        responseBody: { type: 'error', error: sanitizedError },
        completedAt: new Date(),
        durationMs: Date.now() - toolStartedAt.getTime(),
        errorMessage: sanitizedError,
      });

      return {
        status: 'failed',
        toolName,
        toolCallId,
        args: input.args,
        error: sanitizedError,
        rawError,
        toolResultEnvelope,
        transitionReason: disposition.transitionReason || 'tool_failed_but_recoverable',
        recoveryMode: disposition.recoveryMode || 'tool_repair',
        meta: disposition.meta,
      };
    }
  }
}
