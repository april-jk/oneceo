import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export type CustomApiRiskLevel = 'low' | 'medium' | 'high';
export type CustomApiOperationType = 'read' | 'create' | 'update' | 'delete' | 'action';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const RISK_ORDER: CustomApiRiskLevel[] = ['low', 'medium', 'high'];
const SENSITIVE_HEADER_NAMES = new Set(['authorization', 'cookie', 'set-cookie', 'x-api-key']);
const SENSITIVE_RESPONSE_KEYS = new Set([
  'password',
  'token',
  'secret',
  'api_key',
  'apikey',
  'authorization',
  'cookie',
  'set-cookie',
  'private_key',
]);
const FREE_OBJECT_NAMES = new Set(['body', 'payload', 'metadata', 'filter', 'query', 'options']);

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function pickObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asRisk(value: unknown, fallback: CustomApiRiskLevel = 'low'): CustomApiRiskLevel {
  const text = asText(value).toLowerCase();
  return text === 'medium' || text === 'high' || text === 'low' ? text : fallback;
}

function maxRisk(...values: CustomApiRiskLevel[]): CustomApiRiskLevel {
  return values.reduce((max, item) => (RISK_ORDER.indexOf(item) > RISK_ORDER.indexOf(max) ? item : max), 'low');
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map((item) => Number(item));
  if (parts.length !== 4 || parts.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) return true;
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isBlockedIp(value: string): boolean {
  const normalized = value.toLowerCase();
  if (normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:')) return true;
  if (normalized.startsWith('::ffff:')) {
    return isPrivateIpv4(normalized.slice('::ffff:'.length));
  }
  return isIP(value) === 4 ? isPrivateIpv4(value) : false;
}

function validateJsonSchemaNode(
  value: unknown,
  path: string,
  errors: string[],
  options: { injectStringMaxLength?: boolean } = {}
): unknown {
  const schema = pickObject(value);
  const type = schema.type;
  if (type === 'object') {
    if (schema.additionalProperties !== false) {
      errors.push(`${path}.additionalProperties must be false`);
    }
    const properties = pickObject(schema.properties);
    if (Object.keys(properties).length === 0) {
      errors.push(`${path}.properties cannot be empty`);
    }
    for (const [key, child] of Object.entries(properties)) {
      if (FREE_OBJECT_NAMES.has(key.toLowerCase()) && pickObject(child).type === 'object') {
        errors.push(`${path}.properties.${key} cannot be a free-form object`);
      }
      properties[key] = validateJsonSchemaNode(child, `${path}.properties.${key}`, errors, options);
    }
    return {
      ...schema,
      properties,
      additionalProperties: false,
    };
  }
  if (type === 'array') {
    if (typeof schema.maxItems !== 'number') {
      errors.push(`${path}.maxItems is required for arrays`);
    }
    return {
      ...schema,
      items: validateJsonSchemaNode(schema.items, `${path}.items`, errors, options),
    };
  }
  if (type === 'string') {
    if (typeof schema.maxLength !== 'number') {
      if (options.injectStringMaxLength) {
        return { ...schema, maxLength: 2048 };
      }
      errors.push(`${path}.maxLength is required for strings`);
    }
    return schema;
  }
  if (['number', 'integer', 'boolean'].includes(String(type))) {
    return schema;
  }
  errors.push(`${path}.type is unsupported`);
  return schema;
}

function scanMapping(mapping: Record<string, unknown>, errors: string[]) {
  const forbiddenTopLevel = ['url', 'scheme', 'host', 'method', 'rawBody'];
  for (const key of forbiddenTopLevel) {
    if (Object.prototype.hasOwnProperty.call(mapping, key)) {
      errors.push(`requestMapping.${key} is forbidden`);
    }
  }
  const staticHeaders = pickObject(mapping.staticHeaders);
  for (const key of Object.keys(staticHeaders)) {
    if (SENSITIVE_HEADER_NAMES.has(key.toLowerCase())) {
      errors.push(`requestMapping.staticHeaders.${key} is forbidden`);
    }
  }
}

function computeRisk(input: {
  declaredRiskLevel: CustomApiRiskLevel;
  method: string;
  pathTemplate: string;
  operationType: CustomApiOperationType;
  responseMapping: Record<string, unknown>;
}) {
  const reasons: string[] = [];
  let computed: CustomApiRiskLevel = 'low';
  if (WRITE_METHODS.has(input.method) || input.operationType !== 'read') {
    computed = 'medium';
    reasons.push(`HTTP method ${input.method} or operationType ${input.operationType} can cause side effects`);
  }
  const path = input.pathTemplate.toLowerCase();
  if (/(refund|delete|archive|payment|invoice|billing|credential|token|secret)/.test(path)) {
    computed = 'high';
    reasons.push('Path contains high-risk business or credential keyword');
  }
  if (input.responseMapping.allowRawResponse === true) {
    computed = 'high';
    reasons.push('Raw response projection is allowed');
  }
  return {
    declaredRiskLevel: input.declaredRiskLevel,
    computedRiskLevel: computed,
    effectiveRiskLevel: maxRisk(input.declaredRiskLevel, computed),
    reasons,
  };
}

export class CustomApiSecurityReviewService {
  validateBaseUrl(baseUrl: string, options?: { allowLocalhost?: boolean }) {
    const errors: string[] = [];
    let url: URL | null = null;
    try {
      url = new URL(baseUrl);
    } catch {
      errors.push('baseUrl must be a valid URL');
    }
    if (url) {
      const allowLocalhost = Boolean(options?.allowLocalhost || process.env.CUSTOM_API_ALLOW_LOCALHOST === 'true');
      if (url.protocol !== 'https:' && !(allowLocalhost && url.protocol === 'http:' && url.hostname === 'localhost')) {
        errors.push('baseUrl must use https');
      }
      if (url.username || url.password) {
        errors.push('baseUrl must not include username or password');
      }
      if (['localhost', 'metadata.google.internal'].includes(url.hostname.toLowerCase()) && !allowLocalhost) {
        errors.push('baseUrl host is blocked');
      }
      if (isIP(url.hostname) && isBlockedIp(url.hostname) && !allowLocalhost) {
        errors.push('baseUrl private IP is blocked');
      }
    }
    return { valid: errors.length === 0, errors, url };
  }

  async assertResolvedUrlSafe(url: URL, allowedHosts: string[]) {
    const allowed = new Set(allowedHosts.map((item) => item.toLowerCase()).filter(Boolean));
    if (allowed.size > 0 && !allowed.has(url.hostname.toLowerCase())) {
      throw new Error('custom_api_host_not_allowed');
    }
    const staticCheck = this.validateBaseUrl(url.toString());
    if (!staticCheck.valid) {
      throw new Error(`custom_api_url_blocked:${staticCheck.errors.join(',')}`);
    }
    const records = await lookup(url.hostname, { all: true });
    if (records.some((record) => isBlockedIp(record.address))) {
      throw new Error('custom_api_resolved_private_ip_blocked');
    }
  }

  validateEndpoint(input: {
    method: string;
    pathTemplate: string;
    inputSchemaJson: unknown;
    requestMappingJson?: unknown;
    responseMappingJson?: unknown;
    riskLevel?: unknown;
    confirmationPolicy?: unknown;
    operationType?: unknown;
  }) {
    const errors: string[] = [];
    const method = asText(input.method).toUpperCase();
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      errors.push('method is unsupported');
    }
    const pathTemplate = asText(input.pathTemplate);
    if (!pathTemplate.startsWith('/')) errors.push('pathTemplate must start with /');
    if (pathTemplate.includes('://') || pathTemplate.includes('..')) {
      errors.push('pathTemplate must not override scheme/host or contain ..');
    }

    const schema = pickObject(input.inputSchemaJson);
    if (schema.type !== 'object') errors.push('inputSchemaJson root type must be object');
    const normalizedSchema = validateJsonSchemaNode(schema, 'inputSchemaJson', errors, { injectStringMaxLength: true });

    const requestMapping = pickObject(input.requestMappingJson);
    scanMapping(requestMapping, errors);
    const responseMapping = pickObject(input.responseMappingJson);
    if (Object.keys(responseMapping).length === 0) {
      errors.push('responseMappingJson is required before publish');
    }
    const methodWrite = WRITE_METHODS.has(method);
    const confirmationPolicy = asText(input.confirmationPolicy) || 'none';
    if (methodWrite && confirmationPolicy === 'none') {
      errors.push('write methods require confirmationPolicy');
    }
    const declaredRiskLevel = asRisk(input.riskLevel);
    const operationType = (asText(input.operationType) || (methodWrite ? 'action' : 'read')) as CustomApiOperationType;
    const riskReport = computeRisk({
      declaredRiskLevel,
      method,
      pathTemplate,
      operationType,
      responseMapping,
    });
    if (riskReport.effectiveRiskLevel === 'high' && confirmationPolicy !== 'require_admin_approved_template') {
      errors.push('high risk tools require admin approved confirmation template');
    }
    return {
      valid: errors.length === 0,
      errors,
      normalized: {
        method,
        pathTemplate,
        inputSchemaJson: normalizedSchema,
        requestMappingJson: requestMapping,
        responseMappingJson: responseMapping,
        riskLevel: declaredRiskLevel,
        computedRiskLevel: riskReport.computedRiskLevel,
        riskReportJson: riskReport,
        confirmationPolicy,
        operationType,
      },
    };
  }

  redactSensitive(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.redactSensitive(item));
    }
    if (!value || typeof value !== 'object') return value;
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_RESPONSE_KEYS.has(key.toLowerCase())) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = this.redactSensitive(item);
      }
    }
    return result;
  }
}

export const customApiSecurityReviewService = new CustomApiSecurityReviewService();
