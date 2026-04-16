import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

const API_ENV_LOADED_KEY = '__oneceo_api_env_loaded__';
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
    // Keep process-level env vars as highest priority (especially in production containers).
    dotenv.config({ path: candidate, override: false });
    process.env.ONECEO_ENV_SOURCE = 'dotenv';
    globalState[API_ENV_LOADED_KEY] = candidate;
    return { loadedPath: candidate };
  }

  process.env.ONECEO_ENV_SOURCE = 'process_env';
  globalState[API_ENV_LOADED_KEY] = 'NO_ENV_FILE';
  return {};
}

export function __resetLoadApiEnvForTest(): void {
  const globalState = globalThis as Record<string, unknown>;
  delete globalState[API_ENV_LOADED_KEY];
  delete process.env.ONECEO_ENV_SOURCE;
}
