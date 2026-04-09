import { randomUUID } from 'node:crypto';
import { taskSessionRunDAO } from '../db/dao';
import { e2bConnector } from '../connectors/e2b-connector';
import { markSandboxDirty } from './sandbox-activity-service';
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
import { managedImageObjectService, type ManagedImageObjectService } from './managed-image-object-service';
import { userSkillService } from './user-skill-service';
import { writeConnectorDebugLog } from '../utils/connector-debug-log';

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
    private readonly markSandboxDirtyFn: typeof markSandboxDirty = markSandboxDirty,
    private readonly imageObjectService: ManagedImageObjectService = managedImageObjectService
  ) {}

  async submit(userId: string, input: SubmitManagedInput): Promise<SubmitManagedInputResult> {
    const sessionId = asText(input.sessionId) || randomUUID();
    const resolvedMessageKey = asText(input.messageKey) || `managed-input:${randomUUID()}`;
    const normalizedUploads = normalizeAttachmentUploads(Array.isArray(input.files) ? input.files : []);
    const content = asText(input.content);
    if (!content && normalizedUploads.length === 0) {
      throw new Error('消息内容不能为空');
    }

    writeConnectorDebugLog('[ALTUS_MANAGED_SUBMIT_START]', {
      sessionId,
      userId,
      messageKey: resolvedMessageKey,
      hasContent: Boolean(content),
      uploadCount: normalizedUploads.length,
    });
    await this.setupService.ensureSessionOwnership(sessionId, userId);
    writeConnectorDebugLog('[ALTUS_MANAGED_SUBMIT_OWNERSHIP_READY]', {
      sessionId,
      userId,
    });
    const activeRun = await taskSessionRunDAO.findActiveRun(sessionId);
    if (activeRun) {
      throw new Error('当前会话已有运行中的 Altus managed run');
    }

    const availableSkills = await userSkillService.listAvailableSkills(userId);
    writeConnectorDebugLog('[ALTUS_MANAGED_SUBMIT_AVAILABLE_SKILLS_READY]', {
      sessionId,
      userId,
      availableSkillCount: availableSkills.length,
    });
    const resolvedSkills = await userSkillService.resolveSelectionsForSession(
      sessionId,
      pickObject(input.metadata).skills
    );
    writeConnectorDebugLog('[ALTUS_MANAGED_SUBMIT_RESOLVED_SKILLS_READY]', {
      sessionId,
      resolvedSkillCount: resolvedSkills.length,
    });
    let attachments: TaskAttachmentRecord[] = [];
    if (normalizedUploads.length > 0) {
      const sandbox = await this.setupService.ensureSandbox(sessionId);
      writeConnectorDebugLog('[ALTUS_MANAGED_SUBMIT_SANDBOX_READY]', {
        sessionId,
        sandboxId: sandbox.sandboxId,
        workspaceRoot: sandbox.workspaceRoot,
        reused: sandbox.reused,
      });
      attachments = await this.uploadAttachments(sandbox.sandboxId, sandbox.workspaceRoot, normalizedUploads);
    }
    if (attachments.length > 0) {
      attachments = await this.uploadImageObjects(sessionId, resolvedMessageKey, attachments, normalizedUploads);
    }
    const attachmentContext =
      attachments.length > 0 ? buildAttachmentContextRecords(attachments, normalizedUploads) : [];
    const metadata = {
      ...pickObject(input.metadata),
      ...(availableSkills.length > 0 ? { managedSkillCatalog: availableSkills } : {}),
      ...(resolvedSkills.length > 0 ? { managedSkillContext: resolvedSkills } : {}),
      ...(attachments.length > 0 ? { attachments } : {}),
      ...(attachmentContext.length > 0 ? { attachmentContext } : {}),
    };
    const finalContent = appendAttachmentReferencesToContent(content, attachments);
    writeConnectorDebugLog('[ALTUS_MANAGED_SUBMIT_START_RUN]', {
      sessionId,
      messageKey: resolvedMessageKey,
      attachmentCount: attachments.length,
      metadataKeys: Object.keys(metadata),
    });
    const run = await this.runService.startRun(sessionId, userId, {
      content: finalContent,
      messageKey: resolvedMessageKey,
      metadata,
    });
    if (!run) {
      throw new Error('managed run 创建失败');
    }
    writeConnectorDebugLog('[ALTUS_MANAGED_SUBMIT_RUN_READY]', {
      sessionId,
      runId: run.id || null,
      runStatus: run.status || null,
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

    await this.markSandboxDirtyFn(sandboxId, 'managed_attachment_upload');
    return attachments;
  }

  private async uploadImageObjects(
    sessionId: string,
    messageKey: string,
    attachments: TaskAttachmentRecord[],
    uploads: TaskAttachmentUpload[]
  ): Promise<TaskAttachmentRecord[]> {
    const results = [...attachments];
    for (let index = 0; index < results.length; index += 1) {
      const attachment = results[index];
      const upload = uploads[index];
      const mimeType = asText(upload?.mimeType).toLowerCase();
      if (!attachment || !upload || !mimeType.startsWith('image/')) {
        continue;
      }
      const objectKey = this.imageObjectService.buildObjectKey({
        sessionId,
        messageKey,
        attachmentName: attachment.name,
      });
      await this.imageObjectService.uploadImage({
        objectKey,
        body: upload.buffer,
        contentType: mimeType || 'application/octet-stream',
        originalName: attachment.name,
      });
      results[index] = {
        ...attachment,
        externalObjectKey: objectKey,
      };
    }
    return results;
  }
}

export const altusManagedInputService = new AltusManagedInputService();
