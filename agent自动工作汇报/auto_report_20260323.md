## 2026-03-23

- 做了什么：
  统一修改 sandbox 默认 LLM 配置，覆盖 Codex runtime 默认值、Codex App Server 兜底配置、OpenCode 直通与 Altus sandbox provision 默认环境，以及前端设置页默认展示值；同步更新相关 Codex 设计文档。
- 遇到什么：
  仓库内同一组默认值分散在 API、前端、`.env` 与设计文档多处，且 Codex 与 OpenCode 对 base URL 的格式要求不同，不能简单做全文替换。
- 计划如何解决：
  继续用类型校验验证 API 与前端改动；若后续联调发现 OpenCode 上游必须使用不同路径，再只在 OpenCode 环节收敛到兼容的 OpenAI-compatible endpoint，不改 Codex 的 provider 根地址约定。

- 做了什么：
  对照 `referance/suna` 的 Integrations 代码与 oneceo 现有 Connector Center 实现，完成了连接器模块重构设计文档，明确采用 `definition + profile + session binding + runtime materialization` 的结构，并把 `custom_http_mcp / custom_sse_mcp` 作为首批新增能力写入文档。
- 遇到什么：
  `suna` 的大量 app integrations 依赖 Composio Python 服务层，不是可以直接复制进 oneceo 的 TypeScript 连接器；如果不先明确是否引入 Composio，就不能直接进入编码。
- 计划如何解决：
  等用户先审核并确认设计前提；若按当前文档推进，则下一步先改数据模型和 definition registry，再迁移现有四个连接器与前端 Connector Center。

- 做了什么：
  根据用户追加要求，已将阶段一连接器范围更新为 `github / notion / slack / supabase / figma / vercel`，并在设计文档中明确 `supabase` 必须作为独立连接器接入，`postgres` 暂时弃用且不出现在前台连接器选择菜单。
- 遇到什么：
  “直接接入整个 Supabase” 仍有一个关键边界未确认：阶段一究竟是按官方 Supabase MCP 暴露的工具集合接入，还是要求覆盖更完整的 Supabase 产品面，这会直接影响 profile schema、runtime materializer 和验收口径。
- 计划如何解决：
  等用户确认 Supabase 的阶段一覆盖范围；确认后直接进入 schema、definition registry、profile service 和前端 Connector Center 的编码改造。

- 做了什么：
  已按确认后的方案完成阶段一连接器主链路编码：后端新增 definition/profile/session binding 数据模型与迁移，接入 `github / notion / slack / supabase / figma / vercel` 六个连接器 definition，隐藏 `postgres`；前端把设置页和会话弹窗改成 profile 模式，明确“sandbox 外配置、sandbox 内挂载使用”。
- 遇到什么：
  前端原有 Connector Center 和会话弹窗都建立在单 account 模型上，不能直接套新 API；如果继续兼容旧交互，会导致 OAuth 回调、默认 profile、会话 attach 三条链路互相覆盖。
- 计划如何解决：
  继续用最小闭环验证当前实现；后续若进入联调阶段，再补充各远程 MCP adapter 的真实部署配置验证与端到端 attach 测试。

- 做了什么：
  按用户追加要求，继续优化 GitHub 连接器配置体验：后端允许 GitHub profile 自动命名并在 OAuth 后回填账号名；前端把 GitHub 改成 OAuth 优先、PAT 进入高级配置的轻量流程，不再强迫用户先填 profile 名称。
- 遇到什么：
  当前 GitHub runtime 直接依赖真实 token 权限，oneceo 并没有单独的 repo 白名单物化链路；如果照搬外部产品的“授权仓库”分步界面，会形成前端有流程、运行时没约束的错误语义。
- 计划如何解决：
  现阶段坚持只做真实有效的账户授权体验；后续若要支持仓库级授权，需要先补 runtime 约束和 repo 选择的后端物化模型，再扩展前端步骤。

- 做了什么：
  继续精简 GitHub 详情页，移除通用连接器页面里的 profiles、说明卡和冗余资料区，改成单按钮 OAuth 主路径；只有在用户主动展开时才显示 PAT 高级配置。
- 遇到什么：
  GitHub 作为特化页面后，必须避免再被通用连接器布局污染，否则即使保留 OAuth 主按钮，页面仍然会被 profile 和教程信息淹没。
- 计划如何解决：
  保持 GitHub 走单独渲染分支；后续如果继续优化，只在这个极简分支上迭代，不再回到通用模板。

- 做了什么：
  进一步按 Manus 的视觉结构收紧 GitHub 弹窗，去掉通用顶部标题栏，改成仅保留右上角关闭按钮的 500px 单列居中布局，并把状态卡压缩为更轻的摘要信息区。
- 遇到什么：
  之前虽然已经拆出 GitHub 专用分支，但仍然套着通用 DialogHeader，导致视觉上依旧像“通用连接器详情页”，与单按钮授权体验冲突。
- 计划如何解决：
  后续只在 GitHub 专用弹窗上继续微调间距、按钮和信息卡层级；不再让 GitHub 回退到通用连接器的弹窗骨架。

- 做了什么：
  调整 GitHub 弹窗主操作区，把“断开连接”从下方摘要卡移到“重新连接”按钮右侧，保证授权态下的主操作集中展示。
- 遇到什么：
  断开连接放在摘要卡里时，视觉层级低于重新连接，用户需要先理解信息卡再找到操作，不符合主操作并排展示的直觉。
- 计划如何解决：
  继续把 GitHub 弹窗保持为“主操作在上、补充信息在下”的结构，后续如需再加动作，也优先放在主按钮组而不是信息卡内。

- 做了什么：
  移除了 GitHub 弹窗“显示详情”区域里的 Personal Access Token 入口和保存表单，让详情区只保留状态和 OAuth 可用性信息。
- 遇到什么：
  详情区继续暴露 PAT 会和当前单按钮 OAuth 主路径冲突，用户展开详情后仍会看到多余的备用授权方式，破坏页面收敛度。
- 计划如何解决：
  继续把 GitHub 页面约束为 OAuth 主路径；如果后续确实还要保留 PAT，只能以独立入口重新设计，不能再塞回详情折叠区。

- 做了什么：
  核查了会话连接器弹窗与 GitHub attach 链路，确认当前二级页本质上只是“选择 profile 并挂载”；随后把 GitHub 仓库授权二级页的真实方案补进设计文档，新增 `session_config_json`、GitHub repo 列表接口和 runtime repo allowlist wrapper 的设计。
- 遇到什么：
  当前 attach API 只接受 `profileId`，GitHub runtime 也只是把 token 注入 `@modelcontextprotocol/server-github`，没有任何 repo 级约束能力；如果直接把 UI 改成“选择授权仓库”，会变成假流程。
- 计划如何解决：
  待用户审核新的设计文档后，按最短路径进入编码：先扩展 binding 和 attach payload，再做 GitHub repo 列表接口，最后补 runtime wrapper 让仓库授权在 sandbox 内真实生效。

- 做了什么：
  已完成 GitHub 会话仓库授权链路的首版实现：后端给 session binding 增加 `session_config_json`，attach 接口支持提交 `repositories[]`，新增 GitHub 仓库列表接口，并在 GitHub MCP runtime 前增加 repo allowlist wrapper；前端 `ConnectorDialog` 的 GitHub 二级页改成仓库搜索、多选和“授权到当前会话/更新授权仓库”面板。
- 遇到什么：
  API 仓库本身存在一批历史 `tsc` 错误，导致无法用全量类型检查作为这次改动的单一验收手段；因此需要用前端 `pnpm check`、关键后端模块导入、task routes 导入和 runtime materialization 结果做组合验证。
- 计划如何解决：
  下一步在真实本地数据下联调 GitHub profile 的仓库列表与 attach 行为，重点验证仓库回显、更新授权仓库和 wrapper 对非 allowlist 仓库请求的拒绝表现。

- 做了什么：
  继续按用户给出的参考样式压缩 GitHub 会话二级页，把原来的大卡片和多段说明收成窄版 repo picker：顶部只保留账号摘要，中间是搜索框和紧凑仓库列表，选中态改为行尾 check，底部保留会话授权按钮和“配置 GitHub”入口。
- 遇到什么：
  GitHub 二级页既要尽量像轻量资源选择器，又不能牺牲真实的 session attach 提交动作；如果完全照搬纯列表样式，会丢失“把选择结果真正提交到当前会话”的关键闭环。
- 计划如何解决：
  继续用前端 `pnpm check` 验证本轮布局改动；下一步在真实 GitHub 数据下检查长仓库名、省略样式、搜索空结果态和“切换并授权”按钮文案是否还需要继续收紧。

- 做了什么：
  根据用户进一步要求，把 GitHub 会话仓库授权从多选收成“一个对话只授权一个仓库”，并继续压缩一级连接器列表与底部管理入口的尺寸，让整个连接器弹层更接近紧凑资源选择器。
- 遇到什么：
  后端 session 配置结构仍然是 `repositories[]`，因此前端必须在不改协议的前提下把选择行为约束成单选，并始终只提交数组中的第一个仓库。
- 计划如何解决：
  继续保持前端单选约束；后续如果确认产品层面永远只允许单仓库会话授权，再考虑把接口语义从 `repositories[]` 明确收敛成单值字段。

- 做了什么：
  把连接器二级页从“挂在每一行上的独立 popover”改成一级面板右侧的固定子菜单，并对 GitHub 的仓库摘要与底部已选仓库文本做截断处理，避免二级页和一级列表出现文字遮挡。
- 遇到什么：
  原先的嵌套 popover 会以当前行作为锚点，导致二级页纵向位置漂移，不像真正的级联菜单；同时长仓库名在一级摘要和二级底部状态区会挤占按钮空间。
- 计划如何解决：
  继续维持“固定子菜单 + 关键文本摘要化”的结构；后续如果再出现极长组织名或仓库名，再评估是否增加 tooltip 或双行摘要上限。
