import { asText } from './altus-managed-shared';
import type { AltusManagedTaskIntentProfile } from './altus-managed-prompt-service';
import type { TaskClarificationType } from './task-intent-shape-service';

export type AltusManagedHistoryMessage = {
  role?: unknown;
  messageType?: unknown;
  content?: unknown;
  metadata?: unknown;
};

export type AltusManagedConversationEntry = {
  role: 'system' | 'user' | 'assistant';
  messageType: string;
  content: string;
  metadata?: unknown;
  source: AltusManagedHistoryMessage;
};

export type AltusManagedTranscriptMessage = {
  role: 'system' | 'user' | 'assistant';
  messageType: string;
  content: string;
};

export type AltusManagedContextProjection = {
  entries: AltusManagedConversationEntry[];
  transcript: AltusManagedTranscriptMessage[];
  clarificationTranscript: AltusManagedTranscriptMessage[];
  userTexts: string[];
  latestUserText: string;
  pendingClarificationType?: TaskClarificationType | null;
  pendingQuestion?: string | null;
  pendingOptions?: string[] | null;
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

export function buildManagedConversationEntries(
  history: AltusManagedHistoryMessage[],
  input: {
    limit?: number;
  } = {}
): AltusManagedConversationEntry[] {
  const limit = input.limit && input.limit > 0 ? input.limit : history.length;
  const entries: AltusManagedConversationEntry[] = [];
  for (const item of history) {
    if (!isManagedHistoryMessageRelevant({ role: item.role, messageType: item.messageType })) {
      continue;
    }
    const role = normalizeManagedHistoryRole(item.role);
    if (!role) continue;
    entries.push({
      role,
      messageType: asText(item.messageType),
      content: asText(item.content),
      metadata: item.metadata,
      source: item,
    });
  }
  return entries.slice(-limit);
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
  const messages = buildManagedConversationEntries(history)
    .map((item) => {
      if (!item.content) return null;
      return {
        role: item.role,
        messageType: item.messageType,
        content: item.content,
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

  if (pendingQuestion) {
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
    const alreadyAdjacent =
      latestUserIndex > 0 &&
      messages[latestUserIndex - 1]?.role === 'assistant' &&
      messages[latestUserIndex - 1]?.content === pendingQuestion;
    if (alreadyAdjacent) {
      // The persisted transcript already has the exact question-answer adjacency.
    } else if (latestUserIndex >= 0) {
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

export function buildManagedTurnStatePrompt(input: {
  currentMessageType?: string;
  pendingClarificationType?: TaskClarificationType | null;
  pendingQuestion?: string | null;
  pendingOptions?: string[] | null;
  taskIntentProfile?: AltusManagedTaskIntentProfile | null;
}) {
  const currentMessageType = asText(input.currentMessageType) || 'user_input';
  const pendingQuestion = asText(input.pendingQuestion);
  const pendingClarificationType = input.pendingClarificationType || null;
  const pendingOptions = Array.isArray(input.pendingOptions)
    ? input.pendingOptions.map((item) => asText(item)).filter(Boolean)
    : [];
  const profile = input.taskIntentProfile || null;

  const lines = [
    '# Current turn state',
    '- This block is runtime state for interpreting the conversation. It is not user-authored content.',
    `- latest_user_message_type: ${currentMessageType}`,
  ];

  if (pendingQuestion) {
    lines.push(
      `- pending_clarification.type: ${pendingClarificationType || 'unknown'}`,
      `- pending_clarification.question: ${pendingQuestion}`,
      ...(pendingOptions.length > 0 ? [`- pending_clarification.options: ${pendingOptions.join(' | ')}`] : []),
      '- Interpret the latest user message against this pending clarification unless it clearly starts a different task.',
      '- If the latest user message answers the pending clarification, continue naturally; do not repeat the same question.'
    );
  } else {
    lines.push('- pending_clarification: none');
  }

  if (profile) {
    lines.push(
      `- task_intent.needs_clarification: ${profile.needsClarification ? 'true' : 'false'}`,
      `- task_intent.clarification_type: ${profile.clarificationType}`,
      `- task_intent.todo_required: ${profile.todoRequired ? 'true' : 'false'}`,
      `- task_intent.deployment_allowed: ${profile.deploymentAllowed ? 'true' : 'false'}`
    );
    if (profile.clarificationTransition) {
      lines.push(
        `- clarification_transition.next_state: ${profile.clarificationTransition.nextState}`,
        ...(profile.clarificationTransition.reason
          ? [`- clarification_transition.reason: ${profile.clarificationTransition.reason}`]
          : []),
        ...(Array.isArray(profile.clarificationTransition.assumptions) &&
        profile.clarificationTransition.assumptions.length > 0
          ? [`- clarification_transition.assumptions: ${profile.clarificationTransition.assumptions.join(' | ')}`]
          : [])
      );
    }
  }

  return lines.join('\n');
}

export class AltusManagedContextService {
  buildProjection(
    history: AltusManagedHistoryMessage[],
    input: {
      currentInput?: string | null;
      currentMessageType?: string;
      pendingClarificationType?: TaskClarificationType | null;
      pendingQuestion?: string | null;
      pendingOptions?: string[] | null;
      entryLimit?: number;
      transcriptLimit?: number;
      clarificationTranscriptLimit?: number;
      userTextLimit?: number;
    } = {}
  ): AltusManagedContextProjection {
    const transcript = buildManagedTextTranscript(history, {
      currentInput: input.currentInput,
      currentMessageType: input.currentMessageType,
      limit: input.transcriptLimit,
    });
    const clarificationTranscript = buildManagedClarificationTranscript(history, {
      currentInput: input.currentInput,
      currentMessageType: input.currentMessageType,
      pendingQuestion: input.pendingQuestion,
      limit: input.clarificationTranscriptLimit,
    });
    const userTexts = extractManagedUserTexts(transcript, input.userTextLimit ?? 8);

    return {
      entries: buildManagedConversationEntries(history, {
        limit: input.entryLimit ?? 24,
      }),
      transcript,
      clarificationTranscript,
      userTexts,
      latestUserText: userTexts[userTexts.length - 1] || '',
      pendingClarificationType: input.pendingClarificationType,
      pendingQuestion: input.pendingQuestion,
      pendingOptions: input.pendingOptions,
    };
  }

  buildTurnStatePrompt(input: Parameters<typeof buildManagedTurnStatePrompt>[0]) {
    return buildManagedTurnStatePrompt(input);
  }
}

export const altusManagedContextService = new AltusManagedContextService();
