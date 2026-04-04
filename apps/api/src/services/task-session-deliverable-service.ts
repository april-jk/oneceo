import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { taskSessionDeliverableArtifactDAO } from '../db/dao';
import { e2bConnector } from '../connectors/e2b-connector';
import { uploadToR2 } from './r2-client';
import { isArchiveStorageConfigured } from './sandbox-archive-service';
import type { ManagedCompletionAttachment } from './altus-managed-shared';

export type TaskSessionDeliverableArtifactRecord = {
  id: string;
  sessionId: string;
  runId: string;
  path: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string | null;
};

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeRelativePath(rawPath: string): string {
  const normalized = rawPath.replace(/\\/g, '/').trim();
  if (!normalized || normalized.startsWith('/')) {
    throw new Error('deliverable_path_invalid');
  }
  const parts = normalized.split('/').filter(Boolean);
  if (!parts.length || parts.some((part) => part === '..')) {
    throw new Error('deliverable_path_invalid');
  }
  const cleaned = parts.filter((part) => part !== '.').join('/');
  if (!cleaned) {
    throw new Error('deliverable_path_invalid');
  }
  return cleaned;
}

function resolveMimeType(filePath: string, explicit?: string): string {
  const normalized = asText(explicit).toLowerCase();
  if (normalized) return normalized;
  const ext = path.posix.extname(filePath).toLowerCase().replace(/^\./, '');
  const map: Record<string, string> = {
    txt: 'text/plain',
    md: 'text/markdown',
    markdown: 'text/markdown',
    json: 'application/json',
    csv: 'text/csv',
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    zip: 'application/zip',
  };
  return map[ext] || 'application/octet-stream';
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function serializeRecord(record: Awaited<ReturnType<typeof taskSessionDeliverableArtifactDAO.getById>>) {
  if (!record) return null;
  return {
    id: record.id,
    sessionId: record.sessionId,
    runId: record.runId,
    path: record.sourcePath,
    name: record.displayName,
    mimeType: record.mimeType,
    sizeBytes: Number(record.sizeBytes || 0),
    sha256: record.sha256,
    createdAt: toIso(record.createdAt),
  } satisfies TaskSessionDeliverableArtifactRecord;
}

export class TaskSessionDeliverableService {
  private readonly posix = path.posix;

  private buildStorageKey(sessionId: string, runId: string, fileName: string) {
    return [
      'sessions',
      sessionId,
      'deliverables',
      runId,
      `${Date.now()}-${randomUUID()}-${encodeURIComponent(fileName)}`,
    ].join('/');
  }

  async persistManagedRunDeliverables(input: {
    sessionId: string;
    runId: string;
    sandboxId: string;
    workspaceRoot: string;
    attachments: ManagedCompletionAttachment[];
  }): Promise<TaskSessionDeliverableArtifactRecord[]> {
    if (!input.attachments.length) return [];
    if (!isArchiveStorageConfigured()) {
      throw new Error('deliverable_storage_unconfigured');
    }

    const uniqueAttachments: ManagedCompletionAttachment[] = [];
    const seenPaths = new Set<string>();
    for (const attachment of input.attachments) {
      const relativePath = normalizeRelativePath(asText(attachment.path));
      if (seenPaths.has(relativePath)) continue;
      seenPaths.add(relativePath);
      uniqueAttachments.push(attachment);
    }

    const preparedRecords = await Promise.all(
      uniqueAttachments.map(async (attachment) => {
        const relativePath = normalizeRelativePath(asText(attachment.path));
        const absolutePath = this.posix.join(input.workspaceRoot, relativePath);
        const bytes = Buffer.from(await e2bConnector.readFile(input.sandboxId, absolutePath));
        const displayName = asText(attachment.name) || this.posix.basename(relativePath);
        const mimeType = resolveMimeType(relativePath, attachment.mimeType);
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        const storageKey = this.buildStorageKey(input.sessionId, input.runId, displayName);

        await uploadToR2(storageKey, bytes);
        return {
          sessionId: input.sessionId,
          runId: input.runId,
          sandboxId: input.sandboxId,
          sourcePath: relativePath,
          displayName,
          mimeType,
          sizeBytes: bytes.length,
          sha256,
          storageKey,
        };
      })
    );

    const created = await taskSessionDeliverableArtifactDAO.createMany(preparedRecords);
    return created
      .map((item) => serializeRecord(item))
      .filter((item): item is TaskSessionDeliverableArtifactRecord => Boolean(item));
  }

  async listSessionDeliverables(sessionId: string, options?: { runId?: string | null }) {
    const records = await taskSessionDeliverableArtifactDAO.listBySession(sessionId, {
      runId: options?.runId || null,
    });
    return records
      .map((item) => serializeRecord(item))
      .filter((item): item is TaskSessionDeliverableArtifactRecord => Boolean(item));
  }

  async getSessionDeliverable(sessionId: string, artifactId: string) {
    const record = await taskSessionDeliverableArtifactDAO.getById(artifactId);
    if (!record || record.sessionId !== sessionId) {
      return null;
    }
    return record;
  }
}

export const taskSessionDeliverableService = new TaskSessionDeliverableService();
