import { Router } from 'express';
import type { AgentManagementService } from '../services/agent-management-service';
import { asyncHandler, ok } from '../utils/http';

export function createAgentManagementRoutes(service: AgentManagementService) {
  const router = Router();

  router.get(
    '/overview',
    asyncHandler(async (_req, res) => {
      const result = await service.getOverview();
      return ok(res, result);
    })
  );

  return router;
}

