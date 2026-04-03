import { beforeEach, describe, expect, it } from 'vitest';
import {
  primeManagedRunRecoveryState,
  primeOptimisticHistoryViewCache,
  reconcileHistoryWithPendingLocalMessages,
  readPersistedManagedRunRecoveryState,
  readPersistedHistoryViewCache,
  type AgentMessage,
} from '@/hooks/useTaskCreationAgent';

describe('managed history reconciliation', () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        sessionStorage: {
          getItem: (key: string) => storage.get(key) ?? null,
          setItem: (key: string, value: string) => {
            storage.set(key, value);
          },
          removeItem: (key: string) => {
            storage.delete(key);
          },
          clear: () => {
            storage.clear();
          },
        },
      },
    });
    globalThis.window.sessionStorage.clear();
  });

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

  it('persists optimistic first message into history cache before session route switch', () => {
    const optimisticMessage: AgentMessage = {
      type: 'user_input',
      messageKey: 'user-msg-bridge',
      content: '首条消息',
      metadata: {
        messageKey: 'user-msg-bridge',
      },
      sessionId: 'session-bridge',
    };

    const merged = primeOptimisticHistoryViewCache({
      sessionId: 'session-bridge',
      currentMessages: [],
      optimisticMessage,
      oldestCursor: null,
      hasOlderHistory: false,
      welcomeMessage: 'welcome',
    });
    const cached = readPersistedHistoryViewCache('session-bridge');

    expect(merged).toHaveLength(1);
    expect(merged[0]?.content).toBe('首条消息');
    expect(cached?.messages).toHaveLength(1);
    expect(cached?.messages[0]?.messageKey).toBe('user-msg-bridge');
    expect(cached?.messages[0]?.content).toBe('首条消息');
  });

  it('persists managed processing recovery state across session route switch', () => {
    const persisted = primeManagedRunRecoveryState({
      sessionId: 'session-managed',
      runId: 'run-managed-1',
      status: 'starting',
      processing: true,
    });
    const cached = readPersistedManagedRunRecoveryState('session-managed');

    expect(persisted?.sessionId).toBe('session-managed');
    expect(persisted?.runId).toBe('run-managed-1');
    expect(persisted?.processing).toBe(true);
    expect(cached?.status).toBe('starting');
    expect(cached?.runId).toBe('run-managed-1');
  });
});
