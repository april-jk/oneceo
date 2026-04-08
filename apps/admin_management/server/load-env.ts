import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';

const ADMIN_ENV_LOADED_KEY = '__oneceo_admin_env_loaded__';

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveCandidates(): string[] {
  return [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), 'apps', 'admin_management', '.env'),
    path.resolve(process.cwd(), 'apps', '.env'),
    path.resolve(process.cwd(), '..', '.env'),
    path.resolve(process.cwd(), '..', 'admin_management', '.env'),
    path.resolve(process.cwd(), '..', '..', 'apps', 'admin_management', '.env'),
    path.resolve(process.cwd(), '..', '..', 'apps', '.env'),
  ];
}

export function loadAdminEnv(): { loadedPath?: string } {
  const globalState = globalThis as Record<string, unknown>;
  const cached = asText(globalState[ADMIN_ENV_LOADED_KEY]);
  if (cached) {
    return { loadedPath: cached === 'NO_ENV_FILE' ? undefined : cached };
  }

  for (const candidate of resolveCandidates()) {
    if (!fs.existsSync(candidate)) {
      continue;
    }
    dotenv.config({ path: candidate, override: true });
    globalState[ADMIN_ENV_LOADED_KEY] = candidate;
    return { loadedPath: candidate };
  }

  globalState[ADMIN_ENV_LOADED_KEY] = 'NO_ENV_FILE';
  return {};
}
