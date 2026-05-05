# Google Super 高风险确认目标提取修复报告 [20260504-1248已采用]

## 背景

用户测试 `google_super__COMPOSIO_MULTI_EXECUTE_TOOL` 发送邮件时，后端识别到高风险写操作，但没有生成确认卡，而是返回 `google_super_confirmation_target_missing`。

## 根因

Google Super 的邮件发送参数可能嵌套在 `arguments` 内，并使用 `recipient_email`、`email_address` 等语义字段。原实现只识别 `to`、`recipient`、`email`、`file_id`、`event_id` 等固定字段，导致确认摘要无法提取目标对象。

## 修复

1. `apps/api/src/services/mcp-tool-confirmation-service.ts`
   - 新增目标字段语义识别，支持 `recipient_email`、`recipientEmail`、`to_email`、`email_address`、`fileId`、`spreadsheetId`、`eventId` 等字段。
   - 支持嵌套 `arguments` / `parameters` / `input` 内的目标字段递归提取。
   - 将 `GOOGLESUPER_SEND_EMAIL` 这类工具动作归类为 `send_email`。
   - 参数摘要支持嵌套字段投影，并继续脱敏 `body` / `content` / `html` / token / secret 类字段。

2. `apps/api/tests/mcp-tool-confirmation-service.test.ts`
   - 增加 `COMPOSIO_MULTI_EXECUTE_TOOL` + `arguments.recipient_email` 场景回归测试。
   - 验证目标对象为 `3095025109@qq.com`，动作摘要为 `send_email`，正文被脱敏。

## 验证

已通过：

```text
pnpm --filter api type-check
pnpm --filter api exec tsx --test tests/mcp-tool-confirmation-service.test.ts tests/composio-connector-service.test.ts
```

## 预期结果

同类邮件发送请求不再抛 `google_super_confirmation_target_missing`，而是创建 pending confirmation 并返回 `confirmation_required`，前端展示“确认 Google Workspace 操作”确认层。

## 2026-05-05 真机补充说明

最新真机回归显示，本修复已经覆盖“确认前无法提取邮件目标对象”的主路径，但仍存在两个剩余边界：

1. 某些会话在 `google_super` 刚恢复时仍会先落入 `pending_recover`，这会让模型直接返回“Google Workspace MCP 当前处于恢复等待状态”，从而绕过本报告所针对的确认目标提取链路。
2. 某些 Gmail 发送场景在用户点击 `确认执行` 后，恢复 run 仍可能退化回重新搜索工具；一旦新一轮规划出的参数结构与原始待确认参数不完全一致，仍可能再次放大成“确认目标缺失”或后续 `managed_model_plain_text_without_tool_call`。

因此，本报告对应的修复结论应更新为：

1. “确认前目标提取失败”这条主因已被显著收敛。
2. 但“批准后恢复退化导致再次换参或重新规划”仍会把该问题以边界形式重新暴露出来。
3. 后续排障重点已不再只是扩充目标字段，还包括确保 approve 后一定恢复原始待确认 tool call，而不是退回模型重新规划。

## 2026-05-05 问题分层更新

结合后续浏览器回归、数据库核对与自动化回归，本报告对应的问题不能再孤立理解为“目标字段提取不够全”，而应拆成三层：

### 一级根因：`confirmation_required` 识别边界不完整

当前真实链路中，`confirmation_required` 可能被包装进 provider envelope，而不是只以顶层对象出现。若协调器没有在外层包装中继续识别待确认语义，就会导致：

1. 原始 run 未稳定停在 `waiting_user`
2. 模型继续往下规划
3. 甚至在未批准前写出“已成功发送邮件”之类成功总结

### 二级根因：approve 后 replay 首轮失败仍可退化回普通规划

当前真实链路还存在另一条结构性偏差：

1. `/approve` 后首轮 synthetic replay 可能先失败
2. 失败后 run 没有立即终止
3. 反而继续进入：
   - `load_connector_guide`
   - `COMPOSIO_SEARCH_TOOLS`
   - `COMPOSIO_GET_TOOL_SCHEMAS`
   - `COMPOSIO_MULTI_EXECUTE_TOOL`

这意味着系统执行的已经不再是“原始待确认动作直恢复”，而是重新让模型规划了新一轮动作。

### 三级表象：`google_super_confirmation_target_missing`

在上述两层偏差叠加后，`target_missing` 才会被重新放大为显性错误：

1. 原始待确认参数已经可以提取目标对象
2. 但 approve 后如果系统退回普通规划，模型可能重新组织出另一份参数结构
3. 新参数结构与原始待确认调用不完全一致时，就可能再次触发：
   - `google_super_confirmation_target_missing`

因此，本报告对应的问题定位应更新为：

1. `target_missing` 仍然重要
2. 但它已经不是当前链路中的最前置根因
3. 它更像是“确认识别失稳 + replay 失败后重规划”叠加出来的次级症状

## 本轮补充修复

### 1. 确认/拒绝后立即关闭确认卡片

- 文件：`apps/web/client/src/pages/Home.tsx`
- 前端新增已处理 `confirmationId` 集合。
- 当用户点击 `确认执行` 或 `拒绝` 且整条后续提交流程成功后，对应确认卡片立即从时间线中隐藏。
- 这样可以避免同一张卡片被重复点击，防止多次确认或多次拒绝。

### 2. 不再把确认/拒绝写成普通输入文本

- 文件：
  - `apps/web/client/src/lib/mcp-tool-confirmation.ts`
  - `apps/web/client/src/hooks/useTaskCreationAgent.ts`
  - `apps/api/src/services/altus-managed-run-entry-service.ts`
- 前端点击确认/拒绝后，不再提交“已确认本次 Google Workspace 高风险操作”这类自然语言文本。
- 现在前端只提交结构化 `mcpToolConfirmation` metadata。
- 后端在收到 metadata-only 请求时，会自动补内部占位内容：
  - 确认：`[mcp_tool_confirmation:approve]`
  - 拒绝：`[mcp_tool_confirmation:reject]`
- 这样可以保证运行时继续依赖结构化协议，而不是依赖输入框文本语义。

### 3. 修复 `mcp_confirmation_expired`

- 文件：
  - `apps/api/src/services/mcp-tool-confirmation-service.ts`
  - `apps/api/src/db/dao/task-session-mcp-tool-confirmation.dao.ts`
- 根因：
  - 原实现中，用户点击 approve 后虽然生成了新的 confirmation token，但 `expiresAt` 仍沿用“待确认记录创建时的过期时间”。
  - 当用户在 pending confirmation 即将过期时点击确认，approve 可以成功，但 agent 随后携带 token 重试 tool call 时，消费阶段会因为旧 `expiresAt` 已到而报 `mcp_confirmation_expired`。
- 修复方式：
  - approve 成功时，后端会重新按 `GOOGLE_SUPER_CONFIRMATION_TOKEN_TTL_SECONDS` 计算一次 token 专属过期时间。
  - 新的 `expiresAt` 会随 approve 一起写回数据库，并返回给前端。
- 结果：
  - token 的有效期从“用户确认的时刻”重新开始计算，不再继承旧 pending 过期时间。

## 当前结论更新

截至本报告本轮更新时，更准确的结论应为：

1. 本报告中的目标提取修复，已经覆盖“确认前主路径无法抽出邮件目标对象”的主要问题。
2. 但当前 Google Super 高风险确认链的主要风险，不再只是目标字段不足。
3. 后续如果只继续扩充 `recipient_email`、`fileId`、`spreadsheetId` 等字段映射，而不修正：
   - provider envelope 中的 `confirmation_required` 识别
   - approve 后 replay 首轮失败不可降级
   - confirmation 与 originating run 的绑定
   仍然无法完成闭环。
4. 因此，本报告应被理解为“局部修复已完成，但当前主链仍被上游确认识别与恢复语义问题压住”。

## 本轮回归测试

- `apps/web/client/src/tests/mcp-tool-confirmation.test.ts`
  - 更新为验证确认/拒绝 follow-up 不再包含普通聊天文本，只保留结构化 metadata。
- `apps/api/tests/mcp-tool-confirmation-service.test.ts`
  - 新增 approve 后刷新 token 过期时间的测试，覆盖 `mcp_confirmation_expired` 修复。
- `apps/api/tests/altus-managed-run-entry.service.test.ts`
  - 新增 metadata-only MCP confirmation 请求测试，验证后端可在 `content` 为空时继续接收并构造运行态输入。
