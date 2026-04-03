# 12 Suna 思路的简单渐进式 Skills 方案 [20260329-1846已采用]

更新时间：2026-03-29

## 1. 文档目的

本文重新收敛 oneceo 的 skills 方向，只讨论一个更小、更容易落地的目标：

不做完整多文件保密体系，不做高敏感平台工具化大改造，先基于 `suna` 的思路完成“简单渐进式 skills”。

这里的“简单渐进式”只包含三件事：

1. 前台和后端先暴露 skill catalog metadata，而不是直接暴露 skill 全文
2. prompt 首轮只注入最小 skill index，不一次性塞入所有 skill 正文
3. 当某个 skill 真正被选中或命中时，再显式同步主入口和所需资源

## 2. 为什么这次先选 Suna 思路

这次不继续推进更大的保密方案，原因很明确：

1. 完整的 source package / runtime projection / tool-only 高敏感治理改动面太大
2. 需要同时改数据库、runtime、OSAC、管理后台、direct/managed 双链路
3. 首轮一次性成功率不高

而 `suna` 提供了一个更适合当前阶段借鉴的思路：

1. 目录元数据先 API 化
2. prompt 只带最小索引
3. 真要读细节时再显式同步

这条链比“直接全文进 prompt”强很多，也比“完整多文件安全体系”小很多。

## 3. 对 `suna` 的直接借鉴点

### 3.0 参照代码位置

后续开发时，必须优先对照以下 `suna` 代码，不要只看本文摘要：

1. 前端元数据拉取：
   [apps/frontend/src/hooks/tools/use-tools-metadata.ts](https://raw.githubusercontent.com/kortix-ai/suna/main/apps/frontend/src/hooks/tools/use-tools-metadata.ts)
2. 后端 tools 元数据接口：
   [backend/core/endpoints/tools_api.py](https://raw.githubusercontent.com/kortix-ai/suna/main/backend/core/endpoints/tools_api.py)
3. Prompt 最小索引与 guide 组装：
   [backend/core/agents/runner/prompt_manager.py](https://raw.githubusercontent.com/kortix-ai/suna/main/backend/core/agents/runner/prompt_manager.py)
4. 工具指南注册：
   [backend/core/tools/tool_guide_registry.py](https://raw.githubusercontent.com/kortix-ai/suna/main/backend/core/tools/tool_guide_registry.py)
5. 发现与缓存预热：
   [backend/core/utils/tool_discovery.py](https://raw.githubusercontent.com/kortix-ai/suna/main/backend/core/utils/tool_discovery.py)

oneceo 在开发过程中，至少要对照这五个位置确认：

1. 前端拿到的是否只是 metadata
2. 后端是否存在统一 catalog API
3. prompt 是否只放最小索引而不是全文
4. 是否存在按需补充 guide 的能力
5. discovery/cache 是否预热，而不是每次运行都临时拼装

### 3.1 元数据 API 化

`suna` 前端通过后端接口拉动态 tools metadata，替代静态配置。

参考：

1. [Suna frontend tools metadata hook](https://raw.githubusercontent.com/kortix-ai/suna/main/apps/frontend/src/hooks/tools/use-tools-metadata.ts)
2. [Suna tools API](https://raw.githubusercontent.com/kortix-ai/suna/main/backend/core/endpoints/tools_api.py)

开发时重点对照：

1. `use-tools-metadata.ts` 中前端只拉目录摘要并做缓存
2. `tools_api.py` 中后端统一输出 metadata 列表

可借鉴到 oneceo 的点：

1. skill 列表由 API 驱动，而不是前端硬编码
2. 前端缓存 catalog，不缓存正文
3. 业务前端、管理后台、运行时都读取同一套 skill metadata 来源

### 3.2 最小索引先进入 prompt

`suna` 的 PromptManager 不会把全部工具说明直接拼进去，而是先构造最小工具索引，再补充少量预加载 guide。

参考：

1. [Suna prompt manager](https://raw.githubusercontent.com/kortix-ai/suna/main/backend/core/agents/runner/prompt_manager.py)

开发时重点对照：

1. `PromptManager` 如何先构造 minimal tool index
2. 哪些 guide 会被预加载，哪些不会
3. prompt 组装顺序是否把“目录摘要”和“细节说明”拆开

可借鉴到 oneceo 的点：

1. 系统提示里先只放“当前可用 skill 摘要”
2. 只对少量核心 skill 预加载短 guide
3. 完整 skill 正文不进入首轮 prompt

### 3.3 需要时再同步全文

`suna` 的知识库不是一开始把全文塞进 prompt，而是：

1. 先给 summary
2. 真要看全文时，再通过 `global_kb_sync` 拉到 sandbox

这条链虽然用在知识库，不是 skills，但非常适合 oneceo 当前阶段借鉴。

开发时要额外核对：

1. `prompt_manager.py` 中知识库 summary 的进入时机
2. `tools_api.py` 中知识库/工具目录信息如何先被暴露
3. 运行时真正需要全文时，是否走了显式 sync，而不是首轮预加载

可借鉴到 oneceo 的点：

1. skill catalog 先给 summary
2. 真命中某个 skill 时，再同步 `SKILL.md`
3. 真需要某个 supporting resource 时，再同步该具体资源

## 4. 本方案的范围

### 4.1 这次要做

1. skill catalog metadata API 化
2. prompt 最小 skill index
3. skill 主入口按需同步
4. supporting resources 显式按单文件同步

### 4.2 这次不做

1. 完整 source package 与 runtime projection 双层治理
2. 高敏感资源 platform tool only
3. 复杂的 delivery mode / sensitivity / 审计系统
4. 大规模 schema 重构到 file tree revision

这四类内容已经暂存到单独分支，不在当前主线推进。

## 5. oneceo 的简单渐进式目标模型

### 5.1 catalog 层

平台维护 skill catalog，每个 skill 至少包含：

1. `skillId`
2. `revisionId`
3. `slug`
4. `name`
5. `description`
6. `category`
7. `revisionNumber`
8. `resourceSummary`

其中 `resourceSummary` 只表示“有哪些附加资源”，不返回正文。

### 5.2 minimal prompt index 层

在 managed/direct 两条链路里，系统提示不再直接放 skill 全文，而是先放一个小索引：

```text
Available skills:
- office-ppt: 创建、改写或重组可直接交付的专业演示文稿
  resources: 2 references, 1 template
- implementation-plan: 整理技术栈、模块划分和实施顺序
  resources: no extra resources
```

作用：

1. 模型知道有哪些 skill
2. 模型知道每个 skill 大概解决什么问题
3. 首轮上下文显著变小

### 5.3 activation 层

当满足以下任一条件时，触发 skill 主入口同步：

1. 用户显式选择某个 skill
2. 会话已绑定 skill 且当前轮仍要沿用

本阶段不做模型自动从 catalog 中自由命中 skill。

## 6. 数据模型最小改造

为了实现“简单渐进式”，不需要立刻全面升级到 file tree revision。

最小改造建议是：

### 6.1 保留现有表

继续使用：

1. `platform_skills`
2. `platform_skill_revisions`
3. `user_platform_skill_bindings`
4. `user_custom_skills`

### 6.2 增加轻量资源表

新增：

`platform_skill_revision_resources`

建议字段：

1. `id`
2. `revision_id`
3. `resource_path`
4. `resource_type`
5. `content_markdown`
6. `created_at`

第一阶段只支持文本资源，不支持二进制资产。

`resource_type` 先只允许：

1. `reference`
2. `template`

用户自定义 skill 第一阶段不支持 resources，只保留单正文。

## 7. sandbox 同步策略

### 7.1 首轮同步内容

当 skill 被选中后，先只同步：

1. `SKILL.md`

不立即同步 `reference/template`。

### 7.2 资源同步时机

新增一个明确的资源同步动作：

1. 当前 run 已激活 skill
2. agent 需要某个具体 resource
3. 后端根据 `skillId + revisionId + resource_path` 把该文件写入 sandbox

也就是说：

1. 不预加载全部 resources
2. 不把 resources 内联进 prompt
3. 按单文件同步

### 7.3 sandbox 目录

第一阶段继续沿用现有 skills 目录：

`~/.config/opencode/skills/<slug>/`

但目录中只会出现：

1. `SKILL.md`
2. 被显式同步过的资源文件

## 8. managed 模式方案

### 8.1 prompt 注入

managed 模式这次改成两段：

1. 系统提示注入 minimal skill index
2. 当用户实际选择 skill 时，再把该 skill 的 `SKILL.md` 注入 `managedSkillContext`

### 8.2 资源按需读取

managed 模式新增一个轻量工具：

1. `load_skill_resource`

参数：

1. `skillId`
2. `revisionId`
3. `resourcePath`

返回：

1. 已写入 sandbox 的相对路径

然后 Altus 再用已有 `read_file` 去读。

## 9. direct / OpenCode 模式方案

### 9.1 首轮 skill 同步

direct mode 在真正发消息前：

1. 如果用户选了 skill，就同步该 skill 的 `SKILL.md`
2. 如当前 skill 集合变化，则重启 `opencode serve`

### 9.2 资源按需同步

direct mode 不在首轮把 resources 全同步。

先提供一个简单桥接能力：

1. sandbox 内可调用 `oneceo_load_skill_resource`
2. 服务端接到请求后把指定资源写入当前 skill 目录

这样 direct 跟 managed 至少在行为上是一致的：

1. 首轮只拿入口
2. 需要时再拿资源

## 10. 管理后台要求

第一阶段管理后台不升级成复杂文件树编辑器。

只需要加两类轻量能力：

1. 对平台 skill 增加“附加资源列表”
2. 支持编辑少量 markdown resources

## 11. 前台要求

### 11.1 picker

picker 只显示 catalog metadata，不显示正文。

### 11.2 settings

用户设置页只显示：

1. skill 名称
2. 描述
3. revision
4. resourceSummary

不显示 resource 正文。

## 12. 实施顺序

按最短路径建议五步。

### 第 1 步：补 catalog 与 resource metadata

新增：

1. `platform_skill_revision_resources`
2. skill catalog 中的 `resourceSummary`

开发参照：

1. `suna` 的 [tools_api.py](https://raw.githubusercontent.com/kortix-ai/suna/main/backend/core/endpoints/tools_api.py)
2. `suna` 的 [tool_discovery.py](https://raw.githubusercontent.com/kortix-ai/suna/main/backend/core/utils/tool_discovery.py)

### 第 2 步：前台只消费 metadata

改造：

1. picker
2. settings
3. 前端 skill 缓存逻辑

开发参照：

1. `suna` 的 [use-tools-metadata.ts](https://raw.githubusercontent.com/kortix-ai/suna/main/apps/frontend/src/hooks/tools/use-tools-metadata.ts)

### 第 3 步：managed 最小 skill index

改造：

1. managed system prompt
2. `managedSkillContext`

开发参照：

1. `suna` 的 [prompt_manager.py](https://raw.githubusercontent.com/kortix-ai/suna/main/backend/core/agents/runner/prompt_manager.py)
2. `suna` 的 [tool_guide_registry.py](https://raw.githubusercontent.com/kortix-ai/suna/main/backend/core/tools/tool_guide_registry.py)

### 第 4 步：skill 主入口与资源按需同步

改造：

1. `sandbox-skill-sync-service`
2. `load_skill_resource`
3. direct mode 的 `oneceo_load_skill_resource`

开发参照：

1. `suna` 中“summary 先行、全文显式同步”的知识库思路，主要看 [prompt_manager.py](https://raw.githubusercontent.com/kortix-ai/suna/main/backend/core/agents/runner/prompt_manager.py)

### 第 5 步：管理后台资源编辑

改造：

1. 平台 skill 编辑页
2. resource 列表与 markdown 编辑器

开发参照：

1. `suna` 的 metadata-first 思路，而不是一次把全文下发到前台

## 13. 当前代码落点

为了避免后续开发只看方案不看代码，当前 oneceo 已经接入或需要继续扩展的代码位置明确如下：

### 13.1 catalog metadata 与资源摘要

1. 数据表定义：`apps/api/src/db/schema.ts`
2. 迁移入口：`apps/api/src/db/migrate.ts`
3. DAO：`apps/api/src/db/dao/platform-skill.dao.ts`
4. service 聚合与 `resourceSummary` 输出：`apps/api/src/services/platform-skill-service.ts`
5. 种子资源样例：`apps/api/src/services/platform-skill-seeds.ts`

### 13.2 用户态 settings / picker

1. 用户 skill 聚合：`apps/api/src/services/user-skill-service.ts`
2. 前台技能接口：`apps/api/src/routes/task-creation-routes.ts`
3. 前端类型：`apps/web/client/src/lib/task-creation-client.ts`
4. picker：`apps/web/client/src/components/AttachmentPickerButton.tsx`
5. settings 页：`apps/web/client/src/components/UserSkillSettingsPanel.tsx`
6. 草稿 skills 透传：`apps/web/client/src/lib/task-attachments.ts`

### 13.3 managed 最小索引与按需资源加载

1. 输入阶段注入 `managedSkillCatalog` / `managedSkillContext`：`apps/api/src/services/altus-managed-input-service.ts`
2. metadata 解析与 tool schema：`apps/api/src/services/altus-managed-shared.ts`
3. prompt 组装：`apps/api/src/services/altus-managed-prompt-service.ts`
4. run state：`apps/api/src/services/altus-run-state.ts`
5. run 入口：`apps/api/src/services/altus-managed-run-entry-service.ts`
6. coordinator：`apps/api/src/services/altus-run-coordinator.ts`
7. runtime tool 执行：`apps/api/src/services/altus-managed-tool-runtime.ts`
8. sandbox 单文件资源同步：`apps/api/src/services/sandbox-skill-sync-service.ts`

### 13.4 direct / OSAC 预留接点

1. OSAC service 预留 `loadSkillResource`：`apps/api/src/services/osac-agent-service.ts`
2. direct / OpenCode 真正的 agent 内调用桥接仍需继续接入 OSAC 消息协议，本阶段先不扩展到 sandbox 内部自动调用

## 14. 验证标准

至少验证以下场景：

1. skill catalog 不返回正文，只返回 metadata
2. managed/direct 首轮 prompt 不再包含所有 skill 全文
3. 用户选择 `office-ppt` 后，sandbox 中只先出现 `SKILL.md`
4. agent 请求 `references/layout-guide.md` 后，该文件才被写入 sandbox
5. 未请求的 resources 不会预先出现

## 15. 结论

基于 `suna` 思路的简单渐进式方案，核心不是“技能包大改造”，而是：

1. 目录摘要先行
2. prompt 最小索引
3. skill 主入口按需同步
4. supporting resource 单文件按需同步

这条路能显著改善当前 skills 全文注入问题，同时把改动面控制在当前阶段可接受的范围内。
