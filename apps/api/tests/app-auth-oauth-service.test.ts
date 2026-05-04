import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { appUserDAO, appUserSessionDAO } from '../src/db/dao';
import { appAuthOauthService } from '../src/services/app-auth-oauth-service';

const originalMethods = {
  getByOauthAccount: appUserDAO.getByOauthAccount,
  getByEmail: appUserDAO.getByEmail,
  createOauthUser: appUserDAO.createOauthUser,
  upsertOauthAccount: appUserDAO.upsertOauthAccount,
  updateById: appUserDAO.updateById,
  updateAvatar: appUserDAO.updateAvatar,
  getById: appUserDAO.getById,
  createSession: appUserSessionDAO.create,
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
});

test('AppAuthOauthService keeps manual avatar while still syncing oauth metadata', async () => {
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
