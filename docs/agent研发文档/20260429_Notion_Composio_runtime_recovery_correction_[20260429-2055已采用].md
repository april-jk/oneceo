# 20260429 Notion Composio runtime recovery correction [20260429-2055已采用]

状态：`[20260429-2055已采用]`

## 1. 背景

Notion 已经改为通过 Composio Tool Router 与 OneCEO API broker 暴露 MCP 工具。当前有效链路是：

1. 用户通过 Composio Connect Link 完成 Notion 授权。
2. API 保存 Composio MCP URL 与 headers 的服务端密文。
3. 会话 attach 时向 OSAC 注册 backend RPC provider。
4. OSAC 只调用 OneCEO API broker，Sandbox 不接收 Composio 或 Notion token。
5. Notion MCP 工具在 managed run 中来自 `runtimeTransport=api_brokered_mcp` 的 provider snapshot。

## 2. 问题

旧恢复逻辑仍包含 Notion `remote_sse` 迁移：

1. 只要 Notion binding 的 `runtimeTransport` 不是 `remote_sse`，就会被当作旧绑定迁移。
2. Composio Notion 的正确 transport 是 `api_brokered_mcp`，因此会被误判。
3. 误迁移会把 binding 改成 `pending_recover`，并清空 `runtimeProviderId` 与 `runtimeAttachedToolsJson`。
4. managed run 捕获 MCP snapshot 时只暴露 `connected` binding，所以 Notion 工具不会进入本次 run。
5. 后续模型按 guide 调用 `notion__COMPOSIO_SEARCH_TOOLS` 时，runtime 找不到工具，返回 `unsupported_tool:notion__COMPOSIO_SEARCH_TOOLS`。

## 3. 修复原则

1. Notion 不再走旧 Notion direct OAuth、Notion official remote MCP 或 `remote_sse` 恢复迁移。
2. Notion recovered/connected 状态只认可 `runtimeTransport=api_brokered_mcp`。
3. MCP tool snapshot 只允许暴露 Composio brokered Notion provider。
4. 旧 Notion profile/binding 不做兼容转换，不作为 fallback 暴露给模型；需要重新通过 Composio 授权。
5. 不新增绕过恢复表、状态表或 OSAC 的临时直连方案。

## 4. 代码修改范围

1. `apps/api/src/services/session-mcp-recovery-service.ts`
   - 移除 active recovery path 中的 Notion `remote_sse` migration。
   - 在 recovered 判断中要求 Notion binding transport 为 `api_brokered_mcp`。
2. `apps/api/src/services/altus-managed-setup-service.ts`
   - MCP tool snapshot 对 Notion 只接收 `api_brokered_mcp` provider。
3. `apps/api/tests/session-mcp-recovery-service.test.ts`
   - 删除旧 `remote_sse` 迁移预期。
   - 增加 Composio Notion 不被迁移、不被打回 pending 的回归测试。
4. `apps/api/tests/altus-managed-setup-service.test.ts`
   - 增加 snapshot 只暴露 `api_brokered_mcp` Notion 工具的测试。

## 5. 验证目标

1. `ensureSessionRecovered()` 不会把 Composio Notion binding 改成 `pending_recover`。
2. `captureMcpToolSnapshot()` 能把 connected + `api_brokered_mcp` 的 Notion 工具带入 managed run。
3. connected 但 transport 为 `remote_sse` 的 Notion 工具不会进入 snapshot。
4. `notion__COMPOSIO_SEARCH_TOOLS` 的 `unsupported_tool` 不再由恢复逻辑清空 provider snapshot 引起。

## 6. 2026-04-29 toolkit slug correction

Observed runtime logs after reauthorization show the attached Composio provider exposes the expected router tools with the app slug `notion`:

1. `notion__COMPOSIO_SEARCH_TOOLS`
2. `notion__COMPOSIO_GET_TOOL_SCHEMAS`
3. `notion__COMPOSIO_MULTI_EXECUTE_TOOL`

Therefore the active default is `COMPOSIO_NOTION_TOOLKITS=notion`. `NOTION_MCP_OAUTH` / `notion_mcp_oauth` remains documentation history only and must not be used as the production default.

If an old task session still reports `pending_recover` after this correction, reattach Notion to that specific task session so it captures a fresh `api_brokered_mcp` provider snapshot.

## 7. 2026-04-29 implementation changes

### 7.1 Notion toolkit slug

Files:

1. `apps/api/src/connectors/definitions/notion.ts`
2. `apps/.env.example`

Changes:

1. Default `COMPOSIO_NOTION_TOOLKITS` changed from `NOTION_MCP_OAUTH` to `notion`.
2. `.env.example` now documents `COMPOSIO_NOTION_TOOLKITS=notion`.
3. This matches the observed Composio router provider that exposes `notion__COMPOSIO_SEARCH_TOOLS`.

### 7.2 Recovery no longer rewrites Notion to remote_sse

File: `apps/api/src/services/session-mcp-recovery-service.ts`

Changes:

1. Removed the active Notion `remote_sse` migration path.
2. Removed logic that rewrote non-`remote_sse` Notion bindings to `pending_recover`.
3. Added recovered-state validation for Notion:
   - `runtimeTransport` must be `api_brokered_mcp`.
   - `runtimeAttachedToolsJson` must contain tools.
4. Legacy `remote_sse` Notion bindings are not considered recovered and are not exposed as usable MCP state.

### 7.3 MCP snapshot only exposes Composio Notion tools

File: `apps/api/src/services/altus-managed-setup-service.ts`

Changes:

1. `captureMcpToolSnapshot()` filters Notion providers by `runtimeTransport=api_brokered_mcp`.
2. Connected Notion bindings using legacy `remote_sse` are excluded from managed run MCP providers.
3. This prevents old Notion direct MCP state from entering the model tool list.

### 7.4 Attach operations are serialized per session connector

File: `apps/api/src/services/session-connector-service.ts`

Problem observed:

1. Manual attach, automatic attach, and recovery could run concurrently for the same `taskSessionId + connectorKey`.
2. One attach chain could successfully connect the provider while another chain later returned `disconnected` or `mcp provider not found`.
3. The later failure could overwrite the successful binding and return the connector to failed or pending recovery state.

Changes:

1. Added an in-memory attach lock keyed by `taskSessionId:connectorKey`.
2. `attachConnector()` now serializes concurrent attach attempts for the same session connector.
3. Waiting attach attempts log `CONNECTOR_ATTACH_LOCK_WAIT`.
4. If OSAC returns an unexpected attach status, the service probes `LIST_SESSION_MCP_TOOLS`.
5. If the live provider is already connected, the live provider is accepted as the final state and the binding is not marked failed.
6. This path logs `CONNECTOR_ATTACH_PROVIDER_LIVE_AFTER_UNEXPECTED_STATUS`.

### 7.5 Managed run waits for attach before snapshots

Files:

1. `apps/api/src/services/session-connector-service.ts`
2. `apps/api/src/services/altus-managed-setup-service.ts`

Problem observed:

1. A run could generate `ALTUS_RUN_PROMPT_READY` after `CONNECTOR_ATTACH_REGISTER_PROVIDER` but before `CONNECTOR_ATTACH_PROVIDER_LIVE`.
2. In that window the connector guide was present, but the MCP provider snapshot did not yet contain Notion tools.
3. The model then attempted `notion__COMPOSIO_SEARCH_TOOLS`, and runtime returned `unsupported_tool`.

Changes:

1. Added `waitForAttachIdle(taskSessionId, connectorKey?, timeoutMs)` to `session-connector-service.ts`.
2. `captureConnectorSnapshot()` waits for the session attach lock before reading connector status.
3. `captureConnectorSnapshot()` waits again after recovery, because recovery itself may enqueue/perform attach.
4. `captureMcpToolSnapshot()` waits for the session attach lock before reading bindings.
5. Snapshot waiting logs `CONNECTOR_ATTACH_LOCK_WAIT_FOR_SNAPSHOT`.

Expected log order after this fix:

1. `CONNECTOR_ATTACH_REGISTER_PROVIDER`
2. `CONNECTOR_ATTACH_PROVIDER_REGISTERED`
3. `CONNECTOR_ATTACH_PROVIDER_LIVE`
4. `ALTUS_RUN_PROMPT_READY`

`ALTUS_RUN_PROMPT_READY` should no longer appear before Notion provider live attach completes for the same session.

## 8. Verification

Commands run:

```text
pnpm.cmd --filter api type-check
node --import tsx --test --experimental-test-isolation=none tests/session-mcp-recovery-service.test.ts
node --import tsx --test --experimental-test-isolation=none tests/altus-managed-setup-service.test.ts
```

Results:

1. API type-check passed.
2. Session MCP recovery tests passed.
3. Altus managed setup snapshot tests passed.
