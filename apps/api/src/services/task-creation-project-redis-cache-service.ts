import { redisClientService, type RedisCommandPort } from './redis-client-service';

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function encodeKeyPart(value: unknown) {
  return encodeURIComponent(asText(value) || 'unknown');
}

export class TaskCreationProjectRedisCacheService {
  private static readonly TTL_SECONDS = 300;

  constructor(private readonly redis: RedisCommandPort = redisClientService) {}

  isEnabled() {
    return this.redis.isEnabled();
  }

  private listKey(userId: string) {
    return `oneceo:task-projects:user:${encodeKeyPart(userId)}:list:v1`;
  }

  private detailKey(userId: string, projectId: string) {
    return `oneceo:task-projects:user:${encodeKeyPart(userId)}:detail:${encodeKeyPart(projectId)}:v1`;
  }

  private sessionsKey(userId: string, projectId: string) {
    return `oneceo:task-projects:user:${encodeKeyPart(userId)}:sessions:${encodeKeyPart(projectId)}:v1`;
  }

  async getProjectList<T>(userId: string) {
    return this.redis.getJson<T[]>(this.listKey(userId));
  }

  async setProjectList<T>(userId: string, data: T[]) {
    await this.redis.setJson(
      this.listKey(userId),
      data,
      TaskCreationProjectRedisCacheService.TTL_SECONDS
    );
  }

  async getProjectDetail<T>(userId: string, projectId: string) {
    return this.redis.getJson<T>(this.detailKey(userId, projectId));
  }

  async setProjectDetail<T>(userId: string, projectId: string, data: T) {
    await this.redis.setJson(
      this.detailKey(userId, projectId),
      data,
      TaskCreationProjectRedisCacheService.TTL_SECONDS
    );
  }

  async getProjectSessions<T>(userId: string, projectId: string) {
    return this.redis.getJson<T[]>(this.sessionsKey(userId, projectId));
  }

  async setProjectSessions<T>(userId: string, projectId: string, data: T[]) {
    await this.redis.setJson(
      this.sessionsKey(userId, projectId),
      data,
      TaskCreationProjectRedisCacheService.TTL_SECONDS
    );
  }

  async invalidateProjectList(userId: string) {
    await this.redis.delete(this.listKey(userId));
  }

  async invalidateProjectDetail(userId: string, projectId: string) {
    const normalizedProjectId = asText(projectId);
    if (!normalizedProjectId) return;
    await this.redis.delete(this.detailKey(userId, normalizedProjectId));
  }

  async invalidateProjectSessions(userId: string, projectId: string) {
    const normalizedProjectId = asText(projectId);
    if (!normalizedProjectId) return;
    await this.redis.delete(this.sessionsKey(userId, normalizedProjectId));
  }

  async invalidateProjectReads(
    userId: string,
    options?: { projectIds?: Array<string | null | undefined> }
  ) {
    await this.invalidateProjectList(userId);
    const uniqueProjectIds = Array.from(
      new Set((options?.projectIds || []).map((item) => asText(item)).filter(Boolean))
    );
    for (const projectId of uniqueProjectIds) {
      await Promise.all([
        this.invalidateProjectDetail(userId, projectId),
        this.invalidateProjectSessions(userId, projectId),
      ]);
    }
  }
}

export const taskCreationProjectRedisCacheService =
  new TaskCreationProjectRedisCacheService();
