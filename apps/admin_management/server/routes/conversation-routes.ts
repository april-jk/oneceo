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
      const result = await service.getSessionDetail(req.params.sessionId);
      return ok(res, result);
    })
  );

  return router;
}

