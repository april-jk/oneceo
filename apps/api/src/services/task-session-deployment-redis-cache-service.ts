import { redisClientService, type RedisCommandPort } from './redis-client-service';

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function encodeKeyPart(value: unknown) {
  return encodeURIComponent(asText(value) || 'unknown');
}

export class TaskSessionDeploymentRedisCacheService {
  private static readonly KEY_VERSION = 'v1';
  private static readonly TTL_SECONDS = {
    deploymentInfo: 20,
    deploymentAnalytics: 30,
    deploymentTemplate: 60,
    databaseStatus: 20,
    databaseRows: 15,
    storageStatus: 20,
  } as const;

  constructor(private readonly redis: RedisCommandPort = redisClientService) {}

  isEnabled() {
    return this.redis.isEnabled();
  }

  private prefix(userId: string, sessionId: string) {
    return `oneceo:task-deploy:user:${encodeKeyPart(userId)}:session:${encodeKeyPart(sessionId)}:${TaskSessionDeploymentRedisCacheService.KEY_VERSION}`;
  }

  private deploymentInfoKey(userId: string, sessionId: string, deploymentId?: string) {
    const normalizedDeploymentId = asText(deploymentId) || 'latest';
    return `${this.prefix(userId, sessionId)}:deployment:info:${encodeKeyPart(normalizedDeploymentId)}`;
  }

  private deploymentAnalyticsKey(userId: string, sessionId: string, range?: string) {
    const normalizedRange = asText(range) || '24h';
    return `${this.prefix(userId, sessionId)}:deployment:analytics:${encodeKeyPart(normalizedRange)}`;
  }

  private deploymentTemplateKey(userId: string, sessionId: string) {
    return `${this.prefix(userId, sessionId)}:deployment:template`;
  }

  private databaseStatusKey(userId: string, sessionId: string) {
    return `${this.prefix(userId, sessionId)}:database:status`;
  }

  private databaseRowsKey(
    userId: string,
    sessionId: string,
    table: string,
    page: number,
    pageSize: number
  ) {
    return `${this.prefix(userId, sessionId)}:database:rows:${encodeKeyPart(table)}:${page}:${pageSize}`;
  }

  private storageStatusKey(userId: string, sessionId: string, revealSecrets: boolean) {
    return `${this.prefix(userId, sessionId)}:storage:status:${revealSecrets ? 'reveal' : 'hidden'}`;
  }

  async getDeploymentInfo<T>(userId: string, sessionId: string, deploymentId?: string) {
    return this.redis.getJson<T>(this.deploymentInfoKey(userId, sessionId, deploymentId));
  }

  async setDeploymentInfo<T>(userId: string, sessionId: string, data: T, deploymentId?: string) {
    await this.redis.setJson(
      this.deploymentInfoKey(userId, sessionId, deploymentId),
      data,
      TaskSessionDeploymentRedisCacheService.TTL_SECONDS.deploymentInfo
    );
  }

  async getDeploymentAnalytics<T>(userId: string, sessionId: string, range?: string) {
    return this.redis.getJson<T>(this.deploymentAnalyticsKey(userId, sessionId, range));
  }

  async setDeploymentAnalytics<T>(userId: string, sessionId: string, data: T, range?: string) {
    await this.redis.setJson(
      this.deploymentAnalyticsKey(userId, sessionId, range),
      data,
      TaskSessionDeploymentRedisCacheService.TTL_SECONDS.deploymentAnalytics
    );
  }

  async getDeploymentTemplate<T>(userId: string, sessionId: string) {
    return this.redis.getJson<T>(this.deploymentTemplateKey(userId, sessionId));
  }

  async setDeploymentTemplate<T>(userId: string, sessionId: string, data: T) {
    await this.redis.setJson(
      this.deploymentTemplateKey(userId, sessionId),
      data,
      TaskSessionDeploymentRedisCacheService.TTL_SECONDS.deploymentTemplate
    );
  }

  async getDatabaseStatus<T>(userId: string, sessionId: string) {
    return this.redis.getJson<T>(this.databaseStatusKey(userId, sessionId));
  }

  async setDatabaseStatus<T>(userId: string, sessionId: string, data: T) {
    await this.redis.setJson(
      this.databaseStatusKey(userId, sessionId),
      data,
      TaskSessionDeploymentRedisCacheService.TTL_SECONDS.databaseStatus
    );
  }

  async getDatabaseRows<T>(
    userId: string,
    sessionId: string,
    table: string,
    page: number,
    pageSize: number
  ) {
    return this.redis.getJson<T>(
      this.databaseRowsKey(userId, sessionId, table, page, pageSize)
    );
  }

  async setDatabaseRows<T>(
    userId: string,
    sessionId: string,
    table: string,
    page: number,
    pageSize: number,
    data: T
  ) {
    await this.redis.setJson(
      this.databaseRowsKey(userId, sessionId, table, page, pageSize),
      data,
      TaskSessionDeploymentRedisCacheService.TTL_SECONDS.databaseRows
    );
  }

  async getStorageStatus<T>(userId: string, sessionId: string, revealSecrets: boolean) {
    return this.redis.getJson<T>(
      this.storageStatusKey(userId, sessionId, revealSecrets)
    );
  }

  async setStorageStatus<T>(
    userId: string,
    sessionId: string,
    revealSecrets: boolean,
    data: T
  ) {
    await this.redis.setJson(
      this.storageStatusKey(userId, sessionId, revealSecrets),
      data,
      TaskSessionDeploymentRedisCacheService.TTL_SECONDS.storageStatus
    );
  }

  async invalidateSessionReads(userId: string, sessionId: string) {
    await this.redis.deleteByPrefix(`${this.prefix(userId, sessionId)}:`);
  }
}

export const taskSessionDeploymentRedisCacheService =
  new TaskSessionDeploymentRedisCacheService();
