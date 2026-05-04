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
