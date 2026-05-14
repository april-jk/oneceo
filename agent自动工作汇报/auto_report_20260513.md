# auto_report_20260513

- 时间：2026-05-13 21:45
- 做了什么：
  - 完成 Altus 上下文连续性与缓存稳定性改造方案文档评审落档。
  - 方案状态由 `[尚未采用]` 更新为 `[20260513-2145已采用]`。
  - 开始进入代码实施阶段，优先处理会话锚点、上下文窗口和 Anthropic 缓存前缀稳定性。
- 遇到什么：
  - 现有链路存在固定历史窗口（`limit:24`）与动态运行态混入 system 合并块，导致缓存前缀不稳定。
- 计划如何解决：
  - 引入会话级 `llmContextId` 锚点并在 run 间持续复用。
  - 历史窗口改为 token 预算驱动的动态裁剪。
  - 拆分 Anthropic system block，稳定前缀显式 cache_control，动态块单独注入。

---

- 时间：2026-05-13 23:42
- 做了什么：
  - 完成 Altus 提示上下文去重改造：在 `AltusRunCoordinator` 中关闭 skill catalog / active skills prompt 内部动态索引，保留一份统一的 dynamic context block 索引。
  - 将 runtime prompt 的 `Current time` 收敛为 `Current date`，降低每轮变化字段对缓存稳定性的影响。
  - 新增/更新单测覆盖：`altus-managed-prompt-service.test.ts`、`altus-run-coordinator.test.ts`，验证去重与稳定化行为。
  - 更新实施文档：`20260513_Altus会话上下文连续性与缓存稳定性基础设施改造方案_[20260513-2145已采用].md`，补充“提示拼装去重与缓存友好化”落地记录。
- 遇到什么：
  - 现有 turn-state prompt 同时拼接了 `dynamicContextPrompt` 与 skill prompt 内部 block index，导致同轮 `# Dynamic context blocks` 重复出现。
- 计划如何解决：
  - 保持 prompt service 默认兼容行为（`includeBlockIndex` 默认 true），仅在 coordinator 组合场景显式关闭，最小化影响面。
