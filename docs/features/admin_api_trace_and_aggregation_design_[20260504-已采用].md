# 会话全链路 API 追踪与聚合查询设计 [20260504-已采用]

> 创建日期：2026-05-04
> 关联需求：管理员后台查看用户对话后程序的一切详细输出（API 调用、工具调用等）

---

## 1. 需求概述

在现有对话追踪基础上，管理员后台需要看到用户对话后程序的**一切详细输出**，包括：
- **A. LLM 代理层面**：每次调用上游模型（OpenAI/Claude 等）的原始 HTTP request/response body、token 消耗、耗时
- **B. MCP 工具层面**：每次工具调用（如 `tools/call`）的完整入参和返回结果
- **C. 业务 API 层面**：应用内部各服务间调用的请求/响应

查看方式：**单对话维度追踪** + **跨对话聚合查询**两者都要。

---

## 2. 现状分析

### 2.1 已有能力
- `task_session_run_events`：存储 run 级别事件（`tool_call_started`/`completed`/`failed`），payload_json 包含工具名和摘要
- `task_session_connector_runtime_events`：存储连接器运行时事件
- `token_usage_logs`：存储 token 计费数据
- `conversation_messages`：存储消息流，metadata 含部分运行时信息
- 前端已有 `overview`、`billing`、`interaction`、`infra`、`raw`、`transitions` 六个 Tab

### 2.2 缺失能力
- 没有专门表存储 LLM API 调用的**完整 request/response body**
- `run_events.payload_json` 中的工具调用信息是摘要级别，缺少**完整入参和原始返回**
- 没有业务服务间 API 调用的追踪
- 前端缺少专门的"API 调用链路"和"工具调用详情"视图
- 缺少跨会话的聚合查询能力（如"查看过去 24h 所有 `deploy_application` 工具调用"）

---

## 3. 数据模型设计

### 3.1 新增表：`session_api_traces`

用于存储所有 API 调用（LLM、工具、业务）的完整 request/response。

```sql
CREATE TABLE IF NOT EXISTS session_api_traces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES task_creation_sessions(id) ON DELETE CASCADE,
  run_id UUID REFERENCES task_session_runs(id) ON DELETE SET NULL,

  -- 追踪类型
  trace_type TEXT NOT NULL, -- 'llm_request' | 'tool_call' | 'service_api' | 'connector_api'

  -- 阶段标识（用于时序排序）
  sequence INTEGER NOT NULL DEFAULT 0,

  -- LLM 相关
  model TEXT,
  provider TEXT, -- 'openai' | 'anthropic' | 'qwen' | ...

  -- 工具/服务相关
  tool_name TEXT,
  service_name TEXT, -- 服务名，如 'sandbox-agent', 'e2b-connector'
  endpoint TEXT, -- API 端点或 URL

  -- 请求信息
  request_method TEXT,
  request_headers JSONB,
  request_body JSONB,
  request_body_text TEXT, -- 冗余纯文本，便于搜索

  -- 响应信息
  response_status INTEGER,
  response_headers JSONB,
  response_body JSONB,
  response_body_text TEXT,

  -- 性能指标
  duration_ms INTEGER, -- 耗时毫秒
  started_at TIMESTAMP,
  completed_at TIMESTAMP,

  -- Token 消耗（仅 LLM）
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  cached_prompt_tokens INTEGER DEFAULT 0,
  cache_creation_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,

  -- 错误信息
  error_message TEXT,
  error_stack TEXT,

  -- 扩展元数据
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_session_api_traces_session_id
  ON session_api_traces(session_id);
CREATE INDEX IF NOT EXISTS idx_session_api_traces_session_type
  ON session_api_traces(session_id, trace_type);
CREATE INDEX IF NOT EXISTS idx_session_api_traces_session_sequence
  ON session_api_traces(session_id, sequence);
CREATE INDEX IF NOT EXISTS idx_session_api_traces_run_id
  ON session_api_traces(run_id);
CREATE INDEX IF NOT EXISTS idx_session_api_traces_tool_name
  ON session_api_traces(tool_name);
CREATE INDEX IF NOT EXISTS idx_session_api_traces_created_at
  ON session_api_traces(created_at);
CREATE INDEX IF NOT EXISTS idx_session_api_traces_type_created_at
  ON session_api_traces(trace_type, created_at);
```

### 3.2 新增表：`session_api_trace_aggregations`

用于预计算聚合数据，加速跨会话查询。

```sql
CREATE TABLE IF NOT EXISTS session_api_trace_aggregations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregation_key TEXT NOT NULL, -- 如 'tool_call_by_name_24h'
  aggregation_type TEXT NOT NULL, -- 'tool_call' | 'llm_request' | 'service_api'
  window_start TIMESTAMP NOT NULL,
  window_end TIMESTAMP NOT NULL,
  dimensions JSONB NOT NULL DEFAULT '{}'::jsonb, -- { tool_name: 'deploy_application', model: 'gpt-4o' }
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb, -- { count: 42, avg_duration_ms: 1200, total_tokens: 15000 }
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_session_api_trace_aggr_key_window
  ON session_api_trace_aggregations(aggregation_key, window_start, window_end, dimensions);
```

> 注：聚合表 v1 可先不实现，当数据量上来后再通过后台任务补充。v1 先走实时查询。

---

## 4. 采集点设计

### 4.1 LLM API 调用采集（`trace_type = 'llm_request'`）

**采集位置**：`apps/api/src/connectors/llm-proxy-connector.ts`

在 `forward()` 方法中拦截请求和响应：
- 请求发出前：记录 `request_method`, `request_headers`, `request_body`
- 响应返回后：记录 `response_status`, `response_headers`, `response_body`, `duration_ms`, token 消耗
- 异常时：记录 `error_message`

**关键字段**：
- `trace_type`: `'llm_request'`
- `provider`: 从配置推断（openai/anthropic/qwen）
- `model`: 从 request body 提取
- `endpoint`: `/v1/chat/completions` 等

### 4.2 MCP 工具调用采集（`trace_type = 'tool_call'`）

**采集位置**：`apps/api/src/services/altus-managed-tool-executor.ts`

在 `executeToolCall()` 中增强：
- 工具调用开始前：记录工具名、参数
- 工具调用完成后：记录完整返回结果、耗时
- 失败时：记录错误信息

**关键字段**：
- `trace_type`: `'tool_call'`
- `tool_name`: 工具名
- `request_body`: 工具入参
- `response_body`: 工具返回结果

> 注意：现有 `AltusRunEventWriter.appendRunEvent` 已写入了 `tool_call_started`/`completed`/`failed` 事件到 `task_session_run_events`。新表做**补充**——`run_events` 保留摘要，新表存储完整 request/response。

### 4.3 业务/连接器 API 采集（`trace_type = 'service_api'` 或 `'connector_api'`）

**采集位置**：关键服务方法入口和出口

重点采集以下服务的调用：
- `e2b-connector.ts`：Sandbox 创建/销毁/命令执行
- `osac-connector.ts`：OSAC 通信
- `sandbox-agent-provision-service.ts`：Agent 环境准备
- `session-connector-service.ts`：MCP 连接器调用

**实现方式**：新增轻量级装饰器/包装函数 `traceServiceCall()`，在调用前后记录：
- 服务名
- 方法名
- 入参（脱敏后）
- 返回值摘要
- 耗时

---

## 5. API 设计

### 5.1 管理后台新增路由

在 `apps/admin_management/server/routes/conversation-routes.ts` 新增：

```typescript
// 获取单个会话的 API 追踪详情
GET /sessions/:sessionId/api-traces
Query: {
  type?: 'llm_request' | 'tool_call' | 'service_api' | 'connector_api'; // 筛选类型
  toolName?: string; // 按工具名筛选
  model?: string; // 按模型筛选
  limit?: number; // 默认 100，最大 500
  offset?: number;
}

// 聚合查询（跨会话）
GET /api-traces/aggregate
Query: {
  type?: 'llm_request' | 'tool_call' | 'service_api' | 'connector_api';
  toolName?: string;
  model?: string;
  sessionId?: string; // 可指定单个会话
  userId?: string; // 按用户筛选
  from?: string; // ISO 时间
  to?: string;
  groupBy?: 'tool_name' | 'model' | 'service_name' | 'status'; // 分组维度
  limit?: number;
  offset?: number;
}

// 聚合统计（仪表盘数字）
GET /api-traces/stats
Query: {
  from?: string;
  to?: string;
  type?: 'llm_request' | 'tool_call' | 'service_api' | 'connector_api';
}
Response: {
  totalCalls: number;
  avgDurationMs: number;
  errorRate: number;
  totalTokens: number;
  byType: Array<{ type: string; count: number }>;
  byTool: Array<{ toolName: string; count: number; avgDurationMs: number }>;
  byModel: Array<{ model: string; count: number; totalTokens: number }>;
}
```

### 5.2 主 API 新增路由

在 `apps/api/src/routes/` 新增 `trace-routes.ts`：

```typescript
// 供管理后台调用的追踪写入（内部路由）
POST /api/internal/traces
Body: {
  sessionId: string;
  runId?: string;
  traceType: string;
  ...traceData;
}

// 查询追踪（管理员权限）
GET /api/internal/traces
Query: { sessionId, type, limit, offset }

// 聚合查询（管理员权限）
GET /api/internal/traces/aggregate
Query: { type, from, to, groupBy }

// 统计（管理员权限）
GET /api/internal/traces/stats
Query: { from, to, type }
```

---

## 6. 前端设计

### 6.1 单对话维度增强

在对话详情弹窗（`ConversationDialogTab`）新增第 7 个 Tab：`api-traces`

```typescript
type ConversationDialogTab = 'overview' | 'billing' | 'interaction' | 'infra' | 'raw' | 'transitions' | 'api-traces';
```

**`api-traces` Tab 内容**：
- 顶部统计条：LLM 调用次数、工具调用次数、平均耗时、错误率、总 token
- 筛选器：按类型（LLM/工具/服务）、按工具名、按模型、按时间范围
- 时间线视图：类似现有 `transitions` 的 timeline 样式，每条记录显示：
  - 时间戳
  - 类型徽章（`LLM`/`Tool`/`Service`）
  - 名称（模型名/工具名/服务名）
  - 状态（成功/失败）
  - 耗时
  - 展开后可查看完整 request/response JSON
- 列表视图：表格展示，支持排序

### 6.2 聚合查询面板（新增独立页面）

在管理后台导航新增一个入口：`API 追踪`（或放在 `对话管理` 子页面）

**功能**：
- 全局筛选：时间范围（最近 1h/24h/7d/30d）、类型、工具名、模型、用户
- 统计卡片：总调用数、成功率、平均耗时、Top 工具、Top 模型
- 图表：
  - 调用趋势（折线图，按时间）
  - 工具分布（饼图/柱状图）
  - 模型 token 消耗（柱状图）
  - 响应时间分布（直方图）
- 明细表格：分页展示最近调用记录，可点击跳转到对应对话详情

### 6.3 数据类型扩展

```typescript
export interface ApiTraceItem {
  id: string;
  sessionId: string;
  runId?: string | null;
  traceType: 'llm_request' | 'tool_call' | 'service_api' | 'connector_api';
  sequence: number;
  model?: string | null;
  provider?: string | null;
  toolName?: string | null;
  serviceName?: string | null;
  endpoint?: string | null;
  requestMethod?: string | null;
  requestHeaders?: Record<string, unknown> | null;
  requestBody?: Record<string, unknown> | null;
  requestBodyText?: string | null;
  responseStatus?: number | null;
  responseHeaders?: Record<string, unknown> | null;
  responseBody?: Record<string, unknown> | null;
  responseBodyText?: string | null;
  durationMs?: number | null;
  startedAt?: string | null;
  completedAt?: string | null;
  promptTokens?: number;
  completionTokens?: number;
  cachedPromptTokens?: number;
  cacheCreationTokens?: number;
  totalTokens?: number;
  errorMessage?: string | null;
  metadataJson?: Record<string, unknown>;
  createdAt: string;
}

export interface ApiTraceAggregateItem {
  dimension: string;
  dimensionValue: string;
  count: number;
  avgDurationMs: number;
  totalTokens: number;
  errorCount: number;
}

export interface ApiTraceStats {
  totalCalls: number;
  avgDurationMs: number;
  errorRate: number;
  totalTokens: number;
  byType: Array<{ type: string; count: number }>;
  byTool: Array<{ toolName: string; count: number; avgDurationMs: number }>;
  byModel: Array<{ model: string; count: number; totalTokens: number }>;
}
```

---

## 7. 实施计划

### Phase 1：数据层（优先级 P0）
1. 新增 `session_api_traces` 表到迁移脚本
2. 新增 DAO 层：`session-api-trace.dao.ts`
3. 更新 schema 定义

### Phase 2：采集层（优先级 P0）
1. 在 `llm-proxy-connector.ts` 中插桩采集 LLM 调用
2. 在 `altus-managed-tool-executor.ts` 中增强工具调用采集
3. 新增 `trace-service-call.ts` 轻量级包装器，在关键服务中应用

### Phase 3：API 层（优先级 P1）
1. 新增 `apps/api/src/routes/trace-routes.ts`
2. 新增 `apps/api/src/services/trace-service.ts`
3. 在 `apps/admin_management/server/routes/conversation-routes.ts` 中新增聚合路由

### Phase 4：前端单对话增强（优先级 P1）
1. 在 `App.tsx` 中新增 `api-traces` Tab
2. 实现 `renderConversationApiTracesPanel()`
3. 新增 API 方法到 `api.ts`
4. 新增类型到 `types.ts`

### Phase 5：前端聚合面板（优先级 P2）
1. 新增独立组件或扩展现有对话管理页面
2. 实现筛选、统计卡片、图表、明细表格

### Phase 6：验证与优化
1. 端到端测试
2. 性能测试（大量数据时查询性能）
3. 补充聚合表（如需要）

---

## 8. 风险与注意事项

1. **数据量**：API 调用可能非常频繁，需要考虑：
   - 设置合理的 `limit` 和分页
   - 定期归档或清理旧数据（如 30 天前的详细记录）
   - response_body 可能很大，超过一定大小只存摘要

2. **敏感数据**：request/response 可能包含用户敏感信息：
   - 不对最终用户暴露此功能（仅限管理员）
   - 在存储前对密钥、token、密码等做脱敏处理
   - 可考虑增加环境变量开关控制是否启用详细追踪

3. **性能影响**：
   - 采集操作必须是异步的，不能阻塞主流程
   - 使用 `Promise.resolve().catch()` 确保采集失败不影响业务
   - 大数据量查询使用游标或分页

4. **环境开关**：
   - 新增环境变量 `ONECEO_API_TRACE_ENABLED=true`（默认 false）
   - 新增环境变量 `ONECEO_API_TRACE_MAX_BODY_SIZE=1048576`（默认 1MB）
   - 新增环境变量 `ONECEO_API_TRACE_RETENTION_DAYS=30`

---

## 9. 与现有系统的关系

| 现有系统 | 关系 |
|---------|------|
| `task_session_run_events` | 保留不变，继续存储摘要级别事件。新表 `session_api_traces` 做补充，存储完整 request/response。 |
| `token_usage_logs` | 保留不变，继续用于计费。新表会冗余 token 数据用于追踪展示。 |
| `conversation_messages` | 保留不变。新表不会修改消息表结构。 |
| `conversation-management-service` | 在 `getSessionCore`/`getSessionDetail` 中新增查询 `session_api_traces` 并放入返回结构。 |
| 前端对话详情弹窗 | 新增第 7 个 Tab `api-traces`，不影响现有 6 个 Tab。 |
