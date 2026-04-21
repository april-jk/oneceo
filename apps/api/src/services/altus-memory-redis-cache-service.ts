import { redisClientService, type RedisCommandPort } from './redis-client-service';

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function encodeKeyPart(value: unknown) {
  return encodeURIComponent(asText(value) || 'unknown');
}

export class AltusMemoryRedisCacheService {
  private static readonly TTL_SECONDS = 1800;

  constructor(private readonly redis: RedisCommandPort = redisClientService) {}

  isEnabled() {
    return this.redis.isEnabled();
  }

  private userKey(userId: string) {
    return `oneceo:altus-memory:user:${encodeKeyPart(userId)}:profile:v1`;
  }

  private projectKey(userId: string, projectId: string) {
    return `oneceo:altus-memory:user:${encodeKeyPart(userId)}:project:${encodeKeyPart(projectId)}:v1`;
  }

  async getUserMemory<T>(userId: string) {
    return this.redis.getJson<T>(this.userKey(userId));
  }

  async setUserMemory<T>(userId: string, value: T) {
    await this.redis.setJson(this.userKey(userId), value, AltusMemoryRedisCacheService.TTL_SECONDS);
  }

  async clearUserMemory(userId: string) {
    await this.redis.delete(this.userKey(userId));
  }

  async getProjectMemory<T>(userId: string, projectId: string) {
    return this.redis.getJson<T>(this.projectKey(userId, projectId));
  }

  async setProjectMemory<T>(userId: string, projectId: string, value: T) {
    await this.redis.setJson(this.projectKey(userId, projectId), value, AltusMemoryRedisCacheService.TTL_SECONDS);
  }

  async clearProjectMemory(userId: string, projectId: string) {
    if (!asText(projectId)) return;
    await this.redis.delete(this.projectKey(userId, projectId));
  }
}

export const altusMemoryRedisCacheService = new AltusMemoryRedisCacheService();
