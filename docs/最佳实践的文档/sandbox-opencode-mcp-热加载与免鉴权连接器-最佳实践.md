# Sandbox OpenCode MCP 热加载与免鉴权连接器最佳实践

更新时间：2026-03-09  
适用范围：`apps/api` 通过 E2B sandbox 运行 OpenCode，并为 task session 动态挂载 GitHub / Postgres / 其他 MCP 连接器。

## 1. 结论先行

当前应把 MCP 接入分成两类：

1. 运行时热加载 / 热卸载
2. 启动配置式加载

在当前 OpenCode + E2B 运行环境里，最佳实践是：

1. 对“需要认证态、需要稳定可见、需要在后续执行中直接可用”的 MCP，优先使用“启动配置式加载”。
2. 对运行时 `POST /mcp` / `POST /mcp/{name}/connect`，只能视为受限方案，必须再用 `GET /mcp` 复查，不能把接口返回 `connected` 当成最终成功。
3. 对 GitHub 这类连接器，推荐方案不是让 sandbox 再次浏览器登录，而是把认证后的 token 直接注入到远端 OpenCode 配置和进程环境里。

一句话概括：

当前最稳的做法不是“远程热插”，而是“改远端 `opencode.json` + 重启 `opencode serve` + 复查 `/mcp`”。

## 2. 当前代码入口

业务层必须遵守下面的边界：

1. 所有 sandbox 命令都通过 [e2b-connector.ts](/Users/eunice/codingProject/oneceo/apps/api/src/connectors/e2b-connector.ts)。
2. 会话级连接器 attach / detach 统一走 [session-connector-service.ts](/Users/eunice/codingProject/oneceo/apps/api/src/services/session-connector-service.ts)。
3. 远端 OpenCode 配置写入、重启、环境注入统一走 [sandbox-agent-provision-service.ts](/Users/eunice/codingProject/oneceo/apps/api/src/services/sandbox-agent-provision-service.ts)。
4. 连接器运行时配置生成统一走 [connector-registry.ts](/Users/eunice/codingProject/oneceo/apps/api/src/services/connector-registry.ts)。
5. 用户级 token / DSN / OAuth 状态统一走 [user-connector-service.ts](/Users/eunice/codingProject/oneceo/apps/api/src/services/user-connector-service.ts)。

不要在业务路由里直接拼 `/mcp` 请求，也不要绕过服务层直接改 sandbox 文件。

## 3. 两种方案的区别

### 3.1 方案 A：运行时热加载 / 热卸载

典型流程：

1. `POST /mcp`
2. `POST /mcp/{name}/connect`
3. `GET /mcp`
4. 使用该 server
5. 卸载时 `POST /mcp/{name}/disconnect`

理论优点：

1. 不需要重启 OpenCode。
2. attach / detach 延迟更低。
3. 适合真正支持动态注册且能稳定保留配置的 runtime。

当前风险：

1. OpenCode 可能出现“`POST /mcp` 返回 connected，但 `GET /mcp` 里新 server 立刻消失”的假成功。
2. 这会导致前端或业务层误以为连接器已经可用，实际执行时模型仍看不到该 MCP。
3. 对需要认证态的连接器，即使热加载成功，也未必同时完成了 shell fallback 所需的环境注入。

所以当前仓库里的热加载最佳实践是：

1. 只把它当作“可选优化”，不是稳定主路径。
2. attach 成功的判定条件必须是：
   - `POST /mcp` 成功
   - `POST /mcp/{name}/connect` 成功
   - `GET /mcp` 中仍然存在该 server
   - 其状态为 `connected`
3. detach 成功的判定条件必须是：
   - 重新查询 `GET /mcp`
   - 确认该 server 已消失

### 3.2 方案 B：启动配置式加载

典型流程：

1. 读取当前 task session 期望 attach 的连接器
2. 生成完整的 `mcp` 配置对象
3. 写入远端 `~/.config/opencode/opencode.json`
4. 将连接器所需环境变量一并注入 `opencode serve` 进程
5. 重启 OpenCode
6. 用 `GET /mcp` 复查

优点：

1. 符合 OpenCode “启动时加载配置”的实际行为。
2. 对 GitHub 这类有认证态的连接器更稳定。
3. 可以同时解决 MCP server 可见性和 shell fallback 认证问题。
4. 更适合“用户先授权，后续在 sandbox 中直接可用”的产品体验。

代价：

1. 需要重启 OpenCode。
2. 会打断旧 SSE 流，需要前端或桥接层处理重连。
3. 若正在执行长任务，必须注意切换窗口和状态同步。

当前推荐：

所有需要稳定可用的用户级连接器，优先使用方案 B。

## 4. GitHub 连接器的最佳实践

GitHub 是最典型的“必须走启动配置式加载”的场景。

### 4.1 用户级保存

用户先在平台层完成一次授权或保存 PAT。

要求：

1. 保存前校验 token 是否真实可用。
2. 有效才落库并标记 `authorized`。
3. 最好回填 `displayName`，例如 GitHub login。

当前实现参考：

1. [user-connector-service.ts](/Users/eunice/codingProject/oneceo/apps/api/src/services/user-connector-service.ts)
2. [user-connector-service.test.ts](/Users/eunice/codingProject/oneceo/apps/api/tests/user-connector-service.test.ts)

### 4.2 运行时配置生成

GitHub MCP 运行时配置由 [connector-registry.ts](/Users/eunice/codingProject/oneceo/apps/api/src/services/connector-registry.ts) 生成。

当前实践要点：

1. 使用官方 `@modelcontextprotocol/server-github`
2. 用 `node -e` 包一层，而不是直接 `bash -lc`
3. 过滤官方 server 启动时写到 stdout 的 banner

原因：

OpenCode 会把 stdout 当作 MCP transport，banner 混进 stdout 会污染协议流。

### 4.3 远端免重新鉴权

远端 sandbox 中不要再让 `gh auth login` 或浏览器 OAuth 重新跑一遍。

推荐做法：

1. 在 `opencode.json` 里写入 GitHub MCP server 条目。
2. 在该 server 的 `environment` 中注入 `GITHUB_PERSONAL_ACCESS_TOKEN`。
3. 在 `opencode serve` 进程环境中同时注入：
   - `GITHUB_PERSONAL_ACCESS_TOKEN`
   - `GH_TOKEN`
   - `GITHUB_TOKEN`

这样做的好处：

1. 模型能直接通过 MCP 使用 GitHub server。
2. 如果模型退回 shell 调 `gh`，也不需要再次登录。
3. 整个 sandbox 生命周期内都复用同一份已授权态。

当前实现参考：

1. [sandbox-agent-provision-service.ts](/Users/eunice/codingProject/oneceo/apps/api/src/services/sandbox-agent-provision-service.ts)
2. [session-connector-service.ts](/Users/eunice/codingProject/oneceo/apps/api/src/services/session-connector-service.ts)

## 5. 热加载 / 热卸载的最佳判定标准

不管最终使用哪种方案，业务侧都应该按下面标准判定状态。

### 5.1 attach 成功

必须同时满足：

1. 用户级连接器是 `authorized`
2. task session binding 的 `desiredState = attached`
3. 远端 `GET /mcp` 可见该 server
4. 该 server 状态是 `connected`

不要只因为：

1. `POST /mcp` 返回 200
2. `POST /connect` 返回 `true`

就把状态写成成功。

### 5.2 detach 成功

必须同时满足：

1. binding 的 `desiredState = detached`
2. 远端 `GET /mcp` 已经不再包含该 server

### 5.3 失败回写

一旦远端实际状态不符合预期，要把失败写回 binding。

推荐错误语义：

1. `运行时未保留已注册的 MCP 服务`
2. `运行时仍保留已卸载的 MCP 服务`
3. `连接器尚未完成授权或配置`

## 6. 什么时候用热加载，什么时候必须重启

### 可以尝试热加载的情况

1. 该 MCP 不依赖用户认证态
2. runtime 已被证明能稳定保留动态注册 server
3. 对短时工具启用有低延迟要求

### 必须改配置并重启的情况

1. 该 MCP 依赖用户 token / OAuth 状态
2. 该能力需要在后续多轮执行中持续存在
3. 模型需要同时具备 MCP 能力和 shell fallback 能力
4. 当前 runtime 对 `/mcp` 动态注册存在假成功风险

GitHub 连接器属于第 2 类。

## 7. 推荐的标准流程

### 7.1 attach 标准流程

1. 校验当前用户对 session 有权限
2. 读取用户级授权物料
3. 若 runtime 未启动，先启动 runtime
4. 生成当前 session 全量连接器配置
5. 重写远端 `opencode.json`
6. 重启 `opencode serve`
7. `GET /mcp` 复查
8. 更新 binding 为 `connected`

### 7.2 detach 标准流程

1. 将该连接器从 session 期望 attach 列表移除
2. 重写远端 `opencode.json`
3. 重启 `opencode serve`
4. `GET /mcp` 复查该 server 已消失
5. 更新 binding 为 `disconnected`

### 7.3 sandbox 重放标准流程

当 sandbox 复用、恢复或重连时：

1. 根据 `taskSessionId` 取出所有 `desiredState = attached` 的连接器
2. 重新生成完整 `opencode.json`
3. 再次注入必要的环境变量
4. 重启 OpenCode
5. 回读 `/mcp`

不要依赖旧 runtime 内存态继续存在。

## 8. 当前已验证到的事实

在当前仓库实现下，下面几件事已经被真实验证过：

1. 仅靠 `POST /mcp` / `POST /connect` 会出现假成功。
2. 把 GitHub server 写入远端 `opencode.json` 后再重启，`GET /mcp` 可以稳定看到 `github--<taskSessionId>`.
3. `opencode serve` 进程环境里注入 `GH_TOKEN` / `GITHUB_TOKEN` 后，远端不需要再做浏览器登录。

这意味着：

“认证后的 GitHub MCP 直接注入远端 sandbox OpenCode”已经是当前可落地方案。

## 9. 常见误区

### 误区 1

“接口返回 connected，就说明连接器可用了。”

错误。必须再查 `GET /mcp`。

### 误区 2

“只要有 MCP server，就不需要给进程注入 `GH_TOKEN`。”

错误。模型可能退回 shell 路径，shell fallback 仍需要环境变量。

### 误区 3

“新建会话 ID 只要前端能识别就行。”

错误。若会话还要写入数据库并参与 connector attach，ID 必须和数据库主键类型兼容。当前 `task_creation_sessions.id` 是 UUID。

## 10. 推荐落档位置与后续维护

本主题的运行态最佳实践固定放在：

[sandbox-opencode-mcp-热加载与免鉴权连接器-最佳实践.md](/Users/eunice/codingProject/oneceo/docs/最佳实践的文档/sandbox-opencode-mcp-热加载与免鉴权连接器-最佳实践.md)

建议后续维护规则：

1. 若变更的是“设计意图”或“产品交互”，更新设计文档。
2. 若变更的是“当前线上最稳做法”，优先更新本文。
3. 若未来 OpenCode 真正支持稳定动态 MCP 热刷新，可在本文把方案 A 的级别从“受限方案”提升为“推荐方案”。
