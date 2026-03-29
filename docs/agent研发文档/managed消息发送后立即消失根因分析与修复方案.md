# managed 消息发送后立即消失根因分析与修复方案

## 1. 问题现象

当前 `managed` 模式下，用户发送消息后会出现以下现象：

- 第一条消息发送后会短暂显示，然后立即消失
- 第二条及后续消息也会重复该现象
- 刷新页面后，这些用户消息又会重新显示

这说明：

- 用户消息已经被后端成功持久化
- 问题不在“消息没有保存”
- 问题发生在“实时链路把本地已显示的用户消息又覆盖掉了”

## 2. 结论摘要

本问题的主根因不是历史回放、不是附件、也不是单纯的 `sessionId` race。

第一层主根因是：

- 前端 optimistic user message 的 `messageKey`
- 与后端 `run_ack` 实时事件复用了同一个 `messageKey`

于是前端在实时合并时，把原本的 `user_input` 当成“同一条消息的更新”，直接替换成了 `status_update`。

补充排查后确认还有第二层前端根因：

- `bindSessionId(...)` 触发 URL 变化后，location/session 同步 effect 仍可能误判为“切换会话”，调用 `resetConversationState(...)`
- `loadHistory(initial)` 与 cached/recent 回放仍会直接 `setMessages(...)`
- 当 recent/history 还没拿到刚持久化的那条用户消息时，本地 optimistic `user_input` 会被整包清掉

这也是为什么在修掉 `run_ack` key 冲突后，界面仍可能出现：

- 用户消息消失
- 只剩“智能体正在处理...”占位

因为这次不是消息被 `status_update` 覆盖，而是消息列表被 history/session 流程清空了。

## 3. 全链路分析

### 3.1 前端发送链路

入口：

- `apps/web/client/src/pages/Home.tsx`
- `apps/web/client/src/hooks/useTaskCreationAgent.ts`

在 `managed` 模式下，`sendChatInput(...)` 会先本地插入一条 optimistic 用户消息：

- 文件：`apps/web/client/src/hooks/useTaskCreationAgent.ts`
- 位置：`4328` 行附近

关键行为：

1. 生成 `messageKey = generateClientMessageKey('user')`
2. 本地 `setMessages(...)` 插入：
   - `type: 'user_input'`
   - `messageKey: <client key>`
3. 然后调用：
   - `submitTaskCreationManagedInput(...)`

这一步时，用户消息在 UI 中是存在的，说明“发送前半段”是正常的。

### 3.2 后端持久化链路

入口：

- `apps/api/src/services/altus-managed-run-entry-service.ts`

关键行为：

1. 后端接收 `input.messageKey`
2. 用这个 key 持久化用户消息：
   - `persistTimelineMessage(...)`
3. 紧接着又发送 `run_ack`

对应代码：

- 文件：`apps/api/src/services/altus-managed-run-entry-service.ts`
- 位置：`60-85` 行附近

当前实现是：

```ts
const messageKey = asText(input.messageKey) || `managed:${run.id}:${messageType}`;

await this.setupService.persistTimelineMessage({
  ...,
  messageKey,
});

await this.eventWriter.appendRunEvent(run.id, sessionId, 'run_ack', {
  status: 'queued',
  content: 'managed run 已创建',
  messageKey,
});
```

这里已经出现协议层错误：

- `user_input` 的消息身份
- `run_ack` 的事件身份

被错误地混用了同一个 `messageKey`。

### 3.3 实时事件发布链路

入口：

- `apps/api/src/services/altus-run-event-writer.ts`

关键行为：

- `appendRunEvent(...)` 会把 payload 原样广播到 SSE

对应代码：

- 文件：`apps/api/src/services/altus-run-event-writer.ts`
- 位置：`6-31` 行附近

也就是说，后端把 `run_ack.payload.messageKey = 用户消息 key` 直接发给了前端，没有做任何隔离。

### 3.4 前端 managed stream 消费链路

入口：

- `apps/web/client/src/hooks/useTaskCreationAgent.ts`

managed stream 事件处理逻辑会这样取 `messageKey`：

- 优先读 `payload.messageKey`
- 再读 `envelope.messageKey`
- 最后才回退到 `managed:${runId}:${eventType}`

这意味着：

- `run_ack` 如果带了 `payload.messageKey`
- 前端就会直接把它当作该条 UI 消息的唯一身份

### 3.5 前端消息合并链路

入口：

- `apps/web/client/src/hooks/useTaskCreationAgent.ts`
- `mergeRealtimeMessage(...)`

对应代码：

- 文件：`apps/web/client/src/hooks/useTaskCreationAgent.ts`
- 位置：`1343-1381` 行附近

当前规则是：

```ts
const existingIndexByKey = prev.findIndex((item) => resolveAgentMessageKey(item) === messageKey);
if (existingIndexByKey >= 0 && message.type !== 'opencode_event') {
  next[existingIndexByKey] = {
    ...next[existingIndexByKey],
    ...message,
  };
  return next;
}
```

这意味着：

- 只要 `messageKey` 相同
- 且不是 `opencode_event`
- 后到的消息会直接覆盖先到的消息

因此运行顺序会变成：

1. optimistic `user_input(messageKey=user-123)` 插入 UI
2. `run_ack(status_update, messageKey=user-123)` 到达
3. `mergeRealtimeMessage(...)` 判定为同 key
4. `user_input` 被 `status_update` 覆盖

这正好解释了：

- 用户消息“先显示一下”
- 然后“立即消失”

### 3.6 显示层为什么看起来像“消息消失”

入口：

- `apps/web/client/src/pages/Home.tsx`

在 `buildLegacyChatItems(...)` 中：

- `user_input` 会走 `pushUser(...)`
- `status_update` 不会渲染成用户消息气泡

对应代码：

- 文件：`apps/web/client/src/pages/Home.tsx`
- 位置：`1876-1885` 行附近

所以一旦前端 merge 把 `user_input` 覆盖成 `status_update`，UI 看起来就像“用户消息被删掉了”。

实际上不是没了，而是被错误地改成了另一种消息类型。

### 3.7 为什么刷新后又显示

刷新页面后，前端重新走的是：

- `getTaskCreationRecentMessages(...)`
- `getTaskCreationOlderMessages(...)`

这些接口读取的是 `conversation_messages` 等持久化对话历史。

而当前 `run_ack` 是 run event，不是 conversation history。

所以刷新后的历史里只有：

- `user_input`

没有：

- `run_ack status_update`

因此刷新后用户消息重新出现。

## 4. 为什么我之前几次修复没有一次性解决

前几次我处理过两个真实存在的问题：

1. `bindSessionId(...)` 后 URL/session state 同步 race
2. `loadHistory(initial/reconcile)` 覆盖本地 optimistic 消息

最开始它们被我低估了，因为当时更稳定、更直接的覆盖链路是 `run_ack` key 冲突。

但在修掉 `run_ack` 冲突后，新的现象变成：

- 消息先出现
- 然后只剩“智能体正在处理...”
- 刷新后又稳定出现

这说明根因其实有两层：

1. `run_ack` key 冲突会把 `user_input` 覆盖成 `status_update`
2. history/session 流程会把尚未被 recent/history 确认的本地 `user_input` 整包清掉

两层都必须修，才算真正闭环。

## 5. 根本修复原则

必须在协议层把两类身份彻底分开：

1. 用户消息身份
2. run event / status event 身份

不能再让两者复用同一个 `messageKey`。

这不是前端展示补丁问题，而是协议设计错误。

## 6. 正确修复方案

### 6.1 后端修复

文件：

- `apps/api/src/services/altus-managed-run-entry-service.ts`

修复原则：

- `persistTimelineMessage(...)` 继续使用用户消息自己的 `messageKey`
- `run_ack` 不再复用该 `messageKey`
- 如果需要保留“该事件对应哪条用户输入”的关联关系，应新增字段，例如：
  - `sourceMessageKey`
  - 或 `clientMessageKey`

已实施：

```ts
await this.eventWriter.appendRunEvent(run.id, sessionId, 'run_ack', {
  status: 'queued',
  content: 'managed run 已创建',
  sourceMessageKey: messageKey,
  messageKey: `managed:${run.id}:run_ack`,
});
```

要求：

- `run_ack.messageKey` 必须是事件自己的 key
- `sourceMessageKey` 只做关联，不参与 UI 主身份

### 6.2 前端修复

文件：

- `apps/web/client/src/hooks/useTaskCreationAgent.ts`

修复原则：

- `handleManagedRunStreamEvent(...)` 对 managed event 的 UI `messageKey` 不能盲信 `payload.messageKey`
- 对于 `run_ack`、`run_status`、`run_completed`、`run_failed`、`run_stopped`、`artifact_updated` 等系统事件，应统一生成事件级 key
- `payload.sourceMessageKey` 只放进 metadata，用于关联，不用于 UI 覆盖

已实施规则：

- `run_ack`:
  - `messageKey = managed:${runId}:run_ack`
- `run_status`:
  - `messageKey = managed:${runId}:run_status`
  - 如果需要多条状态并存，可带 sequence
- `tool_call_*`:
  - 保持 `toolCallId` 级 key
- `assistant_message` / `assistant_delta`:
  - 继续使用 assistant 自己的稳定 key
- `clarification_requested`:
  - 使用 `managed:${runId}:clarification`

### 6.3 前端合并规则不需要改成补丁式兼容

`mergeRealtimeMessage(...)` 当前“同 key 覆盖更新”的规则本身是合理的。

错误不在 merge 规则，而在上游给了错误的 key。

因此这里不建议再加“如果是 user_input 就不允许 status_update 覆盖”这种补丁逻辑。

正确做法是：

- 从源头保证事件 key 不碰撞

## 7. 已实施修改

本次已按根因方案完成以下修改：

1. 后端 `run_ack` payload 不再复用用户消息 `messageKey`
2. 后端新增 `sourceMessageKey` 作为事件到用户输入的关联字段
3. 前端新增 managed stream 专用 key 解析逻辑：
   - 系统事件强制使用事件级 key
   - tool event 继续按 `toolCallId` 聚合
   - assistant / clarification 继续保留各自稳定 key
4. 保留此前已存在的两类前端保护：
   - `bindSessionId` 的 URL/session race 防护
   - history/recent 覆盖本地 pending 消息的防护
5. 新增针对性测试，覆盖：
   - `run_ack` 与 `user_input` key 身份分离
   - optimistic `user_input` 不再被 `run_ack` 覆盖
   - tool event 仍然按 tool 维度合并
   - recent/history 为空时仍保留本地 pending `user_input`
   - history 确认同 key 后自动移除 pending 本地副本

## 8. 验收标准

修复后必须满足：

1. 新会话发送第一条消息后，用户气泡持续可见，不会在 `run_ack` 到来后消失。
2. 同一会话发送第二条、第三条消息后，用户气泡都持续可见。
3. 刷新前和刷新后，消息列表结构一致。
4. 附件用户消息的 chips 不会被实时状态事件替换掉。
5. managed replay、状态胶囊、tool 卡片仍然正常显示。

## 9. 验证结果

已完成的验证：

- `pnpm --filter api test -- tests/altus-managed-run-entry.service.test.ts tests/altus-managed-input-service.test.ts tests/altus-managed-setup-service.test.ts tests/altus-managed-prompt-service.test.ts`
- `pnpm --filter web exec vitest run client/src/tests/managed-message-stream-identity.test.ts client/src/tests/managed-history-pending-message.test.ts`
- `pnpm --filter web exec tsc --noEmit`

结果：

- 后端相关单测全部通过
- 前端新增 managed identity / history pending 单测通过
- 前端类型检查通过

## 10. 当前判断

当前问题已经定位到根因，且根因链路闭合：

- 发送
- 持久化
- 事件发布
- 实时消费
- UI 合并
- 刷新后恢复

本次修复已经围绕两条根链路落地：

1. 消息身份与事件身份分离
2. history/session 不得覆盖未确认的本地 optimistic 消息

后续如果再出现 managed 消息异常，优先检查：

- 新增 run event 是否错误复用了对话消息 `messageKey`
- 前端是否把系统事件重新回退到 `payload.messageKey`
- `loadHistory` / cached history 是否再次绕过 pending local merge
- URL/session 同步 effect 是否重新触发了不该发生的 `resetConversationState`
