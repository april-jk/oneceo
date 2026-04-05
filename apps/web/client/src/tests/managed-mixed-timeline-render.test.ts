import { describe, expect, it } from 'vitest';
import type { AgentMessage } from '@/hooks/useTaskCreationAgent';
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
});
