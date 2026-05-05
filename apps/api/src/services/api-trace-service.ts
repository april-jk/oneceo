import { randomUUID } from 'node:crypto';
import { sessionApiTraceDAO } from '../db/dao/session-api-trace.dao';

const TRACE_ENABLED = String(process.env.ONECEO_API_TRACE_ENABLED || '').toLowerCase() === 'true';
const MAX_BODY_SIZE = Number(process.env.ONECEO_API_TRACE_MAX_BODY_SIZE || 1048576);

function truncateBody(value: unknown): { json: Record<string, unknown> | null; text: string | null } {
  if (value === undefined || value === null) return { json: null, text: null };

  let text: string;
  try {
    text = JSON.stringify(value);
  } catch {
    text = String(value);
  }

  if (text.length > MAX_BODY_SIZE) {
    text = text.slice(0, MAX_BODY_SIZE) + '\n...[truncated]';
    try {
      return { json: JSON.parse(text) as Record<string, unknown>, text };
    } catch {
      return { json: null, text };
    }
  }

  try {
    return { json: JSON.parse(text) as Record<string, unknown>, text };
  } catch {
    return { json: null, text };
  }
}

function sanitizeHeaders(headers: Record<string, string | string[] | undefined>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey.includes('authorization') || lowerKey.includes('token') || lowerKey.includes('api-key')) {
      result[key] = '[redacted]';
    } else {
      result[key] = value;
    }
  }
  return result;
}

type TraceLlmCallInput = {
  sessionId: string;
  runId?: string | null;
  model?: string | null;
  provider?: string | null;
  endpoint?: string | null;
  requestBody?: unknown;
  requestHeaders?: Record<string, string | string[] | undefined>;
  startedAt: Date;
};

type TraceLlmCallResult = {
  traceId: string;
};

export function traceLlmCallStart(input: TraceLlmCallInput): string | null {
  console.log('[TRACE_DEBUG] traceLlmCallStart called, TRACE_ENABLED=', TRACE_ENABLED);
  if (!TRACE_ENABLED) {
    console.log('[TRACE_DEBUG] trace disabled, skipping');
    return null;
  }

  const traceId = randomUUID();
  const { json: reqJson, text: reqText } = truncateBody(input.requestBody);
  const headers = input.requestHeaders ? sanitizeHeaders(input.requestHeaders) : null;

  // fire-and-forget: do not block the caller
  sessionApiTraceDAO
    .create({
      id: traceId,
      sessionId: input.sessionId,
      runId: input.runId || null,
      traceType: 'llm_request',
      model: input.model || null,
      provider: input.provider || null,
      endpoint: input.endpoint || null,
      requestMethod: 'POST',
      requestHeaders: headers,
      requestBody: reqJson,
      requestBodyText: reqText,
      startedAt: input.startedAt,
    })
    .catch((err) => {
      console.error('[TRACE] llm trace create failed:', err);
    });

  return traceId;
}

export function traceLlmCallComplete(
  traceId: string | null,
  input: {
    responseStatus: number;
    responseBody?: unknown;
    responseHeaders?: Record<string, string | string[] | undefined>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
      prompt_tokens_details?: { cached_tokens?: number; cache_creation_input_tokens?: number };
      cached_tokens?: number;
      cache_creation_input_tokens?: number;
    };
    completedAt: Date;
    errorMessage?: string | null;
  }
): void {
  if (!TRACE_ENABLED || !traceId) return;

  const { json: resJson, text: resText } = truncateBody(input.responseBody);
  const headers = input.responseHeaders ? sanitizeHeaders(input.responseHeaders) : null;

  const completionTokens = input.usage?.completion_tokens ?? 0;
  const promptTokens =
    input.usage?.prompt_tokens ??
    (input.usage?.total_tokens ? input.usage.total_tokens - completionTokens : 0);
  const totalTokens = input.usage?.total_tokens ?? promptTokens + completionTokens;
  const cachedPromptTokens =
    input.usage?.prompt_tokens_details?.cached_tokens ??
    input.usage?.cached_tokens ??
    0;
  const cacheCreationTokens =
    input.usage?.prompt_tokens_details?.cache_creation_input_tokens ??
    input.usage?.cache_creation_input_tokens ??
    0;

  // fire-and-forget: do not block the caller
  sessionApiTraceDAO
    .updateById(traceId, {
      responseStatus: input.responseStatus,
      responseHeaders: headers,
      responseBody: resJson,
      responseBodyText: resText,
      promptTokens,
      completionTokens,
      totalTokens,
      cachedPromptTokens,
      cacheCreationTokens,
      completedAt: input.completedAt,
      errorMessage: input.errorMessage || null,
    })
    .catch((err) => {
      console.error('[TRACE] llm trace complete (update) failed:', err);
    });
}

type TraceToolCallInput = {
  sessionId: string;
  runId?: string | null;
  toolName: string;
  arguments?: Record<string, unknown>;
  startedAt: Date;
};

export function traceToolCallStart(input: TraceToolCallInput): string | null {
  if (!TRACE_ENABLED) return null;

  const traceId = randomUUID();
  const { json: reqJson, text: reqText } = truncateBody(input.arguments);

  sessionApiTraceDAO
    .create({
      id: traceId,
      sessionId: input.sessionId,
      runId: input.runId || null,
      traceType: 'tool_call',
      toolName: input.toolName,
      requestMethod: 'POST',
      requestBody: reqJson,
      requestBodyText: reqText,
      startedAt: input.startedAt,
    })
    .catch((err) => {
      console.error('[TRACE] tool call trace create failed:', err);
    });

  return traceId;
}

export function traceToolCallComplete(
  traceId: string | null,
  input: {
    responseBody?: unknown;
    completedAt: Date;
    errorMessage?: string | null;
    durationMs?: number;
  }
): void {
  if (!TRACE_ENABLED || !traceId) return;

  const { json: resJson, text: resText } = truncateBody(input.responseBody);

  sessionApiTraceDAO
    .updateById(traceId, {
      responseBody: resJson,
      responseBodyText: resText,
      durationMs: input.durationMs || null,
      completedAt: input.completedAt,
      errorMessage: input.errorMessage || null,
    })
    .catch((err) => {
      console.error('[TRACE] tool call trace complete failed:', err);
    });
}

type TraceServiceCallInput = {
  sessionId?: string | null;
  runId?: string | null;
  serviceName: string;
  endpoint?: string | null;
  requestMethod?: string | null;
  requestBody?: unknown;
  startedAt: Date;
};

export function traceServiceCallStart(input: TraceServiceCallInput): string | null {
  if (!TRACE_ENABLED) return null;

  const traceId = randomUUID();
  const { json: reqJson, text: reqText } = truncateBody(input.requestBody);

  sessionApiTraceDAO
    .create({
      id: traceId,
      sessionId: input.sessionId || 'unknown',
      runId: input.runId || null,
      traceType: 'service_api',
      serviceName: input.serviceName,
      endpoint: input.endpoint || null,
      requestMethod: input.requestMethod || 'POST',
      requestBody: reqJson,
      requestBodyText: reqText,
      startedAt: input.startedAt,
    })
    .catch((err) => {
      console.error('[TRACE] service call trace create failed:', err);
    });

  return traceId;
}

export function traceServiceCallComplete(
  traceId: string | null,
  input: {
    responseStatus?: number;
    responseBody?: unknown;
    completedAt: Date;
    errorMessage?: string | null;
    durationMs?: number;
  }
): void {
  if (!TRACE_ENABLED || !traceId) return;

  const { json: resJson, text: resText } = truncateBody(input.responseBody);

  sessionApiTraceDAO
    .updateById(traceId, {
      responseStatus: input.responseStatus || null,
      responseBody: resJson,
      responseBodyText: resText,
      durationMs: input.durationMs || null,
      completedAt: input.completedAt,
      errorMessage: input.errorMessage || null,
    })
    .catch((err) => {
      console.error('[TRACE] service call trace complete failed:', err);
    });
}
