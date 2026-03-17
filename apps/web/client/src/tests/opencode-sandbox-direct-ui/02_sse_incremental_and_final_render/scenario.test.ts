import { describe, expect, it } from 'vitest';
import type { AgentMessage } from '@/hooks/useTaskCreationAgent';
import { buildChatItems } from '@/pages/Home';

function textPartEvent(content: string, partId: string): AgentMessage {
  return {
    type: 'opencode_event',
    content,
    metadata: {
      eventType: 'message.part.updated',
      event: {
        type: 'message.part.updated',
        properties: {
          part: {
            id: partId,
            type: 'text',
            text: content,
          },
        },
      },
      rawPayload: {
        event: {
          type: 'message.part.updated',
          properties: {
            part: {
              id: partId,
              type: 'text',
              text: content,
            },
          },
        },
      },
    },
  };
}

function finalEvent(content: string, partId: string): AgentMessage {
  return {
    type: 'opencode_event',
    content,
    metadata: {
      eventType: 'message.final',
      partId,
      event: { type: 'message.final', properties: { part: { id: partId } } },
      rawPayload: { event: { type: 'message.final', properties: { part: { id: partId } } } },
    },
  };
}

describe('02_sse_incremental_and_final_render', () => {
  it('prefers final message and hides same-part incremental text', () => {
    const messages: AgentMessage[] = [
      textPartEvent('正在生成项目结构...', 'p-1'),
      finalEvent('项目结构已生成完成。', 'p-1'),
    ];

    const items = buildChatItems(messages);
    const turnItems = items.filter((item) => item.kind === 'opencode_turn');

    expect(turnItems).toHaveLength(1);
    expect(
      (turnItems[0] as { assistantParts: Array<{ kind: string; markdown?: string }> }).assistantParts
    ).toHaveLength(1);
    expect(
      (turnItems[0] as { assistantParts: Array<{ kind: string; markdown?: string }> }).assistantParts[0]?.markdown
    ).toContain('项目结构已生成完成');
  });
});
