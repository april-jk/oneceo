import { createHash } from 'node:crypto';
import type express from 'express';
import { appUserDAO, appUserSessionDAO } from '../db/dao';
import { createSessionToken, hashSessionToken, resolveSessionExpiry } from '../utils/auth-session';

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeEmail(value: unknown) {
  return asText(value).toLowerCase();
}

function normalizeProvider(value: string) {
  return asText(value).toLowerCase();
}

function buildFallbackEmail(provider: string, subject: string) {
  const digest = createHash('sha256').update(`${provider}:${subject}`).digest('hex').slice(0, 24);
  return `${provider}-${digest}@oauth.oneceo.local`;
}

export type AppOauthProvider = 'google' | 'github';

export type AppOauthProfile = {
  provider: AppOauthProvider;
  providerSubject: string;
  email?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
};

export class AppAuthOauthService {
  async resolveOrCreateUser(profile: AppOauthProfile, req?: express.Request) {
    const provider = normalizeProvider(profile.provider) as AppOauthProvider;
    const providerSubject = asText(profile.providerSubject);
    if (!providerSubject) {
      throw new Error('OAuth 授权缺少用户标识');
    }

    const existingByAccount = await appUserDAO.getByOauthAccount(provider, providerSubject);
    if (existingByAccount) {
      const nextDisplayName = asText(profile.displayName) || existingByAccount.displayName;
      if (nextDisplayName && nextDisplayName !== existingByAccount.displayName) {
        await appUserDAO.updateById(String(existingByAccount.id), {
          displayName: nextDisplayName,
        });
      }
      await appUserDAO.upsertOauthAccount({
        userId: String(existingByAccount.id),
        provider,
        providerSubject,
        providerEmail: normalizeEmail(profile.email),
        displayName: profile.displayName || null,
        avatarUrl: profile.avatarUrl || null,
      });
      return this.createSessionForUser(String(existingByAccount.id), req);
    }

    const email = normalizeEmail(profile.email) || buildFallbackEmail(provider, providerSubject);
    const displayName = asText(profile.displayName) || email.split('@')[0] || provider;
    const existingByEmail = await appUserDAO.getByEmail(email);
    if (existingByEmail) {
      await appUserDAO.upsertOauthAccount({
        userId: String(existingByEmail.id),
        provider,
        providerSubject,
        providerEmail: email,
        displayName,
        avatarUrl: profile.avatarUrl || null,
      });
      const nextUser =
        displayName !== existingByEmail.displayName
          ? await appUserDAO.updateById(String(existingByEmail.id), { displayName })
          : existingByEmail;
      return this.createSessionForUser(String(nextUser.id), req);
    }

    const created = await appUserDAO.createOauthUser({
      email,
      displayName,
      provider,
      providerSubject,
      providerEmail: profile.email || email,
      avatarUrl: profile.avatarUrl || null,
    });
    return this.createSessionForUser(String(created.id), req);
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
    return {
      token,
      session,
      user: await appUserDAO.getById(userId),
    };
  }
}

export const appAuthOauthService = new AppAuthOauthService();
