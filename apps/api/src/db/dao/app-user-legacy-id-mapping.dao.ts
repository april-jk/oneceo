import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../../config/database';
import { appUserLegacyIdMappings, type NewAppUserLegacyIdMapping } from '../schema';
import { isCanonicalAppUserId, isLegacyClientUserId, normalizeUserId } from '../../utils/user-id';

function asSource(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || 'auth_bootstrap';
}

class AppUserLegacyIdMappingDAO {
  async upsert(input: { appUserId: string; legacyUserId: string; source?: string }) {
    const appUserId = normalizeUserId(input.appUserId);
    const legacyUserId = normalizeUserId(input.legacyUserId);
    if (!isCanonicalAppUserId(appUserId) || !isLegacyClientUserId(legacyUserId)) {
      return null;
    }

    const now = new Date();
    const payload: NewAppUserLegacyIdMapping = {
      appUserId: appUserId as any,
      legacyUserId,
      source: asSource(input.source),
      firstSeenAt: now,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    };

    const [row] = await db
      .insert(appUserLegacyIdMappings)
      .values(payload)
      .onConflictDoUpdate({
        target: appUserLegacyIdMappings.legacyUserId,
        set: {
          appUserId: appUserId as any,
          source: asSource(input.source),
          lastSeenAt: now,
          updatedAt: now,
        },
      })
      .returning();

    return row || null;
  }

  async listLegacyIdsByAppUserId(appUserId: string, limit = 50): Promise<string[]> {
    const normalized = normalizeUserId(appUserId);
    if (!isCanonicalAppUserId(normalized)) return [];
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(Math.floor(limit), 500)) : 50;
    const rows = await db
      .select({ legacyUserId: appUserLegacyIdMappings.legacyUserId })
      .from(appUserLegacyIdMappings)
      .where(eq(appUserLegacyIdMappings.appUserId, normalized as any))
      .orderBy(appUserLegacyIdMappings.lastSeenAt)
      .limit(safeLimit);
    return rows
      .map((item) => normalizeUserId(item.legacyUserId))
      .filter((item) => isLegacyClientUserId(item));
  }

  async resolveAppUserIdByLegacyUserId(legacyUserId: string): Promise<string | null> {
    const normalizedLegacy = normalizeUserId(legacyUserId);
    if (!isLegacyClientUserId(normalizedLegacy)) return null;
    const [row] = await db
      .select({ appUserId: appUserLegacyIdMappings.appUserId })
      .from(appUserLegacyIdMappings)
      .where(eq(appUserLegacyIdMappings.legacyUserId, normalizedLegacy))
      .limit(1);
    const appUserId = normalizeUserId(String(row?.appUserId || ''));
    return isCanonicalAppUserId(appUserId) ? appUserId : null;
  }

  async listMappingsForLegacyIds(legacyUserIds: string[]) {
    const normalizedLegacyIds = Array.from(
      new Set(legacyUserIds.map((item) => normalizeUserId(item)).filter((item) => isLegacyClientUserId(item)))
    );
    if (normalizedLegacyIds.length === 0) return [];
    return db
      .select()
      .from(appUserLegacyIdMappings)
      .where(inArray(appUserLegacyIdMappings.legacyUserId, normalizedLegacyIds));
  }

  async removeByLegacyUserId(legacyUserId: string) {
    const normalizedLegacy = normalizeUserId(legacyUserId);
    if (!isLegacyClientUserId(normalizedLegacy)) return null;
    const [deleted] = await db
      .delete(appUserLegacyIdMappings)
      .where(eq(appUserLegacyIdMappings.legacyUserId, normalizedLegacy))
      .returning();
    return deleted || null;
  }

  async removeByAppUserAndLegacyUserId(appUserId: string, legacyUserId: string) {
    const normalizedUserId = normalizeUserId(appUserId);
    const normalizedLegacy = normalizeUserId(legacyUserId);
    if (!isCanonicalAppUserId(normalizedUserId) || !isLegacyClientUserId(normalizedLegacy)) return null;
    const [deleted] = await db
      .delete(appUserLegacyIdMappings)
      .where(
        and(
          eq(appUserLegacyIdMappings.appUserId, normalizedUserId as any),
          eq(appUserLegacyIdMappings.legacyUserId, normalizedLegacy)
        )
      )
      .returning();
    return deleted || null;
  }
}

export const appUserLegacyIdMappingDAO = new AppUserLegacyIdMappingDAO();
