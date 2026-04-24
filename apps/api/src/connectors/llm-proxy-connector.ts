import { getPublicErrorMessage } from '../utils/error-response';
import * as http from 'node:http';
import * as https from 'node:https';
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';
import { sanitizeOpenAiChatCompletionPayload } from '../utils/openai-chat-sanitizer';

type ProxyConfig = {
  upstreamBaseUrl: string;
  upstreamToken?: string | null;
  upstreamApiType: 'openai' | 'anthropic';
  timeoutMs: number;
  maxRetries: number;
  retryDelayMs: number;
  retryJitterMs: number;
};

type OpenAiChatCompletionRequest = {
  model?: string;
  messages?: Array<{
    role?: string;
    content?:
      | string
      | Array<
          | { type?: 'text'; text?: string }
          | { type?: 'image_url' | 'input_image'; image_url?: { url?: string } }
        >;
    name?: string;
    tool_call_id?: string;
    tool_calls?: Array<{
      id?: string;
      type?: string;
      function?: {
        name?: string;
        arguments?: string;
      };
    }>;
  }>;
  tools?: Array<{
    type?: string;
    function?: {
      name?: string;
      description?: string;
      parameters?: Record<string, unknown>;
    };
  }>;
  tool_choice?: 'auto' | 'none' | { type?: string; function?: { name?: string } };
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
};

type AnthropicMessageRequest = {
  model: string;
  system?: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content:
      | string
      | Array<
          | { type: 'text'; text: string }
          | {
              type: 'image';
              source:
                | {
                    type: 'base64';
                    media_type: string;
                    data: string;
                  }
                | {
                    type: 'url';
                    url: string;
                  };
            }
          | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
          | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
        >;
  }>;
  tools?: Array<{
    name: string;
    description?: string;
    input_schema: Record<string, unknown>;
  }>;
  tool_choice?: { type: 'auto' | 'none' | 'tool'; name?: string };
  max_tokens: number;
  temperature?: number;
};

type AnthropicMessageResponse = {
  id?: string;
  model?: string;
  content?: Array<{
    type?: string;
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  stop_reason?: string | null;
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
};

type AnthropicStreamEvent = {
  event: string;
  data: any;
};

type OpenAiStreamChunk = {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: Record<string, unknown>;
    finish_reason: string | null;
  }>;
};

type AnthropicStreamState = {
  id: string;
  model: string;
  created: number;
  roleSent: boolean;
  toolIndexes: Map<number, number>;
};

function toNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const upstreamMaxSockets = Math.max(1, Math.floor(toNumber(process.env.LLM_PROXY_MAX_SOCKETS, 128)));
const upstreamMaxFreeSockets = Math.max(1, Math.floor(toNumber(process.env.LLM_PROXY_MAX_FREE_SOCKETS, 32)));
const httpKeepAliveAgent = new http.Agent({
  keepAlive: true,
  maxSockets: upstreamMaxSockets,
  maxFreeSockets: upstreamMaxFreeSockets,
});
const httpsKeepAliveAgent = new https.Agent({
  keepAlive: true,
  maxSockets: upstreamMaxSockets,
  maxFreeSockets: upstreamMaxFreeSockets,
});

function loadConfig(): ProxyConfig {
  const upstreamBaseUrl = process.env.LLM_PROXY_UPSTREAM_BASE_URL || '';
  if (!upstreamBaseUrl) {
    throw new Error('LLM_PROXY_UPSTREAM_BASE_URL is not configured');
  }
  const apiTypeRaw = String(process.env.LLM_PROXY_UPSTREAM_API_TYPE || 'openai').trim().toLowerCase();
  const upstreamApiType = apiTypeRaw === 'anthropic' ? 'anthropic' : 'openai';
  return {
    upstreamBaseUrl: upstreamBaseUrl.replace(/\/+$/, ''),
    upstreamToken: process.env.LLM_PROXY_UPSTREAM_API_KEY || null,
    upstreamApiType,
    timeoutMs: Number(process.env.LLM_PROXY_TIMEOUT_MS || 60000),
    maxRetries: Math.max(0, Number(process.env.LLM_PROXY_RETRIES || 1)),
    retryDelayMs: Math.max(0, Number(process.env.LLM_PROXY_RETRY_DELAY_MS || 250)),
    retryJitterMs: Math.max(0, Number(process.env.LLM_PROXY_RETRY_JITTER_MS || 120)),
  };
}

function buildUpstreamUrl(base: string, path: string, query: string) {
  const normalizedBase = base.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (normalizedBase.endsWith('/v1') && normalizedPath.startsWith('/v1/')) {
    return `${normalizedBase}${normalizedPath.slice(3)}${query || ''}`;
  }
  return `${normalizedBase}${normalizedPath}${query || ''}`;
}

function toOpenAiError(message: string, type: string, code: string) {
  return {
    error: {
      message,
      type,
      code,
    },
  };
}

function copyResponseHeaders(res: any, headers: IncomingHttpHeaders) {
  const contentType = typeof headers['content-type'] === 'string' ? headers['content-type'] : 'application/json';
  res.setHeader('content-type', contentType);

  const cacheControl = headers['cache-control'];
  if (typeof cacheControl === 'string') {
    res.setHeader('cache-control', cacheControl);
  }
}

function isStreamContentType(headers: IncomingHttpHeaders) {
  const contentType = typeof headers['content-type'] === 'string' ? headers['content-type'] : '';
  return contentType.includes('text/event-stream');
}

function isTimeoutError(error: any) {
  return error?.code === 'UPSTREAM_TIMEOUT' || error?.name === 'AbortError';
}

function createTimeoutError() {
  const error = new Error('Upstream timeout');
  (error as any).code = 'UPSTREAM_TIMEOUT';
  return error;
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

function parseRetryAfterMs(headers: IncomingHttpHeaders): number {
  const value = headers['retry-after'];
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return 0;

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.max(0, Math.floor(seconds * 1000));
  }

  const dateMs = Date.parse(String(raw));
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }

  return 0;
}

function toSseData(value: unknown) {
  return `data: ${JSON.stringify(value)}\n\n`;
}

function createChunk(
  state: AnthropicStreamState,
  delta: Record<string, unknown>,
  finishReason: string | null = null
): OpenAiStreamChunk {
  return {
    id: state.id,
    object: 'chat.completion.chunk',
    created: state.created,
    model: state.model,
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finishReason,
      },
    ],
  };
}

async function readResponseBody(response: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of response) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function delay(ms: number) {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function computeRetryDelayMs(attempt: number, retryDelayMs: number, retryJitterMs: number) {
  const base = Math.max(0, retryDelayMs * Math.max(1, attempt));
  if (retryJitterMs <= 0) {
    return base;
  }
  return base + Math.floor(Math.random() * (retryJitterMs + 1));
}

function getHeaderValue(headers: IncomingHttpHeaders | Record<string, string>, key: string) {
  const direct = (headers as Record<string, string | string[] | undefined>)[key];
  if (typeof direct === 'string') return direct;
  if (Array.isArray(direct) && direct[0]) return direct[0];
  const lower = (headers as Record<string, string | string[] | undefined>)[key.toLowerCase()];
  if (typeof lower === 'string') return lower;
  if (Array.isArray(lower) && lower[0]) return lower[0];
  return null;
}

function parseJsonBody<T>(body: unknown): T {
  if (Buffer.isBuffer(body)) {
    return JSON.parse(body.toString('utf-8')) as T;
  }
  if (typeof body === 'string') {
    return JSON.parse(body) as T;
  }
  if (body && typeof body === 'object') {
    return body as T;
  }
  throw new Error('Invalid JSON body');
}

export function sanitizeOpenAiChatCompletionProxyBody(path: string, body: unknown): unknown {
  if (path !== '/v1/chat/completions') return body;
  try {
    const payload = parseJsonBody<OpenAiChatCompletionRequest>(body);
    const sanitizedPayload = sanitizeOpenAiChatCompletionPayload(payload);
    return sanitizedPayload === payload ? body : Buffer.from(JSON.stringify(sanitizedPayload), 'utf-8');
  } catch {
    return body;
  }
}

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .map((item) => {
      if (typeof item === 'string') return item;
      if (!item || typeof item !== 'object') return '';
      const typedItem = item as { type?: string; text?: string };
      return typedItem.type === 'text' && typeof typedItem.text === 'string' ? typedItem.text : '';
    })
    .filter(Boolean)
    .join('\n');
}

function normalizeImageSource(url: string) {
  const normalized = url.trim();
  if (!normalized) return null;
  const match = /^data:([^;,]+);base64,([\s\S]+)$/i.exec(normalized);
  if (match) {
    const mediaType = String(match[1] || '').trim().toLowerCase();
    const data = String(match[2] || '').replace(/\s+/g, '');
    if (!mediaType || !data) return null;
    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mediaType)) {
      return null;
    }
    return {
      type: 'base64' as const,
      media_type: mediaType,
      data,
    };
  }
  if (/^https?:\/\//i.test(normalized)) {
    return {
      type: 'url' as const,
      url: normalized,
    };
  }
  return null;
}

function normalizeAnthropicUserContent(
  content: NonNullable<OpenAiChatCompletionRequest['messages']>[number]['content']
): AnthropicMessageRequest['messages'][number]['content'] | null {
  if (typeof content === 'string') {
    const text = content.trim();
    return text ? text : null;
  }
  if (!Array.isArray(content)) {
    return null;
  }

  const parts: Array<
    | { type: 'text'; text: string }
    | {
        type: 'image';
        source:
          | { type: 'base64'; media_type: string; data: string }
          | { type: 'url'; url: string };
      }
  > = [];

  for (const item of content) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    if (item.type === 'text' && typeof item.text === 'string' && item.text.trim()) {
      parts.push({
        type: 'text',
        text: item.text.trim(),
      });
      continue;
    }
    if ((item.type === 'image_url' || item.type === 'input_image') && typeof item.image_url?.url === 'string') {
      const source = normalizeImageSource(item.image_url.url);
      if (!source) continue;
      parts.push({
        type: 'image',
        source,
      });
    }
  }

  if (parts.length === 0) return null;
  if (parts.length === 1 && parts[0].type === 'text') {
    return parts[0].text;
  }
  return parts;
}

function tryParseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function detectToolError(content: string) {
  const parsed = tryParseJsonObject(content);
  return Boolean(parsed && typeof parsed.error === 'string' && Object.keys(parsed).length === 1);
}

function normalizeOpenAiTools(payload: OpenAiChatCompletionRequest) {
  if (!Array.isArray(payload.tools)) return undefined;
  const tools = payload.tools
    .map((tool) => {
      if (tool?.type !== 'function' || !tool.function?.name) return null;
      return {
        name: String(tool.function.name).trim(),
        description: typeof tool.function.description === 'string' ? tool.function.description : undefined,
        input_schema:
          tool.function.parameters && typeof tool.function.parameters === 'object'
            ? (tool.function.parameters as Record<string, unknown>)
            : {
                type: 'object',
                properties: {},
                required: [],
                additionalProperties: false,
              },
      };
    })
    .filter(Boolean) as Array<{
    name: string;
    description?: string;
    input_schema: Record<string, unknown>;
  }>;
  return tools.length > 0 ? tools : undefined;
}

function normalizeToolChoice(
  toolChoice: OpenAiChatCompletionRequest['tool_choice']
): AnthropicMessageRequest['tool_choice'] | undefined {
  if (!toolChoice || toolChoice === 'auto') {
    return { type: 'auto' };
  }
  if (toolChoice === 'none') {
    return { type: 'none' };
  }
  const toolName = typeof toolChoice === 'object' ? String(toolChoice.function?.name || '').trim() : '';
  if (!toolName) {
    return { type: 'auto' };
  }
  return {
    type: 'tool',
    name: toolName,
  };
}

export function toAnthropicRequest(payload: OpenAiChatCompletionRequest): AnthropicMessageRequest {
  payload = sanitizeOpenAiChatCompletionPayload(payload);
  const model = String(payload.model || '').trim();
  if (!model) {
    throw new Error('Missing model');
  }

  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const system = messages
    .filter((message) => message?.role === 'system')
    .map((message) => extractTextContent(message.content))
    .filter(Boolean)
    .join('\n\n')
    .trim();

  const normalizedMessages: AnthropicMessageRequest['messages'] = [];
  let pendingToolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }> = [];

  const flushPendingToolResults = () => {
    if (pendingToolResults.length === 0) return;
    normalizedMessages.push({
      role: 'user',
      content: pendingToolResults,
    });
    pendingToolResults = [];
  };

  for (const message of messages) {
    if (!message) continue;
    if (message.role === 'system') continue;

    if (message.role === 'tool') {
      const toolUseId = String(message.tool_call_id || '').trim();
      if (!toolUseId) continue;
      const content = extractTextContent(message.content);
      pendingToolResults.push({
        type: 'tool_result',
        tool_use_id: toolUseId,
        content,
        ...(detectToolError(content) ? { is_error: true } : {}),
      });
      continue;
    }

    flushPendingToolResults();

    if (message.role !== 'user' && message.role !== 'assistant') continue;
    const text = extractTextContent(message.content);

    if (message.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      const contentBlocks: Array<
        { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
      > = [];
      if (text) {
        contentBlocks.push({ type: 'text', text });
      }
      for (const toolCall of message.tool_calls) {
        const toolName = String(toolCall?.function?.name || '').trim();
        const toolId = String(toolCall?.id || '').trim();
        if (!toolName || !toolId) continue;
        contentBlocks.push({
          type: 'tool_use',
          id: toolId,
          name: toolName,
          input: tryParseJsonObject(String(toolCall?.function?.arguments || '')) || {},
        });
      }
      if (contentBlocks.length > 0) {
        normalizedMessages.push({
          role: 'assistant',
          content: contentBlocks,
        });
      }
      continue;
    }

    if (message.role === 'assistant') {
      if (!text) continue;
      normalizedMessages.push({
        role: 'assistant',
        content: text,
      });
      continue;
    }

    const normalizedUserContent = normalizeAnthropicUserContent(message.content);
    if (!normalizedUserContent) continue;
    normalizedMessages.push({
      role: 'user',
      content: normalizedUserContent,
    });
  }

  flushPendingToolResults();

  if (normalizedMessages.length === 0) {
    throw new Error('Missing messages');
  }

  return {
    model,
    ...(system ? { system } : {}),
    messages: normalizedMessages,
    ...(normalizeOpenAiTools(payload) ? { tools: normalizeOpenAiTools(payload) } : {}),
    ...(normalizeOpenAiTools(payload) ? { tool_choice: normalizeToolChoice(payload.tool_choice) } : {}),
    max_tokens: Math.max(1, Number(payload.max_tokens || 1024)),
    ...(typeof payload.temperature === 'number' ? { temperature: payload.temperature } : {}),
  };
}

function normalizeFinishReason(stopReason: string | null | undefined) {
  if (stopReason === 'max_tokens') return 'length';
  if (stopReason === 'tool_use') return 'tool_calls';
  return 'stop';
}

export function toOpenAiChatCompletion(response: AnthropicMessageResponse) {
  const contentBlocks = Array.isArray(response.content) ? response.content : [];
  const outputText = contentBlocks
    .filter((item) => item?.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text as string)
    .join('\n');
  const toolCalls = contentBlocks
    .filter((item) => item?.type === 'tool_use' && typeof item.id === 'string' && typeof item.name === 'string')
    .map((item) => ({
      id: String(item.id),
      type: 'function' as const,
      function: {
        name: String(item.name),
        arguments: JSON.stringify(item.input && typeof item.input === 'object' ? item.input : {}),
      },
    }));
  const promptTokens = Number(response.usage?.input_tokens || 0);
  const completionTokens = Number(response.usage?.output_tokens || 0);
  return {
    id: response.id || `chatcmpl_${Date.now()}`,
    object: 'chat.completion',
    model: response.model || '',
    choices: [
      {
        index: 0,
        finish_reason: normalizeFinishReason(response.stop_reason),
        message: {
          role: 'assistant',
          content: outputText,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
}

function parseAnthropicSseBlock(rawBlock: string): AnthropicStreamEvent | null {
  const lines = rawBlock
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
  if (lines.length === 0) return null;

  let eventName = 'message';
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim();
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
    }
  }
  if (dataLines.length === 0) return null;
  const rawData = dataLines.join('\n');
  if (rawData === '[DONE]') {
    return { event: eventName, data: '[DONE]' };
  }
  try {
    return {
      event: eventName,
      data: JSON.parse(rawData),
    };
  } catch {
    return null;
  }
}

export function transformAnthropicStreamEvent(
  streamEvent: AnthropicStreamEvent,
  state: AnthropicStreamState
): string[] {
  const outputs: string[] = [];
  const payload = streamEvent.data;
  if (!payload || typeof payload !== 'object') {
    return outputs;
  }

  if (streamEvent.event === 'ping') {
    return outputs;
  }

  if (streamEvent.event === 'message_start') {
    const message = payload.message || {};
    state.id = String(message.id || state.id || `chatcmpl_${Date.now()}`);
    state.model = String(message.model || state.model || '');
    if (!state.roleSent) {
      outputs.push(toSseData(createChunk(state, { role: 'assistant' }, null)));
      state.roleSent = true;
    }
    return outputs;
  }

  if (streamEvent.event === 'content_block_start') {
    const index = Number(payload.index);
    const block = payload.content_block || {};
    const blockType = String(block.type || '');
    if (blockType === 'tool_use') {
      const openAiToolIndex = state.toolIndexes.size;
      state.toolIndexes.set(index, openAiToolIndex);
      outputs.push(
        toSseData(
          createChunk(
            state,
            {
              tool_calls: [
                {
                  index: openAiToolIndex,
                  id: String(block.id || ''),
                  type: 'function',
                  function: {
                    name: String(block.name || ''),
                    arguments: '',
                  },
                },
              ],
            },
            null
          )
        )
      );
    }
    return outputs;
  }

  if (streamEvent.event === 'content_block_delta') {
    const index = Number(payload.index);
    const delta = payload.delta || {};
    const deltaType = String(delta.type || '');
    if (deltaType === 'text_delta' && typeof delta.text === 'string') {
      outputs.push(toSseData(createChunk(state, { content: delta.text }, null)));
      return outputs;
    }
    if (deltaType === 'input_json_delta' && typeof delta.partial_json === 'string') {
      const openAiToolIndex = state.toolIndexes.get(index);
      if (typeof openAiToolIndex === 'number') {
        outputs.push(
          toSseData(
            createChunk(
              state,
              {
                tool_calls: [
                  {
                    index: openAiToolIndex,
                    function: {
                      arguments: delta.partial_json,
                    },
                  },
                ],
              },
              null
            )
          )
        );
      }
      return outputs;
    }
    return outputs;
  }

  if (streamEvent.event === 'message_delta') {
    const stopReason = normalizeFinishReason(String(payload.delta?.stop_reason || ''));
    outputs.push(toSseData(createChunk(state, {}, stopReason)));
    return outputs;
  }

  if (streamEvent.event === 'message_stop') {
    outputs.push('data: [DONE]\n\n');
    return outputs;
  }

  if (streamEvent.event === 'error') {
    const message =
      payload?.error?.message ||
      payload?.message ||
      'Upstream stream error';
    outputs.push(
      toSseData(
        toOpenAiError(getPublicErrorMessage(String(message)), payload?.error?.type || 'upstream_error', payload?.error?.code || 'upstream_error')
      )
    );
    outputs.push('data: [DONE]\n\n');
    return outputs;
  }

  return outputs;
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  config: ProxyConfig
): Promise<Response> {
  let lastError: unknown = null;
  const maxAttempts = Math.max(1, config.maxRetries + 1);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(createTimeoutError()), config.timeoutMs);
    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });
      if (attempt < maxAttempts && isRetryableStatus(response.status)) {
        const retryAfterMs = response.status === 429 ? parseRetryAfterMs(Object.fromEntries(response.headers.entries())) : 0;
        await delay(Math.max(computeRetryDelayMs(attempt, config.retryDelayMs, config.retryJitterMs), retryAfterMs));
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isTimeoutError(error)) {
        throw error;
      }
      await delay(computeRetryDelayMs(attempt, config.retryDelayMs, config.retryJitterMs));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw (lastError instanceof Error ? lastError : new Error(String(lastError || 'upstream_error')));
}

export class LlmProxyConnector {
  private async forwardAnthropicChat(req: any, res: any, config: ProxyConfig, debug: boolean) {
    const requestPayload = parseJsonBody<OpenAiChatCompletionRequest>(req.body);
    const anthropicPayload = toAnthropicRequest(requestPayload);
    const upstreamUrl = buildUpstreamUrl(config.upstreamBaseUrl, '/v1/messages', '');
    const response = await fetchWithRetry(
      upstreamUrl,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': config.upstreamToken || '',
          'anthropic-version': '2023-06-01',
          'accept-encoding': 'identity',
        },
        body: JSON.stringify({
          ...anthropicPayload,
          ...(requestPayload.stream ? { stream: true } : {}),
        }),
      },
      config
    );

    const responseContentType = response.headers.get('content-type') || '';

    if (requestPayload.stream) {
      if (debug) {
        console.log('[LLM_PROXY_ANTHROPIC_STATUS]', JSON.stringify({
          method: req.method,
          path: req.path,
          upstreamUrl,
          status: response.status,
          stream: true,
        }));
      }

      if (!response.ok) {
        const responseText = await response.text().catch(() => '');
        let responseJson: AnthropicMessageResponse | null = null;
        try {
          responseJson = responseText ? (JSON.parse(responseText) as AnthropicMessageResponse) : null;
        } catch {
          responseJson = null;
        }
        const message =
          responseJson?.error?.message ||
          responseText ||
          `Upstream request failed with status ${response.status}`;
        res
          .status(response.status)
          .json(
            toOpenAiError(
              getPublicErrorMessage(message),
              responseJson?.error?.type || 'upstream_error',
              responseJson?.error?.code || 'upstream_error'
            )
          );
        return;
      }

      if (!responseContentType.includes('text/event-stream') || !response.body) {
        res
          .status(502)
          .json(toOpenAiError('Anthropic upstream did not return event stream', 'upstream_error', 'upstream_error'));
        return;
      }

      res.setHeader('content-type', 'text/event-stream; charset=utf-8');
      res.setHeader('cache-control', 'no-cache, no-transform');
      res.setHeader('connection', 'keep-alive');
      res.flushHeaders?.();

      const state: AnthropicStreamState = {
        id: `chatcmpl_${Date.now()}`,
        model: String(requestPayload.model || ''),
        created: Math.floor(Date.now() / 1000),
        roleSent: false,
        toolIndexes: new Map<number, number>(),
      };

      const decoder = new TextDecoder();
      let buffer = '';
      for await (const chunk of response.body as any) {
        buffer += decoder.decode(chunk, { stream: true });
        while (true) {
          const separatorIndex = buffer.indexOf('\n\n');
          if (separatorIndex < 0) break;
          const rawBlock = buffer.slice(0, separatorIndex);
          buffer = buffer.slice(separatorIndex + 2);
          const parsed = parseAnthropicSseBlock(rawBlock);
          if (!parsed) continue;
          const outputs = transformAnthropicStreamEvent(parsed, state);
          for (const output of outputs) {
            if (!res.writableEnded) {
              res.write(output);
            }
          }
        }
      }
      if (buffer.trim()) {
        const parsed = parseAnthropicSseBlock(buffer.trim());
        if (parsed) {
          const outputs = transformAnthropicStreamEvent(parsed, state);
          for (const output of outputs) {
            if (!res.writableEnded) {
              res.write(output);
            }
          }
        }
      }
      if (!res.writableEnded) {
        res.end();
      }
      return;
    }

    const responseText = await response.text();
    let responseJson: AnthropicMessageResponse | null = null;
    try {
      responseJson = responseText ? (JSON.parse(responseText) as AnthropicMessageResponse) : null;
    } catch {
      responseJson = null;
    }

    if (debug) {
      console.log('[LLM_PROXY_ANTHROPIC_STATUS]', JSON.stringify({
        method: req.method,
        path: req.path,
        upstreamUrl,
        status: response.status,
      }));
    }

    if (!response.ok) {
      const message =
        responseJson?.error?.message ||
        responseText ||
        `Upstream request failed with status ${response.status}`;
      res
        .status(response.status)
        .json(
          toOpenAiError(
            getPublicErrorMessage(message),
            responseJson?.error?.type || 'upstream_error',
            responseJson?.error?.code || 'upstream_error'
          )
        );
      return;
    }

    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.status(200).json(toOpenAiChatCompletion(responseJson || {}));
  }

  async forward(req: any, res: any) {
    let config: ProxyConfig;
    let upstreamUrl = '';
    const debug = String(process.env.LLM_PROXY_DEBUG || '').toLowerCase() === 'true';
    try {
      config = loadConfig();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'LLM 代理未配置';
      res.status(500).json(toOpenAiError(getPublicErrorMessage(message), 'config_error', 'config_error'));
      return;
    }

    try {
      if (config.upstreamApiType === 'anthropic' && req.path === '/v1/chat/completions') {
        await this.forwardAnthropicChat(req, res, config, debug);
        return;
      }
      if (config.upstreamApiType === 'anthropic' && req.path !== '/v1/models') {
        res.status(400).json(
          toOpenAiError(
            `Anthropic upstream does not support proxied path ${req.path}`,
            'unsupported',
            'unsupported'
          )
        );
        return;
      }

      upstreamUrl = buildUpstreamUrl(
        config.upstreamBaseUrl,
        req.path,
        req.url?.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''
      );

      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.headers || {})) {
        if (!value) continue;
        if (key.toLowerCase() === 'host') continue;
        if (key.toLowerCase() === 'content-length') continue;
        headers[key] = Array.isArray(value) ? value.join(',') : String(value);
      }
      // Keep upstream response body readable for downstream callers (curl/opencode).
      headers['accept-encoding'] = 'identity';
      if (config.upstreamToken) {
        headers['Authorization'] = `Bearer ${config.upstreamToken}`;
      }
      const requestId = getHeaderValue(headers, 'x-request-id');
      if (requestId) {
        headers['x-request-id'] = requestId;
      }

      const targetUrl = new URL(upstreamUrl);
      const client = targetUrl.protocol === 'https:' ? https : http;
      const requestHeaders: Record<string, string> = { ...headers };
      if (!requestHeaders.connection) {
        requestHeaders.connection = 'keep-alive';
      }
      const requestBody = sanitizeOpenAiChatCompletionProxyBody(req.path, req.body);

      let finalResponse: IncomingMessage | null = null;
      let finalError: unknown = null;
      const maxAttempts = Math.max(1, config.maxRetries + 1);
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        let upstreamResponse: IncomingMessage | null = null;
        let upstreamRequest: http.ClientRequest | null = null;
        const requestTimeout = setTimeout(() => {
          const timeoutError = createTimeoutError();
          upstreamRequest?.destroy(timeoutError);
          upstreamResponse?.destroy(timeoutError);
        }, config.timeoutMs);

        try {
          upstreamResponse = await new Promise<IncomingMessage>((resolve, reject) => {
            upstreamRequest = client.request(
              {
                protocol: targetUrl.protocol,
                hostname: targetUrl.hostname,
                port: targetUrl.port || undefined,
                path: `${targetUrl.pathname}${targetUrl.search}`,
                method: req.method,
                headers: requestHeaders,
                agent: targetUrl.protocol === 'https:' ? httpsKeepAliveAgent : httpKeepAliveAgent,
              },
              (response) => resolve(response)
            );

            upstreamRequest.on('error', (error) => reject(error));

            if (req.method !== 'GET' && req.method !== 'HEAD' && requestBody !== undefined) {
              upstreamRequest.write(requestBody);
            }

            upstreamRequest.end();
          });

          const status = upstreamResponse.statusCode || 502;
          if (debug) {
            console.log('[LLM_PROXY_UPSTREAM_STATUS]', JSON.stringify({
              method: req.method,
              path: req.path,
              upstreamUrl,
              attempt,
              status,
            }));
          }

          if (attempt < maxAttempts && isRetryableStatus(status)) {
            const retryAfterMs = status === 429 ? parseRetryAfterMs(upstreamResponse.headers) : 0;
            const waitMs = Math.max(
              computeRetryDelayMs(attempt, config.retryDelayMs, config.retryJitterMs),
              retryAfterMs
            );
            upstreamResponse.resume();
            await delay(waitMs);
            continue;
          }

          finalResponse = upstreamResponse;
          break;
        } catch (error) {
          finalError = error;
          if (attempt >= maxAttempts || !isTimeoutError(error)) {
            break;
          }
          await delay(computeRetryDelayMs(attempt, config.retryDelayMs, config.retryJitterMs));
        } finally {
          clearTimeout(requestTimeout);
        }
      }

      if (!finalResponse) {
        throw (finalError instanceof Error ? finalError : new Error(String(finalError || 'upstream_error')));
      }

      res.status(finalResponse.statusCode || 502);
      copyResponseHeaders(res, finalResponse.headers);

      if (isStreamContentType(finalResponse.headers)) {
        await new Promise<void>((resolve, reject) => {
          finalResponse!.on('error', reject);
          res.on('error', reject);
          res.on('finish', resolve);
          res.on('close', resolve);
          finalResponse!.pipe(res);
        });
        return;
      }

      const buffer = await readResponseBody(finalResponse);
      res.send(buffer);
    } catch (error: any) {
      if (debug) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorCause = (error as any)?.cause;
        console.error('[LLM_PROXY_ERROR]', JSON.stringify({
          method: req.method,
          path: req.path,
          upstreamUrl,
          error: errorMessage,
          cause: errorCause instanceof Error ? errorCause.message : errorCause ? String(errorCause) : null,
        }));
      }
      if (isTimeoutError(error)) {
        res.status(504).json(toOpenAiError('Upstream timeout', 'upstream_timeout', 'upstream_timeout'));
        return;
      }
      res.status(503).json(toOpenAiError('Upstream unavailable', 'upstream_unavailable', 'upstream_unavailable'));
    }
  }
}

export const llmProxyConnector = new LlmProxyConnector();
