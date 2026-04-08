import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

const API_ENV_LOADED_KEY = '__oneceo_api_env_loaded__';
const EXCLUSIVE_ENV_PREFIXES = [
  'ONECEO_',
  'AGENT_',
  'LLM_',
  'OPENCODE_',
  'NOTION_',
  'KVM_',
  'CONNECTOR_',
  'WEB_BFF_',
  'OSAC_',
  'SUPABASE_',
  'OPENAI_',
  'ANTHROPIC_',
  'GOOGLE_',
  'GEMINI_',
  'AZURE_OPENAI_',
  'REDIS_',
  'DATABASE_',
  'FRONTEND_',
  'ADMIN_',
  'CORS_',
  'SESSION_',
  'JWT_',
  'E2B_',
  'VITE_',
] as const;
const EXCLUSIVE_ENV_KEYS = new Set([
  'DATABASE_URL',
  'REDIS_URL',
  'PORT',
  'API_HOST',
  'FRONTEND_URL',
  'ONECEO_API_URL',
  'WEB_BFF_API_TARGET',
  'OSAC_LLM_PROXY_PORT',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
]);

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveCandidates(): string[] {
  return [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), 'apps', 'api', '.env'),
    path.resolve(process.cwd(), 'apps', '.env'),
    path.resolve(process.cwd(), '..', '.env'),
    path.resolve(process.cwd(), '..', 'api', '.env'),
    path.resolve(process.cwd(), '..', 'apps', 'api', '.env'),
    path.resolve(process.cwd(), '..', '..', 'apps', 'api', '.env'),
    path.resolve(process.cwd(), '..', '..', 'apps', '.env'),
  ];
}

function isExclusiveBusinessEnvKey(key: string): boolean {
  if (EXCLUSIVE_ENV_KEYS.has(key)) return true;
  return EXCLUSIVE_ENV_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function clearExclusiveBusinessEnvKeys(): void {
  for (const key of Object.keys(process.env)) {
    if (!isExclusiveBusinessEnvKey(key)) continue;
    delete process.env[key];
  }
}

export function loadApiEnv(): { loadedPath?: string } {
  const globalState = globalThis as Record<string, unknown>;
  const cached = asText(globalState[API_ENV_LOADED_KEY]);
  if (cached) {
    return { loadedPath: cached === 'NO_ENV_FILE' ? undefined : cached };
  }

  for (const candidate of resolveCandidates()) {
    if (!fs.existsSync(candidate)) {
      continue;
    }
    clearExclusiveBusinessEnvKeys();
    dotenv.config({ path: candidate, override: true });
    process.env.ONECEO_ENV_SOURCE = 'dotenv';
    globalState[API_ENV_LOADED_KEY] = candidate;
    return { loadedPath: candidate };
  }

  process.env.ONECEO_ENV_SOURCE = 'process_env';
  globalState[API_ENV_LOADED_KEY] = 'NO_ENV_FILE';
  return {};
}
