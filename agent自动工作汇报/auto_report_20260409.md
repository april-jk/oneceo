# auto report 2026-04-09

- 做了什么：
  - 认领并处理 Issue #43（历史 session 续聊时工作区文件未恢复）。
  - 全链路排查了文件保存/归档/恢复流程，定位到 `Altus managed` 的两个关键缺口：
    1. `ensureSandbox` 旁路复用导致暂停沙箱误判可用。
    2. `write_file/shell_execute/附件写入` 未标记 dirty，归档任务可能跳过最新增量。
  - 已完成修复：
    1. `altus-managed-setup-service.ensureSandbox` 统一接入 `sandboxAgentProvisionService.provisionWithLock`。
    2. `altus-managed-tool-runtime` 的 `shell_execute`、`write_file`、`mcp tool` 成功后标记 `markSandboxDirty`。
    3. `altus-managed-input-service` 附件写入后改为 `markSandboxDirty`。
    4. `osac-agent-service.callSessionMcpTool` 增加触达与成功后 dirty 标记。
  - 补充了对应单元测试并更新了恢复设计文档中的 Issue #43 修复记录。
- 遇到什么：
  - `Altus` 启动链路存在与 `sandbox-agent-provision-service` 并行的历史旁路实现，容易与现有恢复策略漂移。
- 计划如何解决：
  - 执行 API 侧相关测试与 type-check，确认恢复门禁与 dirty 归档信号在回归场景稳定。
  - 基于测试结果更新 Issue #43 评论，附上修复点与验证命令。

- 做了什么（补充）：
  - 新增“Altus记忆与日志持久化架构评审”文档（[尚未采用]）。
  - 新增“Altus记忆DB持久化+Redis读取链路专项评审”文档（[尚未采用]），用于与其他存储路线对比评审。
- 遇到什么（补充）：
  - 现有链路是 DB/Redis/本地文件/R2 的混合态，评审中需明确“真相源”与“缓存层”边界。
- 计划如何解决（补充）：
  - 等待你评审两份文档后，再按你选定路线进入正式设计采用与代码改造阶段。

- 做了什么（补充2）：
  - 创建并认领 Issue #44：Altus 记忆终态重构（DB真相源 + Redis读模型，本地文件去依赖）。
  - 输出完整终态设计文档：
    - docs/agent研发文档/20260409_Altus记忆终态重构_DB真相源+Redis读模型方案_[尚未采用].md
  - 已将文档链接回填到 Issue #44，等待评审。
- 计划如何解决（补充2）：
  - 评审通过后按文档一次性切换实施，并补齐回归与压测。

- 做了什么（补充3）：
  - 按评审意见补充“无 Redis 兼容层”设计：未显式启用 Redis 时，必须完全不走 Redis。
  - 在终态方案中新增 `task-session-cache-facade.ts` 作为统一兼容层入口，并补齐开关矩阵测试要求。
  - 已将更新回填到 Issue #44 评论。

- 做了什么（补充4）：
  - 按要求补充“线上系统环境变量优先”规则：`ONECEO_REDIS_ENABLED/REDIS_URL` 支持仅 process env 注入生效。
  - 在终态文档中新增“.env 与系统环境变量冲突时系统变量优先”的约束，并回填 Issue #44。

- 做了什么（补充5）：
  - 对终态方案做完整逻辑审查，修订并补齐 7 项关键闭环（env优先级、替换范围、Redis单写、no_redis策略、stale判定、历史回填、outbox并发语义）。
  - 已将修订说明回填 Issue #44。

- 做了什么（补充6）：
  - 实施 `load-env` 生产优先级修复：dotenv 改为 `override: false`，移除预清空业务 env 逻辑，确保系统环境变量优先。
  - 新增 `load-env` 测试重置函数 `__resetLoadApiEnvForTest`，并补充 `apps/api/tests/load-env.test.ts`。
  - 新增 Redis 兼容层服务 `apps/api/src/services/task-session-cache-facade.ts`，并补充 `apps/api/tests/task-session-cache-facade.test.ts`。
  - 将 `task-creation-routes.ts` 中 recent/workspace/event 回放缓存路径统一接入 facade，确保 `ONECEO_REDIS_ENABLED` 未显式开启时完全不走 Redis。
- 多层测试（补充6）：
  - 代码层：`tsx --test tests/load-env.test.ts tests/task-session-cache-facade.test.ts tests/task-creation-route-coverage.test.ts` 全部通过。
  - 类型层：`tsc --noEmit` 通过。
  - Playwright：`playwright test client/src/tests/managed-completion-card-routing.playwright.spec.ts` 通过（2/2）。
- 遇到什么（补充6）：
  - MCP Playwright 浏览器工具在当前运行环境写 `/.playwright-mcp` 目录失败（只读根目录），已记录为环境限制，不影响仓库内 Playwright 自动化测试执行。

- 做了什么（补充7）：
  - 修复 managed 模式“complete_task 吞并详细正文”的问题：
    1. 在 `altus-run-coordinator` 新增最终内容择优逻辑，优先保留同轮 assistant 的更完整正文。
    2. 调整 `altus-managed-prompt-service` completion 规则，要求 `complete_task.summary` 提供可直接展示的完整最终答复，而非一句话摘要。
    3. 新增回归测试 `execute preserves richer assistant text when complete_task summary is concise`。
  - 同步更新已采用设计文档的修复记录（20260331 设计文档第 16 节）。
- 遇到什么（补充7）：
  - 该问题同时涉及“运行时最终落库策略”和“提示词完成约束”；仅改前端渲染无法从根源避免最终历史消息被短 summary 覆盖。
- 计划如何解决（补充7）：
  - 继续观察线上 managed run 中 `web_search -> complete_task` 场景，确认最终消息内容与流式展示保持一致，不再出现任务完成后正文变短。

- 做了什么（补充8）：
  - 针对 Issue #45 再次回归，补充排查到“非空但 legacy 的 user_id”路径：历史 session 的 `user_id` 为旧匿名本地标识时，原空归属回填逻辑无法命中。
  - 新增后端定向迁移能力：
    1. `rebindSessionsFromLegacyUserId`（列表链路）
    2. `adoptSessionFromLegacyUserId`（详情/访问链路）
  - `task-creation-routes` 读取 `X-Legacy-User-Id`（兼容 `X-User-Id` hint）后，先做 legacy 定向迁移，再走 orphan 回填。
  - 统一 owner 比较为规范化比较（trim 后比较），修复历史脏数据导致的误判 403。
  - Web 端 `buildClientIdentityHeaders` 透传 `localStorage.oneceo_client_user_id` 到 `X-Legacy-User-Id`，用于历史会话归属修复。
  - 新增/更新 API 测试覆盖 legacy 定向迁移与详情链路认领场景。
- 遇到什么（补充8）：
  - 线上历史数据存在“空归属 + legacy 归属 + 规范归属”并存，单一回填策略不能覆盖全部历史形态。
- 计划如何解决（补充8）：
  - 执行 task-creation 相关回归测试与 type-check，确认刷新/重部署场景下列表稳定恢复且不放宽跨用户边界。
