import { randomUUID } from 'node:crypto';
import { userConnectorService } from './user-connector-service';
import { customMcpSecurityService } from './custom-mcp-security-service';
import type { ConnectorAccountMaterial } from './connector-registry';

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function pickObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function extractTools(payload: unknown): Array<Record<string, unknown>> {
  const root = pickObject(payload);
  const result = pickObject(root.result);
  const tools = Array.isArray(result.tools) ? result.tools : Array.isArray(root.tools) ? root.tools : [];
  return tools.filter((tool) => tool && typeof tool === 'object') as Array<Record<string, unknown>>;
}

function toJsonRpc(method: string, params?: unknown) {
  const request: Record<string, unknown> = {
    jsonrpc: '2.0',
    id: randomUUID(),
    method,
  };
  if (params !== undefined) {
    request.params = params;
  }
  return request;
}

function toJsonRpcNotification(method: string, params?: unknown) {
  const notification: Record<string, unknown> = {
    jsonrpc: '2.0',
    method,
  };
  if (params !== undefined) {
    notification.params = params;
  }
  return notification;
}

function getHeader(response: Response, name: string) {
  return response.headers.get(name) || response.headers.get(name.toLowerCase());
}

function extractRpcError(payload: unknown) {
  const root = pickObject(payload);
  const error = pickObject(root.error);
  const message = asText(error.message);
  if (!message) return '';
  const code = error.code === undefined ? '' : String(error.code);
  return code ? `${code}:${message}` : message;
}

export class CustomMcpRemoteClientService {
  private async loadMaterial(userId: string, profileId: string): Promise<ConnectorAccountMaterial> {
    const material = await userConnectorService.getProfileMaterial(userId, profileId);
    if (!material || material.connectorKey !== 'custom_mcp') {
      throw new Error('custom_mcp_profile_not_found');
    }
    return material;
  }

  private buildHeaders(material: ConnectorAccountMaterial, sessionId?: string) {
    return {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
      ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
      ...(material.secret?.customMcpHeaders || {}),
    };
  }

  private async postJsonRpc(
    material: ConnectorAccountMaterial,
    method: string,
    params?: unknown,
    options?: {
      sessionId?: string;
      notification?: boolean;
    }
  ) {
    const serverUrl = asText(material.configJson?.serverUrl);
    if (!serverUrl) throw new Error('custom_mcp_server_url_missing');
    await customMcpSecurityService.assertResolvedUrlSafe(serverUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(serverUrl, {
        method: 'POST',
        redirect: 'manual',
        headers: this.buildHeaders(material, options?.sessionId),
        body: JSON.stringify(
          options?.notification ? toJsonRpcNotification(method, params) : toJsonRpc(method, params)
        ),
        signal: controller.signal,
      });
      const text = await response.text();
      let payload: unknown = {};
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = { raw: text.slice(0, 4096) };
        }
      }
      if (!response.ok) {
        const message = extractRpcError(payload) || asText((payload as Record<string, unknown>)?.Message);
        throw new Error(`custom_mcp_remote_error:${response.status}${message ? `:${message}` : ''}`);
      }
      const rpcError = extractRpcError(payload);
      if (rpcError) {
        throw new Error(`custom_mcp_rpc_error:${rpcError}`);
      }
      return {
        payload,
        sessionId: getHeader(response, 'Mcp-Session-Id') || undefined,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async initializeSession(material: ConnectorAccountMaterial) {
    const initialized = await this.postJsonRpc(material, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'oneceo-custom-mcp-broker',
        version: '1.0.0',
      },
    });
    const sessionId = initialized.sessionId;
    if (sessionId) {
      await this.postJsonRpc(material, 'notifications/initialized', undefined, {
        sessionId,
        notification: true,
      });
    }
    return {
      payload: initialized.payload,
      sessionId,
    };
  }

  async initializeForProfile(userId: string, profileId: string) {
    const material = await this.loadMaterial(userId, profileId);
    const initialized = await this.initializeSession(material);
    return initialized.payload;
  }

  async listToolsForProfile(userId: string, profileId: string) {
    const material = await this.loadMaterial(userId, profileId);
    const initialized = await this.initializeSession(material);
    const result = await this.postJsonRpc(material, 'tools/list', undefined, {
      sessionId: initialized.sessionId,
    });
    const tools = extractTools(result.payload);
    return {
      tools: tools.map((tool) => ({
        name: asText(tool.name),
        title: asText(tool.title) || asText(tool.name),
        description: asText(tool.description),
        inputSchema: pickObject(tool.inputSchema),
      })),
    };
  }

  async callToolForProfile(userId: string, profileId: string, name: string, args: unknown) {
    const material = await this.loadMaterial(userId, profileId);
    const initialized = await this.initializeSession(material);
    const result = await this.postJsonRpc(material, 'tools/call', {
      name,
      arguments: pickObject(args),
    }, {
      sessionId: initialized.sessionId,
    });
    return result.payload;
  }
}

export const customMcpRemoteClientService = new CustomMcpRemoteClientService();
