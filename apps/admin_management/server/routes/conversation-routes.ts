import { Router } from 'express';
import { z } from 'zod';
import type { ConversationManagementService } from '../services/conversation-management-service';
import { asyncHandler, ok } from '../utils/http';

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export function createConversationRoutes(service: ConversationManagementService) {
  const router = Router();

  router.get(
    '/sessions',
    asyncHandler(async (req, res) => {
      const query = querySchema.parse(req.query);
      const result = await service.listSessions(query.limit ?? 20);
      return ok(res, result);
    })
  );

  router.get(
    '/sessions/:sessionId',
    asyncHandler(async (req, res) => {
      const result = await service.getSessionCore(req.params.sessionId);
      return ok(res, result);
    })
  );

  router.get(
    '/sessions/:sessionId/core',
    asyncHandler(async (req, res) => {
      const result = await service.getSessionCore(req.params.sessionId);
      return ok(res, result);
    })
  );

  router.get(
    '/sessions/:sessionId/infra',
    asyncHandler(async (req, res) => {
      const result = await service.getSessionInfra(req.params.sessionId);
      return ok(res, result);
    })
  );

  router.get(
    '/sessions/:sessionId/api-traces',
    asyncHandler(async (req, res) => {
      const query = z.object({
        type: z.enum(['llm_request', 'tool_call', 'service_api', 'connector_api']).optional(),
        toolName: z.string().optional(),
        model: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(500).optional().default(100),
        offset: z.coerce.number().int().min(0).optional().default(0),
      }).parse(req.query);
      const result = await service.getSessionApiTraces(req.params.sessionId, query);
      return ok(res, result);
    })
  );

  router.get(
    '/api-traces/aggregate',
    asyncHandler(async (req, res) => {
      const query = z.object({
        type: z.enum(['llm_request', 'tool_call', 'service_api', 'connector_api']).optional(),
        toolName: z.string().optional(),
        model: z.string().optional(),
        sessionId: z.string().uuid().optional(),
        from: z.string().datetime().optional(),
        to: z.string().datetime().optional(),
        groupBy: z.enum(['tool_name', 'model', 'service_name', 'trace_type']).optional().default('trace_type'),
        limit: z.coerce.number().int().min(1).max(500).optional().default(100),
        offset: z.coerce.number().int().min(0).optional().default(0),
      }).parse(req.query);
      const result = await service.getApiTraceAggregate(query);
      return ok(res, result);
    })
  );

  router.get(
    '/api-traces/stats',
    asyncHandler(async (req, res) => {
      const query = z.object({
        type: z.enum(['llm_request', 'tool_call', 'service_api', 'connector_api']).optional(),
        from: z.string().datetime().optional(),
        to: z.string().datetime().optional(),
      }).parse(req.query);
      const result = await service.getApiTraceStats(query);
      return ok(res, result);
    })
  );

  router.get(
    '/api-traces/trend',
    asyncHandler(async (req, res) => {
      const query = z.object({
        type: z.enum(['llm_request', 'tool_call', 'service_api', 'connector_api']).optional(),
        from: z.string().datetime().optional(),
        to: z.string().datetime().optional(),
        interval: z.enum(['hour', 'day']).optional().default('hour'),
      }).parse(req.query);
      const result = await service.getApiTraceTrend(query);
      return ok(res, result);
    })
  );

  return router;
}
