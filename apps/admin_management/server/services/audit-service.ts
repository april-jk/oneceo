import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import type { AuditLogEntry } from '../types';
import { AppError } from '../utils/errors';

const AUDIT_LOG_PATH = path.resolve(process.cwd(), 'data', 'audit-log.json');

async function ensureAuditFile() {
  try {
    await fs.access(AUDIT_LOG_PATH);
  } catch {
    await fs.mkdir(path.dirname(AUDIT_LOG_PATH), { recursive: true });
    await fs.writeFile(AUDIT_LOG_PATH, '[]', 'utf8');
  }
}

export class AuditService {
  private async readAll(): Promise<AuditLogEntry[]> {
    await ensureAuditFile();
    const raw = await fs.readFile(AUDIT_LOG_PATH, 'utf8');

    try {
      const parsed = JSON.parse(raw) as AuditLogEntry[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private async writeAll(entries: AuditLogEntry[]) {
    await fs.writeFile(AUDIT_LOG_PATH, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
  }

  async append(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>) {
    const entries = await this.readAll();
    const next: AuditLogEntry = {
      id: `audit-${randomUUID().slice(0, 12)}`,
      timestamp: new Date().toISOString(),
      ...entry,
    };

    entries.unshift(next);
    await this.writeAll(entries.slice(0, 2000));
    return next;
  }

  async list(limit: number): Promise<AuditLogEntry[]>;
  async list(query?: {
    query?: string;
    operator?: string;
    action?: string;
    result?: string;
    sessionId?: string;
    targetVmId?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  }): Promise<{
    total: number;
    filteredTotal: number;
    limit: number;
    offset: number;
    entries: AuditLogEntry[];
    availableOperators: string[];
    availableActions: string[];
    availableTargets: string[];
  }>;
  async list(
    queryOrLimit:
      | number
      | {
          query?: string;
          operator?: string;
          action?: string;
          result?: string;
          sessionId?: string;
          targetVmId?: string;
          from?: string;
          to?: string;
          limit?: number;
          offset?: number;
        } = {}
  ) {
    const entries = await this.readAll();
    const legacyLimit = typeof queryOrLimit === 'number' ? queryOrLimit : null;
    const query = typeof queryOrLimit === 'number' ? { limit: queryOrLimit } : queryOrLimit;
    const limit = Math.max(1, Math.min(query.limit ?? 50, 500));
    const offset = Math.max(0, query.offset ?? 0);
    const searchText = `${query.query || ''}`.trim().toLowerCase();
    const operator = `${query.operator || ''}`.trim().toLowerCase();
    const action = `${query.action || ''}`.trim().toLowerCase();
    const result = `${query.result || ''}`.trim().toLowerCase();
    const sessionId = `${query.sessionId || ''}`.trim().toLowerCase();
    const targetVmId = `${query.targetVmId || ''}`.trim().toLowerCase();
    const fromTimestamp = query.from ? Date.parse(query.from) : Number.NaN;
    const toTimestamp = query.to ? Date.parse(query.to) : Number.NaN;

    const filtered = entries.filter((entry) => {
      const entryTimestamp = Date.parse(entry.timestamp);
      if (Number.isFinite(fromTimestamp) && (!Number.isFinite(entryTimestamp) || entryTimestamp < fromTimestamp)) {
        return false;
      }
      if (Number.isFinite(toTimestamp) && (!Number.isFinite(entryTimestamp) || entryTimestamp > toTimestamp)) {
        return false;
      }
      if (operator && !entry.operator.toLowerCase().includes(operator)) {
        return false;
      }
      if (action && !entry.action.toLowerCase().includes(action)) {
        return false;
      }
      if (result && entry.result.toLowerCase() !== result) {
        return false;
      }
      if (sessionId && !(entry.sessionId || '').toLowerCase().includes(sessionId)) {
        return false;
      }
      if (targetVmId && !entry.targetVmId.toLowerCase().includes(targetVmId)) {
        return false;
      }
      if (!searchText) {
        return true;
      }

      const haystack = [
        entry.id,
        entry.operator,
        entry.action,
        entry.targetVmId,
        entry.sessionId || '',
        entry.result,
        entry.detail || '',
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(searchText);
    });

    const response = {
      total: entries.length,
      filteredTotal: filtered.length,
      limit,
      offset,
      entries: filtered.slice(offset, offset + limit),
      availableOperators: Array.from(new Set(entries.map((entry) => entry.operator))).sort(),
      availableActions: Array.from(new Set(entries.map((entry) => entry.action))).sort(),
      availableTargets: Array.from(new Set(entries.map((entry) => entry.targetVmId))).sort().slice(0, 50),
    };

    if (legacyLimit !== null) {
      return response.entries;
    }

    return response;
  }

  async getDetail(auditId: string) {
    const entries = await this.readAll();
    const entry = entries.find((item) => item.id === auditId);
    if (!entry) {
      throw new AppError(404, `审计日志不存在: ${auditId}`);
    }

    const relatedEntries = entries
      .filter((item) => {
        if (item.id === entry.id) return false;
        if (entry.sessionId && item.sessionId === entry.sessionId) return true;
        return item.targetVmId === entry.targetVmId;
      })
      .slice(0, 8);

    return {
      entry,
      relatedEntries,
    };
  }
}
