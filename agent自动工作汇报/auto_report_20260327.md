# 2026-03-27 自动工作汇报

- 做了什么：完成 managed 模式附件统一输入链路；重新拆解 managed 消息消失问题后，先修复了 `run_ack` 复用用户 `messageKey` 的协议冲突；随后继续排查，确认前端还存在 `bindSessionId` 误触发重置和 `loadHistory` 覆盖本地 pending 消息的问题；现已补上 session sync guard、本地 pending 消息保留与 history 合并逻辑，并新增前端单测。
- 做了什么：完成 managed 模式附件统一输入链路；重新拆解 managed 消息消失问题后，先修复了 `run_ack` 复用用户 `messageKey` 的协议冲突；随后继续排查，确认前端还存在 `bindSessionId` 误触发重置和 `loadHistory` 覆盖本地 pending 消息的问题；现已补上 session sync guard、本地 pending 消息保留与 history 合并逻辑，并新增前端单测；另外修复了已进入会话后附件按钮在澄清态不可用的问题，当前多轮对话和回答问题时都可继续添加附件。
- 做了什么：完成 managed 模式附件统一输入链路；重新拆解 managed 消息消失问题后，先修复了 `run_ack` 复用用户 `messageKey` 的协议冲突；随后继续排查，确认前端还存在 `bindSessionId` 误触发重置和 `loadHistory` 覆盖本地 pending 消息的问题；现已补上 session sync guard、本地 pending 消息保留与 history 合并逻辑，并新增前端单测；另外修复了已进入会话后附件按钮在澄清态不可用的问题，当前多轮对话和回答问题时都可继续添加附件；最新又调整了附件草稿清理时机，发送后输入区会立即清空附件，失败时再恢复。
- 遇到什么：这个问题不是单点故障，而是“事件 key 冲突”和“history/session 清屏”两层根因叠加；只修其中一层时，界面仍会表现为消息消失、只剩 processing 占位。
- 计划如何解决：下一步如果需要继续收口，就做一轮浏览器实机复测，重点确认首条消息、第二条消息、附件消息和刷新前后一致性。
