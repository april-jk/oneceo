import test from 'node:test';
import assert from 'node:assert/strict';
import type { RedisCommandPort } from '../src/services/redis-client-service';
import { TaskSessionDeploymentRedisCacheService } from '../src/services/task-session-deployment-redis-cache-service';

class FakeRedisPort implements RedisCommandPort {
  readonly json = new Map<string, unknown>();
  readonly strings = new Map<string, string>();
  readonly sets = new Map<string, Set<string>>();

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
    return deleted;
  }

  async appendStream() {
    return null;
  }

  async readStream() {
    return [];
  }
}

test('deployment redis cache stores isolated payloads and invalidates by session scope', async () => {
  const redis = new FakeRedisPort();
  const service = new TaskSessionDeploymentRedisCacheService(redis);
  const userId = 'user-cache-1';
  const sessionId = 'session-cache-1';

  await service.setDeploymentInfo(userId, sessionId, { deploymentId: 'dep-1', status: 'ready' }, 'dep-1');
  await service.setDeploymentAnalytics(userId, sessionId, { totalRequests: 100 }, '24h');
  await service.setDeploymentTemplate(userId, sessionId, { hasRailwayToml: true });
  await service.setDatabaseStatus(userId, sessionId, { configured: true, tables: ['users'] });
  await service.setDatabaseRows(userId, sessionId, 'users', 1, 50, { rows: [{ id: 1 }] });
  await service.setStorageStatus(userId, sessionId, false, { configured: true, files: ['a.txt'] });
  await service.setStorageStatus(userId, sessionId, true, { configured: true, files: ['a.txt'], token: 'secret' });

  const info = await service.getDeploymentInfo<Record<string, unknown>>(userId, sessionId, 'dep-1');
  const analytics = await service.getDeploymentAnalytics<Record<string, unknown>>(userId, sessionId, '24h');
  const template = await service.getDeploymentTemplate<Record<string, unknown>>(userId, sessionId);
  const dbStatus = await service.getDatabaseStatus<Record<string, unknown>>(userId, sessionId);
  const dbRows = await service.getDatabaseRows<Record<string, unknown>>(userId, sessionId, 'users', 1, 50);
  const storageHidden = await service.getStorageStatus<Record<string, unknown>>(userId, sessionId, false);
  const storageReveal = await service.getStorageStatus<Record<string, unknown>>(userId, sessionId, true);

  assert.equal(info?.deploymentId, 'dep-1');
  assert.equal(analytics?.totalRequests, 100);
  assert.equal(template?.hasRailwayToml, true);
  assert.equal(dbStatus?.configured, true);
  assert.equal(Array.isArray(dbRows?.rows), true);
  assert.equal(storageHidden?.token, undefined);
  assert.equal(storageReveal?.token, 'secret');

  await service.setDatabaseStatus(userId, 'session-cache-other', { configured: true });
  await service.invalidateSessionReads(userId, sessionId);

  const afterInvalidateInfo = await service.getDeploymentInfo(userId, sessionId, 'dep-1');
  const afterInvalidateRows = await service.getDatabaseRows(userId, sessionId, 'users', 1, 50);
  const otherSessionStatus = await service.getDatabaseStatus(userId, 'session-cache-other');

  assert.equal(afterInvalidateInfo, null);
  assert.equal(afterInvalidateRows, null);
  assert.equal(otherSessionStatus?.configured, true);
});
