import { createHash } from 'node:crypto';
import {
  customApiAuditLogDAO,
  customApiDefinitionDAO,
  customApiEndpointToolDAO,
} from '../db/dao';
import { customApiSecurityReviewService } from './custom-api-security-review-service';
import { userConnectorService } from './user-connector-service';
import { sessionConnectorService } from './session-connector-service';
import { assertCustomApiEnabled } from './custom-api-feature-flag';

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function pickObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function stableJson(value: unknown): string {
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(',')}}`;
}

function slugify(value: unknown) {
  return asText(value)
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function asHostList(baseUrl: string, raw: unknown): string[] {
  const values = Array.isArray(raw) ? raw.map((item) => asText(item)).filter(Boolean) : [];
  if (values.length > 0) return values;
  return [new URL(baseUrl).hostname];
}

export class CustomApiConnectorService {
  async listDefinitions(userId: string) {
    assertCustomApiEnabled();
    return customApiDefinitionDAO.listByOwner(userId);
  }

  async createDefinition(userId: string, input: Record<string, unknown>) {
    assertCustomApiEnabled();
    const baseUrl = asText(input.baseUrl);
    const validation = customApiSecurityReviewService.validateBaseUrl(baseUrl);
    if (!validation.valid || !validation.url) {
      throw new Error(validation.errors.join(',') || 'custom_api_definition_invalid');
    }
    const slug = slugify(input.slug || input.name);
    if (!slug) throw new Error('custom_api_definition_slug_required');
    return customApiDefinitionDAO.create({
      ownerUserId: userId,
      scope: asText(input.scope) || 'user',
      slug,
      name: asText(input.name) || slug,
      description: asText(input.description),
      baseUrl: validation.url.toString(),
      authMode: asText(input.authMode) || 'none',
      defaultHeadersJson: pickObject(input.defaultHeadersJson || input.defaultHeaders),
      allowedHostsJson: asHostList(validation.url.toString(), input.allowedHostsJson || input.allowedHosts) as any,
      status: 'active',
      createdBy: userId,
    } as any);
  }

  async updateDefinition(userId: string, definitionId: string, input: Record<string, unknown>) {
    assertCustomApiEnabled();
    const current = await customApiDefinitionDAO.getByIdAndOwner(definitionId, userId);
    if (!current) throw new Error('custom_api_definition_not_found');
    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = asText(input.name);
    if (input.description !== undefined) patch.description = asText(input.description);
    if (input.defaultHeadersJson !== undefined || input.defaultHeaders !== undefined) {
      patch.defaultHeadersJson = pickObject(input.defaultHeadersJson || input.defaultHeaders);
    }
    if (input.authMode !== undefined) patch.authMode = asText(input.authMode) || current.authMode;
    if (input.baseUrl !== undefined) {
      const publishedTools = (await customApiEndpointToolDAO.listByDefinition(definitionId)).filter(
        (item) => item.reviewStatus === 'published'
      );
      if (publishedTools.length > 0) {
        throw new Error('custom_api_base_url_locked_after_publish');
      }
      const validation = customApiSecurityReviewService.validateBaseUrl(asText(input.baseUrl));
      if (!validation.valid || !validation.url) throw new Error(validation.errors.join(','));
      patch.baseUrl = validation.url.toString();
      patch.allowedHostsJson = asHostList(validation.url.toString(), input.allowedHostsJson || input.allowedHosts);
    }
    return customApiDefinitionDAO.update(definitionId, userId, patch as any);
  }

  async createProfile(userId: string, definitionId: string, input: Record<string, unknown>) {
    assertCustomApiEnabled();
    const definition = await customApiDefinitionDAO.getByIdAndOwner(definitionId, userId);
    if (!definition) throw new Error('custom_api_definition_not_found');
    return userConnectorService.createProfile(userId, 'custom_api', {
      profileName: asText(input.profileName) || `${definition.name} Default`,
      displayName: asText(input.displayName) || definition.name,
      config: {
        definitionId,
      },
      credentials: pickObject(input.credentials),
      metadata: {
        customApiDefinitionId: definitionId,
      },
    });
  }

  async listTools(userId: string, definitionId: string) {
    assertCustomApiEnabled();
    const definition = await customApiDefinitionDAO.getByIdAndOwner(definitionId, userId);
    if (!definition) throw new Error('custom_api_definition_not_found');
    return customApiEndpointToolDAO.listByDefinition(definitionId);
  }

  async createTool(userId: string, definitionId: string, input: Record<string, unknown>) {
    assertCustomApiEnabled();
    const definition = await customApiDefinitionDAO.getByIdAndOwner(definitionId, userId);
    if (!definition) throw new Error('custom_api_definition_not_found');
    const review = customApiSecurityReviewService.validateEndpoint(input as any);
    if (!review.valid) throw new Error(review.errors.join(','));
    return customApiEndpointToolDAO.create({
      definitionId,
      toolSlug: slugify(input.toolSlug || input.displayName),
      displayName: asText(input.displayName),
      description: asText(input.description),
      method: review.normalized.method,
      pathTemplate: review.normalized.pathTemplate,
      operationType: review.normalized.operationType,
      inputSchemaJson: review.normalized.inputSchemaJson as any,
      requestMappingJson: review.normalized.requestMappingJson as any,
      responseMappingJson: review.normalized.responseMappingJson as any,
      riskLevel: review.normalized.riskLevel,
      computedRiskLevel: review.normalized.computedRiskLevel,
      riskReportJson: review.normalized.riskReportJson as any,
      confirmationPolicy: review.normalized.confirmationPolicy,
      reviewStatus: 'draft',
      createdBy: userId,
    } as any);
  }

  async updateTool(userId: string, toolId: string, input: Record<string, unknown>) {
    assertCustomApiEnabled();
    const tool = await customApiEndpointToolDAO.getById(toolId);
    if (!tool) throw new Error('custom_api_tool_not_found');
    const definition = await customApiDefinitionDAO.getByIdAndOwner(tool.definitionId, userId);
    if (!definition) throw new Error('custom_api_definition_not_found');
    if (!['draft', 'rejected', 'disabled'].includes(tool.reviewStatus)) {
      throw new Error('custom_api_tool_locked_after_review');
    }
    const next = {
      method: asText(input.method) || tool.method,
      pathTemplate: asText(input.pathTemplate) || tool.pathTemplate,
      inputSchemaJson: input.inputSchemaJson ?? tool.inputSchemaJson,
      requestMappingJson: input.requestMappingJson ?? tool.requestMappingJson,
      responseMappingJson: input.responseMappingJson ?? tool.responseMappingJson,
      riskLevel: input.riskLevel ?? tool.riskLevel,
      confirmationPolicy: input.confirmationPolicy ?? tool.confirmationPolicy,
      operationType: input.operationType ?? tool.operationType,
    };
    const review = customApiSecurityReviewService.validateEndpoint(next);
    if (!review.valid) throw new Error(review.errors.join(','));
    return customApiEndpointToolDAO.update(toolId, {
      displayName: input.displayName !== undefined ? asText(input.displayName) : tool.displayName,
      description: input.description !== undefined ? asText(input.description) : tool.description,
      ...review.normalized,
      reviewStatus: tool.reviewStatus === 'disabled' ? 'disabled' : 'draft',
    } as any);
  }

  async submitReview(userId: string, toolId: string) {
    assertCustomApiEnabled();
    const tool = await customApiEndpointToolDAO.getById(toolId);
    if (!tool) throw new Error('custom_api_tool_not_found');
    const definition = await customApiDefinitionDAO.getByIdAndOwner(tool.definitionId, userId);
    if (!definition) throw new Error('custom_api_definition_not_found');
    if (!['draft', 'rejected'].includes(tool.reviewStatus)) {
      throw new Error('custom_api_tool_cannot_submit');
    }
    return customApiEndpointToolDAO.updateReviewStatus(toolId, {
      reviewStatus: 'pending_review',
      reviewedBy: null,
      reviewedAt: null,
      reviewNotes: null,
    });
  }

  async evaluateRisk(input: Record<string, unknown>) {
    assertCustomApiEnabled();
    return customApiSecurityReviewService.validateEndpoint({
      method: asText(input.method),
      pathTemplate: asText(input.pathTemplate),
      inputSchemaJson: input.inputSchemaJson,
      requestMappingJson: input.requestMappingJson,
      responseMappingJson: input.responseMappingJson,
      riskLevel: input.riskLevel,
      confirmationPolicy: input.confirmationPolicy,
      operationType: input.operationType,
    });
  }

  async attachToSession(
    userId: string,
    taskSessionId: string,
    definitionId: string,
    profileId: string,
    endpointToolIds: string[],
    orchestratorSessionId?: string
  ) {
    assertCustomApiEnabled();
    const definition = await customApiDefinitionDAO.getByIdAndOwner(definitionId, userId);
    if (!definition) throw new Error('custom_api_definition_not_found');
    const tools = await customApiEndpointToolDAO.listByDefinition(definitionId);
    const published = new Set(tools.filter((item) => item.reviewStatus === 'published').map((item) => item.id));
    const selected = endpointToolIds.filter((id) => published.has(id));
    if (selected.length === 0) throw new Error('custom_api_attach_requires_published_tool_subset');
    return sessionConnectorService.attachConnector(
      taskSessionId,
      userId,
      'custom_api',
      profileId,
      selected,
      {
        definitionId,
        endpointToolIds: selected,
      },
      orchestratorSessionId
    );
  }

  async approveTool(toolId: string, adminUserId: string, reviewNote?: string) {
    assertCustomApiEnabled();
    const tool = await customApiEndpointToolDAO.getById(toolId);
    if (!tool) throw new Error('custom_api_tool_not_found');
    const review = customApiSecurityReviewService.validateEndpoint({
      method: tool.method,
      pathTemplate: tool.pathTemplate,
      inputSchemaJson: tool.inputSchemaJson,
      requestMappingJson: tool.requestMappingJson,
      responseMappingJson: tool.responseMappingJson,
      riskLevel: tool.riskLevel,
      confirmationPolicy: tool.confirmationPolicy,
      operationType: tool.operationType,
    });
    if (!review.valid) throw new Error(review.errors.join(','));
    return customApiEndpointToolDAO.updateReviewStatus(toolId, {
      reviewStatus: 'approved',
      reviewedBy: adminUserId,
      reviewedAt: new Date(),
      reviewNotes: reviewNote || null,
    });
  }

  async rejectTool(toolId: string, adminUserId: string, reviewNote?: string) {
    assertCustomApiEnabled();
    return customApiEndpointToolDAO.updateReviewStatus(toolId, {
      reviewStatus: 'rejected',
      reviewedBy: adminUserId,
      reviewedAt: new Date(),
      reviewNotes: reviewNote || null,
    });
  }

  async publishTool(toolId: string, adminUserId: string, reviewNote?: string) {
    assertCustomApiEnabled();
    const tool = await customApiEndpointToolDAO.getById(toolId);
    if (!tool) throw new Error('custom_api_tool_not_found');
    if (tool.reviewStatus !== 'approved') throw new Error('custom_api_tool_must_be_approved_before_publish');
    await customApiEndpointToolDAO.updateReviewStatus(toolId, {
      reviewStatus: 'published',
      reviewedBy: adminUserId,
      reviewedAt: new Date(),
      reviewNotes: reviewNote || tool.reviewNotes || null,
    });
    return customApiEndpointToolDAO.getById(toolId);
  }

  async disableTool(toolId: string, adminUserId: string, reviewNote?: string) {
    assertCustomApiEnabled();
    return customApiEndpointToolDAO.updateReviewStatus(toolId, {
      reviewStatus: 'disabled',
      reviewedBy: adminUserId,
      reviewedAt: new Date(),
      reviewNotes: reviewNote || null,
    });
  }

  async listReviewQueue() {
    assertCustomApiEnabled();
    return customApiEndpointToolDAO.listReviewQueue();
  }

  async listAuditLogs(limit?: number) {
    assertCustomApiEnabled();
    return customApiAuditLogDAO.list(limit);
  }

  async createConfirmation(userId: string, input: Record<string, unknown>) {
    assertCustomApiEnabled();
    const endpointToolId = asText(input.endpointToolId);
    const taskSessionId = asText(input.taskSessionId);
    const toolName = asText(input.toolName);
    const argumentsJson = pickObject(input.argumentsJson);
    if (!endpointToolId || !taskSessionId || !toolName) throw new Error('custom_api_confirmation_missing_fields');
    const { customApiConfirmationDAO } = await import('../db/dao');
    return customApiConfirmationDAO.create({
      userId,
      taskSessionId,
      endpointToolId,
      toolName,
      argumentsHash: createHash('sha256').update(stableJson(argumentsJson)).digest('hex'),
      effectiveRiskLevel: asText(input.effectiveRiskLevel) || 'medium',
      confirmationText: asText(input.confirmationText) || 'Confirmed',
      confirmedBy: userId,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    } as any);
  }
}

export const customApiConnectorService = new CustomApiConnectorService();
