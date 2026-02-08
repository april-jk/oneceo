# AGENTS.md

请先阅读 `CODEX_PROMPT.md` 并按其中约定执行。

## Sandbox / KVM 集成规则（强制）

- `apps/api` 必须通过统一连接器调用 KVM 管理模块，禁止在业务路由或服务中直接请求 KVM 服务。
- 统一连接器位置：`apps/api/src/connectors/kvm-connector.ts`。
- KVM 模块的所有接口都必须经过连接器做参数与响应转换（包括命名风格转换与结构规整）。

## Sandbox / VM 内部连接模块规则（强制）

- `apps/api` 必须通过统一连接器访问 Sandbox 内机器（SSH/RDP/HTTP/WS 等），禁止业务路由或服务直连。
- 统一连接器位置：`apps/api/src/connectors/osac-connector.ts`。
- OSAC WebSocket 客户端位置：`apps/api/src/clients/osac-client.ts`。
- 连接器必须封装：连接建立、鉴权、超时、重试、资源释放，输出统一的响应结构。
- 连接器只接受“执行层环境 sessionId”作为入口参数，通过环境映射获取目标 VM 信息。
- 所有对 Sandbox 内机器的调用必须记录审计元数据（sessionId、目标 VM、操作类型、时间）。
- 模块设计需与 KVM 管理模块一致：`client -> connector -> service -> route` 分层，最小耦合，可替换底层实现。
