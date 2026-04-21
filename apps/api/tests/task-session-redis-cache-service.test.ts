import test from 'node:test';
import assert from 'node:assert/strict';
import type { RedisCommandPort, RedisStreamEntry } from '../src/services/redis-client-service';
import { TaskSessionRedisCacheService } from '../src/services/task-session-redis-cache-service';
import { redisKeyspace } from '../src/services/redis-keyspace';

class FakeRedisPort implements RedisCommandPort {
  readonly json = new Map<string, unknown>();
  readonly strings = new Map<string, string>();
  readonly sets = new Map<string, Set<string>>();
  readonly streams = new Map<string, RedisStreamEntry[]>();

  isEnabled() {
    return true;
  }

  async getJson<T>(key: string) {
    return (this.json.get(key) as T | undefined) ?? null;
  }

  async setJson(key: string, value: unknown) {
    this.json.set(key, value);
  }

  async setString(key: string, value: string) {
    this.strings.set(key, value);
    return true;
  }

  async getString(key: string) {
    return this.strings.get(key) ?? null;
  }

  async delete(key: string) {
    this.json.delete(key);
    this.strings.delete(key);
    this.streams.delete(key);
  }

  async addSetMember(key: string, member: string) {
    const set = this.sets.get(key) || new Set<string>();
    set.add(member);
    this.sets.set(key, set);
  }

  async removeSetMember(key: string, member: string) {
    this.sets.get(key)?.delete(member);
  }

  async deleteByPrefix(prefix: string) {
    let deleted = 0;
    for (const key of Array.from(this.json.keys())) {
      if (key.startsWith(prefix)) {
        this.json.delete(key);
        deleted += 1;
      }
    }
    for (const key of Array.from(this.strings.keys())) {
      if (key.startsWith(prefix)) {
        this.strings.delete(key);
        deleted += 1;
      }
    }
    for (const key of Array.from(this.streams.keys())) {
      if (key.startsWith(prefix)) {
        this.streams.delete(key);
        deleted += 1;
      }
    }
    return deleted;
  }

  async appendStream(key: string, fields: Record<string, string | number | boolean | null | undefined>) {
    const entries = this.streams.get(key) || [];
    entries.push({
      id: `stream-${entries.length + 1}`,
      fields: Object.fromEntries(
        Object.entries(fields)
          .filter(([, value]) => value !== undefined)
          .map(([field, value]) => [field, value === null ? '' : String(value)])
      ),
    });
    this.streams.set(key, entries);
    return entries[entries.length - 1]?.id || null;
  }

  async readStream(key: string) {
    return this.streams.get(key) || [];
  }
}

test('task session redis cache service stores workspace/recent/history/session-events within session scope', async () => {
  const redis = new FakeRedisPort();
  const service = new TaskSessionRedisCacheService(redis);
  const scope = {
    userId: 'user-redis-1',
    tenantKey: 'tenant-redis-1',
    sessionId: 'session-redis-1',
  };

  await service.setWorkspaceTree({
    ...scope,
    payload: {
      root: '/workspace',
      items: [{ path: 'src', type: 'dir' }],
    },
  });
  await service.setWorkspaceFile({
    ...scope,
    path: 'src/index.ts',
    payload: {
      path: 'src/index.ts',
      content: 'export {}',
      isBinary: false,
    },
  });
  await service.setRecentMessagesPage({
    ...scope,
    payload: {
      messages: [{ id: 'm-1', role: 'user', content: 'hello' }],
      source: 'recent_cache',
    },
  });
  await service.setHistoryCursor({
    ...scope,
    beforeCursor: 10,
    oldestCursor: 11,
    newestCursor: 20,
  });
  await service.setSkillSessionState({
    ...scope,
    state: {
      residentSelections: [{ sourceType: 'platform', skillId: 'skill-1', revisionId: 'rev-1' }],
    },
  });
  await service.appendSessionEvent({
    ...scope,
    eventType: 'session.diff',
    messageType: 'opencode_event',
    eventId: 101,
    createdAt: new Date().toISOString(),
    messageKey: 'session-event:101',
    content: '[File] edited src/index.ts',
    metadata: { sessionEventSeq: 101 },
  });

  const tree = await service.getWorkspaceTree(scope);
  const file = await service.getWorkspaceFile({ ...scope, path: 'src/index.ts' });
  const recent = await service.getRecentMessagesPage(scope);
  const historyCursor = await service.getHistoryCursor(scope);
  const skillState = await service.getSkillSessionState(scope);
  const events = await service.listSessionEvents({ ...scope, afterEventId: 100 });

  assert.equal((tree?.root as string) || '', '/workspace');
  assert.equal((file?.path as string) || '', 'src/index.ts');
  assert.equal(Array.isArray((recent as any)?.messages), true);
  assert.equal(historyCursor?.newestCursor, 20);
  assert.equal(Array.isArray(skillState?.state?.residentSelections), true);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.eventId, 101);

  await service.invalidateWorkspace(scope);

  const workspacePrefix = 'oneceo:v1:tenant:tenant-redis-1:session:session-redis-1:cache:workspace:';
  assert.equal(Array.from(redis.json.keys()).some((key) => key.startsWith(workspacePrefix)), false);
  assert.ok(redis.json.has(redisKeyspace.messagesRecent(scope)));
});
