import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ok } from '../utils/http';
import type { AuditService } from '../services/audit-service';

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export function createAuditRoutes(auditService: AuditService) {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const query = querySchema.parse(req.query);
      const entries = await auditService.list(query.limit ?? 50);
      return ok(res, {
        total: entries.length,
        entries,
      });
    })
  );

  return router;
}