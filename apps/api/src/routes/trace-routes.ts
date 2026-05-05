import { Router } from 'express';
import { z } from 'zod';
import { sessionApiTraceDAO } from '../db/dao/session-api-trace.dao';
import { apiRequestLogDAO } from '../db/dao/api-request-log.dao';
import { createRequireInternalToken } from './internal-auth-middleware';
import { getPublicErrorMessage } from '../utils/error-response';

const router = Router();
const requireInternalToken = createRequireInternalToken();

const listQuerySchema = z.object({
  sessionId: z.string().uuid(),
  type: z.enum(['llm_request', 'tool_call', 'service_api', 'connector_api']).optional(),
  toolName: z.string().optional(),
  model: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(100),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

const aggregateQuerySchema = z.object({
  type: z.enum(['llm_request', 'tool_call', 'service_api', 'connector_api']).optional(),
  toolName: z.string().optional(),
  model: z.string().optional(),
  sessionId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  groupBy: z.enum(['tool_name', 'model', 'service_name', 'trace_type']).optional().default('trace_type'),
  limit: z.coerce.number().int().min(1).max(500).optional().default(100),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

const statsQuerySchema = z.object({
  type: z.enum(['llm_request', 'tool_call', 'service_api', 'connector_api']).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

const trendQuerySchema = z.object({
  type: z.enum(['llm_request', 'tool_call', 'service_api', 'connector_api']).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  interval: z.enum(['hour', 'day']).optional().default('hour'),
});

function parseQuery<T extends z.ZodTypeAny>(schema: T, input: unknown) {
  const result = schema.safeParse(input);
  if (!result.success) {
    return {
      ok: false as const,
      error: result.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '),
    };
  }
  return { ok: true as const, data: result.data as z.infer<T> };
}

router.get('/traces', requireInternalToken, async (req, res) => {
  const parsed = parseQuery(listQuerySchema, req.query);
  if (!parsed.ok) {
    res.status(400).json({ success: false, error: `参数校验失败: ${parsed.error}` });
    return;
  }
  const query = parsed.data;
  try {
    const traces = await sessionApiTraceDAO.findBySessionId(query.sessionId, {
      type: query.type,
      toolName: query.toolName,
      model: query.model,
      limit: query.limit,
      offset: query.offset,
    });
    const total = await sessionApiTraceDAO.countBySessionId(query.sessionId, {
      type: query.type,
      toolName: query.toolName,
      model: query.model,
    });
    res.json({
      success: true,
      data: {
        total,
        limit: query.limit,
        offset: query.offset,
        traces,
      },
    });
  } catch (error) {
    console.warn('[trace-routes] list traces failed', error);
    res.status(500).json({ success: false, error: getPublicErrorMessage('查询失败') });
  }
});

router.get('/traces/aggregate', requireInternalToken, async (req, res) => {
  const parsed = parseQuery(aggregateQuerySchema, req.query);
  if (!parsed.ok) {
    res.status(400).json({ success: false, error: `参数校验失败: ${parsed.error}` });
    return;
  }
  const query = parsed.data;
  try {
    const result = await sessionApiTraceDAO.aggregate({
      type: query.type,
      toolName: query.toolName,
      model: query.model,
      sessionId: query.sessionId,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      groupBy: query.groupBy,
      limit: query.limit,
      offset: query.offset,
    });
    res.json({ success: true, data: result });
  } catch (error) {
    console.warn('[trace-routes] aggregate failed', error);
    res.status(500).json({ success: false, error: getPublicErrorMessage('聚合查询失败') });
  }
});

router.get('/traces/stats', requireInternalToken, async (req, res) => {
  const parsed = parseQuery(statsQuerySchema, req.query);
  if (!parsed.ok) {
    res.status(400).json({ success: false, error: `参数校验失败: ${parsed.error}` });
    return;
  }
  const query = parsed.data;
  try {
    const stats = await sessionApiTraceDAO.stats({
      type: query.type,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    });
    res.json({ success: true, data: stats });
  } catch (error) {
    console.warn('[trace-routes] stats failed', error);
    res.status(500).json({ success: false, error: getPublicErrorMessage('统计查询失败') });
  }
});

router.get('/traces/trend', requireInternalToken, async (req, res) => {
  const parsed = parseQuery(trendQuerySchema, req.query);
  if (!parsed.ok) {
    res.status(400).json({ success: false, error: `参数校验失败: ${parsed.error}` });
    return;
  }
  const query = parsed.data;
  try {
    const result = await sessionApiTraceDAO.trend({
      type: query.type,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      interval: query.interval,
    });
    res.json({ success: true, data: result });
  } catch (error) {
    console.warn('[trace-routes] trend failed', error);
    res.status(500).json({ success: false, error: getPublicErrorMessage('趋势查询失败') });
  }
});

// API 请求日志查询路由
const requestLogQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  method: z.string().optional(),
  path: z.string().optional(),
  status: z.coerce.number().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

router.get('/request-logs', requireInternalToken, async (req, res) => {
  const parsed = parseQuery(requestLogQuerySchema, req.query);
  if (!parsed.ok) {
    res.status(400).json({ success: false, error: `参数校验失败: ${parsed.error}` });
    return;
  }
  const query = parsed.data;
  try {
    const result = await apiRequestLogDAO.list({
      userId: query.userId,
      method: query.method,
      path: query.path,
      status: query.status,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      limit: query.limit,
      offset: query.offset,
    });
    res.json({
      success: true,
      data: {
        total: result.total,
        limit: query.limit,
        offset: query.offset,
        entries: result.entries,
      },
    });
  } catch (error) {
    console.warn('[trace-routes] list request logs failed', error);
    res.status(500).json({ success: false, error: getPublicErrorMessage('查询失败') });
  }
});

router.get('/request-logs/:logId', requireInternalToken, async (req, res) => {
  try {
    const log = await apiRequestLogDAO.findById(req.params.logId);
    if (!log) {
      res.status(404).json({ success: false, error: '记录不存在' });
      return;
    }
    res.json({ success: true, data: log });
  } catch (error) {
    console.warn('[trace-routes] get request log detail failed', error);
    res.status(500).json({ success: false, error: getPublicErrorMessage('查询失败') });
  }
});

export default router;
