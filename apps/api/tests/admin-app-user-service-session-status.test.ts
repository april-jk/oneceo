import assert from 'node:assert/strict';
import test from 'node:test';
import {
  APP_USER_ONLINE_IDLE_MS,
  isActiveSession,
  isOnlineSession,
} from '../src/services/admin-app-user-service';

test('isActiveSession only checks revoke and expiry', () => {
  const now = new Date('2026-04-17T12:00:00.000Z');

  assert.equal(
    isActiveSession(
      {
        expiresAt: new Date('2026-04-17T12:30:00.000Z'),
        revokedAt: null,
      },
      now
    ),
    true
  );

  assert.equal(
    isActiveSession(
      {
        expiresAt: new Date('2026-04-17T11:59:59.000Z'),
        revokedAt: null,
      },
      now
    ),
    false
  );

  assert.equal(
    isActiveSession(
      {
        expiresAt: new Date('2026-04-17T12:30:00.000Z'),
        revokedAt: new Date('2026-04-17T11:30:00.000Z'),
      },
      now
    ),
    false
  );
});

test('isOnlineSession requires recent lastSeenAt within online window', () => {
  const now = new Date('2026-04-17T12:00:00.000Z');

  assert.equal(
    isOnlineSession(
      {
        expiresAt: new Date('2026-04-17T13:00:00.000Z'),
        revokedAt: null,
        lastSeenAt: new Date(now.getTime() - (APP_USER_ONLINE_IDLE_MS - 1)),
      },
      now
    ),
    true
  );

  assert.equal(
    isOnlineSession(
      {
        expiresAt: new Date('2026-04-17T13:00:00.000Z'),
        revokedAt: null,
        lastSeenAt: new Date(now.getTime() - APP_USER_ONLINE_IDLE_MS - 1),
      },
      now
    ),
    false
  );

  assert.equal(
    isOnlineSession(
      {
        expiresAt: new Date('2026-04-17T13:00:00.000Z'),
        revokedAt: null,
        lastSeenAt: null,
      },
      now
    ),
    false
  );
});
