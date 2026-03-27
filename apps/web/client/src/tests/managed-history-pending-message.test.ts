import { describe, expect, it } from 'vitest';
import {
  reconcileHistoryWithPendingLocalMessages,
  type AgentMessage,
} from '@/hooks/useTaskCreationAgent';

describe('managed history reconciliation', () => {
  it('keeps local optimistic user input when recent/history is still empty', () => {
    const pending: AgentMessage[] = [
      {
        type: 'user_input',
        messageKey: 'user-msg-1',
        content: '你好',
        metadata: {
          messageKey: 'user-msg-1',
        },
        sessionId: 'session-1',
      },
    ];

    const reconciled = reconcileHistoryWithPendingLocalMessages([], pending);

    expect(reconciled.messages).toHaveLength(1);
    expect(reconciled.messages[0]?.type).toBe('user_input');
    expect(reconciled.messages[0]?.content).toBe('你好');
    expect(reconciled.remainingPending).toHaveLength(1);
  });

  it('drops local pending copy after history confirms the same message key', () => {
    const persisted: AgentMessage[] = [
      {
        type: 'user_input',
        messageKey: 'user-msg-1',
        content: '你好',
        metadata: {
          messageKey: 'user-msg-1',
        },
        sessionId: 'session-1',
      },
    ];
    const pending: AgentMessage[] = [
      {
        type: 'user_input',
        messageKey: 'user-msg-1',
        content: '你好',
        metadata: {
          messageKey: 'user-msg-1',
        },
        sessionId: 'session-1',
      },
    ];

    const reconciled = reconcileHistoryWithPendingLocalMessages(persisted, pending);

    expect(reconciled.messages).toHaveLength(1);
    expect(reconciled.messages[0]?.messageKey).toBe('user-msg-1');
    expect(reconciled.remainingPending).toHaveLength(0);
  });
});
