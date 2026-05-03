import { createHash, randomUUID } from 'node:crypto';
import {
  customApiAuditLogDAO,
  customApiConfirmationDAO,
  customApiDefinitionDAO,
  customApiEndpointToolDAO,
  taskCreationSessionDAO,
  taskSessionConnectorBindingDAO,
  userConnectorProfileDAO,
} from '../db/dao';
import { connectorSecretService } from './connector-secret-service';
import { customApiSecurityReviewService, type CustomApiRiskLevel } from './custom-api-security-review-service';
import { buildCustomApiToolName } from './custom-api-mcp-tool-service';
import type { ConnectorAccountSecret } from './connector-registry';

type ExecuteCustomApiToolInput = {
  userId: string;
  taskSessionId: string;
  runId?: string;
  definitionId?: string;
  connectorProfileId: string;
  endpointToolId: string;
  toolName?: string;
  callerType: 'agent' | 'user' | 'admin_test' | 'system';
  argumentsJson: unknown;
  confirmationId?: string;
};

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

function sha256(value: unknown) {
  return createHash('sha256').update(typeof value === 'string' ? value : stableJson(value)).digest('hex');
}

function riskMax(...values: CustomApiRiskLevel[]): CustomApiRiskLevel {
  const order = ['low', 'medium', 'high'];
  return values.reduce((max, value) => (order.indexOf(value) > order.indexOf(max) ? value : max), 'low' as CustomApiRiskLevel);
}

function asRisk(value: unknown): CustomApiRiskLevel {
  const text = asText(value);
  return text === 'medium' || text === 'high' || text === 'low' ? text : 'low';
}

function resolveJsonPath(source: Record<string, unknown>, path: unknown): unknown {
  const text = asText(path);
  if (!text.startsWith('$.')) return undefined;
  return text
    .slice(2)
    .split('.')
    .filter(Boolean)
    .reduce<unknown>((current, part) => {
      if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
      return (current as Record<string, unknown>)[part];
    }, source);
}

function setValue(target: Record<string, unknown>, key: string, value: unknown) {
  if (value !== undefined && value !== null && value !== '') {
    target[key] = value;
  }
}

function validateArguments(schema: unknown, args: Record<string, unknown>, path = 'arguments') {
  const errors: string[] = [];
  const record = pickObject(schema);
  if (record.type !== 'object') return errors;
  const properties = pickObject(record.properties);
  const required = Array.isArray(record.required) ? record.required.map((item) => asText(item)).filter(Boolean) : [];
  for (const key of required) {
    if (!(key in args)) errors.push(`${path}.${key} is required`);
  }
  if (record.additionalProperties === false) {
    for (const key of Object.keys(args)) {
      if (!(key in properties)) errors.push(`${path}.${key} is not allowed`);
    }
  }
  for (const [key, property] of Object.entries(properties)) {
    const prop = pickObject(property);
    const value = args[key];
    if (value === undefined || value === null) continue;
    if (prop.type === 'string') {
      if (typeof value !== 'string') errors.push(`${path}.${key} must be string`);
      if (typeof value === 'string' && typeof prop.maxLength === 'number' && value.length > prop.maxLength) {
        errors.push(`${path}.${key} exceeds maxLength`);
      }
    }
    if (prop.type === 'integer' && !Number.isInteger(value)) errors.push(`${path}.${key} must be integer`);
    if (prop.type === 'number' && typeof value !== 'number') errors.push(`${path}.${key} must be number`);
    if (prop.type === 'boolean' && typeof value !== 'boolean') errors.push(`${path}.${key} must be boolean`);
  }
  return errors;
}

function interpolatePath(pathTemplate: string, pathParams: Record<string, unknown>) {
  return pathTemplate.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key) => {
    const value = pathParams[key];
    if (value === undefined || value === null || value === '') {
      throw new Error(`custom_api_missing_path_param:${key}`);
    }
    return encodeURIComponent(String(value));
  });
}

function buildMappedRequest(input: {
  baseUrl: string;
  pathTemplate: string;
  args: Record<string, unknown>;
  mapping: Record<string, unknown>;
  defaultHeaders: Record<string, unknown>;
}) {
  const pathParams: Record<string, unknown> = {};
  for (const [key, path] of Object.entries(pickObject(input.mapping.pathParams))) {
    setValue(pathParams, key, resolveJsonPath(input.args, path));
  }
  const url = new URL(interpolatePath(input.pathTemplate, pathParams), input.baseUrl);
  for (const [key, path] of Object.entries(pickObject(input.mapping.queryParams))) {
    const value = resolveJsonPath(input.args, path);
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.defaultHeaders)) {
    if (value !== undefined && value !== null) headers[key] = String(value);
  }
  for (const [key, value] of Object.entries(pickObject(input.mapping.staticHeaders))) {
    if (value !== undefined && value !== null) headers[key] = String(value);
  }
  const bodyTemplate = pickObject(input.mapping.jsonBody);
  const body: Record<string, unknown> = {};
  for (const [key, path] of Object.entries(bodyTemplate)) {
    setValue(body, key, resolveJsonPath(input.args, path));
  }
  return {
    url,
    headers,
    body: Object.keys(body).length > 0 ? body : undefined,
  };
}

function applyAuth(headers: Record<string, string>, authMode: string, secret: ConnectorAccountSecret | null) {
  if (authMode === 'none') return;
  if (authMode === 'bearer_token') {
    const token = asText(secret?.accessToken || (secret as any)?.token);
    if (!token) throw new Error('custom_api_profile_secret_missing');
    headers.Authorization = `Bearer ${token}`;
    return;
  }
  if (authMode === 'api_key_header') {
    const keyName = asText((secret as any)?.headerName) || 'x-api-key';
    const token = asText(secret?.accessToken || (secret as any)?.apiKey);
    if (!token) throw new Error('custom_api_profile_secret_missing');
    headers[keyName] = token;
    return;
  }
  if (authMode === 'basic') {
    const username = asText((secret as any)?.username);
    const password = asText((secret as any)?.password);
    if (!username || !password) throw new Error('custom_api_profile_secret_missing');
    headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
  }
}

function projectResponse(payload: unknown, projection: Record<string, unknown>) {
  const redacted = customApiSecurityReviewService.redactSensitive(payload);
  if (projection.allowRawResponse === true) return redacted;
  const include = Array.isArray(projection.includeJsonPaths)
    ? projection.includeJsonPaths.map((item) => asText(item)).filter(Boolean)
    : [];
  if (include.length === 0) return redacted;
  const source = pickObject(redacted);
  const result: Record<string, unknown> = {};
  for (const path of include) {
    const key = path.replace(/^\$\./, '').replace(/[^a-zA-Z0-9_]+/g, '_');
    setValue(result, key, resolveJsonPath(source, path));
  }
  return result;
}

function preview(value: unknown, limit = 2000) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > limit ? `${text.slice(0, limit)}...[truncated]` : text;
}

export class CustomApiBrokerService {
  async executeCustomApiTool(input: ExecuteCustomApiToolInput) {
    const startedAt = Date.now();
    const requestId = randomUUID();
    let auditId: string | null = null;
    let endpointId = input.endpointToolId;
    let definitionId = asText(input.definitionId);
    const toolName = asText(input.toolName);
    try {
      const endpoint = await customApiEndpointToolDAO.getById(endpointId);
      if (!endpoint) throw new Error('custom_api_tool_not_found');
      definitionId = definitionId || endpoint.definitionId;
      const definition = await customApiDefinitionDAO.getById(definitionId);
      if (!definition) throw new Error('custom_api_definition_not_found');
      const declaredRiskLevel = asRisk(endpoint.riskLevel);
      const computedRiskLevel = asRisk(endpoint.computedRiskLevel);
      const runtimeRiskLevel = 'low';
      const effectiveRiskLevel = riskMax(declaredRiskLevel, computedRiskLevel, runtimeRiskLevel);
      const resolvedToolName = toolName || buildCustomApiToolName(definition.slug, endpoint.toolSlug);

      const audit = await customApiAuditLogDAO.create({
        userId: input.userId,
        taskSessionId: input.taskSessionId,
        runId: input.runId || null,
        definitionId,
        endpointToolId: endpoint.id,
        connectorProfileId: input.connectorProfileId,
        toolName: resolvedToolName,
        method: endpoint.method,
        operationType: endpoint.operationType,
        requestId,
        callerType: input.callerType,
        declaredRiskLevel,
        computedRiskLevel,
        runtimeRiskLevel,
        effectiveRiskLevel,
        status: 'started',
      } as any);
      auditId = audit.id;

      if (endpoint.reviewStatus !== 'published') throw new Error('custom_api_tool_not_published');
      if (definition.status !== 'active') throw new Error('custom_api_definition_not_active');
      if (definition.ownerUserId !== input.userId) throw new Error('custom_api_owner_mismatch');

      const session = await taskCreationSessionDAO.getSession(input.taskSessionId);
      if (asText(session?.userId) !== input.userId) throw new Error('custom_api_session_owner_mismatch');
      const binding = await taskSessionConnectorBindingDAO.getByTaskSessionAndConnectorKey(
        input.taskSessionId,
        'custom_api'
      );
      const sessionConfig = pickObject(binding?.sessionConfigJson);
      const endpointIds = Array.isArray(sessionConfig.endpointToolIds)
        ? sessionConfig.endpointToolIds.map((item) => asText(item)).filter(Boolean)
        : [];
      if (
        !binding ||
        binding.desiredState !== 'attached' ||
        asText(binding.profileId) !== input.connectorProfileId ||
        asText(sessionConfig.definitionId) !== definitionId ||
        !endpointIds.includes(endpoint.id)
      ) {
        throw new Error('custom_api_not_attached_to_session');
      }

      const args = pickObject(input.argumentsJson);
      const argErrors = validateArguments(endpoint.inputSchemaJson, args);
      if (argErrors.length > 0) throw new Error(`custom_api_arguments_invalid:${argErrors.join(',')}`);
      if (endpoint.confirmationPolicy !== 'none') {
        const confirmation = input.confirmationId
          ? await customApiConfirmationDAO.getById(input.confirmationId)
          : null;
        const valid =
          confirmation &&
          confirmation.userId === input.userId &&
          confirmation.taskSessionId === input.taskSessionId &&
          confirmation.endpointToolId === endpoint.id &&
          confirmation.argumentsHash === sha256(args) &&
          confirmation.expiresAt.getTime() > Date.now();
        if (!valid) {
          await customApiAuditLogDAO.update(auditId, {
            status: 'requires_confirmation',
            durationMs: Date.now() - startedAt,
            resultSummary: 'Custom API tool requires argument-bound confirmation',
          } as any);
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  status: 'requires_confirmation',
                  endpointToolId: endpoint.id,
                  toolName: resolvedToolName,
                  effectiveRiskLevel,
                  argumentsHash: sha256(args),
                }),
              },
            ],
            structuredContent: {
              status: 'requires_confirmation',
              endpointToolId: endpoint.id,
              toolName: resolvedToolName,
              effectiveRiskLevel,
            },
          };
        }
      }

      const profile = await userConnectorProfileDAO.getByIdAndUser(input.connectorProfileId, input.userId);
      if (!profile || profile.connectorKey !== 'custom_api' || profile.authStatus !== 'authorized') {
        throw new Error('custom_api_profile_not_authorized');
      }
      const profileConfig = pickObject(profile.configJson);
      if (asText(profileConfig.definitionId) !== definitionId) throw new Error('custom_api_profile_definition_mismatch');

      const mapped = buildMappedRequest({
        baseUrl: definition.baseUrl,
        pathTemplate: endpoint.pathTemplate,
        args,
        mapping: pickObject(endpoint.requestMappingJson),
        defaultHeaders: pickObject(definition.defaultHeadersJson),
      });
      const allowedHosts = Array.isArray(definition.allowedHostsJson)
        ? definition.allowedHostsJson.map((item) => asText(item)).filter(Boolean)
        : [new URL(definition.baseUrl).hostname];
      await customApiSecurityReviewService.assertResolvedUrlSafe(mapped.url, allowedHosts);

      const secret = profile.secretCiphertext
        ? connectorSecretService.decryptJson<ConnectorAccountSecret>(profile.secretCiphertext, 'custom_api')
        : null;
      applyAuth(mapped.headers, definition.authMode, secret);
      const requestBody = mapped.body ? JSON.stringify(mapped.body) : undefined;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      const outboundHeaders: Record<string, string> = {
        Accept: 'application/json',
        ...mapped.headers,
      };
      if (mapped.body) {
        outboundHeaders['Content-Type'] = 'application/json';
      }
      const response = await fetch(mapped.url, {
        method: endpoint.method,
        headers: outboundHeaders,
        body: requestBody,
        redirect: 'manual',
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));
      const rawText = await response.text();
      let parsed: unknown = null;
      try {
        parsed = rawText ? JSON.parse(rawText) : null;
      } catch {
        parsed = { text: rawText };
      }
      const projected = projectResponse(parsed, pickObject(endpoint.responseMappingJson));
      await customApiAuditLogDAO.update(auditId, {
        status: response.ok ? 'success' : 'failed',
        responseStatus: response.status,
        durationMs: Date.now() - startedAt,
        resolvedUrlHash: sha256(mapped.url.toString()),
        resolvedUrlRedacted: `${mapped.url.origin}${mapped.url.pathname}`,
        requestBodyHash: requestBody ? sha256(requestBody) : null,
        responseBodyRedactedPreview: preview(projected),
        resultSummary: response.ok ? 'Custom API broker call succeeded' : `Custom API returned ${response.status}`,
      } as any);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(projected) }],
        structuredContent: projected,
      };
    } catch (error) {
      if (auditId) {
        await customApiAuditLogDAO.update(auditId, {
          status: 'failed',
          durationMs: Date.now() - startedAt,
          errorCode: error instanceof Error ? error.message : String(error),
        } as any).catch(() => null);
      }
      throw error;
    }
  }
}

export const customApiBrokerService = new CustomApiBrokerService();
