# 附件能力参照 Suna 重构设计

## 文档目的

本组文档用于为 `oneceo` 补齐一套参照 `suna` 的完整附件能力设计，覆盖：

- 输入框添加附件
- 附件上传与命名
- 附件在消息中的表达协议
- 附件内容解析与 Agent 使用
- Sandbox 文件落点与生命周期
- 前端展示、预览、删除与后续复用

本组文档只定义设计，不进入代码实现。

## 文档范围

本次设计优先覆盖 `task-creation / managed chat` 主链路：

- `apps/web/client/src/pages/Home.tsx`
- `apps/web/client/src/components/TaskCreationChat.tsx`
- `apps/web/client/src/hooks/useTaskCreationAgent.ts`
- `apps/api/src/routes/task-creation-routes.ts`
- `apps/api/src/routes/altus-managed-routes.ts`
- `apps/api/src/services/altus-managed-*`

不覆盖：

- 管理后台文件上传
- 交付物附件展示组件本身的 UI 重构
- KVM 相关历史链路

## 设计原则

1. 参照 `suna` 的完整实现方式，不只复刻上传动作，而是复刻“输入协议 + 上传处理 + prompt 使用 + UI 展示”的整条链路。
2. 不继续维持 `oneceo` 当前“先单独上传附件，再把路径拼成自然语言提示”的做法，改为标准化附件协议。
3. 所有 Sandbox 文件操作继续通过 `apps/api/src/connectors/e2b-connector.ts`。
4. 与 Sandbox 内服务通信仍遵守 OSAC 规则，附件上传本身不新增业务路由直连。
5. 以最短路径完成可用、可维护、可审计的附件能力，不引入与需求无关的兜底逻辑。

## 文档目录

- `01_现状差异_目标与范围.md`
- `02_端到端链路与附件协议.md`
- `03_前端交互与状态模型.md`
- `04_API_Sandbox_Agent使用设计.md`
- `05_实施步骤_风险与验收.md`
