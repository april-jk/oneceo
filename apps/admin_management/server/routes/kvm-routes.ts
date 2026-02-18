import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ok } from '../utils/http';
import type { KvmService } from '../services/kvm-service';

const vmQuerySchema = z.object({
  state: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  withState: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((value) => value === 'true'),
});

const createVmSchema = z.object({
  sessionId: z.string().min(1),
  cpuCores: z.number().int().min(1).max(64).optional(),
  memoryMb: z.number().int().min(512).max(262144).optional(),
  rootDiskGb: z.number().int().min(5).max(4096).optional(),
  tags: z.record(z.string(), z.string()).optional(),
});

const powerSchema = z.object({
  action: z.enum(['start', 'stop']),
  force: z.boolean().optional(),
  operator: z.string().min(1).optional(),
});

export function createKvmRoutes(kvmService: KvmService) {
  const router = Router();

  router.get(
    '/health',
    asyncHandler(async (_req, res) => {
      const sessions = await kvmService.listSessions().catch(() => ({ total: 0, sessions: [] }));
      return ok(res, {
        online: true,
        sessionTotal: sessions.total,
      });
    })
  );

  router.get(
    '/vms',
    asyncHandler(async (req, res) => {
      const query = vmQuerySchema.parse(req.query);
      const result = await kvmService.listVms({
        state: query.state,
        limit: query.limit,
        offset: query.offset,
        withState: query.withState,
      });

      return ok(res, result);
    })
  );

  router.post(
    '/vms',
    asyncHandler(async (req, res) => {
      const payload = createVmSchema.parse(req.body);
      const vm = await kvmService.createVm(payload);
      return ok(res, vm);
    })
  );

  router.get(
    '/vms/:vmId',
    asyncHandler(async (req, res) => {
      const vm = await kvmService.getVmDetail(req.params.vmId);
      return ok(res, vm);
    })
  );

  router.post(
    '/vms/:vmId/power',
    asyncHandler(async (req, res) => {
      const payload = powerSchema.parse(req.body);
      const result = await kvmService.powerVm(req.params.vmId, payload.action, payload.operator, payload.force);
      return ok(res, result);
    })
  );

  router.get(
    '/sessions',
    asyncHandler(async (_req, res) => {
      const sessions = await kvmService.listSessions();
      return ok(res, sessions);
    })
  );

  router.get(
    '/sessions/:sessionId/quota',
    asyncHandler(async (req, res) => {
      const quota = await kvmService.getQuota(req.params.sessionId);
      return ok(res, quota);
    })
  );

  return router;
}