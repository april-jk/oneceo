import { randomUUID } from 'node:crypto';
import { platformSkillService } from './platform-skill-service';
import type { SkillImportPreview } from './platform-skill-import-service';

type ImportFileProgressState = 'pending' | 'processing' | 'success' | 'failed';

export type PlatformSkillImportJobSnapshot = {
  jobId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  createdAt: string;
  updatedAt: string;
  preview: SkillImportPreview;
  files: Array<{
    relativePath: string;
    storageTarget: 'database' | 'object_storage';
    processingState: ImportFileProgressState;
    error?: string | null;
  }>;
  result?: Awaited<ReturnType<typeof platformSkillService.importSkillFolder>> | null;
  error?: string | null;
};

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

class PlatformSkillImportJobService {
  private readonly jobs = new Map<string, PlatformSkillImportJobSnapshot>();

  async start(input: {
    rootFolderName?: string;
    files: Array<{ relativePath: string; content: string }>;
    createdBy?: string | null;
    skillId?: string | null;
  }) {
    const preview = platformSkillService.parseFolderImport({
      rootFolderName: input.rootFolderName,
      files: input.files,
    });
    const jobId = randomUUID();
    const now = new Date().toISOString();
    const snapshot: PlatformSkillImportJobSnapshot = {
      jobId,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      preview,
      files: preview.files.map((item) => ({
        relativePath: item.relativePath,
        storageTarget: item.storageTarget,
        processingState: 'pending',
        error: null,
      })),
      result: null,
      error: null,
    };
    this.jobs.set(jobId, snapshot);

    void this.run(jobId, input);
    return snapshot;
  }

  get(jobId: string) {
    return this.jobs.get(asText(jobId)) || null;
  }

  private updateFileState(jobId: string, relativePath: string, processingState: ImportFileProgressState, error?: string | null) {
    const current = this.jobs.get(jobId);
    if (!current) return;
    current.files = current.files.map((item) =>
      item.relativePath === relativePath
        ? { ...item, processingState, error: error || null }
        : item
    );
    current.updatedAt = new Date().toISOString();
    this.jobs.set(jobId, current);
  }

  private updateJob(jobId: string, patch: Partial<PlatformSkillImportJobSnapshot>) {
    const current = this.jobs.get(jobId);
    if (!current) return;
    const next: PlatformSkillImportJobSnapshot = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.jobs.set(jobId, next);
  }

  private async run(
    jobId: string,
    input: {
      rootFolderName?: string;
      files: Array<{ relativePath: string; content: string }>;
      createdBy?: string | null;
      skillId?: string | null;
    }
  ) {
    this.updateJob(jobId, { status: 'running' });
    try {
      const result = await platformSkillService.importSkillFolder({
        ...input,
        onFileProgress: (event) => {
          this.updateFileState(jobId, event.relativePath, event.processingState, event.error || null);
        },
      });
      this.updateJob(jobId, { status: 'completed', result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const current = this.jobs.get(jobId);
      if (current) {
        current.files = current.files.map((item) =>
          item.processingState === 'success' ? item : { ...item, processingState: 'failed', error: item.error || message }
        );
      }
      this.updateJob(jobId, { status: 'failed', error: message });
    }
  }
}

export const platformSkillImportJobService = new PlatformSkillImportJobService();
