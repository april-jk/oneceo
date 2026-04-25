import { asText } from './altus-managed-shared';

export type AltusManagedHistoryMessage = {
  role?: unknown;
  messageType?: unknown;
  content?: unknown;
  metadata?: unknown;
};

export type AltusManagedTranscriptMessage = {
  role: 'system' | 'user' | 'assistant';
  messageType: string;
  content: string;
};

export function normalizeManagedHistoryRole(role: unknown): AltusManagedTranscriptMessage['role'] | null {
  const normalized = asText(role).toLowerCase();
  if (normalized === 'system') return 'system';
  if (normalized === 'user') return 'user';
  if (normalized === 'assistant' || normalized === 'agent') return 'assistant';
  return null;
}

export function isManagedHistoryMessageRelevant(input: { role: unknown; messageType: unknown }) {
  const role = normalizeManagedHistoryRole(input.role);
  const messageType = asText(input.messageType);
  if (!role) return false;
  if (messageType === 'session_started') return false;
  if (messageType === 'status_update') return false;
  if (messageType === 'executor_event') return false;
  if (messageType === 'opencode_event') return false;
  if (messageType === 'error' || messageType === 'opencode_error') return false;
  return true;
}

function appendCurrentInputIfMissing(
  messages: AltusManagedTranscriptMessage[],
  currentInput?: string | null,
  currentMessageType: string = 'user_input'
) {
  const currentText = asText(currentInput);
  if (!currentText) return messages;
  const latest = messages[messages.length - 1];
  if (latest?.role === 'user' && latest.content === currentText) {
    return messages;
  }
  return [
    ...messages,
    {
      role: 'user' as const,
      messageType: currentMessageType,
      content: currentText,
    },
  ];
}

function trimTranscript(
  messages: AltusManagedTranscriptMessage[],
  input: {
    limit?: number;
    preserveAssistantText?: string | null;
  } = {}
) {
  const limit = input.limit && input.limit > 0 ? input.limit : messages.length;
  if (messages.length <= limit) return messages;
  const tail = messages.slice(-limit);
  const preserveAssistantText = asText(input.preserveAssistantText);
  if (!preserveAssistantText) return tail;
  if (tail.some((item) => item.role === 'assistant' && item.content === preserveAssistantText)) {
    return tail;
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const item = messages[index];
    if (item?.role === 'assistant' && item.content === preserveAssistantText) {
      return [item, ...messages.slice(Math.max(index + 1, messages.length - (limit - 1)))];
    }
  }
  return tail;
}

export function buildManagedTextTranscript(
  history: AltusManagedHistoryMessage[],
  input: {
    currentInput?: string | null;
    currentMessageType?: string;
    limit?: number;
  } = {}
): AltusManagedTranscriptMessage[] {
  const messages = history
    .filter((item) => isManagedHistoryMessageRelevant({ role: item.role, messageType: item.messageType }))
    .map((item) => {
      const role = normalizeManagedHistoryRole(item.role);
      const content = asText(item.content);
      if (!role || !content) return null;
      return {
        role,
        messageType: asText(item.messageType),
        content,
      };
    })
    .filter((item): item is AltusManagedTranscriptMessage => Boolean(item));

  return trimTranscript(
    appendCurrentInputIfMissing(messages, input.currentInput, input.currentMessageType),
    { limit: input.limit }
  );
}

export function buildManagedClarificationTranscript(
  history: AltusManagedHistoryMessage[],
  input: {
    currentInput?: string | null;
    currentMessageType?: string;
    pendingQuestion?: string | null;
    limit?: number;
  } = {}
): AltusManagedTranscriptMessage[] {
  let messages = buildManagedTextTranscript(history, {
    currentInput: input.currentInput,
    currentMessageType: input.currentMessageType,
  });
  const pendingQuestion = asText(input.pendingQuestion);
  const hasPendingQuestion =
    pendingQuestion && messages.some((item) => item.role === 'assistant' && item.content === pendingQuestion);

  if (pendingQuestion && !hasPendingQuestion) {
    const latestUserIndex = (() => {
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index]?.role === 'user') return index;
      }
      return -1;
    })();
    const pendingMessage: AltusManagedTranscriptMessage = {
      role: 'assistant',
      messageType: 'clarification_request',
      content: pendingQuestion,
    };
    if (latestUserIndex >= 0) {
      messages = [
        ...messages.slice(0, latestUserIndex),
        pendingMessage,
        ...messages.slice(latestUserIndex),
      ];
    } else {
      messages = [...messages, pendingMessage];
    }
  }

  return trimTranscript(messages, {
    limit: input.limit,
    preserveAssistantText: pendingQuestion,
  });
}

export function extractManagedUserTexts(messages: AltusManagedTranscriptMessage[], limit = 8) {
  const texts = messages
    .filter((item) => item.role === 'user')
    .map((item) => item.content)
    .filter(Boolean);
  return limit > 0 ? texts.slice(-limit) : texts;
}
