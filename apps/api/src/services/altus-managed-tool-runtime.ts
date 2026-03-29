import path from 'node:path';
import { e2bConnector } from '../connectors/e2b-connector';
import { tavilyConnector } from '../connectors/tavily-connector';
import type { ManagedCompletionAttachment } from './altus-managed-shared';

type ManagedToolResult =
  | { type: 'result'; content: string }
  | { type: 'ask_user'; question: string; options?: string[] }
  | { type: 'complete'; summary: string; verification?: string[]; attachments?: ManagedCompletionAttachment[] };

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asPositiveInt(value: unknown, fallback: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(max, Math.floor(parsed));
}

function asPositiveNumber(value: unknown, fallback: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(max, parsed);
}

function asBoolean(value: unknown) {
  if (typeof value === 'boolean') return value;
  const text = asText(value).toLowerCase();
  if (!text) return false;
  return ['1', 'true', 'yes', 'on'].includes(text);
}

function asStringArray(value: unknown, maxItems: number) {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const item of value) {
    const text = asText(item);
    if (!text) continue;
    result.push(text);
    if (result.length >= maxItems) break;
  }
  return result;
}

function shellEscape(value: string): string {
  if (!value) return "''";
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function truncate(value: string, limit = 16000) {
  if (!value || value.length <= limit) return value;
  return `${value.slice(0, limit)}\n...[truncated]`;
}

export class AltusManagedToolRuntime {
  private readonly posix = path.posix;

  constructor(
    private readonly input: {
      sandboxId: string;
      workspaceRoot: string;
    }
  ) {}

  private ensureNotAborted(signal?: AbortSignal) {
    if (signal?.aborted) {
      throw new Error('managed_run_aborted');
    }
  }

  private resolveWorkspacePath(candidate: unknown, options?: { allowWorkspaceRoot?: boolean }) {
    const raw = asText(candidate) || '.';
    const absolute = raw.startsWith('/')
      ? this.posix.normalize(raw)
      : this.posix.normalize(this.posix.join(this.input.workspaceRoot, raw));

    const normalizedRoot = this.input.workspaceRoot.replace(/\/+$/, '');
    if (absolute === normalizedRoot && options?.allowWorkspaceRoot) {
      return absolute;
    }
    if (absolute === normalizedRoot) {
      return absolute;
    }
    if (!absolute.startsWith(`${normalizedRoot}/`)) {
      throw new Error('path_outside_workspace');
    }
    return absolute;
  }

  private relativeForDisplay(absolutePath: string) {
    const relative = this.posix.relative(this.input.workspaceRoot, absolutePath);
    return relative && relative !== '' ? relative : '.';
  }

  private parseCompletionAttachments(raw: unknown) {
    if (!Array.isArray(raw)) return [];
    const deduped = new Map<string, ManagedCompletionAttachment>();
    for (const item of raw.slice(0, 8)) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const record = item as Record<string, unknown>;
      const absolutePath = this.resolveWorkspacePath(record.path);
      const relativePath = this.relativeForDisplay(absolutePath);
      if (!relativePath || relativePath === '.') {
        throw new Error('complete_task_attachment_path_invalid');
      }
      if (!deduped.has(relativePath)) {
        const name = asText(record.name);
        const mimeType = asText(record.mimeType);
        deduped.set(relativePath, {
          path: relativePath,
          ...(name ? { name } : {}),
          ...(mimeType ? { mimeType } : {}),
        });
      }
    }
    return Array.from(deduped.values());
  }

  private async runShell(
    command: string,
    options?: { cwd?: string; timeoutMs?: number },
    signal?: AbortSignal
  ) {
    this.ensureNotAborted(signal);
    const cwd = options?.cwd ? this.resolveWorkspacePath(options.cwd, { allowWorkspaceRoot: true }) : this.input.workspaceRoot;
    const timeoutMs = asPositiveInt(options?.timeoutMs, 20000, 120000);
    const result = await e2bConnector.runCommand(this.input.sandboxId, command, {
      cwd,
      timeoutMs,
    });
    this.ensureNotAborted(signal);
    return result;
  }

  private compactSearchContent(value: string, limit = 1200) {
    return truncate(asText(value), limit);
  }

  private compactImageList(value: Array<{ url: string; description?: string }>, maxItems = 6) {
    return value.slice(0, maxItems).map((item) => ({
      url: item.url,
      ...(item.description ? { description: truncate(item.description, 220) } : {}),
    }));
  }

  async execute(toolName: string, rawArgs: Record<string, unknown>, signal?: AbortSignal): Promise<ManagedToolResult> {
    this.ensureNotAborted(signal);

    if (toolName === 'shell_execute') {
      const command = asText(rawArgs.command);
      if (!command) {
        throw new Error('shell_execute_missing_command');
      }
      const cwd = asText(rawArgs.cwd) || '.';
      const result = await this.runShell(command, {
        cwd,
        timeoutMs: asPositiveInt(rawArgs.timeoutMs, 20000, 120000),
      }, signal);
      const stdout = truncate(asText((result as any)?.stdout));
      const stderr = truncate(asText((result as any)?.stderr));
      const exitCode = Number((result as any)?.exitCode ?? -1);
      return {
        type: 'result',
        content: JSON.stringify({
          cwd: this.relativeForDisplay(this.resolveWorkspacePath(cwd, { allowWorkspaceRoot: true })),
          exitCode,
          stdout,
          stderr,
        }),
      };
    }

    if (toolName === 'read_file') {
      const absolutePath = this.resolveWorkspacePath(rawArgs.path);
      const bytes = await e2bConnector.readFile(this.input.sandboxId, absolutePath);
      this.ensureNotAborted(signal);
      const content = Buffer.from(bytes).toString('utf-8');
      return {
        type: 'result',
        content: JSON.stringify({
          path: this.relativeForDisplay(absolutePath),
          content: truncate(content, 24000),
        }),
      };
    }

    if (toolName === 'write_file') {
      const absolutePath = this.resolveWorkspacePath(rawArgs.path);
      const content = String(rawArgs.content ?? '');
      const parentDir = this.posix.dirname(absolutePath);
      await this.runShell(`mkdir -p ${shellEscape(parentDir)}`, {
        cwd: this.input.workspaceRoot,
        timeoutMs: 10000,
      }, signal);
      await e2bConnector.writeFile(this.input.sandboxId, absolutePath, Buffer.from(content, 'utf-8'));
      this.ensureNotAborted(signal);
      return {
        type: 'result',
        content: JSON.stringify({
          path: this.relativeForDisplay(absolutePath),
          bytes: Buffer.byteLength(content, 'utf-8'),
        }),
      };
    }

    if (toolName === 'list_directory') {
      const absolutePath = this.resolveWorkspacePath(rawArgs.path || '.', { allowWorkspaceRoot: true });
      const depth = asPositiveInt(rawArgs.depth, 2, 6);
      const command = [
        `target=${shellEscape(absolutePath)}`,
        'if [ ! -d "$target" ]; then',
        '  echo "__ONECEO_NOT_A_DIRECTORY__";',
        '  exit 1;',
        'fi',
        `find "$target" -maxdepth ${depth} -mindepth 1 \\( -type d -o -type f \\) | sort | head -n 300`,
      ].join('\n');
      const result = await this.runShell(command, {
        cwd: this.input.workspaceRoot,
        timeoutMs: 15000,
      }, signal);
      return {
        type: 'result',
        content: JSON.stringify({
          path: this.relativeForDisplay(absolutePath),
          depth,
          output: truncate(asText((result as any)?.stdout)),
          stderr: truncate(asText((result as any)?.stderr)),
        }),
      };
    }

    if (toolName === 'search_code') {
      const query = asText(rawArgs.query);
      if (!query) {
        throw new Error('search_code_missing_query');
      }
      const absolutePath = this.resolveWorkspacePath(rawArgs.path || '.', { allowWorkspaceRoot: true });
      const limit = asPositiveInt(rawArgs.limit, 100, 300);
      const command = [
        'if ! command -v rg >/dev/null 2>&1; then',
        '  echo "__ONECEO_RG_MISSING__";',
        '  exit 1;',
        'fi',
        `rg -n --hidden --glob '!.git' --glob '!node_modules' --max-count ${limit} ${shellEscape(query)} ${shellEscape(absolutePath)}`,
      ].join('\n');
      const result = await this.runShell(command, {
        cwd: this.input.workspaceRoot,
        timeoutMs: 20000,
      }, signal);
      return {
        type: 'result',
        content: JSON.stringify({
          query,
          path: this.relativeForDisplay(absolutePath),
          output: truncate(asText((result as any)?.stdout)),
          stderr: truncate(asText((result as any)?.stderr)),
          exitCode: Number((result as any)?.exitCode ?? -1),
        }),
      };
    }

    if (toolName === 'web_search') {
      const query = asText(rawArgs.query);
      if (!query) {
        throw new Error('web_search_missing_query');
      }
      const result = await tavilyConnector.search(
        {
          query,
          topic: asText(rawArgs.topic),
          maxResults: asPositiveInt(rawArgs.maxResults, 5, 8),
          includeImages: asBoolean(rawArgs.includeImages),
          searchDepth: asText(rawArgs.searchDepth),
          includeDomains: asStringArray(rawArgs.includeDomains, 20),
          excludeDomains: asStringArray(rawArgs.excludeDomains, 20),
          timeRange: asText(rawArgs.timeRange),
        },
        signal
      );
      return {
        type: 'result',
        content: JSON.stringify({
          query: result.query,
          topic: result.topic,
          searchDepth: result.searchDepth,
          requestId: result.requestId,
          responseTime: result.responseTime,
          images: this.compactImageList(result.images, 8),
          results: result.results.map((item) => ({
            title: item.title,
            url: item.url,
            ...(typeof item.score === 'number' ? { score: item.score } : {}),
            ...(item.favicon ? { favicon: item.favicon } : {}),
            content: this.compactSearchContent(item.content, 1000),
            images: this.compactImageList(item.images, 4),
          })),
        }),
      };
    }

    if (toolName === 'web_extract') {
      const urls = asStringArray(rawArgs.urls, 8);
      if (urls.length === 0) {
        throw new Error('web_extract_missing_urls');
      }
      const result = await tavilyConnector.extract(
        {
          urls,
          extractDepth: asText(rawArgs.extractDepth),
          includeImages: asBoolean(rawArgs.includeImages),
          format: asText(rawArgs.format),
          timeoutSeconds: asPositiveNumber(rawArgs.timeoutSeconds, 15, 60),
        },
        signal
      );
      return {
        type: 'result',
        content: JSON.stringify({
          urls: result.urls,
          extractDepth: result.extractDepth,
          format: result.format,
          requestId: result.requestId,
          responseTime: result.responseTime,
          failedResults: result.failedResults,
          results: result.results.map((item) => ({
            url: item.url,
            ...(item.favicon ? { favicon: item.favicon } : {}),
            rawContent: this.compactSearchContent(item.rawContent, 2200),
            images: this.compactImageList(item.images, 6),
          })),
        }),
      };
    }

    if (toolName === 'ask_user') {
      const question = asText(rawArgs.question);
      if (!question) {
        throw new Error('ask_user_missing_question');
      }
      const options = Array.isArray(rawArgs.options)
        ? rawArgs.options.map((item) => asText(item)).filter(Boolean).slice(0, 6)
        : [];
      return {
        type: 'ask_user',
        question,
        options: options.length > 0 ? options : undefined,
      };
    }

    if (toolName === 'complete_task') {
      const summary = asText(rawArgs.summary);
      if (!summary) {
        throw new Error('complete_task_missing_summary');
      }
      const verification = Array.isArray(rawArgs.verification)
        ? rawArgs.verification.map((item) => asText(item)).filter(Boolean).slice(0, 8)
        : [];
      const attachments = this.parseCompletionAttachments(rawArgs.attachments);
      return {
        type: 'complete',
        summary,
        verification: verification.length > 0 ? verification : undefined,
        attachments: attachments.length > 0 ? attachments : undefined,
      };
    }

    throw new Error(`unsupported_tool:${toolName}`);
  }
}
