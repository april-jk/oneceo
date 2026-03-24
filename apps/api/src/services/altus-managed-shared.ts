export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string;
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
          },
          ['summary']
        ),
      },
    },
  ];
}
