import express from 'express';
import multer from 'multer';
import { currentUserResolver } from '../services/current-user-resolver';
import { isSameUserId } from '../utils/user-id';
import { altusManagedRunService } from '../services/altus-managed-run-service';
import { altusManagedInputService } from '../services/altus-managed-input-service';
import { getPublicErrorMessage } from '../utils/error-response';
import { taskCreationSessionDAO, taskSessionRunDAO } from '../db/dao';
import { altusManagedTurnSnapshotService } from '../services/altus-managed-turn-snapshot-service';
import {
  normalizeManagedSkillContexts,
  type ManagedMcpProvider,
  type ManagedSkillContext,
} from '../services/altus-managed-shared';
import { altusManagedDynamicContextBlockService } from '../services/altus-managed-dynamic-context-blocks';
import { altusManagedContextCacheObserver } from '../services/altus-managed-context-cache-observer';
import { altusManagedContextDebugSummaryService } from '../services/altus-managed-context-debug-summary-service';
import { altusManagedContextRecoveryService } from '../services/altus-managed-context-recovery-service';
import { altusManagedContextBudgetService } from '../services/altus-managed-context-budget-service';
import { altusMemoryContextService } from '../services/altus-memory-context-service';
import { taskSessionSkillStateService } from '../services/task-session-skill-state-service';
import { userSkillService } from '../services/user-skill-service';
import { inspectTaskSessionProjectProfile } from '../services/task-session-project-profile-service';
import {
  TASK_ATTACHMENT_MAX_BYTES,
  TASK_ATTACHMENT_MAX_COUNT,
} from '../services/task-attachment-service';

const router = express.Router();
const managedAttachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: TASK_ATTACHMENT_MAX_BYTES,
    files: TASK_ATTACHMENT_MAX_COUNT,
  },
});

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      throw new Error('metadata 必须是合法 JSON 对象');
    }
    return undefined;
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function readMcpProvidersFromSnapshot(value: unknown): ManagedMcpProvider[] {
  const snapshot = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  return Array.isArray(snapshot.providers) ? (snapshot.providers as ManagedMcpProvider[]) : [];
}

function skillContextKey(value: {
  sourceType: 'platform' | 'custom';
  skillId: string;
  revisionId: string;
}) {
  return `${value.sourceType}:${value.skillId}:${value.revisionId}`;
}

function mergeSkillContexts(primary: ManagedSkillContext[], fallback: ManagedSkillContext[]) {
  const results = new Map<string, ManagedSkillContext>();
  for (const item of primary) {
    results.set(skillContextKey(item), item);
  }
  for (const item of fallback) {
    const key = skillContextKey(item);
    if (!results.has(key)) {
      results.set(key, item);
    }
  }
  return Array.from(results.values());
}

function readMessageSkillContexts(messages: Array<{ metadata?: Record<string, unknown> }>, runId?: string | null) {
  const contexts: ManagedSkillContext[] = [];
  for (const message of messages) {
    const metadata = message.metadata || {};
    if (runId && asText(metadata.runId) !== runId) continue;
    contexts.push(...normalizeManagedSkillContexts(metadata.managedSkillContext));
  }
  return mergeSkillContexts(contexts, []);
}

function readLatestWorkspaceRuntime(messages: Array<{ metadata?: Record<string, unknown> }>) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const metadata = messages[index]?.metadata || {};
    const orchestratorSessionId = asText(metadata.orchestratorSessionId);
    const workspaceRoot = asText(metadata.workspaceRoot) || asText(metadata.workspacePath);
    if (orchestratorSessionId && workspaceRoot) {
      return {
        orchestratorSessionId,
        workspaceRoot,
        runtimeGeneration: Number(metadata.runtimeGeneration) || undefined,
      };
    }
  }
  return null;
}

function resolveCurrentUserError(error: unknown): { status: number; message: string } | null {
  const message = error instanceof Error ? error.message : String(error || '');
  if (message.includes('无法识别当前用户')) {
    return { status: 401, message };
  }
  return null;
}

function runManagedUploadMiddleware(req: express.Request, res: express.Response) {
  return new Promise<void>((resolve, reject) => {
    managedAttachmentUpload.array('files', TASK_ATTACHMENT_MAX_COUNT)(req, res, (error) => {
      if (!error) {
        resolve();
        return;
      }
      if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
          reject(new Error('单个附件不能超过 10 MB'));
          return;
        }
        if (error.code === 'LIMIT_FILE_COUNT') {
          reject(new Error(`最多只能添加 ${TASK_ATTACHMENT_MAX_COUNT} 个附件`));
          return;
        }
      }
      reject(error);
    });
  });
}

router.post('/inputs', async (req, res) => {
  try {
    await runManagedUploadMiddleware(req, res);
    const currentUser = currentUserResolver.require(req);
    const files = Array.isArray(req.files)
      ? req.files.map((file) => ({
          name: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          buffer: file.buffer,
        }))
      : [];
    const metadata = parseMetadata(req.body?.metadata) || {};
    if (asText(req.body?.modelTier)) {
      metadata.modelTier = asText(req.body.modelTier);
    }
    const result = await altusManagedInputService.submit(currentUser.userId, {
      sessionId: asText(req.body?.sessionId) || undefined,
      content: asText(req.body?.content),
      messageKey: asText(req.body?.messageKey) || undefined,
      metadata,
      files,
    });

    return res.json({
      success: true,
      data: {
        sessionId: result.sessionId,
        attachments: result.attachments,
        run: result.run,
      },
    });
  } catch (error: any) {
    const authError = resolveCurrentUserError(error);
    console.error('[ALTUS_MANAGED_INPUT_FAILED]', error);
    return res.status(authError?.status || 400).json({
      success: false,
      error: getPublicErrorMessage(authError?.message || error?.message || '提交 Altus managed 输入失败'),
    });
  }
});

router.post('/sessions/:sessionId/runs', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const sessionId = asText(req.params.sessionId);
    const content = asText(req.body?.content);
    const messageKey = asText(req.body?.messageKey) || undefined;
    const metadata =
      req.body?.metadata && typeof req.body.metadata === 'object' && !Array.isArray(req.body.metadata)
        ? (req.body.metadata as Record<string, unknown>)
        : {};
    if (asText(req.body?.modelTier)) {
      metadata.modelTier = asText(req.body.modelTier);
    }

    const run = await altusManagedRunService.startRun(sessionId, currentUser.userId, {
      content,
      messageKey,
      metadata,
    });

    return res.json({
      success: true,
      data: run,
    });
  } catch (error: any) {
    const authError = resolveCurrentUserError(error);
    console.error('[ALTUS_MANAGED_START_FAILED]', error);
    return res.status(authError?.status || 400).json({
      success: false,
      error: getPublicErrorMessage(authError?.message || error?.message || '启动 Altus managed run 失败'),
    });
  }
});

router.get('/sessions/:sessionId/runs/latest', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const sessionId = asText(req.params.sessionId);
    const run = await altusManagedRunService.getLatestRun(sessionId, currentUser.userId);
    return res.json({
      success: true,
      data: run,
    });
  } catch (error: any) {
    const authError = resolveCurrentUserError(error);
    console.error('[ALTUS_MANAGED_LATEST_FAILED]', error);
    return res.status(authError?.status || 400).json({
      success: false,
      error: getPublicErrorMessage(authError?.message || error?.message || '获取 Altus managed run 失败'),
    });
  }
});

router.get('/sessions/:sessionId/context-debug', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const sessionId = asText(req.params.sessionId);
    const session = await taskCreationSessionDAO.getSession(sessionId);
    const sessionUserId = asText(session?.userId);
    if (!session || !sessionUserId) {
      return res.status(404).json({
        success: false,
        error: '会话不存在或缺少用户归属',
      });
    }
    if (!isSameUserId(currentUser.userId, sessionUserId)) {
      return res.status(403).json({
        success: false,
        error: '当前用户无权查看该会话上下文诊断',
      });
    }

    const runId = asText(req.query.runId) || null;
    const run = runId ? await taskSessionRunDAO.getRun(runId) : null;
    if (runId && (!run || run.sessionId !== sessionId)) {
      return res.status(404).json({
        success: false,
        error: 'managed run 不存在或不属于当前会话',
      });
    }

    const mcpSnapshot = run?.mcpToolSnapshotId
      ? await taskSessionRunDAO.getMcpToolSnapshot(run.mcpToolSnapshotId)
      : null;
    const mcpProviders = readMcpProvidersFromSnapshot(mcpSnapshot?.snapshotJson);
    const messages = await taskCreationSessionDAO.getMessages(sessionId);
    const workspaceRuntime = readLatestWorkspaceRuntime(messages as any);
    const projectProfile = workspaceRuntime
      ? await inspectTaskSessionProjectProfile({
          sessionId,
          orchestratorSessionId: workspaceRuntime.orchestratorSessionId,
          workspaceRoot: workspaceRuntime.workspaceRoot,
          runtimeGeneration: workspaceRuntime.runtimeGeneration,
        }).catch((error) => ({
          version: '1.0' as const,
          sessionId,
          runtimeGeneration: workspaceRuntime.runtimeGeneration,
          updatedAt: new Date().toISOString(),
          artifactType: 'unknown' as const,
          runtimeFamily: 'unknown' as const,
          templateFamily: 'unknown' as const,
          deployability: 'unknown' as const,
          entrypoints: [],
          commands: {},
          analyticsStatus: 'unknown' as const,
          configFiles: {},
          evidence: [
            {
              source: 'file_scan' as const,
              message: `project profile unavailable: ${getPublicErrorMessage((error as Error)?.message || String(error))}`,
            },
          ],
        }))
      : null;
    const messageSkillContexts = readMessageSkillContexts(messages as any, runId);
    const sessionSkillState = await taskSessionSkillStateService.getSessionSkillState(sessionId).catch(() => null);
    const stateSelections = sessionSkillState
      ? [
          ...sessionSkillState.explicitSelections,
          ...sessionSkillState.residentSelections,
          ...sessionSkillState.bindings.map((item) => ({
            sourceType: item.sourceType,
            skillId: item.skillId,
            revisionId: item.revisionId,
          })),
        ]
      : [];
    const resolvedStateSkills =
      stateSelections.length > 0
        ? await userSkillService.resolveSelectionsForSession(sessionId, stateSelections).catch(() => [])
        : [];
    const activeSkills = mergeSkillContexts(
      resolvedStateSkills as ManagedSkillContext[],
      messageSkillContexts
    );
    const memoryContext = await altusMemoryContextService.buildPromptSectionForRun({
      sessionId,
      userId: currentUser.userId,
    });
    const dynamicContextBlocks = [
      ...altusManagedDynamicContextBlockService.buildSkillBlocks({
        activeSkills,
      }),
      ...altusManagedDynamicContextBlockService.buildAttachmentBlocks(messages as any),
      ...altusManagedDynamicContextBlockService.buildMcpBlocks({
        providers: mcpProviders,
        snapshotId: run?.mcpToolSnapshotId || null,
      }),
      ...altusManagedDynamicContextBlockService.buildMemoryBlocks({
        userMemory: memoryContext.userMemory,
        projectMemory: memoryContext.projectMemory,
        sessionMemory: memoryContext.sessionMemory,
        runtimeMemoryPrompt: memoryContext.promptSection,
      }),
    ];
    const recovery = await altusManagedContextRecoveryService.rebuildFromDbFacts({
      sessionId,
      runId,
      dynamicContextBlocks,
    });
    const snapshot = altusManagedTurnSnapshotService.createReadOnlySnapshot({
      sessionId,
      runId,
      model: run?.model || null,
      mcpProviders,
      skills: activeSkills,
    });
    const budgetProjection = altusManagedContextBudgetService.projectMessagesForModelWithReport(recovery.compiled.messages);
    const cacheObservation = altusManagedContextCacheObserver.buildObservation({
      ledger: recovery.ledger,
      manifest: recovery.manifest,
      snapshot,
      apiMessages: budgetProjection.messages,
      budgetReplacementSummary: budgetProjection.replacementSummary,
    });
    const summary = altusManagedContextDebugSummaryService.buildSummary({
      recovery,
      cacheObservation,
    });

    return res.json({
      success: true,
      data: {
        summary,
        snapshot,
        manifest: recovery.manifest,
        reconciliation: recovery.reconciliation,
        cacheObservation,
        projectProfile,
        roundTrip: recovery.roundTrip,
        recovery,
        budgetProjection: budgetProjection.replacementSummary,
        ledger: recovery.ledger,
        compiled: recovery.compiled,
      },
    });
  } catch (error: any) {
    const authError = resolveCurrentUserError(error);
    console.error('[ALTUS_MANAGED_CONTEXT_DEBUG_FAILED]', error);
    return res.status(authError?.status || 400).json({
      success: false,
      error: getPublicErrorMessage(authError?.message || error?.message || '获取 Altus managed 上下文诊断失败'),
    });
  }
});

router.get('/runs/:runId/stream', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const runId = asText(req.params.runId);
    const run = await taskSessionRunDAO.getRun(runId);
    if (!run) {
      return res.status(404).json({
        success: false,
        error: 'managed run 不存在',
      });
    }
    const session = await taskCreationSessionDAO.getSession(run.sessionId);
    const sessionUserId = asText(session?.userId);
    if (!sessionUserId) {
      return res.status(401).json({
        success: false,
        error: '当前 run 关联会话缺少用户归属',
      });
    }
    if (!isSameUserId(currentUser.userId, sessionUserId)) {
      return res.status(403).json({
        success: false,
        error: '当前用户无权订阅该 Altus managed run',
      });
    }
    const afterSequence = Number(req.query.afterSequence);
    await altusManagedRunService.streamRun(
      {
        runId,
        sessionId: run.sessionId,
        userId: sessionUserId,
      },
      res,
      {
      afterSequence: Number.isFinite(afterSequence) && afterSequence > 0 ? Math.floor(afterSequence) : null,
      }
    );
  } catch (error: any) {
    console.error('[ALTUS_MANAGED_STREAM_FAILED]', error);
    if (!res.headersSent) {
      const authError = resolveCurrentUserError(error);
      return res.status(authError?.status || 500).json({
        success: false,
        error: getPublicErrorMessage(authError?.message || error?.message || 'Altus managed stream 失败'),
      });
    }
  }
});

router.post('/runs/:runId/stop', async (req, res) => {
  try {
    const currentUser = currentUserResolver.require(req);
    const runId = asText(req.params.runId);
    const reason = asText(req.body?.reason) || 'user_interrupt';
    const run = await altusManagedRunService.stopRun(runId, currentUser.userId, reason);
    return res.json({
      success: true,
      data: run,
    });
  } catch (error: any) {
    const authError = resolveCurrentUserError(error);
    console.error('[ALTUS_MANAGED_STOP_FAILED]', error);
    return res.status(authError?.status || 400).json({
      success: false,
      error: getPublicErrorMessage(authError?.message || error?.message || '停止 Altus managed run 失败'),
    });
  }
});

export default router;
