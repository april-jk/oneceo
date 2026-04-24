type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function normalizeOpenAiToolCallArguments(value: unknown): string {
  if (isJsonObject(value)) return JSON.stringify(value);
  const raw = typeof value === 'string' ? value : '';
  if (!raw) return '{}';
  try {
    return isJsonObject(JSON.parse(raw) as unknown) ? raw : '{}';
  } catch {
    return '{}';
  }
}

export function isValidOpenAiToolCallArguments(value: unknown): boolean {
  if (isJsonObject(value)) return true;
  const raw = typeof value === 'string' ? value : '';
  if (!raw) return true;
  try {
    return isJsonObject(JSON.parse(raw) as unknown);
  } catch {
    return false;
  }
}

function sanitizeToolCall(toolCall: unknown) {
  if (!isJsonObject(toolCall)) return toolCall;
  const fn = isJsonObject(toolCall.function) ? toolCall.function : null;
  if (!fn) return toolCall;
  const nextArguments = normalizeOpenAiToolCallArguments(fn.arguments);
  if (nextArguments === fn.arguments) return toolCall;
  return {
    ...toolCall,
    function: {
      ...fn,
      arguments: nextArguments,
    },
  };
}

function sanitizeMessage(message: unknown) {
  if (!isJsonObject(message)) return message;
  let changed = false;
  const nextMessage: JsonObject = { ...message };

  if (Array.isArray(message.tool_calls)) {
    const toolCalls = message.tool_calls.map((toolCall) => {
      const nextToolCall = sanitizeToolCall(toolCall);
      if (nextToolCall !== toolCall) changed = true;
      return nextToolCall;
    });
    if (changed) {
      nextMessage.tool_calls = toolCalls;
    }
  }

  if (isJsonObject(message.function_call)) {
    const nextArguments = normalizeOpenAiToolCallArguments(message.function_call.arguments);
    if (nextArguments !== message.function_call.arguments) {
      nextMessage.function_call = {
        ...message.function_call,
        arguments: nextArguments,
      };
      changed = true;
    }
  }

  return changed ? nextMessage : message;
}

export function sanitizeOpenAiChatCompletionPayload<T>(payload: T): T {
  if (!isJsonObject(payload) || !Array.isArray(payload.messages)) {
    return payload;
  }

  let changed = false;
  const messages = payload.messages.map((message) => {
    const nextMessage = sanitizeMessage(message);
    if (nextMessage !== message) changed = true;
    return nextMessage;
  });

  if (!changed) return payload;
  return {
    ...payload,
    messages,
  };
}
