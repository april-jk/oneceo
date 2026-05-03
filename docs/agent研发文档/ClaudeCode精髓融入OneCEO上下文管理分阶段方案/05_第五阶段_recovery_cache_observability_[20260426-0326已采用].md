# 05 第五阶段：恢复、缓存稳定与可观测闭环 [20260426-0326已采用]

## 1. 阶段目标

第五阶段把前四阶段形成的 ledger、snapshot、compiler、tool_result、dynamic context block 接入恢复和缓存观测闭环。

目标：

1. resume / retry / history reload 与主路径等价；
2. Redis 丢失后可从 DB-backed facts 重建；
3. cache miss 能定位到具体 pass；
4. budget replacement 不改写历史；
5. 长对话压缩后不重复旧 clarification。

## 2. 实现范围

允许修改：

1. context recovery service；
2. manifest round-trip check；
3. cache observer；
4. budget replacement freeze/apply 流程；
5. history replay 同源化；
6. retry / failed run recovery 诊断；
7. 相关测试和 E2E。

不允许修改：

1. Redis 成为事实源；
2. budget pass 改写 DB timeline；
3. history replay 独立拼上下文；
4. direct mode；
5. OSAC/connector/deployment 硬边界。

## 3. Recovery 规则

恢复必须从 DB-backed facts 重新编译：

```text
DB facts
  -> ledger view
  -> reconciliation
  -> snapshot
  -> compiler
  -> manifest
  -> API projection / UI projection
```

不允许：

1. 从 Redis 反向恢复事实；
2. 从 UI message text 猜测 tool_result；
3. 从 prompt cache 还原状态；
4. 从 partial SSE stream 生成 canonical facts。

## 4. Cache Observer

cache observer 必须记录：

1. `stableSystemHash`
2. `toolSchemaHash`
3. `mcpSnapshotHash`
4. `skillSnapshotHash`
5. `memorySnapshotHash`
6. `attachmentContextHash`
7. `volatileContextHash`
8. `apiMessageHash`
9. `cacheBreakReason`

cache miss 必须能定位到：

1. system prompt 变化；
2. tool schema 变化；
3. MCP delta；
4. skill delta；
5. memory 变化；
6. attachment 变化；
7. budget replacement 变化；
8. unresolved tool pairing。

## 5. Budget Replacement

budget replacement 必须遵守：

1. replacement 决策在 turn snapshot 前冻结；
2. compiler 只应用 replacement，不创建新决策；
3. 原始 tool result 保留在 DB；
4. UI / history 不被 replacement 改写；
5. manifest 记录 replacement summary；
6. retry 时 replacement 可重建。

## 6. Round-trip Check

每次恢复或 retry 后，必须能比较：

1. recovery 前 manifest；
2. recovery 后 manifest；
3. ledger cursor；
4. tool pairing summary；
5. included context；
6. hash 差异。

差异必须分为：

1. expected volatile change；
2. expected dynamic context change；
3. unexpected fact drift；
4. missing fact；
5. projection bug。

## 7. 验收条件

### 7.1 Recovery 验收

1. Redis 清空后，同一 session 可从 DB 重建 manifest。
2. history reload 后不重复旧 ask_user。
3. failed run retry 后不丢用户回答。
4. OSAC / MCP recovery 后 provider snapshot 可解释。
5. attachment URL 过期后可重新签名。

### 7.2 Cache 验收

1. 同一输入多次 manifest stable hash 一致。
2. skill 变化只影响 skill hash / volatile hash。
3. MCP guide 新加载只影响 MCP / connector delta。
4. memory 更新能产生明确 cacheBreakReason。
5. 大工具结果 replacement 不改变原始 result hash。

### 7.3 Budget 验收

1. 大 tool result 被替换后，模型仍能获得摘要和引用。
2. 原始结果仍可在 history/debug 中查到。
3. retry 后 replacement 决策一致或差异可解释。
4. replacement 不影响 UI timeline。

### 7.4 E2E 验收

至少覆盖：

1. clarification -> reload -> answer -> continue；
2. tool failure -> retry -> continue；
3. MCP guide blocked -> load guide -> call MCP；
4. auto skill attach -> reload -> next turn sees delta；
5. image attachment -> reload -> model sees image；
6. Redis clear -> recovery -> manifest equivalent。

## 8. 退出条件

第五阶段完成后，必须具备：

1. 可复用的 context debug endpoint；
2. manifest diff 工具；
3. cache miss 诊断输出；
4. recovery round-trip 测试；
5. 真实 managed run 回归记录；
6. 文档化的运行手册。

到这里，OneCEO managed context 才算从“临时 prompt 拼接”升级为“可恢复、可验证、可缓存的上下文系统”。

## 9. 当前落实记录

2026-04-26 已完成的代码落点：

1. 新增 DB-backed recovery report，明确 messages / run events / dynamic context 的事实来源，并声明 Redis、UI projection、prompt cache、partial SSE 都不是事实源；
2. 新增 cache observer，输出 stable system、tool schema、MCP、skill、memory、attachment、volatile、API message、budget replacement、unresolved pairing 等 hash 与 cacheBreakReason；
3. 新增 manifest round-trip diff，按 expected volatile、expected dynamic context、unexpected fact drift、missing fact、projection bug 分类；
4. budget projection 增加 replacement summary，保留原始 tool result，不改写 history / UI timeline；
5. `context-debug` 返回 recovery、cacheObservation、roundTrip、budgetProjection，供 reload / retry / Redis clear 后诊断。
6. 补充 `context-debug` 路由级测试，确认 Express API 实际返回 DB-backed recovery、cache hash、roundTrip、budgetProjection，并包含 attachment / MCP includedContext。

已执行验证：

1. `pnpm --filter api exec tsx --test tests/altus-managed-context-stage5.test.ts tests/altus-managed-context-budget-service.test.ts tests/altus-managed-context-stage1.test.ts`
2. `pnpm --filter api type-check`
3. `pnpm --filter api exec tsx --test tests/altus-managed-routes.test.ts tests/altus-managed-context-stage5.test.ts`

后续阶段 6 已补充：

1. `ALTUS-CONTEXT-001/002` 的真实浏览器 UI 链路回归；
2. `context-debug` 摘要视图，用于失败后定位 facts source、clarification、round trip 和 cache observation；
3. 长期能力题库种子和远程浏览器 e2e 脚本。

2026-04-26 已补充剩余验收：

1. Redis clear 后的真实恢复链路已验证：
   - sessionId: `79b9b10f-f8be-439c-a567-6cf8e91edb4b`
   - 删除前扫描到 7 个该 session 相关 Redis key，包括 run state、stream、recovery；
   - 删除后同一 session 相关 Redis key 数量为 0；
   - 再次访问 `context-debug` 后，`contextHash` 与删除前一致；
   - `roundTrip.equivalent = true`；
   - `recovery.mode = db_backed_read_only`；
   - `factsSource.redis = not_fact_source`；
   - `recoveryState = recoverable`。
2. attachment URL 重新签名已在真实 managed image object storage 链路验证：
   - 上传测试图片对象到 `managed-images/.../context-validation.png`；
   - 第一次签名 URL 下载返回 `200`，`content-type = image/png`，字节数与原始对象一致；
   - 间隔后第二次重新签名，`X-Amz-Date` 变化，URL 变化；
   - 第二次签名 URL 下载仍返回 `200`，字节数与原始对象一致；
   - 测试对象已从 bucket 删除。
3. memory context 的恢复诊断链路已补齐：
   - `context-debug` 不再只包含 attachment / MCP blocks；
   - user memory、project memory、session memory、runtime memory prompt 会以 `memory:*` blocks 进入 recovery manifest；
   - `cacheObservation.memorySnapshotHash` 由 manifest 内的 memory blocks 计算；
   - Redis 仍标记为 `not_fact_source`，memory 事实来源仍为 DB-backed profile / project / session metadata。

至此，第五阶段文档中保留的 recovery/cache/attachment 真实链路验收项已完成。
