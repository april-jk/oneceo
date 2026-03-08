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

test('current user resolver falls back to X-User-Id then tenant', () => {
  const headerReq = {
    header(name: string) {
      if (name === 'X-User-Id') return 'header-user-2';
      return undefined;
    },
    query: {},
  } as any;
  assert.deepEqual(currentUserResolver.resolve(headerReq), {
    userId: 'header-user-2',
    source: 'x-user-id',
    tenantKey: '',
  });

  const tenantReq = {
    header() {
      return undefined;
    },
    query: { tenantId: 'tenant-user-1' },
  } as any;
  assert.deepEqual(currentUserResolver.resolve(tenantReq), {
    userId: 'tenant-user-1',
    source: 'tenant',
    tenantKey: 'tenant-user-1',
  });
});

test('current user resolver require rejects when identity is missing', () => {
  assert.throws(() => {
    currentUserResolver.require({
      header() {
        return undefined;
      },
      query: {},
    } as any);
  }, /X-User-Id/);
});
