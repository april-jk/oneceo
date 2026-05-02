import { randomUUID } from 'node:crypto';
import { userConnectorProfileDAO } from '../db/dao';
import { connectorSecretService } from './connector-secret-service';
import { sessionConnectorService } from './session-connector-service';
import { userConnectorService } from './user-connector-service';
import { customMcpRemoteClientService } from './custom-mcp-remote-client-service';
import { customMcpSecurityService, type CustomMcpTransportType } from './custom-mcp-security-service';
import type { ConnectorAccountSecret } from './connector-registry';

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function pickObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function headersArrayToRecord(value: unknown): Record<string, string> {
  if (!Array.isArray(value)) return pickObject(value) as Record<string, string>;
  const headers: Record<string, string> = {};
  for (const item of value) {
    const row = pickObject(item);
    const name = asText(row.name);
    const headerValue = asText(row.value);
    if (name && headerValue) headers[name] = headerValue;
  }
  return headers;
}

function buildEditableJson(profile: {
  profileName: string;
  configJson: Record<string, unknown> | null;
  secretCiphertext: string | null;
}) {
  const config = pickObject(profile.configJson);
  let secret: ConnectorAccountSecret | null = null;
  if (profile.secretCiphertext) {
    try {
      secret = connectorSecretService.decryptJson<ConnectorAccountSecret>(profile.secretCiphertext, 'custom_mcp');
    } catch {
      secret = null;
    }
  }
  return {
    name: profile.profileName,
    type: asText(config.transportType) || 'streamable_http',
    url: asText(config.serverUrl),
    headers: secret?.customMcpHeaders || {},
    description: asText(config.description),
    iconUrl: asText(config.iconUrl),
  };
}

export class CustomMcpConnectorService {
  async listProfiles(userId: string) {
    const snapshot = await userConnectorService.getMeSnapshot(userId);
    return snapshot.profiles.filter((profile) => profile.connectorKey === 'custom_mcp');
  }

  normalizeProfileInput(input: Record<string, unknown>) {
    const headers = headersArrayToRecord(input.headers);
    const review = customMcpSecurityService.validateServerConfig({
      name: input.profileName || input.name || input.displayName,
      transportType: input.transportType || input.type || input.transport,
      serverUrl: input.serverUrl || input.url || input.serverURL,
      iconUrl: input.iconUrl,
      description: input.description || input.note,
      headers,
      rawConfig: input,
    });
    if (!review.valid) {
      throw new Error(review.errors.join(','));
    }
    const headerNames = Object.keys(review.normalized.headers);
    return {
      profileName: review.normalized.name,
      displayName: review.normalized.name,
      config: {
        serverUuid: asText(input.serverUuid) || randomUUID(),
        transportType: review.normalized.transportType,
        serverUrl: review.normalized.serverUrl,
        iconUrl: review.normalized.iconUrl,
        description: review.normalized.description,
        enabled: input.enabled !== false,
        headerNames,
      },
      credentials: {
        headers: review.normalized.headers,
      },
      metadata: {
        provider: 'custom_mcp',
        lastToolCount: Number(input.lastToolCount || 0) || 0,
      },
    };
  }

  async createProfile(userId: string, input: Record<string, unknown>) {
    const payload = this.normalizeProfileInput(input);
    await customMcpSecurityService.assertResolvedUrlSafe(asText(payload.config.serverUrl));
    return userConnectorService.createProfile(userId, 'custom_mcp', payload);
  }

  async updateProfile(userId: string, profileId: string, input: Record<string, unknown>) {
    const existing = await userConnectorProfileDAO.getByIdAndUser(profileId, userId);
    if (!existing || existing.connectorKey !== 'custom_mcp') {
      throw new Error('custom_mcp_profile_not_found');
    }
    const currentConfig = pickObject(existing.configJson);
    const payload = this.normalizeProfileInput({
      serverUuid: asText(currentConfig.serverUuid) || randomUUID(),
      ...input,
    });
    await customMcpSecurityService.assertResolvedUrlSafe(asText(payload.config.serverUrl));
    return userConnectorService.updateProfile(userId, profileId, payload);
  }

  async deleteProfile(userId: string, profileId: string) {
    const existing = await userConnectorProfileDAO.getByIdAndUser(profileId, userId);
    if (!existing || existing.connectorKey !== 'custom_mcp') {
      throw new Error('custom_mcp_profile_not_found');
    }
    await userConnectorService.deleteProfile(userId, profileId);
    void sessionConnectorService.detachBindingsForProfile(userId, profileId).catch((error) => {
      console.error('[CUSTOM_MCP_PROFILE_DELETE_DETACH_FAILED]', {
        userId,
        profileId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    return { deleted: true };
  }

  parseJsonServers(input: unknown): Array<Record<string, unknown>> {
    const parsed = typeof input === 'string' ? JSON.parse(input) : input;
    const root = pickObject(parsed);
    const mcpServers = pickObject(root.mcpServers);
    if (Object.keys(mcpServers).length > 0) {
      return Object.entries(mcpServers).map(([name, config]) => ({
        name,
        ...pickObject(config),
      }));
    }
    return [root];
  }

  async importJson(userId: string, input: { json: unknown }) {
    const servers = this.parseJsonServers(input.json);
    const created: Array<{ profileId: string; name: string }> = [];
    const rejected: Array<{ name: string; reason: string }> = [];
    for (const server of servers) {
      const name = asText(server.name) || 'unknown';
      try {
        const saved = await this.createProfile(userId, server);
        created.push({ profileId: saved.profileId, name: saved.profileName });
      } catch (error) {
        rejected.push({ name, reason: error instanceof Error ? error.message : String(error) });
      }
    }
    return { created, rejected };
  }

  async getEditableJson(userId: string, profileId: string) {
    const profile = await userConnectorProfileDAO.getByIdAndUser(profileId, userId);
    if (!profile || profile.connectorKey !== 'custom_mcp') {
      throw new Error('custom_mcp_profile_not_found');
    }
    return buildEditableJson(profile as any);
  }

  async updateFromJson(userId: string, profileId: string, json: unknown) {
    const [server] = this.parseJsonServers(json);
    if (!server) throw new Error('custom_mcp_json_empty');
    return this.updateProfile(userId, profileId, server);
  }

  async testProfile(userId: string, profileId: string) {
    const result = await customMcpRemoteClientService.listToolsForProfile(userId, profileId);
    const existing = await userConnectorProfileDAO.getByIdAndUser(profileId, userId);
    if (existing) {
      const config = pickObject(existing.configJson);
      const metadata = pickObject(existing.metadataJson);
      await userConnectorProfileDAO.update(profileId, userId, {
        configJson: {
          ...config,
          lastToolDiscoveryAt: new Date().toISOString(),
          lastToolCount: result.tools.length,
        },
        metadataJson: {
          ...metadata,
          lastToolCount: result.tools.length,
          lastToolDiscoveryAt: new Date().toISOString(),
          lastToolNames: result.tools.map((tool) => asText(tool.name)).filter(Boolean).slice(0, 50),
        },
        lastError: null,
      } as any);
    }
    return result;
  }

  async attachToSession(userId: string, taskSessionId: string, profileId: string, orchestratorSessionId?: string) {
    const profile = await userConnectorProfileDAO.getByIdAndUser(profileId, userId);
    if (!profile || profile.connectorKey !== 'custom_mcp') {
      throw new Error('custom_mcp_profile_not_found');
    }
    const config = pickObject(profile.configJson);
    if (config.enabled === false) throw new Error('custom_mcp_profile_disabled');
    return sessionConnectorService.attachConnector(
      taskSessionId,
      userId,
      'custom_mcp',
      profileId,
      [],
      {
        transportType: asText(config.transportType) as CustomMcpTransportType,
        serverUuid: asText(config.serverUuid),
      },
      orchestratorSessionId
    );
  }
}

export const customMcpConnectorService = new CustomMcpConnectorService();
