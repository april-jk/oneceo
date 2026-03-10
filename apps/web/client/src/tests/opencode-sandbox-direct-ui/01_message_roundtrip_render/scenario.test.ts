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
    const userItems = items.filter((item) => item.kind === 'user');
    const agentItems = items.filter((item) => item.kind === 'agent');

    expect(userItems).toHaveLength(1);
    expect(agentItems).toHaveLength(1);
    expect((agentItems[0] as { markdown: string }).markdown).toContain('Node.js + SQLite');
    expect((agentItems[0] as { markdown: string }).markdown).not.toContain(userText);
  });
});
