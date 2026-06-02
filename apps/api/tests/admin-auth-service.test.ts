import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { adminUserDAO } from '../src/db/dao';
import { AdminAuthService } from '../src/services/admin-auth-service';
import { verifyPassword } from '../src/utils/auth-password';

const originalListAll = adminUserDAO.listAll;
const originalCreate = adminUserDAO.create;
const originalUpdateBootstrapCredentials = adminUserDAO.updateBootstrapCredentials;
const TEST_BOOTSTRAP_PASSWORD = 'test-admin-bootstrap-password';

after(() => {
  adminUserDAO.listAll = originalListAll;
  adminUserDAO.create = originalCreate;
  adminUserDAO.updateBootstrapCredentials = originalUpdateBootstrapCredentials;
});

beforeEach(() => {
  adminUserDAO.listAll = originalListAll;
  adminUserDAO.create = originalCreate;
  adminUserDAO.updateBootstrapCredentials = originalUpdateBootstrapCredentials;
  delete process.env.ONECEO_ADMIN_BOOTSTRAP_LOGIN;
  process.env.ONECEO_ADMIN_BOOTSTRAP_PASSWORD = TEST_BOOTSTRAP_PASSWORD;
});

test('ensureBootstrapAdmin creates the default admin66 account for empty admin stores', async () => {
  const service = new AdminAuthService();
  let createdInput: Parameters<typeof adminUserDAO.create>[0] | null = null;

  adminUserDAO.listAll = async () => [];
  adminUserDAO.create = async (input) => {
    createdInput = input;
    return { id: 'admin-1', ...input } as any;
  };

  await service.ensureBootstrapAdmin();

  assert.equal(createdInput?.loginName, 'admin66');
  assert.equal(createdInput?.displayName, 'Platform Admin');
  assert.equal(createdInput?.role, 'super_admin');
  assert.ok(await verifyPassword(TEST_BOOTSTRAP_PASSWORD, createdInput?.passwordHash || ''));
});

test('ensureBootstrapAdmin migrates the legacy bootstrap admin to admin66 when no target admin exists', async () => {
  const service = new AdminAuthService();
  let updateInput: Parameters<typeof adminUserDAO.updateBootstrapCredentials>[1] | null = null;

  adminUserDAO.listAll = async () =>
    [
      {
        id: 'legacy-admin',
        loginName: 'admin',
        displayName: 'Platform Admin',
        role: 'super_admin',
        status: 'active',
      },
    ] as any;
  adminUserDAO.create = async () => {
    throw new Error('legacy bootstrap migration should not create another admin');
  };
  adminUserDAO.updateBootstrapCredentials = async (_id, input) => {
    updateInput = input;
    return { id: 'legacy-admin', ...input } as any;
  };

  await service.ensureBootstrapAdmin();

  assert.equal(updateInput?.loginName, 'admin66');
  assert.ok(await verifyPassword(TEST_BOOTSTRAP_PASSWORD, updateInput?.passwordHash || ''));
});

test('ensureBootstrapAdmin syncs the target admin password when admin66 already exists', async () => {
  const service = new AdminAuthService();
  let updatedId = '';
  let updateInput: Parameters<typeof adminUserDAO.updateBootstrapCredentials>[1] | null = null;

  adminUserDAO.listAll = async () =>
    [
      {
        id: 'target-admin',
        loginName: 'admin66',
        displayName: 'Platform Admin',
        role: 'super_admin',
        status: 'active',
      },
    ] as any;
  adminUserDAO.create = async () => {
    throw new Error('existing target admin should be updated, not recreated');
  };
  adminUserDAO.updateBootstrapCredentials = async (id, input) => {
    updatedId = id;
    updateInput = input;
    return { id, ...input } as any;
  };

  await service.ensureBootstrapAdmin();

  assert.equal(updatedId, 'target-admin');
  assert.equal(updateInput?.loginName, 'admin66');
  assert.ok(await verifyPassword(TEST_BOOTSTRAP_PASSWORD, updateInput?.passwordHash || ''));
});

test('ensureBootstrapAdmin uses ONECEO_ADMIN_BOOTSTRAP_PASSWORD for the fixed admin66 credential', async () => {
  const service = new AdminAuthService();
  let createdInput: Parameters<typeof adminUserDAO.create>[0] | null = null;
  process.env.ONECEO_ADMIN_BOOTSTRAP_LOGIN = 'admin';
  process.env.ONECEO_ADMIN_BOOTSTRAP_PASSWORD = 'another-test-bootstrap-password';

  adminUserDAO.listAll = async () => [];
  adminUserDAO.create = async (input) => {
    createdInput = input;
    return { id: 'admin-fixed', ...input } as any;
  };

  await service.ensureBootstrapAdmin();

  assert.equal(createdInput?.loginName, 'admin66');
  assert.ok(await verifyPassword('another-test-bootstrap-password', createdInput?.passwordHash || ''));
});
