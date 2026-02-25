# 20260224 - 切换至 E2B Sandbox 与 OpenCode 直连

## 变更背景

- 执行环境不再依赖 `kvm-orchestrator`，改为 E2B 平台统一管理 Sandbox。
- OpenCode 运行于 E2B `opencode` 模板内，通过 OpenCode HTTP Server 直接访问（SSE 事件转发），OSAC 不再参与数据处理。

## 关键改动

- `sandboxEnvironmentService`/`sandboxAgentProvisionService`：创建 E2B sandbox，启动 `opencode serve`，写入 `sandbox_execution_environments.metadata`（包括 `opencodeBaseUrl`、`e2b.trafficAccessToken` 等）。
- `sandboxAgentProvisionService`：启动前写入 `/home/user/.config/opencode/opencode.json`，锁定 provider 与默认模型（避免回落到 opencode.ai Zen）。
- `osac-agent-service`：改为直接调用 OpenCode HTTP API，事件流使用 SSE（`/global/event`）并转发为 `OPENCODE_EVENT`。
- `task-creation-routes`：新增 OpenCode SSE 转发代理（`/api/task-creation/sessions/:sessionId/opencode/events`），支持按会话过滤并为多租户隔离提供入口。
- `task-creation-routes`：新增执行环境显式启动接口（`POST /api/task-creation/sessions/:sessionId/runtime/start`），当 sandbox 休眠/关闭时不自动拉取数据，需用户触发加载后再启动。
- `opencode-event-stream-service`：在 sandbox 丢失时标记环境 `closed`，避免前端收到无效错误并触发自动拉取。
- `sandbox-routes`：保留环境 open/close 查询，KVM VM/Job/Quota 相关接口返回 410。

## 运行依赖与环境变量

必填：
- `E2B_API_KEY`：E2B 平台访问密钥

可选（建议配置）：
- `E2B_TEMPLATE`：默认 `opencode`
- `E2B_TIMEOUT_MS`：sandbox 超时（默认 30 分钟）
- `E2B_ALLOW_INTERNET`：是否允许访问公网（默认 true）
- `E2B_ALLOW_PUBLIC_TRAFFIC`：是否允许公网访问 sandbox 服务（默认 true）
- `E2B_CONNECT_TIMEOUT_MS`：E2B API 连接超时（默认 30000ms）
- `E2B_INSECURE_TLS`：企业代理场景下允许忽略 TLS 校验（默认 false）
- `E2B_TLS_CA_FILE`：自定义 CA 文件路径（如企业根证书）
- `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY`：若需通过代理访问 E2B API，可在环境变量中配置
- `OPENCODE_SERVER_PORT`：OpenCode 端口（默认 4096）
- `OPENCODE_SERVER_HOST`：OpenCode 监听地址（默认 0.0.0.0）
- `OPENCODE_PROMPT_TIMEOUT_MS`：OpenCode `/message` 请求超时（默认 120000ms）
- `OPENCODE_EVENT_FILTER_DIRECTORY`：是否按 workspace 目录过滤 OpenCode 事件（默认 false，获取全量事件）
- `OPENAI_API_KEY` / `OPENAI_BASE_URL`
- `ANTHROPIC_API_KEY` / `GEMINI_API_KEY`
- `OPENCODE_MODEL` / `OPENCODE_PROVIDER_ID`（建议 `hone`，使用 `@ai-sdk/openai-compatible` 走 `OPENAI_*`，避免 `/responses` 不兼容）
- `OPENAI_API_BASE` / `OPENCODE_BASE_URL`：可作为 `OPENAI_BASE_URL` 的 fallback，写入 opencode.json 时自动取值
- `E2B_SANDBOX_VERIFY_ENABLED`：是否启用 sandbox 内部验证脚本（默认 true）
- `E2B_SANDBOX_VERIFY_TIMEOUT_MS`：验证脚本超时（默认 90000ms）
- `E2B_CREATE_RETRIES`：创建 sandbox 重试次数（默认 3）
- `E2B_CREATE_RETRY_DELAY_MS`：创建 sandbox 重试间隔（默认 2000ms）

验证脚本参考：`oneceo/apps/api/src/scripts/e2b-sandbox-verify.sh`

## 验证步骤

1. 设置 `E2B_API_KEY` 与 OpenCode 相关模型环境变量。
2. 创建任务（触发 provisioning），确认 `sandbox_execution_environments.metadata.opencodeBaseUrl` 已写入。
3. 访问任务详情页面，文件树与文件预览应可正常加载。

## 回滚提示

- 如需回退到 KVM 模式，可恢复旧版 `sandbox-agent-provision-service` 与 `sandbox-environment-service`，并在配置中切换为 KVM 相关环境变量。
