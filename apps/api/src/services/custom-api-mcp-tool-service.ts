import {
  customApiDefinitionDAO,
  customApiEndpointToolDAO,
  taskSessionConnectorBindingDAO,
} from '../db/dao';
import type { CustomApiDefinition, CustomApiEndpointTool } from '../db/schema';
import { isCustomApiEnabled } from './custom-api-feature-flag';

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function pickObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeSlug(value: string) {
  return asText(value)
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function buildCustomApiToolName(definitionSlug: string, toolSlug: string) {
  return `custom_api__${normalizeSlug(definitionSlug)}__${normalizeSlug(toolSlug)}`;
}

export function parseCustomApiToolName(toolName: string) {
  const match = asText(toolName).match(/^custom_api__([a-z0-9_]+)__([a-z0-9_]+)$/);
  if (!match) return null;
  return {
    definitionSlug: match[1],
    toolSlug: match[2],
  };
}

export type CustomApiMcpTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  metadata: {
    connectorKey: 'custom_api';
    definitionId: string;
    endpointToolId: string;
    riskLevel: string;
    confirmationPolicy: string;
  };
};

export class CustomApiMcpToolService {
  buildTool(definition: CustomApiDefinition, endpoint: CustomApiEndpointTool): CustomApiMcpTool {
    const method = asText(endpoint.method).toUpperCase();
    const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) || endpoint.operationType !== 'read';
    const riskLevel = asText(endpoint.computedRiskLevel) || asText(endpoint.riskLevel) || 'low';
    return {
      name: buildCustomApiToolName(definition.slug, endpoint.toolSlug),
      title: endpoint.displayName,
      description: [
        endpoint.description || endpoint.displayName,
        `Risk: ${riskLevel}.`,
        isWrite ? 'Write-capable operation. Requires confirmation policy enforcement by oneceo broker.' : 'Read-only operation.',
      ].join(' '),
      inputSchema: pickObject(endpoint.inputSchemaJson),
      metadata: {
        connectorKey: 'custom_api',
        definitionId: endpoint.definitionId,
        endpointToolId: endpoint.id,
        riskLevel,
        confirmationPolicy: endpoint.confirmationPolicy,
      },
    };
  }

  async listToolsForSession(taskSessionId: string): Promise<CustomApiMcpTool[]> {
    if (!isCustomApiEnabled()) return [];
    const binding = await taskSessionConnectorBindingDAO.getByTaskSessionAndConnectorKey(taskSessionId, 'custom_api');
    if (!binding || binding.desiredState !== 'attached') return [];
    const sessionConfig = pickObject(binding.sessionConfigJson);
    const definitionId = asText(sessionConfig.definitionId);
    if (!definitionId) return [];
    const definition = await customApiDefinitionDAO.getById(definitionId);
    if (!definition || definition.status !== 'active') return [];
    const allowedIds = Array.isArray(sessionConfig.endpointToolIds)
      ? sessionConfig.endpointToolIds.map((item) => asText(item)).filter(Boolean)
      : [];
    const tools = (await customApiEndpointToolDAO.listByDefinition(definitionId)).filter((tool) => {
      if (tool.reviewStatus !== 'published') return false;
      if (allowedIds.length === 0) return false;
      return allowedIds.includes(tool.id);
    });
    return tools.map((tool) => this.buildTool(definition, tool));
  }

}

export const customApiMcpToolService = new CustomApiMcpToolService();
