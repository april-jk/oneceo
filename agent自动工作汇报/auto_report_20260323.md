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
