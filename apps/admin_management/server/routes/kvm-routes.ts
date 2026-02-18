import type { Request } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ok } from '../utils/http';
import type { KvmService } from '../services/kvm-service';
import type { VmAction } from '../types';

const toBooleanOptional = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return value;
}, z.boolean().optional());

const vmQuerySchema = z.object({
  state: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  withState: toBooleanOptional,
});

const createVmSchema = z.object({
  sessionId: z.string().min(1),
  cpuCores: z.number().int().min(1).max(64).optional(),
  memoryMb: z.number().int().min(512).max(262144).optional(),
  rootDiskGb: z.number().int().min(5).max(4096).optional(),
  tags: z.record(z.string(), z.string()).optional(),
});

const vmActionSchema = z.object({
  action: z.enum(['start', 'shutdown', 'reboot', 'suspend', 'resume', 'stop']),
  async: z.boolean().optional(),
  operator: z.string().min(1).optional(),
});

const powerSchema = z.object({
  action: z.enum(['start', 'stop']),
  force: z.boolean().optional(),
  operator: z.string().min(1).optional(),
});

const sessionCreateSchema = z.object({
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const bindSchema = z.object({
  vmName: z.string().min(1).optional(),
  autoAllocate: z.boolean().optional(),
});

const closeSessionSchema = z.object({
  gracefulShutdown: z.boolean().optional(),
});

const quotaSchema = z.object({
  maxActionsPerMinute: z.number().int().min(1).max(10000),
  maxRuntimeMinutes: z.number().int().min(1).max(100000),
  maxRebootsPerHour: z.number().int().min(1).max(10000),
});

const execSchema = z.object({
  path: z.string().min(1),
  args: z.array(z.string()).optional(),
  captureOutput: z.boolean().optional(),
  timeoutSeconds: z.number().int().min(1).max(600).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

const snapshotCreateSchema = z.object({
  snapshotName: z.string().min(1),
  description: z.string().optional(),
});

const snapshotRestoreSchema = z.object({
  targetState: z.string().optional(),
});

const sandboxCreateSchema = z.object({
  sessionId: z.string().optional(),
  vmName: z.string().optional(),
  baseImage: z.string().optional(),
  memoryMb: z.number().int().positive().optional(),
  vcpus: z.number().int().positive().optional(),
  network: z.string().optional(),
  osVariant: z.string().optional(),
  autoBind: z.boolean().optional(),
  start: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const sandboxRestartSchema = z.object({
  gracefulShutdown: z.boolean().optional(),
  start: z.boolean().optional(),
});

const sandboxPortCreateSchema = z.object({
  vmPort: z.number().int().min(1).max(65535),
  hostPort: z.number().int().min(1).max(65535),
  protocol: z.string().optional(),
  hostIp: z.string().optional(),
});

const wsQuerySchema = z.object({
  replayLast: z.coerce.number().int().min(0).max(200).optional(),
});

const logQuerySchema = z.object({
  lines: z.coerce.number().int().min(1).max(5000).optional(),
});

const vmIpQuerySchema = z.object({
  refresh: toBooleanOptional,
});

const sandboxIpQuerySchema = z.object({
  refresh: toBooleanOptional,
});

const sandboxPortsListQuerySchema = z.object({
  refresh: toBooleanOptional,
  verify: toBooleanOptional,
  waitSeconds: z.coerce.number().int().min(0).max(60).optional(),
});

const sandboxDeleteQuerySchema = z.object({
  deleteStorage: toBooleanOptional,
});

const sandboxDeletePortQuerySchema = z.object({
  hostPort: z.coerce.number().int().min(1).max(65535),
  protocol: z.string().optional(),
  hostIp: z.string().optional(),
  vmPort: z.coerce.number().int().min(1).max(65535).optional(),
});

const fileDeleteQuerySchema = z.object({
  targetPath: z.string().min(1),
  recursive: toBooleanOptional,
  ignoreMissing: toBooleanOptional,
  sessionId: z.string().optional(),
  deliveryMode: z.string().optional(),
});

function toPassthroughQuery(query: Request['query']): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(query)) {
    const picked = Array.isArray(value) ? value[0] : value;
    if (picked === undefined) {
      continue;
    }
    output[key] = picked;
  }
  return output;
}

async function readRequestBody(req: Request): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export function createKvmRoutes(kvmService: KvmService) {
  const router = Router();

  router.get(
    '/health',
    asyncHandler(async (_req, res) => {
      const health = await kvmService.health();
      return ok(res, {
        online: health.status.toLowerCase() === 'ok',
        status: health.status,
        service: health.service,
        timestamp: health.timestamp,
      });
    })
  );

  router.get(
    '/events/ws-url',
    asyncHandler(async (req, res) => {
      const query = wsQuerySchema.parse(req.query);
      return ok(res, kvmService.getEventsWsUrl(query.replayLast));
    })
  );

  router.get(
    '/jobs/:jobId',
    asyncHandler(async (req, res) => {
      const job = await kvmService.getJob(req.params.jobId);
      return ok(res, job);
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

  router.get(
    '/vms/:vmId/ip',
    asyncHandler(async (req, res) => {
      const query = vmIpQuerySchema.parse(req.query);
      const vmIp = await kvmService.getVmIp(req.params.vmId, query.refresh);
      return ok(res, vmIp);
    })
  );

  router.get(
    '/vms/:vmId/metrics',
    asyncHandler(async (req, res) => {
      const metrics = await kvmService.getVmMetrics(req.params.vmId);
      return ok(res, metrics);
    })
  );

  router.get(
    '/vms/:vmId/logs',
    asyncHandler(async (req, res) => {
      const query = logQuerySchema.parse(req.query);
      const logs = await kvmService.getVmLogs(req.params.vmId, query.lines ?? 100);
      return ok(res, logs);
    })
  );

  router.post(
    '/vms/:vmId/action',
    asyncHandler(async (req, res) => {
      const payload = vmActionSchema.parse(req.body);
      const result = await kvmService.runVmAction(req.params.vmId, payload.action as VmAction, {
        async: payload.async,
        operator: payload.operator,
        idempotencyKey: req.header('idempotency-key') || undefined,
      });
      return ok(res, result);
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

  router.post(
    '/vms/:vmId/exec',
    asyncHandler(async (req, res) => {
      const payload = execSchema.parse(req.body);
      const result = await kvmService.vmExec(req.params.vmId, payload);
      return ok(res, result);
    })
  );

  router.post(
    '/vms/:vmId/files',
    asyncHandler(async (req, res) => {
      const contentType = req.header('content-type') || 'application/octet-stream';
      const bodyBuffer = await readRequestBody(req);
      const result = await kvmService.uploadVmFiles(
        req.params.vmId,
        bodyBuffer,
        contentType,
        toPassthroughQuery(req.query),
        req.header('idempotency-key') || undefined
      );
      return ok(res, result);
    })
  );

  router.delete(
    '/vms/:vmId/files',
    asyncHandler(async (req, res) => {
      const query = fileDeleteQuerySchema.parse(req.query);
      const result = await kvmService.deleteVmFiles(req.params.vmId, query);
      return ok(res, result);
    })
  );

  router.get(
    '/vms/:vmId/snapshots',
    asyncHandler(async (req, res) => {
      const snapshots = await kvmService.listVmSnapshots(req.params.vmId);
      return ok(res, snapshots);
    })
  );

  router.post(
    '/vms/:vmId/snapshots',
    asyncHandler(async (req, res) => {
      const payload = snapshotCreateSchema.parse(req.body);
      const result = await kvmService.createVmSnapshot(req.params.vmId, payload);
      return ok(res, result);
    })
  );

  router.post(
    '/vms/:vmId/snapshots/:snapshotName/restore',
    asyncHandler(async (req, res) => {
      const payload = snapshotRestoreSchema.parse(req.body || {});
      const result = await kvmService.restoreVmSnapshot(req.params.vmId, req.params.snapshotName, payload);
      return ok(res, result);
    })
  );

  router.delete(
    '/vms/:vmId/snapshots/:snapshotName',
    asyncHandler(async (req, res) => {
      const result = await kvmService.deleteVmSnapshot(req.params.vmId, req.params.snapshotName);
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

  router.post(
    '/sessions',
    asyncHandler(async (req, res) => {
      const payload = sessionCreateSchema.parse(req.body || {});
      const result = await kvmService.createSession(payload, req.header('idempotency-key') || undefined);
      return ok(res, result);
    })
  );

  router.get(
    '/sessions/:sessionId',
    asyncHandler(async (req, res) => {
      const result = await kvmService.getSession(req.params.sessionId);
      return ok(res, result);
    })
  );

  router.post(
    '/sessions/:sessionId/bind',
    asyncHandler(async (req, res) => {
      const payload = bindSchema.parse(req.body || {});
      const result = await kvmService.bindSession(req.params.sessionId, payload);
      return ok(res, result);
    })
  );

  router.get(
    '/sessions/:sessionId/vm',
    asyncHandler(async (req, res) => {
      const result = await kvmService.getSessionVm(req.params.sessionId);
      return ok(res, result);
    })
  );

  router.post(
    '/sessions/:sessionId/close',
    asyncHandler(async (req, res) => {
      const payload = closeSessionSchema.parse(req.body || {});
      const result = await kvmService.closeSession(req.params.sessionId, payload);
      return ok(res, result);
    })
  );

  router.get(
    '/sessions/:sessionId/quota',
    asyncHandler(async (req, res) => {
      const quota = await kvmService.getQuota(req.params.sessionId);
      return ok(res, quota);
    })
  );

  router.put(
    '/sessions/:sessionId/quota',
    asyncHandler(async (req, res) => {
      const payload = quotaSchema.parse(req.body);
      const quota = await kvmService.updateQuota(req.params.sessionId, payload);
      return ok(res, quota);
    })
  );

  router.post(
    '/sessions/:sessionId/exec',
    asyncHandler(async (req, res) => {
      const payload = execSchema.parse(req.body);
      const result = await kvmService.sessionExec(req.params.sessionId, payload);
      return ok(res, result);
    })
  );

  router.post(
    '/sessions/:sessionId/files',
    asyncHandler(async (req, res) => {
      const contentType = req.header('content-type') || 'application/octet-stream';
      const bodyBuffer = await readRequestBody(req);
      const result = await kvmService.uploadSessionFiles(
        req.params.sessionId,
        bodyBuffer,
        contentType,
        toPassthroughQuery(req.query),
        req.header('idempotency-key') || undefined
      );
      return ok(res, result);
    })
  );

  router.delete(
    '/sessions/:sessionId/files',
    asyncHandler(async (req, res) => {
      const query = fileDeleteQuerySchema.parse(req.query);
      const result = await kvmService.deleteSessionFiles(req.params.sessionId, query);
      return ok(res, result);
    })
  );

  router.post(
    '/sandboxes',
    asyncHandler(async (req, res) => {
      const payload = sandboxCreateSchema.parse(req.body || {});
      const result = await kvmService.createSandbox(payload, req.header('idempotency-key') || undefined);
      return ok(res, result);
    })
  );

  router.get(
    '/sandboxes/:sessionId',
    asyncHandler(async (req, res) => {
      const result = await kvmService.getSandbox(req.params.sessionId);
      return ok(res, result);
    })
  );

  router.get(
    '/sandboxes/:sessionId/ip',
    asyncHandler(async (req, res) => {
      const query = sandboxIpQuerySchema.parse(req.query);
      const result = await kvmService.getSandboxIp(req.params.sessionId, query.refresh);
      return ok(res, result);
    })
  );

  router.post(
    '/sandboxes/:sessionId/restart',
    asyncHandler(async (req, res) => {
      const payload = sandboxRestartSchema.parse(req.body || {});
      const result = await kvmService.restartSandbox(req.params.sessionId, payload);
      return ok(res, result);
    })
  );

  router.delete(
    '/sandboxes/:sessionId',
    asyncHandler(async (req, res) => {
      const query = sandboxDeleteQuerySchema.parse(req.query);
      const result = await kvmService.deleteSandbox(req.params.sessionId, query);
      return ok(res, result);
    })
  );

  router.post(
    '/sandboxes/:sessionId/ports',
    asyncHandler(async (req, res) => {
      const payload = sandboxPortCreateSchema.parse(req.body);
      const result = await kvmService.createSandboxPortMapping(req.params.sessionId, payload);
      return ok(res, result);
    })
  );

  router.get(
    '/sandboxes/:sessionId/ports',
    asyncHandler(async (req, res) => {
      const query = sandboxPortsListQuerySchema.parse(req.query);
      const result = await kvmService.listSandboxPortMappings(req.params.sessionId, query);
      return ok(res, result);
    })
  );

  router.delete(
    '/sandboxes/:sessionId/ports',
    asyncHandler(async (req, res) => {
      const query = sandboxDeletePortQuerySchema.parse(req.query);
      const result = await kvmService.deleteSandboxPortMapping(req.params.sessionId, query);
      return ok(res, result);
    })
  );

  return router;
}

