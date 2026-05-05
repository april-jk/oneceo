import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { db } from '../src/config/database';
import { appUserDAO, appUserSessionDAO } from '../src/db/dao';
import { appAuthOauthService } from '../src/services/app-auth-oauth-service';
import { appUserBootstrapService } from '../src/services/app-user-bootstrap-service';

const originalMethods = {
  getByOauthAccount: appUserDAO.getByOauthAccount,
  getByEmail: appUserDAO.getByEmail,
  createOauthUser: appUserDAO.createOauthUser,
  upsertOauthAccount: appUserDAO.upsertOauthAccount,
  updateById: appUserDAO.updateById,
  updateAvatar: appUserDAO.updateAvatar,
  getById: appUserDAO.getById,
  createSession: appUserSessionDAO.create,
  bootstrapNewAppUser: appUserBootstrapService.bootstrapNewAppUser,
  transaction: db.transaction,
};

afterEach(() => {
  appUserDAO.getByOauthAccount = originalMethods.getByOauthAccount;
  appUserDAO.getByEmail = originalMethods.getByEmail;
  appUserDAO.createOauthUser = originalMethods.createOauthUser;
  appUserDAO.upsertOauthAccount = originalMethods.upsertOauthAccount;
  appUserDAO.updateById = originalMethods.updateById;
  appUserDAO.updateAvatar = originalMethods.updateAvatar;
  appUserDAO.getById = originalMethods.getById;
  appUserSessionDAO.create = originalMethods.createSession;
  appUserBootstrapService.bootstrapNewAppUser = originalMethods.bootstrapNewAppUser;
  db.transaction = originalMethods.transaction;
});

test('AppAuthOauthService keeps manual avatar while still syncing oauth metadata', async () => {
  db.transaction = async (callback: any) => callback({} as any);
  let updatedAvatarCount = 0;
  let upsertedAccount = false;

  appUserDAO.getByOauthAccount = async () => null;
  appUserDAO.getByEmail = async () =>
    ({
      id: 'user-oauth-1',
      email: 'oauth@example.com',
      displayName: 'Existing User',
      avatarSource: 'manual',
      avatarStorageKey: 'managed-images/existing-avatar.png',
      profileJson: {},
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    }) as any;
  appUserDAO.upsertOauthAccount = async () => {
    upsertedAccount = true;
    return null as any;
  };
  appUserDAO.getById = async (id) =>
    ({
      id,
      email: 'oauth@example.com',
      displayName: 'Existing User',
      avatarSource: 'manual',
      avatarStorageKey: 'managed-images/existing-avatar.png',
      profileJson: {},
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    }) as any;
  appUserDAO.updateById = async (id, input) =>
    ({
      id,
      email: 'oauth@example.com',
      displayName: input.displayName || 'Existing User',
      avatarSource: 'manual',
      avatarStorageKey: 'managed-images/existing-avatar.png',
      profileJson: {},
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    }) as any;
  appUserDAO.updateAvatar = async () => {
    updatedAvatarCount += 1;
    return {
      id: 'user-oauth-1',
      email: 'oauth@example.com',
      displayName: 'Existing User',
      avatarSource: 'manual',
      avatarStorageKey: 'managed-images/existing-avatar.png',
      profileJson: {},
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any;
  };
  appUserSessionDAO.create = async () => ({ id: 'session-1' } as any);

  const result = await appAuthOauthService.resolveOrCreateUser({
    provider: 'google',
    providerSubject: 'subject-1',
    email: 'oauth@example.com',
    displayName: 'OAuth User',
    avatarUrl: 'https://example.com/oauth.png',
  });

  assert.equal(upsertedAccount, true);
  assert.equal(updatedAvatarCount, 0);
  assert.equal(result.user?.avatarSource, 'manual');
});

test('AppAuthOauthService bootstraps default membership for first-time oauth sign-up', async () => {
  db.transaction = async (callback: any) => callback({} as any);
  let bootstrapInput: { userId: string; source: string } | null = null;

  appUserDAO.getByOauthAccount = async () => null;
  appUserDAO.getByEmail = async () => null;
  appUserDAO.createOauthUser = async (input) =>
    ({
      id: 'oauth-created-1',
      email: input.email,
      displayName: input.displayName,
      avatarSource: input.avatarSource || 'default',
      profileJson: {},
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    }) as any;
  appUserBootstrapService.bootstrapNewAppUser = async (userId, source) => {
    bootstrapInput = { userId, source };
    return null;
  };
  appUserSessionDAO.create = async () => ({ id: 'session-2' } as any);
  appUserDAO.getById = async (id) =>
    ({
      id,
      email: 'oauth-created@example.com',
      displayName: 'OAuth Created',
      avatarSource: 'oauth_google',
      profileJson: {},
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    }) as any;

  const result = await appAuthOauthService.resolveOrCreateUser({
    provider: 'google',
    providerSubject: 'subject-created-1',
    email: 'oauth-created@example.com',
    displayName: 'OAuth Created',
    avatarUrl: 'https://example.com/oauth-created.png',
  });

  assert.equal(result.user?.id, 'oauth-created-1');
  assert.deepEqual(bootstrapInput, {
    userId: 'oauth-created-1',
    source: 'oauth_google_register',
  });
});

test('AppAuthOauthService retries cleanly after transactional bootstrap failure', async () => {
  const transactionError = new Error('bootstrap failed');
  let createOauthUserCalls = 0;

  db.transaction = async (callback: any) => {
    try {
      return await callback({} as any);
    } catch (error) {
      throw error;
    }
  };
  appUserDAO.getByOauthAccount = async () => null;
  appUserDAO.getByEmail = async () => null;
  appUserDAO.createOauthUser = async () => {
    createOauthUserCalls += 1;
    return {
      id: `oauth-created-${createOauthUserCalls}`,
      email: 'oauth-created@example.com',
      displayName: 'OAuth Created',
      avatarSource: 'oauth_google',
      profileJson: {},
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any;
  };
  appUserBootstrapService.bootstrapNewAppUser = async () => {
    throw transactionError;
  };

  await assert.rejects(
    () =>
      appAuthOauthService.resolveOrCreateUser({
        provider: 'google',
        providerSubject: 'subject-created-2',
        email: 'oauth-created@example.com',
        displayName: 'OAuth Created',
        avatarUrl: 'https://example.com/oauth-created.png',
      }),
    transactionError
  );

  assert.equal(createOauthUserCalls, 1);
});
