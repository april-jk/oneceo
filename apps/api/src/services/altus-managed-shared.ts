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

type JsonSchema =
  | {
      type: 'string' | 'number' | 'integer' | 'boolean';
      description?: string;
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
      additionalProperties: false;
    };

export function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function pickObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
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
        description: 'Run a shell command inside the E2B sandbox workspace.',
        parameters: objectSchema(
          {
            command: { type: 'string', description: 'Shell command to execute.' },
            cwd: { type: 'string', description: 'Workspace-relative directory. Defaults to workspace root.' },
            timeoutMs: { type: 'integer', description: 'Timeout in milliseconds, max 120000.' },
          },
          ['command']
        ),
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
        description: 'Write or replace a UTF-8 text file in the workspace.',
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
    });
  }
  return results;
}
