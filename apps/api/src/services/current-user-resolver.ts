import type express from 'express';

export type CurrentUserSource = 'auth_context' | 'x-user-id';

export type CurrentUserContext = {
  userId: string;
  source: CurrentUserSource;
  tenantKey: string;
};

function pickString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function pickFromObject(value: unknown, key: string): string {
  if (!value || typeof value !== 'object') return '';
  return pickString((value as Record<string, unknown>)[key]);
}

export class CurrentUserResolver {
  resolve(req: express.Request): CurrentUserContext | null {
    const explicitTenantKey = pickString(req.header('X-Tenant-Id') || req.query.tenantId);
    const authUser =
      pickFromObject((req as any).user, 'id') ||
      pickFromObject((req as any).user, 'userId') ||
      pickFromObject((req as any).auth, 'userId') ||
      pickFromObject((req as any).auth, 'id') ||
      pickFromObject((req as any).session, 'userId');
    if (authUser) {
      return {
        userId: authUser,
        source: 'auth_context',
        tenantKey: explicitTenantKey || authUser,
      };
    }

    const headerUser = pickString(req.header('X-User-Id'));
    if (headerUser) {
      return {
        userId: headerUser,
        source: 'x-user-id',
        tenantKey: explicitTenantKey || headerUser,
      };
    }

    return null;
  }

  require(req: express.Request): CurrentUserContext {
    const resolved = this.resolve(req);
    if (!resolved?.userId) {
      throw new Error('无法识别当前用户，请先登录或提供 X-User-Id');
    }
    return resolved;
  }
}

export const currentUserResolver = new CurrentUserResolver();
