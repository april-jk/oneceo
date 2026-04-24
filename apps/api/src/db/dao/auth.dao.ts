import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { db } from '../../config/database';
import {
  adminUserSessions,
  adminUsers,
  appUserEmailVerifications,
  appUserSessions,
  appUsers,
} from '../schema';

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function normalizeLoginName(value: string) {
  return value.trim().toLowerCase();
}

class AppUserDAO {
  async create(input: {
    email: string;
    passwordHash: string;
    displayName: string;
    profileJson?: Record<string, unknown>;
  }) {
    const [created] = await db
      .insert(appUsers)
      .values({
        email: normalizeEmail(input.email),
        passwordHash: input.passwordHash,
        displayName: input.displayName.trim(),
        profileJson: input.profileJson || {},
      })
      .returning();
    return created;
  }

  async getByEmail(email: string) {
    const [record] = await db.select().from(appUsers).where(eq(appUsers.email, normalizeEmail(email)));
    return record;
  }

  async getById(id: string) {
    const [record] = await db.select().from(appUsers).where(eq(appUsers.id, id as any));
    return record;
  }

  async updateById(
    id: string,
    input: {
      passwordHash?: string;
      displayName?: string;
      profileJson?: Record<string, unknown>;
      status?: string;
    }
  ) {
    const nextValues: Record<string, unknown> = {
      updatedAt: new Date(),
    };
    if (typeof input.passwordHash === 'string' && input.passwordHash.trim()) {
      nextValues.passwordHash = input.passwordHash;
    }
    if (typeof input.displayName === 'string' && input.displayName.trim()) {
      nextValues.displayName = input.displayName.trim();
    }
    if (input.profileJson && typeof input.profileJson === 'object' && !Array.isArray(input.profileJson)) {
      nextValues.profileJson = input.profileJson;
    }
    if (typeof input.status === 'string' && input.status.trim()) {
      nextValues.status = input.status.trim();
    }
    const [updated] = await db
      .update(appUsers)
      .set(nextValues)
      .where(eq(appUsers.id, id as any))
      .returning();
    return updated;
  }

  async touchLastLogin(id: string) {
    const [updated] = await db
      .update(appUsers)
      .set({ lastLoginAt: new Date(), updatedAt: new Date() })
      .where(eq(appUsers.id, id as any))
      .returning();
    return updated;
  }
}

class AppUserSessionDAO {
  async create(input: {
    userId: string;
    sessionTokenHash: string;
    expiresAt: Date;
    userAgent?: string | null;
    ipAddress?: string | null;
  }) {
    const [created] = await db
      .insert(appUserSessions)
      .values({
        userId: input.userId as any,
        sessionTokenHash: input.sessionTokenHash,
        expiresAt: input.expiresAt,
        userAgent: input.userAgent || null,
        ipAddress: input.ipAddress || null,
      })
      .returning();
    return created;
  }

  async getActiveByTokenHash(sessionTokenHash: string) {
    const [record] = await db
      .select()
      .from(appUserSessions)
      .where(
        and(
          eq(appUserSessions.sessionTokenHash, sessionTokenHash),
          isNull(appUserSessions.revokedAt),
          gt(appUserSessions.expiresAt, new Date())
        )
      );
    return record;
  }

  async revokeByTokenHash(sessionTokenHash: string) {
    const [updated] = await db
      .update(appUserSessions)
      .set({
        revokedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(appUserSessions.sessionTokenHash, sessionTokenHash))
      .returning();
    return updated;
  }

  async touch(id: string) {
    const [updated] = await db
      .update(appUserSessions)
      .set({
        lastSeenAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(appUserSessions.id, id as any))
      .returning();
    return updated;
  }

  async getLatestByUserId(userId: string) {
    const [record] = await db
      .select()
      .from(appUserSessions)
      .where(eq(appUserSessions.userId, userId as any))
      .orderBy(desc(appUserSessions.lastSeenAt), desc(appUserSessions.createdAt))
      .limit(1);
    return record || null;
  }
}

class AppUserEmailVerificationDAO {
  async getByEmailAndPurpose(email: string, purpose: string) {
    const [record] = await db
      .select()
      .from(appUserEmailVerifications)
      .where(
        and(
          eq(appUserEmailVerifications.email, normalizeEmail(email)),
          eq(appUserEmailVerifications.purpose, purpose.trim())
        )
      );
    return record || null;
  }

  async upsert(input: {
    email: string;
    purpose: string;
    codeHash: string;
    expiresAt: Date;
    lastSentAt: Date;
  }) {
    const [record] = await db
      .insert(appUserEmailVerifications)
      .values({
        email: normalizeEmail(input.email),
        purpose: input.purpose.trim(),
        codeHash: input.codeHash,
        expiresAt: input.expiresAt,
        consumedAt: null,
        lastSentAt: input.lastSentAt,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [appUserEmailVerifications.email, appUserEmailVerifications.purpose],
        set: {
          codeHash: input.codeHash,
          expiresAt: input.expiresAt,
          consumedAt: null,
          lastSentAt: input.lastSentAt,
          updatedAt: new Date(),
        },
      })
      .returning();
    return record;
  }

  async markConsumed(id: string) {
    const [record] = await db
      .update(appUserEmailVerifications)
      .set({
        consumedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(appUserEmailVerifications.id, id as any),
          isNull(appUserEmailVerifications.consumedAt),
          gt(appUserEmailVerifications.expiresAt, new Date())
        )
      )
      .returning();
    return record || null;
  }

  async deleteByEmailAndPurpose(email: string, purpose: string) {
    const [record] = await db
      .delete(appUserEmailVerifications)
      .where(
        and(
          eq(appUserEmailVerifications.email, normalizeEmail(email)),
          eq(appUserEmailVerifications.purpose, purpose.trim())
        )
      )
      .returning();
    return record || null;
  }
}

class AdminUserDAO {
  async listAll() {
    return db.select().from(adminUsers);
  }

  async create(input: { loginName: string; passwordHash: string; displayName: string; role: string }) {
    const [created] = await db
      .insert(adminUsers)
      .values({
        loginName: normalizeLoginName(input.loginName),
        passwordHash: input.passwordHash,
        displayName: input.displayName.trim(),
        role: input.role,
      })
      .returning();
    return created;
  }

  async getByLoginName(loginName: string) {
    const [record] = await db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.loginName, normalizeLoginName(loginName)));
    return record;
  }

  async getById(id: string) {
    const [record] = await db.select().from(adminUsers).where(eq(adminUsers.id, id as any));
    return record;
  }

  async touchLastLogin(id: string) {
    const [updated] = await db
      .update(adminUsers)
      .set({ lastLoginAt: new Date(), updatedAt: new Date() })
      .where(eq(adminUsers.id, id as any))
      .returning();
    return updated;
  }
}

class AdminUserSessionDAO {
  async create(input: {
    adminUserId: string;
    sessionTokenHash: string;
    expiresAt: Date;
    userAgent?: string | null;
    ipAddress?: string | null;
  }) {
    const [created] = await db
      .insert(adminUserSessions)
      .values({
        adminUserId: input.adminUserId as any,
        sessionTokenHash: input.sessionTokenHash,
        expiresAt: input.expiresAt,
        userAgent: input.userAgent || null,
        ipAddress: input.ipAddress || null,
      })
      .returning();
    return created;
  }

  async getActiveByTokenHash(sessionTokenHash: string) {
    const [record] = await db
      .select()
      .from(adminUserSessions)
      .where(
        and(
          eq(adminUserSessions.sessionTokenHash, sessionTokenHash),
          isNull(adminUserSessions.revokedAt),
          gt(adminUserSessions.expiresAt, new Date())
        )
      );
    return record;
  }

  async revokeByTokenHash(sessionTokenHash: string) {
    const [updated] = await db
      .update(adminUserSessions)
      .set({
        revokedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(adminUserSessions.sessionTokenHash, sessionTokenHash))
      .returning();
    return updated;
  }

  async touch(id: string) {
    const [updated] = await db
      .update(adminUserSessions)
      .set({
        lastSeenAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(adminUserSessions.id, id as any))
      .returning();
    return updated;
  }
}

export const appUserDAO = new AppUserDAO();
export const appUserSessionDAO = new AppUserSessionDAO();
export const appUserEmailVerificationDAO = new AppUserEmailVerificationDAO();
export const adminUserDAO = new AdminUserDAO();
export const adminUserSessionDAO = new AdminUserSessionDAO();
