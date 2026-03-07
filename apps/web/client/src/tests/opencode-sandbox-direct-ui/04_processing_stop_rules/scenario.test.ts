import { describe, expect, it } from 'vitest';
import type { AgentMessage } from '@/hooks/useTaskCreationAgent';
import { shouldStopProcessingForMessage } from '@/hooks/useTaskCreationAgent';

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
    expect(shouldStopProcessingForMessage(idleStatus)).toBe(true);
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
});
