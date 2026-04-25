# 04 第四阶段：动态能力上下文化 [尚未采用]

## 1. 阶段目标

第四阶段把 skills、MCP、memory、attachments 从零散 prompt 拼接升级为 typed context blocks。

目标：

1. 动态能力不污染 stable prompt；
2. 本轮工具执行可用和下一轮模型可见严格区分；
3. skills / MCP / memory / attachments reload 后不丢；
4. connector guide 以 delta 注入，而不是每轮全量塞入。

## 2. 实现范围

允许修改：

1. `SkillContextPass`
2. `McpContextPass`
3. `MemoryContextPass`
4. `AttachmentPass`
5. connector guide delta；
6. skill auto-attached delta；
7. manifest included context 字段；
8. 相关测试。

不允许修改：

1. OSAC MCP Runtime Host 边界；
2. skill sandbox sync 既有链路；
3. attachment object source of truth；
4. memory 覆盖当前 session 事实；
5. direct mode。

## 3. Skill Context

skill context block 必须保留：

1. `sourceType`
2. `skillId`
3. `revisionId`
4. `slug`
5. `name`
6. `activatedBy`
7. `activatedAt`
8. `toolName`
9. `sandboxMaterialized`
10. `contextVisibility`

规则：

1. selected skill 在 snapshot 中可见；
2. auto-attached skill 当前工具可用；
3. auto-attached skill 只在下一轮模型上下文以 delta 可见；
4. 不允许只保存 promptMarkdown；
5. 不允许丢失 custom skill 的 `skillId/revisionId`。

## 4. MCP Context

MCP context block 必须围绕 OSAC session tool handle：

1. `providerId`
2. `connectorKey`
3. `toolName`
4. `managedToolName`
5. `snapshotId`
6. `guideLoaded`
7. `guideRevisionId`
8. `runtimeStatus`

规则：

1. compiler 不直接连接远端 MCP；
2. runtime 不绕过 OSAC；
3. provider 丢失返回 tool_result；
4. connector guide 未加载返回 tool_result；
5. guide instructions 只做 delta，不每轮全量加入 stable prompt。

## 5. Attachment Context

attachment context block 必须保留：

1. `externalObjectKey`
2. `filename`
3. `mimeType`
4. `messageKey`
5. `createdAt`
6. `apiVisibility`
7. `contentRef`

规则：

1. object key 是事实源，不是 `[Attached: ...]` 文本；
2. image replay 必须能重新签名 URL；
3. 大附件可以以 ref 进入 API projection；
4. 不能把附件摘要当唯一事实。

## 6. Memory Context

memory context block 必须区分：

1. user memory；
2. project memory；
3. session memory；
4. Altus runtime memory；
5. skill memory。

规则：

1. memory 不能覆盖当前 session 显式事实；
2. memory 注入必须有 hash；
3. memory 变化需要 manifest 可解释；
4. sandbox flush 结果只在下一轮可见。

## 7. 验收条件

### 7.1 Skill 验收

1. slash-selected skill 进入 snapshot。
2. auto-attached skill 当前工具可用。
3. auto-attached skill 下一轮以 delta 进入 API projection。
4. sandbox 中能看到对应 `SKILL.md` 和 resources。
5. `sourceType/skillId/revisionId` 不丢。

### 7.2 MCP 验收

1. MCP provider snapshot 稳定。
2. OSAC provider 丢失时生成 tool_result。
3. guide 未加载时生成 `connector_guide_required`。
4. guide 加载后下一轮 delta 可见。
5. compiler 不直连 MCP。

### 7.3 Attachment 验收

1. image attachment reload 后仍进入模型上下文。
2. `externalObjectKey` 保留。
3. signed URL 可刷新。
4. 大附件以 ref 或 summary 进入 projection，不丢原始引用。

### 7.4 Memory 验收

1. session 显式事实优先于 memory。
2. memory block hash 稳定。
3. memory 变化能触发 manifest cacheBreakReason。
4. sandbox flush 后下一轮可见。

### 7.5 测试验收

至少新增：

1. selected skill snapshot 测试；
2. auto-attached skill delta 测试；
3. custom skill `skillId/revisionId` 保留测试；
4. MCP snapshot / guide delta 测试；
5. attachment replay 测试；
6. memory precedence 测试。

## 8. 退出条件

第四阶段完成后，必须证明：

1. 动态能力可恢复；
2. 动态能力不破坏 stable prompt；
3. manifest 能解释每个 included context；
4. reload 后 compiler projection 与运行时事实一致。
