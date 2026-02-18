import { Router } from 'express';
import { z } from 'zod';
import type { SandboxManagementService } from '../services/sandbox-management-service';
import { asyncHandler, ok } from '../utils/http';

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export function createSandboxManagementRoutes(service: SandboxManagementService) {
  const router = Router();

  router.get(
    '/overview',
    asyncHandler(async (req, res) => {
      const query = querySchema.parse(req.query);
      const result = await service.getOverview(query.limit ?? 50);
      return ok(res, result);
    })
  );

  return router;
}

