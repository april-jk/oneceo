import { randomUUID } from 'node:crypto';
import { taskCreationSessionDAO, userCodexRuntimeConfigDAO } from '../db/dao';
import {
  buildCodexAuthJson,
  buildCodexConfigToml,
  DEFAULT_CODEX_API_KEY,
  ensurePlaywrightMcpInConfigToml,
  normalizeCodexApiKey,
  normalizeCodexBaseUrl,
  normalizeCodexModel,
} from '../utils/codex-runtime-config';

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

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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
  const baseUrl = normalizeCodexBaseUrl(extractBaseUrlFromConfigToml(input.configToml));
  const model = normalizeCodexModel(extractModelFromConfigToml(input.configToml));
  const apiKey = normalizeCodexApiKey(extractApiKeyFromAuthJson(input.authJson));
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

  const baseUrl = normalizeCodexBaseUrl(input.baseUrl);
  const model = normalizeCodexModel(input.model);
  const apiKey = normalizeCodexApiKey(input.apiKey);
  return {
    configToml: buildCodexConfigToml({ baseUrl, model }),
    authJson: buildCodexAuthJson({ apiKey }),
  };
}

export class CodexRuntimeConfigService {
  buildDefault(): CodexRuntimeConfigPayload {
    const configToml = buildCodexConfigToml({
      baseUrl: normalizeCodexBaseUrl(undefined),
      model: normalizeCodexModel(undefined),
    });
    const authJson = buildCodexAuthJson({ apiKey: DEFAULT_CODEX_API_KEY });
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
