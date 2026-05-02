# 20260502 自定义 API 生成 MCP 工具编码文档 [20260502-1642已采用]

状态：`[20260502-1642已采用]`

更新时间：2026-05-02

## 1. 背景与目标

本方案只覆盖“自定义 MCP 部分”的首版落地，但总流程按用户指定链路设计：

```text
外部系统 API
  ↓
custom_api connector
  ↓
oneceo API broker
  ↓
自动生成 MCP tool
  ↓
Altus 在任务里调用
```

目标：

1. 允许用户或管理员把外部 HTTP API 注册为 `custom_api` connector。
2. 由 oneceo 后端代理外部 API 调用，并从已审核 endpoint 自动生成 MCP tool。
3. Altus 只能调用当前 session 已 attach、已审核、已启用的 custom API MCP tool。
4. 敏感凭证只保存在 oneceo API 侧，禁止进入 sandbox、prompt、tool 参数、前端持久化明文。
5. 所有工具调用都形成可审计记录，支持管理员复核、禁用、风险分级和调用追踪。

## 2. 非目标

首版不做：

1. 不支持用户直接填写任意 MCP server URL 后直连 sandbox。
2. 不支持在 sandbox 内安装或运行用户提供的 MCP server。
3. 不支持未审核 endpoint 自动暴露给 Altus。
4. 不做完整 OpenAPI 全自动导入执行器；可以预留 schema 导入字段，但首版以手工 endpoint 配置为准。
5. 不做跨用户共享 secret。
6. 不做 fallback 或兼容旧的任意 HTTP tool 调用路径。

## 3. 核心原则

### 3.1 Broker only

custom API 的所有运行时调用必须经过 oneceo API broker：

1. Altus 调用 MCP tool。
2. OSAC 把 tool call 转回 oneceo API broker。
3. oneceo API broker 按 profile secret 拼装外部请求。
4. broker 对请求、响应、错误和审计做统一处理。

禁止：

1. token 下发到 sandbox。
2. Altus 直接看到 Authorization header。
3. 外部 API URL 在 tool 参数中被任意覆盖。
4. 用户通过 shell 绕过 broker 访问同一 secret。

### 3.2 审核先于暴露

endpoint 必须经过安全审核后才能生成 MCP tool。审核状态是工具暴露的硬门禁：

```text
draft -> pending_review -> approved -> published
                          ↓
                        rejected
published -> disabled / archived
```

只有 `published` 且 connector profile 可用、session 已 attach 的 endpoint 才能进入 MCP tool snapshot。

### 3.3 写操作强约束

`POST`、`PUT`、`PATCH`、`DELETE` 默认视为写操作。写操作必须具备：

1. `riskLevel`：`medium` 或 `high`。
2. `confirmationPolicy`：`require_user_confirmation` 或 `require_admin_approved_template`。
3. 明确的参数 JSON Schema。
4. 明确的响应裁剪规则。
5. connector guide blocking rule。

首版不允许写操作静默执行。

## 4. 产品使用流程

### 4.1 创建 custom API connector

1. 用户或管理员进入 Connectors。
2. 创建自定义 API：
   - 名称
   - Base URL
   - 鉴权方式
   - 默认 headers
   - 超时
   - 允许域名策略
3. 后端创建 `user_connector_profiles`，connectorKey 为 `custom_api` 或 `custom_api:<definitionId>`。
4. secret 通过 `connector-secret-service.ts` 加密保存。

### 4.2 配置 endpoint

每个 endpoint 配置：

1. `displayName`
2. `method`
3. `pathTemplate`
4. `description`
5. `inputSchemaJson`
6. `requestMappingJson`
7. `responseMappingJson`
8. `riskLevel`
9. `confirmationPolicy`
10. `enabled`

示例：

```json
{
  "displayName": "查询客户",
  "method": "GET",
  "pathTemplate": "/customers/{customerId}",
  "inputSchemaJson": {
    "type": "object",
    "properties": {
      "customerId": { "type": "string", "minLength": 1 }
    },
    "required": ["customerId"],
    "additionalProperties": false
  },
  "riskLevel": "low",
  "confirmationPolicy": "none"
}
```

### 4.3 安全审核

endpoint 创建后默认进入 `draft`。提交审核后由管理员检查：

1. Base URL 是否命中允许域名。
2. path 是否禁止 SSRF 风险。
3. method 是否符合风险等级。
4. input schema 是否禁止自由对象和额外字段。
5. request mapping 是否不会把用户输入拼接进 host、scheme、headers.Authorization。
6. response mapping 是否不会返回 secret、token、cookie、完整大体积隐私数据。
7. 写操作是否有确认策略和 guide blocking rule。

审核通过后才允许 publish。

### 4.4 attach 到 session

1. 用户在会话中 attach custom API connector。
2. `session-connector-service.ts` 写入 `task_session_connector_bindings`。
3. `session-mcp-recovery-service.ts` 通过 brokered provider 恢复 MCP tools。
4. run 启动前 `altus-managed-setup-service.ts` 获取已 publish endpoint 生成的 MCP snapshot。

### 4.5 Altus 调用

1. Altus 先调用 `load_connector_guide(connectorKey=custom_api)`。
2. Altus 选择已暴露的 custom API MCP tool。
3. `altus-managed-tool-runtime.ts` 检查 guide 是否已加载、endpoint 是否允许、是否需要确认。
4. oneceo API broker 执行外部 API 调用。
5. 调用结果按 response mapping 裁剪后返回给 Altus。

## 5. 数据模型设计

### 5.1 custom_api_definitions

新增表：`custom_api_definitions`

字段：

1. `id`
2. `ownerUserId`
3. `scope`
   - `user`
   - `admin_managed`
4. `name`
5. `description`
6. `baseUrl`
7. `authMode`
   - `none`
   - `bearer_token`
   - `api_key_header`
   - `basic`
8. `defaultHeadersJson`
9. `allowedHostsJson`
10. `status`
   - `draft`
   - `active`
   - `disabled`
   - `archived`
11. `createdBy`
12. `createdAt`
13. `updatedAt`

约束：

1. `baseUrl` 必须是 `https://`，本地开发可通过环境变量显式允许 `http://localhost`。
2. 禁止 private IP、link-local、metadata service 地址。
3. `allowedHostsJson` 默认只能包含 `baseUrl.host`。

### 5.2 custom_api_endpoint_tools

新增表：`custom_api_endpoint_tools`

字段：

1. `id`
2. `definitionId`
3. `toolSlug`
4. `displayName`
5. `description`
6. `method`
7. `pathTemplate`
8. `inputSchemaJson`
9. `requestMappingJson`
10. `responseMappingJson`
11. `riskLevel`
    - `low`
    - `medium`
    - `high`
12. `confirmationPolicy`
    - `none`
    - `require_user_confirmation`
    - `require_admin_approved_template`
13. `reviewStatus`
    - `draft`
    - `pending_review`
    - `approved`
    - `rejected`
    - `published`
    - `disabled`
    - `archived`
14. `reviewedBy`
15. `reviewedAt`
16. `reviewNotes`
17. `createdBy`
18. `createdAt`
19. `updatedAt`

约束：

1. 同一个 `definitionId` 下 `toolSlug` 唯一。
2. `inputSchemaJson.additionalProperties` 必须为 `false`。
3. `published` 前必须存在审核人和审核时间。
4. 写方法不允许 `confirmationPolicy='none'`。

### 5.3 custom_api_call_audit_logs

新增表：`custom_api_call_audit_logs`

字段：

1. `id`
2. `userId`
3. `taskSessionId`
4. `runId`
5. `definitionId`
6. `endpointToolId`
7. `connectorProfileId`
8. `method`
9. `resolvedUrlHash`
10. `requestBodyHash`
11. `responseStatus`
12. `durationMs`
13. `riskLevel`
14. `confirmationId`
15. `resultSummary`
16. `errorCode`
17. `createdAt`

约束：

1. 默认不存完整 request body 和 response body。
2. 调试开关只能存脱敏片段，且必须有保留时间限制。

## 6. Connector definition 改造

当前 `apps/api/src/connectors/definitions/types.ts` 已存在：

```ts
export type ConnectorCategory = 'app' | 'custom_api' | 'custom_mcp';
```

但 `ConnectorKey` 还没有 custom key。首版改造：

1. 在 `ConnectorKey` 增加 `'custom_api'`。
2. 在 `CONNECTOR_KEYS` 增加 `'custom_api'`。
3. 新增 `apps/api/src/connectors/definitions/custom-api.ts`。
4. `buildConnectorDefinitions()` 返回 `buildCustomApiDefinition()`。

定义目标：

```ts
export function buildCustomApiDefinition(): ConnectorDefinition {
  return {
    key: 'custom_api',
    category: 'custom_api',
    name: 'Custom API',
    description: 'Expose approved external API endpoints as brokered MCP tools.',
    icon: 'plug',
    authMode: 'token',
    available: true,
    configFields: [],
    activityMatcherVerified: true,
    visibleInMenu: true,
    runtime: {
      type: 'remote',
      transport: 'streamable_http',
      headerTemplate: 'none'
    }
  };
}
```

说明：

1. `configFields` 首版不直接复用通用 connector 表单，custom API 需要独立配置页。
2. runtime 不代表外部 MCP 直连，而是 oneceo API brokered MCP。

## 7. API 路由设计

### 7.1 用户态路由

在 `apps/api/src/routes/connector-routes.ts` 增加 custom API 子路由，或新增 `custom-api-connector-routes.ts` 后挂载。

接口：

1. `GET /api/connectors/custom-api/definitions`
   - 返回当前用户可见 custom API 定义。
2. `POST /api/connectors/custom-api/definitions`
   - 创建 definition。
3. `PATCH /api/connectors/custom-api/definitions/:definitionId`
   - 更新 definition，已 published endpoint 存在时限制 baseUrl 变更。
4. `POST /api/connectors/custom-api/definitions/:definitionId/profiles`
   - 保存当前用户 secret profile。
5. `GET /api/connectors/custom-api/definitions/:definitionId/tools`
   - 列出 endpoint tools。
6. `POST /api/connectors/custom-api/definitions/:definitionId/tools`
   - 创建 endpoint tool，默认 `draft`。
7. `PATCH /api/connectors/custom-api/tools/:toolId`
   - 更新 draft/rejected/disabled tool。
8. `POST /api/connectors/custom-api/tools/:toolId/submit-review`
   - 提交审核。

用户态限制：

1. 用户不能直接 publish。
2. 用户不能绕过审核启用 endpoint。
3. 用户只能访问自己的 definition/profile，除非 definition 是 admin managed。

### 7.2 管理态路由

在 admin API 增加审核入口，可复用 `apps/admin_management/server/routes/connector-guide-routes.ts` 的管理后台组织方式，新增：

1. `GET /api/admin/custom-api/review-queue`
2. `POST /api/admin/custom-api/tools/:toolId/approve`
3. `POST /api/admin/custom-api/tools/:toolId/reject`
4. `POST /api/admin/custom-api/tools/:toolId/publish`
5. `POST /api/admin/custom-api/tools/:toolId/disable`
6. `GET /api/admin/custom-api/audit-logs`

管理态必须记录 `reviewedBy`。

## 8. Broker 服务设计

新增服务：`apps/api/src/services/custom-api-broker-service.ts`

职责：

1. 根据 `endpointToolId` 加载 endpoint tool。
2. 校验 tool 状态必须为 `published`。
3. 校验当前 `taskSessionId` 已 attach 对应 custom API definition。
4. 解密 profile secret。
5. 使用 input schema 校验 Altus 参数。
6. 按 request mapping 构造外部 HTTP 请求。
7. 执行 SSRF 与 allowlist 校验。
8. 发送请求。
9. 按 response mapping 裁剪结果。
10. 写入 audit log。

核心函数：

```ts
type ExecuteCustomApiToolInput = {
  userId: string;
  taskSessionId: string;
  runId?: string;
  connectorProfileId: string;
  endpointToolId: string;
  argumentsJson: unknown;
  confirmationId?: string;
};

async function executeCustomApiTool(input: ExecuteCustomApiToolInput): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: unknown;
}>;
```

## 9. MCP tool 自动生成

新增服务：`apps/api/src/services/custom-api-mcp-tool-service.ts`

职责：

1. 读取 session 已 attach 的 custom API bindings。
2. 找到 profile 对应 definition。
3. 查询 `published` endpoint tools。
4. 生成 MCP tool schema。

tool 命名：

```text
custom_api__<definitionSlug>__<toolSlug>
```

示例：

```text
custom_api__crm__get_customer
custom_api__jira_internal__create_ticket
```

生成规则：

1. `name` 必须稳定，不使用数据库随机 id。
2. `description` 必须包含风险等级和是否写操作。
3. `inputSchema` 直接来自审核后的 `inputSchemaJson`。
4. `additionalProperties` 必须为 `false`。
5. tool metadata 必须包含：
   - `connectorKey='custom_api'`
   - `definitionId`
   - `endpointToolId`
   - `riskLevel`
   - `confirmationPolicy`

## 10. 接入现有 MCP 装配链路

### 10.1 connector-registry

修改 `apps/api/src/services/connector-registry.ts`：

1. 识别 `custom_api` connector。
2. 不注册外部 remote MCP URL。
3. 注册 hosted/backend_rpc provider。
4. provider tools 来自 `custom-api-mcp-tool-service.ts`。
5. provider call 进入 `custom-api-broker-service.ts`。

### 10.2 session-connector-service

修改 `apps/api/src/services/session-connector-service.ts`：

1. attach custom API 时必须指定 `definitionId` 和 `profileId`。
2. 写入 `sessionConfigJson.definitionId`。
3. 写入 `sessionConfigJson.allowedEndpointToolIds`，为空表示该 definition 下全部 published tools。
4. 如果 profile 缺失或 secret 不可用，binding 进入 `needs_auth`。

### 10.3 session-mcp-recovery-service

修改 `apps/api/src/services/session-mcp-recovery-service.ts`：

1. custom API 只允许恢复为 brokered provider。
2. 恢复时重新读取 published tools。
3. disabled/archived tool 不进入 snapshot。
4. 如果 endpoint 在 run 期间被禁用，只影响下一轮 run；broker 执行时仍需实时检查状态，禁用后立即拒绝新调用。

### 10.4 altus-managed-setup-service

修改 `apps/api/src/services/altus-managed-setup-service.ts`：

1. run 启动前 `ensureSessionMcpRecovered()` 必须完成。
2. MCP tool snapshot 包含 custom API generated tools。
3. snapshot 中不包含 secret、baseUrl、headers。

### 10.5 altus-managed-tool-runtime

修改 `apps/api/src/services/altus-managed-tool-runtime.ts`：

1. custom API MCP tool 命中前必须先加载 `load_connector_guide(connectorKey=custom_api)`。
2. 写操作根据 `confirmationPolicy` 检查确认状态。
3. 若 tool 状态已 disabled/rejected/archived，返回明确错误。
4. 拦截疑似绕过 broker 的 shell 命令：
   - `curl` 命中 custom API baseUrl 且试图携带同类 secret header。
   - `wget` 命中 custom API baseUrl。
   - 在 sandbox 中设置 custom API token 环境变量。

## 11. 安全审核机制

### 11.1 静态审核

新增服务：`apps/api/src/services/custom-api-security-review-service.ts`

审核项：

1. URL 安全：
   - 只允许 https。
   - 禁止 localhost、127.0.0.0/8、0.0.0.0、169.254.169.254、10.0.0.0/8、172.16.0.0/12、192.168.0.0/16。
   - 禁止用户名密码形式 URL。
2. path 安全：
   - 禁止 pathTemplate 覆盖 scheme/host。
   - 禁止 `..`。
   - 禁止把完整 URL 作为 path 参数。
3. header 安全：
   - 禁止 endpoint tool 自定义 Authorization header。
   - Authorization 只能由 profile authMode 生成。
4. schema 安全：
   - root 必须是 object。
   - 必须有 properties。
   - 必须 `additionalProperties=false`。
   - 字符串字段必须支持 maxLength 默认注入。
5. 响应安全：
   - 默认限制最大响应大小。
   - 默认脱敏 token、cookie、authorization、set-cookie、secret、password。
6. 写操作安全：
   - method 为写操作时必须有确认策略。
   - high risk 必须有 admin approved template。

### 11.2 运行时审核

每次 tool call 执行前再次检查：

1. 用户是否拥有 session。
2. session 是否 attach 对应 connector。
3. profile 是否属于当前用户。
4. endpoint 是否仍为 `published`。
5. definition 是否仍为 `active`。
6. resolved URL 是否仍命中 allowlist。
7. 参数是否通过 schema。
8. 是否满足 confirmation policy。

### 11.3 审计日志

每次调用必须记录：

1. 谁调用。
2. 哪个 session/run。
3. 哪个 custom API definition。
4. 哪个 endpoint tool。
5. 成功或失败。
6. HTTP status。
7. 耗时。
8. 风险等级。
9. 是否经过确认。

审计日志不能默认保存外部系统完整响应。

## 12. Connector guide 设计

custom API 必须有内置 guide，进入现有 `connector-guide-service.ts` 链路。

默认 guide 内容方向：

```md
# Custom API MCP Instructions

You can only use custom_api tools that are already attached to this session and exposed by oneceo.

Before calling any custom_api write tool:
1. Confirm the target external system, object id, and expected side effect.
2. Ask the user for confirmation unless the tool result includes an approved confirmation token.
3. Never attempt to call the external API directly from shell.
4. Never ask the user to paste API tokens into chat.

For read tools:
1. Use the narrowest available query.
2. Do not request bulk exports unless the task explicitly requires it.
3. Summarize sensitive results instead of repeating raw payloads.
```

在 `connector-guide-service.ts` 的内置 guide 中新增 `custom_api`。

## 13. 前端页面范围

首版最小 UI：

### 13.1 用户态设置页

位置：用户设置 -> Connectors -> Custom API

能力：

1. 创建 custom API definition。
2. 保存 profile secret。
3. 创建 endpoint tool 草稿。
4. 提交审核。
5. 查看审核状态。

不允许用户 publish。

### 13.2 会话连接器弹窗

能力：

1. 选择一个已配置 custom API。
2. 选择 profile。
3. attach 到当前 session。
4. 显示 tools 数量、审核状态、风险摘要。

### 13.3 管理后台审核页

能力：

1. 查看 pending review endpoint。
2. 查看 definition、baseUrl、method、path、schema、risk。
3. approve/reject/publish/disable。
4. 查看调用审计。

设计要求：

1. 高密度表格 + sticky inspector。
2. 风险操作必须展示对象、后果、恢复边界。
3. 不做营销式卡片布局。

## 14. 文件改动清单

后端新增：

1. `apps/api/src/connectors/definitions/custom-api.ts`
2. `apps/api/src/services/custom-api-definition-service.ts`
3. `apps/api/src/services/custom-api-endpoint-tool-service.ts`
4. `apps/api/src/services/custom-api-security-review-service.ts`
5. `apps/api/src/services/custom-api-mcp-tool-service.ts`
6. `apps/api/src/services/custom-api-broker-service.ts`
7. `apps/api/src/routes/custom-api-connector-routes.ts`
8. `apps/api/src/routes/admin-custom-api-routes.ts`
9. `apps/api/tests/custom-api-*.test.ts`

后端修改：

1. `apps/api/src/connectors/definitions/types.ts`
2. `apps/api/src/connectors/definitions/index.ts`
3. `apps/api/src/services/connector-registry.ts`
4. `apps/api/src/services/session-connector-service.ts`
5. `apps/api/src/services/session-mcp-recovery-service.ts`
6. `apps/api/src/services/altus-managed-setup-service.ts`
7. `apps/api/src/services/altus-managed-tool-runtime.ts`
8. `apps/api/src/services/connector-guide-service.ts`
9. `apps/api/src/db/schema.ts`

前端新增/修改：

1. `apps/web/client/src/lib/connectors-client.ts`
2. 用户设置 Connectors 页面中的 Custom API 配置区。
3. 会话 connector selector 中的 Custom API attach UI。
4. `apps/admin_management/web/src/components` 下新增 Custom API 审核区。
5. `apps/admin_management/server/routes` 下挂载审核路由。

## 15. 实施顺序

### 阶段一：数据与基础定义

1. 增加 DB schema。
2. 增加 DAO/service。
3. 增加 `custom_api` connector definition。
4. 增加基础 API routes。
5. 测试 definition/profile/tool CRUD 与 owner 隔离。

### 阶段二：审核机制

1. 实现 `custom-api-security-review-service.ts`。
2. 实现 submit/approve/reject/publish/disable。
3. 加入写操作确认策略校验。
4. 测试 SSRF、schema、header、写操作门禁。

### 阶段三：MCP 工具生成与 broker

1. 实现 `custom-api-mcp-tool-service.ts`。
2. 在 `connector-registry.ts` 接入 brokered provider。
3. 实现 `custom-api-broker-service.ts`。
4. session attach 后生成 MCP snapshot。
5. 测试 Altus tool schema 可见且不泄漏 secret。

### 阶段四：Altus 安全运行时

1. 接入 guide blocking。
2. 接入写操作确认。
3. 接入 disabled tool 实时拒绝。
4. 接入 shell 绕过拦截。
5. 测试读工具、写工具、禁用工具、未加载 guide。

### 阶段五：前端与管理后台

1. 用户态创建和提交审核。
2. 会话 attach。
3. 管理后台审核和审计。
4. Playwright 覆盖主流程。

## 16. 测试计划

### 16.1 单元测试

新增测试：

1. `custom-api-security-review-service.test.ts`
   - 禁止 private IP。
   - 禁止 Authorization header override。
   - 禁止 additionalProperties。
   - 写操作必须确认。
2. `custom-api-mcp-tool-service.test.ts`
   - 只生成 published tools。
   - tool name 稳定。
   - schema 不允许额外字段。
3. `custom-api-broker-service.test.ts`
   - 校验 owner。
   - 校验 attach。
   - 校验 URL allowlist。
   - 响应脱敏。
   - audit log 写入。
4. `session-mcp-recovery-service.test.ts`
   - custom API 恢复为 brokered provider。
   - disabled tool 不进入 snapshot。
5. `altus-managed-tool-runtime.test.ts`
   - 未加载 guide 阻断。
   - 写操作无确认阻断。
   - disabled tool 阻断。

### 16.2 最小验证命令

```bash
pnpm --filter api type-check
pnpm -C apps/api exec tsx --test tests/custom-api-security-review-service.test.ts
pnpm -C apps/api exec tsx --test tests/custom-api-mcp-tool-service.test.ts
pnpm -C apps/api exec tsx --test tests/custom-api-broker-service.test.ts
pnpm -C apps/api exec tsx --test tests/session-mcp-recovery-service.test.ts
pnpm -C apps/api exec tsx --test tests/altus-managed-tool-runtime.test.ts
```

### 16.3 手动验收

1. 创建 custom API definition。
2. 保存 bearer token profile。
3. 创建 GET endpoint tool。
4. 提交审核并 publish。
5. attach 到 session。
6. 发起 Altus 任务，确认 tool snapshot 中出现 `custom_api__...`。
7. Altus 先加载 guide，再调用工具。
8. 外部 API 请求由 oneceo API broker 发出。
9. audit log 中可看到调用记录。
10. 禁用 endpoint 后，新调用立即失败，下一轮 run snapshot 不再包含该工具。

## 17. 风险与处理

### 17.1 SSRF

风险：用户通过 baseUrl/path 参数访问内网或 metadata service。

处理：

1. baseUrl 静态审核。
2. DNS 解析后 IP 运行时审核。
3. 禁止 path 参数改变 host。
4. 请求前最终 URL 再校验。

### 17.2 凭证泄漏

风险：token 出现在 prompt、tool schema、sandbox、日志。

处理：

1. secret 只在 broker 内解密。
2. MCP tool metadata 不含 secret。
3. audit log 存 hash 和摘要。
4. 响应默认脱敏。

### 17.3 Agent 误调用写操作

风险：Altus 对外部系统产生不可逆写入。

处理：

1. 写操作必须确认。
2. high risk 需要 admin approved template。
3. guide blocking 强制加载。
4. runtime 实时检查 confirmation policy。

### 17.4 工具污染

风险：大量 endpoint 进入 prompt/tool schema，影响模型选择。

处理：

1. session attach 时允许选择 endpoint 范围。
2. 默认只暴露 published 且 enabled 的 endpoint。
3. 管理后台展示 tool 数量和风险摘要。

## 18. 评审补强约束

本节吸收 2026-05-02 评审意见，作为后续编码实现的硬约束。若本节与前文存在表述差异，以本节为准。

### 18.1 definition / profile / endpoint tool 边界

三类对象必须分离：

```text
definition = 外部系统定义，比如 CRM、Jira、ERP
profile = 某个用户/组织保存的凭证，比如 token、headers、secret
endpointTool = 从 definition 暴露给 Agent 的具体工具，比如 get_customer、create_ticket
```

推荐关系：

```text
custom_api_definitions
  1 ── n custom_api_endpoint_tools
  1 ── n custom_api_connector_profiles
```

编码约束：

1. `baseUrl` 只属于 definition。
2. `secret` 只属于 profile。
3. `method/path/inputSchema/requestMapping/responseProjection` 只属于 endpoint tool。
4. session attach 时绑定 profile，并显式选择 endpoint tool 子集。
5. 禁止 attach definition 后默认暴露该 definition 下全部工具。

访问边界：

1. 自定义 MCP 首版仅对增加者开放。
2. “增加者”指创建 custom API definition、profile 或 endpoint tool 的真实 `app_users.id` 所属用户。
3. 非增加者不能在用户态查看、attach、调用该 custom API 生成的 MCP tools。
4. 管理员可以在管理后台审核、禁用、归档和查看审计，但不因此获得业务调用权限。
5. 后续如需组织共享，必须另起设计文档定义共享授权、成员范围、profile 归属和审计责任；本方案不预留默认共享行为。

### 18.2 session attach 粒度

首版 session attach 绑定的是：

```text
connectorProfileId + endpointToolIds 子集
```

推荐新增表：

```sql
session_custom_api_bindings (
  id,
  task_session_id,
  connector_profile_id,
  definition_id,
  enabled,
  attached_by,
  created_at
)

session_custom_api_binding_tools (
  id,
  binding_id,
  endpoint_tool_id,
  enabled
)
```

原因：

1. profile 决定用谁的凭证。
2. tool 子集决定 Altus 能看到哪些能力。
3. definition 只表示工具所属外部系统。
4. attach 请求必须校验当前用户就是该 custom API 能力的增加者；不是增加者则返回 403。

### 18.3 brokered provider 类型

Custom API 不注册外部 remote MCP server。其 MCP tools 由 oneceo hosted/backend_rpc provider 生成，工具调用进入 `custom-api-broker-service.ts`。

优先把 runtime 类型扩展为：

```ts
runtime: {
  type: 'hosted',
  transport: 'backend_rpc',
  headerTemplate: 'none'
}
```

或者：

```ts
runtime: {
  type: 'brokered',
  transport: 'internal'
}
```

如果当前类型系统暂时只能写 `remote`，必须加注释：

```ts
// This is not an external remote MCP server.
// custom_api tools are hosted by oneceo and invoked via backend broker.
```

同时建议显式区分 provider 类型：

```ts
type ConnectorRuntimeProvider =
  | RemoteMcpProvider
  | HostedMcpProvider
  | CustomApiBrokeredProvider;
```

禁止把 custom API 伪装成 remote MCP provider，避免 registry 误走 `connectRemoteMcp(runtime.url)`。

### 18.4 audit log 字段补强

`custom_api_call_audit_logs` 需要在原字段基础上补充：

```ts
toolName: string
declaredRiskLevel: 'low' | 'medium' | 'high'
computedRiskLevel: 'low' | 'medium' | 'high'
runtimeRiskLevel: 'low' | 'medium' | 'high'
effectiveRiskLevel: 'low' | 'medium' | 'high'
operationType: 'read' | 'create' | 'update' | 'delete' | 'action'
requestId: string
callerType: 'agent' | 'user' | 'admin_test' | 'system'
actorContextJson?: unknown
status: 'started' | 'success' | 'failed' | 'blocked' | 'requires_confirmation' | 'timeout'
resolvedUrlRedacted?: string
requestBodyRedactedPreview?: string
responseBodyRedactedPreview?: string
debugExpiresAt?: Date
```

说明：

1. `toolName` 便于管理后台直接阅读，不依赖每次 join。
2. `effectiveRiskLevel` 是真正执行生效的风险等级。
3. `operationType` 不能只靠 HTTP method 推断，例如 `POST /tickets/search` 可能是 read。
4. `requestId` 用于串联 API log、broker log、外部系统 log。
5. `status='blocked'` 可表达 SSRF、schema、权限等没有 HTTP response 的拦截。
6. `callerType` 区分 Altus 自动调用、用户测试、管理员审核测试、系统任务。

hash 可以保留，但不能视为彻底匿名。小体积 request body 可能被字典猜测。debug preview 只有在 debug 开启时允许保存，且必须脱敏、限制长度、设置 TTL，并只允许管理员查看。

### 18.5 risk 计算规则

用户声明的 `riskLevel` 不作为最终安全依据。

系统必须计算：

```text
declaredRiskLevel
computedRiskLevel
runtimeRiskLevel
effectiveRiskLevel = max(declaredRiskLevel, computedRiskLevel, runtimeRiskLevel)
```

执行时只以 `effectiveRiskLevel` 为准。

示例：

```text
send_slack_message 静态是 medium
但 channel = #all-company
runtimeRiskLevel 提升为 high
effectiveRiskLevel = high
```

审核时保存 risk report：

```json
{
  "computedRiskLevel": "high",
  "reasons": [
    "HTTP method POST is write-capable",
    "Path contains refund",
    "Tool is marked as financial side effect",
    "Requires confirmation"
  ]
}
```

### 18.6 confirmation 绑定参数

confirmation 不是工具级永久授权，而是本次参数级授权。

新增或等价实现 `custom_api_confirmations`：

```ts
{
  id: string;
  userId: string;
  taskSessionId: string;
  endpointToolId: string;
  toolName: string;
  argumentsHash: string;
  effectiveRiskLevel: 'low' | 'medium' | 'high';
  confirmationText: string;
  confirmedBy: string;
  expiresAt: Date;
  createdAt: Date;
}
```

执行时必须校验：

```text
confirmation.endpointToolId == current.endpointToolId
confirmation.argumentsHash == hash(current.argumentsJson)
confirmation.userId == current.userId
confirmation.taskSessionId == current.taskSessionId
confirmation.expiresAt > now
```

用户确认 `refund 10` 不能复用于 `refund 1000`。

### 18.7 broker 执行顺序

`custom-api-broker-service.ts` 必须按以下顺序执行：

1. 创建 audit log 初始记录，`status='started'`。
2. 加载 endpoint tool。
3. 校验 tool 状态必须为 `published`。
4. 校验 `userId / taskSessionId / connectorProfileId / definitionId` 关系，并确认 `userId` 是该 custom API 能力的增加者。
5. 校验当前 session 已 attach 对应 definition 和 endpoint tool。
6. 校验 confirmation policy。
7. 使用 input schema 校验 arguments。
8. 计算 runtime risk 和 effective risk。
9. 如果需要确认但没有有效 `confirmationId`，返回 `requires_confirmation` 并更新 audit log。
10. 加载 profile，但先不要解密 secret。
11. 按受限 request mapping 构造外部 HTTP 请求。
12. 执行 SSRF、allowlist、method、host、redirect、timeout、request body size 校验。
13. 到真正发送前再解密 secret 并注入 header。
14. 发送请求。
15. 限制 response body size。
16. response projection / redaction。
17. 更新 audit log。

关键原则：尽量晚解密 secret。

### 18.8 broker 入参与 toolName 解析

`executeCustomApiTool` 入参建议扩展为：

```ts
type ExecuteCustomApiToolInput = {
  userId: string;
  taskSessionId: string;
  runId?: string;
  definitionId?: string;
  connectorProfileId: string;
  endpointToolId: string;
  toolName?: string;
  callerType: 'agent' | 'user' | 'admin_test' | 'system';
  argumentsJson: unknown;
  confirmationId?: string;
};
```

工具名解析单独封装：

```ts
resolveCustomApiToolName(toolName: string): Promise<{
  definitionId: string;
  endpointToolId: string;
}>;
```

broker 最终以 `endpointToolId` 为执行依据，并用传入的 `definitionId/toolName` 做交叉校验。

### 18.9 request mapping 安全模型

request mapping 只能是受限模板，禁止任意脚本、eval、fetch、完整 URL 覆盖和 raw body 透传。

允许：

```json
{
  "pathParams": {
    "customer_id": "$.customer_id"
  },
  "queryParams": {
    "limit": "$.limit"
  },
  "jsonBody": {
    "title": "$.title",
    "priority": "$.priority"
  },
  "staticHeaders": {
    "x-client-name": "oneceo"
  }
}
```

禁止：

1. `url`
2. `scheme`
3. `host`
4. `method`
5. `headers.Authorization`
6. `headers.Cookie`
7. `rawBody`
8. 任意模板函数或脚本执行

Authorization 只能来自 profile secret，不允许来自 arguments 或 endpoint tool mapping。

### 18.10 input schema 严格校验

不只顶层需要 `additionalProperties=false`，所有嵌套 object 都必须递归检查。

规则：

1. root 必须是 `type: object`。
2. 所有 object 必须显式 `additionalProperties: false`。
3. 所有 array 必须有 `maxItems`。
4. 所有 string 必须有 `maxLength`，缺失时由系统注入默认上限。
5. `body`、`payload`、`metadata`、`filter`、`query`、`options` 等字段不得成为自由对象。

### 18.11 SSRF / allowlist 细则

必须实现：

1. 只允许 `https`。
2. 禁止 `localhost / 127.0.0.1 / 0.0.0.0 / ::1`。
3. 禁止 link-local：`169.254.0.0/16`。
4. 禁止 private ranges：`10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`。
5. 禁止 IPv6 unique local、IPv4-mapped IPv6 private ranges。
6. 禁止 cloud metadata host。
7. 禁止 `file://`、`gopher://`、`ftp://` 等非 http(s) 协议。
8. DNS 解析后校验 IP。
9. 请求前后防 DNS rebinding。
10. 限制 redirect 次数。
11. redirect 后重新校验 host 和 IP。
12. 限制 timeout。
13. 限制 request body size。
14. 限制 response body size。

企业私有部署如确需访问内网 API，必须通过单独的 private network allowlist 配置启用，不能默认开放。

### 18.12 response projection 强制规则

published tool 必须配置 response projection。没有 projection 的工具不能 publish；如业务必须允许原样返回，系统应将 `computedRiskLevel` 提升为 `high` 并要求管理员说明。

首版支持：

```ts
type ResponseProjection = {
  resultSummaryPath?: string;
  includeJsonPaths?: string[];
  excludeJsonPaths?: string[];
  maxItems?: number;
  maxBytes?: number;
  redactionRules?: Array<{
    path?: string;
    pattern?: string;
    replacement: string;
  }>;
};
```

默认脱敏字段：

```text
password
token
secret
api_key
authorization
cookie
set-cookie
private_key
```

### 18.13 tool name 稳定性与 revision

工具名：

```text
custom_api__<definitionSlug>__<toolSlug>
```

约束：

1. `definitionSlug` 在同一 workspace 或 owner scope 内唯一。
2. `toolSlug` 在同一 definition 内唯一。
3. published 后禁止直接修改 `toolSlug`。
4. published 后禁止直接修改 `method/pathTemplate/inputSchemaJson/requestMappingJson/operationType`。
5. 需要破坏性变更时创建新 draft revision。

description 是给模型看的，metadata 是给系统看的，broker policy 才是真正执行限制的依据。模型可以建议调用 high risk 工具，但 broker 必须按 effective risk 和 confirmation policy 拦截。

### 18.14 API 路由补充

用户态补充：

```http
POST /api/connectors/custom-api/definitions/:definitionId/test-connection
POST /api/connectors/custom-api/tools/:toolId/dry-run
POST /api/connectors/custom-api/tools/evaluate-risk
```

要求：

1. `test-connection` 也必须走 broker 的安全检查，不允许 route 里直接 fetch。
2. `dry-run` 返回 redacted method、redacted URL、redacted headers、redacted body preview、risk report。
3. `evaluate-risk` 用于前端实时展示 declared risk 与 computed risk 差异。

管理态审核动作必须带：

```ts
reviewNote?: string;
reviewedBy: string;
reviewedAt: Date;
```

状态机：

```text
draft -> submitted -> approved -> published
                  ↓
                rejected
published -> disabled -> archived
```

`approved` 不等于 `published`。安全审核通过后，管理员仍需明确 publish 才能进入 MCP tool snapshot。

用户态所有 custom API 路由必须强制增加者边界：

1. list 只返回当前登录用户增加的 custom API。
2. detail/update/submit-review/test-connection/dry-run/evaluate-risk 只允许增加者访问。
3. profile 保存只允许写入当前登录用户自己的 profile。
4. session attach 只允许 attach 当前登录用户增加并拥有 profile 的 custom API。
5. Altus runtime 调用时再次校验 session owner 与 custom API 增加者一致。

## 19. 验收标准

1. custom API connector 可创建、配置 profile、创建 endpoint tool。
2. 未审核 endpoint 不会生成 MCP tool。
3. published endpoint attach 后能进入 MCP snapshot。
4. Altus 只能通过 oneceo API broker 调用外部 API。
5. token 不出现在 sandbox、tool schema、prompt、前端响应和普通日志中。
6. 写操作没有确认时被阻断。
7. disabled endpoint 新调用立即失败。
8. 所有调用产生 audit log。
9. API type-check 通过。
10. 相关单元测试通过。
