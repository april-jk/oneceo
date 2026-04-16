# TODO 索引

## 2026-03-20

### 文档

- 管理文档：
  - [Codex_e2b-template_sandbox配置文件直编与LLM设置设计.md](/Users/watson/codingProj/oneceo/docs/agent研发文档/Codex_e2b-template_sandbox配置文件直编与LLM设置设计.md)

### TODO 列表

1. 平台统一 LLM 计费与模型切换
   - 现状：当前只实现 `codex`
   - 后续需要补齐其他模型的统一供应商切换、统一计费、审计与额度控制

2. 运行中配置热更新
   - 现状：当前只对新启动 sandbox 生效
   - 后续需要补齐运行中会话的配置热重载能力

3. 配置版本管理
   - 现状：当前每个用户只保存一份生效配置
   - 后续需要补齐历史版本、回滚与审计

## 2026-03-24

### 文档

- 管理文档：
  - [LLMAPI统一供应商与协议兼容层设计.md](/Users/watson/codingProj/oneceo/docs/agent研发文档/LLMAPI统一供应商与协议兼容层设计.md)

### TODO 列表

1. 多模态 block 协议映射
   - 现状：`llm-proxy` 当前只完成了文本与自定义工具调用的一致化
   - 后续需要补齐 Anthropic image/document 等 block 与 OpenAI-compatible content parts 的双向转换

2. `responses` API 兼容层
   - 现状：当前平台代理只覆盖 `/v1/models` 和 `/v1/chat/completions`
   - 后续需要补齐 `/v1/responses` 的请求、响应、流式事件和工具调用映射

3. Anthropic 内建服务型工具映射
   - 现状：当前只支持 oneceo 自定义工具在 Anthropic/OpenAI-compatible 之间的协议转换
   - 后续需要补齐 `server_tool_use`、`web_search`、`code_execution` 等 Anthropic 内建服务型工具的映射与边界定义

## 2026-03-30

### 文档

- 管理文档：
  - [github_auth_logic_[20260330-1000已采用].md](docs/features/connectors/github_auth_logic_[20260330-1000已采用].md)

### TODO 列表

1. GitHub 授权极简流程重构
   - 现状：当前 GitHub 授权流程与普通应用一样，需要手动创建 Profile。
   - 后续需要根据设计文档重构 `ConnectorCenterPanel.tsx`，实现“一键连接”并自动创建默认 Profile。

2. OAuth 回调静默挂载优化
   - 现状：当前授权成功后仅提示保存成功。
   - 后续需要优化回调逻辑，使其在特定场景下自动并静默地将 Profile 挂载到目标会话中。

## 2026-04-03

### 文档

- 管理文档：
  - [20260403_Vercel连接器改为官方OAuth直连方案_[尚未采用_暂未实现-因VercelOAuthIntegration审核严格暂未申请].md](/Users/watson/codingProj/oneceo/docs/agent研发文档/20260403_Vercel连接器改为官方OAuth直连方案_[尚未采用_暂未实现-因VercelOAuthIntegration审核严格暂未申请].md)

### TODO 列表

1. Vercel 官方 OAuth 单路径接入
   - 现状：方案已明确，但要对齐 Manus 的授权路径，必须先拿到 Vercel OAuth integration 的 `client_id / client_secret`
   - 阻塞：Vercel OAuth integration 审核较严格，当前暂未申请，因此暂不继续实现
   - 后续需要补齐：完成 integration 申请后，恢复 Vercel connector 的官方 OAuth 单路径开发与真实联调

## 2026-04-12

### 文档

- 管理文档：
  - [20260412_Issue41_n_eko连接中_ICE失败修复方案_[20260412-1910已采用].md](/Users/watson/.codex/worktrees/d7cc/oneceo/docs/agent研发文档/20260412_Issue41_n_eko连接中_ICE失败修复方案_[20260412-1910已采用].md)

### TODO 列表

1. 调试链路诊断基线固化（T0）
   - 状态：已完成（2026-04-12）
   - 结果：已在 `sandbox-debug-service.ts` 增加诊断采集与 ICE 失败规则探测能力（`collectNekoDebugDiagnostics` + `detectIceFailureFromLog`）。

2. ICE 配置输入与 TURN 强约束（T1-T2）
   - 状态：已完成（2026-04-12）
   - 结果：已实现 `NEKO_ICE_SERVERS_JSON` 严格解析；远程调试链路下无 TURN 直接返回 `failed/missing_turn`。

3. 启动后失败收敛（T3）
   - 状态：已完成（2026-04-12）
   - 结果：已增加启动后 ICE 健康探测，命中失败日志后统一收敛为 `failed/ice_failed` 并写回 metadata。

4. API/前端/工具链路状态一致性（T4-T6）
   - 状态：已完成（2026-04-12）
   - 结果：调试接口已返回 `reasonCode`，前端新增失败态文案，`debug_open_page` 在失败态下 fast-fail 并透传原因。

5. 自动化测试与真机回归（T7-T8）
   - 状态：部分完成（2026-04-12）
   - 已完成：API/Web 类型检查通过；新增/更新单测通过；无 TURN 场景实测已收敛为明确失败态。
   - 待完成：有 TURN 凭据的真机“可见画面”验收仍需你提供可用 TURN 配置后复测。

6. TURN 用户级动态签发链路（T9）
   - 状态：部分完成（2026-04-12）
   - 已完成：后端已支持“按用户创建永久 TURN key + 按次签发临时 ICE 凭据”；`/debug/start` 与 `debug_open_page` 已接入。
   - 待完成：当前 Cloudflare 管理 token 实测返回 `Authorization Failure`，需修正 token 的 Account 范围/Calls 权限后完成实机验收。
