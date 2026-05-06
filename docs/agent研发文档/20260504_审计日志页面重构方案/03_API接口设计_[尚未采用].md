# 03 API 接口设计 [尚未采用]

## 更新时间

2026-05-04

## 1. 服务端：请求记录 Middleware

### 1.1 挂载位置

`apps/api/src/index.ts`，在 `appAuthMiddleware` 之后、路由注册之前：

```typescript
// 在 appAuthMiddleware 之后
app.use(appAuthMiddleware);
app.use(requestLogMiddleware); // 新增
```

原因：
- `appAuthMiddleware` 解析用户身份后，`req.user.id` 才可用
- 必须在路由处理之前挂载，才能捕获到请求开始时间
- 需要监听 `res.on('finish')` 来计算耗时

### 1.2 Middleware 实现要点

```typescript
// apps/api/src/middleware/request-log-middleware.ts
export async function requestLogMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const appUserId = (req as any).user?.id;
  if (!appUserId) {
    next(); // 未登录请求不记录
    return;
  }

  const startTime = Date.now();
  const record = {
    appUserId,
    method: req.method,
    path: req.path,
    queryString: sanitizeQueryString(req.query),
    requestHeaders: sanitizeHeaders(req.headers),
    requestBodySummary: extractBodySummary(req.body),
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  };

  // 重写 res.end 以捕获响应状态
  const originalEnd = res.end.bind(res);
  res.end = function(chunk: any, encoding?: any) {
    res.end = originalEnd;
    res.end(chunk, encoding);

    record.durationMs = Date.now() - startTime;
    record.responseStatus = res.statusCode;
    record.responseBodySummary = extractResponseSummary(chunk);
    // 异步写入，不阻塞响应
    apiRequestLogService.append(record).catch(() => {});
  } as any;

  next();
}
```

### 1.3 排除路径

以下路径不记录：
- `/health`（健康检查）
- `/api/llm-proxy/*`（LLM 代理走独立 trace 体系）
- 静态资源文件（以 `.js`, `.css`, `.png` 等结尾）
- `/api/internal/*`（内部管理接口，有独立审计）

## 2. 查询 API

### 2.1 按用户查询 HTTP 请求日志

**Endpoint**: `GET /api/internal/admin/request-logs`

**Query Parameters**:
```typescript
{
  userId?: string;           // 筛选特定用户
  method?: string;           // GET, POST, PUT, DELETE
  path?: string;             // 模糊匹配路径，如 /api/task-creation
  status?: number;           // 响应状态码
  from?: string;             // ISO 时间，开始时间
  to?: string;               // ISO 时间，结束时间
  limit?: number;            // 默认 50，最大 500
  offset?: number;           // 默认 0
}
```

**Response**:
```typescript
{
  total: number;
  limit: number;
  offset: number;
  entries: Array<{
    id: string;
    appUserId: string;
    method: string;
    path: string;
    queryString: string | null;
    responseStatus: number | null;
    durationMs: number | null;
    taskSessionId: string | null;
    createdAt: string;
  }>;
}
```

### 2.2 查询单条请求详情

**Endpoint**: `GET /api/internal/admin/request-logs/:logId`

**Response**:
```typescript
{
  id: string;
  appUserId: string;
  method: string;
  path: string;
  queryString: string | null;
  requestHeaders: Record<string, unknown>;
  requestBodySummary: string | null;  // JSON 字符串
  responseStatus: number | null;
  responseBodySummary: string | null; // JSON 字符串
  durationMs: number | null;
  ipAddress: string | null;
  userAgent: string | null;
  taskSessionId: string | null;
  metadataJson: Record<string, unknown>;
  createdAt: string;
}
```

### 2.3 按用户查询会话列表（带 AI Trace 统计）

**Endpoint**: `GET /api/internal/admin/users/:userId/sessions`

复用现有对话管理接口，补充 trace 统计：

```typescript
{
  total: number;
  limit: number;
  offset: number;
  sessions: Array<{
    id: string;
    title: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    traceSummary: {
      totalTraces: number;
      llmRequests: number;
      toolCalls: number;
      errors: number;
    };
  }>;
}
```

### 2.4 查询会话 AI Trace（复用现有）

已有接口：`GET /api/conversations/sessions/:sessionId/api-traces`

无需新增，在管理后台审计页面直接复用。

## 3. Admin Management 代理层

`apps/admin_management/server/` 新增路由，将管理后台请求代理到 API 侧：

```typescript
// apps/admin_management/server/routes/audit-routes.ts
router.get('/request-logs', asyncHandler(async (req, res) => {
  const result = await oneceoApiConnector.listRequestLogs(req.query);
  return ok(res, result);
}));

router.get('/request-logs/:logId', asyncHandler(async (req, res) => {
  const result = await oneceoApiConnector.getRequestLogDetail(req.params.logId);
  return ok(res, result);
}));
```
