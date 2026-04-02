import type express from 'express';
import { appUserDAO, appUserSessionDAO } from '../db/dao';
import { hashPassword, verifyPassword } from '../utils/auth-password';
import { createSessionToken, hashSessionToken, resolveSessionExpiry } from '../utils/auth-session';

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
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
  async register(input: { email: string; password: string; displayName: string }, req?: express.Request) {
    const email = asText(input.email).toLowerCase();
    const password = asText(input.password);
    const displayName = asText(input.displayName);
    if (!email || !email.includes('@')) {
      throw new Error('请输入有效邮箱');
    }
    if (password.length < 8) {
      throw new Error('密码长度不能少于 8 位');
    }
    if (!displayName) {
      throw new Error('显示名称不能为空');
    }
    const existing = await appUserDAO.getByEmail(email);
    if (existing) {
      throw new Error('该邮箱已注册');
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
