import { Router } from 'express';
import { z } from 'zod';
import type { UserManagementService } from '../services/user-management-service';
import { asyncHandler, ok } from '../utils/http';

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  query: z.string().trim().optional(),
  status: z.string().trim().optional(),
  activity: z.string().trim().optional(),
  hasSession: z.string().trim().optional(),
  hasConversation: z.string().trim().optional(),
  hasSandbox: z.string().trim().optional(),
  ownershipHealth: z.string().trim().optional(),
  sortKey: z.string().trim().optional(),
  sortDirection: z.string().trim().optional(),
});

const statusSchema = z.object({
  status: z.enum(['active', 'disabled']),
});

export function createUserManagementRoutes(service: UserManagementService) {
  const router = Router();

  router.get(
    '/app-users',
    asyncHandler(async (req, res) => {
      const query = listQuerySchema.parse(req.query);
      const result = await service.listAppUsers(query);
      return ok(res, result);
    })
  );

  router.get(
    '/app-users/:userId',
    asyncHandler(async (req, res) => {
      const result = await service.getAppUserDetail(req.params.userId);
      return ok(res, result);
    })
  );

  router.post(
    '/app-users/:userId/status',
    asyncHandler(async (req, res) => {
      const body = statusSchema.parse(req.body || {});
      const result = await service.updateAppUserStatus(req.params.userId, body.status);
      return ok(res, result);
    })
  );

  return router;
}
