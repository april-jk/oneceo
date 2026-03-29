# 14 数据库分层渐进式 Skills 方案 [尚未采用]

更新时间：2026-03-29

## 1. 文档目的

本文定义 oneceo 下一阶段的 skills 方案：

不再把 Claude Code 的 skills 多文件目录直接映射到 sandbox 文件系统结构，而是保留其“渐进式加载”思想，把 skill 的不同层次内容拆成数据库中的不同表，再由运行时按阶段读取和组装。

你提出的核心约束是：

1. 平台侧要支持 Claude Code 式渐进式加载
2. 技能内容主存储放数据库，不依赖真实目录作为源数据
3. 原本依赖目录层级区分的 skill 内容，改成通过数据表和关联关系区分

本文只给最终方案，不给兼容补丁方案。

## 2. 参照依据

本方案借鉴 Claude Code skills 的核心机制，但不照搬其文件系统存储方式。

Claude Code 官方说明的关键点是：

1. 每个 skill 有一个入口 `SKILL.md`
2. supporting files 与 `SKILL.md` 同目录
3. 模型先通过 `description` 发现 skill
4. supporting files 只在需要时再读取，也就是 progressive disclosure

参考：

1. [Claude Code skills docs](https://docs.claude.com/en/docs/claude-code/skills)
2. [Claude SDK skills docs](https://docs.claude.com/en/api/agent-sdk/skills)

其中最值得保留的不是目录本身，而是这条加载顺序：

1. discovery metadata
2. 激活时入口正文
3. 按需读取 supporting resources

## 3. 当前 oneceo 的问题

当前主线虽然已经做到了“简单渐进式”，但数据模型仍然偏平：

1. `platform_skills`
2. `platform_skill_revisions`
3. `platform_skill_revision_resources`

主要问题：

1. `body_markdown` 仍然承载完整入口正文，没有和“发现摘要”分层
2. `resources` 虽然独立成表，但资源索引和资源正文还在同一层
3. 还不能表达“资源很大，只先加载摘要，再加载正文块”
4. 还不能自然支持后续更复杂的 `examples / scripts / templates / references`

也就是说，当前模型只做到了：

1. 入口正文与资源分离
2. 资源按单文件加载

还没做到：

1. 数据层的真正渐进式分层
2. 不同阶段内容在存储层的明确边界

## 4. 目标模型

### 4.1 设计原则

新的数据库模型要满足：

1. discovery 阶段只读最小元数据
2. activation 阶段只读 skill 主入口正文
3. resource discovery 阶段只读资源索引
4. resource body 阶段才读资源正文
5. 所有层次都有 revision 归属
6. 最终仍然可以在 runtime 组装成 Claude Code 可理解的 skill 视图

### 4.2 目录到数据表的映射

如果按 Claude Code 的目录语义看：

1. `SKILL.md`
2. `references/*.md`
3. `templates/*.md`
4. `examples/*.md`
5. `scripts/*`

在 oneceo 里不再映射成真实源目录，而是映射成数据库表：

1. 入口定义表
2. 资源索引表
3. 资源正文表
4. 正文分块表
5. 资源关系表

## 5. 数据库分层方案

### 5.1 skill 主表

保留并扩展：

`platform_skills`

职责：

1. skill 恒定身份
2. slug / name / category / status
3. 当前 published revision 指针

这是“技能是什么”。

### 5.2 revision 主表

保留但收口语义：

`platform_skill_revisions`

职责：

1. revision 身份
2. slug/name/description/category 的 revision snapshot
3. discovery 用的短描述
4. revision 版本号和发布时间

这里不再承担完整入口正文，不再放完整 `body_markdown`。

建议新增/调整字段：

1. `discovery_description`
2. `activation_summary`
3. 删除或废弃 `body_markdown`

其中：

1. `discovery_description` 用于 catalog 列表
2. `activation_summary` 用于 skill 激活前的短说明

### 5.3 入口正文表

新增：

`platform_skill_revision_entries`

职责：

1. 存储等价于 `SKILL.md` 的主入口正文
2. 存储 frontmatter 等价信息
3. 只在 skill 被激活时读取

建议字段：

1. `id`
2. `revision_id`
3. `entry_name`
4. `entry_description`
5. `allowed_tools_json`
6. `body_markdown`
7. `render_version`
8. `created_at`

说明：

1. `entry_name + entry_description` 对应 `SKILL.md` frontmatter
2. `body_markdown` 是真正的激活态正文
3. runtime 激活时，由该表渲染出最终 `SKILL.md`

### 5.4 资源索引表

新增：

`platform_skill_revision_resource_indexes`

职责：

1. 存储资源目录索引
2. 只暴露资源摘要，不含正文
3. 用于 resource discovery 阶段

建议字段：

1. `id`
2. `revision_id`
3. `resource_key`
4. `resource_path`
5. `resource_kind`
6. `title`
7. `summary`
8. `load_stage`
9. `sort_order`
10. `created_at`

其中：

1. `resource_kind` 可先支持 `reference / template / example / script`
2. `load_stage` 用来标记它应该在哪一阶段可见

### 5.5 资源正文表

新增：

`platform_skill_revision_resource_bodies`

职责：

1. 存储资源正文头信息
2. 区分正文格式和装配方式
3. 只在 agent 明确请求该资源时读取

建议字段：

1. `id`
2. `resource_index_id`
3. `content_format`
4. `content_mode`
5. `full_text_hash`
6. `content_size`
7. `created_at`

说明：

1. `content_format` 先支持 `markdown / text / json`
2. `content_mode` 先支持 `inline / chunked`
3. 如果资源较小，可以 `inline`
4. 如果资源很大，则转成 chunked

### 5.6 正文分块表

新增：

`platform_skill_revision_resource_chunks`

职责：

1. 存储真正的大资源正文块
2. 支持渐进式读取
3. 支持未来做“先摘要，再正文段”的更细粒度加载

建议字段：

1. `id`
2. `resource_body_id`
3. `chunk_index`
4. `chunk_role`
5. `chunk_summary`
6. `content_text`
7. `token_estimate`
8. `created_at`

其中：

1. `chunk_role` 可先支持 `summary / body / appendix`
2. 小资源可以只有一个 `body` chunk
3. 大资源可以先读 `summary` chunk，再读某几个 `body` chunk

### 5.7 资源关系表

新增：

`platform_skill_revision_resource_links`

职责：

1. 表达资源之间的引用关系
2. 支持一个入口正文关联多个资源
3. 支持某个 resource 再指向其他 resource

建议字段：

1. `id`
2. `revision_id`
3. `from_type`
4. `from_id`
5. `to_resource_index_id`
6. `link_type`
7. `created_at`

`link_type` 可先支持：

1. `suggested`
2. `required`
3. `see_also`

## 6. 加载阶段设计

### 6.1 Stage 0: Discovery

读取：

1. `platform_skills`
2. `platform_skill_revisions`
3. `platform_skill_revision_resource_indexes` 的摘要字段

不读取：

1. 入口正文
2. 资源正文
3. chunk 内容

这一阶段只服务于：

1. 前台 picker
2. settings
3. managed/direct 的 minimal catalog prompt

### 6.2 Stage 1: Activation

当用户显式选择 skill 时，读取：

1. `platform_skill_revision_entries`

只把入口正文渲染成运行态 `SKILL.md`。

这一阶段仍然不读取资源正文。

### 6.3 Stage 2: Resource Discovery

当 skill 已激活，但 agent 需要更多细节时，先读取：

1. `platform_skill_revision_resource_indexes`
2. 可选的 `resource_links`

作用：

1. 告诉 agent 当前 skill 还有哪些 reference/template/example
2. 不把正文直接塞进 prompt

### 6.4 Stage 3: Resource Body Load

只有 agent 明确请求某个 resource 时，才读取：

1. `platform_skill_revision_resource_bodies`
2. `platform_skill_revision_resource_chunks`

然后：

1. 小资源直接组装为单文件
2. 大资源按 chunk 组装

## 7. 运行时组装策略

### 7.1 对 managed

managed 模式建议分三层注入：

1. `managedSkillCatalog`
2. `managedSkillContext`
3. `load_skill_resource`

分别对应：

1. discovery metadata
2. activation entry
3. resource body load

### 7.2 对 direct / OpenCode

direct 模式不直接暴露数据库给 sandbox。

而是：

1. 首轮只把 entry 渲染成 `SKILL.md`
2. resource 请求时，通过平台 API / OSAC bridge 获取
3. 再在 sandbox 内生成目标文件

### 7.3 对 sandbox 文件

即使底层源数据在数据库，runtime 仍然可以生成 Claude Code 风格视图：

1. `SKILL.md`
2. `references/...`
3. `templates/...`

但这些文件只是运行时投影，不是主存储。

## 8. 管理后台设计要求

后台不再是“编辑一个 bodyMarkdown + 可选 resources”。

而是分成四个编辑域：

1. revision discovery 信息
2. entry 正文
3. resource index
4. resource body / chunks

建议页面结构：

1. 基本信息
2. 激活入口
3. 资源目录
4. 资源正文
5. 关联关系

这样管理员编辑的是数据库结构，而不是伪目录。

## 9. 用户态与权限边界

用户态继续分成：

1. 引用平台模板
2. 自定义 skill

但用户自定义 skill 第一阶段不要直接套用全部复杂表。

建议分两步：

1. 平台 skill 先全面升级到分层模型
2. 用户自定义 skill 先只支持 entry 正文
3. 后续再决定是否给用户开放 resources/chunks

## 10. 迁移方案

### 10.1 从当前模型迁移

当前已有：

1. `platform_skill_revisions.body_markdown`
2. `platform_skill_revision_resources.content_markdown`

迁移方式建议是一次性迁移：

1. `body_markdown` -> `platform_skill_revision_entries.body_markdown`
2. `resources` 拆成：
   1. `resource_indexes`
   2. `resource_bodies`
   3. 默认单个 `body` chunk

迁移后：

1. `body_markdown` 标记废弃
2. `platform_skill_revision_resources` 标记废弃

### 10.2 不保留双轨

这次不能保留旧资源表和新分层表长期并存。

正确方式是：

1. 一次性迁移
2. DAO/service 改读新表
3. 旧表只保留过渡窗口
4. 最终删除旧表

## 11. oneceo 后续代码改造点

如果你认可这个方案，后续开发主要会落在这些文件：

1. 数据表与迁移：
   `apps/api/src/db/schema.ts`
   `apps/api/src/db/migrate.ts`
2. DAO：
   `apps/api/src/db/dao/platform-skill.dao.ts`
3. 平台 service：
   `apps/api/src/services/platform-skill-service.ts`
4. 用户态聚合：
   `apps/api/src/services/user-skill-service.ts`
5. sandbox 组装：
   `apps/api/src/services/sandbox-skill-sync-service.ts`
6. managed prompt/runtime：
   `apps/api/src/services/altus-managed-input-service.ts`
   `apps/api/src/services/altus-managed-prompt-service.ts`
   `apps/api/src/services/altus-managed-tool-runtime.ts`
7. 后台管理页：
   `apps/admin_management/...`

## 12. 实施顺序

建议按五步推进：

1. 先落新表和迁移脚本
2. 再把 DAO/service 切到新模型
3. 再接 managed runtime
4. 再接 direct / OSAC
5. 最后重做后台编辑器

## 13. 结论

如果你要“Claude Code 式渐进加载”，但又不想把 skills 的源数据真实放成目录，那么最合理的实现不是继续扩张当前 `body_markdown + resources` 两层模型，而是：

1. skill identity
2. revision discovery
3. activation entry
4. resource index
5. resource body
6. resource chunk
7. resource link

也就是把“目录层级”彻底翻译成“数据库层级”。

这样 oneceo 既能保留 Claude Code 的 progressive disclosure 思想，又能把技能主存储完全收口在平台数据库中。
