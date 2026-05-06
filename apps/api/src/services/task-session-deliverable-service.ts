import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { taskSessionDeliverableArtifactDAO } from '../db/dao';
import { e2bConnector } from '../connectors/e2b-connector';
import { uploadToR2 } from './r2-client';
import { isArchiveStorageConfigured } from './sandbox-archive-service';
import type { ManagedCompletionAttachment } from './altus-managed-shared';
import { officeArtifactQualityService, type OfficeArtifactKind } from './office-artifact-quality-service';

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
    tar: 'application/x-tar',
    gz: 'application/gzip',
    tgz: 'application/gzip',
    zip: 'application/zip',
  };
  return map[ext] || 'application/octet-stream';
}

function resolveOfficeArtifactKind(filePath: string, mimeType: string): OfficeArtifactKind | null {
  const normalizedMime = mimeType.toLowerCase();
  const ext = path.posix.extname(filePath).toLowerCase();
  if (ext === '.docx' || normalizedMime.includes('wordprocessingml.document')) return 'docx';
  if (ext === '.xlsx' || normalizedMime.includes('spreadsheetml.sheet')) return 'xlsx';
  return null;
}

function shellEscape(value: string): string {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function normalizeDirectoryArchiveName(relativePath: string, explicitName?: string): string {
  const rawName = asText(explicitName) || path.posix.basename(relativePath);
  if (!rawName) return 'deliverable.tar.gz';
  if (/\.tar\.gz$/i.test(rawName)) return rawName;
  return rawName.replace(/\.(zip|tar|tgz|gz)$/i, '') + '.tar.gz';
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function isBlockingOfficeQualityError(errorCode: string): boolean {
  const code = asText(errorCode);
  if (!code) return false;
  if (code.startsWith('docx_unreadable:') || code.startsWith('xlsx_unreadable:')) return true;
  return [
    'docx_extension_invalid',
    'docx_file_too_small',
    'docx_document_xml_missing',
    'xlsx_extension_invalid',
    'xlsx_file_too_small',
    'xlsx_workbook_xml_missing',
    'xlsx_worksheet_missing',
  ].includes(code);
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

  protected async uploadDeliverable(storageKey: string, bytes: Buffer): Promise<void> {
    await uploadToR2(storageKey, bytes);
  }

  private async isDirectoryAttachment(sandboxId: string, absolutePath: string): Promise<boolean> {
    const result = await e2bConnector.runCommand(
      sandboxId,
      `if [ -d ${shellEscape(absolutePath)} ]; then printf 'directory'; else printf 'file'; fi`,
      { timeoutMs: 20_000 },
    );
    return asText(result?.stdout) === 'directory';
  }

  private async readDirectoryArchive(input: {
    sandboxId: string;
    workspaceRoot: string;
    relativePath: string;
  }): Promise<Uint8Array> {
    const archivePath = `/tmp/oneceo-deliverable-${randomUUID()}.tar.gz`;
    try {
      await e2bConnector.runCommand(
        input.sandboxId,
        [
          `rm -f ${shellEscape(archivePath)}`,
          `tar -czf ${shellEscape(archivePath)} -C ${shellEscape(input.workspaceRoot)} ${shellEscape(input.relativePath)}`,
        ].join(' && '),
        { timeoutMs: 120_000 },
      );
      return await e2bConnector.readFile(input.sandboxId, archivePath);
    } finally {
      await e2bConnector
        .runCommand(input.sandboxId, `rm -f ${shellEscape(archivePath)}`, { timeoutMs: 20_000 })
        .catch(() => undefined);
    }
  }

  private async readOfficeManifest(input: {
    sandboxId: string;
    workspaceRoot: string;
    relativePath: string;
    kind: OfficeArtifactKind;
  }): Promise<{ manifestPath: string; manifestBytes: Buffer | null }> {
    const manifestPath = officeArtifactQualityService.resolveManifestRelativePath(input.relativePath, input.kind);
    const absoluteManifestPath = this.posix.join(input.workspaceRoot, manifestPath);
    try {
      return {
        manifestPath,
        manifestBytes: Buffer.from(await e2bConnector.readFile(input.sandboxId, absoluteManifestPath)),
      };
    } catch {
      return { manifestPath, manifestBytes: null };
    }
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
        const isDirectory = await this.isDirectoryAttachment(input.sandboxId, absolutePath);
        const bytes = Buffer.from(
          isDirectory
            ? await this.readDirectoryArchive({
                sandboxId: input.sandboxId,
                workspaceRoot: input.workspaceRoot,
                relativePath,
              })
            : await e2bConnector.readFile(input.sandboxId, absolutePath),
        );
        const displayName = isDirectory
          ? normalizeDirectoryArchiveName(relativePath, attachment.name)
          : asText(attachment.name) || this.posix.basename(relativePath);
        const mimeType = isDirectory
          ? 'application/gzip'
          : resolveMimeType(relativePath, attachment.mimeType);
        const officeKind = isDirectory ? null : resolveOfficeArtifactKind(relativePath, mimeType);
        if (officeKind) {
          const manifest = await this.readOfficeManifest({
            sandboxId: input.sandboxId,
            workspaceRoot: input.workspaceRoot,
            relativePath,
            kind: officeKind,
          });
          const qualityReport = officeArtifactQualityService.validateOfficeArtifact({
            kind: officeKind,
            artifactPath: relativePath,
            bytes,
            manifestPath: manifest.manifestPath,
            manifestBytes: manifest.manifestBytes,
          });
          const blockingErrors = qualityReport.errors.filter((code) => isBlockingOfficeQualityError(code));
          const advisoryErrors = qualityReport.errors.filter((code) => !isBlockingOfficeQualityError(code));
          if (blockingErrors.length > 0) {
            throw new Error(
              `office_deliverable_quality_failed:${JSON.stringify({
                ...qualityReport,
                errors: blockingErrors,
                advisoryErrors,
              })}`,
            );
          }
          if (advisoryErrors.length > 0 || qualityReport.warnings.length > 0) {
            console.warn('[OFFICE_DELIVERABLE_QUALITY_WARNING]', JSON.stringify(qualityReport));
          }
        }
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        const storageKey = this.buildStorageKey(input.sessionId, input.runId, displayName);

        await this.uploadDeliverable(storageKey, bytes);
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
