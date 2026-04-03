# 16 管理后台复合存储 Skills 添加方案 [20260329-2248已采用]

更新时间：2026-03-29

## 1. 文档目的

本文定义管理员如何在 oneceo 管理后台中创建和维护复合存储 skill。

目标不是继续维护单个 `bodyMarkdown`，而是维护：

1. skill 基本信息
2. revision discovery 信息
3. activation entry
4. 资源索引
5. 资源存储方式
6. 数据库型资源正文
7. 存储桶型资源对象

## 2. 管理后台要解决什么问题

管理员侧要支持三件事：

1. 创建新的平台 skill
2. 为已有 skill 增加新 revision
3. 明确区分哪些资源进数据库，哪些资源进存储桶

## 3. 页面信息架构

`技能管理` section 拆成四个一级工作区：

1. 技能列表
2. 详情弹窗内的 Revision 编辑器
3. 详情弹窗内的资源存储面板
4. 导入预览/导入任务

其中：

1. 点击任意 skill 行，必须以弹窗方式打开详情
2. 详情弹窗内统一承载 revision 编辑、资源查看、渲染结果和 sandbox 验证
3. 导入预览/导入任务也必须采用弹窗方式承载，不在主编辑器内混排

## 4. Revision 编辑器结构

### 4.1 基本信息

字段：

1. `slug`
2. `name`
3. `category`
4. `status`
5. `discoveryDescription`
6. `activationSummary`

### 4.2 Activation Entry

字段：

1. `entryName`
2. `entryDescription`
3. `allowedTools`
4. `bodyMarkdown`

### 4.2.1 渐进式文档编辑器

管理后台的新建与编辑页必须与用户态自定义 skill 编辑器保持同类交互模型：

1. 左侧文档列表
2. 右侧当前文档编辑区
3. 支持同时维护多份 markdown 文档
4. 支持新增、切换、删除文档

这里的“同时编辑多个文件”指：

1. 一个 skill revision 可以维护多份渐进式 markdown 文档
2. 管理员可以在同一弹窗里快速切换多个文档并连续编辑
3. 保存时一次性提交整组数据库型 markdown 资源

第一阶段结构化编辑器只负责数据库型 markdown 文档：

1. `references/*.md`
2. `design/*.md`
3. `examples/*.md`
4. `templates/*.md`

脚本、办公模板、图片和其他存储桶资源继续通过导入或资源查看面板管理，不在该编辑器里直接编写。

### 4.3 资源索引

每个资源都必须展示：

1. `resourcePath`
2. `resourceKind`
3. `contentStorage`
4. `deliveryMode`
5. `mimeType`
6. `size`
7. `storagePath`

### 4.4 存储详情

如果资源为数据库型，显示：

1. `resourceBodyId`
2. `chunkCount`
3. `excerpt`

如果资源为存储桶型，显示：

1. `bucketName`
2. `objectKey`
3. `etag`
4. `sha256`

## 5. 管理态添加处理流程

### 5.1 结构化新建

流程：

1. 管理员点击“新建技能”
2. 填写 skill 基本信息
3. 填写 activation entry
4. 手动添加资源索引
5. 对每个资源选择：
   `database` 或 `object_storage`
6. 保存 draft revision
7. 预览
8. 发布

### 5.2 导入新 skill

流程：

1. 管理员选择文件夹
2. 后端分类资源
3. 生成导入预览
4. 页面明确展示：
   哪些进数据库
   哪些进存储桶
   哪些被忽略
5. 管理员确认导入
6. 生成新 skill + revision
7. 可选立即发布

### 5.3 导入为已有 skill 的新 revision

流程：

1. 管理员先选中已有 skill
2. 选择文件夹导入
3. 后端生成导入预览
4. 管理员确认“导入为新 revision”
5. 创建 draft revision 或直接 published revision

## 6. 文件分类规则

### 6.1 默认进数据库

1. `SKILL.md`
2. 说明类 markdown
3. 小型 text/reference 内容

### 6.2 默认进存储桶

1. `scripts/*.py/*.js/*.sh`
2. `.json/.yaml/.toml/.ini` 配置文件
3. `.docx/.pptx/.xlsx/.pdf` 模板与产物
4. 图片、字体、静态资产

### 6.3 默认忽略

1. `.DS_Store`
2. `node_modules/**`
3. `dist/**`
4. `__pycache__/**`
5. 构建产物和锁文件

## 7. 管理后台接口

### 7.1 apps/api

需要提供：

1. `POST /api/internal/skills/import/folder-preview`
2. `POST /api/internal/skills/import/folder`
3. `POST /api/internal/skills/:skillId/revisions/import/folder`
4. `GET /api/internal/skills/:skillId/revisions/:revisionId/resources`
5. `PUT /api/internal/skills/:skillId/revisions/:revisionId/resources/:resourcePath`

### 7.2 admin_management 代理

对应：

1. [skill-management-routes.ts](/Users/watson/codingProj/oneceo/apps/admin_management/server/routes/skill-management-routes.ts)
2. [skill-management-service.ts](/Users/watson/codingProj/oneceo/apps/admin_management/server/services/skill-management-service.ts)
3. [oneceo-api-connector.ts](/Users/watson/codingProj/oneceo/apps/admin_management/server/connectors/oneceo-api-connector.ts)

## 8. 前端展示要求

导入预览页必须让管理员看到：

1. `resourcePath`
2. `resourceKind`
3. `contentStorage`
4. `deliveryMode`
5. `storagePath`
6. `是否直接进 prompt`

如果这几项看不到，管理员就无法判断导入是否正确。

另外，导入弹窗必须满足：

1. 文件树逐项可见
2. 每个文件后面明确显示 `-> 数据库` 或 `-> 存储桶`
3. 每个文件有处理状态动画
4. 成功后节点变绿色

另外，skill 详情弹窗必须满足：

1. 能切换不同 revision
2. 能按树状或列表方式看到当前 revision 的全部资源
3. 每个资源都明确显示 `数据库` 或 `存储桶`
4. 数据库型资源要显示正文内容
5. 存储桶型资源至少要显示 `storagePath / storageLocator / mimeType`，对于文本型文件也应显示正文预览
6. 编辑页必须内置多文档渐进式编辑器，不再只支持单个 `bodyMarkdown`

## 9. 代码参照位置

主要改造点：

1. 管理后台前端
   [SkillManagementSection.tsx](/Users/watson/codingProj/oneceo/apps/admin_management/web/src/components/SkillManagementSection.tsx)
   [api.ts](/Users/watson/codingProj/oneceo/apps/admin_management/web/src/api.ts)
   [types.ts](/Users/watson/codingProj/oneceo/apps/admin_management/web/src/types.ts)

2. 管理后台 server
   [skill-management-routes.ts](/Users/watson/codingProj/oneceo/apps/admin_management/server/routes/skill-management-routes.ts)
   [skill-management-service.ts](/Users/watson/codingProj/oneceo/apps/admin_management/server/services/skill-management-service.ts)
   [oneceo-api-connector.ts](/Users/watson/codingProj/oneceo/apps/admin_management/server/connectors/oneceo-api-connector.ts)

3. apps/api
   [internal-skill-routes.ts](/Users/watson/codingProj/oneceo/apps/api/src/routes/internal-skill-routes.ts)
   [platform-skill-service.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/platform-skill-service.ts)
   [platform-skill-import-service.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/platform-skill-import-service.ts)

## 10. 结论

管理态添加流程的核心不是“多一个导入按钮”，而是：

1. 明确资源分类
2. 明确资源最终去哪
3. 明确 revision 如何形成
4. 明确发布前管理员能看清楚数据库和存储桶的落点
