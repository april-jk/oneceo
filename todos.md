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

