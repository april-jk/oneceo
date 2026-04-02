# 03 Sandbox（E2B）

当前主链 Sandbox 方案是 `E2B + OSAC + OpenCode/Codex/ClaudeCode`，不是旧的 KVM 主链。

## 强制规则

- 所有主链 Sandbox 调用必须经由 `apps/api/src/connectors/e2b-connector.ts`
- 与 Sandbox 内执行器通信必须经由 OSAC 和 API 编排服务
- 不允许业务路由直接调用 Sandbox 内部服务
- `kvm-orchestrator` 仅保留历史文档和后台观测用途，不是当前实现依据

## 关键代码位置

- E2B 连接器：`apps/api/src/connectors/e2b-connector.ts`
- E2B 配置：`apps/api/src/config/e2b-config.ts`
- Sandbox 路由：`apps/api/src/routes/sandbox-routes.ts`
- OSAC 路由：`apps/api/src/routes/osac-routes.ts`
- Sandbox provision：`apps/api/src/services/sandbox-agent-provision-service.ts`
- Sandbox 调试：`apps/api/src/services/sandbox-debug-service.ts`
- Sandbox 归档：`apps/api/src/services/sandbox-archive-service.ts`
- Sandbox 活跃度：`apps/api/src/services/sandbox-activity-service.ts`
- OSAC 执行服务：`apps/api/src/services/osac-agent-service.ts`
- MCP 恢复：`apps/api/src/services/session-mcp-recovery-service.ts`

## 当前能力

- 创建 / 查询 / 关闭 Sandbox Session
- 打开 / 关闭 / 归档 / 恢复执行环境
- 运行时活跃度更新与 dirty 标记
- n.eko 调试页启动
- OSAC skills / MCP provider / tools 调度
- 会话级连接器绑定恢复
- OSAC 二进制工件发布与 latest 切换

## 模板与工件

- 模板目录：`e2b_templates/`
- 当前主要模板：
  - `e2b_templates/opencode-playwright-mcp`
  - `e2b_templates/codex-ws-playwright-sandbox`
- 具体模板实现需以当前目录结构为准，不要照抄旧文档中的绝对 Windows 路径
- OSAC 二进制发布已改为 Cloudflare R2 工件链路，见：
  - `docs/agent研发文档/20260401_OSAC二进制改为Cloudflare_R2下发设计_[20260401-2220已采用].md`

## n.eko UI Patch 参照

这一节需要保留，因为后续如果继续调整 n.eko 最小化 UI，必须以当前 patch 和模板构建链路为准。

- Patch 文件：
  - `e2b_templates/opencode-playwright-mcp/patches/neko-client-minimal.patch`
- 模板构建脚本：
  - `e2b_templates/opencode-playwright-mcp/build.ts`
- 模板定义：
  - `e2b_templates/opencode-playwright-mcp/template.ts`
- 模板说明：
  - `e2b_templates/opencode-playwright-mcp/README.md`

当前链路不是在仓库里直接保存一份编译后的 n.eko 前端，而是：

1. `build.ts` 读取本地 `neko-client-minimal.patch`
2. 将 patch 上传到 R2，或使用显式传入的 patch URL
3. `template.ts` 在构建模板时执行：
   - clone `m1k1o/neko`
   - `git apply` 该 patch
   - 在 sandbox 模板里重新 build client
4. 最终把构建后的前端资源放入模板镜像

后续修改 n.eko 时的约束：

- 先改 patch，不要直接在文档里描述“应该怎么改”而不落到 patch 文件
- 同时核对 `template.ts` 中的 patch 应用步骤是否仍匹配上游仓库结构
- 如果上游 neko 仓库结构变化导致 patch 失效，需要连同 build 链路一起修正
- 修改后至少保留以下信息：
  - patch 文件路径
  - 构建脚本路径
  - R2 patch key / patch URL 的配置方式

## 归档与恢复

- 任务会话在运行期可能触发 Sandbox archive / restore
- 恢复不只包括 workspace，本仓库还包含：
  - MCP provider 恢复
  - 连接器绑定恢复
  - runtime metadata 恢复
- 设计依据：
  - `docs/agent研发文档/20260331_Altus_Sandbox恢复与MCP持久化恢复设计_[20260331-0115已采用].md`

## 调试与测试注意事项

- 启动 Sandbox 的脚本测试必须补上关闭动作，避免额外计费。
- 新模板只对新创建的 Sandbox 生效，已有 Sandbox 不会自动迁移。
- 需要排查 UI 远程调试问题时，优先检查：
  - Sandbox 是否 ready
  - OSAC 是否 provision 成功
  - n.eko 调试是否已启动
  - 连接器与 MCP 是否因恢复失败处于 pending_recover / failed 状态
