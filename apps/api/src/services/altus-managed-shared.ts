import { createHash } from 'node:crypto';

export type ChatMessageContentPart =
  | {
      type: 'text';
      text: string;
    }
  | {
      type: 'image_url';
      image_url: {
        url: string;
      };
      _managedObjectKey?: string;
    };

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | ChatMessageContentPart[];
  tool_call_id?: string;
  name?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
};

export type ManagedRunStartInput = {
  content: string;
  messageKey?: string;
  metadata?: Record<string, unknown>;
};

export type ManagedSkillContext = {
  sourceType: 'platform' | 'custom';
  skillId: string;
  revisionId: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  renderedMarkdown: string;
  revisionNumber: number | null;
  resourceSummary?: {
    totalCount: number;
    referenceCount: number;
    templateCount: number;
    paths: string[];
  } | null;
  governance?: {
    systemRole: string | null;
    adminManaged: boolean;
    required: boolean;
    autoActivation: {
      enabled: boolean;
      triggers: string[];
      toolNames: string[];
    };
  } | null;
};

export type ManagedSkillCatalogEntry = {
  sourceType: 'platform' | 'custom';
  skillId: string;
  revisionId: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  revisionNumber: number | null;
  resourceSummary?: {
    totalCount: number;
    referenceCount: number;
    templateCount: number;
    paths: string[];
  } | null;
  governance?: {
    systemRole: string | null;
    adminManaged: boolean;
    required: boolean;
    autoActivation: {
      enabled: boolean;
      triggers: string[];
      toolNames: string[];
    };
  } | null;
};

export type ManagedRunSummary = {
  id: string;
  sessionId: string;
  status?: string;
  model?: string | null;
  stopReason?: string | null;
  streamUrl?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  updatedAt?: string | null;
  sequence?: number | null;
};

export type ToolCall = {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
};

export type ManagedCompletionAttachment = {
  path: string;
  name?: string;
  mimeType?: string;
};

export type ManagedMcpTool = {
  providerId: string;
  toolName: string;
  title?: string | null;
  description?: string | null;
  inputSchema?: Record<string, unknown> | null;
};

export type ManagedMcpProvider = {
  connectorKey?: string | null;
  providerId: string;
  transport?: string | null;
  envVersion?: number;
  tools: ManagedMcpTool[];
};

type JsonSchema =
  | {
      type: 'string' | 'number' | 'integer' | 'boolean';
      description?: string;
      enum?: string[];
    }
  | {
      type: 'array';
      description?: string;
      items: JsonSchema;
    }
  | {
      type: 'object';
      description?: string;
      properties: Record<string, JsonSchema>;
      required: string[];
      additionalProperties: boolean;
    };

export function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function pickObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => asText(item)).filter(Boolean);
}

function normalizeSkillGovernance(value: unknown): ManagedSkillContext['governance'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const autoActivation = pickObject(record.autoActivation);
  return {
    systemRole: asText(record.systemRole) || null,
    adminManaged: Boolean(record.adminManaged),
    required: Boolean(record.required),
    autoActivation: {
      enabled: Boolean(autoActivation.enabled),
      triggers: readStringArray(autoActivation.triggers),
      toolNames: readStringArray(autoActivation.toolNames),
    },
  };
}

function skillKey(value: {
  sourceType: 'platform' | 'custom';
  skillId: string;
  revisionId: string;
}) {
  return `${value.sourceType}:${value.skillId}:${value.revisionId}`;
}

export function normalizeManagedSkillContexts(value: unknown): ManagedSkillContext[] {
  if (!Array.isArray(value)) return [];
  const results = new Map<string, ManagedSkillContext>();
  for (const item of value) {
    const record = pickObject(item);
    const skillId = asText(record.skillId);
    const revisionId = asText(record.revisionId);
    const slug = asText(record.slug);
    if (!skillId || !revisionId || !slug) continue;
    const sourceType = asText(record.sourceType) === 'custom' ? 'custom' : 'platform';
    const normalized: ManagedSkillContext = {
      sourceType,
      skillId,
      revisionId,
      slug,
      name: asText(record.name) || slug,
      description: asText(record.description),
      category: asText(record.category) || 'general',
      renderedMarkdown: asText(record.renderedMarkdown),
      revisionNumber:
        typeof record.revisionNumber === 'number' && Number.isFinite(record.revisionNumber)
          ? Math.floor(record.revisionNumber)
          : null,
      resourceSummary:
        record.resourceSummary && typeof record.resourceSummary === 'object' && !Array.isArray(record.resourceSummary)
          ? (record.resourceSummary as ManagedSkillContext['resourceSummary'])
          : null,
      governance: normalizeSkillGovernance(record.governance),
    };
    results.set(skillKey(normalized), normalized);
  }
  return Array.from(results.values());
}

export function normalizeManagedSkillCatalogEntries(value: unknown): ManagedSkillCatalogEntry[] {
  if (!Array.isArray(value)) return [];
  const results = new Map<string, ManagedSkillCatalogEntry>();
  for (const item of value) {
    const record = pickObject(item);
    const skillId = asText(record.skillId);
    const revisionId = asText(record.revisionId);
    const slug = asText(record.slug);
    if (!skillId || !revisionId || !slug) continue;
    const sourceType = asText(record.sourceType) === 'custom' ? 'custom' : 'platform';
    const normalized: ManagedSkillCatalogEntry = {
      sourceType,
      skillId,
      revisionId,
      slug,
      name: asText(record.name) || slug,
      description: asText(record.description),
      category: asText(record.category) || 'general',
      revisionNumber:
        typeof record.revisionNumber === 'number' && Number.isFinite(record.revisionNumber)
          ? Math.floor(record.revisionNumber)
          : null,
      resourceSummary:
        record.resourceSummary && typeof record.resourceSummary === 'object' && !Array.isArray(record.resourceSummary)
          ? (record.resourceSummary as ManagedSkillCatalogEntry['resourceSummary'])
          : null,
      governance: normalizeSkillGovernance(record.governance),
    };
    results.set(skillKey(normalized), normalized);
  }
  return Array.from(results.values());
}

export function managedSkillContextToCatalogEntry(skill: ManagedSkillContext): ManagedSkillCatalogEntry {
  return {
    sourceType: skill.sourceType,
    skillId: skill.skillId,
    revisionId: skill.revisionId,
    slug: skill.slug,
    name: skill.name,
    description: skill.description,
    category: skill.category,
    revisionNumber: skill.revisionNumber,
    resourceSummary: skill.resourceSummary || null,
    governance: skill.governance || null,
  };
}

export function mergeManagedSkillCatalogEntries(
  primary: ManagedSkillCatalogEntry[],
  fallback: ManagedSkillCatalogEntry[]
): ManagedSkillCatalogEntry[] {
  const results = new Map<string, ManagedSkillCatalogEntry>();
  for (const item of primary) {
    results.set(skillKey(item), item);
  }
  for (const item of fallback) {
    const key = skillKey(item);
    if (!results.has(key)) {
      results.set(key, item);
    }
  }
  return Array.from(results.values());
}

export function toIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const text = asText(value);
  if (!text) return null;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function truncate(value: string, limit = 16000) {
  if (!value || value.length <= limit) return value;
  return `${value.slice(0, limit)}\n...[truncated]`;
}

const MANAGED_DEBUG_PAYLOAD_KEYS = new Set([
  'transitionReason',
  'currentRound',
  'maxRounds',
  'recoveryMode',
  'loop',
  'debug',
  'internalDebug',
]);

export function stripManagedDebugPayload(payload: Record<string, unknown>) {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload || {})) {
    if (MANAGED_DEBUG_PAYLOAD_KEYS.has(key)) {
      continue;
    }
    sanitized[key] = value;
  }
  return sanitized;
}

export function parseToolArguments(raw: string) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return pickObject(parsed);
  } catch {
    return {};
  }
}

export function isManagedRunTerminalStatus(value: unknown) {
  const text = asText(value);
  return text === 'completed' || text === 'failed' || text === 'stopped';
}

export function buildManagedToolDefinitions() {
  const objectSchema = (
    properties: Record<string, JsonSchema>,
    required: string[] = [],
    description?: string
  ): JsonSchema => ({
    type: 'object',
    description,
    properties,
    required,
    additionalProperties: false,
  });

  return [
    {
      type: 'function',
      function: {
        name: 'shell_execute',
        description:
          'Run a shell command inside the E2B sandbox workspace. Persistent local preview/dev server commands are automatically managed as background services in auto mode, with pid/log/url returned for debugging.',
        parameters: objectSchema(
          {
            command: { type: 'string', description: 'Shell command to execute.' },
            cwd: { type: 'string', description: 'Workspace-relative directory. Defaults to workspace root.' },
            timeoutMs: { type: 'integer', description: 'Timeout in milliseconds, max 120000.' },
            runMode: {
              type: 'string',
              enum: ['auto', 'foreground', 'background_service'],
              description:
                'Execution mode. Default auto. Use background_service for long-running preview/dev servers; foreground rejects persistent service commands.',
            },
          },
          ['command']
        ),
      },
    },
    {
      type: 'function',
      function: {
        name: 'debug_open_page',
        description:
          'Start website debugging behavior by opening a target http/https URL, or a file:// URL inside the workspace, in the sandbox Chromium debug session shown by n.eko. Before calling this for product/app QA, write or update a workspace test document such as docs/test-plan.md, then use this tool as the testing-phase browser entry. The tool verifies the target is reachable/readable and the CDP tab is ready before reporting success. After this, use Playwright/playwright-mcp against the same CDP 9222 browser for functional testing, record defects in the test document, repair, and retest before final delivery. Use this when users ask to 启动网站调试功能 or open a page in the debug view.',
        parameters: objectSchema(
          {
            url: {
              type: 'string',
              description:
                'Target URL to open in Chromium. Use http:// or https:// for running services. For standalone HTML deliverables, file:// URLs are allowed only when the file is inside the workspace.',
            },
            ensureDebug: {
              type: 'boolean',
              description: 'Whether to ensure n.eko debug service is ready before opening the page. Default true.',
            },
          },
          ['url']
        ),
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_interact',
        description:
          'Perform one explicit Playwright-backed browser testing action in the same n.eko Chromium debug session after debug_open_page succeeds. Supported actions are direct projections of Playwright APIs: locator.click, getByText(...).click, mouse.click, locator.fill, keyboard.type, keyboard.press, mouse.wheel, locator.waitFor, getByText(...).waitFor, page.waitForLoadState, and page.waitForTimeout. Each call should describe exactly what user-visible action is being performed.',
        parameters: objectSchema(
          {
            action: {
              type: 'string',
              enum: [
                'locator_click',
                'text_click',
                'coordinate_click',
                'locator_fill',
                'keyboard_type',
                'keyboard_press',
                'mouse_wheel',
                'wait_for_locator',
                'wait_for_text',
                'wait_for_load_state',
                'wait_for_timeout',
              ],
              description: 'Playwright-backed browser action to perform.',
            },
            description: {
              type: 'string',
              description:
                'Short user-facing action description, for example 打开网页后点击“新游戏”按钮, 按下 ArrowUp 键, 向下滚动页面.',
            },
            selector: {
              type: 'string',
              description:
                'Playwright locator selector for locator_click, locator_fill, wait_for_locator, or optional scoped wait_for_text.',
            },
            text: {
              type: 'string',
              description:
                'Text for text_click, locator_fill, keyboard_type, or wait_for_text.',
            },
            key: {
              type: 'string',
              description: 'Keyboard key for keyboard_press, for example ArrowUp, Enter, Escape, Tab.',
            },
            direction: {
              type: 'string',
              enum: ['up', 'down', 'left', 'right'],
              description: 'Wheel direction for mouse_wheel.',
            },
            pixels: {
              type: 'integer',
              description: 'Wheel distance in pixels for mouse_wheel. Defaults to 600.',
            },
            x: {
              type: 'number',
              description: 'Optional viewport x coordinate for click.',
            },
            y: {
              type: 'number',
              description: 'Optional viewport y coordinate for click.',
            },
            loadState: {
              type: 'string',
              enum: ['domcontentloaded', 'load', 'networkidle'],
              description: 'Load state for wait_for_load_state. Defaults to domcontentloaded.',
            },
            timeoutMs: {
              type: 'integer',
              description: 'Timeout for wait actions, max 30000.',
            },
          },
          ['action']
        ),
      },
    },
    {
      type: 'function',
      function: {
        name: 'deploy_application',
        description:
          'Publish the current app workspace through the OneCEO managed deployment pipeline. Use this when the user asks to deploy, publish, go live, or上线 the current project.',
        parameters: objectSchema({
          notes: {
            type: 'string',
            description: 'Optional short note about the deploy request.',
          },
        }),
      },
    },
    {
      type: 'function',
      function: {
        name: 'redeploy_application',
        description:
          'Republish the current app workspace after code changes. Use this when the user asks to redeploy, republish, or publish the latest edits.',
        parameters: objectSchema({
          notes: {
            type: 'string',
            description: 'Optional short note about the redeploy request.',
          },
        }),
      },
    },
    {
      type: 'function',
      function: {
        name: 'rollback_application_deployment',
        description:
          'Roll back the current app deployment to the previous available version when the user explicitly asks to revert or rollback deployment.',
        parameters: objectSchema({
          notes: {
            type: 'string',
            description: 'Optional short note about the rollback request.',
          },
        }),
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_application_deployment_status',
        description:
          'Query the latest managed deployment status, current URL, and deployment health for the current app.',
        parameters: objectSchema({}),
      },
    },
    {
      type: 'function',
      function: {
        name: 'ensure_project_database',
        description:
          'Explicitly create or repair the fixed managed Railway Postgres database for the current user project/session, in the same Railway Environment as the app, inject database variables into the app service, and record an explicit database requirement for this session. Database engine selection is not part of this flow and should never be asked here. Use only when the user requirement clearly needs persistent relational data, accounts, records, authentication state, or SQL-backed storage.',
        parameters: objectSchema({
          reason: {
            type: 'string',
            description: 'Short reason why this project needs a database.',
          },
        }),
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_project_database_status',
        description:
          'Check whether the current project already has Railway Postgres enabled. This never creates resources.',
        parameters: objectSchema({}),
      },
    },
    {
      type: 'function',
      function: {
        name: 'inspect_project_database_schema',
        description:
          'Read the current Railway Postgres schema and table summary for the project. This never creates resources.',
        parameters: objectSchema({}),
      },
    },
    {
      type: 'function',
      function: {
        name: 'ensure_project_storage_bucket',
        description:
          'Explicitly create or repair the fixed managed Railway Bucket for the current user project/session, in the same Railway Environment as the app, inject S3 variables into the app service, and record an explicit object-storage requirement for this session. Object-storage engine selection is not part of this flow and should never be asked here. Use only when the user requirement clearly needs file uploads, media, attachments, exports, or object storage.',
        parameters: objectSchema({
          reason: {
            type: 'string',
            description: 'Short reason why this project needs object storage.',
          },
        }),
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_project_storage_status',
        description:
          'Check whether the current project already has a Railway Bucket enabled. This never creates resources and never returns plaintext secret keys.',
        parameters: objectSchema({}),
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read a UTF-8 text file from the workspace.',
        parameters: objectSchema(
          {
            path: { type: 'string', description: 'Workspace-relative file path.' },
          },
          ['path']
        ),
      },
    },
    {
      type: 'function',
      function: {
        name: 'write_file',
        description:
          'Write or replace a UTF-8 text file in the workspace. Do not use this for final docx/xlsx/pptx/pdf or archive deliverables.',
        parameters: objectSchema(
          {
            path: { type: 'string', description: 'Workspace-relative file path.' },
            content: { type: 'string', description: 'Full file content to write.' },
          },
          ['path', 'content']
        ),
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_directory',
        description: 'List files and directories under a workspace path.',
        parameters: objectSchema({
          path: { type: 'string', description: 'Workspace-relative directory path.' },
          depth: { type: 'integer', description: 'Recursion depth, max 6.' },
        }),
      },
    },
    {
      type: 'function',
      function: {
        name: 'search_code',
        description: 'Search code or text inside the workspace using ripgrep.',
        parameters: objectSchema(
          {
            query: { type: 'string', description: 'Search pattern or literal query.' },
            path: { type: 'string', description: 'Workspace-relative root to search in.' },
            limit: { type: 'integer', description: 'Maximum number of matches to return, max 300.' },
          },
          ['query']
        ),
      },
    },
    {
      type: 'function',
      function: {
        name: 'web_search',
        description:
          'Search the web for external facts, sources, and candidate images. Prefer this for PPT/docx/xlsx tasks that need current information or visual assets.',
        parameters: objectSchema(
          {
            query: { type: 'string', description: 'Search query in natural language.' },
            topic: {
              type: 'string',
              description: 'Optional search topic. Use general, news, or finance.',
            },
            maxResults: {
              type: 'integer',
              description: 'Maximum number of search results to return, max 8.',
            },
            includeImages: {
              type: 'boolean',
              description: 'Whether to include candidate image URLs in the result.',
            },
            searchDepth: {
              type: 'string',
              description: 'Optional search depth. Use basic for speed or advanced for richer retrieval.',
            },
            includeDomains: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional domain allowlist.',
            },
            excludeDomains: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional domain blocklist.',
            },
            timeRange: {
              type: 'string',
              description: 'Optional recency filter. Use day, week, month, or year when needed.',
            },
          },
          ['query']
        ),
      },
    },
    {
      type: 'function',
      function: {
        name: 'web_extract',
        description:
          'Extract structured content and images from known web pages after web_search identified useful URLs.',
        parameters: objectSchema(
          {
            urls: {
              type: 'array',
              items: { type: 'string' },
              description: 'One or more URLs to extract.',
            },
            extractDepth: {
              type: 'string',
              description: 'Optional extract depth. Use basic or advanced.',
            },
            includeImages: {
              type: 'boolean',
              description: 'Whether to include extracted image URLs.',
            },
            format: {
              type: 'string',
              description: 'Optional extract format. Use markdown or text.',
            },
            timeoutSeconds: {
              type: 'number',
              description: 'Optional extraction timeout in seconds, max 60.',
            },
          },
          ['urls']
        ),
      },
    },
    {
      type: 'function',
      function: {
        name: 'load_skill_resource',
        description:
          'Load one markdown resource file for an already selected skill into the sandbox skill directory when the current task needs more detail.',
        parameters: objectSchema(
          {
            skillId: {
              type: 'string',
              description: 'Skill id from the active skill list. Prefer the raw skillId, not display ids.',
            },
            revisionId: {
              type: 'string',
              description: 'Revision id from the active skill list. Prefer the raw revisionId, not display ids.',
            },
            resourcePath: {
              type: 'string',
              description: 'Relative markdown resource path such as references/foo.md or templates/bar.md.',
            },
          },
          ['skillId', 'revisionId', 'resourcePath']
        ),
      },
    },
    {
      type: 'function',
      function: {
        name: 'render_pptx_from_instructions',
        description:
          'Render a PPTX file in the sandbox from a validated PptRenderInstruction after ppt-workflow has produced and reviewed the deck plan. Use only when the user wants a final PowerPoint file.',
        parameters: objectSchema(
          {
            instructions: {
              type: 'object',
              description:
                'PptRenderInstruction object with deck, theme, slides, sources, and empty openQuestions.',
              properties: {},
              required: [],
              additionalProperties: true,
            },
            outputFileName: {
              type: 'string',
              description: 'Optional final .pptx filename, for example career-plan.pptx.',
            },
          },
          ['instructions']
        ),
      },
    },
    {
      type: 'function',
      function: {
        name: 'load_connector_guide',
        description:
          'Load the active connector usage guide for a session connector before first use of that connector MCP toolset in the current run.',
        parameters: objectSchema(
          {
            connectorKey: {
              type: 'string',
              description: 'Attached connector key such as github, supabase, or vercel.',
            },
          },
          ['connectorKey']
        ),
      },
    },
    {
      type: 'function',
      function: {
        name: 'todowrite',
        description:
          'Write or update the current execution todo list before starting substantial work and after each major step.',
        parameters: objectSchema(
          {
            todos: {
              type: 'array',
              description:
                'Ordered todo list. Use exactly one in_progress item while work is still ongoing; use zero only when every item is completed and complete_task is the immediate next action.',
              items: objectSchema(
                {
                  content: {
                    type: 'string',
                    description: 'Concrete todo item text visible to the user.',
                  },
                  status: {
                    type: 'string',
                    description: 'Todo status: pending, in_progress, or completed.',
                  },
                  activeForm: {
                    type: 'string',
                    description: 'Optional present-tense short form of the active step.',
                  },
                },
                ['content', 'status']
              ),
            },
          },
          ['todos']
        ),
      },
    },
    {
      type: 'function',
      function: {
        name: 'ask_user',
        description: 'Ask the user one precise clarification question when blocked by missing requirements.',
        parameters: objectSchema(
          {
            question: { type: 'string', description: 'The clarification question.' },
            options: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional suggested answer options.',
            },
            clarificationType: {
              type: 'string',
              description:
                'Optional structured missing-requirement field: artifact_type, tech_stack, scope_boundary, integration_target, or acceptance_requirement.',
            },
          },
          ['question']
        ),
      },
    },
    {
      type: 'function',
      function: {
        name: 'complete_task',
        description:
          'Finish the managed run only after the required workspace changes are done and verified.',
        parameters: objectSchema(
          {
            summary: {
              type: 'string',
              description: 'Short user-facing summary of what was completed.',
            },
            verification: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional short verification points, such as commands run or files checked.',
            },
            attachments: {
              type: 'array',
              description:
                'Required when the task produces user-downloadable files such as pptx/docx/xlsx/pdf/zip. Each attachment must point to a workspace-relative file path that already exists.',
              items: objectSchema(
                {
                  path: {
                    type: 'string',
                    description: 'Workspace-relative file path of the final deliverable.',
                  },
                  name: {
                    type: 'string',
                    description: 'Optional download filename to show to the user.',
                  },
                  mimeType: {
                    type: 'string',
                    description: 'Optional explicit MIME type for the deliverable.',
                  },
                },
                ['path']
              ),
            },
          },
          ['summary']
        ),
      },
    },
  ];
}

function sanitizeToolIdentifier(value: string) {
  const normalized = asText(value)
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || 'tool';
}

export function buildManagedMcpToolName(providerId: string, toolName: string) {
  const normalizedToolName = sanitizeToolIdentifier(toolName).toLowerCase();
  const providerDigest = createHash('sha1')
    .update(`${providerId}::${toolName}`)
    .digest('hex')
    .slice(0, 12);
  return `mcp__${normalizedToolName.slice(0, 40)}__${providerDigest}`;
}

export function buildManagedToolDefinitionsWithMcp(input?: { mcpProviders?: ManagedMcpProvider[] }) {
  const baseTools = buildManagedToolDefinitions();
  const providers = Array.isArray(input?.mcpProviders) ? input?.mcpProviders : [];
  const dynamicTools = providers.flatMap((provider) =>
    (Array.isArray(provider.tools) ? provider.tools : []).map((tool) => {
      const parameters =
        tool.inputSchema && typeof tool.inputSchema === 'object'
          ? tool.inputSchema
          : {
              type: 'object',
              properties: {},
              additionalProperties: true,
            };
      return {
        type: 'function',
        function: {
          name: buildManagedMcpToolName(provider.providerId, tool.toolName),
          description:
            asText(tool.description) ||
            `${asText(provider.connectorKey) || 'mcp'} tool ${tool.toolName} from provider ${provider.providerId}.`,
          parameters,
        },
      };
    })
  );
  return [...baseTools, ...dynamicTools];
}

export function readManagedSkillContext(value: unknown): ManagedSkillContext[] {
  if (!Array.isArray(value)) return [];
  const results: ManagedSkillContext[] = [];
  for (const item of value) {
    const record = pickObject(item);
    const skillId = asText(record.skillId);
    const revisionId = asText(record.revisionId);
    const slug = asText(record.slug);
    const name = asText(record.name);
    const renderedMarkdown = asText(record.renderedMarkdown);
    if (!skillId || !revisionId || !slug || !name || !renderedMarkdown) {
      continue;
    }
    results.push({
      sourceType: asText(record.sourceType) === 'custom' ? 'custom' : 'platform',
      skillId,
      revisionId,
      slug,
      name,
      description: asText(record.description),
      category: asText(record.category) || 'general',
      renderedMarkdown,
      revisionNumber:
        typeof record.revisionNumber === 'number' && Number.isFinite(record.revisionNumber)
          ? record.revisionNumber
          : null,
      resourceSummary: readSkillResourceSummary(record.resourceSummary),
      governance: readSkillGovernance(record.governance),
    });
  }
  return results;
}

function readSkillResourceSummary(value: unknown) {
  const record = pickObject(value);
  const paths = Array.isArray(record.paths)
    ? record.paths.map((item) => asText(item)).filter(Boolean).slice(0, 32)
    : [];
  const totalCount =
    typeof record.totalCount === 'number' && Number.isFinite(record.totalCount) ? Math.max(0, record.totalCount) : 0;
  const referenceCount =
    typeof record.referenceCount === 'number' && Number.isFinite(record.referenceCount)
      ? Math.max(0, record.referenceCount)
      : 0;
  const templateCount =
    typeof record.templateCount === 'number' && Number.isFinite(record.templateCount)
      ? Math.max(0, record.templateCount)
      : 0;
  if (totalCount === 0 && paths.length === 0 && referenceCount === 0 && templateCount === 0) {
    return null;
  }
  return {
    totalCount,
    referenceCount,
    templateCount,
    paths,
  };
}

function readSkillGovernance(value: unknown) {
  const record = pickObject(value);
  const autoActivation = pickObject(record.autoActivation);
  const triggers = Array.isArray(autoActivation.triggers)
    ? autoActivation.triggers.map((item) => asText(item).toLowerCase()).filter(Boolean).slice(0, 32)
    : [];
  const toolNames = Array.isArray(autoActivation.toolNames)
    ? autoActivation.toolNames.map((item) => asText(item).toLowerCase()).filter(Boolean).slice(0, 64)
    : [];
  if (!record.systemRole && !record.adminManaged && !record.required && !autoActivation.enabled && triggers.length === 0 && toolNames.length === 0) {
    return null;
  }
  return {
    systemRole: asText(record.systemRole) || null,
    adminManaged: Boolean(record.adminManaged),
    required: Boolean(record.required),
    autoActivation: {
      enabled: Boolean(autoActivation.enabled),
      triggers: Array.from(new Set(triggers)),
      toolNames: Array.from(new Set(toolNames)),
    },
  };
}

export function readManagedSkillCatalog(value: unknown): ManagedSkillCatalogEntry[] {
  if (!Array.isArray(value)) return [];
  const results: ManagedSkillCatalogEntry[] = [];
  for (const item of value) {
    const record = pickObject(item);
    const skillId = asText(record.skillId);
    const revisionId = asText(record.revisionId);
    const slug = asText(record.slug);
    const name = asText(record.name);
    if (!skillId || !revisionId || !slug || !name) {
      continue;
    }
    results.push({
      sourceType: asText(record.sourceType) === 'custom' ? 'custom' : 'platform',
      skillId,
      revisionId,
      slug,
      name,
      description: asText(record.description),
      category: asText(record.category) || 'general',
      revisionNumber:
        typeof record.revisionNumber === 'number' && Number.isFinite(record.revisionNumber)
          ? record.revisionNumber
          : null,
      resourceSummary: readSkillResourceSummary(record.resourceSummary),
      governance: readSkillGovernance(record.governance),
    });
  }
  return results;
}
