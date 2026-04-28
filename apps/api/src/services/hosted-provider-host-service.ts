import { taskCreationSessionDAO, taskSessionConnectorBindingDAO } from '../db/dao';
import type { OsacMessage } from '../clients/osac-client';
import { osacConnectionManager } from './osac-connection-manager';
import { vercelMcpService } from './vercel-mcp-service';

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
};

export class HostedProviderHostService {
  private initialized = false;

  constructor(
    private readonly deps: HostedProviderHostDeps = {
      connectionManager: osacConnectionManager,
      bindingDAO: taskSessionConnectorBindingDAO,
      sessionDAO: taskCreationSessionDAO,
      vercelService: vercelMcpService,
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
      default:
        throw new Error(`涓嶆敮鎸佺殑 hosted provider: ${input.backendProvider || input.connectorKey}`);
    }
  }

  private async executeVercel(input: HostedProviderRequest) {
    const binding = await this.deps.bindingDAO.getByTaskSessionAndConnectorKey(
      input.taskSessionId,
      'vercel'
    );
    const profileId = asText(binding?.profileId);
    if (
      !binding ||
      binding.desiredState !== 'attached' ||
      binding.runtimeProviderId !== input.providerId ||
      !profileId
    ) {
      throw new Error('褰撳墠 task session 鏈寕杞藉搴旂殑 Vercel hosted provider');
    }

    const session = await this.deps.sessionDAO.getSession(input.taskSessionId);
    const userId = asText(session?.userId);
    if (!userId) {
      throw new Error('task session 缂哄皯褰掑睘鐢ㄦ埛锛屾棤娉曟墽琛?hosted provider');
    }

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
