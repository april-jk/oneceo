# 17 管理后台复合存储 Skills 文件夹导入方案 [20260329-2248已采用]

更新时间：2026-03-29

## 1. 文档目的

本文定义管理后台如何支持“直接拖一个 skill 文件夹导入”，并将目录内容拆分成：

1. 数据库型资源
2. 存储桶型资源
3. 忽略资源

最终形成平台 skill revision。

## 2. 导入输入约定

推荐兼容的输入结构：

1. `SKILL.md`
2. `references/**`
3. `templates/**`
4. `examples/**`
5. `scripts/**`
6. `design/**`
7. `assets/**`
8. `configs/**`

至少必须存在：

1. `SKILL.md`

## 3. 导入总流程

导入流程固定为八步：

1. 浏览器读取目录树
2. 前端构建 `relativePath + content + size + mime` 列表
3. 上传到 preview 接口
4. 后端按类型分类
5. 生成导入预览
6. 管理员确认导入
7. 后端写数据库正文与上传桶对象
8. 生成 revision

## 4. 前端导入交互

### 4.1 入口

页面提供：

1. `选择文件夹导入`
2. `导入为新 skill`
3. `导入为当前 skill 新 revision`

### 4.2 预览必须展示

导入确认前必须弹出一个专门的导入处理弹窗，而不是直接在当前页面静态列出结果。

#### 弹窗结构

弹窗分成两栏：

1. 左侧：文件树
2. 右侧：处理摘要

#### 左侧文件树

树状列出所有待处理文件，按目录层级展开，例如：

1. `SKILL.md -> 数据库`
2. `README.md -> 数据库`
3. `design/design.md -> 数据库`
4. `scripts/render_body.py -> 存储桶`

每个节点后面必须明确显示：

1. `-> 数据库`
2. `-> 存储桶`
3. `-> 忽略`

#### 处理状态

每个文件节点还必须显示处理状态：

1. `待处理`
   使用圆圈转圈
2. `处理成功`
   变成绿色
3. `处理失败`
   变成红色并显示错误

#### 右侧处理摘要

显示：

1. 数据库资源数量
2. 存储桶资源数量
3. 忽略资源数量
4. warnings
5. 即将生成的 skill/revision 信息

## 5. 后端分类规则

### 5.1 数据库型

默认进入数据库：

1. `SKILL.md`
2. `README.md`
3. `design/*.md`
4. `references/*.md`
5. 小体积说明类文本

### 5.2 存储桶型

默认进入桶：

1. `scripts/*.py`
2. `scripts/*.js`
3. `scripts/*.sh`
4. `configs/*.json`
5. `configs/*.yaml`
6. `templates/*.docx`
7. `templates/*.pptx`
8. `templates/*.xlsx`
9. `assets/*`

### 5.3 忽略型

默认忽略：

1. `.DS_Store`
2. `.git/**`
3. `node_modules/**`
4. `dist/**`
5. `build/**`
6. `__pycache__/**`

## 6. 导入输出结构

一个导入完成后需要产出：

1. `platform_skill_revision_entries`
2. `platform_skill_revision_resource_indexes`
3. `platform_skill_revision_resource_bodies/chunks`
4. `platform_skill_revision_object_blobs`

对每个 resource index 必须保留：

1. `resource_path`
2. `storage_path`
3. `storage_locator_json`
4. `content_storage`
5. `delivery_mode`

## 7. draft / publish 规则

建议流程：

1. preview
2. import as draft
3. human review
4. publish

如果后面为了效率允许“导入即发布”，也必须以这条链路为基础，而不是跳过 preview。

## 8. `minimax-pdf` 示例

对于：

1. `SKILL.md`
2. `README.md`
3. `design/design.md`
4. `scripts/*.py/*.js/*.sh`

导入结果应该是：

1. `SKILL.md`
   数据库，activation entry
2. `README.md`
   数据库，reference
3. `design/design.md`
   数据库，reference
4. `scripts/*`
   存储桶，sandbox_executable

如果预览里只看见两个 markdown，就说明导入器仍然有缺陷。

## 9. 代码参照位置

1. 导入前端
   [SkillManagementSection.tsx](/Users/watson/codingProj/oneceo/apps/admin_management/web/src/components/SkillManagementSection.tsx)

2. 导入代理
   [api.ts](/Users/watson/codingProj/oneceo/apps/admin_management/web/src/api.ts)
   [skill-management-routes.ts](/Users/watson/codingProj/oneceo/apps/admin_management/server/routes/skill-management-routes.ts)

3. 平台导入核心
   [internal-skill-routes.ts](/Users/watson/codingProj/oneceo/apps/api/src/routes/internal-skill-routes.ts)
   [platform-skill-import-service.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/platform-skill-import-service.ts)
   [platform-skill-service.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/platform-skill-service.ts)

## 10. 结论

管理后台文件夹导入的本质不是“把目录塞进数据库”，而是：

1. 目录只是输入形式
2. 数据库负责 prompt 和索引
3. 存储桶负责运行型资源
4. 管理员必须在树状弹窗中看清楚每个文件的分流结果和处理状态
