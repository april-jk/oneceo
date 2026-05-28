import { describe, expect, it } from 'vitest';
import type { AgentMessage } from '@/hooks/useTaskCreationAgent';
import {
  buildPendingSandboxPromptDispatchKey,
  deriveSessionStateFromMessages,
  shouldStopProcessingForMessage,
} from '@/hooks/useTaskCreationAgent';

describe('04_processing_stop_rules', () => {
  it('returns true for clarification and completed status', () => {
    const clarification: AgentMessage = { type: 'clarification_request', question: '请补充信息' };
    const completedStatus: AgentMessage = {
      type: 'status_update',
      stage: 'completed',
      content: 'OpenCode 执行完成',
    };

    expect(shouldStopProcessingForMessage(clarification)).toBe(true);
    expect(shouldStopProcessingForMessage(completedStatus)).toBe(true);
  });

  it('keeps processing while PPT clarification cards are still being generated', () => {
    const pendingPptClarification: AgentMessage = {
      type: 'clarification_request',
      question: '这份 PPT 开始制作前，先确认 4 个关键决策。',
      metadata: {
        clarificationType: 'presentation_brief',
      },
    };

    expect(shouldStopProcessingForMessage(pendingPptClarification)).toBe(false);
    expect(deriveSessionStateFromMessages([pendingPptClarification])).toEqual({
      stopProcessing: false,
      runtimeStatus: null,
      currentQuestion: null,
    });
  });

  it('returns true for terminal opencode events', () => {
    const finalMsg: AgentMessage = {
      type: 'opencode_event',
      metadata: { eventType: 'message.final' },
    };
    const idleStatus: AgentMessage = {
      type: 'opencode_event',
      metadata: {
        eventType: 'session.status',
        event: { properties: { state: 'idle' } },
      },
    };
    const questionTool: AgentMessage = {
      type: 'opencode_event',
      metadata: {
        eventType: 'message.part.updated',
        event: {
          type: 'message.part.updated',
          properties: {
            part: { type: 'tool', tool: 'question' },
          },
        },
      },
    };

    expect(shouldStopProcessingForMessage(finalMsg)).toBe(true);
    expect(shouldStopProcessingForMessage(idleStatus)).toBe(false);
    expect(shouldStopProcessingForMessage(questionTool)).toBe(true);
  });

  it('returns false for non-terminal opencode progress event', () => {
    const progressMsg: AgentMessage = {
      type: 'opencode_event',
      metadata: {
        eventType: 'message.part.updated',
        event: {
          type: 'message.part.updated',
          properties: {
            part: { type: 'tool', tool: 'bash' },
          },
        },
      },
    };

    expect(shouldStopProcessingForMessage(progressMsg)).toBe(false);
  });

  it('builds a stable dispatch key for pending sandbox prompts', () => {
    expect(
      buildPendingSandboxPromptDispatchKey({
        sessionId: 'session-1',
        messageKey: 'user-1',
      })
    ).toBe('session-1:user-1');
    expect(
      buildPendingSandboxPromptDispatchKey({
        sessionId: '  ',
        messageKey: 'user-1',
      })
    ).toBe('');
  });

  it('does not let a previous completed turn stop a new follow-up turn', () => {
    const messages: AgentMessage[] = [
      {
        type: 'user_input',
        content: '第一轮问题',
      },
      {
        type: 'status_update',
        stage: 'completed',
        content: 'OpenCode 执行完成',
      },
      {
        type: 'user_input',
        content: '继续修改这个实现',
      },
    ];

    expect(deriveSessionStateFromMessages(messages)).toEqual({
      stopProcessing: false,
      runtimeStatus: null,
      currentQuestion: null,
    });
  });

  it('only derives clarification from the latest turn window', () => {
    const messages: AgentMessage[] = [
      {
        type: 'user_input',
        content: '第一轮问题',
      },
      {
        type: 'clarification_request',
        question: '第一轮澄清',
      },
      {
        type: 'user_response',
        content: '第一轮回答',
      },
      {
        type: 'status_update',
        stage: 'completed',
        content: 'OpenCode 执行完成',
      },
      {
        type: 'user_input',
        content: '第二轮继续',
      },
    ];

    expect(deriveSessionStateFromMessages(messages).currentQuestion).toBeNull();
  });
});
