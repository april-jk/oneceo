import { describe, expect, it } from 'vitest';
import {
  mergeHistoryAgentMessages,
  mergeRealtimeMessage,
  type AgentMessage,
} from '@/hooks/useTaskCreationAgent';
import { buildChatItems } from '@/pages/Home';

describe('managed mixed timeline render', () => {
  it('keeps managed messages visible when timeline also contains opencode_event', () => {
    const messages: AgentMessage[] = [
      {
        type: 'user_input',
        messageKey: 'user-1',
        content: '帮我继续完善项目',
      },
      {
        type: 'agent_message',
        messageKey: 'managed:run-1:assistant',
        content: '这是 managed 链路返回的最终答复',
        agent: 'altus',
        metadata: {
          executionMode: 'managed',
          executor: 'altus',
          runId: 'run-1',
          eventType: 'assistant_message',
        },
      },
      {
        type: 'opencode_event',
        messageKey: 'stream:na:opencode-session-1:part-1',
        content: '这是 direct 事件',
        metadata: {
          eventType: 'message.final',
          opencodeSessionId: 'opencode-session-1',
          partId: 'part-1',
          event: {
            type: 'message.final',
            properties: {
              part: {
                id: 'part-1',
              },
            },
          },
          rawPayload: {
            event: {
              type: 'message.final',
              properties: {
                part: {
                  id: 'part-1',
                },
              },
            },
          },
        },
      },
    ];

    const items = buildChatItems(messages);
    expect(items.some((item) => item.kind === 'opencode_turn')).toBe(false);
    expect(
      items.some(
        (item) =>
          item.kind === 'agent' &&
          (item.markdown || '').includes('这是 managed 链路返回的最终答复')
      )
    ).toBe(true);
  });

  it('renders managed final assistant messages as Altus even when agent field is missing', () => {
    const messages: AgentMessage[] = [
      {
        type: 'agent_message',
        messageKey: 'managed:run-2:assistant',
        content: '这是刷新后从历史恢复的 managed 最终答复',
        metadata: {
          executionMode: 'managed',
          executor: 'altus',
          runId: 'run-2',
          eventType: 'assistant_message',
        },
      },
    ];

    const items = buildChatItems(messages);
    const agentItem = items.find(
      (item): item is Extract<(typeof items)[number], { kind: 'agent' }> =>
        item.kind === 'agent',
    );

    expect(agentItem).toBeTruthy();
    expect(agentItem?.author).toBe('Altus');
    expect(agentItem?.showAuthor).toBeUndefined();
    expect(agentItem?.markdown).toContain('这是刷新后从历史恢复的 managed 最终答复');
    expect(agentItem?.markdown).not.toContain('**Altus**');
    expect(agentItem?.markdown).not.toContain('**智能体**');
  });

  it('orders merged history by timeline cursor after refresh', () => {
    const messages = mergeHistoryAgentMessages(
      [
        {
          type: 'agent_message',
          messageKey: 'assistant-2',
          content: '第二条回复',
          metadata: { timelineCursor: 30 },
        },
      ],
      [
        {
          type: 'user_input',
          messageKey: 'user-1',
          content: '第一条用户消息',
          metadata: { timelineCursor: 10 },
        },
        {
          type: 'agent_message',
          messageKey: 'assistant-1',
          content: '第一条回复',
          metadata: { timelineCursor: 20 },
        },
      ],
    );

    expect(messages.map((message) => message.messageKey)).toEqual([
      'user-1',
      'assistant-1',
      'assistant-2',
    ]);
  });

  it('inserts late realtime messages according to timeline cursor', () => {
    const messages = mergeRealtimeMessage(
      [
        {
          type: 'agent_message',
          messageKey: 'assistant-2',
          content: '第二条回复',
          metadata: { timelineCursor: 30 },
        },
      ],
      {
        type: 'user_input',
        messageKey: 'user-1',
        content: '第一条用户消息',
        metadata: { timelineCursor: 10 },
      },
      '',
    );

    expect(messages.map((message) => message.messageKey)).toEqual(['user-1', 'assistant-2']);
  });
});
