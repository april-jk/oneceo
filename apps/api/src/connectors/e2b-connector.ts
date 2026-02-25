import { Sandbox } from 'e2b';
import { e2bConfig, requireE2bApiKey } from '../config/e2b-config';

type CachedSandbox = {
  sandbox: Sandbox;
  lastUsedAt: number;
};

type CreateSandboxInput = {
  template?: string;
  timeoutMs?: number;
  metadata?: Record<string, unknown>;
  envs?: Record<string, string>;
  allowInternetAccess?: boolean;
  allowPublicTraffic?: boolean;
};

type RunCommandOptions = {
  background?: boolean;
  envs?: Record<string, string>;
  cwd?: string;
  timeoutMs?: number;
};

const sandboxCache = new Map<string, CachedSandbox>();

function touch(sandbox: Sandbox) {
  sandboxCache.set(sandbox.sandboxId, { sandbox, lastUsedAt: Date.now() });
}

function toPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetriableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return (
    normalized.includes('econnreset') ||
    normalized.includes('fetch failed') ||
    normalized.includes('connect timeout') ||
    normalized.includes('und_err_connect_timeout') ||
    normalized.includes('socket hang up') ||
    normalized.includes('eai_again') ||
    normalized.includes('enotfound') ||
    normalized.includes('tls connection was established')
  );
}

async function withRetry<T>(label: string, action: () => Promise<T>): Promise<T> {
  const maxAttempts = Math.max(1, toPositiveInt(process.env.E2B_CREATE_RETRIES, 3));
  const delayMs = Math.max(500, toPositiveInt(process.env.E2B_CREATE_RETRY_DELAY_MS, 2000));
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isRetriableError(error)) {
        break;
      }
      console.warn(`[E2B_RETRY] ${label} failed (attempt ${attempt}/${maxAttempts}): ${error}`);
      await sleep(delayMs);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function connectSandbox(sandboxId: string): Promise<Sandbox> {
  const cached = sandboxCache.get(sandboxId);
  if (cached) {
    cached.lastUsedAt = Date.now();
    return cached.sandbox;
  }
  requireE2bApiKey();
  const sandbox = await withRetry('connectSandbox', () => Sandbox.connect(sandboxId));
  touch(sandbox);
  return sandbox;
}

function normalizeMetadata(metadata?: Record<string, unknown>): Record<string, string> | undefined {
  if (!metadata) return undefined;
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!key || value === undefined || value === null) continue;
    normalized[key] = typeof value === 'string' ? value : JSON.stringify(value);
  }
  return normalized;
}

async function createSandbox(input: CreateSandboxInput = {}): Promise<Sandbox> {
  requireE2bApiKey();
  const sandbox = await withRetry('createSandbox', () =>
    Sandbox.create(input.template || e2bConfig.template, {
      timeoutMs: input.timeoutMs ?? e2bConfig.timeoutMs,
      metadata: normalizeMetadata(input.metadata),
      envs: input.envs,
      allowInternetAccess: input.allowInternetAccess ?? e2bConfig.allowInternetAccess,
      network: {
        allowPublicTraffic: input.allowPublicTraffic ?? e2bConfig.allowPublicTraffic,
      },
    })
  );
  touch(sandbox);
  return sandbox;
}

async function killSandbox(sandboxId: string): Promise<void> {
  const cached = sandboxCache.get(sandboxId);
  if (cached) {
    sandboxCache.delete(sandboxId);
    await cached.sandbox.kill();
    return;
  }
  requireE2bApiKey();
  await Sandbox.kill(sandboxId);
}

async function getSandboxInfo(sandboxId: string) {
  const sandbox = await connectSandbox(sandboxId);
  return sandbox.getInfo();
}

async function getSandboxHost(sandboxId: string, port: number): Promise<string> {
  const sandbox = await connectSandbox(sandboxId);
  return sandbox.getHost(port);
}

async function runCommand(sandboxId: string, command: string, options?: RunCommandOptions) {
  return withRetry('runCommand', async () => {
    const sandbox = await connectSandbox(sandboxId);
    let finalCommand = command;
    if (options?.cwd) {
      finalCommand = `cd ${shellEscape(options.cwd)} && ${command}`;
    }
    return sandbox.commands.run(finalCommand, {
      background: options?.background,
      envs: options?.envs,
      timeoutMs: options?.timeoutMs,
    } as any);
  });
}

function shellEscape(value: string): string {
  if (!value) return "''";
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

export const e2bConnector = {
  connectSandbox,
  createSandbox,
  killSandbox,
  getSandboxInfo,
  getSandboxHost,
  runCommand,
};
