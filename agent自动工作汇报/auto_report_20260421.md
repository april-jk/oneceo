# 2026-04-21 自动工作汇报

- 按最新范围收窄为“只做 Altus 直通链路”的 skills 会话保持修复，不再继续扩散 managed 链路改动。
- 在 `opencode-remote-service` 接入会话级 `sessionSkillState` 解析：用户新一轮输入时优先从 DB/Redis 恢复 resident skills，再结合当前 intent 决定 contextual skills 是否继续挂载。
- 修正直通链路对 `metadata.skills` 的一次性依赖：当前轮没有重复传 skill metadata 时，仍会把会话中已保存的 resident skills 同步回 sandbox，不再因为前端缺参导致 skill 丢失。
- 对 `source=agent` 场景增加保护：内部澄清/续跑不重新洗 resident selections，避免代理中途把已驻留 skills 清空。
- 新增直通链路回归测试 `apps/api/tests/opencode-remote-skill-state.test.ts`，覆盖“上下文变化后 contextual resident skill 退出”和“`metadata.skills` 缺失时仍同步 resident skills”两条主链。
- 已完成定向验证：`pnpm exec tsx --test tests/opencode-remote-stream-delta.test.ts tests/opencode-remote-skill-state.test.ts` 与 `pnpm type-check` 均通过。
- 已尝试执行真实直通 e2e 套件 `pnpm run test:opencode-direct`，但在 `01_session_bootstrap` 场景超时；报告显示 WebSocket 首条欢迎消息后立即返回“当前未登录或会话已过期”，当前阻塞点在测试鉴权上下文，不在本次 skills 续挂逻辑。
- 已补齐 `opencode-sandbox-direct` 测试 harness 的自动登录能力，复用 `apps/web/e2e/playwright-test-account.json` 为 WS / SSE / HTTP 查询统一注入 `app_session_id`，关闭了真实直通 e2e 的鉴权阻塞。
- 已执行 `pnpm db:init` 对齐本地开发库 schema，消除 `task_creation_sessions.metadata_json` 缺失导致的 `PROVISION:opencode_connector_config` 查询失败。
- 已完成本轮详细回归电池：`task-session-skill-state-service`、`task-session-redis-cache-service`、`opencode-remote-*`、`sandbox-skill-sync-service`、`sandbox-archive.service` 共 13 个定向测试全部通过，`pnpm type-check` 通过。
- 已定位并修复 `04_persistence_refresh_consistency`：`/api/task-creation/sessions/:sessionId/messages` 在 native history 存在时只补 metadata、不补缺失 user input，导致刷新后 continuation 类消息丢失；现已改为允许从持久化 timeline 补回缺失的 `user_input / user_response / opencode_user_input`。
- 已新增路由回归测试 `apps/api/tests/task-creation-deep-routes.test.ts`，固定覆盖“native history 缺一轮 user input，但 file-memory 仍有持久化消息”的场景。
- 真实直通 e2e 最新复跑结果：`pnpm run test:opencode-direct` 已 `5/5` 全通过，`04_persistence_refresh_consistency` 已翻绿。
- 本轮 direct e2e 产生的 orchestrator sandbox `isuws2py6fevk9u3pkhpc` 已主动关闭，避免继续计费。
- 已重新对照 `task-session-skill-state-service` 的 skills 记忆设计，收缩 Altus 三级记忆文档中的 session 级方案：保留“DB 真相源 + Redis 可选缓存 + sandbox 文件副本 + 受控 flush”这一复杂度，不再为 Altus 额外引入 `baseVersion / compare-and-set` 一类更重的回写协议，避免首版出现不可控状态机和隐藏竞态。
- 已按最新要求调整 Altus 三级记忆文档：用户级 / 项目级记忆改为“DB 真相源 + Redis 读加速”，同时明确 Redis 只做缓存、写入必须先写 DB 再刷新或失效 Redis，避免把用户级 / 项目级做成第二真相源。
- 已进一步收紧 Altus session 级记忆文档：明确 run 启动阶段只装载一次 session memory，运行中以内存快照和 sandbox 文件为主，避免多轮执行期间反复读写数据库；DB 回写流程直接对齐 skills memory 的固定模式：读 sandbox 文件、normalize、写 DB、刷新 Redis。
- 已开始按采用文档进入 Altus 三级记忆代码实现：用户级记忆扩展到用户设置个性化表单，项目级记忆扩展到项目创建/编辑表单与 `app_user_projects.metadata_json.altusProjectMemory`，session 级记忆新增 `task-session-altus-memory-service` 并接入 DB + Redis + sandbox 文件副本。
- 已将 Altus 运行链路接上三级记忆：managed run 启动时组装“用户级 + 项目级 + session 级” prompt context，coordinator 在 sandbox 物化 session 记忆文件，并在 `completed / failed / waiting_user / archive / restore` 等受控时机回写 DB 与 Redis。
- 已同步补齐边界约束：`POST /sessions` 支持创建时带 `projectId`，项目删除在仍有关联 session 时返回 409，项目改名后同步 session `projectName` 缓存，已进入有效运行阶段的 session 禁止再变更项目归属。
- 已补充针对性回归测试：`altus-managed-run-entry.service.test.ts` 覆盖 run 输入带入 memory context，`altus-run-coordinator.test.ts` 覆盖 memory prompt 注入与 session 记忆 flush，`sandbox-archive.service.test.ts` 覆盖 archive/restore 时 Altus 记忆回写。
## 17:41 Altus三级记忆 Playwright 全链路测试准备

- 新增 Altus 三级记忆 Playwright 测试方案文档，覆盖用户级、项目级、session 级主链路。
- 准备单次登录复用 cookie 的 Playwright 回归，用项目内箭头入口直接起会话。
- 计划同时核验 UI、接口返回、内部 memory context 和 session memory 快照，避免只看表面交互。

## 18:20 Altus三级记忆 Playwright 全链路修复与复测

- 通过 Playwright 真实跑通后，定位到两个实际问题：
  1. managed 模式从项目箭头进入新会话时，draft session 未继承 `projectId`
  2. session memory 在有 sandbox 但缺少 memory 文件时不会 fallback 回写，导致 `version=0`
- 已分别修复：
  - `useTaskCreationAgent` 在 managed draft session 创建后补做项目归属绑定
  - `task-session-altus-memory-service` 在文件缺失时改为从 timeline 派生 session memory 并落库
- 新增和更新了对应 Playwright 回归与服务层单测，最终复测通过。

## 20:10 Altus managed 纯记忆问答误失败修复

- 定位到 managed 协调器把“我是谁 / 你是谁 / 记得我吗”这类纯记忆问答也强行套进 `complete_task` 合约，模型直接回答纯文本后会被标记为 `managed_model_plain_text_without_tool_call`。
- 已在 `altus-run-coordinator` 增加窄范围放行：只对纯身份/记忆问答接受纯文本直答，普通工程任务仍继续要求工具链和 `complete_task`。
- 同步更新 managed prompt，消除“系统允许纯记忆直答”与“prompt 强制所有回复都必须 complete_task”之间的冲突。
- 已补充 coordinator / prompt 回归测试，准备执行定向验证。
