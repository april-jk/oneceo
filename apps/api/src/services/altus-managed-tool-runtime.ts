import path from 'node:path';
import { e2bConnector } from '../connectors/e2b-connector';
import { tavilyConnector } from '../connectors/tavily-connector';
import { ensureNekoDebug } from './sandbox-debug-service';
import { sandboxSkillSyncService } from './sandbox-skill-sync-service';
import { osacAgentService } from './osac-agent-service';
import { connectorGuideService } from './connector-guide-service';
import { markSandboxDirty, touchSandbox } from './sandbox-activity-service';
import { writeConnectorDebugLog } from '../utils/connector-debug-log';
import {
  asText,
  buildManagedMcpToolName,
  type ManagedCompletionAttachment,
  type ManagedMcpProvider,
  type ManagedSkillContext,
} from './altus-managed-shared';

type ManagedToolResult =
  | { type: 'result'; content: string }
  | { type: 'ask_user'; question: string; options?: string[] }
  | { type: 'complete'; summary: string; verification?: string[]; attachments?: ManagedCompletionAttachment[] };

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

function normalizeDebugTargetUrl(value: unknown) {
  const raw = asText(value);
  if (!raw) {
    throw new Error('debug_open_page_missing_url');
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`debug_open_page_invalid_url:Please provide a full URL like http://127.0.0.1:3000/folder1/`);
  }
  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new Error('debug_open_page_invalid_protocol:Only http:// or https:// is allowed');
  }
  return parsed.toString();
}

export class AltusManagedToolRuntime {
  private readonly posix = path.posix;
  private readonly loadedConnectorGuides = new Set<string>();

  constructor(
    private readonly input: {
      sessionId: string;
      sandboxId: string;
      workspaceRoot: string;
      activeSkills: ManagedSkillContext[];
      mcpProviders: ManagedMcpProvider[];
    },
    private readonly sandboxActivityDeps: {
      touchSandbox: typeof touchSandbox;
      markSandboxDirty: typeof markSandboxDirty;
    } = {
      touchSandbox,
      markSandboxDirty,
    },
    private readonly debugDeps: {
      ensureNekoDebug: typeof ensureNekoDebug;
    } = {
      ensureNekoDebug,
    }
  ) {}

  private buildMcpToolMap() {
    const providers = Array.isArray(this.input.mcpProviders) ? this.input.mcpProviders : [];
    const entries = providers.flatMap((provider) =>
      (Array.isArray(provider.tools) ? provider.tools : []).map((tool) => [
        buildManagedMcpToolName(provider.providerId, tool.toolName),
        {
          providerId: provider.providerId,
          toolName: tool.toolName,
          displayName: tool.title || tool.toolName,
          connectorKey: asText(provider.connectorKey) || null,
        },
      ])
    );
    return new Map(
      entries as Array<
        [
          string,
          { providerId: string; toolName: string; displayName: string; connectorKey: string | null }
        ]
      >
    );
  }

  private normalizeMcpFailureMessage(input: {
    connectorKey?: string | null;
    toolName: string;
    error: string;
  }) {
    const raw = asText(input.error) || 'mcp_tool_failed';
    const normalized = raw.toLowerCase();
    if (asText(input.connectorKey) === 'github') {
      if (normalized.includes('没有任何可用安装') || normalized.includes('未安装到任何账号')) {
        return '当前 GitHub App 只有用户授权，没有安装到任何账号或组织。请先完成 GitHub App 安装或批准安装更新，再重新连接。';
      }
      if (normalized.includes('resource not accessible by integration')) {
        return [
          'GitHub App 当前没有执行该操作所需权限，或安装尚未批准最新权限。',
          '请检查 GitHub App 的 `Permissions & events`，确认 `Administration` 已设置为 `Read and write`；',
          '然后到 App 安装页批准新的权限，并确认安装覆盖了目标账号或目标组织。',
          '如果目标是组织仓库，还需要确认组织允许该 App 创建仓库。',
        ].join('');
      }
      if (normalized.includes('mcp provider not found')) {
        return 'GitHub 连接器运行态已丢失，当前正在重新恢复，请稍后重试。';
      }
      if (normalized.includes('no github installation found for repo')) {
        return '当前 GitHub App 安装未覆盖目标仓库，请在 GitHub App 安装页将该仓库纳入安装范围后重试。';
      }
    }
    return raw;
  }

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

  private async markWorkspaceDirty(reason: string) {
    await this.sandboxActivityDeps.markSandboxDirty(this.input.sandboxId, reason).catch(() => null);
  }

  async execute(toolName: string, rawArgs: Record<string, unknown>, signal?: AbortSignal): Promise<ManagedToolResult> {
    this.ensureNotAborted(signal);
    await this.sandboxActivityDeps.touchSandbox(this.input.sandboxId, `managed_tool:${toolName}`).catch(() => null);
    if (toolName === 'load_connector_guide') {
      const connectorKey = asText(rawArgs.connectorKey).toLowerCase();
      if (!connectorKey) {
        throw new Error('load_connector_guide_missing_connector_key');
      }
      const guide = await connectorGuideService.getActiveGuideForConnector(this.input.sessionId, connectorKey);
      this.ensureNotAborted(signal);
      if (!guide) {
        throw new Error(`load_connector_guide_not_found:${connectorKey}`);
      }
      this.loadedConnectorGuides.add(connectorKey);
      writeConnectorDebugLog('[CONNECTOR_GUIDE_RUNTIME_LOADED]', {
        taskSessionId: this.input.sessionId,
        connectorKey,
        revisionId: guide.revisionId,
      });
      return {
        type: 'result',
        content: JSON.stringify({
          connectorKey: guide.connectorKey,
          policyId: guide.policyId,
          revisionId: guide.revisionId,
          triggerMode: guide.triggerMode,
          serverInstructionsMarkdown: guide.serverInstructionsMarkdown,
          guideReminderMarkdown: guide.guideReminderMarkdown,
          blockingRulesMarkdown: guide.blockingRulesMarkdown,
        }),
      };
    }

    const mcpTool = this.buildMcpToolMap().get(toolName);
    if (mcpTool) {
      if (mcpTool.connectorKey) {
        const activeGuide = await connectorGuideService.getActiveGuideForConnector(
          this.input.sessionId,
          mcpTool.connectorKey
        );
        this.ensureNotAborted(signal);
        if (activeGuide && !this.loadedConnectorGuides.has(mcpTool.connectorKey)) {
          writeConnectorDebugLog('[CONNECTOR_GUIDE_RUNTIME_BLOCKED]', {
            taskSessionId: this.input.sessionId,
            connectorKey: mcpTool.connectorKey,
            toolName: mcpTool.toolName,
            managedToolName: toolName,
            revisionId: activeGuide.revisionId,
          });
          throw new Error(
            [
              `connector_guide_blocked:${mcpTool.connectorKey}`,
              `Call load_connector_guide with connectorKey=${mcpTool.connectorKey} before using ${mcpTool.displayName}.`,
              activeGuide.blockingRulesMarkdown || activeGuide.serverInstructionsMarkdown || activeGuide.guideReminderMarkdown,
            ]
              .filter(Boolean)
              .join('\n')
          );
        }
      }
      const response = await osacAgentService.callSessionMcpTool(this.input.sandboxId, {
        providerId: mcpTool.providerId,
        toolName: mcpTool.toolName,
        arguments: rawArgs,
      });
      this.ensureNotAborted(signal);
      if (response.isError) {
        const rawError =
          typeof response.result === 'string'
            ? response.result
            : JSON.stringify(response.result || { error: 'mcp_tool_failed' });
        throw new Error(
          this.normalizeMcpFailureMessage({
            connectorKey: mcpTool.connectorKey,
            toolName: mcpTool.toolName,
            error: rawError,
          })
        );
      }
      await this.markWorkspaceDirty(`managed_mcp_tool:${mcpTool.toolName}`);
      return {
        type: 'result',
        content: JSON.stringify({
          providerId: response.providerId,
          toolName: response.toolName,
          result: response.result,
        }),
      };
    }

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
      await this.markWorkspaceDirty('managed_shell_execute');
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

    if (toolName === 'debug_open_page') {
      const targetUrl = normalizeDebugTargetUrl(rawArgs.url);
      const ensureDebug = rawArgs.ensureDebug === undefined ? true : asBoolean(rawArgs.ensureDebug);
      const cdpPort = asPositiveInt(process.env.NEKO_CDP_PORT, 9222, 65535);
      let debugInfo: Awaited<ReturnType<typeof ensureNekoDebug>> | null = null;
      if (ensureDebug) {
        debugInfo = await this.debugDeps.ensureNekoDebug(this.input.sandboxId, {
          requireTurn: true,
          strictIceCheck: true,
        });
        if (!debugInfo.ready || debugInfo.status === 'failed') {
          const reason = asText((debugInfo as any)?.reasonCode) || 'debug_not_ready';
          const message = asText(debugInfo.message) || 'debug_not_ready';
          throw new Error(`debug_open_page_debug_not_ready:${reason}:${message}`);
        }
      }

      const encodedUrl = encodeURIComponent(targetUrl);
      const command = [
        `cdp_port=${cdpPort}`,
        `encoded_url=${shellEscape(encodedUrl)}`,
        'endpoint="http://127.0.0.1:${cdp_port}/json/new?${encoded_url}"',
        'if curl -fsS -X PUT "$endpoint"; then',
        '  echo "\\n__OPENED_BY__=PUT"',
        'elif curl -fsS "$endpoint"; then',
        '  echo "\\n__OPENED_BY__=GET"',
        'else',
        '  echo "__ONECEO_DEBUG_OPEN_PAGE_FAILED__"',
        '  exit 1',
        'fi',
      ].join('\n');

      const result = await this.runShell(
        command,
        {
          cwd: this.input.workspaceRoot,
          timeoutMs: asPositiveInt(rawArgs.timeoutMs, 20000, 60000),
        },
        signal
      );
      const exitCode = Number((result as any)?.exitCode ?? -1);
      const stdout = truncate(asText((result as any)?.stdout), 4000);
      const stderr = truncate(asText((result as any)?.stderr), 2000);
      if (exitCode !== 0 || stdout.includes('__ONECEO_DEBUG_OPEN_PAGE_FAILED__')) {
        throw new Error(`debug_open_page_failed:${stderr || stdout || 'unknown error'}`);
      }

      await this.markWorkspaceDirty('managed_debug_open_page');
      return {
        type: 'result',
        content: JSON.stringify({
          targetUrl,
          debugUrl: debugInfo?.url,
          ready: debugInfo?.ready ?? false,
          status: debugInfo?.status || 'unknown',
          sandboxId: this.input.sandboxId,
          cdpPort,
          output: stdout,
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
      await this.markWorkspaceDirty('managed_write_file');
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

    if (toolName === 'load_skill_resource') {
      const skillId = asText(rawArgs.skillId);
      const revisionId = asText(rawArgs.revisionId);
      const resourcePath = asText(rawArgs.resourcePath);
      if (!skillId || !revisionId || !resourcePath) {
        throw new Error('load_skill_resource_missing_arguments');
      }
      const activeSkill = this.input.activeSkills.find(
        (item) => item.skillId === skillId && item.revisionId === revisionId
      );
      if (!activeSkill) {
        throw new Error('load_skill_resource_skill_not_active');
      }
      const result = await sandboxSkillSyncService.syncResolvedSkillResource({
        taskSessionId: this.input.sessionId,
        orchestratorSessionId: this.input.sandboxId,
        skill: activeSkill,
        resourcePath,
      });
      return {
        type: 'result',
        content: JSON.stringify({
          skillId: result.skillId,
          revisionId: result.revisionId,
          slug: result.slug,
          resourcePath: result.resourcePath,
          resourceType: result.resourceType,
          skillResourcePath: result.skillResourcePath,
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
