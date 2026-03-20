import { randomUUID } from 'node:crypto';
import { taskCreationSessionDAO, userCodexRuntimeConfigDAO } from '../db/dao';
import { ensurePlaywrightMcpInConfigToml } from '../utils/codex-runtime-config';

export type CodexRuntimeConfigPayload = {
  baseUrl: string;
  model: string;
  apiKey: string;
  configToml: string;
  authJson: string;
  updatedAt?: string;
};

type CodexRuntimeConfigInput = {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  configToml?: string;
  authJson?: string;
};

const DEFAULT_BASE_URL = 'https://ai.hvmz.cn';
const DEFAULT_MODEL = 'gpt-5.2';

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeBaseUrl(value: string | undefined): string {
  const trimmed = asString(value);
  return trimmed || DEFAULT_BASE_URL;
}

function normalizeModel(value: string | undefined): string {
  const trimmed = asString(value);
  return trimmed || DEFAULT_MODEL;
}

function buildConfigToml(input: { baseUrl: string; model: string }): string {
  return ensurePlaywrightMcpInConfigToml([
    'model_provider = "OpenAI"',
    `model = ${JSON.stringify(input.model)}`,
    `review_model = ${JSON.stringify(input.model)}`,
    'model_reasoning_effort = "high"',
    'disable_response_storage = true',
    'network_access = "enabled"',
    'windows_wsl_setup_acknowledged = true',
    'model_context_window = 1000000',
    'model_auto_compact_token_limit = 900000',
    '',
    '[model_providers.OpenAI]',
    'name = "OpenAI"',
    `base_url = ${JSON.stringify(input.baseUrl)}`,
    'wire_api = "responses"',
    'supports_websockets = true',
    'requires_openai_auth = true',
    '',
    '[features]',
    'responses_websockets_v2 = true',
    '',
  ].join('\n'));
}

function buildAuthJson(input: { apiKey: string }): string {
  return JSON.stringify(
    {
      OPENAI_API_KEY: input.apiKey,
    },
    null,
    2
  );
}

function extractTomlValue(source: string, key: string): string {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`^\\s*${escapedKey}\\s*=\\s*["']([^"']*)["']\\s*$`, 'm'));
  return match?.[1]?.trim() || '';
}

function extractBaseUrlFromConfigToml(source: string): string {
  return extractTomlValue(source, 'base_url');
}

function extractModelFromConfigToml(source: string): string {
  return extractTomlValue(source, 'model');
}

function extractApiKeyFromAuthJson(source: string): string {
  try {
    const parsed = JSON.parse(source);
    return asString(parsed?.OPENAI_API_KEY);
  } catch {
    return '';
  }
}

function toPayload(input: { configToml: string; authJson: string; updatedAt?: string | Date | null }): CodexRuntimeConfigPayload {
  const baseUrl = normalizeBaseUrl(extractBaseUrlFromConfigToml(input.configToml));
  const model = normalizeModel(extractModelFromConfigToml(input.configToml));
  const apiKey = extractApiKeyFromAuthJson(input.authJson);
  const updatedAt =
    input.updatedAt instanceof Date
      ? input.updatedAt.toISOString()
      : asString(input.updatedAt || undefined) || undefined;
  return {
    baseUrl,
    model,
    apiKey,
    configToml: input.configToml,
    authJson: input.authJson,
    updatedAt,
  };
}

function resolveStoredFiles(input: CodexRuntimeConfigInput): { configToml: string; authJson: string } {
  const rawConfigToml = typeof input.configToml === 'string' ? input.configToml : '';
  const rawAuthJson = typeof input.authJson === 'string' ? input.authJson : '';
  if (rawConfigToml.trim() || rawAuthJson.trim()) {
    if (!rawConfigToml.trim()) {
      throw new Error('config.toml 不能为空');
    }
    if (!rawAuthJson.trim()) {
      throw new Error('auth.json 不能为空');
    }
    try {
      JSON.parse(rawAuthJson);
    } catch {
      throw new Error('auth.json 不是合法 JSON');
    }
    return {
      configToml: ensurePlaywrightMcpInConfigToml(rawConfigToml.trim()),
      authJson: rawAuthJson.trim(),
    };
  }

  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const model = normalizeModel(input.model);
  const apiKey = asString(input.apiKey);
  return {
    configToml: buildConfigToml({ baseUrl, model }),
    authJson: buildAuthJson({ apiKey }),
  };
}

export class CodexRuntimeConfigService {
  buildDefault(): CodexRuntimeConfigPayload {
    const configToml = buildConfigToml({
      baseUrl: DEFAULT_BASE_URL,
      model: DEFAULT_MODEL,
    });
    const authJson = buildAuthJson({ apiKey: '' });
    return toPayload({ configToml, authJson });
  }

  async getByUserId(userId: string): Promise<CodexRuntimeConfigPayload> {
    const row = await userCodexRuntimeConfigDAO.getByUserId(userId);
    if (!row) {
      return this.buildDefault();
    }
    return toPayload({
      configToml: row.configToml,
      authJson: row.authJson,
      updatedAt: row.updatedAt,
    });
  }

  async upsertByUserId(userId: string, input: CodexRuntimeConfigInput): Promise<CodexRuntimeConfigPayload> {
    const files = resolveStoredFiles(input);
    const row = await userCodexRuntimeConfigDAO.upsert({
      id: randomUUID(),
      userId,
      configToml: files.configToml,
      authJson: files.authJson,
    });
    return toPayload({
      configToml: row.configToml,
      authJson: row.authJson,
      updatedAt: row.updatedAt,
    });
  }

  async getByTaskSessionId(taskSessionId: string): Promise<CodexRuntimeConfigPayload> {
    const session = await taskCreationSessionDAO.getSession(taskSessionId);
    const userId = asString(session?.userId);
    if (!userId) {
      return this.buildDefault();
    }
    return this.getByUserId(userId);
  }
}

export const codexRuntimeConfigService = new CodexRuntimeConfigService();
