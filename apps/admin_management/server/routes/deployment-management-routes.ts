import { Router } from 'express';
import { z } from 'zod';
import type { DeploymentManagementService } from '../services/deployment-management-service';
import { asyncHandler, ok } from '../utils/http';

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(300).optional(),
  query: z.string().trim().optional(),
  status: z.string().trim().optional(),
  hasUrl: z.string().trim().optional(),
  userId: z.string().trim().optional(),
  taskSessionId: z.string().trim().optional(),
});

const userListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(300).optional(),
  query: z.string().trim().optional(),
  status: z.string().trim().optional(),
  hasUrl: z.string().trim().optional(),
  userId: z.string().trim().optional(),
});

const railwayListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(300).optional(),
  query: z.string().trim().optional(),
  status: z.string().trim().optional(),
  risk: z.string().trim().optional(),
});

const railwayServiceKeysSchema = z.object({
  serviceKeys: z.array(z.string().trim().min(1)).min(1).max(50),
});

const railwayBatchConfigureSchema = railwayServiceKeysSchema.extend({
  patch: z.object({
    builder: z.string().trim().optional(),
    buildCommand: z.string().optional(),
    startCommand: z.string().optional(),
    rootDirectory: z.string().optional(),
    healthcheckPath: z.string().optional(),
    sourceImage: z.string().trim().optional(),
  }).refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: 'patch 不能为空',
  }),
});

const railwayBatchVariablesSchema = railwayServiceKeysSchema.extend({
  variables: z.record(z.string(), z.string()).refine((value) => Object.keys(value).length > 0, {
    message: 'variables 不能为空',
  }),
  replace: z.boolean().optional(),
});

export function createDeploymentManagementRoutes(service: DeploymentManagementService) {
  const router = Router();

  router.get(
    '/overview',
    asyncHandler(async (req, res) => {
      const query = listQuerySchema.parse(req.query);
      const result = await service.getOverview(query);
      return ok(res, result);
    })
  );

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const query = listQuerySchema.parse(req.query);
      const result = await service.listRecords(query);
      return ok(res, result);
    })
  );

  router.get(
    '/conversations',
    asyncHandler(async (req, res) => {
      const query = listQuerySchema.parse(req.query);
      const result = await service.listConversations(query);
      return ok(res, result);
    })
  );

  router.get(
    '/users',
    asyncHandler(async (req, res) => {
      const query = userListQuerySchema.parse(req.query);
      const result = await service.listUsers(query);
      return ok(res, result);
    })
  );

  router.get(
    '/task-sessions/:taskSessionId',
    asyncHandler(async (req, res) => {
      const result = await service.getDetail(req.params.taskSessionId);
      return ok(res, result);
    })
  );

  router.get(
    '/railway/services',
    asyncHandler(async (req, res) => {
      const query = railwayListQuerySchema.parse(req.query);
      const result = await service.listRailwayServices(query);
      return ok(res, result);
    })
  );

  router.post(
    '/railway/services/batch-delete',
    asyncHandler(async (req, res) => {
      const body = railwayServiceKeysSchema.parse(req.body || {});
      const result = await service.batchDeleteRailwayServices(body.serviceKeys);
      return ok(res, result);
    })
  );

  router.post(
    '/railway/services/batch-configure',
    asyncHandler(async (req, res) => {
      const body = railwayBatchConfigureSchema.parse(req.body || {});
      const result = await service.batchConfigureRailwayServices(body.serviceKeys, body.patch);
      return ok(res, result);
    })
  );

  router.post(
    '/railway/services/batch-variables',
    asyncHandler(async (req, res) => {
      const body = railwayBatchVariablesSchema.parse(req.body || {});
      const result = await service.batchUpsertRailwayServiceVariables(body.serviceKeys, body.variables, {
        replace: body.replace,
      });
      return ok(res, result);
    })
  );

  return router;
}
