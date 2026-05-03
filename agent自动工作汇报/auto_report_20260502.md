# 2026-05-02 工作汇报

## VercelMcp 显示卡片文案统一

- 做了什么：将 Vercel 已授权卡片的账号展示文案固定为 `vercel`，避免继续显示 `team_mGcDixrMSgZ5EN1BzoNrAHhT` 这类原始团队标识。
- 遇到什么：当前工作区已有连接器卡片相关未提交改动，本次只补齐 locale 文案，不覆盖既有结构调整。
- 计划如何解决：继续以 `apps/web` 最小校验确认前端类型与文案引用可用。

## MCP 连接器卡片语言统一

- 做了什么：为连接器目录新增 `connectors.catalog` 中英文文案，并让卡片、详情弹窗、搜索索引和连接按钮统一使用当前语言下的展示文案。
- 遇到什么：后端 catalog 定义里 Slack/GitHub/Figma/Vercel 是英文，Notion/Supabase 是中文，前端直出时会在同一界面混用。
- 计划如何解决：已通过前端 type-check，后续若新增连接器需要同步补齐 `connectors.catalog` 文案。

## 12:37 PPT 渲染器接入

- 做了什么：将 `27_PPT渲染器接入方案` 更新为已采用，新增 `render_pptx_from_instructions` 受控工具、PPT 渲染指令校验器和 Sandbox 内 PPTX 渲染服务；同步更新 `ppt-workflow` seed 与 Active skills 提示，让预检通过后可以进入 PPTX 渲染。
- 遇到什么：现有工具 JSON schema 类型只允许封闭对象，渲染指令需要传递嵌套 JSON，因此扩展了工具 schema 类型以支持开放对象参数。
- 计划如何解决：下一步用真实 Altus 会话做 smoke，验证 Sandbox 内 `pptxgenjs` 安装与 PPTX 文件打开情况，再补页面预览或修复回路。

## 13:10 PPT 渲染绕过修复

- 做了什么：复盘会话 `d3663fc7-52cf-491b-a788-3c89d3e757fe`，确认模型绕过 `render_pptx_from_instructions`，自行写 `python-pptx` 脚本生成默认空白风格 PPT；已新增 runtime 硬门禁，`ppt-workflow` active 且 `complete_task.attachments` 包含 `.pptx` 时，必须先由渲染器返回该路径。
- 遇到什么：仅靠 prompt 提醒不足以阻止模型直接使用脚本生成文件。
- 计划如何解决：继续跑真实 smoke，确认新门禁会迫使模型回到受控渲染器；随后增强渲染器布局质量和页面预览验证。

## 13:22 PPT pageType 兼容修复

- 做了什么：复盘会话 `c827a618-69b8-4bad-9fd4-3d1062506c3b`，确认渲染器失败原因是模型输出 `overview`、`feature`、`technical`、`usecase`、`demo` 等语义 pageType，而校验器只接受少数固定类型；已新增 pageType 归一化映射。
- 遇到什么：第一版渲染契约把页面类型写得过窄，导致可理解的语义类型被误判为 unsupported。
- 计划如何解决：后续继续补 renderer 版式能力，让不同语义页不只是“能过校验”，还要渲染出明显不同的页面结构。

## 13:35 PPT 图片资源与版式修复

- 做了什么：根据截图复查 PPT 输出，确认资料收集阶段可以收集图片资源，问题在于渲染器未消费 `imageSlots`，同时误把 `layoutIntent` 渲染成了页面正文；已让渲染器下载 `imageSlots` 图片并放入封面或内容页视觉区域，且 `layoutIntent` 只作为内部版式意图使用。
- 遇到什么：第一版渲染器仍偏“文本模板”，即使资料侧提供图片，也会生成过于简陋的空白页。
- 计划如何解决：下一步继续做版式引擎增强，包括多图布局、不同页面类型差异化、视觉密度校验和截图回看修复闭环。

## 13:50 PPT 审美风格纳入

- 做了什么：参考 `op7418/guizang-ppt-skill`，将其主题预设、字体分工、hero/light/dark 节奏、固定布局家族、图片比例和审美自检规则翻译进 `ppt-workflow` 与 PPTX 渲染器；仍保持 `.pptx` 受控渲染，不走 HTML deck。
- 遇到什么：参考 skill 的核心价值在审美约束和 checklist，不在 WebGL/HTML 技术路线；需要把“好看”的要求变成结构化字段和 renderer 行为，而不是只写进 prompt。
- 计划如何解决：后续做真实会话 smoke，检查生成 PPT 是否明显摆脱白底文字模板，并继续补多图网格、数据大字报和渲染后截图审美评分。

## 13:54 PPT 工作流 rev2 发布

- 做了什么：确认数据库中 `ppt-workflow` 仍停在 published rev1，随后将当前 seed 版本发布为 rev2，revision id 为 `c85cb624-e3d7-4680-a4e5-79b6ba820a22`。
- 遇到什么：代码和 seed 已更新，但已有 skill 不会因 seed 变化自动创建新 published revision。
- 计划如何解决：后续涉及 seed 内容改动时，同步检查管理库 published revision，避免前端继续看到旧版 skill。

## 14:18 PPT 版式去模板化修复

- 做了什么：根据真实生成结果，补强 `ppt-workflow` 的去模板化、标题正文去重、图片去重和正文内容厚度规则；同时让 renderer 按 `layoutFamily` 走 `image-grid`、`big-number`、`pipeline`、`before-after` 等不同结构，并发布为 `ppt-workflow` rev3。
- 遇到什么：rev2 主要解决主题审美，renderer 仍会把大量页面落到同一个 generic content 骨架，所以出现“换色模板”、标题正文重复和图片复用。
- 计划如何解决：下一轮通过真实会话检查 rev3 效果，继续补多图素材收集策略和渲染后截图评分。

## 14:40 PPT 渲染 exit status 1 修复

- 做了什么：复盘会话 `c5347fff-326c-47cc-8eeb-7d27e07fc2bc`，复现 `render_pptx_from_instructions` 的 `exit status 1`，确认是 renderer 将布尔值 `true` 传给 `pptxgenjs.addText` 导致；已改为始终传字符串，补强 renderer 命令日志捕获，并新增脚本级回归测试。
- 遇到什么：原工具失败只暴露 `exit status 1`，没有把 Sandbox 内真实 stderr 传回模型和用户，导致排障困难。
- 计划如何解决：后续部署新 API 代码后重跑该会话同类输入；若再失败，应直接返回 renderer stderr，而不是只有退出码。
