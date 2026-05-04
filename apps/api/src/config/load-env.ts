import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

const API_ENV_LOADED_KEY = '__oneceo_api_env_loaded__';
function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function resolvePreferredEnvFileNames(): string[] {
  const runtimeEnv = asText(process.env.ONECEO_RUNTIME_ENV).toLowerCase();
  if (runtimeEnv === 'dev') {
    return ['.env.localhost', '.env.local', '.env.develop', '.env'];
  }
  if (runtimeEnv === 'staging') {
    return ['.env.local', '.env.staging', '.env'];
  }
  if (runtimeEnv === 'product') {
    return ['.env.local', '.env.product', '.env'];
  }
  return ['.env.localhost', '.env.local', '.env', '.env.develop', '.env.staging', '.env.product'];
}

function resolveCandidates(): string[] {
  const fileNames = resolvePreferredEnvFileNames();
  const baseDirs = Array.from(new Set([
    process.cwd(),
    path.resolve(process.cwd(), '..'),
    path.resolve(process.cwd(), '..', '..'),
    path.resolve(process.cwd(), 'apps', 'api'),
    path.resolve(process.cwd(), 'apps'),
    path.resolve(process.cwd(), '..', 'api'),
    path.resolve(process.cwd(), '..', 'apps', 'api'),
    path.resolve(process.cwd(), '..', '..', 'apps', 'api'),
    path.resolve(process.cwd(), '..', '..', 'apps'),
  ]));
  const candidates: string[] = [];
  for (const fileName of fileNames) {
    for (const baseDir of baseDirs) {
      candidates.push(path.resolve(baseDir, fileName));
    }
  }
  return candidates;
}

export function loadApiEnv(): { loadedPath?: string } {
  const globalState = globalThis as Record<string, unknown>;
  const cached = asText(globalState[API_ENV_LOADED_KEY]);
  if (cached) {
    return { loadedPath: cached === 'NO_ENV_FILE' ? undefined : cached };
  }

  const loadedPaths: string[] = [];
  for (const candidate of resolveCandidates()) {
    if (!fs.existsSync(candidate)) {
      continue;
    }
    // Keep process-level env vars as highest priority (especially in production containers).
    dotenv.config({ path: candidate, override: false });
    loadedPaths.push(candidate);
  }

  if (loadedPaths.length > 0) {
    const loadedPath = loadedPaths.join(',');
    process.env.ONECEO_ENV_SOURCE = 'dotenv';
    globalState[API_ENV_LOADED_KEY] = loadedPath;
    return { loadedPath };
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
