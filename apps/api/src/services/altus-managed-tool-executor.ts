import type { ManagedToolResult, AltusManagedToolRuntime } from './altus-managed-tool-runtime';
import type { AltusRunEventWriter } from './altus-run-event-writer';
import type { AltusRunRecoveryMode, AltusRunTransitionReason } from './altus-run-loop-state';
import type { ToolCall } from './altus-managed-shared';
import { asText } from './altus-managed-shared';

export type AltusManagedToolExecutionEnvelope =
  | {
      status: 'result';
      toolName: string;
      toolCallId: string;
      args: Record<string, unknown>;
      result: Extract<ManagedToolResult, { type: 'result' }>;
      transitionReason: AltusRunTransitionReason;
      recoveryMode: AltusRunRecoveryMode;
      meta?: Record<string, unknown>;
    }
  | {
      status: 'ask_user';
      toolName: string;
      toolCallId: string;
      args: Record<string, unknown>;
      result: Extract<ManagedToolResult, { type: 'ask_user' }>;
    }
  | {
      status: 'complete';
      toolName: string;
      toolCallId: string;
      args: Record<string, unknown>;
      result: Extract<ManagedToolResult, { type: 'complete' }>;
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
    signal: AbortSignal;
    onResult?: (result: Extract<ManagedToolResult, { type: 'result' }>) => ToolResultDisposition;
    onFailure?: (rawError: string, sanitizedError: string) => ToolFailureDisposition;
  }): Promise<AltusManagedToolExecutionEnvelope> {
    const toolName = asText(input.toolCall?.function?.name);
    const toolCallId = asText(input.toolCall?.id);

    await this.input.eventWriter.appendRunEvent(
      this.input.runId,
      this.input.sessionId,
      this.input.userId,
      'tool_call_started',
      {
        toolName,
        content: this.input.buildToolEventContent(toolName, 'started'),
        arguments: input.args,
        toolCallId,
      }
    );

    try {
      const result = await this.input.runtime.execute(toolName, input.args, input.signal);
      if (result.type === 'ask_user') {
        return {
          status: 'ask_user',
          toolName,
          toolCallId,
          args: input.args,
          result,
        };
      }

      if (result.type === 'complete') {
        return {
          status: 'complete',
          toolName,
          toolCallId,
          args: input.args,
          result,
        };
      }

      const disposition = input.onResult?.(result) || {};
      await this.input.eventWriter.appendRunEvent(
        this.input.runId,
        this.input.sessionId,
        this.input.userId,
        'tool_call_completed',
        {
          toolName,
          content: this.input.buildToolEventContent(toolName, 'completed'),
          arguments: input.args,
          toolCallId,
          ...(disposition.eventPayload || {}),
        }
      );

      return {
        status: 'result',
        toolName,
        toolCallId,
        args: input.args,
        result,
        transitionReason: disposition.transitionReason || 'tool_result_continue',
        recoveryMode: disposition.recoveryMode || 'none',
        meta: disposition.meta,
      };
    } catch (error) {
      const rawError = error instanceof Error ? error.message : String(error || 'tool_failed');
      const sanitizedError = this.input.sanitizeToolEventError(toolName, rawError);
      const disposition = input.onFailure?.(rawError, sanitizedError) || {};

      await this.input.eventWriter.appendRunEvent(
        this.input.runId,
        this.input.sessionId,
        this.input.userId,
        'tool_call_failed',
        {
          toolName,
          content: this.input.buildToolEventContent(toolName, 'failed'),
          arguments: input.args,
          toolCallId,
          error: sanitizedError,
          transitionReason: disposition.transitionReason || 'tool_failed_but_recoverable',
          ...(disposition.eventPayload || {}),
        }
      );

      return {
        status: 'failed',
        toolName,
        toolCallId,
        args: input.args,
        error: sanitizedError,
        rawError,
        transitionReason: disposition.transitionReason || 'tool_failed_but_recoverable',
        recoveryMode: disposition.recoveryMode || 'tool_repair',
        meta: disposition.meta,
      };
    }
  }
}
