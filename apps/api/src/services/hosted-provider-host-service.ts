import { taskCreationSessionDAO, taskSessionConnectorBindingDAO } from '../db/dao';
import type { OsacMessage } from '../clients/osac-client';
import { osacConnectionManager } from './osac-connection-manager';
import { composioConnectorService } from './composio-connector-service';
import { vercelMcpService } from './vercel-mcp-service';
import { connectorRegistry, type ConnectorKey } from './connector-registry';
import { userConnectorService } from './user-connector-service';
import { customApiBrokerService } from './custom-api-broker-service';
import { customApiMcpToolService } from './custom-api-mcp-tool-service';
import { customMcpRemoteClientService } from './custom-mcp-remote-client-service';

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function pickObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function inferTaskSessionId(providerId: string): string {
  const match = providerId.match(/^task_session:([^:]+):connector:/);
  return match?.[1] || '';
}

type HostedProviderRequest = {
  sessionId: string;
  taskSessionId: string;
  providerId: string;
  connectorKey: string;
  backendProvider: string;
  method: string;
  params: Record<string, unknown>;
};

type HostedProviderHostDeps = {
  connectionManager: {
    registerMessageHandler(handler: (sessionId: string, message: OsacMessage) => void | Promise<void>): void;
    sendDirect(sessionId: string, message: OsacMessage): boolean;
  };
  bindingDAO: {
    getByTaskSessionAndConnectorKey(taskSessionId: string, connectorKey: string): Promise<any>;
    getByRuntimeProviderId(taskSessionId: string, runtimeProviderId: string): Promise<any>;
  };
  sessionDAO: {
    getSession(taskSessionId: string): Promise<any>;
  };
  vercelService: {
    executeRpc(input: {
      method: string;
      params?: Record<string, unknown>;
      runtimeContext: {
        connectorKey: 'vercel';
        taskSessionId: string;
        userId: string;
        profileId: string;
      };
    }): Promise<unknown>;
  };
  composioService: {
    executeRpc(input: {
      method: string;
      params?: Record<string, unknown>;
      runtimeContext: {
        connectorKey: ConnectorKey;
        taskSessionId: string;
        userId: string;
        profileId: string;
        profileSecret: any;
        profileMetadata: Record<string, unknown>;
        catalogItem: any;
      };
    }): Promise<unknown>;
  };
  userConnectorService: {
    getProfileMaterial(userId: string, profileId: string): Promise<any>;
  };
  connectorRegistry: {
    getCatalogItem(connectorKey: string): any;
  };
  customApiService: {
    listToolsForSession(taskSessionId: string): Promise<any[]>;
  };
  customApiBroker: {
    executeCustomApiTool(input: {
      userId: string;
      taskSessionId: string;
      connectorProfileId: string;
      endpointToolId: string;
      toolName?: string;
      callerType: 'agent' | 'user' | 'admin_test' | 'system';
      argumentsJson: unknown;
      confirmationId?: string;
    }): Promise<unknown>;
  };
  customMcpClient: {
    initializeForProfile(userId: string, profileId: string): Promise<unknown>;
    listToolsForProfile(userId: string, profileId: string): Promise<{ tools: any[] }>;
    callToolForProfile(userId: string, profileId: string, name: string, args: unknown): Promise<unknown>;
  };
};

export class HostedProviderHostService {
  private initialized = false;

  constructor(
    private readonly deps: HostedProviderHostDeps = {
      connectionManager: osacConnectionManager,
      bindingDAO: taskSessionConnectorBindingDAO,
      sessionDAO: taskCreationSessionDAO,
      vercelService: vercelMcpService,
      composioService: composioConnectorService,
      userConnectorService,
      connectorRegistry,
      customApiService: customApiMcpToolService,
      customApiBroker: customApiBrokerService,
      customMcpClient: customMcpRemoteClientService,
    }
  ) {}

  initialize() {
    if (this.initialized) return;
    this.initialized = true;
    this.deps.connectionManager.registerMessageHandler(async (sessionId, message) => {
      if (message.type !== 'BACKEND_MCP_RPC_REQUEST') {
        return;
      }
      await this.handleRequest(sessionId, message);
    });
  }

  private parseRequest(sessionId: string, message: OsacMessage): HostedProviderRequest {
    const payload = pickObject(message.payload);
    const providerId = asText(payload.providerId);
    const connectorKey = asText(payload.connectorKey);
    const backendProvider = asText(payload.backendProvider) || connectorKey;
    const taskSessionId = asText(payload.taskSessionId) || inferTaskSessionId(providerId);
    const method = asText(payload.method);
    if (!providerId) {
      throw new Error('BACKEND_MCP_RPC_REQUEST 缂哄皯 providerId');
    }
    if (!connectorKey && !backendProvider) {
      throw new Error('BACKEND_MCP_RPC_REQUEST 缂哄皯 connectorKey/backendProvider');
    }
    if (!taskSessionId) {
      throw new Error('BACKEND_MCP_RPC_REQUEST 缂哄皯 taskSessionId');
    }
    if (!method) {
      throw new Error('BACKEND_MCP_RPC_REQUEST 缂哄皯 method');
    }
    return {
      sessionId,
      taskSessionId,
      providerId,
      connectorKey,
      backendProvider,
      method,
      params: pickObject(payload.params),
    };
  }

  private async execute(input: HostedProviderRequest) {
    switch (input.backendProvider || input.connectorKey) {
      case 'vercel':
        return this.executeVercel(input);
      case 'figma':
      case 'github':
      case 'notion':
      case 'slack':
      case 'supabase':
        return this.executeComposio(input, (input.backendProvider || input.connectorKey) as ConnectorKey);
      case 'custom_api':
        return this.executeCustomApi(input);
      case 'custom_mcp':
        return this.executeCustomMcp(input);
      default:
        throw new Error(`涓嶆敮鎸佺殑 hosted provider: ${input.backendProvider || input.connectorKey}`);
    }
  }

  private async loadAttachedContext(input: HostedProviderRequest, connectorKey: string) {
    const binding =
      (await this.deps.bindingDAO.getByRuntimeProviderId(input.taskSessionId, input.providerId)) ||
      (await this.deps.bindingDAO.getByTaskSessionAndConnectorKey(input.taskSessionId, connectorKey));
    const profileId = asText(binding?.profileId);
    if (
      !binding ||
      binding.desiredState !== 'attached' ||
      binding.runtimeProviderId !== input.providerId ||
      !profileId
    ) {
      throw new Error(`当前 task session 未挂载对应的 ${connectorKey} hosted provider`);
    }

    const session = await this.deps.sessionDAO.getSession(input.taskSessionId);
    const userId = asText(session?.userId);
    if (!userId) {
      throw new Error('task session 缺少归属用户，无法执行 hosted provider');
    }
    return { binding, profileId, userId };
  }

  private async executeVercel(input: HostedProviderRequest) {
    const { profileId, userId } = await this.loadAttachedContext(input, 'vercel');

    return this.deps.vercelService.executeRpc({
      method: input.method,
      params: input.params,
      runtimeContext: {
        connectorKey: 'vercel',
        taskSessionId: input.taskSessionId,
        userId,
        profileId,
      },
    });
  }

  private async executeComposio(input: HostedProviderRequest, connectorKey: ConnectorKey) {
    const { profileId, userId } = await this.loadAttachedContext(input, connectorKey);
    const profile = await this.deps.userConnectorService.getProfileMaterial(userId, profileId);
    const catalogItem = this.deps.connectorRegistry.getCatalogItem(connectorKey);
    if (!profile || profile.connectorKey !== connectorKey || profile.authStatus !== 'authorized') {
      throw new Error(`${catalogItem.name} connector profile is not authorized`);
    }
    if (catalogItem.composio?.provider !== 'composio') {
      throw new Error(`${catalogItem.name} connector is not a Composio hosted provider`);
    }
    return this.deps.composioService.executeRpc({
      method: input.method,
      params: input.params,
      runtimeContext: {
        connectorKey,
        taskSessionId: input.taskSessionId,
        userId,
        profileId,
        profileSecret: profile.secret || null,
        profileMetadata: pickObject(profile.metadataJson),
        catalogItem,
      },
    });
  }

  private async executeCustomApi(input: HostedProviderRequest) {
    const { profileId, userId } = await this.loadAttachedContext(input, 'custom_api');
    if (input.method === 'initialize') {
      return {
        protocolVersion: '2024-11-05',
        serverInfo: {
          name: 'oneceo-custom-api-mcp-broker',
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
      const tools = await this.deps.customApiService.listToolsForSession(input.taskSessionId);
      return {
        tools: tools.map((tool) => ({
          name: tool.name,
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      };
    }
    if (input.method === 'tools/call') {
      const params = pickObject(input.params);
      const toolName = asText(params.name);
      if (!toolName) throw new Error('tools/call missing custom_api tool name');
      const tools = await this.deps.customApiService.listToolsForSession(input.taskSessionId);
      const tool = tools.find((item) => item.name === toolName);
      if (!tool) throw new Error('custom_api_tool_not_attached');
      const args = pickObject(params.arguments);
      return this.deps.customApiBroker.executeCustomApiTool({
        userId,
        taskSessionId: input.taskSessionId,
        connectorProfileId: profileId,
        endpointToolId: tool.metadata.endpointToolId,
        toolName,
        callerType: 'agent',
        argumentsJson: args,
        confirmationId: asText(params.confirmationId) || asText(args.confirmationId) || undefined,
      });
    }
    throw new Error(`Unsupported Custom API MCP method: ${input.method}`);
  }

  private async executeCustomMcp(input: HostedProviderRequest) {
    const { profileId, userId } = await this.loadAttachedContext(input, 'custom_mcp');
    if (input.method === 'initialize') {
      const remote = await this.deps.customMcpClient.initializeForProfile(userId, profileId).catch(() => null);
      return (
        remote || {
          protocolVersion: '2024-11-05',
          serverInfo: {
            name: 'oneceo-custom-mcp-broker',
            version: '1.0.0',
          },
          capabilities: {
            tools: { listChanged: true },
          },
        }
      );
    }
    if (input.method === 'ping' || input.method === 'notifications/initialized') {
      return {};
    }
    if (input.method === 'tools/list') {
      return this.deps.customMcpClient.listToolsForProfile(userId, profileId);
    }
    if (input.method === 'tools/call') {
      const params = pickObject(input.params);
      const toolName = asText(params.name);
      if (!toolName) throw new Error('tools/call missing custom_mcp tool name');
      return this.deps.customMcpClient.callToolForProfile(userId, profileId, toolName, params.arguments);
    }
    throw new Error(`Unsupported Custom MCP method: ${input.method}`);
  }

  private async handleRequest(sessionId: string, message: OsacMessage) {
    const requestId = asText(message.requestId);
    let parsed: HostedProviderRequest | null = null;
    try {
      parsed = this.parseRequest(sessionId, message);
      const result = await this.execute(parsed);
      this.sendResponse(parsed.sessionId, requestId, {
        sessionId: parsed.sessionId,
        taskSessionId: parsed.taskSessionId,
        providerId: parsed.providerId,
        connectorKey: parsed.connectorKey,
        backendProvider: parsed.backendProvider,
        method: parsed.method,
        result,
        isError: false,
      });
    } catch (error) {
      const payload = pickObject(message.payload);
      this.sendResponse(sessionId, requestId, {
        sessionId,
        taskSessionId: parsed?.taskSessionId || asText(payload.taskSessionId),
        providerId: parsed?.providerId || asText(payload.providerId),
        connectorKey: parsed?.connectorKey || asText(payload.connectorKey),
        backendProvider:
          parsed?.backendProvider || asText(payload.backendProvider) || asText(payload.connectorKey),
        method: parsed?.method || asText(payload.method),
        error: {
          code: 'hosted_provider_rpc_failed',
          message: error instanceof Error ? error.message : String(error),
        },
        isError: true,
      });
    }
  }

  private sendResponse(sessionId: string, requestId: string, payload: Record<string, unknown>) {
    const sent = this.deps.connectionManager.sendDirect(sessionId, {
      type: 'BACKEND_MCP_RPC_RESPONSE',
      requestId,
      payload,
    });
    if (!sent) {
      console.warn('[HOSTED_PROVIDER_RPC_RESPONSE_DROPPED]', {
        sessionId,
        requestId,
        providerId: payload.providerId,
        method: payload.method,
      });
    }
  }
}

export const hostedProviderHostService = new HostedProviderHostService();
