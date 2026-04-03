# 2026-03-31 自动工作汇报

## 连接器权限与 GitHub MCP 排查

- 排查了 Altus 模式下 GitHub connector 无法创建新仓库的问题。
- 先确认过旧失败里存在 repo allowlist 场景，GitHub MCP wrapper 会按 `ONECEO_GITHUB_ALLOWED_REPOSITORIES` 拦截越权仓库访问。
- 继续排查后确认当前最新会话 `817e03f7-6790-409d-b952-82c6015abcf1` 的 GitHub 绑定 `session_config_json=null`，已经是不限定仓库的账号级会话。
- 当前最新失败根因不是权限不足，而是 Altus 动态 MCP tool name 发生截断碰撞。

## 已做修复

- OSAC 错误透传现在优先使用 `details.error/details.message`，避免 GitHub repo scope 拒绝被吞成通用错误。
- Altus managed prompt 现在把 GitHub connector 明确标成 `authorized_repositories` 和 `scope=only_these_repositories`。
- Altus 动态 MCP tool name 改成 `toolName + 短哈希(providerId::toolName)` 的稳定唯一格式，避免多个 GitHub 工具被压成同一个 `mcp__task_session_...` 名称。
- 更新了连接器设计文档，明确 GitHub session attach 的 repo-scoped 权限语义和报错要求。
  同时补充了“未选择仓库时视为账号级开放”和“动态 tool name 必须唯一”。

## 下一步

- 重启 `apps/api` 后复现一次 GitHub 创建新仓库流程，确认 `create_repository` 会落到正确的 GitHub MCP tool。
- 继续看一次远端 `git push` 的失败明细，确认剩余问题是 GitHub PAT 推送权限、仓库不存在，还是 agent 还在走不必要的 shell fallback。

## MCP live recovery fix

- 修复 Altus 会话在 OSAC bridge 重启后，DB 仍标记 connector 为 connected 但 OSAC 内存 provider 已丢失时，recovery 被错误跳过的问题。
- `ensureSessionRecovered()` 现在会先做一次 `listSessionMcpTools()` live 对账，只有 provider 在 OSAC 当前会话里真实存在时才允许 skip。
- 这次用户遇到的 `MCP_TOOL_CALL_FAILED: mcp provider not found` 对应就是这条缺口。

## GitHub App 错误提示补全

- 最新 GitHub `create_repository` 失败已确认是 `Resource not accessible by integration`，不是平台仓库范围限制。
- 在 Altus MCP 运行时增加了 GitHub 错误归一化：
  - `Resource not accessible by integration` -> 明确提示 GitHub App 权限/安装审批问题
  - `No GitHub installation found for repo` -> 明确提示安装范围未覆盖目标仓库
  - `mcp provider not found` -> 明确提示运行态 provider 丢失，需要等待恢复

## 设置页重新授权修复

- 排查出“清除 GitHub 授权后重新连接不跳 GitHub 页面”的根因是设置页前端残留了旧 `accessToken` 表单值。
- 清除授权后，前端会把旧 secret 又随 `persistProfile()` 提交回后端，导致 profile 立刻重新变成 `authorized`，看起来像“秒完成授权”。
- 已修复为：
  - 清除授权时同步清空本地 `accessToken/dsn` 表单状态
  - profile 没有 `secretSummary` 时，不再沿用旧 secret 输入值

## GitHub App 设置页交互补全

- 修正了 GitHub 连接器详情弹窗的主按钮行为；已授权状态下不再错误地只打开安装页，而是保留“重新连接”主操作。
- 为 GitHub 连接器补充了 GitHub App 专属说明：本地清除授权不等于撤销 GitHub 侧授权，用户需要按需去 GitHub 管理授权或安装。
- 在设置页增加了“管理 GitHub 授权”和“管理 GitHub 安装”两个直达入口，并补充了 `Resource not accessible by integration` 场景下的前端提示。

## GitHub 连接强制重新经过授权入口

- 按用户要求，把 GitHub OAuth 启动参数固定补成 `prompt=select_account`。
- 这样每次点击 GitHub 连接器都会重新经过 GitHub 授权入口，不再只在 oneceo 本地沿用已授权状态。
- 同时保留 GitHub App 安装权限边界说明：安装级权限更新仍取决于 GitHub 安装页是否批准，不是 OAuth 回调本身就能强制完成。

## Altus 重试 GitHub 工具约束

- 排查了用户重新授权后的最新 run，确认 GitHub provider 已重新 attach，但最新 run 没有再次调用 `create_repository`，而是直接沿用旧的 403 失败结论回复用户。
- 因此补了 Altus managed prompt 规则：如果用户说明已重新授权、重新连接或要求重试，当前 run 必须重新调用连接器工具，不能直接沿用历史失败作为当前结论。
- 继续补了 session connector 摘要中的 `last_authorized_at`，要求 Altus 把所有早于该时间的连接器失败视为过期结论。

## GitHub OAuth 授权页修正

- 用户对照 Manus 的 GitHub OAuth 链接后，确认 oneceo 额外注入了 `prompt=select_account`，会把 GitHub 授权流导向账户挑战页，而不是标准 `login/oauth/authorize` 页面。
- 已移除 GitHub connector OAuth 启动参数里的 `prompt=select_account`，恢复为 GitHub 标准授权流，仅保留现有 `access_type=offline`。
- 同步修正连接器设计文档，撤销“固定带 `prompt=select_account`”这一错误约束，改为明确要求保持标准授权入口。

## GitHub OAuth 回调后自动刷新 session runtime

- 继续排查发现，最新一次成功落库的 GitHub OAuth 完成时间仍停在北京时间 2026-03-31 13:10 左右；后续用户感知到的“重新授权”没有形成新的 completed callback。
- 同时，现有链路即使 OAuth 成功，也只会更新 profile 的 `last_auth_at` 和 secret，不会自动把当前 session binding / OSAC runtime 一起刷新。
- 已补上自动刷新逻辑：OAuth callback 成功后，系统会自动扫描所有引用该 profile 且 `desired_state=attached` 的 session binding，直接重走 attach，把最新授权同步到当前 runtime，对用户隐藏 OSAC 细节。

## API 数据库环境加载修正

- 用户在右下角看到 `Failed query: select ... from user_connector_profiles`，继续排查后确认并不是 SQL 字段不存在，而是 API 启动时没有读到 `apps/.env` 里的 `DATABASE_SSL=disable`。
- `apps/api/src/config/database.ts` 之前只尝试读取当前目录 `.env` 和 `apps/api/.env`，遗漏了实际在用的 `apps/.env`。
- 已补充 `apps/.env` 的加载候选路径，避免 API 进程误用默认 SSL 配置连接数据库，从而把底层连接错误伪装成通用的 Failed query。

## session MCP backlog 数据库瞬断防崩溃

- 用户继续提供日志后，确认另一个问题不是 SQL 本身错误，而是 PostgreSQL 连接被远端直接 `ECONNRESET`。
- `sessionMcpRecoveryService.recoverBacklog()` 作为后台恢复任务，之前在 backlog 扫描阶段没有兜住数据库异常，瞬时断连会直接把 Promise 抛穿，导致 API 进程退出。
- 已修复为：backlog 恢复入口先做数据库健康检查；对 job/binding/environment/sandboxBinding 的数据库读取全部做错误记录并跳过当前周期；启动入口也补了 `.catch()` 日志，避免后台恢复任务再把主进程打崩。

## GitHub 连接/断开路径收紧

- 用户明确要求 GitHub 点击“连接/重新连接”必须重新走标准 `https://github.com/login/oauth/authorize` 授权入口，不能走其他挑战页或本地短路逻辑。
- 已把 GitHub OAuth provider 的 `authorizationUrl` 固定为标准 `login/oauth/authorize`，不再允许通过 `GITHUB_CONNECTOR_AUTHORIZE_URL` 改写授权入口。
- 用户还要求点击“断开连接”必须彻底；已在后端增加 GitHub grant revoke，断开时会先撤销 GitHub 侧 OAuth grant，再清除本地授权态，并自动 detach 所有引用该 profile 的 session runtime 绑定。

## GitHub 断开连接耗时优化

- 用户反馈点击“取消授权”也会很久，继续排查后确认主要耗时来自两段：GitHub revoke 网络请求没有超时控制；前端在断开成功后还同步等待整页 reload。
- 已为 GitHub revoke 增加 8 秒超时，避免远端卡住导致前端一直等待。
- 已把按 profile 清理 session runtime 的 detach 改成并行执行。
- 前端断开成功后改成后台异步 `load()`，不再让按钮一直转到列表刷新完成。

## GitHub installation-ready 校验补齐

- 继续做全链路排查后，直接用当前保存的 GitHub token 访问官方 API 验证：`/user` 返回正常，但 `/user/installations` 返回 `total_count=0`，同时 `POST /user/repos` 原样返回 `403 Resource not accessible by integration`。
- 这确认当前问题不是 oneceo 继续吃旧 token，而是 GitHub App 只有 user OAuth，没有任何 installation 上下文；因此 `create_repository` 必然失败。
- 已在 GitHub OAuth callback 后增加 installation 校验：如果 `user/installations` 为空，就不再把 profile 记为 `authorized`，而是直接改成 `needs_auth` 并写入“GitHub App 已授权，但当前账号下没有任何可用安装”的明确错误。
- 已在 GitHub attach 前的授权校验里补同一条 installation 校验，确保旧的假成功状态也会被自动纠正。
- 已把前端 GitHub 详情页和 OAuth callback 提示改成显式区分“已授权”和“已安装可用”，避免继续出现“连接成功但创建仓库 403”的假成功体验。

## GitHub 取消授权流程去阻塞

- 用户继续反馈点击“取消授权”会一直转圈，但关闭弹窗后又能看到本地已经变成可重新授权，说明本地清理和远端/运行态清理被混在一个同步请求里，前端感知失真。
- 已把 GitHub 断开链路调整为：本地 profile 清理完成后立即返回；session runtime detach 改为后台异步执行，不再阻塞前端。
- 同时保留 GitHub 远端 revoke，但如果远端 revoke 超时或失败，不再阻塞本地断开，而是把 `remoteGrantRevoked=false` 和错误原因返回给前端。
- 前端收到这类结果时，会明确提示“本地授权已清除，但 GitHub 远端撤销未确认；如果重新连接时 GitHub 直接回跳，请到 GitHub 授权页手动撤销后再试”，避免把 GitHub 的直接回跳误判成 oneceo 没有执行断开。
