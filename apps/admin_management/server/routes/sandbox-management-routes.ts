import { Router } from 'express';
import { z } from 'zod';
import type { SandboxManagementService } from '../services/sandbox-management-service';
import { asyncHandler, ok } from '../utils/http';

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  state: z.string().optional(),
  metadata: z.string().optional(),
  templateId: z.string().optional(),
});

const timeoutSchema = z.object({
  timeoutMs: z.coerce.number().int().positive(),
});

const createSandboxSchema = z.object({
  template: z.string().optional(),
  timeoutMs: z.coerce.number().int().positive().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  envs: z.record(z.string(), z.string()).optional(),
  allowInternetAccess: z.boolean().optional(),
  secure: z.boolean().optional(),
  mcp: z.any().optional(),
  network: z.any().optional(),
  autoPause: z.boolean().optional(),
});

const toolSchema = z.object({
  action: z.string(),
  payload: z.any().optional(),
});

const restoreSchema = z.object({
  snapshotKey: z.string().min(1).optional(),
});

const templateQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  nextToken: z.string().optional(),
  teamID: z.string().optional(),
});

export function createSandboxManagementRoutes(service: SandboxManagementService) {
  const router = Router();

  router.get(
    '/runtime-registry',
    asyncHandler(async (req, res) => {
      const limit = req.query.limit === undefined
        ? undefined
        : z.coerce.number().int().min(1).max(300).parse(req.query.limit);
      const result = await service.getRuntimeRegistry(limit ?? 100);
      return ok(res, result);
    })
  );

  router.get(
    '/overview',
    asyncHandler(async (req, res) => {
      const query = querySchema.parse(req.query);
      const state = query.state ? query.state.split(',').filter(Boolean) : undefined;
      const metadata = query.metadata ? JSON.parse(query.metadata) : undefined;
      const result = await service.getOverview(query.limit ?? 50, {
        state: state as Array<'running' | 'paused'> | undefined,
        metadata,
        templateId: query.templateId,
      });
      return ok(res, result);
    })
  );

  router.get(
    '/environments/:sandboxId/runtime-detail',
    asyncHandler(async (req, res) => {
      const result = await service.getRuntimeDetail(req.params.sandboxId);
      return ok(res, result);
    })
  );

  router.get(
    '/environments/:sandboxId/archive-history',
    asyncHandler(async (req, res) => {
      const result = await service.getArchiveHistory(req.params.sandboxId);
      return ok(res, result);
    })
  );

  router.get(
    '/environments/:sandboxId/archive-download-url',
    asyncHandler(async (req, res) => {
      const expiresInSeconds = req.query.expiresInSeconds === undefined
        ? 3600
        : z.coerce.number().int().min(60).max(86400).parse(req.query.expiresInSeconds);
      const snapshotKey = typeof req.query.snapshotKey === 'string' ? req.query.snapshotKey : undefined;
      const result = await service.getArchiveDownloadUrl(req.params.sandboxId, expiresInSeconds, snapshotKey);
      return ok(res, result);
    })
  );

  router.get(
    '/environments/:sandboxId',
    asyncHandler(async (req, res) => {
      const result = await service.getEnvironment(req.params.sandboxId);
      return ok(res, result);
    })
  );

  router.get(
    '/environments/:sandboxId/full-info',
    asyncHandler(async (req, res) => {
      const result = await service.getEnvironmentFullInfo(req.params.sandboxId);
      return ok(res, result);
    })
  );

  router.get(
    '/environments/:sandboxId/metrics',
    asyncHandler(async (req, res) => {
      const start = typeof req.query.start === 'string' ? req.query.start : undefined;
      const end = typeof req.query.end === 'string' ? req.query.end : undefined;
      const result = await service.getEnvironmentMetrics(req.params.sandboxId, start, end);
      return ok(res, result);
    })
  );

  router.post(
    '/environments',
    asyncHandler(async (req, res) => {
      const payload = createSandboxSchema.parse(req.body);
      const result = await service.createEnvironment(payload);
      return ok(res, result);
    })
  );

  router.post(
    '/environments/:sandboxId/open',
    asyncHandler(async (req, res) => {
      const result = await service.openEnvironment(req.params.sandboxId);
      return ok(res, result);
    })
  );

  router.post(
    '/environments/:sandboxId/restart',
    asyncHandler(async (req, res) => {
      const result = await service.restartEnvironment(req.params.sandboxId);
      return ok(res, result);
    })
  );

  router.post(
    '/environments/:sandboxId/archive',
    asyncHandler(async (req, res) => {
      const result = await service.archiveEnvironment(req.params.sandboxId);
      return ok(res, result);
    })
  );

  router.post(
    '/environments/:sandboxId/restore',
    asyncHandler(async (req, res) => {
      const payload = restoreSchema.parse(req.body ?? {});
      const result = await service.restoreEnvironment(req.params.sandboxId, payload);
      return ok(res, result);
    })
  );

  router.post(
    '/environments/:sandboxId/connectivity-check',
    asyncHandler(async (req, res) => {
      const result = await service.connectivityCheck(req.params.sandboxId);
      return ok(res, result);
    })
  );

  router.post(
    '/environments/:sandboxId/refresh-runtime',
    asyncHandler(async (req, res) => {
      const result = await service.refreshRuntime(req.params.sandboxId);
      return ok(res, result);
    })
  );

  router.post(
    '/environments/:sandboxId/timeout',
    asyncHandler(async (req, res) => {
      const payload = timeoutSchema.parse(req.body);
      const result = await service.setEnvironmentTimeout(req.params.sandboxId, payload.timeoutMs);
      return ok(res, result);
    })
  );

  router.post(
    '/environments/:sandboxId/close',
    asyncHandler(async (req, res) => {
      const result = await service.closeEnvironment(req.params.sandboxId);
      return ok(res, result);
    })
  );

  router.post(
    '/environments/:sandboxId/pause',
    asyncHandler(async (req, res) => {
      const result = await service.pauseEnvironment(req.params.sandboxId);
      return ok(res, result);
    })
  );

  router.post(
    '/environments/:sandboxId/resume',
    asyncHandler(async (req, res) => {
      const result = await service.resumeEnvironment(req.params.sandboxId);
      return ok(res, result);
    })
  );

  router.post(
    '/environments/:sandboxId/tools',
    asyncHandler(async (req, res) => {
      const payload = toolSchema.parse(req.body);
      const result = await service.runToolAction(req.params.sandboxId, payload.action, payload.payload);
      return ok(res, result);
    })
  );

  router.get(
    '/templates',
    asyncHandler(async (req, res) => {
      const query = templateQuerySchema.parse(req.query);
      const result = await service.listTemplates(query.teamID);
      return ok(res, result);
    })
  );

  router.get(
    '/templates/:templateId',
    asyncHandler(async (req, res) => {
      const query = templateQuerySchema.parse(req.query);
      const result = await service.getTemplate(req.params.templateId, {
        limit: query.limit,
        nextToken: query.nextToken,
      });
      return ok(res, result);
    })
  );

  router.post(
    '/templates',
    asyncHandler(async (req, res) => {
      const result = await service.createTemplate(req.body ?? {});
      return ok(res, result);
    })
  );

  router.patch(
    '/templates/:templateId',
    asyncHandler(async (req, res) => {
      const result = await service.updateTemplate(req.params.templateId, req.body ?? {});
      return ok(res, result);
    })
  );

  router.post(
    '/templates/:templateId/rebuild',
    asyncHandler(async (req, res) => {
      const result = await service.rebuildTemplate(req.params.templateId, req.body ?? {});
      return ok(res, result);
    })
  );

  router.delete(
    '/templates/:templateId',
    asyncHandler(async (req, res) => {
      const result = await service.deleteTemplate(req.params.templateId);
      return ok(res, result);
    })
  );

  router.get(
    '/templates/:templateId/builds/:buildId/logs',
    asyncHandler(async (req, res) => {
      const result = await service.getTemplateBuildLogs(req.params.templateId, req.params.buildId, req.query as any);
      return ok(res, result);
    })
  );

  router.get(
    '/templates/:templateId/builds/:buildId/status',
    asyncHandler(async (req, res) => {
      const result = await service.getTemplateBuildStatus(req.params.templateId, req.params.buildId, req.query as any);
      return ok(res, result);
    })
  );

  router.get(
    '/templates/aliases/:alias',
    asyncHandler(async (req, res) => {
      const result = await service.checkTemplateAlias(req.params.alias);
      return ok(res, result);
    })
  );

  router.post(
    '/templates/tags',
    asyncHandler(async (req, res) => {
      const result = await service.assignTemplateTags(req.body ?? {});
      return ok(res, result);
    })
  );

  router.delete(
    '/templates/tags',
    asyncHandler(async (req, res) => {
      const result = await service.deleteTemplateTags(req.body ?? {});
      return ok(res, result);
    })
  );

  return router;
}
