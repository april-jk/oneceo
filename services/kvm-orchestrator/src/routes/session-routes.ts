import { Router } from 'express';
import { z } from 'zod';
import { ok } from '../utils/response';
import { service } from './service-registry';

const router = Router();

const createSessionSchema = z.object({
  user_id: z.string().min(1),
  project_id: z.string().optional(),
  agent_type: z.string().optional(),
  config: z
    .object({
      timeout_minutes: z.number().int().positive().optional(),
    })
    .optional(),
  resource_quota: z
    .object({
      cpu_cores: z.number().int().positive().optional(),
      memory_mb: z.number().int().positive().optional(),
      storage_gb: z.number().int().positive().optional(),
    })
    .optional(),
  tags: z.record(z.string(), z.string()).optional(),
});

router.post('/create', async (req, res) => {
  const parsed = createSessionSchema.parse(req.body);
  const session = await service.createSession({
    userId: parsed.user_id,
    projectId: parsed.project_id,
    agentType: parsed.agent_type,
    config: {
      timeoutMinutes: parsed.config?.timeout_minutes,
    },
    resourceQuota: {
      cpuCores: parsed.resource_quota?.cpu_cores,
      memoryMb: parsed.resource_quota?.memory_mb,
      storageGb: parsed.resource_quota?.storage_gb,
    },
    tags: parsed.tags,
  });

  return ok(res, {
    session_id: session.sessionId,
    user_id: session.userId,
    project_id: session.projectId,
    agent_id: session.agentId,
    vm_id: session.vmId,
    status: session.status,
    agent_ws_url: null,
    agent_token: null,
    created_at: session.createdAt,
    expires_at: session.expiresAt,
  });
});

router.get('/list', async (req, res) => {
  const result = await service.listSessions({
    userId: req.query.user_id as string | undefined,
    projectId: req.query.project_id as string | undefined,
    status: req.query.status as any,
    limit: Number(req.query.limit || 10),
    offset: Number(req.query.offset || 0),
  });

  return ok(res, {
    total: result.total,
    limit: result.limit,
    offset: result.offset,
    sessions: result.sessions.map((session) => ({
      session_id: session.sessionId,
      user_id: session.userId,
      status: session.status,
      vm_id: session.vmId,
      created_at: session.createdAt,
    })),
  });
});

router.get('/:sessionId', async (req, res) => {
  const session = await service.getSession(req.params.sessionId);
  const quota = await service.getQuota(req.params.sessionId).catch(() => null);
  return ok(res, {
    session_id: session.sessionId,
    user_id: session.userId,
    project_id: session.projectId,
    agent_id: session.agentId,
    vm_id: session.vmId,
    status: session.status,
    agent_status: session.status === 'terminated' ? 'disconnected' : 'connected',
    vm_status: session.vmId ? 'running' : 'stopped',
    created_at: session.createdAt,
    expires_at: session.expiresAt,
    last_activity: session.lastActivity,
    resource_usage: quota?.quota || null,
  });
});

router.put('/:sessionId', async (req, res) => {
  const session = await service.updateSession(req.params.sessionId, {
    config: {
      timeoutMinutes: req.body?.config?.timeout_minutes,
    },
    tags: req.body?.tags,
  });
  return ok(res, {
    session_id: session.sessionId,
    updated_at: session.updatedAt,
  });
});

router.post('/:sessionId/close', async (req, res) => {
  const result = await service.closeSession(req.params.sessionId);
  return ok(res, {
    session_id: result.session.sessionId,
    status: result.session.status,
    vm_id: result.vm?.vmId,
    vm_status: result.vm?.state,
    closed_at: new Date().toISOString(),
  });
});

router.post('/:sessionId/graceful-shutdown', async (req, res) => {
  const result = await service.closeSession(req.params.sessionId);
  return ok(res, {
    session_id: result.session.sessionId,
    status: result.session.status,
    closed_at: new Date().toISOString(),
  });
});

router.post('/:sessionId/bind-kvm', async (req, res) => {
  const binding = await service.bindKvm(req.params.sessionId, req.body?.vm_id);
  return ok(res, {
    binding_id: binding.bindingId,
    session_id: binding.sessionId,
    vm_id: binding.vmId,
    agent_id: binding.agentId,
    status: binding.status,
    bound_at: binding.boundAt,
  });
});

router.post('/:sessionId/unbind-kvm', async (req, res) => {
  const result = await service.unbindKvm(req.params.sessionId);
  return ok(res, {
    session_id: result.sessionId,
    vm_id: result.vmId,
    unbound_at: result.unboundAt,
  });
});

router.get('/:sessionId/binding', async (req, res) => {
  const binding = await service.getBinding(req.params.sessionId);
  return ok(res, {
    binding_id: binding.bindingId,
    session_id: binding.sessionId,
    vm_id: binding.vmId,
    agent_id: binding.agentId,
    status: binding.status,
    bound_at: binding.boundAt,
    vm_info: {
      state: binding.vmInfo.state,
      ip_address: binding.vmInfo.ipAddress,
      cpu_usage: binding.vmInfo.cpuUsage,
      memory_usage_mb: binding.vmInfo.memoryUsageMb,
    },
  });
});

router.post('/:sessionId/recover', async (req, res) => {
  const result = await service.recoverSession(req.params.sessionId);
  return ok(res, {
    session_id: result.sessionId,
    recovered_at: result.recoveredAt,
    recovery_type: result.recoveryType,
    data_preserved: result.dataPreserved,
  });
});

router.get('/:sessionId/events', async (req, res) => {
  const events = await service.getSessionEvents(req.params.sessionId, Number(req.query.limit || 100));
  return ok(res, {
    session_id: req.params.sessionId,
    events: events.map((event) => ({
      event_id: event.eventId,
      type: event.type,
      timestamp: event.timestamp,
      details: event.details,
    })),
  });
});

export default router;
