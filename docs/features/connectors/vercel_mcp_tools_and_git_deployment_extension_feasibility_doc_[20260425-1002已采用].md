# Vercel MCP 工具与 Git 部署能力扩展可行性文档 [20260425-1002已采用]

## 1. 背景

当前 Vercel MCP 已经通过 OneCEO internal MCP wrapper 对接 Vercel Integration OAuth，并在 `apps/api/src/services/vercel-mcp-service.ts` 内暴露了项目、部署、环境变量、域名等一批工具。用户本次要求为 VercelMcp 增加以下工具，且重复工具不需要再次添加：

```text
vercel_get_auth_context
vercel_list_teams
vercel_list_projects
vercel_get_project
vercel_create_project
vercel_update_project
vercel_delete_project
vercel_create_deployment
vercel_get_deployment
vercel_get_deployment_events
vercel_redeploy_deployment
vercel_create_project_from_git
vercel_update_project_git_repository
vercel_get_project_git_repository
```

本文件方案已在 2026-04-25 10:02 经用户明确要求进入代码实现阶段，状态从 `[尚未采用]` 更新为 `[20260425-1002已采用]`。

## 2. 当前重复项与缺口

### 2.1 已存在，不需要重复添加

当前代码已存在以下目标工具：

1. `vercel_get_auth_context`
2. `vercel_list_projects`
3. `vercel_get_project`
4. `vercel_create_project`
5. `vercel_update_project`
6. `vercel_delete_project`
7. `vercel_get_deployment`
8. `vercel_get_deployment_events`
9. `vercel_redeploy_deployment`

这些工具只需要在后续实现中做回归确认，不应重复注册。

### 2.2 已存在同类能力，但本次清单未要求

当前还存在以下 Vercel MCP 工具：

1. `vercel_list_deployments`
2. `vercel_list_project_domains`
3. `vercel_list_env_vars`
4. `vercel_add_project_domain`
5. `vercel_upsert_env_var`
6. `vercel_remove_env_var`

本次方案不删除、不重命名这些工具，避免破坏已有会话、skills 治理和测试。

### 2.3 本次需要新增

本次真正需要新增的工具是：

1. `vercel_list_teams`
2. `vercel_create_deployment`
3. `vercel_create_project_from_git`
4. `vercel_update_project_git_repository`
5. `vercel_get_project_git_repository`

## 3. 官方 API 可行性

### 3.1 `vercel_list_teams`

可行。

官方 REST API 支持 `GET /v2/teams`，用于分页返回当前授权用户所属团队。实现上应在 `vercel-rest-client.ts` 增加 `listTeams()`，在 MCP 层暴露 `limit`、`since`、`until` 三个查询参数。

官方依据：Vercel 文档说明该接口返回 authenticated user 所属团队列表，路径为 `GET /v2/teams`。来源：[List all teams](https://docs.vercel.com/docs/rest-api/reference/endpoints/teams/list-all-teams)。

### 3.2 `vercel_create_deployment`

有条件可行。

官方 REST API 支持 `POST /v13/deployments`。但该接口有两类不同语义：

1. Git deployment：通过 `gitSource` 指向 GitHub / GitLab / Bitbucket 等仓库来源。
2. 非 Git deployment：必须在请求内提供 `files`，文件可以 inline 或引用已上传文件。

当前 OneCEO Vercel MCP wrapper 没有实现文件上传、文件哈希、批量文件收集和 Build Output API 打包链路。因此本方案建议第一阶段只支持 Git deployment 与既有 deployment redeploy 语义，不支持把当前 sandbox workspace 直接打包上传到 Vercel。这样可以避免 agent 再次发明 zip/tar/curl 上传流程，保持最短路径且不偏移业务逻辑。

官方依据：Vercel 文档说明 `POST /v13/deployments` 可创建部署；非 Git deployment 必须提供 files；`gitSource` 不能与 `files` 同时使用；`target` 可为 preview、staging、production 或 custom environment。来源：[Create a new deployment](https://docs.vercel.com/docs/rest-api/reference/endpoints/deployments/create-a-new-deployment)。

建议首版 schema：

```json
{
  "name": "my-project",
  "project": "my-project-or-prj_id",
  "teamId": "team_xxx",
  "target": "production",
  "gitSource": {
    "type": "github",
    "repoId": "123456789",
    "ref": "main",
    "sha": "optional"
  },
  "gitMetadata": {
    "remoteUrl": "https://github.com/owner/repo",
    "commitRef": "main",
    "commitSha": "optional",
    "commitMessage": "optional"
  },
  "projectSettings": {
    "buildCommand": "pnpm build",
    "installCommand": "pnpm install",
    "outputDirectory": "dist",
    "rootDirectory": null,
    "framework": "vite"
  },
  "skipAutoDetectionConfirmation": true,
  "forceNew": false
}
```

约束：

1. `files` 不在首版开放。
2. `target=production` 必须来自用户明确要求，不能由模型猜测。
3. `gitSource` 与 `files` 互斥，首版只允许 `gitSource`。
4. 首次部署若需要 `projectSettings`，只能传入用户明确给出或从仓库文件检查得到的字段。

### 3.3 `vercel_create_project_from_git`

可行，建议作为 `vercel_create_project` 的 Git 专用封装。

官方 `POST /v11/projects` 的 request body 支持 `gitRepository` 字段，文档说明当该字段存在时，push 到连接的 Git 仓库会自动部署。当前已有 `vercel_create_project`，但它没有开放 `gitRepository`。为了满足用户对工具名的直觉，也为了让 agent 更容易选择正确工具，可以新增 `vercel_create_project_from_git`，内部仍调用 `POST /v11/projects`。

官方依据：Vercel 创建项目文档说明 `gitRepository` 是可连接到项目的 Git Repository，定义后推送会自动部署。来源：[Create a new project](https://docs.vercel.com/docs/rest-api/reference/endpoints/projects/create-a-new-project)。

建议 schema：

```json
{
  "name": "my-project",
  "teamId": "team_xxx",
  "gitRepository": {
    "type": "github",
    "repo": "owner/repo",
    "repoId": "123456789"
  },
  "framework": "vite",
  "buildCommand": "pnpm build",
  "installCommand": "pnpm install",
  "outputDirectory": "dist",
  "rootDirectory": null,
  "nodeVersion": "22.x"
}
```

约束：

1. 必须显式提供 `gitRepository`。
2. `repo` / `repoId` 字段的最终形态需要在实现时用官方 SDK 类型或接口实测确认，不能仅凭字符串猜测。
3. 创建前必须先调用或已知 `vercel_list_teams` / `vercel_get_auth_context`，确认 team 上下文。

### 3.4 `vercel_get_project_git_repository`

可行，建议通过 `vercel_get_project` 的返回体提取。

当前 `GET /v9/projects/{idOrName}` 已经可获取项目详情。Vercel 项目详情与项目列表响应中存在 Git link / gitRepository 相关字段。本工具不需要新增 REST endpoint，建议实现为：

1. 调用 `vercelRestClient.getProject()`
2. 从返回体提取 `link`、`gitRepository`、`gitProviderOptions`、`gitLFS`、`gitForkProtection` 等 Git 相关字段
3. 返回脱敏后的结构化结果

这样可以保持工具职责清晰：用户问“这个项目绑定了哪个 Git 仓库”时，不需要让模型自己从完整 project JSON 里猜字段。

### 3.5 `vercel_update_project_git_repository`

谨慎可行，建议通过 `PATCH /v9/projects/{idOrName}` 更新 `gitRepository` 相关字段。

官方更新项目接口支持 `PATCH /v9/projects/{idOrName}`。搜索到的官方响应/参数文档包含 `gitRepository`、`gitLFS`、`gitForkProtection`、`gitProviderOptions` 等 Git 相关字段。因此本工具可以作为 `vercel_update_project` 的 Git 专用封装，内部仍调用 `updateProject()`。

官方依据：Vercel 更新项目文档说明可通过 name 或 id 更新项目字段，路径为 `PATCH /v9/projects/{idOrName}`；文档中包含 Git LFS、Git fork protection、Git provider options 等字段。来源：[Update an existing project](https://docs.vercel.com/docs/rest-api/reference/endpoints/projects/update-an-existing-project)。

建议首版 schema：

```json
{
  "projectIdOrName": "my-project-or-prj_id",
  "teamId": "team_xxx",
  "gitRepository": {
    "type": "github",
    "repo": "owner/repo",
    "repoId": "123456789"
  },
  "gitLFS": false,
  "gitForkProtection": true,
  "gitProviderOptions": {
    "createDeployments": "enabled",
    "disableRepositoryDispatchEvents": false,
    "requireVerifiedCommits": false
  }
}
```

约束：

1. 必须显式提供 `projectIdOrName`，禁止使用 profile 默认项目隐式写入。
2. 只允许写 Git 相关字段，不混入 framework / buildCommand 等普通项目配置字段。
3. 如果用户要求“断开 Git 仓库”，需要先确认官方字段语义；没有明确字段前不实现删除绑定的猜测逻辑。

## 4. Skills 设计

当前已有两个 Vercel MCP skills：

1. `vercel-mcp-project-config-operator`
2. `vercel-mcp-release-safety-operator`

本次建议不再无限增加小 skill，而是按复杂工具的风险边界扩展为三组。

### 4.1 项目配置 Skill 扩展

继续使用 `vercel-mcp-project-config-operator`，新增覆盖：

1. `vercel_create_project_from_git`
2. `vercel_update_project_git_repository`
3. `vercel_get_project_git_repository`

需要补充的规则：

1. Git 绑定工具只处理项目与 Git 仓库关系，不等同于上传源码。
2. 写入 Git 仓库绑定前必须确认 team、project、repo 三者。
3. 不允许为了解决部署失败随意改 `rootDirectory`、`framework`、`outputDirectory`，除非仓库结构证据明确。

### 4.2 发布安全 Skill 扩展

继续使用 `vercel-mcp-release-safety-operator`，新增覆盖：

1. `vercel_create_deployment`

需要补充的规则：

1. `vercel_create_deployment` 首版只允许 Git deployment，不处理 files 上传。
2. 生产部署必须确认用户明确要求 `production`。
3. 部署失败时先用 `vercel_get_deployment_events` 诊断，不要直接重试或改项目配置。
4. 不得把 `vercel_create_project_from_git` 或 `vercel_update_project_git_repository` 当成部署完成。

### 4.3 团队上下文工具不注入 Skill

`vercel_list_teams` 是只读上下文工具，不需要单独注入 skill。它应作为写操作前的上下文确认工具，由 connector guide 和复杂工具 skill 引导模型调用。

## 5. 实现落点

### 5.1 `apps/api/src/services/vercel-rest-client.ts`

新增方法：

1. `listTeams(context, query)`
2. `createDeployment(context, body, query)`

复用现有方法：

1. `createProject()` 支撑 `vercel_create_project_from_git`
2. `getProject()` 支撑 `vercel_get_project_git_repository`
3. `updateProject()` 支撑 `vercel_update_project_git_repository`

### 5.2 `apps/api/src/services/vercel-mcp-service.ts`

新增 tool schema 与 dispatch：

1. `vercel_list_teams`
2. `vercel_create_deployment`
3. `vercel_create_project_from_git`
4. `vercel_update_project_git_repository`
5. `vercel_get_project_git_repository`

需要新增 helper：

1. `buildGitRepositoryBody()`
2. `buildDeploymentBody()`
3. `extractProjectGitRepositoryContext()`
4. `resolveExplicitProjectIdOrName()` 复用当前写操作显式目标逻辑

### 5.3 `apps/api/src/services/platform-skill-seeds.ts`

调整两个已有工具数组：

1. `VERCEL_MCP_PROJECT_CONFIG_TOOLS` 增加 Git 项目绑定工具。
2. `VERCEL_MCP_RELEASE_SAFETY_TOOLS` 增加 `vercel_create_deployment`。

更新对应 `bodyMarkdown` 和 resource，强调 Git deployment 与 workspace source upload 的边界。

### 5.4 `apps/api/src/services/platform-skill-governance-options.ts`

在 `VERCEL_MCP_TOOL_OPTIONS` 中增加：

1. `vercel_create_deployment`
2. `vercel_create_project_from_git`
3. `vercel_update_project_git_repository`
4. `vercel_get_project_git_repository`

`vercel_list_teams` 不进入复杂工具治理选项。

### 5.5 测试

需要新增或更新：

1. `apps/api/tests/vercel-mcp-service.test.ts`
   - tools/list 包含新增工具。
   - `vercel_list_teams` 映射 `GET /v2/teams`。
   - `vercel_create_deployment` 首版禁止 `files`，允许 `gitSource`。
   - `vercel_create_project_from_git` 必须带 `gitRepository`。
   - `vercel_update_project_git_repository` 必须显式 project。
   - `vercel_get_project_git_repository` 返回脱敏 Git 上下文。
2. `apps/api/tests/platform-skill-governance-options.test.ts`
   - 复杂 Vercel MCP 工具出现在治理选项中。
3. `apps/api/tests/altus-managed-tool-runtime.test.ts`
   - 动态 MCP 工具名可命中新扩展后的 skill。
   - `vercel_list_teams` 不额外注入 skill。

## 6. 验收标准

1. `tools/list` 中包含本次新增的 5 个工具，且已存在 9 个目标工具没有重复定义。
2. `vercel_list_teams` 正确映射 `GET /v2/teams`。
3. `vercel_create_deployment` 正确映射 `POST /v13/deployments`，首版只支持 Git deployment / redeploy 语义，不支持 workspace 文件上传。
4. `vercel_create_project_from_git` 正确映射 `POST /v11/projects`，并带 `gitRepository`。
5. `vercel_get_project_git_repository` 不新增 REST endpoint，只从 project 详情中提取 Git 上下文。
6. `vercel_update_project_git_repository` 正确映射 `PATCH /v9/projects/{idOrName}`，且只能写 Git 相关字段。
7. 复杂工具能够自动注入对应 skill，简单只读工具不产生额外上下文膨胀。
8. `pnpm --filter api type-check` 与相关 API 单测通过。

## 7. 风险与处理

1. Git repository 字段类型风险：Vercel 官方文档对 `gitRepository` 子字段展示不完整，实现时必须结合官方 SDK 类型或真实 API 响应校验。
2. 源码上传误用风险：`vercel_create_deployment` 容易被误解为“部署当前 workspace”，首版必须禁止 `files`，只支持 Git source。
3. 生产部署风险：`target=production` 必须来自用户明确要求，并在 skill 中强制提醒。
4. 权限风险：Vercel Integration token 可能没有目标 team / repo 的项目创建或 Git 绑定权限，需要将 Vercel API 的 401 / 403 / 409 原样结构化返回，不能吞成泛化错误。

## 8. 结论

本需求可行。推荐采用最短路径：

1. 保留已有 9 个重复工具，不重复注册。
2. 新增 5 个缺口工具。
3. `vercel_create_deployment` 首版只支持 Git deployment，不支持 workspace 文件上传。
4. Git 项目创建和 Git 仓库绑定都复用官方项目 REST API，避免引入未经验证的自定义链路。
5. 复杂工具复用并扩展现有两个 Vercel MCP skills，避免 skill 数量膨胀。

待用户确认后，可进入实现阶段。
