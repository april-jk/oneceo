import type express from 'express';
import { adminUserDAO, adminUserSessionDAO } from '../db/dao';
import { hashPassword, verifyPassword } from '../utils/auth-password';
import { createSessionToken, hashSessionToken, resolveSessionExpiry } from '../utils/auth-session';

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

const DEFAULT_ADMIN_LOGIN = 'admin66';

function resolveBootstrapAdminPassword() {
  const password = asText(process.env.ONECEO_ADMIN_BOOTSTRAP_PASSWORD);
  if (!password) {
    throw new Error('ONECEO_ADMIN_BOOTSTRAP_PASSWORD is required to bootstrap admin credentials');
  }
  return password;
}

function toPublicAdmin(admin: Awaited<ReturnType<typeof adminUserDAO.getById>>) {
  if (!admin) return null;
  return {
    id: String(admin.id),
    loginName: admin.loginName,
    displayName: admin.displayName,
    role: admin.role,
    status: admin.status,
    createdAt: admin.createdAt?.toISOString?.() || new Date().toISOString(),
    updatedAt: admin.updatedAt?.toISOString?.() || new Date().toISOString(),
  };
}

export class AdminAuthService {
  async ensureBootstrapAdmin() {
    const loginName = DEFAULT_ADMIN_LOGIN;
    const password = resolveBootstrapAdminPassword();
    const existing = await adminUserDAO.listAll();
    if (existing.length > 0) {
      const targetLoginName = loginName.toLowerCase();
      const targetAdmin = existing.find((admin) => admin.loginName === targetLoginName);
      const legacyBootstrapAdmin = existing.find(
        (admin) =>
          admin.loginName === 'admin' &&
          admin.displayName === 'Platform Admin' &&
          admin.role === 'super_admin'
      );
      if (targetAdmin) {
        await adminUserDAO.updateBootstrapCredentials(String(targetAdmin.id), {
          loginName,
          passwordHash: await hashPassword(password),
        });
        console.warn('[ADMIN_AUTH_BOOTSTRAP_PASSWORD_SYNCED]', { loginName });
      } else if (legacyBootstrapAdmin) {
        await adminUserDAO.updateBootstrapCredentials(String(legacyBootstrapAdmin.id), {
          loginName,
          passwordHash: await hashPassword(password),
        });
        console.warn('[ADMIN_AUTH_BOOTSTRAP_UPDATED]', { fromLoginName: 'admin', loginName });
      }
      return;
    }
    const displayName = asText(process.env.ONECEO_ADMIN_BOOTSTRAP_DISPLAY_NAME) || 'Platform Admin';
    const role = asText(process.env.ONECEO_ADMIN_BOOTSTRAP_ROLE) || 'super_admin';
    await adminUserDAO.create({
      loginName,
      passwordHash: await hashPassword(password),
      displayName,
      role,
    });
    console.warn('[ADMIN_AUTH_BOOTSTRAP_CREATED]', { loginName, displayName, role });
  }

  async login(input: { loginName: string; password: string }, req?: express.Request) {
    const loginName = asText(input.loginName).toLowerCase();
    const password = asText(input.password);
    const admin = await adminUserDAO.getByLoginName(loginName);
    if (!admin || admin.status !== 'active') {
      throw new Error('管理员账号或密码错误');
    }
    const ok = await verifyPassword(password, admin.passwordHash);
    if (!ok) {
      throw new Error('管理员账号或密码错误');
    }
    return this.createSessionForAdmin(String(admin.id), req);
  }

  async createSessionForAdmin(adminUserId: string, req?: express.Request) {
    const token = createSessionToken();
    const session = await adminUserSessionDAO.create({
      adminUserId,
      sessionTokenHash: hashSessionToken(token),
      expiresAt: resolveSessionExpiry(),
      userAgent: req?.headers['user-agent'] || null,
      ipAddress: (req?.headers['x-forwarded-for'] as string) || req?.socket.remoteAddress || null,
    });
    await adminUserDAO.touchLastLogin(adminUserId);
    const admin = await adminUserDAO.getById(adminUserId);
    return {
      token,
      session,
      adminUser: toPublicAdmin(admin),
    };
  }

  async resolveAdminBySessionToken(sessionToken: string) {
    const hashed = hashSessionToken(asText(sessionToken));
    const session = await adminUserSessionDAO.getActiveByTokenHash(hashed);
    if (!session) return null;
    await adminUserSessionDAO.touch(String(session.id)).catch(() => null);
    const admin = await adminUserDAO.getById(String(session.adminUserId));
    if (!admin || admin.status !== 'active') {
      return null;
    }
    return {
      session,
      adminUser: toPublicAdmin(admin),
    };
  }

  async logout(sessionToken: string) {
    if (!asText(sessionToken)) return;
    await adminUserSessionDAO.revokeByTokenHash(hashSessionToken(sessionToken));
  }
}

export const adminAuthService = new AdminAuthService();
