import { createHash } from 'node:crypto';
import type express from 'express';
import { db } from '../config/database';
import { appUserDAO, appUserSessionDAO } from '../db/dao';
import { appUserBootstrapService } from './app-user-bootstrap-service';
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
  private resolveAvatarSourceByProvider(provider: AppOauthProvider) {
    return provider === 'google' ? 'oauth_google' : 'oauth_github';
  }

  private shouldSyncOauthAvatar(currentAvatarSource: unknown, incomingAvatarUrl: string) {
    const source = asText(currentAvatarSource).toLowerCase();
    if (!incomingAvatarUrl) return false;
    if (!source || source === 'default' || source === 'oauth_google' || source === 'oauth_github') {
      return true;
    }
    return false;
  }

  async resolveOrCreateUser(profile: AppOauthProfile, req?: express.Request) {
    const provider = normalizeProvider(profile.provider) as AppOauthProvider;
    const providerSubject = asText(profile.providerSubject);
    const oauthAvatarSource = this.resolveAvatarSourceByProvider(provider);
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
      const incomingAvatarUrl = asText(profile.avatarUrl);
      if (this.shouldSyncOauthAvatar((existingByAccount as any).avatarSource, incomingAvatarUrl)) {
        await appUserDAO.updateAvatar(String(existingByAccount.id), {
          avatarUrl: incomingAvatarUrl,
          avatarStorageKey: null,
          avatarSource: incomingAvatarUrl ? oauthAvatarSource : 'default',
          avatarUpdatedAt: new Date(),
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
    const bootstrapSource = provider === 'google' ? 'oauth_google_register' : 'oauth_github_register';
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
      const incomingAvatarUrl = asText(profile.avatarUrl);
      if (this.shouldSyncOauthAvatar((nextUser as any).avatarSource, incomingAvatarUrl)) {
        await appUserDAO.updateAvatar(String(nextUser.id), {
          avatarUrl: incomingAvatarUrl,
          avatarStorageKey: null,
          avatarSource: incomingAvatarUrl ? oauthAvatarSource : 'default',
          avatarUpdatedAt: new Date(),
        });
      }
      return this.createSessionForUser(String(nextUser.id), req);
    }

    const createdUserId = await db.transaction(async (trx) => {
      const created = await appUserDAO.createOauthUser({
        email,
        displayName,
        provider,
        providerSubject,
        providerEmail: profile.email || email,
        avatarUrl: profile.avatarUrl || null,
        avatarSource: profile.avatarUrl ? oauthAvatarSource : 'default',
        avatarStorageKey: null,
      }, trx);
      await appUserBootstrapService.bootstrapNewAppUser(
        String(created.id),
        bootstrapSource,
        trx
      );
      return String(created.id);
    });
    return this.createSessionForUser(createdUserId, req);
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
