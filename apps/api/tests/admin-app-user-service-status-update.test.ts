import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { db } from '../src/config/database';
import { appUserSessions, appUsers } from '../src/db/schema';
import { adminAppUserService } from '../src/services/admin-app-user-service';

afterEach(() => {
  mock.restoreAll();
});

test('updateUserStatus disables user and revokes sessions inside one transaction', async () => {
  const transactionMock = mock.method(db as any, 'transaction', async (callback: (tx: any) => Promise<number>) =>
    callback({
      update(table: unknown) {
        if (table === appUsers) {
          return {
            set() {
              return {
                where() {
                  return {
                    async returning() {
                      return [{ id: 'user-1' }];
                    },
                  };
                },
              };
            },
          };
        }

        if (table === appUserSessions) {
          return {
            set() {
              return {
                where() {
                  return {
                    async returning() {
                      return [{ id: 'session-1' }, { id: 'session-2' }];
                    },
                  };
                },
              };
            },
          };
        }

        throw new Error('unexpected table');
      },
    })
  );
  const detailMock = mock.method(adminAppUserService as any, 'getUserDetail', async () => ({ user: { id: 'user-1' } }));

  const result = await adminAppUserService.updateUserStatus('user-1', 'disabled');

  assert.equal(transactionMock.mock.calls.length, 1);
  assert.equal(detailMock.mock.calls.length, 1);
  assert.equal(result.revokedSessionCount, 2);
});

test('updateUserStatus aborts when session revoke step fails', async () => {
  mock.method(db as any, 'transaction', async (callback: (tx: any) => Promise<number>) =>
    callback({
      update(table: unknown) {
        if (table === appUsers) {
          return {
            set() {
              return {
                where() {
                  return {
                    async returning() {
                      return [{ id: 'user-1' }];
                    },
                  };
                },
              };
            },
          };
        }

        if (table === appUserSessions) {
          return {
            set() {
              return {
                where() {
                  return {
                    async returning() {
                      throw new Error('revoke failed');
                    },
                  };
                },
              };
            },
          };
        }

        throw new Error('unexpected table');
      },
    })
  );
  const detailMock = mock.method(adminAppUserService as any, 'getUserDetail', async () => ({ user: { id: 'user-1' } }));

  await assert.rejects(adminAppUserService.updateUserStatus('user-1', 'disabled'), /revoke failed/);
  assert.equal(detailMock.mock.calls.length, 0);
});
