import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import type { AuditLogEntry } from '../types';

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

  async list(limit = 50) {
    const entries = await this.readAll();
    return entries.slice(0, Math.max(1, Math.min(limit, 500)));
  }
}