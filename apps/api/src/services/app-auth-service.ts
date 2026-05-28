import type express from 'express';
import { randomInt } from 'node:crypto';
import { db } from '../config/database';
import { appUserDAO, appUserEmailVerificationDAO, appUserSessionDAO } from '../db/dao';
import { altusMemoryContextService } from './altus-memory-context-service';
import { appAuthEmailService } from './app-auth-email-service';
import { managedImageObjectService } from './managed-image-object-service';
import { appUserBootstrapService } from './app-user-bootstrap-service';
import type { MembershipDbExecutor } from './membership-service';
import { hashPassword, verifyPassword } from '../utils/auth-password';
import { createSessionToken, hashSessionToken, resolveSessionExpiry } from '../utils/auth-session';
import { runtimeEnvConfig } from '../config/runtime-env';

const REGISTER_VERIFICATION_PURPOSE = 'register';
const DEFAULT_REGISTER_CODE_LENGTH = 6;
const DEFAULT_REGISTER_CODE_TTL_SECONDS = 10 * 60;
const DEFAULT_REGISTER_CODE_RESEND_COOLDOWN_SECONDS = 60;
const DUMMY_LOGIN_PASSWORD_HASH =
  'scrypt:6f1e8c4a9d3b2f10c5a7e1d4b8c2f9a1:bba8c7584b26da9c63e641970c9ec0daa3bb8a26779af768c31251573b67d5d6e435c0f551ebe9b1198f07e23281beda7283f51d03a15f2e12459ecb809286a9';

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function asPositiveInteger(value: unknown, fallback: number) {
  const parsed = Number(asText(value));
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function isValidEmail(email: string) {
  return !!email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

const PERSONALIZATION_MAX_LENGTH = {
  preferredName: 80,
  occupation: 80,
  identity: 80,
  location: 120,
  background: 1000,
  preferences: 800,
  responsePreferences: 1500,
} as const;

type AppUserPersonalization = {
  preferredName: string;
  occupation: string;
  identity: string;
  location: string;
  background: string;
  preferences: string;
  responsePreferences: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeBoundedText(value: unknown, maxLength: number, label: string) {
  const text = asText(value);
  if (text.length > maxLength) {
    throw new Error(`${label}长度不能超过 ${maxLength} 个字符`);
  }
  return text;
}

export function normalizeAppUserPersonalization(value: unknown): AppUserPersonalization {
  const record = asRecord(value);
  const legacyRole = record.role;
  const legacyAbout = record.about;
  return {
    preferredName: normalizeBoundedText(
      record.preferredName,
      PERSONALIZATION_MAX_LENGTH.preferredName,
      '称呼偏好'
    ),
    occupation: normalizeBoundedText(
      record.occupation ?? legacyRole,
      PERSONALIZATION_MAX_LENGTH.occupation,
      '职业'
    ),
    identity: normalizeBoundedText(record.identity, PERSONALIZATION_MAX_LENGTH.identity, '身份'),
    location: normalizeBoundedText(record.location, PERSONALIZATION_MAX_LENGTH.location, '所在地'),
    background: normalizeBoundedText(
      record.background ?? legacyAbout,
      PERSONALIZATION_MAX_LENGTH.background,
      '背景信息'
    ),
    preferences: normalizeBoundedText(record.preferences, PERSONALIZATION_MAX_LENGTH.preferences, '长期偏好'),
    responsePreferences: normalizeBoundedText(
      record.responsePreferences,
      PERSONALIZATION_MAX_LENGTH.responsePreferences,
      '自定义指令'
    ),
  };
}

function extractAppUserPersonalization(profileJson: unknown): AppUserPersonalization {
  const root = asRecord(profileJson);
  return normalizeAppUserPersonalization(root.personalization);
}

async function resolvePublicAvatarUrl(user: Awaited<ReturnType<typeof appUserDAO.getById>>) {
  if (!user) return null;
  const avatarStorageKey = asText((user as any).avatarStorageKey);
  if (avatarStorageKey) {
    try {
      return await managedImageObjectService.getSignedDownloadUrl(avatarStorageKey);
    } catch (error) {
      console.warn('[APP_AUTH_AVATAR] failed to resolve signed avatar url:', error);
      return null;
    }
  }
  const avatarUrl = asText((user as any).avatarUrl);
  return avatarUrl || null;
}

function generateVerificationCode(length = DEFAULT_REGISTER_CODE_LENGTH) {
  const max = 10 ** length;
  return String(randomInt(0, max)).padStart(length, '0');
}

async function toPublicUser(user: Awaited<ReturnType<typeof appUserDAO.getById>>) {
  if (!user) return null;
  const avatarUrl = await resolvePublicAvatarUrl(user);
  return {
    id: String(user.id),
    email: user.email,
    displayName: user.displayName,
    avatarUrl,
    avatarSource: user.avatarSource || 'default',
    personalization: extractAppUserPersonalization((user as any).profileJson),
    status: user.status,
    createdAt: user.createdAt?.toISOString?.() || new Date().toISOString(),
    updatedAt: user.updatedAt?.toISOString?.() || new Date().toISOString(),
  };
}

export class AppAuthService {
  private async createUserWithBootstrapInTransaction(input: {
    email: string;
    password: string;
    displayName: string;
  }, executor?: MembershipDbExecutor) {
    const createWithin = async (currentExecutor: MembershipDbExecutor) => {
      const created = await appUserDAO.create({
        email: input.email,
        passwordHash: await hashPassword(input.password),
        displayName: input.displayName,
        profileJson: {
          personalization: normalizeAppUserPersonalization(undefined),
        },
      }, currentExecutor);
      await appUserBootstrapService.bootstrapNewAppUser(String(created.id), 'email_register', currentExecutor);
      return String(created.id);
    };

    if (executor) {
      return createWithin(executor);
    }

    return db.transaction(async (trx) => createWithin(trx));
  }

  async sendRegisterVerificationCode(input: { email: string }) {
    const email = asText(input.email).toLowerCase();
    if (!isValidEmail(email)) {
      throw new Error('请输入有效邮箱');
    }

    const existingUser = await appUserDAO.getByEmail(email);
    if (existingUser) {
      throw new Error('该邮箱已注册');
    }

    const cooldownSeconds = asPositiveInteger(
      process.env.APP_AUTH_REGISTER_CODE_RESEND_COOLDOWN_SECONDS,
      DEFAULT_REGISTER_CODE_RESEND_COOLDOWN_SECONDS
    );
    const ttlSeconds = asPositiveInteger(
      process.env.APP_AUTH_REGISTER_CODE_TTL_SECONDS,
      DEFAULT_REGISTER_CODE_TTL_SECONDS
    );
    const now = new Date();
    const existingCode = await appUserEmailVerificationDAO.getByEmailAndPurpose(email, REGISTER_VERIFICATION_PURPOSE);
    if (existingCode?.lastSentAt) {
      const elapsedMs = now.getTime() - existingCode.lastSentAt.getTime();
      const remainingSeconds = Math.ceil((cooldownSeconds * 1000 - elapsedMs) / 1000);
      if (remainingSeconds > 0) {
        throw new Error(`验证码发送过于频繁，请在 ${remainingSeconds} 秒后重试`);
      }
    }

    const code = generateVerificationCode();
    const codeHash = await hashPassword(code);
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

    await appUserEmailVerificationDAO.upsert({
      email,
      purpose: REGISTER_VERIFICATION_PURPOSE,
      codeHash,
      expiresAt,
      lastSentAt: now,
    });

    try {
      await appAuthEmailService.sendVerificationCode('register', {
        email,
        code,
        expiresInSeconds: ttlSeconds,
      });
    } catch (error) {
      await appUserEmailVerificationDAO.deleteByEmailAndPurpose(email, REGISTER_VERIFICATION_PURPOSE).catch(() => null);
      throw error instanceof Error ? error : new Error('验证码发送失败');
    }

    return {
      cooldownSeconds,
      expiresInSeconds: ttlSeconds,
    };
  }

  async register(
    input: { email: string; password: string; displayName: string; verificationCode: string },
    req?: express.Request
  ) {
    const email = asText(input.email).toLowerCase();
    const password = asText(input.password);
    const displayName = asText(input.displayName);
    const verificationCode = asText(input.verificationCode);
    if (!isValidEmail(email)) {
      throw new Error('请输入有效邮箱');
    }
    if (password.length < 8) {
      throw new Error('密码长度不能少于 8 位');
    }
    if (!displayName) {
      throw new Error('显示名称不能为空');
    }

    const skipVerificationInDev = runtimeEnvConfig.capabilities.skipEmailVerificationOnRegister;
    if (!skipVerificationInDev && !verificationCode) {
      throw new Error('请输入邮箱验证码');
    }
    const existing = await appUserDAO.getByEmail(email);
    if (existing) {
      throw new Error('该邮箱已注册');
    }
    if (!skipVerificationInDev) {
      const verification = await appUserEmailVerificationDAO.getByEmailAndPurpose(email, REGISTER_VERIFICATION_PURPOSE);
      if (!verification) {
        throw new Error('请先获取邮箱验证码');
      }
      if (verification.consumedAt) {
        throw new Error('验证码已使用，请重新获取');
      }
      if (verification.expiresAt.getTime() <= Date.now()) {
        throw new Error('验证码已过期，请重新获取');
      }
      const validCode = await verifyPassword(verificationCode, verification.codeHash);
      if (!validCode) {
        throw new Error('验证码错误');
      }
      const createdUserId = await db.transaction(async (trx) => {
        const consumed = await appUserEmailVerificationDAO.markConsumed(String(verification.id), trx);
        if (!consumed) {
          throw new Error('验证码已失效，请重新获取');
        }
        return this.createUserWithBootstrapInTransaction({
          email,
          password,
          displayName,
        }, trx);
      });
      return this.createSessionForUser(createdUserId, req);
    } else {
      console.info('[APP_AUTH_REGISTER] skip verification code because runtime env capability is enabled', {
        runtimeEnv: runtimeEnvConfig.runtimeEnv,
      });
    }
    const createdUserId = await this.createUserWithBootstrapInTransaction({
      email,
      password,
      displayName,
    });
    return this.createSessionForUser(createdUserId, req);
  }

  async login(input: { email: string; password: string }, req?: express.Request) {
    const email = asText(input.email).toLowerCase();
    const password = asText(input.password) || 'oneceo-invalid-empty-password';
    const user = await appUserDAO.getByEmail(email);
    const passwordHash = user?.status === 'active' ? user.passwordHash : DUMMY_LOGIN_PASSWORD_HASH;
    const ok = await verifyPassword(password, passwordHash);
    if (!user || user.status !== 'active' || !ok) {
      throw new Error('邮箱或密码错误');
    }
    return this.createSessionForUser(String(user.id), req);
  }

  async createSessionForUser(userId: string, req?: express.Request) {
    const token = createSessionToken();
    const session = await appUserSessionDAO.create({
      userId,
      sessionTokenHash: hashSessionToken(token),
      expiresAt: resolveSessionExpiry(),
      userAgent: req?.headers['user-agent'] || null,
      ipAddress: (req?.headers['x-forwarded-for'] as string) || req?.socket.remoteAddress || null,
    });
    await appUserDAO.touchLastLogin(userId);
    const user = await appUserDAO.getById(userId);
    return {
      token,
      session,
      user: await toPublicUser(user),
    };
  }

  async resolveUserBySessionToken(sessionToken: string) {
    const hashed = hashSessionToken(asText(sessionToken));
    const session = await appUserSessionDAO.getActiveByTokenHash(hashed);
    if (!session) return null;
    await appUserSessionDAO.touch(String(session.id)).catch(() => null);
    const user = await appUserDAO.getById(String(session.userId));
    if (!user || user.status !== 'active') {
      return null;
    }
    return {
      session,
      user: await toPublicUser(user),
    };
  }

  async logout(sessionToken: string) {
    if (!asText(sessionToken)) return;
    await appUserSessionDAO.revokeByTokenHash(hashSessionToken(sessionToken));
  }

  async updateProfile(
    userId: string,
    input: {
      displayName?: string;
      personalization?: unknown;
    }
  ) {
    const current = await appUserDAO.getById(userId);
    if (!current) {
      throw new Error('用户不存在');
    }

    const nextDisplayName =
      input.displayName === undefined ? undefined : asText(input.displayName);
    if (input.displayName !== undefined && !nextDisplayName) {
      throw new Error('显示名称不能为空');
    }

    const nextPersonalization =
      input.personalization === undefined
        ? extractAppUserPersonalization((current as any).profileJson)
        : normalizeAppUserPersonalization(input.personalization);

    const updated = await appUserDAO.updateById(userId, {
      displayName: nextDisplayName,
      profileJson: {
        ...asRecord((current as any).profileJson),
        personalization: nextPersonalization,
      },
    });

    if (!updated) {
      throw new Error('更新用户资料失败');
    }

    await altusMemoryContextService.invalidateUserMemory(userId);

    return await toPublicUser(updated);
  }

  async uploadAvatar(
    userId: string,
    input: {
      contentType: string;
      originalName: string;
      buffer: Buffer;
    }
  ) {
    const current = await appUserDAO.getById(userId);
    if (!current) {
      throw new Error('用户不存在');
    }
    const objectKey = managedImageObjectService.buildObjectKey({
      sessionId: `app-user-${userId}`,
      messageKey: 'avatar',
      attachmentName: input.originalName,
    });
    const previousAvatarStorageKey = asText((current as any).avatarStorageKey);
    await managedImageObjectService.uploadImage({
      objectKey,
      body: input.buffer,
      contentType: input.contentType,
      originalName: input.originalName,
    });
    const updated = await appUserDAO.updateAvatar(userId, {
      avatarUrl: null,
      avatarStorageKey: objectKey,
      avatarSource: 'manual',
      avatarUpdatedAt: new Date(),
    });
    if (!updated) {
      await managedImageObjectService.deleteImage(objectKey).catch(() => null);
      throw new Error('头像更新失败');
    }
    if (previousAvatarStorageKey && previousAvatarStorageKey !== objectKey) {
      await managedImageObjectService.deleteImage(previousAvatarStorageKey).catch(() => null);
    }
    return await toPublicUser(updated);
  }

  async removeAvatar(userId: string) {
    const current = await appUserDAO.getById(userId);
    if (!current) {
      throw new Error('用户不存在');
    }
    const previousAvatarStorageKey = asText((current as any).avatarStorageKey);
    const updated = await appUserDAO.updateAvatar(userId, {
      avatarUrl: null,
      avatarStorageKey: null,
      avatarSource: 'default',
      avatarUpdatedAt: new Date(),
    });
    if (!updated) {
      throw new Error('头像移除失败');
    }
    if (previousAvatarStorageKey) {
      await managedImageObjectService.deleteImage(previousAvatarStorageKey).catch(() => null);
    }
    return await toPublicUser(updated);
  }
}

export const appAuthService = new AppAuthService();
