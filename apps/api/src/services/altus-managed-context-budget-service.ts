import { asText, type ChatMessage } from './altus-managed-shared';
import {
  isOpaqueManagedMcpTool,
  resolveManagedToolDescriptor,
} from './altus-managed-tool-registry';
import { normalizeOpenAiToolCallArguments } from '../utils/openai-chat-sanitizer';

function safeJsonParse(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function truncateMiddle(value: string, headLimit: number, tailLimit: number) {
  if (!value) return '';
  if (value.length <= headLimit + tailLimit + 32) {
    return value;
  }
  return `${value.slice(0, headLimit)}\n...[budgeted]...\n${value.slice(-tailLimit)}`;
}

function summarizeText(value: unknown, headLimit: number, tailLimit: number) {
  return truncateMiddle(asText(value), headLimit, tailLimit);
}

function summarizeReadFile(raw: string) {
  const parsed = safeJsonParse(raw);
  if (!parsed) return raw;
  const content = typeof parsed.content === 'string' ? parsed.content : '';
  if (content.length <= 12000) return raw;
  return JSON.stringify({
    path: asText(parsed.path),
    budgetApplied: true,
    contentSummary: summarizeText(content, 2400, 1200),
    originalChars: content.length,
  });
}

function summarizeShellExecute(raw: string) {
  const parsed = safeJsonParse(raw);
  if (!parsed) return raw;
  const stdout = typeof parsed.stdout === 'string' ? parsed.stdout : '';
  const stderr = typeof parsed.stderr === 'string' ? parsed.stderr : '';
  if (stdout.length <= 5000 && stderr.length <= 2500) return raw;
  const exitCode = Number(parsed.exitCode ?? -1);
  return JSON.stringify({
    cwd: asText(parsed.cwd),
    exitCode,
    budgetApplied: true,
    stdoutSummary: summarizeText(stdout, 1800, 900),
    stderrSummary: summarizeText(stderr, exitCode === 0 ? 800 : 1200, exitCode === 0 ? 400 : 1000),
    stdoutChars: stdout.length,
    stderrChars: stderr.length,
  });
}

function summarizeSearchCode(raw: string) {
  const parsed = safeJsonParse(raw);
  if (!parsed) return raw;
  const output = typeof parsed.output === 'string' ? parsed.output : '';
  const stderr = typeof parsed.stderr === 'string' ? parsed.stderr : '';
  if (output.length <= 5000 && stderr.length <= 1500) return raw;
  return JSON.stringify({
    query: asText(parsed.query),
    path: asText(parsed.path),
    exitCode: Number(parsed.exitCode ?? -1),
    budgetApplied: true,
    outputSummary: summarizeText(output, 1800, 900),
    stderrSummary: summarizeText(stderr, 800, 400),
    outputChars: output.length,
  });
}

function summarizeWebSearch(raw: string) {
  const parsed = safeJsonParse(raw);
  if (!parsed) return raw;
  const results = Array.isArray(parsed.results) ? parsed.results : [];
  if (results.length <= 3 && raw.length <= 5000) return raw;
  return JSON.stringify({
    query: asText(parsed.query),
    topic: asText(parsed.topic),
    requestId: asText(parsed.requestId),
    responseTime: parsed.responseTime,
    budgetApplied: true,
    results: results.slice(0, 3).map((item) => {
      const record = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
      return {
        title: asText(record.title),
        url: asText(record.url),
        content: summarizeText(record.content, 280, 120),
      };
    }),
    imageCount: Array.isArray(parsed.images) ? parsed.images.length : 0,
    totalResultCount: results.length,
  });
}

function summarizeWebExtract(raw: string) {
  const parsed = safeJsonParse(raw);
  if (!parsed) return raw;
  const results = Array.isArray(parsed.results) ? parsed.results : [];
  if (results.length <= 2 && raw.length <= 6000) return raw;
  return JSON.stringify({
    urls: Array.isArray(parsed.urls) ? parsed.urls.slice(0, 4) : [],
    extractDepth: asText(parsed.extractDepth),
    format: asText(parsed.format),
    requestId: asText(parsed.requestId),
    responseTime: parsed.responseTime,
    failedResults: Array.isArray(parsed.failedResults) ? parsed.failedResults.slice(0, 4) : [],
    budgetApplied: true,
    results: results.slice(0, 2).map((item) => {
      const record = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
      return {
        url: asText(record.url),
        rawContent: summarizeText(record.rawContent, 500, 240),
        images: Array.isArray(record.images) ? record.images.slice(0, 3) : [],
      };
    }),
    totalResultCount: results.length,
  });
}

function summarizeOpaqueMcp(raw: string) {
  if (raw.length <= 5000) return raw;
  return JSON.stringify({
    toolFamily: 'mcp',
    budgetApplied: true,
    summary: summarizeText(raw, 1800, 900),
    originalChars: raw.length,
  });
}

function summarizeAssistantWriteFileArguments(raw: string) {
  const parsed = safeJsonParse(raw);
  if (!parsed) return '{}';
  const content = typeof parsed.content === 'string' ? parsed.content : '';
  if (content.length <= 4000) return raw;
  return JSON.stringify({
    path: asText(parsed.path),
    budgetApplied: true,
    contentChars: content.length,
    contentSummary: summarizeText(content, 600, 300),
  });
}

export class AltusManagedContextBudgetService {
  private readonly recentToolWindow = 6;

  private summarizeToolMessage(message: ChatMessage) {
    const toolName = asText(message.name);
    const rawContent = typeof message.content === 'string' ? message.content : '';
    if (!toolName || !rawContent) return message;

    if (isOpaqueManagedMcpTool(toolName)) {
      const content = summarizeOpaqueMcp(rawContent);
      return content === rawContent ? message : { ...message, content };
    }

    const descriptor = resolveManagedToolDescriptor(toolName);
    if (!descriptor || descriptor.budgetHint !== 'large') {
      return message;
    }

    let content = rawContent;
    if (toolName === 'read_file') {
      content = summarizeReadFile(rawContent);
    } else if (toolName === 'shell_execute') {
      content = summarizeShellExecute(rawContent);
    } else if (toolName === 'search_code') {
      content = summarizeSearchCode(rawContent);
    } else if (toolName === 'web_search') {
      content = summarizeWebSearch(rawContent);
    } else if (toolName === 'web_extract') {
      content = summarizeWebExtract(rawContent);
    }

    return content === rawContent ? message : { ...message, content };
  }

  private summarizeAssistantToolCalls(message: ChatMessage) {
    if (message.role !== 'assistant' || !Array.isArray(message.tool_calls) || message.tool_calls.length === 0) {
      return message;
    }

    let changed = false;
    const toolCalls = message.tool_calls.map((toolCall) => {
      const toolName = asText(toolCall?.function?.name);
      const rawArguments = typeof toolCall?.function?.arguments === 'string' ? toolCall.function.arguments : '';
      const normalizedArguments = normalizeOpenAiToolCallArguments(rawArguments);
      const nextArguments =
        toolName === 'write_file'
          ? summarizeAssistantWriteFileArguments(normalizedArguments)
          : normalizedArguments;
      if (nextArguments === rawArguments) {
        return toolCall;
      }
      changed = true;
      return {
        ...toolCall,
        function: {
          ...toolCall.function,
          arguments: nextArguments,
        },
      };
    });

    return changed ? { ...message, tool_calls: toolCalls } : message;
  }

  projectMessagesForModel(messages: ChatMessage[]) {
    const recentToolIndexes = new Set<number>();
    let remainingRecentTools = this.recentToolWindow;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role !== 'tool') continue;
      if (remainingRecentTools > 0) {
        recentToolIndexes.add(index);
        remainingRecentTools -= 1;
      }
    }

    return messages.map((message, index) => {
      if (message.role === 'assistant') {
        return this.summarizeAssistantToolCalls(message);
      }
      if (message.role !== 'tool' || recentToolIndexes.has(index)) {
        return message;
      }
      return this.summarizeToolMessage(message);
    });
  }
}

export const altusManagedContextBudgetService = new AltusManagedContextBudgetService();
