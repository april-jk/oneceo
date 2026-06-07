import { describe, expect, it } from 'vitest';
import { buildChatItems, getActiveManagedStatusText, type ChatItem } from '@/pages/Home';
import {
  mergeHistorySnapshotWithRealtime,
  type AgentMessage,
} from '@/hooks/useTaskCreationAgent';

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

  it('does not render a structured clarification card after its linked answer is persisted', () => {
    const clarificationMessageKey = 'managed:run-ppt-answered:clarification';
    const messages: AgentMessage[] = [
      {
        type: 'clarification_request',
        content: '这份 PPT 开始制作前，先确认关键决策。',
        question: '这份 PPT 开始制作前，先确认关键决策。',
        messageKey: clarificationMessageKey,
        metadata: {
          runId: 'run-ppt-answered',
          eventType: 'clarification_requested',
          structuredClarification: {
            kind: 'structured_clarification',
            taskType: 'ppt',
            title: 'PPT 制作前确认',
            maxCards: 4,
            cards: [
              {
                id: 'style',
                title: '视觉风格',
                question: '选择视觉风格',
                selectionMode: 'single',
                required: true,
                allowOther: true,
                allowNote: false,
                options: [
                  {
                    id: 'tech',
                    label: '科技投研风',
                    description: '专业克制',
                    impact: '提升数据密度',
                    recommended: true,
                  },
                ],
              },
            ],
          },
        },
      },
      {
        type: 'user_response',
        content: '已确认需求（结构化澄清选择）',
        messageKey: 'managed:run-ppt-answer:user_response',
        metadata: {
          source: 'structured_clarification_answer',
          clarificationMessageKey,
          structuredClarificationAnswer: {
            planTitle: 'PPT 制作前确认',
          },
        },
      },
    ];

    const items = buildChatItems(messages);

    expect(items.some((item) => item.kind === 'structured_clarification')).toBe(false);
    expect(
      items.some(
        (item): item is Extract<ChatItem, { kind: 'user' }> =>
          item.kind === 'user' && item.text.includes('已确认需求')
      )
    ).toBe(true);
  });

  it('keeps a structured clarification card when a later user message is unrelated', () => {
    const messages: AgentMessage[] = [
      {
        type: 'clarification_request',
        content: '请确认 PPT 风格。',
        question: '请确认 PPT 风格。',
        messageKey: 'managed:run-ppt-open:clarification',
        metadata: {
          runId: 'run-ppt-open',
          eventType: 'clarification_requested',
          structuredClarification: {
            kind: 'structured_clarification',
            taskType: 'ppt',
            title: 'PPT 制作前确认',
            maxCards: 4,
            cards: [
              {
                id: 'style',
                title: '视觉风格',
                question: '选择视觉风格',
                selectionMode: 'single',
                options: [
                  {
                    id: 'tech',
                    label: '科技投研风',
                    recommended: true,
                  },
                ],
              },
            ],
          },
        },
      },
      {
        type: 'user_response',
        content: '普通补充信息',
        messageKey: 'user-unrelated',
        metadata: {
          source: 'chat',
        },
      },
    ];

    const items = buildChatItems(messages);

    expect(items.some((item) => item.kind === 'structured_clarification')).toBe(true);
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

  it('keeps non-PPT clarification requests as ordinary clarification text', () => {
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
    expect(items.some((item) => item.kind === 'structured_clarification')).toBe(false);
  });

  it('keeps a loading status while PPT clarification cards are not yet available', () => {
    const messages: AgentMessage[] = [
      {
        type: 'clarification_request',
        content: '这份 PPT 开始制作前，先确认 4 个关键决策。',
        question: '这份 PPT 开始制作前，先确认 4 个关键决策。',
        messageKey: 'managed:run-ppt-pending:clarification',
        metadata: {
          runId: 'run-ppt-pending',
          eventType: 'clarification_requested',
          clarificationType: 'presentation_brief',
        },
      },
    ];

    const items = buildChatItems(messages);
    const managedStatusItems = items.filter(
      (item): item is Extract<ChatItem, { kind: 'managed_status' }> =>
        item.kind === 'managed_status'
    );

    expect(managedStatusItems).toHaveLength(1);
    expect(managedStatusItems[0]?.displayInTimeline).toBe(false);
    expect(getActiveManagedStatusText(items)).toBe('正在生成澄清选项...');
    expect(items.some((item) => item.kind === 'structured_clarification')).toBe(false);
    expect(
      items.some(
        (item): item is Extract<ChatItem, { kind: 'agent' }> =>
          item.kind === 'agent' && item.markdown.includes('**需要补充信息**')
      )
    ).toBe(false);
  });

  it('does not let a stale history snapshot remove a realtime clarification card', () => {
    const userMessage: AgentMessage = {
      type: 'user_input',
      content: '制作一个介绍端午节的 ppt',
      messageKey: 'user-ppt-race',
    };
    const clarification: AgentMessage = {
      type: 'clarification_request',
      content: '这份 PPT 开始制作前，先确认关键决策。',
      question: '这份 PPT 开始制作前，先确认关键决策。',
      messageKey: 'managed:run-ppt-race:clarification',
      metadata: {
        runId: 'run-ppt-race',
        eventType: 'clarification_requested',
        clarificationType: 'presentation_brief',
        structuredClarification: {
          kind: 'structured_clarification',
          taskType: 'ppt',
          title: '端午节 PPT 制作前确认',
          summary: '先确认受众。',
          maxCards: 1,
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
              allowNote: false,
              options: [
                {
                  id: 'general',
                  label: '大众科普',
                  description: '面向普通观众',
                  impact: '采用易懂的节日文化叙事。',
                  recommended: true,
                },
              ],
            },
          ],
        },
      },
    };

    const merged = mergeHistorySnapshotWithRealtime(
      [userMessage],
      [userMessage, clarification]
    );

    expect(merged.some((message) => message.messageKey === clarification.messageKey)).toBe(true);
    expect(buildChatItems(merged).some((item) => item.kind === 'structured_clarification')).toBe(true);
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
