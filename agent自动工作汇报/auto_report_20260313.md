## 2026-03-13

- 做了什么：
  - 在 `docs/playwright 测试文档` 下新增 `20260313_直通模式消息一致性回归` 测试目录，并创建了 `测试计划`、`测试结果` 子目录。
  - 使用 Playwright 回归直通模式下的平台能力链路，覆盖“发送消息 -> 任务完成 -> 页面刷新 -> 重新进入页面”三段一致性验证。
  - 扩展了回归用例，增加历史消息接口快照对比与截图像素对比，确保页面渲染和后端落盘数据同时一致。
  - 更新了测试结果文档，记录本轮失败原因、修复动作与最终通过结论。
- 遇到什么：
  - 任务完成时 UI 已显示完成，但历史消息接口落盘稍慢，导致最初抓取的基准快照比刷新后少 3 条消息。
  - 侧栏最近会话预览存在刷新前后顺序抖动，影响页面一致性验证。
- 计划如何解决：
  - 已通过“等待历史消息稳定后采样”和“当前会话置顶 + updatedAt 排序”修复本轮一致性问题。
  - 后续继续单独排查普通开发请求直通执行器的成功完成链路，把一致性回归从平台能力场景扩展到完整执行器场景。
  - 已新增 OpenCode 状态文件归档恢复方案文档，等待用户审核通过后再开始开发。

- 做了什么：
  - 研究了 OpenCode 官方文档与当前 oneceo 代码中 Sandbox 归档、工作区恢复、OpenCode HTTP API 的实现。
  - 输出了“OpenCode 状态文件归档恢复优化方案”设计文档，明确推荐用项目内 `.opencode` 数据目录配合现有工作区归档恢复会话历史。
- 遇到什么：
  - 当前 oneceo 已有工作区归档恢复能力，但尚未显式保证 OpenCode 自身 session storage 与工作区归档绑定。
  - 本地环境没有 `opencode` 可执行文件，内部行为判断需要结合 OpenCode 官方文档与现有集成代码推导。
- 计划如何解决：
  - 若用户确认方案，下一步将以 `data.directory=.opencode` 为主路径，补恢复后 session 重绑定与页面历史优先从 OpenCode 读取的开发实现。

- 做了什么：
  - 按已批准方案完成了 OpenCode 状态文件恢复链路开发。
  - 新增 `opencode-history-recovery.ts`，实现恢复后 session 选择和 OpenCode 原生消息归一化。
  - 接通 `/session/:id/message` 拉取能力，并让 `GET /api/task-creation/sessions/:id/messages` 优先读取 OpenCode 原生历史。
  - 在 Sandbox 启动和 OSAC 按需拉起 OpenCode server 时统一注入 `XDG_DATA_HOME=<workspace>/.opencode`，让 OpenCode 的 sqlite / log / session 文件落到工作区归档范围内。
  - 补充了 `tests/opencode-history-recovery.test.ts`，并更新了 `04_persistence_refresh_consistency` 场景，兼容 `opencode_user_input`。
- 遇到什么：
  - 当前 Sandbox 内 OpenCode `v1.2.6` 不兼容 `opencode.json` 中的 `data.directory`，会直接报 `Unrecognized key: "data"` 并导致 `opencode serve` 启动失败。
  - Web 侧现有 Playwright 用例 `direct-mode-refresh-consistency.playwright.spec.ts` 在本轮回归里因测试超时触发 `request context disposed`，不是后端接口报错。
- 计划如何解决：
  - 已改为使用 `XDG_DATA_HOME` 落地工作区级 `.opencode`，替代不兼容的 `data.directory`。
  - 后续如果要把 Web Playwright 也纳入这条链路验收，需要单独修复该用例的超时与 request 生命周期问题。
  - 后续可再补一条专门覆盖“Sandbox 销毁后恢复、重新进入页面直接读取 OpenCode 原生历史”的端到端 Playwright 或 API 回放测试。

- 做了什么：
  - 继续迭代 `direct-mode-refresh-consistency.playwright.spec.ts`，把浏览器端验收扩展到两条链路：平台能力完成后刷新一致性，以及 OpenCode 原生历史恢复后一致性。
  - 为侧栏新增会话更新事件的本地状态补丁，收到终态消息时立即同步 `status/title`，避免当前页预览停留在旧状态。
  - 调整 Playwright 快照清洗规则，剔除 `执行环境已接入（...） · OPENCODE_*` 这类瞬时运行态徽标，避免把运行时提示误判为对话正文差异。
  - 将原生历史浏览器验收改为扫描“已恢复的原生历史会话”并校验进入、刷新、重新进入后三份快照和截图一致。
- 遇到什么：
  - 平台能力链路真正剩余的问题不是消息落盘，而是当前页侧栏预览和临时运行态徽标会导致快照比较抖动。
  - 当前环境下即时创建新的 OpenCode 原生历史种子会话并不稳定，浏览器验收更适合直接复用已经恢复成功的会话样本。
- 计划如何解决：
  - 当前 `pnpm --filter web exec playwright test client/src/tests/direct-mode-refresh-consistency.playwright.spec.ts` 已通过，两条浏览器回归链路都已纳入验收。
  - 后续如果要继续提升 OpenCode 原生恢复的“完整历史”能力，需要再单独补 assistant/tool 侧消息恢复范围，这一项不属于本轮 Playwright 一致性修复本身。
