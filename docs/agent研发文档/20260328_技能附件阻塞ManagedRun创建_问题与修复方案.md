# 20260328 技能附件阻塞 Managed Run 创建问题与修复方案

## 1. 问题现象

用户在输入框中选择一个内置 skill 后，再发送消息，前端通常要等待约 30 到 60 秒才会出现“managed run 已创建”。

该现象在新会话或冷环境下尤为明显，会让用户误以为“发消息没有反应”。

## 2. 根因结论

根因不在 managed run 创建本身，而在 **skill 被当成普通附件上传**。

当前项目中的内置 skill 会先被前端生成为一个 `skill-*.md` 文件，再随消息一起走附件上传链路。附件上传接口在真正写入文件之前，会先执行 `ensureTaskSessionRuntime(sessionId)`，这一步会冷启动 sandbox/runtime。于是：

1. 用户点击发送
2. 前端先上传 `skill-*.md`
3. 上传接口先冷启动 runtime/sandbox
4. runtime 启动完成后，前端才真正开始 `sendChatInput`
5. 后端才创建 managed run
6. 前端这时才收到 `run_ack`，显示“managed run 已创建”

也就是说，用户看到的“managed run 已创建”被 runtime 冷启动整体向后推迟了。

## 3. 证据

### 3.1 代码链路

- skill 先被生成文件：`apps/web/client/src/components/AttachmentPickerButton.tsx`
- 发送消息前先上传附件：`apps/web/client/src/pages/Home.tsx`
- 初始会话链路同样先上传附件：`apps/web/client/src/components/TaskCreationChat.tsx`
- 上传附件前先起 runtime：`apps/api/src/routes/task-creation-routes.ts`
- runtime 冷启动会走 provision 链路：`apps/api/src/services/sandbox-agent-provision-service.ts`
- “managed run 已创建”来自 `run_ack`：`apps/api/src/services/altus-managed-run-entry-service.ts`

### 3.2 实测数据

- 新建 session：约 `0.36s`
- 第一次上传一个仅 `77 bytes` 的 skill markdown：约 `34.2s`
- 同一 session 第二次再上传 skill：约 `2.4s`
- 单独调用 `runtime/start`：约 `31.1s`
- 数据库中最近多条 run 的 `run -> run_ack` 延迟仅约 `0.3s ~ 0.7s`

结论：真正慢的是 skill 附件上传触发的 runtime 冷启动，而不是 managed run 创建。

## 4. 影响

- 用户点击发送后长时间看不到 run 创建反馈
- 误以为系统无响应
- 新会话首次使用 skill 的体验最差
- skill 本应服务外部 managed agent，却被错误地强绑定到了 sandbox 附件上传链路

## 5. 修复目标

最短正确路径是：

- **不要**在发送前把内置 skill 上传进 sandbox
- skill brief 直接内联到当前消息
- 只有真正的文件附件才继续走上传链路

这样可以保留 skill 约束，同时移除发送前的 runtime 冷启动阻塞。

## 6. 修复方案

### 6.1 skill 文件打标

在 `apps/web/client/src/lib/task-attachments.ts` 中新增 skill 附件元数据能力：

- `tagSkillAttachmentFile(...)`
- `attachmentKind`
- `inlineContent`
- `templateId`

内置 skill 被选择时，不再只是普通 `File`，而是会被标记为 `inline_skill`。

### 6.2 发送前拆分附件

在 `apps/web/client/src/lib/task-attachments.ts` 中新增：

- `partitionPendingAttachments(...)`

它会把当前待发送附件拆成两类：

- `uploadableAttachments`
  真实文件，仍需上传到 sandbox
- `inlinePromptAttachments`
  skill brief，不上传，直接拼进 prompt

### 6.3 skill 改为内联消息

在 `appendAttachmentsToPrompt(...)` 中新增 inline skill 段落：

- 将 skill 内容直接附加到当前消息
- 明确提示模型：这些 skill 已经直接附加到消息里，**不要再尝试从工作区或 `.attachments` 中读取**

### 6.4 两条发送链路一起收口

修改以下两个前端入口：

- `apps/web/client/src/pages/Home.tsx`
- `apps/web/client/src/components/TaskCreationChat.tsx`

新的规则是：

- 只有 `uploadableAttachments.length > 0` 时才 `ensureSession` 并上传附件
- skill-only 场景直接发送消息，不再触发 `/attachments`
- 普通文件附件行为保持不变

## 7. 修改位置

- `apps/web/client/src/lib/task-attachments.ts`
- `apps/web/client/src/components/AttachmentPickerButton.tsx`
- `apps/web/client/src/pages/Home.tsx`
- `apps/web/client/src/components/TaskCreationChat.tsx`

## 8. 验证结果

### 8.1 类型检查

- `pnpm --filter web check` 已通过

### 8.2 结构性验证

使用前端 helper 做最小化验证：

- skill-only：`uploadableCount = 0`，`inlineCount = 1`
- skill + 普通文件：skill 进入 inline，普通文件仍进入 uploadable

验证结果示例：

```json
{
  "skillOnly": {
    "uploadableCount": 0,
    "inlineCount": 1,
    "inlinePath": "inline-skill:office-ppt"
  },
  "mixed": {
    "uploadableCount": 1,
    "uploadableName": "notes.txt",
    "inlineCount": 1,
    "inlineName": "skill-office-ppt.md"
  }
}
```

这说明 skill-only 发送已经不会再进入附件上传链路，也就不会在发送前阻塞 managed run 创建。

## 9. 预期效果

修复后，skill-only 场景的用户体感将从“先等待 runtime 冷启动，再看到 run 创建”，变为“直接进入发送和 run 创建流程”。

由于 run 本身的 `run_ack` 延迟原本就只有亚秒级，理论上用户应当在数秒内看到“managed run 已创建”，而不再是接近 1 分钟。
