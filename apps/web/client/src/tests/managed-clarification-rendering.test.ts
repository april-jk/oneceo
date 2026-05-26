import { describe, expect, it } from 'vitest';
import { buildChatItems, type ChatItem } from '@/pages/Home';
import type { AgentMessage } from '@/hooks/useTaskCreationAgent';

describe('managed clarification rendering', () => {
  it('renders structured clarification card plans as interactive chat items', () => {
    const messages: AgentMessage[] = [
      {
        type: 'clarification_request',
        content: '这份 PPT 开始制作前，先确认 4 个关键决策。',
        question: '这份 PPT 开始制作前，先确认 4 个关键决策。',
        messageKey: 'managed:run-ppt:clarification',
        metadata: {
          runId: 'run-ppt',
          eventType: 'clarification_requested',
          structuredClarification: {
            kind: 'structured_clarification',
            taskType: 'ppt',
            title: '生成 PPT 前确认 4 个关键决策',
            summary: '先确认受众、资料、深度和风格。',
            maxCards: 4,
            briefFields: ['purpose_audience'],
            cards: [
              {
                id: 'purpose_audience',
                title: '演示目的与受众',
                question: '这份 PPT 主要给谁看？',
                why: '决定叙事角度',
                selectionMode: 'single',
                required: true,
                allowOther: true,
                allowNote: true,
                options: [
                  {
                    id: 'investor_pitch',
                    label: '投资人融资路演',
                    description: '强调投资价值',
                    impact: '突出市场和融资用途。',
                    recommended: true,
                  },
                  {
                    id: 'executive_strategy',
                    label: '内部高管战略汇报',
                    description: '强调战略判断',
                    impact: '突出风险和资源投入。',
                  },
                ],
              },
            ],
          },
        },
      },
    ];

    const items = buildChatItems(messages);
    const structuredItems = items.filter(
      (item): item is Extract<ChatItem, { kind: 'structured_clarification' }> =>
        item.kind === 'structured_clarification'
    );

    expect(structuredItems).toHaveLength(1);
    expect(structuredItems[0]?.plan.cards).toHaveLength(1);
    expect(structuredItems[0]?.plan.cards[0]?.options[0]?.label).toBe('投资人融资路演');
  });

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
    expect(notices[0]?.text).toMatch(/Altus/);
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
        item.kind === 'agent' && item.markdown.includes('请确认要部署到美东还是亚太区域。')
    );

    expect(clarificationBlocks).toHaveLength(1);
    expect(clarificationBlocks[0]?.markdown).toContain('请确认要部署到美东还是亚太区域。');
  });

  it('hides mcp confirmation approval markers from rendered user messages', () => {
    const messages: AgentMessage[] = [
      {
        type: 'user_input',
        content: '帮我发邮件给 Alice',
        messageKey: 'user-approve-1',
      },
      {
        type: 'user_response',
        content: '[mcp_tool_confirmation:approve]',
        messageKey: 'user-approve-2',
        metadata: {
          source: 'mcp_tool_confirmation_approved',
          confirmationId: 'confirmation-1',
        },
      },
      {
        type: 'agent_message',
        content: '已确认执行，正在继续处理 Google Workspace 高风险操作...',
        agent: 'altus',
        messageKey: 'managed:run-approve-1:assistant',
        metadata: {
          runId: 'run-approve-1',
          eventType: 'assistant_message',
        },
      },
    ];

    const items = buildChatItems(messages);
    const userItems = items.filter(
      (item): item is Extract<ChatItem, { kind: 'user' }> => item.kind === 'user'
    );

    expect(userItems).toHaveLength(1);
    expect(userItems[0]?.text).toBe('帮我发邮件给 Alice');
    expect(JSON.stringify(items)).not.toContain('[mcp_tool_confirmation:approve]');
  });
});
