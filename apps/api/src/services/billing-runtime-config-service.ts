import fs from 'node:fs/promises';
import path from 'node:path';
import { loadApiEnv } from '../config/load-env';
import { resolveAgentRuntimeProfile, type AgentModelTier } from './agent-runtime-profile-service';
import { asText } from './altus-managed-shared';
import { LLM_PROXY_INTERNAL_OVERRIDE_HEADER, getLlmProxyInternalOverrideToken } from './llm-proxy-internal-auth';
import { normalizeCodexProviderBaseUrl } from '../utils/codex-runtime-config';

type ApiType = 'openai' | 'anthropic';
type RuntimeConfigKind = 'agent' | 'sandbox';
type SandboxEngine = 'opencode' | 'codex';

type RuntimeTestStatus = 'success' | 'failed';

type RuntimeConfigInput = {
  model?: string;
  baseUrl?: string;
  apiType?: string;
  apiKey?: string;
  enabled?: boolean;
};

export type BillingRuntimeConfigItem = {
  kind: RuntimeConfigKind;
  key: string;
  displayName: string;
  model: string;
  baseUrl: string;
  baseUrlHost: string | null;
  apiType: ApiType;
  tokenState: 'configured' | 'inherited' | 'missing';
  enabled: boolean;
  runtimeConfigAnchor: string;
};

export type BillingRuntimeConfigTestResult = {
  key: string;
  status: RuntimeTestStatus;
  latencyMs: number;
  model: string;
  baseUrlHost: string | null;
  apiType: ApiType;
  tokenState: 'configured' | 'inherited' | 'missing';
  checkedAt: string;
  errorCode?: string;
  errorMessage?: string;
  responsePreview?: string;
  responseDetails?: Record<string, unknown>;
  safeRawResponse?: unknown;
  rawResponseTruncated?: boolean;
};

export type AvailableModel = {
  id: string;
  object: string;
  created?: number;
  ownedBy?: string;
};

export type BillingRuntimeConfigModelsResult = {
  key: string;
  status: 'success' | 'failed';
  models: AvailableModel[];
  latencyMs: number;
  checkedAt: string;
  errorCode?: string;
  errorMessage?: string;
};

type RuntimeTestProfile = {
  key: string;
  model: string;
  baseUrl: string;
  baseUrlHost: string | null;
  apiType: ApiType;
  tokenState: 'configured' | 'inherited' | 'missing';
  tokenEnvName: string;
};

const AGENT_TARGETS: Array<{ tier: AgentModelTier; displayName: string; anchor: string }> = [
  { tier: 'lite', displayName: 'Agent Lite', anchor: 'agent-lite' },
  { tier: 'pro', displayName: 'Agent Pro', anchor: 'agent-pro' },
  { tier: 'max', displayName: 'Agent Max', anchor: 'agent-max' },
];

const SANDBOX_TARGETS: Array<{ engine: SandboxEngine; displayName: string; anchor: string }> = [
  { engine: 'opencode', displayName: 'Sandbox OpenCode', anchor: 'sandbox-opencode' },
  { engine: 'codex', displayName: 'Sandbox Codex', anchor: 'sandbox-codex' },
];

function normalizeApiType(value: unknown): ApiType {
  return asText(value).toLowerCase() === 'anthropic' ? 'anthropic' : 'openai';
}

function hostOf(url: string): string | null {
  if (!url) return null;
  try {
    return new URL(url).host || null;
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0] || null;
  }
}

function readEnv(key: string): string {
  return asText(process.env[key]);
}

function pickEnvName(candidates: string[]): string {
  return candidates.find((key) => Boolean(readEnv(key))) || candidates[candidates.length - 1] || '';
}

function redactErrorMessage(value: unknown): string {
  const text = asText(value);
  if (!text) return '';
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/sk-[A-Za-z0-9._-]{8,}/gi, 'sk-[REDACTED]')
    .slice(0, 500);
}

function safePreview(value: unknown, maxLength = 200): string {
  return redactErrorMessage(value).slice(0, maxLength);
}

function redactJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redactJson(item));
  if (!value || typeof value !== 'object') {
    return typeof value === 'string' ? redactErrorMessage(value) : value;
  }
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase();
    const isSecretKey =
      normalized.includes('authorization') ||
      normalized.includes('api_key') ||
      normalized.includes('apikey') ||
      normalized === 'key' ||
      normalized === 'token' ||
      normalized.endsWith('_token') ||
      normalized.includes('access_token') ||
      normalized.includes('refresh_token') ||
      normalized.includes('bearer') ||
      normalized.includes('secret') ||
      normalized.includes('password');
    if (isSecretKey) {
      output[key] = '[REDACTED]';
      continue;
    }
    output[key] = redactJson(item);
  }
  return output;
}

function safeRawResponse(value: unknown): { value: unknown; truncated: boolean } {
  const redacted = redactJson(value);
  const serialized = JSON.stringify(redacted, null, 2);
  const maxLength = 24_000;
  if (serialized.length <= maxLength) return { value: redacted, truncated: false };
  return {
    value: `${serialized.slice(0, maxLength)}\n...[TRUNCATED]`,
    truncated: true,
  };
}

function buildResponseDetails(input: { httpStatus: number; json: any; text: string }) {
  const choice = input.json?.choices?.[0] || null;
  const usage = input.json?.usage && typeof input.json.usage === 'object' ? input.json.usage : null;
  return {
    httpStatus: input.httpStatus,
    requestId: input.json?.id || input.json?.request_id || input.json?.requestId || null,
    object: input.json?.object || null,
    created: input.json?.created || null,
    responseModel: input.json?.model || null,
    choicesCount: Array.isArray(input.json?.choices) ? input.json.choices.length : null,
    finishReason: choice?.finish_reason || choice?.finishReason || null,
    role: choice?.message?.role || null,
    usage,
    rawTextBytes: Buffer.byteLength(input.text || '', 'utf8'),
  };
}

function agentEnvKeys(tier: AgentModelTier) {
  const suffix = tier.toUpperCase();
  return {
    model: `ALTUS_MANAGED_MODEL_${suffix}`,
    baseUrl: `ALTUS_MANAGED_BASE_URL_${suffix}`,
    apiKey: `ALTUS_MANAGED_API_KEY_${suffix}`,
    apiType: `ALTUS_MANAGED_API_TYPE_${suffix}`,
  };
}

function sandboxEnvKeys(engine: SandboxEngine) {
  const suffix = engine.toUpperCase();
  return {
    model: `SANDBOX_ENGINE_${suffix}_MODEL`,
    baseUrl: `SANDBOX_ENGINE_${suffix}_BASE_URL`,
    apiKey: `SANDBOX_ENGINE_${suffix}_API_KEY`,
    apiType: `SANDBOX_ENGINE_${suffix}_API_TYPE`,
  };
}

function sandboxFallback(engine: SandboxEngine): { model: string; baseUrl: string; apiKey: string; apiType: string } {
  if (engine === 'opencode') {
    return {
      model: readEnv('SANDBOX_OPENAI_MODEL') || readEnv('OPENCODE_MODEL') || readEnv('OPENAI_MODEL'),
      baseUrl: readEnv('SANDBOX_OPENAI_BASE_URL') || readEnv('SANDBOX_OPENAI_API_BASE') || readEnv('OPENCODE_BASE_URL') || readEnv('OPENAI_BASE_URL'),
      apiKey: readEnv('SANDBOX_OPENAI_API_KEY') || readEnv('OPENCODE_API_KEY') || readEnv('OPENAI_API_KEY'),
      apiType: readEnv('SANDBOX_OPENAI_API_TYPE') || readEnv('LLM_PROXY_UPSTREAM_API_TYPE') || 'openai',
    };
  }
  if (engine === 'codex') {
    return {
      model: readEnv('CODEX_MODEL') || readEnv('OPENAI_MODEL') || readEnv('OPENCODE_MODEL'),
      baseUrl: readEnv('CODEX_BASE_URL') || readEnv('OPENAI_BASE_URL') || readEnv('OPENAI_API_BASE'),
      apiKey: readEnv('CODEX_API_KEY') || readEnv('OPENAI_API_KEY'),
      apiType: 'openai',
    };
  }
  return { model: '', baseUrl: '', apiKey: '', apiType: 'openai' };
}

async function resolveWritableEnvPath(): Promise<string> {
  const loaded = loadApiEnv().loadedPath;
  if (loaded) return loaded;
  return path.resolve(process.cwd(), 'apps', '.env');
}

function serializeEnvValue(value: string): string {
  if (!/[\s#"'\\]/.test(value)) return value;
  return JSON.stringify(value);
}

async function writeEnvValues(values: Record<string, string>) {
  const envPath = await resolveWritableEnvPath();
  let source = '';
  try {
    source = await fs.readFile(envPath, 'utf8');
  } catch {
    await fs.mkdir(path.dirname(envPath), { recursive: true });
  }

  const lines = source ? source.replace(/\r\n/g, '\n').split('\n') : [];
  const seen = new Set<string>();
  const nextLines = lines.map((line) => {
    const match = /^\s*([A-Z0-9_]+)\s*=/.exec(line);
    const key = match?.[1];
    if (!key || !Object.prototype.hasOwnProperty.call(values, key)) return line;
    seen.add(key);
    return `${key}=${serializeEnvValue(values[key] ?? '')}`;
  });

  const missing = Object.entries(values).filter(([key]) => !seen.has(key));
  if (missing.length > 0) {
    if (nextLines.length > 0 && nextLines[nextLines.length - 1] !== '') nextLines.push('');
    nextLines.push('# Managed by billing runtime config');
    for (const [key, value] of missing) {
      nextLines.push(`${key}=${serializeEnvValue(value ?? '')}`);
    }
  }

  await fs.writeFile(envPath, `${nextLines.join('\n').replace(/\n+$/, '')}\n`, 'utf8');
}

export class BillingRuntimeConfigService {
  listAgentConfigs(): BillingRuntimeConfigItem[] {
    return AGENT_TARGETS.map((target) => {
      const keys = agentEnvKeys(target.tier);
      const snapshot = resolveAgentRuntimeProfile({ tier: target.tier });
      const baseUrl = readEnv(keys.baseUrl) || readEnv('LLM_PROXY_UPSTREAM_BASE_URL') || readEnv('OPENAI_BASE_URL');
      return {
        kind: 'agent',
        key: snapshot.billingTargetKey,
        displayName: target.displayName,
        model: snapshot.model,
        baseUrl,
        baseUrlHost: snapshot.baseUrlHost,
        apiType: normalizeApiType(snapshot.apiType),
        tokenState: snapshot.tokenState,
        enabled: Boolean(snapshot.model),
        runtimeConfigAnchor: target.anchor,
      };
    });
  }

  listSandboxConfigs(): BillingRuntimeConfigItem[] {
    return SANDBOX_TARGETS.map((target) => {
      const keys = sandboxEnvKeys(target.engine);
      const fallback = sandboxFallback(target.engine);
      const model = readEnv(keys.model) || fallback.model || '';
      const baseUrl = readEnv(keys.baseUrl) || fallback.baseUrl || '';
      const apiKey = readEnv(keys.apiKey);
      const inheritedKey = fallback.apiKey || '';
      return {
        kind: 'sandbox',
        key: `sandbox.${target.engine}`,
        displayName: target.displayName,
        model,
        baseUrl,
        baseUrlHost: hostOf(baseUrl),
        apiType: normalizeApiType(readEnv(keys.apiType) || fallback.apiType),
        tokenState: apiKey ? 'configured' : inheritedKey ? 'inherited' : 'missing',
        enabled: Boolean(model),
        runtimeConfigAnchor: target.anchor,
      };
    });
  }

  listAllConfigs() {
    return {
      agent: this.listAgentConfigs(),
      sandbox: this.listSandboxConfigs(),
    };
  }

  listBillingTargets(): BillingRuntimeConfigItem[] {
    return [...this.listAgentConfigs(), ...this.listSandboxConfigs()];
  }

  async updateAgentConfig(tier: AgentModelTier, input: RuntimeConfigInput) {
    const keys = agentEnvKeys(tier);
    await this.updateConfig(keys, input);
    return this.listAgentConfigs().find((item) => item.key === `agent.${tier}`)!;
  }

  async updateSandboxConfig(engine: SandboxEngine, input: RuntimeConfigInput) {
    const keys = sandboxEnvKeys(engine);
    await this.updateConfig(keys, input);
    return this.listSandboxConfigs().find((item) => item.key === `sandbox.${engine}`)!;
  }

  async testRuntimeConfig(key: string): Promise<BillingRuntimeConfigTestResult> {
    const startedAt = Date.now();
    const checkedAt = new Date().toISOString();
    const profile = this.resolveRuntimeTestProfile(key);
    if (!profile) {
      return {
        key: asText(key) || 'unknown',
        status: 'failed',
        latencyMs: Date.now() - startedAt,
        model: '',
        baseUrlHost: null,
        apiType: 'openai',
        tokenState: 'missing',
        checkedAt,
        errorCode: 'target_not_found',
        errorMessage: '运行配置对象不存在',
      };
    }
    if (!profile.model) {
      return this.failedTestResult(profile, startedAt, checkedAt, 'model_missing', '模型名称未配置');
    }
    if (!profile.baseUrl) {
      return this.failedTestResult(profile, startedAt, checkedAt, 'base_url_missing', '接口 Base URL 未配置');
    }
    if (profile.tokenState === 'missing' || !readEnv(profile.tokenEnvName)) {
      return this.failedTestResult(profile, startedAt, checkedAt, 'token_missing', 'API Token 未配置');
    }

    const timeoutMs = Math.max(3000, Math.floor(Number(process.env.BILLING_RUNTIME_TEST_TIMEOUT_MS || 15000)));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const localProxyUrl = `http://127.0.0.1:${process.env.PORT || '4000'}/api/llm-proxy/v1/chat/completions`;
    try {
      const response = await fetch(localProxyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [LLM_PROXY_INTERNAL_OVERRIDE_HEADER]: getLlmProxyInternalOverrideToken(),
          'x-oneceo-internal-llm-upstream-base-url': profile.baseUrl,
          'x-oneceo-internal-llm-upstream-api-type': profile.apiType,
          'x-oneceo-internal-llm-upstream-token-source': profile.tokenEnvName,
        },
        body: JSON.stringify({
          model: profile.model,
          messages: [
            { role: 'system', content: 'You are a health check endpoint. Reply with exactly OK.' },
            { role: 'user', content: 'OK' },
          ],
          max_tokens: 16,
          temperature: 0,
          stream: false,
        }),
        signal: controller.signal,
      });
      const text = await response.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      const raw = safeRawResponse(json || text || null);
      const responseDetails = buildResponseDetails({ httpStatus: response.status, json, text });
      if (!response.ok) {
        return this.failedTestResult(
          profile,
          startedAt,
          checkedAt,
          this.resolveUpstreamErrorCode(response.status),
          redactErrorMessage(json?.error?.message || json?.message || text || `Upstream returned ${response.status}`),
          {
            responseDetails,
            safeRawResponse: raw.value,
            rawResponseTruncated: raw.truncated,
          }
        );
      }
      const content = asText(json?.choices?.[0]?.message?.content || json?.content || '');
      if (!content) {
        return this.failedTestResult(profile, startedAt, checkedAt, 'empty_response', '模型返回为空', {
          responseDetails,
          safeRawResponse: raw.value,
          rawResponseTruncated: raw.truncated,
        });
      }
      return {
        key: profile.key,
        status: 'success',
        latencyMs: Date.now() - startedAt,
        model: profile.model,
        baseUrlHost: profile.baseUrlHost,
        apiType: profile.apiType,
        tokenState: profile.tokenState,
        checkedAt,
        responsePreview: safePreview(content),
        responseDetails,
        safeRawResponse: raw.value,
        rawResponseTruncated: raw.truncated,
      };
    } catch (error: any) {
      const errorCode = error?.name === 'AbortError' ? 'timeout' : 'request_failed';
      return this.failedTestResult(profile, startedAt, checkedAt, errorCode, errorCode === 'timeout' ? '测试请求超时' : redactErrorMessage(error?.message || error));
    } finally {
      clearTimeout(timeout);
    }
  }

  async fetchAvailableModels(key: string, customModelsUrl?: string): Promise<BillingRuntimeConfigModelsResult> {
    const startedAt = Date.now();
    const checkedAt = new Date().toISOString();
    const profile = this.resolveRuntimeTestProfile(key);

    if (!profile) {
      return {
        key: asText(key) || 'unknown',
        status: 'failed',
        models: [],
        latencyMs: Date.now() - startedAt,
        checkedAt,
        errorCode: 'target_not_found',
        errorMessage: '运行配置对象不存在',
      };
    }

    if (!profile.baseUrl) {
      return {
        key: profile.key,
        status: 'failed',
        models: [],
        latencyMs: Date.now() - startedAt,
        checkedAt,
        errorCode: 'base_url_missing',
        errorMessage: '接口 Base URL 未配置',
      };
    }

    if (profile.tokenState === 'missing' || !readEnv(profile.tokenEnvName)) {
      return {
        key: profile.key,
        status: 'failed',
        models: [],
        latencyMs: Date.now() - startedAt,
        checkedAt,
        errorCode: 'token_missing',
        errorMessage: 'API Token 未配置',
      };
    }

    const timeoutMs = Math.max(3000, Math.floor(Number(process.env.BILLING_RUNTIME_TEST_TIMEOUT_MS || 15000)));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const token = readEnv(profile.tokenEnvName);
      const baseUrl = profile.baseUrl.replace(/\/$/, '');
      const modelsUrl = customModelsUrl && customModelsUrl.trim()
        ? customModelsUrl.trim()
        : (baseUrl.endsWith('/v1') ? `${baseUrl}/models` : `${baseUrl}/v1/models`);
      
      const response = await fetch(modelsUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        signal: controller.signal,
      });

      const text = await response.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }

      if (!response.ok) {
        return {
          key: profile.key,
          status: 'failed',
          models: [],
          latencyMs: Date.now() - startedAt,
          checkedAt,
          errorCode: this.resolveUpstreamErrorCode(response.status),
          errorMessage: redactErrorMessage(json?.error?.message || json?.message || text || `Upstream returned ${response.status}`),
        };
      }

      const rawModels = json?.data;
      if (!Array.isArray(rawModels)) {
        return {
          key: profile.key,
          status: 'failed',
          models: [],
          latencyMs: Date.now() - startedAt,
          checkedAt,
          errorCode: 'invalid_response',
          errorMessage: '上游返回格式不正确，未找到模型列表',
        };
      }

      const models: AvailableModel[] = rawModels
        .filter((item: any) => item && typeof item.id === 'string')
        .map((item: any) => ({
          id: item.id,
          object: typeof item.object === 'string' ? item.object : 'model',
          created: typeof item.created === 'number' ? item.created : undefined,
          ownedBy: typeof item.owned_by === 'string' ? item.owned_by : undefined,
        }));

      return {
        key: profile.key,
        status: 'success',
        models,
        latencyMs: Date.now() - startedAt,
        checkedAt,
      };
    } catch (error: any) {
      const errorCode = error?.name === 'AbortError' ? 'timeout' : 'request_failed';
      return {
        key: profile.key,
        status: 'failed',
        models: [],
        latencyMs: Date.now() - startedAt,
        checkedAt,
        errorCode,
        errorMessage: errorCode === 'timeout' ? '获取模型列表超时' : redactErrorMessage(error?.message || error),
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private failedTestResult(
    profile: RuntimeTestProfile,
    startedAt: number,
    checkedAt: string,
    errorCode: string,
    errorMessage: string,
    extra?: Pick<BillingRuntimeConfigTestResult, 'responseDetails' | 'safeRawResponse' | 'rawResponseTruncated'>
  ): BillingRuntimeConfigTestResult {
    return {
      key: profile.key,
      status: 'failed',
      latencyMs: Date.now() - startedAt,
      model: profile.model,
      baseUrlHost: profile.baseUrlHost,
      apiType: profile.apiType,
      tokenState: profile.tokenState,
      checkedAt,
      errorCode,
      errorMessage,
      ...extra,
    };
  }

  private resolveUpstreamErrorCode(status: number): string {
    if (status === 401 || status === 403) return 'upstream_unauthorized';
    if (status === 404) return 'upstream_not_found';
    if (status === 408 || status === 504) return 'upstream_timeout';
    if (status === 429) return 'upstream_rate_limited';
    if (status >= 500) return 'upstream_unavailable';
    return 'upstream_error';
  }

  private resolveRuntimeTestProfile(rawKey: string): RuntimeTestProfile | null {
    const key = asText(rawKey).toLowerCase();
    if (key.startsWith('agent.')) {
      const tier = key.replace('agent.', '') as AgentModelTier;
      if (!['lite', 'pro', 'max'].includes(tier)) return null;
      const profile = resolveAgentRuntimeProfile({ tier });
      return {
        key: profile.billingTargetKey,
        model: profile.model,
        baseUrl: profile.baseUrl || '',
        baseUrlHost: profile.baseUrlHost,
        apiType: normalizeApiType(profile.apiType),
        tokenState: profile.tokenState,
        tokenEnvName: profile.tokenSource,
      };
    }
    if (key.startsWith('sandbox.')) {
      const engine = key.replace('sandbox.', '') as SandboxEngine;
      if (engine !== 'opencode' && engine !== 'codex') return null;
      return this.resolveSandboxRuntimeTestProfile(engine);
    }
    return null;
  }

  private resolveSandboxRuntimeTestProfile(engine: SandboxEngine): RuntimeTestProfile {
    const keys = sandboxEnvKeys(engine);
    const fallback = sandboxFallback(engine);
    const configuredToken = readEnv(keys.apiKey);
    const tokenFallbackCandidates = engine === 'opencode'
      ? ['SANDBOX_OPENAI_API_KEY', 'OPENCODE_API_KEY', 'OPENAI_API_KEY']
      : ['CODEX_API_KEY', 'OPENAI_API_KEY'];
    const fallbackTokenEnvName = pickEnvName(tokenFallbackCandidates);
    const baseUrl = readEnv(keys.baseUrl) || fallback.baseUrl || '';
    const normalizedBaseUrl = engine === 'codex' ? normalizeCodexProviderBaseUrl(baseUrl) : baseUrl;
    return {
      key: `sandbox.${engine}`,
      model: readEnv(keys.model) || fallback.model || '',
      baseUrl: normalizedBaseUrl,
      baseUrlHost: hostOf(normalizedBaseUrl),
      apiType: normalizeApiType(readEnv(keys.apiType) || fallback.apiType),
      tokenState: configuredToken ? 'configured' : fallback.apiKey ? 'inherited' : 'missing',
      tokenEnvName: configuredToken ? keys.apiKey : fallbackTokenEnvName,
    };
  }

  private async updateConfig(keys: ReturnType<typeof agentEnvKeys>, input: RuntimeConfigInput) {
    const model = asText(input.model);
    if (!model) throw new Error('模型名称不能为空');
    if (asText(input.apiType).toLowerCase() === 'anthropic') {
      throw new Error('当前运行配置仅支持 OpenAI-compatible 接口；Anthropic 需先接入专用代理配置');
    }
    const values: Record<string, string> = {
      [keys.model]: model,
      [keys.baseUrl]: asText(input.baseUrl),
      [keys.apiType]: normalizeApiType(input.apiType),
    };
    const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
    if (apiKey) values[keys.apiKey] = apiKey;

    for (const [key, value] of Object.entries(values)) {
      process.env[key] = value;
    }
    await writeEnvValues(values);
  }
}

export const billingRuntimeConfigService = new BillingRuntimeConfigService();
