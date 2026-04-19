import type express from 'express';
import { randomInt } from 'node:crypto';
import { appUserDAO, appUserEmailVerificationDAO, appUserSessionDAO } from '../db/dao';
import { appAuthEmailService } from './app-auth-email-service';
import { hashPassword, verifyPassword } from '../utils/auth-password';
import { createSessionToken, hashSessionToken, resolveSessionExpiry } from '../utils/auth-session';

const REGISTER_VERIFICATION_PURPOSE = 'register';
const DEFAULT_REGISTER_CODE_LENGTH = 6;
const DEFAULT_REGISTER_CODE_TTL_SECONDS = 10 * 60;
const DEFAULT_REGISTER_CODE_RESEND_COOLDOWN_SECONDS = 60;

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

function generateVerificationCode(length = DEFAULT_REGISTER_CODE_LENGTH) {
  const max = 10 ** length;
  return String(randomInt(0, max)).padStart(length, '0');
}

function toPublicUser(user: Awaited<ReturnType<typeof appUserDAO.getById>>) {
  if (!user) return null;
  return {
    id: String(user.id),
    email: user.email,
    displayName: user.displayName,
    status: user.status,
    createdAt: user.createdAt?.toISOString?.() || new Date().toISOString(),
    updatedAt: user.updatedAt?.toISOString?.() || new Date().toISOString(),
  };
}

export class AppAuthService {
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
    if (!verificationCode) {
      throw new Error('请输入邮箱验证码');
    }
    const existing = await appUserDAO.getByEmail(email);
    if (existing) {
      throw new Error('该邮箱已注册');
    }
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
    const consumed = await appUserEmailVerificationDAO.markConsumed(String(verification.id));
    if (!consumed) {
      throw new Error('验证码已失效，请重新获取');
    }
    const created = await appUserDAO.create({
      email,
      passwordHash: await hashPassword(password),
      displayName,
    });
    return this.createSessionForUser(String(created.id), req);
  }

  async login(input: { email: string; password: string }, req?: express.Request) {
    const email = asText(input.email).toLowerCase();
    const password = asText(input.password);
    const user = await appUserDAO.getByEmail(email);
    if (!user || user.status !== 'active') {
      throw new Error('邮箱或密码错误');
    }
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
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
      user: toPublicUser(user),
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
      user: toPublicUser(user),
    };
  }

  async logout(sessionToken: string) {
    if (!asText(sessionToken)) return;
    await appUserSessionDAO.revokeByTokenHash(hashSessionToken(sessionToken));
  }
}

export const appAuthService = new AppAuthService();
