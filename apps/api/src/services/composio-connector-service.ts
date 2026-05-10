import type { ConnectorAccountSecret, ConnectorCatalogItem, ConnectorKey } from './connector-registry';
import { mcpToolConfirmationService } from './mcp-tool-confirmation-service';

type ComposioTool = {
  name: string;
  title?: string | null;
  description?: string | null;
  inputSchema?: Record<string, unknown> | null;
};

type ComposioRuntimeContext = {
  connectorKey: ConnectorKey;
  taskSessionId: string;
  userId: string;
  profileId: string;
  agentRunId?: string | null;
  profileSecret: ConnectorAccountSecret | null;
  profileMetadata: Record<string, unknown>;
  catalogItem: ConnectorCatalogItem;
};

const FIGMA_TOOL_DISCOVERY = [
  {
    tool_slug: 'FIGMA_GET_CURRENT_USER',
    name: 'Get current user',
    description: 'Verify the active Figma connection and return the connected user.',
    input_schema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    tool_slug: 'FIGMA_DISCOVER_FIGMA_RESOURCES',
    name: 'Discover Figma resources',
    description: 'Discover teams, projects, files, and other Figma resources available to the connected account.',
    input_schema: {
      type: 'object',
      properties: {},
      additionalProperties: true,
    },
  },
  {
    tool_slug: 'FIGMA_GET_FILE_METADATA',
    name: 'Get file metadata',
    description: 'Read high-level metadata for a Figma file by file key.',
    schemaRef: 'Call COMPOSIO_GET_TOOL_SCHEMAS for the complete current schema.',
  },
  {
    tool_slug: 'FIGMA_GET_FILE_JSON',
    name: 'Get file json',
    description: 'Read the full Figma file document JSON for a file key. Use carefully for large files.',
    schemaRef: 'Call COMPOSIO_GET_TOOL_SCHEMAS for the complete current schema.',
  },
  {
    tool_slug: 'FIGMA_GET_FILE_NODES',
    name: 'Get file nodes',
    description: 'Read selected node JSON from a Figma file by file key and node ids.',
    schemaRef: 'Call COMPOSIO_GET_TOOL_SCHEMAS for the complete current schema.',
  },
  {
    tool_slug: 'FIGMA_RENDER_IMAGES_OF_FILE_NODES',
    name: 'Render images of file nodes',
    description: 'Render image URLs for selected Figma file nodes.',
    schemaRef: 'Call COMPOSIO_GET_TOOL_SCHEMAS for the complete current schema.',
  },
  {
    tool_slug: 'FIGMA_GET_COMMENTS_IN_A_FILE',
    name: 'Get comments in a file',
    description: 'Read comments from a Figma file.',
    schemaRef: 'Call COMPOSIO_GET_TOOL_SCHEMAS for the complete current schema.',
  },
  {
    tool_slug: 'FIGMA_ADD_A_COMMENT_TO_A_FILE',
    name: 'Add a comment to a file',
    description: 'Post a comment to a Figma file after the target file or node is explicit.',
    schemaRef: 'Call COMPOSIO_GET_TOOL_SCHEMAS for the complete current schema.',
  },
] as const;

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function pickObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = asText(value);
    if (text) return text;
  }
  return '';
}

function collectRepositoryNames(value: unknown, seen = new Set<unknown>()): string[] {
  if (!value || typeof value !== 'object' || seen.has(value)) return [];
  seen.add(value);
  if (Array.isArray(value)) {
    const result: string[] = [];
    for (const item of value) {
      const record = pickObject(item);
      const fullName = firstText(
        record.full_name,
        record.fullName,
        record.name_with_owner,
        record.nameWithOwner,
        record.repository,
        record.repo
      );
      const owner = firstText(pickObject(record.owner).login, record.owner_login, record.owner);
      const name = firstText(record.name);
      const label = fullName || (owner && name ? `${owner}/${name}` : '');
      if (label && label.includes('/')) result.push(label);
      result.push(...collectRepositoryNames(item, seen));
    }
    return [...new Set(result)];
  }

  const record = pickObject(value);
  const result: string[] = [];
  for (const key of [
    'repositories',
    'repos',
    'selected_repositories',
    'selectedRepositories',
    'accessible_repositories',
    'accessibleRepositories',
  ]) {
    result.push(...collectRepositoryNames(record[key], seen));
  }
  for (const child of Object.values(record)) {
    result.push(...collectRepositoryNames(child, seen));
  }
  return [...new Set(result)];
}

function resolveConnectionDisplayName(input: {
  connection: Record<string, unknown>;
  connectedAccount: Record<string, unknown>;
  connectedAccountId: string;
}): string {
  const accountData = pickObject(input.connectedAccount.data);
  const connectionData = pickObject(input.connection.data);
  return firstText(
    input.connectedAccount.display_name,
    input.connectedAccount.displayName,
    input.connectedAccount.name,
    input.connectedAccount.login,
    input.connectedAccount.email,
    accountData.login,
    accountData.name,
    accountData.email,
    input.connection.display_name,
    input.connection.displayName,
    input.connection.name,
    connectionData.login,
    connectionData.name
  );
}

function isToolkitConnectionActive(
  connection: Record<string, unknown>,
  connectedAccountId: string
): boolean {
  return (
    connection.is_active === true ||
    connection.active === true ||
    asText(connection.status).toLowerCase() === 'active' ||
    Boolean(connectedAccountId)
  );
}

function isConnectionPendingError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return /not connected yet|connection.*pending|account.*pending/i.test(message);
}

function composioUserId(userId: string): string {
  return `oneceo_app_user_${userId}`;
}

function getApiKey(): string {
  const apiKey = asText(process.env.COMPOSIO_API_KEY);
  if (!apiKey) {
    throw new Error('COMPOSIO_API_KEY is not configured');
  }
  return apiKey;
}

function getBaseUrl(): string {
  return asText(process.env.COMPOSIO_API_BASE_URL) || 'https://backend.composio.dev';
}

function normalizeUrl(path: string): string {
  return new URL(path, `${getBaseUrl().replace(/\/+$/, '')}/`).toString();
}

function mcpHeaders(): Record<string, string> {
  return {
    'x-api-key': getApiKey(),
  };
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    const dataLine = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.startsWith('data:'));
    if (dataLine) {
      try {
        return JSON.parse(dataLine.slice('data:'.length).trim()) as Record<string, unknown>;
      } catch {
        return { raw: text };
      }
    }
    return { raw: text };
  }
}

async function composioFetch(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const response = await fetch(normalizeUrl(path), {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-api-key': getApiKey(),
      ...(init.headers || {}),
    },
  });
  const payload = await readJson(response);
  if (!response.ok) {
    const error = pickObject(payload.error);
    const detail = [
      asText(error.message) || asText(payload.message) || asText(payload.error),
      asText(error.suggested_fix) ? `suggested_fix=${asText(error.suggested_fix)}` : '',
      asText(error.request_id) ? `request_id=${asText(error.request_id)}` : '',
      Array.isArray(error.errors) && error.errors.length > 0
        ? `errors=${error.errors.map((item) => String(item)).join('; ')}`
        : '',
    ]
      .filter(Boolean)
      .join('; ');
    throw new Error(
      detail ||
        `Composio request failed: ${response.status}`
    );
  }
  return payload;
}

function resolveMcpUrl(payload: Record<string, unknown>): string {
  const mcp = pickObject(payload.mcp);
  return asText(mcp.url) || asText(payload.mcp_url) || asText(payload.url);
}

function normalizeTool(tool: Record<string, unknown>, prefix: string): ComposioTool | null {
  const rawName = asText(tool.name || tool.slug || tool.toolName);
  if (!rawName) return null;
  const name = rawName.startsWith(`${prefix}__`) ? rawName : `${prefix}__${rawName}`;
  const inputSchema = pickObject(tool.inputSchema || tool.input_schema || tool.parameters);
  return {
    name,
    title: asText(tool.title || tool.displayName || tool.display_name) || null,
    description: asText(tool.description) || null,
    inputSchema: Object.keys(inputSchema).length > 0 ? inputSchema : null,
  };
}

function stripToolPrefix(toolName: string, prefix: string): string {
  const marker = `${prefix}__`;
  return toolName.startsWith(marker) ? toolName.slice(marker.length) : toolName;
}

function normalizeComposioSearchToolsArguments(
  args: Record<string, unknown>,
  context: ComposioRuntimeContext
): Record<string, unknown> {
  const session = pickObject(args.session);
  const normalizedSession =
    Object.keys(session).length > 0
      ? session
      : {
          generate_id: true,
        };
  const model = asText(args.model);
  const knownFields = asText(args.known_fields || args.knownFields);
  const queries = Array.isArray(args.queries)
    ? args.queries
        .map((item) => pickObject(item))
        .map((item) => ({
          use_case: asText(item.use_case || item.useCase),
          ...(asText(item.known_fields || item.knownFields)
            ? { known_fields: asText(item.known_fields || item.knownFields) }
            : {}),
        }))
        .filter((item) => item.use_case)
    : [];

  if (queries.length === 0) {
    const fallbackUseCase =
      asText(args.use_case || args.useCase || args.query || args.search || args.intent) ||
      `find ${context.catalogItem.name} tools for the current user request`;
    queries.push({
      use_case: fallbackUseCase,
      ...(knownFields ? { known_fields: knownFields } : {}),
    });
  }

  return {
    queries,
    session: normalizedSession,
    ...(model ? { model } : {}),
  };
}

function resolveSearchSessionId(args: Record<string, unknown>, context: ComposioRuntimeContext): string {
  const session = pickObject(args.session);
  const existing = asText(session.id || args.session_id || args.sessionId);
  if (existing) return existing;
  return `oneceo_${context.connectorKey}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildFigmaSearchToolsResult(
  args: Record<string, unknown>,
  context: ComposioRuntimeContext
): Record<string, unknown> {
  const normalizedArgs = normalizeComposioSearchToolsArguments(args, context);
  const queries = Array.isArray(normalizedArgs.queries) ? normalizedArgs.queries : [];
  return {
    session_id: resolveSearchSessionId(args, context),
    toolkit: 'figma',
    connected_toolkits: [
      {
        toolkit: 'figma',
        status: 'ACTIVE',
        connection_status: 'ACTIVE',
      },
    ],
    tools: FIGMA_TOOL_DISCOVERY,
    main_tools: FIGMA_TOOL_DISCOVERY,
    related_tools: [],
    execution_plan: [
      'Use FIGMA_GET_CURRENT_USER first for a connection smoke test.',
      'For file work, extract the file key from the Figma URL, then call COMPOSIO_GET_TOOL_SCHEMAS for the exact selected FIGMA_* tool.',
      'Execute selected Figma tools through COMPOSIO_MULTI_EXECUTE_TOOL with strict schema-compliant arguments.',
    ],
    common_pitfalls: [
      'Do not ask the user for a Figma Personal Access Token.',
      'Do not install a local Figma MCP server in the sandbox.',
      'Do not mutate comments, variables, webhooks, or dev resources until the target file or node is explicit.',
    ],
    queries,
    source: 'oneceo_figma_deterministic_tool_discovery',
  };
}

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item));
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase();
    if (
      normalized.includes('authorization') ||
      normalized.includes('access_token') ||
      normalized.includes('refresh_token') ||
      normalized.includes('id_token') ||
      normalized.includes('api_key') ||
      normalized === 'x-api-key'
    ) {
      result[key] = '***';
      continue;
    }
    result[key] = sanitizeValue(nested);
  }
  return result;
}

export class ComposioConnectorService {
  buildComposioUserId(userId: string): string {
    return composioUserId(userId);
  }


  async startAuthorization(input: {
    connectorKey: ConnectorKey;
    userId: string;
    callbackUrl: string;
    catalogItem: ConnectorCatalogItem;
  }) {
    const toolkitSlugs = input.catalogItem.composio?.toolkitSlugs || [];
    const primaryToolkit = toolkitSlugs[0];
    if (!primaryToolkit) {
      throw new Error(`${input.catalogItem.name} Composio toolkit is not configured`);
    }
    const allowedTools = input.catalogItem.composio?.allowedTools || [];
    const tools = allowedTools.length > 0 ? { [primaryToolkit]: { enable: allowedTools } } : undefined;
    const sessionPayload = await composioFetch('/api/v3.1/tool_router/session', {
      method: 'POST',
      body: JSON.stringify({
        user_id: composioUserId(input.userId),
        toolkits: { enable: toolkitSlugs },
        ...(tools ? { tools } : {}),
        manage_connections: {
          enable: true,
          callback_url: input.callbackUrl,
          enable_wait_for_connections: false,
          enable_connection_removal: true,
        },
      }),
    });
    const sessionId = asText(sessionPayload.session_id || sessionPayload.sessionId);
    const mcpUrl = resolveMcpUrl(sessionPayload);
    if (!sessionId || !mcpUrl) {
      throw new Error('Composio did not return a tool router session and MCP URL');
    }
    const linkPayload = await composioFetch(
      `/api/v3.1/tool_router/session/${encodeURIComponent(sessionId)}/link`,
      {
        method: 'POST',
        body: JSON.stringify({
          toolkit: primaryToolkit,
          callback_url: input.callbackUrl,
        }),
      }
    );
    const redirectUrl = asText(linkPayload.redirect_url || linkPayload.redirectUrl);
    if (!redirectUrl) {
      throw new Error('Composio did not return a Connect Link redirect URL');
    }
    return {
      authUrl: redirectUrl,
      composioUserId: composioUserId(input.userId),
      composioSessionId: sessionId,
      composioConnectedAccountId: asText(linkPayload.connected_account_id || linkPayload.connectedAccountId) || null,
      composioMcpUrl: mcpUrl,
      composioMcpHeaders: mcpHeaders(),
      toolkitSlugs,
    };
  }

  async getSession(sessionId: string) {
    return composioFetch(`/api/v3.1/tool_router/session/${encodeURIComponent(sessionId)}`);
  }

  async getSessionToolkits(sessionId: string) {
    return composioFetch(`/api/v3.1/tool_router/session/${encodeURIComponent(sessionId)}/toolkits`);
  }

  async getToolkitConnectionSummary(input: {
    sessionId: string;
    toolkitSlug: string;
    connectedAccountId?: string | null;
  }) {
    const toolkits = await this.getSessionToolkits(input.sessionId);
    const toolkitItems = Array.isArray(toolkits.items)
      ? toolkits.items
      : Array.isArray(toolkits.toolkits)
        ? toolkits.toolkits
        : [];
    const toolkit = toolkitItems
      .map((item) => (item && typeof item === 'object' ? (item as Record<string, unknown>) : null))
      .find((item) => {
        if (!item) return false;
        return asText(item.slug || item.name || item.toolkit) === input.toolkitSlug;
      });
    if (!toolkit) {
      throw new Error(`Composio toolkit is missing from tool router session: ${input.toolkitSlug}`);
    }
    const connection = pickObject(toolkit.connection);
    const connectedAccount = pickObject(connection.connected_account || connection.connectedAccount);
    const connectedAccountId =
      asText(connectedAccount.id) ||
      asText(connection.connected_account_id || connection.connectedAccountId) ||
      asText(input.connectedAccountId);
    return {
      toolkit,
      connection,
      connectedAccount,
      connectedAccountId,
      connected: isToolkitConnectionActive(connection, connectedAccountId),
      repositoryNames: collectRepositoryNames({
        toolkit,
        connection,
        connectedAccount,
      }),
      displayName: resolveConnectionDisplayName({
        connection,
        connectedAccount,
        connectedAccountId,
      }),
    };
  }


  async confirmAuthorization(input: {
    connectorKey: ConnectorKey;
    userId: string;
    catalogItem: ConnectorCatalogItem;
    metadata: Record<string, unknown>;
    secret: ConnectorAccountSecret | null;
  }) {
    const timeoutMs = Number(process.env.COMPOSIO_CONNECT_CONFIRM_TIMEOUT_MS || 12000);
    const intervalMs = Number(process.env.COMPOSIO_CONNECT_CONFIRM_INTERVAL_MS || 1200);
    const startedAt = Date.now();
    let lastError: unknown = null;
    while (Date.now() - startedAt <= timeoutMs) {
      try {
        return await this.confirmAuthorizationOnce(input);
      } catch (error) {
        lastError = error;
        if (!isConnectionPendingError(error)) {
          throw error;
        }
        await wait(Math.max(200, intervalMs));
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(String(lastError || 'Composio account is not connected yet'));
  }

  private async confirmAuthorizationOnce(input: {
    connectorKey: ConnectorKey;
    userId: string;
    catalogItem: ConnectorCatalogItem;
    metadata: Record<string, unknown>;
    secret: ConnectorAccountSecret | null;
  }) {
    const sessionId = asText(input.metadata.composioSessionId);
    if (!sessionId) {
      throw new Error('Composio session id is missing from OAuth request metadata');
    }
    const session = await this.getSession(sessionId);
    const primaryToolkit = input.catalogItem.composio?.toolkitSlugs?.[0] || '';
    const connectionSummary = await this.getToolkitConnectionSummary({
      sessionId,
      toolkitSlug: primaryToolkit,
      connectedAccountId: asText(input.metadata.composioConnectedAccountId) || null,
    });
    if (!connectionSummary.connected) {
      throw new Error(`Composio ${input.catalogItem.name} account is not connected yet`);
    }
    const mcpUrl = resolveMcpUrl(session) || asText(input.secret?.composioMcpUrl);
    if (!mcpUrl) {
      throw new Error('Composio MCP URL is missing after OAuth callback');
    }
    return {
      metadata: {
        provider: 'composio',
        composioUserId: composioUserId(input.userId),
        composioSessionId: sessionId,
        composioToolkitSlugs: input.catalogItem.composio?.toolkitSlugs || [],
        composioConnectedAccountId: connectionSummary.connectedAccountId || null,
        composioDisplayName: connectionSummary.displayName || null,
        composioRepositoryNames: connectionSummary.repositoryNames,
        connectionStatus: 'active',
        lastConnectionCheckAt: new Date().toISOString(),
      },
      secret: {
        source: 'composio',
        composioMcpUrl: mcpUrl,
        composioMcpHeaders: input.secret?.composioMcpHeaders || mcpHeaders(),
      } satisfies ConnectorAccountSecret,
    };
  }

  async executeRpc(input: {
    method: string;
    params?: Record<string, unknown>;
    runtimeContext: ComposioRuntimeContext;
  }) {
    const { runtimeContext } = input;
    const prefix = runtimeContext.catalogItem.composio?.toolNamePrefix || runtimeContext.connectorKey;
    if (input.method === 'initialize') {
      return {
        protocolVersion: '2024-11-05',
        serverInfo: {
          name: `oneceo-composio-${runtimeContext.connectorKey.replace(/_/g, '-')}-mcp-broker`,
          version: '1.0.0',
        },
        capabilities: {
          tools: { listChanged: false },
        },
      };
    }
    if (input.method === 'ping' || input.method === 'notifications/initialized') {
      return {};
    }
    if (input.method === 'tools/list') {
      const result = await this.callComposioMcp(runtimeContext, 'tools/list', {});
      const tools = Array.isArray(result.tools) ? result.tools : [];
      const allowed = new Set(runtimeContext.catalogItem.composio?.allowedTools || []);
      return {
        tools: tools
          .map((item) => (item && typeof item === 'object' ? normalizeTool(item as Record<string, unknown>, prefix) : null))
          .filter((tool): tool is ComposioTool => {
            if (!tool) return false;
            if (allowed.size === 0) return true;
            return allowed.has(stripToolPrefix(tool.name, prefix));
          })
          .map((tool) => ({
            name: tool.name,
            title: tool.title || undefined,
            description: tool.description || undefined,
            inputSchema: sanitizeValue(tool.inputSchema || {}) as Record<string, unknown>,
          })),
      };
    }
    if (input.method === 'tools/call') {
      const params = pickObject(input.params);
      const requestedName = asText(params.name);
      if (!requestedName) {
        throw new Error('tools/call missing name');
      }
      const composioToolName = stripToolPrefix(requestedName, prefix);
      const allowedTools = runtimeContext.catalogItem.composio?.allowedTools || [];
      if (allowedTools.length > 0 && !allowedTools.includes(composioToolName)) {
        throw new Error(`${runtimeContext.catalogItem.name} tool is not allowed: ${requestedName}`);
      }
      const rawArguments = pickObject(params.arguments);
      const confirmationToken =
        asText(params.confirmationToken) || asText(rawArguments.confirmationToken);
      const confirmationAgentRunId =
        asText(params.confirmationAgentRunId) || asText(rawArguments.confirmationAgentRunId);
      const sanitizedArguments = { ...rawArguments };
      delete sanitizedArguments.confirmationToken;
      delete sanitizedArguments.confirmationAgentRunId;
      const toolArguments =
        composioToolName === 'COMPOSIO_SEARCH_TOOLS'
          ? normalizeComposioSearchToolsArguments(sanitizedArguments, runtimeContext)
          : sanitizedArguments;
      if (runtimeContext.connectorKey === 'figma' && composioToolName === 'COMPOSIO_SEARCH_TOOLS') {
        return sanitizeValue(buildFigmaSearchToolsResult(rawArguments, runtimeContext));
      }
      if (
        mcpToolConfirmationService.classifyRisk(
          runtimeContext.connectorKey,
          requestedName,
          toolArguments
        ) === 'high'
      ) {
        const scopedAgentRunId = confirmationToken
          ? confirmationAgentRunId || null
          : runtimeContext.agentRunId || null;
        const scope = {
          appUserId: runtimeContext.userId,
          taskSessionId: runtimeContext.taskSessionId,
          agentRunId: scopedAgentRunId,
          connectorKey: runtimeContext.connectorKey,
          toolName: requestedName,
          argumentsJson: toolArguments,
        };
        const confirmed = await mcpToolConfirmationService.verifyAndConsumeConfirmation({
          ...scope,
          confirmationToken,
        });
        if (!confirmed) {
          const pending = await mcpToolConfirmationService.createPendingConfirmation(scope);
          const publicSummary = mcpToolConfirmationService.getPublicSummary(pending.summaryJson);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  type: 'confirmation_required',
                  connectorKey: runtimeContext.connectorKey,
                  toolName: requestedName,
                  confirmationId: pending.id,
                  summary: publicSummary,
                }),
              },
            ],
            structuredContent: {
              type: 'confirmation_required',
              connectorKey: runtimeContext.connectorKey,
              toolName: requestedName,
              confirmationId: pending.id,
              summary: publicSummary,
            },
          };
        }
      }
      const result = await this.callComposioMcp(runtimeContext, 'tools/call', {
        name: composioToolName,
        arguments: toolArguments,
      });
      return sanitizeValue(result);
    }
    throw new Error(`Unsupported Composio MCP method: ${input.method}`);
  }

  private async callComposioMcp(
    context: ComposioRuntimeContext,
    method: string,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const url = asText(context.profileSecret?.composioMcpUrl);
    if (!url) {
      throw new Error('Composio MCP URL is not configured for this profile');
    }
    const headers = context.profileSecret?.composioMcpHeaders || {};
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        method,
        params,
      }),
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(asText(payload.error) || asText(payload.message) || `Composio MCP failed: ${response.status}`);
    }
    const error = payload.error;
    if (error) {
      const errorObject = pickObject(error);
      throw new Error(asText(errorObject.message) || asText(error) || 'Composio MCP returned an error');
    }
    return pickObject(payload.result || payload);
  }
}

export const composioConnectorService = new ComposioConnectorService();
