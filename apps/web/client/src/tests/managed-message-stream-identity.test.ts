import { describe, expect, it } from 'vitest';
import {
  mergeRealtimeMessage,
  resolveManagedStreamMessageKey,
  type AgentMessage,
} from '@/hooks/useTaskCreationAgent';

const WELCOME_MESSAGE = 'welcome';

describe('managed message stream identity', () => {
  it('keeps optimistic user input visible when run_ack carries source message metadata', () => {
    const userMessage: AgentMessage = {
      type: 'user_input',
      messageKey: 'user-msg-1',
      content: '帮我修复 managed 消息显示',
      metadata: {
        messageKey: 'user-msg-1',
      },
      sessionId: 'session-1',
    };
    const runAckKey = resolveManagedStreamMessageKey({
      eventType: 'run_ack',
      runId: 'run-1',
      payloadMessageKey: 'user-msg-1',
      sequence: 1,
    });

    expect(runAckKey).toBe('managed:run-1:run_ack');

    const next = mergeRealtimeMessage(
      [userMessage],
      {
        type: 'status_update',
        content: 'managed run 已创建',
        messageKey: runAckKey,
        metadata: {
          eventType: 'run_ack',
          runId: 'run-1',
          sourceMessageKey: 'user-msg-1',
          messageKey: runAckKey,
        },
        sessionId: 'session-1',
      },
      WELCOME_MESSAGE
    );

    expect(next).toHaveLength(2);
    expect(next[0]?.type).toBe('user_input');
    expect(next[0]?.messageKey).toBe('user-msg-1');
    expect(next[1]?.type).toBe('status_update');
    expect(next[1]?.messageKey).toBe('managed:run-1:run_ack');
  });

  it('still merges tool events by tool call identity', () => {
    const toolKey = resolveManagedStreamMessageKey({
      eventType: 'tool_call_started',
      runId: 'run-2',
      toolCallId: 'tool-1',
      payloadMessageKey: 'ignored-user-key',
      sequence: 3,
    });

    expect(toolKey).toBe('managed:run-2:tool:tool-1');

    const next = mergeRealtimeMessage(
      [
        {
          type: 'executor_event',
          content: '调用工具 read_file',
          messageKey: toolKey,
          metadata: {
            eventType: 'tool_call_started',
            toolCallId: 'tool-1',
            messageKey: toolKey,
          },
        },
      ],
      {
        type: 'executor_event',
        content: '工具 read_file 已完成',
        messageKey: toolKey,
        metadata: {
          eventType: 'tool_call_completed',
          toolCallId: 'tool-1',
          messageKey: toolKey,
        },
      },
      WELCOME_MESSAGE
    );

    expect(next).toHaveLength(1);
    expect(next[0]?.content).toBe('工具 read_file 已完成');
  });

  it('appends managed assistant delta chunks and replaces them with the final assistant message', () => {
    const assistantKey = resolveManagedStreamMessageKey({
      eventType: 'assistant_delta',
      runId: 'run-3',
      payloadMessageKey: 'managed:run-3:assistant',
      sequence: 11,
    });

    const withDelta = mergeRealtimeMessage(
      [],
      {
        type: 'agent_message',
        content: '你好',
        agent: 'altus',
        messageKey: assistantKey,
        metadata: {
          eventType: 'assistant_delta',
          runId: 'run-3',
          sequence: 11,
          stream: true,
          streamDelta: true,
          messageKey: assistantKey,
        },
        sessionId: 'session-3',
      },
      WELCOME_MESSAGE
    );

    const withSecondDelta = mergeRealtimeMessage(
      withDelta,
      {
        type: 'agent_message',
        content: '，世界',
        agent: 'altus',
        messageKey: assistantKey,
        metadata: {
          eventType: 'assistant_delta',
          runId: 'run-3',
          sequence: 12,
          stream: true,
          streamDelta: true,
          messageKey: assistantKey,
        },
        sessionId: 'session-3',
      },
      WELCOME_MESSAGE
    );

    expect(withSecondDelta).toHaveLength(1);
    expect(withSecondDelta[0]?.content).toBe('你好，世界');

    const withFinal = mergeRealtimeMessage(
      withSecondDelta,
      {
        type: 'agent_message',
        content: '你好，世界',
        agent: 'altus',
        messageKey: assistantKey,
        metadata: {
          eventType: 'assistant_message',
          runId: 'run-3',
          messageKey: assistantKey,
        },
        sessionId: 'session-3',
      },
      WELCOME_MESSAGE
    );

    expect(withFinal).toHaveLength(1);
    expect(withFinal[0]?.content).toBe('你好，世界');
    expect(withFinal[0]?.metadata?.eventType).toBe('assistant_message');
  });
});
