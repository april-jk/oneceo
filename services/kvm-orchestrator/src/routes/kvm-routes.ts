import { Router } from 'express';
import { z } from 'zod';
import { ok } from '../utils/response';
import { service } from './service-registry';

const router = Router();

const createVmSchema = z.object({
  session_id: z.string().min(1),
  cpu_cores: z.number().int().min(1).max(32).optional(),
  memory_mb: z.number().int().min(512).max(262144).optional(),
  root_disk_gb: z.number().int().min(5).max(2000).optional(),
  tags: z.record(z.string(), z.string()).optional(),
});

router.post('/create', async (req, res) => {
  const parsed = createVmSchema.parse(req.body);
  const vm = await service.createVm({
    sessionId: parsed.session_id,
    cpuCores: parsed.cpu_cores,
    memoryMb: parsed.memory_mb,
    rootDiskGb: parsed.root_disk_gb,
    tags: parsed.tags,
  });

  return ok(res, {
    vm_id: vm.vmId,
    session_id: vm.sessionId,
    name: vm.name,
    state: vm.state,
    config: {
      cpu_cores: vm.cpuCores,
      memory_mb: vm.memoryMb,
      root_disk_gb: vm.rootDiskGb,
      network_bridge: vm.networkBridge,
    },
    created_at: vm.createdAt,
  });
});

router.post('/:vmId/start', async (req, res) => {
  const vm = await service.startVm(req.params.vmId, Boolean(req.body?.wait_ready));
  return ok(res, {
    vm_id: vm.vmId,
    state: vm.state,
    ip_address: vm.ipAddress,
    started_at: vm.startedAt,
  });
});

router.post('/:vmId/stop', async (req, res) => {
  const vm = await service.stopVm(req.params.vmId, Boolean(req.body?.force));
  return ok(res, {
    vm_id: vm.vmId,
    state: vm.state,
    stopped_at: vm.stoppedAt,
  });
});

router.delete('/:vmId', async (req, res) => {
  const result = await service.deleteVm(req.params.vmId, req.body?.cleanup_storage !== false);
  return ok(res, {
    vm_id: result.vmId,
    deleted_at: new Date().toISOString(),
    storage_freed_gb: result.storageFreedGb,
  });
});

router.get('/list', async (req, res) => {
  const result = await service.listVms({
    state: req.query.state as any,
    sessionId: req.query.session_id as string | undefined,
    limit: Number(req.query.limit || 10),
    offset: Number(req.query.offset || 0),
  });

  return ok(res, {
    total: result.total,
    limit: result.limit,
    offset: result.offset,
    vms: result.vms.map((vm) => ({
      vm_id: vm.vmId,
      session_id: vm.sessionId,
      state: vm.state,
      cpu_cores: vm.cpuCores,
      memory_mb: vm.memoryMb,
      created_at: vm.createdAt,
    })),
  });
});

router.get('/:vmId', async (req, res) => {
  const vm = await service.getVm(req.params.vmId);
  const state = await service.getVmState(req.params.vmId);
  return ok(res, {
    vm_id: vm.vmId,
    session_id: vm.sessionId,
    name: vm.name,
    state: vm.state,
    config: {
      cpu_cores: vm.cpuCores,
      memory_mb: vm.memoryMb,
      root_disk_gb: vm.rootDiskGb,
    },
    state_info: {
      uptime_seconds: state.uptimeSeconds,
      cpu_usage_percent: state.cpuUsagePercent,
      memory_usage_mb: state.memoryUsageMb,
      disk_usage_gb: state.diskUsageGb,
    },
    network: {
      ip_address: vm.ipAddress,
      mac_address: vm.macAddress,
    },
    created_at: vm.createdAt,
  });
});

router.post('/:vmId/resize', async (req, res) => {
  const vm = await service.resizeVm(req.params.vmId, {
    cpuCores: req.body?.cpu_cores,
    memoryMb: req.body?.memory_mb,
    rootDiskGb: req.body?.root_disk_gb,
  });
  return ok(res, {
    vm_id: vm.vmId,
    config: {
      cpu_cores: vm.cpuCores,
      memory_mb: vm.memoryMb,
      root_disk_gb: vm.rootDiskGb,
    },
    requires_reboot: true,
  });
});

router.post('/:vmId/snapshot', async (req, res) => {
  const snapshot = await service.createSnapshot(req.params.vmId, req.body?.name || `snapshot-${Date.now()}`, req.body?.description);
  return ok(res, {
    snapshot_id: snapshot.snapshotId,
    vm_id: snapshot.vmId,
    name: snapshot.name,
    created_at: snapshot.createdAt,
    size_gb: snapshot.sizeGb,
  });
});

router.post('/:vmId/snapshot/:snapshotId/restore', async (req, res) => {
  await service.restoreSnapshot(req.params.vmId, req.params.snapshotId);
  return ok(res, {
    vm_id: req.params.vmId,
    snapshot_id: req.params.snapshotId,
    restored_at: new Date().toISOString(),
  });
});

router.get('/:vmId/snapshots', async (req, res) => {
  const vm = await service.getVm(req.params.vmId);
  return ok(res, {
    vm_id: vm.vmId,
    snapshots: vm.snapshots.map((snap) => ({
      snapshot_id: snap.snapshotId,
      name: snap.name,
      created_at: snap.createdAt,
      size_gb: snap.sizeGb,
    })),
  });
});

router.delete('/:vmId/snapshot/:snapshotId', async (req, res) => {
  const snapshot = await service.deleteSnapshot(req.params.vmId, req.params.snapshotId);
  return ok(res, {
    snapshot_id: snapshot.snapshotId,
    deleted_at: new Date().toISOString(),
    storage_freed_gb: snapshot.sizeGb,
  });
});

router.get('/:vmId/state', async (req, res) => {
  const state = await service.getVmState(req.params.vmId);
  return ok(res, {
    vm_id: state.vmId,
    state: state.state,
    uptime_seconds: state.uptimeSeconds,
    cpu_usage_percent: state.cpuUsagePercent,
    memory_usage_mb: state.memoryUsageMb,
    disk_usage_gb: state.diskUsageGb,
    network: {
      in_bytes: state.network.inBytes,
      out_bytes: state.network.outBytes,
    },
    last_update: state.lastUpdate,
  });
});

router.get('/:vmId/logs', async (req, res) => {
  const result = await service.getVmLogs(req.params.vmId, Number(req.query.lines || 100));
  return ok(res, {
    vm_id: result.vmId,
    logs: result.logs,
  });
});

export default router;
