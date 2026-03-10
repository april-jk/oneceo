import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

type WorkspaceTreeData = {
  root?: string;
  items?: Array<{ path: string; type: 'file' | 'dir' }>;
  error?: string;
};

type WorkspaceFileData = {
  path: string;
  content: string;
  truncated?: boolean;
  size?: number;
  isBinary?: boolean;
  encoding?: string;
  mimeType?: string;
  previewType?: 'text' | 'markdown' | 'image' | 'video' | 'audio' | 'pdf' | 'binary';
  previewAvailable?: boolean;
  binaryTooLarge?: boolean;
};

type CacheEntry<T> = {
  data: T;
  cachedAt: string;
  ttlMs: number;
  lastAccessAt: string;
  invalidatedAt?: string;
};

type WorkspaceCache = {
  tree?: CacheEntry<WorkspaceTreeData>;
  files?: Record<string, CacheEntry<WorkspaceFileData>>;
};

type SessionCache = {
  workspace?: WorkspaceCache;
  updatedAt: string;
};

type CacheFileShape = {
  tenants: Record<string, { sessions: Record<string, SessionCache> }>;
};

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const API_ROOT_DIR = path.resolve(MODULE_DIR, '..', '..', '..');
const RUNTIME_CACHE_DIR = path.join(API_ROOT_DIR, '.runtime-cache', 'task-creation');
const CACHE_FILE = path.join(RUNTIME_CACHE_DIR, 'task-creation-cache.json');
const LEGACY_CACHE_FILE = path.join(API_ROOT_DIR, 'data', 'task-creation-cache.json');

function nowIso() {
  return new Date().toISOString();
}

function normalizePath(value: string) {
  return value.replace(/\\/g, '/').replace(/^\/+/, '');
}

function normalizeTenantKey(value: string) {
  const normalized = value.trim();
  if (!normalized) return 'default';
  return normalized.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 80);
}

function isExpired(entry: CacheEntry<any> | undefined, now: number) {
  if (!entry) return true;
  const ttlMs = Number(entry.ttlMs) || 0;
  if (ttlMs <= 0) return true;
  const cachedAt = Date.parse(entry.cachedAt);
  if (!Number.isFinite(cachedAt)) return true;
  return now - cachedAt > ttlMs;
}

function isInvalidated(entry: CacheEntry<any> | undefined): boolean {
  if (!entry) return true;
  return Boolean(entry.invalidatedAt);
}

function markInvalidated(entry: CacheEntry<any> | undefined, at: string) {
  if (!entry) return;
  entry.invalidatedAt = at;
}

class TaskCreationCacheStore {
  private writeLock: Promise<void> = Promise.resolve();

  private tryNormalizeCacheShape(raw: string): CacheFileShape | null {
    try {
      const parsed = JSON.parse(raw) as any;
      if (parsed && parsed.tenants && typeof parsed.tenants === 'object') {
        return { tenants: parsed.tenants };
      }
      if (parsed && parsed.sessions && typeof parsed.sessions === 'object') {
        return { tenants: { default: { sessions: parsed.sessions } } };
      }
    } catch {
      // ignore invalid json
    }
    return null;
  }

  private async ensureFile(): Promise<void> {
    await fs.mkdir(RUNTIME_CACHE_DIR, { recursive: true });
    try {
      await fs.access(CACHE_FILE);
    } catch {
      const initial: CacheFileShape = { tenants: {} };
      let seed: CacheFileShape = initial;
      try {
        const legacyRaw = await fs.readFile(LEGACY_CACHE_FILE, 'utf-8');
        const normalized = this.tryNormalizeCacheShape(legacyRaw);
        if (normalized) {
          seed = normalized;
          console.log('[TASK_CREATION_CACHE] seeded from legacy cache file');
        }
      } catch {
        // no legacy cache to seed from
      }
      await fs.writeFile(CACHE_FILE, JSON.stringify(seed, null, 2), 'utf-8');
    }
  }

  private async readCache(): Promise<CacheFileShape> {
    await this.ensureFile();
    const raw = await fs.readFile(CACHE_FILE, 'utf-8');
    return this.tryNormalizeCacheShape(raw) || { tenants: {} };
  }

  private async writeCache(data: CacheFileShape): Promise<void> {
    await fs.writeFile(CACHE_FILE, JSON.stringify(data, null, 2), 'utf-8');
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.writeLock;
    let release!: () => void;
    this.writeLock = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private getOrCreateSession(
    cache: CacheFileShape,
    tenantKey: string,
    sessionId: string
  ): SessionCache {
    const normalizedTenant = normalizeTenantKey(tenantKey);
    const tenant = cache.tenants[normalizedTenant] || { sessions: {} };
    cache.tenants[normalizedTenant] = tenant;
    const existing = tenant.sessions[sessionId];
    if (existing) return existing;
    const next: SessionCache = { updatedAt: nowIso(), workspace: { files: {} } };
    tenant.sessions[sessionId] = next;
    return next;
  }

  async getWorkspaceTree(tenantKey: string, sessionId: string, options?: { allowStale?: boolean }) {
    return this.withLock(async () => {
      const cache = await this.readCache();
      const tenant = cache.tenants[normalizeTenantKey(tenantKey)];
      const session = tenant?.sessions?.[sessionId];
      if (!session?.workspace?.tree) return null;
      const entry = session.workspace.tree;
      const now = Date.now();
      const expired = isExpired(entry, now);
      const invalidated = isInvalidated(entry);
      const stale = expired || invalidated;
      if (stale && !options?.allowStale) {
        return null;
      }
      entry.lastAccessAt = nowIso();
      session.updatedAt = nowIso();
      await this.writeCache(cache);
      return {
        data: entry.data,
        cachedAt: entry.cachedAt,
        ttlMs: entry.ttlMs,
        ageMs: Math.max(0, now - Date.parse(entry.cachedAt)),
        stale,
      };
    });
  }

  async setWorkspaceTree(tenantKey: string, sessionId: string, data: WorkspaceTreeData, ttlMs: number) {
    return this.withLock(async () => {
      const cache = await this.readCache();
      const session = this.getOrCreateSession(cache, tenantKey, sessionId);
      session.workspace = session.workspace || { files: {} };
      const now = nowIso();
      session.workspace.tree = {
        data,
        cachedAt: now,
        ttlMs,
        lastAccessAt: now,
        invalidatedAt: undefined,
      };
      session.updatedAt = now;
      this.pruneSessions(cache, Number(process.env.TASK_CREATION_CACHE_MAX_SESSIONS || 200));
      await this.writeCache(cache);
    });
  }

  async getWorkspaceFile(
    tenantKey: string,
    sessionId: string,
    filePath: string,
    options?: { allowStale?: boolean }
  ) {
    const key = normalizePath(filePath);
    return this.withLock(async () => {
      const cache = await this.readCache();
      const tenant = cache.tenants[normalizeTenantKey(tenantKey)];
      const session = tenant?.sessions?.[sessionId];
      const files = session?.workspace?.files;
      if (!files || !files[key]) return null;
      const entry = files[key];
      const now = Date.now();
      const expired = isExpired(entry, now);
      const invalidated = isInvalidated(entry);
      const stale = expired || invalidated;
      if (stale && !options?.allowStale) {
        return null;
      }
      entry.lastAccessAt = nowIso();
      session!.updatedAt = nowIso();
      await this.writeCache(cache);
      return {
        data: entry.data,
        cachedAt: entry.cachedAt,
        ttlMs: entry.ttlMs,
        ageMs: Math.max(0, now - Date.parse(entry.cachedAt)),
        stale,
      };
    });
  }

  async setWorkspaceFile(
    tenantKey: string,
    sessionId: string,
    filePath: string,
    data: WorkspaceFileData,
    ttlMs: number
  ) {
    const key = normalizePath(filePath);
    return this.withLock(async () => {
      const cache = await this.readCache();
      const session = this.getOrCreateSession(cache, tenantKey, sessionId);
      session.workspace = session.workspace || { files: {} };
      const files = session.workspace.files || {};
      const now = nowIso();
      files[key] = {
        data,
        cachedAt: now,
        ttlMs,
        lastAccessAt: now,
        invalidatedAt: undefined,
      };
      session.workspace.files = files;
      session.updatedAt = now;
      this.pruneFiles(session, Number(process.env.TASK_CREATION_CACHE_MAX_FILES || 200));
      this.pruneSessions(cache, Number(process.env.TASK_CREATION_CACHE_MAX_SESSIONS || 200));
      await this.writeCache(cache);
    });
  }

  async invalidateWorkspace(tenantKey: string, sessionId: string) {
    return this.withLock(async () => {
      const cache = await this.readCache();
      const tenant = cache.tenants[normalizeTenantKey(tenantKey)];
      const session = tenant?.sessions?.[sessionId];
      if (!session?.workspace) return;
      const now = nowIso();
      const hadTree = Boolean(session.workspace.tree);
      const hadFiles = session.workspace.files && Object.keys(session.workspace.files).length > 0;
      if (!hadTree && !hadFiles) return;
      if (session.workspace.tree) {
        markInvalidated(session.workspace.tree, now);
      }
      if (session.workspace.files) {
        Object.values(session.workspace.files).forEach((entry) => markInvalidated(entry, now));
      }
      session.updatedAt = now;
      await this.writeCache(cache);
    });
  }

  async invalidateWorkspaceBySession(sessionId: string) {
    return this.withLock(async () => {
      const cache = await this.readCache();
      let changed = false;
      const now = nowIso();
      for (const tenant of Object.values(cache.tenants)) {
        const session = tenant.sessions?.[sessionId];
        if (!session?.workspace) continue;
        const hadTree = Boolean(session.workspace.tree);
        const hadFiles = session.workspace.files && Object.keys(session.workspace.files).length > 0;
        if (!hadTree && !hadFiles) continue;
        if (session.workspace.tree) {
          markInvalidated(session.workspace.tree, now);
        }
        if (session.workspace.files) {
          Object.values(session.workspace.files).forEach((entry) => markInvalidated(entry, now));
        }
        session.updatedAt = now;
        changed = true;
      }
      if (changed) {
        await this.writeCache(cache);
      }
    });
  }

  private pruneFiles(session: SessionCache, maxFiles: number) {
    if (!session.workspace?.files || maxFiles <= 0) return;
    const entries = Object.entries(session.workspace.files);
    if (entries.length <= maxFiles) return;
    entries.sort((a, b) => {
      const aTime = Date.parse(a[1].lastAccessAt || a[1].cachedAt || '') || 0;
      const bTime = Date.parse(b[1].lastAccessAt || b[1].cachedAt || '') || 0;
      return aTime - bTime;
    });
    const removeCount = entries.length - maxFiles;
    for (let i = 0; i < removeCount; i += 1) {
      delete session.workspace.files[entries[i][0]];
    }
  }

  private pruneSessions(cache: CacheFileShape, maxSessions: number) {
    if (maxSessions <= 0) return;
    for (const tenant of Object.values(cache.tenants)) {
      const entries = Object.entries(tenant.sessions || {});
      if (entries.length <= maxSessions) continue;
      entries.sort((a, b) => {
        const aTime = Date.parse(a[1].updatedAt || '') || 0;
        const bTime = Date.parse(b[1].updatedAt || '') || 0;
        return aTime - bTime;
      });
      const removeCount = entries.length - maxSessions;
      for (let i = 0; i < removeCount; i += 1) {
        delete tenant.sessions[entries[i][0]];
      }
    }
  }
}

export const taskCreationCacheStore = new TaskCreationCacheStore();
