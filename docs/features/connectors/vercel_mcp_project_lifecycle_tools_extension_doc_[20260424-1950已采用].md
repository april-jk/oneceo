# Vercel MCP 项目生命周期工具扩展方案 [20260424-1950已采用]

## 1. 背景

当前 Vercel MCP 已经完成内部 MCP 包装层、OAuth token 使用、REST API 映射和本地穿透调试方案。现有工具可以读取项目、读取部署、读取部署事件、管理项目域名、管理环境变量和重新部署已有 deployment。

本次 smoke 测试要求创建 `oneceo-vercel-mcp-smoke-test` 项目时失败，错误为 `managed_model_plain_text_without_tool_call`。失败原因不是 Vercel API 或 ngrok 链路异常，而是当前 `tools/list` 未暴露创建项目工具，模型判断无法执行后直接返回纯文本失败。

## 2. 目标

本次扩展只补齐项目生命周期的最小闭环能力：

1. 创建项目：`vercel_create_project`
2. 更新项目：`vercel_update_project`
3. 删除项目：`vercel_delete_project`

扩展后 smoke 测试可以形成：

```text
创建项目 -> 查询项目 -> 更新项目配置 -> 设置环境变量 -> 查询部署/域名 -> 删除测试项目
```

## 3. 官方 API 对齐

本次实现只映射 Vercel 官方 REST API，不引入官方 Vercel MCP 代理层。

1. `vercel_create_project`
   - 官方 API：`POST /v11/projects`
   - 官方文档：https://vercel.com/docs/rest-api/reference/endpoints/projects/create-a-new-project
   - 最小必填：`name`

2. `vercel_update_project`
   - 官方 API：`PATCH /v9/projects/{idOrName}`
   - 官方文档：https://docs.vercel.com/docs/rest-api/reference/endpoints/projects/update-an-existing-project
   - 最小必填：`projectIdOrName`，并至少提供一个可更新字段

3. `vercel_delete_project`
   - 官方 API：`DELETE /v9/projects/{idOrName}`
   - 官方文档：https://vercel.com/docs/rest-api/reference/endpoints/projects/delete-a-project
   - 最小必填：`projectIdOrName`

## 4. 工具参数设计

### 4.1 `vercel_create_project`

用于创建一个 Vercel 项目。第一版只开放高频且稳定的字段：

```json
{
  "name": "oneceo-vercel-mcp-smoke-test",
  "framework": "vite",
  "buildCommand": "pnpm build",
  "devCommand": "pnpm dev",
  "installCommand": "pnpm install",
  "outputDirectory": "dist",
  "rootDirectory": null,
  "directoryListing": false,
  "publicSource": false,
  "nodeVersion": "22.x"
}
```

约束：

1. `name` 必填。
2. 可选字段未传时不写入 request body。
3. `teamId` 继续来自 profile config 或调用参数，不新增授权来源。

### 4.2 `vercel_update_project`

用于更新已有项目配置。

```json
{
  "projectIdOrName": "oneceo-vercel-mcp-smoke-test",
  "framework": "vite",
  "buildCommand": "pnpm build",
  "outputDirectory": "dist"
}
```

约束：

1. `projectIdOrName`、`projectId`、`projectSlug` 三者至少传一个。
2. 不使用 profile 默认项目作为更新目标，避免模型在上下文不足时误改真实项目。
3. 除项目标识外至少提供一个更新字段。

### 4.3 `vercel_delete_project`

用于删除项目，主要服务 smoke 清理。

```json
{
  "projectIdOrName": "oneceo-vercel-mcp-smoke-test",
  "confirm": true
}
```

约束：

1. 必须显式传 `projectIdOrName`、`projectId` 或 `projectSlug`。
2. 必须传 `confirm: true`。
3. 不使用 profile 默认项目作为删除目标。

## 5. 实现范围

需要修改：

1. `apps/api/src/services/vercel-mcp-service.ts`
   - 增加三个 tool schema。
   - 增加 `tools/call` 分发。
   - 增加项目写操作日志，日志不记录 token。

2. `apps/api/src/services/vercel-rest-client.ts`
   - 增加 `createProject()`。
   - 增加 `updateProject()`。
   - 增加 `deleteProject()`。

3. `apps/api/tests/vercel-mcp-service.test.ts`
   - 验证 tool catalog 包含新工具。
   - 验证 create project 调用 REST client。
   - 验证 delete project 缺少 `confirm: true` 时会被阻止。
   - 验证 REST client 对 create/update/delete 使用正确路径和方法。

不在本次实现：

1. 新建 deployment。
2. 取消 deployment。
3. 删除 deployment。
4. alias / domain 全闭环。
5. Vercel 官方 MCP 全量工具复刻。

## 6. 验收标准

1. `tools/list` 中出现 `vercel_create_project`、`vercel_update_project`、`vercel_delete_project`。
2. Altus 在收到“创建 Vercel 项目”任务时可以选择 `vercel_create_project`，不再返回 `managed_model_plain_text_without_tool_call`。
3. `vercel_create_project` 映射到 `POST /v11/projects`。
4. `vercel_update_project` 映射到 `PATCH /v9/projects/{idOrName}`。
5. `vercel_delete_project` 映射到 `DELETE /v9/projects/{idOrName}`。
6. 项目删除必须显式确认，不能使用 profile 默认项目隐式删除。
