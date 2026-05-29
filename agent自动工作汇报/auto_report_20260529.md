# 2026-05-29 自动工作汇报

## 默认会员 Lite 生产阻断修复

- 排查生产部署任务运行失败，确认核心问题是默认会员仅允许 `agent lite`，但用户端入口仍可能默认或提交 `pro/max`，导致后端会员权益校验拒绝。
- 将用户端任务入口统一收口到共享 Agent tier 配置，当前只暴露并提交 `lite`；任务元数据构造时会把不可用 tier 归一为 `lite`。
- 增加任务交接链路回归测试，确保会员权益拒绝时不会创建 run，也不会进入 Altus coordinator，并且错误信息会保留给用户侧排查。
- 已完成 API 相关回归、Web type-check、元数据单测和 diff 检查；Railway CLI 当前未授权，重新部署与线上验证需要登录恢复后继续触发。

## Sandbox / Codex / OpenCode 密钥残留检查

- 做了什么：检查 E2B sandbox templates、OpenCode/Codex runtime 配置写入链路、本地环境文件、已跟踪文件高置信密钥形态，以及当前可用 Railway 凭据能访问的 production/product 环境变量。
- 结论：
  - `e2b_templates/` 未发现硬编码 API Key / token / 数据库连接串形态的残留。
  - Codex / OpenCode 的 sandbox 运行时配置会在 provision 阶段写入 `~/.codex/auth.json` 或 `~/.config/opencode/opencode.json`，来源是服务端环境变量中的 sandbox / engine / OpenAI 兼容配置。
  - 本地 `.env.product`、`.env.staging`、`.env.develop` 存在 sandbox engine API Key 相关变量；`env.windows` 和部分历史文档/调试文件存在高置信密钥或数据库连接串形态残留，需要按“曾进入仓库历史”的标准轮换。
  - 当前 `.env.product` 中 Railway token 可访问的用户托管项目未发现 sandbox/API key 类变量残留；该 token 无权访问本机 Railway CLI 绑定的 oneceo product project，因此平台三端 production/product Railway 变量仍需用有效 Railway 登录或对应 project token 复核。
- 遇到什么：本机 Railway CLI 登录已过期，`railway whoami/status` 返回需要重新登录；`pnpm dlx @railway/cli@latest` 下载安装也因 GitHub 超时失败。
- 计划如何解决：先轮换已进入仓库历史的密钥与数据库口令，再用有效 Railway 登录或平台 project token 对 oneceo product project 做只读变量名审计；后续考虑把 sandbox executor key 从通用 product env 中拆成最小作用域密钥。
