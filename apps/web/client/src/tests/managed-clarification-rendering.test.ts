import { describe, expect, it } from 'vitest';
import { buildChatItems, type ChatItem } from '@/pages/Home';
import type { AgentMessage } from '@/hooks/useTaskCreationAgent';

describe('managed clarification rendering', () => {
  it('shows only clarification notice when clarification repeats previous assistant text', () => {
    const messages: AgentMessage[] = [
      {
        type: 'agent_message',
        content:
          '当前会话的 Supabase连接器未提供直接列出项目的工具。建议通过Supabase 项目控制台查看项目列表，或确认是否需要其他操作。',
        agent: 'altus',
        messageKey: 'managed:run-dup:assistant',
        metadata: {
          runId: 'run-dup',
          eventType: 'assistant_message',
        },
      },
      {
        type: 'clarification_request',
        content:
          '当前会话的 Supabase 连接器未提供直接列出项目的工具。建议通过 Supabase 项目控制台查看项目列表，或确认是否需要其他操作。',
        question:
          '当前会话的 Supabase 连接器未提供直接列出项目的工具。建议通过 Supabase 项目控制台查看项目列表，或确认是否需要其他操作。',
        messageKey: 'managed:run-dup:clarification',
        metadata: {
          runId: 'run-dup',
          eventType: 'clarification_requested',
        },
      },
    ];

    const items = buildChatItems(messages);
    const notices = items.filter(
      (item): item is Extract<ChatItem, { kind: 'clarification_notice' }> =>
        item.kind === 'clarification_notice'
    );
    const clarificationBlocks = items.filter(
      (item): item is Extract<ChatItem, { kind: 'agent' }> =>
        item.kind === 'agent' && item.markdown.includes('**需要补充信息**')
    );

    expect(notices).toHaveLength(1);
    expect(notices[0]?.text).toBe('Altus 将在你回复后继续工作');
    expect(clarificationBlocks).toHaveLength(0);
  });

  it('keeps full clarification content when previous message is different', () => {
    const messages: AgentMessage[] = [
      {
        type: 'agent_message',
        content: '我已经完成基础检查，下面需要你确认部署区域。',
        agent: 'altus',
        messageKey: 'managed:run-nondup:assistant',
        metadata: {
          runId: 'run-nondup',
          eventType: 'assistant_message',
        },
      },
      {
        type: 'clarification_request',
        content: '请确认要部署到美东还是亚太区域。',
        question: '请确认要部署到美东还是亚太区域。',
        messageKey: 'managed:run-nondup:clarification',
        metadata: {
          runId: 'run-nondup',
          eventType: 'clarification_requested',
        },
      },
    ];

    const items = buildChatItems(messages);
    const clarificationBlocks = items.filter(
      (item): item is Extract<ChatItem, { kind: 'agent' }> =>
        item.kind === 'agent' && item.markdown.includes('**需要补充信息**')
    );

    expect(clarificationBlocks).toHaveLength(1);
    expect(clarificationBlocks[0]?.markdown).toContain('请确认要部署到美东还是亚太区域。');
  });
});
