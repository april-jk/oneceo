import { describe, expect, it } from 'vitest';
import {
  mergeHistoryAgentMessages,
  mergeRealtimeMessage,
  resolveManagedStreamDisplayContent,
  resolveManagedStreamMessageKey,
  type AgentMessage,
} from '@/hooks/useTaskCreationAgent';

const WELCOME_MESSAGE = 'welcome';

describe('managed message stream identity', () => {
  it('preserves leading newline and whitespace in managed stream content chunks', () => {
    const newlineChunk = resolveManagedStreamDisplayContent({
      payload: {
        content: '\n-技术规划：整理需求',
      },
      envelope: {},
    });

    expect(newlineChunk).toBe('\n-技术规划：整理需求');

    const spaceChunk = resolveManagedStreamDisplayContent({
      payload: {
        delta: ' ',
      },
      envelope: {},
    });

    expect(spaceChunk).toBe(' ');
  });

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

  it('dedupes repeated managed shell inspection tail events in finalization stage', () => {
    const previous: AgentMessage = {
      type: 'executor_event',
      content: '检查项目文件和运行日志',
      messageKey: 'managed:run-3:tool:tool-check-1',
      metadata: {
        executor: 'altus',
        executionMode: 'managed',
        eventType: 'tool_call_completed',
        toolName: 'shell_execute',
        arguments: {
          command: 'ls -la outputs',
        },
        toolPurpose: '检查项目文件和运行日志',
      },
      sessionId: 'session-3',
    };

    const next = mergeRealtimeMessage(
      [previous],
      {
        type: 'executor_event',
        content: '检查项目文件和运行日志',
        messageKey: 'managed:run-3:tool:tool-check-2',
        metadata: {
          executor: 'altus',
          executionMode: 'managed',
          eventType: 'tool_call_completed',
          toolName: 'shell_execute',
          arguments: {
            command: 'cat outputs/workbook_manifest.json',
          },
          toolPurpose: '检查项目文件和运行日志',
        },
        sessionId: 'session-3',
      },
      WELCOME_MESSAGE
    );

    expect(next).toHaveLength(1);
    expect(next[0]?.messageKey).toBe('managed:run-3:tool:tool-check-1');
  });

  it('maps clarification_requested to the same key as persisted clarification message', () => {
    const fallbackKey = resolveManagedStreamMessageKey({
      eventType: 'clarification_requested',
      runId: 'run-clarify-1',
      sequence: 9,
    });

    expect(fallbackKey).toBe('managed:run-clarify-1:clarification');

    const explicitKey = resolveManagedStreamMessageKey({
      eventType: 'clarification_requested',
      runId: 'run-clarify-1',
      payloadMessageKey: 'managed:run-clarify-1:clarification',
      sequence: 10,
    });

    expect(explicitKey).toBe('managed:run-clarify-1:clarification');
  });

  it('dedupes assistant clarification text and keeps only clarification_request', () => {
    const assistantKey = resolveManagedStreamMessageKey({
      eventType: 'assistant_delta',
      runId: 'run-clarify-2',
      payloadMessageKey: 'managed:run-clarify-2:assistant',
      sequence: 31,
    });

    const withAssistant = mergeRealtimeMessage(
      [],
      {
        type: 'agent_message',
        content:
          '看起来 Supabase 连接器当前无法使用，尽管会话显示它已授权。请重新授权后告诉我。',
        agent: 'altus',
        messageKey: assistantKey,
        metadata: {
          eventType: 'assistant_delta',
          runId: 'run-clarify-2',
          sequence: 31,
          streamDelta: true,
          messageKey: assistantKey,
        },
        sessionId: 'session-clarify-2',
      },
      WELCOME_MESSAGE
    );

    const withClarification = mergeRealtimeMessage(
      withAssistant,
      {
        type: 'clarification_request',
        content:
          '看起来 Supabase 连接器当前无法使用，尽管会话显示它已授权。请重新授权后告诉我。',
        question:
          '看起来 Supabase 连接器当前无法使用，尽管会话显示它已授权。请重新授权后告诉我。',
        messageKey: 'managed:run-clarify-2:clarification',
        metadata: {
          eventType: 'clarification_requested',
          runId: 'run-clarify-2',
          messageKey: 'managed:run-clarify-2:clarification',
        },
        sessionId: 'session-clarify-2',
      },
      WELCOME_MESSAGE
    );

    expect(withClarification).toHaveLength(1);
    expect(withClarification[0]?.type).toBe('clarification_request');
    expect(withClarification[0]?.messageKey).toBe('managed:run-clarify-2:clarification');
  });

  it('dedupes clarification when text differs only by mixed CJK and English spacing', () => {
    const assistantKey = resolveManagedStreamMessageKey({
      eventType: 'assistant_delta',
      runId: 'run-clarify-3',
      payloadMessageKey: 'managed:run-clarify-3:assistant',
      sequence: 41,
    });

    const withAssistant = mergeRealtimeMessage(
      [],
      {
        type: 'agent_message',
        content:
          '当前会话的 Supabase连接器未提供直接列出项目的工具。建议通过Supabase 项目控制台查看项目列表，或确认是否需要其他操作。',
        agent: 'altus',
        messageKey: assistantKey,
        metadata: {
          eventType: 'assistant_delta',
          runId: 'run-clarify-3',
          sequence: 41,
          streamDelta: true,
          messageKey: assistantKey,
        },
        sessionId: 'session-clarify-3',
      },
      WELCOME_MESSAGE
    );

    const withClarification = mergeRealtimeMessage(
      withAssistant,
      {
        type: 'clarification_request',
        content:
          '当前会话的 Supabase 连接器未提供直接列出项目的工具。建议通过 Supabase 项目控制台查看项目列表，或确认是否需要其他操作。',
        question:
          '当前会话的 Supabase 连接器未提供直接列出项目的工具。建议通过 Supabase 项目控制台查看项目列表，或确认是否需要其他操作。',
        messageKey: 'managed:run-clarify-3:clarification',
        metadata: {
          eventType: 'clarification_requested',
          runId: 'run-clarify-3',
          messageKey: 'managed:run-clarify-3:clarification',
        },
        sessionId: 'session-clarify-3',
      },
      WELCOME_MESSAGE
    );

    expect(withClarification).toHaveLength(1);
    expect(withClarification[0]?.type).toBe('clarification_request');
    expect(withClarification[0]?.messageKey).toBe('managed:run-clarify-3:clarification');
  });

  it('keeps the longer managed assistant content when final message is shorter', () => {
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

    const withShortFinal = mergeRealtimeMessage(
      withSecondDelta,
      {
        type: 'agent_message',
        content: '你好',
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

    expect(withShortFinal).toHaveLength(1);
    expect(withShortFinal[0]?.content).toBe('你好，世界');
    expect(withShortFinal[0]?.metadata?.eventType).toBe('assistant_message');
  });

  it('keeps the longer managed assistant content when history merge receives a shorter final message', () => {
    const key = 'managed:run-history-1:assistant';
    const merged = mergeHistoryAgentMessages(
      [
        {
          type: 'agent_message',
          content: '第一段，第二段',
          agent: 'altus',
          messageKey: key,
          metadata: {
            eventType: 'assistant_delta',
            runId: 'run-history-1',
            streamDelta: true,
            messageKey: key,
          },
        },
      ],
      [
        {
          type: 'agent_message',
          content: '第一段',
          agent: 'altus',
          messageKey: key,
          metadata: {
            eventType: 'assistant_message',
            runId: 'run-history-1',
            messageKey: key,
          },
        },
      ]
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]?.content).toBe('第一段，第二段');
    expect(merged[0]?.metadata?.eventType).toBe('assistant_message');
  });

  it('keeps managed assistant and tool-call ordering by splitting stream segments after interruptions', () => {
    const key = 'managed:run-seq-1:assistant';
    const withFirstAssistant = mergeRealtimeMessage(
      [],
      {
        type: 'agent_message',
        content: '我需要先检查连接器状态。',
        agent: 'altus',
        messageKey: key,
        metadata: {
          eventType: 'assistant_delta',
          runId: 'run-seq-1',
          sequence: 1,
          streamDelta: true,
          messageKey: key,
        },
      },
      WELCOME_MESSAGE
    );
    const withTool = mergeRealtimeMessage(
      withFirstAssistant,
      {
        type: 'executor_event',
        content: '工具 load_connector_guide 失败',
        messageKey: 'managed:run-seq-1:tool:load_connector_guide',
        metadata: {
          eventType: 'tool_call_failed',
          runId: 'run-seq-1',
          toolCallId: 'load_connector_guide',
          toolName: 'load_connector_guide',
          messageKey: 'managed:run-seq-1:tool:load_connector_guide',
        },
      },
      WELCOME_MESSAGE
    );
    const withSecondAssistant = mergeRealtimeMessage(
      withTool,
      {
        type: 'agent_message',
        content: '连接器不可用，我将请求您提供 GitHub 用户名。',
        agent: 'altus',
        messageKey: key,
        metadata: {
          eventType: 'assistant_delta',
          runId: 'run-seq-1',
          sequence: 3,
          streamDelta: true,
          messageKey: key,
        },
      },
      WELCOME_MESSAGE
    );

    expect(withSecondAssistant).toHaveLength(3);
    expect(withSecondAssistant[0]?.type).toBe('agent_message');
    expect(withSecondAssistant[0]?.content).toContain('检查连接器状态');
    expect(withSecondAssistant[1]?.type).toBe('executor_event');
    expect(withSecondAssistant[2]?.type).toBe('agent_message');
    expect(withSecondAssistant[2]?.content).toContain('连接器不可用');
    expect(withSecondAssistant[2]?.messageKey).toContain(':segment:');
  });

  it('keeps history merge ordering by splitting managed assistant segments after tool events', () => {
    const merged = mergeHistoryAgentMessages(
      [
        {
          type: 'agent_message',
          content: '第一段说明',
          agent: 'altus',
          messageKey: 'managed:run-h-seq-1:assistant',
          metadata: {
            eventType: 'assistant_delta',
            runId: 'run-h-seq-1',
            sequence: 1,
            messageKey: 'managed:run-h-seq-1:assistant',
          },
        },
        {
          type: 'executor_event',
          content: '工具失败',
          messageKey: 'managed:run-h-seq-1:tool:load_connector_guide',
          metadata: {
            eventType: 'tool_call_failed',
            runId: 'run-h-seq-1',
            toolName: 'load_connector_guide',
            toolCallId: 'load_connector_guide',
            messageKey: 'managed:run-h-seq-1:tool:load_connector_guide',
          },
        },
      ],
      [
        {
          type: 'agent_message',
          content: '第二段说明',
          agent: 'altus',
          messageKey: 'managed:run-h-seq-1:assistant',
          metadata: {
            eventType: 'assistant_message',
            runId: 'run-h-seq-1',
            sequence: 3,
            messageKey: 'managed:run-h-seq-1:assistant',
          },
        },
      ]
    );

    expect(merged).toHaveLength(3);
    expect(merged[0]?.type).toBe('agent_message');
    expect(merged[1]?.type).toBe('executor_event');
    expect(merged[2]?.type).toBe('agent_message');
    expect(merged[2]?.content).toContain('第二段说明');
    expect(merged[2]?.messageKey).toContain(':segment:');
  });

  it('replaces duplicate streamed completion text when final managed assistant message arrives after complete_task', () => {
    const key = 'managed:run-complete-1:assistant';
    const streamed = mergeRealtimeMessage(
      [],
      {
        type: 'agent_message',
        content: 'watson，已进一步优化2048小游戏的动画流畅度。',
        agent: 'altus',
        messageKey: key,
        metadata: {
          eventType: 'assistant_delta',
          runId: 'run-complete-1',
          sequence: 1,
          streamDelta: true,
          messageKey: key,
        },
      },
      WELCOME_MESSAGE
    );

    const withTool = mergeRealtimeMessage(
      streamed,
      {
        type: 'executor_event',
        content: '完成任务',
        messageKey: 'managed:run-complete-1:tool:complete',
        metadata: {
          eventType: 'tool_call_completed',
          runId: 'run-complete-1',
          toolName: 'complete_task',
          toolCallId: 'complete',
          messageKey: 'managed:run-complete-1:tool:complete',
        },
      },
      WELCOME_MESSAGE
    );

    const finalState = mergeRealtimeMessage(
      withTool,
      {
        type: 'agent_message',
        content: 'watson，已进一步优化2048小游戏的动画流畅度。',
        agent: 'altus',
        messageKey: key,
        metadata: {
          eventType: 'assistant_message',
          runId: 'run-complete-1',
          sequence: 3,
          messageKey: key,
        },
      },
      WELCOME_MESSAGE
    );

    expect(finalState).toHaveLength(2);
    expect(finalState[0]?.type).toBe('executor_event');
    expect(finalState[1]?.type).toBe('agent_message');
    expect(finalState[1]?.content).toBe('watson，已进一步优化2048小游戏的动画流畅度。');
    expect(finalState[1]?.messageKey).toContain(':segment:');
  });

  it('keeps final managed assistant message after complete_task when backend uses final key', () => {
    const streamKey = 'managed:run-complete-final-1:assistant';
    const finalKey = 'managed:run-complete-final-1:assistant:final';
    const streamed = mergeRealtimeMessage(
      [],
      {
        type: 'agent_message',
        content: 'watson，数据库支持已经添加完成。',
        agent: 'altus',
        messageKey: streamKey,
        metadata: {
          eventType: 'assistant_delta',
          runId: 'run-complete-final-1',
          sequence: 1,
          streamDelta: true,
          messageKey: streamKey,
        },
      },
      WELCOME_MESSAGE
    );

    const withTool = mergeRealtimeMessage(
      streamed,
      {
        type: 'executor_event',
        content: '完成任务',
        messageKey: 'managed:run-complete-final-1:tool:complete',
        metadata: {
          eventType: 'tool_call_completed',
          runId: 'run-complete-final-1',
          toolName: 'complete_task',
          toolCallId: 'complete',
          messageKey: 'managed:run-complete-final-1:tool:complete',
        },
      },
      WELCOME_MESSAGE
    );

    const finalState = mergeRealtimeMessage(
      withTool,
      {
        type: 'agent_message',
        content: 'watson，数据库支持已经添加完成。',
        agent: 'altus',
        messageKey: finalKey,
        metadata: {
          eventType: 'assistant_message',
          runId: 'run-complete-final-1',
          sequence: 3,
          messageKey: finalKey,
        },
      },
      WELCOME_MESSAGE
    );

    expect(finalState).toHaveLength(2);
    expect(finalState[0]?.type).toBe('executor_event');
    expect(finalState[1]?.type).toBe('agent_message');
    expect(finalState[1]?.messageKey).toBe(finalKey);
    expect(finalState[1]?.content).toBe('watson，数据库支持已经添加完成。');
  });

  it('keeps recovered final managed assistant message after complete_task when final key differs from stream key', () => {
    const merged = mergeHistoryAgentMessages(
      [
        {
          type: 'agent_message',
          content: 'watson，数据库支持已经添加完成。',
          agent: 'altus',
          messageKey: 'managed:run-complete-final-2:assistant',
          metadata: {
            eventType: 'assistant_delta',
            runId: 'run-complete-final-2',
            sequence: 1,
            streamDelta: true,
            messageKey: 'managed:run-complete-final-2:assistant',
          },
        },
        {
          type: 'executor_event',
          content: '完成任务',
          messageKey: 'managed:run-complete-final-2:tool:complete',
          metadata: {
            eventType: 'tool_call_completed',
            runId: 'run-complete-final-2',
            toolName: 'complete_task',
            toolCallId: 'complete',
            messageKey: 'managed:run-complete-final-2:tool:complete',
          },
        },
      ],
      [
        {
          type: 'agent_message',
          content: 'watson，数据库支持已经添加完成。',
          agent: 'altus',
          messageKey: 'managed:run-complete-final-2:assistant:final',
          metadata: {
            eventType: 'assistant_message',
            runId: 'run-complete-final-2',
            sequence: 3,
            messageKey: 'managed:run-complete-final-2:assistant:final',
          },
        },
      ]
    );

    expect(merged).toHaveLength(2);
    expect(merged[0]?.type).toBe('executor_event');
    expect(merged[1]?.type).toBe('agent_message');
    expect(merged[1]?.messageKey).toBe('managed:run-complete-final-2:assistant:final');
    expect(merged[1]?.content).toBe('watson，数据库支持已经添加完成。');
  });

  it('dedupes managed recovery history when cached streamed completion matches persisted final assistant message', () => {
    const merged = mergeHistoryAgentMessages(
      [
        {
          type: 'agent_message',
          content: 'watson，已进一步优化2048小游戏的动画流畅度。',
          agent: 'altus',
          messageKey: 'managed:run-complete-2:assistant',
          metadata: {
            eventType: 'assistant_delta',
            runId: 'run-complete-2',
            sequence: 1,
            streamDelta: true,
            messageKey: 'managed:run-complete-2:assistant',
          },
        },
        {
          type: 'executor_event',
          content: '完成任务',
          messageKey: 'managed:run-complete-2:tool:complete',
          metadata: {
            eventType: 'tool_call_completed',
            runId: 'run-complete-2',
            toolName: 'complete_task',
            toolCallId: 'complete',
            messageKey: 'managed:run-complete-2:tool:complete',
          },
        },
      ],
      [
        {
          type: 'agent_message',
          content: 'watson，已进一步优化2048小游戏的动画流畅度。',
          agent: 'altus',
          messageKey: 'managed:run-complete-2:assistant',
          metadata: {
            eventType: 'assistant_message',
            runId: 'run-complete-2',
            sequence: 3,
            messageKey: 'managed:run-complete-2:assistant',
          },
        },
      ]
    );

    expect(merged).toHaveLength(2);
    expect(merged[0]?.type).toBe('executor_event');
    expect(merged[1]?.type).toBe('agent_message');
    expect(merged[1]?.content).toBe('watson，已进一步优化2048小游戏的动画流畅度。');
    expect(merged[1]?.metadata?.eventType).toBe('assistant_message');
  });
});
