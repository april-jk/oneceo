import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import {
  appUserDAO,
  appUserEmailVerificationDAO,
  appUserSessionDAO,
} from '../src/db/dao';
import { appAuthEmailService } from '../src/services/app-auth-email-service';
import { appAuthService } from '../src/services/app-auth-service';
import { managedImageObjectService } from '../src/services/managed-image-object-service';
import { hashPassword, verifyPassword } from '../src/utils/auth-password';

const originalMethods = {
  getByEmail: appUserDAO.getByEmail,
  createUser: appUserDAO.create,
  getById: appUserDAO.getById,
  updateById: appUserDAO.updateById,
  touchLastLogin: appUserDAO.touchLastLogin,
  updateAvatar: appUserDAO.updateAvatar,
  getVerification: appUserEmailVerificationDAO.getByEmailAndPurpose,
  upsertVerification: appUserEmailVerificationDAO.upsert,
  markConsumed: appUserEmailVerificationDAO.markConsumed,
  deleteVerification: appUserEmailVerificationDAO.deleteByEmailAndPurpose,
  createSession: appUserSessionDAO.create,
  sendVerificationCode: appAuthEmailService.sendVerificationCode,
  getSignedDownloadUrl: managedImageObjectService.getSignedDownloadUrl,
  uploadImage: managedImageObjectService.uploadImage,
  deleteImage: managedImageObjectService.deleteImage,
};

afterEach(() => {
  appUserDAO.getByEmail = originalMethods.getByEmail;
  appUserDAO.create = originalMethods.createUser;
  appUserDAO.getById = originalMethods.getById;
  appUserDAO.updateById = originalMethods.updateById;
  appUserDAO.touchLastLogin = originalMethods.touchLastLogin;
  appUserDAO.updateAvatar = originalMethods.updateAvatar;
  appUserEmailVerificationDAO.getByEmailAndPurpose = originalMethods.getVerification;
  appUserEmailVerificationDAO.upsert = originalMethods.upsertVerification;
  appUserEmailVerificationDAO.markConsumed = originalMethods.markConsumed;
  appUserEmailVerificationDAO.deleteByEmailAndPurpose = originalMethods.deleteVerification;
  appUserSessionDAO.create = originalMethods.createSession;
  appAuthEmailService.sendVerificationCode = originalMethods.sendVerificationCode;
  managedImageObjectService.getSignedDownloadUrl = originalMethods.getSignedDownloadUrl;
  managedImageObjectService.uploadImage = originalMethods.uploadImage;
  managedImageObjectService.deleteImage = originalMethods.deleteImage;
  delete process.env.APP_AUTH_REGISTER_CODE_TTL_SECONDS;
  delete process.env.APP_AUTH_REGISTER_CODE_RESEND_COOLDOWN_SECONDS;
});

test('AppAuthService.sendRegisterVerificationCode stores hashed code and sends email', async () => {
  let storedCodeHash = '';
  let sentPayload: { purpose: string; email: string; code: string; expiresInSeconds: number } | null = null;

  appUserDAO.getByEmail = async () => null;
  appUserEmailVerificationDAO.getByEmailAndPurpose = async () => null;
  appUserEmailVerificationDAO.upsert = async (input) => {
    storedCodeHash = input.codeHash;
    return {
      id: 'verify-1',
      email: input.email,
      purpose: input.purpose,
      codeHash: input.codeHash,
      expiresAt: input.expiresAt,
      consumedAt: null,
      lastSentAt: input.lastSentAt,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any;
  };
  appAuthEmailService.sendVerificationCode = async (purpose, input) => {
    sentPayload = {
      purpose,
      email: input.email,
      code: input.code,
      expiresInSeconds: input.expiresInSeconds,
    };
  };

  const result = await appAuthService.sendRegisterVerificationCode({
    email: 'New@Example.com',
  });

  assert.equal(result.cooldownSeconds, 60);
  assert.equal(result.expiresInSeconds, 600);
  assert.ok(sentPayload);
  assert.equal(sentPayload?.purpose, 'register');
  assert.equal(sentPayload?.email, 'new@example.com');
  assert.match(sentPayload?.code || '', /^\d{6}$/);
  assert.equal(sentPayload?.expiresInSeconds, 600);
  assert.ok(await verifyPassword(sentPayload?.code || '', storedCodeHash));
});

test('AppAuthService.register rejects wrong verification code', async () => {
  appUserDAO.getByEmail = async () => null;
  appUserEmailVerificationDAO.getByEmailAndPurpose = async () =>
    ({
      id: 'verify-2',
      email: 'user@example.com',
      purpose: 'register',
      codeHash: await hashPassword('123456'),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      consumedAt: null,
      lastSentAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    }) as any;

  let consumed = false;
  appUserEmailVerificationDAO.markConsumed = async () => {
    consumed = true;
    return null;
  };

  await assert.rejects(
    () =>
      appAuthService.register({
        email: 'user@example.com',
        password: 'password123',
        displayName: 'User',
        verificationCode: '000000',
      }),
    /验证码错误/
  );
  assert.equal(consumed, false);
});

test('AppAuthService.register consumes verification code before creating session', async () => {
  appUserDAO.getByEmail = async () => null;
  appUserEmailVerificationDAO.getByEmailAndPurpose = async () =>
    ({
      id: 'verify-3',
      email: 'user@example.com',
      purpose: 'register',
      codeHash: await hashPassword('123456'),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      consumedAt: null,
      lastSentAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    }) as any;
  appUserEmailVerificationDAO.markConsumed = async () =>
    ({
      id: 'verify-3',
      consumedAt: new Date(),
    }) as any;
  appUserDAO.create = async (input) =>
    ({
      id: 'user-1',
      email: input.email,
      displayName: input.displayName,
      passwordHash: input.passwordHash,
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
      lastLoginAt: null,
    }) as any;
  appUserSessionDAO.create = async () =>
    ({
      id: 'session-1',
    }) as any;
  appUserDAO.touchLastLogin = async () =>
    ({
      id: 'user-1',
    }) as any;
  appUserDAO.getById = async () =>
    ({
      id: 'user-1',
      email: 'user@example.com',
      displayName: 'User',
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    }) as any;

  const result = await appAuthService.register({
    email: 'user@example.com',
    password: 'password123',
    displayName: 'User',
    verificationCode: '123456',
  });

  assert.equal(result.user?.id, 'user-1');
  assert.equal(result.user?.email, 'user@example.com');
  assert.ok(result.token);
});

test('AppAuthService.updateProfile normalizes personalization payload and returns updated user', async () => {
  let capturedUpdate:
    | {
        id: string;
        input: {
          displayName?: string;
          profileJson?: Record<string, unknown>;
        };
      }
    | null = null;

  appUserDAO.getById = async () =>
    ({
      id: 'user-profile-1',
      email: 'profile@example.com',
      displayName: 'Existing Name',
      profileJson: {
        personalization: {
          preferredName: 'Old',
          role: 'Engineer',
          about: 'Old bio',
          responsePreferences: 'Old pref',
        },
      },
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    }) as any;

  appUserDAO.updateById = async (id, input) => {
    capturedUpdate = { id, input };
    return {
      id,
      email: 'profile@example.com',
      displayName: input.displayName || 'Existing Name',
      profileJson: input.profileJson || {},
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any;
  };

  const result = await appAuthService.updateProfile('user-profile-1', {
    displayName: '  New Name  ',
    personalization: {
      preferredName: '  Watson  ',
      occupation: ' Founder ',
      identity: ' Builder ',
      location: ' Shanghai ',
      background: '  Builds agent systems. ',
      preferences: '  Prefer clear tradeoffs. ',
      responsePreferences: '  Start with the answer. ',
    },
  });

  assert.equal(capturedUpdate?.id, 'user-profile-1');
  assert.deepEqual(capturedUpdate?.input.profileJson, {
    personalization: {
      preferredName: 'Watson',
      occupation: 'Founder',
      identity: 'Builder',
      location: 'Shanghai',
      background: 'Builds agent systems.',
      preferences: 'Prefer clear tradeoffs.',
      responsePreferences: 'Start with the answer.',
    },
  });
  assert.equal(result?.displayName, 'New Name');
  assert.deepEqual(result?.personalization, {
    preferredName: 'Watson',
    occupation: 'Founder',
    identity: 'Builder',
    location: 'Shanghai',
    background: 'Builds agent systems.',
    preferences: 'Prefer clear tradeoffs.',
    responsePreferences: 'Start with the answer.',
  });
});

test('AppAuthService.uploadAvatar stores storage key and returns signed avatar url', async () => {
  let uploadedKey = '';
  let deletedKey = '';

  appUserDAO.getById = async () =>
    ({
      id: 'user-avatar-1',
      email: 'avatar@example.com',
      displayName: 'Avatar User',
      avatarStorageKey: 'managed-images/old-avatar.png',
      avatarUrl: null,
      avatarSource: 'manual',
      profileJson: {},
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    }) as any;
  appUserDAO.updateAvatar = async (id, input) =>
    ({
      id,
      email: 'avatar@example.com',
      displayName: 'Avatar User',
      avatarStorageKey: input.avatarStorageKey,
      avatarUrl: input.avatarUrl,
      avatarSource: input.avatarSource,
      profileJson: {},
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    }) as any;
  managedImageObjectService.uploadImage = async (input) => {
    uploadedKey = input.objectKey;
  };
  managedImageObjectService.getSignedDownloadUrl = async (key) => `signed:${key}`;
  managedImageObjectService.deleteImage = async (key) => {
    deletedKey = key;
  };

  const result = await appAuthService.uploadAvatar('user-avatar-1', {
    contentType: 'image/png',
    originalName: 'avatar.png',
    buffer: Buffer.from('avatar'),
  });

  assert.equal(uploadedKey.startsWith('managed-images/app-user-user-avatar-1/avatar/'), true);
  assert.equal(result?.avatarUrl, 'signed:' + uploadedKey);
  assert.equal(result?.avatarSource, 'manual');

  await appAuthService.removeAvatar('user-avatar-1');
  assert.equal(deletedKey, 'managed-images/old-avatar.png');
});
