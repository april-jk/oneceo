# ClaudeCode 精髓融入 OneCEO 上下文管理分阶段实施索引 [20260426-1457已采用]

## 1. 文档定位

本目录把主方案拆成可逐步实现、逐步验收的阶段文档。

主方案：

- [20260426_ClaudeCode精髓融入OneCEO上下文与工具调用上下文管理方案_[20260426-1457已采用].md](../20260426_ClaudeCode精髓融入OneCEO上下文与工具调用上下文管理方案_[20260426-1457已采用].md)

拆分原则：

1. 每个阶段必须可以独立验收；
2. 每个阶段必须明确禁止越界事项；
3. 每个阶段必须保留 OneCEO 现有 DB / Redis / SSE / OSAC / managed-direct 边界；
4. 只有当前一阶段通过验收，才进入下一阶段；
5. 任何阶段都不能把临时 projection 误写成新的事实源。

## 2. 阶段文档

| 阶段 | 文档 | 核心目标 | 是否允许改线上行为 |
| --- | --- | --- | --- |
| 0 | [00_总体边界与验收总表_[20260426-1457已采用].md](./00_总体边界与验收总表_[20260426-1457已采用].md) | 统一边界、术语、阶段门槛 | 否 |
| 1 | [01_第一阶段_read_only_ledger_compiler_manifest_[20260426-0307已采用].md](./01_第一阶段_read_only_ledger_compiler_manifest_[20260426-0307已采用].md) | 只读 ledger adapter、compiler、manifest 诊断 | 是 |
| 2 | [02_第二阶段_ask_user_tool_pairing_[20260426-0311已采用].md](./02_第二阶段_ask_user_tool_pairing_[20260426-0311已采用].md) | 接管 ask_user / clarification pairing | 是，限 clarification |
| 3 | [03_第三阶段_tool_result_envelope_[20260426-0317已采用].md](./03_第三阶段_tool_result_envelope_[20260426-0317已采用].md) | 统一工具结果 envelope 和失败 tool_result | 是，限工具结果上下文 |
| 4 | [04_第四阶段_dynamic_context_blocks_[20260426-0321已采用].md](./04_第四阶段_dynamic_context_blocks_[20260426-0321已采用].md) | skills / MCP / memory / attachments typed context blocks | 是，限动态上下文 |
| 5 | [05_第五阶段_recovery_cache_observability_[20260426-0326已采用].md](./05_第五阶段_recovery_cache_observability_[20260426-0326已采用].md) | 恢复、缓存稳定、manifest 观测闭环 | 是，限恢复与观测 |
| 6 | [06_第二轮上下文行为验收测试计划_[20260426-0352已采用].md](./06_第二轮上下文行为验收测试计划_[20260426-0352已采用].md) | 行为回归、真实链路、debug 摘要、缓存稳定验收计划 | 否，测试计划 |

## 3. 全局执行顺序

```text
阶段 0：边界确认
  -> 阶段 1：read-only adapter + manifest 证据
  -> 阶段 2：ask_user / clarification pairing
  -> 阶段 3：tool result envelope
  -> 阶段 4：dynamic context blocks
  -> 阶段 5：recovery + cache observability
  -> 阶段 6：第二轮上下文行为验收测试计划
```

## 4. 全局硬边界

这些边界适用于所有阶段：

1. 不绕过 `AltusRunEventWriter.appendRunEvent(...)`；
2. 不让 Redis 成为事实源；
3. 不让 compiler 写状态；
4. 不让 LLM 直接改内部 lifecycle；
5. 不改变 direct mode；
6. 不改变既有 SSE 事件名，除非另有单独采用方案；
7. 不让 UI projection 反向成为模型上下文事实源；
8. 不允许 `messageKey`、`toolCallId`、`toolUseId` 在 reload 后漂移。

## 5. 阶段采用方式

当前目录按阶段逐步采用。后续按阶段实现时：

1. 用户确认某阶段进入开发后，只更新该阶段文档为 `[yyyymmdd-hhmm已采用]`；
2. 未进入开发的阶段继续保持 `[尚未采用]`；
3. 如果阶段方案调整，先改对应阶段文档，再写代码；
4. 每个阶段完成后必须把验收证据补回对应阶段文档或提交信息。

## 6. 当前采用状态

2026-04-26 已按阶段 1-6 完成主干实现与验收：

1. 阶段 1-5 已完成上下文 ledger、compiler、tool result、dynamic context、recovery/cache observability 的结构建设；
2. 阶段 6 已补充第二轮行为验收计划、长期能力题库和浏览器 UI e2e；
3. 真实链路验收以浏览器页面可见行为为准，`context-debug` 只作为失败诊断辅助；
4. 当前远程基线会话已证明：回答 `网页应用` 后不会重复追问交付形态，续聊 `按你的想法，先帮我做个方案` 会承接已有管理后台上下文；
5. Redis clear 后的真实恢复链路已验证，删除 session 相关 Redis key 后仍能从 DB-backed ledger 恢复等价 context；
6. attachment URL 重新签名已在真实 managed image object storage 链路验证，重新签名 URL 可正常下载对象。
