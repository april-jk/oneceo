# 12 Suna预览卡片与Altus产物预览对齐设计

## 1. 目标

本篇解决两个强关联的问题：

1. `Altus 接管模式` 如何参照 `suna`，把“工具执行过程预览 + 最终完成卡片预览 + HTML/网页 iframe 预览”做成完整闭环。
2. `Altus 接管模式` 如何参照 `suna` 的 `KortixComputer`，把 `Actions / Files / replay` 查看器补齐。

这里不讨论 direct mode，也不讨论通用聊天布局，只聚焦：

- 工具执行中的过程预览
- 任务完成后的附件/产物卡片
- HTML/网页类文件的 `Preview / Code / Open`
- 数据如何从 stream/tool message 流到 UI
- `Actions / Files` 切换查看器
- 回放浏览 `Prev / Next / Jump to Latest`

## 2. Suna 的完整实现链路

`suna` 的预览不是单个组件，而是“三层预览 + 一套回放查看器”：

1. 输入区附近的浮动工具预览
2. 对话消息流中的过程预览
3. 任务完成后的附件/产物预览卡片
4. `Actions / Files` 视图与回放导航

前三层共用同一套工具消息数据；第四层则把同一批工具调用整理成可导航、可回放的运行历史视图。

## 3. 第一层：输入区附近的浮动工具预览

### 3.1 入口

- `referance/suna/apps/frontend/src/components/thread/chat-input/chat-snack.tsx`
- `referance/suna/apps/frontend/src/components/thread/chat-input/floating-tool-preview.tsx`

### 3.2 实现方式

`chat-snack.tsx` 在输入区上方根据 `toolCalls.length > 0` 决定是否展示 `FloatingToolPreview`。  
`FloatingToolPreview` 只展示当前工具调用的极简摘要：

- 工具名
- 参数摘要
- 运行中/成功/失败状态
- 点击后展开到完整侧栏/窗口

### 3.3 关键点

- 它不是独立数据源，只消费当前 run 的 `toolCalls`
- 展示目标是“告诉用户当前正在做什么”，不是承载完整结果
- 对 oneceo 的启发是：过程预览不应该只停留在聊天流里，还应在输入区附近有轻量状态反馈

## 4. 第二层：对话消息流中的过程预览

### 4.1 入口

- `referance/suna/apps/frontend/src/components/thread/content/ThreadContent.tsx`
- `referance/suna/apps/frontend/src/components/thread/content/ShowToolStream.tsx`
- `referance/suna/apps/frontend/src/components/thread/content/ToolCard.tsx`

### 4.2 数据进入方式

`ThreadContent.tsx` 会从 assistant message 的 `metadata.tool_calls` 里提取工具调用，并区分三种情况：

1. `ask / complete`
   - 直接转成正文型消息，不走通用工具预览
2. streaming tool call
   - 交给 `ShowToolStream`
3. completed tool call
   - 仍交给 `ShowToolStream` 或后续完整 tool view

关键位置：

- `referance/suna/apps/frontend/src/components/thread/content/ThreadContent.tsx`
  - `tool_calls` 提取
  - `ask/complete` 特判
  - `visibleToolCalls` 过滤
  - `ShowToolStream` 渲染

### 4.3 ShowToolStream 做了什么

`ShowToolStream.tsx` 不是简单“显示 JSON”，它做了三件事：

1. 从流式/不完整 JSON 中提取主要字段
   - `extractFieldFromPartialJson(...)`
   - `extractFilePathFromPartialJson(...)`
   - `extractFileContentsFromPartialJson(...)`
2. 根据工具类型决定展示方式
   - 普通工具 -> `ToolCard`
   - 可流式文件编辑工具 -> 展示内容预览
   - slide/media/tool 特殊工具 -> 展示专门 preview
3. 当工具有特殊可视化能力时，渲染真正的 preview，而不是文本摘要

对应源码位置：

- `referance/suna/apps/frontend/src/components/thread/content/ShowToolStream.tsx`
  - tool call JSON 解析
  - tool type 分类
  - streamable content 渲染
  - `SlideStreamPreview`
  - `ToolCard`

### 4.4 ToolCard 的职责

`ToolCard.tsx` 是过程预览的基础卡片，不负责真正 iframe/file preview，它负责：

- 工具名
- 参数摘要
- streaming/success/error 状态
- 网站 favicon / 图片缩略图 / slide preview 等轻量补充信息
- 点击进入完整工具视图

对应源码：

- `referance/suna/apps/frontend/src/components/thread/content/ToolCard.tsx`

## 5. 第三层：任务完成后的附件/产物预览卡片

### 5.1 入口

- `referance/suna/apps/frontend/src/components/thread/tool-views/CompleteToolView.tsx`

### 5.2 实现方式

`CompleteToolView` 读取 `toolCall.arguments.attachments`，把任务完成产物按附件列表展示出来。

它本身不直接处理 HTML/PDF/Image 细节，而是把每个 attachment 交给：

- `FileAttachment`

源码：

- `referance/suna/apps/frontend/src/components/thread/tool-views/CompleteToolView.tsx`

### 5.3 关键点

`Task complete (1 file)` 这类 UI，不是来自 assistant 普通 markdown，而是来自 `complete` 工具的结构化参数：

- `text`
- `attachments`
- `follow_up_prompts`

也就是说，`suna` 的“最终卡片”是工具结果视图，不是聊天正文增强。

### 5.4 oneceo 当前落地补充（2026-03-26）

- `apps/web/client/src/components/AltusArtifactPreviewCard.tsx`
  - 顶部右上角主按钮改为“部署”，不再承担“打开查看器”语义
  - 首页对话流里的 `managed_artifact_card` 点击后直接调用现有 `deployTaskCreationSession(sessionId)`，联动平台侧部署服务
  - 部署成功后切到右侧 `OpencodePreviewPanel` 的 `deployment` tab，复用已有部署面板与状态轮询
- `Open` 按钮继续保留为查看当前产物文件/网页的入口
- `AltusRunReplayDrawer` 不接部署动作，继续保持 run 回放里的文件查看语义

### 5.5 当前补充修正（2026-04-19）

- 对于已经完成 Railway 发布的会话，`AltusArtifactPreviewCard` 不再只依赖 sandbox 工作区 `workspace/raw/*` 预览地址。
- 当前端能读取到会话部署面板里的 `latestStaticUrl / latestUrl / domains[0]` 时，网页类交付物会优先切换到部署公网地址：
  - `Preview` iframe 直接加载 Railway 线上地址
  - `Open` 直接打开 Railway 线上地址
- 这样即使 sandbox 内的原始 HTML 预览暂时不可恢复，已成功发布的交付物仍然可以稳定预览，不会再出现“线上可访问，但交付预览卡片空白”的割裂状态。
- 同一策略也同步补到了右侧 `OpencodePreviewPanel` 的文件预览中，保证 `Load files -> 选中 HTML 文件` 走到的也是同一条线上预览链路。

## 6. 文件/网页预览的底层组件链

### 6.1 FileAttachment 是总分发器

源码：

- `referance/suna/apps/frontend/src/components/thread/file-attachment/index.tsx`

它会根据文件类型把 attachment 分发到不同 preview：

- 图片 -> `ImagePreview`
- PDF -> `PdfPreview` / `PdfThumbnail`
- 表格 -> `SpreadsheetPreview`
- 文档 -> `DocumentPreview`
- HTML -> `DocumentPreview -> HtmlRenderer`
- 特殊 slide/presentation -> `PresentationSlidePreview`

### 6.2 HTML 预览链

HTML 预览不是读 API 返回文本后 `srcDoc` 渲染，而是优先构造真实 sandbox URL：

- `referance/suna/apps/frontend/src/components/file-previews/DocumentPreview.tsx`
- `referance/suna/apps/frontend/src/components/file-renderers/html-renderer.tsx`
- `referance/suna/apps/frontend/src/components/thread/iframe-preview.tsx`
- `referance/suna/apps/frontend/src/lib/utils/url.ts`

具体链路：

1. `DocumentPreview` 判断文件是 `html/htm`
2. 通过 `constructHtmlPreviewUrl(project.sandbox.sandbox_url, filepath)` 构造真实预览 URL
3. `HtmlRenderer` 提供 `Preview / Code / Open`
4. `IframePreview` 用 iframe 加载该 URL

### 6.3 为什么必须是真实 URL

`suna` 没有把 HTML 预览建立在单次文本 API 响应上，而是建立在：

- sandbox 可访问地址 `sandbox_url`
- 文件真实路径

原因是网页预览通常要正确解析：

- 相对 CSS
- 相对 JS
- 图片资源
- 多文件目录结构

这点对 oneceo 很关键。

## 7. Suna 的消息与工具数据结构

### 7.1 前端工具视图统一 props

源码：

- `referance/suna/apps/frontend/src/components/thread/tool-views/types.ts`

核心结构：

- `ToolCallData`
  - `tool_call_id`
  - `function_name`
  - `arguments`
  - `rawArguments`
- `ToolResultData`
  - `success`
  - `output`
  - `error`

### 7.2 stream 到 UI 的入口

源码：

- `referance/suna/apps/frontend/src/hooks/messages/useAgentStream.ts`
- `referance/suna/apps/frontend/src/lib/streaming/use-agent-stream.ts`

这层职责是：

- 把 stream 事件累计为统一消息
- 重建 tool calls
- 形成 assistant message + tool call metadata
- 供 `ThreadContent` / `ToolView` 消费

所以 `suna` 的预览系统依赖的是“结构化 tool call/message 模型”，不是 DOM 层临时拼接。

## 8. Suna 的 Actions / Files / Replay 查看器

### 8.1 主入口

- `referance/suna/apps/frontend/src/components/thread/kortix-computer/KortixComputer.tsx`
- `referance/suna/apps/frontend/src/stores/kortix-computer-store.ts`

这是 `suna` 的完整运行查看器，不属于 `CompleteToolView`，而是独立的一套运行态 UI。你给出的 `Actions / Files / Prev / Next / Jump to Latest` 抽屉，对应的就是这里。

### 8.2 状态存储

`kortix-computer-store.ts` 负责维护查看器状态，关键字段包括：

- `activeView`
  - `tools | files | browser`
- `filesSubView`
  - `browser | viewer`
- `filePathList`
- `currentFileIndex`
- `pendingToolNavIndex`
- `isSidePanelOpen`

关键动作包括：

- `setActiveView(...)`
- `navigateToToolCall(toolIndex)`
- `setIsSidePanelOpen(...)`

这意味着 `suna` 的回放不是靠聊天区临时状态推断，而是有独立查看器状态机。

### 8.3 回放主体

`KortixComputer.tsx` 的职责是：

1. 从工具调用历史中计算：
   - `currentSnapshot`
   - `currentToolCall`
   - `safeInternalIndex`
   - `latestIndex`
   - `completedToolCalls`
2. 提供导航行为：
   - `navigateToPrevious`
   - `navigateToNext`
   - `jumpToLatest`
3. 在 `Actions / Files / Browser` 三个视图之间切换
4. 处理“从消息流点击某个工具卡片 -> 侧栏跳到对应步骤”的联动

### 8.4 导航与视图切换

对应源码：

- `referance/suna/apps/frontend/src/components/thread/kortix-computer/components/NavigationControls.tsx`
- `referance/suna/apps/frontend/src/components/thread/kortix-computer/components/Dock.tsx`

它们分别负责：

- `Prev / Next / Jump to Latest`
- 底部视图切换和当前步骤状态

### 8.5 Files 视图

对应源码：

- `referance/suna/apps/frontend/src/components/thread/kortix-computer/FileBrowserView.tsx`
- `referance/suna/apps/frontend/src/components/thread/kortix-computer/components/Desktop.tsx`

`Files` 视图不是简单文件列表，而是把当前运行相关的文件集合独立展示出来，并允许在文件浏览和文件查看之间切换。

### 8.6 消息流到回放查看器的桥接

对应源码：

- `referance/suna/apps/frontend/src/hooks/messages/useThreadToolCalls.ts`

这层负责把消息流中的工具调用变成可导航的 tool call list，并支持：

- 点击工具消息
- 打开 `KortixComputer`
- 跳到对应工具调用索引

这点对 oneceo 很关键：如果只做抽屉 UI，但不做“消息 -> 抽屉步骤”联动，就不是 `suna` 那种完整回放能力。

## 9. oneceo 当前实现与缺口

### 8.1 当前已有的东西

- `apps/web/client/src/pages/Home.tsx`
  - 已有 `managed_tool` 原子消息
  - 已有 hover detail
- `apps/web/client/src/components/OpencodePreviewPanel.tsx`
  - 已有侧栏预览器
- `apps/web/client/src/lib/opencode-preview.ts`
  - 已有 direct mode/Codex diff 预览抽取
- `apps/api/src/routes/task-creation-routes.ts`
  - 已有 `/workspace/file` JSON 文件读取接口

### 8.2 当前缺的东西

oneceo 现在缺的是一整条“结构化产物预览链”，而不是少一个卡片样式。

具体缺口：

1. `managed tool event -> artifact model`
   - 当前只有 `managed_tool` 摘要消息
   - 没有产物级对象
2. `过程预览卡`
   - 当前没有像 `ShowToolStream` 那样按工具类型展示过程内容
3. `完成卡片`
   - 当前 `complete_task` 结束后没有 `attachments -> preview card` 视图
4. `HTML 真实预览 URL`
   - 当前只有 `/workspace/file?path=...` JSON 接口
   - 没有可供 iframe 使用的真实 raw file path URL
5. `Preview / Code / Open` 三态切换
   - 当前 managed mode 没有对网页产物做内联预览卡

## 10. oneceo 的目标实现方式

### 10.1 目标分三层复刻

#### A. 过程轻预览

对齐 `FloatingToolPreview + ToolCard`

目标：

- 输入区附近或消息流内显示当前正在执行的关键工具
- 展示工具名、状态、参数摘要
- 对 `write_file / shell_execute / expose_preview` 类工具支持更强的视觉反馈

对应 oneceo 落点：

- `apps/web/client/src/pages/Home.tsx`
- 后续建议拆分到独立组件，例如 `AltusToolPreviewChip.tsx`

#### B. 过程中的展开预览

对齐 `ShowToolStream`

目标：

- `write_file` 流式生成 HTML/CSS/JS 时，可看到实时内容片段
- `shell_execute` 可展示关键命令摘要
- 若后续引入端口暴露或页面可访问 URL，可展示 iframe 预览

对应 oneceo 落点：

- `apps/web/client/src/pages/Home.tsx`
- 后续建议新增 `AltusToolStreamPreview.tsx`

#### C. 完成后的产物卡片

对齐 `CompleteToolView + FileAttachment + HtmlRenderer`

目标：

- `complete_task` 或等价产物完成事件落地后，生成“任务完成卡片”
- 列出文件数
- 对 HTML 产物展示：
  - `Preview`
  - `Code`
  - `Open`

对应 oneceo 落点：

- `apps/web/client/src/pages/Home.tsx`
- `apps/web/client/src/lib/task-creation-client.ts`
- `apps/api/src/routes/task-creation-routes.ts`

### 10.2 新增第四层：Actions / Files / Replay 查看器

对齐 `KortixComputer + kortix-computer-store + NavigationControls`

目标：

- 在 Altus managed run 完成后，或者在运行过程中，提供独立的 `Actions / Files` 查看器
- `Actions` 视图按步骤显示当前 run 的结构化动作历史
- `Files` 视图显示当前 run 产出的文件集合
- 支持：
  - `Prev`
  - `Next`
  - `Jump to Latest`
  - 从消息流中的工具原子消息跳转到对应步骤

对应 oneceo 落点：

- `apps/web/client/src/components/ui/drawer.tsx`
- `apps/web/client/src/pages/Home.tsx`
- 后续建议新增：
  - `apps/web/client/src/components/AltusRunReplayDrawer.tsx`
  - `apps/web/client/src/components/AltusRunActionsView.tsx`
  - `apps/web/client/src/components/AltusRunFilesView.tsx`
  - `apps/web/client/src/lib/altus-replay.ts`

### 10.3 oneceo 的目标状态模型

为了对齐 `suna`，oneceo 需要新增独立的回放查看器状态，而不是把它们塞回 `Home.tsx` 的局部临时变量。

建议最小状态：

- `isAltusReplayOpen`
- `activeRunId`
- `activeReplayView`
  - `actions | files`
- `currentReplayIndex`
- `latestReplayIndex`
- `runActionSnapshots[]`
- `runFiles[]`
- `pendingReplayJumpToolCallId`

### 10.4 oneceo 的目标数据来源

`Actions` 视图的数据不能来自 assistant 普通 markdown，而应来自 managed 结构化事件：

- `tool_call_started`
- `tool_call_completed`
- `tool_call_failed`
- `run_status`
- `clarification_requested`
- `run_completed`

每个 tool call 至少要沉淀为一个 `AltusReplayAction`：

- `toolCallId`
- `toolName`
- `status`
- `summary`
- `arguments`
- `outputPreview`
- `artifactPaths`
- `createdAt`

`Files` 视图则由两部分组成：

- `write_file / read_file / list_directory` 等工具显式涉及的路径
- 最终 `managed_artifact_card` 聚合出的产物集合

### 10.5 oneceo 的目标交互

1. 聊天流中点击 `managed_tool` 原子消息
2. 打开 `AltusRunReplayDrawer`
3. 自动切到 `Actions`
4. 跳到当前工具调用对应的步骤索引
5. 用户可继续：
   - `Prev`
   - `Next`
   - `Jump to Latest`
   - 切换到 `Files`
   - 打开某个文件的 `Preview / Code / Open`

这条链必须形成闭环，否则就只有“一个漂亮的卡片”，没有 `suna` 那种可回放的运行查看器。

## 11. oneceo 必须新增的后端能力

### 10.1 raw workspace file route

为了让 iframe 像 `suna` 那样加载真实网页，oneceo 必须新增 raw 文件访问路由，而不是继续复用 `/workspace/file` JSON 接口。

建议形态：

- `GET /api/task-creation/sessions/:sessionId/workspace/raw/*`

要求：

- 返回文件原始内容而不是 JSON
- 正确设置 `Content-Type`
- 路径必须保留层级，保证 HTML 中相对资源可继续访问
- Altus managed 使用同一工作区文件来源

对应当前 oneceo 代码参照：

- `apps/api/src/routes/task-creation-routes.ts`
  - 现有 `/workspace/file`
- `apps/api/src/connectors/e2b-connector.ts`
  - 若 Altus managed 直接落在 E2B 中，需要通过这里读取文件

## 12. oneceo 前端目标数据结构

为了复刻 `suna`，oneceo 不应只靠 `managed_tool` 文本摘要拼 UI，而应增加至少两类结构化消息：

1. `managed_tool_preview`
   - 过程中的工具预览
   - 字段：
     - `toolCallId`
     - `toolName`
     - `status`
     - `summary`
     - `previewKind`
     - `previewPayload`

2. `managed_artifact_card`
   - 最终产物卡片
   - 字段：
     - `runId`
     - `title`
     - `artifactCount`
     - `artifacts[]`
     - `defaultArtifactPath`
     - `viewMode`

`artifacts[]` 至少应包含：

- `path`
- `displayName`
- `kind`
- `previewable`
- `codePreviewAvailable`
- `openUrl`

3. `managed_replay_action`
   - 回放查看器的动作快照
   - 字段：
     - `runId`
     - `toolCallId`
     - `stepIndex`
     - `toolName`
     - `status`
     - `summary`
     - `arguments`
     - `outputPreview`
     - `artifactPaths[]`
     - `createdAt`

4. `managed_replay_file`
   - `Files` 视图使用的文件实体
   - 字段：
     - `runId`
     - `path`
     - `displayName`
     - `kind`
     - `previewType`
     - `openUrl`
     - `lastSourceToolCallId`

补充约束：

- `managed_artifact_card` 与 `managed_replay_file` 不是同一语义层
- `managed_artifact_card` 只承载“任务完成后的网页预览卡片”
- `managed_replay_file` 才负责过程文件与代码文件的回放查看
- 因此最终完成卡片必须过滤掉纯代码文件，避免把 `*.js/*.ts/*.css` 直接抬成主预览卡片
- 完成卡片右上角按钮应进入 oneceo 内部 viewer；卡片内部 `Open` 仍可保留外部打开 raw 页面

## 13. 推荐的 oneceo 实现顺序

1. 补 raw workspace file route
2. 在 managed tool event 中抽取 artifact 候选
3. 新增 `managed_artifact_card` UI
4. 为 HTML 产物补 `Preview / Code / Open`
5. 新增 `Actions / Files` 抽屉查看器
6. 补消息流到回放步骤的跳转
7. 再补“过程中的展开预览”
8. 最后补输入区附近的 floating preview

顺序原因：

- 没有 raw route，HTML iframe 预览永远只能是假的
- 没有 artifact model，完成卡片只能是临时样式
- 没有 replay action model，`Actions / Files / Prev / Next` 只能做空壳
- 先把完成闭环补齐，再补回放查看器与过程层高级预览，路径最短

## 14. Suna 代码参照

### 13.1 浮动工具预览

- `referance/suna/apps/frontend/src/components/thread/chat-input/chat-snack.tsx`
- `referance/suna/apps/frontend/src/components/thread/chat-input/floating-tool-preview.tsx`

### 13.2 对话流过程预览

- `referance/suna/apps/frontend/src/components/thread/content/ThreadContent.tsx`
- `referance/suna/apps/frontend/src/components/thread/content/ShowToolStream.tsx`
- `referance/suna/apps/frontend/src/components/thread/content/ToolCard.tsx`

### 13.3 完成卡片

- `referance/suna/apps/frontend/src/components/thread/tool-views/CompleteToolView.tsx`

### 13.4 文件/网页预览

- `referance/suna/apps/frontend/src/components/thread/file-attachment/index.tsx`
- `referance/suna/apps/frontend/src/components/file-previews/DocumentPreview.tsx`
- `referance/suna/apps/frontend/src/components/file-renderers/html-renderer.tsx`
- `referance/suna/apps/frontend/src/components/thread/iframe-preview.tsx`
- `referance/suna/apps/frontend/src/lib/utils/url.ts`

### 14.5 数据结构与 stream

- `referance/suna/apps/frontend/src/components/thread/tool-views/types.ts`
- `referance/suna/apps/frontend/src/hooks/messages/useAgentStream.ts`
- `referance/suna/apps/frontend/src/lib/streaming/use-agent-stream.ts`

### 14.6 Actions / Files / Replay

- `referance/suna/apps/frontend/src/stores/kortix-computer-store.ts`
- `referance/suna/apps/frontend/src/components/thread/kortix-computer/KortixComputer.tsx`
- `referance/suna/apps/frontend/src/components/thread/kortix-computer/components/NavigationControls.tsx`
- `referance/suna/apps/frontend/src/components/thread/kortix-computer/components/Dock.tsx`
- `referance/suna/apps/frontend/src/components/thread/kortix-computer/FileBrowserView.tsx`
- `referance/suna/apps/frontend/src/components/thread/kortix-computer/components/Desktop.tsx`
- `referance/suna/apps/frontend/src/hooks/messages/useThreadToolCalls.ts`

## 15. oneceo 直接开发依据

开发 oneceo 这一块时，应优先对照以下文件：

- 前端聊天页：
  - `apps/web/client/src/pages/Home.tsx`
- 现有 preview 面板：
  - `apps/web/client/src/components/OpencodePreviewPanel.tsx`
- 现有 direct preview 抽取：
  - `apps/web/client/src/lib/opencode-preview.ts`
- workspace 文件读取：
  - `apps/web/client/src/lib/task-creation-client.ts`
  - `apps/api/src/routes/task-creation-routes.ts`
- managed tool runtime 输出来源：
  - `apps/api/src/services/altus-run-coordinator.ts`
  - `apps/api/src/services/altus-managed-tool-runtime.ts`
- oneceo 当前可复用抽屉与预览骨架：
  - `apps/web/client/src/components/ui/drawer.tsx`
  - `apps/web/client/src/components/TaskRuntimeDrawer.tsx`
  - `apps/web/client/src/components/OpencodePreviewPanel.tsx`

## 16. 设计结论

`suna` 的“最终卡片预览”不是孤立组件，而是下面这条链路的最后一环：

> stream tool call -> tool preview -> tool/full view -> attachment/file preview -> complete card

而 `Actions / Files / replay` 又是另一条并行但共享数据的链路：

> tool call history -> replay action snapshots -> actions/files drawer -> prev/next/latest navigation

oneceo 现在已经有了最轻的 `managed_tool` 原子消息和第一版完成卡片，但还缺：

- 结构化 artifact model
- 原生 HTML/raw preview URL
- 过程预览视图
- 完成卡片视图
- 回放动作快照模型
- `Actions / Files` 抽屉查看器
- 消息流到回放步骤的联动导航

后续实现时，必须按上面这条链路补齐，不能只补一个“漂亮卡片”，否则仍然无法形成和 `suna` 一致的任务闭环体验。

## 17. 当前实现状态

### 17.1 已落地

- `apps/api/src/routes/task-creation-routes.ts`
  - 已新增 `/workspace/raw/*`
  - 已将 Altus workspace 文件读取切到 E2B 分支，和 Codex 一致
  - 已修正 Altus/E2B 工作区读取门禁，不再错误依赖非 E2B 的 `runtimeStatus === ready` 才能读取文件
- `apps/api/src/services/altus-run-coordinator.ts`
  - `tool_call_completed / tool_call_failed` 现在带回 `arguments`
  - 前端可以稳定恢复 `write_file` 产物路径
- `apps/web/client/src/lib/task-creation-client.ts`
  - 已新增 `getWorkspaceRawFileUrl(...)`
- `apps/web/client/src/components/AltusArtifactPreviewCard.tsx`
  - 已落地第一版 `Preview / Code / Open` 完成卡片
- `apps/web/client/src/pages/Home.tsx`
  - 已把 managed `write_file` 完成事件聚合成 run 级 `managed_artifact_card`
  - 已在 `run_completed` 前插入最终产物卡片

### 17.2 已继续落地

- `apps/web/client/src/components/AltusRunReplayDrawer.tsx`
  - 已新增第一版 `Actions / Files` 抽屉
  - 已支持 `Prev / Next / Jump to Latest`
- `apps/web/client/src/pages/Home.tsx`
  - 已新增 managed run 级 `replay actions / files` 聚合
  - 已支持从 `managed_tool` 原子消息跳到对应 replay step

### 17.3 仍未落地

- 输入区附近的 floating tool preview
- 对话过程中的文件内容流式 preview
- richer 文件分发器，尚未做到 `suna` 的 `FileAttachment -> DocumentPreview / HtmlRenderer / ...` 细粒度分层

### 17.4 当前边界

当前实现已经覆盖：

- 最终完成卡片
- `Actions / Files` 抽屉
- 回放导航

但还没有一次性复刻 `suna` 全部 preview 体系，尤其是 floating preview 和过程中的 richer stream preview。
