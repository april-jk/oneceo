import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ok } from '../utils/http';
import type { OneceoApiConnector } from '../connectors/oneceo-api-connector';

const querySchema = z.object({
  userId: z.string().uuid().optional(),
  method: z.string().optional(),
  path: z.string().optional(),
  status: z.coerce.number().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export function createAuditRoutes(oneceoApi: OneceoApiConnector) {
  const router = Router();

  router.get(
    '/request-logs',
    asyncHandler(async (req, res) => {
      const query = querySchema.parse(req.query);
      const result = await oneceoApi.listRequestLogs(query);
      return ok(res, result);
    })
  );

  router.get(
    '/request-logs/:logId',
    asyncHandler(async (req, res) => {
      const result = await oneceoApi.getRequestLogDetail(req.params.logId);
      return ok(res, result);
    })
  );

  router.get(
    '/users/:userId/sessions',
    asyncHandler(async (req, res) => {
      const query = pageQuerySchema.parse(req.query);
      const result = await oneceoApi.listUserSessions(req.params.userId, query);
      return ok(res, result);
    })
  );

  router.get(
    '/sessions/:sessionId/messages',
    asyncHandler(async (req, res) => {
      const result = await oneceoApi.getSessionMessages(req.params.sessionId);
      return ok(res, result);
    })
  );

  router.get(
    '/users/:userId/tool-calls',
    asyncHandler(async (req, res) => {
      const query = pageQuerySchema.parse(req.query);
      const result = await oneceoApi.listUserToolCalls(req.params.userId, query);
      return ok(res, result);
    })
  );

  router.get(
    '/users/:userId/transactions',
    asyncHandler(async (req, res) => {
      const query = pageQuerySchema.parse(req.query);
      const result = await oneceoApi.listUserTransactions(req.params.userId, {
        ...query,
        type: typeof req.query.type === 'string' ? req.query.type : undefined,
      });
      return ok(res, result);
    })
  );

  router.get(
    '/users/:userId/token-usage',
    asyncHandler(async (req, res) => {
      const query = pageQuerySchema.parse(req.query);
      const result = await oneceoApi.listUserTokenUsage(req.params.userId, query);
      return ok(res, result);
    })
  );

  return router;
}
