import assert from 'node:assert/strict';
import { test } from 'node:test';
import { currentUserResolver } from '../src/services/current-user-resolver';

test('current user resolver prefers auth context over fallback headers', () => {
  const req = {
    user: { id: 'auth-user-1' },
    header(name: string) {
      if (name === 'X-User-Id') return 'header-user-1';
      if (name === 'X-Tenant-Id') return 'tenant-a';
      return undefined;
    },
    query: {},
  } as any;

  const resolved = currentUserResolver.resolve(req);
  assert.deepEqual(resolved, {
    userId: 'auth-user-1',
    source: 'auth_context',
    tenantKey: 'tenant-a',
  });
});

test('current user resolver no longer accepts X-User-Id or tenant-only identity', () => {
  const headerReq = {
    header(name: string) {
      if (name === 'X-User-Id') return 'header-user-2';
      return undefined;
    },
    query: {},
  } as any;
  assert.equal(currentUserResolver.resolve(headerReq), null);

  const tenantReq = {
    header() {
      return undefined;
    },
    query: { tenantId: 'tenant-user-1' },
  } as any;
  assert.equal(currentUserResolver.resolve(tenantReq), null);
});

test('current user resolver require rejects when identity is missing', () => {
  assert.throws(() => {
    currentUserResolver.require({
      header() {
        return undefined;
      },
      query: {},
    } as any);
  }, /请先登录/);
});
