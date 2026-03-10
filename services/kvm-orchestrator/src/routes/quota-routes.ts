import { Router } from 'express';
import { ok } from '../utils/response';
import { service } from './service-registry';

const router = Router();

router.get('/:sessionId', async (req, res) => {
  const quota = await service.getQuota(req.params.sessionId);
  return ok(res, {
    quota_id: `quota-${req.params.sessionId}`,
    session_id: req.params.sessionId,
    cpu: {
      cores: quota.quota.cpu.allocated,
      max_cores: Math.max(quota.quota.cpu.allocated, 8),
      usage_percent: quota.quota.cpu.percent,
    },
    memory: {
      mb: quota.quota.memory.allocatedMb,
      max_mb: Math.max(quota.quota.memory.allocatedMb, 8192),
      usage_mb: quota.quota.memory.usedMb,
    },
    storage: {
      gb: quota.quota.storage.allocatedGb,
      max_gb: Math.max(quota.quota.storage.allocatedGb, 100),
      usage_gb: quota.quota.storage.usedGb,
    },
  });
});

router.put('/:sessionId', async (req, res) => {
  const quota = await service.updateQuota(req.params.sessionId, {
    cpuCores: req.body?.cpu_cores,
    memoryMb: req.body?.memory_mb,
    storageGb: req.body?.storage_gb,
  });

  return ok(res, {
    quota_id: `quota-${req.params.sessionId}`,
    cpu_cores: quota.cpuCores,
    memory_mb: quota.memoryMb,
    storage_gb: quota.storageGb,
    updated_at: quota.updatedAt,
  });
});

export default router;
