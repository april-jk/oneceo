# 19 复合存储渐进式 Skills 方案 [20260329-2248已采用]

更新时间：2026-03-29

## 1. 文档目的

本文在 [14_数据库分层渐进式Skills方案.md](./14_数据库分层渐进式Skills方案.md) 的基础上继续收敛 oneceo 的下一阶段 skill 存储方案。

新的目标不是“所有 skill 内容都进数据库”，而是：

1. 适合直接进入对话上下文的内容，存数据库
2. 不直接进入对话、而是运行时按需下载到 sandbox 的内容，存对象存储
3. 两类内容仍然共享同一个 revision、同一个导入流程、同一个管理后台

你这次提出的核心约束是：

1. `SKILL.md`、`design.md`、说明性 markdown 等，应该方便直接请求、直接拼接、直接进入 prompt
2. `scripts/*.py/*.js/*.sh` 这类运行型文件，不应该塞数据库正文
3. 配置型、资产型、模板型、代码型资源也不应该默认进 prompt
4. 这些非 prompt 资源应当进入存储桶，运行时需要时再下载并传给 sandbox

本文只给最终方案，不给兼容补丁方案。

## 2. 结论先行

对 oneceo 来说，最合理的方向不是“纯数据库”也不是“纯文件系统”，而是 **复合存储**：

1. `Discovery / Activation / Prompt Inline` 相关内容放数据库
2. `Executable / Config / Asset / Archive` 相关内容放对象存储
3. 数据库只保存这些桶对象的索引、摘要、哈希、下载信息和加载策略

一句话总结：

**数据库负责让模型看见它该先看见的内容，存储桶负责保管不该默认进入对话但又需要运行时使用的内容。**

## 3. 为什么纯数据库不合适

当前 `minimax-pdf` 这种 skill 已经说明问题：

```text
design/
  design.md
scripts/
  cover.py
  fill_write.py
  merge.py
  reformat_parse.py
  render_cover.js
  fill_inspect.py
  make.sh
  palette.py
  render_body.py
README.md
SKILL.md
```

这里至少有三类不同语义：

1. `SKILL.md` 和 `design/design.md`
   这些是解释性内容，适合模型先读，适合数据库存储
2. `scripts/*.py/*.js/*.sh`
   这些是执行性内容，不适合默认进 prompt，更适合存储桶
3. `README.md`
   这个要看用途。如果只是仓库说明，可以作为导入辅助文本；如果是 skill 的资源正文，也可以入数据库

如果把 `scripts/*.py/*.js/*.sh` 也全部塞数据库：

1. 导入 preview 会显得很重
2. prompt 误加载风险变高
3. revision 查询会带出很多无意义长文本
4. 后续真正下发到 sandbox 时还要再做一次“从数据库正文转文件”的额外成本

## 4. 设计原则

### 4.1 三条硬边界

1. 任何默认可能进入 prompt 的内容，必须可直接从数据库拿到
2. 任何默认不进入 prompt 的内容，必须默认不放在数据库正文里
3. 所有文件不论落数据库还是存储桶，都必须挂在同一个 revision 下统一管理

### 4.2 渐进式加载顺序

最终加载顺序改成五段：

1. `skill catalog`
   只读数据库摘要
2. `skill activation`
   只读数据库里的入口正文
3. `resource discovery`
   只读数据库里的资源索引和摘要
4. `resource materialization`
   对需要进入 sandbox 的资源，从存储桶下载
5. `resource execution/read`
   由 sandbox 内 agent 执行脚本、读取配置、使用模板或资产

## 5. 复合存储总模型

### 5.1 数据库存什么

数据库负责：

1. skill identity
2. revision identity
3. activation entry
4. prompt-inline resources
5. bucket object metadata
6. resource loading policy
7. resource summary / hash / mime / size / stage

也就是说，数据库中仍然有：

1. `platform_skills`
2. `platform_skill_revisions`
3. `platform_skill_revision_entries`
4. `platform_skill_revision_resource_indexes`
5. `platform_skill_revision_resource_bodies`
6. `platform_skill_revision_resource_chunks`
7. `platform_skill_revision_resource_links`

但对于不适合 prompt 的资源，`resource_bodies/chunks` 不再存完整正文，只存最小必要信息；完整内容进入存储桶。

### 5.2 存储桶存什么

对象存储负责：

1. 可执行脚本
2. 配置文件
3. 二进制模板
4. 图片/字体/媒体素材
5. 大型文本资源
6. 压缩包或目录打包产物

也就是说，bucket 是 **runtime materialization source**，不是 catalog source。

## 6. 文件类型分类方案

### 6.1 A 类：直接 prompt 资源，数据库存储

这些文件默认可以被模型直接读取、拼接、总结、纳入 skill 上下文。

建议落数据库正文：

1. `.md`
2. `.markdown`
3. `.txt`
4. `.rst`
5. `.adoc`
6. 小体积 `.csv`
7. 小体积 `.tsv`
8. 小体积 `.xml`
9. 小体积 `.html`
10. 小体积 `.sql`

适用条件：

1. 主要用途是“让模型理解说明”
2. 不需要直接执行
3. 适合做摘要 / chunk
4. 单文件内容适合被阅读

处理策略：

1. `content_storage = database`
2. `delivery_mode = prompt_inline` 或 `prompt_on_demand`
3. `resource_bodies/chunks` 保存完整内容

### 6.2 B 类：脚本执行资源，存储桶存储

这些文件主要用途不是让模型逐字读，而是让 sandbox 直接执行或让 agent 在文件层面操作。

建议落存储桶：

1. `.py`
2. `.js`
3. `.mjs`
4. `.cjs`
5. `.ts`
6. `.sh`
7. `.bash`
8. `.zsh`
9. `.ps1`
10. `.rb`
11. `.php`
12. `.lua`
13. `.r`

处理策略：

1. `content_storage = object_storage`
2. `delivery_mode = sandbox_executable`
3. 数据库只存摘要、hash、size、mime、bucket key、entrypoint 标记
4. Altus 或 sandbox tool 需要时才下载到临时目录

### 6.3 C 类：配置读取资源，存储桶优先

这些文件一般不适合直接进 prompt，但经常需要原样落盘给脚本或工具读取。

建议落存储桶：

1. `.json`
2. `.yaml`
3. `.yml`
4. `.toml`
5. `.ini`
6. `.cfg`
7. `.conf`
8. `.env`
9. `.properties`

处理策略：

1. 小配置允许在数据库保存摘要和可选 excerpt
2. 完整文件存储桶
3. `delivery_mode = sandbox_config`
4. 当某个脚本或模板依赖这些配置时，按 dependency 下载

### 6.4 D 类：模板与办公产物，存储桶优先

这些文件通常要给 sandbox 工具直接使用，或者作为二进制模板被复制/编辑。

建议落存储桶：

1. `.docx`
2. `.pptx`
3. `.xlsx`
4. `.pdf`
5. `.csv` 大文件
6. `.zip`
7. `.tar`
8. `.gz`
9. `.tgz`

处理策略：

1. `content_storage = object_storage`
2. `delivery_mode = sandbox_asset`
3. 数据库存摘要、mime、hash、页数/工作表数/模板类型等元信息
4. 运行时下载到 sandbox 后交给脚本或 office tool 使用

### 6.5 E 类：静态资产资源，存储桶存储

这些资源不会直接进 prompt，但常常是渲染、模板、封面、样式系统的一部分。

建议落存储桶：

1. `.png`
2. `.jpg`
3. `.jpeg`
4. `.webp`
5. `.gif`
6. `.svg`
7. `.ico`
8. `.ttf`
9. `.otf`
10. `.woff`
11. `.woff2`
12. `.css`

处理策略：

1. `content_storage = object_storage`
2. `delivery_mode = sandbox_asset`
3. 数据库存展示摘要与尺寸信息
4. 运行时按需下载

### 6.6 F 类：仓库噪音与产物，不导入

这些文件不应该进入 skill revision。

建议默认忽略：

1. `.DS_Store`
2. `Thumbs.db`
3. `.gitkeep`
4. `node_modules/**`
5. `.git/**`
6. `dist/**`
7. `build/**`
8. `.next/**`
9. `coverage/**`
10. `__pycache__/**`
11. `*.pyc`
12. `*.pyo`
13. `*.class`
14. `*.lock`

## 7. 建议新增字段

在 `platform_skill_revision_resource_indexes` 上增加：

1. `content_storage`
   可选：`database / object_storage`
2. `delivery_mode`
   可选：`prompt_inline / prompt_on_demand / sandbox_executable / sandbox_config / sandbox_asset / sandbox_archive`
3. `mime_type`
4. `file_extension`
5. `bucket_object_key`
6. `bucket_etag`
7. `is_executable`
8. `is_entrypoint`
9. `materialize_path`
10. `download_strategy`
11. `resource_path`
12. `storage_path`
13. `storage_locator_json`

解释：

1. `content_storage` 决定正文去哪
2. `delivery_mode` 决定运行时怎么下发
3. `materialize_path` 决定下载到 sandbox 的目标路径
4. `download_strategy` 决定是单文件下载、目录打包下载、还是依赖展开下载
5. `resource_path` 是 skill 内的逻辑文件路径
6. `storage_path` 是真实存储路径表达
7. `storage_locator_json` 是真实存储定位信息

## 8. 路径模型

这一版方案里，数据库中不能只存“文件内容”或“对象 key”，还必须显式存三种路径语义。

### 8.1 `resource_path`

这是 skill 内部的逻辑路径，也是资源在 skill 包中的标准路径。

示例：

1. `SKILL.md`
2. `design/design.md`
3. `scripts/render_body.py`
4. `templates/report.docx`

这个字段的职责是：

1. 管理后台展示资源位置
2. agent 请求某个资源时作为精确参数
3. skill 内部依赖关系引用目标
4. 作为唯一逻辑标识定位某个文件

结论：

**所有资源都必须有 `resource_path`。**

### 8.2 `storage_path`

这是资源的真实存储路径表达，用于快速判断它实际存在哪一类存储后端中。

示例：

1. 数据库存储：
   `db://platform_skill_revision_resource_bodies/<resource_body_id>`
2. 存储桶存储：
   `r2://oneceo-skill-assets/skills/<skill-id>/<revision-id>/scripts/render_body.py`

这个字段的职责是：

1. 后台快速查看真实落点
2. 调试时直接确认资源现在在哪
3. 让运行时不必再通过多层推断去猜测存储位置

结论：

**所有资源都必须有 `storage_path`，但它不是唯一结构化定位字段。**

### 8.3 `storage_locator_json`

这是结构化的真实存储定位信息，给代码直接使用。

数据库型资源示例：

```json
{
  "backend": "database",
  "resourceBodyId": "body_xxx"
}
```

存储桶型资源示例：

```json
{
  "backend": "object_storage",
  "bucket": "oneceo-skill-assets",
  "objectKey": "skills/skill-1/rev-2/scripts/render_body.py",
  "etag": "abc123"
}
```

这个字段的职责是：

1. 给后端服务直接定位真实内容
2. 给下载 / materialize / 读取操作提供结构化参数
3. 避免代码再去解析 `storage_path` 字符串

结论：

**`storage_path` 给人看，`storage_locator_json` 给程序用。**

### 8.4 `materialize_path`

这是资源进入 sandbox 后的目标路径。

大多数情况下默认等于 `resource_path`，但仍要单独存：

1. 有些对象在 skill 包里是逻辑路径，但下载后要落到特定 runtime 目录
2. 某些脚本可能需要落到可执行目录
3. 某些配置文件可能要落到工具约定路径

示例：

1. `resource_path = scripts/render_body.py`
2. `materialize_path = scripts/render_body.py`

或者：

1. `resource_path = configs/render.yaml`
2. `materialize_path = runtime/config/render.yaml`

结论：

**`materialize_path` 是 runtime 路径，不等同于真实存储路径。**

### 8.5 三种路径的关系

最终必须明确区分：

1. `resource_path`
   这是 skill 包内部文件路径
2. `storage_path`
   这是资源真实存放路径
3. `materialize_path`
   这是资源落到 sandbox 后的路径

例如：

1. `resource_path = scripts/render_body.py`
2. `storage_path = r2://oneceo-skill-assets/skills/skill-1/rev-2/scripts/render_body.py`
3. `materialize_path = scripts/render_body.py`

如果是数据库型 markdown：

1. `resource_path = design/design.md`
2. `storage_path = db://platform_skill_revision_resource_bodies/body_123`
3. `materialize_path = design/design.md`

### 8.6 固定 skill 根目录

为了避免 Altus 或 sandbox runtime 在使用 skill 时临时查找 skill 存放位置，系统级 skill 必须固定到稳定根目录。

建议固定规则：

1. 平台 skill 根目录：
   `~/.config/opencode/skills/platform/<slug>/`
2. 用户自定义 skill 根目录：
   `~/.config/opencode/skills/user/<user-id>/<slug>/`

因此完整落盘规则为：

1. `platform skill absolute path = ~/.config/opencode/skills/platform/<slug>/<resource_path>`
2. `user skill absolute path = ~/.config/opencode/skills/user/<user-id>/<slug>/<resource_path>`

这样做的好处：

1. skill 来源明确
2. 目录结构稳定
3. Altus 不需要动态搜索
4. 同名 slug 也能在平台/用户维度隔离

## 9. 建议新增对象存储表

新增：

`platform_skill_revision_object_blobs`

职责：

1. 记录 revision 下所有桶对象
2. 保存 bucket key、hash、size、mime、compression、storage class
3. 支持资源索引表引用

建议字段：

1. `id`
2. `revision_id`
3. `resource_index_id`
4. `bucket_name`
5. `object_key`
6. `mime_type`
7. `size_bytes`
8. `sha256`
9. `etag`
10. `compression`
11. `created_at`

说明：

1. 一条 `resource_index` 对应一个对象通常就够
2. 如果后续有大目录打包，可扩到多对象

## 10. 导入策略

### 9.1 文件夹导入阶段

导入器扫描目录后，先按文件类型分类：

1. `SKILL.md` 进入 entry
2. A 类文件进入数据库正文
3. B/C/D/E 类文件上传到存储桶
4. F 类文件忽略

### 9.2 导入结果

导入完成后，一个 revision 会同时产出：

1. 数据库 entry
2. 数据库 resource indexes
3. 部分数据库 resource bodies/chunks
4. 部分 object blob records

所以导入不是“二选一”，而是“一次导入，多处落点”。

## 11. 运行时加载策略

### 10.1 Altus

Altus managed 在首轮只拿：

1. skill catalog metadata
2. active skill 的 entry 正文
3. A 类资源摘要

当模型明确需要某个资源时：

1. 如果 `content_storage = database`
   直接读数据库正文
2. 如果 `content_storage = object_storage`
   先从桶下载，再写入 sandbox，再告知模型路径

### 10.2 Sandbox

sandbox 不应该在 run 启动时全量 materialize。

正确顺序：

1. run 启动时只写 `SKILL.md`
2. 模型要求资源时，根据 `delivery_mode` materialize
3. 脚本依赖的 config/template/asset 由 broker 按依赖拉取

### 10.3 OpenCode / OSAC

direct 模式不应绕业务路由直连 bucket。

应走：

1. OSAC 请求资源
2. API 校验当前 skill/revision/resource 权限
3. API 生成短时下载或直接代理流
4. sandbox 侧 materialize 到目标路径

## 12. `minimax-pdf` 示例映射

对于你给的 `minimax-pdf`：

1. `SKILL.md`
   数据库存储，activation entry
2. `design/design.md`
   数据库存储，prompt_on_demand resource
3. `README.md`
   默认作为 reference，数据库存储
4. `scripts/cover.py`
5. `scripts/fill_write.py`
6. `scripts/merge.py`
7. `scripts/reformat_parse.py`
8. `scripts/render_cover.js`
9. `scripts/fill_inspect.py`
10. `scripts/make.sh`
11. `scripts/palette.py`
12. `scripts/render_body.py`

这些脚本都应：

1. 上传到存储桶
2. 在资源索引中标记 `content_storage = object_storage`
3. 标记 `delivery_mode = sandbox_executable`
4. 根据 `materialize_path` 下载到 sandbox skill 目录下

## 13. 管理后台处理方式

管理后台在列表和详情里要区分两种资源：

1. 数据库正文资源
2. 存储桶对象资源

页面上至少要看见：

1. `resource_kind`
2. `content_storage`
3. `delivery_mode`
4. `mime_type`
5. `size`
6. `bucket key` 或 `db body/chunks`

导入预览页也必须明确展示：

1. 哪些文件将进入数据库
2. 哪些文件将进入存储桶
3. 哪些文件被忽略

## 14. 前台用户导入处理方式

用户态导入建议先做简化：

1. `SKILL.md` 和 markdown 说明类内容允许创建自定义 skill
2. `scripts / config / asset` 默认只做预览，不直接开放执行

原因：

1. 用户自定义 skill 若允许随意上传脚本并在 sandbox 执行，安全边界更复杂
2. 平台 skill 和用户 skill 的信任级别不一致

所以第一版建议：

1. 平台管理端支持完整复合存储
2. 用户态先只支持数据库型 skill
3. 以后若要放开用户脚本，再单独做安全设计

## 15. 代码参照位置

当前 oneceo 里后续改造时最需要对照的位置：

1. 数据层
   [schema.ts](/Users/watson/codingProj/oneceo/apps/api/src/db/schema.ts)
   [migrate.ts](/Users/watson/codingProj/oneceo/apps/api/src/db/migrate.ts)
   [platform-skill.dao.ts](/Users/watson/codingProj/oneceo/apps/api/src/db/dao/platform-skill.dao.ts)

2. 平台 skill 聚合与导入
   [platform-skill-service.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/platform-skill-service.ts)
   [platform-skill-import-service.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/platform-skill-import-service.ts)

3. Altus / sandbox 资源链路
   [altus-managed-input-service.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/altus-managed-input-service.ts)
   [altus-managed-shared.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/altus-managed-shared.ts)
   [altus-managed-tool-runtime.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/altus-managed-tool-runtime.ts)
   [sandbox-skill-sync-service.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/sandbox-skill-sync-service.ts)
   [osac-agent-service.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/osac-agent-service.ts)

4. 管理后台
   [internal-skill-routes.ts](/Users/watson/codingProj/oneceo/apps/api/src/routes/internal-skill-routes.ts)
   [skill-management-routes.ts](/Users/watson/codingProj/oneceo/apps/admin_management/server/routes/skill-management-routes.ts)
   [oneceo-api-connector.ts](/Users/watson/codingProj/oneceo/apps/admin_management/server/connectors/oneceo-api-connector.ts)
   [SkillManagementSection.tsx](/Users/watson/codingProj/oneceo/apps/admin_management/web/src/components/SkillManagementSection.tsx)

5. 用户前台
   [task-creation-routes.ts](/Users/watson/codingProj/oneceo/apps/api/src/routes/task-creation-routes.ts)
   [user-skill-service.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/user-skill-service.ts)
   [task-creation-client.ts](/Users/watson/codingProj/oneceo/apps/web/client/src/lib/task-creation-client.ts)
   [UserSkillSettingsPanel.tsx](/Users/watson/codingProj/oneceo/apps/web/client/src/components/UserSkillSettingsPanel.tsx)

## 16. 我建议的采用方式

如果你接受这版方案，后续实施顺序应该是：

1. 扩展 `resource_indexes` 增加 `content_storage / delivery_mode / bucket_object_key / materialize_path`
2. 增加 `object_blobs` 表
3. 改造导入器：A 类进数据库，B/C/D/E 类进桶
4. 改造后台预览：明确显示数据库资源和桶资源
5. 改造 Altus / sandbox broker：按 `content_storage` 分流
6. 用户态先只保留数据库型自定义 skill，不立刻开放脚本型导入执行

这条路线最符合 oneceo 当前的工程约束，也最符合你现在强调的两件事：

1. 说明类内容要快读快拼接
2. 运行类内容不要默认进入对话
