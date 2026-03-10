import { Router } from 'express';
import { asyncHandler, fail, ok } from '../utils/http';
import type { HostRuntimeService } from '../services/host-runtime-service';

export function createHostRoutes(hostRuntimeService: HostRuntimeService) {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      const result = await hostRuntimeService.listHosts();
      return ok(res, result);
    })
  );

  router.patch(
    '/:hostId',
    asyncHandler(async (req, res) => {
      return fail(
        res,
        501,
        `Host management API is not provided by kvm-orchestrator v1 yet`,
        { hostId: req.params.hostId }
      );
    })
  );

  return router;
}
