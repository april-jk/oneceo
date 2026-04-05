import { redisClientService, type RedisCommandPort } from './redis-client-service';
import { deriveTenantKeyForRedis, redisKeyspace, redisTtlSeconds } from './redis-keyspace';

export type ConnectorMeCachePayload = {
  catalog: unknown[];
  profiles: unknown[];
  cachedAt: string;
};

function buildScope(userId: string) {
  return {
    userId,
    tenantKey: deriveTenantKeyForRedis(userId),
  };
}

export class ConnectorRedisCacheService {
  constructor(private readonly redis: RedisCommandPort = redisClientService) {}

  isEnabled() {
    return this.redis.isEnabled();
  }

  async getMe(userId: string) {
    return this.redis.getJson<ConnectorMeCachePayload>(redisKeyspace.connectorsMe(buildScope(userId)));
  }

  async setMe(userId: string, payload: Omit<ConnectorMeCachePayload, 'cachedAt'>) {
    await this.redis.setJson(
      redisKeyspace.connectorsMe(buildScope(userId)),
      {
        ...payload,
        cachedAt: new Date().toISOString(),
      } satisfies ConnectorMeCachePayload,
      redisTtlSeconds.connectorsMe
    );
  }

  async invalidateMe(userId: string) {
    await this.redis.delete(redisKeyspace.connectorsMe(buildScope(userId)));
  }
}

export const connectorRedisCacheService = new ConnectorRedisCacheService();
