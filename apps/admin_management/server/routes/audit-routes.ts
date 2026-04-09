import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ok } from '../utils/http';
import type { AuditService } from '../services/audit-service';

const querySchema = z.object({
  query: z.string().optional(),
  operator: z.string().optional(),
  action: z.string().optional(),
  result: z.string().optional(),
  sessionId: z.string().optional(),
  targetVmId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).max(5000).optional(),
});

export function createAuditRoutes(auditService: AuditService) {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const query = querySchema.parse(req.query);
      const result = await auditService.list(query);
      return ok(res, result);
    })
  );

  router.get(
    '/:auditId',
    asyncHandler(async (req, res) => {
      const result = await auditService.getDetail(req.params.auditId);
      return ok(res, result);
    })
  );

  return router;
}
