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
