import { describe, expect, it } from 'vitest';
import type { AgentMessage } from '@/hooks/useTaskCreationAgent';
import { buildChatItems } from '@/pages/Home';

function finalEvent(content: string): AgentMessage {
  return {
    type: 'opencode_event',
    content,
    metadata: {
      eventType: 'message.final',
      event: { type: 'message.final', properties: {} },
      rawPayload: { event: { type: 'message.final', properties: {} } },
    },
  };
}

describe('01_message_roundtrip_render', () => {
  it('filters echoed final and keeps actual assistant final', () => {
    const userText = '帮我开发一个工程管理软件，用于记录工程项目的细节';
    const messages: AgentMessage[] = [
      { type: 'user_input', content: userText },
      finalEvent(userText),
      finalEvent('好的，我会先搭建 Node.js + SQLite 的工程管理系统基础结构。'),
    ];

    const items = buildChatItems(messages);
    const turnItems = items.filter((item) => item.kind === 'opencode_turn');

    expect(turnItems).toHaveLength(1);
    expect((turnItems[0] as { userText: string }).userText).toBe(userText);
    expect(
      (turnItems[0] as { assistantParts: Array<{ kind: string; markdown?: string }> }).assistantParts
    ).toHaveLength(1);
    expect(
      (turnItems[0] as { assistantParts: Array<{ kind: string; markdown?: string }> }).assistantParts[0]?.markdown
    ).toContain('Node.js + SQLite');
    expect(
      (turnItems[0] as { assistantParts: Array<{ kind: string; markdown?: string }> }).assistantParts[0]?.markdown
    ).not.toContain(userText);
  });
});
