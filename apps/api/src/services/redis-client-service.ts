import Redis from 'ioredis';

type RedisValue = string | number | boolean | null | undefined;

export type RedisStreamEntry = {
  id: string;
  fields: Record<string, string>;
};

export type RedisSetStringOptions = {
  ttlSeconds?: number;
  onlyIfAbsent?: boolean;
};

export type RedisCommandPort = {
  isEnabled(): boolean;
  disconnect?(): Promise<void>;
  getJson<T>(key: string): Promise<T | null>;
  setJson(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
  setString(key: string, value: string, options?: RedisSetStringOptions): Promise<boolean>;
  incrementCounter(key: string, ttlSeconds?: number): Promise<number>;
  getString(key: string): Promise<string | null>;
  delete(key: string): Promise<void>;
  addSetMember(key: string, member: string): Promise<void>;
  removeSetMember(key: string, member: string): Promise<void>;
  listSetMembers(key: string): Promise<string[]>;
  deleteByPrefix(prefix: string): Promise<number>;
  appendStream(
    key: string,
    fields: Record<string, RedisValue>,
    options?: { maxLen?: number; ttlSeconds?: number }
  ): Promise<string | null>;
  readStream(key: string): Promise<RedisStreamEntry[]>;
};

function flattenFields(fields: Record<string, RedisValue>) {
  const entries: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    entries.push(key, value === null ? '' : String(value));
  }
  return entries;
}

export class RedisClientService implements RedisCommandPort {
  private client: Redis | null = null;
  private warnedUnavailable = false;

  isEnabled() {
    const toggleRaw = String(process.env.ONECEO_REDIS_ENABLED || '').trim().toLowerCase();
    const toggleEnabled = ['1', 'true', 'yes', 'on'].includes(toggleRaw);
    return toggleEnabled && Boolean(String(process.env.REDIS_URL || '').trim());
  }

  async disconnect() {
    if (!this.client) return;
    try {
      this.client.disconnect();
    } finally {
      this.client = null;
    }
  }

  private getClient() {
    if (!this.isEnabled()) return null;
    if (this.client) return this.client;
    this.client = new Redis(String(process.env.REDIS_URL || '').trim(), {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      connectTimeout: 5000,
      commandTimeout: 5000,
    });
    this.client.on('error', (error) => {
      if (this.warnedUnavailable) return;
      this.warnedUnavailable = true;
      console.warn('[redis] command failed, falling back to current in-memory/db path', error);
    });
    return this.client;
  }

  private async withClient<T>(operation: string, executor: (client: Redis) => Promise<T>, fallback: T): Promise<T> {
    const client = this.getClient();
    if (!client) {
      return fallback;
    }
    try {
      if (client.status === 'wait') {
        await client.connect();
      }
      return await executor(client);
    } catch (error) {
      console.warn(`[redis] ${operation} failed`, error);
      return fallback;
    }
  }

  async getJson<T>(key: string) {
    const raw = await this.withClient('get_json', (client) => client.get(key), null as string | null);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async setJson(key: string, value: unknown, ttlSeconds?: number) {
    await this.withClient(
      'set_json',
      async (client) => {
        const payload = JSON.stringify(value);
        if (ttlSeconds && ttlSeconds > 0) {
          await client.set(key, payload, 'EX', ttlSeconds);
        } else {
          await client.set(key, payload);
        }
      },
      undefined
    );
  }

  async setString(key: string, value: string, options?: RedisSetStringOptions) {
    return this.withClient(
      'set_string',
      async (client) => {
        const ttl = options?.ttlSeconds && options.ttlSeconds > 0 ? Math.floor(options.ttlSeconds) : 0;
        let result: string | null = null;
        if (ttl > 0 && options?.onlyIfAbsent) {
          result = await client.set(key, value, 'EX', ttl, 'NX');
        } else if (ttl > 0) {
          result = await client.set(key, value, 'EX', ttl);
        } else if (options?.onlyIfAbsent) {
          result = await client.set(key, value, 'NX');
        } else {
          result = await client.set(key, value);
        }
        return result === 'OK';
      },
      false
    );
  }

  async incrementCounter(key: string, ttlSeconds?: number) {
    return this.withClient(
      'increment_counter',
      async (client) => {
        const count = await client.incr(key);
        if (ttlSeconds && ttlSeconds > 0 && count === 1) {
          await client.expire(key, Math.floor(ttlSeconds));
        }
        return count;
      },
      0
    );
  }

  async getString(key: string) {
    return this.withClient('get_string', (client) => client.get(key), null as string | null);
  }

  async delete(key: string) {
    await this.withClient('delete', (client) => client.del(key), 0);
  }

  async addSetMember(key: string, member: string) {
    await this.withClient('sadd', (client) => client.sadd(key, member), 0);
  }

  async removeSetMember(key: string, member: string) {
    await this.withClient('srem', (client) => client.srem(key, member), 0);
  }

  async listSetMembers(key: string) {
    return this.withClient('smembers', (client) => client.smembers(key), [] as string[]);
  }

  async deleteByPrefix(prefix: string) {
    return this.withClient(
      'delete_by_prefix',
      async (client) => {
        const normalizedPrefix = String(prefix || '').trim();
        if (!normalizedPrefix) return 0;
        let cursor = '0';
        let deleted = 0;
        do {
          const [nextCursor, keys] = await client.scan(cursor, 'MATCH', `${normalizedPrefix}*`, 'COUNT', 100);
          cursor = nextCursor;
          if (Array.isArray(keys) && keys.length > 0) {
            deleted += await client.del(...keys);
          }
        } while (cursor !== '0');
        return deleted;
      },
      0
    );
  }

  async appendStream(
    key: string,
    fields: Record<string, RedisValue>,
    options?: { maxLen?: number; ttlSeconds?: number }
  ) {
    const flattened = flattenFields(fields);
    if (flattened.length === 0) return null;
    return this.withClient(
      'xadd',
      async (client) => {
        const pipeline = client.pipeline();
        const args: Array<string | number> = [key];
        if (options?.maxLen && options.maxLen > 0) {
          args.push('MAXLEN', '~', Math.floor(options.maxLen));
        }
        args.push('*', ...flattened);
        pipeline.xadd(...(args as [string, ...Array<string | number>]));
        if (options?.ttlSeconds && options.ttlSeconds > 0) {
          pipeline.expire(key, Math.floor(options.ttlSeconds));
        }
        const result = await pipeline.exec();
        const first = result?.[0]?.[1];
        return typeof first === 'string' ? first : null;
      },
      null
    );
  }

  async readStream(key: string) {
    return this.withClient(
      'xrange',
      async (client) => {
        const rows = await client.xrange(key, '-', '+');
        return rows.map(([id, rawFields]) => {
          const fields: Record<string, string> = {};
          for (let i = 0; i < rawFields.length; i += 2) {
            const fieldName = rawFields[i];
            const fieldValue = rawFields[i + 1];
            if (typeof fieldName === 'string' && typeof fieldValue === 'string') {
              fields[fieldName] = fieldValue;
            }
          }
          return { id, fields };
        });
      },
      [] as RedisStreamEntry[]
    );
  }
}

export const redisClientService = new RedisClientService();
