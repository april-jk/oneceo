import { Router } from 'express';
import { asyncHandler, fail, ok } from '../utils/http';
import type { KvmOrchestratorConnector } from '../connectors/kvm-orchestrator-connector';

export function createHostRoutes(connector: KvmOrchestratorConnector) {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      const healthResult = await connector.health().catch(() => null);
      const online = Boolean(healthResult && healthResult.status.toLowerCase() === 'ok');

      return ok(res, {
        online,
        total: 0,
        hosts: [],
      });
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
