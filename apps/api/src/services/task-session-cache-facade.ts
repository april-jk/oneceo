import {
  taskSessionRedisCacheService,
  type TaskSessionRedisCacheService,
} from './task-session-redis-cache-service';

type SessionScope = {
  userId: string;
  sessionId: string;
  tenantKey?: string | null;
};

type WorkspaceDirScope = SessionScope & { cacheKey: string };
type WorkspaceFileScope = SessionScope & { path: string };
type SessionEventRecord = {
  eventId: number;
  eventType: string;
  messageType: string;
  createdAt: string;
  messageKey: string;
  content: string;
  metadata: Record<string, unknown>;
};

export class TaskSessionCacheFacade {
  constructor(private readonly redisCache: TaskSessionRedisCacheService = taskSessionRedisCacheService) {}

  isRedisEnabled() {
    return this.redisCache.isEnabled();
  }

  async getRecentMessagesPage(input: SessionScope): Promise<Record<string, unknown> | null> {
    if (!this.isRedisEnabled()) return null;
    return this.redisCache.getRecentMessagesPage(input);
  }

  async setRecentMessagesPage(input: SessionScope & { payload: Record<string, unknown> }) {
    if (!this.isRedisEnabled()) return;
    await this.redisCache.setRecentMessagesPage(input);
  }

  async setHistoryCursor(input: SessionScope & { beforeCursor?: number | null; oldestCursor?: number | null; newestCursor?: number | null }) {
    if (!this.isRedisEnabled()) return;
    await this.redisCache.setHistoryCursor(input);
  }

  async getWorkspaceDir(input: WorkspaceDirScope): Promise<Record<string, unknown> | null> {
    if (!this.isRedisEnabled()) return null;
    return this.redisCache.getWorkspaceDir(input);
  }

  async setWorkspaceDir(input: WorkspaceDirScope & { payload: Record<string, unknown> }) {
    if (!this.isRedisEnabled()) return;
    await this.redisCache.setWorkspaceDir(input);
  }

  async getWorkspaceTree(input: SessionScope): Promise<Record<string, unknown> | null> {
    if (!this.isRedisEnabled()) return null;
    return this.redisCache.getWorkspaceTree(input);
  }

  async setWorkspaceTree(input: SessionScope & { payload: Record<string, unknown> }) {
    if (!this.isRedisEnabled()) return;
    await this.redisCache.setWorkspaceTree(input);
  }

  async getWorkspaceFile(input: WorkspaceFileScope): Promise<Record<string, unknown> | null> {
    if (!this.isRedisEnabled()) return null;
    return this.redisCache.getWorkspaceFile(input);
  }

  async setWorkspaceFile(input: WorkspaceFileScope & { payload: Record<string, unknown> }) {
    if (!this.isRedisEnabled()) return;
    await this.redisCache.setWorkspaceFile(input);
  }

  async invalidateWorkspaceBySessionId(sessionId: string) {
    if (!this.isRedisEnabled()) return;
    await this.redisCache.invalidateWorkspaceBySessionId(sessionId);
  }

  async listSessionEvents(input: SessionScope & { afterEventId?: number | null }): Promise<SessionEventRecord[]> {
    if (!this.isRedisEnabled()) return [];
    return this.redisCache.listSessionEvents(input);
  }
}

export const taskSessionCacheFacade = new TaskSessionCacheFacade();
