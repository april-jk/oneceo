import { Sandbox } from 'e2b';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
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
const cacheTtlMs = toPositiveInt(process.env.E2B_SANDBOX_CACHE_TTL_MS, 10 * 60 * 1000);
const cacheMaxSize = toPositiveInt(process.env.E2B_SANDBOX_CACHE_MAX, 80);

const proxyToggleRaw = String(process.env.E2B_PROXY_ENABLED ?? process.env.ONECEO_PROXY_ENABLED ?? 'true')
  .trim()
  .toLowerCase();
const proxyEnabled = !['0', 'false', 'no', 'off'].includes(proxyToggleRaw);
const proxyUrl = proxyEnabled ? (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) : '';
const dispatcherReady = (globalThis as any).__ONECEO_HTTP_DISPATCHER_READY;
if (!dispatcherReady && proxyEnabled && proxyUrl) {
  setGlobalDispatcher(new ProxyAgent(proxyUrl));
}

function pruneSandboxCache() {
  if (!sandboxCache.size) return;
  const now = Date.now();
  if (cacheTtlMs > 0) {
    for (const [key, entry] of sandboxCache.entries()) {
      if (now - entry.lastUsedAt > cacheTtlMs) {
        sandboxCache.delete(key);
      }
    }
  }
  if (cacheMaxSize > 0 && sandboxCache.size > cacheMaxSize) {
    const entries = Array.from(sandboxCache.entries());
    entries.sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);
    const removeCount = entries.length - cacheMaxSize;
    for (let i = 0; i < removeCount; i += 1) {
      sandboxCache.delete(entries[i][0]);
    }
  }
}

function touch(sandbox: Sandbox) {
  sandboxCache.set(sandbox.sandboxId, { sandbox, lastUsedAt: Date.now() });
  pruneSandboxCache();
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

function isSandboxUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return (
    normalized.includes('sandbox was not found') ||
    normalized.includes('sandbox not found') ||
    normalized.includes('not running anymore') ||
    normalized.includes('guest has been shut down') ||
    normalized.includes('instance was stopped') ||
    normalized.includes('failed to connect to sandbox')
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
  const sandbox = await withRetry<Sandbox>('createSandbox', () => {
    const options = {
      timeoutMs: input.timeoutMs ?? e2bConfig.timeoutMs,
      metadata: normalizeMetadata(input.metadata),
      envs: input.envs,
      allowInternetAccess: input.allowInternetAccess ?? e2bConfig.allowInternetAccess,
      network: {
        allowPublicTraffic: input.allowPublicTraffic ?? e2bConfig.allowPublicTraffic,
      },
      autoPause: true,
    };
    if (typeof (Sandbox as any).betaCreate === 'function') {
      return (Sandbox as any).betaCreate(input.template || e2bConfig.template, options);
    }
    return Sandbox.create(input.template || e2bConfig.template, options as any);
  });
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
  try {
    const sandbox = await connectSandbox(sandboxId);
    return await sandbox.getInfo();
  } catch (error) {
    if (isSandboxUnavailableError(error)) {
      sandboxCache.delete(sandboxId);
    }
    throw error;
  }
}

async function getSandboxHost(sandboxId: string, port: number): Promise<string> {
  try {
    const sandbox = await connectSandbox(sandboxId);
    return await sandbox.getHost(port);
  } catch (error) {
    if (isSandboxUnavailableError(error)) {
      sandboxCache.delete(sandboxId);
    }
    throw error;
  }
}

async function runCommand(sandboxId: string, command: string, options?: RunCommandOptions) {
  try {
    return await withRetry('runCommand', async () => {
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
  } catch (error) {
    if (isSandboxUnavailableError(error)) {
      sandboxCache.delete(sandboxId);
    }
    throw error;
  }
}

async function pauseSandbox(sandboxId: string): Promise<void> {
  const sandbox = await connectSandbox(sandboxId);
  const candidate = (sandbox as any).betaPause || (sandbox as any).pause || (sandbox as any).stop;
  if (typeof candidate === 'function') {
    await candidate.call(sandbox);
    return;
  }
  throw new Error('E2B sandbox pause method not supported');
}

async function readFile(sandboxId: string, filePath: string): Promise<Uint8Array> {
  const sandbox = await connectSandbox(sandboxId);
  const result = await (sandbox as any).files.read(filePath, { format: 'bytes' });
  return result instanceof Uint8Array ? result : Uint8Array.from(result || []);
}

async function writeFile(sandboxId: string, filePath: string, data: Uint8Array | Buffer): Promise<void> {
  const sandbox = await connectSandbox(sandboxId);
  await (sandbox as any).files.write(filePath, data);
}

function shellEscape(value: string): string {
  if (!value) return "''";
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

export const e2bConnector = {
  connectSandbox,
  createSandbox,
  forgetSandbox: (sandboxId: string) => {
    sandboxCache.delete(sandboxId);
  },
  killSandbox,
  getSandboxInfo,
  getSandboxHost,
  runCommand,
  pauseSandbox,
  readFile,
  writeFile,
};
