# 15 Altus 复合存储渐进式 Skills 使用方案 [20260329-2248已采用]

更新时间：2026-03-29

## 1. 文档目的

本文是 [19_复合存储渐进式Skills方案.md](./19_复合存储渐进式Skills方案.md) 的 Altus 运行时实施文档。

目标是定义 Altus 如何消费一套“数据库 + 存储桶”复合存储的 skill：

1. discovery 只看数据库摘要
2. activation 只看数据库 entry
3. prompt 资源按数据库按需读取
4. 非 prompt 资源按存储桶下载到 sandbox

## 2. Altus 只应该看见什么

### 2.1 catalog 阶段

Altus 只能看见：

1. `skillId`
2. `revisionId`
3. `slug`
4. `name`
5. `discoveryDescription`
6. `category`
7. `resourceCounts`
8. `promptResourceCounts`
9. `bucketResourceCounts`

这一阶段不能看见：

1. entry 正文
2. resource 正文
3. bucket object key

### 2.2 activation 阶段

Altus 只对当前已选中的 skill 看见：

1. `entryName`
2. `entryDescription`
3. `renderedEntryMarkdown`
4. `promptResourceHintSummary`

这一层等价于 `SKILL.md`。

### 2.3 resource discovery 阶段

Altus 调用资源发现工具时，只能获得：

1. `resourcePath`
2. `resourceKind`
3. `contentStorage`
4. `deliveryMode`
5. `summary`
6. `mimeType`
7. `size`

### 2.4 resource materialization 阶段

只有在 resource 被明确请求时，才允许：

1. 从数据库读取正文
2. 或从存储桶下载对象
3. 再写入 sandbox skill 目录

## 3. Altus 输入模型

### 3.1 managed metadata

建议 Altus metadata 固定为：

1. `managedSkillCatalog`
2. `managedSkillActivationContext`

### 3.2 managedSkillCatalog

每项字段：

1. `skillId`
2. `revisionId`
3. `slug`
4. `name`
5. `discoveryDescription`
6. `category`
7. `resourceSummary`
8. `storageSummary`

其中 `storageSummary` 需要区分：

1. `databaseResourceCount`
2. `objectStorageResourceCount`
3. `executableResourceCount`
4. `configResourceCount`
5. `assetResourceCount`

### 3.3 managedSkillActivationContext

每项字段：

1. `skillId`
2. `revisionId`
3. `slug`
4. `name`
5. `entryName`
6. `entryDescription`
7. `renderedEntryMarkdown`
8. `promptInlineResources`

`promptInlineResources` 只允许包含数据库型说明资源摘要，不允许直接包含脚本型资源正文。

## 4. Prompt 规则

### 4.1 system prompt 结构

Altus system prompt 固定分成：

1. `buildSystemPrompt`
2. `buildSkillCatalogPrompt`
3. `buildSkillActivationPrompt`

### 4.2 catalog prompt

只展示：

1. `slug`
2. `discoveryDescription`
3. `category`
4. `resourceSummary`

### 4.3 activation prompt

只对已选中 skill 注入 entry 正文。

### 4.4 不允许做的事

1. 不允许把 `scripts/*.py/*.js/*.sh` 直接注入 prompt
2. 不允许把 bucket 资源正文默认注入 prompt
3. 不允许把 object key 暴露给模型

## 5. Tool 设计

### 5.1 `discover_skill_resources`

参数：

1. `skillId`
2. `revisionId`
3. `resourceKind?`
4. `contentStorage?`

返回：

1. `resourcePath`
2. `resourceKind`
3. `contentStorage`
4. `deliveryMode`
5. `summary`
6. `mimeType`
7. `size`

### 5.2 `load_skill_resource`

参数：

1. `skillId`
2. `revisionId`
3. `resourcePath`

2026-05-03 补充：模型应优先传 Active skills 中的裸 `skillId` 与裸 `revisionId`。运行时允许兼容提示词上下文中出现的展示型标识，例如 `skill:platform:<skillId>`、`skill-catalog:platform:<skillId>:<revisionId>`，但兼容仅用于归一化 active skill 校验，不放宽“必须是当前会话已激活 skill”的约束。

运行规则：

1. 如果 `contentStorage = database`
   从数据库正文读取，再写 sandbox
2. 如果 `contentStorage = object_storage`
   从存储桶下载，再写 sandbox

返回：

1. `skillId`
2. `revisionId`
3. `resourcePath`
4. `skillResourcePath`
5. `resourceKind`
6. `contentStorage`

### 5.3 调用约束

Altus 必须遵循：

1. 只有当前已激活 skill 才能发现资源
2. 只有当前已激活 skill 才能加载资源
3. 不允许跨 skill 加载
4. 不允许直接请求 bucket key

## 6. Sandbox 投影规则

所有资源进入 sandbox 时仍然按 skill 逻辑路径恢复：

1. 系统级 platform skill 固定根目录：
   `~/.config/opencode/skills/platform/<slug>/`
2. 用户自定义 skill 固定根目录：
   `~/.config/opencode/skills/user/<user-id>/<slug>/`
3. 资源路径：
   `<skill-root>/<resource_path>`

也就是说，当前 oneceo 系统级 skills 默认不使用重定位。

有效落盘路径规则：

`effective_runtime_path = skill_root + resource_path`

设计这两个固定根目录的目的只有一个：

1. Altus 不需要在运行时临时猜 skill 存放在哪
2. 平台 skill 和用户 skill 的来源天然隔离
3. 任何 resourcePath 都能在固定根目录下精确恢复

## 7. 用户态使用方式

用户前台选择 skill 后，Altus 应分两步消费：

1. 会话创建/输入时写入：
   `managedSkillCatalog`
2. 实际选中的 skill 再写入：
   `managedSkillActivationContext`

运行时行为：

1. 用户选中平台 skill
   Altus 读取 platform revision 的 entry
2. 用户选中自定义 skill
   Altus 读取 user custom entry
3. 如需要 resource
   再用 `discover_skill_resources` / `load_skill_resource`

## 8. 代码参照位置

后续改造直接参照：

1. 输入聚合
   [altus-managed-input-service.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/altus-managed-input-service.ts)
   [user-skill-service.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/user-skill-service.ts)

2. schema/shared
   [altus-managed-shared.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/altus-managed-shared.ts)

3. prompt
   [altus-managed-prompt-service.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/altus-managed-prompt-service.ts)

4. tool runtime
   [altus-managed-tool-runtime.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/altus-managed-tool-runtime.ts)
   [sandbox-skill-sync-service.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/sandbox-skill-sync-service.ts)

5. skill 聚合
   [platform-skill-service.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/platform-skill-service.ts)

## 9. 验证标准

至少验证：

1. 未选 skill 时，Altus 只能看到 catalog
2. 已选 skill 时，只能看到 entry
3. 数据库型资源可按需直接 materialize
4. 存储桶型资源可按需下载再 materialize
5. sandbox 内资源路径与 `resource_path` 保持一致
6. Altus 不需要动态搜索 skill 根目录

## 10. 结论

Altus 对复合存储 skill 的正确使用顺序是：

1. 先读数据库摘要
2. 再读数据库 entry
3. 再按资源类型分流到数据库或存储桶
4. 最后统一按 `resource_path` 投影回 sandbox
