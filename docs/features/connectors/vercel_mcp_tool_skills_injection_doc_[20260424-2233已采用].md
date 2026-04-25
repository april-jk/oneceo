# Vercel MCP 复杂工具 Skills 注入方案 [20260424-2233已采用]

## 1. 背景

当前 Vercel MCP 已能暴露项目、部署、环境变量和域名工具，但实测中 Altus 会把“通过 Vercel MCP 部署”误解成在 sandbox 内自行 `zip/tar` 打包，或把 `vercel_update_project` 当成真正发布工具。这说明 connector guide 只能解决“第一次使用前必须读指南”，但复杂工具仍需要更贴近工具行为的 skills。

本次目标不是给所有 Vercel 工具塞大量上下文，而是只给容易误用、具有写入或发布影响的复杂工具自动注入短技能。

## 2. 官方依据

1. Vercel MCP 官方工具文档说明 MCP 工具可管理项目和部署，同时建议对工具执行启用人工确认并注意 prompt injection 风险：
   - https://vercel.com/docs/mcp/vercel-mcp/tools
2. Vercel 项目配置文档说明 Vercel 会自动检测 framework，并且 `buildCommand`、`installCommand`、`outputDirectory`、`framework` 等配置会覆盖默认构建行为：
   - https://vercel.com/docs/project-configuration
3. Vercel CLI 部署文档说明预构建部署应由 `vercel build` 产出 `.vercel/output`，再执行 `vercel deploy --prebuilt`；不能让 agent 自己发明 zip/tar 上传流程：
   - https://vercel.com/docs/cli/deploy

## 3. 工具分组

### 3.1 不自动注入 skill 的简单读工具

以下工具保持只受 connector guide 约束，不额外注入平台 skill：

1. `vercel_get_auth_context`
2. `vercel_list_projects`
3. `vercel_get_project`
4. `vercel_get_deployment`
5. `vercel_list_project_domains`
6. `vercel_list_env_vars`

原因：这些工具主要是读取上下文，频繁使用。如果每次读都注入 skill，会让上下文膨胀。

### 3.2 项目配置复杂工具

绑定 skill：`vercel-mcp-project-config-operator`

触发工具：

1. `vercel_create_project`
2. `vercel_update_project`
3. `vercel_delete_project`

重点约束：

1. 先确认目标 team / project，再写配置。
2. `vercel_update_project` 只能改项目配置，不等于部署新代码。
3. 不要为了“部署”随意设置 `framework=nextjs`、`outputDirectory=dist` 等参数；必须先检查项目文件和 package scripts。
4. 当前 MCP 未提供源码上传式 deployment 时，不允许自行 zip/tar/curl 拼上传流程。

### 3.3 发布、域名、环境变量复杂工具

绑定 skill：`vercel-mcp-release-safety-operator`

触发工具：

1. `vercel_get_deployment_events`
2. `vercel_add_project_domain`
3. `vercel_upsert_env_var`
4. `vercel_remove_env_var`
5. `vercel_redeploy_deployment`

重点约束：

1. 环境变量写入必须显式指定 `target`，不能猜 production/preview。
2. 域名写入前必须确认项目和域名归属。
3. `vercel_redeploy_deployment` 只能基于已有 deployment 重新部署，不能替代首次源码上传。
4. 部署诊断先读 deployment events，再决定是项目配置问题、构建脚本问题还是权限/资源问题。

## 4. 实现方案

1. 在 `PLATFORM_SKILL_SEEDS` 增加两个 admin managed platform skills。
2. 在 skill governance 中配置 `autoActivation.toolNames` 为稳定的原始 Vercel MCP 工具名。
3. 修改 `AltusManagedToolRuntime.findAutoAttachableSkillsForTool()`，让它能从动态 managed MCP 工具名 `mcp__vercel_update_project__hash` 反推出 `vercel_update_project`，从而命中 auto activation。
4. 在 admin governance options 里增加这些 Vercel MCP 复杂工具选项，便于后台后续管理。

## 5. 验收

1. 调用动态 managed Vercel MCP 复杂工具时，可以自动注入对应 skill。
2. 普通 Vercel 读工具不会自动注入额外 skill。
3. 原有 connector guide 拦截仍然生效：第一次使用 Vercel MCP 前仍需 `load_connector_guide`。
4. `api type-check` 通过，相关 runtime 测试通过。

## 6. 已实现落点

1. `apps/api/src/services/platform-skill-seeds.ts`
   - 新增 `vercel-mcp-project-config-operator`。
   - 新增 `vercel-mcp-release-safety-operator`。
2. `apps/api/src/services/altus-managed-tool-runtime.ts`
   - 动态 MCP 工具名 `mcp__vercel_update_project__hash` 可反推并命中原始工具名 `vercel_update_project` 的 autoActivation。
   - 保留 connector guide 先读后用的拦截行为。
3. `apps/api/src/services/platform-skill-governance-options.ts`
   - 后台治理选项新增 Vercel MCP 复杂工具，方便后续在 admin 侧调整。
4. `apps/api/tests/altus-managed-tool-runtime.test.ts`
   - 覆盖复杂 Vercel MCP 工具自动注入 skill。
   - 覆盖简单读工具不注入 skill，避免上下文膨胀。
