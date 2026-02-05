# AGENTS.md

请先阅读 `CODEX_PROMPT.md` 并按其中约定执行。

## Sandbox / KVM 集成规则（强制）

- `apps/api` 必须通过统一连接器调用 KVM 管理模块，禁止在业务路由或服务中直接请求 KVM 服务。
- 统一连接器位置：`apps/api/src/connectors/kvm-connector.ts`。
- KVM 模块的所有接口都必须经过连接器做参数与响应转换（包括命名风格转换与结构规整）。
