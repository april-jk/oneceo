import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ok } from '../utils/http';
import type { HostService } from '../services/host-service';
import type { KvmOrchestratorConnector } from '../connectors/kvm-orchestrator-connector';
import type { HostStatus } from '../types';

const hostPatchSchema = z
  .object({
    name: z.string().min(1).optional(),
    region: z.string().min(1).optional(),
    status: z.enum(['online', 'degraded', 'offline', 'maintenance']).optional(),
    cpuCapacityCores: z.number().int().positive().max(4096).optional(),
    memoryCapacityGb: z.number().int().positive().max(65536).optional(),
    storageCapacityGb: z.number().int().positive().max(200000).optional(),
    hypervisor: z.string().min(1).optional(),
    managementIp: z.string().min(1).optional(),
    notes: z.string().max(500).optional(),
  })
  .refine((payload) => Object.keys(payload).length > 0, '至少提供一个更新字段');

function isOnlineStatus(status: HostStatus): boolean {
  return status === 'online' || status === 'degraded';
}

export function createHostRoutes(hostService: HostService, connector: KvmOrchestratorConnector) {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      const [vmResult, healthResult] = await Promise.allSettled([
        connector.listVms({ limit: 500, offset: 0 }),
        connector.health(),
      ]);

      const vms = vmResult.status === 'fulfilled' ? vmResult.value.vms : [];
      const online = healthResult.status === 'fulfilled' && healthResult.value.status.toLowerCase() === 'ok';
      const hosts = await hostService.buildHostRuntime(vms, online);

      return ok(res, {
        online,
        total: hosts.length,
        hosts,
      });
    })
  );

  router.patch(
    '/:hostId',
    asyncHandler(async (req, res) => {
      const payload = hostPatchSchema.parse(req.body);
      const host = await hostService.updateHost(req.params.hostId, payload);

      if (payload.status && isOnlineStatus(payload.status)) {
        await connector.health().catch(() => null);
      }

      return ok(res, host);
    })
  );

  return router;
}