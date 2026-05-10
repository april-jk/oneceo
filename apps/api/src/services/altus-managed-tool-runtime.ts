import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { e2bConnector } from '../connectors/e2b-connector';
import { tavilyConnector } from '../connectors/tavily-connector';
import { ensureNekoDebug } from './sandbox-debug-service';
import { cloudflareTurnService } from './cloudflare-turn-service';
import { sandboxSkillSyncService } from './sandbox-skill-sync-service';
import { osacAgentService } from './osac-agent-service';
import { connectorGuideService } from './connector-guide-service';
import { pptRenderToolService } from './ppt-render-tool-service';
import { markSandboxDirty, touchSandbox } from './sandbox-activity-service';
import { taskSessionSkillStateService } from './task-session-skill-state-service';
import { writeConnectorDebugLog } from '../utils/connector-debug-log';
import { userSkillService } from './user-skill-service';
import {
  altusManagedDeploymentToolService,
  type AltusManagedDeploymentToolName,
} from './altus-managed-deployment-tool-service';
import {
  altusManagedResourceToolService,
  type AltusManagedResourceToolName,
} from './altus-managed-resource-tool-service';
import {
  asText,
  buildManagedMcpToolName,
  type ManagedCompletionAttachment,
  type ManagedSkillCatalogEntry,
  type ManagedMcpProvider,
  type ManagedSkillContext,
} from './altus-managed-shared';
import type { AltusManagedTaskIntentProfile } from './altus-managed-prompt-service';
import type { TaskClarificationType } from './task-intent-shape-service';

export type ManagedToolResult =
  | { type: 'result'; content: string; activatedSkills?: ManagedSkillContext[] }
  | {
      type: 'ask_user';
      question: string;
      options?: string[];
      clarificationType?: Exclude<TaskClarificationType, 'none'>;
      activatedSkills?: ManagedSkillContext[];
    }
  | {
      type: 'complete';
      summary: string;
      verification?: string[];
      attachments?: ManagedCompletionAttachment[];
      activatedSkills?: ManagedSkillContext[];
    };

type ManagedTodoStatus = 'pending' | 'in_progress' | 'completed';
type ShellRunMode = 'auto' | 'foreground' | 'background_service';

type ManagedTodoItem = {
  content: string;
  status: ManagedTodoStatus;
  activeForm?: string;
};

const BINARY_DELIVERABLE_EXTENSIONS = new Set([
  '.doc',
  '.docx',
  '.odp',
  '.ods',
  '.odt',
  '.pdf',
  '.ppt',
  '.pptx',
  '.tar',
  '.tgz',
  '.xls',
  '.xlsx',
  '.zip',
]);

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

function isBinaryDeliverablePath(relativePath: string) {
  return BINARY_DELIVERABLE_EXTENSIONS.has(path.posix.extname(relativePath).toLowerCase());
}

function findActiveSkillForResourceLoad(
  activeSkills: ManagedSkillContext[],
  input: { skillId: string; revisionId: string }
) {
  const normalized = normalizeSkillResourceLoadInput(input);
  const exactMatch = activeSkills.find(
    (item) => item.skillId === normalized.skillId && item.revisionId === normalized.revisionId
  );
  if (exactMatch) return exactMatch;
  return activeSkills.find(
    (item) => item.slug === normalized.skillId && String(item.revisionNumber ?? '') === normalized.revisionId
  );
}

function normalizeSkillResourceLoadInput(input: { skillId: string; revisionId: string }) {
  return {
    skillId: normalizeSkillResourceLoadSkillId(input.skillId),
    revisionId: normalizeSkillResourceLoadRevisionId(input.revisionId),
  };
}

function normalizeSkillResourceLoadSkillId(value: string) {
  const text = value.trim().replace(/^id=/i, '');
  const catalogMatch = /^skill-catalog:platform:([^:]+)(?::[^:]+)?$/i.exec(text);
  if (catalogMatch?.[1]) return catalogMatch[1];
  const platformMatch = /^skill:platform:([^:]+)(?::[^:]+)?$/i.exec(text);
  if (platformMatch?.[1]) return platformMatch[1];
  return text;
}

function normalizeSkillResourceLoadRevisionId(value: string) {
  const text = value.trim().replace(/^id=/i, '');
  const catalogMatch = /^skill-catalog:platform:[^:]+:([^:]+)$/i.exec(text);
  if (catalogMatch?.[1]) return catalogMatch[1];
  const revisionMatch = /^revision:platform:([^:]+)$/i.exec(text);
  if (revisionMatch?.[1]) return revisionMatch[1];
  return text;
}

function normalizeShellRunMode(value: unknown): ShellRunMode {
  const text = asText(value).toLowerCase();
  if (text === 'foreground' || text === 'background_service') return text;
  return 'auto';
}

function isManagedTodoStatus(value: string): value is ManagedTodoStatus {
  return value === 'pending' || value === 'in_progress' || value === 'completed';
}

function shellEscape(value: string): string {
  if (!value) return "''";
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function truncate(value: string, limit = 16000) {
  if (!value || value.length <= limit) return value;
  return `${value.slice(0, limit)}\n...[truncated]`;
}

type NormalizedDebugTarget = {
  targetUrl: string;
  protocol: 'http' | 'https' | 'file';
  localFilePath?: string;
};

type BrowserInteractAction =
  | 'locator_click'
  | 'text_click'
  | 'coordinate_click'
  | 'locator_fill'
  | 'keyboard_type'
  | 'keyboard_press'
  | 'mouse_wheel'
  | 'wait_for_locator'
  | 'wait_for_text'
  | 'wait_for_load_state'
  | 'wait_for_timeout';

function isInsidePath(parent: string, child: string) {
  const relative = path.posix.relative(parent, child);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.posix.isAbsolute(relative));
}

function normalizeDebugTargetUrl(value: unknown, workspaceRoot: string): NormalizedDebugTarget {
  const raw = asText(value).trim();
  if (!raw) {
    throw new Error('debug_open_page_missing_url');
  }
  const hasScheme = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(raw);
  const looksLikeLocalOrIp =
    /^(localhost|(?:\d{1,3}\.){3}\d{1,3}|\[[0-9a-f:]+\])(?::\d+)?(?:[/?#].*)?$/i.test(raw);
  const candidate = raw.startsWith('//')
    ? `http:${raw}`
    : looksLikeLocalOrIp
      ? `http://${raw}`
      : hasScheme
        ? raw
        : `https://${raw}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`debug_open_page_invalid_url:Please provide a full URL like http://127.0.0.1:3000/folder1/`);
  }
  const protocol = parsed.protocol.toLowerCase();
  if (protocol === 'file:') {
    const workspace = path.posix.resolve(workspaceRoot);
    const localFilePath = path.posix.resolve(decodeURIComponent(parsed.pathname));
    if (!isInsidePath(workspace, localFilePath)) {
      throw new Error('debug_open_page_file_outside_workspace:Only workspace files can be opened in the debug browser');
    }
    return {
      targetUrl: pathToFileURL(localFilePath).toString(),
      protocol: 'file',
      localFilePath,
    };
  }
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new Error('debug_open_page_invalid_protocol:Only http:// or https:// is allowed');
  }
  return {
    targetUrl: parsed.toString(),
    protocol: protocol === 'https:' ? 'https' : 'http',
  };
}

function normalizeBrowserInteractAction(value: unknown): BrowserInteractAction {
  const text = asText(value).toLowerCase();
  if (
    text === 'locator_click' ||
    text === 'text_click' ||
    text === 'coordinate_click' ||
    text === 'locator_fill' ||
    text === 'keyboard_type' ||
    text === 'keyboard_press' ||
    text === 'mouse_wheel' ||
    text === 'wait_for_locator' ||
    text === 'wait_for_text' ||
    text === 'wait_for_load_state' ||
    text === 'wait_for_timeout'
  ) {
    return text;
  }
  throw new Error('browser_interact_invalid_action');
}

function normalizeScrollDirection(value: unknown) {
  const text = asText(value).toLowerCase();
  if (text === 'up' || text === 'left' || text === 'right') return text;
  return 'down';
}

function normalizeLoadState(value: unknown) {
  const text = asText(value).toLowerCase();
  if (text === 'load' || text === 'networkidle') return text;
  return 'domcontentloaded';
}

function buildBrowserInteractCommand(input: {
  action: BrowserInteractAction;
  selector?: string;
  text?: string;
  key?: string;
  direction?: string;
  loadState?: string;
  pixels?: number;
  x?: number | null;
  y?: number | null;
  timeoutMs?: number;
  description?: string;
  cdpPort: number;
}) {
  const payload = {
    action: input.action,
    selector: asText(input.selector),
    text: asText(input.text),
    key: asText(input.key),
    direction: normalizeScrollDirection(input.direction),
    loadState: normalizeLoadState(input.loadState),
    pixels: Math.max(1, Math.min(Math.floor(Number(input.pixels) || 600), 5000)),
    x: typeof input.x === 'number' && Number.isFinite(input.x) ? input.x : null,
    y: typeof input.y === 'number' && Number.isFinite(input.y) ? input.y : null,
    timeoutMs: Math.max(100, Math.min(Math.floor(Number(input.timeoutMs) || 5000), 30000)),
    description: asText(input.description),
    cdpEndpoint: `http://127.0.0.1:${input.cdpPort}`,
  };

  return `
set -euo pipefail
export NODE_PATH="$(npm root -g 2>/dev/null || true)"
ONECEO_BROWSER_ACTION=${shellEscape(JSON.stringify(payload))} node <<'NODE'
const { chromium } = require('playwright');

const payload = JSON.parse(process.env.ONECEO_BROWSER_ACTION || '{}');

async function pickPage(browser) {
  for (const context of browser.contexts()) {
    const pages = context.pages();
    const meaningful = pages.filter((page) => {
      const url = page.url();
      return url && url !== 'about:blank';
    });
    if (meaningful.length > 0) return meaningful[meaningful.length - 1];
    if (pages.length > 0) return pages[pages.length - 1];
  }
  throw new Error('browser_interact_no_page');
}

async function main() {
  const browser = await chromium.connectOverCDP(payload.cdpEndpoint);
  try {
    const page = await pickPage(browser);
    const timeout = Number(payload.timeoutMs || 5000);
    const selector = String(payload.selector || '');
    const text = String(payload.text || '');
    const action = String(payload.action || '');

    if (action === 'locator_click') {
      if (!selector) throw new Error('browser_interact_locator_click_missing_selector');
      await page.locator(selector).first().click({ timeout });
    } else if (action === 'text_click') {
      if (!text) throw new Error('browser_interact_text_click_missing_text');
      await page.getByText(text, { exact: false }).first().click({ timeout });
    } else if (action === 'coordinate_click') {
      if (typeof payload.x !== 'number' || typeof payload.y !== 'number') {
        throw new Error('browser_interact_coordinate_click_missing_point');
      }
      await page.mouse.click(payload.x, payload.y);
    } else if (action === 'locator_fill') {
      if (!selector) throw new Error('browser_interact_locator_fill_missing_selector');
      if (!text) throw new Error('browser_interact_locator_fill_missing_text');
      await page.locator(selector).first().fill(text, { timeout });
    } else if (action === 'keyboard_type') {
      if (!text) throw new Error('browser_interact_keyboard_type_missing_text');
      await page.keyboard.type(text);
    } else if (action === 'keyboard_press') {
      if (!payload.key) throw new Error('browser_interact_keyboard_press_missing_key');
      await page.keyboard.press(String(payload.key));
    } else if (action === 'mouse_wheel') {
      const pixels = Number(payload.pixels || 600);
      const direction = String(payload.direction || 'down');
      const dx = direction === 'left' ? -pixels : direction === 'right' ? pixels : 0;
      const dy = direction === 'up' ? -pixels : direction === 'down' ? pixels : 0;
      await page.mouse.wheel(dx, dy);
    } else if (action === 'wait_for_locator') {
      if (!selector) throw new Error('browser_interact_wait_for_locator_missing_selector');
      await page.locator(selector).first().waitFor({ state: 'visible', timeout });
    } else if (action === 'wait_for_text') {
      if (!text) throw new Error('browser_interact_wait_for_text_missing_text');
      if (selector) {
        await page.locator(selector).filter({ hasText: text }).first().waitFor({ state: 'visible', timeout });
      } else {
        await page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout });
      }
    } else if (action === 'wait_for_load_state') {
      await page.waitForLoadState(String(payload.loadState || 'domcontentloaded'), { timeout });
    } else if (action === 'wait_for_timeout') {
      await page.waitForTimeout(timeout);
    } else {
      throw new Error('browser_interact_invalid_action');
    }

    await page.waitForLoadState('domcontentloaded', { timeout: Math.min(timeout, 5000) }).catch(() => undefined);
    console.log(JSON.stringify({
      ok: true,
      action,
      description: payload.description || '',
      url: page.url(),
      title: await page.title().catch(() => ''),
    }));
  } finally {
    await browser.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
NODE
`;
}

function isManagedDeploymentToolName(value: string): value is AltusManagedDeploymentToolName {
  return (
    value === 'deploy_application' ||
    value === 'redeploy_application' ||
    value === 'rollback_application_deployment' ||
    value === 'get_application_deployment_status'
  );
}

function isManagedResourceToolName(value: string): value is AltusManagedResourceToolName {
  return (
    value === 'ensure_project_database' ||
    value === 'get_project_database_status' ||
    value === 'inspect_project_database_schema' ||
    value === 'ensure_project_storage_bucket' ||
    value === 'get_project_storage_status'
  );
}

function normalizeCommandForMatch(value: string) {
  return asText(value).toLowerCase().replace(/\s+/g, ' ');
}

function isLocalPreviewOrDevCommand(value: string) {
  const normalized = normalizeCommandForMatch(value);
  if (!normalized) return false;
  return (
    normalized.includes('vite preview') ||
    normalized.includes('npm run preview') ||
    normalized.includes('pnpm preview') ||
    normalized.includes('yarn preview') ||
    normalized.includes('bun preview') ||
    normalized.includes('vite dev') ||
    normalized.includes('npm run dev') ||
    normalized.includes('pnpm dev') ||
    normalized.includes('yarn dev') ||
    normalized.includes('bun dev') ||
    normalized.includes('react-scripts start')
  );
}

function isFrontendBuildCommand(value: string) {
  const normalized = normalizeCommandForMatch(value);
  if (!normalized) return false;
  return (
    normalized.includes('npm run build') ||
    normalized.includes('pnpm build') ||
    normalized.includes('yarn build') ||
    normalized.includes('bun run build') ||
    normalized.includes('bun build') ||
    normalized.includes('vite build')
  );
}

function isPersistentLocalServerCommand(value: string) {
  const normalized = normalizeCommandForMatch(value);
  if (!normalized) return false;
  return (
    normalized.includes('python -m http.server') ||
    normalized.includes('python3 -m http.server') ||
    normalized.includes('npm run dev') ||
    normalized.includes('pnpm dev') ||
    normalized.includes('yarn dev') ||
    normalized.includes('bun dev') ||
    normalized.includes('vite dev') ||
    normalized === 'vite'
  );
}

function sanitizeBackgroundServiceCommand(value: string) {
  let command = asText(value).trim();
  command = command.replace(/^\s*nohup\s+/i, '');
  command = command.replace(/\s*&\s*$/g, '').trim();
  return command;
}

function inferServicePort(command: string) {
  const normalized = normalizeCommandForMatch(command);
  const portEnv = command.match(/\bPORT=(\d{2,5})\b/);
  if (portEnv) return Number(portEnv[1]);
  const longPort = command.match(/(?:--port|-p)\s+(\d{2,5})\b/);
  if (longPort) return Number(longPort[1]);
  const httpServer = command.match(/python3?\s+-m\s+http\.server(?:\s+(\d{2,5}))?/i);
  if (httpServer) return Number(httpServer[1] || 8000);
  if (normalized.includes('vite') || normalized.includes('pnpm dev') || normalized.includes('npm run dev')) {
    return 5173;
  }
  return 0;
}

function isLegacyNotionMcpShellCommand(value: string) {
  const normalized = normalizeCommandForMatch(value);
  if (!normalized) return false;
  return (
    normalized.includes('@notionhq/mcp-cli') ||
    normalized.includes('notion-mcp') ||
    normalized.includes('mcp.notion.com') ||
    normalized.includes('notion mcp cli')
  );
}

function isLegacyFigmaMcpShellCommand(value: string) {
  const normalized = normalizeCommandForMatch(value);
  if (!normalized) return false;
  return (
    normalized.includes('figma-mcp') ||
    normalized.includes('figma mcp') ||
    normalized.includes('@composio/cli add') && normalized.includes('figma') ||
    normalized.includes('x-figma-token') ||
    normalized.includes('figma_personal_access_token') ||
    normalized.includes('figma access token')
  );
}

function isLegacySupabaseMcpShellCommand(value: string) {
  const normalized = normalizeCommandForMatch(value);
  if (!normalized) return false;
  return (
    normalized.includes('supabase-mcp') ||
    normalized.includes('supabase mcp') ||
    (normalized.includes('@composio/cli add') && normalized.includes('supabase')) ||
    normalized.includes('mcp.supabase.com') ||
    normalized.includes('supabase_access_token') ||
    normalized.includes('supabase personal access token')
  );
}

function isLegacySlackMcpShellCommand(value: string) {
  const normalized = normalizeCommandForMatch(value);
  if (!normalized) return false;
  return (
    normalized.includes('slack-mcp') ||
    normalized.includes('slack mcp') ||
    (normalized.includes('@composio/cli add') && normalized.includes('slack')) ||
    normalized.includes('mcp.slack.com') ||
    normalized.includes('slack_access_token') ||
    normalized.includes('slack bot token') ||
    normalized.includes('slack user token')
  );
}

function isCustomApiBypassShellCommand(value: string) {
  const normalized = normalizeCommandForMatch(value);
  if (!normalized) return false;
  return (
    normalized.includes('curl ') ||
    normalized.includes('wget ') ||
    normalized.includes('set custom_api') ||
    normalized.includes('custom_api_token') ||
    normalized.includes('custom_api_api_key') ||
    normalized.includes('authorization: bearer')
  );
}

function isCustomMcpBypassShellCommand(value: string) {
  const normalized = normalizeCommandForMatch(value);
  if (!normalized) return false;
  return (
    normalized.includes('curl ') ||
    normalized.includes('wget ') ||
    normalized.includes('npx ') ||
    normalized.includes('node ') ||
    normalized.includes('python ') ||
    normalized.includes('docker ') ||
    normalized.includes('stdio') ||
    normalized.includes('custom_mcp_token') ||
    normalized.includes('custom_mcp_api_key') ||
    normalized.includes('authorization: bearer')
  );
}

function extractLeadingCdTarget(value: string) {
  const raw = asText(value).trim();
  if (!raw.toLowerCase().startsWith('cd ')) {
    return '';
  }

  const match = raw.match(/^cd\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))\s*(?:&&|;)/i);
  if (!match) {
    return '';
  }
  return asText(match[1] ?? match[2] ?? match[3]);
}

export class AltusManagedToolRuntime {
  private readonly posix = path.posix;
  private readonly loadedConnectorGuides = new Set<string>();
  private readonly renderedPptxAttachmentPaths = new Set<string>();

  private hasActiveSkill(slug: string) {
    return this.input.activeSkills.some((item) => asText(item.slug) === slug);
  }

  constructor(
    private readonly input: {
      sessionId: string;
      userId: string;
      sandboxId: string;
      workspaceRoot: string;
      userInput?: string;
      taskIntentProfile?: AltusManagedTaskIntentProfile;
      availableSkills?: ManagedSkillCatalogEntry[];
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
      issueIceServersForUser: typeof cloudflareTurnService.issueIceServersForUser;
    } = {
      ensureNekoDebug,
      issueIceServersForUser: (userId: string) => cloudflareTurnService.issueIceServersForUser(userId),
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

  private buildRawMcpToolMap() {
    const providers = Array.isArray(this.input.mcpProviders) ? this.input.mcpProviders : [];
    const singletons = new Map<
      string,
      { providerId: string; toolName: string; displayName: string; connectorKey: string | null }
    >();
    const duplicates = new Set<string>();

    for (const provider of providers) {
      for (const tool of Array.isArray(provider.tools) ? provider.tools : []) {
        const rawToolName = asText(tool.toolName);
        if (!rawToolName) {
          continue;
        }
        if (duplicates.has(rawToolName)) {
          continue;
        }
        if (singletons.has(rawToolName)) {
          singletons.delete(rawToolName);
          duplicates.add(rawToolName);
          continue;
        }
        singletons.set(rawToolName, {
          providerId: provider.providerId,
          toolName: rawToolName,
          displayName: tool.title || rawToolName,
          connectorKey: asText(provider.connectorKey) || null,
        });
      }
    }

    return singletons;
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

  private parseCompletionAttachments(raw: unknown, options?: { requireArray?: boolean }) {
    if (raw == null) return [];
    if (!Array.isArray(raw)) {
      if (options?.requireArray) {
        throw new Error('complete_task_attachments_invalid');
      }
      return [];
    }
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

  private shouldRequireDownloadableAttachments() {
    if (this.hasActiveSkill('ppt-workflow')) {
      return true;
    }

    const profile = this.input.taskIntentProfile;
    if (profile?.scriptArtifactRequested || profile?.emailTemplateRequested) {
      return false;
    }

    const currentInput = asText(this.input.userInput).toLowerCase();
    if (!currentInput) return false;
    const artifactMentioned =
      /\.(pptx|docx|xlsx|pdf|zip)\b/i.test(currentInput) ||
      /(pptx|powerpoint|演示文稿|幻灯片|docx|word 文档|excel 表格|工作簿|pdf|压缩包)/i.test(currentInput);
    const deliveryIntent =
      /(生成|创建|输出|导出|交付|给我一份|给我一个|produce|generate|create|export|deliver)/i.test(currentInput);
    return artifactMentioned && deliveryIntent;
  }

  private assertPptxAttachmentsWereRendered(attachments: ManagedCompletionAttachment[]) {
    if (!this.hasActiveSkill('ppt-workflow')) {
      return;
    }
    const pptxAttachments = attachments.filter((item) => item.path.toLowerCase().endsWith('.pptx'));
    if (pptxAttachments.length === 0) {
      return;
    }
    const missing = pptxAttachments.filter((item) => !this.renderedPptxAttachmentPaths.has(item.path));
    if (missing.length > 0) {
      throw new Error('complete_task_pptx_requires_render_pptx_from_instructions');
    }
  }

  private assertWriteFileTargetAllowed(relativePath: string) {
    if (!isBinaryDeliverablePath(relativePath)) {
      return;
    }
    throw new Error('write_file_binary_deliverable_requires_generator');
  }

  private parseTodos(raw: unknown) {
    if (!Array.isArray(raw)) {
      throw new Error('todowrite_missing_todos');
    }
    const todos = raw
      .map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
        const record = item as Record<string, unknown>;
        const content = asText(record.content);
        const status = asText(record.status);
        const activeForm = asText(record.activeForm);
        if (!content || !isManagedTodoStatus(status)) {
          return null;
        }
        return {
          content,
          status,
          ...(activeForm ? { activeForm } : {}),
        } satisfies ManagedTodoItem;
      })
      .filter((item): item is ManagedTodoItem => Boolean(item))
      .slice(0, 12);

    if (todos.length === 0) {
      throw new Error('todowrite_missing_valid_todos');
    }

    const inProgressCount = todos.filter((item) => item.status === 'in_progress').length;
    const allCompleted = todos.every((item) => item.status === 'completed');
    if (allCompleted) {
      if (inProgressCount !== 0) {
        throw new Error('todowrite_completed_list_invalid');
      }
      return todos;
    }
    if (inProgressCount !== 1) {
      throw new Error('todowrite_requires_single_in_progress');
    }
    return todos;
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

  private parseInspectionFlags(stdout: string) {
    const flags = new Map<string, string>();
    for (const line of String(stdout || '').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const separatorIndex = trimmed.indexOf('=');
      if (separatorIndex <= 0) continue;
      const key = trimmed.slice(0, separatorIndex);
      const value = trimmed.slice(separatorIndex + 1);
      flags.set(key, value);
    }
    return flags;
  }

  private async prepareFrontendBuildWorkspace(
    command: string,
    cwd: string,
    signal?: AbortSignal
  ) {
    if (!isFrontendBuildCommand(command)) {
      return;
    }
    const commandScopedCwd = extractLeadingCdTarget(command);
    const inspectionCwd = commandScopedCwd || cwd;
    const absoluteCwd = this.resolveWorkspacePath(inspectionCwd, { allowWorkspaceRoot: true });
    const inspection = await this.runShell(
      [
        'if [ -f package.json ]; then echo "package_json=1"; else echo "package_json=0"; fi',
        'if [ -f index.html ]; then echo "root_index=1"; else echo "root_index=0"; fi',
        'if [ -f public/index.html ]; then echo "public_index=1"; else echo "public_index=0"; fi',
        'if [ -f client/index.html ]; then echo "client_index=1"; else echo "client_index=0"; fi',
        'if [ -f package.json ] && grep -qi \'"vite"\\|vite\' package.json; then echo "vite_project=1"; else echo "vite_project=0"; fi',
      ].join('\n'),
      {
        cwd: absoluteCwd,
        timeoutMs: 10000,
      },
      signal
    );
    const flags = this.parseInspectionFlags(asText((inspection as any)?.stdout));
    if (flags.get('package_json') !== '1' || flags.get('vite_project') !== '1' || flags.get('root_index') === '1') {
      return;
    }

    const source =
      flags.get('public_index') === '1'
        ? 'public/index.html'
        : flags.get('client_index') === '1'
          ? 'client/index.html'
          : '';
    if (!source) {
      return;
    }

    await this.runShell(
      `cp ${shellEscape(source)} index.html`,
      {
        cwd: absoluteCwd,
        timeoutMs: 10000,
      },
      signal
    );
    await this.markWorkspaceDirty('managed_frontend_build_prepare');
  }

  private parseShellFlag(stdout: string, key: string) {
    const flags = this.parseInspectionFlags(stdout);
    return flags.get(key) || '';
  }

  private async startControlledBackgroundService(
    command: string,
    cwd: string,
    signal?: AbortSignal
  ) {
    const serviceCommand = sanitizeBackgroundServiceCommand(command);
    if (!serviceCommand) {
      throw new Error('shell_execute_background_service_missing_command');
    }
    const port = inferServicePort(serviceCommand);
    const serviceId = `managed-${this.input.sessionId}-${Date.now()}`;
    const serviceDir = `/tmp/oneceo-managed-services/${this.input.sessionId}`;
    const logPath = `${serviceDir}/${serviceId}.log`;
    const pidPath = `${serviceDir}/${serviceId}.pid`;
    const serviceUrl = port > 0 ? `http://127.0.0.1:${port}/` : '';
    const script = [
      `service_id=${shellEscape(serviceId)}`,
      `service_dir=${shellEscape(serviceDir)}`,
      `log_path=${shellEscape(logPath)}`,
      `pid_path=${shellEscape(pidPath)}`,
      `service_command=${shellEscape(serviceCommand)}`,
      `service_port=${port}`,
      'mkdir -p "$service_dir"',
      'service_status="starting"',
      'if [ "$service_port" -gt 0 ] && (ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null || true) | grep -q ":${service_port} "; then',
      '  service_status="already_running"',
      '  echo "__ONECEO_SERVICE_ALREADY_RUNNING__=1"',
      'else',
      '  setsid sh -lc "$service_command" > "$log_path" 2>&1 < /dev/null &',
      '  service_pid=$!',
      '  echo "$service_pid" > "$pid_path"',
      '  echo "__ONECEO_SERVICE_PID__=$service_pid"',
      '  sleep 1',
      '  if ! kill -0 "$service_pid" 2>/dev/null; then',
      '    service_status="start_failed"',
      '    echo "__ONECEO_SERVICE_START_FAILED__=1"',
      '    tail -n 80 "$log_path" 2>/dev/null || true',
      '  fi',
      'fi',
      'if [ "$service_status" != "start_failed" ] && [ "$service_port" -gt 0 ]; then',
      '  service_url="http://127.0.0.1:${service_port}/"',
      '  health_ready=0',
      '  for i in 1 2 3 4 5 6 7 8; do',
      '    if curl -k -L -sS --max-time 2 -o /tmp/oneceo_service_probe_${service_port}.html -w "%{http_code}" "$service_url" 2>/tmp/oneceo_service_probe_${service_port}.err | grep -Eq "^(2|3)[0-9][0-9]$"; then',
      '      health_ready=1',
      '      break',
      '    fi',
      '    sleep 1',
      '  done',
      '  if [ "$health_ready" = "1" ]; then',
      '    service_status="ready"',
      '    echo "__ONECEO_SERVICE_URL__=$service_url"',
      '  else',
      '    service_status="health_pending"',
      '    echo "__ONECEO_SERVICE_HEALTH_PENDING__=$service_url"',
      '    cat /tmp/oneceo_service_probe_${service_port}.err 2>/dev/null || true',
      '    tail -n 80 "$log_path" 2>/dev/null || true',
      '  fi',
      'fi',
      'echo "__ONECEO_SERVICE_ID__=$service_id"',
      'echo "__ONECEO_SERVICE_STATUS__=$service_status"',
      'echo "__ONECEO_SERVICE_PORT__=$service_port"',
      'echo "__ONECEO_SERVICE_LOG__=$log_path"',
      'echo "__ONECEO_SERVICE_PID_FILE__=$pid_path"',
      'exit 0',
    ].join('\n');
    const result = await this.runShell(
      script,
      {
        cwd,
        timeoutMs: 20000,
      },
      signal
    );
    const stdout = truncate(asText((result as any)?.stdout), 6000);
    const stderr = truncate(asText((result as any)?.stderr), 2000);
    if (stdout.includes('__ONECEO_SERVICE_START_FAILED__')) {
      throw new Error(`shell_execute_background_service_start_failed:${stderr || stdout || 'unknown error'}`);
    }
    const status = this.parseShellFlag(stdout, '__ONECEO_SERVICE_STATUS__') || 'unknown';
    const pid = this.parseShellFlag(stdout, '__ONECEO_SERVICE_PID__');
    const url =
      this.parseShellFlag(stdout, '__ONECEO_SERVICE_URL__') ||
      this.parseShellFlag(stdout, '__ONECEO_SERVICE_HEALTH_PENDING__') ||
      serviceUrl;
    await this.markWorkspaceDirty('managed_shell_background_service');
    return {
      type: 'result' as const,
      content: JSON.stringify({
        cwd: this.relativeForDisplay(this.resolveWorkspacePath(cwd, { allowWorkspaceRoot: true })),
        exitCode: 0,
        stdout,
        stderr,
        runMode: 'background_service',
        service: {
          id: serviceId,
          status,
          command: serviceCommand,
          pid: pid ? Number(pid) : null,
          port: port || null,
          url: url || null,
          logPath,
          pidPath,
        },
        nextSuggestedTool: url ? 'debug_open_page' : undefined,
      }),
    };
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

  private findAutoAttachableSkillsForTool(toolName: string) {
    const normalizedToolName = asText(toolName).toLowerCase();
    if (!normalizedToolName) return [];
    const toolNameCandidates = new Set([normalizedToolName]);
    const managedMcpMatch = normalizedToolName.match(/^mcp__(.+)__[a-f0-9]{12}$/);
    if (managedMcpMatch?.[1]) {
      toolNameCandidates.add(managedMcpMatch[1]);
    }
    const managedMcpTool = this.buildMcpToolMap().get(normalizedToolName);
    if (managedMcpTool?.toolName) {
      toolNameCandidates.add(asText(managedMcpTool.toolName).toLowerCase());
    }
    const activeKeys = new Set(
      this.input.activeSkills.map((item) => `${item.sourceType}:${item.skillId}:${item.revisionId}`)
    );
    const availableSkills = Array.isArray(this.input.availableSkills) ? this.input.availableSkills : [];
    return availableSkills.filter((skill) => {
      const governance = skill.governance;
      if (!governance?.autoActivation?.enabled) return false;
      if (!governance.autoActivation.toolNames.some((name) => toolNameCandidates.has(asText(name).toLowerCase()))) {
        return false;
      }
      const key = `${skill.sourceType}:${skill.skillId}:${skill.revisionId}`;
      return !activeKeys.has(key);
    });
  }

  private async autoAttachSkillsForTool(toolName: string, signal?: AbortSignal): Promise<ManagedSkillContext[]> {
    const candidates = this.findAutoAttachableSkillsForTool(toolName);
    if (candidates.length === 0) {
      return [];
    }
    const resolved = await userSkillService.resolveSelectionsForSession(
      this.input.sessionId,
      candidates.map((item) => ({
        sourceType: item.sourceType,
        skillId: item.skillId,
        revisionId: item.revisionId,
      }))
    );
    this.ensureNotAborted(signal);
    if (resolved.length === 0) {
      return [];
    }

    await sandboxSkillSyncService.syncResolvedSkills({
      taskSessionId: this.input.sessionId,
      orchestratorSessionId: this.input.sandboxId,
      skills: resolved as any,
    });
    this.ensureNotAborted(signal);

    const existingKeys = new Set(
      this.input.activeSkills.map((item) => `${item.sourceType}:${item.skillId}:${item.revisionId}`)
    );
    const activated: ManagedSkillContext[] = [];
    for (const skill of resolved as ManagedSkillContext[]) {
      const key = `${skill.sourceType}:${skill.skillId}:${skill.revisionId}`;
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      this.input.activeSkills.push(skill);
      activated.push(skill);
    }

    if (activated.length > 0) {
      try {
        await taskSessionSkillStateService.recordRuntimeAutoAttachedSkills({
          sessionId: this.input.sessionId,
          sandboxId: this.input.sandboxId,
          workspaceRoot: this.input.workspaceRoot,
          activatedSkills: activated,
          toolName,
          taskIntentProfile: this.input.taskIntentProfile || {
            mode: 'neutral',
            reason: 'unknown',
            recentUserMessages: [],
            explicitNoDeploy: false,
            explicitNoWeb: false,
            webArtifactRequested: false,
            deployRequested: false,
            scriptArtifactRequested: false,
            emailTemplateRequested: false,
            deploymentAllowed: true,
            needsClarification: false,
            clarificationQuestion: '',
            clarificationType: 'none',
            todoRequired: false,
            todoReason: 'none',
          },
        });
      } catch (error) {
        console.warn('[ALTUS_RUNTIME_AUTO_ATTACHED_SKILLS_PERSIST_WARN]', {
          taskSessionId: this.input.sessionId,
          sandboxId: this.input.sandboxId,
          toolName,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      writeConnectorDebugLog('[ALTUS_RUNTIME_AUTO_ATTACHED_SKILLS]', {
        taskSessionId: this.input.sessionId,
        sandboxId: this.input.sandboxId,
        toolName,
        skillSlugs: activated.map((item) => item.slug),
      });
    }

    return activated;
  }

  private enforceDeploymentIntent(toolName: string) {
    if (
      toolName !== 'deploy_application' &&
      toolName !== 'redeploy_application' &&
      toolName !== 'rollback_application_deployment' &&
      toolName !== 'get_application_deployment_status'
    ) {
      return;
    }
    const profile = this.input.taskIntentProfile;
    if (!profile || profile.deploymentAllowed) {
      return;
    }
    const recentContext = profile.recentUserMessages.slice(-3).join(' | ');
    throw new Error(
      [
        'deployment_tool_not_allowed_without_explicit_request',
        `reason=${profile.reason}`,
        `current_session_intent=${profile.mode}`,
        'current_session_deployment_allowed=false',
        'do_not_enter_deployment_flow_without_an_explicit_user_request',
        recentContext ? `recent_user_messages=${recentContext}` : '',
      ]
        .filter(Boolean)
        .join(':')
    );
  }

  async execute(toolName: string, rawArgs: Record<string, unknown>, signal?: AbortSignal): Promise<ManagedToolResult> {
    this.ensureNotAborted(signal);
    await this.sandboxActivityDeps.touchSandbox(this.input.sandboxId, `managed_tool:${toolName}`).catch(() => null);
    this.enforceDeploymentIntent(toolName);
    const activatedSkills = await this.autoAttachSkillsForTool(toolName, signal);
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
        activatedSkills,
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

    const mcpTool =
      this.buildMcpToolMap().get(toolName) || this.buildRawMcpToolMap().get(toolName);
    if (mcpTool) {
      if (mcpTool.connectorKey) {
        const activeGuide = await connectorGuideService.getActiveGuideForConnector(
          this.input.sessionId,
          mcpTool.connectorKey
        );
        this.ensureNotAborted(signal);
        const confirmationToken = asText(rawArgs.confirmationToken);
        const confirmationAgentRunId = asText(rawArgs.confirmationAgentRunId);
        if (
          activeGuide &&
          !this.loadedConnectorGuides.has(mcpTool.connectorKey) &&
          confirmationToken
        ) {
          this.loadedConnectorGuides.add(mcpTool.connectorKey);
          writeConnectorDebugLog('[CONNECTOR_GUIDE_RUNTIME_REPLAY_PRELOADED]', {
            taskSessionId: this.input.sessionId,
            connectorKey: mcpTool.connectorKey,
            toolName: mcpTool.toolName,
            managedToolName: toolName,
            revisionId: activeGuide.revisionId,
            replayMode: confirmationAgentRunId ? 'token_with_origin_run' : 'token_without_origin_run',
          });
        }
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
        activatedSkills,
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
      const runMode = normalizeShellRunMode(rawArgs.runMode);
      if (
        isLegacyNotionMcpShellCommand(command) &&
        (await connectorGuideService.getActiveGuideForConnector(this.input.sessionId, 'notion'))
      ) {
        throw new Error(
          [
            'notion_legacy_mcp_shell_blocked:当前会话的 Notion 已通过 oneceo API broker + Composio Tool Router 挂载。',
            '禁止在 sandbox 内安装或运行 @notionhq/mcp-cli / notion-mcp / mcp.notion.com。',
            '请先调用 load_connector_guide(connectorKey=notion)，然后使用已挂载的 notion__COMPOSIO_SEARCH_TOOLS、notion__COMPOSIO_GET_TOOL_SCHEMAS、notion__COMPOSIO_MULTI_EXECUTE_TOOL。',
          ].join('\n')
        );
      }
      if (
        isLegacyFigmaMcpShellCommand(command) &&
        (await connectorGuideService.getActiveGuideForConnector(this.input.sessionId, 'figma'))
      ) {
        throw new Error(
          [
            'figma_legacy_mcp_shell_blocked: Figma is attached through oneceo API broker + Composio Tool Router.',
            'Do not install or run local Figma MCP tooling, and do not place Figma tokens in the sandbox.',
            'Call load_connector_guide(connectorKey=figma), then use the attached figma__COMPOSIO_SEARCH_TOOLS and related Figma router tools.',
          ].join('\n')
        );
      }
      if (
        isLegacySupabaseMcpShellCommand(command) &&
        (await connectorGuideService.getActiveGuideForConnector(this.input.sessionId, 'supabase'))
      ) {
        throw new Error(
          [
            'supabase_legacy_mcp_shell_blocked: Supabase is attached through oneceo API broker + Composio Tool Router.',
            'Do not install or run local Supabase MCP tooling, and do not place Supabase or Composio tokens in the sandbox.',
            'Call load_connector_guide(connectorKey=supabase), then use the attached supabase__COMPOSIO_SEARCH_TOOLS and related Supabase router tools.',
          ].join('\n')
        );
      }
      if (
        isLegacySlackMcpShellCommand(command) &&
        (await connectorGuideService.getActiveGuideForConnector(this.input.sessionId, 'slack'))
      ) {
        throw new Error(
          [
            'slack_legacy_mcp_shell_blocked: Slack is attached through oneceo API broker + Composio Tool Router.',
            'Do not install or run local Slack MCP tooling, and do not place Slack or Composio tokens in the sandbox.',
            'Call load_connector_guide(connectorKey=slack), then use the attached slack__COMPOSIO_SEARCH_TOOLS and related Slack router tools.',
          ].join('\n')
        );
      }
      if (
        isCustomApiBypassShellCommand(command) &&
        (await connectorGuideService.getActiveGuideForConnector(this.input.sessionId, 'custom_api'))
      ) {
        throw new Error(
          [
            'custom_api_shell_broker_bypass_blocked: Custom API is attached through the oneceo API broker.',
            'Do not call external Custom API endpoints from shell or place Custom API tokens in the sandbox.',
            'Call load_connector_guide(connectorKey=custom_api), then use the attached custom_api MCP tools.',
          ].join('\n')
        );
      }
      if (
        isCustomMcpBypassShellCommand(command) &&
        (await connectorGuideService.getActiveGuideForConnector(this.input.sessionId, 'custom_mcp'))
      ) {
        throw new Error(
          [
            'custom_mcp_shell_broker_bypass_blocked: Custom MCP is attached through the oneceo API broker.',
            'Do not run local stdio MCP servers, curl remote MCP URLs, or place Custom MCP secrets in the sandbox.',
            'Call load_connector_guide(connectorKey=custom_mcp), then use the attached custom_mcp provider tools.',
          ].join('\n')
        );
      }
      const deploymentIntentActive =
        this.hasActiveSkill('deployment-orchestrator') || this.input.taskIntentProfile?.deploymentAllowed === true;
      if (deploymentIntentActive && isLocalPreviewOrDevCommand(command)) {
        throw new Error(
          'deployment_shell_preview_blocked:部署链路禁止使用本地 preview/dev 命令。请改用 deploy_application、redeploy_application 或 get_application_deployment_status，并依赖平台导出的标准 start/healthcheck 配置。'
        );
      }
      const cwd = asText(rawArgs.cwd) || '.';
      if (isPersistentLocalServerCommand(command)) {
        if (runMode === 'foreground') {
          throw new Error(
            'shell_execute_persistent_local_server_foreground_blocked:检测到本地常驻服务启动命令。请使用 runMode=background_service 或保持 runMode=auto 交给平台托管。'
          );
        }
        return {
          activatedSkills,
          ...(await this.startControlledBackgroundService(command, cwd, signal)),
        };
      }
      await this.prepareFrontendBuildWorkspace(command, cwd, signal);
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
        activatedSkills,
        content: JSON.stringify({
          cwd: this.relativeForDisplay(this.resolveWorkspacePath(cwd, { allowWorkspaceRoot: true })),
          exitCode,
          stdout,
          stderr,
        }),
      };
    }

    if (toolName === 'debug_open_page') {
      const normalizedTarget = normalizeDebugTargetUrl(rawArgs.url, this.input.workspaceRoot);
      const targetUrl = normalizedTarget.targetUrl;
      const ensureDebug = rawArgs.ensureDebug === undefined ? true : asBoolean(rawArgs.ensureDebug);
      const cdpPort = asPositiveInt(process.env.NEKO_CDP_PORT, 9222, 65535);
      let debugInfo: Awaited<ReturnType<typeof ensureNekoDebug>> | null = null;
      if (ensureDebug) {
        let dynamicIceServers: Array<{ urls: string[]; username?: string; credential?: string }> | null = null;
        try {
          dynamicIceServers = await this.debugDeps.issueIceServersForUser(this.input.userId);
        } catch (error) {
          console.warn('[MANAGED_DEBUG_TURN_ICE_GENERATE_FAILED]', {
            sessionId: this.input.sessionId,
            userId: this.input.userId,
            error: error instanceof Error ? error.message : String(error || ''),
          });
        }
        debugInfo = await this.debugDeps.ensureNekoDebug(this.input.sandboxId, {
          requireTurn: true,
          strictIceCheck: true,
          ...(dynamicIceServers ? { iceServers: dynamicIceServers } : {}),
        });
        if (!debugInfo.ready || debugInfo.status === 'failed') {
          const reason = asText((debugInfo as any)?.reasonCode) || 'debug_not_ready';
          const message = asText(debugInfo.message) || 'debug_not_ready';
          throw new Error(`debug_open_page_debug_not_ready:${reason}:${message}`);
        }
      }

      const encodedUrl = encodeURIComponent(targetUrl);
      const escapedTargetUrl = shellEscape(targetUrl);
      const command = [
        `cdp_port=${cdpPort}`,
        `target_url=${escapedTargetUrl}`,
        `target_protocol=${shellEscape(normalizedTarget.protocol)}`,
        `target_file=${shellEscape(normalizedTarget.localFilePath || '')}`,
        `encoded_url=${shellEscape(encodedUrl)}`,
        'debug_status="ok"',
        'probe_file="/tmp/oneceo_debug_target_probe_${cdp_port}.html"',
        'if [ "$target_protocol" = "file" ]; then',
        '  if [ -f "$target_file" ]; then',
        '    probe_effective_url="$target_url"',
        '    echo "__ONECEO_DEBUG_TARGET_FILE_READY__=$target_file"',
        '  else',
        '    debug_status="target_file_missing"',
        '    echo "__ONECEO_DEBUG_TARGET_FILE_MISSING__=$target_file"',
        '  fi',
        'else',
        '  probe_result=$(curl -k -L -sS --max-time 8 -o "$probe_file" -w "%{http_code} %{url_effective}" "$target_url" 2>&1) || debug_status="target_unreachable"',
        '  if [ "$debug_status" = "target_unreachable" ]; then',
        '    echo "__ONECEO_DEBUG_TARGET_UNREACHABLE__"',
        '    echo "$probe_result"',
        '  else',
        '    probe_status=$(printf "%s" "$probe_result" | awk \'{print $1}\')',
        '    probe_effective_url=$(printf "%s" "$probe_result" | cut -d" " -f2-)',
        '    case "$probe_status" in',
        '      2*|3*) ;;',
        '      *)',
        '        debug_status="target_bad_status"',
        '        echo "__ONECEO_DEBUG_TARGET_BAD_STATUS__=$probe_status"',
        '        head -c 800 "$probe_file" 2>/dev/null || true',
        '        ;;',
        '    esac',
        '  fi',
        'fi',
        'endpoint="http://127.0.0.1:${cdp_port}/json/new?${encoded_url}"',
        'if [ "$debug_status" = "ok" ]; then',
        '  if curl -fsS -X PUT "$endpoint"; then',
        '    echo "\\n__OPENED_BY__=PUT"',
        '  elif curl -fsS "$endpoint"; then',
        '    echo "\\n__OPENED_BY__=GET"',
        '  else',
        '    debug_status="open_failed"',
        '    echo "__ONECEO_DEBUG_OPEN_PAGE_FAILED__"',
        '  fi',
        'fi',
        'if [ "$debug_status" = "ok" ]; then',
        '  tab_ready=0',
        '  for i in 1 2 3 4 5; do',
        '    curl -fsS --max-time 2 "http://127.0.0.1:${cdp_port}/json/list" > /tmp/oneceo_debug_tabs_${cdp_port}.json 2>/dev/null || true',
        '    if python3 - "$target_url" "${probe_effective_url:-}" /tmp/oneceo_debug_tabs_${cdp_port}.json <<\'PY\'',
        'import json, sys',
        'target = sys.argv[1]',
        'effective = sys.argv[2]',
        'path = sys.argv[3]',
        'try:',
        '    tabs = json.load(open(path, "r", encoding="utf-8"))',
        'except Exception:',
        '    sys.exit(1)',
        'for tab in tabs if isinstance(tabs, list) else []:',
        '    url = str(tab.get("url") or "")',
        '    title = str(tab.get("title") or "")',
        '    if url == target or (effective and url == effective):',
        '        print("__ONECEO_DEBUG_TARGET_TAB_READY__=" + title[:160])',
        '        sys.exit(0)',
        'sys.exit(1)',
        'PY',
        '    then',
        '      tab_ready=1',
        '      break',
        '    fi',
        '    sleep 1',
        '  done',
        '  if [ "$tab_ready" != "1" ]; then',
        '    debug_status="tab_not_ready"',
        '    echo "__ONECEO_DEBUG_TARGET_TAB_NOT_READY__"',
        '    cat /tmp/oneceo_debug_tabs_${cdp_port}.json 2>/dev/null || true',
        '  fi',
        'fi',
        'echo "__ONECEO_DEBUG_RESULT__=${debug_status}"',
        'exit 0',
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
      if (
        exitCode !== 0 ||
        !stdout.includes('__ONECEO_DEBUG_RESULT__=ok') ||
        stdout.includes('__ONECEO_DEBUG_OPEN_PAGE_FAILED__') ||
        stdout.includes('__ONECEO_DEBUG_TARGET_UNREACHABLE__') ||
        stdout.includes('__ONECEO_DEBUG_TARGET_FILE_MISSING__') ||
        stdout.includes('__ONECEO_DEBUG_TARGET_BAD_STATUS__') ||
        stdout.includes('__ONECEO_DEBUG_TARGET_TAB_NOT_READY__')
      ) {
        throw new Error(`debug_open_page_failed:${stderr || stdout || 'unknown error'}`);
      }

      await this.markWorkspaceDirty('managed_debug_open_page');
      return {
        type: 'result',
        activatedSkills,
        content: JSON.stringify({
          targetUrl,
          debugUrl: debugInfo?.url,
          ready: debugInfo?.ready ?? false,
          status: debugInfo?.status || 'unknown',
          sandboxId: this.input.sandboxId,
          cdpPort,
          protocol: normalizedTarget.protocol,
          localFilePath: normalizedTarget.localFilePath,
          output: stdout,
        }),
      };
    }

    if (toolName === 'browser_interact') {
      const action = normalizeBrowserInteractAction(rawArgs.action);
      const cdpPort = asPositiveInt(process.env.NEKO_CDP_PORT, 9222, 65535);
      const xRaw = Number(rawArgs.x);
      const yRaw = Number(rawArgs.y);
      const command = buildBrowserInteractCommand({
        action,
        selector: asText(rawArgs.selector),
        text: asText(rawArgs.text),
        key: asText(rawArgs.key),
        direction: asText(rawArgs.direction),
        loadState: asText(rawArgs.loadState),
        pixels: asPositiveInt(rawArgs.pixels, 600, 5000),
        x: Number.isFinite(xRaw) ? xRaw : null,
        y: Number.isFinite(yRaw) ? yRaw : null,
        timeoutMs: asPositiveInt(rawArgs.timeoutMs, 5000, 30000),
        description: asText(rawArgs.description),
        cdpPort,
      });
      const result = await this.runShell(
        command,
        {
          cwd: this.input.workspaceRoot,
          timeoutMs: asPositiveInt(rawArgs.timeoutMs, 5000, 30000) + 10_000,
        },
        signal
      );
      const exitCode = Number((result as any)?.exitCode ?? -1);
      const stdout = truncate(asText((result as any)?.stdout), 4000);
      const stderr = truncate(asText((result as any)?.stderr), 2000);
      if (exitCode !== 0) {
        throw new Error(`browser_interact_failed:${stderr || stdout || 'unknown error'}`);
      }
      return {
        type: 'result',
        activatedSkills,
        content: JSON.stringify({
          action,
          description: asText(rawArgs.description),
          selector: asText(rawArgs.selector),
          text: asText(rawArgs.text),
          key: asText(rawArgs.key),
          direction: asText(rawArgs.direction),
          loadState: normalizeLoadState(rawArgs.loadState),
          pixels: asPositiveInt(rawArgs.pixels, 600, 5000),
          cdpPort,
          output: stdout,
        }),
      };
    }

    if (isManagedDeploymentToolName(toolName)) {
      const result = await altusManagedDeploymentToolService.execute({
        action: toolName,
        sessionId: this.input.sessionId,
        userId: this.input.userId,
        sandboxId: this.input.sandboxId,
        workspaceRoot: this.input.workspaceRoot,
        notes: asText(rawArgs.notes),
      });
      return {
        type: 'result',
        activatedSkills,
        content: JSON.stringify(result),
      };
    }

    if (isManagedResourceToolName(toolName)) {
      const result = await altusManagedResourceToolService.execute({
        action: toolName,
        sessionId: this.input.sessionId,
        userId: this.input.userId,
        reason: asText(rawArgs.reason),
      });
      return {
        type: 'result',
        activatedSkills,
        content: JSON.stringify(result),
      };
    }

    if (toolName === 'read_file') {
      const absolutePath = this.resolveWorkspacePath(rawArgs.path);
      const bytes = await e2bConnector.readFile(this.input.sandboxId, absolutePath);
      this.ensureNotAborted(signal);
      const content = Buffer.from(bytes).toString('utf-8');
      return {
        type: 'result',
        activatedSkills,
        content: JSON.stringify({
          path: this.relativeForDisplay(absolutePath),
          content: truncate(content, 24000),
        }),
      };
    }

    if (toolName === 'write_file') {
      const absolutePath = this.resolveWorkspacePath(rawArgs.path);
      const relativePath = this.relativeForDisplay(absolutePath);
      this.assertWriteFileTargetAllowed(relativePath);
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
        activatedSkills,
        content: JSON.stringify({
          path: relativePath,
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
        activatedSkills,
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
        activatedSkills,
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
        activatedSkills,
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
        activatedSkills,
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
      const activeSkill = findActiveSkillForResourceLoad(this.input.activeSkills, { skillId, revisionId });
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
        activatedSkills,
        content: JSON.stringify({
          skillId: result.skillId,
          revisionId: result.revisionId,
          slug: result.slug,
          resourcePath: result.resourcePath,
          resourceType: result.resourceType,
          skillResourcePath: result.skillResourcePath,
          contentMarkdown: result.contentMarkdown,
          usageHint: 'Use contentMarkdown directly before reading skillResourcePath from the sandbox.',
        }),
      };
    }

    if (toolName === 'render_pptx_from_instructions') {
      if (!this.hasActiveSkill('ppt-workflow')) {
        throw new Error('render_pptx_from_instructions_ppt_workflow_not_active');
      }
      const result = await pptRenderToolService.render({
        sessionId: this.input.sessionId,
        sandboxId: this.input.sandboxId,
        workspaceRoot: this.input.workspaceRoot,
        instructions: rawArgs.instructions,
        outputFileName: asText(rawArgs.outputFileName) || null,
      });
      if (result.status === 'completed') {
        if (result.pptxPath) {
          this.renderedPptxAttachmentPaths.add(result.pptxPath);
        }
        await this.sandboxActivityDeps.markSandboxDirty(this.input.sandboxId, 'ppt_render');
      }
      return {
        type: 'result',
        activatedSkills,
        content: JSON.stringify(result),
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
      const clarificationType = asText(rawArgs.clarificationType);
      const normalizedClarificationType =
        clarificationType === 'artifact_type' ||
        clarificationType === 'tech_stack' ||
        clarificationType === 'scope_boundary' ||
        clarificationType === 'integration_target' ||
        clarificationType === 'acceptance_requirement'
          ? clarificationType
          : undefined;
      return {
        type: 'ask_user',
        activatedSkills,
        question,
        options: options.length > 0 ? options : undefined,
        clarificationType: normalizedClarificationType,
      };
    }

    if (toolName === 'todowrite') {
      const todos = this.parseTodos(rawArgs.todos);
      return {
        type: 'result',
        activatedSkills,
        content: JSON.stringify({ todos }),
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
      const attachments = this.parseCompletionAttachments(rawArgs.attachments, {
        requireArray: Object.prototype.hasOwnProperty.call(rawArgs, 'attachments'),
      });
      if (this.shouldRequireDownloadableAttachments() && attachments.length === 0) {
        throw new Error('complete_task_downloadable_requires_attachments');
      }
      this.assertPptxAttachmentsWereRendered(attachments);
      return {
        type: 'complete',
        activatedSkills,
        summary,
        verification: verification.length > 0 ? verification : undefined,
        attachments: attachments.length > 0 ? attachments : undefined,
      };
    }

    throw new Error(`unsupported_tool:${toolName}`);
  }
}
