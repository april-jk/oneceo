import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../config/database';
import {
  taskSessionWorkspaceCache,
  type NewTaskSessionWorkspaceCache,
} from '../schema';

export type WorkspaceCacheType = 'tree' | 'dir' | 'file';

let workspaceCacheTableWarningLogged = false;

export class TaskSessionWorkspaceCacheDAO {
  private isWorkspaceCacheTableUnavailable(error: unknown): boolean {
    const err = error as
      | {
          message?: unknown;
          query?: unknown;
          cause?: { message?: unknown; code?: unknown };
          code?: unknown;
        }
      | undefined;
    const messageParts = [
      error instanceof Error ? error.message : String(error),
      typeof err?.query === 'string' ? err.query : '',
      typeof err?.cause?.message === 'string' ? err.cause.message : '',
    ];
    const message = messageParts.join(' | ').toLowerCase();
    const code = typeof err?.code === 'string' ? err.code : typeof err?.cause?.code === 'string' ? err.cause.code : '';
    return (
      (code === '42P01' || message.includes('task_session_workspace_cache')) &&
      (
        message.includes('does not exist') ||
        message.includes('relation') ||
        message.includes('no such table')
      )
    );
  }

  private logWorkspaceCacheTableUnavailable(error: unknown): void {
    if (workspaceCacheTableWarningLogged) return;
    workspaceCacheTableWarningLogged = true;
    console.warn(
      '[workspace-cache] task_session_workspace_cache unavailable, codex workspace DB cache disabled until migration is applied',
      error instanceof Error ? error.message : String(error)
    );
  }

  async upsert(
    input: {
      sessionId: string;
      tenantKey: string;
      cacheType: WorkspaceCacheType;
      cacheKey: string;
      data: Record<string, unknown>;
    }
  ) {
    const payload: NewTaskSessionWorkspaceCache = {
      id: randomUUID(),
      sessionId: input.sessionId,
      tenantKey: input.tenantKey,
      cacheType: input.cacheType,
      cacheKey: input.cacheKey,
      data: input.data,
    };

    try {
      await db
        .insert(taskSessionWorkspaceCache)
        .values(payload)
        .onConflictDoUpdate({
          target: [
            taskSessionWorkspaceCache.sessionId,
            taskSessionWorkspaceCache.tenantKey,
            taskSessionWorkspaceCache.cacheType,
            taskSessionWorkspaceCache.cacheKey,
          ],
          set: {
            data: payload.data,
            updatedAt: new Date(),
          },
        });
    } catch (error) {
      if (this.isWorkspaceCacheTableUnavailable(error)) {
        this.logWorkspaceCacheTableUnavailable(error);
        return;
      }
      throw error;
    }
  }

  async get(
    input: {
      sessionId: string;
      tenantKey: string;
      cacheType: WorkspaceCacheType;
      cacheKey: string;
    }
  ) {
    try {
      const rows = await db
        .select()
        .from(taskSessionWorkspaceCache)
        .where(
          and(
            eq(taskSessionWorkspaceCache.sessionId, input.sessionId),
            eq(taskSessionWorkspaceCache.tenantKey, input.tenantKey),
            eq(taskSessionWorkspaceCache.cacheType, input.cacheType),
            eq(taskSessionWorkspaceCache.cacheKey, input.cacheKey),
          )
        )
        .orderBy(desc(taskSessionWorkspaceCache.updatedAt))
        .limit(1);

      return rows[0] || null;
    } catch (error) {
      if (this.isWorkspaceCacheTableUnavailable(error)) {
        this.logWorkspaceCacheTableUnavailable(error);
        return null;
      }
      throw error;
    }
  }
}

export const taskSessionWorkspaceCacheDAO = new TaskSessionWorkspaceCacheDAO();
