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
import { classifyTaskIntentShape } from './task-intent-shape-service';
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

type SkillSelectionInput = {
  sourceType: 'platform' | 'custom';
  skillId: string;
  revisionId: string;
};

const DEPLOYMENT_INTENT_PATTERNS = [
  /帮我部署当前项目/,
  /帮我重新部署当前项目/,
  /帮我回滚当前部署/,
  /帮我查看部署状态/,
  /(?:重新)?部署(?:当前)?(?:项目|应用|网站)?/,
  /回滚(?:当前)?(?:部署|发布|版本)?/,
  /查看(?:当前)?(?:部署|发布)状态/,
  /查询(?:当前)?(?:部署|发布)状态/,
  /(?:项目|应用|网站).*(?:上线|发布)/,
  /\bdeploy(?: the)?(?: current)?(?: project| app| site)?\b/i,
  /\bredeploy(?: the)?(?: current)?(?: project| app| site)?\b/i,
  /\brollback\b/i,
  /\broll back\b/i,
  /\bdeployment status\b/i,
  /\bpublish(?: the)?(?: current)?(?: project| app| site)?\b/i,
  /\bgo live\b/i,
];

type DeploymentAction = 'deploy' | 'redeploy' | 'rollback' | 'status';

const DEPLOYMENT_ACTION_PATTERNS: Array<{ action: DeploymentAction; patterns: RegExp[] }> = [
  {
    action: 'redeploy',
    patterns: [/帮我重新部署当前项目/, /重新部署/, /\bredeploy(?: the)?(?: current)?(?: project| app| site)?\b/i],
  },
  {
    action: 'rollback',
    patterns: [/帮我回滚当前部署/, /回滚(?:当前)?(?:部署|发布|版本)?/, /\brollback\b/i, /\broll back\b/i],
  },
  {
    action: 'status',
    patterns: [
      /帮我查看部署状态/,
      /查看(?:当前)?(?:部署|发布)状态/,
      /查询(?:当前)?(?:部署|发布)状态/,
      /\bdeployment status\b/i,
    ],
  },
  {
    action: 'deploy',
    patterns: DEPLOYMENT_INTENT_PATTERNS,
  },
];

function shellEscape(value: string): string {
  if (!value) return "''";
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function normalizeSkillSelections(value: unknown): SkillSelectionInput[] {
  if (!Array.isArray(value)) return [];
  const results: SkillSelectionInput[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const sourceType = asText(record.sourceType) === 'custom' ? 'custom' : 'platform';
    const skillId = asText(record.skillId);
    const revisionId = asText(record.revisionId);
    if (!skillId || !revisionId) continue;
    const key = `${sourceType}:${skillId}:${revisionId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      sourceType,
      skillId,
      revisionId,
    });
  }
  return results;
}

function mergeSkillSelections(
  existing: SkillSelectionInput[],
  incoming: SkillSelectionInput[]
): SkillSelectionInput[] {
  const results = [...existing];
  const seen = new Set(
    existing.map((item) => `${item.sourceType}:${item.skillId}:${item.revisionId}`)
  );
  for (const item of incoming) {
    const key = `${item.sourceType}:${item.skillId}:${item.revisionId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(item);
  }
  return results;
}

function detectDeploymentAction(content: string): DeploymentAction | null {
  const normalized = asText(content);
  if (!normalized) return null;
  for (const candidate of DEPLOYMENT_ACTION_PATTERNS) {
    if (candidate.patterns.some((pattern) => pattern.test(normalized))) {
      return candidate.action;
    }
  }
  return null;
}

function canAutoAttachDeploymentSkill(
  skill: {
    sourceType: 'platform' | 'custom';
    governance?: {
      systemRole?: string | null;
      autoActivation?: {
        enabled?: boolean;
        triggers?: string[];
      } | null;
    } | null;
  },
  action: DeploymentAction
) {
  if (skill.sourceType !== 'platform') return false;
  const governance = skill.governance;
  if (!governance || governance.systemRole !== 'deployment_orchestrator') return false;
  if (!governance.autoActivation?.enabled) return false;
  const triggers = Array.isArray(governance.autoActivation.triggers)
    ? governance.autoActivation.triggers.map((item) => asText(item).toLowerCase())
    : [];
  return triggers.includes(action) || triggers.includes('deployment');
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
    const baseMetadata = pickObject(input.metadata);
    const explicitSkillSelections = normalizeSkillSelections(baseMetadata.skills);
    let mergedSkillSelections = explicitSkillSelections;
    const taskIntentShape = classifyTaskIntentShape(content);
    const deploymentAction = detectDeploymentAction(content);
    if (deploymentAction && taskIntentShape.deployRequested && !taskIntentShape.explicitNoDeploy) {
      const deploymentSkill = availableSkills.find((item) =>
        canAutoAttachDeploymentSkill(item as any, deploymentAction)
      );
      if (deploymentSkill) {
        mergedSkillSelections = mergeSkillSelections(mergedSkillSelections, [
          {
            sourceType: 'platform',
            skillId: deploymentSkill.skillId,
            revisionId: deploymentSkill.revisionId,
          },
        ]);
      }
    }
    const resolvedSkills = await userSkillService.resolveSelectionsForSession(
      sessionId,
      mergedSkillSelections
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
      ...baseMetadata,
      ...(mergedSkillSelections.length > 0 ? { skills: mergedSkillSelections } : {}),
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
