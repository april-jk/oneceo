# 18 前台用户复合存储 Skills 处理方案 [20260329-2248已采用]

更新时间：2026-03-29

## 1. 文档目的

本文定义用户前台在复合存储方案下的两条流程：

1. 用户态如何使用 skill
2. 用户态如何添加自定义 skill

与管理后台不同，用户态必须更保守。

本版新增一条硬约束：

**用户态不提供上传文件夹来添加 skill 的方式。**

用户态只允许通过平台内置编辑器创建纯数据库型 skill。

## 2. 用户态使用方式

### 2.1 设置页可管理两类来源

用户在设置页只应该管理：

1. 平台模板引用
2. 用户自定义 skill

### 2.2 attachment picker 只展示可用项

picker 只展示：

1. 已启用的平台模板
2. 已启用的用户自定义 skill

不会展示：

1. 平台全部 skill
2. 未启用的自定义 skill

### 2.3 用户态运行时使用顺序

用户发起 run 后，系统应：

1. 先注入 skill catalog
2. 再注入用户实际选择的 entry
3. 如需要资源，再按资源类型分流

对于平台 skill：

1. 数据库型资源可直接按需读取
2. 存储桶型资源按需下载到 sandbox

对于用户自定义 skill：

第一阶段建议只支持数据库型说明资源，不开放脚本执行型资源。

## 3. 用户态添加处理流程

### 3.1 用户态创建方式

允许：

1. 在平台编辑器内编写 skill
2. 维护 entry 正文
3. 维护渐进式说明文档
4. 保存为纯数据库型自定义 skill

不建议第一阶段开放：

1. 用户上传文件夹导入
2. 用户上传脚本并直接作为可执行 skill 资源
3. 用户上传复杂二进制模板并直接在 sandbox 自动执行

### 3.2 用户态编辑器设计

用户态编辑器不是后台的资源管理器简化版，而是一个专门服务“纯数据库型 skill”的文档编辑器。

页面布局建议：

1. 设置页内显示自定义 skill 列表
2. 列表标题右上角提供 `新增 skills` 按钮
3. 点击 `新增 skills` 或已有 skill 的 `编辑`，统一以弹窗打开编辑器
4. 弹窗内部再使用“左侧文档导航 + 中间编辑区”的结构
5. 编辑弹窗宽度必须与设置主弹窗保持一致，不单独收窄
6. 桌面端左右两栏必须分离显示，并各自独立上下滚动

#### 弹窗内左侧文档导航

固定包含：

1. `Skill 主说明`
2. `渐进式文档`

其中：

1. `Skill 主说明`
   对应 activation entry
2. `渐进式文档`
   是一组数据库型 markdown 文档

#### 弹窗内中间编辑区

编辑区分成两种模式：

1. `结构化表单模式`
2. `Markdown 正文模式`

结构化表单字段：

1. `slug`
2. `name`
3. `description`
4. `category`

Markdown 正文区域：

1. 主说明正文编辑器
2. 渐进式文档正文编辑器

当前实现阶段可不单独保留右侧预览区，但弹窗内必须至少显示：

1. 主说明编辑区
2. 渐进式文档列表
3. 当前文档编辑区

### 3.3 用户态编辑器功能

必须支持：

1. 新建自定义 skill
2. 编辑主说明正文
3. 新增多份渐进式 markdown 文档
4. 重命名渐进式文档
5. 删除渐进式文档
6. 调整文档顺序
7. 预览最终激活内容

必须不支持：

1. 添加脚本文件
2. 添加二进制文件
3. 添加配置文件
4. 添加资产文件
5. 添加存储桶型资源

### 3.4 用户态数据边界

用户态第一阶段只允许保存：

1. entry
2. 数据库型 markdown 资源

不允许保存：

1. `content_storage = object_storage`
2. `delivery_mode = sandbox_executable`
3. `delivery_mode = sandbox_asset`
4. `delivery_mode = sandbox_config`

## 4. 用户态 API 设计

建议改成纯编辑器型 API：

1. `POST /api/task-creation/settings/skills/custom`
2. `PUT /api/task-creation/settings/skills/custom/:customSkillId`
3. `GET /api/task-creation/settings/skills/custom/:customSkillId/documents`
4. `PUT /api/task-creation/settings/skills/custom/:customSkillId/documents`

文档保存结构建议为：

1. `entry`
2. `documents[]`

每个 document 至少包含：

1. `resourcePath`
2. `title`
3. `summary`
4. `bodyMarkdown`

## 5. 用户态 UI 要看到什么

编辑器右侧预览必须看见：

1. skill 名称
2. slug
3. entry 摘要
4. 数据库型渐进式文档列表
5. 最终会在 picker 中展示的摘要

## 6. 用户态使用的安全边界

当前阶段建议写死：

1. 用户自定义 skill 只支持数据库型 prompt 资源
2. 用户态没有文件夹导入入口
3. 用户不能上传脚本/二进制/配置/资产
4. 用户上传资产不自动 materialize

原因：

1. 平台 skill 和用户 skill 的信任模型不同
2. 用户脚本执行会直接引入额外安全边界
3. 用户文档编辑器已经足够支撑纯数据库型 skill

## 7. 代码参照位置

1. 前台设置页
   [UserSkillSettingsPanel.tsx](/Users/watson/codingProj/oneceo/apps/web/client/src/components/UserSkillSettingsPanel.tsx)

2. 前台 API
   [task-creation-client.ts](/Users/watson/codingProj/oneceo/apps/web/client/src/lib/task-creation-client.ts)

3. 用户态后端
   [task-creation-routes.ts](/Users/watson/codingProj/oneceo/apps/api/src/routes/task-creation-routes.ts)
   [user-skill-service.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/user-skill-service.ts)

4. 运行时入口
   [altus-managed-input-service.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/altus-managed-input-service.ts)
   [sandbox-skill-sync-service.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/sandbox-skill-sync-service.ts)

## 8. 结论

用户态处理流程要坚持：

1. 使用上，与平台 skill 尽量一致
2. 添加上，只允许平台内文档编辑器
3. 第一阶段不开放用户文件夹导入
4. 第一阶段不让用户脚本直接进入执行链路
