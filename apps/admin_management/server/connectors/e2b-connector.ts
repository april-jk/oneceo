import { Sandbox, type SandboxInfo, type SandboxMetrics, type SandboxState, type components } from 'e2b';
import { config } from '../config';
import { AppError } from '../utils/errors';
import { ensureProxyDispatcher } from '../utils/http-proxy';

type ListedSandbox = components['schemas']['ListedSandbox'];

function requireApiKey() {
  if (!config.e2bApiKey) {
    throw new AppError(500, 'E2B_API_KEY 未配置，无法访问 E2B API');
  }
  ensureProxyDispatcher();
}

export type E2bSandboxListItem = {
  sandboxId: string;
  state: SandboxState;
  templateId: string;
  alias?: string;
  startedAt: string;
  endAt: string;
  cpuCount: number;
  memoryMB: number;
  diskSizeMB: number;
  metadata?: Record<string, string>;
};

export type E2bSandboxDetail = {
  sandboxId: string;
  state: SandboxState;
  templateId: string;
  name?: string;
  startedAt: string;
  endAt: string;
  cpuCount: number;
  memoryMB: number;
  diskSizeMB: number;
  metadata: Record<string, string>;
};

export type E2bSandboxFullInfo = {
  sandboxId: string;
  state: SandboxState;
  templateId: string;
  name?: string;
  startedAt: string;
  endAt: string;
  cpuCount: number;
  memoryMB: number;
  sandboxDomain?: string;
  envdVersion?: string;
  envdAccessToken?: string;
  metadata: Record<string, string>;
};

function toListItem(item: ListedSandbox): E2bSandboxListItem {
  const sandboxId = (item as any).sandboxId ?? (item as any).sandboxID ?? (item as any).id ?? '';
  const templateId = (item as any).templateId ?? (item as any).templateID ?? '';
  const startedAtRaw = (item as any).startedAt;
  const endAtRaw = (item as any).endAt;
  const startedAt =
    startedAtRaw instanceof Date ? startedAtRaw.toISOString() : (startedAtRaw as string);
  const endAt = endAtRaw instanceof Date ? endAtRaw.toISOString() : (endAtRaw as string);
  return {
    sandboxId,
    state: item.state,
    templateId,
    alias: (item as any).alias ?? (item as any).name,
    startedAt,
    endAt,
    cpuCount: item.cpuCount,
    memoryMB: item.memoryMB,
    diskSizeMB: item.diskSizeMB,
    metadata: item.metadata || undefined,
  };
}

function toDetail(info: SandboxInfo): E2bSandboxDetail {
  return {
    sandboxId: info.sandboxId,
    state: info.state,
    templateId: info.templateId,
    name: info.name,
    startedAt: info.startedAt.toISOString(),
    endAt: info.endAt.toISOString(),
    cpuCount: info.cpuCount,
    memoryMB: info.memoryMB,
    diskSizeMB: info.diskSizeMB,
    metadata: info.metadata || {},
  };
}

function toFullInfo(info: {
  metadata: Record<string, string>;
  envdVersion: string;
  envdAccessToken: string | undefined;
  startedAt: Date;
  endAt: Date;
  state: SandboxState;
  cpuCount: number;
  memoryMB: number;
  sandboxDomain: string | undefined;
  name?: string | undefined;
  sandboxId: string;
  templateId: string;
}): E2bSandboxFullInfo {
  return {
    sandboxId: info.sandboxId,
    state: info.state,
    templateId: info.templateId,
    name: info.name,
    startedAt: info.startedAt.toISOString(),
    endAt: info.endAt.toISOString(),
    cpuCount: info.cpuCount,
    memoryMB: info.memoryMB,
    sandboxDomain: info.sandboxDomain,
    envdVersion: info.envdVersion,
    envdAccessToken: info.envdAccessToken,
    metadata: info.metadata || {},
  };
}

async function listSandboxes(
  limit = 100,
  query?: { state?: SandboxState[]; metadata?: Record<string, string> }
): Promise<E2bSandboxListItem[]> {
  requireApiKey();
  const effectiveQuery = {
    state: query?.state ?? ['running', 'paused'],
    metadata: query?.metadata,
  };
  const paginator = Sandbox.list({
    apiKey: config.e2bApiKey,
    query: effectiveQuery,
    limit,
  });
  const items: E2bSandboxListItem[] = [];
  while (paginator.hasNext && items.length < limit) {
    const page = await paginator.nextItems();
    const list = Array.isArray(page) ? page : ((page as any)?.items || (page as any)?.sandboxes || []);
    for (const entry of list as ListedSandbox[]) {
      items.push(toListItem(entry));
      if (items.length >= limit) break;
    }
  }
  return items;
}

async function getSandboxInfo(sandboxId: string): Promise<E2bSandboxDetail> {
  requireApiKey();
  const info = await Sandbox.getInfo(sandboxId, { apiKey: config.e2bApiKey });
  return toDetail(info);
}

async function getSandboxFullInfo(sandboxId: string): Promise<E2bSandboxFullInfo> {
  requireApiKey();
  const info = await Sandbox.getFullInfo(sandboxId, { apiKey: config.e2bApiKey });
  return toFullInfo(info);
}

async function getSandboxMetrics(
  sandboxId: string,
  opts?: { start?: Date; end?: Date }
): Promise<SandboxMetrics[]> {
  requireApiKey();
  return Sandbox.getMetrics(sandboxId, { apiKey: config.e2bApiKey, ...opts });
}

async function setSandboxTimeout(sandboxId: string, timeoutMs: number): Promise<boolean> {
  requireApiKey();
  await Sandbox.setTimeout(sandboxId, timeoutMs, { apiKey: config.e2bApiKey });
  return true;
}

async function createSandbox(payload: {
  template?: string;
  timeoutMs?: number;
  metadata?: Record<string, string>;
  envs?: Record<string, string>;
  allowInternetAccess?: boolean;
  secure?: boolean;
  mcp?: unknown;
  network?: unknown;
  autoPause?: boolean;
}) {
  requireApiKey();
  const {
    template,
    autoPause,
    timeoutMs,
    metadata,
    envs,
    allowInternetAccess,
    secure,
    mcp,
    network,
  } = payload;
  const opts = {
    apiKey: config.e2bApiKey,
    timeoutMs,
    metadata,
    envs,
    allowInternetAccess,
    secure,
    mcp: mcp as any,
    network: network as any,
    autoPause,
  };
  const sandbox = autoPause
    ? await (template ? Sandbox.betaCreate(template, opts) : Sandbox.betaCreate(opts))
    : await (template ? Sandbox.create(template, opts) : Sandbox.create(opts));
  return {
    sandboxId: sandbox.sandboxId,
    sandboxDomain: sandbox.sandboxDomain,
    trafficAccessToken: sandbox.trafficAccessToken,
  };
}

async function killSandbox(sandboxId: string): Promise<boolean> {
  requireApiKey();
  return Sandbox.kill(sandboxId, { apiKey: config.e2bApiKey });
}

async function pauseSandbox(sandboxId: string): Promise<boolean> {
  requireApiKey();
  return Sandbox.betaPause(sandboxId, { apiKey: config.e2bApiKey });
}

async function resumeSandbox(sandboxId: string): Promise<boolean> {
  requireApiKey();
  await Sandbox.connect(sandboxId, { apiKey: config.e2bApiKey });
  return true;
}

export const e2bConnector = {
  listSandboxes,
  getSandboxInfo,
  getSandboxFullInfo,
  getSandboxMetrics,
  setSandboxTimeout,
  createSandbox,
  killSandbox,
  pauseSandbox,
  resumeSandbox,
};
