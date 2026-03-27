import { randomUUID } from 'node:crypto';
import { taskSessionRunDAO } from '../db/dao';
import { e2bConnector } from '../connectors/e2b-connector';
import { touchSandbox } from './sandbox-activity-service';
import { altusManagedRunService, type AltusManagedRunService } from './altus-managed-run-service';
import { AltusManagedSetupService, altusManagedSetupService } from './altus-managed-setup-service';
import {
  appendAttachmentReferencesToContent,
  buildAttachmentContextRecords,
  createStoredAttachmentRecords,
  normalizeAttachmentUploads,
  TASK_ATTACHMENT_DIR,
  type TaskAttachmentRecord,
  type TaskAttachmentUpload,
} from './task-attachment-service';
import { asText, pickObject } from './altus-managed-shared';

type SubmitManagedInput = {
  sessionId?: string;
  content?: string;
  messageKey?: string;
  metadata?: Record<string, unknown>;
  files?: TaskAttachmentUpload[];
};

type SubmitManagedInputResult = {
  sessionId: string;
  run: Awaited<ReturnType<AltusManagedRunService['startRun']>>;
  attachments: TaskAttachmentRecord[];
};

function shellEscape(value: string): string {
  if (!value) return "''";
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

export class AltusManagedInputService {
  constructor(
    private readonly setupService: AltusManagedSetupService = altusManagedSetupService,
    private readonly runService: AltusManagedRunService = altusManagedRunService,
    private readonly touchSandboxFn: typeof touchSandbox = touchSandbox
  ) {}

  async submit(userId: string, input: SubmitManagedInput): Promise<SubmitManagedInputResult> {
    const sessionId = asText(input.sessionId) || randomUUID();
    const normalizedUploads = normalizeAttachmentUploads(Array.isArray(input.files) ? input.files : []);
    const content = asText(input.content);
    if (!content && normalizedUploads.length === 0) {
      throw new Error('消息内容不能为空');
    }

    await this.setupService.ensureSessionOwnership(sessionId, userId);
    const activeRun = await taskSessionRunDAO.findActiveRun(sessionId);
    if (activeRun) {
      throw new Error('当前会话已有运行中的 Altus managed run');
    }

    const sandbox = await this.setupService.ensureSandbox(sessionId);
    const attachments =
      normalizedUploads.length > 0
        ? await this.uploadAttachments(sandbox.sandboxId, sandbox.workspaceRoot, normalizedUploads)
        : [];
    const attachmentContext =
      attachments.length > 0 ? buildAttachmentContextRecords(attachments, normalizedUploads) : [];
    const metadata = {
      ...pickObject(input.metadata),
      ...(attachments.length > 0 ? { attachments } : {}),
      ...(attachmentContext.length > 0 ? { attachmentContext } : {}),
    };
    const finalContent = appendAttachmentReferencesToContent(content, attachments);
    const run = await this.runService.startRun(sessionId, userId, {
      content: finalContent,
      messageKey: asText(input.messageKey) || undefined,
      metadata,
    });

    return {
      sessionId,
      run,
      attachments,
    };
  }

  private async uploadAttachments(
    sandboxId: string,
    workspaceRoot: string,
    uploads: TaskAttachmentUpload[]
  ): Promise<TaskAttachmentRecord[]> {
    const attachments = createStoredAttachmentRecords(uploads);
    const attachmentDir = `${workspaceRoot}/${TASK_ATTACHMENT_DIR}`;

    await e2bConnector.runCommand(sandboxId, `mkdir -p ${shellEscape(attachmentDir)}`, {
      timeoutMs: 15_000,
    });

    for (let index = 0; index < attachments.length; index += 1) {
      const attachment = attachments[index];
      const upload = uploads[index];
      await e2bConnector.writeFile(sandboxId, `${workspaceRoot}/${attachment.path}`, upload.buffer);
    }

    await this.touchSandboxFn(sandboxId, 'managed_attachment_upload');
    return attachments;
  }
}

export const altusManagedInputService = new AltusManagedInputService();
