# 2026-05-01 工作汇报

## 做了什么

- 调整了部署页面中"数据库"和"存储桶"两个子页的排版结构。
- 数据库页改成"顶部资源总览卡 + 下方三列工作区"，未启用态补了占位信息块。
- 存储桶页去掉了原先失衡的左右分栏，改成"顶部资源总览卡 + 下方双列工作区"。
- 数据库页的连接信息从右侧面板改成弹窗显示，且默认掩码隐藏，用户需要主动点击眼睛图标才会显示明文。
- 数据库连接弹窗继续参照目标样式收紧：改成单列逐行字段、单大容器、仅敏感字段受眼睛按钮控制，并移除了状态块和顶部工具说明。
- 数据库已启用主页面继续改成数据库工作台结构，去掉顶部摘要卡，直接进入左侧表列表、中间数据表、右侧记录编辑三栏布局。
- 数据库记录详情默认改为隐藏，仅在点击具体记录后展开；点击数据表空白区域后会再次收起。
- "新增记录"模式也接入同一套空白区域收起逻辑，避免右侧编辑栏在新建状态下常驻占位。
- 左侧表列表移除了"应用数据库"来源标签，释放名称宽度；hover 表名时可查看完整名称。
- 数据库表格顶部"列 N"按钮已接入浮层，可切换当前表的可见列。
- 存储桶页面已参照数据库页收口为工作台式布局，移除了原先堆叠的说明卡和无用提示文本。
- 存储桶状态接口已补充文件列表，当前页面可以直接查看 bucket 中的对象名称、大小和更新时间。
- 存储桶的 Access Key / Secret 已从主页面移出，改为"管理存储桶"弹窗集中展示，默认掩码隐藏。
- 存储桶页在刷新按钮左侧新增了"上传"按钮，支持向当前 bucket 上传单个文件，上传成功后会直接刷新列表。
- 存储桶页点击文件后会在列表下方展开文件信息和管理区，当前已接入删除文件；点击外部空白区域会收起该预览区。
- 存储桶页文件信息区已补充下载文件按钮，当前支持关闭、下载、删除三类动作。
- 部署设置页去掉了左右两列容器各自的标题栏，减少重复标题造成的视觉噪音。
- 部署设置页进一步改成左侧锚点导航、右侧长页内容，点击左侧分区会直接定位到右侧对应内容块。
- 部署设置页继续收口成左侧 sticky 导航 + 右侧锚点卡片，左侧激活态会跟随右侧滚动位置同步，分区定位更明显。
- 部署设置页继续去掉厚重容器底色，导航和内容块改成透明底，避免卡片继续嵌套卡片。
- 设置页左侧导航进一步收窄，并移除了顶部"Settings"字样，把宽度优先让给右侧内容区。
- 设置页锚点滚动增加了顶部安全偏移，并统一了激活分区判断的 offset，避免目标标题被上方固定区域遮挡。
- 用真实页面截图复验后，继续把设置页锚点偏移抬高，解决"域名"等中部区块标题仍被顶部固定区域压住的问题。
- 存储桶上传链路已从 OneCEO API 中转改成"后端签短时 presigned POST、浏览器直传当前 Railway Bucket"，保留原始文件名；当前不再展示真实上传进度，而是在上传后回到平台状态接口确认文件是否已出现。
- 同步更新了资源页设计文档，补充新的页面层级和布局约束。

## 遇到什么

- 本地 `apps/web` 开发服务默认端口冲突，改为 `3001` 后才能启动。
- 从会话历史页不能直接看到数据库 / 存储桶真实面板，当前浏览器验收入口需要补更直接的页面路径。

## 计划如何解决

- 继续补真实页面入口验证，直接对数据库页和存储桶页做浏览器截图检查。
- 如果真实渲染仍有信息密度或对齐问题，再做一轮收紧。

## Env 简化

- 做了什么：精简 `apps/.env.example` 的连接器配置，只保留 `CONNECTOR_SECRET_KEY` 与 `COMPOSIO_API_KEY` 作为 Composio MCP broker 模式的示例必需项，移除 connector 专属 secret 覆盖项和 Composio toolkit/allowed tools 高级覆盖项。
- 遇到什么：`apps/.env.example` 仍有部分历史中文注释编码显示异常；本次只处理连接器配置项，不扩大范围重写整份 env 示例。
- 计划如何解决：已用搜索确认示例文件中 Composio 只剩 `COMPOSIO_API_KEY`，后续如需要可单独做 env 注释编码清理。

## MCP Composio 清理

- 做了什么：清理 GitHub/Notion/Slack/Supabase/Figma Composio MCP 改造后的旧 direct MCP/OAuth 残留，移除 `.env.example` 中旧 remote/token 配置示例，阻断 GitHub 旧 token 仓库直连路径，并删除 sandbox bootstrap 中历史 GitHub local token 环境变量投影。
- 遇到什么：`github-connector-repository-service.ts` 里旧中文字符串较多，补丁大段匹配不稳定；已按函数边界做结构化清理。
- 计划如何解决：已执行 API type-check 与相关 connector 单测；发现并修正旧 GitHub remote_sse 快照测试样例，改为 Vercel backend_rpc 样例。

- 用户确认 `26_竞品式PPT子任务编排工作流方案_[20260501-1718已采用].md` 后，再按新子任务编排模型更新测试与实现。

## 17:18 PPT workflow skill 实现

- 做了什么：将 `26_竞品式PPT子任务编排工作流方案` 更新为已采用，新增 `ppt-workflow` 平台 skill seed，并通过 intent trigger 自动挂载到 PPT / PowerPoint / 演示文稿请求；同步迁移旧 PPT 测试 fixture。
- 遇到什么：`tsx --test` 在默认沙箱内创建 IPC pipe 被拦截，使用已授权的 `pnpm --filter api exec` 在沙箱外完成测试。
- 计划如何解决：后续接入 PPT 渲染器时，让当前 `PptRenderInstructionDraft` 成为渲染器输入，不回退到旧 `office-ppt` 或 `magazine-web-ppt`。

## 17:31 PPT 旧 skill 下架同步

- 做了什么：补充 seed reconcile 规则，确保 `ppt-workflow` 已存在但归档时会重新激活、缺少 published revision 时会创建发布版本，同时自动归档旧 `office-ppt` 与 `magazine-web-ppt`。
- 遇到什么：仅从代码 seed 移除旧 skill 不会自动影响已经写入数据库的历史 skill，所以前端仍会看到旧入口。
- 计划如何解决：API 服务重启或下一次执行 `ensureSeeded` 后，用户前端只应看到新的 `ppt-workflow`，旧 PPT skill 会变为 archived。

## 18:08 Skill 资源加载修复

- 做了什么：修复 `load_skill_resource` 对 active skill 的匹配逻辑，允许在当前 active skill 范围内用 `slug + revisionNumber` 命中真实 `skillId + revisionId`；同步让工具结果直接返回 `contentMarkdown`。
- 遇到什么：真实历史会话里模型仍可能把 Active skills 中的 slug / revisionNumber 当成工具参数，导致原先只接受 UUID 级精确匹配时返回 `load_skill_resource_skill_not_active`。
- 计划如何解决：后续继续通过真实会话回看确认模型是否仍尝试额外读取 `skillResourcePath`，如有再收紧 prompt 提示。
